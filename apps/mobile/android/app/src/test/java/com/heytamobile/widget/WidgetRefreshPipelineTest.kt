package com.heytamobile.widget

import java.io.File
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 贯穿**整条管线**的测试：存储里的密文 → 解析信封 → 用设备密钥解密 → 解析载荷
 * → 判定过期 → 叠加意图 → 渲染模型。
 *
 * ## 它补的是哪一块空白
 *
 * `TodayWidgetModelTest` 用的是**手搓**的信封与载荷，所以它验的是"给定输入怎么判断"；
 * 而这里用的是**真夹具密文**（和 TS 侧、和四端解析器同一份 `v1.golden.json`），
 * 所以它验的是"这条链真的能接上"。
 *
 * 缺了它，`readOrNull` 与 `readSafely` 的差别（"解不开" vs "今天没任务"）
 * 就只在**类型层面**正确，而没有一条测试真的走过那条路径。
 *
 * ⚠️ **2026-09-27（W1-4）改了密钥的来源**：原来把 32 字节 base64 写进共享容器
 * （`store.writeDeviceKey`），现在改成注入 [WidgetAead]。原因是密钥归属定成了
 * "原生生成、永不离开 Keystore"，而 Keystore 的密钥**不可导出** ——
 * 再收 `ByteArray` 就等于逼生产代码把密钥倒出来。
 *
 * 🔴 因此本文件测的是 [RawKeyAead]（裸密钥，供夹具用）；
 * **生产用的 [KeystoreAead] 在这里跑不了**（`AndroidKeyStore` 在 JVM 上是桩），
 * 属于**纯 🧪 真机验收**。两者共用 [WidgetAead] 背后的同一段 `Cipher` 调用，
 * 所以"生产也符合契约"是靠**共用实现**保证的 —— 这一点必须诚实地说清楚，
 * 不能拿本文件的绿色去暗示 Keystore 那条路径已经验过。
 */
class WidgetRefreshPipelineTest {

    private val fixturesDir = File(
        requireNotNull(System.getProperty("heyta.widget.fixtures")) {
            "缺少系统属性 heyta.widget.fixtures —— 应由 app/build.gradle 的 tasks.withType(Test) 注入"
        },
    )

    private fun goldenEnvelopeJson(): String =
        File(fixturesDir, "v1.golden.json").readText(Charsets.UTF_8)

    /** 与 `packages/widget-core/tests/fixture-source.ts` 的 `TEST_KEY` 同源。 */
    private val testKey: ByteArray =
        MessageDigest.getInstance("SHA-256").digest("heyta-widget-golden-key-v1".toByteArray())

    /**
     * 把"有没有密钥"表达成 [WidgetAead] 而不是"容器里有没有那个键"。
     *
     * `null` = 设备刚重启、应用还没跑过（ADR-0025 §2.3 记录的那个已接受代价）。
     */
    private fun aeadFor(key: ByteArray? = testKey): WidgetAead? = key?.let { RawKeyAead(it) }

    /** 夹具里的 `validUntil`。 */
    private val validUntil = 1790000000000L

    /**
     * 极简内存存储。
     *
     * ⚠️ `WidgetStoreTest` 里另有一个**带读取延迟**的版本（用来把并发窗口放大到可见），
     * 那个是给并发测试用的；这里不需要延迟，也就不共用 —— 共用一个"能配延迟"的类
     * 会让本文件看起来也在测并发。
     */
    private class MemoryStore : WidgetKeyValueStore {
        private val values = HashMap<String, String>()
        override fun getString(key: String): String? = values[key]
        override fun putString(key: String, value: String) {
            values[key] = value
        }

        override fun remove(key: String) {
            values.remove(key)
        }

        override fun commit(): Boolean = true
    }

    private fun storeWithGoldenSnapshot(): WidgetStore =
        WidgetStore(MemoryStore()).apply { writeSnapshot(goldenEnvelopeJson()) }

    // ─────────────────────────────────────────────────────────────
    // 正常路径
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `黄金夹具能一路走到可读状态`() {
        val model = WidgetRefresh.todayModelFor(storeWithGoldenSnapshot(), validUntil - 1, aeadFor())

        assertEquals(WidgetState.READY, model.state)
        assertEquals("2026-09-27", model.dayStr)
        assertEquals(6, model.totalCount)
        // 夹具里最后一条（买牛奶）是已完成，其余未完成。
        assertEquals(1, model.doneCount)
        assertEquals("交房租", model.rows.first().title)
        assertEquals("买牛奶", model.rows.last().title)
    }

