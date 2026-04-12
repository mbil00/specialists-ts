import type { SearchProvider, SearchRequest, SearchResponse } from "../types.js";

export class FallbackSearchProvider implements SearchProvider {
  readonly name: string;

  constructor(
    private readonly primary: SearchProvider,
    private readonly fallback: SearchProvider,
  ) {
    this.name = `${primary.name}->${fallback.name}`;
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    try {
      const primaryResponse = await this.primary.search(request, signal);
      if (shouldFallback(primaryResponse)) {
        const fallbackResponse = await this.fallback.search(request, signal);
        return {
          ...fallbackResponse,
          provider: `${fallbackResponse.provider} (fallback after ${this.primary.name})`,
        };
      }
      return primaryResponse;
    } catch {
      const fallbackResponse = await this.fallback.search(request, signal);
      return {
        ...fallbackResponse,
        provider: `${fallbackResponse.provider} (fallback after ${this.primary.name} error)`,
      };
    }
  }
}

function shouldFallback(response: SearchResponse): boolean {
  if (response.results.length === 0) {
    return true;
  }
  if (response.results.length < 2) {
    return true;
  }
  const topResult = response.results[0];
  if (!topResult?.snippet?.trim()) {
    return true;
  }
  const distinctHosts = new Set(
    response.results
      .map((result) => {
        try {
          return new URL(result.url).hostname;
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
  if (distinctHosts.size === 0) {
    return true;
  }
  return false;
}
