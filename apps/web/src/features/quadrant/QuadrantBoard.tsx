import { ICON_SIZE } from '@heyta/design-system';
/**
 * 四象限矩阵（Web 壳）
 * ======================
 *
 * 🔴 M3 第六刀之后，这个文件**只剩接线**。
 *
 * 2×2 矩阵、每一格的标题/说明/色块/空格占位/无障碍名，以及**格里的任务行**，
 * 全部由 `@heyta/ui` 的 `QuadrantBoard` 渲染 —— 与 mobile 是**同一份实现**。
 * 这里只回答 web 自己的两个问题：
 *
 *   1. 任务与"现在"从哪来 → `useTaskStore`（分桶/排序在 `@heyta/domain`
 *      的 `bucketByQuadrant`，投放计划在 `planQuadrantDrop`，本文件一条都不重算）；
 *   2. web 特有的交互 → **拖放**。`@dnd-kit/core` 是 DOM 库，装不进共享层
 *      （那等于让 iOS 去解析 DOM），所以拖放整套留在这里。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 行的骨架来自共享 `TaskList`，于是**整行不再可拖**
 *
 * 迁移前 web 有一份本地 `DraggableTask`（只有一行标题文字，`useDraggable`
 * 挂在那个 `<li>` 上）。现在格里的行是**共享 `TaskList` 渲染的行** ——
 * 它带勾选框、统一几何、无障碍 role/state，但 web 拿不到"整行"那个节点
 * （`renderTrailing` 是行的**兄弟插槽**，不是行的包装）。
 *
 * 所以拖拽改成**行尾的握把**（下面 `DragHandle`，经 `renderTrailing` 注入）：
 *
 *   · 得到的是**真的**——象限卡里的行第一次有了勾选框与统一几何；
 *   · 失去的是**整行可拖的肌肉记忆**。这一条必须让产品负责人知道，
 *     它不是"实现细节"，是交互变了。拖拽**能力**没有丢。
 *
 * 最小一步（见共享层文件头第 2 条）：给 `TaskList` 加
 * `renderRowWrapper?: (row, node) => ReactNode`，把手柄换成整行包装。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `HeytaUiProvider` 必须包在**这一处**
 *
 * `App.tsx` 的 Provider 只包了 `tasks` 那棵树，而四象限是它的**兄弟节点**
 * （`{view === 'quadrant' && <QuadrantBoard />}`）。M3 第二刀（focus）就是
 * 这样在运行时抛出「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」的，
 * 而当时 `check:ui-provider` **不检查嵌套**、照样全绿。
 *
 * ⚠️ 而 `QuadrantBoard` **尚未登记**进 `scripts/check-ui-provider.mjs` 的
 * `PROVIDER_DEPENDENT`（该脚本不在本刀白名单）—— 所以**门禁今天看不见这里**。
 * 补登记：`QuadrantBoard`。别把下面这层 Provider 删掉。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { cssVar } from '@heyta/design-system';
import { Quadrant, planQuadrantDrop } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  HeytaUiProvider,
  QuadrantBoard as SharedQuadrantBoard,
  type QuadrantCardModel,
  type TaskRow,
} from '@heyta/ui';
import { GripVertical } from 'lucide-react';

import { useTaskStore } from '../tasks/store.js';
import { dragHandleLabel, quadrantBoardLabels } from './copy.js';

/**
 * 类型守卫：穷举比较，**不做数组强转**（与迁移前同一写法）。
 *
 * `event.over.id` 的类型是 `UniqueIdentifier`（`string | number`），
 * 强转会掩盖"拖到了非象限目标"（比如列表外），那样会静默产生一条无意义的 op。
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

/**
 * 行尾的拖拽握把。
 *
 * 🔴 `useDraggable` 必须在**组件边界**里调用 —— 而 `renderTrailing` 是
 * 在 `TaskList` 的渲染过程中被调用的**回调**（不是组件）。所以它返回的是
 * 这个**组件元素**，hook 在自己的边界里跑（与 `App.tsx` 的 `renderTaskTrailing`
 * 同一条纪律）。
 */
