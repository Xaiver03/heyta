/**
 * 应用外壳。
 *
 * UI 约定（见 design-system/heyta/MASTER.md）：
 *   - 图标一律 Lucide，**禁止 emoji**（跨平台渲染不一致且不受 token 控制）
 *   - 每个图标按钮必须有 `aria-label`，否则屏幕阅读器读到的是"按钮"
 *   - 数字加 `.tabular-nums`，避免计数变化时宽度跳动
 *   - 所有取值走 `var(--ht-*)`，**不出现裸 hex / px**
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  CalendarDays,
  ChartGantt,
  Check,
  CheckCircle2,
  CircleHelp,
  Search,
  CircleDot,
  X,
  Inbox,
  Moon,
  Sun,
  StickyNote,
  Timer,
  TrendingUp,
  Trash2,
  type LucideIcon,
  Settings,
} from 'lucide-react';

import { searchNotes, searchTasks } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';

import {
  applyFeedbackCorrections,
  applyPreferenceCorrections,
  computeFocusGaps,
  groupTasksByDate,
  inferFeedbackPreferences,
  inferPreferences,
  presentPreferenceIds,
  Priority,
  Quadrant,
  suppressedPreferenceIds,
  toLocalDate,
  filterTasks,
  type MemoryOp,
  type TaskDateGroup,
} from '@heyta/domain';

/**
 * 🔴 估时**写进备注**，不新增持久化字段。
 *
 * 格式与写入规则都在 `@heyta/app-host` 里（`duration-note.ts`），
 * 这里只负责把结果交给 `store.setNote`。壳不做业务判断 —— 见 AGENTS.md §3.5。
 */
import { writeDurationIntoNote } from '@heyta/app-host';

/**
 * 🔴 任务行的**机制**现在来自共享层（M3 第一刀）。
 *
 * 以前这一段是 130 行手写 JSX + 一整套 `.ht-task*` CSS：勾选框的
 * role/state/busy、行骨架、44 触控区补偿、排序 —— 全部各端各写一遍。
 * 现在 `TaskList` 拿走机制，web 只留"这一行上放哪些**本端控件**"
 * （备注、清单/标签、AI 面板、删除）。
 *
 * ⚠️ `TaskList` 会 import `react-native`（web 上由 Vite 别名到
 * `react-native-web`），所以它必须挂在 `<HeytaUiProvider>` 之内 ——
 * 缺了会在运行时抛错，而类型与单测都不会红（`check:ui-provider` 拦这个）。
 */
import {
  HeytaUiProvider,
  TaskGroupHead,
  TaskList,
  type TaskRow as SharedTaskRow,
} from '@heyta/ui';
import { cssVar } from '@heyta/design-system';

import {
  selectQuadrantCounts,
  selectVisibleTasks,
  useTaskStore,
  type TaskFilter,
} from './features/tasks/store.js';
import { DueBadge, type DueDisplayMode } from './features/tasks/DueBadge.js';
import { loadDueDisplay, saveDueDisplay } from './features/tasks/due-display-pref.js';
import { TaskOrganizer } from './features/tasks/TaskOrganizer.js';
import { taskGroupKey, taskGroupTitle } from './features/tasks/date-groups.js';
import { TaskRepeat } from './features/tasks/TaskRepeat.js';
import { NoteEditor } from './features/tasks/NoteEditor.js';
import { SubtaskPicker } from './features/tasks/SubtaskPicker.js';
import { CaptureComposer } from './features/capture/CaptureComposer.js';
import { useProjectStore } from './features/projects/store.js';
import { ConflictDialog } from './features/sync/ConflictDialog.js';
import { CalendarView } from './features/calendar/CalendarView.js';
import { useNoteStore } from './features/notes/store.js';
import { ReminderNotifyPanel } from './features/reminders/ReminderNotifyPanel.js';
import { useReminderNotifications } from './features/reminders/use-reminder-notifications.js';
import { AccountMenu } from './features/shell/AccountMenu.js';
import { InboxBell } from './features/inbox/InboxBell.js';
import { SearchPanel } from '@heyta/ui';
import { FeatureModulesPanel } from './features/shell/FeatureModulesPanel.js';
import {
  SHELL_MODULES,
  loadEnabledModules,
  saveEnabledModules,
  toggleModule,
  type ShellModuleKey,
} from './features/shell/modules.js';
import { SyncBar } from './features/sync/SyncBar.js';
import { useSyncStore } from './features/sync/store.js';
import { SubscriptionNotice } from './features/subscription/SubscriptionNotice.js';
import { ProjectsPanel } from './features/projects/ProjectsPanel.js';
import { QuadrantBoard } from './features/quadrant/QuadrantBoard.js';
import { HabitsView } from './features/habits/HabitsView.js';
import { GrowthView } from './features/motivation/GrowthView.js';
import { TodayProgressBanner } from './features/motivation/TodayProgressBanner.js';
import { NotesView } from './features/notes/NotesView.js';
import { ReminderPanel } from './features/reminders/ReminderPanel.js';
import { TimelinePanel } from './features/timeline/TimelinePanel.js';
import { AiBreakdown } from './features/ai/AiBreakdown.js';
import { AiPrioritize } from './features/ai/AiPrioritize.js';
import { AiDuration } from './features/ai/AiDuration.js';
import { AiToolRun } from './features/ai/AiToolRun.js';
import { AiSettingsNavigationContext } from './features/ai/ai-settings-navigation.js';
import type { SettingsTarget } from './features/ai/route-explanation.js';
import { AiSettings } from './features/settings/AiSettings.js';
import { AdminPanel } from './features/admin/AdminPanel.js';
import { ExportPanel } from './features/settings/ExportPanel.js';
import { HelpPanel } from './features/settings/HelpPanel.js';
import { ImportPanel } from './features/settings/ImportPanel.js';
import { MemoryPanel } from './features/settings/MemoryPanel.js';
// 通行密钥自助管理（列 / 删）—— 服务端早就有端点，此前界面没有任何入口。
import { PasskeyPanel } from './features/settings/PasskeyPanel.js';
// 从滴答清单导入（B2-1）—— 逻辑层早就做完了，这是它的界面入口。
import { TickTickImportPanel } from './features/settings/TickTickImportPanel.js';
import { WidgetJourneyPanel } from './features/settings/WidgetJourneyPanel.js';
import { WidgetPushPanel } from './features/settings/WidgetPushPanel.js';
import {
  createSessionSecretStore,
  loadAiSettings,
  saveAiSettings,
  toHealthSnapshot,
} from './features/settings/aiStore.js';
import { FocusTimer } from './features/focus/FocusTimer.js';
import { TrashView } from './features/trash/TrashView.js';
import { LanguageSwitcher } from './features/shell/LanguageSwitcher.js';
import { onEngineChange, readRecentOps } from './lib/oplog.js';
import { applyTheme, resolveInitialTheme, type Theme } from './lib/theme.js';

import './styles/app.css';

