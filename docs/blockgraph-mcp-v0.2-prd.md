# BlockGraph MCP v0.2 PRD

## 1. Version Theme

BlockGraph MCP v0.2 is about **parallel initialization and quality gates**.

v0.1 proved that BlockGraph can initialize a repository into a structurally valid architecture graph:

- scan repository
- create blocks, ports, connectors, flows
- compile draft blocks
- promote accepted blocks
- commit snapshots

The complex-repository review showed the next problem:

> A graph can compile successfully while still missing modules, shared dependencies, important connectors, and enough flows to be useful for maintenance.

v0.2 must therefore make complex initialization auditable and revision-driven.

The goal is not to make automatic decomposition perfect. The goal is to make incomplete or incorrect decomposition visible, reviewable, and fixable before a model is declared ready for maintenance use.

## 2. Product Positioning

BlockGraph MCP remains a constrained graph editor for architecture-first repository maintenance.

v0.2 adds:

- work packages as parallel initialization boundaries
- module proposals as reviewed intermediate artifacts
- proposal reviews as structured quality feedback
- quality gates for coverage, missing modules, shared dependencies, connectors, and flows
- complex initialization workflows that can use multiple agents safely

MCP is still the structured execution layer. The repository maintenance method remains the product.

## 3. Core Mental Model

The existing three graph layers remain unchanged:

1. **Code Fact Graph**
   - Mechanical graph generated from source code.
   - Source of truth for files, entities, edges, and evidence.

2. **Block Graph**
   - Semantic graph edited through MCP tools.
   - Represents modules, ports, connectors, and mappings.

3. **Flow Graph**
   - Entry-triggered process graph.
   - Represents user/system flows through blocks and code entities.

The existing state protocol remains unchanged:

```text
draft -> compile -> promote -> snapshot
```

v0.2 adds a pre-merge proposal layer:

```text
work package -> module proposal -> proposal review -> coordinator merge -> compile -> promote -> quality gate -> snapshot
```

## 4. v0.2 Goals

v0.2 must support initialization of medium and complex TypeScript / React / Node repositories with multiple agents.

Required outcomes:

1. The coordinator can divide a repository into isolated work packages.
2. Module agents can produce module proposals without directly mutating the accepted graph.
3. Review agents can review module proposals and record findings.
4. The coordinator can merge approved proposals into the draft graph.
5. The system can report coverage gaps, missing feature modules, shared dependency candidates, unexplained cross-block edges, weak connectors, and insufficient flows.
6. A quality gate report can decide whether the initialized model is ready for maintenance use.
7. A complex fixture or real repository test demonstrates that v0.2 detects problems like the bulletproof-react review:
   - missing feature module
   - unmapped shared utilities/types/hooks
   - missing connectors
   - weak flow evidence
   - insufficient flows

## 5. Non-Goals For v0.2

Do not implement these in v0.2:

- Architecture-first code change protocol.
- Bugfix, feature, or refactor enforcement for real code edits.
- Runtime tracing.
- Playwright click tracing.
- OpenTelemetry integration.
- Visual graph UI.
- Multi-language scanners beyond the existing TS/JS support.
- Neo4j or external graph databases.
- Automatic perfect module naming.
- Automatic perfect architecture recovery.
- Concurrent writes to the accepted graph by child agents.
- Automatic modification of business code.

v0.2 is still about initialization quality, not maintenance-time code editing.

## 6. Agent Execution Model

v0.2 must distinguish the product protocol from Claude Code's execution mode.

Reference Claude Code concepts:

- Subagents: https://code.claude.com/docs/en/agents
- Dynamic workflows: https://code.claude.com/docs/en/workflows

The product protocol is:

```text
coordinator creates work packages
module workers produce proposals
review workers review proposals
coordinator merges approved proposals
quality gates decide readiness
```

This protocol must be testable without relying on Claude Code actually spawning agents. Automated tests should simulate multiple workers by creating isolated work packages, proposals, reviews, and merges through MCP/service APIs.

Claude Code execution modes only affect how much real agent parallelism is used while initializing or reviewing a repository.

### 6.1 Subagents In Standard Mode

Standard Claude Code mode can still spawn subagents. Subagents are delegated workers inside one main session. The main agent decides, turn by turn, which subagents to start and how to use their returned summaries.

Use standard subagents when:

- the repository is small or medium
- there are only a few work packages
- the coordinator can manage the sequence manually
- review depth matters more than maximum parallelism

Expected shape:

- one coordinator in the main session
- a small number of module subagents
- proposal review subagents as needed
- one final review subagent

This mode is valid for v0.2 implementation work and for medium-repository initialization.

### 6.2 Dynamic Workflows

Dynamic workflows are scripts that orchestrate many subagents and retain intermediate results in workflow state rather than the main context. They are appropriate when a task outgrows a few subagents or needs repeatable, cross-checked phases.

Use a dynamic workflow when:

