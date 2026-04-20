import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AiAnalysisReport,
  AnalysisPackage,
  AnalysisPackageManifest,
  AppConfig,
  CollectedActivity,
  PreparedHrisCard,
} from "../types";

const PACKAGE_ROOT_DIR = "packages";
const MANIFEST_FILE = "manifest.json";
const COLLECTION_FILE = "collection.json";
const ANALYSIS_FILE = "analysis.json";
const CARDS_FILE = "cards.json";

function randomCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function buildPackageCode(date = new Date()): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${randomCode()}`;
}

function buildManifest(
  packageCode: string,
  createdAt: string,
  reportDate: string,
  cards: PreparedHrisCard[],
): AnalysisPackageManifest {
  const activeActivityCount = cards.filter((card) => !card.deleted).length;
  return {
    version: 1,
    packageCode,
    createdAt,
    reportDate,
    activityCount: cards.length,
    activeActivityCount,
    deletedActivityCount: cards.length - activeActivityCount,
  };
}

function withActiveActivities(report: AiAnalysisReport, cards: PreparedHrisCard[]): AiAnalysisReport {
  return {
    ...report,
    activities: cards.filter((card) => !card.deleted).map((card) => card.activity),
  };
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await Bun.write(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath);
    return true;
  } catch {
    return false;
  }
}

export function getAnalysisPackageRoot(outputDir: string | undefined): string {
  return path.resolve(outputDir || "./reports", PACKAGE_ROOT_DIR);
}

export function resolvePackageDirectory(
  config: Pick<AppConfig, "outputDir">,
  options: { packageCode?: string; packagePath?: string },
): string {
  if (options.packagePath) {
    return path.resolve(options.packagePath);
  }

  if (options.packageCode) {
    return path.join(getAnalysisPackageRoot(config.outputDir), options.packageCode);
  }

  throw new Error("Package reference is required. Use --code <kode> or --package <folder>.");
}

export async function writeAnalysisPackage(
  config: Pick<AppConfig, "outputDir">,
  collection: CollectedActivity,
  report: AiAnalysisReport,
  cards: PreparedHrisCard[],
): Promise<AnalysisPackage> {
  const createdAt = new Date().toISOString();
  const packageCode = buildPackageCode(new Date(createdAt));
  const packageDir = path.join(getAnalysisPackageRoot(config.outputDir), packageCode);
  const normalizedReport = withActiveActivities(report, cards);
  const manifest = buildManifest(packageCode, createdAt, normalizedReport.reportDate, cards);

  await mkdir(packageDir, { recursive: true });
  await Promise.all([
    writeJsonFile(path.join(packageDir, MANIFEST_FILE), manifest),
    writeJsonFile(path.join(packageDir, COLLECTION_FILE), collection),
    writeJsonFile(path.join(packageDir, ANALYSIS_FILE), normalizedReport),
    writeJsonFile(path.join(packageDir, CARDS_FILE), cards),
  ]);

  return {
    packageDir,
    manifest,
    collection,
    report: normalizedReport,
    cards,
  };
}

export async function loadAnalysisPackage(
  config: Pick<AppConfig, "outputDir">,
  options: { packageCode?: string; packagePath?: string },
): Promise<AnalysisPackage> {
  const packageDir = resolvePackageDirectory(config, options);
  if (!(await directoryExists(packageDir))) {
    throw new Error(`Package tidak ditemukan: ${packageDir}`);
  }

  const [manifest, collection, report, cards] = await Promise.all([
    readJsonFile<AnalysisPackageManifest>(path.join(packageDir, MANIFEST_FILE)),
    readJsonFile<CollectedActivity>(path.join(packageDir, COLLECTION_FILE)),
    readJsonFile<AiAnalysisReport>(path.join(packageDir, ANALYSIS_FILE)),
    readJsonFile<PreparedHrisCard[]>(path.join(packageDir, CARDS_FILE)),
  ]);

  return {
    packageDir,
    manifest,
    collection,
    report,
    cards,
  };
}

export async function saveAnalysisPackage(pkg: AnalysisPackage): Promise<AnalysisPackage> {
  const normalizedReport = withActiveActivities(pkg.report, pkg.cards);
  const manifest = buildManifest(
    pkg.manifest.packageCode,
    pkg.manifest.createdAt,
    normalizedReport.reportDate,
    pkg.cards,
  );

  await Promise.all([
    writeJsonFile(path.join(pkg.packageDir, MANIFEST_FILE), manifest),
    writeJsonFile(path.join(pkg.packageDir, COLLECTION_FILE), pkg.collection),
    writeJsonFile(path.join(pkg.packageDir, ANALYSIS_FILE), normalizedReport),
    writeJsonFile(path.join(pkg.packageDir, CARDS_FILE), pkg.cards),
  ]);

  return {
    ...pkg,
    manifest,
    report: normalizedReport,
  };
}

function matchCardIds(cards: PreparedHrisCard[], selectors: string[]): Set<string> {
  const output = new Set<string>();
  const activeCards = cards.filter((card) => !card.deleted);
  const idLookup = new Map(cards.map((card) => [card.id.toLowerCase(), card.id]));

  for (const selector of selectors.map((item) => item.trim()).filter(Boolean)) {
    if (/^\d+$/.test(selector)) {
      const index = Number(selector);
      const matched = activeCards[index - 1];
      if (!matched) {
        throw new Error(`Activity index ${selector} tidak ditemukan pada daftar aktif.`);
      }

      output.add(matched.id);
      continue;
    }

    const normalized = selector.toLowerCase();
    const matchedId = idLookup.get(normalized);
    if (!matchedId) {
      throw new Error(`Activity "${selector}" tidak ditemukan. Gunakan id seperti ACT-001 atau nomor urut aktif.`);
    }

    output.add(matchedId);
  }

  return output;
}

export async function deletePackageActivities(
  config: Pick<AppConfig, "outputDir">,
  options: { packageCode?: string; packagePath?: string; selectors: string[]; reason?: string },
): Promise<AnalysisPackage> {
  if (options.selectors.length === 0) {
    throw new Error("Minimal satu activity selector dibutuhkan untuk delete-activity.");
  }

  const pkg = await loadAnalysisPackage(config, options);
  const targetIds = matchCardIds(pkg.cards, options.selectors);
  const deletedAt = new Date().toISOString();

  const cards = pkg.cards.map((card) =>
    targetIds.has(card.id)
      ? {
          ...card,
          deleted: true,
          deletedAt,
          deletedReason: options.reason || "deleted-from-terminal",
        }
      : card,
  );

  return saveAnalysisPackage({
    ...pkg,
    cards,
  });
}

export function listActivePackageCards(cards: PreparedHrisCard[]): PreparedHrisCard[] {
  return cards.filter((card) => !card.deleted);
}
