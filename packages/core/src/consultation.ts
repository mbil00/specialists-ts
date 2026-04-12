import type {
  SpecialistExecutionRequest,
  SpecialistExecutionResult,
} from "@specialists/shared";

export interface ConsultationPipelineResolution {
  executionRequest: SpecialistExecutionRequest;
}

export interface ConsultationPipeline {
  resolve(): Promise<ConsultationPipelineResolution>;
  execute(request: SpecialistExecutionRequest): Promise<SpecialistExecutionResult>;
  finalize(result: SpecialistExecutionResult): Promise<void>;
}
