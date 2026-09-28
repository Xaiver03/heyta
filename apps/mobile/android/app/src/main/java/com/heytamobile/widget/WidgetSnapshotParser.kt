package com.heytamobile.widget

import org.json.JSONArray
import org.json.JSONObject

/**
 * 小组件快照的 Kotlin 解析器 —— `packages/widget-core/src/contract.ts` 的**逐条对应**。
 *
 * ============================================================
 * 三条纪律
 * ============================================================
 *
 * 1. **只拒绝，不修补。** 不替调用方猜它想要什么。TS 侧原话：
 *    "只拒绝、不修补 —— 不替调用方猜它想要什么"。
 *
 * 2. **判 `v` 必须在最前。** 这样"未来版本"得到 `unknown-version`
 *    而不是含混的 `malformed-envelope`。前者是**预期内的正常情况**
 *    （旧组件遇到新契约），后者是**真的坏了** —— 两者在日志与降级行为上必须能区分。
 *
 * 3. **`has()` 与 `opt() != null` 不是一回事。** 这是本文件里最容易写错的地方：
 *    TS 用 `'key' in raw` 判"键存在"，而 JSON `null` 的键**存在**。
 *    org.json 的 `opt()` 对缺失键返回 `null`、对 JSON null 返回 `JSONObject.NULL`，
 *    所以**不能**用 `opt() == null` 当"键不存在"用 —— 那会把
 *    `projectId: null` 这种**必须报错**的输入静默当成"没这个字段"。
 *    本文件里凡是"这个键在不在"的判断，一律走 [JSONObject.has]。
 */
object WidgetSnapshotParser {

    // ─────────────────────────────────────────────────────────────
    // 信封
    // ─────────────────────────────────────────────────────────────

