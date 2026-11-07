# R11 四态盘点（只读施工图，2026-11）

> **性质**：只读盘点的产物。**本文件是本次任务唯一写入的文件** —— 没有改任何 `.tsx`、
> 没有改 `packages/i18n`、没有改 `packages/ui/src/task-list/**`、没有改 `App.tsx`。
>
> **需求原文**（两条，逐字）：
> - PRD：[`ticktick-parity-prd-2026-11.md:193`](ticktick-parity-prd-2026-11.md) ——
>   「R11 四态与空态统一 … 空态**按容器分档**（不居中 / 居中 / 卡片 / 纯文字四种形态各有其位）；
>   加载用「条数未知=骨架、已知=行内转圈」；**补一个错误层**」
> - 工单判据：[`c2-d2-work-orders-2026-11.md:100-102`](c2-d2-work-orders-2026-11.md) ——
>   「把某一档换成"居中" ⇒ 该容器的形态断言红」／「两处对调 ⇒ 判据红」／
>   「把错误渲染成空态 ⇒ 断言"两者不同形"红」
>
> 🔴 **本份盘点的核心读数**：这三条判据**今天一条都不存在**。
> 仓库里没有任何断言知道"这个容器该用哪一档"，所以下面那张表里绝大多数行的
> 「判据」列只能写「无判据」—— 这不是盘点偷懒，是现量。

---

## 0. 先纠正三条过期起点（任务书给的三处都已漂移）

| 任务书说的 | 现量 | 怎么核的 |
|---|---|---|
| HEAD `5d3b2d924` | **`68c2330e7`**（`feat(kanban): 看板重建在共享 TaskRow 上 —— 一次还掉 B274 的四笔债`） | `git log --oneline -1` |
| `apps/web/src/App.tsx:1044` 有一个自己的 `EmptyState`（待转发） | **已搬走**：`apps/web/src/features/shell/EmptyState.tsx:18`。`App.tsx:269` 只是 `import`，`:3299` 用它。`check-empty-state.mjs` 的 `IMPLEMENTATIONS[1]` 早在 2026-10-02 就跟着搬了 | `grep -rn "function EmptyState" apps/web/src` |
| `apps/mobile/src/ui/kit.tsx:701` 还有一份 | **现在在 `:941`**（`export function EmptyState({…})`）。`check-empty-state.mjs` 文件头写的 `:701` 是 2026-09-28 的读数 | `grep -n "export function EmptyState" apps/mobile/src/ui/kit.tsx` |

🔴 **主树里有别人未提交的改动，本次一处都没碰、也没为它们引起的红做任何事**：

```
 M apps/desktop-windows/scripts/package-msix.ps1
 M scripts/check-windows-signing-posture.mjs
 M scripts/reinstall-all.sh
```

（`git status --short` 现量。本次任务与这三个文件无交集；`check:windows-signing-posture`
与 `reinstall-all` 都不在 R11 的判据链上，所以没有撞红。）

### 0.1 「四档」到底指哪四档（本文件的行文口径）

PRD 只给了四个名字，没给落点。对照现量，能一一对上的是：

| PRD 的档 | 共享层今天有没有 | 载体 |
|---|---|---|
| **居中** | ✅ 有 | `EmptyStateSize = 'page'`（`empty-state/model.ts:82`），默认档 |
| **不居中** | ✅ 有 | `'section'` —— 左对齐、不占页面高度、不给图标（`model.ts:70-78`） |
| **纯文字** | ✅ 有 | `'line'` —— 一行辅助文字，`row-meta` + `foreground-subtle`（`model.ts:75-78`） |
| **卡片** | 🔴 **没有** | `model.ts:82` 的枚举就三个值。**卡片里今天一律借 `page`**（=居中 + 上下 `space.16` = 64px + 32px 图标），见 W3/W4/W5/W9/W10/W14 六行 |

⇒ **四档里缺的那一档是「卡片」**，而它恰好是本仓被塞进卡片最多的那一档
（下拉面板、福利卡、月格、日档带、甘特图、看板列、四象限格）。这是本份盘点量到的
**结构性缺口 No.1**。

---

## 1. 四态盘点表

列的口径：
- **空态现状**：`file:line` + 形态（居中／左对齐／卡片内／纯文字／**缺席**）+ 用的是共享组件还是手写；
- **加载态现状**：只记"这块内容自己怎么表示还没来"，不记动作按钮的 `busy`；
- **错误态现状**：catch 之后**屏幕上出现什么**，以及它是否与空态同形；
- **该落哪一档**：按容器尺寸与它上下文的层级判，理由写在同一格里；
- **判据**：今天哪条断言会因为"用错档"变红。指不出来就写「无判据」——**这不是待办，是读数**。

