package com.heytamobile.widget

import android.content.Context
import android.view.View
import android.widget.RemoteViews
import com.heytamobile.R

/**
 * 一个可点击的任务行 —— **今日任务与四象限共用同一个类型**。
 *
 * ## 为什么合成一个类型而不是各留一个
 *
 * 两个组件里的"一行任务"在语义上**完全是同一件事**：一个 id、一个标题、
 * 当前画成什么、点下去要什么目标状态。分成两个 `data class` 的唯一后果是
 * **行渲染逻辑也得跟着写两遍** —— 而那段逻辑里有几处不报错的细节
 *（可见性、`PendingIntent` 的 authority、完成/未完成的文案）。
 *
 * 重复的那一份迟早会漂移，表现是"象限组件里已完成的任务没有 ✓，今日组件里有"。
 */
data class WidgetTaskRow(
    val taskId: String,
    val title: String,
    /** **要显示成什么**（可能被待处理意图乐观叠加过）。 */
    val isDone: Boolean,
    /** **点击后要写进队列的目标状态**。与 [isDone] 相反 —— 点击就是翻到另一面。 */
    val targetIsDone: Boolean,
)

/** 由任务 + 乐观叠加算出该画成什么。四款组件**唯一**的转换处。 */
fun taskRow(task: WidgetTask, targets: Map<String, Boolean>): WidgetTaskRow {
    val shown = WidgetGate.shownAsDone(task, targets)
    return WidgetTaskRow(
        taskId = task.id,
        title = task.title,
        isDone = shown,
        targetIsDone = !shown,
    )
}

/**
 * 四款组件共用的视图零件。
 *
 * ## 🔴 为什么四个布局里的 id **故意取一样的名字**
 *
 * `RemoteViews` 是按 id 在**它自己那份布局**里查找的，所以不同布局使用同名 id
 * 完全合法。这么做换来的是：行槽、头部、消息这三段渲染逻辑**只有一份**。
 *
 * 代价是"看一眼 `widget_habits.xml` 不知道这些 id 还被谁用" —— 所以每个布局文件
 * 顶部都写了这一点，而这个对象是那些 id 的**唯一**声明处（[ROW_COUNT]）。
 *
 * ## 这一层刻意没有任何判断
 *
 * "该显示什么"全在各自的 `*ModelBuilder` 与 [WidgetGate] 里（纯逻辑、有单测）。
 * 这里只做"照着抄" —— 因为 `RemoteViews` 在 JVM 单测里是**桩**（调用抛 `Stub!`），
 * 这一层**只能靠真机验证**。
 */
object WidgetViewParts {

    /**
     * 行槽与视图 id。**顺序即渲染顺序**，改这里的顺序就是改四个组件的界面。
     *
     * 槽数固定是 `RemoteViews` 的限制（不能动态添加子视图）。
     * 选 5 的理由见 `res/layout/widget_today.xml` 顶部注释。
     */
    val ROW_VIEW_IDS = intArrayOf(
        R.id.widget_row_0,
        R.id.widget_row_1,
        R.id.widget_row_2,
        R.id.widget_row_3,
        R.id.widget_row_4,
    )

    /** 行槽数量。供测试断言"模型里的行数够不够放"用。 */
    val ROW_COUNT: Int get() = ROW_VIEW_IDS.size

    /**
     * 把行画进行槽。多余的槽隐藏（**不是留空** —— 留空会在组件底部留一片空白，
     * 看起来像渲染坏了）。
     */
    fun bindRows(
        context: Context,
        views: RemoteViews,
        rows: List<WidgetTaskRow>,
        receiver: Class<*>,
        authority: String,
    ) {
        for ((index, viewId) in ROW_VIEW_IDS.withIndex()) {
            bindRow(context, views, viewId, rows.getOrNull(index), receiver, authority)
        }
    }

