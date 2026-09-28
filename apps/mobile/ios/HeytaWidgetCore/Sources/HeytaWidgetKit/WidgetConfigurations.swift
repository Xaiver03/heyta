// ⚠️ `#if os(iOS) || os(macOS)` 是**必须的**：SwiftPM 会为 `platforms` 里声明的
//    **每一个**平台编译**所有** target，而 `package.swift` 现在也声明了 `.watchOS(.v10)`
//    （为了 W5-1）。不加守卫的话，watchOS 构建会在这个文件上炸出
//    "'systemSmall' is unavailable in watchOS" —— 而这些家族确实只有手表没有。
//
//    这是"一个包同时服务 iOS 与 watchOS"的固定代价：平台专属代码必须显式声明边界。
#if os(iOS) || os(macOS)
import SwiftUI
import WidgetKit

import HeytaWidgetCore
import HeytaWidgetUI

/**
 四款组件的 WidgetKit 接线。
 ==============================

 ## 一个扩展承载四款组件

 WidgetKit 允许一个扩展用 `WidgetBundle` 暴露多个 `Widget` —— 每个
 `Widget` 有自己的 `kind`，用户在组件库里分别看到它们。

 这与 Android 那边**相反**（那边四款必须各有一个 `AppWidgetProvider` 类，
 因为 `appwidget-provider` 元数据是按 receiver 绑定的）。所以两边的
 "有几款组件"在代码里的形状不同 —— 但那个**声明**都只有一处
 （这里是 `WidgetKind`，那边是 `WidgetRefresh.specs()`）。

 ## 🔴 刷新策略是 `.never` —— 由应用显式推送

 四款组件的 `getTimeline` 都返回 `policy: .never`。这不是偷懒：

 | 方案 | 问题 |
 |---|---|
 | `.after(15 分钟)` | 系统**不保证**准时（预算限制），而且刷出来的还是同一份快照 —— 因为原生不会自己算"今天"。结果是"看起来在刷新、内容永远不变" |
 | `.atEnd` | 同上 |
 | **`.never` + 应用 `reloadTimelines`** | 每一帧都对应一次真实的快照更新 |

 关键理由：**原生不知道"今天"是什么**（时区、跨日切点都是产品规则，
 由应用算，见 `WidgetGate` 规则 2）。所以按时间刷新的组件**必然**在某一天
 显示昨天的数据 —— 直到应用推送新快照为止。
 与其让它"刷新但刷新出错的东西"，不如让它**只在数据真的变了时**刷新。

 ⚠️ 代价：如果应用长期不打开，组件会一直显示 `.stale`（"数据已过期"）而不是
 自己变空。这是**刻意的** —— 那个文案是真话，而"自己变空"会让用户以为
 今天没有任务。

 ## App Group 读取失败 = 占位，不是崩溃

 `WidgetSnapshotReader` 把 `nil` 字节（容器没配好 / 设备未解锁）当占位。
 所以即使 entitlements 配错了，组件也只会显示"打开 Heyta"而不是崩溃 ——
 这与文档里那条"配错了只看得到打开 Heyta"的坑一致：**它不崩溃，只是不显示**。
 */

/// 时间线条目。`WidgetContent` 已经是"判完的"结果，所以条目本身不再做判断。
struct HeytaEntry: TimelineEntry {
    let date: Date
    let content: WidgetContent
    /// W5-2 · 锁屏隐私偏好。**与 `content` 同一条路径读出来** ——
    /// 让视图各自去读会让四款组件读到不同的时刻，而症状是
    /// "今日任务藏了、习惯没藏"。默认值是"不额外隐藏"（交给系统那一层）。
    var privacy: WidgetPrivacyPreference = .default
}

