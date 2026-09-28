import XCTest

@testable import HeytaWidgetBridge
import HeytaWidgetCore

/**
 桥接层的测试（W2-4）。
 ======================

 ## 为什么这些测试**不读黄金夹具**

 黄金夹具锁的是**解密侧**（`GoldenFixtureTests`：CryptoKit 能解开 Node 产出的密文，
 AAD 逐字符相同）。这里锁的是**加密侧**（应用产出的信封能被自己的读取器读懂）。

 两条锁是**互补**的，而且中间的接缝已经有一处专门的断言：
 `GoldenFixtureTests.test_AAD字符串逐字符正确` 钉死了
 `"1|2026-09-27|1790000000000"` 这个精确字符串，而 `WidgetSealer` 走的正是
 `WidgetEnvelope.makeAad` —— **同一个函数**。所以"加密侧用的 AAD 与夹具一致"
 这件事不是靠这里的测试，而是靠 `makeAad` 只有一处实现 + 那一处被夹具钉死。

 ⚠️ 第一版我在 `WidgetSealer` 里**又拼了一遍** AAD，于是加密侧用 `Double`、
 解密侧用 `Int64` —— 自己加密的东西自己解不开，而且编译期完全看不出来。
 那次修改同时把拼法收敛成了 `makeAad`，这条路径现在才成立。

 ## 这里真正在测的，是五个方法各自的**纪律**

 | 方法 | 纪律 | 对应测试 |
|---|---|---|
| `setWidgetSnapshot` | 坏信封必须在**写入点**被拒，不能落盘 | `test_坏信封必须被拒且不落盘` |
| `setWidgetSnapshot` | 推送必须在写入**之后**（否则失败会被误报成写入失败） | `test_推送发生在落盘之后` |
| `drainIntentQueue` | 读 + 清，且返回**原始 JSON** | `test_drain是读后即清` |
| `mergeIntentQueue` | **合并**，且"容器里的更新" | `test_写回更旧的意图不能盖掉期间的新点击` |
| `clearWidgetState` | 先删密钥、再清容器 | `test_登出先删密钥再清容器` |
| `sealWidgetSnapshot` | 密钥不穿桥；AAD 取整 | `test_seal与读取器闭环` |
 */
final class WidgetBridgeTests: XCTestCase {

    // ─────────────────────────────────────────────────────────────
    // 测试替身
    // ─────────────────────────────────────────────────────────────

    /**
     跨替身的**共享**操作日志。
 
     🔴 第一版我在 `FakeStore` 和 `FakeKeyStore` 里**各放了一个** `log` 数组，
     而 `test_登出先删密钥再清容器` 断言的是"各自的 log 分别是 [\"delete\"] 和 [\"clearAll\"]"——
     **那条测试不可能失败**：交换两行代码的顺序，两个数组的内容完全不变。
     注入验证（把 `clearWidgetState` 的两行对调）红了 **0 条**，才发现它是个摆设。
     顺序纪律必须**跨对象**记录才看得见 —— 所以日志是一个引用类型，两个替身共用。
 
     ⚠️ 这条与 `AGENTS.md` §5「不可能失败的检查一文不值」是同一件事，
     但形状不同：那条说的是**断言太弱**，这条说的是**观测点选错了对象**。
     */
    private final class OpLog {
        var entries: [String] = []
        func append(_ name: String) { entries.append(name) }
    }

    /// 内存容器。
    private final class FakeStore: WidgetBridgeService.Store {
        var snapshot: Data?
        var intents: WidgetIntentQueue = .empty
        /// 跨替身的共享日志（见 [OpLog]）。
        let log: OpLog
        /// 让 `updateIntents` 的闭包在被调用时**再塞一条更新的意图** ——
        /// 这正是 drain 窗口竞态的形状。
        var injectDuringUpdate: WidgetIntent?

        init(log: OpLog) { self.log = log }

        func readSnapshot() -> Data? {
            log.append("readSnapshot")
            return snapshot
        }

        func writeSnapshot(_ envelope: Data) throws {
            log.append("writeSnapshot")
            snapshot = envelope
        }

