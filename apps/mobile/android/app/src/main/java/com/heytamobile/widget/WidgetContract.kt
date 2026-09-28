package com.heytamobile.widget

/**
 * 小组件契约的 **Kotlin 侧**模型 —— 与 `packages/widget-core/src/contract.ts` 逐字段对应。
 *
 * ============================================================
 * 这个文件里每个决定都有一条"为什么不能随手改"的理由
 * ============================================================
 *
 * 四端（SwiftUI / Kotlin / ArkTS / Adaptive Card）**共享的不是代码，是这份契约**。
 * TS 侧的校验器原生根本用不上 —— 原生真正的锁是
 * `packages/widget-core/fixtures/v1.golden.json`。所以这里的每个字段类型
 * 都必须**对着 TS 的实际行为**写，而不是对着"看起来合理"写。
 */

/** 当前契约版本。改这个值必须同时更新四端的解析器与 golden fixture。 */
const val WIDGET_CONTRACT_VERSION = 1

/** 唯一的算法标识 —— **没有明文选项**。 */
const val WIDGET_ALG = "AES-GCM-256"

/** 任务数上限。截断由**应用侧**做，这里只**拒绝**，不修补。 */
const val WIDGET_MAX_TASKS = 20

/**
 * 时间戳上界。
 *
 * 🔴 这个值不是洁癖。JS 对 >= 1e21 的数字用科学计数法
 * （`String(1e21) === '1e+21'`），而 Swift / Kotlin / ArkTS 的格式化规则各不相同 ——
 * 于是 AAD 字符串对不上，四端**全都解密失败**，而症状只是"组件没数据"。
 * 把 `validUntil` 限在 JS `Date` 能表示的范围内，这个分歧就不可能发生。
 */
const val MAX_EPOCH_MS = 8_640_000_000_000_000L

/** `Number.MAX_SAFE_INTEGER`。TS 用 `Number.isSafeInteger` 判 `validUntil`。 */
const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

/**
 * 信封。**明文字段可被原生直接读** —— 组件要在**拿不到密钥**时
 * 也能判断"这份快照过期了"，所以 `v` / `dayStr` / `validUntil` / `alg` 不加密。
 */
data class WidgetEnvelope(
    val v: Int,
    val dayStr: String,
    val validUntil: Long,
    val alg: String,
    val nonce: String,
    val ciphertext: String,
)

/**
 * 参与 AAD 的字段。**必须与 TS 的 `envelopeAad()` 逐字节一致**，
 * 否则解密失败 —— 而且是四端**同时**失败，症状只是"组件没数据"。
 */
fun envelopeAad(v: Int, dayStr: String, validUntil: Long): String = "$v|$dayStr|$validUntil"

data class WidgetTask(
    val id: String,
    val title: String,
    val isDone: Boolean,
    /** ⚠️ `null` 是**合法**的"无所属清单"，但 JSON `null` 必须**被拒绝**（见解析器）。 */
    val projectId: String? = null,
    /** 只出现在 `quadrant` 分桶里。 */
    val quadrant: Int? = null,
)

/**
 * 🔴 `streak` 是 `Double` 而**不是** `Int` —— 这不是疏忽。
 *
 * TS 的校验只要求 `typeof entry.streak === 'number'`，**不要求整数**。
 * 若 Kotlin 收窄成 `Int`，那么一个 `streak: 3.5` 的载荷会被 TS 接受、被 Kotlin 拒绝 ——
 * 这正是本契约要消灭的**跨端静默分歧**。宁可 API 丑一点，也不要两端判断不同。
 *
 * 渲染时用 [streakCount] 取整。
 */
data class WidgetHabit(
    val id: String,
    val title: String,
    val doneToday: Boolean,
    val streak: Double,
) {
    val streakCount: Int get() = streak.toInt()
}

/** 同理见 [WidgetHabit.streak]：TS 只要求 "number"，不做整数检查。 */
data class WidgetFocus(
    val active: Boolean,
    val remainingSeconds: Double? = null,
    val targetSeconds: Double? = null,
    /** ⚠️ TS 只要求 `typeof === 'string'` —— **空字符串是合法的**。 */
    val sessionTitle: String? = null,
    /**
     * 🔴 **本轮专注的绝对结束时刻**（Unix 毫秒）。灵动岛 / Live Activity 的前提。
     *
     * 对应 TS 的 `WidgetFocus.endsAt`。可选 = 向前兼容：缺省时 `active` 仍为真，
     * 只是**不启动**任何按时间轴渲染的东西。
     */
    val endsAt: Long? = null,
)

/** 已解析好的两个十六进制 —— 见 ADR-0025 的 D7。 */
data class WidgetProjectColor(val light: String, val dark: String)

data class WidgetPayload(
    val today: List<WidgetTask>,
    val quadrant: Map<String, List<WidgetTask>>? = null,
    val habits: List<WidgetHabit>? = null,
    val focus: WidgetFocus? = null,
    val projectColors: Map<String, WidgetProjectColor>? = null,
)

/**
 * **fail closed 的唯一产物**。
 *
 * ⚠️ 注意它**只有 `today`**（空的），其它 section 是 `null` 而不是空集合 ——
 * 与 TS 的 `emptyPayload()` 一致。"没有数据"与"有数据但为空"在界面上是两种状态。
 */
fun emptyPayload(): WidgetPayload = WidgetPayload(today = emptyList())

/**
 * 拒绝原因。字符串常量而不是 enum，是为了**与 TS 的 `reason` 值逐字对应** ——
 * 两端日志里出现同一个词，排障时才能对上。
 */
object WidgetRejection {
    const val NOT_AN_OBJECT = "not-an-object"
    const val UNKNOWN_VERSION = "unknown-version"
    const val UNSUPPORTED_ALG = "unsupported-alg"
    const val MALFORMED_ENVELOPE = "malformed-envelope"
    const val MALFORMED_TASK = "malformed-task"
    const val NULL_PROJECT_ID = "null-project-id"
    const val MISSING_TODAY = "missing-today"
    const val TODAY_NOT_ARRAY = "today-not-array"
    const val TOO_MANY_TASKS = "too-many-tasks"
    const val MALFORMED_SECTION = "malformed-section"
}

sealed interface EnvelopeParseResult {
    data class Ok(val envelope: WidgetEnvelope) : EnvelopeParseResult
    data class Rejected(val reason: String, val detail: String) : EnvelopeParseResult
}

sealed interface PayloadParseResult {
    data class Ok(val payload: WidgetPayload) : PayloadParseResult
    data class Rejected(val reason: String, val detail: String) : PayloadParseResult
}
