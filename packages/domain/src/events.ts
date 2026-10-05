/**
 * 倒数日 / 纪念日（共享规则）
 * ============================
 *
 * 判据全在这个文件；op 的构造在 `packages/app-host/src/event-actions.ts`。
 * **任何 `apps/*` 里都不许重新判断**（AGENTS §3.5）—— 一端各写一次
 * "什么算归档""下一次是哪天"，就是两份会漂移的真相，而漂移不报错。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 四条由这里独占的语义决定
 *
 * 1. 🔴 **类型档位不许从日期反推**（§2.6「App 不替用户决定含义」）。
 *    哪天出生、哪天算节日只有用户知道。日期本身唯一能说的是
 *    "还没到 / 已过"这副面孔，所以它是 `kind` 缺席时的**兜底**，不是相反。
 *
 * 2. 🔴 **置顶就是 `pinnedAt`，没有第二个"排在最前"字段**（§2.4）。
 *    先例是 `notes.ts` 文件头那条："钉到今天"就等于置顶，是同一个字段；
 *    做成两个字段必然在一次编辑里漂移。排序三段照抄
 *    `sortNotesForDisplay`（钉选 → 时间 → **id 字典序兜底**），
 *    少了第三段，同一毫秒更新的两条在两端会换位置。
 *
 * 3. 🔴 **归档是独立一态**（§2.5）：`archivedAt` 与 `deletedAt` 互不表达对方。
 *    归档 ≠ 删除的可观测判据是"回收站里没有它，归档视图里有它"。
 *    把归档实现成"打 `deletedAt` 再打回来"会同时做错两件事：
 *    归档项出现在回收站里，而离线端会把"清掉墓碑"当成"从未删除"又同步回来。
 *
 * 4. **农历不是第二种日期字段。** 锚点一律存公历 `LocalDate`，
 *    `isLunar` 说的是"每年重复时按农历那一天推"，读的时候经 `solarToLunar` 换算。
 *    于是排序、日历、回收站都不必认识两套日期 —— 少一处分支就少一处漂移。
 *    闰月口径（ADR-0044 D2）在 {@link lunarOccurrencesInYear} 里落地，
 *    三个档位都有真实行为，不是存了个字段却没人读。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { CountdownEvent, CountdownEventKind, LunarLeapMonthPolicy } from './entities.js';
import type { LocalDate } from './date.js';
import { diffDays } from './date.js';
import {
  daysInLunarMonth,
  leapMonthOf,
  lunarToSolar,
  type LunarDate,
  solarToLunar,
} from './lunar.js';
import { nextOccurrence, occurrencesInRange } from './recurrence.js';

/** 标题上限。与便签正文同一量级的克制：卡片上一行放不下的字等于没有。 */
export const EVENT_MAX_TITLE_LENGTH = 120;

/** 写入侧拒绝的原因。**校验单点定义在这里**，宿主只负责把它翻成话。 */
export type EventRejection = 'empty-title' | 'too-long-title' | 'invalid-date';

/**
 * 只判标题。改名手势不该被一个**旧日期**挡下来 ——
 * 那种情况下用户改的是标题，报错却指向日期，等于把门开在错的地方。
 */
export function eventTitleRejection(title: string): EventRejection | undefined {
  if (title.trim() === '') return 'empty-title';
  if (title.length > EVENT_MAX_TITLE_LENGTH) return 'too-long-title';
  return undefined;
}

export function eventRejection(title: string, date: LocalDate): EventRejection | undefined {
  const titleProblem = eventTitleRejection(title);
  if (titleProblem !== undefined) return titleProblem;
  // 非法日期必须在这里挡住：`new Date(2026, 1, 30)` 会静默滚成 3 月 2 日，
  // 于是"2 月 30 日的倒数日"变成一个谁都没选的日期。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'invalid-date';
  const [y, m, d] = date.split('-').map(Number);
  const probe = new Date(Date.UTC(y as number, (m as number) - 1, d as number));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== (m as number) - 1 ||
    probe.getUTCDate() !== d
  ) {
    return 'invalid-date';
  }
  return undefined;
}

/** 这条倒数日重不重复。`recurrence` 缺席就是**一次性**，不是"按天"。 */
export function isEventRepeating(event: CountdownEvent): boolean {
  return typeof event.recurrence === 'string' && event.recurrence !== '';
}

/** 闰月口径（ADR-0044 D2）：缺席 = `'first'`（逢闰过正）。 */
export function eventLeapMonthPolicy(event: CountdownEvent): LunarLeapMonthPolicy {
  return event.leapMonthPolicy ?? 'first';
}

/**
 * 这张卡片属于哪个类型档位。
 *
 * 🔴 用户选过就照用户说的；**没选过**才退回"由日期方向说的那句话"
 * （未到 = 倒数，已过 = 纪念）。见文件头第 1 条。
 */
export function eventKindOf(event: CountdownEvent, today: LocalDate): CountdownEventKind {
  if (event.kind !== undefined) return event.kind;
  return nextEventOccurrence(event, today) === undefined ? 'anniversary' : 'countdown';
}

