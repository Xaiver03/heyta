package com.heytamobile.widget

/**
 * 「今日习惯」组件的渲染模型。
 *
 * ============================================================
 * 🔴 这款组件的行**不可点击** —— 这不是没做完，是契约里没有这个东西
 * ============================================================
 *
 * 意图队列（[WidgetIntentQueue]）的元素是 `{ taskId, targetIsDone, at }` ——
 * 它表达的是"**把这个任务**翻到某个完成状态"。习惯**不是任务**：
 *
 * | | 任务 | 习惯 |
 * |---|---|---|
 * | 打卡怎么写 | `setCompleted(taskId, ...)` | 写一条 `HabitLog` |
 * | 意图队列里有对应字段吗 | 有（`taskId`） | **没有** |
 *
 * 那能不能**假装**成任务塞进去？试一下就知道不行：
 * `drainWidgetIntents` 会拿 `taskId` 去任务表里查，查不到 → 归类为
 * `skippedMissing` → **丢弃**。用户打卡了、组件也显示成功了，
 * 而应用这边**悄悄什么都没做**。这正是本项目最反对的那类 bug：
 * 数据看起来是对的，用户没有理由怀疑它。
 *
 * 所以这里的选择是**不假装**：习惯行只读，点一下**打开应用**（在应用里打卡）。
 * 组件顶部照常显示进度（`3/5`），那一部分是有价值的。
 *
 * ⚠️ **要让组件里能打卡**，需要的是**契约变更**（意图队列加一种 intent kind，
 * 比如 `{kind:"habit", habitId, date}`）—— 那要四端一起改 + 重新生成黄金夹具。
 * 已记进账本 §4 的未核实项，**不是**本轮偷偷绕过去的理由。
 */

data class HabitsWidgetRow(
    val habitId: String,
    val title: String,
    val doneToday: Boolean,
    val streak: Int,
)

data class HabitsWidgetModel(
    val state: WidgetState,
    val dayStr: String?,
    val rows: List<HabitsWidgetRow>,
    val doneCount: Int,
    val totalCount: Int,
)

object HabitsWidgetModelBuilder {

    /**
     * 最多画几行。与今日任务一样选 5（槽数受 `RemoteViews` 限制，
     * 不能动态添加子视图 —— 见 `res/layout/widget_habits.xml`）。
     */
    const val MAX_ROWS: Int = 5

    fun build(content: WidgetContent): HabitsWidgetModel {
        val payload = content.payload
        if (payload == null) {
            return HabitsWidgetModel(
                state = content.state,
                dayStr = content.dayStr,
                rows = emptyList(),
                doneCount = 0,
                totalCount = 0,
            )
        }

        // ⚠️ `habits` 整个键是可选的。缺席 = 用户没有习惯（或习惯功能没开），
        //    与"有 0 个习惯"在渲染上一样。
        //
        // 🔴 计数用**全部**习惯，但只画前 [MAX_ROWS] 条 —— 两个数必须来自同一个集合，
        //    否则会出现"3/7"而列表里只有 5 行可数，用户会以为显示不全。
        val all = payload.habits.orEmpty()

        return HabitsWidgetModel(
            state = WidgetState.READY,
            dayStr = content.dayStr,
            rows = all.take(MAX_ROWS).map { habit ->
                HabitsWidgetRow(
                    habitId = habit.id,
                    title = habit.title,
                    doneToday = habit.doneToday,
                    // ⚠️ 契约里的 `streak` 是 **Double**（TS 只要求 "number"，不做整数检查），
                    //    这里用 `WidgetHabit.streakCount` 收成 Int —— 那个属性是契约层
                    //    提供的**唯一**转换处，别在这里再写一遍 `toInt()`。
                    // ⚠️ 负数在这里是坏数据（契约校验应当已经拒绝），但仍夹一下：
                    //    显示 "连续 -3 天" 比不显示更糟。
                    streak = if (habit.streakCount < 0) 0 else habit.streakCount,
                )
            },
            doneCount = all.count { it.doneToday },
            totalCount = all.size,
        )
    }
}
