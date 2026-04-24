import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type {
  SpecialistExecutionRequest,
  SpecialistExecutionResult,
  ToolActivityRecord,
} from "@specialists/shared";
import webToolsExtension from "@specialists/web-tools";

import {
  createDefaultPiRunnerConfig,
  type PiRunnerConfig,
} from "./config.js";
import { classifyToolKind } from "./normalize.js";
import { buildSpecialistSystemPrompt, buildSpecialistUserPrompt } from "./prompt.js";
import { resolveActiveToolNames } from "./tools.js";

export async function runWithPiSdk(
  request: SpecialistExecutionRequest,
  config: PiRunnerConfig = createDefaultPiRunnerConfig(),
): Promise<SpecialistExecutionResult> {
  const cwd = request.workspaceRoot;
  const activeTools = resolveActiveToolNames(request, config);
  const builtInTools = createBuiltInTools(cwd, activeTools);

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const candidateModels = await resolveCandidateModels(modelRegistry, config);
  if (candidateModels.length === 0) {
    throw new Error("No available Pi model was found. Configure provider auth for pi before running specialists.");
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [webToolsExtension],
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    appendSystemPromptOverride: () => [],
    systemPromptOverride: () => buildSpecialistSystemPrompt(request),
  });
  await resourceLoader.reload();

  let lastError: string | undefined;

  for (const model of candidateModels) {
    const { session } = await createAgentSession({
      cwd,
      agentDir: getAgentDir(),
      model,
      thinkingLevel: config.thinkingLevel ?? "medium",
      authStorage,
      modelRegistry,
      resourceLoader,
      tools: builtInTools,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });

    const toolActivity = new Map<string, InternalToolRecord>();
    let rawText = "";

    const unsubscribe = session.subscribe((event) => {
      handleSessionEvent(event, toolActivity, (delta) => {
        rawText += delta;
      });
    });

    try {
      await session.prompt(buildSpecialistUserPrompt(request));
      const assistantError = extractAssistantError(session.messages);
      if (assistantError) {
        lastError = `Model ${model.provider}/${model.id} failed: ${assistantError}`;
        continue;
      }
      const answer = extractAssistantText(session.messages) || rawText.trim();
      const normalizedToolActivity = Array.from(toolActivity.values()).map(finalizeToolRecord);
      const citations = finalizeCitations([
        ...extractAnswerCitations(answer),
        ...normalizedToolActivity.flatMap(selectHighSignalCitations),
      ]);

      return {
        answer,
        provider: `pi:${model.provider}`,
        model: model.id,
        rawText: rawText.trim() || answer,
        citations,
        followUpQuestions: [],
        authoredFiles: dedupe(normalizedToolActivity.flatMap((item) => item.touchedFiles)),
        toolActivity: normalizedToolActivity,
      };
    } finally {
      unsubscribe();
      session.dispose();
    }
  }

  throw new Error(lastError ?? "Pi SDK execution failed with all candidate models.");
}

type InternalToolRecord = ToolActivityRecord & {
  toolCallId: string;
};

type AvailableModel = Awaited<ReturnType<ModelRegistry["getAvailable"]>>[number];

async function resolveCandidateModels(
  modelRegistry: ModelRegistry,
  config: PiRunnerConfig,
): Promise<AvailableModel[]> {
  let available = await modelRegistry.getAvailable();
  if (config.provider && config.model) {
    return available.filter((model) => model.provider === config.provider && model.id === config.model);
  }
  if (config.provider) {
    available = available.filter((model) => model.provider === config.provider);
  }
  if (config.model) {
    available = available.filter((model) => model.id === config.model || `${model.provider}/${model.id}` === config.model);
  }
  return available.sort(compareModels);
}

function compareModels(left: AvailableModel, right: AvailableModel): number {
  return scoreModel(right) - scoreModel(left);
}

