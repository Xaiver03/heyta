import AppIntents
import SwiftUI

import HeytaWidgetCore

/** 今日任务组件。 */
public struct TodayWidgetView<Intent: AppIntent>: View {
    let model: TodayWidgetModel
    let strings: WidgetStrings
    /// 点击回写走这个 intent（由扩展提供具体的那个类型）。
    ///
    /// ⚠️ 用泛型而不是"类型擦除"：`Button(intent:)` 要的是**具体的** `AppIntent`，
    /// 类型擦除之后系统就无法把参数编码进点击事件里了。
    let toggleBuilder: (WidgetTaskRow) -> Intent

    public init(
        model: TodayWidgetModel,
        strings: WidgetStrings,
        toggleBuilder: @escaping (WidgetTaskRow) -> Intent
    ) {
        self.model = model
        self.strings = strings
        self.toggleBuilder = toggleBuilder
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let message = WidgetStatusMessage.forState(model.state, model.totalCount, strings, empty: strings.nothingToday) {
                WidgetMessageView(message)
            } else {
                WidgetHeaderView(
                    title: model.dayStr ?? "",
                    trailing: strings.counter(done: model.doneCount, total: model.totalCount)
                )
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(model.rows, id: \.taskId) { row in
                        WidgetTaskRowView(row: row, toggle: toggleBuilder(row))
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// 状态 → 文案。四款组件共用，与 Android 的 `WidgetViewParts.statusMessage` 对应。
///
/// ## 🔴 "今天没有任务" 与 "数据已过期" 必须分开
///
/// 这是本项目反复出现的那条纪律的一个具体面：
/// **一个看起来合理的错误状态比一个明显的错误状态危险得多。**
/// 组件在解密失败时显示"今天没有任务"，用户会真的以为今天没事 ——
/// 而真相是数据读不出来。
public enum WidgetStatusMessage {
    /// @param empty 该组件"确实没有内容"时要说的话（四款各不相同）。
    public static func forState(
        _ state: WidgetState,
        _ count: Int,
        _ strings: WidgetStrings,
        empty: String
    ) -> String? {
        switch state {
        case .placeholder:
            // 拿不到密钥 / 没有快照 / 解密失败 —— 让用户去打开应用。
            return strings.openAppToShow
        case .stale:
            return strings.dataExpired
        case .ready:
            return count == 0 ? empty : nil
        }
    }
}
