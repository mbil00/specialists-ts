import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  ArtifactSnippet,
  SpecialistExecutionRequest,
  SpecialistExecutionResult,
  SpecialistProfileSnapshot,
  WorkspaceObservation,
} from "@specialists/shared";

import { extractAnswerSummary, parseJsonObject } from "./json.js";
import { normalizeKind, type SpecialistTemplate } from "./templates.js";
import {
  loadWorkspaceSpecialistProfile,
  saveWorkspaceSpecialistProfile,
  type WorkspaceSpecialistProfile,
} from "./store.js";
import type { WorkspaceRecord } from "./workspace.js";

export interface BootstrapExecutionEngine {
  run(request: SpecialistExecutionRequest): Promise<SpecialistExecutionResult>;
}

export interface BootstrapExecutionEngines {
  planner?: BootstrapExecutionEngine;
  repoExplorer?: BootstrapExecutionEngine;
  webResearcher?: BootstrapExecutionEngine;
  validator?: BootstrapExecutionEngine;
  synthesizer?: BootstrapExecutionEngine;
  fallback?: BootstrapExecutionEngine;
}

export interface BootstrapSpecialistInput {
  workspace: WorkspaceRecord;
  template: SpecialistTemplate;
  question?: string;
  taskBrief?: string;
  constraints?: string[];
  force?: boolean;
  engines?: BootstrapExecutionEngines;
}

export interface BootstrapSpecialistResult {
  profile: WorkspaceSpecialistProfile;
  profilePath: string;
  created: boolean;
}

interface BootstrapWorkstream {
  label: string;
  question: string;
  rationale?: string;
}

interface BootstrapPlan {
  useRepoExplorer: boolean;
  useWebResearch: boolean;
  repoWorkstreams: BootstrapWorkstream[];
  webWorkstreams: BootstrapWorkstream[];
  validationFocus: string[];
  profileFocus: string[];
  notes: string[];
}

interface BootstrapPassReport {
  title: string;
  summary: string;
  findings: string[];
  tags: string[];
  citations: string[];
  rawText: string;
}

interface BootstrapSynthesisDraft {
  name?: string;
  rolePrompt?: string;
  goals?: string[];
  nonGoals?: string[];
  tags?: string[];
  workspaceContextSummary?: string;
  bootstrapNotes?: string[];
}

const ANCHOR_FILE_NAMES = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "SPEC.md",
  "DESIGN.md",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
];

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".turbo",
  ".specialists",
]);

const PREFERRED_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".sql",
  ".sh",
]);

export async function bootstrapSpecialist(input: BootstrapSpecialistInput): Promise<BootstrapSpecialistResult> {
  if (!input.force) {
    const existing = await loadWorkspaceSpecialistProfile(input.workspace, input.template.kind);
    if (existing) {
      return {
        profile: existing,
        profilePath: path.join(input.workspace.profilesDir, `${normalizeKind(input.template.kind)}.json`),
        created: false,
      };
    }
  }

  const bootstrapQuery = buildBootstrapQuery(input.template, input.question, input.taskBrief, input.constraints ?? []);
  const anchorObservations = await inspectWorkspace(input.workspace.rootPath, bootstrapQuery, 6);
  const staticSummary = buildWorkspaceContextSummary(input.workspace, input.template, anchorObservations);
  const plan = await maybePlanBootstrap(input, anchorObservations, staticSummary);

  const [repoPasses, webPasses] = await Promise.all([
    maybeRunRepoBootstrapPasses(input, plan, anchorObservations, staticSummary),
    maybeRunWebBootstrapPasses(input, plan, anchorObservations, staticSummary),
  ]);
  const validationPass = await maybeRunBootstrapValidationPass(
    input,
    plan,
    anchorObservations,
    repoPasses,
    webPasses,
    staticSummary,
  );
  const synthesis = await maybeRunBootstrapSynthesis(
    input,
    plan,
    anchorObservations,
    repoPasses,
    webPasses,
    validationPass,
    staticSummary,
  );

  const repoSummary = summarizePasses(repoPasses);
  const webSummary = summarizePasses(webPasses);
  const validationSummary = validationPass?.summary;
  const summary =
    synthesis?.workspaceContextSummary?.trim() ||
    buildSynthesizedSummary(staticSummary, repoSummary, webSummary, validationSummary, plan);

  const snapshot: SpecialistProfileSnapshot = {
    kind: input.template.kind,
    name: synthesis?.name?.trim() || input.template.name,
    rolePrompt: [
      synthesis?.rolePrompt?.trim() || input.template.rolePrompt,
      `Workspace bootstrap summary: ${summary}`,
    ].join("\n\n"),
    goals: mergeStrings(synthesis?.goals, [...input.template.goals, ...plan.profileFocus]),
    nonGoals: mergeStrings(synthesis?.nonGoals, input.template.nonGoals),
    inputContract: input.template.inputContract,
    outputContract: input.template.outputContract,
    tags: mergeStrings(synthesis?.tags, [...input.template.tags, ...readTagsFromText(summary)]),
  };

  const now = new Date().toISOString();
  const profile: WorkspaceSpecialistProfile = {
    schemaVersion: 1,
    workspaceId: input.workspace.id,
    specialistKind: input.template.kind,
    template: input.template,
    snapshot,
    workspaceContextSummary: summary,
    bootstrapObservations: mergeBootstrapObservations(anchorObservations, repoPasses, webPasses, validationPass),
    bootstrapQuery,
    bootstrapRepoSummary: repoSummary,
    bootstrapWebSummary: webSummary,
    bootstrapValidationSummary: validationSummary,
    bootstrapNotes: compactBootstrapNotes([
      ...plan.notes,
      ...(synthesis?.bootstrapNotes ?? []),
      ...collectFindings(repoPasses, 4),
      ...collectFindings(webPasses, 3),
      ...(validationPass?.findings ?? []).slice(0, 4),
    ]),
    bootstrapCitations: unique([
      ...collectCitations(repoPasses),
      ...collectCitations(webPasses),
      ...(validationPass?.citations ?? []),
    ]).slice(0, 20),
    createdAt: now,
    updatedAt: now,
  };
  const profilePath = await saveWorkspaceSpecialistProfile(input.workspace, profile);
  return { profile, profilePath, created: true };
}