/// 四款组件共用的 provider。
///
/// ⚠️ 它**没有** `kind` 也没有渲染闭包：四款的差别只在各自的
/// `StaticConfiguration` 闭包里（`entry.content` → 具体视图）。
/// 把渲染塞进 provider 需要类型擦除（`AnyView`），而那正好撞上 Swift 6
/// 对 `WidgetConfiguration` 的 Sendable 检查 —— **收益为零，代价是一堆并发注解**。
struct HeytaTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> HeytaEntry {
        // ⚠️ 组件库里的**预览**走这条路。它必须是**有内容**的 ——
        //    一个显示"打开 Heyta"的预览会让用户以为这款组件坏了。
        //
        //    ⚠️ 预览里 `privacy` 用**默认值**（不隐藏）：组件库是用户主动打开的，
        //       在预览里显示 `•••` 会让用户以为这款组件是坏的。
        HeytaEntry(date: Date(), content: Self.previewContent)
    }

    func getSnapshot(in context: Context, completion: @escaping (HeytaEntry) -> Void) {
        if context.isPreview {
            completion(HeytaEntry(date: Date(), content: Self.previewContent))
            return
        }
        completion(
            HeytaEntry(date: Date(), content: Self.readContent(), privacy: Self.readPrivacy())
        )
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HeytaEntry>) -> Void) {
        let entry = HeytaEntry(
            date: Date(), content: Self.readContent(), privacy: Self.readPrivacy()
        )
        // 见文件头：`.never`，由应用显式 `reloadTimelines` 推送。
        completion(Timeline(entries: [entry], policy: .never))
    }

    /// **唯一**的一条"从共享容器到内容"的路径。
    ///
    /// 与 Android 的 `WidgetRefresh.contentFor` 对应：解析只做一次，
    /// 然后喂给各自渲染。四款各自读一遍会让"某一款用了不同的密钥/不同的判定"
    /// 成为可能 —— 而那种分歧的表现是**四款里只有一款是错的**。
    static func readContent() -> WidgetContent {
        WidgetSnapshotReader(keyProvider: { WidgetDeviceKey.read() }).read(
            rawSnapshot: WidgetSharedStore.readSnapshot(),
            queue: WidgetSharedStore.readIntentQueue(),
            now: Date().timeIntervalSince1970 * 1000
        )
    }

    /// W5-2 · 读一次隐私偏好。与 `readContent()` 同一个目标：**只有一处**。
    static func readPrivacy() -> WidgetPrivacyPreference {
        WidgetSharedStore.readPrivacyPreference()
    }

    /// 组件库预览用的假内容。
    ///
    /// ⚠️ 它是**硬编码**的，所以**永远不能**被当成真实数据 ——
    /// 它只出现在 `context.isPreview` 为真的那条路径上。
    static var previewContent: WidgetContent {
        WidgetContent(
            state: .ready,
            dayStr: "2026-09-27",
            payload: WidgetPayload(
                today: [
                    WidgetTask(id: "p1", title: "买牛奶", isDone: false),
                    WidgetTask(id: "p2", title: "写周报", isDone: false),
                    WidgetTask(id: "p3", title: "锻炼", isDone: true),
                ],
                quadrant: [
                    "1": [WidgetTask(id: "q1", title: "交方案", isDone: false)],
                    "2": [WidgetTask(id: "q2", title: "读论文", isDone: false)],
                    "3": [],
                    "4": [],
                ],
                habits: [
                    WidgetHabit(id: "h1", title: "跑步", doneToday: true, streak: 12),
                    WidgetHabit(id: "h2", title: "阅读", doneToday: false, streak: 3),
                ],
                focus: WidgetFocus(active: true, targetSeconds: 1500, sessionTitle: "写方案"),
                projectColors: [:]
            ),
            targets: [:]
        )
    }
}

// ─────────────────────────────────────────────────────────────
// 四款组件
// ─────────────────────────────────────────────────────────────

/**
 🔴 四个配置里都**必须**有那个 `content:` 闭包，而且它必须真的构造视图。
 
 第一版我把四款组件的配置抽成一个泛型助手，结果：
 ① 我漏了 `content:` → 编译器报 `generic parameter 'Content' could not be inferred`；
 ② 补上之后 `StaticConfiguration` 的 `@escaping` 闭包与 Swift 6 对
    `WidgetConfiguration` 的 Sendable 检查正面冲突（`escaping closure captures
    non-escaping parameter`、`sending 'displayName' risks causing data races`）。
 
 两件事都指向同一个结论：**在这里做抽象是有害的**。
 所以四段样板老老实实展开 —— 它们各自都很短，且每一段都直接对应一款用户看得见的组件。
 （对比：Android 那边四款**必须**共用 `BaseWidgetProvider`，因为
 "四份实现 = 四倍机会漏掉安全细节"。这里不共用，因为这里没有安全细节可漏，
 而共用会引入上面那两类编译错误。**同一条纪律在不同约束下会得出不同做法。**）
 */