    @Test
    fun `每一行的目标状态与显示状态相反`() {
        val model = WidgetRefresh.todayModelFor(storeWithGoldenSnapshot(), validUntil - 1, aeadFor())

        assertEquals(true, model.rows.first { it.taskId == "t_rent" }.targetIsDone)
        // 已完成的那条，点一下是"取消完成"。
        assertEquals(false, model.rows.first { it.taskId == "t_milk" }.targetIsDone)
    }

    // ─────────────────────────────────────────────────────────────
    // 🔴 "解不开" 不能伪装成 "今天没有任务"
    // ─────────────────────────────────────────────────────────────

    /** 设备刚重启、应用还没跑过：Keystore 里的密钥还读不到。 */
    @Test
    fun `没有设备密钥时是占位而不是零行可读`() {
        val model = WidgetRefresh.todayModelFor(
            storeWithGoldenSnapshot(),
            validUntil - 1,
            aeadFor(key = null),
        )

        assertEquals(WidgetState.PLACEHOLDER, model.state)
        assertEquals(0, model.totalCount)
        // 关键：**不是** READY + 0 行。后者会被渲染成"今天没有任务"。
        assertNotEquals(WidgetState.READY, model.state)
    }

    @Test
    fun `密钥不对时是占位`() {
        val wrongKey = MessageDigest.getInstance("SHA-256").digest("not-the-golden-key".toByteArray())
        val model = WidgetRefresh.todayModelFor(
            storeWithGoldenSnapshot(),
            validUntil - 1,
            aeadFor(key = wrongKey),
        )

        assertEquals(WidgetState.PLACEHOLDER, model.state)
    }

    @Test
    fun `存储里没有快照时是占位且没有日期`() {
        val model = WidgetRefresh.todayModelFor(WidgetStore(MemoryStore()), 0L, aeadFor())

        assertEquals(WidgetState.PLACEHOLDER, model.state)
        assertNull(model.dayStr)
    }

    @Test
    fun `快照不是合法 JSON 时是占位`() {
        val store = WidgetStore(MemoryStore())
        store.writeSnapshot("{ 这不是 JSON")

        assertEquals(
            WidgetState.PLACEHOLDER,
            WidgetRefresh.todayModelFor(store, 0L, aeadFor()).state,
        )
    }

