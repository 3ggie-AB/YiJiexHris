import type { AppConfig } from "../types";
import { loadConfig } from "../config";
import { parseListEnv } from "../utils/env";
import { readProjectEnv } from "../utils/load-project-env";

export interface WebDashboardConfig {
  appBaseUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  githubTimezone: string;
  githubTimezoneOffset: string;
  githubDefaultRepositories: string[];
  appConfig: AppConfig;
}

function requireEnv(name: string): string {
  const value = readProjectEnv(name);
  if (!value) {
    throw new Error(`${name} is required for the web dashboard.`);
  }

  return value;
}

export function loadWebDashboardConfig(): WebDashboardConfig {
  return {
    appBaseUrl: requireEnv("APP_BASE_URL"),
    githubClientId: requireEnv("GITHUB_CLIENT_ID"),
    githubClientSecret: requireEnv("GITHUB_CLIENT_SECRET"),
    githubTimezone: readProjectEnv("GITHUB_TIMEZONE") || "Asia/Jakarta",
    githubTimezoneOffset: readProjectEnv("GITHUB_TIMEZONE_OFFSET") || "+07:00",
    githubDefaultRepositories: parseListEnv(readProjectEnv("GITHUB_DEFAULT_REPOSITORIES")),
    appConfig: loadConfig(),
  };
}
