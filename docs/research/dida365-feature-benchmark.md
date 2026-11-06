# 滴答清单功能对标：heyta 的真实缺口

> 状态：**调研记录**（归档层，结论有变时新增勘误、不改原文）
> 审计日期：**2026-09-28**（CST）。heyta 侧每条结论都带 `文件:行号`；未核实的明确标注。
>
> 三份文档的分工，**不要互相抄**：
>
> | 文档 | 负责 |
> |---|---|
> | [feature-matrix.md](feature-matrix.md) | **需求基准线** —— 滴答清单有哪些能力、我们该做到什么程度（草稿 v0.1） |
> | [dida365-help-center-ia.md](dida365-help-center-ia.md) | **滴答侧的实测事实** —— 97 篇帮助目录、FAQ 67 问、定价逐项表、更新动态 |
> | **本文** | **heyta 侧的真实实现状态 + 缺口分级** —— 逐条给代码证据，并挑出"看起来有、其实没有"的项 |
>
> 落地任务与排序见 [../plans/site-and-parity-alignment.md](../plans/site-and-parity-alignment.md)。

---

## 0. 方法、口径与边界

### 0.1 判定口径

| 标记 | 含义 |
|---|---|
| ✅ **已实现** | 有真实生产代码路径，能从 UI / CLI 入口走通 |
| 🟡 **部分实现** | 有数据模型或部分逻辑，但缺入口 / 缺一端 / 缺关键分支 |
| ❌ **未实现** | 找不到任何相关代码 |
| ⛔ **明确不做** | 有 ADR 或计划文档写明不做（是决策，不是遗漏） |

### 0.2 三条必须写在最前面的边界

1. **本文没有跑任何测试、构建或 e2e** —— 只读审计。所有"已验收"均引自
   文档与脚本名，**未重跑**。所以 ✅ 严格来说是"代码路径存在且有验收记录"，
   不是"我这次跑过"。
2. **heyta 侧的证据是 `文件:行号`**；滴答侧的结论**不在本文重复**，
   一律指向 [dida365-help-center-ia.md](dida365-help-center-ia.md)。
3. **"滴答清单有"不等于"heyta 要做"。** 三处结构性差异会改变每一条的结论：
   E2EE（服务端看不到明文）、不按功能收费（[ADR-0020](../adr/0020-ai-subscription-two-tiers.md) §3.2）、
   本地优先（云端不是事实源）。

---

## 1. 结论摘要

heyta 的核心闭环（任务 / 清单 / 标签 / 四象限 / 习惯 / 专注 / 同步 / E2EE / 导出）
**是真实可用的**，而且在若干处比滴答清单更硬（自建、E2EE、不按功能收费、
四象限是派生视图而非第四套存储）。

但对照滴答清单的功能面，缺口集中在**三类**，性质完全不同：

| 类别 | 缺口 | 性质 |
|---|---|---|
| **A. 支柱级缺席** | 提醒、日历（Web）、子任务、搜索、筛选、看板、备注编辑、批量操作 | **产品不完整**，不是"锦上添花" |
| **B. 只做了一半** | 习惯（只能单次打卡）、专注（时长不可配）、重复（Web 无入口）、导出（无 CSV/ICS）、导入（只还原空库） | **模型对了、界面没到**，用户感知不到 |
| **C. 看起来有、其实没有** | 13 项（见 §3） | **最危险** —— 连我们自己的文档都被骗过 |

**最刺眼的一条**：`docs/plans/roadmap.md:40` 写 AI-1 用「`chrono-node` 打底」，
**全仓没有这个依赖**（`packages/domain/package.json` 只有 `shared-schema` + `ical.js`）。
实际是自研正则解析器，只认 `dueDate` 与 `priority` 两个字段。
这不是"实现得不够好"，是**文档描述了一个不存在的实现**。

---

## 2. 逐类对标矩阵

优先级沿用 [feature-matrix.md](feature-matrix.md) 的 `P0 / P1 / P2` 口径。
「滴答侧证据」一列指向 IA 文档，不重复抄。

### 2.1 任务对象模型

| # | 能力 | 滴答有 | heyta 状态 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 1.1 | 标题 / 描述（Markdown） | ✅ | 🟡 | `Task.title` / `Task.note` — `packages/domain/src/entities.ts:85-87`；`setNote` — `packages/app-host/src/actions.ts:462-465` | **没有用户可见的备注输入框**。web 任务行只有标题 `<span>`（`apps/web/src/App.tsx:637`），`setNote` 只被 AI 拆解 / 估时调用（`App.tsx:667,705`）；移动端 `TaskDetailSheet.tsx` 全文 0 处 note。标题是纯文本，无 Markdown 渲染 |
| 1.2 | 子任务（树形、可折叠） | ✅ | ❌ | `Task` **无 `parentId`**（`entities.ts:84-131`）；`- [ ]` 只是写进 `note` 的 Markdown（`packages/app-host/src/ai-breakdown.ts:195-210`） | 无实体、无字段、无折叠树、无独立完成状态。**AI 拆解产出的 checklist 在界面上勾不了、不计入统计** |
| 1.3 | 优先级（无 / 低 / 中 / 高） | ✅ | ✅ | `Priority` — `entities.ts:59-64`；`setPriority` — `actions.ts:436-438`；web `App.tsx:591`；mobile `TaskDetailSheet.tsx:496` | 展示是 `P{n}` 文本，**无四色** |
| 1.4 | 标签（多对多） | ✅ | 🟡 | `Tag` — `entities.ts:151-154`；`setTags`（整组覆盖 + 悬空 id 校验）— `actions.ts:476-500`；web `TaskOrganizer.tsx`；mobile `OrganizerSection.tsx` | **无按标签筛选**（`TaskFilter` 是封闭联合，无 tag 分支 — `apps/web/src/features/tasks/store.ts:53-58`）；无标签管理页 |
| 1.5 | 所属清单（可分组） | ✅ | ✅ | `Project` 含一层 `parentId` — `entities.ts:137-149`；`createProject` — `project-actions.ts:122`；`moveToProject` — `actions.ts:467` | 只有**一层**文件夹；清单删除**无回收站**（回收站只有 TASK，`docs/plans/roadmap.md:381`） |
| 1.6 | 开始时间 + 截止时间 | ✅ | 🟡 | 只有 `dueDate` — `entities.ts:95`；全仓无 `Task.startDate` | **无开始时间 → time blocking 不成立**。时间线视图里的 `startDate` 只是展示参数（`apps/web/src/features/timeline/TimelineView.tsx:87`） |
| 1.7 | 全天 / 定时任务 | ✅ | 🟡 | `dueDate` 是 epoch ms（`entities.ts:95`），数据层能带时间；`localDateTimeToEpoch` — `apps/web/src/features/capture/CaptureComposer.tsx:160` | **UI 只有日期粒度**：移动端 `DatePicker.tsx` 无时间选择；web AI capture 用 `type="date"`（`AiCapture.tsx:594`）。无 all-day 标志 |
| 1.8 | 重复规则（RRULE） | ✅（含法定工作日 / 农历） | 🟡 | `repeatRule` / `repeatDtstart` — `entities.ts:120-128`；ical.js 求值 — `packages/domain/src/recurrence.ts:117-297`；`setRepeat` — `actions.ts:502-521`；4 个预设 — `repeat-presets.ts:37-42`；完成即推进 — `actions.ts:331-348` | ① **web 无重复设置入口**（`setRepeat` 在 `apps/web` 命中 0）；② 无自定义 RRULE / 间隔 / COUNT·UNTIL / 「每月第几个周几」；③ **无农历**；④ 🔴 **「完成后顺延」未实现** —— 实际是**固定排期**（从当前 dueDate 起算），`nextAfterCompletion`（`recurrence.ts:248`）**只有测试调用、无生产调用点** |
| 1.9 | 提醒（一次 / 多次 / 位置） | ✅ **招牌功能** | ❌ | `REMINDER` 是合法实体名（`packages/shared-schema/src/entity-types.ts:31`）但登记为**未物化**，理由写「尚未开始」（`packages/op-log/src/state.ts:142-145`）；`EntityModelMap` 无它（`entities.ts:311-321`） | **无字段、无实体、无调度、无通知，全链路 0** |
| 1.10 | 附件 / 图片 | ✅ | ❌ | 全仓无 attachment 实体与上传路由 | 无对象存储 |
| 1.11 | 评论 / 备注 | ✅ | ❌ | 无 comment 相关代码 | — |
| 1.12 | 完成 / 创建 / 修改时间 | ✅ | ✅ | `createdAt` / `updatedAt` — `entities.ts:28-29`；`completedAt` — `entities.ts:97` | — |
| 1.13 | 回收站（软删 + 恢复） | ✅ | 🟡 | DEL 打墓碑 — `packages/op-log/src/state.ts:199-222`；`remove` / `restore` / `purge` — `actions.ts:393-434`；web `TrashView.tsx`；mobile `TrashScreen.tsx` | **只有 TASK**；PROJECT / TAG 无回收站；`purgedAt` **不是物理擦除**（`entities.ts:42-45` 已写明） |
| 1.14 | 排序（手动拖拽 / 按时间 / 按优先级） | ✅ | 🟡 | `Task.order` 字段存在（`entities.ts:130`）但**零写入路径**；规范顺序 = `createdAt + id`（`actions.ts:571-581`） | **无手动拖拽排序、无排序开关**（唯一拖拽是四象限）。`order` 是**死字段** |

