/**
 * 专注统计与本地日窗口测试
 * ==========================
 *
 * 重点在两件"错了也不报错、只会在某一天被发现"的事：
 *
 * 1. **"今天"必须是本地日历日。** 用 `ts - (ts % DAY_MS)` 或 UTC 切分，
 *    在东八区会把凌晨的记录算到前一天 —— 而测试跑在哪个时区是**不确定的**，
 *    所以这里一律用 `new Date(y, m, d, h)` 造**本地**时刻，
 *    断言才与运行机器的时区无关。
 * 2. **跨零点的那一轮算哪一天。** 23:50 开始、00:15 结束，
 *    按开始日算则"昨晚那个番茄今天不在统计里"，按结束日算才不重不漏。
 */

import { describe, expect, it } from 'vitest';

import type { FocusSession } from '../src/entities.js';
import {
  DAY_MS,
  dayRange,
  daysBetween,
  startOfDay,
} from '../src/date.js';
import {
  DEFAULT_FOCUS_CONFIG,
  focusDisplayMs,
  focusProgress,
  focusSessionDay,
  focusStatsForDay,
  formatFocusDuration,
  initialFocusState,
  pause,
  selectKind,
  shouldPersistSession,
  start,
} from '../src/focus.js';

/** 本地时刻 → 时间戳。**不要**用 `Date.UTC`，否则测试就依赖运行机器时区了。 */
function local(y: number, m: number, d: number, h = 0, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'fs-1',
    kind: 'work',
    plannedMs: 25 * 60 * 1000,
    actualMs: 25 * 60 * 1000,
    completed: true,
    createdAt: local(2026, 9, 26, 10, 0),
    updatedAt: local(2026, 9, 26, 10, 25),
    startedAt: local(2026, 9, 26, 10, 0),
    endedAt: local(2026, 9, 26, 10, 25),
    ...over,
  };
}

describe('本地日窗口', () => {
  it('startOfDay 归到**本地**零点，而不是 UTC 零点', () => {
    const at7am = local(2026, 9, 26, 7, 30);
    const expected = local(2026, 9, 26, 0, 0);
    expect(startOfDay(at7am)).toBe(expected);

    // 反证：按 UTC 切分（东八区会偏 8 小时）得到的是另一个值。
    // 这条断言在 UTC 时区的机器上会**天然相等**，所以用"本地零点等于当日 Date 构造"
    // 作为主判据；下面这条只在偏移非零时才有区分度，故不 assert 不等。
    expect(new Date(startOfDay(at7am)).getHours()).toBe(0);
  });

  it('dayRange 是半开区间 [今天 0 点, 明天 0 点)', () => {
    const now = local(2026, 9, 26, 15, 0);
    const { start, end } = dayRange(now);
    expect(start).toBe(local(2026, 9, 26, 0, 0));
    expect(end).toBe(local(2026, 9, 27, 0, 0));
    expect(now).toBeGreaterThanOrEqual(start);
    expect(now).toBeLessThan(end);
  });

  it('dayRange 跨月/跨年正确（交给原生 Date，不自己算毫秒）', () => {
    expect(dayRange(local(2026, 9, 30, 23, 0)).end).toBe(local(2026, 10, 1, 0, 0));
    expect(dayRange(local(2026, 12, 31, 23, 0)).end).toBe(local(2027, 1, 1, 0, 0));
  });

  it('daysBetween 按自然日算，昨天到今天恰好是 1', () => {
    expect(daysBetween(local(2026, 9, 26, 0, 1), local(2026, 9, 25, 23, 59))).toBe(1);
    expect(daysBetween(local(2026, 9, 26, 23, 59), local(2026, 9, 26, 0, 1))).toBe(0);
  });

  it('daysBetween 跨月 / 跨年 / 往前为负', () => {
    expect(daysBetween(local(2026, 10, 1), local(2026, 9, 30))).toBe(1);
    expect(daysBetween(local(2027, 1, 1), local(2026, 12, 31))).toBe(1);
    expect(daysBetween(local(2026, 9, 24), local(2026, 9, 25))).toBe(-1);
  });

  it('startOfDay：前一天 23:59 与当天 00:01 归到两个不同的日子', () => {
    expect(startOfDay(local(2026, 9, 24, 23, 59))).not.toBe(
      startOfDay(local(2026, 9, 25, 0, 1)),
    );
  });

  it('startOfDay：已经是本地 0 点时原样返回', () => {
    expect(startOfDay(local(2026, 9, 25))).toBe(local(2026, 9, 25));
  });

  it('DAY_MS 就是一天的毫秒数（排查时别猜）', () => {
    expect(DAY_MS).toBe(86_400_000);
  });
});

