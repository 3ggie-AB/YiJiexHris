import path from "node:path";

import type {
  AppConfig,
  CollectedActivity,
  GitCommit,
  RepoActivity,
  RepoCommitDetail,
  RepoFileChangeStat,
  WorkingTreeFile,
} from "../types";
import { getLocalReportDate } from "../utils/date";
import { discoverRepositories } from "./repository-discovery";

interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface ParsedCommitBlock extends GitCommit {
  lines: string[];
}

interface ParsedGitPathStatus {
  path: string;
  gitStatus: string;
}

function normalizeAliasKey(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function runGit(repoPath: string, args: string[]): GitCommandResult {
  const result = Bun.spawnSync(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();

  return {
    ok: result.exitCode === 0,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  };
}

function parseWorkingTree(raw: string): WorkingTreeFile[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawStatus = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;

      return {
        path: filePath,
        indexStatus: rawStatus[0] ?? " ",
        workTreeStatus: rawStatus[1] ?? " ",
        rawStatus,
      };
    });
}

function parseFileList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeGitPath(rawPath: string): string {
  let filePath = rawPath.trim().replace(/\\/g, "/");

  const braceRenameMatch = filePath.match(/\{([^{}]+) => ([^{}]+)\}/);
  if (braceRenameMatch) {
    filePath = filePath.replace(braceRenameMatch[0], braceRenameMatch[2] ?? "");
  } else if (filePath.includes(" => ")) {
    filePath = filePath.split(" => ").at(-1)?.trim() ?? filePath;
  }

  return filePath;
}

function parseNumStatValue(raw: string): number {
  if (!raw.trim() || raw.trim() === "-") {
    return 0;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseFileChangeStats(
  raw: string,
  source: RepoFileChangeStat["sources"][number],
): RepoFileChangeStat[] {
  const output = new Map<string, RepoFileChangeStat>();

  for (const line of raw.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    const [rawAdditions = "0", rawDeletions = "0", ...pathParts] = line.split("\t");
    const filePath = normalizeGitPath(pathParts.join("\t"));
    if (!filePath) {
      continue;
    }

    const additions = parseNumStatValue(rawAdditions);
    const deletions = parseNumStatValue(rawDeletions);
    const current =
      output.get(filePath) ??
      ({
        path: filePath,
        additions: 0,
        deletions: 0,
        changeCount: 0,
        sources: [],
        gitStatuses: [],
      } satisfies RepoFileChangeStat);

    current.additions += additions;
    current.deletions += deletions;
    current.changeCount = current.additions + current.deletions;
    if (!current.sources.includes(source)) {
      current.sources.push(source);
    }

    output.set(filePath, current);
  }

  return Array.from(output.values());
}

function mergeFileChangeStats(...groups: RepoFileChangeStat[][]): RepoFileChangeStat[] {
  const output = new Map<string, RepoFileChangeStat>();

  for (const group of groups) {
    for (const item of group) {
      const current =
        output.get(item.path) ??
        ({
          path: item.path,
          additions: 0,
          deletions: 0,
          changeCount: 0,
          sources: [],
          gitStatuses: [],
        } satisfies RepoFileChangeStat);

      current.additions += item.additions;
      current.deletions += item.deletions;
      current.changeCount = current.additions + current.deletions;
      for (const source of item.sources) {
        if (!current.sources.includes(source)) {
          current.sources.push(source);
        }
      }
      for (const gitStatus of item.gitStatuses ?? []) {
        if (!current.gitStatuses?.includes(gitStatus)) {
          current.gitStatuses?.push(gitStatus);
        }
      }

      output.set(item.path, current);
    }
  }

  return Array.from(output.values()).sort((left, right) => right.changeCount - left.changeCount);
}

function formatShortDiffStats(items: RepoFileChangeStat[]): string | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const additions = items.reduce((total, item) => total + item.additions, 0);
  const deletions = items.reduce((total, item) => total + item.deletions, 0);
  return `${items.length} file(s) changed, ${additions} insertion(s)(+), ${deletions} deletion(s)(-)`;
}

function parseCommitBlocks(raw: string): ParsedCommitBlock[] {
  return raw
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
      const [header = "", ...statLines] = lines;
      const [hash = "", shortHash = "", author = "", committedAt = "", subject = ""] = header.split("\x1f");

      return {
        hash,
        shortHash,
        author,
        committedAt,
        subject,
        lines: statLines,
      } satisfies ParsedCommitBlock;
    })
    .filter((commit) => Boolean(commit.hash));
}

