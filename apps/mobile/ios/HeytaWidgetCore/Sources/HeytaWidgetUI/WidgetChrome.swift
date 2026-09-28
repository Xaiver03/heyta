import AppIntents
import SwiftUI

import HeytaWidgetCore

/**
 四款组件共用的零件（Swift 侧）。
 ==================================

 与 Android 的 `WidgetViewParts.kt` 一一对应 —— 那边是因为 `RemoteViews` 只能
 按固定 id 操作视图，这边是因为四款组件的"外壳"本来就该长得一样。

 ## 🔴 文案**不能**硬编码成中文

 这一段是刻意放在这里的：iOS 侧**没有任何自动门禁**能发现硬编码文案
（`check:ui-language` 只扫 `apps/…/src` 下的 ts/tsx，`check:layering` 的
`SKIP_DIRS` 直接跳过 `ios`）。所以这里用一个显式的 [WidgetStrings] 表，
让"加一条文案"这件事**必须**在 zh 与 en 两处各写一次 ——
它仍然可能漂移，但至少不会有人"顺手"写一个中文字面量而没人发现。

 ⚠️ 更彻底的方案是 `.xcstrings` 字符串目录 + 扩展自己的 bundle。
 那需要 Xcode target 与 `CFBundleLocalizations` 配置，属于 W2 的 target 接线部分；
 这里先用表 —— 它至少是**可测的**（见 `WidgetStringsTests`）。
 */
public enum WidgetLanguage: Sendable {
    case zh, en

    /// 从系统偏好里读。**只支持 zh / en**，其余一律回落到 en。
    public static func current(preferred: [String] = Locale.preferredLanguages) -> WidgetLanguage {
        guard let first = preferred.first?.lowercased() else { return .en }
        return first.hasPrefix("zh") ? .zh : .en
    }
}

/// 小组件用到的全部文案。zh / en 一一对应。
public struct WidgetStrings: Sendable {
    public let language: WidgetLanguage

    public init(language: WidgetLanguage) {
        self.language = language
    }

    private func pick(_ zh: String, _ en: String) -> String {
        language == .zh ? zh : en
    }

    // —— 通用 ——

    /// 没有快照 / 密钥拿不到 / 解密失败。四款组件共用。
    public var openAppToShow: String {
        pick("打开 Heyta 以显示内容", "Open Heyta to show content")
    }

    /// 快照过期（`now >= validUntil`）。
    public var dataExpired: String { pick("数据已过期", "Data expired") }

    /// 用完但确实没有内容可列。
    public var nothingToday: String { pick("今天没有任务", "Nothing today") }

    public var noHabits: String { pick("还没有习惯", "No habits yet") }

    public var notFocusing: String { pick("没有进行中的专注", "Not focusing") }

    public var focusInProgress: String { pick("专注中", "Focusing") }

    // —— 四象限 ——
    //
    // 🔴 这四个名字必须与 `packages/domain/src/quadrant.ts` 的 `QUADRANT_META.label`
    //    逐字一致。不一致的表现是"应用里叫重要且紧急、组件上叫别的名称"，
    //    而**两处都"对"**，只是不同 —— 没有任何门禁会发现。
    //    Android 侧在 `values/strings.xml` 里有同样一组。
    public var quadrant1: String { pick("重要且紧急", "Urgent & important") }
    public var quadrant2: String { pick("重要不紧急", "Important, not urgent") }
    public var quadrant3: String { pick("紧急不重要", "Urgent, not important") }
    public var quadrant4: String { pick("不重要不紧急", "Neither") }

    public func quadrant(_ slot: String) -> String {
        switch slot {
        case "1": return quadrant1
        case "2": return quadrant2
        case "3": return quadrant3
        case "4": return quadrant4
        default: return slot
        }
    }

    // —— 计数 ——

    /// "3/5"。
    public func counter(done: Int, total: Int) -> String { "\(done)/\(total)" }

    /// "目标 25 分钟"。
    public func targetMinutes(_ minutes: Int) -> String {
        pick("目标 \(minutes) 分钟", "Target \(minutes) min")
    }

    /// "连续 12 天"。
    public func streakDays(_ days: Int) -> String {
        pick("连续 \(days) 天", "\(days)-day streak")
    }

