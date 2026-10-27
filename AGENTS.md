# AGENTS.md

给在本仓库工作的 AI agent 的规则。**这些是约束，不是建议。**

面向人的贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)；文档该放哪见 [`docs/README.md`](docs/README.md)。

---

## 0. 前提

**heyta 还在开发阶段、不可能有用户，所以"会破坏已有安装／老客户端／存量数据"不作为判断依据，但这也**不**等于可以不讲理由 —— 论证仍要指向真问题。**

---

## 1. 这个项目是什么

heyta 是一个**本地优先**的任务管理应用，目标是做一个功能上对标滴答清单、但可以自建/自托管的替代品。

- **本地优先**：数据先落本地，云端只是同步通道，**不是事实源**。
- **端到端加密**：服务端从设计上就看不到用户明文。
- **同步模型**：op-log（事件溯源），**不是 CRDT**。向量时钟判并发，LWW 加 `clientId` 确定性打破平局。

> 🔴 **本文件是入口与索引，不是全部规则。** 详细规则按**作用域**拆到
> [`docs/agents/`](docs/agents/) 下，见下面的「规则地图」。
> 本文件刻意保持在 **24 KiB 以内** —— Codex 的 `project_doc_max_bytes` 默认 32 KiB，
> 超出的部分会被**静默截断**，等于没写。
> ⚠️ 改本文件时**先看它现在多大**：`wc -c AGENTS.md`。

---

## 2. 仓库地图

**完整地图（逐目录「能不能改」+ 各壳现状）在 [`docs/agents/repo-map.md`](docs/agents/repo-map.md)。**
看一眼就知道要动的目录属于哪一档：

| 档 | 路径 | 含义 |
|---|---|---|
| 🔴 不可逆层 | `packages/shared-schema/` | 实体清单、schema 版本、**HTTP 线协议契约**。改之前先读 ADR 与计划 |
| ⚠️ vendored | `packages/sync-core/`、`server/` | vendored 自 Super Productivity（MIT）。**尽量不改**，改了要更新 `PROVENANCE.md` |
| ⚠️ 唯一事实源 | `packages/i18n/`、`packages/design-system/` | 文案与设计变量的**唯一**来源，界面里不许硬编码（各有门禁） |
| ✅ 可改 | `packages/{storage,op-log,domain,sync-client,app-host,ai,local-api}/` | 共享层。**业务语义只许出现在这里** |
| ✅ 可改（受限） | `apps/*` | 客户端外壳。**只允许放平台差异与 UI 绑定**（见 §3 铁律） |
| ⚠️ 归档 | `research/`、`scripts/`、`docs/` | 调研原料 / 门禁实现 / 产品文档。**`research/` 不是产品文档** |

🔴 **`apps/*` 只允许有一处平台差异 —— 注入哪个 SQLite 驱动。** 判据：
**这段代码里有没有任何一行在决定「业务上该怎么做」？** 有就是提取得不够。
完整对照表与实测代价见 [`docs/agents/hard-constraints.md`](docs/agents/hard-constraints.md) §3.5。

---

## 3. 不可逆层与铁律

**这几条违反即打回。完整版在 [`docs/agents/hard-constraints.md`](docs/agents/hard-constraints.md)。**

| 铁律 | 一句话 | 细则 |
|---|---|---|
| **可维护性门槛** | 引入第三方组件前**必须确认它在 2021 年之后仍在更新**，否则排除，无论许可多宽松 | §3.1 |
| **许可证** | 禁 AGPL/GPL/LGPL/BUSL/FSL/Elastic/SSPL/CC-BY-NC；**无 LICENSE = 一行都不能用**；**白名单外默认失败** | §3.2 |
| **schema 与持久化字段** | **默认不 bump `CURRENT_SCHEMA_VERSION`**；新字段一律写成**可选**（`?`）+ 运行时默认值 —— **必填字段会在 hydration 时炸，而 TS 与构建都不会告诉你** | §3.3 |
| **op-log 纪律** | 一个用户意图 = 一个 op；**被回放/来自远端的 op 不得再触发副作用**；**op-log 是唯一写入口** | §3.4 |
| **宿主外壳边界** | `apps/*` 不许有任何一行决定「业务上该怎么做」 | §3.5 |
| **迁移纪律** | **不可逆层**。🔴 **不要用 `prisma migrate deploy` 直接部署** —— 必须 `cd server && sh scripts/migrate-deploy.sh`；**永不修改已应用的迁移**（`migrate deploy` 不会发现，它照样退出 0） | [`db-migrations.md`](docs/agents/db-migrations.md) |
| **设计系统** | 组件**禁止裸值**（裸 hex/px/ms/z-index）；用**语义名**不用外观名；要新变量**先加 token** | [`design-system.md`](docs/agents/design-system.md) |

