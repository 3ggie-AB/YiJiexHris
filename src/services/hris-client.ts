import type {
  AiAnalysisReport,
  AppConfig,
  CollectedActivity,
  HrisCardPayload,
  HrisCreatedCardResult,
  HrisDeliveryResult,
} from "../types";
import { attachEvidenceToCards } from "./evidence-provider";

interface HrisBoardList {
  id?: unknown;
  date?: unknown;
}

function parseMaybeJson(raw: string): unknown {
  if (!raw.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function appendCardField(formData: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    formData.append(key, "");
    return;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    formData.append(key, String(value));
    return;
  }

  formData.append(key, JSON.stringify(value));
}

export function buildCardFormData(payload: HrisCardPayload): FormData {
  const formData = new FormData();

  appendCardField(formData, "title", payload.title);
  appendCardField(formData, "description", payload.description);
  appendCardField(formData, "list_id", payload.list_id);
  if (payload.buktiPath) {
    const file = Bun.file(payload.buktiPath, { type: payload.buktiContentType || "image/png" });
    formData.append("bukti", file, payload.buktiFilename || "bukti.png");
  }

  payload.checklists.forEach((checklist, index) => {
    if (typeof checklist.id === "number") {
      appendCardField(formData, `checklists[${index}][id]`, checklist.id);
    }
    appendCardField(formData, `checklists[${index}][title]`, checklist.title);
    appendCardField(formData, `checklists[${index}][checklist]`, checklist.checklist);
    appendCardField(formData, `checklists[${index}][position]`, checklist.position);
  });

  for (const [key, value] of Object.entries(payload)) {
    if (
      key === "title" ||
      key === "description" ||
      key === "list_id" ||
      key === "checklists" ||
      key === "buktiPath" ||
      key === "buktiFilename" ||
      key === "buktiContentType"
    ) {
      continue;
    }

    appendCardField(formData, key, value);
  }

  return formData;
}

async function safeFetch(url: string, init: RequestInit, context: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${context} failed for ${url}: ${message}`);
  }
}

function normalizeTitle(raw: string): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function buildCardTitle(primaryProject: string, activity: string, fallbackLabel: string): string {
  const scopedActivity = activity.trim() || fallbackLabel;
  if (scopedActivity.includes(" : ")) {
    return normalizeTitle(scopedActivity);
  }

  return normalizeTitle(`${primaryProject} : ${scopedActivity}`);
}

function getPrimaryProject(report: AiAnalysisReport): string {
  return (
    report.projectInsights.find((item) => item.status === "active")?.project ??
    report.projectInsights[0]?.project ??
    report.focusAreas[0] ??
    "Daily Report"
  );
}

function buildCardDescription(
  report: AiAnalysisReport,
  collection: CollectedActivity,
  config: AppConfig,
  activity: string,
): string {
  if (!config.hrisSendDescription) {
    return "";
  }

  const sections = [
    `Tanggal: ${report.reportDate}`,
    `Aktivitas: ${activity}`,
    `Ringkasan: ${report.overallSummary}`,
    `Productivity Score: ${report.productivityScore}/100`,
    `Confidence: ${report.confidence}`,
    `Focus: ${report.focusAreas.join(", ") || "-"}`,
    `Achievements: ${report.achievements.join(" | ") || "-"}`,
    `Blockers: ${report.blockers.join(" | ") || "-"}`,
    `Improvements: ${report.improvements.join(" | ") || "-"}`,
    `Next Priorities: ${report.nextPriorities.join(" | ") || "-"}`,
    `Metrics: commits=${collection.metrics.totalCommits}, repos_active=${collection.metrics.activeProjectCount}, files=${collection.metrics.uniqueFilesTouched}`,
  ];

  if (config.hrisEmployeeId) {
    sections.unshift(`Employee ID: ${config.hrisEmployeeId}`);
  }

  return sections.join("\n");
}

export function buildHrisCardPayloads(
  report: AiAnalysisReport,
  collection: CollectedActivity,
  config: AppConfig,
  listIdOverride?: number,
): HrisCardPayload[] {
  const resolvedListId = listIdOverride ?? config.hrisListId;
  if (!resolvedListId) {
    throw new Error("HRIS_LIST_ID is not configured.");
  }

  const primaryProject = getPrimaryProject(report);
  const baseActivities = report.activities.length > 0 ? report.activities : [report.overallSummary];
  const limitedActivities = baseActivities.slice(0, config.hrisCardLimit);

  return limitedActivities.map((activity, index) => ({
    list_id: resolvedListId,
    title: buildCardTitle(primaryProject, activity, `Aktivitas ${index + 1}`),
    description: buildCardDescription(report, collection, config, activity || `Aktivitas ${index + 1}`),
    checklists: config.hrisCardChecklists.map((checklist) => ({
      ...checklist,
      checklist: "yes",
    })),
    ...config.hrisPayloadStatic,
  }));
}

async function loginToHris(config: AppConfig): Promise<{ token: string; tokenSource: "login" | "env_token" }> {
  if (config.hrisApiToken) {
    return {
      token: config.hrisApiToken,
      tokenSource: "env_token",
    };
  }

  if (!config.hrisLoginUrl || !config.hrisEmail || !config.hrisPassword) {
    throw new Error("HRIS login configuration is incomplete.");
  }

  const response = await safeFetch(
    config.hrisLoginUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.hrisHeaders,
      },
      body: JSON.stringify({
        email: config.hrisEmail,
        password: config.hrisPassword,
      }),
    },
    "HRIS login",
  );

  const responseText = await response.text();
  const responseBody = parseMaybeJson(responseText);

  if (!response.ok) {
    throw new Error(
      `HRIS login failed with status ${response.status} for ${config.hrisLoginUrl}: ${JSON.stringify(responseBody)}`,
    );
  }

  const token =
    responseBody &&
    typeof responseBody === "object" &&
    !Array.isArray(responseBody) &&
    typeof (responseBody as Record<string, unknown>).token === "string"
      ? ((responseBody as Record<string, unknown>).token as string)
      : undefined;

  if (!token) {
    throw new Error(`HRIS login succeeded but token is missing in response from ${config.hrisLoginUrl}.`);
  }

  return {
    token,
    tokenSource: "login",
  };
}

function buildAuthorizedHeaders(token: string, config: AppConfig): Record<string, string> {
  const prefix = config.hrisTokenPrefix.trim();
  const authValue = prefix ? `${prefix} ${token}` : token;

  return {
    Accept: "application/json",
    ...config.hrisHeaders,
    [config.hrisAuthHeader]: authValue,
  };
}

function buildBoardListsUrl(config: AppConfig): string | undefined {
  if (config.hrisBoardListsUrl) {
    return config.hrisBoardListsUrl;
  }

  if (!config.hrisBoardId) {
    return undefined;
  }

  const sourceUrl = config.hrisCardsUrl ?? config.hrisLoginUrl;
  if (!sourceUrl) {
    return undefined;
  }

  const url = new URL(sourceUrl);
  const apiPrefix = url.pathname.match(/^(.*\/api)(?:\/.*)?$/)?.[1] ?? url.pathname.replace(/\/[^/]*\/?$/, "");

  url.pathname = `${apiPrefix.replace(/\/$/, "")}/boards/${config.hrisBoardId}/generate-lists`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

async function resolveHrisListId(reportDate: string, token: string, config: AppConfig): Promise<number> {
  if (!config.hrisBoardId) {
    if (!config.hrisListId) {
      throw new Error("HRIS_LIST_ID is not configured.");
    }

    return config.hrisListId;
  }

  const boardListsUrl = buildBoardListsUrl(config);
  if (!boardListsUrl) {
    throw new Error("Unable to resolve HRIS board lists URL.");
  }

  const response = await safeFetch(
    boardListsUrl,
    {
      method: "POST",
      headers: buildAuthorizedHeaders(token, config),
    },
    `HRIS get board lists for board ${config.hrisBoardId}`,
  );

  const responseText = await response.text();
  const responseBody = parseMaybeJson(responseText);

  if (!response.ok) {
    throw new Error(
      `HRIS board lists request failed with status ${response.status} for ${boardListsUrl}: ${JSON.stringify(responseBody)}`,
    );
  }

  if (!Array.isArray(responseBody)) {
    throw new Error(`HRIS board lists response is not an array for ${boardListsUrl}.`);
  }

  const matchedList = responseBody.find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    const candidate = item as HrisBoardList;
    return typeof candidate.id === "number" && candidate.date === reportDate;
  }) as HrisBoardList | undefined;

  if (!matchedList || typeof matchedList.id !== "number") {
    const availableDates = responseBody
      .filter((item): item is HrisBoardList => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => item.date)
      .filter((item): item is string => typeof item === "string")
      .slice(0, 10);

    throw new Error(
      `No HRIS list found for date ${reportDate} on board ${config.hrisBoardId}. Available dates: ${availableDates.join(", ") || "-"}`,
    );
  }

  return matchedList.id;
}

async function createCard(
  payload: HrisCardPayload,
  token: string,
  config: AppConfig,
): Promise<HrisCreatedCardResult> {
  if (!config.hrisCardsUrl) {
    throw new Error("HRIS_CARDS_URL is not configured.");
  }

  const formData = buildCardFormData(payload);

  const response = await safeFetch(
    config.hrisCardsUrl,
    {
      method: config.hrisApiMethod,
      headers: buildAuthorizedHeaders(token, config),
      body: formData,
    },
    `HRIS create card "${payload.title}"`,
  );

  const responseText = await response.text();
  const responseBody = parseMaybeJson(responseText);

  return {
    title: payload.title,
    status: response.status,
    ok: response.ok,
    request: payload,
    responseBody,
  };
}

export async function sendReportToHris(
  report: AiAnalysisReport,
  collection: CollectedActivity,
  config: AppConfig,
): Promise<HrisDeliveryResult> {
  if (!config.hrisCardsUrl) {
    throw new Error("HRIS_CARDS_URL is not configured.");
  }

  const { token, tokenSource } = await loginToHris(config);
  const listId = await resolveHrisListId(report.reportDate, token, config);
  const cards = await attachEvidenceToCards(
    buildHrisCardPayloads(report, collection, config, listId),
    collection,
    config,
  );
  const createdCards: HrisCreatedCardResult[] = [];

  for (const payload of cards) {
    const result = await createCard(payload, token, config);
    createdCards.push(result);
  }

  const status = createdCards.every((item) => item.ok)
    ? 201
    : createdCards.find((item) => !item.ok)?.status ?? 500;
  const ok = createdCards.length > 0 && createdCards.every((item) => item.ok);

  return {
    loginUrl: config.hrisLoginUrl,
    url: config.hrisCardsUrl,
    method: config.hrisApiMethod,
    status,
    ok,
    responseBody: createdCards.map((item) => item.responseBody),
    payload: {
      tokenSource,
      cards,
    },
    createdCards,
  };
}
