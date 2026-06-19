# BlockGraph MCP v0.2.5 PRD

## 1. Version Theme

BlockGraph MCP v0.2.5 is about a **modular benchmark harness for agent repository access accuracy**.

v0.2 proved that BlockGraph can initialize a repository into an auditable architecture model with work packages, module proposals, reviews, merges, and quality gates.

v0.2.5 must answer the next empirical question:

> Does an initialized BlockGraph help an agent locate relevant code, recover activation paths, and reason about impact more accurately and efficiently than ordinary repository search?

This version does **not** benchmark code modification. It benchmarks whether BlockGraph improves the agent's ability to find and explain the right code.

## 2. Product Positioning

BlockGraph MCP remains a constrained graph editor for architecture-first repository maintenance.

v0.2.5 adds a benchmark layer around the existing MCP and graph data. The benchmark layer must be modular:

- The benchmark core owns cases, runs, adapters, logs, scoring, and reports.
- The first benchmark module is `access-accuracy`.
- Future benchmark modules must be replaceable without rewriting the benchmark core.

The first benchmark module evaluates:

- code location accuracy
- block/module location accuracy
- flow/path reconstruction accuracy
- impact analysis accuracy
- search efficiency
- evidence correctness

## 3. Core Principle

The benchmark must separate these concerns:

```text
benchmark core
  -> prepares repository and graph condition
  -> runs an agent adapter
  -> records raw events and final answer
  -> invokes evaluator module
  -> writes report

benchmark module
  -> defines task schema
  -> defines golden answer schema
  -> defines scoring metrics
  -> defines prompt template
```

This separation is required because today we test agent access accuracy, but later we may test maintenance success, graph freshness, code-change conformance, runtime-flow recovery, or onboarding quality.

## 4. Goals

v0.2.5 must provide:

1. A benchmark case format.
2. A golden answer format.
3. A structured final answer format for agents.
4. A benchmark runner CLI.
5. A pluggable `AgentAdapter` interface.
6. At least three first-party adapters:
   - `fixture` adapter for deterministic tests.
   - `file` adapter for scoring previously saved agent answers.
   - `command` adapter for invoking Claude Code, OpenCode, or any future external agent command.
7. A pluggable evaluator interface.
8. The first evaluator module: `access-accuracy`.
9. JSONL event logs for benchmark runs.
10. JSON and Markdown reports.
11. Unit tests for loader, schemas, scorer, reports, and CLI dry runs.
12. A small benchmark suite over `fixtures/ts-react-complex`.

## 5. Non-Goals

Do not implement these in v0.2.5:

- Code modification benchmark.
- Architecture-first change protocol.
- Automatic bug fixing.
- Runtime tracing.
- Playwright tracing.
- OpenTelemetry ingestion.
- Forking or modifying OpenCode.
- Requiring Claude Code for automated tests.
- Requiring network access for automated tests.
- Requiring an LLM API key for automated tests.
- A visual benchmark dashboard.

Claude Code and OpenCode integration should be possible through the command adapter, but tests must not depend on either tool being installed.

## 6. External Agent Assumptions

v0.2.5 must not hard-code one closed agent framework.

Claude Code can be used through non-interactive print mode. Current Claude Code CLI docs describe `claude -p` for SDK-style query-and-exit, `--output-format json` or `stream-json`, `--json-schema`, `--mcp-config`, `--max-turns`, and `--max-budget-usd`.

OpenCode can be used through non-interactive `opencode run`, which supports raw JSON event output through `--format json`, `--dir`, model selection, and MCP configuration through OpenCode's own config.

These integrations are execution adapters, not product dependencies.

## 7. Benchmark Conditions

The benchmark must support multiple context conditions for the same task.

Required conditions:

```text
no_graph
code_facts_only
block_graph
block_graph_with_flows
stale_or_incomplete_graph
```

### 7.1 no_graph

The agent can inspect the repository normally, but must not use BlockGraph MCP tools or prebuilt graph artifacts.

Purpose:

- Baseline ordinary code search.

### 7.2 code_facts_only

The agent may use scanner-derived code entities and code edges, but not semantic block or flow data.

Purpose:

- Measure the value of mechanical dependency facts alone.

### 7.3 block_graph

The agent may use code facts and the semantic Block Graph.

Purpose:

- Measure whether module decomposition improves code localization.

