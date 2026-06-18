---
name: blockgraph-init
description: Initialize or resume a repository BlockGraph model using MCP tools, work packages, module proposals, independent proposal reviews, coordinator approval, quality gates, and snapshots. Use when preparing a repository architecture graph for maintenance or benchmark initialization.
---

# BlockGraph Init

Use this skill to initialize the current repository with BlockGraph MCP. This is an architecture-modeling workflow, not a code-modification workflow.

## Non-Negotiable Rules

1. Never write graph JSON, SQLite rows, or `.blockgraph` data directly.
2. The coordinator is the only agent that approves proposals, merges proposals, promotes blocks, and commits snapshots.
3. Every proposal needs an independent review from an agent that did not create it.
4. A reviewer `pass` is not approval. Approval is a separate coordinator step.
5. Coordinator self-checks, conflict checks, and quality gates do not count as independent proposal review.
6. As soon as one proposal is submitted, start an independent reviewer for it while other module workers continue.
7. If a session is lost, reconnect to the existing DB; do not restart blindly.
8. Trust source code over graph data when they conflict, and record the conflict as a finding or unknown boundary.
9. This skill is a preview workflow. When a significant new problem appears, try to resolve it, then report it under `.blockgraph/issues/`.

## Load References

Load only the reference needed for the current step:

- Start or resume a run: `references/recovery.md`
- Run the full initialization protocol: `references/workflow.md`
- Launch workers/reviewers: `references/roles-and-concurrency.md`
- Use MCP tools correctly: `references/mcp-tools.md`
- Need worker/reviewer JSON: `references/schemas.md`
- Review a proposal or final graph: `references/review-rubrics.md`
- Any tool error or ambiguous state: `references/error-handling.md`
- New issue, workaround, blocker, or unexpected workflow gap: `references/issue-reporting.md`
- Before snapshot: `references/quality-gates.md`

## Default Flow

```text
preflight
-> begin/resume
-> scan code facts
-> create work packages
-> pipeline module proposals and independent reviews
-> coordinator resolves findings
-> coordinator approves proposals
-> coordinator merges approved proposals
-> compile and promote blocks
-> add connectors, flows, unknown boundaries
-> run quality gates
-> final independent review
-> commit snapshot
```

## First Actions

1. Confirm the `blockgraph` MCP server is enabled.
2. Read `references/recovery.md`.
3. Call `begin_initialization` or `resume_initialization` with the repository path.
4. Call `session_status` if available.
5. Call `list_work_packages`, `list_module_proposals`, `coverage_report`, and `quality_gate_report` when resuming.
6. Continue from the first incomplete work package/proposal, not from the beginning.

## Execution Mode

Preferred mode is MCP-capable subagents.

In preferred mode:

- Module workers directly create, fill, and submit proposals through MCP.
- Proposal reviewers directly submit reviews through MCP.
- The coordinator does not rewrite worker/reviewer output into MCP unless fallback is required.

Keep these actions coordinator-only:

- `approve_module_proposal`
- `merge_module_proposal`
- `promote_draft_block`
- `commit_snapshot`
- cross-package ownership conflict decisions
- final global connectors and flows

If a subagent MCP probe fails, switch only that part to structured JSON handoff from `references/schemas.md`.

## Completion Rule

Do not claim initialization complete unless:

- `compile_draft_graph` has no errors.
- `quality_gate_report.ready_for_maintenance` is true or every blocker is explicitly documented as deferred.
- No open P0/P1 proposal review finding remains.
- A final independent review has checked the merged graph.
- A snapshot was committed, or the reason for not committing is explicitly recorded.
- Significant new issues encountered during initialization are recorded in `.blockgraph/issues/`.
