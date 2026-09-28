package com.heytamobile.widget

import org.json.JSONArray
import org.json.JSONObject

/**
 * `org.json` 值 → Kotlin 值的判定助手，**四端契约在 Kotlin 侧的唯一定义处**。
 *
 * ## 为什么要单独抽一个文件
 *
 * 这些函数原来私有在 `WidgetSnapshotParser` 里。写 W1-3 的意图队列时又需要
 * `Number.isSafeInteger` 的等价物 —— 而**复制一份语义正是漂移的起点**：
 * 两份判定会在某个边界上分叉（比如 `1.0` 算不算整数），
 * 而症状是"快照能过、意图队列过不了"这种极难归因的不一致。
 *
 * 所以抽到这里，由快照解析器与意图队列**共用一份**。
 * （重构由 `WidgetSnapshotParserTest` 的 23 条测试兜着。）
 *
 * ## 每一条都对应一个 TS 写法
 *
 * 对应关系写在各自的注释里。**改这里之前先去看 `packages/widget-core/src/contract.ts`
 * 与 `intents.ts` 里对应的那一行** —— 本文件不定义语义，它只是把语义照搬过来。
 */
internal object WidgetJson {

    /** TS：`typeof value === 'string' && value.length > 0`。 */
    fun isNonEmptyString(value: Any?): Boolean = value is String && value.isNotEmpty()

    /** TS：`typeof v === 'number'`。JSON 里不会出现 NaN / Infinity。 */
    fun asNumber(value: Any?): Double? = when (value) {
        is Int -> value.toDouble()
        is Long -> value.toDouble()
        is Double -> value
        is Float -> value.toDouble()
        else -> null
    }

    /**
     * TS：`Number.isInteger`。
     *
     * ⚠️ **一处刻意的差异，且方向是更严（fail closed）**：
     * JS 的 `Number.isInteger(1e30)` 是 `true`，而这里会返回 `null`（拒绝），
     * 因为超出 `Long` 范围的值无法安全转成整数。
     * 我们的**产出方**（`JSON.stringify`）对整数永远写十进制，绝不会产出 `1e30`，
     * 所以这个差异在真实数据上不可达；它只在**手工构造的恶意/损坏载荷**上生效，
     * 而那种情况下拒绝是正确的行为。
     *
     * ⚠️ 注意 `1.0` **要接受**：`org.json` 把 JSON 的 `1.0` 解析成 `Double`，
     * 而 JS 的 `Number.isSafeInteger(1.0)` 是 `true`。判"是不是整数"用
     * `value == Math.floor(value)`，**不是**判 Java 类型。
     */
    fun asInteger(value: Any?): Long? = when (value) {
        is Int -> value.toLong()
        is Long -> value
        is Double -> if (value.isFinite() && value == Math.floor(value) &&
            Math.abs(value) <= MAX_SAFE_INTEGER.toDouble()
        ) value.toLong() else null
        else -> null
    }

    /** TS：`Number.isSafeInteger`。当前与 [asInteger] 等价，保留名字是为了对上 TS 的那一行。 */
    fun asSafeInteger(value: Any?): Long? = asInteger(value)

    /**
     * 给**拒绝原因**用的类型名。
     *
     * 🔴 刻意用 TS 的词汇（`undefined` / `object` / `number` …）而不是 Java 类名：
     * 拒绝原因会出现在应用日志里，而排查的人手上是 TS 那份契约。
     * 写成 `LinkedTreeMap` 之类，读日志的人就得再翻译一次。
     */
    fun typeName(value: Any?): String = when (value) {
        null -> "undefined"
        JSONObject.NULL -> "null"
        is JSONObject -> "object"
        is JSONArray -> "object"
        is String -> "string"
        is Boolean -> "boolean"
        is Number -> "number"
        else -> value.javaClass.simpleName
    }
}
