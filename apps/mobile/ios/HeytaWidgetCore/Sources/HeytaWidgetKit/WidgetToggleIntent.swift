// ⚠️ `#if os(iOS) || os(macOS)` 是**必须的**：SwiftPM 会为 `platforms` 里声明的
//    **每一个**平台编译**所有** target，而 `package.swift` 现在也声明了 `.watchOS(.v10)`
//    （为了 W5-1）。不加守卫的话，watchOS 构建会在这个文件上炸出
//    "'systemSmall' is unavailable in watchOS" —— 而这些家族确实只有手表没有。
//
//    这是"一个包同时服务 iOS 与 watchOS"的固定代价：平台专属代码必须显式声明边界。
#if os(iOS) || os(macOS)
import AppIntents
import Foundation
import WidgetKit

import HeytaWidgetCore

/**
 组件上点一下任务 → 写一条意图 + 刷时间线。
 ============================================

 ## 🔴 这里**不产生 op** —— 这是刻意的红线

 组件进程**不允许**直接改应用数据（它拿不到 op-log 的写入口，也**不该**有）。
 它只能把"我希望这个任务变成 X"写进共享容器，等应用下次醒来时 drain。
 见 `WidgetIntentQueue` 的文件头与 §3.4「一个用户意图 = 一个 op」。

 ## 🔴 传的是**目标状态**，不是"切换"

 动作（toggle）在**过期视图**上会算错：用户看到未完成、实际已完成，
 点一下变成"标记完成" = **没有变化**。用户会以为坏了。

 目标状态是**幂等**的：无论当前是什么，结果都是它。
 注意 `targetIsDone` 是**在构造这个 intent 时**由行模型算好的
 （`WidgetTaskRow.targetIsDone` = `!isDone`），所以它反映的是
 **用户当时看到的那一面**。

 ## 为什么 `openAppWhenRun = false`

 iOS 17 的交互式组件在**扩展进程**里就地执行，不切到应用 ——
 用户点一下就能看到勾选变化，这是交互式组件存在的意义。
 代价是：**应用可能很久之后才知道**这件事（下一次前台）。
 我们接受这个代价：任务状态本来就是最终一致的，而且用户看到即时反馈。

 ⚠️ 这也意味着**编辑类操作**（改标题、改日期）绝不能做成组件按钮 ——
 那些需要用户看到冲突处理，而组件里没有地方显示冲突。
 */
public struct ToggleTaskIntent: AppIntent {
    // ⚠️ `static let` 而不是 `var`：协议要求的是 `{ get }`，而 `let` 能满足它。
    //    写成 `var` 在 Swift 6 的严格并发下是「非隔离的全局可变状态」，编译不过。
    public static let title: LocalizedStringResource = "Toggle task"

    /// 组件点击**不**打开应用。
    public static let openAppWhenRun: Bool = false

    /// ⚠️ App Intents 的参数会被系统**编码进点击事件**，
    /// 所以它们的类型必须能安全往返（String / Bool 都可以）。
    @Parameter(title: "taskId")
    public var taskId: String

    @Parameter(title: "targetIsDone")
    public var targetIsDone: Bool

    public init() {
        // App Intents 需要一个无参初始化器（系统反序列化时用）。
        self.taskId = ""
        self.targetIsDone = false
    }

    public init(taskId: String, targetIsDone: Bool) {
        self.taskId = taskId
        self.targetIsDone = targetIsDone
    }

    public func perform() async throws -> some IntentResult {
        // `at` 用真实时间：合并是"后写者胜"，但这个字段也让排查有据可查。
        WidgetSharedStore.mergeIntent(
            WidgetIntent(
                taskId: taskId,
                targetIsDone: targetIsDone,
                at: widgetIntentEpochMilliseconds()
            )
        )

        // 🔴 只刷这一款组件。`reloadTimelines(ofKind:)` 而不是
        //    `reloadAllTimelines()` —— 后者会让四款全部重画，
        //    而系统对刷新有预算（每款组件每天的次数有限）。
        //    用户的点击只影响一款，没有理由消耗另外三款的预算。
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.today)

        return .result()
    }
}

#endif