- the repository has many independent work packages
- proposals and proposal reviews can run in large batches
- findings need cross-checking
- repeatability matters
- the coordinator would otherwise be overloaded by subagent summaries

Dynamic workflows are a good fit for complex repository initialization, because the intended process is already phased:

```text
scan -> package -> propose -> review -> merge -> quality gate -> final review
```

### 6.3 Ultracode

Ultracode is a Claude Code effort setting that combines xhigh reasoning with automatic dynamic workflow planning for substantive tasks.

Ultracode is not a different product requirement. It is an execution accelerator.

For v0.2:

- The implementation must not depend on Ultracode-only behavior.
- Automated tests must not require Ultracode.
- The real complex-repository validation exercise should use Ultracode or an explicit dynamic workflow when there are more than 6 work packages or more than 2 proposal-review batches.
- If Ultracode is unavailable, the same protocol must still be executable with standard subagents, though likely slower and less parallel.

### 6.4 Execution Requirement For This Project

For normal v0.2 implementation:

- Ultracode is recommended but not required.
- Standard subagents are allowed and should be used for independent review or separable implementation/review tasks.

For the complex-repository initialization validation:

- Use Ultracode or an explicit dynamic workflow unless the repository is intentionally reduced to a small/medium test case.
- Treat Ultracode or explicit dynamic workflow as required when the validation repository has more than 6 work packages or when proposal review needs more than 2 independent review batches.
- Record which execution mode was used in the final report.

### 6.5 Shared Safety Rule

All modes must follow the same safety rule:

> Parallelize understanding and review. Serialize graph merging.

Even when many subagents or a workflow are used, the coordinator remains the only writer that merges proposals into the draft/accepted graph.

## 7. Multi-Agent Collaboration Rules

### 7.1 Coordinator Agent

The coordinator owns:

- repository scanning
- work package creation
- work package assignment
- proposal merge order
- shared and cross-cutting modules
- cross-module connectors
- global flows
- quality gates
- final snapshot decision

The coordinator is the only agent allowed to:

- merge module proposals into the draft graph
- promote blocks
- commit snapshots
- resolve cross-package ownership conflicts
- create global connectors and global flows

### 7.2 Module Agent

A module agent owns one work package.

It may:

- read source code
- read code entities and edges
- produce a module proposal
- identify owned entities
- identify used external entities
- propose ports
- propose internal flows
- propose incoming/outgoing dependencies
- mark unknown boundaries
- list coverage gaps

It must not:

- promote blocks
- commit snapshots
- mutate the accepted graph
- claim ownership of entities outside its work package without explicit coordinator approval
- modify another work package proposal
- resolve global shared dependencies by itself

### 7.3 Proposal Reviewer Agent

A proposal reviewer reviews one module proposal.

It must:

- verify evidence against source code
- check whether owned entities belong in the module
- find missing entities within scope
- check external refs
- check proposed ports and dependencies
- check internal flows
- identify weak or false evidence

It must not:

- modify the proposal during first-pass review
- merge the proposal
- promote blocks
- rewrite global graph structure

### 7.4 Final Reviewer Agent

The final reviewer performs a full-model review after coordinator merge and quality gates.

It must:

- not trust HOT.md completion claims
- inspect actual graph reports and source code
- review quality gate results
- run maintenance simulations
- report findings before summaries

## 8. Work Packages

Work packages are the isolation boundaries for parallel initialization.

Every work package must have a stable ID.

### 8.1 WorkPackage Data Model

Required fields:

- `id: string`
- `name: string`
- `type: "feature" | "app_shell" | "shared" | "ui" | "testing" | "config" | "infrastructure" | "unknown"`
- `status: "planned" | "assigned" | "proposed" | "reviewing" | "needs_revision" | "approved" | "merged" | "rejected" | "deferred"`
- `scope_paths: string[]`
- `included_entity_ids: string[]`
- `excluded_entity_ids: string[]`
- `allowed_external_refs: string[]`
- `forbidden_ownership: string[]`
- `dependencies_on_packages: string[]`
- `owner_agent?: string`
- `open_questions: string[]`
- `notes?: string`

### 8.2 Work Package ID Rules

IDs should be stable, readable, and lowercase kebab-case.

Examples:

```text
wp-app-shell
wp-auth
wp-feature-discussions
wp-feature-comments
wp-feature-teams
wp-feature-users
wp-shared-ui
wp-shared-types
wp-shared-utils
wp-shared-hooks
wp-api-client
wp-config-build
wp-testing
wp-e2e
```

### 8.3 Work Package Isolation Rules

Each work package must define:

1. **Owned scope**
   - Paths and entities the module agent may claim as `owns`.

2. **Allowed external refs**
   - Entities the module agent may reference as `uses`, but not own.

3. **Forbidden ownership**
   - Paths and entities the module agent must not claim.

Example:

