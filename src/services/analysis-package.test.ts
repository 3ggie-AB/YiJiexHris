import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AiAnalysisReport, CollectedActivity, PreparedHrisCard } from "../types";
import { deletePackageActivities, loadAnalysisPackage, writeAnalysisPackage } from "./analysis-package";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createCollection(): CollectedActivity {
  return {
    generatedAt: "2026-04-18T10:00:00.000Z",
    reportDate: "2026-04-18",
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
  };
}

function createReport(): AiAnalysisReport {
  return {
    generatedAt: "2026-04-18T10:00:00.000Z",
    reportDate: "2026-04-18",
    productivityScore: 82,
    overallSummary: "Fokus mengerjakan ERP dan Smart School.",
    focusAreas: ["ERP", "Smart School"],
    achievements: ["Menyelesaikan migrasi sertifikat"],
    blockers: [],
    improvements: [],
    nextPriorities: [],
    activities: [
      "ERP : Menambahkan Migrasi Sertifikat Project",
      "Smart School : Memperbarui View Form Murid",
    ],
    confidence: "high",
    projectInsights: [
      {
        project: "ERP",
        status: "active",
        summary: "Perubahan migrasi",
        commitCount: 2,
        changedFilesCount: 4,
      },
    ],
  };
}

function createCards(): PreparedHrisCard[] {
  return [
    {
      id: "ACT-001",
      index: 1,
      activity: "ERP : Menambahkan Migrasi Sertifikat Project",
      title: "ERP : Menambahkan Migrasi Sertifikat Project",
      payload: {
        list_id: 0,
        title: "ERP : Menambahkan Migrasi Sertifikat Project",
        description: "",
        checklists: [],
        buktiPath: "D:/reports/evidence/erp-sertifikat.png",
      },
      deleted: false,
      repository: "ERP",
      relevantFile: "database/migrations/2026_04_18_add_certificate_to_projects_table.php",
      evidenceMode: "code",
      evidencePath: "D:/reports/evidence/erp-sertifikat.png",
    },
    {
      id: "ACT-002",
      index: 2,
      activity: "Smart School : Memperbarui View Form Murid",
      title: "Smart School : Memperbarui View Form Murid",
      payload: {
        list_id: 0,
        title: "Smart School : Memperbarui View Form Murid",
        description: "",
        checklists: [],
        buktiPath: "D:/reports/evidence/smart-school-form.png",
      },
      deleted: false,
      repository: "Smart School",
      relevantFile: "resources/views/murid/form.blade.php",
      evidenceMode: "url",
      evidenceUrl: "http://127.0.0.1:8000/murid/form",
      evidencePath: "D:/reports/evidence/smart-school-form.png",
    },
  ];
}

test("writeAnalysisPackage persists reusable analysis folder and normalizes active activities", async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), "yijiexhris-package-"));
  tempDirs.push(outputDir);

  const pkg = await writeAnalysisPackage({ outputDir }, createCollection(), createReport(), createCards());
  const loaded = await loadAnalysisPackage({ outputDir }, { packageCode: pkg.manifest.packageCode });

  expect(pkg.packageDir).toContain(path.join(outputDir, "packages"));
  expect(loaded.manifest.packageCode).toBe(pkg.manifest.packageCode);
  expect(loaded.manifest.activeActivityCount).toBe(2);
  expect(loaded.report.activities).toEqual([
    "ERP : Menambahkan Migrasi Sertifikat Project",
    "Smart School : Memperbarui View Form Murid",
  ]);
  expect(loaded.cards[1]?.evidenceUrl).toBe("http://127.0.0.1:8000/murid/form");
});

test("deletePackageActivities can remove activity by active index and update analysis view", async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), "yijiexhris-package-"));
  tempDirs.push(outputDir);

  const pkg = await writeAnalysisPackage({ outputDir }, createCollection(), createReport(), createCards());
  const updated = await deletePackageActivities({
    outputDir,
  }, {
    packageCode: pkg.manifest.packageCode,
    selectors: ["2"],
  });

  expect(updated.manifest.activeActivityCount).toBe(1);
  expect(updated.manifest.deletedActivityCount).toBe(1);
  expect(updated.report.activities).toEqual(["ERP : Menambahkan Migrasi Sertifikat Project"]);
  expect(updated.cards[1]?.deleted).toBe(true);
  expect(updated.cards[1]?.deletedReason).toBe("deleted-from-terminal");
});
