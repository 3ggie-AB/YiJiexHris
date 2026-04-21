import React, { startTransition, useDeferredValue, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type {
  AnalyzeResponse,
  CommitDetailResponse,
  DashboardResponse,
  FileContentResponse,
  PublicGitHubUser,
  RecentRunSummary,
  RunDetailResponse,
  SessionResponse,
  UpdateRepositoriesResponse,
} from "./api-types";

type Route =
  | { kind: "home" }
  | { kind: "dashboard" }
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

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
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

function StatCard(props: { label: string; value: string | number; description: string; tone?: "light" | "dark" | "accent" }) {
  const toneClass =
    props.tone === "dark"
      ? "bg-ink text-white border-white/10"
      : props.tone === "accent"
        ? "bg-[linear-gradient(135deg,rgba(53,199,160,0.16),rgba(23,49,56,0.92))] text-white border-teal/20"
        : "bg-coal/80 text-white border-white/10";

  return (
    <article className={classNames("rounded-[1.8rem] border p-5 shadow-panel backdrop-blur", toneClass)}>
      <div className={classNames("text-[11px] font-semibold uppercase tracking-[0.24em]", props.tone === "dark" ? "text-white/60" : "text-teal-300")}>
        {props.label}
      </div>
      <div className="mt-3 text-3xl font-black">{props.value}</div>
      <p className={classNames("mt-2 text-sm leading-6", props.tone === "dark" ? "text-white/75" : "text-stone-300")}>{props.description}</p>
    </article>
  );
}

function Badge(props: { children: React.ReactNode; tone?: "neutral" | "dark" | "accent" | "warn" }) {
  const toneClass =
    props.tone === "dark"
      ? "border border-teal/30 bg-teal/15 text-teal-100"
      : props.tone === "accent"
        ? "border border-teal/30 bg-teal/20 text-teal-100"
        : props.tone === "warn"
          ? "border border-amber-300/30 bg-amber-300/15 text-amber-100"
          : "border border-white/10 bg-white/8 text-stone-200";

  return <span className={classNames("rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]", toneClass)}>{props.children}</span>;
}

function Banner(props: { notice?: string; error?: string }) {
  return (
    <>
      {props.notice ? <div className="mb-6 rounded-[1.7rem] border border-teal/25 bg-teal/15 px-5 py-4 text-sm text-teal-100">{props.notice}</div> : null}
      {props.error ? <div className="mb-6 rounded-[1.7rem] border border-rose-400/25 bg-rose-400/10 px-5 py-4 text-sm text-rose-100">{props.error}</div> : null}
    </>
  );
}

function Layout(props: {
  user: PublicGitHubUser | null;
  flash: FlashState;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-ink/75 px-6 py-5 shadow-panel backdrop-blur lg:flex-row lg:items-center lg:justify-between">
        <div>
          <a href="/" className="inline-flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.32em] text-teal-200">
            <span className="rounded-full bg-teal px-3 py-1 text-[11px] text-ink">YiJiex</span>
            AI Repo Analyzer
          </a>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300">
            React dashboard untuk login GitHub, menyusun workspace repository, dan merangkum aktivitas coding dari private atau shared repo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {props.user ? <a href="/dashboard" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-stone-100 transition hover:border-teal/40 hover:bg-white/10 hover:text-white">Dashboard</a> : null}
          {props.user ? (
            <>
              <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
                {props.user.avatarUrl ? <img src={props.user.avatarUrl} alt={props.user.username} className="h-8 w-8 rounded-full object-cover" /> : null}
                <span>@{props.user.username}</span>
              </div>
              <a href="/logout" className="rounded-full bg-clay px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
                Logout
              </a>
            </>
          ) : (
            <a href="/auth/github" className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110">
              Login GitHub
            </a>
          )}
        </div>
      </header>
      <Banner notice={props.flash.notice} error={props.flash.error} />
      {props.children}
    </div>
  );
}

function LandingPage(props: { user: PublicGitHubUser | null }) {
  useDocumentTitle("YiJiex AI Repo Analyzer");

  return (
    <section className="grid gap-6 xl:grid-cols-[1.14fr_0.86fr]">
      <article className="overflow-hidden rounded-[2.4rem] border border-white/10 bg-coal/75 p-8 shadow-panel backdrop-blur sm:p-10">
        <p className="inline-flex rounded-full border border-teal/25 bg-teal/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-teal-100">GitHub Native</p>
        <h1 className="mt-5 max-w-4xl text-4xl font-black leading-tight sm:text-5xl">
          Workspace analisa repo yang fokus ke commit nyata, private repository, dan summary AI yang bisa dibaca cepat.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-stone-300">
          Auth memakai GitHub OAuth, data repo diambil lewat Octokit, lalu hasil commit per tanggal dirangkum kembali oleh AI. Flow-nya dibuat seperti dashboard kerja, bukan form wizard.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {props.user ? (
            <a href="/dashboard" className="rounded-full bg-teal px-5 py-3 text-sm font-semibold text-ink transition hover:brightness-110">
              Masuk ke Dashboard
            </a>
          ) : (
            <a href="/auth/github" className="rounded-full bg-teal px-5 py-3 text-sm font-semibold text-ink transition hover:brightness-110">
              Login dengan GitHub
            </a>
          )}
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <StatCard label="1. OAuth" value="GitHub" description="Masuk dengan akun GitHub untuk membaca repo milik sendiri, organisasi, atau collaborator." />
          <StatCard label="2. Workspace" value="Private + Shared" description="Centang repo yang ingin dijadikan workspace aktif lalu simpan ke akun Anda." />
          <StatCard label="3. Insight" value="AI Summary" description="Buka ringkasan harian, commit patch, dan source file langsung dari browser." tone="accent" />
        </div>
      </article>
      <div className="space-y-6">
        <article className="rounded-[2rem] border border-white/10 bg-ink/85 p-8 text-white shadow-panel">
          <h2 className="text-lg font-bold">Status Workspace</h2>
          <dl className="mt-6 space-y-4 text-sm">
            <div className="rounded-3xl bg-white/10 px-4 py-3">
              <dt className="text-white/60">OAuth Config</dt>
              <dd className="mt-1 font-semibold">Dibaca dari environment server</dd>
            </div>
            <div className="rounded-3xl bg-white/10 px-4 py-3">
              <dt className="text-white/60">GitHub Session</dt>
              <dd className="mt-1 font-semibold">{props.user ? `Login sebagai @${props.user.username}` : "Belum login"}</dd>
            </div>
            <div className="rounded-3xl bg-white/10 px-4 py-3">
              <dt className="text-white/60">Repository Scope</dt>
              <dd className="mt-1 font-semibold">Private, shared, dan organization repository ikut terbaca</dd>
            </div>
          </dl>
        </article>
        <article className="rounded-[2rem] border border-white/10 bg-coal/75 p-6 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Yang Akan Anda Dapat</p>
          <div className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">Repo grid yang bisa difilter, disimpan, dan dianalisa langsung dari selection aktif.</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">Histori run per user, jadi dashboard tiap akun tetap personal.</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">Detail commit, patch file, dan source viewer tanpa pindah keluar dashboard.</div>
          </div>
        </article>
      </div>
    </section>
  );
}

function DashboardPage(props: {
  onSessionUserChange: (user: PublicGitHubUser) => void;
}) {
  const { data, setData, loading, error } = useRouteData<DashboardResponse>(
    "dashboard",
    () => requestJson<DashboardResponse>("/api/dashboard"),
    "Dashboard",
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
    return <LoadingState title="Menyiapkan dashboard..." subtitle="Mengambil akses repository dan histori run dari server." />;
  }

  if (error || !data) {
    return <FailureState title="Dashboard gagal dimuat" message={error || "Data dashboard tidak tersedia."} />;
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
    <section className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
      <div className="space-y-6">
        <Banner notice={localNotice || undefined} error={localError || undefined} />
        <article className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-7 shadow-panel backdrop-blur">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">React Workspace</p>
              <h1 className="mt-2 text-3xl font-black">Satu panel untuk connect, filter, lalu analyze repo GitHub</h1>
              <p className="mt-3 text-sm leading-7 text-stone-300">
                Checkbox di grid ini sekarang menjadi state utama. Anda bisa langsung analyze dari selection aktif, atau simpan dulu menjadi workspace permanen.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-teal/20 bg-teal/12 px-4 py-3 text-sm text-teal-100">
              Timezone report: <span className="font-semibold">{data.githubTimezone}</span> ({data.githubTimezoneOffset})
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <StatCard label="Active Selection" value={selectedRepositories.length} description="Repo yang sedang aktif di panel saat ini." />
            <StatCard label="Private Access" value={data.repositories.filter((repo) => repo.visibility === "private").length} description="Private repo yang terlihat dari akun GitHub Anda." />
            <StatCard label="Shared Access" value={data.repositories.filter((repo) => repo.accessType === "shared").length} description="Repo collaborator atau organization yang ikut terbaca." tone="accent" />
          </div>
        </article>

        <article className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-7 shadow-panel backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Run Analyzer</p>
              <h2 className="mt-2 text-2xl font-black">Jalankan dari selection yang sedang aktif</h2>
              <p className="mt-3 text-sm leading-7 text-stone-300">
                Tidak perlu submit form terpisah. Selection repo di atas langsung dipakai oleh tombol analyze ini.
              </p>
            </div>
            <Badge tone={data.groqReady ? "accent" : "warn"}>{data.groqReady ? "Groq Ready" : "Groq Missing"}</Badge>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {selectedRepositories.length > 0 ? (
              selectedRepositories.map((repoName) => (
                <Badge key={repoName} tone="dark">
                  {repoName}
                </Badge>
              ))
            ) : (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-300">Belum ada repo terpilih. Centang repository di grid bawah dulu.</p>
            )}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-[220px_1fr_auto]">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-stone-200">Report Date</span>
              <input
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-ink/70 px-4 py-3 text-sm text-white outline-none transition focus:border-teal/50 focus:ring-2 focus:ring-teal/20"
              />
            </label>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-300">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-300">Workspace State</div>
              <p className="mt-2 leading-6">
                {pendingWorkspaceChanges ? "Ada perubahan selection yang belum disimpan ke workspace." : "Selection aktif sudah sinkron dengan workspace yang tersimpan."}
              </p>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void handleAnalyze()}
                disabled={!canAnalyze}
                className={classNames(
                  "w-full rounded-full border px-6 py-3 text-sm font-semibold transition shadow-[0_12px_40px_rgba(0,0,0,0.28)]",
                  canAnalyze
                    ? "border-teal/30 bg-teal text-ink hover:brightness-110"
                    : "cursor-not-allowed border-white/10 bg-white/8 text-stone-400",
                )}
              >
                {runningAnalysis ? "Analyzing..." : "Analyze Selection"}
              </button>
            </div>
          </div>
          {!data.groqReady ? <p className="mt-3 text-sm text-amber-200">Isi `GROQ_API_KEY` di environment server agar analisa bisa dijalankan.</p> : null}
        </article>

        <article className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-7 shadow-panel backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Repository Access</p>
              <h2 className="mt-2 text-2xl font-black">Pilih repo yang ingin dipakai</h2>
              <p className="mt-3 text-sm leading-7 text-stone-300">
                Filter daftar, centang repo yang dibutuhkan, lalu simpan workspace jika selection itu ingin dijadikan default akun Anda.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={selectVisible} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-100 transition hover:border-teal/40 hover:bg-white/10 hover:text-white">
                Pilih Visible
              </button>
              <button type="button" onClick={clearVisible} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-100 transition hover:border-clay/60 hover:bg-white/10 hover:text-white">
                Lepas Visible
              </button>
              <button
                type="button"
                onClick={() => void handleSaveWorkspace()}
                disabled={savingWorkspace}
                className={classNames(
                  "rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition",
                  savingWorkspace
                    ? "border-white/10 bg-white/8 text-stone-400"
                    : "border-teal/25 bg-teal text-ink hover:brightness-110",
                )}
              >
                {savingWorkspace ? "Saving..." : "Save Workspace"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto]">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-stone-200">Cari Repository</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="owner/repo"
                className="w-full rounded-2xl border border-white/10 bg-ink/70 px-4 py-3 text-sm text-white outline-none transition focus:border-teal/50 focus:ring-2 focus:ring-teal/20"
              />
            </label>
            <div className="flex items-end">
              <div className="rounded-[1.4rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-300">
                {filteredRepositories.length} repo terlihat
              </div>
            </div>
          </div>

          <div className="mt-6 grid max-h-[38rem] gap-3 overflow-y-auto rounded-[1.8rem] border border-white/10 bg-ink/45 p-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredRepositories.length > 0 ? (
              filteredRepositories.map((repo) => {
                const checked = selectionSet.has(repo.fullName);
                return (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => toggleRepository(repo.fullName)}
                    className={classNames(
                      "flex h-full flex-col justify-between rounded-[1.5rem] border p-4 text-left transition",
                      checked
                        ? "border-teal/50 bg-slate/85 shadow-lg shadow-black/30"
                        : "border-white/10 bg-coal/75 hover:-translate-y-0.5 hover:border-teal/35 hover:bg-slate/70",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-white">{repo.fullName}</div>
                        {repo.description ? <p className="mt-1 text-xs leading-5 text-stone-300">{repo.description}</p> : null}
                      </div>
                      <div className={classNames("mt-1 h-5 w-5 rounded-full border-2", checked ? "border-teal bg-teal" : "border-white/20 bg-transparent")}>
                        <div className={classNames("m-auto mt-[3px] h-2 w-2 rounded-full", checked ? "bg-ink" : "bg-transparent")} />
                      </div>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Badge tone={repo.visibility === "private" ? "warn" : "neutral"}>{repo.visibility}</Badge>
                      <Badge tone={repo.accessType === "shared" ? "accent" : "dark"}>{repo.accessType}</Badge>
                      <Badge tone={repo.permissionLevel === "admin" ? "dark" : repo.permissionLevel === "write" ? "accent" : "neutral"}>{repo.permissionLevel}</Badge>
                      {repo.defaultBranch ? <Badge>{repo.defaultBranch}</Badge> : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="col-span-full rounded-[1.7rem] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-stone-300">
                Tidak ada repository yang cocok dengan filter saat ini.
              </div>
            )}
          </div>
        </article>
      </div>

      <div className="space-y-6">
        <article className="rounded-[2.2rem] border border-white/10 bg-ink/85 p-7 text-white shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/60">Session</p>
          <h2 className="mt-2 text-2xl font-black">{data.user.displayName || data.user.username}</h2>
          <p className="mt-2 text-sm text-white/70">{data.user.email || data.user.profileUrl || "GitHub session aktif"}</p>
          <div className="mt-5 grid gap-3 text-sm">
            <div className="rounded-[1.4rem] bg-white/10 px-4 py-3">
              <div className="text-white/60">Connected workspace</div>
              <div className="mt-1 font-semibold">{data.user.connectedRepositories.length} repo</div>
            </div>
            <div className="rounded-[1.4rem] bg-white/10 px-4 py-3">
              <div className="text-white/60">Groq model</div>
              <div className="mt-1 font-semibold">{data.groqModel}</div>
            </div>
            <div className="rounded-[1.4rem] bg-white/10 px-4 py-3">
              <div className="text-white/60">GitHub access</div>
              <div className="mt-1 font-semibold">{data.repositories.length} repo terlihat</div>
            </div>
          </div>
        </article>

        <article className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-7 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Recent Runs</p>
          <h2 className="mt-2 text-2xl font-black">Histori Analisa</h2>
          <div className="mt-5 space-y-3">
            {data.recentRuns.length > 0 ? (
              data.recentRuns.map((run) => <RecentRunCard key={run.id} run={run} />)
            ) : (
              <div className="rounded-[1.6rem] border border-dashed border-white/10 bg-white/5 p-5 text-sm text-stone-300">
                Belum ada histori analisa yang tersimpan untuk akun ini.
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

function RecentRunCard(props: { run: RecentRunSummary }) {
  return (
    <a href={`/runs/${escapePathSegment(props.run.id)}`} className="block rounded-[1.6rem] border border-white/10 bg-white/5 p-4 transition hover:border-teal/35 hover:bg-white/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-white">{props.run.reportDate}</div>
          <div className="mt-1 text-xs text-stone-400">
            {props.run.repositoryFullNames.slice(0, 3).join(", ")}
            {props.run.repositoryFullNames.length > 3 ? " ..." : ""}
          </div>
        </div>
        <div className="rounded-full border border-teal/30 bg-teal/15 px-3 py-1 text-xs font-semibold text-teal-100">{props.run.productivityScore}/100</div>
      </div>
      <p className="mt-3 text-sm leading-6 text-stone-300">{props.run.overallSummary}</p>
      <div className="mt-3 text-xs uppercase tracking-[0.2em] text-stone-500">{formatDateTime(props.run.createdAt)}</div>
    </a>
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
      <article className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-7 shadow-panel">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Run Detail</p>
            <h1 className="mt-2 text-3xl font-black">{run.report.reportDate}</h1>
            <p className="mt-4 text-base leading-7 text-stone-300">{run.report.overallSummary}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Productivity" value={run.report.productivityScore} description="Skor agregat dari run ini." tone="dark" />
            <StatCard label="Confidence" value={run.report.confidence} description="Tingkat keyakinan model terhadap summary." tone="accent" />
          </div>
        </div>
      </article>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-7 shadow-panel">
          <h2 className="text-2xl font-black">Highlights</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <ListSection title="Focus Areas" items={run.report.focusAreas} />
            <ListSection title="Activities" items={run.report.activities} />
          </div>
        </article>

        <article className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-7 shadow-panel">
          <h2 className="text-2xl font-black">Project Insights</h2>
          <div className="mt-5 space-y-3">
            {run.report.projectInsights.map((item) => (
              <div key={`${item.project}-${item.summary}`} className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-white">{item.project}</div>
                  <Badge>{item.status}</Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-stone-300">{item.summary}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Source Trace</p>
            <h2 className="mt-2 text-2xl font-black">Commit yang membentuk report</h2>
          </div>
          <a href="/dashboard" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-stone-100 transition hover:border-teal/35 hover:bg-white/10 hover:text-white">
            Kembali
          </a>
        </div>
        {run.collection.repositories.map((repo) => {
          const [owner, name] = repo.name.split("/");
          return (
            <article key={repo.name} className="rounded-[1.8rem] border border-white/10 bg-coal/70 p-5 shadow-panel">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-lg font-bold text-white">{repo.displayName || repo.name}</div>
                  <div className="mt-1 text-sm text-stone-400">
                    {repo.name} • {repo.commitsToday.length} commit • {repo.committedFilesToday.length} file touched
                  </div>
                </div>
                <a href={repo.path} target="_blank" rel="noreferrer" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-100 transition hover:border-teal/35 hover:bg-white/10 hover:text-white">
                  Open Repo
                </a>
              </div>
              <div className="mt-4 space-y-3">
                {repo.commitDetails.length > 0 ? (
                  repo.commitDetails.map((commit) => (
                    <a
                      key={commit.hash}
                      href={`/github/commit/${escapePathSegment(owner || "")}/${escapePathSegment(name || "")}/${escapePathSegment(commit.hash)}`}
                      className="block rounded-[1.4rem] border border-white/10 bg-white/5 px-4 py-3 transition hover:border-teal/35 hover:bg-white/10"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-white">{commit.subject}</div>
                        <div className="font-mono text-xs uppercase tracking-[0.2em] text-stone-400">{commit.shortHash}</div>
                      </div>
                      <div className="mt-2 text-xs text-stone-400">{formatDateTime(commit.committedAt)}</div>
                    </a>
                  ))
                ) : (
                  <div className="rounded-[1.4rem] border border-dashed border-white/10 px-4 py-3 text-sm text-stone-300">Tidak ada commit yang cocok pada tanggal ini.</div>
                )}
              </div>
            </article>
          );
        })}
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

  return (
    <section className="space-y-6">
      <article className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-7 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Commit Detail</p>
            <h1 className="mt-2 text-3xl font-black">{detail.subject}</h1>
            <p className="mt-3 text-sm text-stone-400">
              {detail.owner}/{detail.repo} • {detail.shortSha} • {detail.author} • {formatDateTime(detail.committedAt)}
            </p>
          </div>
          <a href={detail.htmlUrl} target="_blank" rel="noreferrer" className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-coal">
            Open on GitHub
          </a>
        </div>
      </article>

      <div className="space-y-4">
        {detail.files.map((file) => (
          <article key={file.fileName} className="rounded-[1.8rem] border border-white/10 bg-coal/70 p-5 shadow-panel">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-base font-bold text-white">{file.fileName}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.2em] text-stone-400">
                  {file.status || "modified"} • +{file.additions} -{file.deletions} • {file.changes} lines
                </div>
              </div>
              <a
                href={`/github/file?owner=${escapePathSegment(detail.owner)}&repo=${escapePathSegment(detail.repo)}&path=${escapePathSegment(file.fileName)}&ref=${escapePathSegment(detail.sha)}`}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-100 transition hover:border-teal/35 hover:bg-white/10 hover:text-white"
              >
                Lihat File
              </a>
            </div>
            <div className="mt-4 overflow-hidden rounded-[1.4rem] border border-white/10 bg-ink">
              <div className="border-b border-white/10 px-4 py-3 font-mono text-xs uppercase tracking-[0.2em] text-white/60">Patch</div>
              <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-stone-100">
                <code>{file.patch || "GitHub tidak mengembalikan patch untuk file ini."}</code>
              </pre>
            </div>
          </article>
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
      <article className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-7 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">File Content</p>
            <h1 className="mt-2 text-2xl font-black">{file.path}</h1>
            <p className="mt-2 text-sm text-stone-400">
              {file.owner}/{file.repo} • ref {file.ref}
            </p>
          </div>
          <a href={file.htmlUrl} target="_blank" rel="noreferrer" className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-coal">
            Open on GitHub
          </a>
        </div>
      </article>
      <article className="overflow-hidden rounded-[2rem] border border-white/10 bg-ink shadow-panel">
        <div className="border-b border-white/10 px-5 py-4 font-mono text-xs uppercase tracking-[0.2em] text-white/60">Source</div>
        <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-6 text-stone-100">
          <code>{file.content}</code>
        </pre>
      </article>
    </section>
  );
}

function ListSection(props: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-300">{props.title}</div>
      <ul className="mt-3 space-y-2 text-sm text-stone-200">
        {props.items.length > 0 ? (
          props.items.map((item, index) => (
            <li key={`${props.title}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              {item}
            </li>
          ))
        ) : (
          <li className="text-stone-500">-</li>
        )}
      </ul>
    </div>
  );
}

function LoadingState(props: { title: string; subtitle: string }) {
  return (
    <section className="rounded-[2.2rem] border border-white/10 bg-coal/75 p-10 shadow-panel">
      <div className="inline-flex h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-teal" />
      <h1 className="mt-6 text-3xl font-black">{props.title}</h1>
      <p className="mt-3 max-w-2xl text-base leading-7 text-stone-300">{props.subtitle}</p>
    </section>
  );
}

function FailureState(props: { title: string; message: string }) {
  return (
    <section className="rounded-[2.2rem] border border-rose-400/25 bg-coal/80 p-10 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-300">Error</p>
      <h1 className="mt-2 text-3xl font-black">{props.title}</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-stone-300">{props.message}</p>
      <div className="mt-8">
        <a href="/" className="rounded-full bg-teal px-5 py-3 text-sm font-semibold text-ink transition hover:brightness-110">
          Kembali ke Home
        </a>
      </div>
    </section>
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
      <Layout user={null} flash={sessionFlash}>
        <LoadingState title="Memeriksa session GitHub..." subtitle="Menunggu server memastikan apakah akun Anda sudah login." />
      </Layout>
    );
  }

  if (error || !session) {
    return (
      <Layout user={null} flash={sessionFlash}>
        <FailureState title="Session gagal dibaca" message={error || "Server tidak mengembalikan data session."} />
      </Layout>
    );
  }

  const user = session.user;
  const handleSessionUserChange = (nextUser: PublicGitHubUser) => {
    setSession((current) => (current ? { ...current, user: nextUser, authenticated: true } : current));
  };

  return (
      <Layout user={user} flash={sessionFlash}>
      {route.kind === "home" ? <LandingPage user={user} /> : null}
      {route.kind === "dashboard" && user ? <DashboardPage onSessionUserChange={handleSessionUserChange} /> : null}
      {route.kind === "run" && user ? <RunDetailPage route={route} /> : null}
      {route.kind === "commit" && user ? <CommitDetailPage route={route} /> : null}
      {route.kind === "file" && user ? <FileContentPage route={route} /> : null}
      {route.kind === "not_found" ? <FailureState title="Halaman tidak ditemukan" message="Route yang diminta belum tersedia di dashboard React ini." /> : null}
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
