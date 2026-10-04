/**
 * TimelineBoard —— 四端共用的**一根共轴**时间线板（`timeline` 重画刀，goal P1）
 * =======================================================================
 *
 * 与被它替换掉的 `TimelineView`（每个任务一张自归一化甘特图，已删除）的本质区别：
 *
 *   1. **整视图只有一根轴**（`timeline-axis` 数量 == 1）：行与行、刻度与今天线
 *      全部对齐到同一个窗口（`boardWindow`）—— 位置第一次携带信息（R4 类 D）；
 *   2. **三态降级**（`TaskTimePosition`）：`point` 画菱形、`range` 画条、
 *      `unscheduled` 进**有名字的「未排期」泳道**且不落图 —— 绝不编长度
 *      （行数据 `TimelineBoardRow` 在形状上就没有长度字段，想编都没数可用）；
 *   3. **无障碍表面不丢**（R4 判据 6）：每行都有文字标题与日期；菱形/条/轴/今天线
 *      是 `aria-hidden` 的装饰，读屏读到的是文字。日期文字**只来自 `dueDate`**
 *      （`dueText`）—— 判据 4 的来源就在那一行。
 *
 * ## 布局：行头列 + 轨道列（冻结行头，不需要横向滚动）
 *
 * 每行是 `[行头 BOARD_HEADER_PERCENT%][轨道 flex:1]` 的 flex 行；轴行用同样的
 * 比例留白，所以刻度与轨道对齐。百分比编码在任何宽度下都成立 —— **没有滚动**，
     * 也就不存在"多 ScrollView 同步滚"这个坑（goal §2.1 禁止的正是它）。
 * 移动端喂 `compactTicks`（宿主判屏宽，与 `QuadrantBoard.twoColumns` 同一先例：
 * 视口是平台概念，不许渗进共享层）。
 *
 * ## 交互：P1 为零（与被替换的实现相同）
 *
 * 点行开详情、拖拽排期是 P2（goal §3.2）；这一刀只把「位置」变成真的。
 *
 * 🔴 文案全部由宿主注入（`labels`），本文件不 import `@heyta/i18n`；
 * 只用 RN 原语；样式全 token（`check:design` 拦裸值）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import {
  toLocalDate,
  type LocalDate,
  type TimelineBoardRow,
} from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import { EmptyState } from '../empty-state/EmptyState.js';
import {
  BOARD_HEADER_PERCENT,
  TRACK_FRACTION,
  axisTicksForWindow,
  boardWindow,
  dueText,
  isOverdue,
  markerMs,
  msAtRegionX,
  moveStartMs,
  percentAt,
  resizeMinutes,
  sortRowsForBoard,
  tickText,
  todayPercent,
  type TimelineBoardLabels,
  type TimelineScheduleChange,
} from './board-model.js';
import { safeLocalDate } from './model.js';

/** 刻度标签的固定宽度（dp）。首/尾刻度贴边用（与旧 `GanttChart` 同值同理由）。 */
const AXIS_LABEL_WIDTH = 64;

/** 数字 → RN 百分比维度（`${number}%` 模板字面量类型，见旧 `GanttChart.pct`）。 */
function pct(value: number): DimensionValue {
  return `${value}%`;
}