export async function inspectWorkspace(
  workspaceRoot: string,
  queryText: string,
  limit: number,
): Promise<WorkspaceObservation[]> {
  const queryTerms = tokenize(queryText);
  const candidates = await collectCandidateFiles(workspaceRoot, 600);
  const scored = await Promise.all(
    candidates.map(async (filePath) => {
      const observation = await buildObservation(workspaceRoot, filePath, queryTerms);
      return observation ? { score: scoreObservation(observation, queryTerms), observation } : undefined;
    }),
  );
  return scored
    .filter((item): item is { score: number; observation: WorkspaceObservation } => Boolean(item))
    .sort((left, right) => right.score - left.score || left.observation.label.localeCompare(right.observation.label))
    .slice(0, limit)
    .map((item) => item.observation);
}

export function buildWorkspaceContextSummary(
  workspace: WorkspaceRecord,
  template: SpecialistTemplate,
  observations: WorkspaceObservation[],
): string {
  if (observations.length === 0) {
    return [
      `Workspace ${workspace.displayName} is bound at ${workspace.rootPath}.`,
      "Bootstrap did not capture anchor files yet, so bootstrap should explicitly inspect the repo before finalizing the specialist.",
      `This specialist focuses on ${template.description.toLowerCase()}`,
    ].join(" ");
  }
  const labels = observations.slice(0, 5).map((item) => item.label).join(", ");
  return [
    `Workspace ${workspace.displayName} is rooted at ${workspace.rootPath}.`,
    `Bootstrap identified likely anchor files: ${labels}.`,
    "Use these as initial anchors, but refine them through explicit repo/web bootstrap passes before finalizing the specialist.",
  ].join(" ");
}

function buildBootstrapQuery(
  template: SpecialistTemplate,
  question: string | undefined,
  taskBrief: string | undefined,
  constraints: string[],
): string {
  return [template.kind, template.name, template.description, question, taskBrief, ...constraints]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ");
}

