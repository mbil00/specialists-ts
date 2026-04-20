# Architecture

## Product goal

Provide workspace-scoped specialists that a main coding agent can consult for narrow, grounded expertise without burning its own context on:

- repeated repo discovery
- repeated web discovery
- repeated project-specific pattern reconstruction

A specialist is a reusable project consultant with:

- explicit repo grounding
- explicit web grounding
- durable memory
- durable artifacts
- compact output packets
- honest grounding metadata
- a repo-defined identity the main agent can discover and call

## Core architectural decision

The new system is Pi-native and TypeScript-first.

We are not treating Pi as just another provider adapter.
We are treating Pi as the execution substrate for specialist reasoning.

That means:

- use Pi SDK for agent execution
- use Pi extensions for custom tools
- keep specialist state outside Pi session history
- use fresh, compact Pi sessions per specialist call
- expose repo and web grounding through our own tool layer and orchestration

## Non-goals

- preserve Python implementation shape
- preserve Anthropic/OpenAI provider parity abstraction
- depend on vendor-specific built-in browsing features
- treat long-lived chat history as specialist memory

## System overview

```text
Operator
  -> specialists CLI / API
  -> create / bootstrap / inspect / refresh specialists

Main agent
  -> Pi extension tools (`list_specialists`, `consult_specialist`)
  -> consultation pipeline
      -> load workspace + specialist profile
      -> retrieve memory + artifacts
      -> decide grounding plan
      -> create fresh Pi session
      -> attach built-in repo tools + custom web tools
      -> run specialist prompt
      -> validate contract + grounding
      -> distill reusable outputs
      -> persist consultation record
  -> compact specialist packet response
```

## Monorepo layout

### apps/cli
Operator-facing CLI for:

- workspace init
- bootstrap specialist
- consult specialist
- inspect memory / artifacts / profiles
- run evaluations
- trigger refresh or alignment

### apps/api
Optional service surface for:

- HTTP API
- MCP server if still useful
- background jobs / scheduled refreshes

This package should stay thin and delegate to `packages/core`.

### packages/core
Owns the domain model and orchestration:

- workspace registry
- specialist templates / profiles
- consultation pipeline
- bootstrap pipeline
- memory distillation and retrieval
- artifact creation and retrieval
- grounding metadata model
- persistence and migrations
- evaluation harness

This is the product core.

### packages/pi-runner
Owns Pi integration:

- create Pi agent sessions via SDK
- load required extensions and tools
- build system prompts
- stream events
- capture tool activity
- return normalized execution results

Current scaffold covers:

- execution request/result DTOs in `packages/shared`
- prompt builders for specialist system/user prompts
- active-tool resolution for repo + web tools
- normalized tool-kind classification
- fresh-session execution via Pi SDK
- web-tools extension loading during SDK runs
- tool activity normalization into shared execution results
- workspace resolution bound to git root or current directory
- workspace-local profile + consultation persistence under `.specialists/`
- specialist bootstrap from repo anchor inspection
- Pi-driven bootstrap refinement via repo and web synthesis passes
- simple reusable memory/artifact persistence and retrieval under `.specialists/`
- workspace-bound consultation orchestration in `packages/core`

Important rule:

- Pi session state is execution state, not product memory
- persistent specialist memory remains in `packages/core`

### packages/web-tools
Owns first-class web grounding.

This is required for the product to work well with fast-moving technologies.

The default operating model should be:

- `web_research` for broad delegated research
- `web_fetch` for exact page validation by the main specialist
- search provider routing optimized for docs/reference retrieval first, exploratory retrieval second

Expected tools:

- `web_search`
- `web_research`
- `web_fetch`
- maybe `docs_search` later

Expected responsibilities:

- provider adapters (Exa, Tavily, Brave, Firecrawl, SerpAPI, custom)
- delegated `web_research` subagent orchestration
- result normalization
- freshness metadata
- citation-ready outputs
- truncation and caching
- domain allow / deny policy if needed

### packages/specialist-tools
Owns the main-agent-facing Pi extension surface.

Important boundary:

- operator plane manages specialist lifecycle
- main agent only lists and consults specialists

Responsibilities:

- expose `list_specialists`
- expose `consult_specialist`
- encourage the main agent to consult specialists before doing broad repo/web discovery itself
- surface operator-managed specialist definitions from `.agents/specialists/*.json`
- surface local operator overrides from `.specialists/templates/*.json`

### packages/shared
Shared primitives only:

- config schema
- shared DTOs
- logging utilities
- low-level helpers

Do not let this package become a dumping ground.

## Execution model

## 1. Fresh session per specialist call

Each consultation should use a fresh Pi session.

Why:

- keeps context light
- avoids hidden long-chat drift
- makes specialist memory explicit and inspectable
- matches the product goal of compact reusable consultant packets

The session input should be composed from:

- specialist profile
- retrieved memory
- retrieved artifacts
- current consultation request
- selected workspace observations
- grounding instructions
- output contract

## 2. Pi tools

### Repo grounding
Use Pi built-in tools directly:

- read
- bash
- edit
- write
- grep
- find
- ls

We are not designing a provider-specific repo exploration mode.
If the specialist needs tools, it gets tools.

### Web grounding
Use our own Pi extension tools.

That gives us:

- provider independence
- explicit citations
- explicit freshness metadata
- better control over result quality
- delegated multi-page research without forcing the main specialist to do all web exploration itself

## 3. Tool activity capture

The Pi runner should normalize tool events into a stable internal format, e.g.:

- tool name
- input summary
- result summary
- success / failure
- touched files
- visited URLs
- timestamps

This feeds:

- grounding metadata
- observability
- artifact creation
- evaluation

## Core domain model

## Workspace

A workspace is a project-scoped root with persistent identity.

