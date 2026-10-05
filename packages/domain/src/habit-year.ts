/**
 * 习惯的**年**视图取数（工单 H7）
 * ================================
 *
 * 这里只回答一件事：**把已有的那一份月度裁决按 12 个月各跑一遍**。
 *
 * 🔴 **不许出现第二套算式**。达成天数、已到期计划日、完成率这三样在
 * `computeHabitPeriodStats`（`habit-streak.ts`）里已经有唯一所有者，而它的口径里有四条
 * 是"看一眼想不到"的：分母只数**已到期**的计划日、`scheduledDays === 0` 时率必须是 0
 * 并由界面画占位符、未达标的那天的量照记进 `monthValue`、下界夹在习惯创建日。
 * 年视图若自己写一遍循环累加 `logs`，这四条里最容易被漏掉的是第一条 ——
 * 症状是"这一年的完成率 12%"，而真相是"这一年里用户只要求过 1 月"。
 * 所以本文件逐月**调用**那个函数，一行算术都不重写；
 * 判据 Y3 钉的就是"当月那一行逐字段等于月视图读到的那份"。
 *
 * ## 🔴 未来那几个月不是 0%，是**没有分母**
 *
 * 12 张月卡里，晚于 `today` 的那几张整天都在未来。把它们算成"计划 31 天、达成 0 天"
 * 会让年视图显示一排 0%，而用户什么都没做错 —— 这是"界面在说谎"那一族
 * （AGENTS §7 元规则第 2 条）。所以未来月直接给零行并带 `inFuture`，
 * **不调用**月度函数（传一个未来的 `today` 会真的产出一个分母）。
 *
 * ## 年那一格的率：与月度裁决同一把尺，不是"十二个率的平均"
 *
 * 见 {@link habitYearSummary} 的注释 —— 那是一条会静默算错、且错得很难看的经典形状。
 */

import {
  computeHabitPeriodStats,
  type HabitPeriodStats,
} from './habit-streak.js';
import type { Habit, HabitLog } from './entities.js';
import { daysInMonth, MONTHS_PER_YEAR, type LocalDate } from './date.js';

/** 该年 1 月 1 日起算的 `MONTHS_PER_YEAR` 行；顺序恒为 1 月 → 12 月。 */
export interface HabitYearRow {
  /** `'YYYY-MM'`。 */
  readonly monthKey: string;
  readonly achievedDays: number;
  /** **已到期**的计划日数（分母）。未来月与"这个月一天都不归这条习惯管"都是 0。 */
  readonly scheduledDays: number;
  /** 见 `HabitPeriodStats.rate`：`scheduledDays === 0` 时恒为 0，界面按分母画占位符。 */
  readonly rate: number;
  /** 该月完成量（`Σ habitLogValue`，含未达标的那天）。 */
  readonly monthValue: number;
  /** 这一整月都在 `today` 之后 —— 界面据此画"还没到"，而不是"0%"。 */
  readonly inFuture: boolean;
}

/** 某年某月的最后一天（`month` 是 1–12）。 */
function endOfMonth(year: number, month: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    daysInMonth(year, month),
  ).padStart(2, '0')}` as LocalDate;
}

/**
 * 一年 12 行。`year` 不给时取 `today` 所在那年 ——
 * 游标由**宿主**持有（翻年不改 `today`，与月历那块板的游标同一条理由：
 * 跨午夜与测试都要可复现）。
 */
export function habitYearRows(
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
  year = Number(today.slice(0, 4)),
): readonly HabitYearRow[] {
  const rows: HabitYearRow[] = [];
  for (let month = 1; month <= MONTHS_PER_YEAR; month += 1) {
    const monthKey = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    const end = endOfMonth(year, month);
    if (monthKey > today.slice(0, 7)) {
      rows.push({
        monthKey,
        achievedDays: 0,
        scheduledDays: 0,
        rate: 0,
        monthValue: 0,
        inFuture: true,
      });
      continue;
    }
    // 🔴 传给月度函数的必须是**这一月之内**的某个日子，且不超过真正的今天：
    //   它按传入值的自然月算，`upper = min(传入值, 月末)`。过去的月份传月末（整月口径），
    //   当月传今天（"已到期"才进分母）。
    const asOf = end < today ? end : today;
    const stats: HabitPeriodStats = computeHabitPeriodStats(habit, logs, asOf);
    rows.push({
      monthKey,
      achievedDays: stats.achievedDays,
      scheduledDays: stats.scheduledDays,
      rate: stats.rate,
      monthValue: stats.monthValue,
      inFuture: false,
    });
  }
  return rows;
}

/** 一年的汇总（年视图顶部那一行）。 */
export interface HabitYearSummary {
  readonly achievedDays: number;
  readonly scheduledDays: number;
  /** 🔴 按分母加权（见 `habitYearSummary`）：与月度裁决同一把尺，不是十二个率的简单平均。 */
  readonly rate: number;
  readonly monthValue: number;
}

/**
 * 把 12 行加起来。
 *
 * 🔴 **年那一格的分子必须与月那一格的分子是同一把尺。** 月度裁决里
 * `rate = 到期计划日中达成的天数 / scheduledDays`，而 `achievedDays` 数的是
 * **该月所有达成日**（含档期外补打的那天）—— 两者对 `weekly` 档期的习惯**可以不相等**。
 * 所以年的率不能拿 `ΣachievedDays / ΣscheduledDays` 去除：那会把档期外的那几天
 * 算进分子，而月的率里没有它们，症状是"年率比它下面任何一个月都高，甚至 >100%"。
 * 正确形状是**按分母加权**：`Σ(rate_m × scheduled_m) / Σ scheduled_m`，
 * 而 `rate_m × scheduled_m` 恰好就是那个月的分子（整数；浮点误差在 1e-15 量级，
 * 判据用 `toBeCloseTo` 而不是 `toBe`）。
 *
 * ⚠️ 顺带一条同族的经典错：**简单平均十二个率**也是错的，反例见 Y6 ——
 * 一月 1/1 = 100%、二月 0/29 = 0%，平均 50%，真相是 1/30 ≈ 3.3%。
 * 分母不等时"平均的平均"永远偏，而它错的时候界面看不出任何异常。
 */
export function habitYearSummary(rows: readonly HabitYearRow[]): HabitYearSummary {
  let achievedDays = 0;
  let scheduledDays = 0;
  let monthValue = 0;
  let achievedDue = 0;
  for (const row of rows) {
    achievedDays += row.achievedDays;
    scheduledDays += row.scheduledDays;
    monthValue += row.monthValue;
    achievedDue += row.rate * row.scheduledDays;
  }
  return {
    achievedDays,
    scheduledDays,
    rate: scheduledDays === 0 ? 0 : achievedDue / scheduledDays,
    monthValue,
  };
}

/**
 * `monthKey`（`'YYYY-MM'`）→ 那一月的**任意一天**，用来把"点了一张年卡"交给月历。
 *
 * 固定取 1 号：月历那块板的游标只读年月（它自己算 42 格），
 * 而"取 1 号"是唯一一个不需要问"这个月有几天"的选择。
 */
export function firstOfMonthKey(monthKey: string): LocalDate {
  return `${monthKey}-01` as LocalDate;
}
