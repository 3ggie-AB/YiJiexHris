import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  AppConfig,
  CollectedActivity,
  HrisCardPayload,
  ProjectRouteRule,
  ProjectWebAuthConfig,
  RepoActivity,
} from "../types";

const UI_KEYWORDS = [
  "view",
  "blade",
  "ui",
  "ux",
  "halaman",
  "tampilan",
  "layout",
  "frontend",
  "css",
  "html",
  "table",
  "tabel",
];

const CODE_KEYWORDS = [
  "migration",
  "migrasi",
  "bug",
  "fix",
  "perbaiki",
  "service",
  "observer",
  "controller",
  "model",
  "api",
  "backend",
  "query",
  "database",
  "schema",
  "kolom",
];

const CODE_EXTENSIONS = [
  ".php",
  ".blade.php",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".sql",
  ".json",
  ".css",
  ".html",
];

const ROUTEABLE_FILE_ROOTS = [
  "resources/views/",
  "resources/js/pages/",
  "resources/js/page/",
  "resources/ts/pages/",
  "resources/ts/page/",
  "src/pages/",
  "src/app/",
  "app/livewire/",
  "app/http/livewire/",
];

const ROUTE_FILE_REGEXES = [
  /Route::(?:get|post|put|patch|delete|options|any|match|view)\s*\(\s*(['"`])([^'"`]+)\1/gi,
  /Route::resource\s*\(\s*(['"`])([^'"`]+)\1/gi,
  /Route::prefix\s*\(\s*(['"`])([^'"`]+)\1/gi,
] as const;

interface RouteCandidate {
  path: string;
  hint: string;
  source: string;
}

interface BrowserDebugSession {
  port: number;
  process: Bun.Subprocess;
  userDataDir: string;
}

interface ResolvedProjectWebAuthConfig extends ProjectWebAuthConfig {
  loginUrl: string;
  password: string;
}

function toEncodedPowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function escapePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePathSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function buildSearchTokens(value: string): string[] {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(/\s+/)
        .filter((token) => token.length >= 3),
    ),
  );
}

function cleanRouteSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/\.(blade\.php|vue|tsx|jsx|html|ts|js|php)$/i, "")
    .replace(/^(index|page|pages)$/i, "")
    .replace(/^(table|tabel|datatable|view|halaman|form|list)[-_]?/i, "")
    .replace(/^(create|edit|detail|show)[-_]?/i, "")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function getProjectNameFromTitle(title: string): string | undefined {
  const [projectName] = title.split(" : ");
  return projectName?.trim() || undefined;
}

export function findRepositoryForTitle(title: string, collection: CollectedActivity): RepoActivity | undefined {
  const projectName = getProjectNameFromTitle(title)?.toLowerCase();
  if (!projectName) {
    return undefined;
  }

  return collection.repositories.find(
    (repo) => repo.name.toLowerCase() === projectName || repo.displayName?.toLowerCase() === projectName,
  );
}

function isUiFile(filePath: string | undefined): boolean {
  if (!filePath) {
    return false;
  }

  const lowerPath = filePath.toLowerCase();
  return (
    lowerPath.endsWith(".blade.php") ||
    lowerPath.endsWith(".vue") ||
    lowerPath.endsWith(".tsx") ||
    lowerPath.endsWith(".jsx") ||
    lowerPath.endsWith(".html") ||
    lowerPath.endsWith(".css")
  );
}

function isLikelyCodeActivity(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return CODE_KEYWORDS.some((keyword) => lowerTitle.includes(keyword));
}

function isLikelyUiActivity(title: string, relevantFilePath: string | undefined): boolean {
  const lowerTitle = title.toLowerCase();
  if (isLikelyCodeActivity(title)) {
    return false;
  }

  if (isUiFile(relevantFilePath)) {
    return true;
  }

  return UI_KEYWORDS.some((keyword) => lowerTitle.includes(keyword));
}

function scoreFileForActivity(activity: string, filePath: string): number {
  const lowerActivity = activity.toLowerCase();
  const lowerPath = filePath.toLowerCase();
  const baseName = path.basename(lowerPath);
  let score = 0;
  const isUiActivity = isLikelyUiActivity(activity, filePath);
  const isCodeActivity = isLikelyCodeActivity(activity);

  for (const ext of CODE_EXTENSIONS) {
    if (lowerPath.endsWith(ext)) {
      score += 5;
      break;
    }
  }

  const tokens = lowerActivity.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  for (const token of tokens) {
    if (lowerPath.includes(token)) {
      score += 3;
    }
    if (baseName.includes(token)) {
      score += 4;
    }
  }

  if (isUiActivity && isUiFile(filePath)) {
    score += 12;
  }

  if (isCodeActivity && !isUiFile(filePath)) {
    score += 10;
  }

  if (lowerActivity.includes("migrasi") || lowerActivity.includes("migration")) {
    if (lowerPath.includes("migration")) {
      score += 12;
    }
  }

  if (lowerActivity.includes("bug") || lowerActivity.includes("fix") || lowerActivity.includes("perbaiki")) {
    if (lowerPath.includes("service") || lowerPath.includes("controller") || lowerPath.includes("repository")) {
      score += 4;
    }
  }

  if (isLikelyUiActivity(activity, undefined)) {
    if (lowerPath.endsWith(".blade.php") || lowerPath.endsWith(".vue") || lowerPath.endsWith(".tsx") || lowerPath.endsWith(".jsx")) {
      score += 8;
    }
  }

  return score;
}

function getFileChangeCount(repo: RepoActivity, filePath: string): number {
  return repo.fileChangeStats.find((item) => normalizePathSlashes(item.path) === normalizePathSlashes(filePath))?.changeCount ?? 0;
}

export function pickRelevantFile(title: string, repo: RepoActivity | undefined): string | undefined {
  if (!repo) {
    return undefined;
  }

  const touchedFiles = new Map<string, number>();
  for (const filePath of [...repo.workingTreeFiles.map((file) => file.path), ...repo.committedFilesToday]) {
    touchedFiles.set(normalizePathSlashes(filePath), getFileChangeCount(repo, filePath));
  }
  for (const fileStat of repo.fileChangeStats) {
    const current = touchedFiles.get(normalizePathSlashes(fileStat.path)) ?? 0;
    touchedFiles.set(normalizePathSlashes(fileStat.path), Math.max(current, fileStat.changeCount));
  }

  const sorted = Array.from(touchedFiles.entries())
    .map(([filePath, changeCount]) => ({
      filePath,
      score: scoreFileForActivity(title, filePath) + Math.min(60, changeCount),
      changeCount,
    }))
    .sort((left, right) => right.score - left.score || right.changeCount - left.changeCount);

  return sorted[0]?.filePath;
}

export function inferRoutePathFromFile(filePath: string): string | undefined {
  const normalized = normalizePathSlashes(filePath);
  const lowerPath = normalized.toLowerCase();

  let relative: string | undefined;
  for (const root of ROUTEABLE_FILE_ROOTS) {
    const rootIndex = lowerPath.indexOf(root);
    if (rootIndex === -1) {
      continue;
    }

    relative = normalized.slice(rootIndex + root.length);
    break;
  }

  if (!relative) {
    return undefined;
  }

  relative = relative.replace(/\.blade\.php$/i, "").replace(/\.(vue|tsx|jsx|html|ts|js|php)$/i, "");

  const segments = relative
    .split("/")
    .map((segment) => cleanRouteSegment(segment))
    .filter(Boolean);

  if (segments.length === 0) {
    return undefined;
  }

  const deduped = segments.filter((segment, index) => segment !== segments[index - 1]);
  return `/${deduped.join("/")}`;
}

function joinUrl(baseUrl: string, routePath: string): string {
  if (routePath === "/") {
    return baseUrl.replace(/\/+$/, "");
  }

  return `${baseUrl.replace(/\/+$/, "")}/${routePath.replace(/^\/+/, "")}`;
}

function resolveProjectWebAuth(repo: RepoActivity, config: AppConfig): ResolvedProjectWebAuthConfig | undefined {
  const projectAuth = config.projectWebAuth[repo.name];
  if (!projectAuth) {
    return undefined;
  }

  const loginUrl =
    projectAuth.loginUrl ??
    (projectAuth.loginPath && config.projectPreviewUrls[repo.name]
      ? joinUrl(config.projectPreviewUrls[repo.name], projectAuth.loginPath)
      : projectAuth.loginPath);

  if (!loginUrl || !projectAuth.password) {
    return undefined;
  }

  return {
    ...projectAuth,
    loginUrl,
    password: projectAuth.password,
  };
}

function matchesRouteRule(rule: ProjectRouteRule, cardTitle: string, relevantFilePath: string | undefined): boolean {
  const haystack = `${normalizeText(cardTitle)} ${normalizeText(relevantFilePath ?? "")}`.trim();
  return buildSearchTokens(rule.match).every((token) => haystack.includes(token));
}

function normalizeRoutePath(rawPath: string): string {
  if (!rawPath.trim()) {
    return "/";
  }

  const cleaned = rawPath
    .replace(/^[a-z]+:\/\/[^/]+/i, "")
    .replace(/\/\{[^/]+?\??\}/g, "")
    .replace(/\/+/g, "/")
    .trim();

  if (!cleaned || cleaned === "/") {
    return "/";
  }

  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function addRouteCandidate(output: Map<string, RouteCandidate>, candidate: RouteCandidate): void {
  const normalizedPath = normalizeRoutePath(candidate.path);
  if (!normalizedPath) {
    return;
  }

  const existing = output.get(normalizedPath);
  if (existing) {
    output.set(normalizedPath, {
      path: normalizedPath,
      hint: `${existing.hint} ${candidate.hint}`.trim(),
      source: existing.source,
    });
    return;
  }

  output.set(normalizedPath, {
    ...candidate,
    path: normalizedPath,
  });
}

async function listRouteFiles(repo: RepoActivity): Promise<string[]> {
  const routesDir = path.resolve(repo.path, "routes");
  try {
    const entries = await readdir(routesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".php"))
      .map((entry) => path.join(routesDir, entry.name));
  } catch {
    return [];
  }
}

function parseRouteCandidates(content: string, source: string): RouteCandidate[] {
  const flattened = content.replace(/\s+/g, " ");
  const output = new Map<string, RouteCandidate>();

  for (const regex of ROUTE_FILE_REGEXES) {
    for (const match of flattened.matchAll(regex)) {
      const rawPath = match[2]?.trim();
      if (!rawPath || rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
        continue;
      }

      addRouteCandidate(output, {
        path: rawPath,
        hint: match[0],
        source,
      });
    }
  }

  return Array.from(output.values());
}

async function discoverRouteCandidates(repo: RepoActivity): Promise<RouteCandidate[]> {
  const output = new Map<string, RouteCandidate>();

  for (const filePath of [
    ...repo.fileChangeStats.map((item) => item.path),
    ...repo.committedFilesToday,
    ...repo.workingTreeFiles.map((file) => file.path),
  ]) {
    const inferredPath = inferRoutePathFromFile(filePath);
    if (!inferredPath) {
      continue;
    }

    addRouteCandidate(output, {
      path: inferredPath,
      hint: filePath,
      source: "file",
    });
  }

  for (const routeFile of await listRouteFiles(repo)) {
    try {
      const content = await readFile(routeFile, "utf8");
      for (const candidate of parseRouteCandidates(content, `route:${path.basename(routeFile)}`)) {
        addRouteCandidate(output, candidate);
      }
    } catch {
      // Ignore unreadable route files and continue with other evidence.
    }
  }

  return Array.from(output.values());
}

function scoreRouteCandidate(
  candidate: RouteCandidate,
  cardTitle: string,
  relevantFilePath: string | undefined,
  inferredPath: string | undefined,
): number {
  const titleTokens = new Set(buildSearchTokens(cardTitle));
  const fileTokens = new Set(buildSearchTokens(relevantFilePath ?? ""));
  const pathTokens = buildSearchTokens(candidate.path);
  const hintTokens = new Set(buildSearchTokens(candidate.hint));
  let score = 0;

  if (candidate.path === inferredPath) {
    score += 30;
  }

  if (candidate.source.startsWith("route:")) {
    score += 4;
  }

  for (const token of pathTokens) {
    if (titleTokens.has(token)) {
      score += 7;
    }
    if (fileTokens.has(token)) {
      score += 10;
    }
  }

  for (const token of fileTokens) {
    if (hintTokens.has(token)) {
      score += 4;
    }
  }

  if (candidate.path === "/") {
    score -= 6;
  }

  return score;
}

export async function resolveEvidenceUrl(
  repo: RepoActivity,
  cardTitle: string,
  relevantFilePath: string | undefined,
  config: AppConfig,
): Promise<string | undefined> {
  const baseUrl = config.projectPreviewUrls[repo.name];
  const rules = config.projectRouteRules[repo.name] ?? [];

  for (const rule of rules) {
    if (!matchesRouteRule(rule, cardTitle, relevantFilePath)) {
      continue;
    }

    if (rule.url) {
      return rule.url;
    }

    if (rule.path && baseUrl) {
      return joinUrl(baseUrl, rule.path);
    }
  }

  const inferredPath = relevantFilePath ? inferRoutePathFromFile(relevantFilePath) : undefined;
  const discoveredCandidates = await discoverRouteCandidates(repo);
  const bestCandidate = discoveredCandidates
    .map((candidate) => ({
      candidate,
      score: scoreRouteCandidate(candidate, cardTitle, relevantFilePath, inferredPath),
    }))
    .sort((left, right) => right.score - left.score)
    .find((item) => item.score > 0)?.candidate;

  if (baseUrl && bestCandidate) {
    return joinUrl(baseUrl, bestCandidate.path);
  }

  if (baseUrl && inferredPath) {
    return joinUrl(baseUrl, inferredPath);
  }

  return baseUrl;
}

async function runAndCaptureOutput(args: string[], cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const process = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    return {
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

async function findBrowserPath(config: AppConfig): Promise<string | undefined> {
  const candidates = [
    config.hrisBrowserPath,
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function waitForDevToolsPort(userDataDir: string, timeoutMs = 10000): Promise<number | undefined> {
  const activePortFile = path.join(userDataDir, "DevToolsActivePort");
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await readFile(activePortFile, "utf8");
      const [portLine] = raw.split(/\r?\n/);
      const port = Number(portLine?.trim());
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    } catch {
      // Browser may still be starting.
    }

    await Bun.sleep(200);
  }

  return undefined;
}

async function startDebugBrowser(browserPath: string): Promise<BrowserDebugSession | undefined> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "yijiexhris-browser-"));
  const process = Bun.spawn(
    [
      browserPath,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,1024",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    {
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  const port = await waitForDevToolsPort(userDataDir);
  if (!port) {
    if (process.pid) {
      await stopProcessTree(process.pid);
    }
    await rm(userDataDir, { recursive: true, force: true });
    return undefined;
  }

  return {
    port,
    process,
    userDataDir,
  };
}

class CdpSession {
  private readonly socket: WebSocket;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
  private nextId = 1;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };

      if (typeof payload.id !== "number") {
        return;
      }

      const pending = this.pending.get(payload.id);
      if (!pending) {
        return;
      }

      this.pending.delete(payload.id);
      if (payload.error) {
        pending.reject(new Error(payload.error.message || "CDP command failed."));
        return;
      }

      pending.resolve(payload.result);
    });

    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("CDP socket closed."));
      }
      this.pending.clear();
    });
  }

  static async connect(webSocketDebuggerUrl: string): Promise<CdpSession> {
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Unable to connect to browser debug socket.")), {
        once: true,
      });
    });

    return new CdpSession(socket);
  }

  async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;

    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });

    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  close(): void {
    this.socket.close();
  }
}

