import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { StringEnum, Type } from "@mariozechner/pi-ai";
import {
  createConsultationPipeline,
  listSpecialistTemplates,
  loadWorkspaceSpecialistProfile,
  resolveWorkspace,
} from "@specialists/core";
import {
  createPiRunner,
  DEFAULT_BOOTSTRAP_MODEL,
  DEFAULT_BOOTSTRAP_REPO_EXPLORER_MODEL,
  DEFAULT_BOOTSTRAP_REPO_EXPLORER_THINKING_LEVEL,
  DEFAULT_BOOTSTRAP_THINKING_LEVEL,
  DEFAULT_SPECIALIST_PROVIDER,
} from "@specialists/pi-runner";

const GroundingModeEnum = StringEnum(["memory_only", "repo_only", "web_only", "repo_and_web"] as const);
const ResponseFormatEnum = StringEnum(["packet", "markdown", "json", "text"] as const);

const listSpecialistsTool = defineTool({
  name: "list_specialists",
  label: "List Specialists",
  description:
    "List the workspace specialists that are ready for consultation in the current project.",
  promptSnippet: "List the specialists available in this workspace before doing broad research yourself",
  promptGuidelines: [
    "Use list_specialists first when you are unsure whether a relevant workspace specialist already exists.",
    "Prefer consulting an existing specialist over re-doing repo discovery or web discovery yourself.",
    "The operator manages specialists; if one is missing, do not invent it yourself.",
  ],
  parameters: Type.Object({}),
  async execute(_toolCallId, _rawParams, _signal, onUpdate, ctx) {
    loadDotEnvFromAncestors(ctx.cwd);
    onUpdate?.({
      content: [{ type: "text", text: "Inspecting workspace specialists..." }],
      details: { phase: "list" },
    });

    const workspace = await resolveWorkspace(ctx.cwd);
    const descriptors = await listSpecialistTemplates(workspace);
    const specialists = await Promise.all(
      descriptors.map(async (descriptor) => {
        const profile = await loadWorkspaceSpecialistProfile(workspace, descriptor.template.kind);
        return {
          kind: descriptor.template.kind,
          name: descriptor.template.name,
          description: descriptor.template.description,
          tags: descriptor.template.tags,
          source: descriptor.source,
          sourcePath: descriptor.sourcePath ?? null,
          bootstrapped: Boolean(profile),
          lastConsultedAt: profile?.lastConsultedAt ?? null,
          updatedAt: profile?.updatedAt ?? null,
        };
      }),
    );
    const filtered = specialists.filter((item) => item.bootstrapped);

    return {
      content: [{ type: "text", text: renderSpecialistList(workspace.rootPath, filtered) }],
      details: {
        workspace: {
          id: workspace.id,
          displayName: workspace.displayName,
          rootPath: workspace.rootPath,
        },
        specialists: filtered,
      },
    };
  },
});

const consultSpecialistTool = defineTool({
  name: "consult_specialist",
  label: "Consult Specialist",
  description:
    "Run a workspace-bound specialist in a fresh subagent session and return a compact grounded answer packet with citations and execution metadata.",
  promptSnippet: "Consult a workspace specialist instead of spending your own context on repo or web research",
  promptGuidelines: [
    "When a relevant specialist exists, use consult_specialist before doing large repo discovery or multi-page web research yourself.",
    "Pass the most specific specialist kind you can, based on list_specialists output or known workspace conventions.",
    "Use groundingMode to constrain the specialist when the task is clearly repo-only or web-only.",
    "Do not try to create or bootstrap specialists from the main agent; that is operator work.",
  ],
  parameters: Type.Object({
    kind: Type.String({ description: "Specialist kind from list_specialists." }),
    question: Type.String({ description: "Question or task for the specialist." }),
    taskBrief: Type.Optional(Type.String({ description: "Optional extra operator context or task framing." })),
    constraints: Type.Optional(Type.Array(Type.String({ description: "Constraint or requirement." }))),
    assumptions: Type.Optional(Type.Array(Type.String({ description: "Assumption the specialist should treat explicitly." }))),
    responseFormat: Type.Optional(ResponseFormatEnum),
    groundingMode: Type.Optional(GroundingModeEnum),
  }),
  async execute(_toolCallId, rawParams, _signal, onUpdate, ctx) {
    loadDotEnvFromAncestors(ctx.cwd);
    const params = rawParams as {
      kind: string;
      question: string;
      taskBrief?: string;
      constraints?: string[];
      assumptions?: string[];
      responseFormat?: "packet" | "markdown" | "json" | "text";
      groundingMode?: "memory_only" | "repo_only" | "web_only" | "repo_and_web";
    };
    const kind = params.kind?.trim();
    const question = params.question?.trim();
    if (!kind) {
      throw new Error("consult_specialist requires a non-empty kind.");
    }
    if (!question) {
      throw new Error("consult_specialist requires a non-empty question.");
    }

    onUpdate?.({
      content: [{ type: "text", text: `Consulting specialist ${kind}...` }],
      details: { phase: "consult", kind, question },
    });

    const pipeline = createSpecialistsPipeline();
    const result = await pipeline.consult({
      workspaceRoot: ctx.cwd,
      specialistKind: kind,
      question,
      taskBrief: params.taskBrief,
      constraints: params.constraints ?? [],
      assumptions: params.assumptions ?? [],
      responseFormat: params.responseFormat,
      groundingMode: params.groundingMode,
    });

    return {
      content: [{ type: "text", text: renderConsultationResult(result) }],
      details: {
        workspace: {
          id: result.workspace.id,
          displayName: result.workspace.displayName,
          rootPath: result.workspace.rootPath,
        },
        specialist: {
          kind: result.profile.specialistKind,
          name: result.profile.snapshot.name,
        },
        bootstrapCreated: false,
        consultationRecordPath: result.consultationRecordPath,
        provider: result.executionResult.provider,
        model: result.executionResult.model ?? null,
        citations: result.executionResult.citations,
        toolActivity: result.executionResult.toolActivity,
        answer: result.executionResult.answer,
      },
    };
  },
});

