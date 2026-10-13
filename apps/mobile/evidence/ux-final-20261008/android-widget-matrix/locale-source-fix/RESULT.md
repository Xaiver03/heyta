# UX-S9-143：应用语言与系统小组件一致（源码阶段）

移动语言偏好 Provider 在初始化和切换时调用 `setWidgetLocale`。桥使用独立的非敏感设备偏好，冷启动常量优先恢复已选语言；未设偏好时读取原生设备语言，补足现代 RN 缺失的 localeIdentifier。语言不进入任务 op 或加密快照，不随账号登出清除。

Android 使用独立 `heyta_widget_preferences` SharedPreferences；四个渲染器通过同一 localizedContext 读取现有生成的中英 strings 资源。写偏好后重绘全部实例，不修改系统或 Activity 配置。

Apple 共享 Core 提供 `WidgetLocalePreference.write(locale)` / `.current()`，写 App Group 的独立 `widget-locale.json`。共享 `WidgetLanguage.current()` 优先应用选择，继续消费既有 WidgetStrings；没有新增/复制中英文案。iOS RN 薄桥已接写入及 reloadAllTimelines；macOS 宿主接线由主 Agent 实施，需要调用同一个 Core 写入口及刷新。

已验证：移动语言/桥接两文件 22 项通过、mobile typecheck 通过；Swift 实际独立文件读写/坏值保留/跨相反系统语言选择共 3 项通过，并编过 WidgetUI/WidgetKit。Android Kotlin 测试已新增，但未在 Mac 起 Gradle。iOS RN 薄桥、Android 原生编译与安装后的中英文切换仍需最终构建复验。现安装 APK 仍为修复前产物；不能将源码验证视为设备行为已修复。
