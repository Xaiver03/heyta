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

public final class AppApi {
    private let host: ScriptHost

    public init(bundlePath: String, dbPath: String) throws {
        host = try ScriptHost(bundlePath: bundlePath, dbPath: dbPath)
    }

    public func open(_ dbPath: String) throws -> String {
        try decode(ClientIdEnvelope.self, from: host.call("open", json(["dbPath": dbPath]))).clientId
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
        try decode(ClientIdEnvelope.self, from: host.call("openOpLog", json(["dbPath": ""]))).clientId
    }

    /// 把页侧发来的**一条消息**转给 TS，拿回**要发回去的那些消息**。
    ///
    /// 🔴 为什么是"收一条、回多条"：`ready` 交握是**推**给页侧的，而推的时机
    /// 壳控制不了 —— 所以页侧会反复发 `oplog-hello` 来催，壳每次回一条 ready。
    /// 把"回什么"交给 TS，Swift 就只需把返回的每一串**原样发出去**，
    /// 于是它**不必认识任何协议字段**（与 Windows 的 `AppApi.HandleHostMessage` 同构）。
    public func handleHostMessage(_ messageJson: String) throws -> [String] {
        let raw = try host.call("handleHostMessage", json(["messageJson": messageJson]))
        return try decode(OutboundEnvelope.self, from: raw).outboundJson
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
