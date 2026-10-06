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
| 🔴 不抄"右栏 36% 宽空态插画区"（"无详情时纯浪费；窄屏/移动端必须回收"） | 同文 §5.4 `:622` | ✅ **被印证，继续有效、不重开**。但它管的是**里面放什么**，不是**要不要这个槽**：槽常驻（R-1）+ 里面放视图级概览（滴答番茄页自己的做法）+ 窄屏回收与可收起（R-2/R-4）⇒ 三条同时满足就是"对齐了交互逻辑又没违反裁决"。**2026-10-04 那一格"放什么"有了新答案**：产品负责人拍板"无选中态时放 AI 面（对话助手）"，裁决本身没被推翻 —— 现量与判据都记在主计划 §5.4 末尾那段 dated 说明里，本条不重抄 |
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

> 🔴 **上面那张表里四档 ❌（月打卡 / 月完成率 / 月完成量 / 总完成量）与下一段那句"`HabitLog.value` 界面不可达"，
> 在 2026-10-05 → 10-06 之间都过期了**：自然月那一族现在有唯一所有者
> `computeHabitPeriodStats`（`packages/domain/src/habit-streak.ts:328`，出口 `packages/app-host/src/motivation.ts:202`，
> 四格渲染 `packages/ui/src/habits/HabitBoard.tsx:590-631`），落地账见计划 §8.121 与
> [习惯面完整计划](../plans/habits-alignment.md) §8。原文照留，是为了让后来者认出
> **"状态写在两份文档里、代码往前走了"** 这个形状 —— 要状态就现量，别读任何一份文档的断言。

🔴 **最重要的一米**：`HabitLog.value` **界面不可达** —— `HabitBoard` 回调只有 `onCheckIn(habitId, date?)`（`HabitBoard.tsx:180`），两端调用处都不带 value，落盘写 `value ?? habit.target ?? 1`（[`habit-actions.ts:311`](../../packages/app-host/src/habit-actions.ts)）。⇒ **计数型习惯只能"一键记满目标值"**，记不了"今天读 5 页 / 目标 8 页"。这条不修，「每日完成量」图与「月/总完成量」两卡**即使做出来也没有部分值数据**。它也正是 [dida365-feature-benchmark.md:224](dida365-feature-benchmark.md) 第 9 条"看起来有、其实没有"里**至今仍未修**的那一半（同表的 target/unit/goalType 已补，见 [multi-end-unified-strategy.md §幻觉复核第 9 项:821-860](../plans/multi-end-unified-strategy.md)）。
🔴 **这一句已过期（2026-10-06 现量）**：`checkIn(habitId, date?, value?)` 在 `packages/app-host/src/habit-actions.ts:167`，
两端宿主都把 `value` 递下去（`apps/web/src/features/habits/store.ts:123`、`apps/mobile/src/screens/HabitsScreen.tsx:403`）
⇒ 这就是 **W6**，落在 `ca2cf606`（本篇后面那句"W6 落在 `ca2cf606`：`onCheckIn` 现在带 `value`"已把这件事更正过一次，
但**上面这句"界面不可达"当时没跟着改** —— 于是先读到 ❌ 那半句的人，要往下翻很远才撞见已修）。

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
   补法：分三档各有一条取法 —— 体积与依赖形状用 `npm view ts-fsrs dist-tags optionalDependencies`；是否含原生 binding 用 `npm pack` 后解压数 `.node` 与 `.wasm` 文件；Hermes 可运行性在移动壳里 import 它并跑一次纯函数，走 `pnpm verify:mobile-*` 那条真机链读控制台。鸿蒙那一档本轮拿不到（缺模拟器系统镜像与签名，AGENTS §3.24），最多到 `verify:harmony-rnoh-js` 的 bundle 魔数层。
4. **"首复习不早于 24h"是本文从 24h 上跳推出的设计含义**，论文本身没给产品建议。
   不可补：论文侧不存在这句产品建议，没有可核的对象 ⇒ 这一条的关法不是补证而是措辞约束（B2 已钉"只当内部依据"）；界面上任何"论文建议 24 小时"都算引用造假。
5. **需求侧一手证据为零**：没有一条访谈/问卷证明待办用户要背诵。
   不可补：本仓没有触达真实待办用户的渠道（无内测名单、无问卷投放位），补它的动作是决定要不要做用户访谈 ⇒ 要人。在此之前 Part B 里任何"用户会要"的措辞都不许进对外文案。
6. **艾宾浩斯类 App 的规模与留存**未取（只有条目链接，没有榜单/评分量级）⇒ "这是被验证过的品类"这句话**当前无据**。
   补法：规模取各家 App Store 产品页的评分条数（公开 HTML，可直接 curl）；留存长期不可补 —— 只有 Sensor Tower 类付费面板有，本仓无账号 ⇒ 那句"这是被验证过的品类"无论如何不许写。
7. **SiYuan 闪卡的实际完成度**只到二手（盘点文档的描述）。
   补法：SiYuan 是开源的 ⇒ 直接读它仓库里的闪卡模块源码与已关闭 issue，把二手描述换成 `file:line`；不需要装 App，也不需要新渠道。

---

## C1. 要拍才能继续的值（两条轨合在一张表）

🔴 这张表和下面的 C1b 各节之间有一条**常驻对账门禁**：`node scripts/check-detail-pane-c1-coverage.mjs`
（每行要么有对照节、要么在自己那一行写明属于哪一类例外；每个对照节必须有日期 + 出处，URL 或 `file:line` 择一即可，
**并且必须有「推荐/建议」那一档** —— 行首加粗标签，或由节标题写明不需要拍。那一档 2026-10-04 才补上，
它对应的正是目标第 1 条原话里"把结论**与推荐**写回"这半句：此前摘掉整节推荐段，门禁照样报绿（工单 §8.79）。
判据读数在工单 §8.59 / §8.79）。写这张表的人不必再靠自觉去数"这一行有没有对照节、这一节有没有给答案"。
🔴 臂已固化成装置（`research/tools/mutation-rigs/mutate-detail-pane-c1-coverage.mjs`；**臂数不抄在这里** ——
抄一次就漂一次，现取：跑它，最后一行就是）
且两枚本线判据都已挂进**合流预检**的 GATES（`scripts/verify-detail-pane-merge-preflight.mjs`，
产物树模式 `--root`）—— 两趟读数在工单 §8.64 / §8.65。

| # | 要拍的值 | 属于 | 卡住什么 |
|---|---|---|---|
| 1 | 详情栏放"仅选中项"还是"永远放概览+记录+选中项"。🔴 **这一条已被拍掉一半**（2026-10-04 产品负责人「无选中态的时候默认显示 AI Chatbot」，且**已经落进 `main`**：`apps/web/src/App.tsx` 里 `<aside className="ht-app__detail" data-testid="detail-column">` 那一段是那句裁决的原话注释、同一文件里 `{contentView === 'focus' ? <FocusDetailPane /> : …}` 是实现、窄档退回中间列在 `styles/app/narrow.css` 的三条媒体块里。判据 `e2e/tests/ai-row-layout.spec.ts:19-20/78/93/98/103`）⇒ 现在剩下的题面只有**"选中某条时那一格换成什么"**，而 main 上那句原话自己划了边界："它替换的是同一块位置 —— 不另开第三处"。⚠️ 这条更正的来源不是本次外部调研，是**仓库现状**（外部调研那一半仍看 C1b-Q1，它没被推翻）。🔴 **2026-10-05 02:5x 剩下那一半也由本线拍完**：未选中=维持已上线的 AI Chatbot（派生概览**不做**）、选中=同一格换成该实体面单且不另开第三处、专注面那一格是已登记例外 —— 拍板记录与推翻代价在 C1b-Q1 末尾。🔴 **2026-10-05 04:1x 就地改法**：这一格原先把前三处写成 `App.tsx:2528` / `:2542` / `:2094-2096` 三个**行号**，现量三件的结局不一样，逐条说清 —— ① `:2542` 指 `<aside>` 那一段，本批在同一个文件里净增 25 行（`git diff --numstat` = `29 4`）之后它跑到了 **2553**；② `:2528` 恰好还落在同一个注释块上（块起点没动），**这是巧合不是正确**；③ `:2094-2096` 在**本批改之前的 HEAD** 上就已经指错了 —— `git show HEAD:apps/web/src/App.tsx` 那三行是"空态包在 `task-list` 锚点里"的注释，与"窄档退回中间列"无关。⇒ 三枚锚改成**符号锚**（那段 JSX 与那个 CSS 文件），因为"行号随任何一次插入漂移"这件事已经被①量到，而③说明**它连当下是不是对的都不能靠记**。`e2e/tests/ai-row-layout.spec.ts` 那五个号**没动**：判据文件本批一行没改，且那些号指向的是同一文件里的用例，不是产品代码。 | A | 决定 A0.5 那条裁决要不要动；决定右栏无内容时是否允许装饰 |
| 2 | 习惯统计三处口径：日历 vs 韧性 / 自然月 vs 滚动 / 天 vs 次 ⇒ 🔴 **2026-10-05 01:3x 由本线拍完（三值 + 一条新拆出的第四值），拍板记录与推翻代价写在 C1b-Q2 末尾那一节**；本行不再是"要拍"，但**外部对照只覆盖其中三值**，第四值（完成率分母）明文是**没有一手依据的裁决** | A | ~~六张卡里五张的数值与句子~~ ⇒ 口径已定，卡在实现：W8 开工（读侧四函数已派工） |
| 3 | ~~计数型习惯先修 `HabitLog.value` 那一米~~ ⇒ **这一格当初就放错了地方**：它不是"要拍的值"，是一个工程缺口，2026-10-04 已随工单 W6 落码（判据十一臂、门禁七道 RC=0；只剩四端重装），所以**没有 C1b 对照节** | A | 「每日完成量」图 + 月/总完成量两卡的数据源 —— **已通**；剩余未闭合项只有一个：AGENTS §6.1.1 的当前产物 |
| 4 | 非时间单位在分类体系里怎么安放 | A | 「65 页」这类量的图表口径 ⇒ **别人怎么做已补齐**，见 C1b-Q4（六款产品一手） |
| 5 | 番茄"正计时"要不要做 | A | 🔴 **前提被现量改写了**：`FocusSessionKind` 是**阶段**（work/short/long），不是计时模式；真正卡住的是 `FocusActions.log` 要求 `plannedMs > 0`。一手对照与代价见 C1b-Q5 |
| 6 | 专注记录可否补录/删除 | A | 🔴 原句"滴答做法是可补记不可删"**只对了一半**：那是**平台**不对称（桌面端可补记、不支持删除），真正写死的规则是**时长不可改**。逐产品一手见 C1b-Q6 |
| 7 | ~~确认"番茄页不许塞进列表模型"继续有效~~ ⇒ **已核，不需要拍**（2026-10-04 现量，见 C1b-Q7）。🔴 它的外部锚是**有意豁免**而不是漏做，理由与结案口径写在未核实台账**第 32 条**（承重已换到我方代码判据） | A | ~~任何三栏改造的形状~~ ⇒ 已确认仍有效，且给了可复跑命令 |
| 8 | 详情面里"无数据的区块"要不要显示（空即隐藏 vs chip 常驻）⇒ 🔴 **2026-10-05 02:5x 由本线拍完**：按三态契约（`affordance` 常驻 / `record` 可隐藏但区块头留"添加" / `hidden`），拍板记录与推翻代价在 C1b-Q8 末尾；⚠️ **配套门禁不在今天**（那一格还没有区块可分类），它已钉成"详情面本体"那一单的 DoD（工单 §8.125 第 3 节） | A | ~~详情面第一屏的信息密度与能力可发现性~~ ⇒ 态已定，卡在实现 |
| 9 | 背诵做不做，走 R1 / R2 / R3 / 都不做 | B | B6 第 5 条：需求侧一手证据为零，这是产品判断 |
| 10 | 复习对象挂在谁身上（任务 / 便签 / 新卡片） | B | 是 IA 决策，牵动 [multi-end-unified-strategy.md §7.1e](../plans/multi-end-unified-strategy.md) 那张次级表面表 |
| 11 | 免费还是付费 | B | 牵动"收费的是服务器不是功能"的既有口径 |
| 12 | 界面上允许出现哪些科学宣称 | B | **对外话术的合规边界**，不是工程问题（B2 的收窄 + B6 第 1 条未补一手） |
| 13 | **用户主动收起那一栏时**，格里的常驻内容是跟着藏还是退回中间列 —— 🔴 这是 2026-10-04 15:2x 由工单 §8.54 核对合并产物时**照出来的新一格**，不是 #1/#8 的重复（#1 问"那一格放什么"、#8 问"同一格内部的空区块"） | A | 合并产物上那一格的行为语义（AI 面与本批 W7 的专注概览都住在同一格）；两种答案都要改同一处代码，只是方向相反 —— 现量链在工单 §8.54 第 1 节。对照与代价见 **C1b-Q13** |
| 14 | **点一行清单（PROJECT）或标签（TAG）到底是什么语义** —— 🔴 2026-10-04 21:5x 由工单 §8.95/§8.96 逐面现量时**照出来的新一格**（不是 #1/#13 的重复：#1 问"那一格放什么"、#13 问"收起时它去哪"，本格问的是"点容器这个动作算不算选中"） | 目标第②条"各处同一套" | 现量：web `apps/web/src/features/projects/ProjectsPanel.tsx:248`（project）与 `:350`（tag）**都传** `onSelect`，但它回传的是 `TaskFilter`＝**过滤**；mobile `apps/mobile/src/screens/ListsSection.tsx:183` 与 `apps/mobile/src/screens/TagsSection.tsx:121` **刻意不传**（理由写在 `:174`："移动端没有侧栏筛选这个概念"）⇒ 同一个动作两端两种语义，W1 那句"跨视图通用"卡的正是这一格。**🔴 2026-10-05 由本线拍成 A**（容器不进选中宇宙；改名 `onSelect→onFilterWith` 是这条裁决的承重，~~没做完之前这一格不许声称闭合~~ 🔴 **已于 2026-10-05 02:3x 做完**（六枚文件 + 名册 needle 同批；残留的 `onSelect` 逐处过语义、四把臂台全符合预期，读数在工单 §8.122）—— 四步、张力说明与推翻代价在 C1b-Q14 末尾 |

