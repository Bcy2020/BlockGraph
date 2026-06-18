# BlockGraph MCP v0.2 — Parallel Initialization Skill

This guide instructs agents on how to initialize a repository using BlockGraph MCP v0.2 with parallel work packages, module proposals, proposal reviews, and quality gates.

## Core Rules

1. **Never write graph JSON directly.** Always call MCP tools.
2. **Coordinator is the only writer** that merges proposals into the draft/accepted graph.
3. **Module agents produce proposals.** They do not mutate the accepted graph.
4. **Quality gate readiness is required** before snapshot commit.
5. **Evidence is mandatory** for non-root block mappings, connectors, and flow steps.

## Execution Profiles

### Standard Subagent Profile

Use when:
- Repository is small or medium
- Only a few work packages (≤6)
- Coordinator can manage the sequence manually
- Review depth matters more than maximum parallelism

Shape:
- One coordinator in the main session
- A small number of module subagents
- Proposal review subagents as needed
- One final review subagent

### Dynamic Workflow Profile

Use when:
- Repository has many independent work packages (>6)
- Proposals and reviews can run in large batches
- Findings need cross-checking
- Repeatability matters

Shape:
- Scripted workflow with phases
- Parallel agent spawning for proposals
- Parallel agent spawning for reviews
- Serialized merge by coordinator

### Ultracode Profile

Ultracode combines xhigh reasoning with automatic dynamic workflow planning.

Use when:
- Validation repository has >6 work packages
- Proposal review needs >2 independent review batches
- Maximum quality is required

Note: Ultracode is not a product requirement. It is an execution accelerator.

## Initialization Workflow

### Step 0: Restore Context

Read:
- `CLAUDE.md`
- `HOT.md`
- `docs/blockgraph-mcp-v0.2-prd.md`
- `CONTRIBUTING.md`

Confirm:
- v0.2 is about initialization quality
- Coordinator is the only graph merge writer
- Module agents produce proposals
- Quality gate readiness is required before snapshot

### Step 1: Scan Repository

Coordinator calls:
- `begin_initialization`
- `scan_repo`
- `list_code_entities`
- `list_code_edges`
- `suggest_block_candidates`
- `coverage_report`
- `detect_missing_modules`
- `detect_shared_dependencies`

### Step 2: Create Work Packages

Coordinator creates work packages with stable IDs.

Work packages should cover:
- App shell
- Feature modules
- Shared UI
- Shared types
- Shared utilities
- Shared hooks
- API/data access
- Config/build
- Testing/e2e when in scope

### Step 3: Assign Module Agents

For each package, assign a module worker.

In standard mode, spawn subagents sequentially or in small batches.
In dynamic workflow mode, spawn module agents in parallel.

### Step 4: Produce Module Proposals

Each module agent creates a proposal with:
- Owned entities
- Used entities
- Entrypoints
- Ports
- Internal flows
- Dependencies
- Unknown boundaries
- Coverage gaps
- Confidence

### Step 5: Review Module Proposals

Each submitted proposal gets a review.

Reviewer checks:
- Evidence truth
- Missing in-scope entities
- Wrong ownership
- Weak dependencies
- Weak flows
- Shared code misclassified as module-owned

### Step 6: Resolve Proposal Findings

Coordinator resolves proposal findings:
- Accepted and fixed
- Rejected with reason
- Deferred with reason

P0/P1 findings must be fixed before merge.

### Step 7: Approve Proposals

After all P0/P1 findings are resolved or rejected, coordinator approves each proposal:

```
Call approve_module_proposal({ proposal_id: "<id>" })
```

**Important:** `submit_proposal_review(status: "pass")` does NOT automatically approve a proposal. Review pass is evidence for approval, not approval itself. You must explicitly call `approve_module_proposal`.

Approval fails if:
- No reviews exist
- No pass review exists
- Unresolved P0/P1 findings remain

### Step 8: Merge Approved Proposals

