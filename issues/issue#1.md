# BlockGraph MCP v0.2 初始化流程问题报告

## 问题概述

在使用 BlockGraph MCP v0.2 对 bulletproof-react 仓库执行初始化流程时，发现四个关键问题：

| # | 问题 | 类别 | 严重程度 |
|---|------|------|----------|
| 1 | 提案审批机制缺失 — `merge_module_proposal` 要求 "approved" 状态，但没有工具可以设置此状态 | MCP 工具 | ⭐⭐⭐ 关键 |
| 2 | 会话恢复机制缺失 — MCP server 重启后 ctx 内存句柄丢失，错误消息误导用户以为数据丢失（实际数据已持久化在 SQLite 中） | MCP 工具 | ⭐⭐ 重要 |
| 3 | Skill 工作流设计不完整 — 缺少审批步骤指导、降级路径、会话恢复机制 | Skill 设计 | ⭐⭐ 重要 |
| 4 | 工作包状态机过于刚性 — 严格的线性状态转换不支持灵活的工作流 | MCP 工具 | ⭐ 次要 |

---

## 发生情况

### 时间线

1. **Step 1-2**：扫描仓库、创建工作包 → ✅ 正常完成
2. **Step 3-4**：为 10 个工作包创建模块提案，附加实体、端口、依赖 → ✅ 正常完成
3. **Step 5**：使用子代理审查 10 个提案 → ✅ 完成（4 个通过，6 个需要修改）
4. **Step 6**：解决审查发现 → ✅ 完成（解决了 P0/P1 问题）
5. **Step 7**：合并已批准的提案 → ❌ **被阻塞**

### 阻塞点

调用 `merge_module_proposal(proposal_id: "prop-shared-lib")` 时返回错误：

```json
{
  "ok": false,
  "errors": [
    {
      "code": "NOT_APPROVED",
      "message": "Proposal must be approved before merge. Current status: submitted",
      "severity": "error"
    }
  ]
}
```

### 尝试的解决方案

| 尝试 | 操作 | 结果 |
|------|------|------|
| 1 | 调用 `submit_proposal_review(status: "pass")` | 审查通过，但提案状态仍为 "submitted" |
| 2 | 调用 `update_work_package_status(status: "approved")` | 错误：`planned → approved` 是非法转换 |
| 3 | 调用 `update_work_package_status(status: "reviewing")` | 错误：`planned → reviewing` 是非法转换 |
| 4 | 查找 `approve_proposal` 工具 | **工具不存在** |

---

## 为什么会出现和设计构思不一致的情况？

### 设计构思

根据 CLAUDE.md 中的状态机描述，提案流程应该是：

```
draft ──compile──> valid ──promote──> accepted ──commit──> snapshot (immutable)
```

根据 Skill 工作流（blockgraph-init），提案流程应该是：

```
创建提案 → 附加实体 → 提交审查 → 审查通过 → 合并到草稿图
```

### 实际实现

实际的提案状态流转是：

```
draft → submitted → ??? → approved → merged
                ↑
           缺少工具
```

`submit_module_proposal` 将状态设为 "submitted"，`merge_module_proposal` 要求 "approved" 状态，但**没有任何工具可以将 "submitted" 转换为 "approved"**。

### 根因分析

MCP 工具链中存在**断裂**：

```
submit_module_proposal  →  [缺失: approve_proposal]  →  merge_module_proposal
      (submitted)                                          (要求 approved)
```

这可能是因为：
1. v0.1 设计时未考虑提案审批流程（v0.1 直接操作草稿图）
2. v0.2 引入了提案机制，但审批工具尚未实现
3. 审批逻辑被设计为由外部系统（如 CI/CD）触发，但 MCP 内部未提供接口

---

## 什么时候需要这样的功能？

### 场景 1：并行初始化（v0.2 核心场景）

当仓库有多个独立工作包时，需要：
1. 为每个工作包创建提案
2. 并行审查提案
3. **审批通过的提案**
4. 合并到草稿图

这是 v0.2 的核心用例，目前无法完成。

### 场景 2：迭代式审查

审查可能发现需要修改的问题：
1. 第一轮审查：发现 P0 问题 → `needs_revision`
2. 修复问题
3. 第二轮审查：通过 → 应该可以审批和合并

目前第二轮审查通过后，提案仍卡在 "submitted" 状态。

### 场景 3：部分合并

某些提案通过审查，某些需要修改：
1. 审查通过的提案应该可以立即合并
2. 需要修改的提案继续迭代