interface NavEntry {
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

const QUADRANT_NAV: NavEntry[] = [
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

const PRIMARY_NAV: NavEntry[] = [
  { filter: { kind: 'all' }, labelKey: 'web.shell.nav.inbox', icon: Inbox },
  { filter: { kind: 'today' }, labelKey: 'web.shell.nav.today', icon: Sun },
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
type ViewKey =
  | 'tasks'
  | 'search'
  | 'calendar'
  | 'quadrant'
  | 'habits'
  | 'focus'
  | 'timeline'
  | 'growth'
  | 'notes'
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
interface ViewTab {
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
 * ## 做法：搬进侧栏 + 分两组，而**不是**把低频的藏进「更多」菜单
 *
 * 调研 §4.4 的建议是「全局导航 4–5 个 + 更多」，并注明"这是**唯一动到肌肉记忆**的
 * 一步，需要产品负责人拍板"。这里**采纳目标、微调手段**，理由写清楚：
 *
 * | | 调研建议 | 这里做的 | 为什么 |
 * |---|---|---|---|
 * | 位置 | rail / 侧栏 | **侧栏**（竖排） | 竖排**天然不溢出** —— 顶栏宽度才是真约束 |
 * | 低频视图 | 藏进「更多」 | **保留可见**，只分组 | 藏起来是**为顶栏宽度付的代价**；侧栏没这个约束，藏就只剩成本（用户多点一次） |
 * | 切视图 vs 切筛选 | 分成两列 | **同一个侧栏的上下两段** | 原来的问题正是"两者混在一个水平条里"，竖排分段就分开了 |
 *
 * ⚠️ **分组会改变 DOM 顺序**，而 `e2e/tests/motivation.spec.ts` 的 `TABS` 锁死了顺序
 * —— 那份文件自己写着"加视图时**先改这里**，再改 App.tsx"，所以两处必须一起改。
 * 数量仍是 9，所以 `smoke.spec.ts` 的 `toHaveCount(9)` 不用动。
 */
const ALWAYS_ON_VIEW_TABS: readonly ViewTab[] = [
  { key: 'tasks', labelKey: 'web.shell.nav.tasks', Icon: Inbox },
];

/**
 * 低频视图 —— **收进「更多」，默认折叠**。
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
 * ⇒ 而 heyta 的 rail 有 **9 个视图按钮**。现在收到 **4 + 1（更多） + 1（设置·贴底）**：
 *
 * | | 之前 | 之后 |
 * |---|---|---|
 * | 上段（去哪看） | 9 | **4**（任务/四象限/习惯/时间线）+ **1 个「更多」** |
 * | 下段（工具，贴底） | — | **1**（设置） |
 *
 * ⚠️ **「设置」不放上段**：滴答的分法是"上段是**去哪看**、下段贴底是**工具**"，
 * 设置属于工具 —— 顺带把它从"每天要看的视图"里摘出来。
 *
 * ⚠️ 时间线留在上段：它占的是滴答 rail 里**「日历」**那一格（heyta 没有日历视图）。
 */
const MODULE_VIEW_TABS: readonly ViewTab[] = [
  // 日历：滴答 rail 的 5 个主菜单之一（任务 / 日历 / 四象限 / 习惯 / 搜索），
  // 所以它紧跟「任务」之后。它的**渲染**与 mobile 共用 `packages/ui` 的 `CalendarBoard`。
  { key: 'calendar', labelKey: 'web.calendar.title', Icon: CalendarDays },
  { key: 'quadrant', labelKey: 'web.shell.nav.quadrant', Icon: CircleDot },
  { key: 'habits', labelKey: 'web.shell.views.habits', Icon: Check },
  { key: 'timeline', labelKey: 'web.shell.views.timeline', Icon: ChartGantt },
  { key: 'focus', labelKey: 'web.shell.views.focus', Icon: Sun },
  { key: 'growth', labelKey: 'web.shell.views.growth', Icon: TrendingUp },
  { key: 'notes', labelKey: 'web.shell.views.notes', Icon: StickyNote },
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
const TOOL_VIEW_TABS: readonly ViewTab[] = [
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
const SEARCH_VIEW_TAB: ViewTab = {
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
const SETTINGS_VIEW_TAB: ViewTab = {
  key: 'settings',
  labelKey: 'web.shell.views.settings',
  Icon: Settings,
};

const VIEW_TABS: readonly ViewTab[] = [
  ...ALWAYS_ON_VIEW_TABS,
  ...MODULE_VIEW_TABS,
  SEARCH_VIEW_TAB,
  ...TOOL_VIEW_TABS,
  SETTINGS_VIEW_TAB,
];


/** 标题直接跟着视图走的那些视图（任务 / 四象限的标题有更具体的信息，不在此列）。 */
const VIEW_TITLED_BY_TAB: readonly ViewKey[] = [
  'habits',
  'focus',
  'timeline',
  'growth',
  'notes',
  'trash',
  'settings',
];

export function App(): React.JSX.Element {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);
  const store = useTaskStore();
  const projects = useProjectStore();
  /**
   * 🔴 `useShallow` 不是优化，**是必需的**。
   *
   * zustand v5 底层是 `useSyncExternalStore`，它要求 selector 的结果
   * **引用稳定**：同一个 state 连续调两次必须返回同一个值。
   * 而 `selectVisibleTasks` 返回 `alive.filter(...)`（新数组）、
   * `selectQuadrantCounts` 返回新对象 —— 每次都是新引用。
   *
   * 后果不是"多渲染几次"，而是 **React 判定快照一直在变、无限重渲染**，
   * 直接抛 `Maximum update depth exceeded`：**整个 `<App />` 挂不起来。**
   *
   * 这个 bug 藏了很久，因为**从来没有任何测试挂载过整个 App** ——
   * 直到真实用户旅程测试第一次去挂它。典型的"每一段都绿、接起来断"。
   */
  const visible = useTaskStore(useShallow(selectVisibleTasks));
  const counts = useTaskStore(useShallow(selectQuadrantCounts));
  const [view, setView] = useState<ViewKey>('tasks');
  /**
   * 已启用的功能模块（**设备本地**，见 `features/shell/modules.ts`）。
   *
   * 🔴 它是"左侧按钮尽可能少"的机制：默认只显示开启的模块，
   * 其余的**不在 rail 上存在**，要用的去设置 → 功能模块里打开。
   */
  const [enabledModules, setEnabledModules] = useState<ReadonlySet<ShellModuleKey>>(
    loadEnabledModules,
  );

  /**
   * 账号邮箱（头像的首字母）。
   *
   * 用 `useShallow` 只订阅这一个字段：整店订阅会让**每一次同步状态变化**
   * 都重渲染整个 `<App />`（那棵树很大，而同步状态变得很频繁）。
   */
  const syncEmail = useSyncStore(useShallow((s) => s.email));
  /**
   * 未登录判据：**有没有令牌**（与旧顶栏登录按钮同一判据 —— 令牌才是
   * "能不能同步"的决定字段，界面状态会撒谎）。它决定账号区要不要渲染
   * 注册/登录的紧凑入口。
   */
  const syncNeedsSignIn = useSyncStore(useShallow((s) => s.token === undefined));

  /**
   * 范围列的**计数**（滴答同款：今天 13 / 收集箱 17）。
   * 🔴 计数判据 = 领域的 `filterTasks`（与列表渲染同一条代码路径）——
   * 这里**不重写一个"大概数"**，否则计数和点进去看到的条数会对不上。
   */
  const navCounts = useMemo(() => {
    const tasks = Object.values(store.entities.tasks);
    const count = (filter: TaskFilter): number => filterTasks(tasks, filter, { now: store.now }).length;
    return {
      all: count({ kind: 'all' }),
      today: count({ kind: 'today' }),
      completed: count({ kind: 'completed' }),
    } as Record<'all' | 'today' | 'completed', number>;
  }, [store.entities.tasks, store.now]);

  /**
   * 任务列表的**日期分组头**（滴答同款：`已过期 / 今天, 周一 / 9月30日, 周三 / 无截止时间`）。
   *
   * 🔴 归属规则在领域的 `groupTasksByDate`（与 `sectionTasks` 同层的产品语义），
   * 措辞在 `features/tasks/date-groups.ts` —— 本组件只消费。
   *
   * 「已完成」筛选**不分组**（滴答的已完成也是平铺）：完成时间不是截止时间，
   * 按日期分组的组头（"今天, 周三"）对已完成列表是误导。
   */
  const dateGroups: readonly TaskDateGroup[] | undefined = useMemo(
    () =>
      store.filter.kind === 'completed'
        ? undefined
        : groupTasksByDate(visible, { now: store.now }),
    [visible, store.now, store.filter.kind],
  );

  /**
   * 分组头上的「顺延」：把逾期组里的每一条推到今天。
   *
   * 🔴 语义（推到哪、保留时刻、幂等边界）在 `app-host` 的 `postponeToToday`，
   * 这里只**逐条转交**。逐条 = 每条任务一条 op —— 它们是**互相独立的意图**
   *（每条任务自己的日期历史），不是"一次拖放写两个字段"那种单实体复合意图
   *（§3.4 反对的是后者）。
   *
   * 串行 `await`（不 `Promise.all`）：op-log 引擎的向量时钟按派发序递增，
   * 并发派发会让 op 顺序不确定 —— 顺序在此处没有业务含义，但**确定的顺序**
   * 让两台设备回放后的结果可对账。
   */
  const [postponingOverdue, setPostponingOverdue] = useState(false);
  const postponeOverdueGroup = useCallback(
    async (group: TaskDateGroup) => {
      setPostponingOverdue(true);
      try {
        for (const task of group.tasks) {
          await useTaskStore.getState().postponeToToday(task.id);
        }
      } finally {
        setPostponingOverdue(false);
      }
    },
    [],
  );

  /** 「帮助」被点过（见 rail 底部那个按钮）。 */
  const [scrollToHelp, setScrollToHelp] = useState(false);

  /**
   * 全局搜索浮层（滴答 rail 的 5 个主菜单之一）。
   *
   * 🔴 它与**顶栏那个输入框不是一回事**（见 `SearchOverlay` 文件头的分工表）：
   * 顶栏筛的是"当前任务列表"，这个浮层搜的是**全部任务 + 全部便签**。
   * 便签在此之前**没有任何搜索入口** —— 那才是它补的缺口。
   */
  const [searchQuery, setSearchQuery] = useState('');

  /**
   * 切到设置页之后**滚到帮助那一段**。
   *
   * ⚠️ 必须在 `view` 真的变成 `settings` 之后再滚 —— 设置页那棵树还没渲染时
   * `getElementById` 拿到的是 `null`，而 `?.` 会把这件事**静默吞掉**，
   * 症状是"点了帮助，页面停在设置顶部"。
   */
  useEffect(() => {
    if (!scrollToHelp || view !== 'settings') return;
    document.getElementById('settings-help')?.scrollIntoView({ block: 'start' });
    setScrollToHelp(false);
  }, [scrollToHelp, view]);
  const [aiSettings, setAiSettings] = useState(loadAiSettings);
  /**
   * AI 面板的「去设置」请求：切到设置页并**落在哪一块**。
   *
   * `undefined` = 用户自己点进来的，不做任何定位。侧栏/视图 tab 的点击
   * 会把它清掉 —— 否则"上次从估时面板跳到授权区块"这件事会粘住，
   * 下次从别处进设置页时页面自己滚一下，看起来像故障。
   */
  /**
   * 🔴 **设置是浮层，不是一路由** —— 所以必须记住"从哪个视图打开的"。
   *
   * 对照证据：滴答清单的设置是**从右侧滑出的浮层面板**，左 rail 与列表明明还在
   *（`docs/research/dida-capture/INTERFACE-NOTES.md` §11.5）。而我们此前把它做成
   * `ViewKey` 之一 —— **打开它会把内容区整个换掉**，下层就没了。
   *
   * 规律（同一节）：**次级表面里做的事都需要"回头看下面"**
   *（搜索时看列表、通知时看列表、设置时也看得到自己在哪个视图）；
   * **主视图之间切换不需要这种回头**，所以它们才留在应用内。
   */
  const [settingsBaseView, setSettingsBaseView] = useState<ViewKey>('tasks');
  useEffect(() => {
    // 只在**离开次级表面**时更新 —— 否则一进设置/搜索就把"从哪来"覆盖成它自己，
    // 关掉浮层时会"回到"浮层本身（关不掉）。
    if (view !== 'settings' && view !== 'search') setSettingsBaseView(view);
  }, [view]);

  /**
   * 关掉次级浮层（设置 / 搜索）—— **唯一**的出口实现。
   *
   * 🔴 三种关法（Esc / ✕ / 点 scrim）都必须走它。各写一份的直接后果是
   * "关回去的目标"与"焦点还给谁"会漂移成三份不同的行为 —— 而这种漂移
   * 用户看得见（从日历开的搜索，一次关回日历、一次关回任务）。
   *
   * 🔴 焦点必须**还回去**：键盘用户关掉浮层后不该被丢在 `<body>` 上
   *（下一次 Tab 会从页首重新开始，看起来像"页面跳了一下"）。
   * 触发器通常已经卸载（头像菜单点完就收起）⇒ 退回身份入口本身。
   */
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetReturnFocus = useRef<HTMLElement | null>(null);
  const closeSecondarySurface = useCallback(() => {
    setView(settingsBaseView);
    const back = sheetReturnFocus.current;
    sheetReturnFocus.current = null;
    if (back?.isConnected === true) {
      back.focus();
      return;
    }
    document.querySelector<HTMLElement>('[data-testid="account-menu-avatar"]')?.focus();
  }, [settingsBaseView]);

  /**
   * 打开设置浮层时：记住触发器、把焦点送进浮层。
   *（对话框的键盘起点 —— 否则焦点留在被点掉的菜单项上，Tab 从页首开始。）
   */
  useEffect(() => {
    if (view !== 'settings') return;
    // ⚠️ 别把 `<body>` 记成触发器：它永远 `isConnected`，于是"焦点还给触发器"
    //    会退化成"焦点什么都没发生"（且下一次 Tab 从页首开始）。
    const active = document.activeElement;
    sheetReturnFocus.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    sheetRef.current?.focus();
  }, [view]);
  /**
   * 内容区按它渲染：开着次级表面（设置/搜索）时仍是**下层那个视图**
   * （浮层之下"下层可见"，§11.5）。
   */
  const contentView = view === 'settings' || view === 'search' ? settingsBaseView : view;

  const [settingsFocus, setSettingsFocus] = useState<SettingsTarget | undefined>(undefined);
  /**
   * AI 面板唯一的"下一步"入口（经 `AiSettingsNavigationContext` 传给四个面板）。
   *
   * 🔴 它**只做两件事**：切视图、记落点。授权到这里为止 ——
   * 真正写 `consents` 的仍然只有 `AiSettings` 里的 `grant()` / `updateRouting`。
   * 用 `useCallback` 是因为它是 context 的 value：每次渲染换一个新函数
   * 会让四个面板连带重渲染。
   */
  const openAiSettings = useCallback((target: SettingsTarget) => {
    setSettingsFocus(target);
    setView('settings');
  }, []);

  /**
   * 侧栏里点一个筛选（智能清单 / 象限 / 清单）。
   *
   * 🔴 **必须同时切回 `tasks` 视图。** 在此之前侧栏的 `onClick` 只写
   * `setFilter`，于是"人在习惯页、点收集箱"会什么都没发生 ——
   * 筛选真的变了，但当前视图根本不读它，标题也跟着 `VIEW_TITLED_BY_TAB`
   * 显示成「习惯」。用户看到的是**点了没反应**。
   *
   * 侧栏里的每一项都是**任务筛选**（`TaskFilter` 的全部 5 个分支都只作用于
   * 任务视图），所以"点它就进任务视图"不是补丁，而是这个控件本来的语义。
   * 加「已完成」那条入口时才发现这条一直是坏的 —— 新入口若继承这个 bug，
   * 就会出现"加了按钮但还是看不见已完成"。
   *
   * `setSettingsFocus(undefined)` 与视图 tab 的点击保持一致：用户自己导航
   * = 不做定位（见 `settingsFocus` 的说明）。
   */
  const goToFilter = useCallback(
    (filter: TaskFilter) => {
      setSettingsFocus(undefined);
      setView('tasks');
      useTaskStore.getState().setFilter(filter);
    },
    [],
  );

  /**
   * 从搜索结果点开一条任务：**切到任务视图并把它滚进视野**。
   *
   * 🔴 2026-09-30 修：此前这里只 `setView('tasks')` 并把 `taskId` 显式丢弃
   *（`void taskId`），注释还写着"列表里能看见它" —— 那是假的：搜索是**全库**搜，
   * 而任务视图当时可能停在「今天」这类筛选上，被点的那条**根本不在列表里**。
   * 用户看到的是"点了没反应"（与 `goToFilter` 那条注释记的 bug 同一类）。
   *
   * 所以两件事一起做：① 筛选切到「全部」（保证它在列表里）；
   * ② 滚到那一行 —— 列表有几十行时"它在列表里"与"你看得见它"不是一回事。
   * ⚠️ 滚要在**下一帧**：这一帧 React 还没把新筛选下的行画出来。
   */
  const openTaskFromSearch = useCallback(
    (taskId: string) => {
      goToFilter({ kind: 'all' });
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-testid="task-item-${taskId}"]`)
          ?.scrollIntoView({ block: 'center' });
      });
    },
    [goToFilter],
  );
  // 🔴 密钥只在内存里，只活在这个标签页（Web 没有系统钥匙串）
  const [aiSecrets] = useState(createSessionSecretStore);
  /**
   * 截止时间的呈现方式。
   *
   * ⚠️ 它是**视图开关**，读的是同一个 `dueDate` 字段，可随时切回 ——
   * 这是刻意的（见 `DueBadge.tsx` 文件头）：倒计时是**待验证的 UI 假设**，
   * 做成开关才有对照组，也才能一键回退。
   */
  /**
   * 截止时间的呈现方式。
   *
   * ⚠️ 它是**视图开关**，读的是同一个 `dueDate` 字段，可随时切回 ——
   * 这是刻意的（见 `DueBadge.tsx` 文件头）：倒计时是**待验证的 UI 假设**，
   * 做成开关才有对照组，也才能一键回退。
   *
   * 🔴 2026-09-30 从任务页头**搬进设置**（带说明的选项组）：页头上两个
   * 光秃秃的「日期 | 倒计时」用户根本不知道是什么；且空列表时点了没有
   * 任何可见变化。偏好按设备本地持久化（`due-display-pref.ts`）。
   */
  const [dueDisplay, setDueDisplayState] = useState<DueDisplayMode>(loadDueDisplay);
  const setDueDisplay = useCallback((mode: DueDisplayMode) => {
    setDueDisplayState(mode);
    saveDueDisplay(mode);
  }, []);

  /**
   * 记忆落差的 op 窗口（最近 `MEMORY_OP_WINDOW` 条 op）。
   *
   * `null` = **还读不到**（store 未就绪 / 读取失败）—— 面板据此**如实说明**
   * "暂时算不出推迟次数"，而不是把"算不出"渲染成"推迟 0 次"。
   */
  const [opWindow, setOpWindow] = useState<readonly MemoryOp[] | null>(null);

  /**
   * 🔴 记忆层：**每次从 op-log 派生，不落盘**（ADR-0014 §3.3）。
   *
   * 为什么在这里算而不是存起来：存了就会漂移，而漂移的"用户画像"比没有更糟。
   * `inferPreferences` 是纯函数，重算的代价是 O(任务数) —— 可以忽略。
   *
   * ⚠️ 顺序很重要：先算**原始**推断，再应用用户的纠正。
   * "你已忘记"那一区必须拿**纠正之前**的 id 列表去算 ——
   * 被抑制的偏好已经不在纠正后的集合里了。
   */
  const memory = useMemo(() => {
    const offsets = { now: Date.now(), utcOffsetMinutes: -new Date().getTimezoneOffset() };

    /**
     * 🔴 「说的 vs 做的」落差 —— 记忆护城河第一次真正接到界面上。
     *
     * 只在**记忆开启**且**事件流已就绪**时计算：
     *   - 关闭时连算都不算（隐私红线：不留"算了但没显示"的中间态）；
     *   - `opWindow === null` 时传 `null`，面板据此说明"暂时算不出推迟次数"
     *     —— 绝不能退化成"推迟 0 次"（那是编造）。
     */
    const focusGaps =
      aiSettings.memoryEnabled === true && opWindow !== null
        ? computeFocusGaps({
            tasks: Object.values(store.entities.tasks),
            focusSessions: Object.values(store.entities.focusSessions),
            operations: opWindow,
            now: offsets.now,
          })
        : null;

    const raw = inferPreferences({
      memoryEnabled: aiSettings.memoryEnabled,
      tasks: Object.values(store.entities.tasks),
      focusSessions: Object.values(store.entities.focusSessions),
      ...offsets,
    });
    const rawFeedback = inferFeedbackPreferences({
      memoryEnabled: aiSettings.memoryEnabled,
      feedback: Object.values(store.entities.aiFeedback),
    });

    const corrections = Object.values(store.entities.preferenceCorrections);
    const suppressed = suppressedPreferenceIds(corrections);

    return {
      preferenceSet: applyPreferenceCorrections(raw, suppressed),
      feedbackSet: applyFeedbackCorrections(rawFeedback, suppressed),
      // 🔴 故意用 raw 算：被抑制的偏好不在 corrected 里
      rawPresentIds: presentPreferenceIds(raw, rawFeedback),
      // ⚠️ `deletedAt` 必须传下去：面板要据此排除**已撤销**的纠正，
      // 否则"恢复"之后那条偏好会同时出现在「我了解到的你」和「你已忘记」里。
      corrections: corrections.map((c) => ({
        id: c.id,
        preferenceId: c.preferenceId,
        kind: 'suppress' as const,
        ...(c.deletedAt === undefined ? {} : { deletedAt: c.deletedAt }),
      })),
      focusGaps,
    };
  }, [aiSettings.memoryEnabled, store.entities, opWindow]);

  /**
   * 把最近一段 op 事件流读进 state（`computeFocusGaps` 推算推迟次数必需）。
   *
   * 三个刻意的选择：
   *   1. **只在记忆开启时读** —— 关闭时连读都不读，省电且不留中间态；
   *   2. **订阅 `onEngineChange` 保持新鲜** —— 只在挂载时读一次会造成
   *      "数据到了、界面没去看"（本仓库记过的同类 bug）；
   *   3. **读失败不崩、也不装作成功**：`setOpWindow(null)` → 面板如实说
   *      "暂时算不出推迟次数"。
   */
  useEffect(() => {
    if (aiSettings.memoryEnabled !== true) {
      setOpWindow(null);
      return;
    }

    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const ops = await readRecentOps();
        if (!cancelled) setOpWindow(ops);
      } catch {
        // store 尚未初始化 / IndexedDB 不可用 —— 诚实降级，绝不装作"推迟 0 次"。
        if (!cancelled) setOpWindow(null);
      }
    };

    void load();
    const unsubscribe = onEngineChange(() => {
      void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [aiSettings.memoryEnabled]);

  // 主题应用到 <html data-theme>，tokens.css 的暗色覆盖挂在那里
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 「今天」视图需要 now 保持新鲜，否则跨过午夜后它不会更新
  useEffect(() => {
    const id = window.setInterval(() => store.refreshNow(), 60_000);
    return () => window.clearInterval(id);
    // store.refreshNow 是稳定引用，不放进依赖数组以免反复装定时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 行内插槽。**这些是"内容"，本来就该各端各写**，所以留在 App.tsx。
   *
   * ⚠️ 这两个回调是在共享组件的渲染过程中被调用的，**不是组件边界** ——
   * 所以里面不能调 hook。它们返回的是**组件元素**（`<DueBadge/>`、
   * `<NoteEditor/>`…），那些组件自己的 hook 在自己的边界里跑，没问题。
   *
   * ⚠️ 元信息用**内联 token 值**复刻原来 `.ht-task__meta` 的排版
   *（xs + subtle + tabular-nums），而不是新加一个 CSS 类 ——
   * 迁移的验收之一就是 `.ht-task*` 那一族消失。
   */
  const renderTaskMeta = useCallback(
    (row: SharedTaskRow): React.ReactNode => (
      <span
        data-testid="task-meta"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--ht-space-2)',
          fontSize: 'var(--ht-font-size-xs)',
          color: 'var(--ht-color-foreground-subtle)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <DueBadge task={row.source} mode={dueDisplay} now={store.now} />
        {row.source.priority !== undefined && row.source.priority > Priority.None ? (
          <span>P{row.source.priority}</span>
        ) : null}
      </span>
    ),
    [dueDisplay, store.now],
  );

  /**
   * 行尾：本端特有的交互控件。**顺序与迁移前逐字一致** ——
   * 备注 → 清单/标签 → AI 拆解 → AI 估时 → 删除。
   *
   * 🔴 不把它们留在 web 侧手写整行，只是"把控件放进共享行的尾部插槽"——
   * 行的骨架、触控区、排序、无障碍 role/state 仍然只有 `TaskList` 一份实现。
   */
  const renderTaskTrailing = useCallback(
    (row: SharedTaskRow): React.ReactNode => {
      const task = row.source;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ht-space-2)' }}>
          {/* 备注。🔴 在它之前 Web 上**没有备注输入框** ——
              `Task.note` 与 `setNote` 都在，但唯一调用点是 AI 拆解与 AI 估时，
              于是"我自己能不能在任务上写点东西"的答案是"不能"。 */}
          <NoteEditor
            task={task}
            onSetNote={(note) => {
              void store.setNote(task.id, note);
            }}
          />

          {/* 子任务。🔴 在它之前：`packages/domain/src/subtasks.ts`（616 行，
              建树 + 环防护 + 深度/子数上限）与 `app-host` 的 `setParent`
              **都已经写好**，但 Web 上一次调用点都没有 —— 于是
              "模型支持、树能建、用户没有任何办法造出一个子任务"，
              且**不报错**，只是这个功能不存在（方案 §5.5 的"看起来有其实没有"）。 */}
          <SubtaskPicker
            task={task}
            onSetParent={(parentId) => store.setParent(task.id, parentId)}
          />

          {/* 清单归属 + 标签。Web 端此前**根本没有入口** ——
              `moveToProject` 没有任何调用点、`tagIds` 全仓库零读写，
              于是侧栏里建出来的清单和标签一个也用不上。 */}
          <TaskOrganizer
            task={task}
            onMoveToProject={(projectId) => {
              void store.moveToProject(task.id, projectId);
            }}
            onSetTags={(tagIds) => {
              void store.setTags(task.id, tagIds);
            }}
          />

          {/* 重复。🔴 Web 此前**没有入口** —— 移动端早就能设，
              两端不一致；这一处补的正是 B2-3 的「Web 入口」那一半，
              并额外给了移动端也还没有的**自定义 RRULE**。 */}
          <TaskRepeat
            task={task}
            now={store.now}
            onSetRepeat={(rule) => {
              void store.setRepeat(task.id, rule);
            }}
          />

          {/* 提醒。🔴 在这一刀之前 `REMINDER` 有写路径、op 能同步，
              但 Web 上**没有任何入口能建它** —— 提醒面板补的就是这最后一米。
              状态与动作全在 `features/reminders/store.ts`（唯一一处
              `createReminderActions`），这里只把它挂在行的尾部插槽上。 */}
          <ReminderPanel task={task} />

          {/* AI 拆解。配置关着时它仍然在 —— 点了会说明该去开什么，
              而不是消失（"找不到入口"和"入口说为什么不可用"是两件事）。 */}
          <AiBreakdown
            task={task}
            routing={aiSettings.routing}
            consents={aiSettings.consents}
            secrets={aiSecrets}
            // 🔴 把上次落盘的熔断状态传回去 —— 否则落盘没有意义。
            healthSnapshot={aiSettings.health}
            // 🔴 记忆偏好。开关关着时这里是空集 —— 界面拿不到任何偏好。
            preferenceSet={memory.preferenceSet}
            onApplyNote={(note) => store.setNote(task.id, note)}
            /**
             * 🔴 反馈落到 op-log（跨设备同步）。
             * 不接这个回调，AI 就永远学不到"该给你几项"——
             * 界面上的逐条取舍会变成白点，没有任何记录。
             */
            onFeedback={(fb) => {
              void store.recordAiFeedback({ feature: 'breakdown', ...fb });
            }}
            onHealth={(health) => {
              // 🔴 熔断状态落盘。**不进 op-log** —— 它是本机状态，
              // 换台设备该重新探一次端点，而不是继承另一台的失败历史。
              setAiSettings((previous) => {
                const next = {
                  ...previous,
                  health: toHealthSnapshot(health, Date.now()),
                };
                saveAiSettings(next);
                return next;
              });
            }}
          />

          {/* AI 估时。
              🔴 结果**写进备注**，不新增持久化字段 —— 加字段要产品先拍板
              （见 `packages/app-host/src/duration-note.ts` 文件头与
              `ai-capability-branches.md` §5.1）。
              ⚠️ 刻意**不传 `history`**：web 壳目前没有暴露专注历史，
              而不传的语义是"这次估时没有历史可用"，是 fail closed 的一侧。
              等专注历史接出来再传，不要在这里编一份假的。 */}
          <AiDuration
            task={task}
            routing={aiSettings.routing}
            consents={aiSettings.consents}
            secrets={aiSecrets}
            healthSnapshot={aiSettings.health}
            preferenceSet={memory.preferenceSet}
            onApply={async (minutes) => {
              await store.setNote(task.id, writeDurationIntoNote(task.note, minutes));
            }}
            onHealth={(health) => {
              setAiSettings((previous) => {
                const next = {
                  ...previous,
                  health: toHealthSnapshot(health, Date.now()),
                };
                saveAiSettings(next);
                return next;
              });
            }}
          />

          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            aria-label={t('web.shell.tasks.delete', { title: task.title })}
            onClick={() => {
              void store.deleteTask(task.id);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      );
    },
    [aiSecrets, aiSettings, memory.preferenceSet, store, t],
  );

  /** 行级无障碍文案。**每一项都是一整句**，不要用前缀拼标题。 */
  const taskRowLabels = useMemo(
    () => ({
      toggleOn: (row: SharedTaskRow) => t('web.shell.tasks.complete', { title: row.title }),
      toggleOff: (row: SharedTaskRow) => t('web.shell.tasks.uncomplete', { title: row.title }),
    }),
    [t],
  );

  const title = useMemo(() => {
    const f = store.filter;
    // 习惯 / 番茄钟 / 时间线 / 成长 / 设置：标题跟**视图**走。
    // 这些视图里没有"任务筛选"这回事，标题必须由视图自己决定，
    // 否则显示的是上一个视图残留的清单名。
    //
    // 🔴 取的是 `labelKey` 再 `t(...)`，**不是**表里的中文本身 ——
    // 模块级常量里不能有句子（见 `NavEntry.labelKey` 的注释）。
    if (VIEW_TITLED_BY_TAB.includes(view)) {
      const tab = VIEW_TABS.find((v) => v.key === view);
      return tab === undefined ? t('web.shell.nav.tasks') : t(tab.labelKey);
    }
    /**
     * 四象限页要看筛选**是否真的落在某个象限上**：
     * 落上了就用更具体的象限名（「重要且紧急」比「四象限」有用），
     * 没落上（用户只是点了顶部标签）就不能显示上一个视图的清单名。
     */
    if (view === 'quadrant' && f.kind !== 'quadrant') return t('web.shell.nav.quadrant');
    if (f.kind === 'all') return t('web.shell.nav.inbox');
    if (f.kind === 'today') return t('web.shell.nav.today');
    if (f.kind === 'completed') return t('web.shell.nav.completed');
    // filter 是判别联合（含 all/today/completed/quadrant/project），
    // **必须显式判 kind** 才能访问各自特有字段 —— 直接取 f.quadrant 编译不过。
    if (f.kind === 'quadrant') {
      const entry = QUADRANT_NAV.find(
        (n) => n.filter.kind === 'quadrant' && n.filter.quadrant === f.quadrant,
      );
      return entry === undefined ? t('web.shell.nav.quadrant') : t(entry.labelKey);
    }
    if (f.kind === 'project') {
      // 清单名是**用户自己的字**，原样显示、不翻译。
      return projects.projects.find((p) => p.id === f.projectId)?.name ?? t('web.shell.nav.project');
    }
    if (f.kind === 'tag') {
      // 同理：标签名也是用户自己的字，原样显示。
      return projects.tags.find((tag) => tag.id === f.tagId)?.name ?? t('web.shell.nav.tag');
    }
    return t('web.shell.nav.tasks');
    // `t` 与 `view` 都进依赖：语言变了标题必须跟着变，视图换了标题也得跟着换。
    // `projects.projects` 同理 —— 清单改名后标题不该还是旧名字。
  }, [store.filter, projects.projects, view, t]);

  /**
   * 🔴 #2「用户可见通知」的接线：把**已到点、还没投递**的提醒真的投出去。
   *
   * 在此之前 `reminders/store.ts` 早就把 `due` 算出来写进 state 了，
   * 而**没有任何东西读它** —— 用户可以建提醒、提醒能同步、能到点，
   * 到点之后什么都不会发生。全仓也一个 `new Notification(` 都没有。
   */
  useReminderNotifications();

  /** 全部便签（未删除、规范序 —— 见 `useNoteStore`）。 */
  const allNotes = useNoteStore(useShallow((s) => s.notes));

  /**
   * 搜索结果 —— **两个域函数各管一半**，不在这里重写匹配逻辑。
   *
   * ⚠️ 输入被 `trim()`：`searchTasks` 对空查询返回"全部"，所以"还没输入"
   * 这个状态必须在**渲染层**判（见 `SearchOverlay` 的 `prompt`），
   * 否则一打开浮层就会把整个库列出来。
   */
  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (q === '') return { tasks: [], notes: [] };
    return {
      tasks: searchTasks(Object.values(store.entities.tasks), q),
      notes: searchNotes(allNotes, q),
    };
  }, [searchQuery, store.entities.tasks, allNotes]);

  /** 搜索面板要的全部文案（共享层不许 `import '@heyta/i18n'`，所以由宿主注入）。 */
  const searchLabels = useMemo(
    () => ({
      title: t('web.search.title'),
      placeholder: t('web.search.placeholder'),
      close: t('web.search.close'),
      tasksSection: t('web.search.tasksSection'),
      notesSection: t('web.search.notesSection'),
      prompt: t('web.search.prompt'),
      noResults: t('web.search.noResults'),
      count: (n: number) => t('web.search.count', { count: n }),
      taskRow: {
        toggleOn: (row: { title: string }) => t('web.shell.tasks.complete', { title: row.title }),
        toggleOff: (row: { title: string }) => t('web.shell.tasks.uncomplete', { title: row.title }),
      },
    }),
    [t],
  );

  /**
   * 次级浮层的标准出口：**Esc 关掉，回到"从哪来"的那个视图**。
   *
   * 搜索与设置共用这一条 —— 它们同形态（`aria-modal=false` 的浮层、下层继续渲染），
   * 退出口也必须同形。搜索面板的 ✕ 由共享层自带；设置这边由下面那个
   * `.ht-sheet__close` 提供。
   *
   * 🔴 必须挂在**捕获阶段**（`capture: true`）。面板的输入框是共享层
   * `SearchPanel` 的 RN-web `TextInput`，它在自己的 keydown 处理器里
   * **无条件 `stopPropagation()`**（react-native-web #612："Prevent key events
   * bubbling"）—— 冒泡阶段挂在 window 上的监听器**永远收不到**焦点在输入框里
   * 时的按键（输入框 autoFocus，那正是常态）。实测：keyup 能到 window、
   * keydown 到不了。捕获阶段在下传时先于目标处理器触发，才拦得到。
   *
   * ⚠️ 代价：捕获意味着"浮层里若有别的 Esc 消费者（嵌套下拉）"，外层会先关。
   * 当前设置页里没有嵌套的 Esc 面（唯一的例外是确认框，它自己会先关），所以成立。
   */
  useEffect(() => {
    if (view !== 'search' && view !== 'settings') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSecondarySurface();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view, closeSecondarySurface]);

  /**
   * rail 上段「去哪看」= **任务 + 已启用的模块**。
   *
   * 🔴 **任务永远在**（它是这个应用本身，不给关）；`settings` / `trash` 归下段工具。
   * 顺序沿用 `VIEW_TABS`（DOM 顺序的事实源）。
   */
  const visibleMainTabs = useMemo(
    () =>
      VIEW_TABS.filter(
        (v) =>
          v.key !== 'settings' &&
          v.key !== 'trash' &&
          // 「任务」与「搜索」常驻（不给关）；其余视图由功能模块开关决定。
          (v.key === 'tasks' || v.key === 'search' || enabledModules.has(v.key as ShellModuleKey)),
      ),
    [enabledModules],
  );

  /**
   * rail 下段「工具」= **回收站**。**贴底**，不参与模块开关。
   *
   * ⚠️ **「设置」不在这里** —— 它收进了顶部的**头像菜单**（滴答的做法：
   * rail 是每天点几十次的地方，设置是低频的）。
   * 「帮助」也不在这里 —— 它是**动作**（切到设置页并滚到帮助），不是 tab。
   */
  const visibleToolTabs = TOOL_VIEW_TABS;

  /**
   * 开关一个功能模块。
   *
   * 🔴 **立刻落盘、立刻反映到 rail**：把"存哪儿"与"看到什么"分成两步，
   * 会出现"开关动了、导航没变"，而用户会以为坏了。
   */
  const onToggleModule = useCallback((key: ShellModuleKey) => {
    setEnabledModules((current) => {
      const next = toggleModule(current, key);
      saveEnabledModules(next);
      return next;
    });
  }, []);


  return (
    /**
     * 🔴 「去设置」的导航通道。
     *
     * 四个 AI 面板里，捕获那个是 `CaptureComposer` 渲染的，而那个文件
     * 不在本轮的写入白名单里。用 context 让**唯一的新接入点**留在
     * `App.tsx`（视图切换本来就在这里），而不是为一个导航参数去改别的功能。
     */
    <AiSettingsNavigationContext.Provider value={openAiSettings}>
      <div className={`ht-app${view === 'tasks' ? ' ht-app--with-sidebar' : ''}`}>
      {/*
        ═══════════════════════════════════════════════════════════════════════
        🔴 外壳分三层（2026-09-29，落实 `dida-view-unification.md` §1.3 / §4.1 / §4.4）
        ═══════════════════════════════════════════════════════════════════════

        原来这里只有 `ht-sidebar` + `ht-main` 两层，而**四类东西堆在同一列**：
        视图（9 个）、范围筛选（收集箱/今天/已完成）、四象限筛选、"清单/标签"。
        其中「四象限」这个词还**同时**指两件不同的事：

          · `view === 'quadrant'` → 渲染 `QuadrantBoard`（2×2 网格）
          · `goToFilter({kind:'quadrant'})` → **一律 `setView('tasks')`**，
            也就是"任务列表按单个象限筛选"

        ⇒ 用户点侧栏的「四象限」，得到的**不是**那个四象限视图。这就是
        "切视图与切筛选混为一谈"的实测形态。

        现在的分层（与滴答同构）：

          ┌──────┬──────────┬─────────────────────────┐
          │ rail │ sidebar  │ main                     │
          │ 视图 │ 当前视图 │ header + content         │
          │      │ 的范围   │                         │
          └──────┴──────────┴─────────────────────────┘

        · **rail**：上段「去哪看」= **4 个视图 + 1 个「更多」**，下段贴底 = **工具（设置）**；
          ⚠️ 按钮数刻意压到最少（产品负责人 2026-09-29：「左边的侧边栏那个按钮应该尽可能地减少」），
          依据是滴答 rail 的实测清单（见 `MODULE_VIEW_TABS` 上方的说明）；
        · **sidebar**：**只放"当前视图的范围"**，且**没有范围的视图就不显示它**
          （滴答也是这样：日历/四象限/习惯视图里 ②直接消失、主区吃满）；
        · **main**：标题 + 工具 + 内容。

        ⚠️ 唯一还共享范围的视图是 `tasks`（收集箱/今天/已完成/四象限/清单/标签）。
        四象限视图**不显示 sidebar** —— 它的 2×2 网格自己就是完整语义。
      */}
      <nav className="ht-rail" aria-label={t('web.shell.nav.aria')}>
        {/*
          🔴 顶部是**头像**（点开才是 设置 / 统计 / 退出登录）。
          照滴答：rail 是每天点几十次的地方，而"设置"是低频的 ——
          它占着每一屏，换来的只是每次扫读时多一个要跳过的词。
        */}
        <div className="ht-rail__top">
          <AccountMenu
            email={syncEmail}
            showSignIn={syncNeedsSignIn}
            onSignIn={() => {
              useSyncStore.getState().openSignIn();
            }}
            onOpenSettings={() => {
              setSettingsFocus(undefined);
              setView('settings');
            }}
            onOpenGrowth={() => {
              setSettingsFocus(undefined);
              setView('growth');
            }}
            // 「成长」是**可关的模块**（rail 那条已按开关过滤）—— 菜单这条同理。
            growthEnabled={enabledModules.has('growth')}
            onSignOut={() => {
              useSyncStore.getState().clearCredentials();
            }}
          />
          {/* 🔴 品牌名走词条（`common.brand`）——「heyta」是**用户可见文案**，
              硬编码会被 `check:ui-language` 拦，而它正是为这一类存在的。 */}
          <span className="ht-brand__name">{t('common.brand')}</span>
        </div>

        {/*
          视图切换。用 role=tablist 让屏幕阅读器理解这是一组互斥选项。

          🔴 **按钮数由「功能模块」开关决定**（产品负责人：「左边的侧边栏那个按钮
          应该尽可能地减少」+「就是这样子的自定义也可以」）。结构照滴答的 rail：

          ```
          上段「去哪看」  任务 + **已启用的模块**（默认：四象限 / 习惯 / 时间线）
          下段「工具」    回收站 / 设置   —— 贴底
          ```

          ⇒ **默认 6 个按钮**，而用户可以继续关 —— 全关掉只剩「任务 + 回收站 + 设置」。
          ⚠️ 关掉的模块**不在 DOM 里**，不是"渲染了但隐藏"（那两者的差别是
          屏幕阅读器还念不念它、Tab 键还停不停在它上面）。
        */}
        <div role="tablist" aria-label={t('web.shell.views.aria')} className="ht-rail__tabs">
          {visibleMainTabs.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              className={`ht-rail__tab${view === v.key ? ' ht-rail__tab--active' : ''}`}
              onClick={() => {
                // 用户自己导航 = 不定位。见 `settingsFocus` 的说明。
                setSettingsFocus(undefined);
                setView(v.key);
              }}
            >
              <v.Icon size={16} aria-hidden="true" />
              <span>{t(v.labelKey)}</span>
            </button>
          ))}


        {/*
          工具段：**贴底**。滴答的 rail 也是这个结构（上段"去哪看"、下段"工具"，
            中间留白分开）。回收站是"找回来"，设置是低频配置 —— 都不属于每天要看的视图。

            🔴 **视图与工具仍在同一个 `role="tablist"` 里**：`role="tab"` 出现在
            `tablist` **外面**是无效的 a11y 结构；而它们都是**互斥的目的地**
            （点一个就切过去）—— 中间那条留白是**视觉**分组，不是语义分组。
            贴底用 `margin-top: auto` 实现，不再插一个 spacer 元素。
            ⚠️ 而「帮助」是**动作**（它切到设置页），所以它在 tablist **外面**（见下）。
          */}
          {visibleToolTabs.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              className={`ht-rail__tab ht-rail__tab--tool${view === v.key ? ' ht-rail__tab--active' : ''}`}
              onClick={() => {
                setSettingsFocus(undefined);
                setView(v.key);
              }}
            >
              <v.Icon size={16} aria-hidden="true" />
              <span>{t(v.labelKey)}</span>
            </button>
          ))}

        </div>

        {/*
          通知中心 / 活动。
          🔴 **刻意是 `nav.ht-rail` 的直接子按钮、且在「帮助」之前**：
          贴底靠的是 `.ht-rail__tab--tool:first-of-type { margin-top: auto }`，
          而 `:first-of-type` 选的是父元素里第一个 `<button>`。给铃铛包一层 div
          会让它拿不到那条规则 —— 铃铛会留在列表正下方、与帮助之间裂开一大块空白
          （`InboxBell.tsx` 里有同一段说明）。
          ⚠️ 它**不是** `role="tab"`（它是动作：打开一个面板，不切视图），
          所以 `smoke.spec.ts` / `motivation.spec.ts` 数 tab 的断言不受影响。
        */}
        <InboxBell />

        {/*
          「帮助」——🔴 **刻意在 `role="tablist"` 外面**。
          它不是视图（点了会切到设置页并滚到帮助那一段），
          而 `role="tab"` 的元素**必须**是"切视图"那一类：把一个动作塞进 tablist
          会让屏幕阅读器把它念成"另一个视图"。它与顶部的头像是同一类 —— **动作**。
          ⚠️ **不做成第三个设置入口**：顶部头像里已经有一个「设置」，
          再来一个会让人以为两个不一样。
        */}
        <button
          type="button"
          data-testid="rail-help"
          className="ht-rail__tab ht-rail__tab--tool"
          onClick={() => {
            setSettingsFocus(undefined);
            setView('settings');
            setScrollToHelp(true);
          }}
        >
          <CircleHelp size={16} aria-hidden="true" />
          <span>{t('web.shell.nav.help')}</span>
        </button>
      </nav>

      {/*
        sidebar **只在有范围的视图里出现**。
        `tasks` 有（智能清单 / 按象限筛选 / 清单 / 标签）；其余视图没有 ——
        这正是"切视图"与"切筛选"分开之后自然得到的结果。
      */}
      {view === 'tasks' ? (
        <nav className="ht-sidebar" aria-label={t('web.shell.nav.scopeAria')}>
          <div className="ht-nav">
            {PRIMARY_NAV.map((entry) => (
              <NavButton
                key={entry.labelKey}
                entry={entry}
                count={
                  entry.filter.kind === 'all'
                    ? navCounts.all
                    : entry.filter.kind === 'today'
                      ? navCounts.today
                      : entry.filter.kind === 'completed'
                        ? navCounts.completed
                        : undefined
                }
                active={isActive(store.filter, entry.filter)}
                onClick={() => goToFilter(entry.filter)}
              />
            ))}
          </div>

          {/*
            侧栏这一节就叫**「四象限」** —— 它列的就是那四个象限，名字直说。

            ⚠️ 这里一度被我改成「按象限筛选」，理由是它与 rail 里的**四象限视图**同名。
            产品负责人当场否掉：**侧栏列的是四个象限，叫「四象限」才对**。
            ⇒ 我记下的"同名冲突"确实存在（点它会 `setView('tasks')`，得到的是
            任务列表的一个筛选，不是那个 2×2 网格视图），但**解法不是改名字**。
            真要动，动的是**行为**（或者让 rail 的那个视图换个名字），
            而不是把用户认得的词从侧栏拿掉。
          */}
          <div className="ht-nav__section">{t('web.shell.nav.quadrantSection')}</div>
          <div className="ht-nav">
            {QUADRANT_NAV.map((entry) => (
              <NavButton
                key={entry.labelKey}
                entry={entry}
                count={
                  entry.filter.kind === 'quadrant'
                    ? counts[entry.filter.quadrant]
                    : undefined
                }
                active={isActive(store.filter, entry.filter)}
                onClick={() => goToFilter(entry.filter)}
              />
            ))}
          </div>
          <ProjectsPanel onSelect={goToFilter} />
        </nav>
      ) : null}

      <main className="ht-main">
        <header className="ht-header">
          <h1 className="ht-header__title">{title}</h1>

          {/*
            搜索框。**只在任务视图里出现** —— 它筛的是任务列表，
            而习惯 / 番茄 / 成长 / 设置那几屏没有"任务列表"可筛，
            放一个在那里打不出结果的搜索框比没有更坏。

            🔴 判据（匹配哪些字段 / 大小写 / 多词是 AND）全在
            `packages/domain/src/search.ts`，这里只负责把字读出来交给 store。
          */}
          {contentView === 'tasks' && (
            <div className="ht-search">
              <input
                type="search"
                className="ht-search__input"
                value={store.query}
                onChange={(e) => {
                  store.setQuery(e.target.value);
                }}
                placeholder={t('web.shell.search.placeholder')}
                aria-label={t('web.shell.search.aria')}
              />
              {store.query !== '' && (
                <button
                  type="button"
                  className="ht-search__clear"
                  aria-label={t('web.shell.search.clear')}
                  onClick={() => {
                    store.setQuery('');
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )}
          {/*
            🔴 视图切换**曾经在这里**（顶栏一行平铺 9 个 tab）。
            2026-09-29 挪进侧栏 —— 实测 1280px 下只能完全看见 5/8，现在有 9 个只会更挤。
            见 `VIEW_TAB_GROUPS` 上方的说明与 `dida-view-unification.md` §4.4。
            **不要把它搬回来。**
          */}
          <div className="ht-header__actions">
            {/* 截止时间呈现方式开关。
                只在任务视图里有意义 —— 其他视图不显示截止时间。
                🔴 它是**开关**而不是固定行为：倒计时是待验证的 UI 假设，
                有开关才有对照组，也才能一键回退（见 DueBadge.tsx 文件头）。 */}
            <SyncBar />
            <ConflictDialog />
            {/* 语言切换。外壳顶栏的全局控件区，与主题切换并列 ——
                这是**真实用户唯一能把界面切到英文的入口**（见该文件的注释）。 */}
            <LanguageSwitcher />
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              // 主题按钮是纯图标，所以必须自带可访问名（AGENTS.md §5）。
              aria-label={
                theme === 'light'
                  ? t('common.a11y.toDarkTheme')
                  : t('common.a11y.toLightTheme')
              }
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </header>

        <div className="ht-content">
          {/**
           * 今日进度（激励体系 L1）—— 🔴 **只在任务视图渲染**（2026-09-30 产品负责人
           * 拍板，推翻 09-29 的"常驻做事视图"方案）："0/0 今天还没有安排"出现在
           * 日历/习惯/番茄钟/便签上是纯噪音 —— 那些页面各自有自己的主内容，
           * 顶部再顶一条任务进度，等于每个页面都被任务页的开头占一段。
           * "跨视图的同一件事"只说明它**不该长四份**，不说明它**该到处出现**。
           *
           * 🔴 M3 第十一刀之后它来自 `@heyta/ui`（与 mobile 同一份实现），
           * 接线在 `features/motivation/TodayProgressBanner.tsx`（那里自己包了
           * `HeytaUiProvider`）—— 它会 `useHeytaUiTheme()`，缺了会在运行时抛错。
           * 不能复用下面 `tasks` 那棵树的 Provider：它只包住 `TaskList`，
           * 而进度卡是它的兄弟节点（同样的坑在 focus 那一刀已经踩过一次）。
           */}
          {contentView === 'tasks' && <TodayProgressBanner />}

          {/* 🔴 托管同步到期/被拒时的提示。它**只解释**"哪一件事被限制了"
              （通过官方托管服务的同步；含超出免费额度的新设备），不挡任何功能 ——
              本地任务照常查看 / 编辑 / 导出（subscription-boundary.md §2）。
              未配置 / 自托管 / 断网时不渲染任何东西。 */}
          <SubscriptionNotice />
          {/* AI 捕获的接线**留在这个组件内部** —— 输入框的草稿是它的状态，
              而草稿就是 AI 要解析的那句话。把草稿镜像到这里再传回去
              会造出两份状态，且"应用后清空输入框"没法做（清不动上游的 state）。

              与 `AiBreakdown` 一样：配置关着时它**仍然在**，点了会说明该去开什么，
              而不是消失。 */}
          {/*
            🔴 **只在任务视图渲染**（2026-09-30 页8 扫描的裁定）。它曾经无条件下渲染，
            于是便签页出现**两条采集条叠贴**（任务条紧贴便签的「写点什么…」）、
            习惯/番茄钟/回收站各顶一条文不对题的任务输入 —— 每个采集面
            应该归它自己的视图（习惯页有「新习惯」、便签页有「写点什么」）。
            草稿状态在组件内部，卸载即清 —— 换视图丢草稿是**可接受的**
            （切回来正要重新想的那句话，值不上一个跨视图的全局状态）。
          */}
          {contentView === 'tasks' && (
            <CaptureComposer
              routing={aiSettings.routing}
              consents={aiSettings.consents}
              secrets={aiSecrets}
              // 🔴 把上次落盘的熔断状态传回去 —— 否则落盘没有意义。
              healthSnapshot={aiSettings.health}
              // 🔴 记忆偏好。开关关着时这里是空集 —— 界面拿不到任何偏好。
              preferenceSet={memory.preferenceSet}
              onFeedback={(fb) => {
                void store.recordAiFeedback({ feature: 'capture', ...fb });
              }}
              onHealth={(health) => {
                // 🔴 熔断状态落盘。**不进 op-log** —— 它是本机状态，
                // 换台设备该重新探一次端点，而不是继承另一台的失败历史。
                setAiSettings((previous) => {
                  const next = {
                    ...previous,
                    health: toHealthSnapshot(health, Date.now()),
                  };
                  saveAiSettings(next);
                  return next;
                });
              }}
            />
          )}

          {/* AI 优先级建议（功能 ②）。
              🔴 它是**批量**的，而且只能出现在列表上方 —— "哪件事更重要"只有在
              互相比较时才成立；逐条问模型"这一条重要吗"既贵又没有意义。

              与 `AiBreakdown` 一样：配置关着时它**仍然在**，点了会说明该去开什么，
              而不是消失（"找不到入口"和"入口说为什么不可用"是两件事）。 */}
          {contentView === 'tasks' && visible.length > 0 && (
            <AiPrioritize
              tasks={visible}
              routing={aiSettings.routing}
              consents={aiSettings.consents}
              secrets={aiSecrets}
              // 🔴 把上次落盘的熔断状态传回去 —— 否则落盘没有意义。
              healthSnapshot={aiSettings.health}
              // 🔴 记忆偏好。开关关着时这里是空集 —— 界面拿不到任何偏好。
              preferenceSet={memory.preferenceSet}
              /**
               * 🔴 逐条写回，但**只写用户勾选保留的那些**（`decisions` 已经是
               * 取舍后的结果）。走 `store.setPriority` —— 那条路走 op-log，
               * 所以它能同步到别的设备，也能被撤销。
               *
               * 一条一个 intent：这里刻意不合并成一个批量 op，
               * 因为用户可能只采纳其中三条（见 AGENTS.md §3.4）。
               */
              onApply={async (decisions) => {
                for (const d of decisions) {
                  await store.setPriority(d.id, d.priority);
                }
              }}
              onHealth={(health) => {
                // 🔴 熔断状态落盘。**不进 op-log** —— 它是本机状态，
                // 换台设备该重新探一次端点，而不是继承另一台的失败历史。
                setAiSettings((previous) => {
                  const next = {
                    ...previous,
                    health: toHealthSnapshot(health, Date.now()),
                  };
                  saveAiSettings(next);
                  return next;
                });
              }}
            />
          )}

          {/* AI 工具调用（功能 ⑤）。
              🔴 它不新增路由/页面：作为任务视图里的一个面板挂在这里。
              规则命中时**一个字节都不发**（面板会明说）；只有规则处理不了时才披露 + 发送。
              写工具只产出提案，必须用户再点「确认执行」才落库。 */}
          {contentView === 'tasks' && (
            <AiToolRun
              routing={aiSettings.routing}
              consents={aiSettings.consents}
              // 🔴 工具授权复用设置里那份 `localApi.grants` —— 不另建一套权限。
              grants={aiSettings.localApi.grants}
              secrets={aiSecrets}
              healthSnapshot={aiSettings.health}
              onHealth={(health) => {
                setAiSettings((previous) => {
                  const next = {
                    ...previous,
                    health: toHealthSnapshot(health, Date.now()),
                  };
                  saveAiSettings(next);
                  return next;
                });
              }}
            />
          )}

          {/*
            任务列表。**一行只有一个实现** —— 就是 `@heyta/ui` 的 `TaskList`
            （与 mobile 同一份源码）。

            `HeytaUiProvider` 必须包在外面：共享组件从 context 取 token /
            文字样式，缺了会**运行时抛错**而类型与单测都不会红
            （`check:ui-provider` 拦这个）。

            ⚠️ 空态仍由本端给（`EmptyState`）。它是**宿主内容**（按 filter
            给图标/标题/提示），不是"一行"的机制 —— 共享层的 `emptyMessage`
            只是一个字符串，装不下它。

            🔴 **分组头（2026-09-30，滴答同款）**：`dateGroups` 有值时列表
            按日期分组（已过期 / 今天 / 明天 / 逐日 / 无截止时间），
            逾期组头带「顺延」。`testID="task-list"` 挪到**外层容器**：
            既有断言（浮层 IA、e2e）都拿它认"任务视图在不在"，
            而分组后 `TaskList` 一屏会有多个 —— 重复的 testid 会把
            Playwright 的 strict mode 打红。
          */}
          {contentView === 'tasks' &&
            (visible.length === 0 ? (
            <EmptyState filter={store.filter} />
          ) : dateGroups === undefined ? (
            <HeytaUiProvider>
              <TaskList
                tasks={visible}
                onToggleTask={(taskId) => {
                  void store.toggleComplete(taskId);
                }}
                labels={taskRowLabels}
                renderMeta={renderTaskMeta}
                renderTrailing={renderTaskTrailing}
                testID="task-list"
              />
            </HeytaUiProvider>
          ) : (
            <div data-testid="task-list">
              {dateGroups.map((group) => {
                const key = taskGroupKey(group);
                return (
                  /*
                    🔴 组头是共享层 `TaskGroupHead`（页7 做的时候曾手写
                    `.ht-task-group` CSS，被 `check:row-single-source` 拦下：
                    "任务列表的实现只长在 packages/ui"——组头是列表的机制，
                    留在 web 里 mobile 就得抄第二遍）。web 只留两件宿主事：
                    措辞（`taskGroupTitle`）与动作（逾期组的「顺延」按钮，
                    走既有 `.ht-btn--ghost`，不长新前缀族）。
                  */
                  <section
                    key={key}
                    data-testid={`task-group-${key}`}
                    style={{ marginBlockEnd: cssVar('space.2') }}
                  >
                    <HeytaUiProvider>
                      <TaskGroupHead
                        title={taskGroupTitle(group, store.now, t)}
                        count={group.tasks.length}
                        action={
                          group.kind === 'overdue' ? (
                            <button
                              type="button"
                              className="ht-btn ht-btn--ghost"
                              onClick={() => {
                                void postponeOverdueGroup(group);
                              }}
                              disabled={postponingOverdue}
                              aria-label={t('web.tasks.group.postponeAria', {
                                count: group.tasks.length,
                              })}
                              data-testid="task-group-postpone"
                            >
                              {t('web.tasks.group.postpone')}
                            </button>
                          ) : undefined
                        }
                        testID={`task-group-${key}-head`}
                      />
                      <TaskList
                        tasks={group.tasks}
                        onToggleTask={(taskId) => {
                          void store.toggleComplete(taskId);
                        }}
                        labels={taskRowLabels}
                        renderMeta={renderTaskMeta}
                        renderTrailing={renderTaskTrailing}
                        testID={`task-list-${key}`}
                      />
                    </HeytaUiProvider>
                  </section>
                );
              })}
            </div>
          ))}

          {/*
            全局搜索（跨任务 + 便签）。🔴 它补的缺口是**便签从来没有搜索入口** ——
            顶栏那个输入框筛的是"当前任务列表"，够不到便签。
            与顶栏那个的分工写在 `packages/ui/src/search/SearchPanel.tsx` 文件头。

            🔴 **它是居中浮层，不是一路由**（滴答 §11.5，2026-09-30 改）：
            `view === 'search'` 时 `contentView` 仍是开搜索前的那个视图，
            `.ht-search-overlay` 只在内容区上盖一层 scrim + 居中卡片 ——
            **下层视图透出**。判据同设置 sheet：打开搜索时，
            下层视图的标记必须仍在 DOM 里。改成"替换内容区"就会让判据变红。
          */}
          {view === 'search' && (
            <div
              className="ht-search-overlay"
              role="dialog"
              aria-modal="false"
              aria-label={searchLabels.title}
              data-testid="search-overlay-surface"
              onClick={(event) => {
                // 点到 scrim 本身（而不是卡片内的任何东西）= 想关掉。
                // 目标同 Esc：回到**开搜索前**的那个视图。
                if (event.target === event.currentTarget) closeSecondarySurface();
              }}
            >
            <HeytaUiProvider>
              <SearchPanel
                query={searchQuery}
                onQueryChange={setSearchQuery}
                onClose={() => {
                  closeSecondarySurface();
                }}
                tasks={searchResults.tasks}
                notes={searchResults.notes}
                onToggleTask={(taskId) => {
                  void store.toggleComplete(taskId);
                }}
                onOpenTask={(taskId) => {
                  // 点结果 → 切到任务视图、筛到「全部」、滚到那一行。
                  // 见 `openTaskFromSearch`：只切视图是不够的（可能根本不在当前筛选里）。
                  openTaskFromSearch(taskId);
                }}
                onOpenNote={() => {
                  setSettingsFocus(undefined);
                  setView('notes');
                }}
                labels={searchLabels}
                testID="search-panel"
              />
            </HeytaUiProvider>
            </div>
          )}
          {contentView === 'calendar' && <CalendarView />}
          {contentView === 'quadrant' && <QuadrantBoard />}
          {contentView === 'habits' && <HabitsView />}
          {/**
           * 番茄钟。**计时核心来自 `@heyta/ui` 的共享 `FocusPanel`**
           * （与 mobile 同一份实现）。
           *
           * 🔴 `HeytaUiProvider` 必须包在**这一处**：上面 `tasks` 那棵树的
           * Provider 不会覆盖到这里。`check:ui-provider` 只断言"宿主里出现过
           * Provider"，**不检查嵌套** —— 所以漏掉这一层时它照样全绿，
           * 而打开专注页会在运行时抛「useHeytaUiTheme 必须在 Provider 内使用」。
           */}
          {contentView === 'focus' && (
            <HeytaUiProvider>
              <FocusTimer />
            </HeytaUiProvider>
          )}
          {/**
           * 时间线。排的是**当前视图里的任务**，每个任务一块。
           *
           * 🔴 起始日取"今天"（`store.now`）—— 时间线总得从某一天起算，
           * 而从今天起排是唯一不需要问用户、也不会说谎的默认值。
           * 它只是**展示参数**，不落任何持久化字段。
           */}
          {contentView === 'timeline' && (
            <TimelinePanel
              tasks={visible}
              startDate={toLocalDate(store.now)}
              today={toLocalDate(store.now)}
              now={store.now}
            />
          )}
          {contentView === 'growth' && <GrowthView />}
          {/* 便签。🔴 `NotesView` 里自带一层 `HeytaUiProvider` ——
              上面 tasks 那棵树的 Provider 不覆盖兄弟节点（见该文件头）。 */}
          {contentView === 'notes' && <NotesView />}
          {contentView === 'trash' && <TrashView />}
          {/*
            🔴 **设置是浮层（sheet），不是一路由** —— 见 `settingsBaseView` 的说明与
            `docs/research/dida-capture/INTERFACE-NOTES.md` §11.5。

            判据（可注入故障）：**打开设置时，下层视图的标记必须仍在 DOM 里**
            —— `contentView` 保证下层继续渲染，`.ht-sheet` 只盖在它上面。
            改回"替换内容区"（让下层不渲染）就会让那条判据变红。
          */}
          {view === 'settings' && (
            <div
              className="ht-sheet"
              role="dialog"
              aria-modal="false"
              aria-label={t('web.shell.views.settings')}
              data-testid="settings-sheet"
              ref={sheetRef}
              // 对话框的键盘起点：打开时焦点进容器（见上面的 effect）。
              tabIndex={-1}
            >

            {/*
              🔴 **显示偏好**（2026-09-30 从任务页头搬进来）：「日期 | 倒计时」
              两个词悬在页头上，用户不知道它是什么、影响什么 —— 它其实是
              “任务行上的截止时间怎么显示”。显示偏好属于设置：带说明、带上下文。
              设备本地持久化（`due-display-pref.ts`），不进 op-log。
            */}
            <section className="ht-settings" data-testid="display-pref-panel">
              <h2 className="ht-settings__title">{t('web.settings.display.title')}</h2>
              <p className="ht-settings__hint">{t('web.settings.display.dueNote')}</p>
              <div
                role="radiogroup"
                aria-label={t('web.shell.dueMode.aria')}
                className="ht-settings__options"
                data-testid="due-display-pref"
              >
                {(
                  [
                    { key: 'date' as DueDisplayMode, labelKey: 'web.shell.dueMode.date' },
                    { key: 'countdown' as DueDisplayMode, labelKey: 'web.shell.dueMode.countdown' },
                  ] as const
                ).map((d) => (
                  <label key={d.key} className="ht-settings__option">
                    <input
                      type="radio"
                      name="due-display"
                      checked={dueDisplay === d.key}
                      onChange={() => setDueDisplay(d.key)}
                    />
                    <span>{t(d.labelKey)}</span>
                  </label>
                ))}
              </div>
            </section>
            {/*
              🔴 **看得见的退出口**（2026-09-30 补）。此前这个浮层**没有任何出口**：
              没有 Esc、没有 ✕、点 scrim 也不关（它盖满内容区，点哪儿都是它自己）
              —— 唯一的出路是去点 rail 上的另一个视图。那对键盘与读屏用户就是
              "进得去出不来"，对鼠标用户是"得先猜到点别处"。
              浮层的标准出口是**两个都要有**：Esc（快捷）+ ✕（看得见）。
            */}
            <button
              type="button"
              className="ht-sheet__close"
              data-testid="settings-sheet-close"
              aria-label={t('web.shell.settings.close')}
              onClick={() => {
                closeSecondarySurface();
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
            <>
              {/*
                🔴 **功能模块放在设置页最前**：它决定的不是某一项配置，而是
                **这个应用长什么样**（关掉的模块从左侧导航消失）。
                放在最后会变成"翻到底才发现原来能关" —— 而它本该是
                用户想减负时第一个看到的东西。
              */}
              <FeatureModulesPanel enabled={enabledModules} onToggle={onToggleModule} />
              {/* 提醒通知（#2）：权限只能由用户手势申请，所以它必须有个按钮。 */}
              <ReminderNotifyPanel />
              <AiSettings
                initial={aiSettings}
                secrets={aiSecrets}
                focusTarget={settingsFocus}
                memorySlot={
                  <MemoryPanel
                    memoryEnabled={aiSettings.memoryEnabled}
                    preferenceSet={memory.preferenceSet}
                    feedbackSet={memory.feedbackSet}
                    rawPresentIds={memory.rawPresentIds}
                    corrections={memory.corrections}
                    focusGaps={memory.focusGaps}
                    onSuppress={(id) => void store.suppressPreference(id)}
                    onRestore={(id) => void store.restorePreference(id)}
                  />
                }
                /**
                 * 🔴 回传并落盘。不传的话 `AiSettings` 会退回自己存 localStorage，
                 * 于是 `aiSettings` 这个 state **不会更新** ——
                 * 用户关掉记忆开关后，界面上的偏好要刷新才消失。
                 * 隐私开关"关不掉当下的行为"是不可接受的。
                 */
                onChange={(next) => {
                  setAiSettings(next);
                  saveAiSettings(next);
                }}
              />
              {/* 导出入口与 AI 设置并列在同一个设置页 —— 见 ExportPanel 文件头。 */}
              <ExportPanel />
              {/*
                运营管理后台（ADR-0038）。**对非管理员什么都不渲染** ——
                它自己探测一次 `/api/admin/overview`，403 就返回 null，
                普通用户在设置页里看不到任何多出来的东西。
                ⚠️ 这是 UX 而不是安全：授权由服务端的 `requireAdmin` 承担。
              */}
              <AdminPanel />
              {/* 导入 / 还原是导出的另一半 —— 只支持还原到空库，见 ImportPanel 文件头。 */}
              <ImportPanel />
              {/* 从滴答清单迁进来（B2-1）—— 与上面的"还原自己的导出"是两件事，
                  走普通 op、可与既有数据共存。见 TickTickImportPanel 文件头。 */}
              <TickTickImportPanel />
              {/* 账号安全：管理自己的通行密钥（列 / 删）。见 PasskeyPanel 文件头。 */}
              <PasskeyPanel />
              {/*
                Windows 小组件的后台刷新（Web Push）。
                🔴 **能力不可用时这个面板自己不画** —— http:// 上、没配 VAPID 的
                自托管实例上、权限被拒之后，它都是一个点了必然失败的开关。
                判断逻辑在 `WidgetPushPanel` 里（`probeWidgetPush`），
                **不在这里** —— 调用点判断条件会被漏掉，而组件自己判断不会。
              */}
              {/*
                卡片从哪来 —— 这一段必须在推送开关**之前**。
                🔴 顺序是有意的：Windows 的卡片**只来自已安装的 PWA**，
                用户不先把 heyta 装成应用，推送开关对他毫无意义
                （卡片还不存在，刷新谁？）。
              */}
              <WidgetJourneyPanel />
              <WidgetPushPanel />
              {/*
                🔴 「帮助与关于」是**产品孤岛的另一半**：在此之前，应用里
                没有任何一处能到达站点的帮助 / 价格 / 更新动态。
                放在最后是按「关于」类内容的惯例 —— 它不是日常操作，
                但必须**存在**（否则用户在应用里遇到问题只能去搜索引擎找，
                而那意味着他会找到别家的产品）。
              */}
              <div id="settings-help">
                <HelpPanel />
              </div>
            </>
            </div>
          )}
        </div>
      </main>
      </div>
    </AiSettingsNavigationContext.Provider>
  );
}

function NavButton({
  entry,
  count,
  active,
  onClick,
}: {
  entry: NavEntry;
  count?: number;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const Icon = entry.icon;
  return (
    <button
      type="button"
      className="ht-nav__item"
      aria-current={active}
      onClick={onClick}
    >
      {entry.swatch !== undefined ? (
        <span className={`ht-swatch ${entry.swatch}`} aria-hidden="true" />
      ) : (
        <Icon size={16} aria-hidden="true" />
      )}
      {t(entry.labelKey)}
      {count !== undefined && count > 0 && (
        <span className="ht-nav__count">{count}</span>
      )}
    </button>
  );
}

/**
 * 空状态。
 *
 * 规则：**任何列表都必须有空状态**，且要给出下一步动作。
 * 留白屏会让用户以为应用坏了。
 */
function EmptyState({ filter }: { filter: TaskFilter }): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 空态文案。
   *
   * ⚠️ 存的是**键对**（标题 + 下一步动作），不是句子 —— 句子在词条表里，
   * 渲染时才 `t(...)`。`all` 同时是兜底：出现新的 `filter.kind` 时
   * 不能留一片空白（"任何列表都必须有空状态"，见文件尾注释）。
   */
  const messages: Record<string, { titleKey: MessageKey; hintKey: MessageKey }> = {
    all: {
      titleKey: 'web.shell.empty.all.title',
      hintKey: 'web.shell.empty.all.hint',
    },
    today: {
      titleKey: 'web.shell.empty.today.title',
      hintKey: 'web.shell.empty.today.hint',
    },
    completed: {
      titleKey: 'web.shell.empty.completed.title',
      hintKey: 'web.shell.empty.completed.hint',
    },
    quadrant: {
      titleKey: 'web.shell.empty.quadrant.title',
      hintKey: 'web.shell.empty.quadrant.hint',
    },
  };
  const msg = messages[filter.kind] ?? messages['all']!;

  return (
    <div className="ht-empty">
      <Inbox className="ht-empty__icon" size={40} aria-hidden="true" />
      <p className="ht-empty__title">{t(msg.titleKey)}</p>
      <p className="ht-empty__hint">{t(msg.hintKey)}</p>
    </div>
  );
}

function isActive(current: TaskFilter, target: TaskFilter): boolean {
  if (current.kind !== target.kind) return false;
  /**
   * 🔴 **判别联合的每个带载荷分支都要比载荷，不能只比 `kind`。**
   *
   * 原先只特判了 `quadrant`，其余一律返回 `true` —— 于是**两个不同的清单
   * 会同时显示为当前项**（`kind` 都是 `'project'`），而标签分支加进来之后
   * 同一个问题会扩大到标签。症状是侧栏同时高亮两行，用户以为选中了错的那个。
   *
   * 写成 `switch` 而不是一串 `if`：加分支时 `never` 兜底会在**编译期**
   * 提醒这里还没处理 —— 这正是判别联合相对宽形状的价值。
   */
  switch (current.kind) {
    case 'quadrant':
      return target.kind === 'quadrant' && current.quadrant === target.quadrant;
    case 'project':
      return target.kind === 'project' && current.projectId === target.projectId;
    case 'tag':
      return target.kind === 'tag' && current.tagId === target.tagId;
    case 'all':
    case 'today':
    case 'completed':
      return true;
  }
}
