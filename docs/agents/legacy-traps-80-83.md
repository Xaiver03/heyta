<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「遗留条目 #80–#83」的完整规则（原文 §9 尾部遗留条目）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

82. 🔴 **“非空白”挡不住错误屏 —— 安装包四轮截图统计全绿，装出来的却是一个报错页。**
    **判 UI 必须有 UI 特征；“人眼复核”四个字印在输出里，不等于人看过。**

    macOS 安装包（`package-app.sh`）**从来没把 `apps/web/dist` 打进 .app** ——
    壳在 bundle 里找不到共享 UI，永远渲染“找不到共享 UI 产物”错误屏。
    而打包自验与重装流程的截图判据都是 `looksBlank`：错误屏**有标题有正文**
    （contentRatio 99.6%），统计上永远“有内容” ⇒ 四轮全绿。
    最后是产品负责人**人眼看窗口**才发现 —— 而脚本输出里明明印着“人眼复核”。

    修了两层，缺一不可：

    1. **产品**：`web-dist` 打进 `Contents/Resources/web-dist`（在签名**之前**拷，
       让 `--deep` 封进签名）。⚠️ 放 bundle 根（`Heyta.app/web-dist`）会被
       `codesign` 拒：“unsealed contents present in the bundle root”（实测）；
       壳的解析也在 `Bundle.main.resourceURL`，两处必须同一个路径。
    2. **判据**：`png-stats` 新增 `countColor` + `HEYTA_BLUE`（`#2563EB`）——
       heyta 的界面必带主蓝（rail 激活项/主按钮/链接），错误屏、空白屏、桌面
       底色**都没有**。A/B 实测：错误屏命中 **0**，真界面几十个。
       ⚠️ 采样密度要 **10 倍于 inspectPng**（20 万点）：主蓝元素小
       （复选框/图标），2 万跳采对真 UI 只命中 4 个，会把真界面误杀。

    📌 两条一般规律：**“非空白”回答的是“有没有东西”，回答不了“是不是这个界面”** ——
    判界面必须有界面特征（品牌色/结构标记）。**测试输出里印着“人眼复核”不构成复核** ——
    §6.2 规定一要求的是真的打开那张图。

80. 🔴 **RN-web 的 `TextInput` 在 keydown 里无条件 `stopPropagation()` —— 冒泡阶段的
    全局快捷键（Esc 关浮层）在焦点落进输入框时**永远收不到事件**。**

    搜索浮层（页6，`apps/web`）的 Esc 关闭挂在 `window` 的**冒泡**监听上；jsdom 单测全绿，
    真浏览器里按 Esc 却毫无反应。实证（往 window/document 各挂一个 keydown 探针）：
    **keyup 能到 window，keydown 到不了** —— 拦截者在 React 委托根上：
    react-native-web `TextInput` 的 `handleKeyDown` 第一行就是
    `e.stopPropagation()`（上游 #612 "Prevent key events bubbling"），
    而面板的输入框是 `autoFocus` —— 焦点恰好总在里面。

    ⚠️ **单元测试抓不到这个**：jsdom 里 `window.dispatchEvent(keydown)` 直接在 window 上起事件，
    根本不走"输入框 → 冒泡 → window"那条被吞的 DOM 路。测试绿 ≠ 真键盘能用 ——
    这是 §6.2 规定一（必须真跑真浏览器）的又一根实锤。

    ✅ 修法：全局键盘监听挂**捕获阶段**（`addEventListener('keydown', fn, true)`）——
    捕获在下传时先于目标处理器触发，RN-web 拦的是冒泡，拦不到捕获。
    代价要想清楚：捕获意味着"将来浮层里若有别的 Escape 消费者（嵌套下拉）"，
    外层会先关 —— 所以它只适合"浮层里没有其它 Esc 面"的场景（搜索面板就是）。

    同族：`ui/text-input` 相关的**组合输入**（IME）事件同样可能被上游吞；
    任何"焦点常驻输入框的浮层 + 全局键盘监听"组合，先探针验证事件真到了 window。

83. 🔴 **探针会改变被测对象的状态；原生控件的默认外观跟着系统设置走。**
    两件事都让安装包验收"看起来红了、其实不是缺陷"（或反过来），都在 2026-09-30 实测：

    1. **M2 探针把应用留在设置页**。壳的验收探针是三段式：首屏 → 点头像验身份菜单 →
       点「设置」验导入面板 —— 验完**就地停在设置视图**。而安装包自截屏在启动 +3s 才跑，
       于是"第一屏"证据永远是设置 sheet，四轮截图全是对着设置页打分。
       ✅ 修法：验完**点回「任务」**（`backToTasksProbe`），把首屏还给截图；
       状态还原是验收流程的一部分，不是可选项。
       📌 一般规律：**探针是被测系统的一段真实用户操作，它留下的状态就是后续判据的输入**。
    2. **原生复选框的选中色 = macOS 系统强调色**。模块开关是裸 `<input type=checkbox>`，
       没写 `accent-color`。Chrome 恰好渲染成蓝色（看起来"正好是品牌色"，纯属巧合），
       WebKit 跟随系统设置 —— 这台机器的强调色是石墨灰 ⇒ 装出来的包里**所有勾选框
       都是灰的**，主蓝命中 0。✅ 修法：`input[type="checkbox"], input[type="radio"]
       { accent-color: var(--ht-color-primary); }`。
       📌 一般规律：**凡是没显式声明样式的东西，都在替用户的系统设置说话**；
       品牌控件不能依赖"默认值恰好像我们的品牌色"。

