/**
 * 日历订阅源判据：令牌签验 + 从物化状态生成 ICS
 * ============================================
 */

import { describe, expect, it } from 'vitest';

import { buildCalendarIcsFromState, tasksFromState } from '../src/calendar-feed/feed';
import { signCalendarFeedToken, verifyCalendarFeedToken } from '../src/calendar-feed/token';

const SECRET = 'x'.repeat(48);

describe('calendar feed token', () => {
  it('签验往返得到 userId', () => {
    const token = signCalendarFeedToken(42, SECRET);
    expect(verifyCalendarFeedToken(token, SECRET)).toBe(42);
  });

  it('篡改 / 换密钥 ⇒ undefined', () => {
    const token = signCalendarFeedToken(7, SECRET);
    expect(verifyCalendarFeedToken(`${token}x`, SECRET)).toBeUndefined();
    expect(verifyCalendarFeedToken(token, 'y'.repeat(48))).toBeUndefined();
    expect(verifyCalendarFeedToken('garbage', SECRET)).toBeUndefined();
  });
});

describe('buildCalendarIcsFromState', () => {
  const state = {
    TASK: {
      a: { id: 'a', title: '有日期', dueDateLocal: '2026-11-24', completedAt: undefined },
      b: { id: 'b', title: '已完成', dueDateLocal: '2026-11-24', completedAt: 123 },
    },
  };

  it('只导未完成 + 有日期', () => {
    const tasks = tasksFromState(state);
    expect(tasks).toHaveLength(2);
    const ics = buildCalendarIcsFromState(state, { now: Date.UTC(2026, 10, 24), domain: 'heyta' });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:有日期');
    expect(ics).not.toContain('SUMMARY:已完成');
  });

  it('坏形状（无 TASK 桶）⇒ 合法空 VCALENDAR', () => {
    const ics = buildCalendarIcsFromState({}, { now: Date.UTC(2026, 10, 24) });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(tasksFromState({})).toEqual([]);
  });
});
