package com.heytamobile.widget

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/**
 * **Kotlin 解析器对着 golden fixture 的锁** —— 这是 W1-1 的核心交付物。
 *
 * ============================================================
 * 为什么期望值是**手写**的，而不是"拿夹具当期望值"
 * ============================================================
 *
 * 一个很自然的写法是："用 `parsePayload` 解析 `v1.golden.plaintext.json` 得到期望值，
 * 再用解密结果去比"。**那样测试永远不会失败** —— 解析器两侧用的是同一个实现，
 * 一个 bug 会同等地污染两边。这正是本仓库反复强调的"不可能失败的检查"。
 *
 * 所以这里的期望值是从夹具内容**逐条抄下来**的常量。它独立于解析器，
 * 因此解析器写错（漏字段、错判 null、顺序变了）都会红。
 *
 * 同时还有一条"两个产物必须一致"的测试：把**明文夹具文件**也解析一遍，
 * 要求它产出**同一份手写期望**。这条把"解密出来的字节"和"仓库里的明文夹具"
 * 钉在一起 —— 它们一旦漂移，四端就各自对着不同的数据写解析器。
 */
class WidgetGoldenFixtureTest {

    private val fixturesDir = File(
        requireNotNull(System.getProperty("heyta.widget.fixtures")) {
            "缺少系统属性 heyta.widget.fixtures —— 应由 app/build.gradle 的 tasks.withType(Test) 注入"
        }
    )

    private fun readFixture(name: String) = JSONObject(File(fixturesDir, name).readText(Charsets.UTF_8))

    /** 与 `packages/widget-core/tests/fixture-source.ts` 的 `TEST_KEY` **同源**。 */
    private val testKey: ByteArray = MessageDigest.getInstance("SHA-256")
        .digest("heyta-widget-golden-key-v1".toByteArray(Charsets.UTF_8))

    /**
     * 把载荷压成一组**可读且有序**的行，方便与手写期望逐行比对。
     *
     * 之所以按行比而不是用 `JSONObject.similar()`：按行比时，**顺序和缺失**都会暴露 ——
     * "today 的排序变了"或"某个 section 没被解析出来"都会红，
     * 而结构比较对顺序不敏感，会放过前者。
     *
     * 🔴 **数组的顺序有意义，对象的键序没有。**
     *
     * 这条不是风格问题，是实测出来的：`v1.golden.plaintext.json` 里 `projectColors`
     * 的写法是 `p_life` 在前，而 `org.json` 解析出来后**迭代顺序是 `p_work` 在前** ——
     * 因为 android-json 的 `JSONObject` 内部是 `HashMap`，**不保证插入顺序**。
     *
     * 于是：任何原生实现都**不得依赖对象键序**。契约没有规定它，Swift 的 `Dictionary`、
     * ArkTS 的对象、Kotlin 的 `HashMap` 三者顺序本来就各不相同 ——
     * 依赖它就会得到"在这台机器上对、在那台上错"的四端漂移。
     * 所以这里对**对象型 section 按键排序**后再比，而**数组保持原序**（顺序是契约的一部分：
     * `today` 的排序由选择器决定，必须逐端一致）。
     */
    private fun dump(p: WidgetPayload): List<String> {
        val out = mutableListOf<String>()
        // 数组：保持原序 —— 顺序本身是契约。
        for (t in p.today) {
            out += "today|${t.id}|${t.title}|${t.isDone}|${t.projectId ?: "-"}|${t.quadrant ?: "-"}"
        }
        // 对象：按键排序 —— 键序不属于契约。
        p.quadrant?.toSortedMap()?.forEach { (slot, tasks) ->
            for (t in tasks) {
                out += "q$slot|${t.id}|${t.title}|${t.isDone}|${t.projectId ?: "-"}|${t.quadrant ?: "-"}"
            }
        }
        p.habits?.forEach {
            out += "habit|${it.id}|${it.title}|${it.doneToday}|${it.streak}"
        }
        p.focus?.let {
            out += "focus|${it.active}|${it.remainingSeconds}|${it.targetSeconds}|${it.sessionTitle}"
        }
        p.projectColors?.toSortedMap()?.forEach { (k, v) ->
            out += "color|$k|${v.light}|${v.dark}"
        }
        return out
    }

    // ─────────────────────────────────────────────────────────────
    // 手写期望 —— 独立于解析器，抄自夹具内容
    // ─────────────────────────────────────────────────────────────
    private val expectedGolden = listOf(
        // today：6 条，其中 t_milk 已完成，t_buy_tape 无所属清单
        "today|t_rent|交房租|false|p_life|-",
        "today|t_write_report|写周报|false|p_work|-",
        "today|t_fix_incident|修复线上故障|false|p_work|-",
        "today|t_buy_tape|买胶带|false|-|-",
        "today|t_photo|整理相册|false|p_plain|-",
        "today|t_milk|买牛奶|true|p_life|-",
        // quadrant 四桶
        "q1|t_write_report|写周报|false|p_work|1",
        "q1|t_fix_incident|修复线上故障|false|p_work|1",
        "q1|t_read_paper|读论文|false|-|1",
        "q2|t_checkup|体检预约|false|-|2",
        "q3|t_rent|交房租|false|p_life|3",
        "q3|t_buy_tape|买胶带|false|-|3",
        "q3|t_photo|整理相册|false|p_plain|3",
        "q4|t_someday|有空再整理照片|false|-|4",
        // habits
        "habit|h_water|喝水|true|3.0",
        "habit|h_run|跑步|false|3.0",
        // focus
        "focus|true|720.0|1500.0|写周报",
        // projectColors：**故意只有两个**，而 t_photo 引用的 p_plain 不在其中
        "color|p_life|#a21caf|#e879f9",
        "color|p_work|#16a34a|#34d399",
    )

