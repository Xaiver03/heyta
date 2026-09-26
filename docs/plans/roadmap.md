# heyta 实施计划（总路线图）

> 状态：**进行中** —— P0、P1 已完成，P2 进行中
> 前置决策见 `docs/reference/architecture.md` §0；复用依据见 `docs/research/reuse-plan.md`。
> P1 的详细计划见 `docs/plans/phase-1-single-client-loop.md`。
> P2 的详细计划见 `docs/plans/phase-2-multi-platform.md`。
> **AI 能力线与开发分支策略见 `docs/plans/ai-capability-branches.md`**（与 P2/P3 **并行**，不是下一个阶段）。
> AI 的数据路径决策见 [ADR-0005](../adr/0005-ai-data-path.md)（**待确认**）。

---

## 0. 硬性约束（贯穿所有阶段）

| 约束 | 内容 |
|---|---|
| **可维护性门槛** | 引入的任何第三方组件，**必须 2021 年之后仍在持续更新**，否则排除。每次引入前用 `python3 research/tools/ghinfo.py owner/repo` 或 npm registry 核实最后提交/发版时间 |
| **许可证** | 逐项登记到 `research/licenses-inventory.generated.md`，未登记不得引入。门禁：`node research/tools/license-inventory.mjs`（非零退出即不合格） |
| **本地优先** | 数据先落本地；云端是同步通道而非事实源 |
| **不可逆层优先干净** | 同步协议、数据 schema、服务端要一次做对；UI/外壳/集成可以先将就 |

---

## 1. 阶段划分

| 阶段 | 目标 | 交付判据 | 状态 |
|---|---|---|---|
| **P0 奠基** | 工程骨架 + 实体模型 + 服务端跑通 | 能在 Docker 上完成一次真实的「A 端写入 → B 端同步可见」 | ✅ **已完成**（2026-09-25） |
| **P1 单端闭环** | 1 个端（Web）跑通核心功能 | 任务/清单/四象限/习惯/番茄钟可用，能同步 | ✅ **已完成**（6 条零 mock E2E）→ [详细计划](phase-1-single-client-loop.md) |
| **P2 多端补齐** | 桌面 + 移动 | 存储可替换（同一套契约跑遍所有实现）+ 原生端 SQLite，共享同一套核心 | 🔄 **进行中** → [详细计划](phase-2-multi-platform.md) |
| **P3 平台特有能力** | 小组件、通知、CalDAV 双向同步 | 依赖前两阶段 | ⏸ |

### 1.1 并行轨道：AI 能力线

AI **不是 P4**，而是一条与 P2/P3 并行的轨道 —— 理由与排序原则见
[AI 能力分支与开发分支策略](ai-capability-branches.md)。

| 分支 | 内容 | 前置 | 状态 |
|---|---|---|---|
| **AI-0 基座** | `packages/ai` 的 provider 端口 + BYOK/自托管后端 + 隐私提示 + 分层门禁 | 两个 spike（浏览器 CORS、RN 端侧运行时） | 📋 规划中 |
| **AI-1 捕获** | 一句话 → 结构化任务字段（`chrono-node` 打底，AI 只兜长尾） | AI-0 | 📋 规划中 |
| **AI-2 结构化** | 拆解任务（先落 `note` checklist）、逐条象限/优先级建议 | AI-0 | 📋 规划中 |
| **AI-3 规划** | 今日计划、时间块、AI 排程 | AI-1/AI-2 的真实使用数据 | ⏸ 推迟 |
| **AI-4 复盘** | 周报、习惯趋势叙述 | AI-0 + 端侧推理（受限分支） | ⏸ 受限 |
| **AI-5 接口 / 数据主权** | 全量导出、本地 API、MCP server | **无**（与 AI-0 解耦，可并行） | 📋 规划中 |

⚠️ 同一份计划里还有 **3 条不是 AI 的功能设想**（甘特图→时间线视图、Time Left 式倒计时、
API 数据出口），已刻意放在**非 AI 分支** —— 理由见该计划 §1 与 §5。

### 1.2 并行轨道：激励与成长体系

激励体系**不是下一个阶段**，而是一条与 P2/P3、AI 线并行的**产品轨道**。

它的起点是一个诊断：heyta 缺的不是功能，是**回路** —— 打卡之后界面只把按钮从
「打卡」变成「已打卡」，然后什么都没有，用户收不到任何"我做了一件有用的事"的信号。
心理学证据、竞品拆解与反需求见 [激励与成长体系设计](motivation-and-progression.md)。

