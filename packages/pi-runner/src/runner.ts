import type {
  SpecialistExecutionRequest,
  SpecialistExecutionResult,
} from "@specialists/shared";

import {
  createDefaultPiRunnerConfig,
  type PiRunnerConfig,
} from "./config.js";
import { buildSpecialistSystemPrompt, buildSpecialistUserPrompt } from "./prompt.js";
import { runWithPiSdk } from "./sdk-runner.js";
import { resolveActiveToolNames } from "./tools.js";

export interface PreparedPiRun {
  systemPrompt: string;
  userPrompt: string;
  activeTools: string[];
}

export interface PiRunner {
  prepare(request: SpecialistExecutionRequest): PreparedPiRun;
  run(request: SpecialistExecutionRequest): Promise<SpecialistExecutionResult>;
}

export function createPiRunner(config: PiRunnerConfig = createDefaultPiRunnerConfig()): PiRunner {
  return {
    prepare(request) {
      return {
        systemPrompt: buildSpecialistSystemPrompt(request),
        userPrompt: buildSpecialistUserPrompt(request),
        activeTools: resolveActiveToolNames(request, config),
      };
    },
    async run(request) {
      this.prepare(request);
      return await runWithPiSdk(request, config);
    },
  };
}
