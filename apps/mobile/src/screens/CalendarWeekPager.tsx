/**
 * 可跟手拖拽的三页周历条。
 *
 * 前后一周始终参与渲染，拖动不是等松手后改日期；松手时按动量预测落点，
 * 再把速度交给设计系统弹簧。动画可被下一次拖拽从当前位置打断。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import {
  adjacentPageForRelease,
  rubberBandOffset,
  springFor,
  springTokensOf,
} from '@heyta/ui';
import { addDays, type LocalDate } from '@heyta/domain';

import { useTheme, useTokens } from '../theme';
import { CalendarWeekStrip, type CalendarWeekStripProps } from './CalendarWeekStrip';

export interface CalendarWeekPagerProps extends CalendarWeekStripProps {
  readonly onShiftWeek: (direction: 1 | -1) => void;
}

export function CalendarWeekPager({
  weekStart,
  selected,
  today,
  weekdays,
  onSelect,
  onShiftWeek,
}: CalendarWeekPagerProps): React.JSX.Element {
  const tokens = useTokens();
  const { reducedMotion } = useTheme();
  const [pageWidth, setPageWidth] = useState(0);
  const dragX = useRef(new Animated.Value(0)).current;
  const startOffset = useRef(0);
  const gestureOrigin = useRef(0);
  const pendingReset = useRef(false);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          pageWidth > 0 &&
          Math.abs(gesture.dx) > tokens['gesture.hysteresis'] &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderGrant: (_event, gesture) => {
          gestureOrigin.current = gesture.dx;
          dragX.stopAnimation((value) => {
            startOffset.current = value;
          });
        },
        onPanResponderMove: (_event, gesture) => {
          const raw = startOffset.current + (gesture.dx - gestureOrigin.current);
          if (raw > pageWidth) {
            dragX.setValue(pageWidth + rubberBandOffset(raw - pageWidth, pageWidth));
          } else if (raw < -pageWidth) {
            dragX.setValue(-pageWidth - rubberBandOffset(-raw - pageWidth, pageWidth));
          } else {
            dragX.setValue(raw);
          }
        },
        onPanResponderRelease: (_event, gesture) => {
          const direction = adjacentPageForRelease(
            startOffset.current + (gesture.dx - gestureOrigin.current),
            gesture.vx,
            pageWidth,
            tokens['motion.deceleration-rate'],
          );
          const target = -direction * pageWidth;
          const finish = (): void => {
            if (direction === 0) {
              dragX.setValue(0);
              return;
            }
            // 先让父组件换周，等新周提交后再归零，避免旧当前周闪回一帧。
            pendingReset.current = true;
            onShiftWeek(direction);
          };
          if (reducedMotion) {
            if (direction !== 0) {
              pendingReset.current = true;
              onShiftWeek(direction);
            } else {
              dragX.setValue(0);
            }
            return;
          }
          Animated.spring(dragX, {
            toValue: target,
            velocity: gesture.vx * 1000,
            useNativeDriver: true,
            ...springFor('move', springTokensOf(tokens), { momentum: gesture.vx !== 0 }),
          }).start(({ finished }) => {
            if (finished) finish();
          });
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragX, {
            toValue: 0,
            useNativeDriver: true,
            ...springFor('move', springTokensOf(tokens)),
          }).start();
        },
      }),
    [dragX, onShiftWeek, pageWidth, reducedMotion, tokens],
  );

  useEffect(() => {
    if (!pendingReset.current) return;
    pendingReset.current = false;
    dragX.setValue(0);
  }, [weekStart, dragX]);

  const page = (start: LocalDate, hidden: boolean): React.JSX.Element => (
    <View
      key={start}
      style={{ width: pageWidth }}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <CalendarWeekStrip
        weekStart={start}
        selected={selected}
        today={today}
        weekdays={weekdays}
        onSelect={onSelect}
      />
    </View>
  );

  return (
    <View
      {...pan.panHandlers}
      style={{ overflow: 'hidden' }}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        if (width > 0 && width !== pageWidth) setPageWidth(width);
      }}
      testID="calendar-week-pager"
    >
      {pageWidth === 0 ? (
        <CalendarWeekStrip
          weekStart={weekStart}
          selected={selected}
          today={today}
          weekdays={weekdays}
          onSelect={onSelect}
        />
      ) : (
        <Animated.View
          style={{
            flexDirection: 'row',
            width: pageWidth * 3,
            transform: [{ translateX: Animated.subtract(dragX, pageWidth) }],
          }}
        >
          {page(addDays(weekStart, -7), true)}
          {page(weekStart, false)}
          {page(addDays(weekStart, 7), true)}
        </Animated.View>
      )}
    </View>
  );
}
