/**
 * 今日进度（L1 即时反馈层）
 * ============================
 *
 * 这是 Hook 回路里**缺失的第三步**：用户做完一件事之后的 3 秒内，
 * 界面必须说点什么，而且说的必须是"今天推进了多少"。
 *
 * 口径的三条决定（都是产品语义，所以在这里而不在屏幕组件里，见 AGENTS.md §3.5）：
 *
 * 1. **"今天该做的"= 今天排期的习惯 + 今天到期或已逾期的未完成任务。**
 *    逾期的算进今天，是因为"今天该做的"在用户心里就是这些。
 * 2. **今天完成的所有事都算数**，包括计划外临时做的事（`bonus`）。
 *    只算计划内的话，"我今天顺手清掉 5 件事"会显示进度不变 —— 那是最伤人的一种反馈。
 * 3. **没有计划时不算 0%。** 空的一天里做了一件事就是 100%，
 *    这正是小胜原则要的那种反馈。
 *
 * 里程碑式的设计约束：`total` 由用户自己的安排决定，所以界面**不要**
 * 默认把全部待办塞进来 —— 一个永远填不满的进度条会变成压力源，
 * 而不是目标梯度（见 `docs/plans/motivation-and-progression.md` §3.2）。
 */

import type { FocusSession, Habit, HabitLog, Task } from './entities.js';
import { diffDays, toLocalDate, type LocalDate } from './date.js';
import { isAchieved, isScheduledOn } from './habit-streak.js';
import { focusSessionDay, shouldPersistSession } from './focus.js';
import { dueLocalDateOf } from './date.js';

export interface TodayProgressInput {
  habits: readonly Habit[];
  logs: readonly HabitLog[];
  tasks: readonly Task[];
  focusSessions: readonly FocusSession[];
  today: LocalDate;
}

export interface TodayProgress {
  /** 今天排期的习惯数。 */
  habitsPlanned: number;
  /** 今天排期且已达成的习惯数。 */
  habitsDone: number;
  /** 今天到期或已逾期的未完成任务数。 */
  tasksPlanned: number;
  /** 今天完成的任务数（**含**计划外的）。 */
  tasksDone: number;
  /** 今天完成的专注分钟数（只含工作段）。 */
  focusMinutes: number;
  /** 计划总量 = habitsPlanned + tasksPlanned。 */
  total: number;
  /** 完成量 = 计划内完成 + 计划外完成（见文件头第 2 条）。 */
  done: number;
  /** 计划外完成的数量（界面用来表达"顺手还清了 N 件"）。 */
  bonus: number;
  /** 进度 0–1，已封顶。`total === 0` 时：有完成就是 1，否则 0。 */
  ratio: number;
  /** 今日是否已闭环（做过事且不少于计划量）。 */
  closed: boolean;
}

/** 某个时间戳是否落在 `today` 这个本地日历日。 */
function isOn(timestamp: number, today: LocalDate): boolean {
  return toLocalDate(timestamp) === today;
}

/**
 * 任务是否属于「**今天该做的**」。
 *
 * 这是本文件第 1 条口径（"今天排期的习惯 + 今天到期或已逾期的未完成任务"）
 * 在任务侧的唯一实现。判据是三条：
 *
 *   1. 未删除；
 *   2. **截止日**是今天或已逾期（`diffDays(due, today) >= 0`，注意 `diffDays(a, b) = b - a`）；
 *   3. 不在今天之前就完成了 —— 昨天就做完的任务不该再占今天的位置。
 *
 * ## 🔴 为什么它必须**导出**，而不是继续内联在 `computeTodayProgress` 里
 *
 * 小组件的「今日任务」组件要显示的**就是这一批任务**。
 * 如果判据留在这里内联，组件侧只能照抄一份 —— 而那正是
 * `M0-1` 踩过的那种**静默漂移**：
 *
 *   > 两处判据长得一样、跑起来也对，但改了一处**不会让任何测试变红**。
 *   > 用户看到的是"今日进度说 5 件、组件列了 4 件"，而且两边都不报错。
 *
 * 所以判据收在这里一份，今日进度与小组件**都调它**。
 * 配套的等价性测试在 `tests/today-progress.spec.ts`：一旦有人把判据重新内联回去，
 * 那个测试会红。
 *
 * ⚠️ 注意它**只管"是否进入今天的计划"**，不管"是否已完成"。
 * `computeTodayProgress` 的 `tasksDone` 口径更宽（**含计划外**今天完成的），
 * 那一项故意留在这里、不放进本函数 —— 两者的语义不同，混起来会同时错两处。
 */