目前所有提案都无法合并，即使审查已通过。

---

## 期望的情况

### 最小修复方案

添加 `approve_proposal` 工具：

```
approve_proposal(proposal_id: string) → { ok: true, proposal_id: string, status: "approved" }
```

**前置条件**：
- 提案状态为 "submitted"
- 至少有一个审查状态为 "pass"
- 没有未解决的 P0/P1 发现

**后置条件**：
- 提案状态变为 "approved"
- 可以被 `merge_module_proposal` 合并

### 替代方案

如果不想添加新工具，可以让 `submit_proposal_review(status: "pass")` 在满足条件时自动将提案状态设为 "approved"：

```
submit_proposal_review(proposal_id: "prop-xxx", status: "pass")
→ 审查通过
→ 如果没有未解决的 P0/P1 发现
→ 自动将提案状态设为 "approved"
```

### 完整的预期流程

```
创建提案 (draft)
    ↓
附加实体、端口、依赖
    ↓
提交审查 (submitted)
    ↓
子代理审查 (pass / needs_revision)
    ↓
解决发现 (如有)
    ↓
审批提案 (approved) ← 需要这个步骤
    ↓
合并到草稿图 (merged)
    ↓
编译、提升、快照
```

---

## 附录：相关工具调用记录

### 失败的合并尝试

```
mcp__blockgraph__merge_module_proposal(proposal_id: "prop-shared-lib")
→ NOT_APPROVED: Proposal must be approved before merge. Current status: submitted
```

### 失败的审批尝试

```
mcp__blockgraph__update_work_package_status(id: "wp-shared-lib", status: "approved")
→ INVALID_TRANSITION: Illegal status transition: planned -> approved

mcp__blockgraph__update_work_package_status(id: "wp-shared-lib", status: "reviewing")
→ INVALID_TRANSITION: Illegal status transition: planned -> reviewing
```

### 成功的审查提交

```
mcp__blockgraph__submit_proposal_review(proposal_id: "prop-shared-lib", status: "pass")
→ { review_id: "review-xxx", status: "pass" }
// 但提案状态仍为 "submitted"，不是 "approved"
```

---

## 问题 2：会话持久性不足

### 发生情况

在执行初始化流程约 2 小时后（包含提案创建、实体附加、审查、重试等步骤），会话突然过期：

```
mcp__blockgraph__coverage_report()
→ NO_SESSION: No active session. Call begin_initialization first.
```

所有中间状态丢失：
- 10 个工作包
- 10 个提案（含实体、端口、依赖）
- 10 个草稿块
- 约 150 个实体附加映射

### 什么时候需要持久性？

1. **大型仓库初始化** — 10+ 工作包的初始化可能需要数小时，会话可能在中途过期
2. **迭代式审查** — 审查 → 修改 → 再审查的循环可能跨越多个会话
3. **中断恢复** — 用户可能需要暂停并在稍后继续

### 设计构思

CLAUDE.md 中提到了 "Context Compression Recovery Rules"，说明设计时已考虑到会话中断的情况。但实际实现中：

- `begin_initialization` 每次创建新会话，不恢复已有会话
- SQLite 存储已存在，但会话状态没有持久化到 SQLite
- 没有 `resume_initialization` 或 `list_sessions` 工具

### 期望的情况

#### 方案 1：会话自动持久化

`begin_initialization` 应该：
- 检查是否存在未完成的会话
- 如果存在，恢复该会话（而不是创建新会话）
- 如果不存在，创建新会话

```typescript
begin_initialization(repo_path: string)
→ 检查 SQLite 中是否有该仓库的未完成会话
→ 如果有：恢复会话，返回 { session_id: "existing-id", resumed: true }
→ 如果没有：创建新会话，返回 { session_id: "new-id", resumed: false }
```

#### 方案 2：显式恢复工具

添加 `resume_initialization` 工具：

```typescript
resume_initialization(session_id: string)
→ 恢复指定会话
→ 返回会话当前状态（已完成的步骤、待处理的工作）
```

#### 方案 3：会话状态查询

添加 `list_sessions` 工具：

```typescript
list_sessions(repo_path?: string)
→ 列出所有会话及其状态
→ 返回 { sessions: [{ id, repo_path, status, created_at, last_active }] }
```

---

## 问题 3：Skill 工作流设计不完整

### 3.1 缺少审批步骤的具体指导

#### 发生情况

Skill 工作流 Step 7 说 "Merge Approved Proposals"，但没有说明如何从 "submitted" 到 "approved"。执行者按以下步骤操作：

