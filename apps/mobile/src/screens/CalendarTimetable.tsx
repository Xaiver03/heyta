/**
 * 课表视图（移动端）—— 节次 × 7 天网格
 * =====================================
 *
 * 对照滴答清单「课表」档：左侧是节次（带开始时间），横向 7 天，每格列出落在该时段
 * 的任务 / 习惯。与「日/周」的时间轴不同，这里按**固定节次**分块，便于一眼看"哪节课有事"。
 *
 * 数据全部来自宿主：任务用 `dueLocalDateOf` 分日、`dueDate` 的**小时**分节；习惯用
 * `isScheduledOn` 分日、`habit.time` 的**小时**分节。本组件不做任何日期算术，只画网格 + 上报点按。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { dueLocalDateOf, isScheduledOn, type Habit, type HabitLog, type LocalDate, type Task } from '@heyta/domain';

import { Text } from '../ui/kit';
import { useTokens } from '../theme';

/** 课表的节次：08:00–21:00，每小时一节。`startHour` 用来把条目分进格。 */
const PERIOD_START_HOURS: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export interface CalendarTimetableProps {
  /** 这一周的周一。 */
  readonly weekStart: LocalDate;
  readonly today: LocalDate;
  readonly selected: LocalDate;
  readonly weekdayLabelOf: (date: LocalDate) => string;
  readonly tasks: readonly Task[];
  readonly onToggleTask: (taskId: string) => void;
  readonly busyTaskId?: string | null;
  readonly onSelectDay?: (date: LocalDate) => void;
  readonly habits?: readonly Habit[];
  readonly habitLogs?: readonly HabitLog[];
  readonly onToggleHabit?: (habitId: string) => void;
  readonly busyHabitId?: string | null;
  readonly testID?: string;
}

function hourOfEpoch(ms: number): number {
  return new Date(ms).getHours();
}
function hourOfTime(time: string | undefined): number | null {
  if (time === undefined) return null;
  const h = Number(time.slice(0, 2));
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : null;
}

