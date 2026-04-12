import type { NormalizedSearchResult, SearchProvider, SearchRequest, SearchResponse } from "../types.js";

interface TavilySearchItem {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

interface TavilySearchPayload {
  results?: TavilySearchItem[];
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";

  constructor(private readonly apiKey: string) {}

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        query: request.query,
        max_results: request.maxResults,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
        include_domains: request.preferredDomains,
        exclude_domains: request.excludedDomains,
        topic: "general",
        days: tavilyDays(request.freshness),
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Tavily search failed with ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as TavilySearchPayload;
    const results: NormalizedSearchResult[] = (payload.results ?? [])
      .map((item) => ({
        title: item.title?.trim() || item.url?.trim() || "Untitled result",
        url: item.url?.trim() || "",
        snippet: item.content?.trim() || "",
        score: typeof item.score === "number" ? item.score : undefined,
        publishedAt: item.published_date?.trim() || undefined,
        source: this.name,
      }))
      .filter((item) => item.url);

    return {
      provider: this.name,
      query: request.query,
      results,
      fetchedAt: new Date().toISOString(),
    };
  }
}

function tavilyDays(freshness: SearchRequest["freshness"]): number | undefined {
  switch (freshness) {
    case "day":
      return 1;
    case "week":
      return 7;
    case "month":
      return 30;
    case "year":
      return 365;
    default:
      return undefined;
  }
}
