import Foundation

/**
 四款组件的**渲染模型**（Swift 侧）。
 ======================================

 与 Android 的 `TodayWidgetModel.kt` / `QuadrantWidgetModel.kt` /
 `HabitsWidgetModel.kt` / `FocusWidgetModel.kt` 一一对应。

 ## 为什么要有这一层（不是"为了好看"）

 SwiftUI 视图是**声明式**的，所以判断写在视图里也能编译、也能跑 —— 但它**测不了**：
 一个 `Widget` 的 `body` 没有返回值可断言，`WidgetKit` 的时间线更是要设备才能驱动。
 判断留在视图里的后果是"每一条规则都只能靠肉眼看组件"。

 所以：判断全在这一层（纯函数、有 `swift test`），视图层只做"照着抄"。
 这与 Android 侧「`RemoteViews` 在 JVM 上是桩 → 判断全挤进 ModelBuilder」是同一条纪律。
 */

// ─────────────────────────────────────────────────────────────
// 一行任务（今日任务与四象限共用）
// ─────────────────────────────────────────────────────────────

/// 一个可点击的任务行。对应 Kotlin 的 `WidgetTaskRow`。
public struct WidgetTaskRow: Equatable, Sendable {
    public let taskId: String
    public let title: String
    /// **要显示成什么**（可能被待处理意图乐观叠加过）。
    public let isDone: Bool
    /// **点击后要写进队列的目标状态**。与 [isDone] 相反 —— 点击就是翻到另一面。
    public let targetIsDone: Bool
}

/// 由任务 + 乐观叠加算出该画成什么。四款组件**唯一**的转换处。
func taskRow(_ task: WidgetTask, _ targets: [String: Bool]) -> WidgetTaskRow {
    let shown = WidgetGate.shownAsDone(task, targets)
    return WidgetTaskRow(taskId: task.id, title: task.title, isDone: shown, targetIsDone: !shown)
}

// ─────────────────────────────────────────────────────────────
// 今日任务
// ─────────────────────────────────────────────────────────────

public struct TodayWidgetModel: Equatable, Sendable {
    public let state: WidgetState
    public let dayStr: String?
    public let rows: [WidgetTaskRow]
    public let doneCount: Int
    public let totalCount: Int

    /// 行槽数量 —— 必须与 `HeytaWidgetUI` 的布局一致。
    public static let rowSlots = 5
}

public enum TodayWidgetModelBuilder {
    public static func build(_ content: WidgetContent) -> TodayWidgetModel {
        guard let payload = content.payload else {
            // 占位与过期都到这里 —— `WidgetGate` 保证 payload 只在 `.ready` 时非 nil。
            // **刻意不给行**：这两状态下没有可信内容可说。
            return TodayWidgetModel(
                state: content.state, dayStr: content.dayStr,
                rows: [], doneCount: 0, totalCount: 0
            )
        }

        // 不在这里做 `prefix(widgetMaxTasks)`：条数上限是**解析器的判据**
        //（超过 20 条整体拒绝），在这里再截一刀会把一次契约违例
        // **掩盖**成"正常显示 20 条"。
        let rows = payload.today.map { taskRow($0, content.targets) }
        return TodayWidgetModel(
            state: .ready, dayStr: content.dayStr,
            rows: rows,
            doneCount: rows.filter(\.isDone).count,
            totalCount: rows.count
        )
    }
}

// ─────────────────────────────────────────────────────────────
// 四象限
// ─────────────────────────────────────────────────────────────

public struct QuadrantWidgetGroup: Equatable, Sendable {
    /// 契约里的槽位号字符串（`"1"..."4"`），**不是**显示名。
    public let slot: String
    public let total: Int
    public let done: Int
    public let rows: [WidgetTaskRow]
}

public struct QuadrantWidgetModel: Equatable, Sendable {
    public let state: WidgetState
    public let dayStr: String?
    /// 恒为 4 个（`"1"..."4"` 顺序固定）—— 即使某个象限是空的，也保留它的位置。
    public let groups: [QuadrantWidgetGroup]
}

public enum QuadrantWidgetModelBuilder {
    /// 契约里的槽位号，顺序即显示顺序（与 `QUADRANT_META` 的 `quadrant-1..4` 一致）。
    public static let slots = ["1", "2", "3", "4"]