### 7.4 block_graph_with_flows

The agent may use Code Fact Graph, Block Graph, and Flow Graph.

Purpose:

- Measure whether entrypoint-triggered flows improve path reconstruction.

### 7.5 stale_or_incomplete_graph

The agent receives an intentionally incomplete or stale graph.

Purpose:

- Measure whether bad graph context misleads the agent.
- Force benchmark reports to include graph-risk analysis.

This condition is important. BlockGraph must not only show upside; it must also expose how harmful an incorrect graph can be.

## 8. Benchmark Task Types

The first benchmark module, `access-accuracy`, must support these task types:

### 8.1 Entrypoint Path Location

Question shape:

> When the user clicks or invokes X, which files/entities/modules are activated in order?

Measures:

- expected files
- expected code entities
- expected blocks
- expected flow order
- evidence line correctness

### 8.2 Bug Localization

Question shape:

> Symptom X happens. Where should an agent inspect first?

Measures:

- top-k file hit rate
- top-k entity hit rate
- ranked localization quality
- false-positive search waste

### 8.3 Impact Analysis

Question shape:

> If code path X changes, which modules and flows are likely affected?

Measures:

- expected affected blocks
- expected affected files/entities
- connector awareness
- missed downstream dependencies

### 8.4 Feature Landing-Zone Selection

Question shape:

> To add feature X, where should a new module or code path be placed?

Measures:

- correct existing module references
- correct new module recommendation
- avoided unrelated modules
- boundary reasoning quality

### 8.5 Cross-Module Flow Recovery

Question shape:

> Explain how operation X moves through feature, shared, API, and UI modules.

Measures:

- flow order
- cross-block connectors
- shared dependency recognition
- unsupported claims

## 9. Repository Targets

v0.2.5 must start with local deterministic fixtures.

Required first suite:

```text
fixtures/ts-react-complex
```

Optional later suites:

```text
bulletproof-react at fixed commit
real small TypeScript libraries
real medium React apps
```

The first implementation must not require cloning a real repository during unit tests.

## 10. File Layout

Implement the benchmark framework with this structure unless the existing code strongly suggests a better equivalent:

```text
src/benchmark/
  schema.ts
  cases.ts
  repo.ts
  graphConditions.ts
  prompt.ts
  run.ts
  events.ts
  report.ts
  adapters/
    types.ts
    fixture.ts
    file.ts
    command.ts
  evaluators/
    types.ts
    accessAccuracy.ts

benchmarks/
  access-accuracy/
    cases/
      fixture-login-flow.json
      fixture-comment-submit-bug.json
      fixture-auth-impact.json
      fixture-team-feature-landing.json
      fixture-discussion-cross-flow.json
    fixture-answers/
      perfect/
      weak/
      wrong/
    README.md
  runs/
    .gitignore

scripts/
  benchmark.ts

tests/
  benchmark-schema.test.ts
  benchmark-access-accuracy.test.ts
  benchmark-runner.test.ts
  benchmark-report.test.ts
```

Do not put run outputs in source-controlled directories except for small test snapshots that are intentionally committed.

## 11. Data Models

Use TypeScript types and Zod schemas.

The benchmark layer should use JSON files as input/output. Do not store benchmark runs in SQLite in v0.2.5.

Rationale:

- Benchmark cases should be reviewable in pull requests.
- Run artifacts should be easy to share.
- SQLite is already used for graph state; mixing benchmark runs into graph DB would blur product boundaries.

### 11.1 Benchmark Case

Required shape:

```ts
export type BenchmarkModule = "access-accuracy";

export type GraphCondition =
  | "no_graph"
  | "code_facts_only"
  | "block_graph"
  | "block_graph_with_flows"
  | "stale_or_incomplete_graph";

export type AccessAccuracyTaskType =
  | "entrypoint_path_location"
  | "bug_localization"
  | "impact_analysis"
  | "feature_landing_zone"
  | "cross_module_flow_recovery";

export interface BenchmarkCase {
  id: string;
  module: BenchmarkModule;
  title: string;
  description: string;
  repo: {
    kind: "fixture" | "local" | "git";
    path?: string;
    url?: string;
    ref?: string;
  };
  task: {
    type: AccessAccuracyTaskType;
    prompt: string;
    entrypoint_hint?: string;
    symptom?: string;
    changed_surface?: string;
  };
  allowed_conditions: GraphCondition[];
  golden: AccessAccuracyGolden;
  tags: string[];
}
```