In addition to persistent state under `.specialists/`, a workspace may also include committed specialist definitions under `.agents/specialists/` so the main agent can discover repo-local specialists.

Stores:

- workspace id
- display name
- root path
- config metadata
- timestamps

## Specialist template

The reusable definition for a specialist kind.

Templates come from operator-managed workspace sources:

- repo-committed workspace templates under `.agents/specialists/*.json`
- local-only overrides under `.specialists/templates/*.json`

The main agent should not invent new specialist kinds at consultation time.
If a specialist does not exist yet, the operator must create and bootstrap it first.

Fields:

- kind
- name
- description
- role prompt
- goals / non-goals
- capability policy
- input contract
- output contract
- default runtime policy

## Specialist profile

The workspace-shaped version of the specialist.

Fields:

- specialist kind
- workspace id
- active revision
- distilled repo patterns
- distilled external patterns
- alignment notes
- timestamps

## Memory item

Reusable specialist knowledge unit.

Fields:

- memory type
- summary / body
- source basis
- validated or not
- freshness kind
- citations
- retrieval metadata
- specialist scope
- workspace scope

## Artifact

Reusable structured output left behind by a consultation.

Examples:

- implementation notes
- schema maps
- framework migration checklists
- research packs
- generated files

## Consultation record

Audit trail of one specialist run.

Fields:

- request
- response packet
- provider / model path
- grounding metadata
- tool activity summary
- validation status
- artifact links
- memory distillation outcome

## Grounding model

Grounding must be explicit and truthful.

Each response should indicate at least:

### Repo grounding
- requested
- available
- attempted
- used
- evidence count
- detail

### Web grounding
- requested
- available
- attempted
- used
- evidence count
- detail

### Memory/artifact reuse
- items retrieved
- reused vs stale
- revalidation required

### Overall degradation
- degraded or not
- degraded reasons

## Consultation pipeline

## Stage 1: resolve

- resolve workspace
- resolve specialist template/profile
- resolve consultation mode
- retrieve memory and artifacts
- determine output directory if relevant

## Stage 2: prepare

- build consultation context
- decide whether repo and web grounding are required
- precompute retrieval packets
- prepare compact workspace observations
- prepare output contract instructions

## Stage 3: execute

- create Pi session
- attach built-in tools and extension web tools
- run specialist prompt
- collect streamed output
- collect tool activity
- validate response contract
- retry once if answer shape is invalid

## Stage 4: finalize

- build truthful grounding metadata
- persist consultation record
- create artifacts if requested / useful
- distill durable memory
- return compact specialist packet

## Bootstrap pipeline

Bootstrap should remain explicit but simpler than the Python version.

Suggested flow:

1. inspect workspace anchors
2. run a dedicated bootstrap planner on the initial specialist request
3. split bootstrap into multiple repo and web workstreams when the planner decides parallel investigation is useful
4. run repo-grounded bootstrap exploration workstreams in parallel when needed
5. run web-grounded bootstrap research workstreams in parallel when needed
6. run a bootstrap validation pass to verify the highest-impact claims
7. synthesize the specialist profile from the distilled and validated bootstrap evidence
8. persist initial profile and evidence summary

Bootstrap should use stronger reasoning than normal consultation, because prompt quality determines downstream specialist quality.
The specialist itself should not act as its own bootstrapper.

Important:

- bootstrap is not a separate provider abstraction
- it is a different orchestration mode over the same Pi-native runtime

## Web search architecture

This is mandatory, not optional.

## Required tool: web_search

Input:

- query
- preferred domains
- excluded domains
- freshness hint
- max results

Output:

- title
- url
- snippet
- provider metadata
- publish date if known
- fetch timestamp

## Required tool: web_research

Purpose:

- delegate broad web exploration to an isolated Pi subagent
- search and read multiple pages
- return a compact research pack with direct answer, evidence, recommended pages, conflicts, and uncertainties

The main specialist should usually use `web_research` first, then `web_fetch` only for exact validation of critical pages.

The research pack should stay domain-agnostic, but may include optional generic metadata such as confidence, notes, and tags so domain specialists can make better follow-up decisions.

## Required tool: web_fetch

Input:

- url

Output:

- canonical url
- title
- cleaned content
- headings summary
- fetched timestamp

## Design requirements

- URLs always preserved
- timestamps always preserved
- output always truncated safely
- official docs preferred when possible
- all web evidence citation-ready
- adapter layer isolated from specialist logic

## Persistence

SQLite is still a good fit initially.

Suggested rule:

- keep schema simple in v1 rewrite
- port only tables that are product-critical
- delay exotic revision machinery until the Pi-native loop is stable

Likely first schema areas:

- workspaces
- specialist_templates
- specialist_profiles
- consultation_runs
- memory_items
- artifacts
- citations / evidence refs

## Configuration

Config should be explicit and typed.

Examples:

- Pi model defaults
- web provider config
- timeout policy
- memory distillation policy
- retrieval weights
- output directory policy

Prefer one typed config model over many ad hoc env lookups.

## Evaluation

Evaluation should measure behavior, not just profile text.

Primary evaluation questions:

- did the specialist actually use repo evidence when required?
- did it actually use web evidence when required?
- are citations useful and inspectable?
- does second consultation improve from stored memory?
- does the response stay compact and contract-shaped?

## Delivery priorities

1. Pi-native consultation loop
2. first-class web search tools
3. truthful grounding metadata
4. durable memory distillation
5. bootstrap flow
6. evaluation harness
7. profile refresh / alignment

## Guiding principle

The product is not a chatbot with extra memory.
It is a grounded specialist runtime.

Pi should provide the agent execution substrate.
The product value lives in:

- orchestration
- grounding
- persistence
- retrieval
- compounding specialist knowledge
