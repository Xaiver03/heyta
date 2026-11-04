import { AssistantIcon } from './features/ai/AssistantIcon.js';
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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeft,
  ListChecks,
  MoreHorizontal,
  PanelLeft,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Sun,
  Users,
  X,
  CircleHelp,
  CreditCard,
  Bell,
  Palette,
  RefreshCw,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { buildTaskTree, searchNotes, searchTasks } from '@heyta/domain';
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
  renderPreferenceHints,
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
import { withManagedEndpoint } from '@heyta/ai';

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
import { UndoReceipt } from './lib/feedback/UndoReceipt.js';
import { restoreOrRefuse } from './lib/feedback/undo-receipt.js';
import { WebModalShell } from './lib/dialog/WebModalShell.js';
import {
  canonicalSettingsSection,
  settingsSectionOnLoad,
  settingsStandaloneOnLoad,
} from './lib/settings-deep-link.js';
import { type DueDisplayMode } from './lib/due-display.js';
import { TaskRowMeta } from './features/tasks/row-meta.js';
import { loadDueDisplay, saveDueDisplay } from './features/tasks/due-display-pref.js';
import { loadTaskSort, saveTaskSort } from './features/tasks/sort-pref.js';
import {
  loadDetailPane,
  saveDetailPane,
  type DetailPanePref,
} from './features/shell/detail-pane-pref.js';
import { TagChips } from './features/tasks/TaskOrganizer.js';
import { taskGroupKey, taskGroupTitle } from './features/tasks/date-groups.js';
import { RepeatChip } from './features/tasks/TaskRepeat.js';
import { NoteBadge } from './features/tasks/NoteEditor.js';
import { SubtaskBadge } from './features/tasks/SubtaskPicker.js';
// 行操作 UX 重设计（2026-11）：行尾不再挂「⋯ 更多」那一排编辑器，
// 行操作的主入口是**右键上下文菜单**（`TaskRowMenu`），可发现入口是**点行 → 详情**。
import { TaskRowMenu } from './features/tasks/TaskRowMenu.js';
import { CaptureComposer } from './features/capture/CaptureComposer.js';
import { useProjectStore } from './features/projects/store.js';
import { ConflictDialog } from './features/sync/ConflictDialog.js';
import { PrivacyConsentSheet } from './features/privacy/PrivacyConsentSheet.js';
import { LegalReconfirmSheet } from './features/legal-recheck/LegalReconfirmSheet.js';
import { shouldAskOnFirstLaunch, usePrivacyStore } from './features/privacy/store.js';
import { armFirstLaunchConsent } from './features/privacy/first-launch.js';
import { CalendarSidebar } from './features/calendar/CalendarSidebar.js';
import { useNarrowLayout } from './features/shell/useNarrowLayout.js';
import { ScopeDrawer } from './features/shell/ScopeDrawer.js';
import { useCalendarViewStore } from './features/calendar/store.js';
import { CalendarHeaderToolbar } from './features/calendar/CalendarHeaderToolbar.js';
import { CalendarView } from './features/calendar/CalendarView.js';
import { useNoteStore } from './features/notes/store.js';
import { ReminderNotifyPanel } from './features/reminders/ReminderNotifyPanel.js';
import { useReminderNotifications } from './features/reminders/use-reminder-notifications.js';
import { useShareActivitySignal } from './features/share/use-share-activity-signal.js';
import { useShareOpenPull } from './features/share/use-share-open-pull.js';
import { useShareRosterSignal } from './features/share/use-share-roster-signal.js';
import { RailNavigation } from './features/shell/RailNavigation.js';
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
import { DetailColumnResizer, SidebarResizer } from './features/shell/ColumnResizer.js';
import { useSyncStore } from './features/sync/store.js';
import { SubscriptionNotice } from './features/subscription/SubscriptionNotice.js';
import { TaskActionError } from './features/tasks/TaskActionError.js';
import { ShareSignatureNotice } from './features/share/ShareSignatureNotice.js';
import { RenewPanel } from './features/subscription/RenewPanel.js';
import { SubscriptionPanel } from './features/subscription/SubscriptionPanel.js';
import { ProjectsPanel } from './features/projects/ProjectsPanel.js';
import { moveBlockedForTask } from './features/share/share-move-guards.js';
import { ShareFeature } from './features/share/ShareFeature.js';
import { ShareNotificationSettings } from './features/share/ShareNotificationSettings.js';
import { loadProjectTaskSort, saveProjectTaskSort } from './features/projects/project-sort-pref.js';
import { QuadrantBoard } from './features/quadrant/QuadrantBoard.js';
import { HabitDetailCard } from './features/habits/HabitDetailCard.js';
import { HabitsView } from './features/habits/HabitsView.js';
import { GrowthView } from './features/motivation/GrowthView.js';
import { CountdownView } from './features/countdown/CountdownView.js';
import { NotesView } from './features/notes/NotesView.js';
import { NoteEditorCard } from './features/notes/NoteEditorCard.js';
import { TaskDetailCard } from './features/tasks/TaskDetailCard.js';
import { useDetailColumnShown } from './features/shell/detail-pane-visible.js';
import { AnchoredMenu, MenuItem, MenuSection, MenuSeparator } from './lib/menu/AnchoredMenu.js';
import { ReminderBadge } from './features/reminders/ReminderPanel.js';
import { TimelinePanel } from './features/timeline/TimelinePanel.js';
import { AiBreakdown } from './features/ai/AiBreakdown.js';
import { AiPrioritize } from './features/ai/AiPrioritize.js';
import { AiDuration } from './features/ai/AiDuration.js';
import { AssistantPanel } from './features/ai/AssistantPanel.js';
import { AiSettingsNavigationContext } from './features/ai/ai-settings-navigation.js';
import { PanelEphemeralProvider } from './features/ai/panel-ephemeral.js';
import type { SettingsTarget } from './features/ai/route-explanation.js';
import { AiSettings } from './features/settings/AiSettings.js';
import { HelpPanel } from './features/settings/HelpPanel.js';
import { MemoryPanel } from './features/settings/MemoryPanel.js';
// 通行密钥自助管理（列 / 删）—— 服务端早就有端点，此前界面没有任何入口。
import { PasskeyPanel } from './features/settings/PasskeyPanel.js';
// 登录设备（列 / 逐个撤销）—— 同一类缺口的另一半：撤销一台此前只有一档（全部作废）。
import { SessionsPanel } from './features/settings/SessionsPanel.js';
// 退出登录之后"服务端那一枚还没撤掉"那句实话的出口（与上面同一个 store）。
import { SignOutNotice } from './features/settings/SignOutNotice.js';
import { useSignOutStore } from './features/settings/signOutStore.js';
import { CloseAccountPanel } from './features/settings/CloseAccountPanel.js';
import { DataSettingsPanel } from './features/settings/DataSettingsPanel.js';
import { SettingsAccountGate } from './features/settings/SettingsAccountGate.js';
// 个人信息（R10）：昵称与头像的增删改查。入口在头像菜单的「编辑个人信息」，
// 面板本体开在设置浮层第一段 —— 它需要令牌，而令牌就住在同步设置里。
import { ProfilePanel } from './features/settings/ProfilePanel.js';
import { SettingsInfoTip } from './features/settings/SettingsInfoTip.js';
import { ProfileOverview } from './features/settings/ProfileOverview.js';
// 隐私同意的**撤回**入口（PIPL 第 15 条：撤回要比同意更容易做到）。
// 同意面板只在首启弹一次，之后用户要改只能从这里改 —— 没有它，一次点击就成了永久决定。
import { PrivacyPanel } from './features/settings/PrivacyPanel.js';
// 改登录密码 —— `/api/password/change` 与 `useAuthStore.changePassword` 都在，
// 缺的就是这张表（在此之前那条动作**全仓库零调用点**）。见 PasswordPanel 文件头。
import { PasswordPanel } from './features/settings/PasswordPanel.js';
// 从滴答清单导入（B2-1）—— 逻辑层早就做完了，这是它的界面入口。
import { WidgetJourneyPanel } from './features/settings/WidgetJourneyPanel.js';
import { WidgetPushPanel } from './features/settings/WidgetPushPanel.js';
import {
  createSessionSecretStore,
  loadAiSettings,
  saveAiSettings,
  toHealthSnapshot,
} from './features/settings/aiStore.js';
import { configureWebInboundDeps, startWebInboundWorker } from './features/settings/inbound-lifecycle.js';
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
  type ViewKey,
} from './features/shell/view-tabs.js';
import { NavButton } from './features/shell/NavButton.js';
import { EmptyState, isActive } from './features/shell/EmptyState.js';
import { SETTINGS_ANCHORS, type SettingsAnchor } from './features/shell/settings-anchors.js';
import { SyncSettingsPanel } from './features/sync/SyncSettingsPanel.js';
import { AdminConsolePage } from './features/admin/AdminConsolePage.js';
import { AnnouncementBanner } from './features/announcements/AnnouncementBanner.js';
import { isAdminConsoleLocation } from './features/admin/route.js';

/**
 * 设置左侧那一列：**每一项都带图标**（2026-10-25 产品负责人：
 * 「独立弹窗之后，可以给设置的每个菜单都加一个 Icon」）。
 *
 * 为什么图标不是装饰：这一列在独立窗口里是**唯一的导航**，而一列纯文字
 * 在 12–14px 字号下要逐条读才能定位；macOS 系统设置、微信、QQ 的设置窗
 * 都有图标，它们的作用是让"我想改外观"变成一次形状识别，而不是一次阅读。
 * ⚠️ 图标**不替代文字**：`aria-hidden` 只加在 svg 上，可访问名仍是 label。
 *
 * ## 🔴 七组，与移动端**同一套顺序、同一套词条**（2026-10 三端同构）
 *
 * 改前是八组，四条命名轴混用（按对象 / 按能力 / 按合规 / 按商业），外加一个
 * 无意义的桶：「任务与显示」里同时装着**主题 · 语言 · 日期显示方式**（"长什么样"）、
 * **七个功能模块开关**（"开哪些能力"）、**提醒**（"什么时候吵你"）和**桌面小组件**。
 * 用户每次进设置都要先猜"这个词是按什么分的"。
 *
 * 改后每组回答一句用户会说出口的话，与移动端 `SettingsSectionKey` 逐项对齐：
 *   账号（我是谁、谁能登录）/ 订阅 / 数据与同步（东西在哪、怎么带走）/
 *   提醒与通知（什么时候找我）/ 外观与语言（长什么样、怎么念）/
 *   功能与 AI（开哪些能力、AI 能拿数据做什么）/ 关于与帮助。
 *
 * 🔴 **`id` 一个都没改**（产品裁决，见
 * `docs/plans/settings-information-architecture.md` §5.1/§7）。分组从 8 变 7、
 * 显示名全部换掉，但 `settings-group-*` 这串字被落地页购买链接、桌面三壳的
 * 默认载荷与合法节清单、QA 装置、以及别人发出去的旧链接引用着。
 * ⇒ 内部 id 与显示名从此不一致（`settings-group-profile` 显示成「账号」），
 * 旧 id 由 `lib/settings-deep-link.ts` 的 `LEGACY_SETTINGS_SECTIONS` 折到新组。
 *
 * ⚠️ **词条借用 `mobile.settings.section.*`**：七组的**组名**是这次同构的产物，
 * 它属于"同一句话三端只写一份"那一类（本仓先例：`priority-display.ts` 的
 * `mobile.priority.*`，判据 `row-meta-shared.spec.tsx` 钉着两端同键）。
 * `packages/i18n` 是共享事实源、不归本端改，所以这里直接引用移动端那七条 ——
 * 抄七条 `web.*` 新词条出来才是第二份文案。
 */
const SETTINGS_NAV_ITEMS = [
  /* G1 账号：「个人资料」与「账号与安全」合并 —— 它们回答的是同一个问题
     （我是谁 / 谁能用这个账号登录），移动端也是这么并的（`profile`+`security` ⇒ `account`）。 */
  { id: 'settings-group-profile', labelKey: 'mobile.settings.section.account', icon: UserRound },
  /*
   * G2 订阅：「订阅」独立成节（2026-10-24 产品负责人："需要有单独的订阅界面"）。
   * 它排在账号之后、其余偏好之前：身份 → 付钱 → 用起来。原来它在「账号与安全」里，
   * 而那让"付钱"躲在"安全"底下，还和通行密钥、注销账号挤在同一列。
   */
  { id: 'settings-group-subscription', labelKey: 'mobile.settings.section.subscription', icon: CreditCard },
  /* G3 数据与同步：「数据管理」与「同步与隐私」合并 —— 我的东西在哪、怎么带走、删错了怎么办。
     保险库跟着这一组（它管"数据能不能出门"，不是"谁能登录"），与移动端 `sync`⇒`data` 同口径。 */
  { id: 'settings-group-data', labelKey: 'mobile.settings.section.data', icon: RefreshCw },
  /* G4 提醒与通知：**新开的一组**（拆掉「任务与显示」那个桶）。
     系统授权 + 提醒方式 + 打扰偏好 + 桌面小组件 —— 全是"它什么时候、用什么方式找我"。 */
  { id: 'settings-group-notifications', labelKey: 'mobile.settings.section.notifications', icon: Bell },
  /* G5 外观与语言：日期/倒计时显示、详情栏默认、语言、主题 —— 组名终于与内容一致。 */
  { id: 'settings-group-appearance', labelKey: 'mobile.settings.section.appearance', icon: Palette },
  /* G6 功能与 AI：功能模块开关（"这个应用长什么样"）+ AI 的三道闸与端点（"开哪些能力"）。 */
  { id: 'settings-group-ai', labelKey: 'mobile.settings.section.features', icon: Sparkles },
  /* G7 关于与帮助：帮助/更新/价格/反馈/备案号。 */
  { id: 'settings-group-help', labelKey: 'mobile.settings.section.about', icon: CircleHelp },
] as const satisfies readonly { id: string; labelKey: MessageKey; icon: LucideIcon }[];

type SettingsSectionId = (typeof SETTINGS_NAV_ITEMS)[number]['id'];

