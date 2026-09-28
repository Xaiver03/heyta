import Foundation
import XCTest

@testable import HeytaWidgetCore

/**
 信封 / 载荷 / 意图队列的解析判据（Swift 侧）。
 ================================================

 这些用例的**期望值全部来自 `packages/widget-core/src/contract.ts`**，
 一条一条对着写的。它们的作用不是"证明 Swift 会解析 JSON"，
 而是**锁住三端（TS / Swift / Kotlin）之间的一致性**：
 哪一端更宽松或更严格，都会在这里或那边的测试里红。

 ## 为什么"更宽松"也是错的

 直觉上"iOS 更宽容一点"是好事。但设想 Swift 接受了 `projectId: null`：

 - 应用**不会**写这种快照 → 本地永远测不出来；
 - 于是这个宽容**永远不会被发现**，直到某个版本真的写了；
 - 那时 iOS 显示分类名 `"null"`、Android 拒绝整个快照显示占位 ——
   **同一份数据，两个平台两种表现**，而两边各自"都没错"。
 */
final class WidgetParsingTests: XCTestCase {

    private func envelopeJSON(_ overrides: [String: Any] = [:]) -> [String: Any] {
        var out: [String: Any] = [
            "v": widgetContractVersion,
            "dayStr": "2026-09-27",
            "validUntil": 1_790_000_000_000,
            "alg": widgetAlg,
            "nonce": "AAAA",
            "ciphertext": "BBBB",
        ]
        for (k, v) in overrides { out[k] = v }
        return out
    }

    // ─────────────────────────────────────────────────────────────
    // 信封
    // ─────────────────────────────────────────────────────────────

    func test_信封_正常() {
        guard case .ok(let e) = WidgetParsing.parseEnvelope(envelopeJSON()) else {
            return XCTFail("应当通过")
        }
        XCTAssertEqual(e.v, 1)
        XCTAssertEqual(e.dayStr, "2026-09-27")
    }

    func test_信封_不是对象被拒() {
        assertEnvelopeRejection(nil, .notAnObject)
        assertEnvelopeRejection("a string", .notAnObject)
        assertEnvelopeRejection([1, 2, 3], .notAnObject)
    }

    func test_信封_v不是整数是unknownVersion() {
        // 🔴 `v` 缺失 / 是字符串 / 是小数 —— 都属于"我不认识这个版本"，
        //    而不是"数据坏了"。这条区分在 TS 侧有明确注释。
        assertEnvelopeRejection(envelopeJSON(["v": "1"]), .unknownVersion)
        assertEnvelopeRejection(envelopeJSON(["v": 1.5]), .unknownVersion)
        var missing = envelopeJSON()
        missing.removeValue(forKey: "v")
        assertEnvelopeRejection(missing, .unknownVersion)
    }

    func test_信封_未来版本是unknownVersion() {
        assertEnvelopeRejection(envelopeJSON(["v": 2]), .unknownVersion)
        assertEnvelopeRejection(envelopeJSON(["v": 99]), .unknownVersion)
    }

    func test_信封_算法不认识是unsupportedAlg() {
        assertEnvelopeRejection(envelopeJSON(["alg": "AES-CBC"]), .unsupportedAlg)
        assertEnvelopeRejection(envelopeJSON(["alg": ""]), .unsupportedAlg)
    }

    func test_信封_空字符串字段是malformed() {
        assertEnvelopeRejection(envelopeJSON(["dayStr": ""]), .malformedEnvelope)
        assertEnvelopeRejection(envelopeJSON(["nonce": ""]), .malformedEnvelope)
        assertEnvelopeRejection(envelopeJSON(["ciphertext": ""]), .malformedEnvelope)
    }

    func test_信封_validUntil必须是安全整数且范围受限() {
        assertEnvelopeRejection(envelopeJSON(["validUntil": -1]), .malformedEnvelope)
        assertEnvelopeRejection(envelopeJSON(["validUntil": 1.5]), .malformedEnvelope)
        assertEnvelopeRejection(envelopeJSON(["validUntil": "1790000000000"]), .malformedEnvelope)
        // 上界：见 `MAX_EPOCH_MS` 的注释（JS 科学计数法会让四端 AAD 不一致）。
        assertEnvelopeRejection(envelopeJSON(["validUntil": 9e15 + 1]), .malformedEnvelope)
    }

    /// 🔴 `true` 在 Swift 的 `JSONSerialization` 里是 `NSNumber`，而 `NSNumber`
    /// **也能** `as? Double` 成功。所以 `J.number` 必须先排除 `Bool` ——
    /// 否则 `validUntil: true` 会被当成 `1` 通过。TS 与 Kotlin 都没有这个坑。
    func test_信封_布尔不能被当成数字() {
        assertEnvelopeRejection(envelopeJSON(["validUntil": true]), .malformedEnvelope)
    }

