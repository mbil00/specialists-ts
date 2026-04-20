import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExecutionCapabilities } from "@specialists/shared";

import type { WorkspaceRecord } from "./workspace.js";

export interface SpecialistTemplate {
  kind: string;
  name: string;
  description: string;
  rolePrompt: string;
  goals: string[];
  nonGoals: string[];
  tags: string[];
  capabilities: ExecutionCapabilities;
  inputContract?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
}

export interface SpecialistTemplateDefinition {
  kind?: string;
  name?: string;
  description?: string;
  rolePrompt?: string;
  goals?: string[];
  nonGoals?: string[];
  tags?: string[];
  capabilities?: Partial<ExecutionCapabilities>;
  inputContract?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
}

export interface SpecialistTemplateDescriptor {
  template: SpecialistTemplate;
  source: "workspace_repo" | "workspace_local";
  sourcePath?: string;
}

export interface CreateWorkspaceSpecialistTemplateInput {
  workspace: WorkspaceRecord;
  kind: string;
  name?: string;
  description?: string;
  rolePrompt?: string;
  goals?: string[];
  nonGoals?: string[];
  tags?: string[];
  capabilities?: Partial<ExecutionCapabilities>;
  inputContract?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
  local?: boolean;
  force?: boolean;
}

export class UnknownSpecialistError extends Error {
  readonly kind: string;
  readonly availableKinds: string[];

  constructor(kind: string, availableKinds: string[]) {
    const available = availableKinds.length > 0 ? availableKinds.join(", ") : "(none)";
    super(`Specialist ${JSON.stringify(kind)} is not defined for this workspace. Available specialists: ${available}`);
    this.name = "UnknownSpecialistError";
    this.kind = kind;
    this.availableKinds = availableKinds;
  }
}

export const DEFAULT_SPECIALIST_OUTPUT_CONTRACT = {
  type: "consultant_packet",
  sections: ["summary", "details", "sources", "uncertainties"],
} as const satisfies Record<string, unknown>;

export const DEFAULT_SPECIALIST_CAPABILITIES: ExecutionCapabilities = {
  repoTools: true,
  webSearch: true,
  webResearch: true,
  webFetch: true,
  fileAuthoring: false,
};

export async function listSpecialistTemplates(workspace: WorkspaceRecord): Promise<SpecialistTemplateDescriptor[]> {
  return (await loadWorkspaceSpecialistTemplates(workspace.rootPath)).sort(
    (left, right) => left.template.name.localeCompare(right.template.name) || left.template.kind.localeCompare(right.template.kind),
  );
}

export async function resolveSpecialistTemplate(
  workspace: WorkspaceRecord,
  kind: string,
): Promise<SpecialistTemplateDescriptor> {
  const normalizedKind = normalizeKind(kind);
  const workspaceTemplates = await loadWorkspaceSpecialistTemplates(workspace.rootPath);
  const workspaceTemplate = workspaceTemplates.find((descriptor) => normalizeKind(descriptor.template.kind) === normalizedKind);
  if (workspaceTemplate) {
    return workspaceTemplate;
  }

  throw new UnknownSpecialistError(
    normalizedKind,
    workspaceTemplates.map((descriptor) => descriptor.template.kind).sort((left, right) => left.localeCompare(right)),
  );
}

