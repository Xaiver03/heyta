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
import { CalendarDays, Check, CircleDot, Inbox, Moon, Sun, Timer, TrendingUp, Trash2, type LucideIcon, Settings } from 'lucide-react';

import {
  applyFeedbackCorrections,
  applyPreferenceCorrections,
  inferFeedbackPreferences,
  inferPreferences,
  presentPreferenceIds,
  Priority,
  Quadrant,
  suppressedPreferenceIds,
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
import { ProjectsPanel } from './features/projects/ProjectsPanel.js';
import { QuadrantBoard } from './features/quadrant/QuadrantBoard.js';
import { HabitsView } from './features/habits/HabitsView.js';
import { GrowthView } from './features/motivation/GrowthView.js';
import { TodayProgressCard } from './features/motivation/TodayProgressCard.js';
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
import { applyTheme, resolveInitialTheme, type Theme } from './lib/theme.js';

import './styles/app.css';

interface NavEntry {
  filter: TaskFilter;
  label: string;
  icon: LucideIcon;
  /** 象限色块的 CSS 类；非象限项为 undefined。 */
  swatch?: string;
}

const QUADRANT_NAV: NavEntry[] = [
  {
    filter: { kind: 'quadrant', quadrant: Quadrant.UrgentImportant },
    label: '重要且紧急',
    icon: CircleDot,
    swatch: 'ht-swatch--q1',
  },
  {
    filter: { kind: 'quadrant', quadrant: Quadrant.ImportantNotUrgent },
    label: '重要不紧急',
    icon: CircleDot,
    swatch: 'ht-swatch--q2',
  },
  {
    filter: { kind: 'quadrant', quadrant: Quadrant.UrgentNotImportant },
    label: '紧急不重要',
    icon: CircleDot,
    swatch: 'ht-swatch--q3',
  },
  {
    filter: { kind: 'quadrant', quadrant: Quadrant.Neither },
    label: '不重要不紧急',
    icon: CircleDot,
    swatch: 'ht-swatch--q4',
  },
];

const PRIMARY_NAV: NavEntry[] = [
  { filter: { kind: 'all' }, label: '收集箱', icon: Inbox },
  { filter: { kind: 'today' }, label: '今天', icon: Sun },
];

/**
 * 顶层视图。
 *
 * 为什么不用路由库：P1 只有四个平级视图、没有深链接需求、
 * 没有嵌套布局。引入 router 的收益（URL 可分享）在本地优先的单端
 * 场景下几乎不存在，而成本是又一个需要维护的依赖。
 * 到 P2 需要深链接时再引入 —— 那时才知道真实的约束是什么。
 */
type ViewKey = 'tasks' | 'quadrant' | 'habits' | 'focus' | 'growth' | 'settings';

export function App(): React.JSX.Element {
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
    };
  }, [aiSettings.memoryEnabled, store.entities]);


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
    if (f.kind === 'all') return '收集箱';
    if (f.kind === 'today') return '今天';
    if (f.kind === 'completed') return '已完成';
    // filter 是判别联合（含 all/today/completed/quadrant/project），
    // **必须显式判 kind** 才能访问各自特有字段 —— 直接取 f.quadrant 编译不过。
    if (f.kind === 'quadrant') {
      return (
        QUADRANT_NAV.find(
          (n) => n.filter.kind === 'quadrant' && n.filter.quadrant === f.quadrant,
        )?.label ?? '四象限'
      );
    }
    if (f.kind === 'project') {
      return projects.projects.find((p) => p.id === f.projectId)?.name ?? '清单';
    }
    return '任务';
  }, [store.filter]);

  return (
    <div className="ht-app">
      <nav className="ht-sidebar" aria-label="主导航">
        <div className="ht-brand">
          <span className="ht-brand__dot" aria-hidden="true" />
          heyta
        </div>

        <div className="ht-nav">
          {PRIMARY_NAV.map((entry) => (
            <NavButton
              key={entry.label}
              entry={entry}
              active={isActive(store.filter, entry.filter)}
              onClick={() => store.setFilter(entry.filter)}
            />
          ))}
        </div>

        <div className="ht-nav__section">四象限</div>
        <div className="ht-nav">
          {QUADRANT_NAV.map((entry) => (
            <NavButton
              key={entry.label}
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
          <div role="tablist" aria-label="视图" className="ht-viewtabs">
            {(
              [
                { key: 'tasks', label: '任务', Icon: Inbox },
                { key: 'quadrant', label: '四象限', Icon: CircleDot },
                { key: 'habits', label: '习惯', Icon: Check },
                { key: 'focus', label: '番茄钟', Icon: Sun },
                { key: 'growth', label: '成长', Icon: TrendingUp },
                { key: 'settings', label: '设置', Icon: Settings },
              ] as const
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
                {v.label}
              </button>
            ))}
          </div>
          <div className="ht-header__actions">
            {/* 截止时间呈现方式开关。
                只在任务视图里有意义 —— 其他视图不显示截止时间。
                🔴 它是**开关**而不是固定行为：倒计时是待验证的 UI 假设，
                有开关才有对照组，也才能一键回退（见 DueBadge.tsx 文件头）。 */}
            {view === 'tasks' && (
              <div role="group" aria-label="截止时间显示方式" className="ht-viewtabs">
                {(
                  [
                    { key: 'date', label: '日期', Icon: CalendarDays },
                    { key: 'countdown', label: '倒计时', Icon: Timer },
                  ] as const
                ).map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    aria-pressed={dueDisplay === d.key}
                    className={`ht-viewtab${dueDisplay === d.key ? ' ht-viewtab--active' : ''}`}
                    onClick={() => setDueDisplay(d.key)}
                  >
                    <d.Icon size={14} aria-hidden="true" />
                    {d.label}
                  </button>
                ))}
              </div>
            )}
            <SyncBar />
        <ConflictDialog />
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              aria-label={theme === 'light' ? '切换到暗色主题' : '切换到亮色主题'}
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
           * 🔴 **它常驻在三个"做事"的视图上**（任务 / 四象限 / 习惯 / 番茄钟），
           * 而不常驻设置页与成长页：设置页不产生完成，成长页本身就是在讲
           * 更长的尺度 —— 在那里再顶一条"今天 3/5"，会把"历史"重新压回"今天"，
           * 恰好抵消掉那个页面存在的意义。
           *
           * 放在这里而不是放进各视图内部：它是**跨视图的同一件事**，
           * 放进四个视图就会长出四份，而它们必然漂移。
           */}
          {view !== 'settings' && view !== 'growth' && <TodayProgressCard />}

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
                      aria-label={done ? `取消完成：${task.title}` : `完成：${task.title}`}
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
                      aria-label={`删除：${task.title}`}
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
          {view === 'growth' && <GrowthView />}
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
      {entry.label}
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
  const messages: Record<string, { title: string; hint: string }> = {
    all: { title: '收集箱是空的', hint: '在上面输入框添加第一个任务' },
    today: { title: '今天没有到期任务', hint: '给任务设个截止时间，它会出现在这里' },
    completed: { title: '还没有完成的任务', hint: '完成一个任务试试' },
    quadrant: { title: '这个象限是空的', hint: '给任务标记重要程度与截止时间' },
  };
  const msg = messages[filter.kind] ?? messages['all']!;

  return (
    <div className="ht-empty">
      <Inbox className="ht-empty__icon" size={40} aria-hidden="true" />
      <p className="ht-empty__title">{msg.title}</p>
      <p className="ht-empty__hint">{msg.hint}</p>
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
