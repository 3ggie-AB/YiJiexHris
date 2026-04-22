import React, { startTransition, useDeferredValue, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button, buttonVariants, type ButtonSize, type ButtonVariant } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { cn } from "./lib/utils";
import type {
  AnalyzeResponse,
  CommitDetailResponse,
  DashboardResponse,
  FileContentResponse,
  HistoryResponse,
  PublicGitHubUser,
  RecentRunSummary,
  RunDetailResponse,
  SessionResponse,
  UpdateRepositoriesResponse,
} from "./api-types";
import type { GitHubRepositoryOption } from "./models";

type Route =
  | { kind: "home" }
  | { kind: "dashboard" }
  | { kind: "history" }
  | { kind: "run"; id: string }
  | { kind: "commit"; owner: string; repo: string; sha: string }
  | { kind: "file"; owner: string; repo: string; path: string; ref: string }
  | { kind: "not_found" };

type FlashState = { notice?: string; error?: string };

function escapePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function parseRoute(): Route {
  const { pathname, search } = window.location;

  if (pathname === "/") {
    return { kind: "home" };
  }

  if (pathname === "/dashboard") {
    return { kind: "dashboard" };
  }

  if (pathname === "/history") {
    return { kind: "history" };
  }

  const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    return { kind: "run", id: decodeURIComponent(runMatch[1]) };
  }

  const commitMatch = pathname.match(/^\/github\/commit\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (commitMatch) {
    return {
      kind: "commit",
      owner: decodeURIComponent(commitMatch[1]),
      repo: decodeURIComponent(commitMatch[2]),
      sha: decodeURIComponent(commitMatch[3]),
    };
  }

  if (pathname === "/github/file") {
    const params = new URLSearchParams(search);
    const owner = params.get("owner");
    const repo = params.get("repo");
    const filePath = params.get("path");
    const ref = params.get("ref");

    if (owner && repo && filePath && ref) {
      return { kind: "file", owner, repo, path: filePath, ref };
    }
  }

  return { kind: "not_found" };
}

function getFlashState(): FlashState {
  const params = new URLSearchParams(window.location.search);
  const notice = params.get("notice")?.trim() || undefined;
  const error = params.get("error")?.trim() || undefined;
  return { notice, error };
}

