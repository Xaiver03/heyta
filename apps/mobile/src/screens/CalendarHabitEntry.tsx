/**
 * 日历里的一条「习惯」条目（移动端）
 * ===================================
 *
 * 对照滴答清单：习惯不是一张独立卡片，而是日历里的**一条**——有定时点的排在
 * 时间轴对应时刻、没有的落在「全天」带，左侧（有时间时）显示 `HH:mm`，
 * 都带习惯图标、可直接勾选。
 *
 * 本组件只负责"画一条 + 上报点了哪条"，不判断"哪天该做"（那是 `@heyta/domain#isScheduledOn`），
 * 也不认识 i18n（时间点是纯数字）。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { habitIconOf, type Habit } from '@heyta/domain';
import { HabitArtwork } from '@heyta/ui';

import { Icon } from '../ui/icons';
import { Text } from '../ui/kit';
import { useTokens } from '../theme';

export interface CalendarHabitEntryProps {
  readonly habit: Habit;
  /** 这条当天已打卡。 */
  readonly done: boolean;
  /** 正在提交打卡/取消。 */
  readonly busy?: boolean;
  readonly onToggle: (habitId: string) => void;
  readonly testID?: string;
}

export function CalendarHabitEntry({
  habit,
  done,
  busy = false,
  onToggle,
  testID = 'calendar-habit-entry',
}: CalendarHabitEntryProps): React.JSX.Element {
  const t = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t['space.2'],
          minHeight: t['touch-target.min'],
          paddingVertical: t['space.1'],
        },
        time: { minWidth: t['space.12'], color: t['color.foreground-muted'] },
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
        checkDone: { backgroundColor: t['color.primary'], borderColor: t['color.primary'] },
        doneText: { color: t['color.foreground-muted'] },
      }),
    [t],
  );

  return (
    <Pressable
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
      {habit.time !== undefined ? (
        <Text variant="row-meta" style={styles.time}>
          {habit.time}
        </Text>
      ) : null}
      <HabitArtwork icon={habitIconOf(habit)} size={t['space.8']} />
      <Text variant="row-title" style={[styles.name, done ? styles.doneText : null]}>
        {habit.name}
      </Text>
      <View style={[styles.check, done ? styles.checkDone : null]}>
        {done ? <Icon name="action.keep" size="sm" color={t['color.on-primary']} /> : null}
      </View>
    </Pressable>
  );
}
