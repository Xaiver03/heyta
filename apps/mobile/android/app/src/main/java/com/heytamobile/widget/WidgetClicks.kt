package com.heytamobile.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.heytamobile.MainActivity

/**
 * 四款组件共用的点击路径
 * ========================
 *
 * ============================================================
 * 为什么必须只有一处
 * ============================================================
 *
 * 这条路径上有三个**安全**相关的细节，每一个写错了都不会报错：
 *
 * 1. 🔴 **`taskId` 必须进 Intent 的 data URI，不能只放 extras。**
 *    `PendingIntent` 的相等性只看 **action / data / type / component / categories**，
 *    **不看 extras**。只靠 extras 区分两行，它们会被判定为**同一个** PendingIntent，
 *    `FLAG_UPDATE_CURRENT` 就让后一行**覆盖前一行的 extras** ——
 *    表现是"点第一行，改的是第二行"，且不报任何错。
 * 2. 🔴 **`FLAG_IMMUTABLE`（Android 12 起必须显式指定）。** 少了它，
 *    拿到这个 PendingIntent 的第三方**能改写里面的 extras** ——
 *    那就等于把"把任意任务标记完成"的能力递了出去。
 * 3. 🔴 **`android:exported="false"`**（在 manifest 里）。否则同一台设备上
 *    **任何**应用都能发一条伪造的 `ACTION_TOGGLE` 广播。启动器仍然点得动，
 *    因为点击走的是 **PendingIntent** —— 它的授权来自创建它的应用（我们），
 *    与 receiver 是否 exported 无关。这正是 PendingIntent 存在的意义。
 *
 * 这三点**任何一款组件漏掉一处**都是一个真实的漏洞。四份实现 = 四倍的机会。
 *
 * ⚠️ `check:widgets` 门禁**只扫 TS 侧**，原生这边没有自动门禁能拦住这些 ——
 * 所以"只有一份实现"在这里不是风格偏好，是**唯一**的保障手段。
 */
object WidgetClicks {

    /** 点击某一行的广播 action。四款组件共用 —— 语义就是"把某个任务翻到目标状态"。 */
    const val ACTION_TOGGLE = "com.heytamobile.widget.action.TOGGLE"

    const val EXTRA_TASK_ID = "com.heytamobile.widget.extra.TASK_ID"
    const val EXTRA_TARGET_IS_DONE = "com.heytamobile.widget.extra.TARGET_IS_DONE"

    /**
     * 一行的点击。**只发一条广播**，由该组件的 provider 接住并写意图队列 ——
     * 这里**不构造 op**（红线，见 [WidgetIntentQueues] 的类注释）。
     *
     * ⚠️ `authority` 每款组件不同（`toggle` / `quadrant-toggle` / …）。
     * 其实 `component` 不同就已经让 PendingIntent 不相等了，authority 只是**多一层**
     * 让"跨组件串台"不可能 —— 这类 bug 的排查成本远高于多写一个字符串。
     */
    fun toggle(
        context: Context,
        receiver: Class<*>,
        authority: String,
        taskId: String,
        targetIsDone: Boolean,
    ): PendingIntent {
        val intent = Intent(context, receiver).apply {
            action = ACTION_TOGGLE
            // 见类注释第 1 条：taskId 必须进 data，否则两行会共用一个 PendingIntent。
            data = Uri.Builder()
                .scheme("heyta-widget")
                .authority(authority)
                .appendPath(taskId)
                .build()
            putExtra(EXTRA_TASK_ID, taskId)
            putExtra(EXTRA_TARGET_IS_DONE, targetIsDone)
        }
        return PendingIntent.getBroadcast(
            context,
            0,
            intent,
            // 见类注释第 2 条。
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** 点头部 / 空白处打开应用。 */
    fun openApp(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}

/**
 * 四款组件 provider 的共同父类。
 *
 * ============================================================
 * 为什么要一个基类，而不是四个类各写一遍
 * ============================================================
 *
 * 四款组件**必须**是四个不同的 provider 类（`AppWidgetManager.updateAppWidget` 按
 * `ComponentName` 定位，而且每款要有自己的 `appwidget-provider` 元数据）。
 * 但"收到广播之后做什么"完全一样 —— 而那段代码里装着的正是
 * "把点击落成一条意图"这条安全敏感路径（见 [WidgetClicks] 的类注释）。
 *
 * 所以：**类分开（平台要求），逻辑合一（我们的要求）**。
 *
 * ## 🔴 这里绝不构造 op
 *
 * 点击只落成一条 `{taskId, targetIsDone}`。**意图 → op 是应用的事**。
 * 理由不是说"分层好看"，而是：组件手里的快照**可能已经过期**，
 * 用它判断"该不该执行"等于拿一个可能错的视图做决策。
 * 让目标状态**幂等**地传到应用那边，由应用对着**当时真实的**状态判断。
 */
abstract class BaseWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        // ⚠️ 刻意用"重画全部实例"而不是逐个 id：`updateAppWidget(ComponentName, views)`
        // 一次覆盖所有实例，少一处"漏掉某个实例"的可能。
        WidgetRefresh.pushAll(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == WidgetClicks.ACTION_TOGGLE) {
            handleToggle(context, intent)
            return
        }
        super.onReceive(context, intent)
    }

    /**
     * 把一次点击记进意图队列。
     *
     * ## 为什么数据坏了就 `return`（静默丢弃），不报错
     *
     * 这条路径上的一切都是**我们自己**写进 PendingIntent 的 —— 走到"拿不到 taskId"
     * 只可能是系统在极端情况下重建了 Intent。那时：
     *   - 抛异常 → `BroadcastReceiver` 崩，用户看到"Heyta 已停止运行"，而**点击本身没救了**；
     *   - 记一条空 taskId → 应用 drain 时会整队拒绝（`parseIntentQueueJson` 是整体拒绝），
     *     **把同一批里其它正常的点击一起丢掉**。
     *
     * 两种都比"丢掉这一次点击"更差。所以这里选择后者之外的第三条路：**只丢这一次**。
     *
     * ## 为什么同步 `commit()`（在主线程上）
     *
     * `onReceive` 返回之后系统**可能立刻杀掉进程**（`AppWidgetProvider` 就是在
     * `BroadcastReceiver` 里被唤醒的）。异步落盘（`apply()`）那时可能还没写完 ——
     * 用户的点击就无声地丢了。写一条意图是极低频、极小量的操作，
     * 这点阻塞远好过丢点击。理由同样记在 `WidgetKeyValueStore.commit()` 上。
     */
    private fun handleToggle(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(WidgetClicks.EXTRA_TASK_ID)
        if (taskId.isNullOrEmpty()) return

        val targetIsDone = intent.getBooleanExtra(WidgetClicks.EXTRA_TARGET_IS_DONE, false)
        val store = WidgetStore(SharedPreferencesWidgetStore(context))

        // Persist before returning to the launcher; reject stale clicks after cleanup.
        try {
            if (!store.appendIntentIfSnapshot(WidgetIntent(taskId, targetIsDone, System.currentTimeMillis()))) return
        } catch (error: Exception) {
            android.util.Log.w("HeytaWidget", "Could not persist widget click", error)
            return
        }

        // 🔴 只重画**收到广播的那个组件**，不是全部。
        //    用户在象限组件上点了一下，没有理由让习惯组件也重画一次 ——
        //    每多推一个 `RemoteViews` 就是多一次跨进程事务，而它在主线程上。
        WidgetRefresh.push(context, this::class.java)
    }
}
