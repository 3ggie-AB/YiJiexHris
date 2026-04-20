import type {
  AnalysisPackage,
  AiAnalysisReport,
  AppConfig,
  CollectedActivity,
  HrisDeliveryResult,
  PipelineArtifacts,
  PreparedHrisCard,
} from "../types";
import { writeJsonArtifact } from "../utils/artifacts";
import { deletePackageActivities, listActivePackageCards, loadAnalysisPackage, writeAnalysisPackage } from "./analysis-package";
import { collectActivity } from "./git-collector";
import { analyzeActivity } from "./groq-analyzer";
import { prepareHrisCardsForPackage, sendPreparedCards } from "./hris-client";

export async function runCollection(config: AppConfig): Promise<{
  collection: CollectedActivity;
  artifacts: PipelineArtifacts;
}> {
  const collection = await collectActivity(config);
  const rawFile = await writeJsonArtifact(config.outputDir, `raw-${collection.reportDate}.json`, collection);

  return {
    collection,
    artifacts: {
      rawFile,
    },
  };
}

export async function runAnalysis(config: AppConfig): Promise<{
  collection: CollectedActivity;
  report: AiAnalysisReport;
  packageData: AnalysisPackage;
  artifacts: PipelineArtifacts;
}> {
  const { collection, artifacts } = await runCollection(config);
  const report = await analyzeActivity(collection, config);
  const analysisFile = await writeJsonArtifact(config.outputDir, `analysis-${report.reportDate}.json`, report);
  const preparedCards = await prepareHrisCardsForPackage(report, collection, config);
  const packageData = await writeAnalysisPackage(config, collection, report, preparedCards);

  return {
    collection,
    report: packageData.report,
    packageData,
    artifacts: {
      ...artifacts,
      analysisFile,
      packageDir: packageData.packageDir,
      packageCode: packageData.manifest.packageCode,
    },
  };
}

export async function runSend(config: AppConfig): Promise<{
  collection: CollectedActivity;
  report: AiAnalysisReport;
  packageData: AnalysisPackage;
  delivery: HrisDeliveryResult;
  artifacts: PipelineArtifacts;
}> {
  const { collection, report, packageData, artifacts } = await runAnalysis(config);
  const delivery = await sendPreparedCards(
    listActivePackageCards(packageData.cards).map((card) => card.payload),
    report.reportDate,
    config,
  );
  const payloadFile = await writeJsonArtifact(config.outputDir, `payload-${report.reportDate}.json`, delivery.payload);

  return {
    collection,
    report,
    packageData,
    delivery,
    artifacts: {
      ...artifacts,
      payloadFile,
    },
  };
}

export async function runPackageSend(
  config: AppConfig,
  options: { packageCode?: string; packagePath?: string },
): Promise<{
  packageData: AnalysisPackage;
  delivery: HrisDeliveryResult;
  artifacts: PipelineArtifacts;
}> {
  const packageData = await loadAnalysisPackage(config, options);
  const activeCards = listActivePackageCards(packageData.cards);
  const delivery = await sendPreparedCards(
    activeCards.map((card) => card.payload),
    packageData.report.reportDate,
    config,
  );
  const payloadFile = await writeJsonArtifact(
    config.outputDir,
    `payload-${packageData.report.reportDate}-${packageData.manifest.packageCode}.json`,
    delivery.payload,
  );

  return {
    packageData,
    delivery,
    artifacts: {
      payloadFile,
      packageDir: packageData.packageDir,
      packageCode: packageData.manifest.packageCode,
    },
  };
}

export async function runPackageDeleteActivities(
  config: AppConfig,
  options: { packageCode?: string; packagePath?: string; selectors: string[]; reason?: string },
): Promise<AnalysisPackage> {
  return deletePackageActivities(config, options);
}

export async function runPackageLoad(
  config: AppConfig,
  options: { packageCode?: string; packagePath?: string },
): Promise<AnalysisPackage> {
  return loadAnalysisPackage(config, options);
}

