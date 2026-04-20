# @specialists/specialist-tools

Pi extension package that exposes workspace specialists to a main agent.

## Tools

- `list_specialists` - list consultation-ready specialists available in the current workspace
- `consult_specialist` - run a specialist in a fresh subagent session and return a compact grounded answer packet

## Specialist definitions

Operator-managed workspace specialists can live under:

- `.agents/specialists/*.json`

Local-only overrides can live under:

- `.specialists/templates/*.json`

Example:

```json
{
  "name": "Runtime Architect Specialist",
  "description": "Grounded specialist for this repo's runtime architecture and specialist pipeline.",
  "rolePrompt": "You are the runtime architect specialist for this workspace. Focus on the consultation pipeline, bootstrap flow, persistence layout, and Pi-native execution model.",
  "goals": [
    "Answer architecture questions with repo-grounded detail",
    "Preserve the distinction between operator workflow and main-agent specialist workflow"
  ],
  "tags": ["architecture", "runtime", "specialists"]
}
```

If the filename is `runtime-architect.json`, the kind becomes `runtime-architect` unless `kind` is explicitly set in the JSON.

## Usage with pi

```bash
pi -e ./packages/specialist-tools/dist/index.js
```

In a project-local pi setup, this package is intended to be loaded as a project extension so the main agent can discover and consult specialists before doing broad research itself.

This package is intentionally minimal: the main agent gets list and consult only. Specialist creation and bootstrap stay in the operator CLI.
