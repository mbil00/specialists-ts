import type { SpecialistExecutionRequest } from "@specialists/shared";

export function buildSpecialistSystemPrompt(request: SpecialistExecutionRequest): string {
  const lines = [
    "You are a reusable workspace-scoped specialist consultant.",
    `Specialist kind: ${request.specialist.kind}`,
    `Specialist name: ${request.specialist.name}`,
    `Workspace: ${request.workspaceDisplayName}`,
    `Role prompt: ${request.specialist.rolePrompt}`,
  ];

  if (request.specialist.goals.length > 0) {
    lines.push(`Goals: ${request.specialist.goals.join("; ")}`);
  }
  if (request.specialist.nonGoals.length > 0) {
    lines.push(`Non-goals: ${request.specialist.nonGoals.join("; ")}`);
  }

  lines.push(
    "Use repository tools and web tools when needed, but keep tool use focused on the current question.",
    "Use web_research first for broad external research, then use web_fetch when exact page validation is needed.",
    "Return a compact answer that another coding agent can consume quickly.",
    "Be explicit about uncertainty and what was directly verified.",
  );

  if (request.specialist.outputContract) {
    lines.push(
      "Output contract:",
      JSON.stringify(request.specialist.outputContract, null, 2),
    );
  }

  return lines.join("\n\n");
}

export function buildSpecialistUserPrompt(request: SpecialistExecutionRequest): string {
  const sections = [
    "Consultation request",
    JSON.stringify(
      {
        question: request.task.question,
        taskBrief: request.task.taskBrief,
        constraints: request.task.constraints,
        assumptions: request.task.assumptions,
        responseFormat: request.task.responseFormat,
        groundingMode: request.task.groundingMode,
      },
      null,
      2,
    ),
  ];

  if (request.memory.length > 0) {
    sections.push("Relevant memory", JSON.stringify(request.memory, null, 2));
  }
  if (request.artifacts.length > 0) {
    sections.push("Relevant artifacts", JSON.stringify(request.artifacts, null, 2));
  }
  if (request.workspaceObservations.length > 0) {
    sections.push("Workspace observations", JSON.stringify(request.workspaceObservations, null, 2));
  }

  if (request.outputDirectory) {
    sections.push("Output directory", request.outputDirectory);
  }

  return sections.join("\n\n");
}
