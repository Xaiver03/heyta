import { describe, expect, it } from 'vitest';

import { addDays, diffDays, startOfWeek } from '@heyta/domain';

import {
  WEEK_STRIP_ANCHOR,
  WEEK_STRIP_COUNT,
  WEEK_STRIP_FIRST_INDEX,
  WEEK_STRIP_LAST_INDEX,
  weekIndexAtOffset,
  weekIndexFor,
  weekStartForIndex,
  weekStripListPosition,
  clampWeekStripIndex,
} from '../src/calendar/week-strip-model.js';

describe('周历条无限滚动索引模型', () => {
  it('锚点必须是周一，否则索引会漂', () => {
    expect(startOfWeek(WEEK_STRIP_ANCHOR)).toBe(WEEK_STRIP_ANCHOR);
  });

  it('索引与周一是可逆的一一对应（含负数）', () => {
    for (const index of [-1000, -2, -1, 0, 1, 2, 12345]) {
      const weekStart = weekStartForIndex(index);
      expect(weekIndexFor(weekStart)).toBe(index);
      // 指向的那一周确实是周一
      expect(startOfWeek(weekStart)).toBe(weekStart);
      // 相邻索引相差 7 天
      expect(diffDays(weekStartForIndex(index), weekStartForIndex(index + 1))).toBe(7);
    }
  });

  it('任意周一都能换算成索引，不依赖它落在哪个区间', () => {
    // 2026-11-16 是周一
    const weekStart = '2026-11-16';
    expect(startOfWeek(weekStart)).toBe(weekStart);
    const index = weekIndexFor(weekStart);
    expect(weekStartForIndex(index)).toBe(weekStart);
    // 索引区间中心就在锚点附近
    expect(index).toBeGreaterThan(0);
  });

  it('跨年、跨月、闰年边界都由日期库兜住', () => {
    const cases = ['2024-02-26', '2027-12-27', '2028-01-03'];
    for (const weekStart of cases) {
      expect(startOfWeek(weekStart)).toBe(weekStart);
      expect(weekStartForIndex(weekIndexFor(weekStart))).toBe(weekStart);
    }
  });

  it('区间是"等价无限"的宽窗，越界贴边而不是抛错', () => {
    expect(WEEK_STRIP_COUNT).toBe(WEEK_STRIP_LAST_INDEX - WEEK_STRIP_FIRST_INDEX + 1);
    // 半幅约 ±200 年
    expect(WEEK_STRIP_FIRST_INDEX).toBeLessThan(-10000);
    expect(WEEK_STRIP_LAST_INDEX).toBeGreaterThan(10000);
    expect(clampWeekStripIndex(WEEK_STRIP_FIRST_INDEX - 5)).toBe(WEEK_STRIP_FIRST_INDEX);
    expect(clampWeekStripIndex(WEEK_STRIP_LAST_INDEX + 5)).toBe(WEEK_STRIP_LAST_INDEX);
  });

  it('列表位置 = 索引 − 首索引', () => {
    expect(weekStripListPosition(WEEK_STRIP_FIRST_INDEX)).toBe(0);
    expect(weekStripListPosition(WEEK_STRIP_FIRST_INDEX + 3)).toBe(3);
  });

  it('滚动偏移量吸附回最近的整页', () => {
    const pageWidth = 390;
    const base = weekStripListPosition(weekIndexFor('2026-11-16'));
    // 停在第 n 页
    expect(weekIndexAtOffset(base * pageWidth, pageWidth)).toBe(
      WEEK_STRIP_FIRST_INDEX + base,
    );
    // 向右多滑半格以内仍算同一页
    expect(weekIndexAtOffset(base * pageWidth + pageWidth * 0.4, pageWidth)).toBe(
      WEEK_STRIP_FIRST_INDEX + base,
    );
    // 超过半格前进一页
    expect(weekIndexAtOffset(base * pageWidth + pageWidth * 0.6, pageWidth)).toBe(
      WEEK_STRIP_FIRST_INDEX + base + 1,
    );
  });

  it('页宽未知（首帧未布局）时不崩溃', () => {
    expect(weekIndexAtOffset(123, 0)).toBe(WEEK_STRIP_FIRST_INDEX);
  });

  it('addDays 在周索引模型里不引入漂移（连续换算 400 周）', () => {
    let weekStart = weekStartForIndex(0);
    for (let i = 0; i < 400; i += 1) {
      expect(weekIndexFor(weekStart)).toBe(i);
      weekStart = addDays(weekStart, 7);
    }
  });
});
