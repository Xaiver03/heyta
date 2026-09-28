# 多端选型：小组件视角的证据与建议

> 状态：**调研结论，未拍板**（选型决策本身应由产品负责人拍板并落 ADR）
> 用途：这是**多端选型计划的输入**。本文件回答一个问题：**"每个非浏览器平台都要有系统小组件"这条需求，会不会改变壳体选型？**
> 相关：[native-widgets.md](native-widgets.md)（平台事实）、[multi-platform-widgets.md](../plans/multi-platform-widgets.md)（执行计划）
>
> 🔴 **已与 [ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md)（UI 收敛 = RN + react-native-web；桌面壳 = Electron；状态：待确认）对账 —— 见 §10。**
> 那份 ADR 有一条承诺与小组件**直接冲突**，必须显式划界，否则会被误当成"组件也该收敛成一份"。

---

## 0. 一句话结论

**不会改变选型 —— 因为小组件在每个平台都必须是该平台的原生 UI，任何框架都不能把组件 UI 变得可移植。**
但它会改变**成本模型**，而且比直觉便宜：真正要写的是 **3 份组件 + 1 个 JSON 模板**，不是 5 份。

---

## 1. 决定性证据：组件 UI 不可移植，只有"契约"可共享

这条不是推测，是**本仓库内的一手工程记录**。

heyta 的 op-log 从 Super Productivity（MIT）vendored 而来，而它**真的把同一款任务组件在 Android 与 iOS 上各实现了一遍**，并留下了完整记录：

| | Android | iOS |
|---|---|---|
| 快照存放 | `KeyValStore` blob（SQLite） | App Group `UserDefaults(suiteName:)`，同 key、同 JSON |
| 渲染 | `TaskListWidgetProvider` + `RemoteViewsService` + XML | WidgetKit `TimelineProvider` + SwiftUI |
| 应用侧写入 | `JavaScriptInterface.saveToDbWrapped` | 本地 Capacitor 插件 `setWidgetData(json)` |
| 勾选回写 | `WidgetDoneQueue`（SharedPreferences） | `AppIntent` 写同一个 `{taskId, targetIsDone}` 映射 |
| 排空触发 | `onResume$` + LocalBroadcast | Capacitor `resume` |
| 深链 | header/row → 启动 activity | `widgetURL` |

**在这张表里，被共享的只有 `v: 1` 的 JSON 契约。视图、渲染、点击回写、后台触发——每一栏都是两端各写一遍。**

> 出处：[super-productivity 的 iOS 移植方案](../../research/upstream/super-productivity/docs/plans/2026-07-07-ios-home-screen-widget-port.md) §"Architecture mapping"、[Android 组件维护指南](../../research/upstream/super-productivity/docs/android-home-screen-widget.md)

**推论**：选型判据里**不该有"哪个框架有小组件"这一条**——所有框架的组件成本都 ≈ N 份原生 UI。该有的是"这个壳体组合把 N 压到多小、以及平台有没有自带捷径"。

### 1.1 技术根因（研究线补充，比"框架不支持"更根本）

**组件进程里跑不了你的「完整应用运行时」。** 这不是框架能力问题，是平台的硬约束：

| 平台 | 约束 | 后果 |
|---|---|---|
| iOS | widget extension 有约 **30MB 内存上限**；**扩展内嵌框架会被 App Store 校验拒绝** | 链接一个 Kotlin 框架会被系统杀掉 → **跑不了 Kotlin/KMP 那类重运行时** |
| Android | 组件在**应用未运行时被唤醒**，无 React context / app state | 渲染时不能假设应用状态已在内存里 |
| 鸿蒙 | 卡片进程**不能常驻后台**（FormExtensionAbility 回调后仅存活 10 秒） | 同上 |

→ **所有成熟方案共享的都是「数据/状态」，不是 UI。**

🔴 **但"跑不了运行时"要说准，否则会过度推论**（我初稿犯过这个错）：被拒绝的是**重原生运行时**，不是**一切运行时**。两条反证：

- **`expo-widgets` 恰恰把 widget 代码编译成独立 JS bundle，跑在 iOS 组件扩展内的隔离运行时里** —— 但那个运行时是**残废的**：**无 hooks、无 app state、无异步、连模块级 `const` 都读不到**，数据只能由 `updateSnapshot` / `updateTimeline` 传入。
- **`Voltra` 用一份 JSX 同时覆盖 iOS 与 Android 组件**（iOS→SwiftUI、Android→Glance）。

**所以正确的表述是**：你可以把**一个受严格限制的 JS bundle** 放进组件，但**放不进应用那套 React 组件树与状态**。这正是 §2「共享数据契约、不共享 UI」的准确理由 —— 不是"技术不可能"，而是**"组件里那份 UI 必须按平台语义重写一遍，即使语言相同"**（SwiftUI 语义 vs Glance 语义 vs ArkUI 语义）。

> **另一条被否掉的聪明路**：`home_widget.renderFlutterWidget` 那类"把 UI 渲染成 PNG 再喂组件"确实存在，但官方文档写明 —— 由于 `dart:ui` 限制，**应用完全在后台时此方法不可用** → 组件**无法自己更新**。
> 同类：`react-native-android-widget` 的 JSX 也是**先画成 Bitmap** 再 `RemoteViews.setImageViewUri` —— 它得到的是**一张图，不是活视图**，且渲染跑在 **Headless JS（30 秒超时）** 里，需在 handler 内重新取数。

---

## 2. N 不是 5，是 3 + 1

