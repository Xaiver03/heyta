/**
 * 物化状态 → 激励体系（宿主无关的那一段）
 * =========================================
 *
 * 这是 `category-report.ts` 的**同形状第二次**，所以刻意照着它的分工写：
 *
 *   - `computeTodayProgress` / `computeStreak` / `deriveMilestones` / … 全部是
 *     **领域层纯函数**，接受数组、接受显式 `today`；
 *   - 每个宿主手上都是 `Record<id, Entity>` 的物化状态；
 *   - 把后者摊成前者、滤掉墓碑、把 `now` 换算成 `LocalDate` —— 这三件事
 *     **有五种做法、五种做法会漂移**，而且漂移的后果都是"安静地算错"。
 *
 * 在这之前，这一整段只存在于 `apps/web/src/features/motivation/selectors.ts`，
 * 而移动端要画同一批数字就得抄第二份。AGENTS.md §3.5 末尾那条教训说得很直白：
 * **"抽出了一个共享实现"不等于"重复被消除了"** —— 抽取的收尾动作是
 * **删掉旧的那份并让两端都调这一份**，不是写一个更好的新版本。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **这一层不做任何"业务上该怎么算"的判断。**
 *
 * 什么算达成、什么算今天该做、冻结怎么算、里程碑阈值是多少 —— 一个字都不在
 * 这里。这里只有"摊平 + 滤墓碑 + 注入 now"，加上两处**取值选择**：
 *
 *   1. `bestCurrentStreak` 取的是**当前**连续（不是历史最长）——
 *      因为身份标签说的是"你现在是什么样的人"（见计划 §5）；
 *   2. `dailyActivityCounts` 的口径只为"有没有在做"服务，不为打卡服务。
 *
 * 两者都有名字、有注释、有测试，不是散落在某个组件里的 anonymous reduce。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ **`now` 一律由调用方传入，绝不在里面读 `Date.now()`。**
 * 否则同一次渲染里，上面的卡片和下面的列表可能落在不同的日期上 ——
 * 而且测试无法稳定断言（与 `category-report.ts` 同一条纪律）。
 */

import {
  addDays,
  computeActivityTotals,
  computeStreak,
  computeTodayProgress,
  computeWeeklyReview,
  deriveIdentityTags,
  deriveMilestones,
  describeHabitResilience,
  focusSessionDay,
  shouldPersistSession,
  toLocalDate,
  type ActivityTotals,
  type FocusSession,
  type Habit,
  type HabitLog,
  type HabitResilienceView,
  type IdentityTagProgress,
  type LocalDate,
  type MilestoneProgress,
  type Project,
  type StreakResult,
  type Task,
  type TodayProgress,
  type WeeklyReview,
} from '@heyta/domain';

import { aliveRecords } from './category-report.js';

/**
 * 激励体系真正读的五张表。结构上由 `MaterializedState` 满足。
 *
 * 🔴 刻意**不**直接收 `MaterializedState`：那个接口还带着 `aiFeedback` /
 * `preferenceCorrections` 等与激励无关的字段，每加一个实体这里就要重审一遍。
 * 只声明真正用到的五张表，耦合面小得多 —— 与 `CategoryTables` 同一个理由。
 */
export interface MotivationTables {
  habits: Record<string, Habit>;
  habitLogs: Record<string, HabitLog>;
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
  focusSessions: Record<string, FocusSession>;
}

/**
 * 今日进度（L1）。口径全在 `computeTodayProgress`，这里只摊平 + 注入 `today`。
 *
 * ⚠️ 这里滤墓碑是**故意冗余**的：`computeTodayProgress` 自己就会跳过
 * `deletedAt !== undefined` 的实体。实测过 —— 把这行 `aliveRecords` 换成
 * `Object.values`，本文件的全部用例**依然全绿**（变异验证 MV1）。
 *
 * 那为什么还要留？因为这一层的契约写的是"摊平 + 滤墓碑"，而这两个动作
 * 一旦分开放在五个领域函数里，将来任何**新**的领域函数忘了滤，就会在这里
 * 静默漏进墓碑数据。冗余的代价是零（一次浅拷贝遍历），而漏一处墓碑的症状是
 * "删掉的打卡又亮了"，且不报错。真正**承重**的那处滤墓碑在
 * `dailyActivityCountsFromState` —— 那里是这一层自己累加，没有领域函数兜底，
 * 也是 MV1b 能变红的那一条。
 */
export function todayProgressFromState(state: MotivationTables, now: number): TodayProgress {
  return computeTodayProgress({
    habits: aliveRecords(state.habits),
    logs: aliveRecords(state.habitLogs),
    tasks: aliveRecords(state.tasks),
    focusSessions: aliveRecords(state.focusSessions),
    today: toLocalDate(now),
  });
}

/** 累计总量（L3 的输入）。全部只增不减，见 `computeActivityTotals` 的文件头。 */
export function activityTotalsFromState(state: MotivationTables): ActivityTotals {
  return computeActivityTotals({
    logs: aliveRecords(state.habitLogs),
    tasks: aliveRecords(state.tasks),
    focusSessions: aliveRecords(state.focusSessions),
  });
}