1. 创建提案 → `create_module_proposal` ✅
2. 附加实体 → `attach_proposal_entity` ✅
3. 提交审查 → `submit_module_proposal` ✅
4. 审查通过 → `submit_proposal_review(status: "pass")` ✅
5. 合并提案 → `merge_module_proposal` ❌ **NOT_APPROVED**

Skill 没有说明第 5 步需要什么前置条件，也没有提供如何达到 "approved" 状态的指导。

#### 期望的情况

Skill 应该明确说明审批流程：

```markdown
### Step 7: 审批提案

审查通过后，需要审批提案才能合并：

1. 确认所有 P0/P1 发现已解决
2. 调用 `approve_proposal(proposal_id)` 审批提案
3. 确认提案状态变为 "approved"

如果 `approve_proposal` 工具不存在，请使用替代方案：
- 直接创建草稿块 (`create_block`)
- 附加实体 (`attach_code_entity`)
- 编译和提升 (`compile_draft_block`, `promote_draft_block`)
```

### 3.2 缺少降级路径

#### 发生情况

当 `merge_module_proposal` 失败时，Skill 没有提供替代方案。执行者被迫：
1. 反复尝试不同的工具调用（浪费时间）
2. 自行寻找绕过方案（直接创建块）

#### 期望的情况

Skill 应该提供降级路径：

```markdown
### 降级方案：直接创建块

如果提案合并流程不可用，可以使用直接创建块的方式：

1. `create_block(name, purpose)` — 创建草稿块
2. `attach_code_entity(block_id, code_entity_id, role)` — 附加代码实体
3. `create_port(block_id, name, direction)` — 创建端口
4. `compile_draft_block(block_id)` — 编译
5. `promote_draft_block(block_id)` — 提升到接受图
```

### 3.3 未考虑子代理权限限制

#### 发生情况

Skill 描述了并行子代理模式（Standard Subagent Profile、Dynamic Workflow Profile），但没有说明子代理可能无法访问 MCP 工具。

实际执行时：
1. 按 Skill 指导启动 10 个子代理 → 全部失败
2. 子代理无法调用 `attach_proposal_entity`、`add_proposal_port` 等工具
3. 被迫在主会话中串行完成所有工作

#### 期望的情况

Skill 应该添加权限检查：

```markdown
### 子代理权限检查

在启动子代理前，确认以下事项：

1. 子代理是否有权访问 `mcp__blockgraph__*` 工具
2. 如果没有，使用串行执行模式（在主会话中完成所有工作）

测试方法：
- 启动一个测试子代理
- 让它调用 `mcp__blockgraph__list_work_packages`
- 如果成功，可以使用并行模式
- 如果失败，使用串行模式
```

### 3.4 缺少会话恢复指导

#### 发生情况

会话过期后，Skill 没有说明如何恢复。执行者不知道：
- 是否需要重新开始
- 是否有办法恢复之前的会话
- 如何避免重复工作

#### 期望的情况

Skill 应该添加会话恢复章节：

```markdown
### 会话恢复

如果会话过期或中断：

1. 检查是否有未完成的会话：`list_sessions(repo_path)`
2. 如果有，恢复会话：`resume_initialization(session_id)`
3. 如果没有，重新开始：`begin_initialization(repo_path)`

恢复后，检查当前状态：
- `coverage_report()` — 查看已映射的实体
- `list_work_packages()` — 查看已创建的工作包
- `compile_draft_graph()` — 查看草稿图状态
```

---

## 问题 4：工作包状态机过于刚性

### 发生情况

工作包状态转换被严格限制为线性流程：

```
planned → assigned → proposed → reviewing → needs_revision → approved → merged
```

无法跳过中间步骤，例如：
- `planned → approved` ❌
- `planned → reviewing` ❌

### 什么时候需要灵活性？

1. **快速初始化** — 小型仓库可能不需要完整的审批流程
2. **自动化流程** — CI/CD 可能希望直接从 planned 到 approved
3. **修复后重新审批** — 从 needs_revision 到 approved 应该是允许的

### 期望的情况

允许以下转换：
- `planned → approved` — 快速审批
- `needs_revision → approved` — 修复后重新审批
- `submitted → approved` — 提案审批（配合 `approve_proposal` 工具）

---

## 源码审查确认

> 审查时间：2026-06-18
> 审查方法：直接核对 `src/mcp/tools.ts`、`src/graph/draft.ts`、`src/graph/schema.ts` 源码

