# 可复用组件决策表

> 目标：**每一个功能模块，先找现成的，找不到才自研。**
> 本表只收录会影响技术选型的结论。
> 证据分级：**【本机实测】** = 我亲自用 `curl` 读 npm registry / raw LICENSE 验证；
> **【子任务核实】** = 由调研子任务用 `ghinfo.py` + raw LICENSE 核实；**【未核实】** = 仅搜索线索。

---

## 0. 结论速览

| 模块 | 决策 | 首选 | License | 依据 |
|---|---|---|---|---|
| **自然语言日期解析** | ✅ **直接用** | **chrono-node** | **MIT** | 【本机实测】 |
| 四象限视图 | 🔧 自研布局 + 复用拖拽 | **dnd-kit** | **MIT** | 【本机实测】+【子任务核实】 |
| 日历视图 | ✅ 直接用 | fullcalendar / schedule-x | MIT | 【子任务核实】 |
| 甘特/时间线 | ✅ 直接用 | frappe-gantt / vis-timeline | MIT / Apache-2.0 | 【子任务核实】 |
| RRULE 重复规则 | ✅ 直接用 | rrule.js | 待登记 | 【未核实】 |
| CalDAV 客户端 | ⚠️ **必须绕开 AGPL** | 需另选 | — | 【本机实测】 |
| CalDAV 服务端 | ✅ 自建选型 | Radicale / Baikal | 待登记 | 【未核实】 |
| 推送 | 🔧 自建/组合 | ntfy / UnifiedPush + APNs/FCM | 待登记 | 【未核实】 |
| 本地数据库（Dart） | ✅ 直接用 | Drift (SQLite) | 待登记 | 【未核实】 |
| 同步引擎 | ✅ **不用第三方，用 sync-core** | `@sp/sync-core` | MIT | 【本机实测】 |
| 习惯 streak 计算 | 🔧 自研（算法简单） | — | — | 【本机实测】 |

---

## 1. ⭐ 自然语言日期解析：chrono（本机实测通过）

**这是本次盘点里性价比最高的发现**——滴答清单的"自然语言快速添加"可以直接复用现成库，且**中文开箱可用**。

### 实测结果

| 项 | 值 |
|---|---|
| npm 包 | `chrono-node` |
| 最新版本 | **2.10.1**（发布于 2026-07-20）【本机实测 npm registry】 |
| **License** | **MIT** ✅【本机实测：`raw.githubusercontent.com/wanasit/chrono/master/LICENSE.txt` 原文 — "The MIT License, Copyright (c) 2014, Wanasit Tanakitrungruang"】 |
| Stars | 5,287（2026-09-25）【子任务核实】 |
| 仓库 | `wanasit/chrono`（默认分支 `master`，注意许可证文件是 `LICENSE.txt` 不是 `LICENSE`） |

### 中文支持已核实存在

`src/locales/` 下确实有 **`zh`** 目录，含 `hans` / `hant` 两套（HTTP 200 实测）：

| 文件 | 状态 |
|---|---|
| `src/locales/zh/hans/parsers/ZHHansCasualDateParser.ts` | ✅ 200 |
| `src/locales/zh/hans/parsers/ZHHansDeadlineFormatParser.ts` | ✅ 200 |
| `src/locales/zh/hant/parsers/ZHHantWeekdayParser.ts` | ✅ 200 |

可解析「今天 / 明天 / 后天 / 下午 / 晚上 / 中午 / 周五」这类高频表达。

### 子任务给出的组合策略（可作为设计参考）

中文覆盖**现成库约 70–85%**，长尾（口语、方言、跨句上下文、农历/节日）必须自研兜底。
建议三级降级：`chrono`（中英统一入口）→ 失败转 `JioNLP`（Apache-2.0，中文长尾）→ 仍失败转 LLM 结构化抽取。

⚠️ **不要用** Time_NLP 系列——**根目录没有 LICENSE 文件**，法律上默认保留所有权利，不能进商用产品。

---

## 2. 四象限 / 艾森豪威尔矩阵：没有现成组件，必须自研

**子任务的核心结论**（扫遍 GitHub topic `eisenhower-matrix` + npm registry）：

> 「拿来即用的四象限视图组件库」在开源世界里基本不存在。
> topic 下最高 star 的是 919★ 的 Android 原生 App，第 2 名是 243★ 的 Flutter App。
> 前 20 名里**没有一个是可复用的 Web 组件库**。npm 上 `eisenhower` / `priority-matrix` / `quadrant` 均无可用的四象限组件包。

**另一个重要事实**：**Super Productivity 的"四象限"也是用通用"自定义看板"配出 4 列，不是原生象限视图**——这是厂商自己官网的原话。

### 结论

四象限**只需自研三层**：布局 + 象限归属规则 + 持久化。拖拽交互直接用成熟库：

| 库 | 版本 | License | 用途 |
|---|---|---|---|
| **dnd-kit** | 6.3.1 | **MIT** ✅【本机实测 npm registry】 | 2×2 拖拽矩阵 |
| SortableJS | — | MIT【子任务核实】 | 备选 |

**工作量估计：2×2 拖拽矩阵 200～400 行。**

### 可参考的数据模型实现

| 项目 | License | 价值 |
|---|---|---|
| `harin/todoist-matrix` | MIT | 把 Todoist 任务映射成优先级矩阵视图——**最贴近"给已有任务系统加矩阵视图"的范式** |
| `vscarpenter/gsd-task-manager` | MIT | Next.js，四象限 + MCP server |

---

## 3. 日历 / 甘特 / 时间线

