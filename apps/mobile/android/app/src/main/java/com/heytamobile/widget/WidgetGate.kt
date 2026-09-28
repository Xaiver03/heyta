package com.heytamobile.widget

import java.util.Collections

/**
 * 四款组件共用的"这份快照现在能不能显示"的判定
 * =================================================
 *
 * ============================================================
 * 为什么必须只有一处
 * ============================================================
 *
 * W1-5 之前只有一款组件（今日任务），判定写在 [TodayWidgetModelBuilder] 里没问题。
 * 现在有四款（今日 / 象限 / 习惯 / 专注），四份判定必然漂移 ——
 * 而**漂移的表现是"某一款组件在过期之后还显示昨天的数据"**，
 * 四款里只有一款错，用户看到的是"习惯组件是对的、象限组件是昨天的"，不会报错。
 *
 * 更根本的是：这条判定连着 [ADR-0025 §2.1.3](../../../../../../docs/adr/0025-widget-snapshot-confidentiality.md)
 * 的"显示正确的占位状态**而不是过期数据**"。那条要求不能有四个实现。
 *
 * ============================================================
 * 🔴 关键设计：`payload` **只在可显示时才存在**
 * ============================================================
 *
 * [WidgetContent.payload] 是 `null`，除非状态是 [WidgetState.READY]。
 *
 * 这不是"顺手加个约束"，它把一整类 bug 变成**写不出来**：
 *
 * | 写法 | 第四款组件忘了判过期会怎样 |
 * |---|---|
 * | 结构是 `(state, payload)`，payload 总是有值 | 它会高高兴兴画出**昨天的任务**。类型系统不拦，测试不拦，只有用户看得见 |
 * | 结构是 `payload: WidgetPayload?`，仅 READY 时非 null | 它**必须**先 `?: return` 或 `!!`（后者是显式的"我知道我在冒险"）。忘了判就编译不过 |
 *
 * 一句话：**别让"忘了判"是一件能编译通过的事。**
 *
 * [targets] 同理：只有 READY 时才有意义（乐观叠加），所以也只在 READY 时非空。
 */
enum class WidgetState {
    /** 没快照 / 密钥拿不到 / 解密失败 / 契约不合格。显示"打开应用"这类占位。 */
    PLACEHOLDER,

    /** 有快照但 `now >= validUntil`。显示"已过期"，**不给任何数据**。 */
    STALE,

    /** 可以显示。**注意条数可能是 0**（今天确实没有任务），那与 [PLACEHOLDER] 是两种状态。 */
    READY,
}

/**
 * 一次渲染要用的全部可信内容。
 *
 * [payload] 与 [targets] 在非 [WidgetState.READY] 时**必然是 `null` / 空** —— 见类注释。
 */
data class WidgetContent(
    val state: WidgetState,
    /** 快照对应的"今天"。连信封都没有时为 `null`。 */
    val dayStr: String?,
    /** **仅 [WidgetState.READY] 时非 `null`。** */
    val payload: WidgetPayload?,
    /**
     * 待处理意图的**乐观叠加**：`taskId` → 用户点出来的目标状态。
     *
     * 为什么值得叠加：不叠加的话，用户点一下**界面上什么都不变** ——
     * 他会以为没点上，然后反复点（而每次都只是覆盖同一条意图，看起来更像坏了）。
     *
     * ⚠️ 代价如实记：这是**乐观**的。若那条意图最终没能变成 op（比如 drain 时发现任务
     * 已被删除），组件会短暂地显示一个不成立的状态，直到下次快照到达。
     * 这是标准取舍 —— 反过来（点了没反应）的体感差得多。
     */
    val targets: Map<String, Boolean>,
) {
    /** 只有 READY 才谈得上"有内容可画"。 */
    val isShowable: Boolean get() = state == WidgetState.READY && payload != null

    companion object {
        fun blank(state: WidgetState, dayStr: String?): WidgetContent =
            WidgetContent(state = state, dayStr = dayStr, payload = null, targets = emptyMap())
    }
}

object WidgetGate {

    /**
     * 判定这一份快照现在是什么状态。
     *
     * 纯函数，不碰任何 Android API —— 所以它能在 JVM 单测里跑，而这一层最需要测试：
     * 判错了就是把**错误的数据画在用户桌面上**，而用户没有理由怀疑它。
     *
     * @param envelope 已解析的信封。`null` = 存储里没有快照，**或**信封没通过契约校验。
     * @param payload 已解密的载荷。`null` = 密钥拿不到、解密失败、或载荷没通过契约校验。
     * @param queue 当前待处理的意图队列。
     * @param now 当前时刻（epoch ms）。**由调用方传入**，这样测试能控制时间。
     */
    fun resolve(
        envelope: WidgetEnvelope?,
        payload: WidgetPayload?,
        queue: WidgetIntentQueue,
        now: Long,
    ): WidgetContent {
        if (envelope == null || payload == null) {
            return WidgetContent.blank(WidgetState.PLACEHOLDER, envelope?.dayStr)
        }

        // 🔴 规则 2：原生**绝不自己推导"今天"**，只判 `now >= validUntil`。
        //    时区、跨日切点、"今天从几点开始"都是产品规则；四端各推一遍必然出现
        //    "iOS 认为还是今天、Android 认为已经是明天" —— 而两份快照对同一时刻
        //    给出不同内容，**没有任何一处会报错**。
        //
        //    `>=` 而不是 `>`：`validUntil` 是**失效时刻**，到了那一刻就已经不算数了。
        if (now >= envelope.validUntil) {
            // 刻意**不给 payload**：过期数据最危险的地方在于**它看起来是对的**，
            // 用户会照着昨天的清单做事。
            return WidgetContent.blank(WidgetState.STALE, envelope.dayStr)
        }

        val targets = HashMap<String, Boolean>(queue.intents.size)
        for (intent in queue.intents) targets[intent.taskId] = intent.targetIsDone

        return WidgetContent(
            state = WidgetState.READY,
            dayStr = envelope.dayStr,
            payload = payload,
            // 不可变视图：调用方拿到的 map 不该能改回去影响这里。
            targets = Collections.unmodifiableMap(targets),
        )
    }

    /**
     * 把乐观叠加应用到一条任务上：**用户点过就用目标状态，否则用快照里的**。
     *
     * 抽出来是因为四款组件全都要做这一步，而"忘了叠加"的表现是
     * **点击之后界面纹丝不动** —— 用户会以为坏了。
     */
    fun shownAsDone(task: WidgetTask, targets: Map<String, Boolean>): Boolean =
        targets[task.id] ?: task.isDone
}
