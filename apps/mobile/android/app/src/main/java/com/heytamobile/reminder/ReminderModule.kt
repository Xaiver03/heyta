package com.heytamobile.reminder

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseJavaModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/** Platform delivery only. Durable receipts are acknowledged after JS commits the op. */
class ReminderModule(private val context: ReactApplicationContext) : BaseJavaModule() {
    override fun getName(): String = NAME

    @ReactMethod
    fun authorizationStatus(promise: Promise) {
        promise.resolve(authorization(context))
    }

    @ReactMethod
    fun requestAuthorization(promise: Promise) {
        if (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) {
            promise.resolve(authorization(context))
            return
        }
        context.runOnUiQueueThread {
            val activity = context.currentActivity
            if (activity == null) {
                promise.resolve("default")
            } else {
                val shouldRequest = synchronized(STATE_LOCK) {
                    pendingAuthorizations.add(promise)
                    pendingAuthorizations.size == 1
                }
                if (shouldRequest) activity.requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), REQUEST_CODE)
            }
        }
    }

    /**
     * `AlarmManager.canScheduleExactAlarms()` 那一档。
     *
     * Android 12（API 31）之前**没有这道门**：精确闹钟是装即有的能力，所以回 `granted`
     * 而不是 `unsupported` —— 回 `unsupported` 会让界面把"系统压根不管"读成"读不到"，
     * 而那是两句话（界面要分清"这里没有可拨的开关"与"这里可能坏了"）。
     */
    @ReactMethod
    fun exactAlarmStatus(promise: Promise) {
        if (Build.VERSION.SDK_INT < 31) {
            promise.resolve("granted")
            return
        }
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        promise.resolve(if (alarm.canScheduleExactAlarms()) "granted" else "denied")
    }

    /**
     * 拉「创建精确闹钟」那一页（`ACTION_REQUEST_SCHEDULE_EXACT_ALARM`）。
     *
     * ⚠️ 只由设置页那一行**在用户手势里**触发；启动流程一律不调。
     * 那一页是设置页，**不给应用回调**，所以本方法只回答"页面起来了吗"。
     * API 31 以下回 `false`：那一页在这个系统版本上不存在。
     */
    @ReactMethod
    fun requestExactAlarmPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT < 31) {
            promise.resolve(false)
            return
        }
        promise.resolve(launch(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
            .setData(Uri.fromParts("package", context.packageName, null))))
    }

    /** 系统「通知」总开关那一档（授权之外还有它：关掉时 toast 一律不显示）。 */
    @ReactMethod
    fun notificationSettingsStatus(promise: Promise) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        promise.resolve(if (manager.areNotificationsEnabled()) "granted" else "denied")
    }

    /** 跳系统的应用通知设置页。API 26 以下没有那个 action，退到应用信息页。 */
    @ReactMethod
    fun openNotificationSettings(promise: Promise) {
        if (Build.VERSION.SDK_INT >= 26) {
            promise.resolve(launch(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)))
            return
        }
        promise.resolve(openPackagePage())
    }

    /**
     * 「忽略电池优化」那一档。
     *
     * Android 6（API 23）之前没有电池优化这套机制 ⇒ 同 `exactAlarmStatus` 的理由回
     * `granted`（"系统不限制"），而不是"读不到"。
     */
    @ReactMethod
    fun batteryOptimizationStatus(promise: Promise) {
        if (Build.VERSION.SDK_INT < 23) {
            promise.resolve("granted")
            return
        }
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        promise.resolve(if (power.isIgnoringBatteryOptimizations(context.packageName)) "granted" else "denied")
    }

    /**
     * 跳电池优化白名单页，把**落点**回给 JS：`'requested' | 'appSettings' | 'unavailable'`。
     *
     * 🔴 部分国产 ROM 把 `IgnoreBatteryOptimizationSettings` 那个组件摘掉了
     * （`resolveActivity` 找得到但启动即抛，或压根找不到）。那种机器上退到**应用信息页**
     * 是诚实的落点，那一页上通常能翻到省电策略；但界面**不许**把这一跳说成
     * "已经向系统要过豁免" —— 用户在那里看到的不是一个叫"忽略电池优化"的开关。
     * ⚠️ 这条 intent 需要清单里的 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`（normal 级）；
     * 没有它系统会 SecurityException 拒掉 —— 那正是"声明它"的唯一用途。
     */
    @ReactMethod
    fun openBatteryOptimizationSettings(promise: Promise) {
        if (Build.VERSION.SDK_INT < 23) {
            promise.resolve("unavailable")
            return
        }
        val requested = launch(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.fromParts("package", context.packageName, null)))
        promise.resolve(when {
            requested -> "requested"
            openPackagePage() -> "appSettings"
            else -> "unavailable"
        })
    }

    /** 从非 Activity 上下文起系统设置页：带 NEW_TASK，起不来如实回 false。 */
    private fun launch(intent: Intent): Boolean = try {
        val activity = context.currentActivity
        if (activity != null) {
            activity.startActivity(intent)
        } else {
            context.applicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        true
    } catch (error: Exception) {
        android.util.Log.i(NAME, "reminder settings page unavailable: ${error.javaClass.simpleName}")
        false
    }

    private fun openPackagePage(): Boolean = launch(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
    )

    @ReactMethod
    fun schedule(id: String, atMs: Double, title: String, body: String, promise: Promise) {
        try {
            require(id.isNotEmpty() && atMs.isFinite() && atMs > 0) { "Invalid reminder request" }
            synchronized(STATE_LOCK) {
                ensureChannel(context, title)
                if (authorization(context) != "granted") {
                    promise.resolve(false)
                    return
                }
                val prefs = preferences(context)
                // A replayed reconciliation must not republish an occurrence already
                // delivered, including one dismissed by the user before JS resumed.
                if (ids(prefs, KEY_DELIVERED).contains(id) || ids(prefs, KEY_POSTED).contains(id)) {
                    promise.resolve(true)
                    return
                }
                val scheduled = ids(prefs, KEY_SCHEDULED)
                scheduled.add(id)
                persist(prefs.edit().putStringSet(KEY_SCHEDULED, scheduled))
                val intent = alarmIntent(context, id)
                    .putExtra(EXTRA_TITLE, title).putExtra(EXTRA_BODY, body)
                val pending = PendingIntent.getBroadcast(context, 0, intent, FLAGS)
                val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val triggerAt = atMs.toLong().coerceAtLeast(System.currentTimeMillis() + 250L)
                if (Build.VERSION.SDK_INT < 31 || alarm.canScheduleExactAlarms()) {
                    alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
                } else {
                    alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
                }
                promise.resolve(true)
            }
        } catch (error: Exception) {
            promise.reject("E_REMINDER_SCHEDULE", error)
        }
    }

    @ReactMethod
    fun cancel(id: String, promise: Promise) {
        try {
            synchronized(STATE_LOCK) { cancelLocked(context, setOf(id)) }
            promise.resolve(true)
        } catch (error: Exception) { promise.reject("E_REMINDER_CANCEL", error) }
    }

    @ReactMethod
    fun cancelStale(keepIds: ReadableArray, pendingIds: ReadableArray, promise: Promise) {
        try {
            val keep = readIds(keepIds)
            synchronized(STATE_LOCK) {
                val prefs = preferences(context)
                val all = ids(prefs, KEY_SCHEDULED) + ids(prefs, KEY_POSTED) + ids(prefs, KEY_DELIVERED)
                cancelLocked(context, all - keep)
                val stalePending = ids(prefs, KEY_SCHEDULED) - readIds(pendingIds)
                val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                stalePending.forEach { id ->
                    val pending = PendingIntent.getBroadcast(context, 0, alarmIntent(context, id), FLAGS)
                    alarms.cancel(pending)
                    pending.cancel()
                }
                persist(prefs.edit().putStringSet(KEY_SCHEDULED, ids(prefs, KEY_SCHEDULED) - stalePending))
            }
            promise.resolve(true)
        } catch (error: Exception) { promise.reject("E_REMINDER_CANCEL", error) }
    }

    @ReactMethod
    fun peekDelivered(promise: Promise) {
        synchronized(STATE_LOCK) {
            val array = Arguments.createArray()
            ids(preferences(context), KEY_DELIVERED).forEach(array::pushString)
            promise.resolve(array)
        }
    }

    @ReactMethod
    fun acknowledgeDelivered(values: ReadableArray, promise: Promise) {
        try {
            synchronized(STATE_LOCK) {
                val prefs = preferences(context)
                val remaining = ids(prefs, KEY_DELIVERED) - readIds(values)
                persist(prefs.edit().putStringSet(KEY_DELIVERED, remaining))
            }
            promise.resolve(true)
        } catch (error: Exception) { promise.reject("E_REMINDER_ACK", error) }
    }

    companion object {
        const val NAME = "HeytaReminder"
        const val ACTION = "com.heyta.action.REMINDER"
        const val CHANNEL = "heyta.reminders"
        const val PREFS = "heyta.reminders"
        const val KEY_DELIVERED = "delivered"
        const val KEY_SCHEDULED = "scheduled"
        const val KEY_POSTED = "posted"
        const val EXTRA_ID = "id"
        const val EXTRA_TITLE = "title"
        const val EXTRA_BODY = "body"
        /** API 31 起才有；低版本系统不会发，注册着无害。 */
        const val ACTION_EXACT_ALARM_PERMISSION_CHANGED =
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
        private const val REQUEST_CODE = 19041
        private const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val STATE_LOCK = Any()
        private val pendingAuthorizations = mutableListOf<Promise>()

        fun resolvePermissionResult(requestCode: Int, grantResults: IntArray) {
            if (requestCode != REQUEST_CODE) return
            val promises = synchronized(STATE_LOCK) {
                pendingAuthorizations.toList().also { pendingAuthorizations.clear() }
            }
            promises.forEach { it.resolve(if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) "granted" else "denied") }
        }

        fun preferences(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        fun ids(prefs: SharedPreferences, key: String): MutableSet<String> = prefs.getStringSet(key, emptySet()).orEmpty().toMutableSet()
        fun persist(editor: SharedPreferences.Editor) {
            check(editor.commit()) { "Cannot persist reminder receipt" }
        }

        fun authorization(context: Context): String {
            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return "default"
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (!manager.areNotificationsEnabled()) return "denied"
            if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return "denied"
            return "granted"
        }

        /**
         * 系统把我们排过的闹钟清了（开机），或者"能不能排精确闹钟"这道门变了
         * （用户在系统页里拨了一下开关）⇒ 忘掉"我已经排过了"这份缓存。
         *
         * 🔴 只清 `scheduled`。`delivered` 是**还没写成 op 的投递回执**，清掉它等于
         * 把已经弹给用户的那一条删账 —— 它会再弹一遍而 `firedAt` 永远补不上。
         * `posted` 留着：它挡的是"同一次到点在 JS 回前台之前重复投递"，而重启后系统
         * 横幅本来就已经没了；这里的风险对比是"少弹一次"对"这条提醒从此再也不响"，
         * 后者才是开机重排要修的那个洞。
         *
         * ⚠️ 为什么不在这里直接重排：排哪几条、什么时候排、已 fired 算不算 ——
         * 全是业务语义（AGENTS §3.5），事实源在 `packages/app-host` 的
         * `planNativeReminders`。这个缓存一清，JS 下一次回前台的 reconcile 就会
         * 把它重新排一遍，而那一趟用的是同一份领域判定。
         */
        fun invalidateArmedCache(context: Context) {
            synchronized(STATE_LOCK) {
                val prefs = preferences(context)
                persist(prefs.edit().putStringSet(KEY_SCHEDULED, emptySet()))
            }
        }

        fun ensureChannel(context: Context, title: String) {
            if (Build.VERSION.SDK_INT >= 26) {
                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.createNotificationChannel(NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_DEFAULT))
            }
        }

        private fun readIds(values: ReadableArray): Set<String> = buildSet {
            for (index in 0 until values.size()) values.getString(index)?.let(::add)
        }
        private fun alarmIntent(context: Context, id: String): Intent = Intent(ACTION, null, context, ReminderReceiver::class.java)
            .setData(Uri.Builder().scheme("heyta").authority("reminder").appendPath(id).build())
            .putExtra(EXTRA_ID, id)

        private fun cancelLocked(context: Context, stale: Set<String>) {
            val prefs = preferences(context)
            // Invalidate queued broadcasts before touching OS state. Receiver and
            // JS native calls share the lock, so a cancelled occurrence cannot post.
            persist(prefs.edit()
                .putStringSet(KEY_SCHEDULED, ids(prefs, KEY_SCHEDULED) - stale)
                .putStringSet(KEY_POSTED, ids(prefs, KEY_POSTED) - stale)
                .putStringSet(KEY_DELIVERED, ids(prefs, KEY_DELIVERED) - stale))
            val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            stale.forEach { id ->
                val pending = PendingIntent.getBroadcast(context, 0, alarmIntent(context, id), FLAGS)
                alarms.cancel(pending)
                pending.cancel()
                notifications.cancel(id, 0)
            }
        }
    }
}

class ReminderReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(ReminderModule.EXTRA_ID) ?: return
        val title = intent.getStringExtra(ReminderModule.EXTRA_TITLE) ?: return
        val body = intent.getStringExtra(ReminderModule.EXTRA_BODY) ?: return
        synchronized(ReminderModule.STATE_LOCK) {
            val prefs = ReminderModule.preferences(context)
            val scheduled = ReminderModule.ids(prefs, ReminderModule.KEY_SCHEDULED)
            if (!scheduled.contains(id)) return
            ReminderModule.ensureChannel(context, title)
            if (ReminderModule.authorization(context) != "granted") return
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            /* 点横幅只做一件**已经兑现**的事：把应用带到前台。
             *
             * 🔴 这里原先挂着一枚 `heyta://reminder-open/<id>` 的 data URI，而全仓
             *    没有任何一处读它（既没有 intent-filter 认领这个 scheme，也没有
             *    `Linking` 的订阅方）—— 那是"能力被写进声明却不存在"的形状：
             *    读代码的人会以为点通知会直达那条任务。要让它成立，缺的是两件，
             *    少一件都不算：① 清单里 `heyta` scheme 的 intent-filter（Android 侧
             *    RN 才会把 URL 递给 JS）；② JS 侧一个把 taskId 变成"打开那一格详情"
             *    的订阅方。两者都属于"通知直达"这一项独立工作，不在投递路径上打洞。
             * ⚠️ 到点提醒在应用打开之后仍然会走到用户面前：`App.tsx` 那个
             *    AppState 'active' 的 reconcile 会把已过点没投递的补齐。 */
            val launch = Intent(context, com.heytamobile.MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val click = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = if (Build.VERSION.SDK_INT >= 26) android.app.Notification.Builder(context, ReminderModule.CHANNEL)
                else { @Suppress("DEPRECATION") android.app.Notification.Builder(context) }
            val notification = builder.setSmallIcon(com.heytamobile.R.mipmap.ic_launcher)
                .setContentTitle(title).setContentText(body).setContentIntent(click).setAutoCancel(true).build()
            // Full occurrence IDs are tags. String.hashCode collisions must never
            // cause one reminder to replace another notification.
            manager.notify(id, 0, notification)
            val delivered = ReminderModule.ids(prefs, ReminderModule.KEY_DELIVERED).apply { add(id) }
            val posted = ReminderModule.ids(prefs, ReminderModule.KEY_POSTED).apply { add(id) }
            scheduled.remove(id)
            ReminderModule.persist(prefs.edit().putStringSet(ReminderModule.KEY_DELIVERED, delivered)
                .putStringSet(ReminderModule.KEY_POSTED, posted).putStringSet(ReminderModule.KEY_SCHEDULED, scheduled))
        }
    }
}

