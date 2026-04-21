import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import passport from "passport";

import { analyzeActivity } from "../services/groq-analyzer";
import {
  collectGitHubActivity,
  getGitHubCommitDetail,
  getGitHubFileContent,
  listGitHubRepositories,
} from "../services/github-collector";
import { writeJsonArtifact } from "../utils/artifacts";
import { loadProjectEnv } from "../utils/load-project-env";
import type { GitHubUserRecord, SavedAnalysisRun } from "./models";
import { ensureWebClientBundle, getWebClientOutDir } from "./build-client";
import { getMongoDb } from "./mongo";
import { createAnalysisRun, findAnalysisRunById, listRecentAnalysisRunsByUser } from "./run-store";
import { renderAppShell, renderServerMessagePage } from "./shell";
import { findGitHubUserById, updateConnectedRepositories, upsertGitHubUser } from "./user-store";
import { loadWebDashboardConfig } from "./web-config";

loadProjectEnv();

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

let configuredGitHubStrategyKey: string | undefined;

function asyncRoute(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function getCurrentUser(req: Request): GitHubUserRecord | null {
  return (req.user as GitHubUserRecord | undefined) ?? null;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseRepositoriesField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => String(item).trim())
          .filter(Boolean),
      ),
    );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}

function requireAuthPage(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) {
    next();
    return;
  }

  res.redirect("/?error=Silakan login dengan GitHub dulu.");
}

function requireAuthApi(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) {
    next();
    return;
  }

  res.status(401).json({ error: "Silakan login dengan GitHub dulu." });
}

function toPublicUser(user: GitHubUserRecord) {
  return {
    id: user._id,
    username: user.username,
    displayName: user.displayName,
    profileUrl: user.profileUrl,
    avatarUrl: user.avatarUrl,
    email: user.email,
    connectedRepositories: user.connectedRepositories,
  };
}

function toRecentRunSummary(run: SavedAnalysisRun) {
  return {
    id: run._id,
    reportDate: run.reportDate,
    repositoryFullNames: run.repositoryFullNames,
    createdAt: run.createdAt instanceof Date ? run.createdAt.toISOString() : String(run.createdAt),
    productivityScore: run.report.productivityScore,
    overallSummary: run.report.overallSummary,
    confidence: run.report.confidence,
  };
}

function toRunDetail(run: SavedAnalysisRun) {
  return {
    ...run,
    createdAt: run.createdAt instanceof Date ? run.createdAt.toISOString() : String(run.createdAt),
  };
}

async function ensureGitHubStrategy(): Promise<void> {
  const webConfig = loadWebDashboardConfig();
  const strategyKey = `${webConfig.appBaseUrl}|${webConfig.githubClientId}|${webConfig.githubClientSecret}`;
  if (configuredGitHubStrategyKey === strategyKey) {
    return;
  }

  const module = (await import("passport-github2")) as {
    Strategy: new (
      options: {
        clientID: string;
        clientSecret: string;
        callbackURL: string;
        scope?: string[];
      },
      verify: (
        accessToken: string,
        refreshToken: string,
        profile: {
          id: string;
          username?: string;
          displayName?: string;
          profileUrl?: string;
          emails?: Array<{ value?: string }>;
          photos?: Array<{ value?: string }>;
        },
        done: (error: unknown, user?: GitHubUserRecord | false) => void,
      ) => void | Promise<void>,
    ) => passport.Strategy;
  };

  passport.use(
    "github",
    new module.Strategy(
      {
        clientID: webConfig.githubClientId,
        clientSecret: webConfig.githubClientSecret,
        callbackURL: new URL("/auth/github/callback", webConfig.appBaseUrl).toString(),
        scope: ["read:user", "user:email", "repo"],
      },
      async (accessToken, _refreshToken, profile, done) => {
        try {
          const user = await upsertGitHubUser({
            _id: profile.id,
            username: profile.username || profile.displayName || `github-${profile.id}`,
            displayName: profile.displayName || undefined,
            profileUrl: profile.profileUrl || undefined,
            avatarUrl: profile.photos?.[0]?.value || undefined,
            email: profile.emails?.[0]?.value || undefined,
            accessToken,
            connectedRepositories: (await findGitHubUserById(profile.id))?.connectedRepositories ?? [],
          });
          done(null, user);
        } catch (error) {
          done(error);
        }
      },
    ),
  );

  configuredGitHubStrategyKey = strategyKey;
}

