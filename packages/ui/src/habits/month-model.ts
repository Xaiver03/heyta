/**
 * 习惯月历的**纯逻辑**（工单 H4）
 * ==============================
 *
 * 与 `calendar/model.ts` 同一刀法：会**静默算错**的东西全部留在这里，组件只负责摆。
 * 这里最容易错的三件，每一件都有现成的错法：
 *
 *   1. 网格的补白格属于上月还是下月 —— 不在这里管，**直接吃 `@heyta/domain#monthGrid`**
 *      （6×7、周一起头、带 `inMonth`）。本文件是它的第三个消费者（前两个是
 *      `date-picker/DatePicker` 与 `calendar/CalendarBoard`，加上 `CalendarYearBoard` 的缩略月卡）。
 *      🔴 自己在这里再写一遍 `lead = isoWeekday(first) - 1` 就是第二份月历数学，
 *      而两份的差别只会在闰年/月初是周一那天现形。
 *   2. 一格"能不能点"。裁决在 `@heyta/domain#habitDayState`（补打卡窗口的唯一读取者），
 *      这里只做映射。**不许**在这里出现 `diffDays(...) <= 1` 那种自己拍的窗口。
 *   3. 列头顺序：`monthGrid` 固定周一起头，列头一旦写成周日起头，整月错一位而没人报错
 *      （`tests/calendar-date-text.spec.ts` 钉的是同一条，那边是日历，这里是习惯）。
 *
 * 🔴 文案一律由宿主注入（`packages/ui` 不许 `import '@heyta/i18n'`，理由见
 * `calendar/model.ts` 文件头那条"第二份 React"）。
 */

import {
  backfillWindowDays,
  habitDayState,
  isHabitDayTappable,
  monthGrid,
  type Habit,
  type HabitDayState,
  type HabitLog,
  type LocalDate,
} from '@heyta/domain';

/** 一格需要的全部事实。`state` 是领域层的封闭词表，这里不加第六种。 */
export interface HabitMonthCell {
  readonly date: LocalDate;
  /** 这一格属于正在显示的那个月吗（`monthGrid` 的补白格是 `false`）。 */
  readonly inMonth: boolean;
  readonly state: HabitDayState;
}

/**
 * 一个月历格子能不能被点。
 *
 * ⚠️ **补白格不算格子**：它画的是邻月的日子，点它等于在邻月写一条记录，
 * 而界面这时候显示的是"这个月"。所以它既不响应点击也不进无障碍读数。
 *
 * 🔴 "这一档能不能点"**不在这里回答** —— 那是领域层 `isHabitDayTappable` 的活。
 *    这里再列一遍三种可点状态就是第二个裁决者（本单 B8 钉的正是同一件事）。
 */
export function isHabitMonthCellInteractive(cell: HabitMonthCell): boolean {
  return cell.inMonth && isHabitDayTappable(cell.state);
}

/** 这一格按下去做的是**打卡**还是**撤销**（`logged` 才是撤销）。 */
export function habitMonthCellAction(
  cell: HabitMonthCell,
): 'check-in' | 'undo' | 'none' {
  if (!isHabitMonthCellInteractive(cell)) return 'none';
  return cell.state === 'logged' ? 'undo' : 'check-in';
}

/** 整月格子（6 周 × 7 天）。 */
export function habitMonthCells(
  habit: Habit,
  logs: readonly HabitLog[],
  month: LocalDate,
  today: LocalDate,
): HabitMonthCell[][] {
  return monthGrid(month).map((week) =>
    week.map((cell) => ({
      date: cell.date,
      inMonth: cell.inMonth,
      state: habitDayState(habit, logs, cell.date, today),
    })),
  );
}

/**
 * 「下一个月」按钮是否该置灰：不能翻到**当前月之后**。
 *
 * 比较的是 `YYYY-MM` 前缀而不是日期本身：月历的游标可以是本月任何一天，
 * 而"下个月"只跟月份有关。`YYYY-MM` 是定长零填充，字典序 = 时间序。
 */
export function isHabitMonthForwardCapped(month: LocalDate, today: LocalDate): boolean {
  return month.slice(0, 7) >= today.slice(0, 7);
}

/**
 * 窗口提示要说的那个数（"可以往回补 N 天"）。
 *
 * 🔴 从 `backfillWindowDays` 推导，不在这里写死 —— 那个数字的唯一所有者是领域层
 * （工单 H4 之前它压根没人读，而这条提示就是那句"上限由 backfillDays 控制"的界面兑现）。
 */
export function habitMonthWindowDays(habit: Habit): number {
  return backfillWindowDays(habit);
}
