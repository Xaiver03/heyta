/**
 * 移动端日历拖拽重排
 * ==================
 *
 * 手机端「长按任务卡 350ms → 拖动到某一天 → 松手改期」的交互实现。
 * 纯几何判定见 `calendar-drag-hit`；这里负责：
 *  - 用 PanResponder 做长按 + 拖动；
 *  - 用 onLayout + measureInWindow 登记每个日期格在窗口中的坐标；
 *  - 拖动时高亮命中的日期格，松手命中有效日期即调用 onReschedule。
 *
 * 所有尺寸 / 颜色均来自 useTokens()，不写死 hex 与 px。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTokens } from '../theme';
import { Text } from '../ui/kit';

import {
  DRAG_MOVE_TOLERANCE_PX,
  LONG_PRESS_DELAY_MS,
  findHitDayCell,
  type DayCellRect,
} from './calendar-drag-hit';

/** 正在被拖拽的任务（仅标识，位置由 Animated 驱动，避免每帧 setState）。 */
export interface DraggingTask {
  readonly taskId: string;
  readonly title: string | undefined;
}

/** 可拖拽任务行：把任意任务行内容包一层长按拖拽。 */
export interface DraggableTaskRowProps {
  readonly taskId: string;
  readonly title?: string | undefined;
  readonly children: React.ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export interface MobileCalendarDragOptions {
  /** 关掉后行退化为普通 View（不触发长按）。 */
  readonly enabled: boolean;
  /** 松手命中有效日期格时回调，宿主负责真正改期。 */
  readonly onReschedule: (taskId: string, targetDate: string) => void;
  /** 未进入拖拽的轻点落在某日期格时回调（可选，用于快速选日）。 */
  readonly onTapDay?: ((date: string) => void) | undefined;
}

export interface MobileCalendarDragResult {
  readonly draggingTask: DraggingTask | null;
  readonly hoveredDate: string | null;
  readonly renderDayCellWrapper: (date: string, node: React.ReactNode) => React.JSX.Element;
  readonly DraggableTaskRow: React.ComponentType<DraggableTaskRowProps>;
  readonly DragFloatingCard: React.ComponentType;
}

interface DayCellWrapperProps {
  readonly date: string;
  readonly highlighted: boolean;
  readonly onLayoutRect: (date: string, rect: DayCellRect) => void;
  readonly children: React.ReactNode;
}

/** 包一层日期格：登记窗口坐标，并在命中时叠加主色高亮框。 */
function DayCellWrapper({
  date,
  highlighted,
  onLayoutRect,
  children,
}: DayCellWrapperProps): React.JSX.Element {
  const t = useTokens();
  const viewRef = useRef<View>(null);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrapper: { position: 'relative' },
        highlight: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderWidth: t['border-width.thick'],
          borderColor: t['color.primary'],
          backgroundColor: t['color.primary-subtle'],
          borderRadius: t['radius.md'],
        },
      }),
    [t],
  );

  const handleLayout = useCallback(() => {
    viewRef.current?.measureInWindow((x, y, width, height) => {
      onLayoutRect(date, { date, x, y, width, height });
    });
  }, [date, onLayoutRect]);

  return (
    <View ref={viewRef} onLayout={handleLayout} style={styles.wrapper}>
      {children}
      {highlighted ? <View pointerEvents="none" style={styles.highlight} /> : null}
    </View>
  );
}

