import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  createConsultationPipeline,
  listSpecialistTemplates,
  loadWorkspaceSpecialistProfile,
  resolveWorkspace,
  type WorkspaceRecord,
} from "@specialists/core";
import { loadDotEnvFromAncestors } from "@specialists/shared";
import {
  createPiRunner,
  DEFAULT_BOOTSTRAP_MODEL,
  DEFAULT_BOOTSTRAP_REPO_EXPLORER_MODEL,
  DEFAULT_BOOTSTRAP_REPO_EXPLORER_THINKING_LEVEL,
  DEFAULT_BOOTSTRAP_THINKING_LEVEL,
  DEFAULT_SPECIALIST_PROVIDER,
} from "@specialists/pi-runner";

const GroundingModeSchema = z.enum(["memory_only", "repo_only", "web_only", "repo_and_web"]);
const ResponseFormatSchema = z.enum(["packet", "markdown", "json", "text"]);

const SpecialistSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});

const ListSpecialistsOutputSchema = {
  workspace: z.object({
    id: z.string(),
    displayName: z.string(),
    rootPath: z.string(),
  }),
  specialists: z.array(SpecialistSummarySchema),
};

const ConsultSpecialistOutputSchema = {
  workspace: z.object({
    id: z.string(),
    displayName: z.string(),
    rootPath: z.string(),
  }),
  specialist: z.object({
    id: z.string(),
    name: z.string(),
  }),
  consultationRecordPath: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  citations: z.array(z.string()),
  answer: z.string(),
};

const SERVER_INSTRUCTIONS = [
  "Workspace-scoped specialist consultation runtime.",
  "This MCP server is intentionally minimal.",
  "The operator manages specialist lifecycle.",
  "The client may only list available specialists and consult an existing bootstrapped specialist.",
].join(" ");

export function createSpecialistsMcpServer(workspaceRootOverride?: string): McpServer {
  const server = new McpServer(
    {
      name: "specialists-runtime",
      version: "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.registerTool(
    "list_specialists",
    {
      title: "List Specialists",
      description: "List the bootstrapped specialists available for consultation in this workspace.",
      outputSchema: ListSpecialistsOutputSchema,
    },
    async () => {
      loadDotEnvFromAncestors(workspaceRootOverride ?? process.cwd());
      const workspace = await resolveWorkspaceRecord(workspaceRootOverride);
      const allTemplates = await listSpecialistTemplates(workspace);
      const specialists = await Promise.all(
        allTemplates.map(async (descriptor) => {
          const profile = await loadWorkspaceSpecialistProfile(workspace, descriptor.template.id);
          if (!profile) {
            return undefined;
          }
          return {
            id: descriptor.template.id,
            name: descriptor.template.name,
            description: descriptor.template.description,
          };
        }),
      );
      const readySpecialists = specialists
        .filter((item): item is z.infer<typeof SpecialistSummarySchema> => item !== undefined)
        .sort((left, right) => left.id.localeCompare(right.id));

      const structuredContent = {
        workspace: summarizeWorkspace(workspace),
        specialists: readySpecialists,
      };

      return {
        content: [
          {
            type: "text",
            text: renderSpecialistListText(workspace, readySpecialists),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "consult_specialist",
    {
      title: "Consult Specialist",
      description: "Consult an existing bootstrapped workspace specialist.",
      inputSchema: {
        specialist: z.string().describe("Specialist id from list_specialists."),
        question: z.string().describe("Question to ask the specialist."),
        task_brief: z.string().optional().describe("Optional task brief or extra context."),
        constraints: z.array(z.string()).optional().describe("Optional repeatable constraints."),
        assumptions: z.array(z.string()).optional().describe("Optional assumptions to keep explicit."),
        response_format: ResponseFormatSchema.optional(),
        grounding_mode: GroundingModeSchema.optional(),
      },
      outputSchema: ConsultSpecialistOutputSchema,
    },
    async ({ specialist, question, task_brief, constraints, assumptions, response_format, grounding_mode }) => {
      loadDotEnvFromAncestors(workspaceRootOverride ?? process.cwd());
      const pipeline = createSpecialistsPipeline();
      const result = await pipeline.consult({
        workspaceRoot: workspaceRootOverride,
        specialistId: specialist,
        question,
        taskBrief: task_brief,
        constraints: constraints ?? [],
        assumptions: assumptions ?? [],
        responseFormat: response_format,
        groundingMode: grounding_mode,
      });

      const structuredContent = {
        workspace: summarizeWorkspace(result.workspace),
        specialist: {
          id: result.profile.specialistId,
          name: result.profile.snapshot.name,
        },
        consultationRecordPath: result.consultationRecordPath,
        provider: result.executionResult.provider,
        model: result.executionResult.model ?? null,
        citations: result.executionResult.citations,
        answer: result.executionResult.answer,
      };

      return {
        content: [
          {
            type: "text",
            text: renderConsultationText(structuredContent),
          },
        ],
        structuredContent,
      };
    },
  );

  return server;
}

export async function runSpecialistsMcpStdio(workspaceRootOverride?: string): Promise<void> {
  const server = createSpecialistsMcpServer(workspaceRootOverride);
  const transport = new StdioServerTransport();
  await server.connect(transport);
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

async function resolveWorkspaceRecord(workspaceRootOverride?: string): Promise<WorkspaceRecord> {
  return await resolveWorkspace(workspaceRootOverride);
}

function summarizeWorkspace(workspace: WorkspaceRecord) {
  return {
    id: workspace.id,
    displayName: workspace.displayName,
    rootPath: workspace.rootPath,
  };
}

function renderSpecialistListText(
  workspace: WorkspaceRecord,
  specialists: Array<z.infer<typeof SpecialistSummarySchema>>,
): string {
  const lines = [
    `Workspace: ${workspace.displayName} (${workspace.rootPath})`,
    `Available specialists: ${specialists.length}`,
  ];
  for (const specialist of specialists) {
    lines.push("", `${specialist.id} — ${specialist.name}`, specialist.description);
  }
  return lines.join("\n");
}

function renderConsultationText(result: z.infer<z.ZodObject<typeof ConsultSpecialistOutputSchema>>): string {
  const lines = [
    `Workspace: ${result.workspace.displayName} (${result.workspace.rootPath})`,
    `Specialist: ${result.specialist.name} (${result.specialist.id})`,
    `Provider: ${result.provider}${result.model ? `/${result.model}` : ""}`,
    `Consultation record: ${result.consultationRecordPath}`,
    "",
    "Answer:",
    result.answer,
  ];
  if (result.citations.length > 0) {
    lines.push("", "Citations:", ...result.citations.map((citation) => `- ${citation}`));
  }
  return lines.join("\n");
}

function parseArgs(argv: string[]) {
  const values = new Map<string, string[]>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, [...(values.get(key) ?? []), "true"]);
      continue;
    }
    index += 1;
    values.set(key, [...(values.get(key) ?? []), next]);
  }
  return { values, positionals };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = args.values.get("workspace-root")?.at(-1);
  await runSpecialistsMcpStdio(workspaceRoot);
}

main().catch((error) => {
  console.error("specialists mcp server failed:\n");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