| # | 容器 | 是什么 | 空态现状 | 加载态现状 | 错误态现状 | 该落哪一档 + 理由 | 缺什么 | 判据 |
|---|---|---|---|---|---|---|---|---|
| W1 | `apps/web/src/features/shell/EmptyState.tsx:18`（`App.tsx:3299` 挂载） | 视图（任务列表整块内容区） | **居中**；`ht-empty` 三件套 + `StateIllustration variant="tasks"`，**不走**共享 `EmptyState`（自己写骨架类） | 无（本地 store 同步；启动期由 `boot-splash.ts:59` 的遮罩盖住） | 无。列表读失败没有渲染点 —— 只有动作失败有 `TaskActionError` | **居中**（`page`）—— 整块内容区空掉，是页面档的正例 | ①转发到权威组件（`check-empty-state` 的 `PENDING_THIN_FORWARD[0]` 已挂两年）②这块最大的屏不在权威实现上，任何"按档"的尺都量不到它 | 无判据（断言 A 只钉它"还在"，不断形态） |
| W2 | `apps/web/src/features/shell/ErrorScreen.tsx:39`（`main.tsx:332` 挂载） | 页（整个应用起不来） | —（这一档没有"空"） | — | **全屏居中** + `role="alert"` + 建议词条 + `<details>` 技术详情 | 保持。**这是应用壳里唯一"错误不是空态"的正例**，形态与空态明确不同 | 它只覆盖 `initOpLog()` 失败；进程内的任何一层失败都到不了这里（**应用壳**无 ErrorBoundary；`apps/landing` 那个 `SceneBoundary` 只盖 WebGL 一节，见 §2.2） | 无判据 |
| W3 | `apps/web/src/features/inbox/InboxBell.tsx:224` | 面板（24rem 宽下拉，通知 tab） | **居中**（卡片内）；共享 `EmptyState` 默认 `page` ⇒ 面板里上下各 64px 留白 | **一句纯文字**：`:204` `<p class="ht-inbox__notice">{t('web.inbox.loading')}</p>` —— 条数**未知**（第一次拉取） | `:170` `ht-inbox__notice` 一句 + 重试按钮。**与空态不同形（好）** | **卡片**（面板内）—— `page` 的 64px 留白在这个容器里读成"这块没做完" | 卡片档；骨架（条数未知正是它的判据） | 无判据 |
| W4 | `apps/web/src/features/inbox/InboxBell.tsx:272` | 面板（同一个下拉，活动 tab） | **居中**（卡片内）；共享 `EmptyState`（`page`） | **一句纯文字**：`:262` | 同 `:170`（复用 `LoadNotice`） | **卡片** | 卡片档；骨架 | 无判据 |
| W5 | `apps/web/src/features/inbox/InviteActivityCard.tsx:145` | 卡片内（福利卡里的一个子列表） | **居中**（卡片内）；共享 `EmptyState`（`page`），标题是"还没有邀请记录" | 无（数据随活动面板一起到） | 🔴 **失败被吞成"没有这张卡"**：`:58` `catch {}` 之后整卡不渲染 —— 用户看到的是"没有福利"，不是"没读到福利" | **卡片**（卡片里的子列表，不是页面） | 卡片档；**失败与空必须可区分** | 无判据 |
| W6 | `apps/web/src/features/projects/ProjectsPanel.tsx:352`（清单）/ `:487`（标签）→ `packages/ui/src/projects/OrganizerList.tsx:802-834` | 列表（侧栏两节） | **左对齐（手写）**：`row-meta` 主句 + `caption` 补充，挂在「清单」「标签」分组标签下面。**不走共享 `EmptyState`** | 无 | `:425` `ht-settings__danger role="alert"` 一行（只覆盖"新建文件夹"失败，不覆盖列表读失败）。**与空态不同形（好）** | **纯文字**（`line`）—— 它是分组标签的下属，`section` 的 `row-title`+`foreground` 会盖过分组标签（`OrganizerList.tsx:806-829` 的注释把这笔账算过） | 共享层这处手写在门禁射程外（见 §2.3）；`line` 档存在但没被用 | 无判据 |
| W7 | `apps/web/src/features/quadrant/QuadrantBoard.tsx:424` → `packages/ui/src/quadrant/QuadrantBoard.tsx:424` → `task-list` 的 `emptyMessage` | 卡片（四象限的四个格） | **左对齐单句**（`TaskList` 的 `emptyMessage`，`caption` 档）；只有"展示序第一个空象限"带引导语 | 无 | `:470` `role="alert"`/`"status"` 一行就地（拖拽失败）。**与空态不同形（好）** | **卡片** —— 每格约 1/2 宽 × 1/3 高，居中大块会把四格读成四个空页 | 卡片档；`emptyMessage` 是"一句字符串"，装不下"两步走"的字形 | ✅ **有**：`apps/web/tests/quadrant-empty-state.spec.tsx`（但只判"同屏引导最多 1 处"，**不判档**） |
| W8 | `packages/ui/src/calendar/CalendarBoard.tsx:739` | 卡片（月历每一格选中后的「这一天」卡） | **居中**（卡片内）；共享 `EmptyState`（`page`）塞进 `styles.card` | 无 | 无（`apps/web/src/features/calendar/CalendarView.tsx:198` catch 写 store → 由 `TaskActionError` 显示） | **卡片** —— 月格/当天卡只有 ~100-200px 高，`page` 的 64px×2 撑破布局 | 卡片档 | 无判据 |
| W9 | `packages/ui/src/calendar/CalendarDayBoard.tsx:150` | 卡片（日档「全天」那一条带） | **居中**（卡片内）；共享 `EmptyState`（`page`） | 无 | 同 W8 | **卡片 / 纯文字** —— 它是一条"带"，不是一块面；`page` 会把 24 小时轴挤下去 | 卡片档 | 无判据（`apps/web/tests/calendar-day-view.spec.tsx` 只钉"说哪句话"，不钉形态） |
| W10 | `packages/ui/src/search/SearchPanel.tsx:215` | 浮层（搜索面板的结果区） | **居中**（`page` + `illustration="search"`）；`:209` 另有"还没输入"的纯文字 `prompt` | 🔴 **完全没有**：`SearchPanel.tsx` 全文无 loading 分支；`SearchScreen.tsx` 也没有 —— 搜索是同步的，**它是本仓唯一"条数未知却没有加载态"的容器** | `apps/mobile/src/screens/SearchScreen.tsx:217` 顶部一行 danger 文字，**下面照旧显示"没找到"** ⇒ 失败与"没结果"同屏 | **居中**（浮层本身是页面级，`page` 合理）；**但错误必须替换空态，不是叠在它上面** | 加载档；错误/空态互斥 | 无判据 |
| W11 | `apps/web/src/features/trash/TrashView.tsx:241` → `packages/ui/src/trash/TrashBoard.tsx:126` | 视图（回收站整页） | **居中**（`page`）；共享 `EmptyState`（`title`+`hint`） | `:118` `busyId` 只表示"某一行动作在跑"，不是加载 | `:225` `ht-settings__danger role="alert"` 一行。**与空态不同形（好）**，但**失败时空态与红字同屏** | **居中**（`page`）—— 页面档正例 | 错误与空态互斥；加载档（回收站是要读库的） | 🟡 半条：`apps/web/tests/trash.spec.tsx:318-319` 只钉"红字出现"，**不钉"空态消失"** |
| W12 | `apps/web/src/features/timeline/TimelinePanel.tsx:68` → `packages/ui/src/timeline/TimelineBoard.tsx:565` | 视图（时间线整页） | **居中**（`page`）；共享 `EmptyState` | 无 | 无 | **居中**（`page`） | 加载档；错误层 | 无判据 |
| W13 | `packages/ui/src/timeline/GanttChart.tsx:191`（经 `ChecklistPlanPreview.tsx:81`） | 卡片（任务详情里的排程预览） | **居中**（卡片内）；共享 `EmptyState`，`testID="gantt-empty"` | 无 | 无 | **卡片** —— 详情预览只有一条，`page` 会把它撑成第二块屏 | 卡片档 | 无判据 |
| W14 | `apps/web/src/features/habits/HabitsView.tsx:686` | 视图（习惯整页） | **居中**（`page`）+ **动作槽** `:702`（`habits-empty-add`） | `:359 busy={adding}` 只表示"正在新建" | `:645` `ht-habit__add-error role="alert"`。**与空态不同形（好）** | **居中**（`page`）—— 页面档正例，且是"给动作"的样板 | — | 🟡 `apps/web/tests/empty-state-action.spec.tsx` 判"动作槽有无"，**不判档** |
| W15 | `packages/ui/src/habits/HabitBoard.tsx:504-512` | 卡片（进度列） | **纯文字（手写）**：一句 `caption` + `foreground-muted`。**不走共享 `EmptyState`** | 无 | 无 | **纯文字**（`line`）✅ 位置对，但实现是第二份 | 共享层这处手写在门禁射程外 | 无判据 |
| W16 | `packages/ui/src/notes/NotesBoard.tsx:373-379` | 区块（「我的」页里的一段便签板） | **居中**（`page` + `illustration="notes"` + `icon`），塞进区块 | 无 | `:365` `notes-save-failed` 一行 danger。**与空态不同形（好）** | **不居中**（`section`）—— 它是区块不是页；`page` 在「我的」页里会长出一整块居中块 | 用了错的档（`page`，应为 `section`） | 无判据 |
| W17 | `apps/web/src/features/kanban/KanbanView.tsx:252-256` → `packages/ui/src/task-list/TaskBoard.tsx:316` | 卡片（看板每一列） | 🔴 **缺席**：`boardLabels` 只给了 `columnA11y`，不传 `labels.empty` ⇒ `TaskBoard` 不传 `emptyMessage` ⇒ `TaskList.tsx:341` 返回 `null`。**空列是纯空白** | 无 | 无 | **卡片** —— 列宽约 1/4 屏；但今天连"档"都没有，是零 | 空态整体缺席（比"用错档"更严重） | 无判据（`apps/web/tests/kanban-row-parity.spec.tsx` 只判行） |
| W18 | `apps/web/src/features/tasks/TaskActionError.tsx:38` | 全局条（内容列顶部） | — | — | `role="alert"` + `aria-live="assertive"` + 关闭按钮，**只占一行、不占内容区**，且**不显示** `error.message` 原文 | 保持。这是**错误层唯一的成品**，形态与空态明确不同 | 它只覆盖"写"（动作失败），不覆盖"读"（加载失败）；[`:19-21` 的注释自己写明要覆盖六个面，实际只覆盖一个显示点] | ✅ **有**：`apps/web/tests/task-action-error.spec.tsx`（存在性 + 关闭 + 不显示原文） |
| W19 | `apps/web/src/features/settings/PasskeyPanel.tsx:300` / `settings/MemoryPanel.tsx:206,267` / `sync/VaultSettingsPanel.tsx:551` | 面板 / 设置行 | **纯文字**（`ht-settings__hint`，`role="status"`）✅ 位置对 | 无 | `passkeys-load-failed` 等一行（`apps/web/tests/passkey-panel.spec.tsx:224`、`account-security.spec.tsx:336,720`） | **纯文字**（`line`）✅ 已经是对的档，**不要动** | 只缺"这里也是 `line` 档"的登记，以及共享层没有 `line` 档的消费者 | 🟡 存在性有（`passkeys-load-failed`），**形态无** |
| W20 | `packages/ui/src/sync/CommentThread.tsx:94` | 区块（评论区） | **纯文字**：一行 `row-meta` ✅ | 无 | `:76` 只处理"空草稿"（不是网络失败） | **纯文字**（`line`）✅ | 手写、且在门禁射程外；无失败态 | 无判据 |
| W21 | `packages/ui/src/countdown/EventBoard.tsx:500` | 视图（倒数纪念日页） | **居中**（`page`）；共享 `EmptyState`，按 `view` 分两套文案 | 无 | 无 | **居中**（`page`）✅ | 加载档 | 无判据 |
| M1 | `apps/mobile/src/screens/TasksScreen.tsx:1762`（空）/ `:1446`（加载）/ `:1430`（错误） | 视图（任务列表整页） | **居中**（`page`）；kit `EmptyState` + `illustration="tasks"` | **居中空态**：`:1446` kit `EmptyState icon="action.sync"` + 「加载中」 | 🔴 **居中空态**：`:1430` kit `EmptyState icon="group.overdue"` + danger `detail` —— **三态同一个组件、同一几何，只换图标与色** | 空态=居中 ✅；**加载与错误必须离开这一档** | 错误层；加载档（骨架） | 无判据 |
| M2 | `apps/mobile/src/screens/HabitsScreen.tsx:349`（错误）/ `:373`（加载） | 视图（习惯整页） | 共享 `HabitBoard`（`line` 手写） | **居中空态**：`:373` kit `EmptyState` + `action.sync` | 🔴 **居中空态**：`:349` 同上 + `group.overdue` | 同 M1 | 错误层；加载档 | 无判据 |
| M3 | `apps/mobile/src/screens/TrashScreen.tsx:260` → `TrashBoard` | 视图（回收站整页） | **居中**（`page`）✅ | 无 | `:273` 一行 `Text`（不是 `EmptyState`，也与空态不同形） | **居中** ✅ | — | 无判据 |
| M4 | `apps/mobile/src/screens/SearchScreen.tsx:217` + 共享 `SearchPanel` | 浮层 | 共享 `SearchPanel`（`page`） | 无（同 W10） | 顶部一行红字 + **空态照旧显示** | 同 W10 | 加载档；错误/空态互斥 | 无判据 |
| M5 | `apps/mobile/src/screens/CalendarScreen.tsx:368` + 共享 `CalendarBoard` | 视图 | 共享 `CalendarBoard`（`page`，卡片内） | 无 | `:368` 一行 `Text` | 与 W8 同一处，需跟 W8 一起改 | 卡片档 | 无判据 |
| M6 | `apps/mobile/src/screens/NotesSection.tsx:237` + 共享 `NotesBoard` | 区块 | 共享 `NotesBoard`（`page`，应为 `section`） | 无 | `:237` 一行 `Text` | 同 W16 | 同 W16 | 无判据 |
| M7 | `apps/mobile/src/screens/NotificationsScreen.tsx:232`（空）/ `:213`（加载）/ `:204`（错误） | 面板 | **居中**（`page`）；共享 `EmptyState` | **一句纯文字**：`:213` | `:204` 一句 + 重试（`notice()`）。**与空态不同形（好）** | **卡片**（面板内） | 卡片档；骨架 | 无判据 |
| M8 | `apps/mobile/src/screens/GrowthScreen.tsx:358` | 区块 | **纯文字**：一行 `hint` ✅ | 无 | 无 | **纯文字**（`line`）✅ | 手写 | 无判据 |
| M9 | `apps/mobile/src/screens/TaskDetailSheet.tsx:2001`（标签）/ `:1379`（子任务）/ `:1494`（附件） | 卡片（详情面里的三段） | **纯文字**：三行 `Text` ✅ | 无 | 无 | **纯文字**（`line`）✅ | 手写 ×3 | 无判据 |
| M10 | `apps/mobile/src/screens/QuadrantScreen.tsx`（129 行，无任何状态分支）| 视图 | 共享 `QuadrantBoard`（`emptyMessage`，左对齐） | 无 | 无 | 与 W7 同一处 | 同 W7 | 无判据 |
| M11 | `apps/mobile/src/screens/TimelineScreen.tsx`（70 行，无任何状态分支） | 视图 | 共享 `TimelineBoard`（`page`） | 无 | 无 | **居中** ✅ | — | 无判据 |

