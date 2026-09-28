package com.heytamobile.widget

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * **在真设备/模拟器上**跑通设备密钥的加解密 —— 这是 JVM 单测**碰不到**的那条路径。
 * ==========================================================================
 *
 * ## 🔴 为什么这个文件必须存在
 *
 * `WidgetAead.kt` 的类注释写着：
 *
 * > 本类在 JVM 单测里无法验证：`AndroidKeyStore` 在 JVM 上是桩（`Stub!`）。
 * > 所以它是**纯 🧪 的，必须真机验收**……**它恰恰是唯一真正保护用户数据的那条路径。**
 *
 * 而真机上第一次执行就炸了：
 *
 *     E_WIDGET_WRITE_FAILED: Caller-provided IV not permitted
 *
 * 根因是 `KeyGenParameterSpec` 的默认 `setRandomizedEncryptionRequired(true)`
 * **禁止调用方自带 IV**，而我们的契约**要求**自带（nonce 要写进信封）。
 * 137 条 JVM 单测全绿，组件在真机上永远拿不到快照。
 *
 * **教训不是"补个测试"，而是："我们知道这里测不了"必须立刻变成"那就去设备上跑一次"，
 * 否则它只是一句免责声明。**
 *
 * ## 这个文件读的是**仓库里的真黄金夹具**
 *
 * `app/build.gradle` 把 `packages/widget-core/fixtures` 挂进了 androidTest 的 assets。
 * 不抄一份进 `assets/`：副本必然漂移，而"四端读同一份夹具"正是这个功能的契约。
 */
@RunWith(AndroidJUnit4::class)
class KeystoreDeviceTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var store: WidgetStore

    @Before
    fun setUp() {
        // 🔴 **必须先删密钥。** `setRandomizedEncryptionRequired(false)` 只影响
        //    **新生成**的密钥；上一版代码留下的 alias 仍然拒绝自带 IV。
        //    不清就直接测，会得到"改了代码但没修好"的假象 —— 真机上踩过这一次。
        WidgetDeviceKeyStore.delete()
        store = WidgetStore(SharedPreferencesWidgetStore(context))
        store.clearAll()
    }

    @After
    fun tearDown() {
        WidgetDeviceKeyStore.delete()
        store.clearAll()
    }

    /** 读**仓库里那一份**黄金夹具（见文件头）。 */
    private fun goldenPlaintext(): String =
        InstrumentationRegistry.getInstrumentation().context.assets
            .open("v1.golden.plaintext.json")
            .bufferedReader(Charsets.UTF_8)
            .use { it.readText() }

    private fun futureNow(): Long = System.currentTimeMillis() + 3_600_000L

    /**
     * **承重测试**：用生产密钥（`AndroidKeyStore`，不可导出）加密**自带 nonce** 的数据。
     *
     * 这一条如果绿，就证明 `Caller-provided IV not permitted` 真的被修掉了 ——
     * 而且是在那条 JVM 测不到的路径上证的。
     */
    @Test
    fun productionKeystoreAcceptsCallerProvidedNonce() {
        val aead = KeystoreAead(WidgetDeviceKeyStore.getOrCreate())
        val plaintext = goldenPlaintext()

        val envelopeJson = WidgetSnapshotCipher.seal(plaintext, "2026-09-28", futureNow(), aead)

        // 信封里必须有密文与 nonce —— 少了任何一样，卡片侧都解不开。
        val envelope = JSONObject(envelopeJson)
        assertTrue("信封里没有 ciphertext", envelope.has("ciphertext"))
        assertTrue("信封里没有 nonce", envelope.has("nonce"))
        assertEquals(WIDGET_ALG, envelope.getString("alg"))
    }

    /**
     * **端到端**：加密之后，读路径必须能解出**夹具里那几条真任务**。
     *
     * ⚠️ 只断言"没报错"是不够的：解密失败在实现里被有意吞成 `placeholder`
     *（卡片上"没有数据"与"解不开"看起来一样），所以必须**断言内容**。
     */
    @Test
    fun sealedSnapshotReadsBackAsRealTasks() {
        val aead = KeystoreAead(WidgetDeviceKeyStore.getOrCreate())
        val plaintext = goldenPlaintext()

        store.writeSnapshot(WidgetSnapshotCipher.seal(plaintext, "2026-09-28", futureNow(), aead))

        // 读路径用的是 `existing()`（组件侧**不新建密钥**），所以先确认它拿得到。
        val readAead = WidgetRefresh.resolveProductionAead()
        assertNotNull("组件侧拿不到设备密钥 —— 快照将永远解不开", readAead)

        val content = WidgetRefresh.contentFor(store, System.currentTimeMillis(), readAead)
        assertEquals(
            "解出来不是 READY —— 密文、AAD 或 nonce 有一处对不上",
            WidgetState.READY,
            content.state,
        )
        assertTrue("READY 但没有载荷", content.isShowable)

        val model = WidgetRefresh.todayModelFor(store, System.currentTimeMillis(), readAead)
        assertEquals(WidgetState.READY, model.state)

        // 🔴 **断言夹具里的真标题**，而不是"行数大于 0"——
        //    后者在"解出一份空载荷"时也会绿。
        val titles = model.rows.map { it.title }
        assertTrue("解出来的行里没有夹具中的「交房租」，实际：$titles", titles.contains("交房租"))
        assertTrue("解出来的行里没有夹具中的「写周报」，实际：$titles", titles.contains("写周报"))
    }

    /** 组件侧**不新建**密钥：密钥不存在时必须老实返回 `null`，让界面显示占位态。 */
    @Test
    fun widgetSideNeverCreatesAKey() {
        WidgetDeviceKeyStore.delete()
        assertEquals(
            "组件侧自己造了密钥 —— 那会把正确的密钥覆盖掉，用户再也恢复不了",
            null,
            WidgetRefresh.resolveProductionAead(),
        )
    }
}