/**
 * 某个字符串是不是设置节的 id。
 *
 * 🔴 深链（`?settings=<id>`）进来的值**来自 URL**，不能直接断言成
 * `SettingsSectionId` —— 一个手打的地址或一条旧链接会带着认不出的 id 进来，
 * 而 `setSettingsSection('随便什么' as SettingsSectionId)` 骗得过编译器、骗不过界面：
 * 结果是**每一节都 hidden**（`activeSettingsSection` 不等于任何一节），
 * 用户看到一张空白设置页。所以这里显式收窄，认不出就落在默认节。
 */
function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_NAV_ITEMS.some((item) => item.id === value);
}

/**
 * 深链 id ⇒ **现行分组 id**，认不出就 `null`（= 不打开设置）。
 *
 * 🔴 两步而不是一步：先按 `LEGACY_SETTINGS_SECTIONS` 把旧 id 折到新组
 * （`settings-group-sync` ⇒ `settings-group-data` 之类），再走上面那个收窄。
 * 顺序反过来的话，折叠表里那些"合法但已不在左栏"的 id 会**先被判成认不出**，
 * 于是旧链接退回"点了没反应" —— 那正是这次迁移要保住的兼容性
 * （判据：`apps/web/tests/settings-deep-link.spec.tsx` 里旧 id 那一条）。
 *
 * 折叠表在 `lib/settings-deep-link.ts`（深链的唯一事实源），这里只做收窄 ——
 * 第二张表会长出第二套口径，而两套口径漂移的症状是"某一条链接静默失效"。
 */
function resolveSettingsSection(value: string): SettingsSectionId | null {
  const canonical = canonicalSettingsSection(value);
  return isSettingsSectionId(canonical) ? canonical : null;
}

/*
 * 🔴 2026-10-31：内容面**不再渲染节标题**。
 *
 * 左栏已经用 `aria-current="page"` 和主色底指出"你在哪一节"；内容面再写一遍
 * 同一个词（「个人资料」紧挨着「个人资料」）就是同一份信息架构画了两次，
 * 而两行同名字并排读起来像两个层级不同的东西（产品负责人实拍）。
 *
 * 节的可访问名改挂 `<section aria-label>`（文案仍来自 `SETTINGS_NAV_ITEMS`
 * 的同一个键，没有第二份文案）。原来挂在标题上的那句"这一页管什么"随标题一起
 * 下线：它只是对导航词的扩写，而解释本就不该常驻（禁令见
 * `docs/agents/design-system.md`）。
 */

function SettingsSectionNav({ active, onSelect }: {
  active: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  /**
   * 🔴 **一份规则，四条路共用**。窄屏这根导航是横向可滚的条，七项总宽远超可视窗口，
   * 所以"当前项要被带进视野"属于**当前项**，不属于**谁把它变成当前项**。
   *
   * 原先那行 `scrollIntoView` 挂在按钮自己的 `onClick` 上，于是从 rail「帮助」/
   * rail「个人信息」/ `openAiSettings` 这些锚点进来时**根本不经过它**：内容面已经换成
   * 那一节，导航却还停在最左边，`aria-current="page"` 那条选中态整个画在窗口外
   * （实测 375：当前项落在文档 x `631..737`，窗口只到 `x=315`）。
   *
   * 判据在 `apps/web/tests/settings-nav-reveal.spec.tsx`（先红后绿，记的是"滚的是谁"）。
   */
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active]);
  return (
    <nav ref={navRef} className="ht-settings__nav" aria-label={t('web.shell.views.settings')}>
      {SETTINGS_NAV_ITEMS.map((item) => (
        <button key={item.id} type="button" className="ht-settings__nav-link"
          aria-current={active === item.id ? 'page' : undefined}
          aria-controls={item.id} onClick={() => onSelect(item.id)}>
          {/* svg 对读屏隐藏：可访问名是 label 文字，图标只帮眼睛定位。 */}
          <item.icon size={ICON_SIZE.sm} aria-hidden="true" />
          <span>{t(item.labelKey)}</span>
        </button>
      ))}
    </nav>
  );
}