### 1.1 表面读数（从这张表直接数出来，不需要"感觉"）

| 读数 | 值 |
|---|---|
| 表格行数（容器） | **32** |
| 空态用共享 `EmptyState` | **13 行** |
| 空态是第二份实现（手写 DOM / 借 `emptyMessage` 一句字符串 / 平台另一套） | **6 行**（W6、W7、W15、W20、M8、M9） |
| 空态**缺席**（空白，什么都不画） | **1 行**（W17 看板列） |
| 空态用了**错的档** | **5 行**（W3、W4、W5 应为卡片档却借 `page`；W16、M6 应为 `section` 却借 `page`） |
| 加载态有渲染、且**不是**空态 | **3 行**，全是纯文字（W3、W4、M7） |
| 加载态＝**空态**（同形） | **2 行**（M1、M2） |
| 加载态**完全没有**（含 W10/M4 搜索这类"条数未知却没有加载态"） | **27 行** |
| 错误态**与空态同形** | **2 行**（M1、M2；W10/M4 是"叠加"而非替换，另计） |
| 错误态**被吞成"没有内容"** | **1 行**（W5：`catch {}` → 卡片整个不渲染） |
| 有**形态**判据的行 | **1 行**（W7 的「同屏引导最多 1 处」） |
| 只有**存在性**判据的行（钉"渲染了"，不钉"哪一档"） | **4 行**（W11、W14、W18、W19） |
| 「无判据」的行 | **27 行** |

