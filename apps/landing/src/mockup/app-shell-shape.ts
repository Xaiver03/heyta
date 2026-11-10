/**
 * 应用外壳的**形状登记处**（纯数据，不 import React）
 * =====================================================
 *
 * 复现对象：`apps/web/src/App.tsx` 的 `PRIMARY_NAV` / `QUADRANT_NAV` / `VIEW_TABS`
 * 与 `apps/web/src/features/projects/ProjectsPanel.tsx` 的两块区块
 * （清单 / 标签标题 + 共享行列表 + 标题级 `+` 创建入口）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它
 *
 * `apps/landing/src/mockup/AppWindow.tsx` 是**手抄的外壳复刻**，而手抄会漂移。
 * `docs/research/showcase-fidelity-audit.md` §2 记录了一次**五项同时漂移**：
 *
 *   | 项 | 真应用 | 复刻（漂移前） |
 *   |---|---|---|
 *   | 主导航 | 收集箱 / 今天 / **已完成** | 只有前两项 |
 *   | 四象限计数 | 由 `bucketByQuadrant` **算出来** | 手写 3 / 5 / 2 / 1 |
 *   | 标签区 | 有（标题 + 行列表 + `+`） | **完全没有** |
 *   | 视图 tab | 默认 rail 7 个目的地 | 旧版 4 个 |
 *
 * 当时**没有任何门禁看得见**：`check:design` 管取值来源、`check:ui-language`
 * 管有没有硬编码文案、`check:widgets` 管小组件契约 —— 没有一条在问
 * "复刻画的是不是产品真有的 UI"。§6.2 把"最小门禁"写成了待办，本文件是它的落点。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 三层怎么咬合（每一层都会红）
 *
 *   1. **AppWindow 从本文件渲染** —— 外壳结构不再散落在 JSX 里。
 *   2. `apps/landing/tests/mockup-shell-shape.spec.tsx` 把本文件与
 *      `apps/web/src/App.tsx` / `ProjectsPanel.tsx` 的**源码文本**逐项对账
 *      （项数 + 词条 key）。web 改了而这里没跟 → 红。
 *   3. 同一个 spec 断言 AppWindow 渲染出的 DOM 与本文件一致 ——
 *      有人绕开登记处另写一份 → 红。
 *
 * ⚠️ **为什么放在 landing，而不是 `packages/design-system`**：
 * 这里登记的是**应用外壳结构**（导航项、视图 tab、面板区块），不是设计 token。
 * design-system 的入口在首屏值 +24.5 kB gzip（实测见 `TaskList.tsx` 文件头），
 * 而且它不该认识 `web.*` 这类词条 key。放在 mockup 旁边，
 * `AppWindow.tsx` 可以**零字节代价**从它渲染。
 *
 * ⚠️ **这里不放计数。** 真应用的 `QUADRANT_NAV` 元素本身没有 `count` 字段 ——
 * 计数是 `selectQuadrantCounts()` → `bucketByQuadrant()` 在渲染时算出来、
 * 单独作为 prop 传进 `NavButton` 的。复刻照同一形状：本文件只登记"有哪几格"，
 * 数值在 `showcase-data.ts` 里由同一份样例任务派生。
 */

import type { MessageKey } from '@heyta/i18n/provider';

/** 外壳里用到的图标 id。真实图标组件在 `AppWindow.tsx` 里映射（纯数据不 import React）。 */
export type ShellNavIconId =
  | 'inbox'
  | 'calendar-days'
  | 'calendar-range'
  | 'search'
  | 'sun'
  | 'check-circle'
  | 'circle-dot'
  | 'columns'
  | 'check'
  | 'chart-gantt'
  | 'trending-up'
  | 'sticky-note'
  | 'trash'
  | 'settings';

/** rail 视图 key。与 `apps/web/src/App.tsx` 的 `ViewKey` 一致。 */
export type ShellViewKey =
  | 'tasks'
  /* 日历：2026-09-29 与 web 壳一起加进 rail（滴答 rail 的「日历」那一格）。 */
  | 'calendar'
  /* 搜索：rail 上段最后一个（滴答的 IA 里它常驻）。 */
  | 'search'
  | 'quadrant'
  /* 看板：2026-11-10 进默认 rail（`SHELL_MODULES` 登记 + `defaultOn: true`）。 */
  | 'kanban'
  | 'habits'
  | 'focus'
  | 'timeline'
  | 'growth'
  | 'notes'
  | 'trash'
  | 'settings';

