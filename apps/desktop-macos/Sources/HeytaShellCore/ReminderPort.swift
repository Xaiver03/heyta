// 提醒投递的 **macOS 原生侧**：通知中心 + 权限 + 去系统设置的入口。
//
// 🔴 边界（AGENTS §3.5）：这里只回答"**怎么弹**"和"**能不能弹**"。
//    哪条提醒到点、投过没有、回执怎么写 —— 全部在 JS
//    （`packages/app-host/src/reminder-foreground.ts`），一行都不许搬到这里来。
//    本文件里没有任何"该不该提醒"的判断，连"什么算到点"都不知道。
//
// ## 注入形状（与 `__heytaDriverFactory` 同一套约定）
//
// `ScriptHost` 把这个对象挂成 `globalThis.__heytaReminderPort`，
// `native-bridge.ts` 的 `deliverReminders()` 经它投递。契约（见 native-bridge.ts 的
// `InjectedReminderPort`）：入参与返回全部是可 JSON 化的标量，方法**同步**。
//
// ## 🔴 同步端口 ⇄ 异步 UN API：本文件怎么跨这一格
//
// `UNUserNotificationCenter` 只有回调式 API，而端口方法必须同步回值。
// 做法是**有界等待**（`DispatchSemaphore` + 超时），并且把超时**说成不知道**：
//   · `authorizationStatus()` 超时 ⇒ 回 `"default"`（"从没问过"是诚实的兜底，
//     绝不在没量到系统真值时回 `"granted"`）；
//   · `show()` 超时 ⇒ 回 `false`。
// 这两个方向是**不对称的、刻意的**：`false` 的代价是"下一轮再试"（JS 侧不记账），
// `true` 的代价是"提醒被标成已投、用户永远没看到" —— 后者正是产品不许撒的那个谎。
// 实测 `getNotificationSettings` 与 `add` 都是毫秒级，超时分支是保险丝不是路径。
//
// ## 无 .app 外壳的进程（`swift run`、冒烟）怎么办
//
// `UNUserNotificationCenter.current()` 在**没有 bundle 标识的裸可执行文件**里会直接
// 抛 `NSException`（`bundleProxyForCurrentProcess is nil`）—— 那是崩溃，不是错误码。
// 所以先判"是不是一个真的 .app"，不是就整体降级为 `"unsupported"` / `false`。
// 冒烟门禁因此能常跑（它验的是接缝形状，见 heyta-smoke 第 12 节），
// 而真投递只在打包出来的 .app 里发生 —— 这个差别是**如实的**，不是没做。

import AppKit
import Foundation
import JavaScriptCore
// ⚠️ `@preconcurrency`：Apple 这份 SDK 没给 UN 回调打 Sendable 标注，
// Swift 6 会把"跨回调搬运局部容器"报成硬错误。并发安全不靠这个标注 ——
// 靠的是下面每个等待点上的 `DispatchSemaphore`（写入先于 signal，读取在 wait 之后）。
@preconcurrency import UserNotifications

/// JS 侧看到的形状。`JSExport` 让它被 JavaScriptCore 暴露成 `globalThis.__heytaReminderPort`。
/// ⚠️ 与驱动同一纪律：**没有一个方法会抛** —— JSC 里 native 方法抛的 NSException
///    不会被 JS 的 try/catch 接住（见 `ScriptHost.swift` 文件头）。
@objc public protocol ReminderPortExports: JSExport {
    /// `'granted' | 'denied' | 'default' | 'unsupported'`（与 `ReminderAuthorization` 同一词表）。
    func authorizationStatus() -> String
    /// 只在"确有一条待投提醒、且从没问过"时被要 —— **不在启动时问**。
    func requestAuthorization() -> String
    /// 入参 = `JSON.stringify({occurrenceId,title,body})`。
    /// 🔴 投不出去必须回 `false`；回一个假的 `true` 等于把提醒记账成已投递。
    func show(_ requestJson: String) -> Bool
    /// 跳系统「通知」设置。`true` 只代表 LaunchServices 接下了这个 URL，
    /// 不代表面板内容 —— 判据边界写在这里，不读多。
    func openSettings() -> Bool
}