---

## 2. 错误层清单（谁把失败渲染成了"空 / 无数据 / 没有内容"）

### 2.1 逐条：失败 → 屏幕上出现什么

| # | `file:line` | 失败点 | 渲染成什么 | 是否与空态同形 |
|---|---|---|---|---|
| E1 | `apps/mobile/src/screens/TasksScreen.tsx:1430` | 首屏读库失败 | kit `EmptyState`（`group.overdue` + danger `detail`）| 🔴 **是**：同一个组件、同一几何、同一 `paddingVertical: space.16` |
| E2 | `apps/mobile/src/screens/HabitsScreen.tsx:349` | 首屏读库失败 | kit `EmptyState`（`group.overdue` + danger `detail`）| 🔴 **是** |
| E3 | `apps/mobile/src/screens/SearchScreen.tsx:217` | 搜索读失败 | 顶部一行 danger `Text`，**下面照旧渲染 `SearchPanel` 的"没找到"** | 🟠 **叠加**：用户同时看到"出错了"和"没结果"，两句互相否证 |
| E4 | `apps/web/src/features/inbox/InviteActivityCard.tsx:58` | 邀请数据读失败 | `catch {}` ⇒ 整卡 `return null` | 🔴 **是**：屏幕上的结果是"没有这张福利卡"，与"你还没有邀请记录"不可区分 |
| E5 | `apps/web/src/features/kanban/KanbanView.tsx:252` | 列表读失败 | 无渲染点（没有错误分支，也没有空态）| 🔴 **是（更糟）**：失败与"空列"都是空白 |
| E6 | `apps/web/src/features/trash/TrashView.tsx:225` 与 `:241` | 读回收站失败 | 红字一行 **+ 空态同时在场**（`TrashBoard` 的 `emptyTitle` 仍渲染）| 🟠 **叠加**：两句同屏 |
| E7 | `packages/ui/src/projects/OrganizerList.tsx:803` | 宿主没给 `labels.empty` | 渲染一个**空 `<View>`** | 🔴 是：`empty === undefined` 与"真的没有数据"是同一个像素 |
| E8 | `apps/mobile/src/screens/CalendarScreen.tsx:368` | 读日历失败 | 一行 `Text`（danger）| ✅ 否（但列表区域同时是空的 ⇒ 实为叠加） |
| E9 | `apps/mobile/src/screens/NotesSection.tsx:237` | 读便签失败 | 一行 `Text`（danger）| ✅ 否（同上，区块仍渲染 `NotesBoard` 的空态） |
| E10 | `apps/mobile/src/screens/TrashScreen.tsx:273` | 读回收站失败 | 一行 `Text` | ✅ 否（同上） |
| E11 | `apps/web/src/features/quadrant/QuadrantBoard.tsx:352` | 拖拽落库失败 | `role="alert"` 一行 | ✅ 否 |
| E12 | `apps/web/src/features/calendar/CalendarView.tsx:198` | 勾选失败 | 写 store → `TaskActionError` 一行 | ✅ 否 |

