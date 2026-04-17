import type {
  AiAnalysisReport,
  AppConfig,
  CollectedActivity,
  ProjectInsight,
  RepoActivity,
  RepoCommitDetail,
  RepoFileChangeStat,
} from "../types";
import { extractFirstJsonObject, extractOutputText } from "../utils/responses";
import { expandReportActivities } from "./activity-expander";
import {
  buildFileActivity,
  describeFileRole,
  getProjectLabel,
  isMeaningfulFileChange,
  normalizeActivityKey,
  normalizeFilePath,
} from "./activity-signals";

type ConfidenceLevel = "low" | "medium" | "high";

interface AnalysisSignalFile extends RepoFileChangeStat {
  normalizedPath: string;
  role: string;
}

interface AnalysisUnit {
  id: string;
  project: string;
  projectKey: string;
  sourceType: "commit" | "working_tree";
  sourceLabel: string;
  sourceSummary: string;
  committedAt?: string;
  signalFiles: AnalysisSignalFile[];
  ignoredFiles: string[];
  totalChangeCount: number;
}

interface UnitAnalysisTask {
  title: string;
  summary: string;
  confidence: ConfidenceLevel;
}

interface UnitAnalysisResult {
  unitId: string;
  project: string;
  summary: string;
  confidence: ConfidenceLevel;
  skipReason: string;
  tasks: UnitAnalysisTask[];
}

interface CandidateActivity {
  title: string;
  summary: string;
  confidence: ConfidenceLevel;
  project: string;
  unitId: string;
  totalChangeCount: number;
}

const ACTIVITY_STOP_WORDS = new Set([
  "yang",
  "dan",
  "untuk",
  "pada",
  "dengan",
  "serta",
  "the",
  "and",
  "for",
  "api",
  "project",
  "handler",
  "view",
  "controller",
  "service",
]);

function buildAnalysisSchema(activityLimit: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "productivityScore",
      "overallSummary",
      "focusAreas",
      "achievements",
      "blockers",
      "improvements",
      "nextPriorities",
      "activities",
      "confidence",
      "projectInsights",
    ],
    properties: {
      productivityScore: {
        type: "integer",
        minimum: 0,
        maximum: 100,
      },
      overallSummary: {
        type: "string",
      },
      focusAreas: {
        type: "array",
        items: { type: "string" },
      },
      achievements: {
        type: "array",
        items: { type: "string" },
      },
      blockers: {
        type: "array",
        items: { type: "string" },
      },
      improvements: {
        type: "array",
        items: { type: "string" },
      },
      nextPriorities: {
        type: "array",
        items: { type: "string" },
      },
      activities: {
        type: "array",
        maxItems: activityLimit,
        items: { type: "string" },
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      projectInsights: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["project", "status", "summary", "commitCount", "changedFilesCount"],
          properties: {
            project: { type: "string" },
            status: {
              type: "string",
              enum: ["active", "maintenance", "idle", "blocked"],
            },
            summary: { type: "string" },
            commitCount: {
              type: "integer",
              minimum: 0,
            },
            changedFilesCount: {
              type: "integer",
              minimum: 0,
            },
          },
        },
      },
    },
  } as const;
}

function buildUnitAnalysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "confidence", "skipReason", "tasks"],
    properties: {
      summary: {
        type: "string",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      skipReason: {
        type: "string",
      },
      tasks: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "summary", "confidence"],
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
          },
        },
      },
    },
  } as const;
}

