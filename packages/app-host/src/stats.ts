/**
 * 统计视图的读侧接线（覆盖图谱 #16 / #46 / #48 / #50）
 * =====================================================
 *
 * 与 `focus-overview.ts` / `motivation.ts` 同一个分工：
 *   - **口径**全在 `@heyta/domain` 的纯函数里（`habitCheckInRecords` /
 *     `habitWeeklyRateSeries` / `habitStreakSeries` / `focusSeries` /
 *     `computeTodayProgress` / `computeWeeklyReview`）；
 *   - 本层只做**摊平 + 滤墓碑 + 注入 now**，让 web / mobile 拉同一份投影。
 *
 * 🔴 「一个数都不在这里自己 reduce」—— 这里出现第二份算法，就是
 * "手机说 4、网页说 3"那类静默漂移的开始（AGENTS §3.5）。
 *
 * ⚠️ `now` 一律由调用方传入，内部不读 `Date.now()`（可测、跨午夜一致）。
 */

import {
  countCheckInsOn,
  focusSeries,
  habitCheckInRecords,
  habitStreakSeries,
  habitWeeklyRateSeries,
  toLocalDate,
  type FocusSeriesBucket,
  type FocusSeriesPoint,
  type HabitCheckInRecord,
  type HabitRateBucket,
  type HabitStreakPoint,
  type LocalDate,
} from '@heyta/domain';

import { aliveRecords } from './category-report.js';
import { todayProgressFromState, weeklyReviewFromState, type MotivationTables } from './motivation.js';

/** 某习惯的逐条打卡记录（#46）。找不到习惯时返回空列表（不抛）。 */
export function habitCheckInRecordsFromState(
  state: MotivationTables,
  habitId: string,
): HabitCheckInRecord[] {
  const habit = state.habits[habitId];
  if (habit === undefined) return [];
  return habitCheckInRecords(habit, aliveRecords(state.habitLogs));
}

/** 某习惯的完成率趋势（#48 柱状图）。 */
export function habitRateSeriesFromState(
  state: MotivationTables,
  habitId: string,
  now: number,
  weeks: number,
): HabitRateBucket[] {
  const habit = state.habits[habitId];
  if (habit === undefined) return [];
  return habitWeeklyRateSeries(habit, aliveRecords(state.habitLogs), toLocalDate(now), weeks);
}

/** 某习惯的连续天数趋势（#48 折线图）。 */
export function habitStreakSeriesFromState(
  state: MotivationTables,
  habitId: string,
  now: number,
  weeks: number,
): HabitStreakPoint[] {
  const habit = state.habits[habitId];
  if (habit === undefined) return [];
  return habitStreakSeries(habit, aliveRecords(state.habitLogs), toLocalDate(now), weeks);
}

/** 专注统计序列（#50 日/周/月图表）。只含工作段、只含未删除记录。 */
export function focusSeriesFromState(
  state: MotivationTables,
  now: number,
  bucket: FocusSeriesBucket,
  count: number,
): FocusSeriesPoint[] {
  return focusSeries(aliveRecords(state.focusSessions), toLocalDate(now), bucket, count);
}

/** 总结屏（#16）两段数字：今天 / 本周。 */
export interface SummarySnapshot {
  readonly today: {
    readonly tasksDone: number;
    readonly focusMinutes: number;
    readonly checkIns: number;
  };
  readonly week: {
    readonly tasksDone: number;
    readonly checkIns: number;
    readonly focusMinutes: number;
    readonly weekStart: LocalDate;
    readonly weekEnd: LocalDate;
  };
}

/**
 * 今日 / 本周的总结数字。
 *
 * 口径复用已有的两个出口：`todayProgressFromState`（今日）与
 * `weeklyReviewFromState`（本周），今日打卡条数走 `countCheckInsOn`。
 * 三者都不在这里重算 —— 它们各自已是"唯一实现"。
 */
export function summaryFromState(state: MotivationTables, now: number): SummarySnapshot {
  const today = toLocalDate(now);
  const progress = todayProgressFromState(state, now);
  const review = weeklyReviewFromState(state, now);
  return {
    today: {
      tasksDone: progress.tasksDone,
      focusMinutes: progress.focusMinutes,
      checkIns: countCheckInsOn(aliveRecords(state.habitLogs), today),
    },
    week: {
      tasksDone: review.tasksCompleted,
      checkIns: review.checkIns,
      focusMinutes: review.focusMinutes,
      weekStart: review.weekStart,
      weekEnd: review.weekEnd,
    },
  };
}