### 2.2 视图

| # | 视图 | 滴答有 | heyta 状态 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 2.1 | 清单视图 | ✅（三栏） | 🟡 | web 扁平列表 — `apps/web/src/App.tsx:613-680`；按清单筛选 — `store.ts:58,295-298`；mobile 分组 overdue/today/inbox/done — `TasksScreen.tsx:317-355` | 无按标签 / 优先级分组；web 列表不分组；**无三栏详情** |
| 2.2 | 今天 / 明天 / 最近 7 天 | ✅ | 🟡 | `{kind:'today'}` — `store.ts:55,284-292`；导航 — `App.tsx:141` | **无「明天」「最近 7 天」**；无 saved query |
| 2.3 | 收集箱 | ✅ | ✅ | `{kind:'all'}` — `App.tsx:140`；`projectId` 缺省即收集箱 — `entities.ts:88` | — |
| 2.4 | 日历视图（日 / 周 / 月 / 议程 / 年） | ✅ **六种** | 🟡 | mobile 月网格 — `apps/mobile/src/screens/CalendarScreen.tsx:188,282,350-369`；`monthGrid` — `packages/domain/src/date.ts:266` | 🔴 **web 完全没有日历视图**（无 `apps/web/src/features/calendar/`）；无周 / 日 / 年 / 议程；**不支持拖拽改期**；无开始时间；**无 dueDate 的任务不可见**（`CalendarScreen.tsx:434-437`） |
| 2.5 | 四象限（艾森豪威尔） | ✅（基础档就有） | ✅ | 派生纯函数 — `packages/domain/src/quadrant.ts:58-129`、`planQuadrantDrop:206-244`；web 拖拽看板 — `QuadrantBoard.tsx:174`（dnd-kit） | 移动端**只读不可拖**；紧迫窗口是**全局常量 2 天**（`quadrant.ts:15`），不可配置；无「四象限规则」编辑（滴答有） |
| 2.6 | 看板（Kanban） | ✅（免费档就有） | ❌ | 全仓 grep `kanban` 仅命中服务端冲突模块的注释 | — |
| 2.7 | 智能清单 / 自定义筛选器 | ✅（**高级会员**） | ❌ | `TaskFilter` 是封闭联合，仅 all / today / completed / quadrant / project — `store.ts:53-58` | 无用户自建查询 |
| 2.8 | 已完成 / 垃圾箱 | ✅ | 🟡 | 垃圾箱可达（web `TrashView.tsx`、mobile `TrashScreen.tsx`）。已完成：filter 类型存在（`store.ts:56`）、空态文案在（`App.tsx:862-864`） | 🔴 **没有任何 UI 能把 filter 设成 completed**（`setFilter` 调用点只有 all / today / quadrant / project）→ **web 上看不到已完成任务** |
| 2.9 | 时间线 / 甘特 | ✅ | ✅（web，个人范围） | `apps/web/src/features/timeline/{TimelineView,GanttChart,buildTimeline}` | 仅 web；非团队甘特；无依赖编辑；数据来自 note 里的 checklist + AI 估时 |
| 2.10 | 搜索 | ✅ | ❌ | 全仓无搜索 UI / 索引；`storage` / `op-log` 无 FTS | 滴答 2026-06 更新还专门升级了搜索 |
| 2.11 | 清单创建对话框（结构化建单：名称 / 清单颜色 / 视图类型（列表·看板·日历）/ 文件夹 / 清单类型 / 「在智能清单显示」+ 右侧实时预览） | ✅ | 🟡 | 滴答侧：2026-10-06 产品负责人提供桌面端「添加清单」对话框截图**口述**（截图未入库，控件形态以当前截图为准）。heyta 侧：`createProject(name, parentId)` 只收名字与父清单 — `packages/app-host/src/project-actions.ts:71,235`；web 新建入口是**只有一个名字输入框的内联表单** — `apps/web/src/features/projects/ProjectsPanel.tsx:235-261`；颜色是**事后**单独动作（`setProjectColor`，`project-actions.ts:86`，存 1–8 槽位非 hex）且**移动端没有清单取色入口**（`ProjectsPanel.tsx:42-43`） | （2026-10-06 补，产品负责人裁决纳入）建议 **P2**，其中**「名字 + 颜色」半步可提前**：色板复用既有 1–8 色槽、含义用户自赋（`packages/domain/src/activity-categories.ts:38-70`），颜色管道已按 `{light,dark}` 解析传递（[../adr/0025-widget-snapshot-confidentiality.md](../adr/0025-widget-snapshot-confidentiality.md) §2.4）。**视图类型与「在智能清单显示」依赖 IA 拍板，不是独立 UX 工单** —— heyta 的四象限/时间线是全局 rail 视图、非清单级属性（[ADR-0015](../adr/0015-four-quadrant-as-derived-view.md)），过滤器实体尚不存在（同表 2.7 / P1-2）；拍板项登记在 [product-level-ia-ux-audit.md](product-level-ia-ux-audit.md) §3.3 第三条。实时预览 = 纯打磨，P3 |

### 2.3 习惯打卡

| # | 能力 | 滴答有 | heyta 状态 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 3.1 | 创建（名称 / 图标 / 颜色 / 频率） | ✅ | 🟡 | `Habit` 模型完整（target / unit / goalType / frequency / color / backfillDays）— `entities.ts:208-224`；`createHabit` — `habit-actions.ts:137-151` | 创建表单**只有名字**（`HabitsView.tsx:72`，表单 `:86-116`）；`NewHabitFields` 类型里**根本没有 frequency / goalType**（`habit-actions.ts:45-50`）；无图标；🔴 **移动端无建习惯入口** |
| 3.2 | 打卡 / 撤销 | ✅ | 🟡 | 幂等 `checkIn` / `undoCheckIn` — `habit-actions.ts:179-228`；web `HabitsView.tsx:235-237` | **只有 web 能打卡**；移动端无习惯屏 |
| 3.3 | 目标（计数 / 时长 / 单次） | ✅ | 🟡 | `target` / `unit` / `goalType` + `isAchieved` — `packages/domain/src/habit-streak.ts:59-77` | 🔴 **无 UI 设置 target / unit / goalType**；**无 UI 输入 value** → **计数型 / 时长型界面完全不可达**，实际只有单次打卡 |
| 3.4 | streak 与最长记录 | ✅ | ✅ | `computeStreak` — `habit-streak.ts:80-213`；韧性 FREEZE / RESTART / REPAIR — `habit-resilience.ts:49-58` | 我们这里**比滴答更硬**（有冻结 / 续接机制） |
| 3.5 | 热力图 / 月历 | ✅ | 🟡 | web `HabitsView.tsx:354`（react-activity-calendar）+ `selectHeatmap` — `store.ts:192`；年度热力图 — `GrowthView.tsx:123` | **仅 web**；移动端无习惯热力图 |
| 3.6 | 习惯备注 / 日记 | ✅ | 🟡 | `HabitLog.note` — `entities.ts:233` | 无写入 / 展示 UI |
| 3.7 | 统计（完成率 / 趋势） | ✅ | ✅ | `completionRatio` — `habit-streak.ts:215`；`computeHabitResilience` — `habit-resilience.ts:117` | — |
| 3.8 | 提醒 | ✅ | ❌ | 同 1.9 | — |

### 2.4 番茄专注