    /**
     * 画**单独一行**（`row == null` 时隐藏该视图）。
     *
     * 抽出来是因为四象限组件的行不在那 5 个通用槽里 —— 它是"每个象限各有 2 个槽"
     * （见 `res/layout/widget_quadrant.xml`）。但"一行怎么画"必须**只有一份**：
     * 里面的可见性、完成/未完成文案、`PendingIntent` 的 authority 都有不报错的坑。
     */
    fun bindRow(
        context: Context,
        views: RemoteViews,
        viewId: Int,
        row: WidgetTaskRow?,
        receiver: Class<*>,
        authority: String,
    ) {
        if (row == null) {
            views.setViewVisibility(viewId, View.GONE)
            return
        }

        views.setViewVisibility(viewId, View.VISIBLE)
        views.setTextViewText(
            viewId,
            context.getString(
                if (row.isDone) R.string.widget_row_done else R.string.widget_row_todo,
                row.title,
            ),
        )
        views.setOnClickPendingIntent(
            viewId,
            WidgetClicks.toggle(
                context = context,
                receiver = receiver,
                authority = authority,
                taskId = row.taskId,
                targetIsDone = row.targetIsDone,
            ),
        )
    }

    /**
     * 画**只读**的行：点了**打开应用**，不写意图队列。
     *
     * ## 什么时候必须用它（🔴 用错了会静默丢数据）
     *
     * 只有**任务**能通过意图队列回写（队列元素是 `{taskId, targetIsDone}`）。
     * 别的实体（比如习惯打卡）**假装**成任务塞进去，`drainWidgetIntents` 会拿那个 id
     * 去任务表里查、查不到 → 归类为 `skippedMissing` → **丢弃**。
     * 用户以为打卡成功了，应用这边**什么都没发生，也没有任何日志**。
     *
     * 所以不可回写的东西一律走这里 —— 见 [HabitsWidgetModel] 的类注释。
     */
    fun bindReadOnlyRows(
        context: Context,
        views: RemoteViews,
        rows: List<ReadOnlyRow>,
    ) {
        val openApp = WidgetClicks.openApp(context)
        for ((index, viewId) in ROW_VIEW_IDS.withIndex()) {
            val row = rows.getOrNull(index)
            if (row == null) {
                views.setViewVisibility(viewId, View.GONE)
                continue
            }
            views.setViewVisibility(viewId, View.VISIBLE)
            views.setTextViewText(viewId, context.getString(row.textRes, row.title))
            views.setOnClickPendingIntent(viewId, openApp)
        }
    }

    /** 一行只读内容。[textRes] 决定前缀符号（已完成 / 未完成）。 */
    data class ReadOnlyRow(val title: String, val textRes: Int)

    /**
     * 画那条共用消息（占位 / 过期 / 空列表）。
     *
     * `messageRes == null` 时隐藏。⚠️ 传 `null` 而不是"随便挑一条"很重要：
     * 把"解不开密"画成"今天没有任务"就是在**骗用户**。
     */
    fun bindMessage(context: Context, views: RemoteViews, messageRes: Int?) {
        if (messageRes == null) {
            views.setViewVisibility(R.id.widget_message, View.GONE)
        } else {
            views.setViewVisibility(R.id.widget_message, View.VISIBLE)
            views.setTextViewText(R.id.widget_message, context.getString(messageRes))
        }
    }

    /**
     * 画头部并绑"打开应用"。
     *
     * `text == null` 时隐藏头部 —— 连信封都没有时**没有可信的"哪一天"可说**，
     * 画一个空标题或者今天的日期都是在无中生有。
     */
    fun bindHeader(context: Context, views: RemoteViews, text: String?) {
        if (text == null) {
            views.setViewVisibility(R.id.widget_header, View.GONE)
            return
        }
        views.setViewVisibility(R.id.widget_header, View.VISIBLE)
        views.setTextViewText(R.id.widget_header, text)
        views.setOnClickPendingIntent(R.id.widget_header, WidgetClicks.openApp(context))
    }

    /**
     * 把"占位 / 过期"翻译成文案。**四款组件共用**，所以"数据已过期"这句话
     * 在四款里一定一致。
     *
     * ⚠️ 只有 [WidgetState.READY] 才返回 `null`（= 调用方自己决定空列表文案）。
     * 非 READY 一律给出一条消息、**绝不给数据**。
     */
    fun statusMessage(state: WidgetState): Int? = when (state) {
        WidgetState.PLACEHOLDER -> R.string.widget_message_open_app
        WidgetState.STALE -> R.string.widget_message_stale
        WidgetState.READY -> null
    }
}
