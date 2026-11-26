/**
 * 课表网格 —— 把已导入的课程（它们落成 `Habit`）映射成「星期 × 时段」的纯数据
 * ==========================================================================
 *
 * 这一层**只做归并**：一周七天 × 固定节次，每个格子放进落在该时段里的课程。不碰 IO、
 * 不碰 op-log、不碰 i18n、不读时钟 —— 天/节次的判定全部来自显式入参
 *（`weekStart` / `periods`），这样它能在 node 里被单测钉死。
 *
 * ## 🔴 为什么课程是 Habit，而不是新实体
 *
 * 课程导入（`course-import.ts` + `@heyta/app-host` 的 `importCourses`）把每门课写成一条
 * `Habit`：`frequency` = 每周 + `daysOfWeek`，`time`/`endTime` = 起止，`teacher`/`location`/
 * `weeks`/`parity` 是课程专属的可选字段。所以「从已导入课程算出课表」= 从 `Habit[]` 算网格，
 * 不需要另开实体、也不动 schema（AGENTS §3.3：只加可选字段、不 bump）。
 *
 * ## 「哪些课算数」
 *
 * 只有带**课程痕迹**的习惯才进课表：有定时点（`time`），或有任一课程专属字段
 *（`teacher`/`location`/`weeks`/`parity`）。一条既无定时点、又没有任何课程字段的普通习惯
 *（如"每天喝水"）不会凭空出现在课表里。这是**业务判断**，所以它住在这里，不住 `apps/*`。
 *
 * ## 节次的兜底
 *
 * 课程开始时刻落在「开始时间不晚于它的最后一节」；早于第一节的归第一节、晚于最后一节的归
 * 最后一节 —— 宁可贴到边界也不让一门有时间的课**从网格里消失**（消失比贴边更坏）。
 * 没有定时点的课程进入 `untimed`，按天单独列，绝不塞进某个时段冒充有时间。
 */

import { addDays, isoWeek, type LocalDate } from './date.js';
import type { Habit } from './entities.js';
import { isScheduledOn } from './habit-streak.js';

/** 一个节次：起止都是本地 `HH:mm`。 */
export interface TimetablePeriod {
  readonly start: string;
  readonly end: string;
}

/**
 * 默认作息（10 节，常见大学作息）。用户没给自定义节次时的兜底。
 *
 * ⚠️ 它与移动端 `apps/mobile/src/prefs/timetable-periods.ts` 的 `DEFAULT_PERIODS` 是同一套
 * 读数；两端默认值一旦分叉，同一门课在手机与网页上会落到不同节次。安卓/移动端那份仍按
 * 设备本地偏好走，这里只作为 web 端在没有设备偏好时的默认，不引入第三套来源。
 */
