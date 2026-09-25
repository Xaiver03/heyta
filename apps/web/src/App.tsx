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
import {
  Check,
  CircleDot,
  Inbox,
  Moon,
  Plus,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import { Priority, Quadrant } from '@heyta/domain';

import {
  selectQuadrantCounts,
  selectVisibleTasks,
  useTaskStore,
  type TaskFilter,
} from './features/tasks/store.js';
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

export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);
  const store = useTaskStore();
  const visible = useTaskStore(selectVisibleTasks);
  const counts = useTaskStore(selectQuadrantCounts);
  const [draft, setDraft] = useState('');

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
    return QUADRANT_NAV.find((n) => n.filter.kind === 'quadrant' &&
      n.filter.quadrant === f.quadrant)?.label ?? '任务';
  }, [store.filter]);

  function submit(): void {
    store.addTask(draft);
    setDraft('');
  }

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
      </nav>

      <main className="ht-main">
        <header className="ht-header">
          <h1 className="ht-header__title">{title}</h1>
          <div className="ht-header__actions">
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
          <div className="ht-compose">
            <input
              className="ht-input"
              value={draft}
              placeholder="添加任务，回车确认"
              aria-label="新任务标题"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              onClick={submit}
              disabled={draft.trim() === ''}
            >
              <Plus size={18} aria-hidden="true" />
              添加
            </button>
          </div>

          {visible.length === 0 ? (
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
                      {task.priority !== undefined &&
                        task.priority > Priority.None && (
                          <span>P{task.priority}</span>
                        )}
                    </span>

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