        func drainIntents() -> String? {
            log.append("drainIntents")
            guard !intents.intents.isEmpty else { return nil }
            let raw = Self.encode(intents)
            intents = .empty
            return raw
        }

        func updateIntents(_ body: (WidgetIntentQueue) -> WidgetIntentQueue) -> WidgetIntentQueue {
            log.append("updateIntents")
            // ⚠️ 竞态注入点：真实世界里这是"另一个进程/另一个线程在
            //    读与写之间又点了一下"。没有这个注入，"合并 vs 覆盖"
            //    这两种实现的**测试结果完全一样**。
            if let injected = injectDuringUpdate {
                intents = WidgetIntentQueues.merge(intents, injected)
                injectDuringUpdate = nil
            }
            intents = body(intents)
            return intents
        }

        func clearAll() {
            log.append("clearAll")
            snapshot = nil
            intents = .empty
            // ⚠️ **刻意不动 `privacy`** —— 见下面那条测试。
            //    "清掉组件状态"是清**数据**，不是清**用户的隐私设置**。
        }

        /// W5-2 · 隐私偏好的替身。与 `snapshot` 分开，形状与真实的两个文件一致。
        var privacy: Any?

        func readPrivacy() -> Any? {
            log.append("readPrivacy")
            return privacy
        }

        func writePrivacy(_ object: [String: Any]) throws {
            log.append("writePrivacy")
            privacy = object
        }

        static func encode(_ q: WidgetIntentQueue) -> String {
            let obj: [String: Any] = [
                "v": widgetIntentVersion,
                "intents": q.intents.map {
                    ["taskId": $0.taskId, "targetIsDone": $0.targetIsDone, "at": $0.at]
                },
            ]
            let data = try! JSONSerialization.data(withJSONObject: obj)
            return String(decoding: data, as: UTF8.self)
        }
    }

    // ─────────────────────────────────────────────────────────────
    // W5-2 · 隐私偏好的写入侧
    // ─────────────────────────────────────────────────────────────

    func test_隐私偏好_写入后能读回来() throws {
        let (service, store, _, _, _) = makeService()

        try service.setWidgetPrivacy(alwaysHideTitles: true)

        XCTAssertTrue(WidgetPrivacyPreference.parse(store.privacy).alwaysHideTitles)
    }

    /// 没写过 → 回落**默认（不隐藏）**，理由见 `WidgetPrivacyPreference` 文件头：
    /// 这条路径上的"读不到"绝大多数是配置问题，隐藏会让**配置问题看起来像产品问题**。
    func test_隐私偏好_没写过时回落默认() {
        let (service, _, _, _, _) = makeService()

        XCTAssertFalse(WidgetPrivacyPreference.parse(service.readPrivacyRaw()).alwaysHideTitles)
    }

    func test_隐私偏好_能被关回去() throws {
        let (service, store, _, _, _) = makeService()

        try service.setWidgetPrivacy(alwaysHideTitles: true)
        try service.setWidgetPrivacy(alwaysHideTitles: false)

        XCTAssertFalse(WidgetPrivacyPreference.parse(store.privacy).alwaysHideTitles)
    }

    /// "没写过"（`nil`）与"写了个坏值"必须能区分 —— 前者正常，后者要查。
    func test_隐私偏好_nil与坏值都能落到默认但可区分() {
        let (service, _, _, _, _) = makeService()

        XCTAssertNil(service.readPrivacyRaw(), "没写过时必须是 nil，不能伪造一个默认对象")

        XCTAssertFalse(WidgetPrivacyPreference.parse(["alwaysHideTitles": "yes"]).alwaysHideTitles)
    }

