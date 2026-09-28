package com.heytamobile.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test


/**
 * [HabitsWidgetModelBuilder] 的测试。
 *
 * 🔴 这一层同时锁住一条**产品行为**：习惯行是只读的（回写不了）。
 * 那条约束在模型里表现为"`HabitsWidgetRow` 没有任何 `targetIsDone` 字段" ——
 * 下面有一条测试专门盯着它。
 */
class HabitsWidgetModelTest {

    private fun envelope(validUntil: Long = 1_000L, dayStr: String = "2026-09-27") = WidgetEnvelope(
        v = WIDGET_CONTRACT_VERSION,
        dayStr = dayStr,
        validUntil = validUntil,
        alg = WIDGET_ALG,
        nonce = "",
        ciphertext = "",
    )

    private fun habit(id: String, doneToday: Boolean = false, streak: Double = 0.0) =
        WidgetHabit(id = id, title = "习惯-$id", doneToday = doneToday, streak = streak)

    private fun payload(habits: List<WidgetHabit>? = null) =
        WidgetPayload(today = emptyList(), habits = habits)

    private fun build(
        envelope: WidgetEnvelope? = null,
        payload: WidgetPayload? = null,
        now: Long = 500L,
    ) = HabitsWidgetModelBuilder.build(WidgetGate.resolve(envelope, payload, WidgetIntentQueue(emptyList()), now))

    @Test
    fun `占位时不给任何习惯`() {
        val model = build()
        assertEquals(WidgetState.PLACEHOLDER, model.state)
        assertTrue(model.rows.isEmpty())
        assertEquals(0, model.totalCount)
    }

    @Test
    fun `过期时不给任何习惯`() {
        val model = build(
            envelope = envelope(validUntil = 500L),
            payload = payload(listOf(habit("a"))),
            now = 500L,
        )
        assertEquals(WidgetState.STALE, model.state)
        assertTrue(model.rows.isEmpty())
    }

    @Test
    fun `habits 键缺席与空习惯列表等价`() {
        val noKey = build(envelope = envelope(), payload = payload(null))
        assertEquals(0, noKey.totalCount)
        assertEquals(WidgetState.READY, noKey.state)
        // ⚠️ 缺席时状态仍然是 READY —— 它不是"解不开密"，所以视图层该说
        //    "还没有习惯"而不是"打开 Heyta"。两条文案的区别是**真的**有区别。
        assertEquals(WidgetState.READY, noKey.state)
    }

    @Test
    fun `计数用全部习惯而行只画前五条`() {
        val many = (1..7).map { habit("h$it", doneToday = it <= 3) }
        val model = build(envelope = envelope(), payload = payload(many))

        assertEquals(HabitsWidgetModelBuilder.MAX_ROWS, model.rows.size)
        // 🔴 计数必须是 7 与 3，不能是 5 与 3 —— 否则会显示 "3/5" 而
        //    用户知道自己有 7 个习惯。
        assertEquals(7, model.totalCount)
        assertEquals(3, model.doneCount)
    }

    @Test
    fun `连续天数取整数`() {
        val model = build(envelope = envelope(), payload = payload(listOf(habit("a", streak = 12.0))))
        assertEquals(12, model.rows.single().streak)
    }

    @Test
    fun `负的连续天数夹成零`() {
        // 契约校验应当已经拒绝，但显示 "连续 -3 天" 比不显示更糟，
        // 所以这里再夹一次（防御性，不是重复校验）。
        val model = build(envelope = envelope(), payload = payload(listOf(habit("a", streak = -3.0))))
        assertEquals(0, model.rows.single().streak)
    }

    @Test
    fun `待处理意图不影响习惯`() {
        // 意图队列里的 taskId 可能**碰巧**与某个习惯 id 相同（都是字符串）。
        // 习惯不该被任务意图影响 —— 那会让用户在任务组件上点一下，
        // 习惯组件上某个习惯莫名其妙变成已完成。
        val queue = WidgetIntentQueue(listOf(WidgetIntent("a", true, 0L)))
        val model = HabitsWidgetModelBuilder.build(
            WidgetGate.resolve(envelope(), payload(listOf(habit("a"))), queue, 500L),
        )
        assertEquals(false, model.rows.single().doneToday)
    }

    @Test
    fun `习惯行没有可回写的目标状态`() {
        // 🔴 结构性锁定：意图队列只能表达"任务"，把习惯伪装成任务会被
        //    drainWidgetIntents 当作 skippedMissing **静默丢弃**。
        //    所以这个类**不许**长出 targetIsDone / taskId 这类字段。
        val forbidden = HabitsWidgetRow::class.java.declaredFields
            .map { it.name.lowercase() }
            .filter { it.contains("target") || it.contains("taskid") }
        assertEquals(
            "HabitsWidgetRow 出现了可回写字段 $forbidden —— 习惯打卡回写不了，" +
                "见 HabitsWidgetModel 的类注释。要支持它必须先改意图队列契约。",
            emptyList<String>(),
            forbidden,
        )
    }
}
