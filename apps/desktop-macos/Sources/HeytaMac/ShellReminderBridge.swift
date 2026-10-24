// 页侧 → 壳的**系统通知腿**（`webkit.messageHandlers.heytaReminder`）。
//
// 🔴 这个文件存在的全部理由：macOS 的 WKWebView **不实现 Web Notifications API**。
//    壳里跑的是真应用、真有到点的提醒、真解密好的任务标题，而页侧那枚探测
//    （`apps/web/src/features/reminders/notify.ts`）当场得到 `unsupported`
//    ⇒ 提醒一条都不会响，界面上却一切正常。能弹系统通知中心的 API
//    （`UNUserNotificationCenter`）只在原生侧存在 ⇒ 那一米必须由页侧**问壳要一次**。
//
// 🔴 边界（AGENTS §3.5）：本文件没有一行在判"哪条提醒该弹"。
//    到点判据、去重、`firedAt` 回执全在页侧那一份（与 Windows/Linux 壳同一契约）。
//    这里只做三件事：报授权状态、按页侧给的 title/body 投一条、把成败**如实**回过去。
//
// ⚠️ 回法：`WKScriptMessageHandlerWithReply` ⇒ 页侧的 `postMessage(...)` 拿到的是 Promise，
//    对上 `shell-reminder-center.ts` 的"回法①"那一支（Linux 的 WebKitGTK 只能走 ack 那一支）。
//    页侧在**没拿到结果**时按"没投出去"处理，所以这里不许为了显得成功而回 `true`：
//    回一个假的 `true` 等于把一条没响过的提醒写进 `firedAt`，用户永远看不到它。
//
// 🔴 线程：`ReminderPort` 的每个方法内部都用 `DispatchSemaphore` 做**有界等待**
//    （读状态/投递最坏 2s，而 `request` 要等用户点系统弹窗）。直接在主线程调会把
//    WebView 和整个 App 的 UI 一起卡住 ⇒ 一律派到后台队列，回值再 hop 回主线程。
//    `openSettings` 反过来：`NSWorkspace.open` 必须在主线程，就地调。

import Foundation
import HeytaShellCore
import WebKit

@MainActor
final class ShellReminderBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let port = ReminderPort()

    /// 取证用的单向回调：每次投递落一行「授权状态 + 壳的回执」。
    /// ⚠️ 只落状态与成败，**不落标题正文** —— 那是用户的任务内容，不进日志。
    var onFact: ((String) -> Void)?

    /// 页侧 `show` 的入参形状：`args = [occurrenceId, title, body]`。
    /// 用 JSONSerialization 拼，不手写引号：标题里带 `"` 或换行时手写会拼出坏 JSON。
    private static func requestJson(args: [Any]) -> String? {
        guard args.count == 3,
              let occurrenceId = args[0] as? String,
              let title = args[1] as? String,
              let body = args[2] as? String else { return nil }
        let dict: [String: Any] = ["occurrenceId": occurrenceId, "title": title, "body": body]
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    /// 后台算、主线程回。⚠️ 端口当参数递过去（不捕获 `self.port`）：
    /// 这样闭包跨线程时不需要 `ReminderPort` 冒充 Sendable。
    private func replyOffMain(
        _ value: @escaping @Sendable (ReminderPort) -> Any?,
        _ replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        let port = self.port
        DispatchQueue.global(qos: .userInitiated).async {
            let result = value(port)
            DispatchQueue.main.async { replyHandler(result, nil) }
        }
    }

    /// 取证用：读**系统通知中心**那一格里有没有这一条（`identifier` = occurrenceId）。
    /// 与 `show()` 的回值是两个问题 —— 后者只证明"系统接下了请求"。
    func evidenceDeliveredContains(_ identifier: String) -> Bool {
        port.containsDelivered(identifier)
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "heyta-local",
              message.frameInfo.securityOrigin.host == "app",
              let body = message.body as? [String: Any],
              let method = body["method"] as? String else {
            replyHandler(nil, "Reminder bridge rejected origin or malformed message")
            return
        }
        let args = (body["args"] as? [Any]) ?? []

        switch method {
        case "permission":
            replyOffMain({ port in port.authorizationStatus() }, replyHandler)

        case "request":
            // 异步版：系统弹窗要**等人**，同步版会把这条腿吊在 120s 的等待上。
            port.requestAuthorizationAsync { status in
                DispatchQueue.main.async { replyHandler(status, nil) }
            }

        case "openSettings":
            // 只有真跳到系统设置才回 true；页侧据此决定那句提示怎么说。
            replyHandler(port.openSettings(), nil)

        case "show":
            guard let requestJson = Self.requestJson(args: args) else {
                replyHandler(false, "Reminder bridge: show needs [occurrenceId, title, body]")
                return
            }
            replyOffMain({ port in
                let status = port.authorizationStatus()
                let delivered = port.show(requestJson)
                return (status: status, delivered: delivered)
            }, { [weak self] pair, _ in
                if let dict = pair as? [String: Any] {
                    self?.onFact?("REMINDER_SHOW=permission=\(dict["status"] ?? "?") delivered=\(dict["delivered"] ?? "?")")
                    replyHandler(dict["delivered"] as? Bool ?? false, nil)
                } else {
                    replyHandler(false, nil)
                }
            })

        default:
            replyHandler(nil, "Reminder bridge: unknown method '\(method)'")
        }
    }
}
