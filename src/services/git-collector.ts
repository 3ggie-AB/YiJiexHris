import path from "node:path";

import type {
  AppConfig,
  CollectedActivity,
  GitCommit,
  RepoActivity,
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

function parseCommits(raw: string): GitCommit[] {
  return raw
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash = "", shortHash = "", author = "", committedAt = "", subject = ""] = chunk.split("\x1f");
      return { hash, shortHash, author, committedAt, subject };
    })
    .filter((commit) => Boolean(commit.hash));
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
        } satisfies RepoFileChangeStat);

      current.additions += item.additions;
      current.deletions += item.deletions;
      current.changeCount = current.additions + current.deletions;
      for (const source of item.sources) {
        if (!current.sources.includes(source)) {
          current.sources.push(source);
        }
      }

      output.set(item.path, current);
    }
  }

  return Array.from(output.values()).sort((left, right) => right.changeCount - left.changeCount);
}

function collectRepository(repoPath: string): RepoActivity {
  const errors: string[] = [];
  const name = path.basename(repoPath);

  const branch = runGit(repoPath, ["branch", "--show-current"]);
  if (!branch.ok && branch.stderr) {
    errors.push(branch.stderr);
  }

  const commits = runGit(repoPath, [
    "log",
    "--since=midnight",
    "--date=iso-strict",
    "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e",
  ]);
  if (!commits.ok && commits.stderr) {
    errors.push(commits.stderr);
  }

  const committedFiles = runGit(repoPath, ["log", "--since=midnight", "--name-only", "--pretty=format:"]);
  if (!committedFiles.ok && committedFiles.stderr) {
    errors.push(committedFiles.stderr);
  }

  const committedFileStats = runGit(repoPath, ["log", "--since=midnight", "--numstat", "--pretty=format:"]);
  if (!committedFileStats.ok && committedFileStats.stderr) {
    errors.push(committedFileStats.stderr);
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

  return {
    name,
    path: repoPath,
    branch: branch.stdout || undefined,
    commitsToday: parseCommits(commits.stdout),
    committedFilesToday: parseFileList(committedFiles.stdout),
    workingTreeFiles: parseWorkingTree(status.stdout),
    fileChangeStats: mergeFileChangeStats(
      parseFileChangeStats(committedFileStats.stdout, "committed"),
      parseFileChangeStats(workingTreeFileStats.stdout, "working_tree"),
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
  const repoActivities = repositories.map((repoPath) => collectRepository(repoPath));
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
