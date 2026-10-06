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
            val launch = Intent(context, com.heytamobile.MainActivity::class.java)
                .setData(Uri.Builder().scheme("heyta").authority("reminder-open").appendPath(id).build())
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