```text
id: wp-auth
scope_paths:
  - src/features/auth/**
  - src/lib/auth.tsx
  - src/lib/authorization.tsx
allowed_external_refs:
  - src/lib/api-client.ts
  - src/types/api.ts
  - src/components/ui/**
  - src/config/paths.ts
forbidden_ownership:
  - src/components/ui/**
  - src/utils/**
  - src/testing/**
```

### 8.4 Conflict Checks

Before merge, the system must detect:

- the same code entity claimed as `owns` by multiple proposals
- ownership outside scope
- undeclared external references
- proposal references to missing work packages
- connector dependencies whose source or target package is missing
- orphan feature directories
- orphan shared dependency directories
- packages approved without review

## 9. Module Proposals

Module proposals are structured intermediate artifacts. They are not accepted graph data.

### 9.1 ModuleProposal Data Model

Required fields:

- `id: string`
- `work_package_id: string`
- `module_name: string`
- `module_type: "feature" | "app_shell" | "shared" | "ui" | "testing" | "config" | "infrastructure" | "unknown"`
- `purpose: string`
- `owned_code_entities: ProposalEntity[]`
- `used_code_entities: ProposalEntity[]`
- `entrypoints: ProposalEntity[]`
- `ports: ProposalPort[]`
- `internal_flows: ProposalFlow[]`
- `outgoing_dependencies: ProposalDependency[]`
- `incoming_dependencies: ProposalDependency[]`
- `unknown_boundaries: ProposalUnknownBoundary[]`
- `coverage_gaps: ProposalGap[]`
- `confidence: number`
- `status: "draft" | "submitted" | "reviewing" | "needs_revision" | "approved" | "rejected" | "merged"`

### 9.2 ProposalEntity

Fields:

- `code_entity_id: string`
- `role: "owns" | "uses" | "entrypoint" | "adapter" | "helper" | "unknown"`
- `evidence: Evidence[]`
- `reason: string`
- `confidence: number`

### 9.3 ProposalPort

Fields:

- `name: string`
- `direction: "in" | "out"`
- `contract: string`
- `evidence: Evidence[]`
- `confidence: number`

### 9.4 ProposalDependency

Fields:

- `target_work_package_id?: string`
- `target_code_entity_id?: string`
- `direction: "incoming" | "outgoing"`
- `protocol: "function_call" | "http" | "event" | "state" | "render" | "config" | "type" | "unknown"`
- `evidence: Evidence[]`
- `reason: string`
- `confidence: number`

### 9.5 ProposalFlow

Fields:

- `name: string`
- `entrypoint_entity_id: string`
- `steps: ProposalFlowStep[]`
- `confidence: number`

### 9.6 ProposalFlowStep

Fields:

- `order: number`
- `code_entity_id: string`
- `trigger: string`
- `evidence: Evidence[]`
- `confidence: number`

### 9.7 ProposalGap

Fields:

- `kind: "missing_entity" | "unclear_ownership" | "missing_dependency" | "weak_evidence" | "needs_coordinator_decision" | "other"`
- `related_entity_ids: string[]`
- `description: string`
- `suggested_resolution?: string`

## 10. Proposal Reviews

### 10.1 ProposalReview Data Model

Required fields:

- `id: string`
- `proposal_id: string`
- `reviewer_agent?: string`
- `status: "pass" | "needs_revision" | "reject"`
- `findings: ReviewFinding[]`
- `coverage_notes: string`
- `evidence_notes: string`
- `recommended_fixes: string[]`

### 10.2 ReviewFinding

Fields:

- `priority: "P0" | "P1" | "P2" | "P3"`
- `title: string`
- `description: string`
- `file_path?: string`
- `start_line?: number`
- `code_entity_id?: string`
- `expected: string`
- `observed: string`
- `recommendation: string`

### 10.3 Proposal Approval Rules

A proposal can become `approved` only when:

- it has at least one review
- no P0 or P1 finding remains unresolved
- all owned entities are within scope or explicitly approved by coordinator
- evidence paths and line ranges are valid
- open coverage gaps are either fixed or marked for coordinator resolution

## 11. Quality Gates

Quality gates evaluate the initialized model beyond basic compile validity.

### 11.1 QualityGateReport Data Model

Required fields:

- `id: string`
- `created_at: string`
- `repo_complexity: "small" | "medium" | "complex"`
- `entity_coverage: number`
- `runtime_entity_coverage: number`
- `feature_directory_coverage: number`
- `unmapped_entities: string[]`
- `unmapped_directories: string[]`
- `missing_feature_modules: string[]`
- `shared_dependency_candidates: SharedDependencyCandidate[]`
- `unexplained_cross_block_edges: string[]`
- `weak_connectors: WeakConnector[]`
- `flow_count: number`
- `missing_flow_recommendations: string[]`
- `open_review_findings: string[]`
- `maintenance_simulation_results: MaintenanceSimulationResult[]`
- `ready_for_maintenance: boolean`
- `errors: Diagnostic[]`
- `warnings: Diagnostic[]`

### 11.2 Coverage Thresholds