/** 复刻能画内容的那五个视图（其余只是外壳的一部分）。 */
export type MockView = 'tasks' | 'quadrant' | 'habits' | 'focus' | 'timeline';

/** 侧栏主导航的一项。对应 `App.tsx` 的 `PRIMARY_NAV`。 */
export interface ShellPrimaryNavItem {
  readonly labelKey: MessageKey;
  readonly icon: ShellNavIconId;
}

/** 侧栏四象限导航的一项。**刻意没有 count 字段**（见文件头）。 */
export interface ShellQuadrantNavItem {
  /** 象限 id，与 `@heyta/domain` 的 `Quadrant` 一一对应。 */
  readonly quadrant: 'q1' | 'q2' | 'q3' | 'q4';
  readonly labelKey: MessageKey;
  readonly swatch: 'q1' | 'q2' | 'q3' | 'q4';
}

/** rail 视图 tab 的一项。对应 `App.tsx` 的 `VIEW_TABS`。 */
export interface ShellViewTab {
  readonly key: ShellViewKey;
  readonly labelKey: MessageKey;
  readonly icon: ShellNavIconId;
}

/** 侧栏面板区块。对应 `ProjectsPanel.tsx` 的两个 `<section>`。 */
export interface ShellPanelSection {
  readonly id: 'projects' | 'tags';
  readonly headingKey: MessageKey;
  /** The accessible name of the heading-level create action. */
  readonly createLabelKey: MessageKey;
  readonly icon: ShellNavIconId;
  /** A small set of real sample rows shown in the static landing mockup. */
  readonly sampleNameKeys: readonly MessageKey[];
}

/**
 * 侧栏主导航：**4 项**。对应 `apps/web/src/features/shell/view-tabs.ts` 的 `PRIMARY_NAV` ——
 * 今天 / 明天 / 最近 7 天 / 已完成。
 *
 * 🔴 **这一段就是漂移史本身，读它就是读这个文件为什么存在。**
 * 「已完成」曾经漏掉，是 §2 #1 的漂移；「最近 7 天」是**同一种漂移的第二次**
 * （真应用 2026-10-01 加了它，登记处没跟上，于是 `pnpm -r test` 在
 * `mockup-shell-shape` 上红了整整一天）；「明天」是**第三次**
 * （真应用 2026-11-07 由 `69fa5352` 引入，同样没跟，同样红）。
 *
 * ⚠️ **条数不写死在这里也没用** —— 上一版这里写的是"3 项"，而判据读的是数组本身，
 * 所以那句散文漂了**没有任何门禁会红**。要改这一组，就同时改这一段的数字。
 *
 * 🔴 「收集箱」这一项在 2026-10-04 被**删掉**（不是这里漏画）：产品负责人
 * 「已经有一个收集箱的标题了，为什么还要个收集箱？在信息架构上面是重复的」。
 * 画一张"外壳形状"的图，就要跟着真外壳变 —— 这条对账判据（本文件 #1）
 * 的存在正是为了让它没法悄悄不跟。
 */
export const SHELL_PRIMARY_NAV: readonly ShellPrimaryNavItem[] = [
  { labelKey: 'web.shell.nav.today', icon: 'sun' },
  // 「明天」（R10，2026-11-07，`69fa5352`）。位置在「今天」与「最近 7 天」之间：
  // 真应用 `view-tabs.ts` 的 `PRIMARY_NAV` 就是这么排的（**按时间远近**）。
  // 它不是「最近 7 天」的快捷方式 —— 那个窗口含今天，这个只含明天那一天。
  { labelKey: 'web.shell.nav.tomorrow', icon: 'calendar-days' },
  { labelKey: 'web.shell.nav.next7Days', icon: 'calendar-range' },
  { labelKey: 'web.shell.nav.completed', icon: 'check-circle' },
];

/**
 * 四象限分区的**标题**。
 *
 * ⚠️ 用的是 `web.shell.nav.quadrantSection`，**不是** `web.shell.nav.quadrant`。
 * 两者中文逐字都是「四象限」，所以抄错不会有任何视觉差异 ——
 * 而这正是漂移最舒服的藏身处（复刻原来就抄的是后者）。
 */
export const SHELL_QUADRANT_SECTION_KEY: MessageKey = 'web.shell.nav.quadrantSection';