    private func assertEnvelopeRejection(
        _ raw: Any?, _ expected: EnvelopeRejection,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        // 走一遍真正的 JSON 往返：`JSONSerialization` 才会产出 `NSNumber` / `NSNull`，
        // 手写 Swift 字典会绕过上面那个 `Bool` 坑。
        let normalized: Any?
        if let dict = raw as? [String: Any] {
            let data = try! JSONSerialization.data(withJSONObject: dict)
            normalized = try! JSONSerialization.jsonObject(with: data)
        } else if let s = raw as? String {
            normalized = s
        } else if let arr = raw as? [Int] {
            normalized = arr
        } else {
            normalized = nil
        }

        guard case .rejected(let reason, _) = WidgetParsing.parseEnvelope(normalized) else {
            return XCTFail("期望被拒（\(expected)），实际通过了", file: file, line: line)
        }
        XCTAssertEqual(reason, expected, file: file, line: line)
    }

    // ─────────────────────────────────────────────────────────────
    // 载荷
    // ─────────────────────────────────────────────────────────────

    private func taskJSON(_ overrides: [String: Any] = [:]) -> [String: Any] {
        var out: [String: Any] = ["id": "t1", "title": "买牛奶", "isDone": false]
        for (k, v) in overrides { out[k] = v }
        return out
    }

    func test_载荷_today必需() {
        assertPayloadRejection([:], .missingToday)
    }

    func test_载荷_today必须是数组() {
        assertPayloadRejection(["today": "x"], .todayNotArray)
        assertPayloadRejection(["today": ["a": 1]], .todayNotArray)
    }

    func test_载荷_today超限是整体拒绝() {
        let over = (0...widgetMaxTasks).map { taskJSON(["id": "t\($0)"]) }
        assertPayloadRejection(["today": over], .tooManyTasks)

        // 恰好 20 条是合法的（边界）。
        let exact = (0..<widgetMaxTasks).map { taskJSON(["id": "t\($0)"]) }
        guard case .ok = WidgetParsing.parsePayload(["today": exact]) else {
            return XCTFail("恰好 \(widgetMaxTasks) 条应当通过")
        }
    }

    func test_载荷_任务字段校验() {
        assertPayloadRejection(["today": [taskJSON(["id": ""])]], .malformedTask)
        assertPayloadRejection(["today": [taskJSON(["title": ""])]], .malformedTask)
        assertPayloadRejection(["today": [taskJSON(["isDone": "true"])]], .malformedTask)
        assertPayloadRejection(["today": [taskJSON(["quadrant": 1.5])]], .malformedTask)
        assertPayloadRejection(["today": ["not an object"]], .malformedTask)
    }

    /**
     🔴 **`projectId: null` 必须报错，不能原样传下去。**

     这是全项目最具体的一个跨端陷阱：Android 的 `org.json` 的 `optString`
     会把 JSON 的 `null` 读成**字符串 `"null"`**。于是同一份快照，
     iOS 如果不拦，两边都会显示一个叫 "null" 的分类 —— 而应用从来没写过这种快照。
     **让它在入口就死掉。**
     */
    func test_载荷_projectId是null被拒() {
        assertPayloadRejection(["today": [taskJSON(["projectId": NSNull()])]], .nullProjectId)
    }

    func test_载荷_projectId省略是合法的() {
        guard case .ok(let p) = WidgetParsing.parsePayload(["today": [taskJSON()]]) else {
            return XCTFail("省略 projectId 应当通过")
        }
        XCTAssertNil(p.today[0].projectId)
    }

    func test_载荷_projectId空字符串被拒() {
        assertPayloadRejection(["today": [taskJSON(["projectId": ""])]], .malformedTask)
    }

    func test_载荷_focus的sessionTitle允许空字符串() {
        // ⚠️ TS 只要求 `typeof === 'string'`。这里若写"非空"就比 TS 更严 ——
        //    而更严的后果是"应用产出的合法快照被 iOS 拒绝 → 组件永远显示占位"。
        let raw: [String: Any] = ["today": [], "focus": ["active": true, "sessionTitle": ""]]
        guard case .ok(let p) = WidgetParsing.parsePayload(raw) else {
            return XCTFail("空字符串标题应当通过")
        }
        XCTAssertEqual(p.focus?.sessionTitle, "")
    }

    func test_载荷_focus_active必须是布尔() {
        assertPayloadRejection(["today": [], "focus": ["active": "yes"]], .malformedSection)
        assertPayloadRejection(["today": [], "focus": ["active": 1]], .malformedSection)
    }

