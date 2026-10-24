// 提醒的**原生定时器循环** —— 🔴 全壳只有这一处循环，别在第二个地方再排一次表。
//
// 分工（这条边界是本切片存在的理由）：
//   · "下一条提醒还要多久到点" = JS 的 `HeytaApp.nextReminderWakeDelay()`（已封顶 6h）。
//   · "到点了该弹哪几条、记账"  = JS 的 `HeytaApp.deliverReminders()`。
//   · 这里只做一件事：**睡到 JS 说的那个时刻，醒来把 JS 的函数调一下，再睡**。
//     本文件没有一个字节在判断"什么算到点"。
//
// 三个起跑点，全部汇到同一个 `kick()`：
//   1. store 打开之后（`AppApi.open` / `openOpLog` 成功 ⇒ `start()`）；
//   2. 定时器到点（`woken()`）；
//   3. 应用重新回到前台（`NSApplication.didBecomeActiveNotification` ⇒ `kick()`）——
//      系统睡眠期间定时器根本不跑，这一格是它的兜底，与 Web 端"回来就补投"同口径。
//
// 权限询问的时机（产品纪律"不在启动时问"）：
//   只有当**投递回执说 `reason:'permission'`**（= JS 确认有待投但没授权）
//   且端口报 `default`（从没问过）时，才经 `requestAuthorizationAsync` 升级成系统询问。
//   判据全部来自 JS 的回执 —— Swift 不知道也不该知道"有没有待投提醒"。
//   ⚠️ 为什么 Swift 要补这一步：当前 `native-bridge.ts` 的 `deliverReminders()`
//   只把 `authorizationStatus` + `show` 映射进 `ReminderForegroundPort`，
//   没接 `requestAuthorization`（`packages/**` 归主线所有，本壳不改）。
//   没有这一格，"从没问过"的机器上提醒**永远不会响** —— 那是假绿。
//   主线把 `requestAuthorization` 接进去之后，这一格自动变成无害的重复（幂等）。
//
// 🔴 线程契约：全部方法只在主线程跑（JSContext 不是线程安全的，而 `ScriptHost.call`
//   自旋的是主线程 RunLoop）。`@unchecked Sendable` 是为通知回调那一次
//   `DispatchQueue.main.async` 跳跃买的单，真实串行性由下面的 assert 保证。

import AppKit
import Foundation

final class ReminderLoop: NSObject, @unchecked Sendable {
    private weak var host: ScriptHost?
    private var timer: Timer?
    private var started = false
    /// JSContext 不可重入：投递期间（`call` 在自旋 RunLoop）定时器和前台通知
    /// 都可能再进来 —— 那一拍**记下来补跑**，而不是并发地第二次动 context。
    private var delivering = false
    private var pendingKick = false

    init(host: ScriptHost) {
        self.host = host
        super.init()
    }

    deinit { invalidateTimer() }

    /// store 打开后调。幂等：重复调只补投一次，不重复挂监听。
    func start() {
        assert(Thread.isMainThread, "ReminderLoop 必须挂在主线程的 RunLoop 上")
        if !started {
            started = true
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(becameActive),
                name: NSApplication.didBecomeActiveNotification,
                object: nil
            )
        }
        kick()
    }

    /// 页侧每落一批 op 之后调（`AppApi.handleHostMessage`）：只**重算下一次该睡多久**。
    /// 不这么做的话，"定时器已排到 6 小时之后，用户新建了一条 10 分钟后的提醒"
    /// 会睡过头 —— 排程输入是 JS 的 `nextReminderWakeDelay()`，这里不判业务。
    func rearm() {
        assert(Thread.isMainThread, "ReminderLoop 必须挂在主线程的 RunLoop 上")
        guard started else { return }
        scheduleNext()
    }

    func stop() {
        invalidateTimer()
        NotificationCenter.default.removeObserver(self)
        started = false
    }

    @objc private func becameActive() { kick() }
    @objc private func woken() { kick() }

    private func kick() {
        assert(Thread.isMainThread, "ReminderLoop 必须挂在主线程的 RunLoop 上")
        guard let host else { return }
        guard !delivering else { pendingKick = true; return }
        delivering = true
        defer {
            delivering = false
            if pendingKick {
                pendingKick = false
                kick()
            }
        }
        // 门面失败（store 没开等）⇒ 拿到 "{}"，按"没回执"处理：不弹、不猜，只重排表。
        let receipt = (try? host.call("deliverReminders")) ?? "{}"
        if Self.isPermissionBlocked(receipt), host.reminderPort.authorizationStatus() == "default" {
            host.reminderPort.requestAuthorizationAsync { [weak self] _ in
                guard let self else { return }
                // UN 的回调在系统队列上；JSContext 只许主线程碰 ⇒ 跳回来再补投。
                DispatchQueue.main.async { self.afterPrompt() }
            }
            return
        }
        scheduleNext()
    }

    private func afterPrompt() {
        guard let host else { return }
        _ = try? host.call("deliverReminders")
        scheduleNext()
    }

    private func scheduleNext() {
        invalidateTimer()
        guard let host, let delayMs = host.nextReminderWakeDelayMs() else {
            // `null` ⇒ JS 说没有待排的将来时刻。不排 = 等下一次 store 变化 / 回前台。
            return
        }
        // delayMs 已由 JS 封顶 6h（定时器溢出与"睡眠期间不跑"都在那边处理），
        // 这里只兜一个下限防 0 时长自旋。
        let timer = Timer(
            timeInterval: max(Double(delayMs), 50.0) / 1000.0,
            target: self,
            selector: #selector(woken),
            userInfo: nil,
            repeats: false
        )
        // `.common`：窗口跟踪（拖动/菜单打开）时也要能醒。
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func invalidateTimer() {
        timer?.invalidate()
        timer = nil
    }

    /// 只认 JS 回执里那一个词。这不是"Swift 判业务"，是"Swift 读 JS 的账"。
    private static func isPermissionBlocked(_ json: String) -> Bool {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let reason = obj["reason"] as? String else {
            return false
        }
        return reason == "permission"
    }
}
