import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SpecialistExecutionRequest, SpecialistExecutionResult, SpecialistProfileSnapshot, WorkspaceObservation } from "@specialists/shared";

import type { SpecialistTemplate } from "./templates.js";
import type { WorkspaceRecord } from "./workspace.js";

export interface WorkspaceSpecialistProfile {
  schemaVersion: 1;
  workspaceId: string;
  specialistId: string;
  template: SpecialistTemplate;
  snapshot: SpecialistProfileSnapshot;
  workspaceContextSummary: string;
  bootstrapObservations: WorkspaceObservation[];
  bootstrapQuery: string;
  bootstrapRepoSummary?: string;
  bootstrapWebSummary?: string;
  bootstrapValidationSummary?: string;
  bootstrapNotes?: string[];
  bootstrapCitations?: string[];
  createdAt: string;
  updatedAt: string;
  lastConsultedAt?: string;
  lastQuestion?: string;
  lastAnswerPreview?: string;
}

export interface ConsultationRecord {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  workspaceId: string;
  specialistId: string;
  request: SpecialistExecutionRequest;
  result: SpecialistExecutionResult;
}

export async function loadWorkspaceSpecialistProfile(
  workspace: WorkspaceRecord,
  specialistId: string,
): Promise<WorkspaceSpecialistProfile | undefined> {
  const filePath = getProfilePath(workspace, specialistId);
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as WorkspaceSpecialistProfile;
  } catch {
    return undefined;
  }
}

export async function saveWorkspaceSpecialistProfile(
  workspace: WorkspaceRecord,
  profile: WorkspaceSpecialistProfile,
): Promise<string> {
  const filePath = getProfilePath(workspace, profile.specialistId);
  await writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return filePath;
}

export async function saveConsultationRecord(
  workspace: WorkspaceRecord,
  record: ConsultationRecord,
): Promise<string> {
  const safeId = record.specialistId.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  const filePath = path.join(
    workspace.consultationsDir,
    `${record.createdAt.replace(/[:.]/g, "-")}-${safeId}.json`,
  );
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return filePath;
}

function getProfilePath(workspace: WorkspaceRecord, specialistId: string): string {
  const safeId = specialistId.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  return path.join(workspace.profilesDir, `${safeId}.json`);
}
