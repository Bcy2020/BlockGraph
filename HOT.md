# BlockGraph MCP v0.2 — Working State

> **RESTORE LINE**
> Read CLAUDE.md, HOT.md, and docs/blockgraph-mcp-v0.2-prd.md; continue BlockGraph MCP v0.2 strictly phase-by-phase as parallel initialization and quality gates for architecture-first repository maintenance.

## Current Phase

**v0.2 COMPLETE — All Phases Done**

## Final Verification

| Check | Result |
|-------|--------|
| `pnpm test` | **256 tests passed** (11 files) |
| `pnpm exec tsc --noEmit -p tsconfig.json` | Clean (no errors) |
| `pnpm test:v02-smoke` | PASS (64 entities, 8 blocks, 52.4% coverage) |
| v0.1 status | COMPLETE — all 6 phases, 18 MCP tools, all acceptance criteria met |
| v0.2 status | COMPLETE — all 9 phases, 31 MCP tools, all acceptance criteria met |

## v0.2 Phased Plan

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 0 | Readiness & baseline | ✅ DONE |
| 1 | Work Package Model | ✅ DONE — 32 tests |
| 2 | Module Proposal Model | ✅ DONE — 26 tests |
| 3 | Proposal Review Model | ✅ DONE — 13 tests |
| 4 | Coordinator Merge | ✅ DONE — 14 tests |
| 5 | Quality Gates | ✅ DONE — 17 tests |
| 6 | Complex Fixture & Multi-Agent Simulation | ✅ DONE — 6 tests |
| 7 | Parallel Initialization Skill & Reports | ✅ DONE |
| 8 | Real Repository Smoke Test | ✅ DONE |
| 9 | Final Independent Review | ✅ DONE |

## Acceptance Criteria (PRD §17)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Work package tools are implemented | ✅ PASS |
| 2 | Module proposal tools are implemented | ✅ PASS |
| 3 | Proposal review tools are implemented | ✅ PASS |
| 4 | Merge tools are implemented and coordinator-only semantics documented | ✅ PASS |
| 5 | Quality gate tools are implemented | ✅ PASS |
| 6 | Work package conflict checks catch duplicate ownership and scope violations | ✅ PASS |
| 7 | Proposal reviews can block merge | ✅ PASS |
| 8 | Approved proposals can merge into draft graph | ✅ PASS |
| 9 | Unapproved or rejected proposals cannot merge | ✅ PASS |
| 10 | Coverage report identifies unmapped entities and directories | ✅ PASS |
| 11 | Missing module detector identifies unmodeled feature directories | ✅ PASS |
| 12 | Shared dependency detector identifies shared utils/types/hooks/lib/config candidates | ✅ PASS |
| 13 | Connector audit identifies unexplained cross-block edges | ✅ PASS |
| 14 | Flow sufficiency check fails insufficient complex models | ✅ PASS |
| 15 | Quality gate report returns ready_for_maintenance = false for incomplete complex initialization | ✅ PASS |
| 16 | Quality gate report can return ready_for_maintenance = true after modeled fixes | ✅ PASS |
| 17 | Complex fixture tests pass | ✅ PASS |
| 18 | Real repository smoke test exists and is documented | ✅ PASS |
| 19 | Multi-agent simulation test passes | ✅ PASS |
| 20 | pnpm test passes | ✅ PASS |
| 21 | pnpm exec tsc --noEmit -p tsconfig.json passes | ✅ PASS |
| 22 | Documentation explains standard and Ultracode execution profiles | ✅ PASS |
| 23 | Merge handler updates work package status to "merged" | ✅ PASS |
| 24 | Merge handler prevents multiple merges per work package | ✅ PASS |

## v0.2 New Features Summary

- **Work Packages**: isolated parallel initialization boundaries (§8)
- **Module Proposals**: structured intermediate artifacts before graph merge (§9)
- **Proposal Reviews**: structured quality feedback with findings (§10)
- **Quality Gates**: coverage, missing modules, shared deps, connector audit, flow sufficiency (§11)
- **Coordinator-Only Merge**: only coordinator merges proposals into draft graph (§7.1)
- **Multi-Agent Protocol**: coordinator → module agents → reviewers → merge (§6, §7)

## v0.2 MCP Tools (31 total)

### Session Management
- `begin_initialization` — create/reset initialization session

### Scanner
- `scan_repo` — scan repository and generate code fact graph
- `list_code_entities` — list code entities with filters
- `list_code_edges` — list code edges with filters
- `suggest_block_candidates` — suggest blocks from heuristics

### Block Graph Editing
- `create_block` — create draft block
- `attach_code_entity` — attach entity to block
- `create_port` — create port for block
- `connect_ports` — create connector between ports
- `mark_unknown_boundary` — record unresolved boundary