export function CalendarTimetable({
  weekStart,
  today,
  selected,
  weekdayLabelOf,
  tasks,
  onToggleTask,
  busyTaskId,
  onSelectDay,
  habits,
  habitLogs,
  onToggleHabit,
  busyHabitId,
  testID = 'calendar-timetable',
}: CalendarTimetableProps): React.JSX.Element {
  const t = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        headerRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: t['space.1'] },
        periodColW: { width: t['space.12'] },
        dayHead: { flex: 1, alignItems: 'center' },
        row: { flexDirection: 'row', alignItems: 'stretch', borderTopWidth: t['border-width.thin'], borderColor: t['color.border-subtle'] },
        periodCell: { width: t['space.12'], paddingVertical: t['space.2'], justifyContent: 'center' },
        cell: { flex: 1, gap: t['space.1'], padding: t['space.1'], minHeight: t['space.10'] },
        chip: {
          borderRadius: t['radius.sm'],
          backgroundColor: t['color.primary-subtle'],
          paddingHorizontal: t['space.1'],
          paddingVertical: t['space.1'],
        },
        chipDone: { backgroundColor: t['color.surface'] },
        chipText: { color: t['color.primary'] },
        chipDoneText: { color: t['color.foreground-muted'], textDecorationLine: 'line-through' },
      }),
    [t],
  );

  // 逐日：把条目按 小时→节 归到 (dayIndex, periodIndex)。
  const cells = useMemo(() => {
    // 7 天 × 每节一个数组
    const grid: { tasks: Task[]; habits: Habit[] }[][] = Array.from({ length: 7 }, () =>
      PERIOD_START_HOURS.map(() => ({ tasks: [], habits: [] })),
    );
    const periodIndexForHour = (h: number): number => {
      if (h < PERIOD_START_HOURS[0]!) return -1;
      const idx = PERIOD_START_HOURS.indexOf(h);
      if (idx >= 0) return idx;
      // 落在两节之间（如 08:30）→ 归到它之前最近的那节。
      let best = -1;
      for (let i = 0; i < PERIOD_START_HOURS.length; i += 1) {
        if (PERIOD_START_HOURS[i]! <= h) best = i;
      }
      return best;
    };
    const dayIndexForDate = (date: LocalDate): number => {
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(`${weekStart}T00:00:00`);
        d.setDate(d.getDate() + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        if (`${y}-${m}-${dd}` === date) return i;
      }
      return -1;
    };
    for (const task of tasks) {
      if (task.dueDate === undefined) continue;
      const taskDate = dueLocalDateOf(task);
      if (taskDate === undefined) continue;
      const di = dayIndexForDate(taskDate);
      if (di < 0) continue;
      const pi = periodIndexForHour(hourOfEpoch(task.dueDate));
      if (pi >= 0) grid[di]![pi]!.tasks.push(task);
    }
    for (const habit of habits ?? []) {
      const h = hourOfTime(habit.time);
      if (h === null) continue;
      const pi = periodIndexForHour(h);
      if (pi < 0) continue;
      for (let di = 0; di < 7; di += 1) {
        const d = new Date(`${weekStart}T00:00:00`);
        d.setDate(d.getDate() + di);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const date = `${y}-${m}-${dd}` as LocalDate;
        if (isScheduledOn(habit.frequency, date)) grid[di]![pi]!.habits.push(habit);
      }
    }
    return grid;
  }, [tasks, habits, weekStart]);

  const dateForDay = (di: number): LocalDate => {
    const d = new Date(`${weekStart}T00:00:00`);
    d.setDate(d.getDate() + di);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}` as LocalDate;
  };

  return (
    <View testID={testID}>
      <View style={styles.headerRow}>
        <View style={styles.periodColW} />
        {Array.from({ length: 7 }, (_, di) => {
          const date = dateForDay(di);
          const isToday = date === today;
          return (
            <Pressable
              key={`h-${di}`}
              style={styles.dayHead}
              onPress={() => {
                onSelectDay?.(date);
              }}
              accessibilityRole="button"
              testID={`${testID}-head-${date}`}
            >
              <Text variant="caption" tone={isToday ? 'default' : 'subtle'}>
                {weekdayLabelOf(date)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {PERIOD_START_HOURS.map((hour, pi) => (
        <View key={`p-${hour}`} style={styles.row}>
          <View style={styles.periodCell}>
            <Text variant="caption" tone="subtle">{`${String(hour).padStart(2, '0')}:00`}</Text>
          </View>
          {Array.from({ length: 7 }, (_, di) => (
            <View key={`c-${hour}-${di}`} style={styles.cell}>
              {cells[di]![pi]!.tasks.map((task) => {
                const done = task.completedAt !== undefined;
                return (
                  <Pressable
                    key={`t-${task.id}`}
                    onPress={() => {
                      if (busyTaskId !== task.id) onToggleTask(task.id);
                    }}
                    style={[styles.chip, done ? styles.chipDone : null]}
                    testID={`timetable-task-${task.id}`}
                  >
                    <Text variant="caption" numberOfLines={1} style={[styles.chipText, done ? styles.chipDoneText : null]}>
                      {task.title}
                    </Text>
                  </Pressable>
                );
              })}
              {cells[di]![pi]!.habits.map((habit) => {
                const done = (habitLogs ?? []).some(
                  (l) => l.habitId === habit.id && l.date === dateForDay(di) && l.deletedAt === undefined,
                );
                return (
                  <Pressable
                    key={`h-${habit.id}`}
                    onPress={() => {
                      if (busyHabitId !== habit.id) onToggleHabit?.(habit.id);
                    }}
                    style={[styles.chip, done ? styles.chipDone : null]}
                    testID={`timetable-habit-${habit.id}`}
                  >
                    <Text variant="caption" numberOfLines={1} style={[styles.chipText, done ? styles.chipDoneText : null]}>
                      {habit.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
