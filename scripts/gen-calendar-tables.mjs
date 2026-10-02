#!/usr/bin/env node
/**
 * 构建期生成历法表 → packages/domain/src/generated/
 * =================================================
 *
 * 产出两份产物（都只含**数据**，不含天文算法）：
 * - `lunar-year.generated.ts`  1900–2100 的农历月表（月长 + 闰月 + 正月初一）
 * - `solar-term.generated.ts`  1900–2100 的清明（黄经 15°）落在 4 月几日
 *
 * 🔴 **双源设计（本批最有价值的一条结构决定）**
 *
 * | 角色 | 谁 | 为什么 |
 * |---|---|---|
 * | 产物的数据源 | `lunar-typescript`（**只在构建期用**，devDependency） | 它是主流公开日历的实现，与用户在其他日历里看到的日期一致 |
 * | 独立反证 ① | 本文件自带的 Meeus 算法实现（与数据源零共享代码） | 两个实现分歧的那一天就是证据 |
 * | 独立反证 ② | `scripts/vendor/holiday-cn/` 的国务院公告 | 行政口径：算出的节日必须落进"那几天放假"的集合 |
 *
 * 为什么不让 Meeus 实现当数据源：实测它把 **1988 与 2030 的春节各判错一天** ——
 * 那两个周期的合朔压在东八区子夜 ±11 分钟内，级数截断误差足以判到另一侧。
 * 判错的后果不是崩，是"1988-02-17 出生的人，农历生日显示成腊月三十"，
 * 而那种错永远不会有人归因到历法表。所以：**取与公开日历一致的那一份，
 * 把两源分歧登记成判据**（`--verify` 的反证 ①），而不是装作没有分歧。
 *
 * 为什么运行时不跑算法、只在构建期用一次库：见 ADR-0044 §5 勘误段。`lunar-typescript`
 * 的入口字节数由 `--bundle` 现场打印（不在注释里维护副本），且 `Lunar` 与
 * 八字/佛历/道历/九星强耦合、剥不出农历那一小块 ⇒ **运行时只留数据**，
 * 那 400 KB 量级一个字节都不进包。
 *
 * 为什么只生成清明这一个节气：它是**法定假日里唯一一个非公历固定日、又非农历日月**的
 * （按太阳黄经 15° 定，落在 4/4–4/6）。其余 23 个节气今天没有产品消费者 ——
 * 没有消费者的数据也要长期养，所以不做（AGENTS §0）。
 *
 * 算法依据（公开天文算法；公式是数学，不受著作权保护）：
 * - 合朔：Meeus《Astronomical Algorithms》Ch.49 主周期项，精度约 ±1e-4 日（≈9 秒）。
 * - 太阳视黄经：Meeus Ch.25，精度约 ±1e-4 度。
 * - 中气：黄经为 30° 整数倍（冬至 270、大寒 300、雨水 330、春分 0 …）。
 * - 置闰与月序（GB/T 33661 口径）：**含冬至的朔望月为十一月**；其后各月按所含
 *   中气定序；两个冬至之间若有 13 个朔望月，**第一个无中气的月为闰月**，月序沿用前一月。
 * - 日界：**东八区民用日**，子时换日。
 *
 * 🔴 权威反证的区间由 `scripts/vendor/holiday-cn/` 里实际存在哪几年**推导**，不是写死的：
 *    区间外的年份是"算出来的"，不是"被证明过的" —— 这条边界随产物一起写出去，
 *    界面上不得暗示全区间都被证明。
 *
 * 用法：
 *   node scripts/gen-calendar-tables.mjs            # 生成
 *   node scripts/gen-calendar-tables.mjs --check    # 门禁：两份产物是否与算法一致
 *   node scripts/gen-calendar-tables.mjs --bundle   # 门禁：库只在构建期（import / 声明 / 体积三条臂）
 *   node scripts/gen-calendar-tables.mjs --verify   # 三条反证（公告 / 月长自洽 / 双实现），读产物不重算
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { LunarYear, Solar } from 'lunar-typescript';
import { matchFestivalName, readHolidayYears } from './vendor/holiday-cn/load.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_LUNAR = join(ROOT, 'packages/domain/src/generated/lunar-year.generated.ts');
const OUT_TERMS = join(ROOT, 'packages/domain/src/generated/solar-term.generated.ts');
const SCRIPT_NAME = 'gen-calendar-tables.mjs';

/** 只允许出现在构建期的库（bundle 闸门盯的就是它，见 bundleGate）。 */
const LIB_NAME = 'lunar-typescript';

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

/** 公告数据（构建期输入）。反证区间 = 它实际覆盖的年份，逐条断言见 --verify。 */
const HOLIDAY_YEARS = readHolidayYears();
const VERIFIED_MIN = HOLIDAY_YEARS[0].year;
const VERIFIED_MAX = HOLIDAY_YEARS[HOLIDAY_YEARS.length - 1].year;

const DEG = Math.PI / 180;
const sin = (x) => Math.sin(x * DEG);
const JD_J2000 = 2451545.0;
const BEIJING_OFFSET = 8 / 24;

