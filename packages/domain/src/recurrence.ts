/**
 * 重复规则求值（RRULE）
 * ======================
 *
 * 基于 `ical.js` 的 `Recur`/`RecurIterator`（MPL-2.0，最后提交 2026-09）。
 * **不自研 RRULE 解析器** —— RFC 5545 的 `BYDAY`/`BYSETPOS`/`BYMONTHDAY`
 * 组合语义极为刁钻，自研必然在边缘上出错，而且是"看起来对、偶尔错一次"那种。
 *
 * `rrule.js` 被**可维护性门槛**排除（最后发版 2023），不是许可证问题。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 时区必须是 `floating`，不能给 UTC 或本地时区。
 *
 * 我们的 `LocalDate` 是**日历日期**（`2026-03-02`），不是时间点。
 * 一旦绑上时区，跨夏令时或跨零点就会整体偏移一天 ——
 * "每周一重复"会在某些周变成周二。floating 语义正是"与地点无关的墙上时间"，
 * 与日历日期一一对应。
 * ═════════════════════════════════════════════════════════════════════════
 */

import ICAL from 'ical.js';

import { addDays, diffDays, parseLocalDate, toLocalDate, type LocalDate } from './date.js';

/**
 * 单次求值的硬上限。
 *
 * 无限规则（`FREQ=DAILY` 无 `COUNT`/`UNTIL`）在给定窗口内可能产生海量日期，
 * 而调用方多半只是想渲染一个月视图。不设上限的话，一个
 * `FREQ=SECONDLY` 的规则能把浏览器标签页卡死。
 */
const DEFAULT_MAX_ITERATIONS = 1000;

/**
 * 规则是否合法。UI 用来在保存前给出提示，而不是等到求值才炸。
 *
 * 🔴 **不能只靠 `fromString` 是否抛错。** 实测：`fromString` 对
 * `'不是规则'`、`''`、`'HELLO'`、`'COUNT=3'` 全都**欣然接受**，
 * 只是把 `freq` 留成 `null`。也就是说 try/catch 包一层等于没校验。
 *
 * 所以这里额外要求：必须解析出**受支持的 FREQ**。
 */
export function isValidRecurrenceRule(rule: string): boolean {
  if (rule.trim() === '') return false;
  try {
    const recur = ICAL.Recur.fromString(rule);
    // freq 为 null 说明串里根本没有有效的 FREQ —— 见上面的实测
    if (recur.freq === null || recur.freq === undefined) return false;
    return (VALID_FREQUENCIES as readonly string[]).includes(recur.freq);
  } catch {
    return false;
  }
}

/** `sync-core`/RFC5545 支持的频率。 */
const VALID_FREQUENCIES = [
  'SECONDLY',
  'MINUTELY',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
] as const;

/** 规则是否有结束条件（COUNT 或 UNTIL）。无限规则要注意求值上限。 */
export function isFiniteRule(rule: string): boolean {
  try {
    return ICAL.Recur.fromString(rule).isFinite();
  } catch {
    return false;
  }
}

/**
 * `LocalDate` → `ICAL.Time`（floating，零点）。
 *
 * ⚠️ 不要用 `ICAL.Time.fromJSDate`：那会把本地时区带进去。
 */
function toIcalTime(date: LocalDate): ICAL.Time {
  // 用 fromStringv2（单参数）：`Time.fromString` 是解析属性值用的，
  // 类型上要求第二个参数，语义也不一样。
  const t = ICAL.Time.fromStringv2(`${date}T00:00:00`);

  // 断言而不是重设：`fromString` 对无 `Z` 后缀的串本来就给 floating 时区。
  // 这里**故意抛错**而不是悄悄纠正 —— 如果将来 ical.js 换了默认时区，
  // 所有"每周一重复"会在某些周变成周二，而且没有任何错误信息。
  // 与其静默漂移一天，不如立刻炸出来。
  if (t.zone.tzid !== 'floating') {
    throw new Error(
      `ical.js 给了非 floating 时区（${t.zone.tzid}）—— 日历日期会整体偏移。` +
        `继续下去会让重复任务在跨时区/夏令时边界错一天。`,
    );
  }

  return t;
}

