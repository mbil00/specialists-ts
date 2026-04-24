# @specialists/core

Workspace-bound specialist orchestration.

## Current responsibilities

- resolve the active workspace from cwd / git root
- persist workspace state under `.specialists/`
- load operator-managed specialist definitions from `.agents/specialists/*.json`
- bootstrap specialist profiles from repo anchor inspection
- run a dedicated bootstrap planner to decide what to investigate
- split bootstrap into multiple parallel repo/web workstreams when useful
- run dedicated repo exploration subagents for bootstrap
- run dedicated web bootstrap researchers when external context matters
- run a bootstrap validation pass to verify the highest-impact claims
- synthesize the final specialist profile from distilled bootstrap knowledge
- build workspace-shaped execution requests
- retrieve reusable memory and artifacts for later consultations
- run the main consultation loop through an injected execution engine
- persist consultation records and distill new memory/artifacts

## Main APIs

- `createConsultationPipeline(executionEngine)`
- `resolveWorkspace()`
- `bootstrapSpecialist()`
- `listSpecialistTemplates()`
- `createWorkspaceSpecialistTemplate()`

## Current persistence model

Current bootstrap design intentionally separates roles:

- the specialist is not its own bootstrapper
- a dedicated bootstrap planner decides what to investigate
- dedicated bootstrap subagents gather repo/web evidence, potentially in parallel
- a bootstrap validator verifies important claims before profile synthesis
- a dedicated synthesizer generates the specialist profile draft

This package currently uses simple JSON persistence inside the target workspace:

Committed specialist definitions live separately under `.agents/specialists/*.json`.

- `.specialists/workspace.json`
- `.specialists/profiles/<specialist-id>.json`
- `.specialists/consultations/<timestamp>-<specialist-id>.json`
- `.specialists/memory/<specialist-id>/...`
- `.specialists/artifacts/<specialist-id>/...`
- `.specialists/out/`

This is intentionally a stepping stone toward richer persistence later.
