import SwiftUI
import WidgetKit
import HeytaWidgetKit

/// Native macOS widgets; the four definitions and all rendering come from the shared package.
@main
struct HeytaMacWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        QuadrantWidget()
        HabitsWidget()
        FocusWidget()
    }
}
