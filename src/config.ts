import path from "node:path";

import type { AppConfig, HrisChecklistTemplate, ProjectRouteRule, ProjectWebAuthConfig } from "./types";
import { parseBooleanEnv, parseJsonArrayEnv, parseJsonEnv, parseListEnv, parseNumberEnv } from "./utils/env";

function toStringRecord(value: Record<string, unknown>, envName: string): Record<string, string> {
  const entries = Object.entries(value);
  const output: Record<string, string> = {};

  for (const [key, entryValue] of entries) {
    if (typeof entryValue !== "string") {
      throw new Error(`${envName} values must all be strings.`);
    }

    output[key] = entryValue;
  }

  return output;
}

function parseHrisMethod(raw: string | undefined): AppConfig["hrisApiMethod"] {
  const method = raw?.trim().toUpperCase() || "POST";
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    return method;
  }

  throw new Error(`HRIS_API_METHOD must be POST, PUT, or PATCH. Received "${raw}".`);
}

function parseEvidenceMode(raw: string | undefined): AppConfig["hrisEvidenceMode"] {
  const mode = raw?.trim().toLowerCase() || "auto";
  if (mode === "none" || mode === "auto" || mode === "code" || mode === "url") {
    return mode;
  }

  throw new Error(`HRIS_EVIDENCE_MODE must be none, auto, code, or url. Received "${raw}".`);
}

