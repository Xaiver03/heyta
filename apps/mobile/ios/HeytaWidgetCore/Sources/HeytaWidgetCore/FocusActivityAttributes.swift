// ⚠️ **`canImport(ActivityKit)` 在 macOS 上是 `true`** —— 那个模块确实存在，
//    但里面的 `ActivityAttributes` / `Activity` / `ActivityAuthorizationInfo`
//    全都标了 `@available(macOS, unavailable)`。所以只判 `canImport` 会在
//    `swift build`（本机是 macOS）时炸出一片 "is unavailable in macOS"。
//    必须**两个条件都判**：模块在 + 系统对。
//
//    这是本轮的第三个"看起来对但编译不过"的坑（前两个是
//    `@Entry` 的根节点与 `.widgetAccentable()`）—— 三个都只有**真编译器**能发现。
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import Foundation

/**
 W5-3 · 专注 Live Activity 的**属性与状态**。
 ==============================================

 ## 🔴 `ActivityAttributes` 与 `ContentState` 的分工

 | | 放什么 | 什么时候变 |
|---|---|---|
| `ActivityAttributes` | **一次专注会话不变的东西** | 一次活动内**不变** |
| `ContentState` | 会变的部分 | 每次 `update()` 变 |

 我们的会话只是"一个 25 分钟的番茄钟"，没有"不变的东西" ——
 所以 `ActivityAttributes` 是空的。**这不是偷懒**：
 往它里面塞 `sessionTitle` 会有一个真实的后果 ——
 属性在一次活动期间**不可更新**，用户中途改标题就同步不过去。
 放在 `ContentState` 里就能。

 ## ⚠️ `endsAt` 是 `Date` 还是 `Double`

 契约（四端统一）用 **Unix 毫秒的 `Double`**；ActivityKit 用 `Date`。
 转换只在这个文件里做一次 —— 散在视图里做，就会有一处忘了除 1000，
 而"差了 1000 倍的时间戳"在倒计时上表现为**立刻结束**或**几万小时后结束**。
 */
public struct FocusActivityAttributes: ActivityAttributes {

    public struct ContentState: Codable, Hashable {
        /// 🔴 **绝对**结束时刻。`Text(timerInterval:)` 的唯一锚点。
        public var endsAt: Date
        /// 本轮目标秒数。缺失 = 不画进度条。
        public var targetSeconds: Double?
        /// 本轮标题。空串合法。
        public var sessionTitle: String

        public init(endsAt: Date, targetSeconds: Double?, sessionTitle: String) {
            self.endsAt = endsAt
            self.targetSeconds = targetSeconds
            self.sessionTitle = sessionTitle
        }

        /// 从契约（Unix 毫秒）构造。**这是唯一的一处单位转换。**
        public init?(content: FocusActivityGate.Content) {
            // `Date(timeIntervalSince1970:)` 的输入是**秒**，契约是**毫秒**。
            // 忘了除 1000 的话，`endsAt` 会变成公元 58000 年 ——
            // 倒计时显示"还有 1,800,000,000 秒"，而它看起来只是"一个很大的数"。
            let seconds = content.endsAt / 1000
            guard seconds.isFinite, seconds > 0 else { return nil }
            let date = Date(timeIntervalSince1970: seconds)
            // 再挡一次：`Date` 能表示的范围比 Unix 毫秒宽，
            // 但超出 `Date.distantFuture` 的值在系统那边没有意义。
            guard date <= Date.distantFuture else { return nil }
            self.endsAt = date
            self.targetSeconds = content.targetSeconds
            self.sessionTitle = content.sessionTitle
        }

        /// 进度条起点，由 `endsAt - targetSeconds` 反推（见 `FocusActivityGate.progressStart`）。
        public var progressStart: Date? {
            guard let target = targetSeconds, target > 0 else { return nil }
            return endsAt.addingTimeInterval(-target)
        }
    }

    public init() {}
}

// ─────────────────────────────────────────────────────────────
// 启动 / 续期 / 结束
// ─────────────────────────────────────────────────────────────

/**
 从一次快照推进 Live Activity 的**唯一入口**。

 ## 🔴 为什么是"推进"而不是"开始"

 因为三种情况在调用方看来是同一件事：还没起、已经在跑要更新、该结束了。
 让调用方自己判断会出现的错误是：**忘了结束** ——
 用户早就做完了，锁屏上那个倒计时还在跑，直到系统在 8 小时后把它清掉。

 ## ⚠️ 这个类型**不持有** Activity 实例

 ActivityKit 的 API 是 `Activity<FocusActivityAttributes>.activities`（全局查询）。
 自己缓存一份引用就会有两份状态，而两份状态的表现是
 "我明明结束了它，它还在"。
 */
public enum FocusActivityController {

    /// 一次推进的结果。**调用方需要它来判断"做了什么"** ——
    /// 静默返回 `Void` 的话，真机上排查"灵动岛为什么没出现"只能靠猜。
    public enum Outcome: Equatable, Sendable {
        /// 起了新的。
        case started
        /// 更新了正在跑的那个。
        case updated
        /// 停掉了（专注结束 / 归零 / 快照不可信）。
        case ended
        /// 什么都没做（没有活跃的，且这次也不该起）。
        case noop
        /// 系统不允许 Live Activity（用户在设置里关了）。
        case notPermitted(activeCount: Int)
    }

    /// 当前的活跃活动（正常最多 1 个）。
    public static var active: [Activity<FocusActivityAttributes>] {
        Activity<FocusActivityAttributes>.activities
    }

    /**
     按一次快照推进。

     - Parameter widget: 刚刚读到并判完的可信内容。
     - Parameter now: 当前 Unix 毫秒。**显式传入**，这样它在测试里是可控的。
     */
    @discardableResult
    public static func reconcile(widget: WidgetContent, now: Double) async -> Outcome {
        let running = active
        let desired = FocusActivityGate.content(from: widget, now: now)

        guard let content = desired, let state = FocusActivityAttributes.ContentState(content: content)
        else {
            // 不该起 → 把已经在跑的收掉。
            // ⚠️ 这里**不区分**"专注结束了"和"快照坏了"：两种情况都必须停 ——
            //    继续按一个不可信的时刻倒计时，比没有倒计时糟得多。
            guard !running.isEmpty else { return .noop }
            for activity in running {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            return .ended
        }

        if running.isEmpty {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                return .notPermitted(activeCount: 0)
            }
            do {
                _ = try Activity.request(
                    attributes: FocusActivityAttributes(),
                    content: ActivityContent(state: state, staleDate: state.endsAt)
                )
                return .started
            } catch {
                // 起不来（用户在设置里关了 / 系统预算用尽）**不算错误**：
                // 灵动岛是增强，不是主路径。静默失败，但返回可区分的 Outcome。
                return .notPermitted(activeCount: 0)
            }
        }

        // 🔴 已经在跑：**全部**更新，并收掉多出来的。
        //    正常只会有一个，但"正常只有一个"不是保证 ——
        //    上一次 `request` 抛异常后状态可能与我们的预期不一致。
        for (index, activity) in running.enumerated() {
            if index == 0 {
                await activity.update(ActivityContent(state: state, staleDate: state.endsAt))
            } else {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        return .updated
    }

    /**
     用户主动结束专注 / 退出登录时调用。

     ⚠️ 与 `reconcile` 分开，因为它的语义是"**不要**再起了" ——
     退出登录之后再起一个显示上次会话的灵动岛，是把别人的数据留在锁屏上。
     */
    public static func endAll() async {
        for activity in active {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
#endif