/** 里程碑阶梯（L3）。包含全部档位 —— 界面需要"下一档还差多少"。 */
export function milestonesFromState(state: MotivationTables): MilestoneProgress[] {
  return deriveMilestones(activityTotalsFromState(state));
}

/** 周复盘（L3）。差值只用中性表述，**不给下降配红色**（见 `GrowthScreen` 文件头）。 */
export function weeklyReviewFromState(state: MotivationTables, now: number): WeeklyReview {
  return computeWeeklyReview({
    logs: aliveRecords(state.habitLogs),
    tasks: aliveRecords(state.tasks),
    focusSessions: aliveRecords(state.focusSessions),
    today: toLocalDate(now),
  });
}

/**
 * 所有习惯里**当前**连续天数最大的那个。
 *
 * 🔴 取 `current` 而不是 `longest`。身份标签说的是"你现在是什么样的人"：
 * 一个两年前连续过 300 天、此后再没打开过的习惯，不该给用户发身份
 * （计划 §5）。这个选择以前埋在 Web 选择器的一个 `reduce` 里，
 * 现在有了名字，也就能被单独测。
 */
export function bestCurrentStreak(
  habits: readonly Habit[],
  logs: readonly HabitLog[],
  today: LocalDate,
): number {
  return habits.reduce((best, habit) => {
    const own = logs.filter((l) => l.habitId === habit.id);
    return Math.max(best, computeStreak(habit, own, today).current);
  }, 0);
}

/** 身份标签（L3）。`bestCurrentStreak` 的口径见上。 */
export function identityTagsFromState(
  state: MotivationTables,
  now: number,
): IdentityTagProgress[] {
  const today = toLocalDate(now);
  return deriveIdentityTags({
    totals: activityTotalsFromState(state),
    bestCurrentStreak: bestCurrentStreak(
      aliveRecords(state.habits),
      aliveRecords(state.habitLogs),
      today,
    ),
  });
}

/**
 * 一个习惯的成长数据：连续 + 韧性。
 *
 * 🔴 **两个数字必须用同一份日志、同一个 `today` 算出来。**
 * 分开算两次是漂移的开始：结果是同一个卡片上"当前连续 12 天"与
 * "韧性说 11 天"对不上账，而两边都不报错（见 `describeHabitResilience` 尾部）。
 * 所以配对这件事收在这一个函数里，Web 与移动端都调它。
 *
 * ⚠️ 这里**不**滤墓碑：`computeStreak` / `describeHabitResilience` 内部各自
 * 按 `deletedAt` 判定"达成"，外面再滤一遍只是重复劳动（撤销就是没发生）。
 */
export interface HabitGrowthRow {
  habit: Habit;
  streak: StreakResult;
  resilience: HabitResilienceView;
}

export function habitGrowth(habit: Habit, logs: readonly HabitLog[], today: LocalDate): HabitGrowthRow {
  const own = logs.filter((l) => l.habitId === habit.id);
  return {
    habit,
    streak: computeStreak(habit, own, today),
    // 韧性与 streak 共用同一份日志、同一个 today，所以两个数字**不可能对不上账**。
    resilience: describeHabitResilience(habit, own, today),
  };
}

/** 所有未删除的习惯的成长数据。 */
export function habitGrowthFromState(state: MotivationTables, now: number): HabitGrowthRow[] {
  const today = toLocalDate(now);
  const logs = aliveRecords(state.habitLogs);
  return aliveRecords(state.habits).map((habit) => habitGrowth(habit, logs, today));
}

/** 近 N 天里某一天的活动量。`level` 分档是**展示**参数，留在各宿主。 */
export interface DailyActivityCount {
  date: LocalDate;
  count: number;
}

/** 年视图的默认窗口（天）。配置只该有一处定义。 */
export const DEFAULT_ACTIVITY_DAYS = 365;

/**
 * 近 N 天"有没有在做"的每天计数。
 *
 * 🔴 口径刻意**不**只为打卡服务：只数打卡的话，一个用 heyta 专注和完成任务、
 * 但从不建习惯的用户会看到一片空白 —— 而那是一片假的空白。
 *
 * 返回的是**事实**（每天几件），不是分档。`level`（1 / 2 / 3 / 4+）是热力图
 * 那类展示的适配，属于各宿主的 UI 层 —— 见
 * `apps/web/src/features/motivation/selectors.ts` 的 `levelOf`。
 */
export function dailyActivityCountsFromState(
  state: MotivationTables,
  now: number,
  days: number = DEFAULT_ACTIVITY_DAYS,
): DailyActivityCount[] {
  const today = toLocalDate(now);
  const counts = new Map<LocalDate, number>();

  const bump = (date: LocalDate): void => {
    counts.set(date, (counts.get(date) ?? 0) + 1);
  };

  for (const log of aliveRecords(state.habitLogs)) bump(log.date);
  for (const task of aliveRecords(state.tasks)) {
    if (task.completedAt !== undefined) bump(toLocalDate(task.completedAt));
  }
  for (const session of aliveRecords(state.focusSessions)) {
    // 与今日进度同口径：只有工作段算"在做"，休息不算。
    if (!shouldPersistSession(session)) continue;
    bump(toLocalDate(focusSessionDay(session)));
  }

  const out: DailyActivityCount[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}
