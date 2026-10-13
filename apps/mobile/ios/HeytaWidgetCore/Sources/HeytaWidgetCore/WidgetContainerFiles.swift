import Foundation

/**
 共享容器的**文件访问** —— 应用与扩展共用的唯一一份实现。
 =================================================================

 ## 🔴 为什么这一层必须在 Core，而不是各写一份

 应用侧要写快照、非破坏读取并确认队列、清空；扩展侧要读快照、读队列、**合并**一条点击。
 两组操作**重叠在"读"上**，而重叠的部分恰好是最容易写错的那部分：

 | 易错点 | 写错的表现 |
 |---|---|
 | 忘记设文件保护等级 | 文件在锁屏后仍可读 —— **没有测试会发现** |
 | 读-改-写不加协调 | 两个进程互相覆盖，**用户的一次点击消失** |
 | 忘了 `containerURL` 可能返回 `nil` | 崩溃或静默写到一个不存在的路径 |

 两份实现必然漂移，而漂移的那一份通常是**扩展侧**（更难调试的那一侧）。
 所以：**文件访问只有这一处**，应用与扩展各自只做一层薄包装。

 ## ⚠️ `containerURL` 返回 `nil` 是**正常情况**

 App Group 没配好（entitlements 缺一项、bundle id 不匹配）时它返回 `nil`。
 本层把 `nil` 一律降级成"读不到 / 写不进"，**不抛错、不崩溃** ——
 症状是组件显示"打开 Heyta"。这个降级是**有意的**：
 配错的直接后果不该是应用崩溃，而"看起来没数据"至少是可归因的。
 */
public enum WidgetContainerFiles {

    // ─────────────────────────────────────────────────────────────
    // 路径
    // ─────────────────────────────────────────────────────────────

