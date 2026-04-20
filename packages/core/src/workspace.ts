import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface WorkspaceRecord {
  id: string;
  displayName: string;
  rootPath: string;
  stateDir: string;
  profilesDir: string;
  consultationsDir: string;
  memoryDir: string;
  artifactsDir: string;
  outputDir: string;
  workspaceFilePath: string;
}

interface PersistedWorkspaceRecord {
  id: string;
  displayName: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export async function resolveWorkspace(startDir: string = process.cwd()): Promise<WorkspaceRecord> {
  const rootPath = resolveWorkspaceRoot(startDir);
  const stateDir = path.join(rootPath, ".specialists");
  const profilesDir = path.join(stateDir, "profiles");
  const consultationsDir = path.join(stateDir, "consultations");
  const memoryDir = path.join(stateDir, "memory");
  const artifactsDir = path.join(stateDir, "artifacts");
  const outputDir = path.join(stateDir, "out");
  const workspaceFilePath = path.join(stateDir, "workspace.json");

  await mkdir(profilesDir, { recursive: true });
  await mkdir(consultationsDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const now = new Date().toISOString();
  const fallbackRecord: PersistedWorkspaceRecord = {
    id: computeWorkspaceId(rootPath),
    displayName: path.basename(rootPath),
    rootPath,
    createdAt: now,
    updatedAt: now,
  };
  const persisted = (await readJsonFile<PersistedWorkspaceRecord>(workspaceFilePath)) ?? fallbackRecord;
  const nextRecord: PersistedWorkspaceRecord = {
    ...persisted,
    rootPath,
    displayName: persisted.displayName || path.basename(rootPath),
    id: persisted.id || computeWorkspaceId(rootPath),
    updatedAt: now,
    createdAt: persisted.createdAt || now,
  };
  await writeFile(workspaceFilePath, `${JSON.stringify(nextRecord, null, 2)}\n`, "utf8");

  return {
    id: nextRecord.id,
    displayName: nextRecord.displayName,
    rootPath,
    stateDir,
    profilesDir,
    consultationsDir,
    memoryDir,
    artifactsDir,
    outputDir,
    workspaceFilePath,
  };
}

export function resolveWorkspaceRoot(startDir: string = process.cwd()): string {
  const absoluteStart = path.resolve(startDir);
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: absoluteStart,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (git.status === 0) {
    const value = git.stdout.trim();
    if (value) {
      return path.resolve(value);
    }
  }
  return absoluteStart;
}

function computeWorkspaceId(rootPath: string): string {
  return createHash("sha1").update(path.resolve(rootPath)).digest("hex").slice(0, 16);
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}
