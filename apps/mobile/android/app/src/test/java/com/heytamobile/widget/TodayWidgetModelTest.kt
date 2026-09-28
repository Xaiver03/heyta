package com.heytamobile.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [TodayWidgetModelBuilder] 的测试 —— W1-3 里**唯一能被单测覆盖**的那一半。
 *
 * 另一半（`TodayWidgetViews` 的 RemoteViews 构造）在 JVM 里跑不了（框架是桩），
 * 所以这里的策略是：**把判断全挤到这一层**，视图层只做"照着抄"。
 */
class TodayWidgetModelTest {

    // ─────────────────────────────────────────────────────────────
    // 构造辅助
    // ─────────────────────────────────────────────────────────────

    private fun envelope(
        validUntil: Long = 1_000L,
        dayStr: String = "2026-09-27",
    ) = WidgetEnvelope(
        v = WIDGET_CONTRACT_VERSION,
        dayStr = dayStr,
        validUntil = validUntil,
        alg = WIDGET_ALG,
        nonce = "",
        ciphertext = "",
    )

    private fun task(id: String, isDone: Boolean = false) =
        WidgetTask(id = id, title = "任务-$id", isDone = isDone)

    private fun payload(vararg tasks: WidgetTask) = WidgetPayload(today = tasks.toList())

    private fun queue(vararg intents: WidgetIntent) = WidgetIntentQueue(intents.toList())

    private fun intent(taskId: String, targetIsDone: Boolean, at: Long = 0L) =
        WidgetIntent(taskId = taskId, targetIsDone = targetIsDone, at = at)

    private fun build(
        envelope: WidgetEnvelope? = null,
        payload: WidgetPayload? = null,
        queue: WidgetIntentQueue = queue(),
        now: Long = 500L,
    ) = TodayWidgetModelBuilder.build(WidgetGate.resolve(envelope, payload, queue, now))

    // ─────────────────────────────────────────────────────────────
    // 占位：三种"没有可信数据"的入口
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `既没有信封也没有载荷时是占位且没有日期`() {
        val model = build()

        assertEquals(WidgetState.PLACEHOLDER, model.state)
        assertNull(model.dayStr)
        assertEquals(emptyList<WidgetTaskRow>(), model.rows)
    }

    /**
     * 🔴 这一条是本文件里最重要的断言。
     *
     * 载荷为 null 表示**解不开密**（设备刚重启、密钥还没派生）。若把它渲染成
     * "今天没有任务"，就是在**骗用户说今天没事** —— 而用户会据此真的以为什么都不用做。
     * 占位与"今天确实没有任务"必须是两种状态，且在类型上就分开。
     */
    @Test
    fun `解不开密时是占位而不是今天没有任务`() {
        val model = build(envelope = envelope(), payload = null)

        assertEquals(WidgetState.PLACEHOLDER, model.state)
        assertEquals(emptyList<WidgetTaskRow>(), model.rows)
    }

    /** 有信封就知道"应用算的是哪一天"，占位时把它显示出来对用户更有用。 */
    @Test
    fun `占位时仍然带上信封里的日期`() {
        assertEquals("2026-09-27", build(envelope = envelope(), payload = null).dayStr)
    }

    @Test
    fun `载荷为空时是可读状态且零行`() {
        val model = build(envelope = envelope(), payload = emptyPayload())

        // ⚠️ 与 PLACEHOLDER 的区别就是这条测试的全部意义。
        assertEquals(WidgetState.READY, model.state)
        assertEquals(0, model.totalCount)
    }

    // ─────────────────────────────────────────────────────────────
    // 到期判定：`now >= validUntil`
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `未过期时可读并带出任务行`() {
        val model = build(
            envelope = envelope(validUntil = 1_000L),
            payload = payload(task("a"), task("b")),
            now = 999L,
        )

        assertEquals(WidgetState.READY, model.state)
        assertEquals(listOf("任务-a", "任务-b"), model.rows.map { it.title })
    }

    /** 边界：到期**前一毫秒**仍然可读。若这里写成 `<=`，组件会提前一毫秒翻页。 */
    @Test
    fun `到期前一毫秒仍然可读`() {
        assertEquals(
            WidgetState.READY,
            build(envelope = envelope(validUntil = 1_000L), payload = emptyPayload(), now = 999L).state,
        )
    }

    /** 边界：`validUntil` 是**失效时刻**，到了那一刻就已经不算数了。 */
    @Test
    fun `恰好等于到期时刻就算过期`() {
        assertEquals(
            WidgetState.STALE,
            build(envelope = envelope(validUntil = 1_000L), payload = emptyPayload(), now = 1_000L).state,
        )
    }

    @Test
    fun `明显过期后是过期状态`() {
        assertEquals(
            WidgetState.STALE,
            build(envelope = envelope(validUntil = 1_000L), payload = emptyPayload(), now = 5_000L).state,
        )
    }

