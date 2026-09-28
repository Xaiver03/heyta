# 桌面端选型：RN 系（react-native-macos + react-native-windows）vs Tauri vs PWA

> **调研日期**：2026-09-27（所有"最新"数据均以该日实测为准）
> **调研问题**：桌面端走 React Native 系是否可行、是否值得？特别是这两个壳能不能提供系统级小组件？
> **状态**：**调研结论，未拍板。** 本文只给证据；要固化的决策须新开 ADR（承接 [`../adr/0003-multi-platform-strategy.md`](../adr/0003-multi-platform-strategy.md) §"桌面（macOS/Windows/Linux）待定"）。
> **与相邻文档的关系**：[`native-widgets.md`](native-widgets.md) 讲"各端组件怎么做"；本文讲"桌面壳选谁、壳能不能承载组件"。

---

## 0. 一句话

**"桌面走 RN 系"不是一个整体判断 —— 它的两半结论相反。** `react-native-windows`（RNW）0.84 与 heyta 的 RN 0.84.1 **精确对齐**，是唯一能覆盖 Windows 的 RN 桌面壳；`react-native-macos` 停在 **0.81**，官方文档明文要求"React Native 与 react-native-macos 用同一个 minor 版本"，与 heyta 的 0.84.1 **直接冲突**。而小组件这件事，两端都"能做"，但**都不发生在 RN 层** —— 组件永远是原生代码 + 独立扩展/进程，RN 壳只提供打包容器和共享存储。

---

## 1. 结论（≤5 条）