export interface TimelineBoardProps {
  /** 板上的行。顺序 = 输入序；**显示**序由共享层按落笔时刻排序。 */
  readonly rows: readonly TimelineBoardRow[];
  /** 今天的本地日历日。窗口的周锚点；不给就从 `now` 推。 */
  readonly today?: LocalDate;
  /** 用于日期格式化与今天线的时间戳。默认 `Date.now()`。 */
  readonly now?: number;
  /** 紧凑刻度（只留日期）。移动端宿主判屏宽后传入。 */
  readonly compactTicks?: boolean;
  /** 全部文案。**宿主注入**。 */
  readonly labels: TimelineBoardLabels;
  readonly testID?: string;
  /**
   * 排期拖拽的**出口**（P2，ADR-0043 §5）。给了才启用手势；不给 = 只读
   * （移动端宿主 P3 之前不传 —— 手势与其平台适配不在 P2）。
   *
   * 🔴 本组件**只算几何**（像素 → 时间戳），把变更原样交给宿主；
   * 写 op 是宿主经 `setSchedule` → `dispatch()` 的事 —— 组件连 store 是什么都不知道。
   */
  readonly onScheduleTask?: (taskId: string, change: TimelineScheduleChange) => void;
  /**
   * 「点空白建任务带日期」（goal §3.2 手势 4，ADR-0043 §5）的**出口**：
   * 点击轴（空白标尺）的某个时刻 ⇒ 宿主用**既有建任务 op** 带上日期字段创建。
   * 不给 = 手势关闭。组件只换算时间戳，标题与写 op 全在宿主。
   */
  readonly onCreateAt?: (atMs: number) => void;
  /**
   * 点任务行 / 泳道条目 ⇒ 打开该任务（**多端不同入口**：web 的排期入口是拖拽，
   * 触屏端的入口是「点行 → 详情表单」—— 横向拖拽与纵向滚动在触摸上冲突，
   * 硬搬鼠标手势不是触屏的最佳实践）。不给 = 行不可点。
   */
  readonly onOpenTask?: (taskId: string) => void;
  /**
   * 选中的那一条（行与未排期泳道里的条目共用同一个值）。
   *
   * 🔴 「列表」与「时间线」是同一批任务的两种投影：在哪儿选中都得在另一处
   * 看得见"还是它"。省略 = 不画高亮（默认值等于加这个 prop 之前的行为）。
   */
  readonly activeTaskId?: string | null;
}

