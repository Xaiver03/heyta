/**
 * 「任务」页内的「四象限」那一档 —— 共享 `QuadrantBoard` 的 2×2 矩阵
 * ==================================================================
 *
 * 🔴 **P10 之后，这一档是唯一实现，也是唯一入口。**
 *
 * 它原来是**第 6 个 tab** 的整屏。那个 tab 是**任务书写错**造成的：与
 * [ADR-0015 §4](../../../../docs/adr/0015-four-quadrant-as-derived-view.md)
 * 「入口在「任务」tab 内，不新增第 5 个 tab」直接冲突 —— 四象限是**同一份任务的
 * 另一种投影**，给它一个 tab 会暗示"这里有一批新数据"，而其实一条都没有。
 * 现在 tab 已撤（见 `docs/plans/multi-platform-adaptation.md` 的 P10），
 * 本文件改为 **`TasksScreen` 的页内视图**（由那里 import 并渲染）。
 *
 * ⚠️ 收敛掉的是「第二个入口 + 第二个呈现」：
 * `TasksScreen` 的页内象限原来渲染的是**按象限分组的四段列表**（手写分节 +
 * 共享 `TaskList`）。那一份已删除，换成这里的共享 `QuadrantBoard` ——
 * 从此象限只有**一个实现**（M3 不变量）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一档只回答移动端自己的三个问题
 *
 *   1. 任务与"现在"从哪来 → **由 `TasksScreen` 传进来**（见 `QuadrantScreenProps`）。
 *      本文件**不再自己 `openTaskHost()`**：宿主与物化状态在「任务」页已经就绪，
 *      再开一份就是第二套 task 列表状态（`openTaskHost()` 是单例，但状态不是）。
 *   2. 文案从哪来 → `lib/quadrant-display.ts`（见那里文件头的命名残差）。
 *   3. 周边挂什么 → 行内元信息（截止 / 优先级 / 重复）与行点击（打开详情），
 *      也都是 `TasksScreen` 传进来的插槽。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 卡里的行 = 列表里的行（与 web 同一条契约）
 *
 * `QuadrantBoard` 每一格直接渲染共享 `TaskList`（`density="compact"`），
 * 所以勾选框、行几何、无障碍 role/state 与「任务」页的列表**是同一份实现**。
 * 本文件**不许**自己画一行 —— 一旦画了，象限里的行就会和列表里的行开始漂移，
 * 而那件事不会有任何测试变红（见 `apps/web/tests/quadrant-row-parity.spec.tsx`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 移动端**没有拖放**，而且这不是"待办"
 *
 * web 的象限靠 `@dnd-kit` 拖任务改象限；**那是 DOM 库**，且手机没有鼠标。
 * 移动端因此是"读 + 勾选 + 点进详情改"：勾选框切完成、点整行打开
 * `TaskDetailSheet`（在「任务」页，那里改重要性与截止时间）。
 * ⇒ 共享层的 `highlightedQuadrant` / `renderCellOverlay` 这两个**拖放专用**插槽
 * 这里一概不传。它们不是"漏了"，是这一端不存在对应的交互。
 *
 * ⚠️ 由此带来一条**必须让产品负责人知道**的落差：网页上"拖进哪格就归哪类"是
 * 一步手势；移动端要"点进去 → 改重要性 → 改截止时间"两步以上。
 * 这是平台能力的差别，不是这一档的实现选择。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `HeytaUiProvider` 已由整棵树提供
 *
 * `App.tsx` 的 `Root()` → `ThemeProvider`（它**就是** `HeytaUiProvider`，
 * 见 `apps/mobile/src/theme.tsx`）包住了所有 tab，所以这里不再自己包一层。
 * ⚠️ 本文件是 `check:ui-provider` 扫得到的消费者（`QuadrantBoard` 已在
 * 该脚本的 `PROVIDER_DEPENDENT` 里），拆掉根 Provider 会真的红。
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { Quadrant, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  canPairColumns,
  QuadrantBoard,
  type TaskListLabels,
  type TaskRow as SharedTaskRow,
} from '@heyta/ui';

import { quadrantBoardLabels } from '../lib/quadrant-display';
import { Icon } from '../ui/icons';
import { useTokens } from '../theme';

export interface QuadrantScreenProps {
  /** 全部任务。已完成 / 已删除由领域层分桶时排除，这里不再判一次。 */
  readonly tasks: readonly Task[];
  /** 当前时间（epoch ms）。由 `TasksScreen` 的 `useToday()` 提供。 */
  readonly now: number;
  /** 正在处理中的行 id —— 防止连点发出两条 op。 */
  readonly busyTaskId: string | null;
  /**
   * 行级无障碍文案。**与列表视图同一份**（`TasksScreen` 的 `taskRowLabels`）——
   * 两档的行读屏拿到的话必须一样，否则同一行在两种视图里叫两个名字。
   */
  readonly labels: TaskListLabels;
  /** 标题下方的元信息行（截止 / 优先级 / 重复），原样转给共享板。 */
  readonly renderMeta: (row: SharedTaskRow) => React.ReactNode;
  /** 行尾动作（删除按钮），原样转给共享板。 */
  readonly renderTrailing?: (row: SharedTaskRow) => React.ReactNode;
  /** 勾选 / 取消勾选。变更走宿主的 action 层，本文件不改数据。 */
  readonly onToggleTask: (taskId: string) => void;
  /** 点整行的行为：打开任务详情。 */
  readonly onOpenTask: (taskId: string) => void;
  /** 与任务列表相同的长按批量选择快捷入口。 */
  readonly onLongPressTask?: (taskId: string) => void;
  /**
   * 拖拽落点（拖行尾握把到某一格）。与「长按 → 弹层选一格」走同一个 action。
   * 不给时行尾不挂拖拽握把。
   */
  readonly onDropTask?: (taskId: string, target: Quadrant) => void;
  /** 点握把本身 = 打开「移动到其他象限」弹层（不给时握把不可点）。 */
  readonly onOpenMoveMenu?: (taskId: string) => void;
  readonly selectedTaskIds?: ReadonlySet<string>;
  readonly selectionMode?: boolean;
  /** 选中的那一条 ⇒ 高亮。传的是宿主的**全局选中**，不是本屏自己记的 id。 */
  readonly activeTaskId?: string | null;
}

