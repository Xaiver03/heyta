# Android 系统四模板复验（2026-10-08）

本轮在既有 `emulator-5554` 的 Launcher 中实看四个系统实例：Focus=2、Habits=3、Today=4、Quadrant=5。重新拉取安装中的 APK 验证 SHA-256 为 `381203459ba9da1c85d4d5215fba8a32ce1b63992d87ef915a3e53de82c34ba3`。未编译、未卸载、未清数据，也未重新添加实例。

| 检查 | 结果 | 证据 |
|---|---|---|
| 今日任务、习惯、四象限：深浅主题非空内容 | 通过实际显示检查 | today-habits-light/dark.png、quadrant-light/dark.png |
| 专注：深浅主题非空内容 | 仅渲染通过；依赖无关任务 op 触发发布 | focus-light/dark-after-task-op.png |
| 启动专注后立即更新系统卡片 | 失败：App 24:50 专注中，卡片仍称没有进行中的专注 | focus-app-running.png、focus-start-not-published.png |
| 系统主题切换能否补发专注数据 | 不能。只重绘旧快照；实际任务 op 才变为 Focusing / Target 25 min | 前后截图和相关 AX XML |
| 放弃本轮专注 | 通过：App 回到 25:00 未开始；经专注记录 op 后系统卡片也回空态 | focus-app-abandoned.png、focus-dark-idle.png |
| 空态整卡打开 App | 未通过：点击空态正文无响应，日期头部能打开 App | 本轮真实点击观察；body 隐藏，待源码修复 |
| App 与系统卡片语言一致 | 未通过：App 主体中文、系统卡片英文。设备全局 en_US，app locales=[]；中文默认资源和 values-en 均存在 | locale.txt、焦点页与系统截图 |

旧 QA 专注在接手时已经自然完成，App 显示 1 次 / 25 分钟，并出现 QA 任务关联。未删除该真实记录。本轮另启动一轮 QA 专注，以 QA_Widget_Matrix_20261008 任务完成→撤销完成触发一次真实快照发布，保存非空明暗图，再通过 App 正常放弃。结束时任务恢复未完成，QA 习惯仍未打卡；系统 night 已恢复 yes，专注不在运行，普通数据未删除。

本轮发现的专注本地任务刷新、启动状态发布和语言接线问题需要新源码修复后重新打包实测，不能用这组渲染截图判为完成。暂停/恢复、尺寸缩放、换号清理、读屏、首次从系统添加等矩阵未在此证据中声称通过。界面内容仍有较多空白，四象限当前也是纵向栏目；本轮证明显示和主题，不能据此宣称最终品味设计全部合格。