Default thresholds:

- small repository: `entity_coverage >= 0.80`
- medium repository: `entity_coverage >= 0.85`
- complex repository: `entity_coverage >= 0.85`
- feature directory coverage: `1.00`, unless a directory is explicitly excluded or deferred

The quality gate must allow documented exclusions for:

- generated files
- build output
- dependency directories
- storybook examples when intentionally out of scope
- tests when the model explicitly excludes test infrastructure

Exclusions must be explicit. Silent omissions are not allowed.

### 11.3 Missing Module Detection

The system must detect likely feature modules from directories such as:

- `src/features/*`
- `src/modules/*`
- `src/domains/*`
- `src/app/routes/*`

If a feature directory contains API, hooks, components, routes, or non-trivial code entities and no work package/block owns it, report it as a missing module candidate.

### 11.4 Shared Dependency Detection

The system must detect shared dependency candidates from:

- `src/types`
- `src/utils`
- `src/hooks`
- `src/lib`
- `src/config`
- shared UI components

Heuristics:

- used by multiple work packages
- imported by multiple feature blocks
- contains global types, helper functions, hooks, clients, config, or providers

The report must recommend whether each candidate should be:

- own shared block
- part of App Shell
- part of UI Components
- intentionally excluded

### 11.5 Connector Audit

The system must inspect cross-block code edges and identify:

- no connector
- no unknown boundary
- connector exists but evidence does not support the source-target relationship
- connector direction likely reversed
- connector protocol likely wrong
- cross-block edge explained only by weak natural language

High-confidence cross-block edges must be explained by connector, unknown boundary, or documented exclusion.

### 11.6 Flow Sufficiency

Flow sufficiency must consider repository complexity.

Minimum flow counts:

- small repository: at least 1 flow
- medium repository: at least 3 flows
- complex repository: at least 5 flows

For React applications, recommended flow categories:

- authentication or primary entry flow
- list/detail read flow
- create/update/delete mutation flow
- profile/settings/admin flow when present
- cross-feature integration flow when present

Flow evidence must be honest:

- If runtime behavior happens in an external library, mark it as external behavior.
- Do not claim a local file line implements a behavior it only indirectly enables.

## 12. MCP Tool Requirements

v0.2 must add tools in five groups.

### 12.1 Work Package Tools

#### create_work_package

Creates a planned work package.

Required input:

- `id`
- `name`
- `type`
- `scope_paths`
- `included_entity_ids`
- `excluded_entity_ids`
- `allowed_external_refs`
- `forbidden_ownership`
- `dependencies_on_packages`

Validation:

- ID must be unique.
- Scope paths must be repo-relative.
- Entity IDs must exist when provided.

#### list_work_packages

Lists work packages by status or type.

#### update_work_package_status

Updates package status.

Validation:

- Must enforce legal status transitions.
- Cannot move to `approved` without an approved proposal review.
- Cannot move to `merged` unless merge succeeds.

#### check_work_package_conflicts

Reports:

- duplicate ownership claims
- scope violations
- missing dependencies
- undeclared external refs
- unreviewed proposals

### 12.2 Proposal Tools

#### create_module_proposal

Creates a proposal for one work package.

Validation:

- Work package must exist.
- Work package must not already have a merged proposal.

#### attach_proposal_entity

Adds owned/used/entrypoint entity evidence to a proposal.

Validation:

- Entity must exist.
- Evidence must be valid.
- `owns` must be inside package scope unless explicitly allowed.

#### add_proposal_port

Adds a proposed port.

#### add_proposal_dependency

Adds incoming or outgoing dependency evidence.

#### add_proposal_flow

Adds internal proposed flow.

#### mark_proposal_gap

Records unresolved module-local uncertainty.

#### submit_module_proposal

Marks proposal as ready for review.

Validation:

- Proposal must have purpose.
- Proposal must include at least one owned entity unless the package is explicitly abstract/shared.
- Proposal must include coverage notes or gaps.

### 12.3 Proposal Review Tools

#### submit_proposal_review

Records a structured review.

Validation:

- Proposal must exist.
- Findings must include priority, expected, observed, recommendation.

#### list_proposal_reviews

Lists reviews and findings.

#### resolve_proposal_finding

Marks a finding resolved, rejected, or deferred.

Validation:

- P0/P1 cannot be deferred without coordinator override reason.

### 12.4 Merge Tools

#### merge_module_proposal

Coordinator-only operation that merges an approved proposal into the draft graph.

Validation:

- Proposal must be approved.
- Work package must not already be merged.
- No unresolved P0/P1 finding.
- No duplicate ownership conflict.
- No scope violation.

Behavior:

- Create or update draft block.
- Attach owned entities.
- Attach entrypoints.
- Create draft ports.
- Create draft internal flows when applicable.
- Record proposal-to-block mapping.
- Do not automatically create global connectors unless explicitly requested.

#### list_merged_proposals

Returns proposal/block merge mappings.

