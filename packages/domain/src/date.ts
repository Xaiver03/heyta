/**
 * 本地日期工具
 * =============
 *
 * ⚠️ **为什么不用 UTC，也不用 dayjs/date-fns 的 UTC 模式：**
 *
 * 习惯打卡、今日视图、连续天数都建立在"用户的今天"这个概念上。
 * UTC 的"今天"对 UTC+8 的用户在早上 8 点前是**昨天** ——
 * 结果是用户早上打卡被记到前一天，连续天数凭空断掉。
 * 这类 bug 只在特定时区特定时段出现，极难复现。
 *
 * 所以：**一律用本地日历日**，并统一序列化成 `YYYY-MM-DD` 字符串。
 *
 * 本文件不依赖任何日期库 —— 这几个函数用原生 Date 就够，
 * 引入库反而多一层"它到底用的哪个时区"的不确定性。
 */

/** 本地日历日，格式 `YYYY-MM-DD`。 */
export type LocalDate = string;

/**
 * 把时间戳转成本地日历日。
 *
 * 用 `getFullYear/getMonth/getDate` 而不是 `toISOString()` ——
 * 后者是 UTC，正是本文件开头说的那个坑。
 */
export function toLocalDate(timestamp: number): LocalDate {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 解析本地日历日为「本地零点的 Date」。 */
export function parseLocalDate(date: LocalDate): Date {
  const parts = date.split('-');
  // ⚠️ 必须用 Number.isFinite，不能只判断 undefined。
  // `Number('not')` 得到的是 NaN 而不是 undefined ——
  // 我第一版就是只判 undefined，于是 'not-a-date' 静默通过了检查，
  // 最后变成 Invalid Date 到处传播。这类"守卫看起来写了但其实没生效"
  // 的 bug 最难发现，因为代码读起来是对的。
  if (parts.length !== 3) {
    throw new Error(`非法日期格式（应为 YYYY-MM-DD）：${date}`);
  }
  const [y, m, day] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) {
    throw new Error(`非法日期格式（应为 YYYY-MM-DD）：${date}`);
  }
  return new Date(y!, m! - 1, day!);
}

/**
 * 本地日历日加减天数。
 *
 * 用 Date 的溢出行为做加减，所以跨月、跨年、闰年都由原生逻辑处理。
 * **不要自己算 `date + n*86400000`** —— 夏令时切换那天会错一小时，
 * 累积后可能整日偏差。
 */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return toLocalDate(d.getTime());
}

/** 两个本地日历日相差的天数（b - a）。 */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const da = parseLocalDate(a);
  const db = parseLocalDate(b);
  // 都归到本地零点，再除掉一天。夏令时会让差值是 23 或 25 小时，
  // 所以用 round 而不是 floor。
  const ms = db.getTime() - da.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/** 星期几，1=周一 … 7=周日（ISO 8601，与 Habit.frequency.daysOfWeek 一致）。 */
export function isoWeekday(date: LocalDate): number {
  const jsDay = parseLocalDate(date).getDay(); // 0=周日
  return jsDay === 0 ? 7 : jsDay;
}

/** 今天（本地）。 */
export function today(now: number = Date.now()): LocalDate {
  return toLocalDate(now);
}
