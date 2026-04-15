import type { CollectedActivity, RepoActivity } from "../types";

const GENERIC_VIEW_NAMES = new Set(["index", "create", "edit", "show", "list", "form", "preview", "detail"]);
const LOW_SIGNAL_FILE_NAMES = new Set([
  ".env",
  "env",
  ".env.example",
  "env.example",
  ".gitignore",
  "gitignore",
  ".gitattributes",
  "gitattributes",
  "composer.json",
  "composer.lock",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "tsconfig.json",
  "readme.md",
  "license",
]);
const LOW_SIGNAL_PATH_PARTS = [
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "reports",
  "logs",
  "public/bukti",
];

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function toTitleWords(raw: string): string {
  const normalized = raw
    .replace(/(\.blade)?\.[^.]+$/gi, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/[.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/^\d+$/.test(word) || /^[A-Z]{2,}$/.test(word)) {
        return word;
      }

      if (/^(api|uuid|pdf|ui|ux|id|otp|sql|db)$/i.test(word)) {
        return word.toUpperCase();
      }

      return `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function stripTrailingKeyword(value: string, keyword: string): string {
  return value.replace(new RegExp(`\\b${keyword}\\b$`, "i"), "").replace(/\s+/g, " ").trim();
}

function isLowSignalPath(filePath: string): boolean {
  const normalized = normalizeFilePath(filePath);
  const lower = normalized.toLowerCase();
  const baseName = (normalized.split("/").at(-1) ?? normalized).toLowerCase();

  if (!normalized) {
    return true;
  }

  if (LOW_SIGNAL_FILE_NAMES.has(baseName)) {
    return true;
  }

  if (LOW_SIGNAL_PATH_PARTS.some((part) => lower === part || lower.startsWith(`${part}/`) || lower.includes(`/${part}/`))) {
    return true;
  }

  return /\.(png|jpe?g|gif|svg|ico|pdf|docx|xlsx|zip|rar|mp3|mp4|mov)$/i.test(lower);
}

function buildViewLabel(parts: string[]): string {
  const fileName = parts.at(-1) ?? "";
  const stem = fileName.replace(/(\.blade)?\.[^.]+$/gi, "");
  const parent = parts.at(-2) ?? "";
  const cleanStem = stem.replace(/^_+/, "");

  if (GENERIC_VIEW_NAMES.has(cleanStem.toLowerCase()) && parent) {
    return toTitleWords(`${parent} ${cleanStem}`);
  }

  return toTitleWords(parent && stem.startsWith("_") ? `${parent} ${cleanStem}` : cleanStem);
}

function buildFileActivity(repo: RepoActivity, filePath: string): string | undefined {
  const normalized = normalizeFilePath(filePath);
  if (!normalized || isLowSignalPath(normalized)) {
    return undefined;
  }

  const lower = normalized.toLowerCase();
  const parts = normalized.split("/");
  const fileName = parts.at(-1) ?? normalized;
  const stem = fileName.replace(/(\.blade)?\.[^.]+$/gi, "");

  if (/(^|\/)database\/migrations?\//i.test(lower) || /(^|\/)migrations?\//i.test(lower)) {
    const migrationName = stem.replace(/^\d{4}_\d{2}_\d{2}_\d{6}_/, "");
    const label = toTitleWords(migrationName);
    return label ? `${repo.name} : Menambahkan Migrasi ${label}` : undefined;
  }

  if (/\.blade\.php$/i.test(lower) || /(^|\/)views?\//i.test(lower)) {
    const label = buildViewLabel(parts);
    return label ? `${repo.name} : Memperbarui View ${label}` : undefined;
  }

  if (/(^|\/)controllers?\//i.test(lower) || /controller/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Controller");
    return label ? `${repo.name} : Memperbarui Controller ${label}` : undefined;
  }

  if (/(^|\/)handlers?\//i.test(lower) || /handler/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Handler");
    return label ? `${repo.name} : Memperbarui Handler ${label}` : undefined;
  }

  if (/(^|\/)services?\//i.test(lower) || /service/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Service");
    return label ? `${repo.name} : Memperbarui Service ${label}` : undefined;
  }

  if (/(^|\/)models?\//i.test(lower) || /model/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Model");
    return label ? `${repo.name} : Memperbarui Model ${label}` : undefined;
  }

  if (/(^|\/)helpers?\//i.test(lower) || /helper/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Helper");
    return label ? `${repo.name} : Menyesuaikan Helper ${label}` : undefined;
  }

  if (/(^|\/)routes?\//i.test(lower)) {
    const label = toTitleWords(stem);
    return label ? `${repo.name} : Menyesuaikan Route ${label}` : undefined;
  }

  const fallback = toTitleWords(stem);
  return fallback ? `${repo.name} : Memperbarui ${fallback}` : undefined;
}

function normalizeActivityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function countSignalFiles(collection: CollectedActivity): number {
  const output = new Set<string>();

  for (const repo of collection.repositories) {
    for (const filePath of repo.committedFilesToday) {
      const normalized = normalizeFilePath(filePath);
      if (!isLowSignalPath(normalized)) {
        output.add(`${repo.name}:${normalized}`);
      }
    }

    for (const file of repo.workingTreeFiles) {
      const normalized = normalizeFilePath(file.path);
      if (!isLowSignalPath(normalized)) {
        output.add(`${repo.name}:${normalized}`);
      }
    }

    for (const file of repo.fileChangeStats) {
      const normalized = normalizeFilePath(file.path);
      if (!isLowSignalPath(normalized)) {
        output.add(`${repo.name}:${normalized}`);
      }
    }
  }

  return output.size;
}

function estimateTargetActivityCount(collection: CollectedActivity, limit: number): number {
  const signalFiles = countSignalFiles(collection);
  const commitBoost = Math.min(collection.metrics.totalCommits, 4);
  const projectBoost = Math.max(0, Math.min(collection.metrics.activeProjectCount - 1, 2));
  return Math.min(limit, Math.max(1, Math.ceil(signalFiles / 3) + commitBoost + projectBoost));
}

function buildSupplementalActivities(collection: CollectedActivity): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const repo of collection.repositories) {
    const orderedPaths = Array.from(
      new Set([
        ...repo.fileChangeStats.map((file) => normalizeFilePath(file.path)),
        ...repo.committedFilesToday.map((filePath) => normalizeFilePath(filePath)),
        ...repo.workingTreeFiles.map((file) => normalizeFilePath(file.path)),
      ]),
    );
    const signalCount = orderedPaths.filter((filePath) => !isLowSignalPath(filePath)).length;
    const maxPerRepo = Math.max(2, Math.min(6, Math.ceil(signalCount / 3) + Math.min(repo.commitsToday.length, 2)));

    for (const filePath of orderedPaths) {
      const candidate = buildFileActivity(repo, filePath);
      if (!candidate) {
        continue;
      }

      const key = normalizeActivityKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      output.push(candidate);

      if (output.filter((item) => item.startsWith(`${repo.name} : `)).length >= maxPerRepo) {
        break;
      }
    }
  }

  return output;
}

export function expandReportActivities(aiActivities: string[], collection: CollectedActivity, limit: number): string[] {
  const normalizedBaseActivities = aiActivities.map((item) => item.trim()).filter(Boolean);
  const targetCount = Math.min(limit, Math.max(normalizedBaseActivities.length, estimateTargetActivityCount(collection, limit)));

  if (normalizedBaseActivities.length >= targetCount) {
    return normalizedBaseActivities.slice(0, limit);
  }

  const output: string[] = [];
  const seen = new Set<string>();

  for (const activity of normalizedBaseActivities) {
    const key = normalizeActivityKey(activity);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(activity);
    }
  }

  for (const candidate of buildSupplementalActivities(collection)) {
    const key = normalizeActivityKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(candidate);

    if (output.length >= targetCount) {
      break;
    }
  }

  return output.slice(0, targetCount);
}
