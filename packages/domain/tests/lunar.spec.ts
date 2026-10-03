import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { diffDays } from '../src/date.js';
import {
  daysInLunarMonth,
  leapMonthOf,
  lunarNewYear,
  lunarToSolar,
  nextLunarOccurrence,
  normalizeLeapMonth,
  qingming,
  solarToLunar,
  type LunarDate,
} from '../src/lunar.js';
import { LUNAR_YEAR_MAX, LUNAR_YEAR_MIN } from '../src/generated/lunar-year.generated.js';

/**
 * 农历换算层
 * ==========
 *
 * 这个文件的用例分三类，**缺一不可**，因为历法错的形态是"差一天"：
 *
 * 1. **钉死的日子**（下面的 `ANCHORS`）—— 公历↔农历双向都按它们校。
 *    这些是独立于本仓库代码的知识（春节/端午/中秋/清明的公历日、以及闰哪个月），
 *    写死在这里的价值是：算法改了、表重算了、编码位序换了，只要挪动其中任何一格，
 *    这里就会红。
 * 2. **与国务院公告对账**（`公告里的农历节日`）—— 用 `scripts/vendor/holiday-cn/`
 *    里那 20 份公告，逐条把公告的放假日期换算回农历，断言月日确实是那个节日。
 *    这是**两个独立来源互证**：公告不关心农历怎么算，月表不关心谁放假。
 * 3. **全区间往返自洽**（`逐日往返`）—— 1901-01-01 到 2100-12-31 每一天都
 *    `lunarToSolar(solarToLunar(d)) === d`。它盖住的是锚点盖不到的槽位：
 *    一个只影响"九月之后"的 bit 错，春节/端午/中秋一个都不会挪。
 */

const ANCHORS: { solar: string; lunar: LunarDate }[] = [
  { solar: '2023-01-22', lunar: { year: 2023, month: 1, day: 1, leap: false } }, // 春节
  { solar: '2024-02-10', lunar: { year: 2024, month: 1, day: 1, leap: false } },
  { solar: '2025-01-29', lunar: { year: 2025, month: 1, day: 1, leap: false } },
  { solar: '2026-02-17', lunar: { year: 2026, month: 1, day: 1, leap: false } },
  { solar: '2024-06-10', lunar: { year: 2024, month: 5, day: 5, leap: false } }, // 端午
  { solar: '2025-05-31', lunar: { year: 2025, month: 5, day: 5, leap: false } },
  { solar: '2021-06-14', lunar: { year: 2021, month: 5, day: 5, leap: false } },
  { solar: '2024-09-17', lunar: { year: 2024, month: 8, day: 15, leap: false } }, // 中秋
  { solar: '2025-10-06', lunar: { year: 2025, month: 8, day: 15, leap: false } },
  // 除夕：农历腊月最后一天，年份要落在**上一个**农历年（这正是跨年那段最容易错的地方）
  { solar: '2025-01-28', lunar: { year: 2024, month: 12, day: 29, leap: false } },
  // 闰月：2023 闰二月、2025 闰六月
  { solar: '2023-03-22', lunar: { year: 2023, month: 2, day: 1, leap: true } },
  { solar: '2025-07-25', lunar: { year: 2025, month: 6, day: 1, leap: true } },
  // 1984 年那个朔望月同时含冬至与大寒 —— 用月序计数器而不是"中气→月序"映射表才不错
  { solar: '1984-02-02', lunar: { year: 1984, month: 1, day: 1, leap: false } },
  // 🔴 「2033 问题」：随包取闰十一月（与紫金山天文台口径一致）。这一格钉的是**判定**，
  //    改生成器的话这里会红，逼着回来写清理由。
  { solar: '2033-12-22', lunar: { year: 2033, month: 11, day: 1, leap: true } },
  // 两个独立实现差一天、按公开日历取随包那一份的两年（登记在生成器里）
  { solar: '1988-02-17', lunar: { year: 1988, month: 1, day: 1, leap: false } },
  { solar: '2030-02-03', lunar: { year: 2030, month: 1, day: 1, leap: false } },
];

