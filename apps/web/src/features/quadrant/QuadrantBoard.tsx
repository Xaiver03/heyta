/**
 * 四象限矩阵（Web 壳）
 * ======================
 *
 * 2×2 矩阵、每格的标题/色块/空格占位/无障碍名，以及**格里的任务行**，
 * 全部由 `@heyta/ui` 的 `QuadrantBoard` 渲染 —— 与 mobile 是**同一份实现**。
 * 本文件只回答 web 自己的两个问题：
 *
 *   1. 任务与"现在"从哪来 → `useTaskStore`（分桶/排序在 `@heyta/ui` 的
 *      `toQuadrantCards`，投放计划在 `@heyta/domain` 的 `planQuadrantDrop`，
 *      排序计划在 `planManualReorder`，本文件一条都不重算）；
 *   2. web 特有的交互 → **拖放**。`@dnd-kit/*` 是 DOM 库，装不进共享层
 *      （那等于让 iOS 去解析 DOM），所以拖放整套留在这里。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 2026-11-24：**没有任何按钮** —— 移动完全靠拖
 *
 * 产品负责人：「不要做什么移动和拖拽按钮……直接通过拖拽的方式来移动就可以了。
 * 拖拽上下、移动到另外的上下位置都可以，不要搞什么按钮。」
 *
 * 于是这一版删掉了两样东西：
 *   · 行尾的 `<select>「移动」`（下拉到别的象限）；
 *   · 行尾的拖拽握把按钮。
 * 换成：**整行就是拖拽节点**（`TaskList.renderRowWrapper` 注入 `useSortable` 的
 * `ref` + `listeners`）。手势分两种落点：
 *   · 同格内上下 → `planManualReorder` 写 `Task.order`（一条 op，中值法）；
 *   · 跨到另一格 → `planQuadrantDrop` 改 important/dueDate，同时把落点位置的
 *     `order` 一并写进**同一条 op**（见 `QuadrantTaskPatch.order`）。
 *
 * ⚠️ 已知取舍：整行拖拽用 PointerSensor（距离阈值 6px，故点勾选框/点行仍成立）。
 * 原来的"下拉框"是键盘用户跨象限移动的唯一入口，删掉它后**键盘不能移动任务**；
 * 这是"去掉按钮"的直接代价，不是实现疏漏。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cssVar } from '@heyta/design-system';
import {
  Quadrant,
  manualOrderBetween,
  manualOrderKey,
  planManualReorder,
  planQuadrantDrop,
  planQuadrantDropUndo,
  type QuadrantTaskPatch,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  HeytaUiProvider,
  QuadrantBoard as SharedQuadrantBoard,
  toQuadrantCards,
  type QuadrantCardModel,
  type TaskRow,
} from '@heyta/ui';

import { useTaskStore } from '../tasks/store.js';
import { UndoReceipt } from '../../lib/feedback/UndoReceipt.js';
import { quadrantBoardLabels } from './copy.js';

/**
 * 类型守卫：穷举比较，**不做数组强转**。
 * `event.over.id` 的类型是 `UniqueIdentifier`（`string | number`），
 * 强转会掩盖"拖到了非象限目标"。
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

/** dnd-kit 给行/格挂的 data 形状。 */
interface DragData {
  readonly kind: 'row' | 'cell';
  readonly quadrant: Quadrant;
  readonly index?: number;
}

/**
 * 整行的拖拽节点（宿主经 `TaskList.renderRowWrapper` 注入）。
 *
 * 🔴 它必须是**组件**（不能在渲染回调里直接调 `useSortable`）：
 * `useSortable` 是 hook，而 `renderRowWrapper` 是 `TaskList` 渲染过程中被调用的普通函数。
 *
 * 样式：`features/**` 的内联样式是只减不增的棘轮账本，所以动态几何（transform /
 * transition）先算成一个变量再传，不写 `style={{…}}`。
 */