**合计 12 条**：其中 **5 条与空态同形**（E1、E2、E4、E5、E7）、**4 条与空态叠加**（E3、E6、E8、E9/E10 一族）、**3 条不同形**（E11、E12、W18）。

### 2.2 现有的错误提示用的是什么件

| 件 | 位置 | 覆盖什么 | 覆盖不到什么 |
|---|---|---|---|
| `TaskActionError` | `apps/web/src/features/tasks/TaskActionError.tsx:31`（`App.tsx:3213` 挂一次） | **写**：`store.error`，六面共用一行 | **读**：加载失败没有任何写 `store.error` 的路径；也没有"重试" |
| `ErrorScreen` | `apps/web/src/features/shell/ErrorScreen.tsx:39`（`main.tsx:332`） | **整应用起不来**（`initOpLog()` 失败） | 进程内任何一层失败都到不了这里 —— **应用壳（`apps/web` / `apps/mobile`）零 `ErrorBoundary`** |
| `SceneBoundary` | `apps/landing/src/components/SceneBoundary.tsx:40`（`getDerivedStateFromError:43` / `componentDidCatch:55`） | **落地页的 WebGL 那一节**：`SyncScene` 拿不到上下文时降级成静态图 | 🔴 **它不覆盖应用**。文件头原话：「把范围钉死在 **WebGL 那一节**：它坏了就只坏它自己」，且只存在于 `apps/landing`（官方站的另一张脸），与 web/mobile 壳无关 |
| `ht-settings__danger` + `role="alert"` | 41 处（`apps/web/src/features`） | 逐点就地一行 | 没有统一组件 ⇒ 形状、是否带"重试"、是否与空态互斥，**41 份各自决定** |
| `LoadNotice` | `apps/web/src/features/inbox/InboxBell.tsx:158` | 面板级失败 + 重试（唯一带重试的实现） | 只服务收集箱两处 |
| `UndoReceipt` | `apps/web/src/lib/feedback/UndoReceipt.tsx` | 撤销回执（**不是错误**）| — |

⇒ **错误层缺的档**：`列表/页级加载失败`（带重试 + 与空态互斥）、`卡片级静默失败`（E4 那种"失败等于不存在"）、`进程内异常兜底`（**应用壳**零 ErrorBoundary；`apps/landing` 有 1 个 `SceneBoundary`，射程只有 WebGL 那一节，不覆盖应用）。
`overlay-feedback.md:226` 早已把这件事记成 T3：「把 **24 处就地提示行 + 34 处 `role="alert"`** 收成共享 Alert 组件」——
现量是 **41 处**（`grep -rn 'role="alert"' apps/web/src/features --include=*.tsx | wc -l`），
**比那笔账写的时候还多了**。

### 2.3 门禁射程的两个缺口（`scripts/check-empty-state.mjs`）

| 缺口 | 事实 | 后果 |
|---|---|---|
| **射程不含 `packages/ui/src`** | `SCOPES`（`:173-176`）= `apps/web/src/{features,App.tsx,dev}` + `apps/mobile/src/{screens,ui/kit.tsx}`。`packages/ui/src` 只被**断言 C** 扫（找 `EmptyState` 的**定义**） | 共享层的 **5 处手写空态全部在射程外**：`OrganizerList.tsx:802`、`HabitBoard.tsx:504`、`HabitProgressList.tsx:252`、`AuthForm.tsx:711`、`CommentThread.tsx:94` —— 这些是**四个端同时看到**的第二份实现，而门禁一声不响 |
| **只判"有没有"，不判"哪一档"** | `SITE_MARKERS`（`:335-365`）四个 marker 都是"这一处是不是手写"，`EMPTY_SITES` 是文件级账本 | 「用错档」完全不可判：把 W3 的 `page` 改成 `card`、或把 W16 的 `section` 改成 `page`，**rc 仍然是 0** |

### 2.4 最接近「加载档」的那道门禁，也不管这件事

`pnpm check:spinner-discipline`（`scripts/check-spinner-discipline.mjs`）确实存在，但它的判据是
**一行文本**：`apps/web/src/features/settings/` 下的 `<Loader2` 同行必须带 `ht-settings__busy`
（文件头原话："忙态图标是静态残月，用户以为界面卡住了"）。

⇒ 它管的是**动作忙**（提交中／保存中）的图标动画，**不是**"内容还没来"。
PRD 要的那条切分（条数未知 ⇒ 骨架 / 条数已知 ⇒ 行内转圈）**没有任何一条门禁看着**：
`Skeleton` 全仓 0 处，`TaskRow.tsx:357-359` 的 `busy` 只写 `aria-busy`+`disabled`、不画指示。
把 InboxBell 的纯文字换成骨架、再换回纯文字，**所有 check 都是绿的**。

**现量**（`node scripts/check-empty-state.mjs`，rc=**0**）：

```
✅ 没有新的手写空态（扫 264 个文件，24 个登记站点）。
⬇️  有 1 个登记站点已消失（多半是被收编了 —— 这是好事）：
      [直接渲染空态词条] apps/web/src/features/share/ShareCommentsSection.tsx
✅ 权威定义唯一：packages/ui/src/empty-state/EmptyState.tsx
```

⚠️ 那 1 条过期账与本文件无关（`ShareCommentsSection` 的空态文案已交给共享面板），
**本次不动它** —— 改它就是改别人线上的账。

---

## 3. 五条施工建议（每条 ≤3 文件、可独立提交、按依赖排序）

> 每条都写了「改完哪条断言会红」。**若某条写不出红，那就是 §1 里那 27 行「无判据」的同一种病**，
> 所以每条都自带一枚新断言。

### 建议 1（🔴 **必须先做**）：把第四档 `card` 定进权威模型

