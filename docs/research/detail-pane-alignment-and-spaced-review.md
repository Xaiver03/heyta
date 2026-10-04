# 滴答清单：详情面对标 + 背诵差异化（合并调研）

> 状态：**调研记录**（只给证据、落点与"要拍的值"，**不下结论** —— 按 [docs/README.md](../README.md) §一，选型要另开 ADR；工单分解在 [detail-pane-alignment.md](../plans/detail-pane-alignment.md)）
> 调研日期：2026-10-03
> 本文**取代并合并**同日曾短暂存在的两份文件：`detail-pane-three-column-alignment.md`、`spaced-repetition-and-recitation.md`（两者均未提交、未进任何提交历史，内容已全量并入本文，不留抄件）。
> 证据来源：① 产品负责人 2026-10-03 分两批提供的 6 张截图（滴答 macOS：任务视图两态 / 番茄专注 / 习惯；heyta：番茄钟 / 侧栏）；② 四家一手规范（Part A §1）；③ 两条独立的代码级现状审计 + 若干次自己跑的 `grep`（本文所有 `file:line` 是 2026-10-03 工作树现量）。
> ⚠️ 行号会漂。本文每条开工前 `grep -n` 复跑 —— 这也是 [plans/README.md](../plans/README.md) §七.4 规定**计划层不写行号**的原因。

**全文分两部分**：Part A 是**对标**（详情面 / 习惯 / 番茄钟，纯 UI 与聚合层，多数不碰协议）；Part B 是**差异化**（背诵 / 间隔重复，要新增事实记录，属决策轨）。两条轨的**决策依赖不同**，所以合并但不混排。

---

# Part A · 详情面对标

## A0. 结论摘要

1. **缺的不是"第三栏"，是"选中态"这个概念。** web 与共享层里任务的"当前选中 id"**为零**：`TaskState` 只有 `filter`（[`apps/web/src/features/tasks/store.ts:72-75`](../../apps/web/src/features/tasks/store.ts)），web 两处 `TaskList` 都没传 `onOpenTask`（[`apps/web/src/App.tsx:1963-1974`](../../apps/web/src/App.tsx)、`:2027-2037`），而行组件对"没传"的处置是**行体根本不可点**（[`packages/ui/src/task-list/TaskRow.tsx:302-317`](../../packages/ui/src/task-list/TaskRow.tsx)）。
2. **web 从来没有任务详情面**（仓库自己已登记：[ui-review-fill-zh-timeline.md](../plans/ui-review-fill-zh-timeline.md) `:1199-1201`）。字段编辑是一排 `<details>` 内联展开（`App.tsx:756-911`）。
3. **习惯页其实已经有右窗格** —— 它是仓库里唯一的 master-detail（[`apps/web/src/styles/app/habits.css:15`](../../apps/web/src/styles/app/habits.css)，产品负责人 2026-10-01 定的形态）。所以习惯那一页的差距**不是结构缺失，是窗格内容与布局层级**（A5）。
4. **番茄钟的缺口比界面深一层**：`FocusSession` 没有 `mode`（正计时在数据模型里就不存在）、没有 `note`，`FocusActions` 只有 `log`/`listSessions` —— 滴答那张「添加专注记录」表单**不是缺入口，是缺整条写路径**（A4）。
5. **常驻槽可以要，那张插画不能抄。** 被明文否决的是"无详情时放一张 36% 宽的**空态插画**"（[multi-end-unified-strategy.md:622](../plans/multi-end-unified-strategy.md)），而**槽位本身**在同文 §5.2 `:605` 里被量成"详情面板 ↔ 空态插画，**同一个可复用插槽**"。第二批截图把这件事定死了：**滴答任务视图无选中时右栏就是纯装饰插画**（A3 状态一）⇒ 那条否决**成立且被印证**。但滴答番茄专注页无选中时放的是**概览统计 + 专注记录 + 补录入口**。⇒ 结论不是"抄不抄"，而是**同一格里我们该放更多东西**（A1 的 R-1）。
6. **有一格明确不许对齐**：滴答习惯卡片的图标是 **emoji**（📘/笑脸/月亮，[dida-capture/INTERFACE-NOTES.md:188-193](dida-capture/INTERFACE-NOTES.md)），而 [AGENTS.md](../../AGENTS.md) §5 把"用 emoji 当图标"列为硬错。我们已是 Lucide 闭集 8 个 key（[`packages/domain/src/habit-icons.ts:35-44`](../../packages/domain/src/habit-icons.ts)）—— **保持现状，不对齐**。
7. **对齐详情面的成本比看起来小：写动作早就齐了。** `TaskActions` 已有 **16 个写动作**（rename / setCompleted / toggleCompleted / remove / restore / purge / setPriority / setImportant / setQuadrantDrop / setDueDate / postponeToToday / setNote / moveToProject / setParent / setTags / setRepeat，见 [`packages/app-host/src/actions.ts:124-350`](../../packages/app-host/src/actions.ts)），`Task.startDate` / `Task.durationMinutes` **已在模型里**（[`packages/domain/src/entities.ts:143`](../../packages/domain/src/entities.ts)、`:152`）并被 **mobile 详情面消费**（[`apps/mobile/src/screens/TaskDetailSheet.tsx:200`](../../apps/mobile/src/screens/TaskDetailSheet.tsx)、`:740-762` 的 `setSchedule`）。⇒ 缺的是**web 那一栏 + 选中态**，不是字段、不是动作、不是 schema。
8. 🔴 **确证一处文档过期（两个独立来源对撞）**：[docs/README.md:131](../README.md) 对 [ADR-0043](../adr/0043-timeline-p2-task-start-date-duration.md) 写「⚠️ 代码未开工」，但 [plans/README.md](../plans/README.md) §一 的 `goal-timeline-rework.md` 那行明写「✅ 已完成（P1 + P2）… **ADR-0043 的字段 / `setSchedule` / 三态生产者 / 拖拽手势全落地**」，且代码里字段与移动端排期 UI 都在。⇒ **是 README 那半句过期**，不是"开工"定义不同。引用 ADR-0043 状态时以 plans 索引与代码为准。
9. **顺手照出的一条门禁盲区**（与本文主题正交，但取证时撞上的）：`docs-link-check` 判"是否被 git 跟踪"用的是 `git ls-files -z`（[`research/tools/docs-link-check.mjs:119`](../../research/tools/docs-link-check.mjs)），而 `git add -N`（intent-to-add）会往索引里写一条**空 blob** —— 于是**占位登记就能让"本机有、仓库里没有"这一半检查变绿，而 HEAD 里根本没有该文件**。2026-10-03 实测到 8 份 `docs/research/*.md` 处于该状态。登记在 [BLOCKED.md](../../BLOCKED.md) 之前请先确认归属（那 8 份里只有 2 份是本次的）。

## A1. 业界一手规范：四家各自规定了什么

