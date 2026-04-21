import type { AiAnalysisReport, CollectedActivity } from "../types";

export interface GitHubUserRecord {
  _id: string;
  username: string;
  displayName?: string;
  profileUrl?: string;
  avatarUrl?: string;
  email?: string;
  accessToken: string;
  connectedRepositories: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalysisRunRecord {
  reportDate: string;
  source: "github";
  repositoryFullNames: string[];
  createdBy: string;
  createdAt: Date;
  collection: CollectedActivity;
  report: AiAnalysisReport;
  rawFile?: string;
  analysisFile?: string;
}

export interface SavedAnalysisRun extends AnalysisRunRecord {
  _id: string;
}

export interface GitHubRepositoryOption {
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
}