/** 置顶。🔴 判据只有一个字段（§2.4）；界面要徽标、要分组、要排序，全问它。 */
export function isEventPinned(event: CountdownEvent): boolean {
  return event.pinnedAt !== undefined;
}

/** 归档态。它与"已删除"是两件事（§2.5），所以是**两个不同的字段**。 */
export function isEventArchived(event: CountdownEvent): boolean {
  return event.archivedAt !== undefined;
}

/** 主列表要显示的：未删除、未归档。 */
export function aliveEvents(events: readonly CountdownEvent[]): CountdownEvent[] {
  return events.filter((e) => e.deletedAt === undefined && !isEventArchived(e));
}

/** 归档视图要显示的：未删除、已归档。 */
export function archivedEvents(events: readonly CountdownEvent[]): CountdownEvent[] {
  return events.filter((e) => e.deletedAt === undefined && isEventArchived(e));
}

/**
 * 农历锚点在 `year` 这一农历年里的**全部**发生日（0–2 个）。
 *
 * 三个档位的语义：
 * · `first`（默认）：只用同名正月。闰月那年也是正月 —— 这就是"逢闰过正"。
 * · `last`：该年有闰这个月就用闰月，没有则回落到正月（不是"不过"）。
 * · `both`：正月与闰月各一次，按日历先后排出。
 *
 * ⚠️ 该历月没有那一天时**退到该月最后一天**（与 `nextLunarOccurrence` 同一取舍）：
 * 锚点写在"腊月三十"而那年腊月只有 29 天，clamp 到廿九，而不是跳到正月。
 */
function lunarOccurrencesInYear(
  anchor: LunarDate,
  year: number,
  policy: LunarLeapMonthPolicy,
): LocalDate[] {
  const hasLeap = leapMonthOf(year) === anchor.month;
  const dayIn = (leap: boolean): number =>
    Math.min(anchor.day, daysInLunarMonth(year, anchor.month, leap));
  const regular = lunarToSolar({
    year,
    month: anchor.month,
    day: dayIn(false),
    leap: false,
  });
  if (!hasLeap) return [regular];
  if (policy === 'last') {
    return [lunarToSolar({ year, month: anchor.month, day: dayIn(true), leap: true })];
  }
  if (policy === 'both') {
    // 闰月排在同名正月之后，所以字典序就是日历序
    return [
      regular,
      lunarToSolar({ year, month: anchor.month, day: dayIn(true), leap: true }),
    ].sort();
  }
  return [regular];
}

/** 农历年号（`from` 所在那一年）—— 回找时用它定起点。 */
function lunarYearOf(date: LocalDate): number {
  return solarToLunar(date).year;
}

/**
 * `from`（**含当天**）起，这个倒数日的下一次发生日。
 *
 * 返回 `undefined` 的只有一种情况：**一次性且已经过去**。
 * 重复的倒数日永远有下一次 —— 界面据此区分"还剩 N 天"与"没有这一说"，
 * 而不是把 `undefined` 渲染成 0 天。
 */
export function nextEventOccurrence(
  event: CountdownEvent,
  from: LocalDate,
): LocalDate | undefined {
  if (!isEventRepeating(event)) return event.date >= from ? event.date : undefined;

  if (event.isLunar === true) {
    const anchor = solarToLunar(event.date);
    const policy = eventLeapMonthPolicy(event);
    const startYear = lunarYearOf(from);
    // 三年窗口：`both` 档在同一年里可能有两个候选，跨年时还要覆盖
    // "农历新年还没到、但上一农历年里的那一天已过"的情形。
    for (let year = startYear; year <= startYear + 2; year += 1) {
      for (const date of lunarOccurrencesInYear(anchor, year, policy)) {
        if (date >= from) return date;
      }
    }
    return undefined;
  }

  const rule = event.recurrence as string;
  // 当天就算命中：倒数日在正日子显示"就是今天"，不是"还有 365 天"。
  if (occursOnToday(rule, event.date, from)) return from;
  return nextOccurrence(rule, event.date, from);
}

/**
 * `[from, to]`（含两端）这段时间里这个倒数日的**全部**发生日，升序去重。
 *
 * 🔴 为什么不"循环调 `nextEventOccurrence` 直到出界"：那条路回答的是"下一次是哪天"，
 * 而日历要问的是"这一段里有哪几天"。农历 `both` 档在同一年里就有**两个**正日子
 * （ADR-0044），用"下一次"去凑"这一段"只会剩第一个 —— 那不是少画一个点，
 * 是把一档真实行为从界面上抹掉，而且两边看起来都"合理"。
 *
 * @param from 窗口下沿（含）。日历格子的第一天。
 * @param to   窗口上沿（含）。
 *
 * ⚠️ 非法规则与求值抛错一律按**不命中**处理，与 `occursOnToday` 同一取舍：
 * 重复规则是用户输入，一条打错的规则不该让整张日历崩掉。
 */
