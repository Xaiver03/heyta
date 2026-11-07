/**
 * `TaskBoard` —— 看板（横排等宽列）**唯一的一份容器实现**
 * =====================================================
 *
 * 出处：`BLOCKED.md` 的 B274。那里记的是同一根上的四笔债：
 * `apps/web/src/features/kanban/KanbanView.tsx` 手写了一张卡（只有一个
 * `<span>{task.title}</span>`），于是 ① 看板成了 `apps/web/src/features` 里
 * 内联样式的净增来源（`check:l4` 78 > 基线 74）；② `ht-kanban` / `ht-kanban__column`
 * 是**惰性钩子**（有类名没规则，`grep -c kanban apps/web/src/styles/app/*.css` 全 0）；
 * ③ 它没有"在看哪一条"的立场（`check:selection-single-source` 登记成 `row-actions-only`）；
 * ④ 它的卡片 testid 是 `kanban-card-*`，不在共享行那一族 `task-item-*` 里。
 *
 * 四笔的共同根因是"看板没有复用行"。所以这一份做的事只有一件：
 * **每一列直接渲染共享 `TaskList`** —— 于是列里的行就是 `TaskRow`
 *（勾选框 / 标题 / 44 触控区 / 无障碍 role 与 state / 行尾与元信息插槽全部自动一致）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么它在 `packages/ui`，而不是 `apps/web` 的一个 css 文件
 *
 * 列的形状（横排、等宽、表面色、列标题的语义样式、列内计数）是**看板这个视图的机制**，
 * 不是某个壳的皮肤。把它写进 `apps/web/src/styles/app/kanban.css` 的新族
 * `.ht-kanban*` 会让 `check:row-single-source` 的前缀族 33 → 34 —— 而那条基线是
 * **判据口径**，不许为了变绿抬它。`TaskGroupHead` 当年从 web CSS 升进共享层
 * 用的就是同一条理由（见那个文件的文件头）。
 *
 * ⚠️ `packages/ui` 是 RN 包，**没有 CSS 载体**（`find packages/ui -name '*.css'` = 0）。
 * 所以"样式住共享层"在这里的落地形态是 **RN 样式表 + 共享组件**：
 * web 侧由 `react-native-web` 编译成原子 class。与四象限同一机制、同一分工。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 分工：容器归本层，内容与 DOM 归宿主（与 `QuadrantBoard` 逐条同构）
 *
 * | 本层负责 | 宿主负责（经插槽） |
 * |---|---|
 * | 横排等宽的列、列的表面/圆角/内边距、列标题的语义文字样式、列内计数 | 列的内容（`tasks`）与列名文案（`labels`） |
 * | 每列渲染共享 `TaskList`（⇒ 行 = `TaskRow`） | 行尾动作（`renderTrailing`）、元信息（`renderMeta`） |
 * | 投放层的**位置**（绝对定位、铺满列内容区、`pointerEvents:none`） | 投放层**是什么**（`renderColumnOverlay`：web 挂 dnd-kit 的 droppable） |
 * | 行外层包装的**位置** | 包装**是什么**（`renderRowWrapper`：web 挂 sortable 的 ref/transform） |
 *
 * 拖放整套留在 web：`@dnd-kit/core` 是 DOM 库，装进共享层等于让 iOS 去解析 DOM
 *（与 `QuadrantBoard` 文件头第 2 条、`ManualSortDnd.tsx` 文件头同一条理由）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList.tsx` / `QuadrantBoard.tsx` 同一个理由：i18n 包自己带过一份 React，
 * 四端会同时中招（`check:mobile-bundle` 盯着这件事）。所以列的无障碍整句是**函数**，
 * 模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` 在 `react-native-web` 上都有等价实现；`<div>` 在 iOS 上不存在。
 * 拖放要的 DOM 节点由宿主经 `renderColumnOverlay` / `renderRowWrapper` 注入。
 *
 * ⚠️ 尚未登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT` 清单
 * （它调了 `useHeytaTokens` / `useHeytaText`）。补登记是一行 `'TaskBoard',`；
 * 那一行落在**另一条线正在改的同一张表**上（attachments 的符号），所以本单没动。
 * 缺口由 `apps/web/tests/kanban-row-parity.spec.tsx` 的行为判据兜着：
 * 只挂 `KanbanView`（不套外壳 Provider）也必须渲染出共享行 —— 少了 Provider 会当场抛。
 */

