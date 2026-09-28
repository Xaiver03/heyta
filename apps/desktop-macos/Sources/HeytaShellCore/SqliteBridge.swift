// macOS 侧的**同步 SQLite 驱动**，与 `packages/storage/src/sqlite/sqlite-driver.ts` 同形。
//
// 与 Windows 侧的 `SqliteBridge.cs` 是**同一个契约的两份实现**，所以两个坑要一起避开：
//   1. 契约用 `?` **位置**占位符；这里要自己数 `?`（**跳过字符串字面量**），
//      否则 `WHERE title = 'a?b'` 会被静默改坏 —— 坏法是"多绑一个参数"，报错离现场很远。
//   2. 整数按 Int64 绑，不能一律 Double，否则 SQLite 的比较与索引会退化。
//
// 🔴 **错误怎么过边界：这里是"信封"，不是异常。**
//
//   Windows 那边（Jint）可以做"抛异常 → JS `try/catch` 接住"，
//   因为 Jint 提供了 `CatchClrExceptions` 把 CLR 异常转成 JS 错误。
//
//   **JSC 没有对等物**：native（JSExport）方法里抛 `NSException` 不会变成 JS 异常，
//   而且 Swift **接不住 ObjC 异常** —— 直接抛等于终止进程。
//   所以 macOS 侧一律**返回一个信封**：
//
//       成功 → "" 或 行 JSON
//       失败 → {"__heytaDriverError":"<消息>"}
//
//   拆信封的是 TS 侧的驱动包装（`native-bridge.ts` 的 `throwIfDriverError`）。
//   这样"驱动出错 → 适配器回滚"这条契约在两端都成立，差别只在信封由谁拆。

import Foundation
import JavaScriptCore
import SQLite3   // macOS SDK 自带；`.linkedLibrary("sqlite3")` 只负责链接，声明要这个 import

/// 信封用的键。⚠️ 改它必须同步改 `packages/app-host/src/native-bridge.ts`。
private let driverErrorKey = "__heytaDriverError"

private func errorEnvelope(_ message: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [driverErrorKey: message]),
          let text = String(data: data, encoding: .utf8) else {
        return "{\"\(driverErrorKey)\":\"unknown driver error\"}"
    }
    return text
}

/// JS 侧看到的形状。`JSExport` 让它能直接被 JavaScriptCore 暴露成 JS 对象。
/// 三个方法都返回 `String`（信封），**没有一个会抛**。
@objc public protocol SqliteDriverExports: JSExport {
    func exec(_ sql: String) -> String
    func run(_ sql: String, _ paramsJson: String) -> String
    func all(_ sql: String, _ paramsJson: String) -> String
    func close()
}

public final class SqliteBridge: NSObject, SqliteDriverExports {
    private var handle: OpaquePointer?
    private let path: String

    public init(path: String) throws {
        self.path = path
        var db: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(path, &db, flags, nil) == SQLITE_OK, let opened = db else {
            let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            sqlite3_close_v2(db)
            throw SqliteOpenError(path: path, message: message)
        }
        handle = opened
        // 🔴 `NSObject` 的子类必须**先** `super.init()` 才能用 `self`；
        //    而下面要调 `self.exec(...)` 设 pragma —— 所以这行不能挪到后面。
        super.init()
        // 与其它端一致的开关。
        _ = exec("PRAGMA foreign_keys=ON;")
        if path != ":memory:" {
            _ = exec("PRAGMA journal_mode=WAL;")
        }
    }

    deinit { close() }

    public func exec(_ sql: String) -> String {
        var error: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(handle, sql, nil, nil, &error) != SQLITE_OK {
            let message = error.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(error)
            return errorEnvelope(message)
        }
        return ""
    }

    public func run(_ sql: String, _ paramsJson: String) -> String {
        switch prepare(sql, paramsJson) {
        case let .failure(message):
            return errorEnvelope(message)
        case let .success(statement):
            defer { sqlite3_finalize(statement) }
            let rc = sqlite3_step(statement)
            if rc != SQLITE_DONE && rc != SQLITE_ROW {
                return errorEnvelope(lastError())
            }
            return ""
        }
    }