function scoreModel(model: AvailableModel): number {
  let score = 0;
  const id = model.id.toLowerCase();
  if (id.includes("latest")) score += 50;
  if (id.includes("sonnet-4") || id.includes("haiku-4") || id.includes("opus-4")) score += 40;
  if (id.includes("gpt-5") || id.includes("gpt-4.1")) score += 35;
  if (id.includes("4-5") || id.includes("4-6")) score += 20;
  if (id.includes("3-5-haiku-20241022")) score -= 100;
  if (id.includes("deprecated")) score -= 100;
  return score;
}

function createBuiltInTools(cwd: string, activeTools: string[]) {
  const selected = new Set(activeTools);
  const tools = [];
  if (selected.has("read")) tools.push(createReadTool(cwd));
  if (selected.has("bash")) tools.push(createBashTool(cwd));
  if (selected.has("edit")) tools.push(createEditTool(cwd));
  if (selected.has("write")) tools.push(createWriteTool(cwd));
  if (selected.has("grep")) tools.push(createGrepTool(cwd));
  if (selected.has("find")) tools.push(createFindTool(cwd));
  if (selected.has("ls")) tools.push(createLsTool(cwd));
  return tools;
}

function handleSessionEvent(
  event: AgentSessionEvent,
  toolActivity: Map<string, InternalToolRecord>,
  onTextDelta: (delta: string) => void,
): void {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    onTextDelta(event.assistantMessageEvent.delta);
    return;
  }

  if (event.type === "tool_execution_start") {
    toolActivity.set(event.toolCallId, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      toolKind: classifyToolKind(event.toolName),
      success: false,
      startedAt: new Date().toISOString(),
      inputSummary: summarize(event.args),
      touchedFiles: extractTouchedFiles(event.toolName, event.args),
      visitedUrls: extractVisitedUrls(event.toolName, event.args, undefined),
      citations: [],
    });
    return;
  }

  if (event.type === "tool_execution_end") {
    const existing = toolActivity.get(event.toolCallId);
    const merged: InternalToolRecord = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      toolKind: classifyToolKind(event.toolName),
      success: !event.isError,
      startedAt: existing?.startedAt,
      endedAt: new Date().toISOString(),
      inputSummary: existing?.inputSummary,
      outputSummary: summarize(event.result),
      touchedFiles: dedupe(existing?.touchedFiles ?? []),
      visitedUrls: dedupe([
        ...(existing?.visitedUrls ?? []),
        ...extractVisitedUrls(event.toolName, undefined, event.result),
      ]),
      citations: extractCitations(
        event.toolName,
        event.result,
        existing?.touchedFiles ?? [],
        dedupe([
          ...(existing?.visitedUrls ?? []),
          ...extractVisitedUrls(event.toolName, undefined, event.result),
        ]),
      ),
    };
    toolActivity.set(event.toolCallId, merged);
  }
}

function finalizeToolRecord(record: InternalToolRecord): ToolActivityRecord {
  const { toolCallId: _toolCallId, ...rest } = record;
  return rest;
}

function summarize(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 600 ? `${text.slice(0, 597)}...` : text;
  } catch {
    return String(value);
  }
}

function extractTouchedFiles(toolName: string, args: unknown): string[] {
  if (!args || typeof args !== "object") {
    return [];
  }
  const input = args as Record<string, unknown>;
  if (toolName === "write" || toolName === "edit" || toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls") {
    const path = typeof input.path === "string" ? input.path : typeof input.file_path === "string" ? input.file_path : undefined;
    return path ? [path] : [];
  }
  return [];
}

function extractVisitedUrls(toolName: string, args: unknown, result: unknown): string[] {
  const urls = new Set<string>();
  if (toolName === "web_fetch") {
    if (args && typeof args === "object") {
      const url = (args as Record<string, unknown>).url;
      if (typeof url === "string") {
        const cleaned = sanitizeUrl(url);
        if (cleaned) urls.add(cleaned);
      }
    }
    for (const url of extractFetchedPageUrls(result)) {
      urls.add(url);
    }
    return Array.from(urls);
  }
  for (const url of collectUrls(result)) {
    urls.add(url);
  }
  return Array.from(urls);
}

