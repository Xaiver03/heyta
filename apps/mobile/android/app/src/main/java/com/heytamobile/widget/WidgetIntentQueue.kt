package com.heytamobile.widget

import org.json.JSONArray
import org.json.JSONObject

/** 意图队列的版本。与快照信封**各自独立**演进。TS 侧同名常量见 `intents.ts`。 */
const val WIDGET_INTENT_VERSION = 1

/** 队列长度上限。超过时丢**最旧**的。 */
const val WIDGET_INTENT_MAX = 50

/** 一条点击意图。字段与 TS 的 `WidgetIntent` 一一对应。 */
data class WidgetIntent(
    val taskId: String,
    /**
     * 用户希望这个任务变成的完成状态。
     *
     * 🔴 是**目标状态**而不是"切换"：动作在过期视图上会算错
     *（用户看到未完成、实际已完成，点一下变成"标记完成" = 没有变化），
     * 而目标状态是幂等的。
     */
    val targetIsDone: Boolean,
    /**
     * 点击时刻（epoch ms）。**只用于诊断与日志，不参与排序。**
     *
     * 🔴 排序由**数组位置**决定（末尾 = 最新）。理由：两次快速点击可能落在同一毫秒，
     * 靠它排序就是**不确定**的；而"追加到末尾"在任何时钟精度下都确定。
     */
    val at: Long,
)

/** 意图队列。`v` 不进数据结构（当前版本恒为 [WIDGET_INTENT_VERSION]），只体现在序列化上。 */
data class WidgetIntentQueue(val intents: List<WidgetIntent>)

/**
 * 意图队列的解析与合并 —— **Kotlin 侧的唯一定义处**。
 *
 * ## 🔴 这里只做 parse / merge，**刻意不做 classify**
 *
 * TS 侧还有 `classifyIntents` / `drainableIntents`（按"当前真实状态"给意图分类）。
 * 那两个**不能**搬到这里，理由正是整个小组件设计的出发点：
 * **组件拿到的快照可能已经过期，用它判断"要不要执行"等于拿一个可能错的视图做决策。**
 * 分类必须由应用在拿到**当时真实的**物化状态之后做（TS 侧，W0-5）。
 *
 * 所以本对象只负责：把队列读成结构、把新点击并进去。**语义真源仍是 `intents.ts`。**
 *
 * ## 🔴 与 TS 逐条对应（改这里之前先去看 `packages/widget-core/src/intents.ts`）
 *
 * | 规则 | TS | 这里 |
 * |---|---|---|
 * | 不是对象 / 版本不对 / `intents` 不是数组 | 返回空队列 | [parse] 同 |
 * | 条数 > [WIDGET_INTENT_MAX] | **整体拒绝**（不是截断后接受） | [parse] 同 |
 * | 任一条目坏 | **整体拒绝**（不是跳过坏的） | [parse] 同 |
 * | 合并 | 先删同 `taskId` 的旧条目，再**追加到末尾** | [merge] 同 |
 * | 超限 | **折叠之后**才截断，丢最旧 | [merge] 同 |
 *
 * **"整体拒绝"而不是"截断/跳过"**：队列超限本身就说明写入方有 bug。
 * 截断后接受会让一个**被反复追加坏数据**的队列看起来正常 —— 那样就再也没有线索了。
 *
 * ⚠️ 已知取舍（TS 侧同样如此）：拒绝意味着**静默丢弃**用户的点击。
 * 另一种选择是抛错，而那会让应用起不来 —— 代价大得多。
 * 所以四端**必须尽量不写出坏数据**，这也是四端解析器都要用同一份夹具驱动测试的原因。
 */
object WidgetIntentQueues {

    fun empty(): WidgetIntentQueue = WidgetIntentQueue(emptyList())

    /**
     * 解析原生写下的队列。**永不抛，任何异常都降级为空队列。**
     *
     * `rawJson` 为 `null`（存储里没有）或不是合法 JSON 时同样返回空队列 ——
     * 调用方不需要区分"没有点击"与"队列坏了"。
     */
    fun parse(rawJson: String?): WidgetIntentQueue {
        if (rawJson == null) return empty()

        val root = try {
            JSONObject(rawJson)
        } catch (_: Throwable) {
            return empty()
        }

        // 🔴 顺序与 TS 一致：先看版本，再看形状。
        // 反过来会让"版本不对"和"结构不对"报同一个结果，排查时分不清是哪种。
        if (WidgetJson.asSafeInteger(root.opt("v")) != WIDGET_INTENT_VERSION.toLong()) return empty()

        val rawIntents = root.opt("intents")
        if (rawIntents !is JSONArray) return empty()

        // 超限本身就是坏数据（本对象自己不会写出超限的队列）→ 整体拒绝。
        if (rawIntents.length() > WIDGET_INTENT_MAX) return empty()

        val intents = ArrayList<WidgetIntent>(rawIntents.length())
        for (index in 0 until rawIntents.length()) {
            val entry = rawIntents.opt(index)
            // ⚠️ 必须判 `JSONObject`：JSON 的 `null` 在这里是 `JSONObject.NULL`（非 null 值），
            // 它既是"不是对象"，也不能被当成"缺失"放过。
            if (entry !is JSONObject) return empty()

            val taskId = entry.opt("taskId")
            if (!WidgetJson.isNonEmptyString(taskId)) return empty()

            // ⚠️ `targetIsDone` 必须是**布尔**。写 `"true"`（字符串）要拒绝：
            // 放过它会让"真假"在四端各自解释一次，而解释结果会不一致。
            val targetIsDone = entry.opt("targetIsDone")
            if (targetIsDone !is Boolean) return empty()

            val at = WidgetJson.asSafeInteger(entry.opt("at"))
            if (at == null || at < 0L || at > MAX_EPOCH_MS) return empty()

            // 只保留契约里的三个字段 —— 多余的键被**丢掉**而不是拒绝
            //（TS 也是重建对象，所以行为一致）。
            intents.add(WidgetIntent(taskId = taskId as String, targetIsDone = targetIsDone, at = at))
        }

        return WidgetIntentQueue(intents)
    }

