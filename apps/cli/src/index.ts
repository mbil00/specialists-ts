import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createConsultationPipeline,
  createWorkspaceSpecialistTemplate,
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

async function main(): Promise<void> {
  loadDotEnvFromAncestors();
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0] ?? "consult";
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
  const pipeline = createConsultationPipeline({
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

  if (command === "init") {
    const workspace = await resolveWorkspace(args.values.get("workspace-root")?.at(-1));
    const configPath = await writeWorkspaceMcpConfig(workspace.rootPath, specialistsProjectRoot());
    const codexConfigPath = await appendCodexMcpConfig(workspace.rootPath, specialistsProjectRoot());
    console.log(
      JSON.stringify(
        {
          workspace: {
            id: workspace.id,
            displayName: workspace.displayName,
            rootPath: workspace.rootPath,
          },
          mcpConfigPath: configPath,
          codexConfigPath,
          server: {
            command: "pnpm",
            args: buildMcpServerArgs(specialistsProjectRoot(), workspace.rootPath),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "create") {
    const kind = args.values.get("kind")?.at(-1);
    if (!kind) {
      throw new Error("Missing required --kind for create command.");
    }
    const workspace = await resolveWorkspace(args.values.get("workspace-root")?.at(-1));
    const descriptor = await createWorkspaceSpecialistTemplate({
      workspace,
      kind,
      name: args.values.get("name")?.at(-1),
      description: args.values.get("description")?.at(-1),
      rolePrompt: args.values.get("role-prompt")?.at(-1),
      goals: args.values.get("goal") ?? [],
      nonGoals: args.values.get("non-goal") ?? [],
      tags: args.values.get("tag") ?? [],
      local: args.values.get("local")?.at(-1) === "true",
      force: args.values.get("force")?.at(-1) === "true",
    });
    console.log(
      JSON.stringify(
        {
          workspace: {
            id: workspace.id,
            displayName: workspace.displayName,
            rootPath: workspace.rootPath,
          },
          specialist: {
            kind: descriptor.template.kind,
            name: descriptor.template.name,
            description: descriptor.template.description,
            source: descriptor.source,
            sourcePath: descriptor.sourcePath ?? null,
          },
          nextStep: {
            command: "bootstrap",
            args: {
              kind: descriptor.template.kind,
              question: `Bootstrap ${descriptor.template.name} for this workspace.`,
            },
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "list") {
    const workspace = await resolveWorkspace(args.values.get("workspace-root")?.at(-1));
    const templates = await listSpecialistTemplates(workspace);
    const specialists = await Promise.all(
      templates.map(async (descriptor) => {
        const profile = await loadWorkspaceSpecialistProfile(workspace, descriptor.template.kind);
        return {
          kind: descriptor.template.kind,
          name: descriptor.template.name,
          description: descriptor.template.description,
          tags: descriptor.template.tags,
          capabilities: descriptor.template.capabilities,
          source: descriptor.source,
          sourcePath: descriptor.sourcePath ?? null,
          bootstrapped: Boolean(profile),
          lastConsultedAt: profile?.lastConsultedAt ?? null,
          updatedAt: profile?.updatedAt ?? null,
        };
      }),
    );
    console.log(
      JSON.stringify(
        {
          workspace: {
            id: workspace.id,
            displayName: workspace.displayName,
            rootPath: workspace.rootPath,
          },
          specialists,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "bootstrap") {
    const kind = args.values.get("kind")?.at(-1);
    if (!kind) {
      throw new Error("Missing required --kind for bootstrap command.");
    }
    const result = await pipeline.bootstrap({
      workspaceRoot: args.values.get("workspace-root")?.at(-1),
      specialistKind: kind,
      question: args.values.get("question")?.at(-1),
      taskBrief: args.values.get("task-brief")?.at(-1),
      constraints: args.values.get("constraint") ?? [],
      force: args.values.get("force")?.at(-1) === "true",
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "consult") {
    const kind = args.values.get("kind")?.at(-1);
    const question = args.values.get("question")?.at(-1);
    if (!kind) {
      throw new Error("Missing required --kind for consult command.");
    }
    if (!question) {
      throw new Error("Missing required --question for consult command.");
    }
    const result = await pipeline.consult({
      workspaceRoot: args.values.get("workspace-root")?.at(-1),
      specialistKind: kind,
      question,
      taskBrief: args.values.get("task-brief")?.at(-1),
      constraints: args.values.get("constraint") ?? [],
      assumptions: args.values.get("assumption") ?? [],
      responseFormat: oneOf(args.values.get("response-format")?.at(-1), ["packet", "markdown", "json", "text"] as const),
      groundingMode: oneOf(args.values.get("grounding-mode")?.at(-1), ["memory_only", "repo_only", "web_only", "repo_and_web"] as const),
      forceBootstrap: args.values.get("force-bootstrap")?.at(-1) === "true",
    });
    console.log(
      JSON.stringify(
        {
          workspace: {
            id: result.workspace.id,
            displayName: result.workspace.displayName,
            rootPath: result.workspace.rootPath,
          },
          specialist: {
            kind: result.profile.specialistKind,
            name: result.profile.snapshot.name,
          },
          consultationRecordPath: result.consultationRecordPath,
          provider: result.executionResult.provider,
          model: result.executionResult.model ?? null,
          citations: result.executionResult.citations,
          toolActivity: result.executionResult.toolActivity,
          answer: result.executionResult.answer,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(`Unknown command: ${command}`);
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

async function writeWorkspaceMcpConfig(workspaceRoot: string, specialistsRoot: string): Promise<string> {
  const configPath = path.join(workspaceRoot, ".mcp.json");
  let payload: Record<string, unknown> = {};
  try {
    const existing = await readFile(configPath, "utf8");
    payload = JSON.parse(existing) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const mcpServersValue = payload.mcpServers;
  const mcpServers =
    mcpServersValue && typeof mcpServersValue === "object" && !Array.isArray(mcpServersValue)
      ? ({ ...mcpServersValue } as Record<string, unknown>)
      : {};

  mcpServers.specialists = {
    type: "stdio",
    command: "pnpm",
    args: buildMcpServerArgs(specialistsRoot, workspaceRoot),
  };

  payload.mcpServers = mcpServers;
  await writeFile(configPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return configPath;
}

function buildMcpServerArgs(specialistsRoot: string, workspaceRoot: string): string[] {
  return [
    "--dir",
    specialistsRoot,
    "--filter",
    "@specialists/api",
    "mcp:stdio",
    "--",
    "--workspace-root",
    workspaceRoot,
  ];
}

async function appendCodexMcpConfig(workspaceRoot: string, specialistsRoot: string): Promise<string> {
  const configPath = path.join(workspaceRoot, ".codex", "config.toml");
  let existing = "";
  try {
    existing = await readFile(configPath, "utf8");
  } catch {
    existing = "";
  }

  const sectionHeader = "[mcp_servers.specialists]";
  if (existing.includes(sectionHeader)) {
    return configPath;
  }

  const renderedSection = renderCodexMcpSection(specialistsRoot, workspaceRoot);
  const next = existing.trimEnd() ? `${existing.trimEnd()}\n\n${renderedSection}\n` : `${renderedSection}\n`;
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, next, "utf8");
  return configPath;
}

function renderCodexMcpSection(specialistsRoot: string, workspaceRoot: string): string {
  const args = buildMcpServerArgs(specialistsRoot, workspaceRoot);
  return [
    "[mcp_servers.specialists]",
    'command = "pnpm"',
    `args = [${args.map((value) => JSON.stringify(value)).join(", ")}]`,
  ].join("\n");
}

function specialistsProjectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function loadDotEnvFromAncestors(startDir: string = process.cwd()): void {
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

function oneOf<const T extends readonly string[]>(value: string | undefined, allowed: T): T[number] | undefined {
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

main().catch((error) => {
  console.error("specialists cli failed:\n");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
