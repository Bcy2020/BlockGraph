# BlockGraph MCP v0.2 — Working State

> **RESTORE LINE**
> Read CLAUDE.md, HOT.md, issues/issue#1.md, and docs/blockgraph-mcp-v0.2.1-stabilization-prd.md; v0.2.1 ALL PHASES COMPLETE, 294 tests passed, 36 MCP tools, 14/14 acceptance criteria met, review findings fixed, update_module_proposal added. Ready for v0.2.5 benchmark work.

## Current Phase

**v0.2.1 COMPLETE — all 3 phases done**

## Blocking Issues From Real-World Initialization

Source: `issues/issue#1.md` — bulletproof-react 仓库初始化时发现的问题，已通过源码审查确认。

| # | 问题 | 严重程度 | 状态 |
|---|------|----------|------|
| 1 | 提案审批机制缺失 — `submit_proposal_review` 不推进 proposal 状态，`submitted → reviewing → approved` 路径断裂 | ⚠️ 重要 | ✅ 已修复 (v0.2.1) |
| 2 | 会话恢复机制缺失 — MCP server 重启后 ctx 内存句柄丢失，错误消息误导（数据已持久化在 SQLite 中） | ⚠️ 重要 | ✅ 已修复 (v0.2.1) |
| 3 | Skill 工作流设计不完整 — 缺少审批步骤指导、降级路径、会话恢复机制 | ⚠️ 重要 | ✅ 已修复 (v0.2.1) |
| 4 | 工作包状态机过于刚性 | 🔧 可改进 | 延后 |

### 问题 1 修复方向

`submit_proposal_review(status: "pass")` 应在无未解决 P0/P1 findings 时自动将 proposal 推进到 `approved`。或者添加独立的 `approve_proposal` 工具。

### 问题 2 修复方向

- 改善错误消息：`NO_SESSION` 应提示"数据已存在，调用 begin_initialization 重新连接"
- 或：`begin_initialization` 检测已有 DB 并自动恢复（返回 `resumed: true`）
- 或：添加 `list_sessions` / `resume_initialization` 工具

### 问题 3 修复方向

更新 `docs/parallel-initialization-skill.md` 和 `docs/agent-initialization-skill.md`：
- 补充审批流程说明
- 补充降级路径（直接 create_block + attach_code_entity）
- 补充子代理权限检查
- 补充会话恢复指导

## v0.2.1 Phase 0 — Baseline & Analysis (COMPLETE)

**Date**: 2026-06-18

### Baseline Verification

| Check | Result |
|-------|--------|
| `pnpm test` | **256 tests passed** (11 files) |
| `pnpm exec tsc --noEmit -p tsconfig.json` | Clean (no errors) |

### Issue 1: Proposal Approval Gap — ✅ Confirmed

Source code evidence:

| Location | Finding |
|----------|---------|
| `draft.ts:868-876` | `PROPOSAL_TRANSITIONS` defines `submitted → reviewing → approved` path, but no MCP tool drives it |
| `tools.ts:1493-1504` | `handleSubmitProposalReview` creates review record only, does NOT call `updateModuleProposalStatus` |
| `tools.ts:1624-1626` | `handleMergeModuleProposal` requires `proposal.status === "approved"` |
| `server.ts` | 31 registered tools — none is `approve_module_proposal` |
| `merge.test.ts:104-106` | Tests bypass MCP by calling `updateModuleProposalStatus` directly |

PRD fix suggestions all feasible: `updateModuleProposalStatus` already supports the transitions, just needs a handler + registration.

### Issue 2: Session Reconnect UX — ✅ Confirmed

Source code evidence:

| Location | Finding |
|----------|---------|
| `store.ts:16-27` | `openStore` uses `CREATE TABLE IF NOT EXISTS` — re-calling `begin_initialization` preserves data |
| `tools.ts:88-95` | `ToolContext.db` is in-memory only; lost on MCP server restart |
| `server.ts:68-74` | `createServer()` creates `{ db: null, repoPath: null }` — no auto-reconnect |
| `tools.ts` (20+ locations) | All `requireDb` checks return misleading `"No active session"` message |

PRD fix suggestions all feasible: `begin_initialization` can return `resumed`/`summary` by querying existing DB; `resume_initialization` and `session_status` are thin wrappers; `list_module_proposals` reuses existing `listModuleProposals()`.

### Next Step

