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
 * 打卡是否算"达成"。
 *
 * ⚠️ **导出**是刻意的：`habit-resilience.ts` 必须用同一套判据。
 * 两个模块各写一遍 `goalType` 的 switch，症状是"连续天数说达成、
 * 成就徽章说没达成"，且两边都不报错。
 */
export function isAchieved(habit: Habit, log: HabitLog): boolean {
  const target = habit.target ?? 1;
  const value = log.value ?? target;
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
 * 连续是否还"活着"：从今天往回看，在一个允许的宽限期内
 * 是否存在应打卡却未打卡的日子。
 *
 * 宽限规则：
 *   - 每日习惯：允许昨天未打（今天还有机会）
 *   - 其他频率：允许一个完整周期（按最长的周频率算 7 天）
 */
function isStillAlive(
  habit: Habit,
  lastDate: LocalDate,
  today: LocalDate,
  achieved: Set<LocalDate>,
): boolean {
  const gap = diffDays(lastDate, today);
  const grace = habit.frequency?.type === 'daily' || habit.frequency === undefined ? 1 : 7;
  if (gap <= grace) return true;

  // 超过宽限期：检查宽限期内是否有"应打卡但没打"的日子
  let c = lastDate;
  let missed = 0;
  for (let i = 0; i < gap; i++) {
    c = addDays(c, 1);
    if (diffDays(c, today) < 0) break;
    if (isScheduledOn(habit.frequency, c) && !achieved.has(c)) missed++;
    if (missed >= grace) return false;
  }
  return missed < grace;
}

/**
 * 习惯在给定日期的完成进度（0–1）。
 * UI 用来画环形进度，避免在组件里重复实现这个除法。
 */
export function completionRatio(habit: Habit, log: HabitLog | undefined): number {
  const target = habit.target ?? 1;
  if (target <= 0) return 0;
  const value = log?.value ?? 0;
  return Math.min(1, value / target);
}