| 层 | 内容 | 状态 |
|---|---|---|
| **L1 即时反馈** | 今日进度卡（真实口径，含计划外完成）+ 进度条闭合反馈 | ✅ **已实现** |
| **L2 连续性** | 连续 / 最长 / 累计三指标 + **冻结** + 续接 + 重新开始 | ✅ **已实现** |
| **L3 叙事** | 周复盘信、里程碑地图（17 个）、身份标签、年度视图、分享卡 | ✅ **已实现** |

🔴 两条**结构约束**（不是偏好，已进 ADR）：

- **不发行任何货币** —— 没有金币 / 积分 / 商店，也不卖"后悔"（竞品的付费冻结与
  付费修复**明确否决**）。因此「冻结余额」**不上界面**、也**不加持久化字段** ——
  [ADR-0015](../adr/0015-resilience-state-stays-derived.md)。
- **只与自己的过去比** —— 排行榜 / 联赛 / 自习室 / 组队打 Boss **结构上不可能**：
  它们需要可信的跨用户聚合，而 E2EE 下服务端看不到明文，本地优先下也没有可信的汇总方。

⚠️ 状态：**代码已实现并通过验证，但分支尚未合并进 `main`**（等并发会话提交完它未提交的
`packages/i18n` 等改动；`main` 当前按提交状态无法构建）。合并后本条随之更新。

### P0 完成证据（2026-09-25）

| 交付判据 | 证据 |
|---|---|
| 工程骨架 | pnpm monorepo：`packages/sync-core`、`packages/shared-schema`、`packages/storage`、`server` |
| 实体模型 | 13 个实体，含 heyta 特有的 `HABIT` / `HABIT_LOG` / `FOCUS_SESSION` |
| Docker 跑通 | 镜像 `supersync:local` 构建成功；31 个迁移在容器内应用；容器 healthy |
| 真实同步闭环 | `pnpm verify:sync` 退出码 0：A 加密上传 → B 可见 → 载荷仍为密文 → 并发判 `CONFLICT_CONCURRENT` |
| 回归 | `pnpm -r build/typecheck/test` 全绿，1444 个测试通过 |
| 许可证 | 315 个依赖全部宽松许可，逐项登记；门禁工具经"注入假 AGPL 包"验证过**能失败** |

复现步骤见 [`docs/runbooks/local-server-verification.md`](../runbooks/local-server-verification.md)。

> **为什么 P0 不碰 UI**：`docs/reference/architecture.md` 的分层原则——核心不对，后面全是重构。
> P0 的成功标志是**协议通了**，不是界面好看。

---

## 2. 第一阶段（P0）任务分解

### 2.1 工程骨架

**结构**（借鉴 Super Productivity 的 monorepo 组织，但只取需要的部分）：

```
heyta/
├── packages/
│   ├── sync-core/        # ✅ 直接取上游（MIT），不改动，作为依赖引入
│   ├── shared-schema/    # 🔧 fork 后改造实体清单
│   ├── domain/           # 🔧 自研：四象限规则、habit streak、RRULE、番茄钟
│   └── storage/          # 🔧 自研：OpLogDbAdapter 接口 + IndexedDB/SQLite 实现
├── apps/
│   └── web/              # 🔧 P0 只做最小验证 UI（不是产品界面）
└── server/               # 🔧 以 super-sync-server 为基座
```

**工具链**（全部通过可维护性核实）：

| 工具 | 版本 | 许可 | 最后发版 |
|---|---|---|---|
| TypeScript | 5.x | Apache-2.0 | 活跃 |
| pnpm | 11.x | MIT | 活跃 |
| vite | 8.3.1 | MIT | 2026-09-24 |
| vitest | 5.0.1 | MIT | 2026-09-15 |
| tsup | 8.5.1 | MIT | 2025-11-12 |

### 2.2 引入 `sync-core`（已验证可行）

已实测：脱离 monorepo 独立构建成功，**271/271 测试通过**。P0 的动作：

1. 以其原始 MIT 版本引入（**不改代码**，这样将来能跟上游更新）
2. 写一个 `EntityConfig` 注册表，把 heyta 实体接进 7 个 host Port
3. 复用 `OpLogDbAdapter` 的**接口设计**（注意：只抄接口，实现自研）

### 2.3 定义实体模型（不可逆层，要一次做对）

对照 `@sp/shared-schema` 的 `ENTITY_TYPES` 做映射（详见 `research/deep-dive-schema-providers.md` §1.1）：

