import { loadDotEnvFromAncestors } from "@specialists/shared";

import { createSearchProvider } from "./search-provider.js";
import { loadWebToolsConfig } from "./config.js";
import { fetchWebPage } from "./web-fetch.js";
import { runWebResearch } from "./web-research.js";
import type { WebFreshness } from "./types.js";

async function main(): Promise<void> {
  loadDotEnvFromAncestors();
  const args = parseArgs(process.argv.slice(2));
  const config = loadWebToolsConfig();

  console.log("# web-tools smoke test");
  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        searchProvider: config.searchProvider,
        hasExaKey: Boolean(config.exaApiKey),
        hasBraveKey: Boolean(config.braveApiKey),
        webResearchPiCommand: config.webResearchPiCommand,
        webResearchModel: config.webResearchModel ?? null,
        webResearchThinking: config.webResearchThinking ?? null,
      },
      null,
      2,
    ),
  );

  if (args.mode === "search" || args.mode === "all") {
    console.log("\n## search\n");
    const provider = createSearchProvider(config);
    const response = await provider.search({
      query: args.searchQuery,
      maxResults: args.maxResults,
      preferredDomains: args.preferredDomains,
      excludedDomains: args.excludedDomains,
      freshness: args.freshness,
    });
    console.log(JSON.stringify(response, null, 2));
  }

  if (args.mode === "fetch" || args.mode === "all") {
    console.log("\n## fetch\n");
    const fetched = await fetchWebPage(
      {
        url: args.fetchUrl,
        maxCharacters: args.fetchMaxCharacters,
      },
      config,
    );
    console.log(
      JSON.stringify(
        {
          page: fetched.page,
          truncation: fetched.truncation ?? null,
          preview: fetched.renderedText.slice(0, 4000),
        },
        null,
        2,
      ),
    );
  }

  if (args.mode === "research" || args.mode === "all") {
    console.log("\n## research\n");
    const research = await runWebResearch(
      {
        question: args.researchQuestion,
        maxResults: args.maxResults,
        maxPages: args.maxPages,
        preferredDomains: args.preferredDomains,
        excludedDomains: args.excludedDomains,
        freshness: args.freshness,
      },
      config,
    );
    console.log(
      JSON.stringify(
        {
          pack: research.pack,
          renderedTextPreview: research.renderedText.slice(0, 4000),
          rawOutputPreview: {
            finalText: research.rawOutput.finalText.slice(0, 4000),
            stderr: research.rawOutput.stderr.slice(0, 2000),
          },
        },
        null,
        2,
      ),
    );
  }
}

interface ParsedArgs {
  mode: "search" | "fetch" | "research" | "all";
  searchQuery: string;
  fetchUrl: string;
  researchQuestion: string;
  preferredDomains: string[];
  excludedDomains: string[];
  freshness: WebFreshness;
  maxResults: number;
  maxPages: number;
  fetchMaxCharacters: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, ["true"]);
      continue;
    }
    index += 1;
    const entries = values.get(key) ?? [];
    entries.push(next);
    values.set(key, entries);
  }

  const mode = oneOf(values.get("mode")?.at(-1), ["search", "fetch", "research", "all"] as const) ?? "all";
  const preferredDomains = list(values, "preferred-domain", "preferred-domains");
  const excludedDomains = list(values, "excluded-domain", "excluded-domains");

  return {
    mode,
    searchQuery:
      values.get("search-query")?.at(-1) ??
      "latest official guidance for pi coding agent custom tools",
    fetchUrl:
      values.get("fetch-url")?.at(-1) ??
      "https://pi.dev",
    researchQuestion:
      values.get("research-question")?.at(-1) ??
      "What are the most important current docs and implementation details for Pi custom tools and SDK usage?",
    preferredDomains,
    excludedDomains,
    freshness: oneOf(values.get("freshness")?.at(-1), ["any", "day", "week", "month", "year"] as const) ?? "month",
    maxResults: positiveInt(values.get("max-results")?.at(-1), 5),
    maxPages: positiveInt(values.get("max-pages")?.at(-1), 4),
    fetchMaxCharacters: positiveInt(values.get("fetch-max-characters")?.at(-1), 8000),
  };
}

function list(values: Map<string, string[]>, singularKey: string, pluralKey: string): string[] {
  const entries = [...(values.get(singularKey) ?? []), ...(values.get(pluralKey) ?? [])]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(entries));
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function oneOf<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
): T[number] | undefined {
  if (!value) {
    return undefined;
  }
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

main().catch((error) => {
  console.error("\nweb-tools smoke test failed:\n");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