    // ─────────────────────────────────────────────────────────────
    // 1. 完整管线：信封 → 解密 → 解析 → 与手写期望一致
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `用测试密钥解密 v1 信封后解析出的载荷与手写期望逐行一致`() {
        val result = WidgetSnapshotCipher.readSafely(readFixture("v1.golden.json"), RawKeyAead(testKey))
        assertEquals(expectedGolden, dump(result))
    }

    /**
     * 这条把"解密结果"和"仓库里的明文夹具"钉在一起。
     *
     * 它同时守着一条容易忽略的事实：**密文里存的是紧凑 JSON**
     *（`JSON.stringify` 的输出），而 `v1.golden.plaintext.json` 是**美化过**的。
     * 所以两者不能逐字节比 —— 只能比**解析后的语义**。这条测试就是那个语义比对。
     */
    @Test
    fun `仓库里的明文夹具解析出的载荷与同一份手写期望一致`() {
        val parsed = WidgetSnapshotParser.parsePayload(readFixture("v1.golden.plaintext.json"))
        assertTrue("明文夹具应当能解析成功，实际：$parsed", parsed is PayloadParseResult.Ok)
        assertEquals(expectedGolden, dump((parsed as PayloadParseResult.Ok).payload))
    }

    @Test
    fun `t_photo 引用的 p_plain 不在 projectColors 里 —— 这是刻意留的缺色分支`() {
        val result = WidgetSnapshotCipher.readSafely(readFixture("v1.golden.json"), RawKeyAead(testKey))

        assertTrue("t_photo 必须还在 today 里", result.today.any { it.id == "t_photo" })
        assertEquals("p_plain", result.today.first { it.id == "t_photo" }.projectId)
        // 缺色**不是解析错误** —— 解析器照收，渲染层回退到中性色。
        assertNull("p_plain 不该有配色", result.projectColors?.get("p_plain"))
        assertNotNull("p_life 必须有配色", result.projectColors?.get("p_life"))
    }

    // ─────────────────────────────────────────────────────────────
    // 2. v99 判别用例：证明"先判 v 再拒绝"
    // ─────────────────────────────────────────────────────────────

    /**
     * 🔴 这条测试的**设计要点**在于它必须先证明自己**能分辨**两种实现。
     *
     * `v99.unknown.golden.json` 的密文是**用同一份明文加密的有效密文**。
     * 所以：
     *   - 正确实现（先判 `v`）→ 拒绝，得到空载荷；
     *   - 错误实现（无视 `v` 直接解密并显示）→ 得到**整整一屏任务**。
     *
     * 若只断言"结果是空的"，而密文碰巧是坏的，这条测试也会绿 —— 但那时它
     * 分辨不出任何东西。所以下面**先证明密文是好的**。
     */
    @Test
    fun `v 未知时必须先拒绝，而不是无视它去解密`() {
        val raw = readFixture("v99.unknown.golden.json")

        // 第一段：证明"若无视 v 直接解密，是会成功的"。
        val v99envelope = WidgetEnvelope(
            v = 99,
            dayStr = raw.getString("dayStr"),
            validUntil = raw.getLong("validUntil"),
            alg = raw.getString("alg"),
            nonce = raw.getString("nonce"),
            ciphertext = raw.getString("ciphertext"),
        )
        val plain = WidgetSnapshotCipher.decrypt(v99envelope, RawKeyAead(testKey))
        val payload = WidgetSnapshotParser.parsePayload(JSONObject(String(plain, Charsets.UTF_8)))
        assertTrue("v99 的密文必须是有效的，否则这条测试分不清对错", payload is PayloadParseResult.Ok)
        assertEquals(
            "无视 v 会显示 6 条任务 —— 这正是错误实现的样子",
            6,
            (payload as PayloadParseResult.Ok).payload.today.size,
        )

        // 第二段：正确实现必须拒绝它。
        val rejected = WidgetSnapshotParser.parseEnvelope(raw)
        assertTrue("v=99 必须被拒绝", rejected is EnvelopeParseResult.Rejected)
        assertEquals(
            "未来版本必须得到 unknown-version（预期内的正常情况），而不是含混的 malformed-envelope",
            WidgetRejection.UNKNOWN_VERSION,
            (rejected as EnvelopeParseResult.Rejected).reason,
        )
        assertEquals(emptyList<String>(), dump(WidgetSnapshotCipher.readSafely(raw, RawKeyAead(testKey))))
    }