### 🔴 不要擅自做的事

- 不引入新的第三方依赖，除非先过了可维护性 + 许可证两道门并完成登记
- 不 bump `CURRENT_SCHEMA_VERSION`
- 不改已接受的 ADR 的结论（要变更就新写一份）
- 不修改 `AGENTS.md` / `CONTRIBUTING.md` 的**规则**部分，除非用户在当前任务里明确要求
- 不在 `CURRENT_SCHEMA_VERSION` / 线协议 / 迁移上做"顺手改一下"

---

## 4. 规则地图（本仓库全部 agent 规则）

**按作用域拆分。改哪一块就读哪一份 —— 不要靠本文件推断细节。**

| 文件 | 负责什么 | 什么时候读 |
|---|---|---|
| [`docs/agents/repo-map.md`](docs/agents/repo-map.md) | **仓库地图**：逐目录内容 + 能不能改 + 各端现状 | 动手前定位代码 |
| [`docs/agents/hard-constraints.md`](docs/agents/hard-constraints.md) | **硬性约束**：可维护性门槛 / 许可证 / schema / op-log / 宿主边界 | 加依赖、改协议、碰 `apps/*` |
| [`docs/agents/db-migrations.md`](docs/agents/db-migrations.md) | **数据库迁移纪律**：CONCURRENTLY 形状 / 锁超时 / 校验器 | 任何迁移改动 |
| [`docs/agents/design-system.md`](docs/agents/design-system.md) | **设计系统**：三条硬规则 / 文字层级 / 对比度 / 常见错 | 写任何 UI |
| [`docs/agents/overlay-feedback.md`](docs/agents/overlay-feedback.md) | **浮层与反馈**：提需求的四要素 / 危险四档 / 关闭策略表 / 债务账本门禁 | 写任何浮层、确认框、操作回执 |
| [`docs/agents/commands.md`](docs/agents/commands.md) | **常用命令**：install / build / typecheck / test / 各 `verify:*` / 各 `check:*` | 跑任何命令前 |
| [`docs/agents/multi-end-build.md`](docs/agents/multi-end-build.md) | **多端构建与固定收尾**：`pnpm reinstall:all` 四端重装、各端判据 | 交付一轮之前 |
| [`docs/agents/ui-acceptance.md`](docs/agents/ui-acceptance.md) | **界面验收硬性规定**：Playwright 必须真跑+真看截图 / 不许抢前台 / "同类缺陷没有"这句要带现量读数 | 写验收、跑 GUI 测试 |
| [`docs/agents/ux-principles.md`](docs/agents/ux-principles.md) | **界面结构原则（解剖）**：控件高度一档 / 一行一容器 / 动作区常驻 / 配置收起；每条带可判红的判据 | 写任何表单、对话框、设置页 |
| [`docs/agents/environment-traps-index.md`](docs/agents/environment-traps-index.md) | **环境陷阱索引**：号段 → 主题；三条元规则 | 排查"本地过、容器不过" |
| [`docs/agents/workflow-rules.md`](docs/agents/workflow-rules.md) | **工作流 25 条**：对账 / 安全判据 / 同步语义 / 提醒回执 / iOS 验收纪律 | 做任何实质改动 |
| [`docs/agents/progress-log.md`](docs/agents/progress-log.md) | **当前进度**：阶段表 / 并行轨道 / 已知边界 | 知道做到哪了、下一步做什么 |
| [`docs/agents/key-decisions.md`](docs/agents/key-decisions.md) | **已定的关键决策**：ADR 摘要 + 每条的红线 | 改架构、改产品边界前 |
| [`docs/agents/history-a-2026-10-03.md`](docs/agents/history-a-2026-10-03.md) | **历史交付记录 · 上半**（2026-10-03 倒数纪念日批次二）：逐批交付与判据 | 考古、找"这事以前怎么做的" |
| [`docs/agents/history-b-2026-09-30.md`](docs/agents/history-b-2026-09-30.md) | **历史交付记录 · 下半**（2026-09-27 – 09-30）：中文化 / 管理后台 / 域名迁移 / 身份入口 / 通知中心 / Windows 旅程 | 考古、找"这事以前怎么做的" |
| [`docs/agents/legacy-traps-80-83.md`](docs/agents/legacy-traps-80-83.md) | **遗留条目 #80–#83**：安装包验收 / 窗口取证 / MSIX ASCII | 碰安装包或窗口取证 |

