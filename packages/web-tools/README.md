# @specialists/web-tools

Pi extension package that provides first-class web grounding tools:

- `web_search`
- `web_research`
- `web_fetch`

## Provider support

### Search
- `brave`
- `exa`
- `auto` provider resolution with Brave primary and Exa fallback

### Research
- delegated Pi subagent using `web_search` + `web_fetch`
- default delegated model: `openai-codex/gpt-5.4-mini`

### Fetch
- direct HTTP fetch + HTML extraction via Readability

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SPECIALISTS_WEB_SEARCH_PROVIDER` | `auto` | `auto`, `exa`, or `brave` |
| `EXA_API_KEY` | - | Exa API key |
| `BRAVE_SEARCH_API_KEY` | - | Brave Search API key |
| `SPECIALISTS_WEB_FETCH_TIMEOUT_MS` | `20000` | Fetch timeout in milliseconds |
| `SPECIALISTS_WEB_FETCH_USER_AGENT` | `specialists-ts/0.1 (+https://pi.dev)` | User-Agent for `web_fetch` |
| `SPECIALISTS_WEB_SEARCH_DEFAULT_MAX_RESULTS` | `5` | Default max search results |
| `SPECIALISTS_WEB_RESEARCH_PI_COMMAND` | `pi` | Pi command used for delegated research |
| `SPECIALISTS_WEB_RESEARCH_MODEL` | `openai-codex/gpt-5.4-mini` | Model for the web research subagent |
| `SPECIALISTS_WEB_RESEARCH_THINKING` | `medium` | Thinking level for the web research subagent |
| `SPECIALISTS_WEB_RESEARCH_TIMEOUT_MS` | `120000` | Timeout for delegated research |
| `SPECIALISTS_WEB_RESEARCH_DEFAULT_MAX_PAGES` | `4` | Default number of pages to inspect deeply |
| `SPECIALISTS_WEB_RESEARCH_EXTENSION_PATH` | - | Optional explicit path to this extension for the subagent |

## Usage with pi

```bash
pi -e ./dist/index.js
```

Or load the source directly during development if your setup supports it.

## Smoke testing

From the monorepo root:

```bash
pnpm --filter @specialists/web-tools smoke
```

Examples:

```bash
pnpm --filter @specialists/web-tools smoke -- --mode search \
  --search-query "latest pi coding agent SDK docs" \
  --preferred-domain pi.dev

pnpm --filter @specialists/web-tools smoke -- --mode fetch \
  --fetch-url https://pi.dev

pnpm --filter @specialists/web-tools smoke -- --mode research \
  --research-question "What are the most important current docs and implementation details for Pi custom tools and SDK usage?" \
  --preferred-domain pi.dev \
  --max-pages 4
```

Supported flags:

- `--mode search|fetch|research|all`
- `--search-query <text>`
- `--fetch-url <url>`
- `--research-question <text>`
- `--preferred-domain <domain>` or `--preferred-domains a.com,b.com`
- `--excluded-domain <domain>` or `--excluded-domains a.com,b.com`
- `--freshness any|day|week|month|year`
- `--max-results <n>`
- `--max-pages <n>`
- `--fetch-max-characters <n>`

## Intended usage model

- `web_research` is the default high-level tool for multi-page external research.
- `web_search` remains the low-level search primitive.
- `web_fetch` remains the low-level page validation primitive.
- research findings may include optional `confidence`, `notes`, and `tags` to help the main specialist decide what to validate, reuse, or ignore.

This lets the main specialist delegate broad research to a focused subagent, then validate exact pages itself when necessary.

## Current routing policy

- `auto` uses **Brave first** if `BRAVE_SEARCH_API_KEY` is present
- if both `BRAVE_SEARCH_API_KEY` and `EXA_API_KEY` are present, `auto` uses **Exa as fallback**
- if only `EXA_API_KEY` is present, `auto` uses Exa directly
- explicit `SPECIALISTS_WEB_SEARCH_PROVIDER=exa` or `brave` disables fallback and uses only that provider
