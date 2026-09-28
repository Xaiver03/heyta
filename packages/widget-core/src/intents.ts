/**
 * 意图队列
 * =========
 *
 * 小组件的点击**不能直接改数据**，只能往共享容器里写一条"意图"。
 * 应用下次跑起来时把它取出来，变成真正的 op。这个文件定义那条队列的语义。
 *
 * ## 🔴 与 `@heyta/local-api` 同一条红线：**本包在类型上产生不了 op**
 *
 * 这里只产出"合并后的意图列表"。**意图 → op 是 `@heyta/app-host` 的事**（W0-5）。
 * 一旦这个文件 import 任何 op 构造器，那条边界就破了 ——
 * 而破了以后的症状是"同一份 op 被两条路径构造出两个版本"，很难查。
 *
 * ## 为什么是"队列"而不是"直接写状态"
 *
 * 组件进程与应用进程是**分开的**，而且组件可能在没有应用的情况下被点击
 * （应用被杀、设备重启、应用锁着）。所以点击时**没有**可信的当前状态可读 ——
 * 共享容器里的快照可能已经过期（它有 `validUntil`）。
 *
 * 于是设计成：组件只记录"用户想要什么"（`targetIsDone`），
 * 应用稍后用**当时真实的**状态去判断要不要执行。这样过期快照就不会导致错误决策。
 *
 * ## 三条语义
 *
 * 1. **last-wins（按 `taskId` 折叠）**：同一个任务点了两次 → 队列里只留**后**那条。
 * 2. **去重**：同一次点击被重复写入（原生重试、进程重启）→ 只留一条。
 * 3. **跳过"已在目标状态"**：drain 时任务已经是目标状态 → **丢弃**，
 *    不产生 op。见 `drainableIntents()`。
 */

import { MAX_EPOCH_MS } from './contract.js';

/** 意图队列的版本。与快照信封**各自独立**演进。 */
export const WIDGET_INTENT_VERSION = 1;

/**
 * 队列长度上限。
 *
 * 超过时丢**最旧**的。为什么不是丢最新：用户最后一次点击才代表他现在的想法，
 * 而队列堆积到上限说明应用很久没跑了 —— 那种情况下"最近的意图"最可能还有意义。
 */
export const WIDGET_INTENT_MAX = 50;

export interface WidgetIntent {
  taskId: string;
  /**
   * 用户希望这个任务变成的完成状态。
   *
   * 🔴 是**目标状态**而不是"切换"或"标记完成"这类动作 ——
   * 动作在过期视图上会算错（用户看到未完成、实际已完成，点一下变成"标记完成"= 没有变化），
   * 而目标状态是幂等的：无论当前是什么，结果都是它。
   */
  targetIsDone: boolean;
  /**
   * 点击时刻（epoch ms）。**只用于诊断与日志，不参与排序。**
   *
   * 🔴 排序由**数组位置**决定（末尾 = 最新），不靠这个字段。
   * 理由：两次快速点击可能落在同一毫秒，靠 `at` 排序就是**不确定**的；
   * 而"追加到末尾"在任何时钟精度下都确定。设备时钟还可能被用户改。
   */
  at: number;
}

export interface WidgetIntentQueue {
  v: number;
  intents: WidgetIntent[];
}

