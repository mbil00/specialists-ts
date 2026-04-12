import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { StringEnum, Type } from "@mariozechner/pi-ai";

import { loadWebToolsConfig } from "./config.js";
import { createSearchProvider } from "./search-provider.js";
import type { FetchRequest, SearchRequest, WebFreshness } from "./types.js";
import { fetchWebPage } from "./web-fetch.js";
import { runWebResearch } from "./web-research.js";

const WebFreshnessEnum = StringEnum(["any", "day", "week", "month", "year"] as const);

const webSearchTool = defineTool({
  name: "web_search",
  label: "Web Search",
  description:
    "Search the web for current information, official documentation, release notes, and external references. Returns URLs and snippets.",
  promptSnippet: "Search the web for current docs, release notes, and authoritative references with URL results",
  promptGuidelines: [
    "Use web_search when current or external information is required.",
    "Prefer targeted official documentation searches when the topic is framework, API, or tool specific.",
    "After web_search, use web_fetch to inspect the most relevant URLs in detail before relying on them.",
  ],
  parameters: Type.Object({
    query: Type.String({ description: "Search query to run on the public web." }),
    maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 10, description: "Maximum number of results to return. Default is provider-configured, usually 5." })),
    preferredDomains: Type.Optional(Type.Array(Type.String({ description: "Preferred domain such as docs.example.com" }), { description: "Prefer these domains when searching." })),
    excludedDomains: Type.Optional(Type.Array(Type.String({ description: "Domain to exclude such as reddit.com" }), { description: "Exclude these domains from search results." })),
    freshness: Type.Optional(WebFreshnessEnum),
  }),
  async execute(_toolCallId, rawParams, signal, onUpdate) {
    const config = loadWebToolsConfig();
    const params = normalizeSearchRequest(rawParams as {
      query: string;
      maxResults?: number;
      preferredDomains?: string[];
      excludedDomains?: string[];
      freshness?: WebFreshness;
    }, config.defaultMaxResults);

    onUpdate?.({
      content: [{ type: "text", text: `Searching the web for: ${params.query}` }],
      details: { phase: "search", query: params.query },
    });

    const provider = createSearchProvider(config);
    const response = await provider.search(params, signal);
    const lines = [
      `Search provider: ${response.provider}`,
      `Query: ${response.query}`,
      `Fetched at: ${response.fetchedAt}`,
      `Result count: ${response.results.length}`,
      ...response.results.flatMap((result, index) => [
        "",
        `Result ${index + 1}:`,
        `Title: ${result.title}`,
        `URL: ${result.url}`,
        ...(result.publishedAt ? [`Published: ${result.publishedAt}`] : []),
        ...(typeof result.score === "number" ? [`Score: ${result.score}`] : []),
        `Snippet: ${result.snippet || "(no snippet provided)"}`,
      ]),
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: {
        provider: response.provider,
        query: response.query,
        fetchedAt: response.fetchedAt,
        results: response.results,
      },
    };
  },
});

const webResearchTool = defineTool({
  name: "web_research",
  label: "Web Research",
  description:
    "Delegate multi-page web research to a focused subagent that searches, reads relevant pages, and returns a compact research pack with citations and pages worth validating.",
  promptSnippet:
    "Run a dedicated web research subagent that searches broadly, reads relevant pages, and returns a compact answer with citations",
  promptGuidelines: [
    "Use web_research when the question needs fresh external knowledge and likely requires reading multiple pages.",
    "Use web_research before doing manual page-by-page external research yourself.",
    "Use web_fetch afterwards only when you need to validate a critical page or ambiguous claim directly.",
  ],
  parameters: Type.Object({
    question: Type.String({ description: "Research question to answer from the web." }),
    maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 10, description: "Maximum search results to consider per search step. Default is provider-configured, usually 5." })),
    maxPages: Type.Optional(Type.Number({ minimum: 1, maximum: 8, description: "Maximum number of pages to inspect deeply. Default is 4." })),
    preferredDomains: Type.Optional(Type.Array(Type.String({ description: "Preferred domain such as docs.example.com" }))),
    excludedDomains: Type.Optional(Type.Array(Type.String({ description: "Domain to exclude such as reddit.com" }))),
    freshness: Type.Optional(WebFreshnessEnum),
  }),
  async execute(_toolCallId, rawParams, signal, onUpdate) {
    const config = loadWebToolsConfig();
    const params = normalizeResearchRequest(rawParams as {
      question: string;
      maxResults?: number;
      maxPages?: number;
      preferredDomains?: string[];
      excludedDomains?: string[];
      freshness?: WebFreshness;
    }, config.defaultMaxResults, config.defaultResearchMaxPages);

    onUpdate?.({
      content: [{ type: "text", text: `Delegating web research: ${params.question}` }],
      details: { phase: "research", question: params.question },
    });

    const research = await runWebResearch(params, config, signal);
    return {
      content: [{ type: "text", text: research.renderedText }],
      details: {
        pack: research.pack,
        rawOutput: research.rawOutput,
      },
    };
  },
});