| | |
|---|---|
| 文件 | `packages/ui/src/empty-state/model.ts`（`EmptyStateSize` 加 `'card'`、`nonBlank` 之外只加分支）、`packages/ui/src/empty-state/EmptyState.tsx`（`rootCard` 样式：`paddingVertical: space.4`、不画 icon、`title` 走 `row-title`）、`packages/ui/tests/empty-state-model.spec.ts`（加 4 条） |
| 改完哪条断言会红 | 新加的那 4 条：①`size:'card'` 时 `icon === undefined`（同 `section`/`line` 的理由，`model.ts:206-215` 已有先例）②`card` 档的 `title` 走 `row-title` 而不是 `section-title` ③默认仍是 `page`（回归臂：现有 442 条不许变）④`size` 未知值不静默回落（防"传错枚举等于回落 page"） |
| 为什么必须第一 | **它是"四档"这个词汇表。** 词汇表没定全就开错误层与骨架，两个新件会自然长进 `empty-state/` 命名空间（今天的 `detailTone` 默认 `'danger'`（`model.ts:220`）已经是"错误借用空态"的第一步）—— 那就把 PRD 明令否掉的「错误是空态的变体」**在目录结构上**做进去了。先定档，错误层才会落在 `feedback/` 而不是 `empty-state/` |
| 风险 | 零渲染变化（默认档不变，`page` 一个像素不动） |

### 建议 2：web 壳转发到权威组件（消掉挂了两年的一条债）

| | |
|---|---|
| 文件 | `apps/web/src/features/shell/EmptyState.tsx`（保留 `filter → {titleKey,hintKey}` 的映射——那是**宿主语义**；把 `ht-empty` 三件套 + `StateIllustration` 换成 `<EmptyState size="page" testID="empty-state" …/>`）、`scripts/check-empty-state.mjs`（`IMPLEMENTATIONS[1]` 的 `also: /ht-empty/` 与 `PENDING_THIN_FORWARD[0]` 同时改） |
| 改完哪条断言会红 | **不改脚本 ⇒ 断言 A 精确红**：「`apps/web/src/features/shell/EmptyState.tsx` 里已经没有 `ht-empty` 骨架类 —— 站点的 marker 失效了」。⚠️ 这是本仓唯一"改对了反而红"的判据，所以必须**同一提交**里把 `also` 换成 `/<EmptyState\b/` 并把 `PENDING_THIN_FORWARD` 删一行；此后断言 C 的 `goneSites` 会提示"登记站点已消失"，那就是"真账变短"的读数 |
| 依赖 | 建议 1（要先有 `page` 之外的说法才能把"这一屏该用哪一档"写进代码注释并日后被引用） |
| 为什么排第二 | **它是唯一让"按档判"有分母的动作。** 今天 web 最大的一屏（任务列表）根本不经过权威实现，任何尺都量不到它 |

### 建议 3：mobile kit 转发（四槽位已经一一对应，成本最低的一处）

| | |
|---|---|
| 文件 | `apps/mobile/src/ui/kit.tsx`（`EmptyState` 函数体换成 `<SharedEmptyState …/>` 或直接 `re-export`；**注意 `hint` 在 kit 里是必填、在共享层是可选的** —— 转发时保留 kit 的必填签名，否则 21 处调用点会静默少一行）、`scripts/check-empty-state.mjs`（`IMPLEMENTATIONS[2]` 与 `PENDING_THIN_FORWARD[1]`） |
| 改完哪条断言会红 | 断言 A 精确红：「`apps/mobile/src/ui/kit.tsx` 里找不到 `export function EmptyState(`」⇒ 同一提交改成"必须从 `@heyta/ui` 解构或 re-export"。若不改 ⇒ 262 个文件扫到的锚点失效而**其余全绿**（这就是断言 A 存在的理由，见脚本 `:119-127`） |
| 依赖 | 建议 2（同一份登记表，两条账要同一条清算线；否则一个提交里两个 marker 互相干扰） |

### 建议 4：错误层落地（`ErrorState`，与空态**不同形**）

| | |
|---|---|
| 文件 | 新建 `packages/ui/src/feedback/ErrorState.tsx`（`role="alert"` + `aria-live="assertive"` + **具名重试按钮** + `<details>` 技术详情；**不 import i18n**，文案走 `labels` prop，同 `overlay-feedback.md:245` 的硬边界）、`packages/ui/src/index.ts`（**只许末尾追加**，同 `:247`）、`apps/mobile/src/screens/HabitsScreen.tsx`（`:349` 换 `ErrorState`；`:373` 换建议 5 的骨架） |
| 改完哪条断言会红 | 新增 `packages/ui/tests/error-state-shape.spec.ts`：①根节点 `accessibilityRole === 'alert'` 且**不带**空态那套 `paddingVertical: space.16`（"不同形"的可机械判形式）②`retryLabel` 存在时必须渲染一枚可点控件（对照臂：不传 ⇒ 零枚，同 `apps/web/tests/empty-state-action.spec.tsx:16-24` 那条对照臂的写法）③反向臂：把 `ErrorState` 换成 `EmptyState` ⇒ ①红 |
| 依赖 | 建议 1（错误层不许落进 `empty-state/`）、建议 3（移动端要先在权威实现上，否则 `ErrorState` 只有第三个消费者） |
| 为什么它单独一条 | 它是 PRD 三条里**唯一两端都没有**的那一条（`c2-d2-work-orders-2026-11.md:102`：「现在两端都没有错误层」）。而今天 E1/E2 是把错误塞进空态、E3/E6 是错误叠在空态上、E4/E5/E7 是错误变成空白 —— **四种形态，一个共同点：用户分不出"没有"和"坏了"** |

### 建议 5：加载档（骨架 = 条数未知；行内转圈 = 条数已知）

| | |
|---|---|
| 文件 | 新建 `packages/ui/src/feedback/Skeleton.tsx`（N 条等宽条 + `accessibilityRole="progressbar"` + `aria-busy`；**不给无限动画**，`prefers-reduced-motion` 下静态）、`packages/ui/src/index.ts`（末尾追加）、`apps/web/src/features/inbox/InboxBell.tsx`（`:204`、`:262` 两句纯文字换成 `<Skeleton rows={3} />`） |
| 改完哪条断言会红 | 新增 `apps/web/tests/inbox-skeleton.spec.tsx`：①`loading` 为真且 `state === null` 时 `[data-testid$="-skeleton"]` 存在且**空态 testID 不存在**（两句一起，这才叫"换掉"而不是"多加一块"）②`loading` 转 `false` 后骨架消失 ③反向臂：把 `:204` 换回纯文字 ⇒ ①红 |
| 现量支撑 | 「骨架」全仓 **0 处**（`grep -rn "Skeleton" apps packages --include=*.tsx --include=*.ts --include=*.css` 的唯一命中是 `manualChecklistSkeleton`，那是 `packages/app-host/src/ai-breakdown.ts:427` 的**文本模板**，不是 UI）；「行内转圈」也不存在：`packages/ui/src/task-list/TaskRow.tsx:357-359` 的 `busy` 只写 `aria-busy` + `disabled`，**不画任何可见指示**。`ActivityIndicator` 只在 `SyncStatusBar.tsx:128`、`DangerDialog.tsx:203`、`mobile kit.tsx:862`、`chat-composer.tsx:92` 四处，全是**动作忙碌**，不是"内容还没来" |

