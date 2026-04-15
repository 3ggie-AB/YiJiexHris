import type {
  AiAnalysisReport,
  AppConfig,
  CollectedActivity,
  HrisDeliveryResult,
  PipelineArtifacts,
} from "../types";
import { writeJsonArtifact } from "../utils/artifacts";
import { collectActivity } from "./git-collector";
import { analyzeActivity } from "./groq-analyzer";
import { sendReportToHris } from "./hris-client";

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
  artifacts: PipelineArtifacts;
}> {
  const { collection, artifacts } = await runCollection(config);
  const report = await analyzeActivity(collection, config);
  const analysisFile = await writeJsonArtifact(config.outputDir, `analysis-${report.reportDate}.json`, report);

  return {
    collection,
    report,
    artifacts: {
      ...artifacts,
      analysisFile,
    },
  };
}

export async function runSend(config: AppConfig): Promise<{
  collection: CollectedActivity;
  report: AiAnalysisReport;
  delivery: HrisDeliveryResult;
  artifacts: PipelineArtifacts;
}> {
  const { collection, report, artifacts } = await runAnalysis(config);
  const delivery = await sendReportToHris(report, collection, config);
  const payloadFile = await writeJsonArtifact(config.outputDir, `payload-${report.reportDate}.json`, delivery.payload);

  return {
    collection,
    report,
    delivery,
    artifacts: {
      ...artifacts,
      payloadFile,
    },
  };
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

export function printAnalysisReport(report: AiAnalysisReport): void {
  console.log(`Productivity score: ${report.productivityScore}/100`);
  console.log(`Confidence        : ${report.confidence}`);
  console.log(`Summary           : ${report.overallSummary}`);
  console.log(`Focus             : ${report.focusAreas.join(", ") || "-"}`);
  console.log("");

  console.log("Activities:");
  for (const activity of report.activities) {
    console.log(`- ${activity}`);
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
