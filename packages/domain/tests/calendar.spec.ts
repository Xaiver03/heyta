/**
 * 月历数学测试
 * =============
 *
 * 🔴 这个文件存在的理由：月历是**最容易悄悄错一天**的那类代码。
 *
 * 三个真实的坑，都属于"看起来对、跑起来也像对"：
 *
 *   1. **翻转月份时"日"会溢出。** `2026-01-31` 加一个月，朴素的 `setMonth(+1)`
 *      得到 `2026-03-03` —— 2 月没有 31 日，多出来的 3 天溢到 3 月。
 *      用户的感受是"点下个月，跳过了 2 月"，而且他不会觉得这是 bug，
 *      只会觉得这个应用怪。
 *   2. **闰年不能自己写规则。** `%4` 那一套漏掉世纪闰年（2000 是闰年、1900 不是）。
 *   3. **网格对齐错一格**会让"周几"整体偏一天 —— 用户按日历安排事情，
 *      错一天等于安排到错误的日子上。这类错**只有靠外部可核对的证据**才能确认。
 *
 * 所以下面的断言刻意分成两种：
 *   - **结构性质**（任意月份都成立，改实现也不该崩）；
 *   - **一个外部核对过的锚点**（2026-09-26 是星期六 —— 这不是我算出来的，
 *     是从移动端真机验收的界面 dump 里读到的 `9月26日 星期六`）。
 *     结构性质证明"自洽"，锚点证明"自洽的那套没整体偏一天"。**两个都需要。**
 */

import { describe, expect, it } from 'vitest';

import {
  DAYS_PER_WEEK,
  WEEKDAY_LABELS,
  addMonths,
  daysInMonth,
  formatCompactDate,
  formatDayTitle,
  formatMonthTitle,
  isoWeekday,
  monthGrid,
  parseLocalDate,
  startOfMonth,
  startOfWeek,
  toLocalDate,
  weekGrid,
} from '../src/date.js';

describe('parseLocalDate（格式**和**范围都要校验）', () => {
  it('合法的本地日期解析成本地零点', () => {
    const d = parseLocalDate('2026-09-26');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // 0-based
    expect(d.getDate()).toBe(26);
    expect(d.getHours()).toBe(0);
  });

  it('闰年的 2 月 29 日是合法的', () => {
    expect(parseLocalDate('2024-02-29').getDate()).toBe(29);
  });

  it('格式不对就抛错', () => {
    for (const bad of ['not-a-date', '2026-09', '2026/09/26', '2026-九月-26', '']) {
      expect(() => parseLocalDate(bad), bad).toThrow();
    }
  });

  it('🔴 月/日越界必须抛错，不能自动进位', () => {
    // `new Date(2026, 12, 40)` 不报错 —— 它安静地变成 2027-02-09。
    // 实测踩到：`node-host add --due 2026-13-40` 建出了一个截止到
    // 2027-02-09 的任务，退出码 0，输出还回显着用户写的那串字符。
    // 「输入非法 → 结果合法但错误」比直接崩掉危险得多。
    expect(() => parseLocalDate('2026-13-40')).toThrow(/不存在/);
    expect(() => parseLocalDate('2026-13-01')).toThrow(/不存在/);
    expect(() => parseLocalDate('2026-00-10')).toThrow(/不存在/);
    expect(() => parseLocalDate('2026-09-31')).toThrow(/不存在/);
    expect(() => parseLocalDate('2026-09-00')).toThrow(/不存在/);
  });

  it('🔴 平年的 2 月 29 / 30 必须抛错（闰年规则不能被绕过）', () => {
    expect(() => parseLocalDate('2026-02-29')).toThrow(/不存在/);
    expect(() => parseLocalDate('2026-02-30')).toThrow(/不存在/);
    // 世纪闰年：1900 不是闰年 —— 自己写 `%4` 的那套会在这里放进 2 月 29 日
    expect(() => parseLocalDate('1900-02-29')).toThrow(/不存在/);
  });

  it('🔴 进位检测不能误伤合法日期（回读校验的三个条件都要对）', () => {
    // 只比对"日期"会漏掉跨月进位；只比对"月份"会漏掉跨年。
    // 这里逐项钉住几个本该通过的边界。
    for (const ok of ['2026-01-01', '2026-12-31', '2024-02-29', '2026-04-30']) {
      expect(() => parseLocalDate(ok), ok).not.toThrow();
    }
  });
});