1. **macOS 这一半现在不可行（不是"难"，是版本硬冲突）。** `react-native-macos` 最新 release 是 **0.81.9（2026-07-13）**，peerDependency 写明 `react-native: 0.81.6`；其官方 Get Started 原文："Be sure to use the same minor version between React Native and React Native macOS. We'll use `^0.81.2`"。heyta 在 0.84.1 → 要用它必须把移动端降到 0.81 或维护两条 RN 版本流。上游 RN 已到 **0.87.1（2026-08-26）**，macOS 落后 **6 个 minor series**；合并到 0.83 的工作仍是**开着口的 tracking issue**（[#2901](https://github.com/microsoft/react-native-macos/issues/2901)，2026-04-09 开），没有任何 0.82/0.83 的 npm release。
2. **Windows 这一半版本上完全可行，但代价在别处。** RNW 0.84.0（npm `2026-06-18`；官方 support matrix 写 `06/22/2026`）peerDependency = `react-native: 0.84.1`，**与 heyta 一模一样**，且官方 support matrix 上 0.84 处于 **Active Support**。卡点不是 RN 版本，而是：heyta 的存储层 `op-sqlite` **不支持 Windows**（官方文档只列 iOS/Android/macOS/web），且 RNW New Architecture **不支持 C#**。
3. **macOS 小组件：能用（有条件），且 Developer ID + 公证 + 直接分发不影响 WidgetKit 识别。** 这是本次最关键的一条，有明确一手/权威实践证据：
   - [`tauri-plugin-widgets`](https://s00d.github.io/tauri-plugin-widgets/guide/setup/macos) 的签名表**直接列出**：Signing = **Developer ID** → "Widget visible: **Yes**" → transport = `appGroup` → Distribution = **Direct distribution**；并写明"The widget extension is always sandboxed (required by WidgetKit)"。
   - 真实案例 [steipete/CodexBar](https://github.com/steipete/CodexBar/issues/1173)（Developer ID + 公证 + Homebrew cask 分发）：初期组件**不出现**在 macOS 组件库里，日志报 `Extension is not entitled to run in the App Sandbox`；约两个半月后 [#2838](https://github.com/steipete/CodexBar/issues/2838)（2026-08-10）显示**组件已出现在组件库并能渲染内容**（只是某个尺寸渲染成黑块）。→ 结论：**机制成立、坑真实**（sandbox/entitlement 对齐），不是"看着能用实际不行"。
4. **Windows 小组件：能用，但门槛比 macOS 高，且和选哪个壳几乎无关。** 微软一手文档（[Widget provider package manifest XML format](https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-provider-manifest)，2026-07-05 更新）原文："For Win32 apps, **only packaged apps are currently supported**"；[实现教程](https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-win32)（2026-08-19 更新）要求：**MSIX 打包工程** + 一个**独立的 COM exe server**（`com:ExeServer` 注册、实现 `IWidgetProvider`）+ `com.microsoft.windows.widgets` appExtension。⇒ 任何能出 MSIX 的栈都能做，**与 RN 无关**。RNW 0.84 的 `cpp-app` 模板**自带 Windows Packaging project**（官方 FAQ 原文），所以容器是有的 —— **但 RNW New Arch 不支持 C#**，微软样例和 `tauri-plugin-widgets` 的 provider 都是 C#，所以只能写 C++/WinRT。
5. **UI 复用度被严重高估，且有硬数字。** 官方 React Native Directory 的 2716 个库里，声明支持 **Windows 的只有 73 个、macOS 只有 54 个**（对比 iOS 2564 / Android 2552），**两个都支持的只有 28 个** —— 约 2.8% / 2.1%。heyta 的 `op-sqlite` 就是活样本：macOS ✅、Windows ❌。

---

## 2. 现状表（一手来源）

| | `react-native-macos` | `react-native-windows` |
|---|---|---|
| **仓库** | microsoft/react-native-macos | microsoft/react-native-windows |
| **许可证** | **MIT**。<br>LICENSE 原文抬头：`MIT License / Copyright (c) Meta Platforms, Inc. and affiliates.`<br>README §License：本扩展与其修改、新增代码 "provided under the [MIT License]" | **MIT**。<br>LICENSE 原文抬头：`The MIT License (MIT) / Copyright (c) Microsoft Corporation and contributors.`<br>`Portions derived from React Native: Copyright (c) 2015-present, Facebook, Inc.` |
| **最新 release** | **0.81.9**，npm 发布 **2026-07-13T20:37:11Z**<br>（dist-tags 里最高稳定分支就是 `0.81-stable`；**没有 0.80/0.82/0.83/0.84**） | **0.84.0**，npm 发布 **2026-06-18T05:51:22Z**<br>官方 support matrix 写 **06/22/2026**（两处口径不同，均为原始记录）<br>preview：`0.85.0-preview.2`（2026-09-25） |
| **最后提交（`main`）** | **2026-09-01T16:19:47Z**（dependabot chore）<br>最近一次非机器人提交：2026-08-04 | **2026-09-26T17:53:19Z** |
| **支持的 RN 版本** | **RN 0.81.x**（peerDep `react-native: 0.81.6`）<br>官方要求"同一 minor 版本"<br>**距 heyta 的 0.84.1：差 3 个 minor；距上游最新 0.87.1：差 6 个** | **RN 0.84.1**（peerDep 精确等于 heyta）<br>官方 support matrix：RNW 版本号与 RN stable 版本号**一一对应**<br>**与 heyta：完全对齐** |
| **维护方** | Microsoft（仓库在 microsoft org；当前 merge-up 由 Microsoft 的 Saad Najmi 主导）<br>Meta 曾公开合作贡献（Messenger Desktop 时期） | **Microsoft**（RNW 团队，有对外发布的 support policy 与 support matrix） |
| **新架构（Fabric / TurboModules / C-API）** | ⚠️ **未核实**。仓库 `main` 分支**存在** Fabric 源码（实测 `React/Fabric/RCTSurfacePresenter.h`、`React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.h`、`ReactCommon/react/renderer/core/ShadowNode.h` 均 HTTP 200），但 RN-macOS 文档站**没有 New Architecture 页面**，也没有任何 release note 声明 macOS 的 Fabric 可用性。**不要当成"支持"用。** | ✅ **New Architecture 是唯一架构**。0.82 起 Paper 被完全移除（[官方文档](https://microsoft.github.io/react-native-windows/docs/getting-started/)原文："Starting with React Native Windows 0.82, the legacy Paper architecture has been completely removed"）。新架构模板 = `cpp-app`（**C++ / WinAppSDK Win32 / Composition 渲染**）。 |
| **已知重大限制** | ① 版本落后 6 个 minor，且"同一 minor"是硬性要求；② 0.83 merge 仍是开放 tracking issue；③ 文档站明确"macOS 文档仍在建设中，欢迎贡献"；④ `Modal` 等核心组件在 macOS 上曾长期不支持（2021 年的第三方记录，见 §6 未核实） | ① **New Arch 不支持 C#**（官方 FAQ 原文："React Native for Windows doesn't yet [support C#]"）→ 新架构 app/library 只能 C++；② New Arch 与 Old Arch **未 100% feature parity**；③ 仅旧架构独有的核心组件（`Flyout` / `Popup` / `Glyph`）在新架构**不支持**；④ 社区原生库需要为 Windows 重新实现原生 UI；⑤ 官方"发布到 Microsoft Store"文档自我标注为**旧架构文档、待复核** |
| **支持策略** | 未发布独立的 support matrix（未找到） | **已发布** support policy + matrix：0.84 = Active；0.83 End of Support **2026-09-30**；0.82 已 EOS **2026-08-31**；0.81 Unsupported。节奏约 2–3 个月一个 stable |

**顺带一个对 heyta 自身的提醒**（不是本文主题，但影响判断）：npm 实测 RN 最新 stable = **0.87.1（2026-08-26）**，next = `0.88.0-rc.2`。heyta 的 0.84.1 发布于 2026-02-27。RN 官方策略是维护最新 3 个 minor series → **0.84.x 已在上游支持窗口之外**（依据 RN Releases Overview，经二手转引，未逐字核对原文 → 归入 §6）。

---

## 3. 小组件可行性判定

### 3.1 macOS：**能用（有条件）** —— 卡在 sandbox/entitlement 对齐，不卡在分发方式

**先回答那个 🔴 问题：Developer ID 签名 + 公证 + 直接分发（非 Mac App Store）的 macOS 应用，WidgetKit extension 还能被系统识别吗？**

> **能。** 三条独立证据：

1. **权威实践文档（一手）**：[`tauri-plugin-widgets` macOS setup](https://s00d.github.io/tauri-plugin-widgets/guide/setup/macos) 有一张明确的签名 × 可见性 × 分发对照表 ——

   | Signing | Widget visible | Recommended transport | Distribution |
   |---|---|---|---|
   | Ad-hoc (`-`) | Yes | `widgetContainer` | Local only |
   | Apple Development | Yes | `appGroup` | Local + TestFlight |
   | **Developer ID** | **Yes** | `appGroup` | **Direct distribution** |

   并给出两条数据通道：`appGroup`（真 Team ID + App Groups）/ `widgetContainer`（`~/Library/Containers/<appex>/Data/`，**要求宿主 app 不被 sandbox**，ad-hoc 也能跑）。还写明"**The widget extension is always sandboxed (required by WidgetKit)**"。

2. **真实产品案例（一手）**：[CodexBar](https://github.com/steipete/CodexBar/issues/1173) 是 Developer ID + 公证 + Homebrew cask 分发的 macOS 菜单栏应用。issue #1173（2026-05-27）里它的 `.appex` 被 PlugInKit 正确注册且 enabled，但**不出现在组件库**，`chronod` 一直把它挂在 `extensionsPendingDescriptorRefetch`；日志报 **`Extension is not entitled to run in the App Sandbox`**；作者怀疑根因是"宿主 app 没 sandbox 而 extension sandbox 了"。issue 已 **Closed**，且 [#2838](https://github.com/steipete/CodexBar/issues/2838)（2026-08-10）里组件**已经出现在组件库并能渲染**（"Other CodexBar widget previews can render visible bars/content"）→ 修好了。

3. **App Groups 与 Developer ID 共存（一手 dump）**：上面 #1173 里作者贴出的实际 entitlements —— 宿主 app（Developer ID 签名）带 `com.apple.security.application-groups = ["Y5PE65HELJ.com.steipete.codexbar"]`，extension 带 `app-sandbox = true` + 同一个 group。→ 团队前缀式 App Group 在 Developer ID 分发下是**真实可用的**。

**卡在哪一步（按顺序）：**
1. **RN 版本**：`react-native-macos` 0.81 vs heyta 的 0.84.1 —— 这一关卡在**进 Xcode 之前**。
2. **Xcode 工程加 app extension target**：`react-native-macos` 产出标准 `macos/{Project}.xcworkspace`（官方 Get Started 实证），加 `.appex` target 是标准 Xcode 能力。**但目前没有找到任何一个 react-native-macos 应用真的带 `.appex` 的案例** → 机制成立、无先例。
3. **entitlements / sandbox 对齐**：CodexBar 在这里卡了约 2.5 个月。两条可用配置（App Group 或 `widgetContainer`+宿主不 sandbox）必须**显式选定**。
4. **数据面**：[`native-widgets.md`](native-widgets.md) §3 的四条不变量 + §5.1 的"明文快照 vs 设备密钥加密"决策同样适用于桌面组件，且**桌面端没有已跑通的上游可抄**。

**还有一条更便宜的降级路径（不需要 Mac 壳）**：macOS 14 (Sonoma) 起，**iPhone 的组件可以直接放到 Mac 桌面/通知中心**，通过 Continuity，同一 Apple 账号 + iPhone 在附近或同 Wi-Fi，**支持交互**。→ 这是**降级形态**（依赖用户有 iPhone、同一网络），但成本接近零。

### 3.2 Windows：**能用，但必须 MSIX + 一个独立 COM exe server**

微软一手文档链条完整：

| 要求 | 原文/来源 |
|---|---|
| **必须打包** | "For Win32 apps, **only packaged apps are currently supported**" —— [widget-provider-manifest](https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-provider-manifest)（2026-07-05）<br>教程里再强调一次："**In the current release, only packaged apps can be registered as widget providers.**"<br>MSFT 官方在 Q&A 里对"unpackaged 单 exe 能不能支持 widgets"的回答是：**"It is not possible at present"** |
| **要一个独立的 COM exe server** | 教程要求新建 C++/WinRT 控制台工程 → `IWidgetProvider` 实现 → 在 manifest 里注册 `com:Extension Category="windows.comServer"` + `<com:ExeServer Executable="...exe">`，**这是一个独立进程**，由系统 COM 激活 |
| **要 packaging project** | 加 "Windows Application Packaging Project"（`.wapproj`）+ `Microsoft.WindowsAppSDK` NuGet |
| **要注册 appExtension** | `<uap3:AppExtension Name="com.microsoft.windows.widgets">` + `<CreateInstance ClassId="{GUID}">`（**Recommended** 的激活方式） |
| **发布** | 教程推荐走 Microsoft Store；旁加载需要 MSIX 的 Publisher 与证书 Subject **完全一致**（`tauri-plugin-widgets` 给了 `DevCert.ps1` 脚本） |

**RNW 侧的对应关系：**
- RNW 0.84 `cpp-app` 模板**自带 Windows Packaging project** —— 官方 FAQ 原文："Yes, the new `cpp-app` template uses a Windows Packaging project so you can still publish your application to the Windows Store." ⇒ **容器有了**，manifest 有地方写。
- 但 **RNW New Arch 不支持 C#** ⇒ 微软样例（C#/C++ 两版都有）里只能用 **C++/WinRT** 版；`tauri-plugin-widgets` 那份现成的 C# provider **不能直接拿来用**。
- ⚠️ 官方那篇"发布到 Microsoft Store"文档**自我标注为旧架构文档、待复核**（0.84 页面顶部原文），所以"新架构下打包流程到底怎么走"**没有干净的官方文档** → 归入 §6。
- 🔴 **没有找到任何人从 RNW 应用里注册过 Windows widget provider 的案例**（也**没有**找到"做不到"的说明）→ 判定为**"机制成立、无人做成过（未找到案例）"**。

**Windows 上真正"文档写了 + 有官方 demo"的组件路径是 PWA，而不是任何原生壳：**
- 微软一手文档 [Display a PWA widget in the Windows Widgets Board](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/widgets)：PWA 在 manifest 里声明 `widgets`，用 **Adaptive Cards 模板**渲染，service worker 里用 `self.widgets.*` + `widgetinstall` / `widgetclick` 事件；原文 **"no C++/C# code is required"**。
- 官方 demo：**PWAmp**（有可点的安装步骤）。
- ⚠️ **但"不需要 Windows App"这个说法要修正**：文档写的是用 **PWABuilder 打包并 ship 到 Microsoft Store** —— 也就是说 **PWA 仍然要变成一个 MSIX 打包的应用**才能拿到 widget 注册所需的 package identity。而且组件**必须用 Adaptive Cards 重画**（不是把 Web UI 塞进去），刷新靠 service worker 的 periodic sync。

### 3.3 判定汇总

| 平台 | 判定 | 卡在哪一步 |
|---|---|---|
| **macOS 真·原生组件**（走 RN 系） | ⚠️ **能用，但现在进不去**（RN 0.81 vs 0.84.1 硬冲突） | ① 版本冲突（最先卡）；② 无 RN-macOS + `.appex` 先例；③ entitlements/sandbox 对齐（CodexBar 卡了 2.5 个月） |
| **macOS 降级形态**（Continuity，iPhone 组件上 Mac） | ✅ **能用，成本≈0** | 依赖用户有 iPhone + 同网；不是 Mac 原生组件 |
| **Windows 原生组件**（走 RNW） | ⚠️ **能用，但要做 MSIX + 一个 C++/WinRT COM exe server** | ① `op-sqlite` 不支持 Windows（存储层要重写）；② RNW New Arch 无 C#；③ 无先例；④ 新架构打包流程无干净官方文档 |
| **Windows 原生组件**（走 PWA） | ✅ **能用，有一手文档 + 官方 demo** | ① 需把 `apps/web` 做成可安装 PWA；② 需 MSIX 打包（PWABuilder）；③ 组件要用 Adaptive Cards 重画 |
| **Windows 原生组件**（走 Tauri） | ✅ **能用，有现成脚手架** | 需 MSIX + C# provider（`tauri-plugin-widgets` 已生成）；Tauri 默认 MSI/NSIS **没有** package identity |

---

## 4. UI 复用度：真实能复用多少

### 4.1 硬数字（一手，可复现）

从官方 React Native Directory 的数据源实测（2026-09-27）：

```
total libraries: 2716
ios=2564  android=2552  windows=73  macos=54  web=570
windows 占 iOS 的 2.8%   macos 占 iOS 的 2.1%
同时支持 windows+macos 的：28 个
```

> 来源：`react-native-community/directory` 的 `react-native-libraries.json`（RNW 官方文档 §Supported Community Modules 指的就是这个 Directory）。复现：`curl` 该文件后按 `windows` / `macos` 字段计数。

⇒ **"移动端 UI 复用"在 RN 桌面壳上是"页面代码能搬，生态不能搬"**：React 组件、状态管理、纯 TS 业务逻辑（heyta 恰好都有 `packages/domain`）可复用；**任何带原生代码的库（DB、加密、通知、相机、图表、手势……）默认不可用**，需要找替代或自己写。

### 4.2 heyta 自己的库就是反例

`@op-engineering/op-sqlite` 官方 Installation 文档原文：**"This package runs on `iOS`, `Android`, `macOS` and `web`."** —— **没有 Windows**。Windows 支持 issue [#43](https://github.com/OP-Engineering/op-sqlite/issues/43)（2024-01-24 开，label `help wanted`）**仍未实现**。

⇒ 这直接决定了两条结论：
- **走 RNW**：heyta 的 `SqliteAdapter`（[`../adr/0003-multi-platform-strategy.md`](../adr/0003-multi-platform-strategy.md) §2.2 已经把它设计成可替换）需要一个**新的 Windows 原生实现**，这是 first-party 工作量，不是配置问题。
- **走 RN-macOS**：op-sqlite 支持 macOS ✅ —— **但版本关卡在前面就已经过不去了**。

### 4.3 真实产品案例

| 案例 | 事实 | 对 heyta 的意义 |
|---|---|---|
| **Facebook Messenger Desktop** | Meta 官方博客（2023-05-17）：从 Electron **迁移到 React Native**（RNW + RN macOS），**复用约 80% 的 JavaScript 代码**（注意：复用的是**原 Electron/React 代码**，不是移动端 RN 代码）；二进制小 >100MB，加载快 50%，崩溃 macOS −15% / Windows −67%。**明确列的代价**：桌面没有现成的多窗口组件（自己写）、没有自动更新（自己接 Sparkle）、没有官方 E2E 方案（自己扩） | ✅ **这是"RN 覆盖桌面"最强的真实产品证据**，且是**同时覆盖 macOS + Windows**。<br>⚠️ 但它同时证明了代价：**桌面特有的东西（多窗口/更新/托盘/E2E）全要自己造**。 |
| **Meta 后续** | 同博客：Workplace Chat 等更多 RN Desktop 应用；并"与 Microsoft 合作推进 New Architecture 与 C++ TurboModule 在 macOS/Windows 上的支持" | 这条**2023 年的合作**正是后来 RNW 0.84 追平的原因 |
| **Microsoft Office** | 二手来源称微软 Office 组织用 C++ + React Native 做桌面（而非 MAUI）；RNW 团队工程师在 X 上说过"Office for starters" | ⚠️ **未核实**（均为二手/推文），不作为结论 |
| **RNW 官方 sample** | `react-native-gallery`（已上架 Microsoft Store） | 证明 RNW 应用可以上 Store，但它是 showcase，不是业务产品 |

**⚠️ 关于"它们的小组件怎么做的"**：Messenger Desktop 的公开材料里**没有提到任何系统小组件**（它做的是窗口/托盘/更新）。**没有找到任何一个"用 RN 做桌面 + 同时提供系统小组件"的真实案例** → 这条路上 heyta 会是先行者。

---

## 5. 桌面三方案对比表

维度按 heyta 的实际约束排。**"评审口径"列区分"文档写了"/"有人做成过"/"推测"**。

| 维度 | **桌面走 RN 系**（RNW + RN-macOS） | **Tauri** | **PWA / Electron** |
|---|---|---|---|
| **UI 复用度** | `packages/domain` / 纯 TS ✅ 全复用<br>React 组件 ✅ 大体可搬（无 DOM/CSS，布局要按 Yoga 适配）<br>**原生库 ❌ 2.8%/2.1%**（Windows 73、macOS 54、两者兼有 28）<br>`op-sqlite`：macOS ✅ / **Windows ❌** | ⭐ **最高**：直接复用 `apps/web` 的 React 19 代码与 CSS（Web 壳已存在，零改写）<br>原生能力走 Rust 侧，按需加 | PWA：复用 `apps/web` 100%，但**系统集成能力最弱**<br>Electron：复用同 Tauri，但体积/内存代价大（Messenger 博客实测框架本身 up to 200MB） |
| **许可证** | 两者均 **MIT**（已读 LICENSE 原文） | Tauri **MIT / Apache-2.0** 双许可<br>`tauri-plugin-widgets` **MIT**（文档站页脚） | PWA：标准 + 浏览器；Electron **MIT** |
| **RN/框架版本对齐** | RNW **0.84.0 = RN 0.84.1 ✅ 精确对齐**<br>**RN-macOS 0.81 ❌ 差 3 个 minor（距上游 6 个）** | 与 RN 版本无关（Tauri 自己版本化） | 与 RN 版本无关 |
| **macOS 系统小组件** | **能用**：需自己加 `.appex` target + entitlements 对齐<br>评审口径：**文档/权威实践写了"Developer ID 直分发可见=Yes"**（tauri-plugin-widgets 表）+ **有人做成过**（CodexBar）<br>⚠️ 但**没有 RN-macOS 的先例** | ⭐ **能用且已有脚手架**：`tauri-plugin-widgets` 自动生成 sidecar Xcode 工程、签 `.appex`、嵌 `Contents/PlugIns/`、随 DMG 分发<br>评审口径：**文档写了 + 有 CLI/Doctor 工具链** | PWA ❌ 无（浏览器无系统组件 API）<br>Electron ❌ 无现成方案（组件与壳无关，仍要自己写 `.appex`） |
| **Windows 系统小组件** | **能用**：RNW `cpp-app` 自带 Packaging project；但需**自己写 C++/WinRT COM exe server**（New Arch 无 C#）<br>评审口径：**机制成立、无人做成过（未找到案例）** | ⭐ **能用且已有脚手架**：`init-windows` 直接生成 C# `IWidgetProvider` + manifest 片段 + `DevCert.ps1`<br>但 Tauri 默认 MSI/NSIS **无 package identity**，要额外做 MSIX（winapp CLI 现在支持）<br>评审口径：**文档写了 + 有工具链** | PWA ✅ **微软一手文档 + 官方 demo（PWAmp）**，"no C++/C# code required"<br>⚠️ 但仍需 **MSIX 打包**（PWABuilder → Store）才有 package identity；组件必须用 **Adaptive Cards** 重画<br>Electron：需 MSIX + 自己写 provider |
| **维护性 / 支持窗口** | RNW：**有公开 support matrix**（0.84 Active；0.83 EOS 2026-09-30；约 3 个月/版）→ 需跟着发布火车走<br>RN-macOS：**无 support matrix**；0.83 merge 仍是开放 issue；文档站自认"macOS 文档建设中"<br>两端是**两条独立版本流**要同时跟 | 单一上游，无 RN 版本耦合；桌面组件插件是**第三方单人项目**（`s00d`）→ 自身也有维护风险 | PWA：跟随浏览器/Edge；微软文档长期存在<br>Electron：上游活跃 |
| **构建复杂度** | 最高：Xcode + Visual Studio + 两套原生工程 + Metro 分平台 + `op-sqlite` 的 Windows 实现 | 中：Rust 工具链 + 前端；组件另加 XcodeGen / .NET provider | PWA：最低（改 `apps/web` 成可安装 PWA + PWABuilder）<br>Electron：中低 |
| **分发（签名/公证/商店）** | macOS：Developer ID + 公证 + DMG（`.appex` 要一起签/嵌）<br>Windows：MSIX（RNW 有 Packaging project）或 unpackaged→但 unpackaged **不能**注册 widget | macOS：Developer ID + 公证 ✅（插件已处理 `.appex` 嵌套签名）<br>Windows：MSI/NSIS 默认无 identity；MSIX 需额外工作（winapp CLI 可加 identity） | PWA：走 Store 或 sideload MSIX（Publisher 必须匹配证书）<br>Electron：electron-builder / electron-windows-msix 有现成 MSIX |
| **桌面特有缺口** | 多窗口 / 自动更新 / 托盘 / E2E 都要自己造（Messenger 博客列的，**至今仍无官方方案**） | Tauri 自带多窗口、updater、托盘、E2E（WebDriver） | Electron 全都有现成方案 |

---

## 6. 未核实（不要当结论用）

1. **`react-native-macos` 的 New Architecture / Fabric 在 macOS 上是否真正可用。** 实测：仓库 `main` 分支**存在** Fabric 源码（3 个关键文件 HTTP 200）；但 RN-macOS 文档站**没有 New Architecture 页面**，也没有任何 release note 声明 macOS 的 Fabric 可用性。→ **不要当成"支持"用。**
2. **`react-native-macos` 的 Xcode 工程能否加 app extension target。** 机制上必然可以（标准 Xcode 工程能力，官方 Get Started 实证 `macos/{Project}.xcworkspace`），但**没有找到任何真的这么做的 RN-macOS 应用**。→ "机制成立、无先例"。
3. **有没有人从 RNW 应用注册过 Windows widget provider。** 未找到任何案例，**也**未找到反例（没有"做不到"的说明）。→ 只能标"未找到案例"。
4. **在 RNW `cpp-app` 的 Windows Packaging project 里能否再加一个 C# COM exe server。** RNW 的"不支持 C#"是针对 RNW app/library 项目；独立 COM server 项目是否可与之共存未查证。稳妥路线是 C++/WinRT（微软有完整教程）。
5. **Apple 官方对 "Developer ID + App Groups" 的具体规定。** [`Configuring app groups`](https://developer.apple.com/documentation/xcode/configuring-app-groups) 页面正文抓取失败（JS 渲染，只拿到标题）。现有结论建立在 **CodexBar 贴出的真实 entitlements dump**（Developer ID 签名 + `application-groups` 生效）与 `tauri-plugin-widgets` 的实践表上，**不是** Apple 原文。
6. **Windows PWA widget 能否通过 sideload MSIX（非 Store）注册。** 官方文档只写了走 Store / PWABuilder。**未核实**旁加载是否同样有效。
7. **macOS Continuity（iPhone 组件上 Mac）的官方口径。** 本文只核到 Apple 的 [Continuity 要求页](https://support.apple.com/en-us/108046) 与二手报道；`native-widgets.md` 引用的 `support.apple.com/guide/mac-help/mchl3e281fc9/mac` **未逐字复核**。
8. **"RN 0.84.x 已出上游支持窗口"** 这条依据 RN Releases Overview（最新 3 个 minor series），经 Uno Platform 文章与搜索摘要转引，**未逐字核对 RN 原文**。
9. **Microsoft Office 桌面用 React Native** —— 均为二手来源/推文，**未核实**。
10. **RNW 0.84.0 的发布日期**：npm `2026-06-18` vs 官方 support matrix `06/22/2026`，两处口径不一致，**未判定哪个为准**。
11. **New Architecture 下 RNW 应用的完整打包/分发官方文档** —— 官方"发布到 Store"页面自我标注为"旧架构文档、待复核"。→ 新架构打包流程**没有干净的官方文档**。
12. **RN-macOS 是否完全不支持 `Modal` 等核心组件** —— 现有一手证据只到 2021 年的第三方博客，**未在 0.81 上复核**。

---

## 7. 给 heyta 的建议

### 7.1 直接回答"桌面走 RN 系是否可行、是否值得"

- **可行性**：**Windows 可行（版本对齐）；macOS 现在不可行（0.81 vs 0.84.1 硬冲突）。** 只要 heyta 不接受把移动端降到 RN 0.81，RN-macOS 就从选型里出局 —— 这一条与小组件无关，是纯版本约束。
- **值得性**：**只有在 heyta 愿意为 Windows 单端付两笔额外成本时才值得** —— ① 给 `op-sqlite` 写一个 Windows 原生实现（或换库）；② 写一个 C++/WinRT 的 `IWidgetProvider` COM exe server。**如果目标是"桌面也要有系统小组件"，这两笔成本一分都省不掉，而且换 Tauri/PWA 会明显更便宜。**

### 7.2 推荐顺序（按"目标里包不包含系统小组件"分叉）

**若"桌面要有系统小组件"是硬需求（当前 [roadmap](../plans/multi-platform-widgets.md) 的形态）：**

| 优先级 | 方案 | 理由 | 必须接受的代价 |
|---|---|---|---|
| **1** | **`apps/web` → 可安装 PWA**（Windows 组件 + macOS 走 Continuity） | Windows 组件有**微软一手文档 + 官方 demo（PWAmp）**，"no C++/C# code required"；macOS 靠 Continuity **零壳成本**；不需要任何新桌面壳 | ① Windows 组件仍需 **MSIX 打包（PWABuilder）**；② 组件要用 **Adaptive Cards 重画**，不能复用 Web UI；③ 刷新受 service worker / periodic sync 限制；④ macOS 那条是**降级形态**（依赖用户有 iPhone） |
| **2** | **Tauri + `tauri-plugin-widgets`** | **唯一一条两端组件都有现成脚手架的路**：macOS 自动生成 sidecar Xcode 工程 + 签 `.appex` + 嵌 PlugIns + 随 DMG/公证分发（且明确写了 Developer ID 直分发可用）；Windows 生成 C# `IWidgetProvider` + manifest 片段 + `DevCert.ps1`。UI 直接复用 `apps/web`（比 RN 复用度更高） | ① Windows 需额外做 **MSIX**（默认 MSI 无 identity）；② macOS 若用 `widgetContainer` transport 则**宿主 app 不能 sandbox**；③ `tauri-plugin-widgets` 是**第三方单人项目**，需评估[可维护性门槛](../../AGENTS.md) |
| **3** | **RNW 单端** | 版本与 heyta **精确对齐**（0.84.1）；`cpp-app` 自带 Packaging project | ① 放弃 macOS 原生组件；② 写 Windows 存储层；③ 写 C++/WinRT provider；④ 无先例 |
| **✗** | **react-native-macos** | —— | RN 0.81 vs 0.84.1 硬冲突；小组件可行性并不因此改善 |

**若"系统小组件"不是硬需求（普通桌面 App）：** 那结论不取决于组件，取决于 UI 复用成本 —— **Tauri 明显优于 RN 系**（直接复用已存在的 `apps/web` React 19 代码，无需为桌面重做 Yoga 布局适配，且不受 2.8%/2.1% 生态数字的约束）。RN 系唯一优势是"与移动端同一套 RN 心智模型"，但 heyta 的架构（[ADR-0003](../adr/0003-multi-platform-strategy.md) §2.1：业务逻辑全在 `packages/`，`apps/*` 只放壳）**已经把这条优势的边际价值压低了** —— 因为真正要复用的那部分（`packages/domain`）在任何壳里都能复用。

### 7.3 小组件需求会不会改变结论？

**会，但方向是"把 Tauri/PWA 顶上来"，不是"让 RN 系变得可行"：**

- 它**不会**让 macOS 的 RN 路线变可行 —— macOS 组件可行性从来不取决于 RN，取决于 Xcode + entitlements；而 RN-macOS 的版本冲突在这之前就已经否决了它。
- 它**不会**让 Windows 的 RN 路线变不可行 —— 但会把"必须自写 C++/WinRT COM server + 重写存储层"这两笔成本**变成硬前置**。
- 它**会**显著抬高 Tauri/PWA 的相对分：这两条路都有**现成的组件脚手架**（`tauri-plugin-widgets` 两端；PWA 有微软官方 demo），而 RN 系两端都得自己造，且**全程没有任何"用 RN 做桌面 + 带系统组件"的先例可抄**。

**建议的下一步（最小可验证）：** 不要再做桌面壳的技术选型辩论，直接按 [`../plans/multi-platform-widgets.md`](../plans/multi-platform-widgets.md) §6 的"最贵未知数"逻辑切一刀 —— 先验证 **PWA widget 在 Windows 上从 `apps/web` 走通**（包括 MSIX 打包那一步），因为它是**唯一有微软一手文档 + 官方 demo** 的路径；走通了，桌面组件这件事就不需要新壳；走不通，再拿 Tauri 的 `init-windows` / `init-macos` 做同样的验证。

---

## 8. 🔴 2026-09-28 复核：三条会把结论改掉的新事实

本文 §1–§7 的观测时点是 **2026-09-27**，且**默认"代码量是判据"**。
2026-09-28 产品明确"**哪怕是代码量偏大**"（原生性优先于复用度），并在同一天做了复核。
**以下三条改变了 §1 的结论 2 与 §7.2 的推荐。**

### 8.1 RNW 停在 0.84，且没有任何 ≥0.85 的稳定版 —— "版本精确对齐"是负债

§2 的现状表记录了"RNW 0.84.0 ↔ RN 0.84.1 精确对齐"，并把它当成**优点**。
复核发现**对齐的另一半没人看**：

```
$ curl -s https://registry.npmjs.org/react-native-windows | node -e '…读 dist-tags…'
latest   = 0.84.0          v0.83-stable = 0.83.2     v0.82-stable = 0.82.8
preview  = 0.85.0-preview.2                          v0.81-stable = 0.81.36
稳定版 0.85 / 0.86 / 0.87 = ABSENT

$ curl -s https://registry.npmjs.org/react-native | … '."dist-tags".latest'
0.87.1        （发布 2026-08-26）
```

| 事实 | 值 |
|---|---|
| RNW 最新**稳定**版 | **0.84.0** |
| RNW 是否有 0.85/0.86/0.87 **稳定**版 | **没有**（仅 `0.85.0-preview.2`） |
| RN 上游最新稳定版 | **0.87.1** |
| heyta 停在 | RN **0.84.1** |

⇒ RNW 与 RN 是**版本号一一对应**的（本文 §2 自己引的官方 support matrix）。
既然 RNW 没有 0.85+，那么

> **"先把 RN 抬到受支持版本，再上 RNW"这条前置是自我否定的** ——
> 抬了 RN 就没有 RNW 可用；不抬 RN 就把整个 monorepo（含旗舰 `apps/mobile`）
> 冻在一个**已出上游支持窗口**的版本上。

**这条把"选 RNW"的代价从"未来维护负担"改判为"当下锁死移动端产品"。**
代价的**性质**变了：它不再是代码量问题，因此**不被"哪怕是代码量偏大"覆盖**。
→ [ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §1.2 据此全部取代 [ADR-0032](../adr/0032-windows-native-via-rnw.md)。

### 8.2 §3.2 的 C3「provider 只能写 C++/WinRT、无先例」**只在选 RNW 时成立**

§3.2 记的是：*"RNW New Arch 不支持 C# ⇒ 微软样例里只能用 C++/WinRT 版"*。
复核发现微软**同时发布了 C# 版官方教程**（C++/WinRT 版正文里直接链过去）：

- C++/WinRT：<https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-win32>
  原文：*"…adapted from the Windows App SDK Widgets Sample.
  **To implement a widget provider using C#, see [Implement a widget provider in a win32 app (C#)]**"*
- **C#**：<https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-cs>
  （2026-09-28 实抓 **HTTP 200**；标题 *"Implement a widget provider in a **C# Windows App**"*；
  第一步 *"Create a new **C# console app**"*；前置 *"Visual Studio 2022 or later with the
  WinUI application development workload"*）

⇒ **"无先例"是 RNW 的属性，不是 Windows 平台的属性。**
换成 .NET 栈，这条路**有官方教程可抄**。

### 8.3 §4.2 用生态数字（2.8%）描述 heyta 的缺口 —— 实际只有 **4 个**原生库

§4.1 的 2717/73/54 复核**一致**（`windows` present=**73**、`macos` present=**54**，
总条目 **2717**）。但那个数字**不是 heyta 的暴露面**。实测 `apps/mobile/package.json` 逐个查：

| heyta 的原生依赖 | RN Directory 声明 Windows | 上游仓库 `windows/` 目录 |
|---|---|---|
| `@op-engineering/op-sqlite` | ❌ | ❌ HTTP 404 |
| `react-native-safe-area-context` | ❌（不在 Directory） | ❌ HTTP 404 |
| `react-native-get-random-values` | ❌（不在 Directory） | ❌ HTTP 404 |
| `react-native-svg` | ❌（不在 Directory） | ✅ **HTTP 200** |
| `fast-text-encoding` / `lucide-react-native` | — | 纯 JS，无原生代码 |

复现：

```bash
# 1) 生态计数（与 §4.1 一致：73 / 54）
curl -sL https://raw.githubusercontent.com/react-native-community/directory/main/react-native-libraries.json \
  | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));
             console.log("total",l.length,"windows",l.filter(x=>x.windows).length,
                         "macos",l.filter(x=>x.macos).length)'
# 2) 每个仓库有没有 Windows 实现
for r in software-mansion/react-native-svg th3rdwave/react-native-safe-area-context \
         LinusU/react-native-get-random-values OP-Engineering/op-sqlite; do
  echo "$r -> $(curl -sL -o /dev/null -w '%{http_code}' https://github.com/$r/tree/main/windows)"
done
```

⇒ **C2 的真实规模是 3 个库的缺口**，其中 `safe-area-context`（桌面窗口没有刘海）
与 `get-random-values`（可退化为纯 JS）属于**可替换**而非"重写原生模块"。

⚠️ **别手抄这几个数字** —— 2026-09-28 把它做成了脚本：

```bash
node research/tools/windows-native-gaps.mjs
```

脚本刻意**不自动判定"哪个包是原生模块"**（按"上游有没有 `windows/` 目录"一刀切
会把 `react` / `fast-text-encoding` / `lucide-react-native` 这些**纯 JS** 包也报成缺口，
实测第一版报了 7 个 —— **会撒谎的数字比没有数字更糟**），
原生清单显式手维护，脚本负责证明清单没过期。

### 8.4 §1 结论 2 与 §7.2 推荐顺序的现状

| 本文原结论 | 2026-09-28 之后 |
|---|---|
| 结论 2「Windows 版本上完全可行，但代价在别处」 | ⚠️ **改为**：可行**仅在把移动端一起冻在 RN 0.84.1 的前提下** —— 那个前提不成立（§8.1） |
| §7.2「系统小组件是硬需求」时的优先级 1/2/3 | ⚠️ 该排序建立在"代码量是判据"之上；在"原生优先、代码量不设上限"下重排，见 [多端原生构建计划](../plans/desktop-native-migration.md) §1、[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §2 |
| 结论 5「UI 复用度被严重高估」 | ✅ **仍然成立**，且是 §8.2/§8.3 的背景 |

---

## 附：来源

**仓库一手（LICENSE / README / 源码，2026-09-27 实测）**

- `react-native-macos` LICENSE：<https://raw.githubusercontent.com/microsoft/react-native-macos/main/LICENSE>（MIT，Copyright (c) Meta Platforms, Inc. and affiliates.）
- `react-native-windows` LICENSE：<https://raw.githubusercontent.com/microsoft/react-native-windows/main/LICENSE>（MIT，Microsoft Corporation and contributors）
- `react-native-macos` README：<https://raw.githubusercontent.com/microsoft/react-native-macos/main/README.md>
- `react-native-windows` README：<https://raw.githubusercontent.com/microsoft/react-native-windows/main/README.md>
- 提交日期：两仓库 `main` 分支 `commits/*.atom`（macOS 2026-09-01T16:19:47Z；Windows 2026-09-26T17:53:19Z）
- Fabric 源码存在性：`raw.githubusercontent.com/microsoft/react-native-macos/main/packages/react-native/React/Fabric/...`（均 HTTP 200）
- 库生态计数：<https://raw.githubusercontent.com/react-native-community/directory/main/react-native-libraries.json>

**npm registry（版本 / peerDeps / 发布日期）**

- <https://registry.npmjs.org/react-native-macos>（latest 0.81.9，2026-07-13；peerDep react-native 0.81.6）
- <https://registry.npmjs.org/react-native-windows>（latest 0.84.0，2026-06-18；peerDep react-native 0.84.1）
- <https://registry.npmjs.org/react-native>（latest 0.87.1，2026-08-26）

**Microsoft 官方文档**

- RNW Support Policy / Support Matrix：<https://microsoft.github.io/react-native-windows/support/>
- RNW Get Started（New Arch only / 打包 APPX）：<https://microsoft.github.io/react-native-windows/docs/getting-started/>
- RNW New vs. Old Architecture（含 `cpp-app` 自带 Packaging project、C# 不支持、Flyout/Popup/Glyph）：<https://microsoft.github.io/react-native-windows/docs/new-architecture>
- RNW init-windows 模板表：<https://microsoft.github.io/react-native-windows/docs/init-windows-cli>
- RNW 发布到 Microsoft Store（自我标注为旧架构文档）：<https://microsoft.github.io/react-native-windows/docs/app-publishing/>
- RNW Supported Community Modules（指向 RN Directory）：<https://microsoft.github.io/react-native-windows/docs/supported-community-modules/>
- Windows widget provider manifest 格式（"only packaged apps"）：<https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-provider-manifest>
- 实现 widget provider（C++/WinRT，含 comServer + appExtension + packaging project）：<https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-win32>
- MSFT 官方 Q&A：unpackaged 单 exe **"It is not possible at present"**：<https://learn.microsoft.com/en-us/answers/questions/1319697/how-to-use-widgets-for-windows-desktop-application>
- PWA widget（一手 + PWAmp demo）：<https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/widgets>
- winapp CLI + Tauri（add package identity, package as MSIX）：<https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri>

**Microsoft / Meta 官方博客**

- RNW v0.82（Paper 移除）：<https://devblogs.microsoft.com/react-native/%F0%9F%9A%80react-native-windows-v0-82-is-here/>
- RNW v0.81（New Arch 默认）：<https://devblogs.microsoft.com/react-native/%F0%9F%9A%80react-native-windows-v0-81-is-here/>
- Messenger Desktop 从 Electron 迁到 React Native（80% JS 复用 / 桌面缺口）：<https://developers.facebook.com/blog/post/2023/05/17/messenger-desktop-faster-and-smaller-by-moving-to-react-native-from-electron/>

**macOS 组件分发（关键一条的支撑）**

- `tauri-plugin-widgets` macOS setup（Developer ID → Widget visible **Yes** → Direct distribution；extension 必须 sandbox；`widgetContainer` transport 要求宿主不 sandbox）：<https://s00d.github.io/tauri-plugin-widgets/guide/setup/macos>
- `tauri-plugin-widgets` Windows setup（生成 C# `IWidgetProvider` + manifest 片段 + DevCert）：<https://s00d.github.io/tauri-plugin-widgets/guide/setup/windows>
- CodexBar #1173（Developer ID + 公证 + Homebrew；`.appex` 已注册但不出现在组件库；`Extension is not entitled to run in the App Sandbox`；已 Closed）：<https://github.com/steipete/CodexBar/issues/1173>
- CodexBar #2838（2026-08-10，组件已出现在组件库并能渲染）：<https://github.com/steipete/CodexBar/issues/2838>
- Apple，Configuring app groups（⚠️ 正文抓取失败，仅存链接）：<https://developer.apple.com/documentation/xcode/configuring-app-groups>
- Apple，Continuity 要求：<https://support.apple.com/en-us/108046>

**其他一手/权威二手**

- react-native-macos Get Started（"same minor version"、`^0.81.2`）：<https://microsoft.github.io/react-native-macos/docs/getting-started>
- react-native-macos #2901「Road to 0.83」开放 tracking issue：<https://github.com/microsoft/react-native-macos/issues/2901>
- op-sqlite Installation（"runs on iOS, Android, macOS and web"）：<https://op-engineering.github.io/op-sqlite/docs/installation/>
- op-sqlite #43 Windows 支持（open，`help wanted`）：<https://github.com/OP-Engineering/op-sqlite/issues/43>
- Uno Platform，「Which React Native you actually get on Windows and macOS」（版本差距与支持口径的二手汇总，⚠️ 竞品视角）：<https://platform.uno/articles/react-native-windows-macos-versions-vs-dotnet-lts/>