| # | 能力 | 滴答有 | heyta 状态 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 4.1 | 番茄钟（可自定义时长、长休息） | ✅ | 🟡 | `FocusConfig` 默认 25/5/15、`longBreakEvery=4` — `packages/domain/src/focus.ts:31-36`；状态机 `:73-252` | 🔴 **不可自定义**：web store 有 `setConfig`（`store.ts:90,122,241`）但**零 UI 调用点**；mobile 是常量（`apps/mobile/src/lib/focus-timer.ts:157`）→ 永远 25/5/15 |
| 4.2 | 正计时模式 | ✅ | ❌ | 只有倒计时 — `focus.ts:154-158` | — |
| 4.3 | 专注关联任务 | ✅ | ✅ | `FocusSession.taskId` — `entities.ts:245`；`start(taskId)` — `focus.ts:73-89` | — |
| 4.4 | 白噪音 / 背景音 | ✅ | ❌ | 全仓无音频代码 | — |
| 4.5 | 专注记录与统计 | ✅ | ✅ | 只落工作段 — `focus.ts:354-356`；`focusStatsForDay` — `:381-406`；web `FocusTimer.tsx`；mobile `FocusScreen.tsx` | 无独立周 / 月报表页 |
| 4.6 | 专注模式（屏蔽 App / 白名单） | ✅ | ❌ | 无相关代码 / 原生权限 | **平台受限**（iOS 极严） |
| 4.7 | 番茄目标 / 连续专注天数 | ✅ | ❌ | grep `focusGoal` / `pomodoroStreak` = 0 | — |
| 4.8 | 后台运行与结束通知 | ✅ | ❌ | 剩余时间基于时间戳（`focus.ts:154-158`）切后台仍准确，但**无后台服务、无结束通知**；移动端**没有任何通知库依赖**（`apps/mobile/package.json` 无 notifee / expo-notifications） | — |

### 2.5 笔记

| # | 能力 | 滴答有 | heyta 状态 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 5.1 | Markdown 笔记 | ✅ | 🟡（**只有模型**） | `Note` 实体 — `entities.ts:177-188`；op-log 有 notes 桶 — `state.ts:76`；在 `EntityModelMap` 里 | ⚠️ **本行的原判"零 Action、零 UI、不可创建不可查看"已过期（2026-10-03 逐条核过被否证）**：`packages/app-host/src/note-actions.ts` 有 `createNote`（`:133`）与 `listNotes`（`:91/:217`），界面 `apps/web/src/features/notes/NotesView.tsx` + `apps/mobile/src/screens/NotesSection.tsx` + 共享 `packages/ui/src/notes/NotesBoard.tsx`。🔴 **仍然成立的那半条**：AI 工具目录里**一个 `NOTE` 工具都没有** ⇒ 对 AI 而言确实"不可创建、不可查看"，登记为 `AI-COV-3`（见 [`ai-event-tool-contract.md`](../plans/ai-event-tool-contract.md) §5.1） |

> [feature-matrix.md](feature-matrix.md) 自己建议「MVP 阶段直接不做笔记」。
> 现状是**保留了数据模型却没有任何入口** —— 这属于 §3 的"看起来有、其实没有"。

### 2.6 协作与同步

| # | 能力 | 滴答有 | heyta 状态 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 6.1 | 清单共享（邀请成员） | ✅ | ✅ | 邀请凭证 + 成员角色 + 所有权转让：服务端 — `server/src/shares/share.routes.ts`；面板 — `packages/ui/src/sync/SharePanel.tsx`；E2EE 入群信封 — `packages/sync-client/src/share-payload-cipher.ts`；真实旅程 — `pnpm verify:collab-journey`（`RESULT=OK steps=3`）。这一格在 2026-10-22 04:1x 之前**是不合格的**（那时转让那一步**不校验接手人手里有没有密钥**，而"接受邀请"落库的成员默认就是 `keyEnvelope: null` —— 缺陷与修法登记在 [collaboration-shared-lists.md](../plans/collaboration-shared-lists.md) §6 的 **B-10**）。**2026-10-22 04:1x 这一格改成合格**：服务端 `POST /shares/:id/transfer` 对"信封为空或世代落后"的目标回具名 409 `SHARE_TRANSFER_TARGET_UNSEALED`，成员面板对不合格成员不给转让按钮（判据 `packages/ui/src/sync/share-model.ts` 的 `memberCanHoldOwnership`，验收 `cd server && npx vitest run tests/share-routes.spec.ts` 与 `cd apps/web && npx vitest run tests/share-panel-transfer.spec.tsx`）；owner 侧 `autoSeal` 会自动补封信封，所以这不是把转让钉死，见 B-10 那一行的可达性读数 | ✅ **多人并发写同一条任务的写路径路由已建**（2026-10-23 M2，[ADR-0067](../adr/0067-shared-list-write-routing-and-merge.md)：按所属清单 `shareId` 是否在册分流，并发同字段复用现有冲突界面，读数在本线计划 §9.11）；评论**在 Web 与桌面壳两侧都到得了**（反查 `grep -rln "ShareCommentsSection" apps`），**移动端那一节还没挂**；指派与动态流的界面仍未建（见 6.2）；共享 op 的**逐 op 签名**（M4）还没做 —— 它动的是不可逆层，要先过 ADR |
| 6.2 | 任务指派 | ✅ | ❌ | 同上 | — |
| 6.3 | 评论 | ✅ | ✅ | 共享清单里的评论区：组件 — `packages/ui/src/sync/CommentThread.tsx`；宿主写路径与下行 — `packages/app-host/src/share-comments.ts`；挂载 — `apps/web` 的任务详情（反查 `grep -rln "ShareCommentsSection" apps`）；宿主层两实例互拉 + WS 扇出 + 任务/便签/评论三族进共享日志 — `pnpm verify:collab-sync`（`RESULT=OK`，步数由脚本自己打印，别在这里抄）；**两台真浏览器里成员互相看得到对方的改动** — `pnpm verify:collab-journey` 第 9 段（2026-10-23 M2）。⚠️ 那一格里"两个无界面宿主实例"与"两台开着界面的浏览器"是**两层**，混读会把前者当成用户可见（教训见 [collaboration-shared-lists.md](../plans/collaboration-shared-lists.md) §9.11 与环境陷阱 #535） | 移动端还没挂这一节（M6）；这一格 2026-10-22 之前写的是"🟡 成员那侧进不去评论区" —— 那是当时的读数，现在不成立，别照它施工 |
| 6.4 | 多设备同步 | ✅（实时） | 🟡 | 协议完整 — `server/src/sync/sync.routes.ts:108-415`；客户端 — `packages/sync-client/src/client.ts:824,1246`；真实多端验收 — `e2e/multi-end/*` + `pnpm verify:multi-end`；服务端 WS 广播 — `websocket.routes.ts:39` | **两条信号都已经有宿主在接**（反查 `grep -rn "createHostRealtimeClient(" apps packages`）：个人那条 `new_ops` → 跑一次普通同步（Web 与移动端各自接上），共享清单那条 `new_share_ops` → 由宿主判断该不该拉、拉到后由 `@heyta/ui` 那条谓词决定要不要吵（2026-10-21 M5，读数见 [collaboration-shared-lists.md](../plans/collaboration-shared-lists.md) §9.10）。留 🟡 的理由只剩一格：**移动端有信号但没有评论区**，且这条链上"装到四端"还没做过（§6.1.1 那一格本轮没跑）|
| 6.5 | 离线可用 | ✅ | ✅ | dispatch 先落盘再改内存 — `packages/op-log/src/engine.ts:233-246`；web 默认 SQLite-over-OPFS — `apps/web/src/lib/oplog.ts:66-70` | — |
| 6.6 | 冲突解决 | ✅ | ✅ | 实体级 LWW + 手动选择；服务端冲突类型 — `sync.types.ts:145-149`；web `ConflictDialog.tsx:190`；mobile `ConflictSheet.tsx` | 非 CRDT、非字段级；同一实体的整字段集被一个 op 覆盖（**这是设计选择，不是缺陷** —— 见 [../adr/0008](../adr/0008-vector-clock-limit.md) 系列） |
| 6.7 | 分享清单为链接 | ✅ | ✅ | owner 生成入群链接（`?shareToken=`），朋友点开直接进加入流程、消费后把 token 摘出地址栏：构造 — `packages/ui/src/sync/share-link.ts`；落点 — `apps/web/src/features/share/join-link.ts` | 落点仅 Web 已接；移动端入群入口未接 |

### 2.7 日历集成

| # | 能力 | 滴答有 | heyta 状态 | 证据 |
|---|---|---|---|---|
| 7.1 | ICS 订阅（只读） | ✅（Google / iCloud / Outlook / Exchange / 企业微信 / URL…） | ❌ | 全仓无 `BEGIN:VCALENDAR` / `text/calendar` / `webcal` |
| 7.2 | Google / Outlook 双向 | ✅ | ❌ | 无 OAuth 相关代码 |
| 7.3 | CalDAV | ✅（企业微信必须走它） | ❌ | grep `caldav` = 0 |
| 7.4 | 导出 ICS | ✅ | ❌ | `ical.js` **只用于 RRULE**（`recurrence.ts:21,46,69`），无 `ICAL.parse` / VEVENT |

