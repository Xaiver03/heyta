# 开源复用调研（v1.0 · 实测版）

> 数据核实时间：**2026-09-25**，全部为当日实测（`raw.githubusercontent.com` 的 LICENSE 原文 + 仓库页 + 提交流），非记忆。
> 图例：✅ 具备 / ❌ 缺失 / ⚠️ 有条件
> 完整原始报告见 [`research/oss-task-manager-deep-dive.md`](../research/oss-task-manager-deep-dive.md)（16 个项目逐一深挖）

---

## 0. 结论先行

**滴答清单的六个付费卖点（四象限 / 番茄钟 / 习惯打卡 / 自然语言日期 / 全平台 App / 日历同步）——有一个开源项目全部命中了。**

| 项目 | Stars | License | 四象限 | 番茄钟 | 习惯 | NLP 日期 | 全平台 App | 日历同步 |
|---|---|---|---|---|---|---|---|---|
| **Super Productivity** | **22.2k** | **MIT** | ✅ | ✅ | ✅ | ✅ | ✅ 含 iOS/Android | ✅ CalDAV + Google/Outlook |
| **Tududi** | 3.4k | **MIT** | ✅ | ✅ | ✅ | ❌ | ❌ 仅 PWA | ✅ CalDAV 双向 |
| Vikunja | 5.5k | AGPL-3.0 | ❌ | ❌ | ❌ | ✅ | ⚠️ Android alpha | ⚠️ CalDAV alpha |
| 其余 13 个 | — | — | ❌ | ❌ | ❌ | ❌ | — | — |

**关键结论：功能最全的两个项目，恰好都是 MIT。** 这意味着——**你不需要在"闭源"和"复用"之间取舍了。**

---

## 1. 🥇 Super Productivity —— 唯一全中

| 项 | 值 |
|---|---|
| 仓库 | `super-productivity/super-productivity`（分支 `master`） |
| Stars | **22,240**（2026-09-25） |
| **License** | **MIT**（Copyright (c) 2018 Johannes Millan） |
| 栈 | Angular + NgRx（TS）· Electron 桌面 · Capacitor 移动端 · IndexedDB 本地 |
| 最近提交 | 2026-09-24 ✅ 活跃 |
| 平台 | Web PWA / Windows / macOS / Linux / **Android（Play + F-Droid）/ iOS（App Store）** |

**已具备**（源码级核实）：
- 任务 / 项目 / 标签 / 子任务 / 优先级 / 重复任务 / 提醒
- **四象限**（内置 `EISENHOWER_MATRIX` 板）
- **番茄钟 + 专注模式**（`features/focus-mode`）
- **习惯打卡**（`pages/habit-page` 实测存在 ← 我上一版文档写"完全没有"是错的）
- 看板（`features/boards`）、Schedule + Planner 时间盒视图
- **自然语言日期**（Chrono：`@4pm`、`@every 2 weeks`）
- **CalDAV VTODO 可配置 pull / push / both**；Google Calendar / Outlook 365 集成
- 本地优先 + **可自建同步服务**（`packages/super-sync-server`，支持 E2E 加密）

**缺失**：
- ❌ **没有真正的服务端多用户协作/团队能力**（只有它自有的 Plainspace 共享空间）
- ⚠️ 移动端是 Capacitor 套壳，非原生
- ⚠️ 跨设备实时协同弱于滴答清单

**复用难度**：MIT 无任何商用/闭源/换皮限制。
⚠️ **主要障碍是体量**：约百万行级 TypeScript，且围绕 **op-log（操作日志）同步引擎深度耦合**的单体架构。
→ **对策：fork 后做减法**（收敛 UI 到个人场景），复用它的 `super-sync-server`，**不要动核心同步引擎**。

---

## 2. 🥈 Tududi —— MIT 里的小而全

| 项 | 值 |
|---|---|
| 仓库 | `chrisvel/tududi`（分支 `main`） |
| Stars | **3,385** |
| **License** | **MIT** |
| 栈 | Node.js + Express + Sequelize · React + TS · SQLite（单文件）/ PostgreSQL · Docker |
| 最近提交 | 2026-09-25 ✅ 最活跃之一 |

**已具备**：层级化任务/项目/领域/笔记/标签、子任务、优先级、重复任务、看板、**日/周/月日历视图**、**四象限**（`EisenhowerMatrix.tsx`）、**番茄钟**（`PomodoroTimer.tsx`）、**习惯打卡 + streak**（`backend/modules/habits`）、多用户协作/角色、OIDC/SSO、**CalDAV 双向同步**（Nextcloud / Baikal / tasks.org / Apple Reminders，支持 RRULE 与冲突检测）、REST `/api/v1` + Swagger + API Key、MCP server。