    /**
     * 把一条新点击并进队列：**同一 `taskId` 只留最新的一条**（last-wins）。
     *
     * 实现是"先删同 id 的旧条目，再追加到末尾" —— **位置即新旧，不依赖 `at`**。
     *
     * 🔴 **折叠先于截断**：如果这次的 `taskId` 已经在队列里，它先被删掉再追加，
     * 所以**对同一任务的反复点击永远不会因为"队列满"而被丢掉**。
     * 顺序反过来写（先截断再折叠）就会在你连点同一个任务时把它挤出去 ——
     * 而那正好是用户最在意的那个任务。
     */
    fun merge(queue: WidgetIntentQueue, intent: WidgetIntent): WidgetIntentQueue {
        val kept = queue.intents.filterTo(ArrayList()) { it.taskId != intent.taskId }
        kept.add(intent)

        // 折叠之后再截断：丢最旧的（下标 0）。
        while (kept.size > WIDGET_INTENT_MAX) kept.removeAt(0)

        return WidgetIntentQueue(kept)
    }

    /**
     * 把一批意图并进队列。与 TS 侧的 `mergeIntents` **同源同义**
     *（逐条走 [merge]，所以 last-wins 与"折叠先于截断"两条性质都继承下来）。
     *
     * 🔴 用途只有一个：**drain 之后把执行失败的意图写回容器**。
     *
     * 为什么不能直接 `store.updateIntents { pending }`（整体覆盖）：drain 是
     * "读出来 + 清空"，而写回发生在**之后**。这两步之间用户完全可能又点一下 ——
     * 那个新点击已经进了容器，整体覆盖会把它**悄悄抹掉**。
     * 症状：点了没反应，重进应用也没有，**任何日志里都没有痕迹**。
     *
     * 所以写回必须走 `updateIntents` 的**读-改-写**（它有锁），并且用合并而不是覆盖。
     */
    fun mergeAll(queue: WidgetIntentQueue, incoming: List<WidgetIntent>): WidgetIntentQueue {
        var next = queue
        for (intent in incoming) next = merge(next, intent)
        return next
    }

    /**
     * 把**较早**的一批意图并进**较新**的队列 —— 也就是 drain 之后写回失败意图时
     * 真正要用的那一个。
     *
     * ============================================================
     * 🔴 为什么单独开一个函数，而不是让调用方自己调 [mergeAll]
     * ============================================================
     *
     * 因为 [mergeAll] 的参数顺序是"**第二个更赢**"，而在这个场景里
     * **第二个参数（`older`）其实是更旧的那批**。写反了的后果不是崩溃，
     * 而是一个很安静的错：
     *
     * ```
     * T0  drain：读出队列、清空容器。此时失败的旧意图是 { t1: true }
     * T1  用户又在组件上把 t1 取消勾选 → 容器里现在是 { t1: false }
     * T2  写回失败意图
     *        mergeAll(current = {t1:false}, incoming = [t1:true])  ← 写反了
     *        → 覆盖成 { t1: true }
     * T3  下一次 drain 把 t1 设成已完成
     * ```
     *
     * 用户的"取消勾选"被**回滚**了，而他看到的是"我明明取消了，它自己又勾上了"。
     * 这个 bug **是本轮的 Kotlin 测试抓出来的**，不是我读代码看出来的 ——
     * 所以修法不是"加条注释提醒注意顺序"，而是**让顺序不可能写反**：
     * 名字里直接写出谁新谁旧。
     *
     * 语义：先放 `older`，再把 `newer` 逐条并上去（逐条走 [merge]，
     * 所以同一 `taskId` 上 `newer` 赢、且"折叠先于截断"仍然成立）。
     */
    fun mergeOlderIntoNewer(
        current: WidgetIntentQueue,
        older: List<WidgetIntent>,
    ): WidgetIntentQueue = mergeAll(WidgetIntentQueue(older), current.intents)

    /** 序列化成组件写进共享容器的 JSON。 */
    fun toJson(queue: WidgetIntentQueue): String {
        val array = JSONArray()
        for (intent in queue.intents) {
            array.put(
                JSONObject().apply {
                    put("taskId", intent.taskId)
                    put("targetIsDone", intent.targetIsDone)
                    put("at", intent.at)
                }
            )
        }
        return JSONObject().apply {
            put("v", WIDGET_INTENT_VERSION)
            put("intents", array)
        }.toString()
    }
}
