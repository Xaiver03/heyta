import Foundation

import HeytaWidgetCore

/**
 W5-2 · **锁屏组件的隐私策略**（纯逻辑，可测）。
 =================================================

 ## 🔴 锁屏组件与主屏组件**不是一个隐私场景**

 主屏组件在用户解锁之后才看得到。锁屏组件**在不解锁的情况下就能被看到** ——
 只要你把手机拿在手上。而 heyta 里的任务标题可以是
 「离婚协议书」「面试准备」「CT 复查」这种东西。

 所以这一条不是"顺手加的开关"，它是**锁屏这条产品线的前提**。

 ## 三层防护，各挡各的

 | 层 | 谁在做 | 挡什么 |
 |---|---|---|
 | 1. 系统预览设置 | 用户在 iOS 设置里选「解锁时显示 / 始终 / 从不」 | 用户已有的偏好。**我们不重复实现它** |
 | 2. `.privacySensitive()` | 我们，挂在每一个标题上 | 让系统的第 1 层**对它生效**。不加这个修饰符，系统就不知道这段文字是敏感的，会照常显示 |
 | 3. 「锁屏始终隐藏标题」 | 我们，用户显式打开 | 第 2 层管不到的情况：**手机已解锁**，但用户正把屏幕给别人看 |

 ## 🔴 为什么第 3 层默认是**关**的

 因为它与第 1、2 层**重复**，而重复的安全开关有一个确定的坏处：
 **用户找不到它**，于是锁屏组件默认变成「3 个 •••」，被当成坏掉然后删掉。
 默认关、需要的人自己开，比默认开、所有人被挡住更接近用户的真实意图。

 ## 🔴 不只在锁屏生效 —— `.privacySensitive()` 是**零成本**的

 它在主屏组件上没有任何效果（主屏本来就在解锁之后），
 所以四款组件的**同一份视图**可以都挂上它，不需要分成两套。
 分两套就会漂移，而漂移的表现是「锁屏那套忘了隐掉某一款」。
 */

/// 用户在设置里对锁屏组件的偏好。
///
/// 只有一个字段，但**刻意做成结构体**而不是 `Bool`：
/// 以后加「锁屏只显示计数」「隐藏清单名」时不必改所有调用点的类型。
public struct WidgetPrivacyPreference: Equatable, Sendable {
    /// 锁屏（以及任何"未解锁可见"的位置）**始终**隐藏任务标题，即使设备已解锁。
    public let alwaysHideTitles: Bool

    public init(alwaysHideTitles: Bool = false) {
        self.alwaysHideTitles = alwaysHideTitles
    }

    /// 默认值 = 不额外隐藏（交给系统的 `.privacySensitive()`）。见文件头第 3 层。
    public static let `default` = WidgetPrivacyPreference()

    /// 从共享容器里的偏好文件解析。读不到 / 坏数据 → **默认值**，不是"全都藏起来"。
    ///
    /// ⚠️ 为什么坏数据不 fail closed 到"藏起来"：
    /// 藏起来会让锁屏组件看起来像坏掉了，而这条路径上的坏数据
    /// （文件没写、App Group 没配好）**恰恰是最常见的那种**。
    /// 用默认值 = 交给系统那一层，仍然有保护；而 fail closed 到"藏"
    /// 会让一个**配置问题**表现成**产品问题**。
    public static func parse(_ raw: Any?) -> WidgetPrivacyPreference {
        guard let dict = raw as? [String: Any] else { return .default }
        guard let value = dict["alwaysHideTitles"] as? Bool else { return .default }
        return WidgetPrivacyPreference(alwaysHideTitles: value)
    }

    /// 序列化回共享容器。
    public func serialized() -> [String: Any] {
        ["alwaysHideTitles": alwaysHideTitles]
    }

    /// 标题是否应被替换成占位符（第 3 层）。
    ///
    /// ⚠️ 第 2 层（`.privacySensitive()`）**不在这里判断** ——
    /// 它是系统在渲染时按锁屏状态做的，我们拿不到那个状态，
    /// 也不应该猜。这里只回答"用户有没有要求始终隐藏"。
    public var shouldMaskTitles: Bool { alwaysHideTitles }
}

// ─────────────────────────────────────────────────────────────
// 锁定视图的取值模型
// ─────────────────────────────────────────────────────────────

