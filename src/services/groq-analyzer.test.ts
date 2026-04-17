import { afterEach, expect, mock, test } from "bun:test";

import type { AppConfig, CollectedActivity, RepoActivity, RepoCommitDetail, RepoFileChangeStat } from "../types";
import { analyzeActivity } from "./groq-analyzer";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    groqApiKey: "x",
    groqBaseUrl: "https://api.groq.com/openai/v1",
    groqModel: "openai/gpt-oss-20b",
    groqAnalysisModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    groqAnalysisMaxRequests: 40,
    projectRepos: [],
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
    hrisDevServerWaitMs: 12000,
    hrisEmployeeId: undefined,
    outputDir: "./reports",
    maxCommitsPerRepo: 15,
    maxFilesPerRepo: 30,
    analysisMinFileChangeCount: 2,
    analysisMinUnitChangeCount: 8,
    scheduleTime: undefined,
    scheduleRunOnStart: true,
    ...overrides,
  };
}

function createCommitDetail(
  hash: string,
  shortHash: string,
  subject: string,
  committedAt: string,
  fileChangeStats: RepoFileChangeStat[],
): RepoCommitDetail {
  return {
    hash,
    shortHash,
    author: "User",
    committedAt,
    subject,
    files: fileChangeStats.map((file) => file.path),
    fileChangeStats,
    diffStats: `${fileChangeStats.length} file(s) changed`,
  };
}

function createRepo(overrides: Partial<RepoActivity> = {}): RepoActivity {
  return {
    name: "Smart-School-NEW",
    displayName: "Smart School",
    path: "D:/projects/Smart-School-NEW",
    branch: "main",
    commitsToday: [],
    commitDetails: [],
    committedFilesToday: [],
    workingTreeFiles: [],
    workingTreeFileChangeStats: [],
    fileChangeStats: [],
    diffStats: undefined,
    lastCommit: undefined,
    isDirty: false,
    errors: [],
    ...overrides,
  };
}

test("analyzeActivity retries final report generation with a lower activity limit after strict JSON failure", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requestBodies.push(body);

    const schema = ((body.text as Record<string, unknown>)?.format as Record<string, unknown>)
      ?.schema as Record<string, unknown>;
    const properties = schema?.properties as Record<string, unknown>;

    if (properties?.activities) {
      const maxItems = Number((properties.activities as Record<string, unknown>)?.maxItems ?? 0);

      if (maxItems >= 40) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            productivityScore: 82,
            overallSummary: "Fokus mengerjakan notifikasi browser di Smart School.",
            focusAreas: ["Notifikasi browser"],
            achievements: ["Integrasi push notification browser"],
            blockers: [],
            improvements: [],
            nextPriorities: ["Melanjutkan validasi notifikasi browser"],
            activities: ["Smart School : Mengintegrasikan push notification browser"],
            confidence: "medium",
            projectInsights: [
              {
                project: "Smart School",
                status: "active",
                summary: "Ada pekerjaan signifikan pada notifikasi browser.",
                commitCount: 1,
                changedFilesCount: 3,
              },
            ],
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          summary: "Commit ini berfokus pada fitur notifikasi browser.",
          confidence: "high",
          skipReason: "",
          tasks: [
            {
              title: "Smart School : Mengintegrasikan push notification browser",
              summary: "Menambahkan alur notifikasi browser dari backend sampai aset browser.",
              confidence: "high",
            },
          ],
        }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const commitFiles: RepoFileChangeStat[] = [
    {
      path: "app/Services/BrowserPushNotificationService.php",
      additions: 80,
      deletions: 0,
      changeCount: 80,
      sources: ["committed"],
    },
    {
      path: "app/Http/Controllers/BrowserNotificationController.php",
      additions: 34,
      deletions: 0,
      changeCount: 34,
      sources: ["committed"],
    },
    {
      path: "public/custom/webpush-browser.js",
      additions: 40,
      deletions: 0,
      changeCount: 40,
      sources: ["committed"],
    },
  ];

  const collection: CollectedActivity = {
    generatedAt: "2026-04-13T00:00:00.000Z",
    reportDate: "2026-04-13",
    timezone: "Asia/Jakarta",
    repositories: [
      createRepo({
        commitsToday: [
          {
            hash: "a1",
            shortHash: "a1",
            author: "User",
            committedAt: "2026-04-13T10:00:00+07:00",
            subject: "WebPush browser",
          },
        ],
        commitDetails: [
          createCommitDetail("a1", "a1", "WebPush browser", "2026-04-13T10:00:00+07:00", commitFiles),
        ],
        committedFilesToday: commitFiles.map((file) => file.path),
        fileChangeStats: commitFiles,
        lastCommit: "a1 - WebPush browser",
      }),
    ],
    metrics: {
      projectCount: 1,
      activeProjectCount: 1,
      reposWithCommitsToday: 1,
      dirtyRepoCount: 0,
      totalCommits: 1,
      totalCommittedFiles: 3,
      totalWorkingTreeFiles: 0,
      uniqueFilesTouched: 3,
    },
  };

  const report = await analyzeActivity(collection, createConfig({ hrisCardLimit: 50 }));

  expect(report.activities).toEqual(["Smart School : Mengintegrasikan push notification browser"]);

  const finalRequests = requestBodies.filter((body) => {
    const schema = ((body.text as Record<string, unknown>)?.format as Record<string, unknown>)
      ?.schema as Record<string, unknown>;
    return Boolean((schema?.properties as Record<string, unknown>)?.activities);
  });

  expect(finalRequests.length).toBeGreaterThanOrEqual(2);

  const firstFinalSchema = (((finalRequests[0]?.text as Record<string, unknown>)?.format as Record<string, unknown>)
    ?.schema as Record<string, unknown>)?.properties as Record<string, unknown>;
  const secondFinalSchema = (((finalRequests[1]?.text as Record<string, unknown>)?.format as Record<string, unknown>)
    ?.schema as Record<string, unknown>)?.properties as Record<string, unknown>;

  expect(
    Number((firstFinalSchema?.activities as Record<string, unknown>)?.maxItems ?? 0) >
      Number((secondFinalSchema?.activities as Record<string, unknown>)?.maxItems ?? 0),
  ).toBe(true);
});

