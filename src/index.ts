import { assertAnalyzeConfig, assertScheduleConfig, assertSendConfig, loadConfig } from "./config";
import {
  printAnalysisReport,
  printCollectionSummary,
  printDeliveryResult,
  runAnalysis,
  runCollection,
  runSend,
} from "./services/report-runner";
import { getNextRunAt } from "./utils/date";

type Command = "collect" | "analyze" | "send" | "run" | "schedule" | "help";

function getCommand(): Command {
  const raw = (Bun.argv[2] ?? "run").toLowerCase();
  if (["collect", "analyze", "send", "run", "schedule", "help", "--help", "-h"].includes(raw)) {
    if (raw === "--help" || raw === "-h") {
      return "help";
    }
    return raw as Command;
  }

  throw new Error(`Unknown command "${raw}". Use help to see available commands.`);
}

function hasJsonFlag(): boolean {
  return Bun.argv.slice(3).includes("--json");
}

function printHelp(): void {
  console.log("Usage:");
  console.log("  bun run collect [--json]");
  console.log("  bun run analyze [--json]");
  console.log("  bun run send [--json]");
  console.log("  bun run run [--json]");
  console.log("  bun run schedule");
}

async function runOnce(command: Exclude<Command, "schedule" | "help">): Promise<void> {
  const config = loadConfig();
  const asJson = hasJsonFlag();

  if (command === "collect") {
    const { collection, artifacts } = await runCollection(config);
    if (asJson) {
      console.log(JSON.stringify({ collection, artifacts }, null, 2));
      return;
    }

    printCollectionSummary(collection);
    if (artifacts.rawFile) {
      console.log(`\nRaw report saved to ${artifacts.rawFile}`);
    }
    return;
  }

  assertAnalyzeConfig(config);

  if (command === "analyze") {
    const { collection, report, artifacts } = await runAnalysis(config);
    if (asJson) {
      console.log(JSON.stringify({ collection, report, artifacts }, null, 2));
      return;
    }

    printCollectionSummary(collection);
    console.log("");
    printAnalysisReport(report);
    if (artifacts.analysisFile) {
      console.log(`\nAnalysis saved to ${artifacts.analysisFile}`);
    }
    return;
  }

  assertSendConfig(config);
  const { collection, report, delivery, artifacts } = await runSend(config);
  if (asJson) {
    console.log(JSON.stringify({ collection, report, delivery, artifacts }, null, 2));
    return;
  }

  printCollectionSummary(collection);
  console.log("");
  printAnalysisReport(report);
  printDeliveryResult(delivery);

  if (artifacts.payloadFile) {
    console.log(`Payload saved to ${artifacts.payloadFile}`);
  }
}

async function runScheduler(): Promise<void> {
  const config = loadConfig();
  assertAnalyzeConfig(config);
  assertSendConfig(config);
  assertScheduleConfig(config);

  const scheduleTime = config.scheduleTime!;

  if (config.scheduleRunOnStart) {
    console.log(`[scheduler] running immediately at ${new Date().toISOString()}`);
    await runOnce("run");
  }

  while (true) {
    const nextRun = getNextRunAt(scheduleTime);
    const waitMs = Math.max(0, nextRun.getTime() - Date.now());
    console.log(`[scheduler] next run at ${nextRun.toISOString()}`);
    await Bun.sleep(waitMs);

    try {
      await runOnce("run");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[scheduler] run failed: ${message}`);
    }
  }
}

async function main(): Promise<void> {
  const command = getCommand();

  if (command === "help") {
    printHelp();
    return;
  }

  if (command === "schedule") {
    await runScheduler();
    return;
  }

  await runOnce(command);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