    // —— W5-2 锁屏组件 ——
    //
    // ⚠️ 行内（`.accessoryInline`）那三条是**独立文案**，不是长文案的截断。
    //    它的位置只有十几个字符宽，"打开 Heyta 以显示内容"会被系统截成
    //    "打开 Heyta 以显…"。给一条本来就短的，比让系统随手截断好 ——
    //    截断的位置由字体与语言决定，**我们控制不了也测不到**。

    /// 锁屏矩形那块的小标题。
    public var widgetTitle: String { pick("今日任务", "Today") }

    /// 手表上的习惯标题（`widgetTitle` 是任务用的）。
    public var widgetTitleHabits: String { pick("今日习惯", "Habits") }

    /// 无障碍朗读用："还有 3 件事"。**不要**用它做可见文案（太长）。
    public func openTaskCount(_ count: Int) -> String {
        pick("还有 \(count) 个任务", "\(count) tasks left")
    }

    /// 行内 · 没数据。
    public var inlineNoData: String { pick("Heyta 待打开", "Heyta — open") }

    /// 行内 · 全部完成。
    public var inlineAllDone: String { pick("全部完成", "All done") }

    /// 行内 · "还有 3 件"。
    public func inlineOpenCount(_ count: Int) -> String {
        pick("还有 \(count) 件", "\(count) left")
    }

    // —— W5-3 专注 / 灵动岛 ——
    //
    // 🔴 这是**唯一**一个允许显示倒计时的位置：灵动岛由系统按时间轴驱动
    //    （`Text(timerInterval:)`），每秒自己算 —— 不是一个静态快照。
    //    主屏/锁屏的专注卡片仍然**只显示目标时长**。

    /// 专注结束时刻已经过去 / 暂停中。
    public var focusPaused: String { pick("已暂停", "Paused") }

    /// "本轮目标 25 分钟"。
    public var focusFinished: String { pick("专注结束", "Focus done") }

    /// 灵动岛展开时的小标题。
    public var focusRunning: String { pick("专注中", "Focusing") }
}

// ─────────────────────────────────────────────────────────────
// 零件
// ─────────────────────────────────────────────────────────────

/// 组件头部：左边一句标题（日期 / 计数），右边可选一点补充。
public struct WidgetHeaderView: View {
    let title: String
    let trailing: String?

    public init(title: String, trailing: String? = nil) {
        self.title = title
        self.trailing = trailing
    }

    public var body: some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
            Spacer(minLength: 0)
            if let trailing {
                Text(trailing)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
            }
        }
    }
}

/// 一行任务。
///
/// 🔴 点击**不是**本地改状态，而是触发 [toggle]（一个 App Intent）。
/// 这是 iOS 17 交互式组件唯一正确的做法：组件进程**不允许**直接改应用数据，
/// 它只能把"我希望它变成 X"这件事写进共享容器，等应用醒来时 drain。
/// 参见 `WidgetIntentQueue` 的文件头。
public struct WidgetTaskRowView<Intent: AppIntent>: View {
    let row: WidgetTaskRow
    let toggle: Intent

    public init(row: WidgetTaskRow, toggle: Intent) {
        self.row = row
        self.toggle = toggle
    }

    public var body: some View {
        Button(intent: toggle) {
            HStack(spacing: 6) {
                Image(systemName: row.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 13))
                    .foregroundStyle(row.isDone ? Color.accentColor : Color.secondary)
                Text(row.title)
                    .font(.system(size: 13))
                    .strikethrough(row.isDone, color: .secondary)
                    .foregroundStyle(row.isDone ? Color.secondary : Color.primary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
    }
}

/// **只读**的一行（习惯用，也可以给任何"点了就打开应用"的行）。
public struct WidgetReadOnlyRowView: View {
    let title: String
    let trailing: String?
    let isDone: Bool

    public init(title: String, trailing: String? = nil, isDone: Bool = false) {
        self.title = title
        self.trailing = trailing
        self.isDone = isDone
    }

    public var body: some View {
        HStack(spacing: 6) {
            Image(systemName: isDone ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 13))
                .foregroundStyle(isDone ? Color.accentColor : Color.secondary)
            Text(title)
                .font(.system(size: 13))
                .foregroundStyle(isDone ? Color.secondary : Color.primary)
                .lineLimit(1)
            Spacer(minLength: 0)
            if let trailing {
                Text(trailing)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// 一段居中的说明（占位 / 过期 / 空）。
public struct WidgetMessageView: View {
    let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        VStack {
            Spacer(minLength: 0)
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
    }
}