/// 跨回调搬运的**局部**容器。⚠️ 每个实例都只活在一次同步等待里：
/// 写入发生在 UN 回调（signal 之前），读取发生在 `wait()` 返回之后 ——
/// 信号量给了 happens-before，`@unchecked Sendable` 买的是 SDK 缺标注的账。
private final class StatusBox: @unchecked Sendable {
    var value: String
    init(_ value: String = "default") { self.value = value }
}

/// ⚠️ `Sendable`：这个类**没有一个可变实例属性**（只有下面那个 `static let` 与常量），
///    每次调用用的都是**自己的** `DispatchSemaphore` + 局部 `StatusBox`，
///    而 `UNUserNotificationCenter` 是 Apple 自己的线程安全单例、这里只读引用。
///    壳的另一条腿（`ShellReminderBridge`）要把它派到后台队列上，需要这个标注。
public final class ReminderPort: NSObject, ReminderPortExports, @unchecked Sendable {
    public override init() { super.init() }

    /// 读系统授权状态的等待上限。实测毫秒级，给 2s 是保险丝。
    private static let settingsWait: TimeInterval = 2
    /// 投递回执的等待上限，同上。
    private static let presentWait: TimeInterval = 2
    /// 系统授权弹窗要**等人**，这是它和上面两个的本质区别。
    /// 超时回 `"default"`（还没答案就是还没答案）；当前 bundle 的 JS 契约
    /// （`deliverReminders` 只映射 `authorizationStatus` + `show`）**不会**同步调到这里 ——
    /// 壳的循环用的是 `requestAuthorizationAsync`，不阻塞主线程。
    private static let promptWait: TimeInterval = 120

    /// 「通知」设置面板的 URL scheme。**macOS 27.2 实测**（2026-10-23）：
    /// 旧 anchor `com.apple.preference.notifications` 仍被系统设置解析并直达
    /// 「通知」那一节（窗口标题「通知」，截图见交付报告），所以不需要退到
    /// `com.apple.Notifications-Settings.extension` 那条新 anchor。
    static let notificationsSettingsURL =
        "x-apple.systempreferences:com.apple.preference.notifications"

    /// 只有**真的 .app** 才碰 `UNUserNotificationCenter.current()`（理由见文件头）。
    /// `static let` 求值一次：裸进程里连那个会抛的调用都不会发生。
    /// `nonisolated(unsafe)`：Swift 6 嫌 `UNUserNotificationCenter` 没标 Sendable；
    /// 它是 Apple 自己的单例门面（内部线程安全），而这里**只读引用、从不改** ——
    /// 被保护的共享状态不存在，unsafe 买的是 SDK 没打标注的账，不是我们的竞态。
    nonisolated(unsafe) private static let center: UNUserNotificationCenter? = {
        let bundle = Bundle.main
        guard bundle.bundleIdentifier != nil,
              bundle.bundleURL.pathExtension == "app",
              FileManager.default.fileExists(atPath: bundle.bundlePath) else {
            return nil
        }
        return UNUserNotificationCenter.current()
    }()

