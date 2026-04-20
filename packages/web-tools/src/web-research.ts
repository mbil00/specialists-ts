import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { WebToolsConfig } from "./config.js";
import { loadWebToolsConfig } from "./config.js";
import { parseJsonObject } from "./json.js";
import type {
  WebFreshness,
  WebResearchPack,
  WebResearchRequest,
  WebResearchRunResult,
} from "./types.js";

const DEFAULT_EXTENSION_PATH = resolveDefaultExtensionPath();
const MAX_STDIO_CAPTURE_BYTES = 512 * 1024;
const MAX_ERROR_SUMMARY_CHARS = 4_000;

function resolveDefaultExtensionPath(): string {
  const jsPath = fileURLToPath(new URL("./extension.js", import.meta.url));
  if (existsSync(jsPath)) {
    return jsPath;
  }
  return fileURLToPath(new URL("./extension.ts", import.meta.url));
}

export async function runWebResearch(
  request: WebResearchRequest,
  config: WebToolsConfig = loadWebToolsConfig(),
  signal?: AbortSignal,
): Promise<WebResearchRunResult> {
  const args = buildPiArgs(request, config);
  const rawOutput = await runPiJsonMode(config.webResearchPiCommand, args, config.webResearchTimeoutMs, signal);
  const parsed = parseJsonObject(rawOutput.finalText);
  const pack = parsed ? normalizeResearchPack(parsed, request, rawOutput.finalText) : fallbackResearchPack(request, rawOutput.finalText);
  return {
    pack,
    rawOutput,
    renderedText: renderResearchPack(pack),
  };
}

function buildPiArgs(request: WebResearchRequest, config: WebToolsConfig): string[] {
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-tools",
    "-e",
    config.webResearchExtensionPath || DEFAULT_EXTENSION_PATH,
    "--append-system-prompt",
    buildResearchSystemPrompt(),
  ];

  if (config.webResearchModel) {
    args.push("--model", config.webResearchModel);
  }
  if (config.webResearchThinking) {
    args.push("--thinking", config.webResearchThinking);
  }

  args.push(buildResearchUserPrompt(request));
  return args;
}

function buildResearchSystemPrompt(): string {
  return [
    "You are a dedicated web research subagent.",
    "Your job is to answer the research question using web_search and web_fetch.",
    "You are not the final specialist; your job is to produce a compact, evidence-rich research pack for another agent.",
    "Prefer official documentation, specifications, release notes, maintainer sources, and vendor pages when available.",
    "When the question looks docs- or reference-oriented, bias strongly toward exact documentation pages rather than broad articles.",
    "Use multiple targeted searches when needed: one exact docs/reference query and one broader exploratory query if the first search is weak.",
    "Fetch the most relevant pages and read enough source material to answer directly, not just list links.",
    "If sources disagree, surface the disagreement explicitly.",
    "Return only valid JSON, with no markdown fences and no extra prose.",
    "Required keys: question, direct_answer, summary, findings, recommended_pages, conflicts, uncertainties, citations.",
    "findings must be an array of objects with keys: claim, confidence, evidence_urls, and optional notes, tags.",
    "recommended_pages must be an array of objects with keys: title, url, reason, and optional confidence, notes, tags.",
    "conflicts must be an array of objects with keys: topic, detail, urls, and optional notes, tags.",
    "uncertainties and citations must be arrays of strings.",
    "Citations must be URLs when possible.",
    "Keep the result compact but evidence-rich.",
  ].join("\n");
}

function buildResearchUserPrompt(request: WebResearchRequest): string {
  return [
    `Question: ${request.question}`,
    `Preferred domains: ${request.preferredDomains.join(", ") || "(none specified)"}`,
    `Excluded domains: ${request.excludedDomains.join(", ") || "(none specified)"}`,
    `Freshness requirement: ${request.freshness}`,
    `Maximum search results per search: ${request.maxResults}`,
    `Maximum pages to inspect deeply: ${request.maxPages}`,
    "",
    "Recommended workflow:",
    "1. Start with a focused search optimized for exact docs/reference hits.",
    "2. If results are weak, sparse, or not authoritative enough, run one broader follow-up search.",
    "3. Use web_fetch on the strongest candidate pages, prioritizing official docs and references.",
    "4. Extract a direct answer, note exact pages worth validating, and surface any conflicts or uncertainties.",
    "5. Keep the final result concise and machine-readable JSON only.",
  ].join("\n");
}