### 11.2 Golden Answer

Required shape:

```ts
export interface AccessAccuracyGolden {
  expected_files: WeightedExpectedItem[];
  expected_entities: WeightedExpectedItem[];
  expected_blocks: WeightedExpectedItem[];
  expected_flow_order?: string[];
  acceptable_alternatives?: {
    files?: string[];
    entities?: string[];
    blocks?: string[];
  };
  must_not_include?: {
    files?: string[];
    entities?: string[];
    blocks?: string[];
  };
  notes?: string;
}

export interface WeightedExpectedItem {
  id: string;
  weight?: number;
  required?: boolean;
}
```

For files, `id` is repo-relative path.

For entities, `id` should be the scanner entity ID when stable enough. If scanner IDs are not stable enough, use `file_path#symbol_name` and resolve through a helper.

For blocks, `id` should be block ID when the benchmark condition includes graph data. If no graph exists, scorer should compare predicted block names only when provided.

### 11.3 Agent Final Answer

Every adapter must normalize output to this shape:

```ts
export interface AgentFinalAnswer {
  task_id: string;
  condition: GraphCondition;
  answer: string;
  ranked_files: RankedItem[];
  ranked_entities: RankedItem[];
  ranked_blocks: RankedItem[];
  predicted_flow_order?: string[];
  evidence: EvidenceRef[];
  confidence: number;
  used_blockgraph: boolean;
  used_tools?: ToolUseSummary[];
  notes?: string;
}

export interface RankedItem {
  id: string;
  rank: number;
  confidence?: number;
  reason?: string;
}

export interface EvidenceRef {
  file_path: string;
  start_line?: number;
  end_line?: number;
  code_entity_id?: string;
  note?: string;
}

export interface ToolUseSummary {
  tool_name: string;
  count: number;
}
```

If an external agent produces extra fields, preserve the raw output in the run artifact but normalize only this schema for scoring.

### 11.4 Benchmark Run

Required shape:

```ts
export interface BenchmarkRun {
  id: string;
  created_at: string;
  benchmark_version: string;
  git_sha?: string;
  adapter: string;
  model?: string;
  cases: BenchmarkCaseRun[];
  aggregate: BenchmarkAggregateScore;
}
```

### 11.5 Event Log

Every run must write JSONL events:

```ts
export interface BenchmarkEvent {
  ts: string;
  run_id: string;
  case_id?: string;
  condition?: GraphCondition;
  type:
    | "run_started"
    | "case_started"
    | "repo_prepared"
    | "graph_condition_prepared"
    | "agent_started"
    | "agent_finished"
    | "agent_failed"
    | "score_computed"
    | "case_finished"
    | "run_finished";
  data?: unknown;
}
```

The benchmark core must log its own events even when the external agent framework does not expose a trace.

## 12. Scoring

The first evaluator must compute both accuracy and efficiency.

### 12.1 Accuracy Metrics

Required metrics:

- `file_precision`
- `file_recall`
- `file_f1`
- `entity_precision`
- `entity_recall`
- `entity_f1`
- `block_precision`
- `block_recall`
- `block_f1`
- `top1_file_hit`
- `top3_file_hit`
- `top5_file_hit`
- `top1_entity_hit`
- `top3_entity_hit`
- `flow_order_score`
- `must_not_include_penalty`
- `unsupported_evidence_penalty`

Use weighted expected items when weights are provided. If no weights are provided, every expected item weight is `1`.

### 12.2 Efficiency Metrics

Required metrics:

- `reported_tool_calls`
- `reported_read_calls`
- `reported_grep_calls`
- `reported_mcp_calls`
- `unique_files_read`
- `search_waste_ratio`
- `duration_ms`

`search_waste_ratio` is:

```text
unrelated_files_read / total_unique_files_read
```

If the adapter cannot provide files-read telemetry, set the value to `null` and record a warning. Do not invent telemetry.

### 12.3 Evidence Metrics

Required metrics:

- `evidence_file_exists_rate`
- `evidence_line_valid_rate`
- `evidence_entity_valid_rate`
- `unsupported_claim_count`

In v0.2.5, unsupported claims may be approximated by:

- evidence file path does not exist
- evidence line range invalid
- predicted entity not found
- predicted file not found
- predicted file/entity appears in `must_not_include`

Do not attempt natural-language hallucination detection in v0.2.5.

### 12.4 Aggregate Score

Compute:

```text
accuracy_score = weighted average of file/entity/block/flow metrics
efficiency_score = normalized optional score when telemetry exists
evidence_score = evidence validity score
overall_score = 0.70 * accuracy_score + 0.20 * evidence_score + 0.10 * efficiency_score
```

If efficiency telemetry is unavailable, redistribute:

```text
overall_score = 0.80 * accuracy_score + 0.20 * evidence_score
```

## 13. Prompting Rules

Benchmark prompts must be deterministic and condition-aware.

The prompt builder must include:

- case prompt
- repository path
- graph condition
- allowed tools/context
- required final JSON schema
- instruction not to modify files
- instruction to cite evidence
- instruction to rank likely files/entities/blocks

### 13.1 Shared Prompt Requirements

Every agent prompt must include:

```text
Do not modify repository files.
Your task is localization and explanation only.
Return only JSON matching the required schema.
Rank the most relevant files, entities, and blocks.
Include evidence paths and line ranges when possible.
Do not claim a flow step unless you can support it with source code or BlockGraph evidence.
```

### 13.2 no_graph Prompt

Must explicitly say:

```text
Do not use BlockGraph MCP tools or .blockgraph data.
Use ordinary repository inspection only.
```

### 13.3 code_facts_only Prompt

Must explicitly say:

```text
You may use scanner/code fact data, but not semantic blocks or flows.
```

### 13.4 block_graph Prompt

Must explicitly say:

```text
You may use BlockGraph block/module data.
Prefer graph-guided search, but verify claims against source files.
```

### 13.5 block_graph_with_flows Prompt

Must explicitly say:

```text
You may use BlockGraph block, connector, and flow data.
Use flows to guide activation path reconstruction, but verify claims against source files.
```

### 13.6 stale_or_incomplete_graph Prompt

Must explicitly say:

```text
The graph may be stale or incomplete.
Use it as a hint, not as truth.
Flag any contradictions between source code and graph.
```

## 14. Agent Adapters

### 14.1 Adapter Interface

Implement:

```ts
export interface AgentAdapter {
  name: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export interface AgentRunInput {
  run_id: string;
  case: BenchmarkCase;
  condition: GraphCondition;
  repo_path: string;
  graph_context?: GraphConditionContext;
  prompt: string;
  output_dir: string;
  timeout_ms: number;
}

export interface AgentRunResult {
  final_answer: AgentFinalAnswer;
  raw_output?: unknown;
  events?: BenchmarkEvent[];
  duration_ms: number;
  telemetry?: AgentTelemetry;
}
```

### 14.2 Fixture Adapter

The fixture adapter reads a predefined final answer from:

```text
benchmarks/access-accuracy/fixture-answers/<profile>/<case_id>.<condition>.json
```

Profiles:

```text
perfect
weak
wrong
```

Purpose:

- deterministic tests
- scorer verification
- report rendering

### 14.3 File Adapter

The file adapter reads final answers from a user-provided directory.

Example:

```text
pnpm benchmark --adapter file --answers-dir ./my-agent-answers
```

Purpose:

- allow users to run Claude Code manually and score its saved JSON
- avoid requiring closed agent tools in CI

### 14.4 Command Adapter

The command adapter executes an external command.

Example:

```text
pnpm benchmark --adapter command --command "claude -p --output-format json --max-turns 20"
pnpm benchmark --adapter command --command "opencode run --format json --dir {repo}"
```

Required behavior:

- Pass the prompt through stdin by default.
- Provide template variables:
  - `{repo}`
  - `{case_id}`
  - `{condition}`
  - `{output_dir}`
  - `{prompt_file}`
- Write the prompt to `{output_dir}/prompt.txt`.
- Capture stdout/stderr.
- Enforce timeout.
- Parse final answer as JSON.
- If stdout contains event streams, support extracting final JSON from a configured file or marker.

Do not implement framework-specific deep parsing in v0.2.5. Add small examples only.

## 15. Graph Condition Preparation

The benchmark runner must prepare graph condition context before invoking the adapter.

### 15.1 no_graph