function parseOptionalPositiveInteger(raw: string | undefined): number | undefined {
  if (!raw?.trim()) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer but received "${raw}".`);
  }

  return value;
}

function parseChecklistTemplates(raw: string | undefined): HrisChecklistTemplate[] {
  if (!raw?.trim()) {
    return [
      { title: "Progres", checklist: "yes", position: 1 },
      { title: "Bukti", checklist: "yes", position: 2 },
      { title: "Final", checklist: "yes", position: 3 },
    ];
  }

  return parseJsonArrayEnv(raw, "HRIS_CARD_CHECKLISTS_JSON").map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`HRIS_CARD_CHECKLISTS_JSON item at index ${index} must be an object.`);
    }

    const title = (item as Record<string, unknown>).title;
    const checklist = (item as Record<string, unknown>).checklist;
    const position = (item as Record<string, unknown>).position;
    const id = (item as Record<string, unknown>).id;

    if (
      typeof title !== "string" ||
      (checklist !== "yes" && checklist !== "no") ||
      (position !== undefined && (!Number.isInteger(position) || position <= 0)) ||
      (id !== undefined && (!Number.isInteger(id) || id <= 0))
    ) {
      throw new Error(
        `HRIS_CARD_CHECKLISTS_JSON item at index ${index} must contain title, checklist yes/no, and optional positive integer id/position.`,
      );
    }

    return {
      id: typeof id === "number" ? id : undefined,
      title,
      checklist,
      position: typeof position === "number" ? position : index + 1,
    };
  });
}

function parseProjectRouteRules(raw: string | undefined): Record<string, ProjectRouteRule[]> {
  if (!raw?.trim()) {
    return {};
  }

  const parsed = parseJsonEnv(raw, "PROJECT_ROUTE_RULES_JSON");
  const output: Record<string, ProjectRouteRule[]> = {};

  for (const [projectName, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) {
      throw new Error(`PROJECT_ROUTE_RULES_JSON entry for "${projectName}" must be an array.`);
    }

    output[projectName] = value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`PROJECT_ROUTE_RULES_JSON rule at ${projectName}[${index}] must be an object.`);
      }

      const match = (item as Record<string, unknown>).match;
      const path = (item as Record<string, unknown>).path;
      const url = (item as Record<string, unknown>).url;

      if (typeof match !== "string" || (!path && !url)) {
        throw new Error(
          `PROJECT_ROUTE_RULES_JSON rule at ${projectName}[${index}] must contain match and either path or url.`,
        );
      }

      if ((path !== undefined && typeof path !== "string") || (url !== undefined && typeof url !== "string")) {
        throw new Error(`PROJECT_ROUTE_RULES_JSON rule at ${projectName}[${index}] path/url must be strings.`);
      }

      return { match, path: path as string | undefined, url: url as string | undefined };
    });
  }

  return output;
}

function parseProjectWebAuth(raw: string | undefined): Record<string, ProjectWebAuthConfig> {
  if (!raw?.trim()) {
    return {};
  }

  const parsed = parseJsonEnv(raw, "PROJECT_WEB_AUTH_JSON");
  const output: Record<string, ProjectWebAuthConfig> = {};

  for (const [projectName, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`PROJECT_WEB_AUTH_JSON entry for "${projectName}" must be an object.`);
    }

    const entry = value as Record<string, unknown>;
    const loginUrl = entry.loginUrl;
    const loginPath = entry.loginPath;
    const email = entry.email;
    const password = entry.password;
    const emailSelector = entry.emailSelector;
    const passwordSelector = entry.passwordSelector;
    const submitSelector = entry.submitSelector;
    const postLoginWaitMs = entry.postLoginWaitMs;

    if ((!loginUrl && !loginPath) || typeof password !== "string" || !password.trim()) {
      throw new Error(
        `PROJECT_WEB_AUTH_JSON entry for "${projectName}" must contain password and either loginUrl or loginPath.`,
      );
    }

    if (
      (loginUrl !== undefined && typeof loginUrl !== "string") ||
      (loginPath !== undefined && typeof loginPath !== "string") ||
      (email !== undefined && typeof email !== "string") ||
      (emailSelector !== undefined && typeof emailSelector !== "string") ||
      (passwordSelector !== undefined && typeof passwordSelector !== "string") ||
      (submitSelector !== undefined && typeof submitSelector !== "string") ||
      (postLoginWaitMs !== undefined && (!Number.isInteger(postLoginWaitMs) || postLoginWaitMs < 0))
    ) {
      throw new Error(
        `PROJECT_WEB_AUTH_JSON entry for "${projectName}" contains invalid loginUrl/loginPath/email/selectors/postLoginWaitMs values.`,
      );
    }

    output[projectName] = {
      loginUrl: loginUrl as string | undefined,
      loginPath: loginPath as string | undefined,
      email: email as string | undefined,
      password: password as string,
      emailSelector: emailSelector as string | undefined,
      passwordSelector: passwordSelector as string | undefined,
      submitSelector: submitSelector as string | undefined,
      postLoginWaitMs: postLoginWaitMs as number | undefined,
    };
  }

  return output;
}

function normalizeAliasKey(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function parseProjectAliases(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) {
    return {};
  }

  const parsed = parseJsonEnv(raw, "PROJECT_ALIASES_JSON");
  const output: Record<string, string> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`PROJECT_ALIASES_JSON value for "${key}" must be a non-empty string.`);
    }

    output[normalizeAliasKey(key)] = value.trim();
  }

  return output;
}

export function loadConfig(): AppConfig {
  const projectRepos = parseListEnv(process.env.PROJECT_REPOS).map((item) => path.resolve(item));
  const projectBaseDirs = parseListEnv(process.env.PROJECTS_BASE_DIRS).map((item) => path.resolve(item));
  const discoveryIgnoreNames = parseListEnv(process.env.DISCOVERY_IGNORE_NAMES);

  return {
    groqApiKey: process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined,
    groqBaseUrl:
      process.env.GROQ_BASE_URL?.trim() ||
      process.env.OPENAI_BASE_URL?.trim() ||
      "https://api.groq.com/openai/v1",
    groqModel:
      process.env.GROQ_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "openai/gpt-oss-20b",
    projectRepos,
    projectBaseDirs,
    discoveryIgnoreNames:
      discoveryIgnoreNames.length > 0
        ? discoveryIgnoreNames
        : [".git", "node_modules", "dist", "build", ".next", ".turbo"],
    projectPreviewUrls: toStringRecord(
      parseJsonEnv(process.env.PROJECT_PREVIEW_URLS_JSON, "PROJECT_PREVIEW_URLS_JSON"),
      "PROJECT_PREVIEW_URLS_JSON",
    ),
    projectRunCommands: toStringRecord(
      parseJsonEnv(process.env.PROJECT_RUN_COMMANDS_JSON, "PROJECT_RUN_COMMANDS_JSON"),
      "PROJECT_RUN_COMMANDS_JSON",
    ),
    projectRouteRules: parseProjectRouteRules(process.env.PROJECT_ROUTE_RULES_JSON),
    projectWebAuth: parseProjectWebAuth(process.env.PROJECT_WEB_AUTH_JSON),
    projectAliases: parseProjectAliases(process.env.PROJECT_ALIASES_JSON),
    hrisLoginUrl: process.env.HRIS_LOGIN_URL?.trim() || undefined,
    hrisCardsUrl: process.env.HRIS_CARDS_URL?.trim() || process.env.HRIS_API_URL?.trim() || undefined,
    hrisApiMethod: parseHrisMethod(process.env.HRIS_API_METHOD),
    hrisEmail: process.env.HRIS_EMAIL?.trim() || undefined,
    hrisPassword: process.env.HRIS_PASSWORD?.trim() || undefined,
    hrisListId: parseOptionalPositiveInteger(process.env.HRIS_LIST_ID),
    hrisBoardId: parseOptionalPositiveInteger(process.env.HRIS_BOARD_ID),
    hrisBoardListsUrl: process.env.HRIS_BOARD_LISTS_URL?.trim() || undefined,
    hrisCardLimit: Math.max(1, parseNumberEnv(process.env.HRIS_CARD_LIMIT, 50)),
    hrisApiToken: process.env.HRIS_API_TOKEN?.trim() || undefined,
    hrisAuthHeader: process.env.HRIS_AUTH_HEADER?.trim() || "Authorization",
    hrisTokenPrefix: process.env.HRIS_TOKEN_PREFIX?.trim() || "Bearer",
    hrisHeaders: toStringRecord(
      parseJsonEnv(process.env.HRIS_API_HEADERS_JSON, "HRIS_API_HEADERS_JSON"),
      "HRIS_API_HEADERS_JSON",
    ),
    hrisPayloadStatic: parseJsonEnv(process.env.HRIS_PAYLOAD_STATIC_JSON, "HRIS_PAYLOAD_STATIC_JSON"),
    hrisCardChecklists: parseChecklistTemplates(process.env.HRIS_CARD_CHECKLISTS_JSON),
    hrisSendDescription: parseBooleanEnv(process.env.HRIS_SEND_DESCRIPTION, true),
    hrisSendEvidence: parseBooleanEnv(process.env.HRIS_SEND_EVIDENCE, true),
    hrisEvidenceMode: parseEvidenceMode(process.env.HRIS_EVIDENCE_MODE),
    hrisEvidenceDir: process.env.HRIS_EVIDENCE_DIR?.trim() || "./reports/evidence",
    hrisBrowserPath: process.env.HRIS_BROWSER_PATH?.trim() || undefined,
    hrisDevServerWaitMs: Math.max(1000, parseNumberEnv(process.env.HRIS_DEV_SERVER_WAIT_MS, 12000)),
    hrisEmployeeId: process.env.HRIS_EMPLOYEE_ID?.trim() || undefined,
    outputDir: process.env.OUTPUT_DIR?.trim() || "./reports",
    maxCommitsPerRepo: Math.max(1, parseNumberEnv(process.env.MAX_COMMITS_PER_REPO, 15)),
    maxFilesPerRepo: Math.max(1, parseNumberEnv(process.env.MAX_FILES_PER_REPO, 30)),
    scheduleTime: process.env.SCHEDULE_TIME?.trim() || undefined,
    scheduleRunOnStart: parseBooleanEnv(process.env.SCHEDULE_RUN_ON_START, true),
  };
}

export function assertAnalyzeConfig(config: AppConfig): void {
  if (!config.groqApiKey) {
    throw new Error("GROQ_API_KEY is required for analyze/send/run/schedule commands.");
  }
}

export function assertSendConfig(config: AppConfig): void {
  if (!config.hrisCardsUrl) {
    throw new Error("HRIS_CARDS_URL is required for send/run/schedule commands.");
  }

  if (!config.hrisListId && !config.hrisBoardId) {
    throw new Error("Set HRIS_LIST_ID or HRIS_BOARD_ID for send/run/schedule commands.");
  }

  if (!config.hrisApiToken && (!config.hrisLoginUrl || !config.hrisEmail || !config.hrisPassword)) {
    throw new Error(
      "Set HRIS_API_TOKEN or provide HRIS_LOGIN_URL, HRIS_EMAIL, and HRIS_PASSWORD for send/run/schedule commands.",
    );
  }
}

export function assertScheduleConfig(config: AppConfig): void {
  if (!config.scheduleTime) {
    throw new Error("SCHEDULE_TIME is required for the schedule command.");
  }
}
