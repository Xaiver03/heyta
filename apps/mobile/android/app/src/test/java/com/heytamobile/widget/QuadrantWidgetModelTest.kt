package com.heytamobile.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test


/**
 * [QuadrantWidgetModelBuilder] 的测试。
 *
 * 与 [TodayWidgetModelTest] 同一套路：判断全在这一层，视图层（`RemoteViews`）
 * 在 JVM 里跑不了。
 */
class QuadrantWidgetModelTest {

    private fun envelope(validUntil: Long = 1_000L, dayStr: String = "2026-09-27") = WidgetEnvelope(
        v = WIDGET_CONTRACT_VERSION,
        dayStr = dayStr,
        validUntil = validUntil,
        alg = WIDGET_ALG,
        nonce = "",
        ciphertext = "",
    )

    private fun task(id: String, isDone: Boolean = false) =
        WidgetTask(id = id, title = "任务-$id", isDone = isDone)

    private fun payload(buckets: Map<String, List<WidgetTask>>? = null) =
        WidgetPayload(today = emptyList(), quadrant = buckets)

    private fun build(
        envelope: WidgetEnvelope? = null,
        payload: WidgetPayload? = null,
        queue: WidgetIntentQueue = WidgetIntentQueue(emptyList()),
        now: Long = 500L,
    ) = QuadrantWidgetModelBuilder.build(WidgetGate.resolve(envelope, payload, queue, now))

    private fun intents(vararg pairs: Pair<String, Boolean>) =
        WidgetIntentQueue(pairs.map { WidgetIntent(it.first, it.second, 0L) })

    // ── 占位 / 过期：一个象限都不许画 ────────────────────────────────

    @Test
    fun `占位时不给任何象限`() {
        val model = build()
        assertEquals(WidgetState.PLACEHOLDER, model.state)
        assertEquals(emptyList<QuadrantWidgetGroup>(), model.groups)
    }

    @Test
    fun `过期时不给任何象限`() {
        val model = build(envelope = envelope(validUntil = 500L), payload = payload(mapOf("1" to listOf(task("a")))), now = 500L)
        assertEquals(WidgetState.STALE, model.state)
        // 🔴 这是本组件最要紧的一条：过期时**一个象限都不能显示** ——
        //    过期数据最危险的地方在于它看起来是对的。
        assertEquals(emptyList<QuadrantWidgetGroup>(), model.groups)
    }

    // ── READY：恒为 4 个象限 ────────────────────────────────────────

    @Test
    fun `能显示时恒有四个象限且顺序是 1 到 4`() {
        val model = build(envelope = envelope(), payload = payload())
        assertEquals(WidgetState.READY, model.state)
        assertEquals(listOf("1", "2", "3", "4"), model.groups.map { it.slot })
    }

    @Test
    fun `缺席的象限是 0 而不是消失`() {
        // 只有槽 1 有任务 —— 另外三个必须仍然存在（否则 2×2 的格局就塌了）。
        val model = build(envelope = envelope(), payload = payload(mapOf("1" to listOf(task("a")))))
        assertEquals(4, model.groups.size)
        assertEquals(0, model.groups[1].total)
        assertTrue(model.groups[1].rows.isEmpty())
    }

    @Test
    fun `quadrant 整个键缺席时与四个空象限等价`() {
        val noKey = build(envelope = envelope(), payload = payload(null))
        val allEmpty = build(envelope = envelope(), payload = payload(mapOf("1" to emptyList())))
        assertEquals(4, noKey.groups.size)
        assertEquals(allEmpty.groups.map { it.total }, noKey.groups.map { it.total })
    }

    // ── 每象限的行选择：未完成优先、最多 2 行 ────────────────────────

    @Test
    fun `每象限最多两行`() {
        val model = build(
            envelope = envelope(),
            payload = payload(mapOf("2" to listOf(task("a"), task("b"), task("c"), task("d")))),
        )
        assertEquals(2, model.groups[1].rows.size)
        // ⚠️ 但计数必须是**全部** 4 条 —— 只数画出来的会让 "0/2" 看着像真的只有两条。
        assertEquals(4, model.groups[1].total)
    }

    @Test
    fun `未完成优先于已完成`() {
        val model = build(
            envelope = envelope(),
            payload = payload(mapOf("1" to listOf(task("done", isDone = true), task("todo")))),
        )
        // 已完成排前面时，画前两条会把唯一要看的藏起来。
        assertEquals(listOf("todo", "done"), model.groups[0].rows.map { it.taskId })
    }

    @Test
    fun `一格里只有已完成时也照样画出来`() {
        val model = build(
            envelope = envelope(),
            payload = payload(mapOf("1" to listOf(task("a", isDone = true), task("b", isDone = true)))),
        )
        assertEquals(listOf("a", "b"), model.groups[0].rows.map { it.taskId })
        assertEquals(2, model.groups[0].done)
    }

    // ── 乐观叠加 ──────────────────────────────────────────────────

    @Test
    fun `待处理意图会改变显示状态与完成计数`() {
        val model = build(
            envelope = envelope(),
            payload = payload(mapOf("1" to listOf(task("a"), task("b")))),
            queue = intents("a" to true),
        )
        assertEquals(1, model.groups[0].done)
        assertEquals(true, model.groups[0].rows.first { it.taskId == "a" }.isDone)
    }

    @Test
    fun `乐观叠加会参与未完成优先的排序`() {
        // ⚠️ 这个用例是**改过一次**的：最初的写法是"a 未完成、b 已完成，
        //    意图把 a 点成完成" —— 那之后两条**都**是已完成，排序键相同，
        //    稳定排序保持原序 [a, b]，于是用例失败。是我的前提错了，不是代码错了。
        //
        // 现在这个写法能真正区分"排序有没有把叠加算进去"：
        //   不叠加：a 已完成 → 排在后面 → [b, a]
        //   叠加"a 回到未完成"：两条都未完成 → 保持载荷顺序 → [a, b]
        val tasks = listOf(task("a", isDone = true), task("b"))

        assertEquals(listOf("b", "a"), rowsOf(tasks, queue = WidgetIntentQueue(emptyList())))
        assertEquals(listOf("a", "b"), rowsOf(tasks, queue = intents("a" to false)))
    }

    /** 只取槽 1 的行 id 顺序。 */
    private fun rowsOf(tasks: List<WidgetTask>, queue: WidgetIntentQueue): List<String> =
        build(envelope = envelope(), payload = payload(mapOf("1" to tasks)), queue = queue)
            .groups[0].rows.map { it.taskId }

    @Test
    fun `目标状态是显示状态的反面`() {
        val model = build(envelope = envelope(), payload = payload(mapOf("1" to listOf(task("a")))))
        val row = model.groups[0].rows.single()
        assertEquals(false, row.isDone)
        assertEquals(true, row.targetIsDone)
    }

    @Test
    fun `dayStr 在占位时仍然带出来`() {
        val model = build(envelope = envelope(dayStr = "2026-01-02"))
        // 连载荷都没有，但信封里的"哪一天"是可信的 —— 头部要能显示日期。
        assertEquals("2026-01-02", model.dayStr)
    }
}