export function useMobileCalendarDrag({
  enabled,
  onReschedule,
  onTapDay,
}: MobileCalendarDragOptions): MobileCalendarDragResult {
  const t = useTokens();

  const [draggingTask, setDraggingTask] = useState<DraggingTask | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const rectsRef = useRef<Map<string, DayCellRect>>(new Map());
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // 始终使用最新的回调，避免把旧闭包塞进 PanResponder。
  const onRescheduleRef = useRef(onReschedule);
  onRescheduleRef.current = onReschedule;
  const onTapDayRef = useRef(onTapDay);
  onTapDayRef.current = onTapDay;

  const registerRect = useCallback((date: string, rect: DayCellRect) => {
    rectsRef.current.set(date, rect);
  }, []);

  const renderDayCellWrapper = useCallback(
    (date: string, node: React.ReactNode): React.JSX.Element => (
      <DayCellWrapper
        key={date}
        date={date}
        highlighted={hoveredDate === date}
        onLayoutRect={registerRect}
      >
        {node}
      </DayCellWrapper>
    ),
    [hoveredDate, registerRect],
  );

  // DraggableTaskRow 的组件身份保持稳定（依赖稳定），避免拖拽中重挂载。
  const DraggableTaskRow = useMemo(() => {
    function Row({
      taskId,
      title,
      children,
      style,
      testID,
    }: DraggableTaskRowProps): React.JSX.Element {
      const activatedRef = useRef(false);
      const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
      const startRef = useRef({ x: 0, y: 0 });

      const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }, []);

      useEffect(
        () => () => {
          clearTimer();
        },
        [clearTimer],
      );

      const resetDrag = useCallback(() => {
        activatedRef.current = false;
        setDraggingTask(null);
        setHoveredDate(null);
        pan.setValue({ x: 0, y: 0 });
      }, [pan]);

      const panResponder = useMemo(
        () =>
          PanResponder.create({
            onStartShouldSetPanResponder: () => enabled,
            onMoveShouldSetPanResponder: () => enabled,
            // 未进入拖拽时允许父级（如滚动容器）夺走响应者；拖拽中拒绝。
            onPanResponderTerminationRequest: () => !activatedRef.current,
            onPanResponderGrant: (event) => {
              const { pageX, pageY } = event.nativeEvent;
              startRef.current = { x: pageX, y: pageY };
              activatedRef.current = false;
              clearTimer();
              timerRef.current = setTimeout(() => {
                activatedRef.current = true;
                pan.setValue({ x: pageX, y: pageY });
                setHoveredDate(findHitDayCell(rectsRef.current, pageX, pageY));
                setDraggingTask({ taskId, title });
              }, LONG_PRESS_DELAY_MS);
            },
            onPanResponderMove: (event) => {
              const { pageX, pageY } = event.nativeEvent;
              if (!activatedRef.current) {
                const dx = pageX - startRef.current.x;
                const dy = pageY - startRef.current.y;
                if (Math.hypot(dx, dy) > DRAG_MOVE_TOLERANCE_PX) {
                  clearTimer();
                }
                return;
              }
              pan.setValue({ x: pageX, y: pageY });
              const hit = findHitDayCell(rectsRef.current, pageX, pageY);
              setHoveredDate((prev) => (prev === hit ? prev : hit));
            },
            onPanResponderRelease: (event) => {
              clearTimer();
              const { pageX, pageY } = event.nativeEvent;
              if (activatedRef.current) {
                const target = findHitDayCell(rectsRef.current, pageX, pageY);
                resetDrag();
                if (target !== null) {
                  onRescheduleRef.current(taskId, target);
                }
              } else {
                const hit = findHitDayCell(rectsRef.current, pageX, pageY);
                if (hit !== null) {
                  onTapDayRef.current?.(hit);
                }
              }
            },
            onPanResponderTerminate: () => {
              clearTimer();
              if (activatedRef.current) {
                resetDrag();
              }
              activatedRef.current = false;
            },
          }),
        [clearTimer, enabled, pan, resetDrag, taskId, title],
      );

      return (
        <View {...panResponder.panHandlers} style={style} testID={testID}>
          {children}
        </View>
      );
    }
    return Row;
  }, [enabled, pan]);

  // 跟随手指的浮动卡片；位置由 Animated 驱动，不触发重渲染。
  const DragFloatingCard = useMemo(() => {
    function Card(): React.JSX.Element | null {
      const styles = useMemo(
        () =>
          StyleSheet.create({
            card: {
              position: 'absolute',
              left: 0,
              top: 0,
              paddingHorizontal: t['space.3'],
              paddingVertical: t['space.2'],
              backgroundColor: t['color.surface'],
              borderWidth: t['border-width.thick'],
              borderColor: t['color.border'],
              borderRadius: t['radius.sm'],
            },
            title: { color: t['color.foreground'] },
          }),
        [t],
      );
      if (draggingTask === null) {
        return null;
      }
      return (
        <Animated.View
          pointerEvents="none"
          style={[styles.card, { transform: pan.getTranslateTransform() }]}
        >
          <Text variant="caption" numberOfLines={1} style={styles.title}>
            {draggingTask.title ?? ''}
          </Text>
        </Animated.View>
      );
    }
    return Card;
  }, [draggingTask, pan, t]);

  return {
    draggingTask,
    hoveredDate,
    renderDayCellWrapper,
    DraggableTaskRow,
    DragFloatingCard,
  };
}
