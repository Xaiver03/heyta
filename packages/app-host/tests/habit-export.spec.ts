import type { Habit, HabitLog } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import { buildHabitExportRows, renderHabitCsv } from '../src/habit-export.js';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h-1',
  name: '喝水',
  createdAt: 1,
  updatedAt: 1,
  target: 8,
  unit: '杯',
  ...over,
});

const log = (over: Partial<HabitLog> = {}): HabitLog => ({
  id: 'h-1:2026-10-07',
  habitId: 'h-1',
  date: '2026-10-07',
  createdAt: 2,
  updatedAt: 2,
  ...over,
});

describe('habit export projection', () => {
  it('joins live habits with live logs and defaults an omitted value to the target', () => {
    expect(buildHabitExportRows([habit()], [log()])).toEqual([
      { date: '2026-10-07', habit: '喝水', value: 8, unit: '杯', completed: true, note: '' },
    ]);
  });

  it('omits deleted records and protects spreadsheet formula text', () => {
    const rows = buildHabitExportRows(
      [habit({ name: '=危险' })],
      [log({ note: '+执行' })],
    );
    const csv = renderHabitCsv(rows, {
      date: '日期', habit: '习惯', value: '数值', unit: '单位', completed: '完成', completedValue: '已完成', incompleteValue: '未完成', note: '记录',
    });
    expect(csv).toContain("'=危险");
    expect(csv).toContain("'+执行");
    expect(buildHabitExportRows([habit({ deletedAt: 3 })], [log()])).toEqual([]);
    expect(buildHabitExportRows([habit()], [log({ deletedAt: 3 })])).toEqual([]);
  });
});
