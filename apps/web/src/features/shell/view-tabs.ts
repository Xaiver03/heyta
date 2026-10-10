/**
 * 外壳的导航 / 视图登记 —— **唯一一份**定义（从 `App.tsx` 抽出，逐字搬移）。
 *
 * 🔴 落点须知：`apps/landing/tests/mockup-shell-shape.spec.tsx` 对账的是
 * **这份文件的源码文本**（读 `ALWAYS_ON_VIEW_TABS` 等声明块）——
 * 改这些数组时那份门禁会跟着对账；把声明挪走 = 判据锚点失效，它会红。
 */

import type { SyntheticEvent } from 'react';
import {
  CalendarDays,
  CalendarRange,
  ChartGantt,
  Check,
  CheckCircle2,
  CircleDot,
  Inbox,
  Hourglass,
  Move,
  Search,
  Settings,
  StickyNote,
  Sun,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { Quadrant, type TaskSortKey } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';
import type { TaskFilter } from '../tasks/store.js';
import type { RailPreference } from './rail-pref.js';

export interface NavEntry {
  filter: TaskFilter;
  /**
   * 文案**键**，不是文案本身。
   *
   * 🔴 模块级常量里不能有句子：`t` 是渲染期的（跟随语言变化）。
   * 所以这里存 key，渲染时才 `t(entry.labelKey)` —— 语言一换，
   * 这些标签自动跟着换，不需要重建数组。
   */
  labelKey: MessageKey;
  icon: LucideIcon;
  /** 象限色块的 CSS 类；非象限项为 undefined。 */
  swatch?: string;
}

export const QUADRANT_NAV: NavEntry[] = [
  {
    filter: { kind: 'quadrant', quadrant: Quadrant.UrgentImportant },
    labelKey: 'web.shell.nav.q1',
    icon: CircleDot,
    swatch: 'ht-swatch--q1',
  },
  {
    filter: { kind: 'quadrant', quadrant: Quadrant.ImportantNotUrgent },
    labelKey: 'web.shell.nav.q2',
    icon: CircleDot,
    swatch: 'ht-swatch--q2',
  },
  {
    filter: { kind: 'quadrant', quadrant: Quadrant.UrgentNotImportant },
    labelKey: 'web.shell.nav.q3',
    icon: CircleDot,
    swatch: 'ht-swatch--q3',
  },
  {
    filter: { kind: 'quadrant', quadrant: Quadrant.Neither },
    labelKey: 'web.shell.nav.q4',
    icon: CircleDot,
    swatch: 'ht-swatch--q4',
  },
];

/**
 * 第二列顶部的「智能清单」组。
 *
 * 🔴 **这里没有「收集箱」那一行**（2026-10-04 产品负责人：「已经有一个收集箱的
 * 标题了，为什么还要个收集箱？在信息架构上面是重复的」）。中间那一列的页头
 * 本来就按当前筛选显示「收集箱」，侧栏再放一行同名入口等于让同一个目的地
 * 有两个名字相近、高亮状态还各自独立的控件。
 * ⇒ `{ kind: 'all' }` 的入口搬到 **rail 的「任务」**：点它 = 进任务视图并把筛选
 * 重置到收集箱（见 `App.tsx` 视图 tab 的 `onClick`）。这条不是"顺手加的补丁"，
 * 而是删掉那一行之后**唯一**能回到收集箱的路径，所以它必须有判据（`tests/
 * app-mount.spec.tsx`）。
 */
export const PRIMARY_NAV: NavEntry[] = [
  { filter: { kind: 'today' }, labelKey: 'web.shell.nav.today', icon: Sun },
  /**
   * 「最近 7 天」—— 滴答那三个智能清单里的中间一个（收集箱 / 今天 / 最近 7 天）。
   *
   * 🔴 这一行只是**入口**：窗口的定义（含今天的七个日历日、不含逾期、
   * 不含无截止、不含已完成）全在领域层的 `filterTasks({kind:'next7Days'})`，
   * 天数常数 `NEXT_SEVEN_DAYS` 也在那里。这里**不许**再算一遍日期，
   * 也不许把 7 写成字面量 —— 侧栏标签上的数与该常数的同源关系钉在
   * `tests/task-groups.spec.tsx`。
   *
   * 这一组只剩「今天」与「最近 7 天」两条都属"按日期看的未完成"；
   * 看全部（收集箱）走 rail 的「任务」，理由见上面 `PRIMARY_NAV` 的文件头。
   */
  { filter: { kind: 'next7Days' }, labelKey: 'web.shell.nav.next7Days', icon: CalendarRange },
  /**
   * 「已完成」。
   *
   * 🔴 这个入口**曾经不存在**，而它缺的只是这一行 —— `TaskFilter` 里早有
   * `{ kind: 'completed' }` 分支（`features/tasks/store.ts`）、
   * `selectVisibleTasks` 早会筛它、标题逻辑早有 `f.kind === 'completed'`、
   * 空态文案 `web.shell.empty.completed.*` 也早就在两种语言里。
   * **零件全在，就是没有按钮能把 filter 切过去**，于是 Web 上已完成的任务
   * 永远看不见。这是"最后一米"的典型形状（见
   * `docs/research/dida365-feature-benchmark.md` §3）。
   *
   * 放在「今天」之后：收集箱 / 今天 / 已完成 是同一类"智能清单"，
   * 前两个看未完成、第三个看已完成，语义上是一组。
   */
  { filter: { kind: 'completed' }, labelKey: 'web.shell.nav.completed', icon: CheckCircle2 },
];

/**
 * 顶层视图。
 *
 * 为什么不用路由库：P1 只有四个平级视图、没有深链接需求、
 * 没有嵌套布局。引入 router 的收益（URL 可分享）在本地优先的单端
 * 场景下几乎不存在，而成本是又一个需要维护的依赖。
 * 到 P2 需要深链接时再引入 —— 那时才知道真实的约束是什么。
 */
export type ViewKey =
  | 'tasks'
  | 'search'
  | 'calendar'
  | 'quadrant'
  | 'habits'
  | 'focus'
  | 'timeline'
  | 'growth'
  | 'notes'
  | 'countdown'
  | 'trash'
  | 'settings';

/**
 * 视图切换列表。
 *
 * 🔴 提出来当**唯一一份**定义：它既是顶栏的按钮，也是页面标题的来源。
 * 原来这张表内联在 JSX 里，而标题另有一条只从 `store.filter`（任务是域的概念）
 * 推导的逻辑 —— 于是在习惯 / 番茄钟 / 成长 / 设置 这些页面上，顶部标题写着
 * 「收集箱」：那是**上一个视图的残留**，会让人以为没切过去。
 * 同一件事写两遍，漂移是注定的。
 */
export interface ViewTab {
  readonly key: ViewKey;
  readonly labelKey: MessageKey;
  readonly Icon: LucideIcon;
}

/**
 * 视图切换 —— **分组，且挪进侧栏**（2026-09-29，落实 `dida-view-unification.md` §4.4）。
 *
 * ## 🔴 它修的是什么（实测数字，不是感觉）
 *
 * 原来这 9 个 tab **平铺在顶栏一行**，而 `showcase-fidelity-audit.md` §6.3 实测：
 *
 * ```
 * 1280px   完全可见 5/8   被藏起来的是：成长 / 回收站 / 设置
 * 1440px   完全可见 7/8   被藏起来的是：设置
 * 1680px   完全可见 8/8
 * ```
 *
 * 那是 8 个视图时的数字；现在有 9 个，**更挤**。
 *
 * ## 🔴 现行裁决（唯一一代，2026-10-06 收敛）：上段「4 + 1（更多）」
 *
 * > **历史注记**：2026-09-29 那一代裁决曾写过"**而不是**把低频的藏进「更多」菜单
 * > （藏起来是为顶栏宽度付的代价，侧栏没这个约束，藏就只剩成本）"。它被
 * > 2026-09-29 当天稍晚的同一位产品负责人那句「左边的侧边栏那个按钮应该尽可能地
 * > 减少」推翻：竖排确实不溢出，但**按钮多到要扫读**本身仍是成本（滴答 rail 实测
 * > 上段只有 5 个）。此后两代裁决在本文件并存到 2026-10-06（审计
 * > `product-level-ia-ux-audit.md` §3.2-1 抓的就是这个），本注释即收敛后的唯一一份。
 *
 * 现行规则（实现见 `splitRailTabs`，判据在 `tests/rail-more-menu.spec.tsx`）：
 *
 * · rail 上段 = **主段（声明序前 4）+ 1 个「更多」**；目的地 ≤ 5 时连「更多」
 *   也不渲染（全放得下就没有藏的必要）。
 * · **当前激活视图落在「更多」里时，把它提升进主段**（替换主段最后一项）——
 *   "你在哪、哪就在台面上"，否则切到一个低频视图后高亮会消失在弹出层里。
 * · 弹出层与 `visibleMainTabs` **同源派生**（`App.tsx`）：关掉功能模块 ⇒ 下次
 *   打开不再出现。
 *
 * ⚠️ **分组会改变 DOM 顺序**，而 `e2e/tests/motivation.spec.ts` 的 `TABS` 锁死了顺序
 * —— 那份文件自己写着"加视图时**先改这里**，再改 App.tsx"，所以两处必须一起改。
 */
export const ALWAYS_ON_VIEW_TABS: readonly ViewTab[] = [
  { key: 'tasks', labelKey: 'web.shell.nav.tasks', Icon: Inbox },
];

/**
 * 可开关的功能模块视图。
 *
 * 🔴 2026-09-29 产品负责人：「**左边的侧边栏那个按钮应该尽可能地减少**」。
 * 这条要求有实测依据 —— `dida-capture/INTERFACE-NOTES.md` §1 记着滴答 rail 的完整清单：
 *
 * ```
 * 上段「去哪看」  任务 / 日历 / 四象限 / 习惯打卡 / 搜索      共 5
 * 下段「工具」    同步（动作，不是视图）/ 通知 / 帮助          共 3，贴底锚定
 *                 —— rail 上**不存在**番茄钟 / 成长 / 便签 / 回收站 / 设置
 * ```
 *
 * ⇒ 而 heyta 此前把所有已启用模块平铺在 rail 上。哪些进主段、哪些落「更多」，
 * **规则只有一份**（见 `ALWAYS_ON_VIEW_TABS` 上方的现行裁决与 `splitRailTabs`）：
 * 主段优先保留任务、日历、习惯和搜索，其余模块进入「更多」。
 *
 * ⚠️ 本数组的**声明顺序因此是产品语义**：排在前面的模块默认出现在 rail 台面上。
 *
 * 🔴 `countdown` 的图标取 `Hourglass`（沙漏），判据是**16px 下读得出形状** ——
 * 与上面「四象限为什么是 `Move` 不是 `ChartScatter`」同一条 R12 纪律，
 * 不是"语义最准"。候选 `CalendarHeart` 在 16px 下是日历里一团点，读不出心形。
 */
export const MODULE_VIEW_TABS: readonly ViewTab[] = [
  // 日历：滴答 rail 的 5 个主菜单之一（任务 / 日历 / 四象限 / 习惯 / 搜索），
  // 所以它紧跟「任务」之后。它的**渲染**与 mobile 共用 `packages/ui` 的 `CalendarBoard`。
  { key: 'calendar', labelKey: 'web.calendar.title', Icon: CalendarDays },
  // 四象限的图标 = `Move`（两条带箭头的轴交叉）。R12，2026-10-02 产品负责人看图定。
  //
  // 🔴 为什么**不是**语义更准的 `ChartScatter`：rail 图标只有 **16px**（`ICON_SIZE.sm`），
  // 那个尺寸下散点糊成一团噪点、`Crosshair` 的十字几乎看不见 —— 实测对比图在
  // `apps/web/evidence/quadrant-icon/candidates-16px.png`。**小尺寸下读不读得出形状**
  // 是这一轮的第一判据，不是"语义准不准"。
  //
  // ⚠️ 它和 `QUADRANT_NAV` 那四项的图标**不是一回事**：那四项各有色块 `swatch`，
  // 而 `NavButton` 是"有 swatch 就渲染色块、否则渲染图标"，
  // 所以 `QUADRANT_NAV` 里的 `icon` 字段**从不渲染**，留着只为满足 `NavEntry` 的类型。
  //
  // ⚠️ 这段注释**必须留在数组外面**：`apps/landing/tests/mockup-shell-shape.spec.tsx`
  // 是按**源码文本**读这些声明块的，把某一项写成多行对象会让它解析不到那一项 ——
  // 实测过一次：只把 `Icon` 换成 `Move` 并把对象拆成多行，那条对账就报"rail 少一项"，
  // 而 key、顺序、词条一个字都没动。
  { key: 'quadrant', labelKey: 'web.shell.nav.quadrant', Icon: Move },
  { key: 'habits', labelKey: 'web.shell.views.habits', Icon: Check },
  { key: 'timeline', labelKey: 'web.shell.views.timeline', Icon: ChartGantt },
  { key: 'focus', labelKey: 'web.shell.views.focus', Icon: Sun },
  { key: 'growth', labelKey: 'web.shell.views.growth', Icon: TrendingUp },
  { key: 'notes', labelKey: 'web.shell.views.notes', Icon: StickyNote },
  { key: 'countdown', labelKey: 'web.shell.views.countdown', Icon: Hourglass },
];

/**
 * 工具段（**贴底**）。它们**不是功能模块** —— 不给关：
 * `trash` 是"找回来"（删错了要能找），`settings` 是配置入口。
 * 把它们做成可关的，等于给用户一个"把回收站关掉、然后无处可找回"的选项。
 */
/**
 * rail 下段「工具」：**只有回收站**。
 *
 * 它**贴底**、**不给关**（关掉回收站等于给用户一个"删错了无处可找回"的选项）。
 *
 * ⚠️ **「设置」不在这里** —— 2026-09-29 按滴答的 IA 收进了**顶部的头像菜单**
 *（rail 是每天点几十次的地方，设置是低频的）。它仍登记在下面的 `SETTINGS_VIEW_TAB`，
 * 但**渲染时不在 rail 上**。
 *
 * ⚠️ **「帮助」也不在这里** —— 它是**动作**（切到设置页并滚到帮助那一段），
 * 而 `role="tab"` 的元素必须是"切视图"那一类，所以它在 `App.tsx` 里单独渲染、
 * 且在 `role="tablist"` **外面**。
 */
export const TOOL_VIEW_TABS: readonly ViewTab[] = [
  { key: 'trash', labelKey: 'web.trash.nav', Icon: Trash2 },
];

/**
 * 「搜索」—— 滴答 rail 的 5 个主菜单之一，**常驻不给关**（同「任务」）。
 *
 * 🔴 它必须在 `VIEW_TABS` 里、而且渲染时**从这个常量取**，不能把按钮硬编码进 JSX：
 * landing 的外壳对账（`apps/landing/tests/mockup-shell-shape.spec.tsx`）读的正是
 * `VIEW_TABS` 的那几个数组。硬编码的按钮它**看不见** ——
 * 实测过一次：rail 上多了一个 tab，而那条门禁照样绿。
 *（这条缺口本身也已记在方案里："按常量对账 ≠ 按渲染对账"。）
 */
export const SEARCH_VIEW_TAB: ViewTab = {
  key: 'search',
  labelKey: 'web.search.title',
  Icon: Search,
};

/**
 * 「设置」的登记项 —— **只为查 `labelKey` 用，不参与 rail 渲染**。
 *
 * 🔴 它必须留在 `VIEW_TABS` 里：`App.tsx` 有一处
 * `VIEW_TABS.find((v) => v.key === view)` 用来取当前视图的标题词条，
 * 而 `setView('settings')` 是合法状态（头像菜单与 AI 面板的"去设置"都会切过去）。
 * 少了它，那一步会拿到 `undefined`。
 *
 * ⚠️ 于是**"在 `VIEW_TABS` 里"≠"在 rail 上"** —— 这个区分是刻意的，
 * 而它也是 landing 那条对账的判据必须按"默认 rail"算、不能简单数常量项数的原因。
 */
export const SETTINGS_VIEW_TAB: ViewTab = {
  key: 'settings',
  labelKey: 'web.shell.views.settings',
  Icon: Settings,
};

export const VIEW_TABS: readonly ViewTab[] = [
  ...ALWAYS_ON_VIEW_TABS,
  ...MODULE_VIEW_TABS,
  SEARCH_VIEW_TAB,
  ...TOOL_VIEW_TABS,
  SETTINGS_VIEW_TAB,
];

export interface RailTabSplit {
  readonly primary: readonly ViewTab[];
  readonly overflow: readonly ViewTab[];
}

/**
 * 默认以四个主入口起步；用户主动固定的入口全部保留，多出视口时在 rail 内滚动。
 * 当前所在的低频视图会被临时提升到主入口，避免用户切换后失去位置感。
 * 这是纯函数，桌面 Web 与测试共享同一条导航裁决；窄屏由宿主再决定如何呈现。
 */
export function splitRailTabs(
  tabs: readonly ViewTab[],
  active: ViewKey,
  preference?: RailPreference,
): RailTabSplit {
  if (preference !== undefined) {
    const available = new Map(tabs.map((tab) => [tab.key, tab]));
    const seen = new Set<ViewKey>();
    const primary: ViewTab[] = [];
    const overflow: ViewTab[] = [];
    const add = (key: ViewKey, target: ViewTab[]): void => {
      if (seen.has(key) || !available.has(key)) return;
      const tab = available.get(key);
      if (tab === undefined) return;
      seen.add(key);
      target.push(tab);
    };
    preference.primary.forEach((key) => add(key, primary));
    preference.overflow.forEach((key) => add(key, overflow));
    // 偏好之外新启用的模块进入更多，不擅自加入用户编排的常驻区。
    tabs.forEach((tab) => add(tab.key, overflow));
    // 任务与搜索是恢复路径，不能被用户拖到不可达区域。
    for (const required of ['tasks', 'search'] as const) {
      const index = overflow.findIndex((tab) => tab.key === required);
      if (index < 0 || primary.some((tab) => tab.key === required)) continue;
      // 恢复必需入口，但不挤走任何用户明确固定的入口。
      const moved = overflow.splice(index, 1)[0];
      if (moved !== undefined) primary.push(moved);
    }
    return { primary, overflow };
  }
  if (tabs.length <= 5) return { primary: tabs, overflow: [] };
  // 搜索是高频恢复入口，即使它在登记表后段也必须留在台面上。
  const pinned: readonly ViewKey[] = ['tasks', 'calendar', 'habits', 'search'];
  const primary = tabs
    .filter((tab) => pinned.includes(tab.key))
    .slice(0, 4)
    .concat(tabs.filter((tab) => !pinned.includes(tab.key)).slice(0, 4))
    .slice(0, 4);
  const primaryKeys = new Set(primary.map((tab) => tab.key));
  const overflow = tabs.filter((tab) => !primaryKeys.has(tab.key));
  if (!overflow.some((tab) => tab.key === active)) return { primary, overflow };
  const promoted = overflow.find((tab) => tab.key === active);
  if (promoted === undefined) return { primary, overflow };
  return {
    primary: [...primary.slice(0, -1), promoted],
    overflow: [...primary.slice(-1), ...overflow.filter((tab) => tab.key !== active)],
  };
}


/**
 * 🔴 这里**曾经**有一张 `VIEW_TITLED_BY_TAB` 白名单，列出"标题跟着 tab 走"的视图，
 * 不在表上的回落到读 `store.filter`。它已于 R9 删掉，原因是它自己就是缺陷的形状：
 * 日历后来作为模块视图加进了 `MODULE_VIEW_TABS`，**没人记得登记它**，
 * 于是"点过象限再点日历"时页头挂着上一个视图残留的象限名。
 * 现在标题的默认是"跟视图走"，只有任务视图（和落在象限上的四象限页）读 filter ——
 * 见 `App.tsx` 的 `title`。**新增视图不需要再登记任何地方。**
 */

/**
 * 排序档位 → 词条键。
 *
 * 🔴 用 `Record<TaskSortKey, MessageKey>` 而不是一个 `Map`：加一档却没给文案时
 * **编译期就报错**。词条键拼错也一样 —— `t()` 的入参是 `MessageKey`。
 * 档位本身来自领域的 `TASK_SORT_KEYS`，这里**不重列一遍选项**（否则界面上
 * 少一档，而那个键永远排不出序，两头都不报错）。
 */
export const SORT_LABEL: Record<TaskSortKey, MessageKey> = {
  display: 'web.shell.sort.display',
  addedAt: 'web.shell.sort.addedAt',
  priority: 'web.shell.sort.priority',
};

/**
 * rail 现在是**纯图标**，名字靠 hover / 键盘聚焦时的一条标签显示（`.ht-rail__label`）。
 * 那条标签是 `position: fixed` 的 —— rail 是 `overflow-y: auto` 的裁剪容器，
 * `absolute` 会被切掉右侧（铃铛面板与头像菜单都为此改成 fixed，见 `app.css`）。
 * 而 fixed 元素**不知道自己该贴在第几个图标旁边**，所以纵坐标必须实测。
 *
 * 🔴 写成 CSS 自定义属性、而不是 React state：
 * hover 是每秒可能来好几次的事件，把一个 state 放进根组件会**重渲染整个外壳**
 * （任务列表、日历、四象限全在内）。这里只有一次 `getBoundingClientRect`
 * 加一次 inline style 写入，可见性完全交给 `:hover` / `:focus-visible`。
 *
 * 写的是**中心**（`top + height / 2`），配合 CSS 里的 `translateY(-50%)` ——
 * 这样标签永远对齐图标的中线，而不依赖按钮高度。
 */
/** Position one fixed rail label from the live button and viewport geometry. */
export function anchorRailLabelElement(tab: HTMLElement): void {
  const rect = tab.getBoundingClientRect();
  const label = tab.querySelector<HTMLElement>('.ht-rail__label');
  const labelRect = label?.getBoundingClientRect();
  const tabStyle = getComputedStyle(tab);
  // The button padding is token-backed and is the same visual gap used by the
  // rail icon column. Reading the computed value keeps this coordinate logic
  // aligned with the design system without introducing a second pixel value.
  const gap = Number.parseFloat(tabStyle.paddingRight) || 0;
  const edge = Number.parseFloat(tabStyle.paddingLeft) || 0;
  const labelWidth = labelRect?.width ?? 0;
  const labelHeight = labelRect?.height ?? 0;
  const maxLeft = Math.max(edge, window.innerWidth - edge - labelWidth);
  const left = Math.min(Math.max(edge, rect.right + gap), maxLeft);
  const minTop = edge + labelHeight / 2;
  const maxTop = Math.max(minTop, window.innerHeight - edge - labelHeight / 2);
  const top = Math.min(Math.max(minTop, rect.top + rect.height / 2), maxTop);
  tab.style.setProperty('--ht-rail-label-left', `${Math.round(left)}px`);
  tab.style.setProperty('--ht-rail-label-top', `${Math.round(top)}px`);
}

export function anchorRailLabel(event: SyntheticEvent<HTMLElement>): void {
  const tab = (event.target as HTMLElement).closest<HTMLElement>('.ht-rail__tab');
  if (tab === null) return;
  anchorRailLabelElement(tab);
}