/** 侧栏四象限导航：**4 项**。对应 `App.tsx` 的 `QUADRANT_NAV`。 */
export const SHELL_QUADRANT_NAV: readonly ShellQuadrantNavItem[] = [
  { quadrant: 'q1', labelKey: 'web.shell.nav.q1', swatch: 'q1' },
  { quadrant: 'q2', labelKey: 'web.shell.nav.q2', swatch: 'q2' },
  { quadrant: 'q3', labelKey: 'web.shell.nav.q3', swatch: 'q3' },
  { quadrant: 'q4', labelKey: 'web.shell.nav.q4', swatch: 'q4' },
];

/**
 * Landing 复现的默认 rail 目的地：**6 项**。对应 `App.tsx` 的默认开启模块与常驻入口。
 *
 * 这份登记包含默认用户可达的任务、日历、四象限、习惯、时间线与搜索；
 * rail 会按 Web 的规则把其中低频目的地收进「更多」，而不是在主栏平铺全部项目。
 * 关闭的番茄钟、成长、便签等模块不进入默认登记，避免 Landing 承诺新装用户看不到的入口。
 *
 * 🔴 **2026-09-29：这里是「默认 rail」而不是"全部视图"。**
 * 产品负责人要求"左侧按钮尽可能地减少"，于是加了**功能模块开关**：
 * 关掉的模块**根本不进 DOM**，所以新装用户看到的就是下面这 7 个。
 * 画"全部 9 个"反而是另一个方向的不实 —— 承诺了默认拿不到的东西。
 * ⚠️ 对账判据（`tests/mockup-shell-shape.spec.tsx` #5）会读
 * `apps/web/src/features/shell/modules.ts` 的 `defaultOn` 一起算，别只改这一边。
 *
 * ⚠️ **2026-11-04（滴答对齐 D2）：回收站不在这份登记里了** —— 真应用把它从 rail
 * 下段搬进**侧栏底部**，展厅跟着搬，登记落在下面的 `SHELL_SIDEBAR_TOOLS`。
 *
 * ⚠️ **2026-11-10：「看板」进这一组了**（`kanban` 登记进 `SHELL_MODULES`，`defaultOn: true`）。
 * 在那之前它**卡在一个没人看得见的洞里**：`MODULE_VIEW_TABS` 里早就登记了它、
 * `App.tsx` 里也接了渲染分支，但 `enabledModules.has('kanban')` 恒 false ⇒
 * **用户永远打不开看板**。修法与取证见 `.ai-night-audit/2026-11-10/03-findings.md` F-01。
 */
export const SHELL_VIEW_TABS: readonly ShellViewTab[] = [
  // 上段「去哪看」：任务 + **默认开启的模块**。
  { key: 'tasks', labelKey: 'web.shell.nav.tasks', icon: 'inbox' },
  { key: 'calendar', labelKey: 'web.calendar.title', icon: 'calendar-days' },
  { key: 'quadrant', labelKey: 'web.shell.nav.quadrant', icon: 'circle-dot' },
  { key: 'kanban', labelKey: 'web.shell.nav.kanban', icon: 'columns' },
  { key: 'habits', labelKey: 'web.shell.views.habits', icon: 'check' },
  { key: 'timeline', labelKey: 'web.shell.views.timeline', icon: 'chart-gantt' },
  // 「搜索」在滴答的 rail 上段**最后一个**（它常驻，不给关）。
  { key: 'search', labelKey: 'web.search.title', icon: 'search' },
  //
  // ⚠️ **没有 `settings`** —— 2026-09-29 按滴答的 IA，设置收进了**顶部的头像菜单**
  //（rail 是每天点几十次的地方，设置是低频的）。展厅画的既然是"新装用户看到的
  // 那一屏"，就不该把它画成一个 rail 按钮。
];

/**
 * 侧栏底部那一组（真源的 `SIDEBAR_TOOL_TABS`）：**只有回收站**。
 *
 * 🔴 2026-11-04 起它不住 rail 而住侧栏，展厅跟着搬 —— 判据在
 * `tests/mockup-shell-shape.spec.tsx` 的 #5：那份对账把这一组**单独**与
 * `view-tabs.ts` 的 `SIDEBAR_TOOL_TABS` 比，不再算进 rail。
 */
export const SHELL_SIDEBAR_TOOLS: readonly ShellViewTab[] = [
  { key: 'trash', labelKey: 'web.trash.nav', icon: 'trash' },
];

