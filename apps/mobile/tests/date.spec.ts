/**
 * 日期工具测试
 * ============
 *
 * 这些函数看着简单，但日期边界是**最容易出错**的地方，而且错了不会报错 ——
 * 只会让任务显示成"昨天到期"，而用户以为是自己记错了。
 *
 * 测试全部用 `new Date(y, m, d, h, mi)`（**本地**构造）而不是
 * `Date.parse('2026-09-25T00:30:00Z')`：
 * 后者在 UTC+8 与 UTC-5 下是**不同的本地日期**，会让用例在 CI 与
 * 开发机上给出不同结果 —— 那种 flaky 比没有测试更糟。
 */

import { describe, expect, it } from 'vitest';
import { DAY_MS, daysBetween, formatDue, formatToday, isOverdue, startOfDay } from '../src/lib/date';

/** 本地时间构造，避免时区相关的 flaky。 */
function local(y: number, m: number, d: number, h = 0, mi = 0): number {
  return new Date(y, m - 1, d, h, mi, 0, 0).getTime();
}

describe('startOfDay', () => {
  it('归到本地当天 0 点', () => {
    expect(startOfDay(local(2026, 9, 25, 14, 37))).toBe(local(2026, 9, 25));
  });

  it('已经是 0 点时不变', () => {
    expect(startOfDay(local(2026, 9, 25))).toBe(local(2026, 9, 25));
  });

  it('🔴 按**本地**时区切分，不是 UTC', () => {
    // 这是本模块最核心的断言。若实现写成 `ts - (ts % DAY_MS)`
    // （UTC 切分），东八区的凌晨会被算成前一天。
    // 用本地构造 + 断言等于本地 0 点，在任何时区都成立；
    // 而 UTC 切分的实现**只有在 UTC 时区**才恰好通过。
    const earlyMorning = local(2026, 9, 25, 0, 30);
    const result = startOfDay(earlyMorning);
    const asDate = new Date(result);
    expect(asDate.getHours()).toBe(0);
    expect(asDate.getMinutes()).toBe(0);
    expect(asDate.getDate()).toBe(25);
  });

  it('前一天 23:59 与当天 00:01 归到不同的两天', () => {
    expect(startOfDay(local(2026, 9, 24, 23, 59))).not.toBe(
      startOfDay(local(2026, 9, 25, 0, 1)),
    );
  });
});

describe('daysBetween', () => {
  it('同一天内任意时刻相差 0 天', () => {
    expect(daysBetween(local(2026, 9, 25, 23, 59), local(2026, 9, 25, 0, 1))).toBe(0);
  });

  it('相邻两天相差 1', () => {
    expect(daysBetween(local(2026, 9, 26), local(2026, 9, 25))).toBe(1);
  });

  it('跨月正确', () => {
    expect(daysBetween(local(2026, 10, 1), local(2026, 9, 30))).toBe(1);
  });

  it('跨年正确', () => {
    expect(daysBetween(local(2027, 1, 1), local(2026, 12, 31))).toBe(1);
  });

  it('往前为负', () => {
    expect(daysBetween(local(2026, 9, 24), local(2026, 9, 25))).toBe(-1);
  });
});

describe('formatDue', () => {
  const now = local(2026, 9, 25, 10, 0);

  it('今天', () => {
    expect(formatDue(local(2026, 9, 25, 23, 0), now)).toBe('今天');
  });

  it('明天', () => {
    expect(formatDue(local(2026, 9, 26), now)).toBe('明天');
  });

  it('昨天', () => {
    expect(formatDue(local(2026, 9, 24), now)).toBe('昨天');
  });

  it('🔴 过期用"拖了多久"表述，不用日期', () => {
    // 过期任务最关键的信息是"拖了几天"，不是"哪天到期"。
    expect(formatDue(local(2026, 9, 22), now)).toBe('已过期 3 天');
  });

  it('一周内用"N 天后"', () => {
    expect(formatDue(local(2026, 9, 30), now)).toBe('5 天后');
  });

  it('超过一周用具体日期', () => {
    expect(formatDue(local(2026, 10, 20), now)).toBe('10月20日');
  });

  it('恰好 7 天仍用"N 天后"（边界）', () => {
    expect(formatDue(local(2026, 10, 2), now)).toBe('7 天后');
  });

  it('恰好 8 天改用日期（边界）', () => {
    expect(formatDue(local(2026, 10, 3), now)).toBe('10月3日');
  });
});

describe('formatToday', () => {
  it('输出「M月D日 星期X」', () => {
    // 2026-09-25 是星期五
    expect(formatToday(local(2026, 9, 25))).toBe('9月25日 星期五');
  });

  it('星期日', () => {
    // 2026-09-27 是星期日
    expect(formatToday(local(2026, 9, 27))).toBe('9月27日 星期日');
  });

  it('个位数月份与日期不加前导零', () => {
    expect(formatToday(local(2026, 1, 5))).toBe('1月5日 星期一');
  });
});

describe('isOverdue', () => {
  const now = local(2026, 9, 25, 10, 0);

  it('今天到期不算过期', () => {
    expect(isOverdue(local(2026, 9, 25, 1, 0), now)).toBe(false);
  });

  it('昨天算过期', () => {
    expect(isOverdue(local(2026, 9, 24, 23, 59), now)).toBe(true);
  });

  it('明天不算', () => {
    expect(isOverdue(local(2026, 9, 26), now)).toBe(false);
  });
});

describe('DAY_MS', () => {
  it('是对的一天毫秒数', () => {
    expect(DAY_MS).toBe(86_400_000);
  });
});