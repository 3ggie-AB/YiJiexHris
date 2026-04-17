import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AppConfig, RepoActivity } from "../types";
import { findRepositoryForTitle, inferRoutePathFromFile, pickRelevantFile, resolveEvidenceUrl } from "./evidence-provider";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("inferRoutePathFromFile derives route path from blade view file", () => {
  expect(inferRoutePathFromFile("resources/views/murid/tabel-murid.blade.php")).toBe("/murid");
  expect(inferRoutePathFromFile("resources/views/dashboard/student/index.blade.php")).toBe("/dashboard/student");
  expect(inferRoutePathFromFile("resources/js/Pages/Murid/TableMurid.vue")).toBe("/murid");
});

test("pickRelevantFile prefers file with biggest relevant code change", () => {
  const repo: RepoActivity = {
    name: "ERP",
    path: "D:/projects/ERP",
    branch: "main",
    commitsToday: [],
    commitDetails: [],
    committedFilesToday: [
      "database/migrations/2026_04_13_add_certificate_to_projects_table.php",
      "app/Services/ProjectCertificateService.php",
    ],
    workingTreeFiles: [],
    workingTreeFileChangeStats: [],
    fileChangeStats: [
      {
        path: "database/migrations/2026_04_13_add_certificate_to_projects_table.php",
        additions: 32,
        deletions: 1,
        changeCount: 33,
        sources: ["committed"],
      },
      {
        path: "app/Services/ProjectCertificateService.php",
        additions: 8,
        deletions: 3,
        changeCount: 11,
        sources: ["committed"],
      },
    ],
    isDirty: false,
    errors: [],
  };

  expect(pickRelevantFile("ERP : Membuat File Migration untuk Menambahkan Kolom di Tabel Task", repo)).toBe(
    "database/migrations/2026_04_13_add_certificate_to_projects_table.php",
  );
});

test("pickRelevantFile scopes selection to the most relevant commit when activity matches commit subject", () => {
  const repo: RepoActivity = {
    name: "Smart-School-NEW",
    displayName: "Smart School",
    path: "D:/projects/Smart-School-NEW",
    branch: "main",
    commitsToday: [
      {
        hash: "webpush",
        shortHash: "webpush",
        author: "User",
        committedAt: "2026-04-17T10:00:00+07:00",
        subject: "WebPush and Notification",
      },
      {
        hash: "ppdb",
        shortHash: "ppdb",
        author: "User",
        committedAt: "2026-04-17T11:00:00+07:00",
        subject: "Fix Nama PPDB",
      },
    ],
    commitDetails: [
      {
        hash: "webpush",
        shortHash: "webpush",
        author: "User",
        committedAt: "2026-04-17T10:00:00+07:00",
        subject: "WebPush and Notification",
        files: [
          "app/Services/BrowserPushNotificationService.php",
          "resources/views/dash/menu/browser-notifications/index.blade.php",
        ],
        fileChangeStats: [
          {
            path: "app/Services/BrowserPushNotificationService.php",
            additions: 303,
            deletions: 0,
            changeCount: 303,
            sources: ["committed"],
          },
          {
            path: "resources/views/dash/menu/browser-notifications/index.blade.php",
            additions: 278,
            deletions: 0,
            changeCount: 278,
            sources: ["committed"],
          },
        ],
        diffStats: "2 files changed",
      },
      {
        hash: "ppdb",
        shortHash: "ppdb",
        author: "User",
        committedAt: "2026-04-17T11:00:00+07:00",
        subject: "Fix Nama PPDB",
        files: ["app/Helpers/helpers.php", "resources/views/dash/menu/ppdb.blade.php"],
        fileChangeStats: [
          {
            path: "app/Helpers/helpers.php",
            additions: 9,
            deletions: 0,
            changeCount: 9,
            sources: ["committed"],
          },
          {
            path: "resources/views/dash/menu/ppdb.blade.php",
            additions: 3,
            deletions: 3,
            changeCount: 6,
            sources: ["committed"],
          },
        ],
        diffStats: "2 files changed",
      },
    ],
    committedFilesToday: [
      "app/Services/BrowserPushNotificationService.php",
      "resources/views/dash/menu/browser-notifications/index.blade.php",
      "app/Helpers/helpers.php",
      "resources/views/dash/menu/ppdb.blade.php",
    ],
    workingTreeFiles: [],
    workingTreeFileChangeStats: [],
    fileChangeStats: [
      {
        path: "app/Services/BrowserPushNotificationService.php",
        additions: 303,
        deletions: 0,
        changeCount: 303,
        sources: ["committed"],
      },
      {
        path: "resources/views/dash/menu/browser-notifications/index.blade.php",
        additions: 278,
        deletions: 0,
        changeCount: 278,
        sources: ["committed"],
      },
      {
        path: "app/Helpers/helpers.php",
        additions: 9,
        deletions: 0,
        changeCount: 9,
        sources: ["committed"],
      },
      {
        path: "resources/views/dash/menu/ppdb.blade.php",
        additions: 3,
        deletions: 3,
        changeCount: 6,
        sources: ["committed"],
      },
    ],
    isDirty: false,
    errors: [],
  };

  expect(pickRelevantFile("Smart School : Perbaiki label PPDB pada menu dashboard", repo)).toBe(
    "resources/views/dash/menu/ppdb.blade.php",
  );
});