/**
 * 展厅额外开放的预览入口。专注在产品里是可选模块，因而不进入默认 rail；
 * 展厅把它作为已有 `MockView` 的可探索内容放进「更多」，仍复用产品词条与图标形状。
 */
export const MOCKUP_PREVIEW_TABS: readonly ShellViewTab[] = [
  ...SHELL_VIEW_TABS,
  { key: 'focus', labelKey: 'web.shell.views.focus', icon: 'circle-dot' },
];

/**
 * 侧栏面板区块：**2 块**（清单 + 标签）。对应 `ProjectsPanel.tsx`。
 *
 * 🔴 「标签」整块曾经**完全没有**（§2 #4）。它与清单是并排的两块同形区块，
 * 少一块从截图上不一定看得出来 —— 除非你本来就知道产品里有标签。
 */
export const SHELL_PANEL_SECTIONS: readonly ShellPanelSection[] = [
  {
    id: 'projects',
    headingKey: 'web.projects.heading',
    createLabelKey: 'web.projects.addNew',
    icon: 'inbox',
    sampleNameKeys: [
      'landing.mock.project.work',
      'landing.mock.project.personal',
      'landing.mock.project.reading',
    ],
  },
  {
    id: 'tags',
    headingKey: 'web.tags.heading',
    createLabelKey: 'web.tags.addNew',
    icon: 'inbox',
    sampleNameKeys: [
      'landing.mock.tag.deepWork',
      'landing.mock.tag.waiting',
    ],
  },
];

/**
 * 页头右侧那一排**今天真的有的**控件。
 *
 * 🔴 这份登记不是"复刻想画什么"，是"产品现在有什么"。它由
 * `tests/mockup-shell-shape.spec.tsx` 与 `apps/web/src/App.tsx` 里
 * `.ht-header__actions` 那一段（**去掉注释之后**的 `data-testid` 全集）逐项对账，
 * 两边多一件少一件都红。
 *
 * 为什么需要这一条：这一排原来是**手抄在渲染文件里的**，于是复刻比产品多画了四枚
 * 早已搬走的控件（见下面 `SHELL_HEADER_MOVED_OUT`），而 26 条展厅测试**全绿** ——
 * 那条绿色的判据 positively 要求"页头要有同步 + 立即同步 + 设置 + 语言 + 主题"。
 * 一条把过时的形状钉成期望的判据，比没有判据更糟（AGENTS §8 第 3 条）。
 */
export type ShellHeaderActionKind =
  | 'bulk-toolbar'
  /** 页头那枚 `⋯`（2026-11-02）。排序、选择任务、共享都收在它里面。 */
  | 'overflow-menu'
  | 'detail-toggle'
  | 'assistant-toggle'
  | 'share-open';

export type ShellHeaderAction = {
  readonly id: 'bulk-toolbar' | 'task-menu' | 'detail-pane-toggle' | 'assistant-open' | 'share-open-button';
  readonly kind: ShellHeaderActionKind;
  /** 图上读到的名字（产品用它当可访问名 / 可见标签）。 */
  readonly labelKey: MessageKey;
  /** 真应用这一段里必须出现的 `data-testid`。 */
  readonly anchors: readonly string[];
  /** 只有某个视图才画 —— 与产品的条件一致，不是复刻自己的偏好。 */
  readonly onlyForView?: MockView;
  /**
   * 真实应用只在详情列收起时显示这枚回退入口。Landing 默认展示任务详情列，
   * 因此不额外画一枚没有行为的 AI 按钮，避免把静态展厅误读成可用 Chatbot。
   */
  readonly mockedInLanding?: boolean;
};

