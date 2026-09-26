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
import { CalendarDays, Check, CircleDot, Inbox, Moon, Sun, Timer, Trash2, type LucideIcon, Settings } from 'lucide-react';

import { inferPreferences, Priority, Quadrant } from '@heyta/domain';

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
import { AiBreakdown } from './features/ai/AiBreakdown.js';
import { AiSettings } from './features/settings/AiSettings.js';
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
type ViewKey = 'tasks' | 'quadrant' | 'habits' | 'focus' | 'settings';

export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);
  const store = useTaskStore();
  const projects = useProjectStore();
  const visible = useTaskStore(selectVisibleTasks);
  const counts = useTaskStore(selectQuadrantCounts);
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
   * ⚠️ `memoryEnabled` 为 false 时它**立刻返回空集**，
   * 所以下面传给界面的东西里一个偏好都不会有。
   */
  const preferenceSet = useMemo(
    () =>
      inferPreferences({
        memoryEnabled: aiSettings.memoryEnabled,
        tasks: Object.values(store.entities.tasks),
        focusSessions: Object.values(store.entities.focusSessions),
        now: Date.now(),
        // `getTimezoneOffset()` 是「本地比 UTC 晚多少分钟」（东八区为 -480），
        // 取负号得到常规的「UTC 偏移」。**必须显式传**，
        // 否则偏好层会去读运行环境的时区，也就无法从 op-log 确定重建。
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
      }),
    // `store.entities` 变了就重算；`now` 刻意不进依赖 ——
    // 时间是给"当场算一次"用的，分钟级漂移不影响这批偏好的结论。
    [aiSettings.memoryEnabled, store.entities],
  );

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
          <CaptureComposer />

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
                      preferenceSet={preferenceSet}
                      onApplyNote={(note) => store.setNote(task.id, note)}
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
          {view === 'settings' && (
            <AiSettings
              initial={aiSettings}
              secrets={aiSecrets}
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
