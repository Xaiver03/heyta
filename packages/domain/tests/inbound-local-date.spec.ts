import { describe, expect, it } from 'vitest';
import { computeCountdown } from '../src/countdown.js';
import { formatCompactLocalDate, toLocalDate } from '../src/date.js';
import type { Task } from '../src/entities.js';
import { isUrgent } from '../src/quadrant.js';
import { dueLocalDate, filterTasks, groupTasksByDate, sectionTasks } from '../src/task-filter.js';

const task: Task = {
  id: 'inbound-date', title: 'Date-only capture', createdAt: 0, updatedAt: 0,
  // 2026-10-08 midnight in the rule's Asia/Shanghai timezone.
  dueDate: Date.UTC(2026, 9, 7, 16),
  dueDateLocal: '2026-10-08',
};

describe('inbound date-only semantics across device timezones', () => {
  it('keeps the rule calendar day for today, grouping, urgency and display', () => {
    const now = new Date(2026, 9, 8, 12).getTime();
    expect(toLocalDate(now)).toBe('2026-10-08');
    expect(dueLocalDate(task)).toBe('2026-10-08');
    expect(filterTasks([task], { kind: 'today' }, { now })).toEqual([task]);
    expect(sectionTasks([task], { now }).dueToday).toEqual([task]);
    expect(groupTasksByDate([task], { now })[0]?.date).toBe('2026-10-08');
    expect(computeCountdown(task, { now }).remainingDays).toBe(0);
    expect(isUrgent(task, { now })).toBe(true);
    expect(formatCompactLocalDate(task.dueDateLocal!, now)).toBe('10-08');
  });
});