function extractCitations(toolName: string, result: unknown, touchedFiles: string[], visitedUrls: string[]): string[] {
  const urls = collectUrls(result);
  const touchedFileCitations = dedupe(
    touchedFiles.map(normalizeRepoCitation).filter((value): value is string => Boolean(value)),
  );
  const discoveredFileCitations = dedupe(collectRepoCitations(result));

  if (toolName === "web_research") {
    return dedupe([...visitedUrls, ...urls, ...touchedFileCitations, ...discoveredFileCitations]);
  }
  if (toolName === "web_fetch") {
    return dedupe(visitedUrls.slice(0, 20));
  }
  if (toolName === "read" || toolName === "edit" || toolName === "write") {
    return touchedFileCitations.slice(0, 20);
  }
  if (toolName === "grep" || toolName === "find" || toolName === "ls") {
    return dedupe([...touchedFileCitations, ...discoveredFileCitations]).slice(0, 20);
  }
  if (toolName === "bash") {
    return discoveredFileCitations.slice(0, 20);
  }
  return dedupe(urls.slice(0, 20));
}

function extractAssistantError(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = (message as { role?: string }).role;
    if (role !== "assistant") {
      continue;
    }
    const errorMessage = (message as { errorMessage?: string }).errorMessage;
    if (typeof errorMessage === "string" && errorMessage.trim()) {
      return errorMessage.trim();
    }
  }
  return undefined;
}

function extractAssistantText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = (message as { role?: string }).role;
    if (role !== "assistant") {
      continue;
    }
    const content = (message as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function extractAnswerCitations(text: string): string[] {
  return dedupe([...extractUrls(text), ...extractRepoCitations(text)]);
}

function extractUrls(text: string): string[] {
  return dedupe(
    Array.from(text.matchAll(/https?:\/\/[^\s"'`<>\\]+/g))
      .map((match) => sanitizeUrl(match[0]))
      .filter((value): value is string => Boolean(value)),
  );
}

function collectUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const url of extractUrls(node)) {
        urls.add(url);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node && typeof node === "object") {
      for (const child of Object.values(node)) visit(child);
    }
  };
  visit(value);
  return Array.from(urls);
}

function collectRepoCitations(value: unknown): string[] {
  const citations = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const citation of extractRepoCitations(node)) {
        citations.add(citation);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node && typeof node === "object") {
      for (const child of Object.values(node)) visit(child);
    }
  };
  visit(value);
  return Array.from(citations);
}

function extractFetchedPageUrls(value: unknown): string[] {
  const urls = new Set<string>();
  if (!value || typeof value !== "object") {
    return [];
  }

  const root = value as Record<string, unknown>;
  const details = root.details;
  if (details && typeof details === "object") {
    const page = (details as Record<string, unknown>).page;
    if (page && typeof page === "object") {
      const record = page as Record<string, unknown>;
      for (const key of ["requestedUrl", "finalUrl"]) {
        const candidate = record[key];
        if (typeof candidate === "string") {
          const cleaned = sanitizeUrl(candidate);
          if (cleaned) {
            urls.add(cleaned);
          }
        }
      }
    }
  }

  const page = root.page;
  if (page && typeof page === "object") {
    const record = page as Record<string, unknown>;
    for (const key of ["requestedUrl", "finalUrl"]) {
      const candidate = record[key];
      if (typeof candidate === "string") {
        const cleaned = sanitizeUrl(candidate);
        if (cleaned) {
          urls.add(cleaned);
        }
      }
    }
  }

  return Array.from(urls);
}

