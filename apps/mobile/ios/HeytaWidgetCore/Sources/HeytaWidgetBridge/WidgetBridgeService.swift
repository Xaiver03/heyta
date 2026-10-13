import Foundation

import HeytaWidgetCore

/**
 RN 桥接的**全部逻辑** —— 但一行 React 都不 import。
 ==================================================

 ## 🔴 为什么要这样切

 `RCTBridgeModule` 需要 `React`，而 `React` 在 iOS 工程里是 **CocoaPods 的 Pod**，
 不是 SwiftPM 依赖。所以"能被 `swift test` 跑"和"能 `import React`"是互斥的。

 第一版的想法是"把桥接模块写进 app target"—— 那意味着这五个方法
 **一条测试都跑不了**，而它们恰好是：

 | 方法 | 写错的后果 |
 |---|---|
 | `setWidgetSnapshot` | 不校验就落盘 → 组件读到坏数据，只显示空列表 |
 | `drainIntentQueue` | 不是"读+清"原子 → 同一个点击被 drain 两次 |
 | `mergeIntentQueue` | 写成覆盖而不是合并 → 用户在 drain 期间的点击**被抹掉** |
 | `sealWidgetSnapshot` | AAD 不取整 → **四端全都解不开** |
 | `clearWidgetState` | 只清一处 → 下一个人登录看到上一个人的数据 |

 所以切法是把**逻辑**放进这个 SwiftPM target（可测），
 把**转发**留在 app target（十行 `@objc`，没有逻辑可错）。

 这是"可验证性驱动结构"的又一个例子 —— 与整个 SwiftPM 包的动机同源。

 ## 依赖注入的两个口子

 - [store]：共享容器的读/写。真实现走 App Group + `NSFileCoordinator`；
   测试用内存实现 —— 而**并发顺序的测试只有用内存实现才写得出**。
 - [push]：写入成功后主动推一次刷新。真实现是
   `WidgetCenter.shared.reloadAllTimelines()`；测试里是一个计数器。

 `push` 之所以是**回调**而不是直接调 WidgetKit，还有第二个理由：
 `setWidgetSnapshot` 的顺序纪律（**先 resolve、后 push、push 自己吞异常**）
 只有在 push 能被注入时才测得出来。
 */
public struct WidgetBridgeService {

    public enum Failure: Error, Equatable {
        case notJson(String)
        /// 契约拒绝。`reason` 用的词与 TS / Android / 组件侧是**同一套**。
        case invalidEnvelope(reason: String, detail: String)
        case writeFailed(String)
        case readFailed(String)
        case ackFailed(String)
        case clearFailed(String)
        case sealFailed(String)
    }

    /// 共享容器的读写口。
    ///
    /// ⚠️ `updateIntents` 的读-改-写**必须由 store 保证原子**
    /// （真实现用 `NSFileCoordinator`，因为应用与扩展是**两个进程**）。
    /// 让 service 去"先读一次、再写一次"会把竞态搬进一个窗口更大的地方。
    public protocol Store {
        func readSnapshot() -> Data?
        func writeSnapshot(_ envelope: Data) throws
        /// **读取原始 JSON（非破坏）**。`nil` = 没有待处理的点击。
        func drainIntents() throws -> String?
        /// 精确确认已处理的点击，返回实际删除数量。
        func ackIntents(_ processed: WidgetIntentQueue) throws -> Int
        /// 原子读-改-写。返回写回之后的队列。
        func updateIntents(_ body: (WidgetIntentQueue) -> WidgetIntentQueue) -> WidgetIntentQueue
        func clearAll() throws

        /// W5-2 · 读锁屏隐私偏好的**原始值**（未解析）。`nil` = 没写过。
        ///
        /// ⚠️ 为什么不复用 `readSnapshot()`：隐私偏好与快照是**两个文件**。
        ///    同一个文件的话，"发布一份新快照"会把它覆盖成默认值 ——
        ///    用户打开的"始终隐藏标题"会在下一次刷新时**悄悄关掉**。
        func readPrivacy() -> Any?

        /// W5-2 · 写隐私偏好。**只有应用侧会调**（组件扩展是只读的）。
        func writePrivacy(_ object: [String: Any]) throws
    }

    /// 设备密钥。**只有应用侧有 `getOrCreate`**（理由见扩展侧 `WidgetDeviceKey` 的注释）。
    public protocol KeyStore {
        func getOrCreate() throws -> Data
        func delete() throws
    }

