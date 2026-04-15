import { expect, test } from "bun:test";

import { buildCardFormData, buildHrisCardPayloads, sendReportToHris } from "./hris-client";

test("buildCardFormData flattens checklists into indexed form fields", () => {
  const formData = buildCardFormData({
    list_id: 35127,
    title: "ERP : Menyesuaikan Tampilan Task List dengan Fitur Sertifikat",
    description: "",
    checklists: [
      { id: 487573, title: "Progres", checklist: "yes", position: 1 },
      { id: 487574, title: "Bukti", checklist: "yes", position: 2 },
      { id: 487575, title: "Final", checklist: "yes", position: 3 },
    ],
  });

  expect(formData.get("title")).toBe("ERP : Menyesuaikan Tampilan Task List dengan Fitur Sertifikat");
  expect(formData.get("description")).toBe("");
  expect(formData.get("list_id")).toBe("35127");
  expect(formData.get("checklists[0][id]")).toBe("487573");
  expect(formData.get("checklists[0][title]")).toBe("Progres");
  expect(formData.get("checklists[0][checklist]")).toBe("yes");
  expect(formData.get("checklists[0][position]")).toBe("1");
  expect(formData.get("checklists[1][id]")).toBe("487574");
  expect(formData.get("checklists[1][title]")).toBe("Bukti");
  expect(formData.get("checklists[1][checklist]")).toBe("yes");
  expect(formData.get("checklists[1][position]")).toBe("2");
  expect(formData.get("checklists[2][id]")).toBe("487575");
  expect(formData.get("checklists[2][title]")).toBe("Final");
  expect(formData.get("checklists[2][checklist]")).toBe("yes");
  expect(formData.get("checklists[2][position]")).toBe("3");
});

test("buildHrisCardPayloads keeps scoped activity title without duplicating project prefix", () => {
  const payloads = buildHrisCardPayloads(
    {
      generatedAt: "2026-04-13T00:00:00.000Z",
      reportDate: "2026-04-13",
      productivityScore: 80,
      overallSummary: "Fokus mengerjakan ERP hari ini.",
      focusAreas: ["ERP"],
      achievements: ["Menyiapkan migrasi"],
      blockers: [],
      improvements: [],
      nextPriorities: [],
      activities: ["ERP : Membuat File Migration untuk Menambahkan Kolom di Tabel Task"],
      confidence: "high",
      projectInsights: [
        {
          project: "ERP",
          status: "active",
          summary: "Fokus di migrasi database",
          commitCount: 2,
          changedFilesCount: 4,
        },
      ],
    },
    {
      generatedAt: "2026-04-13T00:00:00.000Z",
      reportDate: "2026-04-13",
      timezone: "Asia/Jakarta",
      repositories: [],
      metrics: {
        projectCount: 1,
        activeProjectCount: 1,
        reposWithCommitsToday: 1,
        dirtyRepoCount: 0,
        totalCommits: 2,
        totalCommittedFiles: 3,
        totalWorkingTreeFiles: 1,
        uniqueFilesTouched: 4,
      },
    },
    {
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
      hrisLoginUrl: "https://hr.itsyntax.dev/api/login",
      hrisCardsUrl: "https://hr.itsyntax.dev/api/cards",
      hrisApiMethod: "POST",
      hrisEmail: "user@example.com",
      hrisPassword: "secret",
      hrisListId: 35127,
      hrisBoardId: undefined,
      hrisBoardListsUrl: undefined,
      hrisCardLimit: 5,
      hrisApiToken: undefined,
      hrisAuthHeader: "Authorization",
      hrisTokenPrefix: "Bearer",
      hrisHeaders: {},
      hrisPayloadStatic: {},
      hrisCardChecklists: [
        { id: 487573, title: "Progres", checklist: "yes", position: 1 },
        { id: 487574, title: "Bukti", checklist: "yes", position: 2 },
        { id: 487575, title: "Final", checklist: "yes", position: 3 },
      ],
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
    },
  );

  expect(payloads).toHaveLength(1);
  expect(payloads[0]?.title).toBe("ERP : Membuat File Migration untuk Menambahkan Kolom di Tabel Task");
  expect(payloads[0]?.checklists.map((item) => item.checklist)).toEqual(["yes", "yes", "yes"]);
});

