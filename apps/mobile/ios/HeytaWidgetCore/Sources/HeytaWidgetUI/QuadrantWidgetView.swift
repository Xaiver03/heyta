import AppIntents
import SwiftUI

import HeytaWidgetCore

/** 四象限组件。 */
public struct QuadrantWidgetView<Intent: AppIntent>: View {
    let model: QuadrantWidgetModel
    let strings: WidgetStrings
    let toggleBuilder: (WidgetTaskRow) -> Intent

    public init(
        model: QuadrantWidgetModel,
        strings: WidgetStrings,
        toggleBuilder: @escaping (WidgetTaskRow) -> Intent
    ) {
        self.model = model
        self.strings = strings
        self.toggleBuilder = toggleBuilder
    }

    public var body: some View {
        Group {
            if let message = WidgetStatusMessage.forState(model.state, model.totalCount, strings, empty: strings.nothingToday) {
                WidgetMessageView(message)
            } else {
                // 2×2。`Grid` 需要 iOS 16+，而扩展的部署目标是 17，安全。
                Grid(horizontalSpacing: 6, verticalSpacing: 4) {
                    GridRow {
                        cell(model.groups[0])
                        cell(model.groups[1])
                    }
                    GridRow {
                        cell(model.groups[2])
                        cell(model.groups[3])
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private func cell(_ group: QuadrantWidgetGroup) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            // ⚠️ 即使这一格是空的，头部**也要画** —— 否则 2×2 的格局会塌，
            //    用户看不出"这一格是空的"还是"我少配了一格"。
            WidgetHeaderView(
                title: strings.quadrant(group.slot),
                trailing: group.total == 0 ? nil : strings.counter(done: group.done, total: group.total)
            )
            ForEach(group.rows, id: \.taskId) { row in
                WidgetTaskRowView(row: row, toggle: toggleBuilder(row))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private extension QuadrantWidgetModel {
    /// 状态文案用的总数（四格之和）。
    var totalCount: Int { groups.reduce(0) { $0 + $1.total } }
}
