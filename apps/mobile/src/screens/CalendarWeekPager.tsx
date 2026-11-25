/**
 * 可无限前后翻周的周历条（虚拟化横向分页）
 * ==============================================================
 *
 * 形态与交互对齐 Apple 日历顶部那条：一周一屏，左右滑动翻周，跟手、带惯性、按页吸附。
 *
 * ## 为什么是「虚拟化原生滚动」而不是自己写三页跟手动画
 *
 * 上一版是「三页 + 自己算弹簧」：每次只翻一周，而且要等弹簧跑完才提交下一周。
 * 问题不在观感，在手势语义 —— 用户快速连拨时，新的一次拖拽会 `stopAnimation`
 * 打断上一次弹簧，而"提交这一周"挂在弹簧完成回调里 ⇒ **那一次翻周被静默丢掉**。
 * 实测：5 次快速连拨只前进了 2 周（见 `apps/mobile/tests/calendar-week-pager.spec.ts`
 * 里的判据），体感就是"怎么拨都只到下一周"。
 *
 * 正确的做法是交给**系统滚动**：手势识别、动量、吸附都是原生的，连续拨不会丢，
 * 快甩能一次滑过多周。周本身是无限的概念，所以用「索引 + 虚拟化窗口」承载：
 *   · 索引 ↔ 日期 的换算在 `@heyta/ui` 的 `week-strip-model.ts`（纯函数，有单测）；
 *   · 这里只负责把索引铺成一个横向 `FlatList`，`getItemLayout` 让任意索引 O(1) 定位，
 *     所以哪怕索引区间是 ±200 年，也只渲染屏幕上的那几页。
 *
 * ## 数据流（受控但不在每一帧回写）
 *
 * - 外部（点「今天」、切档、点某天）改 `weekStart` → 本组件 `scrollToIndex` 跟过去；
 * - 用户滑动 → 松手吸附后算出落在哪一周 → `onShiftWeeks(delta)` 交给父组件改选中；
 * - 两边都只认"索引"，不会出现"滚动位置"与"选中日期"两份事实。
 *
 * ⚠️ 父组件回调 `onShiftWeeks` 只做 `selected = addDays(selected, 7·delta)`（保留星期几），
 *   日期算术仍全部走 `@heyta/domain`，这里不新造一份。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import {
  clampWeekStripIndex,
  weekIndexAtOffset,
  weekIndexFor,
  weekStartForIndex,
  weekStripListPosition,
  WEEK_STRIP_COUNT,
  WEEK_STRIP_FIRST_INDEX,
} from '@heyta/ui';
import { type LocalDate } from '@heyta/domain';

import { useTheme } from '../theme';
import { CalendarWeekStrip, type CalendarWeekStripProps } from './CalendarWeekStrip';

export interface CalendarWeekPagerProps extends CalendarWeekStripProps {
  /**
   * 用户翻到别的周时回调：`delta` 是相对"当前这一周"的周数差（可正可负、可多周）。
   * 父组件按它移动 `selected`（保留星期几）即可，本组件不自己改选中态。
   */
  readonly onShiftWeeks: (delta: number) => void;
  /** 每一页的周数文案（宿主格式化，如「47周」）。 */
  readonly weekLabelFor?: (weekStart: LocalDate) => string;
}

