/**
 * 年视图要的领域数学（R13）
 * ==========================
 *
 * `monthsOfYear` 是这一档**唯一**的新数学，而它落在 `@heyta/domain` 而不是板子里：
 * "会静默算错的日历数学全在领域层" 是这一目录的既定分工（见
 * `packages/ui/src/calendar/model.ts` 文件头）。它错了不崩 ——
 * 只是"12 张卡从 2 月开始排、1 月挂到最后"，而每张卡里的日子仍然自洽。
 *
 * 🔴 所以这里的判据全部盯着**序**与**界**：
 *   序 = 1 月在前、12 月在末（不是按"离今天多远"排）；
 *   界 = 游标是任意一天都得落进同一个年份（游标约定），跨年不能错一年。
 */

import { daysInMonth, monthsOfYear, startOfYear } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

describe('startOfYear', () => {
  it('任何一天都回到当年的 1 月 1 日', () => {
    expect(startOfYear('2026-10-03')).toBe('2026-01-01');
    expect(startOfYear('2026-01-01')).toBe('2026-01-01');
    expect(startOfYear('2026-12-31')).toBe('2026-01-01');
  });

  it('🔴 跨年那一界：2027-01-05 回的是 2027 年，不是 2026', () => {
    expect(startOfYear('2027-01-05')).toBe('2027-01-01');
    // 反向那一界也一样：这一条不是装饰 —— 游标在年档里会被 `‹ ›` 推着跨年走。
    expect(startOfYear('2026-12-29')).toBe('2026-01-01');
  });
});

describe('monthsOfYear', () => {
  it('12 个月，每项都是那个月的 1 号，且**首月是 1 月**', () => {
    const months = monthsOfYear('2026-10-03');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-01-01');
    expect(months[11]).toBe('2026-12-01');
    // 每一项都以 -01 结尾：月卡里的格子是从"这个月有多少天"铺出来的，
    // 传进来的若不是月首，那一天就会在 1 号那一格里被**少画一天**。
    for (const month of months) expect(month.endsWith('-01')).toBe(true);
  });

  it('🔴 游标是这一年里的**任意一天**都得到同一列月份', () => {
    const fromMarch = monthsOfYear('2026-03-17');
    const fromJanuary = monthsOfYear('2026-01-01');
    const fromDecember = monthsOfYear('2026-12-31');
    expect(fromMarch).toEqual(fromJanuary);
    expect(fromDecember).toEqual(fromJanuary);
  });

  it('闰年那一格：2 月有 29 天（月份序列本身不含天数，所以两件事各自钉）', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    // 世纪年：2100 不是闰年 —— 这条是 `% 4` 那套手写规则最容易漏的地方。
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  it('年与年之间不重叠、不空洞：2026 的最后一月与 2027 的第一月相差一个月', () => {
    const last2026 = monthsOfYear('2026-10-03')[11];
    const first2027 = monthsOfYear('2027-01-05')[0];
    expect(last2026).toBe('2026-12-01');
    expect(first2027).toBe('2027-01-01');
  });
});
