import Foundation

/// 四款组件的 `kind` 常量。**只有这一处声明。**
///
/// ⚠️ 它**原本在 `HeytaWidgetKit`**（iOS 的 intent 文件里），搬出来的理由和
///    `WidgetSharedStore` 一样：kind 字符串是**四端共用**的契约 ——
///    watchOS 的手表扩展也要用同一批字符串注册组件。
///    留在 iOS 专用 target 里，手表端就注册不了（编译期直接找不到这个类型）。
///
/// ⚠️ 与 Android 侧 `WidgetRefresh.specs()` 是同一个角色：
/// "有哪几款组件"必须只有一个声明处，否则 `reloadTimelines(ofKind:)`
/// 会写上一个不存在的 kind —— 而那样**不报错**，只是组件永远不刷新。
public enum WidgetKind {
    public static let today = "HeytaTodayWidget"
    public static let quadrant = "HeytaQuadrantWidget"
    public static let habits = "HeytaHabitsWidget"
    public static let focus = "HeytaFocusWidget"

    public static let all = [today, quadrant, habits, focus]
}
