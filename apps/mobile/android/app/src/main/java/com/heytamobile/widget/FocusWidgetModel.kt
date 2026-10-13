package com.heytamobile.widget

/**
 * 「今日专注」组件的渲染模型。
 *
 * ============================================================
 * 🔴 这款组件**不显示倒计时** —— 这是刻意的，而且是本轮最重要的一个取舍
 * ============================================================
 *
 * 契约里的 `WidgetFocus` 只有 `{ active, remainingSeconds?, targetSeconds?, sessionTitle? }`
 * —— **没有任何绝对时间锚点**。`remainingSeconds` 是**发布那一刻**算出来的快照值。
 *
 * 于是：应用在 09:00 发布"剩余 25:00"，用户在 09:10 看一眼组件 —— 组件如果照着画，
 * 会显示 **"剩余 25:00"**。那不是"稍微不准"，那是**错的**：
 *
 * - 它**看起来是对的**（一个整整齐齐的倒计时），用户没有理由怀疑它；
 * - 真实剩余是 15:00，用户照着 25:00 安排事情；
 * - 更糟的是 `active` 也是冻结的：一场 09:25 就结束的专注，10:00 时组件还会说
 *   **"专注中"** —— 在用户明明已经不在专注的时候。
 *
 * 这与本项目最反对的那类缺陷是同一个形状（组件骗用户说"今天没有任务"、
 * 用过期的任务列表装作今天）。所以这里选择**不画那个数字**。
 *
 * ## 那画什么
 *
 * | 快照说 | 组件画 |
 * |---|---|
 * | 没有快照 / 解不开 | 占位："打开 Heyta 以显示小组件" |
 * | 快照过期（过了 `validUntil`） | "数据已过期，打开 Heyta 刷新" |
 * | `active == false` | "没有进行中的专注" |
 * | `active == true` 且有 `endsAt` | 会话标题 + **目标时长** + 运行中 |
 * | `active == true` 且没有 `endsAt` | 会话标题 + **目标时长** + 已暂停 |
 *
 * 目标时长（`targetSeconds`）是**静态事实**，过多久都不会过期；
 * 而"还剩多久"是动态事实，**没有锚点就不该猜**。
 *
 * ## 动态倒计时的后续边界
 *
 * 给 `WidgetFocus` 加一个**绝对**字段 `endsAt`（epoch ms，`FocusState` 里本来就有）。
 * 原生于是能区分运行与暂停；将来若要显示动态剩余时间，也能算
 * `remaining = endsAt - now` —— 那是**它已经有权做的事**
 *（它本来就在判 `now >= validUntil`）。本轮只用它识别运行/暂停；真正把动态倒计时
 * 画到四端组件仍需同步更新四端渲染器与黄金夹具，不能只改 Android。
 *
 * ⚠️ 在那之前，**宁可少显示一个数字，也不显示一个错的数字**。
 */

/** 专注组件比其它三款多两个状态：快照可信，但"有没有在专注"是另一回事。 */
enum class FocusWidgetState {
    /** 没有快照 / 密钥拿不到 / 解密失败。 */
    PLACEHOLDER,

    /** 有快照但过期。**不给任何专注信息**。 */
    STALE,

    /** 快照可信，但当前**没有**进行中的专注。 */
    IDLE,

    /** 快照可信，且快照发布时有一场专注在进行。 */
    ACTIVE,

    /** 快照可信，且当前专注已暂停。 */
    PAUSED,
}

data class FocusWidgetModel(
    val state: FocusWidgetState,
    val dayStr: String?,
    /** 仅 [FocusWidgetState.ACTIVE] / [FocusWidgetState.PAUSED] 时非 `null`。 */
    val sessionTitle: String?,
    /** 本轮目标秒数。运行中或暂停时有意义 —— 它是静态事实，不会随时间变。 */
    val targetSeconds: Int?,
) {
    companion object {
        fun blank(state: FocusWidgetState, dayStr: String?): FocusWidgetModel =
            FocusWidgetModel(state = state, dayStr = dayStr, sessionTitle = null, targetSeconds = null)
    }
}

object FocusWidgetModelBuilder {

    fun build(content: WidgetContent): FocusWidgetModel {
        val payload = content.payload
        if (payload == null) {
            // 占位与过期都到这里 —— [WidgetGate] 保证 payload 只在 READY 时非 null。
            return FocusWidgetModel.blank(
                state = if (content.state == WidgetState.STALE) {
                    FocusWidgetState.STALE
                } else {
                    FocusWidgetState.PLACEHOLDER
                },
                dayStr = content.dayStr,
            )
        }

        val focus = payload.focus
        if (focus == null || !focus.active) {
            return FocusWidgetModel.blank(FocusWidgetState.IDLE, content.dayStr)
        }

        return FocusWidgetModel(
            // 当前发布方只在 running 状态提供 endsAt；暂停后 endsAt 被省略。
            // 这是向前兼容的可选字段，因此来自旧版本的 active 快照也会落入
            // PAUSED，显示“已暂停/打开应用查看”，不会伪称正在运行。
            state = if (focus.endsAt == null) FocusWidgetState.PAUSED else FocusWidgetState.ACTIVE,
            dayStr = content.dayStr,
            // ⚠️ 契约里 `sessionTitle` 可为空（用户常常不填）—— 视图层据此换成
            //    一个通用标题，而不是画一个空字符串（那会看起来像渲染坏了）。
            sessionTitle = focus.sessionTitle,
            // 目标时长必须是正数才显示；0 或负数都是坏数据。
            // ⚠️ 契约里的 `targetSeconds` 是 **Double**（TS 只要求 "number"），
            //    这里收成秒的整数 —— 再往下（视图层）只按分钟显示。
            targetSeconds = focus.targetSeconds?.takeIf { it > 0 }?.toInt(),
        )
    }
}