export function QuadrantScreen({
  tasks,
  now,
  busyTaskId,
  labels,
  renderMeta,
  renderTrailing,
  onToggleTask,
  onOpenTask,
  onLongPressTask,
  onDropTask,
  onOpenMoveMenu,
  selectedTaskIds,
  selectionMode = false,
  activeTaskId,
}: QuadrantScreenProps): React.JSX.Element {
  /*
   * 🔴 2026-11-15：**报可用宽度，不猜设备。**
   *
   * `onLayout` 给的是这一块实际拿到的宽（已扣掉安全区与父容器 padding），
   * 所以同一份代码在手机、iPad 分屏、Mac 窗口上都拿得到真值。
   * 不用 `Dimensions.get('window')` —— 那是物理屏宽，桌面上永远"够大"（本项目实测过）。
   */
  const [availableWidth, setAvailableWidth] = useState(0);
  /**
   * 🔴 2026-11-15：**把这一块可用高度量出来，交给板子当 `minHeight`**。
   *
   * 板子自己声明了 `flexGrow: 1`，但它住在 `Screen` 的滚动内容列里 ——
   * 那一列的高度由内容决定，`flexGrow` 拿不到"剩余空间"，于是矩阵只有内容那么高，
   * 下方空出一大块（真机约 110dp）。量一次高度传下去比继续和 flex 链较劲可靠。
   */
  const [availableHeight, setAvailableHeight] = useState(0);
  const twoColumns = canPairColumns(availableWidth);
  const tokens = useTokens();

  /**
   * 🔴 2026-11-15：**真拖拽**（按住行尾握把拖到别的格子）。
   *
   * 两次尝试的结论：
   *   1. 把 `panHandlers` 挂在包住 `⋯` 的普通 View 上 —— 真机**拖不动**：
   *      `IconButton` 的 `Pressable` 先拿到了 responder，移动事件不再上浮。
   *   2. 改成 `onStartShouldSetPanResponderCapture`（捕获阶段抢先）：
   *      握把在手势一开始就归我们，**点击与拖动由此分工** ——
   *      没位移就松手 = 点（自己调 `onOpenMoveMenu`），位移过 `space.3` = 拖。
   *
   * 这就是为什么握把不直接用 `IconButton`：它必须是"能被 capture 的容器 + 自己判点击"。
   */
  const boardRef = useRef<View>(null);
  const boardRect = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [hover, setHover] = useState<Quadrant | null>(null);

  const measureBoard = useCallback(() => {
    boardRef.current?.measureInWindow((x, y, width, height) => {
      boardRect.current = { x, y, width, height };
    });
  }, []);

  const quadrantAt = useCallback((px: number, py: number): Quadrant | null => {
    const r = boardRect.current;
    if (r.width <= 0 || r.height <= 0) return null;
    if (px < r.x || px > r.x + r.width || py < r.y || py > r.y + r.height) return null;
    const right = px > r.x + r.width / 2;
    const bottom = py > r.y + r.height / 2;
    if (!right && !bottom) return Quadrant.UrgentImportant;
    if (right && !bottom) return Quadrant.ImportantNotUrgent;
    if (!right && bottom) return Quadrant.UrgentNotImportant;
    return Quadrant.Neither;
  }, []);

  const handleFor = useCallback(
    (taskId: string) =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          measureBoard();
          setDraggingTaskId(taskId);
        },
        onPanResponderMove: (_e, g) => {
          if (Math.abs(g.dx) + Math.abs(g.dy) <= tokens['space.3']) return;
          setHover(quadrantAt(g.moveX, g.moveY));
        },
        onPanResponderRelease: (_e, g) => {
          const moved = Math.abs(g.dx) + Math.abs(g.dy) > tokens['space.3'];
          const target = quadrantAt(g.moveX, g.moveY);
          if (!moved) onOpenMoveMenu?.(taskId);
          else if (target !== null) onDropTask?.(taskId, target);
          setDraggingTaskId(null);
          setHover(null);
        },
        onPanResponderTerminate: () => {
          setDraggingTaskId(null);
          setHover(null);
        },
      }).panHandlers,
    [measureBoard, onDropTask, onOpenMoveMenu, quadrantAt, tokens],
  );

  const { t } = useI18n();
  const boardLabels = useMemo(() => quadrantBoardLabels(t), [t]);

  return (
    <View
      ref={boardRef}
      style={{ flex: 1 }}
      onLayout={(e: LayoutChangeEvent) => {
        setAvailableWidth(e.nativeEvent.layout.width);
        setAvailableHeight(e.nativeEvent.layout.height);
        measureBoard();
      }}
    >
      <QuadrantBoard
      {...(availableHeight > 0 ? { minHeight: availableHeight } : {})}
      /*
       * 🔴 2026-11-15：**四象限的列数由「形态档」推导，不是各端写死。**
       *
       * 产品负责人原话：「四象限是不是像坐标系一样的感觉？你为什么没有弄成那样子呢？」
       * 他同时指出：**这套东西不该只服务手机** —— iPad、macOS、Windows 都要用同一套判断。
       *
       * 所以这里不写 `twoColumns` 常量，而是报"我这块可用多宽"，
       * 由 `formFactorOf` 推导档位：任何端只要报宽度，就自动拿到对的一档。
       * 手机上 360dp 落在 `compact`，正好两列；窄窗口 300dp 会退回单列
       * （宁可不并置，也不让格子挤成 150dp 以下读不出字）。
       */
      twoColumns={twoColumns}
      tasks={tasks}
      now={now}
      labels={boardLabels}
      onToggleTask={onToggleTask}
      onOpenTask={onOpenTask}
      onLongPressTask={onLongPressTask}
      selectedTaskIds={selectedTaskIds}
      selectionMode={selectionMode}
      activeTaskId={activeTaskId}
      taskLabels={labels}
      renderMeta={renderMeta}
      {...(hover === null ? {} : { highlightedQuadrant: hover })}
      renderTrailing={
        onDropTask === undefined || onOpenMoveMenu === undefined
          ? renderTrailing
          : (row) => (
              <View
                {...handleFor(row.id)}
                style={{
                  minWidth: tokens['touch-target.min'],
                  minHeight: tokens['touch-target.min'],
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: draggingTaskId === row.id ? tokens['state.disabled-opacity'] : 1,
                }}
                accessibilityRole="button"
                accessibilityLabel={t('web.quadrant.moveTask', { title: row.title })}
                testID={`quadrant-drag-handle-${row.id}`}
              >
                <Icon name="action.more" size="sm" color={tokens['color.foreground-subtle']} />
              </View>
            )
      }
      busyTaskId={busyTaskId}
      testID="quadrant-board"
      />
    </View>
  );
}