export function App(): React.JSX.Element {
  const { t, locale } = useI18n();
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
   * 窄档 / 栏被收起时那只「任务详情」对话框开着没有。
   *
   * 🔴 状态住在这里（而不是 `openTask` 旁边）：`openTask` 要读 `taskPaneWillShow`
   * 才能决定"选中就够"还是"还得开对话框"，而那一枚布尔在下面才定义得出来
   * （它依赖 `detailColumnShown` 与 `contentView`）。声明顺序跟着依赖走。
   */
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
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
  /** 账号组统一门槛：四个账号能力共享一个登录入口，避免未登录时重复渲染四张卡。 */
  const accountNeedsSignIn = useSyncStore(
    useShallow((s) => typeof s.token !== 'string' || s.token.trim() === ''),
  );
  /**
   * 同步服务器地址 —— **托管 AI 的端点从它派生**（不落盘，见 `withManagedEndpoint`）。
   * 与上面三条同一条纪律：`useShallow` 只订这一个字段。
   */
  const syncBaseUrl = useSyncStore(useShallow((s) => s.baseUrl));

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

  /**
   * 任务批量选择是一个短暂的视图态：不进 op-log、不跨设备同步。
   * 真正的批量写入由 app-host 生成一条 BATCH op，列表这里只负责选择与反馈。
   */
  const [bulkSelecting, setBulkSelecting] = useState(false);
  /**
   * 页头那枚 `⋯`（2026-11-02）。
   *
   * 🔴 它存在的理由是**减法**：在这之前页头平铺着 9 个可交互控件
   * （分享 / 选择任务 / 完成 / 重复警告 / 撤销 / 排序标签 / 排序下拉 / 助手 / 详情开关），
   * 而且排序那个还是 `12px 文字 + 44px 原生 select` 的混合体、空列表时整个消失。
   * 一个功能一个控件的界面，每加一个功能就必然更乱 —— 收进这一枚之后，
   * 页头右侧只剩「图标按钮 + ⋯」，加功能不再改变页头形状。
   */
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const taskMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const selectedHasRepeat = useMemo(
    () => [...selectedTaskIds].some((id) => store.entities.tasks[id]?.repeatRule !== undefined),
    [selectedTaskIds, store.entities.tasks],
  );
  const [bulkError, setBulkError] = useState<string | undefined>(undefined);
  /**
   * 删除之后那一条**可撤销回执**（全局 UX 线 P3）。
   *
   * 🔴 时长、能不能暂停、失败留不留 —— 都不在这一格，归 `@heyta/ui` 的
   * `receiptTimingOf()` 与 `UndoReceipt`。这里原来有一枚
   * `useEffect(() => window.setTimeout(…, 5000))` 配一个裸 `<button>`：
   * 5 秒、没有暂停、没有 `aria-live`，而且 `void action.run()` 把**撤销失败整个咽掉**。
   * 那枚 effect 已经删掉了 —— **不许再写回来**，写回来就是表外的第二份裁决。
   *
   * 一屏只留一格：新的动作覆盖旧的。这不丢承诺 —— 上一条删除的对象还在回收站里，
   * 从回收站照样能恢复；两条回执叠在页头那一行才是把布局挤给第二次错误。
   */
  const [undoAction, setUndoAction] = useState<
    { readonly label: string; readonly run: () => Promise<void> } | undefined
  >(undefined);
  /**
   * 共享清单对话框（ADR-0062 W4）：当前停在的清单 + 它的 share id（可空 = 还没共享，
   * 对话框会先走 PIPL 同意模态再创建）。关掉即卸载 —— 密钥状态不常驻内存。
   */
  const [shareDialog, setShareDialog] = useState<{ projectId: string; shareId?: string } | undefined>(undefined);

  useEffect(() => {
    const alive = new Set(
      Object.values(store.entities.tasks)
        .filter((task) => task.deletedAt === undefined)
        .map((task) => task.id),
    );
    setSelectedTaskIds((previous) => {
      const next = new Set([...previous].filter((id) => alive.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [store.entities.tasks]);

  const toggleBulkSelection = useCallback((taskId: string) => {
    setSelectedTaskIds((previous) => {
      const next = new Set(previous);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const clearBulkSelection = useCallback(() => {
    setSelectedTaskIds(new Set());
    setBulkSelecting(false);
    setBulkError(undefined);
  }, []);

  // 选择态是一个短暂的编辑模式。Esc 必须是全局可预测的退出路径，
  // 即使焦点当前在批量工具栏的 select 或按钮上也能收起它。
  useEffect(() => {
    if (!bulkSelecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      clearBulkSelection();
    };
    // Capture before react-native-web controls can consume the event. This keeps
    // Escape predictable even when focus sits inside the bulk toolbar.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [bulkSelecting, clearBulkSelection]);

  const runBulkAction = useCallback(
    async (kind: 'complete' | 'delete' | 'move', projectId?: string) => {
      const ids = [...selectedTaskIds];
      if (ids.length === 0) return;
      setBulkError(undefined);
      try {
        if (kind === 'complete') {
          await useTaskStore.getState().bulkSetCompleted(ids, true);
        } else if (kind === 'delete') {
          await useTaskStore.getState().bulkDeleteTask(ids);
          setUndoAction({
            // 🔴 正文自带条数（P3 判据 a）：`web.shell.bulk.undo` 那句"撤销本次批量操作"
            //    不告诉用户撤销的是哪一次、几条，而批量回执的全部意义就是那个数。
            label: t('web.feedback.undo.tasks', { count: ids.length }),
            run: () => useTaskStore.getState().bulkRestoreTask(ids),
          });
        } else {
          await useTaskStore.getState().bulkMoveToProject(ids, projectId);
        }
        clearBulkSelection();
      } catch (error) {
        setBulkError(error instanceof Error ? error.message : String(error));
      }
    },
    [clearBulkSelection, selectedTaskIds, t],
  );

  /**
   * 批量「换清单」的目的地可用性（ADR-0067 补二的**界面那一半**，判据在 app-host）。
   *
   * 🔴 只要选中的里面有一条撞门，这个目的地就整批灰掉：批量动作没有"半批成功"这种
   * 形状（点了之后一半成功一半抛错，等于悄悄丢一半），所以判据是 any 而不是 all。
   */
  const bulkMoveBlocked = (destination: string | undefined): boolean =>
    [...selectedTaskIds].some((taskId) => moveBlockedForTask(taskId, destination));
  const bulkMoveNowhere =
    bulkMoveBlocked(undefined) && projects.projects.every((project) => bulkMoveBlocked(project.id));

  /**
   * 设置浮层要**落在哪一节**（`help` / `profile` / `sync`），`undefined` = 不定位。
   *
   * 🔴 2026-10-06（H9 第 3 刀）把 `scrollToHelp`、`scrollToProfile` 两枚 boolean
   * 和新加的 `sync` 收成**一份**：那是同一条规则的三份拷贝（"切到设置之后滚到
   * 某一节，必须等 `view` 真的变了才滚"），第三份一旦写出来，前两份就会开始漂移。
   * 消费点见下面的 effect。
   */
  const [settingsAnchor, setSettingsAnchor] = useState<SettingsAnchor | undefined>(undefined);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('settings-group-appearance');
  /**
   * 🔴 落在哪一组由**锚点表**说了算（`SETTINGS_ANCHORS[...].section`），
   * 不再用 `` `settings-group-${settingsAnchor}` `` 拼。拼的写法依赖"锚点名 == 分组名后缀"
   * 这条隐含约定，而七组同构之后它已经不成立：「同步」的锚点落进「数据与同步」
   * （`settings-group-data`）。拼出来的 `settings-group-sync` 会是一个**合法但不在左栏里**
   * 的 id ⇒ 每一节都 `hidden` ⇒ 用户看到一张空白设置页，而 TS 一个字都不会说。
   * 类型上 `SettingsAnchorSection` 是 `SettingsSectionId` 的子集，所以表里写错就编译红。
   */
  const activeSettingsSection: SettingsSectionId = settingsAnchor
    ? SETTINGS_ANCHORS[settingsAnchor].section : settingsSection;
  /** 设置 surface 的内容模式；个人中心与设置共用同一层，不再各造一套浮层。 */
  const [secondaryAccountSurface, setSecondaryAccountSurface] = useState<'settings' | 'profile'>('settings');
  /** 从个人中心进入设置时，保留一条回到个人中心的路径。 */
  const [settingsReturnSurface, setSettingsReturnSurface] = useState<'profile' | undefined>(undefined);

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
  const [projectSortRevision, setProjectSortRevision] = useState(0);
  const projectSortId = store.filter.kind === 'project' ? store.filter.projectId : undefined;
  const effectiveTaskSort = useMemo(
    () => (projectSortId === undefined ? taskSort : loadProjectTaskSort(projectSortId) ?? taskSort),
    [projectSortId, projectSortRevision, taskSort],
  );
  const changeTaskSort = useCallback((next: TaskSortKey) => {
    const currentFilter = useTaskStore.getState().filter;
    if (currentFilter.kind === 'project') {
      saveProjectTaskSort(currentFilter.projectId, next);
      setProjectSortRevision((value) => value + 1);
    } else {
      setTaskSort(next);
      saveTaskSort(next);
    }
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
    // 判定与动作都在共享入口里：`/admin` 走独立启动路径（ADR-0078），
    // 它不经过 `App()`，但同样要问这一层。
    armFirstLaunchConsent();
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

  const [aiSettings, setAiSettings] = useState(loadAiSettings);
  /**
   * 🔴 **交给各 AI 面板的是"生效的那一份" routing，不是落盘那一份。**
   *
   * `mode === 'managed'` 时它会在**构造这一刻**把当前同步服务器合成成托管端点
   * （`withManagedEndpoint` 的文件头说了端点为什么不落盘：用户会换服务器）。
   * 五个面板全从这一个变量拿，所以托管端点只可能有一处被注入 ——
   * 漏掉一处不会报错，只会让那个面板在托管档上不走代理。
   *
   * ⚠️ 非托管档时它是**同一个引用**（`withManagedEndpoint` 原样返回），
   * 自备档逐字不受影响。
   */
  const aiRouting = useMemo(
    () => withManagedEndpoint(aiSettings.routing, syncBaseUrl),
    [aiSettings.routing, syncBaseUrl],
  );
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
  const [sheetExiting, setSheetExiting] = useState(false);
  const closeSecondarySurface = useCallback(() => {
    setSheetExiting(true);
  }, []);
  const finishSheetExit = useCallback(() => {
    setSheetExiting(false);
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
  }, [secondaryAccountSurface, view]);
  /**
   * 换一档 ⇒ 浮层回到顶部。**这条规则以前只挂在导航按钮的 `onSelect` 上**，
   * 而换档一共有四条路（点导航 / rail「帮助」/ rail「个人信息」/ 助手面板那颗
   * 「去授权」经 `openAiSettings`）—— 与上一条刚修的是**同一个族**。
   *
   * 🔴 可达性不是推测：助手浮层 `.ht-app__assistant-backdrop` 是
   * `--ht-z-overlay`(300)、面板本体 `--ht-z-modal`(400)，而设置浮层 `.ht-sheet`
   * 只有 `--ht-z-dropdown`(200) ⇒ **设置开着时，助手那颗按钮点得到**。于是"在设置里
   * 滚到长列表中间 → 从助手面板跳到 AI 档"会停在原地，新那一节的标题在屏幕上方外。
   *
   * ⚠️ **声明位置是承重的**：必须排在下面那条落位 effect **之前**。effect 按声明顺序跑，
   * 落位那条要的是 `scrollIntoView({block:'start'})` 到指定那一节；反过来写的话
   * "回顶部"会把刚定位好的位置抹掉（同一文件里 `sheetRef.current?.focus()` 那条
   * 抢焦点的事故就是这个形状，注释在上一条）。
   */
  useEffect(() => {
    document.querySelector('.ht-sheet')?.scrollTo({ top: 0 });
  }, [activeSettingsSection]);
  /**
   * 设置浮层落位：**等 `view` 真的变成 `settings` 之后**再滚、再聚焦，然后清掉请求。
   *
   * ⚠️ 必须在 `view` 真的变了之后再滚 —— 设置页那棵树还没渲染时
   * `getElementById` 拿到的是 `null`，而 `?.` 会把这件事**静默吞掉**，
   * 症状是"点了帮助，页面停在设置顶部"（原来 `scrollToHelp` 与 `scrollToProfile`
   * 两份拷贝都写过这条，2026-10-06 合成一份之后这条纪律只剩一处）。
   *
   * 🔴 焦点也要一起给（凡那一节有第一个该填的框）：只滚不聚焦，键盘用户滚完了
   * 还得自己 Tab 十几下才回到输入框，而读屏用户根本不知道自己到了哪儿。
   *
   * 🔴 **它必须声明在上一条之后** —— effect 按声明顺序跑，"把焦点给浮层容器"
   * 必须先跑、这一条后跑。反过来写的话容器会把焦点**抢回去**，聚焦就只剩注释了。
   * 2026-10-06 之前 `scrollToProfile` 正是声明在前的那一头：昵称框从来没拿到过
   * 焦点，而没有任何一条判据读过 `document.activeElement`，所以没人发现。
   * 现在这一条由 `settings-anchor-focus` 那组判据钉住（判据在
   * `apps/web/tests/settings-anchor-focus.spec.tsx`）。
   */
  useEffect(() => {
    if (settingsAnchor === undefined || view !== 'settings') return;
    const anchor = SETTINGS_ANCHORS[settingsAnchor];
    setSettingsSection(anchor.section);
    document.getElementById(anchor.id)?.scrollIntoView({ block: 'start' });
    if (anchor.focus !== undefined) {
      (document.querySelector<HTMLElement>(anchor.focus) ?? undefined)?.focus();
    }
    setSettingsAnchor(undefined);
  }, [secondaryAccountSurface, settingsAnchor, view]);
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
  const calendarSidebarOpen = useCalendarViewStore((state) => state.calendarSidebarOpen);
  const [scopeDrawerOpen, setScopeDrawerOpen] = useState(false);
  const narrowLayout = useNarrowLayout();
  // 三元只写这一次：出口文案因此能写成 `cond ? t('a') : t('b')`，
  // 而 `check:ui-language` 认的正是"键紧跟在 `t(` 后面"那一形。
  const calendarSidebarToggleOn = narrowLayout ? scopeDrawerOpen : calendarSidebarOpen;
  const withSidebar = view === 'tasks' || (view === 'calendar' && !narrowLayout && calendarSidebarOpen);

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
    setSecondaryAccountSurface('settings');
    setSettingsReturnSurface(undefined);
    setSettingsAnchor(undefined);
    setSettingsSection('settings-group-ai');
    setSettingsFocus(target);
    setView('settings');
  }, []);

  /**
   * 别人要求"去看同步设置"⇒ 开设置浮层并**落在同步那一节**。
   *
   * 🔴 为什么这个请求必须走壳：同步设置自 H9 第 3 刀起**不再是浮层**，它是
   * 设置浮层里的一节（`features/sync/SyncSettingsPanel.tsx`）。而"切到设置视图"
   * 是壳的状态，store 里的 `openSettings()` 够不着 —— 订阅提示那颗
   * 「改用你自己的服务器」就是这么到达它的。
   *
   * ⚠️ 请求**取到即清**（`closeSettings()`）：它是一次性请求，不是状态。
   * 不清的话，用户关掉设置再点第二次时 store 里仍是 `true` ⇒ React 看不到变化
   * ⇒ effect 不重跑 ⇒ 界面停在原地（"点了没反应"）。
   * 落在哪一节由 `settingsAnchor` 接力，所以清掉请求不会把滚动一起清掉。
   */
  const syncSettingsRequested = useSyncStore((s) => s.syncSettingsRequested);
  useEffect(() => {
    if (!syncSettingsRequested) return;
    setSecondaryAccountSurface('settings');
    setSettingsReturnSurface(undefined);
    setSettingsFocus(undefined);
    setView('settings');
    setSettingsAnchor('sync');
    useSyncStore.getState().closeSettings();
  }, [syncSettingsRequested]);

  /**
   * 深链：`?settings=<节 id>` ⇒ 打开设置并**落在那一节**（2026-10-24）。
   *
   * 为什么需要它：落地页付费两档要变成"能买"的入口，而落地页**不**该自己拉一份收银台
   * （AGENTS §3.5）。它能做的最诚实的事是把人送进应用里**已经存在**的那一节
   * （设置 → 订阅 → `RenewPanel` → `startCheckout`）。没有这条参数时，
   * 「立即购买」只能把人丢到任务列表让他自己找 —— 那不是购买按钮。
   *
   * 🔴 三条纪律：
   *   1. **只在挂载时跑一次**（`[]`），它不是状态、是一次性意图；跟着 URL 变化重跑
   *      会在用户手动切节之后又把他拽回去。
   *   2. **认不出的 id 不猜**：不打开设置，而不是把一整页 hidden 掉或猜一个默认组
   *      （见 `resolveSettingsSection`）。
   *   3. **旧 id 要折到新组**：七组同构之后 `settings-group-sync` / `-account` /
   *      `-general` 这些还在别人手里（旧链接、桌面壳、移动端口径的深链），
   *      折叠表在 `lib/settings-deep-link.ts` 的 `LEGACY_SETTINGS_SECTIONS`。
   * 参数名的唯一事实源在 `lib/settings-deep-link.ts`（落地页抄了一份字面量，判据钉着相等）。
   */
  /**
   * 这一页是不是"独立设置窗口"的载荷（`?settings=…&standalone=1`）。
   * 一次性读数，与上面那条 effect 同源：参数不是状态，跟着 URL 变重算没有意义。
   * 判据（`settings-deep-link.spec.tsx`）钉的是**只有带 settings 时**才认它。
   */
  const settingsStandalone = useMemo(
    () => settingsSectionOnLoad() !== null && settingsStandaloneOnLoad(),
    [],
  );

  useEffect(() => {
    const wanted = settingsSectionOnLoad();
    const section = wanted === null ? null : resolveSettingsSection(wanted);
    if (section === null) return;
    setSecondaryAccountSurface('settings');
    setSettingsReturnSurface(undefined);
    setSettingsFocus(undefined);
    setSettingsAnchor(undefined);
    setSettingsSection(section);
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
      setScopeDrawerOpen(false);
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
   * 自动收集那条 worker 循环挂在**应用级**，不挂在设置面板上。
   *
   * 🔴 原来它挂在 `InboundAutomationSettings` 的 effect 里，于是"离开设置视图 = 停止收集"，
   * 而用户理解的那句是"开着 heyta 就会收"。协议 §8 承诺的边界是前台执行 —— 前台指的是
   * 这个应用可见，不是某一屏正显示着。闸门（可见性、路由、Vault、出境同意）仍在循环里逐趟现读。
   */
  useEffect(() => {
    configureWebInboundDeps({ routing: aiSettings.routing, consents: aiSettings.consents, secretStore: aiSecrets });
  }, [aiSecrets, aiSettings]);
  useEffect(() => startWebInboundWorker(), []);

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
  // 🔴 `detailRef` 上只挂**一枚**探针：`detailHasContent`（下面那段，量"这一栏画没画出孩子"，
  // 驱动 `base.css` 的 `[data-detail-empty]`）。
  // 2026-10-04 起这里还挂过第二枚 `detailHasRoom`（量"这一栏实际有没有宽度"，回答
  // "AI 面挂哪一列"），第二刀把它删了，两个理由各自独立：
  //   ① 它与"空 ⇒ 轨道归零"**互相定义**（栏因为没内容而 0 宽，而"有没有内容"又取决于
  //     AI 挂哪），且只在 `resize` 时重测 ⇒ 首屏量到 0 就**粘住**：现量过一次"AI 配好
  //     之后两处都不渲染"（`ai-assistant.spec.ts` 当场红，DOM 里 `[data-testid^="ai-"]` 0 个）；
  //   ② 它替装配处量了一个本来就写得出的布尔 —— 落点是 `detailColumnShown`（几何 + 用户
  //     选择，与 `narrow.css` 同源）。旧版之所以不敢用它：分支链第 4 支 `taskPaneInColumn`
  //     在任务视图里**恒真**（`TaskDetailCard` 未选中时渲染空），AI 面从来走不到兜底那一支。
  //     第二刀给那一支补上"确实选中了一条任务"，这条才成立。
  // ⇒ 现在**挂不挂**由布尔决定、**画没画出来**由 DOM 量，两件事各有一处真源。
  const detailRef = useRef<HTMLElement>(null);
  /**
   * 详情列此刻**画没画出东西**。
   *
   * 🔴 产品负责人 2026-10-06 第 5 条：「数据侧边栏和那个侧边栏，哪有这么排版的？」
   * 指的就是这一栏。现量（出厂默认态，四道 AI 闸全关、没选中任何东西）：
   * 轨道 `64px 240px 624px 352px`、`aside.childElementCount === 0`、
   * `aside.textContent === ''` —— **右边那 352px 是一格零内容的轨道**。
   * 一条永远画着空白的列不是"留白"，是界面在说"这里有个东西"而那里什么都没有。
   * ⇒ 没有东西可画的时候，轨道归零（`base.css` 的 `[data-detail-empty]`），
   *   中间那一列把拿回来的宽度用掉；一旦有内容（选中任务 / 习惯面单 / AI 开着），
   *   它按 `--ht-detail-width` 回来。
   *
   * 🔴 **为什么是量 DOM，而不是把上面那条分支链再算一遍**：那条链有五个分支，
   * 在 JS 里重抄一次就是"同一个判断写两遍"—— 本仓为这个形状付过的账写在
   * `AGENTS.md` §3.5。这一栏自己知道它有没有孩子。
   *
   * ⚠️ 与 `detailColumnShown`（几何 + 用户选择）**不是**同一件事，也不许合成一个布尔：
   * 那条算的是"这一栏该不该出现"，这条量的是"这一格画没画出东西"。
   * 两者可以各真各假：宽窗口 + 无内容 ⇒ 该出现、没东西。
   *
   * ⚠️ 用 `useLayoutEffect` 而不是 `useEffect`：后者要等一帧才收，
   * 症状是"每次进应用，右边那道空白先亮一下再收"—— 那正是这条要消掉的东西。
   */
  const [detailHasContent, setDetailHasContent] = useState(true);
  useLayoutEffect(() => {
    const node = detailRef.current;
    if (node === null) return undefined;
    const sync = (): void => setDetailHasContent(node.childElementCount > 0);
    sync();
    // 面单是**异步**出现的（选中、切视图、AI 设置加载完），只看这一次会漏。
    const observer = new MutationObserver(sync);
    observer.observe(node, { childList: true });
    return () => {
      observer.disconnect();
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
  const [compactAssistantOpen, setCompactAssistantOpen] = useState(false);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const assistantWorkspace = assistantExpanded && view === 'tasks';
  const assistantOverlay = !assistantWorkspace && compactAssistantOpen && !detailColumnShown && contentView === 'tasks' && view !== 'settings';
  useEffect(() => {
    if (detailColumnShown || contentView !== 'tasks' || view === 'settings') setCompactAssistantOpen(false);
  }, [detailColumnShown, contentView, view]);
  useEffect(() => {
    if (!assistantOverlay) return;
    const pane = detailRef.current;
    const focusable = () => [...(pane?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, select, input:not([disabled]), a[href]') ?? [])].filter((el) => el.getClientRects().length > 0);
    const previous = document.activeElement;
    pane?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (usePrivacyStore.getState().open) return;
      if (event.key === 'Escape') { event.preventDefault(); setCompactAssistantOpen(false); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [assistantOverlay]);

  /**
   * 任务面单**此刻真的画在详情列里**的那个条件 —— 栏在画（几何 + 没被收起）、
   * 当前是任务那一族的视图（列表 / 四象限 / 时间线：同一批任务行、同一个 `'task'` 选中态），
   * 🔴 **并且确实选中了一条任务**。
   *
   * 第三半是 2026-10-06 第二刀补的。旧的两半让这一支在任务视图里**恒真**，而
   * `TaskDetailCard` 未选中时渲染**空** ⇒ 两件事同时发生：分支链第 5 支（AI 面）
   * 从来没有拿到过那一格（2026-10-04 那句拍板"落地了但从来没生效"，判据
   * `ai-row-layout.spec.ts` 一直红），而行尾的整理/备注触发器已经让位给了一个
   * **没在画东西的栏**（`calendar-sidebar` / `glass-materials` 等
   * `[data-testid="task-organize-summary"]` 超时 = B90 那 8 枚红的另一条侧）。
   *
   * 🔴 行尾那颗备注 chip 用的是**这同一个布尔的反向**，不是再算一遍条件：两处共用一枚变量，
   * "chip 没了而栏里也没有输入框"（= 任何档下都写不了备注）这一档就结构上不可能出现。
   * 工单 §8.138。这半**必须写在布尔里**而不是只写在装配处：只写装配处的话，
   * 未选中的宽档就是"行尾让了位、栏里没人接"，而钉这件事的正是
   * `apps/web/tests/task-detail-card.spec.tsx` 那条"同一枚布尔"的源码形状门禁。
   */
  // Only expose a pane control when this destination can actually render a pane.
  // Do not depend on detailColumnShown: a collapsed pane still needs its opener.
  const canToggleDetailPane = view !== 'settings' && (
    assistantWorkspace || ['tasks', 'focus', 'notes', 'habits'].includes(contentView) ||
    (selectedTaskId !== null && ['quadrant', 'timeline'].includes(contentView))
  );
  /**
   * 详情列**这一档会不会接住任务面单** —— 只看几何与视图族，不看"选中了没有"。
   *
   * 🔴 它与 `taskPaneInColumn` 拆开是为了让"选一条任务之后面单会不会出现"
   * **在选中之前就能回答**：右键菜单的「打开详情」要在选中之前决定
   * "落在详情列还是落在对话框"（选中之后再算就晚了一帧，用户看到的是一下闪动）。
   * 合成一个布尔必然要把 `selectedTaskId` 塞进去，于是又答不了这个问题。
   */
  const taskPaneWillShow =
    detailColumnShown && (contentView === 'tasks' || contentView === 'quadrant' || contentView === 'timeline');
  const taskPaneInColumn = taskPaneWillShow && selectedTaskId !== null;

  /**
   * 点一行 = **打开它**（行操作 UX 重设计之后这是界面上**唯一看得见**的入口，
   * 右键菜单只是它的加速键，见 `TaskRowMenu` 文件头）。
   *
   * 🔴 两档落点，同一只 `TaskDetailCard`：
   *   · 详情列这一档在（几何够 + 视图对）⇒ 选中即可，面单自己出现在右栏；
   *   · 否则（窄窗口 / 用户把栏收起了 / 日历这种没有栏的视图）⇒ 对话框。
   *
   * 🔴 第二档不是锦上添花：行尾那一排编辑器被撤掉之后，这里是那些字段
   * （截止 / 提醒 / 清单 / 标签 / 子任务 / 备注 / 优先级 / 重复 / AI）在窄档的**唯一**落点。
   * 少了它，窄窗口下"改截止"这个动作会**整个消失**，而且不报错。
   *
   * 🔴 必须是 `useCallback` 而不是行内箭头：`TaskList` 把 `onOpenTask` 放进了
   * 行渲染的 `useMemo` 依赖里，每次渲染换新函数 = 整表所有行重建，
   * 而这一栏是要装常驻详情面的（W2），白重渲染的代价会从"看不见"变成"看得见地卡"。
   */
  const openTask = useCallback(
    (taskId: string) => {
      selection.select('task', taskId);
      if (!taskPaneWillShow) setDetailDialogOpen(true);
    },
    [taskPaneWillShow],
  );

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

  const getDurationPreferenceHints = useCallback(
    () => renderPreferenceHints(memory.preferenceSet, 'duration-estimate')
      .map(({ id, text }) => ({ id, text })),
    [memory.preferenceSet],
  );

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
   * 行尾：**只有只读徽标，没有任何编辑器**（行操作 UX 重设计，2026-11）。
   *
   * ## 改之前是什么
   *
   * 行尾是一枚「⋯ 更多」的 `<details>`，展开后把九个控件摊成一行：
   * 备注 / 子任务 / 清单+标签 / 重复 / 截止 / 提醒 / AI 拆解 / AI 估时 / 删除。
   * 九个同级、无分组、无主次，"删除"与"重复"同一视觉重量。产品负责人的原话是
   * 「不需要有更多的三个点」，参照产品那一行只有**勾选 + 标题 + 一行淡元信息**。
   *
   * ## 现在
   *
   * | 东西 | 去哪 | 为什么 |
   * |---|---|---|
   * | 字段编辑器（备注 / 子任务 / 清单+标签 / 重复 / 截止 / 提醒 / 优先级） | `TaskDetailCard`（详情列，或窄档的对话框） | 每个字段只有一个编辑所有者；行上九个编辑器的第二个代价是行宽被吃光 |
   * | AI 拆解 / AI 估时 | `TaskDetailCard` 的「自动化」组（`automationSlot`） | 审计 §4.6 早就把这一组留给它们；顺带修掉"行尾常驻 517px" |
   * | 只读徽标（这几枚） | **留在这里** | §8.138 那条不变量：**扫一眼要能看出**哪些任务写过备注 / 是重复的 / 挂在谁下面 / 挂了几条提醒 / 打了什么标签。删掉就是功能倒退 |
   * | 完整的删除入口 | 右键菜单（`TaskRowMenu`） | 危险项不与日常项并列 |
   *
   * 🔴 **能力没有减少一条**：徽标是只读的，编辑器全在面单里，而面单在两档（详情列 /
   * 对话框）都可达 —— 判据 `apps/web/tests/task-row-menu.spec.tsx` 的 P3 钉的就是这件事。
   * 🔴 也不再把控件留在 web 侧手写整行：行的骨架、触控区、排序、无障碍 role/state
   * 仍然只有共享 `TaskList` 一份实现。
   */
  const renderTaskTrailing = useCallback(
    (row: SharedTaskRow): React.ReactNode => {
      const task = row.source;
      return (
        <span className="ht-row-badges" data-testid={`task-trailing-${task.id}`}>
          <NoteBadge task={task} />
          <SubtaskBadge task={task} />
          <TagChips task={task} />
          <RepeatChip task={task} now={store.now} />
          <ReminderBadge task={task} />
        </span>
      );
    },
    [store.now],
  );

  /**
   * 「自动化」组里属于宿主的那一格（AI 拆解 / AI 估时）。理由见
   * `TaskDetailCard` 的 `automationSlot` 注释：五组 AI 状态只住在 `App.tsx`，
   * 而面单有两个落点，所以传节点、不传状态。
   */
  const automationSlotNode = useMemo(() => {
    if (selectedTaskId === null) return null;
    const task = store.entities.tasks[selectedTaskId];
    if (task === undefined || task.deletedAt !== undefined) return null;
    return (
      <>
        {/* AI 拆解。配置关着时它仍然在 —— 点了会说明该去开什么，
            而不是消失（"找不到入口"和"入口说为什么不可用"是两件事）。 */}
        <AiBreakdown
          task={task}
          routing={aiRouting}
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
          routing={aiRouting}
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
      </>
    );
  }, [aiSecrets, aiSettings, memory.preferenceSet, selectedTaskId, store]);

  /**
   * 删一条任务 + 撤销回执（P3）。
   *
   * 🔴 任务**进回收站**（ADR-0048 四态里的 `deletedAt`），所以撤销是真的可执行
   * ⇒ 这一格必须给回执。原先它只写在行尾那枚删除按钮的 `onClick` 里；
   * 入口换成右键菜单之后**抽出来共用一份** —— 两个入口各写一遍回执，
   * 迟早一个有一句、一个没有（`check:undo-receipt` R2 钉的就是这档）。
   */
  const deleteTaskWithReceipt = useCallback(
    (taskId: string) => {
      const title = store.entities.tasks[taskId]?.title ?? '';
      void store.deleteTask(taskId).then(() => {
        setUndoAction({
          label: t('web.feedback.undo.task', { title }),
          run: async () => {
            // `restoreTask` 返回布尔而不是抛错：捞不回来（已被 purge）时
            // 必须变成**拒绝**，否则 `UndoReceipt` 会当成功把整条收掉 ——
            // 那正好把"失败不许静默"这条判据读反。规则住在 `restoreOrRefuse`，
            // 四处删除共用一份（各写一遍迟早分家）。
            await restoreOrRefuse(
              () => store.restoreTask(taskId),
              t('web.feedback.undo.refused', { title }),
            );
          },
        });
      });
    },
    [store, t],
  );

  /**
   * ── 行操作：右键上下文菜单（行操作 UX 重设计，2026-11）─────────────────
   *
   * ## 三条通路，一条判断
   *
   * | 通路 | 谁用 | 落地 |
   * |---|---|---|
   * | **右键** | 有鼠标的人 | 本文件的 `onContextMenu`（一个**委托**监听，挂在 `.ht-content` 上） |
   * | **键盘** | 没有鼠标的人 | `Shift+F10` / 菜单键 ⇒ 同一个处理函数（浏览器会替聚焦元素派发 `contextmenu`；个别引擎不派发，所以宿主另接了一条 `keydown`） |
   * | **点行 → 详情** | 所有人（**可发现的那一条**） | `openTask` 已有行为；窄档由下面的对话框接住 |
   *
   * 🔴 **为什么用委托，而不是在 `TaskRow` 上加一个 `onContextMenu` 属性**：
   * `packages/ui` 的 `TaskRow` 是四个端共用的一份，而"右键"是 **web 独有的输入方式**
   * （RN 上没有这个事件）⇒ 它属于 `apps/*` 的平台差异层（AGENTS §3.5）。
   * 委托还顺带解决了一件事：列表在页面上有两个渲染面（平铺 / 按日期分组），
   * 一个监听覆盖两处，不会出现"分组那一面忘了接"。
   *
   * 🔴 **右键不做任何选中**：它只开菜单。改选中会让右侧详情列跳走，
   * 而用户可能只是想删掉那条、继续看原来那条。
   */
  const [rowMenu, setRowMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);

  /** 从任一后代元素回溯到"这是哪一行"（`task-item-<id>` 是共享行唯一的稳定 handle）。 */
  const taskIdFromEventTarget = (target: EventTarget | null): { taskId: string; row: HTMLElement } | null => {
    if (!(target instanceof Element)) return null;
    const row = target.closest('[data-testid^="task-item-"]');
    if (!(row instanceof HTMLElement)) return null;
    const testId = row.getAttribute('data-testid') ?? '';
    const taskId = testId.slice('task-item-'.length);
    return taskId === '' ? null : { taskId, row };
  };

  const openRowMenuFromRow = useCallback((taskId: string, row: HTMLElement, x?: number, y?: number) => {
    const rect = row.getBoundingClientRect();
    /*
     * 没有指针坐标（键盘那条通路）⇒ 落在这一行的**左下角**：
     * 菜单从行的位置长出来，读者仍然知道"这是哪一条的菜单"。
     */
    setRowMenu({ taskId, x: x ?? rect.left, y: y ?? rect.bottom });
  }, []);

  const handleTaskContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const hit = taskIdFromEventTarget(event.target);
      if (hit === null) return;
      event.preventDefault();
      // ⚠️ 键盘派发的合成 `contextmenu` 坐标恒为 (0,0)：那不是"左上角"，
      //    而是"没有坐标"。按 0 处理会把菜单画到屏幕角上 —— 分离这两档。
      const hasPointer = event.clientX !== 0 || event.clientY !== 0;
      openRowMenuFromRow(hit.taskId, hit.row, hasPointer ? event.clientX : undefined, hasPointer ? event.clientY : undefined);
    },
    [openRowMenuFromRow],
  );

  const handleTaskRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // `ContextMenu` 是键盘上那枚菜单键；`Shift+F10` 是 Windows/Linux 的等价键。
      const wantsMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
      if (!wantsMenu) return;
      const hit = taskIdFromEventTarget(event.target);
      if (hit === null) return;
      event.preventDefault();
      openRowMenuFromRow(hit.taskId, hit.row);
    },
    [openRowMenuFromRow],
  );

  /**
   * 关菜单 + **把焦点还给那一行**。
   *
   * 🔴 不还焦点 = 键盘用户打开一次菜单之后，焦点落在 `body` 上，接下来
   * ↑↓ 不动、Tab 从头开始。`WebModalShell` 那一族由共享壳负责归还原位，
   * 菜单不是模态、壳不管这一格，所以由宿主补。
   */
  const closeRowMenu = useCallback(() => {
    const taskId = rowMenu?.taskId;
    setRowMenu(null);
    if (taskId === undefined) return;
    document
      .querySelector<HTMLElement>(`[data-testid="task-item-${taskId}"] [data-testid="task-row-${taskId}"]`)
      ?.focus();
  }, [rowMenu]);

  // 栏回来了 / 换了视图 ⇒ 对话框自动退场，不留下两个都在画的同一张面单。
  useEffect(() => {
    if (taskPaneWillShow || selectedTaskId === null) setDetailDialogOpen(false);
  }, [taskPaneWillShow, selectedTaskId]);

  /** 菜单上那一条任务（有的数据层面已被删掉 ⇒ 菜单自己收走）。 */
  const rowMenuTask = rowMenu === null ? undefined : store.entities.tasks[rowMenu.taskId];
  useEffect(() => {
    if (rowMenu !== null && rowMenuTask === undefined) setRowMenu(null);
  }, [rowMenu, rowMenuTask]);

  /**
   * 直接子任务数 —— 危险档位的 `collateralImpact`。
   *
   * 🔴 口径来自领域层，不在宿主里数：删除只给**父任务**写墓碑，而
   * `buildTaskTree` 会把"父已删除"的子任务**提到顶层**（那是它文件头里
   * `promotedFromDeletedParent` 那条读时安全网）。所以"带子任务还删"的后果是
   * "子任务跑到顶层"，不是"子任务一起没了" —— 那句后果文案与这个数同源。
   */
  const rowMenuChildCount = useMemo(() => {
    if (rowMenu === null) return 0;
    const tree = buildTaskTree(Object.values(store.entities.tasks));
    return tree.nodeById.get(rowMenu.taskId)?.children.length ?? 0;
  }, [rowMenu, store.entities.tasks]);

  /** 行级无障碍文案。**每一项都是一整句**，不要用前缀拼标题。 */
  const taskRowLabels = useMemo(
    () => ({
      toggleOn: (row: SharedTaskRow) => t('web.shell.tasks.complete', { title: row.title }),
      toggleOff: (row: SharedTaskRow) => t('web.shell.tasks.uncomplete', { title: row.title }),
      selectOn: (row: SharedTaskRow) => t('web.shell.tasks.unselect', { title: row.title }),
      selectOff: (row: SharedTaskRow) => t('web.shell.tasks.select', { title: row.title }),
    }),
    [t],
  );

  const title = useMemo(() => {
    if (view === 'settings' && secondaryAccountSurface === 'profile') {
      return t('web.profile.overview.title');
    }
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
  }, [store.filter, projects.projects, view, secondaryAccountSurface, t]);

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
  // 共享清单的实时信号（M5）：账号级的东西，用户停在哪一屏都该收到，所以挂在根上
  // —— 与提醒通知同一个挂载点（拆两处就会有一处被忘掉）。
  useShareActivitySignal();
  useShareRosterSignal();

  /** 全部便签（未删除、规范序 —— 见 `useNoteStore`）。 */
  const allNotes = useNoteStore(useShallow((s) => s.notes));

  /**
   * 共享清单入口的两块前置事实（W4）：
   * - `currentProject`：当前**停在**的清单行（智能清单不算 —— 它们是查看方式）。
   * - `syncConfigured`：同步已配置才有共享可谈；未登录时按钮出现只会走进死路。
   */
  const currentProject = useMemo(() => {
    const f = store.filter;
    if (view !== 'tasks' || f.kind !== 'project') return undefined;
    return projects.projects.find((p) => p.id === f.projectId);
  }, [store.filter, view, projects.projects]);
  /**
   * 🔴 停在某份**共享**清单上 ⇒ 拉一次那条下行的既有内容。
   * 判据本体与理由在 `features/share/use-share-open-pull.ts`（同一枚洞在 iOS 设备腿
   * L2 那一格实测抓到：实时信号只在"有人新写"时响，加入之前就在清单里的东西没人带）。
   */
  useShareOpenPull(currentProject?.shareId);
  const syncConfigured = useSyncStore(
    (s) => s.baseUrl.trim() !== '' && s.token !== undefined && s.token.trim() !== '',
  );

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
   * 隐私面板可能在设置之上打开，且它的 window 捕获监听注册得更晚。
   * 底层必须主动让路；顶层 stopImmediatePropagation 阻止不了已经执行的监听。
   */
  useEffect(() => {
    if (view !== 'search' && view !== 'settings') return;
    const onKey = (event: KeyboardEvent) => {
      if (usePrivacyStore.getState().open) return;
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
   * 「AI 排优先级」这一枚组织类动作（2026-11-02 搬进对话助手）。
   *
   * 🔴 它原来渲染在**任务列表上方**，长得像一行任务（`ht-btn--ghost` 铺满整列 + 图标），
   * 位置在一组组头与任务行之间。产品负责人的裁决是"AI 排优先级应该直接在对话助手里面有，
   * 而不是放在这个地方" —— 这一版兑现它。
   *
   * 为什么搬得动、而上一版只搬了 `AiBreakdown`：这两件事的**范围**不同。
   * `AiBreakdown` 拆的是**一条**任务（属于任务详情的自动化槽），
   * 这一枚排的是**当前清单**（属于"我跟助手说一句"这件事）。上一版拿
   * "它是批量的" 当理由把它留在列表里，那个理由说明的是"它不能进单条任务详情"，
   * 不说明"它该待在列表体中间"。
   *
   * ⚠️ 配置关着时它**仍然在**（与 `AiBreakdown` 同一条）：点了会说明该去开什么，
   * 而不是消失 —— "找不到入口"和"入口说为什么不可用"是两件事。
   */
  const aiPrioritizeAction = visible.length > 0 ? (
    <AiPrioritize
      tasks={visible}
      routing={aiRouting}
      consents={aiSettings.consents}
      secrets={aiSecrets}
      // 🔴 把上次落盘的熔断状态传回去 —— 否则落盘没有意义。
      healthSnapshot={aiSettings.health}
      // 🔴 记忆偏好。开关关着时这里是空集 —— 界面拿不到任何偏好。
      preferenceSet={memory.preferenceSet}
      /**
       * 🔴 只写用户勾选保留的那些（`decisions` 已经是取舍后的结果），
       * 并把整批交给一个动作层意图：一条 BATCH op 同时携带每条任务各自的优先级。
       * 这样它能同步到别的设备，也不会留下半批已写、半批未写的中间态。
      */
      onApply={async (decisions) => {
        await store.bulkSetPriorities(decisions);
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
  ) : null;

  /**
   * AI 面：**一个 Agent，一个聊天入口**。
   *
   * 工具调用是 Agent 的内部执行过程，不再作为与会话并列的产品面板展示。
   * 这样用户只需要理解「我想让助手做什么」，而不是先判断「应该打开工具还是会话」。
   * 写入仍然遵守提案 → 用户确认的安全边界，工具目录与授权继续留在设置里。
   * 这一份 JSX 同时是右栏内容与窄屏回退内容，挂载点不变，未决披露状态也不丢。
   *
   * 🔴 组织类动作（`aiPrioritizeAction`）经 `orgActions` 插进这一份，
   * 挂在**会话上方、常驻**（不是空态的一部分）：它是有状态的流程，
   * 一有对话就消失的入口等于"用一次就找不到第二次"。
   */
  const aiPanels = (
    contentView === 'tasks' ? (
      <section className="ht-ai-agent-surface" data-testid="ai-agent-surface">
        <AssistantPanel
            expanded={assistantWorkspace}
            onToggleExpanded={() => { setCompactAssistantOpen(false); setAssistantExpanded((value) => !value); }}
            onClose={assistantOverlay ? () => setCompactAssistantOpen(false) : undefined}
            routing={aiRouting}
            consents={aiSettings.consents}
            secrets={aiSecrets}
            memoryEnabled={aiSettings.memoryEnabled}
            getDurationPreferenceHints={getDurationPreferenceHints}
            orgActions={aiPrioritizeAction}
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
      </section>
    ) : null
  );


  /*
   * `/admin` 这个地址：整棵树换成后台壳，不画应用本体。
   *
   * 🔴 位置是刻意的 —— 必须在**所有 hook 之后**。往上挪一行，`/admin` 就会在
   * 第一个条件分支处违反 rules-of-hooks，症状是"只有这一个地址打不开、
   * 别处全好"，而报错只在那一个 URL 上出现。
   *
   * 地址只在挂载这一次读：后台壳里点分区改的是 `store.activeTab`，**不改地址**，
   * 所以这里不监听 popstate，也不需要路由库（ADR-0038 §3.3）。
   *
   * ⚠️ 这里判的是"该画哪个壳"，不是权限。权限只有服务端 `requireAdmin` 那一个
   * 裁决者（§4.3）：手工把地址敲成 `/admin` 的人拿到的是一个说明原因的页面，
   * 不是一条数据。
   */
  if (isAdminConsoleLocation()) return <AdminConsolePage />;

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
    <HeytaUiProvider value={uiTheme} locale={locale}>
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
        // 🔴 独立设置窗口：壳（rail / 主区 / 详情列）由 CSS 收起，只留设置自己。
        //    用属性而不是"条件渲染整棵壳" —— 后者会让设置面板在窗口里重挂载一次，
        //    而它带着未决的订阅/授权状态（与上面那段 Provider 理由同源）。
        data-settings-standalone={settingsStandalone ? '' : undefined}
        data-assistant-workspace={assistantWorkspace ? '' : undefined}
        data-detail-agent={contentView === 'tasks' && selectedTaskId === null ? '' : undefined}
        // 🔴 而这一条管的是"这一栏此刻有没有要画的东西"（与"用户收没收"是两回事，
        // 理由与算法见上面 `detailHasContent` 那段）。零内容的列不许占位。
        data-detail-empty={detailHasContent ? undefined : ''}
        // 🔴 W2（审计 §4.2）：设置浮层是独占注意力的主表面，不能跟详情列同屏抢空间
        // （`evidence/detail-pane-overlay/settings-sheet.png` 那张"设置 ~60% + 任务面单
        // ~30% 并排、无遮罩无主次"的实测图）。浮层开着 ⇒ 这一栏整根退场
        // （`hidden` 出 a11y 树 + `[data-detail-suppressed]` 把轨道归零，规则在 base.css）；
        // 关掉后选中态天然恢复 —— 选中住在 store 里，从未被清。它与 `data-detail-empty`
        // 是**两条规则**：那条说"没内容"，这条说"有内容也要让位给浮层"。
        data-detail-suppressed={view === 'settings' ? '' : undefined}
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
          见 `RailNavigation` 中的 `anchorLabel()`：它只写 CSS 自定义属性，不产生 state。 */}
      <RailNavigation
        view={view}
        visibleMainTabs={visibleMainTabs}
        visibleToolTabs={visibleToolTabs}
        syncEmail={syncEmail}
        syncNeedsSignIn={syncNeedsSignIn}
        growthEnabled={enabledModules.has('growth')}
        assistantActive={assistantWorkspace}
        onOpenAssistant={() => { setSettingsFocus(undefined); setView('tasks'); setCompactAssistantOpen(false); setAssistantExpanded(true); }}
        onNavigate={(key) => {
          setAssistantExpanded(false);
          setSettingsFocus(undefined);
          setView(key);
        }}
        onResetTasks={() => useTaskStore.getState().setFilter({ kind: 'all' })}
        onSignIn={() => useSyncStore.getState().openSignIn()}
        onOpenSettings={() => {
          setSecondaryAccountSurface('settings');
          setSettingsReturnSurface(undefined);
          setSettingsFocus(undefined);
          setView('settings');
        }}
        onOpenProfile={() => {
          setSecondaryAccountSurface('settings');
          setSettingsReturnSurface(undefined);
          setSettingsFocus(undefined);
          setSettingsAnchor('profile');
          setView('settings');
        }}
        onOpenProfileCenter={() => {
          setSecondaryAccountSurface('profile');
          setSettingsReturnSurface(undefined);
          setSettingsAnchor(undefined);
          setView('settings');
        }}
        onOpenGrowth={() => {
          setSettingsFocus(undefined);
          setView('growth');
        }}
        onSignOut={() => {
          /*
            🔴 「退出登录」今天真的会撤销手上这一枚（ADR-0063）。在这一行之前它只做
            **本机那半件事** —— 凭据从这台设备上删了，而那枚 JWT 在服务端**还能用一整年**，
            于是共享电脑上"我已经退出了"是一句界面在说谎。
            次序（本机清理排在网络之前）、失败后的那句实话、以及"重试那一次绝不清凭据"
            全部住在 `signOutStore` —— 这里只转交这一次点击，不复制那份判断。
          */
          void useSignOutStore.getState().signOutCurrentDevice();
        }}
        onOpenHelp={() => {
          setSecondaryAccountSurface('settings');
          setSettingsReturnSurface(undefined);
          setSettingsFocus(undefined);
          setView('settings');
          setSettingsAnchor('help');
        }}
      />

      {/*
        sidebar **只在有范围的视图里出现**，而且每个视图渲染**自己那一列**：
        `tasks` = 智能清单 / 按象限筛选 / 清单 / 标签（单选筛选）；
        `calendar` = 迷你月历 + 显示范围（多选勾选，见 `features/calendar/CalendarSidebar`）。
        其余视图（四象限 / 习惯 / 时间线 / 便签 / 回收站 / 设置…）没有范围，主区吃满。
      */}
      {view === 'tasks' ? (
        <ScopeDrawer open={scopeDrawerOpen} onClose={() => setScopeDrawerOpen(false)}>
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
        </ScopeDrawer>
      ) : null}

      {/* 日历那一列自己带 `SidebarResizer`（同一份宽度状态，所以两端拖哪边都一样）。 */}
      {view === 'calendar' && (narrowLayout || calendarSidebarOpen) ? (
        <ScopeDrawer open={scopeDrawerOpen} onClose={() => setScopeDrawerOpen(false)}>
          <CalendarSidebar />
        </ScopeDrawer>
      ) : null}

      <main className="ht-main">
        {/*
          退出登录之后**还差什么**（服务端那一枚没撤掉 / 所有设备都退了）。
          挂在主区顶部而不是设置浮层里：点完「退出登录」浮层就关了自己，
          而这两句话讲的是**这一次点击的结果** —— 结果要出现在用户做出动作的那个位置。
        */}
        <SignOutNotice />
        {/*
          运营公告那一横条（ADR-0075）。挂在主区顶部：它讲的不是某一个视图的事，
          而是"这个部署现在要告诉所有用户一句话"。
          一次只画最新的一条，忽略记在本机 —— 见 `features/announcements/store.ts`。
        */}
        <AnnouncementBanner />
        <header className="ht-header">
          {view === 'tasks' ? (
            <button type="button" className="ht-btn ht-btn--ghost ht-scope-trigger"
              aria-label={t('web.shell.nav.scopeAria')} aria-haspopup="dialog" aria-expanded={scopeDrawerOpen}
              onClick={() => setScopeDrawerOpen(true)} data-testid="task-scope-toggle">
              <PanelLeft size={ICON_SIZE.md} aria-hidden="true" />
            </button>
          ) : null}
          {view === 'calendar' ? (
            <button
              type="button"
              className="ht-btn ht-btn--ghost ht-header__calendar-sidebar-toggle"
              data-testid="calendar-sidebar-toggle"
              aria-pressed={calendarSidebarToggleOn}
              aria-controls="calendar-sidebar"
              aria-label={calendarSidebarToggleOn ? t('web.calendar.sidebar.hide') : t('web.calendar.sidebar.show')}
              title={calendarSidebarToggleOn ? t('web.calendar.sidebar.hide') : t('web.calendar.sidebar.show')}
              onClick={() => {
                if (narrowLayout) setScopeDrawerOpen((open) => !open);
                else useCalendarViewStore.getState().toggleCalendarSidebar();
              }}
            >
              <PanelLeft size={ICON_SIZE.md} aria-hidden="true" />
            </button>
          ) : null}
          <h1 className="ht-header__title">{title}</h1>
          {view === 'habits' ? <div className="ht-header__habits-slot" data-habits-header-slot /> : null}

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
              🔴 2026-11-02：这里原本平铺着 9 个控件，现在只剩「图标按钮 + 一枚 `⋯`」。

              搬走的三件与它们的现居地：
                · 共享清单入口 → `⋯` 里的 `share-open-button`（低频动作：建清单时点一次，
                  却常年占着页头一份横向空间）；
                · 排序（`12px 文字 + 44px 原生 select` 的混合体）→ `⋯` 里的单选组；
                · 「选择任务」→ `⋯` 里的一项，**进入批量模式**之后才由下面对那段渲染。
              判据一条没放宽，只是换了位置：`check:share-entry-visible` 仍钉入口可达、
              `task-sort.spec.tsx` 改钉"排序可从页头 `⋯` 到达"，理由写在那两份文件里。
            */}
            {/*
              🔴 批量选择是**模式**，不是一枚常驻控件。
              原来它常驻：非模式态下页头也画着「选择任务」，与排序下拉、分享按钮并列 ——
              于是用户在任何时刻都在看一组自己没在用的控件，而每加一个功能页头就更长一寸。
              现在非模式态这里什么都没有；进入模式的动作在 `⋯` 里（`task-select-open`）。
            */}
            {view === 'tasks' && bulkSelecting ? (
              <div className="ht-header__bulk" data-testid="bulk-toolbar" role="group" aria-label={t('web.shell.bulk.select')}>
                <span className="ht-type-caption" role="status">
                  {t('web.shell.bulk.selected', { count: selectedTaskIds.size })}
                </span>
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost"
                  disabled={selectedTaskIds.size === 0 || selectedHasRepeat}
                  data-testid="bulk-complete"
                  aria-describedby={selectedHasRepeat ? 'bulk-repeat-warning' : undefined}
                  onClick={() => void runBulkAction('complete')}
                >
                  {t('web.shell.bulk.complete')}
                </button>
                {selectedHasRepeat ? (
                  <span
                    id="bulk-repeat-warning"
                    className="ht-type-caption ht-settings__hint"
                    role="status"
                    data-testid="bulk-repeat-warning"
                  >
                    {t('web.shell.bulk.repeatNotice')}
                  </span>
                ) : null}
                <select
                  aria-label={t('web.shell.bulk.move')}
                  disabled={selectedTaskIds.size === 0 || bulkMoveNowhere}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value === '') return;
                    void runBulkAction('move', event.target.value === '__inbox__' ? undefined : event.target.value);
                    event.currentTarget.value = '';
                  }}
                  style={{
                    minHeight: cssVar('touch-target.min'),
                    paddingInline: cssVar('space.2'),
                    borderRadius: cssVar('radius.md'),
                    border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
                    background: cssVar('color.background'),
                    color: cssVar('color.foreground'),
                    fontSize: cssVar('font-size.sm'),
                  }}
                >
                  <option value="">{t('web.shell.bulk.move')}</option>
                  <option value="__inbox__" disabled={bulkMoveBlocked(undefined)}>
                    {t('web.shell.bulk.moveInbox')}
                  </option>
                  {projects.projects.map((project) => (
                    <option
                      key={project.id}
                      value={project.id}
                      disabled={bulkMoveBlocked(project.id)}
                      title={bulkMoveBlocked(project.id) ? t('web.organize.moveBlockedShared') : undefined}
                    >
                      {project.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ht-btn ht-btn--danger"
                  disabled={selectedTaskIds.size === 0}
                  data-testid="bulk-delete"
                  onClick={() => void runBulkAction('delete')}
                >
                  {t('web.shell.bulk.delete')}
                </button>
                {/* 退出模式：图标而不是又一句文字。模式栏里已经有三个文字按钮了。 */}
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost"
                  data-testid="bulk-exit"
                  aria-label={t('web.shell.bulk.cancel')}
                  onClick={() => {
                    clearBulkSelection();
                  }}
                >
                  <X size={ICON_SIZE.sm} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {bulkError === undefined ? null : (
              <span className="ht-settings__danger" role="alert">{t('web.shell.bulk.error', { message: bulkError })}</span>
            )}
            {undoAction === undefined ? null : (
              <UndoReceipt
                label={undoAction.label}
                onUndo={undoAction.run}
                data-testid="bulk-undo"
                onDismiss={() => { setUndoAction(undefined); }}
              />
            )}
            {/*
              🔴 排序（2026-10-01 进页头；2026-11-02 进 `⋯`）。

              进页头那一版是"页头 = 标题 + 排序 + ⋯"的中间态 —— 其中 `⋯` 从来没被造出来，
              于是排序自己占了一格，形态是 `12px 文字标签 + 44px 原生 select`：
              页头上唯一一枚**带边框的下拉**，与旁边的图标按钮、ghost 文字按钮
              三种控制语法并列。而且它 gate 在 `visible.length > 0` 上 ——
              空的收集箱里排序整个消失，而排序是**视图属性**，不该随数据条数变形。

              现在它是 `⋯` 里的单选组：入口恒定存在（空列表也在），档位一屏可见，
              选完自动收起。选项仍来自 `TASK_SORT_KEYS`（判据在领域层），
              排序仍**不进 op-log**（§3.4：阅读偏好不是用户意图），
              落盘仍走 `features/tasks/sort-pref.ts`。
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
              状态 / 立即同步 / 同步设置 / 语言 / 详情开关 / 主题 六枚不相关控件
              （2026-10-06 两刀之后只剩**详情开关**一枚：同步整组下移 rail 底部，
              语言与主题搬进 设置 → 显示 —— 裁决见 §9.3/§9.6），
              而"同步"在滴答里是左下角的东西。裁决与现量：
              `docs/plans/goal-layout-audit.md` §9.1 第 1 行。
              全局冲突、隐私与补签面板挂在应用根层；助手工作区会隐藏主内容，
              `position: fixed` 仍受隐藏祖先影响，不能把全局决定放在页头里。
            */}
            {/*
              详情列的开关（工单 W4 ②的第一条路径）。
              与主题按钮同一档位：**纯图标 + 自带可访问名**，名字说的是"点下去会怎样"
              （`web.shell.detailPane.{collapse,expand}`），所以文案随状态翻转而不是恒一个"详情"。
              🔴 它在几何不可行的三档视口里由 CSS 一起藏掉（`narrow.css`）：
              那一栏没地方画，还留一个按钮就是界面在说谎。
              `aria-pressed` 报的是"这一栏现在在不在"，与名字互为对照 ——
              读屏用户不需要看见图标就能知道自己刚按下会收还是会展。
            */}
            {/*
              🔴 助手入口**不再是页头的一枚图标**（2026-11-02 第三刀）。

              它原来是「详情列收起时」出现在页头的回退按钮 —— 于是宽档把详情列收起之后，
              页头上会同时有「助手」「⋯」「详情开关」三枚，而那正是这一轮要消灭的形状。

              现在它住在 `⋯` 里（`assistant-open` 这个 testid 跟着搬过去，判据不用改语义）。
              **没有丢可达性**：rail 底部那枚「助手」tab 仍在，`⋯` 里也有一项。
              焦点归还也仍然成立 —— 选中时先把焦点交回 `⋯` 触发者，
              浮层关掉时它回到的是**一个还挂在树上的元素**（菜单项在选完那一刻就没了）。
            */}
            {/*
              🔴 页头唯一的功能入口（2026-11-02）。

              在这之前，任务视图页头是"一个功能一个控件"的加法结果：分享按钮、
              「选择任务」、排序标签 + 排序下拉、助手、详情开关 —— 五组并列，
              三种控制语法。每加一个功能页头就更长一寸，而没有任何一条门禁会红
              （几何都合规：字是 token、色是 token、行高对）。

              收进这一枚之后，页头形状**不再随功能数量变化**：加功能 = 加一项菜单项。
              这也是滴答那套界面的做法 —— 它不是在显示功能，是在决定什么不配出现在表面上。

              ⚠️ 排序那三项在**空列表时也渲染**（原来 gate 在 `visible.length > 0`）：
              排序是视图属性，不该随数据条数出现和消失。
              只有「选择任务」按 `visible.length` 禁用 —— 没有任务时选不出东西，
              禁用态仍然说明"这里有这个能力"。
            */}
            {view === 'tasks' ? (
              <>
                <button
                  ref={taskMenuTriggerRef}
                  type="button"
                  className="ht-btn ht-btn--ghost"
                  data-testid="task-menu-open"
                  aria-haspopup="menu"
                  aria-expanded={taskMenuOpen}
                  aria-label={t('web.shell.overflow.label')}
                  onClick={() => { setTaskMenuOpen((open) => !open); }}
                >
                  <MoreHorizontal size={ICON_SIZE.md} aria-hidden="true" />
                </button>
                <AnchoredMenu
                  open={taskMenuOpen}
                  onClose={() => { setTaskMenuOpen(false); }}
                  triggerRef={taskMenuTriggerRef}
                  label={t('web.shell.overflow.label')}
                  testID="task-menu"
                >
                  <MenuSection>{t('web.shell.overflow.sortSection')}</MenuSection>
                  {TASK_SORT_KEYS.map((key) => (
                    <MenuItem
                      key={key}
                      checked={effectiveTaskSort === key}
                      testID={`task-sort-${key}`}
                      onSelect={() => { changeTaskSort(key as TaskSortKey); }}
                    >
                      {t(SORT_LABEL[key])}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem
                    testID="task-select-open"
                    icon={<ListChecks size={ICON_SIZE.sm} aria-hidden="true" />}
                    disabled={visible.length === 0}
                    onSelect={() => { setBulkSelecting(true); }}
                  >
                    {t('web.shell.bulk.select')}
                  </MenuItem>
                  {/*
                    助手入口（详情列收起时）。选中后**先把焦点交回 `⋯`** 再开浮层：
                    菜单项在下一次提交时会被卸载，而浮层关闭时要把焦点还给
                    "打开它的那个元素"（否则焦点落到 `body`）。
                  */}
                  {!detailColumnShown ? (
                    <MenuItem
                      testID="assistant-open"
                      icon={<AssistantIcon size={ICON_SIZE.sm} aria-hidden="true" />}
                      onSelect={() => {
                        taskMenuTriggerRef.current?.focus();
                        setCompactAssistantOpen(true);
                      }}
                    >
                      {t('web.ai.assistant.title')}
                    </MenuItem>
                  ) : null}
                  {/*
                    详情列收起之后，**展开它的入口在 `⋯` 里**（页头那枚图标让位给助手）。
                    页头因此在每一档都只有「一枚图标 + 一枚 ⋯」。
                  */}
                  {!detailColumnShown && canToggleDetailPane ? (
                    <MenuItem
                      testID="detail-pane-open"
                      icon={<PanelRightOpen size={ICON_SIZE.sm} aria-hidden="true" />}
                      onSelect={() => { toggleDetailPane(); }}
                    >
                      {t('web.shell.detailPane.expand')}
                    </MenuItem>
                  ) : null}
                  {/*
                    共享清单入口（ADR-0062 W4）从页头搬到这里。

                    条件一个字没改：只停在**自己的清单**上、且同步已配置时才出现 ——
                    智能清单（今天/收集箱…）不是"存放位置"，共享无从谈起；
                    未配置同步的屏上挂一枚点了必失败的按钮更糟。
                    可达性由 `check:share-entry-visible` 与
                    `apps/web/tests/share-entry-visible.spec.tsx` 一起钉，两者都跟着搬到这一层。
                  */}
                  {currentProject !== undefined && syncConfigured ? (
                    <MenuItem
                      testID="share-open-button"
                      icon={<Users size={ICON_SIZE.sm} aria-hidden="true" />}
                      onSelect={() => {
                        setShareDialog({ projectId: currentProject.id, shareId: currentProject.shareId });
                      }}
                    >
                      {t(currentProject.shareId === undefined ? 'web.share.open.new' : 'web.share.open.manage')}
                    </MenuItem>
                  ) : null}
                </AnchoredMenu>
              </>
            ) : null}
            {canToggleDetailPane ? <button
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
            </button> : null}
          </div>
        </header>

        {/*
          🔴 行操作的两条**输入**通路挂在 `.ht-content` 这一层（委托），不是每一行上：
          右键是 web 独有的输入方式（`packages/ui` 的 `TaskRow` 四个端共用，不能长出
          web 专属属性 —— AGENTS §3.5），而任务列表在本文件里有**两个渲染面**
          （平铺 / 按日期分组），委托一次覆盖两处，不会出现"分组那一面忘了接"。
          两条通路最终都走同一个 `openRowMenuFromRow`。
        */}
        <div
          className="ht-content"
          onContextMenu={handleTaskContextMenu}
          onKeyDown={handleTaskRowKeyDown}
        >
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
          {/* 🔴 任务动作失败了要说一行（布局审计 §8.2 第 12 条）。
              挂在这里而不是各视图里：这一条要覆盖收集箱/看板/象限/日历/时间线/回收站
              六个面，逐面各挂一份就会长成六份各自维护的提示。
              组件自己读 store，所以这里不需要任何条件 —— 没失败时它渲染 `null`。 */}
          <TaskActionError />
          {/* 🔴 共享内容**验签没过**时被拒了几条，必须说出来（ADR-0069 裁决五的界面落点）。
              与上面同一位置逻辑：被拒的可能是一条任务、一张便签或一句评论，
              挂在评论区里就等于"被拦掉的是任务时界面一句都不说"。
              没拒时它渲染 `null`，所以这里不需要任何条件。 */}
          <ShareSignatureNotice />
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
            /*
              🔴 **这里不再有任何 AI 配置**（2026-11 产品裁决）。

              「一句话解析」（AI 捕获）连同它的图片附件一起搬进了右侧助手
              （`AssistantPanel` 的 `captureTarget` 那段写了理由与判据）。
              留在这个调用点上的那几个 prop —— routing / consents / secrets /
              healthSnapshot / preferenceSet / onFeedback / onHealth ——
              全部随它一起移除：留着它们就是留一条"配置了但没人读"的路。

              于是这个输入框回到滴答那种形状：**你写什么，规则就当场读什么**，
              底下不再挂任何 AI 按钮。
            */
            <CaptureComposer destination={captureDestination} />
          )}

          {/*
            🔴 这里**曾经**是「AI 排优先级」那一行（在组头与任务行之间、长得像一行任务）。
            2026-11-02 搬进对话助手的会话上方（`aiPrioritizeAction` → `orgActions`）。

            **不要搬回来。** 它不是"位置偏好"问题，是**层级**问题：动作不该住进列表体。
            列表体里只放任务 —— 否则每一行"这行点下去会发生什么"都要先分辨它是任务还是动作，
            而它长得和任务一模一样（同样的 ghost 按钮、同样的整列宽度、同样的图标位）。
            判据：`check:surface-budget` 的「列表体不许有动作行」那一臂。
          */}


          {/*
            AI Agent 在**右栏不画**时才退回这里（≤1023px、用户收起）。
            右栏与中间列共用下面 `aiPanels` 那一份 JSX —— 不抄第二份。
            🔴 决定它是"栏在不在画"（`detailColumnShown` = 几何 + 用户选择），**不是**
            "栏里有没有东西"：后者取决于 AI 挂哪，用它就成了自己决定自己的循环
            （2026-10-06 第一刀那版正是这样把 AI 面永远锁在中间列的）。
          */}


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
                sort={effectiveTaskSort}
                onOpenTask={openTask}
                activeTaskId={selectedTaskId}
                selectedTaskIds={bulkSelecting ? selectedTaskIds : undefined}
                selectionMode={bulkSelecting}
                onToggleTask={(taskId) => {
                  if (bulkSelecting) {
                    toggleBulkSelection(taskId);
                  } else {
                    void store.toggleComplete(taskId);
                  }
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
                          sort={effectiveTaskSort}
                          onOpenTask={openTask}
                          activeTaskId={selectedTaskId}
                          selectedTaskIds={bulkSelecting ? selectedTaskIds : undefined}
                          selectionMode={bulkSelecting}
                          onToggleTask={(taskId) => {
                            if (bulkSelecting) {
                              toggleBulkSelection(taskId);
                            } else {
                              void store.toggleComplete(taskId);
                            }
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
              aria-label={
                secondaryAccountSurface === 'profile'
                  ? t('web.profile.overview.title')
                  : t('web.shell.views.settings')
              }
              data-testid="settings-sheet"
              data-account-surface={secondaryAccountSurface}
              ref={sheetRef}
              tabIndex={-1}
              onAnimationEnd={(e) => {
                if (e.animationName === 'ht-sheet-out') finishSheetExit();
              }}
            >

            <header className={`ht-settings__header${secondaryAccountSurface === 'settings' && settingsReturnSurface !== 'profile' ? ' ht-settings__header--compact' : ''}`}>
              <div>
                {secondaryAccountSurface === 'settings' && settingsReturnSurface === 'profile' ? (
                  <button
                    type="button"
                    className="ht-btn ht-btn--ghost"
                    data-testid="settings-back-to-profile"
                    onClick={() => {
                      setSecondaryAccountSurface('profile');
                      setSettingsReturnSurface(undefined);
                      setSettingsAnchor(undefined);
                    }}
                  >
                    <ArrowLeft size={ICON_SIZE.sm} aria-hidden="true" />
                    {t('web.profile.overview.back')}
                  </button>
                ) : null}
                {secondaryAccountSurface === 'profile' ? (
                  <>
                    <h1 className="ht-settings__page-title ht-type-screen-title">
                      {t('web.profile.overview.title')}
                    </h1>
                  </>
                ) : null}
                {/*
                  🔴 这一屏原来有一句常驻副句（"昵称和头像只保存在本机…"），
                  2026-10-24 之后它也进了 `?`（挂在下面的 `h1` 上）——
                  设置里**一句常驻说明都不留**，这是那条禁令的字面意思。
                */}
                {secondaryAccountSurface === 'profile' ? (
                  <SettingsInfoTip
                    testId="tip-profile-overview"
                    label={t('web.profile.overview.title')}
                    text={t('web.profile.overview.lead')}
                  />
                ) : null}
              </div>
              <button
                type="button"
                className="ht-sheet__close"
                data-testid="settings-sheet-close"
                aria-label={
                  secondaryAccountSurface === 'profile'
                    ? t('web.shell.profile.close')
                    : t('web.shell.settings.close')
                }
                onClick={() => {
                  closeSecondarySurface();
                }}
              >
                <X size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            </header>
            {secondaryAccountSurface === 'profile' ? (
              <ProfileOverview
                growthEnabled={enabledModules.has('growth')}
                onEditProfile={() => {
                  setSecondaryAccountSurface('settings');
                  setSettingsReturnSurface('profile');
                  setSettingsAnchor('profile');
                }}
                onOpenSettings={() => {
                  setSettingsFocus(undefined);
                  setSettingsAnchor(undefined);
                  setSecondaryAccountSurface('settings');
                  setSettingsReturnSurface('profile');
                }}
                onOpenGrowth={() => {
                  closeSecondarySurface();
                  setView('growth');
                }}
              />
            ) : (
            <div className="ht-settings__layout">
              <SettingsSectionNav active={activeSettingsSection} onSelect={(id) => {
                setSettingsAnchor(undefined);
                setSettingsFocus(undefined);
                setSettingsSection(id);
              }} />
              <div className="ht-settings__content">

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
            {/*
              G1 账号 = 「个人资料」+「账号与安全」的合体（2026-10 七组同构）。

              🔴 为什么并成一组：这两块回答的是**同一个问题** —— "我是谁、谁能用这个
              账号登录"。拆成两组时，用户想改昵称要点第一组、想改密码要点第七组，
              而两组之间隔着订阅、同步、AI 三整屏。移动端先落地的六→七组也是这么并的
              （`profile` + `security` ⇒ `account`，见移动端 `LEGACY_SECTION`）。

              ⚠️ id 仍是 `settings-group-profile`（**没有改 id**，理由见
              `SETTINGS_NAV_ITEMS` 上面那段）；`settings-group-account` 由
              `LEGACY_SETTINGS_SECTIONS` 折到这一组，旧链接照样落得进来。

              组内顺序 = 身份 → 登录方式 → 已登录的设备 → 危险区（注销账号最后）：
              危险动作不进日常项中间（`ux-principles.md` §6 / 计划 §5.2 的 G1）。
            */}
            <section className="ht-settings__group" hidden={activeSettingsSection !== 'settings-group-profile'} id="settings-group-profile" aria-label={t('mobile.settings.section.account')}>
              <div id="settings-profile" data-testid="profile-section-anchor">
                <ProfilePanel active={activeSettingsSection === 'settings-group-profile'} />
              </div>
              {/*
                账号门槛：**四个账号能力共享一个登录入口**，避免未登录时同一屏重复渲染四张卡。
                🔴 未登录时这一块整段由下面这张卡承接；四个面板自身仍保留独立 guard，
                单独挂载时不会误显示注销控件。
              */}
              {accountNeedsSignIn ? (
                <SettingsAccountGate
                  messageKey="web.settings.accountSignIn"
                  testId="settings-account-needs-sign-in"
                />
              ) : (
                <>
              {/* 账号安全：管理自己的通行密钥（列 / 删）。见 PasskeyPanel 文件头。 */}
              <PasskeyPanel active={activeSettingsSection === 'settings-group-profile'} />
              {/* 账号安全：改登录密码（`/api/password/change` 的唯一界面入口）。 */}
              <PasswordPanel />
              {/*
                账号安全：**谁现在还能用你的账号登录**（列 / 逐个撤销）。
                它排在两种"登录方式"之后、"注销账号"之前 —— 这一面板管的不是能不能登录，
                而是**已经登录着的那些**还在不在。见 SessionsPanel 文件头。
              */}
              <SessionsPanel active={activeSettingsSection === 'settings-group-profile'} />
              {/*
                账号安全：注销账号（批次 E3）。服务端 `DELETE /api/account` 一直在，
                缺的是调用点 —— 而 E2 那条"收到注销信号就清本机"的反应也等在这里
                被主动触发一次，不然它只能靠下一次同步的回声。
                🔴 它是这一组的**最后一块**、也是唯一的不可逆动作（计划 §5.2 的"危险区"）。
              */}
              <CloseAccountPanel />
                </>
              )}
            </section>
            {/*
              🔴 「订阅」是**独立一节**（2026-10-24）。页内三段：状态 → 选一档 → 关于收费。
              它不再挂在账号下面：那一节管的是"谁能登录这台账号"，
              而这一节管的是"我们替你运维的那台服务器还要不要续" —— 两件不同的事。
              ⚠️ 支付渠道与入口由 `check:payment-entry` 钉成同一件事：没配渠道时
              界面如实说"这台实例没有配置收款通道"，不假装能买。
            */}
            <section className="ht-settings__group" hidden={activeSettingsSection !== 'settings-group-subscription'} id="settings-group-subscription" aria-label={t('mobile.settings.section.subscription')}>
              <SubscriptionPanel active={activeSettingsSection === 'settings-group-subscription'} />
            </section>
            {/*
              G3 数据与同步 = 「数据管理」+「同步与隐私」的合体（2026-10 七组同构）。

              🔴 为什么并：这两块回答的是**同一个问题** —— "我的东西在哪、怎么带走、
              删错了怎么办"。拆成两组时，"备份"在第六组、"同步状态"在第四组，
              而它们是同一条链上的前后两段（移动端同样是 `sync` ⇒ `data`）。

              ⚠️ id 仍是 `settings-group-data`；`settings-group-sync` 由
              `LEGACY_SETTINGS_SECTIONS` 折到这一组。

              组内顺序 = 连到哪 → 准不准出门 → 带走/找回：
              地址是隐私同意与 AI 出境的**前提**，反过来排会让人在一个永远不可能
              生效的开关上花时间。
            */}
            <section className="ht-settings__group" hidden={activeSettingsSection !== 'settings-group-data'} id="settings-group-data" aria-label={t('mobile.settings.section.data')}>
              {/*
                🔴 **同步**（工单 H9 第 3 刀，2026-10-06）：地址 / 令牌 / 口令 / 密钥库
                这一块原来是一个**同级浮层**（rail 那颗齿轮点开它）。产品负责人第 2 条
                「设置不应该点击头像之后再打开吗？」的病根就在这：那颗齿轮长得像全局设置，
                点开的却只是同步。现在它是设置里的**一节**，与「隐私同意」「数据」并列 ——
                一个屏幕、一套出口（✕ / Esc / 点回别的视图），§8.2 第 6 条登记的
                "这个浮层没有 Esc、焦点进不去"从此没有载体。
              */}
              <SyncSettingsPanel
                active={activeSettingsSection === 'settings-group-data'}
              />
              {/*
                🔴 **隐私同意排在 AI 出境开关之前**（后面 G6 那三道闸）：那一组回答的是
                "哪一类数据可以出境"，而本面板回答的是"**这台设备准不准出门**" ——
                后者是前者的前提，顺序反过来会让人在一个永远不可能生效的开关上花时间。
                它同时是 PIPL 第 15 条要求的**撤回入口**（同意只在首启弹一次）。
              */}
              <PrivacyPanel active={activeSettingsSection === 'settings-group-data'} />
              {/* 导入与迁移 / 备份 / 回收站（`DataSettingsPanel` 文件头）。 */}
              <DataSettingsPanel active={activeSettingsSection === 'settings-group-data'} />
            </section>
            {/*
              G4 提醒与通知：**这一组是拆出来的**（2026-10 七组同构）。

              🔴 改前这四块全挤在「任务与显示」里 —— 那一组同时装着"长什么样"（主题/语言/
              日期显示）、"开哪些能力"（功能模块）、"什么时候吵你"（提醒）和"桌面长什么样"
              （小组件）。组名叫任务与显示、内容的一半跟显示无关，用户每次都要先猜
              "这个词是按什么分的"。现在它们回答的是同一句用户会说出口的话：
              **它什么时候、用什么方式找我。**

              组内顺序 = 系统授权 → 打扰偏好 → 桌面小组件（怎么加 → 怎么刷新）。
            */}
            <section className="ht-settings__group" hidden={activeSettingsSection !== 'settings-group-notifications'} id="settings-group-notifications" aria-label={t('mobile.settings.section.notifications')}>
              {/*
                提醒送达：拒绝授权之后**唯一**的再授权入口（用户得先知道它被拒了，
                而入口必须和那句话在同一屏上 —— 挂在详情面板里等于要用户再找第二条路）。
              */}
              <ReminderNotifyPanel />
              {/*
                共享协作的**本地**通知偏好（W5）：它是同步的下游偏好（服务端只广播信号，
                响不响由本机过滤），所以归属是"打扰偏好"而不是"连到哪"。
                没配同步时整节不渲染，避免把一堆永不生效的开关摆到界面上。
              */}
              {syncConfigured ? <ShareNotificationSettings /> : null}
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
              <WidgetPushPanel active={activeSettingsSection === 'settings-group-notifications'} />
            </section>
            {/*
              G5 外观与语言：「它长什么样、怎么念」。

              🔴 组名改前叫「任务与显示」，而它装着主题、语言、日期显示方式、详情栏默认
              —— 一条都不"任务"。现在组名与内容终于一致（移动端同一组用同一条词条
              `mobile.settings.section.appearance`，两端一字不差）。
            */}
            <section className="ht-settings__group" hidden={activeSettingsSection !== 'settings-group-appearance'} id="settings-group-appearance" aria-label={t('mobile.settings.section.appearance')}>
            {/*
              🔴 **显示偏好**（2026-09-30 从任务页头搬进来）：「日期 | 倒计时」
              两个词悬在页头上，用户不知道它是什么、影响什么 —— 它其实是
              “任务行上的截止时间怎么显示”。显示偏好属于设置：带说明、带上下文。
              设备本地持久化（`due-display-pref.ts`），不进 op-log。
            */}
            {/*
              这一块是「一组行」，不是「一屏」—— 所以是 `.ht-settings` **加**
              `.ht-settings__rows`：内边距与字号照留（否则这一组的左缘会比别的组
              偏 16px），`gap` 归零。套整层 `.ht-settings` 的后果是四行之间各多出
              16px 空隙，行距中位数从 53 撑到 **72**，而判据钉的是 44–56；
              发丝线本来就在分节，再叠空隙等于把一屏拆成四个孤块。
            */}
            <section className="ht-settings ht-settings__rows" data-testid="display-pref-panel">
              {/* 左侧导航已经写着「外观与语言」；这里再写一个「显示」就是同一屏两行近义标题。 */}
              <div className="ht-settings__preference-row">
              <h3 className="ht-settings__h3 ht-type-row-title">{t('web.shell.dueMode.aria')}</h3>
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
              </div>
              {/* 窄窗会自动收起辅助栏；说明只解释这一项非直觉的行为。 */}
              <div className="ht-settings__preference-row">
                <div className="ht-settings__preference-label">
              <h3 className="ht-settings__h3 ht-type-row-title">
                {t('web.settings.display.detail.title')}
                <SettingsInfoTip
                  testId="tip-detail-pane"
                  label={t('web.settings.display.detail.title')}
                  text={t('web.settings.display.detailNote')}
                />
              </h3>
                </div>
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
              </div>
              <div className="ht-settings__preference-row">
                <h3 className="ht-settings__h3 ht-type-row-title">{t('web.shell.lang.label')}</h3>
                <LanguageSwitcher />
              </div>
              <div className="ht-settings__preference-row">
                <h3 className="ht-settings__h3 ht-type-row-title">{t('web.settings.display.themeTitle')}</h3>
              <button
                type="button"
                className="ht-settings__theme-toggle ht-type-row-title"
                aria-label={theme === 'light' ? t('common.a11y.toDarkTheme') : t('common.a11y.toLightTheme')}
                data-testid="theme-toggle"
                onClick={() => {
                  const next: Theme = theme === 'light' ? 'dark' : 'light';
                  // 🔴 这是**唯一**记账的地方：启动时的那次 `applyTheme` 只改 DOM。
                  // 否则"用户没做过选择"与"用户选了亮色"在存储里长得一模一样，
                  // 系统偏好从此再也进不来（`lib/theme.ts` 里记着症状）。
                  rememberThemeChoice(next);
                  setTheme(next);
                }}
              >
                {theme === 'light' ? <Sun size={ICON_SIZE.md} aria-hidden="true" /> : <Moon size={ICON_SIZE.md} aria-hidden="true" />}
                <span>
                  {theme === 'light' ? t('web.settings.display.themeLight') : t('web.settings.display.themeDark')}
                </span>
              </button>
              </div>
            </section>
            </section>
            {/*
              G6 功能与 AI = 「AI 与集成」+ 功能模块开关（2026-10 七组同构）。

              🔴 为什么并：这两块回答的是**同一个问题** —— "它要开哪些能力、
              AI 能拿我的数据做什么"。功能模块决定"这个应用长什么样"，
              AI 的三道闸决定"准不准拿数据出去" —— 都属于"开什么"。

              🔴 **功能模块排在这一组的最前**：关掉的模块从左侧导航消失，
              所以它是用户想减负时第一个该看到的东西（放最后会变成
              "翻到底才发现原来能关"）。它原来排在整个设置页最前、与主题/语言/提醒
              挤在同一组里 —— 那条理由在七组结构里落在这一组的最前。

              ⚠️ id 仍是 `settings-group-ai`；移动端这一组叫 `features`
              （"功能与 AI"），`settings-group-features` 由折叠表折到这里。
            */}
            <section className="ht-settings__group" hidden={activeSettingsSection !== 'settings-group-ai'} id="settings-group-ai" aria-label={t('mobile.settings.section.features')}>
              <FeatureModulesPanel enabled={enabledModules} onToggle={onToggleModule} />
              <AiSettings
                active={activeSettingsSection === 'settings-group-ai'}
                initial={aiSettings}
                secrets={aiSecrets}
                focusTarget={settingsFocus}
                // 托管档的端点来自同步服务器 ⇒ 没配就选不了（见该 prop 的注释）。
                managedServerReady={syncBaseUrl.trim() !== ''}
                // 「本周期已用 X / 300」—— 与托管通道同一对（地址 + **活**令牌）。
                managedUsage={{
                  baseUrl: syncBaseUrl,
                  getToken: async () => useSyncStore.getState().token,
                }}
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
            </section>
            {/*
              G7 关于与帮助（id 沿用 `settings-group-help`）。

              🔴 「帮助与关于」是**产品孤岛的另一半**：在此之前，应用里
              没有任何一处能到达站点的帮助 / 价格 / 更新动态。
              放在最后是按「关于」类内容的惯例 —— 它不是日常操作，
              但必须**存在**（否则用户在应用里遇到问题只能去搜索引擎找，
              而那意味着他会找到别家的产品）。
              ⚠️ 移动端这一组叫 `about`（同一条词条 `mobile.settings.section.about`），
              `settings-group-about` 由折叠表折到这里。
            */}
            <section className="ht-settings__group" hidden={activeSettingsSection !== 'settings-group-help'} id="settings-group-help" aria-label={t('mobile.settings.section.about')}>
              <div id="settings-help">
                <HelpPanel />
              </div>
            </section>
              </div>
            </div>
            )}
            </div>
          )}
        </div>
        {/*
          🔴 详情列的拖宽把手（产品负责人 2026-10-06 第 6 条：「右边那一栏…中间那条线
          应该是可以调整的。侧边栏的宽度都可以自己调整」）。
          它挂在 `.ht-main` 的右边缘上、**不在**被拖的那一列里 —— 详情列自己是滚动容器，
          而绝对定位的孩子会跟着内容滚走（滚一下之后就没有可拖的地方了），
          往槽里补一层滚动包装又被 `check:detail-pane-slot` 腿 A 判红。
          两条理由写在 `features/shell/ColumnResizer.tsx` 文件头。
          轨道归零（用户收起 / 这一栏没内容）时 CSS 把它一起藏掉 ——
          "能点、能聚焦、拖了没反应"是这一仓明令禁止的形状（见 `narrow.css` 里
          `.ht-sidebar__resizer { display: none }` 那一段的同一条理由）。
        */}
        {canToggleDetailPane ? <DetailColumnResizer /> : null}
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
       *   · 其余（含上述各面的未选中态）= AI Agent 面 `aiPanels`
       *
       * ⚠️ 它**曾经**是空的，而且那是设计不是半成品：产品负责人当时的原话是
       * "即使没东西也空在那里，一旦选中任何东西右边就出详细的面单"，被主计划 §5.4
       * 否决的是"没有选中态时往槽里塞装饰"。🔴 2026-10-04 那句被同一个人推翻
       * （「右边那一栏……无状态的时候就可以默认显示 AI Chatbot」），2026-10-05 起
       * 便签/习惯/任务三面按的是**正条**：选中才换面单，不另开第三处。
       *
       * ⚠️ 窄屏（≤1023px）这一列不出现，规则与算过的账在 `styles/app/narrow.css`。
       * AI Agent 在那几档**退回中间列**（`{detailColumnShown ? null : aiPanels}`，见上面任务列末尾），
       * 不跟着这一栏一起消失。
       * 🔴 落点只看"栏在不在画"（几何 + 用户选择），**不看**"栏里有没有东西"：
       * 栏里有没有东西恰恰取决于 AI 挂哪。2026-10-06 第一刀那版写成
       * `detailColumnShown && detailHasContent`，于是任务视图里那一栏先被判成空、
       * AI 永远进不去 —— 2026-10-04 那句拍板就是这样"落地了但从来没生效"的。
       * ⚠️ `detailRef` 仍然承重（它是"画没画出孩子"的取样点），不要摘掉。
       * 其余四面走 `detailColumnShown`（收起态/无位置时生产者自己不出）。
       *
       * ⚠️ 这一栏仍然**没有无障碍名**。"因为里面没内容"那句理由已经不成立（五面都在住），
       * 留着的是另一条：定名字就要新词条、中英必须成对，不在合流这一笔里顺手定。
       */}
      {assistantOverlay ? <div className="ht-app__assistant-backdrop" onClick={() => setCompactAssistantOpen(false)} /> : null}
      <aside
        id="assistant-detail"
        role={assistantOverlay ? 'dialog' : undefined}
        aria-modal={assistantOverlay ? true : undefined}
        aria-label={assistantOverlay ? t('web.ai.assistant.title') : undefined}
        data-assistant-overlay={assistantOverlay ? '' : undefined}
        ref={detailRef}
        className="ht-app__detail"
        data-testid="detail-column"
        /* W2：浮层开着这一栏不可见、不可聚焦、出 a11y 树。节点保持挂载 ——
           `detailRef` 上那枚 MutationObserver 是挂在节点上的，卸载再重挂会让
           `detailHasContent` 冻结在卸载前的值（effect 依赖是 `[]`）。 */
        hidden={view === 'settings'}
      >
        {assistantWorkspace ? aiPanels : contentView === 'focus' ? (
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
             🔴 "没选中"这一半住在 `taskPaneInColumn` 里（第二刀补的），不写在这一支上 ——
             因为同一枚布尔还决定行尾让不让位，拆开就会写成"行尾让位、栏里没人接"。
             🔴 备注编辑器的落点在**这一格**，所以行尾那颗备注 chip 在这一支成立时不渲染
             （`renderTaskTrailing` 里的 `noteInColumn`）—— 同一字段任何时刻只有一个所有者。 */
          <TaskDetailCard automationSlot={automationSlotNode} />
        ) : contentView === 'tasks' ? (
          /* 兜底那一格是 AI 面（2026-10-04 拍板：无选中时默认显示 Chatbot；
             2026-10-06 第二刀才真的兑现它，判据 = `ai-row-layout.spec.ts` 的落点那一支）。
             🔴 它排在**最后**：上面四面任一成立时这一栏已被占，AI 面不叠第二处。
             ⚠️ 它自己只在任务视图里画东西（`aiPanels` 里两支都 gated 到 `'tasks'`），
             所以四象限/时间线/日历等档的"未选中"仍然是一格没孩子 ⇒ 轨道归零、不占位。 */
          aiPanels
        ) : null}
      </aside>
      </div>
      {/* Keep global decisions outside the view grid: hidden views must not
          hide them, and mobile grid order must not put authentication above them. */}
      {/*
        🔴 行操作的两条渲染物：右键菜单与窄档的「任务详情」对话框。
        都排在**全局决策层之外**（与 `ConflictDialog` 同级），因为它们不是视图内容 ——
        任务视图切走时菜单必须已经不在了（`rowMenuTask` 那条 effect 会把失效的收走）。
      */}
      {rowMenu !== null && rowMenuTask !== undefined ? (
        <TaskRowMenu
          taskId={rowMenu.taskId}
          taskTitle={rowMenuTask.title}
          childCount={rowMenuChildCount}
          anchor={{ x: rowMenu.x, y: rowMenu.y }}
          onClose={closeRowMenu}
          onOpenDetail={openTask}
          onDelete={deleteTaskWithReceipt}
        />
      ) : null}

      {/*
        窄档的「任务详情」。走 `WebModalShell` 而不是自绘一层：关闭策略由
        `closePolicyOf('modal-readonly')` 裁决（背景 / Esc / 返回键都是出口 —— 这一层
        里没有"关掉就丢"的草稿，字段改一个写一个），焦点隔离与归还也在壳里。

        🔴 为什么要它：行尾那一排编辑器撤掉之后，**这一档是窄窗口下唯一能编辑字段的地方**。
        少了它，"改截止 / 加提醒 / 挂标签"在窄窗口里会整个消失，而且不报错。
      */}
      {detailDialogOpen && selectedTaskId !== null ? (
        <WebModalShell
          policy="modal-readonly"
          testId="task-detail-dialog"
          /* 两枚类名显式给：共享壳的缺省值只带**圆角**（`.ht-app__modal-*`，
             2026-11-03 起有定义），遮罩与居中仍归宿主。 */
          overlayClass="ht-row-menu__scrim"
          dialogClass="ht-row-menu__dialog"
          labelledBy="task-detail-dialog-title"
          onCancel={() => {
            setDetailDialogOpen(false);
          }}
        >
          <div className="ht-row-menu__dialog-head">
            <h2 id="task-detail-dialog-title" className="ht-type-panel-title" data-testid="task-detail-dialog-title">
              {t('web.rowMenu.detailTitle')}
            </h2>
            <button
              type="button"
              className="ht-row-menu__dialog-close"
              aria-label={t('web.rowMenu.detailClose')}
              data-testid="task-detail-dialog-close"
              onClick={() => {
                setDetailDialogOpen(false);
              }}
            >
              <X size={ICON_SIZE.sm} aria-hidden="true" />
            </button>
          </div>
          <TaskDetailCard automationSlot={automationSlotNode} />
        </WebModalShell>
      ) : null}

      <ConflictDialog />
      <PrivacyConsentSheet />
      <LegalReconfirmSheet />
      {shareDialog !== undefined ? (
        <ShareFeature
          projectId={shareDialog.projectId}
          initialShareId={shareDialog.shareId}
          onClose={() => setShareDialog(undefined)}
        />
      ) : null}
      </AiSettingsNavigationContext.Provider>
      </PanelEphemeralProvider>
    </HeytaUiProvider>
  );
}