### 12.5 Quality Gate Tools

#### coverage_report

Reports mapped/unmapped entities and directories.

#### detect_missing_modules

Detects likely missing feature modules from directory structure and code facts.

#### detect_shared_dependencies

Detects shared dependency candidates.

#### connector_audit

Audits cross-block code edges and connector evidence.

#### flow_sufficiency_check

Evaluates whether flows are sufficient for repository complexity.

#### quality_gate_report

Runs all quality checks and returns ready/not-ready decision.

Validation:

- Must run `compile_draft_graph`.
- Must include coverage, missing modules, shared dependencies, connector audit, flow sufficiency, and open review findings.
- Must set `ready_for_maintenance = false` if any P0/P1 quality error exists.

## 13. Initialization Skill Workflow

v0.2 must update the agent initialization skill to the following flow.

### Step 0: Restore Context

Read:

- `CLAUDE.md`
- `HOT.md`
- `docs/blockgraph-mcp-v0.2-prd.md`
- `CONTRIBUTING.md`

Confirm:

- v0.2 is about initialization quality
- coordinator is the only graph merge writer
- module agents produce proposals
- quality gate readiness is required before snapshot

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

- app shell
- feature modules
- shared UI
- shared types
- shared utilities
- shared hooks
- API/data access
- config/build
- testing/e2e when in scope

### Step 3: Assign Module Agents

For each package, assign a module worker.

In real Claude Code initialization, the coordinator should spawn actual module subagents. Standard mode can spawn subagents and may use a smaller number of them.

Ultracode or an explicit dynamic workflow should be used when many packages can be processed concurrently.

Automated tests may simulate module workers through isolated proposal creation because tests cannot depend on Claude Code runtime subagent behavior.

Both modes must maintain package isolation.

### Step 4: Produce Module Proposals

Each module agent creates a proposal with:

- owned entities
- used entities
- entrypoints
- ports
- internal flows
- dependencies
- unknown boundaries
- coverage gaps
- confidence

### Step 5: Review Module Proposals

Each submitted proposal gets a review.

Reviewer checks:

- evidence truth
- missing in-scope entities
- wrong ownership
- weak dependencies
- weak flows
- shared code misclassified as module-owned

### Step 6: Resolve Proposal Findings

Coordinator resolves proposal findings:

- accepted and fixed
- rejected with reason
- deferred with reason

P0/P1 findings must be fixed before merge.

### Step 7: Merge Approved Proposals

Coordinator merges proposals in this order:

1. root block
2. app shell
3. shared foundation
4. feature modules
5. UI components
6. testing/config/infrastructure
7. cross-module connectors
8. global flows
9. unknown boundaries

### Step 8: Compile Blocks

After merge, coordinator runs:

- `compile_draft_block`
- `promote_draft_block`

Fix compile errors before continuing.

### Step 9: Build Connectors And Flows

Coordinator creates:

- high-confidence connectors
- unknown boundaries
- global flows

Do not invent evidence.

External library behavior must be labeled as external behavior.

### Step 10: Run Quality Gates

Coordinator runs:

- `compile_draft_graph`
- `coverage_report`
- `detect_missing_modules`
- `detect_shared_dependencies`
- `connector_audit`
- `flow_sufficiency_check`
- `quality_gate_report`

If not ready, revise proposals or graph.

### Step 11: Final Independent Review

Fresh reviewer reviews:

- source code
- graph report
- quality gate report
- proposal reviews

Run at least three maintenance simulations:

- locate code path for a user action
- impact analysis for a shared service change
- choose target block for a new feature

### Step 12: Commit Snapshot

Only commit snapshot if:

- `compile_draft_graph` has no errors
- `quality_gate_report.ready_for_maintenance = true`
- no open P0/P1 finding
- maintenance simulations pass at least 2/3

## 14. Reports

v0.2 must generate or expose enough data for these reports.

### 14.1 Work Package Report

Includes:

- work package IDs
- scope paths
- status
- owner agent
- proposal IDs
- review status
- merge status
- unresolved questions

### 14.2 Proposal Report

Includes:

- proposal summary
- owned/used entities
- entrypoints
- ports
- dependencies
- flows
- gaps
- review findings

### 14.3 Quality Gate Report

Includes:

- coverage metrics
- missing modules
- shared dependency candidates
- connector audit findings
- flow sufficiency findings
- open review findings
- final ready/not-ready decision

### 14.4 Final Initialization Report

Includes:

- repository summary
- block tree
- coverage metrics
- unmapped/excluded entities
- connectors summary
- flows summary
- unknown boundaries
- quality gate result
- review findings and resolutions
- maintenance simulation results
- snapshot ID and git SHA
- known limitations

## 15. Tests

v0.2 must add tests at four levels.

### 15.1 Unit Tests

Test:

- create work package
- reject duplicate package ID
- reject invalid scope/entity refs
- legal status transitions
- proposal creation
- proposal entity scope validation
- proposal review submission
- finding resolution
- merge rejection for unapproved proposal
- merge rejection for duplicate ownership
- quality report data model

