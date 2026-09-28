/**
 * 任务筛选语义 —— **"哪些任务该出现在当前视图里"只有一个定义**
 * ============================================================================
 *
 * 🔴 **这个文件补的是一处 M1 违规。**
 *
 * 「哪些任务算今天的」「哪些算已完成」「某个清单/标签下的任务有哪些」——
 * 这些全是**产品语义**，而它们此前住在 `apps/web/src/features/tasks/store.ts`
 * 的 `selectVisibleTasks` 里（一个壳）。移动端拿不到它，于是
 * `apps/mobile/src/screens/TasksScreen.tsx` **自己又写了一份分组逻辑**
 * （overdue / dueToday / inbox / completed）。两份实现，零交叉校验。
 *
 * 这正是 `AGENTS.md` §3.5 那道判据要拦的东西：
 * **"这段代码里有没有任何一行在决定业务上该怎么做？"**
 * 有 —— "截止日期早于今天算逾期"就是一条业务判断，它不该由壳来决定。
 *
 * ## 为什么筛选与分节放在同一个文件
 *
 * 它们看着是两件事（web 是"筛一个列表"，移动端是"分成几段"），
 * 但底下是**同一批判据**：什么算今天、什么算逾期、什么算未分类。
 * 分成两个文件迟早会让"今天"在两处各自定义一次 —— 而那种漂移的表现是
 * "同一个任务在网页的今天里、在手机的逾期里"，且不报错。
 *
 * ## 两件刻意不做的事
 *
 * 1. **不碰存储、不建索引。** 这里是纯函数，输入是已经摊平的任务数组。
 *    "怎么把它们读出来"是各端的平台差异（浏览器是 IndexedDB/OPFS，
 *    移动端是 SQLite），不属于产品语义。
 * 2. **不排序。** 顺序是**跨端一致的规范顺序**，由 `packages/app-host` 定
 *    （见 `actions.ts` 里 listTasks 那段）。筛选层再排一次就会出现
 *    "两端筛选结果一样、顺序不一样"。
 */

import {
  startOfDay,
  type LocalDate,
  toLocalDate,
} from './date.js';
import { Quadrant, type Task } from './entities.js';
import { bucketByQuadrant } from './quadrant.js';

/**
 * 一条任务筛选。
 *
 * 🔴 **它是判别联合，不是 `{ kind, value }` 那种宽形状。** 用判别联合之后，
 * 加一个分支（例如这次的 `tag`）会让所有 `switch` 在编译期被检查到 ——
 * 而宽形状会让"忘了处理新分支"表现为**运行时静默返回空列表**。
 */
export type TaskFilter =
  | { kind: 'all' }
  | { kind: 'today' }
  | { kind: 'completed' }
  | { kind: 'quadrant'; quadrant: Quadrant }
  | { kind: 'project'; projectId: string }
  | { kind: 'tag'; tagId: string };

/** 筛选需要的环境。`now` 显式传入，不在函数里读时钟 —— 见本文件头。 */
export interface FilterContext {
  readonly now: number;
}

/** 未删除的任务。**每一个筛选都先过这一道**，所以它是单独一步而不是分支里的重复。 */
export function aliveTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.deletedAt === undefined);
}

/** 是否已完成。「已完成」只有一个判据：`completedAt` 有值。 */
export function isCompleted(task: Task): boolean {
  return task.completedAt !== undefined;
}

/**
 * 任务的截止日（本地日期），没有截止时间时返回 `undefined`。
 *
 * ⚠️ 用 `toLocalDate`（按**设备本地时区**）而不是 UTC —— 用户的"今天"
 * 由他所在时区决定。跨端一致的前提是两端都调这一个函数。
 */
export function dueLocalDate(task: Task): LocalDate | undefined {
  return task.dueDate === undefined ? undefined : toLocalDate(task.dueDate);
}

/**
 * 按筛选取任务。
 *
 * ⚠️ **`completed` 与其它分支的语义差别是刻意的**：只有 `completed` 会返回
 * 已完成的任务，其余（含 `all`）都**只返回未完成的**。这与滴答清单一致：
 * 收集箱/今天/清单/标签看到的都是待办，已完成有它自己的位置。
 * 这条如果写反，症状是"任务勾完之后从清单里消失、用户以为丢了"。
 */
export function filterTasks(
  tasks: readonly Task[],
  filter: TaskFilter,
  context: FilterContext,
): Task[] {
  const alive = aliveTasks(tasks);

  switch (filter.kind) {
    case 'all':
      return alive.filter((t) => !isCompleted(t));
    case 'completed':
      return alive.filter(isCompleted);
    case 'today': {
      const today = startOfDay(context.now);
      return alive.filter(
        (t) => !isCompleted(t) && t.dueDate !== undefined && startOfDay(t.dueDate) === today,
      );
    }
    case 'quadrant':
      return bucketByQuadrant(alive, { now: context.now })[filter.quadrant];
    case 'project':
      return alive.filter((t) => !isCompleted(t) && t.projectId === filter.projectId);
    case 'tag':
      return alive.filter((t) => !isCompleted(t) && (t.tagIds?.includes(filter.tagId) ?? false));
  }
}

/**
 * 任务在移动端列表里的分节。
 *
 * 🔴 **为什么它也算产品语义**：四个分组名（逾期 / 今天 / 收集箱 / 已完成）
 * 与它们的**归属规则**是产品对用户说的话，不是某个屏幕的排版选择。
 * 移动端原先在屏幕组件里写了一遍 —— 于是网页想加同样的分组时，
 * 只能再写一遍，而"未来到期的任务归哪一组"这种细节必然对不上。
 *
 * `overdue` / `dueToday` / `inbox` 三组都**不含已完成**；已完成单独一组。
 * 分组内**不排序**（顺序由调用方按规范顺序决定，见文件头）。
 */
export interface TaskSections {
  readonly overdue: Task[];
  readonly dueToday: Task[];
  readonly inbox: Task[];
  readonly completed: Task[];
}

export function sectionTasks(
  tasks: readonly Task[],
  context: FilterContext,
): TaskSections {
  const today = startOfDay(context.now);
  const sections: TaskSections = { overdue: [], dueToday: [], inbox: [], completed: [] };

  for (const task of aliveTasks(tasks)) {
    if (isCompleted(task)) {
      sections.completed.push(task);
      continue;
    }
    if (task.dueDate === undefined) {
      sections.inbox.push(task);
      continue;
    }
    const due = startOfDay(task.dueDate);
    if (due < today) {
      sections.overdue.push(task);
    } else if (due === today) {
      sections.dueToday.push(task);
    } else {
      // 未来到期的任务归入收集箱 —— 完整的"未来"分组留给日历。
      sections.inbox.push(task);
    }
  }

  return sections;
}

/** 待办总数：三组待办之和。**分节与计数共用同一个定义**，不许各自算一遍。 */
export function pendingCount(sections: TaskSections): number {
  return sections.overdue.length + sections.dueToday.length + sections.inbox.length;
}
