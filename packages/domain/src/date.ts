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

/**
 * 解析本地日历日为「本地零点的 Date」。
 *
 * 🔴 **必须校验范围，不能只校验格式。**
 *
 * `new Date(2026, 12, 40)` **不报错** —— 它自动进位成 `2027-02-09`。
 * 于是"2026 年 13 月 40 日"这种输入会**安静地变成另一个日子**。
 * 实测踩到：`node-host` 的 `add --due 2026-13-40` 建出了一个截止到
 * 2027-02-09 的任务，退出码 0，输出里还回显着用户写的那个字符串 ——
 * 看上去就像它按用户说的存了。
 *
 * 这类"输入非法 → 结果合法但错误"的静默行为，比直接崩掉危险得多：
 * 崩掉会有人来修，而错一天只会让用户在某天发现事情没提醒。
 *
 * 所以构造后**回读一遍**：年/月/日三项都必须与输入逐项相等。
 * 任何进位（2 月 30 日、13 月、40 日）都会让回读不相等而抛错。
 */
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
  const d = new Date(y!, m! - 1, day!);
  // 回读校验：Date 会把越界的月/日**自动进位**而不是报错。
  if (d.getFullYear() !== y || d.getMonth() !== m! - 1 || d.getDate() !== day) {
    throw new Error(`日期不存在（月/日越界或该月没有这一天）：${date}`);
  }
  return d;
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

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 把时间戳归到**本地时区**当天的 0 点。
 *
 * ⚠️ 必须用 `setHours`，不能写 `ts - (ts % DAY_MS)`：
 * 后者按 UTC 切分，在东八区会把"今天 07:00"算成昨天 ——
 * 于是所有凌晨创建的条目都落到前一天（连续天数凭空断掉）。
 *
 * 🔴 从 `apps/mobile/src/lib/date.ts` 提到这里。移动端那份是**第二次实现**，
 * 而"用户的今天"必须三端是同一个概念（AGENTS.md §3.5）。
 */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 两个时间戳相差多少个**自然日**（按本地时区取整）。
 *
 * 与 `diffDays(a, b)` 的分工：那个吃 `LocalDate` 字符串，这个吃时间戳。
 * 两者都不要写成 `(a - b) / DAY_MS` —— 夏令时那天会差一小时。
 */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.round((startOfDay(fromMs) - startOfDay(toMs)) / DAY_MS);
}

/**
 * 某个时刻所属的**本地自然日窗口**：`[当天 0 点, 次日 0 点)`。
 *
 * 用半开区间而不是闭区间：闭区间要么两端的归属有歧义、要么需要 `-1`，
 * 而"某个时刻属不属于今天"应当是一次简单比较。
 */
export function dayRange(ms: number): { start: number; end: number } {
  const start = startOfDay(ms);
  const d = new Date(start);
  // 用 setDate 而不是 +DAY_MS：夏令时切换那天次日 0 点可能相隔 23 或 25 小时。
  d.setDate(d.getDate() + 1);
  return { start, end: d.getTime() };
}

// ─────────────────────────────────────────────────────────────
// 月历
// ─────────────────────────────────────────────────────────────
//
// 放在 `packages/domain` 而不是某个壳里：这是**纯日历数学**，与平台无关，
// 而 Web / iOS / 鸿蒙三端都需要它。各端各写一份的下场是
// "同一天在一端是今天、在另一端不是"（AGENTS.md §3.5）。

/**
 * 某年某月的天数。`month` 是 **1..12**，不是 JS `Date` 的 0..11。
 *
 * 用"下个月的第 0 天"取，闰年交给原生 `Date` —— 不要自己写 `% 4` 那套规则，
 * 世纪闰年的例外很容易漏。
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 当月第一天。 */
export function startOfMonth(date: LocalDate): LocalDate {
  const d = parseLocalDate(date);
  return toLocalDate(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
}

/**
 * 加减月份。
 *
 * 🔴 **必须把"日"夹到目标月的最大天数。** 朴素的 `setMonth(+1)` 在
 * `2026-01-31` 上会得到 `2026-03-03` —— 2 月没有 31 日，多出来的 3 天**溢出**到 3 月。
 * 用户在 1 月底点"下个月"，看到的会是 3 月，而且中间那一整月被跳过去了。
 */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const d = parseLocalDate(date);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const day = Math.min(d.getDate(), daysInMonth(target.getFullYear(), target.getMonth() + 1));
  return toLocalDate(new Date(target.getFullYear(), target.getMonth(), day).getTime());
}

/** 一周七列。 */
export const DAYS_PER_WEEK = 7;

/** 月历网格的一个格子。 */
export interface MonthGridCell {
  date: LocalDate;
  /** `false` = 属于上/下个月的补白格（视觉上次要，但仍然可点选）。 */
  inMonth: boolean;
}