async function maybePlanBootstrap(
  input: BootstrapSpecialistInput,
  anchorObservations: WorkspaceObservation[],
  staticSummary: string,
): Promise<BootstrapPlan> {
  const engine = input.engines?.planner ?? input.engines?.fallback;
  const fallback = defaultBootstrapPlan(input.template, input.question, input.taskBrief, input.constraints ?? []);
  if (!engine) {
    return fallback;
  }
  try {
    const request: SpecialistExecutionRequest = {
      workspaceId: input.workspace.id,
      workspaceRoot: input.workspace.rootPath,
      workspaceDisplayName: input.workspace.displayName,
      specialist: {
        kind: "bootstrap_planner",
        name: "Specialist Bootstrap Planner",
        rolePrompt: [
          "You are a dedicated bootstrap planner, not the final specialist.",
          "Given the specialist request and current workspace anchor observations, decide what repository exploration and web research should happen before synthesizing the specialist profile.",
          "You may recommend multiple parallel workstreams when the repo or ecosystem has separable areas like frontend/backend, API/framework, infra/design, etc.",
          "Plan only the highest-value workstreams needed for bootstrap quality.",
          "Return ONLY valid JSON with keys: useRepoExplorer, useWebResearch, repoWorkstreams, webWorkstreams, validationFocus, profileFocus, notes.",
          "repoWorkstreams and webWorkstreams must be arrays of objects with keys: label, question, rationale.",
          "validationFocus, profileFocus, and notes must be arrays of strings.",
        ].join("\n\n"),
        goals: [
          "Decide the minimum useful investigation plan for a high-quality specialist bootstrap.",
          "Split bootstrap work into parallel subagents when it will materially improve coverage or speed.",
        ],
        nonGoals: ["Do not answer the future specialist's user questions.", "Do not call tools.", "Return JSON only."],
        outputContract: {
          type: "json_object",
          requiredKeys: [
            "useRepoExplorer",
            "useWebResearch",
            "repoWorkstreams",
            "webWorkstreams",
            "validationFocus",
            "profileFocus",
            "notes",
          ],
        },
      },
      task: {
        question: `Plan bootstrap investigation for the ${input.template.name}.`,
        taskBrief: [
          `Template description: ${input.template.description}`,
          input.question ? `Initial specialist request: ${input.question}` : undefined,
          input.taskBrief ? `Task brief: ${input.taskBrief}` : undefined,
          `Static workspace summary: ${staticSummary}`,
        ]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join("\n"),
        constraints: [
          ...(input.constraints ?? []),
          "Prefer targeted investigation over broad generic research.",
          "If repo evidence can answer most of the bootstrap need, say so.",
          "If external docs/ecosystem context will materially improve the specialist, say so.",
          "Return valid JSON only.",
        ],
        assumptions: [],
        responseFormat: "json",
        groundingMode: "memory_only",
      },
      memory: [],
      artifacts: [],
      workspaceObservations: anchorObservations,
      capabilities: {
        repoTools: false,
        webSearch: false,
        webResearch: false,
        webFetch: false,
        fileAuthoring: false,
      },
    };
    const result = await engine.run(request);
    const parsed = parseJsonObject(result.answer);
    if (!parsed) {
      return fallback;
    }
    return {
      useRepoExplorer: readBoolean(parsed.useRepoExplorer, fallback.useRepoExplorer),
      useWebResearch: readBoolean(parsed.useWebResearch, fallback.useWebResearch),
      repoWorkstreams: normalizeWorkstreams(parsed.repoWorkstreams, fallback.repoWorkstreams, 3),
      webWorkstreams: normalizeWorkstreams(parsed.webWorkstreams, fallback.webWorkstreams, 3),
      validationFocus: mergeStrings(readStringArray(parsed.validationFocus), fallback.validationFocus),
      profileFocus: mergeStrings(readStringArray(parsed.profileFocus), fallback.profileFocus),
      notes: mergeStrings(readStringArray(parsed.notes), fallback.notes),
    };
  } catch {
    return fallback;
  }
}

