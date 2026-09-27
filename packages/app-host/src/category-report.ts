/**
 * 物化状态 → 分类时长报告（宿主无关的那一段）
 * ==========================================
 *
 * `computeCategoryReport` 要的是**数组**，而每个宿主手上都是
 * `Record<id, Entity>` 的物化状态。把前者摊成后者这件事，本仓库已经有三处
 * （Web 的激励选择器、移动端即将有的分类屏、以及任何以后要画这块的宿主），
 * 而它**有五种做法、五种做法会漂移**：
 *
 *   - 谁负责滤掉软删除？（漏一处，撤销掉的时间就会回到统计里）
 *   - `now` 从哪里来？（在组件里读 `Date.now()`，同一次渲染就可能跨午夜）
 *   - 标签要不要参与？（多对多，参与就是同一分钟算两次 —— 已拍板不参与，见计划 §7 D2）
 *   - 窗口几周？（12 是配置，不该在每个宿主里各写一次字面量）
 *
 * 所以口径放在这里，而且是**纯函数、可注入 `now`**：宿主只负责把状态递进来。
 *
 * 🔴 这一层**不做任何业务判断** —— 归因链、窗口边界、峰值、分档全在
 * `@heyta/domain` 的 `computeCategoryReport` 里。这里只有"摊平 + 滤墓碑"。
 *
 * ⚠️ 为什么不直接收 `MaterializedState`：那个接口带着 `aiFeedback` /
 * `preferenceCorrections` 等与分类无关的字段，它每加一个实体这里就要重审一遍。
 * 所以对外只声明**真正用到的五张表**；`MaterializedState` 天然结构可赋，
 * 另给一个显式入口 `categoryReportFromState` 让宿主不用自己展开。
 */

import { computeCategoryReport, type CategoryReport } from '@heyta/domain';
import type { FocusSession, Habit, HabitLog, Project, Task } from '@heyta/domain';

/** 分类时长真正读的五张表。结构上由 `MaterializedState` 满足。 */
export interface CategoryTables {
  projects: Record<string, Project>;
  tasks: Record<string, Task>;
  habits: Record<string, Habit>;
  habitLogs: Record<string, HabitLog>;
  focusSessions: Record<string, FocusSession>;
}

/**
 * 只保留未软删除的记录。
 *
 * 🔴 撤销就是**没发生** —— 这是所有统计的共同前提。少滤一处，用户就会看到
 * "我删掉的那条任务的时间还在计数"，而那种数字比没有数字更糟：
 * 它让人开始怀疑这个页面上所有的数。
 *
 * ⚠️ 放在这里而不是各宿主各写一份：它是**语义**（墓碑不算数），
 * 不是展示偏好。
 */
export function aliveRecords<T extends { deletedAt?: number }>(records: Record<string, T>): T[] {
  return Object.values(records).filter((r) => r.deletedAt === undefined);
}

/**
 * 摊平 + 注入 `now`。
 *
 * `weeks` 省略时用领域层的默认窗口（`DEFAULT_CATEGORY_WEEKS`）——
 * 宿主不该自己写字面量，那是配置。
 */
export function categoryReportFromTables(
  tables: CategoryTables,
  now: number,
  weeks?: number,
): CategoryReport {
  return computeCategoryReport({
    projects: aliveRecords(tables.projects),
    tasks: aliveRecords(tables.tasks),
    habits: aliveRecords(tables.habits),
    habitLogs: aliveRecords(tables.habitLogs),
    // ⚠️ 标签（TAG）**不参与**：多对多，一条任务挂两个标签时同一分钟会被算两次，
    // 而"总时长"立刻变成假数。已拍板 D2（见计划 §7）。
    focusSessions: aliveRecords(tables.focusSessions),
    now,
    weeks,
  });
}

/** 宿主侧的便利入口：`MaterializedState` 直接进，不用自己展开五张表。 */
export function categoryReportFromState(
  state: CategoryTables,
  now: number,
  weeks?: number,
): CategoryReport {
  return categoryReportFromTables(state, now, weeks);
}