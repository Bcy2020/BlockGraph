# BlockGraph MCP v0.1 — Working State

> **RESTORE LINE**
> Read CLAUDE.md, HOT.md, and docs/blockgraph-mcp-v0.1-prd.md; continue BlockGraph MCP v0.1 strictly phase-by-phase as an architecture-first repository maintenance tool implemented as a constrained graph editor with Code Fact Graph, Block Graph, Flow Graph, evidence mapping, and draft/compile/promote/snapshot protocol.

## Current Phase

**v0.1 COMPLETE — All Phases Done**

## Summary

BlockGraph MCP v0.1 is fully implemented. All 6 phases are complete, all tests pass, TypeScript compiles clean.

## Completed

- [x] **Phase 1 — Project Skeleton And Storage** — 36 tests
- [x] **Phase 2 — MCP Server Skeleton And Draft Graph Editor Tools** — 48 tests
- [x] **Phase 3 — Scanner** — 13 tests
- [x] **Phase 4 — Compiler, Promotion, Snapshot** — 22 tests
- [x] **Phase 5 — Initialization Flow Test, README, Agent Guide** — 1 test
- [x] **Phase 6 — External Repository Smoke Test**
- [x] **Post-completion governance** — `CONTRIBUTING.md` added with collaboration workflow, architecture invariants, testing gates, and independent review-agent standard

## Final Verification

| Check | Result |
|-------|--------|
| `pnpm test` | **146 tests passed** (5 files, 3.5s) |
| `npx tsc --noEmit -p tsconfig.json` | Clean (no errors) |
| `pnpm test:external-init` | PASS (sindresorhus/is@v6.0.0) |

## MCP Tools (18 total)

| PRD § | Tool | Phase |
|-------|------|-------|
| §9.1 | begin_initialization | 2 |
| §9.2 | scan_repo | 3 |
| §9.3 | list_code_entities | 3 |
| §9.4 | list_code_edges | 3 |
| §9.5 | suggest_block_candidates | 5 |
| §9.6 | create_block | 2 |
| §9.7 | attach_code_entity | 2 |
| §9.8 | create_port | 2 |
| §9.9 | connect_ports | 2 |
| §9.10 | create_flow | 2 |
| §9.11 | append_flow_step | 2 |
| §9.12 | mark_unknown_boundary | 2 |
| §9.13 | compile_draft_block | 4 |
| §9.14 | promote_draft_block | 4 |
| §9.15 | compile_draft_graph | 4 |
| §9.16 | commit_snapshot | 4 |
| §9.17 | query_block | 2 |
| §9.18 | query_symbols_by_block | 2 |

## Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/graph.test.ts` | 36 | CRUD operations, FK violations, edge cases |
| `tests/mcp-tools.test.ts` | 71 | All 18 tool handlers (success + failure paths), Phase 4 handler-level tests, suggest_block_candidates strategies |
| `tests/scanner.test.ts` | 16 | Fixture detection (components, handlers, routes, imports, calls, handles_event, renders, fetches) |
| `tests/compiler.test.ts` | 22 | Compile errors/warnings, promote, snapshot |
| `tests/initialization-flow.test.ts` | 1 | Full end-to-end init loop |

## External Repository Test

- **Repository**: `https://github.com/sindresorhus/is.git`
- **Ref**: `v6.0.0` (shallow clone, HEAD fallback)
- **Result**: PASS
  - 219 entities, 309 edges scanned
  - 2 candidate blocks suggested (directory heuristic)
  - 2 blocks promoted
  - Snapshot committed

## 复杂仓库验证（bulletproof-react）

- **Repository**: `alan2207/bulletproof-react` (vite app)
- **规模**: 128 TypeScript 文件
- **Result**: PASS
  - 159 entities, 445 edges scanned
  - 8 blocks created (7 accepted + 1 root)
  - 94 code entity mappings
  - 17 ports, 9 connectors
  - 1 flow with 5 steps
  - Snapshot committed

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package manager | pnpm | PRD preference |
| Test framework | Vitest | Fast, native TS support |
| Scanner | ts-morph | Lowest implementation risk per PRD §5 |
| SQLite driver | better-sqlite3 | Synchronous API fits MCP server |
| Tool handler pattern | Pure functions taking `ToolContext` | Testable without MCP server |
| Edge ID dedup | `uniqueEdgeId()` with counter suffix | Prevents UNIQUE constraint failures on large repos |