function formatDateTime(value: string | Date | undefined): string {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("id-ID", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateInput(value?: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return new Date().toISOString().slice(0, 10);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload as T;
}

function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

function useSession() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void requestJson<SessionResponse>("/api/session")
      .then((value) => {
        if (cancelled) {
          return;
        }
        setSession(value);
        setError(null);
      })
      .catch((requestError) => {
        if (cancelled) {
          return;
        }
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { session, setSession, loading, error };
}

function useRouteData<T>(loadKey: string | null, loader: (() => Promise<T>) | null, title: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(loadKey && loader));
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(title);

  useEffect(() => {
    if (!loadKey || !loader) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void loader()
      .then((value) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setData(value);
        });
      })
      .catch((requestError) => {
        if (cancelled) {
          return;
        }
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  return { data, setData, loading, error };
}

function getUserDisplayName(user: PublicGitHubUser): string {
  return user.displayName || user.username;
}

function getUserInitial(user: PublicGitHubUser | null): string {
  if (!user) {
    return "Y";
  }

  const source = user.displayName || user.username || "Y";
  return source.trim().charAt(0).toUpperCase() || "Y";
}

function repoVisibilityVariant(visibility: GitHubRepositoryOption["visibility"]): "warning" | "secondary" {
  return visibility === "private" ? "warning" : "secondary";
}

function repoAccessVariant(accessType: GitHubRepositoryOption["accessType"]): "default" | "outline" {
  return accessType === "shared" ? "default" : "outline";
}

function repoPermissionVariant(permissionLevel: GitHubRepositoryOption["permissionLevel"]): "danger" | "default" | "secondary" {
  if (permissionLevel === "admin") {
    return "danger";
  }

  if (permissionLevel === "write") {
    return "default";
  }

  return "secondary";
}

function confidenceVariant(confidence: RecentRunSummary["confidence"]): "success" | "warning" | "danger" {
  if (confidence === "high") {
    return "success";
  }

  if (confidence === "medium") {
    return "warning";
  }

  return "danger";
}

function insightVariant(status: RunDetailResponse["run"]["report"]["projectInsights"][number]["status"]): "success" | "warning" | "danger" | "secondary" {
  if (status === "active") {
    return "success";
  }

  if (status === "maintenance") {
    return "warning";
  }

  if (status === "blocked") {
    return "danger";
  }

  return "secondary";
}

function ActionLink(
  props: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
  },
) {
  const { className, variant, size, ...rest } = props;
  return <a className={buttonVariants({ variant, size, className })} {...rest} />;
}

function Eyebrow(props: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-200/80", props.className)}>{props.children}</div>;
}

function MetricCard(props: {
  label: string;
  value: string | number;
  description: string;
  tone?: "default" | "cool" | "highlight";
}) {
  const toneClass =
    props.tone === "cool"
      ? "border-cyan-300/18 bg-[linear-gradient(180deg,rgba(11,33,58,0.88),rgba(6,14,29,0.86))]"
      : props.tone === "highlight"
        ? "border-sky-300/18 bg-[linear-gradient(135deg,rgba(67,56,202,0.22),rgba(103,232,249,0.18),rgba(9,16,31,0.9))]"
        : "border-white/10 bg-white/[0.04]";

  return (
    <Card className={cn("overflow-hidden rounded-[24px]", toneClass)}>
      <CardContent className="p-5">
        <Eyebrow>{props.label}</Eyebrow>
        <div className="mt-4 text-3xl font-semibold tracking-tight text-white">{props.value}</div>
        <p className="mt-2 text-sm leading-6 text-slate-300">{props.description}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState(props: { message: string; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[24px] border border-dashed border-white/10 bg-white/[0.035] px-4 py-5 text-sm leading-6 text-slate-300",
        props.className,
      )}
    >
      {props.message}
    </div>
  );
}

function ListSection(props: { title: string; items: string[]; emptyMessage?: string }) {
  return (
    <div className="space-y-3">
      <Eyebrow>{props.title}</Eyebrow>
      {props.items.length > 0 ? (
        <div className="space-y-2">
          {props.items.map((item, index) => (
            <div key={`${props.title}-${index}`} className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-slate-100">
              {item}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message={props.emptyMessage || "Belum ada item untuk bagian ini."} />
      )}
    </div>
  );
}

function ProgressBar(props: { value: number }) {
  const width = Math.max(8, Math.min(100, props.value));
  return (
    <div className="h-2 rounded-full bg-white/[0.06]">
      <div
        className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(56,189,248,0.95),rgba(134,239,172,0.92))]"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function CodePanel(props: { title: string; content: string }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/70">
      <div className="border-b border-white/10 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-slate-400">{props.title}</div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-slate-100">
        <code>{props.content}</code>
      </pre>
    </div>
  );
}

function FlashBanners(props: { notice?: string; error?: string }) {
  return (
    <div className="mb-6 space-y-3">
      {props.notice ? (
        <Alert variant="success">
          <AlertTitle>Notice</AlertTitle>
          <AlertDescription>{props.notice}</AlertDescription>
        </Alert>
      ) : null}
      {props.error ? (
        <Alert variant="danger">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{props.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function getActiveNav(route: Route): "home" | "dashboard" | "history" {
  if (route.kind === "dashboard") {
    return "dashboard";
  }

  if (route.kind === "history" || route.kind === "run" || route.kind === "commit" || route.kind === "file") {
    return "history";
  }

  return "home";
}

function NavigationLink(props: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={props.href}
      className={cn(
        "inline-flex h-10 items-center rounded-full px-4 text-sm font-medium transition",
        props.active
          ? "border border-cyan-300/28 bg-cyan-300/12 text-cyan-100"
          : "border border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.04] hover:text-white",
      )}
    >
      {props.label}
    </a>
  );
}

function Layout(props: {
  user: PublicGitHubUser | null;
  flash: FlashState;
  route: Route;
  children: React.ReactNode;
}) {
  const activeNav = getActiveNav(props.route);

  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-12rem] top-[-10rem] h-[30rem] w-[30rem] rounded-full bg-cyan-400/12 blur-3xl" />
        <div className="absolute right-[-10rem] top-[6rem] h-[26rem] w-[26rem] rounded-full bg-indigo-500/14 blur-3xl" />
        <div className="absolute bottom-[-10rem] left-[20%] h-[28rem] w-[28rem] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:120px_120px] opacity-[0.13]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.15),transparent_34%),radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.14),transparent_24%),linear-gradient(180deg,rgba(2,6,23,0.2),rgba(2,6,23,0.7))]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <header className="sticky top-4 z-20 mb-8">
          <Card className="overflow-hidden border-white/12 bg-[linear-gradient(180deg,rgba(9,18,33,0.96),rgba(5,10,22,0.92))]">
            <CardContent className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <a href="/" className="inline-flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.34em] text-cyan-100">
                  <span className="rounded-full border border-cyan-300/25 bg-cyan-300/14 px-3 py-1 text-[11px]">YiJiex</span>
                  AI Repo Analyzer
                </a>
                <div className="hidden h-5 w-px bg-white/10 lg:block" />
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Workspace, analysis, dan history terpisah rapi</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <NavigationLink href="/" label="Home" active={activeNav === "home"} />
                {props.user ? <NavigationLink href="/dashboard" label="Workspace" active={activeNav === "dashboard"} /> : null}
                {props.user ? <NavigationLink href="/history" label="History" active={activeNav === "history"} /> : null}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  {props.user?.avatarUrl ? (
                    <img src={props.user.avatarUrl} alt={props.user.username} className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-300/12 text-sm font-semibold text-cyan-100">
                      {getUserInitial(props.user)}
                    </div>
                  )}
                  <div className="min-w-[7rem]">
                    <div className="text-sm font-medium text-white">{props.user ? getUserDisplayName(props.user) : "Guest mode"}</div>
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
                      {props.user ? `@${props.user.username}` : "GitHub session"}
                    </div>
                  </div>
                </div>
                {props.user ? (
                  <ActionLink href="/logout" variant="outline">
                    Logout
                  </ActionLink>
                ) : (
                  <ActionLink href="/auth/github" variant="default">
                    Login GitHub
                  </ActionLink>
                )}
              </div>
            </CardContent>
          </Card>
        </header>

        <FlashBanners notice={props.flash.notice} error={props.flash.error} />
        {props.children}
      </div>
    </div>
  );
}

function LandingPage(props: { user: PublicGitHubUser | null }) {
  useDocumentTitle("YiJiex AI Repo Analyzer");

  return (
    <section className="grid gap-6 xl:grid-cols-[1.16fr_0.84fr]">
      <Card className="overflow-hidden border-cyan-300/12 bg-[linear-gradient(160deg,rgba(11,21,39,0.96),rgba(5,10,20,0.9))]">
        <CardHeader className="space-y-4 p-8 sm:p-10">
          <Badge className="w-fit">Shadcn Inspired</Badge>
          <div className="space-y-4">
            <Eyebrow>GitHub Workspace</Eyebrow>
            <CardTitle className="max-w-4xl text-4xl font-semibold leading-tight sm:text-5xl">
              Workspace GitHub dengan navbar jelas, selection repo yang ringan, dan history analisa yang dipisah ke halaman sendiri.
            </CardTitle>
            <CardDescription className="max-w-2xl text-base leading-8 text-slate-300">
              Fokus halaman dibagi lebih masuk akal: workspace untuk memilih repo, history untuk melihat run yang pernah dibuat, dan detail page untuk menelusuri hasil analisa sampai patch file.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-8 px-8 pb-8 sm:px-10 sm:pb-10">
          <div className="flex flex-wrap gap-3">
            {props.user ? (
              <ActionLink href="/dashboard" size="lg">
                Masuk ke Workspace
              </ActionLink>
            ) : (
              <ActionLink href="/auth/github" size="lg">
                Login dengan GitHub
              </ActionLink>
            )}
            <ActionLink href="#workflow" variant="secondary" size="lg">
              Lihat Workflow
            </ActionLink>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              label="1. OAuth"
              value="GitHub"
              description="Masuk dengan akun GitHub dan pakai scope repo untuk membaca private, shared, dan organization repository."
              tone="cool"
            />
            <MetricCard
              label="2. Workspace"
              value="Multi Select"
              description="Pemilihan repo sekarang lebih natural lewat checkbox list, bukan klik satu-satu card besar."
            />
            <MetricCard
              label="3. History"
              value="Dedicated Page"
              description="Run history dipisah dari dashboard supaya workspace tetap fokus ke proses memilih dan menjalankan analisa."
              tone="highlight"
            />
          </div>

          <div id="workflow" className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <Eyebrow>Workflow</Eyebrow>
              <div className="mt-4 space-y-3 text-sm leading-7 text-slate-200">
                <div className="rounded-[20px] border border-white/10 bg-slate-950/30 px-4 py-3">Login GitHub lalu buka workspace pribadi Anda.</div>
                <div className="rounded-[20px] border border-white/10 bg-slate-950/30 px-4 py-3">Filter repository, centang lewat checkbox, lalu simpan workspace default jika perlu.</div>
                <div className="rounded-[20px] border border-white/10 bg-slate-950/30 px-4 py-3">Jalankan analyze dari panel action terpisah dan buka history saat ingin meninjau run lama.</div>
              </div>
            </div>
            <div className="rounded-[24px] border border-cyan-300/12 bg-[linear-gradient(180deg,rgba(6,20,39,0.78),rgba(2,8,16,0.78))] p-5">
              <Eyebrow>Visual System</Eyebrow>
              <div className="mt-4 space-y-3 text-sm leading-7 text-slate-200">
                <div className="rounded-[20px] border border-white/10 bg-white/[0.05] px-4 py-3">Dark glossy tetap dipakai, tapi struktur halaman sekarang lebih tegas dan mudah dipindai.</div>
                <div className="rounded-[20px] border border-white/10 bg-white/[0.05] px-4 py-3">Navbar dipasang permanen supaya perpindahan antar halaman utama terasa masuk akal.</div>
                <div className="rounded-[20px] border border-white/10 bg-white/[0.05] px-4 py-3">Workspace, history, run detail, commit, dan file viewer dipisahkan sesuai fungsinya.</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Eyebrow>Status Workspace</Eyebrow>
            <CardTitle className="text-2xl">Struktur halaman lebih jelas</CardTitle>
            <CardDescription>State login, scope repository, dan entry point utama sekarang lebih mudah dipahami dari navbar dan panel ringkas ini.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-400">OAuth Config</div>
              <div className="mt-2 text-sm font-medium text-white">Dibaca dari environment server</div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-400">GitHub Session</div>
              <div className="mt-2 text-sm font-medium text-white">
                {props.user ? `Login sebagai @${props.user.username}` : "Belum login"}
              </div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Main Pages</div>
              <div className="mt-2 text-sm font-medium text-white">Home, Workspace, History, dan detail view terpisah</div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-indigo-400/12 bg-[linear-gradient(180deg,rgba(15,22,42,0.9),rgba(6,10,20,0.86))]">
          <CardHeader>
            <Eyebrow>What You Get</Eyebrow>
            <CardTitle className="text-2xl">Alur kerja yang lebih wajar</CardTitle>
            <CardDescription>Perubahan bukan cuma visual, tapi juga pemisahan tanggung jawab halaman utama.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert>
              <AlertTitle>Workspace Selection</AlertTitle>
              <AlertDescription>Daftar repo sekarang lebih ringan karena mengandalkan checkbox list dengan bulk action.</AlertDescription>
            </Alert>
            <Alert>
              <AlertTitle>Dedicated History</AlertTitle>
              <AlertDescription>Histori analisa dipindah ke halaman sendiri supaya dashboard tidak terasa sesak.</AlertDescription>
            </Alert>
            <Alert>
              <AlertTitle>Deep Trace</AlertTitle>
              <AlertDescription>Commit detail dan file viewer tetap memakai card glossy yang sama supaya perpindahan route tetap mulus.</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function RepositorySelectionTable(props: {
  filteredRepositories: GitHubRepositoryOption[];
  selectionSet: Set<string>;
  search: string;
  onSearchChange: (value: string) => void;
  onToggleRepository: (fullName: string) => void;
  onSelectVisible: () => void;
  onClearVisible: () => void;
  onSaveWorkspace: () => void;
  savingWorkspace: boolean;
  pendingWorkspaceChanges: boolean;
  selectedCount: number;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-5 p-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <Eyebrow>Workspace Selection</Eyebrow>
            <CardTitle className="text-2xl">Pilih repository lewat checkbox list</CardTitle>
            <CardDescription>
              Fokus halaman ini hanya untuk memilih repo dan menyimpan workspace. Tidak ada lagi card besar yang harus diklik satu per satu.
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{props.selectedCount} selected</Badge>
            <Button variant="secondary" size="sm" onClick={props.onSelectVisible}>
              Pilih visible
            </Button>
            <Button variant="secondary" size="sm" onClick={props.onClearVisible}>
              Lepas visible
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={props.onSaveWorkspace}
              disabled={props.savingWorkspace || !props.pendingWorkspaceChanges}
            >
              {props.savingWorkspace ? "Saving..." : "Save workspace"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-200">Cari repository</span>
            <Input value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} placeholder="owner/repo" />
          </label>
          <div className="flex items-end">
            <Badge variant="outline" className="h-11 px-4 text-xs">
              {props.filteredRepositories.length} repo terlihat
            </Badge>
          </div>
        </div>

        {props.filteredRepositories.length > 0 ? (
          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/25">
            <div className="hidden items-center gap-4 border-b border-white/10 bg-white/[0.04] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 md:grid md:grid-cols-[52px_minmax(0,2.1fr)_0.8fr_0.8fr_0.9fr_1fr]">
              <div>Pilih</div>
              <div>Repository</div>
              <div>Visibility</div>
              <div>Access</div>
              <div>Permission</div>
              <div>Updated</div>
            </div>

            <div className="max-h-[44rem] overflow-y-auto">
              {props.filteredRepositories.map((repo, index) => {
                const checked = props.selectionSet.has(repo.fullName);
                return (
                  <label
                    key={repo.id}
                    className={cn(
                      "grid cursor-pointer gap-4 px-5 py-4 transition md:grid-cols-[52px_minmax(0,2.1fr)_0.8fr_0.8fr_0.9fr_1fr] md:items-center",
                      index !== 0 ? "border-t border-white/10" : "",
                      checked ? "bg-cyan-300/[0.07]" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <div className="flex items-start md:items-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => props.onToggleRepository(repo.fullName)}
                        className="mt-1 h-4 w-4 rounded border-white/15 bg-slate-950/60 accent-cyan-300 md:mt-0"
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">{repo.fullName}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{repo.owner}</div>
                      {repo.description ? <p className="mt-2 text-sm leading-6 text-slate-300">{repo.description}</p> : null}
                    </div>

                    <div>
                      <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-slate-500 md:hidden">Visibility</div>
                      <Badge variant={repoVisibilityVariant(repo.visibility)}>{repo.visibility}</Badge>
                    </div>

                    <div>
                      <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-slate-500 md:hidden">Access</div>
                      <Badge variant={repoAccessVariant(repo.accessType)}>{repo.accessType}</Badge>
                    </div>

                    <div>
                      <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-slate-500 md:hidden">Permission</div>
                      <Badge variant={repoPermissionVariant(repo.permissionLevel)}>{repo.permissionLevel}</Badge>
                    </div>

                    <div className="space-y-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 md:hidden">Updated</div>
                      <div className="text-sm text-slate-300">{repo.updatedAt ? formatDateTime(repo.updatedAt) : "No update info"}</div>
                      {repo.defaultBranch ? <Badge variant="outline">{repo.defaultBranch}</Badge> : null}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ) : (
          <EmptyState message="Tidak ada repository yang cocok dengan filter saat ini." />
        )}
      </CardContent>
    </Card>
  );
}

function DashboardPage(props: {
  onSessionUserChange: (user: PublicGitHubUser) => void;
}) {
  const { data, setData, loading, error } = useRouteData<DashboardResponse>(
    "dashboard",
    () => requestJson<DashboardResponse>("/api/dashboard"),
    "Workspace",
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reportDate, setReportDate] = useState(formatDateInput());
  const [selectedRepositories, setSelectedRepositories] = useState<string[]>([]);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (!data) {
      return;
    }

    setSelectedRepositories(data.repositories.filter((repo) => repo.selected).map((repo) => repo.fullName));
  }, [data]);

  if (loading) {
    return <LoadingState title="Menyiapkan workspace..." subtitle="Mengambil akses repository dan pengaturan dashboard dari server." />;
  }

  if (error || !data) {
    return <FailureState title="Workspace gagal dimuat" message={error || "Data dashboard tidak tersedia."} />;
  }

  const selectionSet = new Set(selectedRepositories);
  const filteredRepositories = data.repositories.filter((repo) =>
    repo.fullName.toLowerCase().includes(deferredSearch.trim().toLowerCase()),
  );
  const savedSelection = new Set(data.repositories.filter((repo) => repo.selected).map((repo) => repo.fullName));
  const pendingWorkspaceChanges =
    selectedRepositories.length !== savedSelection.size ||
    selectedRepositories.some((item) => !savedSelection.has(item));
  const canAnalyze = data.groqReady && selectedRepositories.length > 0 && !runningAnalysis;

  async function handleSaveWorkspace(): Promise<void> {
    try {
      setSavingWorkspace(true);
      setLocalError(null);
      setLocalNotice(null);
      const response = await requestJson<UpdateRepositoriesResponse>("/api/repositories/connect", {
        method: "POST",
        body: JSON.stringify({ repositories: selectedRepositories }),
      });

      startTransition(() => {
        setData((current) =>
          current
            ? {
                ...current,
                user: response.user,
                repositories: current.repositories.map((repo) => ({
                  ...repo,
                  selected: selectionSet.has(repo.fullName),
                })),
              }
            : current,
        );
        props.onSessionUserChange(response.user);
      });

      setLocalNotice(
        selectedRepositories.length > 0
          ? `${selectedRepositories.length} repository tersimpan ke workspace Anda.`
          : "Workspace sekarang kosong.",
      );
    } catch (requestError) {
      setLocalError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function handleAnalyze(): Promise<void> {
    try {
      setRunningAnalysis(true);
      setLocalError(null);
      setLocalNotice(null);
      const response = await requestJson<AnalyzeResponse>("/api/analyze", {
        method: "POST",
        body: JSON.stringify({
          reportDate,
          repositories: selectedRepositories,
        }),
      });

      window.location.assign(`/runs/${escapePathSegment(response.runId)}`);
    } catch (requestError) {
      setLocalError(requestError instanceof Error ? requestError.message : String(requestError));
      setRunningAnalysis(false);
    }
  }

  function toggleRepository(fullName: string): void {
    setSelectedRepositories((current) =>
      current.includes(fullName) ? current.filter((item) => item !== fullName) : [...current, fullName],
    );
  }

  function selectVisible(): void {
    setSelectedRepositories((current) => {
      const next = new Set(current);
      for (const repo of filteredRepositories) {
        next.add(repo.fullName);
      }
      return Array.from(next);
    });
  }

  function clearVisible(): void {
    const visibleSet = new Set(filteredRepositories.map((repo) => repo.fullName));
    setSelectedRepositories((current) => current.filter((item) => !visibleSet.has(item)));
  }

  return (
    <section className="space-y-6">
      <FlashBanners notice={localNotice || undefined} error={localError || undefined} />

      <Card className="overflow-hidden border-cyan-300/12">
        <CardHeader className="gap-5 p-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <Eyebrow>Workspace Overview</Eyebrow>
              <CardTitle className="text-3xl">Dashboard ini sekarang fokus ke selection repo dan proses analyze</CardTitle>
              <CardDescription className="text-sm leading-7">
                History dipindah ke halaman sendiri. Di sini Anda hanya perlu filter repo, centang yang dibutuhkan, simpan workspace bila perlu, lalu jalankan analisa.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{data.githubTimezone}</Badge>
              <Badge variant="outline">{data.githubTimezoneOffset}</Badge>
              <Badge variant={data.groqReady ? "success" : "warning"}>{data.groqReady ? "Groq Ready" : "Groq Missing"}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <MetricCard
            label="Selected"
            value={selectedRepositories.length}
            description="Repository aktif untuk run berikutnya."
            tone="cool"
          />
          <MetricCard
            label="Private Access"
            value={data.repositories.filter((repo) => repo.visibility === "private").length}
            description="Private repository yang terbaca dari akun GitHub Anda."
          />
          <MetricCard
            label="Shared Access"
            value={data.repositories.filter((repo) => repo.accessType === "shared").length}
            description="Repo collaborator atau organization yang ikut muncul."
          />
          <MetricCard
            label="Saved Runs"
            value={data.recentRuns.length}
            description="Jumlah run yang tersimpan dan bisa dibuka dari halaman history."
            tone="highlight"
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_360px]">
        <RepositorySelectionTable
          filteredRepositories={filteredRepositories}
          selectionSet={selectionSet}
          search={search}
          onSearchChange={setSearch}
          onToggleRepository={toggleRepository}
          onSelectVisible={selectVisible}
          onClearVisible={clearVisible}
          onSaveWorkspace={() => void handleSaveWorkspace()}
          savingWorkspace={savingWorkspace}
          pendingWorkspaceChanges={pendingWorkspaceChanges}
          selectedCount={selectedRepositories.length}
        />

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-3">
                  <Eyebrow>Run Analyzer</Eyebrow>
                  <CardTitle className="text-2xl">Action panel terpisah</CardTitle>
                  <CardDescription>
                    Pemilihan repo tidak lagi dicampur dengan action run. Bagian ini hanya untuk menentukan tanggal dan mengeksekusi analisa.
                  </CardDescription>
                </div>
                <Badge variant={pendingWorkspaceChanges ? "warning" : "success"}>
                  {pendingWorkspaceChanges ? "Workspace changed" : "Workspace synced"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-200">Report date</span>
                <Input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
              </label>

              <Alert>
                <AlertTitle>Selection aktif</AlertTitle>
                <AlertDescription>
                  {selectedRepositories.length > 0
                    ? `${selectedRepositories.length} repo siap dianalisa.`
                    : "Belum ada repo terpilih. Centang repository pada daftar di sebelah kiri."}
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap gap-2">
                {selectedRepositories.length > 0 ? (
                  selectedRepositories.slice(0, 6).map((repoName) => (
                    <Badge key={repoName} variant="secondary">
                      {repoName}
                    </Badge>
                  ))
                ) : (
                  <EmptyState message="Selection masih kosong." className="w-full" />
                )}
                {selectedRepositories.length > 6 ? <Badge variant="outline">+{selectedRepositories.length - 6} lainnya</Badge> : null}
              </div>

              <Button className="w-full" onClick={() => void handleAnalyze()} disabled={!canAnalyze}>
                {runningAnalysis ? "Analyzing..." : "Analyze Selection"}
              </Button>

              {!data.groqReady ? (
                <Alert variant="warning">
                  <AlertTitle>GROQ_API_KEY belum tersedia</AlertTitle>
                  <AlertDescription>Isi environment server agar tombol analyze bisa dijalankan.</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-cyan-300/12">
            <CardHeader>
              <Eyebrow>Session</Eyebrow>
              <CardTitle className="text-2xl">{getUserDisplayName(data.user)}</CardTitle>
              <CardDescription>{data.user.email || data.user.profileUrl || "GitHub session aktif"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Connected workspace</div>
                <div className="mt-2 text-sm font-medium text-white">{data.user.connectedRepositories.length} repo</div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Groq model</div>
                <div className="mt-2 text-sm font-medium text-white">{data.groqModel}</div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">GitHub access</div>
                <div className="mt-2 text-sm font-medium text-white">{data.repositories.length} repo terlihat</div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <Eyebrow>Run History</Eyebrow>
              <CardTitle className="text-2xl">History dipindah ke halaman sendiri</CardTitle>
              <CardDescription>
                Dashboard tetap fokus. Gunakan halaman history untuk melihat semua run yang sudah pernah dibuat.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.recentRuns[0] ? (
                <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{data.recentRuns[0].reportDate}</div>
                    <Badge>{data.recentRuns[0].productivityScore}/100</Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{data.recentRuns[0].overallSummary}</p>
                </div>
              ) : (
                <EmptyState message="Belum ada run yang tersimpan." />
              )}
              <ActionLink href="/history" variant="secondary" className="w-full">
                Buka History
              </ActionLink>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function RecentRunCard(props: { run: RecentRunSummary }) {
  return (
    <a
      href={`/runs/${escapePathSegment(props.run.id)}`}
      className="block rounded-[24px] border border-white/10 bg-white/[0.045] p-5 transition hover:border-cyan-300/25 hover:bg-white/[0.06]"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-base font-semibold text-white">{props.run.reportDate}</div>
            <Badge>{props.run.productivityScore}/100</Badge>
            <Badge variant={confidenceVariant(props.run.confidence)}>{props.run.confidence}</Badge>
          </div>
          <div className="text-xs leading-5 text-slate-400">{props.run.repositoryFullNames.join(", ")}</div>
          <p className="text-sm leading-6 text-slate-200">{props.run.overallSummary}</p>
        </div>
        <div className="w-full max-w-full space-y-3 lg:w-56">
          <ProgressBar value={props.run.productivityScore} />
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{formatDateTime(props.run.createdAt)}</div>
        </div>
      </div>
    </a>
  );
}

function HistoryPage() {
  const { data, loading, error } = useRouteData<HistoryResponse>(
    "history",
    () => requestJson<HistoryResponse>("/api/history"),
    "History",
  );
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  if (loading) {
    return <LoadingState title="Memuat history..." subtitle="Mengambil daftar run analisa yang tersimpan untuk akun ini." />;
  }

  if (error || !data) {
    return <FailureState title="History gagal dimuat" message={error || "Data history tidak tersedia."} />;
  }

  const query = deferredSearch.trim().toLowerCase();
  const filteredRuns = data.runs.filter((run) => {
    const haystack = [run.reportDate, run.overallSummary, ...run.repositoryFullNames].join(" ").toLowerCase();
    return haystack.includes(query);
  });
  const averageProductivity =
    data.runs.length > 0 ? Math.round(data.runs.reduce((sum, run) => sum + run.productivityScore, 0) / data.runs.length) : 0;
  const uniqueRepos = new Set(data.runs.flatMap((run) => run.repositoryFullNames));
  const latestRun = data.runs[0];

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-cyan-300/12">
        <CardHeader className="gap-5 p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <Eyebrow>Run History</Eyebrow>
              <CardTitle className="text-3xl">Semua hasil analisa dipindah ke halaman history khusus</CardTitle>
              <CardDescription className="text-sm leading-7">
                Halaman ini dipakai untuk meninjau run yang sudah pernah dibuat. Dashboard tidak lagi memaksakan list history di area workspace.
              </CardDescription>
            </div>
            <ActionLink href="/dashboard" variant="secondary">
              Kembali ke Workspace
            </ActionLink>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Total Runs" value={data.runs.length} description="Jumlah seluruh run yang tersimpan untuk akun ini." tone="cool" />
          <MetricCard label="Avg Score" value={averageProductivity} description="Rata-rata productivity score dari seluruh run." />
          <MetricCard
            label="Latest Report"
            value={latestRun ? latestRun.reportDate : "-"}
            description="Tanggal report terbaru yang tersimpan."
          />
          <MetricCard label="Unique Repos" value={uniqueRepos.size} description="Repository unik yang pernah ikut dianalisa." tone="highlight" />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="gap-5 p-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <Eyebrow>History List</Eyebrow>
              <CardTitle className="text-2xl">Cari dan buka run lama</CardTitle>
              <CardDescription>
                Filter berdasarkan tanggal, repo, atau ringkasan singkat untuk menemukan run yang ingin Anda buka kembali.
              </CardDescription>
            </div>
            <div className="w-full max-w-md">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-200">Cari history</span>
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="tanggal, repo, atau summary" />
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{filteredRuns.length} run terlihat</Badge>
            {latestRun ? <Badge variant="outline">Latest {latestRun.reportDate}</Badge> : null}
          </div>

          {filteredRuns.length > 0 ? (
            <div className="space-y-3">
              {filteredRuns.map((run) => (
                <RecentRunCard key={run.id} run={run} />
              ))}
            </div>
          ) : (
            <EmptyState message="Tidak ada history yang cocok dengan filter saat ini." />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function RunDetailPage(props: { route: Extract<Route, { kind: "run" }> }) {
  const { data, loading, error } = useRouteData<RunDetailResponse>(
    `run:${props.route.id}`,
    () => requestJson<RunDetailResponse>(`/api/runs/${escapePathSegment(props.route.id)}`),
    `Run ${props.route.id}`,
  );

  if (loading) {
    return <LoadingState title="Memuat hasil analisa..." subtitle="Mengambil run detail dan seluruh commit source." />;
  }

  if (error || !data) {
    return <FailureState title="Run tidak bisa dibuka" message={error || "Data run tidak tersedia."} />;
  }

  const { run } = data;

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-cyan-300/12">
        <CardHeader className="gap-6 p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-4">
              <Eyebrow>Run Detail</Eyebrow>
              <CardTitle className="text-4xl">{run.report.reportDate}</CardTitle>
              <CardDescription className="text-base leading-8">{run.report.overallSummary}</CardDescription>
              <div className="flex flex-wrap gap-2">
                <Badge>{run.repositoryFullNames.length} repo</Badge>
                <Badge variant="secondary">{run.collection.metrics.totalCommits} commit</Badge>
                <Badge variant="outline">{formatDateTime(run.createdAt)}</Badge>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                label="Productivity"
                value={run.report.productivityScore}
                description="Skor agregat dari run ini."
                tone="cool"
              />
              <MetricCard
                label="Confidence"
                value={run.report.confidence}
                description="Tingkat keyakinan model terhadap summary."
                tone="highlight"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <MetricCard
            label="Active Projects"
            value={run.collection.metrics.activeProjectCount}
            description="Project yang benar-benar punya aktivitas."
          />
          <MetricCard
            label="Unique Files"
            value={run.collection.metrics.uniqueFilesTouched}
            description="File unik yang tersentuh oleh commit dan working tree."
          />
          <MetricCard
            label="Dirty Repos"
            value={run.collection.metrics.dirtyRepoCount}
            description="Repo yang masih punya perubahan di working tree."
          />
          <MetricCard
            label="Files Touched"
            value={run.collection.metrics.totalCommittedFiles}
            description="Total file yang muncul di commit hari ini."
          />
        </CardContent>
      </Card>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <Eyebrow>Highlights</Eyebrow>
            <CardTitle className="text-2xl">Focus dan activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <ListSection title="Focus Areas" items={run.report.focusAreas} />
            <ListSection title="Activities" items={run.report.activities} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Eyebrow>Delivery</Eyebrow>
            <CardTitle className="text-2xl">Achievement dan improvement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <ListSection title="Achievements" items={run.report.achievements} />
            <ListSection title="Improvements" items={run.report.improvements} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Eyebrow>Risk and Next</Eyebrow>
            <CardTitle className="text-2xl">Blocker dan prioritas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <ListSection title="Blockers" items={run.report.blockers} emptyMessage="Tidak ada blocker yang tercatat." />
            <ListSection title="Next Priorities" items={run.report.nextPriorities} />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <Eyebrow>Project Insights</Eyebrow>
          <CardTitle className="text-2xl">Ringkasan per project</CardTitle>
          <CardDescription>Status dan summary tiap project ditampilkan dalam panel yang lebih rapih.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {run.report.projectInsights.length > 0 ? (
            run.report.projectInsights.map((item) => (
              <div key={`${item.project}-${item.summary}`} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="text-base font-semibold text-white">{item.project}</div>
                    <div className="text-sm leading-7 text-slate-300">{item.summary}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={insightVariant(item.status)}>{item.status}</Badge>
                    <Badge variant="secondary">{item.commitCount} commit</Badge>
                    <Badge variant="outline">{item.changedFilesCount} file</Badge>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyState message="Belum ada project insight yang dihasilkan untuk run ini." />
          )}
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Eyebrow>Source Trace</Eyebrow>
            <h2 className="mt-2 text-2xl font-semibold text-white">Commit yang membentuk report</h2>
          </div>
          <ActionLink href="/history" variant="outline">
            Kembali ke History
          </ActionLink>
        </div>

        <div className="space-y-4">
          {run.collection.repositories.map((repo) => {
            const [owner = "", name = ""] = repo.name.split("/");
            return (
              <Card key={repo.name} className="overflow-hidden">
                <CardHeader className="gap-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="text-lg font-semibold text-white">{repo.displayName || repo.name}</div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{repo.name}</Badge>
                        <Badge variant="outline">{repo.commitsToday.length} commit</Badge>
                        <Badge variant="outline">{repo.committedFilesToday.length} file touched</Badge>
                        {repo.branch ? <Badge>{repo.branch}</Badge> : null}
                        {repo.isDirty ? <Badge variant="warning">dirty working tree</Badge> : null}
                      </div>
                    </div>
                    <ActionLink href={repo.path} target="_blank" rel="noreferrer" variant="secondary">
                      Open Repo
                    </ActionLink>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {repo.errors.length > 0 ? (
                    <Alert variant="warning">
                      <AlertTitle>Repo warnings</AlertTitle>
                      <AlertDescription>{repo.errors.join(" | ")}</AlertDescription>
                    </Alert>
                  ) : null}

                  {repo.commitDetails.length > 0 ? (
                    <div className="space-y-3">
                      {repo.commitDetails.map((commit) => (
                        <a
                          key={commit.hash}
                          href={`/github/commit/${escapePathSegment(owner)}/${escapePathSegment(name)}/${escapePathSegment(commit.hash)}`}
                          className="block rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4 transition hover:border-cyan-300/20 hover:bg-white/[0.06]"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-white">{commit.subject}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{formatDateTime(commit.committedAt)}</div>
                            </div>
                            <Badge variant="secondary" className="w-fit">
                              {commit.shortHash}
                            </Badge>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <EmptyState message="Tidak ada commit yang cocok pada tanggal ini." />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function CommitDetailPage(props: { route: Extract<Route, { kind: "commit" }> }) {
  const { route } = props;
  const { data, loading, error } = useRouteData<CommitDetailResponse>(
    `commit:${route.owner}/${route.repo}/${route.sha}`,
    () =>
      requestJson<CommitDetailResponse>(
        `/api/github/commit/${escapePathSegment(route.owner)}/${escapePathSegment(route.repo)}/${escapePathSegment(route.sha)}`,
      ),
    `Commit ${route.sha.slice(0, 7)}`,
  );

  if (loading) {
    return <LoadingState title="Memuat commit detail..." subtitle="Mengambil patch dan daftar file dari GitHub." />;
  }

  if (error || !data) {
    return <FailureState title="Commit tidak bisa dibuka" message={error || "Detail commit tidak tersedia."} />;
  }

  const { detail } = data;
  const totalChanges = detail.files.reduce((sum, file) => sum + file.changes, 0);

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-cyan-300/12">
        <CardHeader className="gap-5 p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <Eyebrow>Commit Detail</Eyebrow>
              <CardTitle className="text-3xl">{detail.subject}</CardTitle>
              <CardDescription className="text-sm leading-7">
                {detail.owner}/{detail.repo} | {detail.shortSha} | {detail.author} | {formatDateTime(detail.committedAt)}
              </CardDescription>
              <div className="flex flex-wrap gap-2">
                <Badge>{detail.files.length} file</Badge>
                <Badge variant="secondary">{totalChanges} line change</Badge>
                <Badge variant="outline">{detail.shortSha}</Badge>
              </div>
            </div>
            <ActionLink href={detail.htmlUrl} target="_blank" rel="noreferrer" variant="secondary">
              Open on GitHub
            </ActionLink>
          </div>
        </CardHeader>
      </Card>

      <div className="space-y-4">
        {detail.files.map((file) => (
          <Card key={file.fileName} className="overflow-hidden">
            <CardHeader className="gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="text-base font-semibold text-white">{file.fileName}</div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{file.status || "modified"}</Badge>
                    <Badge variant="outline">+{file.additions}</Badge>
                    <Badge variant="outline">-{file.deletions}</Badge>
                    <Badge variant="outline">{file.changes} lines</Badge>
                  </div>
                </div>
                <ActionLink
                  href={`/github/file?owner=${escapePathSegment(detail.owner)}&repo=${escapePathSegment(detail.repo)}&path=${escapePathSegment(file.fileName)}&ref=${escapePathSegment(detail.sha)}`}
                  variant="outline"
                >
                  Lihat File
                </ActionLink>
              </div>
            </CardHeader>
            <CardContent>
              <CodePanel title="Patch" content={file.patch || "GitHub tidak mengembalikan patch untuk file ini."} />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function FileContentPage(props: { route: Extract<Route, { kind: "file" }> }) {
  const { route } = props;
  const query = new URLSearchParams({
    owner: route.owner,
    repo: route.repo,
    path: route.path,
    ref: route.ref,
  }).toString();
  const { data, loading, error } = useRouteData<FileContentResponse>(
    `file:${route.owner}/${route.repo}/${route.path}@${route.ref}`,
    () => requestJson<FileContentResponse>(`/api/github/file?${query}`),
    `File ${route.path}`,
  );

  if (loading) {
    return <LoadingState title="Memuat source file..." subtitle="Mengambil isi file langsung dari ref commit GitHub." />;
  }

  if (error || !data) {
    return <FailureState title="File tidak bisa dibuka" message={error || "Isi file tidak tersedia."} />;
  }

  const { file } = data;

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-cyan-300/12">
        <CardHeader className="gap-4 p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Eyebrow>File Content</Eyebrow>
              <CardTitle className="text-3xl">{file.path}</CardTitle>
              <CardDescription>
                {file.owner}/{file.repo} | ref {file.ref}
              </CardDescription>
            </div>
            <ActionLink href={file.htmlUrl} target="_blank" rel="noreferrer" variant="secondary">
              Open on GitHub
            </ActionLink>
          </div>
        </CardHeader>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <Eyebrow>Source Viewer</Eyebrow>
          <CardTitle className="text-2xl">Snapshot file dari commit</CardTitle>
        </CardHeader>
        <CardContent>
          <CodePanel title="Source" content={file.content} />
        </CardContent>
      </Card>
    </section>
  );
}

function LoadingState(props: { title: string; subtitle: string }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-10">
        <div className="inline-flex h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-cyan-300" />
        <h1 className="mt-6 text-3xl font-semibold text-white">{props.title}</h1>
        <p className="mt-3 max-w-2xl text-base leading-8 text-slate-300">{props.subtitle}</p>
      </CardContent>
    </Card>
  );
}

function FailureState(props: { title: string; message: string }) {
  return (
    <Card className="overflow-hidden border-rose-300/16">
      <CardContent className="space-y-6 p-10">
        <Alert variant="danger">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{props.message}</AlertDescription>
        </Alert>
        <div>
          <h1 className="text-3xl font-semibold text-white">{props.title}</h1>
          <p className="mt-3 max-w-2xl text-base leading-8 text-slate-300">
            Route ini tidak bisa ditampilkan sekarang. Kembali ke halaman utama lalu coba lagi.
          </p>
        </div>
        <div>
          <ActionLink href="/">Kembali ke Home</ActionLink>
        </div>
      </CardContent>
    </Card>
  );
}

function App() {
  const route = parseRoute();
  const [sessionFlash] = useState<FlashState>(() => getFlashState());
  const { session, setSession, loading, error } = useSession();

  useEffect(() => {
    if (!sessionFlash.notice && !sessionFlash.error) {
      return;
    }

    const nextUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [sessionFlash]);

  useEffect(() => {
    if (!session || session.authenticated || route.kind === "home") {
      return;
    }

    window.location.replace(`/?error=${encodeURIComponent("Silakan login dengan GitHub dulu.")}`);
  }, [route.kind, session]);

  if (loading) {
    return (
      <Layout user={null} flash={sessionFlash} route={route}>
        <LoadingState title="Memeriksa session GitHub..." subtitle="Menunggu server memastikan apakah akun Anda sudah login." />
      </Layout>
    );
  }

  if (error || !session) {
    return (
      <Layout user={null} flash={sessionFlash} route={route}>
        <FailureState title="Session gagal dibaca" message={error || "Server tidak mengembalikan data session."} />
      </Layout>
    );
  }

  const user = session.user;
  const handleSessionUserChange = (nextUser: PublicGitHubUser) => {
    setSession((current) => (current ? { ...current, user: nextUser, authenticated: true } : current));
  };

  return (
    <Layout user={user} flash={sessionFlash} route={route}>
      {route.kind === "home" ? <LandingPage user={user} /> : null}
      {route.kind === "dashboard" && user ? <DashboardPage onSessionUserChange={handleSessionUserChange} /> : null}
      {route.kind === "history" && user ? <HistoryPage /> : null}
      {route.kind === "run" && user ? <RunDetailPage route={route} /> : null}
      {route.kind === "commit" && user ? <CommitDetailPage route={route} /> : null}
      {route.kind === "file" && user ? <FileContentPage route={route} /> : null}
      {route.kind === "not_found" ? (
        <FailureState title="Halaman tidak ditemukan" message="Route yang diminta belum tersedia di dashboard ini." />
      ) : null}
    </Layout>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("React root container was not found.");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