    // ─────────────────────────────────────────────────────────────
    // 3. AAD 是**承重的**
    // ─────────────────────────────────────────────────────────────

    /**
     * AAD 只要差一个字节，GCM 认证就会失败。
     *
     * 这条测试证明 `envelopeAad()` 的值**真的参与了认证**，而不是被写了个寂寞 ——
     * 若哪端把 AAD 写成空串，或者用错了分隔符，这里会红。
     */
    @Test
    fun `改写信封里的 dayStr 会让解密失败 —— AAD 真的参与认证`() {
        val raw = readFixture("v1.golden.json")
        val tampered = JSONObject(raw.toString())
        tampered.put("dayStr", "2026-09-28") // 只改一天

        assertEquals(
            "信封被改过 → 必须降级成空载荷",
            emptyList<String>(),
            dump(WidgetSnapshotCipher.readSafely(tampered, RawKeyAead(testKey))),
        )

        // 再直接确认一次：不是"载荷恰好为空"，而是**抛了异常**。
        val tamperedEnvelope = WidgetEnvelope(
            v = raw.getInt("v"),
            dayStr = "2026-09-28",
            validUntil = raw.getLong("validUntil"),
            alg = raw.getString("alg"),
            nonce = raw.getString("nonce"),
            ciphertext = raw.getString("ciphertext"),
        )
        var threw = false
        try {
            WidgetSnapshotCipher.decrypt(tamperedEnvelope, RawKeyAead(testKey))
        } catch (_: Throwable) {
            threw = true
        }
        assertTrue("AAD 不匹配必须导致解密抛异常", threw)
    }

    @Test
    fun `AAD 字符串的格式与契约一致`() {
        // 与 TS 的 envelopeAad() 同源：`${v}|${dayStr}|${validUntil}`
        assertEquals("1|2026-09-27|1790000000000", envelopeAad(1, "2026-09-27", 1_790_000_000_000L))
    }

    // ─────────────────────────────────────────────────────────────
    // 4. fail-closed 降级的四种入口
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `拿不到密钥时必须降级成占位符而不是崩溃`() {
        // 这是 D1 方案**已知且已接受**的代价：设备刚重启、应用还没跑过一次时，
        // 密钥还没派生出来，组件只能显示占位符。见 ADR-0025 §2.3。
        assertEquals(
            emptyList<String>(),
            dump(WidgetSnapshotCipher.readSafely(readFixture("v1.golden.json"), aead = null)),
        )
    }

    @Test
    fun `密文损坏时必须降级成占位符`() {
        val raw = readFixture("v1.golden.json")
        val broken = JSONObject(raw.toString())
        broken.put("ciphertext", "AAAAAAAAAAAAAAAAAAAA")

        assertEquals(
            emptyList<String>(),
            dump(WidgetSnapshotCipher.readSafely(broken, RawKeyAead(testKey))),
        )
    }

    @Test
    fun `密钥不对时必须降级成占位符`() {
        val wrongKey = MessageDigest.getInstance("SHA-256")
            .digest("not-the-golden-key".toByteArray(Charsets.UTF_8))
        assertEquals(
            emptyList<String>(),
            dump(WidgetSnapshotCipher.readSafely(readFixture("v1.golden.json"), RawKeyAead(wrongKey))),
        )
    }

    @Test
    fun `信封根本不是对象时必须降级成占位符`() {
        assertEquals(emptyList<String>(), dump(WidgetSnapshotCipher.readSafely("不是对象", RawKeyAead(testKey))))
        assertEquals(emptyList<String>(), dump(WidgetSnapshotCipher.readSafely(null, RawKeyAead(testKey))))
    }

    // ─────────────────────────────────────────────────────────────
    // 5. 测试替身自己也要被钉住
    // ─────────────────────────────────────────────────────────────

    /**
     * `android.util.Base64` 的替身若语义偏了，整套测试都会"对着错的东西绿"。
     * 所以把它和 JDK 实现**逐位比一遍**（用夹具里的真实值，而不是编造的输入）。
     */
    @Test
    fun `android-util-Base64 替身与 JDK 实现逐位一致`() {
        val raw = readFixture("v1.golden.json")
        val nonce = raw.getString("nonce")
        val ciphertext = raw.getString("ciphertext")

        val jdk = java.util.Base64.getDecoder()
        assertTrue(
            "nonce 解码结果必须与 JDK 一致",
            jdk.decode(nonce).contentEquals(android.util.Base64.decode(nonce, android.util.Base64.NO_WRAP)),
        )
        assertTrue(
            "ciphertext 解码结果必须与 JDK 一致",
            jdk.decode(ciphertext).contentEquals(
                android.util.Base64.decode(ciphertext, android.util.Base64.NO_WRAP),
            ),
        )
        assertEquals("AES-GCM 的 nonce 必须是 12 字节", 12, jdk.decode(nonce).size)
    }
}