function normalizeGitStatus(rawStatus: string): string | undefined {
  const trimmed = rawStatus.trim().toUpperCase();
  if (!trimmed || trimmed === "!") {
    return undefined;
  }

  return trimmed === "?" ? "A" : trimmed[0];
}

function parseNameStatusLines(lines: string[]): ParsedGitPathStatus[] {
  const output: ParsedGitPathStatus[] = [];

  for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
    const parts = line.split("\t");
    const gitStatus = normalizeGitStatus(parts[0] ?? "");
    if (!gitStatus) {
      continue;
    }

    const rawPath = gitStatus === "R" || gitStatus === "C" ? parts.at(-1) ?? "" : parts.slice(1).join("\t");
    const filePath = normalizeGitPath(rawPath);
    if (!filePath) {
      continue;
    }

    output.push({
      path: filePath,
      gitStatus,
    });
  }

  return output;
}

function mergeGitStatusesIntoFileStats(
  fileStats: RepoFileChangeStat[],
  pathStatuses: ParsedGitPathStatus[],
  source: RepoFileChangeStat["sources"][number],
): RepoFileChangeStat[] {
  const output = new Map<string, RepoFileChangeStat>(
    fileStats.map((item) => [
      item.path,
      {
        ...item,
        gitStatuses: [...(item.gitStatuses ?? [])],
      },
    ]),
  );

  for (const pathStatus of pathStatuses) {
    const current =
      output.get(pathStatus.path) ??
      ({
        path: pathStatus.path,
        additions: 0,
        deletions: 0,
        changeCount: 0,
        sources: [],
        gitStatuses: [],
      } satisfies RepoFileChangeStat);

    if (!current.sources.includes(source)) {
      current.sources.push(source);
    }

    if (!current.gitStatuses?.includes(pathStatus.gitStatus)) {
      current.gitStatuses?.push(pathStatus.gitStatus);
    }

    output.set(pathStatus.path, current);
  }

  return Array.from(output.values());
}

function toWorkingTreePathStatuses(workingTreeFiles: WorkingTreeFile[]): ParsedGitPathStatus[] {
  const output: ParsedGitPathStatus[] = [];

  for (const file of workingTreeFiles) {
    const statuses = new Set(
      [file.indexStatus, file.workTreeStatus]
        .map((status) => normalizeGitStatus(status))
        .filter((status): status is string => Boolean(status)),
    );

    for (const gitStatus of statuses) {
      output.push({
        path: normalizeGitPath(file.path),
        gitStatus,
      });
    }
  }

  return output;
}

function parseCommitDetails(rawNumStat: string, rawNameStatus: string): RepoCommitDetail[] {
  const numStatBlocks = parseCommitBlocks(rawNumStat);
  const nameStatusBlocks = new Map(parseCommitBlocks(rawNameStatus).map((block) => [block.hash, block]));

  return numStatBlocks
    .map((block) => {
      const fileChangeStats = parseFileChangeStats(block.lines.join("\n"), "committed");
      const pathStatuses = parseNameStatusLines(nameStatusBlocks.get(block.hash)?.lines ?? []);
      const mergedFileChangeStats = mergeGitStatusesIntoFileStats(fileChangeStats, pathStatuses, "committed");

      return {
        hash: block.hash,
        shortHash: block.shortHash,
        author: block.author,
        committedAt: block.committedAt,
        subject: block.subject,
        files: mergedFileChangeStats.map((item) => item.path),
        fileChangeStats: mergedFileChangeStats,
        diffStats: formatShortDiffStats(mergedFileChangeStats),
      } satisfies RepoCommitDetail;
    })
    .filter((commit) => Boolean(commit.hash));
}

function resolveRepoDisplayName(repoPath: string, aliases: Record<string, string>): string | undefined {
  const resolvedPath = path.resolve(repoPath);
  const repoName = path.basename(resolvedPath);
  const candidates = [resolvedPath, repoPath, repoName];

  for (const candidate of candidates) {
    const alias = aliases[normalizeAliasKey(candidate)];
    if (alias) {
      return alias;
    }
  }

  return undefined;
}

