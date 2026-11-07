/**
 * 看板视图（滴答对齐：看板）
 * ==================================
 *
 * 列 = 清单（Project），卡片 = 任务。拖拽卡片跨列 ⇒ 改任务归属（`onMoveTask`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 2026-11 重建：**列里的行交回共享 `TaskRow`**（`BLOCKED.md` B274 的收口）
 *
 * 改之前这个文件（113 行）**自己写了一张卡** —— 卡里只有一个
 * `<span>{task.title}</span>`。于是同一根上长出四笔债，全部由"没有复用共享行"引起：
 *
 * | 债 | 改之前的读数 | 改之后 |
 * |---|---|---|
 * | `check:l4` 断言 C | `apps/web/src/features` 内联样式 **78 > 基线 74**，多出的 4 处全在本文件（卡片 / 列容器 / 列标题 / 根容器） | **78 → 74**（4 处归零，基线一个数没动） |
 * | `ht-*` 前缀族 | `className="ht-kanban"` / `ht-kanban__column` 是**惰性钩子**（`grep -c kanban apps/web/src/styles/app/*.css` 全 0） | 两个钩子**删掉**；列的形状住进共享 `TaskBoard` ⇒ 族仍是 **33** |
 * | `check:selection-single-source` | 登记 `row-actions-only`（`because` 写着"这不是设计，是缺"） | **`selects`**：本文件读 `useSelected('task')`、点行写 `selection.select('task', id)` |
 * | 键盘光标那一族 | 卡的 testid 是 `kanban-card-*`，共享行的 `task-item-*` 一个都不存在 | 行由共享 `TaskList` 渲染 ⇒ `task-item-*` / `task-toggle-*` / `task-title-*` 自动出现（旧锚点**保留**，见下） |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 分工：**列的形状归共享层，数据与 DOM 归这里**（与四象限逐条同构）
 *
 * 列怎么排、什么底色、标题用哪枚语义样式、列内计数 —— 全在 `packages/ui` 的
 * `TaskBoard`（那才是"看板这个视图的机制"）。本文件只回答 web 自己的两个问题：
 *
 *   1. 任务与列从哪来 → `useTaskStore`（分桶在这里，但**不重排列内顺序**）；
 *   2. web 特有的交互 → **拖放**。`@dnd-kit/core` 是 DOM 库，装不进共享层
 *      （那等于让 iOS 去解析 DOM），所以拖放整套留在这里，经共享层的插槽接进去：
 *      · `renderRowWrapper` —— 行外面那层 `<div>`：dnd-kit 的 sortable 节点
 *        （共享行是 RN `View`，宿主拿不到它的 DOM ref），同时也是旧锚点
 *        `kanban-card-<id>` 的挂点；
 *      · `renderTrailing` —— 行尾的拖拽握把（sortable 的 activator）；
 *      · `renderColumnOverlay` —— 每列的投放层（空列全靠它才收得下东西）；
 *      · `renderColumnWrapper` —— 每列的 `SortableContext`（`useSortable` 不在它里面时，
 *        dnd-kit 会把自己的 draggable/droppable 双双判成 `disabled`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 三个 `data-testid` **一个都没改名**（换挂点，不是放宽判据）
 *
 * `kanban-view`（板根）/ `kanban-col-<id>`（列容器）/ `kanban-card-<id>`（行外层包装）
 * 都是迁移前就有的锚点。值的字面量一字未动，只是 `kanban-card-<id>` 从"手写卡片的
 * `<div>`"移到了"共享行的外层包装" —— 因为那张卡现在**就是**行。
 * 判据 `apps/web/tests/kanban-row-parity.spec.tsx` 的 C 组逐条钉住它们还在。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一轮**不做**同列内排序
 *
 * 跨列 = 改 `projectId`（既有语义，保留）；同列内的落点**不写任何 `order`** ——
 * `SortableContext` + `verticalListSortingStrategy` 原样留着，但**不给行贴 transform**：
 * 同列排序要新增一条"看板列内顺序"的写入口，那是一个产品判断（与列表的手动档
 * 是不是同一个 `order`），不是本单顺手能扩的。没有 transform 也就没有
 * `style={IDENT}` 那种"把动态几何挪到账本之外"的写法（traps #671 记的那个缝）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 拖拽的**视觉反馈**只有两处，都是既有样式，不新开 CSS
 *
 * · 目标列的边框变主色（`highlightedColumnId` → 共享层的 `columnHighlighted`）；
 * · 握把的 `cursor` 在拖动中变 `grabbing`（`.ht-row__drag-handle[data-dragging]`）。
 *
 * 原行**不跟手**（没有 `DragOverlay`）：`DragOverlay` 的内容要自己定样式，
 * 而 `features/**` 里每多一处 `style={{…}}` 都是往那道棘轮上再加一行 ——
 * 那正是本单要还的债。代价写在计划文档的"用户能看到什么变化"里。
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useI18n } from '@heyta/i18n';
import { ICON_SIZE } from '@heyta/design-system';
import type { Project, Task } from '@heyta/domain';
import {
  DndContext,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { GripVertical } from 'lucide-react';
import {
  HeytaUiProvider,
  TaskBoard,
  TaskBoardColumnDropLayer,
  type TaskBoardColumn,
  type TaskBoardLabels,
  type TaskRow,
} from '@heyta/ui';

import { selection, useSelected } from '../../lib/selection.js';
import { useTaskStore } from '../tasks/store.js';
/**
 * 🔴 握把的 `cursor` / `touch-action` 只有一份（`.ht-row__drag-handle`，住在
 * `features/tasks/manual-sort.css`）。**显式** import：不靠"另一个 feature 恰好也
 * import 了它"那种隐式依赖 —— 那种依赖断了不会有任何东西红，症状只是
 * "触屏上拖不动、鼠标还能拖"。
 * 为什么这两条不写成内联样式：它们是**静态 CSS**（一个字符都不随帧变化），
 * 而 `features/**` 的内联样式是只减不增的棘轮账本（traps #671）。
 */
