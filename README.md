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

- `list_specialists`
- `consult_specialist`

Specialist lifecycle remains operator-managed through the CLI.

## Repo-defined specialists

Committed specialist definitions can live at:

- `.agents/specialists/*.json`

Local-only operator overrides can live at:

- `.specialists/templates/*.json`

The main agent is only meant to list and consult specialists.
Creation and bootstrap stay in the operator CLI.

Create a specialist definition with the CLI:

```bash
node apps/cli/dist/index.js create --kind runtime-architect
```

Then bootstrap it:

```bash
node apps/cli/dist/index.js bootstrap --kind runtime-architect --question "Bootstrap this specialist for the current workspace."
```

You can inspect them with the CLI:

```bash
node apps/cli/dist/index.js list
```

Or expose them to pi as tools for the main agent:

```bash
pi -e ./packages/specialist-tools/dist/index.js
```

That gives the main agent `list_specialists` and `consult_specialist` only.

## Current docs

- `docs/architecture.md`
- `docs/migration-plan.md`
