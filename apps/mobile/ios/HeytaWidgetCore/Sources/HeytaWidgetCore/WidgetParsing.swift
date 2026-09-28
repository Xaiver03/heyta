import Foundation

/**
 信封与载荷的解析（Swift 侧）。
 ================================

 与 `packages/widget-core/src/contract.ts` 和
 `apps/mobile/android/.../WidgetSnapshotParser.kt` 描述**同一套判据**。

 ## 🔴 三方一致不是"风格统一"，是"必须"

 这三份实现分别跑在三个运行时上，而它们读的是**同一份**桌面容器里的字节。
 任何一处更宽松或更严格，症状都是**只有一部分用户**遇到 —— 而且方向不同：

 | 分歧方向 | 症状 |
|---|---|
| Swift 比 TS **宽松**（比如接受了 `projectId: null`） | 应用不会写这种快照，所以本地永远测不出来；但一旦别处写了，iOS 显示 `"null"` 而 Android 拒绝 |
| Swift 比 TS **严格**（比如要求 `sessionTitle` 非空） | 应用产出的**合法**快照被 iOS 拒绝 → 组件永远显示占位，而 Android 正常 |

 所以每一条判据下面都写了它在 TS 侧对应哪一行。

 ## 判断顺序也有讲究

 `parseEnvelope` **先判 `v`，再判其余** —— 这样"未来版本"会得到 `unknownVersion`
 而不是含混的 `malformedEnvelope`。前者是**预期内的正常情况**（用户升级了应用、
 组件还是旧版本），后者是**真的坏了**。两者的日志与降级行为必须能区分。
 */

/// 信封解析结果。对应 TS 的 `EnvelopeParseResult`。
public enum EnvelopeParseResult: Sendable {
    case ok(WidgetEnvelope)
    case rejected(EnvelopeRejection, detail: String)
}

/// 载荷解析结果。对应 TS 的 `PayloadParseResult`。
public enum PayloadParseResult: Sendable {
    case ok(WidgetPayload)
    case rejected(PayloadRejection, detail: String)
}

public enum WidgetParsing {

    /// `validUntil` 的上界。对应 TS 的 `MAX_EPOCH_MS`。
    ///
    /// 🔴 这个范围检查挡掉一整类**跨端静默不一致**：JS 对 ≥ 1e21 的数字用科学计数法
    /// （`String(1e21) === '1e+21'`），而 Swift / Kotlin / ArkTS 的格式化规则各不相同 ——
    /// 于是 AAD 字符串对不上，四端**全都**"解密失败"，而症状只是组件没有数据。
    public static let maxEpochMs: Double = 8_640_000_000_000_000

    // ─────────────────────────────────────────────────────────────
    // 信封
    // ─────────────────────────────────────────────────────────────

