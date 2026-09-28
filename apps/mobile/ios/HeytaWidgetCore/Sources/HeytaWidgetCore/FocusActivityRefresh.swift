#if canImport(ActivityKit) && os(iOS)
import Foundation

/**
 W5-3 · 灵动岛的**推进入口**：读快照 → 判定 → `reconcile`。
 ===========================================================

 ## 🔴 为什么要有这一层，而不是让 RN 桥自己拼

 因为"读快照 → 判定 → 推进"这三步里，**只有中间一步有测试**。
 让调用方自己拼的话，会出现几种**都不会报错**的错法：

 | 错法 | 后果 |
|---|---|
| 用了 `WidgetSharedStore.readSnapshot()` 但忘了传 `now`（传了 `0`） | 🔴 **每一次**都会起一个"已经结束"的活动，然后立刻被收掉 —— 灵动岛**永远不出现**，而没有任何报错 |
| 忘了带意图队列 | 点掉的最后一件任务不算数 —— 但灵动岛的判定本来就不看任务 |
| 在没解密的情况下传了 `nil` 给 gate | 被 gate 拦掉（`.placeholder`）→ **看起来完全正常**，只是灵动岛不出现 |

 第二种错法的表现是"功能不工作但没有错误"，而排查它需要知道
 内部有哪三步。所以这三步必须**只有一处实现**。

 ## ⚠️ 这个函数**永不抛**

 它挂在应用的启动/回到前台路径上（与 `publishWidgetSnapshot` 同一处）。
 为一个"锦上添花"的灵动岛让应用起不来是荒唐的。
 失败一律吞掉并返回 `nil` —— 调用方想知道发生了什么可以看返回值，
 但**不需要**为了不崩去写 `try`。

 ## ⚠️ **未验证**（诚实划界）

 `FocusActivityController.reconcile` 的**实际效果**需要真机
 （控制中心/灵动岛的渲染与生命周期只能设备验）。这里能保证的是：
 ①它**编译**（`swift build --triple … --sdk <ios sdk>`）；
 ②它调的判定逻辑有 16 条 `swift test` 钉着；
 ③**它不会被误调成"用 `now = 0`"** —— `now` 的默认值是 `Date()`，
   而不是 `0`，且这个文件里唯一构造 `now` 的地方就是下面那一行。
 */
public enum FocusActivityRefresh {

    /// 一次推进的结果。`nil` = 没做成（读不到快照 / 模块不可用 / 抛了）。
    ///
    /// 返回 `nil` 与返回 `.noop` 是**两件不同的事**：
    /// 前者是"我没能判断"，后者是"我判断了，什么都不用做"。混起来之后
    /// 真机上排查"灵动岛为什么没出现"就只能靠猜。
    public static func syncNow() async -> FocusActivityController.Outcome? {
        let raw = WidgetSharedStore.readSnapshot()
        let queue = WidgetSharedStore.readIntentQueue()
        // 🔴 `now` **只在这里**构造。传 `0`（或忘了传）会让每一次判定
        //    都认为专注早已结束 —— 灵动岛永远不出现，且没有任何报错。
        let now = Date().timeIntervalSince1970 * 1000

        let content = WidgetSnapshotReader(keyProvider: { WidgetDeviceKey.read() }).read(
            rawSnapshot: raw,
            queue: queue,
            now: now
        )

        do {
            return try await FocusActivityController.reconcile(widget: content, now: now)
        } catch {
            // `reconcile` 内部已经吞掉了绝大多数失败；这里兜的是
            // "ActivityKit 自己抛了"那种情况。**不记日志**是刻意的：
            // 灵动岛起不来不是错误状态，是"用户在设置里关了"这种正常状态之一。
            return nil
        }
    }

    /**
     用户主动结束专注 / 清凭据 / 退出登录时调用。

     ⚠️ 与 `syncNow()` 分开，因为它的语义是"**不要**再起了" ——
     清凭据之后再起一个显示上次会话的灵动岛，是把别人的数据留在锁屏上
     （与 `clearWidgetState` 同一个理由，见 `credential-wipe.ts`）。
     */
    public static func endAll() async {
        await FocusActivityController.endAll()
    }
}
#endif
