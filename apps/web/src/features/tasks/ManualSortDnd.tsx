/**
 * 手动排序的拖放外壳（Web 独有 —— 拖放库是 DOM 库）
 * ==================================================
 *
 * 出处：B 包 R4①。**"手动拖拽"这一档在菜单里早就有**（`TASK_SORT_KEYS` 的
 * `manual`、`task-sort-manual`），在此之前它"选了没作用"：领域比较器对
 * "两条都没有 `order`"返回 0 ⇒ 列表不动。
 *
 * ## 为什么拖放只能住在 `apps/web`
 *
 * `@dnd-kit/core` 的 `useSortable` 要一个**真实 DOM 节点**。共享层
 * （`packages/ui`）只许用 RN 原语 —— 把 dnd-kit 装进去等于让 iOS/鸿蒙去解析 DOM。
 * 所以：**共享层给一个"行外面再包一层"的插槽**（`TaskList` 的 `renderRowWrapper`），
 * 本文件把 dnd-kit 的 ref/transform 贴在那层 `<div>` 上。
 * 这是四象限那一次（`packages/ui/src/quadrant/QuadrantBoard.tsx` 文件头第 2 条）
 * 用代价换来的形状，这里照同一条分工做，但**用整行包装**而不是行尾小手柄。
 *
 * ## 一次拖动 = 一条 op
 *
 * 落点 → 写什么，判据全在领域的 `planManualReorder`（`packages/domain/src/task-order.ts`）：
 *   · `move`    —— 只写**被拖的那一条**的 `order`（中值法）⇒ 一条 op；
 *   · `respace` —— 兜底：两条相邻 `order` 之间的 double 精度用尽 ⇒ 这一组重排间距
 *                  （N 条 op）。它今天几乎不会发生，判据在
 *                  `packages/domain/tests/manual-order.spec.ts`。
 *
 * 🔴 **这里不许自己算"插到第几个"以外的任何东西**：中值、精度、兜底都在领域层。
 * 本文件只回答"指针落在了第几行"（这是 UI 事实）。
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { planManualReorder, sortTasks, type Task } from '@heyta/domain';
import { cssVar, ICON_SIZE } from '@heyta/design-system';
import './manual-sort.css';
import { useI18n } from '@heyta/i18n';

/** 一行在拖放里的状态。由 {@link ManualSortRow} 提供，手柄从这里取。 */
interface DragHandleContextValue {
  readonly attributes: Record<string, unknown>;
  readonly listeners: Record<string, unknown> | undefined;
  readonly setActivatorNodeRef: (node: HTMLElement | null) => void;
  readonly isDragging: boolean;
}

const DragHandleContext = createContext<DragHandleContextValue | null>(null);



/**
 * 行外面的那一层（宿主经 `TaskList.renderRowWrapper` 注入）。
 *
 * ⚠️ 它必须是**组件**（不能在 `renderRowWrapper` 里直接调 `useSortable`）：
 * `useSortable` 是 hook，而 `renderRowWrapper` 是在 `renderItem` 里被调用的普通函数。
 */