Phase 1: Implement `approve_module_proposal` MCP tool + update `submit_proposal_review` to return `proposal_status` with review-driven side effects.

## v0.2.1 Phase 1 — Proposal Approval MCP Path (COMPLETE)

**Date**: 2026-06-18

### Changes

| File | Change |
|------|--------|
| `src/mcp/tools.ts` | Added `handleApproveModuleProposal`; updated `handleSubmitProposalReview` to return `proposal_status` and add review-driven side effects |
| `src/mcp/server.ts` | Registered `approve_module_proposal` tool |
| `tests/merge.test.ts` | Added 10 tests for `approve_module_proposal`; added MCP-only end-to-end merge test |
| `tests/reviews.test.ts` | Added 3 tests for `submit_proposal_review` side effects |

### Verification

| Check | Result |
|-------|--------|
| `pnpm test` | **269 tests passed** (11 files, +13 new) |
| `pnpm exec tsc --noEmit -p tsconfig.json` | Clean |

### What Changed

- `approve_module_proposal` tool: coordinator-only approval with review/P0/P1 validation
- `submit_proposal_review` now returns `proposal_id` and `proposal_status`
- Review side effects: pass moves `submitted→reviewing`, needs_revision moves `submitted→reviewing→needs_revision`, reject moves to `rejected`
- Review pass does NOT auto-approve (per PRD requirement)
- MCP-only flow works: create → submit → review → approve → merge without internal API bypass

### Next Step

Phase 2: Session reconnect — `begin_initialization` returns `resumed`/`db_path`/`summary`, add `resume_initialization`, `session_status`, `list_module_proposals`, improve `NO_SESSION` messages.

## v0.2.1 Phase 2 — Session Reconnect & Recovery Tools (COMPLETE)

**Date**: 2026-06-18

### Changes

| File | Change |
|------|--------|
| `src/mcp/tools.ts` | Added `noSessionError()` helper + `SessionSummary` type + `getSessionSummary()` helper; updated `handleBeginInitialization` to return `resumed`/`db_path`/`summary`; added `handleResumeInitialization`, `handleSessionStatus`, `handleListModuleProposals`; replaced all 20+ scattered `NO_SESSION` messages with `noSessionError()` |
| `src/mcp/server.ts` | Registered `resume_initialization`, `session_status`, `list_module_proposals` tools; updated `begin_initialization` description |
| `tests/session.test.ts` | New file — 13 tests covering resumed detection, resume, session status, list proposals, NO_SESSION messages, data preservation on reconnect |

### Verification

| Check | Result |
|-------|--------|
| `pnpm test` | **282 tests passed** (12 files, +13 new) |
| `pnpm exec tsc --noEmit -p tsconfig.json` | Clean |

### What Changed

- `begin_initialization` now returns `resumed: true/false`, `db_path`, and `SessionSummary`
- `resume_initialization` — explicit reconnect alias (same implementation, clearer name)
- `session_status` — read-only check: active, repo_path, db_path, summary
- `list_module_proposals` — filter by work_package_id or status; part of recovery ergonomics
- All `NO_SESSION` messages now explain that data persists in `.blockgraph/blockgraph.db` and suggest both `begin_initialization` and `resume_initialization`

### Next Step

Phase 3: Documentation updates for parallel-initialization-skill.md, agent-initialization-skill.md, README.md, and final verification.

## v0.2.1 Phase 3 — Documentation & Final Verification (COMPLETE)

**Date**: 2026-06-18

### Changes

| File | Change |
|------|--------|
| `README.md` | Added `resume_initialization`, `session_status`, `approve_module_proposal`, `list_module_proposals` to tool tables; updated test counts |
| `docs/parallel-initialization-skill.md` | Added Step 7 (Approve Proposals) with explicit `approve_module_proposal` guidance; renumbered subsequent steps; added Session Recovery section with reconnect, session_status, list_module_proposals, and degraded path |
| `docs/agent-initialization-skill.md` | Updated `NO_SESSION` error description; added Session Recovery section |

### Final Verification

| Check | Result |
|-------|--------|
| `pnpm test` | **294 tests passed** (12 files) |
| `pnpm exec tsc --noEmit -p tsconfig.json` | Clean |

