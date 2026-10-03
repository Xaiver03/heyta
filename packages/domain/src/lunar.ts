/**
 * 农历（阴阳历）换算
 * ==================
 *
 * 🔴 **这个文件里只有查表和算术，没有天文算法。**
 * 月表由 `scripts/gen-calendar-tables.mjs` 在**构建期**编码成数据随包交付：
 * 数据源是 `lunar-typescript`（只在构建期用，一个字节都不进包 —— 入口字节数与
 * 三条反证的实时分母都由 `scripts/gen-calendar-tables.mjs` 的 `--bundle` / `--verify`
 * 现场打印，这里不抄数字，见 ADR-0044 §5 勘误段）。反证路径：国务院公告对账 +
 * 月长自洽 + 仓库自带 Meeus 实现逐年比对，分歧按年份登记在生成器里。
 *
 * 日界：**东八区民用日，子时换日**（GB/T 33661 口径）。
 * 这就是为什么这里一律走 `LocalDate`（纯日历日）而不是时间戳 ——
 * 出生时刻是否已过 23:00 会决定农历生日是哪天，而 `Date` 的时区语义会把这件事
 * 变成"换台设备结果不一样"。用户输入的是"农历哪天"，不是"哪个瞬间"。
 *
 * ⚠️ **反证边界**：产物只有 `LUNAR_VERIFIED_MIN–LUNAR_VERIFIED_MAX` 这几年被公告独立
 * 反证过（判据：算出的节日日期 ∈ 该年公告的放假集合，见生成器的 `--verify`）。
 * 区间外的年份是算出来的、没有被验证过；界面上不得暗示全区间都被证明。
 */

import { type LocalDate, parseLocalDate } from './date.js';
import { LUNAR_YEAR_MAX, LUNAR_YEAR_MIN, LUNAR_YEAR_TABLE } from './generated/lunar-year.generated.js';
import { QINGMING_APRIL_DAY, QINGMING_YEAR_MAX, QINGMING_YEAR_MIN } from './generated/solar-term.generated.js';

/**
 * 农历日期。`month` 是 1–12 的**月序**，闰月由 `leap` 单独表达
 * （不用负数：负数月序会让"闰五月"在排序、序列化、比较里各写一遍判正负，
 * 而 `leap` 是一个字段一次判）。
 */
export interface LunarDate {
  /** 农历年（数字年，等于该年正月初一所落的公历年）。 */
  year: number;
  /** 月序 1–12。 */
  month: number;
  /** 日 1–30（该历月可能只有 29 天，见 {@link daysInLunarMonth}）。 */
  day: number;
  /** 是否闰月。 */
  leap: boolean;
}

const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];

/** 月表下标；越界与已知算不准的年份都在这里**响亮失败**。 */
function indexOfYear(year: number): number {
  if (!Number.isInteger(year)) throw new Error(`农历年必须是整数：${year}`);
  if (year < LUNAR_YEAR_MIN || year > LUNAR_YEAR_MAX) {
    throw new Error(`农历年 ${year} 超出随包月表区间 ${LUNAR_YEAR_MIN}–${LUNAR_YEAR_MAX}`);
  }
  return year - LUNAR_YEAR_MIN;
}

/**
 * 取某一年打包好的那两个数（`lengths` = 月长 bit + 闰月月序；`newYear` = 正月初一）。
 *
 * 🔴 为什么要包一层，而不是直接 `LUNAR_YEAR_TABLE[i]`：
 *
 * 1. **生产构建会红，测试不会。** 随包表在 `noUncheckedIndexedAccess` 下取到的是
 *    `number | undefined`，`pnpm -r build`（tsup 的 dts 阶段）会报
 *    `TS18048: 'packed' is possibly 'undefined'`，而 `vitest` 直接跑源码时**一个字都不报**。
 *    本仓库在"测试全绿但打不出包"上摔过不止一次，所以这里不留裸下标。
 * 2. 更要紧的是语义：`undefined >> 4` 得到的是 **NaN 而不是异常** ——
 *    表被截断时用户会看到"正月初一 = 2016-NaN-NaN"，而农历日期是**给用户看的答案**，
 *    它坏了不会有任何一层替我们报错。缺项必须**响亮失败**。
 */