| 平台 | 组件实现 | 语言 | 能否共享 |
|---|---|---|---|
| iOS | WidgetKit + SwiftUI | Swift | 🔶 **与 macOS 共享源码**（同一份 SwiftUI 视图 + timeline 逻辑；产物按各自 app 分别构建） |
| macOS | WidgetKit + SwiftUI | Swift | 🔶 同上 —— **零新增组件代码** |
| watchOS | WidgetKit accessory | Swift | 🔶 逻辑可共享，family 不同、target 单独 |
| Android | AppWidget（RemoteViews 或 Glance） | Kotlin | ❌ |
| 鸿蒙 | 服务卡片 | ArkTS | ❌ |
| **Windows** | **Adaptive Card 模板 + JSON 数据** | **JSON** | ❌ 但**它不是一份 UI 代码库**，是模板 |

→ **真正要写的原生组件代码是 3 份**（Swift / Kotlin / ArkTS），Windows 是 1 个数据模板。

⚠️ **Apple 共享这条已获真实产品验证，但边界仍未完全核实**：
✅ **Things 3（Cultured Code）用同一套 WidgetKit 代码覆盖了 4 个 Apple 平台** —— iOS 桌面/锁屏、macOS 桌面、watchOS 智能叠放（[官方支持页](https://culturedcode.com/things/support/articles/2803567/)、[watchOS 智能叠放](https://culturedcode.com/things/support/articles/2157909/)）。这是**唯一一个"一端代码多端复用"的真实案例**，而且仅限 Apple 生态内部 —— 恰好印证 §2 的判断。
⏳ 仍待核实：**哪些能进同一个 target、哪些必须分 target、`supportedFamilies` 差异的确切清单**。

---

## 3. 成本模型：每平台"第一次"贵，变体便宜

这是理解"滴答清单凭什么能在 iOS 上做十几款组件"的关键。

上游 iOS 移植的**真实工时拆分**（~2–4 focused days）：

| 项 | 占比 |
|---|---|
| Xcode target + App Group + 门户 + CI 签名 | **~0.5–1 天**（纯摩擦，无逻辑） |
| 扩展 + 桥接插件（Swift ~250–400 行 + ~100 行） | ~1–1.5 天 |
| 状态层泛化 + 测试（~100–150 行） | ~0.5 天 |
| 真机测试 | 其余 |

**注意第一行**：可观的成本花在**签名、容器、工程结构**上，与"组件有几个"无关。
再叠加两道已就位的红利：

- **设计系统已经在产出 `HeytaTokens.swift`（SwiftUI）与 `HeytaTokens.ets`（ArkUI）** —— 各端组件的配色/尺寸一致性成本 ≈ 0，且不违反"唯一事实源"
- **一个扩展/Provider 可容纳多个组件**（WidgetKit `WidgetBundle`、Android 多个 `AppWidgetProvider`、鸿蒙多个卡片配置共用一个 ability）

**结论**：v1 每平台只做 **1 款**，目的是把一次性成本付掉；之后每加一款变体 ≈ 一个视图 + 一个 golden fixture 用例。**这正是"先做一款、不要先做生成器"的量化理由。**

---

## 4. ADR-0004（React Native）不受影响 —— 但有一条诱惑要主动拒绝

ADR-0004 已定 RN，硬约束是"留在 JS 生态 + 不用 WebView 套壳"。**小组件不与之冲突**：组件 UI 本来就得各端原生写。

🔴 **移动端确实有「用 JS/TS 写组件」的现成库，但每一个都有硬约束；而且鸿蒙那一端无解。**

| 库 | 覆盖 | 许可 | 机制与硬约束 |
|---|---|---|---|
| **`Voltra`** | iOS + Android | **MIT**（2026-09-22，2.3.2） | **一份 JSX 覆盖两端**（iOS→SwiftUI + Live Activity + 灵动岛；Android→Glance）。🔴 **裸 RN 支持标记为 Experimental** |
| **`expo-widgets`** | **仅 iOS** | MIT（58.0.7 / 2026-09-25） | widget 代码编译成**独立 JS bundle**跑在扩展内的隔离运行时：**无 hooks / 无 app state / 无异步 / 读不到模块级 `const`**；且 heyta 不在 Expo 上 |
| **`react-native-android-widget`** | **仅 Android** | **MIT**（0.22.1 / 2026-08-17） | JSX → 真实 Android View → **画成 Bitmap** → `RemoteViews.setImageViewUri`。**得到的是图不是活视图**，渲染跑在 **Headless JS（30 秒超时）**；见下 |
| **`@bacons/apple-targets`** | Apple（仅生成 target） | MIT（⚠️ **仓库根目录无 LICENSE，凭证在 npm 包内** —— 两条研究线各看到一半，合并结论是"npm tarball 有、repo root 404"） | **只生成 Xcode target，SwiftUI 仍要自己写** |
| **`react-native-widget-extension`** | iOS | 🔴 **仓库与 npm 包都没有 LICENSE 文件**（仅 `package.json` 声明 MIT） | **按 AGENTS.md §3.2 视为不合格**，且 README 自认 "widgets still need to be written in Swift" |

🔴 **`react-native-android-widget` 这条路要明确拒绝，理由是架构而非质量**（它是 MIT、维护活跃、Expo 官方教程在用）：它的模型是 **headless JS**（`registerWidgetTaskHandler` → 在后台 JS 上下文里 `renderWidget`）。

那等于**把应用 JS（连带 op-log 的形状）拖进一个后台进程**，恰好是"单写者快照 + 意图队列"这套契约存在的理由所在。再加两条：**渲染产物是位图**、**30 秒超时**。→ **Android 组件用 Kotlin 写。**

**Flutter 同理且更差**：`home_widget` 是 **BSD-3-Clause（不是 MIT）**，README 明确**不允许用 Flutter 写组件**，iOS/Android 仍须 SwiftUI/Kotlin。

**KMP 直接出局**：Compose 进不了 WidgetKit 扩展进程；且 🔴 **Kotlin/Native 官方 target 列表里没有 ohos/harmony**，社区移植 `Kotlin-OHOS` **最后提交 2024-09-19（已死）**。

> **三端合并的现成抽象不存在。** `Voltra` / `WARP` / `home_widget_generator` 都只覆盖 iOS+Android，**鸿蒙那份必然单独写 ArkTS**。这独立印证了 §6。

> 另注：上游用 **Capacitor** 做移动壳，而 heyta 已在 ADR-0003 §3.2 否决 WebView 套壳（iOS 会清理 WebView 的 IndexedDB）。所以**上游的移动壳方案不能照搬**，能照搬的是它的**组件契约**。

---

## 5. 桌面：两条"捷径"**都不是免费午餐**（本节已按研究线结果修正）

> 🔴 **修正记录**：本节初稿把这两条写成"不需要壳就能白拿覆盖"。**实证下来一条被降级、一条被我归因错了**，逐条重写如下。

### 5.1 Windows PWA widget —— **降级能用**，不是干净的一刀

技术上真实存在、且**确实不需要写原生代码**（微软官方："a packaged Win32 desktop app **or a Progressive Web App (PWA)**"）。但有四个必须接受的代价：

| 代价 | 证据 |
|---|---|
| 🔴 **它是 Edge 独占的非标准能力** | `widgets` manifest 成员**既不在 W3C Web App Manifest 规范，也不在 Chromium 源码**（`manifest_parser.cc` / `manifest.mojom` grep "widget" = 0 命中）→ **Chrome 装的 PWA 没有组件**，只有 Edge 有 |
| 🔴 **刷新下限是 12 小时** | Chromium 源码级证据：`kMinPeriodicSyncEventsInterval = base::Hours(12)`，实际间隔 = 12h × 互动度系数（HIGH/MAX=1→12h，LOW/MED=2→24h，MINIMAL=3→36h，NONE→**永不**）；且桌面端 OS 级唤醒是 `#if IS_ANDROID` → **Windows 上必须 Edge 进程活着**。**"今天的任务列表"走 PBS 必然过期。** 唯一补救：**Web Push 触发 SW 调 `widgets.updateByTag`**（官方点名支持） |
| **UI 要重画一遍** | 组件不是 HTML，是 **Adaptive Card 模板 + JSON**；官方原话：an existing PWA *cannot simply be placed into the widget dashboard as-is* |
| 🔴 **本地安装的可靠性未证实** | 文档**没有**说必须上 Store（官方 demo 就是"Edge 里安装 → Win+W → Add widgets"），但 2023 年有"**5 台机器仅 1 台**出现组件 + 微软支持称该功能 *experimental and not yet widely supported*"的记录，且 **2025–2026 没有任何正面实测报告** → **上线前必须自己实测** |

⚠️ **别混淆另一套机制**：`web-widget-providers`（HTML 内容型）**不是 PWA 路径** —— 它要求 Win32 packaged app，且文档明写仅限 **EEA** 用户。我上轮把它的入口列为捷径候选，那是错的。

### 5.2 macOS Continuity —— 对 heyta **可达，但它不是捷径，是 iOS 工作的副产品**

**我上轮的归因错了。** 准确说法是：

- Apple 原文要求组件来自 **"apps installed on your iPhone"** → **必须先有一个带 WidgetKit 扩展的原生 iOS App**。
- 🔴 **研究线据此判定"对纯 Web 产品是死路"，但这个判定对 heyta 不成立** —— heyta **已经有 iOS 壳**（`pnpm build:ios` → `HeytaMobile.app`，模拟器实测通过，见[构建矩阵](../reference/build-matrix.md) §7）。所以这条路**可达**，只是它**不在 iOS 组件（W2）之前，而在之后**。
- 所以正确的成本归属：**macOS 桌面组件 = W2 的副产品**（W2 做完，Mac 侧近乎白得），**而不是一条绕开原生工作的独立路径**。

必须写清的降级事实：

- 要求：iOS **17+** / macOS **Sonoma 14+** / **Mac 所有型号（不需要 Apple Silicon）** / 同一 Apple Account / iPhone 在附近或同 Wi-Fi / 用户手动开启 `系统设置 → 桌面与程序坞 → 小组件 → 使用 iPhone 组件`
- 🔴 **交互在 iPhone 上执行**：Apple 原文 —— 点击第三方组件会提示 *"Open [app name] on your iPhone to continue"*；macOS 15+ 则在 **iPhone Mirroring 窗口**里打开。**Mac 只是显示器 + 转发器。**
- 开发者侧**没有任何 opt-out 开关**（未见 Info.plist / entitlement 级控制）
- ❌ **我上轮引的链接已失效**（`mchl3e281fc9` 已重定向到别的内容）。现行正确页面：<https://support.apple.com/en-us/guide/mac-help/mchl52be5da5/mac>
- 🔴 **与"锁屏隐藏内容"硬互斥**：Apple《WidgetKit security》写明，给 widget extension 加 Data Protection capability 设 `NSFileProtectionComplete` 后系统会在锁屏显示 placeholder，**但这类组件不能再作为"Mac 上的 iPhone 组件"**。→ **Continuity 覆盖 macOS 与"锁屏安全"只能选一个**（见 §7 决策 3b）

### 5.3 ✅ 我最大的未知数已解决：Developer ID + 公证 + 直接分发**能**带 WidgetKit 组件

**"自嵌 `.appex` 只能走 Mac App Store"这个流传很广的限制是错的。** 三条证据，强度递增：

1. **Apple 官方规范**：app extension 在 macOS 放 `Contents/PlugIns/`，且"an app may contain an app extension" —— [Placing content in a bundle](https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle) **全文无任何 MAS-only 限制**。
2. 🔴 **三个真实的 Developer ID + 公证 + DMG/Homebrew 直接分发的 macOS 应用，都带可用的组件**：Claudemon、DevWifiBar、**Ping Warden**。
3. 🔴 **最硬的一条**是 Ping Warden 的 release notes 原文：共享设置改用 **Team-ID 前缀的 macOS App Group**，"restoring reliable persistence on macOS 15 and later **without an embedded provisioning profile**" —— **"不需要 MAS 描述文件"的直接反证**。

⚠️ **但"可行"≠"好做"**：CodexBar #1173 同样是 Developer ID + 公证 + Homebrew，组件被 PlugInKit 正确注册且已启用，**却始终不进组件库**（`chronod` 卡在 `extensionsPendingDescriptorRefetch`，日志报 `Extension is not entitled to run in the App Sandbox`）。根因未定论 —— 说明**sandbox / entitlement 对齐是真实的坑**（该案例卡了约 2.5 个月）。

**而且这条路与桌面壳无关**：组件只能用 SwiftUI 写、必须由 Xcode target 编译。**Electron/Tauri 的 React UI 一行都复用不进组件。**

### 5.4 🔴 Electron 在**两端都是组件最差项** —— 但这不推翻 ADR-0024

| 候选 | macOS 组件 | Windows 组件 | 证据强度 |
|---|---|---|---|
| **Electron** | ⚠️ 理论可行、**零官方支持** | ⚠️ 需 MSIX + 另写 C#/C++ provider | **最差**：① `electron/electron#35751`「macOS Notification Center Widget」**Closed as not planned**；② electron-builder 官方文档原文 —— 它检查 `app.asar.unpacked` 和 `Contents/PlugIns`「**(which electron-builder never re-signs)**」→ 自嵌 appex **必须自己写 afterPack/afterSign 钩子全手工签**；③ **找不到任何真实 Electron 应用带 WidgetKit 组件** |
| **Tauri** | ⚠️ **有 1 个真实项目做成过** | ⚠️ 同上（插件生成 C# provider） | `tauri-plugin-widgets` 的 signing 表明写 `Developer ID → Widget visible → appGroup → Direct distribution`。**但该插件是单人项目：24 star / 0 fork / 最新版 112 次下载** → 🔴 **不能当承重墙** |
| **原生（SwiftUI + WinUI/MSIX）** | ✅ **一手规范 + 3 个真实应用** | ✅ 官方唯一完整路径 | 唯一一等公民；代价是两套壳 + 两套原生组件 UI + **两套互不复用的发布流程** |

**关键区分（避免误导）**：ADR-0024 选 Electron 的决定性理由是**同步存储 IPC**（§10.1 我确认成立），**与组件无关**。所以：

> **组件不推翻 Electron，但它让"Electron 里长出原生桌面组件"成为最贵的一条路。**
> 好在**两条能用的桌面组件路径都不经过壳** —— Windows 走 PWA provider、macOS 走 Continuity。壳选谁，桌面组件都照拿。

### 5.5 Windows 的两条补充事实

1. **PWA 路径仍然是 Windows 独有的**：iOS / Android 上 PWA **不能**有系统组件（三个独立来源一致）；macOS Safari web app **也没有**任何组件机制。所以 PWA 只解决 Windows。
2. **`sparse package`（packaging with external location）是一条新线索**：官方说它解锁 "app extensions" 且**不必改用完整 MSIX、可保留原安装器** —— 若能用于 widget appExtension，则 Electron/Tauri 在 Windows 上不必被迫换打包方式。🔴 **但官方没有点名 widget，是否适用未核实**（见 §9）。
3. **Apple 的刷新预算是官方的、有数字的**：常用组件每天约 **40–70 次**（≈每 15–60 分钟一次）—— [Keeping a widget up to date](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)。这条修正了我此前"Apple 未公开"的说法：**公开的是预算，不是时间窗口**。

### 5.4 修正后的桌面结论

**组件仍然不该驱动桌面选型**（§1–§4 的结论不变，而且 ADR-0024 已按"同步存储"这条无关理由选了 Electron）。

但**"桌面覆盖是白拿的"这个说法要撤回**：
- **macOS**：靠 Continuity，可达，但**依赖 iOS 组件先做完**，且交互回到 iPhone
- **Windows**：靠 PWA，不需要原生代码，但 **Edge 独占 + 刷新下限 12h（需 Web Push 补救）+ 本地安装可靠性待实测**
- **想要不降级的桌面组件，就必须有桌面壳 + 平台组件载体**，而 macOS 那条还压着一个未实测的签名问题

---

## 6. 鸿蒙：卡片**官方就封死了跨平台** —— 建壳对卡片收益为 **0**

### 6.1 官方明文（这条把 §6 从"建议"升级成"规定"）

华为官方 Form Kit 文档原文：

> **「当前仅支持基于 ArkUI 框架开发卡片，暂不支持跨平台开发」**
> **「不支持使用 native 语言开发，不支持加载 native so」**

出处：[官方 Form Kit 概述](https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/form/arkts-form-overview.md)

🔴 **结论比"可以解耦"更强**：**卡片 UI 只能是 ArkTS。无论选 RN 还是 Flutter 壳，卡片都得手写 ArkTS —— 为"有卡片"去建 RN/Flutter 壳，收益为 0。** 所以鸿蒙卡片**必须**与壳解耦，这不是策略选择，是平台约束。

### 6.2 刷新：定时刷新有配额，但**主动推送无次数限制**（修正我此前的说法）

| 通道 | 限制 |
|---|---|
| **定时刷新** | **每张卡片每天最多 50 次**，0 点重置；粒度最小 30 分钟；`setFormNextRefreshTime` 最短 5 分钟且**计入这 50 次** |
| 🔴 **应用主动 `formProvider.updateForm` 推送** | **官方：「目前没有次数限制」** |

→ **我此前写的"实时在鸿蒙卡片上不成立"是错的。** 定时刷新确实不够，但**推送不受配额限制** → 只要应用（或共享数据的元服务）在跑，就能推近实时状态。出处：[被动刷新官方文档](https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/form/arkts-ui-widget-passive-refresh.md)

另：**FormExtensionAbility 进程不能常驻** —— 生命周期回调后**再存活 10 秒即退出**；超过 10 秒的业务官方建议"拉起主应用"。

### 6.3 数据通路：卡片读不到沙箱，但 FormExtensionAbility 能读

- **卡片 UI 进程**：与应用是**独立进程**，只能靠 `LocalStorageProp` 传数据，**不能用 `getContext`** → **卡片不能直接读 preferences / 文件**
- **FormExtensionAbility**：跑在**应用进程**里 → **能**用 `preferences.getPreferencesSync` 读（含跨进程坑：要 `on('multiProcessChange')` + `removePreferencesFromCache`，否则读到缓存旧值；单 key ≤1MB）

→ 这恰好落回 heyta 已有的"**单写者快照 + 推送**"契约：应用写偏好项快照 → FormExtensionAbility 读出来 `updateForm` 推给卡片。

### 6.4 三条壳路线（版本与能力实测）

| | RN 鸿蒙（RNOH） | Flutter OH | 原生 ArkTS |
|---|---|---|---|
| 版本 / 许可 | npm `@react-native-oh/react-native-harmony` **0.84.4**（2026-09-24，**MIT**，138 版本）+ ohpm `@rnoh/react-native-openharmony` **0.84.3** | GitCode `CPF-Flutter/flutter_flutter`，**BSD-3-Clause**，基于 Flutter 3.35.7（2026-09-24；**落后上游约 4 个月**） | 华为官方，随 HarmonyOS 走（本机 SDK **6.1.1 / API 24**） |
| 能编包 | ✅ 实测（release HAP 20MB） | 未验 | ✅ 实测（126KB） |
| **真跑** | ❌ 未验证（缺镜像 + 签名） | ❌ 未验证 | ❌ 未验证 |
| **服务卡片** | 🔴 **框架渲染不了，仍需手写 ArkTS** | 🔴 **同上** | ✅ **Form Kit 一等公民** |

**本机实测环境**：`/Applications/DevEco-Studio.app` **6.1.1.300** 在；SDK = HarmonyOS 6.1.1 / API 24；🔴 **`~/.Huawei` 存在但完全为空** → **没有模拟器实例、没有系统镜像**（需 Device Manager GUI 下载）。

### 6.5 元服务（免安装）路线 —— 可独立上架，但装不下 RN 壳

✅ **官方确认元服务「可独立上架、分发、运行，独立实现业务闭环」，不需要先有完整 App。**

🔴 **但它塞不进 RN 壳**：元服务压缩后**单包 ≤2MB / 总包 ≤10MB**，而 RNOH 的 release HAP 实测 **20MB** → **事实上不可行**（此为推断，非官方结论，见 §9）。

其他必须知道的约束：

- **只能 ArkTS 卡片**（不支持 JS 卡片），整个元服务**最多 16 张卡片**
- **不得从卡片直接跳转到其他应用或其他元服务**
- **必须在 AGC 配置服务器域名**（HTTPS/WSS，**不能用 IP/localhost**；未配置会被域名管控拦截）
- 🔴 **审核要求"使用华为账号登录是元服务的基本要求"** → 对一个**可自建**的产品，这是一条**产品级约束**，需要单独拍板（E2EE 本身不违规）
- ✅ 一条好消息：系统老化元服务时**优先清理"长时间未使用且未添加桌面卡片"的** → **有桌面卡片反而是抗老化保护**

### 6.6 最小可验证步骤（不碰 RN 壳）

1. DevEco 新建**元服务工程**（不是 Application）→ 新建 **Dynamic Widget** → 写一个 2×2 卡片显示"今日 N 个任务" + 一个 `postCardAction(message)` 按钮 → FormExtensionAbility 在 `onFormEvent` 里改 Preferences 再 `formProvider.updateForm` 推回。**跑通 = "鸿蒙上真能出卡片"被验证。**
2. 下模拟器镜像 + 注册模拟器调试凭据，确认**卡片能在模拟器上被添加**。⚠️ **这条是真正的卡点**：华为文档**没有明文**说模拟器能添加/渲染服务卡片（见 §9）。
3. 再决定要不要 RN 壳。

⚠️ **要做"卡片上勾选完成"，必须用动态卡片**（静态卡片只有 UI + `FormLink`，不支持 `postCardAction`）。卡片内**不支持**：`setTimeout`、HSP、native so、断点调试、热重载，且导入 particleAbility/audio/camera/media/backgroundTaskManager 等 Kit 会**直接 JS crash**。

🔴 **E2EE 含义**：卡片数据只能以**明文偏好项/快照**形式由提供方持有再推送 —— 与 §7 决策 1 是**同一件事**，需要一次 ADR 显式记录。**不要把卡片数据源指向加密 SQLite**（卡片读不到，FormExtensionAbility 也跑不了 JS/op-log）。

---

## 7. 真正需要拍板的决策

| # | 决策 | 结论 / 为什么是现在 |
|---|---|---|
| 1 | 🔴 **快照是明文还是设备密钥加密** | ✅ **研究线已给出有证据的倾向：(b) 设备密钥加密快照 + 组件内一次 AES，不用明文。** 依据：两个真正做内容组件的 E2EE 产品**都走 (b)**（Tuta：AES + `databaseKey`；Proton iOS：共享 Keychain 主密钥 + AES）；**唯一走明文的 Notesnook 不是正面参照**。详见 [E2EE 组件密钥处理](e2ee-widget-key-handling.md) |
| 2 | **组件里要不要解密** | 🔴 **要，而且这是 (b) 的真实成本 —— 但它比想象中小**：**Argon2id 从未进过任何组件**（四个实现无一例外），组件里**只有一次对称 AES**，密钥由应用侧**预派生好**放进共享 Keychain/Keystore。代价是两端各多一个原生模块 + **设备密钥生命周期要单独设计（需要一条 ADR）**。<br>⚠️ 我此前把"组件解密 = 新增 Swift/Kotlin/ArkTS 加密实现"当作**选明文的有力论据** —— 现在证据反过来了：真实产品都接受这个成本，且 ADR-0003 §2.3 的互操作测试要求本来就要还 |
| 3 | 🔴 **锁屏可见性 —— 与决策 1 正交，不要混为一谈** | **加密快照只解决"静态泄露"（备份 / 越狱翻容器 / 取证镜像），不解决锁屏可见性。** Proton 的密钥在锁屏时**恰恰可读**（`afterFirstUnlockThisDeviceOnly`），它不泄露是因为**它不做锁屏组件**。首版建议一组"全不暴露"默认值：**① 不做锁屏组件；② Android 显式 `not_keyguard`；③ iOS 默认脱敏（只显"今天 N 条"）+ 内容显式 opt-in；④ 登出/换账号清空快照与密钥** |
| 3b | 🔴 **上面 ③ 有一个硬冲突必须先拍板** | iOS 用 `NSFileProtectionComplete`（Data Protection capability）能做到"锁屏隐藏内容"，但 Apple 同一页写明：**这类组件不能再作为"Mac 上的 iPhone 组件"** → **与 §5.2 的 macOS Continuity 捷径互斥，二者只能选一。** 这是本次调研发现的最贵的一个取舍 |
| 4 | v1 上哪几款 | 决定 §3 的生成器触发点 |
| 5 | 鸿蒙：跟 RN 壳 vs 独立元服务 | 两条路成本结构不同（见 §6） |
| 6 | 桌面壳 —— ✅ **已由 [ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md) 决定 Electron（待确认）**，且理由是"同步存储"、与组件无关 | 组件不参与这个决策；但它给 ADR-0024 补了三条未核实项（见 §10.2） |

---

## 8. 我的建议（待你的计划出来对照）

**针对选型本身：**

1. **不要把"有没有小组件"写进任何壳体的选型判据。** 它对所有候选中性，写进去只会制造错误权重。
2. **移动端保持 RN**（ADR-0004 不变），组件用原生写；明确拒绝 headless-JS 组件库。
3. **桌面壳决策照原计划独立评估，不要被组件催**；先用 Windows PWA 与 macOS Continuity 拿到两端的组件覆盖，代价是 `apps/web` 先做成 PWA（这本身对 Web 端也有独立价值）。
4. **鸿蒙卡片做成 RNOH 之外的独立部分**，把组件从"鸿蒙能不能跑"这个未验证风险里摘出来。
5. **不要现在做跨端组件生成器**；触发条件量化成"变体数 × 平台数 > 10"。

> 🔴 **勘误（2026-09-27 追加，W0-8）：上面第 5 条里的触发条件判不出来，已作废。**
> 按本仓库 [文档纪律](../README.md)（调研原则上冻结、结论有变时**新增勘误不改原文**），
> 原文保留在上面，更正写在这里。
>
> **"变体数 × 平台数 > 10" 的问题**：两个乘数**都没有定义**，而不同读法**横跨阈值** ——
> 4 个组件类型 × 2 端 = **8**（不触发）；× 3 个原生 UI = **12**（触发）；× 4 个载体 = **16**（触发）。
> **同一份文档换个读法结论就反过来**，于是"该做"和"不该做"双方都无法被证伪。
> 更根本的是这个量本身不对：**变体数不影响生成器的价值**
> （新增变体要么复用同一套布局、要么是新布局，生成器都帮不上抽象），
> 真正决定成本的是 **同一份布局要手写几遍**。
>
> **已替换为**（改在 [改造计划](../plans/multi-platform-widgets.md) 的「UI 生成器：先不做」一节，
> 那里是这条触发条件**实际生效**的地方）：
> 在进度账本里逐次记录「一次布局改动需要在几个载体各写一遍」，
> **累计出现 ≥ 5 次『同一布局在 ≥ 4 个载体各改一遍』的改动时**再评估生成器。
> 计的是**已经发生的事件**，不需要定义任何乘数，且可被外部核对。

**架构上（与 [改造计划](../plans/multi-platform-widgets.md) 一致）：**

- 契约、选择器、意图队列语义放进 `packages/widget-core`（纯 TS 零依赖，**类型上产生不了 op**）
- **一份 golden fixture 喂所有端解析器**（上游就是这么锁住 Kotlin↔Swift 两端形状的）
- 意图 → op 的唯一转换点在 `packages/app-host`（`actions.ts` / `host.ts` 所在处，符合 §3.5）
- **原生绝不重新推导"今天"**：应用发的是**判断结果**（`validUntil`），不是判断的输入。上游对此有长注释说明为什么 —— 因为原生**无论如何算不出来**（重复任务实例化、逾期结转都只在应用跑过之后才存在）

---

## 9. 待核实清单

> 图例：⏳ 研究线仍在外 · ✅ 已回填（结论见括号）

- ✅ **Developer ID（非 App Store）分发的 macOS 应用能否带 WidgetKit 扩展 + App Group** → **已回填：能。** Apple 规范无 MAS-only 限制 + **3 个真实 Developer ID 应用带可用组件**（Claudemon / DevWifiBar / Ping Warden），Ping Warden 原文写明用 Team-ID 前缀 App Group 且**无需 embedded provisioning profile**。⚠️ 真实坑是 **sandbox/entitlement 对齐**（CodexBar #1173 卡了 2.5 个月）（见 §5.3）
- ✅ **Windows PWA 组件的刷新频率** → **已回填：PBS 下限 12 小时**（Chromium 源码 `kMinPeriodicSyncEventsInterval`），且桌面端无 OS 级唤醒。**"当日任务"走 PBS 不成立**，须靠 **Web Push + `widgets.updateByTag`**（见 §5.1）
- ✅ **Windows PWA 组件是否必须走 Store** → **已回填：文档没这么说**，官方 demo 就是本地 Edge 安装；但只有 Store 路径被官方背书，本地安装有 2023 年翻车记录、2025–2026 无正面报告 → **必须自测**（见 §5.1）
- ✅ **Windows 原生组件是否必须 MSIX 打包** → **已回填：必须是 packaged 应用**（官方原文 "only packaged apps are currently supported"；未打包严格说不行）。注册走 `uap3:Extension Name="com.microsoft.windows.widgets"` + `CreateInstance`(CLSID→`CoCreateInstance`，实现 `IWidgetProvider`) 或 `ActivateApplication`
- 🔴 ⏳ **`sparse package`（packaging with external location）能否注册 widget 的 `windows.appExtension`** —— 官方说它解锁 "app extensions" 且**不必改用完整 MSIX、可保留原安装器**，但**没点名 widget**。**这条决定 Electron/Tauri 在 Windows 上要不要被迫换打包方式**
- ⏳ **PWA 路径只解决 Windows** —— iOS/Android 上 PWA 不能有系统组件（三源一致），macOS Safari web app 也无组件机制。**别再把它当跨平台方案**
- ⏳ **Electron 是否真的能自嵌 `.appex`** —— `mac.sign.binaries` 能否覆盖 `.appex` bundle 未核实，且**无任何真实先例**
- ⏳ **自建域名 PWA 用 Edge 本地安装后，组件是否稳定出现** —— 建议在 Win11 24H2/25H2 + 最新 Edge 上真机实测
- ⏳ **`widgets` 能力是否仍带灰度/flag**（Edge 108 时称 experimental，未找到 GA 公告）
- ⏳ **manifest `screenshots` 的确切尺寸** —— Edge 文档 `600×400` vs picker 文档 `300×304`，**口径冲突**
- ⏳ **`auth: true` 的语义**（认证态组件如何取数据）
- ⏳ **`widgetclick` 里能否 await 完 IndexedDB 写事务**（SW 生命周期；设计上应包 `event.waitUntil`）
- ⏳ **iPhone 不在附近时 Continuity 组件是显示缓存还是消失** —— Apple 未写，旁证两种都有
- ⏳ **E2EE 产品（Bitwarden / Proton / Standard Notes 等）实际怎么做组件**，尤其**锁屏泄露**与审计发现
- ⏳ **Apple 多平台 WidgetKit 共享的确切边界** —— 哪些能进同一 target、哪些必须分 target（✅ 真实案例已确认"一端代码多端复用"成立，见 §2）
- 🔴 ⏳ **RNOH 0.84.4 上 `@op-engineering/op-sqlite` + Hermes 的兼容性** —— **这是 heyta 鸿蒙壳的最大风险点**（`op-sqlite` 官方只列 iOS/Android/macOS/web，**不含 Windows，也未列鸿蒙**）
- ⏳ **鸿蒙是否存在 iOS App Group 等价的「应用 ↔ 卡片共享容器」** —— 未找到官方文档，只见 `preferences` / `AppStorage` / `formBindingData` 三条通路
- ⏳ **`Voltra` 的 iOS 首页组件生产案例 / RN 0.84 实测** —— 未找到；裸 RN 支持目前标 Experimental
- ⏳ `@bacons/apple-targets` 的授权凭证只在 npm 包内（repo root 无 LICENSE）；`react-native-widget-extension` **两处都无 LICENSE** → 按 §3.2 不合格
- **鸿蒙卡片：刷新配额的确切数字、能否读应用沙箱、元服务能否独立上架**
- 跨端组件抽象/代码生成的**真实失败案例**

## 10. 与 ADR-0024 对账（UI 收敛 = RN + react-native-web；桌面壳 = Electron）

ADR-0024 的证据链（同步 `SqliteDriver` → Tauri 只有异步 IPC → 排除 Tauri；Electron 有 `sendSync` + 自带 Node 24 的 `node:sqlite` → 直接复用已通过契约测试的 `NodeSqliteDriver`）**是成立的，我不反对**。§1–§9 的组件结论也不因此改变。

但有**一条冲突**和**两个空白**必须写进去。

### 10.1 🔴 冲突：ADR-0024 承诺"UI 只写一份"，而小组件是这条承诺的**唯一例外**

ADR-0024 §2.1 的结论是"UI 只写一份 React Native 组件，各端只提供渲染目标"。**小组件不能纳入这条收敛。** 三个理由，每一个都足以独立成立：

1. **`react-native-web` 渲染不到小组件**。它输出的是浏览器 DOM；小组件既不是 DOM，也不是 RN 原生视图。
2. **RN 原语也渲染不到小组件**。组件必须由平台自己的载体绘制（WidgetKit / RemoteViews / ArkTS / Adaptive Card），这是 §1 那份一手工程记录已经证明的事。
3. **有一条"看起来能收敛"的陷阱路必须主动堵死**：`react-native-android-widget` 的模型是 **headless JS**（`registerWidgetTaskHandler` → 在后台 JS 上下文里 `renderWidget`）。它确实能让组件"用 RN 组件写"，代价是**把 RN 组件树连同应用 JS 拖进一个后台进程** —— 恰好摧毁"单写者快照 + 意图队列"这套契约存在的理由。**即使它可用也不该用**（见 §4）。

**建议在 ADR-0024 里加一句显式例外**，措辞可直接采用：

> **例外：系统小组件不纳入 UI 收敛。** 小组件由各平台原生载体绘制（iOS/macOS SwiftUI·WidgetKit、Android Kotlin·RemoteViews、鸿蒙 ArkTS 卡片、Windows Adaptive Card 模板），共享的是 `v: 1` JSON 契约而非 UI 代码。**禁止使用 headless-JS 组件库**（它会把应用 JS 拖进后台进程）。

### 10.2 空白一：ADR-0024 选了 Electron，但**没评估 Electron 能否承载平台组件载体**

ADR-0024 §5 已诚实列出"桌面端签名 / 公证 / 自动更新成本完全未调研"。**组件让这个空白变大了**，新增三条：

| 新未核实项 | 若为否，后果 |
|---|---|
| Electron 的 macOS 产物能否内嵌 WidgetKit `.appex`，且**在 Developer ID 签名 + 公证 + 非 App Store 分发**下被系统识别？ | macOS 只能退回 **Continuity**（iPhone 组件上 Mac，降级形态） |
| Electron 的 Windows 产物能否 MSIX 打包并注册 Win11 widget provider（WinRT COM server）？ | Windows 只能走 **PWA provider**（见 10.3） |
| Electron 的 `.app` 由 electron-builder 之类产出，嵌入 `.appex` 需要动 bundle 结构与双 target 签名 —— 工程上多难？ | 决定"原生桌面组件"值不值 |

> 注意：ADR-0024 §2.2 选择 Electron 的决定性理由是**同步存储**，那条理由与组件无关。**所以不要用组件去推翻 Electron；应该做的是承认"原生桌面组件"是一个可能拿不到的可选项**，并准备好两条降级路径。

### 10.3 空白二：Electron 路线下，`apps/web` 的 PWA 化**价值上升了**，不是下降

因为桌面端与 Web **共用同一个 react-native-web 产物**（ADR-0024 §3），把 `apps/web` 做成可安装 PWA 这件事**同时服务两个目的**：

1. Web 用户可安装（对 Web 端本身有价值）
2. **Windows 11 组件可以完全绕开 Electron** —— 走 PWA widget provider，不需要 MSIX、不需要 WinRT COM server、不需要 C++/C#

也就是说：**Windows 的组件路径与 Electron 是解耦的**。即使"Electron 承载原生组件"最终不成立，Windows 仍有组件（只要 PWA 那条前置做了、且未核实项通过）。

🔴 但前置仍然成立且**已实测**：`apps/web` 现在**不是** PWA（无 manifest、无 service worker、无图标、无 PWA 插件）。见 §5。

### 10.4 我确认同意的部分

- **同意"先把共享层做出来、先做垂直切片验证，而不是先铺新端"** —— 这与组件的 W0 阶段（纯 TS 的 `packages/widget-core` + golden fixture）**天然并行、互不阻塞**。
- **同意"不引入样式库"** —— 对组件同样成立：`HeytaTokens.swift` / `HeytaTokens.ets` 已存在，各端组件直接消费，**不要为组件另建第二套设计真源**。
- **同意"每条收敛都要配门禁"** —— 组件正是最需要门禁的一层（见 [改造计划](../plans/multi-platform-widgets.md) §2.4：现有三条门禁**全都扫不到原生代码**）。

### 10.5 一句话给 ADR-0024

**"UI 只写一份"在应用内成立，在小组件上不成立 —— 小组件是 3 份原生 UI + 1 个 JSON 模板。请把它写成显式例外，并补上"Electron 能否承载平台组件载体"这一条未核实项。**

---

## 附：上游契约的形状（可直接采用）

```ts
// v: 1 —— 应用是唯一写者；pending 勾选由原生在渲染时叠加，绝不写进 blob
{ v: 1,
  dayStr: string,        // 仅供显示："这份快照是给哪一天算的"
  validUntil: number,    // 唯一的过期判据（epoch ms）
  tasks: { id, title, isDone, projectId? }[],   // projectId 是省略而非 null
  projectColors: { [projectId]: string } }
```

三条必须继承的边界：**未知 `v` → 渲染空列表**；`projectId` **省略而非 `null`**（`org.json` 的 `optString` 会把 JSON null 变成字符串 `"null"`）；**最多 20 条**。