## v0.2.1 Acceptance Criteria (PRD §7)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `approve_module_proposal` MCP tool exists | ✅ PASS |
| 2 | `approve_module_proposal` enforces review and unresolved P0/P1 rules | ✅ PASS |
| 3 | `submit_proposal_review` returns `proposal_status` | ✅ PASS |
| 4 | Review pass does not automatically approve | ✅ PASS |
| 5 | MCP-only proposal → review → approve → merge test passes | ✅ PASS |
| 6 | `begin_initialization` returns `resumed`, `db_path`, and session summary | ✅ PASS |
| 7 | `resume_initialization` tool exists | ✅ PASS |
| 8 | `session_status` tool exists | ✅ PASS |
| 9 | `list_module_proposals` tool exists | ✅ PASS |
| 10 | `NO_SESSION` message explains reconnect and persistent DB behavior | ✅ PASS |
| 11 | Reconnect tests prove existing graph data remains visible | ✅ PASS |
| 12 | Documentation describes approval and reconnect workflow | ✅ PASS |
| 13 | Full `pnpm test` passes | ✅ PASS (294) |
| 14 | `pnpm exec tsc --noEmit -p tsconfig.json` passes | ✅ PASS |

## Next Proposed Scope

**v0.2.1 COMPLETE — ready for v0.2.5 benchmark work**

v0.2.1 reference PRD (completed):

- `docs/blockgraph-mcp-v0.2.1-stabilization-prd.md`

v0.2.5 reference PRD (next):

- `docs/blockgraph-mcp-v0.2.5-benchmark-prd.md`

## Final Verification (v0.2.1)

| Check | Result |
|-------|--------|
| `pnpm test` | **294 tests passed** (12 files) |
| `pnpm exec tsc --noEmit -p tsconfig.json` | Clean (no errors) |
| `pnpm test:v02-smoke` | PASS (64 entities, 8 blocks, 52.4% coverage) |
| v0.1 status | COMPLETE — all 6 phases, 18 MCP tools, all acceptance criteria met |
| v0.2 status | COMPLETE — all 9 phases, 31 MCP tools, all acceptance criteria met |
| v0.2.1 status | COMPLETE — all 3 phases, 36 MCP tools, 14/14 acceptance criteria met |

## Independent Review Findings & Fixes (2026-06-18)

3 parallel review agents per CONTRIBUTING.md §10.

### P1 — All Fixed

| # | Finding | Fix |
|---|---------|-----|
| P1-1 | `approve_module_proposal` missing latest-review-is-reject check (PRD §4.3) | Added check in tools.ts after pass review validation; test in merge.test.ts |
| P1-2 | `handleBeginInitialization` no try/catch for corrupted SQLite | Wrapped `openStore` in try/catch, returns `DB_OPEN_FAILED`; test in session.test.ts |

### P2 — Deferred (non-blocking)

| # | Finding | Status |
|---|---------|--------|
| P2-1 | `submit_proposal_review` reject side-effect untested | Deferred — side effect code exists, test gap only |
| P2-2 | Approve on already-approved proposal untested | Deferred — transition table blocks it |
| P2-3 | Multi-step transition chain non-atomic | Deferred — single-process server, documented |
| P2-4 | "rejected proposal" test lacks error code assertion | Deferred — test correctly asserts failure |
| P2-5 | "no session" tests lack NO_SESSION error code assertion | Deferred — test correctly asserts failure |

### P3 — Deferred (cosmetic)

| # | Finding |
|---|---------|
| P3-1 | `listProposalReviews` no explicit ORDER BY |
| P3-2 | `handleListModuleProposals` no handler-level status validation |
| P3-3 | MCP server version "0.1.0" |
| P3-4 | Stale local variable in approve handler |
| P3-5 | agent-init-skill.md NO_SESSION message abbreviation |

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

## v0.2/v0.2.1 MCP Tools (36 total)

### Session Management
- `begin_initialization` — create/reconnect initialization session (returns `resumed`, `db_path`, `summary`)
- `resume_initialization` — explicit reconnect alias for `begin_initialization`
- `session_status` — check active session status, repo path, and graph summary

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
- `update_module_proposal` — update purpose/module_name/confidence on draft/needs_revision proposals (v0.2.1)
- `list_module_proposals` — list proposals with optional filters (v0.2.1)

### Proposal Reviews (v0.2)
- `submit_proposal_review` — record structured review (returns `proposal_status`, applies side effects in v0.2.1)
- `approve_module_proposal` — coordinator-only: approve reviewed proposal (v0.2.1)
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