### 3.1 排序与收口步数

```
建议1（定四档）──┬─→ 建议2（web 壳转发）─→ 建议3（mobile kit 转发）
                 └─→ 建议4（错误层）
                    建议5（加载档，与 4 并行即可）
```

- **最少 5 步**能把**形态**收口（建议 1-5）。
- 🔴 **6 步才能收口"判据"**：第 6 步 = `scripts/check-state-tiers.mjs`（账本制：每行登记一个容器的档，
  账外新容器 ⇒ 红；同一容器换档且未改账本 ⇒ 红；读数掉了不改账本 ⇒ 红，与 `check:settings-prose` 同一纪律）。
  **1 个文件**。它不做，PRD 那三条判据一个字都落不了地 —— §1 的 27 行「无判据」就是它缺席的形状。

---

## 4. 反向结论：哪些容器**不该**改成居中空态

> 这一节是 PRD 里**被否掉的方案**（"全站一个居中空态"）的挡箭牌。后来者若想把下面任一格改成
> `size="page"`，请先读完它自己那一行理由，再看它后面那条判据。

| 容器 | 现有落点 | 为什么**不能**居中 | 改成居中会撞到什么 |
|---|---|---|---|
| **四象限四格** | `quadrant/QuadrantBoard.tsx:424` → `emptyMessage` | 每格约 1/2 宽 × 1/3 高，四格同屏。居中大块会让四个格读成四个空页，而**引导文案同时出现 4 次** | 🔴 `apps/web/tests/quadrant-empty-state.spec.tsx` 的判据 a：「同类『拖任务到这里』的引导文案**同屏最多 1 处**」。这条正是 2026-10-06 的整改结论（`docs/research/product-level-ia-ux-audit.md` §4-5），**改成居中 = 把它已经灭掉的病灶重新长回来** |
| **侧栏清单 / 标签** | `OrganizerList.tsx:802-834` | 它是「清单」/「标签」**分组标签的下属**，只有 11-14px 的行距空间。居中会盖过分组标签 | `OrganizerList.tsx:806-829` 的注释记着实测：曾经用 `row-title`（16px）⇒ 分组头 11px、下面说明 16px，**倒挂 1.45 倍**，产品负责人原话「那为什么这个标题那么小，反而是下面说明的文本那么大呢？」。`packages/design-system/tests/typography.spec.ts` 钉着"组标题档压得住它管辖的每一档说明" |
| **看板每一列** | `kanban/KanbanView.tsx:252`（今天**无空态**） | 列宽约 1/4 屏。居中是四格那种错的重演 | 无现有判据 —— 但**这里该补的是"卡片档"而不是"居中"**：它缺的是空态本身（见 W17），不是档 |
| **月历格 / 日档「全天」带** | `CalendarBoard.tsx:739`、`CalendarDayBoard.tsx:150` | 格高 ~100-200px、带高 ~48px。`page` 的 `paddingVertical: space.16`（64px）×2 就撑破容器 | `apps/web/tests/calendar-day-view.spec.tsx` 钉"这句话说的是哪个范围"（全天 vs 整日），居中会让那句判断被一块大留白淹掉；且 §1 的 W8/W9 两行同源，改一处漏一处 |
| **设置行内（通行密钥 / 记忆 / 同步设备）** | `PasskeyPanel.tsx:300`、`MemoryPanel.tsx:206,267`、`VaultSettingsPanel.tsx:551` | 设置界面的每一个控件旁边只许出现**控件本身**；居中大块空态 = 在设置页里造一块"未完成"的视觉 | 🔴 `design-system.md:113-141` 的**禁令**（产品负责人原话两次）+ `pnpm check:settings-prose`（账本制）。居中的 `title`+`hint` 两行会被读成"说明文字又回内联了" |
| **任务详情里的子段（标签/子任务/附件）** | `TaskDetailSheet.tsx:2001,1379,1494` | 详情面里的一段，上下都是别的段。居中会把它读成一屏的结论 | 详情面是**卡片**语义：一段没有内容 ≠ 这一页没有内容 |
| **评论区** | `CommentThread.tsx:94` | 同上，且它已经是对的档（一行 `row-meta`） | 居中会把"还没有评论"抬高到与帖子正文同级 |
| **搜索的「还没输入」** | `SearchPanel.tsx:209` | 它是 `prompt`（**纯文字**），与 `:215` 的「没找到」（`page`）是**两件事** | `SearchPanel.tsx:209-212` 的注释明写：「"还没输入"与"没找到"是**两件事**，文案不同 —— 合并成一句会让用户以为自己的库里真的什么都没有」。把 209 也做成居中空态 = 这两件事重新合并 |

### 4.1 还有一条反向结论：错误态**不许**成为空态的第五档

`empty-state/model.ts:220` 的 `detailTone` 默认 `'danger'`、`:235` 的 `detailRole` 在 danger 时给 `'alert'` ——
这两行是**错误借用空态**的入口。今天 M1/M2 就是沿着它把"读库失败"渲染成了空态。
所以「把 `detailTone='danger'` 用起来」不是修法，**它就是病灶本身**：
一个容器的"没有内容"与"没读到内容"共用同一个根节点的 `padding`、`alignItems`、`justifyContent` 时，
用户与判据都分不出这两件事。**错误层必须是另一个组件（建议 4），不是 `EmptyState` 的一个枚举值。**

---

## 5. 分母（扫了多少、排除了什么、命令）

### 5.1 扫了多少

