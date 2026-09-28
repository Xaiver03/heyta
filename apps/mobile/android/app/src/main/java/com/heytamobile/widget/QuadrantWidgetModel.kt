package com.heytamobile.widget

/**
 * 「四象限」组件的渲染模型。
 *
 * 与 [TodayWidgetModelBuilder] 同一套路：状态判定在 [WidgetGate]（四款共用），
 * 这里只算"能显示时，四个象限分别画成什么"。
 */

/**
 * 一个象限。
 *
 * [slot] 是契约里的槽位号字符串（`"1".."4"`），**不是**显示名 ——
 * 显示名是资源字符串（`widget_quadrant_1`…），四端各自本地化。
 */
data class QuadrantWidgetGroup(
    val slot: String,
    /** 该象限的任务总数（含已完成）。 */
    val total: Int,
    val done: Int,
    val rows: List<WidgetTaskRow>,
)

data class QuadrantWidgetModel(
    val state: WidgetState,
    val dayStr: String?,
    /** 恒为 4 个（`"1".."4"` 顺序固定）—— 即使某个象限是空的，也保留它的位置。 */
    val groups: List<QuadrantWidgetGroup>,
)

object QuadrantWidgetModelBuilder {

    /** 契约里的槽位号，顺序即显示顺序（与 `QUADRANT_META` 的 `quadrant-1..4` 一致）。 */
    val SLOTS: List<String> = listOf("1", "2", "3", "4")

    /**
     * 每个象限最多画几行。
     *
     * 取 2 的理由：四个象限 × 2 行 = 8 行 + 4 个标题，在 2×2 格（约 3×2 单元）的
     * 组件上已经开始挤。四象限组件的价值是**一眼看出哪一格堆着东西**，
     * 不是把每格都读全 —— 读全应该点进应用。
     */
    const val ROWS_PER_GROUP: Int = 2

    fun build(content: WidgetContent): QuadrantWidgetModel {
        val payload = content.payload
        if (payload == null) {
            return QuadrantWidgetModel(
                state = content.state,
                dayStr = content.dayStr,
                // 空列表 = 一个象限都不画。视图层据此走占位/过期文案。
                groups = emptyList(),
            )
        }

        // ⚠️ `quadrant` 整个键是可选的（没有任务落进任何象限时应用可以不发它）。
        //    缺席与"四个空象限"在渲染上应该**一样**（都是四个 0），所以统一成 emptyMap。
        val buckets = payload.quadrant ?: emptyMap()

        val groups = SLOTS.map { slot ->
            val tasks = buckets[slot].orEmpty()
            QuadrantWidgetGroup(
                slot = slot,
                total = tasks.size,
                done = tasks.count { WidgetGate.shownAsDone(it, content.targets) },
                rows = selectRows(tasks, content.targets),
            )
        }

        return QuadrantWidgetModel(
            state = WidgetState.READY,
            dayStr = content.dayStr,
            groups = groups,
        )
    }

    /**
     * 选要画的那几行：**未完成优先**，然后按载荷里的原始顺序。
     *
     * 为什么未完成优先：象限视图回答的是"这一格还堆着什么"。
     * 一格里有 3 条已完成、1 条未完成时，画前两条已完成等于**把唯一要看的藏起来**。
     *
     * ⚠️ 用 `sortedBy` 而不是 `sortedWith` 的稳定排序保证：同一组内先未完成后完成，
     * 组内相对顺序不变。`sortedBy` 在 Kotlin/JVM 上是稳定的，这里依赖了这一点 ——
     * 若哪天换实现，症状是"已完成的和未完成的混在一起"，不会报错。
     */
    private fun selectRows(
        tasks: List<WidgetTask>,
        targets: Map<String, Boolean>,
    ): List<WidgetTaskRow> =
        tasks
            .sortedBy { if (WidgetGate.shownAsDone(it, targets)) 1 else 0 }
            .take(ROWS_PER_GROUP)
            .map { task -> taskRow(task, targets) }
}
