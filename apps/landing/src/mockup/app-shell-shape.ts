/**
 * 应用外壳的**形状登记处**（纯数据，不 import React）
 * =====================================================
 *
 * 复现对象：`apps/web/src/App.tsx` 的 `PRIMARY_NAV` / `QUADRANT_NAV` / `VIEW_TABS`
 * 与 `apps/web/src/features/projects/ProjectsPanel.tsx` 的两块区块
 * （清单「新清单」输入框 + `+`，标签「新标签」输入框 + `+`）。
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
 *   | 标签区 | 有（标题 + 输入框 + `+`） | **完全没有** |
 *   | 视图 tab | **8 个** | 4 个 |
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
  | 'search'
  | 'sun'
  | 'check-circle'
  | 'circle-dot'
  | 'check'
  | 'chart-gantt'
  | 'trending-up'
  | 'sticky-note'
  | 'trash'
  | 'settings';

/** 顶栏视图 key。与 `apps/web/src/App.tsx` 的 `ViewKey` 一致。 */
export type ShellViewKey =
  | 'tasks'
  /* 日历：2026-09-29 与 web 壳一起加进 rail（滴答 rail 的「日历」那一格）。 */
  | 'calendar'
  /* 搜索：rail 上段最后一个（滴答的 IA 里它常驻）。 */
  | 'search'
  | 'quadrant'
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

/** 顶栏视图 tab 的一项。对应 `App.tsx` 的 `VIEW_TABS`。 */
export interface ShellViewTab {
  readonly key: ShellViewKey;
  readonly labelKey: MessageKey;
  readonly icon: ShellNavIconId;
}

/** 侧栏面板区块。对应 `ProjectsPanel.tsx` 的两个 `<section>`。 */
export interface ShellPanelSection {
  readonly id: 'projects' | 'tags';
  readonly headingKey: MessageKey;
  readonly newPlaceholderKey: MessageKey;
  readonly icon: ShellNavIconId;
}

/**
 * 侧栏主导航：**3 项**。`App.tsx` 的 `PRIMARY_NAV` ——
 * 收集箱 / 今天 / 已完成。「已完成」曾经漏掉，是 §2 #1 的漂移。
 */
export const SHELL_PRIMARY_NAV: readonly ShellPrimaryNavItem[] = [
  { labelKey: 'web.shell.nav.inbox', icon: 'inbox' },
  { labelKey: 'web.shell.nav.today', icon: 'sun' },
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
 * 顶栏视图 tab：**9 项**。对应 `App.tsx` 的 `VIEW_TABS`。
 *
 * 🔴 后 5 项（时间线 / 成长 / 便签 / 回收站 / 设置）在这一屏里没有对应内容 ——
 * 它们只是外壳的一部分（复刻刻意不可交互，见 `AppWindow.tsx` 文件头）。
 * 但它们**必须画出来**：复刻只画 4 个 tab 时，访客在页面上看到干净的 4 个标签，
 * 装上应用拿到的是别的一堆 —— 一个比真应用好看的界面图就是一句会兑现不了的承诺。
 *
 * 🔴 **2026-09-29：这里是「默认 rail」而不是"全部视图"。**
 * 产品负责人要求"左侧按钮尽可能地减少"，于是加了**功能模块开关**：
 * 关掉的模块**根本不进 DOM**，所以新装用户看到的就是下面这 6 个。
 * 画"全部 9 个"反而是另一个方向的不实 —— 承诺了默认拿不到的东西。
 * ⚠️ 对账判据（`tests/mockup-shell-shape.spec.tsx` #5）会读
 * `apps/web/src/features/shell/modules.ts` 的 `defaultOn` 一起算，别只改这一边。
 */
export const SHELL_VIEW_TABS: readonly ShellViewTab[] = [
  // 上段「去哪看」：任务 + **默认开启的模块**。
  { key: 'tasks', labelKey: 'web.shell.nav.tasks', icon: 'inbox' },
  { key: 'calendar', labelKey: 'web.calendar.title', icon: 'calendar-days' },
  { key: 'quadrant', labelKey: 'web.shell.nav.quadrant', icon: 'circle-dot' },
  { key: 'habits', labelKey: 'web.shell.views.habits', icon: 'check' },
  { key: 'timeline', labelKey: 'web.shell.views.timeline', icon: 'chart-gantt' },
  // 「搜索」在滴答的 rail 上段**最后一个**（它常驻，不给关）。
  { key: 'search', labelKey: 'web.search.title', icon: 'search' },
  // 下段「工具」：贴底。
  //
  // ⚠️ **没有 `settings`** —— 2026-09-29 按滴答的 IA，设置收进了**顶部的头像菜单**
  //（rail 是每天点几十次的地方，设置是低频的）。展厅画的既然是"新装用户看到的
  // 那一屏"，就不该把它画成一个 rail 按钮。
  { key: 'trash', labelKey: 'web.trash.nav', icon: 'trash' },
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
    newPlaceholderKey: 'web.projects.newPlaceholder',
    icon: 'inbox',
  },
  {
    id: 'tags',
    headingKey: 'web.tags.heading',
    newPlaceholderKey: 'web.tags.newPlaceholder',
    icon: 'inbox',
  },
];

/** 顶栏右侧「日期 / 倒计时」这组开关。对应 `App.tsx` 的 `dueMode` 组。 */
export const SHELL_DUE_MODE_TABS: readonly { readonly labelKey: MessageKey }[] = [
  { labelKey: 'web.shell.dueMode.date' },
  { labelKey: 'web.shell.dueMode.countdown' },
];