| 范围 | `.tsx`（非 spec） | 命令 |
|---|---|---|
| `apps/web/src/features/**` | **112** | `git ls-files 'apps/web/src/features/**/*.tsx' \| grep -vc '\.spec\.'` |
| `packages/ui/src/**`（排除 `task-list/`） | **63** | `find packages/ui/src -name '*.tsx' ! -path '*task-list*' ! -name '*.spec.tsx' \| wc -l` |
| `apps/mobile/src/screens/**` | **38** | `find apps/mobile/src/screens -name '*.tsx' ! -name '*.spec.tsx' \| wc -l` |
| **合计** | **213** | 上面三条相加 |

- **容器数：32 个**（表格行数，即 `file:line` 有落点的那些"一块面"）。
  ≥1 个容器被扫过的文件算"已扫"，但只有 32 个文件提供了**容器的状态渲染点**。
- **额外读了（不在分母里，但结论引用它们）**：
  `apps/web/src/App.tsx`（只读，`App.tsx` 归另一条线）、`apps/web/src/main.tsx`、
  `apps/web/src/boot-splash.ts`、`scripts/check-empty-state.mjs`、
  `packages/ui/src/task-list/TaskList.tsx` + `TaskBoard.tsx` + `TaskRow.tsx`（**只读**，T0 正在改）、
  `apps/web/tests/{quadrant-empty-state,empty-state-action,task-action-error,trash}.spec.tsx`。

### 5.2 排除了哪些（带理由）

| 排除 | 理由 |
|---|---|
| `packages/ui/src/task-list/**` | 🔴 T0 正在改（任务书禁令）。本文件只**读**它的 `emptyMessage`（`TaskList.tsx:138,341`）与 `labels.empty`（`TaskBoard.tsx:94,316`）—— 这两条是 W7/W17 的成因，必须引用，但**一行都不改** |
| `apps/web/src/App.tsx` | 🔴 另一条线在改（任务书禁令）。本文件引用 `App.tsx:269,3213,3299` 只为定位挂载点 |
| `packages/i18n/**` | 🔴 任务书禁令。所以本文件**不提"该加什么词条"**，只提"哪一格少一个渲染分支" |
| `apps/desktop-windows/**`、`scripts/check-windows-signing-posture.mjs`、`scripts/reinstall-all.sh` | 🔴 主树里别人的未提交改动（`git status --short` 现量），一行没碰 |
| `*.spec.tsx` / `*.test.tsx` | 不是容器。只在判定"判据"列时读它们（见 §1 表末列） |
| `e2e/**` | 🔴 任务书禁令（不跑 e2e）。**注意**：`e2e/tests/control-semantics.spec.ts`、`focus-visible-matrix.spec.ts` 这类真浏览器尺**存在**，所以"无判据"要读成"jsdom/静态层无判据"，不是"仓库绝对没有" |
| `apps/landing/**`、`server/**` | 不在 R11 射程（另一张脸 + 服务端） |
| `packages/ui/src/{icon,material,theme.tsx,index.ts}` | 非容器（字形 / 材质 / token 装配 / 导出表）。`index.ts` 只在建议 2/3/4/5 里作为"必须末尾追加"的**改动点**出现，不作为容器 |

### 5.3 跑过的命令（全部只读，rc 已贴）

```bash
# 1) 门禁读数（唯一跑过的判据）
node scripts/check-empty-state.mjs        # rc=0；扫 264 文件 / 24 登记站点 / 1 条过期账

# 2) 事实核对
git log --oneline -1                      # 68c2330e7
git status --short                        # 三个别人的 M
grep -rn "function EmptyState" apps/web/src apps/mobile/src packages/ui/src
grep -rn "Skeleton" apps packages --include=*.tsx --include=*.ts --include=*.css   # 唯一命中是文本模板
grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" apps packages --include=*.tsx | grep -v /tests/   # 1 命中：apps/landing/src/components/SceneBoundary.tsx:55
grep -rn 'role="alert"' apps/web/src/features --include=*.tsx | wc -l              # 41
```

🔴 **没跑**：`pnpm test`（全量 vitest）、任何 `e2e`、`pnpm verify:*`、`pnpm build`、`reinstall:all` ——
机器上有别的线在跑测试，静默跳过比假红好。

---

## 6. 我知道但没做的

1. **没有量几何**。`page` 档的 `paddingVertical: space.16` 在真浏览器里到底占多少 px、月格内会不会撑破，
   本文件只按 token 名推断（`space.16` = 64px @16），**没有截图、没有 `getBoundingClientRect()` 读数**。
   这类结论属于 §6.2 的真浏览器验收，而本次任务禁跑 e2e。⇒ §1 里所有"会撑破布局"的说法都是**推断**，
   可信度低于带行号的那些事实。
2. **没有判"好不好看"**。本文件只判"形态与容器是否匹配"（任务书要求）。所以 W7 的 `emptyMessage`
   在四象限格里的**视觉密度**、W14 的插画与动作槽的配比，一律未评价。
3. **没动 `App.tsx` 里那 41 处 `role="alert"`**。它们分属 20+ 个文件、每条的形状都不一样，
   收成本文建议 4 的一个组件是 T3 那一整批的活，不是本份盘点能顺带的。且这会与
   `scripts/check-overlay.mjs` 的账本、`check:settings-prose` 的例外清单同时打交道 ——
   一次改 41 处而判据只有"跑起来了"，正是 `design-system.md:152-153` 明确反对的那种改法。
4. **没有给"骨架"定档位**。骨架的条数（3 条？5 条？按容器高？）、是否带 shimmer、
   `prefers-reduced-motion` 下怎么降级 —— 这些是设计决策，本文件只指出"全仓 0 处"这个事实，
   并发现在建议 5 里写成"最小可用"（N 条等宽条 + `aria-busy` + 静态降级），留待评审。
5. **`packages/ui/src` 那 5 处手写空态没有逐个判定该落哪一档**。本文件只给出
   "它们在门禁射程外"这个事实（§2.3）与其中 3 处的档（W6=`line`、W7=`card`、W15=`line`）。
   `AuthForm.tsx:711` 与 `CommentThread.tsx:94` 没进表 —— 前者是认证面板的"不是成员"终态、
   后者是评论区，两者都不在 R11 射程的十个 feature 里，所以只登记、不判定。
6. **没核 Windows / 桌面壳**。`apps/desktop-windows/**` 有别人在飞，且窗口态的"空"与 web 不同源。