export const DEFAULT_TIMETABLE_PERIODS: readonly TimetablePeriod[] = [
  { start: '08:00', end: '08:45' },
  { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' },
  { start: '10:55', end: '11:40' },
  { start: '14:00', end: '14:45' },
  { start: '14:55', end: '15:40' },
  { start: '16:00', end: '16:45' },
  { start: '16:55', end: '17:40' },
  { start: '19:00', end: '19:45' },
  { start: '19:55', end: '20:40' },
];

/** 网格里一格的内容（由一条课程 `Habit` 摊平而来）。 */
export interface TimetableEntry {
  readonly habitId: string;
  readonly name: string;
  readonly teacher?: string;
  readonly location?: string;
  /** 起始 `HH:mm`；无定时点的课程没有。 */
  readonly start?: string;
  readonly end?: string;
}

/** 一天：`cells[periodIndex]` = 该节上的课程；`untimed` = 没有定时点的课程。 */
export interface TimetableDay {
  readonly date: LocalDate;
  readonly cells: readonly (readonly TimetableEntry[])[];
  readonly untimed: readonly TimetableEntry[];
}

export interface TimetableGrid {
  readonly periods: readonly TimetablePeriod[];
  readonly days: readonly TimetableDay[];
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 一条习惯是否属于课表（见文件头的「哪些课算数」）。 */
export function isTimetableCourse(habit: Habit): boolean {
  return (
    habit.time !== undefined ||
    habit.teacher !== undefined ||
    habit.location !== undefined ||
    habit.weeks !== undefined ||
    habit.parity !== undefined
  );
}

/**
 * 课程落在**哪一节**：开始时间不晚于它的最后一节（边界外贴到首/末节）。
 * `periods` 为空时返回 `-1`（无从归属）。
 */
export function periodIndexForTime(periods: readonly TimetablePeriod[], start: string): number {
  if (periods.length === 0) return -1;
  // `HH:mm` 零填充后字典序 = 时间先后；只比较合法形状，非法值退到首节。
  if (!HM.test(start)) return 0;
  let best = 0;
  for (let i = 0; i < periods.length; i += 1) {
    if (periods[i]!.start <= start) best = i;
  }
  return best;
}

/**
 * 这门课在**第 `weekIso` 周**是否该出现（周次范围 + 单双周）。
 *
 * `weeks`/`parity` 只影响"这一周上不上"，不影响"周几"；周几永远由 `frequency` 决定
 *（见 `isScheduledOn`）。两件事分开，是因为导入时它们来自不同字段（RRULE 的 UNTIL /
 * INTERVAL vs BYDAY）。
 */
export function courseOccursInWeek(habit: Habit, weekIso: number): boolean {
  const range = habit.weeks;
  if (range !== undefined && (weekIso < range.start || weekIso > range.end)) return false;
  const parity = habit.parity ?? 'all';
  if (parity === 'odd' && weekIso % 2 === 0) return false;
  if (parity === 'even' && weekIso % 2 === 1) return false;
  return true;
}

function toEntry(habit: Habit): TimetableEntry {
  return {
    habitId: habit.id,
    name: habit.name,
    ...(habit.teacher === undefined ? {} : { teacher: habit.teacher }),
    ...(habit.location === undefined ? {} : { location: habit.location }),
    ...(habit.time === undefined ? {} : { start: habit.time }),
    ...(habit.endTime === undefined ? {} : { end: habit.endTime }),
  };
}

function byStartThenName(a: TimetableEntry, b: TimetableEntry): number {
  const sa = a.start ?? '';
  const sb = b.start ?? '';
  if (sa !== sb) return sa < sb ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * 构建一周的课表网格。`weekStart` 必须是**周一**（用 `startOfWeek` 得到）。
 *
 * 纯函数：同样的 `(habits, weekStart, periods)` 必得同样结果，不读时钟、不排序不确定
 *（格子内按开始时刻、再按课名稳定排序）。
 */
export function buildTimetableGrid(
  habits: readonly Habit[],
  weekStart: LocalDate,
  periods: readonly TimetablePeriod[] = DEFAULT_TIMETABLE_PERIODS,
): TimetableGrid {
  const weekIso = isoWeek(weekStart);
  const days: TimetableDay[] = [];
  for (let di = 0; di < 7; di += 1) {
    const date = addDays(weekStart, di);
    const cells: TimetableEntry[][] = periods.map(() => []);
    const untimed: TimetableEntry[] = [];
    for (const habit of habits) {
      if (!isTimetableCourse(habit)) continue;
      // 周几：frequency 决定；周的可见性：weeks/parity 决定。两步都过才落格。
      if (!isScheduledOn(habit.frequency, date)) continue;
      if (!courseOccursInWeek(habit, weekIso)) continue;
      const entry = toEntry(habit);
      if (habit.time === undefined) {
        untimed.push(entry);
        continue;
      }
      const pi = periodIndexForTime(periods, habit.time);
      if (pi < 0) {
        untimed.push(entry);
        continue;
      }
      cells[pi]!.push(entry);
    }
    for (const list of cells) list.sort(byStartThenName);
    untimed.sort(byStartThenName);
    days.push({ date, cells, untimed });
  }
  return { periods, days };
}
