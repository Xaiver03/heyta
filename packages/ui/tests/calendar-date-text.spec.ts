/**
 * 日历的日期措辞 —— **共享层负责的是"要哪个 key、传什么参数"**
 * =================================================================
 *
 * ## 🔴 为什么这里断言的不是"最终那句话"
 *
 * 这些话在两端显示成中文还是英文，取决于**宿主的词条表** —— 而 `packages/ui`
 * **刻意不依赖 `@heyta/i18n`**（引它会拖进第二份 React，语言切换在这个组件里
 * 会静默失效）。所以这里注入一个**记账用的假 `t`**：它不翻译，只记下
 * "被问了哪个 key、带了哪些参数"。
 *
 * 那"最终那句对不对"由谁管？—— `check:ui-language`：
 * 它扫全部词条与真实渲染，要求中文含汉字、英文不含汉字、两侧 key 集合相等。
 * 两边各管一段，**不重复**。
 *
 * ## 这些断言各自防什么
 *
 * | 断言 | 它防的失效 |
 * |---|---|
 * | 月份走 `common.date.monthTitle` 且带 `year`/`month` | 有人改成自己拼字符串，于是英文界面漏出「2026年9月」 |
 * | 1..12 而不是 0..11 | `Date.getMonth()` 是 0 基；忘了 +1 会让 12 月显示成 11 月 |
 * | 星期名走 `common.weekday.*` | 有人图省事写成中文常量 |
 * | **周日排在一周最后** | 把 0 当周日 ⇒ 整个日历**整体错位一格**，而错位后看起来仍像正常日历 |
 */

import { describe, expect, it } from 'vitest';

import {
  formatDayTitleText,
  formatMonthTitleText,
  WEEKDAY_MESSAGE_KEYS,
  type CalendarDateKey,
} from '../src/calendar/date-text.js';

interface Recorded {
  readonly key: CalendarDateKey;
  readonly vars: Record<string, string | number> | undefined;
}

/** 记账用的假 `t`：不翻译，只记录被问了什么。 */
function recorder(): { t: (k: CalendarDateKey, v?: Record<string, string | number>) => string; calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    t: (key, vars) => {
      calls.push({ key, vars });
      // 返回一个可辨认的占位，方便断言"最终串里带上了那个星期名"。
      return `[${key}]`;
    },
  };
}

describe('formatMonthTitleText', () => {
  it('要 `common.date.monthTitle`，并带上 **1..12** 的月份（不是 `getMonth()` 的 0..11）', () => {
    const { t, calls } = recorder();
    formatMonthTitleText('2026-09-01', t);
    expect(calls[0]?.key).toBe('common.date.monthTitle');
    expect(calls[0]?.vars).toEqual({ year: 2026, month: 9 });

    const dec = recorder();
    formatMonthTitleText('2026-12-01', dec.t);
    // 12 月必须是 12：`getMonth()` 给 11，忘了 +1 会让 12 月显示成 11 月 ——
    // 而"少一个月"在跨年时才会被人注意到。
    expect(dec.calls[0]?.vars).toEqual({ year: 2026, month: 12 });

    const jan = recorder();
    formatMonthTitleText('2026-01-01', jan.t);
    expect(jan.calls[0]?.vars, '1 月不能变成 0 月').toEqual({ year: 2026, month: 1 });
  });
});

describe('formatDayTitleText', () => {
  it('要 `common.date.dayTitle`，带上 month/day，且星期名**也是走词条**的', () => {
    const { t, calls } = recorder();
    // 2026-09-25 是周五。
    const out = formatDayTitleText('2026-09-25', t);
    const day = calls.find((c) => c.key === 'common.date.dayTitle');
    expect(day?.vars).toEqual({ month: 9, day: 25, weekday: '[common.weekday.fri]' });
    // 星期名被单独问过一次（不是硬编码字符串拼进去的）。
    expect(calls.some((c) => c.key === 'common.weekday.fri')).toBe(true);
    expect(out).toBe('[common.date.dayTitle]');
  });

  it('🔴 周日走 `common.weekday.sun`（`isoWeekday` 里 7 才是周日）', () => {
    const { t, calls } = recorder();
    // 2026-09-27 是周日。若误把 0 当周日，这里会问成周一。
    formatDayTitleText('2026-09-27', t);
    expect(calls.some((c) => c.key === 'common.weekday.sun')).toBe(true);
    expect(calls.some((c) => c.key === 'common.weekday.mon')).toBe(false);
  });
});

describe('WEEKDAY_MESSAGE_KEYS', () => {
  it('🔴 列头是**周一到周日**，与领域层 `monthGrid` 的开头一致', () => {
    // 手写数组写成周日开头的话，整个日历会**整体错位一格** ——
    // 而错位后的界面看上去仍然像个正常日历，没人会一眼发现。
    expect([...WEEKDAY_MESSAGE_KEYS]).toEqual([
      'common.weekday.mon',
      'common.weekday.tue',
      'common.weekday.wed',
      'common.weekday.thu',
      'common.weekday.fri',
      'common.weekday.sat',
      'common.weekday.sun',
    ]);
  });

  it('列头**顺序**与领域层 `WEEKDAY_LABELS` 对得上（两处各写一份时最容易漂的就是它）', async () => {
    const { WEEKDAY_LABELS } = await import('@heyta/domain');
    const { t } = recorder();
    // 词条名的英文缩写与领域层的中文单字各自独立，所以这里比的是**长度与顺序**：
    // 两条都必须是 7 项，且第 0 项是"周一"、第 6 项是"周日"。
    expect(WEEKDAY_MESSAGE_KEYS).toHaveLength(WEEKDAY_LABELS.length);
    expect(WEEKDAY_LABELS[0]).toBe('一');
    expect(WEEKDAY_LABELS[6]).toBe('日');
    expect(t(WEEKDAY_MESSAGE_KEYS[0]!)).toBe('[common.weekday.mon]');
    expect(t(WEEKDAY_MESSAGE_KEYS[6]!)).toBe('[common.weekday.sun]');
  });
});