export function printCollectionSummary(collection: CollectedActivity): void {
  console.log(`Report date       : ${collection.reportDate}`);
  console.log(`Timezone          : ${collection.timezone}`);
  console.log(`Projects scanned  : ${collection.metrics.projectCount}`);
  console.log(`Active projects   : ${collection.metrics.activeProjectCount}`);
  console.log(`Commits today     : ${collection.metrics.totalCommits}`);
  console.log(`Dirty repos       : ${collection.metrics.dirtyRepoCount}`);
  console.log(`Unique files      : ${collection.metrics.uniqueFilesTouched}`);
  console.log("");

  for (const repo of collection.repositories) {
    const touchedFiles = new Set([
      ...repo.committedFilesToday,
      ...repo.workingTreeFiles.map((file) => file.path),
    ]).size;
    console.log(
      `- ${repo.displayName || repo.name}: commits=${repo.commitsToday.length}, touched_files=${touchedFiles}, dirty=${repo.isDirty ? "yes" : "no"}`,
    );
  }
}

export function printAnalysisReport(report: AiAnalysisReport, cards: PreparedHrisCard[] = []): void {
  console.log(`Productivity score: ${report.productivityScore}/100`);
  console.log(`Confidence        : ${report.confidence}`);
  console.log(`Summary           : ${report.overallSummary}`);
  console.log(`Focus             : ${report.focusAreas.join(", ") || "-"}`);

  if (report.achievements.length > 0) {
    console.log(`Achievements      : ${report.achievements.join(" | ")}`);
  }

  if (report.blockers.length > 0) {
    console.log(`Blockers          : ${report.blockers.join(" | ")}`);
  }
  console.log("");

  console.log("Activities:");
  if (cards.length === 0) {
    for (const activity of report.activities) {
      console.log(`- ${activity}`);
    }
  } else {
    for (const card of cards) {
      const state = card.deleted ? "deleted" : "active";
      console.log(`- [${card.id}] ${card.title} (${state})`);
      console.log(`  repo       : ${card.repository || "-"}`);
      console.log(`  file       : ${card.relevantFile || "-"}`);
      console.log(`  evidence   : ${card.evidenceMode}`);
      console.log(`  preview    : ${card.evidenceUrl || "-"}`);
      console.log(`  screenshot : ${card.evidencePath || "-"}`);
      if (card.evidenceError) {
        console.log(`  error      : ${card.evidenceError}`);
      }
    }
  }

  console.log("");
  console.log("Projects:");
  for (const item of report.projectInsights) {
    console.log(
      `- ${item.project}: ${item.status}, commits=${item.commitCount}, changed_files=${item.changedFilesCount}, summary=${item.summary}`,
    );
  }

  if (report.improvements.length > 0) {
    console.log("");
    console.log("Improvements:");
    for (const improvement of report.improvements) {
      console.log(`- ${improvement}`);
    }
  }

  if (report.nextPriorities.length > 0) {
    console.log("");
    console.log("Next priorities:");
    for (const priority of report.nextPriorities) {
      console.log(`- ${priority}`);
    }
  }
}

export function printPackageSummary(packageData: AnalysisPackage): void {
  console.log(`Package code      : ${packageData.manifest.packageCode}`);
  console.log(`Package dir       : ${packageData.packageDir}`);
  console.log(`Created at        : ${packageData.manifest.createdAt}`);
  console.log(`Report date       : ${packageData.manifest.reportDate}`);
  console.log(`Activities active : ${packageData.manifest.activeActivityCount}/${packageData.manifest.activityCount}`);
}

export function printDeliveryResult(delivery: HrisDeliveryResult): void {
  console.log("");
  console.log(`HRIS delivery: ${delivery.ok ? "success" : "failed"} (${delivery.status})`);
  console.log(`${delivery.method} ${delivery.url}`);
  if (delivery.loginUrl) {
    console.log(`Login via        : ${delivery.loginUrl}`);
  }
  console.log(`Cards created    : ${delivery.createdCards.filter((item) => item.ok).length}/${delivery.createdCards.length}`);

  for (const card of delivery.createdCards) {
    console.log(`- [${card.ok ? "ok" : "failed"}] ${card.title} (${card.status})`);
  }

  if (!delivery.ok && delivery.responseBody !== undefined) {
    console.log(`Response: ${JSON.stringify(delivery.responseBody, null, 2)}`);
  }
}