export function CalendarWeekPager({
  weekStart,
  selected,
  today,
  weekdays,
  onSelect,
  onShiftWeeks,
  hasContent,
  weekLabelFor,
}: CalendarWeekPagerProps): React.JSX.Element {
  const { reducedMotion } = useTheme();
  const [pageWidth, setPageWidth] = useState(0);
  /** 首帧量到的一页高度：横向列表需要一个确定高度，否则换掉占位后可能塌成 0。 */
  const [pageHeight, setPageHeight] = useState(0);
  const listRef = useRef<FlatList<number> | null>(null);
  /** 当前"已生效"的周索引；null = 还没布局、未初始化。 */
  const currentIndexRef = useRef<number | null>(null);

  /** 列表条目：一段固定整数索引。宽度与日期跨度无关，只跟"渲染窗口"有关。 */
  const data = useMemo(
    () => Array.from({ length: WEEK_STRIP_COUNT }, (_, i) => WEEK_STRIP_FIRST_INDEX + i),
    [],
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<number> | null | undefined, index: number) => ({
      length: pageWidth,
      offset: pageWidth * index,
      index,
    }),
    [pageWidth],
  );

  const renderItem = useCallback(
    ({ item }: { item: number }) => (
      <View style={{ width: pageWidth }}>
        <CalendarWeekStrip
          weekStart={weekStartForIndex(item)}
          selected={selected}
          today={today}
          weekdays={weekdays}
          onSelect={onSelect}
          hasContent={hasContent}
          {...(weekLabelFor === undefined ? {} : { weekLabel: weekLabelFor(weekStartForIndex(item)) })}
        />
      </View>
    ),
    [pageWidth, selected, today, weekdays, onSelect, hasContent, weekLabelFor],
  );

  /**
   * 外部改周（点「今天」/ 切档 / 点某天落在别的周）→ 滚过去。
   *
   * 只在"目标索引 ≠ 当前索引"时滚：用户自己滑动触发的 `onShiftWeeks` 会让父组件
   * 回写 `weekStart`，那次回写的索引已经等于 `currentIndexRef`，因此这里不会二次滚动，
   * 也就不会和正在进行的惯性打架。
   */
  useEffect(() => {
    if (pageWidth === 0) return;
    const target = clampWeekStripIndex(weekIndexFor(weekStart));
    if (currentIndexRef.current === null) {
      currentIndexRef.current = target;
      return;
    }
    if (target === currentIndexRef.current) return;
    currentIndexRef.current = target;
    listRef.current?.scrollToIndex({
      index: weekStripListPosition(target),
      animated: !reducedMotion,
    });
  }, [weekStart, pageWidth, reducedMotion]);

  /** 松手吸附完成后，把"落在哪一周"交回父组件。 */
  const handleSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth === 0) return;
      const landed = weekIndexAtOffset(event.nativeEvent.contentOffset.x, pageWidth);
      const previous = currentIndexRef.current;
      if (previous === null) {
        currentIndexRef.current = landed;
        return;
      }
      if (landed === previous) return;
      currentIndexRef.current = landed;
      onShiftWeeks(landed - previous);
    },
    [pageWidth, onShiftWeeks],
  );

  const initialListIndex = weekStripListPosition(
    clampWeekStripIndex(weekIndexFor(weekStart)),
  );

  return (
    <View
      style={{ overflow: 'hidden' }}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && width !== pageWidth) setPageWidth(width);
        if (height > 0 && height !== pageHeight) setPageHeight(height);
      }}
      testID="calendar-week-pager"
    >
      {pageWidth === 0 ? (
        // 首帧还没量到宽度：先画一页占位，量到后再挂列表（列表需要页宽才能定位）。
        <CalendarWeekStrip
          weekStart={weekStart}
          selected={selected}
          today={today}
          weekdays={weekdays}
          onSelect={onSelect}
          hasContent={hasContent}
          {...(weekLabelFor === undefined ? {} : { weekLabel: weekLabelFor(weekStart) })}
        />
      ) : (
        <FlatList
          ref={listRef}
          style={{ width: pageWidth, height: pageHeight > 0 ? pageHeight : undefined }}
          data={data}
          horizontal
          keyExtractor={(item) => String(item)}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          initialScrollIndex={initialListIndex}
          snapToInterval={pageWidth}
          snapToAlignment="start"
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleSettled}
          /* 只保留屏幕附近的页；固定页宽 + getItemLayout 下这是纯收益。 */
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={3}
          testID="calendar-week-list"
        />
      )}
    </View>
  );
}
