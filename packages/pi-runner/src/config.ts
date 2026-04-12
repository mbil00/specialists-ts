export interface PiRunnerConfig {
  provider?: string;
  model?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  builtInRepoTools: readonly string[];
  webTools: readonly string[];
}

export const DEFAULT_BUILT_IN_REPO_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export const DEFAULT_WEB_TOOLS = [
  "web_search",
  "web_research",
  "web_fetch",
] as const;

export function createDefaultPiRunnerConfig(): PiRunnerConfig {
  return {
    provider: undefined,
    model: undefined,
    thinkingLevel: "medium",
    builtInRepoTools: DEFAULT_BUILT_IN_REPO_TOOLS,
    webTools: DEFAULT_WEB_TOOLS,
  };
}