function limitStrings(items: string[] | undefined, max: number): string[] {
  return (items ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function limitProjectInsights(items: ProjectInsight[] | undefined, max: number): ProjectInsight[] {
  return (items ?? [])
    .filter((item) => item && typeof item.project === "string" && typeof item.summary === "string")
    .slice(0, max);
}

function touchedFileCount(repo: RepoActivity): number {
  return new Set([
    ...repo.committedFilesToday,
    ...repo.workingTreeFiles.map((file) => file.path),
    ...repo.fileChangeStats.map((file) => file.path),
  ]).size;
}

function normalizeProjectInsights(
  projectInsights: ProjectInsight[],
  collection: CollectedActivity,
  units: AnalysisUnit[],
): ProjectInsight[] {
  const lookup = new Map<string, RepoActivity>();
  const signalUnitCountByProject = new Map<string, number>();

  for (const repo of collection.repositories) {
    lookup.set(repo.name, repo);
    if (repo.displayName) {
      lookup.set(repo.displayName, repo);
    }
  }

  for (const unit of units) {
    signalUnitCountByProject.set(unit.project, (signalUnitCountByProject.get(unit.project) ?? 0) + 1);
  }

  return projectInsights.map((item) => {
    const repo = lookup.get(item.project);
    if (!repo) {
      return item;
    }

    const projectLabel = getProjectLabel(repo);
    const signalUnitCount = signalUnitCountByProject.get(projectLabel) ?? 0;
    const normalizedStatus =
      signalUnitCount > 0 ? item.status : repo.isDirty || repo.commitsToday.length > 0 ? "maintenance" : "idle";
    const normalizedSummary =
      signalUnitCount > 0
        ? item.summary
        : `Perubahan di ${projectLabel} cenderung kecil, trivial, atau belum cukup kuat untuk dijadikan card.`;

    return {
      project: item.project,
      status: normalizedStatus,
      summary: normalizedSummary,
      commitCount: repo.commitsToday.length,
      changedFilesCount: touchedFileCount(repo),
    };
  });
}

function buildActivityRetryLimits(requestedLimit: number): number[] {
  const candidates = [
    requestedLimit,
    Math.min(requestedLimit, 40),
    Math.min(requestedLimit, 30),
    Math.min(requestedLimit, 20),
    Math.min(requestedLimit, 15),
    Math.min(requestedLimit, 10),
    Math.min(requestedLimit, 5),
    3,
  ];

  return Array.from(new Set(candidates.filter((value) => Number.isInteger(value) && value > 0))).sort(
    (left, right) => right - left,
  );
}

function isStructuredOutputFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to generate json") ||
    normalized.includes("failed_generation") ||
    normalized.includes("generated json does not match the expected schema") ||
    normalized.includes("jsonschema")
  );
}

function confidenceWeight(value: ConfidenceLevel): number {
  if (value === "high") {
    return 3;
  }

  if (value === "medium") {
    return 2;
  }

  return 1;
}

async function requestGroqJson<T>(
  config: AppConfig,
  model: string,
  schemaName: string,
  schema: object,
  instructions: string[],
  input: string,
  maxOutputTokens: number,
): Promise<T> {
  const response = await fetch(`${config.groqBaseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      max_output_tokens: maxOutputTokens,
      instructions: instructions.join(" "),
      input,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = (await response.json()) as {
    error?: {
      message?: string;
      code?: string;
      failed_generation?: unknown;
    };
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Groq request failed with status ${response.status}.`);
  }

  const text = extractOutputText(payload);

  try {
    return JSON.parse(text) as T;
  } catch {
    return JSON.parse(extractFirstJsonObject(text)) as T;
  }
}

function toSignalFiles(files: RepoFileChangeStat[], config: AppConfig): AnalysisSignalFile[] {
  return files
    .map((file) => {
      const normalizedPath = normalizeFilePath(file.path);
      return {
        ...file,
        path: normalizedPath,
        normalizedPath,
        role: describeFileRole(normalizedPath),
      } satisfies AnalysisSignalFile;
    })
    .filter((file) => isMeaningfulFileChange(file, config.analysisMinFileChangeCount))
    .sort((left, right) => right.changeCount - left.changeCount);
}

function totalChangeCount(files: RepoFileChangeStat[]): number {
  return files.reduce((total, file) => total + file.changeCount, 0);
}

function buildUnitFromFiles(
  repo: RepoActivity,
  config: AppConfig,
  sourceType: AnalysisUnit["sourceType"],
  sourceLabel: string,
  sourceSummary: string,
  committedAt: string | undefined,
  files: RepoFileChangeStat[],
  unitId: string,
): AnalysisUnit | undefined {
  const signalFiles = toSignalFiles(files, config);
  const totalSignal = totalChangeCount(signalFiles);

  if (signalFiles.length === 0 || totalSignal < config.analysisMinUnitChangeCount) {
    return undefined;
  }

  const signalPaths = new Set(signalFiles.map((file) => file.normalizedPath));
  const ignoredFiles = files
    .map((file) => normalizeFilePath(file.path))
    .filter(Boolean)
    .filter((filePath) => !signalPaths.has(filePath));

  return {
    id: unitId,
    project: getProjectLabel(repo),
    projectKey: repo.name,
    sourceType,
    sourceLabel,
    sourceSummary,
    committedAt,
    signalFiles,
    ignoredFiles,
    totalChangeCount: totalSignal,
  };
}

