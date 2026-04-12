export type WebFreshness = "any" | "day" | "week" | "month" | "year";

export interface NormalizedSearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  publishedAt?: string;
  source?: string;
}

export interface SearchResponse {
  provider: string;
  query: string;
  results: NormalizedSearchResult[];
  fetchedAt: string;
}

export interface SearchRequest {
  query: string;
  maxResults: number;
  preferredDomains: string[];
  excludedDomains: string[];
  freshness: WebFreshness;
}

export interface FetchRequest {
  url: string;
  maxCharacters: number;
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  byline?: string;
  excerpt?: string;
  content: string;
  textContentLength: number;
  contentType: string;
  status: number;
  fetchedAt: string;
}

export interface SearchProvider {
  readonly name: string;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse>;
}

export interface WebResearchRequest {
  question: string;
  maxResults: number;
  maxPages: number;
  preferredDomains: string[];
  excludedDomains: string[];
  freshness: WebFreshness;
}

export interface WebResearchPack {
  question: string;
  directAnswer: string;
  summary: string;
  findings: Array<{
    claim: string;
    confidence?: number;
    evidenceUrls: string[];
    notes?: string;
    tags?: string[];
  }>;
  recommendedPages: Array<{
    title: string;
    url: string;
    reason: string;
    confidence?: number;
    notes?: string;
    tags?: string[];
  }>;
  conflicts: Array<{
    topic: string;
    detail: string;
    urls: string[];
    notes?: string;
    tags?: string[];
  }>;
  uncertainties: string[];
  citations: string[];
  rawText: string;
}

export interface WebResearchRunResult {
  pack: WebResearchPack;
  renderedText: string;
  rawOutput: {
    finalText: string;
    stdout: string;
    stderr: string;
  };
}