const webFetchTool = defineTool({
  name: "web_fetch",
  label: "Web Fetch",
  description:
    "Fetch a URL and extract readable content with metadata. Use after web_search to inspect an external page in detail.",
  promptSnippet: "Fetch and extract readable content from a URL, preserving metadata and timestamps",
  promptGuidelines: [
    "Use web_fetch after identifying a relevant URL, especially from web_search results.",
    "Prefer official docs, specs, and release notes over third-party commentary when both are available.",
    "Cite the fetched URL directly when using information from web_fetch.",
  ],
  parameters: Type.Object({
    url: Type.String({ description: "HTTP or HTTPS URL to fetch." }),
    maxCharacters: Type.Optional(Type.Number({ minimum: 1000, maximum: 50000, description: "Maximum number of extracted content characters to include before output truncation. Default 16000." })),
  }),
  async execute(_toolCallId, rawParams, signal, onUpdate) {
    const params = normalizeFetchRequest(rawParams as { url: string; maxCharacters?: number });

    onUpdate?.({
      content: [{ type: "text", text: `Fetching: ${params.url}` }],
      details: { phase: "fetch", url: params.url },
    });

    const fetched = await fetchWebPage(params, loadWebToolsConfig(), signal);
    return {
      content: [{ type: "text", text: fetched.renderedText }],
      details: {
        page: {
          requestedUrl: fetched.page.requestedUrl,
          finalUrl: fetched.page.finalUrl,
          title: fetched.page.title,
          byline: fetched.page.byline,
          excerpt: fetched.page.excerpt,
          textContentLength: fetched.page.textContentLength,
          contentType: fetched.page.contentType,
          status: fetched.page.status,
          fetchedAt: fetched.page.fetchedAt,
        },
        truncation: fetched.truncation,
      },
    };
  },
});

export default function webToolsExtension(pi: ExtensionAPI) {
  pi.registerTool(webSearchTool);
  pi.registerTool(webResearchTool);
  pi.registerTool(webFetchTool);
}

function normalizeSearchRequest(
  params: {
    query: string;
    maxResults?: number;
    preferredDomains?: string[];
    excludedDomains?: string[];
    freshness?: WebFreshness;
  },
  defaultMaxResults: number,
): SearchRequest {
  const query = params.query?.trim();
  if (!query) {
    throw new Error("web_search requires a non-empty query.");
  }
  return {
    query,
    maxResults: normalizeBoundedInt(params.maxResults, defaultMaxResults, 1, 10),
    preferredDomains: normalizeDomains(params.preferredDomains),
    excludedDomains: normalizeDomains(params.excludedDomains),
    freshness: normalizeFreshness(params.freshness),
  };
}

function normalizeResearchRequest(
  params: {
    question: string;
    maxResults?: number;
    maxPages?: number;
    preferredDomains?: string[];
    excludedDomains?: string[];
    freshness?: WebFreshness;
  },
  defaultMaxResults: number,
  defaultMaxPages: number,
) {
  const question = params.question?.trim();
  if (!question) {
    throw new Error("web_research requires a non-empty question.");
  }
  return {
    question,
    maxResults: normalizeBoundedInt(params.maxResults, defaultMaxResults, 1, 10),
    maxPages: normalizeBoundedInt(params.maxPages, defaultMaxPages, 1, 8),
    preferredDomains: normalizeDomains(params.preferredDomains),
    excludedDomains: normalizeDomains(params.excludedDomains),
    freshness: normalizeFreshness(params.freshness),
  };
}

function normalizeFetchRequest(params: { url: string; maxCharacters?: number }): FetchRequest {
  const url = params.url?.trim();
  if (!url) {
    throw new Error("web_fetch requires a URL.");
  }
  return {
    url,
    maxCharacters: normalizeBoundedInt(params.maxCharacters, 16_000, 1_000, 50_000),
  };
}

function normalizeDomains(domains: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (domains ?? [])
        .map((domain) => domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""))
        .filter(Boolean),
    ),
  );
}

function normalizeFreshness(freshness: WebFreshness | undefined): WebFreshness {
  return freshness ?? "any";
}

function normalizeBoundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}
