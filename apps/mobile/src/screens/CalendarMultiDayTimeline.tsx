/**
 * 多日时间轴（移动端）—— 目前用于「3日」档
 * ==========================================
 *
 * 对照滴答清单「3日」：顶部 3 天表头 + 「全天」带 + **共享一条小时轴 × 3 列**，
 * 有时间的任务/习惯按小时落在对应列的轴上，无时刻的落"全天"带。条目可点打卡。
 *
 * 🔴 "有没有时刻"不在这里另判：直接复用共享 `@heyta/ui#calendarDayBuckets`
 *    （它内部用 `isAllDayMs`）—— 与日档同一个口径，绝不出现"同一条任务在日档是全天、
 *    在3日档却跑到轴上"的分叉。习惯的时刻读 `habit.time`。
 *
 * 本组件只做"画 + 上报点按"，日期/频次判定走领域层，i18n 由宿主注入。
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { isScheduledOn, type Habit, type HabitLog, type LocalDate, type Task } from '@heyta/domain';
import { calendarDayBuckets } from '@heyta/ui';

import { Text } from '../ui/kit';
import { useTokens } from '../theme';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export interface CalendarMultiDayTimelineProps {
  /** 要并列的若干天（3日档 = 3 天）。 */
  readonly days: readonly LocalDate[];
  readonly today: LocalDate;
  readonly selected: LocalDate;
  readonly weekdayLabelOf: (date: LocalDate) => string;
  readonly tasks: readonly Task[];
  readonly onToggleTask: (taskId: string) => void;
  readonly busyTaskId?: string | null;
  readonly onSelectDay: (date: LocalDate) => void;
  /** 「全天」那三个字的文案（宿主注入，通常就是 labels.dayAllDay）。 */
  readonly allDayLabel?: string;
  readonly habits?: readonly Habit[];
  readonly habitLogs?: readonly HabitLog[];
  readonly onToggleHabit?: (habitId: string) => void;
  readonly busyHabitId?: string | null;
  /** 当前时刻（epoch ms）：落在这些天内时画「现在」红线；不给则不画。 */
  readonly now?: number | undefined;
  readonly testID?: string;
}

function dayNumber(date: LocalDate): number {
  return Number(date.slice(8, 10));
}
function shortWeekday(label: string): string {
  return label.startsWith('周') && label.length > 1 ? label.slice(1) : label;
}
function habitHour(habit: Habit): number | null {
  const t = habit.time;
  if (t === undefined) return null;
  const h = Number(t.slice(0, 2));
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : null;
}
function isHabitDone(logs: readonly HabitLog[], habitId: string, date: LocalDate): boolean {
  return logs.some((l) => l.habitId === habitId && l.date === date && l.deletedAt === undefined);
}