async function maybeRunRepoBootstrapPasses(
  input: BootstrapSpecialistInput,
  plan: BootstrapPlan,
  anchorObservations: WorkspaceObservation[],
  staticSummary: string,
): Promise<BootstrapPassReport[]> {
  const engine = input.engines?.repoExplorer ?? input.engines?.fallback;
  if (!engine || !input.template.capabilities.repoTools || !plan.useRepoExplorer) {
    return [];
  }
  const workstreams = plan.repoWorkstreams.slice(0, 3);
  const reports = await Promise.all(
    workstreams.map(async (workstream, index) => {
      try {
        const request: SpecialistExecutionRequest = {
          workspaceId: input.workspace.id,
          workspaceRoot: input.workspace.rootPath,
          workspaceDisplayName: input.workspace.displayName,
          specialist: {
            kind: "bootstrap_repo_explorer",
            name: `Repository Bootstrap Explorer ${index + 1}`,
            rolePrompt: [
              "You are a dedicated repository exploration subagent used during specialist bootstrap.",
              "You are not the final specialist. Your job is to inspect the repo for one focused workstream and return distilled bootstrap knowledge.",
              "Use repo tools aggressively enough to verify architecture, conventions, relevant modules, and project-specific constraints.",
              "Return ONLY valid JSON with keys: summary, findings, tags, citations.",
              "findings and tags must be arrays of strings. citations should include file: paths when possible.",
            ].join("\n\n"),
            goals: [
              "Produce distilled, repo-grounded bootstrap knowledge.",
              `Focus on the assigned workstream: ${workstream.label}.`,
            ],
            nonGoals: ["Do not use web tools.", "Do not produce final specialist instructions.", "Return JSON only."],
            outputContract: { type: "json_object", requiredKeys: ["summary", "findings", "tags", "citations"] },
          },
          task: {
            question: workstream.question,
            taskBrief: [
              `Bootstrap workstream: ${workstream.label}`,
              workstream.rationale ? `Rationale: ${workstream.rationale}` : undefined,
              `Static bootstrap summary: ${staticSummary}`,
            ]
              .filter((value): value is string => Boolean(value && value.trim()))
              .join("\n"),
            constraints: [
              ...(input.constraints ?? []),
              "Repository grounding only.",
              "Verify with repo tools, not guesses.",
              "Return valid JSON only.",
            ],
            assumptions: [],
            responseFormat: "json",
            groundingMode: "repo_only",
          },
          memory: [],
          artifacts: [],
          workspaceObservations: anchorObservations,
          capabilities: {
            repoTools: true,
            webSearch: false,
            webResearch: false,
            webFetch: false,
            fileAuthoring: false,
          },
        };
        const result = await engine.run(request);
        return normalizeBootstrapPass(`Repository bootstrap pass: ${workstream.label}`, result);
      } catch {
        return undefined;
      }
    }),
  );
  return reports.filter((report): report is BootstrapPassReport => Boolean(report));
}

async function maybeRunWebBootstrapPasses(
  input: BootstrapSpecialistInput,
  plan: BootstrapPlan,
  anchorObservations: WorkspaceObservation[],
  staticSummary: string,
): Promise<BootstrapPassReport[]> {
  const engine = input.engines?.webResearcher ?? input.engines?.planner ?? input.engines?.fallback;
  if (!engine || !input.template.capabilities.webResearch || !plan.useWebResearch) {
    return [];
  }
  const workstreams = plan.webWorkstreams.slice(0, 3);
  const reports = await Promise.all(
    workstreams.map(async (workstream, index) => {
      try {
        const request: SpecialistExecutionRequest = {
          workspaceId: input.workspace.id,
          workspaceRoot: input.workspace.rootPath,
          workspaceDisplayName: input.workspace.displayName,
          specialist: {
            kind: "bootstrap_web_researcher",
            name: `Web Bootstrap Researcher ${index + 1}`,
            rolePrompt: [
              "You are a dedicated web bootstrap researcher used during specialist bootstrap.",
              "You are not the final specialist. Your job is to identify the official/current external knowledge needed for one focused workstream.",
              "Use web_research first. Use web_fetch for exact page validation if a specific source matters.",
              "Return ONLY valid JSON with keys: summary, findings, tags, citations.",
            ].join("\n\n"),
            goals: [
              "Surface authoritative external references and ecosystem facts relevant to the assigned workstream.",
              `Focus on the assigned workstream: ${workstream.label}.`,
            ],
            nonGoals: ["Do not do generic broad browsing.", "Do not duplicate repo-only findings unless they matter externally.", "Return JSON only."],
            outputContract: { type: "json_object", requiredKeys: ["summary", "findings", "tags", "citations"] },
          },
          task: {
            question: workstream.question,
            taskBrief: [
              `Bootstrap workstream: ${workstream.label}`,
              workstream.rationale ? `Rationale: ${workstream.rationale}` : undefined,
              `Static workspace summary: ${staticSummary}`,
            ]
              .filter((value): value is string => Boolean(value && value.trim()))
              .join("\n"),
            constraints: [
              ...(input.constraints ?? []),
              "Prefer official docs, specifications, release notes, and maintainer sources.",
              "Return valid JSON only.",
            ],
            assumptions: [],
            responseFormat: "json",
            groundingMode: "web_only",
          },
          memory: [],
          artifacts: [],
          workspaceObservations: anchorObservations,
          capabilities: {
            repoTools: false,
            webSearch: true,
            webResearch: true,
            webFetch: true,
            fileAuthoring: false,
          },
        };
        const result = await engine.run(request);
        return normalizeBootstrapPass(`Web bootstrap pass: ${workstream.label}`, result);
      } catch {
        return undefined;
      }
    }),
  );
  return reports.filter((report): report is BootstrapPassReport => Boolean(report));
}