public struct TodayWidget: Widget {
    /// ⚠️ 必须显式 `public init()`：`Widget` 的成员是 internal，
    ///    而 extension target 在**另一个模块**里（它的 `@main` 要构造这些类型）。
    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.today, provider: HeytaTimelineProvider()) { entry in
            TodayWidgetRoot(entry: entry)
        }
        .configurationDisplayName("今日任务")
        .description("今天要做的任务，点一下即可完成。锁屏上也放得下。")
        // 🔴 一个 `Widget` 声明多个家族、按 `@Environment(\.widgetFamily)` 自适应 ——
        //    这是 iOS 的惯例。分成两个 `Widget` 的话，用户在组件库里会看到
        //    "今日任务"和"今日任务（锁屏）"，而后者听起来像是另一种东西。
        .supportedFamilies(Self.families)
    }

    /// 主屏两档 + 锁屏三档。
    ///
    /// ⚠️ `.accessoryInline` 也在里面 —— 它看起来"什么内容都没有"（只有计数），
    /// 但那正是它该有的样子，理由见 `LockScreenInlineView`。
    /// ⚠️ `#if os(iOS)` 是**必须的**：`.accessoryCircular` / `.accessoryRectangular` /
    ///    `.accessoryInline` 全都标了 `@available(macOS, unavailable)`，
    ///    而这个包同时声明了 `.macOS(.v14)`（因为 `swift build` / `swift test`
    ///    要在本机跑）。不判的话，`swift build` 会炸出三条 "unavailable in macOS"。
    ///
    ///    这与 `FocusActivityAttributes.swift` 那个 `canImport(ActivityKit) && os(iOS)`
    ///    是**同一个坑**：本机是 macOS，所以"iOS 独有的 API"这一类问题
    ///    只有真编译器能发现 —— 而它一定会发现。
    static var families: [WidgetFamily] {
        #if os(iOS)
        return [.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline]
        #else
        return [.systemSmall, .systemMedium]
        #endif
    }
}

/// 今日任务的**家族分派**。
///
/// ## 🔴 为什么 `.containerBackground` 不能无条件加
///
/// 主屏组件要它（不透明的卡片底）。**锁屏组件不能有它** ——
/// 锁屏组件是画在壁纸上的，加一个底色就是一块补丁，
/// 而系统的锁屏渲染会按"着色/透明"模式处理，两种模式下那块补丁的样子还不一样。
private struct TodayWidgetRoot: View {
    let entry: HeytaEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        #if os(iOS)
        case .accessoryCircular:
            LockScreenCircularView(model: lockModel, strings: strings)
        case .accessoryRectangular:
            LockScreenRectangularView(model: lockModel, strings: strings, privacy: entry.privacy)
        case .accessoryInline:
            LockScreenInlineView(model: lockModel, strings: strings)
        #endif
        default:
            TodayWidgetView(
                model: TodayWidgetModelBuilder.build(entry.content),
                strings: strings,
                toggleBuilder: { row in
                    ToggleTaskIntent(taskId: row.taskId, targetIsDone: row.targetIsDone)
                }
            )
            .containerBackground(.fill.tertiary, for: .widget)
        }
    }

    private var strings: WidgetStrings { WidgetStrings(language: .current()) }

    /// ⚠️ 锁屏模型与主屏模型是**两次构造**，但它们都从 `entry.content` 出发 ——
    /// 所以"点了最后一件任务之后两块屏幕不一致"这种事不可能发生：
    /// 两边都读同一份 `content.targets`（乐观叠加）。
    private var lockModel: WidgetLockScreenModel {
        WidgetLockScreenModelBuilder.build(entry.content, privacy: entry.privacy)
    }
}

public struct QuadrantWidget: Widget {
    /// ⚠️ 必须显式 `public init()`：`Widget` 的成员是 internal，
    ///    而 extension target 在**另一个模块**里（它的 `@main` 要构造这些类型）。
    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.quadrant, provider: HeytaTimelineProvider()) { entry in
            QuadrantWidgetView(
                model: QuadrantWidgetModelBuilder.build(entry.content),
                strings: WidgetStrings(language: .current()),
                toggleBuilder: { row in
                    ToggleTaskIntent(taskId: row.taskId, targetIsDone: row.targetIsDone)
                }
            )
            .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("四象限")
        .description("按重要与紧急看今天的事。")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

public struct HabitsWidget: Widget {
    /// ⚠️ 必须显式 `public init()`：`Widget` 的成员是 internal，
    ///    而 extension target 在**另一个模块**里（它的 `@main` 要构造这些类型）。
    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.habits, provider: HeytaTimelineProvider()) { entry in
            // 习惯行只读 → 整块打开应用（`widgetURL` 是 WidgetKit 的能力，
            // 所以挂在这里而不是可复用的视图里）。
            HabitsWidgetView(
                model: HabitsWidgetModelBuilder.build(entry.content),
                strings: WidgetStrings(language: .current())
            )
            .widgetURL(URL(string: "heyta://habits"))
            .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("今日习惯")
        .description("今天的习惯与连续天数。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

public struct FocusWidget: Widget {
    /// ⚠️ 必须显式 `public init()`：`Widget` 的成员是 internal，
    ///    而 extension target 在**另一个模块**里（它的 `@main` 要构造这些类型）。
    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.focus, provider: HeytaTimelineProvider()) { entry in
            FocusWidgetView(
                model: FocusWidgetModelBuilder.build(entry.content),
                strings: WidgetStrings(language: .current())
            )
            .widgetURL(URL(string: "heyta://focus"))
            .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("今日专注")
        .description("当前这一轮专注的目标时长。")
        .supportedFamilies([.systemSmall])
    }
}

#endif