async function runPiJsonMode(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ finalText: string; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutCapture = createBoundedCapture(MAX_STDIO_CAPTURE_BYTES);
    const stderrCapture = createBoundedCapture(MAX_STDIO_CAPTURE_BYTES);
    let finalText = "";
    let buffer = "";
    let killedByAbort = false;
    let killedByTimeout = false;

    const processLine = (line: string) => {
      if (!line.trim()) {
        return;
      }
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (event.type === "message_end") {
        const message = event.message as { role?: string; content?: Array<{ type?: string; text?: string }> } | undefined;
        if (message?.role === "assistant") {
          const text = (message.content ?? [])
            .filter((part) => part?.type === "text" && typeof part.text === "string")
            .map((part) => part.text)
            .join("\n")
            .trim();
          if (text) {
            finalText = text;
          }
        }
      }
    };

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdoutCapture.append(chunk);
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
      }
    });

    proc.stderr.on("data", (data) => {
      stderrCapture.append(data.toString());
    });

    const timeout = setTimeout(() => {
      killedByTimeout = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5_000);
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (buffer.trim()) {
        processLine(buffer);
      }
      if (killedByAbort) {
        reject(new Error("web_research subagent was aborted."));
        return;
      }
      if (killedByTimeout) {
        reject(new Error(`web_research subagent timed out after ${timeoutMs}ms.`));
        return;
      }

      const stdout = stdoutCapture.render();
      const stderr = stderrCapture.render();
      if ((code ?? 0) !== 0) {
        const detail = summarizeFailureOutput(stderr || stdout);
        reject(new Error(`web_research subagent failed with exit code ${code ?? 0}.${detail ? ` ${detail}` : ""}`.trim()));
        return;
      }
      resolve({ finalText: finalText || stdout.trim(), stdout, stderr });
    });

    proc.on("error", (error) => {
      reject(error);
    });

    if (signal) {
      const abort = () => {
        killedByAbort = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 5_000);
      };
      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener("abort", abort, { once: true });
      }
    }
  });
}

function createBoundedCapture(limitBytes: number) {
  let captured = "";
  let totalBytes = 0;
  let truncated = false;

  return {
    append(chunk: string) {
      totalBytes += Buffer.byteLength(chunk);
      if (truncated) {
        return;
      }
      if (Buffer.byteLength(captured) + Buffer.byteLength(chunk) <= limitBytes) {
        captured += chunk;
        return;
      }
      const remainingBytes = Math.max(0, limitBytes - Buffer.byteLength(captured));
      if (remainingBytes > 0) {
        captured += Buffer.from(chunk).subarray(0, remainingBytes).toString("utf8");
      }
      truncated = true;
    },
    render(): string {
      if (!truncated) {
        return captured;
      }
      return `${captured}\n\n[truncated after ${limitBytes} bytes; total observed ${totalBytes} bytes]`;
    },
  };
}

function summarizeFailureOutput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length > MAX_ERROR_SUMMARY_CHARS
    ? `${trimmed.slice(0, MAX_ERROR_SUMMARY_CHARS - 3)}...`
    : trimmed;
}

function normalizeResearchPack(
  payload: Record<string, unknown>,
  request: WebResearchRequest,
  rawText: string,
): WebResearchPack {
  const findings = Array.isArray(payload.findings)
    ? payload.findings
        .map((item) => normalizeFinding(item))
        .filter((item): item is WebResearchPack["findings"][number] => item !== null)
    : [];
  const recommendedPages = Array.isArray(payload.recommended_pages)
    ? payload.recommended_pages
        .map((item) => normalizeRecommendedPage(item))
        .filter((item): item is WebResearchPack["recommendedPages"][number] => item !== null)
    : [];
  const conflicts = Array.isArray(payload.conflicts)
    ? payload.conflicts
        .map((item) => normalizeConflict(item))
        .filter((item): item is WebResearchPack["conflicts"][number] => item !== null)
    : [];

  return {
    question: stringValue(payload.question) || request.question,
    directAnswer: stringValue(payload.direct_answer) || stringValue(payload.summary) || rawText,
    summary: stringValue(payload.summary) || stringValue(payload.direct_answer) || rawText,
    findings,
    recommendedPages,
    conflicts,
    uncertainties: stringArray(payload.uncertainties),
    citations: stringArray(payload.citations),
    rawText,
  };
}

