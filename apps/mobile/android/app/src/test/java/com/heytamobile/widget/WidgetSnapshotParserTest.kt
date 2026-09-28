package com.heytamobile.widget

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 解析器的**判别用例与边界** —— 每一条都对应 TS 侧 `contract.ts` 的一处具体判断。
 *
 * ============================================================
 * 为什么这些用例要单独写，而不是只靠 golden fixture
 * ============================================================
 *
 * 夹具是一份**合法的**载荷，它只能证明"好数据能过"。
 * 契约里真正容易写错的是**拒绝路径**：
 *   - `projectId: null` 必须**硬拒绝**（而不是变成字符串 "null"）；
 *   - `quadrant: null` 在 TS 里**会进入分支并被拒绝**（而不是被当成"缺失"跳过）；
 *   - `alg` 不认识时必须拒绝，而不是"试着解一下看看"；
 *   - `validUntil` 越界必须拒绝 —— 否则四端的 AAD 格式化规则不同，
 *     会变成"四端同时解密失败、组件就是没数据"。
 *
 * 这些分支夹具一条都覆盖不到，而它们恰恰是跨端分歧的发源地。
 */
class WidgetSnapshotParserTest {

    // ─────────────────────────────────────────────────────────────
    // 辅助
    // ─────────────────────────────────────────────────────────────

    private val validEnvelope =
        """{"v":1,"dayStr":"2026-09-27","validUntil":1790000000000,"alg":"AES-GCM-256",""" +
            """"nonce":"AAAAAAAAAAAAAAAA","ciphertext":"AAAA"}"""

    private fun envelope(json: String) = WidgetSnapshotParser.parseEnvelope(JSONObject(json))

    private fun payload(json: String) = WidgetSnapshotParser.parsePayload(JSONObject(json))

    private fun envelopeReason(json: String): String? =
        (envelope(json) as? EnvelopeParseResult.Rejected)?.reason

    private fun payloadReason(json: String): String? =
        (payload(json) as? PayloadParseResult.Rejected)?.reason

    private fun okPayload(json: String): WidgetPayload {
        val r = payload(json)
        assertTrue("期望解析成功，实际：$r", r is PayloadParseResult.Ok)
        return (r as PayloadParseResult.Ok).payload
    }

    private fun expectPayloadRejected(reason: String, json: String) {
        val r = payload(json)
        assertTrue("期望被拒绝（$reason），实际：$r", r is PayloadParseResult.Rejected)
        assertEquals(reason, (r as PayloadParseResult.Rejected).reason)
    }

    private fun tasks(count: Int): String =
        (1..count).joinToString(",") { """{"id":"t$it","title":"任务$it","isDone":false}""" }

    // ─────────────────────────────────────────────────────────────
    // 信封
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `合法信封能通过，且 alg 被归一成契约里的唯一值`() {
        val r = envelope(validEnvelope)
        assertTrue("$r", r is EnvelopeParseResult.Ok)
        assertEquals(WIDGET_ALG, (r as EnvelopeParseResult.Ok).envelope.alg)
    }

    @Test
    fun `alg 不认识时必须拒绝，而不是试着解一下`() {
        assertEquals(
            WidgetRejection.UNSUPPORTED_ALG,
            envelopeReason(validEnvelope.replace("AES-GCM-256", "none")),
        )
        // 大小写不同也不行 —— 契约里只有一个字面量。
        assertEquals(
            WidgetRejection.UNSUPPORTED_ALG,
            envelopeReason(validEnvelope.replace("AES-GCM-256", "aes-gcm-256")),
        )
    }

    @Test
    fun `v 不是整数时是 unknown-version，而不是 malformed-envelope`() {
        assertEquals(
            "字符串 \"1\" 不是整数",
            WidgetRejection.UNKNOWN_VERSION,
            envelopeReason(validEnvelope.replace("\"v\":1", "\"v\":\"1\"")),
        )
        assertEquals(
            "v 缺失",
            WidgetRejection.UNKNOWN_VERSION,
            envelopeReason(validEnvelope.replace("\"v\":1,", "")),
        )
        assertEquals(
            "v 是小数",
            WidgetRejection.UNKNOWN_VERSION,
            envelopeReason(validEnvelope.replace("\"v\":1", "\"v\":1.5")),
        )
    }

