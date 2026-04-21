import fs from "node:fs";
import path from "node:path";

let projectEnvLoaded = false;

function getEnvCandidatePaths(): string[] {
  return Array.from(
    new Set([
      path.resolve(process.cwd(), ".env"),
      path.resolve(import.meta.dir, "../../.env"),
    ]),
  );
}

function normalizeEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseEnvFile(filePath: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const rawValue = normalizedLine.slice(separatorIndex + 1);
    parsed[key] = normalizeEnvValue(rawValue);
  }

  return parsed;
}

export function readProjectEnv(name: string): string | undefined {
  const currentValue = process.env[name]?.trim();
  if (currentValue) {
    return currentValue;
  }

  for (const filePath of getEnvCandidatePaths()) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const parsed = parseEnvFile(filePath);
    const value = parsed[name]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function loadProjectEnv(): void {
  if (projectEnvLoaded) {
    return;
  }

  projectEnvLoaded = true;

  for (const filePath of getEnvCandidatePaths()) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const parsed = parseEnvFile(filePath);
    for (const [key, value] of Object.entries(parsed)) {
      const currentValue = process.env[key]?.trim();
      if (currentValue) {
        continue;
      }

      process.env[key] = value;
    }

    return;
  }
}