test("findRepositoryForTitle can resolve repository from aliased project title", () => {
  const repo: RepoActivity = {
    name: "Smart-School-NEW",
    displayName: "Smart School",
    path: "D:/makannnnnnnn/Smart-School-NEW",
    branch: "main",
    commitsToday: [],
    commitDetails: [],
    committedFilesToday: [],
    workingTreeFiles: [],
    workingTreeFileChangeStats: [],
    fileChangeStats: [],
    isDirty: false,
    errors: [],
  };

  expect(
    findRepositoryForTitle("Smart School : Mengubah View Tabel Murid", {
      generatedAt: "2026-04-15T00:00:00.000Z",
      reportDate: "2026-04-15",
      timezone: "Asia/Jakarta",
      repositories: [repo],
      metrics: {
        projectCount: 1,
        activeProjectCount: 1,
        reposWithCommitsToday: 0,
        dirtyRepoCount: 0,
        totalCommits: 0,
        totalCommittedFiles: 0,
        totalWorkingTreeFiles: 0,
        uniqueFilesTouched: 0,
      },
    }),
  ).toEqual(repo);
});

test("resolveEvidenceUrl prefers explicit route rules over inferred route", async () => {
  const repo: RepoActivity = {
    name: "Smart-School-NEW",
    path: "D:/makannnnnnnn/Smart-School-NEW",
    branch: "main",
    commitsToday: [],
    commitDetails: [],
    committedFilesToday: ["resources/views/murid/tabel-murid.blade.php"],
    workingTreeFiles: [],
    workingTreeFileChangeStats: [],
    fileChangeStats: [
      {
        path: "resources/views/murid/tabel-murid.blade.php",
        additions: 12,
        deletions: 4,
        changeCount: 16,
        sources: ["committed"],
      },
    ],
    isDirty: false,
    errors: [],
  };

  const config: AppConfig = {
    groqApiKey: "x",
    groqBaseUrl: "https://api.groq.com/openai/v1",
    groqModel: "openai/gpt-oss-20b",
    groqAnalysisModel: "openai/gpt-oss-20b",
    groqAnalysisMaxRequests: 40,
    projectRepos: [],
    projectBaseDirs: [],
    discoveryIgnoreNames: [],
    projectPreviewUrls: {
      "Smart-School-NEW": "http://127.0.0.1:8000",
    },
    projectRunCommands: {},
    projectRouteRules: {
      "Smart-School-NEW": [{ match: "murid tabel", path: "/murid" }],
    },
    projectWebAuth: {},
    projectAliases: {},
    hrisLoginUrl: undefined,
    hrisCardsUrl: undefined,
    hrisApiMethod: "POST",
    hrisEmail: undefined,
    hrisPassword: undefined,
    hrisListId: undefined,
    hrisCardLimit: 5,
    hrisApiToken: undefined,
    hrisAuthHeader: "Authorization",
    hrisTokenPrefix: "Bearer",
    hrisHeaders: {},
    hrisPayloadStatic: {},
    hrisCardChecklists: [],
    hrisSendDescription: true,
    hrisSendEvidence: true,
    hrisEvidenceMode: "auto",
    hrisEvidenceDir: "./reports/evidence",
    hrisBrowserPath: undefined,
    hrisCodeScreenshotStyle: "ray",
    hrisCodeScreenshotStrict: false,
    hrisDevServerWaitMs: 12000,
    hrisEmployeeId: undefined,
    outputDir: "./reports",
    maxCommitsPerRepo: 15,
    maxFilesPerRepo: 30,
    analysisMinFileChangeCount: 2,
    analysisMinUnitChangeCount: 8,
    scheduleTime: undefined,
    scheduleRunOnStart: true,
  };

  expect(
    await resolveEvidenceUrl(
      repo,
      "Smart-School-NEW : Mengubah View Tabel Murid untuk Menyesuaikan Tampilan Data Siswa",
      "resources/views/murid/tabel-murid.blade.php",
      config,
    ),
  ).toBe("http://127.0.0.1:8000/murid");
});

