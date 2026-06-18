# Roles And Concurrency

Use this reference before launching module workers or reviewers.

## Coordinator

The coordinator owns:

- session begin/resume
- repository scanning
- work package creation
- MCP writes only for coordinator-owned actions or fallback handoff
- proposal approval
- proposal merge
- compile/promote
- global connectors and flows
- quality gates
- final snapshot decision

Only the coordinator may:

- call `approve_module_proposal`
- call `merge_module_proposal`
- call `promote_draft_block`
- call `commit_snapshot`
- resolve cross-package ownership conflicts

## Module Worker

A module worker owns one work package.

It may:

- inspect source code
- use BlockGraph query/scanner tools
- create one module proposal through MCP
- attach owned/used/entrypoint entities through MCP
- add ports, dependencies, flows, and gaps through MCP
- submit its proposal through MCP

It must not:

- review its own proposal
- approve a proposal
- merge a proposal
- promote blocks
- commit snapshots
- claim ownership outside package scope
- modify business source code

## Proposal Reviewer

A proposal reviewer reviews one proposal and must be independent from the module worker.

It may:

- inspect source code
- inspect proposal contents
- submit a structured review through MCP
- identify missing entities, weak evidence, wrong ownership, weak flows, or bad dependencies

It must not:

- rewrite the proposal during first-pass review
- approve the proposal
- merge the proposal
- promote blocks
- commit snapshots

## Final Reviewer

The final reviewer reviews the whole merged graph after quality gates.

It must not trust completion claims. It checks source code, graph data, quality gates, and maintenance simulations.

## Execution Modes

### Preferred: MCP-Capable Subagents

Use this mode by default in auto-mode when subagents can access `mcp__blockgraph__*`.

```text
module workers write proposals through MCP
reviewers write reviews through MCP
coordinator serializes approve/merge/promote/snapshot
```

This is the simplest and fastest path. Do not make the coordinator re-enter proposal or review data that subagents already wrote through MCP.

### Full Parallel

Use when many independent work packages exist and subagents can use MCP tools reliably.

```text
workers run in parallel
reviewers start as soon as proposals submit
coordinator serializes approvals and merges
```

### Pipeline Parallel

Use by default.

```text
worker A submits -> reviewer A starts
worker B continues
reviewer A returns -> coordinator resolves/approves/merges
```

Pipeline parallel is the preferred scheduling pattern even when full parallelism is unavailable.

### Serial Simulation

Use when subagents are unavailable or unreliable.

Keep role separation in the order of reasoning:

```text
module proposal pass
independent review pass
coordinator approval pass
merge pass
```

Do not collapse worker and reviewer into one unchecked self-review.

### Degraded Direct Graph

Use only if proposal tooling is unavailable or blocked.

Directly create blocks through:

```text
create_block
attach_code_entity
create_port
connect_ports
create_flow
append_flow_step
compile_draft_block
promote_draft_block
```

Record the run as degraded. Do not claim v0.2 proposal/review protocol was completed.

## Subagent MCP Probe

Default assumption in auto-mode is that subagents can use MCP tools. If unsure, ask one small test subagent to call:

```text
mcp__blockgraph__list_work_packages
```

If it cannot produce a real tool result, use subagents for analysis/review JSON only and let the coordinator perform MCP writes for proposals and reviews. Keep coordinator-only actions unchanged.
