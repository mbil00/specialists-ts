import type { SpecialistExecutionRequest } from "@specialists/shared";

import {
  createDefaultPiRunnerConfig,
  type PiRunnerConfig,
} from "./config.js";

export function resolveActiveToolNames(
  request: SpecialistExecutionRequest,
  config: PiRunnerConfig = createDefaultPiRunnerConfig(),
): string[] {
  const tools = new Set<string>();

  if (request.capabilities.repoTools || request.capabilities.fileAuthoring) {
    for (const tool of config.builtInRepoTools) {
      tools.add(tool);
    }
  }

  if (request.capabilities.webSearch || request.capabilities.webResearch || request.capabilities.webFetch) {
    for (const tool of config.webTools) {
      tools.add(tool);
    }
  }

  return Array.from(tools);
}