async function maybeRunBootstrapValidationPass(
  input: BootstrapSpecialistInput,
  plan: BootstrapPlan,
  anchorObservations: WorkspaceObservation[],
  repoPasses: BootstrapPassReport[],
  webPasses: BootstrapPassReport[],
  staticSummary: string,
): Promise<BootstrapPassReport | undefined> {
  const engine = input.engines?.validator ?? input.engines?.planner ?? input.engines?.fallback;
  if (!engine || plan.validationFocus.length === 0) {
    return undefined;
  }
  try {
    const artifacts = [
      ...repoPasses.map((pass, index) => passToArtifactSnippet(`repo-pass-${index + 1}`, pass)),
      ...webPasses.map((pass, index) => passToArtifactSnippet(`web-pass-${index + 1}`, pass)),
    ];
    const request: SpecialistExecutionRequest = {
      workspaceId: input.workspace.id,
      workspaceRoot: input.workspace.rootPath,
      workspaceDisplayName: input.workspace.displayName,
      specialist: {
        kind: "bootstrap_validator",
        name: "Bootstrap Claim Validator",
        rolePrompt: [
          "You are a bootstrap claim validator, not the final specialist.",
          "Review the repo/web bootstrap findings and validate the most important claims or assumptions before the specialist profile is finalized.",
          "Use repository tools and web tools as needed to validate critical claims. Prefer exact verification over broad summarization.",
          "Return ONLY valid JSON with keys: summary, findings, tags, citations.",
          "Each finding should describe a validated claim, a rejected claim, or an uncertainty that must remain explicit.",
        ].join("\n\n"),
        goals: [
          "Validate the highest-impact bootstrap claims.",
          "Make the final specialist profile safer and more truthful.",
        ],
        nonGoals: ["Do not generate the final specialist profile.", "Do not leave important uncertainty unstated.", "Return JSON only."],
        outputContract: { type: "json_object", requiredKeys: ["summary", "findings", "tags", "citations"] },
      },
      task: {
        question: `Validate critical bootstrap claims for the ${input.template.name}.`,
        taskBrief: [
          `Static workspace summary: ${staticSummary}`,
          ...plan.validationFocus.map((item, index) => `Validation target ${index + 1}: ${item}`),
        ]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join("\n"),
        constraints: [
          ...(input.constraints ?? []),
          "Validate what matters most for final specialist quality.",
          "Keep uncertainties explicit when a claim cannot be fully verified.",
          "Return valid JSON only.",
        ],
        assumptions: [],
        responseFormat: "json",
        groundingMode: input.template.capabilities.repoTools && input.template.capabilities.webResearch ? "repo_and_web" : input.template.capabilities.repoTools ? "repo_only" : input.template.capabilities.webResearch ? "web_only" : "memory_only",
      },
      memory: [],
      artifacts,
      workspaceObservations: anchorObservations,
      capabilities: {
        repoTools: input.template.capabilities.repoTools,
        webSearch: input.template.capabilities.webResearch,
        webResearch: input.template.capabilities.webResearch,
        webFetch: input.template.capabilities.webFetch,
        fileAuthoring: false,
      },
    };
    const result = await engine.run(request);
    return normalizeBootstrapPass("Bootstrap validation pass", result);
  } catch {
    return undefined;
  }
}

