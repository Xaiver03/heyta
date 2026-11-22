/**
 * 日历「拖拽改期」的业务语义（纯函数）
 * ==================================
 *
 * 拖一个任务条到日历的另一天，本质是一个**改截止日期**的意图 —— 也就是
 * `setDueDate` 那一个动作。那么"落在哪天、写什么 dueDate/dueDateLocal"
 * 就是产品语义，按 AGENTS §3.5 必须住在这里，不能写进 `apps/web` 的拖拽事件里。
 *
 * 形状照抄同仓两个先例：
 *   · `planQuadrantDrop`（packages/domain/src/quadrant.ts）—— 拖放落点 → 字段 patch；
 *   · 以及 `apps/web/src/features/tasks/DueEditor.tsx` 的换日规则（换日子搬运时刻）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两个刻意的边界（不是"没做完"，是"故意不做"）
 *
 * 1. **只接受"只有截止日、没有排期起点/时长"的任务。**
 *    一个 `startDate + dueDate` 的跨天任务在日历上会画成**好几段的连续条**
 *    （`calendarTaskSpan` / `bar.span`），拖哪一段该改 `startDate` 还是
 *    `dueDate` 是**没有唯一答案**的：拖"尾段"改 due、拖"头段"改 start，
 *    两者混在一起就是"用户拖了、结果改错了字段"。所以这类任务在日历上
 *    **不可拖**（`canRescheduleByCalendarDrag` 返回 false），拖拽语义留给
 *    时间线排期面（`setSchedule`）。单日任务的改期没有这个歧义。
 *
 * 2. **拖到同一天 = no-op，返回 `undefined`。**
 *    别用"落到同一天也写一次"来省判断：那会产生一条**值没变的 op**，
 *    在 op-log 里就是一次无意义的同步往返，且会让 LWW 平局逻辑多一次参与机会。
 *
 * 🔴 时刻的处理与 `DueEditor` **逐字同源**：换日子要把原来的时刻搬过去，
 *    否则"把 16:00 的任务拖到明天"会悄悄变成"明天全天"—— 界面上看不出发生了什么，
 *    而提醒会因此提前一整天。判定"有没有时刻"用的是 `localTimeOf`
 *    （它对本地零点返回 undefined = 全天），与日历/时间线同一处判定。
 */

import { dueDateToEpoch } from './capture.js';
import {
  dueLocalDateOf,
  localTimeOf,
  type LocalDate,
} from './date.js';
import type { Task } from './entities.js';

/** 能在日历上被拖拽改期的那部分任务字段（其余字段与本语义无关）。 */
export type CalendarReschedulableTask = Pick<
  Task,
  'startDate' | 'startDateLocal' | 'durationMinutes' | 'dueDate' | 'dueDateLocal'
>;

/** `planCalendarDrop` 算出来的写入计划：交给 `setDueDate(dueDate, dueDateLocal)`。 */
export interface CalendarDropPlan {
  /** 新的截止 epoch ms。 */
  readonly dueDate: number;
  /** 日期型截止的本地日历日；有时刻的任务不写它（与 `DueEditor` 同一约定）。 */
  readonly dueDateLocal?: LocalDate;
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 这条任务能不能被「在日历上拖到另一天」改期。
 *
 * 只认**纯截止日**任务（有 due、无排期起点/时长）。跨天排期任务与纯排期任务
 * 都返回 false —— 理由见文件头第 1 条：拖一段该改哪个字段没有唯一答案。
 */
export function canRescheduleByCalendarDrag(task: CalendarReschedulableTask): boolean {
  if (
    task.startDate !== undefined ||
    task.startDateLocal !== undefined ||
    task.durationMinutes !== undefined
  ) {
    return false;
  }
  return task.dueDate !== undefined || task.dueDateLocal !== undefined;
}

/**
 * 拖到 `targetDate` 之后要写什么；`undefined` 表示**不该产生任何 op**。
 *
 * 什么时候 `undefined`：
 *   · 不是可改期的任务（见 `canRescheduleByCalendarDrag`）；
 *   · `targetDate` 形状非法（没有落点可言）；
 *   · 落点就是当前的截止日（no-op）。
 */
export function planCalendarDrop(
  task: CalendarReschedulableTask,
  targetDate: LocalDate,
): CalendarDropPlan | undefined {
  if (!canRescheduleByCalendarDrag(task)) return undefined;
  if (!LOCAL_DATE_PATTERN.test(targetDate)) return undefined;

  // 落在同一天不写 op。
  if (dueLocalDateOf(task) === targetDate) return undefined;

  /*
   * 保留原先的时刻：date-only 任务继续 date-only；有时刻的搬到新一天的同一时刻。
   * 与 `DueEditor.onChange` 的 `timeValue` 完全是同一个判定：
   *   · `dueDateLocal` 存在        → 这是"只到日"，时刻 = undefined；
   *   · 否则 `localTimeOf(dueDate)` → 有时刻给 HH:MM，本地零点给 undefined（全天）。
   */
  const time = task.dueDateLocal !== undefined
    ? undefined
    : task.dueDate === undefined
      ? undefined
      : localTimeOf(task.dueDate);

  /*
   * 形状对了不代表那天真的存在：`2026-13-40` 过得了正则，但 `dueDateToEpoch`
   * 里的 `parseLocalDate` 会抛（月/日越界）。落点非法就是"没有落点"，
   * 返回 undefined 而不是把异常抛给拖拽事件 —— 拖拽是高频交互，
   * 一次坏数据不该让整个 onDragEnd 崩在半路。
   */
  let dueDate: number;
  try {
    dueDate = dueDateToEpoch(targetDate, time);
  } catch {
    return undefined;
  }

  // 无时刻 ⇒ 写 date-only（dueDateLocal）；有时刻 ⇒ 清掉 dueDateLocal（同一约定）。
  return time === undefined
    ? { dueDate, dueDateLocal: targetDate }
    : { dueDate };
}

/** 撤销一次拖拽改期：把截止时间恢复成拖拽前那条任务的形状。 */
export function planCalendarDropUndo(
  before: CalendarReschedulableTask,
): { dueDate: number | null; dueDateLocal: LocalDate | null } {
  return {
    dueDate: before.dueDate ?? null,
    dueDateLocal: before.dueDateLocal ?? null,
  };
}
