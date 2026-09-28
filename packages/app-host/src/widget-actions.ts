/**
 * 小组件意图的落地（`intents.ts` → 真正的 op）
 * ==============================================
 *
 * ## 🔴 这个文件为什么必须在 `app-host` 里
 *
 * `@heyta/widget-core` 在**类型上产生不了 op** —— 那是刻意的红线
 * （与 `@heyta/local-api` 同一条）：组件只能表达"用户想要什么"。
 * 而"想要"变成"写一条 op"这件事，按 `AGENTS.md` §3.5 **只允许在 `packages/app-host`** 里做。
 *
 * 所以职责被切成两半：
 *
 * | 谁 | 做什么 |
 * |---|---|
 * | 组件（四端原生） | 往共享容器写 `{ taskId, targetIsDone }` |
 * | `widget-core/intents.ts` | 合并、去重、按当前状态分类（纯函数） |
 * | **本文件** | 把该执行的那条**变成 op**（复用 `TaskActions`） |
 *
 * ## 🔴 复用 `TaskActions.setCompleted`，而不是自己拼 op
 *
 * 这是本文件最重要的一条。`setCompleted` 里已经有两条**不该在这里重写**的语义：
 *
 *   1. **重复任务**：完成它 = 把 `dueDate` 推进到下一次，**不是**写 `completedAt`
 *      （写 `completedAt` 会让"每周一"的任务掉进已完成分组再也不出来）。
 *   2. **`completedAt: null`** 表示取消完成（文件头第 2 条：`null` 能穿过 JSON 表达"清除"）。
 *
 * 自己拼一个 `{ completedAt: now() }` 会让**重复任务从组件点完成之后直接消失**，
 * 而且只在"用组件点重复任务"这一条路径上出现 —— 极难归因。
 *
 * ## 🔴 一次点击 = **恰好一条 op**
 *
 * `AGENTS.md` §3.4。注意这不只是"不要批量化"：`applied` 计数必须等于
 * 产生的 op 数，而 **1 条意图恰好产生 1 条 op**。测试断言的是
 * `op 数增量 === applied`，不是"至少产生了 op" ——
 * "至少"会让"一次点击产生两条 op"这种最危险的情况溜过去
 * （症状是同步时多出一条无意义的写，两端的 `updatedAt` 对不上）。
 *
 * ## 失败处理：坏消息留在队列里，好消息清掉
 *
 * | 情况 | 处理 | 理由 |
 * |---|---|---|
 * | 执行成功 | 从队列移除 | 已完成 |
 * | 已在目标状态 | 从队列移除 | 再放回去会永远重来 |
 * | 任务不存在 | 从队列移除 | 不可能成功，留着就是**毒丸** |
 * | 执行抛错 | **留在队列** | 可能是暂时性的（库锁着），下次 drain 重试 |
 *
 * 关键是**单条失败不中断整批**：用户点了 3 下，第 2 下因为任务被删而失败，
 * 第 1 下和第 3 下仍然应该生效。
 */

import {
  WIDGET_INTENT_VERSION,
  classifyIntents,
  type WidgetIntent,
  type WidgetIntentQueue,
} from '@heyta/widget-core';

import type { TaskActions } from './actions.js';

/**
 * drain 需要的能力面。**故意收窄**成两件事，而不是收整个 `TaskActions`：
 *
 *   - 测试里能一眼看出"这个流程只读任务、只改完成态"；
 *   - 以后 `TaskActions` 长大时，这个函数的权限不会被顺手放宽。
 */
export type WidgetDrainTasks = Pick<TaskActions, 'findTask' | 'setCompleted'>;

export interface WidgetDrainResult {
  /** 成功执行、产生了 op 的意图数。**应等于新增的 op 数。** */
  applied: number;
  /** 任务在、但已经是目标态 → 丢弃（否则会篡改 `completedAt`）。 */
  skippedAlreadyInTarget: number;
  /** 任务不存在（已删/已清）→ 丢弃（留着就是毒丸）。 */
  skippedMissing: number;
  /** 执行抛错的 —— **仍然留在队列里**，下次 drain 重试。 */
  failed: WidgetIntent[];
  /**
   * 应当写回共享容器的队列。
   *
   * ⚠️ **本函数不写容器** —— 那是宿主的活（它才知道容器在哪、怎么加锁）。
   * 这里只回答"剩下什么"。把"决定"和"落盘"分开，是为了让这段逻辑可测。
   */
  remaining: WidgetIntentQueue;
}

/**
 * 把意图队列落到物化状态上。
 *
 * @param queue  从共享容器读出来的队列（用 `parseIntentQueue` 解析过）
 * @param tasks  任务动作集（真实的那一个 —— 不要为测试造假实现，见测试文件头）
 */
export async function drainWidgetIntents(
  queue: WidgetIntentQueue,
  tasks: WidgetDrainTasks,
): Promise<WidgetDrainResult> {
  // 用**当时的**物化状态判断，而不是组件写快照时的状态 ——
  // 快照可能已经过期（它有 `validUntil`），拿它做决策等于用旧视图下结论。
  const classified = classifyIntents(queue, (taskId) => {
    const task = tasks.findTask(taskId);
    if (task === undefined) return undefined;
    return task.completedAt !== undefined;
  });

  let applied = 0;
  const failed: WidgetIntent[] = [];

  for (const intent of classified.apply) {
    try {
      // 🔴 一次调用 = 一条 op（重复任务那条路径也是单条 UPD，见文件头）。
      await tasks.setCompleted(intent.taskId, intent.targetIsDone);
      applied += 1;
    } catch {
      // 单条失败**不中断整批**。没有 catch 的话，一条坏意图会让它后面
      // 所有用户的点击都永远不生效 —— 而且队列会永远堵着。
      failed.push(intent);
    }
  }

  return {
    applied,
    skippedAlreadyInTarget: classified.alreadyInTarget.length,
    skippedMissing: classified.missing.length,
    failed,
    // 只有失败的留下。成功的和有意跳过的都必须移除，
    // 否则"已在目标状态"的那些会在每次 drain 时被重新评估一遍、永远清不掉。
    remaining: { v: WIDGET_INTENT_VERSION, intents: failed },
  };
}