    func test_载荷_习惯的streak是Double() {
        // 契约不要求整数 —— `3.5` 是合法的，收成 Int 是**渲染层**的事。
        let raw: [String: Any] = [
            "today": [],
            "habits": [["id": "h1", "title": "跑步", "doneToday": true, "streak": 3.5]],
        ]
        guard case .ok(let p) = WidgetParsing.parsePayload(raw) else {
            return XCTFail("应当通过")
        }
        XCTAssertEqual(p.habits?.first?.streak, 3.5)
        XCTAssertEqual(p.habits?.first?.streakCount, 3)
    }

    func test_载荷_象限超限被拒() {
        let over = (0...widgetMaxTasks).map { taskJSON(["id": "t\($0)"]) }
        assertPayloadRejection(["today": [], "quadrant": ["1": over]], .tooManyTasks)
    }

    func test_载荷_可选段缺席是合法的() {
        guard case .ok(let p) = WidgetParsing.parsePayload(["today": []]) else {
            return XCTFail("只有 today 应当通过")
        }
        XCTAssertNil(p.quadrant)
        XCTAssertNil(p.habits)
        XCTAssertNil(p.focus)
        XCTAssertNil(p.projectColors)
    }

    private func assertPayloadRejection(
        _ raw: [String: Any], _ expected: PayloadRejection,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        // 同样走 JSON 往返，让 `NSNull` / `NSNumber` 真实出现。
        let data = try! JSONSerialization.data(withJSONObject: raw)
        let normalized = try! JSONSerialization.jsonObject(with: data)

        guard case .rejected(let reason, _) = WidgetParsing.parsePayload(normalized) else {
            return XCTFail("期望被拒（\(expected)），实际通过了", file: file, line: line)
        }
        XCTAssertEqual(reason, expected, file: file, line: line)
    }

    // ─────────────────────────────────────────────────────────────
    // 意图队列
    // ─────────────────────────────────────────────────────────────

    private func queueJSON(_ intents: [[String: Any]], v: Any = widgetIntentVersion) -> Data {
        try! JSONSerialization.data(withJSONObject: ["v": v, "intents": intents])
    }

    private func intentJSON(_ taskId: String, _ done: Bool, _ at: Double = 0) -> [String: Any] {
        ["taskId": taskId, "targetIsDone": done, "at": at]
    }

    func test_意图_正常解析() {
        let q = WidgetIntentQueues.parse(queueJSON([intentJSON("t1", true)]))
        XCTAssertEqual(q.intents.count, 1)
        XCTAssertEqual(q.intents[0].taskId, "t1")
        XCTAssertTrue(q.intents[0].targetIsDone)
    }

    func test_意图_坏数据一律给空队列() {
        XCTAssertTrue(WidgetIntentQueues.parse(nil as Data?).intents.isEmpty)
        XCTAssertTrue(WidgetIntentQueues.parse(Data("not json".utf8)).intents.isEmpty)
        XCTAssertTrue(WidgetIntentQueues.parse(Data("null".utf8)).intents.isEmpty)
        XCTAssertTrue(WidgetIntentQueues.parse(Data("[1,2]".utf8)).intents.isEmpty)
        // v 不认识
        XCTAssertTrue(WidgetIntentQueues.parse(queueJSON([], v: 99)).intents.isEmpty)
        // 任一条目坏 → **整体拒绝**，不是跳过坏的
        XCTAssertTrue(WidgetIntentQueues.parse(queueJSON([intentJSON("t1", true), ["taskId": "t2"]]))
            .intents.isEmpty, "任一条目坏必须整体拒绝 —— 跳过坏的会永久掩盖写入方的 bug")
    }

    func test_载荷_focus_endsAt是可选的安全整数() throws {
        func parse(_ focus: [String: Any]) throws -> WidgetPayload {
            let raw: [String: Any] = ["today": [], "focus": focus]
            let data = try JSONSerialization.data(withJSONObject: raw)
            let obj = try JSONSerialization.jsonObject(with: data)
            switch WidgetParsing.parsePayload(obj) {
            case let .ok(payload): return payload
            case let .rejected(reason, detail): throw NSError(domain: "\(reason)", code: 1, userInfo: [NSLocalizedDescriptionKey: detail ?? ""])
            }
        }

        // 缺省合法（向前兼容：旧发布方不写它）
        let omitted = try parse(["active": true])
        XCTAssertNil(omitted.focus?.endsAt)

        // 合法值被读进来
        let ok = try parse(["active": true, "endsAt": 1_790_000_000_000])
        XCTAssertEqual(ok.focus?.endsAt, 1_790_000_000_000)

        // 🔴 边界：0 与 MAX 都收，越界 1 毫秒就拒
        XCTAssertEqual(try parse(["active": true, "endsAt": 0]).focus?.endsAt, 0)
        XCTAssertEqual(try parse(["active": true, "endsAt": 8_640_000_000_000_000]).focus?.endsAt, 8_640_000_000_000_000)

        // 🔴 `null` / 小数 / 负数 / 越界 / 字符串 一律拒绝。
        //    小数尤其关键：毫秒时刻没有小数，接受它会让 "1.5 毫秒" 一路
        //    走进灵动岛的时间轴（`Text(timerInterval:)`）里。
        for bad: Any in [NSNull(), 1.5, -1, 8_640_000_000_000_001, "1790000000000", true] {
            XCTAssertThrowsError(try parse(["active": true, "endsAt": bad]), "应拒绝 \(bad)")
        }
    }

