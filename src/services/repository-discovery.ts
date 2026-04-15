import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../types";

function isGitRepo(repoPath: string): boolean {
  return existsSync(path.join(repoPath, ".git"));
}

export async function discoverRepositories(config: AppConfig): Promise<string[]> {
  const discovered = new Set<string>();

  const directCandidates = config.projectRepos.length > 0 ? config.projectRepos : [process.cwd()];

  for (const repoPath of directCandidates) {
    if (isGitRepo(repoPath)) {
      discovered.add(path.resolve(repoPath));
    }
  }

  const ignored = new Set(config.discoveryIgnoreNames);

  for (const baseDir of config.projectBaseDirs) {
    if (isGitRepo(baseDir)) {
      discovered.add(path.resolve(baseDir));
      continue;
    }

    let entries;
    try {
      entries = await readdir(baseDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || ignored.has(entry.name)) {
        continue;
      }

      const candidatePath = path.join(baseDir, entry.name);
      if (isGitRepo(candidatePath)) {
        discovered.add(path.resolve(candidatePath));
      }
    }
  }

  return Array.from(discovered).sort((left, right) => left.localeCompare(right));
}
