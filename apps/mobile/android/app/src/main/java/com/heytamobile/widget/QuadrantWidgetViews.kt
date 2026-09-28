package com.heytamobile.widget

import android.content.Context
import android.widget.RemoteViews
import com.heytamobile.R

/**
 * 把 [QuadrantWidgetModel] 画成 `RemoteViews`。
 *
 * ⚠️ 与其它三款不同，这款的点阵是**每象限 2 个固定槽**，而不是那 5 个通用行槽 ——
 * 见 `res/layout/widget_quadrant.xml` 顶部注释。判断仍然全在
 * [QuadrantWidgetModelBuilder] 与 [WidgetGate] 里；这里只做"照着抄"。
 */
object QuadrantWidgetViews {

    /** 本款组件在 data URI 里的 authority。见 [WidgetClicks.toggle]。 */
    private const val AUTHORITY = "quadrant-toggle"

    /** 一个象限的视图 id 组合。顺序与 [QuadrantWidgetModelBuilder.SLOTS] 必须一致。 */
    private class Group(val headerId: Int, val labelRes: Int, val rowIds: IntArray)

    private val GROUPS = arrayOf(
        Group(
            headerId = R.id.widget_quadrant_1_header,
            labelRes = R.string.widget_quadrant_1,
            rowIds = intArrayOf(R.id.widget_quadrant_1_row_0, R.id.widget_quadrant_1_row_1),
        ),
        Group(
            headerId = R.id.widget_quadrant_2_header,
            labelRes = R.string.widget_quadrant_2,
            rowIds = intArrayOf(R.id.widget_quadrant_2_row_0, R.id.widget_quadrant_2_row_1),
        ),
        Group(
            headerId = R.id.widget_quadrant_3_header,
            labelRes = R.string.widget_quadrant_3,
            rowIds = intArrayOf(R.id.widget_quadrant_3_row_0, R.id.widget_quadrant_3_row_1),
        ),
        Group(
            headerId = R.id.widget_quadrant_4_header,
            labelRes = R.string.widget_quadrant_4,
            rowIds = intArrayOf(R.id.widget_quadrant_4_row_0, R.id.widget_quadrant_4_row_1),
        ),
    )

    /** 每个象限的槽数。供测试断言"模型给的行数没超出槽数"用。 */
    val ROWS_PER_GROUP_SLOTS: Int get() = GROUPS[0].rowIds.size

    fun render(context: Context, model: QuadrantWidgetModel): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_quadrant)

        // 头部只放日期：四个象限各有各的进度，一个总进度放在顶上会让人以为
        // 那说的是某一个象限。占位/过期时本来也没有进度可说。
        WidgetViewParts.bindHeader(context, views, model.dayStr)

        // ⚠️ `groups` 在占位/过期时**是空的** —— 于是这里自然什么都不画。
        // 这正是我们要的：过期时四个象限一个都不能显示。
        for ((index, group) in GROUPS.withIndex()) {
            val data = model.groups.getOrNull(index)

            // 象限标题**始终显示**（连 0 也显示）：四象限的价值就是那个 2×2 的格局，
            // 藏掉空格会让人以为这个象限不存在。
            views.setTextViewText(
                group.headerId,
                context.getString(
                    R.string.widget_quadrant_header,
                    context.getString(group.labelRes),
                    data?.done ?: 0,
                    data?.total ?: 0,
                ),
            )

            for ((slot, rowId) in group.rowIds.withIndex()) {
                WidgetViewParts.bindRow(
                    context = context,
                    views = views,
                    viewId = rowId,
                    row = data?.rows?.getOrNull(slot),
                    receiver = QuadrantWidgetProvider::class.java,
                    authority = AUTHORITY,
                )
            }
        }

        WidgetViewParts.bindMessage(
            context,
            views,
            // ⚠️ 只有"四个象限全空"才算没有任务。某一格空是**正常状态**，不该出提示。
            WidgetViewParts.statusMessage(model.state)
                ?: R.string.widget_message_no_tasks.takeIf { model.groups.all { it.total == 0 } },
        )

        return views
    }
}