    @Test
    fun `v 正确但其余字段坏掉时是 malformed-envelope`() {
        // 这条守着"两种失败必须能区分"：预期内的旧版本 vs 真的坏了。
        assertEquals(
            WidgetRejection.MALFORMED_ENVELOPE,
            envelopeReason(validEnvelope.replace("\"ciphertext\":\"AAAA\"", "\"ciphertext\":\"\"")),
        )
        assertEquals(
            WidgetRejection.MALFORMED_ENVELOPE,
            envelopeReason(validEnvelope.replace("\"nonce\":\"AAAAAAAAAAAAAAAA\"", "\"nonce\":\"\"")),
        )
        assertEquals(
            WidgetRejection.MALFORMED_ENVELOPE,
            envelopeReason(validEnvelope.replace("\"dayStr\":\"2026-09-27\"", "\"dayStr\":\"\"")),
        )
    }

    @Test
    fun `focus 的 endsAt 是可选的安全整数 —— 灵动岛的前提`() {
        // 缺省合法（向前兼容：旧发布方不写它）
        val omitted = payload("""{"today":[],"focus":{"active":true}}""")
        assertTrue(omitted is PayloadParseResult.Ok)
        assertNull((omitted as PayloadParseResult.Ok).payload.focus?.endsAt)

        // 合法值被读进来
        val ok = payload("""{"today":[],"focus":{"active":true,"endsAt":1790000000000}}""")
        assertEquals(
            1_790_000_000_000L,
            (ok as PayloadParseResult.Ok).payload.focus?.endsAt,
        )

        // 边界：0 与 MAX 都收
        assertEquals(
            0L,
            (payload("""{"today":[],"focus":{"active":true,"endsAt":0}}""")
                as PayloadParseResult.Ok).payload.focus?.endsAt,
        )
        assertEquals(
            MAX_EPOCH_MS,
            (payload("""{"today":[],"focus":{"active":true,"endsAt":8640000000000000}}""")
                as PayloadParseResult.Ok).payload.focus?.endsAt,
        )

        // 🔴 小数 / 负数 / 越界 / null / 字符串 / 布尔 一律拒绝。
        //    小数尤其关键：毫秒时刻没有小数，`org.json` 会把 1.5 读成 Double，
        //    接受它会让 "1.5 毫秒" 一路走进原生时间轴。
        for (bad in listOf("1.5", "-1", "8640000000000001", "null", "\"1790000000000\"", "true")) {
            val r = payload("""{"today":[],"focus":{"active":true,"endsAt":$bad}}""")
            assertTrue("应拒绝 endsAt = $bad（实际 $r）", r is PayloadParseResult.Rejected)
        }
    }

    @Test
    fun `validUntil 越界必须拒绝 —— 它挡的是四端 AAD 格式化分歧`() {
        val overMax = MAX_EPOCH_MS + 1
        assertEquals(
            WidgetRejection.MALFORMED_ENVELOPE,
            envelopeReason(validEnvelope.replace("1790000000000", overMax.toString())),
        )
        assertEquals(
            WidgetRejection.MALFORMED_ENVELOPE,
            envelopeReason(validEnvelope.replace("1790000000000", "-1")),
        )
        assertEquals(
            "字符串不行",
            WidgetRejection.MALFORMED_ENVELOPE,
            envelopeReason(validEnvelope.replace("1790000000000", "\"1790000000000\"")),
        )
    }

    @Test
    fun `validUntil 的上界本身是合法的边界`() {
        val atMax = envelope(validEnvelope.replace("1790000000000", MAX_EPOCH_MS.toString()))
        assertTrue("MAX_EPOCH_MS 本身必须合法，否则上界写错了：$atMax", atMax is EnvelopeParseResult.Ok)
        val atZero = envelope(validEnvelope.replace("1790000000000", "0"))
        assertTrue("0 必须合法：$atZero", atZero is EnvelopeParseResult.Ok)
    }