export async function createWorkspaceSpecialistTemplate(
  input: CreateWorkspaceSpecialistTemplateInput,
): Promise<SpecialistTemplateDescriptor> {
  const kind = normalizeKind(input.kind);
  const base = createFallbackTemplate(kind);
  const definition: SpecialistTemplateDefinition = {
    kind,
    name: input.name ?? base.name,
    description: input.description ?? base.description,
    rolePrompt: input.rolePrompt ?? base.rolePrompt,
    goals: input.goals && input.goals.length > 0 ? input.goals : base.goals,
    nonGoals: input.nonGoals && input.nonGoals.length > 0 ? input.nonGoals : base.nonGoals,
    tags: input.tags && input.tags.length > 0 ? input.tags : base.tags,
    capabilities: {
      ...base.capabilities,
      ...(input.capabilities ?? {}),
    },
    inputContract: input.inputContract ?? base.inputContract,
    outputContract: input.outputContract ?? base.outputContract,
  };
  const source = input.local ? "workspace_local" : "workspace_repo";
  const relativeDir = input.local ? [".specialists", "templates"] : [".agents", "specialists"];
  const dirPath = path.join(input.workspace.rootPath, ...relativeDir);
  const filePath = path.join(dirPath, `${kind}.json`);

  if (!input.force) {
    const existing = await loadWorkspaceSpecialistTemplates(input.workspace.rootPath);
    const conflict = existing.find((descriptor) => normalizeKind(descriptor.template.kind) === kind);
    if (conflict) {
      throw new Error(`Specialist ${JSON.stringify(kind)} already exists at ${conflict.sourcePath ?? conflict.source}.`);
    }
  }

  await mkdir(dirPath, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(definition, null, 2)}\n`, "utf8");

  return {
    template: materializeTemplate(kind, definition, base),
    source,
    sourcePath: filePath,
  };
}

export function createFallbackTemplate(kind: string): SpecialistTemplate {
  const humanName = kindToName(kind);
  return {
    kind,
    name: humanName,
    description: `Workspace-scoped specialist for ${humanName.toLowerCase()} tasks.`,
    rolePrompt: [
      `You are the ${humanName} for this workspace.`,
      "Answer as a reusable specialist consultant, grounded in the repository when available and in web evidence when needed.",
      "Prefer exact repo and source-backed guidance over generic advice.",
    ].join(" "),
    goals: [
      "Produce compact, implementation-useful answers.",
      "Reuse project conventions visible in the current workspace.",
      "Be explicit about what was verified vs inferred.",
    ],
    nonGoals: [
      "Do not bluff when repo or web evidence is missing.",
      "Do not ignore the workspace-specific context.",
    ],
    tags: [normalizeKind(kind)],
    capabilities: DEFAULT_SPECIALIST_CAPABILITIES,
    outputContract: DEFAULT_SPECIALIST_OUTPUT_CONTRACT,
  };
}

export function kindToName(kind: string): string {
  return normalizeKind(kind)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") + " Specialist";
}

export async function loadWorkspaceSpecialistTemplates(rootPath: string): Promise<SpecialistTemplateDescriptor[]> {
  const descriptors: SpecialistTemplateDescriptor[] = [];
  for (const source of WORKSPACE_TEMPLATE_SOURCES) {
    const dirPath = path.join(rootPath, ...source.relativePath);
    const templates = await readTemplateDirectory(dirPath, source.kind);
    descriptors.push(...templates);
  }
  return descriptors;
}

async function readTemplateDirectory(
  dirPath: string,
  source: SpecialistTemplateDescriptor["source"],
): Promise<SpecialistTemplateDescriptor[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dirPath);
  } catch {
    return [];
  }

  const descriptors = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right))
      .map(async (entry): Promise<SpecialistTemplateDescriptor | undefined> => {
        const filePath = path.join(dirPath, entry);
        try {
          const content = await readFile(filePath, "utf8");
          const parsed = JSON.parse(content) as SpecialistTemplateDefinition;
          const fileKind = normalizeKind(path.basename(entry, ".json"));
          const kind = normalizeKind(parsed.kind ?? fileKind);
          const base = createFallbackTemplate(kind);
          return {
            template: materializeTemplate(kind, parsed, base),
            source,
            sourcePath: filePath,
          };
        } catch {
          return undefined;
        }
      }),
  );

  return descriptors.filter((descriptor): descriptor is SpecialistTemplateDescriptor => descriptor !== undefined);
}

function materializeTemplate(
  kind: string,
  definition: SpecialistTemplateDefinition,
  base: SpecialistTemplate,
): SpecialistTemplate {
  return {
    kind,
    name: readString(definition.name) ?? base.name,
    description: readString(definition.description) ?? base.description,
    rolePrompt: readString(definition.rolePrompt) ?? base.rolePrompt,
    goals: readStringArray(definition.goals, base.goals),
    nonGoals: readStringArray(definition.nonGoals, base.nonGoals),
    tags: readStringArray(definition.tags, base.tags),
    capabilities: {
      ...DEFAULT_SPECIALIST_CAPABILITIES,
      ...base.capabilities,
      ...(definition.capabilities ?? {}),
    },
    inputContract: definition.inputContract ?? base.inputContract,
    outputContract: definition.outputContract ?? base.outputContract,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return normalized.length > 0 ? normalized : fallback;
}

const WORKSPACE_TEMPLATE_SOURCES = [
  {
    kind: "workspace_repo" as const,
    relativePath: [".agents", "specialists"],
  },
  {
    kind: "workspace_local" as const,
    relativePath: [".specialists", "templates"],
  },
];

export function normalizeKind(kind: string): string {
  return kind.trim().replace(/[_\s]+/g, "-").toLowerCase();
}
