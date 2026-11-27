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
 * 1. **只有"跨多天的连续条"不可拖。**
 *    一个 `startDate + dueDate` 且两者不在同一天的跨天任务，在日历上会画成
 *    **好几段的连续条**（`calendarTaskSpan` / `bar.span`），拖哪一段该改
 *    `startDate` 还是 `dueDate` 是**没有唯一答案**的：拖"尾段"改 due、拖"头段"改 start，
 *    两者混在一起就是"用户拖了、结果改错了字段"。所以只有这类任务在日历上
 *    **不可拖**（`canRescheduleByCalendarDrag` 返回 false），拖拽语义留给
 *    时间线排期面（`setSchedule`）。单日任务（含带 `durationMinutes`、只有一天
 *    `startDate` 的）与没有截止时间的新任务都没有这个歧义，可以拖。
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
  startLocalDateOf,
  type LocalDate,
  type LocalTime,
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

/** 补零到两位（`9` → `'09'`）。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 任务截止上带的时刻；`undefined` = 全天 / 没有截止。
 *
 * 与 `DueEditor.onChange` 的 `timeValue` 完全是同一个判定：
 *   · `dueDateLocal` 存在        → 这是"只到日"，时刻 = undefined；
 *   · 否则 `localTimeOf(dueDate)` → 有时刻给 HH:MM，本地零点给 undefined（全天）；
 *   · 没有 `dueDate`              → 没有时刻可言。
 */
function dueTimeOf(task: CalendarReschedulableTask): LocalTime | undefined {
  if (task.dueDateLocal !== undefined || task.dueDate === undefined) return undefined;
  return localTimeOf(task.dueDate);
}

/**
 * 这条任务能不能被「在日历上拖到另一天」改期。
 *
 * 唯一不可拖的是**跨多天的连续条**（`startDate` 与 `dueDate` 都有、且不在同一天）——
 * 理由见文件头第 1 条：拖一段该改哪个字段没有唯一答案。
 * 没有截止时间的新任务、带 `durationMinutes` 或只有单日 `startDate` 的任务
 * 都能拖：它们改期时只有 `dueDate` 一个候选字段。
 */
export function canRescheduleByCalendarDrag(task: CalendarReschedulableTask): boolean {
  // 没有"排期起点 + 截止"两头，就画不出跨天连续条。
  if (task.startDate === undefined || task.dueDate === undefined) return true;
  return startLocalDateOf(task) === dueLocalDateOf(task);
}

/**
 * 拖到 `targetDate` 之后要写什么；`undefined` 表示**不该产生任何 op**。
 *
 * 什么时候 `undefined`：
 *   · 是跨多天的连续条（见 `canRescheduleByCalendarDrag`）；
 *   · `targetDate` 形状非法（没有落点可言）；
 *   · 落点就是当前的截止日（no-op）。
 *
 * 没有截止时间的新任务也走这里：落到 `targetDate` 就是"给它一个截止日"，
 * 写 date-only（`dueDateLocal` + 本地零点）。
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
   * 保留原先的时刻：date-only / 无截止任务写 date-only；有时刻的搬到新一天的同一时刻。
   */
  const time = dueTimeOf(task);

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

/** `planCalendarTimeDrop` 的写入计划：同样交给 `setDueDate`（不传 dueDateLocal 即清除 date-only）。 */
export interface CalendarTimeDropPlan {
  readonly dueDate: number;
}

/**
 * 日档：把任务拖到某一天的第 `hour` 点 `minute` 分 ⇒ 把截止**时刻**设成那天 `hour:minute`。
 *
 * 与 `planCalendarDrop`（改"哪一天"）是同一天里改"几点"的另一半：
 *   · 拖一个**全天 / 无截止**任务到小时轴 ⇒ 它从"没有时刻"变成"那天 hour:minute"；
 *   · 拖一个**有时刻**任务到别的小时 ⇒ 时刻平移。
 *
 * 🔴 写 `dueDate`（带时刻）就必须把 `dueDateLocal`（date-only）清掉 ——
 *    `setDueDate(id, dueDate)` 不传第三参，动作层把 `dueDateLocal` 写成 `null`（老约定）。
 *    带着 date-only 又给时刻，是"同一件事两个来源"。
 *
 * 什么时候 `undefined`：跨多天连续条 / `hour` 不是 0–23 的整数 /
 * `minute` 不是 0–59 的整数 / 落点日期非法 /
 * 已经是这个 `dueDate`（no-op，不写空 op）。
 */
export function planCalendarTimeDrop(
  task: CalendarReschedulableTask,
  targetDate: LocalDate,
  hour: number,
  minute: number = 0,
): CalendarTimeDropPlan | undefined {
  if (!canRescheduleByCalendarDrag(task)) return undefined;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return undefined;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
  if (!LOCAL_DATE_PATTERN.test(targetDate)) return undefined;

  let dueDate: number;
  try {
    dueDate = dueDateToEpoch(targetDate, `${pad2(hour)}:${pad2(minute)}`);
  } catch {
    return undefined;
  }

  // 已经就是这一刻（且没有 date-only 残留）⇒ no-op。
  if (task.dueDate === dueDate && task.dueDateLocal === undefined) return undefined;
  return { dueDate };
}

/**
 * 全天档：把**带时刻或没有截止**的任务落成 `targetDate` 的全天任务。
 *
 * 拖到全天行要的是"这一天、没有具体时刻"，所以写 date-only：
 * `{ dueDate: 那天本地零点, dueDateLocal: targetDate }`（与 `planCalendarDrop` 同一形状）。
 *
 * 什么时候 `undefined`：
 *   · 是跨多天的连续条（同 `canRescheduleByCalendarDrag`：拖一段没有唯一答案）；
 *   · `targetDate` 形状非法 / 那天不存在；
 *   · 已经是**这一天的全天**（no-op，不写空 op）。
 */
export function planCalendarAllDayDrop(
  task: CalendarReschedulableTask,
  targetDate: LocalDate,
): CalendarDropPlan | undefined {
  if (!canRescheduleByCalendarDrag(task)) return undefined;
  if (!LOCAL_DATE_PATTERN.test(targetDate)) return undefined;

  // 已经是这天全天 ⇒ 值没变，不写 op。
  if (dueLocalDateOf(task) === targetDate && dueTimeOf(task) === undefined) return undefined;

  let dueDate: number;
  try {
    dueDate = dueDateToEpoch(targetDate);
  } catch {
    return undefined;
  }

  return { dueDate, dueDateLocal: targetDate };
}
