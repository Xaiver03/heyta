/**
 * 看板视图（滴答对齐：看板）
 *
 * 列 = 清单（Project），卡片 = 任务。
 * 拖拽卡片跨列 ⇒ 改任务归属（moveTask）。
 */

import React, { useMemo } from 'react';
import { useI18n } from '@heyta/i18n';
import { cssVar } from '@heyta/design-system';
import type { Task, Project } from '@heyta/domain';
import {
  DndContext,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface KanbanViewProps {
  tasks: readonly Task[];
  projects: readonly Project[];
  onMoveTask: (taskId: string, projectId: string | undefined) => void;
}

function KanbanCard({ task, onMove }: { task: Task; onMove: (id: string, col: string) => void }): React.JSX.Element {
  const sortable = useSortable({ id: task.id, data: { column: task.projectId ?? 'inbox' } });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ ...style, padding: cssVar('space.2'), borderRadius: cssVar('radius.md'), background: cssVar('color.surface-raised'), marginBottom: cssVar('space.1') }}
      data-testid={`kanban-card-${task.id}`}
    >
      <span>{task.title}</span>
    </div>
  );
}

function KanbanColumn({
  projectId,
  label,
  tasks,
  onMoveTask,
}: {
  projectId: string | undefined;
  label: string;
  tasks: readonly Task[];
  onMoveTask: (taskId: string, projectId: string | undefined) => void;
}): React.JSX.Element {
  return (
    <div
      className="ht-kanban__column"
      data-testid={`kanban-col-${projectId ?? 'inbox'}`}
      style={{ flex: '1 1 0', padding: cssVar('space.2') }}
    >
      <h3 style={{ margin: `0 0 ${cssVar('space.2')}`, fontSize: cssVar('font-size.sm') }}>{label}</h3>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {tasks.map((task) => (
          <KanbanCard key={task.id} task={task} onMove={() => {}} />
        ))}
      </SortableContext>
    </div>
  );
}

export function KanbanView({ tasks, projects, onMoveTask }: KanbanViewProps): React.JSX.Element {
  const { t } = useI18n();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = useMemo(() => {
    const inbox = tasks.filter((t) => !t.projectId);
    const cols = [{ id: undefined as string | undefined, label: t('web.shell.nav.inbox'), tasks: inbox }];
    for (const p of projects) {
      cols.push({ id: p.id, label: p.name, tasks: tasks.filter((t) => t.projectId === p.id) });
    }
    return cols;
  }, [tasks, projects, t]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as { column?: string } | undefined;
    const overColumn = (over.data.current as { column?: string } | undefined)?.column
      ?? (over.id as string).replace('kanban-col-', '');
    if (activeData?.column !== overColumn) {
      const projectId = overColumn === 'inbox' ? undefined : overColumn;
      onMoveTask(active.id as string, projectId);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      <div className="ht-kanban" data-testid="kanban-view" style={{ display: 'flex', gap: cssVar('space.2'), overflowX: 'auto', height: '100%' }}>
        {columns.map((col) => (
          <KanbanColumn
            key={col.id ?? 'inbox'}
            projectId={col.id}
            label={col.label}
            tasks={col.tasks}
            onMoveTask={onMoveTask}
          />
        ))}
      </div>
    </DndContext>
  );
}