describe('专注统计', () => {
  it('只统计**今天**的 session', () => {
    const now = local(2026, 9, 26, 20, 0);
    const sessions = [
      session({ id: 'a', endedAt: local(2026, 9, 26, 10, 25) }),
      session({ id: 'b', endedAt: local(2026, 9, 25, 10, 25) }), // 昨天
      session({ id: 'c', endedAt: local(2026, 9, 27, 0, 1) }), // 明天
    ];
    const stats = focusStatsForDay(sessions, now);
    expect(stats.completedWorkCount).toBe(1);
    expect(stats.focusMs).toBe(25 * 60 * 1000);
  });

  it('自然完成与中途放弃分开计数，但**时长都算**', () => {
    const now = local(2026, 9, 26, 20, 0);
    const sessions = [
      session({ id: 'a', completed: true, actualMs: 25 * 60 * 1000 }),
      session({ id: 'b', completed: false, actualMs: 8 * 60 * 1000 }),
    ];
    const stats = focusStatsForDay(sessions, now);
    expect(stats.completedWorkCount).toBe(1);
    expect(stats.abortedWorkCount).toBe(1);
    expect(stats.focusMs).toBe(33 * 60 * 1000);
  });

  it('休息单独计，不计入专注轮数', () => {
    const now = local(2026, 9, 26, 20, 0);
    const sessions = [
      session({ id: 'a' }),
      session({ id: 'b', kind: 'shortBreak', actualMs: 5 * 60 * 1000, completed: true }),
      session({ id: 'c', kind: 'longBreak', actualMs: 15 * 60 * 1000, completed: true }),
    ];
    const stats = focusStatsForDay(sessions, now);
    expect(stats.completedWorkCount).toBe(1);
    expect(stats.breakMs).toBe(20 * 60 * 1000);
    expect(stats.focusMs).toBe(25 * 60 * 1000);
  });

  it('🔴 跨零点的那一轮记在**结束**的那一天，且只记一次', () => {
    const startLastNight = local(2026, 9, 25, 23, 50);
    const endThisMorning = local(2026, 9, 26, 0, 15);
    const s = session({ id: 'x', startedAt: startLastNight, endedAt: endThisMorning });

    // 归属：今天
    expect(focusSessionDay(s)).toBe(endThisMorning);
    const todayStats = focusStatsForDay([s], local(2026, 9, 26, 12, 0));
    expect(todayStats.completedWorkCount).toBe(1);

    // 昨天**不**再重复计入 —— 否则同一轮会被算两次
    const yesterdayStats = focusStatsForDay([s], local(2026, 9, 25, 23, 55));
    expect(yesterdayStats.completedWorkCount).toBe(0);
  });

  it('endedAt 缺失时退回 createdAt（老数据/未来写入方可能不填）', () => {
    const createdAt = local(2026, 9, 26, 9, 0);
    const s = session({ id: 'x', endedAt: undefined, createdAt });
    expect(focusSessionDay(s)).toBe(createdAt);
    expect(focusStatsForDay([s], local(2026, 9, 26, 12, 0)).completedWorkCount).toBe(1);
  });

  it('🔴 actualMs 缺失时退回 plannedMs，**不能当 0**', () => {
    const s = session({ id: 'x', actualMs: undefined, plannedMs: 25 * 60 * 1000 });
    // 当成 0 的话，"今天专注了多久"会显示 0 分钟 —— 看起来像功能坏了
    expect(focusStatsForDay([s], local(2026, 9, 26, 12, 0)).focusMs).toBe(25 * 60 * 1000);
  });

  it('空列表得到全 0，而不是 undefined', () => {
    const stats = focusStatsForDay([], local(2026, 9, 26, 12, 0));
    expect(stats).toEqual({
      completedWorkCount: 0,
      abortedWorkCount: 0,
      focusMs: 0,
      breakMs: 0,
    });
  });

  it('同一天边界：0 点整**算**今天，次日 0 点整**不算**', () => {
    const midnight = local(2026, 9, 26, 0, 0);
    const nextMidnight = local(2026, 9, 27, 0, 0);
    const stats = focusStatsForDay(
      [session({ id: 'a', endedAt: midnight }), session({ id: 'b', endedAt: nextMidnight })],
      local(2026, 9, 26, 12, 0),
    );
    expect(stats.completedWorkCount).toBe(1);
  });
});

describe('时长展示', () => {
  it('不足 1 小时给分钟', () => {
    expect(formatFocusDuration(0)).toBe('0 分钟');
    expect(formatFocusDuration(25 * 60 * 1000)).toBe('25 分钟');
    expect(formatFocusDuration(59 * 60 * 1000)).toBe('59 分钟');
  });

  it('整小时不显示「0 分钟」', () => {
    expect(formatFocusDuration(60 * 60 * 1000)).toBe('1 小时');
    expect(formatFocusDuration(80 * 60 * 1000)).toBe('1 小时 20 分钟');
  });

  it('负数不会渲染出「-5 分钟」', () => {
    expect(formatFocusDuration(-1000)).toBe('0 分钟');
  });
});