export function TimelineBoard(props: TimelineBoardProps): React.JSX.Element {
  const {
    rows,
    today,
    now,
    compactTicks = false,
    labels,
    testID,
    onScheduleTask,
    onCreateAt,
    onOpenTask,
    activeTaskId,
  } = props;
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const clock = now ?? Date.now();

  // ── 拖拽（P2）：ref 持会话（Responder 处理器要读最新值），state 只喂预览 ──
  const regionRef = useRef<View | null>(null);
  /** 轴点击期间是否发生过移动（移动 = 拖拽扫过，不是「点空白」）。 */
  const axisMoved = useRef(false);
  const regionAbs = useRef<{ pageX: number; width: number } | null>(null);
  const dragRef = useRef<{
    taskId: string;
    kind: 'move' | 'resize' | 'lane';
    grantX: number;
    /** 泳道拖拽时是**指针当前 pageX**（落点换算用）；move/resize 不用。 */
    x?: number;
    origStartMs?: number;
    origMinutes?: number;
    aiMinutes?: number;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    taskId: string;
    kind: 'move' | 'resize' | 'lane';
    dx: number;
    x?: number;
  } | null>(null);

  const measureRegion = (): void => {
    const node = regionRef.current;
    if (node !== null && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, _y, width) => {
        regionAbs.current = { pageX: x, width };
      });
    }
  };
  // 🔴 `measureInWindow` 的回调是**异步**的：只在手势 grant 时测量的话，
  // 「点空白」这种 down→up 一瞬间的手势在 release 时 regionAbs 还是 null
  // （实测：onCreateAt 被静默跳过）。渲染后主动测一次，手势时只做刷新。
  useEffect(() => {
    measureRegion();
  });
  const schedule = (taskId: string, change: TimelineScheduleChange): void => {
    onScheduleTask?.(taskId, change);
  };

  /** 泳道条目的拖拽属性（拖上轴 = 排期，ADR-0043 §5 手势 1）。 */
  const laneResponderProps = (row: TimelineBoardRow) => ({
    onStartShouldSetResponder: (): boolean => {
      dragRef.current = { taskId: row.taskId, kind: 'lane' as const, grantX: 0, aiMinutes: row.aiMinutes };
      measureRegion();
      return true;
    },
    // 🔴 **拒绝终止请求**：拖拽路径会扫过滚动态的祖先，它们在 move 时会来抢
    // responder（实测：一抢 release 就永远不来，拖拽静默作废）。拒绝它 =
    // 拖拽期间祖先不许滚动 —— 这正是排期拖拽想要的语义。
    onResponderTerminationRequest: (): boolean => false,
    onResponderMove: (e: { nativeEvent: { pageX: number } }): void => {
      const d = dragRef.current;
      if (d === null) return;
      if (d.grantX === 0) d.grantX = e.nativeEvent.pageX;
      d.x = e.nativeEvent.pageX;
      setDragPreview({ taskId: row.taskId, kind: 'lane' as const, dx: 0, x: d.x });
    },
    onResponderRelease: (): void => {
      const d = dragRef.current;
      const abs = regionAbs.current;
      if (d !== null && abs !== null && d.x !== undefined) {
        const atMs = msAtRegionX(d.x - abs.pageX, abs.width, window);
        schedule(row.taskId, {
          startDate: atMs,
          // 初始长度取估时（ADR-0043 §5）；没有估时就不点名时长 ——
          // 只有一个起点的任务在板上如实画成点，不编长度。
          ...(row.aiMinutes !== undefined ? { durationMinutes: row.aiMinutes } : {}),
        });
      }
      dragRef.current = null;
      setDragPreview(null);
    },
  });

  /** 条的移动拖拽（手势 2：拖整条 = 平移起点；时长不动）。 */
  const barResponderProps = (taskId: string, startMs: number, endMs: number) => ({
    onStartShouldSetResponder: (): boolean => {
      dragRef.current = {
        taskId,
        kind: 'move' as const,
        grantX: 0,
        origStartMs: startMs,
        origMinutes: (endMs - startMs) / 60_000,
      };
      measureRegion();
      return true;
    },
    // 🔴 同泳道：拒绝滚动态祖先的抢占，否则 release 永远不来。
    onResponderTerminationRequest: (): boolean => false,
    onResponderMove: (e: { nativeEvent: { pageX: number } }): void => {
      const d = dragRef.current;
      if (d === null) return;
      if (d.grantX === 0) d.grantX = e.nativeEvent.pageX;
      setDragPreview({ taskId, kind: 'move' as const, dx: e.nativeEvent.pageX - d.grantX });
    },
    onResponderRelease: (): void => {
      const d = dragRef.current;
      if (d !== null && d.origStartMs !== undefined) {
        const dx =
          d.taskId === taskId && dragPreview !== null && dragPreview.kind === 'move'
            ? dragPreview.dx
            : 0;
        schedule(taskId, { startDate: moveStartMs(d.origStartMs, dx, pxPerMs) });
      }
      dragRef.current = null;
      setDragPreview(null);
    },
  });

  /** 右缘手柄的拖拽（手势 3：拖边 = 改时长；起点不动）。 */
  const resizeResponderProps = (taskId: string, origMinutes: number) => ({
    onStartShouldSetResponder: (): boolean => {
      dragRef.current = { taskId, kind: 'resize' as const, grantX: 0, origMinutes };
      measureRegion();
      return true;
    },
    // 🔴 同泳道：拒绝滚动态祖先的抢占。
    onResponderTerminationRequest: (): boolean => false,
    onResponderMove: (e: { nativeEvent: { pageX: number } }): void => {
      const d = dragRef.current;
      if (d === null) return;
      if (d.grantX === 0) d.grantX = e.nativeEvent.pageX;
      setDragPreview({ taskId, kind: 'resize' as const, dx: e.nativeEvent.pageX - d.grantX });
    },
    onResponderRelease: (): void => {
      const d = dragRef.current;
      if (d !== null && d.origMinutes !== undefined) {
        const dx = dragPreview !== null && dragPreview.kind === 'resize' ? dragPreview.dx : 0;
        schedule(taskId, { durationMinutes: resizeMinutes(d.origMinutes, dx, pxPerMs) });
      }
      dragRef.current = null;
      setDragPreview(null);
    },
  });

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { gap: tokens['space.4'] },
        axisRow: { flexDirection: 'row', alignItems: 'flex-end' },
        headerCol: { width: pct(BOARD_HEADER_PERCENT) },
        axis: { flex: 1, position: 'relative', height: tokens['space.4'] },
        tick: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          justifyContent: 'center',
          width: AXIS_LABEL_WIDTH,
        },
        tickLabel: {
          fontSize: tokens['font-size.2xs'],
          color: tokens['color.foreground-subtle'],
        },
        tickToday: { color: tokens['color.primary'] },
        todayTick: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: tokens['border-width.thick'],
          backgroundColor: tokens['color.warning'],
        },
        rowsRegion: { position: 'relative', gap: tokens['space.2'] },
        todayLine: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: tokens['border-width.thick'],
          backgroundColor: tokens['color.warning'],
        },
        dropLine: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: tokens['border-width.thick'],
          backgroundColor: tokens['color.primary'],
        },

        row: { flexDirection: 'row', alignItems: 'center' },
        /**
         * 选中的那一条。与 `TaskRow.rowActive` 同一对 token、同一条理由：
         * 只加底色与圆角，**不动几何** —— 选中变化时行宽与条的位置不能跳。
         */
        rowActive: {
          backgroundColor: tokens['color.primary-subtle'],
          borderRadius: tokens['radius.md'],
        },
        rowHead: {
          width: pct(BOARD_HEADER_PERCENT),
          paddingRight: tokens['space.2'],
          gap: tokens['space.1'],
        },
        rowMeta: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: tokens['space.2'],
        },
        track: {
          flex: 1,
          position: 'relative',
          height: tokens['space.6'],
          backgroundColor: tokens['color.surface-sunken'],
          borderRadius: tokens['radius.sm'],
          // 🔴 不裁：落笔点在窗口起点时菱形会探出半格 —— 探出是**真的**（它就在那里），
          // 裁掉它就是又一次"界面在说谎"。行头列在左边，探出只会进入留白。
          overflow: 'visible',
        },
        point: {
          position: 'absolute',
          width: tokens['space.3'],
          height: tokens['space.3'],
          borderRadius: tokens['radius.sm'],
          backgroundColor: tokens['color.primary'],
          transform: [{ rotate: '45deg' }],
          // 光标可供性：RN 类型只认 'auto'|'pointer'（原生无光标概念），RNW 透传
          // 完整 CSS 集 —— 断言过类型、运行时给浏览器真实关键词，原生侧被忽略。
          cursor: 'grab' as unknown as 'pointer',
        },
        pointOverdue: { backgroundColor: tokens['color.warning'] },
        rangeBar: {
          position: 'absolute',
          top: tokens['space.2'],
          bottom: tokens['space.2'],
          backgroundColor: tokens['color.primary-subtle'],
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.primary'],
          borderRadius: tokens['radius.sm'],
          cursor: 'grab' as unknown as 'pointer',
        },
        // 🔴 resize 手柄的**触控目标是真实的 24×24 盒子**（R1 类 A 的正解形状：
        // 命中区是盒子，不是负边距借位）—— 视觉条纹只有 space.2 宽，居中在内。
        // 第一版把手柄做成 8px 宽的可点盒子，低于本仓自己取的 24px 地板。
        resizeHit: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: tokens['space.6'],
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'col-resize' as unknown as 'pointer',
        },
        resizeStripe: {
          width: tokens['space.2'],
          height: tokens['space.6'],
          backgroundColor: tokens['color.primary'],
          opacity: 0.45,
          borderRadius: tokens['radius.sm'],
        },
        axisClickable: { cursor: 'pointer' },
        lane: {
          backgroundColor: tokens['color.surface-sunken'],
          borderRadius: tokens['radius.sm'],
          padding: tokens['space.3'],
          gap: tokens['space.2'],
        },
        laneTitle: { color: tokens['color.foreground-muted'] },
        laneItem: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: tokens['space.2'],
        },
      }),
    [tokens],
  );

  // ── 空态：一句人话（锚点 testID 不能丢，e2e 白屏检测挂在它上面） ──────
  if (rows.length === 0) {
    return (
      <View
        testID={testID ?? 'timeline-view'}
        role="group"
        aria-label={labels.ariaEmpty}
        style={styles.root}
      >
        <EmptyState title={labels.empty} testID="timeline-view-empty" />
      </View>
    );
  }

  const safeToday: LocalDate = safeLocalDate(today) ?? toLocalDate(clock);
  const window = boardWindow(safeToday, rows);
  const pxPerMs =
    regionAbs.current !== null
      ? (regionAbs.current.width * TRACK_FRACTION) / (window.endMs - window.startMs)
      : 0;
  const allTicks = axisTicksForWindow(window, safeToday);
  // 🔴 紧凑档（窄屏）：刻度密度减半 —— 实测 411dp 的轨道放不下 7 个日期标签，
  // 相邻标签两两重叠成"09-2829"（2026-10-02 移动端截图人眼抓到）。
  // 今天的刻度**永远保留**（隔位过滤时不被跳掉）；定位是百分比，过滤不影响坐标。
  const ticks = compactTicks
    ? allTicks.filter((tick, index) => index % 2 === 0 || tick.isToday)
    : allTicks;
  const todayPct = todayPercent(window, clock);

  const scheduled = sortRowsForBoard(
    rows.filter((row) => row.position.kind !== 'unscheduled'),
  );
  const unscheduled = rows.filter((row) => row.position.kind === 'unscheduled');

  // 今天线在**行区**里的横坐标：行区 = 行头列 + 轨道列，
  // 轨道内的百分比要换算到整行宽（`HEADER + p·(100−HEADER)/100`）。
  const todayLinePct =
    todayPct === undefined
      ? undefined
      : BOARD_HEADER_PERCENT + (todayPct * (100 - BOARD_HEADER_PERCENT)) / 100;

  return (
    <View
      testID={testID ?? 'timeline-view'}
      role="group"
      aria-label={labels.ariaGroup(rows.length)}
      style={styles.root}
    >
      {/* ── 轴：整视图只有这一根，也是「点空白建任务」的点击面 ─────────── */}
      <View style={styles.axisRow}>
        <View style={styles.headerCol} />
        <View
          testID="timeline-axis"
          style={[styles.axis, onScheduleTask !== undefined ? styles.axisClickable : undefined]}
          aria-hidden
          {...(onCreateAt === undefined
            ? {}
            : {
                onStartShouldSetResponder: (): boolean => {
                  axisMoved.current = false;
                  measureRegion();
                  return true;
                },
                onResponderMove: (): void => {
                  axisMoved.current = true;
                },
                onResponderRelease: (e: { nativeEvent: { pageX: number } }): void => {
                  // 🔴 移动过 = 别的手势扫过轴（比如条被拖出窗口），不是「点空白」。
                  if (axisMoved.current) return;
                  const abs = regionAbs.current;
                  if (abs === null || abs.width <= 0) return;
                  onCreateAt(msAtRegionX(e.nativeEvent.pageX - abs.pageX, abs.width, window));
                },
              })}
        >
          {ticks.map((tick) => {
            const isFirst = tick === ticks[0];
            const isLast = tick === ticks[ticks.length - 1];
            return (
              <View
                key={tick.atMs}
                testID={`timeline-tick-${String(tick.atMs)}`}
                style={[
                  styles.tick,
                  {
                    left: pct(percentAt(tick.atMs, window)),
                    marginLeft: isFirst
                      ? 0
                      : isLast
                        ? -AXIS_LABEL_WIDTH
                        : -AXIS_LABEL_WIDTH / 2,
                    alignItems: isFirst ? 'flex-start' : isLast ? 'flex-end' : 'center',
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.tickLabel, tick.isToday ? styles.tickToday : undefined]}
                >
                  {tickText(tick, labels, compactTicks, clock)}
                </Text>
              </View>
            );
          })}
          {todayPct !== undefined && (
            <View
              testID="timeline-today-tick"
              style={[styles.todayTick, { left: pct(todayPct) }]}
            />
          )}
        </View>
      </View>

      {/* ── 行区：行 = 任务；今天线贯穿（画在行之后，压住轨道底色） ────── */}
      <View ref={regionRef} testID="timeline-rows-region" style={styles.rowsRegion} role="list">
        {scheduled.map((row) => {
          const position = row.position;
          const marker = markerMs(position);
          const overdue = isOverdue(position, clock);
          const whenColor = overdue
            ? tokens['color.warning']
            : tokens['color.foreground-subtle'];
          return (
            <Pressable
              key={row.taskId}
              testID={`timeline-row-${row.taskId}`}
              role="listitem"
              style={activeTaskId === row.taskId ? [styles.row, styles.rowActive] : styles.row}
              onPress={onOpenTask === undefined ? undefined : () => onOpenTask(row.taskId)}
              accessibilityRole={onOpenTask === undefined ? undefined : 'button'}
            >
              {/* 行头：标题 + 截止文字（只来自 dueDate）+ 逾期/估时 badge */}
              <View style={styles.rowHead}>
                <Text
                  testID={`timeline-task-title-${row.taskId}`}
                  numberOfLines={1}
                  style={[text['row-title'], { color: tokens['color.foreground'] }]}
                >
                  {row.title}
                </Text>
                <View style={styles.rowMeta}>
                  {position.kind !== 'unscheduled' && (
                    <Text
                      testID={`timeline-when-${row.taskId}`}
                      style={[text.caption, { color: whenColor }]}
                    >
                      {position.kind === 'point' ? dueText(position.atMs, clock) : dueText(position.startMs, clock)}
                    </Text>
                  )}
                  {overdue && (
                    <Text
                      testID={`timeline-overdue-${row.taskId}`}
                      style={[text.caption, { color: tokens['color.warning'] }]}
                    >
                      {labels.overdue}
                    </Text>
                  )}
                  {row.aiMinutes !== undefined && (
                    <Text
                      testID={`timeline-ai-${row.taskId}`}
                      style={[text.caption, { color: tokens['color.foreground-muted'] }]}
                    >
                      {labels.aiBadge(row.aiMinutes)}
                    </Text>
                  )}
                </View>
              </View>

              {/* 轨道：菱形/条是装饰（aria-hidden），信息在行头文字里 */}
              <View style={styles.track} aria-hidden>
                {position.kind === 'point' && marker !== undefined && (
                  <View
                    testID={`timeline-point-${row.taskId}`}
                    style={[
                      styles.point,
                      overdue ? styles.pointOverdue : undefined,
                      {
                        left: pct(percentAt(marker, window)),
                        marginLeft: -(tokens['space.3'] / 2),
                        top: (tokens['space.6'] - tokens['space.3']) / 2,
                      },
                    ]}
                    {...(onScheduleTask === undefined
                      ? {}
                      : // 🔴 **点也可以拖**（滴答同款）：有截止无起点的任务被拖动时，
                        // commit 只写 startDate —— `start + due` 经生产者变成一条
                        // **真的 range**（终点 = 截止）。这是不编时长而能得到条的
                        // 唯一路径，也正是"排期"这个动作的语义。
                        barResponderProps(row.taskId, position.atMs, position.atMs))}
                  />
                )}
                {position.kind === 'range' && (() => {
                  // 拖拽预览：move 平移起点、resize 改变终点（起点不动）。
                  let startMs = position.startMs;
                  let endMs = position.endMs;
                  if (
                    dragPreview !== null &&
                    dragPreview.taskId === row.taskId &&
                    dragRef.current !== null
                  ) {
                    if (dragPreview.kind === 'move' && dragRef.current.origStartMs !== undefined) {
                      startMs = moveStartMs(dragRef.current.origStartMs, dragPreview.dx, pxPerMs);
                      endMs = startMs + (position.endMs - position.startMs);
                    }
                    if (dragPreview.kind === 'resize' && dragRef.current.origMinutes !== undefined) {
                      endMs =
                        startMs +
                        resizeMinutes(dragRef.current.origMinutes, dragPreview.dx, pxPerMs) * 60_000;
                    }
                  }
                  const isDraggingThis = dragPreview !== null && dragPreview.taskId === row.taskId;
                  return (
                    <View
                      testID={`timeline-bar-${row.taskId}`}
                      style={[
                        styles.rangeBar,
                        {
                          left: pct(percentAt(startMs, window)),
                          width: pct(Math.max(0, percentAt(endMs, window) - percentAt(startMs, window))),
                          ...(isDraggingThis ? styles.resizeStripe : {}),
                        },
                      ]}
                      {...(onScheduleTask === undefined
                        ? {}
                        : barResponderProps(row.taskId, position.startMs, position.endMs))}
                    />
                  );
                })()}
                {position.kind === 'range' && onScheduleTask !== undefined && (
                  <View
                    testID={`timeline-resize-${row.taskId}`}
                    style={[
                      styles.resizeHit,
                      {
                        left: pct(percentAt(position.endMs, window)),
                        marginLeft: -(Number(tokens['space.6']) / 2),
                      },
                    ]}
                    {...(onScheduleTask === undefined
                      ? {}
                      : resizeResponderProps(
                          row.taskId,
                          (position.endMs - position.startMs) / 60_000,
                        ))}
                  >
                    <View style={styles.resizeStripe} />
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
        {todayLinePct !== undefined && (
          <View
            testID="timeline-today-line"
            aria-hidden
            style={[styles.todayLine, { left: pct(todayLinePct) }]}
          />
        )}
        {dragPreview !== null &&
          dragPreview.kind === 'lane' &&
          dragPreview.x !== undefined &&
          regionAbs.current !== null &&
          onScheduleTask !== undefined &&
          (() => {
            const atMs = msAtRegionX(dragPreview.x - regionAbs.current.pageX, regionAbs.current.width, window);
            const p = percentAt(atMs, window);
            return (
              <View
                testID="timeline-drop-line"
                aria-hidden
                style={[styles.dropLine, { left: pct(BOARD_HEADER_PERCENT + (p * (100 - BOARD_HEADER_PERCENT)) / 100) }]}
              />
            );
          })()}
      </View>

      {/* ── 未排期泳道：有名字、可见、**不落图**（R4 判据 5） ───────────── */}
      {unscheduled.length > 0 && (
        <View
          testID="timeline-lane"
          role="group"
          aria-label={labels.unscheduledLane(unscheduled.length)}
          style={styles.lane}
        >
          <Text
            testID="timeline-lane-title"
            style={[text['row-title'], styles.laneTitle]}
          >
            {labels.unscheduledLane(unscheduled.length)}
          </Text>
          {unscheduled.map((row) => (
            <Pressable
              key={row.taskId}
              testID={`timeline-lane-item-${row.taskId}`}
              style={
                activeTaskId === row.taskId ? [styles.laneItem, styles.rowActive] : styles.laneItem
              }
              onPress={onOpenTask === undefined ? undefined : () => onOpenTask(row.taskId)}
              accessibilityRole={onOpenTask === undefined ? undefined : 'button'}
              {...(onScheduleTask === undefined ? {} : laneResponderProps(row))}
            >
              <Text
                testID={`timeline-lane-title-${row.taskId}`}
                style={[text['row-title'], { color: tokens['color.foreground'] }]}
                numberOfLines={1}
              >
                {row.title}
              </Text>
              {row.aiMinutes !== undefined && (
                <Text
                  testID={`timeline-lane-ai-${row.taskId}`}
                  style={[text.caption, { color: tokens['color.foreground-muted'] }]}
                >
                  {labels.aiBadge(row.aiMinutes)}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