test("buildHrisCardPayloads can send empty description when disabled by config", () => {
  const payloads = buildHrisCardPayloads(
    {
      generatedAt: "2026-04-13T00:00:00.000Z",
      reportDate: "2026-04-13",
      productivityScore: 80,
      overallSummary: "Fokus mengerjakan ERP hari ini.",
      focusAreas: ["ERP"],
      achievements: ["Menyiapkan migrasi"],
      blockers: [],
      improvements: [],
      nextPriorities: [],
      activities: ["ERP : Membuat File Migration untuk Menambahkan Kolom di Tabel Task"],
      confidence: "high",
      projectInsights: [
        {
          project: "ERP",
          status: "active",
          summary: "Fokus di migrasi database",
          commitCount: 2,
          changedFilesCount: 4,
        },
      ],
    },
    {
      generatedAt: "2026-04-13T00:00:00.000Z",
      reportDate: "2026-04-13",
      timezone: "Asia/Jakarta",
      repositories: [],
      metrics: {
        projectCount: 1,
        activeProjectCount: 1,
        reposWithCommitsToday: 1,
        dirtyRepoCount: 0,
        totalCommits: 2,
        totalCommittedFiles: 3,
        totalWorkingTreeFiles: 1,
        uniqueFilesTouched: 4,
      },
    },
    {
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
      hrisLoginUrl: "https://hr.itsyntax.dev/api/login",
      hrisCardsUrl: "https://hr.itsyntax.dev/api/cards",
      hrisApiMethod: "POST",
      hrisEmail: "user@example.com",
      hrisPassword: "secret",
      hrisListId: 35127,
      hrisBoardId: undefined,
      hrisBoardListsUrl: undefined,
      hrisCardLimit: 5,
      hrisApiToken: undefined,
      hrisAuthHeader: "Authorization",
      hrisTokenPrefix: "Bearer",
      hrisHeaders: {},
      hrisPayloadStatic: {},
      hrisCardChecklists: [
        { id: 487573, title: "Progres", checklist: "yes", position: 1 },
        { id: 487574, title: "Bukti", checklist: "yes", position: 2 },
        { id: 487575, title: "Final", checklist: "yes", position: 3 },
      ],
      hrisSendDescription: false,
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
    },
  );

  expect(payloads[0]?.description).toBe("");
});

test("sendReportToHris resolves list_id from board date before creating cards", async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestUrls.push(url);

    if (url.endsWith("/api/login")) {
      return new Response(JSON.stringify({ token: "token-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.endsWith("/api/boards/136/generate-lists")) {
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify([
          { id: 35115, board_id: 136, date: "2026-04-13" },
          { id: 35116, board_id: 136, date: "2026-04-14" },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (url.endsWith("/api/cards")) {
      const formData = init?.body as FormData;
      expect(formData.get("list_id")).toBe("35116");

      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const result = await sendReportToHris(
      {
        generatedAt: "2026-04-14T00:00:00.000Z",
        reportDate: "2026-04-14",
        productivityScore: 80,
        overallSummary: "Fokus mengerjakan ERP hari ini.",
        focusAreas: ["ERP"],
        achievements: ["Menyiapkan migrasi"],
        blockers: [],
        improvements: [],
        nextPriorities: [],
        activities: ["ERP : Membuat File Migration untuk Menambahkan Kolom di Tabel Task"],
        confidence: "high",
        projectInsights: [
          {
            project: "ERP",
            status: "active",
            summary: "Fokus di migrasi database",
            commitCount: 2,
            changedFilesCount: 4,
          },
        ],
      },
      {
        generatedAt: "2026-04-14T00:00:00.000Z",
        reportDate: "2026-04-14",
        timezone: "Asia/Jakarta",
        repositories: [],
        metrics: {
          projectCount: 1,
          activeProjectCount: 1,
          reposWithCommitsToday: 1,
          dirtyRepoCount: 0,
          totalCommits: 2,
          totalCommittedFiles: 3,
          totalWorkingTreeFiles: 1,
          uniqueFilesTouched: 4,
        },
      },
      {
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
        hrisLoginUrl: "https://hr.itsyntax.dev/api/login",
        hrisCardsUrl: "https://hr.itsyntax.dev/api/cards",
        hrisApiMethod: "POST",
        hrisEmail: "user@example.com",
        hrisPassword: "secret",
        hrisListId: 35127,
        hrisBoardId: 136,
        hrisBoardListsUrl: undefined,
        hrisCardLimit: 5,
        hrisApiToken: undefined,
        hrisAuthHeader: "Authorization",
        hrisTokenPrefix: "Bearer",
        hrisHeaders: {},
        hrisPayloadStatic: {},
        hrisCardChecklists: [],
        hrisSendDescription: false,
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
      },
    );

    expect(result.ok).toBe(true);
    expect(result.payload.cards[0]?.list_id).toBe(35116);
    expect(requestUrls).toEqual([
      "https://hr.itsyntax.dev/api/login",
      "https://hr.itsyntax.dev/api/boards/136/generate-lists",
      "https://hr.itsyntax.dev/api/cards",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
