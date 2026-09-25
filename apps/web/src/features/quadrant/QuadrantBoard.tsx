/**
 * 四象限矩阵（艾森豪威尔）
 * ==========================
 *
 * 为什么**自研布局**：调研过，没有成熟的开源四象限矩阵组件 ——
 * 这个布局本身只有 2×2 网格，自研成本远低于适配一个通用看板组件。
 * 但**拖拽用 `dnd-kit`**（MIT，2026-09 仍在更新），不自己写
 * pointer 事件、键盘可达性、自动滚动那一套 —— 那才是真正昂贵的部分。
 *
 * 拖拽的语义：把一个任务丢到某个象限 = 一次**多字段**变更
 * （important + 紧急窗口）。按 AGENTS.md §3.4，
 * **一次操作 = 一条 op**，所以两个字段在一次 dispatch 里写完。
 */

import { useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { cssVar, type TokenName } from '@heyta/design-system';
import { Quadrant, bucketByQuadrant } from '@heyta/domain';
import { AlertCircle, CalendarClock, CheckCircle2, Trash2 } from 'lucide-react';

import { useTaskStore } from '../tasks/store.js';

const QUADRANT_ORDER: Quadrant[] = [
  Quadrant.UrgentImportant,
  Quadrant.ImportantNotUrgent,
  Quadrant.UrgentNotImportant,
  Quadrant.Neither,
];

const QUADRANT_META: Record<
  Quadrant,
  { title: string; hint: string; token: TokenName }
> = {
  [Quadrant.UrgentImportant]: {
    title: '马上做',
    hint: '重要且紧急',
    token: 'color.quadrant-1',
  },
  [Quadrant.ImportantNotUrgent]: {
    title: '计划做',
    hint: '重要不紧急',
    token: 'color.quadrant-2',
  },
  [Quadrant.UrgentNotImportant]: {
    title: '交给别人',
    hint: '紧急不重要',
    token: 'color.quadrant-3',
  },
  [Quadrant.Neither]: {
    title: '先不做',
    hint: '不重要不紧急',
    token: 'color.quadrant-4',
  },
};

/**
 * 类型守卫：穷举比较，**不做数组强转**。
 *
 * `Quadrant` 是 TS enum（名义类型），`Quadrant[] as string[]` 编译不过；
 * 而 `as unknown as string[]` 只是把类型系统关掉。穷举写法既通过检查，
 * 又能在新增象限时被注意到（下面的 switch 会漏掉新分支）。
 */
function isQuadrant(value: unknown): value is Quadrant {
  switch (value) {
    case Quadrant.UrgentImportant:
    case Quadrant.ImportantNotUrgent:
    case Quadrant.UrgentNotImportant:
    case Quadrant.Neither:
      return true;
    default:
      return false;
  }
}

function DraggableTask({ id, title }: { id: string; title: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        // 位移用 transform（合成层），不做布局位移 —— 避免重排与抖动
        transform: transform
          ? `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0)`
          : undefined,
        opacity: isDragging ? 0.6 : 1,
        cursor: 'grab',
        listStyle: 'none',
        padding: cssVar('space.2'),
        marginBottom: cssVar('space.2'),
        background: cssVar('color.surface'),
        border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
        borderRadius: cssVar('radius.md'),
        fontSize: cssVar('font-size.sm'),
        color: cssVar('color.foreground'),
        // 拖拽是即时反馈，不需要过渡；加了反而拖影
        touchAction: 'none',
      }}
    >
      {title}
    </li>
  );
}