describe('农历↔公历：钉死的锚点', () => {
  it.each(ANCHORS)('$solar ↔ $lunar', ({ solar, lunar }) => {
    expect(lunarToSolar(lunar)).toBe(solar);
    expect(solarToLunar(solar)).toEqual(lunar);
  });

  it('锚点覆盖到的农历年里，正月初一确实等于该年春节', () => {
    for (const year of [2023, 2024, 2025, 2026, 1984]) {
      expect(lunarNewYear(year)).toBe(lunarToSolar({ year, month: 1, day: 1, leap: false }));
    }
  });

  it('闰月只有列出的那几年，且月序与常识一致', () => {
    expect(leapMonthOf(2023)).toBe(2);
    expect(leapMonthOf(2025)).toBe(6);
    expect(leapMonthOf(2020)).toBe(4);
    expect(leapMonthOf(2024)).toBe(0); // 无闰月
    expect(leapMonthOf(2026)).toBe(0);
  });

  it('闰月查询要求该年真的有这个闰月', () => {
    // 2024 没有闰二月：问它必须炸，而不是安静回一个正常二月的长度
    expect(() => daysInLunarMonth(2024, 2, true)).toThrow(/没有闰/);
    expect(daysInLunarMonth(2023, 2, true)).toBe(29);
    expect(daysInLunarMonth(2023, 2, false)).toBe(30);
  });

  it('农历日不存在于该月时响亮失败，不进位到下一个历月', () => {
    // 2024 年腊月只有 29 天（2025-01-28 是除夕），所以"腊月三十"根本不存在
    expect(daysInLunarMonth(2024, 12, false)).toBe(29);
    expect(() => lunarToSolar({ year: 2024, month: 12, day: 30, leap: false })).toThrow(
      /只有 29 天/,
    );
  });

  it('月序/日越界都不接受', () => {
    expect(() => lunarToSolar({ year: 2024, month: 13, day: 1, leap: false })).toThrow(/非法农历月/);
    expect(() => lunarToSolar({ year: 2024, month: 0, day: 1, leap: false })).toThrow(/非法农历月/);
    expect(() => lunarToSolar({ year: 2024, month: 1, day: 0, leap: false })).toThrow(/非法农历日/);
  });
});

describe('清明（太阳黄经 15°）', () => {
  it.each([
    ['2023-04-05', 2023],
    ['2024-04-04', 2024],
    ['2025-04-04', 2025],
    ['2026-04-05', 2026],
  ])('%s', (expected, year) => {
    expect(qingming(year)).toBe(expected);
  });

  it('表区间外不接受', () => {
    expect(() => qingming(LUNAR_YEAR_MIN - 1)).toThrow(/清明表只覆盖/);
    expect(() => qingming(LUNAR_YEAR_MAX + 1)).toThrow(/清明表只覆盖/);
  });
});

// ───────────────── 与公告对账（两个独立来源互证）─────────────────
const VENDOR_DIR = '../../../scripts/vendor/holiday-cn';

function readAnnouncement(year: number) {
  const raw = readFileSync(new URL(`${VENDOR_DIR}/${year}.json`, import.meta.url), 'utf8');
  return JSON.parse(raw) as {
    year: number;
    papers: string[];
    days: { name: string; date: string; isOffDay: boolean }[];
  };
}

/** 公告里带农历日月的节日：名字 → 期望的农历月日。 */
const LUNAR_FESTIVAL_IN_ANNOUNCEMENT: { alias: string; month: number; day: number }[] = [
  { alias: '春节', month: 1, day: 1 },
  { alias: '端午节', month: 5, day: 5 },
  { alias: '中秋节', month: 8, day: 15 },
];

