/**
 * 日历里的一条「习惯」条目（移动端）
 * ===================================
 *
 * 对照滴答清单日历「日/周/列表」：没有时刻的习惯不是一行"图标+文字"，而是一条
 * **整宽的浅色圆角横带**——像一条带子横亘在「全天」区里；有时间点的则落在时间轴对应
 * 时刻，同样是一条横带（前面带小钟）。整条可点：点一下打卡，再点取消。
 *
 * 本组件只负责"画一条 + 上报点了哪条"，不判断"哪天该做"（`@heyta/domain#isScheduledOn`），
 * 也不认识 i18n（时间点是纯数字）。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { habitIconOf, type Habit } from '@heyta/domain';

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
        /* 整条横带：浅色底 + 圆角，像滴答的全天条。完成态底色更淡、文字变灰并加删除线。 */
        band: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t['space.1'],
          minHeight: t['space.10'],
          paddingVertical: t['space.1'],
          paddingHorizontal: t['space.2'],
          borderRadius: t['radius.sm'],
          backgroundColor: t['color.primary-subtle'],
        },
        bandDone: { backgroundColor: t['color.surface'] },
        text: { flex: 1, color: t['color.primary'] },
        textDone: { color: t['color.foreground-muted'], textDecorationLine: 'line-through' },
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
      style={[styles.band, done ? styles.bandDone : null]}
    >
      {habit.time !== undefined ? (
        <Icon name="task.reminder" size="sm" color={t['color.primary']} />
      ) : null}
      <Text
        variant="row-title"
        numberOfLines={1}
        style={[styles.text, done ? styles.textDone : null]}
      >
        {habit.name}
      </Text>
    </Pressable>
  );
}