function collectRepository(repoPath: string, config: AppConfig): RepoActivity {
  const errors: string[] = [];
  const resolvedPath = path.resolve(repoPath);
  const name = path.basename(resolvedPath);
  const displayName = resolveRepoDisplayName(repoPath, config.projectAliases);

  const branch = runGit(repoPath, ["branch", "--show-current"]);
  if (!branch.ok && branch.stderr) {
    errors.push(branch.stderr);
  }

  const commitDetailsLog = runGit(repoPath, [
    "log",
    "--since=midnight",
    "--numstat",
    "--date=iso-strict",
    "--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ad%x1f%s",
  ]);
  if (!commitDetailsLog.ok && commitDetailsLog.stderr) {
    errors.push(commitDetailsLog.stderr);
  }

  const commitNameStatusLog = runGit(repoPath, [
    "log",
    "--since=midnight",
    "--name-status",
    "--date=iso-strict",
    "--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ad%x1f%s",
  ]);
  if (!commitNameStatusLog.ok && commitNameStatusLog.stderr) {
    errors.push(commitNameStatusLog.stderr);
  }

  const status = runGit(repoPath, ["status", "--porcelain=v1", "-uall"]);
  if (!status.ok && status.stderr) {
    errors.push(status.stderr);
  }

  const workingTreeFileStats = runGit(repoPath, ["diff", "HEAD", "--numstat"]);
  if (!workingTreeFileStats.ok && workingTreeFileStats.stderr) {
    errors.push(workingTreeFileStats.stderr);
  }

  const diffStats = runGit(repoPath, ["diff", "--shortstat"]);
  if (!diffStats.ok && diffStats.stderr) {
    errors.push(diffStats.stderr);
  }

  const lastCommit = runGit(repoPath, ["log", "-1", "--date=iso-strict", "--pretty=format:%h - %s (%ad)"]);
  if (!lastCommit.ok && lastCommit.stderr) {
    errors.push(lastCommit.stderr);
  }

  const workingTreeFiles = parseWorkingTree(status.stdout);
  const commitDetails = parseCommitDetails(commitDetailsLog.stdout, commitNameStatusLog.stdout);
  const commitsToday: GitCommit[] = commitDetails.map(({ files: _files, fileChangeStats: _stats, diffStats, ...commit }) => ({
    ...commit,
  }));
  const committedFilesToday = parseFileList(commitDetails.flatMap((commit) => commit.files).join("\n"));
  const committedFileChangeStats = mergeFileChangeStats(...commitDetails.map((commit) => commit.fileChangeStats));
  const workingTreeFileChangeStats = mergeGitStatusesIntoFileStats(
    parseFileChangeStats(workingTreeFileStats.stdout, "working_tree"),
    toWorkingTreePathStatuses(workingTreeFiles),
    "working_tree",
  );

  return {
    name,
    displayName,
    path: repoPath,
    branch: branch.stdout || undefined,
    commitsToday,
    commitDetails,
    committedFilesToday,
    workingTreeFiles,
    workingTreeFileChangeStats,
    fileChangeStats: mergeFileChangeStats(
      committedFileChangeStats,
      workingTreeFileChangeStats,
    ),
    diffStats: diffStats.stdout || undefined,
    lastCommit: lastCommit.stdout || undefined,
    isDirty: status.stdout.length > 0,
    errors: Array.from(new Set(errors)),
  };
}

export async function collectActivity(config: AppConfig): Promise<CollectedActivity> {
  const repositories = await discoverRepositories(config);
  if (repositories.length === 0) {
    throw new Error("No Git repositories found. Set PROJECT_REPOS or PROJECTS_BASE_DIRS.");
  }

  const reportDate = getLocalReportDate();
  const repoActivities = repositories.map((repoPath) => collectRepository(repoPath, config));
  const activeRepositories = repoActivities.filter(
    (repo) => repo.commitsToday.length > 0 || repo.workingTreeFiles.length > 0,
  );

  const uniqueTouchedFiles = new Set<string>();
  for (const repo of repoActivities) {
    for (const filePath of repo.committedFilesToday) {
      uniqueTouchedFiles.add(`${repo.path}:${filePath}`);
    }
    for (const file of repo.workingTreeFiles) {
      uniqueTouchedFiles.add(`${repo.path}:${file.path}`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    reportDate,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    repositories: repoActivities,
    metrics: {
      projectCount: repoActivities.length,
      activeProjectCount: activeRepositories.length,
      reposWithCommitsToday: repoActivities.filter((repo) => repo.commitsToday.length > 0).length,
      dirtyRepoCount: repoActivities.filter((repo) => repo.isDirty).length,
      totalCommits: repoActivities.reduce((total, repo) => total + repo.commitsToday.length, 0),
      totalCommittedFiles: repoActivities.reduce((total, repo) => total + repo.committedFilesToday.length, 0),
      totalWorkingTreeFiles: repoActivities.reduce((total, repo) => total + repo.workingTreeFiles.length, 0),
      uniqueFilesTouched: uniqueTouchedFiles.size,
    },
  };
}