    func test_意图_超限整体拒绝() {
        let many = (0...widgetIntentMax).map { intentJSON("t\($0)", true, Double($0)) }
        XCTAssertTrue(
            WidgetIntentQueues.parse(queueJSON(many)).intents.isEmpty,
            "超限本身就说明写入方有 bug → 整体拒绝"
        )
    }

    func test_意图_合并是后写者胜() {
        let q = WidgetIntentQueue([WidgetIntent(taskId: "t1", targetIsDone: true, at: 0)])
        let merged = WidgetIntentQueues.merge(q, WidgetIntent(taskId: "t1", targetIsDone: false, at: 1))

        XCTAssertEqual(merged.intents.count, 1, "同一 taskId 只留一条")
        XCTAssertFalse(merged.intents[0].targetIsDone, "后来的意图必须胜出")
    }

    func test_意图_合并把新条目放到末尾() {
        let q = WidgetIntentQueue([
            WidgetIntent(taskId: "a", targetIsDone: true, at: 0),
            WidgetIntent(taskId: "b", targetIsDone: true, at: 0),
        ])
        let merged = WidgetIntentQueues.merge(q, WidgetIntent(taskId: "a", targetIsDone: false, at: 1))
        XCTAssertEqual(merged.intents.map(\.taskId), ["b", "a"])
    }

    /// 🔴 **先折叠，再截断。**
    ///
    /// 反过来（先截断再折叠）会让"同一条任务的旧意图"挤掉更值得保留的别的任务。
    func test_意图_先折叠再截断() {
        var q = WidgetIntentQueue(
            (0..<widgetIntentMax).map { WidgetIntent(taskId: "t\($0)", targetIsDone: true, at: Double($0)) }
        )
        // 再点第 0 条 —— 总条数不该增长（是折叠，不是追加）。
        q = WidgetIntentQueues.merge(q, WidgetIntent(taskId: "t0", targetIsDone: false, at: 100))
        XCTAssertEqual(q.intents.count, widgetIntentMax, "折叠之后不该超限")
        XCTAssertEqual(q.intents.last?.taskId, "t0", "最近点击的必须还在（且被放到了末尾）")

        // 真正的新条目才触发截断，并且丢的是**最旧**的。
        q = WidgetIntentQueues.merge(q, WidgetIntent(taskId: "brand-new", targetIsDone: true, at: 200))
        XCTAssertEqual(q.intents.count, widgetIntentMax)
        XCTAssertEqual(q.intents.last?.taskId, "brand-new")
        XCTAssertFalse(q.intents.contains { $0.taskId == "t1" }, "最旧的应当被丢掉")
    }

    /**
     🔴 这条测试来自一个**真实存在过的 bug**。

     `mergeAll(queue, incoming)` 的约定是"第二个参数更新"。而 drain 写回时
     那批意图是**更旧的**，中间用户完全可能又点了一下（那个点击是**更新的**）。

     写反的后果：用户的"取消勾选"被 drain 写回时**覆盖回已完成** ——
     他看到的是"我明明取消了，它自己又勾上了"。

     只在「drain 期间又点了 + 那条 op 失败」这个窄窗口出现，
     所以**不可能靠手工测试发现**。修法不是加注释提醒顺序，而是让顺序写不反。
     */
    func test_意图_写回更旧的意图不能盖掉期间的新点击() {
        // T1：用户在组件上取消勾选 t1（容器里现在是这个）
        let current = WidgetIntentQueue([WidgetIntent(taskId: "t1", targetIsDone: false, at: 100)])
        // T0：drain 更早读走的那批（失败后要写回）
        let older = [WidgetIntent(taskId: "t1", targetIsDone: true, at: 50)]

        let merged = WidgetIntentQueues.mergeOlderIntoNewer(current, older)

        XCTAssertEqual(merged.intents.count, 1)
        XCTAssertFalse(
            merged.intents[0].targetIsDone,
            "更旧的意图不能覆盖更新的点击 —— 否则用户的「取消」会被静默回滚"
        )
    }
}