// ───────────────────────── 日历换算 ─────────────────────────
// ymdToJdn 用的是标准儒略日数公式：返回的是**该天 12:00 UT** 的 JD（整数）。
function ymdToJdn(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** 某民用日的 00:00 UT 对应的 JD。 */
function jdnToUtcMidnightJd(jdn) {
  return jdn - 0.5;
}

/** JD → 东八区民用日（儒略日数）。 */
function jdToBeijingJdn(jd) {
  return Math.floor(jd + 0.5 + BEIJING_OFFSET);
}

function jdnToYmd(jdn) {
  // 从 1900-01-01 线性推进；表覆盖 1900–2100，够用且无浮点边界风险。
  let y = 1900;
  let d = jdn - ymdToJdn(1900, 1, 1);
  for (;;) {
    const len = isLeapGregorian(y) ? 366 : 365;
    if (d < len) break;
    d -= len;
    y++;
  }
  const days = [31, isLeapGregorian(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let m = 0;
  while (d >= days[m]) {
    d -= days[m];
    m++;
  }
  return { year: y, month: m + 1, day: d + 1 };
}

function isLeapGregorian(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// ───────────────────────── 天文 ─────────────────────────
function sunApparentLongitude(jde) {
  const T = (jde - JD_J2000) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C =
    (1.9146 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);
  const omega = 125.04 - 1934.136 * T;
  let lambda = (L0 + C) - 0.00569 - 0.00478 * sin(omega);
  lambda %= 360;
  return lambda < 0 ? lambda + 360 : lambda;
}

/** ΔT = TT − UT（秒），Meeus Ch.15 的多项式（1900–2100 分段）。 */
function deltaTSeconds(year) {
  const y = year;
  if (y < 1920) {
    const t = y - 1900;
    return 27.15 + 3.5762821 * t - 0.04280687 * t ** 2 + 0.00120337 * t ** 3 + 0.00001531 * t ** 4;
  }
  if (y < 1941) {
    const t = y - 1920;
    return 11.72 + 0.55682671 * t - 0.01927566 * t ** 2 + 0.00059632 * t ** 3;
  }
  if (y < 1961) {
    const t = y - 1950;
    return -3.6 + 0.46325633 * t - 0.02839935 * t ** 2 + 0.0009767 * t ** 3 - 0.00001288 * t ** 4;
  }
  if (y < 1986) {
    const t = y - 1975;
    return 9.16118 - 0.01233228 * t - 0.01208196 * t ** 2 + 0.00095519 * t ** 3 - 0.0001498 * t ** 4;
  }
  if (y < 2005) {
    const t = y - 1995;
    return -10.7588 + 1.13454 * t - 0.2223007 * t ** 2 + 0.03001079 * t ** 3 - 0.000302689 * t ** 4;
  }
  if (y < 2050) {
    const t = y - 2000;
    return -1.559 + 0.885912 * t - 0.2083923 * t ** 2;
  }
  const t = (y - 1800) / 100;
  return (
    -2.24 + 12.0518 * t - 44.833949 * t ** 2 + 78.860167 * t ** 3 - 11.401111 * t ** 4 +
    0.077672988 * t ** 5 +
    0.0025103497 * t ** 6
  );
}

/**
 * 第 k 次合朔的 **UT 儒略日**。
 *
 * 🔴 两处必须说清的细节，错一处就会在"合朔正好压在子夜前后"的那些月份差一天：
 *
 * 1. **Meeus Ch.49 的 0.01039 那一项挂在 sin(2F) 上，不是 sin(2D)。**
 *    F（月升交点辐角）每朔望月推进 360.77°，D（距角）推进 1219.49° —— 两者周期完全不同，
 *    写成 2D 等于把一个 ±15 分钟的项换成另一个 ±15 分钟的项。实测这个错让
 *    1916 / 1958 / 2027 / 2030 四个春节各差一天（1958 年就在真实用户的出生年段里）。
 * 2. **Ch.49 给的是 JDE（力学时），民用日要用 UT** ⇒ 必须减 ΔT。
 *    1900–2100 的 ΔT 从 5 秒长到 ~70 秒再到预测值；子夜前后那几分钟就是它管的。
 *
 * 截断误差：0.00004 日以下的周期项没有全部列出（合计 < 4 秒），
 * 而 ΔT 多项式本身在 2050 年后是预测值 —— 所以产物只宣称"被反证过"的那些年份。
 */
function newMoonJd(k) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T2 * T2;
  const base =
    2451550.09766 +
    29.530588861 * k +
    0.00015437 * T2 -
    0.00000015 * T3 +
    0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const D = 297.8502 + 1219.4858535 * k - 0.0005788 * T2 + 0.00000288 * T3;
  const F = 199.7509 + 360.7691329 * k - 0.0040116 * T2 - 0.0000014 * T3 + 0.0000000148 * T4;
  const om = 51.566 - 0.0529538832 * k + 0.00040208 * T2 - 0.000000223 * T3;

  const corr =
    -0.4072 * sin(Mp) +
    0.17241 * E * sin(M) +
    0.01608 * sin(2 * Mp) +
    0.01039 * sin(2 * F) +
    0.00739 * E * sin(Mp - M) -
    0.00514 * E * sin(Mp + M) +
    0.00208 * E * E * sin(2 * M) -
    0.00111 * sin(Mp - 2 * D) -
    0.00057 * sin(Mp + 2 * D) +
    0.00056 * E * sin(2 * Mp + M) -
    0.00042 * sin(3 * Mp) +
    0.00042 * E * sin(M + 2 * D) +
    0.00038 * E * sin(M - 2 * D) -
    0.00024 * E * sin(2 * Mp - M) -
    0.00017 * sin(om) -
    0.00007 * sin(Mp + 2 * F) -
    0.00007 * sin(2 * Mp + 2 * F) +
    0.00006 * sin(2 * Mp - 2 * D) +
    0.00006 * E * sin(2 * Mp + 2 * M) -
    0.00006 * sin(3 * F) +
    0.00005 * sin(4 * Mp - M) -
    0.00005 * sin(2 * Mp + 2 * D) -
    0.00005 * sin(3 * M) +
    0.00004 * sin(5 * Mp) -
    0.00004 * sin(Mp + 2 * M) -
    0.00004 * sin(3 * Mp + 2 * D) +
    0.00003 * sin(Mp + M - 2 * D) +
    0.00003 * sin(2 * Mp + 2 * D) +
    0.00003 * sin(Mp + M + 2 * D) -
    0.00003 * sin(Mp - M + 2 * D) +
    0.00003 * sin(Mp - M - 2 * D) +
    0.00002 * sin(3 * Mp + M) -
    0.00002 * sin(4 * Mp);

  const approximateYear = 2000 + (base + corr - 2451545.0) / 365.25;
  return base + corr - deltaTSeconds(approximateYear) / 86400;
}

function normDeg(d) {
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** 从 fromJd 起往后，第一个太阳黄经 == target 的时刻（JD）。 */
function nextTermJd(fromJd, target) {
  const step = 5;
  let prev = normDeg(sunApparentLongitude(fromJd) - target);
  for (let i = 1; i <= 90; i += 1) {
    const jd = fromJd + i * step;
    const cur = normDeg(sunApparentLongitude(jd) - target);
    // 太阳顺行，角度差单调爬升；跨 0 且跳幅小于一步的量程才算命中
    if (prev <= 0 && cur > 0 && cur - prev < 40) {
      let lo = jd - step;
      let hi = jd;
      for (let j = 0; j < 60; j++) {
        const mid = (lo + hi) / 2;
        const f = normDeg(sunApparentLongitude(mid) - target);
        if (f <= 0) lo = mid;
        else hi = mid;
        if (hi - lo < 1e-9) break;
      }
      return (lo + hi) / 2;
    }
    prev = cur;
  }
  throw new Error(`找不到黄经 ${target}（起点 JD ${fromJd}）`);
}

/** 公历 y 年冬至的 JD。 */
function dongzhiJd(y) {
  return nextTermJd(jdnToUtcMidnightJd(ymdToJdn(y, 12, 5)), 270);
}

/** 从 fromJd 起（含）的第一个中气。 */
function firstTermAtOrAfter(fromJd) {
  const lam = sunApparentLongitude(fromJd);
  const target = (Math.ceil((lam + 1e-9) / 30) * 30) % 360;
  return { jd: nextTermJd(fromJd - 1, target), target };
}

/** 下一个中气（黄经 +30°，时间上往后走）。 */
function advanceTerm(ev) {
  const target = (ev.target + 30) % 360;
  return { jd: nextTermJd(ev.jd + 1, target), target };
}

/** 东八区民用日 <= 给定 JD 的那次合朔的 k。 */
function lastNewMoonKOnOrBeforeJdn(jdn) {
  let k = Math.round((jdn - 2451551) / 29.530588861); // 2451551 ≈ 2000-01-06 的 JDN
  for (let guard = 0; guard < 4000; guard++) {
    const here = jdToBeijingJdn(newMoonJd(k));
    const next = jdToBeijingJdn(newMoonJd(k + 1));
    if (here <= jdn && next > jdn) return k;
    if (here > jdn) k -= 1;
    else k += 1;
  }
  throw new Error(`找合朔失败（JDN ${jdn}）`);
}

// 这里刻意**没有**"中气黄经 → 月序"的映射表。月序由 computeLunarYear 里的计数器推进：
// 映射表在"一个朔望月含两个中气"的年份会跳号（1984 年那个月同时含冬至与大寒，
// 表会把月序从 11 直接判成 1、整个十二月被吞掉）。

/** 公历 y 年清明（太阳黄经 15°）所在的东八区民用日 JDN。 */
function qingmingJdn(y) {
  // 从 3/20 起往后找第一次越过 15°：清明恒落在 4/4–4/6，起点留足余量。
  return jdToBeijingJdn(nextTermJd(jdnToUtcMidnightJd(ymdToJdn(y, 3, 20)), 15));
}

/**
 * 【独立反证用】从 Meeus 实现算一个农历年：{ leapMonth, lengths, newYearJdn }
 *
 * 🔴 它**不是**产物的数据源（产物来自 lunar-typescript，见文件头）。
 *    留着它的唯一理由是与数据源零共享代码 —— 两边的分歧就是证据。
 */
function computeLunarYearByMeeus(y) {
  const kStart = lastNewMoonKOnOrBeforeJdn(jdToBeijingJdn(dongzhiJd(y - 1)));
  // 🔴 窗口必须开到**下一年的冬至**：农历年 y 的腊月落在公历 y+1 的 1–2 月，
  //    而冬至(y) 在 12 月 —— 只取到冬至(y) 会把冬月/腊月截掉。
  //    实测这个错**逃过了公告对账**（春节/端午/中秋都在前 8 个月），
  //    只有"月长合计 == 正月初一年际间隔"那条自洽判据抓得到。
  const kEnd = lastNewMoonKOnOrBeforeJdn(jdToBeijingJdn(dongzhiJd(y + 1)));

  const starts = [];
  for (let k = kStart; k <= kEnd; k++) starts.push(jdToBeijingJdn(newMoonJd(k)));

  // 每个朔望月所含的第一个中气（无则 null）。
  // 🔴 `term` 今天只用来判"这个月**有没有**中气"，月序由下面的计数器推进 ——
  //    所以一个月含一个还是两个中气都不影响结果。之所以不能换成"中气 → 月序"映射表：
  //    1984 年那个朔望月同时含冬至与大寒，映射表会让月序从 11 直接跳到 1、
  //    把整个十二月吞掉。含两个中气的原因是近日点附近太阳走得快，
  //    相邻中气间隔可短到 29 天，而历月长 29–30 天。
  const months = [];
  {
    let ev = firstTermAtOrAfter(jdnToUtcMidnightJd(starts[0]) - 5);
    for (let i = 0; i < starts.length - 1; i++) {
      let governing = null;
      for (;;) {
        const tJdn = jdToBeijingJdn(ev.jd);
        if (tJdn < starts[i]) {
          ev = advanceTerm(ev);
          continue;
        }
        if (tJdn >= starts[i + 1]) break;
        if (governing === null) governing = ev.target; // 定序用的是**第一个**中气
        ev = advanceTerm(ev);
      }
      months.push({ start: starts[i], length: starts[i + 1] - starts[i], term: governing });
    }
  }

  // 置闰的**前提条件**：两个冬至月之间正好有 13 个朔望月（12 个中气摊到 13 个月，
  // 才会多出一个月无中气）。只有 12 个月时，"无中气的月"只是序号推进，**不是闰月**。
  // 实测漏掉这条会把 1985 的二月判成闰正月、于是 1985 正月初一被算成 03-21
  // （真相 02-20），2053 同理。
  const dzThisJdn = jdToBeijingJdn(dongzhiJd(y));
  let dzIdx = starts.length - 1;
  for (let i = 0; i < starts.length - 1; i++) {
    if (starts[i] <= dzThisJdn && dzThisJdn < starts[i + 1]) {
      dzIdx = i;
      break;
    }
  }
  const mayHaveLeap = dzIdx === 13;

  // 标注月序与闰月。
  // 🔴 不能用"中气 → 月序"的映射表定序：1984 年那个朔望月**同时含冬至与大寒**，
  //    映射表会让月序从 11 直接跳到 1、把整个十二月吞掉。
  //    正确规则（所有正确实现的写法）：**含中气的月推进序号**；在满足置闰前提的年份里，
  //    第一个无中气的月插闰；闰用掉之后再遇到无中气的月，照常推进序号。
  let number = 11;
  let leapMonth = 0;
  const labeled = months.map((mo, i) => {
    if (i > 0) {
      if (mayHaveLeap && mo.term === null && leapMonth === 0) {
        leapMonth = number;
        return { ...mo, month: number, leap: true };
      }
      number = (number % 12) + 1;
    }
    return { ...mo, month: number, leap: false };
  });

  if (globalThis.__LUNAR_DEBUG__ === y) {
    console.log(`年 ${y}：共 ${starts.length} 个朔，窗口 ${fmtJdn(starts[0])} → ${fmtJdn(starts[starts.length - 1])}`);
    labeled.forEach((mo, i) =>
      console.log(
        `  [${i}] ${fmtJdn(mo.start)} 长${mo.length} 中气=${mo.term} → 月${mo.month}${mo.leap ? '（闰）' : ''}`,
      ),
    );
  }

  const from = labeled.findIndex((mo) => mo.month === 1 && !mo.leap);
  if (from < 0) {
    throw new Error(`${y}: 找不到含雨水的正月`);
  }

  // 从正月起按时间顺序收：12 个正常月，外加可能跟在某个正常月之后的那一个闰月
  const picked = [];
  let normalCount = 0;
  for (let i = from; i < labeled.length; i++) {
    const mo = labeled[i];
    if (!mo.leap) {
      if (normalCount >= 12) break;
      normalCount++;
    } else if (normalCount > 12) {
      break;
    }
    picked.push(mo);
  }

  // 🔴 闰月**只能从本年的这一段里取**。上面标注走的是整个窗口（含下一年的
  //    十一月/腊月），2008 就是在这里被 2009 的闰五月污染成"闰五月"，
  //    表现是那年八月之后的日期整体后移一个历月（公告对账差 28–31 天）。
  const inRangeLeap = picked.find((mo) => mo.leap);
  const leapOfMonth = inRangeLeap ? inRangeLeap.month : 0;

  return {
    leapMonth: leapOfMonth,
    lengths: picked.map((mo) => mo.length),
    newYearJdn: labeled[from].start,
  };
}

// ───────────────────────── 产物 ─────────────────────────
/**
 * 已知的"产物内部不自洽"年份（月长合计 ≠ 正月初一年际间隔）。判据写成**集合相等**：
 * 多一个会红，被修好了也会红 —— 豁免清单本身是一条断言，不是一句注释。
 *
 * 2033（著名的「2033 问题」：某朔望月同时含大寒与雨水，"第一个无中气月为闰"与
 * "中气定月序"两条规则给出两种月序）在**本仓库自带的 Meeus 实现**里会落进这张表；
 * 随包数据取自 lunar-typescript，它对 2033 给的是闰十一月且自洽，所以这里为空。
 */
const EXPECTED_INCONSISTENT = [];

/**
 * 两个独立实现（随包数据源 lunar-typescript vs 本仓库自带的 Meeus 实现）之间
 * **正月初一差一天**的年份。判据写成集合相等：多一个会红，消失也会红 ——
 * 豁免清单本身是一条断言，不是一句注释。
 *
 * 🔴 这些不是"容忍的误差"，是**登记下来的判定**。那几个周期的合朔压在东八区子夜
 *    ±11 分钟内，两边的级数截断各自判到了不同的一侧。取哪一份由"用户在别的日历里
 *    看到什么"决定：界面说"今天是正月初一"而所有公开日历都说是昨天，
 *    就是产品在对用户撒谎 —— 哪怕我们的算法"也不算错"。
 *
 * | 年 | 随包（lunar-typescript） | Meeus | 依据 |
 * |---|---|---|---|
 * | 1988 | 02-17 | 02-18 | 1988 年春节，公开日历一律记 2 月 17 日 |
 * | 2030 | 02-03 | 02-02 | 2030 年春节，公开日历记 2 月 3 日 |
 */
const NEWYEAR_DIFF_YEARS = [1988, 2030];

/**
 * **闰月月序**不同的年份 —— 比正月初一差一天严重得多（整年的历月结构不同）。
 *
 * 2033 就是历法实现里著名的「2033 问题」：某个朔望月同时含大寒与雨水两个中气，
 * 于是"第一个无中气月为闰"与"中气定月序"两条规则给出两种月序，要靠 GB/T 33661
 * 的补充口径才能定。本仓库的 Meeus 实现落不进那年的置闰框架（算成"无闰月"），
 * 随包取库给的闰十一月 —— 与紫金山天文台《农历的编算和颁行》一致，且那年自洽。
 */
const LEAP_DIFF_YEARS = [2033];

function fmtJdn(jdn) {
  const { year, month, day } = jdnToYmd(jdn);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function encodeYear(row) {
  let bits = 0;
  row.lengths.slice(0, 13).forEach((len, i) => {
    if (len === 30) bits |= 1 << (12 - i);
  });
  return (bits << 4) | (row.leapMonth & 0xf);
}

function decodeNewYear(packed) {
  return {
    year: YEAR_MIN + (packed >> 9),
    month: ((packed >> 5) & 0xf) + 1,
    day: packed & 0x1f,
  };
}

/** 农历（月, 日；闰月用 month 的负值表示，如闰五月 = -5）→ 东八区 JDN。 */
function lunarToJdn(table, lunarYear, month, day) {
  const idx = lunarYear - YEAR_MIN;
  const packed = table[idx * 2];
  const leap = packed & 0xf;
  const bits = packed >> 4;
  const slotLen = (slot) => (bits & 1 << (12 - slot) ? 30 : 29);

  const ny = decodeNewYear(table[idx * 2 + 1]);
  let cursor = ymdToJdn(ny.year, ny.month, ny.day);
  let slot = 0;
  for (let m = 1; m <= 12; m++) {
    if (month === m) return cursor + day - 1;
    cursor += slotLen(slot++);
    if (m === leap) {
      if (month === -m) return cursor + day - 1;
      cursor += slotLen(slot++);
    }
  }
  throw new Error(`换算失败 ${lunarYear}-${month}-${day}`);
}

function generateTable() {
  const table = [];
  for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
    const months = [...LunarYear.fromYear(y).getMonthsInYear()];
    const normal = months.filter((m) => !m.isLeap());
    const leapMonth = months.find((m) => m.isLeap());
    // 🔴 编码假设"12 个正常月 + 至多 1 个闰月，且数组按时间序从正月开始"。
    //    这些前提**必须断言**：库换版本、口径变了、或者数组顺序变了，
    //    不声明就会安静产出一份偏移的表（症状是几十年后的农历生日差一整个历月）。
    if (normal.length !== 12) throw new Error(`${y}: 正常月数 ${normal.length} ≠ 12`);
    if (months.length > 13) throw new Error(`${y}: 月份数 ${months.length} > 13`);
    if (normal[0].getMonth() !== 1) throw new Error(`${y}: 首月不是正月，是 ${normal[0].getMonth()}`);
    for (let i = 1; i < months.length; i++) {
      if (months[i].getFirstJulianDay() <= months[i - 1].getFirstJulianDay()) {
        throw new Error(`${y}: 月份数组不是按时间序（下标 ${i}）`);
      }
    }
    const newYear = beijingSolarDate(normal[0].getFirstJulianDay());
    if (Number(newYear.slice(0, 4)) !== y) {
      throw new Error(`${y}: 正月初一落在 ${newYear}，年份假设被推翻`);
    }
    table.push(encodeLengths(months, leapMonth), encodeNewYear(newYear));
  }
  return table;
}

/** 库给的是儒略日（含小数），先换成东八区民用日再取 Y-M-D。 */
function beijingSolarDate(julianDay) {
  return Solar.fromJulianDay(julianDay + 8 / 24).toYmd();
}

/** 月份按时间序排列，槽位 i = 该月；有闰月时 13 个槽位（从 bit12 往下）。 */
function encodeLengths(months, leapMonth) {
  let bits = 0;
  months.slice(0, 13).forEach((m, i) => {
    const len = m.getDayCount();
    if (len !== 29 && len !== 30) throw new Error(`非法历月长度 ${len}`);
    if (len === 30) bits |= 1 << (12 - i);
  });
  // 🔴 lunar-typescript 把闰月的月序存成**负数**（闰五月是 -5），直接 `& 0xf` 会得到
  //    补码低 4 位（-5 → 11），于是 2009 的闰五月被存成"闰十一月"，那年八月之后的
  //    每个农历日期都整体后移一个历月 —— 实测这条把公告对账判据打出 10 处红。
  const leap = leapMonth ? Math.abs(leapMonth.getMonth()) : 0;
  if (leap < 0 || leap > 12) throw new Error(`非法闰月月序 ${leap}`);
  return (bits << 4) | (leap & 0xf);
}

function encodeNewYear(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return ((year - YEAR_MIN) << 9) | ((month - 1) << 5) | day;
}

/**
 * 1900–2100 每年清明落在 4 月几日（数据源同样是库；Meeus 那份只做反证）。
 *
 * 🔴 编码假设"清明恒在 4 月"是**断言**而不是注释：越月就当场抛错，
 *    不会安静产出一份"少了一天"的表（那种错在界面上表现为"清明那天没标注"，永远没人修）。
 */
function generateQingming() {
  const days = [];
  for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
    const solar = Solar.fromYmd(y, 3, 1).getLunar().getJieQiTable()['清明'];
    if (!solar) throw new Error(`${y}: 节气管线里没有清明`);
    const iso = solar.toYmd();
    const [year, month, day] = iso.split('-').map(Number);
    if (year !== y || month !== 4) {
      throw new Error(`清明的编码假设被推翻：${y} 年算出 ${iso}`);
    }
    days.push(day);
  }
  return days;
}

/** 从 Meeus 实现独立算一遍，只用于 `--verify` 的双实现反证。 */
function meeusTable() {
  const table = [];
  for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
    const r = computeLunarYearByMeeus(y);
    table.push(encodeYear(r), encodeNewYear(fmtJdn(r.newYearJdn)));
  }
  return table;
}

function meeusQingmingDays() {
  const days = [];
  for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
    const { year, month, day } = jdnToYmd(qingmingJdn(y));
    if (year !== y || month !== 4) {
      throw new Error(`Meeus 侧清明越月：${y} → ${year}-${month}-${day}`);
    }
    days.push(day);
  }
  return days;
}

function render(table) {
  const lines = [];
  for (let i = 0; i < table.length; i += 2) {
    const y = YEAR_MIN + i / 2;
    lines.push(
      `  /* ${y} */ 0x${table[i].toString(16).padStart(4, '0')}, 0x${table[i + 1]
        .toString(16)
        .padStart(4, '0')},`,
    );
  }
  return `/* 生成物，请勿手改 —— 由 scripts/${SCRIPT_NAME} 产出（跑 --check 会验一致性）。 */
/* 数据源：lunar-typescript（仅构建期，不进包）。独立反证：本仓库自带的 Meeus 实现 + 国务院公告，见 --verify。 */
/* 置闰口径 GB/T 33661；日界取东八区民用日（子时换日）。 */
/* 🔴 权威反证只覆盖 ${VERIFIED_MIN}–${VERIFIED_MAX}（scripts/vendor/holiday-cn/ 里实际有公告的年份）。
   区间外的年份是**算出来的**、没有被独立验证过 —— 界面上不得暗示全区间都被证明。 */

/**
 * 每个农历年两个数，成对存放：
 *
 * 1. \`packed\`：高 13 位是从正月起的历月大小（1 = 30 天，0 = 29 天，正月在 bit12），
 *    低 4 位是闰哪个月（0 = 无闰月）。有闰月时该年的长度序列含 13 项。
 * 2. \`newYear\`：正月初一的公历日，编码为 \`(年-${YEAR_MIN})<<9 | (月-1)<<5 | 日\`。
 */
export const LUNAR_YEAR_TABLE: readonly number[] = [
${lines.join('\n')}
];

export const LUNAR_YEAR_MIN = ${YEAR_MIN};
export const LUNAR_YEAR_MAX = ${YEAR_MAX};
/** 有公告反证的区间 —— 这是判据的分母，不是"全部验过"。 */
export const LUNAR_VERIFIED_MIN = ${VERIFIED_MIN};
export const LUNAR_VERIFIED_MAX = ${VERIFIED_MAX};
`;
}

function renderTerms(days) {
  const lines = [];
  for (let i = 0; i < days.length; i += 10) {
    const y = YEAR_MIN + i;
    lines.push(`  /* ${y}–${y + 9} */ ${days.slice(i, i + 10).join(', ')},`);
  }
  return `/* 生成物，请勿手改 —— 由 scripts/${SCRIPT_NAME} 产出（跑 --check 会验一致性）。 */
/* 算法：Meeus《Astronomical Algorithms》Ch.25（太阳视黄经）；日界取东八区民用日。 */

/**
 * 清明（太阳黄经 15°）落在 4 月几日，下标 = 年份 − ${YEAR_MIN}。
 *
 * 为什么只有清明：它是法定假日里唯一既非公历固定日、也非农历日月的（其余 23 个节气
 * 今天没有产品消费者）。公历 1900–${YEAR_MAX} 全覆盖由生成时的断言保证 ——
 * 任何一年算出不在 4 月，生成当场失败，不会安静产出一份偏移的表。
 *
 * 🔴 权威反证只覆盖 ${VERIFIED_MIN}–${VERIFIED_MAX}（见 lunar-year.generated.ts 同一条）。
 */
export const QINGMING_APRIL_DAY: readonly number[] = [
${lines.join('\n')}
];

export const QINGMING_YEAR_MIN = ${YEAR_MIN};
export const QINGMING_YEAR_MAX = ${YEAR_MAX};
`;
}

// ───────────────────────── CLI ─────────────────────────
const args = process.argv.slice(2);
const dbgArg = args.indexOf('--debug');
if (dbgArg >= 0) globalThis.__LUNAR_DEBUG__ = Number(args[dbgArg + 1]);

const table = generateTable();
const qingmingDays = generateQingming();

/** 从产物文件里把数组读回来 —— --verify 判的是**随包交付的那份**，不是重新算的那份。 */
function readShippedNumbers(file, exportName, radix) {
  const body = readFileSync(file, 'utf8');
  const start = body.indexOf(`export const ${exportName}`);
  if (start < 0) throw new Error(`产物 ${file} 里没有 ${exportName}`);
  // 🔴 必须先把行内注释去掉再取数：产物每行都带 `/* 1900 */` 这样的年份标注，
  //    不剥掉就会把注释里的年份当成数据（实测解析出 301 个"数"，而期望是 201）。
  //    这条判据能红是因为它断言了"解析出的个数 == 期望年份数"，而不是默默少/多几个。
  const block = body
    .slice(start, body.indexOf('];', start))
    .replace(/\/\*[^*]*\*\//g, ' ');
  const nums = [...block.matchAll(new RegExp(`0x([0-9a-f]+)|(\\d+)`, 'g'))].map((m) =>
    m[1] ? parseInt(m[1], radix) : Number(m[2]),
  );
  if (nums.length === 0) throw new Error(`产物 ${file} 的 ${exportName} 解析出 0 个数`);
  return nums;
}

/**
 * 🔴 bundle 闸门（ADR-0044 §5 的那条体积实测结论，这里变成机器判据）
 *
 * 库入口的字节数**每次运行现场打印**（实测记录与日期在 ADR-0044 §5 勘误段，
 * 注释里不维护副本 —— 抄一份就一定会漂），而三份随包数据合计只有 2 万字节量级。
 * 所以随包的是**表**不是**算法**。这个决定一旦被人"顺手改回去"（例如让
 * `packages/domain` 直接 import 库），代价不是一个报错，而是**每一个端都变重**：
 * RN / 鸿蒙 / 原生壳的 JS 侧都要多打 400 KB，且没人会把它当回归来看。
 *
 * 三条臂各拦一种形状，缺一不可：
 *
 * | 臂 | 拦的是 | 为什么另一条拦不住 |
 * |---|---|---|
 * | ① import 扫描 | 产品源码里直接引用库 | 体积比会被"只引一小段"骗过去（tree-shaking 后未必到 424 KB） |
 * | ② 声明对账 | 库从 devDependency 挪成 dependencies，或某个子包自己声明它 | import 扫描只看源码，装在哪一类依赖它看不出来 |
 * | ③ 体积比 | 有人把库的表**抄进**产物（那不是 import，扫描抓不到） | 声明与 import 两条都还是绿的 |
 *
 * ③ 的阈值取 `lib/4`：它要拦的是"把整个库搬进包"（必然 449 KB 级），
 * 不是"表长大了" —— 后者由 ① 精确拦，所以这里留足余量，不做会误杀的紧阈值。
 */
function bundleGate() {
  const fails = [];

  const libPkgJson = join(ROOT, 'package.json');
  const rootPkg = JSON.parse(readFileSync(libPkgJson, 'utf8'));

  // ── ② 声明对账 ──
  if (rootPkg.devDependencies?.[LIB_NAME] === undefined) {
    fails.push(`根 package.json 的 devDependencies 里没有 ${LIB_NAME}（脚本 import 它却不在依赖里 = 干净检出上必炸）`);
  }
  if (rootPkg.dependencies?.[LIB_NAME] !== undefined) {
    fails.push(`${LIB_NAME} 出现在根 dependencies —— 它只能在 devDependencies（构建期）`);
  }
  const declaredIn = [];
  for (const dir of [...readdirSync(join(ROOT, 'packages')), ...readdirSync(join(ROOT, 'apps'))]) {
    const pj = join(ROOT, 'packages', dir, 'package.json');
    const pj2 = join(ROOT, 'apps', dir, 'package.json');
    for (const f of [pj, pj2]) {
      if (!existsSync(f)) continue;
      const p = JSON.parse(readFileSync(f, 'utf8'));
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        if (p[field]?.[LIB_NAME] !== undefined) declaredIn.push(`${relative(ROOT, f)}#${field}`);
      }
    }
  }
  if (declaredIn.length) fails.push(`${LIB_NAME} 被子包自己声明了：${declaredIn.join('、')}`);

  // ── ① import 扫描 ──
  const IMPORT_PATTERNS = [
    // `import … from 'lib'` / `export * from 'lib'`
    /(?:\bfrom|\bexport\s+\*)\s*['"]lunar-typescript(?:\/[^'"]*)?['"]/,
    // 副作用 import：`import 'lib'`
    /\bimport\s+['"]lunar-typescript(?:\/[^'"]*)?['"]/,
    // 动态 import 与 require
    /\bimport\s*\(\s*['"]lunar-typescript/,
    /\brequire\s*\(\s*['"]lunar-typescript/,
  ];
  const SRC_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
  const walkSources = (dir, out) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walkSources(full, out);
      else if (SRC_EXTS.has(e.name.slice(e.name.lastIndexOf('.')))) out.push(full);
    }
  };
  const sources = [];
  for (const base of ['packages', 'apps', 'server/src']) {
    const dir = join(ROOT, base);
    if (base === 'server/src') walkSources(dir, sources);
    else for (const d of existsSync(dir) ? readdirSync(dir) : []) walkSources(join(dir, d, 'src'), sources);
  }
  const hits = [];
  for (const f of sources) {
    const text = readFileSync(f, 'utf8');
    if (IMPORT_PATTERNS.some((re) => re.test(text))) hits.push(relative(ROOT, f));
  }
  if (hits.length) {
    fails.push(
      `产品源码里引用了 ${LIB_NAME}（它只在构建期用，一个字节都不该进包）：\n     ${hits.join('\n     ')}`,
    );
  }

  // ── ③ 体积比 ──
  // 度量口径：入口 ESM 文件的字节数（打包器的输入上界）。取不到 = 库没装 = 判据没测到，红。
  const require_ = createRequire(join(ROOT, 'scripts', 'noop.js'));
  let libFile;
  try {
    const resolvedCjs = require_.resolve(LIB_NAME);
    const esm = join(dirname(resolvedCjs), 'index.mjs');
    libFile = existsSync(esm) ? esm : resolvedCjs;
  } catch (e) {
    fails.push(`解析不到 ${LIB_NAME} 的入口（库没装？）：${e.message}`);
  }
  const artifacts = [OUT_LUNAR, OUT_TERMS, join(ROOT, 'packages/domain/src/generated/holiday-cn.generated.ts')];
  let shipped = 0;
  for (const f of artifacts) {
    if (!existsSync(f)) {
      fails.push(`随包产物不存在：${relative(ROOT, f)}`);
      continue;
    }
    shipped += statSync(f).size;
  }
  if (libFile !== undefined) {
    const libBytes = statSync(libFile).size;
    const gzBytes = gzipSync(readFileSync(libFile)).length;
    const cap = Math.floor(libBytes / 4);
    console.log(
      `  库入口 ${relative(ROOT, libFile)}：${libBytes.toLocaleString('en-US')} B（gzip ${gzBytes.toLocaleString('en-US')} B）；` +
        `随包数据合计 ${shipped.toLocaleString('en-US')} B = 库的 ${((shipped / libBytes) * 100).toFixed(1)}%`,
    );
    if (shipped > cap) {
      fails.push(
        `随包数据 ${shipped} B 超过 ${(cap / 1000).toFixed(0)} KB 上限（= 库的 1/4）—— 十有八九是把算法/抄表塞进了产物`,
      );
    }
    console.log(
      `  import 扫描分母：${sources.length} 个产品源码文件，命中 ${hits.length} 处（必须 0）`,
    );
  }

  return fails;
}

if (args.includes('--bundle')) {
  const fails = bundleGate();
  if (fails.length) {
    for (const f of fails) console.error('  🔴 ' + f);
    console.error('❌ bundle 闸门不通过：历法库只能在构建期使用');
    process.exit(1);
  }
  console.log(`✅ bundle 闸门：${LIB_NAME} 只在构建期，随包只有表`);
  process.exit(0);
}

if (args.includes('--verify')) {
  // 🔴 必须验**随包交付的那份产物**，不能重新 generateTable()。
  //    第一版就是在这里把判据写空了：拿算法验算法，产物被改坏也照样全绿
  //    （变异实测：翻掉 2020 年一个 bit，58 条仍全过、退出码 0）。
  for (const f of [OUT_LUNAR, OUT_TERMS]) {
    if (!existsSync(f)) {
      console.error(`❌ 产物不存在，无从对账：${f}`);
      process.exit(1);
    }
  }
  const ours = meeusTable();
  const ourQingming = meeusQingmingDays();
  const shipped = readShippedNumbers(OUT_LUNAR, 'LUNAR_YEAR_TABLE', 16);
  const shippedQingming = readShippedNumbers(OUT_TERMS, 'QINGMING_APRIL_DAY', 10);
  const spanYears = Math.floor(shipped.length / 2);
  if (spanYears !== YEAR_MAX - YEAR_MIN + 1) {
    console.error(`❌ 产物年份数 ${spanYears} ≠ 期望 ${YEAR_MAX - YEAR_MIN + 1}（解析或产物坏了）`);
    process.exit(1);
  }
  if (shippedQingming.length !== YEAR_MAX - YEAR_MIN + 1) {
    console.error(
      `❌ 清明表年份数 ${shippedQingming.length} ≠ 期望 ${YEAR_MAX - YEAR_MIN + 1}`,
    );
    process.exit(1);
  }

  const fmt = (jdn) => {
    const { year, month, day } = jdnToYmd(jdn);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // 双源对账：用**历法产物**算出的节日日期，必须落在**公告产物**给出的放假日期集合里。
  // 两个来源互相独立（一个从天文算法生成、一个是国务院公告的机器可读版），
  // 所以这条判据不需要"我们懂农历"就能自检。
  // 取 isOffDay === true 那批：产品要表达的是"这天休"，判据必须钉住同一件事。
  const RECON_CASES = [
    { id: 'new-year', aliases: ['元旦'], solar: [1, 1] },
    { id: 'spring-festival', aliases: ['春节'], lunar: [1, 1] },
    { id: 'qingming', aliases: ['清明节'], term: true },
    { id: 'labour-day', aliases: ['劳动节', '“五一”国际劳动节', '“五一”'], solar: [5, 1] },
    { id: 'dragon-boat', aliases: ['端午节'], lunar: [5, 5] },
    { id: 'mid-autumn', aliases: ['中秋节'], lunar: [8, 15] },
    { id: 'national-day', aliases: ['国庆节', '“十一”'], solar: [10, 1] },
  ];
  const fails = [];
  const skipped = [];
  // 🔴 "跳过"必须**逐条对上清单**，不是"少验几条也行"。
  //    别名写错（`清明节` → `清明節`）的表现正是"公告里没这个名字"⇒ 全部静默跳过，
  //    而分母仍然够大。集合相等才有牙齿。
  // 2007 年端午/中秋/清明尚未成为法定节假日，所以那年公告里没有它们的名字。
  const EXPECTED_SKIPS = ['2007 qingming', '2007 dragon-boat', '2007 mid-autumn'];
  const perYear = [];
  let checked = 0;
  for (const { year: y, days: entries } of HOLIDAY_YEARS) {
    const offDates = entries.filter((d) => d.isOffDay).map((d) => d.date);
    let yearChecked = 0;
    for (const c of RECON_CASES) {
      const matched = entries
        .filter((d) => d.isOffDay && matchFestivalName(d.name, c.aliases))
        .map((d) => d.date);
      if (matched.length === 0) {
        // 不是算法错，是公告没覆盖这个名字：2007 年清明/端午/中秋尚未入法。
        skipped.push(`${y} ${c.id}`);
        continue;
      }
      const computed = c.term
        ? `${y}-04-${String(shippedQingming[y - YEAR_MIN]).padStart(2, '0')}`
        : c.solar
          ? `${y}-${String(c.solar[0]).padStart(2, '0')}-${String(c.solar[1]).padStart(2, '0')}`
          : fmt(lunarToJdn(shipped, y, c.lunar[0], c.lunar[1]));
      checked++;
      yearChecked++;
      if (!offDates.includes(computed)) {
        fails.push(
          `${y} ${c.id}: 历法算出 ${computed}，公告放假集合 ${matched.join(',')}（该年全部放假：${offDates.join(',')}）`,
        );
      }
    }
    perYear.push(yearChecked);
  }
  console.log(
    `对账分母：${checked} 条可比对（${HOLIDAY_YEARS.length} 个公告年份 × ${RECON_CASES.length} 个法定节日，` +
      `最少的一年 ${Math.min(...perYear)} 条），跳过 ${skipped.length} 条（公告未覆盖该节日，不是算法不一致）`,
  );
  const skipUnexpected = skipped.filter((s) => !EXPECTED_SKIPS.includes(s));
  const skipHealed = EXPECTED_SKIPS.filter((s) => !skipped.includes(s));
  if (skipUnexpected.length || skipHealed.length) {
    if (skipUnexpected.length) console.error(`  🔴 新出现的跳过：${skipUnexpected.join('、')}（公告措辞变了？别名写错了？）`);
    if (skipHealed.length) console.error(`  🔴 登记为跳过的节日现在有数据了，把 ${skipHealed.join('、')} 从清单删掉`);
    console.error('❌ 跳过清单与公告不符');
    process.exit(1);
  }
  console.log('  跳过（与登记一致）：' + (skipped.join('、') || '无'));
  // 🔴 分母必须随年份数增长：某年一个都没对上（公告改措辞、产物年份错位）时，
  //    "零条不一致"会变成一次空过。
  if (checked < HOLIDAY_YEARS.length) {
    console.error(`❌ 可比对条数 ${checked} < 公告年份数 ${HOLIDAY_YEARS.length} —— 判据没吃到样本`);
    process.exit(1);
  }
  if (fails.length) {
    for (const f of fails) console.error('  🔴 ' + f);
    console.error(`❌ ${fails.length}/${checked} 条不一致`);
    process.exit(1);
  }
  console.log(`✅ ${checked} 条全部落在公告给出的放假日期集合内`);

  // 🔴 光靠这几个节日**盖不住全部 bit**：月长 bit 只影响它之后的日期，
  //    实测翻掉 2020 年"九月"那个 bit，春节/端午/中秋一个都不移位、判据照样绿。
  //    补一条内部自洽：每年历月长度之和必须等于"次年正月初一 − 本年正月初一"。
  //    两个数是**独立编码**的（月长 bit vs newYear 打包），所以它们互相反证，
  //    任何一格月长被改坏都会在这里现形，覆盖 13 个 bit 的全部位置。
  let chainChecked = 0;
  const chainFails = [];
  for (let y = YEAR_MIN; y < YEAR_MAX; y++) {
    const i = y - YEAR_MIN;
    const packed = shipped[i * 2];
    const leap = packed & 0xf;
    const bits = packed >> 4;
    const slots = leap ? 13 : 12;
    let sum = 0;
    for (let s = 0; s < slots; s++) sum += bits & 1 << (12 - s) ? 30 : 29;
    const d1 = decodeNewYear(shipped[i * 2 + 1]);
    const d2 = decodeNewYear(shipped[i * 2 + 3]);
    const gapDays = ymdToJdn(d2.year, d2.month, d2.day) - ymdToJdn(d1.year, d1.month, d1.day);
    chainChecked++;
    if (gapDays !== sum) chainFails.push({ y, sum, gapDays });
  }

  console.log(
    `自洽分母：${chainChecked} 年（月长合计 ↔ 正月初一年际间隔，覆盖全部 13 个 bit 位）；不自洽 ${chainFails.map((f) => f.y).join(',') || '无'}`,
  );
  const got = chainFails.map((f) => f.y);
  const unexpected = got.filter((y) => !EXPECTED_INCONSISTENT.includes(y));
  const healed = EXPECTED_INCONSISTENT.filter((y) => !got.includes(y));
  if (unexpected.length || healed.length) {
    if (unexpected.length) console.error(`  🔴 新出现的不自洽年份：${unexpected.join(',')}`);
    if (healed.length) console.error(`  🔴 已知清单里的年份现在自洽了，把 ${healed.join(',')} 从清单删掉`);
    console.error('❌ 自洽判据与已知清单不符');
    process.exit(1);
  }
  console.log(`✅ 自洽：${chainChecked - got.length}/${chainChecked} 年通过`);

  // 反证 ①：**两个独立实现**逐年比 —— 随包数据来自 lunar-typescript，
  // 本文件自带的 Meeus 实现与它零共享（一个查 ELP 系数表、一个算周期项）。
  //
  // 分歧要**分级**登记，不能一锅端成"23 个年份不同"：
  //   · 正月初一差一天（NEWYEAR_DIFF）→ 用户在"春节是哪天"上会看见两个答案，必须点名并说清取哪个
  //   · 闰月月序不同（LEAP_DIFF）→ 整年日历结构不同，最严重
  //   · 其余只能是**历月边界 ±1 天**（合朔压在东八区子夜几分钟内时，两个实现各自截断到不同一侧）
  // 第三条是**判据**不是容忍：一旦某年差到 ≥2 天，说明不是截断噪声而是结构性的整月偏移
  // （实测：把 lunar-typescript 的负数闰月直接 &0xf 存成 11，就会造出 30 天级的偏移）。
  const slotStarts = (packed, newYearPacked) => {
    const leap = packed & 0xf;
    const bits = packed >> 4;
    const slots = leap ? 13 : 12;
    const ny = decodeNewYear(newYearPacked);
    let cursor = ymdToJdn(ny.year, ny.month, ny.day);
    const out = [cursor];
    for (let s = 0; s < slots; s++) {
      cursor += bits & (1 << (12 - s)) ? 30 : 29;
      out.push(cursor);
    }
    return out;
  };

  const newYearDiff = [];
  const leapDiff = [];
  const overOneDay = [];
  let boundaryOnly = 0;
  for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
    const i = (y - YEAR_MIN) * 2;
    const a = decodeNewYear(shipped[i + 1]);
    const b = decodeNewYear(ours[i + 1]);
    const gapShipped = ymdToJdn(a.year, a.month, a.day);
    const gapOurs = ymdToJdn(b.year, b.month, b.day);
    if (shipped[i] === ours[i] && shipped[i + 1] === ours[i + 1]) continue;
    const leapA = shipped[i] & 0xf;
    const leapB = ours[i] & 0xf;
    if (leapA !== leapB) {
      leapDiff.push(`${y}: 随包闰${leapA}月 / Meeus闰${leapB}月`);
      continue;
    }
    if (gapShipped !== gapOurs) {
      newYearDiff.push(
        `${y}: 随包 ${a.year}-${a.month}-${a.day} / Meeus ${b.year}-${b.month}-${b.day}`,
      );
    }
    const sa = slotStarts(shipped[i], shipped[i + 1]);
    const sb = slotStarts(ours[i], ours[i + 1]);
    let maxShift = 0;
    for (let s = 0; s < sa.length; s++) maxShift = Math.max(maxShift, Math.abs(sa[s] - sb[s]));
    if (maxShift > 1) overOneDay.push(`${y}: 最大偏移 ${maxShift} 天`);
    else boundaryOnly++;
  }
  const qingmingDual = [];
  for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
    if (shippedQingming[y - YEAR_MIN] !== ourQingming[y - YEAR_MIN]) {
      qingmingDual.push(`${y}: 随包 4-${shippedQingming[y - YEAR_MIN]} / Meeus 4-${ourQingming[y - YEAR_MIN]}`);
    }
  }

  const yearsOf = (list) => list.map((s) => Number(s.split(':')[0]));
  const newY = yearsOf(newYearDiff);
  const leapY = yearsOf(leapDiff);
  const unexpectedNewY = newY.filter((y) => !NEWYEAR_DIFF_YEARS.includes(y));
  const healedNewY = NEWYEAR_DIFF_YEARS.filter((y) => !newY.includes(y));
  const unexpectedLeapY = leapY.filter((y) => !LEAP_DIFF_YEARS.includes(y));
  const healedLeapY = LEAP_DIFF_YEARS.filter((y) => !leapY.includes(y));

  console.log(
    `双实现分母：${YEAR_MAX - YEAR_MIN + 1} 年（农历）+ 同区间（清明）；` +
      `仅历月边界 ±1 天 ${boundaryOnly} 年，正月初一分歧 ${newY.join(',') || '无'}，` +
      `闰月分歧 ${leapY.join(',') || '无'}，清明分歧 ${yearsOf(qingmingDual).join(',') || '无'}`,
  );
  for (const s of newYearDiff) console.log(`  ⚠️ 正月初一分歧 ${s}`);
  for (const s of leapDiff) console.log(`  ⚠️ 闰月分歧 ${s}`);
  for (const s of qingmingDual) console.log(`  ⚠️ 清明分歧 ${s}`);
  const dualProblems = [];
  if (unexpectedNewY.length) dualProblems.push(`新出现的正月初一分歧：${unexpectedNewY.join(',')}`);
  if (healedNewY.length) dualProblems.push(`已登记的正月初一分歧消失了，把 ${healedNewY.join(',')} 从清单删掉`);
  if (unexpectedLeapY.length) dualProblems.push(`新出现的闰月分歧：${unexpectedLeapY.join(',')}`);
  if (healedLeapY.length) dualProblems.push(`已登记的闰月分歧消失了，把 ${healedLeapY.join(',')} 从清单删掉`);
  if (overOneDay.length) dualProblems.push(`偏移超过一天的年份（不是截断噪声）：${overOneDay.join('；')}`);
  if (qingmingDual.length) dualProblems.push(`清明分歧：${qingmingDual.join('；')}`);
  if (dualProblems.length) {
    for (const p of dualProblems) console.error('  🔴 ' + p);
    console.error('❌ 双实现反证与已知清单不符');
    process.exit(1);
  }
  console.log(
    `✅ 双实现：${NEWYEAR_DIFF_YEARS.length} 年的正月初一 + ${LEAP_DIFF_YEARS.length} 年的闰月按登记的口径取随包那份；` +
      `其余差异都不超过历月边界 ±1 天`,
  );
  process.exit(0);
}

if (args.includes('--check')) {
  const targets = [
    { file: OUT_LUNAR, source: render(table) },
    { file: OUT_TERMS, source: renderTerms(qingmingDays) },
  ];
  let drifted = false;
  for (const { file, source } of targets) {
    if (!existsSync(file)) {
      console.error(`❌ 生成物不存在：${file}`);
      drifted = true;
      continue;
    }
    if (readFileSync(file, 'utf8') !== source) {
      console.error(`❌ 生成物与算法不一致：${file}`);
      drifted = true;
    }
  }
  if (drifted) {
    console.error(`跑：node scripts/${SCRIPT_NAME}`);
    process.exit(1);
  }
  console.log(`✅ ${targets.length} 份历法产物与算法一致`);
  process.exit(0);
}

mkdirSync(dirname(OUT_LUNAR), { recursive: true });
writeFileSync(OUT_LUNAR, render(table), 'utf8');
writeFileSync(OUT_TERMS, renderTerms(qingmingDays), 'utf8');
console.log('✅ 已生成', OUT_LUNAR, '与', OUT_TERMS);