    /// 🔴 **清组件状态不能把隐私偏好一起清掉。**
    ///
    /// 这不是洁癖 —— 反过来的后果很严重：用户打开了「始终隐藏标题」，
    /// 某天清一次凭据（换账号 / 重新登录），锁屏就**又开始显示任务标题了**，
    /// 而用户以为那个开关还开着。**一个会自己关掉的安全开关比没有更坏**，
    /// 因为它会让人以为已经设过了。
    func test_清组件状态_不能清掉隐私偏好() throws {
        let (service, store, _, _, _) = makeService()

        try service.setWidgetPrivacy(alwaysHideTitles: true)
        service.clearWidgetState()

        XCTAssertNil(store.snapshot, "快照必须被清掉")
        XCTAssertTrue(
            WidgetPrivacyPreference.parse(store.privacy).alwaysHideTitles,
            "清组件状态把用户的隐私选择一起清掉了 —— 锁屏会重新显示标题"
        )
    }

    private final class FakeKeyStore: WidgetBridgeService.KeyStore {
        var key: Data?
        /// **同一个** [OpLog] 实例 —— 顺序纪律跨对象。
        let log: OpLog

        init(log: OpLog, key: Data? = Data(repeating: 0x42, count: widgetKeyBytes)) {
            self.log = log
            self.key = key
        }

        func getOrCreate() throws -> Data {
            log.append("getOrCreate")
            if let key { return key }
            let fresh = Data(repeating: 0x7f, count: widgetKeyBytes)
            key = fresh
            return fresh
        }

        func delete() {
            log.append("delete")
            key = nil
        }
    }

    private final class Counter { var n = 0 }

    /// 一次调用建出**互相关联**的一套替身：store 与 keyStore 共用一个 `OpLog`。
    private func makeService() -> (service: WidgetBridgeService, store: FakeStore, keyStore: FakeKeyStore, log: OpLog, pushCount: () -> Int) {
        let log = OpLog()
        let store = FakeStore(log: log)
        let keyStore = FakeKeyStore(log: log)
        let counter = Counter()
        let service = WidgetBridgeService(
            store: store,
            keyStore: keyStore,
            push: { counter.n += 1 }
        )
        return (service, store, keyStore, log, { counter.n })
    }

    private let dayStr = "2026-09-27"
    private let validUntil: Double = 1_790_000_000_000

    private func payloadJson() -> String {
        """
        {"today":[{"id":"t1","title":"买牛奶","isDone":false}],\
        "quadrant":{"1":[],"2":[],"3":[],"4":[]},\
        "habits":[],\
        "focus":{"active":false},\
        "projectColors":{}}
        """
    }

    // ─────────────────────────────────────────────────────────────
    // sealWidgetSnapshot —— 加密侧与读取器闭环
    // ─────────────────────────────────────────────────────────────

    func test_seal与读取器闭环() throws {
        let (service, _, _, _, _) = makeService()

        let envelopeJson = try service.sealWidgetSnapshot(
            payloadJson: payloadJson(),
            dayStr: dayStr,
            validUntil: validUntil
        )

        // ① 产生的必须是**合法信封**（这一步走的是应用侧那条校验）
        try service.setWidgetSnapshot(envelopeJson)

        // ② 用**同一把密钥**读回来 —— 走的是组件的生产路径
        let (_, store, keyStore, _, _) = makeService()
        try store.writeSnapshot(Data(envelopeJson.utf8))
        // ⚠️ `keyProvider` 是 `@Sendable`，而 `FakeKeyStore` 是个类（非 Sendable）。
        //    所以把**值**取出来捕获，不要捕获那个替身本身。
        let key = keyStore.key
        let content = WidgetSnapshotReader(keyProvider: { key }).read(
            rawSnapshot: store.snapshot,
            queue: .empty,
            now: validUntil - 1
        )

        XCTAssertEqual(content.state, .ready, "自己封的信封必须能被自己的读取器读懂")
        XCTAssertEqual(content.dayStr, dayStr)
        XCTAssertEqual(content.payload?.today.first?.title, "买牛奶")
        XCTAssertEqual(content.payload?.today.first?.isDone, false)
    }

