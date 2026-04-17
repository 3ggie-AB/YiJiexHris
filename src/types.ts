export interface AppConfig {
  groqApiKey?: string;
  groqBaseUrl: string;
  groqModel: string;
  groqAnalysisModel: string;
  groqAnalysisMaxRequests: number;
  projectRepos: string[];
  projectBaseDirs: string[];
  discoveryIgnoreNames: string[];
  projectPreviewUrls: Record<string, string>;
  projectRunCommands: Record<string, string>;
  projectRouteRules: Record<string, ProjectRouteRule[]>;
  projectWebAuth: Record<string, ProjectWebAuthConfig>;
  projectAliases: Record<string, string>;
  hrisLoginUrl?: string;
  hrisCardsUrl?: string;
  hrisApiMethod: "POST" | "PUT" | "PATCH";
  hrisEmail?: string;
  hrisPassword?: string;
  hrisListId?: number;
  hrisBoardId?: number;
  hrisBoardListsUrl?: string;
  hrisCardLimit: number;
  hrisApiToken?: string;
  hrisAuthHeader: string;
  hrisTokenPrefix: string;
  hrisHeaders: Record<string, string>;
  hrisPayloadStatic: Record<string, unknown>;
  hrisCardChecklists: HrisChecklistTemplate[];
  hrisSendDescription: boolean;
  hrisSendEvidence: boolean;
  hrisEvidenceMode: "none" | "auto" | "code" | "url";
  hrisEvidenceDir?: string;
  hrisBrowserPath?: string;
  hrisCodeScreenshotStyle: "legacy" | "ray";
  hrisCodeScreenshotStrict: boolean;
  hrisDevServerWaitMs: number;
  hrisEmployeeId?: string;
  outputDir?: string;
  maxCommitsPerRepo: number;
  maxFilesPerRepo: number;
  analysisMinFileChangeCount: number;
  analysisMinUnitChangeCount: number;
  scheduleTime?: string;
  scheduleRunOnStart: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  committedAt: string;
  subject: string;
}

export interface WorkingTreeFile {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  rawStatus: string;
}

export interface RepoFileChangeStat {
  path: string;
  additions: number;
  deletions: number;
  changeCount: number;
  sources: Array<"committed" | "working_tree">;
}

export interface RepoCommitDetail extends GitCommit {
  files: string[];
  fileChangeStats: RepoFileChangeStat[];
  diffStats?: string;
}

export interface RepoActivity {
  name: string;
  displayName?: string;
  path: string;
  branch?: string;
  commitsToday: GitCommit[];
  commitDetails: RepoCommitDetail[];
  committedFilesToday: string[];
  workingTreeFiles: WorkingTreeFile[];
  workingTreeFileChangeStats: RepoFileChangeStat[];
  fileChangeStats: RepoFileChangeStat[];
  diffStats?: string;
  lastCommit?: string;
  isDirty: boolean;
  errors: string[];
}

export interface CollectionMetrics {
  projectCount: number;
  activeProjectCount: number;
  reposWithCommitsToday: number;
  dirtyRepoCount: number;
  totalCommits: number;
  totalCommittedFiles: number;
  totalWorkingTreeFiles: number;
  uniqueFilesTouched: number;
}

export interface CollectedActivity {
  generatedAt: string;
  reportDate: string;
  timezone: string;
  repositories: RepoActivity[];
  metrics: CollectionMetrics;
}

export interface ProjectInsight {
  project: string;
  status: "active" | "maintenance" | "idle" | "blocked";
  summary: string;
  commitCount: number;
  changedFilesCount: number;
}

export interface ProjectRouteRule {
  match: string;
  path?: string;
  url?: string;
}

export interface ProjectWebAuthConfig {
  loginUrl?: string;
  loginPath?: string;
  email?: string;
  password?: string;
  emailSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  postLoginWaitMs?: number;
}

export interface AiAnalysisReport {
  generatedAt: string;
  reportDate: string;
  productivityScore: number;
  overallSummary: string;
  focusAreas: string[];
  achievements: string[];
  blockers: string[];
  improvements: string[];
  nextPriorities: string[];
  activities: string[];
  confidence: "low" | "medium" | "high";
  projectInsights: ProjectInsight[];
}

export interface PipelineArtifacts {
  rawFile?: string;
  analysisFile?: string;
  payloadFile?: string;
}

export interface HrisChecklistTemplate {
  id?: number;
  title: string;
  checklist: "yes" | "no";
  position: number;
}

export interface HrisCardPayload {
  list_id: number;
  title: string;
  description: string;
  checklists: HrisChecklistTemplate[];
  buktiPath?: string;
  buktiFilename?: string;
  buktiContentType?: string;
  [key: string]: unknown;
}

export interface HrisCreatedCardResult {
  title: string;
  status: number;
  ok: boolean;
  request: HrisCardPayload;
  responseBody?: unknown;
}

export interface HrisDeliveryResult {
  loginUrl?: string;
  url: string;
  method: string;
  status: number;
  ok: boolean;
  responseBody?: unknown;
  payload: {
    tokenSource: "login" | "env_token";
    cards: HrisCardPayload[];
  };
  createdCards: HrisCreatedCardResult[];
}