import '../tasks/manual-sort.css';

interface KanbanViewProps {
  tasks: readonly Task[];
  projects: readonly Project[];
  onMoveTask: (taskId: string, projectId: string | undefined) => void;
}

/** 收集箱在列 id 里的值（`undefined` 的 projectId 需要一个稳定的字符串键）。 */
const INBOX = 'inbox';

/** 一行在拖放里的状态。由 {@link KanbanCard} 提供，握把从这里取。 */
interface DragHandleContextValue {
  readonly taskId: string;
  readonly attributes: Record<string, unknown>;
  readonly listeners: Record<string, unknown> | undefined;
  readonly setActivatorNodeRef: (node: HTMLElement | null) => void;
  readonly isDragging: boolean;
}

const DragHandleContext = createContext<DragHandleContextValue | null>(null);

/**
 * 行外面那一层（宿主经 `TaskBoard.renderRowWrapper` 注入）。
 *
 * 🔴 它必须是**组件**（不能在渲染回调里直接调 `useSortable`）：`useSortable` 是 hook，
 * 而 `renderRowWrapper` 是在 `TaskList` 的渲染过程中被调用的普通函数。
 * 与 `ManualSortDnd` 的 `ManualSortRow` 同一条纪律。
 *
 * ⚠️ **不给这一层贴 `transform` / `transition`**（理由见文件头）：同列排序不写
 * `order`，也就没有"行让位"这件事要给用户看。
 */