async function maybeRunBootstrapSynthesis(
  input: BootstrapSpecialistInput,
  plan: BootstrapPlan,
  anchorObservations: WorkspaceObservation[],
  repoPasses: BootstrapPassReport[],
  webPasses: BootstrapPassReport[],
  validationPass: BootstrapPassReport | undefined,
  staticSummary: string,
): Promise<BootstrapSynthesisDraft | undefined> {
  const engine = input.engines?.synthesizer ?? input.engines?.planner ?? input.engines?.fallback;
  if (!engine) {
    return undefined;
  }
  try {
    const artifacts: ArtifactSnippet[] = [
      ...repoPasses.map((value, index) => passToArtifactSnippet(`bootstrap-repo-pass-${index + 1}`, value)),
      ...webPasses.map((value, index) => passToArtifactSnippet(`bootstrap-web-pass-${index + 1}`, value)),
    ];
    if (validationPass) {
      artifacts.push(passToArtifactSnippet("bootstrap-validation", validationPass));
    }
    artifacts.push({
      id: "bootstrap-plan",
      title: "Bootstrap investigation plan",
      summary: [
        `Use repo exploration: ${String(plan.useRepoExplorer)}`,
        `Use web research: ${String(plan.useWebResearch)}`,
        ...plan.profileFocus,
        ...plan.notes,
      ].join(" "),
      citations: [],
      tags: ["bootstrap-plan"],
    });

    const request: SpecialistExecutionRequest = {
      workspaceId: input.workspace.id,
      workspaceRoot: input.workspace.rootPath,
      workspaceDisplayName: input.workspace.displayName,
      specialist: {
        kind: "bootstrap_synthesizer",
        name: "Specialist Bootstrap Synthesizer",
        rolePrompt: [
          "You are a dedicated bootstrap synthesizer, not the final specialist.",
          "Use the provided bootstrap plan plus repo/web investigation outputs and validation results to produce the best possible workspace-specific specialist profile draft.",
          "The final profile should be specific enough that the specialist succeeds later without becoming brittle or overfit.",
          "Return ONLY valid JSON with keys: name, rolePrompt, goals, nonGoals, tags, workspaceContextSummary, bootstrapNotes.",
          "goals, nonGoals, tags, and bootstrapNotes must be arrays of strings.",
        ].join("\n\n"),
        goals: ["Generate a strong specialist profile that will make later consultations succeed."],
        nonGoals: ["Do not call tools.", "Do not answer future specialist tasks.", "Return JSON only."],
        outputContract: {
          type: "json_object",
          requiredKeys: ["rolePrompt", "goals", "nonGoals", "tags", "workspaceContextSummary", "bootstrapNotes"],
        },
      },
      task: {
        question: `Synthesize the final ${input.template.name} profile for this workspace.`,
        taskBrief: [
          `Template description: ${input.template.description}`,
          `Static workspace summary: ${staticSummary}`,
          plan.profileFocus.length > 0 ? `Required profile focus: ${plan.profileFocus.join("; ")}` : undefined,
          input.question ? `Initial specialist request: ${input.question}` : undefined,
        ]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join("\n"),
        constraints: [
          ...(input.constraints ?? []),
          "Optimize for specialist success in later consultations.",
          "Make the prompt workspace-specific and grounded.",
          "Preserve important uncertainty instead of hiding it.",
          "Return valid JSON only.",
        ],
        assumptions: [],
        responseFormat: "json",
        groundingMode: "memory_only",
      },
      memory: [],
      artifacts,
      workspaceObservations: anchorObservations,
      capabilities: {
        repoTools: false,
        webSearch: false,
        webResearch: false,
        webFetch: false,
        fileAuthoring: false,
      },
    };
    const result = await engine.run(request);
    return normalizeBootstrapSynthesis(result);
  } catch {
    return undefined;
  }
}

function normalizeBootstrapPass(title: string, result: SpecialistExecutionResult): BootstrapPassReport {
  const parsed = parseJsonObject(result.answer);
  return {
    title,
    summary: readString(parsed?.summary) || extractAnswerSummary(result.answer),
    findings: readStringArray(parsed?.findings),
    tags: unique([...(readStringArray(parsed?.tags)), ...readTagsFromText(result.answer)]).slice(0, 12),
    citations: unique([...(readStringArray(parsed?.citations)), ...result.citations]).slice(0, 20),
    rawText: result.answer,
  };
}

function normalizeBootstrapSynthesis(result: SpecialistExecutionResult): BootstrapSynthesisDraft | undefined {
  const parsed = parseJsonObject(result.answer);
  if (!parsed) {
    return undefined;
  }
  return {
    name: readString(parsed.name),
    rolePrompt: readString(parsed.rolePrompt),
    goals: readStringArray(parsed.goals),
    nonGoals: readStringArray(parsed.nonGoals),
    tags: readStringArray(parsed.tags),
    workspaceContextSummary: readString(parsed.workspaceContextSummary),
    bootstrapNotes: readStringArray(parsed.bootstrapNotes),
  };
}