    @Test
    fun `信封不是对象时是 not-an-object`() {
        assertEquals(
            WidgetRejection.NOT_AN_OBJECT,
            (WidgetSnapshotParser.parseEnvelope("字符串") as EnvelopeParseResult.Rejected).reason,
        )
        assertEquals(
            WidgetRejection.NOT_AN_OBJECT,
            (WidgetSnapshotParser.parseEnvelope(null) as EnvelopeParseResult.Rejected).reason,
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 🔴 projectId: null —— 整个契约里最接地气的一条
    // ─────────────────────────────────────────────────────────────

    /**
     * 为什么这条**必须**硬拒绝，而不是"当成没有 projectId"：
     *
     * Android 上最自然的写法是 `obj.optString("projectId")`，而它对 JSON `null`
     * 返回的是**字符串 `"null"`**。于是"无所属清单"的任务会去找一个叫 `null` 的清单配色，
     * 界面上表现为一个诡异的颜色或空色块 —— 而且**四端表现各不相同**
     * （Swift 的 `as? String` 得到 nil、ArkTS 的 `??` 得到 undefined）。
     *
     * 契约选择在**入口处**就拒绝：产出方必须**省略这个键**，而不是写 null。
     */
    @Test
    fun `projectId 是 null 时必须硬拒绝，原因码是 null-project-id`() {
        expectPayloadRejected(
            WidgetRejection.NULL_PROJECT_ID,
            """{"today":[{"id":"t1","title":"任务","isDone":false,"projectId":null}]}""",
        )
    }

    @Test
    fun `projectId 省略是合法的，空串不是`() {
        val omitted = okPayload("""{"today":[{"id":"t1","title":"任务","isDone":false}]}""")
        assertNull("省略 projectId 时应当真的没有清单", omitted.today[0].projectId)

        expectPayloadRejected(
            WidgetRejection.MALFORMED_TASK,
            """{"today":[{"id":"t1","title":"任务","isDone":false,"projectId":""}]}""",
        )
    }

    @Test
    fun `quadrant 是 null 时必须拒绝 —— 与 TS 的 in 语义对齐`() {
        // TS 写的是 `'quadrant' in raw && raw.quadrant !== undefined`，
        // 于是 `quadrant: null` **会进入校验分支**并被拒绝（null 不是 number）。
        // 用 org.json 很容易把它当"缺失"静默跳过 —— 那就是跨端分歧。
        expectPayloadRejected(
            WidgetRejection.MALFORMED_TASK,
            """{"today":[{"id":"t1","title":"任务","isDone":false,"quadrant":null}]}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_TASK,
            """{"today":[{"id":"t1","title":"任务","isDone":false,"quadrant":"1"}]}""",
        )
    }

    @Test
    fun `任务字段的类型必须严格`() {
        expectPayloadRejected(
            WidgetRejection.MALFORMED_TASK,
            """{"today":[{"id":"t1","title":"任务","isDone":"false"}]}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_TASK,
            """{"today":[{"id":"","title":"任务","isDone":false}]}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_TASK,
            """{"today":[{"id":"t1","title":"","isDone":false}]}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_TASK,
            """{"today":["不是对象"]}""",
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 载荷结构
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `today 是必需字段，且必须是数组`() {
        assertEquals(WidgetRejection.MISSING_TODAY, payloadReason("""{}"""))
        assertEquals(WidgetRejection.MISSING_TODAY, payloadReason("""{"quadrant":{}}"""))
        assertEquals(WidgetRejection.TODAY_NOT_ARRAY, payloadReason("""{"today":null}"""))
        assertEquals(WidgetRejection.TODAY_NOT_ARRAY, payloadReason("""{"today":{}}"""))
    }

    @Test
    fun `只有 today 的最小载荷是合法的，其余 section 保持 null`() {
        val p = okPayload("""{"today":[]}""")
        assertEquals(0, p.today.size)
        assertNull("没给的 section 必须是 null，不是空集合", p.quadrant)
        assertNull(p.habits)
        assertNull(p.focus)
        assertNull(p.projectColors)
    }

    @Test
    fun `emptyPayload 只有 today，且为空 —— 与 TS 的 emptyPayload 一致`() {
        val p = emptyPayload()
        assertEquals(0, p.today.size)
        assertNull(p.quadrant)
        assertNull(p.habits)
        assertNull(p.focus)
        assertNull(p.projectColors)
    }

    @Test
    fun `任务数上界是 20 —— 恰好在 20 合法，21 必须拒绝`() {
        // 边界必须**两边都测**：只测 21 拒绝的话，把上界写成 0 也能过。
        val twenty = okPayload("""{"today":[${tasks(20)}]}""")
        assertEquals(20, twenty.today.size)

        expectPayloadRejected(WidgetRejection.TOO_MANY_TASKS, """{"today":[${tasks(21)}]}""")
    }

    @Test
    fun `quadrant 每个桶也受 20 条上界约束`() {
        okPayload("""{"today":[],"quadrant":{"1":[${tasks(20)}]}}""")
        expectPayloadRejected(
            WidgetRejection.TOO_MANY_TASKS,
            """{"today":[],"quadrant":{"1":[${tasks(21)}]}}""",
        )
    }

    @Test
    fun `section 是 null 时必须拒绝，而不是当成缺失`() {
        // TS：`'quadrant' in raw && raw.quadrant !== undefined` —— null 会进入分支并被拒绝。
        expectPayloadRejected(WidgetRejection.MALFORMED_SECTION, """{"today":[],"quadrant":null}""")
        expectPayloadRejected(WidgetRejection.MALFORMED_SECTION, """{"today":[],"projectColors":null}""")
        expectPayloadRejected(WidgetRejection.MALFORMED_SECTION, """{"today":[],"habits":null}""")
        expectPayloadRejected(WidgetRejection.MALFORMED_SECTION, """{"today":[],"focus":null}""")
    }

    @Test
    fun `projectColors 的值必须是 light-dark 对象，不能是字符串 token`() {
        // 🔴 这条对应 D7 的**更正后**结论：槽位→颜色只该由应用解析一次，
        //    所以契约里传的是**已解析好的两个十六进制**，不是 token 名。
        //    若某端图省事传 "category1"，这里必须红。
        expectPayloadRejected(
            WidgetRejection.MALFORMED_SECTION,
            """{"today":[],"projectColors":{"p1":"category1"}}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_SECTION,
            """{"today":[],"projectColors":{"p1":{"light":"#fff"}}}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_SECTION,
            """{"today":[],"projectColors":{"p1":{"light":"","dark":"#000"}}}""",
        )

        val ok = okPayload(
            """{"today":[],"projectColors":{"p1":{"light":"#a21caf","dark":"#e879f9"}}}"""
        )
        assertEquals("#a21caf", ok.projectColors?.get("p1")?.light)
        assertEquals("#e879f9", ok.projectColors?.get("p1")?.dark)
    }

    // ─────────────────────────────────────────────────────────────
    // habits / focus —— 两处"比看起来更宽"的类型要求
    // ─────────────────────────────────────────────────────────────

    /**
     * 🔴 `streak` 只要求"是数字"，**不要求整数**。
     *
     * 这条测试守着一个**刻意的 API 丑设计**：`WidgetHabit.streak` 是 `Double` 而不是 `Int`。
     * 若哪天有人"顺手"把它改成 `Int`，一个 `streak: 3.5` 的载荷就会被 Kotlin 拒绝、
     * 而被 TS 接受 —— 跨端静默分歧，正是本契约要消灭的东西。
     */
    @Test
    fun `habit 的 streak 只要求是数字，小数也必须接受`() {
        val p = okPayload("""{"today":[],"habits":[{"id":"h1","title":"喝水","doneToday":true,"streak":3.5}]}""")
        assertEquals(3.5, p.habits?.get(0)?.streak ?: 0.0, 0.0001)
        assertEquals(3, p.habits?.get(0)?.streakCount)
    }

    @Test
    fun `habit 的关键字段类型必须严格`() {
        expectPayloadRejected(
            WidgetRejection.MALFORMED_SECTION,
            """{"today":[],"habits":[{"id":"h1","title":"喝水","doneToday":"true","streak":3}]}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_SECTION,
            """{"today":[],"habits":[{"id":"h1","title":"喝水","doneToday":true,"streak":"3"}]}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_SECTION,
            """{"today":[],"habits":[{"id":"","title":"喝水","doneToday":true,"streak":3}]}""",
        )
    }

    /**
     * 🔴 `focus.sessionTitle` 只要求 `typeof === 'string'` —— **空字符串合法**。
     *
     * 一眼看上去"标题不该为空"很合理，但契约**没有**这条要求。
     * 若 Kotlin 收窄成"非空"，两端判断就不同了。
     */
    @Test
    fun `focus 的 sessionTitle 允许空字符串`() {
        val p = okPayload(
            """{"today":[],"focus":{"active":false,"sessionTitle":""}}"""
        )
        assertEquals("", p.focus?.sessionTitle)
    }

    @Test
    fun `focus 的可选字段缺失时保持 null，给了就必须类型正确`() {
        val p = okPayload("""{"today":[],"focus":{"active":true}}""")
        assertEquals(true, p.focus?.active)
        assertNull(p.focus?.remainingSeconds)
        assertNull(p.focus?.targetSeconds)
        assertNull(p.focus?.sessionTitle)

        expectPayloadRejected(
            WidgetRejection.MALFORMED_SECTION,
            """{"today":[],"focus":{"active":true,"remainingSeconds":"720"}}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_SECTION,
            """{"today":[],"focus":{"active":true,"sessionTitle":123}}""",
        )
        expectPayloadRejected(
            WidgetRejection.MALFORMED_SECTION,
            """{"today":[],"focus":{"remainingSeconds":720}}""",
        )
    }

    @Test
    fun `载荷不是对象时是 not-an-object`() {
        assertEquals(
            WidgetRejection.NOT_AN_OBJECT,
            (WidgetSnapshotParser.parsePayload(null) as PayloadParseResult.Rejected).reason,
        )
        assertEquals(
            WidgetRejection.NOT_AN_OBJECT,
            (WidgetSnapshotParser.parsePayload("x") as PayloadParseResult.Rejected).reason,
        )
    }
}