### 15.2 Complex Fixture Tests

Create a complex fixture or extend fixtures to include:

- auth feature
- discussions feature
- comments feature
- teams feature
- users feature
- app shell
- shared UI
- shared types
- shared utilities
- shared hooks
- config/build files
- testing infrastructure

Tests must verify:

- missing module detector finds an unmodeled feature
- shared dependency detector finds shared utils/types/hooks
- connector audit finds unexplained cross-block edges
- flow sufficiency fails when only one flow exists for complex repo
- quality gate returns not ready when coverage/connectors/flows are insufficient
- quality gate returns ready after the required fixes are modeled

### 15.3 Real Repository Smoke Test

Use a documented public repository and fixed commit.

Recommended target:

- `bulletproof-react` at a fixed commit or tag

Test requirements:

- scan repository
- create work packages
- create at least a partial proposal set
- run quality gates
- verify quality gates can identify concrete revision actions

The real repository test does not need to fully auto-fix all issues, but it must prove the quality gate detects the same class of problems found in manual review.

### 15.4 Multi-Agent Simulation Test

Because automated tests cannot depend on Claude Code subagent behavior, simulate multi-agent behavior with isolated proposal creation:

- package A creates proposal A
- package B creates proposal B
- reviews are submitted independently
- coordinator merges only approved proposals
- conflict checker rejects duplicate ownership

This proves the protocol, even when real subagents are not running.

## 16. Documentation Requirements

Update or add:

- `README.md`
- `docs/agent-initialization-skill.md`
- `docs/parallel-initialization-skill.md`
- `CONTRIBUTING.md` if collaboration rules change
- v0.2 tool reference

Documentation must explain:

- standard subagent profile
- dynamic workflow profile
- Ultracode profile
- coordinator-only merge rule
- work package ID rules
- proposal and review workflow
- quality gate readiness criteria
- common failure cases

## 17. Acceptance Criteria

v0.2 is accepted only if:

1. Work package tools are implemented.
2. Module proposal tools are implemented.
3. Proposal review tools are implemented.
4. Merge tools are implemented and coordinator-only semantics are documented.
5. Quality gate tools are implemented.
6. Work package conflict checks catch duplicate ownership and scope violations.
7. Proposal reviews can block merge.
8. Approved proposals can merge into draft graph.
9. Unapproved or rejected proposals cannot merge.
10. Coverage report identifies unmapped entities and directories.
11. Missing module detector identifies unmodeled feature directories.
12. Shared dependency detector identifies shared utils/types/hooks/lib/config candidates.
13. Connector audit identifies unexplained cross-block edges.
14. Flow sufficiency check fails insufficient complex models.
15. Quality gate report returns `ready_for_maintenance = false` for incomplete complex initialization.
16. Quality gate report can return `ready_for_maintenance = true` after modeled fixes in fixture tests.
17. Complex fixture tests pass.
18. Real repository smoke test exists and is documented.
19. Multi-agent simulation test passes.
20. `pnpm test` passes.
21. `pnpm exec tsc --noEmit -p tsconfig.json` passes.
22. Documentation explains standard and Ultracode execution profiles.

## 18. Phased Implementation Plan

This section is the execution plan for a coding agent. Implement phases sequentially. Do not start a later phase until the current phase has tests, documentation updates where relevant, and HOT.md progress updates.

Each phase must preserve v0.1 behavior. Existing tests must continue to pass.

### Phase 0: Readiness And Baseline

Goal:

- Confirm that the v0.1 implementation is healthy before adding v0.2.

Required actions:

- Read `CLAUDE.md`, `HOT.md`, `CONTRIBUTING.md`, `docs/blockgraph-mcp-v0.1-prd.md`, and this PRD.
- Run `pnpm test`.
- Run `pnpm exec tsc --noEmit -p tsconfig.json`.
- Inspect existing schema, store, draft graph services, compiler, scanner, MCP tools, and tests.
- Update `HOT.md` with the v0.2 starting state.

Do not:

- Change product code in Phase 0 except for trivial documentation correction if required.

Validation:

- Existing v0.1 tests pass.
- Existing typecheck passes.
- HOT.md records the v0.2 plan and current phase.

### Phase 1: Work Package Model

Goal:

- Add work packages as isolated units for parallel initialization.

Required implementation:

- Add `WorkPackage` types to schema.
- Add SQLite tables and store methods.
- Add service methods for create/list/get/update status.
- Add legal status transition validation.
- Add basic conflict checker skeleton.
- Add MCP tools:
  - `create_work_package`
  - `list_work_packages`
  - `update_work_package_status`
  - `check_work_package_conflicts`

Required tests:

- create package succeeds
- duplicate package ID rejected
- invalid entity refs rejected
- invalid scope path rejected when path traversal is attempted
- legal status transitions pass
- illegal status transitions fail
- conflict checker returns no conflicts for isolated packages

