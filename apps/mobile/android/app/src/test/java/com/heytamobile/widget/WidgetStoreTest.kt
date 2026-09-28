package com.heytamobile.widget

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * [WidgetStore] 的单测。
 *
 * 跑在**内存实现**上，所以不依赖 `SharedPreferences`（它在 JVM 单测里是桩）。
 * 平台差异被压进 `SharedPreferencesWidgetStore` 一个文件，那个文件只能靠真机验证 ——
 * 这正是 W1-2/W1-3 必须补一次真机验收的原因。
 */
class WidgetStoreTest {

    /**
     * 内存实现。用 `ConcurrentHashMap` 是为了让**并发测试**测的是 `WidgetStore` 的锁，
     * 而不是被测试替身自己的竞态干扰。
     *
     * 🔴 `readDelayMs` 的存在是刻意的，而且**是并发那条测试成立的前提**。
     *
     * 第一版没有它，结果是：把生产代码的锁从进程级 `LOCK` 改成实例锁 `this`（真 bug），
     * 并发测试**依然全绿** —— 因为 `getString` 到 `remove` 之间只有纳秒级的窗口，
     * 8 个线程几乎不可能真的挤进去。那就是本仓库最反对的形状：
     * **一个不可能失败的检查**，它给人"并发已经验过了"的错觉。
     *
     * 让替身在读的时候停 50 ms，窗口就被放大到**确定可见**：
     *   - 进程级锁 → 8 个线程串行进入，只有第 1 个读得到 → 恰好 1 个赢家；
     *   - 实例锁   → 8 个线程同时进入，全都读得到 → 8 个赢家 → **红**。
     */
    private class MemoryStore(private val readDelayMs: Long = 0) : WidgetKeyValueStore {
        private val map = ConcurrentHashMap<String, String>()
        var commitCount = 0
            private set

        override fun getString(key: String): String? {
            if (readDelayMs > 0) Thread.sleep(readDelayMs)
            return map[key]
        }

        override fun putString(key: String, value: String) {
            map[key] = value
        }

        override fun remove(key: String) {
            map.remove(key)
        }

        override fun commit(): Boolean {
            commitCount++
            return true
        }

        /** 测试用：绕过 `WidgetStore` 直接看底层。 */
        fun raw(key: String): String? = map[key]
    }

    private fun newStore() = MemoryStore().let { it to WidgetStore(it) }

    // ─────────────────────────────────────────────────────────────
    // 快照
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `快照写入后能原样读回`() {
        val (_, store) = newStore()
        val envelope = """{"v":1,"dayStr":"2026-09-27"}"""

        store.writeSnapshot(envelope)

        assertEquals("必须逐字节原样存取 —— 任何「顺手美化」都会破坏 AAD", envelope, store.readSnapshot())
    }

    @Test
    fun `没有快照时读出 null`() {
        val (_, store) = newStore()
        assertNull(store.readSnapshot())
    }

    // ─────────────────────────────────────────────────────────────
    // 意图队列：读后即清
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `drain 返回原始 JSON 并把队列清空`() {
        val (memory, store) = newStore()
        val queue = """{"v":1,"intents":[{"taskId":"t1","targetIsDone":true,"at":1790000000000}]}"""
        memory.putString(WidgetKeys.INTENTS, queue)

        assertEquals("第一次 drain 必须拿到原始串", queue, store.drainIntents())
        assertNull("第二次 drain 必须是 null —— 否则同一次点击会被执行两遍", store.drainIntents())
        assertNull("底层也必须真的清了", memory.raw(WidgetKeys.INTENTS))
    }

    @Test
    fun `没有意图时 drain 返回 null 且不写脏数据`() {
        val (memory, store) = newStore()
        assertNull(store.drainIntents())
        assertNull(memory.raw(WidgetKeys.INTENTS))
    }

