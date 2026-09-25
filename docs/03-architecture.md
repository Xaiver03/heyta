# 架构决策

> **状态：技术栈层已定**（2026-09-25）。剩余待决项见 §7。
> 本文档记录**已确认**的架构选择；证据与拆解过程见 `research/deep-dive-*.md`。

## 0. 已确认的决策

| # | 决策 | 值 | 依据 |
|---|---|---|---|
| 1 | 商业模式 | **开源核心 + 自建/托管收费** | 你的选择 |
| 2 | 平台 | **全平台同时（本地优先）** | 你的选择 |
| 3 | **前端生态** | ✅ **JavaScript / TypeScript 生态** | 你的选择（2026-09-25） |
| 4 | **同步内核** | ✅ **直接复用 `@sp/sync-core`（MIT）** | 已实测：独立构建 + 271/271 测试通过 |
| 5 | 同步服务端 | ✅ **以 `super-sync-server` 为基座改造** | 已拆解：9 同步 + 13 鉴权端点，零 copyleft |
| 6 | 部署环境 | ✅ **自有服务器，可跑 Docker** | 你的确认（2026-09-25） |
| 7 | 许可证 | 🟡 **待最终确认**（ADR-0001） | `docs/04-license-decision.md` |

---

## 1. 为什么选 JS 生态（这次决策的依据）

调研给出的四条跨语言路线（详见 `research/deep-dive-cross-language.md`）：

| 路线 | 复用度 | 结论 |
|---|---|---|
| **A. 留在 JS 生态** | 🟢 **接近 100%** | ✅ **已选** |
| B. Flutter + 移植加密与同步 | 🟡 中 | 加密有 Kotlin 蓝本，但同步 4,240 行要重写 |
| C. Flutter + JS sidecar | 🟢 高但脆 | 移动端不允许常驻后台进程 |
| D. 服务端权威 | 🔴 低 | 与"本地优先"原则冲突 |

选 A 的三个实质理由：

1. **`op-log` 那 51,708 行可以直接参考甚至搬运语义。** 它是 Angular 服务，但算法与状态机是语言无关的。
   换成 Flutter 就等于**主动放弃这份参考实现**，从零推演同样的边界情况。
2. **同步内核与协议都是 TS 原生的。** `sync-core` 我实测过能独立构建；`shared-schema` 的
   zod 线协议契约（384 行）可以直接复用，客户端零转译成本。
3. **全平台已被上游验证可行。** Super Productivity 本身就是 Angular + Electron + Capacitor
   覆盖六端——这条路不需要我们重新探索。

**代价（必须认清）**：移动端是 WebView 套壳，体验不如原生；iOS 后台同步能力受限
（上游就只在 Android 做了原生后台）。这些是**已知的、可接受的**代价。

---

## 2. 分层架构

```
┌─────────────────────────────────────────────────────────┐
│  UI 层（各端可不同）                                     │
│  Web / 桌面(Tauri 或 Electron) / 移动(Capacitor)         │
├─────────────────────────────────────────────────────────┤
│  应用编排层（🔧 自研，参考 op-log 语义）                  │
│  操作捕获 · 离线队列 · 应用/回放 · 冲突 UI                │
├─────────────────────────────────────────────────────────┤
│  领域层（🔧 自研）                                       │
│  四象限规则 · 习惯 streak · 番茄钟 · RRULE               │
├─────────────────────────────────────────────────────────┤
│  同步内核（✅ 直接复用 @sp/sync-core）                    │
│  向量时钟 · LWW 冲突解决 · E2EE · 压缩                   │
├─────────────────────────────────────────────────────────┤
│  存储适配层（🔧 自研，抄 OpLogDbAdapter 接口）            │
│  IndexedDB / SQLite / 各端文件系统                       │
└─────────────────────────────────────────────────────────┘
```

**关键原则（来自调研的"干净 vs 快"结论）**：
> 在**不可逆的层**（同步协议、数据 schema、服务端）投入干净；
> 在**可替换的层**（UI 组件、平台外壳、集成）接受将就。

---

## 3. 同步层：已定，不再自研

`docs/03` 早先版本建议"自研 LWW + 操作日志"——**该结论已被推翻**。

`@sp/sync-core`（MIT，4,240 行，271 测试）已经实现了这套东西，且**明确为宿主复用而设计**
（源码注释原文："Host applications that wire their own state framework (NgRx, Redux, etc.) extend
`EntityConfig`…"）。它只依赖 2 个 MIT 包（`@noble/ciphers`、`hash-wasm`），有 7 个 host Port
作为集成接缝。

**决定：直接复用，不自研。** 我们只需要写那 7 个 Port 的适配代码 + 自己的实体注册表。

