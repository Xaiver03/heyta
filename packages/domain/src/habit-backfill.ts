/**
 * 补打卡窗口（backfill）—— `Habit.backfillDays` 的那位**读取者**
 * ============================================================
 *
 * ## 为什么这个文件存在
 *
 * `Habit.backfillDays`（`entities.ts`）从 P1 起就带着一条对外承诺：
 * [`docs/plans/phase-1-single-client-loop.md`](../../../docs/plans/phase-1-single-client-loop.md) §D4
 * 写着"补打卡上限由 `Habit.backfillDays` 控制"。而直到工单 H4 之前，全仓库对它的
 * 命中只有**两处声明 + 一处"刻意不出现"的注释**，零读取方 ——
 * 也就是说那句话从未兑现，而它不会报错：字段是可选的，写进去没人读，读的人以为有上限。
 *
 * 🔴 上限本身是**设计立场**，不是装饰：
 * [`docs/plans/motivation-and-progression.md`](../../../docs/plans/motivation-and-progression.md)
 * 把"无限补打卡"列成会削弱连续意义的那一格 —— 连续天数只有在"不能往回追"时才是事实。
 *
 * ## 默认值为什么是 `REPAIR_WINDOW_DAYS`，而不是一个新拍的数
 *
 * 工单前界面唯一的补打卡入口是韧性层那条"补回来"，窗口 = **昨天**
 * （`habit-resilience.ts` 的 `REPAIR_WINDOW_DAYS = 1`）。
 * 没设过 `backfillDays` 的习惯**今天的行为必须逐字不变**（还是只能补昨天），
 * 所以默认值从那条既有约束**推导**出来，而不是在这里再拍一个 7 或 30。
 * 界面如果以后要给用户选窗口，选的是**这个数的值**，判断仍然只在这一处。
 *
 * ## 窗口管的是"补"，不管"撤"
 *
 * `logged` 那一档**优先于**窗口判定：往回写一条新记录要受上限约束，
 * 而**取消一条已经存在的记录**不受 —— 因为"已经打过卡"是落盘的事实，
 * 把它锁在界面上不许动等于说用户永远不能纠正一次误点。
 */

import type { Habit, HabitLog } from './entities.js';
import { diffDays, type LocalDate } from './date.js';
import { REPAIR_WINDOW_DAYS } from './habit-resilience.js';
import { isScheduledOn } from './habit-streak.js';

/** 没设 `backfillDays` 时的窗口 —— 从既有约束推导，不另拍数字（见文件头）。 */
export const BACKFILL_DEFAULT_WINDOW_DAYS = REPAIR_WINDOW_DAYS;

/**
 * 这个习惯允许往回补几天（**不含今天**：今天打卡不是"补"）。
 *
 * ⚠️ 磁盘上的值先解析再用（同 `icon` / `frequency` 那条纪律）：`backfillDays` 是
 *    `number | undefined`，一个历史脏值（`0.5`、`-3`、`NaN`）不能让窗口变成负数
 *    而把"今天能不能打卡"也一起判掉 —— 那会是"界面上点不动"这种最难归因的坏。
 */
export function backfillWindowDays(habit: Habit): number {
  const n = habit.backfillDays;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return BACKFILL_DEFAULT_WINDOW_DAYS;
  return n;
}

/** 月历上一格的全部可能状态。**封闭词表**：宿主画的时候不许再加第六种。 */
export type HabitDayState =
  /** 这天已经有打卡记录（可撤销）。 */
  | 'logged'
  /** 今天、还没打、且是该打卡的日子（正常打卡入口）。 */
  | 'today'
  /** 过去的、该打、还没打、**在窗口内**（← 这一档才是"补打卡"）。 */
  | 'backfillable'
  /** 过去或将来，但按频次这天本来就不用打。 */
  | 'not-scheduled'
  /** 未来。 */
  | 'future'
  /** 过去的、该打、没打，但**超出窗口** —— 不能补。 */
  | 'too-old';

/** 这天属于这个习惯的那条记录（没有则 `undefined`）。 */
export function habitDayLog(habit: Habit, logs: readonly HabitLog[], date: LocalDate): HabitLog | undefined {
  // 与热力图同口径：**存在记录即算打过**，不看 `value` 够不够 `target`。
  // "打过"与"达成"是两件事（后者在 `isAchieved`），月历回答的是前者。
  return logs.find((log) => log.habitId === habit.id && log.date === date);
}

/** 一格的状态。判定顺序就是文件头那条优先级，别重排。 */
export function habitDayState(
  habit: Habit,
  logs: readonly HabitLog[],
  date: LocalDate,
  today: LocalDate,
): HabitDayState {
  if (habitDayLog(habit, logs, date) !== undefined) return 'logged';

  const age = diffDays(date, today); // >0 = 过去，0 = 今天，<0 = 未来
  if (age < 0) return isScheduledOn(habit.frequency, date) ? 'future' : 'not-scheduled';
  if (!isScheduledOn(habit.frequency, date)) return 'not-scheduled';
  if (age === 0) return 'today';
  return age <= backfillWindowDays(habit) ? 'backfillable' : 'too-old';
}

/** 这一格能不能被点。`not-scheduled` / `future` / `too-old` 三档不行。 */
export function isHabitDayTappable(state: HabitDayState): boolean {
  return state === 'logged' || state === 'today' || state === 'backfillable';
}

/**
 * 往回补这一天是否被允许（**不含今天** —— 今天是正常打卡，不是补）。
 *
 * 这就是 `backfillDays` 那条承诺的兑现点：任何"能不能补到这天"的判断都必须走这里，
 * 界面里再写一遍 `diffDays(...) <= 1` 就是第二个裁决者。
 */
export function isBackfillAllowed(habit: Habit, date: LocalDate, today: LocalDate): boolean {
  return habitDayState(habit, [], date, today) === 'backfillable';
}