Coordinator merges proposals in this order:
1. Root block
2. App shell
3. Shared foundation
4. Feature modules
5. UI components
6. Testing/config/infrastructure
7. Cross-module connectors
8. Global flows
9. Unknown boundaries

### Step 9: Compile Blocks

After merge, coordinator runs:
- `compile_draft_block`
- `promote_draft_block`

Fix compile errors before continuing.

### Step 10: Build Connectors And Flows

Coordinator creates:
- High-confidence connectors
- Unknown boundaries
- Global flows

Do not invent evidence.
External library behavior must be labeled as external behavior.

### Step 11: Run Quality Gates

Coordinator runs:
- `compile_draft_graph`
- `coverage_report`
- `detect_missing_modules`
- `detect_shared_dependencies`
- `connector_audit`
- `flow_sufficiency_check`
- `quality_gate_report`

If not ready, revise proposals or graph.

### Step 12: Final Independent Review

Fresh reviewer reviews:
- Source code
- Graph report
- Quality gate report
- Proposal reviews

Run at least three maintenance simulations:
- Locate code path for a user action
- Impact analysis for a shared service change
- Choose target block for a new feature

### Step 13: Commit Snapshot

Only commit snapshot if:
- `compile_draft_graph` has no errors
- `quality_gate_report.ready_for_maintenance = true`
- No open P0/P1 finding
- Maintenance simulations pass at least 2/3

## Work Package ID Rules

IDs should be stable, readable, and lowercase kebab-case.

Examples:
- `wp-app-shell`
- `wp-auth`
- `wp-feature-discussions`
- `wp-feature-comments`
- `wp-feature-teams`
- `wp-feature-users`
- `wp-shared-ui`
- `wp-shared-types`
- `wp-shared-utils`
- `wp-shared-hooks`
- `wp-api-client`
- `wp-config-build`
- `wp-testing`

## Common Failure Cases

### Low Coverage

**Symptom:** Quality gate reports `entity_coverage` below threshold.

**Fix:** Model more entities or document exclusions.

### Missing Feature Modules

**Symptom:** Quality gate reports `missing_feature_modules`.

**Fix:** Create work packages and proposals for unmodeled features.

### Unexplained Cross-Block Edges

**Symptom:** Connector audit reports `unexplained_edges`.

**Fix:** Create connectors or mark unknown boundaries.

### Insufficient Flows

**Symptom:** Flow sufficiency check fails.

**Fix:** Create more flows covering different user actions.

### Duplicate Ownership

**Symptom:** Conflict checker reports `duplicate_ownership`.

**Fix:** Resolve ownership conflicts by removing duplicate claims.

### Unresolved P0/P1 Findings

**Symptom:** Merge rejected due to unresolved findings.

**Fix:** Fix the issue, reject the finding with reason, or defer with coordinator override.

## Session Recovery

If the MCP server restarts or the session is lost, graph data persists in `.blockgraph/blockgraph.db`.

### Reconnecting

```
Call begin_initialization({ repo_path: "/path/to/repo" })
```

If existing data is found, the response includes `resumed: true` and a summary of existing graph state. No data is lost.

Alternatively, use the explicit reconnect alias:

```
Call resume_initialization({ repo_path: "/path/to/repo" })
```

### Checking Session Status

```
Call session_status({})
```

Returns whether there is an active session, the repo path, DB path, and graph summary.

### Inspecting Proposals After Reconnect

After reconnecting, check proposal progress:

```
Call list_module_proposals({})
Call list_module_proposals({ work_package_id: "wp-auth" })
Call list_module_proposals({ status: "submitted" })
```

This helps you decide whether to review, approve, merge, or revise proposals.

### Degraded Path: Direct Block Creation

If the proposal workflow is unavailable, you can bypass it:

1. `create_block` — create draft block directly
2. `attach_code_entity` — attach code entities
3. `create_port` — create ports
4. `compile_draft_block` — compile
5. `promote_draft_block` — promote to accepted
