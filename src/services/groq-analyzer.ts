import type { AiAnalysisReport, AppConfig, CollectedActivity, ProjectInsight, RepoActivity } from "../types";
import { expandReportActivities } from "./activity-expander";
import { extractFirstJsonObject, extractOutputText } from "../utils/responses";

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

function limitStrings(items: string[] | undefined, max: number): string[] {
  return (items ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function limitProjectInsights(
  items: ProjectInsight[] | undefined,
  max: number,
): ProjectInsight[] {
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

function getProjectLabel(repo: RepoActivity): string {
  return repo.displayName || repo.name;
}

function truncateList(items: string[], max: number): string[] {
  if (items.length <= max) {
    return items;
  }

  return [...items.slice(0, max), `... ${items.length - max} item(s) omitted`];
}

function formatFileChangeStat(repo: RepoActivity, config: AppConfig): string {
  if (repo.fileChangeStats.length === 0) {
    return "- none";
  }

  return truncateList(
    repo.fileChangeStats.map(
      (file) =>
        `- ${file.path} | +${file.additions} -${file.deletions} | total=${file.changeCount} | source=${file.sources.join("+")}`,
    ),
    Math.min(config.maxFilesPerRepo, 50),
  ).join("\n");
}

function formatRepoContext(repo: RepoActivity, config: AppConfig): string {
  const commitLines =
    repo.commitsToday.length > 0
      ? truncateList(
          repo.commitsToday.map(
            (commit) =>
              `- ${commit.shortHash} | ${commit.subject} | ${commit.author} | ${commit.committedAt}`,
          ),
          config.maxCommitsPerRepo,
        ).join("\n")
      : "- no commits today";

  const committedFileLines =
    repo.committedFilesToday.length > 0
      ? truncateList(repo.committedFilesToday.map((filePath) => `- ${filePath}`), config.maxFilesPerRepo).join("\n")
      : "- no committed files today";

  const workingTreeLines =
    repo.workingTreeFiles.length > 0
      ? truncateList(
          repo.workingTreeFiles.map((file) => `- ${file.rawStatus} ${file.path}`),
          config.maxFilesPerRepo,
        ).join("\n")
      : "- working tree clean";

  const errorLines = repo.errors.length > 0 ? repo.errors.map((error) => `- ${error}`).join("\n") : "- none";

  return [
    `Project: ${getProjectLabel(repo)}`,
    `Project key: ${repo.name}`,
    `Path: ${repo.path}`,
    `Branch: ${repo.branch ?? "-"}`,
    `Dirty: ${repo.isDirty ? "yes" : "no"}`,
    `Touched files: ${touchedFileCount(repo)}`,
    `Last commit: ${repo.lastCommit ?? "-"}`,
    `Diff summary: ${repo.diffStats ?? "-"}`,
    "Commits today:",
    commitLines,
    "Files from today's commits:",
    committedFileLines,
    "Working tree files:",
    workingTreeLines,
    "Top changed files:",
    formatFileChangeStat(repo, config),
    "Collector errors:",
    errorLines,
  ].join("\n");
}

function buildPrompt(collection: CollectedActivity, config: AppConfig): string {
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

  const repoBlocks = collection.repositories.map((repo) => formatRepoContext(repo, config)).join("\n\n---\n\n");

  return [
    "Analisa laporan aktivitas engineering berikut untuk satu developer.",
    "Gunakan hanya bukti dari repository yang diberikan. Jangan mengarang pekerjaan yang tidak terlihat di data.",
    "Gunakan Bahasa Indonesia untuk semua field output.",
    "Nilai produktivitas secara konservatif bila bukti lemah atau repository cenderung idle.",
    "Field activities harus berisi daftar task yang sempit dan konkret, satu item mewakili satu pekerjaan yang layak dijadikan satu card.",
    "Setiap item activities wajib berbentuk judul task singkat dengan format: NAMA_PROJECT : aksi spesifik.",
    "Gunakan kata kerja yang jelas seperti Membuat, Menambahkan, Mengubah, Menyesuaikan, Memperbarui, Memperbaiki, atau Mengintegrasikan.",
    "Jangan menulis activities sebagai nama file mentah, path file, atau commit message pendek yang belum dirapikan.",
    'Contoh yang salah: "Smart-School-NEW : Update view tabel-murid.blade.php".',
    'Contoh yang benar: "Smart-School-NEW : Mengubah View Tabel Murid untuk Menyesuaikan Tampilan Data Siswa".',
    'Contoh yang benar: "ERP : Membuat File Migration untuk Menambahkan Kolom di Tabel Task".',
    "Hindari task yang terlalu lebar seperti mengerjakan banyak hal sekaligus dalam satu item.",
    "Project summary harus menjelaskan fokus kerja yang benar-benar terlihat dari commit, file berubah, dan status working tree.",
    "",
    header,
    "",
    repoBlocks,
  ].join("\n");
}

function normalizeProjectInsights(
  projectInsights: ProjectInsight[],
  collection: CollectedActivity,
): ProjectInsight[] {
  const lookup = new Map<string, RepoActivity>();
  for (const repo of collection.repositories) {
    lookup.set(repo.name, repo);
    if (repo.displayName) {
      lookup.set(repo.displayName, repo);
    }
  }

  return projectInsights.map((item) => {
    const repo = lookup.get(item.project);
    if (!repo) {
      return item;
    }

    return {
      project: item.project,
      status: item.status,
      summary: item.summary,
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

async function requestAnalysis(
  collection: CollectedActivity,
  config: AppConfig,
  activityLimit: number,
): Promise<Omit<AiAnalysisReport, "generatedAt" | "reportDate">> {
  const analysisSchema = buildAnalysisSchema(activityLimit);
  const response = await fetch(`${config.groqBaseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model: config.groqModel,
      max_output_tokens: Math.max(2500, Math.min(8000, activityLimit * 140)),
      instructions: [
        "Kamu adalah analis produktivitas engineering.",
        "Kembalikan JSON valid yang persis mengikuti schema.",
        "Semua teks wajib dalam Bahasa Indonesia.",
        "Tuliskan activities sebagai judul task yang sempit, konkret, dan bisa berdiri sendiri sebagai satu card kerja.",
        "Gunakan format activities: NAMA_PROJECT : aksi spesifik.",
        `Jumlah activities boleh sampai ${activityLimit} item bila datanya memang cukup.`,
        "Jika bukti task lebih sedikit, kembalikan item lebih sedikit daripada memaksakan isi.",
        "Aktivitas harus terdengar seperti judul pekerjaan manusia, bukan nama file mentah.",
        "Kalau sumber datanya berupa file seperti tabel-murid.blade.php, ubah menjadi judul yang deskriptif, misalnya Mengubah View Tabel Murid untuk menyesuaikan tampilan data siswa.",
        "Hindari bahasa Inggris kecuali nama teknis file, branch, tabel, endpoint, atau identifier kode.",
        "Tulis secara langsung, berbasis bukti, dan tanpa kalimat motivasional.",
      ].join(" "),
      input: buildPrompt(collection, config),
      text: {
        format: {
          type: "json_schema",
          name: "daily_engineering_report",
          strict: true,
          schema: analysisSchema,
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
    return JSON.parse(text) as Omit<AiAnalysisReport, "generatedAt" | "reportDate">;
  } catch {
    return JSON.parse(extractFirstJsonObject(text)) as Omit<AiAnalysisReport, "generatedAt" | "reportDate">;
  }
}

export async function analyzeActivity(
  collection: CollectedActivity,
  config: AppConfig,
): Promise<AiAnalysisReport> {
  const requestedLimit = Math.max(1, config.hrisCardLimit);
  let activityLimit = requestedLimit;
  let parsed: Omit<AiAnalysisReport, "generatedAt" | "reportDate"> | undefined;
  let lastError: Error | undefined;

  for (const candidateLimit of buildActivityRetryLimits(requestedLimit)) {
    try {
      parsed = await requestAnalysis(collection, config, candidateLimit);
      activityLimit = candidateLimit;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isStructuredOutputFailure(lastError.message)) {
        throw lastError;
      }
    }
  }

  if (!parsed) {
    throw lastError ?? new Error("Groq analysis failed.");
  }

  return {
    generatedAt: new Date().toISOString(),
    reportDate: collection.reportDate,
    productivityScore: parsed.productivityScore,
    overallSummary: parsed.overallSummary,
    focusAreas: limitStrings(parsed.focusAreas, 6),
    achievements: limitStrings(parsed.achievements, 8),
    blockers: limitStrings(parsed.blockers, 6),
    improvements: limitStrings(parsed.improvements, 6),
    nextPriorities: limitStrings(parsed.nextPriorities, 6),
    activities: expandReportActivities(limitStrings(parsed.activities, activityLimit), collection, requestedLimit),
    confidence: parsed.confidence,
    projectInsights: normalizeProjectInsights(limitProjectInsights(parsed.projectInsights, 30), collection),
  };
}