    private static func map(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "default"
        case .denied: return "denied"
        case .authorized, .provisional: return "granted"
        case .ephemeral: return "unsupported"  // CarPlay 临时授权，弹不了本机横幅
        @unknown default: return "default"     // 没见过的值 ⇒ 说"不知道"，不说"能弹"
        }
    }

    /// 同步读一次系统授权状态（有界等待；超时 ⇒ `"default"`）。
    private static func readStatus(_ center: UNUserNotificationCenter) -> String {
        let box = StatusBox()
        let settled = DispatchSemaphore(value: 0)
        center.getNotificationSettings { settings in
            box.value = map(settings.authorizationStatus)
            settled.signal()
        }
        guard settled.wait(timeout: .now() + settingsWait) == .success else {
            return "default"
        }
        return box.value
    }

    public func authorizationStatus() -> String {
        guard let center = ReminderPort.center else { return "unsupported" }
        return ReminderPort.readStatus(center)
    }

    /// 同步版：**会阻塞调用线程等用户点弹窗**（上限 `promptWait`）。
    /// 暴露给 JS 契约用；壳自己的循环走 `requestAuthorizationAsync`。
    public func requestAuthorization() -> String {
        guard let center = ReminderPort.center else { return "unsupported" }
        let settled = DispatchSemaphore(value: 0)
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in
            settled.signal()
        }
        // 超时不当失败处理：用户还没答 ⇒ 回"还没问过"的下一态，
        // 事后系统真值由下面这次**重新读**带回（不在回调之间传数据，避免竞态）。
        _ = settled.wait(timeout: .now() + ReminderPort.promptWait)
        return ReminderPort.readStatus(center)
    }

    /// 异步版（给原生循环用）：回调落在系统队列上，**调用方负责回主线程**。
    public func requestAuthorizationAsync(_ completion: @escaping @Sendable (String) -> Void) {
        guard let center = ReminderPort.center else { completion("unsupported"); return }
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in
            completion(ReminderPort.readStatus(center))
        }
    }

    public func show(_ requestJson: String) -> Bool {
        guard let center = ReminderPort.center else { return false }
        guard let data = requestJson.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let occurrenceId = obj["occurrenceId"] as? String else {
            return false
        }
        // 🔴 投递**前**再量一次授权：JS 侧"检查→投递"之间权限可能被撤回，
        // 而 denied 下 `add()` 是**不报错**的 —— 不重查就会把没弹出来的提醒记成已投。
        var status = ReminderPort.readStatus(center)
        if status == "default" {
            // 走到这里 = JS 已经确认有一条待投提醒（`show` 只在有 due 时被调），
            // 所以这一次询问符合"只在真有东西要投的那一刻升级"的边界。
            status = requestAuthorization()
        }
        guard status == "granted" else { return false }

        let content = UNMutableNotificationContent()
        content.title = (obj["title"] as? String) ?? ""
        content.body = (obj["body"] as? String) ?? ""
        content.userInfo = ["occurrenceId": occurrenceId]
        // 🔴 `trigger: nil` ⇒ **立即投递**（前台模型）。不许换成
        // `UNCalendarNotificationTrigger` —— 排程归操作系统那条路是 iOS 的形态，
        // 这里"什么时候醒"由 JS 的 `nextReminderWakeDelay()` 说了算。
        // identifier = occurrenceId：同一 occurrence 重复 add 会被系统就地替换，
        // 这是白送的兜底，不是去重机制（去重在 JS 的 `shown` + `firedAt`）。
        let request = UNNotificationRequest(identifier: occurrenceId, content: content, trigger: nil)
        let box = StatusBox("no")
        let settled = DispatchSemaphore(value: 0)
        center.add(request) { error in
            box.value = error == nil ? "yes" : "no"
            settled.signal()
        }
        guard settled.wait(timeout: .now() + ReminderPort.presentWait) == .success else {
            return false  // 没拿到回执 ⇒ 投没投出去**不知道** ⇒ 按没投处理，下一轮再试
        }
        return box.value == "yes"
    }

    public func openSettings() -> Bool {
        guard let url = URL(string: ReminderPort.notificationsSettingsURL) else { return false }
        return NSWorkspace.shared.open(url)
    }

    /**
     * 取证用：系统**真的收下了**这一条吗 —— 读的是通知中心的账（`getDeliveredNotifications`），
     * 判据是 `identifier`（= occurrenceId，见 `show` 里那行注释）。
     *
     * 🔴 为什么需要这一格而不是只看 `show()` 的回值：`add()` 成功只证明"系统接下了这个请求"，
     *    而"用户看得见的那一条确实在通知中心里"是另一件事。验收要的是后者。
     * ⚠️ 它**不**证明横幅弹过 —— 横幅显示与否取决于 App 是否在前台（前台时系统只入中心不弹横幅），
     *    所以这一格如实写成"进了通知中心"，不写成"看见了弹窗"。
     */
    public func containsDelivered(_ identifier: String) -> Bool {
        guard let center = ReminderPort.center else { return false }
        let box = StatusBox("no")
        let settled = DispatchSemaphore(value: 0)
        center.getDeliveredNotifications { list in
            box.value = list.contains { $0.request.identifier == identifier } ? "yes" : "no"
            settled.signal()
        }
        guard settled.wait(timeout: .now() + ReminderPort.settingsWait) == .success else { return false }
        return box.value == "yes"
    }
}