export function emptyIntentQueue(): WidgetIntentQueue {
  return { v: WIDGET_INTENT_VERSION, intents: [] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * 解析原生写下的意图队列。**永不抛异常，任何异常都降级为空队列。**
 *
 * 与 `readSnapshotSafely` 同一条纪律：这头是四端手写原生代码写出来的 JSON，
 * 另一头是用户的点击。坏数据只该导致"这次点击丢了"，
 * 不该让应用在启动路径上崩掉。
 *
 * ⚠️ 注意"降级为空队列"意味着**静默丢弃**用户的点击。这是有意的取舍：
 * 另一种选择是抛错，而那会让应用起不来 —— 代价大得多。
 * 但**四端必须尽量不写出坏数据**，所以 `parseIntentQueue` 的拒绝原因是可读的，
 * 供 `check:widgets` 与原生侧的测试断言使用。
 */
export function parseIntentQueue(raw: unknown): WidgetIntentQueue {
  if (!isPlainObject(raw)) return emptyIntentQueue();
  if (raw.v !== WIDGET_INTENT_VERSION) return emptyIntentQueue();
  if (!Array.isArray(raw.intents)) return emptyIntentQueue();
  if (raw.intents.length > WIDGET_INTENT_MAX) {
    // 超限本身就是坏数据（本模块自己不会写出超限的队列）→ 整体拒绝。
    // 不做"截断后接受"：那会让一个被反复追加坏数据的队列看起来正常。
    return emptyIntentQueue();
  }

  const intents: WidgetIntent[] = [];
  for (const entry of raw.intents) {
    if (!isPlainObject(entry)) return emptyIntentQueue();
    if (!isNonEmptyString(entry.taskId)) return emptyIntentQueue();
    if (typeof entry.targetIsDone !== 'boolean') return emptyIntentQueue();
    if (
      typeof entry.at !== 'number' ||
      !Number.isSafeInteger(entry.at) ||
      entry.at < 0 ||
      entry.at > MAX_EPOCH_MS
    ) {
      return emptyIntentQueue();
    }
    intents.push({ taskId: entry.taskId, targetIsDone: entry.targetIsDone, at: entry.at });
  }

  return { v: WIDGET_INTENT_VERSION, intents };
}

/**
 * 从**共享容器里那个字符串**解析队列。**永不抛。**
 *
 * 🔴 为什么需要它，而不是让调用方自己 `JSON.parse` 一下：
 *
 * 四端从容器里拿到的都是**字符串**（Android 是 `SharedPreferences.getString`、
 * iOS 是 `UserDefaults.string`……），而 [parseIntentQueue] 收的是**对象**。
 * 于是"字符串 → 对象"这一步在每端各写一遍 —— 而这一步**必须 fail closed**：
 * 坏 JSON、`"null"`、空串、`undefined` 都要变成空队列而不是抛。
 *
 * 这个不对称已经真实存在过：Kotlin 的 `WidgetIntentQueues.parse` 收字符串，
 * TS 的 `parseIntentQueue` 收对象，名字还几乎一样。**同名不同形**是漂移的温床，
 * 而这个函数把两边对齐到同一个形状上。
 *
 * ⚠️ 返回空队列**不代表"没有点击"**，也可能代表"队列坏了"。与
 * [parseIntentQueue] 同一个取舍（见上面那段注释）：宁可静默丢弃，
 * 也不要在 `BroadcastReceiver` 里抛出去让系统杀掉进程。
 */
export function parseIntentQueueJson(raw: string | null | undefined): WidgetIntentQueue {
  if (raw === null || raw === undefined) return emptyIntentQueue();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 不是合法 JSON。`JSON.parse('null')` 会**成功**返回 `null`，
    // 那一支由下面的 `isPlainObject` 挡掉。
    return emptyIntentQueue();
  }

  return parseIntentQueue(parsed);
}

/**
 * 把一条新意图并进队列：**同一 `taskId` 只留最新的一条**（last-wins）。
 *
 * 实现是"先删同 id 的旧条目，再追加到末尾" —— **位置即新旧，不依赖 `at`**。
 * 这一点让"同一毫秒连点两次"也有确定结果（后写的赢）。
 *
 * 队列满时丢**最旧**的（见 `WIDGET_INTENT_MAX`）。
 * 🔴 但如果这次的 `taskId` 已经在队列里，折叠**先发生** ——
 * 所以对同一任务的反复点击永远不会因为"队列满"而被丢掉。
 */
export function mergeIntent(
  queue: WidgetIntentQueue,
  intent: WidgetIntent,
): WidgetIntentQueue {
  const kept = queue.intents.filter((existing) => existing.taskId !== intent.taskId);
  kept.push({ ...intent });

  // 折叠之后再截断：先丢最旧的
  while (kept.length > WIDGET_INTENT_MAX) kept.shift();

  return { v: WIDGET_INTENT_VERSION, intents: kept };
}

/** 依次并入多条意图（顺序敏感：后面的覆盖前面的）。 */
export function mergeIntents(
  queue: WidgetIntentQueue,
  incoming: readonly WidgetIntent[],
): WidgetIntentQueue {
  let next = queue;
  for (const intent of incoming) next = mergeIntent(next, intent);
  return next;
}

/** 一个任务当前的真实完成状态。`undefined` = 这个任务不存在（或已删除）。 */
export type CurrentDoneLookup = (taskId: string) => boolean | undefined;

/**
 * 分类结果。把"丢弃"分成两种**原因不同**的情况：
 *
 *   - `alreadyInTarget`：任务在，但已经是目标态 → 执行会产生无意义的 op（见下）
 *   - `missing`：任务不存在（已删/已清）→ 无从执行
 *
 * 为什么要把这两个分开而不是合成一个 `skipped` 计数：
 * 它们的**含义完全不同**。`alreadyInTarget` 是正常且高频的（用户在另一台设备上
 * 已经完成了，或者同一批里被折叠过），而 `missing` 高得不正常就说明
 * 快照与物化状态脱节了 —— 那是要查的 bug。
 * 合成一个计数，这两种情况就再也分不出来了。
 */
export interface IntentClassification {
  /** 需要执行的（目标态与当前态不同，且任务存在）。 */
  apply: WidgetIntent[];
  alreadyInTarget: WidgetIntent[];
  missing: WidgetIntent[];
}

/**
 * 按"当前真实状态"给队列里的每条意图分类。
 *
 * 🔴 必须在 drain 时（应用跑起来、拿到真实的物化状态之后）调用，
 * **不能**在组件里调用：组件的快照可能已经过期，
 * 用它判断"要不要执行"等于拿一个可能错的视图做决策。
 */
export function classifyIntents(
  queue: WidgetIntentQueue,
  lookup: CurrentDoneLookup,
): IntentClassification {
  const result: IntentClassification = { apply: [], alreadyInTarget: [], missing: [] };

  for (const intent of queue.intents) {
    const current = lookup(intent.taskId);
    if (current === undefined) {
      result.missing.push(intent);
      continue;
    }
    if (current === intent.targetIsDone) {
      result.alreadyInTarget.push(intent);
      continue;
    }
    result.apply.push(intent);
  }

  return result;
}

/**
 * 挑出**真正需要执行**的意图 —— `classifyIntents(...).apply` 的简写。
 *
 * ## 为什么"已在目标状态"必须丢弃，而不是"再设一遍"
 *
 * 用户点"完成"，而任务**已经**完成了（比如他在另一台设备上完成的），
 * 这时执行会写出一个 `completedAt = 现在` 的 op —— 那会**篡改完成时间**，
 * 让"今天完成了 3 件"之类基于 `completedAt` 的口径全部偏移。
 * 数据没坏，但所有数字都错了。
 *
 * ## ⚠️ 一个已知的保守之处：重复任务探测不到"已达成"
 *
 * 重复任务被完成时，写的是**推进后的到期日**，`completedAt` 仍然不存在
 * （见 `app-host` 的 `completeTask`）。所以：
 *
 *   - `lookup` 对一条"刚被完成的重复任务"仍返回 `false`；
 *   - 于是它的意图会被归入 `apply` 而不是 `alreadyInTarget`。
 *
 * 这是**正确**的行为：对该任务而言"完成"就是"推进下一次"，
 * 再执行一次就是再推进一次 —— 与用户在应用里连点两次的效果一致。
 * 但要知道：**跨两次 drain 的重复点击不会被去重**（只有落在同一队列里的才会被折叠）。
 */
export function drainableIntents(
  queue: WidgetIntentQueue,
  lookup: CurrentDoneLookup,
): WidgetIntent[] {
  return classifyIntents(queue, lookup).apply;
}
