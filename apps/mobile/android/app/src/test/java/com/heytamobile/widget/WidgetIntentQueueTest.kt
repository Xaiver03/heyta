package com.heytamobile.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [WidgetIntentQueues] 的单测 —— 逐条对应 `packages/widget-core/tests/intents.spec.ts`。
 *
 * 🔴 为什么这些必须和 TS 那份**成对**存在：四端各自手写一份队列逻辑，
 * 而"某一端在某个边界上不一致"不会报任何错 —— 它表现为"在 Android 上点了没反应，
 * 在 iOS 上正常"这类极难归因的现象。同一份用例是四端不漂移的锁。
 *
 * 这里只测 TS 有的 parse / merge。`classifyIntents` **刻意不在原生侧**（见
 * [WidgetIntentQueues] 的类注释）。
 */
class WidgetIntentQueueTest {

    private fun intent(taskId: String, done: Boolean, at: Long = 1_790_000_000_000L) =
        WidgetIntent(taskId = taskId, targetIsDone = done, at = at)

    /** 造一个"能过 parse"的队列 JSON，用来测边界。 */
    private fun queueJson(count: Int): String =
        WidgetIntentQueues.toJson(WidgetIntentQueue((0 until count).map { intent("t$it", false) }))

    // ─────────────────────────────────────────────────────────────
    // merge：last-wins
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `同一任务点两次只留最新那条`() {
        val queue = WidgetIntentQueues.empty()
            .let { WidgetIntentQueues.merge(it, intent("t1", true)) }
            .let { WidgetIntentQueues.merge(it, intent("t1", false)) }

        assertEquals(1, queue.intents.size)
        assertEquals(false, queue.intents[0].targetIsDone)
    }

    /**
     * 🔴 排序由**数组位置**决定，不靠 `at`。
     *
     * 两次快速点击可能落在**同一毫秒**。若按 `at` 排序，结果就是**不确定**的
     *（取决于排序算法是否稳定），而"追加到末尾"在任何时钟精度下都确定。
     */
    @Test
    fun `同一毫秒连点两次也有确定结果（不靠 at 排序）`() {
        val sameMs = 1_790_000_000_000L
        val queue = WidgetIntentQueues.empty()
            .let { WidgetIntentQueues.merge(it, intent("t1", true, sameMs)) }
            .let { WidgetIntentQueues.merge(it, intent("t1", false, sameMs)) }

        assertEquals(1, queue.intents.size)
        assertEquals("后写的那条必须赢", false, queue.intents[0].targetIsDone)
    }

    @Test
    fun `不同任务各自保留且按点击顺序排列`() {
        val queue = WidgetIntentQueues.empty()
            .let { WidgetIntentQueues.merge(it, intent("a", true)) }
            .let { WidgetIntentQueues.merge(it, intent("b", true)) }
            .let { WidgetIntentQueues.merge(it, intent("c", true)) }

        assertEquals(listOf("a", "b", "c"), queue.intents.map { it.taskId })
    }

    @Test
    fun `合并不修改入参队列`() {
        val original = WidgetIntentQueue(listOf(intent("a", true)))
        val merged = WidgetIntentQueues.merge(original, intent("b", true))

        assertEquals("原队列必须保持 1 条", 1, original.intents.size)
        assertEquals(2, merged.intents.size)
        assertNotSame(original, merged)
    }

    // ─────────────────────────────────────────────────────────────
    // merge：上限
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `超过上限时丢最旧的那条`() {
        var queue = WidgetIntentQueue((0 until WIDGET_INTENT_MAX).map { intent("t$it", true) })
        queue = WidgetIntentQueues.merge(queue, intent("newest", true))

        assertEquals(WIDGET_INTENT_MAX, queue.intents.size)
        assertTrue("最旧的 t0 必须被丢掉", queue.intents.none { it.taskId == "t0" })
        assertEquals("最新的必须在末尾", "newest", queue.intents.last().taskId)
    }

