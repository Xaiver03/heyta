#if os(iOS) && canImport(ActivityKit)
import ActivityKit
import SwiftUI
import WidgetKit

import HeytaWidgetCore
import HeytaWidgetUI

/**
 W5-3 · 专注 Live Activity 的界面（锁屏横幅 + 灵动岛四个区域）。
 ==================================================================

 ## 🔴 倒计时用 `Text(timerInterval:)`，**不是**我们每秒算

 ```swift
 Text(timerInterval: start...end, countsDown: true)
 ```

 由**系统**按时间轴渲染。这不是优化，是**正确性**要求：

 | 如果我们自己算 | 系统算 |
 |---|---|
 | 扩展进程被挂起 → 数字**停住不动** | 不受影响，永远在走 |
 | 每秒唤醒一次 → 耗电，且系统预算会掐掉 | 零成本 |
 | 需要一个定时器 + 与 `endsAt` 同步 | 只给两个绝对时刻 |

 所以这两个视图里**没有任何** `Timer`、`TimelineView`、
 或者读 `Date()` 的地方 —— 它们只是把 `endsAt` 交给系统。

 ## 四个区域各放什么

 | 区域 | 大小 | 放什么 |
|---|---|---|
| `compactLeading` | 极小 | 一个图标 |
| `compactTrailing` | 极小 | **倒计时**（`mm:ss`） |
| `minimal` | 最小（同时有两个活动时） | 只放图标 |
| `expanded` | 大 | 标题 + 倒计时 + 进度条 |
 */

/// 锁屏上的 Live Activity 横幅（以及灵动岛展开时的下半部分）。
struct FocusActivityLockScreenView: View {
    let state: FocusActivityAttributes.ContentState
    let strings: WidgetStrings

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "timer")
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                Spacer(minLength: 0)
                // 🔴 系统驱动的倒计时。
                Text(timerInterval: Date()...state.endsAt, countsDown: true)
                    .font(.headline)
                    .monospacedDigit()
            }

            if let start = state.progressStart {
                // 🔴 进度条也交给系统：`ProgressView(timerInterval:countsDown:)` 会自己走。
                //    自己算比例再 `ProgressView(value:)` 的话，它只会在每次推送时跳一下 ——
                //    用户看到的是"进度条卡住了"。
                ProgressView(timerInterval: start...state.endsAt, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
            }
        }
        .padding(.horizontal, 4)
        // 🔴 标题敏感：锁屏横幅同样在未解锁时可见。
        .privacySensitive()
    }

    private var title: String {
        state.sessionTitle.isEmpty ? strings.focusRunning : state.sessionTitle
    }
}

/**
 灵动岛的**各个区域**。
 
 ⚠️ `DynamicIsland` **不是 `View`** —— 它是 `dynamicIsland:` 闭包里的一个
 result builder。所以不能像别的视图那样写一个 `struct X: View` 再返回它
 （编译器会说 `DynamicIsland` 不 conform to `View`）。
 只能把**区域的内容**抽成小结构体，在闭包里就地组装。
 
 这是本轮的第四个"看起来对但编译不过"的坑。
 */
struct FocusCompactLeading: View {
    var body: some View { Image(systemName: "timer") }
}

struct FocusCompactTrailing: View {
    let endsAt: Date

    var body: some View {
        // ⚠️ 这个位置**只放得下 `mm:ss`**。放"剩余 25:00"会被系统截掉，
        //    而截断的位置由字体与语言决定 —— 所以从一开始就只给时间。
        Text(timerInterval: Date()...endsAt, countsDown: true)
            .monospacedDigit()
            .frame(maxWidth: 54)
    }
}

struct FocusMinimal: View {
    var body: some View {
        // 同时有两个活动时只剩这个位置。**只放图标** ——
        // 塞数字会让它缩到看不清。
        Image(systemName: "timer")
    }
}

struct FocusExpandedLeading: View {
    var body: some View { Image(systemName: "timer").font(.title3) }
}

struct FocusExpandedTrailing: View {
    let endsAt: Date

    var body: some View {
        Text(timerInterval: Date()...endsAt, countsDown: true)
            .font(.title3)
            .monospacedDigit()
    }
}

struct FocusExpandedCenter: View {
    let title: String

    var body: some View {
        Text(title).font(.caption).lineLimit(1)
    }
}

struct FocusExpandedBottom: View {
    let state: FocusActivityAttributes.ContentState
    let strings: WidgetStrings

    var body: some View {
        if let start = state.progressStart {
            // 🔴 进度条也交给系统走，理由与倒计时相同。
            ProgressView(timerInterval: start...state.endsAt, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .tint(.orange)
        } else {
            Text(strings.focusRunning).font(.caption2)
        }
    }
}

@available(iOS 16.1, *)
public struct FocusSessionActivity: Widget {
    public init() {}

    public var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { context in
            FocusActivityLockScreenView(
                state: context.state,
                strings: WidgetStrings(language: .current())
            )
            .activityBackgroundTint(nil)
            .activitySystemActionForegroundColor(nil)
        } dynamicIsland: { context in
            let strings = WidgetStrings(language: .current())
            let state = context.state
            let title = state.sessionTitle.isEmpty ? strings.focusRunning : state.sessionTitle

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { FocusExpandedLeading() }
                DynamicIslandExpandedRegion(.trailing) { FocusExpandedTrailing(endsAt: state.endsAt) }
                DynamicIslandExpandedRegion(.center) { FocusExpandedCenter(title: title) }
                DynamicIslandExpandedRegion(.bottom) {
                    FocusExpandedBottom(state: state, strings: strings)
                }
            } compactLeading: {
                FocusCompactLeading()
            } compactTrailing: {
                FocusCompactTrailing(endsAt: state.endsAt)
            } minimal: {
                FocusMinimal()
            }
        }
    }
}
#endif
