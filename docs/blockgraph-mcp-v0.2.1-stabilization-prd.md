# BlockGraph MCP v0.2.1 Stabilization PRD

## 1. Version Theme

BlockGraph MCP v0.2.1 is a small stabilization release before v0.2.5 benchmark work.

It fixes two real-world initialization blockers discovered while using v0.2 against a larger repository:

1. Proposal approval is not available through MCP tools, so the proposal -> review -> merge workflow cannot be completed by an agent using only MCP.
2. MCP server restarts lose the in-memory database handle, and the current `NO_SESSION` message makes persistent graph data appear lost even though it remains in `.blockgraph/blockgraph.db`.

This version must not expand product scope. It is a workflow repair release.

## 2. Scope

Implement only:

- A coordinator approval path for module proposals.
- A clearer and recoverable session reconnect path.
- Tests proving both real MCP workflows work end to end.
- Documentation updates for the repaired workflow.

Do not implement:

- v0.2.5 benchmark harness.
- v0.3 maintenance-time code change protocol.
- Runtime tracing.
- OpenTelemetry ingestion.
- Playwright tracing.
- Visual UI.
- Work package state machine redesign, except where strictly required by approval or merge behavior.
- Subagent permission fixes.

## 3. Problem 1: Proposal Approval Gap

### 3.1 Current Broken Workflow

Current MCP-visible flow:

```text
create_module_proposal
-> attach_proposal_entity / add_proposal_port / add_proposal_dependency / add_proposal_flow
-> submit_module_proposal       // proposal becomes submitted
-> submit_proposal_review       // review is recorded
-> merge_module_proposal        // fails because proposal is still submitted
```

`merge_module_proposal` requires proposal status `approved`, but no MCP tool can set a proposal to `approved`.

Tests currently bypass this by calling internal service function `updateModuleProposalStatus`, which is not available to real MCP users.

### 3.2 Required Design

Add a coordinator-only MCP tool:

```text
approve_module_proposal
```

This tool is the explicit transition from reviewed proposal to approved proposal.

The role split must remain:

- Module worker creates proposal.
- Reviewer reviews proposal.
- Coordinator approves proposal.
- Coordinator merges proposal.

`submit_proposal_review(status: "pass")` must not directly approve a proposal. Review pass is evidence for approval, not approval itself.

## 4. approve_module_proposal Tool

### 4.1 Input

```ts
{
  proposal_id: string;
  coordinator_agent?: string;
  notes?: string;
}
```

### 4.2 Output

```ts
{
  proposal_id: string;
  status: "approved";
  previous_status: string;
  review_count: number;
  pass_review_count: number;
  unresolved_blocking_findings: number;
}
```

### 4.3 Validation Rules

The tool must fail when:

- No active session exists.
- `proposal_id` is missing.
- Proposal does not exist.
- Proposal is `draft`.
- Proposal is `rejected`.
- Proposal is already `merged`.
- Proposal has no reviews.
- Proposal has no `pass` review.
- The latest review is `reject`.
- There is any unresolved P0/P1 finding.

Unresolved P0/P1 means a finding with priority `P0` or `P1` whose `resolution` is not `resolved` and not `rejected`.

The tool should allow approval from:

```text
submitted
reviewing
needs_revision
```

When current status is `submitted`, the tool may internally apply:

```text
submitted -> reviewing -> approved
```

When current status is `needs_revision`, approval is allowed only if there is a later `pass` review with no unresolved P0/P1 findings. If latest review ordering is hard to determine from existing data, require a `pass` review and document that v0.2.1 does not model review chronology beyond stored review order.

### 4.4 Status Transition

Prefer to preserve the existing proposal transition table.

Implementation may either:

- Call `updateModuleProposalStatus(db, proposal_id, "reviewing")` then `updateModuleProposalStatus(db, proposal_id, "approved")` when current status is `submitted`.
- Or add a dedicated service helper that validates approval conditions and performs legal intermediate transitions.

Do not use `updateModuleProposal` to bypass transition validation.

### 4.5 submit_proposal_review Adjustment

Update `submit_proposal_review` to return proposal status:

```ts
{
  review_id: string;
  status: string;
  proposal_id: string;
  proposal_status: string;
}
```

Recommended status side effects:

- If proposal is `submitted` and review status is `pass`, move proposal to `reviewing`.
- If proposal is `submitted` or `reviewing` and review status is `needs_revision`, move proposal to `needs_revision` when legal.
- If proposal is `submitted`, `reviewing`, or `needs_revision` and review status is `reject`, move proposal to `rejected` when legal.

Do not automatically approve on review pass.

If a legal transition is not possible, record the review but return a warning explaining that proposal status was not changed.

## 5. Problem 2: Session Reconnect UX

### 5.1 Current Behavior

MCP `ToolContext` stores the SQLite database handle in memory:

```ts
{
  db: Database | null;
  repoPath: string | null;
}
```

