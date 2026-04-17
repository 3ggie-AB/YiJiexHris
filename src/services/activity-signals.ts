import type { RepoActivity, RepoFileChangeStat } from "../types";

type ProjectLabelTarget = Pick<RepoActivity, "name" | "displayName">;

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

export function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function getProjectLabel(repo: ProjectLabelTarget): string {
  return repo.displayName || repo.name;
}

export function toTitleWords(raw: string): string {
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

export function isLowSignalPath(filePath: string): boolean {
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

  if (/\.(md|txt|png|jpe?g|gif|svg|ico|pdf|docx|xlsx|zip|rar|mp3|mp4|mov)$/i.test(lower)) {
    return true;
  }

  return false;
}

export function isMeaningfulFileChange(file: RepoFileChangeStat, minChangeCount: number): boolean {
  return !isLowSignalPath(file.path) && file.changeCount >= minChangeCount;
}

export function describeFileRole(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  const lower = normalized.toLowerCase();
  const fileName = normalized.split("/").at(-1) ?? normalized;

  if (/(^|\/)database\/migrations?\//i.test(lower) || /(^|\/)migrations?\//i.test(lower)) {
    return "migration";
  }

  if (/\.blade\.php$/i.test(lower) || /(^|\/)views?\//i.test(lower)) {
    return "view";
  }

  if (/(^|\/)controllers?\//i.test(lower) || /controller/i.test(fileName)) {
    return "controller";
  }

  if (/(^|\/)handlers?\//i.test(lower) || /handler/i.test(fileName)) {
    return "handler";
  }

  if (/(^|\/)services?\//i.test(lower) || /service/i.test(fileName)) {
    return "service";
  }

  if (/(^|\/)models?\//i.test(lower) || /model/i.test(fileName)) {
    return "model";
  }

  if (/(^|\/)helpers?\//i.test(lower) || /helper/i.test(fileName)) {
    return "helper";
  }

  if (/(^|\/)routes?\//i.test(lower)) {
    return "route";
  }

  if (/(^|\/)tests?\//i.test(lower) || /\.test\./i.test(fileName)) {
    return "test";
  }

  if (/(^|\/)config\//i.test(lower)) {
    return "config";
  }

  if (/(^|\/)repositories?\//i.test(lower) || /repo/i.test(fileName)) {
    return "repository";
  }

  if (/\.(js|ts|tsx)$/i.test(lower) && /(^|\/)public\//i.test(lower)) {
    return "browser-script";
  }

  return "code";
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

export function buildFileActivity(repo: ProjectLabelTarget, filePath: string): string | undefined {
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
    return label ? `${getProjectLabel(repo)} : Menambahkan Migrasi ${label}` : undefined;
  }

  if (/\.blade\.php$/i.test(lower) || /(^|\/)views?\//i.test(lower)) {
    const label = buildViewLabel(parts);
    return label ? `${getProjectLabel(repo)} : Memperbarui View ${label}` : undefined;
  }

  if (/(^|\/)controllers?\//i.test(lower) || /controller/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Controller");
    return label ? `${getProjectLabel(repo)} : Memperbarui Controller ${label}` : undefined;
  }

  if (/(^|\/)handlers?\//i.test(lower) || /handler/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Handler");
    return label ? `${getProjectLabel(repo)} : Memperbarui Handler ${label}` : undefined;
  }

  if (/(^|\/)services?\//i.test(lower) || /service/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Service");
    return label ? `${getProjectLabel(repo)} : Memperbarui Service ${label}` : undefined;
  }

  if (/(^|\/)models?\//i.test(lower) || /model/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Model");
    return label ? `${getProjectLabel(repo)} : Memperbarui Model ${label}` : undefined;
  }

  if (/(^|\/)helpers?\//i.test(lower) || /helper/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Helper");
    return label ? `${getProjectLabel(repo)} : Menyesuaikan Helper ${label}` : undefined;
  }

  if (/(^|\/)routes?\//i.test(lower)) {
    const label = toTitleWords(stem);
    return label ? `${getProjectLabel(repo)} : Menyesuaikan Route ${label}` : undefined;
  }

  if (/(^|\/)config\//i.test(lower)) {
    const label = toTitleWords(stem);
    return label ? `${getProjectLabel(repo)} : Menyesuaikan Konfigurasi ${label}` : undefined;
  }

  if (/(^|\/)repositories?\//i.test(lower) || /repo/i.test(fileName)) {
    const label = stripTrailingKeyword(toTitleWords(stem), "Repo");
    return label ? `${getProjectLabel(repo)} : Memperbarui Repository ${label}` : undefined;
  }

  if (/\.(js|ts|tsx)$/i.test(lower) && /(^|\/)public\//i.test(lower)) {
    const label = toTitleWords(stem);
    return label ? `${getProjectLabel(repo)} : Memperbarui Script Browser ${label}` : undefined;
  }

  const fallback = toTitleWords(stem);
  return fallback ? `${getProjectLabel(repo)} : Memperbarui ${fallback}` : undefined;
}

export function normalizeActivityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
