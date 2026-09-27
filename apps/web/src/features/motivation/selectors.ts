/**
 * 激励体系的选择器（Web 壳）
 * ================================
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **这里没有一行"业务判断"。**
 *
 * 判什么算达成、什么算今天该做、冻结怎么算 —— 全部在 `@heyta/domain`
 * 的纯函数里（`today-progress` / `milestones` / `weekly-review` /
 * `identity-tags` / `habit-resilience`）。这个文件只做两件事：
 *
 *   1. 把物化状态（`Record<id, Entity>`）摊成领域层要的数组；
 *   2. 把 `now` 换算成 `LocalDate`。
 *
 * 之所以仍然值得单独一个文件：**这两件事有五种做法，而五种做法会漂移。**
 * "今天的进度"与"周复盘"如果各自 `Object.values` 再各自算一遍 `today`，
 * 同一个界面上就会出现两个对不上账的真相（比如一次渲染跨了午夜）。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ **`now` 一律由调用方传入，绝不在里面读 `Date.now()`。**
 * 否则同一次渲染里，上面的卡片和下面的列表可能落在不同的日期上 ——
 * 而且测试无法稳定断言。
 */

import { aliveRecords, categoryReportFromTables } from '@heyta/app-host';
import {
  computeActivityTotals,
  computeStreak,
  computeTodayProgress,
  computeWeeklyReview,
  deriveIdentityTags,
  deriveMilestones,
  toLocalDate,
  addDays,
  type ActivityTotals,
  type CategoryReport,
  type FocusSession,
  type Habit,
  type HabitLog,
  type IdentityTagProgress,
  type LocalDate,
  type MilestoneProgress,
  type Project,
  type Task,
  type TodayProgress,
  type WeeklyReview,
} from '@heyta/domain';

/**
 * 选择器的输入形状。
 *
 * 🔴 刻意**不**直接依赖 `@heyta/op-log` 的 `MaterializedState`：
 * 那个接口还带着 `aiFeedback` / `preferenceCorrections` 等与激励无关的字段，
 * 而且它每加一个实体，这个文件就要跟着重新审一遍。只声明**真正用到的五张表**，
 * 结构上可赋（`MaterializedState` 天然满足），但耦合面小得多。
 */
export interface MotivationInput {
  habits: Record<string, Habit>;
  habitLogs: Record<string, HabitLog>;
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
  focusSessions: Record<string, FocusSession>;
}

/**
 * 只保留未软删除的记录（语义与实现在 `@heyta/app-host#aliveRecords`）。
 *
 * 🔴 本地这个别名**不是**为了少打几个字：Web 的六个选择器、移动端的分类屏、
 * 以及以后任何统计屏都得滤墓碑，各写一份就是"撤销掉的时间又回到统计里"
 * 这类缺陷的温床。别名只保留可读性，实现只有一处。
 */
const alive = aliveRecords;

export function selectTodayProgress(state: MotivationInput, now: number): TodayProgress {
  return computeTodayProgress({
    habits: alive(state.habits),
    logs: alive(state.habitLogs),
    tasks: alive(state.tasks),
    focusSessions: alive(state.focusSessions),
    today: toLocalDate(now),
  });
}

export function selectTotals(state: MotivationInput): ActivityTotals {
  return computeActivityTotals({
    logs: alive(state.habitLogs),
    tasks: alive(state.tasks),
    focusSessions: alive(state.focusSessions),
  });
}

export function selectMilestones(state: MotivationInput): MilestoneProgress[] {
  return deriveMilestones(selectTotals(state));
}

export function selectWeeklyReview(state: MotivationInput, now: number): WeeklyReview {
  return computeWeeklyReview({
    logs: alive(state.habitLogs),
    tasks: alive(state.tasks),
    focusSessions: alive(state.focusSessions),
    today: toLocalDate(now),
  });
}

/**
 * 身份标签。
 *
 * `bestCurrentStreak` 取的是**所有习惯里当前连续天数最大的那个** ——
 * 不是最长历史记录。理由见计划 §5：身份标签说的是"你现在是什么样的人"，
 * 一个两年前连续过 300 天、此后再没打开过的习惯，不该给用户发身份。
 */
export function selectIdentityTags(state: MotivationInput, now: number): IdentityTagProgress[] {
  const today = toLocalDate(now);
  const habits = alive(state.habits);
  const logs = alive(state.habitLogs);

  const bestCurrentStreak = habits.reduce((best, habit) => {
    const own = logs.filter((l) => l.habitId === habit.id);
    return Math.max(best, computeStreak(habit, own, today).current);
  }, 0);

  return deriveIdentityTags({ totals: selectTotals(state), bestCurrentStreak });
}

/** 一年视图里的一个格子。 */
export interface DayActivity {
  date: LocalDate;
  /** 这一天"完成了几件事"：打卡 + 完成的任务 + 专注轮次。 */
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

/**
 * 近 N 天"有没有在做"的格子。
 *
 * 🔴 口径刻意**不**只为打卡服务：只画打卡热力图的话，一个用 heyta 专注
 * 和完成任务、但从不建习惯的用户会看到一片空白 —— 而那是一片假的空白。
 *
 * ⚠️ 等级阈值（1 / 2 / 3 / 4+）是**展示**参数，不是业务判据，
 * 所以留在这一层；这也是它没有进 `packages/domain` 的原因。
 */
export function selectYearActivity(state: MotivationInput, now: number, days = 365): DayActivity[] {
  const today = toLocalDate(now);
  const counts = new Map<LocalDate, number>();

  const bump = (date: LocalDate): void => {
    counts.set(date, (counts.get(date) ?? 0) + 1);
  };

  for (const log of alive(state.habitLogs)) bump(log.date);
  for (const task of alive(state.tasks)) {
    if (task.completedAt !== undefined) bump(toLocalDate(task.completedAt));
  }
  for (const session of alive(state.focusSessions)) {
    // 与今日进度同口径：只有工作段算"在做"，休息不算。
    if (session.kind !== 'work') continue;
    bump(toLocalDate(session.endedAt ?? session.createdAt));
  }

  const out: DayActivity[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const count = counts.get(date) ?? 0;
    out.push({ date, count, level: levelOf(count) });
  }
  return out;
}

function levelOf(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

/** 今天的日期字符串。组件用它做"是否已跨天"的判据，不参与计算。 */
export function todayOf(now: number): LocalDate {
  return toLocalDate(now);
}

/**
 * 分类时长报告（近 N 周，按清单 / 按习惯归因）。
 *
 * 归因链、口径、窗口全在 `computeCategoryReport`（`@heyta/domain`）里，
 * 这里只把四张表摊平并注入 `now` —— 与上面几个选择器同一条纪律。
 *
 * ⚠️ 标签（TAG）**不参与**：标签是多对多的，一条任务挂两个标签时
 * 同一分钟会被算两次，而"总时长"立刻变成假数。已拍板 D2（见计划 §7）。
 */
export function selectCategoryReport(
  state: MotivationInput,
  now: number,
  weeks?: number,
): CategoryReport {
  // 摊平 + 注入 now 走**共享实现**：移动端的分类屏要用同一份
  // （见 `packages/app-host/src/category-report.ts` 的文件头）。
  return categoryReportFromTables(state, now, weeks);
}