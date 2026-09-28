package com.heytamobile.widget

/**
 * 今天列表组件的**渲染模型** —— 纯逻辑，不碰任何 Android 视图 API。
 *
 * ============================================================
 * 为什么要有这一层（不是"为了好看"）
 * ============================================================
 *
 * `RemoteViews` 在 JVM 单测里是**桩**（调用抛 `Stub!`），所以"组件该显示什么"
 * 如果直接写在 `AppWidgetProvider` 里，就**只能靠真机验证** ——
 * 而这里面每一条规则错了都会把**错误的数据画在用户桌面上**
 *（用户没有理由怀疑它）。所以决策留在这一层，视图层只做"照着抄"。
 *
 * ⚠️ **"能不能显示"的判定不在这里**，在 [WidgetGate] 里 —— 四款组件共用一处，
 * 理由见那个文件的类注释。这里只负责"能显示时，今天这一栏画成什么"。
 *
 * ## 🔴 这里产生不了 op
 *
 * 行上带的是 [TodayWidgetRow.targetIsDone]（**目标状态**），不是"切换"这个动作。
 * 点一下只是把这条目标写进意图队列，**变成 op 是应用侧的事**。
 * 动作在过期视图上会算错：用户看到未完成、实际已完成，点一下变成"标记完成" = 没有变化；
 * 而目标状态是幂等的。
 */

data class TodayWidgetModel(
    val state: WidgetState,
    /** 快照对应的"今天"。占位且连信封都没有时为 `null`。 */
    val dayStr: String?,
    val rows: List<WidgetTaskRow>,
    val doneCount: Int,
    val totalCount: Int,
)

object TodayWidgetModelBuilder {

    /**
     * @param content [WidgetGate.resolve] 的结果。[WidgetContent.payload] 只在
     *   `READY` 时非 `null` —— 所以**过期时这里拿不到数据**，
     *   不可能把昨天的任务画出来（那是刻意的，见 [WidgetGate] 的类注释）。
     */
    fun build(content: WidgetContent): TodayWidgetModel {
        val payload = content.payload
        if (payload == null) {
            return TodayWidgetModel(
                state = content.state,
                dayStr = content.dayStr,
                // 刻意 **不给行**：占位与过期都没有可信内容可说。
                rows = emptyList(),
                doneCount = 0,
                totalCount = 0,
            )
        }

        // 不在这里做 `take(WIDGET_MAX_TASKS)`：条数上限是**解析器的判据**
        //（超过 20 条整体拒绝），在这里再截一刀会把一次契约违例
        // **掩盖**成"正常显示 20 条"。
        val rows = payload.today.map { task -> taskRow(task, content.targets) }

        return TodayWidgetModel(
            state = WidgetState.READY,
            dayStr = content.dayStr,
            rows = rows,
            doneCount = rows.count { it.isDone },
            totalCount = rows.size,
        )
    }
}