describe('daysInMonth', () => {
  it('平年与闰年的二月', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('🔴 世纪闰年规则：2000 是闰年，1900 不是', () => {
    // 自己写 `year % 4 === 0` 会在 1900 上错。这里断言的是原生 Date 的行为，
    // 也就是我们**确实**把这件事交给了平台，而不是自己实现了一套。
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it('大小月', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 1)).toBe(31);
  });
});

describe('startOfMonth', () => {
  it('归到当月 1 号', () => {
    expect(startOfMonth('2026-09-26')).toBe('2026-09-01');
    expect(startOfMonth('2026-09-01')).toBe('2026-09-01');
  });

  it('跨年也对', () => {
    expect(startOfMonth('2026-01-15')).toBe('2026-01-01');
  });
});

describe('addMonths', () => {
  it('普通情况只是换月', () => {
    expect(addMonths('2026-09-15', 1)).toBe('2026-10-15');
    expect(addMonths('2026-09-15', -1)).toBe('2026-08-15');
  });

  it('跨年', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('🔴 1 月 31 日加一个月**必须落在 2 月**，不能溢出到 3 月', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    // 闰年则夹到 29 号
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('🔴 3 月 31 日减一个月同样夹住', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-05-31', -1)).toBe('2026-04-30');
  });

  it('加回一个月不会"找回"被夹掉的那一天（这是刻意的）', () => {
    // 1-31 → 2-28 → 3-28。用户如果期待 3-31，那是"记住原始日"的另一种设计；
    // 这里明确选择**不记住**，因为记住会让"我到底选了哪天"变得不可预测。
    expect(addMonths(addMonths('2026-01-31', 1), 1)).toBe('2026-03-28');
  });

  it('加 0 个月不动', () => {
    expect(addMonths('2026-09-26', 0)).toBe('2026-09-26');
  });
});

describe('monthGrid', () => {
  it('固定 6 行 × 7 列 = 42 格', () => {
    for (const month of ['2026-01-01', '2026-02-01', '2026-09-01', '2026-11-01']) {
      const grid = monthGrid(month);
      expect(grid).toHaveLength(6);
      for (const week of grid) expect(week).toHaveLength(DAYS_PER_WEEK);
      expect(grid.flat()).toHaveLength(42);
    }
  });

  it('每行都是"周一到周日"', () => {
    const grid = monthGrid('2026-09-01');
    for (const week of grid) {
      expect(isoWeekday(week[0]!.date)).toBe(1); // 周一
      expect(isoWeekday(week[6]!.date)).toBe(7); // 周日
    }
  });

  it('42 格是连续的日子', () => {
    const cells = monthGrid('2026-09-01').flat();
    for (let i = 1; i < cells.length; i += 1) {
      // 后一格 = 前一格 +1 天
      const prev = cells[i - 1]!.date;
      expect(cells[i]!.date).toBe(addDaysViaGrid(prev));
    }
  });

  it('当月每一天恰好出现一次，且 inMonth 只标在当月', () => {
    const cells = monthGrid('2026-09-01').flat();
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(30); // 9 月 30 天
    expect(inMonth[0]!.date).toBe('2026-09-01');
    expect(inMonth[inMonth.length - 1]!.date).toBe('2026-09-30');
    // 不重不漏
    expect(new Set(inMonth.map((c) => c.date)).size).toBe(30);
  });

  it('🔴 锚点：2026-09-26 是星期六（来自真机界面 dump，不是我算的）', () => {
    // 这条用来证明"整个网格没有整体偏一天"。
    // 结构性质只能证明自洽 —— 一个整体偏移一天的实现同样自洽。
    expect(isoWeekday('2026-09-26')).toBe(6);
  });

  it('🔴 锚点：2026 年 9 月的网格从 8-31（周一）开始', () => {
    // 9-01 是周二 → 前面补 1 格 → 补的那格是周一，也就是 8-31。
    const cells = monthGrid('2026-09-01').flat();
    expect(cells[0]!.date).toBe('2026-08-31');
    expect(cells[0]!.inMonth).toBe(false);
    expect(cells[1]!.date).toBe('2026-09-01');
    expect(cells[1]!.inMonth).toBe(true);
  });

  it('补白格带**真实日期**，所以可点选（不是 null）', () => {
    const cells = monthGrid('2026-09-01').flat();
    const blanks = cells.filter((c) => !c.inMonth);
    expect(blanks.length).toBeGreaterThan(0);
    for (const blank of blanks) {
      expect(blank.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('🔴 月初正好是周一时不需要前置补白', () => {
    // 2026-06-01 是周一
    expect(isoWeekday('2026-06-01')).toBe(1);
    const cells = monthGrid('2026-06-01').flat();
    expect(cells[0]!.date).toBe('2026-06-01');
    expect(cells[0]!.inMonth).toBe(true);
  });

  it('🔴 月初是周日时要补 6 格（最容易错成补 0 或补 7 的边界）', () => {
    // 2026-02-01 是周日
    expect(isoWeekday('2026-02-01')).toBe(7);
    const cells = monthGrid('2026-02-01').flat();
    expect(cells[0]!.date).toBe('2026-01-26');
    expect(cells[0]!.inMonth).toBe(false);
    expect(cells[6]!.date).toBe('2026-02-01');
    expect(cells[6]!.inMonth).toBe(true);
  });

  it('传哪一天都行，不只接受 1 号', () => {
    expect(monthGrid('2026-09-26').flat()[1]!.date).toBe('2026-09-01');
  });
});

describe('startOfWeek / weekGrid（R11 批三：周视图的那一行）', () => {
  it('🔴 与 monthGrid **同一套**周一计算 —— 两套实现迟早漂一天', () => {
    // 周视图那一行必须**逐格等于**月视图里包含这一天的那一行。
    // 各自实现一遍"周一起"的话，偏移一天不会让任何一端报错，
    // 只会让同一个日子在两个视图里落到不同的列。
    for (const d of ['2026-09-01', '2026-09-26', '2026-10-03', '2026-11-01', '2026-02-01']) {
      const row = monthGrid(d).find((w) => w.some((c) => c.date === d))!;
      expect(weekGrid(d).map((c) => c.date)).toEqual(row.map((c) => c.date));
    }
  });

  it('恰好 7 格、周一起周日止、日子连续', () => {
    const cells = weekGrid('2026-10-03');
    expect(cells).toHaveLength(DAYS_PER_WEEK);
    expect(isoWeekday(cells[0]!.date)).toBe(1);
    expect(isoWeekday(cells[6]!.date)).toBe(7);
    for (let i = 1; i < cells.length; i += 1) {
      expect(cells[i]!.date).toBe(addDaysViaGrid(cells[i - 1]!.date));
    }
  });

  it('锚点：2026-09-26（周六）那一周是 09-21 到 09-27', () => {
    expect(startOfWeek('2026-09-26')).toBe('2026-09-21');
    expect(weekGrid('2026-09-26').map((c) => c.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
  });

  it('同一周里传哪一天都给出**同一行**', () => {
    const first = weekGrid('2026-09-21');
    for (const d of ['2026-09-22', '2026-09-24', '2026-09-27']) {
      expect(weekGrid(d).map((c) => c.date)).toEqual(first.map((c) => c.date));
    }
  });

  it('🔴 跨月周：inMonth 的参照是**锚点那个月**，不是周一那个月', () => {
    // 2026-10-26 周一 … 2026-11-01 周日 是同一周。
    // 锚点 10-30（在 10 月里）⇒ 前十月的六天 inMonth，11-01 不是。
    expect(weekGrid('2026-10-30').map((c) => `${c.date}:${String(c.inMonth)}`)).toEqual([
      '2026-10-26:true',
      '2026-10-27:true',
      '2026-10-28:true',
      '2026-10-29:true',
      '2026-10-30:true',
      '2026-10-31:true',
      '2026-11-01:false',
    ]);
    // 反过来锚点 11-01（周日，同一周）⇒ 只有它自己算"本月"。
    // 这两半合起来才钉住"参照跟着锚点走"：只钉上面那半，
    // 写成"永远跟着周一那个月"也会通过。
    expect(weekGrid('2026-11-01').map((c) => `${c.date}:${String(c.inMonth)}`)).toEqual([
      '2026-10-26:false',
      '2026-10-27:false',
      '2026-10-28:false',
      '2026-10-29:false',
      '2026-10-30:false',
      '2026-10-31:false',
      '2026-11-01:true',
    ]);
  });

  it('startOfWeek 幂等（对已经是周一的那天不动）', () => {
    expect(startOfWeek('2026-09-21')).toBe('2026-09-21');
    expect(startOfWeek(startOfWeek('2026-10-03'))).toBe(startOfWeek('2026-10-03'));
  });
});

describe('formatCompactDate', () => {
  const at = (d: string): number => parseLocalDate(d).getTime();
  const now = at('2026-09-26');

  it('同年只给月日', () => {
    expect(formatCompactDate(at('2026-09-26'), now)).toBe('09-26');
    expect(formatCompactDate(at('2026-01-05'), now)).toBe('01-05');
  });

  it('🔴 跨年必须带上年份', () => {
    // 否则"01-05"在一年的头几天里看不出是哪一年
    expect(formatCompactDate(at('2027-01-05'), now)).toBe('2027-01-05');
    expect(formatCompactDate(at('2025-12-31'), now)).toBe('2025-12-31');
  });

  it('月和日都补前导零', () => {
    expect(formatCompactDate(at('2026-03-07'), now)).toBe('03-07');
  });
});

describe('formatMonthTitle', () => {
  it('中文年月，不带前导零', () => {
    expect(formatMonthTitle('2026-09-01')).toBe('2026年9月');
    expect(formatMonthTitle('2026-12-15')).toBe('2026年12月');
  });
});

describe('formatDayTitle（某一天的标题，只有这一个实现）', () => {
  // 这三条是从 `apps/mobile/tests/date.spec.ts` 的 `formatToday` 用例
  // **迁移**过来的（原函数已删除）—— 先搬用例、再删实现，
  // 这样"删掉的那份其实还有人依赖"会立刻变红，而不是等某个界面上少一行字。
  it('中文月日 + 星期全称，不带前导零', () => {
    expect(formatDayTitle('2026-09-25')).toBe('9月25日 星期五');
    expect(formatDayTitle('2026-09-27')).toBe('9月27日 星期日');
    expect(formatDayTitle('2026-01-05')).toBe('1月5日 星期一');
    expect(formatDayTitle('2026-12-31')).toBe('12月31日 星期四');
  });

  it('🔴 星期名与 `isoWeekday` 一致（1=周一）', () => {
    // 单独钉一次：格式化成"周五"但底层算成周四，是最难从界面看出来的一类错。
    expect(isoWeekday('2026-09-25')).toBe(5);
    expect(formatDayTitle('2026-09-25').endsWith('星期五')).toBe(true);
  });

  it('接受 LocalDate 而不是时间戳 —— 切天的时区不会在这里再发生一次', () => {
    // 同一天的任意时刻都必须得到同一个标题（这正是"传时间戳"会引入的风险）。
    const noon = new Date(2026, 8, 26, 12, 0, 0).getTime();
    const lateNight = new Date(2026, 8, 26, 23, 59, 0).getTime();
    expect(toLocalDate(noon)).toBe('2026-09-26');
    expect(formatDayTitle(toLocalDate(lateNight))).toBe(formatDayTitle('2026-09-26'));
  });
});

describe('WEEKDAY_LABELS（日历列头）', () => {
  it('周一开头，7 个', () => {
    expect([...WEEKDAY_LABELS]).toEqual(['一', '二', '三', '四', '五', '六', '日']);
  });

  it('🔴 与 monthGrid 的首列对齐 —— 列头错一格会让整个日历整体偏一天', () => {
    // 2026-09-01 是周二（外部锚点：真机 dump 读到过 9月26日 星期六）。
    const weeks = monthGrid('2026-09-01');
    // 首行第一个格子必须是"上周日"？不是 —— 周一开头时，9/1（周二）前只补 1 格。
    expect(weeks[0]![0]!.date).toBe('2026-08-31');
    expect(isoWeekday(weeks[0]![0]!.date)).toBe(1);
    // 于是"2026-09-01"落在列下标 1，对应 WEEKDAY_LABELS[1] === '二'
    expect(weeks[0]![1]!.date).toBe('2026-09-01');
    expect(WEEKDAY_LABELS[1]).toBe('二');
  });
});

/** 网格用例里用一次加法，但不直接 import `addDays` —— 免得三处实现互相"证明"。 */
function addDaysViaGrid(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(y!, m! - 1, d! + 1);
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, '0');
  const dd = String(next.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