    fun parseEnvelope(raw: Any?): EnvelopeParseResult {
        val obj = raw as? JSONObject
            ?: return EnvelopeParseResult.Rejected(
                WidgetRejection.NOT_AN_OBJECT,
                "期望对象，实际 ${WidgetJson.typeName(raw)}",
            )

        // 🔴 先判 v，再判其余（见文件头纪律 2）。
        val v = WidgetJson.asInteger(obj.opt("v"))
            ?: return EnvelopeParseResult.Rejected(
                WidgetRejection.UNKNOWN_VERSION,
                "v 不是整数：${obj.opt("v")}",
            )
        if (v != WIDGET_CONTRACT_VERSION.toLong()) {
            return EnvelopeParseResult.Rejected(
                WidgetRejection.UNKNOWN_VERSION,
                "契约版本 $v 不是本端认识的 $WIDGET_CONTRACT_VERSION —— fail closed 到空列表",
            )
        }

        if (obj.opt("alg") != WIDGET_ALG) {
            // 注意 `opt("alg")` 对 JSON null 返回 JSONObject.NULL，不等于 WIDGET_ALG → 拒绝。✓
            return EnvelopeParseResult.Rejected(
                WidgetRejection.UNSUPPORTED_ALG,
                "alg=${obj.opt("alg")}",
            )
        }

        val dayStr = obj.opt("dayStr")
        val nonce = obj.opt("nonce")
        val ciphertext = obj.opt("ciphertext")
        if (!WidgetJson.isNonEmptyString(dayStr) || !WidgetJson.isNonEmptyString(nonce) || !WidgetJson.isNonEmptyString(ciphertext)) {
            return EnvelopeParseResult.Rejected(
                WidgetRejection.MALFORMED_ENVELOPE,
                "dayStr / nonce / ciphertext 必须是非空字符串",
            )
        }

        val validUntil = WidgetJson.asSafeInteger(obj.opt("validUntil"))
            ?: return EnvelopeParseResult.Rejected(
                WidgetRejection.MALFORMED_ENVELOPE,
                "validUntil 不是安全整数：${obj.opt("validUntil")}",
            )
        if (validUntil < 0 || validUntil > MAX_EPOCH_MS) {
            return EnvelopeParseResult.Rejected(
                WidgetRejection.MALFORMED_ENVELOPE,
                "validUntil 超出可表示范围 [0, $MAX_EPOCH_MS]：$validUntil",
            )
        }

        return EnvelopeParseResult.Ok(
            WidgetEnvelope(
                v = v.toInt(),
                dayStr = dayStr as String,
                validUntil = validUntil,
                alg = WIDGET_ALG,
                nonce = nonce as String,
                ciphertext = ciphertext as String,
            )
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 任务（`today` 与 `quadrant` 共用）
    // ─────────────────────────────────────────────────────────────

    private sealed interface TaskResult {
        data class Ok(val task: WidgetTask) : TaskResult
        data class Rejected(val reason: String, val detail: String) : TaskResult
    }

    private fun parseTask(raw: Any?): TaskResult {
        val obj = raw as? JSONObject
            ?: return TaskResult.Rejected(WidgetRejection.MALFORMED_TASK, "任务不是对象")

        val id = obj.opt("id")
        val title = obj.opt("title")
        if (!WidgetJson.isNonEmptyString(id) || !WidgetJson.isNonEmptyString(title)) {
            return TaskResult.Rejected(WidgetRejection.MALFORMED_TASK, "id / title 必须是非空字符串")
        }

        // `isDone` 必须是**真布尔**。"false" 这种字符串不能当 false 用。
        val isDone = obj.opt("isDone") as? Boolean
            ?: return TaskResult.Rejected(
                WidgetRejection.MALFORMED_TASK,
                "isDone 不是布尔：${obj.opt("isDone")}",
            )

        var projectId: String? = null
        if (obj.has("projectId")) {
            val pid = obj.opt("projectId")
            // 🔴 这一条是整个契约里最"接地气"的陷阱：
            //    Android 的 `JSONObject.optString("projectId")` 对 JSON null 返回**字符串 "null"**，
            //    于是一个"无所属清单"的任务会显示成一个名叫 null 的清单色。
            //    TS 侧在这里**硬拒绝**，Kotlin 必须同样硬拒绝。
            if (pid == null || pid === JSONObject.NULL) {
                return TaskResult.Rejected(
                    WidgetRejection.NULL_PROJECT_ID,
                    "projectId 是 null —— 必须省略该键。Android 的 org.json optString 会把它读成字符串 \"null\"",
                )
            }
            if (!WidgetJson.isNonEmptyString(pid)) {
                return TaskResult.Rejected(
                    WidgetRejection.MALFORMED_TASK,
                    "projectId 存在时必须是非空字符串",
                )
            }
            projectId = pid as String
        }

        var quadrant: Int? = null
        if (obj.has("quadrant")) {
            // ⚠️ TS 是 `'quadrant' in raw && raw.quadrant !== undefined` ——
            //    于是 `quadrant: null` **会进入分支并被拒绝**（null 不是 number）。
            //    这里同样不能把 null 当"缺失"跳过。
            val q = WidgetJson.asInteger(obj.opt("quadrant"))
                ?: return TaskResult.Rejected(
                    WidgetRejection.MALFORMED_TASK,
                    "quadrant 不是整数：${obj.opt("quadrant")}",
                )
            quadrant = q.toInt()
        }

        return TaskResult.Ok(
            WidgetTask(
                id = id as String,
                title = title as String,
                isDone = isDone,
                projectId = projectId,
                quadrant = quadrant,
            )
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 载荷
    // ─────────────────────────────────────────────────────────────

    fun parsePayload(raw: Any?): PayloadParseResult {
        val obj = raw as? JSONObject
            ?: return PayloadParseResult.Rejected(
                WidgetRejection.NOT_AN_OBJECT,
                "期望对象，实际 ${WidgetJson.typeName(raw)}",
            )

        // ── today：必需 ──────────────────────────────────────────
        if (!obj.has("today")) {
            return PayloadParseResult.Rejected(WidgetRejection.MISSING_TODAY, "today 是必需字段")
        }
        val todayRaw = obj.opt("today")
        if (todayRaw !is JSONArray) {
            return PayloadParseResult.Rejected(
                WidgetRejection.TODAY_NOT_ARRAY,
                "today 不是数组：${WidgetJson.typeName(todayRaw)}",
            )
        }
        if (todayRaw.length() > WIDGET_MAX_TASKS) {
            return PayloadParseResult.Rejected(
                WidgetRejection.TOO_MANY_TASKS,
                "today 有 ${todayRaw.length()} 条，上限 $WIDGET_MAX_TASKS —— 截断应在应用侧完成",
            )
        }
        val today = ArrayList<WidgetTask>(todayRaw.length())
        for (i in 0 until todayRaw.length()) {
            when (val parsed = parseTask(todayRaw.opt(i))) {
                is TaskResult.Ok -> today.add(parsed.task)
                is TaskResult.Rejected ->
                    return PayloadParseResult.Rejected(parsed.reason, parsed.detail)
            }
        }

        // ── projectColors（可选）────────────────────────────────
        var projectColors: Map<String, WidgetProjectColor>? = null
        if (obj.has("projectColors")) {
            val pcRaw = obj.opt("projectColors")
            if (pcRaw !is JSONObject) {
                return PayloadParseResult.Rejected(
                    WidgetRejection.MALFORMED_SECTION,
                    "projectColors 不是对象",
                )
            }
            val colors = LinkedHashMap<String, WidgetProjectColor>()
            val keys = pcRaw.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = pcRaw.opt(key)
                if (value !is JSONObject) {
                    return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "projectColors[\"$key\"] 必须是 { light, dark } 对象" +
                            "（不是字符串 token —— 槽位→颜色只该由应用解析一次）",
                    )
                }
                val light = value.opt("light")
                val dark = value.opt("dark")
                if (!WidgetJson.isNonEmptyString(light) || !WidgetJson.isNonEmptyString(dark)) {
                    return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "projectColors[\"$key\"] 的 light / dark 必须都是非空字符串",
                    )
                }
                colors[key] = WidgetProjectColor(light as String, dark as String)
            }
            projectColors = colors
        }

        // ── quadrant（可选）─────────────────────────────────────
        var quadrant: Map<String, List<WidgetTask>>? = null
        if (obj.has("quadrant")) {
            val qRaw = obj.opt("quadrant")
            if (qRaw !is JSONObject) {
                return PayloadParseResult.Rejected(
                    WidgetRejection.MALFORMED_SECTION,
                    "quadrant 不是对象",
                )
            }
            val buckets = LinkedHashMap<String, List<WidgetTask>>()
            val slots = qRaw.keys()
            while (slots.hasNext()) {
                val slot = slots.next()
                val list = qRaw.opt(slot)
                if (list !is JSONArray) {
                    return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "quadrant[\"$slot\"] 不是数组",
                    )
                }
                if (list.length() > WIDGET_MAX_TASKS) {
                    return PayloadParseResult.Rejected(
                        WidgetRejection.TOO_MANY_TASKS,
                        "quadrant[\"$slot\"] 有 ${list.length()} 条，上限 $WIDGET_MAX_TASKS",
                    )
                }
                val tasks = ArrayList<WidgetTask>(list.length())
                for (i in 0 until list.length()) {
                    when (val parsed = parseTask(list.opt(i))) {
                        is TaskResult.Ok -> tasks.add(parsed.task)
                        is TaskResult.Rejected ->
                            return PayloadParseResult.Rejected(parsed.reason, parsed.detail)
                    }
                }
                buckets[slot] = tasks
            }
            quadrant = buckets
        }

        // ── habits（可选）───────────────────────────────────────
        var habits: List<WidgetHabit>? = null
        if (obj.has("habits")) {
            val hRaw = obj.opt("habits")
            if (hRaw !is JSONArray) {
                return PayloadParseResult.Rejected(
                    WidgetRejection.MALFORMED_SECTION,
                    "habits 不是数组",
                )
            }
            val list = ArrayList<WidgetHabit>(hRaw.length())
            for (i in 0 until hRaw.length()) {
                val entry = hRaw.opt(i)
                if (entry !is JSONObject) {
                    return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "习惯的 id / title 必须是非空字符串",
                    )
                }
                val hid = entry.opt("id")
                val htitle = entry.opt("title")
                if (!WidgetJson.isNonEmptyString(hid) || !WidgetJson.isNonEmptyString(htitle)) {
                    return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "习惯的 id / title 必须是非空字符串",
                    )
                }
                val doneToday = entry.opt("doneToday")
                // ⚠️ `streak` 只要求"是数字"，**不要求整数** —— 见 [WidgetHabit.streak] 的说明。
                val streak = WidgetJson.asNumber(entry.opt("streak"))
                if (doneToday !is Boolean || streak == null) {
                    return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "习惯的 doneToday / streak 类型不对",
                    )
                }
                list.add(
                    WidgetHabit(
                        id = hid as String,
                        title = htitle as String,
                        doneToday = doneToday,
                        streak = streak,
                    )
                )
            }
            habits = list
        }

        // ── focus（可选）────────────────────────────────────────
        var focus: WidgetFocus? = null
        if (obj.has("focus")) {
            val fRaw = obj.opt("focus")
            if (fRaw !is JSONObject) {
                return PayloadParseResult.Rejected(
                    WidgetRejection.MALFORMED_SECTION,
                    "focus.active 必须是布尔",
                )
            }
            val active = fRaw.opt("active")
            if (active !is Boolean) {
                return PayloadParseResult.Rejected(
                    WidgetRejection.MALFORMED_SECTION,
                    "focus.active 必须是布尔",
                )
            }

            var remaining: Double? = null
            if (fRaw.has("remainingSeconds")) {
                remaining = WidgetJson.asNumber(fRaw.opt("remainingSeconds"))
                    ?: return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "focus.remainingSeconds 必须是数字",
                    )
            }
            var target: Double? = null
            if (fRaw.has("targetSeconds")) {
                target = WidgetJson.asNumber(fRaw.opt("targetSeconds"))
                    ?: return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "focus.targetSeconds 必须是数字",
                    )
            }
            var sessionTitle: String? = null
            if (fRaw.has("sessionTitle")) {
                // ⚠️ TS 只要求 `typeof === 'string'` —— **空字符串是合法的**。
                //    这里若写成 `isNonEmptyString` 就会比 TS 更严 → 跨端分歧。
                val st = fRaw.opt("sessionTitle")
                if (st !is String) {
                    return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "focus.sessionTitle 必须是字符串",
                    )
                }
                sessionTitle = st
            }

            var endsAt: Long? = null
            if (fRaw.has("endsAt")) {
                // 与 `validUntil` 同一套校验：安全整数 + 落在可表示范围内。
                //
                // 🔴 **必须走 `WidgetJson.asSafeInteger`，不能自己写 `when (opt(...)) { is Long -> ... }`。**
                //    我第一版就是那么写的，于是 `endsAt: 0` 被**误拒**：
                //    `org.json` 的 `opt()` 对 JSON 数字会**依次**尝试 `Integer` → `Long` → `Double`，
                //    所以 `0` 拿到的是 **`Integer`** 而不是 `Long`，`is Long` 分支直接不命中。
                //
                //    这个坑的可怕之处在于**它只在小区间上出现**：
                //    `1790000000000` 拿到的是 `Long`（正常），`0`、`1`、`1500` 拿到的是 `Integer`。
                //    所以"用大数字试一下"永远不会发现它，只有边界值才会。
                //    测试里我恰好写了 `endsAt: 0` 这条边界 —— 这是它被发现的唯一原因。
                val e = WidgetJson.asSafeInteger(fRaw.opt("endsAt"))
                if (e == null || e < 0 || e > MAX_EPOCH_MS) {
                    return PayloadParseResult.Rejected(
                        WidgetRejection.MALFORMED_SECTION,
                        "focus.endsAt 必须是 [0, MAX_EPOCH_MS] 内的安全整数",
                    )
                }
                endsAt = e
            }

            focus = WidgetFocus(
                active = active,
                remainingSeconds = remaining,
                targetSeconds = target,
                sessionTitle = sessionTitle,
                endsAt = endsAt,
            )
        }

        return PayloadParseResult.Ok(
            WidgetPayload(
                today = today,
                quadrant = quadrant,
                habits = habits,
                focus = focus,
                projectColors = projectColors,
            )
        )
    }

    // ─────────────────────────────────────────────────────────────
    // JS 数值语义的等价物
    // ─────────────────────────────────────────────────────────────
}
