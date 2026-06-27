# Access Accuracy Benchmark

Evaluates whether an initialized BlockGraph helps an agent locate relevant code, recover activation paths, and reason about impact more accurately than ordinary repository search.

## Quick Start

```bash
# Dry run (plan only)
pnpm benchmark --dry-run

# Run with fixture adapter (deterministic, no LLM needed)
pnpm benchmark --adapter fixture --profile perfect --conditions no_graph

# Run with fixture adapter, all conditions
pnpm benchmark --adapter fixture --profile perfect

# Compare profiles
pnpm benchmark --adapter fixture --profile perfect --conditions no_graph
pnpm benchmark --adapter fixture --profile weak --conditions no_graph
```

## Benchmark Cases

| Case ID | Type | Description |
|---------|------|-------------|
| `fixture-login-flow` | entrypoint_path_location | Login form submit path through auth → API client |
| `fixture-comment-submit-bug` | bug_localization | Comment not appearing on expected discussion |
| `fixture-auth-impact` | impact_analysis | Auth token change impact on all services |
| `fixture-team-feature-landing` | feature_landing_zone | Where to add team invitation approval |
| `fixture-discussion-cross-flow` | cross_module_flow_recovery | Discussion + comment cross-module path |
| `fixture-orphaned-code` | bug_localization | Detect exported functions never imported or called |
| `fixture-api-endpoint-map` | cross_module_flow_recovery | Map HTTP endpoints to service functions and components |
| `fixture-shared-dep-impact` | impact_analysis | Shared apiClient change impact on all feature modules |
| `fixture-error-handling-gaps` | bug_localization | Async operations lacking try/catch error handling |
| `fixture-component-prop-trace` | cross_module_flow_recovery | Data flow from API type → service → state → render |

## Graph Conditions

| Condition | Description |
|-----------|-------------|
| `no_graph` | Baseline: ordinary code search only |
| `code_facts_only` | Scanner-derived entities and edges |
| `block_graph` | Code facts + semantic block decomposition |
| `block_graph_with_flows` | Code facts + blocks + entrypoint-triggered flows |
| `stale_or_incomplete_graph` | Intentionally incomplete graph (tests graph-risk) |

## Adapters

### Fixture Adapter (deterministic)

Reads predefined answers from `fixture-answers/<profile>/`. No LLM needed.

```bash
pnpm benchmark --adapter fixture --profile perfect
pnpm benchmark --adapter fixture --profile weak
pnpm benchmark --adapter fixture --profile wrong
```

### File Adapter (score saved answers)

Scores previously saved agent answers from a directory.

```bash
# Run agent manually, save answer as JSON
pnpm benchmark --adapter file --answers-dir ./my-answers
```

Answer file naming: `<case_id>.<condition>.json` or `<case_id>.json`

### Command Adapter (external agent)

Executes an external command for each case.

```bash
# Claude Code
pnpm benchmark --adapter command --command "claude -p --output-format json --max-turns 20 --max-budget-usd 2.00"

# OpenCode
pnpm benchmark --adapter command --command "opencode run --format json --dir {repo}"
```

Template variables: `{repo}`, `{case_id}`, `{condition}`, `{output_dir}`, `{prompt_file}`

## Output

Each run produces:

```
benchmarks/runs/<timestamp>/
├── run.json              # Full run data (machine-readable)
├── events.jsonl          # JSONL event log
├── report.md             # Human-readable report
├── plan.json             # (dry-run only)
└── cases/
    └── <case_id>/
        └── <condition>/
            ├── prompt.txt
            ├── answer.json
            ├── score.json
            └── graph-context/
                ├── code-facts.json
                ├── blocks.json
                ├── connectors.json
                ├── flows.json
                └── stale-warning.json
```

## Real Fix Probe: Cal DIY Video Fallback

A repair-oriented probe was run against `benchmarks/repos/cal-diy-web` for
`BUG_REPORT_VIDEO_FALLBACK.md`: third-party video meeting creation fails, Cal
Video fallback succeeds, but the returned result remains marked as failed.

Both agents produced the same minimal patch in
`packages/features/conferencing/lib/videoClient.ts`: the catch fallback return
object should include `success: !!defaultMeeting`. This is a valid repair for
downstream code that reads `EventResult.success`, including app status rendering
and video detail extraction.

The BlockGraph-guided run used MCP to identify the video work package and the
`Video Conferencing` module before reading source, which shortened the
localization path. Its total recorded cost was higher (`164.1k` input tokens vs
`146.7k`) because it also performed more post-fix validation: searched
consumers, looked for tests, inspected test configuration, and attempted a
targeted test run. These actions should not be counted as pure localization
overhead; the baseline run may also have covered some validation inside its
exploration agent trace.

For future repair probes, report three stages separately:

1. **Localization**: first correct module/file, files read before first edit,
   MCP/tool calls, and tokens before first edit.
2. **Patch**: whether the first edit is correct, minimal, and aligned with the
   reported bug.
3. **Validation**: consumer checks, test discovery, test execution, and any
   unresolved product semantics.

This probe also exposed one product-semantic caveat: the one-line fix corrects
the success flag, but the code still sends `sendBrokenIntegrationEmail` before
attempting fallback. If the intended behavior is "fallback success should not
notify users about a broken integration," a second change is required; if the
notification is meant to report the third-party provider failure even after a
successful fallback, the one-line success fix is sufficient for the core
downstream failure.

## Scoring

**Aggregate formula:**
- Without efficiency telemetry: `overall = 0.80 × accuracy + 0.20 × evidence`
- With efficiency telemetry: `overall = 0.70 × accuracy + 0.20 × evidence + 0.10 × efficiency`

**Accuracy metrics:** file/entity/block precision, recall, F1, top-k hits, flow order score

**Evidence metrics:** file existence rate, line validity rate, entity validity rate, unsupported claim count

**Penalties:** must_not_include violations (−0.05 each), unsupported evidence (−0.03 each)

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--suite` | `access-accuracy` | Benchmark suite name |
| `--case` | (all) | Specific case ID (can repeat) |
| `--conditions` | (all 5) | Comma-separated conditions |
| `--adapter` | `fixture` | Adapter: fixture, file, command |
| `--profile` | `perfect` | Fixture profile: perfect, weak, wrong |
| `--answers-dir` | — | Directory for file adapter |
| `--command` | — | Command for command adapter |
| `--output-dir` | `benchmarks/runs/<timestamp>` | Output directory |
| `--timeout-ms` | `600000` | Timeout per case |
| `--model` | — | Model name for reporting |
| `--dry-run` | false | Plan only, no execution |
