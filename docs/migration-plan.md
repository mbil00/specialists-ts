# Migration Plan

## Objective

Migrate from the current Python prototype into a Pi-native TypeScript monorepo without losing the product ideas that already work.

The Python code is now reference material, not the target architecture.

## Migration posture

- reuse good product logic
- do not preserve Python implementation structure by default
- port behavior before porting complexity
- rebuild around Pi SDK and Pi extensions
- make web search first-class from the beginning

## What we are preserving

From the Python codebase, the most valuable assets are:

- workspace-scoped specialist concept
- truthful grounding requirement
- contract-shaped answers
- compact reusable specialist packets
- memory / artifact compounding loop
- explicit consultation pipeline stages
- evaluation mindset

## What we are not preserving blindly

- Anthropic/OpenAI executor symmetry
- provider-specific exploration abstractions
- Python-specific transport surfaces
- complexity that only exists to smooth over provider differences
- revision/evaluation machinery that is not yet product-critical

## Proposed migration phases

## Phase 0: setup and decisions

Status: start now.

Deliverables:

- create TS monorepo scaffold
- document architecture
- document migration plan
- define package boundaries
- choose package manager and TS baseline

Success criteria:

- repo structure exists
- architecture is explicit
- rewrite direction is locked

## Phase 1: persistence and domain skeleton

Build `packages/core` with:

- config loading
- SQLite access
- migrations
- workspace model
- specialist template model
- specialist profile model
- consultation record model
- memory item model
- artifact model

Port selectively from Python:

- schema ideas from `specialists/database.py`
- schema shapes from `specialists/schemas.py`
- workspace identity concepts from `specialists/runtime_workspace.py`
- template defaults from `specialists/templates.py`

Do not port yet:

- provider abstractions
- MCP code
- old CLI logic

Success criteria:

- a workspace can be created and resolved
- a specialist template/profile can be persisted and loaded
- a consultation run can be recorded

## Phase 2: Pi runner vertical slice

Build `packages/pi-runner` with:

- Pi SDK integration
- fresh-session runner
- event capture
- normalized execution result
- tool activity extraction

Current scaffold status:

- shared execution DTOs exist
- prompt builders exist
- active-tool resolution exists
- fresh-session Pi SDK execution exists
- web-tools extension loading exists
- tool activity normalization exists
- deeper event/result shaping still needs refinement

Port selectively from Python:

- prompt structure ideas from `specialists/execution_protocol.py`
- grounding and execution-path concepts from `specialists/runtime_consultation.py`

Do not port yet:

- Python subprocess execution model
- provider routing logic

Success criteria:

- one Pi-backed specialist call can run against a workspace
- repo tools are available
- tool usage is captured
- final answer is normalized

## Phase 3: web grounding tools

Build `packages/web-tools` with Pi extension tools:

- `web_search`
- `web_research`
- `web_fetch`

Required features:

- provider adapter abstraction
- delegated research subagent flow
- normalized result shape
- truncation
- URL preservation
- timestamps / freshness metadata
- basic caching / throttling

This phase is mandatory.
Without it, the product does not meet the stated need for fast-moving technologies.

The intended operating model is delegated research first (`web_research`), exact validation second (`web_fetch`).
Research outputs should remain generic, with optional metadata like confidence, notes, and tags rather than domain-locked schemas.

Success criteria:

- Pi specialist can search the web and fetch pages
- outputs contain usable URLs and fetch metadata
- grounding metadata can distinguish repo vs web evidence

## Phase 4: consultation pipeline

Build the real consultation flow in `packages/core`:

- resolve
- prepare
- execute
- finalize

Port selectively from Python:

- stage boundaries from `specialists/runtime_pipeline.py`
- response-building concepts from `specialists/runtime_contexts.py`
- grounding validation ideas from `specialists/runtime_consultation.py`

Simplify while porting:

- keep only product-relevant data flow
- remove provider-shim complexity

Success criteria:

- consultation produces compact packet responses
- grounding metadata is truthful
- contract validation works
- one retry path exists for malformed answers

## Phase 5: memory and artifact compounding

Implement:

- retrieval of relevant memory
- retrieval of relevant artifacts
- durable distillation from grounded answers
- optional artifact creation for reusable outputs

Port selectively from Python:

