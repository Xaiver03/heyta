/**
 * 周历条的可滚动索引模型（纯函数，无 React / RN 依赖）
 * ==================================================================
 *
 * 周历条要「无限」地前后翻周。做法不是把日期拼成一个有尽头的数组，
 * 而是给每一周一个**相对固定锚点的整数索引**，把"翻到哪一周"变成"索引加几"：
 *
 *   `weekStartForIndex(i) = ANCHOR + 7·i`（i 可为负）
 *   `weekIndexFor(weekStart) = (weekStart − ANCHOR) / 7`
 *
 * 上层用一个虚拟化横向列表（`FlatList` + `getItemLayout`）只渲染可视窗口，
 * 数据只是 `[FIRST, LAST]` 这段整数，所以内存与"日期跨度"无关；渲染量只跟屏幕内
 * 有几周有关。这正是日历类"无限滚动"的通行工程做法 —— 索引是无限的概念，
 * 渲染是有界的窗口，二者不混在一起。
 *
 * ⚠️ 这里刻意**不**做"滑到边缘再加一段数据并改 contentOffset"的回收式无限列表：
 *   那需要在滚动过程中改偏移量、处理像素与索引的二次换算，任何一步对不齐就是
 *   肉眼可见的跳动，维护成本远大于收益。用一个足够宽的固定索引区间
 *   （`±WEEK_STRIP_HALF_SPAN_WEEKS`，约 ±200 年）等价于无限，且代码只有这几行。
 *
 * 锚点必须是**周一**：所有调用方传进来的 `weekStart` 都来自 `startOfWeek`，
 * 锚点不是周一的话 `(weekStart − ANCHOR)` 就不是 7 的整数倍，索引会漂。
 */

import { addDays, diffDays, type LocalDate } from '@heyta/domain';

/** 锚点：2000-01-03，是一个周一。 */
export const WEEK_STRIP_ANCHOR: LocalDate = '2000-01-03';

/**
 * 索引半幅（单位：周）。约 ±200 年。
 *
 * 选"固定且足够宽"而不是"动态扩展"：区间本身只是约 2 万个整数，
 * 虚拟化列表不会因为区间宽就多渲染；而一个任务应用不会有人翻到 200 年前后，
 * 等价于无限，同时免去回收式列表改偏移量的那套易错逻辑。
 */
export const WEEK_STRIP_HALF_SPAN_WEEKS = 10_436;

export const WEEK_STRIP_FIRST_INDEX = -WEEK_STRIP_HALF_SPAN_WEEKS;
export const WEEK_STRIP_LAST_INDEX = WEEK_STRIP_HALF_SPAN_WEEKS;
/** 索引区间内的条目总数（列表 data 长度）。 */
export const WEEK_STRIP_COUNT = WEEK_STRIP_LAST_INDEX - WEEK_STRIP_FIRST_INDEX + 1;

/** 某一周（必须传周一）相对锚点的周数。可正可负。 */
export function weekIndexFor(weekStart: LocalDate): number {
  return Math.round(diffDays(WEEK_STRIP_ANCHOR, weekStart) / 7);
}

/** 索引 → 那一周的周一。可正可负。 */
export function weekStartForIndex(index: number): LocalDate {
  return addDays(WEEK_STRIP_ANCHOR, index * 7);
}

/** 把索引夹进列表支持的区间，越界时贴边（不抛错，交给列表自身的回弹）。 */
export function clampWeekStripIndex(index: number): number {
  if (index < WEEK_STRIP_FIRST_INDEX) return WEEK_STRIP_FIRST_INDEX;
  if (index > WEEK_STRIP_LAST_INDEX) return WEEK_STRIP_LAST_INDEX;
  return index;
}

/** 周索引 → FlatList 的**位置**（0 基）；两者差一个固定的 FIRST_INDEX。 */
export function weekStripListPosition(index: number): number {
  return index - WEEK_STRIP_FIRST_INDEX;
}

/**
 * 横向滚动偏移量落在哪一周的索引。
 *
 * 松手吸附后 `offsetX` 就是"第几个可视页 × 页宽"，四舍五入回最近的整页；
 * 脏手指/半格误差由 `round` 吸收，落到哪一周由索引决定，不做像素级判断。
 */
export function weekIndexAtOffset(offsetX: number, pageWidth: number): number {
  if (pageWidth <= 0) return WEEK_STRIP_FIRST_INDEX;
  return clampWeekStripIndex(WEEK_STRIP_FIRST_INDEX + Math.round(offsetX / pageWidth));
}
