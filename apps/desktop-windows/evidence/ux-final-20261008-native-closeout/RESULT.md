# Windows 原生协议与认证法律阅读：隔离安装态收口验收

验收日期：2026-10-08（Windows 真机 `windows-pc`）。本轮只运行独立 QA 副本，没有重建、重新安装、注册账号或清理默认用户数据。安装身份、WebView2 页面身份和 QA 路径均单独核对；本轮不宣称重新打包。

## 身份与隔离

- 已安装包：`cloud.finlaw.heyta.desktop`，版本 `1.0.0.1`。
- 已安装包路径、QA 副本路径和 SHA-256 对账见 [`install-identity.json`](./install-identity.json)。安装包 exe 与隔离副本 exe 完全相同：`1C6746C6DE74C3386B2AA535043252C79975C6D8DA1E7A1E2F089679A0E8ED3C`。
- 隔离根目录：`C:\Users\41478\heyta-qa-20261008-native-closeout`。
- SQLite 数据目录和 WebView2 profile 均落在该隔离根目录；本轮结束后只停止了该根目录对应的 PID，其他 QA 进程仍在，计划任务已删除。收口读数见 [`finalize-remote.json`](./finalize-remote.json)。

## 已通过

### 认证与协议阅读

[`windows-auth-legal.json`](./windows-auth-legal.json) 记录了真实 WebView2 点击结果：

- 注册页使用非真实草稿邮箱和长句密码；点击《服务条款》和《隐私政策》均打开应用内阅读弹层。
- 两个弹层均可关闭，返回后邮箱、密码、确认密码值逐字保留。
- 390×844 窄视口下 `documentElement.scrollWidth` 与 `body.scrollWidth` 都等于 `innerWidth`，无横向溢出。
- 两个弹层均无控制台错误。

### 亮暗主题与响应式

[`windows-theme-responsive.json`](./windows-theme-responsive.json) 记录了设置页亮色、暗色和 390px 窄视口：三种状态均无横向溢出。

共享 UI 与移动端类型检查均为 rc=0，原始命令输出分别保存在 [`ui-typecheck.log`](./ui-typecheck.log) 和 [`mobile-typecheck.log`](./mobile-typecheck.log)。

法律阅读器源码结构验收在本受控树于 19:19 复跑为 `1 test file / 12 tests passed`，原始输出见 [`legal-reader-current.log`](./legal-reader-current.log)。

### AI 与设置 IA

[`windows-dom.json`](./windows-dom.json) 记录了安装态 WebView2 DOM：

- AI 助手面板恰好 1 个、输入框恰好 1 个。
- 没有独立“工具 / Tools”页签或工具入口。
- 设置导航恰好 1 个选中项，使用组件背景高亮，边框透明。
- 控制台错误为 0。

### 帮助中心外链与桌面小组件边界

[`help/windows-widget-help.json`](./help/windows-widget-help.json) 记录了真实点击：

- 小组件面板识别为原生桌面宿主，未展示 PWA 安装步骤。
- 当前 Windows 桌面宿主明确显示“暂不支持系统小组件”，没有伪造能力。
- 点击帮助后 WebView2 仍停留在 `https://heyta.local/index.html`。
- Windows UI Automation 观察到 Chrome 帮助页标签数由 15 增至 16，地址为 `https://heyta.waytofuture.cn/docs`，外链交接成立。

## 本轮未重新通过的项目

本轮独立副本通过 SSH 计划任务启动后，WebView2 CDP 可用，但 WinUI 顶层窗口没有暴露可用 `MainWindowHandle`，因此无法在该会话中安全地重新执行原生标题栏按钮、真实鼠标拖动、最大化/还原的 UIA 点击。没有为了强行取证去关闭其他 QA 进程或触碰默认窗口。

这不是页面布局失败；已有同日原生顶栏独立验收证据保留在 [`../ux-final-20261008-integrated-titlebar/RESULT.md`](../ux-final-20261008-integrated-titlebar/RESULT.md)，其中包含真实拖动、最小化、最大化、还原、关闭及 800×680 窄窗无溢出读数。本轮将该项标记为“既有证据可用，本轮隔离会话未复测”，不冒充为本轮新鲜 UIA 读数。

## 证据清单

- `windows-auth-legal.json` / `windows-auth-terms.png` / `windows-auth-privacy.png` / `windows-auth-form-returned.png` / `windows-auth-narrow.png`
- `windows-theme-responsive.json` / `windows-settings-light.png` / `windows-settings-dark.png` / `windows-settings-narrow.png`
- `windows-dom.json` / `windows-chatbot.png` / `windows-settings.png`
- `help/windows-widget-help.json` / `help/windows-browser-before.json` / `help/windows-browser-after.json` / `help/windows-widget-native.png` / `help/windows-help-shell-unchanged.png`
- `install-identity.json` / `finalize-remote.json`
- `ui-typecheck.log` / `mobile-typecheck.log`
- `legal-reader-current.log`