async function getPageDebuggerUrl(port: number): Promise<string | undefined> {
  try {
    const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (listResponse.ok) {
      const pages = (await listResponse.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    }
  } catch {
    // Ignore and try to create a new page target.
  }

  try {
    const newPageResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    if (!newPageResponse.ok) {
      return undefined;
    }

    const page = (await newPageResponse.json()) as { webSocketDebuggerUrl?: string };
    return page.webSocketDebuggerUrl;
  } catch {
    return undefined;
  }
}

async function waitForDocumentReady(session: CdpSession, timeoutMs = 15000): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await session.send<{ result?: { value?: string } }>("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      const readyState = result?.result?.value;
      if (readyState === "interactive" || readyState === "complete") {
        return true;
      }
    } catch {
      // Page may still be navigating.
    }

    await Bun.sleep(250);
  }

  return false;
}

async function navigatePage(session: CdpSession, url: string): Promise<boolean> {
  await session.send("Page.navigate", { url });
  return waitForDocumentReady(session);
}

function buildLoginAutomationExpression(auth: ResolvedProjectWebAuthConfig): string {
  const emailSelector =
    auth.emailSelector || "input[type='email'], input[name='email'], input[name='username'], input[name='login']";
  const passwordSelector = auth.passwordSelector || "input[type='password'], input[name='password']";
  const submitSelector = auth.submitSelector || "button[type='submit'], input[type='submit']";

  return `
(() => {
  const emailSelector = ${JSON.stringify(emailSelector)};
  const passwordSelector = ${JSON.stringify(passwordSelector)};
  const submitSelector = ${JSON.stringify(submitSelector)};
  const emailValue = ${JSON.stringify(auth.email ?? "")};
  const passwordValue = ${JSON.stringify(auth.password)};

  const setValue = (element, value) => {
    if (!element) return false;
    const prototype = Object.getPrototypeOf(element);
    const descriptor =
      Object.getOwnPropertyDescriptor(prototype, "value") ||
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value") ||
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  const emailElement = document.querySelector(emailSelector);
  const passwordElement = document.querySelector(passwordSelector);
  const submitElement = document.querySelector(submitSelector);
  const form = submitElement?.form || passwordElement?.form || emailElement?.form;
  const emailOk = emailValue ? setValue(emailElement, emailValue) : true;
  const passwordOk = setValue(passwordElement, passwordValue);

  if (submitElement && typeof submitElement.click === "function") {
    submitElement.click();
    return { ok: emailOk && passwordOk, submitted: true, emailFound: !!emailElement, passwordFound: !!passwordElement };
  }

  if (form) {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else {
      form.submit();
    }
    return { ok: emailOk && passwordOk, submitted: true, emailFound: !!emailElement, passwordFound: !!passwordElement };
  }

  return { ok: false, submitted: false, emailFound: !!emailElement, passwordFound: !!passwordElement };
})()
`.trim();
}