describe('选择轮次类型', () => {
  it('idle 时能换类型，且时长跟着配置走', () => {
    const idle = initialFocusState();
    expect(selectKind(idle, 'shortBreak').plannedMs).toBe(DEFAULT_FOCUS_CONFIG.shortBreakMs);
    expect(selectKind(idle, 'longBreak').plannedMs).toBe(DEFAULT_FOCUS_CONFIG.longBreakMs);
    expect(selectKind(idle, 'work').plannedMs).toBe(DEFAULT_FOCUS_CONFIG.workMs);
  });

  it('🔴 计时中换类型**不生效**（否则进度与时长对不上）', () => {
    const running = start(initialFocusState(), local(2026, 9, 26, 10, 0));
    const after = selectKind(running, 'longBreak');
    // 原样返回：kind 与 plannedMs 都没变，endsAt 也没被重算
    expect(after).toBe(running);
  });

  it('暂停中换类型也不生效', () => {
    const paused = { ...start(initialFocusState(), local(2026, 9, 26, 10, 0)), phase: 'paused' as const };
    expect(selectKind(paused, 'longBreak')).toBe(paused);
  });
});

describe('哪些段落该落盘', () => {
  it('工作段落盘', () => {
    expect(shouldPersistSession(session({ kind: 'work' }))).toBe(true);
  });

  it('🔴 休息**不**落盘 —— 否则统计里一半是休息', () => {
    expect(shouldPersistSession(session({ kind: 'shortBreak' }))).toBe(false);
    expect(shouldPersistSession(session({ kind: 'longBreak' }))).toBe(false);
  });
});

describe('计时器显示的数字', () => {
  const t0 = local(2026, 9, 26, 10, 0);
  const total = DEFAULT_FOCUS_CONFIG.workMs;

  it('🔴 空闲时显示**这一轮的长度**，不是 0', () => {
    // 一个静止的 00:00 在用户眼里等于"坏了"；真机验收时我自己就这么误判过。
    const shown = focusDisplayMs(initialFocusState(), t0);
    expect(shown).toBe(total);
    expect(shown).not.toBe(0);
  });

  it('运行中显示剩余时间', () => {
    const running = start(initialFocusState(), t0);
    expect(focusDisplayMs(running, t0)).toBe(total);
    expect(focusDisplayMs(running, t0 + 1000)).toBe(total - 1000);
  });

  it('到时后显示 0（不是负数）', () => {
    const running = start(initialFocusState(), t0);
    expect(focusDisplayMs(running, t0 + total + 5000)).toBe(0);
  });

  it('暂停后冻在当时的剩余量上', () => {
    const paused = pause(start(initialFocusState(), t0), t0 + 2000);
    expect(focusDisplayMs(paused, t0 + 2000)).toBe(total - 2000);
    expect(focusDisplayMs(paused, t0 + 99_000)).toBe(total - 2000);
  });
});

describe('进度', () => {
  const t0 = local(2026, 9, 26, 10, 0);
  const total = DEFAULT_FOCUS_CONFIG.workMs;

  it('idle 时是 0，不是 1（"还没开始"与"已走完"必须长得不一样）', () => {
    expect(focusProgress(initialFocusState(), t0)).toBe(0);
  });

  it('刚开始是 0，走到一半是 0.5，到时是 1', () => {
    const running = start(initialFocusState(), t0);
    expect(focusProgress(running, t0)).toBe(0);
    expect(focusProgress(running, t0 + total / 2)).toBe(0.5);
    expect(focusProgress(running, t0 + total)).toBe(1);
  });

  it('超过结束时间仍是 1，不会超过（用 min 夹住）', () => {
    const running = start(initialFocusState(), t0);
    expect(focusProgress(running, t0 + total * 3)).toBe(1);
  });

  it('暂停后冻在当时的进度上', () => {
    const paused = pause(start(initialFocusState(), t0), t0 + total / 4);
    expect(focusProgress(paused, t0 + total / 4)).toBeCloseTo(0.25, 5);
    // 再晚也不会继续涨 —— 暂停就是暂停
    expect(focusProgress(paused, t0 + total)).toBeCloseTo(0.25, 5);
  });

  it('🔴 plannedMs 为 0 时返回 0，**不是 NaN**', () => {
    // NaN 传进布局会让进度条整条消失，而错误信息不会指向这里
    const broken = { ...initialFocusState(), phase: 'running' as const, plannedMs: 0, endsAt: t0 };
    expect(focusProgress(broken, t0)).toBe(0);
    expect(Number.isNaN(focusProgress(broken, t0))).toBe(false);
  });
});