    public static func parseEnvelope(_ raw: Any?) -> EnvelopeParseResult {
        guard let obj = J.object(raw) else {
            return .rejected(.notAnObject, detail: "期望对象")
        }

        // 先判 v —— 见文件头"判断顺序"。
        guard let v = J.integer(obj["v"]) else {
            return .rejected(.unknownVersion, detail: "v 不是整数")
        }
        guard v == widgetContractVersion else {
            // ⚠️ 这里**不是**"坏了"。旧组件遇到新契约是预期内的事，
            //    所以走 unknownVersion 而不是 malformedEnvelope。
            return .rejected(.unknownVersion, detail: "契约版本 \(v) 不是本端认识的 \(widgetContractVersion)")
        }

        guard let alg = J.anyString(obj["alg"]), alg == widgetAlg else {
            return .rejected(.unsupportedAlg, detail: "alg=\(String(describing: obj["alg"]))")
        }

        guard
            let dayStr = J.nonEmptyString(obj["dayStr"]),
            let nonce = J.nonEmptyString(obj["nonce"]),
            let ciphertext = J.nonEmptyString(obj["ciphertext"])
        else {
            return .rejected(.malformedEnvelope, detail: "dayStr / nonce / ciphertext 必须是非空字符串")
        }

        // ⚠️ `validUntil` 必须是**安全整数**，且范围受限。
        //    `J.integer` 自己已经做了 `d == d.rounded()` 与 2^53 检查。
        guard let validUntil = J.integer(obj["validUntil"]) else {
            return .rejected(.malformedEnvelope, detail: "validUntil 不是安全整数")
        }
        guard validUntil >= 0, Double(validUntil) <= maxEpochMs else {
            return .rejected(.malformedEnvelope, detail: "validUntil 超出可表示范围 [0, \(Int64(maxEpochMs))]")
        }

        return .ok(
            WidgetEnvelope(
                v: v,
                dayStr: dayStr,
                validUntil: Double(validUntil),
                alg: alg,
                nonce: nonce,
                ciphertext: ciphertext
            )
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 载荷
    // ─────────────────────────────────────────────────────────────

    public static func parsePayload(_ raw: Any?) -> PayloadParseResult {
        guard let obj = J.object(raw) else {
            return .rejected(.notAnObject, detail: "期望对象")
        }

        // `today` 是**必需**字段（其余四段都可选）。
        guard obj.keys.contains("today") else {
            return .rejected(.missingToday, detail: "today 是必需字段")
        }
        guard let todayRaw = J.array(obj["today"]) else {
            return .rejected(.todayNotArray, detail: "today 不是数组")
        }
        // 🔴 超限**整体拒绝**，不截断 —— 截断会把一次契约违例掩盖成"正常显示 20 条"。
        guard todayRaw.count <= widgetMaxTasks else {
            return .rejected(.tooManyTasks, detail: "today 有 \(todayRaw.count) 条，上限 \(widgetMaxTasks)")
        }

        var today: [WidgetTask] = []
        for entry in todayRaw {
            switch parseTask(entry) {
            case .ok(let t): today.append(t)
            case .rejected(let reason, let detail): return .rejected(reason, detail: detail)
            }
        }

        var projectColors: [String: WidgetProjectColor]?
        if obj.keys.contains("projectColors"), let pcRaw = obj["projectColors"], !(pcRaw is NSNull) {
            guard let pcObj = J.object(pcRaw) else {
                return .rejected(.malformedSection, detail: "projectColors 不是对象")
            }
            var out: [String: WidgetProjectColor] = [:]
            for (key, value) in pcObj {
                guard let entry = J.object(value),
                      let light = J.nonEmptyString(entry["light"]),
                      let dark = J.nonEmptyString(entry["dark"])
                else {
                    return .rejected(.malformedSection, detail: "projectColors[\"\(key)\"] 必须是 {light, dark} 两个非空字符串")
                }
                out[key] = WidgetProjectColor(light: light, dark: dark)
            }
            projectColors = out
        }

        var quadrant: [String: [WidgetTask]]?
        if obj.keys.contains("quadrant"), let qRaw = obj["quadrant"], !(qRaw is NSNull) {
            guard let qObj = J.object(qRaw) else {
                return .rejected(.malformedSection, detail: "quadrant 不是对象")
            }
            var out: [String: [WidgetTask]] = [:]
            for (slot, value) in qObj {
                guard let list = J.array(value) else {
                    return .rejected(.malformedSection, detail: "quadrant[\"\(slot)\"] 不是数组")
                }
                guard list.count <= widgetMaxTasks else {
                    return .rejected(.tooManyTasks, detail: "quadrant[\"\(slot)\"] 有 \(list.count) 条，上限 \(widgetMaxTasks)")
                }
                var tasks: [WidgetTask] = []
                for entry in list {
                    switch parseTask(entry) {
                    case .ok(let t): tasks.append(t)
                    case .rejected(let reason, let detail): return .rejected(reason, detail: detail)
                    }
                }
                out[slot] = tasks
            }
            quadrant = out
        }

        var habits: [WidgetHabit]?
        if obj.keys.contains("habits"), let hRaw = obj["habits"], !(hRaw is NSNull) {
            guard let list = J.array(hRaw) else {
                return .rejected(.malformedSection, detail: "habits 不是数组")
            }
            var out: [WidgetHabit] = []
            for entry in list {
                guard let e = J.object(entry),
                      let id = J.nonEmptyString(e["id"]),
                      let title = J.nonEmptyString(e["title"])
                else {
                    return .rejected(.malformedSection, detail: "习惯的 id / title 必须是非空字符串")
                }
                guard let doneToday = J.bool(e["doneToday"]), let streak = J.number(e["streak"]) else {
                    return .rejected(.malformedSection, detail: "习惯的 doneToday / streak 类型不对")
                }
                out.append(WidgetHabit(id: id, title: title, doneToday: doneToday, streak: streak))
            }
            habits = out
        }

        var focus: WidgetFocus?
        if obj.keys.contains("focus"), let fRaw = obj["focus"], !(fRaw is NSNull) {
            guard let f = J.object(fRaw) else {
                return .rejected(.malformedSection, detail: "focus 不是对象")
            }
            guard let active = J.bool(f["active"]) else {
                return .rejected(.malformedSection, detail: "focus.active 必须是布尔")
            }
            var remaining: Double?
            if f.keys.contains("remainingSeconds") {
                guard let r = J.number(f["remainingSeconds"]) else {
                    return .rejected(.malformedSection, detail: "focus.remainingSeconds 必须是数字")
                }
                remaining = r
            }
            var target: Double?
            if f.keys.contains("targetSeconds") {
                guard let t = J.number(f["targetSeconds"]) else {
                    return .rejected(.malformedSection, detail: "focus.targetSeconds 必须是数字")
                }
                target = t
            }
            var sessionTitle: String?
            if f.keys.contains("sessionTitle") {
                // ⚠️ TS 只要求 `typeof === 'string'` —— **空字符串是合法的**。
                //    这里若写成"非空字符串"就会比 TS 更严 → 跨端分歧。
                guard let st = J.anyString(f["sessionTitle"]) else {
                    return .rejected(.malformedSection, detail: "focus.sessionTitle 必须是字符串")
                }
                sessionTitle = st
            }
            var endsAt: Double?
            if f.keys.contains("endsAt") {
                // 与 `validUntil` 同一套校验：安全整数 + 落在可表示范围内。
                // ⚠️ 不用 `isFinite` 单独判：`1e300` 是"有限"的，但转成 `Date`
                //    会在原生侧溢出/变成 `Invalid Date` —— 这里正是要挡它的地方。
                guard let e = J.number(f["endsAt"]),
                      e >= 0, e <= maxEpochMs, e == e.rounded()
                else {
                    return .rejected(.malformedSection, detail: "focus.endsAt 必须是 [0, MAX_EPOCH_MS] 内的安全整数")
                }
                endsAt = e
            }
            focus = WidgetFocus(
                active: active,
                remainingSeconds: remaining,
                targetSeconds: target,
                sessionTitle: sessionTitle,
                endsAt: endsAt
            )
        }

        return .ok(
            WidgetPayload(
                today: today,
                quadrant: quadrant,
                habits: habits,
                focus: focus,
                projectColors: projectColors
            )
        )
    }

    /// 一条任务的校验。对应 TS 的 `parseTask`。
    static func parseTask(_ raw: Any?) -> PayloadParseResult.TaskResult {
        guard let t = J.object(raw) else {
            return .rejected(.malformedTask, detail: "任务不是对象")
        }
        guard let id = J.nonEmptyString(t["id"]), let title = J.nonEmptyString(t["title"]) else {
            return .rejected(.malformedTask, detail: "id / title 必须是非空字符串")
        }
        guard let isDone = J.bool(t["isDone"]) else {
            return .rejected(.malformedTask, detail: "isDone 不是布尔")
        }

        var projectId: String?
        if t.keys.contains("projectId") {
            // 🔴 就是这里：JSON `null` 必须**报错**，而不是原样传下去。
            //    Android 的 `org.json` 的 `optString` 会把 `null` 读成字符串 `"null"` ——
            //    于是同一份快照在 iOS 上显示 "null" 分类、在 Android 上也是，
            //    而应用那边从来没写过这种快照。**让它在入口就死掉。**
            if t["projectId"] is NSNull {
                return .rejected(.nullProjectId, detail: "projectId 是 null —— 必须省略该键")
            }
            guard let pid = J.nonEmptyString(t["projectId"]) else {
                return .rejected(.malformedTask, detail: "projectId 存在时必须是非空字符串")
            }
            projectId = pid
        }

        var quadrant: Int?
        if t.keys.contains("quadrant"), let q = t["quadrant"], !(q is NSNull) {
            guard let qi = J.integer(q) else {
                return .rejected(.malformedTask, detail: "quadrant 不是整数")
            }
            quadrant = qi
        }

        return .ok(WidgetTask(id: id, title: title, isDone: isDone, projectId: projectId, quadrant: quadrant))
    }
}

extension PayloadParseResult {
    /// 解析**单条任务**的结果。
    ///
    /// 单独一个类型（而不是复用 `PayloadParseResult`）是为了让"一条任务的失败"
    /// 在类型上就与"整个载荷的失败"分开 —— 混用会让调用方以为拿到了一个载荷。
    enum TaskResult {
        case ok(WidgetTask)
        case rejected(PayloadRejection, detail: String)
    }
}

// 让 `parseTask` 的返回类型能写成 `PayloadParseResult.TaskResult` 同时保持可读。
extension PayloadParseResult.TaskResult {
    var task: WidgetTask? {
        if case .ok(let t) = self { return t }
        return nil
    }
}