> [feature-matrix.md](feature-matrix.md) 判断 **7.1「成本低、收益高，建议早做」** ——
> 这条判断到今天仍然成立，且**它是滴答帮助中心里踩坑最多的一块**
> （见 IA 文档的 FAQ 分组「日历」6 问 + 企业微信订阅失败）。
> 对我们反而是机会：**做好一家、做对一家，比铺七家更值**。

### 2.8 输入效率

| # | 能力 | 滴答有 | heyta 状态 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 8.1 | 自然语言解析 | ✅ | 🟡 | 自研规则解析 `parseCapture` — `packages/domain/src/capture.ts:430`；**字段只有 `dueDate` + `priority`**（`capture.ts:47`）；web 入口 `CaptureComposer.tsx:113` | 🔴 **没有 `chrono-node`**（`packages/domain/package.json` 只有 `shared-schema` + `ical.js`）—— 与 `docs/plans/roadmap.md:40`「`chrono-node` 打底」**矛盾**。不识别**时间点** / `#标签` / `~时长` / 清单；**移动端完全没有 NL 入口** |
| 8.2 | 语音输入 | ✅（2026-04 上 AI 语音） | ❌ | 无 ASR / 麦克风代码 | — |
| 8.3 | 快捷添加（全局快捷键 / 悬浮球 / 小组件） | ✅ | 🟡 | 小组件四端代码齐全（Android Kotlin provider + manifest、iOS WidgetKit / 锁屏 / 手表 / 灵动岛、Harmony ArkTS、Windows Adaptive Card、web PWA manifest widgets） | 🔴 **无全局快捷键**（`apps/desktop` 无 `globalShortcut`）；无悬浮球；**小组件真机验收 0 项** |
| 8.4 | 分享面板接收 | ✅ | ❌ | Android manifest 只有 MAIN/LAUNCHER（无 SEND intent-filter）；PWA manifest 无 `share_target`；无 Share Extension | — |
| 8.5 | 批量操作 | ✅ | ❌ | grep `multiSelect` / `bulk` / `selectedIds` / `selectAll` = 0 | — |

### 2.9 客户端与平台

| # | 平台 | 滴答 | heyta 状态 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 9.1 | Web | ✅ | ✅ | `apps/web`；视图 tasks / quadrant / habits / focus / timeline / growth / trash / settings — `App.tsx:152-172`；已部署 `https://heyta.finlaw.cloud/app/` | 无日历、无搜索、无看板、无备注编辑、无重复规则编辑、无「已完成」入口 |
| 9.2 | iOS | ✅ | 🟡 | 真实 RN iOS 工程；Release 模拟器构建到交互级 + `pnpm verify:mobile-ios` **36 项零 mock** | **未上真机**（需签名）；ATS 未实测；小组件 / 手表 / 锁屏 / 灵动岛**代码已写但真机 0 验** |
| 9.3 | Android | ✅ | ✅ | **实机跑通**；四款小组件 provider 齐全 | 小组件真机验收未做；签名「不是发布配置」 |
| 9.4 | 桌面（Windows / macOS / Linux） | ✅ | 🟡 | Electron 壳存在（`apps/desktop/src/{main,preload,host,ipc-contract}.ts`）；**三平台可分发包已产出**（`release/heyta-{darwin-arm64,win32-x64,linux-x64}`，由 `scripts/package-desktop.mjs`） | 🔴 **渲染进程是占位** —— `apps/desktop/renderer/main.tsx:5-24` 自述是「共享 UI 垂直切片」，只有一个 TaskList + 硬编码中文。**未签名 / 未公证 / 无安装器 / 无自动更新**（脚本明确声明不覆盖）。无全局快捷键 / 托盘 / 通知 / 自启 / 深链 |
| 9.5 | 小组件 | ✅ | 🟡（**代码 ✅ / 真机 🧪 0**） | 四款（today / quadrant / habits / focus）× 多端实现 + 意图回写闭环（`packages/widget-core/src/intents.ts` → `app-host/widget-actions.ts` → drain） | **真机验收 0 项**；Windows Edge 本地 PWA 能否出组件**未实测**（自述「唯一可能推翻整条路的单点」）；习惯行只读不能打卡 |
| 9.6 | 通知系统 | ✅（App + 微信 + 持续提醒） | 🟡 | 服务端 Web Push **完整**（RFC8030 + RFC8291 + RFC8292，自研零依赖，`server/src/push/*`）；路由 `/api/push/{vapid-public-key,subscribe}`；上传后触发 — `sync.routes.ops-handler.ts:389` | 🔴 **无任何本地通知**（全仓 grep `showNotification` / `new Notification(` / notifee = **0**）；唯一载荷是 `{"type":"heyta:widget-refresh"}`（`notify.ts:43`）→ **`/api/push` 只服务小组件刷新，不产生用户可见提醒** |
| 9.7 | 鸿蒙 | ✅ | ⛔/🟡 | 构建链已实测打通（20 MB release HAP、双 ABI）；但 🔴 **`apps/mobile/harmony/entry/src/main/ets/pages/Index.ets` 不是共享 UI 的挂载点** —— RN/RNOH 的 JS 应用**根本没有接进去**（📌 **2026-10-16 更正**：这句原来还说"只有 22 行、内容是 DevEco 模板 `Hello World`" —— **已不成立**：该文件现在是 **173 行**，实现的是**鸿蒙小组件的写路径**（`sealSnapshot` → `writeSnapshot`、登出清理、状态显示）。**但结论没变**：`EntryAbility.ets:21` 载入的就是这一页，而 `apps/mobile/harmony` 里**只有这一个 page**、**没有 RN bundle、也没有 RNOH 接线** ⇒ 那个工程今天是一个**小组件套件**，不是可用的鸿蒙应用） | 缺模拟器镜像 + 签名（产物 unsigned）。**"能出 HAP"与"应用能跑"是两件事** |

### 2.10 数据与迁移

| # | 能力 | 滴答有 | heyta 状态 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 10.1 | 从滴答清单 / Todoist 导入 | ✅（「从其他应用导入」） | ❌ | 全仓无 ticktick / todoist / csv 导入代码 | 🔴 [feature-matrix.md](feature-matrix.md) 称这是「**最有效的获客手段**」，而它是**零** |
| 10.2 | 全量导出（JSON / CSV / ICS） | ✅ | 🟡 | JSON（含墓碑 + 完整 op-log + 可核对 counts）与 Markdown — `packages/app-host/src/export-dump.ts:224`；入口 web `ExportPanel.tsx`、mobile `ExportScreen.tsx`、CLI `apps/node-host/src/cli.ts:380` | **无 CSV、无 ICS**；导入只支持**还原到空库**（`import-dump.ts:266-273` 硬闸：目标非空直接拒绝 —— **这是有意的产品结论，不是排期**） |
| 10.3 | 本地优先 | — | ✅ | 同 6.5 | — |
| 10.4 | 自建服务器（Docker） | ❌（它不提供） | 🟡 | `server/docker-compose.yml`（app + Postgres + Caddy，**不需要 Redis / S3**）；`Dockerfile`；`scripts/deploy.sh`；[../runbooks/deployment.md](../runbooks/deployment.md) | **不是「一键」**：必须手写 `.env`，`JWT_SECRET` / `POSTGRES_PASSWORD` **无默认值**；镜像默认本地构建 `supersync:local`，**仓库里没有已发布的 heyta 镜像**；启动默认不跑迁移 |
| 10.5 | 端到端加密 | ❌（它不做） | ✅ | `packages/sync-core/src/encryption.ts`（Argon2id + AES-GCM）；客户端加密并置 `isPayloadEncrypted`；服务端**强制密文** ingress → 400 `E2EE_REQUIRED`（`server/src/sync/sync.routes.payload.ts:47-48`） | **只有 op payload 加密**；元数据（entityType / entityId / vectorClock / timestamp / clientId）服务端明文可见。**宣传时不能说"服务端什么都看不到"** |

### 2.11 明确不做（反需求）

