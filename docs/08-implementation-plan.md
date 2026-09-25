# heyta 实施计划

> 状态：**第一阶段进行中**
> 前置决策见 `docs/03-architecture.md` §0；复用依据见 `docs/06-reuse-plan.md`。

---

## 0. 硬性约束（贯穿所有阶段）

| 约束 | 内容 |
|---|---|
| **可维护性门槛** | 引入的任何第三方组件，**必须 2021 年之后仍在持续更新**，否则排除。每次引入前用 `python3 research/tools/ghinfo.py owner/repo` 或 npm registry 核实最后提交/发版时间 |
| **许可证** | 逐项登记到 `research/licenses.md`，未登记不得引入 |
| **本地优先** | 数据先落本地；云端是同步通道而非事实源 |
| **不可逆层优先干净** | 同步协议、数据 schema、服务端要一次做对；UI/外壳/集成可以先将就 |

---

## 1. 阶段划分

| 阶段 | 目标 | 交付判据 | 状态 |
|---|---|---|---|
| **P0 奠基** | 工程骨架 + 实体模型 + 服务端跑通 | 能在 Docker 上完成一次真实的「A 端写入 → B 端同步可见」 | 🔄 **当前阶段** |
| **P1 单端闭环** | 1 个端（Web）跑通核心功能 | 任务/清单/四象限/习惯/番茄钟可用，能同步 | ⏸ |
| **P2 多端补齐** | 桌面 + 移动 | Tauri/Electron + Capacitor 套壳，共享同一套核心 | ⏸ |
| **P3 平台特有能力** | 小组件、通知、CalDAV 双向同步 | 依赖前两阶段 | ⏸ |

> **为什么 P0 不碰 UI**：`docs/03` 的分层原则——核心不对，后面全是重构。
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

| heyta 实体 | 来源 | 备注 |
|---|---|---|
| `TASK` `PROJECT` `TAG` `NOTE` | 沿用 | |
| `TASK_REPEAT_CFG` `REMINDER` | 沿用 | |
| `HABIT` `HABIT_LOG` | **新增** | 上游只有 `SIMPLE_COUNTER`，语义不够 |
| `FOCUS_SESSION` | **新增** | 上游借用 `METRIC` |
| `GLOBAL_CONFIG` `MIGRATION` `RECOVERY` `ALL` | 沿用 | 系统实体 |
| ~~`WORK_CONTEXT`~~ `TIME_TRACKING` `ISSUE_PROVIDER` `PLUGIN_*` `MENU_TREE` | **删除** | 不需要 |

⚠️ **改一处要同步改两处**：`shared-schema` 与服务端 `validation.service.ts` 都依赖这份清单，
服务端**会拒绝未知实体类型**。

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

---

## 5. 下一步动作（按顺序）

1. **确认许可证 ADR-0001**（`docs/04-license-decision.md` 仍标"待确认"）——这是唯一还挡在前面的决策
2. 在服务器上 `docker compose up` 跑通 `super-sync-server`，确认 `/api/sync/status` 可达
3. 建 monorepo 骨架，引入 `sync-core`（原版不改）
4. 写 heyta 实体清单 + 7 个 host Port 适配
5. 实现 IndexedDB 存储适配
6. 跑通 §2.6 的同步闭环验收

---

*组件版本与活跃度均为 2026-09-25 实测。引入任何新依赖前必须重跑可维护性与许可证核实。*
