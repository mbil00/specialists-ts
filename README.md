# specialists-ts

Pi-native TypeScript monorepo rewrite of the Specialists runtime.

## Intent

This subdirectory is the new implementation target:

- TypeScript-first
- Pi SDK / extension-native
- first-class repo grounding
- first-class web grounding
- durable specialist memory and artifacts
- honest grounding metadata

The existing Python code in the parent repository remains available as a reference during migration.

## Planned workspace layout

- `apps/cli` - operator CLI
- `apps/api` - HTTP / MCP surface if retained
- `packages/core` - domain model, runtime pipeline, persistence
- `packages/pi-runner` - Pi SDK session integration, specialist execution, and smoke testing
- `packages/web-tools` - web search + web fetch Pi extension tools
- `packages/shared` - shared types / config helpers
- `docs` - architecture and migration docs

## Current docs

- `docs/architecture.md`
- `docs/migration-plan.md`