/**
 锁屏组件的**三种家族**共用一份取值逻辑。
 
 | 家族 | 长什么样 | 我们放什么 |
 |---|---|---|
 | `.accessoryCircular` | 一个圆 | **未完成条数**（第 1 层永远只放数字，不放标题） |
 | `.accessoryRectangular` | 两行宽条 | 第一件未完成任务 + `已完成/总数` |
 | `.accessoryInline` | 一行文字（在时间旁边） | 只放计数。⚠️ 它**在锁屏最上方、最显眼**，所以它**永远**不放标题 |
 
 🔴 `.accessoryInline` 永远不放标题这条是**产品决定**，不是实现省事：
 它在锁屏顶部、跟时间并排，是最容易被旁人一眼扫到的位置。
 用户能接受"3 个任务"，不能接受"离婚协议书"被同事扫到。
 */
public struct WidgetLockScreenModel: Equatable, Sendable {
    /// 锁屏组件的状态，与主屏同一套三态。
    public enum State: Equatable, Sendable {
        /// 不知道（没快照 / 解不开 / 版本不认识）。
        case placeholder
        /// 知道但过期了。
        case stale
        /// 知道且新鲜。**条数可能是 0**。
        case ready
    }

    public let state: State
    /// `nil` = 标题被隐藏（第 3 层），或本来就没有未完成任务。
    public let firstTitle: String?
    /// 未完成条数。`.placeholder` / `.stale` 时是 `0`。
    public let openCount: Int
    /// 总条数（用于 `done/total`）。
    public let totalCount: Int
    /// 已完成条数。
    public let doneCount: Int

    public init(
        state: State,
        firstTitle: String?,
        openCount: Int,
        totalCount: Int,
        doneCount: Int
    ) {
        self.state = state
        self.firstTitle = firstTitle
        self.openCount = openCount
        self.totalCount = totalCount
        self.doneCount = doneCount
    }

    /// 只有 `.ready` 才谈得上"有数字可显示"。
    public var showsNumbers: Bool { state == .ready }

    /// 有没有活要干。`.ready` 且 `openCount == 0` 才是"真的没事"。
    public var isAllDone: Bool { state == .ready && openCount == 0 }
}

public enum WidgetLockScreenModelBuilder {
    /**
     从一次渲染的**可信内容**构造锁屏模型。

     ⚠️ 意图的**乐观叠加**（`content.targets`）也要算进去 —— 否则会出现：
     用户在锁屏上点掉了最后一件任务，锁屏组件（由应用重新推送后）显示"还有 1 件"，
     而主屏组件显示"全部完成"。**同一次点击，两块屏幕上两个结果。**
     主屏的 `TodayWidgetModelBuilder` 已经做了叠加，这里必须做**同一件事**。
     */
    public static func build(
        _ content: WidgetContent,
        privacy: WidgetPrivacyPreference = .default
    ) -> WidgetLockScreenModel {
        switch content.state {
        case .placeholder:
            return WidgetLockScreenModel(
                state: .placeholder, firstTitle: nil, openCount: 0, totalCount: 0, doneCount: 0
            )
        case .stale:
            return WidgetLockScreenModel(
                state: .stale, firstTitle: nil, openCount: 0, totalCount: 0, doneCount: 0
            )
        case .ready:
            break
        }

        let tasks = content.payload?.today ?? []
        guard !tasks.isEmpty else {
            // `ready` 且确实为空 —— 与 `placeholder` 是**两种状态**。
            return WidgetLockScreenModel(
                state: .ready, firstTitle: nil, openCount: 0, totalCount: 0, doneCount: 0
            )
        }

        func isDone(_ task: WidgetTask) -> Bool {
            content.targets[task.id] ?? task.isDone
        }

        let done = tasks.filter(isDone).count
        let firstOpen = tasks.first { !isDone($0) }

        return WidgetLockScreenModel(
            state: .ready,
            // 🔴 第 1 层与第 3 层都在这里生效：被隐藏时 `firstTitle` 为 `nil`，
            //    视图层拿到 `nil` 就**只画计数**，而不是画一串 `•`。
            //    画 `•` 会让用户以为任务标题就是那样。
            firstTitle: privacy.shouldMaskTitles ? nil : firstOpen?.title,
            openCount: tasks.count - done,
            totalCount: tasks.count,
            doneCount: done
        )
    }

    /**
     标题被隐藏时，第一行该显示什么。

     ⚠️ 与 `firstTitle == nil` 的**另一种**含义（没有未完成任务）必须区分 ——
     两者都是 `nil`，但用户看到的应该是不同的东西：
     「•••」（藏起来了）vs「全部完成」（真的做完了）。

     所以这里**单独问**一次隐私偏好，而不是去猜 `firstTitle` 为什么是 `nil`。
     猜的话，某天"藏起来"会显示成"全部完成" —— 一个**看起来是好消息**的错。
     */
    public static func hiddenTitlePlaceholder(
        privacy: WidgetPrivacyPreference
    ) -> String? {
        privacy.shouldMaskTitles ? "•••" : nil
    }
}
