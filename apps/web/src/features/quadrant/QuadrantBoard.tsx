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
import { useI18n } from '@heyta/i18n';
import { Quadrant, bucketByQuadrant, planQuadrantDrop } from '@heyta/domain';
import { AlertCircle, CalendarClock, CheckCircle2, Trash2 } from 'lucide-react';

import { useTaskStore } from '../tasks/store.js';

const QUADRANT_ORDER: Quadrant[] = [
  Quadrant.UrgentImportant,
  Quadrant.ImportantNotUrgent,
  Quadrant.UrgentNotImportant,
  Quadrant.Neither,
];

/**
 * 每个象限的呈现信息。
 *
 * 🔴 `title` / `hint` 是**在组件里用 `t()` 现构造**的（见 `QuadrantBoard` 的
 * `useMemo`），不是"把 key 存进数据、渲染处再翻译" —— 数据数组里的文案
 * 门禁**看不见**，所以这里靠纪律：`apps/landing/src/Landing.tsx` 文件头
 * 解释了为什么选前者。
 */
interface QuadrantMeta {
  title: string;
  hint: string;
  token: TokenName;
}

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

function QuadrantCell({
  quadrant,
  meta,
  children,
}: {
  quadrant: Quadrant;
  meta: QuadrantMeta;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: quadrant });

  return (
    <section
      ref={setNodeRef}
      aria-label={t('web.quadrant.a11y.cell', { title: meta.title, hint: meta.hint })}
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
  const { t } = useI18n();
  const store = useTaskStore();
  const [activeId, setActiveId] = useState<string | undefined>();

  const buckets = useMemo(
    () => bucketByQuadrant(Object.values(store.entities.tasks), { now: store.now }),
    [store.entities.tasks, store.now],
  );

  /**
   * 四个象限的标题与说明。
   *
   * 🔴 文案**在这里用 `t()` 现构造**，而不是把 key 存进模块级数据再在渲染处翻译
   * （见 `QuadrantMeta` 上面的注释）。`t` 在同一语言下引用稳定，所以 `[t]`
   * 是正确且稳定的依赖。
   */
  const quadrantMeta = useMemo<Record<Quadrant, QuadrantMeta>>(
    () => ({
      [Quadrant.UrgentImportant]: {
        title: t('web.quadrant.do'),
        hint: t('web.quadrant.q1'),
        token: 'color.quadrant-1',
      },
      [Quadrant.ImportantNotUrgent]: {
        title: t('web.quadrant.plan'),
        hint: t('web.quadrant.q2'),
        token: 'color.quadrant-2',
      },
      [Quadrant.UrgentNotImportant]: {
        title: t('web.quadrant.delegate'),
        hint: t('web.quadrant.q3'),
        token: 'color.quadrant-3',
      },
      [Quadrant.Neither]: {
        title: t('web.quadrant.drop'),
        hint: t('web.quadrant.q4'),
        token: 'color.quadrant-4',
      },
    }),
    [t],
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

    // 🔴 **投放计划来自领域层的纯函数，不要在这里重算。**
    //
    // 这里原先是一段手写逻辑，带着两个缺陷（2026-09-26 读代码核实）：
    //   1. `if (urgent && task.dueDate === undefined)` 只处理"完全没有截止时间"，
    //      于是把"10 天后到期"的任务拖进 Q1 时，只设了 important，
    //      它**仍然不紧急** → 任务**弹回 Q2**。用户拖了等于没拖，且没有解释。
    //   2. 注释写着「一次操作 = 一条 op（AGENTS.md §3.4）：两个字段一次写完」，
    //      代码却是**两次 `await`** —— 注释描述的是意图，代码做的是另一件事。
    //
    // 根因是**逻辑放错了层**：放在组件事件处理里就没有测试，
    // 而这块看板至今**一个测试都没有**。`planQuadrantDrop` 现在穷举验证
    // "4 象限 × 3 种截止时间状态都必须真的落在目标格"。
    const plan = planQuadrantDrop(task, target, { now: store.now });

    // 一次拖放 = 一条 op。`plan.dueDateChange`（'pushed' / 'cleared'）
    // 留给需要提示"已改/已清除截止时间"的界面用。
    await store.setQuadrantDrop(taskId, plan);
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
          <QuadrantCell key={q} quadrant={q} meta={quadrantMeta[q]}>
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
                {t('web.quadrant.dropHere')}
              </li>
            )}
          </QuadrantCell>
        ))}
      </div>
      {/* 让拖拽有明确的进行中提示，屏幕阅读器也能感知 */}
      <p aria-live="polite" style={{ position: 'absolute', left: -9999 }}>
        {activeId !== undefined ? t('web.quadrant.dragging') : ''}
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
        {t('web.quadrant.footnote')}
        <CalendarClock size={14} aria-hidden="true" />
        <Trash2 size={14} aria-hidden="true" />
      </p>
    </DndContext>
  );
}
