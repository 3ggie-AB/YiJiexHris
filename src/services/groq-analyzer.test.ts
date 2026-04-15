import { afterEach, expect, mock, test } from "bun:test";

import type { AppConfig, CollectedActivity } from "../types";
import { analyzeActivity } from "./groq-analyzer";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

test("analyzeActivity retries with a lower activity limit when strict JSON generation fails", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requestBodies.push(body);

    const schema = ((body.text as Record<string, unknown>)?.format as Record<string, unknown>)
      ?.schema as Record<string, unknown>;
    const properties = schema?.properties as Record<string, unknown>;
    const activities = properties?.activities as Record<string, unknown>;
    const maxItems = Number(activities?.maxItems ?? 0);

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
          overallSummary: "Fokus mengerjakan perbaikan dan update fitur.",
          focusAreas: ["Smart-School-NEW"],
          achievements: ["Memperbarui view dashboard"],
          blockers: [],
          improvements: [],
          nextPriorities: ["Melanjutkan integrasi notifikasi"],
          activities: [
            "Smart-School-NEW : Memperbarui view index halaman dashboard",
            "Smart-School-NEW : Menambahkan fitur push notification untuk instansi",
          ],
          confidence: "medium",
          projectInsights: [
            {
              project: "Smart-School-NEW",
              status: "active",
              summary: "Ada perubahan pada dashboard dan notifikasi.",
              commitCount: 3,
              changedFilesCount: 12,
            },
          ],
        }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const collection: CollectedActivity = {
    generatedAt: "2026-04-13T00:00:00.000Z",
    reportDate: "2026-04-13",
    timezone: "Asia/Jakarta",
    repositories: [
      {
        name: "Smart-School-NEW",
        path: "D:/projects/Smart-School-NEW",
        branch: "main",
        commitsToday: [],
        committedFilesToday: ["resources/views/dashboard/index.blade.php"],
        workingTreeFiles: [],
        fileChangeStats: [
          {
            path: "resources/views/dashboard/index.blade.php",
            additions: 12,
            deletions: 3,
            changeCount: 15,
            sources: ["committed"],
          },
        ],
        diffStats: "1 file changed, 12 insertions(+), 3 deletions(-)",
        lastCommit: "abc123 - update dashboard",
        isDirty: false,
        errors: [],
      },
    ],
    metrics: {
      projectCount: 1,
      activeProjectCount: 1,
      reposWithCommitsToday: 0,
      dirtyRepoCount: 0,
      totalCommits: 0,
      totalCommittedFiles: 1,
      totalWorkingTreeFiles: 0,
      uniqueFilesTouched: 1,
    },
  };

  const config: AppConfig = {
    groqApiKey: "x",
    groqBaseUrl: "https://api.groq.com/openai/v1",
    groqModel: "openai/gpt-oss-20b",
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
    hrisCardLimit: 50,
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
    scheduleTime: undefined,
    scheduleRunOnStart: true,
  };

  const report = await analyzeActivity(collection, config);

  expect(report.activities).toHaveLength(2);
  expect(requestBodies.length).toBeGreaterThanOrEqual(2);

  const firstSchema = (((requestBodies[0]?.text as Record<string, unknown>)?.format as Record<string, unknown>)
    ?.schema as Record<string, unknown>)?.properties as Record<string, unknown>;
  const secondSchema = (((requestBodies[1]?.text as Record<string, unknown>)?.format as Record<string, unknown>)
    ?.schema as Record<string, unknown>)?.properties as Record<string, unknown>;

  expect(((firstSchema?.activities as Record<string, unknown>)?.maxItems as number) > ((secondSchema?.activities as Record<string, unknown>)?.maxItems as number)).toBe(
    true,
  );
});

test("analyzeActivity expands sparse AI activities using changed files when the work signal is much larger", async () => {
  globalThis.fetch = mock(async () => {
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
              summary: "Ada perubahan di controller, service, migration, dan view.",
              commitCount: 3,
              changedFilesCount: 8,
            },
          ],
        }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const collection: CollectedActivity = {
    generatedAt: "2026-04-14T00:00:00.000Z",
    reportDate: "2026-04-14",
    timezone: "Asia/Jakarta",
    repositories: [
      {
        name: "ERP",
        path: "D:/projects/ERP",
        branch: "main",
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
        committedFilesToday: [
          "app/Http/Controllers/CertificateTemplateController.php",
          "app/Services/ProjectCertificateService.php",
          "database/migrations/2026_04_14_100000_add_certificate_uuid_to_projects_table.php",
          "resources/views/certificate-template/index.blade.php",
        ],
        workingTreeFiles: [],
        fileChangeStats: [
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
          {
            path: "resources/views/certificate-template/index.blade.php",
            additions: 8,
            deletions: 2,
            changeCount: 10,
            sources: ["committed"],
          },
        ],
        diffStats: "4 files changed, 56 insertions(+), 11 deletions(-)",
        lastCommit: "abc123 - Update Sertifikat",
        isDirty: false,
        errors: [],
      },
    ],
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

  const config: AppConfig = {
    groqApiKey: "x",
    groqBaseUrl: "https://api.groq.com/openai/v1",
    groqModel: "openai/gpt-oss-20b",
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
    scheduleTime: undefined,
    scheduleRunOnStart: true,
  };

  const report = await analyzeActivity(collection, config);

  expect(report.activities).toContain("ERP : Membuat Modul Sertifikat");
  expect(report.activities).toContain("ERP : Memperbarui Controller Certificate Template");
  expect(report.activities).toContain("ERP : Memperbarui Service Project Certificate");
  expect(report.activities).toContain("ERP : Menambahkan Migrasi Add Certificate UUID To Projects Table");
  expect(report.activities.length).toBeGreaterThan(1);
});
