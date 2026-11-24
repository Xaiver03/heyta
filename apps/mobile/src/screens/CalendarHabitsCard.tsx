/**
 * 日历里的「习惯」卡片（移动端）
 * =================================
 *
 * 对照滴答清单日历「列表」形态：待办事项一张卡，**习惯单独一张卡**；
 * 当天没有要做的习惯时，**整张卡不出现**（不是空卡、不是占位）。
 *
 * 只做「画 + 上报点了哪条」，不判断"哪天该做"——那一层是 `@heyta/domain#isScheduledOn`，
 * 由宿主导入（见 `CalendarScreen`）。本组件也不认识 i18n：标题由宿主 `title` 传入。
 *
 * 打卡语义：宿主 `onToggle(habitId)` 自己决定是 `checkIn` 还是 `undoCheckIn`
 * （它手上有 logs），这里只负责把"已完成/未完成"画出来。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { habitIconOf, type Habit, type HabitLog, type LocalDate } from '@heyta/domain';
import { HabitArtwork } from '@heyta/ui';

import { Icon } from '../ui/icons';
import { Text } from '../ui/kit';
import { useTokens } from '../theme';

export interface CalendarHabitsCardProps {
  /** 已经按"这一天该做"过滤好的习惯。空数组 ⇒ 整卡不渲染。 */
  readonly habits: readonly Habit[];
  readonly logs: readonly HabitLog[];
  readonly date: LocalDate;
  /** 卡片标题（宿主注入，通常就是「习惯」）。 */
  readonly title: string;
  readonly onToggle: (habitId: string) => void;
  readonly busyHabitId?: string | null;
  readonly testID?: string;
}

function isDone(logs: readonly HabitLog[], habitId: string, date: LocalDate): boolean {
  return logs.some((log) => log.habitId === habitId && log.date === date && log.deletedAt === undefined);
}

export function CalendarHabitsCard({
  habits,
  logs,
  date,
  title,
  onToggle,
  busyHabitId = null,
  testID = 'calendar-habits-card',
}: CalendarHabitsCardProps): React.JSX.Element | null {
  const t = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: t['color.surface'],
          borderRadius: t['radius.md'],
          borderWidth: t['border-width.thin'],
          borderColor: t['color.border'],
          paddingVertical: t['space.2'],
          paddingHorizontal: t['space.3'],
          gap: t['space.1'],
        },
        header: { paddingVertical: t['space.1'] },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t['space.3'],
          minHeight: t['touch-target.min'],
          paddingVertical: t['space.1'],
        },
        name: { flex: 1 },
        check: {
          width: t['space.6'],
          height: t['space.6'],
          borderRadius: t['radius.full'],
          borderWidth: t['border-width.thin'],
          borderColor: t['color.border'],
          alignItems: 'center',
          justifyContent: 'center',
        },
        checkDone: {
          backgroundColor: t['color.primary'],
          borderColor: t['color.primary'],
        },
        doneText: { color: t['color.foreground-muted'] },
      }),
    [t],
  );

  // 空则不渲染整张卡（滴答同款；也是用户明确要的"习惯为空不显示卡片"）。
  if (habits.length === 0) return null;

  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.header}>
        <Text variant="headline">{title}</Text>
      </View>
      {habits.map((habit) => {
        const done = isDone(logs, habit.id, date);
        const busy = busyHabitId === habit.id;
        return (
          <Pressable
            key={habit.id}
            onPress={() => {
              if (!busy) onToggle(habit.id);
            }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ checked: done, disabled: busy }}
            accessibilityLabel={habit.name}
            testID={`${testID}-${habit.id}`}
            style={styles.row}
          >
            <HabitArtwork icon={habitIconOf(habit)} size={t['space.8']} />
            <Text variant="row-title" style={[styles.name, done ? styles.doneText : null]}>
              {habit.name}
            </Text>
            <View style={[styles.check, done ? styles.checkDone : null]}>
              {done ? <Icon name="action.keep" size="sm" color={t['color.on-primary']} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
