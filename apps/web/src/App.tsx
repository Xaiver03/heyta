import { ICON_SIZE } from '@heyta/design-system';
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
  CircleHelp,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Sun,
  Trash2,
  X,
} from 'lucide-react';

import { searchNotes, searchTasks } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';

import {
  applyFeedbackCorrections,
  applyPreferenceCorrections,
  computeFocusGaps,
  emptyFeedbackPreferenceSet,
  emptyPreferenceSet,
  groupTasksByDate,
  inferFeedbackPreferences,
  inferPreferences,
  presentPreferenceIds,
  Quadrant,
  suppressedPreferenceIds,
  toLocalDate,
  filterTasks,
  TASK_SORT_KEYS,
  type MemoryOp,
  type TaskDateGroup,
  type TaskSortKey,
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
  resolveHeytaUiTheme,
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
import { wantsSignInOnLoad } from './lib/auth-deep-link.js';
import { type DueDisplayMode } from './lib/due-display.js';
import { TaskRowMeta } from './features/tasks/row-meta.js';
import { loadDueDisplay, saveDueDisplay } from './features/tasks/due-display-pref.js';
import { loadTaskSort, saveTaskSort } from './features/tasks/sort-pref.js';
import {
  loadDetailPane,
  saveDetailPane,
  type DetailPanePref,
} from './features/shell/detail-pane-pref.js';
import { TagChips, TaskOrganizer } from './features/tasks/TaskOrganizer.js';
import { taskGroupKey, taskGroupTitle } from './features/tasks/date-groups.js';
import { RepeatChip, TaskRepeat } from './features/tasks/TaskRepeat.js';
import { DueEditor } from './features/tasks/DueEditor.js';
import { NoteBadge, NoteEditor } from './features/tasks/NoteEditor.js';
import { SubtaskBadge, SubtaskPicker } from './features/tasks/SubtaskPicker.js';
import { CaptureComposer } from './features/capture/CaptureComposer.js';
import { useProjectStore } from './features/projects/store.js';
import { ConflictDialog } from './features/sync/ConflictDialog.js';
import { PrivacyConsentSheet } from './features/privacy/PrivacyConsentSheet.js';
import { LegalReconfirmSheet } from './features/legal-recheck/LegalReconfirmSheet.js';
import { shouldAskOnFirstLaunch, usePrivacyStore } from './features/privacy/store.js';
import { CalendarSidebar } from './features/calendar/CalendarSidebar.js';
import { CalendarHeaderToolbar } from './features/calendar/CalendarHeaderToolbar.js';
import { CalendarView } from './features/calendar/CalendarView.js';
import { useNoteStore } from './features/notes/store.js';
import { ReminderNotifyPanel } from './features/reminders/ReminderNotifyPanel.js';
import { useReminderNotifications } from './features/reminders/use-reminder-notifications.js';
import { AccountMenu } from './features/shell/AccountMenu.js';
import { InboxBell } from './features/inbox/InboxBell.js';
/**
 * 搜索面板的**机制**来自共享层，宿主只提供内容与键盘。
 *
 * 🔴 `moveCursor` / `buildResultEntries` / `filterQuickActions` 在这里调用，
 * 但**判断不在这里写**（AGENTS §3.5）：光标怎么走、跳转项怎么筛，四端必须一样。
 * 宿主之所以必须监听按键，是因为 RN 的 `TextInput` 没有 `onKeyDown`、
 * 而 react-native-web 的又在 keydown 里 `stopPropagation()`（§7 第 80 条）——
 * 平台差异是"谁来听键"，不是"怎么听"。
 */
import {
  buildResultEntries,
  CURSOR_IN_INPUT,
  filterQuickActions,
  moveCursor,
  SearchPanel,
  type QuickAction,
  type SearchResultEntry,
} from '@heyta/ui';
import { FeatureModulesPanel } from './features/shell/FeatureModulesPanel.js';
import {
  SHELL_MODULES,
  loadEnabledModules,
  saveEnabledModules,
  toggleModule,
  type ShellModuleKey,
} from './features/shell/modules.js';
import { SidebarResizer } from './features/shell/SidebarResizer.js';
import { SyncBar } from './features/sync/SyncBar.js';
import { useSyncStore } from './features/sync/store.js';
import { SubscriptionNotice } from './features/subscription/SubscriptionNotice.js';
import { RenewPanel } from './features/subscription/RenewPanel.js';
import { ProjectsPanel } from './features/projects/ProjectsPanel.js';
import { QuadrantBoard } from './features/quadrant/QuadrantBoard.js';
import { HabitDetailCard } from './features/habits/HabitDetailCard.js';
import { HabitsView } from './features/habits/HabitsView.js';
import { GrowthView } from './features/motivation/GrowthView.js';
import { CountdownView } from './features/countdown/CountdownView.js';
import { NotesView } from './features/notes/NotesView.js';
import { NoteEditorCard } from './features/notes/NoteEditorCard.js';
import { TaskDetailCard } from './features/tasks/TaskDetailCard.js';
import { useDetailColumnShown } from './features/shell/detail-pane-visible.js';
import { ReminderBadge, ReminderPanel } from './features/reminders/ReminderPanel.js';
import { TimelinePanel } from './features/timeline/TimelinePanel.js';
import { AiBreakdown } from './features/ai/AiBreakdown.js';
import { AiPrioritize } from './features/ai/AiPrioritize.js';
import { AiDuration } from './features/ai/AiDuration.js';
import { AiToolRun } from './features/ai/AiToolRun.js';
import { AssistantPanel } from './features/ai/AssistantPanel.js';
import { AiSettingsNavigationContext } from './features/ai/ai-settings-navigation.js';
import { PanelEphemeralProvider } from './features/ai/panel-ephemeral.js';
import type { SettingsTarget } from './features/ai/route-explanation.js';
import { AiSettings } from './features/settings/AiSettings.js';
import { AdminPanel } from './features/admin/AdminPanel.js';
import { ExportPanel } from './features/settings/ExportPanel.js';
import { HelpPanel } from './features/settings/HelpPanel.js';
import { ImportPanel } from './features/settings/ImportPanel.js';
import { MemoryPanel } from './features/settings/MemoryPanel.js';
// 通行密钥自助管理（列 / 删）—— 服务端早就有端点，此前界面没有任何入口。
import { PasskeyPanel } from './features/settings/PasskeyPanel.js';
import { CloseAccountPanel } from './features/settings/CloseAccountPanel.js';
// 个人信息（R10）：昵称与头像的增删改查。入口在头像菜单的「编辑个人信息」，
// 面板本体开在设置浮层第一段 —— 它需要令牌，而令牌就住在同步设置里。
import { ProfilePanel } from './features/settings/ProfilePanel.js';
// 隐私同意的**撤回**入口（PIPL 第 15 条：撤回要比同意更容易做到）。
// 同意面板只在首启弹一次，之后用户要改只能从这里改 —— 没有它，一次点击就成了永久决定。
import { PrivacyPanel } from './features/settings/PrivacyPanel.js';
// 改登录密码 —— `/api/password/change` 与 `useAuthStore.changePassword` 都在，
// 缺的就是这张表（在此之前那条动作**全仓库零调用点**）。见 PasswordPanel 文件头。
import { PasswordPanel } from './features/settings/PasswordPanel.js';
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
import { FocusDetailPane } from './features/focus/FocusDetailPane.js';
import { FocusTimer } from './features/focus/FocusTimer.js';
import { TrashView } from './features/trash/TrashView.js';
import { LanguageSwitcher } from './features/shell/LanguageSwitcher.js';
import { onEngineChange, readRecentOps } from './lib/oplog.js';
import { useSelectionKeyboardCursor } from './lib/keyboard-cursor.js';
import { pruneSelectionFromEntities, selection, useSelected } from './lib/selection.js';
import { applyTheme, rememberThemeChoice, resolveInitialTheme, type Theme } from './lib/theme.js';

import './styles/app.css';

import {
  QUADRANT_NAV,
  PRIMARY_NAV,
  SORT_LABEL,
  TOOL_VIEW_TABS,
  VIEW_TABS,
  anchorRailLabel,
  type ViewKey,
} from './features/shell/view-tabs.js';
import { NavButton } from './features/shell/NavButton.js';
import { EmptyState, isActive } from './features/shell/EmptyState.js';


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
  /**
   * 详情面的**选中态**（W1）。它住 `@heyta/app-host`，web 只有这一行胶水。
   *
   * 🔴 为什么不是 `useState`：选中要能跨视图（列表 / 日历 / 四象限 / 时间线 /
   * 搜索 / 回收站是同一批任务），而各视图各存一份的结果就是"从搜索点进一条、
   * 切回日历，选中丢了；而在习惯页它又是另一套回落规则"。
   * 此前它确实散成三份：web 任务侧**根本没有**（行体不可点）、
   * web 习惯侧一个 `useState`、移动端任务侧另一个 `useState`。
   *
   * ⚠️ 返回的是**原始值**，所以不需要 `useShallow` —— 上面那段"引用稳定"
   * 的教训对它同样成立，只是它天然满足。
   */
  const selectedTaskId = useSelected('task');
  /**
   * 🔴 必须是 `useCallback` 而不是行内箭头：`TaskList` 把 `onOpenTask` 放进了
   * 行渲染的 `useMemo` 依赖里，每次渲染换新函数 = 整表所有行重建，
   * 而这一栏是要装常驻详情面的（W2），白重渲染的代价会从"看不见"变成"看得见地卡"。
   */
  const openTask = useCallback((taskId: string) => {
    selection.select('task', taskId);
  }, []);
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
      today: count({ kind: 'today' }),
      next7Days: count({ kind: 'next7Days' }),
      completed: count({ kind: 'completed' }),
    } as Record<'today' | 'next7Days' | 'completed', number>;
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
   * 组头折叠：**哪些组现在被收起**。
   *
   * 🔴 刻意**只在内存里**，不落盘、不进 op-log。组键就是日期
   * （`date-2026-10-01`），把"今天收起了"写进磁盘等于攒一堆**永远不会再命中**
   * 的键；而折叠是一屏的阅读偏好，不是一个用户意图（§3.4：op-log 装意图）。
   * 与「顺延」同理，它也**不跨设备**——两台设备各看各的。
   */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleGroupCollapsed = useCallback((key: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /**
   * 任务列表的**排序口径**（设备本地，见 `features/tasks/sort-pref.ts`）。
   *
   * 🔴 这里只存**选哪一档**，不存"怎么排"：判据全在领域的 `sortTasks`，
   * `TaskList` 把它透传给共享层。壳自己写一条比较函数就是第二套裁决标准
   * —— mobile 与 web 会排出两个不同的顺序（AGENTS §3.5）。
   */
  const [taskSort, setTaskSort] = useState<TaskSortKey>(loadTaskSort);
  const changeTaskSort = useCallback((next: TaskSortKey) => {
    setTaskSort(next);
    saveTaskSort(next);
  }, []);

  /**
   * 全局搜索浮层的查询词。
   *
   * 🔴 2026-10-01：入口**只剩 rail 上那个放大镜**（产品负责人：「搜索这个地方
   * 应该有左边那个侧边栏按钮就够了，不需要有另外的按钮了」）。顶栏那个输入框
   * 已删除 —— 它不是"多一个入口"，是**同屏两个都能打搜索词的框**，用户得先回答
   * "我该在哪个里打字"，而两个框的结果还不是一回事。
   *
   * ⚠️ mobile 任务页那个输入框**不是搜索**，是当前列表的筛选（词不进这个浮层），
   * 它复用 `web.shell.search.*` 那三条词条 —— 那些词条因此不是死词条，别删。
   */
  const [searchQuery, setSearchQuery] = useState('');

  /**
   * G-11：**首启必须问过用户**。
   *
   * 🔴 判据是"这台设备从没作过决定"，不是"今天第一次打开"：
   *   · 点过「同意」的人不该再被打扰；
   *   · 点过「只用本机」的人**也是作过决定**（那是一条完整的产品选择，不是"没决定"），
   *     所以同样不再弹 —— 他要改可以去设置页撤回；
   *   · 撤回之后状态被清回"没问过"，下一次冷启动会重新问 —— 这是 `revoke()` 的
   *     预期后果，不是 bug（PIPL 第 15 条要求撤回后还能重新给一次选择的机会）。
   *
   * ⚠️ 空依赖：每次挂载问一次。`StrictMode` 下 effect 跑两遍，但 `openSheet`
   *    只是把同一个 `open: true` 写进去，幂等，不会叠两层浮层。
   */
  useEffect(() => {
    if (shouldAskOnFirstLaunch()) usePrivacyStore.getState().openSheet('first-launch');
  }, []);

  /**
   * 落地页的「登录」带 `?signin` 进来时，**直接把认证面板打开**。
   *
   * 只在挂载时看一次：用户手动关掉面板之后地址还在，但"每次重渲染都抢回来"不是
   * 我们要的行为（刷新才重新打开，是可预期的）。消化点为什么在壳而不在 `AuthPanel`，
   * 理由写在 `lib/auth-deep-link.ts` 文件头。
   *
   * 🔴 但**不在首启隐私浮层还等着回答的时候叠上去**。两个模态同屏的样子是
   * "登录表单被一张卡片盖住一半"，读起来就是界面坏了（2026-10-03 线上截图实测到的
   * 正是这个，而它是我这次改动**新引入**的：以前那一层上面只有隐私面板）。
   * 判据用 `shouldAskOnFirstLaunch()` 而不是 store 里的 `open` —— 那一层是**上面那个
   * effect 在同一次提交的 effect 阶段**打开的，读状态的 hook 拿到的是渲染期的 `false`，
   * 于是"看着没开"而实际会开。深链的意图记住一次，等那一层落下再兑现。
   */
  useEffect(() => {
    if (!wantsSignInOnLoad()) return;
    if (!shouldAskOnFirstLaunch()) {
      useSyncStore.getState().openSignIn();
      return;
    }
    const unsubscribe = usePrivacyStore.subscribe((state) => {
      if (state.open) return;
      unsubscribe();
      useSyncStore.getState().openSignIn();
    });
    return () => {
      unsubscribe();
    };
  }, []);

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
  const [scrollToProfile, setScrollToProfile] = useState(false);
  /**
   * 从头像菜单点「编辑个人信息」进来时，**滚到个人信息那一节并聚焦昵称框**。
   *
   * 与 `scrollToHelp` 同一条纪律：必须等 `view` 真的变成 `settings` 之后再滚，
   * 否则设置那棵树还没渲染，`getElementById` 拿到 `null` 而 `?.` 会把这件事
   * **静默吞掉**（症状是"点了编辑个人信息，页面停在设置顶部"）。
   *
   * 🔴 焦点也要一起给：只滚不聚焦，键盘用户滚完了还得自己 Tab 十几下才回到
   * 输入框；而读屏用户根本不知道自己到了哪儿。
   */
  useEffect(() => {
    if (!scrollToProfile || view !== 'settings') return;
    document.getElementById('settings-profile')?.scrollIntoView({ block: 'start' });
    (document.querySelector<HTMLInputElement>('#profile-nickname') ?? undefined)?.focus();
    setScrollToProfile(false);
  }, [scrollToProfile, view]);
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
    // 🔴 `preventScroll`：还焦点 ≠ 还滚动位置。触发器（顶栏 composer / rail 按钮）住在
    // 列表**上方**，裸 `focus()` 会让浏览器把它滚进视野 —— 实测症状：从搜索里 ↵ 点开
    // 第 31 条（那一行确实被滚进来了），再按一次 ⌘K 关掉浮层，列表跳回顶部，
    // 刚导航到的位置被抹掉。两条出口都是"焦点回去、视图别动"，所以一起加。
    if (back?.isConnected === true) {
      back.focus({ preventScroll: true });
      return;
    }
    document
      .querySelector<HTMLElement>('[data-testid="account-menu-avatar"]')
      ?.focus({ preventScroll: true });
  }, [settingsBaseView]);

  /**
   * 打开次级浮层（设置 / 搜索）时：**记住触发器**；设置那边再把焦点送进浮层。
   *（对话框的键盘起点 —— 否则焦点留在被点掉的菜单项上，Tab 从页首开始。）
   *
   * 🔴 搜索**也**要记触发器：`closeSecondarySurface()` 是三种关法（Esc / 点 scrim /
   * ⌘K）唯一的出口，而它"把焦点还给谁"读的就是这里。以前这个 effect 只认
   * `settings`，于是从 rail 打开搜索、按 Esc 关掉之后焦点落到**头像**上 ——
   * 键盘用户下一次 Tab 要从头像重新开始数，而他刚点的是侧栏那个放大镜。
   * ⚠️ 搜索这边**不**调 `sheetRef`：那个 ref 属于设置 sheet，面板的输入框自带
   * `autoFocus`（点「搜索」就是要打字）。
   */
  useEffect(() => {
    if (view !== 'settings' && view !== 'search') return;
    // ⚠️ 别把 `<body>` 记成触发器：它永远 `isConnected`，于是"焦点还给触发器"
    //    会退化成"焦点什么都没发生"（且下一次 Tab 从页首开始）。
    // 🔴 也别把**浮层自己**记成触发器：搜索面板的输入框是 `autoFocus`，
    //    effect 跑在它之后 ⇒ 读到的就是它。它随浮层一起卸载，"还回去"等于还到
    //    一个已经不存在的节点上（实测焦点最后落在 `BODY`）。`goToView` 已经抢在
    //    `setView` 之前记了真正的触发器，这里只补"没经过 goToView 的那条路"
    //    （头像菜单里的「设置」直接 `setView`）。
    const active = document.activeElement;
    const insideSurface =
      active instanceof Element && active.closest('.ht-search-overlay, .ht-sheet') !== null;
    if (!insideSurface) {
      sheetReturnFocus.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
    }
    if (view === 'settings') sheetRef.current?.focus();
  }, [view]);
  /**
   * 内容区按它渲染：开着次级表面（设置/搜索）时仍是**下层那个视图**
   * （浮层之下"下层可见"，§11.5）。
   */
  const contentView = view === 'settings' || view === 'search' ? settingsBaseView : view;
  /**
   * 🔴 键盘光标绑的是**这一行的值**，不是 `view`：设置与搜索都是浮层/面板，
   * 底下那一栏还挂着（`settingsBaseView` 存在的理由）。绑 `view` 的话，
   * 打开设置面板会把光标从「任务」切走 —— 而用户看到的还是那一栏列表。
   */
  useSelectionKeyboardCursor(contentView);

  /**
   * 第二列（侧栏）在哪些视图出现。
   *
   * 🔴 原来的纪律是"**只有** `tasks` 有范围，其余视图不显示侧栏"。2026-09-30
   * 产品负责人给的日历参考图把它改了：日历**也是有范围的** —— 左边那一列就是
   * "这个月看得见哪些清单/标签"。所以判据回到它本来的说法：
   * **当前视图自己有没有范围**，而不是"只有任务视图"。
   *
   * ⚠️ 两个范围**不是同一种东西**，所以没有合成一份状态：
   * `tasks` 的范围是**单选**筛选（`store.filter`，点一下换一个视图内容），
   * `calendar` 的范围是**多选**勾选（`features/calendar/store` 的 `scope`，
   * 勾哪几个决定格子里有没有点）。把多选塞进 `TaskFilter` 会改动四个端共用的
   * 筛选契约，换来的只是"少一个文件"。
   */
  const withSidebar = view === 'tasks' || view === 'calendar';

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
   * 筛选真的变了，但当前视图根本不读它，标题也跟着 tab 显示成「习惯」。
   * 用户看到的是**点了没反应**。
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
   * 所以三件事一起做：① 选中它（W1 —— 行的高亮与详情面都读这一个值）；
   * ② 筛选切到「全部」（保证它在列表里）；
   * ③ 滚到那一行 —— 列表有几十行时"它在列表里"与"你看得见它"不是一回事。
   * ⚠️ 滚要在**下一帧**：这一帧 React 还没把新筛选下的行画出来。
   */
  const openTaskFromSearch = useCallback(
    (taskId: string) => {
      selection.select('task', taskId);
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
   * 右栏（`.ht-app__detail`）此刻**占不占位置**。
   *
   * 🔴 2026-10-04 产品负责人把 AI 面搬进这一栏：「把那个 AI 的功能移到右边那个区，
   * 就是最右边那一栏区……无状态的时候就可以默认显示 AI Chatbot」。
   * 搬过去就必须回答另一件事：**这一栏在窄屏是不出现的**（≤1023px，账算在
   * `styles/app/narrow.css`），直接搬等于让平板档与小窗用户的 AI 功能凭空消失。
   *
   * 所以这里不写 `min-width: 1024px` —— 那条规则的**真源是 CSS**，JS 里再抄一个
   * 数字就是一份会漂的抄件（改 CSS 的人不会被告知这里有一条，而它的表现是
   * "AI 面板在某档宽度上不见了"）。这里量的是那一列**实际有没有宽度**：
   * 有 ⇒ AI 面挂在右栏；没有 ⇒ 退回中间列。**功能一个都不少**是这条的判据。
   *
   * ⚠️ 这里原来写的是"跨这一步会重挂载面板，丢的只是正在飞的那一发请求，而拖窗口
   *    不是正常用户动作"。**那句话被实测否证了，两条都不成立**（2026-10-04）：
   *    ① 丢的不止请求 —— 一次性**出境披露**那个对话框连同用户已经打出来的草稿
   *      一起回到初始态，等于替用户悄悄取消了一次同意请求；
   *    ② 不需要人拖窗口就会跨这一步：`e2e/tests/ai-assistant.spec.ts` 里那张
   *      `fullPage` 截图会改视口，`resize` 监听因此来回各触发一次
   *      （现量：探针打出 `hasRoom=false` → 两次挂载 → `hasRoom=true` → 两次挂载）。
   *    ⇒ 重挂载本身保留（它是这条设计的代价），但**未决的那三样不再住在组件里**
   *      —— 见 `features/ai/panel-ephemeral.tsx`：两个 AI 面板各自的未决状态（草稿、等披露确认的那一句、
   *      阶段、结果卡）提到这里的 Provider，跨挂载点存活。
   *    试过并**否证**掉的两条：portal 把两个挂载点合成一份子树（换 portal 的容器
   *    同样重挂载，探针数到 4 次挂载）；模块级 ephemeral（同一进程里反复挂载的
   *    vitest 用例互相串状态 ⇒ 4 个套件 16 failed）。**Provider 是第三种**：
   *    状态由一次挂载拥有，不落在模块上。
   *    ⚠️ 一条**已知没修完**的边界：请求正在飞的时候跨断点，返回的那一句会随
   *    旧实例一起丢掉（`turn()` 仍在跑，但 `append` 落在已卸载的组件上）。
   *    症状从"悄悄取消一次同意"降级成"少了一条回答"，不是同一件事，登记在
   *    BLOCKED.md B79。
   */
  const detailRef = useRef<HTMLElement>(null);
  const [detailHasRoom, setDetailHasRoom] = useState(true);
  useEffect(() => {
    const sync = (): void => {
      setDetailHasRoom((detailRef.current?.getBoundingClientRect().width ?? 0) > 0);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('resize', sync);
    };
  }, []);
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
   * 详情列（右侧那一栏）的收起状态（工单 W4 ②③）。
   *
   * 🔴 它是**用户的选择**，与"这一栏今天画不画得出来"是两件事：后者由视口几何决定，
   * 断点在 `styles/app/narrow.css`（≤768 / 769–1023 / ≥1024 但高 < 480 三种都不出现）。
   * 两处不许合成一个布尔 —— 合成就等于把"这台屏幕放不下"说成"用户关掉了它"，
   * 于是窗口拉宽之后界面自己改了主意，而设置里那一项显示的是"收起"。
   *
   * 三条恢复路径各自独立成立：页头的开关、设置里这一项、⌘/Ctrl + Shift + \\。
   * 判据逐条各走一次（`e2e/tests/detail-pane-collapse.spec.ts`），
   * 因为"三条路径"最容易写成"其实只有同一个 onClick 调了三遍"。
   */
  const [detailPane, setDetailPaneState] = useState<DetailPanePref>(loadDetailPane);
  const setDetailPane = useCallback((value: DetailPanePref) => {
    setDetailPaneState(value);
    saveDetailPane(value);
  }, []);
  const toggleDetailPane = useCallback(() => {
    setDetailPane(detailPane === 'collapsed' ? 'open' : 'collapsed');
  }, [detailPane, setDetailPane]);

  /**
   * 详情列**此刻看得见吗** —— 几何（宽/高够不够）与"用户主动收起"两个输入一起算，
   * 规则与 `narrow.css` 那两条媒体规则同源（`features/shell/detail-pane-visible.ts`）。
   *
   * 🔴 面单往哪一栏放是**渲染时**的决定，不能只交给 CSS：CSS 在放不下时是 `display:none`，
   * 真按它放，窄屏/收起态下用户点一条便签会得到一枚藏在 `display:none` 里的编辑器 ——
   * 界面什么都不说，数据却已经进模型。所以看不见时编辑卡回到便签板上方。
   */
  const detailColumnShown = useDetailColumnShown(detailPane === 'collapsed');

  /**
   * 任务面单**此刻画在详情列里**的那个条件 —— 栏在画（几何 + 没被收起）且当前是任务那一族
   * 的视图（列表 / 四象限 / 时间线：同一批任务行、同一个 `'task'` 选中态）。
   *
   * 🔴 行尾那颗备注 chip 用的是**这同一个布尔的反向**，不是再算一遍条件：两处共用一枚变量，
   * "chip 没了而栏里也没有输入框"（= 任何档下都写不了备注）这一档就结构上不可能出现。
   * 工单 §8.138。
   */
  const taskPaneInColumn =
    detailColumnShown &&
    (contentView === 'tasks' || contentView === 'quadrant' || contentView === 'timeline');

  /**
   * ⌘/Ctrl + Shift + \\ 开合详情列 —— 三条恢复路径里的"快捷键"那一条。
   *
   * 值得为它加一个界面上没画出来的入口：键盘用户收起它的那一下就是想要"临时让列表变宽"，
   * 而把它叫回来要跑三次鼠标（页头 → 按钮 → 点）比收起它还麻烦 —— 那条不对称会让人
   * 干脆不去收。开关本身在页头与设置里都有名字，所以这不是"藏一个入口"。
   * ⚠️ 选 \\ 而不是字母：`Ctrl+Shift+D`（Chrome 书签管理器）、`Ctrl+Shift+K`
   * （Firefox 控制台）都被浏览器占着，字母组合在这两个浏览器里**根本到不了页面**。
   * 🔴 监听挂**捕获阶段**，理由与搜索浮层那条同（§7 #80：RNW 的输入框在 keydown 里
   *    无条件 `stopPropagation()`，焦点在输入框时冒泡阶段的监听永远收不到）。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || !(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key !== '\\') return;
      event.preventDefault();
      toggleDetailPane();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggleDetailPane]);

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
    /**
     * 🔴 总开关关着时**一个集合都不取**。
     *
     * `inferPreferences` 内部本来就有这道闸门（`memoryEnabled:false` ⇒ 空集），
     * 但实参在**调用点先求值**：`Object.values(store.entities.tasks)` 会把整张任务表
     * 物化成数组，`focusSessions` / `aiFeedback` / `preferenceCorrections` 同理。
     * 闸门在被调方里 ⇒ 关着的时候照样付全额的 O(全部实体)，付完立刻扔掉。
     *
     * 隐私语义也要求这一刀在**取数之前**：ADR-0014 的承诺是"关着就不推断",
     * 而不是"推断完不显示"。放在这里之后，关闭态连一次属性读取都不发生。
     */
    if (aiSettings.memoryEnabled !== true) {
      return {
        preferenceSet: emptyPreferenceSet(false),
        feedbackSet: emptyFeedbackPreferenceSet(false),
        rawPresentIds: [] as string[],
        corrections: [] as { id: string; preferenceId: string; kind: 'suppress'; deletedAt?: number }[],
        focusGaps: null,
      };
    }

    const offsets = { now: Date.now(), utcOffsetMinutes: -new Date().getTimezoneOffset() };

    /**
     * 🔴 「说的 vs 做的」落差 —— 记忆护城河第一次真正接到界面上。
     *
     * 只在**事件流已就绪**时计算：
     *   - `opWindow === null` 时传 `null`，面板据此说明"暂时算不出推迟次数"
     *     —— 绝不能退化成"推迟 0 次"（那是编造）。
     */
    const focusGaps =
      opWindow !== null
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

  /**
   * 选中态的**回落**（W1）：实体不在了就把选中丢掉，免得详情面继续显示一条
   * 已经不存在的东西 —— 那是界面在说谎。
   *
   * 🔴 判据是"**实体还在不在**"，**不是**"它在当前筛选下可不可见"。
   * 写成后者的话，用户从「今天」切到「收集箱」的那一刻，正在详情面里编辑的
   * 那条任务会被判定"不存在"、面板自己关掉。这条红线在 `app-host` 的
   * `selection.ts` 文件头，判据钉在 `packages/app-host/tests/selection.spec.ts`；
   * 本行只是它的**消费者**，所以这里连比较都不写，只把物化状态递进去。
   *
   * ⚠️ 软删除（进回收站）**算"不在了"**：详情面跟着关，恢复动作在回收站里做。
   */
  useEffect(() => {
    pruneSelectionFromEntities(store.entities);
  }, [store.entities]);

  // 主题应用到 <html data-theme>，tokens.css 的暗色覆盖挂在那里
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /**
   * 🔴 **同一套开关也要交给共享层**（`packages/ui` 的 RN 组件不吃 CSS 变量）。
   *
   * `tokens.css` 的暗色覆盖挂在 `<html data-theme>` 上，web 自己的界面因此是对的；
   * 但 `<HeytaUiProvider>` 不读那个属性 —— 它调 `useColorScheme()`，
   * 在 Web 上就是 `prefers-color-scheme`，也就是**操作系统的**配色。
   * 于是"应用选暗、系统亮"时日历卡片画成纯白（实测 25 个文字元素对比度 < 3:1），
   * 反过来"应用亮、系统暗"时它画成深夜蓝底 + 黑字。
   * 症状只出现在用共享组件的那几屏，所以看起来像"某个组件坏了"。
   *
   * 这里在**根上**解析一次并传下去，嵌套的 25 层 Provider 会继承它
   * （见 `packages/ui/src/theme.tsx`）。
   *
   * ⚠️ `reducedMotion` 刻意不传（取 `false`）：与改前逐层解析时的实际取值一致，
   * web 的动效偏好由 `tokens.css` 的 `@media (prefers-reduced-motion)` 负责；
   * 要让 RN 层也响应它，得单独接 `matchMedia` 并订阅变化，那是另一件事。
   */
  const uiTheme = useMemo(() => resolveHeytaUiTheme({ scheme: theme }), [theme]);

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
   * 所以里面不能调 hook。它们返回的是**组件元素**（`<TaskRowMeta/>`、
   * `<NoteEditor/>`…），那些组件自己的 hook 在自己的边界里跑，没问题。
   *
   * 🔴 元信息这一整条**已经不再是本文件手写的了**（原先这里是
   * `<span data-testid="task-meta">` + `<DueBadge/>` + `P{数字}`）：
   * 字形、顺序、逾期变红、无障碍退化全部在共享 `TaskBadges` 一份里，
   * 与移动端同一份源码。`task-meta` 这个**锚点**也跟着搬到了那边
   * （`TaskRowMeta` 把 `testID="task-meta"` 传进去），按它定位的判据不用改。
   */
  const renderTaskMeta = useCallback(
    (row: SharedTaskRow): React.ReactNode => (
      <TaskRowMeta row={row} mode={dueDisplay} now={store.now} />
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
        // 🔴 `flexWrap` 不是装饰：这一坨常驻控件在 1440 视口下要 517px（整行的 48%），
        // 视口到 900 时要 496px，而行的可用宽只有 548 —— 不换行就会把共享行的标题
        // 挤到 0 宽（实测"标题整条消失"）。配合 `TaskRow` 里 body 的百分比下限，
        // 窄窗口下行尾自己折行，标题与控件都还在。三档 A/B 见台账 G9。
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            alignContent: 'center',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            gap: 'var(--ht-space-2)',
          }}
        >
          {/* 备注。🔴 在它之前 Web 上**没有备注输入框** ——
              `Task.note` 与 `setNote` 都在，但唯一调用点是 AI 拆解与 AI 估时，
              于是"我自己能不能在任务上写点东西"的答案是"不能"。

              ⚠️ 工单 §8.138 之后它**只在详情列没在画时挂在这里**：栏里画着的时候正文输入框
              住在 `TaskDetailCard` 那一格，这里换成一枚**只读徽标**（`NoteBadge`）。
              理由是那道二选一的裁决要的不变量 —— 同一字段任何时刻只有一个编辑器所有者，
              两处都能改就会漂移成两套写入语义；而"扫一眼列表要能看出哪些任务写了东西"
              这一档不能因为搬进栏里就丢掉（第一趟看图照出来的正是这个）。
              窄档（栏不出现）时它退回这一格，所以"写不了备注"在任何档都不会发生。 */}
          {taskPaneInColumn ? (
            <NoteBadge task={task} />
          ) : (
            <NoteEditor
              task={task}
              onSetNote={(note) => {
                void store.setNote(task.id, note);
              }}
            />
          )}

          {/* 子任务。🔴 在它之前：`packages/domain/src/subtasks.ts`（616 行，
              建树 + 环防护 + 深度/子数上限）与 `app-host` 的 `setParent`
              **都已经写好**，但 Web 上一次调用点都没有 —— 于是
              "模型支持、树能建、用户没有任何办法造出一个子任务"，
              且**不报错**，只是这个功能不存在（方案 §5.5 的"看起来有其实没有"）。

              ⚠️ 工单 §8.144 起它**只在详情列没在画时挂在这里**：栏里画着的时候编辑本体
              （候选 + 原生 `<select>` + 拒绝提示）住在 `TaskDetailCard` 那一格，这里只剩一枚
              **只读徽标** `SubtaskBadge` —— 同一枚不变量（每个字段只有一个编辑器所有者），
              而"扫一眼要能看出哪条挂在谁下面"这一档不因搬进栏里就丢掉。
              🔴 这一格顺带改掉一条**写在别处的取数前提**：`e2e/tests/selection-projections.spec.ts`
              文件头那句"按标题找行不能用 `task-item-*`，因为行里常驻的 `subtask-select-*` 会把别的任务
              标题写进 `textContent`" —— 宽档下那只 `<select>` 不在行里了，窄档下仍在。
              那边的解法（用 `task-title-*`）两种档都对，所以不动它，只把这条变化记下来。 */}
          {taskPaneInColumn ? (
            <SubtaskBadge task={task} />
          ) : (
            <SubtaskPicker
              task={task}
              onSetParent={(parentId) => store.setParent(task.id, parentId)}
            />
          )}

          {/* 清单归属 + 标签。Web 端此前**根本没有入口** ——
              `moveToProject` 没有任何调用点、`tagIds` 全仓库零读写，
              于是侧栏里建出来的清单和标签一个也用不上。

              ⚠️ 工单 §8.147 起它**只在详情列没在画时整块挂在这里**：栏里画着的时候编辑本体
              （清单下拉 + 标签复选框）住在 `TaskDetailCard` 那一格。
              🔴 这一格留的是**只读 chip**（`TagChips`），不是截止那种"整块不画"：
              截止的显示另有其人（共享 `task-meta` 那一槽），而**标签在共享层没有对应槽**，
              行上这两枚 chip 就是它唯一的显示位 —— 撤掉会让列表里"看不出哪条挂了标签"，
              那是 §8.138 那条不变量明确不许的。归属的显示本来就在 `task-meta`，所以这里
              不重复画清单名（同一行说两遍）。窄档（栏不出现）时整块退回这一格，
              所以"归不了类"在任何一档都不会发生。 */}
          {taskPaneInColumn ? (
            <TagChips task={task} />
          ) : (
            <TaskOrganizer
              task={task}
              onMoveToProject={(projectId) => {
                void store.moveToProject(task.id, projectId);
              }}
              onSetTags={(tagIds) => {
                void store.setTags(task.id, tagIds);
              }}
            />
          )}

          {/* 重复。🔴 Web 此前**没有入口** —— 移动端早就能设，
              两端不一致；这一处补的正是 B2-3 的「Web 入口」那一半，
              并额外给了移动端也还没有的**自定义 RRULE**。

              ⚠️ 工单 §8.141 起它**只在详情列没在画时挂在这里**：栏里画着的时候编辑本体
              （预设单选 + 自定义 RRULE）住在 `TaskDetailCard` 那一格，这里只剩一枚
              **只读徽标** `RepeatChip`。理由与备注同一枚不变量 —— 同一字段任何时刻
              只有一个编辑器所有者；而"扫一眼列表要能看出哪些任务是重复的"不能因为
              搬进栏里就丢掉。窄档（栏不出现）时它整块退回这一格，所以"设不了重复"在任何档都不会发生。 */}
          {taskPaneInColumn ? (
            <RepeatChip task={task} now={store.now} />
          ) : (
            <TaskRepeat
              task={task}
              now={store.now}
              onSetRepeat={(rule) => {
                void store.setRepeat(task.id, rule);
              }}
            />
          )}

          {/* 截止。🔴 多端覆盖审计 P0-3：`setDueDate` 的语义早就完整，
              但 Web 上**没有任何调用点** —— 想给任务定"周五截止"没有直接入口
              （唯一沾边的是 AI 捕获，那是建任务时）。移动端早就能改；
              这里补上后两端共用同一只共享 `DatePicker`。

              ⚠️ 工单 §8.146 起它**只在详情列没在画时挂在这里**：栏里画着的时候编辑本体
              （共享 `DatePicker`：四个快捷项 + 月历 + 清除）住在 `TaskDetailCard` 那一格。
              🔴 这一格与前四格（备注 / 重复 / 子任务 / 提醒）**不同形**：这里**不补只读徽标**，
              宽档整块不画。理由不是省事 —— 截止的显示一直在共享行的元信息条上
              （`task-meta` → `TaskBadges.due`，`date` 档 `10-05` / `countdown` 档「明天」），
              而原先那颗 `<summary>` 也在写当前值（「截止 10月5日」），也就是同一行把同一件事实
              说了两遍。工单 §8.141 第 5 节那条硬约束（截止的**显示**必须留在行上）由 `task-meta`
              满足，撤掉第二份显示不会让它失效；真浏览器 T12 把这条钉成判据（设了截止 ⇒
              行上仍写着日期）。窄档（栏不出现）时 `DueEditor` 整块退回这一格，
              所以"改不了截止"在任何一档都不会发生。 */}
          {taskPaneInColumn ? null : (
            <DueEditor
              task={task}
              now={store.now}
              onSetDueDate={(due) => {
                void store.setDueDate(task.id, due);
              }}
            />
          )}

          {/* 提醒。🔴 在这一刀之前 `REMINDER` 有写路径、op 能同步，
              但 Web 上**没有任何入口能建它** —— 提醒面板补的就是这最后一米。
              状态与动作全在 `features/reminders/store.ts`（唯一一处
              `createReminderActions`），这里只把它挂在行的尾部插槽上。

              ⚠️ 工单 §8.145 起它**只在详情列没在画时挂在这里**：栏里画着的时候编辑本体
              （共享 `ReminderList` + 六个动作 + 错误提示）住在 `TaskDetailCard` 那一格，
              这里只剩一枚**只读徽标** `ReminderBadge`。同一枚不变量（每个字段只有一个编辑器所有者）。
              🔴 徽标与 `NoteBadge`/`RepeatChip` 有一处**刻意的不同**：零条提醒时它**不渲染**，
              而原来那颗 chip 在零条时显示「提醒」二字 = 入口。入口如今住在栏里那一格的区块头，
              把它留在行上就成了一份"两处都能开始编辑"（拍板 #8 的 `record` 档：徽标可隐藏）。
              窄档（栏不出现）时 `ReminderPanel` 整块退回这一格，那颗带文字的入口 chip 也一起回来，
              所以"建不了提醒"在任何一档都不会发生。 */}
          {taskPaneInColumn ? (
            <ReminderBadge task={task} />
          ) : (
            <ReminderPanel task={task} />
          )}

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
            <Trash2 size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>
      );
    },
    [aiSecrets, aiSettings, memory.preferenceSet, store, t, taskPaneInColumn],
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
    /**
     * 🔴 标题由**当前视图**裁决；`store.filter` 只在任务视图里才有发言权。
     *
     * 原来这里是一张**白名单**（`VIEW_TITLED_BY_TAB`：列出"标题跟视图走"的视图），
     * 不在表上的就回落到读 filter。而日历是后来才加进 `MODULE_VIEW_TABS` 的
     * 模块视图，**没登记进那张表** —— 于是"在收集箱点过「重要不紧急」→ 再点日历"，
     * 内容区切过去了，标题还写着上一个视图残留的 filter。用户看到的是
     * 「日历页的页头挂着象限名」，而侧栏在日历视图下已经换成日历自己的了，
     * **没有任何入口能把它切回去**。
     *
     * 白名单要人记得登记，而"记得登记"不是机制。默认反过来之后，新增视图
     * 天然由自己的 tab 标签命名 —— 漏登记这条路不存在了。
     */
    if (f.kind === 'quadrant' && (view === 'tasks' || view === 'quadrant')) {
      // 落在某个象限上就用**更具体的象限名**（「重要不紧急」比「四象限」有用）。
      const entry = QUADRANT_NAV.find(
        (n) => n.filter.kind === 'quadrant' && n.filter.quadrant === f.quadrant,
      );
      return entry === undefined ? t('web.shell.nav.quadrant') : t(entry.labelKey);
    }
    if (view === 'tasks') {
      if (f.kind === 'all') return t('web.shell.nav.inbox');
      if (f.kind === 'today') return t('web.shell.nav.today');
      // 「最近 7 天」的标题就是那一行侧栏的名字 —— 它是**一条智能清单**，
      // 不是"某个日期的任务"，所以标题不需要跟着具体日期变。
      if (f.kind === 'next7Days') return t('web.shell.nav.next7Days');
      if (f.kind === 'completed') return t('web.shell.nav.completed');
      if (f.kind === 'project') {
        // 清单名是**用户自己的字**，原样显示、不翻译。
        return projects.projects.find((p) => p.id === f.projectId)?.name ?? t('web.shell.nav.project');
      }
      if (f.kind === 'tag') {
        // 同理：标签名也是用户自己的字，原样显示。
        return projects.tags.find((tag) => tag.id === f.tagId)?.name ?? t('web.shell.nav.tag');
      }
    }
    // 其余视图（日历 / 习惯 / 番茄钟 / 时间线 / 成长 / 便签 / 搜索 / 回收站 / 设置）：
    // 标题跟**视图**走。这些视图里没有"任务筛选"这回事。
    //
    // 🔴 取的是 `labelKey` 再 `t(...)`，**不是**表里的中文本身 ——
    // 模块级常量里不能有句子（见 `NavEntry.labelKey` 的注释）。
    // `t` 与 `view` 都进依赖：语言变了标题必须跟着变，视图换了标题也得跟着换。
    // `projects.projects` 同理 —— 清单改名后标题不该还是旧名字。
    const tab = VIEW_TABS.find((v) => v.key === view);
    return tab === undefined ? t('web.shell.nav.tasks') : t(tab.labelKey);
  }, [store.filter, projects.projects, view, t]);

  /**
   * 快速捕获的**落点**：筛选真的停在某个清单时，新任务就留在那个清单。
   *
   * 🔴 这不是锦上添花。在这个面板停在「家庭装修」时按回车，任务以前**一定**
   * 落进收集箱 —— 于是它刚从眼前这条列表里消失，而界面从头到尾没说过这件事。
   * 用户能观察到的形态是"我加的任务不见了"，最难归因的那一类。
   *
   * `today` / `completed` / `quadrant` / `tag` 都回 `undefined`（= 收集箱）：
   * 它们是**查看方式**，不是**存放位置**，没有"落到今天"这种操作。
   * 清单名取不到（被删了）也回 `undefined` —— 宁可不带 `projectId`，
   * 也不要写进一条已经不存在的清单。
   */
  const captureDestination = useMemo(() => {
    const f = store.filter;
    if (f.kind !== 'project') return undefined;
    const name = projects.projects.find((p) => p.id === f.projectId)?.name;
    // 🔴 名字必须是**用户自己的字**，原样进占位符、不翻译（与 `title` 同源）。
    return name === undefined ? undefined : { projectId: f.projectId, name };
  }, [store.filter, projects.projects]);

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
   * rail 上段「去哪看」= **任务 + 已启用的模块**。
   *
   * 🔴 **任务永远在**（它是这个应用本身，不给关）；`settings` / `trash` 归下段工具。
   * 顺序沿用 `VIEW_TABS`（DOM 顺序的事实源）。
   *
   * ⚠️ 它声明在这里而不是下面的 rail 段：搜索浮层的「快速跳转」列的**就是这张表**
   * （见 `quickActions`），而 `const` 没有提升 —— 放后面会撞 TDZ。
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
   * 切到一个视图（rail 的 tab、搜索里的「快速跳转」共用）。
   *
   * 与 tab 自己的 `onClick` **逐字同形**：先清 `settingsFocus`，再切视图。
   * "用户自己导航 = 不做定位"这条规则只有一份，多一处就多一处漂移
   *（漏掉 `setSettingsFocus(undefined)` 的表现是：这次进设置页自己滚了一下）。
   */
  const goToView = useCallback(
    (key: ViewKey) => {
      // 🔴 "从哪儿来"必须**在 setView 之前**记。浮层一挂起来，面板输入框的 `autoFocus`
      // 就抢走焦点，等到 effect 再读 `activeElement` 读到的是**浮层自己** ——
      // 于是"焦点还回触发器"这条从来没成立过（2026-10-01 真浏览器量到：Esc 关掉搜索后
      // `document.activeElement` 是 `BODY`，而那个 effect 记下的触发器正要被卸载）。
      if (key === 'search' || key === 'settings') {
        const active = document.activeElement;
        sheetReturnFocus.current =
          active instanceof HTMLElement && active !== document.body ? active : null;
      }
      setSettingsFocus(undefined);
      setView(key);
    },
    [],
  );

  /**
   * 「快速跳转」的候选 = **rail 上真有的目的地 + 用户的清单与标签**。
   *
   * 🔴 从 `visibleMainTabs` 派生，**不是**从 `VIEW_TABS`：关掉的功能模块不在 rail 上，
   * 却能从搜索里跳过去，等于给用户一个"看不见、跳到了也找不到回来"的视图。
   * ⚠️ 「搜索」自己排掉 —— 人就在搜索浮层里，那是一条按下去什么都没发生的行。
   *
   * `keywords` 只给视图：本地化后的名字（「日历」）覆盖不到有人打 `calendar`，
   * 而 key 本来就是英文的视图标识。清单/标签的名字**是**用户起的，
   * 补任何通用词都会让"打一个词跳出十几条"，那是筛掉的结果又被捞回来。
   */
  const quickActions = useMemo<QuickAction[]>(
    () => [
      ...visibleMainTabs
        .filter((tab) => tab.key !== 'search')
        .map((tab) => ({
          id: `view:${tab.key}`,
          label: t(tab.labelKey),
          group: 'view' as const,
          hint: t('web.search.hint.view'),
          keywords: [tab.key],
          onSelect: () => goToView(tab.key),
        })),
      // 回收站也是 rail 上的目的地（贴底那段），跳过去和点它等价。
      // ⚠️ 读模块级的 `TOOL_VIEW_TABS` 而不是下面的 `visibleToolTabs`：那个 const
      //    声明在本 memo **之后**，读它会撞 TDZ。两者本来就是同一张表。
      ...TOOL_VIEW_TABS.map((tab) => ({
        id: `view:${tab.key}`,
        label: t(tab.labelKey),
        group: 'view' as const,
        hint: t('web.search.hint.view'),
        keywords: [tab.key],
        onSelect: () => goToView(tab.key),
      })),
      ...projects.projects.map((project) => ({
        id: `project:${project.id}`,
        label: project.name,
        group: 'project' as const,
        hint: t('web.search.hint.project'),
        // ⚠️ 这里的 `onSelect` 是**搜索面板自己的字段**（拾取这一条候选），和清单/标签那一格的
        // "选中"不是一回事：实参走 `goToFilter` ⇒ 容器从来不进选中宇宙（工单 §8.122 / C1 #14 A）。
        // rail 上那两行同动作的名字已改成 `onFilterWith`，这里没改是因为它属于 `QuickAction` 契约、
        // 视图项与回收站项也共用同一个字段名。**按 `onSelect` 形状扫选中消费方会把这两行读成已接**
        // （工单 §8.96 那条 grep 配方就是这类探针）—— 名册（`check-selection-single-source` 断言 I/D）
        // 认的是 `useSelected('…')` / `selection.select('…')`，所以它不会读错；人读的时候带这句。
        onSelect: () => goToFilter({ kind: 'project', projectId: project.id }),
      })),
      ...projects.tags.map((tag) => ({
        id: `tag:${tag.id}`,
        label: tag.name,
        group: 'tag' as const,
        hint: t('web.search.hint.tag'),
        onSelect: () => goToFilter({ kind: 'tag', tagId: tag.id }),
      })),
    ],
    [visibleMainTabs, projects.projects, projects.tags, t, goToView, goToFilter],
  );

  /**
   * 键盘光标指着结果里的第几条（{@link CURSOR_IN_INPUT} = 还在输入框里）。
   *
   * 🔴 它**只能住在宿主**，不能住进共享面板：RN 0.84.1 的 `TextInput` 类型上
   * 只有 `onKeyPress`、没有 `onKeyDown`，而 react-native-web 的 `TextInput`
   * 又在 keydown 里无条件 `stopPropagation()`（§7 第 80 条）——
   * "面板自己听键"这条路在两端都不成立。所以宿主听键、把光标传进去，
   * 而**怎么走**（越界、空结果不许有幽灵光标）是 `search/model.ts` 的纯函数。
   *
   * ⚠️ 它是**视图态**，不进 store、不进 op-log：换设备不该同步"我上次按了几次下箭头"。
   */
  const [searchCursor, setSearchCursor] = useState<number>(CURSOR_IN_INPUT);

  /**
   * 搜索结果 —— **两个域函数各管一半**，不在这里重写匹配逻辑。
   *
   * ⚠️ 输入被 `trim()`：`searchTasks` 对空查询返回"全部"，所以"还没输入"
   * 这个状态必须在**渲染层**判（见 `SearchPanel` 的 `prompt`），
   * 否则一打开浮层就会把整个库列出来。
   *
   * 🔴 「快速跳转」用的是**另一个**判据（`filterQuickActions`）：它能匹配清单名
   * 与标签名，而任务搜索**刻意不**匹配（`domain/search.ts` 文件头第 1 条）。
   * 这不矛盾 —— 那一半给出的替代说法就是"想按清单找就去点清单"，这一组是那个"点"。
   */
  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (q === '') return { tasks: [], notes: [], quick: [] as QuickAction[] };
    return {
      tasks: searchTasks(Object.values(store.entities.tasks), q),
      notes: searchNotes(allNotes, q),
      quick: filterQuickActions(quickActions, q),
    };
  }, [searchQuery, store.entities.tasks, allNotes, quickActions]);

  /**
   * 摊平成**有序**的一维结果 —— 键盘光标数的是这个数组的下标。
   *
   * 顺序（任务 → 便签 → 快速跳转）由共享的 `buildResultEntries` 定义，
   * 面板渲染分组用的是同一条，所以"高亮第 3 条"与"看得见第 3 条"不会分家。
   */
  const searchEntries = useMemo(() => buildResultEntries(searchResults), [searchResults]);

  /**
   * 光标当前指着哪一条。
   *
   * ⚠️ `?? null` 不是装饰：边打字边按方向键时结果会**变短**，光标下标可能越界。
   * 越界就当没有光标（回车什么都不做），下一支方向键会由 `moveCursor` 绕回 0。
   */
  const activeSearchEntry =
    searchCursor === CURSOR_IN_INPUT ? null : (searchEntries[searchCursor] ?? null);

  /** 搜索面板要的全部文案（共享层不许 `import '@heyta/i18n'`，所以由宿主注入）。 */
  const searchLabels = useMemo(
    () => ({
      title: t('web.search.title'),
      placeholder: t('web.search.placeholder'),
      tasksSection: t('web.search.tasksSection'),
      notesSection: t('web.search.notesSection'),
      quickSection: t('web.search.quickSection'),
      prompt: t('web.search.prompt'),
      noResults: t('web.search.noResults'),
      count: (n: number) => t('web.search.count', { count: n }),
      taskRow: {
        toggleOn: (row: { title: string }) => t('web.shell.tasks.complete', { title: row.title }),
        toggleOff: (row: { title: string }) => t('web.shell.tasks.uncomplete', { title: row.title }),
      },
      // 🔴 只有 web 传这一项：触屏端没有 esc / ↵，面板对没传的形态**不渲染**那排芯片。
      keyHints: {
        navigate: t('web.search.keys.navigate'),
        open: t('web.search.keys.open'),
        close: t('web.search.keys.close'),
      },
    }),
    [t],
  );

  /**
   * 输入变了：查询词与光标**一起**归位。
   *
   * 🔴 光标不能留在"第 5 条"上。结果集每敲一个字都换一批，旧下标多半指向
   * 另一条完全不同的行（或越界）—— 症状是"我改了个字，回车打开了一个我没选的东西"。
   */
  const onSearchQueryChange = useCallback((next: string) => {
    setSearchQuery(next);
    setSearchCursor(CURSOR_IN_INPUT);
  }, []);

  /**
   * 打开一条便签结果 = **选中它并进便签视图**（浮层挂在 `view` 上，切过去就自然关掉）。
   * 点与 ↵ 共用这一条，出口才不会漂成两份。
   *
   * 🔴 `noteId` 以前是**丢掉的**（回调签名不带参数，TS 不报错），于是"点了搜索结果
   * 里的便签"只换来一次视图切换 —— 与上面 `openTaskFromSearch` 那条 2026-09-30 修掉的
   * 缺陷同一个形状。选中态成为一等状态之后，这里必须把它写进去，
   * 便签面板才知道要打开哪一条。
   */
  const openNoteFromSearch = useCallback((noteId: string) => {
    selection.select('note', noteId);
    setSettingsFocus(undefined);
    setView('notes');
  }, []);

  /**
   * 打开光标所指的那一条 —— ↵ 与鼠标点**共用**这一条分派。
   *
   * 三类目的地的"打开"是三件事（任务是"跳到它并滚进视野"、便签是"进那一页"、
   * 跳转项是"跑它自己带的 `onSelect`"），但判据必须只有一个出处。
   */
  const openSearchEntry = useCallback(
    (entry: SearchResultEntry) => {
      if (entry.kind === 'task') {
        openTaskFromSearch(entry.id);
        return;
      }
      if (entry.kind === 'note') {
        openNoteFromSearch(entry.id);
        return;
      }
      // 跳转项的动作住在宿主给的 `quickActions` 里，这里只按 id 找回它。
      quickActions.find((action) => action.id === entry.id)?.onSelect();
    },
    [openTaskFromSearch, openNoteFromSearch, quickActions],
  );

  /**
   * 每次**打开**浮层把光标送回输入框。
   *
   * ⚠️ 上一次关浮层时光标可能停在第 3 行，而查询词关掉并不会清空 ——
   * 不归位的话按一次 ↓ 会跳到第 4 行，用户看到"光标凭空出现在中间"。
   */
  useEffect(() => {
    if (view === 'search') setSearchCursor(CURSOR_IN_INPUT);
  }, [view]);

  /**
   * 搜索浮层的键盘导航：↑↓ 在结果里走，↵ 打开光标那一条。
   *
   * 🔴 与 Esc 那条一样必须挂**捕获阶段**（§7 第 80 条）：焦点常态就在面板的
   * `TextInput` 里，而它在 keydown 上无条件 `stopPropagation()` ——
   * 挂在冒泡阶段的话这套快捷键**从来没被按通过**，而单测全绿。
   * ⚠️ 带修饰键的先让路：`⌘↑`／`⌥↓` 是系统的；`Shift+↑↓` 是输入框里选文字，
   *    不是走结果。抢过来的表现不是报错，是"快捷键坏了"。
   * ⚠️ 回车在**没有光标**时什么都不做（光标还在输入框里 = 用户想接着打字），
   *    所以这里读的是解析后的 `activeSearchEntry`，不是"有没有结果"。
   */
  useEffect(() => {
    if (view !== 'search') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (event.shiftKey) return;
        // 不拦的话页面会在浮层后面滚，看起来像"光标跳走了"。
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setSearchCursor((current) => moveCursor(current, searchEntries.length, delta));
        return;
      }
      if (event.key === 'Enter' && activeSearchEntry !== null) {
        openSearchEntry(activeSearchEntry);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view, searchEntries, activeSearchEntry, openSearchEntry]);

  /**
   * ⌘ / Ctrl+K 开合搜索。
   *
   * 值得为它加一个界面上没画出来的入口：这是键盘用户找"搜索"的第一反应
   *（macOS 聚焦、VS Code、Linear 都是这条），而 rail 上那个放大镜要先移动鼠标。
   * 🔴 监听**不挂在 `view === 'search'` 上** —— 它得能在任何视图里打开，
   *    也要能在浮层开着时把它关掉。关掉走 `closeSecondarySurface`，与 Esc
   *    同一个出口，"焦点还回触发器"这条行为才不会三条出口各一份。
   * ⚠️ 打开时**不**清空查询词：点 rail 那个放大镜也不会清，两条入口必须同形。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || !(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (view === 'search') {
        closeSecondarySurface();
        return;
      }
      goToView('search');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view, closeSecondarySurface, goToView]);

  /**
   * 把光标那一行滚进视野。
   *
   * 只能在宿主做：共享层不许碰 DOM（它要跑在 RN 上），而"按 8 次 ↓ 之后
   * 高亮行滚出面板"在四端是同一个问题。
   * 🔴 选择器必须限定在面板**里面**：搜索是浮层，下层视图仍在渲染，
   * 而面板里的任务行与列表里的用的是**同一个** `data-testid="task-item-<id>"` ——
   * 全局 `querySelector` 命中哪一个取决于 DOM 顺序，症状是"这边按方向键，
   * 后面那个列表在滚，光标那一行没动"。
   */
  useEffect(() => {
    if (view !== 'search' || activeSearchEntry === null) return;
    const testID =
      activeSearchEntry.kind === 'task'
        ? `task-item-${activeSearchEntry.id}`
        : `search-panel-${activeSearchEntry.kind}-${activeSearchEntry.id}`;
    document
      .querySelector<HTMLElement>('[data-testid="search-panel"]')
      ?.querySelector<HTMLElement>(`[data-testid="${testID}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [view, activeSearchEntry]);


  /**
   * 次级浮层的标准出口：**Esc 关掉，回到"从哪来"的那个视图**。
   *
   * 搜索与设置共用这一条 —— 它们同形态（`aria-modal=false` 的浮层、下层继续渲染），
   * 退出口也必须同形。🔴 搜索面板**没有 ✕**（2026-10-01 改成聚焦搜索形态时删掉了：
   * 那个位置放一个关闭按钮，与"这一行就是打字的地方"抢注意力），
   * 出口只有 Esc、点 scrim、⌘K 三条，全部走 `closeSecondarySurface`；
   * 设置这边由下面那个 `.ht-sheet__close` 提供。
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
   * rail 下段「工具」= **回收站**。**贴底**，不参与模块开关。
   *
   * ⚠️ 上段「去哪看」（`visibleMainTabs`）声明在**上面**的搜索段之前 ——
   * 「快速跳转」要列的就是 rail 上真有的那些目的地，而 `const` 没有提升，
   * 放在这里会让下面那个 `quickActions` 在初始化前被读到（TDZ 直接抛错）。
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


  /**
   * AI 面：**单步工具 + 对话助手**（原样两段接线，一处定义）。
   *
   * 🔴 2026-10-04 产品负责人把它们搬到最右那一栏（「把那个 AI 的功能移到右边那个区
   * …无状态的时候就可以默认显示 AI Chatbot」）。这一份 JSX 同时是右栏的内容与
   * 窄屏时的回退内容，所以**挂载点有两个、实现只有一个**。
   * 搬之前这里的注释写着「没有选中态时往槽里塞装饰」被主计划 §5.4 否决 ——
   * 那条现在由产品负责人推翻了，留痕在 `docs/plans/multi-end-unified-strategy.md`。
   *
   * ⚠️ `AiPrioritize` **不在这里**：它是批量的（「哪件事更重要」只在互相比较时成立），
   * 只能待在列表上方。
   */
  const aiPanels = (
    <>
      {/* AI 工具调用（功能 ⑤）。
          🔴 它不新增路由/页面：作为任务视图里的一个面板挂在**右栏**
          （≤1023px 右栏不出现时退回中间列 —— 见 `detailHasRoom`）。
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

      {/* 对话式助手（W12 / ADR-0045）。
          🔴 它的工具范围来自 `assistantTier`（设置里的**第二个授权前端**），
          **不是** `localApi.grants` —— 那张表管的是外部程序（MCP）能不能调工具。
          两档最后都汇到同一个 `isToolGranted()` 判据，授权仍只有一份。
          ⚠️ 与上面单步面板**并存**是刻意的：单步那条有"规则命中零出境"的短路，
          多轮循环还没有（缺口按编号登记在 `docs/plans/ai-assistant-closure.md` §7.2 第 4 条）。 */}
      {contentView === 'tasks' && (
        <AssistantPanel
          routing={aiSettings.routing}
          consents={aiSettings.consents}
          tier={aiSettings.assistantTier}
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
    </>
  );


  return (
    /*
      🔴 共享层的主题在**这里**交出去（唯一的 `value`）。

      下面各功能还各自包了一层 `<HeytaUiProvider>`（`check:ui-provider` 要求
      消费者在 Provider 子树之内），它们没有 `value` ⇒ 会**继承**这一层的值
      （见 `packages/ui/src/theme.tsx`）。所以宿主只需要在这里说一次。

      🔴 「去设置」的导航通道同理挂在下一层：四个 AI 面板里，捕获那个是
      `CaptureComposer` 渲染的，而那个文件不在本轮的写入白名单里。
      用 context 让**唯一的新接入点**留在 `App.tsx`（视图切换本来就在这里），
      而不是为一个导航参数去改别的功能。
    */
    <HeytaUiProvider value={uiTheme}>
      {/*
        🔴 助手面那份**未决状态**必须住在两个挂载点的**共同祖先**下，
        所以 Provider 只能开在这里（`panel-ephemeral.tsx` 文件头写了为什么：
        换挂载点=换子树=重挂载，而它不能让一次未决的出境披露跟着没）。
        挂在 `aiPanels` 那一份 JSX 里等于没有 —— 两份子树会各得一个 Provider 实例。
      */}
      <PanelEphemeralProvider>
      <AiSettingsNavigationContext.Provider value={openAiSettings}>
      <div
        className={`ht-app${withSidebar ? ' ht-app--with-sidebar' : ''}`}
        // 🔴 详情列的**用户选择**（不是几何判断）落在这里，CSS 按它把轨道归零 +
        // 不渲染那一列（`styles/app/base.css`）。两条各管一件事，见上面那段注释。
        data-detail={detailPane}
      >
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
        · **sidebar**：**只放"当前视图的范围"**，没有范围的视图不显示它。
          有范围的现在是两个：`tasks`（智能清单 / 按象限筛选 / 清单 / 标签）和
          `calendar`（迷你月历 + "看得见哪些清单/标签"的勾选）。
          🔴 后者是 2026-09-30 改的：这里原来写着"日历/四象限/习惯视图里 ②直接消失"，
          而产品负责人给的日历参考图左边**就有**这一列 —— 判据本来就是
          "这个视图有没有范围"，不是"只有任务视图有"。
        · **main**：标题 + 工具 + 内容。

        ⚠️ 四象限视图**仍然不显示 sidebar** —— 它的 2×2 网格自己就是完整语义。
      */}
      {/* `onPointerOver` / `onFocus` 在 React 里都会冒泡 ⇒ 挂在 nav 上就覆盖了
          全部 rail 按钮（视图 tab、工具、铃铛、帮助），不必给每个按钮加 props。
          见 `anchorRailLabel()`：它只写一个 CSS 自定义属性，不产生 state。 */}
      <nav
        className="ht-rail"
        aria-label={t('web.shell.nav.aria')}
        onPointerOver={anchorRailLabel}
        onFocus={anchorRailLabel}
      >
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
            // 「编辑个人信息」= 设置浮层里的**第一节**，所以它开的是同一个表面，
            // 只是额外要求"落在这一节"（见上面的 scrollToProfile）。
            // ⚠️ 未登录时**不出现**这一项（AccountMenu 内部按 showSignIn 过滤）：
            //    昵称与头像属于账号，没有账号就没有可写的那一行。
            onOpenProfile={() => {
              setSettingsFocus(undefined);
              setScrollToProfile(true);
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
          {/* 品牌名**不在这里了**：rail 收成纯图标（48px 内容宽放不下「heyta」），
              滴答的 rail 顶部也只有头像。品牌仍然出现在落地页、设置里的 AI 文案、
              系统通知标题与移动端欢迎页 —— 不要因为"界面里找不到名字"把它加回来。 */}
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
                /*
                  🔴 「任务」这一格**同时是收集箱的入口**（2026-10-04 产品负责人删掉了
                  侧栏里那行重复的「收集箱」，理由见 `PRIMARY_NAV` 文件头）。

                  ⚠️ 但它**不能无条件重置筛选** —— 那会推翻 R9（2026-10-02 同一位
                  产品负责人的实测："回到任务视图应当看到他离开时停着的那一格，
                  那是他的位置，不是垃圾"）。两条要求靠**点的时机**分开：
                  · 人在别的视图 ⇒ 这一格是"回我的任务视图"，位置保留；
                  · 人已经在任务视图 ⇒ 再点一次是明确的"回收集箱"手势
                   （与移动端点当前 tab 回到顶部同一类），这是删掉侧栏那一行之后
                    唯一回到收集箱的路径，判据在 `tests/app-mount.spec.tsx`。
                */
                if (v.key === 'tasks' && view === 'tasks') {
                  useTaskStore.getState().setFilter({ kind: 'all' });
                  return;
                }
                setView(v.key);
              }}
            >
              <v.Icon size={ICON_SIZE.sm} aria-hidden="true" />
              {/* 名字必须留在 DOM 里：它就是这个 tab 的 accessible name。
                  显示规则见 `app.css` 的 `.ht-rail__label`。 */}
              <span className="ht-rail__label ht-type-caption">{t(v.labelKey)}</span>
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
          {visibleToolTabs.map((v, i) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              className={`ht-rail__tab ht-rail__tab--tool${i === 0 ? ' ht-rail__tab--tool-start' : ''}${view === v.key ? ' ht-rail__tab--active' : ''}`}
              onClick={() => {
                setSettingsFocus(undefined);
                setView(v.key);
              }}
            >
              <v.Icon size={ICON_SIZE.sm} aria-hidden="true" />
              {/* 名字必须留在 DOM 里：它就是这个 tab 的 accessible name。
                  显示规则见 `app.css` 的 `.ht-rail__label`。 */}
              <span className="ht-rail__label ht-type-caption">{t(v.labelKey)}</span>
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
          <CircleHelp size={ICON_SIZE.sm} aria-hidden="true" />
          <span className="ht-rail__label ht-type-caption">{t('web.shell.nav.help')}</span>
        </button>

        {/*
          同步（工单 H9，2026-10-06 从页头搬下来）。**在「帮助」之后 = rail 最底下一组**，
          与滴答左下角那一枚同位。它自己是一枚 `<div>` 包着的两三个按钮，
          所以不会抢走 `.ht-rail__tab--tool:first-of-type { margin-top: auto }` 那条贴底规则
          （`SyncBar.tsx` 里写着为什么必须是 `<div>`）。
        */}
        <SyncBar />
      </nav>

      {/*
        sidebar **只在有范围的视图里出现**，而且每个视图渲染**自己那一列**：
        `tasks` = 智能清单 / 按象限筛选 / 清单 / 标签（单选筛选）；
        `calendar` = 迷你月历 + 显示范围（多选勾选，见 `features/calendar/CalendarSidebar`）。
        其余视图（四象限 / 习惯 / 时间线 / 便签 / 回收站 / 设置…）没有范围，主区吃满。
      */}
      {view === 'tasks' ? (
        <nav className="ht-sidebar" aria-label={t('web.shell.nav.scopeAria')}>
          {/*
            🔴 这一层 `.ht-sidebar__body` 是**这一列唯一的滚动区**，而右边缘那枚
            `SidebarResizer` **刻意留在它外面**（是 `<nav>` 的直接孩子）。
            理由两条都在 `sidebar.css` 的 `.ht-sidebar` 那条注释里写死了：
            ① 这一列必须有界，否则"新建清单"那个内联表单在面板外一次 pointerdown 上收起 52px 会缩短**整篇文档**，
               别的列就在指针底下跳走（实测把行尾整理触发器的第一下点击作废，BLOCKED.md B94）；
            ② 有界的方式不能是"在 `<nav>` 上写 `overflow-y: auto`" —— 那会连带把
               `overflow-x` 变成 `clip`，而把手的命中带有 4px 骑在右边缘之外，会被裁掉一半。
          */}
          <div className="ht-sidebar__body">
            <div className="ht-nav">
              {PRIMARY_NAV.map((entry) => (
                <NavButton
                  key={entry.labelKey}
                  entry={entry}
                  count={
                    entry.filter.kind === 'today'
                      ? navCounts.today
                      : entry.filter.kind === 'next7Days'
                        ? navCounts.next7Days
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
            <div className="ht-nav__section ht-type-group-label">{t('web.shell.nav.quadrantSection')}</div>
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
            <ProjectsPanel onFilterWith={goToFilter} />
          </div>
          {/* 右边缘的拖拽手柄（绝对定位在这一列上，不占布局）。 */}
          <SidebarResizer />
        </nav>
      ) : null}

      {/* 日历那一列自己带 `SidebarResizer`（同一份宽度状态，所以两端拖哪边都一样）。 */}
      {view === 'calendar' ? <CalendarSidebar /> : null}

      <main className="ht-main">
        <header className="ht-header">
          <h1 className="ht-header__title">{title}</h1>

          {/*
            🔴 2026-10-01：**这里原来有一个搜索输入框，已删**（产品负责人：
            "搜索这个地方有左边那个侧边栏按钮就够了，不需要有另外的按钮了"）。
            删的理由不是"少一个控件"，是同屏两个都能打搜索词的框要求用户先回答
            "我该在哪个里打字"，而两个框的结果还不是一回事（一个筛当前列表、
            一个搜全库）—— 那是把内部不一致摆到界面上。
            唯一入口现在是 rail 的「搜索」→ 下面的聚焦式浮层（`SearchPanel`）。

            ⚠️ 词条 `web.shell.search.*` **没跟着删**：mobile 任务页那个输入框
            （`apps/mobile/src/screens/TasksScreen.tsx`）还在用它们 —— 那是当前
            列表的筛选，不是这个搜索面。
          */}
          {/*
            🔴 视图切换**曾经在这里**（顶栏一行平铺 9 个 tab）。
            2026-09-29 挪进侧栏 —— 实测 1280px 下只能完全看见 5/8，现在有 9 个只会更挤。
            见 `VIEW_TAB_GROUPS` 上方的说明与 `dida-view-unification.md` §4.4。
            **不要把它搬回来。**
          */}
          <div className="ht-header__actions">
            {/*
              🔴 排序档位（2026-10-01，#10(d)）。位置按滴答参照图：**页头右端**
              （页头 = 标题 + 排序 + ⋯），不是列表上方另起一条 —— 列表上方那条
              会把第一组组头往下推，而组头本身就是这一列的分区标。

              带**可见的文字标签**，不是光秃秃一个下拉：页头上裸 chip 的教训还记在
              下面「显示偏好」那一段（2026-09-30 产品负责人："用户根本不知道它们
              是什么"）—— 说不清自己作用范围的控件，加了等于没加。

              选项来自领域的 `TASK_SORT_KEYS`（判据也在那里），这里只渲染、只转交选择；
              排序**不进 op-log**（§3.4：那是阅读偏好，不是一个用户意图），
              落盘走设备本地存储（`features/tasks/sort-pref.ts`），刷新后仍在、
              另一台设备各按各的。
            */}
            {contentView === 'tasks' && visible.length > 0 && (
              <label
                data-testid="task-sort"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: cssVar('space.2'),
                  fontSize: cssVar('font-size.xs'),
                  color: cssVar('color.foreground-muted'),
                }}
              >
                {t('web.shell.sort.aria')}
                <select
                  data-testid="task-sort-select"
                  aria-label={t('web.shell.sort.aria')}
                  value={taskSort}
                  onChange={(event) => {
                    changeTaskSort(event.target.value as TaskSortKey);
                  }}
                  style={{
                    // 🔴 原生 `<select>` 而不是自制下拉：与 `SubtaskPicker`、
                    // `TaskOrganizer` 一致，而且暗色下不用自己重画弹层。
                    minHeight: cssVar('touch-target.min'),
                    paddingInline: cssVar('space.2'),
                    borderRadius: cssVar('radius.md'),
                    borderWidth: cssVar('border-width.thin'),
                    borderStyle: 'solid',
                    borderColor: cssVar('color.border'),
                    background: cssVar('color.background'),
                    color: cssVar('color.foreground'),
                    fontSize: cssVar('font-size.sm'),
                  }}
                >
                  {TASK_SORT_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {t(SORT_LABEL[key])}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {/* 截止时间呈现方式开关。
                只在任务视图里有意义 —— 其他视图不显示截止时间。
                🔴 它是**开关**而不是固定行为：倒计时是待验证的 UI 假设，
                有开关才有对照组，也才能一键回退（见 DueBadge.tsx 文件头）。 */}
            {/*
              R11 批二：日历那一屏的顶部工具栏（`‹ 2026年10月 ›  今天`）。
              与上面那个任务排序下拉**同一个位置、同一个锚点**（`task-sort.spec.tsx`
              钉的就是"视图专属控件住在 header.ht-header 里"）。
              🔴 渲染的是共享层 `CalendarToolbar`（移动端把同一个组件画在月历卡片里，
              那边没有页头插槽），这里只提供摆位与状态。
            */}
            {view === 'calendar' ? (
              <CalendarHeaderToolbar
                // 🔴 与 `visibleMainTabs` 同一个来源，不是"再问一遍开关"：
                // 下拉里出现「时间线」而模块是关的 ⇒ 这条下拉就成了
                // 绕过功能模块开关的第二条入口（`contentView` 只看 `view`）。
                timelineEnabled={enabledModules.has('timeline')}
                onOpenTimeline={() => {
                  goToView('timeline');
                }}
              />
            ) : null}
            {/*
              🔴 工单 H9（2026-10-06）：`<SyncBar/>` **不在这里了** —— 它搬进 rail 底部
              （见下面 `rail-help` 之后那一行）。页头这一排原本平铺着
              状态 / 立即同步 / 同步设置 / 语言 / 详情开关 / 主题 六枚不相关控件，
              而"同步"在滴答里是左下角的东西。裁决与现量：
              `docs/plans/goal-layout-audit.md` §9.1 第 1 行。
              ⚠️ `ConflictDialog` 与两张首启面板**留在页头这一层**：它们是
              `position: fixed` + `z.modal` 的顶层浮层，挂在哪一个 flex 容器里都不影响
              渲染位置，而"同意之前不许发请求"必须在应用之上（G-11 / G-27 两段原注释）。
            */}
            <ConflictDialog />
            {/* G-11：首启隐私同意面板。与 `ConflictDialog` 同一处挂载 ——
                两者都是 `position: fixed` + `z.modal` 的顶层浮层，
                而"同意之前不许发请求"这件事必须在应用之上，不能在某个视图里面。 */}
            <PrivacyConsentSheet />
            {/* 🔴 G-27：账号级补签面板。挂在隐私面板**之后** —— 两道闸同时成立时，
                "这台设备还没被问过"是更前置的那句话，界面不许同时摆两个模态。 */}
            <LegalReconfirmSheet />
            {/* 语言切换。外壳顶栏的全局控件区，与主题切换并列 ——
                这是**真实用户唯一能把界面切到英文的入口**（见该文件的注释）。 */}
            <LanguageSwitcher />
            {/*
              详情列的开关（工单 W4 ②的第一条路径）。
              与主题按钮同一档位：**纯图标 + 自带可访问名**，名字说的是"点下去会怎样"
              （`web.shell.detailPane.{collapse,expand}`），所以文案随状态翻转而不是恒一个"详情"。
              🔴 它在几何不可行的三档视口里由 CSS 一起藏掉（`narrow.css`）：
              那一栏没地方画，还留一个按钮就是界面在说谎。
              `aria-pressed` 报的是"这一栏现在在不在"，与名字互为对照 ——
              读屏用户不需要看见图标就能知道自己刚按下会收还是会展。
            */}
            <button
              type="button"
              className="ht-btn ht-btn--ghost ht-app__detail-toggle"
              data-testid="detail-pane-toggle"
              aria-label={
                detailPane === 'collapsed'
                  ? t('web.shell.detailPane.expand')
                  : t('web.shell.detailPane.collapse')
              }
              aria-pressed={detailPane === 'open'}
              onClick={toggleDetailPane}
            >
              {detailPane === 'collapsed' ? (
                <PanelRightOpen size={ICON_SIZE.md} aria-hidden="true" />
              ) : (
                <PanelRightClose size={ICON_SIZE.md} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              // 主题按钮是纯图标，所以必须自带可访问名（AGENTS.md §5）。
              aria-label={
                theme === 'light'
                  ? t('common.a11y.toDarkTheme')
                  : t('common.a11y.toLightTheme')
              }
              onClick={() => {
                const next: Theme = theme === 'light' ? 'dark' : 'light';
                // 🔴 这是**唯一**记账的地方：启动时的那次 `applyTheme` 只改 DOM。
                // 否则"用户没做过选择"与"用户选了亮色"在存储里长得一模一样，
                // 系统偏好从此再也进不来（`lib/theme.ts` 里记着症状）。
                rememberThemeChoice(next);
                setTheme(next);
              }}
            >
              {theme === 'light' ? <Moon size={ICON_SIZE.md} /> : <Sun size={ICON_SIZE.md} />}
            </button>
          </div>
        </header>

        <div className="ht-content">
          {/**
           * 这里**曾经**是「今日进度」卡（`0/0 今天还没有安排`）。
           * 🔴 2026-10-01 产品负责人看图后拍板彻底删除，不是"再挪一次位置"——
           * 这是它第三次被要求缩小范围（09-29 常驻 → 09-30 只在任务视图 → 现在没有），
           * 前两次都留着它，所以这次要记清**为什么这次不是再挪一次**：
           * 对照滴答清单，"今天做了多少"这件事**从来不是一个占位的面板**，
           * 而是**分散在数字该待的三个位置**（侧栏每行的右侧计数 / 分组头的计数 /
           * 行右侧的元信息）。把它做成一张卡，等于把三个位置的信息压成一个
           * 谁都不看的分数，而且 0/0 时它说的还是"你什么都没安排"——
           * 一个每天开局都给人打 0 分的组件。数字的去处见
           * [`docs/plans/ui-review-fill-zh-timeline.md`](../../../docs/plans/ui-review-fill-zh-timeline.md) R6。
           *
           * ⚠️ 共享的 `TodayProgressCard` **没有删**：成长页（`GrowthView` →
           * `GrowthBoard` 的 `showToday` 段）仍然用它。那一页整页就是讲"尺度"，
           * 数字在那里是主内容而不是占位面板 —— 这条边界是刻意的，
           * 要一起删需要另一次拍板。
           */}
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
              destination={captureDestination}
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


          {/*
            AI 面（单步工具 + 对话助手）在**右栏没位置**时才退回这里（≤1023px）。
            两个挂载点共用下面 `aiPanels` 那一份 JSX —— 不抄第二份。
          */}
          {detailHasRoom ? null : aiPanels}

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
            /*
              🔴 空态**包在 `task-list` 这个锚点里**，而不是另起一个名字。
              这个 testID 判的是"任务视图渲染出了自己的那块面"，而空 inbox
              不是白屏 —— 它有自己的图标、标题和下一步动作。
              原先这一格由常驻的进度卡占着（`today-progress`），所以白屏检测
              拿它当锚点；卡删掉之后（R6），如果空态没有锚点，
              **空 inbox 会被判成白屏** —— 一个只在用户什么都没做时才红的假红。
            */
            <div data-testid="task-list">
              <EmptyState filter={store.filter} />
            </div>
          ) : dateGroups === undefined ? (
            <HeytaUiProvider>
              <TaskList
                tasks={visible}
                sort={taskSort}
                onOpenTask={openTask}
                activeTaskId={selectedTaskId}
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
                    留在 web 里 mobile 就得抄第二遍）。web 只留三件宿主事：
                    措辞（`taskGroupTitle`）、动作（逾期组的「顺延」按钮，
                    走既有 `.ht-btn--ghost`，不长新前缀族），以及**折叠状态
                    归谁**（`collapsedGroups`，见上）。
                    收起时**整条 `TaskList` 不进 DOM**，不是 `display:none`：
                    留在树里就等于读屏还得逐条念完看不见的那些任务。
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
                        collapse={{
                          collapsed: collapsedGroups.has(key),
                          onToggle: () => {
                            toggleGroupCollapsed(key);
                          },
                        }}
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
                      {!collapsedGroups.has(key) && (
                        <TaskList
                          tasks={group.tasks}
                          sort={taskSort}
                          onOpenTask={openTask}
                          activeTaskId={selectedTaskId}
                          onToggleTask={(taskId) => {
                            void store.toggleComplete(taskId);
                          }}
                          labels={taskRowLabels}
                          renderMeta={renderTaskMeta}
                          renderTrailing={renderTaskTrailing}
                          testID={`task-list-${key}`}
                        />
                      )}
                    </HeytaUiProvider>
                  </section>
                );
              })}
            </div>
          ))}

          {/*
            全局搜索（跨任务 + 便签 + 快速跳转）。🔴 它补的缺口是**便签从来没有搜索入口**。
            2026-10-01 起它同时是**唯一**搜索入口 —— 顶栏那个内联框已删：同屏放两个都能
            打字的框，等于把"两个框结果不是一回事"的内部不一致摆到界面上。

            形态借 macOS 聚焦搜索（Spotlight）：内容区上一层 scrim + **贴顶**的一张卡片
           （`.ht-search-overlay { align-items: flex-start }`，不是垂直居中 ——
            居中的话结果少时卡片悬在半屏中间，与"输入法"这个用途不符）。

            🔴 **它是浮层，不是一路由**：`view === 'search'` 时 `contentView` 仍是开搜索前
            的那个视图，**下层视图透出**（`aria-modal="false"` 说的就是这件事）。
            判据同设置 sheet：打开搜索时，下层视图的标记必须仍在 DOM 里。
            改成"替换内容区"就会让判据变红。
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
                onQueryChange={onSearchQueryChange}
                tasks={searchResults.tasks}
                notes={searchResults.notes}
                quick={searchResults.quick}
                activeEntry={activeSearchEntry}
                onToggleTask={(taskId) => {
                  void store.toggleComplete(taskId);
                }}
                onOpenTask={(taskId) => {
                  // 点与 ↵ 走同一条分派（见 `openSearchEntry`）：两条路各自实现"打开"，
                  // 迟早会出现"鼠标能打开、回车没反应"这类只在一边坏掉的缺陷。
                  openSearchEntry({ kind: 'task', id: taskId });
                }}
                onOpenNote={openNoteFromSearch}
                labels={searchLabels}
                testID="search-panel"
              />
            </HeytaUiProvider>
            </div>
          )}
          {contentView === 'calendar' && <CalendarView />}
          {/**
           * 四象限 = 同一批任务的另一种投影（共享 `QuadrantBoard` 每格直接渲染
           * 共享 `TaskList`）。🔴 所以**选中必须接同一个值**：在列表里选中一条再切过来，
           * 那一条要还是高亮的那一条 —— 各投影各留一份选中，就是各答一遍回落规则。
           */}
          {contentView === 'quadrant' && (
            <QuadrantBoard onOpenTask={openTask} activeTaskId={selectedTaskId} />
          )}
          {contentView === 'habits' && <HabitsView paneInColumn={detailColumnShown} />}
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
           * 🔴 `today` 取 `store.now` 推出的同一个本地日历日：窗口的周锚点与
           * 今天线都从它来。它只是**展示参数**，不落任何持久化字段。
           * 2026-10-01 重画：板上任务的三态位置来自 `dueDate`（`planTimelineRows`）。
           */}
          {contentView === 'timeline' && (
            <TimelinePanel
              tasks={visible}
              today={toLocalDate(store.now)}
              now={store.now}
              // 排期拖拽出口（P2）：板只算几何，写 op 在 store.setSchedule →
              // `TaskActions.setSchedule` → `dispatch()`（一次拖放 = 一条 op）。
              onScheduleTask={(taskId, change) => {
                void useTaskStore.getState().setSchedule(taskId, change);
              }}
              // 「点空白建任务带日期」：既有建任务 op **带上日期字段**，
              // 一次 CRT 完成、不 fan-out（goal §3.2 手势 4）。
              onCreateAt={(atMs) => {
                useTaskStore
                  .getState()
                  .addTask(t('web.board.untitledTask'), { startDate: atMs })
                  .catch((e) => console.error('DBG onCreateAt failed:', e));
              }}
              // 点行 = 选中，与列表/四象限同一个值（同一批任务的第三种投影）。
              // 触屏端早就接了，web 这边此前行体不可点 ⇒ 两端同一个界面两种能力。
              onOpenTask={openTask}
              activeTaskId={selectedTaskId}
            />
          )}
          {contentView === 'growth' && <GrowthView />}
          {/* 便签。🔴 `NotesView` 里自带一层 `HeytaUiProvider` ——
              上面 tasks 那棵树的 Provider 不覆盖兄弟节点（见该文件头）。 */}
          {contentView === 'notes' && <NotesView editorInColumn={detailColumnShown} />}
          {/* 倒数纪念日（W5）。与便签同一类：`CountdownView` 自带 `HeytaUiProvider`。 */}
          {contentView === 'countdown' && <CountdownView today={toLocalDate(store.now)} />}
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
              🔴 **个人信息**（R10，2026-10-03）放在设置浮层**第一段**。
              理由不是"它最重要"，是它的**触发路径**：头像菜单里那一项叫
              「编辑个人信息」，从那儿进来的人必须一屏就看到它，而不是先看到「显示」
              再往下翻 —— 六家竞品都是"头像 → 菜单 → 资料页"，而资料页第一屏就是
              昵称与头像（调研见 docs/plans/ui-review-fill-zh-timeline.md §8.2）。
              ⚠️ 外面那层 `<div id>` 只为"从菜单进来要落在这一节"这个滚动锚点存在；
              它不带 `ht-*` 前缀，因为 `check:row-single-source` 只许 `ht-*` 前缀族
              **下降**，新造一族（哪怕只包一层）是要被拒的。
            */}
            <div id="settings-profile" data-testid="profile-section-anchor">
              <ProfilePanel />
            </div>
            {/*
              🔴 **显示偏好**（2026-09-30 从任务页头搬进来）：「日期 | 倒计时」
              两个词悬在页头上，用户不知道它是什么、影响什么 —— 它其实是
              “任务行上的截止时间怎么显示”。显示偏好属于设置：带说明、带上下文。
              设备本地持久化（`due-display-pref.ts`），不进 op-log。
            */}
            <section className="ht-settings" data-testid="display-pref-panel">
              <h2 className="ht-settings__title ht-type-section-title">{t('web.settings.display.title')}</h2>
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
              {/*
                详情列的常驻/收起（工单 W4 ②的第二条路径）。
                🔴 与上面那组**同一个 section、同一条说明纪律**（2026-09-30 那条教训：
                页头上光秃秃的「日期 | 倒计时」没人知道是什么）。这里必须带一句
                说明，而且那句话要把"**什么时候这一项不起作用**"写进去 ——
                窗口太窄或太矮时这一栏由几何直接不出现，此时选"常驻"也画不出来；
                不写清这句，用户会把它当成一个坏掉的开关。
                ⚠️ 用 `radio` 而不是 `checkbox`：两个档是**互斥的词表**（`open`/`collapsed`），
                与设备本地存储里那两个值一一对应，不是一个布尔的两面。
              */}
              <p className="ht-settings__hint">{t('web.settings.display.detailNote')}</p>
              <div
                role="radiogroup"
                aria-label={t('web.settings.display.detail.title')}
                className="ht-settings__options"
                data-testid="detail-pane-pref"
              >
                {(
                  [
                    { key: 'open' as DetailPanePref, labelKey: 'web.settings.display.detail.modeOpen' },
                    {
                      key: 'collapsed' as DetailPanePref,
                      labelKey: 'web.settings.display.detail.modeCollapsed',
                    },
                  ] as const
                ).map((d) => (
                  <label key={d.key} className="ht-settings__option">
                    <input
                      type="radio"
                      name="detail-pane-pref"
                      checked={detailPane === d.key}
                      onChange={() => setDetailPane(d.key)}
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
              <X size={ICON_SIZE.sm} aria-hidden="true" />
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
              {/*
                🔴 **隐私同意排在 AI 出境开关之前**：那三道闸（总开关 / 允许远程 /
                逐功能授权）回答的是"哪一类数据可以出境"，而本面板回答的是
                "**这台设备准不准出门**" —— 后者是前者的前提，顺序反过来会让人
                在一个永远不可能生效的开关上花时间。
                它同时是 PIPL 第 15 条要求的**撤回入口**（同意只在首启弹一次）。
              */}
              <PrivacyPanel />
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
              {/*
                托管同步续费（临时方案：再下一单 = 在当前到期日之后叠 30 天）。
                它排在"数据进出"之后、"账号安全"之前：这一档买的是**服务**，
                不是登录方式 —— 与下面三块（通行密钥 / 密码 / 注销）不是一类东西。
                🔴 入口与支付渠道由 `check:payment-entry` 钉成同一件事：
                渠道没配时这里的请求会拿到 503，界面如实说"这台实例没配收款通道"。
              */}
              <RenewPanel />
              {/* 账号安全：管理自己的通行密钥（列 / 删）。见 PasskeyPanel 文件头。 */}
              <PasskeyPanel />
              {/* 账号安全：改登录密码（`/api/password/change` 的唯一界面入口）。 */}
              <PasswordPanel />
              {/*
                账号安全：注销账号（批次 E3）。服务端 `DELETE /api/account` 一直在，
                缺的是调用点 —— 而 E2 那条"收到注销信号就清本机"的反应也等在这里
                被主动触发一次，不然它只能靠下一次同步的回声。
                🔴 未登录时这个面板自己返回 null（没有令牌就没有"哪个账号"可注销）。
              */}
              <CloseAccountPanel />
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
      {/*
       * 🔴 详情列（工单 W2）：`.ht-app` 的**直接子项**，与 `<main>` 平级。
       *
       * 为什么必须是兄弟而不是 `.ht-content` 的后代：那一层带
       * `max-inline-size: var(--ht-layout-content-max)` + `margin-inline: auto`，
       * 挂在里面的列**永远贴不到窗口右边缘**，读起来就不是"三栏 + 右详情"而是
       * "中间一坨里再分两栏"。这条是 W2 的承重判据（`boundingBox` 右边缘相等），
       * 变异臂就是把这一列搬回 `.ht-content` 里面 —— 搬回去它必须转红。
       *
       * 这一栏按**视图**分派，一格一个所有者（自上而下）：
       *   · 专注 = **常驻**的"概览 + 记录"（工单 W7，与选中了哪条无关）
       *   · 便签 = 选中一条便签 ⇒ 同一格出编辑面（工单 §8.130）
       *   · 习惯 = 选中一条习惯 ⇒ 同一格出板子（§8.133；板子始终一枚是 `motivation.spec`
       *     白屏检测的前提，未选中时它说的是"选一条习惯…"，见 `HabitDetailCard` 文件头）
       *   · 任务 / 四象限 / 时间线 = 选中一条任务 ⇒ 同一格出面单（§8.138 起字段逐格搬进来）
       *   · 其余（含上述各面的未选中态）= AI 面 `aiPanels`
       *
       * ⚠️ 它**曾经**是空的，而且那是设计不是半成品：产品负责人当时的原话是
       * "即使没东西也空在那里，一旦选中任何东西右边就出详细的面单"，被主计划 §5.4
       * 否决的是"没有选中态时往槽里塞装饰"。🔴 2026-10-04 那句被同一个人推翻
       * （「右边那一栏……无状态的时候就可以默认显示 AI Chatbot」），2026-10-05 起
       * 便签/习惯/任务三面按的是**正条**：选中才换面单，不另开第三处。
       *
       * ⚠️ 窄屏（≤1023px）这一列不出现，规则与算过的账在 `styles/app/narrow.css`。
       * AI 面在那一档**退回中间列**（`{detailHasRoom ? null : aiPanels}`，见上面任务列末尾），
       * 不跟着这一栏一起消失；`detailHasRoom` 由挂在 `detailRef` 上的探针量出来，
       * ⇒ **那个 ref 是承重的**，不要因为它"只是个 aside"就摘掉。
       * 其余四面走 `detailColumnShown`（收起态/无位置时生产者自己不出）。
       *
       * ⚠️ 这一栏仍然**没有无障碍名**。"因为里面没内容"那句理由已经不成立（五面都在住），
       * 留着的是另一条：定名字就要新词条、中英必须成对，不在合流这一笔里顺手定。
       */}
      <aside
        ref={detailRef}
        className="ht-app__detail"
        data-testid="detail-column"
      >
        {contentView === 'focus' ? (
          <FocusDetailPane />
        ) : contentView === 'notes' && detailColumnShown ? (
          /* 那一栏本身没有内边距（`.ht-app__detail` 只有 `border-left`）：每一面自己给 inset。
             🔴 inset 是**递给生产者的必填参数**，不是在这里包一层 `<div>` ——
             `check:detail-pane-slot` 的腿 A 不许装配处手写 DOM 标记（它红过一次，实测）。 */
          <NoteEditorCard inset />
        ) : contentView === 'habits' && detailColumnShown ? (
          /* 习惯面单（工单 §8.133）：选中哪一条，这一格就是那一条的板子。
             没选中时它仍然挂载，说的是"选一条习惯…"（`paneEmptyText`）——
             板子始终一枚是 `motivation.spec` 白屏检测的前提，与落点无关。 */
          <HabitDetailCard inset />
        ) : taskPaneInColumn ? (
          /* 任务面单（工单 §8.138）：选中哪一条，这一格就是那一条的面单；没选中就不画
             （沿用便签那一支的先例，见 `TaskDetailCard` 文件头那一段"为什么没有空态"）。
             四象限与时间线走同一批任务行、同一个 `'task'` 选中态 ⇒ 三面共用这一支。
             🔴 备注编辑器的落点在**这一格**，所以行尾那颗备注 chip 在这一支成立时不渲染
             （`renderTaskTrailing` 里的 `noteInColumn`）—— 同一字段任何时刻只有一个所有者。 */
          <TaskDetailCard />
        ) : detailHasRoom ? (
          /* 兜底那一格是 AI 面（2026-10-04 拍板：无选中时默认显示 Chatbot）。
             🔴 它排在**最后**：上面四面任一成立时这一栏已被占，AI 面不叠第二处。 */
          aiPanels
        ) : null}
      </aside>
      </div>
      </AiSettingsNavigationContext.Provider>
      </PanelEphemeralProvider>
    </HeytaUiProvider>
  );
}