    @Test
    fun `未知契约版本的信封是占位`() {
        val store = WidgetStore(MemoryStore())
        store.writeSnapshot(File(fixturesDir, "v99.unknown.golden.json").readText(Charsets.UTF_8))

        assertEquals(
            WidgetState.PLACEHOLDER,
            WidgetRefresh.todayModelFor(store, 0L, aeadFor()).state,
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 过期与意图叠加（走真密文，不是手搓对象）
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `到了夹具的 validUntil 就是过期且不给行`() {
        val model = WidgetRefresh.todayModelFor(storeWithGoldenSnapshot(), validUntil, aeadFor())

        assertEquals(WidgetState.STALE, model.state)
        // 夹具里明明有 6 条，过期后一条都不给 —— 这才是这一条测试要锁的东西。
        assertEquals(0, model.totalCount)
        assertTrue(model.rows.isEmpty())
        assertEquals("2026-09-27", model.dayStr)
    }

    @Test
    fun `队列里的点击会叠加到真夹具的行上`() {
        val store = storeWithGoldenSnapshot()
        store.updateIntents { queue ->
            WidgetIntentQueues.merge(queue, WidgetIntent("t_rent", targetIsDone = true, at = 1L))
        }

        val model = WidgetRefresh.todayModelFor(store, validUntil - 1, aeadFor())

        assertEquals(WidgetState.READY, model.state)
        assertEquals(true, model.rows.first { it.taskId == "t_rent" }.isDone)
        // 未完成变已完成 → 完成数从 1 变 2。
        assertEquals(2, model.doneCount)
    }

    @Test
    fun `取消完成也会叠加`() {
        val store = storeWithGoldenSnapshot()
        store.updateIntents { queue ->
            WidgetIntentQueues.merge(queue, WidgetIntent("t_milk", targetIsDone = false, at = 1L))
        }

        val model = WidgetRefresh.todayModelFor(store, validUntil - 1, aeadFor())

        assertEquals(false, model.rows.first { it.taskId == "t_milk" }.isDone)
        assertEquals(0, model.doneCount)
    }

    /** 叠加只在可读状态发生 —— 过期时一行都不给，意图自然也不该显示出来。 */
    @Test
    fun `过期时即使有意图也不显示行`() {
        val store = storeWithGoldenSnapshot()
        store.updateIntents { queue ->
            WidgetIntentQueues.merge(queue, WidgetIntent("t_rent", targetIsDone = true, at = 1L))
        }

        val model = WidgetRefresh.todayModelFor(store, validUntil + 1, aeadFor())

        assertEquals(WidgetState.STALE, model.state)
        assertEquals(0, model.totalCount)
    }

    @Test
    fun `没有密钥时即使有意图也不显示行`() {
        // 与上一条同理：占位状态下也没有"行"可以叠加。
        val store = storeWithGoldenSnapshot()
        store.updateIntents { queue ->
            WidgetIntentQueues.merge(queue, WidgetIntent("t_rent", targetIsDone = true, at = 1L))
        }

        val model = WidgetRefresh.todayModelFor(store, validUntil - 1, aeadFor(key = null))

        assertEquals(WidgetState.PLACEHOLDER, model.state)
        assertEquals(0, model.totalCount)
    }

    // ─────────────────────────────────────────────────────────────
    // seal —— 封包侧（W1-4 新增）
    // ─────────────────────────────────────────────────────────────

    /**
     * 🔴 封出来的信封必须能被自己解开，**且能被同一个 `readOrNull` 走通**。
     *
     * 这条测试同时覆盖了两件容易分叉的事：信封的**形状**（字段名 / base64 变体）
     * 与 AAD 的**拼法**。少了它，`seal` 与 `decrypt` 各自"看起来对"，
     * 而合起来解不开 —— 症状就是"组件没数据"。
     */
    @Test
    fun `seal 出来的信封能被 readOrNull 解开`() {
        val payloadJson = """{"today":[{"id":"t1","title":"写周报","isDone":false}]}"""
        val envelopeJson = WidgetSnapshotCipher.seal(
            payloadJson = payloadJson,
            dayStr = "2026-09-27",
            validUntil = validUntil,
            aead = RawKeyAead(testKey),
        )

        val payload = WidgetSnapshotCipher.readOrNull(
            org.json.JSONObject(envelopeJson),
            RawKeyAead(testKey),
        )

        assertEquals(1, payload?.today?.size)
        assertEquals("写周报", payload?.today?.first()?.title)
    }

    /** 换个密钥就解不开 —— 证明 seal 真的用了传进去的密钥，而不是没加密。 */
    @Test
    fun `seal 出来的信封用别的密钥解不开`() {
        val envelopeJson = WidgetSnapshotCipher.seal(
            payloadJson = """{"today":[]}""",
            dayStr = "2026-09-27",
            validUntil = validUntil,
            aead = RawKeyAead(testKey),
        )

        val otherKey = MessageDigest.getInstance("SHA-256").digest("another-key".toByteArray())
        assertNull(
            WidgetSnapshotCipher.readOrNull(
                org.json.JSONObject(envelopeJson),
                RawKeyAead(otherKey),
            ),
        )
    }

    /** 🔴 改了 `validUntil` 就解不开 —— AAD 绑定在**封包侧**同样生效（不是只写在文档里）。 */
    @Test
    fun `seal 之后改 validUntil 就解不开`() {
        val envelopeJson = WidgetSnapshotCipher.seal(
            payloadJson = """{"today":[]}""",
            dayStr = "2026-09-27",
            validUntil = validUntil,
            aead = RawKeyAead(testKey),
        )

        val tampered = org.json.JSONObject(envelopeJson).put("validUntil", validUntil + 86_400_000L)

        assertNull(WidgetSnapshotCipher.readOrNull(tampered, RawKeyAead(testKey)))
    }

    /** 两次封包的 nonce 必须不同 —— GCM 重用 nonce 是灾难，这条锁住"每次都重新取"。 */
    @Test
    fun `两次封包的 nonce 不同`() {
        fun sealOnce() = org.json.JSONObject(
            WidgetSnapshotCipher.seal("""{"today":[]}""", "2026-09-27", validUntil, RawKeyAead(testKey)),
        )

        assertNotEquals(sealOnce().getString("nonce"), sealOnce().getString("nonce"))
        assertNotEquals(sealOnce().getString("ciphertext"), sealOnce().getString("ciphertext"))
    }

    /** 入参在封包时就拒绝 —— 写下一份契约解不开的信封等于把必然失败的产物存进共享容器。 */
    @Test
    fun `seal 拒绝空的 dayStr 与越界的 validUntil`() {
        val aead = RawKeyAead(testKey)

        val badDay = runCatching {
            WidgetSnapshotCipher.seal("""{"today":[]}""", "", validUntil, aead)
        }
        assertTrue("空 dayStr 应当被拒绝", badDay.isFailure)

        val badValidUntil = runCatching {
            WidgetSnapshotCipher.seal("""{"today":[]}""", "2026-09-27", MAX_EPOCH_MS + 1, aead)
        }
        assertTrue("越界的 validUntil 应当被拒绝", badValidUntil.isFailure)
    }
}