/** `ICAL.Time` → `LocalDate`。 */
function fromIcalTime(time: ICAL.Time): LocalDate {
  return `${String(time.year).padStart(4, '0')}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

export interface RecurrenceRangeOptions {
  /** 求值上限，防止无限规则把界面卡死。 */
  maxIterations?: number;
}

/**
 * 求 `[from, to]` 闭区间内所有重复日期（含两端）。
 *
 * `dtstart` 语义：规则的起点。第一次出现通常就是 `dtstart` 自己（除非
 * `BYDAY` 等把它排除掉），这与 RFC 5545 一致。
 *
 * 返回**升序、去重**的 `LocalDate[]`。
 */
export function occurrencesInRange(
  rule: string,
  dtstart: LocalDate,
  from: LocalDate,
  to: LocalDate,
  options: RecurrenceRangeOptions = {},
): LocalDate[] {
  if (to < from) return [];

  let recur: ICAL.Recur;
  try {
    recur = ICAL.Recur.fromString(rule);
  } catch {
    // 非法规则返回空数组而不是抛错：
    // 重复规则是用户输入，一个打错的规则不该让整个任务列表崩掉。
    return [];
  }

  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const out: LocalDate[] = [];

  // 🔴 **迭代本身也会抛错，不只是解析。**
  // 实测：`FREQ=SECONDLY` 配上零点起始会让 ical.js 自己抛
  // "Same occurrence found twice, protecting you from death by recursion"。
  // 我只把 fromString 包了 try/catch，于是这句话只写在了注释里、
  // 并没有真的成立：一个用户打错的规则仍然能让整个任务列表崩掉。
  try {
    const iterator = recur.iterator(toIcalTime(dtstart));
    let iterations = 0;

    for (;;) {
      if (iterations >= maxIterations) break;
      iterations += 1;

      const next = iterator.next();
      if (next === null) break;

      const date = fromIcalTime(next);

      // 迭代器是升序的 —— 越过上界就可以停了
      if (date > to) break;
      if (date >= from) out.push(date);
    }
  } catch {
    // 把已经算出来的部分返回，而不是整体丢弃
    return out;
  }

  return out;
}

/**
 * 严格晚于 `after` 的下一次出现。没有则返回 `undefined`。
 *
 * 这是"完成后顺延"的基础：任务在 `after` 完成，下一次该排在什么时候。
 * **严格大于**很重要 —— 用 `>=` 会让完成后顺延到同一天，于是任务
 * 永远"今天到期"，用户怎么点都消不掉。
 */
export function nextOccurrence(
  rule: string,
  dtstart: LocalDate,
  after: LocalDate,
  options: RecurrenceRangeOptions = {},
): LocalDate | undefined {
  let recur: ICAL.Recur;
  try {
    recur = ICAL.Recur.fromString(rule);
  } catch {
    return undefined;
  }

  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  try {
    const iterator = recur.iterator(toIcalTime(dtstart));
    for (let i = 0; i < maxIterations; i += 1) {
      const next = iterator.next();
      if (next === null) return undefined;
      const date = fromIcalTime(next);
      if (date > after) return date;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * 从 `dtstart` 起的前 `count` 次出现。
 *
 * 用于"接下来 5 次"预览。无限规则在这里也必须终止。
 */
export function firstOccurrences(
  rule: string,
  dtstart: LocalDate,
  count: number,
  options: RecurrenceRangeOptions = {},
): LocalDate[] {
  if (count <= 0) return [];
  const capped = Math.min(count, options.maxIterations ?? DEFAULT_MAX_ITERATIONS);

  let recur: ICAL.Recur;
  try {
    recur = ICAL.Recur.fromString(rule);
  } catch {
    return [];
  }

  const out: LocalDate[] = [];
  try {
    const iterator = recur.iterator(toIcalTime(dtstart));
    for (let i = 0; i < capped; i += 1) {
      const next = iterator.next();
      if (next === null) break;
      out.push(fromIcalTime(next));
    }
  } catch {
    // 见 occurrencesInRange 的说明：迭代会抛错，用户输入不该炸掉界面
  }
  return out;
}

/**
 * "完成后顺延"：给定完成日期，算出下一次到期日。
 *
 * 与 `nextOccurrence` 的区别在于**语义**而不是实现：
 * 这里表达的是"这个实例已完成，下一个实例什么时候来"。
 * 完成后顺延尤其要注意 `dtstart` 的选择 —— 必须用**原始**起始日，
 * 用完成日当 `dtstart` 会让 `BYDAY`/`BYMONTHDAY` 的选择基准整体漂移。
 */
export function nextAfterCompletion(
  rule: string,
  dtstart: LocalDate,
  completedOn: LocalDate,
  options: RecurrenceRangeOptions = {},
): LocalDate | undefined {
  return nextOccurrence(rule, dtstart, completedOn, options);
}

/**
 * 给定日期是否命中该规则。
 *
 * 不要实现成"算一堆日期再 includes" —— 无限规则下那没有正确的上界。
 * 这里从 `dtstart` 迭代到目标日期即停。
 */
export function occursOn(
  rule: string,
  dtstart: LocalDate,
  date: LocalDate,
  options: RecurrenceRangeOptions = {},
): boolean {
  if (date < dtstart) return false;

  // 目标当天也算命中，所以上界取当天
  const hits = occurrencesInRange(rule, dtstart, dtstart, date, {
    ...options,
    // 窗口跨度可能很大（例如从 2020 年迭代到 2030 年），
    // 迭代次数上限按天数量级放宽
    maxIterations: options.maxIterations ?? Math.max(DEFAULT_MAX_ITERATIONS, diffDays(date, dtstart) + 10),
  });
  return hits.includes(date);
}

/**
 * 常用规则的构造助手。
 *
 * 存在的意义是**避免 UI 层手拼 RRULE 字符串** ——
 * 拼错一个分号不会报错，只会静默变成另一条规则。
 */
export const Recurrence = {
  daily: (interval = 1): string => `FREQ=DAILY;INTERVAL=${String(interval)}`,
  weekly: (byDays: string[], interval = 1): string =>
    `FREQ=WEEKLY;INTERVAL=${String(interval)};BYDAY=${byDays.join(',')}`,
  monthlyOnDay: (day: number, interval = 1): string =>
    `FREQ=MONTHLY;INTERVAL=${String(interval)};BYMONTHDAY=${String(day)}`,
  monthlyOnNthWeekday: (nth: number, weekday: string, interval = 1): string =>
    `FREQ=MONTHLY;INTERVAL=${String(interval)};BYDAY=${nth >= 0 ? '+' : ''}${String(nth)}${weekday}`,
  yearly: (month: number, day: number): string =>
    `FREQ=YEARLY;BYMONTH=${String(month)};BYMONTHDAY=${String(day)}`,
} as const;

/** BYDAY 的星期部分 → 中文。`+2WE` / `-1FR` 里的序数要先剥掉。 */
const WEEKDAY_NAMES: Record<string, string> = {
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六',
  SU: '日',
};

/** 解析失败一律返回 `null`，调用方自己决定怎么显示原始串。 */
function parseRecur(rule: string): ICAL.Recur | null {
  try {
    return ICAL.Recur.fromString(rule);
  } catch {
    return null;
  }
}

/**
 * 规则的**结构化**描述：只说"是什么"，不说"怎么说"。
 *
 * ## 为什么要有它
 *
 * `describeRecurrence` 把语义和措辞焊在了一起 —— 它返回的是**中文句子**
 * （「每周一、三」）。这对单语时代没问题，但它意味着：任何要按别的语言渲染的壳
 * 都只能**再写一个 RRULE 解析器**，而 RFC 5545 的 `BYDAY`/`BYMONTHDAY` 组合语义
 * 极为刁钻（本文件开头那段警告），两份解析器迟早会在某个边缘上分叉，
 * 而且是"看起来对、偶尔错一次"那种。
 *
 * 所以把解析结果抽出来：`packages/domain` 仍然是**唯一**的解析者，
 * 措辞交给壳（`apps/mobile/src/lib/recurrence-display.ts` 是第一个消费者）。
 * 与 `formatRemaining` → `remainingText` 是同一个套路：语义留域层，措辞搬壳里。
 *
 * ## 返回 `null` 的含义
 *
 * `null` = **这条规则描述不了**，调用方应当直接显示原始串。三种情况：
 * 解析失败、`FREQ` 不是我们认识的那四种、或者数据形状超出预期
 * （例如认不出的星期码 —— 这种输入在 RFC 里不合法，但规则串是外部来源，
 * 不能假设它合法）。
 *
 * 🔴 这里**刻意比 `describeRecurrence` 严格**：后者认不出星期码时会原样回显
 * （`周+1MO`），而回显一个内部码更像是 bug 而不是解释。两条路径对**合法**输入
 * 逐字一致，这一点由 `apps/mobile/tests/recurrence-display.spec.ts` 里的
 * 等价性用例钉住（拿 `describeRecurrence` 当独立参照）。
 */
export type RecurrenceParts =
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: string[] }
  | { kind: 'monthlyByMonthDay'; interval: number; monthDays: number[] }
  | { kind: 'monthlyByWeekday'; interval: number; byDays: string[] }
  | { kind: 'monthly'; interval: number }
  | { kind: 'yearly'; interval: number; months: number[]; monthDays: number[] };

export function recurrenceParts(rule: string): RecurrenceParts | null {
  const recur = parseRecur(rule);
  if (recur === null) return null;

  const interval = (recur.interval ?? 1) as number;

  switch (recur.freq) {
    case 'DAILY':
      return { kind: 'daily', interval };

    case 'WEEKLY': {
      const days = recur.parts.BYDAY ?? [];
      if (days.length === 0) return { kind: 'weekly', interval, weekdays: [] };
      const weekdays: string[] = [];
      for (const day of days) {
        // WEEKLY 的 BYDAY 按 RFC 不带序数，但仍然剥一次：串是外部来源，
        // 写成 `+1MO` 时不该把它当成一个"星期码"。
        const code = day.replace(/^[+-]?\d*/, '');
        if (WEEKDAY_NAMES[code] === undefined) return null;
        weekdays.push(code);
      }
      return { kind: 'weekly', interval, weekdays };
    }

    case 'MONTHLY': {
      const rawMonthDays = recur.parts.BYMONTHDAY ?? [];
      if (rawMonthDays.length > 0) {
        const monthDays = rawMonthDays.map(toNumber);
        // 认不出数字就**不猜**：宁可显示原始串，也不要显示一个编出来的日子。
        if (monthDays.some((n) => !Number.isFinite(n))) return null;
        return { kind: 'monthlyByMonthDay', interval, monthDays };
      }
      const days = recur.parts.BYDAY ?? [];
      if (days.length > 0) {
        // `+2WE` / `-1FR` 的序数**必须保留**：「每月第 2 个周三」和「每个周三」是两回事。
        return { kind: 'monthlyByWeekday', interval, byDays: [...days] };
      }
      return { kind: 'monthly', interval };
    }

    case 'YEARLY': {
      const months = (recur.parts.BYMONTH ?? []).map(toNumber);
      const monthDays = (recur.parts.BYMONTHDAY ?? []).map(toNumber);
      if (months.some((n) => !Number.isFinite(n))) return null;
      if (monthDays.some((n) => !Number.isFinite(n))) return null;
      return { kind: 'yearly', interval, months, monthDays };
    }

    default:
      return null;
  }
}

function toNumber(raw: number | string): number {
  return typeof raw === 'number' ? raw : Number(raw);
}

/**
 * 规则的人类可读描述（中文）。取不到就用原始串。
 *
 * 🔴 **这里曾经把「每」吞掉。** 原来是
 * `const every = interval === 1 ? '' : \`每 ${interval} \``，
 * 而各分支拼的是 `` `${every}天` `` / `` `${every}周…` `` ——
 * 于是在**最常见**的 interval === 1 下，用户看到的是：
 *
 * | 规则 | 旧输出（错） | 现在 |
 * |---|---|---|
 * | `FREQ=DAILY` | 天 | 每天 |
 * | `FREQ=WEEKLY;BYDAY=SA` | 周六 | 每周六 |
 * | `FREQ=WEEKLY;BYDAY=MO,WE` | 周一、三 | 每周一、三 |
 *
 * 而 interval === 2 反而是对的（「每 2 天」）—— 因为那条路径的 `every`
 * 自己带了「每」。**只有默认分支是坏的**，所以它躲过了所有间隔>1 的用例。
 *
 * ⚠️ 更要紧的是：`tests/recurrence.spec.ts` 当时**把错的那两个字符串钉住了**
 * （`toBe('天')` / `toBe('周一、三')`）。也就是说测试是绿的、实现是错的，
 * 而绿的原因是**断言写成了实现的复述**，不是意图。
 * 见 AGENTS.md §8.3/§8.4：断言要能回答"用户看到的是不是他想看到的"。
 *
 * 另外补上原实现丢掉的**时间信息**：`MONTHLY` 会说清是几号
 * （`FREQ=MONTHLY;BYMONTHDAY=14` → 「每月 14 日」），
 * 而不是只给一个「每月」——用户无法从「每月」知道是哪一天。
 */
export function describeRecurrence(rule: string): string {
  const recur = parseRecur(rule);
  if (recur === null) return rule;

  const interval = (recur.interval ?? 1) as number;
  // 「每」是频率词的一部分，**不能**只在 interval > 1 时才出现。
  const every = interval === 1 ? '每' : `每 ${String(interval)} `;

  switch (recur.freq) {
    case 'DAILY':
      return `${every}天`;

    case 'WEEKLY': {
      const days = recur.parts.BYDAY ?? [];
      if (days.length === 0) return `${every}周`;
      // WEEKLY 的 BYDAY 不带序数（RFC 5545 只允许 MONTHLY/YEARLY），
      // 仍然剥一次：串是外部来源，写成 `+1MO` 也不该显示成「周+1MO」。
      return `${every}周${days
        .map((d) => WEEKDAY_NAMES[d.replace(/^[+-]?\d*/, '')] ?? d)
        .join('、')}`;
    }

    case 'MONTHLY': {
      const monthDays = recur.parts.BYMONTHDAY ?? [];
      if (monthDays.length > 0) {
        const dayText = monthDays.map(describeMonthDay).join('、');
        // 数字日写「每月 14 日」，特殊日写「每月最后一天」——
        // 直接套 `${n} 日` 会得到「每月 最后一天 日」。混合时按首项决定空格。
        const sep = /^\d/.test(dayText) ? ' ' : '';
        return `${every}月${sep}${dayText}`;
      }
      const days = recur.parts.BYDAY ?? [];
      if (days.length > 0) {
        // `+2WE` = 「第 2 个周三」，`-1FR` = 「最后一个周五」。
        // 旧实现把序数剥掉后显示成「周三」—— 那是**错的**，不是不精确：
        // 「每月第 2 个周三」和「每个周三」是完全两回事。
        return `${every}月${days.map(describeMonthlyByDay).join('、')}`;
      }
      return `${every}月`;
    }

    case 'YEARLY': {
      const months = recur.parts.BYMONTH ?? [];
      const monthDays = recur.parts.BYMONTHDAY ?? [];
      if (months.length > 0 && monthDays.length > 0) {
        return `${every}年 ${months.join('、')} 月 ${monthDays.join('、')} 日`;
      }
      if (months.length > 0) return `${every}年 ${months.join('、')} 月`;
      return `${every}年`;
    }

    default:
      return rule;
  }
}

/** `14` → `14 日`；`-1` → `最后一天`；`-2` → `倒数第 2 天`。 */
function describeMonthDay(raw: number | string): string {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === -1) return '最后一天';
  if (n < 0) return `倒数第 ${String(-n)} 天`;
  return `${String(n)} 日`;
}

/** `+2WE` → `第 2 个周三`；`-1FR` → `最后一个周五`；`WE` → `周三`。 */
function describeMonthlyByDay(raw: string): string {
  const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(raw);
  const weekday = WEEKDAY_NAMES[m?.[2] ?? raw] ?? raw;
  const nth = m?.[1];
  if (nth === undefined) return `周${weekday}`;
  const n = Number(nth);
  if (n === -1) return `最后一个周${weekday}`;
  if (n < 0) return `倒数第 ${String(-n)} 个周${weekday}`;
  return `第 ${String(n)} 个周${weekday}`;
}

export { addDays, parseLocalDate, toLocalDate };
