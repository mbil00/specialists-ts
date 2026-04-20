export interface PiRunnerConfig {
  provider?: string;
  model?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  builtInRepoTools: readonly string[];
  webTools: readonly string[];
}

export const DEFAULT_SPECIALIST_PROVIDER = "openai-codex";
export const DEFAULT_SPECIALIST_MODEL = "gpt-5.4";
export const DEFAULT_BOOTSTRAP_MODEL = "gpt-5.4";
export const DEFAULT_BOOTSTRAP_THINKING_LEVEL = "high";
export const DEFAULT_BOOTSTRAP_REPO_EXPLORER_MODEL = "gpt-5.4-mini";
export const DEFAULT_BOOTSTRAP_REPO_EXPLORER_THINKING_LEVEL = "medium";

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
    provider: DEFAULT_SPECIALIST_PROVIDER,
    model: DEFAULT_SPECIALIST_MODEL,
    thinkingLevel: "medium",
    builtInRepoTools: DEFAULT_BUILT_IN_REPO_TOOLS,
    webTools: DEFAULT_WEB_TOOLS,
  };
}