    public static func containerURL() -> URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: WidgetSharedConstants.appGroupId
        )
    }

    public static func snapshotURL() -> URL? {
        containerURL()?.appendingPathComponent(WidgetSharedConstants.snapshotFileName, isDirectory: false)
    }

    public static func intentQueueURL() -> URL? {
        containerURL()?.appendingPathComponent(WidgetSharedConstants.intentQueueFileName, isDirectory: false)
    }

    /// W5-2 · 锁屏隐私偏好的文件位置。
    public static func privacyURL() -> URL? {
        containerURL()?.appendingPathComponent(WidgetSharedConstants.privacyFileName, isDirectory: false)
    }

    // ─────────────────────────────────────────────────────────────
    // 读
    // ─────────────────────────────────────────────────────────────

    /// 读快照。读不到（不存在 / 未解锁 / 容器没配好）一律给 `nil`。
    public static func readSnapshot() -> Data? {
        guard let url = snapshotURL() else { return nil }
        return try? Data(contentsOf: url)
    }

    /// 读意图队列的**原始 JSON**。这是 `drainIntentQueue` 的上游 ——
    /// 刻意不解析（解析的真源在 `@heyta/widget-core`）。
    public static func readIntentQueueRaw() -> String? {
        guard let url = intentQueueURL(), let data = try? Data(contentsOf: url) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    /// W5-2 · 读隐私偏好。读不到 → `nil`（调用方回落默认值，不是"全都藏起来"）。
    public static func readPrivacyRaw() -> Any? {
        guard let url = privacyURL(), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    // ─────────────────────────────────────────────────────────────
    // 写
    // ─────────────────────────────────────────────────────────────

    /// W5-2 · 写隐私偏好（**应用侧**调用，与 `getOrCreate` 同一侧）。
    public static func writePrivacy(_ object: [String: Any]) throws {
        guard let url = privacyURL() else { throw Failure.containerUnavailable }
        let data = try JSONSerialization.data(withJSONObject: object)
        try data.write(to: url, options: .atomic)
        setFileProtection(url)
    }

    public static func writeSnapshot(_ envelope: Data) throws {
        guard let url = snapshotURL() else { throw Failure.containerUnavailable }
        try envelope.write(to: url, options: .atomic)
        setFileProtection(url)
    }

    /**
     读取原始 JSON（非破坏）。`nil` = 没有待处理的点击。

     ⚠️ 返回 `nil` 而不是 `"[]"`：**"没有点击"与"有零条点击"** 在调用方要走
     不同的分支，而 `"[]"` 会被 `JSON.parse` 成一个空数组 —— 调用方必须判断两种形态。
     */
    public static func drainIntentsRaw() throws -> String? {
        guard let url = intentQueueURL() else { throw Failure.containerUnavailable }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }

        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        var readError: Error?
        var result: String?
        coordinator.coordinate(readingItemAt: url, options: [], error: &coordinationError) { target in
            do {
                let data = try Data(contentsOf: target)
                let raw = String(decoding: data, as: UTF8.self)
                guard !WidgetIntentQueues.parse(data).intents.isEmpty else { return }
                result = raw
            } catch {
                readError = error
            }
        }
        if let readError { throw Failure.readFailed(readError.localizedDescription) }
        if let coordinationError { throw Failure.readFailed(coordinationError.localizedDescription) }
        return result
    }

    /// 精确确认已处理的点击。只删除三元组完全匹配的条目，读取期间新写入的点击会在
    /// 同一个 NSFileCoordinator 临界区之后再写入，因此不会被误删。
    public static func ackIntents(_ processed: WidgetIntentQueue) throws -> Int {
        guard let url = intentQueueURL() else { throw Failure.containerUnavailable }
        guard !processed.intents.isEmpty else { return 0 }
        guard FileManager.default.fileExists(atPath: url.path) else { return 0 }

        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        var operationError: Error?
        var removed = 0
        coordinator.coordinate(writingItemAt: url, options: .forMerging, error: &coordinationError) { target in
            do {
                let data = try Data(contentsOf: target)
                let current = try parseQueueForAck(data)
                let wanted = Set(processed.intents.map { IntentKey($0) })
                let kept = current.intents.filter { intent in
                    if wanted.contains(IntentKey(intent)) {
                        removed += 1
                        return false
                    }
                    return true
                }
                guard let encoded = encodeQueue(WidgetIntentQueue(kept)) else {
                    throw Failure.ackFailed("无法序列化确认后的意图队列")
                }
                try encoded.write(to: target, options: .atomic)
                setFileProtection(target)
            } catch {
                operationError = error
            }
        }
        if let operationError {
            if let failure = operationError as? Failure { throw failure }
            throw Failure.ackFailed(operationError.localizedDescription)
        }
        if let coordinationError { throw Failure.ackFailed(coordinationError.localizedDescription) }
        return removed
    }

    private struct IntentKey: Hashable {
        let taskId: String
        let targetIsDone: Bool
        let at: Double
        init(_ intent: WidgetIntent) {
            taskId = intent.taskId
            targetIsDone = intent.targetIsDone
            at = intent.at
        }
    }

    private static func parseQueueForAck(_ data: Data) throws -> WidgetIntentQueue {
        guard let root = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
              let object = root as? [String: Any],
              let version = object["v"] as? Int, version == widgetIntentVersion,
              let rawIntents = object["intents"] as? [Any] else {
            throw Failure.ackFailed("意图队列格式无效，未执行确认")
        }
        let queue = WidgetIntentQueues.parse(data)
        guard rawIntents.isEmpty || !queue.intents.isEmpty else {
            throw Failure.ackFailed("意图队列格式无效，未执行确认")
        }
        return queue
    }

    /**
     原子地读-改-写意图队列。
 
     ## 🔴 必须在 `NSFileCoordinator` 的临界区里
 
     应用与扩展是**两个进程**，它们会同时写这个文件：
     - 用户在组件上连点两下 → 两次 intent 执行；
     - 应用同时在 drain / 精确确认已处理的意图（旧版兼容写回）。

     不做协调的话，一次"读到旧内容 → 两边各自合并 → 各自写"就会**丢掉一次点击**。
     症状是"我明明点了两下，只有一下生效" —— 而日志里什么都没有。
     */
    @discardableResult
    public static func updateIntents(_ body: (WidgetIntentQueue) -> WidgetIntentQueue) -> WidgetIntentQueue {
        guard let url = intentQueueURL() else { return .empty }

        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        var merged = WidgetIntentQueue.empty

        coordinator.coordinate(writingItemAt: url, options: .forMerging, error: &coordinationError) { target in
            let current = (try? Data(contentsOf: target)).map(WidgetIntentQueues.parse) ?? .empty
            merged = body(current)
            guard let data = encodeQueue(merged) else { return }
            do {
                try data.write(to: target, options: .atomic)
                setFileProtection(target)
            } catch {
                // 写不进去 = 这次变更丢了，而组件会在下一次刷新时回到落盘的状态。
                // 没有更好的降级，但也不该静默 —— 留一条日志。
                NSLog("[heyta-widget] 意图写回失败：\(error)")
            }
        }
        return merged
    }

    /// 登出时清空。调用方负责先删密钥；这里再协调地清除所有共享状态。
    /// 任何删除失败都抛出，不能让宿主误报清理成功。
    public static func clearAll() throws {
        guard containerURL() != nil else { throw Failure.containerUnavailable }
        for url in [snapshotURL(), intentQueueURL(), privacyURL()].compactMap({ $0 }) {
            try removeCoordinated(url)
        }
    }

    private static func removeCoordinated(_ url: URL) throws {
        let fileManager = FileManager.default
        // 登出是幂等的：已经不存在的文件无需报错。
        guard fileManager.fileExists(atPath: url.path) else { return }

        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        var operationError: Error?
        coordinator.coordinate(writingItemAt: url, options: .forDeleting, error: &coordinationError) { target in
            do {
                if fileManager.fileExists(atPath: target.path) {
                    try fileManager.removeItem(at: target)
                }
            } catch {
                operationError = error
            }
        }
        if let operationError { throw Failure.clearFailed(operationError.localizedDescription) }
        if let coordinationError { throw Failure.clearFailed(coordinationError.localizedDescription) }
    }

    // ─────────────────────────────────────────────────────────────
    // 内部
    // ─────────────────────────────────────────────────────────────

    static func encodeQueue(_ queue: WidgetIntentQueue) -> Data? {
        let obj: [String: Any] = [
            "v": widgetIntentVersion,
            "intents": queue.intents.map {
                ["taskId": $0.taskId, "targetIsDone": $0.targetIsDone, "at": $0.at]
            },
        ]
        return try? JSONSerialization.data(withJSONObject: obj)
    }

    /**
     设置文件保护等级。
 
     ## 🔴 `completeUntilFirstUserAuthentication`，**不是** `complete` —— 这是一个互斥取舍
 
     | 等级 | 重启后未首次解锁 | Continuity（Mac 上看 iPhone 组件） |
     |---|---|---|
     | `.complete` | 读不到 → 组件显示占位 | ❌ **不可用** |
     | `.completeUntilFirstUserAuthentication` | 读不到（**同上**） | ✅ 可用 |
 
     两者**互斥**：Continuity 要求系统在用户**没解锁 iPhone** 时也能读到数据。
 
     选后者的理由是**代价不对等**：两者在"重启后、首次解锁前"这个窗口的表现
     **完全一样**（都是读不到）—— 选后者**没有**牺牲那个窗口，
     它只是**没有额外**要求"每次锁屏都加密"。
     而 `.complete` 的代价是**彻底放弃 macOS 桌面组件**，那正是 W2 明确要拿到的东西。

     ⚠️ 这个属性只在**写入时**有意义（属性属于文件自己）。
     放在这一层是因为**两边用的是同一份实现** —— 分两份写必然漂移，
     而漂移的表现是"某条写入路径忘了设"，那等于没设。
     */
    public static func setFileProtection(_ url: URL) {
        #if os(iOS)
        try? FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        #endif
    }

    public enum Failure: Error, Equatable {
        /// App Group 没配好（`containerURL` 返回 `nil`）。
        case containerUnavailable
        case clearFailed(String)
        case readFailed(String)
        case ackFailed(String)
    }
}
