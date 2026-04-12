import type { NormalizedSearchResult, SearchProvider, SearchRequest, SearchResponse } from "../types.js";

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  page_age?: string;
}

interface BravePayload {
  web?: {
    results?: BraveWebResult[];
  };
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = "brave";

  constructor(private readonly apiKey: string) {}

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    const query = buildBraveQuery(request);
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(request.maxResults));
    url.searchParams.set("text_decorations", "false");
    url.searchParams.set("result_filter", "web");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Brave search failed with ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as BravePayload;
    const results: NormalizedSearchResult[] = (payload.web?.results ?? [])
      .map((item) => ({
        title: item.title?.trim() || item.url?.trim() || "Untitled result",
        url: item.url?.trim() || "",
        snippet: item.description?.trim() || "",
        publishedAt: item.page_age?.trim() || undefined,
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

function buildBraveQuery(request: SearchRequest): string {
  const queryParts = [request.query.trim()];
  for (const domain of request.preferredDomains) {
    queryParts.push(`site:${domain}`);
  }
  for (const domain of request.excludedDomains) {
    queryParts.push(`-site:${domain}`);
  }
  const freshnessHint = freshnessPhrase(request.freshness);
  if (freshnessHint) {
    queryParts.push(freshnessHint);
  }
  return queryParts.filter(Boolean).join(" ");
}

function freshnessPhrase(freshness: SearchRequest["freshness"]): string {
  switch (freshness) {
    case "day":
      return "updated within the last day";
    case "week":
      return "updated within the last week";
    case "month":
      return "updated within the last month";
    case "year":
      return "updated within the last year";
    default:
      return "";
  }
}
