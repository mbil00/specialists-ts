import { Readability } from "@mozilla/readability";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationResult,
} from "@mariozechner/pi-coding-agent";
import { JSDOM, VirtualConsole } from "jsdom";

import { loadWebToolsConfig, type WebToolsConfig } from "./config.js";
import type { FetchRequest, FetchedPage } from "./types.js";

export interface FetchToolResult {
  page: FetchedPage;
  renderedText: string;
  truncation?: TruncationResult;
}

export async function fetchWebPage(
  request: FetchRequest,
  config: WebToolsConfig = loadWebToolsConfig(),
  signal?: AbortSignal,
): Promise<FetchToolResult> {
  const url = normalizeUrl(request.url);
  const response = await fetchWithTimeout(url, config, signal);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "unknown";
  const fetchedAt = new Date().toISOString();
  const finalUrl = response.url || url;

  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status} ${response.statusText} for ${finalUrl}`);
  }

  const rawBody = await response.text();
  const page = extractPage({
    requestedUrl: url,
    finalUrl,
    contentType,
    status: response.status,
    fetchedAt,
    rawBody,
  });

  const rendered = renderFetchedPage(page, request.maxCharacters);
  return rendered;
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("URL is required.");
  }
  try {
    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      throw new Error(`Invalid URL: ${input}`);
    }
  }
}

async function fetchWithTimeout(url: string, config: WebToolsConfig, signal?: AbortSignal): Promise<Response> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), config.fetchTimeoutMs);
  const combinedSignal = anySignal([timeoutController.signal, signal]);

  try {
    return await fetch(url, {
      headers: {
        "user-agent": config.fetchUserAgent,
        accept: "text/html,application/xhtml+xml,application/json,text/plain,text/markdown,text/xml,*/*;q=0.8",
      },
      redirect: "follow",
      signal: combinedSignal,
    });
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error(`Fetch timed out after ${config.fetchTimeoutMs}ms for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractPage(args: {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  status: number;
  fetchedAt: string;
  rawBody: string;
}): FetchedPage {
  const { requestedUrl, finalUrl, contentType, status, fetchedAt, rawBody } = args;

  if (contentType.includes("html") || contentType.includes("xml") || contentType === "unknown") {
    const fromHtml = extractFromHtml(rawBody, finalUrl);
    return {
      requestedUrl,
      finalUrl,
      title: fromHtml.title,
      byline: fromHtml.byline,
      excerpt: fromHtml.excerpt,
      content: fromHtml.content,
      textContentLength: fromHtml.content.length,
      contentType,
      status,
      fetchedAt,
    };
  }

  const textContent = normalizeWhitespace(rawBody);
  return {
    requestedUrl,
    finalUrl,
    title: finalUrl,
    excerpt: textContent.slice(0, 280) || undefined,
    content: textContent,
    textContentLength: textContent.length,
    contentType,
    status,
    fetchedAt,
  };
}

function extractFromHtml(html: string, url: string): {
  title: string;
  byline?: string;
  excerpt?: string;
  content: string;
} {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", () => {
    // ignore noisy stylesheet/parser errors from third-party pages
  });
  virtualConsole.on("jsdomError", () => {
    // ignore noisy stylesheet/parser errors from third-party pages
  });
  const dom = new JSDOM(html, { url, virtualConsole });
  const doc = dom.window.document;
  const article = new Readability(doc).parse();
  if (article?.textContent?.trim()) {
    const content = normalizeWhitespace(article.textContent);
    return {
      title: article.title?.trim() || doc.title?.trim() || url,
      byline: article.byline?.trim() || undefined,
      excerpt: article.excerpt?.trim() || undefined,
      content,
    };
  }

  const title = doc.title?.trim() || url;
  const bodyText = normalizeWhitespace(doc.body?.textContent || "");
  return {
    title,
    excerpt: bodyText.slice(0, 280) || undefined,
    content: bodyText,
  };
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function renderFetchedPage(page: FetchedPage, maxCharacters: number): FetchToolResult {
  const contentText = page.content.slice(0, Math.max(1_000, maxCharacters));
  const base = [
    `Requested URL: ${page.requestedUrl}`,
    `Final URL: ${page.finalUrl}`,
    `Title: ${page.title}`,
    `Fetched at: ${page.fetchedAt}`,
    `HTTP status: ${page.status}`,
    `Content-Type: ${page.contentType}`,
    ...(page.byline ? [`Byline: ${page.byline}`] : []),
    ...(page.excerpt ? [`Excerpt: ${page.excerpt}`] : []),
    "",
    "Content:",
    contentText,
  ].join("\n");

  const truncation = truncateHead(base, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let renderedText = truncation.content;
  if (truncation.truncated) {
    renderedText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(
      truncation.outputBytes,
    )} of ${formatSize(truncation.totalBytes)}).]`;
  }

  return {
    page,
    renderedText,
    truncation: truncation.truncated ? truncation : undefined,
  };
}

function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const liveSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (liveSignals.length === 0) {
    return undefined;
  }
  if (liveSignals.length === 1) {
    return liveSignals[0];
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of liveSignals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}