passport.serializeUser((user, done) => {
  done(null, (user as GitHubUserRecord)._id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await findGitHubUserById(id);
    done(null, user || false);
  } catch (error) {
    done(error);
  }
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET?.trim() || "local-dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());
app.use("/assets", express.static(getWebClientOutDir()));

app.get(
  "/auth/github",
  asyncRoute(async (req, res, next) => {
    await ensureGitHubStrategy();
    const handler = passport.authenticate("github", {
      scope: ["read:user", "user:email", "repo"],
    });
    handler(req, res, next);
  }),
);

app.get(
  "/auth/github/callback",
  asyncRoute(async (req, res, next) => {
    await ensureGitHubStrategy();
    const handler = passport.authenticate("github", {
      failureRedirect: "/?error=Autentikasi GitHub gagal.",
    });
    handler(req, res, next);
  }),
  (_req, res) => {
    res.redirect("/dashboard?notice=Login GitHub berhasil.");
  },
);

app.get("/logout", (req, res, next) => {
  req.logout((error) => {
    if (error) {
      next(error);
      return;
    }

    res.redirect("/?notice=Logout berhasil.");
  });
});

app.get(
  "/api/session",
  asyncRoute(async (req, res) => {
    const user = getCurrentUser(req);
    res.json({
      authenticated: Boolean(user),
      user: user ? toPublicUser(user) : null,
      authUrl: "/auth/github",
      logoutUrl: "/logout",
      dashboardUrl: "/dashboard",
    });
  }),
);

app.get(
  "/api/dashboard",
  requireAuthApi,
  asyncRoute(async (req, res) => {
    const webConfig = loadWebDashboardConfig();
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      res.status(401).json({ error: "Session GitHub tidak ditemukan." });
      return;
    }

    const selectedRepositories =
      currentUser.connectedRepositories.length > 0
        ? currentUser.connectedRepositories
        : webConfig.githubDefaultRepositories;

    const repositories = await listGitHubRepositories(currentUser.accessToken, currentUser.username, selectedRepositories);
    const recentRuns = await listRecentAnalysisRunsByUser(currentUser._id);

    res.json({
      user: toPublicUser(currentUser),
      githubTimezone: webConfig.githubTimezone,
      githubTimezoneOffset: webConfig.githubTimezoneOffset,
      groqModel: webConfig.appConfig.groqModel,
      groqReady: Boolean(webConfig.appConfig.groqApiKey),
      repositories,
      recentRuns: recentRuns.map(toRecentRunSummary),
    });
  }),
);

app.post(
  "/api/repositories/connect",
  requireAuthApi,
  asyncRoute(async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      res.status(401).json({ error: "Session GitHub tidak ditemukan." });
      return;
    }

    const repositories = parseRepositoriesField(req.body?.repositories);
    const updatedUser = await updateConnectedRepositories(currentUser._id, repositories);
    if (!updatedUser) {
      res.status(404).json({ error: "User GitHub tidak ditemukan." });
      return;
    }

    res.json({
      user: toPublicUser(updatedUser),
    });
  }),
);

