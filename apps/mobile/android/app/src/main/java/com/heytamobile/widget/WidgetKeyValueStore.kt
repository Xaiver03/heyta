package com.heytamobile.widget

import android.content.Context

/**
 * 小组件共享存储的**最小抽象**。
 *
 * ============================================================
 * 为什么要有这层抽象（不是"为了好看"）
 * ============================================================
 *
 * 生产实现是 `SharedPreferences`，而它在 **JVM 单测里是桩**（调用抛 `Stub!`，
 * 开了 `returnDefaultValues` 则返回 null）。若把读写逻辑直接写在 `SharedPreferences` 上，
 * 那么"意图队列**读后即清**"这类**必须原子**的逻辑就只能靠真机验证 —— 而它恰恰是
 * 最容易写错、错了最难发现的地方（症状是"点了没反应"或"一次点击执行两遍"）。
 *
 * 抽成接口之后：逻辑跑在**内存实现**上，单测能覆盖；平台差异被压到这一个文件里。
 *
 * ⚠️ **不要用 `MODE_MULTI_PROCESS`**（已废弃且在多数版本上根本不生效）。
 * Android 上 `AppWidgetProvider` **默认跑在应用自己的进程里**，所以应用私有存储
 * 组件本来就读得到 —— 这也是 Android **不需要** iOS 那种 App Group 的原因。
 */
interface WidgetKeyValueStore {
    fun getString(key: String): String?

    fun putString(key: String, value: String)

    fun remove(key: String)

    /**
     * **同步**落盘，返回是否成功。
     *
     * 🔴 刻意不用 `apply()`（异步）：组件是在 `BroadcastReceiver.onReceive` 里被唤醒的，
     * 而系统**可以在 `onReceive` 返回后立刻杀掉进程** —— `apply()` 的异步写那时可能还没落盘，
     * 用户的点击就无声无息地丢了。写是低频操作，同步的代价可以接受。
     */
    fun commit(): Boolean
}

/** 生产实现。`context` 只用来拿 `SharedPreferences`，不持有 Activity。 */
class SharedPreferencesWidgetStore(context: Context) : WidgetKeyValueStore {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun getString(key: String): String? = prefs.getString(key, null)

    private var editor: android.content.SharedPreferences.Editor? = null

    override fun putString(key: String, value: String) {
        val transaction = editor ?: prefs.edit().also { editor = it }
        transaction.putString(key, value)
    }

    override fun remove(key: String) {
        val transaction = editor ?: prefs.edit().also { editor = it }
        transaction.remove(key)
    }

    override fun commit(): Boolean {
        val transaction = editor ?: return true
        editor = null
        return transaction.commit()
    }

    companion object {
        /** 存储文件名。**改它等于让已装机的用户丢一次快照** —— 快照会重建，不必改。 */
        const val PREFS_NAME = "heyta_widget"
    }
}