import React, { forwardRef, useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';
import type { Task } from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import type { TaskRow } from './model.js';
import { TaskList, type TaskListLabels } from './TaskList.js';

/** 一列。`id` 是稳定 key（清单 id，收集箱用 `'inbox'` 之类的宿主常量）。 */
export interface TaskBoardColumn {
  readonly id: string;
  /** 列名（宿主已措辞：清单名 / 「收集箱」）。 */
  readonly title: string;
  /** 这一列里的任务。**顺序由宿主给**（本层不重排：看板顺序是宿主的语义）。 */
  readonly tasks: readonly Task[];
}

/** 面板文案，**每一项都由宿主注入**（见文件头）。 */
export interface TaskBoardLabels {
  /**
   * 整列给屏幕阅读器的那一句（列名 + 条数）。
   * **一整句**，不要用前缀拼标题。
   */
  readonly columnA11y: (column: TaskBoardColumn) => string;
  /**
   * 空列显示什么。省略 ⇒ 列里什么都不画（空列本身仍是投放目标）。
   *
   * ⚠️ 它是**函数**：文案依赖列名（"「工作」里还没有任务"），模板留在有 i18n 的一侧。
   */
  readonly empty?: (column: TaskBoardColumn) => string;
}

export interface TaskBoardProps {
  /** 全部列。**顺序由宿主给**（本层不排序，也不重排列）。 */
  readonly columns: readonly TaskBoardColumn[];
  readonly labels: TaskBoardLabels;
  /** 勾选/取消勾选。**不要在组件内部改数据** —— 变更必须走宿主的 action 层。 */
  readonly onToggleTask: (taskId: string) => void;
  /** 点整行的行为。**给了就打开详情；不给时整行不可点**（理由见 `TaskList`）。 */
  readonly onOpenTask?: (taskId: string) => void;
  /**
   * 选中的那一行 —— 原样转给每一列的 `TaskList`。
   *
   * 🔴 看板是同一批任务的又一种投影，用户在列表/四象限里选中哪一条，
   * 切过来必须看得见"还是它"（同一枚 `useSelected('task')`，不是本层自己记）。
   */
  readonly activeTaskId?: string | null;
  /** 行级无障碍文案，原样转给 `TaskList`。 */
  readonly taskLabels?: TaskListLabels;
  /** 标题下方的元信息行，原样转给 `TaskList`（内容归宿主）。 */
  readonly renderMeta?: (row: TaskRow) => React.ReactNode;
  /** 行尾的动作，原样转给 `TaskList`（web 拿它注入拖拽握把）。 */
  readonly renderTrailing?: (row: TaskRow) => React.ReactNode;
  /**
   * 行外面再包一层（宿主注入的节点）。web 用它挂 dnd-kit 的 sortable 节点 ——
   * 共享行是 RN `View`，宿主拿不到它的 DOM ref。
   * 省略 ⇒ 原样返回共享行（与 `TaskList.renderRowWrapper` 同一条契约）。
   */
  readonly renderRowWrapper?: (row: TaskRow, node: React.ReactNode) => React.ReactNode;
  /**
   * 每列内的**宿主覆盖层插槽**（绝对定位、铺满列的内容区）。
   *
   * web 用它挂 dnd-kit 的 droppable 节点（dnd-kit 按 `getBoundingClientRect` 命中，
   * **不需要**这个节点可点）。不传就完全不产出这一层 —— 移动端没有鼠标。
   *
   * 🔴 覆盖层的**尺寸**由本层给（`TaskBoardDropLayer`，绝对定位铺满列内容区）：
   * 宿主自己写的 `<div>` 在这里是 0 高度的（块级元素没有内容就没有高度），
   * 于是 droppable 的 rect 是 0×0 —— **拖不进空列，而且不报错**。
   */
  readonly renderColumnOverlay?: (column: TaskBoardColumn) => React.ReactNode;
  /**
   * 列里那一段（`TaskList`）外面再包一层（宿主注入的节点）。
   *
   * web 用它挂 `SortableContext` —— `useSortable` **必须在** `SortableContext` 之内，
   * 否则 dnd-kit 的默认上下文把 draggable/droppable 双双判成 `disabled`
   *（实测 `@dnd-kit/sortable@10` 的默认 context：`disabled: {draggable:false,droppable:false}`），
   * 症状是"握把在、拖不动，且没有任何报错"。
   * `SortableContext` 不产出 DOM，所以这一层是纯粹的接线。
   */
  readonly renderColumnWrapper?: (
    column: TaskBoardColumn,
    node: React.ReactNode,
  ) => React.ReactNode;
  /**
   * 哪一列正处于拖拽悬停 —— 只影响**边框**（用 `color.primary`），不动几何。
   * 拖拽状态由宿主算（本层不认识 dnd-kit）；`null` / 省略 = 没有悬停。
   */
  readonly highlightedColumnId?: string | null;
  /** 列容器的 testID（宿主给：既有锚点 `kanban-col-<id>`）。 */
  readonly columnTestID?: (column: TaskBoardColumn) => string | undefined;
  /** 板的根节点 testID（既有锚点 `kanban-view`）。 */
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  /**
   * 🔴 token 里的字重是**数字**（`600`），而 RN 的 `fontWeight` 只接受字符串联合 ——
   * 直接写 `tokens['font-weight.semibold']` 编译不过。与 `QuadrantBoard` 同一处取舍：
   * 转成字符串再窄化，不新造字重。
   */
  const strongWeight = String(tokens['font-weight.semibold']) as TextStyle['fontWeight'];
  return StyleSheet.create({
    /**
     * 板的根：**横排**、等宽列、占满高度。
     *
     * `height: '100%'` 与迁移前那处内联样式**同一个值**（宿主的内容区是确定高度的
     * flex 列）：少了它，列的高度退回内容高度，"一屏几列"就读成"几块高度不一的卡"。
     */
    board: {
      flexDirection: 'row',
      gap: tokens['space.2'],
      height: '100%',
    },
    /**
     * 一列。
     *
     * 🔴 `flex: 1`（= `1 1 0`）与迁移前的 `flex: '1 1 0'` 同一个语义：列**等宽**，
     * 清单多的时候一起变窄，而不是横向溢出（迁移前那些 `overflowX: 'auto'`
     * 在等宽列下从来没有被触发过 —— 保留一个永不触发的声明会让下一个人以为
     * "列可以横向滚动"）。
     *
     * 表面色 + 圆角 + 细边框：卡片与页面底色只差 7/255（`#fff` vs `#f8fafc`），
     * 不画边框时一屏几列读成一片白（设计系统里那条"边框分不开时才许用阴影"的边界，
     * 这里选边框，不用阴影 —— 列不是浮层）。
     */
    column: {
      flex: 1,
      padding: tokens['space.2'],
      borderRadius: tokens['radius.lg'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.surface'],
    },
    /** 拖拽悬停：只换边框色，不动几何（动几何会让整列抖一下）。 */
    columnHighlighted: {
      borderColor: tokens['color.primary'],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
      marginBottom: tokens['space.2'],
    },
    /** 列名：区块标题（`section-title`），不新造字号/字重。 */
    title: {
      color: tokens['color.foreground'],
      fontWeight: strongWeight,
      flexShrink: 1,
    },
    /** 列内计数：安静档（辅助说明），靠 `marginLeft:'auto'` 推到行尾。 */
    count: {
      marginLeft: 'auto',
      color: tokens['color.foreground-muted'],
    },
    /** 列里的列表：`flex: 1` 让列内滚动发生在列表自己身上。 */
    list: {
      flex: 1,
    },
  });
}

/**
 * 列内投放层的**尺寸**：铺满列的内容区。
 *
 * 🔴 它是**模块级常量**，不进 `makeStyles(tokens)`：这里一个 token 都不需要
 *（只有绝对定位与 `pointerEvents`），于是它也就不依赖 `HeytaUiProvider` ——
 * 这一条是刻意的：宿主经 `ref` 把它挂成 dnd-kit 的 droppable 节点，
 * 而 `useDroppable` 是 hook，只能由宿主在自己的组件边界里调（见 `TaskBoardColumnDropLayer`）。
 *
 * 🔴 `pointerEvents: 'none'` 是**必须的**：这一层铺满列的内容区，
 * 否则它会把勾选框、行、拖拽握把的点击全吃掉（症状是"什么都点不动"，不报错）。
 * dnd-kit 的命中靠 **rect**，不靠事件冒泡。
 */
const DROP_LAYER_STYLE = {
  ...StyleSheet.absoluteFillObject,
  pointerEvents: 'none',
} as const;

/**
 * 投放层的**壳**：尺寸归共享层，`ref`（= dnd-kit 的 droppable 节点）归宿主。
 *
 * ```tsx
 * function ColumnDropZone({ columnId }) {
 *   const { setNodeRef } = useDroppable({ id: `kanban-col-${columnId}`, data: { column: columnId } });
 *   return <TaskBoardColumnDropLayer ref={setNodeRef} />;
 * }
 * ```
 *
 * 为什么需要这一个导出：宿主自己写的 `<div>` 放进绝对定位容器里是 **0 高度**的
 * （块级元素没有内容就没有高度），droppable 的 rect 就是 0×0 ⇒
 * **拖不进空列，而且不报任何错**。尺寸与 ref 分居两层，正是本仓
 * `renderCellOverlay`（四象限）那条分工的另一种落法：那边宿主自己写尺寸
 *（于是有 1 处内联样式），这边把尺寸收进共享层。
 *
 * ⚠️ 它**不**消费 token，所以不需要 `HeytaUiProvider` —— 宿主可以在任何位置挂它。
 */
export const TaskBoardColumnDropLayer = forwardRef<unknown, { readonly testID?: string }>(
  function TaskBoardColumnDropLayer({ testID }, ref) {
    // `ref` 的静态类型是 `unknown`（RN 的 View 实例类型在 RNW 下就是 DOM 节点，
    // 但共享层不许 import DOM 类型）—— 这里只在类型层窄化，运行时一个字节都不变。
    return <View ref={ref as never} style={DROP_LAYER_STYLE} testID={testID} />;
  },
);

export function TaskBoard({
  columns,
  labels,
  onToggleTask,
  onOpenTask,
  activeTaskId,
  taskLabels,
  renderMeta,
  renderTrailing,
  renderRowWrapper,
  renderColumnOverlay,
  renderColumnWrapper,
  highlightedColumnId,
  columnTestID,
  testID,
}: TaskBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  return (
    <View style={styles.board} testID={testID}>
      {columns.map((column) => {
        const highlighted = highlightedColumnId === column.id;
        /**
         * 🔴 列里的行**就是** `TaskList` 渲染的行（见文件头）。
         * 档位由容器决定：列窄，用 `compact`（与四象限同一档理由）。
         */
        const list = (
          /**
           * ⚠️ 这几个可选 prop **直接传 `undefined`**，不用 `{...(x === undefined ? {} : {x})}` 那种
           * 展开守卫：`TaskList` / `TaskRow` 内部一律按 `=== undefined` 判"没给"，
           * 两种写法**运行结果逐字节相同**（多传一个值为 `undefined` 的属性不等于"给了"）。
           * 选直传是为了让 `check:selection-single-source` 的断言 F 看得见这一层
           * **确实把选中递下去了**（那条判据认的是 JSX 属性形态 `activeTaskId={…}`）。
           */
          <TaskList
            tasks={column.tasks}
            onToggleTask={onToggleTask}
            onOpenTask={onOpenTask}
            activeTaskId={activeTaskId}
            labels={taskLabels}
            renderMeta={renderMeta}
            renderTrailing={renderTrailing}
            renderRowWrapper={renderRowWrapper}
            density="compact"
            {...(labels.empty === undefined ? {} : { emptyMessage: labels.empty(column) })}
          />
        );
        return (
          <View
            key={column.id}
            style={[styles.column, highlighted ? styles.columnHighlighted : null]}
            testID={columnTestID?.(column)}
            // 整列一句话交给读屏（列名 + 条数）—— 与四象限每格的 `cellA11y` 同一路数。
            accessibilityRole="summary"
            accessibilityLabel={labels.columnA11y(column)}
          >
            <View style={styles.header}>
              <Text style={[text['section-title'], styles.title]} numberOfLines={1}>
                {column.title}
              </Text>
              {/* 计数是纯数字：数字不是文案，不需要词条（`QuadrantCountBadge` 同一先例）。 */}
              <Text style={[text.caption, styles.count]}>{String(column.tasks.length)}</Text>
            </View>

            <View style={styles.list}>
              {/* 省略插槽 ⇒ 原样返回那一段（移动端不传，DOM 逐字节不变）。 */}
              {renderColumnWrapper === undefined ? list : renderColumnWrapper(column, list)}
            </View>

            {/*
              投放层：**尺寸**由本层给（`TaskBoardColumnDropLayer`），**ref** 由宿主给。
              宿主返回的节点自己就是绝对定位那一层，这里不再套壳。
            */}
            {renderColumnOverlay === undefined ? null : renderColumnOverlay(column)}
          </View>
        );
      })}
    </View>
  );
}