export const SHELL_HEADER_ACTIONS: readonly ShellHeaderAction[] = [
  {
    id: 'bulk-toolbar',
    kind: 'bulk-toolbar',
    labelKey: 'web.shell.bulk.select',
    /**
     * `history-notice`（R19 ⌘Z 撤销栈，`5bc42d31`）住在这一段里，紧挨 `bulk-undo`。
     *
     * 它**不是**批量模式的一部分：批量栏只在模式态渲染，而 `history-notice` 是
     * 全局的撤销回执（"⌘Z 没做成"那一句、4 秒自己消失、只有失败才出现）。
     * 两者只是**在页头同一段 DOM 里相邻**，而登记处记的正是"这一段里有哪些锚点"。
     * ⚠️ 因此 `mockedInLanding: false` 只盖住批量栏本身 —— 见本项的 `kind`，
     * 展厅画的是"选择任务"那条，回执是瞬态，静态图上没有它的位置。
     */
    anchors: ['bulk-toolbar', 'bulk-complete', 'bulk-repeat-warning', 'bulk-undo', 'history-notice', 'bulk-delete', 'bulk-exit', 'task-select-open'],
    onlyForView: 'tasks',
    /**
     * 🔴 不在展厅画：它是**模式**，不是默认态控件。
     * 2026-11-02 之前它常驻在页头，展厅也照着画了一条"选择任务" ——
     * 那正好把"页头上永远有一枚选择按钮"画成了产品该有的样子。
     */
    mockedInLanding: false,
  },
  {
    /**
     * 页头那枚 `⋯`（2026-11-02）。
     *
     * 🔴 它登记的不只是一个按钮，是**页头形状的规则**：产品页头右侧 =
     * 「图标按钮 + ⋯」。排序原来那一枚 `12px 标签 + 原生 select` 已经收进它里面，
     * 所以这里不再登记 `task-sort` —— 反过来，`SHELL_HEADER_MOVED_OUT` 里有一条
     * 专门钉"它不许再以常驻控件的形状回到页头"。
     */
    id: 'task-menu',
    kind: 'overflow-menu',
    labelKey: 'web.shell.overflow.label',
    // `manage-tags-open`（R8 标签管理，B 包 `e69f08f5`）住在 `⋯` 里 —— 与排序、
    // 「选择任务」同居一个"视图设置"面。它**不是**页头的独立控件，所以归这一项。
    anchors: ['task-menu-open', 'task-menu', 'manage-tags-open'],
    // 产品那边是 `view === 'tasks'`（**不是** `visible.length > 0`）—— 空列表里 `⋯` 也在。
    onlyForView: 'tasks',
  },
  {
    id: 'assistant-open',
    kind: 'assistant-toggle',
    labelKey: 'web.ai.assistant.title',
    anchors: ['assistant-open'],
    onlyForView: 'tasks',
    mockedInLanding: false,
  },
  {
    id: 'share-open-button',
    kind: 'share-open',
    /**
     * 共享入口（ADR-0062 W4）。它 2026-11-02 从页头搬进了 `⋯`。
     *
     * ⚠️ 登记的**可访问名**是"共享此清单"那一枚而不是 `web.share.open.label`（「共享」）：
     * 产品在菜单里用的是**随状态翻转**的两句（`web.share.open.new` / `web.share.open.manage`），
     * 那个短标签只出现在 `aria-label` 的位置上、且装饰性更强。登记一口能给读屏用的名字。
     */
    labelKey: 'web.share.open.new',
    anchors: ['share-open-button'],
    // 产品那边条件是 `currentProject !== undefined && syncConfigured` —— 只在选中自己的
    // 清单且同步已配置时出现。静态展厅没有"选中的清单"这一态，也不该画一枚点了没行为的
    // 共享按钮（同 `assistant-open` 那枚的理由），故登记锚点但不在图上画。
    mockedInLanding: false,
  },
  {
    id: 'detail-pane-toggle',
    kind: 'detail-toggle',
    // 图上画的是"展开"那一态：复刻是静态图，详情列在图里没有画出来，
    // 所以按钮的自带名说的是"点下去会怎样"（与产品同一条语义）。
    labelKey: 'web.shell.detailPane.expand',
    /**
     * 🔴 **只有一枚**：`detail-pane-toggle`（R14 · B5，2026-11-06，`829272f8`）。
     *
     * 这里曾经还登记着 `detail-pane-open`（`⋯` 里那枚"展开详情栏"）。**它已被删除** ——
     * 那一格是真缺陷：收起态下页头那枚与 `⋯` 里那枚**同时在场**，点哪个都展开，
     * 而没有任何门禁会红。裁决留页头这枚（它是开关，`aria-pressed` + 名字随状态翻转，
     * 两态都可达；只有"展开"的那枚删掉页头那枚会让「收起」不可达）。
     *
     * ⚠️ 上面这段曾经的注释写的是"详情列收起之后展开它的入口在 `⋯` 里" ——
     * **那是 2026-11-06 之前的事实**，改完没跟，于是注释替一个不存在的实现做了担保。
     * 这正是本文件存在的理由：登记的锚点会漂，写在注释里的事实同样会漂，
     * 而只有**锚点集合**（下面这行）有判据在守。
     */
    anchors: ['detail-pane-toggle'],
  },
];