/**
 * 「系统那边的前提变了」这一类广播的共同实现（授权变化 / 开机 / 应用被更新）。
 *
 * 🔴 两个子类都**只清一份缓存**：不读任务数据、不排闹钟、不取消闹钟、不写任何内容。
 * 这一点是 `exported="true"` 站得住的全部依据（清单里那段注释讲的就是它）——
 * 伪造这条广播的后果最多是"下一次回前台多做一次它本来每次都会做的 reconcile"。
 * 哪天有人往这里加了"直接改排程"的逻辑，那段论证立刻失效：正确做法是把它踢回 JS，
 * 不是把 exported 改掉（改掉就再也收不到系统广播，等于这条腿白做）。
 */
abstract class ReminderWakeupReceiver(private val expectedAction: String) : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != expectedAction) return
        ReminderModule.invalidateArmedCache(context)
    }
}

/** 用户在系统页里拨了「创建精确闹钟」这道门 ⇒ 之前按老能力排的那批要重排。 */
class ExactAlarmPermissionReceiver : ReminderWakeupReceiver(ReminderModule.ACTION_EXACT_ALARM_PERMISSION_CHANGED)

/**
 * 开机。Android 会清掉所有排程，而这份 prefs 是活的 —— 不抹缓存的话，
 * `schedule()` 会以为"这条已经排过了"而永远不再排（真丢提醒，不是晚一点）。
 *
 * ⚠️ 用 `BOOT_COMPLETED` 而不是 `LOCKED_BOOT_COMPLETED`：设备未解锁时
 * SharedPreferences 根本读不到，在那里跑只会拿到一份假的空缓存。
 */
class ReminderBootReceiver : ReminderWakeupReceiver(Intent.ACTION_BOOT_COMPLETED)

/**
 * 应用升级/覆盖安装。这条路同样会清掉系统替我们排的全部闹钟。
 *
 * ⚠️ 只登记 `MY_PACKAGE_REPLACED`，不登记 `PACKAGE_REPLACED` —— 后者是**全局**广播
 * （任何一次包替换都会发），需要 `android.permission.STATUS_BAR_SERVICE` 级别的
 * 系统权限或运行期注册，而对本应用的更新来说 `MY_PACKAGE_REPLACED` 就是那一条
 * 定向给自己的（也是 Android 官方在 24 之后推荐的那条）。
 */
class ReminderReplacedReceiver : ReminderWakeupReceiver(Intent.ACTION_MY_PACKAGE_REPLACED)
