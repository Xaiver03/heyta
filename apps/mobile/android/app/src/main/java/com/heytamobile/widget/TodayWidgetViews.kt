package com.heytamobile.widget

import android.content.Context
import android.widget.RemoteViews
import com.heytamobile.R

/**
 * 把 [TodayWidgetModel] 画成 `RemoteViews`。
 *
 * ## 这一层刻意没有任何判断
 *
 * "该显示什么"全在 [TodayWidgetModelBuilder] 与 [WidgetGate] 里（纯逻辑、有单测）。
 * 这里只做"照着抄" —— 因为 `RemoteViews` 在 JVM 单测里是**桩**（调用抛 `Stub!`），
 * 这一层**只能靠真机验证**，所以要把判断尽量挤出去。
 *
 * ⚠️ 行槽、头部、消息三段共用渲染在 [WidgetViewParts]；点击相关的常量与
 * `PendingIntent` 构造在 [WidgetClicks]（四款组件共用一处，那里装着三个不报错的
 * 安全细节：data URI、`FLAG_IMMUTABLE`、`exported="false"`）。
 * 这里只剩"今天这一栏怎么组织"。
 */
object TodayWidgetViews {

    /** 本款组件在 data URI 里的 authority。见 [WidgetClicks.toggle]。 */
    private const val AUTHORITY = "toggle"

    /** 供测试断言"模型里的行数够不够放"用。 */
    val ROW_SLOTS: Int get() = WidgetViewParts.ROW_COUNT

    fun render(context: Context, model: TodayWidgetModel): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_today)

        // 头部：能显示时给"日期 · 完成/总数"；占位与过期时**只给日期** ——
        // 显示 "9月27日 · 3/5" 会让人以为那是今天的进度。
        // 连信封都没有（dayStr == null）时**不显示头部**：没有可信的"哪一天"可说。
        WidgetViewParts.bindHeader(
            context,
            views,
            model.dayStr?.let { dayStr ->
                if (model.state == WidgetState.READY) {
                    context.getString(R.string.widget_header, dayStr, model.doneCount, model.totalCount)
                } else {
                    dayStr
                }
            },
        )

        WidgetViewParts.bindRows(context, views, model.rows, TodayWidgetProvider::class.java, AUTHORITY)

        WidgetViewParts.bindMessage(
            context,
            views,
            // ⚠️ 只有 READY 且真的 0 条才算"今天没有任务"。
            // 把"解不开密"也算成这一条，就是在**骗用户说今天没事** —— 见 `contentFor` 的注释。
            WidgetViewParts.statusMessage(model.state)
                ?: R.string.widget_message_no_tasks.takeIf { model.rows.isEmpty() },
        )

        return views
    }
}