**上游真源（这些不是本仓库的 agent 规则，但被上面的文件反复引用）：**

| 内容 | 位置 |
|---|---|
| 环境陷阱**正文**（编号只增不改，引用写「§7 #N」） | [`docs/reference/environment-traps.md`](docs/reference/environment-traps.md) |
| 迁移权威规范 | [`server/prisma/migrations/README.md`](server/prisma/migrations/README.md) |
| 设计系统规则与理由 | [`design-system/heyta/MASTER.md`](design-system/heyta/MASTER.md) |
| 设计变量唯一事实源 | [`packages/design-system/src/tokens.css`](packages/design-system/src/tokens.css) |
| AI 架构 / AI 入口文档 | [`docs/reference/ai-architecture.md`](docs/reference/ai-architecture.md) · [`docs/plans/ai-strategy.md`](docs/plans/ai-strategy.md) |
| 总路线图 | [`docs/plans/roadmap.md`](docs/plans/roadmap.md) |
| 文档分层规则 | [`docs/README.md`](docs/README.md) |

> 🔴 **本仓库的 agent 规则只有这一套。** 加新规则时**加进 `docs/agents/` 对应文件**，
> 不要往本文件里堆 —— 堆到 32 KiB 以上就等于全部没写。
> 新增子文件后**必须回本表登记**，否则它是一份没人会读的孤儿文档。

---

## 4a. 旧章节号 → 新位置（**引用迁移表，编号不许再变**）

2026-10-12 拆分之前，全仓有 **104 处**散文引用按**旧章节号**指向本文件
（`AGENTS.md §3.5`、`AGENTS.md §6.2` …）。那些编号在 ADR、计划、BLOCKED.md 里被引用了几个月，
**改编号 = 一次全仓改稿**，而改稿一定会漏。

所以这里保留一张**旧号 → 新位置**的对照表：旧号**继续有效**，只是内容搬了家。
`pnpm check:docs` 会解析下面的小节标题，因此 `AGENTS.md §3.5` 这类引用**仍然解析得到**。

| 编号 | 原内容 | 现在在哪 |
|---|---|---|
| 3.1 | 可维护性门槛 | [`hard-constraints.md`](docs/agents/hard-constraints.md) §3.1 |
| 3.2 | 许可证 | [`hard-constraints.md`](docs/agents/hard-constraints.md) §3.2 |
| 3.3 | schema 与持久化字段 | [`hard-constraints.md`](docs/agents/hard-constraints.md) §3.3 |
| 3.4 | op-log 纪律 | [`hard-constraints.md`](docs/agents/hard-constraints.md) §3.4 |
| 3.5 | 宿主外壳的边界（`packages/app-host`） | [`hard-constraints.md`](docs/agents/hard-constraints.md) §3.5 |
| 4 | 数据库迁移纪律 | [`db-migrations.md`](docs/agents/db-migrations.md) |
| 5 | 设计系统（UI 代码必读） | [`design-system.md`](docs/agents/design-system.md) |
| 6 | 常用命令 | [`commands.md`](docs/agents/commands.md) |
| 6.1 | 多端构建 | [`multi-end-build.md`](docs/agents/multi-end-build.md) |
| 6.1.1 | 固定收尾流程：清旧包 → 重打 → 四端重装 | [`multi-end-build.md`](docs/agents/multi-end-build.md) |
| 6.2 | 界面验收：**硬性规定** | [`ui-acceptance.md`](docs/agents/ui-acceptance.md) |
| 7 | 环境陷阱（索引） | [`environment-traps-index.md`](docs/agents/environment-traps-index.md) |
| 8 | 工作流 | [`workflow-rules.md`](docs/agents/workflow-rules.md) |
| 9 | 当前进度 | [`progress-log.md`](docs/agents/progress-log.md) |

