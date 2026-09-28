/**
 * drain 闭环（Web / Windows 版）：组件里点的那一下，怎么变成一条 op。
 * =========================================================================
 *
 * 与 [`apps/mobile/src/widgets/drain.ts`] 是同一个概念、同一套语义，
 * 宿主换成 service worker 的点击日志。全链路：
 *
 * ```
 * 组件（Adaptive Card）  用户点一行
 *        ↓ Action.Execute → widgetclick
 * service worker 点击日志      { taskId, targetIsDone, at } × N（**追加式，未合并**）
 *        ↓ postMessage 'heyta:widget-drain'（MessageChannel 回传）
 * mergeIntents()      ← widget-core，四端同一份 last-wins 语义
 *        ↓
 * classifyIntents()   ← 与当时物化状态比对：该做的 / 已在目标态 / 任务不存在
 *        ↓
 * TaskActions.setCompleted()  ← app-host，一次调用 = 一条 op（§3.5）
 *        ↓ requeueWidgetIntents()   ← 只把**失败**的写回 SW
 * 下一次 drain 重试
 * ```
 *
 * ## 为什么 SW 只记"原始点击"、合并放在这里
 *
 * service worker 里**再写一份**合并逻辑就会有两份实现，而漂移的表现是
 * "某个平台的取消偶尔不回滚" —— 极难发现。所以 SW 是纯追加日志（见 `sw-core.ts`），
 * 合并**只在这里**发生一次，用的是四端共用的 `mergeIntents`。
 *
 * ## 三条要么静默丢数据、要么永远重来的地方（与移动端逐条对应）
 *
 * 1. 🔴 **写回是"插入队首"，不是"追加队尾"。** 这几条是失败重试的**旧**意图；
 *    追加到队尾会让它们的"最后写入"时间凭空变新，从而**覆盖掉**用户之后新点的那些
 *    （合并是 last-wins，顺序即优先级）。见 `sw.ts` 的 requeue 分支。
 * 2. 🔴 **成功的和有意跳过的都必须从队列移除。** `drainWidgetIntents` 已经保证了
 *    这一点（`remaining` 里只有 `failed`）。把它们留在队列里会让"已在目标态"
 *    的那些每次 drain 都被重新评估一遍、**永远清不掉**，而日志有上限 ——
 *    满了之后新的点击会被挤掉。
 * 3. 🔴 **drain 绝不抛异常给调用方。** 它挂在应用启动 / 回到前台的路径上，
 *    抛出去会让应用起不来，只因为一个组件里点了一下。失败的意图**仍留在日志里**
 *    （写回失败则列入 `lost`，见下），不会因为这个取舍而丢。
 *
 * ## ⚠️ 写回失败时我们**什么也做不了**
 *
 * 那几条意图已经随 drain 从日志里清掉了。所以第 3 条只保证"不影响应用启动"，
 * **不保证"意图一定不丢"**。真正的保障是"drain 只在可能成功的时候被调用"，
 * 而不是假装失败不存在 —— 所以 `lost` 是摘要里的一个显式字段，
 * 而不是一个被吞掉的异常。
 */

import { drainWidgetIntents } from '@heyta/app-host';
import type { WidgetDrainTasks } from '@heyta/app-host';
import { emptyIntentQueue, mergeIntents } from '@heyta/widget-core';
import type { WidgetIntentQueue } from '@heyta/widget-core';

import { drainWidgetClicks, requeueWidgetIntents } from './register.js';
import type { RawWidgetClick } from './sw-core.js';

export interface WebWidgetDrainSummary {
  /** 成功执行、产生了 op 的意图数。**应等于新增的 op 数。** */
  applied: number;
  skippedAlreadyInTarget: number;
  skippedMissing: number;
  /** 执行失败、已写回 SW 日志的条数。 */
  requeued: number;
  /** 执行失败、但**没能**写回日志的条数（见文件头最后一段）。 */
  lost: number;
}

/** drain 需要的外部动作。可注入是为了让这段逻辑能在单测里跑（不碰 service worker）。 */
export interface WidgetDrainPorts {
  drain(): Promise<RawWidgetClick[]>;
  requeue(intents: readonly RawWidgetClick[]): Promise<void>;
}

const defaultPorts: WidgetDrainPorts = {
  drain: drainWidgetClicks,
  requeue: requeueWidgetIntents,
};

/** 原始点击 → 契约队列。**顺序即优先级**（数组位置决定，不靠 `at`）。 */
export function clicksToQueue(clicks: readonly RawWidgetClick[]): WidgetIntentQueue {
  return mergeIntents(emptyIntentQueue(), clicks);
}

/**
 * 跑一轮 drain。**返回 `null` = 没有待处理的点击**（或 SW 不可用）；
 * 有意图时返回 [WebWidgetDrainSummary]。
 */
export async function runWidgetDrain(
  tasks: WidgetDrainTasks,
  ports: WidgetDrainPorts = defaultPorts,
): Promise<WebWidgetDrainSummary | null> {
  let clicks: RawWidgetClick[];
  try {
    clicks = await ports.drain();
  } catch (error) {
    // `register.ts` 内部已经吞掉了所有失败并返回 `[]`，走到这里说明
    // 注入的实现抛了。**照样不能上抛** —— 这一条挂在启动路径上。
    console.warn('[heyta] 读取组件点击日志失败', error);
    return null;
  }

  const queue = clicksToQueue(clicks);
  if (queue.intents.length === 0) return null;

  const result = await drainWidgetIntents(queue, tasks);

  const pending = result.remaining.intents;
  if (pending.length === 0) {
    return {
      applied: result.applied,
      skippedAlreadyInTarget: result.skippedAlreadyInTarget,
      skippedMissing: result.skippedMissing,
      requeued: 0,
      lost: 0,
    };
  }

  try {
    await ports.requeue(pending);
    return {
      applied: result.applied,
      skippedAlreadyInTarget: result.skippedAlreadyInTarget,
      skippedMissing: result.skippedMissing,
      requeued: pending.length,
      lost: 0,
    };
  } catch (error) {
    console.warn('[heyta] 写回失败的组件意图失败', error);
    return {
      applied: result.applied,
      skippedAlreadyInTarget: result.skippedAlreadyInTarget,
      skippedMissing: result.skippedMissing,
      requeued: 0,
      lost: pending.length,
    };
  }
}

/**
 * 启动路径上的安全版：**永不抛、永不返回 null 以外的麻烦**。
 *
 * 有意图被处理时打一条 info 日志 —— 这是排查"组件里点的到底生效了没"
 * 唯一的线索，而它在生产上默认不该吵到用户（`info` 不是 `warn`）。
 */
export async function runWidgetDrainQuietly(tasks: WidgetDrainTasks): Promise<void> {
  try {
    const summary = await runWidgetDrain(tasks);
    if (summary === null) return;
    if (summary.applied > 0 || summary.lost > 0) {
      console.info(
        `[heyta] 组件点击：应用 ${summary.applied} 条，跳过 ${summary.skippedAlreadyInTarget + summary.skippedMissing} 条，` +
          `重试 ${summary.requeued} 条，丢失 ${summary.lost} 条`,
      );
    }
  } catch (error) {
    // 兜底：`runWidgetDrain` 自己不该抛，但这条路径上**绝不允许**有任何东西上抛
    console.warn('[heyta] 组件 drain 出现意外错误（已忽略）', error);
  }
}