When the MCP server restarts, the database handle is lost. Graph data remains in:

```text
<target-repo>/.blockgraph/blockgraph.db
```

But subsequent tool calls return:

```text
NO_SESSION: No active session. Call begin_initialization first.
```

This message is misleading because calling `begin_initialization` does not necessarily destroy data; it reopens the existing database.

### 5.2 Required Design

Make repository-based reconnect explicit and safe.

`begin_initialization(repo_path)` must become open-or-resume:

- If `.blockgraph/blockgraph.db` does not exist or contains no prior graph data, return `resumed: false`.
- If the database exists and contains prior graph data, return `resumed: true`.
- It must not clear existing tables.
- It must return a summary of existing graph state.

Add a clearer alias tool:

```text
resume_initialization
```

`resume_initialization(repo_path)` may reuse the same implementation as `begin_initialization`, but its name makes recovery obvious to agents.

Add a read-only status tool:

```text
session_status
```

This returns whether there is an active in-memory session and, when active, the repository path, DB path, and graph summary.

### 5.3 NO_SESSION Message

All tools that require a DB should return a clearer message when no active session exists:

```text
No active in-memory BlockGraph session. Existing graph data may still exist in <repo>/.blockgraph/blockgraph.db. Call begin_initialization({ repo_path }) or resume_initialization({ repo_path }) to reconnect.
```

Because most tools do not know the repo path when `ctx.repoPath` is null, the message may use:

```text
the target repository
```

instead of a concrete path.

Implement a shared helper such as:

```ts
function noSessionError(): Diagnostic
```

Do not leave scattered string literals with the old message.

### 5.4 Session Summary

Return this summary from `begin_initialization`, `resume_initialization`, and `session_status` when active:

```ts
{
  code_entities: number;
  code_edges: number;
  blocks: number;
  work_packages: number;
  module_proposals: number;
  proposal_reviews: number;
  merged_proposals: number;
  flows: number;
  snapshots: number;
}
```

Add helper functions as needed. Avoid duplicating raw SQL count logic in many handlers.

### 5.5 list_module_proposals Tool

Add:

```text
list_module_proposals
```

Input:

```ts
{
  work_package_id?: string;
  status?: ModuleProposalStatus;
}
```

Output:

```ts
{
  proposals: ModuleProposal[];
}
```

Reason:

After reconnect, an agent needs to inspect proposal progress before deciding whether to review, approve, merge, or revise.

This tool is part of session recovery ergonomics, not a new product feature.

## 6. Implementation Phases

Keep this release small. Implement the following phases in order.

### Phase 0: Baseline And Reproduction

Goal:

- Verify the current issue and establish baseline health.

Required actions:

- Read `CLAUDE.md`.
- Read `HOT.md`.
- Read `issues/issue#1.md`.
- Read this PRD.
- Inspect:
  - `src/mcp/tools.ts`
  - `src/mcp/server.ts`
  - `src/graph/draft.ts`
  - `src/graph/store.ts`
  - `tests/reviews.test.ts`
  - `tests/merge.test.ts`
  - `tests/mcp-tools.test.ts`
- Run:
  - `pnpm test`
  - `pnpm exec tsc --noEmit -p tsconfig.json`

Required reproduction test planning:

- Identify at least one current test path that uses `updateModuleProposalStatus` directly to bypass MCP approval.
- Plan a new MCP-only test that fails before the fix:

```text
create proposal -> submit proposal -> submit pass review -> approve proposal -> merge proposal
```

Do not:

- Change product code in Phase 0 unless fixing trivial documentation typos.

Validation:

- Baseline tests and typecheck results are recorded in `HOT.md`.

### Phase 1: Proposal Approval MCP Path

Goal:

- Make proposal approval possible through MCP tools only.

Required implementation:

- Add `handleApproveModuleProposal` in `src/mcp/tools.ts`.
- Register `approve_module_proposal` in `src/mcp/server.ts`.
- Add any service helpers needed in `src/graph/draft.ts`.
- Update `handleSubmitProposalReview` to return `proposal_id` and `proposal_status`.
- Add status side effects for review submission where safe:
  - pass review may move `submitted -> reviewing`
  - needs_revision review may move proposal to `needs_revision`
  - reject review may move proposal to `rejected`
- Preserve coordinator-only merge behavior.
- Do not bypass legal status transitions.

Required tests:

- MCP-only happy path:
  - create work package
  - create proposal
  - attach entity
  - submit module proposal
  - submit pass review
  - approve module proposal
  - merge module proposal
- Approval fails with no reviews.
- Approval fails with no pass review.
- Approval fails with unresolved P0 finding.
- Approval succeeds after P0/P1 finding is resolved or rejected with reason.
- Approval fails when latest review is reject, if latest review ordering is implemented.
- Review pass does not directly approve proposal.
- Merge still rejects unapproved proposal.
- Existing merge tests still pass.

