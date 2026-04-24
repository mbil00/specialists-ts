export type GroundingMode = "memory_only" | "repo_only" | "web_only" | "repo_and_web";

export interface SpecialistProfileSnapshot {
  id: string;
  name: string;
  rolePrompt: string;
  goals: string[];
  nonGoals: string[];
  inputContract?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
  tags?: string[];
}

export interface ConsultationTask {
  question: string;
  taskBrief?: string;
  constraints: string[];
  assumptions: string[];
  responseFormat: "packet" | "markdown" | "json" | "text";
  groundingMode: GroundingMode;
}

export interface MemorySnippet {
  id: string;
  title?: string;
  summary: string;
  citations: string[];
  tags: string[];
  validated?: boolean;
}

export interface ArtifactSnippet {
  id: string;
  title: string;
  summary: string;
  citations: string[];
  tags: string[];
}

export interface WorkspaceObservation {
  source: "repo" | "web" | "memory" | "artifact" | "operator";
  label: string;
  detail: string;
  citations?: string[];
  tags?: string[];
}

export interface ExecutionCapabilities {
  repoTools: boolean;
  webSearch: boolean;
  webResearch: boolean;
  webFetch: boolean;
  fileAuthoring: boolean;
}

export interface SpecialistExecutionRequest {
  workspaceId: string;
  workspaceRoot: string;
  workspaceDisplayName: string;
  specialist: SpecialistProfileSnapshot;
  task: ConsultationTask;
  memory: MemorySnippet[];
  artifacts: ArtifactSnippet[];
  workspaceObservations: WorkspaceObservation[];
  capabilities: ExecutionCapabilities;
  outputDirectory?: string;
}

export interface ToolActivityRecord {
  toolName: string;
  toolKind: "repo" | "web_search" | "web_research" | "web_fetch" | "edit" | "write" | "other";
  success: boolean;
  startedAt?: string;
  endedAt?: string;
  inputSummary?: string;
  outputSummary?: string;
  touchedFiles: string[];
  visitedUrls: string[];
  citations: string[];
}

export interface SpecialistExecutionResult {
  answer: string;
  provider: string;
  model?: string;
  rawText: string;
  citations: string[];
  followUpQuestions: string[];
  authoredFiles: string[];
  toolActivity: ToolActivityRecord[];
}
