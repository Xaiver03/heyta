package com.heytamobile.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test


/**
 * [FocusWidgetModelBuilder] 的测试。
 *
 * 🔴 这个文件里最要紧的一条不是"算对了什么"，而是**"模型里没有倒计时"** ——
 * 见最后那条反射测试。
 */
class FocusWidgetModelTest {

    private fun envelope(validUntil: Long = 1_000L, dayStr: String = "2026-09-27") = WidgetEnvelope(
        v = WIDGET_CONTRACT_VERSION,
        dayStr = dayStr,
        validUntil = validUntil,
        alg = WIDGET_ALG,
        nonce = "",
        ciphertext = "",
    )

    private fun payload(focus: WidgetFocus? = null) = WidgetPayload(today = emptyList(), focus = focus)

    private fun build(
        envelope: WidgetEnvelope? = null,
        payload: WidgetPayload? = null,
        now: Long = 500L,
    ) = FocusWidgetModelBuilder.build(WidgetGate.resolve(envelope, payload, WidgetIntentQueue(emptyList()), now))

    @Test
    fun `占位`() {
        val model = build()
        assertEquals(FocusWidgetState.PLACEHOLDER, model.state)
        assertNull(model.sessionTitle)
        assertNull(model.targetSeconds)
    }

    @Test
    fun `过期`() {
        val model = build(
            envelope = envelope(validUntil = 500L),
            payload = payload(WidgetFocus(active = true, targetSeconds = 1500.0)),
            now = 500L,
        )
        assertEquals(FocusWidgetState.STALE, model.state)
        // 过期时连"在专注"都不能说 —— 那可能是昨天的专注。
        assertNull(model.targetSeconds)
    }

    @Test
    fun `focus 键缺席就是没有在专注`() {
        assertEquals(FocusWidgetState.IDLE, build(envelope = envelope(), payload = payload(null)).state)
    }

    @Test
    fun `active 为 false 就是没有在专注`() {
        val model = build(envelope = envelope(), payload = payload(WidgetFocus(active = false)))
        assertEquals(FocusWidgetState.IDLE, model.state)
    }

    @Test
    fun `active 为 true 时带出标题与目标时长`() {
        val model = build(
            envelope = envelope(),
            payload = payload(WidgetFocus(active = true, targetSeconds = 1500.0, sessionTitle = "写方案")),
        )
        assertEquals(FocusWidgetState.ACTIVE, model.state)
        assertEquals("写方案", model.sessionTitle)
        assertEquals(1500, model.targetSeconds)
    }

    @Test
    fun `目标时长只收正数`() {
        assertEquals(null, target(0.0))
        assertEquals(null, target(-60.0))
        assertEquals(60, target(60.0))
    }

    private fun target(seconds: Double): Int? = build(
        envelope = envelope(),
        payload = payload(WidgetFocus(active = true, targetSeconds = seconds)),
    ).targetSeconds

    @Test
    fun `空标题原样带出由视图层决定换文案`() {
        // 🔴 TS 只要求 `typeof === 'string'` —— **空字符串是合法的**。
        //    在模型层把它换成"专注中"会让"用户没填标题"与"用户填了'专注中'"
        //    变得无法区分；那是视图层的事。
        val model = build(
            envelope = envelope(),
            payload = payload(WidgetFocus(active = true, sessionTitle = "")),
        )
        assertEquals("", model.sessionTitle)
    }

    @Test
    fun `没有标题也没有目标时长时仍然是 ACTIVE`() {
        val model = build(envelope = envelope(), payload = payload(WidgetFocus(active = true)))
        assertEquals(FocusWidgetState.ACTIVE, model.state)
        assertNull(model.sessionTitle)
        assertNull(model.targetSeconds)
    }

    @Test
    fun `🔴 模型里绝对不能有倒计时字段`() {
        // 契约里的 `WidgetFocus.remainingSeconds` 是**发布那一刻**的快照值，
        // 没有绝对时间锚点。把它带到这里、画到组件上，就是"看起来对、其实是错的"：
        // 应用 09:00 发布"剩余 25:00"，用户 09:10 看到的还是"剩余 25:00"。
        //
        // 所以这条测试盯的不是"算得对不对"，而是**"有没有人把它加进来"**。
        // 将来要加倒计时，正确的做法是给契约加绝对锚点 `endsAt`，
        // 然后**同时**把这条测试改掉 —— 那次改动会被 reviewer 看见。
        val forbidden = FocusWidgetModel::class.java.declaredFields
            .map { it.name.lowercase() }
            .filter {
                it.contains("remaining") || it.contains("countdown") ||
                    it.contains("elapsed") || it.contains("left")
            }
        assertEquals(
            "FocusWidgetModel 出现了倒计时字段 $forbidden —— 见 FocusWidgetModel 的类注释：" +
                "没有绝对锚点就不该猜。要加必须先给契约加 endsAt。",
            emptyList<String>(),
            forbidden,
        )
    }
}