function buildAnalysisUnits(collection: CollectedActivity, config: AppConfig): AnalysisUnit[] {
  const units: AnalysisUnit[] = [];

  for (const repo of collection.repositories) {
    const commitDetails = repo.commitDetails ?? [];

    if (commitDetails.length > 0) {
      for (const commit of commitDetails) {
        const unit = buildUnitFromFiles(
          repo,
          config,
          "commit",
          `commit ${commit.shortHash}`,
          commit.subject || "Commit tanpa subjek",
          commit.committedAt,
          commit.fileChangeStats,
          `${repo.name}:commit:${commit.hash}`,
        );

        if (unit) {
          units.push(unit);
        }
      }
    } else {
      const committedFiles = repo.fileChangeStats.filter((file) => file.sources.includes("committed"));
      const unit = buildUnitFromFiles(
        repo,
        config,
        "commit",
        "commit aggregate",
        repo.lastCommit ?? "Ringkasan perubahan commit hari ini",
        undefined,
        committedFiles,
        `${repo.name}:commit:aggregate`,
      );

      if (unit) {
        units.push(unit);
      }
    }

    const workingTreeFiles =
      repo.workingTreeFileChangeStats && repo.workingTreeFileChangeStats.length > 0
        ? repo.workingTreeFileChangeStats
        : repo.fileChangeStats.filter((file) => file.sources.includes("working_tree"));

    const workingTreeUnit = buildUnitFromFiles(
      repo,
      config,
      "working_tree",
      "working tree",
      repo.diffStats ?? "Perubahan yang belum di-commit",
      undefined,
      workingTreeFiles,
      `${repo.name}:working_tree`,
    );

    if (workingTreeUnit) {
      units.push(workingTreeUnit);
    }
  }

  return units;
}

function selectUnitsForAnalysis(units: AnalysisUnit[], config: AppConfig): AnalysisUnit[] {
  const maxUnitRequests = Math.max(1, config.groqAnalysisMaxRequests - 1);
  if (units.length <= maxUnitRequests) {
    return units;
  }

  const selectedIds = new Set(
    [...units]
      .sort((left, right) => right.totalChangeCount - left.totalChangeCount)
      .slice(0, maxUnitRequests)
      .map((unit) => unit.id),
  );

  return units.filter((unit) => selectedIds.has(unit.id));
}

function truncateStrings(items: string[], max: number): string[] {
  if (items.length <= max) {
    return items;
  }

  return [...items.slice(0, max), `... ${items.length - max} item(s) omitted`];
}

function formatSignalFiles(files: AnalysisSignalFile[], max: number): string {
  return truncateStrings(
    files.map(
      (file) =>
        `- ${file.normalizedPath} | role=${file.role} | +${file.additions} -${file.deletions} | total=${file.changeCount}`,
    ),
    max,
  ).join("\n");
}

function formatIgnoredFiles(files: string[], max: number): string {
  if (files.length === 0) {
    return "- none";
  }

  return truncateStrings(files.map((file) => `- ${file}`), max).join("\n");
}

function buildUnitPrompt(unit: AnalysisUnit): string {
  return [
    `Project: ${unit.project}`,
    `Project key: ${unit.projectKey}`,
    `Source type: ${unit.sourceType}`,
    `Source label: ${unit.sourceLabel}`,
    `Source summary: ${unit.sourceSummary}`,
    `Committed at: ${unit.committedAt ?? "-"}`,
    `Meaningful files: ${unit.signalFiles.length}`,
    `Meaningful total change count: ${unit.totalChangeCount}`,
    "Meaningful files detail:",
    formatSignalFiles(unit.signalFiles, 12),
    "Ignored low-signal files:",
    formatIgnoredFiles(unit.ignoredFiles, 8),
  ].join("\n");
}

