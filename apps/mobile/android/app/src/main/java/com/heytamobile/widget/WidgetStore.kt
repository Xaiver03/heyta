package com.heytamobile.widget

/** 共享容器里的键。**只有这一份定义**，应用侧与组件侧都从这里取。 */
object WidgetKeys {
    /** 加密信封 JSON（`WidgetEnvelope` 的形状）。 */
    const val SNAPSHOT = "snapshot_v1"

    /** 意图队列 JSON（`@heyta/widget-core` 的 `parseIntentQueue` 吃的那种形状）。 */
    const val INTENTS = "intents_v1"

    // 🔴 这里原来有 `DEVICE_KEY = "device_key_v1"`。2026-09-27 随
    // `writeDeviceKey` / `readDeviceKey` 一起删掉了 —— 密钥不再经过这个容器，
    // 它归 `WidgetDeviceKeyStore`（AndroidKeyStore，不可导出）。
    // ⚠️ 存量设备上那个键可能还躺在 SharedPreferences 里，见 `WidgetModule` 的迁移注释。
}

/** Same-process Android provider/application storage. Reads retain clicks until
 * exact acknowledgements; all mutations share one lock across store instances. */
class WidgetStore(private val store: WidgetKeyValueStore) {

    // ─────────────────────────────────────────────────────────────
    // 快照（应用写、组件读）
    // ─────────────────────────────────────────────────────────────

    fun writeSnapshot(envelopeJson: String) {
        synchronized(LOCK) {
            store.putString(WidgetKeys.SNAPSHOT, envelopeJson)
            check(store.commit()) { "Widget storage commit failed" }
        }
    }

    fun readSnapshot(): String? = synchronized(LOCK) { store.getString(WidgetKeys.SNAPSHOT) }

    // ─────────────────────────────────────────────────────────────
    // 意图队列（组件写、应用 drain）
    // ─────────────────────────────────────────────────────────────

    /** Non-destructive read. An interrupted app can read the same clicks after restart. */
    fun drainIntents(): String? = synchronized(LOCK) { store.getString(WidgetKeys.INTENTS) }

    /** Remove only the exact processed click, preserving newer clicks on the same task. */
    fun acknowledgeIntents(processed: WidgetIntentQueue): Int = synchronized(LOCK) {
        updateIntents { current -> WidgetIntentQueue(current.intents.filterNot { it in processed.intents }) }.intents.size
    }

    /** A stale launcher PendingIntent must not recreate state after local data was cleared. */
    fun appendIntentIfSnapshot(intent: WidgetIntent): Boolean = synchronized(LOCK) {
        if (store.getString(WidgetKeys.SNAPSHOT) == null) return false
        updateIntents { current -> WidgetIntentQueues.merge(current, intent) }
        true
    }

    /** 只读，**不清空**。给组件渲染时的乐观叠加用（它需要看到队列，但不能消费掉）。 */
    fun peekIntents(): WidgetIntentQueue =
        synchronized(LOCK) { WidgetIntentQueues.parse(store.getString(WidgetKeys.INTENTS)) }

    /**
     * **原子**地把队列读出来、变换、写回去。
     *
     * ## 🔴 为什么不能拆成 `peekIntents()` + 写回
     *
     * 组件点一下是"**追加**一条意图"，而不是"drain + 写回"。若写成两步：
     *
     * ```
     * 组件: 读到队列 Q            ← 应用此刻 drain 并清空了队列
     * 应用: 拿到 Q，开始造 op
     * 组件: 把 Q + 新意图写回去   ← 应用刚 drain 掉的那条**又回来了**
     * ```
     *
     * 后果是**同一次点击被应用执行两遍**。完成时间被改了一次，数据没坏，
     * 但所有以 `completedAt` 为准的数字都错了 —— 而且没有任何一处会报错。
     * 在**同一把锁**里读改写，这个交错就不可能发生。
     *
     * 返回变换后的队列，调用方可以直接拿去渲染（省掉一次读）。
     */
    fun updateIntents(transform: (WidgetIntentQueue) -> WidgetIntentQueue): WidgetIntentQueue =
        synchronized(LOCK) {
            val next = transform(WidgetIntentQueues.parse(store.getString(WidgetKeys.INTENTS)))
            store.putString(WidgetKeys.INTENTS, WidgetIntentQueues.toJson(next))
            check(store.commit()) { "Widget storage commit failed" }
            next
        }

    // ─────────────────────────────────────────────────────────────
    // 🔴 设备密钥**不在这里**（2026-09-27 改）
    // ─────────────────────────────────────────────────────────────
    //
    // 这里原来有 `writeDeviceKey` / `readDeviceKey`：把派生好的 32 字节
    // base64 之后存在 SharedPreferences 里，组件再读出来做一次 AES-GCM。
    //
    // W1-4 把密钥归属定成"**原生生成随机密钥、永不离开 Keystore**"之后，
    // 这两个方法**必须删掉**，而不是留着不用：
    //   - `AndroidKeyStore` 的 AES 密钥**不可导出**，所以生产根本给不出这 32 字节；
    //   - 留着它就等于在代码里保留一条"把密钥倒成明文放磁盘"的路径 ——
    //     下一个人会觉得它可用（它有测试、有注释、看起来是既有 API）。
    //
    // 现在的分工：密钥的生成/读取/删除全在 [WidgetDeviceKeyStore]（Keystore），
    // 而本类只管**快照**与**意图队列**这两个真正属于共享容器的数据。

    // ─────────────────────────────────────────────────────────────
    // 退出登录 / 切换账号（D6）
    // ─────────────────────────────────────────────────────────────

    /**
     * 🔴 **登出必须连快照带密钥一起清掉。**
     *
     * 只清快照不清密钥的话，下一个登录的人拿到的是"一个新的密文 + 上一把旧密钥"，
     * 结果是解密失败、组件显示占位符 —— 看起来没问题，但**旧密文仍然躺在磁盘上**，
     * 而清除它的唯一时机就是这里。见 ADR-0025 §2.2 的 D6。
     *
     * ⚠️ 本方法**不清密钥**（密钥不在这个容器里）。调用方必须同时调
     * [WidgetDeviceKeyStore.delete] —— 那是 `WidgetModule` 的登出入口，
     * 两件事写在同一处才不会漏。
     */
    fun clearAll() {
        synchronized(LOCK) {
            store.remove(WidgetKeys.SNAPSHOT)
            store.remove(WidgetKeys.INTENTS)
            check(store.commit()) { "Widget storage commit failed" }
        }
    }

    companion object {
        /**
         * 进程级的一把锁 —— 见类注释。**不要改成 `synchronized(this)`**：
         * 应用与组件是两个不同的 [WidgetStore] 实例，实例锁等于没锁。
         */
        private val LOCK = Any()
    }
}