function extractRepoCitations(text: string): string[] {
  const citations = new Set<string>();

  for (const match of text.matchAll(/file:([^\s"'`<>\]\[(){}:,;]+)/g)) {
    const candidate = match[1];
    if (!candidate) {
      continue;
    }
    const normalized = normalizeRepoCitation(candidate);
    if (normalized) {
      citations.add(normalized);
    }
  }

  for (const match of text.matchAll(/(?:^|[\s("'`])((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|toml|ya?ml|py|sh|sql))(?:$|[\s)"'`:,.;\]])/g)) {
    const candidate = match[1];
    if (!candidate) {
      continue;
    }
    const normalized = normalizeRepoCitation(candidate);
    if (normalized) {
      citations.add(normalized);
    }
  }

  return Array.from(citations);
}

function sanitizeUrl(value: string): string | undefined {
  const trimmed = value.trim().replace(/^[\[<("'`]+|[\])>"'`.,;:]+$/g, "");
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (!url.hostname.includes(".")) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeRepoCitation(value: string): string | undefined {
  const trimmed = value.trim().replace(/^[\[<("'`]+|[\])>"'`.,;:]+$/g, "").replace(/^file:/, "");
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.startsWith("/")) {
    return undefined;
  }
  if (!/[./]/.test(trimmed) && !/^[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|toml|ya?ml|py|sh|sql)$/.test(trimmed)) {
    return undefined;
  }
  if (!/[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|toml|ya?ml|py|sh|sql)$/.test(trimmed)) {
    return undefined;
  }

  const normalized = trimmed.replace(/^\.\//, "");
  if (!normalized.includes("/") && !normalized.startsWith(".")) {
    const bareNameAllowed = /^(?:README|CHANGELOG|LICENSE|package|tsconfig|pnpm-workspace|docker-compose|Dockerfile)(?:\.[A-Za-z0-9_-]+)?$/i.test(
      normalized,
    );
    if (!bareNameAllowed) {
      return undefined;
    }
  }

  return `file:${normalized}`;
}

function selectHighSignalCitations(item: ToolActivityRecord): string[] {
  switch (item.toolKind) {
    case "web_fetch":
    case "web_research":
    case "repo":
    case "edit":
    case "write":
      return item.citations;
    case "web_search":
    case "other":
    default:
      return [];
  }
}

function finalizeCitations(values: string[]): string[] {
  return pruneRedundantRepoCitations(pruneRedundantUrls(dedupe(values)));
}

function pruneRedundantRepoCitations(values: string[]): string[] {
  const repoValues = values.filter((value) => value.startsWith("file:"));
  const specificBasenames = new Set(
    repoValues
      .map((value) => value.slice(5))
      .filter((value) => value.includes("/"))
      .map((value) => value.split("/").at(-1) ?? value),
  );

  return values.filter((value) => {
    if (!value.startsWith("file:")) {
      return true;
    }
    const filePath = value.slice(5);
    if (!filePath.includes("/") && specificBasenames.has(filePath)) {
      return false;
    }
    if (filePath.startsWith("dist/") || filePath.includes("/dist/")) {
      const sourceVariant = filePath
        .replace(/^dist\//, "src/")
        .replace(/\/dist\//g, "/src/")
        .replace(/\.(?:js|jsx|mjs|cjs)$/, ".ts");
      if (repoValues.includes(`file:${sourceVariant}`)) {
        return false;
      }
    }
    return true;
  });
}

function pruneRedundantUrls(values: string[]): string[] {
  return values.filter((value) => {
    if (!value.startsWith("http://") && !value.startsWith("https://")) {
      return true;
    }
    let current: URL;
    try {
      current = new URL(value);
    } catch {
      return true;
    }
    const currentPath = normalizeUrlPath(current.pathname);
    return !values.some((other) => {
      if (other === value || (!other.startsWith("http://") && !other.startsWith("https://"))) {
        return false;
      }
      try {
        const candidate = new URL(other);
        if (candidate.origin !== current.origin) {
          return false;
        }
        const candidatePath = normalizeUrlPath(candidate.pathname);
        if (candidatePath === currentPath) {
          return false;
        }
        return candidatePath.startsWith(currentPath === "/" ? "/" : `${currentPath}/`) && candidatePath.length > currentPath.length;
      } catch {
        return false;
      }
    });
  });
}

function normalizeUrlPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/g, "");
  return trimmed || "/";
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