test("resolveEvidenceUrl can analyze repo routes when env rules are empty", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "yijiexhris-evidence-"));
  tempDirs.push(repoRoot);
  mkdirSync(path.join(repoRoot, "routes"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "routes", "web.php"),
    "<?php Route::get('/murid', function () { return view('murid.tabel-murid'); });",
    "utf8",
  );

  const repo: RepoActivity = {
    name: "Smart-School-NEW",
    path: repoRoot,
    branch: "main",
    commitsToday: [],
    commitDetails: [],
    committedFilesToday: ["resources/views/murid/tabel-murid.blade.php"],
    workingTreeFiles: [],
    workingTreeFileChangeStats: [],
    fileChangeStats: [
      {
        path: "resources/views/murid/tabel-murid.blade.php",
        additions: 14,
        deletions: 2,
        changeCount: 16,
        sources: ["committed"],
      },
    ],
    isDirty: false,
    errors: [],
  };

  const config: AppConfig = {
    groqApiKey: "x",
    groqBaseUrl: "https://api.groq.com/openai/v1",
    groqModel: "openai/gpt-oss-20b",
    groqAnalysisModel: "openai/gpt-oss-20b",
    groqAnalysisMaxRequests: 40,
    projectRepos: [],
    projectBaseDirs: [],
    discoveryIgnoreNames: [],
    projectPreviewUrls: {
      "Smart-School-NEW": "http://127.0.0.1:8000",
    },
    projectRunCommands: {},
    projectRouteRules: {},
    projectWebAuth: {},
    projectAliases: {},
    hrisLoginUrl: undefined,
    hrisCardsUrl: undefined,
    hrisApiMethod: "POST",
    hrisEmail: undefined,
    hrisPassword: undefined,
    hrisListId: undefined,
    hrisCardLimit: 5,
    hrisApiToken: undefined,
    hrisAuthHeader: "Authorization",
    hrisTokenPrefix: "Bearer",
    hrisHeaders: {},
    hrisPayloadStatic: {},
    hrisCardChecklists: [],
    hrisSendDescription: true,
    hrisSendEvidence: true,
    hrisEvidenceMode: "auto",
    hrisEvidenceDir: "./reports/evidence",
    hrisBrowserPath: undefined,
    hrisCodeScreenshotStyle: "ray",
    hrisCodeScreenshotStrict: false,
    hrisDevServerWaitMs: 12000,
    hrisEmployeeId: undefined,
    outputDir: "./reports",
    maxCommitsPerRepo: 15,
    maxFilesPerRepo: 30,
    analysisMinFileChangeCount: 2,
    analysisMinUnitChangeCount: 8,
    scheduleTime: undefined,
    scheduleRunOnStart: true,
  };

  expect(
    await resolveEvidenceUrl(
      repo,
      "Smart-School-NEW : Mengubah View Tabel Murid untuk Menyesuaikan Tampilan Data Siswa",
      "resources/views/murid/tabel-murid.blade.php",
      config,
    ),
  ).toBe("http://127.0.0.1:8000/murid");
});
