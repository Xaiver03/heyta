/**
 * 周复盘（L3 叙事层）
 * =====================
 *
 * 这是"投入读得回来"的核心动作：把一周的原始记录压成**一段关于推进的叙事**，
 * 而不是一张积分结算单。
 *
 * 依据：进展原则（Amabile & Kramer）—— 正向内在动机最强的单一驱动因素是
 * "在有意义的事情上取得进展"，而**小胜**是最有力的正向事件。
 * 所以这里输出的字段全部是"你推进了什么"，**没有**排名、没有连续天数考核、
 * 没有"低于平均"这类判断（见 `docs/research/motivation-psychology.md` §3.3）。
 *
 * 一处刻意的设计：`headline` 由数据自己决定（哪个维度最活跃就讲哪个），
 * 而不是固定讲"完成任务数"。否则一个这周主要在专注、没怎么勾任务的人，
 * 会收到一封说他"这周没什么产出"的信 —— 那是最典型的负面复盘。
 */

import type { FocusSession, HabitLog, Task } from './entities.js';
import { addDays, diffDays, isoWeekday, toLocalDate, type LocalDate } from './date.js';
import { focusSessionDay, shouldPersistSession } from './focus.js';

/** 一周的起止（周一为一周之始，与 `WEEKDAY_LABELS` 的口径一致）。 */
export interface WeekWindow {
  start: LocalDate;
  end: LocalDate;
}

/** `today` 所在的那一周（周一到周日）。 */
export function weekWindowOf(today: LocalDate): WeekWindow {
  const start = addDays(today, -(isoWeekday(today) - 1));
  return { start, end: addDays(start, 6) };
}

export interface WeeklyReviewCounts {
  checkIns: number;
  tasksCompleted: number;
  focusMinutes: number;
}

export interface WeeklyReviewInput {
  logs: readonly HabitLog[];
  tasks: readonly Task[];
  focusSessions: readonly FocusSession[];
  today: LocalDate;
}

export interface WeeklyReview extends WeeklyReviewCounts {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  /** 本周专注最久的那一天（没有专注时为 undefined）。 */
  bestFocusDay?: { date: LocalDate; minutes: number };
  /** 本周完成最多任务的清单（没有归属清单的任务不计）。 */
  topProjectId?: string;
  /** 上一周的同口径数字，用于"比上周多 N"。 */
  previous: WeeklyReviewCounts;
  /** 两个数字的差（可负）。 */
  deltas: WeeklyReviewCounts;
  /** 本周最活跃的维度 —— 界面据此决定主标题讲什么。 */
  headline: 'checkIns' | 'tasksCompleted' | 'focusMinutes' | 'none';
}

function within(date: LocalDate, window: WeekWindow): boolean {
  // ⚠️ `diffDays(a, b)` 返回 `b − a`：窗口下界要在日期之前、上界要在日期之后。
  return diffDays(window.start, date) >= 0 && diffDays(date, window.end) >= 0;
}

/** 统计某个周窗口内的三个数字（复用于本周与上周）。 */
function countsIn(
  input: WeeklyReviewInput,
  window: WeekWindow,
): { counts: WeeklyReviewCounts; byDay: Map<LocalDate, number>; byProject: Map<string, number> } {
  const byDay = new Map<LocalDate, number>();
  const byProject = new Map<string, number>();

  let checkIns = 0;
  for (const log of input.logs) {
    if (log.deletedAt !== undefined) continue;
    if (!within(log.date, window)) continue;
    checkIns += 1;
  }

  let tasksCompleted = 0;
  for (const task of input.tasks) {
    if (task.deletedAt !== undefined) continue;
    if (task.completedAt === undefined) continue;
    const date = toLocalDate(task.completedAt);
    if (!within(date, window)) continue;
    tasksCompleted += 1;
    if (task.projectId !== undefined) {
      byProject.set(task.projectId, (byProject.get(task.projectId) ?? 0) + 1);
    }
  }

  let focusMs = 0;
  for (const session of input.focusSessions) {
    if (session.deletedAt !== undefined) continue;
    if (!shouldPersistSession(session)) continue;
    const date = toLocalDate(focusSessionDay(session));
    if (!within(date, window)) continue;
    const ms = session.actualMs ?? session.plannedMs;
    focusMs += ms;
    byDay.set(date, (byDay.get(date) ?? 0) + ms);
  }

  return {
    counts: {
      checkIns,
      tasksCompleted,
      // 向下取整：说"专注 65 分钟"时不能把 65.9 说成 66 让人以为凑够了一小时。
      focusMinutes: Math.floor(focusMs / 60000),
    },
    byDay,
    byProject,
  };
}

/** 取出现次数最多的键（并列时取键名较小的，保证结果确定）。 */
function argmax(map: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const key of [...map.keys()].sort()) {
    const count = map.get(key)!;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

export function computeWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const window = weekWindowOf(input.today);
  const previousWindow: WeekWindow = {
    start: addDays(window.start, -7),
    end: addDays(window.end, -7),
  };

  const current = countsIn(input, window);
  const previous = countsIn(input, previousWindow);

  const bestDay = argmax(current.byDay);
  const bestFocusDay =
    bestDay === undefined
      ? undefined
      : { date: bestDay, minutes: Math.floor((current.byDay.get(bestDay) ?? 0) / 60000) };

  const topProjectId = argmax(current.byProject);

  const { checkIns, tasksCompleted, focusMinutes } = current.counts;
  let headline: WeeklyReview['headline'] = 'none';
  if (checkIns > 0 || tasksCompleted > 0 || focusMinutes > 0) {
    headline =
      tasksCompleted >= checkIns && tasksCompleted >= focusMinutes
        ? 'tasksCompleted'
        : checkIns >= focusMinutes
          ? 'checkIns'
          : 'focusMinutes';
  }

  return {
    ...current.counts,
    weekStart: window.start,
    weekEnd: window.end,
    ...(bestFocusDay === undefined ? {} : { bestFocusDay }),
    ...(topProjectId === undefined ? {} : { topProjectId }),
    previous: previous.counts,
    deltas: {
      checkIns: checkIns - previous.counts.checkIns,
      tasksCompleted: tasksCompleted - previous.counts.tasksCompleted,
      focusMinutes: focusMinutes - previous.counts.focusMinutes,
    },
    headline,
  };
}