export function CalendarMultiDayTimeline({
  days,
  today,
  selected,
  weekdayLabelOf,
  tasks,
  onToggleTask,
  busyTaskId,
  onSelectDay,
  allDayLabel,
  habits,
  habitLogs,
  onToggleHabit,
  busyHabitId,
  now,
  testID = 'calendar-3day-timeline',
}: CalendarMultiDayTimelineProps): React.JSX.Element {
  const t = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        headerRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: t['space.1'] },
        hourColW: { width: t['space.10'] },
        dayHead: { flex: 1, alignItems: 'center', gap: t['space.1'], paddingVertical: t['space.1'] },
        dayNum: {
          minWidth: t['space.8'],
          height: t['space.8'],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: t['radius.full'],
        },
        todayBg: { backgroundColor: t['color.primary'] },
        selectedBg: { backgroundColor: t['color.primary-subtle'] },
        band: { flexDirection: 'row', alignItems: 'flex-start', paddingBottom: t['space.1'] },
        bandLabel: { width: t['space.10'], paddingTop: t['space.1'] },
        bandCell: { flex: 1, gap: t['space.1'], paddingHorizontal: t['space.1'] },
        axis: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
        axisInner: { flexDirection: 'row', position: 'relative' },
        hourCell: { width: t['space.10'], justifyContent: 'flex-start', paddingTop: t['space.1'] },
        col: { flex: 1, borderLeftWidth: t['border-width.thin'], borderColor: t['color.border-subtle'] },
        hourLine: { position: 'absolute', left: 0, right: 0, height: t['border-width.thin'], backgroundColor: t['color.border-subtle'] },
        block: {
          position: 'absolute',
          left: t['space.1'],
          right: t['space.1'],
          borderRadius: t['radius.sm'],
          backgroundColor: t['color.primary-subtle'],
          paddingHorizontal: t['space.1'],
          paddingVertical: t['space.1'],
        },
        blockDone: { backgroundColor: t['color.surface'], opacity: 0.7 },
        blockText: { color: t['color.primary'] },
        blockDoneText: { color: t['color.foreground-muted'], textDecorationLine: 'line-through' },
        nowLine: { position: 'absolute', left: t['space.10'], right: 0, height: t['border-width.thin'] },
        chip: {
          borderRadius: t['radius.sm'],
          backgroundColor: t['color.primary-subtle'],
          paddingHorizontal: t['space.1'],
          paddingVertical: t['space.1'],
        },
      }),
    [t],
  );

  const rowHeight = t['size.row-min-height'];
  const axisHeight = rowHeight * 24;
  const nowOffset = (() => {
    if (now === undefined) return undefined;
    const d = new Date(now);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!days.includes(key as LocalDate)) return undefined;
    return (d.getHours() + d.getMinutes() / 60) * rowHeight;
  })();

  const perDay = useMemo(
    () =>
      days.map((day) => {
        const buckets = calendarDayBuckets(tasks, day);
        const scheduled = (habits ?? []).filter((h) => isScheduledOn(h.frequency, day));
        const timedHabits = scheduled
          .map((h) => ({ habit: h, hour: habitHour(h) }))
          .filter((x): x is { habit: Habit; hour: number } => x.hour !== null);
        const allDayHabits = scheduled.filter((h) => habitHour(h) === null);
        return { day, buckets, timedHabits, allDayHabits };
      }),
    [days, tasks, habits],
  );

  const hasAllDay = perDay.some((d) => d.buckets.allDay.length > 0 || d.allDayHabits.length > 0);

  return (
    <View testID={testID}>
      {/* 表头：小时轴占位 + 3 天 */}
      <View style={styles.headerRow}>
        <View style={styles.hourColW} />
        {days.map((day) => {
          const isToday = day === today;
          const isSelected = day === selected;
          return (
            <Pressable
              key={day}
              style={styles.dayHead}
              onPress={() => {
                onSelectDay(day);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              testID={`${testID}-head-${day}`}
            >
              <Text variant="caption" tone="subtle">
                {shortWeekday(weekdayLabelOf(day))}
              </Text>
              <View style={[styles.dayNum, isToday ? styles.todayBg : isSelected ? styles.selectedBg : null]}>
                <Text variant="numeric-body" {...(isToday ? { tone: 'on-primary' as const } : {})}>
                  {String(dayNumber(day))}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* 全天带 */}
      {hasAllDay ? (
        <View style={styles.band} testID={`${testID}-all-day`}>
          <View style={styles.bandLabel}>
            {allDayLabel === undefined ? null : (
              <Text variant="caption" tone="subtle">
                {allDayLabel}
              </Text>
            )}
          </View>
          {perDay.map(({ day, buckets, allDayHabits }) => (
            <View key={`ad-${day}`} style={styles.bandCell}>
              {buckets.allDay.map((task) => {
                const done = task.completedAt !== undefined;
                return (
                  <Pressable
                    key={`t-${task.id}`}
                    onPress={() => {
                      if (busyTaskId !== task.id) onToggleTask(task.id);
                    }}
                    style={[styles.chip, done ? styles.blockDone : null]}
                    testID={`${testID}-allday-task-${task.id}`}
                  >
                    <Text variant="caption" numberOfLines={1} style={[styles.blockText, done ? styles.blockDoneText : null]}>
                      {task.title}
                    </Text>
                  </Pressable>
                );
              })}
              {allDayHabits.map((habit) => {
                const done = isHabitDone(habitLogs ?? [], habit.id, day);
                return (
                  <Pressable
                    key={`h-${habit.id}`}
                    onPress={() => {
                      if (busyHabitId !== habit.id) onToggleHabit?.(habit.id);
                    }}
                    style={[styles.chip, done ? styles.blockDone : null]}
                    testID={`${testID}-allday-habit-${habit.id}`}
                  >
                    <Text variant="caption" numberOfLines={1} style={[styles.blockText, done ? styles.blockDoneText : null]}>
                      {habit.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}

      {/* 小时轴 × N 列（共享一条竖向滚动） */}
      <ScrollView style={styles.axis} testID={`${testID}-axis`}>
        <View style={[styles.axisInner, { height: axisHeight }]}>
          {/* 小时刻度列 */}
          <View style={styles.hourColW}>
            {HOURS.map((h) => (
              <View key={`hour-${h}`} style={[styles.hourCell, { height: rowHeight }]}>
                <Text variant="caption" tone="subtle">{`${String(h).padStart(2, '0')}:00`}</Text>
              </View>
            ))}
          </View>
          {/* 每一天一列 */}
          {perDay.map(({ day, buckets, timedHabits }) => (
            <View key={`col-${day}`} style={styles.col}>
              {HOURS.map((h) => (
                <View key={`ln-${h}`} style={[styles.hourLine, { top: h * rowHeight }]} />
              ))}
              {/* 有时刻的任务：按小时落块 */}
              {buckets.hours.map((bucket, hour) =>
                bucket.map((task, idx) => {
                  const done = task.completedAt !== undefined;
                  return (
                    <Pressable
                      key={`t-${task.id}`}
                      onPress={() => {
                        if (busyTaskId !== task.id) onToggleTask(task.id);
                      }}
                      style={[
                        styles.block,
                        done ? styles.blockDone : null,
                        { top: hour * rowHeight + idx * (t['space.6'] + t['space.1']), minHeight: t['space.6'] },
                      ]}
                      testID={`${testID}-task-${task.id}`}
                    >
                      <Text variant="caption" numberOfLines={1} style={[styles.blockText, done ? styles.blockDoneText : null]}>
                        {task.title}
                      </Text>
                    </Pressable>
                  );
                }),
              )}
              {/* 有时刻的习惯 */}
              {timedHabits.map(({ habit, hour }, idx) => {
                const done = isHabitDone(habitLogs ?? [], habit.id, day);
                return (
                  <Pressable
                    key={`h-${habit.id}`}
                    onPress={() => {
                      if (busyHabitId !== habit.id) onToggleHabit?.(habit.id);
                    }}
                    style={[
                      styles.block,
                      done ? styles.blockDone : null,
                      { top: hour * rowHeight + idx * (t['space.6'] + t['space.1']), minHeight: t['space.6'] },
                    ]}
                    testID={`${testID}-habit-${habit.id}`}
                  >
                    <Text variant="caption" numberOfLines={1} style={[styles.blockText, done ? styles.blockDoneText : null]}>
                      {habit.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {nowOffset !== undefined ? (
            <View
              style={[styles.nowLine, { top: nowOffset, backgroundColor: t['color.danger'] }]}
              testID={`${testID}-now-line`}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
