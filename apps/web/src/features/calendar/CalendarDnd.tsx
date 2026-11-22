/**
 * 日历「拖拽改期」的 Web 外壳（`@dnd-kit`）
 * ========================================
 *
 * 把任务条从一天的格子里拖到另一天 ⇒ 改该任务的截止日期。判据与写入分别落在
 * `@heyta/domain` 的 `planCalendarDrop` 与 `store.setDueDate`，本文件**只做接线**：
 * dnd-kit 是 DOM 库，只能住在 Web 壳（装进 `packages/ui` 等于让 iOS 解析 DOM）。
 *
 * 三个部件：
 *   · `CalendarDragProvider` —— 一台 `DndContext` + `DragOverlay`：拖起来那层浮影与落点判定；
 *   · `CalendarDragBar`      —— 把一根任务条做成拖拽源（`useDraggable`）；
 *   · `CalendarDropDay`      —— 把一格日期做成投放目标（`useDroppable`）。
 *
 * 🔴 没有一行内联样式：`features/**` 的内联样式是只减不增的棘轮账本（`check:l4`），
 *    `cursor` / `touch-action` / 拖拽中的淡出都是**静态** CSS（`calendar-dnd.css`）。
 *    真正动态的只有 `data-*` 属性 —— 与 `ManualSortDnd.tsx` 同一条记法。
 */

import { useCallback, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

import type { Task } from '@heyta/domain';

import './calendar-dnd.css';

/** 落点数据的形状（挂在 `useDroppable` 的 `data` 上，`onDragEnd` 里读回来）。 */
interface DayDropData {
  readonly type: 'day';
  readonly date: string;
}

/**
 * 一台 `DndContext`：包住整个共享日历板，托管拖拽状态与浮影。
 *
 * `onReschedule(taskId, targetDate)`：宿主接 `planCalendarDrop` + `store.setDueDate`。
 * 本组件**不碰业务**（不知道 dueDate、不知道 op-log）。
 */
export function CalendarDragProvider({
  tasksById,
  onReschedule,
  children,
}: {
  tasksById: ReadonlyMap<string, Task>;
  onReschedule: (taskId: string, targetDate: string) => void;
  children: ReactNode;
}): React.JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    // 🔴 位移超过 6px 才算"拖"：低于它仍是一次点击 ——
    //   格子的 `onPress` 是"选中这天 + 开捕获框"，不能被一次轻点吞掉。
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { over } = event;
      if (over === null) return;
      const data = over.data.current as DayDropData | undefined;
      if (data?.type !== 'day' || typeof data.date !== 'string') return;
      onReschedule(String(event.active.id), data.date);
    },
    [onReschedule],
  );

  const activeTitle = activeId === null ? undefined : tasksById.get(activeId)?.title;

  return (
    <DndContext
      sensors={sensors}
      // 指针落在哪一格就投到哪一格：日格是紧挨着的大矩形，`pointerWithin` 比"最近中心"更贴手。
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeTitle === undefined ? null : (
          <div className="ht-content__cal-drag-overlay">{activeTitle}</div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** 一根任务条 = 一个拖拽源。`id` 传任务的 id（`bar.id` 就是它）。 */
export function CalendarDragBar({ id, children }: { id: string; children: ReactNode }): React.JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      className="ht-content__cal-drag"
      data-dragging={isDragging ? 'true' : 'false'}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

/** 一格日期 = 一个投放目标。`date` 是本地日历日（`YYYY-MM-DD`）。 */
export function CalendarDropDay({ date, children }: { date: string; children: ReactNode }): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, data: { type: 'day', date } satisfies DayDropData });
  return (
    <div ref={setNodeRef} className="ht-content__cal-drop" data-over={isOver ? 'true' : 'false'}>
      {children}
    </div>
  );
}
