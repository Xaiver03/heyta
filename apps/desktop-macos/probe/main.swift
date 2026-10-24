// macOS **横幅取证探针**（不是产品壳，不改产品代码）。
//
// 它存在的唯一理由：把 `apps/desktop-macos` 里**发货的那条投递链**
//   `AppApi.open()` → `ScriptHost.startReminderLoop()` → `ReminderLoop.kick()`
//     → JS `HeytaApp.deliverReminders()` → `globalThis.__heytaReminderPort`
//     → `ReminderPort.authorizationStatus()` / `requestAuthorization()` / `show()`
// 在一个**真的 .app 包**里跑一遍，并把每一步的返回值与时刻写进日志。
//
// 🔴 这里没有一行"该不该提醒"的判断，也没有第二次实现 —— 探针只做三件事：
//    打开仓、读状态、把 JS 的收据抄下来。业务判定全在 `packages/app-host`。
//
// ⚠️ 为什么探针自己**不**直接调 `ReminderPort.show()`：
//    那会绕过 `deliverForegroundReminders` 的授权闸与 `firedAt` 记账，
//    得到的横幅不能证明发货路径。要证明的是那条路，不是一个能弹的 API。
//
// 环境变量：
//   HEYTA_PROBE_BRIDGE  native-bridge.js 的绝对路径（必填）
//   HEYTA_PROBE_DB      本地仓的绝对路径（必填，先跑 seed-store.mjs）
//   HEYTA_PROBE_LOG     日志文件（追加，JSONL）
//   HEYTA_PROBE_SECONDS 存活秒数（默认 300）

import Foundation
import HeytaShellCore

let env = ProcessInfo.processInfo.environment
func required(_ key: String) -> String {
    guard let value = env[key], !value.isEmpty else {
        FileHandle.standardError.write(Data("🔴 缺少环境变量 \(key)\n".utf8))
        exit(2)
    }
    return value
}

let bridge = required("HEYTA_PROBE_BRIDGE")
let db = required("HEYTA_PROBE_DB")
let logPath = env["HEYTA_PROBE_LOG"] ?? "/tmp/heyta-reminder-probe.log"
let deadline = Date().addingTimeInterval(Double(env["HEYTA_PROBE_SECONDS"] ?? "300") ?? 300)
let started = Date()

func emit(_ event: String, _ fields: [String: String] = [:]) {
    var obj: [String: Any] = [
        "t": String(format: "%6.2fs", Date().timeIntervalSince(started)),
        "wall": ISO8601DateFormatter().string(from: Date()),
        "event": event,
    ]
    for (k, v) in fields { obj[k] = v }
    let line = (try? JSONSerialization.data(withJSONObject: obj))
        .flatMap { String(data: $0, encoding: .utf8) } ?? "{\"event\":\"\(event)\"}"
    print(line)
    if let data = (line + "\n").data(using: .utf8) {
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        if let handle = FileHandle(forWritingAtPath: logPath) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        }
    }
}

let bundle = Bundle.main
emit("identity", [
    "bundlePath": bundle.bundlePath,
    "bundleId": bundle.bundleIdentifier ?? "nil",
    "pathExtension": bundle.bundleURL.pathExtension,
])
guard bundle.bundleIdentifier != nil, bundle.bundleURL.pathExtension == "app" else {
    emit("abort", ["reason": "探针必须活在真的 .app 里，否则 ReminderPort 整体降级为 unsupported"])
    exit(3)
}

// ──  开仓**之前**的授权状态 ────────────────────────────────────────────
//    `reminderStatus()` 只要端口、不要宿主（`native-bridge.ts` 的
//    `reminderStatus()` 走 `requireReminderPort()`），所以这一趟能在 open 之前跑，
//    它读到的就是"这台机器对这个 bundle id 从没问过 / 已经问过"的真值。
let api: AppApi
do {
    api = try AppApi(bundlePath: bridge, dbPath: db)
} catch {
    emit("abort", ["reason": "AppApi 构造失败：\(error)"])
    exit(4)
}
emit("pre-open", ["bridge": bridge, "db": db])
do {
    emit("authorizationStatus.beforeOpen", ["value": try api.reminderStatus()])
} catch {
    emit("authorizationStatus.beforeOpen.error", ["error": "\(error)"])
}
do {
    emit("deliverReminders.beforeOpen", ["receipt": try api.deliverReminders()])
} catch {
    emit("deliverReminders.beforeOpen.error", ["error": "\(error)"])
}

// ── ② 开仓 = 提醒循环起跑 = 系统询问可能出现在这一行里面 ─────────────────
//    `AppApi.open()` 内部 `host.startReminderLoop()` → `kick()` → `deliverReminders()`。
//    仓里恰好有一条到点提醒 ⇒ JS 侧 `due()` 非空 ⇒ 端口报 `default` 时
//    `deliverForegroundReminders` 会调 `requestAuthorization()`（同步版，上限 120s）。
//    所以**这一句会阻塞**，而阻塞期间屏幕上就是那个系统弹窗。
emit("open.begin", ["note": "open() 内部会起跑 ReminderLoop 并跑第一轮 deliverReminders"])
do {
    let clientId = try api.open(db)
    emit("open.done", ["clientId": clientId])
} catch {
    emit("open.error", ["error": "\(error)"])
    exit(5)
}
do {
    emit("deliverReminders.afterOpen", ["receipt": try api.deliverReminders()])
} catch {
    emit("deliverReminders.afterOpen.error", ["error": "\(error)"])
}

// ── ③ 等那一次「允许」：只读状态，不自己弹、不猜 ─────────────────────────
//    授权一旦变成 `granted`，**下一拍 `deliverReminders()` 就必须真的弹**：
//    ReminderLoop 的前台兜底（`didBecomeActive`）与这里的轮询都会把它推过去。
var polls = 0
var lastStatus = ""
while Date() < deadline {
    RunLoop.main.run(until: Date().addingTimeInterval(3))
    polls += 1
    let status = (try? api.reminderStatus()) ?? "error"
    if status != lastStatus {
        emit("authorizationStatus", ["value": status, "poll": "\(polls)"])
        lastStatus = status
    }
    if status == "granted" {
        let receipt = (try? api.deliverReminders()) ?? "error"
        emit("deliverReminders.granted", ["receipt": receipt, "poll": "\(polls)"])
        if receipt.contains("\"delivered\":[{") || (receipt.contains("\"delivered\":[\"") ) {
            emit("banner.expected", ["note": "JS 回执说这一条投出去了（show() 返回 true 才会写 firedAt）"])
            // 再等一会儿，让横幅留在屏幕上供截图。
            RunLoop.main.run(until: Date().addingTimeInterval(45))
            break
        }
    }
    if status == "denied" {
        emit("stop", ["reason": "系统报 denied —— 这台机器上这个 bundle id 已被拒绝，不会再问"])
        break
    }
}

do {
    emit("final.reminderStatus", ["value": try api.reminderStatus()])
} catch {
    emit("final.reminderStatus.error", ["error": "\(error)"])
}
api.shutdown()
emit("exit", ["polls": "\(polls)"])
