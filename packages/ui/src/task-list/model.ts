/**
 * 任务列表的**纯逻辑**层
 * ======================
 *
 * 🔴 这个文件里**不许 import `react-native`**，这是硬约束而不是风格偏好：
 *
 * 1. `packages/ui/vitest.config.ts` 用 `environment: 'node'`。RN 是 Flow 源码，
 *    node 解析不了它 —— 一旦这里 import 了 RN，**测试会立刻挂**。
 *    等于用测试免费钉住了"宿主无关"这件事，不需要靠代码评审去记。
 * 2. 排序 / 取标题这类判断**与怎么画无关**。把它们留在组件里，
 *    就意味着"想验证排序规则"必须先起一个 RN 渲染环境 ——
 *    而真到了那一步，多数人不会去测，规则就此无人守。
 *
 * 组件（`TaskList.tsx`）只负责把这里的输出摆到 RN 原语上，那一段是**没有分支**的。
 */

import type { Task } from '@heyta/domain';

/** 列表渲染需要的**最小**字段集。刻意不是整个 `Task` 的展开。 */
export interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly important: boolean;
  /** 截止时间（epoch ms）。没有截止时间是 `null`，不是 `0`。 */
  readonly dueAt: number | null;
  /**
   * 原始的 `Task`。
   *
   * 🔴 为什么把整个实体带进来，而不是只加几个字段：
   *
   * 宿主需要在插槽里渲染**本地化**的元信息（截止文案、优先级徽章、重复规则），
   * 而那些都要求拿到任务本体（`priority` 是数值枚举、`repeatOf` 还要按 id 查）。
   * 每多一个这样的需求就往 `TaskRow` 上加一个字段，等于让这个"最小字段集"
   * 无限膨胀，而且每加一次都要改这个文件 —— 却没有任何判断可复用。
   *
   * 把本体挂在这里，插槽就能自己取；`TaskRow` 自己那四个字段仍然是
   * **派生过、有测试钉着**的（见本文件的 `toTaskRow`），不是摆设。
   */
  readonly source: Task;
}

export interface ToTaskRowOptions {
  /**
   * 标题为空时的替代文案。
   *
   * 🔴 **空标题是真实存在的**：快速捕获允许用户先敲个空格/回车就建任务
   * （捕捉想法时不该先逼他写标题）。不处理的话，列表上会出现一行**点不着、
   * 也看不懂**的空白 —— 而它其实是条真数据。
   *
   * 默认值是空串而不是写死中文：本包不含 i18n（理由见 `TaskList.tsx` 文件头），
   * 所以文案必须由宿主给。
   */
  readonly fallbackTitle?: string;
}

/** 单条 `Task` → 渲染用的行模型。 */
export function toTaskRow(task: Task, options?: ToTaskRowOptions): TaskRow {
  const title = task.title.trim();
  return {
    id: task.id,
    title: title === '' ? (options?.fallbackTitle ?? '') : title,
    // 🔴 完成状态只认 `completedAt`。domain 里刻意**没有** `completed` 布尔
    // （见 entities.ts 的注释），这里再造一个就等于给自己留了两份会不一致的真相。
    // 注意判的是"存不存在"而不是真值：`completedAt: 0` 也是已完成。
    done: task.completedAt !== undefined,
    important: task.important === true,
    dueAt: task.dueDate ?? null,
    source: task,
  };
}

/**
 * 列表展示顺序：**未完成在前，已完成在后；都按截止时间升序，无截止的排最后。**
 *
 * 为什么是这三条：
 *   - 未完成在前 —— 已完成的对"接下来做什么"没有信息量；
 *   - 截止近的在前 —— 这是用户扫这一眼的目的；
 *   - 无截止的排最后 —— 它们没有紧迫性，但**不能丢**（收集箱里就是这类）。
 *
 * ⚠️ 必须是**稳定**排序。同一天到期的任务之间若顺序随机，每次 relayout 都会
 * 抖一下，而"列表会自己换位置"是用户最直接的不信任来源。
 * `Array.prototype.sort` 在 ES2019 起保证稳定，但这里仍显式带上下标兜底 ——
 * 依赖一条"语言规范保证"而没人写下来，下一个读代码的人会以为是巧合。
 */
export function sortTasksForDisplay(tasks: readonly Task[]): readonly Task[] {
  const indexed = tasks.map((task, index) => ({ task, index }));
  indexed.sort((a, b) => {
    const aDone = a.task.completedAt !== undefined;
    const bDone = b.task.completedAt !== undefined;
    if (aDone !== bDone) return aDone ? 1 : -1;

    // `undefined`（无截止）排在有截止的后面。用 Infinity 而不是 0：
    // 0 是 1970-01-01，会被当成"最紧急"，正好排反。
    const aDue = a.task.dueDate ?? Number.POSITIVE_INFINITY;
    const bDue = b.task.dueDate ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    return a.index - b.index;
  });
  return indexed.map((entry) => entry.task);
}

/** 一步到位的入口：排序 + 转行模型。 */
export function toTaskRows(
  tasks: readonly Task[],
  options?: ToTaskRowOptions,
): readonly TaskRow[] {
  return sortTasksForDisplay(tasks).map((task) => toTaskRow(task, options));
}
