// ⚠️ 与 `WidgetConfigurations.swift` 同一个理由：`ControlWidget` 是 iOS 18 独有的，
//    而 SwiftPM 会为每个声明平台编译所有 target。
#if os(iOS)
import AppIntents
import SwiftUI
import WidgetKit

import HeytaWidgetCore

/**
 W5-4 · 控制中心的专注开关。
 ==============================

 ## 🔴 进程模型与其它组件**不一样**，这一点必须先说清楚

 | | 主屏 / 锁屏组件 | 控制中心控件 |
|---|---|---|
| 跑在哪 | **组件扩展**进程 | **App 自己的**进程（iOS 18 起） |
| 能读 App Group | ✅ | ✅ |
| 能读 Keychain | 需要显式配 access group | ✅ **用 App 自己的** keychain 组，不需要额外配置 |
| 能构造 op | ❌（写意图队列） | ❌（**同一条纪律**，见下） |

 所以"控制中心读不到加密快照"这个担心**不成立** —— 它跑在 App 进程里，
 权限比组件扩展**更宽**。真正需要小心的是**反过来**：
 它可以顺手写一条 op，而那是违反仓库硬约束的。

 ## 🔴 为什么是「按钮」而不是「开关」

 一个真正的 `ControlWidgetToggle` 需要把"开始/暂停专注"作为**一条 op**
 写进 op-log。而本仓库 §3.5 规定 **op 的构造只能发生在 `packages/app-host`** ——
 任何原生代码（iOS / Android / 鸿蒙）都不许自己造 op。
 组件点击可以只写"意图队列"，因为那是一个**只含 `{taskId, targetIsDone}` 的最小事实**；
 而"开始专注"要带标题、目标时长、起始时刻，**那已经是一条 op 了**。

 所以这里做成 **`ControlWidgetButton`**：点一下**打开 App**，
 由 App 走它本来就走的那条路径开始专注。
 这不是"没做完" —— 它是这条约束下**唯一正确**的形态。

 ⚠️ 以后想把它升级成开关，正确做法是给契约加一个 `focus` 意图类型
 （`WIDGET_INTENT_VERSION` 加一，四端同步），让原生只写"用户想要开始专注"这个事实。
 */

/// 深链。与 `ToggleTaskIntent` 那条一样，App 侧要有对应的路由。
enum ControlDeepLink {
    static let focus = URL(string: "heyta://focus")!
}

@available(iOS 18.0, *)
struct OpenFocusIntent: OpenIntent {
    static let title: LocalizedStringResource = "打开专注"
    static let description = IntentDescription("在 Heyta 里打开专注。")

    @Parameter(title: "目标")
    var target: FocusTarget

    init() {
        self.target = .open
    }

    init(target: FocusTarget) {
        self.target = target
    }

    func perform() async throws -> some IntentResult & OpensIntent {
        // 打开 App 本身由 `ControlWidgetButton` 的 `OpenIntent` 机制完成；
        // 这里只负责把**目标**带过去。
        .result(opensIntent: OpenURLIntent(ControlDeepLink.focus))
    }
}

@available(iOS 18.0, *)
enum FocusTarget: String, AppEnum {
    case open
    case start

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "专注目标"
    static let caseDisplayRepresentations: [FocusTarget: DisplayRepresentation] = [
        .open: "打开专注",
        .start: "开始专注",
    ]
}

/**
 控制中心里的「专注」。

 ⚠️ 这一款**不显示当前状态**（不是一个 toggle），所以它不需要 `ControlValueProvider`。
 不显示状态是**明确的选择**：控制中心的控件没有可靠的刷新时机 ——
 它在专注结束的那一刻不会自动重绘。显示一个"专注中"的旧状态，
 比不显示状态更糟：用户会以为专注还在跑。
 */
@available(iOS 18.0, *)
public struct FocusControl: ControlWidget {
    public init() {}

    public var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: WidgetKind.focus) {
            ControlWidgetButton(action: OpenFocusIntent(target: .open)) {
                Label("专注", systemImage: "timer")
            }
        }
        .displayName("专注")
        .description("打开 Heyta 的专注。")
    }
}
#endif
