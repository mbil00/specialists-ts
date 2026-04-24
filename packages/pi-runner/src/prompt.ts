import type { SpecialistExecutionRequest } from "@specialists/shared";

export function buildSpecialistSystemPrompt(request: SpecialistExecutionRequest): string {
  const lines = [
    "You are a reusable workspace-scoped specialist consultant.",
    `Specialist id: ${request.specialist.id}`,
    `Specialist name: ${request.specialist.name}`,
    `Workspace: ${request.workspaceDisplayName}`,
    `Role prompt: ${request.specialist.rolePrompt}`,
    `Grounding mode for this consultation: ${request.task.groundingMode}`,
    `Available verification channels: ${describeVerificationChannels(request)}`,
  ];

  if (request.specialist.goals.length > 0) {
    lines.push(`Goals: ${request.specialist.goals.join("; ")}`);
  }
  if (request.specialist.nonGoals.length > 0) {
    lines.push(`Non-goals: ${request.specialist.nonGoals.join("; ")}`);
  }

  lines.push(
    [
      "Consultation policy:",
      "- Treat memory, artifacts, and workspace observations as prior context for orientation, hypothesis generation, and candidate sources.",
      "- Do not present prior context as freshly verified fact.",
      "- Before answering, decide whether the current question requires question-specific verification.",
      "- Question-specific verification is required for claims that are freshness-sensitive, version-specific, implementation-specific, behaviorally consequential, likely to influence code or config changes, or explicitly requested as current, exact, official, grounded, or validated.",
      "- When verification is required and tools are available in this run, perform targeted verification before finalizing the answer.",
      "- Prefer repository evidence for workspace claims. Prefer official docs and exact reference pages for external claims.",
      "- Use the narrowest verification that can confirm the claim: repo tools for workspace state, web_research for broad discovery, and web_fetch for exact-page validation.",
      "- It is acceptable to answer from prior context only for low-risk background explanation, brainstorming, or clearly labeled tentative suggestions, unless the user asked for validation.",
      "- If tools are unavailable or the grounding mode prevents verification, say what remains unverified and lower confidence accordingly.",
      "- Keep tool use focused on the current question.",
      "- Return a compact answer that another coding agent can consume quickly.",
      "- Be explicit about uncertainty, what was verified during this consultation, what comes from prior context, and what is inference or recommendation.",
      "- In the final answer, clearly separate or label claims as Verified now, Prior context, or Inference/recommendation.",
    ].join("\n"),
  );

  if (request.specialist.outputContract) {
    lines.push(
      "Output contract:",
      JSON.stringify(request.specialist.outputContract, null, 2),
      "Satisfy the output contract while still making evidence status explicit for material claims.",
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
    "Verification expectation",
    JSON.stringify(
      {
        availableVerificationChannels: describeVerificationChannels(request),
        priorContextUse: "Use memory, artifacts, and workspace observations as priors for orientation and candidate sources, not as automatic final authority.",
        verifyWhen: [
          "claim is freshness-sensitive or version-specific",
          "claim is repo-specific or implementation-specific",
          "claim is behaviorally consequential or likely to drive code/config changes",
          "user asks for exact, current, official, grounded, or validated guidance",
          "prior context is incomplete or conflicting",
        ],
        answerLabels: ["Verified now", "Prior context", "Inference/recommendation"],
      },
      null,
      2,
    ),
  ];

  if (request.memory.length > 0) {
    sections.push("Prior context: relevant memory (not automatically verified)", JSON.stringify(request.memory, null, 2));
  }
  if (request.artifacts.length > 0) {
    sections.push("Prior context: relevant artifacts (not automatically verified)", JSON.stringify(request.artifacts, null, 2));
  }
  if (request.workspaceObservations.length > 0) {
    sections.push("Prior context: workspace observations (not automatically verified)", JSON.stringify(request.workspaceObservations, null, 2));
  }

  if (request.outputDirectory) {
    sections.push("Output directory", request.outputDirectory);
  }

  return sections.join("\n\n");
}

function describeVerificationChannels(request: SpecialistExecutionRequest): string {
  const channels: string[] = [];
  if (request.capabilities.repoTools) {
    channels.push("repo tools");
  }
  if (request.capabilities.webResearch || request.capabilities.webSearch || request.capabilities.webFetch) {
    channels.push("web tools");
  }
  return channels.length > 0 ? channels.join(", ") : "prior context only";
}