export default function specialistToolsExtension(pi: ExtensionAPI) {
  pi.registerTool(listSpecialistsTool);
  pi.registerTool(consultSpecialistTool);
}

function createSpecialistsPipeline() {
  const consultationRunner = createPiRunner();
  const bootstrapPlannerRunner = createPiRunner({
    provider: DEFAULT_SPECIALIST_PROVIDER,
    model: DEFAULT_BOOTSTRAP_MODEL,
    thinkingLevel: DEFAULT_BOOTSTRAP_THINKING_LEVEL,
    builtInRepoTools: ["read", "bash", "grep", "find", "ls"],
    webTools: ["web_search", "web_research", "web_fetch"],
  });
  const bootstrapRepoExplorerRunner = createPiRunner({
    provider: DEFAULT_SPECIALIST_PROVIDER,
    model: DEFAULT_BOOTSTRAP_REPO_EXPLORER_MODEL,
    thinkingLevel: DEFAULT_BOOTSTRAP_REPO_EXPLORER_THINKING_LEVEL,
    builtInRepoTools: ["read", "bash", "grep", "find", "ls"],
    webTools: [],
  });
  return createConsultationPipeline({
    consultationEngine: consultationRunner,
    bootstrapEngines: {
      planner: bootstrapPlannerRunner,
      repoExplorer: bootstrapRepoExplorerRunner,
      webResearcher: bootstrapPlannerRunner,
      validator: bootstrapPlannerRunner,
      synthesizer: bootstrapPlannerRunner,
      fallback: consultationRunner,
    },
  });
}

function renderSpecialistList(
  workspaceRoot: string,
  specialists: Array<{
    kind: string;
    name: string;
    description: string;
    tags: string[];
    source: string;
    sourcePath: string | null;
    bootstrapped: boolean;
    lastConsultedAt: string | null;
    updatedAt: string | null;
  }>,
): string {
  const lines = [`Workspace: ${workspaceRoot}`, `Specialist count: ${specialists.length}`];
  for (const specialist of specialists) {
    lines.push(
      "",
      `${specialist.name} (${specialist.kind})`,
      `Description: ${specialist.description}`,
      `Source: ${specialist.source}${specialist.sourcePath ? ` (${specialist.sourcePath})` : ""}`,
      `Bootstrapped: ${String(specialist.bootstrapped)}`,
      specialist.updatedAt ? `Profile updated: ${specialist.updatedAt}` : "Profile updated: (not bootstrapped)",
      specialist.lastConsultedAt ? `Last consulted: ${specialist.lastConsultedAt}` : "Last consulted: never",
      specialist.tags.length > 0 ? `Tags: ${specialist.tags.join(", ")}` : "Tags: (none)",
    );
  }
  return lines.join("\n");
}

function renderConsultationResult(result: Awaited<ReturnType<ReturnType<typeof createSpecialistsPipeline>["consult"]>>): string {
  const lines = [
    `Workspace: ${result.workspace.displayName} (${result.workspace.rootPath})`,
    `Specialist: ${result.profile.snapshot.name} (${result.profile.specialistKind})`,
    `Provider: ${result.executionResult.provider}${result.executionResult.model ? `/${result.executionResult.model}` : ""}`,
    "Bootstrap: existing profile reused",
    `Consultation record: ${result.consultationRecordPath}`,
    "",
    "Answer:",
    result.executionResult.answer,
  ];

  if (result.executionResult.citations.length > 0) {
    lines.push("", "Citations:", ...result.executionResult.citations.map((citation) => `- ${citation}`));
  }

  if (result.executionResult.toolActivity.length > 0) {
    lines.push("", "Tool activity:");
    for (const item of result.executionResult.toolActivity) {
      lines.push(`- ${item.toolName} [${item.toolKind}] success=${String(item.success)}`);
    }
  }

  return lines.join("\n");
}

function loadDotEnvFromAncestors(startDir: string): void {
  const candidates: string[] = [];
  let current = path.resolve(startDir);
  while (true) {
    candidates.push(path.join(current, ".env"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