test("analyzeActivity merges multi-pass unit candidates when final report is too sparse", async () => {
  const requestKinds: string[] = [];

  globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const schema = ((body.text as Record<string, unknown>)?.format as Record<string, unknown>)
      ?.schema as Record<string, unknown>;
    const properties = schema?.properties as Record<string, unknown>;
    const input = String(body.input ?? "");

    if (properties?.activities) {
      requestKinds.push("final");
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            productivityScore: 82,
            overallSummary: "Fokus mengerjakan modul sertifikat.",
            focusAreas: ["ERP"],
            achievements: ["Membuat modul sertifikat"],
            blockers: [],
            improvements: [],
            nextPriorities: ["Melanjutkan integrasi sertifikat"],
            activities: ["ERP : Membuat Modul Sertifikat"],
            confidence: "medium",
            projectInsights: [
              {
                project: "ERP",
                status: "active",
                summary: "Ada perubahan pada controller, service, migration, dan view.",
                commitCount: 2,
                changedFilesCount: 4,
              },
            ],
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    requestKinds.push("unit");

    if (input.includes("Update Sertifikat")) {
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "Commit ini membangun modul sertifikat project.",
            confidence: "high",
            skipReason: "",
            tasks: [
              {
                title: "ERP : Membuat Modul Sertifikat",
                summary: "Menambahkan alur utama sertifikat project.",
                confidence: "high",
              },
              {
                title: "ERP : Menambahkan Migrasi UUID Sertifikat Project",
                summary: "Menyiapkan struktur data untuk sertifikat project.",
                confidence: "medium",
              },
            ],
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          summary: "Commit ini menyesuaikan template tampilan sertifikat.",
          confidence: "medium",
          skipReason: "",
          tasks: [
            {
              title: "ERP : Memperbarui Template Sertifikat Project",
              summary: "Merapikan template tampilan sertifikat agar sesuai kebutuhan baru.",
              confidence: "medium",
            },
          ],
        }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const firstCommitFiles: RepoFileChangeStat[] = [
    {
      path: "app/Http/Controllers/CertificateTemplateController.php",
      additions: 20,
      deletions: 5,
      changeCount: 25,
      sources: ["committed"],
    },
    {
      path: "app/Services/ProjectCertificateService.php",
      additions: 18,
      deletions: 4,
      changeCount: 22,
      sources: ["committed"],
    },
    {
      path: "database/migrations/2026_04_14_100000_add_certificate_uuid_to_projects_table.php",
      additions: 10,
      deletions: 0,
      changeCount: 10,
      sources: ["committed"],
    },
  ];
  const secondCommitFiles: RepoFileChangeStat[] = [
    {
      path: "resources/views/certificate-template/index.blade.php",
      additions: 8,
      deletions: 2,
      changeCount: 10,
      sources: ["committed"],
    },
  ];

  const repo = createRepo({
    name: "ERP",
    displayName: "ERP",
    path: "D:/projects/ERP",
    commitsToday: [
      {
        hash: "a",
        shortHash: "a",
        author: "User",
        committedAt: "2026-04-14T08:00:00+07:00",
        subject: "Update Sertifikat",
      },
      {
        hash: "b",
        shortHash: "b",
        author: "User",
        committedAt: "2026-04-14T10:00:00+07:00",
        subject: "Fix Template Sertifikat",
      },
    ],
    commitDetails: [
      createCommitDetail("a", "a", "Update Sertifikat", "2026-04-14T08:00:00+07:00", firstCommitFiles),
      createCommitDetail("b", "b", "Fix Template Sertifikat", "2026-04-14T10:00:00+07:00", secondCommitFiles),
    ],
    committedFilesToday: [...firstCommitFiles, ...secondCommitFiles].map((file) => file.path),
    fileChangeStats: [...firstCommitFiles, ...secondCommitFiles],
    diffStats: "4 files changed, 56 insertions(+), 11 deletions(-)",
    lastCommit: "abc123 - Update Sertifikat",
  });

  const collection: CollectedActivity = {
    generatedAt: "2026-04-14T00:00:00.000Z",
    reportDate: "2026-04-14",
    timezone: "Asia/Jakarta",
    repositories: [repo],
    metrics: {
      projectCount: 1,
      activeProjectCount: 1,
      reposWithCommitsToday: 1,
      dirtyRepoCount: 0,
      totalCommits: 2,
      totalCommittedFiles: 4,
      totalWorkingTreeFiles: 0,
      uniqueFilesTouched: 4,
    },
  };

  const report = await analyzeActivity(collection, createConfig());

  expect(report.activities).toContain("ERP : Membuat Modul Sertifikat");
  expect(report.activities).toContain("ERP : Menambahkan Migrasi UUID Sertifikat Project");
  expect(report.activities).toContain("ERP : Memperbarui Template Sertifikat Project");
  expect(requestKinds.filter((kind) => kind === "unit")).toHaveLength(2);
  expect(requestKinds.filter((kind) => kind === "final")).toHaveLength(1);
});

test("analyzeActivity skips trivial composer and one-line changes without calling the model", async () => {
  let requestCount = 0;

  globalThis.fetch = mock(async () => {
    requestCount += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const trivialCommitFiles: RepoFileChangeStat[] = [
    {
      path: "composer.json",
      additions: 1,
      deletions: 0,
      changeCount: 1,
      sources: ["committed"],
    },
    {
      path: "handlers/pengajuan.go",
      additions: 1,
      deletions: 0,
      changeCount: 1,
      sources: ["committed"],
    },
  ];

  const collection: CollectedActivity = {
    generatedAt: "2026-04-17T00:00:00.000Z",
    reportDate: "2026-04-17",
    timezone: "Asia/Jakarta",
    repositories: [
      createRepo({
        name: "Backend Kompetiva",
        displayName: "Backend Kompetiva",
        path: "D:/projects/Backend-Kompetiva",
        commitsToday: [
          {
            hash: "tiny",
            shortHash: "tiny",
            author: "User",
            committedAt: "2026-04-17T09:00:00+07:00",
            subject: "Update composer dan handler",
          },
        ],
        commitDetails: [
          createCommitDetail(
            "tiny",
            "tiny",
            "Update composer dan handler",
            "2026-04-17T09:00:00+07:00",
            trivialCommitFiles,
          ),
        ],
        committedFilesToday: trivialCommitFiles.map((file) => file.path),
        fileChangeStats: trivialCommitFiles,
        lastCommit: "tiny - Update composer dan handler",
      }),
    ],
    metrics: {
      projectCount: 1,
      activeProjectCount: 1,
      reposWithCommitsToday: 1,
      dirtyRepoCount: 0,
      totalCommits: 1,
      totalCommittedFiles: 2,
      totalWorkingTreeFiles: 0,
      uniqueFilesTouched: 2,
    },
  };

  const report = await analyzeActivity(collection, createConfig());

  expect(report.activities).toHaveLength(0);
  expect(requestCount).toBe(0);
});