export function isTaskPlannedForToday(task: Task, today: LocalDate): boolean {
  if (task.deletedAt !== undefined) return false;

  // 今天之前就完成的：不再算今天的计划
  const completedToday = task.completedAt !== undefined && isOn(task.completedAt, today);
  if (task.completedAt !== undefined && !completedToday) return false;

  const due = dueLocalDateOf(task);
  if (due === undefined) return false;
  // `diffDays(a, b) = b - a`，所以 >= 0 表示截止日**是今天或已过去**（逾期）
  return diffDays(due, today) >= 0;
}

export function computeTodayProgress(input: TodayProgressInput): TodayProgress {
  const { habits, logs, tasks, focusSessions, today } = input;

  let habitsPlanned = 0;
  let habitsDone = 0;
  for (const habit of habits) {
    if (habit.deletedAt !== undefined) continue;
    if (!isScheduledOn(habit.frequency, today)) continue;
    habitsPlanned += 1;

    // "达成"的判据必须与 streak / 里程碑同源：同一天打了卡但没到目标值
    // （"8 杯水只喝了 3 杯"）不算今天完成 —— 否则今日进度与连续天数会互相矛盾，
    // 而这个矛盾在界面上表现为"进度条满了但连续天数没涨"，查起来极贵。
    const log = logs.find(
      (l) =>
        l.deletedAt === undefined &&
        l.habitId === habit.id &&
        l.date === today &&
        isAchieved(habit, l),
    );
    if (log !== undefined) habitsDone += 1;
  }

  let tasksPlanned = 0;
  let tasksPlannedDone = 0;
  let tasksDone = 0;
  for (const task of tasks) {
    if (task.deletedAt !== undefined) continue;

    // ⚠️ `tasksDone` 的口径**比 planned 宽** —— 计划外今天做完的也算（文件头第 2 条）。
    // 所以这一句必须在 `isTaskPlannedForToday` **之前**：它统计的是"今天做了什么"，
    // 而不是"今天该做什么"。把它挪到判据之后，只有截止日恰好是今天的任务才会被计入。
    const completedToday =
      task.completedAt !== undefined && isOn(task.completedAt, today);
    if (completedToday) {
      tasksDone += 1;
    }

    // 判据只有一份，在 `isTaskPlannedForToday` 里 —— 小组件的「今日任务」也调它。
    if (!isTaskPlannedForToday(task, today)) continue;
    tasksPlanned += 1;
    if (completedToday) tasksPlannedDone += 1;
  }

  let focusMinutes = 0;
  for (const session of focusSessions) {
    if (session.deletedAt !== undefined) continue;
    if (!shouldPersistSession(session)) continue;
    if (!isOn(focusSessionDay(session), today)) continue;
    focusMinutes += Math.round((session.actualMs ?? session.plannedMs) / 60000);
  }

  const total = habitsPlanned + tasksPlanned;
  const bonus = Math.max(0, tasksDone - tasksPlannedDone);
  const done = habitsDone + tasksPlannedDone + bonus;

  const ratio = total === 0 ? (done > 0 ? 1 : 0) : Math.min(1, done / total);

  return {
    habitsPlanned,
    habitsDone,
    tasksPlanned,
    tasksDone,
    focusMinutes,
    total,
    done,
    bonus,
    ratio,
    closed: done > 0 && done >= total,
  };
}