| 项 | 状态 | 依据 |
|---|---|---|
| 团队项目管理 / 工时审批 | ⛔ | 个人时间线在；跨用户聚合被定为「结构上不可能」（[../plans/roadmap.md](../plans/roadmap.md) §1.2） |
| 内嵌 AI 聊天助手 | ⛔ | 唯一 AI 形态是 4 个一次性功能（`packages/ai/src/egress.ts:42-50`），无 chat |
| 社交 / 排行榜 / 联赛 | ⛔ | E2EE + 本地优先下**没有可信汇总方**（[ADR-0022](../adr/0022-resilience-state-stays-derived.md)） |
| 发行货币 / 付费冻结 | ⛔ | [ADR-0022](../adr/0022-resilience-state-stays-derived.md)；「冻结余额不上界面、不加持久化字段」 |
| 微信提醒 / 微信助手 | ⛔ | 与 E2EE 冲突（服务端要读明文）。**这条以前挂在路线图上吊着，应当明确进"不做"清单** |
| 40+ 主题 / 清单背景 | ⛔ | 设计系统只有语义 token（`Note` 实体已明确否决自由 hex） |
| 位置提醒 | ⛔（暂缓） | 滴答仅 iOS 有；成本高、隐私面大，优先级低于 1.9 的基础提醒 |

---

## 3. 🔴 撞名与幻觉清单：看起来有、其实没有

**这是本文最有价值的一节。** 以下 13 项都曾在某个时刻骗过至少一份文档，
或者会在下一次讨论里骗到人。每一项都给了"为什么容易误判"。

| # | 看起来有 | 实际 | 为什么容易误判 |
|---|---|---|---|
| 1 | **任务提醒** | 无字段、无 UI、无调度 | `REMINDER` 是**合法实体名**（`entity-types.ts:31`），读起来像"已经建模" |
| 2 | **用户可见通知** | 无 `showNotification`，推送只刷新小组件 | 服务端 Web Push 实现得**相当完整**（三个 RFC 自研），极易读成"通知做完了" |
| 3 | **子任务** | 无 `parentId`；`- [ ]` 只是 note 里的 Markdown | AI 拆解**会产出** `- [ ]`，看起来就像子任务；界面上勾不了 |
| 4 | **任务备注 / 描述** | 无用户输入框 | `Task.note` 存在且**会被导出**，只有 AI 会写它 |
| 5 | **Web 日历视图** | `apps/web` 里没有日历 | 移动端有 `CalendarScreen`；"日历"被列为产品四大支柱之一 |
| 6 | **「已完成」视图** | 无任何按钮能切过去 | filter 类型、空态文案**都在**（`store.ts:56`、`App.tsx:862-864`） |
| 7 | **手动排序** | `Task.order` 零写入路径 | 字段在，看起来支持 |
| 8 | **番茄钟自定义时长** | `setConfig` 零 UI 调用 | `FocusConfig` 与 `store.setConfig` 都在 |
| 9 | **习惯计数型 / 时长型** | 界面不可达，只能单次打卡 | 模型有 `target`/`unit`/`goalType`，`isAchieved` **三种口径都实现了** |
| 10 | **「实时」多设备同步** | 没有客户端连 WebSocket | 服务端 WS 广播、连接服务、快照通知**全写好了** |
| 11 | **桌面端** | 渲染进程是占位（一个 TaskList） | Electron 壳 + 打包脚本 + **三平台分发包真的在 `release/`** |
| 12 | **笔记模块** | ⚠️ 原判"零 Action、零 UI"**已过期**（2026-10-03 核过：`note-actions.ts:133/:217` 有 `createNote`/`listNotes`，web + mobile + 共享 `NotesBoard` 都有界面）；**当天连 AI 侧那一米也已补**：`NOTE` 现有 `list_notes` / `get_note` / `create_note` / `update_note` 四条（原登记的 `AI-COV-3` 缺口已关闭） | `Note` 实体 + op-log 桶 + 类型映射**齐全** |
| 13 | **鸿蒙** | `Index.ets` 是 22 行 DevEco 模板，RN 没接进去 | `pnpm verify:harmony-toolchain` **真的**打出了 20 MB release HAP |

> **共同形状**：**基础设施做完了，最后一米没接。**
> 这不是懒 —— 每一层单独看都是对的、都有测试。缺的是**"用户能不能真的用到"**
> 这一道判据，而仓库现有门禁**一条都发现不了它**
> （对照 [../plans/roadmap.md](../plans/roadmap.md) §5.1.1 的同类教训：
> "没有任何一道门禁能发现功能是空的"）。

### 3.1 一条可以复用的判据

对任何"X 做完了吗"的问题，**不要问"有没有实体/字段/协议"，要问三件事**：

1. **有没有 `app-host` 的 action？**（业务语义层 —— 没有它，UI 一定绕过了 op-log）
2. **有没有宿主的调用点？**（`apps/web` / `apps/mobile` / CLI —— 没有它，用户碰不到）
3. **有没有一条从用户动作出发的验收？**（`pnpm verify:*` / e2e —— 没有它，前两条都可能只是"看起来对"）

**三问全过才算做完。** 上面 13 项全部卡在第 2 或第 3 问。

---

## 4. 文档与代码的矛盾（本身就是待修任务）

这些不是功能缺口，是**知识漂移** —— 而且它的危险在于：
**下一个人会照着过期的那份做决定**。

### 4.1 文档说"有"，代码没有

| # | 文档 | 声称 | 实际 |
|---|---|---|---|
| 1 | `docs/plans/roadmap.md:40` | AI-1 用「`chrono-node` 打底」 | 🔴 **全仓无此依赖**，实际是自研正则（`packages/domain/src/capture.ts`） |
| 2 | `docs/plans/roadmap.md:66` | L3「分享卡 ✅ 已实现」 | 代码里**刻意不做图片分享卡**（`apps/web/src/features/motivation/copy.ts:102` 原话），只有纯文本 `buildShareSummary` |
| 3 | [ADR-0018](../adr/0018-adjustable-pricing-and-coupons.md) §4.1 | `expireStaleOrders` **必须作为定时任务运行** | 该函数（`server/src/billing/pricing-store.ts:1079`）**零调用者**（TS / 脚本 / YAML / JSON 全查过） |
| 4 | [ADR-0021](../adr/0021-managed-ai-model-deepseek-flash.md) | 托管 AI 模型 = `deepseek-flash` | `server/src` 里 `deepseek` **0 命中**，无客户端、无调用（这是 [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) 的**已知状态**，但 ADR-0021 正文没有互相指引） |
| 5 | `packages/domain/src/entities.ts:66-72` | 「象限是 TASK 的**存储字段**，不是派生视图」 | 🔴 **与 [ADR-0015](../adr/0015-four-quadrant-as-derived-view.md) 及实际代码矛盾** —— `Task` 无 `quadrant` 字段、无写入。这是**陈旧注释** |
| 6 | `docs/reference/build-matrix.md` §4 | Windows 桌面「🔲 方向未定」 | [ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md) 已**接受 Electron**，且 `apps/desktop` 已存在 |
| 7 | `server/README.md:48-62` | 快速开始用上游路径 `packages/super-sync-server` | 实际是 `server/` |

### 4.2 文档说"没做"，代码其实有（陈旧记载）

| # | 文档 | 声称 | 实际 |
|---|---|---|---|
| 8 | `AGENTS.md:2298` | 用户自助**增删凭据**「没有 UI 也没有端点」 | **有**：`apps/web/src/features/settings/PasskeyPanel.tsx:377-403` + `api.ts:690,747` |
| 9 | `AGENTS.md:2304-2306` | 移动端成长体系「**没在真机/模拟器上验过**」 | [../plans/roadmap.md](../plans/roadmap.md):382 记着**已在 iOS 模拟器实跑并截图（浅色 + 深色）** —— 🔴 **两份规则文件互相矛盾** |
| 10 | [ADR-0029](../adr/0029-refuse-to-delete-last-passkey.md) §4 | 「没有做改名 / `Passkey` 表没有 `name` 列」 | **已有** `name` 列 + `renameUserPasskey` + `PATCH /api/passkeys/:id` |
| 11 | `README.md:35-37`、`roadmap.md:353-356` | 「导出入口只在 Web 设置页与 node-host，**移动端还没有**」「还**没有导入**」 | **移动端导出已有**（`ExportScreen.tsx`，入口 `ProfileScreen.tsx:306`）；**导入已有**（`ImportPanel.tsx` + CLI `import`） |
| 12 | `roadmap.md:44` | AI-5 写「全量导出 ❌ 未实现」 | 同一文件 `:373` 又写「✅ 2026-09-27 已实现」—— **自相矛盾**（`:44` 是旧的） |
| 13 | `roadmap.md:30`、`:375` | P3「小组件 / 通知 / CalDAV **未开工**」 | 小组件**四端代码已全部写完**（只是真机未验）；CalDAV 确实没开工 |

### 4.3 处理原则

- **ADR 不可改**（[../README.md](../README.md) 文档规则）。§4.1 里涉及 ADR 的两条（#3、#4）
  应当**新增勘误 / 取代关系**，而不是改原文。
