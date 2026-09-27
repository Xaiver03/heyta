# heyta 实施计划（总路线图）

> 状态：**进行中** —— P0、P1 已完成，P2 进行中
> 前置决策见 `docs/reference/architecture.md` §0；复用依据见 `docs/research/reuse-plan.md`。
> P1 的详细计划见 `docs/plans/phase-1-single-client-loop.md`。
> P2 的详细计划见 `docs/plans/phase-2-multi-platform.md`。
> **AI 能力线与开发分支策略见 `docs/plans/ai-capability-branches.md`**（与 P2/P3 **并行**，不是下一个阶段）。
> AI 的数据路径决策见 [ADR-0005](../adr/0005-ai-data-path.md)（✅ 已接受）。

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
| **P1 单端闭环** | 1 个端（Web）跑通核心功能 | 任务/清单/四象限/习惯/番茄钟可用，能同步 | ✅ **已完成**（`pnpm verify:p1` 自带真实服务端，跑 11 条零 mock E2E，含"真实点击 `ConflictDialog` → 双端收敛"两条）→ [详细计划](phase-1-single-client-loop.md) |
| **P2 多端补齐** | 桌面 + 移动 | 存储可替换（同一套契约跑遍所有实现）+ 原生端 SQLite，共享同一套核心 | 🔄 **进行中** → [详细计划](phase-2-multi-platform.md) |
| **P3 平台特有能力** | 小组件、通知、CalDAV 双向同步 | 依赖前两阶段 | ⏸ |

### 1.1 并行轨道：AI 能力线

AI **不是 P4**，而是一条与 P2/P3 并行的轨道 —— 理由与排序原则见
[AI 能力分支与开发分支策略](ai-capability-branches.md)。

| 分支 | 内容 | 前置 | 状态 |
|---|---|---|---|
| **AI-0 基座** | `packages/ai` 的 provider 端口 + BYOK/自托管后端 + 隐私提示 + 分层门禁 | 两个 spike（浏览器 CORS、RN 端侧运行时） | ✅ **已实现**（`packages/ai/src`：`provider` / `routing` / `egress` / `presets` / `supply` / `health-store`） |
| **AI-1 捕获** | 一句话 → 结构化任务字段（`chrono-node` 打底，AI 只兜长尾） | AI-0 | ✅ **已实现**（功能 id `capture`；入口 `apps/web/src/features/ai/AiCapture.tsx`，发送前逐步披露） |
| **AI-2 结构化** | 拆解任务（先落 `note` checklist）、逐条象限/优先级建议 | AI-0 | ✅ **已实现**（功能 id `breakdown` / `prioritize`；入口 `AiBreakdown.tsx` / `AiPrioritize.tsx`） |
| **AI-3 规划** | 今日计划、时间块、AI 排程 | AI-1/AI-2 的真实使用数据 | ⏸ **未实现**（`packages/ai` 与 `apps/web/src/features/ai` 里没有排程功能 id） |
| **AI-4 复盘** | 周报、习惯趋势叙述 | AI-0 + 端侧推理（受限分支） | ⏸ **未实现**（成长页的周复盘信是**派生纯函数**，不由 AI 生成） |
| **AI-5 接口 / 数据主权** | 全量导出、本地 API、MCP server | **无**（与 AI-0 解耦，可并行） | 🟡 **部分实现**：本地 API / MCP ✅（`packages/local-api`，6 个工具：`list_tasks` / `get_task` / `list_projects` / `create_task` / `update_task` / `complete_task`）；**全量导出 ❌ 未实现**（没有任何用户可见的导出入口） |

> 表里没有列到的第 5 个已上线功能是 **`duration-estimate`（时长估算）** ——
> 入口 `apps/web/src/features/ai/AiDuration.tsx`。它是后来加的，原表的三条分支设想里没有它。
> 功能 id 的完整集合以 `packages/app-host/tests/ai-*.spec.ts` 里那四个
> （`capture` / `breakdown` / `prioritize` / `duration-estimate`）为准。

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

**已落地的增量**：活动分类与分类着色 ——
按清单／习惯的颜色把**时间**分块可视化（成长视图里的分类泳道图 + 周堆叠条），
入口是清单与习惯编辑处的色槽取色器（1–8，**调色板由我们给、含义由用户赋**）。
🔴 核心裁决：**颜色由用户自己赋义，App 永不判断某个活动"健康／不健康"、也永不自动上色**
（那只会在"戒不掉"的活动上制造内疚，而内疚的预测是"不记录了"而不是"改了"）。
真正的工程量确实在**时间归因**：口径只有一份（在 `packages/domain`），
颜色是最后 10%，**零新增字段、零 schema bump、零新 op 类型**就跑通了。

