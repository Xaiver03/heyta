# 产品 UI/UX 验收证据（2026-10-06）

这些截图由当前工作树启动的 `apps/web` Vite 开发服务器生成，视口和截图均对应本轮代码；不复用旧的顶栏基线。

| 文件 | 视口 | 验收点 |
|---|---:|---|
| `desktop-tasks.png` | 1440×900 | 新建任务是首屏主动作，AI 工具调用默认收起，范围筛选留在 sidebar。 |
| `desktop-more-menu.png` | 1440×900 | 主 rail 保留任务/日历/习惯/搜索，四象限与时间线通过「更多」可达。 |
| `narrow-tasks.png` | 390×844 | 底栏只承载一级目的地；中文标签单行，范围区移到导航上方并可横向滚动。 |
| `narrow-more-menu.png` | 390×844 | 窄屏低频入口仍可发现，不依赖逐字竖排。 |
| `settings-desktop-light.png` | 1440×900 | 桌面设置按七个问题域分组，左侧目录固定，关闭出口在首屏标题区。 |
| `settings-desktop-dark.png` | 1440×900 | 暗色设置保持不透明内容面、语义层级和焦点可见。 |
| `settings-mobile-light.png` | 390×844 | 窄屏设置目录变为顶部横向滚动栏，内容区不与底层任务文字混排。 |
| `bulk-selection.png` / `bulk-selected-one.png` | 1440×900 | 批量选择态只保留一个选择 checkbox，单条动作收起。 |
| `bulk-undo.png` | 1440×900 | 批量删除提供 5 秒撤销入口。 |

验收方式：`?lang=zh-CN`、首启选择「只用本机」、Playwright 截取当前 DOM；窄屏使用视口截图而非 fullPage，避免把底栏的内部横向滚动宽度误读成页面溢出。

截图流水线的导航烟测还复跑了 `W02`（四象限）、`W04`（番茄钟，先从设置开启模块）、`W05`（时间线）、`W06`（成长，先从设置开启模块）和 `MW02`（窄屏四象限）。低频视图均通过真实“更多”菜单进入；设置目标通过头像菜单进入。

另外，`W04` 与 `W06` 的 App Store 三种设备预设（iPhone、iPad、桌面）均已通过尺寸、非空和就绪文案检查。

## 设置页专项验收

设置页的重排参考了 Todoist 的“按用户问题分组”方式（账号、一般、主题、通知等稳定类别），以及 Apple Human Interface Guidelines 对分层设置、可预测返回和清晰焦点顺序的要求。heyta 当前落地为七组：个人资料、任务与显示、同步与隐私、AI 与集成、数据管理、账号与安全、关于与帮助。

验收关注三个产品结果：

1. 桌面端目录与内容区分离，用户可以直接跳到问题域，不必阅读一条无尽的设置长流；
2. 窄屏端目录横向滚动且保持单行，返回和关闭出口不依赖滚动到页面末尾；
3. 设置打开时底层任务 DOM 仍保留以便关闭后恢复上下文，但设置内容使用不透明背景，底层文字不会透过来制造竞争层级。

这些截图证明当前工作树的结构与视觉层级；设置内每个能力的真实可用性由对应面板测试负责，四端安装与启动结果见下方收口记录。

## 四端产物收口

当前源码已完成分端重装验收：

- macOS、Windows：`pnpm reinstall:all --only mac,windows`，两端均完成清旧、重打、安装、当前 web-dist 对账和启动截图；
- Android：`pnpm reinstall:all --only android`，`emulator-5554` 全新安装，窗口确认是 `com.heyta/com.heytamobile.MainActivity`，截图 1080×2400，主蓝命中 4001；APK 与远端 Windows 构建产物逐字对账，67,115,944 B，sha256 前缀 `1cdc259efa49d223`；
- iOS：`IOS_DEVICE_NAME=heyta-iphone-17pro pnpm reinstall:all --only ios`，Release 重打、全新安装、新鲜度和启动截图均通过，截图 1206×2622，主蓝命中 4152。

收口脚本同时补上了 `pnpm -r build` 后的 Web 产物刷新，避免原生壳因 workspace 依赖先于 web-dist 完成而误判输入过期。
