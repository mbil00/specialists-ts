export interface WebToolsConfig {
  searchProvider: "auto" | "exa" | "brave";
  exaApiKey?: string;
  braveApiKey?: string;
  fetchTimeoutMs: number;
  fetchUserAgent: string;
  defaultMaxResults: number;
  webResearchPiCommand: string;
  webResearchModel?: string;
  webResearchThinking?: string;
  webResearchTimeoutMs: number;
  defaultResearchMaxPages: number;
  webResearchExtensionPath?: string;
}

export function loadWebToolsConfig(env: NodeJS.ProcessEnv = process.env): WebToolsConfig {
  return {
    searchProvider: coerceSearchProvider(env.SPECIALISTS_WEB_SEARCH_PROVIDER),
    exaApiKey: trimToUndefined(env.EXA_API_KEY),
    braveApiKey: trimToUndefined(env.BRAVE_SEARCH_API_KEY),
    fetchTimeoutMs: coercePositiveInt(env.SPECIALISTS_WEB_FETCH_TIMEOUT_MS, 20_000),
    fetchUserAgent:
      trimToUndefined(env.SPECIALISTS_WEB_FETCH_USER_AGENT) ?? "specialists-ts/0.1 (+https://pi.dev)",
    defaultMaxResults: coercePositiveInt(env.SPECIALISTS_WEB_SEARCH_DEFAULT_MAX_RESULTS, 5),
    webResearchPiCommand: trimToUndefined(env.SPECIALISTS_WEB_RESEARCH_PI_COMMAND) ?? "pi",
    webResearchModel: trimToUndefined(env.SPECIALISTS_WEB_RESEARCH_MODEL),
    webResearchThinking: trimToUndefined(env.SPECIALISTS_WEB_RESEARCH_THINKING) ?? "medium",
    webResearchTimeoutMs: coercePositiveInt(env.SPECIALISTS_WEB_RESEARCH_TIMEOUT_MS, 120_000),
    defaultResearchMaxPages: coercePositiveInt(env.SPECIALISTS_WEB_RESEARCH_DEFAULT_MAX_PAGES, 4),
    webResearchExtensionPath: trimToUndefined(env.SPECIALISTS_WEB_RESEARCH_EXTENSION_PATH),
  };
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function coercePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function coerceSearchProvider(value: string | undefined): WebToolsConfig["searchProvider"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "exa" || normalized === "brave" || normalized === "auto") {
    return normalized;
  }
  return "auto";
}
