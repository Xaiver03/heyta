import Foundation

import HeytaWidgetCore

/**
 应用侧的共享容器 —— **一层薄包装**，真正干活的是 `WidgetContainerFiles`。
 ==========================================================================

 见 `WidgetContainerFiles` 的文件头：文件访问只有一处实现，
 应用与扩展各自只声明"自己需要哪几个操作"。
 */
public struct AppGroupWidgetStore: WidgetBridgeService.Store {

    public init() {}

    public func readSnapshot() -> Data? {
        WidgetContainerFiles.readSnapshot()
    }

    public func writeSnapshot(_ envelope: Data) throws {
        try WidgetContainerFiles.writeSnapshot(envelope)
    }

    public func drainIntents() -> String? {
        WidgetContainerFiles.drainIntentsRaw()
    }

    public func updateIntents(_ body: (WidgetIntentQueue) -> WidgetIntentQueue) -> WidgetIntentQueue {
        WidgetContainerFiles.updateIntents(body)
    }

    public func clearAll() {
        WidgetContainerFiles.clearAll()
    }

    /// W5-2 · 隐私偏好与快照是**两个文件**（见 `Store` 协议里的理由）。
    public func readPrivacy() -> Any? {
        WidgetContainerFiles.readPrivacyRaw()
    }

    /// W5-2 · **只有应用侧会调这个方法**（`WidgetDeviceKey.getOrCreate` 同一侧）。
    public func writePrivacy(_ object: [String: Any]) throws {
        try WidgetContainerFiles.writePrivacy(object)
    }
}
