# BlockGraph 模型审查报告 — `ts-react-complex`

## 模型概览

| 指标 | 数值 |
|---|---|
| 代码实体 | 64 个扫描，42 个纳入 accepted 图 |
| 代码边 | 44 条 |
| Block | 12 个（全部 accepted） |
| Port | 15 个 |
| Connector | 5 个 |
| Flow | 3 个 |
| 实体覆盖率 | 95.2% |

---

## 1. Block 用途 vs. 映射代码实体

| Block | 用途描述 | 判定 |
|---|---|---|
| **App Shell** | 通过 react-router 路由到 4 个 feature 模块 — 映射 App.tsx + paths.ts | ✅ 正确 |
| **Auth Feature** | 登录表单 + 认证服务 — 映射 LoginForm.tsx + authService.ts | ✅ 正确 |
| **Comments Feature** | 评论表单 + 评论服务 | ✅ 正确 |
| **Discussions Feature** | 讨论列表 + 讨论服务 | ⚠️ 函数实体缺失（见 §2） |
| **Teams Feature** | 团队列表 + 团队服务 | ✅ 正确 |
| **Users Feature** | 用户资料 + 用户服务 | ⚠️ 函数实体缺失（见 §2） |
| **Shared UI Components** | Button + Input 叶子组件 | ✅ 正确 |
| **Shared Hooks** | useAuth hook | ✅ 正确 |
| **Shared Types** | User, Discussion, Comment, Team 接口 | ✅ 正确 |
| **Shared Utilities** | formatDate, formatError | ✅ 正确 |
| **API Client** | 基于 fetch 的 HTTP 封装 | ✅ 正确 |
| **Testing Utilities** | mockApi, createMockUser | ✅ 正确 |

**结论：** 12 个 Block 的用途描述均准确反映了其映射的代码，没有 Block 声称了不属于自己的代码。

---

## 2. 缺失的实体映射

两个函数级实体**未映射**，尽管其所属文件已被正确归入对应 Block：

| 实体 | 文件（已映射） | 函数（未映射） | 应归属 |
|---|---|---|---|
| `src/features/discussions/DiscussionList.tsx:function:DiscussionList:5` | Discussions Feature ✅ | ❌ 未映射 | Discussions Feature |
| `src/features/users/UserProfile.tsx:function:UserProfile:9` | Users Feature ✅ | ❌ 未映射 | Users Feature |

两者都是各自 Feature 的核心导出组件。如果缺失映射，维护 agent 查询"Discussions Feature 拥有哪些代码？"时会得到文件和服务，但漏掉最关键的 React 组件。

**根因：** LoginForm、CommentForm、TeamList 的函数实体均已映射，但 DiscussionList 和 UserProfile 在初始化时被遗漏了。可能是 module proposal 编写时的不一致。

---

## 3. 跨 Block 交互：Connector vs. 实际依赖

### 模型中已有的 5 个 Connector

```
App Shell [appRouter] ──render──> Auth Feature [loginForm]
App Shell [appRouter] ──render──> Discussions Feature [discussionList]
App Shell [appRouter] ──render──> Teams Feature [teamList]
App Shell [appRouter] ──render──> Users Feature [userProfile]
Shared Hooks [hookExports] ──function_call──> Auth Feature [loginForm]
```

### 缺失 A：4 条未解释的跨 Block 渲染边（质量门已标记）

| 代码边 | 源 Block | 目标 Block | 是否真实 |
|---|---|---|---|
| `LoginForm renders Input`（×2） | Auth Feature | Shared UI Components | 真实依赖 |
| `LoginForm renders Button` | Auth Feature | Shared UI Components | 真实依赖 |
| `CommentForm renders Button` | Comments Feature | Shared UI Components | 真实依赖 |

这些是真实的 import/render 关系。模型需要从 Auth Feature 和 Comments Feature 的 port 到 Shared UI Components 的 `uiExports` port 建立 connector（协议：`render`）。

### 缺失 B：API Client 依赖完全未连接

5 个 feature service 都 import 了 `apiClient`：

