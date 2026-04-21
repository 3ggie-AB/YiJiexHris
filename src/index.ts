import { assertAnalyzeConfig, assertScheduleConfig, assertSendConfig, loadConfig } from "./config";
import { loadProjectEnv } from "./utils/load-project-env";
import {
  printAnalysisReport,
  printCollectionSummary,
  printDeliveryResult,
  printPackageSummary,
  runAnalysis,
  runCollection,
  runPackageDeleteActivities,
  runPackageLoad,
  runPackageSend,
  runSend,
} from "./services/report-runner";
import { getNextRunAt } from "./utils/date";

loadProjectEnv();

type Command = "collect" | "analyze" | "send" | "run" | "schedule" | "activities" | "delete-activity" | "help";

interface CliOptions {
  json: boolean;
  packageCode?: string;
  packagePath?: string;
  reason?: string;
  selectors: string[];
}

function getCommand(): Command {
  const raw = (Bun.argv[2] ?? "run").toLowerCase();
  if (
    ["collect", "analyze", "send", "run", "schedule", "activities", "delete-activity", "help", "--help", "-h"].includes(
      raw,
    )
  ) {
    if (raw === "--help" || raw === "-h") {
      return "help";
    }
    return raw as Command;
  }

  throw new Error(`Unknown command "${raw}". Use help to see available commands.`);
}

function printHelp(): void {
  console.log("Usage:");
  console.log("  bun run collect [--json]");
  console.log("  bun run analyze [--json]");
  console.log("  bun run send [--json] [--code <kode> | --package <folder>]");
  console.log("  bun run run [--json]");
  console.log("  bun run activities [--json] (--code <kode> | --package <folder>)");
  console.log("  bun run delete-activity (--code <kode> | --package <folder>) <activity-id|nomor> [...]");
  console.log("  bun run schedule");
}

function parseCliOptions(): CliOptions {
  const args = Bun.argv.slice(3);
  const selectors: string[] = [];
  const options: CliOptions = {
    json: false,
    selectors,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--code") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--code membutuhkan nilai.");
      }
      options.packageCode = value;
      index += 1;
      continue;
    }

    if (arg === "--package") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--package membutuhkan path folder.");
      }
      options.packagePath = value;
      index += 1;
      continue;
    }

    if (arg === "--reason") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--reason membutuhkan nilai.");
      }
      options.reason = value;
      index += 1;
      continue;
    }

    selectors.push(arg);
  }

  return options;
}

function requirePackageReference(options: CliOptions): void {
  if (!options.packageCode && !options.packagePath) {
    throw new Error("Gunakan --code <kode> atau --package <folder>.");
  }
}

async function runOnce(command: Exclude<Command, "schedule" | "help">): Promise<void> {
  const config = loadConfig();
  const options = parseCliOptions();
  const asJson = options.json;

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

  if (command === "analyze") {
    assertAnalyzeConfig(config);
    const { collection, report, packageData, artifacts } = await runAnalysis(config);
    if (asJson) {
      console.log(JSON.stringify({ collection, report, packageData, artifacts }, null, 2));
      return;
    }

    printCollectionSummary(collection);
    console.log("");
    printPackageSummary(packageData);
    console.log("");
    printAnalysisReport(report, packageData.cards);
    if (artifacts.analysisFile) {
      console.log(`\nAnalysis saved to ${artifacts.analysisFile}`);
    }
    if (artifacts.packageDir) {
      console.log(`Reusable package  : ${artifacts.packageDir}`);
    }
    if (artifacts.packageCode) {
      console.log(`Package code      : ${artifacts.packageCode}`);
    }
    return;
  }

  if (command === "activities") {
    requirePackageReference(options);
    const packageData = await runPackageLoad(config, options);
    if (asJson) {
      console.log(JSON.stringify({ packageData }, null, 2));
      return;
    }

    printPackageSummary(packageData);
    console.log("");
    printAnalysisReport(packageData.report, packageData.cards);
    return;
  }

  if (command === "delete-activity") {
    requirePackageReference(options);
    const packageData = await runPackageDeleteActivities(config, {
      packageCode: options.packageCode,
      packagePath: options.packagePath,
      selectors: options.selectors,
      reason: options.reason,
    });
    if (asJson) {
      console.log(JSON.stringify({ packageData }, null, 2));
      return;
    }

    printPackageSummary(packageData);
    console.log("");
    printAnalysisReport(packageData.report, packageData.cards);
    return;
  }

  if (command === "send" && (options.packageCode || options.packagePath)) {
    assertSendConfig(config);
    const { packageData, delivery, artifacts } = await runPackageSend(config, options);
    if (asJson) {
      console.log(JSON.stringify({ packageData, delivery, artifacts }, null, 2));
      return;
    }

    printPackageSummary(packageData);
    console.log("");
    printAnalysisReport(packageData.report, packageData.cards);
    printDeliveryResult(delivery);

    if (artifacts.payloadFile) {
      console.log(`Payload saved to ${artifacts.payloadFile}`);
    }
    return;
  }

  assertAnalyzeConfig(config);
  assertSendConfig(config);
  const { collection, report, packageData, delivery, artifacts } = await runSend(config);
  if (asJson) {
    console.log(JSON.stringify({ collection, report, packageData, delivery, artifacts }, null, 2));
    return;
  }

  printCollectionSummary(collection);
  console.log("");
  printPackageSummary(packageData);
  console.log("");
  printAnalysisReport(report, packageData.cards);
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
