/**
 * 习惯打卡记录的可读导出投影。
 *
 * 习惯名称、单位、完成状态和记录的排列属于产品语义，不能由各个 UI 壳各自
 * 拼一份。这里保持纯函数；Web 只负责把返回的 CSV 交给浏览器下载。
 */
import type { Habit, HabitLog } from '@heyta/domain';

export interface HabitExportRow {
  date: string;
  habit: string;
  value: number;
  unit: string;
  completed: boolean;
  note: string;
}

export interface HabitCsvColumns {
  date: string;
  habit: string;
  value: string;
  unit: string;
  completed: string;
  completedValue: string;
  incompleteValue: string;
  note: string;
}

/** 只投影仍存在的习惯及打卡记录；已撤销的打卡不属于记录导出。 */
export function buildHabitExportRows(
  habits: readonly Habit[],
  logs: readonly HabitLog[],
): HabitExportRow[] {
  const liveHabits = new Map(
    habits
      .filter((habit) => habit.deletedAt === undefined)
      .map((habit) => [habit.id, habit]),
  );
  return logs
    .filter((log) => log.deletedAt === undefined && liveHabits.has(log.habitId))
    .map((log) => {
      const habit = liveHabits.get(log.habitId)!;
      return {
        date: log.date,
        habit: habit.name,
        value: log.value ?? habit.target ?? 1,
        unit: habit.unit ?? '',
        completed: true,
        note: log.note ?? '',
        createdAt: log.createdAt,
        id: log.id,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map(({ createdAt: _createdAt, id: _id, ...row }) => row);
}

/** CSV 单元格转义，并阻止表格软件把用户文本当成公式执行。 */
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function renderHabitCsv(
  rows: readonly HabitExportRow[],
  columns: HabitCsvColumns,
): string {
  const header = [columns.date, columns.habit, columns.value, columns.unit, columns.completed, columns.note];
  const lines = [header, ...rows.map((row) => [
    row.date,
    row.habit,
    String(row.value),
    row.unit,
    row.completed ? columns.completedValue : columns.incompleteValue,
    row.note,
  ])];
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
