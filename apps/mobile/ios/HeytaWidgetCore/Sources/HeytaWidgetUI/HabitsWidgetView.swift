import SwiftUI

import HeytaWidgetCore

/**
 今日习惯组件。

 ## 🔴 行是**只读**的 —— 整行就是一个"打开应用"的链接

 这不是没做完，是契约里没有这个东西：意图队列只能表达"任务"
 （`{taskId, targetIsDone}`）。习惯伪装成任务会被应用侧 drain 判为
 `skippedMissing` 并**静默丢弃** —— 用户以为打卡成功，应用什么都没做。

 所以这里**没有** `Button(intent:)`；「整块打开应用」由**扩展**在配置闭包上挂
 `widgetURL` —— 那是 WidgetKit 的能力，不属于这个可复用视图（这里只编 SwiftUI）。
 要支持组件内打卡，必须先改意图队列契约（见账本 U9）。
 */
public struct HabitsWidgetView: View {
    let model: HabitsWidgetModel
    let strings: WidgetStrings

    public init(model: HabitsWidgetModel, strings: WidgetStrings) {
        self.model = model
        self.strings = strings
    }

    public var body: some View {
        Group {
            if let message = WidgetStatusMessage.forState(model.state, model.totalCount, strings, empty: strings.noHabits) {
                WidgetMessageView(message)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    WidgetHeaderView(
                        title: model.dayStr ?? "",
                        trailing: strings.counter(done: model.doneCount, total: model.totalCount)
                    )
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(model.rows, id: \.habitId) { row in
                            WidgetReadOnlyRowView(
                                title: row.title,
                                trailing: row.streak > 0 ? strings.streakDays(row.streak) : nil,
                                isDone: row.doneToday
                            )
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
