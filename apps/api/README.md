# @specialists/api

MCP surface for workspace specialists.

## Current scope

This package currently exposes a minimal MCP server for the main agent plane:

- `list_specialists`
- `consult_specialist`

It intentionally does not expose specialist management operations.
Creation, bootstrap, inspection, and refresh remain operator CLI responsibilities.

## Stdio usage

From the monorepo root:

```bash
pnpm --filter @specialists/api mcp:stdio -- --workspace-root /path/to/project
```

Or run the built file directly:

```bash
node apps/api/dist/index.js --workspace-root /path/to/project
```

## Smoke test

```bash
pnpm --filter @specialists/api smoke
```
