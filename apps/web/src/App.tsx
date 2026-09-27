/**
 * 应用外壳。
 *
 * UI 约定（见 design-system/heyta/MASTER.md）：
 *   - 图标一律 Lucide，**禁止 emoji**（跨平台渲染不一致且不受 token 控制）
 *   - 每个图标按钮必须有 `aria-label`，否则屏幕阅读器读到的是"按钮"
 *   - 数字加 `.tabular-nums`，避免计数变化时宽度跳动
 *   - 所有取值走 `var(--ht-*)`，**不出现裸 hex / px**
 */

import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CalendarDays, ChartGantt, Check, CircleDot, Inbox, Moon, Sun, Timer, Trash2, type LucideIcon, Settings } from 'lucide-react';

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

import {
  selectQuadrantCounts,
  selectVisibleTasks,
  useTaskStore,
  type TaskFilter,
} from './features/tasks/store.js';
import { DueBadge, type DueDisplayMode } from './features/tasks/DueBadge.js';
import { CaptureComposer } from './features/capture/CaptureComposer.js';
import { useProjectStore } from './features/projects/store.js';
import { ConflictDialog } from './features/sync/ConflictDialog.js';
import { SyncBar } from './features/sync/SyncBar.js';
import { SubscriptionNotice } from './features/subscription/SubscriptionNotice.js';
import { ProjectsPanel } from './features/projects/ProjectsPanel.js';
import { QuadrantBoard } from './features/quadrant/QuadrantBoard.js';
import { HabitsView } from './features/habits/HabitsView.js';
import { TimelineView } from './features/timeline/TimelineView.js';
import { AiBreakdown } from './features/ai/AiBreakdown.js';
import { AiPrioritize } from './features/ai/AiPrioritize.js';
import { AiDuration } from './features/ai/AiDuration.js';
import { AiSettings } from './features/settings/AiSettings.js';
import { MemoryPanel } from './features/settings/MemoryPanel.js';
import {
  createSessionSecretStore,
  loadAiSettings,
  saveAiSettings,
  toHealthSnapshot,
} from './features/settings/aiStore.js';
import { FocusTimer } from './features/focus/FocusTimer.js';
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
];

/**
 * 顶层视图。
 *
 * 为什么不用路由库：P1 只有四个平级视图、没有深链接需求、
 * 没有嵌套布局。引入 router 的收益（URL 可分享）在本地优先的单端
 * 场景下几乎不存在，而成本是又一个需要维护的依赖。
 * 到 P2 需要深链接时再引入 —— 那时才知道真实的约束是什么。
 */
type ViewKey = 'tasks' | 'quadrant' | 'habits' | 'focus' | 'timeline' | 'settings';

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

  const title = useMemo(() => {
    const f = store.filter;
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
    return t('web.shell.nav.tasks');
    // `t` 进依赖：语言变了标题必须跟着变。`projects.projects` 同理 ——
    // 清单改名后标题不该还是旧名字。
  }, [store.filter, projects.projects, t]);

  return (
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
              onClick={() => store.setFilter(entry.filter)}
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
              onClick={() => store.setFilter(entry.filter)}
            />
          ))}
        </div>
        <ProjectsPanel />
      </nav>

      <main className="ht-main">
        <header className="ht-header">
          <h1 className="ht-header__title">{title}</h1>
          {/* 视图切换。用 role=tablist 让屏幕阅读器理解这是一组互斥选项 */}
          <div role="tablist" aria-label={t('web.shell.views.aria')} className="ht-viewtabs">
            {(
              [
                { key: 'tasks', labelKey: 'web.shell.nav.tasks', Icon: Inbox },
                { key: 'quadrant', labelKey: 'web.shell.nav.quadrant', Icon: CircleDot },
                { key: 'habits', labelKey: 'web.shell.views.habits', Icon: Check },
                { key: 'focus', labelKey: 'web.shell.views.focus', Icon: Sun },
                { key: 'timeline', labelKey: 'web.shell.views.timeline', Icon: ChartGantt },
                { key: 'settings', labelKey: 'web.shell.views.settings', Icon: Settings },
              ] as const satisfies readonly { key: ViewKey; labelKey: MessageKey; Icon: LucideIcon }[]
            ).map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                className={`ht-viewtab${view === v.key ? ' ht-viewtab--active' : ''}`}
                onClick={() => setView(v.key)}
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

          {view === 'tasks' &&
            (visible.length === 0 ? (
            <EmptyState filter={store.filter} />
          ) : (
            <div className="ht-tasklist">
              {visible.map((task) => {
                const done = task.completedAt !== undefined;
                return (
                  <div
                    key={task.id}
                    className={`ht-task${done ? ' ht-task--done' : ''}`}
                  >
                    <button
                      type="button"
                      className="ht-task__check"
                      // ⚠️ 三元写在 `t(...)` **外面** —— 门禁只认"字面量紧跟 t("，
                      // `t(done ? 'a' : 'b')` 两种形状都认不出来。
                      aria-label={
                        done
                          ? t('web.shell.tasks.uncomplete', { title: task.title })
                          : t('web.shell.tasks.complete', { title: task.title })
                      }
                      aria-pressed={done}
                      onClick={() => store.toggleComplete(task.id)}
                    >
                      <Check size={12} aria-hidden="true" />
                    </button>

                    <span className="ht-task__title">{task.title}</span>

                    <span className="ht-task__meta">
                      <DueBadge task={task} mode={dueDisplay} now={store.now} />
                      {task.priority !== undefined &&
                        task.priority > Priority.None && (
                          <span>P{task.priority}</span>
                        )}
                    </span>

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
                      onClick={() => store.deleteTask(task.id)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
            ))}

          {view === 'quadrant' && <QuadrantBoard />}
          {view === 'habits' && <HabitsView />}
          {view === 'focus' && <FocusTimer />}
          {/**
           * 时间线（功能 ③）。排的是**当前视图里的任务**，每个任务一块。
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
          {view === 'settings' && (
            <AiSettings
              initial={aiSettings}
              secrets={aiSecrets}
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
          )}
        </div>
      </main>
    </div>
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
  if (current.kind === 'quadrant' && target.kind === 'quadrant') {
    return current.quadrant === target.quadrant;
  }
  return true;
}