function normalizeVerbPrefix(value: string): string {
  return value
    .replace(/^implement\b/i, "Mengimplementasikan")
    .replace(/^set up\b/i, "Menyiapkan")
    .replace(/^setup\b/i, "Menyiapkan")
    .replace(/^add\b/i, "Menambahkan")
    .replace(/^fix\b/i, "Memperbaiki")
    .replace(/^update\b/i, "Memperbarui")
    .replace(/^create\b/i, "Membuat")
    .replace(/^integrate\b/i, "Mengintegrasikan")
    .replace(/^improve\b/i, "Meningkatkan")
    .replace(/^adjust\b/i, "Menyesuaikan")
    .replace(/^refactor\b/i, "Merapikan")
    .replace(/\bnew endpoint\b/gi, "endpoint baru")
    .replace(/\binput validation and error handling\b/gi, "validasi input dan penanganan error")
    .replace(/\bfrontend and ui\b/gi, "frontend dan UI")
    .replace(/\bworkflow\b/gi, "alur kerja")
    .replace(/\bproject handler\b/gi, "handler project")
    .replace(/\bfunctionality\b/gi, "fitur")
    .replace(/\bfeature\b/gi, "fitur")
    .replace(/\broutes and controllers\b/gi, "route dan controller")
    .replace(/\bflow and sorting logic\b/gi, "alur dan logika sorting")
    .replace(/\bcolumn migration\b/gi, "migrasi kolom");
}

function toSentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  return `${trimmed[0]?.toUpperCase() ?? ""}${trimmed.slice(1)}`;
}

function normalizeActivityTitle(project: string, rawTitle: string): string {
  const cleaned = rawTitle.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return `${project} : Aktivitas Tidak Terspesifikasi`;
  }

  const separatorIndex = cleaned.indexOf(":");
  if (separatorIndex === -1) {
    return `${project} : ${toSentenceCase(normalizeVerbPrefix(cleaned))}`;
  }

  const suffix = cleaned.slice(separatorIndex + 1).trim();
  return `${project} : ${toSentenceCase(normalizeVerbPrefix(suffix || cleaned))}`;
}

function buildFallbackUnitTasks(unit: AnalysisUnit): UnitAnalysisTask[] {
  const output: UnitAnalysisTask[] = [];
  const seen = new Set<string>();
  const subjectTitle = buildSubjectFallbackTitle(unit);

  if (subjectTitle) {
    const key = normalizeActivityKey(subjectTitle);
    seen.add(key);
    output.push({
      title: subjectTitle,
      summary: `${unit.sourceLabel} memiliki subject commit yang cukup jelas untuk dijadikan task utama.`,
      confidence: "medium",
    });
  }

  for (const file of unit.signalFiles) {
    const title = buildFileActivity(
      {
        name: unit.projectKey,
        displayName: unit.project,
      },
      file.normalizedPath,
    );

    if (!title) {
      continue;
    }

    const key = normalizeActivityKey(title);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push({
      title,
      summary: `${unit.sourceLabel} memuat perubahan signifikan pada ${file.role} ${file.normalizedPath}.`,
      confidence: file.changeCount >= 20 ? "medium" : "low",
    });

    if (output.length >= 2) {
      break;
    }
  }

  return output;
}

function buildSubjectFallbackTitle(unit: AnalysisUnit): string | undefined {
  if (unit.sourceType !== "commit") {
    return undefined;
  }

  const subject = unit.sourceSummary.replace(/\s+/g, " ").trim();
  if (!subject || subject.length < 6) {
    return undefined;
  }

  if (/^update\s+[a-z0-9._/-]+\b/i.test(subject) || /^fix\s+[a-z0-9._/-]+\b/i.test(subject)) {
    return undefined;
  }

  const normalized = normalizeVerbPrefix(subject)
    .replace(/^fitur\b/i, "Menambahkan fitur")
    .replace(/^feature\b/i, "Menambahkan fitur");

  if (/^(hris|api|endpoint)\b/i.test(normalized) && !/^(membuat|menambah|meng|mem)/i.test(normalized)) {
    return `${unit.project} : ${toSentenceCase(`Menambahkan ${normalized}`)}`;
  }

  if (!/^(membuat|menambah|meng|mem|menyiapkan|merapikan)/i.test(normalized)) {
    return undefined;
  }

  return `${unit.project} : ${toSentenceCase(normalized)}`;
}

