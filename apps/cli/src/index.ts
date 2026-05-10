import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
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
    const specialist = args.values.get("specialist")?.at(-1);
    if (!specialist) {
      throw new Error("Missing required --specialist for create command.");
    }
    const workspace = await resolveWorkspace(args.values.get("workspace-root")?.at(-1));
    const descriptor = await createWorkspaceSpecialistTemplate({
      workspace,
      id: specialist,
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
            id: descriptor.template.id,
            name: descriptor.template.name,
            description: descriptor.template.description,
            source: descriptor.source,
            sourcePath: descriptor.sourcePath ?? null,
          },
          nextStep: {
            command: "bootstrap",
            args: {
              specialist: descriptor.template.id,
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
        const profile = await loadWorkspaceSpecialistProfile(workspace, descriptor.template.id);
        return {
          id: descriptor.template.id,
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

  if (command === "restore") {
    const workspaceRoot = args.values.get("workspace-root")?.at(-1);
    const workspace = await resolveWorkspace(workspaceRoot);
    const templates = await listSpecialistTemplates(workspace);
    const requestedSpecialists = args.values.get("specialist") ?? [];
    const requested = new Set(requestedSpecialists.map((value) => value.trim()).filter(Boolean));
    const force = args.values.get("force")?.at(-1) === "true";
    const selectedTemplates = requested.size > 0
      ? templates.filter((descriptor) => requested.has(descriptor.template.id))
      : templates;
    const missing = [...requested].filter((id) => !templates.some((descriptor) => descriptor.template.id === id));
    if (missing.length > 0) {
      throw new Error(`Unknown specialist(s) for restore: ${missing.join(", ")}`);
    }

    console.error(
      [
        `Restoring ${selectedTemplates.length} specialist(s) for ${workspace.displayName}.`,
        "Restore can take a while: each specialist is bootstrapped from its template and grounded in repository/web evidence before a profile is saved.",
        force ? "Existing profiles will be regenerated because --force was provided." : "Existing profiles will be reused; pass --force to regenerate them.",
      ].join("\n"),
    );

    const restored = [];
    for (const descriptor of selectedTemplates) {
      const existing = await loadWorkspaceSpecialistProfile(workspace, descriptor.template.id);
      if (existing && !force) {
        console.error(`- ${descriptor.template.id}: already restored, skipping.`);
        restored.push({
          id: descriptor.template.id,
          name: existing.snapshot.name,
          status: "skipped_existing",
          profilePath: path.join(workspace.profilesDir, `${safeProfileFileName(descriptor.template.id)}.json`),
          updatedAt: existing.updatedAt,
        });
        continue;
      }

      console.error(`- ${descriptor.template.id}: bootstrapping from ${descriptor.sourcePath ?? descriptor.source}...`);
      const result = await pipeline.bootstrap({
        workspaceRoot,
        specialistId: descriptor.template.id,
        question: `Restore ${descriptor.template.name} for this workspace from its committed template.`,
        taskBrief: renderRestoreTaskBrief(descriptor.template),
        constraints: [
          "Ground the restored profile in evidence from this repository before saving it.",
          "Preserve the template's explicit intent, goals, non-goals, capabilities, and output contract.",
          "Prefer project-specific findings over generic advice; mark external context with citations when used.",
        ],
        force,
      });
      restored.push({
        id: descriptor.template.id,
        name: result.profile.snapshot.name,
        status: result.created ? "restored" : "skipped_existing",
        profilePath: result.profilePath,
        updatedAt: result.profile.updatedAt,
      });
    }

    console.log(
      JSON.stringify(
        {
          workspace: {
            id: workspace.id,
            displayName: workspace.displayName,
            rootPath: workspace.rootPath,
          },
          restored,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "bootstrap") {
    const workspaceRoot = args.values.get("workspace-root")?.at(-1);
    const interactiveContext = shouldRunInteractiveBootstrap(args)
      ? await collectInteractiveBootstrapContext({
          workspaceRoot,
          id: args.values.get("specialist")?.at(-1),
          question: args.values.get("question")?.at(-1),
          taskBrief: args.values.get("task-brief")?.at(-1),
          constraints: args.values.get("constraint") ?? [],
        })
      : undefined;
    const specialist = interactiveContext?.id ?? args.values.get("specialist")?.at(-1);
    if (!specialist) {
      throw new Error("Missing required --specialist for bootstrap command.");
    }
    const result = await pipeline.bootstrap({
      workspaceRoot,
      specialistId: specialist,
      question: interactiveContext?.question ?? args.values.get("question")?.at(-1),
      taskBrief: interactiveContext?.taskBrief ?? args.values.get("task-brief")?.at(-1),
      constraints: interactiveContext?.constraints ?? args.values.get("constraint") ?? [],
      force: args.values.get("force")?.at(-1) === "true",
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "consult") {
    const specialist = args.values.get("specialist")?.at(-1);
    const question = args.values.get("question")?.at(-1);
    if (!specialist) {
      throw new Error("Missing required --specialist for consult command.");
    }
    if (!question) {
      throw new Error("Missing required --question for consult command.");
    }
    const result = await pipeline.consult({
      workspaceRoot: args.values.get("workspace-root")?.at(-1),
      specialistId: specialist,
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
            id: result.profile.specialistId,
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

interface InteractiveBootstrapSeed {
  workspaceRoot?: string;
  id?: string;
  question?: string;
  taskBrief?: string;
  constraints: string[];
}

function shouldRunInteractiveBootstrap(args: ReturnType<typeof parseArgs>): boolean {
  return args.values.get("interactive")?.at(-1) === "true";
}

async function collectInteractiveBootstrapContext(seed: InteractiveBootstrapSeed): Promise<Required<InteractiveBootstrapSeed>> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive bootstrap requires a TTY. Pass --specialist/--question/--task-brief for non-interactive use.");
  }

  const workspace = await resolveWorkspace(seed.workspaceRoot);
  const templates = await listSpecialistTemplates(workspace);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.error("\nInteractive specialist bootstrap");
    console.error("Answer what you know. Leave any prompt blank to skip it.\n");

    let id = seed.id?.trim();
    if (!id) {
      if (templates.length > 0) {
        console.error("Available specialists:");
        templates.forEach((descriptor, index) => {
          console.error(`  ${index + 1}. ${descriptor.template.id} — ${descriptor.template.description}`);
        });
      }
      const rawSpecialist = await rl.question("Specialist id or number to bootstrap: ");
      const selectedIndex = Number.parseInt(rawSpecialist.trim(), 10);
      id = Number.isInteger(selectedIndex) && selectedIndex >= 1 && selectedIndex <= templates.length
        ? templates[selectedIndex - 1]?.template.id
        : rawSpecialist.trim();
    }
    if (!id) {
      throw new Error("Interactive bootstrap needs a specialist id.");
    }

    const answers = {
      purpose: await askOptional(rl, "What should this specialist be responsible for? ", seed.question),
      recurringTasks: await askOptional(rl, "What recurring tasks/questions should it handle well? "),
      boundaries: await askOptional(rl, "What should it explicitly avoid or defer? "),
      repoAreas: await askOptional(rl, "Which repo areas/files/workflows should bootstrap inspect first? "),
      externalContext: await askOptional(rl, "Which external docs, APIs, frameworks, or versions matter? "),
      answerStyle: await askOptional(rl, "What answer style or output shape will be most useful? "),
      pitfalls: await askOptional(rl, "Known pitfalls, preferences, or project-specific rules? "),
    };

    const interactiveBrief = renderInteractiveBootstrapBrief(id, answers);
    const taskBrief = [seed.taskBrief, interactiveBrief].filter((value): value is string => Boolean(value && value.trim())).join("\n\n");
    const constraints = [
      ...seed.constraints,
      answers.boundaries ? `Respect these specialist boundaries/non-goals: ${answers.boundaries}` : undefined,
      answers.answerStyle ? `Shape the specialist for this preferred output style: ${answers.answerStyle}` : undefined,
      answers.pitfalls ? `Preserve these project-specific rules/pitfalls: ${answers.pitfalls}` : undefined,
    ].filter((value): value is string => Boolean(value && value.trim()));

    return {
      workspaceRoot: seed.workspaceRoot ?? "",
      id,
      question: seed.question?.trim() || answers.purpose || `Bootstrap ${id} for this workspace.`,
      taskBrief,
      constraints,
    };
  } finally {
    rl.close();
  }
}

async function askOptional(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  existingValue?: string,
): Promise<string | undefined> {
  const suffix = existingValue?.trim() ? ` [${existingValue.trim()}]` : "";
  const answer = await rl.question(`${prompt}${suffix}`);
  return answer.trim() || existingValue?.trim() || undefined;
}

function safeProfileFileName(specialistId: string): string {
  return specialistId.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

function renderRestoreTaskBrief(template: { id: string; name: string; description: string; rolePrompt: string; goals: string[]; nonGoals: string[]; tags: string[] }): string {
  return [
    "Restore this specialist by regenerating its workspace-bound profile from the committed template.",
    `Specialist id: ${template.id}`,
    `Name: ${template.name}`,
    `Description: ${template.description}`,
    `Role intent: ${template.rolePrompt}`,
    template.goals.length > 0 ? `Goals to preserve: ${template.goals.join("; ")}` : undefined,
    template.nonGoals.length > 0 ? `Non-goals/boundaries to preserve: ${template.nonGoals.join("; ")}` : undefined,
    template.tags.length > 0 ? `Tags: ${template.tags.join(", ")}` : undefined,
    "Inspect the repository for files, architecture, conventions, workflows, and docs relevant to this specialist's intent.",
    "Synthesize durable bootstrap notes that will make future consultations behave similarly on other machines restored from the same template.",
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n");
}

function renderInteractiveBootstrapBrief(id: string, answers: Record<string, string | undefined>): string {
  const lines = [
    "Interactive bootstrap context provided by the operator:",
    `- Specialist id: ${id}`,
    answers.purpose ? `- Intended responsibility: ${answers.purpose}` : undefined,
    answers.recurringTasks ? `- Recurring tasks/questions: ${answers.recurringTasks}` : undefined,
    answers.boundaries ? `- Boundaries/non-goals: ${answers.boundaries}` : undefined,
    answers.repoAreas ? `- Repo areas to inspect first: ${answers.repoAreas}` : undefined,
    answers.externalContext ? `- External context to verify: ${answers.externalContext}` : undefined,
    answers.answerStyle ? `- Preferred answer/output style: ${answers.answerStyle}` : undefined,
    answers.pitfalls ? `- Known pitfalls/preferences/rules: ${answers.pitfalls}` : undefined,
  ].filter((value): value is string => Boolean(value));
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