- **`AGENTS.md` 与 `roadmap.md` 可以改**，而且**必须改** ——
  它们是新会话的第一入口，漂移在这里的代价最大。
- 🔴 **优先级最高的两条是 #1 与 #5**：
  #1 会让人以为 NLP 有个成熟库在打底（实际是自研正则，能力窄得多）；
  #5 会让人以为象限是存储字段（会让下一个人去加字段，直接违反 ADR-0015）。

---

## 5. 我们的独有能力（站点"能力回填"的素材）

对标不是单向的。以下能力**滴答清单没有**，而落地页**一个字都没提**：

| # | 能力 | 证据 | 为什么值钱 |
|---|---|---|---|
| 1 | **端到端加密同步** | 服务端**强制密文** ingress，明文一律 400 `E2EE_REQUIRED` | 滴答做不到（它的服务端要读明文做提醒 / 统计 / 搜索） |
| 2 | **自建服务器，永久免费** | `docker compose` 三件套，不需要 Redis / S3 | 滴答**只提供 SaaS**；这是"数据在你自己机器上"的硬保证 |
| 3 | **不按功能收费** | [ADR-0020](../adr/0020-ai-subscription-two-tiers.md) §3.2 + `check-pricing-consistency.mjs` 强制 | 滴答免费档 9 个清单 / 99 个任务；我们**没有功能闸门** |
| 4 | **本机 API + MCP server** | `packages/local-api`，**22 个工具**（读 10 / 写 12；⚠️ 2026-10-03 现量，同日曾先后记成 6 与 9；🔴 **10-04 现量 26 个（读 12 / 写 14）** —— 批次二补了 `EVENT` 那一组，这个数由 `node scripts/gen-ai-capability-manifest.mjs --check` 打印，别手抄），默认关、只监听回环、逐工具授权 | 滴答 2026-04 才上 MCP；我们的**默认关 + 逐工具授权**更严 |
| 5 | **BYOK / 自带推理端点** | `packages/ai`，零厂商 SDK，内置预设只有本地 Ollama / LM Studio | 滴答的 AI 只能用它的云端 |
| 6 | **导出含墓碑与完整 op-log** | `export-dump.ts` —— 含 `counts` 可核对 | "导全了"可被**验证**，而不是靠信 |
| 7 | **四象限是派生视图** | [ADR-0015](../adr/0015-four-quadrant-as-derived-view.md) | 不是第四套存储，不会漂移 |
| 8 | **习惯韧性（冻结 / 续接 / 修复）** | `habit-resilience.ts` | 滴答没有；且我们**不发行货币、不卖"后悔"**（[ADR-0022](../adr/0022-resilience-state-stays-derived.md)） |
| 9 | **冲突解决可视化** | `ConflictDialog` / `ConflictSheet`，双端收敛有 e2e | 实体级 LWW + **用户可见的选择**，不是静默丢数据 |

> 这 9 条是落地页 `/integrations`（或 `/why`）那一页的**骨架**。
> 现在它们全在 `docs/` 里，只有贡献者看得到。

---

## 6. 缺口分级与任务清单

### 6.1 分级口径

| 级别 | 判据 |
|---|---|
| **P0** | 缺了它，"对标滴答清单的替代品"这个定位**不成立** |
| **P1** | 缺了它用户会**明显感到不如滴答**，但有绕法 |
| **P2** | 差异化 / 锦上添花 |
| **⛔** | 明确不做（§2.11） |

### 6.2 P0（产品不成立）

| # | 任务 | 缺口 | 为什么是 P0 |
|---|---|---|---|
| P0-1 | **提醒系统**：`REMINDER` 实体物化 + 调度 + 本地通知 | 全链路 0（§3 #1、#2） | 滴答的**招牌功能**（功能页给了 6 个条目）。一个不会提醒的待办工具，用户第二天就回去用滴答 |
| P0-2 | **Web 日历视图**（周 / 月 + 拖拽改期） | 只有移动端月视图（§2.2 #2.4） | "日历"是我们自己列的四大支柱之一，Web 是主入口 |
| P0-3 | **子任务** | 无 `parentId`（§3 #3） | 任务对象模型的地基；`- [ ]` 的假象必须消除 |
| P0-4 | **任务备注 / 描述编辑** | 无输入框（§3 #4） | 连"写下来"都做不到 |
| P0-5 | **「已完成」入口** | 无按钮（§3 #6） | 最便宜的修复：一个导航项 |
| P0-6 | **搜索** | 全仓 0 | 任务超过 50 条就不可用 |

### 6.3 P1（明显不如）

| # | 任务 | 缺口 |
|---|---|---|
| P1-1 | **从滴答清单 / Todoist 导入** | 零（§2.10 #10.1）—— feature-matrix 称「最有效的获客手段」 |
| P1-2 | **自定义筛选器 / 智能清单** | `TaskFilter` 是封闭联合 |
| P1-3 | **按标签筛选** | 标签能挂不能筛 |
| P1-4 | **批量操作** | 零 |
| P1-5 | **习惯的计数型 / 时长型可达** | 模型有、界面无（§3 #9） |
| P1-6 | **移动端习惯**（建 / 打卡 / 热力图） | 只有 web |
| P1-7 | **重复任务补齐**：Web 入口 + 自定义 RRULE + **「完成后顺延」** | §2.1 #1.8 |
| P1-8 | **番茄钟可配置时长** | `setConfig` 零调用（§3 #8） |
| P1-9 | **手动排序（拖拽）** | `order` 死字段（§3 #7） |
| P1-10 | **开始时间 + 时间点粒度** | 无 `startDate`；UI 只有日期 |
| P1-11 | **ICS 订阅 + 导出 ICS** | 零 |
| P1-12 | **全局快捷键**（桌面） | 零 |
| P1-13 | **分享面板接收** | 零 |
| P1-14 | **Web 看板视图** | 零 |
| P1-15 | **导出 CSV / ICS** | 只有 JSON + Markdown |
| P1-16 | **客户端接 WebSocket（实时同步）** | 已闭合：个人那条 `new_ops` 与共享那条 `new_share_ops` 都有宿主在接（反查 `grep -rn "createHostRealtimeClient(" apps packages`；读数在 [collaboration-shared-lists.md](../plans/collaboration-shared-lists.md) §9.10）。这一格原来的说法是"服务端做完了、客户端没接"，那是接线落地**之前**的实测，留在这里只为了指认它的形状：一条链建好之后，仓里所有按旧形状写的句子都得逐处改口 |
| P1-17 | **NLP 补齐**：时间点 / `#标签` / `~时长` / 清单名 + 移动端入口 | §2.8 #8.1 |
| P1-18 | **小组件真机验收** | 代码齐、真机 0 项（§3 #13 的另一半） |
| P1-19 | **桌面端渲染进程换成共享 UI** | 现在是占位（§3 #11） |
| P1-20 | **自建部署降到"真一键"**：默认值 / 预置镜像 / 迁移开关 | §2.10 #10.4 |

### 6.4 P2（差异化）

| # | 任务 |
|---|---|
| P2-1 | 正计时模式（专注） |
| P2-2 | 习惯备注 / 日记 UI |
| P2-3 | 番茄目标 / 连续专注天数 |
| P2-4 | 笔记模块（要么做全，要么把实体从 `EntityModelMap` 拿掉 —— **不能停在中间**） |
| P2-5 | 白噪音 |
| P2-6 | 位置提醒（iOS） |
| P2-7 | 日历双向同步（Google / Outlook） |
| P2-8 | CalDAV |
| P2-9 | 附件 / 图片 |
| P2-10 | 任务指派 / 动态流 UI（**清单共享 + 入群链接已落地**，见 §2.6 的 6.1 / 6.7；评论的代码也已随 Web 产物进三枚桌面壳 —— 宿主写路径与下行在 `packages/app-host/src/share-comments.ts`、挂载在 `apps/web`，三族 op 进共享日志 + WS 扇出由 `pnpm verify:collab-sync` 验（`RESULT=OK`，步数由脚本自己打印），**两台真浏览器里成员互相看得到**由 `pnpm verify:collab-journey` 常驻钉着（2026-10-23 M2，见 6.3）；⚠️ 那"两台"分别指**无界面宿主实例**与**开界面的浏览器**，两层不能混读，见环境陷阱 #535；**这两件 UI 仍没建**：指派（全仓零处写 `Task.assigneeUserId`）、动态流（三类活动只作为通知偏好存在，没有活动流界面））|
| P2-11 | 鸿蒙应用接入（把 RN 接进 `Index.ets`） |
| P2-12 | 农历重复 |
| P2-13 | 清单创建「名字 + 颜色」半步（2026-10-06 补；整对话框结构化建单见 §2.2 #2.11 —— 视图类型 / 智能清单可见性两问依赖 IA 拍板（[product-level-ia-ux-audit.md](product-level-ia-ux-audit.md) §3.3 ③），不随本条立项） |