🔴 **这张表是**机器可读**的，不是给人看的散文**：`pnpm check:docs` 的 `sectionNumbers()`
把"`| 编号 | 标题 |`"形状的表格行当成章节登记（`docs/research/feature-matrix.md` 就是这么用的）。
所以**第一列必须是裸编号**（`3.1`，**不许写 `§3.1`**）—— 带上 `§` 它就不再是一行章节登记，
那 104 处引用会立刻变回死链。第二列是标题（供 `§3.5 宿主外壳的边界` 这种带标题的引用比对前缀）。

> 🔴 **不要删这张表。** 它是 104 处既有引用的**唯一**解析依据 ——
> 删掉它，那些引用会一起变成死链，而**只有 `pnpm check:docs` 会告诉你**。
> ⚠️ 反过来说：**新写的引用请直接指向 `docs/agents/<file>.md`**，不要再用旧号。

---

## 5. 环境陷阱（入口）

**全部正文在 [`docs/reference/environment-traps.md`](docs/reference/environment-traps.md)** ——
实测踩过、且会复现的坑，编号只增不改；正文里引用写「§7 #N」。
号段索引与三条**元规则**（先怀疑探针 / 一条永远通过的判据比没有判据更糟 /
"测试全绿 ≠ 这是当前产物"）在 [`docs/agents/environment-traps-index.md`](docs/agents/environment-traps-index.md)。

⚠️ **本文件不写条数**（写过一次"83 条"，六天后就漂了）。要现量：
`grep -cE '^[0-9]+\. ' docs/reference/environment-traps.md`。

**新的条目追加到 traps 文件末尾**（编号递增），不要写回本文件。

---

## 6. 工作流（入口）

**25 条工作流纪律的全文在 [`docs/agents/workflow-rules.md`](docs/agents/workflow-rules.md)。**
最常被违反的四条先列在这里：

1. **改代码前先读相关的 ADR 与计划**：决策不可逆层（`packages/shared-schema`、线协议、迁移）时尤其。
2. **测试要能失败**：新增门禁/校验时，先确认它在违规输入下真的会红。**不能失败的检查没有价值。**
3. **不要为了让测试变绿而改测试**。如果是数据/模型的问题，改模型。
4. **过程经验写回原入口**：可复用约束融入 `docs/agents/` 对应规则；具体事故追加到
   [环境陷阱](docs/reference/environment-traps.md)；实现状态写回原计划与 ADR。

---

## 7. 当前进度（入口）

| 阶段 | 状态 |
|---|---|
| P0 奠基 | ✅ 已完成 |
| P1 单端闭环 | ✅ **已完成**（`pnpm verify:p1` 的零 mock E2E；**条数由脚本自己打印，别在这里抄**） |
| P2 多端补齐 | 🔄 **进行中** |
| P3 平台特性 | ⏸ |

**完整阶段表、并行轨道状态与全部已知边界在 [`docs/agents/progress-log.md`](docs/agents/progress-log.md)。**
总路线图：[`docs/plans/roadmap.md`](docs/plans/roadmap.md)。

🔴 **"会收钱不交付"这条线现在的事实源在
[`ADR-0054`](docs/adr/0054-managed-ai-retention-and-selling-preconditions.md) §6/§8/§9**：
旧的"计量存在之前不得售卖 ¥12 档"那条红线（ADR-0023）**已被 0054 按顺序解除** ——
计量、代理路由、白名单、设置页的托管开关都已落地，`NOT_YET_DELIVERABLE_SKUS` 现为空。
本文件**不复述它的状态**（那是一份会漂的抄件）；这一档还没做到的事以 0054 那三节为准。

---

## 8. 本文件的历史

本文件原先是一份 **131,843 字节（128.8 KiB）** 的单体规则文件，超出 Codex
`project_doc_max_bytes` 默认值（32 KiB）**4.0 倍** ⇒ **约 3/4 的内容从未被任何 agent 读到过**。

2026-10-12 按**作用域**拆成 `docs/agents/` 下的多份文件，**内容零删除**。
原始全文备份在同目录 `AGENTS.md.bak-full-2026-10-12`（sha256 `9ab3b872…`），
用于核对拆分是否丢内容。