Do not initialize BlockGraph. Ensure prompt forbids graph usage.

### 15.2 code_facts_only

Run:

- `begin_initialization`
- `scan_repo`

Export a code facts summary to:

```text
<output_dir>/graph-context/code-facts.json
```

The prompt may point to this file.

### 15.3 block_graph

Use a prebuilt fixture graph when available. If no graph fixture exists, build a minimal graph through existing MCP/service APIs.

Export:

```text
<output_dir>/graph-context/code-facts.json
<output_dir>/graph-context/blocks.json
<output_dir>/graph-context/connectors.json
```

### 15.4 block_graph_with_flows

Export:

```text
<output_dir>/graph-context/code-facts.json
<output_dir>/graph-context/blocks.json
<output_dir>/graph-context/connectors.json
<output_dir>/graph-context/flows.json
```

### 15.5 stale_or_incomplete_graph

Prepare a graph context that intentionally omits one feature or flow.

For the first fixture:

- omit `teams` or `comments`
- omit at least one shared dependency
- include at least one useful but incomplete flow

Export:

```text
<output_dir>/graph-context/stale-warning.json
```

Do not corrupt the source fixture. Graph contexts should live only in run output directories or temp directories.

## 16. CLI

Add script:

```json
"benchmark": "tsx scripts/benchmark.ts"
```

Required examples:

```text
pnpm benchmark --suite access-accuracy --adapter fixture --profile perfect
pnpm benchmark --suite access-accuracy --adapter fixture --profile weak
pnpm benchmark --suite access-accuracy --adapter file --answers-dir ./answers
pnpm benchmark --suite access-accuracy --adapter command --command "claude -p --output-format json --max-turns 20"
pnpm benchmark --suite access-accuracy --conditions no_graph,block_graph_with_flows
pnpm benchmark --suite access-accuracy --case fixture-login-flow --adapter fixture --profile perfect
```

Required CLI flags:

```text
--suite
--case
--conditions
--adapter
--profile
--answers-dir
--command
--output-dir
--timeout-ms
--model
--dry-run
```

Defaults:

```text
--suite access-accuracy
--conditions no_graph,code_facts_only,block_graph,block_graph_with_flows,stale_or_incomplete_graph
--adapter fixture
--profile perfect
--output-dir benchmarks/runs/<timestamp>
--timeout-ms 600000
```

`--dry-run` must load cases, build prompts, and write planned run metadata without executing an adapter.

## 17. Reports

Every run must write:

```text
<run_dir>/run.json
<run_dir>/events.jsonl
<run_dir>/report.md
<run_dir>/cases/<case_id>/<condition>/prompt.txt
<run_dir>/cases/<case_id>/<condition>/answer.json
<run_dir>/cases/<case_id>/<condition>/score.json
<run_dir>/cases/<case_id>/<condition>/raw-output.txt or raw-output.json
```

### 17.1 Markdown Report

The report must include:

- run metadata
- adapter and model
- cases run
- conditions run
- aggregate score by condition
- per-case score table
- top-k hit rates
- evidence validity
- warnings
- failed cases
- path to raw artifacts

Required comparison table:

```text
condition | overall | file_f1 | entity_f1 | block_f1 | flow_order | evidence | duration
```

The report must make it easy to answer:

- Did BlockGraph improve localization?
- Did flows improve path reconstruction?
- Did stale graph mislead the agent?
- Was the result supported by evidence?

## 18. First Benchmark Cases

Create at least five fixture cases.

### 18.1 fixture-login-flow

Type:

```text
entrypoint_path_location
```

Prompt:

```text
In the fixture app, a user submits the login form. Identify the most relevant files/entities/modules activated in order, from UI submit through auth service and shared API/client layers.
```

Expected areas:

- `src/features/auth/LoginForm.tsx`
- `src/features/auth/authService.ts`
- `src/hooks/useAuth.ts`
- `src/lib/apiClient.ts`
- `src/types/user.ts`
- Auth block
- Shared API/client block
- Shared hooks block

### 18.2 fixture-comment-submit-bug

Type:

```text
bug_localization
```

Prompt:

```text
A user can type a comment and submit it, but comments do not appear attached to the expected discussion. Where should an agent inspect first?
```

Expected areas:

- `src/features/comments/CommentForm.tsx`
- `src/features/comments/commentService.ts`
- `src/features/discussions/discussionService.ts`
- `src/types/comment.ts`
- Comments block
- Discussions block