### 6.5 文档修复（与功能并行，成本低、收益高）

| # | 任务 | 依据 |
|---|---|---|
| DOC-1 | 修 `roadmap.md:40` 的 `chrono-node` 描述 | §4.1 #1 |
| DOC-2 | 修 `entities.ts:66-72` 的陈旧象限注释 | §4.1 #5 —— **会诱导下一个人违反 ADR-0015** |
| DOC-3 | 修 `AGENTS.md:2298`（凭据管理）、`:2304-2306`（移动端成长） | §4.2 #8、#9 |
| DOC-4 | 修 `README.md` / `roadmap.md` 的导出与导入范围说明 | §4.2 #11 |
| DOC-5 | 修 `build-matrix.md` §4（Windows 桌面方向）与 `server/README.md` 路径 | §4.1 #6、#7 |
| DOC-6 | 为 ADR-0018 §4.1 与 ADR-0021 补**勘误 / 取代关系**（ADR 不可改原文） | §4.1 #3、#4 |
| DOC-7 | 消解 `roadmap.md:44` 与 `:373` 的自相矛盾 | §4.2 #12 |
| DOC-8 | 🔴 **加一道门禁**：`check:*` 能发现"实体已建模但零 Action / 零调用点" | §3.1 的三问 |

> **DOC-8 是这一节里唯一有杠杆的一条。** 其余七条修完就完了，
> DOC-8 修的是**产生它们的机制** —— 上面 13 个幻觉全是同一个形状，
> 而现有门禁一条都发现不了。

---

## 7. 结论

**heyta 的地基比滴答清单更硬，但产品面比它薄得多。**

- 地基（同步 / E2EE / 本地优先 / 冲突解决 / 自建）✅ 真实可用，且**若干处优于对标物**；
- 核心闭环（任务 / 清单 / 标签 / 四象限 / 习惯 / 专注）✅ 能跑通；
- 但**提醒、日历（Web）、子任务、搜索、筛选、看板、备注编辑、批量操作**这八件事
  是滴答的**日常主路径**，我们一件都没有；
- 而最危险的不是这些缺口，是 **§3 那 13 项"看起来有、其实没有"** ——
  它们让缺口**不可见**，连我们自己的文档都被骗过。

**下一步**：先做 **P0-5 / P0-4 / DOC-1 / DOC-2 / DOC-8**（都是低成本、高杠杆），
再用 P0-1（提醒）与 P0-2（Web 日历）打产品面的地基。
完整排序、依赖与验收判据见
[../plans/site-and-parity-alignment.md](../plans/site-and-parity-alignment.md)。

---

## 9. 勘误（2026-11-05，按本文 §0.2 第 1 条的规矩：新增本节，不改上面原文）

> 上面那张矩阵是 **2026-09-28 的只读审计**，本文当时就没跑过任何测试。三十七天过去，
> **下面这些行的 heyta 侧状态已经变了** —— 逐条给可复跑命令，不要求读者信这一栏。
> 读法：**先看 §9，再看 §2**；§1 那张 A/B/C 分类表要按本节重读一遍再用。

### 9.1 已经不再成立的行（原文保留，状态在此更正）

| 行 | 原文说 | 今天 | 现量命令（自己跑，别抄这里） |
|---|---|---|---|
| 1.2 子任务 | ❌「无实体、无字段」 | 有：`parentId` + 顶级判定只有一份 | `grep -rn "parentIdOf" packages/domain/src/subtasks.ts` |
| 1.4 按标签筛选 | ❌「无 tag 分支」 | 有：`{ kind: 'tag'; tagId }` | `grep -n "kind: 'tag'" packages/domain/src/task-filter.ts` |
| 1.8 ③ 农历 | ❌「无农历」 | 有：农历换算与节日都在领域层 | `grep -rln "lunarToSolar\|FESTIVAL_IDS" packages/domain/src` |
| 1.9 提醒 | ❌「未物化、全链路 0」 | 已物化并有界面（2026-10-02 移出未物化清单，理由写在源码注释里） | `grep -n "REMINDER" packages/op-log/src/state.ts`、`ls apps/web/src/features/reminders/` |
| 1.10 附件 | ❌「全仓无 attachment 实体」 | 实体与领域函数都在；**web 详情面的入口这一格我没复核到位** | `grep -n "'ATTACHMENT'" packages/shared-schema/src/entity-types.ts` |
| 1.11 评论 | ❌「无 comment 相关代码」 | 实体在，且任务详情面接了协作区评论 | `grep -n "COMMENT" packages/shared-schema/src/entity-types.ts`、`sed -n '550,570p' apps/web/src/features/tasks/TaskDetailCard.tsx` |
| 1.13 回收站 | 🟡「只有 TASK」 | 四类：TASK / NOTE / PROJECT / HABIT | `grep -n "TRASH_KINDS =" -A1 packages/domain/src/trash-rows.ts` |
| 1.14 排序 | 🟡「无排序开关」 | 有档位（display / addedAt / priority）；**手动拖拽那一半仍缺**（见 §9.2） | `grep -n "TASK_SORT_KEYS" packages/domain/src/task-order.ts` |
| 2.4 Web 日历 | 🔴「web 完全没有日历视图」 | 有：`CalendarView.tsx` 等一组文件 | `ls apps/web/src/features/calendar/` |
| 2.8 已完成 | 🔴「没有任何 UI 能把 filter 设成 completed」 | 有：侧栏那一行就在（本轮浏览器截图为证），常量与分支的归属写在 view-tabs 注释里 | `grep -n "completed" apps/web/src/features/shell/view-tabs.ts` |
| 2.10 搜索 | ❌「全仓无搜索 UI」 | web 有搜索浮层（rail 是唯一入口，这条由 `apps/web/tests/app-mount.spec.tsx` 钉着），移动端有 `SearchScreen` | `grep -rln "search-overlay-surface" apps/web/src` |
| 3.2 移动端习惯 | 🔴「移动端无习惯屏」 | 有 `HabitsScreen.tsx` | `ls apps/mobile/src/screens \| grep -i habit` |
| 4.1 专注时长 | 🔴「不可自定义」 | web 有调用点：`FocusTimer.tsx:92` 调 `focus.setConfig(...)` | `grep -n "setConfig(" apps/web/src/features/focus/FocusTimer.tsx` |
| §1「最刺眼的一条」chrono-node | 说 `roadmap.md:40` 描述了一个不存在的依赖 | 那一行**已经自我更正**（现文写着"此前写的是 chrono-node —— 那是错的"） | `sed -n '40p' docs/plans/roadmap.md` |

### 9.2 今天仍然成立的缺口（这一栏是我 2026-11-05 现量过的，可以直接当待办分母）

| 行 | 缺口 | 现量 |
|---|---|---|
| 2.6 看板 | 仍无看板视图：`apps/web/src/features/` 下没有这一族，命中的"看板"只是注释里列举覆盖面 | `ls apps/web/src/features/`、`grep -rn "看板" apps/web/src/App.tsx` |
| 2.7 / D1 自定义筛选器 | `TaskFilter` 仍是**封闭联合**（all / today / next7Days / completed / quadrant / project / tag），没有用户自建查询 | `sed -n '51,60p' packages/domain/src/task-filter.ts` |
| 1.8 ④ 完成后顺延 | `nextAfterCompletion` 在 `src` 里**零生产调用点**（只有定义与 dist 声明）⇒ 实际仍是固定排期 | `grep -rn "nextAfterCompletion(" --include='*.ts' packages/*/src apps/*/src \| grep -v "export function"` |
| 1.14 手动拖拽排序 | `Task.order` 仍无写入路径 | `grep -rn "order:" packages/app-host/src/actions.ts`（空） |
| C1 富文本备注 | 备注仍是纯文本 / Markdown 框，没有富文本编辑器（选型 + 许可证门禁未过，连带详情面底部工具条的「文本格式」那枚不画）<br>🔴 **2026-11-06 更正这半句**：门禁那两道**已经过了**（逐家 `npm view` 现量，读数与裁决见本文 **§9.6** 与计划 C1 那节）；这一格仍是缺口，但拦路的不再是许可，而是"备注源格式 + 移动端没有富文本渲染器 + 拆解会把备注逐字发出去"这三条落点约束 | `docs/plans/dida-alignment-typography-and-features.md` 的 C1 / C2 两格 |