function isTaskConsistentWithUnit(title: string, unit: AnalysisUnit): boolean {
  const normalized = title.toLowerCase();
  const roles = new Set(unit.signalFiles.map((file) => file.role));
  const paths = unit.signalFiles.map((file) => file.normalizedPath.toLowerCase());

  if (/(composer|lockfile|dependency|dependency update|\.env|environment)/i.test(normalized)) {
    return false;
  }

  if (/(potensi|review|tinjau|audit|investigasi|investigate)/i.test(normalized)) {
    return false;
  }

  if (/(test|testing|unit test)/i.test(normalized) && !roles.has("test")) {
    return false;
  }

  if (/(dokumentasi|documentation|readme)/i.test(normalized)) {
    return false;
  }

  if (/(migration|migrasi)/i.test(normalized) && !roles.has("migration")) {
    return false;
  }

  if (/(route|routing)/i.test(normalized) && !roles.has("route")) {
    return false;
  }

  if (/(repository|repo)/i.test(normalized) && !roles.has("repository")) {
    return false;
  }

  if (/(browser|webpush)/i.test(normalized) && !paths.some((path) => path.includes("webpush") || path.includes("browser"))) {
    return false;
  }

  return true;
}

function normalizeOverallSummary(text: string): string {
  return text
    .replace(/\bseluruh tim engineering\b/gi, "developer")
    .replace(/\btim engineering\b/gi, "developer")
    .replace(/\bpada hari ini, tim\b/gi, "Pada hari ini, developer")
    .replace(/\btim\b/gi, "developer");
}

async function requestUnitAnalysis(unit: AnalysisUnit, config: AppConfig): Promise<UnitAnalysisResult> {
  const parsed = await requestGroqJson<Omit<UnitAnalysisResult, "unitId" | "project">>(
    config,
    config.groqAnalysisModel,
    "engineering_activity_unit",
    buildUnitAnalysisSchema(),
    [
      "Kamu sedang menganalisa satu unit kecil aktivitas engineering berdasarkan bukti commit atau working tree.",
      "Semua teks wajib dalam Bahasa Indonesia.",
      "Boleh mengembalikan tasks kosong jika unit ini tidak cukup signifikan untuk menjadi card kerja.",
      "Jangan membuat task untuk update dependency, composer, lockfile, env, log, file dokumen, asset generated, atau perubahan satu baris yang tidak substantif.",
      "Jika dalam satu unit ada beberapa scope yang berbeda, pisahkan maksimal 3 task.",
      "Jangan memecah satu fitur menjadi daftar file-file pendukungnya.",
      "Setiap title wajib memakai format: NAMA_PROJECT : aksi spesifik.",
      "Gunakan nama project yang sudah diberikan pada field Project.",
      "Tulis summary secara deskriptif, tetapi tetap berbasis bukti.",
    ],
    buildUnitPrompt(unit),
    1200,
  );

  const normalizedTasks = (parsed.tasks ?? [])
    .map((task) => ({
      title: normalizeActivityTitle(unit.project, task.title),
      summary: task.summary.trim(),
      confidence: task.confidence,
    }))
    .filter((task) => isTaskConsistentWithUnit(task.title, unit));
  const tasks = normalizedTasks.length > 0 ? normalizedTasks : buildFallbackUnitTasks(unit);

  return {
    unitId: unit.id,
    project: unit.project,
    summary: parsed.summary,
    confidence: parsed.confidence,
    skipReason: parsed.skipReason,
    tasks,
  };
}

function buildRepoOverview(collection: CollectedActivity): string {
  return collection.repositories
    .map((repo) => {
      const project = getProjectLabel(repo);
      return [
        `- ${project}`,
        `  repo=${repo.name}`,
        `  commits_today=${repo.commitsToday.length}`,
        `  touched_files=${touchedFileCount(repo)}`,
        `  dirty=${repo.isDirty ? "yes" : "no"}`,
        `  last_commit=${repo.lastCommit ?? "-"}`,
      ].join(" | ");
    })
    .join("\n");
}

function buildCandidateActivitySummary(candidates: CandidateActivity[]): string {
  if (candidates.length === 0) {
    return "- none";
  }

  return candidates
    .map(
      (candidate) =>
        `- ${candidate.title} | confidence=${candidate.confidence} | signal=${candidate.totalChangeCount} | why=${candidate.summary}`,
    )
    .join("\n");
}