### 问题 1：提案审批机制缺失 — ⚠️ 重要（确认）

**结论：真实存在，是阻塞性 bug。**

**证据 1 — 状态转换表存在断裂**

`src/graph/draft.ts:868-876` 定义了提案状态转换：

```typescript
const PROPOSAL_TRANSITIONS: Record<ModuleProposalStatus, ModuleProposalStatus[]> = {
  draft: ["submitted", "rejected"],
  submitted: ["reviewing", "rejected", "needs_revision"],  // submitted 可到 reviewing
  reviewing: ["needs_revision", "approved", "rejected"],   // reviewing 可到 approved
  needs_revision: ["submitted", "rejected"],
  approved: ["merged", "rejected"],
  merged: [],
  rejected: [],
};
```

设计上路径是 `submitted → reviewing → approved → merged`，但没有工具驱动 `submitted → reviewing` 和 `reviewing → approved`。

**证据 2 — submit_proposal_review 不修改提案状态**

`src/mcp/tools.ts:1493-1504`：

```typescript
const review = dbCreateProposalReview(db, {
  id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  proposal_id: args.proposal_id,
  reviewer_agent: args.reviewer_agent,
  status: (args.status ?? "needs_revision") as ProposalReviewStatus,
  findings: args.findings ?? [],
  coverage_notes: args.coverage_notes,
  evidence_notes: args.evidence_notes,
  recommended_fixes: args.recommended_fixes,
});
return ok({ review_id: review.id, status: review.status });
// ↑ 只返回 review 的 status，proposal 的 status 未被修改
```

该函数没有调用 `updateModuleProposalStatus`，proposal 停留在 `submitted`。

**证据 3 — merge_module_proposal 要求 approved 状态**

`src/mcp/tools.ts:1624-1626`：

```typescript
// Must be approved
if (proposal.status !== "approved") {
  errors.push(err("NOT_APPROVED", `Proposal must be approved before merge. Current status: ${proposal.status}`));
}
```

**证据 4 — MCP 工具注册表中无 approve_proposal**

`src/mcp/server.ts` 注册的所有工具中，没有任何工具可以将提案从 `submitted` 推进到 `approved`。已注册的提案相关工具为：`create_module_proposal`、`attach_proposal_entity`、`add_proposal_port`、`add_proposal_dependency`、`add_proposal_flow`、`mark_proposal_gap`、`submit_module_proposal`、`submit_proposal_review`、`list_proposal_reviews`、`resolve_proposal_finding`、`merge_module_proposal`、`list_merged_proposals`。无一能推进提案状态。

**影响**：任何使用完整 proposal → review → merge 流程的初始化都会被阻塞。这是 v0.2 核心场景的阻塞缺陷。

---

### 问题 2：会话持久性不足 — ⚠️ 重要（确认，需修正描述）

**结论：问题真实存在，但原始描述有误。数据并未丢失，丢失的是内存中的数据库句柄。**

**关键发现：图数据确实做了持久化**

SQLite 数据库文件位于 `.blockgraph/blockgraph.db`（`src/graph/store.ts:9-10`），所有表使用 `CREATE TABLE IF NOT EXISTS`（`src/graph/store.ts:57-227`），不会清空已有数据。`begin_initialization` 调用 `openStore()` 打开已有 DB 文件，不执行任何 DELETE 操作。

**因此原始报告中"所有中间状态丢失"的描述不准确。** 工作包、提案、草稿块、实体映射等数据仍然保存在 `.blockgraph/blockgraph.db` 文件中。

**真正的问题是 `ctx` 内存句柄丢失后无法自动恢复。**

**证据 1 — ToolContext 是纯内存对象**

`src/mcp/tools.ts:88-95`：

```typescript
export interface ToolContext {
  db: Database.Database | null;   // better-sqlite3 连接句柄，存在于进程内存中
  repoPath: string | null;
}

export function createToolContext(): ToolContext {
  return { db: null, repoPath: null };
}
```

MCP server 进程重启后，`ctx` 被销毁，`ctx.db` 变为 `null`。

**证据 2 — 错误消息具有误导性**

当 `ctx.db` 为 `null` 时，所有工具返回：

```
NO_SESSION: No active session. Call begin_initialization first.
```

这条消息暗示需要"重新开始"，但实际上重新调用 `begin_initialization` 只是重新打开同一个 DB 文件，数据完好。这导致用户误以为数据已丢失。

**证据 3 — 无自动恢复机制**