| 层 | 内容 | 状态 |
|---|---|---|
| `packages/domain` | `computeCategoryReport` + `durationParts`（派生纯函数：专注→任务→清单，习惯按分钟） | ✅ **已实现** |
| `packages/design-system` | `color.category-1..8`（亮/暗）+ 色盲与对比度**实算** + `CATEGORY_SLOT_TOKENS` 包根导出 | ✅ **已实现** |
| `packages/app-host` | `setProjectColor` / `setHabitColor`（存**槽位号**、清除写 `null`）+ `categoryReportFromState`（摊平 + 注入 `now`，两端共用） | ✅ **已实现** |
| `apps/web` | 分类泳道图 + 周堆叠条 + 取色器（清单与习惯两处入口） | ✅ **已实现** |
| `apps/mobile` | 「分类」tab：泳道 + 行内色槽取色器（**不做**堆叠柱状图、**不做**习惯打卡） | ✅ **已实现**（12 条纯逻辑测试；本包无组件渲染测试台，见 §8.7 末段） |
| 真浏览器契约 | `e2e/tests/categories.spec.ts` 4 条（赋色**刷新后仍在**、真实专注进「未归类」、反需求扫描） | ✅ **已实现**（逐条注入验证会红） |

⚠️ 落地状态与实测数字见
[活动分类与分类着色](activity-categories-and-colors.md) §8
（§8.6 真浏览器通道**已恢复**；§8.6 与 §8.7 里各有一段"仍然没有被覆盖的东西"，
是留给下一个人的话，不是可以默认忽略的细节）。

🔴 两条**结构约束**（不是偏好，已进 ADR）：

- **不发行任何货币** —— 没有金币 / 积分 / 商店，也不卖"后悔"（竞品的付费冻结与
  付费修复**明确否决**）。因此「冻结余额」**不上界面**、也**不加持久化字段** ——
  [ADR-0022](../adr/0022-resilience-state-stays-derived.md)。
- **只与自己的过去比** —— 排行榜 / 联赛 / 自习室 / 组队打 Boss **结构上不可能**：
  它们需要可信的跨用户聚合，而 E2EE 下服务端看不到明文，本地优先下也没有可信的汇总方。

✅ 状态：**已并入 `main`**（merge commit `84cc7f5`，2026-09-27，75 文件 / +11008 行）。
当初挡在前面的两件事都已消失：主检出的未提交改动由各自的所有者提交并推送，
`main` 的 build / typecheck / test 现在全绿。分支 `feat/motivation-system` 与
worktree `.worktrees/motivation` **已删除**（相关提交仍是 `main` 的祖先，随时可达）。

### P0 完成证据（2026-09-25）

| 交付判据 | 证据 |
|---|---|
| 工程骨架 | pnpm monorepo：`packages/sync-core`、`packages/shared-schema`、`packages/storage`、`server` |
| 实体模型 | 13 个实体（P0 当日；**现为 15 个**，后加 `AI_FEEDBACK` / `PREFERENCE_CORRECTION`），含 heyta 特有的 `HABIT` / `HABIT_LOG` / `FOCUS_SESSION` |
| Docker 跑通 | 镜像 `supersync:local` 构建成功；31 个迁移在容器内应用（当日数；**现为 33 个**）；容器 healthy |
| 真实同步闭环 | `pnpm verify:sync` 退出码 0：A 加密上传 → B 可见 → 载荷仍为密文 → 并发判 `CONFLICT_CONCURRENT` |
| 回归 | `pnpm -r build/typecheck/test` 全绿，1444 个测试通过（当日数；**当前 16 个工作区项目 4652 passed / 13 skipped**，见根 `README.md`） |
| 许可证 | 315 个依赖全部宽松许可，逐项登记；门禁工具经"注入假 AGPL 包"验证过**能失败** |

复现步骤见 [`docs/runbooks/local-server-verification.md`](../runbooks/local-server-verification.md)。

> **为什么 P0 不碰 UI**：`docs/reference/architecture.md` 的分层原则——核心不对，后面全是重构。
> P0 的成功标志是**协议通了**，不是界面好看。

---

## 2. 第一阶段（P0）任务分解