| heyta 实体 | 来源 | 已物化 | 备注 |
|---|---|---|---|
| `TASK` `PROJECT` `TAG` | 沿用 | ✅ | |
| `HABIT` `HABIT_LOG` | **新增** | ✅ | 上游只有 `SIMPLE_COUNTER`，语义不够 |
| `FOCUS_SESSION` | **新增** | ✅ | 上游借用 `METRIC` |
| `GLOBAL_CONFIG` `MIGRATION` `RECOVERY` `ALL` | 沿用 | — | 系统实体，有意不物化 |
| 🔴 `NOTE` | 沿用 | ❌ | **领域类型未定义，reducer 不物化** |
| 🔴 `TASK_REPEAT_CFG` | 沿用 | ❌ | **同上；重复展开语义未定** |
| 🔴 `REMINDER` | 沿用 | ❌ | **同上；通知调度未定** |
| ~~`WORK_CONTEXT`~~ `TIME_TRACKING` `ISSUE_PROVIDER` `PLUGIN_*` `MENU_TREE` | **删除** | — | 不需要 |

⚠️ **改一处要同步改两处**：`shared-schema` 与服务端 `validation.service.ts` 都依赖这份清单，
服务端**会拒绝未知实体类型**。

🔴 **上表里三个 ❌ 是实测确认的静默丢数据**，不是"还没做"那么轻描淡写：
它们是**合法实体**（`isEntityType()` 为 true），`dispatch` **不报错**，op 照常入队、
上传、同步到所有设备 —— 但**没有任何设备会物化它们**。用户建一条重复任务，
它同步得到处都是，哪儿也不显示，且任何一层都不报错。

门禁已就位：`packages/op-log/tests/entity-coverage.spec.ts` 要求每个 `ENTITY_TYPES`
成员要么物化、要么在 `UNMODELED_ENTITY_TYPES` 里显式登记原因。**实现后必须把登记移掉**，
否则测试会红 —— 清单不会腐烂。

### 2.4 存储适配层

自研，但接口照抄上游 `op-log/persistence/op-log-db-adapter.ts` 的抽象
（上游有 IndexedDB 与 SQLite 两套实现可作参考，但**实现不可搬运**——那是 Angular 耦合的）。

P0 只需 IndexedDB 一套。

### 2.5 服务端跑通（在 Docker 服务器上）

**这是 P0 唯一依赖外部环境的一步，必须在你的服务器上做。**

1. 拉取 `super-sync-server`，改实体清单（与服务端 `validation.service.ts` 对齐）
2. `docker compose up`（上游自带 `Dockerfile` / `docker-compose.yml` / Caddyfile）
3. 用 Prisma migration 建表（注意上游警告：**`prisma db push` 会丢失 partial index**，必须走 migrate）
4. 验证 `/api/sync/status` 可达

### 2.6 P0 验收：真实同步闭环

**唯一判据**：模拟两个客户端，完成一次端到端同步。

```
客户端 A：本地写一条 TASK → 加密 → POST /api/sync/ops
客户端 B：GET /api/sync/ops → 解密 → 应用到本地 → 任务可见
反向：B 修改 → A 同步可见
冲突：两端同时改同一任务的标题 → 验证 LWW 按 clientId 确定性决胜
```

同时跑一次**跨端加密一致性**：复用 `research/tools/crypto-interop/` 的方法，
确认 Node 端加密的数据能被目标运行时解密。

---

## 3. 组件决策表（含可维护性判定）

> 判定规则：2021 年之后仍在更新才通过。数据为 2026-09-25 实测。

### ✅ 通过

| 组件 | 版本 | 许可 | 最后提交/发版 | 用途 |
|---|---|---|---|---|
| `@noble/ciphers` | 2.4.0 | MIT | 2026-08-27 | sync-core 依赖 |
| `hash-wasm` | 4.12.0 | MIT | 2024-11-19 | sync-core 依赖（Argon2id） |
| `zod` | 4.6.5 | MIT | 2026-09-13 | 线协议校验 |
| `fastify` | 5.12.5 | MIT | 2026-09-16 | 服务端 |
| `@prisma/client` | 7.10.0 | Apache-2.0 | 2026-08-25 | ORM |
| `react` | 19.3.0 | MIT | 2026-09-09 | UI |
| `zustand` | 5.0.15 | MIT | 2026-08-13 | 状态管理 |
| **`chrono-node`** | 2.10.1 | MIT | **2026-09-22** | 自然语言日期（**含中文**，已实测） |
| **`dnd-kit`** | 6.3.1 | MIT | **2026-09-12** | 四象限拖拽 |
| **`fullcalendar`** | 7.1.0 | MIT | **2026-09-05** | 日历视图 |
| **`ical.js`** | 2.2.1 | MPL-2.0 | **2026-09-17** | **RRULE 引擎 + iCalendar/CalDAV** |
| **`tsdav`** | 2.3.4 | MIT | **2026-09-19** | CalDAV 客户端（`natelindev/tsdav`） |
| `react-activity-calendar` | — | MIT | **2026-09-24** | 习惯热力图 |
| `frappe/Gantt` | 1.0.3 | MIT | 2026-03-05 | 甘特图（注意仓库名是 `frappe/Gantt`） |
| `moodist` | — | MIT | 2026-09-06 | 白噪音（参考实现） |

