# Android 安装态小组件复验（2026-10-09）

本轮使用当前源码通过 `windows-pc` 远程构建的 Release APK，安装到 `emulator-5554` 后复验。APK 本地与设备内 SHA-256 均为 `1a01024e1d90aaae0e6bf446af7a329e9ac542427435f2e8e1497ba7c28d86c3`。

| 检查 | 结果 | 证据 |
|---|---|---|
| 当前 Release APK 安装并启动 | 通过 | `apk-sha256.txt`、`launcher-*.png` |
| 四个原生 Provider 注册 | 通过 | `appwidget-dumpsys.txt`：Today / Quadrant / Habits / Focus 均出现 |
| 四个既有 Launcher 实例仍存在 | 通过 | `appwidget-dumpsys.txt`：id=2/3/4/5，host 为 Nexus Launcher |
| 系统亮色主题下组件可渲染 | 通过 | `launcher-light.png` |
| 系统暗色主题下组件可渲染 | 通过 | `launcher-dark.png` |
| 应用启动后过期快照刷新到当前日期 | 通过 | 暗色截图从过期提示刷新为当前日期与空焦点状态 |
| 无边框/浅阴影视觉方向 | 通过目测 | 圆角无描边卡片，背景与正文层级来自主题色 |
| 读屏真人语音、四模板逐个点击、从系统 Gallery 新增、Focus 开始/暂停/恢复即时刷新 | 未验 | 不把 Provider 注册或渲染截图当作完整系统交互验收 |

本轮没有清除应用数据，也没有删除正常任务或习惯；仅通过系统主题命令切换亮暗并启动应用触发快照刷新。系统小组件的完整交互矩阵、macOS/Windows Gallery/Board 和实体 iPhone 仍按计划保持独立未完成边界。
