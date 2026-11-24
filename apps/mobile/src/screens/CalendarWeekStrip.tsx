/**
 * 周历条（日历条）—— 对齐 Apple 日历顶部那条横向日期条
 * ======================================================
 *
 * 形态：一行 7 列，每列「星期几（小字）+ 大日期数字」，今天用主色实心圆高亮，
 * 选中（非今天）用淡主色底。点某天切到那天。
 *
 * 出处：产品负责人对照 Apple 日历（iOS）时明确要这条「日历条」——
 * 它把顶部原来会空的那块变成「导航 + 信息」，且下方内容因此不再头重脚轻。
 *
 * 🔴 只负责「画 + 上报哪天被点」，不改游标/选中/视图 —— 这些语义仍由
 *   `CalendarScreen` 的 `pickDay` 决定（共享板《不是三份 JSX》同一条纪律）。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { addDays, lunarDayLabel, type LocalDate } from '@heyta/domain';

import { Text } from '../ui/kit';
import { useTokens } from '../theme';

export interface CalendarWeekStripProps {
  /** 这一周的周一。 */
  readonly weekStart: LocalDate;
  readonly selected: LocalDate;
  readonly today: LocalDate;
  /** 周一到周日 7 个「星期几」文案（与网格同序，见 `WEEKDAY_MESSAGE_KEYS`）。 */
  readonly weekdays: readonly [string, string, string, string, string, string, string];
  readonly onSelect: (date: LocalDate) => void;
  /** 这一天有没有内容（有则画一个小圆点，对齐滴答周条）。 */
  readonly hasContent?: (date: LocalDate) => boolean;
  /** 这一周是第几周（如「47周」）—— 宿主格式化好再传，组件不碰 i18n。 */
  readonly weekLabel?: string;
}

/** `YYYY-MM-DD` 取「几号」。 */
function dayNumber(date: LocalDate): number {
  return Number(date.slice(8, 10));
}

/** 中文「周一」→「一」；其它语言保持原样（英文已是 Mon 这类短名）。 */
function shortWeekday(label: string): string {
  return label.startsWith('周') && label.length > 1 ? label.slice(1) : label;
}

/**
 * 用 `memo` 包一层：周条现在是虚拟化横向列表里的一页，翻周时会同时存在好几页，
 * 而拖拽/动画只改列表的滚动偏移、不改这些 prop —— 没有 memo 的话每一帧
 * 都会把不动的几页一起重渲染，长列表下就是肉眼可见的掉帧。
 * prop 全是原始值 + 稳定回调，浅比较即可命中。
 */
export const CalendarWeekStrip = React.memo(function CalendarWeekStrip({
  weekStart,
  selected,
  today,
  weekdays,
  onSelect,
  hasContent,
  weekLabel,
}: CalendarWeekStripProps): React.JSX.Element {
  const t = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          paddingVertical: t['space.2'],
        },
        cell: {
          flex: 1,
          alignItems: 'center',
          gap: t['space.1'],
          paddingVertical: t['space.1'],
        },
        numWrap: {
          minWidth: t['space.8'],
          height: t['space.8'],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: t['radius.full'],
        },
        today: { backgroundColor: t['color.primary'] },
        selected: { backgroundColor: t['color.primary-subtle'] },
        weekNum: {
          width: t['space.8'],
          flexShrink: 0,
          alignItems: 'center',
          paddingTop: t['space.1'],
        },
        dot: {
          width: t['space.1'],
          height: t['space.1'],
          borderRadius: t['radius.full'],
          backgroundColor: t['color.primary'],
        },
      }),
    [t],
  );

  return (
    <View style={styles.row}>
      {weekLabel === undefined ? null : (
        <View style={styles.weekNum}>
          <Text variant="caption" tone="subtle" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {weekLabel}
          </Text>
        </View>
      )}
      {weekdays.map((label, index) => {
        const date = addDays(weekStart, index);
        const isToday = date === today;
        const isSelected = date === selected;
        const isWeekend = index >= 5;
        return (
          <Pressable
            key={date}
            onPress={() => {
              onSelect(date);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
            testID={`cal-strip-${date}`}
            style={styles.cell}
          >
            <Text variant="caption" tone="subtle" style={isWeekend ? { color: t['color.weekend'] } : undefined}>
              {shortWeekday(label)}
            </Text>
            <View
              style={[styles.numWrap, isToday ? styles.today : isSelected ? styles.selected : null]}
            >
              <Text
                variant="numeric-summary"
                {...(isToday ? { tone: 'on-primary' as const } : { style: { color: isWeekend ? t['color.weekend'] : t['color.foreground'] } })}
              >
                {String(dayNumber(date))}
              </Text>
            </View>
            {hasContent?.(date) === true && !isToday ? <View style={styles.dot} /> : null}
            <Text variant="caption" tone="subtle">
              {lunarDayLabel(date)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});
