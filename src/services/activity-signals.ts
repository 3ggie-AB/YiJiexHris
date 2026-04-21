import type { RepoActivity, RepoFileChangeStat } from "../types";

type ProjectLabelTarget = Pick<RepoActivity, "name" | "displayName">;

interface BuildFileActivityOptions {
  gitStatuses?: string[];
}

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

      if (/^(api|uuid|pdf|ui|ux|id|otp|sql|db|hris|lsp|ppdb|erp)$/i.test(word)) {
        return word.toUpperCase();
      }

      if (/^xendit$/i.test(word)) {
        return "Xendit";
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

function toActivityObjectCase(raw: string): string {
  return raw.replace(/[A-Za-z0-9]+/g, (word) => {
    if (/^\d+$/.test(word) || /^[A-Z0-9]{2,}$/.test(word)) {
      return word;
    }

    if (/^(api|uuid|pdf|ui|ux|id|otp|sql|db|hris|lsp|ppdb|erp)$/i.test(word)) {
      return word.toUpperCase();
    }

    if (/^xendit$/i.test(word)) {
      return "Xendit";
    }

    return word.toLowerCase();
  });
}

function cleanupRoleLabel(rawLabel: string, role: string): string {
  const original = rawLabel.replace(/\s+/g, " ").trim();
  if (!original) {
    return original;
  }

  let label = original;

  if (["handler", "controller", "service", "repository", "route"].includes(role)) {
    label = label.replace(/^(Get|Post|Put|Patch|Delete|Create|Update|Set|Index|List|Show|Detail|Data)\s+/i, "");
    if (/\bPer\b/i.test(label)) {
      label = label.replace(/^Group\s+/i, "");
    }
    label = label.replace(/^Customer\s+(Income\b)/i, "$1");
  }

  return label.trim() || original;
}

function usesCreateVerb(gitStatuses: string[] | undefined): boolean {
  return (gitStatuses ?? []).some((status) => {
    const normalized = status.trim().toUpperCase()[0];
    return normalized === "A" || normalized === "C";
  });
}

export function buildFileActivity(
  repo: ProjectLabelTarget,
  filePath: string,
  options: BuildFileActivityOptions = {},
): string | undefined {
  const normalized = normalizeFilePath(filePath);
  if (!normalized || isLowSignalPath(normalized)) {
    return undefined;
  }

  const lower = normalized.toLowerCase();
  const parts = normalized.split("/");
  const fileName = parts.at(-1) ?? normalized;
  const stem = fileName.replace(/(\.blade)?\.[^.]+$/gi, "");
  const fileVerb = usesCreateVerb(options.gitStatuses) ? "Menambahkan" : "Memperbarui";

  if (/(^|\/)database\/migrations?\//i.test(lower) || /(^|\/)migrations?\//i.test(lower)) {
    const migrationName = stem.replace(/^\d{4}_\d{2}_\d{2}_\d{6}_/, "");
    const label = toTitleWords(migrationName);
    return label ? `${getProjectLabel(repo)} : Menambahkan Migrasi ${label}` : undefined;
  }

  if (/\.blade\.php$/i.test(lower) || /(^|\/)views?\//i.test(lower)) {
    const label = toActivityObjectCase(buildViewLabel(parts));
    return label ? `${getProjectLabel(repo)} : ${fileVerb} tampilan ${label}` : undefined;
  }

  if (/(^|\/)controllers?\//i.test(lower) || /controller/i.test(fileName)) {
    const label = toActivityObjectCase(cleanupRoleLabel(stripTrailingKeyword(toTitleWords(stem), "Controller"), "controller"));
    return label ? `${getProjectLabel(repo)} : ${fileVerb} controller ${label}` : undefined;
  }

  if (/(^|\/)handlers?\//i.test(lower) || /handler/i.test(fileName)) {
    const label = toActivityObjectCase(cleanupRoleLabel(stripTrailingKeyword(toTitleWords(stem), "Handler"), "handler"));
    return label ? `${getProjectLabel(repo)} : ${fileVerb} handler ${label}` : undefined;
  }

  if (/(^|\/)services?\//i.test(lower) || /service/i.test(fileName)) {
    const label = toActivityObjectCase(cleanupRoleLabel(stripTrailingKeyword(toTitleWords(stem), "Service"), "service"));
    return label ? `${getProjectLabel(repo)} : ${fileVerb} service ${label}` : undefined;
  }

  if (/(^|\/)models?\//i.test(lower) || /model/i.test(fileName)) {
    const label = toActivityObjectCase(stripTrailingKeyword(toTitleWords(stem), "Model"));
    return label ? `${getProjectLabel(repo)} : ${fileVerb} model ${label}` : undefined;
  }

  if (/(^|\/)helpers?\//i.test(lower) || /helper/i.test(fileName)) {
    const label = toActivityObjectCase(stripTrailingKeyword(toTitleWords(stem), "Helper"));
    return label ? `${getProjectLabel(repo)} : Menyesuaikan helper ${label}` : undefined;
  }

  if (/(^|\/)routes?\//i.test(lower)) {
    const label = toActivityObjectCase(cleanupRoleLabel(toTitleWords(stem), "route"));
    return label ? `${getProjectLabel(repo)} : Menyesuaikan route ${label}` : undefined;
  }

  if (/(^|\/)config\//i.test(lower)) {
    const label = toActivityObjectCase(toTitleWords(stem));
    return label ? `${getProjectLabel(repo)} : Menyesuaikan konfigurasi ${label}` : undefined;
  }

  if (/(^|\/)repositories?\//i.test(lower) || /repo/i.test(fileName)) {
    const label = toActivityObjectCase(cleanupRoleLabel(stripTrailingKeyword(toTitleWords(stem), "Repo"), "repository"));
    return label ? `${getProjectLabel(repo)} : ${fileVerb} repository ${label}` : undefined;
  }

  if (/\.(js|ts|tsx)$/i.test(lower) && /(^|\/)public\//i.test(lower)) {
    const label = toActivityObjectCase(toTitleWords(stem));
    return label ? `${getProjectLabel(repo)} : ${fileVerb} script browser ${label}` : undefined;
  }

  const fallback = toActivityObjectCase(toTitleWords(stem));
  return fallback ? `${getProjectLabel(repo)} : ${fileVerb} ${fallback}` : undefined;
}

export function normalizeActivityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