| 用途 | 项目 | Stars | License | 备注 |
|---|---|---|---|---|
| 日历 | **fullcalendar** | 20,653 | MIT | 最成熟 |
| 日历 | schedule-x | 2,585 | MIT | 更现代、更轻 |
| 甘特 | **frappe/gantt** | 6,127 | MIT | |
| 甘特 | xpyjs/gantt | — | MIT | Canvas 渲染，大数据量性能好 |
| 时间线 | vis-timeline | — | Apache-2.0 **OR** MIT | 双许可，可任选 |

（均为【子任务核实】，未逐项本机复验）

---

## 4. ⚠️ CalDAV：必须绕开 AGPL

**这是唯一的硬性排除项**【本机实测】。

| 项 | 结论 |
|---|---|
| `@nextcloud/cdav-library` | **AGPL-3.0-or-later** 🔴 — Super Productivity 把它放在 devDependencies，但**被生产代码 import**，会进产物 |
| 位置 | `src/app/features/issue/providers/caldav/caldav-client.service.ts:4` |
| 决策 | **禁止引入。** CalDAV 客户端用宽松许可库自研或用非 Nextcloud 实现 |

CalDAV **服务端**候选（自建/兼容生态）：Radicale、Baikal、SabreDAV——许可证【未核实，引入前必须登记】。

---

## 5. 同步引擎：不要引入任何第三方（结论已明确）

子任务扫了全市场，结论很清楚：

| 方案 | 状态 |
|---|---|
| **PowerSync** | ⚠️ 服务端 source-available，**限制竞品商用**——我们就是竞品，**排除** |
| **Couchbase Lite 4.x** | ⚠️ BSL，**明文禁止提供竞争性托管服务**，**排除** |
| **sqlite-sync** | ⚠️ 同上，禁止竞争性托管，**排除** |
| Triplit | ⚠️ 团队 2025-08 被 Supabase acqui-hire，转社区维护，**风险** |
| Ditto / ObjectBox Sync | ⚠️ 纯商业 |
| Electric | Apache-2.0，但**只有 Postgres 只读下行**，写路径要自己写 |
| Yjs / Loro / Automerge + Hocuspocus | MIT，纯 CRDT 库 + 自写同步服务 |

**但对 heyta 而言，这条调研的意义是"排除"，不是"选择"**：

> 我们已经有 `@sp/sync-core`（MIT、4,240 行、271 测试、向量时钟 + LWW + E2EE），
> **它是比上述任何方案都更贴合的答案**——因为我们的冲突场景不是文档协同，而是"手机勾完成、电脑改日期"。

只有当出现"多人实时协同编辑同一任务描述"这种需求时，才需要再引入 Yjs 一类的 CRDT。

---

## 6. 本地数据库 / 跨端框架

⚠️ 这部分**依赖"跨语言策略"的最终决定**（见 `research/deep-dive-cross-language.md`）。

| 路线 | 本地库候选 |
|---|---|
| Flutter / Dart | **Drift**（SQLite 上的类型安全 ORM）、sqflite |
| React Native | WatermelonDB、RxDB、op-sqlite |
| 直接复用 JS | IndexedDB / SQLite（Super Productivity 已有两套 adapter 实现可参考） |

**注意**：Super Productivity 的 `op-log/persistence/` 已经给出了 **`OpLogDbAdapter` 存储抽象接口** + `indexed-db-op-log-adapter.ts`(464 行) + `sqlite-op-log-adapter.ts`(889 行) 两个实现——**这是我们设计自己存储层时最该抄的模式**。

---

## 7. 推送

| 方案 | 说明 |
|---|---|
| APNs / FCM | 官方通道，必需，但有平台成本与隐私问题 |
| ntfy / Gotify | 开源自建推送服务 |
| UnifiedPush | Android 端的开放推送标准（去 Google 依赖） |

许可证【未核实】。**推送是待办类产品的生命线，不能用第三方依赖**——SaaS 服务一旦挂掉，用户就收不到提醒。

---

## 8. 明确不要碰的项目（子任务汇总的许可雷区）

| 项目 | 问题 |
|---|---|
| Planka | 自定义社区许可，**禁止对第三方商业托管** |
| Focalboard | 源码 AGPL-3.0 / 商业双许可，且已停止维护 |
| TaskView | Source-Available，**禁止 SaaS 与竞品** |
| 一批无 LICENSE 的小项目 | 法律上默认保留所有权利，**一行代码都不能抄** |
| Time_NLP（NL 日期解析） | 无 LICENSE 文件，只能当参考 |

---

## 9. 复利总结：这个项目"省轮子"省在哪

| 省下来的 | 来源 | 量级 |
|---|---|---|
| 同步内核（向量时钟 + LWW + E2EE） | `@sp/sync-core` | **4,240 行 + 271 测试** |
| 生产级同步服务端 | `super-sync-server` | 148 个 ts 文件 |
| 线协议定义 | `supersync-http-contract.ts` | 384 行 zod |
| 加密的跨语言移植蓝本 | Kotlin `Argon2/Blake2b/OpPayloadDecryptor` | **633 行 + CI 互操作验证** |
| 中文自然语言日期 | `chrono-node` | 完整库，MIT |
| 日历/甘特/拖拽 | fullcalendar / frappe-gantt / dnd-kit | MIT |
| op-log 存储抽象设计 | `OpLogDbAdapter` 接口 | 可抄模式 |
| **合计** | | **约 5,500 行核心代码 + 一整套协议设计** |

**自研不可避免的**：`src/app/op-log/` 那 51,708 行编排层、四象限 UI、习惯模块、以及你自己的冲突策略。

---

*组件许可证需逐项补登记到 `research/licenses.md` 后才能引入。*
