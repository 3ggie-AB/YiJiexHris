import { Octokit } from "@octokit/rest";

import type { AppConfig, CollectedActivity, RepoActivity, RepoCommitDetail, RepoFileChangeStat } from "../types";
import { getLocalReportDate } from "../utils/date";

interface CollectGitHubActivityOptions {
  accessToken: string;
  repositories?: string[];
  reportDate?: string;
  timezone?: string;
  timezoneOffset?: string;
}

export interface GitHubCommitFileDetail {
  fileName: string;
  status?: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blobUrl?: string;
  rawUrl?: string;
}

export interface GitHubCommitDetailView {
  owner: string;
  repo: string;
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string;
  author: string;
  htmlUrl: string;
  files: GitHubCommitFileDetail[];
}

export interface GitHubFileContentView {
  owner: string;
  repo: string;
  path: string;
  ref: string;
  content: string;
  htmlUrl: string;
}

function normalizeAliasKey(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function nextDateText(reportDate: string): string {
  const next = new Date(`${reportDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function buildIsoRange(reportDate: string, timezoneOffset: string): { since: string; until: string } {
  const offset = timezoneOffset.trim() || "+00:00";
  return {
    since: `${reportDate}T00:00:00${offset}`,
    until: `${nextDateText(reportDate)}T00:00:00${offset}`,
  };
}

function shortHash(sha: string): string {
  return sha.slice(0, 7);
}

function mapGitHubStatus(status: string | undefined): string[] {
  switch ((status ?? "").toLowerCase()) {
    case "added":
      return ["A"];
    case "removed":
      return ["D"];
    case "renamed":
      return ["R"];
    case "copied":
      return ["C"];
    default:
      return ["M"];
  }
}

function formatDiffStats(items: RepoFileChangeStat[]): string | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const additions = items.reduce((total, item) => total + item.additions, 0);
  const deletions = items.reduce((total, item) => total + item.deletions, 0);
  return `${items.length} file(s) changed, ${additions} insertion(s)(+), ${deletions} deletion(s)(-)`;
}

function resolveProjectLabel(config: AppConfig, fullName: string, repoName: string): string {
  const aliasEntries = [
    config.projectAliases[normalizeAliasKey(fullName)],
    config.projectAliases[normalizeAliasKey(repoName)],
  ].filter((value): value is string => Boolean(value?.trim()));

  return aliasEntries[0] ?? repoName;
}

async function listSelectedRepositories(
  octokit: Octokit,
  selectedRepositories: string[],
): Promise<Map<string, Awaited<ReturnType<typeof octokit.rest.repos.get>>>> {
  const output = new Map<string, Awaited<ReturnType<typeof octokit.rest.repos.get>>>();

  for (const fullName of selectedRepositories) {
    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) {
      continue;
    }

    const repository = await octokit.rest.repos.get({ owner, repo });
    output.set(fullName, repository);
  }

  return output;
}

async function listCommitDetailsForRepository(
  octokit: Octokit,
  owner: string,
  repo: string,
  config: AppConfig,
  since: string,
  until: string,
): Promise<RepoCommitDetail[]> {
  const commits = await octokit.paginate(octokit.rest.repos.listCommits, {
    owner,
    repo,
    since,
    until,
    per_page: Math.min(config.maxCommitsPerRepo, 100),
  });

  const limitedCommits = commits.slice(0, config.maxCommitsPerRepo);
  const output: RepoCommitDetail[] = [];

  for (const commit of limitedCommits) {
    const detail = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: commit.sha,
    });

    const fileStats: RepoFileChangeStat[] = (detail.data.files ?? [])
      .slice(0, config.maxFilesPerRepo)
      .map((file) => ({
        path: file.filename,
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        changeCount: file.changes ?? (file.additions ?? 0) + (file.deletions ?? 0),
        sources: ["committed"],
        gitStatuses: mapGitHubStatus(file.status),
      }));

    output.push({
      hash: detail.data.sha,
      shortHash: shortHash(detail.data.sha),
      author: detail.data.commit.author?.name || detail.data.author?.login || "Unknown",
      committedAt: detail.data.commit.author?.date || detail.data.commit.committer?.date || new Date().toISOString(),
      subject: detail.data.commit.message.split("\n")[0]?.trim() || "GitHub commit",
      files: fileStats.map((file) => file.path),
      fileChangeStats: fileStats,
      diffStats: formatDiffStats(fileStats),
    });
  }

  return output;
}

function buildRepoActivity(
  fullName: string,
  displayName: string,
  repository: Awaited<ReturnType<Octokit["rest"]["repos"]["get"]>>,
  commitDetails: RepoCommitDetail[],
): RepoActivity {
  const committedFilesToday = Array.from(new Set(commitDetails.flatMap((commit) => commit.files)));
  const fileChangeStats = commitDetails.flatMap((commit) => commit.fileChangeStats);
  const uniqueFileStats = new Map<string, RepoFileChangeStat>();

  for (const stat of fileChangeStats) {
    const current =
      uniqueFileStats.get(stat.path) ??
      ({
        path: stat.path,
        additions: 0,
        deletions: 0,
        changeCount: 0,
        sources: [],
        gitStatuses: [],
      } satisfies RepoFileChangeStat);

    current.additions += stat.additions;
    current.deletions += stat.deletions;
    current.changeCount = current.additions + current.deletions;
    for (const source of stat.sources) {
      if (!current.sources.includes(source)) {
        current.sources.push(source);
      }
    }
    for (const gitStatus of stat.gitStatuses ?? []) {
      if (!current.gitStatuses?.includes(gitStatus)) {
        current.gitStatuses?.push(gitStatus);
      }
    }

    uniqueFileStats.set(stat.path, current);
  }

  const commitsToday = commitDetails.map((commit) => ({
    hash: commit.hash,
    shortHash: commit.shortHash,
    author: commit.author,
    committedAt: commit.committedAt,
    subject: commit.subject,
  }));

  const lastCommit = commitDetails[0]
    ? `${commitDetails[0].shortHash} - ${commitDetails[0].subject} (${commitDetails[0].committedAt})`
    : undefined;

  return {
    name: fullName,
    displayName,
    path: repository.data.html_url,
    branch: repository.data.default_branch || undefined,
    commitsToday,
    commitDetails,
    committedFilesToday,
    workingTreeFiles: [],
    workingTreeFileChangeStats: [],
    fileChangeStats: Array.from(uniqueFileStats.values()).sort((left, right) => right.changeCount - left.changeCount),
    diffStats: formatDiffStats(Array.from(uniqueFileStats.values())),
    lastCommit,
    isDirty: false,
    errors: [],
  };
}

export async function collectGitHubActivity(
  config: AppConfig,
  options: CollectGitHubActivityOptions,
): Promise<CollectedActivity> {
  const octokit = new Octokit({ auth: options.accessToken });
  const reportDate = options.reportDate || getLocalReportDate();
  const timezone = options.timezone || "UTC";
  const timezoneOffset = options.timezoneOffset || "+00:00";
  const selectedRepositories = Array.from(new Set((options.repositories ?? []).map((item) => item.trim()).filter(Boolean)));

  if (selectedRepositories.length === 0) {
    throw new Error("Pilih minimal satu repository GitHub.");
  }

  const repoResponses = await listSelectedRepositories(octokit, selectedRepositories);
  const { since, until } = buildIsoRange(reportDate, timezoneOffset);

  const repositories: RepoActivity[] = [];

  for (const fullName of selectedRepositories) {
    const repository = repoResponses.get(fullName);
    if (!repository) {
      continue;
    }

    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) {
      continue;
    }

    try {
      const commitDetails = await listCommitDetailsForRepository(octokit, owner, repo, config, since, until);
      repositories.push(
        buildRepoActivity(fullName, resolveProjectLabel(config, fullName, repository.data.name), repository, commitDetails),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      repositories.push({
        name: fullName,
        displayName: resolveProjectLabel(config, fullName, repository.data.name),
        path: repository.data.html_url,
        branch: repository.data.default_branch || undefined,
        commitsToday: [],
        commitDetails: [],
        committedFilesToday: [],
        workingTreeFiles: [],
        workingTreeFileChangeStats: [],
        fileChangeStats: [],
        diffStats: undefined,
        lastCommit: undefined,
        isDirty: false,
        errors: [message],
      });
    }
  }

  const totalCommits = repositories.reduce((total, repo) => total + repo.commitsToday.length, 0);
  const totalCommittedFiles = repositories.reduce((total, repo) => total + repo.committedFilesToday.length, 0);
  const uniqueFilesTouched = new Set(repositories.flatMap((repo) => repo.committedFilesToday)).size;
  const activeProjectCount = repositories.filter((repo) => repo.commitsToday.length > 0).length;

  return {
    generatedAt: new Date().toISOString(),
    reportDate,
    timezone,
    repositories,
    metrics: {
      projectCount: repositories.length,
      activeProjectCount,
      reposWithCommitsToday: activeProjectCount,
      dirtyRepoCount: 0,
      totalCommits,
      totalCommittedFiles,
      totalWorkingTreeFiles: 0,
      uniqueFilesTouched,
    },
  };
}

export async function listGitHubRepositories(
  accessToken: string,
  viewerUsername: string,
  selectedRepositories: string[] = [],
): Promise<
  Array<{
    id: number;
    fullName: string;
    owner: string;
    name: string;
    description?: string;
    private: boolean;
    visibility: "private" | "public";
    accessType: "owned" | "shared";
    permissionLevel: "admin" | "write" | "read";
    htmlUrl: string;
    defaultBranch?: string;
    updatedAt?: string;
    selected: boolean;
  }>
> {
  const octokit = new Octokit({ auth: accessToken });
  const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    sort: "updated",
    affiliation: "owner,collaborator,organization_member",
    per_page: 100,
  });
  const selectedSet = new Set(selectedRepositories.map((item) => item.trim()).filter(Boolean));

  return repos
    .map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      owner: repo.owner?.login || repo.full_name.split("/")[0] || "",
      name: repo.name,
      description: repo.description || undefined,
      private: repo.private,
      visibility: repo.private ? "private" : "public",
      accessType:
        (repo.owner?.login || "").toLowerCase() === viewerUsername.trim().toLowerCase() ? "owned" : "shared",
      permissionLevel: repo.permissions?.admin ? "admin" : repo.permissions?.push ? "write" : "read",
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch || undefined,
      updatedAt: repo.updated_at || undefined,
      selected: selectedSet.has(repo.full_name),
    }))
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}

export async function getGitHubCommitDetail(
  accessToken: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<GitHubCommitDetailView> {
  const octokit = new Octokit({ auth: accessToken });
  const detail = await octokit.rest.repos.getCommit({
    owner,
    repo,
    ref: sha,
  });

  return {
    owner,
    repo,
    sha: detail.data.sha,
    shortSha: shortHash(detail.data.sha),
    subject: detail.data.commit.message.split("\n")[0]?.trim() || "GitHub commit",
    committedAt: detail.data.commit.author?.date || detail.data.commit.committer?.date || new Date().toISOString(),
    author: detail.data.commit.author?.name || detail.data.author?.login || "Unknown",
    htmlUrl: detail.data.html_url,
    files: (detail.data.files ?? []).map((file) => ({
      fileName: file.filename,
      status: file.status || undefined,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      changes: file.changes ?? (file.additions ?? 0) + (file.deletions ?? 0),
      patch: file.patch || undefined,
      blobUrl: file.blob_url || undefined,
      rawUrl: file.raw_url || undefined,
    })),
  };
}

export async function getGitHubFileContent(
  accessToken: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<GitHubFileContentView> {
  const octokit = new Octokit({ auth: accessToken });
  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: filePath,
    ref,
  });

  if (Array.isArray(response.data) || response.data.type !== "file") {
    throw new Error("Path yang dipilih bukan file.");
  }

  const content =
    response.data.encoding === "base64" && response.data.content
      ? Buffer.from(response.data.content, "base64").toString("utf8")
      : "";

  return {
    owner,
    repo,
    path: filePath,
    ref,
    content,
    htmlUrl: response.data.html_url || `https://github.com/${owner}/${repo}/blob/${ref}/${filePath}`,
  };
}