    private let store: Store
    private let keyStore: KeyStore
    private let push: () -> Void

    public init(store: Store, keyStore: KeyStore, push: @escaping () -> Void) {
        self.store = store
        self.keyStore = keyStore
        self.push = push
    }

    // ─────────────────────────────────────────────────────────────
    // setWidgetSnapshot
    // ─────────────────────────────────────────────────────────────

    /**
     写入一份**已加密**的信封。**先校验、再落盘；先 resolve、再推送。**

     ## 🔴 校验为什么必须在这里

     这里存进去的东西，下一步就是被组件在**别人的进程、没有日志可看**的地方读出来。
     应用若写下 `projectId: null` 或 `alg: "none"` 的信封，组件只会安静地空列表 ——
     而"组件没数据"这个症状有十几种成因。所以在**写入点**拒绝：
     责任落在有日志、有堆栈、能被调试的那一侧。

     ## 🔴 推送为什么必须在 resolve 之后、且自己吞异常

     如果推送放在同一个 `do` 里，`reloadAllTimelines()` 一抛
     （WidgetKit 在某些状态会抛），调用方收到的就是"写入失败" ——
     **而快照其实已经落盘了**。应用会重试、甚至回滚一个已经成功的操作，
     症状是"有时提示失败，但组件其实更新了"，极难归因。

     推送失败本身没什么可补救的：WidgetKit 会在下一次应用刷新时再推一次。
     */
    public func setWidgetSnapshot(_ envelopeJson: String) throws {
        guard let data = envelopeJson.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw Failure.notJson("快照不是合法 JSON 对象")
        }

        let parsed = WidgetParsing.parseEnvelope(obj as Any)
        if case .rejected(let reason, let detail) = parsed {
            throw Failure.invalidEnvelope(reason: rejectionName(reason), detail: detail)
        }

        do {
            try store.writeSnapshot(data)
        } catch {
            throw Failure.writeFailed("\(error)")
        }

