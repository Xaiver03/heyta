package com.heytamobile.widget

import android.content.Context
import android.view.View
import android.widget.RemoteViews
import com.heytamobile.R

/**
 * 把 [FocusWidgetModel] 画成 `RemoteViews`。
 *
 * 🔴 **这里没有倒计时** —— 理由见 [FocusWidgetModel] 的类注释：
 * 契约里的 `remainingSeconds` 是**发布那一刻**的快照值，没有绝对时间锚点，
 * 画出来就是"看起来对、其实是错的"。所以这里只画**不会随时间变**的事实：
 * 会话标题 + 目标时长。
 */
object FocusWidgetViews {

    fun render(context: Context, model: FocusWidgetModel): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_focus)

        WidgetViewParts.bindHeader(
            context,
            views,
            model.dayStr?.let { dayStr ->
                // 头部**永远只有日期**：专注组件没有"完成 x/y"这种进度可说，
                // 而"专注中"是正文的事（见下），不是头部的事。
                dayStr
            },
        )

        when (model.state) {
            FocusWidgetState.ACTIVE -> {
                // 会话标题：契约里可为空（用户常常不填）—— 给一条通用标题，
                // 而不是画一个空字符串（那看起来像渲染坏了）。
                views.setViewVisibility(R.id.widget_focus_title, View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_focus_title,
                    model.sessionTitle?.takeIf { it.isNotBlank() }
                        ?: context.getString(R.string.widget_focus_untitled),
                )

                // ⚠️ 目标时长是**可选**的，所以"设文本"必须在"确认非空"里面 ——
                //    写成 `setTextViewText(id, model.targetSeconds?.let{…})` 会把
                //    `null` 递给一个非空参数（Kotlin 编译期就报错；Java 侧则是崩溃）。
                //    没有目标秒数时**隐藏这一行**，不要显示"目标 --"。
                val targetSeconds = model.targetSeconds
                if (targetSeconds == null) {
                    views.setViewVisibility(R.id.widget_focus_target, View.GONE)
                } else {
                    views.setViewVisibility(R.id.widget_focus_target, View.VISIBLE)
                    views.setTextViewText(
                        R.id.widget_focus_target,
                        // 目标时长是**静态事实**（"这一轮定的是 25 分钟"），过多久都不会过期。
                        // `+ 30` 是**四舍五入到分钟**：90 秒该显示"目标 2 分钟"，
                        // 而截断会显示 1 分钟。目标时长本来就是分钟级的量，
                        // 少一分钟会让用户以为设错了。
                        context.getString(R.string.widget_focus_target, (targetSeconds + 30) / 60),
                    )
                }
            }
            FocusWidgetState.IDLE -> {
                views.setViewVisibility(R.id.widget_focus_title, View.GONE)
                views.setViewVisibility(R.id.widget_focus_target, View.GONE)
            }
            // 占位/过期时**什么都不画** —— 视图层不显示任何专注信息。
            FocusWidgetState.PLACEHOLDER, FocusWidgetState.STALE -> {
                views.setViewVisibility(R.id.widget_focus_title, View.GONE)
                views.setViewVisibility(R.id.widget_focus_target, View.GONE)
            }
        }

        // 点击整块打开应用：专注的启停只能在应用里做（本轮不做契约变更，见模型注释）。
        views.setOnClickPendingIntent(R.id.widget_focus_body, WidgetClicks.openApp(context))

        WidgetViewParts.bindMessage(
            context,
            views,
            when (model.state) {
                FocusWidgetState.PLACEHOLDER -> R.string.widget_message_open_app
                FocusWidgetState.STALE -> R.string.widget_message_stale
                FocusWidgetState.IDLE -> R.string.widget_focus_idle
                // ACTIVE 时只有在"目标时长那一行被隐藏"的情况下才有话可说 ——
                // 而那时正文已经够清楚了，所以不给消息。
                FocusWidgetState.ACTIVE -> null
            },
        )

        WidgetViewParts.applyTheme(
            context,
            views,
            R.id.widget_root,
            intArrayOf(
                R.id.widget_header,
                R.id.widget_focus_title,
            ),
            mutedTextIds = intArrayOf(R.id.widget_focus_target, R.id.widget_message),
        )

        return views
    }
}