export function eventOccurrencesInRange(
  event: CountdownEvent,
  from: LocalDate,
  to: LocalDate,
): LocalDate[] {
  if (to < from) return [];
  if (!isEventRepeating(event)) {
    return event.date >= from && event.date <= to ? [event.date] : [];
  }

  if (event.isLunar === true) {
    const anchor = solarToLunar(event.date);
    const policy = eventLeapMonthPolicy(event);
    const out: LocalDate[] = [];
    /*
      从 `from` 所在的**上一个**农历年起算：农历新年落在公历 1–2 月，
      所以公历 1 月上旬那几天属于上一个农历年。少退一年就会把整月的
      农历生日在 1 月那一格里画漏 —— 而 12 月那一格是对的，症状看起来像"偶尔错"。
      上沿同理多走一年：`to` 是窗口最后一天，它所在农历年的下一次 occurrence 可能仍在窗口内。
    */
    const lastYear = lunarYearOf(to);
    for (let year = lunarYearOf(from) - 1; year <= lastYear + 1; year += 1) {
      for (const date of lunarOccurrencesInYear(anchor, year, policy)) {
        if (date > to) break;
        if (date >= from) out.push(date);
      }
    }
    return out.sort();
  }

  /*
    🔴 迭代上限要**按窗口算**，不能吃 `recurrence.ts` 那个 1000 的默认值。
    那条路是这么坏的：一条锚在三年前的"每天"倒数日，ical 的迭代器要空转 1000 次
    才走到窗口，于是**窗口里的每一天都不画** —— 而它不抛错、不报警，
    界面上就是"这条倒数日凭空不存在"。给它一个由锚点到 `to` 的真实天数 + 余量，
    这条静默少画的路就被这条判据挡住了（`eventOccurrencesInRange` 的"锚在三年前的 DAILY"用例）。
  */
  const iterations = Math.max(1, diffDays(event.date, to) + 2);
  try {
    return occurrencesInRange(event.recurrence as string, event.date, from, to, {
      maxIterations: iterations,
    });
  } catch {
    return [];
  }
}

/**
 * "已经 N 天"那个数：分母是**锚点**，不是上一次发生日。
 *
 * 🔴 结婚纪念日的卡片要说"在一起 3 650 天"，不是"距上一个 5 月 1 日多少天"
 * —— 后者对每年重复的东西永远 ≤ 365，等于没有。一次性倒数日走到今天之后，
 * 两个分母恰好相等，所以这一条对两种形态都是同一个式子。
 *
 * ⚠️ 锚点还在未来时返回 **0**，不返回负数 —— 界面拿到负数会去拼
 * "已经 -12 天"，那是一句谎话（§2.7 的红线正是这一类）。
 */
export function eventAgeInDays(event: CountdownEvent, today: LocalDate): number {
  const age = diffDays(event.date, today);
  return age > 0 ? age : 0;
}

/** 规则解析失败按"不命中"处理 —— 不把一条坏数据抛给界面。 */
function occursOnToday(rule: string, dtstart: LocalDate, date: LocalDate): boolean {
  try {
    return occurrencesInRange(rule, dtstart, date, date).includes(date);
  } catch {
    return false;
  }
}

/**
 * 卡片上那个数：**正数 = 还有 N 天，负数 = 已经 N 天，0 = 就是今天**。
 *
 * 🔴 两副面孔是同一个函数返回的两个符号，不是两套状态 —— 界面拿到什么
 * 就说什么，不许自己再判一次 `date < today`（那会把"今天"算成"已经 1 天"）。
 * §2.7 的红线（不飘红、不审判）是**措辞与配色**层的约束，不是这里的算术。
 */
export function eventDaysFromToday(event: CountdownEvent, today: LocalDate): number {
  const next = nextEventOccurrence(event, today);
  if (next !== undefined) return diffDays(today, next);
  return -eventAgeInDays(event, today);
}

/**
 * 倒数日在界面上的**规范顺序**。
 *
 * 三段（照 `sortNotesForDisplay`）：**置顶在前 → 距下一次的天数升序 → id 字典序**。
 * 第三段不是凑数：同一毫秒更新的两条记录在两台设备上必须画出同一个顺序。
 *
 * ⚠️ 第二段的"距下一次"对**一次性且已过**的倒数日取的是"距今多少天"的绝对值，
 * 于是它排在所有还没到的后面 —— 这正是"过期的一次性倒数日不该插队"的口径。
 */
export function sortEventsForDisplay(
  events: readonly CountdownEvent[],
  today: LocalDate,
): CountdownEvent[] {
  return [...events].sort((a, b) => {
    const pinnedA = isEventPinned(a);
    const pinnedB = isEventPinned(b);
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
    const distanceA = Math.abs(eventDaysFromToday(a, today));
    const distanceB = Math.abs(eventDaysFromToday(b, today));
    if (distanceA !== distanceB) return distanceA - distanceB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