function normalizeWorkstreams(value: unknown, fallback: BootstrapWorkstream[], limit: number): BootstrapWorkstream[] {
  if (!Array.isArray(value)) {
    return fallback.slice(0, limit);
  }
  const normalized: BootstrapWorkstream[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const label = readString(record.label);
    const question = readString(record.question);
    if (!label || !question) {
      continue;
    }
    normalized.push({
      label,
      question,
      rationale: readString(record.rationale),
    });
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized.length > 0 ? normalized : fallback.slice(0, limit);
}

function passToArtifactSnippet(id: string, pass: BootstrapPassReport): ArtifactSnippet {
  return {
    id,
    title: pass.title,
    summary: [pass.summary, ...pass.findings.slice(0, 4)].filter(Boolean).join(" "),
    citations: pass.citations,
    tags: pass.tags,
  };
}

function mergeBootstrapObservations(
  anchorObservations: WorkspaceObservation[],
  repoPasses: BootstrapPassReport[],
  webPasses: BootstrapPassReport[],
  validationPass: BootstrapPassReport | undefined,
): WorkspaceObservation[] {
  const derived: WorkspaceObservation[] = [];
  for (const pass of repoPasses) {
    derived.push({
      source: "repo",
      label: `bootstrap/${pass.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      detail: [pass.summary, ...pass.findings.slice(0, 6)].join("\n- "),
      citations: pass.citations,
      tags: pass.tags,
    });
  }
  for (const pass of webPasses) {
    derived.push({
      source: "web",
      label: `bootstrap/${pass.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      detail: [pass.summary, ...pass.findings.slice(0, 6)].join("\n- "),
      citations: pass.citations,
      tags: pass.tags,
    });
  }
  if (validationPass) {
    derived.push({
      source: validationPass.citations.some((value) => value.startsWith("file:")) ? "repo" : "web",
      label: "bootstrap/validation-pass",
      detail: [validationPass.summary, ...validationPass.findings.slice(0, 6)].join("\n- "),
      citations: validationPass.citations,
      tags: validationPass.tags,
    });
  }

  const merged: WorkspaceObservation[] = [];
  const seen = new Set<string>();
  for (const collection of [anchorObservations, derived]) {
    for (const observation of collection) {
      const key = `${observation.source}:${observation.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(observation);
      if (merged.length >= 12) return merged;
    }
  }
  return merged;
}

function buildSynthesizedSummary(
  staticSummary: string,
  repoSummary: string | undefined,
  webSummary: string | undefined,
  validationSummary: string | undefined,
  plan: BootstrapPlan,
): string {
  return [staticSummary, repoSummary, webSummary, validationSummary, ...plan.profileFocus]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ");
}

function summarizePasses(passes: BootstrapPassReport[]): string | undefined {
  if (passes.length === 0) {
    return undefined;
  }
  return passes.map((pass) => `${pass.title}: ${pass.summary}`).join(" ");
}

function collectFindings(passes: BootstrapPassReport[], limitPerPass: number): string[] {
  return passes.flatMap((pass) => pass.findings.slice(0, limitPerPass));
}

function collectCitations(passes: BootstrapPassReport[]): string[] {
  return passes.flatMap((pass) => pass.citations);
}

function compactBootstrapNotes(values: string[], limit: number = 12): string[] {
  const cleaned = unique(
    values
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.replace(/\s+/g, " ")),
  );

  const sorted = cleaned.sort((left, right) => scoreBootstrapNote(right) - scoreBootstrapNote(left));
  return sorted.slice(0, limit);
}

function scoreBootstrapNote(value: string): number {
  let score = 0;
  if (value.startsWith("Verified now:")) score += 4;
  if (value.startsWith("Inference/recommendation:")) score += 2;
  if (value.startsWith("Prior context:")) score += 1;
  score -= Math.max(0, value.length - 220) / 200;
  return score;
}

function defaultBootstrapPlan(
  template: SpecialistTemplate,
  question: string | undefined,
  taskBrief: string | undefined,
  constraints: string[],
): BootstrapPlan {
  const repoWorkstreams: BootstrapWorkstream[] = [
    {
      label: "repository architecture",
      question: `What parts of this repository are most relevant to ${template.name}, and what architecture/conventions should it know?`,
      rationale: "The final specialist prompt must be grounded in the actual workspace structure and conventions.",
    },
  ];
  if (question) {
    repoWorkstreams.push({
      label: "request-specific repo context",
      question: `What repository evidence matters most for this initial bootstrap request: ${question}`,
      rationale: "The initiating request often reveals what the specialist must be optimized for.",
    });
  }

  const webWorkstreams: BootstrapWorkstream[] = [
    {
      label: "official external references",
      question: `What official/current external references should ${template.name} rely on?`,
      rationale: "The specialist should know the best external sources before later consultations.",
    },
  ];
  if (taskBrief || constraints.length > 0) {
    webWorkstreams.push({
      label: "request-specific external context",
      question: [taskBrief ?? "", ...constraints].filter(Boolean).join(" "),
      rationale: "The initial bootstrap intent may imply technologies or docs the specialist should track externally.",
    });
  }

  return {
    useRepoExplorer: template.capabilities.repoTools,
    useWebResearch: template.capabilities.webResearch,
    repoWorkstreams,
    webWorkstreams,
    validationFocus: unique([
      "Validate the highest-impact architectural and workflow claims that will shape the final specialist prompt.",
      question || "",
      taskBrief || "",
    ]),
    profileFocus: unique([template.description, question || "", taskBrief || ""]),
    notes: ["Bootstrap should optimize the specialist prompt for future consultation quality."],
  };
}

async function collectCandidateFiles(workspaceRoot: string, maxFiles: number): Promise<string[]> {
  const collected: string[] = [];
  const seen = new Set<string>();

  for (const relativePath of ANCHOR_FILE_NAMES) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    try {
      const fileStats = await stat(absolutePath);
      if (fileStats.isFile()) {
        seen.add(absolutePath);
        collected.push(absolutePath);
      }
    } catch {
      // Ignore missing anchors.
    }
  }

  const queue = [workspaceRoot];
  while (queue.length > 0 && collected.length < maxFiles) {
    const current = queue.shift();
    if (!current) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (shouldSkipFile(entry.name)) {
        continue;
      }
      if (!seen.has(absolutePath)) {
        seen.add(absolutePath);
        collected.push(absolutePath);
        if (collected.length >= maxFiles) {
          break;
        }
      }
    }
  }

  return collected;
}

function shouldSkipFile(fileName: string): boolean {
  if (
    fileName.startsWith(".") &&
    !fileName.endsWith(".md") &&
    !fileName.endsWith(".json") &&
    !fileName.endsWith(".toml") &&
    !fileName.endsWith(".yaml") &&
    !fileName.endsWith(".yml")
  ) {
    return true;
  }
  const extension = path.extname(fileName).toLowerCase();
  return Boolean(extension) && !PREFERRED_EXTENSIONS.has(extension);
}

async function buildObservation(
  workspaceRoot: string,
  filePath: string,
  queryTerms: Set<string>,
): Promise<WorkspaceObservation | undefined> {
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    return undefined;
  }
  if (!fileStats.isFile() || fileStats.size > 200_000) {
    return undefined;
  }
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
  if (content.includes("\u0000")) {
    return undefined;
  }
  const relativePath = path.relative(workspaceRoot, filePath) || path.basename(filePath);
  const snippet = selectSnippet(content, queryTerms);
  const detail = [`Path: ${relativePath}`, snippet ? `Snippet:\n${snippet}` : undefined]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  return {
    source: "repo",
    label: relativePath,
    detail,
    citations: [`file:${relativePath}`],
    tags: ["bootstrap"],
  };
}

function selectSnippet(content: string, queryTerms: Set<string>): string | undefined {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return undefined;
  let bestIndex = 0;
  let bestScore = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const overlap = countOverlap(tokenize(line), queryTerms);
    if (overlap > bestScore) {
      bestScore = overlap;
      bestIndex = index;
    }
  }
  const start = Math.max(0, bestIndex - 2);
  const end = Math.min(lines.length, bestIndex + 3);
  const window = lines.slice(start, end);
  if (window.every((line) => !line.trim())) {
    const fallback = lines.slice(0, 5);
    return fallback.length > 0
      ? fallback.map((line, index) => `${index + 1}: ${formatSnippetLine(line)}`).join("\n")
      : undefined;
  }
  return window.map((line, index) => `${start + index + 1}: ${formatSnippetLine(line)}`).join("\n");
}

function formatSnippetLine(line: string, maxLength: number = 320): string {
  if (line.length <= maxLength) {
    return line;
  }
  return `${line.slice(0, maxLength - 1)}…`;
}

function scoreObservation(observation: WorkspaceObservation, queryTerms: Set<string>): number {
  const labelTerms = tokenize(observation.label);
  const detailTerms = tokenize(observation.detail.slice(0, 4000));
  const extension = path.extname(observation.label).toLowerCase();
  const anchorBonus = ANCHOR_FILE_NAMES.includes(path.basename(observation.label)) ? 20 : 0;
  const extensionBonus = PREFERRED_EXTENSIONS.has(extension) ? 5 : 0;
  return countOverlap(labelTerms, queryTerms) * 10 + countOverlap(detailTerms, queryTerms) * 3 + anchorBonus + extensionBonus;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2),
  );
}

function countOverlap(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  for (const value of left) {
    if (right.has(value)) {
      overlap += 1;
    }
  }
  return overlap;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function readTagsFromText(text: string): string[] {
  return Array.from(tokenize(text)).slice(0, 8);
}

function mergeStrings(primary: string[] | undefined, fallback: string[]): string[] {
  return unique([...(primary ?? []), ...fallback]).slice(0, 12);
}

function unique(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  );
}