## Files Changed

```
src/graph/schema.ts     — PRD §8 types
src/graph/store.ts      — SQLite store (10 tables)
src/graph/draft.ts      — CRUD service
src/graph/compiler.ts   — Validation, promotion, snapshot
src/mcp/server.ts       — MCP server (18 tools registered)
src/mcp/tools.ts        — Tool handler implementations
src/scanner/tsScanner.ts — ts-morph scanner
tests/graph.test.ts     — CRUD tests
tests/mcp-tools.test.ts — Tool handler tests
tests/scanner.test.ts   — Scanner fixture tests
tests/compiler.test.ts  — Compiler tests
tests/initialization-flow.test.ts — E2E init test
scripts/external-init.ts — External repo smoke test
fixtures/ts-react-auth/  — Test fixture repo
docs/agent-initialization-skill.md — Agent guide
README.md               — Project documentation
```

## Limitations

- Scanner: TypeScript/JavaScript only (no multi-language)
- No visual graph UI
- No runtime tracing
- Evidence is natural language only
- Flows do not support branching
- CLI is minimal (MCP tools are primary interface)

## MCP 端到端验证环境

- `test-workspace/`：简单仓库（`fixtures/ts-react-auth` 副本，git SHA: `a4d337c`）
  - `.mcp.json` + `.claude/skills/blockgraph-init/SKILL.md`
- `test-workspace-complex/`：复杂仓库（`bulletproof-react` vite app，128 文件，git SHA: `8d90797`）
  - `.mcp.json` + `.claude/skills/blockgraph-init/SKILL.md`
  - 扫描结果：159 entities, 454 edges

**验证方法**：在对应目录下启动 Claude Code，它会自动加载 MCP server 和 skill。按 skill 指引执行初始化流程。

## 代码审查发现的问题（已修复）

### 第一轮审查

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P1 | 测试未排除 `.blockgraph/` 目录 | ✅ 已修复 — `initialization-flow.test.ts` 使用 `filter` 排除 |
| P2 | `suggest_block_candidates` 的 `route` 策略未实现 | ✅ 已修复 — 按 `routes/` 目录分组 |
| P2 | scanner 缺少 `handles_event`/`renders`/`fetches` 边类型 | ✅ 已修复 — 新增 3 个边生成 pass |
| P2 | scanner 不检测 `route` 实体类型 | ✅ 已修复 — `routes/` 目录下的导出函数识别为 route |
| P2 | 缺少 `suggest_block_candidates` 单元测试 | ✅ 已修复 — 6 个测试覆盖所有策略 |
| P3 | `handleScanRepo` 缺乏幂等性 | ✅ 已修复 — 存在性检查后跳过已存在实体 |

### 第二轮审查（CONTRIBUTING.md 标准）

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P2 | compiler 跨 block 边界警告不对称（只检查 target，遗漏 source） | ✅ 已修复 — `compileDraftBlock` 和 `compileDraftGraph` 增加 source 实体 unknown boundary 检查 |
| P2 | Phase 4 工具和 `handleListCodeEdges` 缺少 handler 级别测试 | ✅ 已修复 — 新增 17 个测试（list_code_entities×3, list_code_edges×3, compile_draft_block×3, promote_draft_block×3, compile_draft_graph×2, commit_snapshot×3） |
| P2 | `renders` 边测试是空操作（fixture 无父子组件） | ✅ 已修复 — 新增 `ParentForm.tsx` fixture，测试验证 ParentForm→LoginForm renders 边 |
| P3 | test-workspace 目录未 gitignore | 待处理 |
| P3 | PRD §6 布局文件未实现（cli/index.ts 等） | 已知偏差，不在验收标准内 |
| P3 | `edge_count` 返回扫描总数而非持久化数 | 待处理 |
