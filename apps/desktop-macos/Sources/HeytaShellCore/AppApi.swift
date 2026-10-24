// macOS 壳看到的**唯一** Swift 侧 API。
//
// 与 Windows 的 `AppApi.cs` 是同一形状：一层薄薄的类型化包装，
// 把 JSON 结果解析成 struct，把错误往上抛。**这里不许出现任何业务规则** ——
// 排序、完成态、派生视图都在 TS 的 `packages/app-host/src/native-bridge.ts` 里。
//
// ⚠️ UI 适配与统一**不是这个壳的职责**（那是另一条线在做）。
//    这个壳只负责：把窗口搭起来、把事件转成下面这几个调用。

import Foundation

/// 原生列表真正需要的字段。与 TS 侧 `TaskView` 一一对应。
public struct TaskView: Codable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let done: Bool
    public let completedAt: Int64?
    public let note: String?
}

private struct TaskListEnvelope: Codable { let tasks: [TaskView] }
private struct ClientIdEnvelope: Codable { let clientId: String }
private struct IdEnvelope: Codable { let id: String }
private struct OutboundEnvelope: Codable { let outboundJson: [String] }
private struct ReminderPermissionEnvelope: Codable { let permission: String }
private struct ReminderOpenedEnvelope: Codable { let opened: Bool }

public final class AppApi {
    private let host: ScriptHost

    public init(bundlePath: String, dbPath: String) throws {
        host = try ScriptHost(bundlePath: bundlePath, dbPath: dbPath)
    }

    public func open(_ dbPath: String) throws -> String {
        let clientId = try decode(ClientIdEnvelope.self, from: host.call("open", json(["dbPath": dbPath]))).clientId
        // 引擎模式：这份 JSC 就是唯一的引擎 ⇒ store 一开，提醒循环就起跑
        //（先补投一轮离线期间到点的，再按 JS 给的时长排下一次）。见 ReminderLoop.swift。
        host.startReminderLoop()
        return clientId
    }

    public func listTasks() throws -> [TaskView] {
        try decode(TaskListEnvelope.self, from: host.call("listTasks")).tasks
    }

    public func addTask(_ title: String) throws -> String {
        try decode(IdEnvelope.self, from: host.call("addTask", json(["title": title]))).id
    }

    public func setTaskDone(_ id: String, _ done: Bool) throws {
        _ = try host.call("setTaskDone", json(["id": id, "done": done]))
    }

    public func removeTask(_ id: String) throws {
        _ = try host.call("removeTask", json(["id": id]))
    }

    /// 打开**给页侧真应用用的**那份存储（**无引擎**），返回库里给出的 clientId。
    ///
    /// 🔴 与 `open(_:)` 是**两条路，不能同时走**：`open` 会建 `OpLogEngine`，
    /// 而 `app` 模式里引擎属于**页侧的真应用**。两个引擎同库会各自为政
    /// （向量时钟与 appliedOpIds 漂移），所以壳在 `app` 模式下只调这一个。
    /// 与 Windows 的 `AppApi.OpenOpLog` 逐字同构。
    public func openOpLog() throws -> String {
        let clientId = try decode(ClientIdEnvelope.self, from: host.call("openOpLog", json(["dbPath": ""]))).clientId
        /**
         * 🔴 这里**不**起 `ReminderLoop` —— 起了也永远不会投出去。
         *
         * `app` 模式下这份 JSC 里**没有引擎**（引擎归页侧的真应用），所以壳侧循环调的
         * `HeytaApp.deliverReminders()` 走 `requireHost()` 必然失败，而循环把失败吞成 `"{}"`
         * ⇒ 它每醒一拍都做一件**不可能成功**的事，日志里一个字都不报。
         * 一条永远不会响的循环比没有循环更糟：它会让人以为"投递已经接上了"。
         *
         * 那条腿现在长在页侧：应用的 `useReminderNotifications()` 自己算到点、自己记账，
         * 要弹系统通知时经 `heytaReminder` 消息通道问壳要一次
         *（`apps/desktop-macos/Sources/HeytaMac/ShellReminderBridge.swift`）。
         * 与 Windows 的 `AppApi.OpenOpLog`、Linux 的 `heyta_api_open_store` 同一归属决定。
         */
        return clientId
    }

    // ── 提醒投递（窄门面；判定全在 TS 的 `reminder-foreground.ts`）────────────
    //    macOS 壳的 `__heytaReminderPort` 由 `ScriptHost` 注入，见 `ReminderPort.swift`。

    /// 跑一轮到点投递，原样带回 JS 的收据 JSON（`{delivered, reason?}`）。
    public func deliverReminders() throws -> String {
        try host.call("deliverReminders")
    }

    /// `'granted' | 'denied' | 'default' | 'unsupported'` —— 界面那一行画不画读的是它。
    public func reminderStatus() throws -> String {
        try decode(ReminderPermissionEnvelope.self, from: host.call("reminderStatus")).permission
    }

    /// 引导用户去系统设置放行通知。`true` 只代表 LaunchServices 接下了这个 URL。
    public func openReminderSettings() throws -> Bool {
        try decode(ReminderOpenedEnvelope.self, from: host.call("openReminderSettings")).opened
    }

    /// 把页侧发来的**一条消息**转给 TS，拿回**要发回去的那些消息**。
    ///
    /// 🔴 为什么是"收一条、回多条"：`ready` 交握是**推**给页侧的，而推的时机
    /// 壳控制不了 —— 所以页侧会反复发 `oplog-hello` 来催，壳每次回一条 ready。
    /// 把"回什么"交给 TS，Swift 就只需把返回的每一串**原样发出去**，
    /// 于是它**不必认识任何协议字段**（与 Windows 的 `AppApi.HandleHostMessage` 同构）。
    public func handleHostMessage(_ messageJson: String) throws -> [String] {
        let raw = try host.call("handleHostMessage", json(["messageJson": messageJson]))
        let out = try decode(OutboundEnvelope.self, from: raw).outboundJson
        // 页侧刚落了 op（可能新建/改期了提醒）⇒ 让循环重算"下一次什么时候醒"。
        // 排程输入是 JS 的 `nextReminderWakeDelay()`，这里不判业务（见 ReminderLoop.swift）。
        // ⚠️ `app` 模式下循环根本没起跑 ⇒ 这一句是 no-op，不是第二条投递路径。
        host.rearmReminderLoop()
        return out
    }

    public func shutdown() { host.shutdown() }

    private func json(_ object: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return "{}" }
        return text
    }

    private func decode<T: Decodable>(_ type: T.Type, from json: String) throws -> T {
        guard let data = json.data(using: .utf8) else {
            throw AppApiError.badJson(json)
        }
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw AppApiError.decode(type: String(describing: type), underlying: String(describing: error), raw: json)
        }
    }
}

public enum AppApiError: Error, CustomStringConvertible {
    case badJson(String)
    case decode(type: String, underlying: String, raw: String)

    public var description: String {
        switch self {
        case let .badJson(raw): return "门面返回的不是合法 JSON：\(raw)"
        case let .decode(type, underlying, raw): return "解析 \(type) 失败：\(underlying)\n原始：\(raw)"
        }
    }
}