app.post(
  "/api/analyze",
  requireAuthApi,
  asyncRoute(async (req, res) => {
    const webConfig = loadWebDashboardConfig();
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      res.status(401).json({ error: "Session GitHub tidak ditemukan." });
      return;
    }

    if (!webConfig.appConfig.groqApiKey) {
      res.status(400).json({ error: "GROQ_API_KEY wajib diisi di environment server untuk analisa." });
      return;
    }

    const selectedRepositories = parseRepositoriesField(req.body?.repositories);
    const repositories =
      selectedRepositories.length > 0
        ? selectedRepositories
        : currentUser.connectedRepositories.length > 0
          ? currentUser.connectedRepositories
          : webConfig.githubDefaultRepositories;
    const reportDate = parseOptionalString(req.body?.reportDate);

    if (repositories.length === 0) {
      res.status(400).json({ error: "Hubungkan minimal satu repository sebelum menjalankan analisa." });
      return;
    }

    const config = webConfig.appConfig;
    const collection = await collectGitHubActivity(config, {
      accessToken: currentUser.accessToken,
      repositories,
      reportDate,
      timezone: webConfig.githubTimezone,
      timezoneOffset: webConfig.githubTimezoneOffset,
    });
    const report = await analyzeActivity(collection, config);
    const rawFile = await writeJsonArtifact(config.outputDir, `github-raw-${collection.reportDate}.json`, collection);
    const analysisFile = await writeJsonArtifact(config.outputDir, `github-analysis-${report.reportDate}.json`, report);
    const savedRun = await createAnalysisRun({
      reportDate: report.reportDate,
      source: "github",
      repositoryFullNames: repositories,
      createdBy: currentUser._id,
      createdAt: new Date(),
      collection,
      report,
      rawFile,
      analysisFile,
    });

    res.json({ runId: savedRun._id });
  }),
);

app.get(
  "/api/runs/:id",
  requireAuthApi,
  asyncRoute(async (req, res) => {
    const currentUser = getCurrentUser(req);
    const run = await findAnalysisRunById(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run tidak ditemukan." });
      return;
    }

    if (!currentUser || run.createdBy !== currentUser._id) {
      res.status(403).json({ error: "Run ini bukan milik session GitHub yang sedang login." });
      return;
    }

    res.json({ run: toRunDetail(run) });
  }),
);

app.get(
  "/api/github/commit/:owner/:repo/:sha",
  requireAuthApi,
  asyncRoute(async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      res.status(401).json({ error: "Session GitHub tidak ditemukan." });
      return;
    }

    const detail = await getGitHubCommitDetail(currentUser.accessToken, req.params.owner, req.params.repo, req.params.sha);
    res.json({ detail });
  }),
);

app.get(
  "/api/github/file",
  requireAuthApi,
  asyncRoute(async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      res.status(401).json({ error: "Session GitHub tidak ditemukan." });
      return;
    }

    const owner = parseOptionalString(req.query.owner);
    const repo = parseOptionalString(req.query.repo);
    const filePath = parseOptionalString(req.query.path);
    const ref = parseOptionalString(req.query.ref);

    if (!owner || !repo || !filePath || !ref) {
      res.status(400).json({ error: "owner, repo, path, dan ref wajib dikirim." });
      return;
    }

    const file = await getGitHubFileContent(currentUser.accessToken, owner, repo, filePath, ref);
    res.json({ file });
  }),
);

app.get(
  "/",
  asyncRoute(async (_req, res) => {
    loadWebDashboardConfig();
    res.type("html").send(renderAppShell());
  }),
);

app.get(
  ["/dashboard", "/runs/:id", "/github/commit/:owner/:repo/:sha", "/github/file"],
  requireAuthPage,
  asyncRoute(async (_req, res) => {
    loadWebDashboardConfig();
    res.type("html").send(renderAppShell());
  }),
);

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[web]", error);

  if (req.path.startsWith("/api/")) {
    res.status(500).json({ error: message });
    return;
  }

  res.status(500).type("html").send(renderServerMessagePage("Server Error", message, "500"));
});

async function start(): Promise<void> {
  loadWebDashboardConfig();
  await ensureWebClientBundle();
  await getMongoDb();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`[web] listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[web] failed to start: ${message}`);
  process.exit(1);
});