    func test_seal的AAD与夹具认定的一致() throws {
        // 🔴 这条盯的是"加密侧不要自己拼 AAD"。
        //    值与 `GoldenFixtureTests.test_AAD字符串逐字符正确` 里那个完全相同 ——
        //    两边都走 `WidgetEnvelope.makeAad`，所以这里红了说明拼法被改了。
        XCTAssertEqual(
            WidgetEnvelope.makeAad(v: widgetContractVersion, dayStr: "2026-09-27", validUntil: 1_790_000_000_000),
            "1|2026-09-27|1790000000000"
        )
        // 小数形式（`.0`）绝不能出现
        XCTAssertFalse(
            WidgetEnvelope.makeAad(v: 1, dayStr: "d", validUntil: 1_790_000_000_000).contains(".0")
        )
    }

    func test_seal每次nonce都不同() throws {
        let (service, _, _, _, _) = makeService()
        let a = try service.sealWidgetSnapshot(payloadJson: payloadJson(), dayStr: dayStr, validUntil: validUntil)
        let b = try service.sealWidgetSnapshot(payloadJson: payloadJson(), dayStr: dayStr, validUntil: validUntil)

        // 🔴 同一把密钥 + 同一个 nonce 加密两份不同明文会让 AES-GCM 的认证强度**归零**。
        //    这里虽然明文相同，但 nonce 复用本身就该被禁止（它让"是否复用"无法被审计）。
        XCTAssertNotEqual(a, b, "两次 seal 必须产生不同的 nonce（否则是 nonce 复用）")
    }

    func test_seal拒绝越界的validUntil() {
        let key = Data(repeating: 1, count: widgetKeyBytes)

        // 小数：会拼出 "...000.5" 这种 AAD，四端全都对不上
        XCTAssertThrowsError(
            try WidgetSealer.seal(payloadJson: "{}", dayStr: dayStr, validUntil: 1_790_000_000_000.5, key: key)
        ) { error in
            XCTAssertEqual(error as? WidgetSealer.Failure, .badValidUntil(1_790_000_000_000.5))
        }

        XCTAssertThrowsError(
            try WidgetSealer.seal(payloadJson: "{}", dayStr: dayStr, validUntil: -1, key: key)
        )
        XCTAssertThrowsError(
            try WidgetSealer.seal(payloadJson: "{}", dayStr: dayStr, validUntil: Double(WidgetParsing.maxEpochMs) + 1, key: key)
        )
    }

    func test_seal拒绝空dayStr与错长度密钥() {
        let key = Data(repeating: 1, count: widgetKeyBytes)

        XCTAssertThrowsError(
            try WidgetSealer.seal(payloadJson: "{}", dayStr: "", validUntil: validUntil, key: key)
        ) { XCTAssertEqual($0 as? WidgetSealer.Failure, .emptyDayStr) }

        // ⚠️ 16 字节的密钥在 AES 里是合法的（AES-128），但契约规定 32 ——
        //    放过去会让"某一端用 AES-128"成为可能，而密文本身不携带密钥长度。
        XCTAssertThrowsError(
            try WidgetSealer.seal(payloadJson: "{}", dayStr: dayStr, validUntil: validUntil, key: Data(repeating: 1, count: 16))
        ) { XCTAssertEqual($0 as? WidgetSealer.Failure, .badKeyLength(16)) }
    }

    // ─────────────────────────────────────────────────────────────
    // setWidgetSnapshot
    // ─────────────────────────────────────────────────────────────

    func test_坏信封必须被拒且不落盘() throws {
        let (service, store, _, _, _) = makeService()

        // `alg: "none"` —— 一个非常真实的错误：某个平台写了个不加密的信封。
        let bad = """
        {"v":1,"dayStr":"2026-09-27","validUntil":1790000000000,"alg":"none","nonce":"AAAA","ciphertext":"AAAA"}
        """
        XCTAssertThrowsError(try service.setWidgetSnapshot(bad)) { error in
            guard case .invalidEnvelope(let reason, _) = error as? WidgetBridgeService.Failure else {
                return XCTFail("应当是 invalidEnvelope，实际 \(error)")
            }
            // 🔴 拒绝原因的词必须与 TS / Android / 组件侧**是同一套** ——
            //    否则"为什么被拒"在三个平台的日志里是三种说法。
            XCTAssertEqual(reason, "unsupported-alg")
        }
        XCTAssertNil(store.snapshot, "被拒的信封绝不能落盘")
        XCTAssertEqual(store.log.entries, [], "被拒时连一次写都不该发生")
    }

