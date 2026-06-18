# MCP Tools

Use this reference for BlockGraph MCP tool order and important semantics.

## Session And Recovery

```text
begin_initialization
resume_initialization
session_status
```

`begin_initialization` and `resume_initialization` should reconnect to existing `.blockgraph/blockgraph.db` data when present.

## Scanner And Query

```text
scan_repo
list_code_entities
list_code_edges
suggest_block_candidates
query_block
query_symbols_by_block
```

Code facts come from scanner output. Do not manually invent code entities.

## Work Packages

```text
create_work_package
list_work_packages
update_work_package_status
check_work_package_conflicts
```

Work packages isolate module-worker scope. Use stable `wp-` IDs.

## Module Proposals

```text
create_module_proposal
list_module_proposals
attach_proposal_entity
add_proposal_port
add_proposal_dependency
add_proposal_flow
mark_proposal_gap
submit_module_proposal
```

Proposals are intermediate artifacts. They are not accepted graph data.

## Proposal Reviews And Approval

```text
submit_proposal_review
list_proposal_reviews
resolve_proposal_finding
approve_module_proposal
```

Important:

- `submit_proposal_review(status: "pass")` records a review.
- Review pass is not approval.
- `approve_module_proposal` is the coordinator approval step.
- Unresolved P0/P1 findings block approval and merge.

## Merge

```text
merge_module_proposal
list_merged_proposals
```

Only merge approved proposals. Merge writes to the draft graph, not directly to snapshots.

## Draft Graph Editing

Use these mainly for global connectors/flows or degraded direct graph mode:

```text
create_block
attach_code_entity
create_port
connect_ports
mark_unknown_boundary
create_flow
append_flow_step
```

## Compile, Promote, Snapshot

```text
compile_draft_block
promote_draft_block
compile_draft_graph
commit_snapshot
```

Never promote a block that fails compile. Never snapshot a graph with compile errors.

## Quality Gates

```text
coverage_report
detect_missing_modules
detect_shared_dependencies
connector_audit
flow_sufficiency_check
quality_gate_report
```

Quality gates decide whether a compilable graph is useful enough for maintenance.