function QuadrantCell({ quadrant, children }: { quadrant: Quadrant; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: quadrant });
  const meta = QUADRANT_META[quadrant];

  return (
    <section
      ref={setNodeRef}
      aria-label={`${meta.title}（${meta.hint}）`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: cssVar('layout.quadrant-min-height'),
        padding: cssVar('space.3'),
        borderRadius: cssVar('radius.lg'),
        background: cssVar('color.surface'),
        // 用**边框**表达层次与拖拽悬停，不用位移或阴影 ——
        // 阴影只给真正的浮层（这里是平面内容）
        border: `${cssVar('border-width.thick')} solid ${
          isOver ? cssVar('color.primary') : cssVar('color.border')
        }`,
        transition: `border-color ${cssVar('duration.fast')} ${cssVar('ease.standard')}`,
      }}
    >
      <header style={{ marginBottom: cssVar('space.2') }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: cssVar('space.2'),
            fontWeight: cssVar('font-weight.semibold'),
            color: cssVar('color.foreground'),
            fontSize: cssVar('font-size.sm'),
          }}
        >
          {/* 色块：象限色只在这里出现，用语义 token 而非原始色阶 */}
          <span
            aria-hidden="true"
            style={{
              width: cssVar('icon.sm'),
              height: cssVar('icon.sm'),
              borderRadius: cssVar('radius.full'),
              background: cssVar(meta.token as TokenName),
            }}
          />
          {meta.title}
        </div>
        <p
          style={{
            margin: `${cssVar('space.1')} 0 0`,
            fontSize: cssVar('font-size.2xs'),
            color: cssVar('color.foreground-muted'),
          }}
        >
          {meta.hint}
        </p>
      </header>
      <ul style={{ margin: 0, padding: 0, flex: 1 }}>{children}</ul>
    </section>
  );
}

export function QuadrantBoard() {
  const store = useTaskStore();
  const [activeId, setActiveId] = useState<string | undefined>();

  const buckets = useMemo(
    () => bucketByQuadrant(Object.values(store.entities.tasks), { now: store.now }),
    [store.entities.tasks, store.now],
  );

  // 键盘也能拖 —— 只用 PointerSensor 会把键盘用户排除在外
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    setActiveId(undefined);
    const over = event.over?.id;
    if (over === undefined || typeof over !== 'string') return;

    // 用类型守卫而不是 `as Quadrant` —— 强转会掩盖"拖到了非象限目标"的
    // 情况（比如拖到列表外），那样会静默产生一条无意义的 op。
    if (!isQuadrant(over)) return;
    const target = over;

    const taskId = String(event.active.id);
    const task = store.entities.tasks[taskId];
    if (task === undefined) return;

    // 拖进"重要"象限 = important: true；拖进"不重要"= false。
    // 紧急维度由截止时间决定，拖拽不直接控制它 ——
    // 但为了拖拽有确定结果，切到 Q1/Q3（紧急侧）时把截止时间提前到窗口内。
    const important =
      target === Quadrant.UrgentImportant || target === Quadrant.ImportantNotUrgent;
    const urgent = target === Quadrant.UrgentImportant || target === Quadrant.UrgentNotImportant;

    // 一次操作 = 一条 op（AGENTS.md §3.4）：两个字段一次写完
    await store.setImportant(taskId, important);
    if (urgent && task.dueDate === undefined) {
      await store.setDueDate(taskId, Date.now() + 60 * 60 * 1000);
    } else if (!urgent && task.dueDate !== undefined) {
      await store.setDueDate(taskId, undefined);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={(e) => {
        void handleDragEnd(e);
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: cssVar('space.3'),
          padding: cssVar('space.4'),
        }}
      >
        {QUADRANT_ORDER.map((q) => (
          <QuadrantCell key={q} quadrant={q}>
            {buckets[q].map((task) => (
              <DraggableTask key={task.id} id={task.id} title={task.title} />
            ))}
            {buckets[q].length === 0 && (
              <li
                style={{
                  listStyle: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: cssVar('space.2'),
                  fontSize: cssVar('font-size.2xs'),
                  color: cssVar('color.foreground-muted'),
                }}
              >
                {/* 空态给图标而不是 emoji —— emoji 跨平台渲染不一致且不受 token 控制 */}
                <CheckCircle2 size={16} aria-hidden="true" />
                拖任务到这里
              </li>
            )}
          </QuadrantCell>
        ))}
      </div>
      {/* 让拖拽有明确的进行中提示，屏幕阅读器也能感知 */}
      <p aria-live="polite" style={{ position: 'absolute', left: -9999 }}>
        {activeId !== undefined ? '正在拖拽任务' : ''}
      </p>
      <p
        style={{
          margin: `${cssVar('space.2')} ${cssVar('space.4')}`,
          fontSize: cssVar('font-size.2xs'),
          color: cssVar('color.foreground-muted'),
          display: 'flex',
          alignItems: 'center',
          gap: cssVar('space.2'),
        }}
      >
        <AlertCircle size={14} aria-hidden="true" />
        紧急程度由截止时间决定；拖拽只改「重要」并把截止时间推入/移出 2 天窗口
        <CalendarClock size={14} aria-hidden="true" />
        <Trash2 size={14} aria-hidden="true" />
      </p>
    </DndContext>
  );
}