> 📜 **本节是历史记录**：P0 已于 2026-09-25 完成（证据见 §1）。它保留下来是因为
> §2.3 的实体清单决策、§2.5 的迁移纪律和 §2.6 的验收口径**至今仍是现役约束**，
> 而 §2.1/§2.2/§2.4 描述的是"当时怎么做成的"，**不要照它重新开工**。
> 现在的活在哪：见 §5 与 [`phase-2-multi-platform.md`](phase-2-multi-platform.md)。

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
| `NOTE` | 沿用 | ✅ | **已补齐**（早期是 ❌，见下） |
| `AI_FEEDBACK` `PREFERENCE_CORRECTION` | **新增** | ✅ | 后加的（AI 反馈、ADR-0014 的偏好纠正） |
| `TASK_REPEAT_CFG` | 沿用 | ❌ **决定不用** | 重复规则放在 `Task.repeatRule` / `Task.repeatDtstart` 上（`packages/domain/src/entities.ts`）；登记理由里明写**「本条不是"还没做"，是"决定不用"」** |
| `REMINDER` | 沿用 | ❌ **仍未做** | 通知调度与产品决策未定（P3）；登记在 `UNMODELED_ENTITY_TYPES` |
| ~~`WORK_CONTEXT`~~ `TIME_TRACKING` `ISSUE_PROVIDER` `PLUGIN_*` `MENU_TREE` | **删除** | — | 不需要 |

⚠️ **改一处要同步改三处**：`shared-schema` 与服务端 `validation.service.ts` 都依赖这份清单，
服务端**会拒绝未知实体类型**；再加上 `packages/domain/src/entities.ts` 的
`MODELED_ENTITY_TYPES`（它与 `EntityModelMap` 之间有**编译期断言**，漏一个 `typecheck` 就红）。

🔴 **早期上表里那三个 ❌ 是实测确认的静默丢数据**，不是"还没做"那么轻描淡写：
它们是**合法实体**（`isEntityType()` 为 true），`dispatch` **不报错**，op 照常入队、
上传、同步到所有设备 —— 但**没有任何设备会物化它们**。用户建一条重复任务，
它同步得到处都是，哪儿也不显示，且任何一层都不报错。

⚠️ **这三条后来走了不同的路，不要再当成一类**（这是本文档自身漂移过的地方）：

| 实体 | 现在的真实状态 |
|---|---|
| `NOTE` | **已补齐**，进了 `MODELED_ENTITY_TYPES` |
| `TASK_REPEAT_CFG` | **从"语义未定"变成了决定**：重复规则放在 `Task.repeatRule` 上 —— 因为「一个用户意图必须是一个 op」，而本引擎的 reducer 不处理跨实体类型的 op |
| `REMINDER` | **确实还没做**（P3 通知调度），是上表唯一一个"仍未实现"的 ❌ |

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
| ~~**服务端从未真实运行过**~~ → **已消除** | 未知的部署问题 | P0 已在 Docker 上跑通（镜像构建 + 31 个迁移 + 容器 healthy + `pnpm verify:sync` 退出码 0），生产拓扑见 [`docs/runbooks/deployment.md`](../runbooks/deployment.md)。**保留下来的教训**：部署问题只会在真环境里出现，所以每次都说清"实测 / 引用 / 未核实" |
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

**当前状态**：两种模式都**已实测通过** —— `--dry-run` 不需要服务器；实时模式见上面 §1 的 P0
证据（`pnpm verify:sync` 退出码 0，A 加密上传 → B 可见 → 载荷仍为密文 → 并发判 `CONFLICT_CONCURRENT`）。
工具本身保留，作为协议层的回归入口（另见 `pnpm verify:sync-recovery`）。

---

## 5. 下一步动作（按"用户在哪一步走不下去"排序）

> ⚠️ 本节原先列的是 P0 的 6 步 —— **它们已全部完成**。现在的瓶颈不在工程侧的内部一致性，
> 而在**用户旅程的断点**上：仓库的门禁已经多到足以证明"代码是对的"，
> 但**没有任何一道门禁能发现"用户根本没有入口"**。
> 下面按用户实际会撞到的顺序排，每条都带可复现证据。

### 5.1 🔴 第一段：新用户到不了产品（完全在我们这边，不依赖任何外部资质）

| # | 断点 | 证据 |
|---|---|---|
| 1 | 落地页**没有任何指向应用的链接** | `apps/landing/src` 里除语言切换外，**每一条 `href` 都是页内锚点**（`#pricing` / `#showcase` / `#selfhost` …）—— 落地页**到不了产品** |
| 2 | Web 端**没有注册 / 登录界面** | `apps/web/src` **没有 auth 目录**；服务端已有 passkey / magic-link（`server/src/api.ts`），客户端只有 `SyncBar.tsx` 的三个手填框（服务器地址 + 令牌） |
| 3 | 定价 CTA **不是按钮** | `apps/landing/src/components/Pricing.tsx` 是 `<p>` + 沙漏 +「即将开放」。**这是有意为之**（理由写在文件头：不愿造一个"点了没反应的立即购买"），但净结果仍是"想付钱的人无处可点" |

**这一段是当前最该做的**：它挡住的是**所有**新用户的入口，而且**没有任何外部依赖**。

