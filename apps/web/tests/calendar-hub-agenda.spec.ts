/**
 * 「今天 / 最近 7 天」日程分组的纯函数判据
 * ======================================
 *
 * 这一组钉的是两种**静默少一条**的形状：
 *
 *   1. **跨天日程**按"开始日"分组 ⇒ 昨天 22:00 到今天 01:00 的会从今天消失；
 *   2. **全天日程**拿 `start` 的本地时间推日期 ⇒ 时区边界上差一天，而界面上
 *      只表现为"这条会画到了前一天"。
 *
 * 分组本身是纯函数，所以这里不挂 DOM、不初始化 op-log —— 设备时区就是夹具时区
 * （`new Date(y, m, d, h)` 按本地时间构造，跨机器跑也不会漂）。
 */

import type { CalendarEvent } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import { agendaDays, agendaGroups } from '../src/features/calendar/agenda.js';

/** 本地时刻（避免用 `Date.UTC` 把时区差算进夹具）。 */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 10, day, hour, minute).getTime();

function event(over: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return { createdAt: 0, updatedAt: 0, ...over };
}

describe('agendaDays', () => {
  it('「今天」只有一天，「最近 7 天」含今天共七天', () => {
    expect(agendaDays('2026-11-24', 'today')).toEqual(['2026-11-24']);
    expect(agendaDays('2026-11-24', 'next7')).toEqual([
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
    ]);
  });

  it('跨月也按日历加天，不是加固定毫秒', () => {
    expect(agendaDays('2026-11-30', 'next7').at(-1)).toBe('2026-12-06');
  });
});

describe('agendaGroups', () => {
  it('「今天」只收今天有交集的日程（明天那条不出现）', () => {
    const groups = agendaGroups(
      [
        event({ id: 'cev-today', summary: '今天的会', start: at(24, 9), end: at(24, 10) }),
        event({ id: 'cev-tomorrow', summary: '明天的会', start: at(25, 9), end: at(25, 10) }),
      ],
      agendaDays('2026-11-24', 'today'),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.date).toBe('2026-11-24');
    expect(groups[0]?.events.map((item) => item.id)).toEqual(['cev-today']);
  });

  it('「最近 7 天」收第 1–7 天，第 8 天的不出现', () => {
    const groups = agendaGroups(
      [
        event({ id: 'cev-day1', start: at(24, 9), end: at(24, 10) }),
        event({ id: 'cev-day7', start: at(30, 9), end: at(30, 10) }),
        event({ id: 'cev-day8', start: at(31, 9), end: at(31, 10) }),
      ],
      agendaDays('2026-11-24', 'next7'),
    );

    expect(groups.map((group) => group.date)).toEqual(['2026-11-24', '2026-11-30']);
    expect(groups.flatMap((group) => group.events.map((item) => item.id))).toEqual([
      'cev-day1',
      'cev-day7',
    ]);
  });

  it('🔴 跨天日程：昨天 22:00 → 今天 01:00 的会出现在今天', () => {
    const groups = agendaGroups(
      [event({ id: 'cev-cross', summary: '夜班发布', start: at(23, 22), end: at(24, 1) })],
      agendaDays('2026-11-24', 'today'),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.events.map((item) => item.id)).toEqual(['cev-cross']);
  });

  it('🔴 跨天日程：一条会占两天，两天各出现一次（不是只挂在开始日）', () => {
    const groups = agendaGroups(
      [event({ id: 'cev-cross', summary: '通宵发布', start: at(24, 22), end: at(25, 2) })],
      agendaDays('2026-11-24', 'next7'),
    );

    expect(groups.map((group) => group.date)).toEqual(['2026-11-24', '2026-11-25']);
    expect(groups.every((group) => group.events[0]?.id === 'cev-cross')).toBe(true);
  });

  it('全天日程按 startDate / endDateExclusive 归日（排他结束日不画）', () => {
    const groups = agendaGroups(
      [
        event({
          id: 'cev-all-day',
          summary: '出差',
          allDay: true,
          startDate: '2026-11-24',
          endDateExclusive: '2026-11-27',
          start: at(24, 0),
          end: at(27, 0),
        }),
      ],
      agendaDays('2026-11-24', 'next7'),
    );

    // 24/25/26 三天有它，排他的 27 号没有。
    expect(groups.map((group) => group.date)).toEqual(['2026-11-24', '2026-11-25', '2026-11-26']);
  });

  it('同一天内：全天在前，然后按开始时刻', () => {
    const groups = agendaGroups(
      [
        event({ id: 'cev-late', start: at(24, 15), end: at(24, 16) }),
        event({ id: 'cev-early', start: at(24, 9), end: at(24, 10) }),
        event({
          id: 'cev-all-day',
          allDay: true,
          startDate: '2026-11-24',
          start: at(24, 0),
          end: at(25, 0),
        }),
      ],
      agendaDays('2026-11-24', 'today'),
    );

    expect(groups[0]?.events.map((item) => item.id)).toEqual(['cev-all-day', 'cev-early', 'cev-late']);
  });

  it('没有日程 ⇒ 空数组（空态由调用方判，不在这里编一行占位）', () => {
    expect(agendaGroups([], agendaDays('2026-11-24', 'next7'))).toEqual([]);
  });

  it('墓碑与母事件都不画（母事件不是一次发生）', () => {
    const groups = agendaGroups(
      [
        event({ id: 'cev-deleted', start: at(24, 9), end: at(24, 10), deletedAt: 1 }),
        event({ id: 'cev-master', start: at(24, 9), end: at(24, 10), recurrence: 'FREQ=WEEKLY' }),
      ],
      agendaDays('2026-11-24', 'today'),
    );

    expect(groups).toEqual([]);
  });

  it('没有起止的日程不猜位置（宁可少画，不画到错误的一天）', () => {
    const groups = agendaGroups([event({ id: 'cev-no-time' })], agendaDays('2026-11-24', 'today'));
    expect(groups).toEqual([]);
  });
});