function buildUnitResultSummary(results: UnitAnalysisResult[], unitLookup: Map<string, AnalysisUnit>): string {
  if (results.length === 0) {
    return "- none";
  }

  return results
    .map((result) => {
      const unit = unitLookup.get(result.unitId);
      const taskTitles = result.tasks.map((task) => task.title).join(" ; ") || "-";
      return [
        `- project=${result.project}`,
        `  source=${unit?.sourceLabel ?? result.unitId}`,
        `  summary=${result.summary || "-"}`,
        `  confidence=${result.confidence}`,
        `  skip_reason=${result.skipReason || "-"}`,
        `  tasks=${taskTitles}`,
      ].join(" | ");
    })
    .join("\n");
}

function buildFinalPrompt(
  collection: CollectedActivity,
  unitResults: UnitAnalysisResult[],
  candidates: CandidateActivity[],
  unitLookup: Map<string, AnalysisUnit>,
): string {
  const header = [
    `Report date: ${collection.reportDate}`,
    `Generated at: ${collection.generatedAt}`,
    `Timezone: ${collection.timezone}`,
    `Projects scanned: ${collection.metrics.projectCount}`,
    `Active projects: ${collection.metrics.activeProjectCount}`,
    `Repos with commits today: ${collection.metrics.reposWithCommitsToday}`,
    `Dirty repos: ${collection.metrics.dirtyRepoCount}`,
    `Total commits today: ${collection.metrics.totalCommits}`,
    `Total committed files: ${collection.metrics.totalCommittedFiles}`,
    `Total working tree files: ${collection.metrics.totalWorkingTreeFiles}`,
    `Unique files touched: ${collection.metrics.uniqueFilesTouched}`,
  ].join("\n");

  return [
    header,
    "",
    "Repo overview:",
    buildRepoOverview(collection),
    "",
    "Unit analysis summary:",
    buildUnitResultSummary(unitResults, unitLookup),
    "",
    "Candidate activities:",
    buildCandidateActivitySummary(candidates),
  ].join("\n");
}

async function requestFinalAnalysis(
  collection: CollectedActivity,
  config: AppConfig,
  unitResults: UnitAnalysisResult[],
  candidates: CandidateActivity[],
  unitLookup: Map<string, AnalysisUnit>,
  activityLimit: number,
): Promise<Omit<AiAnalysisReport, "generatedAt" | "reportDate">> {
  return requestGroqJson<Omit<AiAnalysisReport, "generatedAt" | "reportDate">>(
    config,
    config.groqModel,
    "daily_engineering_report",
    buildAnalysisSchema(activityLimit),
    [
      "Kamu adalah analis produktivitas engineering.",
      "Aktivitas ini milik satu developer, bukan tim engineering.",
      "Kamu menerima kandidat task dari analisa multi-pass per unit kerja.",
      "Semua teks wajib dalam Bahasa Indonesia.",
      "Hindari bahasa Inggris bila ada padanan Bahasa Indonesia yang wajar, kecuali istilah teknis yang memang lebih natural dibiarkan.",
      "Gunakan hanya bukti dari repo overview, unit analysis summary, dan candidate activities yang diberikan.",
      "Activities harus berupa task yang sempit, konkret, deskriptif, dan layak menjadi satu card kerja.",
      "Jangan membuat task dari update dependency, composer, lockfile, env, log, file dokumen, asset generated, atau perubahan satu baris yang tidak substantif.",
      "Jangan gabungkan dua kandidat dengan scope berbeda menjadi satu item.",
      "Boleh menggabungkan hanya jika dua kandidat jelas duplikat atau hanya beda wording.",
      "Activities sebaiknya berasal dari candidate activities; kamu boleh merapikan kalimatnya tanpa mengubah scope.",
      `Jumlah activities maksimum ${activityLimit} item, tetapi boleh lebih sedikit bila bukti kuatnya memang sedikit.`,
      "Nilai produktivitas secara konservatif jika bukti signifikan ternyata sedikit.",
      "Project insights harus menjelaskan fokus kerja nyata per project, bukan daftar file mentah.",
    ],
    buildFinalPrompt(collection, unitResults, candidates, unitLookup),
    Math.max(2200, Math.min(7000, activityLimit * 120)),
  );
}

