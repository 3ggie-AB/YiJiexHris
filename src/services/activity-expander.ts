import type { CollectedActivity, RepoActivity, RepoFileChangeStat } from "../types";
import { buildFileActivity, isMeaningfulFileChange, normalizeActivityKey, normalizeFilePath } from "./activity-signals";

const FALLBACK_MIN_CHANGE_COUNT = 8;
const FALLBACK_MIN_FILE_CHANGE_COUNT = 2;

function strongestSignalFiles(repo: RepoActivity): RepoFileChangeStat[] {
  return repo.fileChangeStats
    .filter(
      (file) =>
        isMeaningfulFileChange(file, FALLBACK_MIN_FILE_CHANGE_COUNT) && file.changeCount >= FALLBACK_MIN_CHANGE_COUNT,
    )
    .sort((left, right) => right.changeCount - left.changeCount);
}

function buildSupplementalActivities(collection: CollectedActivity, limit: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const repo of collection.repositories) {
    const perRepo: string[] = [];

    for (const file of strongestSignalFiles(repo)) {
      const candidate = buildFileActivity(repo, normalizeFilePath(file.path), {
        gitStatuses: file.gitStatuses,
      });
      if (!candidate) {
        continue;
      }

      const key = normalizeActivityKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      perRepo.push(candidate);

      if (perRepo.length >= 2) {
        break;
      }
    }

    output.push(...perRepo);
    if (output.length >= limit) {
      break;
    }
  }

  return output.slice(0, limit);
}

export function expandReportActivities(aiActivities: string[], collection: CollectedActivity, limit: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const activity of aiActivities.map((item) => item.trim()).filter(Boolean)) {
    const key = normalizeActivityKey(activity);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(activity);

    if (output.length >= limit) {
      return output;
    }
  }

  if (output.length > 0) {
    return output;
  }

  return buildSupplementalActivities(collection, limit);
}
