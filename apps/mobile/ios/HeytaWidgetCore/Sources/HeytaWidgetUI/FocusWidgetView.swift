import SwiftUI

import HeytaWidgetCore

/**
 今日专注组件。

 ## 🔴 这里**故意没有倒计时** —— 这是 iOS 侧最重要的一个取舍

 契约里的 `WidgetFocus.remainingSeconds` 是**发布那一刻**的快照值，
 没有任何绝对时间锚点。照着画就是"看起来对、其实是错的"：

 ```
 09:00  应用发布快照，remainingSeconds = 1500
 09:10  用户看一眼组件 → 组件画的是 "剩余 25:00"
        真实剩余 15:00。用户照着 25:00 安排事情。
 10:00  一场 09:25 就结束的专注，组件还说 "专注中"
 ```

 注意它**看起来完全正常** —— 一个整整齐齐的倒计时，用户没有任何理由怀疑它。
 这正是本项目最反对的那类缺陷（用过期的数据装作现在）。

 所以这里只画**不会随时间变**的事实：会话标题 + 目标时长
 （"这一轮定的是 25 分钟"）。

 **宁可少显示一个数字，也不显示一个错的数字。**

 正确的修法：给契约加绝对字段 `endsAt`（`FocusState` 里本来就有），
 原生便能算 `remaining = endsAt - now` —— 那是它**已经有权做的事**
 （它本来就在判 `now >= validUntil`）。见账本 §4 的 U8。
 */
public struct FocusWidgetView: View {
    let model: FocusWidgetModel
    let strings: WidgetStrings

    public init(model: FocusWidgetModel, strings: WidgetStrings) {
        self.model = model
        self.strings = strings
    }

    public var body: some View {
        Group {
            switch model.state {
            case .placeholder:
                WidgetMessageView(strings.openAppToShow)
            case .stale:
                WidgetMessageView(strings.dataExpired)
            case .idle:
                WidgetMessageView(strings.notFocusing)
            case .active:
                active
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var active: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "timer")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.accentColor)
                // ⚠️ 空标题换成通用文案 —— 画一个空字符串会看起来像渲染坏了。
                //    "用户没填标题"与"用户填了'专注中'"在**模型层**必须可区分（那里保留 ""），
                //    但**视图层**要显示得像样。
                Text(model.sessionTitle.map { $0.isEmpty ? strings.focusInProgress : $0 } ?? strings.focusInProgress)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            if let seconds = model.targetSeconds {
                // 静态事实：这一轮定的是多久。**不是**剩余时间。
                Text(strings.targetMinutes((seconds + 30) / 60))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }
}