    /// 每个象限最多画几行。取 2 的理由与 Android 侧一致：四象限的价值是
    /// **一眼看出哪一格堆着东西**，不是把每格都读全。
    public static let rowsPerGroup = 2

    public static func build(_ content: WidgetContent) -> QuadrantWidgetModel {
        guard let payload = content.payload else {
            return QuadrantWidgetModel(state: content.state, dayStr: content.dayStr, groups: [])
        }

        // `quadrant` 整个键是可选的。缺席与"四个空象限"在渲染上应该**一样**。
        let buckets = payload.quadrant ?? [:]

        let groups = slots.map { slot -> QuadrantWidgetGroup in
            let tasks = buckets[slot] ?? []
            return QuadrantWidgetGroup(
                slot: slot,
                total: tasks.count,
                done: tasks.filter { WidgetGate.shownAsDone($0, content.targets) }.count,
                rows: selectRows(tasks, content.targets)
            )
        }

        return QuadrantWidgetModel(state: .ready, dayStr: content.dayStr, groups: groups)
    }

    /// 选要画的那几行：**未完成优先**，然后按载荷里的原始顺序。
    ///
    /// 为什么未完成优先：象限视图回答的是"这一格还堆着什么"。一格里有 3 条已完成、
    /// 1 条未完成时，画前两条已完成等于**把唯一要看的藏起来**。
    ///
    /// ⚠️ `sorted` 在 Swift 里**不保证稳定**（文档明确说"not guaranteed to be stable"）！
    /// Kotlin 那边 `sortedBy` 是稳定的，所以两端的**同分顺序可能不同**。
    /// 这里显式用下标做第二排序键，把顺序钉死 —— 否则会出现
    /// "iOS 与 Android 显示的象限内容顺序不一样"，而两边各自都"没错"。
    private static func selectRows(_ tasks: [WidgetTask], _ targets: [String: Bool]) -> [WidgetTaskRow] {
        tasks.enumerated()
            .sorted { a, b in
                let ka = WidgetGate.shownAsDone(a.element, targets) ? 1 : 0
                let kb = WidgetGate.shownAsDone(b.element, targets) ? 1 : 0
                if ka != kb { return ka < kb }
                return a.offset < b.offset
            }
            .prefix(rowsPerGroup)
            .map { taskRow($0.element, targets) }
    }
}

// ─────────────────────────────────────────────────────────────
// 今日习惯
// ─────────────────────────────────────────────────────────────

/// 🔴 **行是只读的**（点一下打开应用，不写意图队列）。
///
/// 这不是没做完，是契约里没有这个东西：意图队列的元素是 `{taskId, targetIsDone}`，
/// 表达的是"**把这个任务**翻到某个完成状态"。习惯**不是任务**。
///
/// 那能不能**假装**成任务塞进去？试一下就知道不行：应用侧 drain 时会拿 `taskId`
/// 去任务表里查，查不到 → 归类为 `skippedMissing` → **丢弃**。
/// 用户以为打卡成功了，应用这边**什么都没发生，也没有任何日志**。
///
/// 所以这里的选择是**不假装**。要让组件里能打卡，需要的是**契约变更**
/// （意图队列加一种 intent kind），已记进账本 §4 的 U9。
public struct HabitsWidgetRow: Equatable, Sendable {
    public let habitId: String
    public let title: String
    public let doneToday: Bool
    public let streak: Int
}

public struct HabitsWidgetModel: Equatable, Sendable {
    public let state: WidgetState
    public let dayStr: String?
    public let rows: [HabitsWidgetRow]
    public let doneCount: Int
    public let totalCount: Int

    public static let rowSlots = 5
}

public enum HabitsWidgetModelBuilder {
    public static let maxRows = HabitsWidgetModel.rowSlots