describe('公告里的农历节日：把放假日换算回农历，月日必须对得上', () => {
  const years = [2008, 2012, 2016, 2020, 2021, 2023, 2024, 2025, 2026];

  it.each(years)('%i 年', (year) => {
    const announcement = readAnnouncement(year);
    let matched = 0;
    for (const festival of LUNAR_FESTIVAL_IN_ANNOUNCEMENT) {
      // 合并放假时名字是「国庆节、中秋节」这类，按顿号拆开逐段匹配
      const dates = announcement.days
        .filter((d) => d.isOffDay && d.name.split('、').map((s) => s.trim()).includes(festival.alias))
        .map((d) => d.date);
      if (dates.length === 0) continue;
      matched++;
      // 该节日当天必须能在放假集合里被找回来（换算回农历后月日相符）。
      // 不能直接取 dates[0]：近年公告的春节假期常从**除夕**起算，那是农历上一年的最后一天。
      const hit = dates.find((d) => {
        const lunar = solarToLunar(d);
        return lunar.month === festival.month && lunar.day === festival.day && !lunar.leap;
      });
      expect(hit, `${year} 年公告里「${festival.alias}」的放假集合 ${dates.join()} 没有 ${festival.month}-${festival.day}`).toBeDefined();
    }
    // 🔴 分母：一年至少要对上两个农历节日。公告改了措辞、或某年的数据整块缺失时，
    //    "零条不一致"会变成一次空过。
    expect(matched).toBeGreaterThanOrEqual(2);
  });

  it('公告年份确实读到了（防止路径写错导致整套空过）', () => {
    const announcement = readAnnouncement(2026);
    expect(announcement.days.length).toBeGreaterThan(20);
    expect(announcement.papers.every((p) => p.startsWith('https://www.gov.cn/'))).toBe(true);
  });
});

describe('逐日往返：1901-01-01 → 2100-12-31', () => {
  it('每一天都能算出去、再算回来，且月日在合法范围内', () => {
    // 这覆盖的是**公告与锚点都盖不到**的那些历月：一个只影响"九月之后"的 bit 错，
    // 春节/端午/中秋一个都不会挪，只有逐日往返抓得住。
    let checked = 0;
    let day = new Date(Date.UTC(1901, 0, 1));
    const end = new Date(Date.UTC(LUNAR_YEAR_MAX + 1, 0, 1));
    while (day < end) {
      const iso = day.toISOString().slice(0, 10);
      const lunar = solarToLunar(iso);
      expect(lunar.month).toBeGreaterThanOrEqual(1);
      expect(lunar.month).toBeLessThanOrEqual(12);
      expect(lunar.day).toBeGreaterThanOrEqual(1);
      expect(lunar.day).toBeLessThanOrEqual(daysInLunarMonth(lunar.year, lunar.month, lunar.leap));
      expect(lunarToSolar(lunar)).toBe(iso);
      checked++;
      day = new Date(day.getTime() + 86_400_000);
    }
    // 分母 = 200 年 × 365.2425 ≈ 73050 天；少一块说明循环被截断了
    expect(checked).toBeGreaterThan(73_000);
  });

  it('表区间外的日子响亮失败，不给近似值', () => {
    expect(() => solarToLunar(`${LUNAR_YEAR_MAX + 1}-06-01`)).toThrow(/落在农历 \d+ 年表之外/);
    expect(() => solarToLunar(`${LUNAR_YEAR_MIN - 1}-06-01`)).toThrow(/超出随包农历区间/);
    // 但"公历年份超出区间"**不等于**算不出：农历 2100 年的腊月铺到公历 2101 年 1 月。
    const carried = solarToLunar('2101-01-15');
    expect(carried.year).toBe(LUNAR_YEAR_MAX);
    expect(lunarToSolar(carried)).toBe('2101-01-15');
  });

  // 🔴 这一组是变异验证（M6「删掉年份区间守卫」）照出来的缺口：
  //    原来只有 solarToLunar 有越界用例，把守卫删掉后 lunarToSolar / 月长 / 正月初一
  //    全都读 `LUNAR_YEAR_TABLE[undefined]` 而不报错 —— 那正是"表坏了但没人知道"的形状。
  it('每个入口函数各自守住区间，不止 solarToLunar', () => {
    const out = LUNAR_YEAR_MAX + 1;
    expect(() => lunarToSolar({ year: out, month: 1, day: 1, leap: false })).toThrow(/超出随包月表区间/);
    expect(() => daysInLunarMonth(out, 1)).toThrow(/超出随包月表区间/);
    expect(() => leapMonthOf(out)).toThrow(/超出随包月表区间/);
    expect(() => lunarNewYear(out)).toThrow(/超出随包月表区间/);
    expect(() => lunarToSolar({ year: LUNAR_YEAR_MIN - 1, month: 1, day: 1, leap: false })).toThrow(
      /超出随包月表区间/,
    );
    // 锚点年份本身很老（生日 1900 年）不影响"下一次"—— 它从今天所在的农历年往后找
    expect(nextLunarOccurrence({ year: 1899, month: 1, day: 1, leap: false }, '1950-06-01')).toBe(
      lunarNewYear(1951),
    );
  });
});

