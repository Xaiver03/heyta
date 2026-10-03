/**
 * 习惯连续天数（Streak）
 * =========================
 *
 * 调研结论：**没有成熟的开源库**能用（closest 是 habitica 的服务端逻辑，
 * 与我们的数据模型不匹配且非独立包）。所以这里自研，但要写得可测。
 *
 * 最容易搞错的三件事，全部显式处理：
 *   1. **"今天还没打卡"不应该断掉连续天数。** 用户上午看应用，
 *      昨天打了、今天还没打，streak 不能显示 0 —— 那会让人以为记录丢了。
 *   2. **非每日习惯要按频率判断。** 每周一三五的习惯，周二没打卡不是断。
 *   3. **补打卡**要计入，但要有上限，否则连续天数失去意义。
 */

import type { Habit, HabitFrequency, HabitLog } from './entities.js';
import {
  addDays,
  diffDays,
  isoWeekday,
  type LocalDate,
} from './date.js';

export interface StreakResult {
  /** 当前连续天数。 */
  current: number;
  /** 历史最长连续天数。 */
  longest: number;
  /** 最后一次打卡日期。从未打卡时为 undefined。 */
  lastDate?: LocalDate;
}

/** 某天是否应该是"该打卡的日子"。 */
export function isScheduledOn(frequency: HabitFrequency | undefined, date: LocalDate): boolean {
  // 未设置频率 = 每天
  if (frequency === undefined) return true;

  switch (frequency.type) {
    case 'daily':
      return true;
    case 'weekly':
      return frequency.daysOfWeek.includes(isoWeekday(date));
    case 'interval': {
      // 固定间隔：用天数序号取模。基准取 1970-01-01（周四），
      // 只要基准固定，间隔判定就是确定的。
      const every = Math.max(1, frequency.everyNDays);
      const days = diffDays('1970-01-01', date);
      return ((days % every) + every) % every === 0;
    }
  }
}

/**
 * 这一天**记了几格**（工单 W6 的那个数的唯一算法）。
 *
 * 🔴 规则只有一条：**一条存在的打卡记录没写 `value` 时按 `target` 算，不是按 0**。
 * 理由是写路径就是这么写的（`@heyta/app-host#checkIn` 缺省落进 `habit.target ?? 1`），
 * 而"打过卡"在界面上只能有一个意思。
 * 这条以前**没有所有者**：`isAchieved` 用 `?? target`、`completionRatio` 用 `?? 0`、
 * 移动端的详情自己写了一遍 `?? target ?? 1` —— 三份答案是同一条不变量的三个断面，
 * 症状是"连续天数说今天达成、完成度说 0 %"，而两边都不报错。
 *
 * ⚠️ **根本没有记录**时返回 0（不是 target）：那是"今天没做"，
 * 与"做了但没记量"是两件事，必须分开。
 */
export function habitLogValue(habit: Habit, log: HabitLog | undefined): number {
  if (log === undefined) return 0;
  return log.value ?? habit.target ?? 1;
}

/**
 * 打卡是否算"达成"。
 *
 * ⚠️ **导出**是刻意的：`habit-resilience.ts` 必须用同一套判据。
 * 两个模块各写一遍 `goalType` 的 switch，症状是"连续天数说达成、
 * 成就徽章说没达成"，且两边都不报错。
 */
export function isAchieved(habit: Habit, log: HabitLog): boolean {
  const target = habit.target ?? 1;
  const value = habitLogValue(habit, log);
  switch (habit.goalType ?? 'atLeast') {
    case 'atLeast':
      return value >= target;
    case 'atMost':
      return value <= target;
    case 'exactly':
      return value === target;
  }
}

/**
 * 计算连续天数。
 *
 * @param habit 习惯定义
 * @param logs 该习惯的打卡记录（可不排序）
 * @param today 今天（本地日历日）。**必须显式传入** —— 内部读 Date.now()
 *              会让这个函数不可测，而它的边界条件恰恰最需要测。
 */