> 🔴 这张表里**卡住工单**的那几条，业界实际怎么答、推荐与代价已落在 **C1b**（条数别抄这里的，现取：
> `sed -n '/^## C1\. /,/^> 🔴/p' docs/research/detail-pane-alignment-and-spaced-review.md | grep -cE '^\| [0-9]+ \|'`）：
> #1 / #2 / #8 / #9–12 来自 2026-10-03 第二批一手调研（#2 的对照在 19:27 到齐）；
> **2026-10-04 08:0x 第三批把 #4 / #5 / #6 也补齐了，并把 #7 从"要确认"改成"已核"**（四节都在 C1b 末尾）；
> **15:2x 第四批补 #13**（三条一手 —— VS Code / Android canonical layouts / Apple HIG Sidebars，另附三条明文边界；
> 它比这张表里其他节都窄，因为它问的是一**格**的收起语义而不是一个功能面 —— 引用时带上"窄"这一句）。
> 本节仍是"要拍"的清单 —— C1b 只把选择题变成**有出处的**选择题，不替谁拍。
> ⚠️ **这句到 2026-10-05 已经不完整**：#2（含新拆出的 A′/A″，以及 #4 的**读侧那一半**）已由本线拍完，
> 记录在 C1b-Q2 末尾；工单 §3c / §3f 那两枚（页头许不许被压窄、同一格里 AI 面与专注概览怎么共处）
> 是**合流冲突格**、不是这张表里的行，拍板与代价在工单 §8.117；§8.82 那格棘轮裁决在 §8.118。
> #7 是"已核不需要拍"，#1 由产品负责人拍掉一半。
> 🔴 **仍然在拍的是** #5 / #6 / #8 / **#13**（"收起那一栏时常驻内容跟着藏还是退回中间列"——
> 本线**没有**拍它，别把它和 §8.117 那两枚混成一批）/ #9–12。
> ~~#14~~ 同批已拍成 A（见 C1b-Q14 末尾），但**它的代码半边（改名）没做完 ⇒ 那一格不许读成闭合**。
> ⚠️ 上面这两句本身也是会漂的断言：#2 与 #14 就是在本节写完八分钟之内被拍掉的，
> 引用"还剩哪几格要拍"之前先跑 `node scripts/check-detail-pane-c1-coverage.mjs` 并逐行读 C1 表。
> 也就是说本行的正确读法是"**这张表不替没交过决策权的人拍**"，而不是"本线一律不拍"。
> ⚠️ 但 #5 / #6 那一格里**连问题本身都被现量改写过**（原来写的前提是错的），这类更正要看 C1b-Q5 / Q6，别看这张表。

> 📏 **13:1x 逐项对账这张表（Goal 第①条的收口读数，零代码改动）**：卡住工单的那几条**都有对照节**，
> 每节的 URL 数与"访问日期串"数现量如下 —— 引用时要带这一句，因为这两个数就是"带出处、带日期"这条要求的可查形态：
>
> 🔴 **下面这张表已被门禁自己打印的逐节读数取代**（19:2x 现量，别再用它）：
> `node scripts/check-detail-pane-c1-coverage.mjs` 的「逐节读数」段打印同样四列（外加 19:2x 新加的 `推荐=`）。
> 复跑按"出现次数"口径重数了一遍，**8 行里只有 2 行逐字复现**（Q1 = 5/1/0、Q8 = 4/2/5），
> 其余六行都对不上；最响的一行是 **Q7 写着 URL=3 / 日期=4 / 未核实=4，而那一节今天 `https://` 命中 0**
> —— 它的取证全是 `file:line` 与仓库内 md 路径（门禁那三档判"出处"时 URL 与 `file:line` 择一即可，所以它一直是绿的）。
> ⚠️ 差 1–2 的那几行（Q2/Q4/Q5/Q6 的日期串）我**判不出**是口径还是 13:1x 之后的编辑加上去的 ——
> 这正是"把机器读数手抄成一张表"要付的代价：抄件没有口径，下一轮无法复核。原行留着不划（它是那一趟的记录），
> 但**引用这一格要给门禁输出，不给这张表**。
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
> 📏 **15:2x 新增那节不并进上面这张表**（它是 13:1x 那一趟的读数，混进来就假报了趟次）：
> C1b-Q13 的同形态读数现取 = **URL 4（去重 4）/ 日期串 3 / 明文边界 3 条**（取法：把该节切出来 `grep -oE 'https?://…'` 现数）。
> 三条一手分别是 VS Code、Android canonical layouts、Apple HIG Sidebars，其中 Apple 那条走的是本文件 C2 第 9 条写好的 JSON 通道。
>
> ⇒ 这张表现在**没有一条"缺调研"**，只有"缺拍板"；#3 那一格已从"要拍"改成"是工程缺口、已随 W6 落码"。

## C1b. 别人怎么做的 × 推荐（2026-10-03 第二批一手调研）

> 🔴 **本节不替产品负责人拍**，它只做一件事：把"这 5 项要拍的值，业界实际怎么答"摆出来，
> 每条带**出处 + 访问日期 + 一手/二手**，并给一个带代价的推荐。
> ⚠️ 那句"每条都带"里只有**出处、日期、推荐那一档**三项有常驻机器消费者
> （`scripts/check-detail-pane-c1-coverage.mjs` 的腿 1–4，工单 §8.79）；
> **"一手/二手"与"带代价"没有**。现量（2026-10-04 19:1x，按节标题切区段数 `代价` 二字）：**5/9 节出现**
> （Q1 / Q2 / Q4 / Q5 / Q13），另外四节里 Q8、Q9~Q12、Q6 写的是"为什么不选另一支 / 贵的是产品面 /
> 有同行依据的最小组合"这类**同义形状**，Q7 是标题写明不需要拍的那一档（本来就不给推荐）。
> 给它建行首词表会造出一批假红，所以这一档留在散文里，靠评审。
> （与 §8.78 那条"触发词表只认一种字面形状就静默失去对象"是同一件事的另一侧。）
> ~~完整表在 `/tmp/heyta-research/q1-q2-detail-pane-content-and-disclosure.md`（18 条来源）、
> `/tmp/heyta-research/q4-srs-in-task-managers-and-claims.md`（24 条 URL）与
> `/tmp/heyta-research/q3-habit-statistics-conventions.md`（Loop/Habitica 逐行 file:line + Streaks/滴答/Apple/Google 一手文档）~~
> 🔴 **那三份已经没了**（2026-10-04 13:2x 现量：`ls /tmp/heyta-research` → `No such file or directory`，
> 距写下"会随机器没掉"这句不到一天）。⇒ 本节从"摘要 + 承重出处"**升格为唯一记录**。
> 🔴 **取证量这里不写数**（原来那两个数 56/55 与"file:line 5 处"没带口径，19:1x 用另一种口径复跑读到
> 区段内 URL 55 次 / 去重 54 条、`file:line` 38 处 —— 差的那一档正是"5 处"没有写明它排不排 Q2 那张逐行表的 33 处）。
> 现取命令（口径写在命令里，不再落抄件）：
> `node -e 'const t=require("fs").readFileSync("docs/research/detail-pane-alignment-and-spaced-review.md","utf8").split("\n");const s=t.findIndex(l=>/^## C1b[.．]/.test(l.trim())),e=t.findIndex((l,i)=>i>s&&/^## /.test(l));const r=t.slice(s,e).join("\n");const u=(r.match(/https?:\/\/\S+/g)||[]).map(x=>x.replace(/[)>.，、；]+$/,""));console.log("URL 出现",u.length,"去重",new Set(u).size,"file:line",new Set(r.match(/[\w./-]+\.(ts|tsx|js|mjs|json|css|md|swift|kt|ets|java|py|sh):\d+/g)||[]).size)'`
> ⚠️ **丢了什么要说清**：那三份里的"逐条原文与未采用的对照行"不可恢复 —— 也就是说
> 本节每一行的**出处**还在，**得出该结论的中间过程**（哪些来源被比过、比出什么差异）没了。
> 下一轮若要引这些结论做产品决策，要重新取证的正是后者，不是重新找 URL。
> 📌 **可迁移的形状**：把"完整表"放在临时载体、把"结论"放进仓库，看起来是同一件事的两层，
> 实际上**只有落仓的那一层会活下来** —— 而人写"完整表在 /tmp/…"的时候，读者会以为它可查。
> 要么完整表落仓（哪怕进 `docs/research/` 的附录），要么**不要在仓库里许诺它存在**。
> ⚠️ 这一条**该进环境陷阱台账但没有行号**：`docs/reference/environment-traps.md` 此刻正被并行那条线写着
> （§8.44 的 Q1 交叠清单里就有它），按既有裁决不往别人正在写的共享台账插行 ⇒ 记在这里，
> 待该台账的持有者收口时按"临时载体不可当完整表落点"取号入档。
> 🔴 **"锚在，但锚取不到"这一档以前没有任何消费者**（2026-10-05 03:2x 补）：
> `check-detail-pane-c1-coverage` 判的是每个对照节**有没有**外部锚（URL 或第三方源码行号），它**不取 URL**；
> `docs-link-check` 跟的是 markdown 链接，而本节大量出处写成行内 `` `path:line` `` 或裸 URL ⇒ 两边都不看。
> 现在有一枚显式调用的对账装置：`node research/tools/detail-pane-citation-liveness.mjs`
> （**不进 `pnpm check`** —— 它依赖外网与对端反爬策略，拿它拦提交会得到一批与文档质量无关的红）。
> 它把每条外链真取一次，按 `LIVE / REDIRECT / BLOCKED / DEAD / OTHER` 分类并打落点；
> ⚠️ **BLOCKED ≠ 链接坏了**（`developer.android.com` 那两条规范页对匿名请求返回 302 进 Google 登录回路，
> 跟进去是 50 跳 —— 那是**对端把探针挡在门外**），而 `DEAD` 里也要先过一遍"是不是探针把 URL 拼坏了"：
> 本装置头三趟各踩一次截断 bug（反引号与中文标点、markdown 自动链接的尾 `>`、右括号后紧跟汉字），
> 症状完全一样 —— 一批 404。⇒ 现在有一条**分母自检**：解析结果里只要还剩尖括号、引号或任何汉字，
> 直接 `VERDICT=PROBE_BROKEN` 退出 2，**不拿脏分母判生死**。最近一趟读数与逐条名单在工单 §8.129。