Do not:

- Implement proposals yet.
- Merge anything into the graph yet.

Validation:

- Focused Phase 1 tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 2: Module Proposal Model

Goal:

- Allow module workers to create structured proposals without touching the accepted graph.

Required implementation:

- Add proposal types and storage tables.
- Add proposal service methods.
- Add scope validation for owned entities.
- Add allowed external ref validation for used entities.
- Add proposal gaps.
- Add proposal status transitions.
- Add MCP tools:
  - `create_module_proposal`
  - `attach_proposal_entity`
  - `add_proposal_port`
  - `add_proposal_dependency`
  - `add_proposal_flow`
  - `mark_proposal_gap`
  - `submit_module_proposal`

Required tests:

- proposal creation succeeds for existing work package
- proposal creation fails for missing work package
- owned in-scope entity succeeds
- owned out-of-scope entity fails unless explicitly allowed
- used external entity succeeds only when in allowed refs or dependency scope
- invalid evidence fails
- submit fails when proposal has no meaningful content
- proposal records gaps and confidence

Do not:

- Implement proposal review or merge yet.
- Promote proposal data directly into accepted graph.

Validation:

- Focused Phase 2 tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 3: Proposal Review Model

Goal:

- Add review artifacts that can approve, reject, or request revision for module proposals.

Required implementation:

- Add review and finding types/tables.
- Add review service methods.
- Add finding resolution states.
- Add approval blocking rules.
- Add MCP tools:
  - `submit_proposal_review`
  - `list_proposal_reviews`
  - `resolve_proposal_finding`

Required tests:

- review submission succeeds for proposal
- review submission fails for missing proposal
- malformed finding rejected
- P0/P1 finding blocks approval
- resolved P0/P1 no longer blocks approval
- rejected finding requires reason
- deferred P0/P1 requires coordinator override reason

Do not:

- Merge proposals yet.
- Treat review text as a substitute for structured findings.

Validation:

- Focused Phase 3 tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 4: Coordinator Merge

Goal:

- Allow only approved proposals to merge into the draft graph under coordinator control.

Required implementation:

- Add proposal-to-block mapping table.
- Implement `merge_module_proposal`.
- Implement `list_merged_proposals`.
- Expand conflict checker to include duplicate ownership, scope violations, undeclared external refs, missing package dependencies, and unreviewed proposals.
- Ensure merge writes only draft graph entities and never commits snapshots automatically.

Required tests:

- approved proposal merges into draft block
- merge creates block mappings and ports
- merge creates internal flows where applicable
- unapproved proposal rejected
- rejected proposal rejected
- unresolved P0/P1 rejected
- duplicate ownership rejected
- scope violation rejected
- second merge of same proposal rejected
- accepted graph is not directly mutated except through existing promotion tools

Do not:

- Automatically create global connectors from all dependencies.
- Automatically promote merged blocks.
- Commit snapshots.

Validation:

- Focused Phase 4 tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 5: Quality Gates

Goal:

- Determine whether an initialized model is ready for maintenance use, not merely structurally compilable.

Required implementation:

- Implement `coverage_report`.
- Implement `detect_missing_modules`.
- Implement `detect_shared_dependencies`.
- Implement `connector_audit`.
- Implement `flow_sufficiency_check`.
- Implement `quality_gate_report`.
- Add data models for reports and findings.
- Make `quality_gate_report` call or reuse `compile_draft_graph`.

Required tests:

- coverage report lists unmapped entities and directories
- missing module detector finds unmodeled feature folders
- shared dependency detector finds utils/types/hooks/lib/config candidates used by multiple packages or blocks
- connector audit finds cross-block edge without connector/unknown boundary
- connector audit flags weak or unsupported connector evidence when detectable
- flow sufficiency fails complex repo with only one flow
- quality gate returns not ready for incomplete complex fixture
- quality gate returns ready after modeled fixes in fixture

Do not:

- Require automatic perfect fixes.
- Make warnings disappear silently.
- Treat documented exclusions as unmapped failures.

Validation:

- Focused Phase 5 tests pass.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 6: Complex Fixture And Multi-Agent Protocol Simulation

Goal:

- Prove the v0.2 protocol works independently of whether Claude Code actually spawns subagents.

Required implementation:

- Add or extend a complex fixture with:
  - auth
  - discussions
  - comments
  - teams
  - users
  - app shell
  - shared UI
  - shared types
  - shared utilities
  - shared hooks
  - config/build files
  - testing or e2e files when useful
- Add multi-agent simulation tests:
  - package A proposal
  - package B proposal
  - independent reviews
  - coordinator merges only approved proposals
  - conflict checker rejects duplicate ownership
- Add test cases that intentionally omit Teams/shared utilities/flows and verify quality gates report them.
- Add test cases that model the missing pieces and verify quality gate readiness.

Required tests:

- multi-agent simulation passes
- incomplete complex fixture is not ready
- corrected complex fixture is ready

