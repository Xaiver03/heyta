# Windows 原生系统小组件验收边界

本轮在 Windows 11 build 26200 上完成了 Provider 独立 Release 编译、MSIX 打包、签名、安装和应用启动验证。`provider-msix-facts.txt` 记录了包内 `WidgetProvider\\HeytaWidgetProvider.exe`、COM 注册、`uap3:AppExtension`、四个定义和安装结果。

小组件点击队列采用非破坏读取：`drainIntentQueue` 只读取当前快照，应用成功写入任务操作后再通过 `ackIntentQueue` 按 `taskId + targetIsDone + at` 精确确认。读取期间新到达的点击不会被覆盖，失败或崩溃会保留待下次处理。

该验收机没有安装 Microsoft Windows Web Experience / Widgets host（`Get-AppxPackage -AllUsers` 未找到 WebExperience 或 Widgets），因此无法在这台机器上打开 Widgets Board 执行“添加小组件”实机步骤。这里没有把包注册、PWA 卡片或应用内卡片冒充系统添加成功；需要有 Widgets host 的 Windows 11 机器完成最后一格系统添加与点击回写验收。
