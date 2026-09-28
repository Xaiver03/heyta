#if os(watchOS)
import SwiftUI
import WidgetKit

import HeytaWidgetCore
import HeytaWidgetUI

/**
 W5-1 · watchOS 组件。
 ======================

 ## 🔴 手表上"没有另一套 UI"，只有另一套**家族与约束**

 | | iPhone 主屏 | iPhone 锁屏 | Apple Watch |
|---|---|---|---|
| 家族 | `.systemSmall` / `.systemMedium` | `.accessoryCircular` / `.accessoryRectangular` / `.accessoryInline` | 只有 accessory 系（+ `.accessoryCorner`） |
| 背景 | 我们画（`containerBackground`） | **系统画在壁纸上** | 系统画 |
| 逐行可点 | ✅ `Button(intent:)` | ❌ | ❌ |

 所以手表这一端**复用 `HeytaWidgetUI` 里的锁屏视图**，一行渲染都不重写。
 重写一遍的后果和四端各自重写一样：某一端会漂移，而漂移的表现是
 **"手表上那块是错的、手机上是对的"** —— 用户会以为是手表的问题。

 ## ⚠️ 表盘上的 `.accessoryCorner`

 它是 watchOS **独有**的一个家族（表盘四角）。我们**不支持**它：
 它的内容会沿表盘边缘**弧形弯曲**，而"今日任务"的名字长度完全不可控
 （中文 2 字、英文 20 字符），弯起来会被表盘裁掉一半。
 不支持 ≠ 没做：`.supportedFamilies` 里不写它就是**明确不支持**，
 用户在表盘上找不到它，不会看到一块被裁坏的组件。

 ## 🔴 手表上**不做**可交互

 手表上的组件点击只能**打开应用**（`widgetURL`），没有 iOS 17 那种
 `Button(intent:)`。所以手表这一端**只有读**，没有写回。
 这不是省略 —— 手表的点击回写需要一整套 `WidgetKit` + `AppIntents` 的手表适配，
 而 iOS 主屏那套已经能在**手机**上完成"点一下完成任务"。
 手表上做"点一下就完成任务"会让用户在两个设备上做同一件事却看到不同的结果。
 */
struct WatchEntry: TimelineEntry {
    let date: Date
    let content: WidgetContent
    var privacy: WidgetPrivacyPreference = .default
}

struct WatchTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchEntry {
        WatchEntry(date: Date(), content: Self.previewContent)
    }

    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) {
        if context.isPreview {
            completion(WatchEntry(date: Date(), content: Self.previewContent))
            return
        }
        completion(WatchEntry(date: Date(), content: Self.readContent(), privacy: Self.readPrivacy()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) {
        // 与 iPhone 侧同一条策略：`.never`，由应用显式推送。
        completion(
            Timeline(
                entries: [WatchEntry(date: Date(), content: Self.readContent(), privacy: Self.readPrivacy())],
                policy: .never
            )
        )
    }

    /// 🔴 **同一份**读取路径（`WidgetSharedStore`），不是手表专用的一条。
    /// 走另一条路径就会有一个真实的后果：手机与手表读到**不同时刻**的快照，
    /// 而两块屏幕会同时显示"今天"，内容却不一样。
    static func readContent() -> WidgetContent {
        WidgetSnapshotReader(keyProvider: { WidgetDeviceKey.read() }).read(
            rawSnapshot: WidgetSharedStore.readSnapshot(),
            queue: WidgetSharedStore.readIntentQueue(),
            now: Date().timeIntervalSince1970 * 1000
        )
    }

    static func readPrivacy() -> WidgetPrivacyPreference {
        WidgetSharedStore.readPrivacyPreference()
    }

    static var previewContent: WidgetContent {
        WidgetContent(
            state: .ready,
            dayStr: "2026-09-27",
            payload: WidgetPayload(
                today: [
                    WidgetTask(id: "w1", title: "买牛奶", isDone: false),
                    WidgetTask(id: "w2", title: "写周报", isDone: false),
                    WidgetTask(id: "w3", title: "锻炼", isDone: true),
                ]
            ),
            targets: [:]
        )
    }
}

public struct WatchTodayWidget: Widget {
    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.today, provider: WatchTimelineProvider()) { entry in
            WatchTodayRoot(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("今日任务")
        .description("今天要做的任务与条数。")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

public struct WatchHabitsWidget: Widget {
    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.habits, provider: WatchTimelineProvider()) { entry in
            WatchHabitsRoot(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("今日习惯")
        .description("今天的习惯与连续天数。")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}

/// 今日任务 · 手表分派。**复用 iPhone 锁屏那三个视图。**
private struct WatchTodayRoot: View {
    let entry: WatchEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let model = WidgetLockScreenModelBuilder.build(entry.content, privacy: entry.privacy)
        switch family {
        case .accessoryRectangular:
            LockScreenRectangularView(model: model, strings: strings, privacy: entry.privacy)
        case .accessoryInline:
            LockScreenInlineView(model: model, strings: strings)
        default:
            LockScreenCircularView(model: model, strings: strings)
        }
    }

    private var strings: WidgetStrings { WidgetStrings(language: .current()) }
}

/// 今日习惯 · 手表分派。
///
/// ⚠️ 习惯用的是**另一套模型**（`HabitsWidgetModel`），因为手表上
/// 圆形家族显示的是"完成了几件习惯"，与今日任务的"还剩几件任务"
/// 是两个不同的数。混用一个模型会让用户在表盘上看到
/// "还有 3 件"而分不清那是任务还是习惯。
private struct WatchHabitsRoot: View {
    let entry: WatchEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let model = HabitsWidgetModelBuilder.build(entry.content)
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(strings.widgetTitleHabits).font(.headline)
                if let first = model.rows.first {
                    Text(first.title).font(.caption).lineLimit(1).privacySensitive()
                } else {
                    Text(strings.noHabits).font(.caption).foregroundStyle(.secondary)
                }
            }
        default:
            // 圆形：完成数。**没有习惯时显示 `–`，不是 0** ——
            // 0 会被读成"今天一个都没做"。
            if model.rows.isEmpty {
                Text("–").font(.system(size: 22, weight: .semibold))
            } else {
                Text("\(model.rows.filter(\.doneToday).count)/\(model.rows.count)")
                    .font(.system(size: 18, weight: .semibold))
                    .monospacedDigit()
            }
        }
    }

    private var strings: WidgetStrings { WidgetStrings(language: .current()) }
}
#endif
