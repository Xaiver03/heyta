# Windows 原生系统小组件 Provider

这是 Windows Widgets Board 的原生 Provider，不是 PWA 小组件的替代显示。

Provider 以打包 COM local server 的形式由 Widgets Board 按需启动，实现 Windows App SDK 的 `IWidgetProvider`：

- `today`、`quadrant`、`habits`、`focus` 四个定义共享同一份 Adaptive Card 数据契约。
- Provider 只读 `LocalState/heyta-widgets/snapshot.json`，通过 DPAPI 当前用户保护的设备密钥解开 AES-GCM-256 信封。
- 小组件点击只写 `{ v: 1, intents: [...] }` 意图队列；Provider 不打开 SQLite，也不构造 op。
- WebView 宿主通过 `WindowsWidgetBridge` 负责封装快照、领取/合并意图和清理状态。
- 应用当前语言经 `setWidgetLocale('zh-CN' | 'en')` 写到独立的 `locale.txt` 设备偏好。Provider 每次唤醒读取它，并在该文件变化时刷新已创建的卡片；没有有效偏好时才回落到系统中文或英文。清理加密快照不清除此非敏感偏好。
- 卡片文案来自 `packages/i18n` 的生成资源，禁止手改原生文案表。更改源词条后运行 `node scripts/gen-windows-widget-strings.mjs`；`--check` 检查逐字漂移，已纳入 `check:windows-shell`。定向语言验收：`dotnet run -c Release --project apps/desktop-windows/widget-smoke/WidgetSmoke.csproj`。

打包注册由 `apps/desktop-windows/scripts/package-msix.ps1` 完成，包含 `windows.comServer`、`windows.appExtension`、Provider 图标和四个系统小组件定义。系统添加验收必须在安装了 Windows Widgets host（Web Experience）的 Windows 11 设备上，通过 Widgets Board 的“添加小组件”完成；缺少该系统组件时只能验收包内注册与 Provider 构建，不能将 PWA 或应用内卡片算作系统小组件支持。
