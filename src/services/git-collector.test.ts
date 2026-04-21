import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AppConfig } from "../types";
import { collectActivity } from "./git-collector";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createConfig(repoPath: string): AppConfig {
  return {
    groqApiKey: "x",
    groqBaseUrl: "https://api.groq.com/openai/v1",
    groqModel: "openai/gpt-oss-20b",
    groqAnalysisModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    groqAnalysisMaxRequests: 40,
    projectRepos: [repoPath],
    projectBaseDirs: [],
    discoveryIgnoreNames: [],
    projectPreviewUrls: {},
    projectRunCommands: {},
    projectRouteRules: {},
    projectWebAuth: {},
    projectAliases: {},
    hrisLoginUrl: undefined,
    hrisCardsUrl: undefined,
    hrisApiMethod: "POST",
    hrisEmail: undefined,
    hrisPassword: undefined,
    hrisListId: 35127,
    hrisBoardId: undefined,
    hrisBoardListsUrl: undefined,
    hrisCardLimit: 10,
    hrisApiToken: undefined,
    hrisAuthHeader: "Authorization",
    hrisTokenPrefix: "Bearer",
    hrisHeaders: {},
    hrisPayloadStatic: {},
    hrisCardChecklists: [],
    hrisSendDescription: true,
    hrisSendEvidence: false,
    hrisEvidenceMode: "none",
    hrisEvidenceDir: "./reports/evidence",
    hrisBrowserPath: undefined,
    hrisCodeScreenshotStyle: "ray",
    hrisCodeScreenshotStrict: false,
    hrisDevServerWaitMs: 12000,
    hrisEmployeeId: undefined,
    outputDir: "./reports",
    maxCommitsPerRepo: 15,
    maxFilesPerRepo: 30,
    analysisMinFileChangeCount: 2,
    analysisMinUnitChangeCount: 8,
    scheduleTime: undefined,
    scheduleRunOnStart: true,
  };
}

function runGit(repoPath: string, args: string[], envOverrides: Record<string, string> = {}): string {
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const result = Bun.spawnSync(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...inheritedEnv,
      ...envOverrides,
    },
  });
  const decoder = new TextDecoder();

  if (result.exitCode !== 0) {
    throw new Error(decoder.decode(result.stderr).trim() || `git ${args.join(" ")} failed`);
  }

  return decoder.decode(result.stdout).trim();
}

test("collectActivity keeps git add status for new committed view files", async () => {
  const repoPath = mkdtempSync(path.join(tmpdir(), "yijiexhris-git-collector-"));
  tempDirs.push(repoPath);

  runGit(repoPath, ["init"]);
  runGit(repoPath, ["config", "user.name", "Test User"]);
  runGit(repoPath, ["config", "user.email", "test@example.com"]);

  const viewPath = path.join(repoPath, "resources", "views");
  mkdirSync(viewPath, { recursive: true });
  writeFileSync(
    path.join(viewPath, "request-check-progress.blade.php"),
    "<div>Request Check Progress</div>\n<table></table>\n",
  );

  runGit(repoPath, ["add", "."]);

  const now = new Date().toISOString();
  runGit(
    repoPath,
    ["commit", "-m", "Add request check progress view"],
    {
      GIT_AUTHOR_DATE: now,
      GIT_COMMITTER_DATE: now,
    },
  );

  const collection = await collectActivity(createConfig(repoPath));
  const repo = collection.repositories[0];
  const commit = repo?.commitDetails[0];
  const viewStat = commit?.fileChangeStats.find((file) => file.path === "resources/views/request-check-progress.blade.php");

  expect(collection.repositories).toHaveLength(1);
  expect(commit?.subject).toBe("Add request check progress view");
  expect(viewStat?.gitStatuses).toContain("A");
});