function normalizeCandidateActivities(results: UnitAnalysisResult[], unitLookup: Map<string, AnalysisUnit>): CandidateActivity[] {
  const output = new Map<string, CandidateActivity>();

  for (const result of results) {
    const unit = unitLookup.get(result.unitId);
    if (!unit) {
      continue;
    }

    for (const task of result.tasks) {
      const normalizedTitle = normalizeActivityTitle(result.project, task.title);
      const key = normalizeActivityKey(normalizedTitle);
      const current = output.get(key);
      const candidate: CandidateActivity = {
        title: normalizedTitle,
        summary: task.summary,
        confidence: task.confidence,
        project: result.project,
        unitId: result.unitId,
        totalChangeCount: unit.totalChangeCount,
      };

      if (!current) {
        output.set(key, candidate);
        continue;
      }

      const currentWeight = confidenceWeight(current.confidence);
      const nextWeight = confidenceWeight(candidate.confidence);
      if (
        nextWeight > currentWeight ||
        (nextWeight === currentWeight && candidate.totalChangeCount > current.totalChangeCount)
      ) {
        output.set(key, candidate);
      }
    }
  }

  return [...output.values()].sort((left, right) => {
    const weightDiff = confidenceWeight(right.confidence) - confidenceWeight(left.confidence);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    return right.totalChangeCount - left.totalChangeCount;
  });
}

function extractProjectFromActivity(activity: string): string {
  const separatorIndex = activity.indexOf(":");
  if (separatorIndex === -1) {
    return "";
  }

  return activity.slice(0, separatorIndex).trim();
}

function tokenizeActivity(activity: string): string[] {
  return normalizeActivityKey(activity)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !ACTIVITY_STOP_WORDS.has(token));
}

function findCandidateMatch(activity: string, candidates: CandidateActivity[]): CandidateActivity | undefined {
  const activityKey = normalizeActivityKey(activity);
  const activityProject = extractProjectFromActivity(activity).toLowerCase();
  const activityTokens = new Set(tokenizeActivity(activity));
  let bestMatch: CandidateActivity | undefined;
  let bestScore = 0;

  for (const candidate of candidates) {
    const candidateKey = normalizeActivityKey(candidate.title);
    if (candidateKey === activityKey) {
      return candidate;
    }

    const candidateProject = extractProjectFromActivity(candidate.title).toLowerCase();
    if (activityProject && candidateProject && activityProject !== candidateProject) {
      continue;
    }

    const candidateTokens = tokenizeActivity(candidate.title);
    const overlap = candidateTokens.filter((token) => activityTokens.has(token)).length;
    if (overlap === 0) {
      continue;
    }

    const score = overlap / Math.max(activityTokens.size, candidateTokens.length, 1);
    if (overlap >= 2 || score >= 0.4) {
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
  }

  return bestMatch;
}

function mergeActivities(parsed: string[], candidates: CandidateActivity[], limit: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const item of parsed) {
    const match = findCandidateMatch(item, candidates);
    if (!match) {
      continue;
    }

    const key = normalizeActivityKey(match.title);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(match.title);
    if (output.length >= limit) {
      return output;
    }
  }

  for (const candidate of candidates) {
    const key = normalizeActivityKey(candidate.title);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(candidate.title);
    if (output.length >= limit) {
      break;
    }
  }

  return output;
}

function buildFallbackProjectInsights(collection: CollectedActivity, units: AnalysisUnit[]): ProjectInsight[] {
  const unitCountByProject = new Map<string, number>();

  for (const unit of units) {
    unitCountByProject.set(unit.project, (unitCountByProject.get(unit.project) ?? 0) + 1);
  }

  return collection.repositories.map((repo) => {
    const project = getProjectLabel(repo);
    const signalUnitCount = unitCountByProject.get(project) ?? 0;
    const status: ProjectInsight["status"] =
      repo.errors.length > 0 ? "blocked" : signalUnitCount > 0 ? "active" : repo.isDirty ? "maintenance" : "idle";

    const summary =
      signalUnitCount > 0
        ? `${signalUnitCount} unit perubahan substantif terdeteksi pada ${project}.`
        : repo.commitsToday.length > 0 || repo.isDirty
          ? `Perubahan di ${project} cenderung kecil, trivial, atau belum cukup kuat untuk dijadikan card.`
          : `Tidak ada aktivitas signifikan yang terdeteksi pada ${project}.`;

    return {
      project,
      status,
      summary,
      commitCount: repo.commitsToday.length,
      changedFilesCount: touchedFileCount(repo),
    };
  });
}