### 5.1.1 🔴 界面在说谎：承诺了「导出」，但没有导出功能

托管同步到期/被拒的提示 —— 也就是用户**最担心"我会不会丢数据"的那一刻** —— 在**两种语言**里都写着：

> zh：这台设备上的全部数据仍然可以正常查看、编辑和**导出**，不需要续费。
> en：Everything on this device can still be viewed, edited and **exported** — no renewal needed.
> —— `web.subscription.notice.localData`（`packages/i18n/src/locales/zh-CN.ts:997` / `en.ts:936`）

**但全仓没有任何用户可见的导出入口。** `apps/web/src` 下搜不到导出功能，
设置页也没有这一项。同时 `README.md` 的项目原则第 5 条写着
**「导出自由：任何时刻都能一键带走全部数据」** —— 两条承诺**都没有兑现**。

这正是 `scripts/check-ai-coverage.mjs` 文件头点名的那类失效 —— **「功能是空的，界面在说谎」**，
而且是最坏的一类：**类型系统不会报**（词条 key 合法）、**单测不会报**（没有东西可测）、
`check:ui-language` 也全绿（两种语言都真的翻了）。它**不在 AI 轨里**，所以没有任何门禁会红。

> **最小修法二选一**：要么**补上导出**（本地优先架构下，本质是把 op-log + 物化状态导成 JSON，
> 让用户在无服务端时也能带走数据），要么**把这句删掉**。
> 不要两边都不动 —— 那是在"数据主权"这件产品原则上说了不实的话。

### 5.2 第二段：付费的"交付"半段（详见 [pricing-coupons-handoff.md](pricing-coupons-handoff.md) §11.1 的 11 段表）

| # | 断点 | 状态 |
|---|---|---|
| ④⑤ | 收银台 | ✅ **服务端已通**：`POST /api/billing/checkout`（报价 → 冻结 → `createCheckout` 一条链，不可交付的档在报价前回 `409`，12 例真 SQL 测试）。❌ **客户端「付款」按钮仍缺**，且**应当与支付通道一起落地** —— 现在加必然回 `503 BILLING_PROVIDER_NOT_CONFIGURED`，正好造出落地页明确反对的那个东西。所以这一步卡在**外部资质**，不在我们这边 |
| 交付半段 | 🔴 **完全在我们这边** | webhook 路径还没把"金额与所有 SKU 都对不上"的支付交给 `settleOrderPaid` —— 该函数**至今零生产调用方**（`server/src/billing/pricing-store.ts:893` 导出，全仓无调用点，只有注释引用它）。后果：**用了券的单收得上钱、授不出权益** |
| ⑦⑧ | ¥12 档能不能交付 | 已由 [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) 显式判定：**计量存在之前不得被售卖**。云端 AI 端点 / 计量 / 设置页的「本周期已用 X / 300 次」**仍未做** |
| ⑨⑪ | 续费 / 退款 | 都不存在：`SubscriptionNotice.tsx` 自述"现在不存在可跳转的续费地址"；退款接口"通道尚未接线"，退款政策也未定 |
| 海外 | $5 / $12 | **没有 USD 通道**（全仓只有微信 adapter，且币种硬编码 CNY），并且缺**币种断言** —— USD 单喂给它会被按 CNY 发出去（`amountMinor: 500` 被当成 500 分），**没有任何一层会报错** |

### 5.3 第三段：剩下的工程（按轨道）

| 轨道 | 下一步 |
|---|---|
| **P2 多端** | 鸿蒙**仍未跑起来**：构建链已实测打通（20 MB release HAP、双 ABI），但缺**模拟器系统镜像 + 签名**（产物 unsigned）→ [phase-2-multi-platform.md](phase-2-multi-platform.md) |
| **AI 线** | AI-0 / AI-1 / AI-2 / 本地 API（MCP）✅ 已上线；**AI-3 规划、AI-4 复盘未实现**；**全量导出未实现** |
| **运营面** | 改价目前等于**服务器 shell 权限**（唯一入口是 `server/scripts/pricing.ts` CLI，无鉴权 / 无角色 / 无 HTTP 面，`--actor` 可伪造）。**在有意引入 admin 路由之前，这条缺口应当保持显式**，而不是被"内网就安全"盖住 |
| **P3** | 小组件 / 通知 / CalDAV —— 未开工。可行性见 [native-widgets.md](../research/native-widgets.md)，**改造计划见 [multi-platform-widgets.md](multi-platform-widgets.md)**：小组件是**多端适配的输出形态**（不是后续阶段），且 **Windows（PWA provider）与 macOS（Continuity）反而不需要新建壳** |

---

*组件版本与活跃度均为 2026-09-25 实测。引入任何新依赖前必须重跑可维护性与许可证核实。*
