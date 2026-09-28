import Foundation

/**
 共享容器的**文件访问** —— 应用与扩展共用的唯一一份实现。
 =================================================================

 ## 🔴 为什么这一层必须在 Core，而不是各写一份

 应用侧要写快照、drain 队列、清空；扩展侧要读快照、读队列、**合并**一条点击。
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
     读出原始 JSON 并清空。`nil` = 没有待处理的点击。

     ⚠️ 返回 `nil` 而不是 `"[]"`：**"没有点击"与"有零条点击"** 在调用方要走
     不同的分支，而 `"[]"` 会被 `JSON.parse` 成一个空数组 —— 调用方必须判断两种形态。
     */
    public static func drainIntentsRaw() -> String? {
        guard let url = intentQueueURL() else { return nil }

        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        var result: String?

        coordinator.coordinate(writingItemAt: url, options: .forMerging, error: &coordinationError) { target in
            guard let data = try? Data(contentsOf: target) else { return }
            result = String(decoding: data, as: UTF8.self)
            // 清空：写一个空队列，而不是删文件 —— 删了之后扩展的读会走
            // "文件不存在"这条路，而那条路和"队列是空的"在语义上应当一致。
            // 写成空队列让"文件永远存在"这个前提成立，读侧的判据就只剩"内容是不是空"。
            if let empty = encodeQueue(.empty) {
                try? empty.write(to: target, options: .atomic)
                setFileProtection(target)
            }
        }
        if coordinationError != nil { return nil }

        // 空队列与"没有点击"对调用方是同一件事。
        guard let raw = result, !WidgetIntentQueues.parse(Data(raw.utf8)).intents.isEmpty else {
            return nil
        }
        return raw
    }

    /**
     原子地读-改-写意图队列。
 
     ## 🔴 必须在 `NSFileCoordinator` 的临界区里
 
     应用与扩展是**两个进程**，它们会同时写这个文件：
     - 用户在组件上连点两下 → 两次 intent 执行；
     - 应用同时在 drain / 写回失败的意图。

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

    /// 登出时清空。**两处一起清**（调用方负责先删密钥，见 `WidgetBridgeService.clearWidgetState`）。
    public static func clearAll() {
        if let url = snapshotURL() { try? FileManager.default.removeItem(at: url) }
        if let url = intentQueueURL() { try? FileManager.default.removeItem(at: url) }
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
    }
}