function fallbackResearchPack(request: WebResearchRequest, rawText: string): WebResearchPack {
  return {
    question: request.question,
    directAnswer: rawText,
    summary: rawText,
    findings: [],
    recommendedPages: [],
    conflicts: [],
    uncertainties: ["The research subagent did not return structured JSON; validate key claims manually."],
    citations: [],
    rawText,
  };
}

function normalizeFinding(value: unknown): WebResearchPack["findings"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const claim = stringValue(entry.claim);
  if (!claim) {
    return null;
  }
  return {
    claim,
    confidence: normalizeConfidence(entry.confidence),
    evidenceUrls: stringArray(entry.evidence_urls),
    notes: stringValue(entry.notes),
    tags: stringArray(entry.tags),
  };
}

function normalizeRecommendedPage(value: unknown): WebResearchPack["recommendedPages"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const title = stringValue(entry.title);
  const url = stringValue(entry.url);
  if (!title || !url) {
    return null;
  }
  return {
    title,
    url,
    reason: stringValue(entry.reason) || "Potentially relevant page.",
    confidence: normalizeConfidence(entry.confidence),
    notes: stringValue(entry.notes),
    tags: stringArray(entry.tags),
  };
}

function normalizeConflict(value: unknown): WebResearchPack["conflicts"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const topic = stringValue(entry.topic);
  const detail = stringValue(entry.detail);
  if (!topic || !detail) {
    return null;
  }
  return {
    topic,
    detail,
    urls: stringArray(entry.urls),
    notes: stringValue(entry.notes),
    tags: stringArray(entry.tags),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "high") {
      return 0.9;
    }
    if (normalized === "medium") {
      return 0.65;
    }
    if (normalized === "low") {
      return 0.35;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }
  return undefined;
}

function renderResearchPack(pack: WebResearchPack): string {
  const lines = [
    `Research question: ${pack.question}`,
    `Direct answer: ${pack.directAnswer}`,
    "",
    `Summary: ${pack.summary}`,
  ];

  if (pack.findings.length > 0) {
    lines.push("", "Findings:");
    for (const finding of pack.findings) {
      lines.push(`- ${finding.claim}`);
      if (typeof finding.confidence === "number") {
        lines.push(`  Confidence: ${finding.confidence}`);
      }
      if (finding.tags && finding.tags.length > 0) {
        lines.push(`  Tags: ${finding.tags.join(", ")}`);
      }
      if (finding.notes) {
        lines.push(`  Notes: ${finding.notes}`);
      }
      if (finding.evidenceUrls.length > 0) {
        lines.push(`  Evidence URLs: ${finding.evidenceUrls.join(", ")}`);
      }
    }
  }

  if (pack.recommendedPages.length > 0) {
    lines.push("", "Recommended pages:");
    for (const page of pack.recommendedPages) {
      lines.push(`- ${page.title}`);
      lines.push(`  URL: ${page.url}`);
      lines.push(`  Why: ${page.reason}`);
      if (typeof page.confidence === "number") {
        lines.push(`  Confidence: ${page.confidence}`);
      }
      if (page.tags && page.tags.length > 0) {
        lines.push(`  Tags: ${page.tags.join(", ")}`);
      }
      if (page.notes) {
        lines.push(`  Notes: ${page.notes}`);
      }
    }
  }

  if (pack.conflicts.length > 0) {
    lines.push("", "Conflicts:");
    for (const conflict of pack.conflicts) {
      lines.push(`- ${conflict.topic}: ${conflict.detail}`);
      if (conflict.tags && conflict.tags.length > 0) {
        lines.push(`  Tags: ${conflict.tags.join(", ")}`);
      }
      if (conflict.notes) {
        lines.push(`  Notes: ${conflict.notes}`);
      }
      if (conflict.urls.length > 0) {
        lines.push(`  URLs: ${conflict.urls.join(", ")}`);
      }
    }
  }

  if (pack.uncertainties.length > 0) {
    lines.push("", "Uncertainties:");
    for (const item of pack.uncertainties) {
      lines.push(`- ${item}`);
    }
  }

  if (pack.citations.length > 0) {
    lines.push("", "Citations:");
    for (const citation of pack.citations) {
      lines.push(`- ${citation}`);
    }
  }

  return lines.join("\n");
}