function QuadrantSortableRow({
  id,
  quadrant,
  index,
  children,
}: {
  id: string;
  quadrant: Quadrant;
  index: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const sortable = useSortable({ id, data: { kind: 'row', quadrant, index } satisfies DragData });
  const rowStyle = useMemo(
    () => ({
      transform: CSS.Transform.toString(sortable.transform),
      transition: sortable.transition,
      zIndex: sortable.isDragging ? cssVar('z.sticky') : undefined,
      position: 'relative' as const,
      opacity: sortable.isDragging ? 0.5 : undefined,
      // 触屏上允许纵向拖动整行（否则会被当成滚动手势）。
      touchAction: 'none' as const,
    }),
    [sortable.transform, sortable.transition, sortable.isDragging],
  );
  return (
    <div
      ref={sortable.setNodeRef}
      {...(sortable.listeners ?? {})}
      style={rowStyle}
      data-testid={`quadrant-row-${id}`}
      data-dragging={sortable.isDragging ? 'true' : undefined}
    >
      {children}
    </div>
  );
}

/**
 * 格子里的**投放区**（空格子也能收东西）。
 *
 * 它只需要一个有尺寸的节点 —— dnd-kit 按 rect 命中，不靠事件冒泡；
 * 共享层把它放在 `pointerEvents: none` 的绝对定位容器里，所以不会挡住行。
 */
function CellDropZone({ quadrant }: { quadrant: Quadrant }) {
  const { setNodeRef } = useDroppable({
    id: `cell:${String(quadrant)}`,
    data: { kind: 'cell', quadrant } satisfies DragData,
  });
  return <div ref={setNodeRef} data-quadrant={quadrant} style={{ width: '100%', height: '100%' }} />;
}

/**
 * 象限标题行的**计数徽标** —— 2026-11-24 起**不再显示**。
 *
 * 产品负责人：「不用显示 4 个 0，不需要显示数字，显示这个数字的意味是什么呢？」
 * 滴答的四象限标题行也没有计数。格子有多少条，往下看就是，不需要一个数字
 * 再复述一遍（同一件事的第二份表达）。所以这一整块连同 `renderHeaderTrailing`
 * 一起删掉了；共享层的插槽仍在（移动端/将来若需要可再用）。
 */

interface QuadrantBoardProps {
  readonly onOpenTask?: (taskId: string) => void;
  readonly activeTaskId?: string | null;
}

export function QuadrantBoard({ onOpenTask, activeTaskId }: QuadrantBoardProps = {}) {
  const { t } = useI18n();
  const store = useTaskStore();
  const [activeId, setActiveId] = useState<string | undefined>();
  const [overQuadrant, setOverQuadrant] = useState<Quadrant | null>(null);
  const [dropNotice, setDropNotice] = useState<{ readonly text: string; readonly error: boolean } | undefined>(undefined);
  const [undoDrop, setUndoDrop] = useState<{ taskId: string; plan: QuadrantTaskPatch } | null>(null);

  /**
   * 两列还是单列 —— 断点读 token，判定听窗口（理由见共享层 props 注释）。
   */
  const [twoColumns, setTwoColumns] = useState(false);
  useEffect(() => {
    const min = getComputedStyle(document.documentElement)
      .getPropertyValue('--ht-layout-two-column-min')
      .trim();
    if (min === '') return;
    const query = window.matchMedia(`(min-width: ${min})`);
    const onChange = (): void => {
      setTwoColumns(query.matches);
    };
    onChange();
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  const tasks = useMemo(() => Object.values(store.entities.tasks), [store.entities.tasks]);
  /** 与共享板**同一份纯投影**（`toQuadrantCards`），据此算"第一个空格"、行位置。 */
  const cards = useMemo(() => toQuadrantCards(tasks, store.now), [tasks, store.now]);
  const firstEmptyQuadrant = useMemo(() => cards.find((card) => card.count === 0)?.quadrant, [cards]);

  /** `taskId → { quadrant, index }`：整行拖拽要知道自己在哪一格、第几行。 */
  const rowLocation = useMemo(() => {
    const map = new Map<string, { quadrant: Quadrant; index: number }>();
    for (const card of cards) {
      card.tasks.forEach((task, index) => {
        map.set(task.id, { quadrant: card.quadrant, index });
      });
    }
    return map;
  }, [cards]);

  const labels = useMemo(
    () => quadrantBoardLabels(t, { firstEmptyQuadrant }),
    [t, firstEmptyQuadrant],
  );
  const taskLabels = useMemo(
    () => ({
      toggleOn: (row: TaskRow) => t('web.shell.tasks.complete', { title: row.title }),
      toggleOff: (row: TaskRow) => t('web.shell.tasks.uncomplete', { title: row.title }),
    }),
    [t],
  );

  // 整行拖拽：距离阈值让"点一下"仍然是点击（勾选/打开），只有拖动才起拖。
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  /**
   * 碰撞：**行优先**。行本身也是 droppable，格子投放区铺满整格 —— 若一视同仁，
   * 格子中心常常比某一行更近，"拖到第 3 行"会被判成"拖到格子末尾"。
   * 先把命中的行挑出来，没有行才退到格子。
   */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const hits = pointerWithin(args);
    const rowHits = hits.filter((collision) => !String(collision.id).startsWith('cell:'));
    if (rowHits.length > 0) return rowHits;
    if (hits.length > 0) return hits;
    return closestCenter(args);
  }, []);

  const renderCellOverlay = useCallback(
    (card: QuadrantCardModel) => <CellDropZone quadrant={card.quadrant} />,
    [],
  );

  const renderCellBodyWrapper = useCallback(
    (card: QuadrantCardModel, node: React.ReactNode) => (
      <SortableContext items={card.tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        {node}
      </SortableContext>
    ),
    [],
  );

  const renderRowWrapper = useCallback(
    (row: TaskRow, node: React.ReactNode) => {
      const info = rowLocation.get(row.id);
      if (info === undefined) return node;
      return (
        <QuadrantSortableRow id={row.id} quadrant={info.quadrant} index={info.index}>
          {node}
        </QuadrantSortableRow>
      );
    },
    [rowLocation],
  );

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    setActiveId(undefined);
    setOverQuadrant(null);
    const { active, over } = event;
    if (over === null) return;
    const fromData = active.data.current as DragData | undefined;
    const overData = over.data.current as DragData | undefined;
    if (fromData === undefined || overData === undefined) return;
    const fromQuadrant = fromData.quadrant;
    const toQuadrant = overData.quadrant;
    if (!isQuadrant(fromQuadrant) || !isQuadrant(toQuadrant)) return;

    const taskId = String(active.id);
    const targetCard = cards.find((card) => card.quadrant === toQuadrant);
    const targetTasks = targetCard?.tasks ?? [];
    const toIndex =
      overData.kind === 'row' && overData.index !== undefined ? overData.index : targetTasks.length;

    // ── 同格内上下排序：只写 `Task.order`（一条 op，中值法在领域层）──
    if (fromQuadrant === toQuadrant) {
      const fromIndex = fromData.index ?? targetTasks.findIndex((task) => task.id === taskId);
      const plan = planManualReorder(targetTasks, fromIndex, toIndex);
      if (plan === undefined) return;
      try {
        if (plan.kind === 'move') {
          await store.setOrder(plan.id, plan.order);
        } else {
          for (const entry of plan.orders) {
            await store.setOrder(entry.id, entry.order);
          }
        }
      } catch {
        setDropNotice({ text: t('web.quadrant.drop.error'), error: true });
      }
      return;
    }

    // ── 跨格：换象限 +（若拖到某个上下位置）一并写 order，**同一条 op** ──
    const task = store.entities.tasks[taskId];
    if (task === undefined) return;
    const plan = planQuadrantDrop(task, toQuadrant, { now: store.now });
    const keys = targetTasks.map(manualOrderKey);
    const prev = toIndex <= 0 ? undefined : keys[toIndex - 1];
    const next = toIndex >= keys.length ? undefined : keys[toIndex];
    const order = manualOrderBetween(prev, next);
    const patch: QuadrantTaskPatch = { important: plan.important };
    if (plan.dueDate !== undefined) patch.dueDate = plan.dueDate;
    if (order !== undefined) patch.order = order;

    const previous = planQuadrantDropUndo(task, plan);
    try {
      await store.setQuadrantDrop(taskId, patch);
      setUndoDrop({ taskId, plan: previous });
      setDropNotice({
        text: t(plan.dueDateChange === undefined ? 'web.quadrant.drop.success' : 'web.quadrant.drop.changedDue', {
          quadrant: labels.title(toQuadrant),
        }),
        error: false,
      });
    } catch {
      setUndoDrop(null);
      setDropNotice({ text: t('web.quadrant.drop.error'), error: true });
    }
  }

  const undoLastDrop = useCallback((): Promise<void> => {
    if (undoDrop === null) return Promise.resolve();
    return store.setQuadrantDrop(undoDrop.taskId, undoDrop.plan).then(() => {
      setDropNotice(undefined);
    });
  }, [store, undoDrop]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(e) => {
        setActiveId(String(e.active.id));
      }}
      onDragOver={(e) => {
        const quadrant = (e.over?.data.current as DragData | undefined)?.quadrant;
        setOverQuadrant(isQuadrant(quadrant) ? quadrant : null);
      }}
      onDragCancel={() => {
        setActiveId(undefined);
        setOverQuadrant(null);
      }}
      onDragEnd={(e) => {
        void handleDragEnd(e);
      }}
    >
      <HeytaUiProvider>
        <SharedQuadrantBoard
          tasks={tasks}
          now={store.now}
          labels={labels}
          twoColumns={twoColumns}
          onToggleTask={(taskId) => {
            void store.toggleComplete(taskId);
          }}
          taskLabels={taskLabels}
          renderRowWrapper={renderRowWrapper}
          renderCellBodyWrapper={renderCellBodyWrapper}
          renderCellOverlay={renderCellOverlay}
          highlightedQuadrant={overQuadrant}
          onOpenTask={onOpenTask}
          activeTaskId={activeTaskId}
          testID="quadrant-board"
        />
      </HeytaUiProvider>

      {dropNotice === undefined && undoDrop === null ? null : (
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: cssVar('space.2'),
            marginTop: cssVar('space.2'),
          }}
        >
          {dropNotice === undefined ? null : (
            <span
              role={dropNotice.error ? 'alert' : 'status'}
              aria-live={dropNotice.error ? 'assertive' : 'polite'}
              data-testid="quadrant-drop-status"
              style={{ color: cssVar(dropNotice.error ? 'color.danger-strong' : 'color.foreground-muted') }}
            >
              {dropNotice.text}
            </span>
          )}
          {undoDrop === null ? null : (
            <UndoReceipt
              label={t('web.quadrant.drop.undo')}
              onUndo={undoLastDrop}
              data-testid="quadrant-drop-undo"
              onDismiss={() => { setUndoDrop(null); }}
            />
          )}
        </div>
      )}

      <details data-testid="quadrant-help" style={{ marginTop: cssVar('space.2') }}>
        <summary
          className="ht-type-caption"
          style={{ cursor: 'pointer', color: cssVar('color.foreground-muted') }}
        >
          {t('web.shell.nav.help')}
        </summary>
        <p
          className="ht-type-caption"
          style={{
            margin: 0,
            marginTop: cssVar('space.2'),
            color: cssVar('color.foreground-muted'),
          }}
        >
          {t('web.quadrant.footnote')}
        </p>
      </details>

      {/* 拖动中的状态播报（读屏）：原行跟手，但仍给一个非视觉的"正在拖"提示。 */}
      <p aria-live="polite" style={{ position: 'absolute', left: -9999 }}>
        {activeId === undefined ? '' : t('web.quadrant.dragging')}
      </p>
    </DndContext>
  );
}
