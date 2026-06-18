# Workflow

Use this reference for the complete BlockGraph initialization protocol.

## Table Of Contents

- Phase 0: Preflight
- Phase 1: Begin Or Resume
- Phase 2: Scan And Inventory
- Phase 3: Work Package Plan
- Phase 4: Proposal Pipeline
- Phase 5: Independent Review Pipeline
- Phase 6: Approval And Merge
- Phase 7: Compile, Promote, Connect, Flow
- Phase 8: Quality Gates
- Phase 9: Final Review
- Phase 10: Snapshot And Report
- Issue Reporting During Any Phase

## Phase 0: Preflight

Confirm:

- The task is repository initialization, not business-code modification.
- The `blockgraph` MCP server is enabled.
- The repository path is the target repository root.
- The repository has a stable git commit or a documented dirty state.

Do not edit business source code during initialization.

## Phase 1: Begin Or Resume

Call one of:

```text
begin_initialization({ repo_path })
resume_initialization({ repo_path })
```

Then inspect:

```text
session_status
list_work_packages
list_module_proposals
coverage_report
quality_gate_report
```

If prior state exists, continue from the first incomplete package/proposal. Do not duplicate existing work packages or proposals.

## Phase 2: Scan And Inventory

Call:

```text
scan_repo
list_code_entities
list_code_edges
suggest_block_candidates
detect_missing_modules
detect_shared_dependencies
```

Build an inventory of:

- app shell
- feature modules
- shared UI
- shared types
- shared utilities
- shared hooks
- API/client/data access
- config/build infrastructure
- testing/e2e when in scope

## Phase 3: Work Package Plan

Create stable work package IDs:

```text
wp-app-shell
wp-auth
wp-feature-<name>
wp-shared-ui
wp-shared-types
wp-shared-utils
wp-shared-hooks
wp-api-client
wp-config-build
wp-testing
wp-e2e
```

Each work package must define:

- `scope_paths`
- `included_entity_ids` when useful
- `excluded_entity_ids` when needed
- `allowed_external_refs`
- `forbidden_ownership`
- `dependencies_on_packages`
- `open_questions`

Run `check_work_package_conflicts` before module workers begin.

## Phase 4: Proposal Pipeline

Launch module workers for independent packages. Preferred mode is MCP-capable subagents: workers directly create, fill, and submit proposals through MCP.

Each module worker must produce exactly one proposal for one package.

The worker must:

- claim only in-scope owned entities
- mark shared code as `uses`, not `owns`
- call `create_module_proposal`
- call `attach_proposal_entity` for owned/used/entrypoint entities
- call `add_proposal_port` for boundary interactions
- call `add_proposal_dependency` with evidence
- call `add_proposal_flow` only when evidence supports the flow
- call `mark_proposal_gap` or mark unknown boundaries instead of inventing connectors
- call `submit_module_proposal`

Only if MCP tools are unavailable to the worker, the worker returns `ModuleProposalDraft` JSON from `schemas.md` and the coordinator writes it through MCP.

## Phase 5: Independent Review Pipeline

Do not wait for every module worker to finish.

When any proposal is submitted:

1. Start an independent reviewer for that proposal.
2. Continue other module workers while review runs.
3. The reviewer directly records the review through `submit_proposal_review`.
4. If MCP tools are unavailable to the reviewer, have the reviewer return `ProposalReviewDraft` JSON and the coordinator records it.

The reviewer must not be the same agent/pass that created the proposal.

Coordinator conflict checks, quality gates, and self-review do not count as proposal review.

## Phase 6: Approval And Merge

For each reviewed proposal:

1. Resolve review findings with `resolve_proposal_finding`.
2. Ensure no unresolved P0/P1 finding remains.
3. Call `approve_module_proposal`.
4. Call `merge_module_proposal`.

Review `pass` is not approval. Approval is explicit coordinator action.

Merge order:

1. app shell/root
2. shared foundation
3. feature modules
4. UI components
5. testing/config/infrastructure
6. cross-module connectors
7. global flows
8. unknown boundaries

## Phase 7: Compile, Promote, Connect, Flow

After merge:

```text
compile_draft_block
promote_draft_block
compile_draft_graph
```

Then create or refine:

- connectors with source-backed evidence
- unknown boundaries for uncertain interactions
- global flows for important entrypoints

Do not claim external library behavior is implemented in local code. Mark it as external behavior in notes/evidence.

## Phase 8: Quality Gates

Run:

```text
coverage_report
detect_missing_modules
detect_shared_dependencies
connector_audit
flow_sufficiency_check
quality_gate_report
```

If not ready, revise packages/proposals/graph. Do not snapshot a model that fails hard quality gates.

## Phase 9: Final Review

Launch a fresh final reviewer after coordinator merge and quality gates.

The final reviewer checks:

- source code against graph model
- proposal reviews and finding resolutions
- quality gate results
- connector and flow evidence

Run at least three maintenance simulations:

- locate code path for a user action
- impact analysis for a shared service change
- choose target block for a new feature

## Phase 10: Snapshot And Report

Commit a snapshot only when:

- `compile_draft_graph` has no errors
- `quality_gate_report.ready_for_maintenance` is true, or every exception is explicitly documented
- no open P0/P1 finding remains
- final review has no blocking findings

Record:

- snapshot ID
- git SHA
- coverage
- known limitations
- deferred issues

## Issue Reporting During Any Phase

This skill is a preview workflow. If a significant new problem appears:

1. Try to understand and resolve it using source inspection, MCP state queries, and `error-handling.md`.
2. If resolved, continue the initialization.
3. Write an issue report under `.blockgraph/issues/` describing the problem and the resolution.
4. If unresolved, write a blocker issue report under `.blockgraph/issues/` before stopping or deferring.

Do not hide workflow problems in the final summary only. Use the issue report format in `issue-reporting.md`.