    public func all(_ sql: String, _ paramsJson: String) -> String {
        switch prepare(sql, paramsJson) {
        case let .failure(message):
            return errorEnvelope(message)
        case let .success(statement):
            defer { sqlite3_finalize(statement) }

            var rows: [[String: Any]] = []
            while true {
                let rc = sqlite3_step(statement)
                if rc == SQLITE_DONE { break }
                if rc != SQLITE_ROW { return errorEnvelope(lastError()) }
                var row: [String: Any] = [:]
                for index in 0..<sqlite3_column_count(statement) {
                    let name = String(cString: sqlite3_column_name(statement, index))
                    switch sqlite3_column_type(statement, index) {
                    case SQLITE_NULL: row[name] = NSNull()
                    case SQLITE_INTEGER: row[name] = sqlite3_column_int64(statement, index)
                    case SQLITE_FLOAT: row[name] = sqlite3_column_double(statement, index)
                    case SQLITE_BLOB:
                        let count = Int(sqlite3_column_bytes(statement, index))
                        if let bytes = sqlite3_column_blob(statement, index), count > 0 {
                            row[name] = Data(bytes: bytes, count: count).base64EncodedString()
                        } else {
                            row[name] = ""
                        }
                    default: row[name] = String(cString: sqlite3_column_text(statement, index))
                    }
                }
                rows.append(row)
            }

            guard let data = try? JSONSerialization.data(withJSONObject: rows),
                  let text = String(data: data, encoding: .utf8) else {
                return errorEnvelope("行序列化失败")
            }
            return text
        }
    }

    public func close() {
        if let handle { sqlite3_close_v2(handle) }
        handle = nil
    }

    // ── 内部 ────────────────────────────────────────────────────────

    private func lastError() -> String {
        guard let handle else { return "database is closed" }
        return String(cString: sqlite3_errmsg(handle))
    }

    private enum Prepared {
        case success(OpaquePointer)
        case failure(String)
    }

    /// 把 JS 传来的 `JSON.stringify(params)` 绑到 `?` 上（位置由我们自己数）。
    private func prepare(_ sql: String, _ paramsJson: String) -> Prepared {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let prepared = statement else {
            return .failure(lastError())
        }

        let values = parseParams(paramsJson)
        let expected = countPlaceholders(sql)
        guard expected == values.count else {
            sqlite3_finalize(prepared)
            return .failure("SQL 里的占位符数（\(expected)）与参数个数（\(values.count)）不一致：\(sql)")
        }

        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            switch value {
            case is NSNull:
                sqlite3_bind_null(prepared, index)
            case let number as NSNumber:
                // JSONSerialization 把真/假也给成 NSNumber —— 与其它端一致地存成 0/1。
                if CFGetTypeID(number) == CFBooleanGetTypeID() {
                    sqlite3_bind_int64(prepared, index, number.boolValue ? 1 : 0)
                } else if number.doubleValue == number.doubleValue.rounded(),
                          number.doubleValue.magnitude < 9.0e18 {
                    sqlite3_bind_int64(prepared, index, number.int64Value)
                } else {
                    sqlite3_bind_double(prepared, index, number.doubleValue)
                }
            case let text as String:
                // SQLITE_TRANSIENT：让 SQLite 自己拷贝，别依赖 Swift 字符串的生命周期。
                sqlite3_bind_text(prepared, index, text, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            default:
                sqlite3_finalize(prepared)
                return .failure("不支持的参数类型：\(type(of: value))")
            }
        }
        return .success(prepared)
    }

    private func parseParams(_ paramsJson: String) -> [Any] {
        guard let data = paramsJson.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) else { return [] }
        return parsed as? [Any] ?? []
    }

    /// 数 `?` 占位符，**跳过单引号字符串**（SQLite 里 `''` 是转义的单引号）。
    private func countPlaceholders(_ sql: String) -> Int {
        var count = 0
        var inString = false
        let scalars = Array(sql.unicodeScalars)
        var index = 0
        while index < scalars.count {
            let scalar = scalars[index]
            if inString {
                if scalar == "'" {
                    if index + 1 < scalars.count, scalars[index + 1] == "'" {
                        index += 1
                    } else {
                        inString = false
                    }
                }
            } else if scalar == "'" {
                inString = true
            } else if scalar == "?" {
                count += 1
            }
            index += 1
        }
        return count
    }
}

public struct SqliteOpenError: Error, CustomStringConvertible {
    public let description: String
    init(path: String, message: String) {
        description = "打不开 SQLite（\(path)）：\(message)"
    }
}
