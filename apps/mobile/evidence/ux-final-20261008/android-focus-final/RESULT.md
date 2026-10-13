# Android 专注与小组件安装态验收（2026-10-08）

本轮只使用已有 `emulator-5554`，没有启动模拟器、没有在 Mac 上运行 Gradle、没有卸载或清空应用数据。安装中的 APK 已核验为目标候选：`26d39bc0ca06d13e6000a363649cdf56f42d52d9a4fc0e6f2c3e4d0dbb36d115`。保留了原有四个系统小组件实例（Focus=2、Habits=3、Today=4、Quadrant=5）。

## 结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| 空闲专注页与关联任务选择器 | 通过。专注页显示 25:00；任务行 `QA_Widget_Matrix_20261008` 可直接开始，随后专注页显示 `Linked task`。 | `02-focus-idle.xml`、`22-row-start-running.png`、`23-row-paused.xml` |
| 任务行开始后产生真实专注记录 | 通过。没有用无关任务 op 代替；设备 SQLite 中最新记录的 `taskId` 是 `task-muz6597n-1-l09iibt4`，`completed=false`，随后正常结束。 | `/tmp/heyta-focus-final-state/heyta-final2.sqlite`（本地取证副本）、`23-row-paused.xml` |
| 开始后 Widget 立即反映进行中的专注 | 通过。回到 Launcher 后，Focus 卡片显示 `QA_Widget_Matrix_20261008` 与 `Target 25 min`。 | `25-row-start-home.xml`、`25-row-start-home.png` |
| 暂停后应用状态 | 通过。应用显示 `Paused` 与 `Resume`，且倒计时冻结。 | `23-row-paused.xml` |
| 暂停后 Widget | 有限通过。Widget 快照已刷新，但视觉上仍只显示标题和目标时长，与运行中完全相同；用户无法从 Widget 判断“暂停”。 | `26-row-pause-home.xml`、`26-row-pause-home.png` |
| 恢复后应用状态 | 通过。恢复入口可用，恢复后重新进入运行态。 | `11-focus-resumed.png` |
| 恢复后 Widget | 有限通过。Widget 保持标题和目标时长，视觉上与暂停/运行态相同；不能把“已恢复”作为可见状态确认。 | `27-row-resume-home.xml`、`27-row-resume-home.png` |
| 结束/放弃后 Widget 清空 | 通过。应用回到 `Ready when you are`，Launcher 卡片显示 `No focus session running`。 | `14-focus-ended.xml`、`28-row-end-home.xml`、`28-row-end-home.png` |
| 空态 Widget 点击正文回到 App | 未通过。点击空态卡片正文后仍停在 Launcher。 | `20-widget-empty-tap-return.xml`、`20-widget-empty-tap-return.png` |
| 空态 Widget 点击日期头部回到 App | 通过。点击日期头部可回到 `com.heyta/com.heytamobile.MainActivity`。 | `21-widget-header-tap-return.png` |
| 中文/英文与冷启动 | 未通过本候选的实际界面验证。设备应用语言偏好可设置为 `zh-CN`，但冷启动后的 App 和 Widget 仍显示英文（`Tasks`、`Focus`、`No focus session running`）；已恢复应用语言偏好为空列表。 | `17-locale-zh-app.xml`、`18-locale-zh-widget.xml`、`cmd locale get-app-locales` 输出 |

## 重要缺口

1. Widget 模型只把专注分成 `ACTIVE` / `IDLE`，没有可视化暂停态。`FocusWidgetModel.kt` 和 `FocusWidgetViews.kt` 明确只显示会话标题与目标时长，不显示倒计时或“暂停/运行中”状态。因此开始、暂停、恢复虽会触发底层快照发布，但暂停与恢复不能在桌面上被用户识别。若 UX 要求“暂停/恢复即时可见”，应先扩展共享 Widget 契约（例如带绝对 `endsAt` 与 `paused`），再同步更新四端实现与黄金夹具。
2. 空态 Focus 卡片仅给日期头部绑定打开 App 的 PendingIntent，正文区域点击无响应。用户点击“没有进行中的专注”时没有反馈；应把正文空态区域也绑定同一打开 App 动作。
3. 将 Android per-app locale 设置为 `zh-CN` 后，实际 UI 仍是英文，说明安装包的移动端语言切换/词条接线没有形成可见效果。测试结束已将系统应用语言偏好恢复为空列表，没有清理用户数据。

本轮新增的专注记录是有界 QA 记录，未删除既有正常 op；最后一轮已结束，当前没有运行中的专注。