    /**
     * 🔴 这条守着类注释里那句"**进程级**的一把锁"。
     *
     * 若有人把 `WidgetStore` 的锁改成 `synchronized(this)`，两个实例各锁各的，
     * 这条测试就会**出现多次成功 drain** —— 而真实后果是"一次点击被执行两遍"：
     * 完成时间被改了一次，数据没坏，**所有以 `completedAt` 为准的数字都错了**。
     *
     * 用**两个不同的 `WidgetStore` 实例**是刻意的：它们共享同一份底层存储，
     * 正是应用进程与组件进程各自 new 一个的真实形状。
     */
    @Test
    fun `多实例并发 drain 时恰好只有一个能拿到队列`() {
        // readDelayMs 把"读 → 清"之间的窗口放大到确定可见，理由见 MemoryStore 的注释。
        val memory = MemoryStore(readDelayMs = 50)
        val queue = """{"v":1,"intents":[{"taskId":"t1","targetIsDone":true,"at":1}]}"""
        memory.putString(WidgetKeys.INTENTS, queue)

        val threads = 8
        val barrier = CyclicBarrier(threads)
        val start = CountDownLatch(1)
        val winners = AtomicInteger(0)
        val pool = Executors.newFixedThreadPool(threads)

        try {
            val futures = (1..threads).map {
                pool.submit {
                    // 每个线程**各自** new 一个 store —— 与真实调用栈一致。
                    val store = WidgetStore(memory)
                    barrier.await(10, TimeUnit.SECONDS)
                    start.await(10, TimeUnit.SECONDS)
                    if (store.drainIntents() != null) winners.incrementAndGet()
                }
            }
            start.countDown()
            futures.forEach { it.get(20, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }

        assertEquals(
            "8 个并发 drain 必须恰好 1 个成功 —— 读到多个就是实例锁而不是进程锁",
            1,
            winners.get(),
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 🔴 设备密钥的测试**整组删掉了**（2026-09-27，W1-4）
    // ─────────────────────────────────────────────────────────────
    //
    // 这里原来有三条：`设备密钥以 Base64 存取且逐字节一致`、
    // `设备密钥损坏时返回 null 而不是抛异常`、
    // 以及 `clearAll` 里"密钥也要清掉"那一句断言。
    //
    // 删掉的原因不是"测试过期了"，而是**被测的东西被有意移除了**：
    // 密钥归属定成"原生生成、永不离开 Keystore"，而 Keystore 的 AES 密钥
    // **不可导出** —— 共享容器里**不再存在**"32 字节 base64"这个东西。
    //
    // ⚠️ 保留它们会怎样：它们会让"把密钥倒成字节存磁盘"看起来是一条
    // **有测试覆盖的既有能力**，下一个人（或下一轮的我）会理所当然地用它。
    // 那正是这次改动要消除的东西。**测试不是越多越好，测错东西的测试是负债。**
    //
    // 现在的覆盖在 [WidgetRefreshPipelineTest]：那里用注入的 `RawKeyAead`
    //（裸密钥，供夹具）走完整管线；生产用的 `KeystoreAead` 是**纯 🧪 真机验收**。

    // ─────────────────────────────────────────────────────────────
    // 登出清理（D6）
    // ─────────────────────────────────────────────────────────────

    @Test
    fun `clearAll 必须把快照与意图队列一起清掉`() {
        val (memory, store) = newStore()
        store.writeSnapshot("""{"v":1}""")
        memory.putString(WidgetKeys.INTENTS, """{"v":1,"intents":[]}""")

        store.clearAll()

        assertNull("快照", store.readSnapshot())
        assertNull("意图队列", memory.raw(WidgetKeys.INTENTS))
        // ⚠️ 密钥**不在**本容器里，所以这里断言不了它。清密钥是
        //    `WidgetModule` 登出入口的职责（`WidgetDeviceKeyStore.delete()`）——
        //    两件事写在同一处才不会漏，这条注释是那个约束的显式记录。
    }

    // ─────────────────────────────────────────────────────────────
    // 落盘时机
    // ─────────────────────────────────────────────────────────────

    /**
     * 每次写都必须 `commit()`。
     *
     * 🔴 组件是在 `BroadcastReceiver.onReceive` 里被唤醒的，系统**可以在它返回后
     * 立刻杀掉进程** —— 异步写（`apply()`）那时可能还没落盘，用户的点击就无声地丢了。
     */
    @Test
    fun `每次写入都必须同步落盘`() {
        val (memory, store) = newStore()
        val before = memory.commitCount

        store.writeSnapshot("""{"v":1}""")
        assertTrue("写快照必须 commit", memory.commitCount > before)

        val afterSnapshot = memory.commitCount
        memory.putString(WidgetKeys.INTENTS, """{"v":1,"intents":[]}""")
        store.drainIntents()
        assertTrue("drain 必须 commit（清空也要落盘）", memory.commitCount > afterSnapshot)
    }

    @Test
    fun `读取不落盘`() {
        val (memory, store) = newStore()
        store.writeSnapshot("""{"v":1}""")
        val before = memory.commitCount
        store.readSnapshot()
        assertFalse("读不该产生写", memory.commitCount > before)
    }
}
