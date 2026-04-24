import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ArtifactSnippet, MemorySnippet, SpecialistExecutionRequest, SpecialistExecutionResult } from "@specialists/shared";

import { extractAnswerSummary } from "./json.js";
import type { WorkspaceRecord } from "./workspace.js";

interface PersistedMemoryRecord {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  specialistId: string;
  title: string;
  summary: string;
  citations: string[];
  tags: string[];
  validated: boolean;
  question: string;
  createdAt: string;
  sourceConsultationId: string;
}

interface PersistedArtifactRecord {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  specialistId: string;
  title: string;
  summary: string;
  citations: string[];
  tags: string[];
  question: string;
  answer: string;
  createdAt: string;
  sourceConsultationId: string;
}

export async function retrieveRelevantMemory(
  workspace: WorkspaceRecord,
  specialistId: string,
  queries: string[],
  limit: number = 4,
): Promise<MemorySnippet[]> {
  const records = await loadRecords<PersistedMemoryRecord>(path.join(workspace.memoryDir, sanitizeName(specialistId)));
  return records
    .map((record) => ({ score: scoreRecord(queries, [record.title, record.summary, ...record.tags]), record }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.record.createdAt.localeCompare(left.record.createdAt))
    .slice(0, limit)
    .map(({ record }) => ({
      id: record.id,
      title: record.title,
      summary: record.summary,
      citations: record.citations,
      tags: record.tags,
      validated: record.validated,
    }));
}

export async function retrieveRelevantArtifacts(
  workspace: WorkspaceRecord,
  specialistId: string,
  queries: string[],
  limit: number = 3,
): Promise<ArtifactSnippet[]> {
  const records = await loadRecords<PersistedArtifactRecord>(path.join(workspace.artifactsDir, sanitizeName(specialistId)));
  return records
    .map((record) => ({ score: scoreRecord(queries, [record.title, record.summary, ...record.tags]), record }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.record.createdAt.localeCompare(left.record.createdAt))
    .slice(0, limit)
    .map(({ record }) => ({
      id: record.id,
      title: record.title,
      summary: record.summary,
      citations: record.citations,
      tags: record.tags,
    }));
}

export async function persistConsultationKnowledge(input: {
  workspace: WorkspaceRecord;
  consultationId: string;
  request: SpecialistExecutionRequest;
  result: SpecialistExecutionResult;
}): Promise<{ memoryId: string; artifactId: string }> {
  const { workspace, consultationId, request, result } = input;
  const specialistDirName = sanitizeName(request.specialist.id);
  const memoryDir = path.join(workspace.memoryDir, specialistDirName);
  const artifactDir = path.join(workspace.artifactsDir, specialistDirName);
  await mkdir(memoryDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const titleBase = request.task.question.trim().replace(/\s+/g, " ").slice(0, 100) || request.specialist.name;
  const summary = extractAnswerSummary(result.answer);
  const tags = unique([...(request.specialist.tags ?? []), request.specialist.id, ...extractTags(request.task.question)]).slice(0, 10);

  const memoryRecord: PersistedMemoryRecord = {
    schemaVersion: 1,
    id: randomUUID(),
    workspaceId: workspace.id,
    specialistId: request.specialist.id,
    title: `${request.specialist.name}: ${titleBase}`,
    summary,
    citations: result.citations.slice(0, 12),
    tags,
    validated: result.citations.length > 0 || result.toolActivity.length > 0,
    question: request.task.question,
    createdAt: timestamp,
    sourceConsultationId: consultationId,
  };

  const artifactRecord: PersistedArtifactRecord = {
    schemaVersion: 1,
    id: randomUUID(),
    workspaceId: workspace.id,
    specialistId: request.specialist.id,
    title: `${request.specialist.name} packet: ${titleBase}`,
    summary,
    citations: result.citations.slice(0, 20),
    tags,
    question: request.task.question,
    answer: result.answer,
    createdAt: timestamp,
    sourceConsultationId: consultationId,
  };

  await writeFile(
    path.join(memoryDir, `${timestamp.replace(/[:.]/g, "-")}-${memoryRecord.id}.json`),
    `${JSON.stringify(memoryRecord, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(artifactDir, `${timestamp.replace(/[:.]/g, "-")}-${artifactRecord.id}.json`),
    `${JSON.stringify(artifactRecord, null, 2)}\n`,
    "utf8",
  );

  return { memoryId: memoryRecord.id, artifactId: artifactRecord.id };
}

async function loadRecords<T>(dirPath: string): Promise<T[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dirPath);
  } catch {
    return [];
  }
  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        try {
          const content = await readFile(path.join(dirPath, entry), "utf8");
          return JSON.parse(content) as T;
        } catch {
          return undefined;
        }
      }),
  );
  const filtered: T[] = [];
  for (const record of records) {
    if (record !== undefined) {
      filtered.push(record);
    }
  }
  return filtered;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

function scoreRecord(queries: string[], fields: string[]): number {
  const queryTerms = tokenize(queries.join(" "));
  const recordTerms = tokenize(fields.join(" "));
  let overlap = 0;
  for (const term of queryTerms) {
    if (recordTerms.has(term)) overlap += 1;
  }
  return overlap;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3),
  );
}

function extractTags(question: string): string[] {
  return Array.from(tokenize(question)).slice(0, 6);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
