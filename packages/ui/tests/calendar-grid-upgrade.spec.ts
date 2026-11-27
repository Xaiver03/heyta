import { describe, expect, it } from 'vitest';
import { dueDateToEpoch, type Task } from '@heyta/domain';
import { calendarCellBars, multiDayGrid, multiWeekGrid } from '../src/calendar/model.js';

describe('calendar grid & bar kind upgrades', () => {
  it('multiDayGrid returns consecutive days and supports week alignment', () => {
    expect(multiDayGrid('2026-11-27', 5)).toEqual([
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
    ]);
    // 2026-11-27 is Friday; aligned to Monday (1) starts 2026-11-23
    expect(multiDayGrid('2026-11-27', 3, 1)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ]);
    expect(multiDayGrid('2026-11-27', 0)).toEqual([]);
    expect(multiDayGrid('2026-11-27', -2)).toEqual([]);
  });

  it('multiWeekGrid returns weeks * 7 cells starting from Monday', () => {
    const cells = multiWeekGrid('2026-11-27', 2);
    expect(cells).toHaveLength(14);
    expect(cells[0]).toEqual({ date: '2026-11-23', inMonth: true });
    expect(cells[7]).toEqual({ date: '2026-11-30', inMonth: true });
    expect(cells[8]).toEqual({ date: '2026-12-01', inMonth: false });
  });

  it('calendarCellBars marks repeating tasks as kind="repeat" and regular tasks as kind="task"', () => {
    const base: Omit<Task, 'id' | 'title' | 'repeatRule'> = {
      createdAt: 0,
      updatedAt: 0,
      dueDate: dueDateToEpoch('2026-11-27'),
    };
    const tasks: Task[] = [
      { ...base, id: 't1', title: 'Normal task' },
      { ...base, id: 't2', title: 'Repeat task', repeatRule: 'FREQ=DAILY' },
    ];
    const { bars } = calendarCellBars(tasks, '2026-11-27', '2026-11-27', 5);
    expect(bars.find((b) => b.id === 't1')?.kind).toBe('task');
    expect(bars.find((b) => b.id === 't2')?.kind).toBe('repeat');
  });
});
