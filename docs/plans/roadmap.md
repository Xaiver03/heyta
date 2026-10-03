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
| **AI-1 捕获** | 一句话 → 结构化任务字段。⚠️ **两条路，都不是 `chrono-node`**：① **规则式**（自研正则，`packages/domain/src/capture.ts` 的 `parseCapture`，字段只有 `dueDate` + `priority`）；② **AI 捕获**（`packages/app-host/src/ai-capture.ts`，字段 `title` / `dueDate` / `priority`，解析失败时如实告知而不是静默丢字段）。AI 只兜长尾 | AI-0 | ✅ **已实现**（功能 id `capture`；入口 `apps/web/src/features/ai/AiCapture.tsx`，发送前逐步披露）。🔴 **本条此前写的是「`chrono-node` 打底」—— 那是错的**：全仓没有这个依赖（`packages/domain/package.json` 只有 `shared-schema` + `ical.js`），从未有过。NLP 的真实缺口见 [site-and-parity-alignment.md](site-and-parity-alignment.md) B2-6 |
| **AI-2 结构化** | 拆解任务（先落 `note` checklist）、逐条象限/优先级建议 | AI-0 | ✅ **已实现**（功能 id `breakdown` / `prioritize`；入口 `AiBreakdown.tsx` / `AiPrioritize.tsx`） |
| **AI-3 规划** | 今日计划、时间块、AI 排程 | AI-1/AI-2 的真实使用数据 | ⏸ **未实现**（`packages/ai` 与 `apps/web/src/features/ai` 里没有排程功能 id） |
| **AI-4 复盘** | 周报、习惯趋势叙述 | AI-0 + 端侧推理（受限分支） | ⏸ **未实现**（成长页的周复盘信是**派生纯函数**，不由 AI 生成） |
| **AI-5 接口 / 数据主权** | 全量导出、本地 API、MCP server | **无**（与 AI-0 解耦，可并行） | ✅ **已实现**：本地 API / MCP ✅（`packages/local-api`，6 个工具：`list_tasks` / `get_task` / `list_projects` / `create_task` / `update_task` / `complete_task`）；**全量导出 ✅**（2026-09-27 落地，三端都有入口，见 §5.1.1）。🔴 **本条此前写的是"全量导出 ❌ 未实现（没有任何用户可见的导出入口）"—— 那是错的**，而且它与本文件 §5.3 的同一句话**自相矛盾**（那边早就改成了"已实现"）。同一份进度表里两处说法相反，读到哪一处就得到哪个结论 |

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