function DragHandle({ taskId, label }: { taskId: string; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: taskId });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(listeners ?? {})}
      {...attributes}
      aria-label={label}
      data-testid={`quadrant-drag-${taskId}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: cssVar('space.1'),
        border: 'none',
        background: 'none',
        color: cssVar('color.foreground-subtle'),
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.4 : 1,
        // 拖拽是即时反馈，不需要过渡；加了反而拖影
        touchAction: 'none',
      }}
    >
      <GripVertical size={ICON_SIZE.sm} aria-hidden="true" />
    </button>
  );
}

/**
 * 一格里的**投放区**。
 *
 * 它不需要可点 —— dnd-kit 按 `getBoundingClientRect` 命中，不靠事件冒泡。
 * 共享层把它放在一个 `pointerEvents: none` 的绝对定位容器里，所以它
 * **不会**挡住勾选框与握把（挡住的症状是"什么都点不动"，且不报错）。
 */
function CellDropZone({ quadrant }: { quadrant: Quadrant }) {
  const { setNodeRef } = useDroppable({ id: quadrant });
  return (
    <div
      ref={setNodeRef}
      data-quadrant={quadrant}
      style={{ width: '100%', height: '100%' }}
    />
  );
}

/**
 * `onOpenTask` / `activeTaskId` 是宿主管"选中是哪一条"的两个出口，本层只转接 ——
 * 选中态本身不在这里，它只有一个所有者（`apps/web/src/lib/selection.ts`）。
 * ⚠️ 与下面 `activeId`（dnd-kit 的**正在拖**那条）无关，两个名字像但不是一件事。
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

  /**
   * 🔴 **两列还是单列 —— 断点读 token，判定听窗口**（goal-layout-audit 页 1：
   * "不能因为窗口的变化而影响到排版"）。
   *
   * 断点值从 `tokens.css` 的 CSS 变量里读（`layout.two-column-min`）——
   * JS 里不抄一份数字，token 才是单源。RNW 的 `useWindowDimensions` 用的是
   * `window.screen.width`（物理屏）而不是视口宽（实测 660px 视口它报 1728），
   * 所以这个判定只能在 web 宿主做 —— 移动端不传，共享层默认单列。
   */
  const [twoColumns, setTwoColumns] = useState(false);
  useEffect(() => {
    const min = getComputedStyle(document.documentElement)
      .getPropertyValue('--ht-layout-two-column-min')
      .trim();
    // token 没加载（理论上不会）：保持单列的安全默认，**不抄一份数字当兜底**
    //（裸值会被 check:design 拦 —— 而那道门禁是对的）。
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
  const labels = useMemo(() => quadrantBoardLabels(t), [t]);
  const handleLabel = useMemo(() => dragHandleLabel(t), [t]);
  /** 行级无障碍文案。**每一项都是一整句**，不要用前缀拼标题。 */
  const taskLabels = useMemo(
    () => ({
      toggleOn: (row: TaskRow) => t('web.shell.tasks.complete', { title: row.title }),
      toggleOff: (row: TaskRow) => t('web.shell.tasks.uncomplete', { title: row.title }),
    }),
    [t],
  );

  // 键盘也能拖 —— 只用 PointerSensor 会把键盘用户排除在外
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const renderTrailing = useCallback(
    (row: TaskRow) => <DragHandle taskId={row.id} label={handleLabel} />,
    [handleLabel],
  );
  const renderCellOverlay = useCallback(
    (card: QuadrantCardModel) => <CellDropZone quadrant={card.quadrant} />,
    [],
  );

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    setActiveId(undefined);
    setOverQuadrant(null);
    const over = event.over?.id;
    if (over === undefined || !isQuadrant(over)) return;

    const taskId = String(event.active.id);
    const task = store.entities.tasks[taskId];
    if (task === undefined) return;

    /**
     * 🔴 **投放计划来自领域层的纯函数，不要在这里重算。**
     *
     * 这里原先是一段手写逻辑，带着两个缺陷（2026-09-26 读代码核实）：
     *   1. `if (urgent && task.dueDate === undefined)` 只处理"完全没有截止时间"，
     *      于是把"10 天后到期"的任务拖进 Q1 时，只设了 important，
     *      它**仍然不紧急** → 任务**弹回 Q2**。用户拖了等于没拖，且没有解释。
     *   2. 注释写着「一次操作 = 一条 op（AGENTS.md §3.4）：两个字段一次写完」，
     *      代码却是**两次 `await`** —— 注释描述的是意图，代码做的是另一件事。
     *
     * `planQuadrantDrop` 现在穷举验证"4 象限 × 3 种截止时间状态都必须真的
     * 落在目标格"，本文件只负责把计划交给 action 层。
     */
    const plan = planQuadrantDrop(task, over, { now: store.now });
    // 一次拖放 = 一条 op（`setQuadrantDrop` 只写一次，不拆成两个动作）。
    await store.setQuadrantDrop(taskId, plan);
  }

  const activeTask = activeId === undefined ? undefined : store.entities.tasks[activeId];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => {
        setActiveId(String(e.active.id));
      }}
      onDragOver={(e) => {
        setOverQuadrant(isQuadrant(e.over?.id) ? e.over.id : null);
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
          renderTrailing={renderTrailing}
          renderCellOverlay={renderCellOverlay}
          highlightedQuadrant={overQuadrant}
          testID="quadrant-board"
        />
      </HeytaUiProvider>

      {/*
        拖拽的**可视化**：手指下跟着一份标题的浮层。
        整行不再可拖（见文件头），所以拖动时原行不动 —— 没有浮层的话
        用户看不到任何"正在拖"的反馈。
      */}
      <DragOverlay>
        {activeTask === undefined ? null : (
          <div
            style={{
              padding: `${cssVar('space.2')} ${cssVar('space.3')}`,
              borderRadius: cssVar('radius.md'),
              border: `${cssVar('border-width.thin')} solid ${cssVar('color.primary')}`,
              background: cssVar('color.surface'),
              color: cssVar('color.foreground'),
              fontSize: cssVar('font-size.sm'),
            }}
          >
            {activeTask.title}
          </div>
        )}
      </DragOverlay>

      {/* 让拖拽有明确的进行中提示，屏幕阅读器也能感知 */}
      <p aria-live="polite" style={{ position: 'absolute', left: -9999 }}>
        {activeId !== undefined ? t('web.quadrant.dragging') : ''}
      </p>
    </DndContext>
  );
}
