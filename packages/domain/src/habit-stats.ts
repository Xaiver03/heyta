/**
 * 习惯统计的读侧（覆盖图谱 #46 打卡记录 / #48 统计图表的数据来源）
 * ================================================================
 *
 * 这里是**「统计怎么算」的唯一实现**（纯函数、可单测）：
 *
 *   · {@link habitCheckInRecords} —— 逐条打卡记录（#46 的「带值/时间」清单）；
 *   · {@link habitWeeklyRateSeries} —— 近 N 个 7 天窗口的完成率序列（#48 柱状图）；
 *   · {@link habitStreakSeries} —— 近 N 周周末的连续天数序列（#48 折线图）；
 *   · {@link countCheckInsOn} —— 某一天的打卡条数（#16 今日打卡）。
 *
 * 🔴 判定口径一个都不在这里重新发明：达成判据用 `isAchieved`、计划日判据用
 * `isScheduledOn`、连续天数用 `computeStreak`、一条记录代表的量用 `habitLogValue`。
 * 本文件只做**时间窗口的切分与聚合**——那正是"统计"这件事本身。
 *
 * ⚠️ 与 `computeHabitPeriodStats`（单自然月）分工不同：那边是"本月四格"，
 * 这里要的是**能画成图的多点序列**。两者共用同一套达成/计划日判据，
 * 所以「本月完成率」与「最近一个窗口完成率」不会各讲一个故事。
 *
 * ⚠️ `today` 一律由调用方传入（本仓既有纪律：内部读 `Date.now()` 会让
 * 月中/月末/跨年这些边界不可测）。窗口**右端恒为 `today`**（含当天）。
 */

import type { Habit, HabitLog } from './entities.js';
import { addDays, diffDays, toLocalDate, type LocalDate } from './date.js';
import {
  computeStreak,
  habitLogValue,
  isAchieved,
  isScheduledOn,
} from './habit-streak.js';

/** 一条打卡记录（#46 列表的一行）。 */
export interface HabitCheckInRecord {
  /** 打卡记录实体 id。 */
  readonly id: string;
  /** 打卡日期（本地日历日 `YYYY-MM-DD`）。 */
  readonly date: LocalDate;
  /** 这一条记录代表的量（走 `habitLogValue` 的唯一缺省：无 value 时按 target）。 */
  readonly value: number;
  /** 记录生成时间（epoch ms，用于「几点打的」那一列）。 */
  readonly at: number;
  /** 是否达成（`isAchieved`，与连续天数同一判据）。 */
  readonly achieved: boolean;
}

/**
 * 某习惯的逐条打卡记录，**新到旧**。
 *
 * 过滤：只留 `habitId === habit.id` 且未删除的；墓碑（撤销）不算发生过。
 * 排序：日期倒序；同一天多条时按 `createdAt` 倒序（后打的在上），
 * 同日同刻按 id 决胜 —— 与领域层其它列表同一条"确定性排序"纪律。
 */
export function habitCheckInRecords(
  habit: Habit,
  logs: readonly HabitLog[],
): HabitCheckInRecord[] {
  return logs
    .filter((log) => log.habitId === habit.id && log.deletedAt === undefined)
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((log) => ({
      id: log.id,
      date: log.date,
      value: habitLogValue(habit, log),
      at: log.createdAt,
      achieved: isAchieved(habit, log),
    }));
}

/**
 * 某一天的打卡条数（#16 今日打卡）。
 *
 * 只数未删除的记录；同一天多条算多条（"今天打了 3 次卡"是真的 3 次）。
 * `date` 是本地日历日 `YYYY-MM-DD`。
 */
export function countCheckInsOn(logs: readonly HabitLog[], date: LocalDate): number {
  let n = 0;
  for (const log of logs) {
    if (log.deletedAt !== undefined) continue;
    if (log.date === date) n += 1;
  }
  return n;
}

/** 近 N 个 7 天窗口里的一格（#48 柱状图的一根柱）。 */
export interface HabitRateBucket {
  /** 窗口首日（含）。 */
  readonly start: LocalDate;
  /** 窗口末日（含）。 */
  readonly end: LocalDate;
  /** 窗口内**已到期**的计划日数（分母）。0 表示"这一段还没有率可言"。 */
  readonly scheduledDays: number;
  /** 窗口内达成且落在计划日上的天数（分子）。 */
  readonly achievedDays: number;
  /** 完成率 0–1。`scheduledDays === 0` 时恒为 0（绝不产生 NaN）。 */
  readonly rate: number;
}

/**
 * 近 `weeks` 个 7 天窗口的完成率序列，**旧 → 新**（最后一格含今天）。
 *
 * 窗口按"连续的 7 天、右端贴 `today`"切：
 *   · 最后一格 = `[today-6, today]`；上一格 = `[today-13, today-7]`；……
 * 分母只数**已到期的计划日**，且下界不早于该习惯的创建日 —— 与
 * `computeHabitPeriodStats` 同一口径（未到的日子不是"做得不好"）。
 */
export function habitWeeklyRateSeries(
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
  weeks = 8,
): HabitRateBucket[] {
  const count = Math.max(1, Math.floor(weeks));
  const created = toLocalDate(habit.createdAt);
  const alive = logs.filter(
    (log) => log.habitId === habit.id && log.deletedAt === undefined,
  );
  const achievedDates = new Set(
    alive.filter((log) => isAchieved(habit, log)).map((log) => log.date),
  );

  const out: HabitRateBucket[] = [];
  for (let i = 0; i < count; i += 1) {
    const end = addDays(today, -(count - 1 - i) * 7);
    const start = addDays(end, -6);
    const lower = start > created ? start : created;
    const upper = end < today ? end : today;

    let scheduledDays = 0;
    let achievedDays = 0;
    if (lower <= upper) {
      const steps = diffDays(lower, upper);
      let cursor = lower;
      for (let d = 0; d <= steps; d += 1) {
        if (isScheduledOn(habit.frequency, cursor)) {
          scheduledDays += 1;
          if (achievedDates.has(cursor)) achievedDays += 1;
        }
        cursor = addDays(cursor, 1);
      }
    }
    out.push({
      start,
      end,
      scheduledDays,
      achievedDays,
      rate: scheduledDays === 0 ? 0 : achievedDays / scheduledDays,
    });
  }
  return out;
}

/** 连续天数趋势上的一个采样点（#48 折线图的一点）。 */
export interface HabitStreakPoint {
  /** 采样日（该 7 天窗口的末日）。 */
  readonly date: LocalDate;
  /** 截至采样日的当前连续天数（`computeStreak(...).current`）。 */
  readonly streak: number;
}

/**
 * 近 `weeks` 周（每次取 7 天窗口末日）的连续天数采样序列，旧 → 新。
 *
 * 为什么按周采样而不是按天：连续天数本身是按**计划日**走的，按天画会在
 * 非计划日上出现一排"看起来断了"的点（其实那天本就不用打卡）。
 * 周采样把噪声压下去，同时保留"这一周比上一周好没好"的读法。
 */
export function habitStreakSeries(
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
  weeks = 8,
): HabitStreakPoint[] {
  const count = Math.max(1, Math.floor(weeks));
  const out: HabitStreakPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = addDays(today, -(count - 1 - i) * 7);
    out.push({ date, streak: computeStreak(habit, logs, date).current });
  }
  return out;
}