**缺失**：**无原生 App（仅 PWA）**、**NLP 日期解析基本没有**、Google/Outlook 仅单向 iCal 订阅、无 webhook / 插件体系。

**复用难度**：代码量小、架构直白、上手快。
⚠️ 风险：**单一维护者**，fork 后基本等于自己接手整个应用。

---

## 3. 🥉 Vikunja —— 服务端标杆，但 AGPL

`go-vikunja/vikunja` · **5,503** stars · **AGPL-3.0-or-later**（`desktop/` 为 GPL-3.0）· Go + Vue · 最近提交 2026-09-24

**优势**：服务端/API 设计最佳、REST v1/v2 + Webhooks + 插件、多用户/团队/共享完整、Docker 自建体验一流。

**劣势**：❌ 无日历视图 / 四象限 / 番茄钟 / 习惯打卡；⚠️ CalDAV 仅 early-alpha 且 **iOS 不可用**。

**结论**：**只借鉴其 API 与数据模型，不要 fork 代码**。除非你整体走开源路线。

---

## 4. 明确不推荐作底座（含避坑理由）

| 项目 | 不推荐原因 |
|---|---|
| **AppFlowy** | ⚠️ **自建后端已商业闭源**——`AppFlowy-Cloud` 已归档，改用 `AppFlowy-SelfHost-Commercial`，许可实测为专有协议（禁止复制/修改/分发、机器绑定 License Key、免费档仅 1 席位）。**自建路线被封死** |
| **AFFiNE** | ⚠️ `packages/backend/server/LICENSE` = AFFiNE EE License，生产使用需付费订阅；README 声称 MIT 与 LICENSE 文件矛盾，**以 LICENSE 为准** |
| **Focalboard** | 已停维护（末次提交 2025-06-11）；源码许可为 AGPL + 例外 或 商业许可的混合体 |
| **Huly** | ⚠️ 主仓 README 原文 "frozen / no longer actively maintained"，**官方托管已停服**；继任仓仅 34★；自建需 8–16GB 内存 |
| **Leantime** | open-core 是**结构性**的：`app/Plugins` 指向私有 submodule；**重复任务 $39、番茄钟 $19 是付费插件**；JSON-RPC 非 REST；日历仅单向 |
| **Plane** | 59.9k stars 但开源仓无企业代码；**移动 App 连自建实例官方需 Commercial Edition**（v1.12+）。团队 PM 定位 |
| **Docmost** | 看板在 EE 目录，免费 OSS 版**没有看板** |
| **Lunatask** | **闭源专有**，仓库仅发布产物，不可复用（仅作设计对标） |
| OpenProject / WeKan / Tracks | 团队 PM / 技术栈冷门 / 老 GTD，定位错位 |

---

## 5. 更新后的建议

**上一版我推荐的"Flutter 从零自研"需要修正**——既然 MIT 项目已经把六个卖点全做完了，从零重写是在浪费你最宝贵的资源。

现在的真实选择是：

| 路线 | 做法 | 适合 |
|---|---|---|
| **A. fork Super Productivity** | 做减法 + 补协作 + 换皮 | 想**最快**出可用全平台产品；接受 Angular/百万行体量 |
| **B. fork Tududi** | 补原生壳（Capacitor/Tauri）+ NLP 日期 | 想**完全掌控代码**、底子干净；接受自己接维护 |
| **C. 自研，借鉴两者** | Flutter 重写 | 想长期做成自己的架构；最慢，但无历史包袱 |

**而"闭源"这件事已经不构成取舍了**：A 和 B 都是 MIT，**随便闭源商用**。

---

## 6. 立即可做的技术动作

- [ ] **依赖许可证扫描**：fork MIT 项目后，必须扫描其依赖树。MIT 只覆盖项目自身代码，**依赖里可能混入 GPL/AGPL**，这会直接毁掉闭源计划
- [ ] 精读 Super Productivity 的 `packages/super-sync-server`（自建同步的现成答案）
- [ ] 精读 Tududi 的 CalDAV 实现与冲突检测（你未来也要做）
- [ ] 确认 Super Productivity 的 `pages/habit-page` 完成度（决定习惯模块是复用还是重写）
- [ ] 评估 Angular → 你的技术栈的迁移成本（若是路线 A）

---

## 7. 尚未回答

- [ ] 单点组件库（RRULE 引擎、CalDAV 服务端、推送方案）→ 调研进行中
- [ ] Super Productivity 依赖树的许可证构成 → 需实际 clone 后扫描
- [ ] 两个 MIT 项目的代码质量与测试覆盖度 → 需实际读代码

---

*上一版（v0.1）中的错误数据已全部更正，勘误来源见 `research/oss-task-manager-deep-dive.md` §16。*