    /**
     * 🔴 过期时**一条任务都不给**。
     *
     * 过期数据最危险的地方是**它看起来是对的**：用户会照着昨天的清单做事，
     * 而且没有理由怀疑。ADR-0025 §2.1.3 明确要求"显示正确的占位状态**而不是过期数据**"。
     */
    @Test
    fun `过期时一行任务都不显示`() {
        val model = build(
            envelope = envelope(validUntil = 1_000L),
            payload = payload(task("a"), task("b")),
            now = 2_000L,
        )

        assertEquals(WidgetState.STALE, model.state)
        assertEquals(emptyList<WidgetTaskRow>(), model.rows)
        assertTrue(model.rows.isEmpty())
    }

    /**
     * 过期时计数归零 —— 视图层据此**不显示进度**。
     *
     * 若这里还报 "3/5"，头部会渲染成 "2026-09-27 · 3/5"，用户会读成**今天的进度**。
     */
    @Test
    fun `过期时完成计数归零`() {
        val model = build(
            envelope = envelope(validUntil = 1_000L),
            payload = payload(task("a", isDone = true), task("b")),
            now = 2_000L,
        )

        assertEquals(0, model.doneCount)
        assertEquals(0, model.totalCount)
    }

    /** 过期时仍然带日期：用户要知道**这是哪一天的**旧数据。 */
    @Test
    fun `过期时保留日期`() {
        assertEquals(
            "2026-09-27",
            build(envelope = envelope(validUntil = 1_000L), payload = emptyPayload(), now = 2_000L).dayStr,
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 行与目标状态
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `任务顺序就是载荷里的顺序`() {
        val model = build(
            envelope = envelope(),
            payload = payload(task("c"), task("a"), task("b")),
        )

        assertEquals(listOf("c", "a", "b"), model.rows.map { it.taskId })
    }

    /**
     * 🔴 点击要写的是**目标状态**，不是"切换"这个动作。
     *
     * 动作在过期/陈旧的视图上会算错（用户看到未完成、实际已完成 → "标记完成" = 无变化）；
     * 目标状态是幂等的，怎么重复点击都不会错。
     */
    @Test
    fun `每行的目标状态与显示状态相反`() {
        val model = build(
            envelope = envelope(),
            payload = payload(task("todo"), task("done", isDone = true)),
        )

        val todo = model.rows.single { it.taskId == "todo" }
        assertEquals(false, todo.isDone)
        assertEquals(true, todo.targetIsDone)

        val done = model.rows.single { it.taskId == "done" }
        assertEquals(true, done.isDone)
        assertEquals(false, done.targetIsDone)
    }

    @Test
    fun `完成计数按显示状态算`() {
        val model = build(
            envelope = envelope(),
            payload = payload(task("a", isDone = true), task("b"), task("c", isDone = true)),
        )

        assertEquals(2, model.doneCount)
        assertEquals(3, model.totalCount)
    }

    // ─────────────────────────────────────────────────────────────
    // 乐观叠加
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `待处理意图会覆盖快照里的状态`() {
        val model = build(
            envelope = envelope(),
            payload = payload(task("a")),
            queue = queue(intent("a", targetIsDone = true)),
        )

        val row = model.rows.single()
        assertEquals(true, row.isDone)
        // 显示成"已完成"之后，再点就应该是"取消完成"。
        assertEquals(false, row.targetIsDone)
    }

    @Test
    fun `同一任务的多条意图以最后一条为准`() {
        val model = build(
            envelope = envelope(),
            payload = payload(task("a")),
            queue = queue(
                intent("a", targetIsDone = true, at = 1L),
                intent("a", targetIsDone = false, at = 2L),
            ),
        )

        assertEquals(false, model.rows.single().isDone)
    }

    /** 与任务无关的意图（任务已被删掉）不能影响任何一行。 */
    @Test
    fun `与任务无关的意图不影响任何行`() {
        val model = build(
            envelope = envelope(),
            payload = payload(task("a")),
            queue = queue(intent("不存在", targetIsDone = true)),
        )

        assertEquals(false, model.rows.single().isDone)
    }

    /**
     * 快捷方式：用 [TodayWidgetModelBuilder.build] 生成的行 id 与意图折叠后的
     * "再点一次"应当自洽 —— 点两次回到原位。
     */
    @Test
    fun `按目标状态连续点两次回到原位`() {
        val first = build(
            envelope = envelope(),
            payload = payload(task("a")),
        )
        val target = first.rows.single().targetIsDone
        assertEquals(true, target)

        val second = build(
            envelope = envelope(),
            payload = payload(task("a")),
            queue = queue(intent("a", targetIsDone = target)),
        )
        assertEquals(true, second.rows.single().isDone)

        val third = build(
            envelope = envelope(),
            payload = payload(task("a")),
            queue = queue(intent("a", targetIsDone = second.rows.single().targetIsDone)),
        )
        assertEquals(false, third.rows.single().isDone)
    }
}