- `authService.ts` → `apiClient`（Auth Feature → API Client）
- `commentService.ts` → `apiClient`（Comments Feature → API Client）
- `discussionService.ts` → `apiClient`（Discussions Feature → API Client）
- `teamService.ts` → `apiClient`（Teams Feature → API Client）
- `userService.ts` → `apiClient`（Users Feature → API Client）

API Client Block 有 `apiMethods` port（out），各 feature Block 有 API port（in），但**零个 connector** 连接它们。这是最大的结构缺陷。维护 agent 查看 API Client Block 时会发现它没有任何出边，可能误判为未使用。

### 缺失 C：Shared Types 依赖未连接

所有 feature service 都 import 了对应类型（User, Discussion, Comment, Team），这些类型在 Shared Types Block 中。代码边已捕获 import 关系，但 Block 图中没有从 Shared Types 的 `typeExports` port 到各 feature Block 的 connector。

---

## 4. Flow 分析

### Login Flow（4 步）

| 步骤 | 代码实体 | 分配的 Block | 是否正确 |
|---|---|---|---|
| 1 | LoginForm 组件 | Auth Feature | ✅ |
| 2 | useAuth 函数 | **Auth Feature** | ❌ — 应为 **Shared Hooks** |
| 3 | loginUser 函数 | Auth Feature | ✅ |
| 4 | apiClient.ts 文件 | **Auth Feature** | ❌ — 应为 **API Client** |

**步骤 2 和 4 的 Block 分配错误。** Flow 正确识别了执行序列，但维护 agent 按 Flow 走会在 Auth Feature 中找不到 useAuth 和 apiClient。

### Discussion List Flow（2 步）

| 步骤 | 代码实体 | 分配的 Block | 是否正确 |
|---|---|---|---|
| 1 | DiscussionList 组件 | Discussions Feature | ✅ |
| 2 | fetchDiscussions 函数 | Discussions Feature | ✅ |

✅ 正确。

### Comment Creation Flow（2 步）

| 步骤 | 代码实体 | 分配的 Block | 是否正确 |
|---|---|---|---|
| 1 | CommentForm 组件 | Comments Feature | ✅ |
| 2 | addComment 函数 | Comments Feature | ✅ |

✅ 正确。

### 缺失的 Flow

| 缺失 Flow | 应存在的理由 |
|---|---|
| **Team List Flow** | TeamList → useEffect → fetchTeams — 与 Discussion List Flow 完全同构 |
| **User Profile Flow** | UserProfile → useEffect → fetchUser — 同上 |
| **Logout Flow** | authService.logoutUser 已存在，通过 useAuth.logout 调用 |

---

## 5. 证据验证

所有证据的文件路径和行号均已对照源码验证：

| 证据声明 | 源码实际 | 判定 |
|---|---|---|
| LoginForm.tsx:7-25 | 组件确实在 7-25 行 | ✅ |
| LoginForm.tsx:10 调用 useAuth | 第 10 行 `const { setUser } = useAuth()` | ✅ |
| LoginForm.tsx:14 调用 loginUser | 第 14 行 `await loginUser(email, password)` | ✅ |
| authService.ts:4-7 loginUser | 4-7 行，post 到 `/auth/login` | ✅ |
| authService.ts:5 apiClient.post | 第 5 行 `apiClient.post('/auth/login', ...)` | ✅ |
| DiscussionList.tsx:5-19 | 组件确实在 5-19 行 | ✅ |
| DiscussionList.tsx:8 调用 fetchDiscussions | **实际在第 9 行**：`fetchDiscussions().then(setDiscussions)` | ⚠️ 偏差 1 行 |
| CommentForm.tsx:15 调用 addComment | 第 15 行 `await addComment(discussionId, text)` | ✅ |
| commentService.ts:9-12 addComment | 9-12 行 | ✅ |

**一处行号偏差：** Discussion List Flow 步骤 2 的证据声称第 8 行，实际调用在第 9 行。

---

## 6. 维护模拟

### 模拟 1：追踪"用户提交登录表单"的代码路径