Validation:

- Focused review/merge tests pass.
- Full `pnpm test` passes.
- Typecheck passes.
- `HOT.md` records Phase 1 completion and verification.

### Phase 2: Session Reconnect And Recovery Tools

Goal:

- Make MCP restart recovery explicit, non-destructive, and easy for agents to understand.

Required implementation:

- Update `handleBeginInitialization` to return:

```ts
{
  session_id: string;
  repo_path: string;
  db_path: string;
  resumed: boolean;
  summary: SessionSummary;
}
```

- Add `handleResumeInitialization` in `src/mcp/tools.ts`.
- Register `resume_initialization` in `src/mcp/server.ts`.
- Add `handleSessionStatus` in `src/mcp/tools.ts`.
- Register `session_status` in `src/mcp/server.ts`.
- Add `handleListModuleProposals` in `src/mcp/tools.ts`.
- Register `list_module_proposals` in `src/mcp/server.ts`.
- Add a shared `noSessionError()` helper and replace old `NO_SESSION` messages.
- Add a shared session summary helper.
- Ensure no reconnect path deletes or truncates existing DB data.

Required tests:

- `begin_initialization` on empty repo returns `resumed: false`.
- `begin_initialization` on repo with existing graph data returns `resumed: true` and correct counts.
- New `ToolContext` simulates MCP server restart.
- After restart, a DB-requiring tool returns the improved `NO_SESSION` message.
- `resume_initialization(repo_path)` reconnects and existing work packages/proposals are visible.
- `session_status` returns inactive status before initialization.
- `session_status` returns active repo, db path, and summary after initialization.
- `list_module_proposals` supports no filter, `work_package_id`, and `status`.
- Reconnect does not duplicate or delete existing rows.

Validation:

- Focused session/recovery tests pass.
- Full `pnpm test` passes.
- Typecheck passes.
- `HOT.md` records Phase 2 completion and verification.

### Phase 3: Documentation And Final Verification

Goal:

- Make the repaired workflow clear for future autonomous initialization.

Required documentation:

- Update `docs/parallel-initialization-skill.md`:
  - Add explicit proposal approval step.
  - Explain that review pass is not approval.
  - Explain `approve_module_proposal`.
  - Add session recovery section.
  - Add use of `list_module_proposals` after reconnect.
- Update `docs/agent-initialization-skill.md` error table:
  - Clarify `NO_SESSION`.
  - Mention `resume_initialization`.
- Update `README.md` if it documents MCP tool lists or initialization workflow.
- Update `HOT.md` final state.

Required final verification:

```text
pnpm test
pnpm exec tsc --noEmit -p tsconfig.json
```

Acceptance:

- Proposal -> review -> approve -> merge works using only MCP handlers/tools.
- Reconnect after MCP server restart works without data loss.
- Agents can discover current proposal status after reconnect.
- Documentation reflects the actual workflow.
- All tests and typecheck pass.

## 7. Acceptance Criteria

v0.2.1 is accepted only if:

1. `approve_module_proposal` MCP tool exists.
2. `approve_module_proposal` enforces review and unresolved P0/P1 rules.
3. `submit_proposal_review` returns `proposal_status`.
4. Review pass does not automatically approve.
5. MCP-only proposal -> review -> approve -> merge test passes.
6. `begin_initialization` returns `resumed`, `db_path`, and session summary.
7. `resume_initialization` tool exists.
8. `session_status` tool exists.
9. `list_module_proposals` tool exists.
10. `NO_SESSION` message explains reconnect and persistent DB behavior.
11. Reconnect tests prove existing graph data remains visible.
12. Documentation describes approval and reconnect workflow.
13. Full `pnpm test` passes.
14. `pnpm exec tsc --noEmit -p tsconfig.json` passes.

## 8. Suggested Claude Code Goal

Use this goal:

```text
Implement BlockGraph MCP v0.2.1 stabilization according to docs/blockgraph-mcp-v0.2.1-stabilization-prd.md.

This is a small repair release before v0.2.5 benchmark work. Fix only the two documented blockers from issues/issue#1.md: proposal approval is missing from the MCP-visible workflow, and MCP session recovery after server restart is misleading/incomplete.

Implement approve_module_proposal, update submit_proposal_review to expose proposal_status without auto-approving, make begin_initialization open-or-resume with resumed/db_path/summary, add resume_initialization, session_status, and list_module_proposals, improve NO_SESSION messaging, and update the initialization skill docs.

Do not implement benchmark work, v0.3 maintenance-time code modification protocol, runtime tracing, OpenTelemetry ingestion, Playwright tracing, visual UI, or subagent permission fixes. Do not redesign the work package state machine except where strictly needed for these two fixes.

Work phase by phase through Phase 0 to Phase 3. Update HOT.md before and after major work. Run focused tests for each phase, then full pnpm test and typecheck. Do not move to the next phase until the current phase passes validation.
```