    func test_非JSON必须被拒() {
        let (service, store, _, _, _) = makeService()
        XCTAssertThrowsError(try service.setWidgetSnapshot("不是 json")) { error in
            guard case .notJson = error as? WidgetBridgeService.Failure else {
                return XCTFail("应当是 notJson，实际 \(error)")
            }
        }
        XCTAssertNil(store.snapshot)
    }

    func test_推送发生在落盘之后() throws {
        let (service, store, _, log, pushCount) = makeService()
        let envelope = try service.sealWidgetSnapshot(payloadJson: payloadJson(), dayStr: dayStr, validUntil: validUntil)
        // seal 那次会记一条 getOrCreate —— 本条测试只关心 set 之后的顺序。
        log.entries.removeAll()

        try service.setWidgetSnapshot(envelope)

        // 🔴 顺序纪律：推送**必须**在写入成功之后。
        //    Android 那边这条是"推送抛异常不能被误报成写入失败"；
        //    iOS 的 `reloadTimelines` 不抛，但**同一条纪律仍然成立** ——
        //    "写进去了就一定 resolve"是调用方重试/回滚逻辑的前提。
        XCTAssertEqual(store.log.entries, ["writeSnapshot"], "必须先落盘")
        XCTAssertEqual(pushCount(), 1, "落盘之后必须推一次")
    }

    // ─────────────────────────────────────────────────────────────
    // drainIntentQueue / mergeIntentQueue
    // ─────────────────────────────────────────────────────────────

    func test_drain是读后即清且没有点击时给nil() {
        let (service, store, _, _, _) = makeService()

        // ⚠️ 没有点击时给 `nil`，**不是** `"[]"` / `"{}"` ——
        //    调用方要能用一个判断区分"没点击"与"有零条点击"。
        XCTAssertNil(service.drainIntentQueue())

        store.intents = WidgetIntentQueue([
            WidgetIntent(taskId: "t1", targetIsDone: true, at: 100)
        ])

        let raw = service.drainIntentQueue()
        XCTAssertNotNil(raw, "有待处理的点击时必须给字符串")
        XCTAssertTrue(store.intents.intents.isEmpty, "drain 必须清空")
        XCTAssertEqual(WidgetIntentQueues.parse(raw).intents.count, 1, "drain 出来的必须能解析")

        XCTAssertNil(service.drainIntentQueue(), "清空之后再 drain 必须给 nil（幂等）")
    }

    func test_写回更旧的意图不能盖掉期间的新点击() throws {
        let (service, store, _, _, _) = makeService()

        // 用户在组件上点了一下"完成" → 进了容器
        store.intents = WidgetIntentQueue([
            WidgetIntent(taskId: "t1", targetIsDone: true, at: 200)
        ])

        // drain 读走并清空（JS 侧拿到的就是这个）
        let drained = service.drainIntentQueue()
        XCTAssertEqual(WidgetIntentQueues.parse(drained).intents.first?.targetIsDone, true)

        // 🔴 drain 与写回之间，用户**又点了一下"取消"**。
        //    注入发生在 `updateIntents` 的闭包被调用之前 ——
        //    这正是真实竞态的窗口形状。
        store.injectDuringUpdate = WidgetIntent(taskId: "t1", targetIsDone: false, at: 300)

        // JS 侧说"这条执行失败了，写回去"
        let pending = FakeStore.encode(WidgetIntentQueue([
            WidgetIntent(taskId: "t1", targetIsDone: true, at: 200)
        ]))
        let count = try service.mergeIntentQueue(pending)

        XCTAssertEqual(count, 1)
        // 🔴 结论：写回的是**更旧的**（at=200），而容器里的是**更新的**（at=300）。
        //    更新的必须胜出 —— 否则用户会看到"我明明取消了，它自己又勾上了"。
        XCTAssertEqual(
            store.intents.intents.first?.targetIsDone, false,
            "写回的旧意图覆盖了新点击 —— 用户的取消被静默回滚了"
        )
        XCTAssertEqual(store.intents.intents.first?.at, 300, "留下的必须是那条更新的")
    }