Do not:

- Depend on actual Claude Code subagents in automated tests.
- Depend on Ultracode in automated tests.

Validation:

- Full `pnpm test` passes.
- Typecheck passes.

### Phase 7: Parallel Initialization Skill And Reports

Goal:

- Document the real multi-agent initialization process and produce useful reports for humans and agents.

Required implementation:

- Update `docs/agent-initialization-skill.md` or keep it as v0.1 and add `docs/parallel-initialization-skill.md`.
- Add report generation or report resources for:
  - work package report
  - proposal report
  - quality gate report
  - final initialization report
- Update README with v0.2 concepts and commands.
- Update CONTRIBUTING.md if collaboration rules changed.

Required documentation content:

- standard subagent profile
- dynamic workflow profile
- Ultracode profile
- when Ultracode is recommended or required for validation exercises
- coordinator-only merge rule
- work package ID rules
- module proposal workflow
- proposal review workflow
- quality gate readiness criteria
- common failure cases

Validation:

- Docs link to the new PRD and skill.
- Report tests or snapshots include required fields.
- Full `pnpm test` passes.
- Typecheck passes.

### Phase 8: Real Repository Smoke Test

Goal:

- Validate that v0.2 detects realistic initialization quality problems in a real repository.

Required implementation:

- Add a documented real repository target and fixed commit/tag.
- Recommended target: `bulletproof-react` at a fixed commit or tag.
- Add or update smoke test script.
- Run scan, work package creation, partial or full proposal creation, quality gates, and report generation.
- Document expected findings.

Required behavior:

- The smoke test does not need to fully auto-fix the real repository graph.
- It must prove that quality gates detect concrete revision actions like missing feature modules, shared dependencies, missing connectors, weak flow evidence, or insufficient flows.
- If the real repository is too large or network is unavailable, the script must fail clearly and not corrupt local state.

Validation:

- Smoke test runs on the documented repository when network is available.
- Full `pnpm test` passes.
- Typecheck passes.
- HOT.md records the smoke result.

### Phase 9: Final Independent Review

Goal:

- Verify the implementation against this PRD before declaring v0.2 complete.

Required actions:

- Use a fresh review agent if available.
- Review actual implementation, tests, docs, and reports.
- Run:
  - `pnpm test`
  - `pnpm exec tsc --noEmit -p tsconfig.json`
  - documented real repository smoke test when feasible
- Map every acceptance criterion to PASS, PARTIAL, or FAIL.
- Fix all actionable P0/P1 findings.
- Fix or explicitly defer P2 findings.

Validation:

- Final review has no unresolved P0/P1.
- Verification commands are recorded in HOT.md.
- v0.2 completion status is recorded.

## 19. Suggested Claude Code Goal

Use this goal:

```text
Implement BlockGraph MCP v0.2 according to docs/blockgraph-mcp-v0.2-prd.md.

v0.2 adds parallel initialization and quality gates. It must preserve the v0.1 mental model: Code Fact Graph, Block Graph, Flow Graph, and draft -> compile -> promote -> snapshot.

Important Claude Code execution model:
- Standard mode can use subagents.
- Dynamic workflows can orchestrate many subagents and keep intermediate state outside the main context.
- Ultracode combines xhigh reasoning with automatic dynamic workflow planning.
- The product implementation must not depend on Ultracode.
- Automated tests must simulate the multi-agent protocol through work packages, proposals, reviews, and merges.
- For complex real-repository validation, use Ultracode or an explicit dynamic workflow when available; otherwise use standard subagents and record the limitation.

Implement work packages, module proposals, proposal reviews, coordinator-only proposal merge, conflict checks, coverage report, missing module detection, shared dependency detection, connector audit, flow sufficiency check, quality gate report, parallel initialization skill documentation, and reports.

In all modes, child agents produce proposals and reviews. The coordinator is the only writer that merges into the draft/accepted graph. Parallelize understanding and review; serialize graph merging.

Do not implement v0.2 non-goals: no code change protocol, no runtime trace, no Playwright trace, no OpenTelemetry, no UI, no multi-language support, no Neo4j, and no automatic business-code modification.

Work phase by phase through Phase 0 to Phase 9. Update HOT.md before and after major work. Run focused tests for each phase, then full tests. Do not move to the next phase until the current phase tests and typecheck pass. Complete all acceptance criteria, documentation, complex fixture tests, multi-agent simulation tests, final review, and the real repository smoke test when feasible.
```

## 20. Future Versions

Potential v0.3:

- Architecture-first change protocol for bugfixes, features, and refactors.
- `begin_change`, `scan_repo_diff`, `validate_code_conformance`, and change snapshots.

Potential v0.4:

- Runtime trace and Playwright-assisted flow verification.

Potential v0.5:

- UI for reviewing block graphs, proposals, and quality gates.

Potential v0.6:

- Multi-language scanner support and SCIP/LSP integration.