    public static func build(_ content: WidgetContent) -> HabitsWidgetModel {
        guard let payload = content.payload else {
            return HabitsWidgetModel(
                state: content.state, dayStr: content.dayStr,
                rows: [], doneCount: 0, totalCount: 0
            )
        }

        // ⚠️ `habits` 整个键是可选的。缺席 = 用户没有习惯，与"有 0 个习惯"在渲染上一样。
        //
        // 🔴 计数用**全部**习惯，但只画前 `maxRows` 条 —— 两个数必须来自同一个集合，
        //    否则会出现 "3/7" 而列表里只有 5 行可数，用户会以为显示不全。
        let all = payload.habits ?? []

        return HabitsWidgetModel(
            state: .ready,
            dayStr: content.dayStr,
            rows: all.prefix(maxRows).map { habit in
                HabitsWidgetRow(
                    habitId: habit.id,
                    title: habit.title,
                    doneToday: habit.doneToday,
                    // ⚠️ 负数在这里是坏数据（契约校验应当已经拒绝），但仍夹一下：
                    //    显示 "连续 -3 天" 比不显示更糟。
                    streak: max(0, habit.streakCount)
                )
            },
            doneCount: all.filter(\.doneToday).count,
            totalCount: all.count
        )
    }
}

// ─────────────────────────────────────────────────────────────
// 今日专注
// ─────────────────────────────────────────────────────────────

/// 专注组件比其它三款多两个状态：快照可信，但"有没有在专注"是另一回事。
public enum FocusWidgetState: Equatable, Sendable {
    case placeholder
    case stale
    /// 快照可信，但当前**没有**进行中的专注。
    case idle
    /// 快照可信，且快照发布时有一场专注在进行。
    case active
}

/**
 🔴 **这款组件不显示倒计时** —— 这是刻意的，也是 iOS 侧最重要的一个取舍。
 
 契约里的 `WidgetFocus.remainingSeconds` 是**发布那一刻**算出来的快照值，
 **没有任何绝对时间锚点**。于是：应用在 09:00 发布"剩余 25:00"，
 用户在 09:10 看一眼组件 —— 组件如果照着画，会显示 **"剩余 25:00"**。
 那不是"稍微不准"，那是**错的**：
 
 - 它**看起来是对的**（一个整整齐齐的倒计时），用户没有理由怀疑它；
 - 真实剩余是 15:00，用户照着 25:00 安排事情；
 - 更糟的是 `active` 也是冻结的：一场 09:25 就结束的专注，10:00 时组件还会说
   **"专注中"** —— 在用户明明已经不在专注的时候。
 
 所以这里只画**不会随时间变**的事实：会话标题 + 目标时长。
 **宁可少显示一个数字，也不显示一个错的数字。**
 
 正确的修法是给契约加一个**绝对**字段 `endsAt`（`FocusState` 里本来就有），
 原生于是能算 `remaining = endsAt - now` —— 那是**它已经有权做的事**
 （它本来就在判 `now >= validUntil`）。见账本 §4 的 U8。
 */
public struct FocusWidgetModel: Equatable, Sendable {
    public let state: FocusWidgetState
    public let dayStr: String?
    /// 仅 `.active` 时非 `nil`。
    public let sessionTitle: String?
    /// 本轮目标秒数。仅 `.active` 时有意义 —— 它是静态事实，不会随时间变。
    public let targetSeconds: Int?
}

public enum FocusWidgetModelBuilder {
    public static func build(_ content: WidgetContent) -> FocusWidgetModel {
        guard let payload = content.payload else {
            return FocusWidgetModel(
                state: content.state == .stale ? .stale : .placeholder,
                dayStr: content.dayStr,
                sessionTitle: nil,
                targetSeconds: nil
            )
        }

        guard let focus = payload.focus, focus.active else {
            return FocusWidgetModel(state: .idle, dayStr: content.dayStr, sessionTitle: nil, targetSeconds: nil)
        }

        return FocusWidgetModel(
            state: .active,
            dayStr: content.dayStr,
            // ⚠️ 契约里 `sessionTitle` 可为空（用户常常不填）—— 视图层据此换成
            //    一个通用标题，而不是画一个空字符串（那会看起来像渲染坏了）。
            sessionTitle: focus.sessionTitle,
            // 目标时长必须是正数才显示；0 或负数都是坏数据。
            targetSeconds: focus.targetSeconds.flatMap { $0 > 0 ? Int($0) : nil }
        )
    }
}
