# @specialists/pi-runner

Pi SDK integration for specialists execution.

## Current state

This package currently provides:

- specialist execution request/result DTO integration via `@specialists/shared`
- prompt builders for specialist system/user prompts
- built-in repo tool resolution
- web-tools extension loading
- fresh-session execution via Pi SDK
- tool activity normalization
- a smoke test for end-to-end specialist execution

## Default model

The specialist runner currently defaults to:

- provider: `openai-codex`
- model: `gpt-5.4`

## Smoke testing

From the monorepo root:

```bash
pnpm --filter @specialists/pi-runner smoke
```

Example:

```bash
pnpm --filter @specialists/pi-runner smoke -- \
  --specialist-kind graph-api \
  --specialist-name "Microsoft Graph Specialist" \
  --question "Find the official Microsoft Graph API docs for assignLicense and summarize the endpoint and permission." \
  --grounding-mode web_only
```
