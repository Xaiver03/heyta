// JavaScriptCore 宿主：加载**与 Windows 同一个** bundle、注入同步驱动、按名字调门面函数。
//
// 设计取舍（与 Windows 侧刻意保持一致，因为两边是同一个契约的两份实现）：
//   · C#/Swift 都只认识"函数名 + 一个 JSON 参数 + 一个 JSON 结果"这一种调用形状。
//     新增能力 = 在 TS 那边加一个导出函数，宿主这边不改。
//   · 参数与结果都过 JSON 文本 ⇒ 跨语言类型映射只有一处。
//
// 🔴 **JSC 与 Jint 在"错误怎么过边界"上不一样，这是本文件最需要说清的一件事。**
//    Jint：CLR 异常默认冒泡给宿主、中断脚本；打开 `CatchClrExceptions` 后变成
//          可以被 JS `try/catch` 接住的错误（Windows 侧就是这么做的）。
//    JSC ：native（JSExport）方法里抛的 `NSException` **不会**被 JS 的 try/catch 接住。
//          所以 macOS 侧改成**信封**：驱动的每个方法返回 `{"ok":…}` 或 `{"error":…}` 的
//          JSON 文本，由 JS 侧的包装检查并 `throw`。这样"错误能被适配器接住"这件事
//          在两端都成立 —— 差别只在信封由谁拆（见 native-bridge.ts 的驱动包装）。

import Foundation
import JavaScriptCore

public final class ScriptHost {
    private let context: JSContext
    private let driver: SqliteBridge
    /// macOS 通知中心那一侧。注入成 `globalThis.__heytaReminderPort`，
    /// 由 `native-bridge.ts` 的 `deliverReminders()` 消费（见 `ReminderPort.swift`）。
    public let reminderPort: ReminderPort
    /// 🔴 全壳唯一的提醒循环（见 `ReminderLoop.swift`）。store 打开后才启动。
    private var reminderLoop: ReminderLoop?

    public init(bundlePath: String, dbPath: String) throws {
        let source = try String(contentsOfFile: bundlePath, encoding: .utf8)
        guard let context = JSContext() else {
            throw ScriptHostError.engineUnavailable
        }
        self.context = context
        self.driver = try SqliteBridge(path: dbPath)
        self.reminderPort = ReminderPort()

        // ⚠️ 这里**不**设 `exceptionHandler` 去兜驱动错误：驱动改成返回**信封**了
        //    （见 SqliteBridge.swift 头部）。JSC 的 native 方法抛 NSException
        //    不会变成 JS 异常，而 Swift 又接不住 ObjC 异常 ⇒ 那条路根本走不通。
        //    信封在 TS 侧的驱动包装里被拆开并 `throw`，于是适配器的回滚链路照常成立。

        // 驱动对象 + 工厂函数。门面要的是 `globalThis.__heytaDriverFactory` 是个**函数**，
        // 而 JSExport 只能暴露对象 —— 所以在这里补一行 JS 把工厂造出来。
        context.setObject(driver, forKeyedSubscript: "__heytaDriver" as NSString)
        context.evaluateScript("globalThis.__heytaDriverFactory = () => globalThis.__heytaDriver;")

        // 提醒端口：契约要求它是个**对象**（`native-bridge.ts` 的 `InjectedReminderPort`），
        // 不像驱动那样要包成工厂 —— 直接挂上去就行。
        context.setObject(reminderPort, forKeyedSubscript: "__heytaReminderPort" as NSString)

        context.evaluateScript(source, withSourceURL: URL(fileURLWithPath: bundlePath))
        if context.objectForKeyedSubscript("HeytaApp")?.isUndefined != false {
            throw ScriptHostError.bundleMissingGlobal
        }
        self.reminderLoop = ReminderLoop(host: self)
    }

    /// store 打开之后由 `AppApi` 调。幂等；**主线程**。
    public func startReminderLoop() {
        reminderLoop?.start()
    }

    /// 页侧落了一批 op 之后重算"下一次什么时候醒"。未启动时是 no-op。
    public func rearmReminderLoop() {
        reminderLoop?.rearm()
    }