- retrieval ideas from `specialists/runtime_memories.py`
- artifact ideas from `specialists/runtime_artifacts.py`
- freshness and metadata ideas from `specialists/runtime_memory_common.py`

Success criteria:

- second consultation is measurably better than first for the same specialist
- stale and fresh knowledge are distinguishable
- durable outputs are reusable

## Phase 6: bootstrap flow

Implement Pi-native bootstrap:

- anchor inspection
- repo bootstrap pass
- web bootstrap pass
- profile synthesis

Port selectively from Python:

- high-level bootstrap flow from `specialists/runtime_bootstrap.py`
- template shaping ideas from `specialists/templates.py`

Simplify while porting:

- one Pi-native flow instead of backend-specific branches

Success criteria:

- first specialist use can build a profile grounded in repo and web evidence
- bootstrap phase outcomes are inspectable

## Phase 7: CLI and API surfaces

Implement:

- operator CLI in `apps/cli`
- optional API service in `apps/api`

CLI first, API second.

Port selectively from Python:

- command affordances from `specialists/cli.py`
- evaluation UX from `specialists/eval.py`

Do not port blindly:

- every old command
- legacy MCP assumptions

Success criteria:

- operators can init workspace, bootstrap specialist, consult specialist, inspect memory/artifacts, run evals

## Phase 8: evaluation and refresh

Implement:

- behavior-based evaluation harness
- replay or benchmark scenarios
- periodic refresh / alignment if justified by product value

Port selectively from Python:

- evaluation concepts from `specialists/eval.py`
- alignment ideas from `specialists/runtime_alignment.py` and `specialists/runtime_profile_alignment.py`

Gate this work behind evidence that the core loop is already good.

Success criteria:

- we can compare specialist quality over time
- refresh/alignment is justified by observed wins

## Suggested implementation order by package

### packages/shared
- config schema
- logger helpers
- common ids / timestamps

### packages/core
- DB and migrations
- workspace registry
- templates/profiles
- consultation pipeline
- memory/artifacts

### packages/pi-runner
- session factory
- event capture
- prompt assembly adapter
- normalized execution result

### packages/web-tools
- search adapter interface
- first provider implementation
- Pi extension tool registration

### apps/cli
- init
- consult
- inspect
- eval

### apps/api
- only after CLI path works

## Mapping from Python files to TS targets

### Likely reference sources

- `specialists/runtime_pipeline.py`
  - consultation stage structure
- `specialists/runtime_consultation.py`
  - grounding / execution-path types
- `specialists/execution_protocol.py`
  - prompt contracts and parsing ideas
- `specialists/runtime_bootstrap.py`
  - bootstrap orchestration
- `specialists/runtime_memories.py`
  - retrieval/distillation ideas
- `specialists/runtime_artifacts.py`
  - artifact persistence ideas
- `specialists/templates.py`
  - minimal template bootstrap defaults
- `specialists/eval.py`
  - evaluation loop concepts

### Likely not worth direct porting

- `specialists/execution.py`
  - too tied to Anthropic/OpenAI executor model
- `specialists/execution_sandbox.py`
  - mostly tied to Claude CLI constraints
- provider-specific branching logic
- CLI details tied to Python app structure

## Risks and mitigations

## Risk: over-porting complexity

Mitigation:

- only port flows that directly improve the core product loop
- make the first vertical slice small and real

## Risk: Pi session state becomes hidden memory

Mitigation:

- use fresh sessions per consultation
- keep durable memory in product persistence only

## Risk: web tools become too weak or noisy

Mitigation:

- normalize result shape aggressively
- prefer official docs
- preserve URLs and timestamps
- measure citation usefulness in evals

## Risk: rewrite stalls before product parity

Mitigation:

- define a narrow first milestone
- ship one end-to-end specialist before broadening

## First milestone

The first milestone should be:

- create workspace
- create one specialist template/profile
- run one Pi-backed consultation
- use repo tools
- use web search tools
- return contract-shaped packet
- persist consultation + memory
- run the same specialist again and show reuse

If that works well, the rewrite is on the right path.

## Immediate next tasks

1. add base TS workspace configs
2. choose runtime stack for Node execution and SQLite
3. define initial schema in `packages/core`
4. scaffold `packages/pi-runner`
5. scaffold `packages/web-tools`
6. implement first end-to-end specialist consultation