| 来源 | 它实际规定的内容 | 数值 |
|---|---|---|
| [Apple HIG · Split views](https://developer.apple.com/cn/design/human-interface-guidelines/split-views) | 栏角色 = primary(导航) / secondary(选中项内容) / **tertiary 可选**；**"在每个通向详情的栏里持续高亮当前选中项"**；**"prefer a split view in a regular — not a compact — environment"**；要给 min/max 合理默认（栏太窄时**分隔线看起来会消失、于是拖不动**）；**允许隐藏栏，但必须提供多种恢复方式**（工具栏 / 菜单 / 快捷键） | 无固定 px |
| [Microsoft · List/details pattern](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details)（2026-09-27 更新） | stacked = 一次只看得见一栏，用户"下钻"，**看起来像两个页面**；side-by-side = 两栏同时可见 | **320–640 epx → stacked；641 epx 及以上 → side-by-side** |
| [Microsoft · `ListDetailsView.NoSelectionContentTemplate`](https://learn.microsoft.com/en-us/dotnet/api/communitytoolkit.winui.ui.controls.listdetailsview.noselectioncontenttemplate?view=win-comm-toolkit-dotnet-7.0) | "没有选中"是详情栏的**一等内容状态**，有专门模板槽（默认 `null`） | — |
| [Android · 窗口尺寸类](https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes) | 先为 Expanded 设计，再定 Medium，最后保证 Compact；🔴 **两栏在"宽度 Medium 且高度 Compact"时不可行**（横屏手机）⇒ **塌缩判据必须同时看高** | 宽 <600 / 600–840 / 840–1200 / 1200–1600 / ≥1600 dp；高 <480 / 480–900 / ≥900 dp |
| [PatternFly · Primary-detail](https://www.patternfly.org/patterns/primary-detail/design-guidelines) | 用于"大集合里定位排序 + 不丢上下文地编辑"；**无选中时在详情区显示引导空态** | 半 / 三分之一 / 四分之一 |

**合起来给出的四条规则**（本文对"怎么做最好"的回答）：

- **R-1 常驻栏要始终承载内容** —— 两家框架都把 no-selection 当成**内容态**而非"隐藏这栏"。⇒ 右栏平时放**当前视图的概览与记录**（滴答番茄专注页正是如此），不放装饰。
  🔴 **这条的推理在 2026-10-03 的第二批一手核对里被推翻了一半，原句留在这是为了让下一个人不再走同一条**：
  ① "**放当前清单的统计概览**"这个具体主张**没有任何一家一方文档这么做**（见 C1b-Q1 的分布第 2 条）——
  我当时是从"API 有一个 no-selection 槽位"推出"槽位里该放概览"，那是把**接口形状**当成了**内容主张**；
  ② Microsoft 的 list/details **整页没有一句**提到未选中时显示什么（缺席即证据，不是支持）；
  ③ 一方文档真正说过的只是"给一行提示字"（Outlook 默认态 "Select an item to Read"，
  且"自动预览最新一封"是**默认关闭**的选项）与 Android 规范布局的 "**placeholder** detail pane"。
  **仍然成立的部分**：这栏平时不该是装饰（那条否决照旧），以及"没选中"是一等状态而不是让整栏消失。
  概览方案降级成 C1b-Q1 的**推荐**而不是**依据**，拍板时按推荐 2 的代价读。
- **R-2 塌缩阈值要同时看高** —— 我们现在只有**一个宽度断点** `@media (max-width: 768px)`（[`apps/web/src/styles/app/narrow.css:7`](../../apps/web/src/styles/app/narrow.css)、`:136`，另 `inbox.css:368`），**没有中间档**，也**完全不看高度**。Android 那条反例正是我们的盲区。
- **R-3 选中态要在每一级都可见**（Apple）。我们现在连"选中"都不存在于任务侧（A0.1）。
- **R-4 要能收起，且有多条恢复路径**（Apple）。**滴答没做** —— 也是让"36% 纯浪费"这条否决彻底失效的唯一做法。

## A2. 与仓库既有裁决逐条对账（不许悄悄推翻）

| 既有裁决 | 出处 | 本文的关系 |
|---|---|---|
| 右栏 36.2% 被量成"详情面板 ↔ 空态插画，**同一个可复用插槽**" | [multi-end-unified-strategy.md:605](../plans/multi-end-unified-strategy.md) §5.2 | 槽位概念**早就在案**，不是新想法 |
| 🔴 不抄"右栏 36% 宽空态插画区"（"无详情时纯浪费；窄屏/移动端必须回收"） | 同文 §5.4 `:622` | ✅ **被印证，继续有效、不重开**。但它管的是**里面放什么**，不是**要不要这个槽**：槽常驻（R-1）+ 里面放视图级概览（滴答番茄页自己的做法）+ 窄屏回收与可收起（R-2/R-4）⇒ 三条同时满足就是"对齐了交互逻辑又没违反裁决" |
| 侧栏「清单/过滤器」**空态引导卡**不抄（吃大量纵向空间） | 同文 §5.4 `:624` | ✅ **第二次印证**：A3 状态一里两张灰底引导卡吃掉侧栏约 1/4 纵向，传达的信息只有一句"这里可以建清单" |
| 习惯"进度三层"（表头环形 + 卡片 7 点阵 + ⚡/ 徽标）= **最值得抄的第 5 条** | 同文 §5.3 `:615` | 习惯中栏那部分**已有授权** |
| 🔴 **复选框颜色即优先级** = 最值得抄的第 3 条（"不占第二个字段位，白赚一档信息密度"） | 同文 §5.3 `:613` | ❌ **至今未落地**：我们的优先级是行内一枚 Flag 徽标 + 同色文字（[`packages/ui/src/task-list/TaskBadges.tsx:158-163`](../../packages/ui/src/task-list/TaskBadges.tsx)） |
| 外壳四段骨架的第 ④ 段 = "详情：桌面第三列 / 手机进下一级 / **随选中项变**" | [dida-view-unification.md:256](dida-view-unification.md) §1.3 | 🔴 **该段的落地记录里从来没出现**（同文 §落地勘误 `:58-70` 只做了 ①②③）⇒ 本文诉求 = 把那条**已写好但没做**的第四段做掉 |
| "一个组件、三个尺度"：习惯打卡圆 = 列表 7 日行 / **详情面板整月网格** / 日历日格徽标 | 同文 §4 `:289` | **详情面里的整月网格早已拍板**。数学现成：`monthGrid`（[`packages/domain/src/date.ts:341`](../../packages/domain/src/date.ts)），目前**只被 `DatePicker` 消费**（[`packages/ui/src/date-picker/DatePicker.tsx:157`](../../packages/ui/src/date-picker/DatePicker.tsx)）⇒ 缺的是第三个消费者，不是数学 |
| 「任务详情 → 我们：**？未盘点**」 | [multi-end-unified-strategy.md §7.1e:1196](../plans/multi-end-unified-strategy.md) | 本文 A3 就是那次盘点 |
| 🔴 **禁止把番茄钟硬塞进列表模型**（"统一是契约一致，不是形状一致"） | [dida-view-unification.md:445](dida-view-unification.md)、`:494` | **Part A 唯一一处真冲突**，必须写进验收：番茄页中栏**仍是计时器**，右栏是"概览 + 记录"，**不许**改成"列表 + 详情" |
| 次级表面应是**浮层**，不是一路由 | 同文 §7.1e `:1202-1204` | 新增常驻详情栏**不许**顺手把设置/搜索搬进右栏 —— 会直接打红 [`apps/web/tests/settings-sheet-ia.spec.tsx:1-16`](../../apps/web/tests/settings-sheet-ia.spec.tsx)、[`apps/web/tests/search-overlay-ia.spec.tsx:1-20`](../../apps/web/tests/search-overlay-ia.spec.tsx) |
| 取证曾记"习惯页右栏 = 空态插画 ⇒ 滴答习惯**没有**详情栏" | [dida-capture/INTERFACE-NOTES.md:32](dida-capture/INTERFACE-NOTES.md) | 🔴 **被推翻**（截图里学英语有完整详情面）。原文按 research 层纪律不改，勘误见 A6 |

## A3. 任务视图两态：详情面**首次**取证

**状态一（无选中）**：第四栏 = 一张**纯装饰线稿插画**（书本/铅笔/咖啡/勾选框/笑脸卡 + 若干 `✕`），**零文字、零按钮、零数据**。第二栏自上而下：今天 9 / 最近 7 天 13 / 收集箱 11 → 「清单」+ 灰底引导卡 → 「过滤器」+ 灰底引导卡 → 标签 5 条（各带彩色圆点）→ 已完成 / 垃圾桶。

**状态二（选中一条）**：第三栏该行变浅灰底、**行左出现 `⋮⋮` 拖拽手柄**；第四栏换成详情面：

| 滴答详情面位置 | 内容 | heyta 对应 |
|---|---|---|
| 顶部第一行左 | **优先级色的空心复选框**（截图橙色） | 🟡 有复选框但颜色不表达优先级（见 A2 第 5 行） |
| 顶部第一行中 | **起止日期区间**「10月1日 - 10月7日」 | ✅ 语义已在模型（A0.7）。⚠️ **web 无入口**（详情面不存在），mobile 有排期编辑 |
| 顶部第一行右 | 红旗（标记）+ 一个 `≡` |  优先级走 `setPriority`（`actions.ts:190`）；"标记/flag"作为独立概念**未找到** |
| 标题 / 正文 | 大号标题 + 备注全文 | ✅ `setNote`（`actions.ts:269`）；web 现状是 `<details>` 内联展开 |
| **中间整片空白** | 子任务/提醒/附件/标签等区块**无数据时不出现** | 🔴 **两种哲学**：滴答 = 空即隐藏；我们 = chip 常驻 + `<details>`。⇒ 详情面设计的**第一个决定**（A7.8） |
| 底部左 | 所属清单「📁 收集箱」 | ✅ `moveToProject`（`actions.ts:271`） |
| 底部右 | 三个图标 `A` / 💬 / `…` | ⚠️ 语义**未取证**（无 tooltip）；评论/附件本次**未核**，现量命令 `grep -nE "comment\|attachment" packages/domain/src/entities.ts` |

**两条跨面事实**：① 滴答「今天」列表把**三种异构内容**混排同屏（「倒数纪念日 1」「今天 4」「习惯 4」）⇒ 与 [dida-view-unification.md:383](dida-view-unification.md)、`:385` 的"8 视图里 5 个走 `ListSurface`"同向，**已有裁决支持**；② 习惯行内直接显示「**0/5 页**」⇒ 第二次坐实 A5 那条"最重要的一米"。

## A4. 番茄钟：逐元素对照

**中栏**：滴答有「番茄计时/正计时」分段控件、右上 `+ / 静音 / …`、「专注 ›」入口；我们**只有计时器本体**（共享一份实现 [`packages/ui/src/focus/FocusPanel.tsx:180-227`](../../packages/ui/src/focus/FocusPanel.tsx)、`FocusRing.tsx:69-78`）。分段控件缺在**数据模型层**：`FocusSessionKind = 'work'｜'shortBreak'｜'longBreak'`（[`entities.ts:317`](../../packages/domain/src/entities.ts)）**没有 `mode`、没有 stopwatch 值**。声音缺在**全仓无音频代码**（[dida365-feature-benchmark.md:122](dida365-feature-benchmark.md)）。
反向差异（我们有、滴答截图没有，**保留**）：中止按钮、关联任务下拉、时长设置四格（`FocusPanel.tsx:230-254`；[`apps/web/src/features/focus/FocusTimer.tsx:276-311`](../../apps/web/src/features/focus/FocusTimer.tsx)、`:61-188`）。

**右栏（滴答常驻，我们结构上不存在）**

| 滴答 | heyta 能不能算 | 缺在哪层 |
|---|---|---|
| 今日番茄 | ✅ [`packages/domain/src/focus.ts:381-406`](../../packages/domain/src/focus.ts) `completedWorkCount` | 只是没有卡 |
| 今日专注时长 | ✅ `focus.ts:399`，但 **mobile 有卡、web 专注页没有**（[`apps/mobile/src/screens/FocusScreen.tsx:341-344`](../../apps/mobile/src/screens/FocusScreen.tsx)） | 🔴 **两端不对称**，web 缺 |
| 总番茄 | ❌ **`ActivityTotals` 只有 `focusMs`，没有 `focusCount`**（[`packages/domain/src/milestones.ts:29-37`](../../packages/domain/src/milestones.ts)、`:56-65`） | 领域层加聚合 |
| 总专注时长 | ✅ `milestones.ts:59-65` → [`packages/app-host/src/motivation.ts:105-111`](../../packages/app-host/src/motivation.ts)，但**只活在分享纯文本与里程碑阶梯里** | 有数、没面 |
| 「专注记录」列表 | ❌ **一条专注记录都没被逐条渲染过**：`listSessions()` 全仓唯一消费者是 `FocusScreen.tsx:196`，且只喂给 `focusStatsForDay` 做当日汇总 | 界面层（数据在） |
| 「添加专注记录」表单（任务/开始/结束/类型/**笔记**） | ❌ **缺整条写路径**：`FocusActions` 只有 `log`/`listSessions`（[`packages/app-host/src/focus-actions.ts:35-53`](../../packages/app-host/src/focus-actions.ts)），且 `log` 前置明写"**只接受已经结束的轮次**"；`FocusSession` **无 `note`**；全仓 `FOCUS_SESSION` 写入点只有 `focus-actions.ts:139` 一处 | 领域 + 动作 + 界面 |
| （对照）~~滴答桌面端"仅可补记不可删"~~ → **这句在本表里曾是硬规则，2026-10-04 一手调研后改成"平台不对称"**（详见下面 C1b-Q6 那一节：滴答**移动端可删**、桌面端明文"不支持删除番茄记录"；被两家明文拒绝的是**改时长**，不是删除） | 我们 `FOCUS_SESSION` **连删除动作都没有**（`docs/research/trash-and-archive-best-practice.md:181`、`:191`），且"不做删除"是**已拍决定**（`docs/plans/trash-and-archive.md:237`）。⚠️ 这两份按 2026-10-03 现量**只活在主检出的未提交改动里**（`git log --all --diff-filter=A` 查不到）⇒ 写成路径而不是链接，否则干净检出上是死链；那条决定的正文归回收站那条线自己提交。🔴 **"已拍决定"这一格仍然成立，但它现在是我们自己的立场，不再有同行依据**（三家提供删除，见 C1b-Q6）⇒ 要继续挂着就得补一条我们自己的理由 | 要改先重开那条决定，并**为"不给删除"补一条第一方理由** |

⚠️ ~~另有一处**文档与代码不符**：`docs/reference/architecture.md:129` 写着 `FocusSession — … mode(pomo/stopwatch), duration` —— 代码里没有这两个字段，不能拿它当"已建模"的证据。~~
🔴 **这句已经过期（2026-10-04 08:0x 现量）**：那一行是**本单 W0 自己修掉的**（载体 `0275867a`，10-03 19:25），
`docs/reference/architecture.md` 现在第 129 行写的是 `FocusSession — id, taskId?, kind(work/shortBreak/longBreak), plannedMs, actualMs?`，
与 `packages/domain/src/entities.ts:319-331` 逐字一致；全仓 `pomo/stopwatch` 现在只剩本行与工单 W0 那一格在**引用**它。
⇒ 保留原句（划掉）是因为它记着一个真事实：**"计时模式"从来没有被建模过**，而这一条正是下面 C1b-Q5 的起点。

## A5. 习惯：逐元素对照

**中栏**：滴答是**2 列卡片网格** + 标题「习惯 ⌄」+ 右上 视图切换/`+`/`…`；我们是**单列纵排**、无标题行、无视图切换（[`apps/web/src/features/habits/HabitsView.tsx:245-284`](../../apps/web/src/features/habits/HabitsView.tsx)、[`HabitsList.tsx:85`](../../apps/web/src/features/habits/HabitsList.tsx) + [`habits.css:66-73`](../../apps/web/src/styles/app/habits.css)）。
✅ 已有：圆形图标底盘（Lucide，非 emoji）、选中描边（`HabitsList.tsx:107`）、7 个圆点、徽标。
🟡 同名不同义：我们的 7 点是**最近 7 天滚动窗口**（[`packages/ui/src/habits/model.ts:65`](../../packages/ui/src/habits/model.ts)、`:265-283`），滴答是**日历周**（表头带 周日27…周六3 + 环形）⇒ 我们**没有表头环**。徽标我们三 chip（连续/最长/累计）vs 它两枚。
🔴 **周期徽标无从显示**：`Habit.frequency` **没有任何写入口**（`NewHabitFields` 里没有它，也没有 `setHabitFrequency`，见 [`packages/app-host/src/habit-actions.ts:48-147`](../../packages/app-host/src/habit-actions.ts)）⇒ **界面上永远只能建每日习惯**。

**右栏：六张统计卡 + 月历 + 图表**

| 滴答右栏 | heyta 右窗格 | 能不能算 |
|---|---|---|
| 月打卡 0 天 | ❌ | 🔴 **连函数都没有**（最接近的是滚动窗口 `heatmapTotal(days)`，`model.ts:197-199`，传 90/7 天，**不是自然月**） |
| 总打卡 8 天 | 🟡 近似物 `resilience.total = achieved.size`（[`packages/domain/src/habit-resilience.ts:197`](../../packages/domain/src/habit-resilience.ts)），但界面句子是「累计 N **次**」（[`zh-CN.ts:1116`](../../packages/i18n/src/locales/zh-CN.ts)） | 🟡 值等价、**口径要拍**（A7.2） |
| 月完成率 0 % | ❌ |  只有**单日**比例 `completionRatio`（[`habit-streak.ts:215-220`](../../packages/domain/src/habit-streak.ts)），其产出 `todayRatio`（`model.ts:120`、`:170`）**零渲染消费者** |
| 当前连续 0 天 | ✅ [`packages/ui/src/habits/HabitBoard.tsx:457`](../../packages/ui/src/habits/HabitBoard.tsx) | ✅ —— **六格里唯一真正对得上的一格** |
| 月完成量 0 页 | ❌ | 🔴 未找到 |
| 总完成量 65 页 | ❌ | 🔴 全仓对 `HabitLog.value` 的求和只有一处且**只处理"分钟"类单位**（[`activity-categories.ts:100-113`](../../packages/domain/src/activity-categories.ts)） |
| 月历（可点） | ❌ 现在是 **90 天周列热力图**，格子是裸 `View`、**无 `onPress`**（`HabitBoard.tsx:358-374`、`:625-696`） | 数学现成（`date.ts:341`），缺第三个消费者 |
| 每日完成量 (页) 图 | ❌ 未找到任何按习惯的单值时序图 | 🔴 **数据源本身不可达**，见下 |

🔴 **最重要的一米**：`HabitLog.value` **界面不可达** —— `HabitBoard` 回调只有 `onCheckIn(habitId, date?)`（`HabitBoard.tsx:180`），两端调用处都不带 value，落盘写 `value ?? habit.target ?? 1`（[`habit-actions.ts:311`](../../packages/app-host/src/habit-actions.ts)）。⇒ **计数型习惯只能"一键记满目标值"**，记不了"今天读 5 页 / 目标 8 页"。这条不修，「每日完成量」图与「月/总完成量」两卡**即使做出来也没有部分值数据**。它也正是 [dida365-feature-benchmark.md:224](dida365-feature-benchmark.md) 第 9 条"看起来有、其实没有"里**至今仍未修**的那一半（同表的 target/unit/goalType 已补，见 [multi-end-unified-strategy.md §幻觉复核第 9 项:821-860](../plans/multi-end-unified-strategy.md)）。

**补打卡**：滴答是点月历任意某天；我们只有"昨天"，且要同时满足 `REPAIR_WINDOW_DAYS = 1` 与 `current === 0` 两道闸（`HabitBoard.tsx:564-592`；[`habit-resilience.ts:58`](../../packages/domain/src/habit-resilience.ts)、`:226-250`）。🔴 且 `Habit.backfillDays`（`entities.ts:300`）是**死字段**：全仓只有两处声明、**零读取方** —— 而 [phase-1-single-client-loop.md:194](../plans/phase-1-single-client-loop.md) 写着"补打卡上限由 `Habit.backfillDays` 控制"。**那句承诺从未兑现。**

⚠️ 归属提示：本次审计读到 `HabitsView.tsx` / `store.ts` / `HabitsScreen.tsx` / `habit-actions.ts` 是**未提交状态**（改名与删除入口刚接上）。凡涉及"改名/删除有没有入口"，以提交后的 HEAD 再核一遍。

## A6. 勘误（两处，原句留档）

**① 仓库旧推断被否证。** [dida-capture/INTERFACE-NOTES.md:367](dida-capture/INTERFACE-NOTES.md) 曾记「⚡ = 连续天数、🔥 = 累计天数」，并自标注**这是推断**。本次截图第一次给出可核对的两组数：卡片「学英语 ⚡8天 🔥0天」对详情「总打卡 **8** 天 / 当前连续 **0** 天」。⇒ **对应关系是反的**：⚡ = 累计/总打卡，🔥 = 当前连续。旁证：四条习惯（阅读 ⚡22/🔥0、涂药膏 ⚡1/🔥0、早睡 ⚡21/🔥0）**全部 🔥=0**，与"当前连续"吻合（若 🔥 是累计，四条不可能同时为 0）。同一批截图也否证了同文 `:32` 那句"滴答习惯没有详情栏"。
🔴 两处原文按 research 层纪律**不改**（[docs/README.md](../README.md) §一：调研记录原则上冻结，结论有变时**新增**勘误）。后续任何文档引用 ⚡/🔥 口径时**必须以本节为准**。

**② 本文自己的一处过度外推（同轮）。** 初稿曾写「滴答的右栏**从来没有空着**……你的截图恰好是反证」。那是从**两张截图**（番茄专注、习惯）外推到全部视图，而当时**任务视图的无选中态根本没看过**。第二批截图显示那里就是插画 ⇒ 外推不成立，原句已就地改写（A0.5、A2 第 2 行）。
📌 **可迁移的规律**：**"某产品在 A 面这样"推不出"它在所有面都这样"** —— 尤其当手头样本恰好是**两个非列表面**，而缺的正是**最主要的那个列表面**。若产品负责人没有再补两张图，这句外推就会以"调研结论"的身份往下游传。

## A7. 落点与门禁（要动哪一层，会撞什么）

### A7.1 结构落点

- 外壳是**三层 grid，列数由修饰类决定**：默认两列（[`apps/web/src/styles/app/base.css:13-19`](../../apps/web/src/styles/app/base.css)），有范围列时三列（`:27-46`，中间列可拖宽 `clamp(min, 拖拽值, min(max,40vw))`），第三列只在 `view === 'tasks' || view === 'calendar'` 时出现（`App.tsx:500`）。**没有第四个槽位。**
- 🔴 **真正的拦路石不是列数，是 `.ht-content` 的 `max-inline-size: var(--ht-layout-content-max)`（1200px）+ `margin-inline: auto`**（[`main-area.css:105-107`](../../apps/web/src/styles/app/main-area.css)，token [`tokens.css:332`](../../packages/design-system/src/tokens.css)）。只要详情栏挂在 `.ht-content` 里面，它就永远**贴不到窗口右边缘**，读起来就不是三栏而是"中间一坨里再分两栏"（习惯页现在就是这个观感）。⇒ 第四列必须是 `.ht-app` 的**直接子项**，且 `content-max` 的语义要从"整个内容区上限"改成"中间列上限"。
- 🔴 改这条会牵动一个**已被测试钉住的行为**：`.ht-content` 的 `position: relative` 是 `.ht-sheet` 的定位上下文，"浮层只盖内容区、rail 与侧栏仍可见"（`main-area.css:108-110`）。详情栏搬出去之后，**设置/搜索浮层盖不盖右栏**是一个新决定（A2 末两条判据会当场红）。
- 归属：按 [dida-view-unification.md §4.1](dida-view-unification.md) 的 L0–L4，网格与位置属 **L3 外壳**（现实落点 `apps/web/src/features/shell/`，该目录被 L4 样式扫描**显式豁免**：[`scripts/check-l4-no-style.mjs:143-145`](../../scripts/check-l4-no-style.mjs)）；窗格内容若两端共用要进 `packages/ui`。🔴 `apps/*` 里不许出现"改这个字段该发哪条 op"的判断（AGENTS §3.5 + [`scripts/check-layering.mjs:128`](../../scripts/check-layering.mjs) `no-op-construction-in-apps`）。
- 需要新 token：`--ht-layout-detail-*`（宽/最小/最大）。规则是"要新变量先加 token"（AGENTS §5），改 `tokens.css` + `TOKEN_GROUPS`，且 `check:tokens` 与 `check:arkts` 会要求原生产物同步。

### A7.2 会当场打红的门禁（全部现量于 2026-10-03）

| 门禁 | 基线 | 撞法 |
|---|---|---|
| `check:l4` 内联样式**只许降不许升** | web features = **104**、mobile screens = **90**（[`check-l4-no-style.mjs:155`](../../scripts/check-l4-no-style.mjs)、`:162`），明写"不许为了让改动通过而调高" | 新窗格抄内联样式 = 直接推红。既有正解见 `main-area.css:37-47` |
| `check:row-single-source` 断言 B：`ht-*` 前缀族**只减不增** | 基线 **28**（[`check-row-single-source.mjs:85-91`](../../scripts/check-row-single-source.mjs)、`:341`） | 🔴 **新开 `.ht-detail*` 一族当场红**，除非同时消掉两族存量（这条真执行过一次：组头被逼成共享 `TaskGroupHead`） |
| 同门禁断言 A：任务行三信号同现只许在 `packages/ui` | — | 详情栏里重画一遍任务行（checkbox+标题+截止）= 当场红 |
| `check:empty-state` | — | 右栏无内容时**自己写一句"没选中任何东西"** = 红；正解是共享 [`EmptyState.tsx`](../../apps/web/src/features/shell/EmptyState.tsx) |
| `check:design` 裸值 | — | 新 CSS 里不许出现裸 hex/px/ms/z-index；豁免是**整行**级（`check-hardcoded.mjs:110`） |
| `check:ui-language` | — | 六张卡的句子必须中英同步进 [`packages/i18n`](../../packages/i18n) |
| `settings-sheet-ia` / `search-overlay-ia` | — | A7.1 末条：浮层覆盖范围一变就红 |
| `app-mount.spec.tsx`（rail 9 tab / 任务视图有 sidebar / 设置视图没有） | — | 第四列若用修饰类实现，要同步补判据，否则"哪几个视图有详情栏"又退回注释里的口头约定（`base.css:24-26` 的理由仍成立） |
| 真两列验收模板 | [`e2e/tests/habits-pane.spec.ts:9-12`](../../e2e/tests/habits-pane.spec.ts) | 🔴 jsdom 不做布局 ⇒ 详情栏必须比 `boundingBox()`，照这份写 |

### A7.3 响应式与回收（对齐 R-2/R-4）

现状：唯一宽度断点 768px、**不看高度**、**没有中间档**。可落的最小决定：详情栏的**出现条件**要同时是"宽度 ≥ 某档"且"高度不矮"；塌缩形态沿用已验证过的**并排 → 推进一层**（mobile 已是 `Modal`/push，见 [`TaskDetailSheet.tsx:385`](../../apps/mobile/src/screens/TaskDetailSheet.tsx)、`HabitsScreen.tsx:26-30`）；并提供**收起 + 多种恢复路径**（Apple R-4，滴答没有）。

---

# Part B · 差异化：背诵与间隔重复

> 这条轨与 Part A 的接缝只有一句：**复习的入口天然就是那个右栏**（无选中时放"今天到期的复习"，选中时放这张卡的记忆状态）。除此之外它的决策依赖完全不同（要新增事实记录、要排部署顺序），所以单独一轨。

## B1. 先确认这是一块空白，而不是一处遗漏

全仓 `docs/` 里 `艾宾浩斯|遗忘曲线|间隔重复|spaced repetition|FSRS|Anki` **命中 0 处**（2026-10-03 `grep -rn` 现量）；`背诵|记忆卡片|闪卡|flashcard` 只在两份**竞品盘点**里命中，且都不是待办产品：[`research/oss-task-manager-deep-dive.md:281`](../../research/oss-task-manager-deep-dive.md)、[`research/task-managers-comparison-2026-09-25.md:219`](../../research/task-managers-comparison-2026-09-25.md) —— 两条讲的都是 **SiYuan（AGPL-3.0）：有闪卡，但没有真正的任务管理**。

这恰好把空白切成两半：**本地优先 + 有闪卡**的阵营存在（说明"把记忆卡片放在自己设备上"在我们这个 niche 里是真实需求），但那个阵营**没有任务管理**；反过来，**待办阵营里没有间隔重复**。

竞品侧一手核对（滴答）：帮助中心完整目录 **97 篇**，类目为 任务 21 / 日历 9 / 四象限 3 / 番茄 6 / 习惯 4 / 倒数日 4 / 导入与关联 15 / AI 7 / 账号与安全 6…（[dida365-help-center-ia.md](dida365-help-center-ia.md) §类目树 `:100-110`、§类目计数 `:224-225`），**没有任何"记忆卡片/背诵/复习"类目**；番茄与习惯两类目全部篇目也逐条列过（同文 `:323-337`），里面没有复习排程。

用户在拿什么替代（**间接**证据）：在 Notion 里用公式手搓间隔重复，作者自陈动机是"备考需短时记忆大量内容"，**自己承认的局限**是"更针对时间上的重复，对学习内容的难易程度没有这么大的区分"（[少数派](https://sspai.com/post/64734)，2021-01-24）；把 Notion/滴答清单拼成"背诵学习系统"的教程 2026 年仍在产出（[示例](https://blog.csdn.net/weixin_28742653/article/details/160392300)）；专门的艾宾浩斯类 App 是一个活跃品类（记忆森林 / 记忆方舟 / Ebbinghaus / 墨墨背单词）。

🔴 **诚实的另一面**：竞品空白有两种解释 —— "没人要"或"没人做对"。**本文没有任何一手证据证明待办用户要背诵**（B6 第 5 条）。上面只到"存在替代行为"，不到"愿意为它换产品"。

## B2. 科学证据：哪条站得住、哪条不许写进文案

**艾宾浩斯遗忘曲线被独立复现过，但形状与教科书图不一样。** 一手来源：**Murre JMJ, Dros J (2015) Replication and Analysis of Ebbinghaus' Forgetting Curve. PLoS ONE 10(7): e0120644**（[PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0120644)、[PMC4492928](https://pmc.ncbi.nlm.nih.gov/articles/PMC4492928/)，引文行按 PMC 页原文核对）。按其页面：曲线**确实被复现**（savings 法）；但**不是完全平滑**，结论原句 "*…has indeed been replicated and … is not completely smooth but most probably shows a jump upwards starting at the 24 hour data point*"；在复现数据上**对数与幂函数拟合都差**，拟合最好的是**带一次上跳（boost）的幂函数**。

- ✅ 站得住、可进文案：**复习要按间隔安排，且第一次复习不应早于 24 小时**。
- ⚠️ **推论，不是论文结论**："1/2/4/8/15 天"这类经典序列把首复习放在 12h 或"当天晚上"是次优的 —— 要落地必须先做设计验证（B6 第 4 条）。
- 🔴 **不许写**：界面上不得出现"符合艾宾浩斯遗忘曲线"这种**形状层面**的背书。论文自己说平滑幂函数在复现数据上拟合不佳 —— 拿它当卖点就是拿一个**被这篇论文削弱的形式**去宣称科学。文案最多说"按间隔安排复习"。

**分散练习/提取练习是"高实用度"技术 —— 但本文没拿到一手摘要。** 教科书级评级来源是 Dunlosky et al. (2013), *Psychological Science in the Public Interest*，PMID **26173288**（PMID 与期刊名从 [PubMed 检索结果页](https://pubmed.ncbi.nlm.nih.gov/?term=Dunlosky+improving+students+learning+effective+learning+techniques) 现取）。🔴 摘要页两次取都失败（PubMed cookie 网关 / Europe PMC 403）⇒ **"practice testing 与 distributed practice 被评为 high utility"这一条本文未从一手核实**。补到一手之前，它只能当**内部选型依据**，**不得**进对外文案，也**不得**进 ADR 的"依据"栏。

**商业 SRS 的口径（参照，不是依据）**：墨墨背单词官方算法文档自陈其模型基于"**记忆保留率**"与"**遗忘临界点**"，间隔按每次学习时间与记忆状态动态规划，并称截至 2026 年累计记忆行为数据突破 **1900 亿条**（[官方文档](https://memodocs.maimemo.com/docs/algorithm-intro)）。⇒ 真正的含义在 B5：**它的护城河是数据量**，而这恰好是 heyta 在 E2EE 立场下拿不到也不该拿的东西。

## B3. 依赖两道门：实测结果（AGENTS §3.1 / §3.2）

用仓库自带工具现量（`python3 research/tools/ghinfo.py <owner>/<repo>`，2026-10-03）：

| 候选 | 许可证 | 最后提交 | 最新 release | stars | §3.1 | §3.2 |
|---|---|---|---|---|---|---|
| `open-spaced-repetition/ts-fsrs` | **MIT** | 2026-09-02 | `binding-win32-x64-msvc@0.6.0-beta.5` @ 2026-09-27 | 804 | ✅ | ✅ |
| `open-spaced-repetition/fsrs-rs` | **BSD-3-Clause** | 2026-09-30 | v6.6.2 @ 2026-08-28 | 438 | ✅ | ✅ |

两道门都过，在本仓库属**少数一次过的候选**。三条硬提醒：

1. **Anki 本体是 AGPL**（[Anki - Wikipedia](https://en.wikipedia.org/wiki/Anki)、[Anki（软件）](<https://en.wikipedia.org/wiki/Anki_(software)>)）⇒ **算法语义可学，代码一行都不能引**。这与 §3.2 里 `@nextcloud/cdav-library` 是同一种雷区，而 FSRS 生态（`fsrs4anki`）就长在 Anki 旁边，最容易顺手抄的正是它。
2. ⚠️ **未核实**：`ts-fsrs` 发布的是**含原生 binding 的多包**且当前是 **beta**。能否在 Hermes / 鸿蒙（bundle 魔数那条链，[§7 第 71 条](../reference/environment-traps.md)）里跑、纯 JS 路径体积多少 —— **必须先 spike**。
3. ⚠️ 正式采用前逐个进 [`research/tools/license-inventory.mjs`](../../research/tools/license-inventory.mjs) 登记（该门禁扫**实际安装树**，白名单外默认失败）。

🔴 **比许可证更前置的一件事**：FSRS 的价值来自**按个人历史优化参数**，这需要"复习事件"的历史。仓库现状里**没有任何这类记录**（B1 的全库零命中）。所以"要不要引入算法"在依赖层之前，其实是"**要不要新增一条只追加的复习事件**"。

## B4. 在 heyta 架构下它能长成什么形状

承重约束（它们直接砍掉大部分直觉方案）：

| 约束 | 出处 | 裁决 |
|---|---|---|
| 一个用户意图 = 一个 op；**被回放/远端来的 op 不得再触发副作用** | [AGENTS.md](../../AGENTS.md) §3.4 | "下次复习时间"**不许由 reducer 写**，必须读时算 |
| **派生的不持久化**；界面上不出现的东西不需要稳定持久化结构 | [ADR-0014](../adr/0014-memory-switch-and-corrections.md)、[ADR-0022](../adr/0022-resilience-state-stays-derived.md) | 记忆强度/保留率**每次从 op-log 重算** |
| 给持久化模型加**必填**字段会在 hydration 炸 | AGENTS §3.3 | 新字段一律可选 + 运行时默认 |
| 默认不 bump `CURRENT_SCHEMA_VERSION` | 同上 | 只有**纯可加性**新增实体可行 |
| 新实体**部署顺序是硬的**：服务端先认，客户端才能写 | [ADR-0044 §裁决②](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md) | 走 R2/R3 要**分两批** |
| 不发行货币 / 只与自己的过去比 / **从不制造愧疚** | AGENTS §9 激励红线 | 不许出现"你落后了 N 张卡"；"到期未复习"不许用危险色 |
| 托管 AI 与 E2EE 互斥 | [ADR-0006](../adr/0006-supply-modes.md)、[ADR-0013](../adr/0013-cloud-ai-and-maas.md) | **SRS 不触发这条**：不需要出境任何内容 |

三条候选路线：

- **R1 零新实体**：把复习表达成一条带重复规则的任务。现状最接近的是 `Habit.frequency` 的 `{ type: 'interval', everyNDays }`（[`entities.ts:266`](../../packages/domain/src/entities.ts)）与 `Task.repeatRule?: string`（`:175`）。**成本几乎为零**，复用已验收的重复链路（`pnpm verify:mobile-repeat`）。🔴 **致命局限：间隔是静态的**，不随"这次记住了/忘了"变化 —— 而这正是间隔重复的全部价值。⇒ R1 能当"复习提醒"的 MVP，**不能当"背诵模式"**；只做 R1 就不许出现"遗忘曲线/科学记忆"这类词。
- **R2 新增一条只追加的复习事件，"下次"纯派生**：照 `HabitLog { habitId, date, value?, note? }`（[`entities.ts:304-311`](../../packages/domain/src/entities.ts)）的形状立一个新实体（一次复习 = 一条 op：对象 id / 日期 / 自评结果 / 可选 note），**只追加不改写**，"下次该复习"从该对象的全部复习事件**读时重算**。与 §3.4 / ADR-0014 / ADR-0022 **完全同构** ⇒ 不 bump schema、不给既有实体加字段；可挂在任意对象上（TASK / NOTE / 将来的卡片）。需要新实体进 `EntityModelMap` + 服务端先认 ⇒ **两批落地**。
- **R3 独立"背诵卡片"实体 + 独立视图**：最像 Anki，三样代价全占（新实体含部署顺序 + 新 UI 面 + 新 IA 决策）。🔴 若走 R3，必须先回答"**为什么不直接把便签当卡片正面**"，否则同一内容两个事实源 —— `Note` 有 `content`/`imgUrl`/`isLock`（[`entities.ts:245-256`](../../packages/domain/src/entities.ts)），**没有 front/back 概念**。

（**倾向**，不是结论：R2 + 先只挂 NOTE 与 TASK。理由：复用"派生不持久化"纪律，且不需要新 UI 面就能出价值 —— 入口正好是 Part A 那个右栏。）

## B5. 为什么这件事**只有** heyta 这种产品做得顺手

差异化要成立，得是"对手结构上做不了或不愿做"，而不是"忘了做"。这里有一条结构性的：

- SRS 的算法优势来自**逐条复习历史**。云端 SRS 的护城河就是别人愿意交出的数据量（墨墨自述 1900 亿条）。
- heyta 从设计上**看不到用户明文**（AGENTS §1；服务端只存密文这条在验收里被反复钉住，见 [§7 第 52 条](../reference/environment-traps.md)）⇒ 我们**永远拿不到**那份护城河。
- 但反过来：**设备端本地优化是可行的**（`fsrs-rs` 官方就带 Optimizer 与 Scheduler），而且它是**唯一一条不需要用户信任服务器**的路径。Anki 有本地优化但界面是 2006 年的；SiYuan 有闪卡但没有任务；待办产品有任务但没有复习。
- 且它**不碰出境**：不需要 AI、不需要网络请求 ⇒ 不触发 ADR-0006/0013 那条互斥，也不进 `hosted-ai-monthly` 的计量（[ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) 那条"计量存在之前不得售卖"与它无关）。

⚠️ 边界：**免费还是付费本文不拍**。按 [subscription-boundary.md](../plans/subscription-boundary.md) "收费的是服务器不是功能"的口径，纯本地 SRS 天然落在免费侧 —— 但那需要产品负责人确认。

## B6. 未核实项（Part B）

1. **Dunlosky et al. 2013 的实用度评级**未从一手摘要核实（两次取回失败）。只证到 PMID 26173288 与期刊名。补法：取 SAGE DOI 原文 PDF，读 §Recommendations 那张分级表。
2. **竞品是否真的都没有 SRS**：只一手核了滴答（97 篇目录）与 Notion 生态（用户手搓）。Todoist / OmniFocus / Things / Sunsama / Motion / TickTick 国际版**逐个未核**。补法：逐家帮助中心检索 `review / repetition / interval`。
3. **`ts-fsrs` 的运行时形态**（原生 binding / 体积 / Hermes 与鸿蒙可用性 / 当前是 beta）未测。
4. **"首复习不早于 24h"是本文从 24h 上跳推出的设计含义**，论文本身没给产品建议。
5. **需求侧一手证据为零**：没有一条访谈/问卷证明待办用户要背诵。
6. **艾宾浩斯类 App 的规模与留存**未取（只有条目链接，没有榜单/评分量级）⇒ "这是被验证过的品类"这句话**当前无据**。
7. **SiYuan 闪卡的实际完成度**只到二手（盘点文档的描述）。

---

## C1. 要拍才能继续的值（两条轨合在一张表）

| # | 要拍的值 | 属于 | 卡住什么 |
|---|---|---|---|
| 1 | 详情栏放"仅选中项"还是"永远放概览+记录+选中项" | A | 决定 A0.5 那条裁决要不要动；决定右栏无内容时是否允许装饰 |
| 2 | 习惯统计三处口径：日历 vs 韧性 / 自然月 vs 滚动 / 天 vs 次 | A | 六张卡里五张的数值与句子 |
| 3 | ~~计数型习惯先修 `HabitLog.value` 那一米~~ ⇒ **这一格当初就放错了地方**：它不是"要拍的值"，是一个工程缺口，2026-10-04 已随工单 W6 落码（判据十一臂、门禁七道 RC=0；只剩四端重装），所以**没有 C1b 对照节** | A | 「每日完成量」图 + 月/总完成量两卡的数据源 —— **已通**；剩余未闭合项只有一个：AGENTS §6.1.1 的当前产物 |
| 4 | 非时间单位在分类体系里怎么安放 | A | 「65 页」这类量的图表口径 ⇒ **别人怎么做已补齐**，见 C1b-Q4（六款产品一手） |
| 5 | 番茄"正计时"要不要做 | A | 🔴 **前提被现量改写了**：`FocusSessionKind` 是**阶段**（work/short/long），不是计时模式；真正卡住的是 `FocusActions.log` 要求 `plannedMs > 0`。一手对照与代价见 C1b-Q5 |
| 6 | 专注记录可否补录/删除 | A | 🔴 原句"滴答做法是可补记不可删"**只对了一半**：那是**平台**不对称（桌面端可补记、不支持删除），真正写死的规则是**时长不可改**。逐产品一手见 C1b-Q6 |
| 7 | ~~确认"番茄页不许塞进列表模型"继续有效~~ ⇒ **已核，不需要拍**（2026-10-04 现量，见 C1b-Q7） | A | ~~任何三栏改造的形状~~ ⇒ 已确认仍有效，且给了可复跑命令 |
| 8 | 详情面里"无数据的区块"要不要显示（空即隐藏 vs chip 常驻） | A | 详情面第一屏的信息密度与能力可发现性 |
| 9 | 背诵做不做，走 R1 / R2 / R3 / 都不做 | B | B6 第 5 条：需求侧一手证据为零，这是产品判断 |
| 10 | 复习对象挂在谁身上（任务 / 便签 / 新卡片） | B | 是 IA 决策，牵动 [multi-end-unified-strategy.md §7.1e](../plans/multi-end-unified-strategy.md) 那张次级表面表 |
| 11 | 免费还是付费 | B | 牵动"收费的是服务器不是功能"的既有口径 |
| 12 | 界面上允许出现哪些科学宣称 | B | **对外话术的合规边界**，不是工程问题（B2 的收窄 + B6 第 1 条未补一手） |

> 🔴 这 12 项里**卡住工单**的那几条，业界实际怎么答、推荐与代价已落在 **C1b**：
> #1 / #2 / #8 / #9–12 来自 2026-10-03 第二批一手调研（#2 的对照在 19:27 到齐）；
> **2026-10-04 08:0x 第三批把 #4 / #5 / #6 也补齐了，并把 #7 从"要确认"改成"已核"**（四节都在 C1b 末尾）。
> 本节仍是"要拍"的清单 —— C1b 只把选择题变成**有出处的**选择题，不替谁拍。
> ⚠️ 但 #5 / #6 那一格里**连问题本身都被现量改写过**（原来写的前提是错的），这类更正要看 C1b-Q5 / Q6，别看这张表。

> 📏 **13:1x 逐项对账这张表（Goal 第①条的收口读数，零代码改动）**：卡住工单的那几条**都有对照节**，
> 每节的 URL 数与"访问日期串"数现量如下 —— 引用时要带这一句，因为这两个数就是"带出处、带日期"这条要求的可查形态：
>
> | 节 | = C1 | 出处 URL | 日期串 | 未核实标记 |
> |---|---|---|---|---|
> | C1b-Q1 | #1 | 5 | 1 | 0 |
> | C1b-Q2 | #2 | 1 | 4 | 1 |
> | C1b-Q8 | #8 | 4 | 2 | 5 |
> | C1b-Q9~Q12 | #9–12 | 10 | 1 | 0 |
> | C1b-Q4 | #4 | 15 | 2 | 1 |
> | C1b-Q5 | #5 | 9 | 3 | 0 |
> | C1b-Q6 | #6 | 9 | 1 | 1 |
> | C1b-Q7 | #7（已核） | 3 | 4 | 4 |
>
> 🔴 **两个读数不许读成"合格"**：
> ① Q1 / Q9~Q12 / Q5 三节的"未核实标记 = 0" 有两种可能 —— 当时的结论确实全部一手到位，或者**漏标了**。
>    本节不能凭这张表反推是哪种；要核就逐条读各节自己声明的取证形态（Q2 只有 1 条 URL，
>    但它那一节写的是"**Loop 与 Habitica 的结论来自读源码，每一行给 `file:line`**"加 Streaks/Apple 一手文档描述 ——
>    取证强度不由 URL 数决定，这一点我第一版写反了，已改）。
> ② 日期串与 URL 数**不成比例**是正常形状（一次访问多篇 / 一篇引多次），更不许把它当覆盖率指标。
>    🔴 这一句在本节写完的**同一小时内就兑现了**：那三份临时载体已经没了
>    （13:2x 现量 `ls /tmp/heyta-research` → 目录不存在），现量、仓库层实际留下多少出处、以及丢了什么
>    都写在 C1b 开头那段。
>
> ⇒ 这张表现在**没有一条"缺调研"**，只有"缺拍板"；#3 那一格已从"要拍"改成"是工程缺口、已随 W6 落码"。

## C1b. 别人怎么做的 × 推荐（2026-10-03 第二批一手调研）

> 🔴 **本节不替产品负责人拍**，它只做一件事：把"这 5 项要拍的值，业界实际怎么答"摆出来，
> 每条带**出处 + 访问日期 + 一手/二手**，并给一个带代价的推荐。
> ~~完整表在 `/tmp/heyta-research/q1-q2-detail-pane-content-and-disclosure.md`（18 条来源）、
> `/tmp/heyta-research/q4-srs-in-task-managers-and-claims.md`（24 条 URL）与
> `/tmp/heyta-research/q3-habit-statistics-conventions.md`（Loop/Habitica 逐行 file:line + Streaks/滴答/Apple/Google 一手文档）~~
> 🔴 **那三份已经没了**（2026-10-04 13:2x 现量：`ls /tmp/heyta-research` → `No such file or directory`，
> 距写下"会随机器没掉"这句不到一天）。⇒ 本节从"摘要 + 承重出处"**升格为唯一记录**，
> 现在仓库里实际留下的取证量是现量出来的：C1b 区段内 **URL 出现 56 次 / 去重 55 条**（全篇 69 次 / 68 条 / 49 行），
> `file:line` 形式的源码指认 **5 处**。
> ⚠️ **丢了什么要说清**：那三份里的"逐条原文与未采用的对照行"不可恢复 —— 也就是说
> 本节每一行的**出处**还在，**得出该结论的中间过程**（哪些来源被比过、比出什么差异）没了。
> 下一轮若要引这些结论做产品决策，要重新取证的正是后者，不是重新找 URL。
> 📌 **可迁移的形状**：把"完整表"放在临时载体、把"结论"放进仓库，看起来是同一件事的两层，
> 实际上**只有落仓的那一层会活下来** —— 而人写"完整表在 /tmp/…"的时候，读者会以为它可查。
> 要么完整表落仓（哪怕进 `docs/research/` 的附录），要么**不要在仓库里许诺它存在**。
> ⚠️ 这一条**该进环境陷阱台账但没有行号**：`docs/reference/environment-traps.md` 此刻正被并行那条线写着
> （§8.44 的 Q1 交叠清单里就有它），按既有裁决不往别人正在写的共享台账插行 ⇒ 记在这里，
> 待该台账的持有者收口时按"临时载体不可当完整表落点"取号入档。

### C1b-Q1（= C1 #1：右栏放"仅选中项"还是"永远放概览 + 记录 + 选中项"）

**一手分布**（访问 2026-10-03，全部为官方文档 / 官方帮助中心 / 官方仓库）：

| 做法 | 谁 | 关键原文（短句） |
|---|---|---|
| **未选中 = 一行提示字**，"自动放最新一封"是**默认关闭**的选项 | Outlook 阅读窗格 | "Turning on 'always preview messages' … With this feature turned off, … you will see 'Select an item to Read'"（[support.microsoft.com](https://support.microsoft.com/en-us/office/2fd687ed-7fc4-4ae3-8eab-9f9b8c6d53f0)） |
| 拉宽时给的是 **placeholder** 详情栏，不是概览 | Android 规范布局 | "the list and a placeholder detail pane are shown together"（[developer.android.com](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts)） |
| **API 层**把"无选中"当一等状态要求显式给内容（默认 `null`） | MS CommunityToolkit `ListDetailsView` | "Gets or sets the content to display when there is no item selected"（[learn.microsoft.com](https://learn.microsoft.com/en-us/dotnet/api/communitytoolkit.winui.ui.controls.listdetailsview.noselectioncontent)）⚠️ 这是**接口形状**，不是内容主张 |
| **选中才出现**（原地展开 / 浮层），没有常驻第三栏 | Things 4、Notion peek、Linear、Todoist、Gmail（默认 `No split`） | Things："When you open a to-do, it smoothly transforms into a clear white piece of paper"（[culturedcode.com/things/features](https://culturedcode.com/things/features/)）；Todoist："click a task to open the task view"（[help](https://www.todoist.com/help/todoist/features/use-the-task-view-to-manage-tasks-in-todoist-eDeRDO0C)） |
| **没有任何一方**在常驻栏里放"当前清单的统计概览" | —（缺席结论：核的是上面这 5 家的对应页面） | 概览型内容别处放：Things 的 Progress Pies 在**列表里**，Todoist 的统计在独立的 **Productivity view** |

**压倒性一致的唯一一条**（不管选哪种都要满足）：可隐藏 + **多条恢复入口**（工具栏 / 菜单 / 快捷键）+ 记住状态 —— Apple HIG split views 原文 "Provide multiple ways to reveal hidden panes"；SwiftUI `.inspector` 的列形态"presentation state restored by the framework"。⇒ 这条可以直接写进 W4 的判据，不需要拍板。

**窄屏的一手答案互相冲突**：Apple 说 "adapt to a **sheet** in a horizontally compact size class"，Android 说"详情占位、**列表隐藏**"。一套 RN 组件只能取一个 ⇒ 取 **sheet**（与 heyta 移动端现有第二层页面同形，实现面最小）。

**推荐（带代价）**：宽屏常驻第四列；未选中时放**当前清单的派生概览**（今日到期数 / 完成数 / 最近 3 条活动），空清单退化成**一行字**。
- 为什么值得：这些数**已经在 `packages/app-host` 里算好了**（`motivation.ts` / `category-report.ts` / due 侧），概览是纯派生 ⇒ 不新增持久化字段、不 bump schema（与 ADR-0014 / ADR-0022 的"派生不落盘"同一条纪律）。
- 代价：这是本次调研里**唯一没有先例的一档**（上面那张表第 5 行）；一栏两态会让"选不选中"变成两种界面，实现面与认知面都翻倍。
- **兜底**：若拍"不要概览"，退化成 Outlook 那一行字（有先例、便宜、不抖动），但那一栏在未选中时基本不提供服务。
- ⚠️ **不能选"未选中就让整栏消失"**：那既违反本仓库已拍的「能力可见」，也让列宽在每次选中时抖动。

### C1b-Q8（= C1 #8：详情面里"无数据的区块"是空即隐藏还是常驻）

> 取证日期 **2026-10-03**。🔴 **2026-10-04 09:5x 复扫这一节时照出三行没有 URL 出处**（Things 4 / Todoist / Outlook），
> 已逐行标成「**未核实 · 未附来源**」—— 本节顶部那句"一手取证"对这三行**不成立**，宁可挂未核实，也不补猜链接。

一手取证后**最重要的发现是问题本身问错了**：没有任何一家把这件事写成"空即隐藏 vs 永远都在"，它们写的是**这个区块是不是动作的入口**。

| 来源 | 站哪边 | 原文 |
|---|---|---|
| Apple HIG · Disclosure controls | 藏 | "Use a disclosure control to hide details until they're relevant." + "Place controls that people are most likely to use at the top of the disclosure hierarchy so they're always visible"（[HIG](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)） |
| Apple SwiftUI `ContentUnavailableView` | 不藏 | "recommended … where a view's content cannot be displayed … a list without items"（[documentation](https://developer.apple.com/documentation/swiftui/contentunavailableview)） |
| IBM Carbon · Empty states | 不藏，但**空间小就只留文案** | "If space is limited, use just text." + "In situations where there could be multiple empty states showing at once, we recommend using a tertiary button" + 设计必答第一问就是 "What will the pages … and **side panels** look like without content?"（[carbondesignsystem.com](https://carbondesignsystem.com/patterns/empty-states-pattern/)） |
| Microsoft Power BI | 藏（但藏的是**数据行**，不是功能） | "Power BI doesn't display all possible data by default" + "Turning on the option to show items with no data can negatively affect performance"（[learn.microsoft.com](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-show-items-no-data)） |
| Things 4 | 藏 | "those fields are neatly tucked away in the corner until you need them"（**未核实 · 未附来源**） |
| Todoist 任务详情 | 常驻可操作 | "Click the project name to move… Click Date to add a date, time, and duration … Click Labels to add a label"（**未核实 · 未附来源**：原记"同一 help 页"却没落 URL） |
| Outlook | 一行字，不给插画 | "you will see 'Select an item to Read'"（**未核实 · 未附来源**：那是客户端界面串，不是文档句子） |

**推荐**：三态契约 **`affordance`（写入口，常驻，空态只占一行按钮级文案）/ `record`（纯记录，可隐藏但区块头留"添加"）/ `hidden`**，而且**这个判断住在共享组件层、四个壳不许各写一份**（AGENTS §3.5 的形状；所有空态文案进 `packages/i18n` 中英成对）。
- 为什么不选"全部常驻"：详情栏一屏七八个空行，正是 Apple 两条 progressive disclosure 告诫的形态。
- 🔴 为什么不选"全部空即隐藏"：本仓库已经吃过这个形状的反果 —— `tagIds` 全仓零读写那段记的是"零件都在、产品里没有这个功能"。**界面上隐藏空区块是最容易悄悄把一个功能变成"没有功能"的地方**，而这类失败从来不会报错。
- Carbon 那句 "use just text" 与本仓库已拍的「不抄空态插画」同向，可直接引用为一致依据。
- 🔴 **这条推荐不靠上面那三行未附来源的话撑着**（逐条对过）：`affordance 常驻` 的已附来源依据是 Apple 那句
  "Place controls that people are most likely to use at the top of the disclosure hierarchy so they're always visible"，
  `record 可隐藏` 的依据是 Apple 第一句 + Power BI 的性能那句，`空态只给一行文案` 的依据是 Carbon。
  ⇒ 上面 Todoist / Things 4 / Outlook 三行**即使复核后被推翻，本推荐不动** —— 这才敢在只标了"待复核"的情况下继续用。

### C1b-Q2（= C1 #2：习惯统计三处口径 A 日历月 vs 韧性 / B 自然月 vs 滚动 / C 天 vs 次）

> 取证日期 **2026-10-03**（本节 19:27 到齐后填入，替换此前"未取到一手对照"那一段）。
> **Loop（uhabits）与 Habitica 的结论来自读源码**，下面每一行给 `file:line`；
> 这四条承重断言我在写入前**逐行回读过原始文件**（不是采信子 Agent 的转述）：
> `FrequencyPickerDialog.kt:174-177`、`StreakList.kt:48-58`、`cards/OverviewCard.kt:47-50`、`cards/TargetCard.kt:153-158`。

**一手分布**：

| 口径 | 谁怎么做 | 精确判据 / 公式 | 出处 | 一手性 |
|---|---|---|---|---|
| **一天算完成** | Loop 布尔 | `value > 0` ⇒ YES_MANUAL(2) / YES_AUTO(1) / **SKIP(3) 都算** | `models/StreakList.kt:48-58`、`models/Entry.kt:40-62` | **一手代码** |
| | Loop 数值 | `value/1000 >= targetValue`（AT_LEAST）；`entered && <= targetValue`（AT_MOST） | `StreakList.kt:50-54`（**逐行回读确认**）、`Habit.kt:58-69` | **一手代码** |
| | Habitica Daily | `task.completed = true ⇒ task.streak += 1`；取消 `-= 1`；漏 ⇒ cron 置 0 | `website/common/script/ops/scoreTask.js:326,333,338,374,388`；`:310` | **一手代码** |
| | Streaks | "Every day you complete a task, your streak is extended."，一天一次、上限 **24 个任务**（不是 24 次） | https://streaks.app/ ；App Store 开发者描述（iTunes lookup `id=963034692`, v11.4.2, 2026-09-27） | **一手文档** |
| | 滴答 | 三档打卡：**自动记录**（"每滑动一次就自动记录完成了一杯"）/ **手动记录**（"一次背了3页，晚上有点累背了1…"）/ **完成全部**（"当天完成了就直接完成全部，没有完成量的记录"） | `help.dida365.com`《更好地完成习惯》正文 | **一手文档** |
| **次住在哪一轴** | Loop | 频率轴**表达不了**"一天 N 次"：取数器收尾 `if (numerator >= denominator  numerator < 1) { numerator = 1; denominator = 1 }` ⇒ `3次/1天` 被**折叠成"每天一次"**。要表达只能建成**数值习惯**（`targetValue=3`、`unit="次"`） | `FrequencyPickerDialog.kt:174-177`（**逐行回读确认**）、`Frequency.kt:22-47` | **一手代码** |
| | 滴答 | 同上：`频率` 那一轴只写"一周完成3次"这类**周期内次数**；"一天几次"放**目标**轴（"当天完成一定量"） | 《开始坚持一个习惯》 | **一手文档** |
| | Habitica | "次"下放给另一条实体（Habit `counterUp += times`），而 **Habit 不计连续**（`scoreTask.js:204-210`） | 同左 | **一手代码** |
| ⇒ | **竞品共识：`一天 N 次` 属于"目标/数量"轴，不属于"频率/排期"轴。** heyta 现状已在正确的一侧（`HabitFrequency` 只有 `daily / weekly{daysOfWeek} / interval{everyNDays}`，**无** per-period 配额，次数在 `Habit.target/unit` + `HabitLog.value`）⇒ **不用改模型** | — | `packages/domain/src/entities.ts:302-305`（行号 2026-10-03 自核） | 仓库现状 |
| **"5 次一周"有两副面孔** | 排期日模型 | Streaks（"Set the days … Go to the gym **(3 days per week)**"）、Habitica（`frequency:'weekly'` + `daysOfTheWeek` + `everyX`，`cron.js:154-178`）、**heyta 现状** ⇒ 分母是**计划日**，非计划日既不算漏也不断链 | 同左 | 一手 |
| | 窗口配额模型 | Loop `Frequency(5,7)`：配额**不产生"未达标"判定**，而是把散落的 YES_MANUAL 折算成区间并**自动补 YES_AUTO 天**，再按**自然日相邻**数连续；自己注释写着 "gaps are eliminated and **streaks are maximized**" | `EntryList.kt:100-103,222-245,247-273` | **一手代码** |
| 🔴 | **同一个使用序列（周三/五/日各一次 ×4 周）两种口径给的不是同一个数**：排期日 = **12**，配额（被自动补格连成一片）可达 **28** ⇒ **判据必须先声明用哪一种，否则"期望值"没有意义** | — | — | 推论 |
| **部分完成的那天**（目标 5、实际 3） | 四家 + 两个平台**一致**：数量照记、**天数不记** | Loop 未达标格子画 **GREY**（达标 ON / 未达标 GREY，`HistoryCard.kt:165-184`）但 `groupedSum` 把 3 计入月总量；Habitica 的 checklist 比例**只减轻扣分**、不给那天 streak（`scoreTask.js:39-47`）；滴答原话 **"即使哪一天没有背够5页的单词，也能记录自己完成3页的付出和努力"**；Apple `HKActivitySummary` = "data for a given day" + 成对 `…/…Goal` 字段，Google Fit 日桶边界 = "midnight of the current day" | 同左 | **一手** |
| **自然月 vs 滚动 30** | 滴答**同时用两者并分别精确标注**：习惯热力图 = "追踪**本月**中每一天"，任务完成统计小组件 = "**近30天内**每天完成的任务数量" ⇒ **没有一家把滚动 30 天叫"本月"** | — | 《🌮 小组件》正文 | **一手文档** |
|  | Loop 也两者混用，且留下一处**名与算式不同源**的反面样本：Target 卡按 `TruncateField.MONTH` 日历截断（`TargetCard.kt:71-74`），区间标签却写死 `intervals.add(30/91/365)`（`:153-158`，**逐行回读确认**）；Overview 卡的分数差值用 `today.minus(30)`（滚动，`OverviewCard.kt:41-42`） | — | 同左 | **一手代码** |
| **"累计"那一格数的是什么** | Loop 的 `totalCount` = `originalEntries.filter { value == YES_MANUAL }.count()` ⇒ **手动打卡的天数，不是次数**（`OverviewCard.kt:47-50`，**逐行回读确认**） | — | 同左 | **一手代码** |

📌 **这张表在 2026-10-04 09:5x 补过五行的缺列**（那五行把"谁怎么做"与"精确判据"并成了一格，
导致渲染时**出处/一手性两列整体左移一格** —— 也就是说读的人会看到贴错栏的一手性）。
补的是 `—` 占位、**内容一个字没动**。检查是**一次性**的（口径与两条对照记在工单 §8.33，
没挂成常驻门禁的理由也在那一节）。

🔴 **heyta 现状的三处说谎点**（这才是 W8 必须先拍口径的原因，逐条带 file:line）：

1. `computeHabitResilience().total = achieved.size`（`packages/domain/src/habit-resilience.ts:197`）= **达成天数**，
   而渲染链把它一路当"次"印出去：`packages/ui/src/habits/HabitBoard.tsx:484` `labels.streakTotal(r.total)`
   → `apps/web/src/features/habits/copy.ts:35-38` → 词条 **"累计 {count} 次"**。
   🔴 **同一句话落在三个键上**（2026-10-03 现量，路径含 `locales/`，行号自核）：
   `packages/i18n/src/locales/zh-CN.ts:1120` 与 `:1121`（`web.habits.streak.total` / `.totalOne`）、`:2816`（`mobile.growth.streak.total`）；
   英文侧 `locales/en.ts:1035-1036` 写的是 **"{count} check-ins"** —— 同样是"次" flavored。
   ⇒ 值与词不同源，**二选一改掉**（改句子或改值），且**三处必须一起改**（同一对抄件，改一处必 sweep 全仓）。
   Loop 那一行恰好给了这一格的**一手口径背书**：它的 `totalCount` 数的是**天**。
2. `habitHeatLevel(count) = count === 0 ? 0 : 4`（`packages/ui/src/habits/model.ts:187`）是**二值**的，
   而 `completionRatio()`（`packages/domain/src/habit-streak.ts:215-220`）算好的当日比例 `todayRatio` **零渲染消费者**
   ⇒ "每天完成 3/5 页"今天在界面上**不可见**（Loop 用 GREY 格子留痕，正是这一块的位置）。
3. `onCheckIn(habitId, date?)` **不带 value**（`packages/ui/src/habits/HabitBoard.tsx:188`），缺省 `value = habit.target ?? 1`
   （`packages/app-host/src/habit-actions.ts:311`，`value ?? habit.target ?? 1`）⇒ 一滑记满 = **只有滴答"完成全部"那一档**；"自动记录（+1）"要等 **W6**。
   结构性约束：`HabitLog` 的 id 是 `habitId:date`（`habit-actions.ts:155-157`）且当天已有 log 时 `checkIn` **直接 `return false`**（`:295-301`）
   ⇒ **一天只可能有一条 log**，所以"次"**只能**住在 `value` 里；把"次"实现成 **log 条数**会恒等于天数 —— 那是假判据。

**推荐（供 W8 写判据；A/B/C 三条互相依赖，先拍 C）**：

- **C：天 = 唯一的连续性单位；次 = `Σ value`。** 沿用 `isAchieved`（`value >= target`）：达到当天目标才算完成；
  未达标的天**不记分数天、不进连续**（Loop / Habitica / Streaks / 滴答 / Apple / Google **六方一致**）。
  判据写法：**"一天打 3 次"落库 = 一条 log `value=3`，`完成次数 +3`、`完成天数 +1`**。
  "5 次一周"走**排期日**（`weekly{daysOfWeek}`），不走 Loop 的窗口配额 —— 理由：① heyta 的冻结与 `isStillAlive` 全按**计划日**计数，
  配额模型会让"连续"变成一个**无法向用户解释**的数（Loop 的自动补格本质是在 *maximize streak*），
  而 ADR-0022 要求"只增不减"是**规则**而不是算法副作用；② 配额模型下"连续 28 天"与"一周 3 次"互相矛盾；③ Streaks / Habitica 也用排期日。
  ⚠️ **代价必须写进判据**：非排期日不进分母也不断链 ⇒ 周 3 次习惯的"月完成率 100%"意味着 **9/9 个计划日**，不是 9/30。
  "一天 N 次"只动**目标轴**（`target=N`、`unit="次"`），**不许**给 `HabitFrequency` 加配额字段（会同时撞 §3.3 与上面的竞品共识）。
- **A：主卡 = 日历月完成天数；第二级 = 当前连续（含冻结）；第三级 = 最长/累计。**
  完成率 = `该月达成天数 / 该月计划日数`（借滴答《成就值》的定义："实际完成的任务，和你**原本安排在对应时间**的任务的比值"，
  分母是**安排在该时段的量**，不是自然日数）。理由：日历月是**外部时钟**，界面上不需要解释冻结就能读懂；
  🔴 反过来若把月指标改成"韧性口径"，就等于让月度数字**依赖冻结参数** ⇒ 重新引入 ADR-0022 已经消解掉的那条风险
  （参数放宽会让历史月份数字变化）。**没有任何一家把冻结做成卡片口径** —— Loop 的 skip 只出现在格子纹理（`HistoryCard.kt:169,179`）
  和一句 FAQ（"Skips keep your score unchanged and don't break your streak"，`res/values/strings.xml` `pref_skip_description`），
  这正是 ADR-0022 要的形态：**机制在数据里、解释在事件里、不在余额里。**
- **B：全部用自然月，卡片词固定为"本月/当月"；`近 N 天` 只允许出现在真正滚动的地方**
  （heyta 目前只有 `HABIT_HEATMAP_DAYS = 90` 的热力图，它的词就该是"最近 90 天"，现状已如此）。
  分母用**该年该月的实际计划日数**（2 月/闰年/跨月），**不许出现"名写月、算用 30"的 Loop 式错位**。
  E2EE + 本地计算 ⇒ 这些数全在客户端算，没有任何服务端聚合成本要求滚动窗口；选自然月只多一个 `monthLength`，而 heyta 已经有它。
- **D（= C1 #4 非时间单位）：图 = 每日完成量柱 + 目标线（target-ratio 形状），不做 cumulative 曲线**；
  卡片 = "本月完成量 N 页 / 总完成量 N 页"（`Σ value` 带 `unit`）。竞品形状是"target ratio + 每日量柱状"并存，**没有一家做累计曲线**。
  🔴 前置（= C1 #3）：`HabitLog.value` 全仓**只有一处求和且只认"分钟"类单位**（`packages/domain/src/activity-categories.ts:100-113`）
  ⇒ "65 页"这类量今天**没有读侧**；且 `unit` 是自由字符串（`entities.ts:320`，`unit?: string`），不是封闭词表。
  推荐 **`unit` 只做显示、求和按纯数**（改动最小），而不是新加一个量纲封闭词表。

⚠️ **一条依赖关系**：上面凡涉及"多次"的期望值，**在 W6 落地前不可达**（`onCheckIn` 不带 `value`）⇒ W8 要么等 W6，
要么把判据明确限定为"一次记满"，**不许为它编一个可达的期望值**。


### C1b-Q9~Q12（= C1 #9 做不做 / #10 挂谁身上 / #11 免费付费 / #12 允许哪些科学宣称）

**#9 有没有人在任务管理器里做内容级间隔重复：一个都没有**（缺席结论，逐家写清核了哪一页）：
Todoist 只有日期重复 + 提醒（[recurring dates](https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV)、[reminders](https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU)）；
滴答清单功能页与定价页 `spaced` / `flashcard` / `memor*` **命中 0**，帮助中心 4 处 `forgetting` 全指"忘记某条任务"（[features](https://ticktick.com/features)、[upgrade](https://ticktick.com/upgrade)）；
Things 首页同样 0 命中，`review` 唯一命中是评测标题（[culturedcode.com/things](https://culturedcode.com/things/)）；
OmniFocus 的 Review 是**项目级元审查**（"Each project has a Next review date, as well as a setting for Review every"，[手册](https://support.omnigroup.com/documentation/omnifocus/universal/4.3.3/en/perspectives/)）。
最近的一条**需求信号**是用户手写间隔表把滴答当复习表用的 2020 年教程（[sspai](https://sspai.com/post/59522)，⚠️ 二手，且是 hack 不是产品能力）。

**#10 排程挂在哪个对象上：凡真做记忆调度的都被迫离开"待办"**（Anki=card、RemNote=card、Obsidian SR=note/flashcard、Duolingo=(user,item)），留在任务上的只是"用户自己声明的重复频率"。
🔴 唯一可直接复用的先例是 **Obsidian SR 的"整篇笔记 + 三个内联字段（`sr-due/sr-interval/sr-ease`）"** —— 排程状态**附着在既有实体的可序列化字段上，不新建实体也不丢能力**（[data-storage 页](https://www.stephenmwangi.com/obsidian-spaced-repetition/algorithms/)）。heyta 的天然宿主是 `NOTE`，事件形状照 `HABIT` + `HABIT_LOG`。

**#11 免费还是付费：竞品无一例外不收费**（Anki 全平台免费、AnkiMobile 那句写的是"purchases help fund Anki's development"而不是解锁功能；RemNote 的 SRS 在 Free 档、Pro 卖的是 Exam Scheduler **容量**；Obsidian 插件 MIT）。⇒ 竞品实践**支持** heyta「收费的是服务器不是功能」这条线，且支持方式很具体。
🔴 **真正的风险在自己身上**：`review` / 背诵一旦被写成档位卖点就违反 `ALLOWED_GRANTS` 门禁（见 [`pricing-and-entitlements.md`](../reference/pricing-and-entitlements.md) §1/§6 与 [`subscription-boundary.md`](../plans/subscription-boundary.md)）。

**#12 界面上允许哪些科学宣称**：真实水位比想象中低得多 —— Anki 用的是 `it **can** help you remember more` + `when you're **most likely** to forget`，最强那句被**关进署名引言**；RemNote 定价页 `forgetting` / `scientific` / `proven` **命中 0**；滴答把"忘"讲成**丢任务**而不是记忆衰减。
成文边界：Apple 没有管认知声称的专条，能落到的是 [2.3.7](https://developer.apple.com/app-store/review/guidelines/) "should not … make **unverifiable product claims**" 与 2.3.1(a)（不许宣传不提供的服务）；⚠️ **1.4.1 只打"健康测量"的精度**（"if the level of accuracy or methodology cannot be validated, we will reject your app"）⇒ **把复习功能包装成"记忆/认知健康"反而会拖进需要披露数据与方法论的那一档，别这么写**。
中文侧红线是**绝对化用语 + 可证明性**，不是"不许提艾宾浩斯"：市场监管总局《广告绝对化用语执法指南》[第二条](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2023/art_64279265c896452f8f638f2de12b8003.html)界定"国家级/最高级/最佳"及近似用语，**第七条**规定即使在豁免情形里"广告主无法证明其真实性的，依照《广告法》有关规定予以查处"，**第十一条（三）**专门把**教育、培训效果**类绝对化用语排除出"违法行为轻微"。⇒ **"背诵效率提升 X 倍""最佳复习时机""记忆最牢固"必须删**；相对安全的是事实口径（"按你自己点过的『记得/不记得』推算下一次时间"）与自比口径。

**推荐（三项合起来）**：**R1 现在做，把 R3 的算法当 R1 的内部实现细节；R2 不做，但写下触发条件**。
- R1 的形状：复习是 `NOTE`/`TASK` 上的**可选开关（默认关）**，评级事件进 op-log（照 `HABIT_LOG`），**排程值不落库、每次从事件日志重算** —— 与 ADR-0014「推断不持久化」、ADR-0022「界面上不出现的东西不需要稳定持久化结构」同一条纪律；将来从固定间隔表换成 FSRS 时**输入形状不变 ⇒ 不产生新字段**。
- 算法选型（AGENTS §3.1/§3.2 两道门）：可用 **`ts-fsrs`**（MIT，FSRS v6，最后推送 2026-10-03）或 `fsrs-rs`（BSD-3-Clause）；🔴 **不要用 `fsrs.js`** —— 它自己的 README 写着维护者已无力维护、建议迁到 `ts-fsrs`，最后推送 2024-04-10，**过不了 §3.1**；**不要抄 Anki 代码**（`ankitects/anki` 的 license 是 `NOASSERTION` ⇒ 无有效授权声明，默认按不可用处理）。
- 🔴 **要它的算法，不要它的叙事**：不显示"欠复习 N 条"、不做断签惩罚、把积压说成"今天有这些可看"而不是"你漏了这些"。Anki 自己文档写着 "above 97% the workload can be overwhelming" —— 留存率调高就积压暴涨，那台机器与「从不制造愧疚」这条设计红线直接冲突。**这条比选型更容易被后来的实现破坏，建议拍的时候顺手写成门禁级约束。**
- E2EE 是**竞品结构上打不了的那张牌**：排程输入全是本地已有数据，而 RemNote / AnkiWeb / Duolingo 都跑在它们服务器上。措辞仍受 #12 约束 —— **讲"谁看得到这些数据"，不讲"你会记得更牢"**。
- R2 的触发条件（写下来免得下次重吵）：只有当复习对象需要"一张卡自身"才有的字段（完形填空、图片挖空、一父多子卡、卡级媒体）才值得新建实体。管道成本不是问题（批次二 W2 已实测 `ENTITY_TYPES` 加一项穿过整链零改动），**贵的是产品面**：卡片编辑器 + 复习队列 + 空态，每个端一遍。



### C1b-Q4（= C1 #4：非时间单位在分类体系里怎么安放）—— 2026-10-04 第三批一手调研

| 产品 | 单位是不是**一等公民** | 数值住在哪个概念 | 非时间量怎么画图 | 一手来源（访问 2026-10-04） |
|---|---|---|---|---|
| 滴答清单（中文库 help.dida365.com） | ❌ 中英两版帮助都**没有"单位"字段** | Goal =「当天完成一定量」，例「背了 3 页」「一杯」 | **不画量**：打卡概览 / 月度打卡表 / 年度热力图 / 时间轴回顾 | <https://help.dida365.com/articles/6950379816176582656> · <https://help.dida365.com/articles/6950379455722291200> · <https://help.dida365.com/articles/7005344825801179136> |
| TickTick（英文库，与中文库两套内容） | ❌ 同上（UI 里有没有藏单位输入框：**未核实**） | "Reach a certain amount"（例 5 words / read 2 pages per day），打卡方式 自动 / 手动输入量 / 完成全部 | 同上，量不单独成图 | <https://help.ticktick.com/articles/7055781878401335296> · <https://help.ticktick.com/articles/7055781805944733696> |
| Loop Habit Tracker（官方仓库源码） | ✅ **`unit` 是自由文本字段** | `Habit` 只有 `YES_NO / NUMERICAL` 两型；数值习惯 = `targetValue` + `targetType(At least/At most)` + `unit`，占位符原文 "e.g. 15" / "e.g. miles"，示例问题就是 "How many pages did you read?" | **一图一习惯**：ScoreChart（指数平滑达成度）/ HistoryChart / FrequencyChart（数值习惯按 maxFreq 归一缩放） | <https://github.com/iSoron/uhabits/blob/master/uhabits-core/src/jvmMain/java/org/isoron/uhabits/core/models/Habit.kt> · <https://github.com/iSoron/uhabits/blob/master/uhabits-android/src/main/java/org/isoron/uhabits/activities/common/views/FrequencyChart.kt> |
| Streaks（官网 + App Store） | 🟡 只有**封闭列表**：非时间量经 HealthKit 活动类型带入（Walk 5,000 steps / Run 5 miles） | "每日完成"布尔 | 时长与 Health 量最终都折成"当天完成与否"的 streak 布尔 | <https://streaks.app/> · <https://apps.apple.com/us/app/streaks/id963034692> |
| Strides（官网 + App Store） | ❌ 无单位字段（组织靠 tag） | 四型 tracker（Habit/Target/Average/Milestone）+ goal value + 时间窗 | **pace/达成率 + 折线**，可按周/月/年 | <https://www.stridesapp.com/> · <https://apps.apple.com/us/app/strides-habit-tracker-goals/id672401817> |
| North Star（App Store） | 量被拆成**并列的另一件工具** "Measures" | Habits 与 Measures 分家 | — | <https://apps.apple.com/us/app/north-star-goals-habits/id1480448999>（🔴 同一页显示最后更新 **2022-12-27 v2.1**） |
| Habitica / Todoist | ❌ Habitica 无非/正布尔之外概念；**Todoist 官方确认没有原生习惯功能** | — | — | <https://translate.habitica.com/browse/habitica/faq/en/>（key `webFaqAnswer25`） · <https://www.todoist.com/help/articles/use-the-habit-tracker-extension-with-todoist-A0r7wtPfk> |

**别人怎么答这道题（三条，都有上表来源）**：
① **没有任何一款把"时长"和"页数"画进同一张图** —— 全部靠"一图一习惯"或"归一成达成度"绕开单位问题；
② 单位要么**自由文本**（Loop）、要么**封闭列表**（Streaks 走 HealthKit）、要么**干脆不做单位**（滴答 / TickTick / Strides，数值裸存）；
③ 数值习惯的图**不是"总量"而是"达成率"**（Loop 的 ScoreChart、Strides 的 pace line）。

**代价（有来源的）**：Loop 的 `At most` 语义长期出错，官方 CHANGELOG 到 2025 年才修
"Never mark 'at most' habits as completed" / "Trim unit labels"（<https://github.com/iSoron/uhabits/blob/master/CHANGELOG.md>）
⇒ 引入"上限型 + 单位"是一条**多年才磨平**的缝；Streaks 上限 24 个任务（App Store 描述）；
North Star 把量拆成独立工具后**停止更新**（2022-12-27）。
**未找到一手来源**：任何产品"时长 + 数量混排同图"的实例；Streaks counter 的自定义 ± 标签（官网 help 路径全部回落首页）。

**推荐（不替谁拍）**：走 ① + ③ —— 计数型习惯的图**画达成率不画绝对量**，单位作为可选自由文本 `unit?`
（AGENTS §3.3：新字段一律可选 + 运行时默认值，不 bump schema）。这样"65 页"不需要分类体系里给它腾位置，
而六张卡里那两句需要单位的话术（C1 #2 的"天 vs 次"）可以只读 `unit?` 有没有值来决定措辞。

---

### C1b-Q5（= C1 #5：番茄"正计时"要不要做）—— 先记一条**前提更正**

🔴 **本表原来写的前提是错的**："它要先动数据模型（`FocusSessionKind` 无该值），牵动线协议与 `EntityModelMap`"。
现量（2026-10-04 08:0x）：`packages/domain/src/entities.ts:317` 的 `FocusSessionKind = 'work' | 'shortBreak' | 'longBreak'`
是**阶段**（番茄的 work/短休/长休），不是计时模式；把"正计时"塞进这个枚举是把两个正交概念合并成一个。
**真正卡住的是两条**：`packages/app-host/src/focus-actions.ts:130` 校验 `plannedMs` 必须 **> 0**（`:128` 注释写明
"0 或负数记录下来会污染统计"），以及统计侧 `completed` 的语义（自然完成 vs 手动中止，`:11-12`）。
⇒ 所以这道题不是"要不要动线协议"，而是"**正计时那一轮的 `plannedMs` 写什么、它算不算一个番茄**"。

| 产品 | 有没有正计时 | 官方原话 / 建模方式 | 来源（访问 2026-10-04） |
|---|---|---|---|
| 滴答清单（中文库） | ✅ | 开始前选模式：「番茄计时：以倒计时方式进行，每轮 25 分钟专注 + 5 分钟休息」／「正计时：以正计时的方式持续记录专注时长，适合不希望被打断、希望沉浸式计时的人群」；每个「常用专注」可各自绑一种 | <https://help.dida365.com/articles/6950408124297641984>（页面 modifiedTime 2026-08-04） · <https://help.dida365.com/articles/7031082644146225152> |
| TickTick（英文库） | ✅ 叫 **Stopwatch** | "Tracks focus time in a count-up format"；🔴 **严格模式与 App 白名单在 Stopwatch 下不可用**（"not available in Stopwatch mode"） | <https://help.ticktick.com/articles/7055782010496745472> · <https://help.ticktick.com/articles/7055781994591944704> |
| Super Productivity（**我们的上游**，官方仓库 master，pushed_at 2026-10-03） | ✅ 叫 **Flowtime** | `FocusModeMode = Flowtime \| Pomodoro \| Countdown`，`Flowtime.initialSessionDuration = 0 // doesn't have a fixed duration`；🔴 **模式是计时器状态上的判别字段，落库的专注记录里没有模式字段**（metric 侧 `focusSessions: number[]` 只有时长），UI 靠派生量 `isCountTimeDown = mode() !== Flowtime` 决定往哪数 | <https://github.com/super-productivity/super-productivity> |
| 专注旅人（App Store 官方条目 v3.12.0，2026-09-04） | ✅ | 「同时提供 无限计时 与 倒数计时 模式」，写在免费功能里 | <https://apps.apple.com/cn/app/id1559730367> |
| Forest / Be Focused Pro / Flow / pomofocus.io | 🟡 官方文案**未提**正计时（不等于"没有"） | — | iTunes 官方条目 id866450515 / id953426154 / id1423210932 · <https://pomofocus.io> |

**统计口径（两家都明文合并）**：中文「番茄专注和正计时的时长都可算作有效时长，**无效的番茄时长不计入**」
（<https://help.dida365.com/articles/7223896922350682112>）；英文 "Both Pomo and Stoptime are counted as valid hours"
（原文拼写如此，<https://help.ticktick.com/articles/7082279841969471488>）。
🔴 **正计时那一轮算不算"一个番茄"= 两家都没写**（未找到一手来源）—— 这恰好是工单 §8.4 W11 那一族"存在性判据"要防的位置。

**代价（有来源）**：严格模式 / 白名单在正计时下失效（TickTick）；iOS 控制中心要为「正计时」单开一个控件（专注旅人条目）；
勋章口径必须新增"两模式合并"这条规则（滴答 7223896922350682112）。**未找到**任何产品官方声明"故意不做正计时"或把它单列收费。

**推荐（不替谁拍）**：照上游 Super Productivity 的形状做 —— **不给 `FocusSessionKind` 加值、不加持久字段**，
把计时模式当作**计时器状态里的判别量**，记录仍只落 `kind='work'` + `plannedMs` + `actualMs` + `completed`
（正计时的 `plannedMs` 取实际时长，绕开 `:130` 那条 >0 校验，零 schema 变更）；
代价是**事后无法区分这一轮是倒计时还是正计时** —— 如果产品要"只有番茄才计个数、正计时只计时长"，
那就必须有一个持久标记（可选字段 `timedMode?`，仍然不必 bump schema）。**这条取舍是 #5 真正要拍的东西**，
不是原来那道"要不要动数据模型"。

---

### C1b-Q6（= C1 #6：专注记录可否补录 / 删除）—— 原句"可补记不可删"**只对了一半**

🔴 现量更正：滴答那条规则的不对称轴**不是"补记 vs 删除"**，而是**平台**与**字段**两条轴：

| 产品 | 补录 | 删除 | 改时长 | 一手来源（访问 2026-10-04） |
|---|---|---|---|---|
| 滴答清单（中文库） | ✅「找到专注记录点击右边「+」，即可补记专注记录」 | 🟡 移动端有「删除记录」「批量编辑 & 清空」；**桌面端明文"不支持删除番茄记录"** | ❌ MCP 原文「**专注时间不可修改**」 | <https://help.dida365.com/articles/6950408300395495424> · <https://help.dida365.com/articles/6950408124297641984> · <https://help.dida365.com/articles/7438132116019216384> |
| TickTick（英文库） | ✅ "If you need to add a focus record retroactively, you can also click "+ Add Record"" | ✅ "To delete a record, open the record and tap Delete Record at the bottom" + "Bulk Select & Delete All" | ❌ "update_focus \| Focus duration cannot be changed" | <https://help.ticktick.com/articles/7055781980423585792>（页面 modifiedTime 2026-09-27） · <https://help.ticktick.com/articles/7055781966800486400> · <https://help.ticktick.com/articles/7438129581631995904> |
| Super Productivity（上游） | 结构上**没有"一条记录"可补**：worklog 是派生视图（"not a separate store of time…built from `task.timeSpentOnDay`"），补录＝改那天时长 | 同上（无对象可删） | ✅ "Inline time correction — the corrected time is reflected in History, reports, and metrics" | <https://github.com/super-productivity/super-productivity/blob/master/docs/wiki/4.21-Worklog.md> |
| Toggl Track（时间记录，对照） | ✅ 手录是默认路径 | ✅ 且有 "Undo option will show up briefly"；**Premium/Enterprise 的 Lock 可以禁止补录与删除**（"Regular users will be unable to edit, add, or delete any time entries dated July 16 or earlier"） | ✅ | <https://support.toggl.com/en-us/article/creating-a-time-entry-wg8nug/> · <https://support.toggl.com/en-us/article/locking-time-entries-xsvs45/>（Updated 2026-06-16） |
| Forest / Focus To-Do / Be Focused | **未找到一手来源**（forestapp.cc 的 /faq /help /support 实测 404；focustodo.cn 官网无帮助入口；Be Focused 官网域名不可定位） | 同左 | 同左 | — |

**三条一手结论**：① **没有任何产品明文说"专注记录不可删除"**（最接近的是滴答桌面端与 Toggl 的 Lock）；
② 真正被写成硬规则的是**时长不可改**（滴答与 TickTick 的 MCP 层都是这句）；
③ **补录是否与真实计时记录在统计上区分** —— 两家帮助中心都**没有**"手动/补记"标记字样（本次对整页做过全量检索），
统计只分"有效 / 无效"，补记算不算进勋章与热力图**文档未写**（未核实）。

**我们自己的位置**（现量）：`FocusActions` 只有 `log` 与 `listSessions`，**没有删除动作**；
`packages/app-host/src/focus-actions.ts:121` 的 `isDeleted` 只是读侧过滤（尊重 `EntityBase.deletedAt` 的墓碑约定），
不构成写入口。⇒ "不做删除"这条既有立场在代码里是**默认而非明文的决定**，正计时/补录（W11）要落地时
必须先把它写成一次可引用的裁决（要么立 ADR，要么在工单 §6 里补一行"专注记录不提供删除，理由是…"）。

**推荐（不替谁拍）**：把 #6 拆成两问拍 —— (a) **补录要不要做**（滴答 / TickTick 都做，形态是"记录页 + 一个 +"）；
(b) **改时长要不要做**（两家都明文拒绝，理由能推给统计不可复算；我们如果做补录，"能新建但不能改"是**有同行依据的最小组合**）。
删除那一档：三家（滴答移动 / TickTick / Toggl）都提供，而我们"不做删除"若要继续，需要一条自己的理由写进文档，
因为**"别人都不这么干"这个依据已经被本轮调研否证**。

---

### C1b-Q7（= C1 #7：确认"番茄页不许塞进列表模型"继续有效）—— 已核，**不需要拍**

规范侧四处一致（不是单一出处）：`docs/research/dida-view-unification.md` 的 §4.3 视图表把「番茄钟 / 成长」标成
**非列表（单一大组件 / 图表）**（第 383 行）、正文「**统一是契约一致，不是形状一致**」（第 387 行）、
禁止表「把番茄钟/成长硬塞进列表模型」（第 445 行）、迁移纪律「别为了迁 web 而把 RN 原语强塞进不需要它的地方」（第 494 行）。

代码侧现量（2026-10-04 08:0x，只匹配**调用形状**，不匹配注释）：

```bash
for pat in '<TaskList' '<TaskRow' '<ListSurface' 'toTaskRow(' 'useTaskList'; do
  printf '%s ' "$pat"; grep -rho "$pat" apps/web/src/features/focus/ apps/mobile/src/screens/FocusScreen.tsx packages/ui/src/focus/ | wc -l
done
```

读数：**五条全为 0**。🔴 但同一条检索**第一版踩了两个坑**，都要留档：
① 宽口径 `grep -E 'ListSurface|TaskList|TaskRow|toTaskRow'` 命中 **1 处**，位置是
`packages/ui/src/focus/FocusPanel.tsx:23` 的**注释**（拿 `TaskList.tsx` 的文件头解释 i18n 边界）——
**"命中不为 0"在这里不代表产品违规**，剥掉注释后才是 0；
② web 的专注面根本没有 `FocusPanel.tsx`（只有 `FocusTimer.tsx` / `FocusDetailPane.tsx` / `store.ts`），
共享的 `FocusPanel` 在 `packages/ui` 里 —— 只在 `apps/web` 搜会得到一个"看起来很干净"的空集合。

⇒ 边界（别读多）：**这条命令只证"专注面没引用列表模型的零件"**，不证明别的面对；
而工单 §6 那一行（"右栏是概览 + 记录"）本来就把**记录列表放在右栏**，所以"W7 的番茄右栏渲染 `<ul data-testid="focus-records">`"
与这条禁令**不冲突** —— 禁令管的是**中栏**（计时器）不能被换成列表模型。
判据从此可复跑，不必再等人确认。

---

## C2. 未核实项（Part A）

1. ~~滴答右栏在无选中时放什么~~ ✅ **已结案**：任务视图 = 纯装饰插画；番茄专注视图 = 概览 + 记录 + 补录入口。⇒ 滴答自己**逐页不一致**，说明"放什么"是产品决定而非框架约束。其余 6 个视图（日历/四象限/时间线/便签/成长/回收站）的无选中态**仍未穷举**。
2. ~~滴答详情面板的完整字段~~ ✅ **已取证**（A3）。🔴 但 [multi-end-unified-strategy.md §9 第 13 条:1524](../plans/multi-end-unified-strategy.md) 那句"取证未覆盖"**仍成立** —— 取到的是**字段清单**，不是**全部区块**：中间那片空白在"有子任务/有提醒/有附件"时长什么样、右下三个图标的语义，**未取证**。补法：在同一条带子任务与提醒的任务上看一次。
3. **⚡/ 的官方含义**：A6 的对应关系靠**同一屏两组数值**推出，滴答界面上始终没有文字标签 ⇒ 仍属推断，只是这次**可复核**。
4. ~~**官方帮助中心细节**：`help.dida365.com` 是 SPA，`WebFetch` 只拿到片段（《专注数据统计》《习惯数据统计》《更好地完成习惯》三篇**未取到正文**）~~
   🔴 **本条在 2026-10-03 被推翻**（C1b-Q2 那一轮）：这三篇的**全文都取到了**。方法记下来复用 ——
   该站是 Next.js SPA，但**全部 97 篇文章的 markdown 正文内嵌在页面 `__NEXT_DATA__` 的 `props.pageProps.articles` 里**：
   `curl https://help.dida365.com/articles/<任一 id>` → 解 `<script id="__NEXT_DATA__">` → 读 `articles`。
   ⚠️ 也就是说，先前那句"SPA 取不到正文"是**只用了 WebFetch、没看页面自带的数据载荷**造成的假缺席（原文留档是为了让后来者认出这个形状）。
   取到的一手仍然包含：番茄/正计时两模式、默认 25 分钟可自定义、铃声/白噪音/屏幕常亮、记录含时长与任务、
   **移动端可补记、桌面端仅补记不可删**、支持预计番茄数或预计时长。⚠️ 该页是移动端帮助镜像，桌面端行为以截图为准。
5. **`monthGrid` 能否直接长成"可点的月历打卡格"**：数学现成但今天只服务 `DatePicker`，"格子带打卡状态 + 可点 + 跨月灰显"三件事**无实现证据**。
6. **移动端要不要同样三栏**：主战场是移动端 + macOS + Windows（[ADR-0036](../adr/0036-main-battlefield-and-rn-single-source-ui.md)），A7.3 只回答了"怎么回收"，没回答"移动端的概览放哪"。

第二批（2026-10-03，C1b 那些结论里**不能当依据**的部分，逐条列出）：

7. **Notion 的 side peek 有没有未选中态**：官方帮助正文是 JS 壳，`/help/side-peek`、`/help/preview-pages`、`/help/pages`、`/help/databases` 取回的只有页面壳，只拿到快捷键页里 "database peek view" 一句。⇒ C1b-Q1 表里"Notion = 选中才出现"是**推断**，不是一手结论。
8. **Linear 第四栏在未选中时的形态**：changelog 只描述选中某个 issue 之后那栏里有什么。
9. **现行 Apple HIG 里有没有 Inspectors 专页**：`inspectors` / `inspector` / `detail-views` / `placeholders` / `status-views` / `empty-states` 六个 slug 全部返回同一份 **15639 字节**的 404 壳 ⇒ 据此说"HIG 无此专页"，但**没有逐条翻完目录**，不能排除它改名或并入 iPadOS 专章。（⚠️ 可迁移的手法：Apple 营销页对 `WebFetch` 返回 noscript 壳，要取 `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<slug>.json`；**同一尺寸的 JSON = 同一份壳，不是内容**。）
10. **Microsoft 有没有一方通则区分 "empty state" 与 "no data"**：**未证实**。`learn.microsoft.com/windows/apps/design/**` 下搜不到 empty-states 页，最接近的两条是 `ListDetailsView` 的属性描述（API 级）与 Power BI 的 "Show items with no data"（图表级、语境不同）。⇒ 本文早先若把"Fluent 区分两者"当依据，那条依据**不存在**；IBM Carbon 的 "No data empty states" 是**另一个设计系统**。
11. **m3.material.io 的 empty states / large screens 指引**：页面存在但是 Angular SPA，正文取不到 ⇒ Google 侧结论只来自 developer.android.com 的规范布局文档。
12. **Things 是否存在过 Inspector 面板**（老版本或设置里）：只证到"现行功能页 + 现行快捷键表里没有"，那是**缺席证据**而不是"从未有过"。
13. **各家未选中态到底有没有对用户显示过统计概览**：本轮**零界面截图**，全部是文档结论。要把它定死，判据应是四端各一张图（工单 §4 的固定动作本来就这么要求）。
14. **Mochi**：官网未定位（`mochi.click/pricing`、`/pro` 均 404，根域是个 WordPress 博客页，`web.mochi.app` 404）⇒ 它的档位与"卡挂在哪"**没有任何一手证据**。
15. **Mymind**：只扫了首页（`spaced`/`forgetting`/`flashcard`/`memor*`/`review` 命中 0）。⚠️ 那是**首页级缺席**，不是文档级缺席。学堂在线（xuetangX）本轮完全未查。
16. **《广告法》第九条第三项原文**：只从市场监管总局《广告绝对化用语执法指南》第二条的**转述**拿到（该来源本身一手，但它是转述），gov.cn 公报链接 404、人大网/法规库未命中 ⇒ **法条原文与现行修正版条号未核**；且该指南自称"供各地…**参考适用**"（第一条），是执法指引不是法条。
17. **Duolingo 在应用商店里怎么写**：`blog.duolingo.com` 是 JS 渲染取不到正文、`how-duolingo-makes-learning-effective/` 404。本轮拿到的措辞来自 **PNAS 2019 论文摘要**（一手学术来源，[Tabibian et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6410796/)），不是商店文案 ⇒ "商业文案的水位"这条只由 Anki / RemNote / 滴答三家支撑。
18. 🔴 **艾宾浩斯的全部具体数字**（"20 分钟遗忘 42%""1 天后 66%"，以及中文圈通行的"5 分钟/30 分钟/12 小时/1 天/2 天/6 天/15 天/31 天"复习表）：**均未追溯到一手**（未取到 1885《Über das Gedächtnis》或 1913 英译全文，Gutenberg 探测取到的是另一本书）。⇒ 这些数字一旦进对外文案，撞的就是上面第 16 条引的那份指南**第七条**（"广告主无法证明其真实性的，依照《广告法》有关规定予以查处"）；同时 B2 小节那条"Murre & Dros 2015 复现了曲线、但 24h 处有上跳"的表述**仍然只能当内部依据**，不是可以印在商店页上的承诺。
19. **fsrs.js 仓库描述那句"overtakes Anki and catches up with SuperMemo"**：跑分出处未追（SuperMemo 方基准）⇒ **不得**作为 heyta 的文案依据。
20. **Obsidian 官方同步定价 / AnkiMobile 具体售价 / OmniFocus 价格与 Pro 边界**：均未核（`apps.ankiweb.net` 不印价格）。⇒ C1b-Q11 的结论只到"没人把算法放进付费墙"，不到"他们各自卖多少钱"。

第三批（2026-10-03 19:27，C1b-Q2 那批习惯口径结论里**不能当依据**的部分）：

21. 🔴 **滴答"月完成率"的分子/分母、以及"完成天数 vs 完成次数"的官方定义**：帮助中心**没有任何一篇给公式**
    （《习惯数据统计》只给「月度打卡表 / 打卡概览 / 年度热力图」这三个**名字**）。六卡读数仍来自**截图**。
    ⇒ C1b-Q2 里那条"完成率 = 达成天数 / 计划日数"是从**任务侧《成就值》的定义借推**到习惯侧的，**不是滴答习惯页的原文**。
    补法：在同一习惯上制造"一周 3 次、某日只完成 2/5"的输入，逐卡读数。
22. **滴答"一周完成 N 次"到底怎么换算成"打卡天数"**（排期日模型还是配额模型）—— 文档没写，C1b-Q2 的两种口径都吻合现有文字。
    ⇒ 推荐里"走排期日"这一条**没有被竞品直接证实**，它的依据是 heyta 自己的冻结/`isStillAlive` 按**计划日**计数这一内部事实。
23. **Streaks 的日界线 / 部分完成 / 一天能否多次完成**：`crunchdevelopment.com` 全线 404，`streaks.app` 的 FAQ/help/features
    **全部返回同一页**，官方说帮助**只在 App 内**（"Streaks contains an in-app help system"）⇒ 只能证到
    "一天一次、上限 24 个任务、按日加连续"这一层。
24. **Loop 的"完美日 / +2"那一档**：FAQ 出现 "If you perform a daily habit perfectly"，但 `StreakList` / `ScoreList` / `Entry` 里
    **没有找到 2.0 阈值的代码**，只核到 `percentageCompleted = min(1.0, rollingSum/numerator)`（`ScoreList.kt:133`）。
    ⇒ 旧文档里"完美日 = 2 倍"的说法**本轮未证实，不要写进判据**。
25. **Time4Play / Habitify / Fabulous / Notion 类追踪器**：本轮**一家都没拿到一手来源**（Time4Play 是 Loop 的 fork，口径应同 Loop，但未逐一核）。
26. **Google Fit 的日目标字段**（`dailyStepGoalTotal` 等）：相关页面 404；本轮只核到**日桶边界**（"midnight of the current day"）
    与 Apple `HKActivitySummary` 的成对日级目标字段。
27. **滴答的会员闸门**（习惯统计的历史长度、周/月视图是否付费）：《习惯数据统计》里只写"高级会员还能够直接查看你这一整个月的习惯打卡进度"，
    其余面未核 ⇒ 与 C1b-Q11"没人把算法放进付费墙"不冲突，但**滴答确实把一部分统计放进了会员**。


## C3. 与既有冻结调研的分工（唯一事实源规则）

本文**不重复**下列文档的内容，只引用；同一事实只在一处定义：

| 事实 | 住在哪 |
|---|---|
| 滴答各视图的**首屏取证**（像素占比、rail 图标、习惯卡片形状） | [dida-capture/INTERFACE-NOTES.md](dida-capture/INTERFACE-NOTES.md)（⚠️ 其中"习惯页无详情栏"与"⚡/🔥 含义"两条已被本文 A6 更正） |
| 滴答**帮助中心目录与定价**（97 篇、FAQ 67 问、习惯数量 5/299 的会员闸门） | [dida365-help-center-ia.md](dida365-help-center-ia.md) |
| 滴答**功能级差距**（P0/P1/P2 分级、13 项"看起来有其实没有"） | [dida365-feature-benchmark.md](dida365-feature-benchmark.md)（2026-09-28 基线，本文 A4/A5 记录了它此后的变化） |
| 外壳**四段骨架与 L0–L4 分层** | [dida-view-unification.md](dida-view-unification.md) |
| **两端入口覆盖**（哪个动作在哪端可达） | [multi-end-entry-coverage-audit.md](multi-end-entry-coverage-audit.md) |
| **玻璃材质与浮层**逐面裁决 | [ui-aesthetic-and-design-system-coverage-audit.md](ui-aesthetic-and-design-system-coverage-audit.md) → [ADR-0042](../adr/0042-glass-material-boundary.md) |
| 本文：**详情面对标 + 习惯/番茄逐元素 + 背诵差异化证据** | 本文（唯一事实源） |

工单与排序**不在本文**，在 [detail-pane-alignment.md](../plans/detail-pane-alignment.md)。
