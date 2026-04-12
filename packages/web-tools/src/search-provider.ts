import { loadWebToolsConfig, type WebToolsConfig } from "./config.js";
import { BraveSearchProvider } from "./providers/brave.js";
import { ExaSearchProvider } from "./providers/exa.js";
import { FallbackSearchProvider } from "./providers/fallback.js";
import type { SearchProvider } from "./types.js";

export function createSearchProvider(config: WebToolsConfig = loadWebToolsConfig()): SearchProvider {
  if (config.searchProvider === "exa") {
    if (!config.exaApiKey) {
      throw new Error("SPECIALISTS_WEB_SEARCH_PROVIDER=exa requires EXA_API_KEY.");
    }
    return new ExaSearchProvider(config.exaApiKey);
  }

  if (config.searchProvider === "brave") {
    if (!config.braveApiKey) {
      throw new Error("SPECIALISTS_WEB_SEARCH_PROVIDER=brave requires BRAVE_SEARCH_API_KEY.");
    }
    return new BraveSearchProvider(config.braveApiKey);
  }

  if (config.braveApiKey && config.exaApiKey) {
    return new FallbackSearchProvider(
      new BraveSearchProvider(config.braveApiKey),
      new ExaSearchProvider(config.exaApiKey),
    );
  }
  if (config.braveApiKey) {
    return new BraveSearchProvider(config.braveApiKey);
  }
  if (config.exaApiKey) {
    return new ExaSearchProvider(config.exaApiKey);
  }

  throw new Error(
    "No web search provider is configured. Set BRAVE_SEARCH_API_KEY or EXA_API_KEY, or choose SPECIALISTS_WEB_SEARCH_PROVIDER explicitly.",
  );
}