> 🔴 **2026-09-29 口径收敛：本节的「下一步」已由
> [`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) 全权接管。**
> 该文件是当前唯一的权威主计划，「下一步动作」只在它 §11 维护；
> **本节不再复述、也不再作为待办入口**。计划层的完整索引见 [`README.md`](README.md)。
>
> ⚠️ **下面 §5.1–§5.4 保留的是 2026-09-27 / 09-28 的断点关闭账** ——
> 它们是带日期与实测证据的**历史记录**，**不是待办清单**。
> 判断"现在该做什么"只看主计划 §11。

### 5.1 ✅ 第一段：新用户到不了产品 —— **2026-09-27 已打通**

| # | 断点 | 状态 |
|---|---|---|
| 1 | 落地页**没有任何指向应用的链接** | ✅ **已修**。入口由构建期 `VITE_APP_URL` 决定（判据 `apps/landing/src/lib/app-url.ts`）；**未配置时整条入口根本不渲染** —— 仓库默认构建就是未配置，那是故意的（应用没部署却露出「立即使用」比没有入口更坏）。`render.spec.tsx` 把两种状态各钉了一条用例 |
| 2 | Web 端**没有注册 / 登录界面** | ✅ **已修**。服务端一直有完整的 passkey / magic-link（11 条 `/api/*` 路由），**却没有任何客户端调用**；唯一入口是同步设置里三个手填框。现在协议语义收在 `packages/app-host/src/hosted-auth.ts`，`AuthPanel` 开在**同步设置内部**（认证要用的服务端地址就是那里的地址，分开会出现"对着 A 登录、令牌存到 B"） |
| 3 | **应用本体从来没被部署过** | ✅ **已修**。`https://heyta.finlaw.cloud/app/`；与同步服务端**同源** ⇒ `CORS_ORIGINS` / `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` 都指向它，passkey 才能用。发布方式见 [deployment.md §3.7](../runbooks/deployment.md) |
| 4 | 定价 CTA **不是按钮** | ⚪ **维持原状，且是有意的** —— 理由写在 `Pricing.tsx` 文件头：不愿造一个"点了没反应的立即购买"。免费档的 CTA 是**自建**，那条仍然成立、也仍然可点 |

**这一段闭环了。原先在这里的两条保留都已在 2026-09-27 关掉：**

- ✅ **入口挂在临时域名上** —— 已修。测试域名固定为 `heyta.finlaw.cloud`
  （落地页 `/` + 应用 `/app/` + 同步 API `/api/` + 三张凭据页），
  `VITE_APP_URL` 也随之改成它。迁移动机、代价与验收见
  [deployment.md §3.7.1](../runbooks/deployment.md)。
  🔴 代价只有一条：tmp 域名上已注册的 **passkey 全部失效**，需重新注册 ——
  `WEBAUTHN_RP_ID` 只能取一个值，而两个域名没有公共可注册域，无法两边兼容。
- ✅ **英文落地页 → 中文应用** —— 已修。落地页给外链带 `?lang=en`
  （`apps/landing/src/lib/app-url.ts`），应用在**没有已存偏好**时采纳它
  （`apps/web/src/lib/locale.ts`）。顺序是「已存偏好 > URL 参数」，不能反 ——
  参数会留在地址栏里，反了就会让一个陈旧参数覆盖用户在应用里的明确选择。

### 5.1.1 ✅ 界面不再说谎：「导出自由」已兑现 —— **2026-09-27 落地**

**原来的状态**（值得留下，因为它是这个仓库最危险的一类失效）：订阅到期提示 —— 也就是用户
最担心"我会不会丢数据"的那一刻 —— 在**两种语言**里都写着本地数据「可以查看、编辑和**导出**」，
`README.md` 的设计原则第 5 条写着「导出自由：任何时刻都能一键带走全部数据」，
**而全仓没有任何用户可见的导出入口。**

它躲过了所有门禁：类型系统不报（词条 key 合法）、单测不报（没有东西可测）、
`check:ui-language` 也全绿（两种语言都真的翻了）。**没有任何一道门禁能发现"功能是空的"。**

**现状**：`packages/app-host/src/export-dump.ts` 定导出的**内容形状**（产品语义，所以不在
`apps/*`），产出一份含**墓碑**与**完整 op-log**的文档，外加可核对的 `counts`
（每类实体 total/deleted、op 总数）—— 让"导全了"能被**验证**而不是靠信。
Web 设置页有「导出数据」（JSON 完整保真 / 任务清单 Markdown），node-host 有 `export --out`。

**墓碑为什么不能丢**：op-log 用 `deletedAt` 表示删除，丢掉墓碑的"备份"回放时已删数据会**复活**。
只有给人看的那份 Markdown 才过滤墓碑 —— 这个反差有单独用例钉住。

**覆盖率要如实说**（三端逐条核过，不是照抄）：

| 通道 | 导出 | 导入（只支持还原到空库） |
|---|---|---|
| Web 设置页 | ✅ `ExportPanel` | ✅ `ImportPanel` |
| node-host CLI | ✅ `export --out` | ✅ `import` |
| 移动端 | ✅ 「我的 → 导出数据」（系统分享面板） | ✅ 「导出数据」页的「从备份还原」卡（**2026-10-03 goal 批五**）：选文件或粘贴两条路 → `parseExportDocument` 预检展示 counts → `restoreIntoEmptyTarget`；判据 `scripts/verify-mobile-restore.sh` 真模拟器 + 真服务端零 mock |

`README.md` 第 5 条已按同一张表补上范围说明，避免又把"部分为真"读成"全部为真"。

⚠️ **本节此前写的是"移动端还没有[导出入口]"与"还**没有导入**"—— 两句都过期了**：
移动端在 2026-09-28 加了「我的 → 导出数据」；导入则在 Web 与 CLI 都有了。
**导出的那一套是三端齐全的，导入的那一套缺移动端** —— 两件事的覆盖率不同，
所以它们必须分开写，不能合成一句"支持导出导入"。
⚠️ **上面那句"导入的那一套缺移动端"也在 2026-10-03（goal 批五）过期**：移动端现在有「从备份还原」
卡，与 Web 同一条"只还原到空库"口径。保留原句是为了让人看清**覆盖率这类结论的保质期取决于别人
什么时候补上它** —— 分开写仍然对，只是两件事现在都变成三端。

**另一条诚实条款**：拿到的文件**不是还原点**（它是导出，不是备份快照）。
~~在**没有导入入口的那一端**（移动端）尤其要说清楚：那里的界面与解释文案仍然写着"这不能导回来"~~
⚠️ **这条在 2026-10-03（goal 批五）被换掉了，不是被实现了旧句子**：移动端现在能导回来，
界面上写的诚实条款换成新的那一条 —— **还原回来的数据只在这台设备上**（备份里的 op 带的是
来源设备的 `clientId`，服务端 `validateOp` 逐条回 `INVALID_CLIENT_ID` ⇒ 设计上就不上行）。
判据脚本会钉住界面里这句"只在这台设备上"，改回旧文案就红。

### 5.2 第二段：付费的"交付"半段（详见 [pricing-coupons-handoff.md](pricing-coupons-handoff.md) §11.1 的 11 段表）

| # | 断点 | 状态 |
|---|---|---|
| ④⑤ | 收银台 | ✅ **服务端已通**：`POST /api/billing/checkout`（报价 → 冻结 → `createCheckout` 一条链，不可交付的档在报价前回 `409`，12 例真 SQL 测试）。❌ **客户端「付款」按钮仍缺**，且**应当与支付通道一起落地** —— 现在加必然回 `503 BILLING_PROVIDER_NOT_CONFIGURED`，正好造出落地页明确反对的那个东西。所以这一步卡在**外部资质**，不在我们这边 |
| 交付半段 | ✅ **已修（2026-09-27）** | webhook 现在在**同一个事务**里：占位 `paymentEvent`（唯一约束=幂等闸）→ `settleOrderPaidInTransaction`（比**订单冻结的** `final_amount_minor`、`pending→paid`、券 `reserved→applied`）→ 用**订单冻结的 `price_id`** 覆盖 adapter 的金额启发式 → `applyPaymentEvent` → 标记 `processedAt`。`unknown-order` 回落 legacy 声明；`already-paid` 不重复授予。<br>**退款/拒付侧：有意不接**（ADR-0026 已接受 —— `reverseOrderOnRefund` 零调用方、退款事件在 `unsupported-event-type` 被拒，两条都是显式决定，不是遗漏；理由是只接订单侧会造成"账本说退款了、权益还在"的半真状态）；**存量回填**✅ **已做（2026-09-27）**（接线前已付款但未结算的订单，重投会被幂等挡住，现在由对账补结算）—— 见下方"存量回填"条目 |
| ⑦⑧ | ¥12 档能不能交付 | 已由 [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) 显式判定：**计量存在之前不得被售卖**。云端 AI 端点 / 计量 / 设置页的「本周期已用 X / 300 次」**仍未做** |
| ⑨⑪ | 续费 / 退款 | 都不存在：`SubscriptionNotice.tsx` 自述"现在不存在可跳转的续费地址"；退款接口"通道尚未接线"，退款政策也未定 |
| 海外 | $5 / $12 | **没有 USD 通道**（全仓只有微信 adapter，且币种硬编码 CNY），并且缺**币种断言** —— USD 单喂给它会被按 CNY 发出去（`amountMinor: 500` 被当成 500 分），**没有任何一层会报错** |

### 5.3 第三段：剩下的工程（按轨道）

> 🔴 **本节的原「按轨道下一步」口径已于 2026-09-29 收敛** ——
> 它部分已过期（例如"P2 多端"轨道仍在指向已被收敛的
> [`phase-2-multi-platform.md`](phase-2-multi-platform.md)）。
> **当前下一步只在 [`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) §11 维护，本节不复述。**
> 被替代的表格见本文件的 git 历史；各轨道的当前状态见 [`README.md`](README.md) 索引。
>
> 📌 **平台清单（与站点 `/platforms` 的六个条目对应）**：Web · Android · iOS ·
> 桌面（macOS / Windows / Linux） · **鸿蒙（HarmonyOS）** · 自建服务器。
> 每一端的**当前状态**由 [`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) §11 维护；
> 这一行存在的理由是 `check:claims` 的 C2 判据 —— **站点上讲了某个平台，
> 路线图里就必须找得到它**（否则站点等于在讲一个路线图上不存在的平台）。
> ⚠️ 收敛掉那张表时漏了这一句，`pnpm check:claims` 因此变红（2026-09-29 修）。

### 5.4 本轮同时关闭的其它断点（2026-09-27）

| # | 断点 | 状态 |
|---|---|---|
| 5 | **删了就没有回头路**：`DELETE` reducer 只是打墓碑，数据一直在库里，但**没有任何界面能看到或恢复它** | ✅ **已修**。Web 多了「回收站」视图。还原 = `UPD { deletedAt: null }`；彻底删除 = 打 `purgedAt` **标记**而**不清除 `deletedAt`** —— 清掉它会让离线对端把已删数据**复活**。代码与界面都写明：这**不是**物理擦除 op-log 历史。<br>✅ **移动端也有了**（「我的 → 回收站」二级页，底部仍是 5 个标签，能力全部复用 `packages/app-host`）。<br>📌 **已在 iOS 模拟器上端到端实跑**：删 2 条 → 列出 → 「彻底删除」弹确认框 → **取消后没有写任何 op**（DB 验证）→ 确认后写入 `UPD {"purgedAt":…}`，且**同一条任务的 `DEL` 墓碑仍在**。<br>**未做**：只有 TASK，不含 PROJECT / TAG |
| 6 | **移动端没有激励与成长体系**：`mobile.motivation.*` 词条 0 条，streak / 里程碑只有 Web 能看 | ✅ **已修**。共享取数收进 `packages/app-host/src/motivation.ts` —— "摊平 + 滤墓碑 + 注入 now"是每个宿主都必须做得一模一样的事，其中 `bestCurrentStreak` 取 `current` 还是 `longest` 是**真的会漂移**的业务选择（取错会让一个两年前连续 300 天的习惯拿到身份标签）。移动端「我的 → 成长」是**第二层页面，底部仍是 5 个标签**。<br>📌 **已在 iOS 模拟器上实跑并截图**（浅色 + 深色两版）：布局无溢出、深色对比正常；**深色是真的切了**（`simctl ui appearance dark`），不是"以为切了"。<br>⚠️ **仍未经真机屏幕验证的一条**：**超长习惯名**的换行 —— 手机上当时没有习惯数据（移动端没有建习惯入口），只证到代码层（`numberOfLines={1}`） |
| 7 | **服务端汇入页仍打着上游的品牌**：`server/src/pages.ts` 与 `server/templates/index.template.html` 里是 "SuperSync" / "Super Productivity" | ✅ **代码已改并已部署**（2026-09-27）。此前生产上跑的是 **2026-09-26 构建的镜像**，实测仍有 3 次 "Super Productivity" + 3 次 "SuperSync"。<br>🔴 **这个过程挖出三个"镜像其实早就构建不出来 / 一直卡住"的真问题**，都不是品牌改动本身：① Alpine 源 `dl-cdn.alpinelinux.org` 连不上而 `apk add` 不设超时 → **无声挂满 40 分钟**；② `registry.npmjs.org` 取包超时 → 整层作废且**失败层不进缓存**；③ **镜像里根本没有 `packages/domain`**，而 `server/src/billing/*` 真的 import 它 → `TS2307`。③ 尤其危险：它是**潜伏**的，本地 `pnpm -r build` 永远是绿的。<br>修法见 `server/Dockerfile`（两个 mirror 构建参数 + 补 domain）与 `docs/runbooks/deployment.md` §3.8、`AGENTS.md` §7 第 71 条 |

**本轮校验过、但仍然存在的诚实缺口**（不属于"断点"，但读的人需要知道）：

- ✅ **注册/登录的邮件现在真的发得出去，而且实测真的投递到了**（2026-09-27 关闭，**不再是外部阻塞**）。
  走腾讯云 SES + 发件域名 `finlaw.cloud`（**该域名本来就已在 SES 里验证通过**，四项 DNS 记录全 true，
  所以没有新建发件域名；新增的是该域名下的专用发件地址 `noreply@finlaw.cloud`）。
  端到端验收用一次性外部邮箱（Guerrilla Mail，有读取 API）走完整旅程：
  `POST /api/register/magic-link` → **邮件真到达**（`From: noreply@finlaw.cloud`、
  `Subject: Verify your heyta account`、正文 `Welcome to heyta!`）→ `POST /api/verify-email` 通过 →
  `POST /api/login/magic-link` → 第二封真到达 → 真 JWT（221 字符）→ `GET /api/sync/status` **200**。
  服务端日志佐证：`SMTP configured: gz-smtp.qcloudmail.com:465` /
  `Verification email sent` / `Magic link login email sent`。详见 `docs/runbooks/deployment.md` §3.9。
  ⚠️ 往 **`@finlaw.cloud` 自己**发信会失败（收件方 `mail.finlaw.cloud` → `121.4.24.238:25`
  对 SES 超时，`DeliverStatus: 3`）—— 那是**收件侧**的独立故障，往外部域正常。
  排查时看 `DeliverStatus` 而不是 `SendStatus`（见 `AGENTS.md` §7 第 81 条）。
- 🔴 **伴随这次接线挖出的品牌漂移**：改名只改了页面、**整个 `email.ts` 漏了**。
  用户点邮件链接会落到说 heyta 的页面，而那封邮件写着 `Verify your SuperSync account` ——
  同一趟流程两种品牌，看起来像钓鱼。已修（`config.ts` 的 `PRODUCT_NAME` / `DEFAULT_SMTP_FROM`
  收成各一份，7 处字面量归一），并有 7 条能失败的单测 + 变异验证。
  **这个漂移此前没人看见，是因为生产从来没配 SMTP —— 发不出去的邮件没人读。**
- ✅ **认证现在有真实服务端证据了**（不再是"只有契约级"）：`verify-email` →
  `login/magic-link/verify` → 真 JWT → 面板粘贴登录成功 → 应用真的打了
  `POST /api/sync/ops`（**200**），`server_seq` 从 0 推进到 1，真库里留下 1 条 op，**0 console.error**。
  上一版记的"唯一没验的就是**邮件投递本身**"**已关闭**（见上）。

- ✅ **浏览器端通行密钥那一步已接线**（`apps/web/src/features/auth/passkey-browser.ts`）。
  `@heyta/app-host` 只到"取 options / 交 credential"，中间 `navigator.credentials` 那一步按设计留在宿主里；
  缺的就是这一步，所以在此之前面板只有登录链接一条路。现在注册与登录两条都通了。
  **两道验收**：(a) 单测 45 条（转换层逐字段钉字节 + store 接线 + 失败不被当成成功）；
  (b) **真浏览器 + 虚拟认证器** 13/13 —— 其中一条是**反证**：把服务端的 JSON 原样丢给
  `navigator.credentials.create()` 会被 Chromium 以 `TypeError` 拒掉，证明转换层不是多余的；
  再把产出的 `clientDataJSON` 解出来，`challenge` 必须**原样回显**（长度对但内容错也会被抓），
  可发现凭据路径解出的 `userHandle` 是注册时的 `user.id`。
  ✅ **找回通行密钥的入口已补**（2026-09-27）：面板上新增"丢失了通行密钥？发一封找回链接"
  （`store.ts` 的 `requestRecovery` → app-host 的 `requestPasskeyRecovery` → `POST /api/recover/passkey`）。
  🔴 **同时纠正一条上一版记错的结论**：这里曾写"`/api/passkey/recover/*` 三个端点在 app-host 有函数、
  **没有界面**"，读起来像整条流程都缺。实际上**恢复本身早就有** —— 是服务端渲染的
  `/recover-passkey` 页面 + `recover-passkey.js` ——
  那一步必须在真实浏览器里调 `navigator.credentials.create()`，本来就不该在 SPA 里。
  **缺的只是"触发那封邮件"这一步。** 当初只在 `apps/web` 里搜，所以搜漏了。
  验收：9 条单测（含"成功是中性响应、不是邮箱存在的证据"与"失败绝不说成成功"）+ 变异验证
  （把按钮 `onClick` 换空操作 → 转红）。
- 🔴 **同一段旧记载里还有第二个、更严重的错误**：它写"线上实测 `/recover-passkey` 页面 + `.js` **两者都 200**"，
  并把它当作"恢复这条路是通的"的证据。**200 是真的，但它返回的是落地页 HTML。**
  nginx 只代理了三张页面的**路径**，没代理页面引用的**脚本**，
  于是 `/*.js` 掉进 `location /` 的 SPA 兜底 → `/var/www/heyta-landing/index.html`。
  浏览器报 `Unexpected token '<'`、`SimpleWebAuthnBrowser` 是 `undefined`，
  点「Register New Passkey」**一点反应都没有、零请求**。

  **后果不是"少个功能"**：丢了通行密钥的用户**收到邮件 → 点开链接 → 按钮不动 → 进不去**；
  同一条缺陷也打死了**魔法登录链接**（`/magic-login-confirm.js` 同样被吞）——
  也就是**主要的登录路径**。而它躲过了此前所有验收，因为
  **每一次都是只看状态码、没看响应体**。

  ✅ 已修（2026-09-27，nginx 加三个脚本的 `proxy_pass`；完整记录写在
  `docs/runbooks/deployment.md` §3.3.1）。修完后的真浏览器实测：
  `Content-Type: application/javascript`、`SimpleWebAuthnBrowser === "object"`、
  点按钮 → `200 /api/recover/passkey/options` + `200 /api/recover/passkey/complete`、
  页面出现成功文案；并且**清空虚拟认证器**（= 真的丢了通行密钥）后用恢复出的新凭据
  登录拿到真 JWT、`GET /api/sync/status` 200。

  ⚠️ 这句**已过期**（2026-10-03 逐字核过）：原文在这条里写着"配置在服务器上、**不在仓库里**"。
  现在这两份站点配置在 `server/deploy/nginx/`（`heyta.finlaw.cloud.conf` 与
  `heyta.waytofuture.cn.conf`，`git ls-files` 各 1 条），那三段 `location`
  就在跟踪的文件里（前者 144 行是页面路径、167 与 172 行是那三个脚本）。
  **当时的教训仍然成立，但"只能上机改"不再成立**
  —— 反向的坑变成了：仓库里的配置若不跑 `server/scripts/nginx-sync.sh --apply` 就不会生效。

  📌 **教训（已写进 `AGENTS.md` §7 与部署手册）**：对服务端渲染页面引用的每个资源，
  验收必须断言 **`Content-Type` 和内容开头**，不能只断言 `200`。
  这一类"200 但内容是别的页面"的谎，只看状态码的门禁**结构上抓不到**。
  ✅ **用户主动增删凭据已做**（2026-09-28，`af47fd4`）。原来这句写的是
  "没有 UI，也没有端点" —— 两句现在都不成立了：
  - **端点**：`GET /api/passkeys`（列表）与 `DELETE /api/passkeys/:id`；
  - **服务层**：`listUserPasskeys` / `deleteUserPasskey`（`server/src/passkey.ts`）；
  - **app-host**：`listPasskeys` / `deletePasskey` / `passkeyDeletePath`（语义只在这一层）；
  - **Web**：设置页账号安全区的 `PasskeyPanel`（两段式删除）；
  - **i18n**：中英各新增 23 条。

  **四条安全边界都有能失败的测试**：未认证 → 401（且断言 `deleteMany` 与 `$transaction`
  都**没被调用**）；删别人的 → **404**（`not.toBe(403)`），且响应体与"删一个根本不存在的 id"
  **逐字节相同**（这是"不泄露存在性"唯一能失败得起来的写法）；删最后一条 → **409** +
  `last_passkey_required` 且不是成功；列表响应体断言不含 `publicKey` / `credentialId`，
  且返回键集合就是 `createdAt / id / lastUsedAt`。

  🔴 **"删除最后一条"的守卫是原子的**（写在 `deleteMany` 的 `where` 里，而不是先查后删）——
  它是**唯一的 TOCTOU 防护**：没有它，两个标签页各自删一条会让账号**一条都不剩**。
  ⚠️ **这条守卫差一点就没有测试**：第一版"删最后一条"用例把 `deleteMany` 桩成 `count: 0`，
  只覆盖到分支、**没覆盖谓词**；实测把守卫整行删掉两个 spec **全绿**。
  补上"断言 `deleteMany` 实际收到的 `where`"之后才转红（补断言前删谓词 = 绿；
  补后 = `1 failed | 11 passed`；还原 = 22 passed）。旁证：删 `userId` 的变异**当时就是红的**，
  说明只有这一处是缺口。

  ⚠️ **没做改名**：`Passkey` 表没有 `name` 列，加一列要一次 DB 迁移 —— 本轮不做，
  **也没有**为此造一个假名字段（理由写在 `passkey.ts` 注释里）。

  ✅ **"已认证地再加一条凭据"这条通路已落地**（2026-09-28，`b04d3ef`）。它是 ADR-0029 §4
  那个**前提**：写下"先添加一条新的"的时候，唯一可用的 `registerPasskey` 对已验证账号是
  **静默空操作**（反枚举设计），照做的用户会删掉旧凭据后再也进不去。只有"删"没有"增"，
  那条 409 文案是**有害**的。
  - **端点**：`POST /api/passkeys/registration/{options,complete}`，均 `preHandler: authenticate`；
    body schema 只有 `credential`（zod 剥未知键 ⇒ 归属无法从请求体注入）；
  - **服务层**：`generateUserPasskeyOptions(userId)` / `completeUserPasskeyRegistration(userId, credential)`；
    challenge 用独立命名空间 `'user-registration'`，与公开注册**不能互相消费**；
    `excludeCredentials` 填当前用户已有的 credential id（与公开注册的 `[]` 相反）；
  - **app-host**：`beginPasskeyEnrollment` / `completePasskeyEnrollment`（+ 409 原因映射）；
  - **Web**：`PasskeyPanel` 的"添加一条通行密钥"——能力探测 → begin → create → complete →
    **重拉列表**；任一步失败绝不置成功；
  - **i18n**：中英各 +8 条（key 集合 1267/1267 对齐）。

  三个关键行为的**变异验证**（先红后绿，每次 `diff` 确认还原）：生产 `excludeCredentials`
  退回 `[]` → `1 failed`；`create` 的归属写死成别人 → `2 failed`；`create` 抛错改成返回成功
  → `1 failed`。

  🔴 **第一版 spec 有一个"同义反复"缺陷，值得记下来**：`generateRegistrationOptions` 的桩返回
  一个**写死的常量对象**，于是 `excludeCredentials` 那条断言检查的只是这个桩自己的返回值 ——
  生产把它整个删掉（退回 `[]`）也照样绿。改成**回显生产传入的参数**之后才成为真验收
  （变异 A 正是因此才转得红）。**断言桩的返回值 ≠ 断言生产的谓词。**

  ✅ **"陈旧凭据"与"验签失败"现在是两个可区分的错误**（同一提交）：服务端已不认得这条凭据
  → `code: 'passkey_not_found'`；认得但断言没验过 → `code: 'passkey_verification_failed'`。
  两者 `message` 刻意同样笼统，判别**只靠 `code`**；app-host 映射成两个 reason，
  两个壳各用**两句不同的话**渲染。测试断言两个 code **不同**，且都不是笼统的
  `'Authentication failed'`。
  📌 **泄露取舍**（写在 `/login/passkey/verify` 旁）：该端点未认证，`passkey_not_found` 确实是
  一个**以"已知 credential ID"为键的存在性预言机**；选择暴露的理由是 credential ID 本非秘密
  （每次登录明文出现在断言响应里）、32 字节随机不可枚举，且用户正是在**登录失败那一刻**
  需要这句判别。`SAFE_ERROR_MESSAGES` **没有**被放宽。
  📌 **没有为"拒绝删除最后一条凭据"这个新产品决定立 ADR** —— 目前只落在代码注释与测试里；
  它够格单独一份 ADR，但这是需要人来拍的取舍。
- **回收站的跨设备一致性没有被真正验证**：op 级证明用的是两个真引擎 + 两个真 SQLite，**没有**跑真实的两客户端服务端收敛。
- ✅ **导入 / 还原已做**（`packages/app-host/src/import-dump.ts`，**CLI / Web / 移动端三端都有入口**；移动端那一路是 2026-10-03 goal 批五落的「从备份还原」卡 —— 见 §5.1.1 那张三端表）：走**重放导出里的完整 op-log**，
  所以墓碑语义天然保持（已删数据不复活），并且**只支持还原到空库** —— 目标非空时在写任何东西**之前**就拒绝。
  **"合并到非空库"是被明确拒绝的**，不是排期问题：id 冲突、无共同因果历史（`compareVectorClocks` 只会给 `CONCURRENT`，
  每对都退化成 LWW + 随机 `clientId` 决胜）、"本地是否更新版本"三条判据都没有可信答案，三条路都会**静默丢数据**。
  若要开这个口子，需要一份独立 ADR。
- ⚠️ **`verify:mobile-ios` 的基线在本次改动之前就不是绿的**（3 项失败集中在"笔记本读不到 / 自动同步游标"）。
- ✅ **手机"收到 12 ops 但一条没落、游标停在 3"—— 已结案：复现了，而且它不是同步 bug**（2026-09-28，`4d0e12b`）。
  先说边界，免得读的人以为已经修好了：那行 `Download: 12 ops (sinceSeq=3, latestSeq=15, hasMore=false)`
  是**服务端**在 `reply.send` **之前**打的（`sync.routes.ts:193-197`），它只证明服务端发了一页，
  **不证明客户端落了库**；而 `hasMore=false` 时水位线是在 `applyRemote` **成功之后**才写的
  （`client.ts:1233-1235`）。所以"服务端说 12 条、客户端游标还在 3"**不能**由下面这个 bug 解释。

  ✅ **但在查它的过程中真的找到并复现了另一条静默丢数据路径**（2026-09-27 已修，`2cf8712`）：
  分页下载在只应用了**第 1 页**之后就把游标推到**全局** `latestSeq`，于是"最后一条已应用 op"
  与 `latestSeq` 之间的整段 op **被永久跳过**；搭车上传那条路径形状相同
  （推到 `body.latestSeq` 却**从没读过** `hasMorePiggyback`）。
  **它是静默的**：服务端的空洞检测恰好在 `excludeClient` 被设置时关闭
  （`operation-download.service.ts:285-294`），而下载路径总是设置它（`client.ts:1155`）——
  服务端**永远不会**对客户端刚造出来的空洞发出警告。这与 `AGENTS.md` §7 第 797 条
  "游标不提前推进"**直接矛盾**。
  修法：`hasMore` 为真时只推进到**本页 op 的 `serverSeq` 最大值**（`latestSeq` 留给最后一页）。
  验收：先红后绿（红分别是 `sinceSeq=600`，应为 `203` / `501`）+ 两半各自**独立**的变异验证；
  sync-client 64/64、op-log 51/51、storage 212/212、web 674 passed / 12 skipped，typecheck exit 0。

  ✅ **那条报告本身也结案了 —— 是复现，不是"仍未解"**（2026-09-28，`4d0e12b`）：
  机理是 **ADR-0016 的 fail-closed 设计行为**：整页 op 一条都解不开时，`download()` 在
  `setLastServerSeq` **之前**就中断 —— 游标不动、一条不应用。**这是设计要的**（宁可停下，
  也不静默跳过历史），不是 bug。复现方式（`packages/sync-client/tests/download-undecryptable-page.spec.ts`）：
  真 `SyncClient` 生产 `download()` + 真 AES-GCM + 真 `OpLogEngine` + 真 SQLite（`node:sqlite` 临时文件），
  HTTP/服务端 op 表是桩，桩打的日志与服务端**逐字同形**：
  `Download: 12 ops (sinceSeq=3, latestSeq=15, hasMore=false, gap=false)`。
  `游标=3` 与 `零落库` 两条断言排在那条 reason 断言**之前并已通过** —— 症状是跑出来的。
  对照组（同一页换**正确口令**）通过：游标 → 15、12 条落库、12 个 habit。
  假设 2/3 也被排除：`sinceSeq=3` 就是客户端自己发出去的值（服务端只解析回显）；
  而 `applyRemote` **先落盘再应用**，若在应用阶段抛，那 12 条**已经**在 op 日志里 → 不可能"零行"。

  🔴 **但顺带查出一个真缺陷并修掉了**：整页解不开抛的是**普通 `Error`** →
  `sync()` 归成 `reason:'unexpected'` → 两个壳对 `unexpected` **原样渲染 `message`**，
  于是**我们写的中文说明被当成"诊断数据"渲染**：英文界面出现
  `Sync error: 这一页 12 条 op 一条都解不开……`（中英混排），主状态行退回与网络抖动
  无法区分的"同步失败"，而且 `retryable:true` 让**口令打错变成无限自动重试**。
  修法：新增 `'undecryptable-page'`（与"部分解不开、其余已同步"的 `'undecryptable-ops'`
  区分 —— 处置不同）+ 类型化 `UndecryptablePageError`；**保留 `throw`、保留 fail-closed**，
  只把分类做对；`message` 改成非中文、可机器定位的诊断。
  变异验证：删掉那段分类 → 转红（`expected 'unexpected' to be 'undecryptable-page'`）→ 还原绿。
  旧测试 `sync.spec.ts` 的断言从"`message` 含中文'口令'"（**被替换掉的旧契约**）改成
  更强的四条：`reason` + `retryable:false` + 能定位到 op + **`message` 不含汉字**。
  ⚠️ **这条与 `2cf8712` 是同一份报告里的两个独立机理**，不要混为一谈。
- ✅ **`check:docs` 的"本机绿"已修，而且根因不止一个**（2026-09-28，`fc32fd6` + `5e4dc1d`）。
  原先它报"检查 **54** 处跨文档章节引用"，修完是 **244** 处 —— **78% 的章节引用从来没被检查过**，
  而门禁一路绿灯。两个缺陷**互相掩护**：

  1. `SECTION_REF_RE` 只认两级编号（`(\d+(?:\.\d+)?)`），`§3.3.1` 被截成 `§3.3`，
     `.1。改完必须…` 再被当成"引用者声称的标题"→ **假**的"标题对不上"；
  2. 目标路径只按**引用文件所在目录**解析，解析不到就 `continue` ——
     `docs/plans/*` 里写仓库根相对路径（`docs/runbooks/deployment.md`）**全部静默跳过**。

  (2) 恰好把 (1) 会误报的引用全跳过了，所以谁也没报错。修法：任意层级编号 + 四个解析基准
  （引用文件目录 / 仓库根 / 唯一 basename / 唯一路径后缀）+ **解析不到必须报错**（不再 `continue`）；
  顺带修了正则尾巴贪心吞掉下一个引用、表格行号不算编号、标题比对把散文当标题（实测报出一屏、**没有一条是真的**）。
  📌 并给检查器加了**每次运行都先跑的自检** —— 这类缺陷可以共存到天荒地老，因为**永远不会有测试变红**。
  变异验证 4 条全过（退回两级编号 / 退回缺陷 (2) 原形 / 解析不到不返回 null / 表格行号失效，各自转红）。
  端到端也验过：改坏 `roadmap.md` 里一个编号 → 报红；改成 `docs/runbookz/…` → 报"解析不到目标文件"；还原后复绿。
  记进 `AGENTS.md` §7 第 85 条。
  ⚠️ **剩下的"干净检出红"是另一件事，而且正在被并行会话修**：10 处死链（不是 6 处）指向
  `research/upstream/`（`.gitignore:39`，一份**永远不在任何新检出里**的本地 vendor 目录），
  以及 `research/{desktop-shell-selection,e2ee-widget-key-handling}.md` —— 后者正被搬进 `docs/research/`
  （工作区里已是未跟踪的新文件），搬完这两个死链就没了。**这条不是本会话的账。**
- ✅ **`check:ai-e2e` 全绿：26 passed，exit 0**（2026-09-28 复验）。两条桌面端用例
  （开发构建 + `release/heyta-darwin-arm64` 的打包 `.app`）都真的打开窗口、画出共享 UI；
  渲染进程崩溃由并行会话的**单实例锁**修复收口（`616b050`）。
  📌 **复验中途曾出现一条与本会话无关的失败，已由并行会话修复；记下来是因为根因值得记**：
  那次是 `25 passed / 1 failed`，唯一失败 `ai-prioritize` 的超时真因是 **Vite dev server 起不来** ——
  `Failed to resolve import "@heyta/storage/sqlite/wasm" from "src/worker/storage.worker.ts?worker_file&type=module"`。
  并行会话新增了 `package.json` 的 `./sqlite/wasm` 导出，但 `tsup.config.ts` 的 `entry`
  没有列 `src/sqlite/sqlite-wasm-driver.ts`（**tsup 只产出 `entry` 里列的东西**），
  于是 `dist/` 里没有那个文件；同一个根因当时也让 `apps/web` 的 `tsc --noEmit` 失败（唯一报错就在那个文件）。
  该 entry 补进 `tsup.config.ts` 后，**e2e 26 passed、`apps/web` typecheck `exit 0` 全部恢复**。
  教训：**跨包的子路径导出必须在构建入口里显式列出来，否则"源码在、能 import、但产物没有"。**
  ⚠️ **但 `apps/web` 的全量套件在 HEAD 上是红的**（2026-09-28 实测，**不是** 16 个门禁的一部分，
  所以上面那句"全部绿"仍然成立）：`12 failed | 29 passed | 2 skipped` /
  `89 failed | 596 passed | 12 skipped`，失败**全部**是
  `ReferenceError: Worker is not defined` @ `apps/web/src/lib/oplog.ts:101`。
  根因是并行会话当天 00:44 提交的 `71594d5`（M4-3b：web 存储默认切到 **Worker 里的 SQLite**）——
  `oplog.ts` 现在在**模块作用域**构造 `new Worker(...)`，而 vitest/jsdom 里没有 `Worker` 全局。
  12 个失败文件全是存储相关（`store` / `stores` / `trash` / `export-panel` / `import-panel` /
  `app-mount` …）；与该提交无关的 spec 单独跑是绿的。
  📌 **教训**：把"宿主环境才有的全局"（`Worker`、`indexedDB`……）用在**模块作用域**，
  会让**整包测试**在无关改动里一起红，而且报错信息只说缺哪个全局、不说这是环境缺 polyfill。
  需要并行会话在 vitest setup 里补 `Worker` 替身（或把构造推迟到首次使用）。
- 🔴 **全量 `pnpm check` 仍未跑通**：它会触发 `prisma generate` 而沙箱报 EPERM（`utime` 在
  `~/.cache/prisma/.../libquery_engine`）。**但逐个跑过 16 个 `check:*`，全部绿**（外加 `check:ai-e2e` 26 passed）：
  `migrations / layering / widgets / ui-language / licenses / docs / pricing / ai-quota / payment-entry /
  materialized-reads / design / tokens / ai-coverage / arkts / native-deps / mobile-bundle`。
  卡点只在 `pretest` 里的 `prisma generate`，不在测试本身 —— 直接
  `pnpm --filter @heyta/sync-server exec vitest run` 可以完整跑（**1527 passed / 1 skipped**，exit 0）。
- **billing 的退款侧：从今以后是「有意不做」，不是「忘了接」**（ADR-0026，
  `docs/adr/0026-refund-side-entitlement-revocation-not-implemented.md`）。
  `reverseOrderOnRefund` 继续**零生产调用方**，退款事件继续在 `unsupported-event-type` 被拒 ——
  两条都是**显式记录的决定**。理由值得抄下来：只接订单侧（订单置 `refunded`、核销置 `reversed`）
  而**权益不动**，会造出一个**半真状态** —— 运维看到"退款已处理"会合理地以为权益也没了。
  这正是本仓库反复拒绝的那类形状（"界面/账本说成功、功能没接上"）。
  ⚠️ **这条已经翻过一次面**：本轮收尾时我按"退款侧是缺口、去接上"派了活，
  子代理发现 ADR-0026 刚被并行会话写成「已接受」，于是**拒绝执行并上报** ——
  这是对的。**教训：派活前先看 ADR 的最新状态，别照着一小时前的结论开工。**
- ✅ **存量回填（接线前已付款但未结算的订单）已做**（2026-09-27，`60db578`）：
  订单在 webhook 接线**之前**付了款，那条 `payment_events` 行就永远停在那儿 ——
  重投会被幂等闸挡住（唯一约束按 `provider_event_id`），而没有任何东西会**重新驱动**它。
  于是"钱收了、权益没发"，且**没有任何错误**，这正是最难发现的一类账。

  - **候选判据是从真实状态机读出来的，不是猜的**：`checkout_orders.status IN ('pending','expired')`
    **且**存在一条 `payment_events`，其 `provider_event_id = 'payment_succeeded:' || out_trade_no`
    （这是 schema 里**唯一**能把事件关联回订单的链接 —— `payment_events` 上没有 `out_trade_no` 列）。
    🔴 **刻意用 `status` 而不是 `settled_at`**：`expireStaleOrders` **也**会写 `settled_at`，
    所以它根本区分不出"结算过"和"过期关掉过"。
    🔴 另外**排除已经留下 `order_amount_mismatch` 审计的单** —— 金额已经知道对不上的，
    该给人看，不该被自动重试抹平。
  - **不许复制业务逻辑**：把原本内联的"结算 + 授予"编排抽成**同一个**
    `settleAndApplyEvent(event, {sql, subscriptions})`（`webhook.routes.ts`），
    实时 webhook 与对账**跑的是同一个函数**，差别只在**谁开事务**（对账是每单一个事务）。
  - **幂等键格式收敛到唯一事实源**：`WECHAT_PAYMENT_SUCCEEDED_EVENT_PREFIX` +
    `buildWechatPaymentEventId`（`wechat.adapter.ts`）。它有两处消费者，
    只改一处会让对账**静默地一条候选都找不到**（不报错、只是什么都不做）。
  - 日常清理的第 7 步跑对账，**零结果也打日志**，非 `granted` 的候选逐个 `Logger.warn`。
  - 验收：10 条真 SQL 的 PGlite 测试 + **4 组变异验证**（去掉 `status` 判据 → 2 条红；
    去掉 mismatch 排除 → 1 条红；打断与 `payment_events` 的关联 → **10 条全红**；
    让共享函数跳过微信结算 → **6 条既有 webhook 测试红**，证明抽取没有丢掉实时通路的守卫）。
    server 全量 **1488 passed / 1 skipped**，`tsc --noEmit` exit 0。
  - ✅ **`reconcile-job.ts` 的 Prisma 胶水已被 PGlite 真跑**（2026-09-28，`5a455dc`）。
    原先它只过类型、**没有测试**，头部注释还把这件事写成"薄胶水，不被 PGlite 覆盖" ——
    那正是**最容易被悄悄改坏又没人发现**的形状：它不写业务逻辑，却决定了
    **SQL 收到哪些参数**（`$1/$2/$3` 顺序；`provider` 与事件前缀一旦对调，SQL 依然合法、
    只是**一条候选都查不到**，不报错、什么都不做）和**事务开在哪里**（每单一个）。
    修法：加结构类型 + 第三参 `client: ReconcilePrismaClient = prisma`（**生产默认值不变**，
    tsc 通过即证明真 `PrismaClient` 可赋给该结构类型），测试从外面注入一个
    **PGlite 支撑的假 Prisma client**（`$transaction` 跑真 `BEGIN/COMMIT/ROLLBACK` 并计数）。
    8 条断言 + 4 组变异验证（事务边界改成一个 → 4 红；参数对调 / 时钟 / 丢掉注入 limit 各 1 红）；
    本会话独立复跑：两个对账 spec **18 passed**、`tsc --noEmit` **exit 0**。
    ⚠️ **边界（别读大了）**：测试里 `tx.subscription.*` 是**内存替身**，不是真 Prisma 委托；
    真跑的是 SQL、参数、事务边界与订单/券的真实写入。
  - ⚠️ **仍未跑过真通道**：生产只注册了 `noop`，且 `.env` 里没有任何 `BILLING_*`/`WECHAT_*`；
    **没有 `payment_events` 行的单补不了**
    （没有任何东西能证明它付过款）；金额**无法独立复核**（`payment_events` 只存 SHA-256 摘要），
    所以按冻结的 `final_amount_minor` 结算；**只认得微信的 `providerEventId` 形状**。
  - 📌 **与退款侧正交**：对账只对**已经记录为收到钱**的单**授予**，
    从不调用 `reverseOrderOnRefund` / `revokeEntitlement`，候选也排除 `refunded`/`failed`。
    ADR-0026 的结论**没有被碰**。
  - ✅ **对生产实例做过一次真演练（只读 + 可回滚），2026-09-28**（补上上面那条"没有跑过真通道"的一半）。
    在 `supersync-postgres`（PostgreSQL 16，**真 schema、真迁移**：`_prisma_migrations` 里
    `20260929000000_add_subscription_grants` 已 applied）上跑了**与 `reconcile.ts` 逐字相同**的候选查询：

    - **候选数 = 0**。原因是**账单侧从来没开过**，不是"查询对了但没数据"含糊过去：
      `checkout_orders` / `payment_events` / `pricing_audit_log` / `subscriptions` **四张表全为空**，
      生产 `.env` 里**没有任何** `BILLING_*` / `WECHAT_*` 键 —— 所以线上只有 `noop`，
      `503 BILLING_PROVIDER_NOT_CONFIGURED` 是**配置状态**，不是缺口。
    - 🔴 **但"0 候选"本身不能证明查询是对的**（写错了也是 0）。所以又在一个**显式 `ROLLBACK` 的事务里**
      造了一条**真候选**（`pending` 单 + `payment_succeeded:<out_trade_no>` 事件），
      确认查询在生产实例上**恰好找到 1 条**、并且能取到 `buildReconcileEvent` 要读的全部字段
      （`final_amount_minor`、`provider_event_id`、`occurred_at`）；回滚后三张表**仍然是 0**。
      这一半才是"SQL 在生产形状下真的能跑"的证据。
    - ⚠️ **因此"跑一次真补结算"在生产上是 no-op**：候选为 0，且**对账代码根本没部署**
      （`/app/dist/src/billing/reconcile*.js` 不存在，镜像构建早于 `60db578`）。
      换句话说：**现在的线上状态既没有积压、也没有能力去补**，两件事都要等账单功能真正启用时才需要收口。
    - 📌 复现方式（**不改任何一行生产数据**，这是它敢在生产上跑的原因）：把 SQL 从 stdin 灌进容器里的 `psql`，
      演练部分用显式 `BEGIN` / `ROLLBACK` 包住：

      ```bash
      ssh <server> 'sudo docker exec -i supersync-postgres \
        sh -lc '"'"'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'"'"'' < dryrun.sql
      ```

      先跑纯只读的候选查询拿候选数；再在 `BEGIN … ROLLBACK` 里插入合成候选验证查询真的能找到它。
      ⚠️ 别用 `psql` 的 `\gset` 去接 `INSERT ... RETURNING`：写成 `… RETURNING id AS uid;\n\gset`
      会**把那条 INSERT 再执行一次**（撞 `users_email_key` 唯一约束）—— 要把 `\gset` 当**终结符**用，
      即 `INSERT … RETURNING id AS uid` 后面直接跟 `\gset`，不带分号。

- ⏸️ **微信支付：按用户指示「先不用管了」，搁置（2026-09-28）。这是暂缓，不是"不做"，也不是新 ADR。**
  用户原话是"微信支付先不用管了，好吧？"—— 所以本轮**只登记状态，不再往上叠任何微信支付相关的代码**。
  已经存在的东西不删、不倒退：适配器（`wechat.adapter.ts`）、
  `6d84e56`（定价与优惠券 / 结算 / 退款 / 微信支付适配）与对账那一整条链**都保持现状**。
  - **为什么搁置是诚实的**：卡点不在代码里，而在**微信商户号的开户 / 实名（KYC）**。
    那是**外部**流程 —— 本仓库里无论写多少适配、多少重试、多少对账，都不能把它推进一格。
    在这之前，生产能做的仍然只有 `noop`；`.env` 里没有任何 `BILLING_*` / `WECHAT_*`，
    `503 BILLING_PROVIDER_NOT_CONFIGURED` 是**配置状态**而不是缺口。
  - 🔴 **因此不要再做这几件事**（本会话已按此执行，免得下一个会话从头再启动一遍）：
    不要为微信支付加新的端点 / 重试 / 对账分支；不要把上面那次对账演练从"只读 + 回滚"
    改成真跑（候选为 0 且对账代码未部署，真跑是 no-op，唯一效果是留下痕迹）；
    更不要把"没有真通道"写成待办交给实现 —— **它等的是人，不是代码**。
  - **什么时候解除搁置**：拿到可用的商户号之后。届时要做的第一件事不是写代码，而是
    配 `WECHAT_*` 环境变量并**跑通一笔真实小额交易**（含回调），因为这条链
    从来没有见过真通道：金额无法独立复核（`payment_events` 只存 SHA-256 摘要）、
    只认得微信的 `providerEventId` 形状。
  - 📌 **本文之外不要再开一份"微信支付待办"**：状态只有这一处，多一处一定会漂移。
    与 ADR-0017 / ADR-0018 / ADR-0020 的**结论无关**（那几份讲的是分档与渠道选择，
    这里只是"什么时候动手"）。

---

*组件版本与活跃度均为 2026-09-25 实测。引入任何新依赖前必须重跑可维护性与许可证核实。*