async function authenticateBrowserPage(session: CdpSession, auth: ResolvedProjectWebAuthConfig): Promise<boolean> {
  const loaded = await navigatePage(session, auth.loginUrl);
  if (!loaded) {
    return false;
  }

  const loginResult = await session.send<{ result?: { value?: { ok?: boolean; submitted?: boolean } } }>(
    "Runtime.evaluate",
    {
      expression: buildLoginAutomationExpression(auth),
      returnByValue: true,
    },
  );

  const value = loginResult?.result?.value;
  if (!value?.submitted || value.ok === false) {
    return false;
  }

  await Bun.sleep(auth.postLoginWaitMs ?? 2500);
  return waitForDocumentReady(session, Math.max(5000, auth.postLoginWaitMs ?? 2500));
}

async function saveCdpScreenshot(session: CdpSession, outputFilePath: string): Promise<boolean> {
  const result = await session.send<{ data?: string }>("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  });

  if (!result?.data) {
    return false;
  }

  await Bun.write(outputFilePath, Buffer.from(result.data, "base64"));
  return fileExists(outputFilePath);
}

async function captureCodeScreenshot(
  sourceFilePath: string,
  outputFilePath: string,
  cardTitle: string,
): Promise<boolean> {
  const tokens = buildSearchTokens(cardTitle)
    .filter((token) => token.length >= 4)
    .slice(0, 8)
    .map((token) => `'${escapePowerShellLiteral(token)}'`)
    .join(", ");

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$SourceFile = '${escapePowerShellLiteral(sourceFilePath)}'
$OutputFile = '${escapePowerShellLiteral(outputFilePath)}'
$Title = '${escapePowerShellLiteral(cardTitle)}'
$Tokens = @(${tokens})
$Lines = Get-Content -LiteralPath $SourceFile -ErrorAction Stop
$MatchIndex = -1
for ($i = 0; $i -lt $Lines.Count; $i++) {
  $LineLower = $Lines[$i].ToLower()
  foreach ($Token in $Tokens) {
    if ($Token -and $LineLower.Contains($Token)) {
      $MatchIndex = $i
      break
    }
  }
  if ($MatchIndex -ge 0) { break }
}
if ($MatchIndex -lt 0) { $MatchIndex = [Math]::Min(15, [Math]::Max(0, $Lines.Count - 1)) }
$Start = [Math]::Max(0, $MatchIndex - 12)
$End = [Math]::Min($Lines.Count - 1, $Start + 31)
$Lines = $Lines[$Start..$End]
$StartLineNumber = $Start + 1
$Width = 1600
$LineHeight = 24
$Height = 120 + ($Lines.Count * $LineHeight)
$Bitmap = New-Object System.Drawing.Bitmap $Width, $Height
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Graphics.Clear([System.Drawing.Color]::FromArgb(22, 27, 34))
$Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$TitleFont = New-Object System.Drawing.Font 'Segoe UI Semibold', 16
$CodeFont = New-Object System.Drawing.Font 'Consolas', 14
$BrushTitle = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 241, 246, 252))
$BrushSub = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 138, 148, 158))
$BrushLine = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 123, 180, 255))
$BrushCode = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 233, 239, 245))
$Graphics.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 13, 17, 23))), 12, 12, ($Width - 24), ($Height - 24))
$Graphics.DrawString($Title, $TitleFont, $BrushTitle, 32, 26)
$Graphics.DrawString((Split-Path -Leaf $SourceFile), $CodeFont, $BrushSub, 32, 58)
$Y = 92
$Index = $StartLineNumber
foreach ($Line in $Lines) {
  $Graphics.DrawString(($Index.ToString().PadLeft(2)), $CodeFont, $BrushLine, 32, $Y)
  $Graphics.DrawString($Line, $CodeFont, $BrushCode, 84, $Y)
  $Y += $LineHeight
  $Index += 1
}
$Dir = Split-Path -Parent $OutputFile
if (!(Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
$Bitmap.Save($OutputFile, [System.Drawing.Imaging.ImageFormat]::Png)
$Graphics.Dispose()
$Bitmap.Dispose()
`;

  const result = await runAndCaptureOutput(
    ["powershell.exe", "-NoProfile", "-EncodedCommand", toEncodedPowerShell(script)],
  );

  return result.exitCode === 0 && (await fileExists(outputFilePath));
}

async function captureUrlScreenshot(
  url: string,
  outputFilePath: string,
  browserPath: string,
  repo: RepoActivity,
  config: AppConfig,
): Promise<boolean> {
  try {
    const projectAuth = resolveProjectWebAuth(repo, config);
    if (!projectAuth) {
      const result = await runAndCaptureOutput([
        browserPath,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=1440,1024",
        `--screenshot=${outputFilePath}`,
        url,
      ]);

      return result.exitCode === 0 && (await fileExists(outputFilePath));
    }

    const debugBrowser = await startDebugBrowser(browserPath);
    if (!debugBrowser) {
      return false;
    }

    let session: CdpSession | undefined;

    try {
      const pageDebuggerUrl = await getPageDebuggerUrl(debugBrowser.port);
      if (!pageDebuggerUrl) {
        return false;
      }

      session = await CdpSession.connect(pageDebuggerUrl);
      await session.send("Page.enable");
      await session.send("Runtime.enable");

      const isAuthenticated = await authenticateBrowserPage(session, projectAuth);
      if (!isAuthenticated) {
        return false;
      }

      const loaded = await navigatePage(session, url);
      if (!loaded) {
        return false;
      }

      await Bun.sleep(1200);
      const saved = await saveCdpScreenshot(session, outputFilePath);
      return saved;
    } finally {
      session?.close();
      if (debugBrowser.process.pid) {
        await stopProcessTree(debugBrowser.process.pid);
      }
      await rm(debugBrowser.userDataDir, { recursive: true, force: true });
    }
  } catch {
    return false;
  }
}

async function stopProcessTree(pid: number): Promise<void> {
  await runAndCaptureOutput(["taskkill", "/PID", String(pid), "/T", "/F"]);
}

async function startPreviewServer(repo: RepoActivity, config: AppConfig): Promise<Bun.Subprocess | undefined> {
  const command = config.projectRunCommands[repo.name];
  if (!command) {
    return undefined;
  }

  const script = `
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '${escapePowerShellLiteral(repo.path)}'
${command}
`;

  const process = Bun.spawn(
    ["powershell.exe", "-NoProfile", "-EncodedCommand", toEncodedPowerShell(script)],
    {
      cwd: repo.path,
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  await Bun.sleep(config.hrisDevServerWaitMs);
  return process;
}

function buildEvidenceOutputPath(config: AppConfig, repoName: string, cardTitle: string): string {
  const safeRepoName = sanitizeFilename(repoName || "repo");
  const safeTitle = sanitizeFilename(cardTitle || "evidence");
  return path.resolve(config.hrisEvidenceDir || "./reports/evidence", `${safeRepoName}-${safeTitle}.png`);
}

export async function attachEvidenceToCards(
  cards: HrisCardPayload[],
  collection: CollectedActivity,
  config: AppConfig,
): Promise<HrisCardPayload[]> {
  if (!config.hrisSendEvidence || config.hrisEvidenceMode === "none") {
    return cards;
  }

  await mkdir(path.resolve(config.hrisEvidenceDir || "./reports/evidence"), { recursive: true });

  const output: HrisCardPayload[] = [];

  for (const card of cards) {
    const repo = findRepositoryForTitle(card.title, collection);
    const relevantFile = pickRelevantFile(card.title, repo);
    const resolvedUrl = repo ? await resolveEvidenceUrl(repo, card.title, relevantFile, config) : undefined;
    const mode =
      config.hrisEvidenceMode === "auto"
        ? isLikelyUiActivity(card.title, relevantFile) && Boolean(resolvedUrl)
          ? "url"
          : "code"
        : config.hrisEvidenceMode;

    let buktiPath: string | undefined;
    let previewProcess: Bun.Subprocess | undefined;

    try {
      if (mode === "url" && repo) {
        const url = resolvedUrl;
        const browserPath = await findBrowserPath(config);
        if (url && browserPath) {
          previewProcess = await startPreviewServer(repo, config);
          const outputPath = buildEvidenceOutputPath(config, repo.name, card.title);
          const ok = await captureUrlScreenshot(url, outputPath, browserPath, repo, config);
          if (ok) {
            buktiPath = outputPath;
          }
        }
      }

      if (!buktiPath && repo) {
        const relativeFile = relevantFile;
        if (relativeFile) {
          const fullPath = path.resolve(repo.path, relativeFile);
          const outputPath = buildEvidenceOutputPath(config, repo.name, `${card.title}-code`);
          const ok = await captureCodeScreenshot(fullPath, outputPath, card.title);
          if (ok) {
            buktiPath = outputPath;
          }
        }
      }
    } catch {
      buktiPath = undefined;
    } finally {
      if (previewProcess?.pid) {
        await stopProcessTree(previewProcess.pid);
      }
    }

    output.push({
      ...card,
      buktiPath,
      buktiFilename: buktiPath ? path.basename(buktiPath) : undefined,
      buktiContentType: buktiPath ? "image/png" : undefined,
    });
  }

  return output;
}
