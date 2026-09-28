/**
 * 应用外壳。
 *
 * UI 约定（见 design-system/heyta/MASTER.md）：
 *   - 图标一律 Lucide，**禁止 emoji**（跨平台渲染不一致且不受 token 控制）
 *   - 每个图标按钮必须有 `aria-label`，否则屏幕阅读器读到的是"按钮"
 *   - 数字加 `.tabular-nums`，避免计数变化时宽度跳动
 *   - 所有取值走 `var(--ht-*)`，**不出现裸 hex / px**
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  CalendarDays,
  ChartGantt,
  Check,
  CheckCircle2,
  CircleDot,
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

import { useI18n, type MessageKey } from '@heyta/i18n';

import {
  applyFeedbackCorrections,
  applyPreferenceCorrections,
  computeFocusGaps,
  inferFeedbackPreferences,
  inferPreferences,
  presentPreferenceIds,
  Priority,
  Quadrant,
  suppressedPreferenceIds,
  toLocalDate,
  type MemoryOp,
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
  TaskList,
  type TaskRow as SharedTaskRow,
} from '@heyta/ui';

import {
  selectQuadrantCounts,
  selectVisibleTasks,
  useTaskStore,
  type TaskFilter,
} from './features/tasks/store.js';
import { DueBadge, type DueDisplayMode } from './features/tasks/DueBadge.js';
import { TaskOrganizer } from './features/tasks/TaskOrganizer.js';
import { NoteEditor } from './features/tasks/NoteEditor.js';
import { CaptureComposer } from './features/capture/CaptureComposer.js';
import { useProjectStore } from './features/projects/store.js';
import { ConflictDialog } from './features/sync/ConflictDialog.js';
import { SyncBar } from './features/sync/SyncBar.js';
import { SubscriptionNotice } from './features/subscription/SubscriptionNotice.js';
import { ProjectsPanel } from './features/projects/ProjectsPanel.js';
import { QuadrantBoard } from './features/quadrant/QuadrantBoard.js';
import { HabitsView } from './features/habits/HabitsView.js';
import { GrowthView } from './features/motivation/GrowthView.js';
import { TodayProgressBanner } from './features/motivation/TodayProgressBanner.js';
import { NotesView } from './features/notes/NotesView.js';
import { ReminderPanel } from './features/reminders/ReminderPanel.js';
import { TimelineView } from './features/timeline/TimelineView.js';
import { AiBreakdown } from './features/ai/AiBreakdown.js';
import { AiPrioritize } from './features/ai/AiPrioritize.js';
import { AiDuration } from './features/ai/AiDuration.js';
import { AiToolRun } from './features/ai/AiToolRun.js';
import { AiSettingsNavigationContext } from './features/ai/ai-settings-navigation.js';
import type { SettingsTarget } from './features/ai/route-explanation.js';
import { AiSettings } from './features/settings/AiSettings.js';
import { ExportPanel } from './features/settings/ExportPanel.js';
import { HelpPanel } from './features/settings/HelpPanel.js';
import { ImportPanel } from './features/settings/ImportPanel.js';
import { MemoryPanel } from './features/settings/MemoryPanel.js';
// 通行密钥自助管理（列 / 删）—— 服务端早就有端点，此前界面没有任何入口。
import { PasskeyPanel } from './features/settings/PasskeyPanel.js';
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
type ViewKey = 'tasks' | 'quadrant' | 'habits' | 'focus' | 'timeline' | 'growth' | 'notes' | 'trash' | 'settings';

/**
 * 视图切换列表。
 *
 * 🔴 提出来当**唯一一份**定义：它既是顶栏的按钮，也是页面标题的来源。
 * 原来这张表内联在 JSX 里，而标题另有一条只从 `store.filter`（任务是域的概念）
 * 推导的逻辑 —— 于是在习惯 / 番茄钟 / 成长 / 设置 这些页面上，顶部标题写着
 * 「收集箱」：那是**上一个视图的残留**，会让人以为没切过去。
 * 同一件事写两遍，漂移是注定的。
 */
