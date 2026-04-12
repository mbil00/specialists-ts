import type { NormalizedSearchResult, SearchProvider, SearchRequest, SearchResponse } from "../types.js";

interface ExaSearchResult {
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  publishedDate?: string;
}

interface ExaSearchPayload {
  results?: ExaSearchResult[];
}

export class ExaSearchProvider implements SearchProvider {
  readonly name = "exa";

  constructor(private readonly apiKey: string) {}

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        query: buildExaQuery(request),
        numResults: request.maxResults,
        type: "auto",
        useAutoprompt: true,
        includeDomains: request.preferredDomains,
        excludeDomains: request.excludedDomains,
        startPublishedDate: exaStartPublishedDate(request.freshness),
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Exa search failed with ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as ExaSearchPayload;
    const results: NormalizedSearchResult[] = (payload.results ?? [])
      .map((item) => ({
        title: item.title?.trim() || item.url?.trim() || "Untitled result",
        url: item.url?.trim() || "",
        snippet: item.text?.trim() || "",
        score: typeof item.score === "number" ? item.score : undefined,
        publishedAt: item.publishedDate?.trim() || undefined,
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

function buildExaQuery(request: SearchRequest): string {
  const parts = [request.query.trim()];
  const freshnessHint = freshnessPhrase(request.freshness);
  if (freshnessHint) {
    parts.push(freshnessHint);
  }
  return parts.filter(Boolean).join(" ");
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

function exaStartPublishedDate(freshness: SearchRequest["freshness"]): string | undefined {
  const now = new Date();
  switch (freshness) {
    case "day":
      now.setUTCDate(now.getUTCDate() - 1);
      break;
    case "week":
      now.setUTCDate(now.getUTCDate() - 7);
      break;
    case "month":
      now.setUTCMonth(now.getUTCMonth() - 1);
      break;
    case "year":
      now.setUTCFullYear(now.getUTCFullYear() - 1);
      break;
    default:
      return undefined;
  }
  return now.toISOString();
}
