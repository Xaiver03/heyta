import { createTaskActions, drainWidgetIntents, type AppHost } from '@heyta/app-host';
import { parseIntentQueueJson, type WidgetIntentQueue } from '@heyta/widget-core';

import { drainIntentQueue, mergeIntentQueue } from './widget-bridge';

/**
 * drain 闭环：组件里点的那一下，怎么变成一条 op
 * =================================================
 *
 * 这是 W1-4 那条闭环的下半截。上半截是 [publish.ts] 的发布管线。
 *
 * ## 全链路
 *
 * ```
 * 组件（RemoteViews）  用户点一行
 *        ↓ 写共享容器（PendingIntent → BroadcastReceiver）
 * 意图队列            { taskId, targetIsDone, at }，last-wins
 *        ↓ drainIntentQueue()      ← 读出来 + 清空，**原子**
 * parseIntentQueueJson()  ← widget-core，四端同一份语义（收**字符串**，永不抛）
 *        ↓
 * classifyIntents()   ← 与当时物化状态比对：该做的 / 已在目标态 / 任务不存在
 *        ↓
 * TaskActions.setCompleted()  ← app-host，一次调用 = 一条 op
 *        ↓ mergeIntentQueue()      ← 只把**失败**的合并回去
 * 下一次 drain 重试
 * ```
 *
 * ## 三条要么静默丢数据、要么永远重来的地方
 *
 * 1. 🔴 **写回用合并，不是覆盖。** drain 是"读出来 + 清空"，写回在之后；
 *    这两步之间用户完全可能又点一下。整体覆盖会把那个新点击**悄悄抹掉**。
 *    所以走原生的 `updateIntents`（有锁）并合并 —— 见 `mergeIntentQueue`。
 *
 * 2. 🔴 **成功的和有意跳过的都必须从队列移除。** `drainWidgetIntents` 已经保证了
 *    这一点（`remaining` 里只有 `failed`）。把它们留在队列里会让"已在目标状态"
 *    的那些**每次 drain 都被重新评估一遍、永远清不掉**,而队列有 50 条上限 ——
 *    满了之后新的点击会被挤掉。
 *
 * 3. 🔴 **drain 绝不抛异常给调用方。** 它挂在应用启动 / 回到前台的路径上，
 *    抛出去会让**应用起不来**，只因为一个小组件里点了一下。而那时用户的意图
 *    还在容器里（写回失败就留着，见下），不会丢。
 *
 * ## 为什么失败要写回、而不是就地丢掉
 *
 * "下次重试"这件事只有把意图留在容器里才成立。`drainWidgetIntents` 之所以
 * 把 `failed` 放进 `remaining` 而不是丢掉，就是因为失败可能是**暂时性**的
 *（库锁着、设备刚解锁）。丢了就真的没有下次了。
 *
 * ⚠️ 写回**失败**时（原生模块不可用 / 写盘失败）我们**什么也做不了**：
 * 那几条意图已经随 drain 从容器里清掉了。这不是可以掩盖的事 —— 所以
 * 上面第 3 条只保证"不影响应用启动"，**不保证"意图一定不丢"**。
 * 真正的保障是"drain 只在可能成功的时候被调用"，而不是假装失败不存在。
 */

export interface WidgetDrainSummary {
  /** 成功执行、产生了 op 的意图数。**应等于新增的 op 数。** */
  applied: number;
  skippedAlreadyInTarget: number;
  skippedMissing: number;
  /** 执行失败、已写回容器的条数。 */
  requeued: number;
  /** 执行失败、但**没能**写回容器的条数（见文件头最后一段）。 */
  lost: number;
}

/**
 * drain 需要的外部动作。做成可注入是为了让这段逻辑能在单测里跑 ——
 * 移动端测试**刻意不 import `react-native`**（在 node 里加载它直接失败）。
 */
export interface WidgetDrainPorts {
  drain(): Promise<string | null>;
  merge(pendingJson: string): Promise<number | null>;
}

const defaultPorts: WidgetDrainPorts = {
  drain: drainIntentQueue,
  merge: mergeIntentQueue,
};

/**
 * 跑一轮 drain。**返回 `null` = 没有待处理的点击**（或模块不可用）；
 * 有意图时返回 [WidgetDrainSummary]。
 *
 * `apply` 是"把队列落到物化状态上"，由调用方注入（生产上是
 * `drainWidgetIntents(queue, createTaskActions(host))`）——
 * 这样这个文件不需要认识 `AppHost`，也就不必 import 会拉进 `op-sqlite` 的东西。
 */
export async function runWidgetDrain(
  ports: WidgetDrainPorts,
  apply: (queue: WidgetIntentQueue) => Promise<{
    applied: number;
    skippedAlreadyInTarget: number;
    skippedMissing: number;
    remaining: WidgetIntentQueue;
  }>,
): Promise<WidgetDrainSummary | null> {
  const raw = await ports.drain();

  // `null` = 容器里没有队列，或原生模块不可用。两种都不需要做什么。
  if (raw === null) return null;

  const queue = parseIntentQueueJson(raw);
  if (queue.intents.length === 0) return null;

  const result = await apply(queue);

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

  // 🔴 合并写回（不是覆盖）。见文件头第 1 条。
  const merged = await ports.merge(JSON.stringify(result.remaining));

  return {
    applied: result.applied,
    skippedAlreadyInTarget: result.skippedAlreadyInTarget,
    skippedMissing: result.skippedMissing,
    // 原生返回的是**合并后**队列的总长度，不是"我们写进去了几条" ——
    // 所以这里只把 `null`（写回失败）与"成功"分开，
    // 不拿它的数字去反推 requeued（那会在合并进来别的意图时算错）。
    requeued: merged === null ? 0 : pending.length,
    lost: merged === null ? pending.length : 0,
  };
}

/**
 * 生产入口：从共享容器取出点击、落到物化状态、把失败的写回。
 *
 * **永不抛异常**（文件头第 3 条）—— 它挂在应用启动 / 回到前台的路径上。
 */
export async function drainWidgetIntentsNow(host: AppHost): Promise<WidgetDrainSummary | null> {
  try {
    const tasks = createTaskActions(host);
    const summary = await runWidgetDrain(defaultPorts, (queue) =>
      drainWidgetIntents(queue, tasks),
    );

    if (summary !== null && summary.lost > 0) {
      console.warn(`[widget] ${summary.lost} 条点击没能写回队列，下次不会再重试`);
    }
    return summary;
  } catch (error) {
    console.warn('[widget] drain 失败（不影响应用启动）：', error);
    return null;
  }
}