    /**
     * 🔴 **折叠先于截断。**
     *
     * 队列满时对**已在队列里**的任务再点一次：它必须先被删掉再追加，
     * 所以永远不会因为"队列满"而被丢掉。
     *
     * 若顺序写反（先截断再折叠），用户反复点击的那个任务会正好被挤出去 ——
     * 而那恰恰是他最在意的那个。
     */
    @Test
    fun `队列满时对已有任务的反复点击不会被丢掉`() {
        val full = WidgetIntentQueue((0 until WIDGET_INTENT_MAX).map { intent("t$it", true) })

        // t0 是最旧的那条。再点它一次。
        val queue = WidgetIntentQueues.merge(full, intent("t0", false))

        assertEquals(WIDGET_INTENT_MAX, queue.intents.size)
        assertEquals("重点的任务必须跑到末尾", "t0", queue.intents.last().taskId)
        assertEquals("而且带的是新的那一次", false, queue.intents.last().targetIsDone)

        // ⚠️ 这里**没有任何东西被挤掉** —— 折叠 t0 时已经腾出了一个位置，
        // 所以队列仍然恰好是满的。第一版测试在这里断言"t1 应该被挤出去"，
        // 跑出来是红的：**错的是断言，不是代码**（50 条进、50 条出）。
        assertEquals(WIDGET_INTENT_MAX - 1, queue.intents.count { it.taskId != "t0" })
        assertTrue("t1 必须还在", queue.intents.any { it.taskId == "t1" })
    }

    // ─────────────────────────────────────────────────────────────
    // parse：正常路径
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `能解析自己写出的队列`() {
        val original = WidgetIntentQueue(listOf(intent("a", true), intent("b", false)))
        val parsed = WidgetIntentQueues.parse(WidgetIntentQueues.toJson(original))

        assertEquals(original, parsed)
    }

    @Test
    fun `空队列合法`() {
        assertEquals(emptyList<WidgetIntent>(), WidgetIntentQueues.parse(queueJson(0)).intents)
    }

    @Test
    fun `多余的键被丢掉而不是拒绝`() {
        // TS 的 parseIntentQueue 是**重建**对象，所以额外字段自然消失。
        // 这里必须同行为 —— 否则一端"接受但保留"、另一端"接受但丢弃"，
        // 序列化出来的东西就不一样了。
        val raw = """{"v":1,"intents":[{"taskId":"a","targetIsDone":true,"at":5,"note":"多余"}],"extra":1}"""
        val parsed = WidgetIntentQueues.parse(raw)

        // 用 data class 的相等性断言：能相等就说明**只**有契约里的三个字段。
        assertEquals(WidgetIntentQueue(listOf(intent("a", true, 5))), parsed)
    }

    // ─────────────────────────────────────────────────────────────
    // parse：整体拒绝（不是截断、不是跳过）
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `超限的队列整体拒绝`() {
        // 不是"截断到 50 条后接受"：那会让一个被反复追加坏数据的队列看起来正常。
        assertEquals(0, WidgetIntentQueues.parse(queueJson(WIDGET_INTENT_MAX + 1)).intents.size)
    }

    @Test
    fun `恰好等于上限时接受`() {
        // 边界：防的是把判据写成 `>=`。写成 `>=` 时这条会红。
        assertEquals(WIDGET_INTENT_MAX, WidgetIntentQueues.parse(queueJson(WIDGET_INTENT_MAX)).intents.size)
    }

    @Test
    fun `一条坏条目就让整个队列被拒`() {
        val good = """{"taskId":"a","targetIsDone":true,"at":5}"""
        val bad = """{"taskId":"","targetIsDone":true,"at":5}"""
        val raw = """{"v":1,"intents":[$good,$bad]}"""

        assertEquals(0, WidgetIntentQueues.parse(raw).intents.size)
    }

    // ─────────────────────────────────────────────────────────────
    // parse：判别点
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `版本不对就拒绝`() {
        assertEquals(0, WidgetIntentQueues.parse("""{"v":2,"intents":[]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":"1","intents":[]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1.5,"intents":[]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"intents":[]}""").intents.size)
    }

