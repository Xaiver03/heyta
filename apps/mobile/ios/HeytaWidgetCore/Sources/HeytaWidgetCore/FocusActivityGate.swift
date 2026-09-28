import Foundation

/**
 W5-3 · **专注 Live Activity / 灵动岛**的状态判定（纯逻辑，可测）。
 ==================================================================

 ## 🔴 为什么判定要单独拿出来

 因为"该不该显示倒计时"这件事，**错了没有任何症状**：

 倒计时是**系统按时间轴驱动**的（`Text(timerInterval:)`），它每秒自己算。
 所以只要开始时的锚点是错的（用了暂停时刻、用了过期快照、用了 `remainingSeconds`），
 你会看到一个**流畅、平滑、看起来完全正常**的倒计时 —— 它只是在数错的那段时间。

 这类错误在真机上唯一的表现是"数字好像不太对"，而**没有人会盯着它看两分钟**。
 所以判定必须在 `swift test` 里被钉死。

 ## 🔴 灵动岛是**唯一**允许画倒计时的地方

 四端的专注**卡片**都刻意不画倒计时（见 `FocusWidgetView` 与各端同名注释），
 因为卡片是静态快照，`remainingSeconds` 没有锚点。
 灵动岛不同：它由系统按时间轴渲染，所以它**需要**一个绝对时刻 ——
 `endsAt`（契约里的 U8，四端已打通）。

 ## 什么时候**不该**启动

 | 情况 | 为什么 |
|---|---|
| `active == false` | 没有在专注 |
| `endsAt == nil` | 暂停中，或旧发布方没写这个字段。**没有绝对锚点就没有正确的倒计时** |
| `endsAt <= now` | 已经结束了。启动一个"剩余 -30 秒"的倒计时是最糟的：它会显示成 0:00 卡住，或系统直接拒绝 |
| 快照 `.stale` / `.placeholder` | 内容不可信。宁可没有灵动岛，也不能按一个**不可信**的时刻倒计时 |

 ⚠️ 最后一条尤其要紧：`.stale` 意味着"这份快照是昨天的"。
 用它里面的 `endsAt` 起一个 Live Activity，用户会看到一段**永远不会结束**的倒计时。
 */
public enum FocusActivityGate {

    /// 一次 Live Activity 要用的内容。**全部来自契约，没有一个字段是原生推出来的。**
    public struct Content: Equatable, Sendable {
        /// 🔴 绝对结束时刻。**倒计时唯一的锚点。**
        public let endsAt: Double
        /// 本轮目标秒数（画进度条的分母）。
        public let targetSeconds: Double?
        /// 本轮标题。空串合法（用户常常不填）。
        public let sessionTitle: String

        public init(endsAt: Double, targetSeconds: Double?, sessionTitle: String) {
            self.endsAt = endsAt
            self.targetSeconds = targetSeconds
            self.sessionTitle = sessionTitle
        }
    }

    /// 该不该起 / 续一个 Live Activity。返回 `nil` = 不起。
    public static func content(from widget: WidgetContent, now: Double) -> Content? {
        // 只有 `.ready` 才可信。`.stale` 会让倒计时指到一个**昨天的**时刻。
        guard widget.state == .ready else { return nil }
        guard let focus = widget.payload?.focus, focus.active else { return nil }

        // 🔴 没有 `endsAt` 就不启动。
        //
        //    这里**不能**退而用 `remainingSeconds` 算出 `now + remaining`：
        //    那是"拿一个没有锚点的快照值伪造一个锚点"。旧发布方不写 `endsAt`
        //    的那些设备上，这样算出来的结束时刻**每次推送都会往后跳**，
        //    用户看到的是"倒计时走到一半突然又变长了"。
        //    不起灵动岛是**真话**：我们确实不知道什么时候结束。
        guard let endsAt = focus.endsAt else { return nil }

        // 已经过了 / 就是现在 → 不起。起一个"剩余 0"的倒计时，
        // 系统要么拒绝，要么显示成卡住的 0:00。
        guard endsAt > now else { return nil }

        return Content(
            endsAt: endsAt,
            targetSeconds: focus.targetSeconds,
            sessionTitle: focus.sessionTitle ?? ""
        )
    }

    /**
     进度条的起点。

     ⚠️ 契约里**没有** `startedAt`（只有 `endsAt`），所以起点只能由
     `endsAt - targetSeconds` 反推。

     反推的代价必须说清楚：如果用户在专注中途**改过目标时长**，
     反推出来的起点与真实起点不一致，进度条会画错。
     但 `ProgressView(timerInterval:)` 至少**不会倒着走** ——
     它按真实时间前进。所以这是"画错比例"而不是"数字是错的"，
     比不画进度条、或者因此干脆不启动灵动岛都要好。

     `targetSeconds` 缺失或非正 → 返回 `nil`（不画进度条，只画倒计时）。
     */
    public static func progressStart(content: Content) -> Double? {
        guard let target = content.targetSeconds, target > 0 else { return nil }
        return content.endsAt - target * 1000
    }

    /// 倒计时**该由谁算**。
    ///
    /// 🔴 永远是系统（`.systemTimer`），而不是我们每秒读写一次状态。
    /// 我们要做的只是**把两个绝对时刻交给它**，然后什么都不做 ——
    /// 这样即使扩展进程被挂起，数字仍然在走。
    public enum CountdownDriver: Equatable, Sendable {
        /// 交给系统按时间轴渲染。
        case systemTimer
    }

    /// 我们**只**用这一种驱动。保留成枚举是为了让"有没有别的可能"这件事
    /// 在代码里有一个明确的答案 —— 答案是"没有"。
    public static let countdownDriver = CountdownDriver.systemTimer
}
