import SwiftUI
import WidgetKit

import HeytaWidgetKit

/**
 WidgetKit 扩展的入口 —— **本 target 里唯一的源文件**。
 ========================================================

 ## 🔴 `@main` 为什么必须在这个 target 里，而不是 SwiftPM 包里

 第一版我把 `@main struct HeytaWidgetBundle: WidgetBundle` 放在了 SwiftPM 的
 **library** target 里。那**不会**工作：`@main` 提供的是进程入口点，
 而 library 不是可执行产物 —— 扩展启动时系统找不到那个入口，
 症状是"组件能加到桌面、但永远空白"（没有崩溃、没有日志）。

 所以切法是：
 - **逻辑与四款组件的定义**留在 SwiftPM 包（`HeytaWidgetKit`，可在本机 `swift test`）；
 - **入口**放在这个 extension target（十行）。

 与 `HeytaWidgetModule.swift` 那次是**同一个切法**：
 能被测试的部分进包，不能被测的部分只剩声明。

 ## ⚠️ 这个文件与包**不能同时**定义 `@main`

 包里的那个已经删掉了（`WidgetConfigurations.swift` 现在只到四款 `Widget` 为止）。
 两边都有的话会得到 `'main' attribute cannot be used in a module that contains
 top-level code` 之类的错误 —— 或者更糟：链接到错误的入口点。

 ## 四款组件在这里被**一次性全部列出**

 `WidgetKind.all`（在包里）是"有哪几款组件"的**唯一声明**，
 但 `WidgetBundle.body` 要求的是**类型**而不是字符串，所以这里必须再列一次。

 ⚠️ 这是全项目**唯一一处**"加第五款组件时容易漏改"的地方 ——
 漏了的表现是"新组件在组件库里看不到"，而没有任何报错。
 它与 Android 侧 `WidgetRefresh.specs()` 的角色相同，但 Android 那边能做成
 单一声明（因为 `AppWidgetProvider` 有 manifest 里的 receiver 兜底），
 这里受 Swift 的类型系统限制做不到。**记下来，别当成疏漏。**
 */
@main
struct HeytaWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        QuadrantWidget()
        HabitsWidget()
        FocusWidget()

        // W5-3 · 专注 Live Activity（灵动岛 + 锁屏横幅）。
        //
        // ⚠️ 它**不是**第五块"组件"：`ActivityConfiguration` 不占组件库的位置，
        //    用户在组件库里看不到它，它是应用**主动请求**才出现的。
        //    所以它与 `WidgetKind.all`（那四款）**刻意不一致** ——
        //    把它的 kind 塞进 `WidgetKind.all` 会让 `reloadTimelines(ofKind:)`
        //    去刷新一个根本不是时间线的东西。
        if #available(iOS 16.1, *) {
            FocusSessionActivity()
        }

        // W5-4 · 控制中心的专注控件（iOS 18+）。
        //    同样不占组件库的位置，理由同上。
        if #available(iOS 18.0, *) {
            FocusControl()
        }
    }
}