const VIEW_TABS: readonly { key: ViewKey; labelKey: MessageKey; Icon: LucideIcon }[] = [
  { key: 'tasks', labelKey: 'web.shell.nav.tasks', Icon: Inbox },
  { key: 'quadrant', labelKey: 'web.shell.nav.quadrant', Icon: CircleDot },
  { key: 'habits', labelKey: 'web.shell.views.habits', Icon: Check },
  { key: 'focus', labelKey: 'web.shell.views.focus', Icon: Sun },
  { key: 'timeline', labelKey: 'web.shell.views.timeline', Icon: ChartGantt },
  { key: 'growth', labelKey: 'web.shell.views.growth', Icon: TrendingUp },
  // 便签。放在成长之后、回收站之前：它是**日常会翻一眼**的轻量记录，
  // 与"成长"（长周期叙事）相邻，而回收站是低频的"找回来"。
  { key: 'notes', labelKey: 'web.shell.views.notes', Icon: StickyNote },
  // 回收站。放在设置前面：它是一个**日常会用到**的视图（误删之后要来这里），
  // 而设置是低频的。
  { key: 'trash', labelKey: 'web.trash.nav', Icon: Trash2 },
  { key: 'settings', labelKey: 'web.shell.views.settings', Icon: Settings },
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
  const [aiSettings, setAiSettings] = useState(loadAiSettings);
  /**
   * AI 面板的「去设置」请求：切到设置页并**落在哪一块**。
   *
   * `undefined` = 用户自己点进来的，不做任何定位。侧栏/视图 tab 的点击
   * 会把它清掉 —— 否则"上次从估时面板跳到授权区块"这件事会粘住，
   * 下次从别处进设置页时页面自己滚一下，看起来像故障。
   */
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
  // 🔴 密钥只在内存里，只活在这个标签页（Web 没有系统钥匙串）
  const [aiSecrets] = useState(createSessionSecretStore);
  /**
   * 截止时间的呈现方式。
   *
   * ⚠️ 它是**视图开关**，读的是同一个 `dueDate` 字段，可随时切回 ——
   * 这是刻意的（见 `DueBadge.tsx` 文件头）：倒计时是**待验证的 UI 假设**，
   * 做成开关才有对照组，也才能一键回退。
   */
  const [dueDisplay, setDueDisplay] = useState<DueDisplayMode>('date');

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

  return (
    /**
     * 🔴 「去设置」的导航通道。
     *
     * 四个 AI 面板里，捕获那个是 `CaptureComposer` 渲染的，而那个文件
     * 不在本轮的写入白名单里。用 context 让**唯一的新接入点**留在
     * `App.tsx`（视图切换本来就在这里），而不是为一个导航参数去改别的功能。
     */
    <AiSettingsNavigationContext.Provider value={openAiSettings}>
      <div className="ht-app">
      <nav className="ht-sidebar" aria-label={t('web.shell.nav.aria')}>
        <div className="ht-brand">
          <span className="ht-brand__dot" aria-hidden="true" />
          heyta
        </div>

        <div className="ht-nav">
          {PRIMARY_NAV.map((entry) => (
            <NavButton
              key={entry.labelKey}
              entry={entry}
              active={isActive(store.filter, entry.filter)}
              onClick={() => goToFilter(entry.filter)}
            />
          ))}
        </div>

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
          {view === 'tasks' && (
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
          {/* 视图切换。用 role=tablist 让屏幕阅读器理解这是一组互斥选项 */}
          <div role="tablist" aria-label={t('web.shell.views.aria')} className="ht-viewtabs">
            {VIEW_TABS.map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                className={`ht-viewtab${view === v.key ? ' ht-viewtab--active' : ''}`}
                onClick={() => {
                  // 用户自己导航 = 不定位。见 `settingsFocus` 的说明。
                  setSettingsFocus(undefined);
                  setView(v.key);
                }}
              >
                <v.Icon size={14} aria-hidden="true" />
                {t(v.labelKey)}
              </button>
            ))}
          </div>
          <div className="ht-header__actions">
            {/* 截止时间呈现方式开关。
                只在任务视图里有意义 —— 其他视图不显示截止时间。
                🔴 它是**开关**而不是固定行为：倒计时是待验证的 UI 假设，
                有开关才有对照组，也才能一键回退（见 DueBadge.tsx 文件头）。 */}
            {view === 'tasks' && (
              <div role="group" aria-label={t('web.shell.dueMode.aria')} className="ht-viewtabs">
                {(
                  [
                    { key: 'date', labelKey: 'web.shell.dueMode.date', Icon: CalendarDays },
                    { key: 'countdown', labelKey: 'web.shell.dueMode.countdown', Icon: Timer },
                  ] as const satisfies readonly { key: DueDisplayMode; labelKey: MessageKey; Icon: LucideIcon }[]
                ).map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    aria-pressed={dueDisplay === d.key}
                    className={`ht-viewtab${dueDisplay === d.key ? ' ht-viewtab--active' : ''}`}
                    onClick={() => setDueDisplay(d.key)}
                  >
                    <d.Icon size={14} aria-hidden="true" />
                    {t(d.labelKey)}
                  </button>
                ))}
              </div>
            )}
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
           * 今日进度（激励体系 L1）。
           *
           * 🔴 **它常驻在那几个"做事"的视图上**（任务 / 四象限 / 习惯 / 番茄钟），
           * 而不常驻设置页、成长页与回收站：设置页不产生完成，成长页本身就是在讲
           * 更长的尺度 —— 在那里再顶一条"今天 3/5"，会把"历史"重新压回"今天"，
           * 恰好抵消掉那个页面存在的意义；回收站是**找回**已删除东西的地方，
           * 顶一条今天的进度同样文不对题。
           *
           * 放在这里而不是放进各视图内部：它是**跨视图的同一件事**，
           * 放进四个视图就会长出四份，而它们必然漂移。
           *
           * 🔴 M3 第十一刀之后它来自 `@heyta/ui`（与 mobile 同一份实现），
           * 接线在 `features/motivation/TodayProgressBanner.tsx`（那里自己包了
           * `HeytaUiProvider`）—— 它会 `useHeytaUiTheme()`，缺了会在运行时抛错。
           * 不能复用下面 `tasks` 那棵树的 Provider：它只包住 `TaskList`，
           * 而进度卡是它的兄弟节点（同样的坑在 focus 那一刀已经踩过一次）。
           */}
          {view !== 'settings' && view !== 'growth' && view !== 'trash' && (
            <TodayProgressBanner />
          )}

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

          {/* AI 优先级建议（功能 ②）。
              🔴 它是**批量**的，而且只能出现在列表上方 —— "哪件事更重要"只有在
              互相比较时才成立；逐条问模型"这一条重要吗"既贵又没有意义。

              与 `AiBreakdown` 一样：配置关着时它**仍然在**，点了会说明该去开什么，
              而不是消失（"找不到入口"和"入口说为什么不可用"是两件事）。 */}
          {view === 'tasks' && visible.length > 0 && (
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
          {view === 'tasks' && (
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
          */}
          {view === 'tasks' &&
            (visible.length === 0 ? (
            <EmptyState filter={store.filter} />
          ) : (
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
            ))}

          {view === 'quadrant' && <QuadrantBoard />}
          {view === 'habits' && <HabitsView />}
          {/**
           * 番茄钟。**计时核心来自 `@heyta/ui` 的共享 `FocusPanel`**
           * （与 mobile 同一份实现）。
           *
           * 🔴 `HeytaUiProvider` 必须包在**这一处**：上面 `tasks` 那棵树的
           * Provider 不会覆盖到这里。`check:ui-provider` 只断言"宿主里出现过
           * Provider"，**不检查嵌套** —— 所以漏掉这一层时它照样全绿，
           * 而打开专注页会在运行时抛「useHeytaUiTheme 必须在 Provider 内使用」。
           */}
          {view === 'focus' && (
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
          {view === 'timeline' && (
            <TimelineView
              tasks={visible}
              startDate={toLocalDate(store.now)}
              today={toLocalDate(store.now)}
              now={store.now}
            />
          )}
          {view === 'growth' && <GrowthView />}
          {/* 便签。🔴 `NotesView` 里自带一层 `HeytaUiProvider` ——
              上面 tasks 那棵树的 Provider 不覆盖兄弟节点（见该文件头）。 */}
          {view === 'notes' && <NotesView />}
          {view === 'trash' && <TrashView />}
          {view === 'settings' && (
            <>
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
              {/* 导入 / 还原是导出的另一半 —— 只支持还原到空库，见 ImportPanel 文件头。 */}
              <ImportPanel />
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
              <HelpPanel />
            </>
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
