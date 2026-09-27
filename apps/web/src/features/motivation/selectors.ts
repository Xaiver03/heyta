/**
 * 激励体系的选择器（Web 壳）
 * ================================
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **这里没有一行"业务判断"，也没有一行"取数"了。**
 *
 * 判什么算达成、什么算今天该做、冻结怎么算 —— 全部在 `@heyta/domain`
 * 的纯函数里（`today-progress` / `milestones` / `weekly-review` /
 * `identity-tags` / `habit-resilience`）。
 *
 * 而"把物化状态摊成领域层要的数组、滤掉墓碑、把 `now` 换算成 `LocalDate`"
 * 这一整段，现在在 `@heyta/app-host` 的 `motivation.ts` 里 —— 因为
 * **移动端要画同一批数字**，而这段摊平有五种做法、五种做法会漂移
 * （详见那个文件的文件头）。
 *
 * 本文件剩下的只有两件事：
 *
 *   1. 把共享层的函数**转发**成 Web 组件已经在用的名字（`select*`）——
 *      组件一行都不用改，这是"抽出去之后删掉旧实现"的收尾方式：
 *      旧实现的职责没了，但**调用点**的名字不必跟着改；
 *   2. 给年视图的格子补上 `level` 分档 —— 那是**热力图库的展示适配**，
 *      不是业务判据（见 `selectYearActivity` 的注释），所以刻意留在壳里。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ **`now` 一律由调用方传入，绝不在里面读 `Date.now()`。**
 * 否则同一次渲染里，上面的卡片和下面的列表可能落在不同的日期上 ——
 * 而且测试无法稳定断言。
 */

import {
  activityTotalsFromState,
  categoryReportFromTables,
  dailyActivityCountsFromState,
  identityTagsFromState,
  milestonesFromState,
  todayProgressFromState,
  weeklyReviewFromState,
  type MotivationTables,
} from '@heyta/app-host';
import {
  toLocalDate,
  type ActivityTotals,
  type CategoryReport,
  type IdentityTagProgress,
  type LocalDate,
  type MilestoneProgress,
  type TodayProgress,
  type WeeklyReview,
} from '@heyta/domain';

/**
 * 选择器的输入形状 —— 就是共享层的 `MotivationTables`。
 *
 * 🔴 保留这个名字是**刻意的**：Web 组件与测试已经按它书写，而它比
 * `MotivationTables` 更贴近"这一屏要的五张表"。类型别名只保留可读性，
 * 结构定义只有一处。
 */
export type MotivationInput = MotivationTables;

export function selectTodayProgress(state: MotivationInput, now: number): TodayProgress {
  return todayProgressFromState(state, now);
}

export function selectTotals(state: MotivationInput): ActivityTotals {
  return activityTotalsFromState(state);
}

export function selectMilestones(state: MotivationInput): MilestoneProgress[] {
  return milestonesFromState(state);
}

export function selectWeeklyReview(state: MotivationInput, now: number): WeeklyReview {
  return weeklyReviewFromState(state, now);
}

/**
 * 身份标签。
 *
 * `bestCurrentStreak` 取的是**所有习惯里当前连续天数最大的那个** ——
 * 不是最长历史记录。理由见计划 §5：身份标签说的是"你现在是什么样的人"，
 * 一个两年前连续过 300 天、此后再没打开过的习惯，不该给用户发身份。
 * 这条选择已收进共享层（`@heyta/app-host#bestCurrentStreak`）并被单测钉住。
 */
export function selectIdentityTags(state: MotivationInput, now: number): IdentityTagProgress[] {
  return identityTagsFromState(state, now);
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
 * 每天几件是**事实**，由共享层给出；`level` 是
 * [react-activity-calendar](https://github.com/grubersjoe/react-activity-calendar)
 * 要的分档 —— 换图表库这份映射就要改，所以它是**展示**参数，
 * 刻意留在壳里，不进共享层。
 */
export function selectYearActivity(state: MotivationInput, now: number, days = 365): DayActivity[] {
  return dailyActivityCountsFromState(state, now, days).map(({ date, count }) => ({
    date,
    count,
    level: levelOf(count),
  }));
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