`src/mcp/server.ts:68-74` 中 `createServer()` 创建空的 `ctx`：

```typescript
export function createServer(): { server: McpServer; ctx: ToolContext } {
  const server = new McpServer({ ... });
  const ctx = createToolContext();   // { db: null, repoPath: null }
  // 不会自动打开已有的 .blockgraph/blockgraph.db
}
```

MCP server 重启后不会自动重新连接已有的数据库，必须由用户手动调用 `begin_initialization`。

**证据 4 — session_id 无意义**

`src/mcp/tools.ts:172`：

```typescript
const sessionId = `session-${Date.now()}`;
```

每次调用生成新的 session ID，无法识别"这是同一个仓库的同一次初始化"。没有 `list_sessions`、`resume_session` 等工具。

**原始报告中的错误**

原始报告称 `createDb` 内部调用 `resetDb` 清空所有表——经核查，`store.ts` 中不存在 `resetDb` 函数，`openStore` 使用 `CREATE TABLE IF NOT EXISTS`，不会删除数据。原始报告中的 `NO_SESSION` 错误被误解为数据丢失，实际只是内存句柄丢失。

**修正后的影响评估**：

| 原始描述 | 实际情况 |
|----------|----------|
| "所有中间状态丢失" | ❌ 数据在 SQLite 文件中持久化，并未丢失 |
| "需要从头开始" | ❌ 重新调用 `begin_initialization` 即可恢复 |
| "会话持久性不足" | ✅ 更准确的说法是：ctx 句柄恢复机制缺失 |

**实际影响**：用户体验差——错误消息误导用户以为数据丢失；MCP server 重启后需要手动重新连接；无法查询已有初始化进度。但数据本身不会丢失。

---

### 问题 3：Skill 工作流设计不完整 — ⚠️ 重要（确认）

**结论：真实存在。**

**证据 1 — parallel-initialization-skill.md 未覆盖审批流程**

`docs/parallel-initialization-skill.md` 描述了 Step 7 "Merge Approved Proposals"，但没有说明如何将提案从 `submitted` 变为 `approved`。未提及 `submit_proposal_review` 不推进状态的问题。

**证据 2 — 无降级路径文档**

两个 skill 文档均未提供 `merge_module_proposal` 失败时的降级方案（如直接使用 `create_block` + `attach_code_entity` 路径）。

**证据 3 — 无子代理权限检查指导**

skill 文档描述了并行子代理模式，但未说明子代理可能无法访问 `mcp__blockgraph__*` 工具的情况，也未提供验证方法。

**证据 4 — 无会话恢复指导**

skill 文档未说明会话过期后如何处理，尽管 CLAUDE.md 有 "Context Compression Recovery Rules"，但那是给 Claude 的内部指引，不是给使用者的操作指南。

**影响**：使用者按 skill 文档操作时会在 Step 7 阻塞，且无自救路径。

---

### 问题 4：工作包状态机过于刚性 — 🔧 可改进（确认）

**结论：真实存在，但非阻塞性问题。**

**证据 — WP_TRANSITIONS 严格线性**

`src/graph/draft.ts:715-721`：

```typescript
const WP_TRANSITIONS: Record<WorkPackageStatus, WorkPackageStatus[]> = {
  planned: ["assigned", "rejected", "deferred", "merged"],
  assigned: ["proposed", "rejected", "deferred", "merged"],
  proposed: ["reviewing", "rejected", "deferred", "merged"],
  reviewing: ["needs_revision", "approved", "rejected", "merged"],
  needs_revision: ["proposed", "rejected", "deferred", "merged"],
};
```

`planned → approved` 和 `planned → reviewing` 确实被拒绝。

**严重程度较低的原因**：

1. 工作包状态（WP）和提案状态（Proposal）是两套独立系统。WP 状态机的刚性不是合并被阻塞的直接原因——阻塞的是 Proposal 状态机的断裂。
2. WP 状态允许跳转到 `merged`（从 `planned`/`assigned`/`proposed`/`reviewing`/`needs_revision` 均可），所以 merge handler 中的 `updateWorkPackageStatus(db, wp_id, "merged")` 不会失败。
3. 对于小型仓库的快速初始化，可以接受走完 `planned → assigned → proposed → reviewing → approved` 的完整流程。

**改进建议**：允许 `needs_revision → approved`（修复后直接审批，无需重新走 reviewing），以及为小型仓库场景允许 `planned → approved` 快速通道。优先级低于问题 1-3。