export function computeStreak(
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
): StreakResult {
  // 只保留达成且未删除的记录
  const achievedDates = new Set(
    logs
      .filter((l) => l.deletedAt === undefined && l.habitId === habit.id)
      .filter((l) => isAchieved(habit, l))
      .map((l) => l.date),
  );

  if (achievedDates.size === 0) {
    return { current: 0, longest: 0 };
  }

  const sorted = [...achievedDates].sort();
  const lastDate = sorted[sorted.length - 1]!;

  // ── 历史最长 ────────────────────────────────────────────
  // 只数**该打卡的日子**，跳过不该打卡的日子（否则每周一次的习惯永远只有 1）
  let longest = 0;
  let run = 0;
  let cursor = sorted[0]!;
  const end = sorted[sorted.length - 1]!;
  // 防御：损坏数据可能产生荒谬范围，限制扫描长度
  const maxSpan = 365 * 20;
  let guard = 0;
  while (diffDays(cursor, end) >= 0 && guard++ < maxSpan) {
    if (isScheduledOn(habit.frequency, cursor)) {
      if (achievedDates.has(cursor)) {
        run++;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
    cursor = addDays(cursor, 1);
  }

  // ── 当前连续 ────────────────────────────────────────────
  /**
   * 从最后打卡日往回数。
   *
   * 关键判断：**如果最后打卡日不是今天，且今天本来该打卡但还没打，
   * 也不应该立刻断掉。** 只有"今天该打卡却空着"且已经过了今天才算断 ——
   * 但我们无法判断"一天结束"（用户可能晚上才打）。
   *
   * 所以规则是：从**最后打卡日**往回数，而不是从今天往回数。
   * 这样"昨天打了、今天还没打"会正确显示为昨天的连续数，
   * 而不是 0。
   */
  let current = 0;
  let c = lastDate;
  guard = 0;
  while (guard++ < maxSpan) {
    if (isScheduledOn(habit.frequency, c)) {
      if (achievedDates.has(c)) {
        current++;
      } else {
        break;
      }
    }
    c = addDays(c, -1);
  }

  /**
   * 但如果最后打卡日离今天太远（超过一个完整周期没打），连续就该归零。
   * 否则用户三个月没打卡，界面还显示"连续 5 天"。
   */
  if (!isStillAlive(habit, lastDate, today, achievedDates)) {
    current = 0;
  }

  return { current, longest, lastDate };
}

/**
 * 连续是否还"活着"：从最后打卡日到今天之间，
 * 有没有"该打卡却空着"的日子。
 *
 * 规则只有一条，且对**所有频率**都一样：
 *   - 只看**计划日**（按 `isScheduledOn`），不看自然日
 *   - **今天不算漏**（还没过完，晚上还有机会）
 *   - 漏掉哪怕一个计划日就断
 *
 * 所以"每日习惯允许昨天没打"与"每周一次允许一个完整周期"不是两条规则，
 * 而是同一条规则在不同频率下的样子 —— 每日习惯的"下一个计划日"就是今天，
 * 每周一次的"下一个计划日"在 7 天后，扫描自然会把这段时间放行。
 *
 * ⚠️ 曾经这里写着"其他频率允许一个完整周期（7 天）"，并为此引入了一个
 * `grace` 阈值。**那个阈值是错的**，因为它同时被当作日历日和"漏了几次"
 * 使用，导致每 7 天一次的习惯可以漏 7 次。见下面 🔴 注释与
 * `tests/domain.spec.ts` 里的守卫。
 */
function isStillAlive(
  habit: Habit,
  lastDate: LocalDate,
  today: LocalDate,
  achieved: Set<LocalDate>,
): boolean {
  const gap = diffDays(lastDate, today);
  if (gap <= 0) return true;

  /**
   * 判据只有一条：从最后打卡日到今天之间，有没有**该打卡却空着**的日子。
   * 有就断。**不含今天** —— 今天还没过完，晚上还有机会（`current` 也是
   * 从最后打卡日往回数，两边口径必须一致，见上面的注释）。
   *
   * 🔴 这里**不要**再引入"宽限几天"的第二个阈值。
   *
   * 旧实现拿同一个 `grace` 当两种单位用：先用它比**日历日**
   * （`gap <= grace`），再用它比**漏掉的计划日个数**（`missed >= grace`）。
   * 每日习惯两者恰好相等（grace = 1），所以这个混用完全看不出来；
   * 但频率是"每 7 天一次"时，第二个比较就变成了「可以漏 **7 次**」——
   * 而注释写的意图是「允许**一个**完整周期」。
   * 实测后果：每 7 天一次的习惯漏掉 1~6 个计划日，界面仍然显示连续。
   *
   * "允许一个完整周期"这句话本来就由**逐日扫描**表达：扫描走完没有
   * 漏掉的计划日，就等于"下一个计划日还没到"。不需要额外的时间阈值。
   */
  let c = lastDate;
  for (let i = 0; i < gap; i++) {
    c = addDays(c, 1);
    if (diffDays(c, today) === 0) break; // 今天不算漏
    if (isScheduledOn(habit.frequency, c) && !achieved.has(c)) return false;
  }
  return true;
}

/**
 * 习惯在给定日期的完成进度（0–1）。
 * UI 用来画环形进度，避免在组件里重复实现这个除法。
 *
 * 🔴 分子走 {@link habitLogValue}，与 `isAchieved` **同一个缺省**。
 * 这里曾经是 `log?.value ?? 0` —— 于是"打过一条没写量的卡"会同时
 * 「算达成」（`isAchieved` 缺 target）与「完成度 0 %」（这里缺 0），
 * 而这两句话说的是同一格。W6 把"今天记了几格"定成只有一个答案之后，
 * 这条缺省就是那个唯一算法的第二个断面。
 */
export function completionRatio(habit: Habit, log: HabitLog | undefined): number {
  const target = habit.target ?? 1;
  if (target <= 0) return 0;
  return Math.min(1, habitLogValue(habit, log) / target);
}