    @Test
    fun `intents 不是数组就拒绝`() {
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":{}}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":null}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1}""").intents.size)
    }

    @Test
    fun `条目不是对象就拒绝（JSON 的 null 也算）`() {
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":[null]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":["x"]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":[5]}""").intents.size)
    }

    @Test
    fun `taskId 必须是非空字符串`() {
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":"","targetIsDone":true,"at":5}]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":null,"targetIsDone":true,"at":5}]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":7,"targetIsDone":true,"at":5}]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":[{"targetIsDone":true,"at":5}]}""").intents.size)
    }

    @Test
    fun `targetIsDone 必须是布尔，字符串 true 也要拒`() {
        // 放过 `"true"` 会让"真假"在四端各自解释一次，而解释结果会不一致。
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":"a","targetIsDone":"true","at":5}]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":"a","targetIsDone":1,"at":5}]}""").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":"a","at":5}]}""").intents.size)
    }

    @Test
    fun `at 必须是安全整数且在合法区间内`() {
        for (bad in listOf("-1", "1.5", "\"5\"", "null", "true")) {
            val raw = """{"v":1,"intents":[{"taskId":"a","targetIsDone":true,"at":$bad}]}"""
            assertEquals("at=$bad 必须被拒", 0, WidgetIntentQueues.parse(raw).intents.size)
        }
        assertEquals(
            "超出 MAX_EPOCH_MS 必须被拒",
            0,
            WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":"a","targetIsDone":true,"at":${MAX_EPOCH_MS + 1}}]}""").intents.size,
        )
    }

    @Test
    fun `at 的两个边界值都合法`() {
        // 0 与 MAX_EPOCH_MS 都是合法值 —— 防的是把判据写成 `<= 0` 或 `< MAX_EPOCH_MS`。
        assertEquals(1, WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":"a","targetIsDone":true,"at":0}]}""").intents.size)
        assertEquals(1, WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":"a","targetIsDone":true,"at":$MAX_EPOCH_MS}]}""").intents.size)
    }

    @Test
    fun `at 写成 1_0 要接受（JSON 的 1_0 与 JS 里的 1 是同一个数）`() {
        // `org.json` 把 `1.0` 解析成 Double，而 JS 的 `Number.isSafeInteger(1.0)` 是 true。
        // 判"是不是整数"要用 `value == floor(value)`，不能判 Java 类型。
        assertEquals(1, WidgetIntentQueues.parse("""{"v":1,"intents":[{"taskId":"a","targetIsDone":true,"at":1.0}]}""").intents.size)
    }

    // ─────────────────────────────────────────────────────────────
    // parse：坏输入永不让应用崩
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `null 与非法 JSON 都降级为空队列而不是抛异常`() {
        // 这条守护的是"应用启动路径不被小组件拖垮"：
        // 组件写坏数据只该导致"这次点击丢了"，不该让应用起不来。
        assertEquals(0, WidgetIntentQueues.parse(null).intents.size)
        assertEquals(0, WidgetIntentQueues.parse("").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("not json").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("[1,2,3]").intents.size)
        assertEquals(0, WidgetIntentQueues.parse("\"字符串\"").intents.size)
    }

    // ─────────────────────────────────────────────────────────────
    // mergeAll：drain 之后把失败的意图写回（W1-4）
    // ─────────────────────────────────────────────────────────────

    /**
     * 🔴 这一组守的是 drain 闭环里最容易**静默丢数据**的一步。
     *
     * `drainIntentQueue` 是"读出来 + 清空"，写回发生在**之后**。这两步之间
     * 用户完全可能又点一下 —— 那个新点击已经进了容器。所以写回必须是
     * **合并**（`updateIntents` 的读-改-写，有锁），不能是整体覆盖：
     * 覆盖会把新点击**悄悄抹掉**，症状是"点了没反应"，且任何日志里都没有痕迹。
     *
     * 这里测的是纯函数那一半（合并语义）；"合并发生在锁里"由
     * [WidgetStore.updateIntents] 提供，属于纯 🧪 真机/仪器验收。
     */
    @Test
    fun `mergeAll 把一批意图并进现有队列`() {
        val existing = WidgetIntentQueues.merge(WidgetIntentQueues.empty(), intent("t_old", true))
        val merged = WidgetIntentQueues.mergeAll(
            existing,
            listOf(intent("t_a", true), intent("t_b", false)),
        )

        assertEquals(3, merged.intents.size)
        // 顺序：已有的在前，新来的按传入顺序追加（位置即新旧）。
        assertEquals(listOf("t_old", "t_a", "t_b"), merged.intents.map { it.taskId })
    }

    @Test
    fun `mergeAll 空列表不改变队列（幂等）`() {
        val existing = WidgetIntentQueues.merge(WidgetIntentQueues.empty(), intent("t1", true))
        assertEquals(existing, WidgetIntentQueues.mergeAll(existing, emptyList()))
    }

    /**
     * 🔴🔴 **本轮最重要的一个测试**：同一 `taskId` 上，容器里的新点击必须赢。
     *
     * 场景（真实时序）：
     * ```
     * T0  drain 读出队列并清空。失败的旧意图是 { t1: true }
     * T1  用户在组件上把 t1 取消勾选 → 容器里现在是 { t1: false }
     * T2  写回失败意图
     * ```
     * T1 的那一下**比 T0 的新**，所以结果必须是 `false`。
     *
     * 🔴 这条测试第一次跑是**红的** —— 它抓出了生产代码里的一个真 bug：
     * `WidgetModule.mergeIntentQueue` 当时写的是
     * `mergeAll(current, pending)`，而 `mergeAll` 的约定是"第二个参数更新"，
     * 于是**较旧的失败意图覆盖了用户的新点击**。
     * 症状是"我明明取消了，它自己又勾上了"，而且只在
     * 「drain 期间又点了 + 那条 op 失败」这个窄窗口里出现。
     *
     * 修法不是加注释提醒顺序，而是换成名字里写清谁新谁旧的
     * [WidgetIntentQueues.mergeOlderIntoNewer] —— **让顺序不可能写反**。
     */
    @Test
    fun `写回失败意图时容器里的新点击赢`() {
        // T1：容器里是用户最新的意愿（取消勾选）。
        val inContainer = WidgetIntentQueues.merge(
            WidgetIntentQueues.empty(),
            intent("t1", false),
        )

        // T2：把 T0 那批较旧的失败意图写回。
        val merged = WidgetIntentQueues.mergeOlderIntoNewer(
            current = inContainer,
            older = listOf(intent("t1", true)),
        )

        assertEquals(1, merged.intents.size)
        assertEquals(false, merged.intents[0].targetIsDone)
    }

    /**
     * 反向对照：**不同** `taskId` 时，旧的那批不该被丢掉。
     *
     * 少了这一条，上面那个测试用"直接返回 current"也能过 ——
     * 那就会把失败意图**全部丢掉**（"下次重试"这条承诺没了）。
     */
    @Test
    fun `写回失败意图时不同任务的旧意图仍然被保留`() {
        val inContainer = WidgetIntentQueues.merge(
            WidgetIntentQueues.empty(),
            intent("t_new", false),
        )

        val merged = WidgetIntentQueues.mergeOlderIntoNewer(
            current = inContainer,
            older = listOf(intent("t_old", true)),
        )

        assertEquals(2, merged.intents.size)
        // 旧意图在前（位置即新旧），新点击在后 —— 下一次 drain 会按这个顺序处理。
        assertEquals(listOf("t_old", "t_new"), merged.intents.map { it.taskId })
    }

    @Test
    fun `mergeAll 继承 merge 的"折叠先于截断"`() {
        // 队列塞满之后，对已在队列里的任务再合并 —— 它不该被挤出去。
        val full = WidgetIntentQueue((0 until WIDGET_INTENT_MAX).map { intent("t$it", false) })
        val merged = WidgetIntentQueues.mergeAll(full, listOf(intent("t0", true)))

        assertEquals(WIDGET_INTENT_MAX, merged.intents.size)
        // t0 折叠后追加到末尾，所以它**一定还在**。
        assertEquals("t0", merged.intents.last().taskId)
        assertEquals(true, merged.intents.last().targetIsDone)
    }
}