function KanbanCard({
  id,
  column,
  children,
}: {
  id: string;
  column: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const sortable = useSortable({ id, data: { column } });
  const value = useMemo<DragHandleContextValue>(
    () => ({
      taskId: id,
      attributes: sortable.attributes as unknown as Record<string, unknown>,
      listeners: sortable.listeners as unknown as Record<string, unknown> | undefined,
      setActivatorNodeRef: sortable.setActivatorNodeRef,
      isDragging: sortable.isDragging,
    }),
    [id, sortable.attributes, sortable.listeners, sortable.setActivatorNodeRef, sortable.isDragging],
  );
  return (
    <DragHandleContext.Provider value={value}>
      <div
        ref={sortable.setNodeRef}
        // 🔴 旧锚点。换成共享行之后它挂在这里（"一张卡" = 行外面那层包装），
        //    值一个字都没改 —— 这是换挂点，不是改名，见文件头。
        data-testid={`kanban-card-${id}`}
        data-dragging={sortable.isDragging ? 'true' : undefined}
      >
        {children}
      </div>
    </DragHandleContext.Provider>
  );
}

/**
 * 行尾的拖拽握把（`useSortable` 的 activator）。
 *
 * 🔴 **不在拖放上下文里时返回 `null`** —— 于是它天然只在看板上出现，
 * 共享层不必认识"看板"这个视图（与 `quadrant/QuadrantBoard.tsx` 的 `DragHandle`、
 * `ManualSortDnd` 的 `ReorderHandle` 同一个形状）。
 *
 * 外观走 `.ht-btn.ht-btn--ghost`（动作控件**唯一**的一套语言），抓取手势走既有
 * `.ht-row__drag-handle`：两条都不新开 CSS 族。
 */
function KanbanDragHandle({ label }: { label: string }): React.JSX.Element | null {
  const context = useContext(DragHandleContext);
  if (context === null) return null;
  return (
    <button
      type="button"
      // 🔴 dnd-kit 的 `attributes` 里带着 `aria-roledescription` / `aria-describedby`
      // （可达性靠它），`listeners` 带着指针事件 —— 两样都不能吞。
      {...context.attributes}
      {...context.listeners}
      ref={context.setActivatorNodeRef}
      aria-label={label}
      className="ht-btn ht-btn--ghost ht-row__drag-handle"
      data-dragging={context.isDragging ? 'true' : undefined}
      data-testid={`kanban-drag-${context.taskId}`}
    >
      <GripVertical size={ICON_SIZE.sm} aria-hidden="true" />
    </button>
  );
}

/**
 * 一列的投放层。
 *
 * 🔴 尺寸（绝对定位铺满列内容区）由共享层的 `TaskBoardColumnDropLayer` 给，
 * 这里只把 dnd-kit 的 `setNodeRef` 挂上去 —— 否则空列的 droppable 是一个 0×0 的
 * 矩形，**拖不进空列且不报错**。
 */
function ColumnDropZone({ columnId }: { columnId: string }): React.JSX.Element {
  const { setNodeRef } = useDroppable({ id: `kanban-col-${columnId}`, data: { column: columnId } });
  return (
    <TaskBoardColumnDropLayer ref={setNodeRef as never} testID={`kanban-col-drop-${columnId}`} />
  );
}

export function KanbanView({ tasks, projects, onMoveTask }: KanbanViewProps): React.JSX.Element {
  const { t } = useI18n();
  const store = useTaskStore();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  /**
   * 选中的那条任务 —— **共享选中**（`apps/web/src/lib/selection.ts` 那一枚），
   * 不是本文件自己的 `useState`。
   *
   * 🔴 看板是同一批任务的又一种投影：在列表里选中哪一条，切过来必须看得见"还是它"；
   * 在看板里点一条，别的投影也要跟着换。各视图各留一份选中 = 各答一遍回落规则。
   */
  const selectedTaskId = useSelected('task');
  /** 正在拖的那一条 —— 只喂给下面那条 `aria-live` 播报（**不是**选中，别混）。 */
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const columns = useMemo<TaskBoardColumn[]>(() => {
    const cols: TaskBoardColumn[] = [
      {
        id: INBOX,
        title: t('web.shell.nav.inbox'),
        tasks: tasks.filter((task) => task.projectId === undefined),
      },
    ];
    for (const project of projects) {
      cols.push({
        id: project.id,
        title: project.name,
        tasks: tasks.filter((task) => task.projectId === project.id),
      });
    }
    return cols;
  }, [tasks, projects, t]);

  /**
   * 列的无障碍名：**列名 + 条数**（如「工作 3」）。
   *
   * 与四象限的 `quadrantCountA11y` 同一个拼法（"现有名词条 + 数字"）：
   * `packages/i18n` 不在本单白名单，所以**一条新词条都不加**。
   */
  const boardLabels = useMemo<TaskBoardLabels>(
    () => ({
      columnA11y: (column) => `${column.title} ${String(column.tasks.length)}`,
    }),
    [],
  );

  /** 行级无障碍文案。**每一项都是一整句**，不要用前缀拼标题。 */
  const taskLabels = useMemo(
    () => ({
      toggleOn: (row: TaskRow) => t('web.shell.tasks.complete', { title: row.title }),
      toggleOff: (row: TaskRow) => t('web.shell.tasks.uncomplete', { title: row.title }),
    }),
    [t],
  );

  /**
   * 拖拽握把的无障碍名。**复用既有词条**（`web.shell.bulk.move` = 「移动到清单」）：
   * 看板这一拖改的正是归属；而 `web.quadrant.a11y.handle` 那句写的是"到另一个象限" ——
   * 换名词就是加词条，本单不许。
   */
  const handleLabel = t('web.shell.bulk.move');

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(undefined);
      setOverColumnId(null);
      const { active, over } = event;
      if (over === null) return;
      /**
       * 落点 → 哪一列：行自己的 `data.column`（`useSortable` 的 data）或列投放层的
       * `data.column`（空列只有后者）。两者同一个键，所以不必分支。
       * `over.id` 的 `kanban-col-<id>` 兜底留着（那就是投放层的 id）。
       */
      const from = (active.data.current as { column?: string } | undefined)?.column;
      const to =
        (over.data.current as { column?: string } | undefined)?.column ??
        String(over.id).replace('kanban-col-', '');
      if (from === to) return;
      onMoveTask(String(active.id), to === INBOX ? undefined : to);
    },
    [onMoveTask],
  );

  /** 点一行 = 选中它（与列表/四象限同一个出口，**不是**本文件自己记一条）。 */
  const openTask = useCallback((taskId: string) => {
    selection.select('task', taskId);
  }, []);

  const renderTrailing = useCallback(
    () => <KanbanDragHandle label={handleLabel} />,
    [handleLabel],
  );

  const renderRowWrapper = useCallback(
    (row: TaskRow, node: React.ReactNode) => (
      <KanbanCard id={row.id} column={row.source.projectId ?? INBOX}>
        {node}
      </KanbanCard>
    ),
    [],
  );

  const renderColumnOverlay = useCallback(
    (column: TaskBoardColumn) => <ColumnDropZone columnId={column.id} />,
    [],
  );

  const renderColumnWrapper = useCallback(
    (column: TaskBoardColumn, node: React.ReactNode) => (
      <SortableContext
        items={column.tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        {node}
      </SortableContext>
    ),
    [],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(event) => {
        setDraggingId(String(event.active.id));
      }}
      onDragOver={(event) => {
        const column = (event.over?.data.current as { column?: string } | undefined)?.column;
        setOverColumnId(column ?? null);
      }}
      onDragCancel={() => {
        setDraggingId(undefined);
        setOverColumnId(null);
      }}
      onDragEnd={handleDragEnd}
    >
      {/*
        🔴 `HeytaUiProvider` 必须包在**这一处**（与四象限同一条理由）：
        `App.tsx` 的 Provider 只包了 `tasks` 那棵树，看板是它的兄弟节点 ——
        漏了这层，打开看板会在运行时抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」。
        `check:ui-provider` 跟不到 `TaskBoard`（它尚未登记进那份清单），所以这一条由
        `apps/web/tests/kanban-row-parity.spec.tsx` 的行为判据兜着。
      */}
      <HeytaUiProvider>
        <TaskBoard
          columns={columns}
          labels={boardLabels}
          onToggleTask={(taskId) => {
            void store.toggleComplete(taskId);
          }}
          onOpenTask={openTask}
          activeTaskId={selectedTaskId}
          taskLabels={taskLabels}
          renderTrailing={renderTrailing}
          renderRowWrapper={renderRowWrapper}
          renderColumnWrapper={renderColumnWrapper}
          renderColumnOverlay={renderColumnOverlay}
          highlightedColumnId={overColumnId}
          columnTestID={(column) => `kanban-col-${column.id}`}
          testID="kanban-view"
        />
      </HeytaUiProvider>

      {/* 拖动中的状态播报（读屏）：不是装饰 —— 拖动时原行不跟手，这是唯一的非视觉反馈。 */}
      <span role="status" aria-live="polite" data-testid="kanban-live" hidden>
        {draggingId === undefined ? '' : t('web.quadrant.dragging')}
      </span>
    </DndContext>
  );
}
