import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  GroundingMode,
  SpecialistExecutionRequest,
  SpecialistExecutionResult,
  ConsultationTask,
  WorkspaceObservation,
} from "@specialists/shared";

import {
  bootstrapSpecialist,
  buildWorkspaceContextSummary,
  inspectWorkspace,
  type BootstrapExecutionEngine,
  type BootstrapExecutionEngines,
  type BootstrapSpecialistResult,
} from "./bootstrap.js";
import { persistConsultationKnowledge, retrieveRelevantArtifacts, retrieveRelevantMemory } from "./knowledge.js";
import {
  loadWorkspaceSpecialistProfile,
  saveConsultationRecord,
  saveWorkspaceSpecialistProfile,
  type WorkspaceSpecialistProfile,
} from "./store.js";
import { resolveSpecialistTemplate, type SpecialistTemplate } from "./templates.js";
import { resolveWorkspace, type WorkspaceRecord } from "./workspace.js";

export interface SpecialistExecutionEngine {
  run(request: SpecialistExecutionRequest): Promise<SpecialistExecutionResult>;
}

export interface ConsultationPipelineDependencies {
  consultationEngine: SpecialistExecutionEngine;
  bootstrapEngines?: BootstrapExecutionEngines;
}

export interface BootstrapRequest {
  workspaceRoot?: string;
  specialistKind: string;
  question?: string;
  taskBrief?: string;
  constraints?: string[];
  force?: boolean;
}

export interface WorkspaceConsultationRequest {
  workspaceRoot?: string;
  specialistKind: string;
  question: string;
  taskBrief?: string;
  constraints?: string[];
  assumptions?: string[];
  responseFormat?: ConsultationTask["responseFormat"];
  groundingMode?: GroundingMode;
  forceBootstrap?: boolean;
}

export interface ConsultationPipelineResolution {
  workspace: WorkspaceRecord;
  template: SpecialistTemplate;
  profile: WorkspaceSpecialistProfile;
  bootstrap: BootstrapSpecialistResult | undefined;
  executionRequest: SpecialistExecutionRequest;
}

export interface WorkspaceConsultationOutcome extends ConsultationPipelineResolution {
  executionResult: SpecialistExecutionResult;
  consultationRecordPath: string;
}

export interface ConsultationPipeline {
  bootstrap(request: BootstrapRequest): Promise<BootstrapSpecialistResult>;
  resolve(request: WorkspaceConsultationRequest): Promise<ConsultationPipelineResolution>;
  execute(request: SpecialistExecutionRequest): Promise<SpecialistExecutionResult>;
  finalize(resolution: ConsultationPipelineResolution, result: SpecialistExecutionResult): Promise<WorkspaceConsultationOutcome>;
  consult(request: WorkspaceConsultationRequest): Promise<WorkspaceConsultationOutcome>;
}

export function createConsultationPipeline(
  input: SpecialistExecutionEngine | ConsultationPipelineDependencies,
): ConsultationPipeline {
  const dependencies = normalizeDependencies(input);
  const bootstrapEngines = withBootstrapFallbacks(dependencies.bootstrapEngines, dependencies.consultationEngine);

  return {
    async bootstrap(request) {
      const workspace = await resolveWorkspace(request.workspaceRoot);
      const template = (await resolveSpecialistTemplate(workspace, request.specialistKind)).template;
      return await bootstrapSpecialist({
        workspace,
        template,
        question: request.question,
        taskBrief: request.taskBrief,
        constraints: request.constraints,
        force: request.force,
        engines: bootstrapEngines,
      });
    },

    async resolve(request) {
      const workspace = await resolveWorkspace(request.workspaceRoot);
      const template = (await resolveSpecialistTemplate(workspace, request.specialistKind)).template;
      let profile = await loadWorkspaceSpecialistProfile(workspace, template.kind);
      let bootstrapResult: BootstrapSpecialistResult | undefined;
      if (request.forceBootstrap) {
        bootstrapResult = await bootstrapSpecialist({
          workspace,
          template,
          question: request.question,
          taskBrief: request.taskBrief,
          constraints: request.constraints,
          force: true,
          engines: bootstrapEngines,
        });
        profile = bootstrapResult.profile;
      }
      if (!profile) {
        throw new Error(
          `Specialist ${JSON.stringify(template.kind)} exists but is not bootstrapped for this workspace. Bootstrap it with the operator CLI before consulting it.`,
        );
      }

      const executionRequest = await buildExecutionRequest({
        workspace,
        template,
        profile,
        request,
      });

      return {
        workspace,
        template,
        profile,
        bootstrap: bootstrapResult,
        executionRequest,
      };
    },

    async execute(request) {
      return await dependencies.consultationEngine.run(request);
    },

    async finalize(resolution, result) {
      const now = new Date().toISOString();
      const nextProfile: WorkspaceSpecialistProfile = {
        ...resolution.profile,
        updatedAt: now,
        lastConsultedAt: now,
        lastQuestion: resolution.executionRequest.task.question,
        lastAnswerPreview: result.answer.slice(0, 1000),
      };
      await saveWorkspaceSpecialistProfile(resolution.workspace, nextProfile);
      const consultationId = randomUUID();
      const consultationRecordPath = await saveConsultationRecord(resolution.workspace, {
        schemaVersion: 1,
        id: consultationId,
        createdAt: now,
        workspaceId: resolution.workspace.id,
        specialistKind: resolution.profile.specialistKind,
        request: resolution.executionRequest,
        result,
      });
      await persistConsultationKnowledge({
        workspace: resolution.workspace,
        consultationId,
        request: resolution.executionRequest,
        result,
      });
      return {
        ...resolution,
        profile: nextProfile,
        executionResult: result,
        consultationRecordPath,
      };
    },

    async consult(request) {
      const resolution = await this.resolve(request);
      const result = await this.execute(resolution.executionRequest);
      return await this.finalize(resolution, result);
    },
  };
}