function buildFallbackReport(
  collection: CollectedActivity,
  activities: string[],
  units: AnalysisUnit[],
): AiAnalysisReport {
  const hasMeaningfulActivities = activities.length > 0;
  const projectNames = Array.from(new Set(activities.map((item) => item.split(":")[0]?.trim()).filter(Boolean))).slice(0, 4);
  const projectSummary = projectNames.length > 0 ? ` pada ${projectNames.join(", ")}` : "";

  return {
    generatedAt: new Date().toISOString(),
    reportDate: collection.reportDate,
    productivityScore: hasMeaningfulActivities ? 55 : 15,
    overallSummary: hasMeaningfulActivities
      ? `Aktivitas hari ini berhasil dipetakan menjadi ${activities.length} task signifikan${projectSummary}, tetapi ringkasan akhir AI tidak tersedia sehingga report memakai fallback lokal.`
      : "Aktivitas yang terdeteksi hari ini didominasi perubahan kecil, konfigurasi, dependency, atau noise sehingga tidak ada task utama yang kuat untuk dijadikan card.",
    focusAreas: hasMeaningfulActivities ? Array.from(new Set(activities.map((item) => item.split(":")[0]?.trim()).filter(Boolean))).slice(0, 6) : [],
    achievements: hasMeaningfulActivities ? activities.slice(0, 8) : [],
    blockers: [],
    improvements: hasMeaningfulActivities
      ? ["Perkuat commit message agar pemetaan task otomatis makin presisi."]
      : ["Gabungkan perubahan kecil dalam commit yang lebih jelas agar signal task tidak tenggelam oleh noise."],
    nextPriorities: [],
    activities,
    confidence: hasMeaningfulActivities ? "medium" : "low",
    projectInsights: buildFallbackProjectInsights(collection, units),
  };
}

export async function analyzeActivity(
  collection: CollectedActivity,
  config: AppConfig,
): Promise<AiAnalysisReport> {
  const requestedLimit = Math.max(1, config.hrisCardLimit);
  const rawUnits = buildAnalysisUnits(collection, config);
  const units = selectUnitsForAnalysis(rawUnits, config);
  const unitLookup = new Map(units.map((unit) => [unit.id, unit]));
  const unitResults: UnitAnalysisResult[] = [];

  for (const unit of units) {
    try {
      unitResults.push(await requestUnitAnalysis(unit, config));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      unitResults.push({
        unitId: unit.id,
        project: unit.project,
        summary: "",
        confidence: "low",
        skipReason: message,
        tasks: buildFallbackUnitTasks(unit),
      });
    }
  }

  const candidates = normalizeCandidateActivities(unitResults, unitLookup);

  if (units.length === 0) {
    const activities = expandReportActivities([], collection, requestedLimit);
    return buildFallbackReport(collection, activities, units);
  }

  let activityLimit = requestedLimit;
  let parsed: Omit<AiAnalysisReport, "generatedAt" | "reportDate"> | undefined;
  let lastError: Error | undefined;

  for (const candidateLimit of buildActivityRetryLimits(requestedLimit)) {
    try {
      parsed = await requestFinalAnalysis(collection, config, unitResults, candidates, unitLookup, candidateLimit);
      activityLimit = candidateLimit;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isStructuredOutputFailure(lastError.message)) {
        break;
      }
    }
  }

  if (!parsed) {
    const fallbackActivities = expandReportActivities(
      candidates.map((candidate) => candidate.title),
      collection,
      requestedLimit,
    );
    return buildFallbackReport(collection, fallbackActivities, units);
  }

  return {
    generatedAt: new Date().toISOString(),
    reportDate: collection.reportDate,
    productivityScore: parsed.productivityScore,
    overallSummary: normalizeOverallSummary(parsed.overallSummary),
    focusAreas: limitStrings(parsed.focusAreas, 6),
    achievements: limitStrings(parsed.achievements, 8),
    blockers: limitStrings(parsed.blockers, 6),
    improvements: limitStrings(parsed.improvements, 6),
    nextPriorities: limitStrings(parsed.nextPriorities, 6),
    activities: expandReportActivities(
      mergeActivities(limitStrings(parsed.activities, activityLimit), candidates, requestedLimit),
      collection,
      requestedLimit,
    ),
    confidence: parsed.confidence,
    projectInsights: normalizeProjectInsights(limitProjectInsights(parsed.projectInsights, 30), collection, units),
  };
}