### 3.1 明确不引入的同步框架

| 方案 | 排除原因 |
|---|---|
| PowerSync | 服务端 source-available，**明文限制竞品商用** |
| Couchbase Lite 4.x | BSL，**禁止提供竞争性托管服务** |
| sqlite-sync | 同上 |
| Triplit | 团队已被 acqui-hire，转社区维护，风险高 |
| CRDT（Yjs 等） | 冲突场景是"手机勾完成、电脑改日期"，非字符级协同。**后置**，仅在"任务描述实时协同"出现时再议 |

---

## 4. 数据模型要点

**实体清单**：`@sp/shared-schema` 的 `ENTITY_TYPES` 是 **SP 专属硬编码 21 项**，必须替换。
映射与改造清单见 `research/deep-dive-schema-providers.md` §1.1。

```
Task         — id, listId, parentId, title, desc, priority, dueDate, startDate,
               allDay, rrule, completed, completedAt, sortOrder, deletedAt, rev, updatedAt
List         — id, name, icon, color, folderId, sortOrder, rev, ...
Tag          — id, name, color              TaskTag — taskId, tagId
Habit        — id, name, icon, color, goalType(target/unit), frequency, rrule
HabitLog     — id, habitId, date, value, note
FocusSession — id, taskId?, startedAt, endedAt, mode(pomo/stopwatch), duration
Reminder     — id, taskId, triggerAt, offset, fired
```

必须提前定的三个细节（后期改代价极大）：

1. **排序字段**：用 `sortOrder` 小数或 LexoRank 字符串，避免拖拽时整表重排
2. **时区**：日期存 UTC + 记录用户时区；**习惯打卡的"今天"必须按用户本地时区算**
3. **删除**：一律软删除 + 墓碑，否则离线端会把已删数据"复活"

### ⚠️ Schema 版本策略（直接继承上游教训）

上游 `schema-version.ts` 的核心政策：**默认不 bump**。bump 是近乎单向的栅栏，且**保护不了已发布的客户端**。
若旧客户端能未迁移应用，应该用 **payload marker（envelope）** 向前兼容，而不是 bump 版本号。
上游为此记录了一个反例（v4 为一个纯标记变更做了 bump，毫无必要地栅栏住了所有滞后客户端）。

**我们直接继承这条政策。**

---

## 5. 服务端

| 组件 | 选型 | 依据 |
|---|---|---|
| 语言 | **TypeScript + Fastify** | 以 `super-sync-server` 为基座 |
| 数据库 | **PostgreSQL** | 上游即 Postgres；Prisma schema 可复用 |
| ORM | Prisma 5 | 已拆解，6 张表 |
| 鉴权 | JWT Bearer（365 天）+ Passkey + Magic Link | 已拆解，13 个端点 |
| 部署 | **Docker Compose**（自建友好）+ 自有服务器托管 | 你的服务器可跑 Docker |
| 推送 | 自建 APNs + FCM，或 ntfy 类方案 | 推送是待办类产品生命线，**不能用第三方依赖** |
| 实时同步 | WebSocket（`/api/sync/ws`） | 上游已有 |

### 5.1 部署物料上游已经齐了

`super-sync-server` 自带：`Dockerfile` / `docker-compose.yml` / `helm/` / `Caddyfile` /
`prisma/migrations/` / 邮件模板 / **法律文本模板**（隐私政策等，面向 GDPR 场景设计过）。

> ⚠️ **未实测**：本机没装 Docker，服务端**从未真实跑起来过**。
> 这是实施阶段第一件要在你的服务器上验证的事。

---

## 6. 分层交付顺序

全平台不等于六端同时开工。**一次设计六端架构，分三批交付**：

| 批次 | 内容 | 为什么这个顺序 |
|---|---|---|
| 第一批 | 共享核心（复用 sync-core + 自有领域层/存储层）+ **1 个端跑通** + 服务端跑起来 | 核心不对，后面全是重构 |
| 第二批 | 补齐其余端 | 核心稳定后，端只是外壳 |
| 第三批 | 小组件、通知、日历双向同步等平台特有能力 | 依赖前两批 |

---

## 7. 剩余待决项

- [ ] **许可证最终确认**（ADR-0001，`docs/04-license-decision.md`）——
      当前倾向：fork MIT 底座 + 自有增量以 AGPL-3.0 发布 + 运营层（计费/多租户）闭源
- [ ] **JS 生态内的具体框架**（React vs Vue vs Angular）—— 待定，见实施计划
- [ ] **MVP 范围**——P0 功能里先做哪些，待定

---

*本文档随决策更新。重大选型以 ADR 形式记录，不接受口头决定。*