        // 到这里**已经成功**。推送是尽力而为，失败不影响本次写入的成败。
        push()
    }

    // ─────────────────────────────────────────────────────────────
    // drainIntentQueue / mergeIntentQueue
    // ─────────────────────────────────────────────────────────────

    /**
     读取意图队列的**原始 JSON**，不会清空。`nil` = 没有待处理的点击；成功处理后由 `ackIntentQueue` 精确确认。

     ⚠️ 刻意**不在原生侧解析**：队列语义（last-wins 折叠、上限 50、类型校验）
     只有一份真源，在 `@heyta/widget-core` 的 `parseIntentQueue` 里。
     原生再实现一遍就是第二个真源，而两个真源会漂移、且**不会报错**。

     ⚠️ 返回 `nil` 而不是 `"[]"` 或 `"{}"`：**"没有点击"与"有零条点击"**
     在 JS 侧要走不同的分支（前者直接跳过 drain），而 `"[]"` 会被
     `JSON.parse` 成一个空数组 —— 调用方必须判断两种形态。`nil` 只有一种含义。
     */
    public func drainIntentQueue() throws -> String? {
        do {
            return try store.drainIntents()
        } catch {
            throw Failure.readFailed("读取小组件意图失败：\(error)")
        }
    }

    /// 精确确认已处理的意图。原生只删除与 processedJson 中三元组完全相同的条目。
    public func ackIntentQueue(_ processedJson: String) throws -> Int {
        guard let data = processedJson.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
              let object = root as? [String: Any],
              let version = object["v"] as? Int, version == widgetIntentVersion,
              let rawIntents = object["intents"] as? [Any] else {
            throw Failure.ackFailed("确认的小组件意图不是合法队列")
        }
        let processed = WidgetIntentQueues.parse(data)
        guard rawIntents.isEmpty || !processed.intents.isEmpty else {
            throw Failure.ackFailed("确认的小组件意图包含无效条目")
        }
        do {
            return try store.ackIntents(processed)
        } catch {
            throw Failure.ackFailed("确认小组件意图失败：\(error)")
        }
    }

    /**
     兼容旧版调用方的失败意图合并路径。新流程使用 `ackIntentQueue`，
     但保留这个入口以便旧客户端升级过程中不丢失待处理点击。
     */
    public func mergeIntentQueue(_ pendingJson: String) throws -> Int {
        let pending = WidgetIntentQueues.parse(Data(pendingJson.utf8))
        let merged = store.updateIntents { current in
            WidgetIntentQueues.mergeOlderIntoNewer(current, pending.intents)
        }
        return merged.intents.count
    }

    // ─────────────────────────────────────────────────────────────
    // W5-2 · 锁屏隐私偏好
    // ─────────────────────────────────────────────────────────────

    /**
     读锁屏隐私偏好。**解析真源在 `WidgetPrivacyPreference.parse`**（纯逻辑、有测试），
     这里只负责把原始值取出来 —— 与 `drainIntentQueue` 同一分工。

     ⚠️ 返回 `Any?` 而不是 `Bool` 是刻意的：**"没写过"与"写了个坏值"必须能区分**。
     两者都会回落默认值，但前者是"用户还没设过"（正常），后者是"文件坏了"（要查）。
     */
    public func readPrivacyRaw() -> Any? {
        store.readPrivacy()
    }

    /**
     写锁屏隐私偏好。

     ⚠️ **不做任何校验**是刻意的：这一侧的唯一调用者是应用内的一个开关，
     写进去的必然是 `Bool`。而校验放在这里会让**读**那一侧（扩展）也必须容错，
     等于两处都要维护"什么算合法"。所以：写侧相信调用者，读侧对一切都容错，
     并且读侧的容错有 16 条测试钉着（`WidgetW5Tests`）。
     */
    public func setWidgetPrivacy(alwaysHideTitles: Bool) throws {
        try store.writePrivacy(["alwaysHideTitles": alwaysHideTitles])
    }

    // ─────────────────────────────────────────────────────────────
    // clearWidgetState
    // ─────────────────────────────────────────────────────────────

    /**
     登出 / 切换账号。**快照与设备密钥一起清**（D6）。

     只清快照不清密钥，会让下一个登录的人"用旧密钥解新密文" ——
     症状是组件一直显示占位符，看起来只是没数据，但**旧密文还留在磁盘上**
     （那才是要清的东西）。

     ⚠️ 顺序：**先删密钥再清容器**。反过来的话，两步之间崩溃会留下
     "旧密文 + 无密钥" —— 虽然也只是占位符，但先删密钥能让
     "任何一刻崩溃都不会留下**可解开的**旧密文"这一点成立。
     */
    public func clearWidgetState() throws {
        do {
            // 先删密钥，再清共享容器。任何一步失败都必须把失败传给宿主，
            // 不能让登出流程误报成功或继续刷新旧快照。
            try keyStore.delete()
            try store.clearAll()
        } catch {
            throw Failure.clearFailed("清理小组件状态失败：\(error)")
        }

        // 清理已经成功；通知 WidgetKit 让已存在的组件立即重画占位态。
        // 这一步必须在 do/catch 之后，避免清理失败时把刷新误报为成功路径。
        push()
    }

    // ─────────────────────────────────────────────────────────────
    // sealWidgetSnapshot
    // ─────────────────────────────────────────────────────────────

    /**
     把载荷 JSON 封成信封，返回信封 JSON 字符串。**密钥不穿桥。**

     ⚠️ 用 `keyStore.getOrCreate()` 而**不是** `existing()`：
     这里是应用侧（用户正在使用应用），它可以生成密钥。
     组件侧（渲染）恰恰相反。
     */
    public func sealWidgetSnapshot(payloadJson: String, dayStr: String, validUntil: Double) throws -> String {
        let key: Data
        do {
            key = try keyStore.getOrCreate()
        } catch {
            throw Failure.sealFailed("取设备密钥失败：\(error)")
        }

        do {
            return try WidgetSealer.seal(
                payloadJson: payloadJson,
                dayStr: dayStr,
                validUntil: validUntil,
                key: key
            )
        } catch {
            throw Failure.sealFailed("\(error)")
        }
    }

    /// 把契约的拒绝原因映射成与 TS / Android 同一套词。
    private func rejectionName(_ r: EnvelopeRejection) -> String {
        switch r {
        case .notAnObject: return "not-an-object"
        case .unknownVersion: return "unknown-version"
        case .unsupportedAlg: return "unsupported-alg"
        case .malformedEnvelope: return "malformed-envelope"
        }
    }
}