### 18.3 fixture-auth-impact

Type:

```text
impact_analysis
```

Prompt:

```text
If the auth token attachment behavior changes, which files, entities, modules, and user flows are likely affected?
```

Expected areas:

- `src/features/auth/authService.ts`
- `src/hooks/useAuth.ts`
- `src/lib/apiClient.ts`
- feature services that call API client
- Auth block
- Shared API/client block
- Discussions/Comments/Teams/Users feature blocks as downstream users when evidence supports it

### 18.4 fixture-team-feature-landing

Type:

```text
feature_landing_zone
```

Prompt:

```text
We want to add team invitation approval. Which existing module should be extended, what new boundary or flow may be needed, and which shared modules should be referenced but not owned?
```

Expected areas:

- `src/features/teams/TeamList.tsx`
- `src/features/teams/teamService.ts`
- `src/types/team.ts`
- `src/lib/apiClient.ts`
- Teams block
- Shared API/client block
- Shared types block

### 18.5 fixture-discussion-cross-flow

Type:

```text
cross_module_flow_recovery
```

Prompt:

```text
Recover the cross-module path for viewing discussions and interacting with related comments. Which modules and files are involved?
```

Expected areas:

- `src/features/discussions/DiscussionList.tsx`
- `src/features/discussions/discussionService.ts`
- `src/features/comments/CommentForm.tsx`
- `src/features/comments/commentService.ts`
- `src/lib/apiClient.ts`
- Discussions block
- Comments block
- Shared API/client block

## 19. Tests

Automated tests must not call Claude Code, OpenCode, network, or real LLM APIs.

### 19.1 Schema Tests

Test:

- valid benchmark case loads
- invalid case fails with useful diagnostic
- valid agent answer loads
- invalid agent answer fails
- graph condition enum validation
- weighted expected item validation

### 19.2 Access Accuracy Scorer Tests

Test:

- perfect answer scores near 1
- weak answer scores lower than perfect
- wrong answer scores low
- top-k hit metrics work
- `must_not_include` penalty works
- flow order scoring handles exact, partial, and wrong order
- missing optional efficiency telemetry does not fail scoring

### 19.3 Runner Tests

Test:

- dry run writes planned run metadata
- fixture adapter run writes answer and score artifacts
- selected `--case` only runs one case
- selected `--conditions` only runs requested conditions
- run continues after a failed case and records failure
- output directory is created safely

### 19.4 Report Tests

Test:

- Markdown report includes aggregate condition table
- JSON report includes per-case metrics
- warnings are preserved
- raw artifact paths are listed

### 19.5 Graph Condition Tests

Test:

- code facts context exports scanned entities
- block graph context exports blocks
- flow context exports flows
- stale context omits configured feature/flow and records warning

## 20. Implementation Phases

Implement phases sequentially. Do not start a later phase until the current phase has tests and `HOT.md` is updated.

### Phase 0: Readiness

Goal:

- Confirm v0.2 is healthy and understand current graph APIs.

Required actions:

- Read `CLAUDE.md`.
- Read `HOT.md`.
- Read `docs/blockgraph-mcp-v0.2-prd.md`.
- Read this PRD.
- Run `pnpm test`.
- Run `pnpm exec tsc --noEmit -p tsconfig.json`.
- Inspect `src/mcp/tools.ts`, `src/graph/draft.ts`, `src/graph/store.ts`, and `fixtures/ts-react-complex`.
- Update `HOT.md` to record v0.2.5 starting state.

Validation:

- Existing tests pass.
- Typecheck passes.
- No benchmark code added yet except trivial doc/HOT corrections if needed.

### Phase 1: Benchmark Schemas And Case Loader

Goal:

- Add typed benchmark data models and JSON case loading.

Required implementation:

- Add `src/benchmark/schema.ts`.
- Add `src/benchmark/cases.ts`.
- Add Zod schemas for benchmark cases, goldens, final answers, run records, and events.
- Add loader that reads all cases from `benchmarks/<suite>/cases`.
- Add useful validation diagnostics.
- Add first five access-accuracy case JSON files.

Required tests:

- schema tests
- valid/invalid case loading
- duplicate case ID rejection

Validation:

- Focused benchmark schema tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 2: Access Accuracy Evaluator

