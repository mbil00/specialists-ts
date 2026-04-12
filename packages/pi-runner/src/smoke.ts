import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { createPiRunner } from "./runner.js";
import type { SpecialistExecutionRequest } from "@specialists/shared";

async function main(): Promise<void> {
  loadDotEnvFromAncestors();
  const args = parseArgs(process.argv.slice(2));
  const runner = createPiRunner();
  const request: SpecialistExecutionRequest = {
    workspaceId: "smoke-workspace",
    workspaceRoot: process.cwd(),
    workspaceDisplayName: path.basename(process.cwd()),
    specialist: {
      kind: args.specialistKind,
      name: args.specialistName,
      rolePrompt: args.rolePrompt,
      goals: ["Return compact, grounded specialist packets."],
      nonGoals: ["Do not pretend to verify what was not verified."],
      outputContract: {
        type: "consultant_packet",
        sections: ["summary", "details", "sources", "uncertainties"],
      },
    },
    task: {
      question: args.question,
      taskBrief: args.taskBrief,
      constraints: [],
      assumptions: [],
      responseFormat: "packet",
      groundingMode: args.groundingMode,
    },
    memory: [],
    artifacts: [],
    workspaceObservations: [],
    capabilities: {
      repoTools: args.groundingMode === "repo_only" || args.groundingMode === "repo_and_web",
      webSearch: args.groundingMode === "web_only" || args.groundingMode === "repo_and_web",
      webResearch: args.groundingMode === "web_only" || args.groundingMode === "repo_and_web",
      webFetch: args.groundingMode === "web_only" || args.groundingMode === "repo_and_web",
      fileAuthoring: false,
    },
  };

  const prepared = runner.prepare(request);
  console.log("# pi-runner smoke test");
  console.log(JSON.stringify({ activeTools: prepared.activeTools }, null, 2));

  const result = await runner.run(request);
  console.log("\n## result\n");
  console.log(
    JSON.stringify(
      {
        provider: result.provider,
        model: result.model ?? null,
        citations: result.citations,
        toolActivity: result.toolActivity,
        answerPreview: result.answer.slice(0, 5000),
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv: string[]) {
  const values = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, ["true"]);
      continue;
    }
    index += 1;
    const entries = values.get(key) ?? [];
    entries.push(next);
    values.set(key, entries);
  }

  return {
    specialistKind: values.get("specialist-kind")?.at(-1) ?? "research_specialist",
    specialistName: values.get("specialist-name")?.at(-1) ?? "Research Specialist",
    rolePrompt:
      values.get("role-prompt")?.at(-1) ??
      "Answer specialist questions with grounded repo and web evidence.",
    question:
      values.get("question")?.at(-1) ??
      "Find the official Microsoft Graph API docs for assignLicense and summarize the endpoint and permission.",
    taskBrief: values.get("task-brief")?.at(-1),
    groundingMode: oneOf(values.get("grounding-mode")?.at(-1), ["memory_only", "repo_only", "web_only", "repo_and_web"] as const) ?? "web_only",
  };
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
  console.error("\npi-runner smoke test failed:\n");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
