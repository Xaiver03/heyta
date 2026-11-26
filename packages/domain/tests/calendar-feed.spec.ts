/**
 * 任务 → ICS 导出判据
 * ==================
 * 只导未完成 + 有日期；全天/定时/时区/转义/RRULE/UID 稳定。
 */

import { describe, expect, it } from 'vitest';

import { hasExportableDate, taskToCalendarEvent, tasksToIcs } from '../src/calendar-feed.js';
import type { Task } from '../src/entities.js';

const task = (over: Record<string, unknown>): Task => ({ id: 't', title: '任务', createdAt: 0, updatedAt: 0, ...over }) as unknown as Task;

const NOW = Date.UTC(2026, 10, 24, 0, 0, 0);

describe('tasksToIcs', () => {
  it('只导未完成 + 有日期的任务；空列表也是一份合法 VCALENDAR', () => {
    expect(tasksToIcs([], { now: NOW })).not.toContain('BEGIN:VEVENT');

    const out = tasksToIcs(
      [
        task({ id: 'a', title: '有日期', dueDateLocal: '2026-11-24' }),
        task({ id: 'b', title: '已完成', dueDateLocal: '2026-11-24', completedAt: 1 }),
        task({ id: 'c', title: '无日期' }),
      ],
      { now: NOW },
    );
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('SUMMARY:有日期');
    expect(out).not.toContain('SUMMARY:已完成');
    expect(out).not.toContain('SUMMARY:无日期');
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('全天事件用 VALUE=DATE，DTEND 排他 +1 天', () => {
    const out = tasksToIcs([task({ id: 'ad', title: '假期', dueDateLocal: '2026-11-24' })], { now: NOW });
    expect(out).toContain('DTSTART;VALUE=DATE:20261124');
    expect(out).toContain('DTEND;VALUE=DATE:20261125');
  });

  it('定时事件用 UTC，默认时长 60 分钟', () => {
    const out = tasksToIcs([task({ id: 'tm', title: '周会', dueDate: Date.UTC(2026, 10, 24, 2, 0, 0) })], { now: NOW });
    expect(out).toContain('DTSTART:20261124T020000Z');
    expect(out).toContain('DTEND:20261124T030000Z');
  });

  it('文本转义（逗号/分号/反斜杠/换行）与 RRULE', () => {
    const out = tasksToIcs(
      [task({ id: 'esc', title: 'a,b;c\\d', note: '第一行\n第二行', dueDateLocal: '2026-11-24', repeatRule: 'FREQ=WEEKLY;BYDAY=MO' })],
      { now: NOW },
    );
    expect(out).toContain('SUMMARY:a\\,b\\;c\\\\d');
    expect(out).toContain('DESCRIPTION:第一行\\n第二行');
    expect(out).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });

  it('UID 稳定（同 id + domain 两次一致），DTSTAMP 由 now 决定', () => {
    const a = tasksToIcs([task({ id: 'stable', title: 'X', dueDateLocal: '2026-11-24' })], { now: NOW, domain: 'heyta' });
    const b = tasksToIcs([task({ id: 'stable', title: 'X', dueDateLocal: '2026-11-24' })], { now: NOW, domain: 'heyta' });
    expect(a).toBe(b);
    expect(a).toContain('UID:stable@heyta');
    expect(a).toContain('DTSTAMP:20261124T000000Z');
  });

  it('可导出判定', () => {
    expect(taskToCalendarEvent(task({ dueDate: 1 }))).toBe(true);
    expect(taskToCalendarEvent(task({ dueDate: 1, completedAt: 2 }))).toBe(false);
    expect(taskToCalendarEvent(task({}))).toBe(false);
    expect(hasExportableDate(task({ dueDateLocal: '2026-01-01' }))).toBe(true);
    expect(hasExportableDate(task({}))).toBe(false);
  });
});