Goal:

- Score agent answers against golden answers.

Required implementation:

- Add `src/benchmark/evaluators/types.ts`.
- Add `src/benchmark/evaluators/accessAccuracy.ts`.
- Implement precision/recall/F1.
- Implement top-k file/entity hit rate.
- Implement weighted expected item matching.
- Implement flow order scoring.
- Implement evidence validation against repo files and line ranges.
- Implement `must_not_include` penalty.
- Implement aggregate score.

Required tests:

- perfect/weak/wrong scoring tests
- flow scoring tests
- evidence validity tests
- missing telemetry tests

Validation:

- Focused evaluator tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 3: Fixture And File Adapters

Goal:

- Make the benchmark runnable without external agents.

Required implementation:

- Add adapter interface.
- Add fixture adapter.
- Add file adapter.
- Add fixture answers for `perfect`, `weak`, and `wrong` profiles for at least two cases.
- Add fixture answers for `perfect` profile for all five cases.
- Normalize all adapter outputs to `AgentFinalAnswer`.

Required tests:

- fixture adapter loads expected answer
- missing fixture answer fails clearly
- file adapter loads answer from directory
- invalid answer fails validation

Validation:

- Focused adapter tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 4: Graph Condition Preparation

Goal:

- Prepare graph contexts for each benchmark condition.

Required implementation:

- Add `src/benchmark/graphConditions.ts`.
- Implement context preparation for all five graph conditions.
- Reuse existing scanner and graph service APIs.
- Export context JSON files under the run case directory.
- Ensure `no_graph` exports no graph data.
- Ensure stale/incomplete condition records what was omitted.

Required tests:

- each condition prepares expected files
- code facts contain entities
- block graph condition contains blocks
- flow condition contains flows
- stale condition records omissions

Validation:

- Focused graph condition tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 5: Prompt Builder

Goal:

- Build deterministic prompts for all conditions and cases.

Required implementation:

- Add `src/benchmark/prompt.ts`.
- Include case prompt, condition instructions, repository path, context file paths, and required final JSON schema.
- Ensure prompts always say not to modify code.
- Ensure condition-specific restrictions are explicit.

Required tests:

- prompt includes no-graph restriction for `no_graph`
- prompt includes stale warning for stale condition
- prompt includes JSON schema instruction
- prompt includes repo path and case ID

Validation:

- Focused prompt tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 6: Runner And CLI

Goal:

- Run benchmark cases end to end.

Required implementation:

- Add `src/benchmark/run.ts`.
- Add `src/benchmark/events.ts`.
- Add `scripts/benchmark.ts`.
- Add `benchmark` script to `package.json`.
- Implement CLI flags listed in this PRD.
- Implement run directory creation.
- Implement event JSONL writing.
- Implement per-case artifact writing.
- Implement case failure isolation.
- Implement `--dry-run`.

Required tests:

- dry run
- selected case
- selected conditions
- fixture adapter full run
- failed case recorded and run continues

Validation:

- `pnpm benchmark --suite access-accuracy --adapter fixture --profile perfect --conditions no_graph --dry-run`
- `pnpm benchmark --suite access-accuracy --adapter fixture --profile perfect --conditions no_graph`
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 7: Command Adapter

Goal:

- Support Claude Code, OpenCode, or any external agent command without hard dependencies.

Required implementation:

- Add `src/benchmark/adapters/command.ts`.
- Write prompt to prompt file.
- Pass prompt through stdin unless command template explicitly uses `{prompt_file}`.
- Support template variables.
- Capture stdout and stderr.
- Enforce timeout.
- Parse final answer JSON.
- Preserve raw output.
- Fail clearly when command exits non-zero or output is invalid.

Required tests:

- command adapter can run a local node/tsx fixture command
- timeout is enforced
- invalid JSON fails clearly
- template variables are substituted

Do not:

- Require `claude` or `opencode` in tests.
- Parse Claude/OpenCode event streams deeply in v0.2.5.

Validation:

- Focused command adapter tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 8: Reports

Goal:

- Produce human-readable and machine-readable benchmark results.

Required implementation:

- Add `src/benchmark/report.ts`.
- Write `run.json`.
- Write `report.md`.
- Include aggregate condition comparison.
- Include per-case metrics.
- Include warnings and failures.
- Include raw artifact paths.