### C1b-Q1（= C1 #1：右栏放"仅选中项"还是"永远放概览 + 记录 + 选中项"）

**一手分布**（访问 2026-10-03，全部为官方文档 / 官方帮助中心 / 官方仓库）：

| 做法 | 谁 | 关键原文（短句） |
|---|---|---|
| **未选中 = 一行提示字**，"自动放最新一封"是**默认关闭**的选项 | Outlook 阅读窗格 | "Turning on 'always preview messages' … With this feature turned off, … you will see 'Select an item to Read'"（[support.microsoft.com](https://support.microsoft.com/en-us/office/2fd687ed-7fc4-4ae3-8eab-9f9b8c6d53f0)） |
| 拉宽时给的是 **placeholder** 详情栏，不是概览 | Android 规范布局 | "the list and a placeholder detail pane are shown together"（[developer.android.com](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts)） |
| **API 层**把"无选中"当一等状态要求显式给内容（默认 `null`） | MS CommunityToolkit `ListDetailsView` | "Gets or sets the content to display when there is no item selected"（[learn.microsoft.com](https://learn.microsoft.com/en-us/dotnet/api/communitytoolkit.winui.ui.controls.listdetailsview.noselectioncontent)）⚠️ 这是**接口形状**，不是内容主张 |
| **选中才出现**（原地展开 / 浮层），没有常驻第三栏 | Things 3（🔴 本行原写 **Things 4**，2026-10-04 23:1x 按官网命中数改名，依据见 §C1b-Q8 开头第 ① 条）、Notion peek、Linear、Todoist、Gmail（默认 `No split`） | Things："When you open a to-do, it smoothly transforms into a clear white piece of paper"（[culturedcode.com/things/features](https://culturedcode.com/things/features/)，2026-10-04 23:1x 去标签文本逐字命中 1）；Todoist："In Todoist, click a task to open the task view."（[help](https://www.todoist.com/help/todoist/features/use-the-task-view-to-manage-tasks-in-todoist-eDeRDO0C)，同一趟逐字命中 1）⚠️ 同一页的右栏清单同时支撑 §C1b-Q8 的"常驻"那一档 —— 两行问的不是同一件事（这里问**这栏什么时候出现**，Q8 问**栏里空字段在不在**），不互相否证 |
| **没有任何一方**在常驻栏里放"当前清单的统计概览" | —（缺席结论：核的是上面这 5 家的对应页面） | 概览型内容别处放：Things 的 Progress Pies 在**列表里**，Todoist 的统计在独立的 **Productivity view** |

**压倒性一致的唯一一条**（不管选哪种都要满足）：可隐藏 + **多条恢复入口**（工具栏 / 菜单 / 快捷键）+ 记住状态 —— Apple HIG split views 原文 "Provide multiple ways to reveal hidden panes"；SwiftUI `.inspector` 的列形态"presentation state restored by the framework"。⇒ 这条可以直接写进 W4 的判据，不需要拍板。

**窄屏的一手答案互相冲突**：Apple 说 "adapt to a **sheet** in a horizontally compact size class"，Android 说"详情占位、**列表隐藏**"。一套 RN 组件只能取一个 ⇒ 取 **sheet**（与 heyta 移动端现有第二层页面同形，实现面最小）。

**推荐（带代价）**：宽屏常驻第四列；未选中时放**当前清单的派生概览**（今日到期数 / 完成数 / 最近 3 条活动），空清单退化成**一行字**。
- 为什么值得：这些数**已经在 `packages/app-host` 里算好了**（`motivation.ts` / `category-report.ts` / due 侧），概览是纯派生 ⇒ 不新增持久化字段、不 bump schema（与 ADR-0014 / ADR-0022 的"派生不落盘"同一条纪律）。
- 代价：这是本次调研里**唯一没有先例的一档**（上面那张表第 5 行）；一栏两态会让"选不选中"变成两种界面，实现面与认知面都翻倍。
- **兜底**：若拍"不要概览"，退化成 Outlook 那一行字（有先例、便宜、不抖动），但那一栏在未选中时基本不提供服务。
- ⚠️ **不能选"未选中就让整栏消失"**：那既违反本仓库已拍的「能力可见」，也让列宽在每次选中时抖动。

**#1 的拍板记录（2026-10-05 02:5x，本线拍：不取上面那条推荐，取"已上线那一半 + 面单"）**

🔴 **这条是我拍的**，而且拍的**不是**推荐那一档。推荐写的是"未选中时放当前清单的派生概览"，
而它自己被标注成"本次调研里**唯一没有先例的一档**"；与此同时 `main` 上已经落了一条**更具体**的裁决：
产品负责人 2026-10-04 原话"无选中态的时候默认显示 AI Chatbot"，实现是 `apps/web/src/App.tsx` 里
`<aside className="ht-app__detail" data-testid="detail-column">` 那一段（W2 开的槽；
⚠️ 本段原先写的是 `App.tsx:2542` 一个**行号** —— 同一文件此后被三次插入推移过，符号锚才是可复跑写法，
理由与逐条现量记在 C1 表 #1 那一格），判据 `e2e/tests/ai-row-layout.spec.ts`。两件事撞在同一个槽位上，所以真正要拍的只有一个问题：
**那一格在"未选中"与"选中某条"之间怎么切换**。拍下来的答案是：

1. **未选中 = AI Chatbot**（维持已上线的那一半，不推翻、不并存）。派生概览**不做**——
   它没有先例、且与 chatbot 争同一格；那句"一栏两态会让实现面与认知面都翻倍"在这里成立。
2. **选中某条 = 那一格换成该实体的详情面单**（同一句原话的后半："一旦选中任何东西右边就出详细的面单"），
   并且**不另开第三处** —— 这是 main 上那句裁决自己划的边界，本拍板把它升成规则。
3. 专注面那一格（W7 的常驻"概览 + 记录"）**保持**，它是 #1 的一个已登记例外：滴答那一栏在番茄视图里
   本来就与选中无关（§8.121 之前那几节记过），不因本拍板被抹平。

**推翻它的代价**：(a) 想让派生概览回来 ⇒ 必须先回答"它和 chatbot 谁占这一格"，那是**改一句已上线且有用例的
产品裁决**（`ai-row-layout.spec.ts` 那五条会红），不是加一个组件；(b) 想"未选中时整栏消失" ⇒
除本仓已拍的「能力可见」外，还会让 W4 的三条恢复入口判据失去对象。
⚠️ **装置那一半不在本节**：这一格今天还没有"详情面单"的内容可钉，所以本拍板**没有**配套的会拒绝的门禁 ——
它的落地判据挂在工单的"详情面本体"那一单（W1b 第 2/3 条腿与 W9 之后那批），
**不许把本节读成"已经有东西在守"**。
无一手依据那一档：本拍板不引入新的外部主张（派生概览那一档被**弃**而不是**采信**），所以不进未核实台账。

**#1 的派生题：任务那一格的字段在哪儿改（"行内展开编辑 vs 栏里编辑"）—— 2026-10-05 14:3x 本线拍完**

🔴 **这条是我拍的**，它是 #1 落到任务那一面时**必须回答而 #1 没有回答**的那一格：
#1 说"选中某条 ⇒ 同一格换成该实体面单"，但任务的字段今天住在**每行尾部那六个 chip** 里
（`App.tsx` 的 `renderTaskTrailing`），所以要么把字段搬进栏里，要么让那一格继续空着、
Enter 去展开行里那坨。工单 §8.130 第 1 节把这道题记成了"二选一，等裁决"。

拍下来的答案是**栏里编辑**，三条理由按承重排：

1. 那一格对便签（§8.130）与习惯（§8.133）都换了，只对**主对象**不换 ⇒ #1 那条裁决在它
   最该成立的地方不成立。这不是风格问题：W2/W4 花两单建的这根列，任务视图里至今是空的。
2. 取证侧同向：滴答"选中一条 ⇒ 第四栏换成详情面：大号标题 + **备注全文** + 子任务/提醒/
   标签区块 + 所属清单"（上面 A3 状态二那张表），Todoist 一手句子 "click a task to open
   the task view"（C1b-Q1 表第 4 行那条 URL）。
   ⚠️ **射程要说清**：滴答那一行是**截图级**取证（逐字段的一手文档句子没取到），
   而 Todoist 那句支撑的是"点开任务出 task view"这件事，**不**支撑"哪些字段必须在栏里"。
   后者是我方裁决，不新立外部主张 ⇒ 本节不进未核实台账（与上面 #1 那条同一口径）。
3. 行尾那一坨常驻控件实测要 **517px**（1440 视口下整行的 48%；窄到 900 时 496px 而行宽只有
   548 ⇒ 不换行就把标题挤到 0 宽，读数记在 `renderTaskTrailing` 那段注释与台账 G9）。
   把字段往栏里搬，行的宽度问题才真的解决；反过来让栏里继续空着，是**两根列都半用**。

🔴 **配套不变量（比裁决本身更承重）**：**每个字段任何时刻只有一个编辑器所有者**。
所以迁移只能按字段分阶段，每一单都要同时做两半 —— 搬进栏里 + 从行里撤掉 ——
不许出现"栏里也有一份、行里也有一份"的中间态（那是两套写入语义迟早漂的形状）。
第一趟落地的是**备注**（工单 §8.138）：栏里是全文输入框，行尾换成一枚**只读徽标**
（有备注才出现，即 #8 三态契约里的 `record` 那一档；"扫一眼要能看出哪些任务写了东西"
这个职责不能因为搬进栏里就丢掉 —— 它是看图照出来的，不是设计出来的）。

**推翻它的代价**：(a) 想把字段搬回行里 ⇒ 要重动的正是 `TaskRow` 尾槽与那批既有判据
（`due-date-edit` / `task-repeat` / `TaskOrganizer` / 提醒 / AI 那几族），比搬进来更贵；
(b) 想"字段留在行里、栏里只放只读概览" ⇒ 那是**第三种**形态，与本仓刚立的"不另开第三处"
直接冲突，且要先把 #1 重开；(c) 分阶段这件事本身可以改（一次搬完六个字段），
但**不许**改成"只搬一半、另一半留在栏里也画一份" —— 那违反上面那条不变量。

### C1b-Q8（= C1 #8：详情面里"无数据的区块"是空即隐藏还是常驻）

> 取证日期 **2026-10-03**。🔴 **2026-10-04 09:5x 复扫这一节时照出三行没有 URL 出处**（Things / Todoist / Outlook），
> 已逐行标成「**未核实 · 未附来源**」—— 本节顶部那句"一手取证"对这三行**不成立**，宁可挂未核实，也不补猜链接。
> ✅ **2026-10-04 23:1x 三行全部核回厂商自己的页面**（下面每行挂 URL + 整句原文 + 取法与命中数），未核实标记撤掉。
> 🔴 复核同时照出**两处错误**，都留档不划掉：
> ① **产品版本号写错** —— 原写「Things 4」。同一趟 `curl` 取 `https://culturedcode.com/things/` 与
>    `https://culturedcode.com/things/features/`：`Things 4` 命中 **0 / 0**，`Things 3` 命中 **6 / 7**
>    ⇒ 那句话本身是真的，但它说的是 **Things 3**。活主张已就地改名（本节 + §C1b-Q1 那张表第 4 行）。
> ② **上一轮"查不到出处"里有一半是探针的锅** —— 我先拿 `grep -F "Click Date"` 打在**原始 HTML 字节**上，得 0 命中；
>    而那句真在页面上，是行内标记把词切开了（`Click <b>Date</b> to add…` 这类）。**先把标签剥掉再打**才命中 1。
>    ⇒ 可迁移：对网页判"这句不存在"之前，必须在**去标签文本**上打过一次；原始字节 0 命中**不构成缺席证据**。
>    与 §7 第 171 条（构建产物里中文是 UTF-16LE，`grep` 恒 0）同族 —— 都是 needle 的字形与载体的字形对不上。

一手取证后**最重要的发现是问题本身问错了**：没有任何一家把这件事写成"空即隐藏 vs 永远都在"，它们写的是**这个区块是不是动作的入口**。

| 来源 | 站哪边 | 原文 |
|---|---|---|
| Apple HIG · Disclosure controls | 藏 | "Use a disclosure control to hide details until they're relevant." + "Place controls that people are most likely to use at the top of the disclosure hierarchy so they're always visible"（[HIG](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)） |
| Apple SwiftUI `ContentUnavailableView` | 不藏 | "recommended … where a view's content cannot be displayed … a list without items"（[documentation](https://developer.apple.com/documentation/swiftui/contentunavailableview)） |
| IBM Carbon · Empty states | 不藏，但**空间小就只留文案** | "If space is limited, use just text." + "In situations where there could be multiple empty states showing at once, we recommend using a tertiary button" + 设计必答第一问就是 "What will the pages … and **side panels** look like without content?"（[carbondesignsystem.com](https://carbondesignsystem.com/patterns/empty-states-pattern/)） |
| Microsoft Power BI | 藏（但藏的是**数据行**，不是功能） | "Power BI doesn't display all possible data by default" + "Turning on the option to show items with no data can negatively affect performance"（[learn.microsoft.com](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-show-items-no-data)） |
| Things 3（🔴 原写「Things 4」，版本号错，见上面第 ① 条） | 藏 | "If you like, you can add more details (tags, a checklist, a start date, a deadline), but those fields are neatly tucked away in the corner until you need them."（[culturedcode.com/things/features](https://culturedcode.com/things/features/)，2026-10-04 23:1x `curl` HTTP 200，去标签文本逐字命中 1）⚠️ **射程**：这是**营销页文案，不是界面规格** —— 它说"收在角落"，没说空字段在渲染树里到底存不存在。⇒ 只能用来支撑"藏有先例"，**不能**用来支撑"藏了也不会有人找不到"。未闭合的那半登记在 §C2 第 30 条 |
| Todoist 任务详情（右栏） | 常驻可操作 | 帮助页「Introduction to tasks」（页面自标更新于 2026-08-28）在 "On the right-hand sidebar, you can:" 这一组下列出三条：「Click the project name to move the task to a different project or section.」「Click Date to add a date, time, and duration to the task.」「Click Labels to add a label to the task.」（[todoist.com help · use-the-task-view](https://www.todoist.com/help/todoist/features/use-the-task-view-to-manage-tasks-in-todoist-eDeRDO0C)，2026-10-04 23:1x `curl` HTTP 200，去标签文本逐字命中各 1）第二枚同立场出处，说得更直白："For example, in case you don't need a reminder or label, attributes are compact but visible."（[todoist.com/inspiration/todoist-new-task-view](https://www.todoist.com/inspiration/todoist-new-task-view)，2026-10-04 23:1x HTTP 200：**整句在原始字节上 0 命中、剥标签后 1 命中**，短句 `compact but visible` 原始字节即 1 命中 —— 同一个句子，两种字形，正是上面第 ② 条那个探针坑的现场）同页还有一句可引用的形状描述："The new sidebar houses all other task attributes like the project, assignee, due date, priority, labels, and reminders."（剥标签 1 命中） |
| Outlook（经典版阅读窗格） | 一行字，不给插画 | 整句原文："With this feature turned off, the first time navigating to a folder after launching Outlook you will see 'Select an item to Read' in the navigation pane."（[support.microsoft.com](https://support.microsoft.com/en-us/outlook/use-and-configure-the-reading-pane-to-preview-messages-in-outlook)，2026-10-04 23:1x `curl` HTTP 200，原始字节命中 1；§C1b-Q1 第 1 行用的是 ID 形态 URL，实测 **301** 落到本条这个 slug，同一页）🔴 **语境比原先写的窄**：它落在「Always preview messages when switching folders in classic Outlook」那一节，条件是**该选项关闭** + 启动后首次进入文件夹，且厂商原文把出现位置写作 **navigation pane**（不是 reading pane）。⇒ 支撑"未选中时给一行提示字、不给插画"这个形状，**不支撑**"任何未选中态都是一行字"。🔴 原记那句"那是客户端界面串，不是文档句子"**已被否证** —— 它确实写在文档句子里 |

**推荐**：三态契约 **`affordance`（写入口，常驻，空态只占一行按钮级文案）/ `record`（纯记录，可隐藏但区块头留"添加"）/ `hidden`**，而且**这个判断住在共享组件层、四个壳不许各写一份**（AGENTS §3.5 的形状；所有空态文案进 `packages/i18n` 中英成对）。
- 为什么不选"全部常驻"：详情栏一屏七八个空行，正是 Apple 两条 progressive disclosure 告诫的形态。
- 🔴 为什么不选"全部空即隐藏"：本仓库已经吃过这个形状的反果 —— `tagIds` 全仓零读写那段记的是"零件都在、产品里没有这个功能"。**界面上隐藏空区块是最容易悄悄把一个功能变成"没有功能"的地方**，而这类失败从来不会报错。
- Carbon 那句 "use just text" 与本仓库已拍的「不抄空态插画」同向，可直接引用为一致依据。
- 🔴 **2026-10-04 23:1x 复核前，这一档是"未核时的自保措辞"**（原文：这三行即使被推翻，本推荐不动）。三行都回到一手之后，按实际读数改写：
  `affordance 常驻` 现在有**两枚一手**而不是单点 —— Apple 那句 "Place controls that people are most likely to use at the top of the disclosure hierarchy so they're always visible"，
  **加上** Todoist 那句 "in case you don't need a reminder or label, attributes are compact but visible"（后者是**同立场的直接先例**：空字段照样在场）。
  `record 可隐藏` 的依据仍是 Apple 第一句 + Power BI 性能那句，**新增** Things 3 的 "tucked away in the corner until you need them" 作先例
  （⚠️ **营销级**，不是规格级 —— 见上面那行的「射程」）。
  `空态只给一行文案` 的依据是 Carbon + Outlook，但 Outlook 那枚的**射程已收窄**（原文只覆盖"关掉 always preview + 启动后首次进文件夹"那一格），
  所以这一档的**主要依据回到 Carbon**。
  ⇒ 结论：**没有一档因这次复核而失去依据**；变化在两处 —— Todoist 由"未附来源"升为同立场一手先例，Outlook 由"通用先例"降为"有条件先例"。
  ⚠️ 保留这条改写本身：判据从"即使被推翻也不动"变成"复核后承重表变了"，**说明前者当时只是把不确定性挡住了，没有消掉它**。

**#8 的拍板记录（2026-10-05 02:5x，本线拍：按上面那条三态契约执行）**

🔴 **这条是我拍的**，拍的是推荐本身（与 #1 相反 —— #1 我弃了推荐）。三态：
`affordance`（写入口）**常驻**，空态只占一行按钮级文案；`record`（纯记录）**可隐藏**，但区块头留"添加"；
`hidden` 只给"这一面根本没有这个概念"的那种。判断**住在共享组件层**，四个壳不许各写一份（AGENTS §3.5 的形状），
所有空态文案进 `packages/i18n` 中英成对。

**推翻它的代价**：这一档一旦落成组件属性，改法就不是改文案了 —— 每个区块要逐个重新判态，
而判错的那一格症状是"这个功能好像不存在"（本仓 `tagIds` 那段事故的原形状：零件都在、产品里没这功能，
而且**不会报错**）。所以真正贵的是"把 affordance 判成 record"那一类错：它让入口消失。
⚠️ 反过来也要说清：把 `record` 判成 `affordance` 只多占一行，**不**是同类风险 —— 两档不对称，
判不准时应当往常驻那侧偏。
**装置那一半同样不在本节**：三态词表要有门禁，前提是详情面里已经有区块可分类；今天那一格除了专注面是空的。
所以这条的配套门禁挂在"详情面本体"那一单的**验收动作**里（工单 §8.125 第 3 节把这句话钉成了它的 DoD），
**不许**因为本节写了三态就认为它已被机器守着。
无一手依据那一档：`affordance 常驻` 有两枚厂商一手（Apple + Todoist 同立场）、`record 可隐藏` 有 Apple/Power BI
加一枚**营销级**的 Things 3 —— 那一枚的射程边界已写在上面表格里，未闭合的半截登记在 §C2 第 30 条，
本拍板**不**把它算作规格级依据。

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

⚠️ ~~一条依赖关系：上面凡涉及"多次"的期望值，在 W6 落地前不可达~~ ⇒ 🔴 **这条依赖已于 2026-10-04 解除**
（W6 落在 `ca2cf606`：`onCheckIn` 现在带 `value`，`HabitLog.value` 可写、可读、可落盘，"一天打 N 次"的期望值可达）。
原句留着是为了让下一轮看清**它当时是真的会编出假期望值** —— W8 若在 W6 之前开工，唯一诚实的选择是
把判据限定成"一次记满"，而不是给"多次"编一个数。


**C1b-Q2 的拍板记录（2026-10-05 01:3x，本线拍；证据就是上面那张一手分布表，所以这一节不是第二个对照节，
只是将上面那批推荐正式接管下来 —— 产品决策权已交下来：用户原话 2026-10-03「产品级的决策你也可以来做呀，
没关系的呀，为什么要我来呢？」）。每条都写清推翻它的代价，下一轮要改就改这几句，不要重开调研。**

| 值 | 拍定 | 一手依据 | 推翻它的代价 |
|---|---|---|---|
| **C 天 vs 次** | **天 = 唯一的连续性单位；次/量 = `Σ habitLogValue`**，未达标那天不记天、**照记量** | 六方一致（Loop `StreakList.kt:48-58` / Habitica `scoreTask.js:39-47` / Streaks / 滴答原话 / Apple `HKActivitySummary` / Google 日桶） | 低 —— 改回"次数进连续"要重写 `computeStreak` 与整条韧性判据，且会让"连续 N 天"变成"连续 N 次"，界面上无法解释 |
| **B 自然月 vs 滚动** | **全部自然月**，词固定"本月/当月"；`近 N 天` 只许出现在真滚动的地方（现有 90 天热力图） | 滴答**同时用两者并分别精确标注**（"追踪本月"/"近 30 天内"）；Loop 的 `TargetCard.kt:153-158` 是"名写月、算用 30"的**反面样本** | 中 —— 换成滚动 30 要改 `monthKey` 与全部月份判据；E2EE + 本地计算 ⇒ 没有服务端成本要求滚动窗口，所以这条纯粹是产品口径 |
| **A 完成率的分母** | **该月计划日数**（"原本安排在该时段的量"），**不是自然日数**；一周 3 次的习惯跑满 9 个计划日 = **100%**，不是 30% | 滴答《成就值》定义（**注意**：那是**任务侧**原文，习惯页怎么算**没有拿到一手**） | 中 —— 改回自然日数会让所有非 daily 习惯的百分比系统性偏低，且无法向用户解释 |
| **A′ 分母要不要扣掉没到的日子**（本行是新拆出来的第四值） | 🔴 **只数已到期**：`date <= min(今天, 月末)` 且 `>= max(月初, 该习惯创建日)`；`scheduledDays === 0` 时界面显示占位符而**不是 "0%"** | ❌ **无一手对照** —— 六家都没写"进行中的这个月"怎么算（滴答习惯热力图只给名字、Loop 用 `TruncateField.MONTH` 全月截断）。这一条是**本线裁决**，引用时必须带着这个标记 | 低 —— 改回全月分母 = 每天自己往下掉的一个数；**不改**，但下一轮若拿到一手对照应当用一手覆盖它 |
| **A″ 为什么敢扣** | ① 未完成的本月剩余天数不是"做得不好"，用全月当分母得到的是一条**倒计时**不是完成率；② heyta 激励体系的红线「从不制造愧疚」（[`roadmap.md`](../plans/roadmap.md) §1.2）——一个必然从 100% 起步往下掉的百分比正好踩它 | 仓库既有裁决，非外部 | — |
| **D（= #4）量的读侧** | `unit` **只做显示、求和按纯数**；卡片"本月完成量 N {unit}"，`unit` 缺失时退化成不带单位的句子 | C1b-Q4 六款一手（Loop `unit` 自由文本 / 滴答干脆不做单位 / 没有任何一款把时长和页数画进同一张图） | 低 —— 若将来要封闭量纲词表，那是一次 schema 层的决定（AGENTS §3.3），**不在本单** |

🔴 **一条结构性约束跟着一起写下来**（它是 W8 判据的靶子，不是实现细节）：`HabitLog` 的 id 是 `habitId:date`，
且当天已有 log 时 `checkIn` 直接 `return false`（`packages/app-host/src/habit-actions.ts:155-157`、`:295-301`）
⇒ **一天只可能有一条 log**。所以"次"只能住在 `value` 里，把"次"实现成 **log 条数**会恒等于天数 —— 那是假判据。
任何下一轮写的"完成次数"判据都必须先问自己：它数的是 `value` 还是条数？

⚠️ **#4 只拍了读侧那一半**。推荐 D 里的"图 = 每日完成量柱 + 目标线"**没有落地**，
它需要 C1b-Q2 第 2 条那个 `todayRatio` 的渲染消费者（现量仍是零），属 W9/W10 那一档，别把这两行读成都做完了。


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
🔴 **那四行的终点是一份本仓推导文档**（`dida-view-unification.md` 全文 URL 命中 **0**，670 行，最后提交 `f5f823cf`）——
它转述的是我们早先的读法，**不是一手外部出处**，所以这一行原先靠"不需要拍"那档例外过门禁（工单 §8.88 第 3 节）。

外部一手核查（2026-10-04 20:2x，一手＝厂商自己的页面）：
`https://ticktick.com/home` 的 **Pomodoro** 段落原文是
"Adopt the popular "Pomodoro Technique"—break tasks into 25-minute intervals to stay focused and achieve a productive flow."
——**它只讲方法，不讲界面形状**；同页也没有指向任何 Focus 帮助中心的链接。
🟡 **未核实**：滴答（及其他同类）的番茄/专注面到底是不是列表模型，**厂商公开材料不披露**，
本轮两次尝试（官网首页 + 一条 App Store 链接，后者返回 404）都够不着这个事实。
⇒ 结论的承重换了位置：**"番茄面不是列表模型"这条不能由外部一手支撑，它由我方代码判据守着**
（下面那五条 `grep` 读数 + `check:layering`），而厂商侧的证据上限就是"官方页面把它写成计时器方法而不是清单功能"。
这也是本行标题保留"不需要拍"的理由：要拍的从来不是别人的形状，是我们自己的边界。

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

### C1b-Q13（= C1 #13，本轮新增的一格：用户**主动收起**那一栏时，格里的常驻内容跟着藏还是搬家）—— 2026-10-04 15:2x 第四批一手调研

题面不是"那一栏放什么"（那是 #1 剩余的半条），也不是"空区块显不显示"（那是 #8，同一格**内部**的规则）。
它问的是**收起这个动作的语义**：详情面里常驻着东西（本批 W7 的专注概览 / 已落 main 的 AI 面）之后，
用户点页头那个开关把它收起来 —— 那些东西应该**跟着不见**，还是**退回中间列**？

这题是工单 §8.54 在核对合并产物时照出来的：main 的 `detailHasRoom` 只在 mount 与 `resize` 重算，
而 HEAD 把"这一栏不出现"四档全部实现成 `display: none` ⇒ 合并后这一格的现状是**副作用**而不是意图。
两种答案各要改不同的东西，所以它必须拍，不能靠"看代码现在怎样"定。

**一手分布**（访问日期 **2026-10-04**，三条均为官方文档页；取回方式是文本抽取层，不是原始 HTML 存档 —— 引用时带这一句）：

| # | 出处 | 说了什么（逐字引本轮取回的句子） | 管到哪 |
|---|---|---|---|
| 1 | VS Code《Custom layout》`https://code.visualstudio.com/docs/editor/custom-layout`（页面自标 Last Updated **9/30/2026**） | 收起（toggle off）Secondary Side Bar 只是 **conceals its attached elements without detaching them or redirecting them elsewhere**，重新打开时**原地回来**；`VS Code will remember the layout of views and panels across your sessions`；要回默认位置用 `Reset Location` / `View: Reset View Locations` | **用户主动收起**这一档 |
| 2 | Android Developers《Canonical layouts》`https://developer.android.google.cn/develop/adaptive-apps/guides/canonical-layouts?hl=en`（页面自标 Last updated **2026-09-22 UTC**） | 尺寸不够那一档是**换可见性**不是挤：`Medium- and compact-width displays show either the list or the detail, depending on user interaction with the app.`；辅助内容的去处写的是 `place the supporting content below the main content or inside a bottom sheet`；尺寸变化要保状态：`A list-detail layout responds accordingly, preserving app state:` | **几何不可行**那一档（与本格是两件事） |
| 3 | Apple HIG《Sidebars》`https://developer.apple.com/design/human-interface-guidelines/sidebars`（正文经本节末那条 JSON 通道取到；HTML 页本身对 `WebFetch` 是 noscript 壳） | 收起是**为了腾地方/减干扰**、不是搬家事件：`People sometimes want to hide the sidebar to create more room for content details or to reduce distraction.`；尺寸变化时是**那一栏自己塌**、把空间让给主内容：`Consider automatically hiding and revealing a sidebar when its container window resizes. For example, reducing the size of a Mail viewer window can automatically collapse its sidebar, making more room for message content.`；可发现性是一条独立要求：`Avoid hiding the sidebar by default to ensure that it remains discoverable.`；紧凑档的替代物写的是 **tab bar**（`a more compact control such as a tab bar may provide a better navigation experience`），**没有**写"塞进 sheet / 搬进主列" | **用户主动收起** + 窗口 resize 两档 |

🔴 **三条合起来给的是"分两档"，而且在一件事实上没有分歧**：**用户主动收起 ⇒ 内容跟着藏、原地保留、不 redirect**（第 1、3 条各说一遍，第 3 条还把 resize 自动塌也归到"那一栏自己没、空间让给主内容"）。
"搬到别处"的说法只出现在**几何不够**那一档，而且 Android 给的去处是 `below the main content or inside a bottom sheet`（第 2 条），**不是"塞进旁边那一列"**。
⇒ 把前者套到后者上（"用户收起 ⇒ 内容退回中间列"）在这三条一手里**没有对应表述** —— 那正是本仓库 `base.css:96` 注释早就写下的纪律
（"这一条只管用户收没收，视口够不够是另一件事，两处的理由不同，不许合成一个布尔"），现在它有外部出处了。

⚠️ **本轮取到的边界，不许读多**：
① Apple 那一页**明确没有**规定"藏在侧栏里的控件/内容在收起之后必须怎样"（取回结果原话：no specific sentences describe the required behavior…），
   唯一相邻的一条就是上面那句 discoverability ⇒ **它管"栏本身别默认藏"，不管"栏里功能的入口去哪"**。这一格的补位要求仍是我们自己的产品判断。
② HIG 的 **Inspectors 专页仍未取到**（C2 第 9 条那六个 slug 还是 404 壳）⇒ 本节不引"HIG 对 inspector 的规定"这种话。
③ VS Code 那一页现在**只**文档化 Secondary Side Bar，旧名 Auxiliary Bar 未在该页出现 —— 重命名还是另有一页，本轮没查。
📌 **可迁移的取法（本轮把它跑活了）**：Apple 的 HIG / 营销页对 `WebFetch` 返 noscript 壳，正文要走
`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<slug>.json` —— 这条手法本来就记在**本节 C2 第 9 条**，
本轮第一次真用它取到正文（`sidebars.json`，2026-10-04）。⇒ 登记"取不到"之前先查仓内有没有已经写好的通道，我这次差点把一条已解的题当缺口登进去。

**推荐（带代价；⚠️ 推荐不是拍板）**：拍**「跟着藏」**这一支。三条理由：① 一手形状如此（上表第 1、3 行，两条互不相关的官方来源各说一遍）；
② 本仓库的**发现性条件已经成立** —— 页头那个开关在收起态仍然可见
（`narrow.css:134/156/198` 只在三档**几何**不可行时才连开关一起藏，W4 判据 `detail-pane-collapse.spec.ts` 的 T2/T3a-c/T4 钉着这件事），
而默认态是展开的（Apple 那句 "avoid hiding by default" 我们没违反）；③ "退回中间列"会把"收起"变成"搬家"，
而用户对"收起"的心智是"我不要在这里看见它"，不是"请把它放到别处"。

🔴 **代价两条，选这支也要认**：
(a) 那一格里如果住着**功能入口**（AI 助手就是），收起之后该功能在界面上**入口数为零** ——
VS Code 敢这么设计是因为每个 view 还能从命令面板/菜单到达。⇒ 这一支需要一条"功能不消失"的补位判据
（收起态给中间列或菜单留一个入口，或明文接受"这一档就是要没有"）。
(b) **现状不等于这支**：现在"跟着藏"是 `detailHasRoom` 没重算的副作用，镜像情形还更糟（载入时就是收起 ⇒ 展开后右栏是空的）。
⇒ 选这支**仍要改代码**：那个布尔要跟着 `data-detail` 一起重算，让"藏"变成可预测行为，
并补一条交叉判据（工单 §8.54 第 3 节点名了它缺谁：`detail-pane-collapse` 五条从不看 `ai-tool-run`）。
选另一支（退回中间列）改的是同一处，但期望值相反 —— 所以说**两种答案都要动那一行**，只是动的方向不同。

---

### C1b-Q14（= C1 #14，本轮新增的一格：点一行清单/标签算不算"选中"）—— 2026-10-04 21:5x 第五批一手

题面由工单 §8.95 的逐面现量照出来，又被 §8.96 更正过一次（初稿把"零个消费方传 `onSelect`"写成了事实，那是探针的产物）。更正后剩下的真问题：**同一个动作在两端是两件不同的事** ——

- web：点一行清单/标签 = **过滤任务列表**（`apps/web/src/features/projects/ProjectsPanel.tsx:248-249` 回传 `{kind: 'project', projectId}`，该文件头 `:16` 还写着规矩"点清单必须经由 `onSelect`，不能直接 `tasks.setFilter`"；🔴 这一句是 2026-10-04 21:5x 的快照，**那个名字已按下面第 2 步改成 `onFilterWith`**，规矩本身一字未动）；
- 移动端：**什么都不做**（`apps/mobile/src/screens/ListsSection.tsx:174` 把"不传"写成刻意决定）。

而目标第②条要的是"任务/习惯/便签/清单/标签/回收站各处同一套状态与回落规则"。所以这一格要拍的不是实现，是语义。

**一手分布**（访问日期 **2026-10-04**，四条均为厂商官方文档页；取回方式是**文本抽取层**，不是原始 HTML 存档 —— 引用时带这一句）：

| # | 出处 | 说了什么 | 管到哪 |
|---|---|---|---|
| 1 | 滴答《用清单管理任务》`https://help.dida365.com/articles/6950654234933067776`（本轮实测 HTTP 200） | 逐字："进入你想设置的清单详情页，点击右上角的「**…**」-「**背景**」即可设置你的清单背景。"；清单的增删改走"点击侧边栏底部「添加」-「清单」"与"在侧边栏左滑某个清单，会出现「置顶」、「编辑」和「删除」3个选项" | 只证到**清单自己的属性在"清单详情页/编辑页"**，不是右侧详情列。⚠️ 未核实：该站是移动端帮助镜像，桌面端三栏形态**没有图证**（C2 第 9、13 条同族） |
| 2 | 滴答《用标签管理任务》`https://help.dida365.com/articles/6950656299306582016` | 标签的全部管理动作是"在侧边栏左滑某个标签，会出现「置顶」「编辑」和「删除」3个选项"与"将任务拖动到已有标签上快速为任务添加标签"；**全文没有任何"标签详情"面** | 缺席证据只到"这几篇文档没写"，**不许**写成"滴答没有标签详情"（C2 第 12 条的同一口径） |
| 3 | Linear《Projects》`https://linear.app/docs/projects` | 本轮抽取层原话："Clicking a project opens its overview page, **not a sidebar panel**."，页面含 "a brief project summary, project properties, any associated documents and links, a detailed project description, and a list of project milestones."；Team 的选择走 details 页上的下拉 | 项目 = **整页 overview** ⇒ 容器**不进**详情列。⚠️ 未核实：本轮没有 Linear 账号，界面形状取自文档而非产品实测 |
| 4 | Todoist《自定义Todoist视图》`https://www.todoist.com/help/todoist/features/customize-views-in-todoist-AoHhBxFdZ` | "To switch layouts, open a project... Click Display."，布局为 List / Board / Day calendar / Week calendar / Month calendar | 打开项目改变的是**中间列的布局**。⚠️ 该页**没写**点项目时右栏发生什么 ⇒ 不能反推成"Todoist 右栏不放容器属性"（这是本页的射程边界，不是结论） |

**共同点（三家）**：没有一家把"选中一条容器"放进右侧详情列。容器属性要么是**整页**（Linear）、
要么是**它自己的详情/编辑页**（滴答），要么这个动作只改**中间列**（Todoist）。

**推荐（不是已生效的规则，要产品拍）**：

1. **不**给 `project` / `tag` 加 `SelectableKind` —— 保住"详情面 = 单个实体的属性面"这条口径，三家的共同形状支持它；
2. 把 web 那条 `onSelect` 在**命名上**与选中区分开（例如改叫 `onFilterWith`）：同一个字面形状在两处承载两种语义，
   未来的"正向覆盖名册"（工单 #33）会把 web 读成"已接选中"—— 那是会把判据读反的一种漂；
   ✅ **已按此落地**（2026-10-05 02:3x，工单 §8.122）；名册那一侧的 needle 同批改，否则它会红在"登记与代码矛盾"上。
3. 移动端那条"刻意不传"从**代码注释**升级成一条**登记的决定**（现在只有 `apps/mobile/src/screens/ListsSection.tsx:174` 一行注释在为它说话）；
4. 若将来真要做"清单自己的概览/统计"，形状是**整页或弹层**（与三家一致），不是详情列那一格。

拍板面三个合法答案（A 承认是过滤并把两端语义一致化 / B 容器也可选中、详情面显示容器属性 / C 点行=过滤、行尾图标=进清单详情）
逐条写在对账里：工单 `docs/plans/detail-pane-alignment.md` §8.96 第 3 节。

**#14 的拍板记录（2026-10-05 01:3x，本线拍：选 A，并按推荐 1–4 全部落地）**

产品决策权已交下来（用户 2026-10-03 原话），所以这一格由本线拍。**A 不是"维持现状"，是把两端各自的
理由写成同一条规则**，四件事都要做，缺一条 A 就只是把漂移合法化：

1. `project` / `tag` **不进** `SelectableKind` —— 三家的共同形状支持它（容器属性要么是整页 / 要么是自己的详情编辑页 /
   要么这个动作只改中间列），而"详情面 = 单个实体的属性面"这条口径一旦被容器破掉就再也收不回来。
2. 🔴 ~~**把 web 那根 `onSelect` 改名**（`onFilterWith`）—— 这一步是 A 的**承重**，不是修饰：
   同一个字面形状在两处承载两种语义，正向覆盖名册会把 web 读成"清单/标签已接选中"，
   也就是说**目标第②条会被一条根本没选中的边读成已完成**。改名之前那一格的"已核"是虚的。~~
   ✅ **已落地**（2026-10-05 02:3x，工单 §8.122）：六枚文件逐枚命中数、名册 needle 与 `because` 同批、
   残留 `onSelect` 的 13 枚文件逐处过语义并登记了各自的所有者。
3. 移动端那条"不传"从注释升级成登记的决定，并且**它现在就是对的**：
   `apps/mobile/src/screens/ListsSection.tsx:174` 的理由不是"没做"，是"没有去处就不做成可点 ——
   一个点了没反应的按钮比不可点更坏"。⚠️ 所以我上一轮把移动端读成"缺陷"那句是**读错了，撤回**：
   它把行做成不可点，正好避开了本仓反复踩的那类"看起来能点"的界面谎言。
4. 将来真要做"清单自己的概览/统计"，形状是**整页或弹层**（与三家一致），不是详情列那一格；
   那一次是把 `project` 从 `filters` 立场改到 `selects` 立场的**语义变更**，要重开这一格并改门禁名册。

🔴 **这条裁决与目标第②条那句"各处同一套"之间的张力必须写明，不许含糊**：目标逐项列了
"任务/习惯/便签/**清单/标签**/回收站/时间线"，按字面读像是在要求容器也进选中宇宙。
A 的答案是"**同一套"落在机制层**——宇宙是封闭的、每一面都登记过立场、回落与豁免规则只有一套，
而 `filters` 是这套机制里一个**已登记**的立场（门禁反向检查：登记成非选中的面此刻不许在读选中，
把它偷偷接上就会红）。代价写在上面第 2、4 条：**改名没做完之前，这一格不能声称已闭合**。
推翻 A 的代价：一旦给容器加选中，"详情面 = 单个实体的属性面"就没了，容器行与任务行要在同一列里
竞争那块位置（三家都绕开了这个形状），而且 6 面 `selects` 会涨到 8 面 —— 正向覆盖名册、回落规则、
移动端那行是否变成可点，全部要重判。



## C2. 未核实项（Part A）

1. ~~滴答右栏在无选中时放什么~~ ✅ **已结案**：任务视图 = 纯装饰插画；番茄专注视图 = 概览 + 记录 + 补录入口。⇒ 滴答自己**逐页不一致**，说明"放什么"是产品决定而非框架约束。其余 6 个视图（日历/四象限/时间线/便签/成长/回收站）的无选中态**仍未穷举**。
   补法：余下 6 个视图（日历 / 四象限 / 时间线 / 便签 / 成长 / 回收站）各截一张"无选中态"的右栏图，取法与 A3 那条一致；前置是一个有数据的滴答账号 ⇒ 要人。
2. ~~滴答详情面板的完整字段~~ ✅ **已取证**（A3）。🔴 但 [multi-end-unified-strategy.md §9 第 13 条:1524](../plans/multi-end-unified-strategy.md) 那句"取证未覆盖"**仍成立** —— 取到的是**字段清单**，不是**全部区块**：中间那片空白在"有子任务/有提醒/有附件"时长什么样、右下三个图标的语义，**未取证**。补法：在同一条带子任务与提醒的任务上看一次。
3. **⚡/ 的官方含义**：A6 的对应关系靠**同一屏两组数值**推出，滴答界面上始终没有文字标签 ⇒ 仍属推断，只是这次**可复核**。
   补法：全文载荷已在本机（97 篇 markdown 在页面的 `__NEXT_DATA__` 里），下一步是在那份载荷里检索"闪电 / 连续 / 专注时长"三个词的**定义句**而不只是摘要；若仍无文字标签，就把 A6 的对应关系降级成"仅按截图推断，不许写进判据"。
4. ~~**官方帮助中心细节**：`help.dida365.com` 是 SPA，`WebFetch` 只拿到片段（《专注数据统计》《习惯数据统计》《更好地完成习惯》三篇**未取到正文**）~~
   🔴 **本条在 2026-10-03 被推翻**（C1b-Q2 那一轮）：这三篇的**全文都取到了**。方法记下来复用 ——
   该站是 Next.js SPA，但**全部 97 篇文章的 markdown 正文内嵌在页面 `__NEXT_DATA__` 的 `props.pageProps.articles` 里**：
   `curl https://help.dida365.com/articles/<任一 id>` → 解 `<script id="__NEXT_DATA__">` → 读 `articles`。
   ⚠️ 也就是说，先前那句"SPA 取不到正文"是**只用了 WebFetch、没看页面自带的数据载荷**造成的假缺席（原文留档是为了让后来者认出这个形状）。
   取到的一手仍然包含：番茄/正计时两模式、默认 25 分钟可自定义、铃声/白噪音/屏幕常亮、记录含时长与任务、
   **移动端可补记、桌面端仅补记不可删**、支持预计番茄数或预计时长。⚠️ 该页是移动端帮助镜像，桌面端行为以截图为准。
   补法：桌面端那一档要一张桌面版同一功能面的截图（需登录 ⇒ 要人）；文档侧能做的已经做完 —— 换 `__NEXT_DATA__` 取全文这一条已把"SPA 取不到正文"证伪，方法就写在上面。
5. **`monthGrid` 能否直接长成"可点的月历打卡格"**：数学现成但今天只服务 `DatePicker`，"格子带打卡状态 + 可点 + 跨月灰显"三件事**无实现证据**。
   补法：这是纯本仓代码问题，不需要外部资料 —— 一次检索取 `monthGrid` 的定义处与全部调用点，列"格子带打卡状态 / 可点 / 跨月灰显"三件事各缺哪几个出参；差集为空就是能做，不空就把缺的字段登记成工单。
6. **移动端要不要同样三栏**：主战场是移动端 + macOS + Windows（[ADR-0036](../adr/0036-main-battlefield-and-rn-single-source-ui.md)），A7.3 只回答了"怎么回收"，没回答"移动端的概览放哪"。

第二批（2026-10-03，C1b 那些结论里**不能当依据**的部分，逐条列出）：
   不可补：这不是事实而是产品判断（"移动端的概览放哪"没有可核的外部真值，A1 那四家各自的做法已经取到了）⇒ 与拍板 #1 / #8 同一档，要人；补它的动作是写一份 ADR，不是再查一轮资料。

7. **Notion 的 side peek 有没有未选中态**：官方帮助正文是 JS 壳，`/help/side-peek`、`/help/preview-pages`、`/help/pages`、`/help/databases` 取回的只有页面壳，只拿到快捷键页里 "database peek view" 一句。⇒ C1b-Q1 表里"Notion = 选中才出现"是**推断**，不是一手结论。
   补法：两条可落地的路 —— ① 把 URL 从 JS 壳换成 Notion 帮助面向爬虫的静态页或站点地图里的正文端点（⚠️ 具体端点本轮未实测）；② 注册一个免费账号自己开一页看（需真人验证 ⇒ 要人）。
8. **Linear 第四栏在未选中时的形态**：changelog 只描述选中某个 issue 之后那栏里有什么。
   补法：在有 Workspace 邀请的账号里直接看那一栏的空态，或从 `linear.app` 的公开前端产物里找那段文案（⚠️ 后者本轮没试过）。两条都要渠道 ⇒ 半要人。
9. **现行 Apple HIG 里有没有 Inspectors 专页**：`inspectors` / `inspector` / `detail-views` / `placeholders` / `status-views` / `empty-states` 六个 slug 全部返回同一份 **15639 字节**的 404 壳 ⇒ 据此说"HIG 无此专页"，但**没有逐条翻完目录**，不能排除它改名或并入 iPadOS 专章。（⚠️ 可迁移的手法：Apple 营销页对 `WebFetch` 返回 noscript 壳，要取 `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<slug>.json`；**同一尺寸的 JSON = 同一份壳，不是内容**。）
   补法：不要再猜 slug —— 先取 HIG 的**目录数据**（正文那层 `tutorials/data/design/human-interface-guidelines/` 的结构已证实存在），把全部页面名列出来再判有没有 Inspectors 专页。⚠️ 目录端点的具体 URL 未实测。
10. **Microsoft 有没有一方通则区分 "empty state" 与 "no data"**：**未证实**。`learn.microsoft.com/windows/apps/design/**` 下搜不到 empty-states 页，最接近的两条是 `ListDetailsView` 的属性描述（API 级）与 Power BI 的 "Show items with no data"（图表级、语境不同）。⇒ 本文早先若把"Fluent 区分两者"当依据，那条依据**不存在**；IBM Carbon 的 "No data empty states" 是**另一个设计系统**。
   补法：走 `learn.microsoft.com` 的站内搜索接口（它有公开的 JSON 搜索端点）而不是在 `/design/**` 下面手翻；⚠️ 端点形状未实测，取到后要按"该中一条 / 不该中一条"两条腿各喂一次才认它的读数。
11. **m3.material.io 的 empty states / large screens 指引**：页面存在但是 Angular SPA，正文取不到 ⇒ Google 侧结论只来自 developer.android.com 的规范布局文档。
   补法：Material 的规范正文在 GitHub 上有 markdown 源，可以绕开 Angular SPA；先把仓库定位准（手法同 #14：用产品页里的开发者链接定域名，不猜）。⚠️ 具体仓库本轮未定位。
12. **Things 是否存在过 Inspector 面板**（老版本或设置里）：只证到"现行功能页 + 现行快捷键表里没有"，那是**缺席证据**而不是"从未有过"。
   不可补：老版本行为没有公开可取的档案（不提供旧安装包，更新日志只覆盖现行版本）⇒ 长期只能停在"缺席证据"，本条的正确用法是**禁止**把"Things 从来没有 Inspector"写成结论。
13. **各家未选中态到底有没有对用户显示过统计概览**：本轮**零界面截图**，全部是文档结论。要把它定死，判据应是四端各一张图（工单 §4 的固定动作本来就这么要求）。
   补法：判据形状就是工单 §4 那一条（四端各一张图 + 人真的看图），缺的只是各家产品的可用登录态 ⇒ 要人（Notion / Linear / Things 各需一个账号）。在此之前 C1b-Q1 那张表里 Notion 与 Linear 两格按推断读。
14. **Mochi**：官网未定位（`mochi.click/pricing`、`/pro` 均 404，根域是个 WordPress 博客页，`web.mochi.app` 404）⇒ 它的档位与"卡挂在哪"**没有任何一手证据**。
   补法：以 App Store 产品页里"开发者网站"那一栏为唯一权威入口（而不是猜 `mochi.click`），进去再取定价与卡片挂载面；那一栏是公开 HTML ⇒ 不需要新渠道。
15. **Mymind**：只扫了首页（`spaced`/`forgetting`/`flashcard`/`memor*`/`review` 命中 0）。⚠️ 那是**首页级缺席**，不是文档级缺席。学堂在线（xuetangX）本轮完全未查。
   补法：把首页之外的帮助中心与博客子域做一次全站检索（"只扫首页"是本轮自己写的取样范围，不是可达上限）；学堂在线 xuetangX 按 Part B 那批的同一走法补一轮。两家都是公开页 ⇒ 不需要新渠道。
16. **《广告法》第九条第三项原文**：只从市场监管总局《广告绝对化用语执法指南》第二条的**转述**拿到（该来源本身一手，但它是转述），gov.cn 公报链接 404、人大网/法规库未命中 ⇒ **法条原文与现行修正版条号未核**；且该指南自称"供各地…**参考适用**"（第一条），是执法指引不是法条。
   补法：法条原文走国家法律法规数据库的检索页，公报链接 404 不代表原文不可得；⚠️ 该站对脚本抓取是否可用未测，取不到时改用人大会公报 PDF，并把两种取法各自的失败读数留在这一条里。
17. **Duolingo 在应用商店里怎么写**：`blog.duolingo.com` 是 JS 渲染取不到正文、`how-duolingo-makes-learning-effective/` 404。本轮拿到的措辞来自 **PNAS 2019 论文摘要**（一手学术来源，[Tabibian et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6410796/)），不是商店文案 ⇒ "商业文案的水位"这条只由 Anki / RemNote / 滴答三家支撑。
   补法：不取它的营销博客（JS 渲染），直接取 App Store 产品页"关于此 App"那一段正文（服务端渲染的公开 HTML）⇒ 不需要新渠道。
18. 🔴 **艾宾浩斯的全部具体数字**（"20 分钟遗忘 42%""1 天后 66%"，以及中文圈通行的"5 分钟/30 分钟/12 小时/1 天/2 天/6 天/15 天/31 天"复习表）：**均未追溯到一手**（未取到 1885《Über das Gedächtnis》或 1913 英译全文，Gutenberg 探测取到的是另一本书）。⇒ 这些数字一旦进对外文案，撞的就是上面第 16 条引的那份指南**第七条**（"广告主无法证明其真实性的，依照《广告法》有关规定予以查处"）；同时 B2 小节那条"Murre & Dros 2015 复现了曲线、但 24h 处有上跳"的表述**仍然只能当内部依据**，不是可以印在商店页上的承诺。
   不可补：一手是 1885 德文原版或 1913 英译全文，Gutenberg 探测取到的是另一本书（本轮拿不到）；下一条可试的路是 Internet Archive 的全文检索。⚠️ 但无论补到与否，这些数字都不许进对外文案（撞 #16 那份指南的第七条，B2 已钉）。
19. **fsrs.js 仓库描述那句"overtakes Anki and catches up with SuperMemo"**：跑分出处未追（SuperMemo 方基准）⇒ **不得**作为 heyta 的文案依据。
   不可补：那句跑分的出处是 SuperMemo 一方的商业基准，不在公开可核渠道 ⇒ 长期不作依据。这一条登记即为终态，它的用法是"不许引用"，不是"待补"。
20. **Obsidian 官方同步定价 / AnkiMobile 具体售价 / OmniFocus 价格与 Pro 边界**：均未核（`apps.ankiweb.net` 不印价格）。⇒ C1b-Q11 的结论只到"没人把算法放进付费墙"，不到"他们各自卖多少钱"。

第三批（2026-10-03 19:27，C1b-Q2 那批习惯口径结论里**不能当依据**的部分）：
   补法：三家定价都在自家公开页（Obsidian 的定价页、AnkiMobile 看 App Store 页的价格、OmniFocus 官网定价），逐条取正文即可 ⇒ 不需要新渠道。本轮没做是因为 C1b-Q11 的结论用不到它（那条只问"算法有没有进付费墙"）。

21. 🔴 **滴答"月完成率"的分子/分母、以及"完成天数 vs 完成次数"的官方定义**：帮助中心**没有任何一篇给公式**
    （《习惯数据统计》只给「月度打卡表 / 打卡概览 / 年度热力图」这三个**名字**）。六卡读数仍来自**截图**。
    ⇒ C1b-Q2 里那条"完成率 = 达成天数 / 计划日数"是从**任务侧《成就值》的定义借推**到习惯侧的，**不是滴答习惯页的原文**。
    补法：在同一习惯上制造"一周 3 次、某日只完成 2/5"的输入，逐卡读数。
22. **滴答"一周完成 N 次"到底怎么换算成"打卡天数"**（排期日模型还是配额模型）—— 文档没写，C1b-Q2 的两种口径都吻合现有文字。
    ⇒ 推荐里"走排期日"这一条**没有被竞品直接证实**，它的依据是 heyta 自己的冻结/`isStillAlive` 按**计划日**计数这一内部事实。
   补法：与 #21 是同一次实测能一起关掉的两个问题（在同一习惯上造"一周 3 次、某日 2/5"的输入，逐卡读数）⇒ 前置也与 #21 相同：一个有数据的滴答账号，要人。
23. **Streaks 的日界线 / 部分完成 / 一天能否多次完成**：`crunchdevelopment.com` 全线 404，`streaks.app` 的 FAQ/help/features
    **全部返回同一页**，官方说帮助**只在 App 内**（"Streaks contains an in-app help system"）⇒ 只能证到
    "一天一次、上限 24 个任务、按日加连续"这一层。
   不可补：官方明确帮助只在 App 内（网页侧全线 404 或返回同一页），要拿到就得装 App、买断、有 iOS 设备 ⇒ 要人。在此之前 Streaks 那一格只引用已核到的"一天一次 / 上限 24 个任务 / 按日加连续"。
24. **Loop 的"完美日 / +2"那一档**：FAQ 出现 "If you perform a daily habit perfectly"，但 `StreakList` / `ScoreList` / `Entry` 里
    **没有找到 2.0 阈值的代码**，只核到 `percentageCompleted = min(1.0, rollingSum/numerator)`（`ScoreList.kt:133`）。
    ⇒ 旧文档里"完美日 = 2 倍"的说法**本轮未证实，不要写进判据**。
   补法：Loop 开源 ⇒ 在它仓库里检索阈值（`2.0`、`perfect`、`numerator` 附近的全部出现处），而不是只看 `ScoreList.kt:133` 那一行；⚠️ 仓库地址本轮未定位，走 #14 那条"用开发者链接定域名"的取法。
25. **Time4Play / Habitify / Fabulous / Notion 类追踪器**：本轮**一家都没拿到一手来源**（Time4Play 是 Loop 的 fork，口径应同 Loop，但未逐一核）。
   补法：Time4Play 是 Loop 的 fork ⇒ 离线 diff 两个仓库就能拿到口径；Habitify 与 Fabulous 闭源 ⇒ 只能帮助中心加商店页，两者都公开可读 ⇒ 这一条不需要新渠道（本轮没做是因为它不在 C1b-Q2 的推荐依赖链上）。
26. **Google Fit 的日目标字段**（`dailyStepGoalTotal` 等）：相关页面 404；本轮只核到**日桶边界**（"midnight of the current day"）
    与 Apple `HKActivitySummary` 的成对日级目标字段。
   补法：404 的那条是旧路径，用该站站内搜索换到新 URL 再取日目标字段表。⚠️ 别把本轮已核到的"日桶边界"当成本条的替代证据 —— 那是两件事。
27. **滴答的会员闸门**（习惯统计的历史长度、周/月视图是否付费）：《习惯数据统计》里只写"高级会员还能够直接查看你这一整个月的习惯打卡进度"，
    其余面未核 ⇒ 与 C1b-Q11"没人把算法放进付费墙"不冲突，但**滴答确实把一部分统计放进了会员**。
   补法：分两半 —— 文档级那半现在就能做（全文载荷在本机，把"高级会员"那句的上下文逐篇扫一遍，列出哪些统计在会员后面）；产品级那半（历史长度上限、周/月视图闸门）需会员账号 ⇒ 要人。
28. 🔴 **C1b-Q14 那四条一手的"界面形状"零图证**：本轮全部是文档抽取层，其中 Linear 与 Todoist 没有可用账号，滴答那两篇还是**移动端帮助镜像**（桌面端三栏形态未取）。⇒ "三家都不把容器放进右栏"这句是**文档级**结论，不是界面级。
    补法：与第 13 条是同一次实测能一起关掉的（各家一张"点一条项目/清单之后"的截图 + 人看图）；前置同样是这些产品的可用账号 ⇒ 要人。
29. 🔴 **腿 5 的裸名归属判定认的是「在册文件名」而不是「路径」**：它拿 `git ls-files` 的 2337 枚 basename 做集合，
    裸名命中即算自家。 ⇒ 若某条引用指的是上游/厂商仓库里**恰好与我们某个在册文件同名**的文件，它会被少算成外部锚。
    现量：本轮同趟逐名查过，`scoreTask.js` / `cron.js` / 那几枚 `.kt` 都不在册 ⇒ **今天零碰撞**，这一档尚未咬到过任何一条真引用。
    补法：出现碰撞时把那条引用改成**带路径的完整形态**（如 `research/upstream/<repo>/src/cron.js:154`）—— `OWN_PATH` 只认 `packages|apps|server|scripts|e2e|docs` 六个顶层前缀，
    带 `research/` 的完整路径必落回"第三方"那一侧，不需要改判据；判据两侧的牙由装置 N1（自家裸名不许冒充外部锚）与 N1b（在册查不到的裸名仍算外部锚）两臂钉住。
30. 🔴 **§C1b-Q8 那三行核回一手之后仍未关掉的两格**（2026-10-04 23:1x）：
    ① **Things 3 那句是营销级、不是规格级** —— "those fields are neatly tucked away in the corner until you need them"
    没有说那些字段在渲染树里到底在不在，所以"空即隐藏在 Things 里是一条界面事实"这句**仍未核**。
    ② **Todoist 右栏在"什么都没填"时的实际形状**只由厂商两句自述支撑（"attributes are compact but visible" + 那三条 `Click …` 指令），零图证。
    补法：①②与第 13 条、第 28 条是**同一次实测能一起关掉**的（各家一个可用登录态 + 一张空任务截图，判据形状就是工单 §4 那条），⇒ 要人。
    在此之前本节那两格只能按"厂商自述其意图"读，不许当界面证据用。
    结案取证：这一档关掉时把那张图的路径写回 §C1b-Q8 那两行；而"Things 4"这个错名的回潮检查是一条**语义**判据 ——
    `grep -rn 'Things 4' docs/` 的命中要逐条读，只允许出现在**历史记述或改名说明**里（本条第 ① 项、§C1b-Q1 那行的改名注、工单落地记录），
    它落进任何活主张（哪家产品叫什么、谁站哪边）即为回潮。不写死命中数，因为那数字随下一批记述变化。
31. 🔴 **完成率的分母要不要扣掉"本月还没到的日子"——外部无从可核**（2026-10-05 01:3x，本线拍成 A′ 那条裁决时登记）：
    第 21 条已经写了"帮助中心没有任何一篇给公式"，这一条不是它的重复：它问的是**进行中的当月**怎么算，
    而六家一手里**连这个问题都没出现**（滴答热力图只给名字；Loop 用 `TruncateField.MONTH` 整月截断，
    但它那格的语义是"区间标签"不是"完成率分母"）。
    不可补：不存在可核的外部真值 —— 竞品没做这个数、也没文档化它，再查一轮只是把同一个缺席换一批页码。
    ⇒ **正确用法有一条措辞约束**：界面上、文档里都不许把 A′ 写成"业界做法/竞品都这样"；
    它是 heyta 自己的口径，理由只有那两条（倒计时不是完成率；「从不制造愧疚」红线）。
    结案取证：若将来拿到一手（例如某家公开了月完成率算法的规格文档或源码），用那一手**覆盖** A′ 并把本条关掉，
    覆盖动作要同时改 C1b-Q2 那张拍板表的"一手依据"栏 —— 只改代码不改这张表，下一轮又会以为它仍是无依据的裁决。
32. 🔴 **C1b-Q7 那条"番茄面不是列表模型"的外部链终点是一份本仓推导文档**（任务 #30 的结案登记，2026-10-05 01:3x）：
    四处"规范侧"引文全在 `docs/research/dida-view-unification.md`（全文 `https://` 命中 **0**），
    它转述的是我们早先的读法，不是厂商出处。⇒ 这一行**从来就不该由腿 5（外部锚）判它成立**；
    工单 §8.88 第 3 节给它的是**有意豁免**，不是漏做，本条把那个豁免的**理由**补完：
    外部一手这一轮只取到一条（`https://ticktick.com/home` 的 Pomodoro 段原文"break tasks into 25-minute intervals…"，
    **只讲方法、不讲界面形状**，且同页没有指向 Focus 帮助中心的链接；另一条 App Store 链接 404）。
    不可补：厂商不公开自己那一面的内部模型，再查一轮只是把同一个缺席换一批页码
    ⇒ **结论的承重已经换了位置**：它由我方代码判据守着（C1b-Q7 那五条 `grep` 读数全为 0 + `check:layering`），
    厂商侧证据上限就是"官方页面把它写成计时器方法而不是清单功能"这一句。
    结案取证：若将来厂商材料真的写出番茄/专注面的列表结构（帮助文档、设计规格或公开前端产物），
    用那一手覆盖本节并把本条关掉；覆盖时要同时把上面那句"证据上限"改掉，
    否则下一轮会拿旧的缺席结论当当前状态念。


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
