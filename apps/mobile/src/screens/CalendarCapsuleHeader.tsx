/**
 * 日历顶部胶囊导航（Apple 日历形态）
 * ==================================
 *
 * 左：胶囊「‹ 月份」；右：一组胶囊（视图切换 + ⋯）。
 * 出处：产品负责人对照 Apple 日历（iOS）要求"顶部胶囊导航完全一样"。
 *
 * 语义只上报点击（月 / 视图 / 更多），具体打开什么菜单由 `CalendarScreen` 决定——
 * 与 `CalendarWeekStrip` 同一条：这一层不做游标/视图判断。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTokens } from '../theme';
import { Icon } from '../ui/icons';
import { Text } from '../ui/kit';

export interface CalendarCapsuleHeaderProps {
  readonly monthLabel: string;
  readonly onMonthPress: () => void;
  readonly onViewPress: () => void;
  readonly onMorePress: () => void;
  readonly monthA11y: string;
  readonly viewA11y: string;
  readonly moreA11y: string;
  /** Apple 左下「今天」胶囊：回今天。 */
  readonly onToday?: (() => void) | undefined;
  readonly todayLabel?: string | undefined;
}

export function CalendarCapsuleHeader({
  monthLabel,
  onMonthPress,
  onViewPress,
  onMorePress,
  monthA11y,
  viewA11y,
  moreA11y,
  onToday,
  todayLabel,
}: CalendarCapsuleHeaderProps): React.JSX.Element {
  const t = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: t['screen.gutter'],
          paddingVertical: t['space.2'],
          gap: t['space.2'],
        },
        pill: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t['space.1'],
          minHeight: t['touch-target.min'],
          paddingHorizontal: t['space.3'],
          borderRadius: t['radius.full'],
          borderWidth: t['border-width.thin'],
          borderColor: t['color.border'],
          backgroundColor: t['color.surface'],
        },
        iconButton: {
          minHeight: t['touch-target.min'],
          minWidth: t['touch-target.min'],
          alignItems: 'center',
          justifyContent: 'center',
        },
        rightGroup: { flexDirection: 'row', alignItems: 'center', gap: t['space.2'] },
      }),
    [t],
  );

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onMonthPress}
        accessibilityRole="button"
        accessibilityLabel={monthA11y}
        testID="calendar-month-pill"
        style={styles.pill}
      >
        <Icon name="action.back" size="sm" color={t['color.foreground']} />
        <Text variant="headline">{monthLabel}</Text>
      </Pressable>

      <View style={styles.rightGroup}>
        {onToday === undefined ? null : (
          <Pressable
            onPress={onToday}
            accessibilityRole="button"
            accessibilityLabel={todayLabel}
            testID="calendar-today-pill"
            style={styles.pill}
          >
            <Text variant="headline">{todayLabel}</Text>
          </Pressable>
        )}
        <View style={styles.pill}>
          <Pressable
            onPress={onViewPress}
            accessibilityRole="button"
            accessibilityLabel={viewA11y}
            testID="calendar-view-pill"
            style={styles.iconButton}
          >
            <Icon name="calendar.month" size="sm" color={t['color.foreground']} />
          </Pressable>
          <Pressable
            onPress={onMorePress}
            accessibilityRole="button"
            accessibilityLabel={moreA11y}
            testID="calendar-more-pill"
            style={styles.iconButton}
          >
            <Icon name="action.more" size="sm" color={t['color.foreground']} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
