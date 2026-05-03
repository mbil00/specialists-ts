# specialists-ts

Pi-native TypeScript monorepo rewrite of the Specialists runtime.

## Intent

This subdirectory is the new implementation target:

- TypeScript-first
- Pi SDK / extension-native
- first-class repo grounding
- first-class web grounding
- operator-managed specialists committed with the project
- durable specialist memory and artifacts
- honest grounding metadata

The existing Python code in the parent repository remains available as a reference during migration.

## Planned workspace layout

- `apps/cli` - operator CLI
- `apps/api` - HTTP / MCP surface if retained
- `packages/core` - domain model, runtime pipeline, persistence
- `packages/pi-runner` - Pi SDK session integration, specialist execution, and smoke testing
- `packages/web-tools` - web search + web fetch Pi extension tools
- `packages/specialist-tools` - Pi extension tools that let a main agent list and consult workspace specialists
- `packages/shared` - shared types / config helpers
- `docs` - architecture and migration docs

## Current status

The repo now has a working workspace-bound consultation loop:

- resolves a workspace from the current directory or git root
- persists workspace-local state under `.specialists/`
- loads operator-managed specialist definitions from `.agents/specialists/*.json`
- bootstraps a specialist profile from repo anchor files
- deepens bootstrap with a Pi-driven planner, parallel repo/web workstreams, validation, and synthesis flow
- builds a workspace-shaped specialist prompt/context
- retrieves reusable memory and artifacts for later consultations
- runs a fresh Pi session through `@specialists/pi-runner`
- exposes `list_specialists` and `consult_specialist` Pi tools through `@specialists/specialist-tools`
- persists consultation records plus distilled memory/artifacts back into the workspace

## MCP usage

The recommended main-agent integration path is MCP.

Initialize a workspace for MCP usage:

```bash
node apps/cli/dist/index.js init --workspace-root /path/to/project
```

That writes `.mcp.json` for the target workspace and appends a Specialists MCP section to `.codex/config.toml` if it is not already present.

After building the repo, you can also run the MCP stdio server directly:

```bash
node apps/api/dist/index.js --workspace-root /path/to/project
```

Example `.mcp.json` entry written by `init`:

```json
{
  "mcpServers": {
    "specialists": {
      "type": "stdio",
      "command": "pnpm",
      "args": [
        "--dir",
        "/absolute/path/to/specialists-ts",
        "--filter",
        "@specialists/api",
        "mcp:stdio",
        "--",
        "--workspace-root",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

This MCP surface intentionally exposes only:

- `list_specialists` — returns bootstrapped, consultation-ready specialists
- `consult_specialist` — consults an existing bootstrapped specialist

Example MCP consultation payload:

```json
{
  "specialist": "runtime-architect",
  "question": "How should this codebase integrate specialists?",
  "grounding_mode": "repo_and_web",
  "response_format": "packet"
}
```

Specialist lifecycle remains operator-managed through the CLI.

## Repo-defined specialists

Committed specialist definitions can live at:

- `.agents/specialists/*.json`

Local-only operator-managed specialist definitions can live at:

- `.specialists/templates/*.json`

These are additional local-only definitions, not same-id overrides of committed repo definitions.
The main agent is only meant to list and consult consultation-ready specialists.
Creation and bootstrap stay in the operator CLI.

Create a specialist definition with the CLI:

```bash
node apps/cli/dist/index.js create --specialist runtime-architect
```

Then bootstrap it:

```bash
node apps/cli/dist/index.js bootstrap --specialist runtime-architect --question "Bootstrap this specialist for the current workspace."
```

For a guided bootstrap that asks for operator context before running the model-driven bootstrap pipeline:

```bash
node apps/cli/dist/index.js bootstrap --specialist runtime-architect --interactive
```

The interactive answers are passed into the existing planner/repo/web/validation/synthesis bootstrap flow; they do not replace model bootstrap.

You can inspect all defined specialists with the CLI:

```bash
node apps/cli/dist/index.js list
```

The CLI marks whether each specialist has been bootstrapped. Main-agent surfaces only list specialists that are already bootstrapped and ready for consultation.

Consult a bootstrapped specialist from the CLI:

```bash
node apps/cli/dist/index.js consult \
  --specialist runtime-architect \
  --question "How does the consultation pipeline work in this codebase?"
```

Useful consultation options include:

- `--task-brief "..."`
- repeated `--constraint "..."`
- repeated `--assumption "..."`
- `--grounding-mode memory_only|repo_only|web_only|repo_and_web`
- `--response-format packet|markdown|json|text`

Or expose bootstrapped specialists to pi as tools for the main agent:

```bash
pi -e ./packages/specialist-tools/dist/index.js
```

That gives the main agent `list_specialists` and `consult_specialist` only.

## Current docs

- `docs/architecture.md`
- `docs/migration-plan.md`