/**
 * 月历网格：**固定 6 行 × 7 列 = 42 格**，**周一开头**。
 *
 * 🔴 **为什么固定 6 行**，而不是"5 行或 6 行"：
 * 翻转月份时行数一变，整个网格就跳一下 —— 而用户此刻正按**位置**找日子。
 * 多出来的那一行是空白，不是噪声；一个不跳的网格比一个更紧凑的网格重要。
 *
 * 🔴 **补白格带真实日期**（上月末 / 下月初），不是 `null`：
 * "点上月 30 号"和"点本月 1 号"都是合法意图，把它做成不可点才是意外。
 * `inMonth` 只决定视觉上次要多少。
 *
 * 周一开头与 `isoWeekday`（1=周一）一致，也符合中文日历习惯。
 */
export function monthGrid(date: LocalDate): MonthGridCell[][] {
  const first = startOfMonth(date);
  const lead = isoWeekday(first) - 1; // 周一开头时前置几个补白格
  const start = addDays(first, -lead);
  const prefix = first.slice(0, 7);

  const cells: MonthGridCell[] = [];
  for (let i = 0; i < DAYS_PER_WEEK * 6; i += 1) {
    const cellDate = addDays(start, i);
    cells.push({ date: cellDate, inMonth: cellDate.slice(0, 7) === prefix });
  }

  const weeks: MonthGridCell[][] = [];
  for (let w = 0; w < 6; w += 1) {
    weeks.push(cells.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK));
  }
  return weeks;
}

/**
 * 紧凑日期：`09-26`。**跨年时带上年份**（`2027-01-05`）——
 * 否则"1 月 5 日"在一年的头几天里看不出是哪一年。
 *
 * 🔴 从 `apps/web` 的 `DueBadge` 提到这里。原来 Web 自己有一份，
 * 移动端要做同一个徽标时就得再写一份 —— 而两份的差别通常是
 * "一端同年省略年份、另一端不省略"，用户会以为是两个不同的日期。
 * 展示约定和日历数学一样，属于两端必须一致的东西。
 *
 * 同样**不用 `Intl`**（理由见 `formatMonthTitle`）。
 */
export function formatCompactDate(timestamp: number, now: number): string {
  const d = new Date(timestamp);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() === new Date(now).getFullYear()
    ? `${mm}-${dd}`
    : `${String(d.getFullYear())}-${mm}-${dd}`;
}

/**
 * 「2026年9月」。
 *
 * 🔴 **不用 `Intl.DateTimeFormat`。** Hermes 上 `Intl` 是**可选**的：
 * 这个构建里有、下一个构建可能就没有，而没有就是启动即崩。
 * 手写难看一点，但它不会在别人的手机上炸。
 */
export function formatMonthTitle(date: LocalDate): string {
  const d = parseLocalDate(date);
  return `${String(d.getFullYear())}年${String(d.getMonth() + 1)}月`;
}

/**
 * 周一…周日的单字标签，**下标 0 = 周一**（与 `isoWeekday` 的 1..7 对齐）。
 *
 * 用途是**日历的列头**（`一 二 三 四 五 六 日`），不是标题里的星期名。
 *
 * 🔴 放在这里而不是各端自己写一个数组：`monthGrid` 是周一开头，
 * 只要有一端写成周日开头，整个日历就会**整体错位一格** ——
 * 而错位后的界面看上去仍然像个正常日历，没人会一眼发现。
 */
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** 标题里的星期全称，下标 0 = 周一。 */
const WEEKDAY_FULL = [
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
  '星期日',
] as const;

/**
 * 「9月26日 星期五」。**某一天的标题只有这一个实现。**
 *
 * 🔴 从 `apps/mobile/src/lib/date.ts` 的 `formatToday(now)` 上移而来。
 * 原来那边有一份（收时间戳、全称星期），而日历需要同一件事时就会写出第二份
 * （收 `LocalDate`、简称星期）—— 于是同一个日子在两处显示成
 * 「9月26日 星期五」和「9月26日 周五」。这种差异不会有人报 bug，
 * 它只会让应用显得不整齐。**收 `LocalDate` 而不是时间戳**：
 * "哪一天"在领域层已经是 `LocalDate`，传时间戳进来还要再切一次时区。
 *
 * 与 `formatMonthTitle` 同一个理由不用 `Intl`（Hermes 上 `Intl` 是可选依赖）。
 * 月份与日期**不补前导零**：这是给人读的标题，`9月5日` 比 `09月05日` 自然；
 * 需要机器可比的紧凑格式时用 `formatCompactDate`。
 */
export function formatDayTitle(date: LocalDate): string {
  const d = parseLocalDate(date);
  const weekday = WEEKDAY_FULL[isoWeekday(date) - 1];
  return `${String(d.getMonth() + 1)}月${String(d.getDate())}日 ${String(weekday)}`;
}