    func test_写回不会抹掉别的任务的新点击() throws {
        let (service, store, _, _, _) = makeService()

        store.intents = WidgetIntentQueue([
            WidgetIntent(taskId: "t1", targetIsDone: true, at: 100)
        ])
        _ = service.drainIntentQueue()

        // drain 期间用户点了**另一条**任务
        store.injectDuringUpdate = WidgetIntent(taskId: "t2", targetIsDone: true, at: 200)

        let pending = FakeStore.encode(WidgetIntentQueue([
            WidgetIntent(taskId: "t1", targetIsDone: true, at: 100)
        ]))
        _ = try service.mergeIntentQueue(pending)

        // 🔴 如果实现是"整体覆盖"，t2 会**消失** —— 而它是一次真实的点击。
        XCTAssertEqual(store.intents.intents.count, 2, "另一个任务的新点击不能被覆盖掉")
        XCTAssertTrue(store.intents.intents.contains { $0.taskId == "t2" })
    }

    // ─────────────────────────────────────────────────────────────
    // clearWidgetState
    // ─────────────────────────────────────────────────────────────

    func test_登出先删密钥再清容器() throws {
        let (service, store, keyStore, log, _) = makeService()
        try service.setWidgetSnapshot(
            try service.sealWidgetSnapshot(payloadJson: payloadJson(), dayStr: dayStr, validUntil: validUntil)
        )
        store.intents = WidgetIntentQueue([WidgetIntent(taskId: "t1", targetIsDone: true, at: 1)])
        log.entries.removeAll()

        service.clearWidgetState()

        // 🔴 顺序：**先删密钥**。反过来的话，两步之间崩溃会留下
        //    "旧密文 + 无密钥" —— 虽然不是可解开的，但先删密钥能让
        //    "任何一刻崩溃都不会留下**可解开的**旧密文"这一点成立。
        //
        //    ⚠️ 断言的是**共享日志的完整序列**，不是各自的数组 ——
        //       后者看不出顺序（见 [OpLog] 的注释）。
        XCTAssertEqual(log.entries, ["delete", "clearAll"], "必须先删密钥、再清容器")
        XCTAssertNil(store.snapshot)
        XCTAssertTrue(store.intents.intents.isEmpty)
        XCTAssertNil(keyStore.key)
    }

    func test_登出必须同时清密钥与快照() throws {
        let (service, store, keyStore, _, _) = makeService()
        try service.setWidgetSnapshot(
            try service.sealWidgetSnapshot(payloadJson: payloadJson(), dayStr: dayStr, validUntil: validUntil)
        )
        XCTAssertNotNil(store.snapshot)
        XCTAssertNotNil(keyStore.key)

        service.clearWidgetState()

        // 🔴 只清一处就会出现：下一个人登录后组件**能显示上一个账号的旧快照**
        //    （如果密钥还在），或者永远显示占位符（如果密钥清了、密文没清）。
        //    两种都不会报错。
        XCTAssertNil(keyStore.key, "密钥必须清")
        XCTAssertNil(store.snapshot, "快照必须清")
    }

    // ─────────────────────────────────────────────────────────────
    // parse(String?) 重载
    // ─────────────────────────────────────────────────────────────

    func test_字符串重载与Data重载行为一致() {
        let good = FakeStore.encode(WidgetIntentQueue([
            WidgetIntent(taskId: "t1", targetIsDone: true, at: 1)
        ]))

        XCTAssertEqual(WidgetIntentQueues.parse(good).intents.count, 1)
        XCTAssertEqual(WidgetIntentQueues.parse(Optional(good)).intents.count, 1)
        XCTAssertTrue(WidgetIntentQueues.parse(nil as String?).intents.isEmpty)
        // 坏数据降级为空（与四端解析器同一策略）
        XCTAssertTrue(WidgetIntentQueues.parse("不是 json").intents.isEmpty)
    }
}
