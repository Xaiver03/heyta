package com.heytamobile.widget

import android.content.Context
import android.widget.RemoteViews
import com.heytamobile.R

/**
 * 把 [HabitsWidgetModel] 画成 `RemoteViews`。
 *
 * 🔴 **行是只读的**（点一下打开应用，不写意图队列）——
 * 理由见 [HabitsWidgetModel] 的类注释：意图队列只能表达"任务"，
 * 把习惯伪装成任务会让 `drainWidgetIntents` 静默丢弃。
 */
object HabitsWidgetViews {

    fun render(context: Context, model: HabitsWidgetModel): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_habits)

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

        WidgetViewParts.bindReadOnlyRows(
            context,
            views,
            model.rows.map { habit ->
                WidgetViewParts.ReadOnlyRow(
                    // `title` 是**已经拼好**的正文（`名称` 或 `名称 · 连续 N 天`）；
                    // `textRes` 只决定前缀符号（✓ / ○）——
                    // `bindReadOnlyRows` 会做 `getString(textRes, title)`，
                    // 所以两段拼装不会互相覆盖。
                    title = habitRowText(context, habit),
                    textRes = if (habit.doneToday) R.string.widget_row_done else R.string.widget_row_todo,
                )
            },
        )

        WidgetViewParts.bindMessage(
            context,
            views,
            WidgetViewParts.statusMessage(model.state)
                ?: R.string.widget_habits_empty.takeIf { model.totalCount == 0 },
        )

        WidgetViewParts.applyTheme(
            context,
            views,
            R.id.widget_root,
            intArrayOf(R.id.widget_header, R.id.widget_row_0, R.id.widget_row_1, R.id.widget_row_2,
                R.id.widget_row_3, R.id.widget_row_4),
            mutedTextIds = intArrayOf(R.id.widget_message),
        )

        return views
    }

    /**
     * 习惯行的标题文本：`名称` 或 `名称 · 连续 N 天`。
     *
     * 天数只在 [HabitsWidgetModel] 里已经夹成非负之后才拼，且 **0 天不显示** ——
     * "连续 0 天"不是信息，是噪声。
     */
    private fun habitRowText(context: Context, habit: HabitsWidgetRow): String =
        if (habit.streak > 0) {
            context.getString(R.string.widget_habit_row, habit.title, habit.streak)
        } else {
            habit.title
        }
}
