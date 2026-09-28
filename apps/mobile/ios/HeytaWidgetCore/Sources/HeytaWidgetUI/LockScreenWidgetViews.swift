import SwiftUI

import HeytaWidgetCore

/**
 W5-2 · **锁屏组件**的三个家族。
 =================================

 ## 🔴 为什么锁屏组件要**单独**一套视图，而不是把主屏视图改小

 主屏的今日任务视图是"一张卡片"：有标题栏、有内边距、有圆角、
 有可以点的复选框。锁屏上这些东西**一个都不成立**：

 | 主屏有 | 锁屏上 |
 |---|---|
 | 不透明的卡片背景 | **没有背景** —— 系统把它画在壁纸上，我们加背景就是一块补丁 |
 | 可点的复选框（`Button(intent:)`） | `.accessoryRectangular` 上**整块只能有一个 `widgetURL`**，没有逐行按钮 |
 | 12–14pt 正文 | 只能用系统给的两个动态字号档位 |
 | 圆角与内边距 | 由系统裁剪，我们控制不了 |

 所以这不是"同一个视图换个尺寸"，而是**两个不同的界面**。
 把它们合并的唯一后果是两边都不对 —— 而"不对"在锁屏上的表现是
 **字被裁掉**，用户只会以为这个组件坏了。

 ## 🔴 `.privacySensitive()` 是这一层的核心，不是装饰

 锁屏组件**在不解锁的情况下就能被看到**。挂上 `.privacySensitive()` 之后，
 系统会按用户在 iOS 设置里选的「显示预览」策略自动打码 ——
 这是平台**已经做好**的那一层，我们不重复实现它。

 而我们自己的"始终隐藏"开关（`WidgetPrivacyPreference`）是**第三层**，
 挡的是"手机已解锁但用户正把屏幕给别人看"。

 ## ⚠️ `.accessoryInline` **永远**不放标题

 它在锁屏**最上方、跟时间并排**，是最容易被旁人扫到的位置。
 所以它只放计数。这是**产品决定**，理由写在 `WidgetLockScreenModel` 的文件头 ——
 用户能接受"3 个任务"，不能接受"离婚协议书"被同事扫到。
 */

// ─────────────────────────────────────────────────────────────
// 圆形（计数）
// ─────────────────────────────────────────────────────────────

/**
 `.accessoryCircular` —— 一个圆。
 
 只放**未完成条数**。放不下标题，也不该放。
 */
public struct LockScreenCircularView: View {
    let model: WidgetLockScreenModel
    let strings: WidgetStrings

    public init(model: WidgetLockScreenModel, strings: WidgetStrings) {
        self.model = model
        self.strings = strings
    }

    public var body: some View {
        Group {
            switch model.state {
            case .placeholder, .stale:
                // 一个问号而不是 0 —— 0 会被读成"今天没事"。
                Text("–").font(.system(size: 22, weight: .semibold))
            case .ready:
                if model.isAllDone {
                    // 真的做完了：一个勾。
                    Image(systemName: "checkmark")
                        .font(.system(size: 20, weight: .semibold))
                } else {
                    VStack(spacing: -2) {
                        Text("\(model.openCount)")
                            .font(.system(size: 24, weight: .semibold))
                            .monospacedDigit()
                    }
                }
            }
        }
        // ⚠️ 这里**不加** `.widgetAccentable()`：它属于 WidgetKit，而
        //    `HeytaWidgetUI` 这个 target **刻意不依赖 WidgetKit**（见 Package.swift）——
        //    因为 watchOS 的 target 要复用这些视图，而在 UI 层引入 WidgetKit
        //    会把"哪些视图是平台无关的"这条界线糊掉。
        //
        // 计数本身不泄露内容，所以**不加** `.privacySensitive()` ——
        // 加了会让用户在锁屏上连"还有几件"都看不到，而那条信息本来就不敏感。
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        switch model.state {
        case .placeholder: return strings.openAppToShow
        case .stale: return strings.dataExpired
        case .ready:
            return model.isAllDone ? strings.nothingToday : strings.openTaskCount(model.openCount)
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 矩形（第一件未完成任务）
// ─────────────────────────────────────────────────────────────

/**
 `.accessoryRectangular` —— 两行宽条。锁屏上信息量最大的那一款。
 */
public struct LockScreenRectangularView: View {
    let model: WidgetLockScreenModel
    let strings: WidgetStrings
    /// 用户有没有要求"始终隐藏标题"（第 3 层）。
    let privacy: WidgetPrivacyPreference

    public init(
        model: WidgetLockScreenModel,
        strings: WidgetStrings,
        privacy: WidgetPrivacyPreference = .default
    ) {
        self.model = model
        self.strings = strings
        self.privacy = privacy
    }

    public var body: some View {
        Group {
            switch model.state {
            case .placeholder:
                message(strings.openAppToShow)
            case .stale:
                message(strings.dataExpired)
            case .ready:
                readyBody
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func message(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(strings.widgetTitle).font(.headline)
            Text(text).font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var readyBody: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(strings.widgetTitle).font(.headline)
                Spacer(minLength: 0)
                Text(strings.counter(done: model.doneCount, total: model.totalCount))
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }

            if model.isAllDone {
                Text(strings.nothingToday)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if let title = model.firstTitle {
                // 🔴 第 2 层：系统按用户的「显示预览」策略决定要不要打码。
                Text(title)
                    .font(.caption)
                    .lineLimit(1)
                    .privacySensitive()
            } else {
                // 🔴 第 3 层：用户要求始终隐藏。**不是** `firstTitle == nil` 的另一种含义。
                //
                //    这里用的是 `hiddenTitlePlaceholder` 而不是硬编码 "•••"：
                //    它与"没有未完成任务"（上面那条 `nothingToday`）必须分开 ——
                //    两者都会让 `firstTitle` 为 `nil`，但用户该看到的是**不同的话**。
                //    混起来的话，"藏起来了"会显示成"全部完成"—— 一个看起来是好消息的错。
                Text(WidgetLockScreenModelBuilder.hiddenTitlePlaceholder(privacy: privacy) ?? "")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .privacySensitive()
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 行内（只有计数）
// ─────────────────────────────────────────────────────────────

/**
 `.accessoryInline` —— 锁屏顶部、跟时间并排的那一行。
 
 🔴 **永远不放标题**，见文件头。它只回答"还有几件事"。
 
 ⚠️ 这个家族**只接受 `Text` / `Image`**（系统限制），
 所以这里不能套 `HStack`、不能加 `Spacer`、不能换行。
 */
public struct LockScreenInlineView: View {
    let model: WidgetLockScreenModel
    let strings: WidgetStrings

    public init(model: WidgetLockScreenModel, strings: WidgetStrings) {
        self.model = model
        self.strings = strings
    }

    public var body: some View {
        switch model.state {
        case .placeholder, .stale:
            // ⚠️ 行内位很窄，`openAppToShow`（"打开 Heyta 以显示内容"）会被截成
            //    "打开 Heyta 以显…"。所以这里用一个短版本文案。
            Text(strings.inlineNoData)
        case .ready:
            if model.isAllDone {
                Text(strings.inlineAllDone)
            } else {
                Text(strings.inlineOpenCount(model.openCount))
            }
        }
    }
}