    /// 同步问 JS："下一条提醒还要多久到点"（ms）。`null` / 出错 ⇒ `nil`（不排）。
    /// 🔴 "睡多久"是 JS 算的，这里只是把那个数读出来 —— 反向就会把业务判定漏进壳里。
    func nextReminderWakeDelayMs() -> Int64? {
        guard let app = context.objectForKeyedSubscript("HeytaApp"),
              let fn = app.objectForKeyedSubscript("nextReminderWakeDelay"),
              let value = fn.call(withArguments: []),
              context.exception == nil else {
            context.exception = nil  // store 没开等：按"不知道"处理，不炸、也不猜
            return nil
        }
        guard let delay = value.forProperty("delayMs"),
              !delay.isUndefined, !delay.isNull,
              let number = delay.toNumber() else {
            return nil
        }
        // ⚠️ 不用 `toInt64()`：那是 macOS 15+ 才有的（本包下限 14）。
        // `delayMs` 已被 JS 封顶 6h（21,600,000 ms），Int64(truncating:) 无损。
        return Int64(truncating: number)
    }

    /// 调 `HeytaApp.<fn>(JSON.parse(argJson))`，返回结果的 JSON 文本。
    ///
    /// 结果与错误分别落在 `__r` / `__e`：**错误必须能回到宿主并显示出来**，
    /// 否则失败就只剩一个空白窗口。
    public func call(_ functionName: String, _ argJson: String = "{}") throws -> String {
        let script = """
        globalThis.__done = false;
        globalThis.__r = null;
        globalThis.__e = null;
        (async () => {
          try { globalThis.__r = JSON.stringify(await HeytaApp.\(functionName)(JSON.parse(\(jsStringLiteral(argJson))))); }
          catch (error) {
            globalThis.__e = String((error && error.message) || error);
            globalThis.__es = String((error && error.stack) || '');
          }
          globalThis.__done = true;
        })();
        """

        context.evaluateScript(script)

        // JSC 在顶层求值结束时会排空微任务队列；但宿主没跑 runloop 时偶尔不会立刻排空，
        // 所以给一个**有界**的等待，而不是假设它一定同步完成。
        var spins = 0
        while context.objectForKeyedSubscript("__done")?.toBool() != true && spins < 2_000 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.001))
            spins += 1
        }
        guard context.objectForKeyedSubscript("__done")?.toBool() == true else {
            throw ScriptHostError.notSettled(function: functionName, spins: spins)
        }

        if let error = context.objectForKeyedSubscript("__e"), error.isString {
            let stack = context.objectForKeyedSubscript("__es")?.toString() ?? ""
            throw ScriptHostError.facadeFailure(function: functionName, message: error.toString(), stack: stack)
        }

        guard let result = context.objectForKeyedSubscript("__r"), result.isString else {
            return "null"
        }
        return result.toString()
    }

    public func shutdown() {
        // 先停循环：关掉之后再来一拍 `deliverReminders` 会撞在已销毁的 store 上。
        reminderLoop?.stop()
        reminderLoop = nil
        context.evaluateScript("try { HeytaApp.close(); } catch (e) {}")
    }

}

/// 把一个 Swift 字符串安全地嵌成 JS 字面量（JSON 字符串正好是合法 JS 字面量）。
///
/// ⚠️ 公开，是为了让**窗口那一层**（`HeytaMacApp` 回推存储宿主消息时）也用同一份实现。
/// 两处各写一份转义的症状是"某些字符让脚本语法坏掉"—— 那类 bug 只在特定数据下出现。
public func jsStringLiteral(_ value: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [value]),
          let text = String(data: data, encoding: .utf8) else { return "\"\"" }
    return String(text.dropFirst().dropLast())
}

public enum ScriptHostError: Error, CustomStringConvertible {
    case engineUnavailable
    case bundleMissingGlobal
    case notSettled(function: String, spins: Int)
    case facadeFailure(function: String, message: String, stack: String)

    public var description: String {
        switch self {
        case .engineUnavailable:
            return "拿不到 JavaScriptCore 上下文"
        case .bundleMissingGlobal:
            return "bundle 里没有 HeytaApp —— 打包入口/globalName 不对"
        case let .notSettled(function, spins):
            return "\(function) 未在 \(spins) 次等待内落定 —— 有真正的异步 IO 在等"
        case let .facadeFailure(function, message, stack):
            return "HeytaApp.\(function) 失败：\(message)\n\(stack)"
        }
    }
}
