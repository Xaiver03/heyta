package com.heytamobile.widget

/**
 * 「今日习惯」组件的入口。
 *
 * 全部行为都在 [BaseWidgetProvider] 里（四款组件共用同一份点击路径 ——
 * 那段代码里有三个不报错的安全细节，见 [WidgetClicks] 的类注释）。
 * 这个类**故意是空的**：它的存在只为了给 `AppWidgetManager` 一个
 * 可定位的 `ComponentName`，以及挂上自己的 `appwidget-provider` 元数据。
 *
 * ⚠️ 它的名字与 `AndroidManifest.xml` 里的 `android:name`、
 * `res/xml/widget_habits_info.xml` 三者必须对得上；改一处要改三处。
 * 那三处对不上的表现是**组件在组件的选择器里直接消失**，
 * 或者被加到桌面后是一片空白 —— 而在编译期**没有任何提示**。
 */
class HabitsWidgetProvider : BaseWidgetProvider()