81. 🔴 **窗口取证工具链的三个静默坑（`window-id.swift` / `screencapture -l`）——
    每一个的症状都是"交叉验证被跳过"或"尺寸比对必红"，没有一个是它自己。**

    `check:macos-window` 的交叉验证链：`swift window-id.swift` 拿窗口号 →
    `screencapture -l<id>` 独立截一份 → 与应用自截图比尺寸。三个坑都在第一环：

    1. **`.optionOnScreenOnly` 看不见后台实例**。交叉验证的壳带 `HEYTA_NO_FOCUS=1`
       后台启动，它的窗口不在"当前屏幕可见"集合里 ⇒ 脚本输出空 ⇒
       `CROSSCHECK=skipped` ⇒ 门禁红。修成 `.optionAll`（AGENTS §7 第 37 条
       同一个坑的第四种面目：AX / OnScreenOnly 都只看得见"当前 Space / 当前屏"）。
    2. **`.optionAll` 之后 `head -1` 会拿到辅助窗口**。进程里除了主窗口还有
       500x500、**无标题**的辅助窗口（SwiftUI 常驻）；对它跑 `screencapture -l`
       得到 **1000x1000 的占位图** —— 尺寸比对必红，而占位图"看起来是张图"。
       修成只认**标题 = "heyta"** 的主窗口（`kCGWindowName`）。
    3. **僵尸实例会污染窗口清单**。连跑几轮门禁后 pkill 没杀干净的旧实例
       会留下同名同尺寸的窗口 —— 选窗时"任何一个 heyta 主窗口"都可接受
       （尺寸比对只关心尺寸），但**排查时先 `ps` 确认没有僵尸**，否则你以为
       在验新实例，实际比的是旧的。

    📌 **判据**：交叉验证链上任何一环"取不到"都必须**响亮地失败**
    （`CROSSCHECK=skipped` 就该红），绝不能静默跳过 —— 静默跳过等于
    "自截图永远不用被独立验证"，那这条交叉验证就只是装饰。

82. 🔴 **"重新装了一遍"不等于"装上了当前源码" —— 多端流程的每一端都要有一条
    `远端字节 == 本地工作树` 的判据。**

    2026-09-30 实测：`pnpm reinstall:all` 的 Windows 段报 ✅，而它装的是

    | 事实 | 证据 |
    |---|---|
    | `C:\src\heyta` 是 **Sep 28** 的旧树 | `MainWindow.xaml.cs` 2384 B（本地 3086 B）、`apps/web/dist/index.html` 是 Sep 27 |
    | 包里**没有** `web-dist`（共享 UI） | `package-msix.ps1` 里 `web-dist` 0 处；而壳只从 exe 旁边找它 |
    | 于是跑的是 `shell` 模式的通道试验页 | `dist/windows/packaged-first-run.png` 里是三行「M2-B 真数据 1/2/3」 |

    而判据只有 `ADD_APPX=OK` + `RESULT=OK`（装上、开窗、截图非空白）—— **全绿**。
    这与第 27 条（APK 里是旧 JS bundle）、`verify-mobile-ios.sh`（脚本只验不装）
    是**同一个错的第三种面目**：流程里缺了"同步"这一步，而缺了它的表现
    与"一切正常"**完全一样**。

    ✅ 修法：`reinstall-all.sh` 新增 `sync_windows_sources()` ——
    `git ls-files` + 未跟踪非忽略 + 显式 `apps/web/dist` 打 tar（实测 11 MB）
    → scp → **覆盖式**解包（不删远端 node_modules）→ **新鲜度对账**
    （`web-dist/index.html` 的 sha256 本地/远端必须逐字相同，不一致**拒绝打包**）；
    打包脚本新增 `web-dist` 断言（缺了直接 `RESULT=WEB_DIST_MISSING` 退出）；
    应用默认模式改成"有 web-dist 就是 `app`"。

    📌 **可迁移的判据**：任何"送到另一台机器上构建/运行"的流程，
    收尾必须有一次**内容对账**（哈希/尺寸），而不是只看"命令退出码 0"。

83. 🔴 **给 MSIX 打包的两个附加约束**（第 82 条同一轮）：`package-msix.ps1` /
    `install-and-capture.ps1` **必须保持纯 ASCII**（脚本自己会 grep 非 ASCII 并退 1
    —— 2026-09-30 我加注释时写了中文，正是它拦下来的；PS 5.1 会把无 BOM UTF-8
    当 ANSI 读，中文注释能拆坏字符串常量）。而**应用写出的证据文件可以是 UTF-8 中文**，
    门禁只读里面那一行 ASCII 判据（`M2D=OK` / `M2D=FAIL`）—— 人的说明与机器的判据
    分两个通道，不要把中文塞进 ASCII 证据文件（`Set-Content -Encoding ASCII` 会毁掉它）。