function packedOfYear(year: number, which: 'lengths' | 'newYear'): number {
  const value = LUNAR_YEAR_TABLE[indexOfYear(year) * 2 + (which === 'newYear' ? 1 : 0)];
  if (value === undefined) {
    throw new Error(`随包历法表在 ${year} 年处缺项（${which}）—— 生成物被截断或与代码不同步`);
  }
  return value;
}

/** 该农历年的闰月月序（0 = 无闰月）。 */
export function leapMonthOf(year: number): number {
  return packedOfYear(year, 'lengths') & 0xf;
}

/** 从正月初一数的槽位：闰月占一格，所以闰月之后的正常月槽位 +1。 */
function slotIndexOf(year: number, month: number, leap: boolean, leapMonth: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`非法农历月：${month}`);
  }
  if (leap && leapMonth !== month) {
    throw new Error(`${year} 年没有闰${MONTH_NAMES[month - 1]}月`);
  }
  return leapMonth > 0 && (leap || month > leapMonth) ? month : month - 1;
}

function bitsOfYear(year: number): { bits: number; leapMonth: number } {
  const packed = packedOfYear(year, 'lengths');
  return { bits: packed >> 4, leapMonth: packed & 0xf };
}

/** 农历月长（29 或 30 天）。 */
export function daysInLunarMonth(year: number, month: number, leap = false): number {
  const { bits, leapMonth } = bitsOfYear(year);
  return bits & (1 << (12 - slotIndexOf(year, month, leap, leapMonth))) ? 30 : 29;
}