### ⚠️ 触线但需权衡

| 组件 | 问题 | 决策 |
|---|---|---|
| **`rrule` (rrule.js)** | 许可 ✅ BSD-3-Clause（GitHub 的 NOASSERTION 是误报，已读原文）；但**最后发版 2023-11-10**，近 3 年无更新 | **改用 `ical.js` 做 RRULE 引擎**——它活跃维护（2026-09-17）且自带完整 `Recur`/`RecurIterator`。而且做 CalDAV 反正是必须要它的，**一个依赖解决两件事** |
| `cal-heatmap` | 许可 ✅ MIT，但最后提交 **2024-03-03**（2.5 年） | **排除**，改用 `react-activity-calendar`（2026-09-24） |
| `prisma` CLI | latest 是 `8.0.0-rc.17`（RC，2026-09-24） | 用稳定线 `@prisma/client` 7.10.0。⚠️ 注意上游 `super-sync-server` 锁的是 Prisma **5.22.0**，有版本跨度，升级要单独评估 |

### ❌ 已排除（与可维护性无关的既有排除项）

PowerSync / Couchbase Lite 4.x / sqlite-sync（均 source-available 且**禁止竞品托管**）、
`@nextcloud/cdav-library`（**AGPL-3.0-or-later**）、Triplit（AGPL + 疑似停滞）、
Time_NLP 系列（**仓库无 LICENSE**）。

---

## 4. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **实体清单改动波及服务端** | 服务端拒绝未知实体，同步直接失败 | 清单放 `shared-schema` 单一来源，客户端与服务端同版本发布 |
| **Schema 版本策略误用** | bump 是近乎单向的栅栏，且**保护不了已发布客户端** | 继承上游政策：**默认不 bump**，优先用 payload marker 向前兼容 |
| **Prisma 版本跨度** | 上游锁 5.22.0，当前稳定线 7.10.0 | P0 **先沿用上游版本**跑通，升级单独立项 |
| **`prisma db push` 丢索引** | 多租户冲突检测会退化成全表扫描（上游真实事故） | 必须走 `prisma migrate`，且索引要写进 schema 文件 |
| **服务端从未真实运行过** | 未知的部署问题 | P0 头等大事，优先在服务器上验证 |
| **op-log 那 5 万行无法直接搬** | 编排层要从零写 | 当作**参考答案**读语义（状态机、墓碑、崩溃恢复），不搬代码 |
| **线协议 schema 不校验实体成员**（P0 实测发现） | 客户端拼错实体名时，**本地不会失败**，要到上传后被服务端拒绝才发现 | 客户端在构造 op 时用 `isEntityType()` 自查。这是客户端/服务端校验的**不对称**，已在 `scripts/verify-sync-loop.mjs` 中固化为断言 |

---

## 4.1 P0 验收工具

**`scripts/verify-sync-loop.mjs`** —— §2.6 的可执行版本，也是第一阶段的验收判据。

| 命令 | 作用 |
|---|---|
| `pnpm verify:sync:dry` | **不需要服务器**。用真实 zod 契约校验 op 形状、加密载荷、实体清单、客户端自查能力 |
| `pnpm verify:sync --base-url <url>` | 打真实服务端，跑完整闭环 |

实时模式验证四件事：
1. 连通性（`/api/sync/status` 要求鉴权 = 正常）
2. 创建测试账号（需服务端以 `TEST_MODE` 启动）
3. **A 写入 → B 下载可见**
4. **并发冲突必须被服务端拒绝**（两端基于同一向量时钟并发改同一实体）

**当前状态**：`--dry-run` 已实测通过；实时模式**尚未运行**（需要 Docker 环境）。

---

## 5. 下一步动作（按顺序）

1. **确认许可证 ADR-0001**（`docs/adr/0001-license-decision.md` 仍标"待确认"）——这是唯一还挡在前面的决策
2. 在服务器上 `docker compose up` 跑通 `super-sync-server`，确认 `/api/sync/status` 可达
3. 建 monorepo 骨架，引入 `sync-core`（原版不改）
4. 写 heyta 实体清单 + 7 个 host Port 适配
5. 实现 IndexedDB 存储适配
6. 跑通 §2.6 的同步闭环验收

---

*组件版本与活跃度均为 2026-09-25 实测。引入任何新依赖前必须重跑可维护性与许可证核实。*