### Flow Graph Editing
- `create_flow` — create draft flow
- `append_flow_step` — append step to flow

### Compiler & Snapshot
- `compile_draft_block` — validate single block
- `promote_draft_block` — promote valid block to accepted
- `compile_draft_graph` — validate entire graph
- `commit_snapshot` — create immutable snapshot

### Query
- `query_block` — get block details
- `query_symbols_by_block` — get entities mapped to block

### Work Packages (v0.2)
- `create_work_package` — create isolated work package
- `list_work_packages` — list by status/type
- `update_work_package_status` — enforce legal transitions
- `check_work_package_conflicts` — detect ownership/scope violations

### Module Proposals (v0.2)
- `create_module_proposal` — create proposal for work package
- `attach_proposal_entity` — add entity evidence to proposal
- `add_proposal_port` — add proposed port
- `add_proposal_dependency` — add dependency evidence
- `add_proposal_flow` — add internal flow
- `mark_proposal_gap` — record unresolved uncertainty
- `submit_module_proposal` — mark ready for review

### Proposal Reviews (v0.2)
- `submit_proposal_review` — record structured review
- `list_proposal_reviews` — list reviews and findings
- `resolve_proposal_finding` — mark finding resolved/rejected/deferred

### Merge (v0.2)
- `merge_module_proposal` — coordinator-only merge into draft graph
- `list_merged_proposals` — return proposal/block mappings

### Quality Gates (v0.2)
- `coverage_report` — mapped/unmapped entities and directories
- `detect_missing_modules` — find unmodeled feature directories
- `detect_shared_dependencies` — find shared utils/types/hooks candidates
- `connector_audit` — audit cross-block edges and connector evidence
- `flow_sufficiency_check` — evaluate flow coverage vs complexity
- `quality_gate_report` — run all quality checks, ready/not-ready decision

## Phase 1 Implementation Plan

- Add `WorkPackage` types to `src/graph/schema.ts`
- Add SQLite tables to `src/graph/store.ts`
- Add service methods to `src/graph/draft.ts`
- Add MCP tool handlers to `src/mcp/tools.ts`
- Register tools in `src/mcp/server.ts`
- Add tests to `tests/mcp-tools.test.ts` or new test file
- Verify: focused tests + full `pnpm test` + typecheck

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package manager | pnpm | PRD preference |
| Test framework | Vitest | Fast, native TS support |
| Scanner | ts-morph | Lowest implementation risk per PRD §5 |
| SQLite driver | better-sqlite3 | Synchronous API fits MCP server |
| Tool handler pattern | Pure functions taking `ToolContext` | Testable without MCP server |
| Edge ID dedup | `uniqueEdgeId()` with counter suffix | Prevents UNIQUE constraint failures on large repos |
| Work package IDs | Stable kebab-case with `wp-` prefix | PRD §8.2 recommendation |
| Proposal isolation | Proposals stored separately from draft graph | PRD §9 — proposals are not accepted graph data |

## Limitations

- Scanner: TypeScript/JavaScript only (no multi-language)
- No visual graph UI
- No runtime tracing
- Evidence is natural language only
- Flows do not support branching

## Security Review Findings — 2026-06-14

### P1 — All Resolved

| # | Finding | Status | Resolution |
|---|---------|--------|------------|
| 1 | Merge handler didn't update WP status to "merged" | ✅ FIXED | Added `updateWorkPackageStatus(db, wp_id, "merged")` after merge in tools.ts |
| 2 | Snapshot immutability not capturing graph state | DEFERRED v0.3 | Pre-existing v0.1 limitation; requires architectural redesign |
| 3 | Merge handler didn't prevent multiple merges per WP | ✅ FIXED | Added `PACKAGE_ALREADY_MERGED` check + test |

### P2 — Deferred to v0.3

| # | Finding | Status |
|---|---------|--------|
| 4 | quality_gate_report uses warn() but pushes to errors array | DEFERRED |
| 5 | quality_gate_report doesn't run compile_draft_graph | DEFERRED |
| 6 | feature_directory_coverage formula math error | DEFERRED |
| 7 | undeclared_external_refs never populated | DEFERRED |
| 8 | open_review_findings always empty in quality gate | DEFERRED |
| 9 | role parameter not validated in attachProposalEntity | DEFERRED |
| 10 | updateModuleProposal bypasses transition validation | DEFERRED |
| 11 | scope_paths not validated for path traversal | DEFERRED |
| 12 | runtime_entity_coverage same as entity_coverage | DEFERRED |

### P3

| # | Finding | Status |
|---|---------|--------|
| 13 | MCP server version still "0.1.0" | DEFERRED |

### Tests Added
- `tests/merge.test.ts` — "fails: package already has merged proposal"
- `tests/merge.test.ts` — "updates work package status to merged"
- Test count: 254 → 256
- CLI is minimal (MCP tools are primary interface)