async function buildExecutionRequest(input: {
  workspace: WorkspaceRecord;
  template: SpecialistTemplate;
  profile: WorkspaceSpecialistProfile;
  request: WorkspaceConsultationRequest;
}): Promise<SpecialistExecutionRequest> {
  const groundingMode = input.request.groundingMode ?? "repo_and_web";
  const liveWorkspaceObservations = requiresRepoGrounding(groundingMode)
    ? await inspectWorkspace(
        input.workspace.rootPath,
        [
          input.request.question,
          input.request.taskBrief,
          ...(input.request.constraints ?? []),
          ...(input.request.assumptions ?? []),
          input.template.kind,
          input.template.name,
        ]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join(" "),
        6,
      )
    : [];

  const workspaceObservations = mergeObservations(input.profile.bootstrapObservations, liveWorkspaceObservations);
  const knowledgeQueries = [
    input.request.question,
    input.request.taskBrief ?? "",
    ...(input.request.constraints ?? []),
    ...(input.request.assumptions ?? []),
    input.template.kind,
    input.template.name,
  ];
  const memory = await retrieveRelevantMemory(input.workspace, input.template.kind, knowledgeQueries);
  const artifacts = await retrieveRelevantArtifacts(input.workspace, input.template.kind, knowledgeQueries);

  const rolePrompt = buildResolvedRolePrompt(input.profile, workspaceObservations, input.workspace);
  const outputDirectory = input.template.capabilities.fileAuthoring
    ? path.join(input.workspace.outputDir, input.template.kind)
    : undefined;

  return {
    workspaceId: input.workspace.id,
    workspaceRoot: input.workspace.rootPath,
    workspaceDisplayName: input.workspace.displayName,
    specialist: {
      ...input.profile.snapshot,
      rolePrompt,
    },
    task: {
      question: input.request.question,
      taskBrief: input.request.taskBrief,
      constraints: input.request.constraints ?? [],
      assumptions: input.request.assumptions ?? [],
      responseFormat: input.request.responseFormat ?? "packet",
      groundingMode,
    },
    memory,
    artifacts,
    workspaceObservations,
    capabilities: capabilitiesForGroundingMode(input.template.capabilities, groundingMode),
    outputDirectory,
  };
}

function buildResolvedRolePrompt(
  profile: WorkspaceSpecialistProfile,
  observations: WorkspaceObservation[],
  workspace: WorkspaceRecord,
): string {
  const summary = buildWorkspaceContextSummary(workspace, profile.template, observations);
  return [
    profile.snapshot.rolePrompt,
    `Workspace-bound operating context: ${summary}`,
    `Persisted bootstrap summary: ${profile.workspaceContextSummary}`,
    profile.bootstrapRepoSummary ? `Bootstrap repo summary: ${profile.bootstrapRepoSummary}` : undefined,
    profile.bootstrapWebSummary ? `Bootstrap web summary: ${profile.bootstrapWebSummary}` : undefined,
    profile.bootstrapValidationSummary
      ? `Bootstrap validation summary: ${profile.bootstrapValidationSummary}`
      : undefined,
    profile.bootstrapNotes && profile.bootstrapNotes.length > 0
      ? `Bootstrap notes: ${profile.bootstrapNotes.join("; ")}`
      : undefined,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n\n");
}

function requiresRepoGrounding(groundingMode: GroundingMode): boolean {
  return groundingMode === "repo_only" || groundingMode === "repo_and_web";
}

function capabilitiesForGroundingMode(
  base: SpecialistTemplate["capabilities"],
  groundingMode: GroundingMode,
): SpecialistTemplate["capabilities"] {
  return {
    repoTools: base.repoTools && (groundingMode === "repo_only" || groundingMode === "repo_and_web"),
    webSearch: base.webSearch && (groundingMode === "web_only" || groundingMode === "repo_and_web"),
    webResearch: base.webResearch && (groundingMode === "web_only" || groundingMode === "repo_and_web"),
    webFetch: base.webFetch && (groundingMode === "web_only" || groundingMode === "repo_and_web"),
    fileAuthoring: base.fileAuthoring,
  };
}

function mergeObservations(...collections: WorkspaceObservation[][]): WorkspaceObservation[] {
  const merged: WorkspaceObservation[] = [];
  const seen = new Set<string>();
  for (const collection of collections) {
    for (const observation of collection) {
      const key = `${observation.source}:${observation.label}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(observation);
      if (merged.length >= 10) {
        return merged;
      }
    }
  }
  return merged;
}

function normalizeDependencies(
  input: SpecialistExecutionEngine | ConsultationPipelineDependencies,
): ConsultationPipelineDependencies {
  if (typeof (input as ConsultationPipelineDependencies).consultationEngine?.run === "function") {
    return input as ConsultationPipelineDependencies;
  }
  return { consultationEngine: input as SpecialistExecutionEngine };
}

function withBootstrapFallbacks(
  bootstrapEngines: BootstrapExecutionEngines | undefined,
  consultationEngine: BootstrapExecutionEngine,
): BootstrapExecutionEngines {
  return {
    ...bootstrapEngines,
    fallback: bootstrapEngines?.fallback ?? consultationEngine,
  };
}