describe('闰月锚点：逢闰过正', () => {
  it('归一化把闰 X 月换成正 X 月，并且幂等', () => {
    const leap: LunarDate = { year: 2020, month: 4, day: 15, leap: true };
    const normal = normalizeLeapMonth(leap);
    expect(normal).toEqual({ year: 2020, month: 4, day: 15, leap: false });
    expect(normalizeLeapMonth(normal)).toEqual(normal);
  });

  it('闰五月生日在没有闰五月的年份过到正五月，不会两三年没有日子', () => {
    // 2020 有闰四月；2021–2023 没有闰四月 ⇒ 锚点必须年年都落到正四月十二
    const anchor: LunarDate = { year: 2020, month: 4, day: 12, leap: true };
    for (const from of ['2021-01-01', '2022-01-01', '2023-01-01']) {
      const next = nextLunarOccurrence(anchor, from);
      const lunar = solarToLunar(next);
      expect(lunar).toEqual({ year: lunar.year, month: 4, day: 12, leap: false });
      // 🔴 这条才是"逢闰过正"的产品意义：一年之内必有日子可过。
      //    只断言月日，"下一次"跑到三年后也一样绿。
      expect(next >= from).toBe(true);
      expect(diffDays(from, next) + 1).toBeLessThanOrEqual(366);
      // 而且过的那一年确实没有闰四月 —— 归一化不是"随便挑一个月"
      expect(leapMonthOf(lunar.year)).not.toBe(4);
    }
    // 钉一个具体日子（2021 正四月十二）：它由同一年公告里的端午反证链推出来 ——
    // 2021-06-14 是五月初五（公告，见下面对账用例），四月三十 ⇒ 四月初一 = 05-12。
    expect(nextLunarOccurrence(anchor, '2021-01-01')).toBe('2021-05-23');
  });

  it('下一次发生日可以正好是今天（含）', () => {
    const today = lunarToSolar({ year: 2026, month: 8, day: 15, leap: false });
    expect(nextLunarOccurrence({ year: 2001, month: 8, day: 15, leap: false }, today)).toBe(today);
  });

  it('该月没有那一天时退到该月最后一天，而不是跳到下一个历月', () => {
    // 找一个"锚点是三十、当年该月只有 29 天"的年份：2029 年五月只有 29 天则成立，
    // 断言按数据来（不写死年），但行为必须是"落在同月最后一天"。
    const month = 5;
    let year = 2025;
    while (daysInLunarMonth(year, month, false) === 30) year++;
    const len = daysInLunarMonth(year, month, false);
    expect(len).toBe(29);
    const next = nextLunarOccurrence({ year: 2000, month, day: 30, leap: false }, `${year}-01-01`);
    const lunar = solarToLunar(next);
    expect(lunar.month).toBe(month);
    expect(lunar.day).toBe(29);
  });

  it('锚点在区间末端算不出下一次时响亮失败', () => {
    expect(() =>
      nextLunarOccurrence({ year: 2000, month: 1, day: 1, leap: false }, `${LUNAR_YEAR_MAX}-12-31`),
    ).toThrow(/之后没有发生日/);
  });
});