### 9.3 这一栏**没有**复核（别把本节当成一次新的全量审计）

1.1 备注输入框的可达性、1.6 `startDate` 归属哪个实体、1.7 全天标志、2.11 建单对话框那半步、
3.1 / 3.3 习惯创建表单与计数/时长型界面、§2.5 之后的所有表（协作、分享、小组件、后台、
平台与运营）。这些**沿用原文状态**，动手之前自己重跑一遍。

### 9.4 §9.2 的复量戳（2026-11-05 23:2x，滴答对齐线）

§9.2 那五格是本文当天上午量的，而此后这棵共享树上又落了多笔别的线的提交 ⇒ 用**它们自己给的命令**逐条重跑一次，
读数如下（下一个想确认"分母漂没漂"的人直接照跑，别信这一行）：

| 格 | 复量读数 | 结论 |
|---|---|---|
| 2.6 看板 | `ls apps/web/src/features/` 里没有看板那一族（这一串会随别人落库变，别抄，照跑：`ls apps/web/src/features/ \| grep -ci 'board\|kanban'` ⇒ 0，⚠️ 这句 **rc 是 1**（`grep -c` 没命中就退 1，别读成"命令坏了"））；`App.tsx` 里"看板"那一处命中的是注释里列举覆盖面 | 缺口仍在 |
| 2.7 / D1 自定义筛选器 | `packages/domain/src/task-filter.ts` 的 `TaskFilter` 仍是 7 成员封闭联合（`all / today / next7Days / completed / quadrant / project / tag`） | 缺口仍在 |
| 1.8 ④ 完成后顺延 | `nextAfterCompletion(` 在 `packages/*/src` 与 `apps/*/src` 里剔掉定义后 **0 处** | 缺口仍在（= 交接文档 §五 第 3 步） |
| 1.14 手动拖拽排序 | `grep -rn "order:" packages/app-host/src/actions.ts` ⇒ **0 行** | 缺口仍在 |
| C1 富文本备注 | 这一格不是代码读数，是裁决：`docs/plans/dida-alignment-typography-and-features.md` 的 C1 未过选型 + 许可证两道门，「文本格式」那枚按裁决不画 | 未做，与计划一致 |

⇒ 本轮**没有**任何一格因为别人的提交而翻成"已具备"；§9.2 可以直接继续当待办分母用。
⚠️ 反过来也一样重要：这五格里有四格是"读起来像已经做了"的（`features/capture` 与日历/搜索那一族确实存在，
看板却还没有；`TASK_SORT_KEYS` 有档位，拖拽仍没有），所以判缺口要按**这一栏的命令**判，不要按功能名印象判。

> 🔴 本节自身的教训也记一笔（写进交接，不写进这里）：补设备取证图时我先撞回 #208
> 早已写明的"截图默认端口"坑，又把"黑帧"错误归因成"Simulator 没开窗口"并写进了计划文档 ——
> 根因是**动手前没 grep 陷阱账本**。见 [../plans/dida-alignment-handoff.md](../plans/dida-alignment-handoff.md) §六。

### 9.5 §9.2 有一格已经翻面（2026-11-06，滴答对齐线；按 §0.2 的规矩只加本节）

**1.8 ④ 完成后顺延** 不再是缺口了。当天 00:5x 起：

- 领域/动作层：`Task.repeatAfterCompletion`（可选布尔，缺省即历史形状）+
  `TaskActions.setRepeatAfterCompletion`，`completeTask` 按这一枚分两档取基准
  （固定排期从**当前到期日**推、完成后顺延从**完成那一天**推）。
  行为判据在 `packages/app-host/tests/repeat-actions.spec.ts` 末组四臂：
  同一场景（错过两周才勾）两档给出**两个不同日期**（9-21 vs 10-05），
  并且"这一格只发一个 op、不碰规则串"也钉住了。
- 界面：web 重复编辑器多一枚复选框（`task-repeat-after-completion`），移动端面单同一格做成
  可切换 chip（`task-detail-repeat-after-completion`，本屏没有 Switch 先例所以不新造控制形状）。
- 复跑口径（别抄这里的数）：
  `grep -rn "nextAfterCompletion(" --include='*.ts' packages/*/src apps/*/src | grep -v "export function"` ⇒ 生产调用点 **1 处**
  （原来这一条读 0，是 §9.2 判"仍是固定排期"的依据）；
  `grep -c 'repeatAfterCompletion' packages/domain/src/entities.ts packages/app-host/src/actions.ts` ⇒ 两份都非零。
- ⚠️ 与"固定排期"那条保证的**取舍要讲清楚**：开了这一档，就**不再**有"提前勾掉也不会把节奏挪走"
  那条性质 —— 这是这一档的定义，不是缺陷（详见 `TaskActions.completeTask` 那段注释与 `Task.repeatAfterCompletion` 的字段注释）。

其余四格（看板、自定义筛选器、手动拖拽排序、C1 富文本）本轮复量后**仍是缺口**，见 §9.4。

### 9.6 C1 那两道门过完了（2026-11-06 10:4x，滴答对齐线；按 §0.2 的规矩只加本节）

§9.2 的 C1 行原先写"选型 + 许可证门禁未过"。这一格按交接文档 §五 第 4 步做完了它**该做的那一半**
（调研，不是界面）。取数办法一句话，下一个人自己跑，别抄这里的数：

```bash
for p in @tiptap/core lexical slate prosemirror-state @editorjs/editorjs quill ckeditor5 react-draft-wysiwyg tiptap-markdown markdown-it; do
  npm view "$p" version license time.modified
done
```

| 候选 | 许可证（§3.2 白名单：MIT / Apache-2.0 / BSD / ISC / MPL-2.0 / 0BSD / Unlicense / CC0） | 最后一次发版（§3.1 要"仍在持续更新"） | 结论 |
|---|---|---|---|
| `@tiptap/core` | MIT | 2026-11-05 | ✅ 过门，**本格选它** |
| `lexical` | MIT | 2026-10-28 | ✅ 过门（备选） |
| `slate` | MIT | 2026-10-26 | ✅ 过门（备选） |
| `prosemirror-state` | MIT | 2025-10-23 | ✅ 过门（底座，不是完整编辑器） |
| `@editorjs/editorjs` | Apache-2.0 | 2026-09-17 | ✅ 过门，但输出是自己的 block JSON ⇒ 与 Markdown/HTML 都不互通，排除 |
| `quill` | BSD-3-Clause（在白名单内） | **2024-11-30** | 🔴 §3.1 拦下：两年没发版 ⇒ 与本仓否掉 `rrule.js`（停在 2023）、`cal-heatmap`（停在 2024）同一档 |
| `ckeditor5` | `SEE LICENSE IN LICENSE.md`（核心 GPL-2.0+） | 2026-11-04 | 🔴 §3.2 拦下：GPL 在禁止名单，且白名单外默认失败 |
| TinyMCE | LGPL-2.1+ | — | 🔴 §3.2 拦下：LGPL 在禁止名单 |
| `react-draft-wysiwyg` | MIT | **2022-07-17**（Draft.js 已被上游归档） | 🔴 §3.1 拦下 |
| `tiptap-markdown`（Markdown 往返扩展） | MIT | **2025-09-08** | 🔴 §3.1 拦下（14 个月没发版）⇒ 往返那层不许拿它当现成件，见计划 C1 第 3 条 |
| `markdown-it`（只走渲染侧） | MIT | 2026-10-16 | ✅ 过门，但它一进场就带来一枚必须 `html: false` 的 XSS 判据 |

**这一格现在的阻塞项不再是许可，是三条落点约束**（都指得到现量，写在计划 C1 那节）：
① 备注源格式要拍（拍成 Markdown：`Task.notes?: string` 一个字段都不用动，且仓里 Markdown 已是导出那一路的事实格式）；
② 移动端没有富文本渲染器 —— 四家候选在 RN 上都跑不了，`TaskDetailSheet.tsx` 的备注是 `multiline` TextInput，
⇒ "跨端都能编辑"不是选型能解决的事，只能拍成"web 可编辑、移动端只读渲染"；
③ 🔴 **AI 拆解会把备注逐字发出去**：`packages/app-host/src/ai-breakdown.ts` 把 `source.note` 原样拼进
「已有备注：」并登记披露字段 `note` ⇒ 存 HTML 等于把标签发给上游，这条要在动工那趟复量。

⇒ 对标滴答的 C1 那一格：**门禁半 = 已闭合（本节）**，**界面半 = 仍未做**，两种"没做完"不许混成一句。
