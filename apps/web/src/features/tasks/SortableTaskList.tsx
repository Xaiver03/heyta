/**
 * 手动拖拽排序的列表容器（滴答对齐：手动拖拽）
 *
 * 只在 sortKey === 'manual' 时启用拖拽。
 * 拖拽结束 ⇒ 对每条移动的任务调 setOrder(id, index)。
 */

import React, { useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableTaskListProps {
  items: readonly { id: string }[];
  enabled: boolean;
  onReorder: (orderedIds: string[]) => void;
  children: (item: { id: string }, sortable: ReturnType<typeof useSortable>) => React.ReactNode;
}

export function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (sortable: ReturnType<typeof useSortable>) => React.ReactNode;
}): React.JSX.Element {
  const sortable = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    zIndex: sortable.isDragging ? 1 : undefined,
  };
  return (
    <div ref={sortable.setNodeRef} style={style}>
      {children(sortable)}
    </div>
  );
}

export function SortableTaskList({
  items,
  enabled,
  onReorder,
  children,
}: SortableTaskListProps): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove([...items], oldIndex, newIndex).map((i) => i.id);
      onReorder(next);
    },
    [items, onReorder],
  );

  if (!enabled) {
    return (
      <div role="list">
        {items.map((item) => (
          <div key={item.id}>{children(item, {} as ReturnType<typeof useSortable>)}</div>
        ))}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div role="list">
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id}>
              {(sortable) => children(item, sortable)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
