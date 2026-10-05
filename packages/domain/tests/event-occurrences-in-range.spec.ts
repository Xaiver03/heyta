/**
 * 倒数日在**一段区间**里发生在哪几天（W6 给日历用的那件数学）
 * ==========================================================
 *
 * 日历要显示"这一格有个日子"，就必须问"这段区间里它出现几次"。这件数学
 * 已经住在 `@heyta/domain`（公历 RRULE、农历闰月三档、锚点越界回退），
 * 日历**不许再写一遍**（AGENTS §3.5：面板说"还有 12 天"而日历画在明天，
 * 就是两份数学的形状）。本文件钉的是 domain 这一侧的口径，
 * 而"日历有没有去问它"钉在 `packages/ui/tests/calendar-event-source.spec.ts`。
 */

import { describe, expect, it } from 'vitest';
import { Recurrence, eventOccurrencesInRange, type CountdownEvent } from '../src/index.js';

const event = (over: Partial<CountdownEvent> & { id: string }): CountdownEvent => ({
  title: over.id,
  date: '2026-01-01',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('一次性倒数日', () => {
  it('只有锚点那一天，且只在区间内时出现', () => {
    const e = event({ id: 'e', date: '2026-05-01' });
    expect(eventOccurrencesInRange(e, '2026-04-01', '2026-06-01')).toEqual(['2026-05-01']);
    expect(eventOccurrencesInRange(e, '2026-05-02', '2026-06-01')).toEqual([]);
  });

  it('区间两端都算（闭区间）', () => {
    const e = event({ id: 'e', date: '2026-05-01' });
    expect(eventOccurrencesInRange(e, '2026-05-01', '2026-05-01')).toEqual(['2026-05-01']);
  });

  it('过去了就永远不再出现 —— 与 `nextEventOccurrence` 对一次性项返回 undefined 同一取舍', () => {
    const e = event({ id: 'e', date: '2020-05-01' });
    expect(eventOccurrencesInRange(e, '2026-01-01', '2026-12-31')).toEqual([]);
  });
});

describe('公历重复', () => {
  it('每年重复在跨三年的区间里出三次，升序去重', () => {
    const e = event({ id: 'e', date: '2024-11-05', recurrence: Recurrence.yearly(11, 5) });
    expect(eventOccurrencesInRange(e, '2025-11-01', '2027-11-30')).toEqual([
      '2025-11-05',
      '2026-11-05',
      '2027-11-05',
    ]);
  });

  it('坏规则算"没有"而不是抛 —— 一条坏数据不许把整片日历变成空白块', () => {
    const e = event({ id: 'e', date: '2026-05-01', recurrence: 'FREQ=NOTAREALRULE' });
    expect(eventOccurrencesInRange(e, '2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('to < from 的空区间返回空（补白格算反了时不该崩）', () => {
    const e = event({ id: 'e', date: '2026-05-01', recurrence: Recurrence.yearly(5, 1) });
    expect(eventOccurrencesInRange(e, '2026-12-31', '2026-01-01')).toEqual([]);
  });
});

describe('农历重复（闰月三档 + 越界取舍）', () => {
  it('逢闰过正（默认 first）：闰四月那年只用正月', () => {
    const e = event({
      id: 'lunar',
      date: '2025-05-24', // 农历闰四月初一
      recurrence: Recurrence.yearly(5, 24),
      isLunar: true,
    });
    const dates = eventOccurrencesInRange(e, '2025-01-01', '2026-12-31');
    expect(dates.length, '两个农历年各出一次').toBe(2);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size, '同一格不许画两条').toBe(dates.length);
  });

  it('农历锚点落在历表之外时算"没有"，而不是把日历崩掉', () => {
    const e = event({
      id: '坏农历',
      date: '1800-01-01',
      recurrence: Recurrence.yearly(1, 1),
      isLunar: true,
    });
    expect(() => eventOccurrencesInRange(e, '2026-01-01', '2026-12-31')).not.toThrow();
    expect(eventOccurrencesInRange(e, '2026-01-01', '2026-12-31')).toEqual([]);
  });
});