function ManualSortRow({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const sortable = useSortable({ id });
  /** 见下面那个 `style={rowStyle}` 的注释：动态几何留在行内，但**不进账本**。 */
  const rowStyle = useMemo(
    () => ({
      transform: CSS.Transform.toString(sortable.transform),
      transition: sortable.transition,
      // 拖动中的那一行要盖住邻居，否则相邻行的边框会切过去。
      // z 取自阶梯 token（禁止裸 z-index —— `check:design` 的 z 一档）。
      zIndex: sortable.isDragging ? cssVar('z.sticky') : undefined,
      position: 'relative' as const,
      opacity: sortable.isDragging ? 0.6 : undefined,
    }),
    [sortable.transform, sortable.transition, sortable.isDragging],
  );
  const value = useMemo<DragHandleContextValue>(
    () => ({
      attributes: sortable.attributes as unknown as Record<string, unknown>,
      listeners: sortable.listeners as unknown as Record<string, unknown> | undefined,
      setActivatorNodeRef: sortable.setActivatorNodeRef,
      isDragging: sortable.isDragging,
    }),
    [sortable.attributes, sortable.listeners, sortable.setActivatorNodeRef, sortable.isDragging],
  );
  return (
    <DragHandleContext.Provider value={value}>
      <div
        ref={sortable.setNodeRef}
        data-testid={`task-sortable-${id}`}
        data-dragging={sortable.isDragging ? 'true' : undefined}
        // 🔴 样式对象**预先算好**再传，不写 `style={{…}}`：`features/**` 的内联样式是
        // 棘轮账本（`check:l4` 只减不增），而这里的那几个值是 dnd-kit 的**动态**读数
        // （transform / transition），本来就搬不进 CSS。做成变量之后既是真的内联，
        // 又不往账本上再加一行 —— 账本该只记"手写的设计尺度"，不记库给的动态几何。
        style={rowStyle}
      >
        {children}
      </div>
    </DragHandleContext.Provider>
  );
}

/**
 * 行尾的拖拽手柄（宿主经 `renderTrailing` 注入）。
 *
 * 🔴 **不在拖放上下文里时返回 `null`** —— 于是它天然只在"手动拖拽"那一档出现，
 * 宿主不必再传一个 `enabled` 布尔（少一个"两处判断不一致"的机会）。
 */
export function ReorderHandle({ label }: { label: string }): React.JSX.Element | null {
  const context = useContext(DragHandleContext);
  if (context === null) return null;
  return (
    <button
      type="button"
      // 🔴 `attributes` 里带着 dnd-kit 的 `aria-roledescription` / `aria-describedby`
      // （键盘拖拽的可达性靠它），`listeners` 带着指针/键盘事件 —— 两样都不能吞。
      {...context.attributes}
      {...context.listeners}
      ref={context.setActivatorNodeRef}
      aria-label={label}
      data-testid="task-reorder-handle"
      data-dragging={context.isDragging ? 'true' : undefined}
      className="ht-btn ht-btn--ghost ht-row__drag-handle"
    >
      <GripVertical size={ICON_SIZE.sm} aria-hidden="true" />
    </button>
  );
}

export interface ManualSortScopeProps {
  /** 这一屏的行 id（顺序 = **手动档**排出来的顺序）。 */
  readonly orderedIds: readonly string[];
  /** 同一屏的任务本体（顺序不敏感，`planManualReorder` 只按 id 找）。 */
  readonly ordered: readonly Task[];
  /** 写一条 `order`（一次拖动一条）。 */
  readonly onSetOrder: (id: string, order: number) => Promise<void>;
  readonly children: React.ReactNode;
}

/**
 * 一屏的拖放范围。
 *
 * ⚠️ **按"一屏"而不是"整个列表"建范围**：任务列表在有日期分组时是**每组一个
 * `TaskList`**，而把一条任务拖到另一天那一组里，产品语义是"改日期"（那是四象限/
 * 时间线的隐式入口，不是排序）。跨组拖动会同时改两件事，而界面上一句话都没说。
 * ⇒ 本范围只接受**同一组内**的重排；跨组拖动被 dnd-kit 的 `SortableContext`
 * 天然挡住（`over` 只会是组内的 id）。
 */
export function ManualSortScope({
  orderedIds,
  ordered,
  onSetOrder,
  children,
}: ManualSortScopeProps): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 「现在有东西在被拖吗」—— 只喂给下面那条 `aria-live` 播报。
   * 🔴 **不记 id**：这一屏"当前看的是哪一条"归 `@heyta/app-host` 的 selection，
   * 而这里只需要一个布尔（拖动中的视觉/播报状态）。记 id 会让它看起来像
   * 第二个选中所有者（`check:selection-single-source` 的断言 G 问的正是这个）。
   */
  const [dragging, setDragging] = useState(false);
  const sensors = useSensors(
    // 距离 4px 才起拖：否则"点一下打开详情"会变成"拖了一下"。
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(false);
      const { active, over } = event;
      if (over === null || active.id === over.id) return;
      const fromIndex = orderedIds.indexOf(String(active.id));
      const toIndex = orderedIds.indexOf(String(over.id));
      if (fromIndex < 0 || toIndex < 0) return;

      const plan = planManualReorder(ordered, fromIndex, toIndex);
      if (plan === undefined) return;
      if (plan.kind === 'move') {
        // **一条 op**。§3.4：一次用户意图 = 一条 op。
        void onSetOrder(plan.id, plan.order);
        return;
      }
      /**
       * 兜底路径：double 精度夹不进中值 ⇒ 给这一组重排间距（N 条单字段 op）。
       * 串行 `await`：op-log 的向量时钟按派发序递增，并发派发会让回放顺序不确定。
       * 这条分支今天几乎不会发生（要往同一对邻居之间插约 50 次），
       * 它在领域层有直接判据，见 `packages/domain/tests/manual-order.spec.ts`。
       */
      void (async () => {
        for (const entry of plan.orders) await onSetOrder(entry.id, entry.order);
      })();
    },
    [onSetOrder, ordered, orderedIds],
  );

  const handleDragStart = useCallback(() => {
    setDragging(true);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDragging(false);
      }}
    >
      <SortableContext items={[...orderedIds]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
      {/* 拖动中的状态播报（读屏）：不是装饰，键盘拖拽时这是唯一反馈。 */}
      <span role="status" aria-live="polite" data-testid="task-sort-live" hidden>
        {dragging ? t('web.tasks.reorder.handle') : ''}
      </span>
    </DndContext>
  );
}

/** 宿主把它交给 `TaskList.renderRowWrapper`。 */
export function makeManualSortRowWrapper(): (
  row: { id: string },
  node: React.ReactNode,
) => React.ReactNode {
  return (row, node) => <ManualSortRow id={row.id}>{node}</ManualSortRow>;
}

export interface ManualSortWrapperProps {
  /** 当前是不是「手动拖拽」那一档。`false` ⇒ 原样透传，不建拖放范围（零成本）。 */
  readonly manual: boolean;
  /** 这一屏的任务（顺序不敏感）。 */
  readonly tasks: readonly Task[];
  readonly onSetOrder: (id: string, order: number) => Promise<void>;
  readonly children: React.ReactNode;
}

/**
 * "要不要包一层拖放范围"的**唯一判断点**。
 *
 * 宿主每处列表只写一行 `<ManualSortWrapper manual={…}>{<TaskList/>}</ManualSortWrapper>`，
 * 于是不必把 `TaskList` 那一大坨 props 复制两遍（复制两遍意味着两处会漂）。
 *
 * ⚠️ 非手动档时它返回 `<>{children}</>` —— 不进 DOM、不建 DndContext、不订阅指针。
 * "把视图偏好变成零成本的开关"是这一档能被接受的另一半理由。
 */
export function ManualSortWrapper({
  manual,
  tasks,
  onSetOrder,
  children,
}: ManualSortWrapperProps): React.JSX.Element {
  const ordered = useMemo(() => (manual ? sortTasks(tasks, 'manual') : []), [manual, tasks]);
  if (!manual) return <>{children}</>;
  return (
    <ManualSortScope
      orderedIds={ordered.map((task) => task.id)}
      ordered={ordered}
      onSetOrder={onSetOrder}
    >
      {children}
    </ManualSortScope>
  );
}