/**
 * 曾经住在页头、如今**搬走了**的 affordance。
 *
 * 🔴 这份清单是给反向判据用的：复刻里不许再出现它们，而它们在产品页头那一段里
 * 也已经不存在（对账 spec 两头都查）。每一件都写清搬到哪、哪天搬的 ——
 * 否则下一个人会把它当"复刻漏画了"补回来，那正是这批漂移的成因。
 */
export const SHELL_HEADER_MOVED_OUT: readonly {
  readonly what: string;
  readonly nowIn: string;
  readonly since: string;
  /** 产品页头那一段里**不许再出现**的源码片段（组件名 / testid / 词条）。 */
  readonly absentInWeb: readonly string[];
  /** 复刻页头里**不许再出现**的文案（从词条表取，不抄字符串）。 */
  readonly absentInMock: readonly MessageKey[];
}[] = [
  {
    what: '同步状态 + 立即同步 + 同步设置齿轮',
    nowIn: 'rail 底部那一组（`sync-rail`）',
    since: '2026-10-06（工单 H9 第 1 / 3 刀）',
    absentInWeb: ['SyncBar', 'web.sync.a11y.syncNow', 'sync-settings-entry'],
    absentInMock: [
      'web.sync.a11y.syncNow',
      'web.sync.settings.title',
      'web.sync.status.synced',
    ],
  },
  {
    what: '语言切换',
    nowIn: '设置 → 显示',
    since: '2026-10-06（H9 第 2 刀）',
    absentInWeb: ['LanguageSwitcher'],
    // 切换器画的是**每种语言自己的名字**，`common.lang.en` 就是它当年的标签之一。
    absentInMock: ['common.lang.en'],
  },
  {
    what: '主题开关',
    nowIn: '设置 → 显示',
    since: '2026-10-06（H9 第 2 刀）',
    absentInWeb: ['ThemeToggle', 'theme-switch'],
    // 主题按钮原来**没有可访问名**（一枚裸图标），所以反向判据只能从产品侧的源码取；
    // 复刻这一侧靠"页头子元素数量 = 登记处"那一条兜住（少一件就得多一件才看得见他）。
    absentInMock: [],
  },
  {
    what: '「日期 / 倒计时」呈现方式',
    nowIn: '设置 → 显示（带说明的 radiogroup，`due-display-pref`）',
    since: '2026-09-30',
    absentInWeb: ['due-display-pref', 'web.shell.dueMode.aria'],
    absentInMock: ['web.shell.dueMode.date', 'web.shell.dueMode.countdown'],
  },
  {
    /**
     * 🔴 这一条是 2026-11-02 那一轮的核心，也是**最容易被人"补回来"的一条**。
     *
     * 排序原来是页头上一枚常驻控件（`12px 文字标签 + 44px 原生 select`），
     * 现在收进 `⋯` 里的单选组（`task-sort-<key>`）。
     * 下一个人看见"页头上没有排序"，最自然的动作就是把它加回去 —— 那正好把
     * 「一个功能一个控件」的加法恢复出厂设置。所以这里正着钉"不许回来"。
     */
    what: '排序（常驻的 `task-sort` 标签 + `task-sort-select` 原生下拉）',
    nowIn: '页头 `⋯` 菜单里的单选组（`task-sort-<key>`，`role="menuitemradio"`）',
    since: '2026-11-02',
    absentInWeb: ['task-sort-select', 'data-testid="task-sort"'],
    // 复刻那一侧当年画的是"排序方式 + 默认（按截止时间）"两段文字。
    absentInMock: ['web.shell.sort.aria', 'web.shell.sort.display'],
  },
  {
    what: '「选择任务」这枚常驻按钮',
    nowIn: '页头 `⋯` 菜单里的 `task-select-open`（进入批量模式后才出现批量栏）',
    since: '2026-11-02',
    // 那枚按钮的代码形状：一枚 `aria-pressed` 跟着选择态翻转的 ghost 按钮。
    // 只钉形状不钉文案 —— 文案（'选择任务'）现在同时是菜单项与批量栏的可访问名。
    absentInWeb: ['aria-pressed={bulkSelecting}'],
    absentInMock: [],
  },
];