**使用模型：**
1. 找到 "Login Flow" → 入口：LoginForm 组件
2. 步骤 1：LoginForm（Auth Feature）— 渲染表单，处理提交
3. 步骤 2：useAuth（Auth Feature — **错误**）— 实际在 Shared Hooks
4. 步骤 3：loginUser（Auth Feature）— 发送凭据
5. 步骤 4：apiClient（Auth Feature — **错误**）— 实际在 API Client

**结果：** Flow 正确识别了 4 步序列，但步骤 2 和 4 将 agent 引导到错误的 Block。维护 agent 需要回退到源码才能找到 useAuth（`src/hooks/`）和 apiClient（`src/lib/`）。**Flow 具有误导性。**

### 模拟 2：修改 apiClient.ts 的影响范围

**使用模型：**
- API Client Block 有 `apiMethods` port（out）
- **无 connector** 从 apiMethods 到任何 feature Block
- 代码边确实显示 5 个 import，但 Block 图未连接

**结果：** 模型在此模拟中失败。维护 agent 查看 Block 图会认为 API Client 是孤立的。需要回退到代码边查询（`list_code_edges` 按 apiClient 文件过滤，确实有效）。**Block 级影响分析不可用；代码级可用。**

### 模拟 3：在哪里添加"团队成员邀请"功能

**使用模型：**
1. 找到 "Teams Feature" Block — 有 TeamList 组件 + teamService
2. teamService 已有 fetchTeams、createTeam
3. 新的邀请功能应在 Teams Feature Block 内扩展，增加 `inviteMember()` 方法和 InviteForm 组件
4. 正确位置：Teams Feature Block 内，扩展其 port

**结果：** ✅ 模型正确识别了目标 Block。`teamApi` port 的合约描述（"Fetches and creates teams via API client"）需要更新以包含邀请功能，这是可发现的。

---

## 7. 审查结论

### 错误的 Block 映射
- Login Flow 步骤 2 和 4 将 useAuth 和 apiClient 分配给 Auth Feature，而非其实际所属 Block

### 缺失的模块
- 无 — 所有目录和 feature 已覆盖

### 缺失的实体映射
- DiscussionList 函数未映射到 Discussions Feature
- UserProfile 函数未映射到 Users Feature

### 未解释的边界
- 4 条跨 Block 渲染边（feature → shared UI）缺少 connector
- 5 条跨 Block API Client 依赖完全缺少 connector
- API Client Block 在 Block 图中看似孤立，实际是使用最广泛的共享模块

### 误导性 Flow
- Login Flow 的 4 步中有 2 步 Block 分配错误
- Discussion List Flow 证据行号偏差 1 行

### 模型中有价值的部分
- ✅ Block 分解干净，与目录结构吻合
- ✅ Feature/Shared 分层正确且有用
- ✅ Port 合约描述准确
- ✅ App Shell 路由 connector 正确建模了 router → feature 关系
- ✅ Shared Hooks → Auth Feature connector 正确捕获了 useAuth 依赖
- ✅ 代码边图（import/calls/renders）准确完整
- ✅ 已有正确 Flow 的模块（Discussion List、Comment Creation）能有效辅助维护

### 最终判定：**需要修订，无需重新初始化**

Block 分解本身是合理的 — 12 个 Block 正确划分了代码库。但模型存在三个结构性问题会误导维护 agent：

1. **Connector 缺失** — 两个最重要的跨 Block 关系（UI 组件使用和 API Client 使用）没有 connector。Block 图呈现了误导性的孤立画面。
2. **Flow 步骤 Block 分配错误** — Login Flow（最关键的用户操作）中 2/4 的步骤指向错误 Block。
3. **两个核心组件实体未映射** — Discussions 和 Users Block 不完整。

### 建议修复优先级

| 优先级 | 修复项 | 工作量 |
|---|---|---|
| P0 | 修复 2 个未映射的函数实体 | 小 — 调用 `attach_code_entity` |
| P0 | 为 API Client 依赖添加 5 个 connector | 中 — 需创建/识别 port 并连接 |
| P1 | 为 UI 组件使用添加 4 个 connector | 中 |
| P1 | 修复 Login Flow 步骤 2 和 4 的 Block 分配 | 小 |
| P2 | 添加 Team List 和 User Profile Flow | 中 |
| P2 | 修复 Discussion List Flow 证据行号 | 小 |