Required tests:

- report contains condition table
- report contains per-case rows
- warnings included
- run JSON schema valid

Validation:

- Run fixture benchmark.
- Inspect generated report.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 9: Documentation And Final Verification

Goal:

- Make the benchmark usable by future agents and contributors.

Required documentation:

- Add `benchmarks/access-accuracy/README.md`.
- Update `README.md` with benchmark section.
- Update `HOT.md` with final v0.2.5 state.
- Document Claude Code command adapter example.
- Document OpenCode command adapter example.
- Document how to score manually saved answers.

Required final checks:

```text
pnpm test
pnpm exec tsc --noEmit -p tsconfig.json
pnpm benchmark --suite access-accuracy --adapter fixture --profile perfect --conditions no_graph,block_graph_with_flows
pnpm benchmark --suite access-accuracy --adapter fixture --profile weak --conditions no_graph
```

Acceptance:

- All tests pass.
- Typecheck passes.
- Benchmark fixture runs produce reports.
- No external LLM or network is required for CI.

## 21. Acceptance Criteria

v0.2.5 is accepted only if:

1. Benchmark schemas are implemented and validated.
2. Five access-accuracy cases exist for `fixtures/ts-react-complex`.
3. Golden answers exist for all five cases.
4. Fixture adapter can run deterministic benchmark profiles.
5. File adapter can score saved answers.
6. Command adapter can invoke arbitrary local commands.
7. No automated test requires Claude Code, OpenCode, network, or an API key.
8. All five graph conditions are represented.
9. Prompt builder is condition-aware.
10. Access accuracy evaluator computes file/entity/block precision, recall, F1, top-k hits, flow score, evidence score, and aggregate score.
11. Benchmark event logs are written as JSONL.
12. Per-case artifacts are written.
13. `run.json` and `report.md` are generated.
14. CLI supports `--suite`, `--case`, `--conditions`, `--adapter`, `--profile`, `--answers-dir`, `--command`, `--output-dir`, `--timeout-ms`, `--model`, and `--dry-run`.
15. Full `pnpm test` passes.
16. `pnpm exec tsc --noEmit -p tsconfig.json` passes.
17. Fixture benchmark runs successfully.
18. Documentation explains how to run Claude Code manually or through the command adapter.
19. Documentation explains how to run OpenCode through the command adapter.
20. HOT.md records v0.2.5 completion and verification results.

## 22. Suggested Claude Code Goal

Use this goal:

```text
Implement BlockGraph MCP v0.2.5 according to docs/blockgraph-mcp-v0.2.5-benchmark-prd.md.

v0.2.5 adds a modular benchmark harness for agent repository access accuracy. It must preserve the existing BlockGraph mental model and v0.2 implementation. Do not implement code modification, runtime tracing, Playwright tracing, OpenTelemetry ingestion, or any v0.3 maintenance-time change protocol.

The benchmark core must be modular: case loader, repository preparation, graph condition preparation, prompt builder, agent adapters, evaluator modules, event logs, and reports. The first benchmark module is access-accuracy. Future modules should be replaceable without rewriting the core.

Implement benchmark schemas, access-accuracy cases and goldens, fixture/file/command adapters, graph condition preparation, condition-aware prompts, access-accuracy scoring, JSONL event logs, CLI runner, JSON and Markdown reports, tests, and docs.

Automated tests must not require Claude Code, OpenCode, network access, or an API key. Claude Code and OpenCode should be supported only through the generic command adapter examples.

Work phase by phase through Phase 0 to Phase 9. Update HOT.md before and after major work. Run focused tests for each phase, then full tests and typecheck. Do not move to the next phase until the current phase passes validation.
```

## 23. Suggested Claude Code Command Examples

These are examples for humans. The implementation must not depend on them in tests.

Claude Code:

```text
pnpm benchmark --suite access-accuracy --adapter command --conditions block_graph_with_flows --command "claude -p --output-format json --max-turns 20 --max-budget-usd 2.00"
```

OpenCode:

```text
pnpm benchmark --suite access-accuracy --adapter command --conditions block_graph_with_flows --command "opencode run --format json --dir {repo}"
```

Manual scoring:

```text
pnpm benchmark --suite access-accuracy --adapter file --answers-dir ./answers --conditions no_graph,block_graph_with_flows
```

