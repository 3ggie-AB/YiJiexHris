import type { GitHubCommitDetailView, GitHubFileContentView } from "../services/github-collector";
import type { AiAnalysisReport, CollectedActivity } from "../types";
import type { GitHubRepositoryOption } from "./models";

export interface PublicGitHubUser {
  id: string;
  username: string;
  displayName?: string;
  profileUrl?: string;
  avatarUrl?: string;
  email?: string;
  connectedRepositories: string[];
}

export interface SessionResponse {
  authenticated: boolean;
  user: PublicGitHubUser | null;
  authUrl: string;
  logoutUrl: string;
  dashboardUrl: string;
}

export interface RecentRunSummary {
  id: string;
  reportDate: string;
  repositoryFullNames: string[];
  createdAt: string;
  productivityScore: number;
  overallSummary: string;
  confidence: AiAnalysisReport["confidence"];
}

export interface DashboardResponse {
  user: PublicGitHubUser;
  githubTimezone: string;
  githubTimezoneOffset: string;
  groqModel: string;
  groqReady: boolean;
  repositories: GitHubRepositoryOption[];
  recentRuns: RecentRunSummary[];
}

export interface HistoryResponse {
  runs: RecentRunSummary[];
}

export interface UpdateRepositoriesRequest {
  repositories: string[];
}

export interface UpdateRepositoriesResponse {
  user: PublicGitHubUser;
}

export interface AnalyzeRequest {
  reportDate?: string;
  repositories?: string[];
}

export interface AnalyzeResponse {
  runId: string;
}

export interface RunDetailResponse {
  run: {
    _id: string;
    reportDate: string;
    source: "github";
    repositoryFullNames: string[];
    createdBy: string;
    createdAt: string;
    collection: CollectedActivity;
    report: AiAnalysisReport;
    rawFile?: string;
    analysisFile?: string;
  };
}

export interface CommitDetailResponse {
  detail: GitHubCommitDetailView;
}

export interface FileContentResponse {
  file: GitHubFileContentView;
}

export interface ApiErrorResponse {
  error: string;
}