/** 正月初一的公历日。 */
export function lunarNewYear(year: number): LocalDate {
  const packed = packedOfYear(year, 'newYear');
  const y = LUNAR_YEAR_MIN + (packed >> 9);
  const m = ((packed >> 5) & 0xf) + 1;
  const d = packed & 0x1f;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function jdnOf(date: LocalDate): number {
  const d = parseLocalDate(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  // 标准儒略日数公式（整数日历日算术，与时区无关）。
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return (
    day +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  );
}

function dateFromJdn(jdn: number): LocalDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 农历 → 公历。 */
export function lunarToSolar(date: LunarDate): LocalDate {
  const { bits, leapMonth } = bitsOfYear(date.year);
  const lengthOf = (month: number, leap: boolean) =>
    bits & (1 << (12 - slotIndexOf(date.year, month, leap, leapMonth))) ? 30 : 29;

  // 越界要在**入口**判：下面的循环只走到 12 月，月序 13 会一路走穿、
  // 最后落进那句"换算失败"，把"你给的月序不存在"这条信息丢掉。
  if (date.month < 1 || date.month > 12) throw new Error(`非法农历月：${date.month}`);
  if (!Number.isInteger(date.day) || date.day < 1) {
    throw new Error(`非法农历日：${date.day}`);
  }
  let cursor = jdnOf(lunarNewYear(date.year));
  for (let month = 1; month <= 12; month++) {
    const normalLength = lengthOf(month, false);
    if (month === date.month && !date.leap) {
      if (date.day > normalLength) {
        throw new Error(
          `${date.year} 年${MONTH_NAMES[month - 1]}月只有 ${normalLength} 天，没有第 ${date.day} 天`,
        );
      }
      return dateFromJdn(cursor + date.day - 1);
    }
    cursor += normalLength;
    if (month === leapMonth) {
      const leapLength = lengthOf(month, true);
      if (date.leap && month === date.month) {
        if (date.day > leapLength) {
          throw new Error(`${date.year} 年闰${MONTH_NAMES[month - 1]}月只有 ${leapLength} 天`);
        }
        return dateFromJdn(cursor + date.day - 1);
      }
      cursor += leapLength;
    }
  }
  throw new Error(`农历换算失败：${JSON.stringify(date)}`);
}

/** 公历 → 农历。输入必须是随包区间内的日历日。 */
export function solarToLunar(date: LocalDate): LunarDate {
  const target = jdnOf(date);
  const solarYear = Number(date.slice(0, 4));
  if (solarYear < LUNAR_YEAR_MIN || solarYear > LUNAR_YEAR_MAX + 1) {
    throw new Error(`公历 ${date} 超出随包农历区间 ${LUNAR_YEAR_MIN}–${LUNAR_YEAR_MAX + 1}`);
  }
  // 正月初一落在公历 1–2 月，所以年初那段属于**上一个**农历年。
  let year = solarYear > LUNAR_YEAR_MAX ? LUNAR_YEAR_MAX : solarYear;
  if (target < jdnOf(lunarNewYear(year))) year -= 1;
  const { bits, leapMonth } = bitsOfYear(year);
  let cursor = jdnOf(lunarNewYear(year));
  for (let month = 1; month <= 12; month++) {
    const normalLength = bits & (1 << (12 - slotIndexOf(year, month, false, leapMonth))) ? 30 : 29;
    if (target < cursor + normalLength) {
      return { year, month, day: target - cursor + 1, leap: false };
    }
    cursor += normalLength;
    if (month === leapMonth) {
      const leapLength = bits & (1 << (12 - slotIndexOf(year, month, true, leapMonth))) ? 30 : 29;
      if (target < cursor + leapLength) {
        return { year, month, day: target - cursor + 1, leap: true };
      }
      cursor += leapLength;
    }
  }
  // 走到这里说明 target 在该农历年腊月之后，但次年正月初一又没接上 ——
  // 只在月表区间末端发生（2100 年之后没有数据），如实报出来而不是回一个近似值。
  throw new Error(`公历 ${date} 落在农历 ${year} 年表之外（月表区间末端或表坏了）`);
}

/**
 * 「逢闰过正」：闰 X 月的锚点，在**没有**闰 X 月的那些过到正 X 月。
 *
 * 这不是民俗偏好，是**技术必然**（ADR-0044 §2.5）：闰月平均 2–3 年才一次，
 * 如果"闰五月生日只在闰五月过"，用户会连着两三年没有任何一天可过 ——
 * 而界面上没有任何一处解释这件事。
 *
 * 结果永远 `leap: false`，所以它是幂等的：调用方不必先判是不是闰月。
 */
export function normalizeLeapMonth(date: LunarDate): LunarDate {
  return date.leap ? { ...date, leap: false } : date;
}

/**
 * 从 `from`（含）起，下一个与农历锚点同月同日的生活日。
 *
 * 两处必须解释的取舍：
 * 1. **闰月锚点先归一化**（{@link normalizeLeapMonth}）。
 * 2. **该月没有那一天就退到该月最后一天**：锚点写在"腊月三十"，而那一年腊月只有
 *    29 天 ⇒ clamp 到廿九，而不是跳到正月、也不是静默不算。每个农历生日实现都要
 *    面对这一天，选一种并钉住；选错不会崩，只会差一天。
 */
export function nextLunarOccurrence(anchor: LunarDate, from: LocalDate): LocalDate {
  const target = normalizeLeapMonth(anchor);
  const fromYear = solarToLunar(from).year;
  // 从「今天所在的农历年」起往后找：更老的农历年整体都在 from 之前，而锚点自带的
  // 年份（出生年）可能比 from 早几十年 —— 从它开始会白算几十次换算。
  for (let year = fromYear; year <= LUNAR_YEAR_MAX; year++) {
    const day = Math.min(target.day, daysInLunarMonth(year, target.month, false));
    const candidate = lunarToSolar({ ...target, year, day, leap: false });
    if (jdnOf(candidate) >= jdnOf(from)) return candidate;
  }
  throw new Error(
    `农历锚点 ${target.month}-${target.day} 在 ${from} 之后没有发生日（月表只到 ${LUNAR_YEAR_MAX} 年）`,
  );
}

/**
 * 清明（太阳黄经 15°）的公历日。
 *
 * 它是法定假日里唯一既非公历固定日、也非农历日月的，所以随包只带了这一个节气；
 * 其余 23 个今天没有产品消费者（AGENTS §0：不为假设中的需求先建结构）。
 */
export function qingming(year: number): LocalDate {
  if (year < QINGMING_YEAR_MIN || year > QINGMING_YEAR_MAX) {
    throw new Error(`清明表只覆盖 ${QINGMING_YEAR_MIN}–${QINGMING_YEAR_MAX}，给的是 ${year}`);
  }
  const day = QINGMING_APRIL_DAY[year - QINGMING_YEAR_MIN];
  // 与 `packedOfYear` 同一个理由：裸下标在 `noUncheckedIndexedAccess` 下是
  // `number | undefined`，而 `String(undefined)` 会**安静地**产出 `2016-04-undefined`。
  if (day === undefined) {
    throw new Error(`清明表在 ${year} 年处缺项 —— 生成物被截断或与代码不同步`);
  }
  return `${year}-04-${String(day).padStart(2, '0')}`;
}
