/**
 * 周议程（一周档，Apple「列表」形态）
 * ==================================
 *
 * 7 段竖向：每段「星期几 + 几号」（今天高亮）作小标题，下面是这一天的任务列表。
 * 出处：产品负责人对照 Apple 日历要「一周」档；共享 `CalendarBoard` 的 week 档
 * 没有 N 列 × 小时轴（空时几乎空白），而 Apple 本身也提供「列表」档 —— 这里用
 * 「一周的列表」兑现「一周」，干净、可读，且不动共享板（只 phone 端用）。
 *
 * 只做「画 + 上报选日/勾选」，日期分桶用领域 `dueLocalDateOf`，任务行复用共享 `TaskList`。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  dueLocalDateOf,
  isScheduledOn,
  type Habit,
  type HabitLog,
  type LocalDate,
  type Task,
} from '@heyta/domain';
import { TaskList, type TaskListLabels } from '@heyta/ui';

import { CalendarHabitEntry } from './CalendarHabitEntry';

import { Text } from '../ui/kit';
import { useTokens } from '../theme';

export interface CalendarWeekAgendaProps {
  /** 要逐段列出的日期（周档 = 7 天；3 日档 = 3 天）。 */
  readonly days: readonly LocalDate[];
  /** 某一天对应的「星期几」短名（宿主按 i18n 提供）。 */
  readonly weekdayLabelOf: (date: LocalDate) => string;
  readonly today: LocalDate;
  readonly selected: LocalDate;
  readonly tasks: readonly Task[];
  readonly taskRow: TaskListLabels;
  readonly onSelectDay: (date: LocalDate) => void;
  readonly onToggleTask: (taskId: string) => void;
  readonly busyTaskId?: string | null;
  readonly habits?: readonly Habit[];
  readonly habitLogs?: readonly HabitLog[];
  readonly onToggleHabit?: (habitId: string) => void;
  readonly busyHabitId?: string | null;
}

function dayNumber(date: LocalDate): number {
  return Number(date.slice(8, 10));
}

function shortWeekday(label: string): string {
  return label.startsWith('周') && label.length > 1 ? label.slice(1) : label;
}

export function CalendarWeekAgenda({
  days,
  weekdayLabelOf,
  today,
  selected,
  tasks,
  taskRow,
  onSelectDay,
  onToggleTask,
  busyTaskId,
  habits,
  habitLogs,
  onToggleHabit,
  busyHabitId,
}: CalendarWeekAgendaProps): React.JSX.Element {
  const t = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        section: {
          gap: t['space.1'],
          paddingVertical: t['space.2'],
          borderTopWidth: t['border-width.thin'],
          borderColor: t['color.border-subtle'],
        },
        headerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t['space.2'],
          minHeight: t['touch-target.min'],
        },
        num: {
          minWidth: t['space.8'],
          height: t['space.8'],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: t['radius.full'],
        },
        today: { backgroundColor: t['color.primary'] },
        selected: { backgroundColor: t['color.primary-subtle'] },
        habitGroup: { gap: t['space.1'], paddingTop: t['space.1'] },
        habitRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t['space.2'],
          minHeight: t['touch-target.min'],
        },
        habitName: { flex: 1 },
        habitDone: { flex: 1, color: t['color.foreground-muted'] },
      }),
    [t],
  );

  return (
    <View>
      {days.map((date) => {
        const label = weekdayLabelOf(date);
        const isToday = date === today;
        const isSelected = date === selected;
        const dayTasks = tasks.filter((task) => dueLocalDateOf(task) === date);
        return (
          <View key={date} style={styles.section}>
            <Pressable
              onPress={() => {
                onSelectDay(date);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={label}
              testID={`week-agenda-${date}`}
              style={styles.headerRow}
            >
              <Text variant="caption" tone="subtle">
                {shortWeekday(label)}
              </Text>
              <View
                style={[styles.num, isToday ? styles.today : isSelected ? styles.selected : null]}
              >
                <Text
                  variant="numeric-body"
                  {...(isToday ? { tone: 'on-primary' as const } : {})}
                >
                  {String(dayNumber(date))}
                </Text>
              </View>
            </Pressable>
            {dayTasks.length === 0 ? null : (
              <TaskList
                tasks={dayTasks}
                density="minimal"
                onToggleTask={onToggleTask}
                busyTaskId={busyTaskId ?? null}
                labels={taskRow}
                testID={`week-agenda-list-${date}`}
              />
            )}
            {(habits ?? []).filter((h) => isScheduledOn(h.frequency, date)).length === 0 ? null : (
              <View style={styles.habitGroup}>
                {(habits ?? [])
                  .filter((h) => isScheduledOn(h.frequency, date))
                  .map((h) => {
                    const done = (habitLogs ?? []).some(
                      (l) => l.habitId === h.id && l.date === date && l.deletedAt === undefined,
                    );
                    return (
                      <CalendarHabitEntry
                        key={h.id}
                        habit={h}
                        done={done}
                        busy={busyHabitId === h.id}
                        onToggle={(id) => onToggleHabit?.(id)}
                        testID={`week-agenda-habit-${date}`}
                      />
                    );
                  })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
