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

⚠️ **待核实**：Apple 多平台 WidgetKit 共享的**确切边界**（哪些能放进一个 target、哪些要分 target、`supportedFamilies` 差异）。研究线正在查，本文件不把这一条当已证事实。

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

🔴 **但有一个 RN 特有的坑必须写进纪律**：`react-native-android-widget` 这类库的模型是 **headless JS**（`registerWidgetTaskHandler` → 在后台 JS 上下文里 `renderWidget`）。

那等于**把应用 JS（连带 op-log 的形状）拖进一个后台进程**，恰好是"单写者快照 + 意图队列"这套契约存在的理由所在。**建议明确不用它，Android 组件用 Kotlin 写。**
（研究线正在复核该库的维护性与能力边界；此处结论是"即使它可用也不该用"，与它质量无关。）

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

### 5.3 「真·原生桌面组件」仍然需要壳

| 路径 | 需要桌面壳吗 | 关键未知 |
|---|---|---|
| macOS 原生桌面组件 | ✅ 需要 | 🔴 **Developer ID 签名 + 公证（非 App Store）分发的应用，WidgetKit 扩展还能被系统识别吗？** 研究线未给出确定答案，**仍待实测** |
| Windows 原生组件 | ✅ 需要（MSIX + WinRT COM server） | Electron 产物能否 MSIX 打包并注册 widget provider（见 §10.2） |

> ✅ **一条先例**：上游 Super Productivity 的桌面端就是 **Electron**，同时移动端有原生组件。这证明"Electron 桌面 + 原生组件"不是空想；但它**没做过桌面端组件**，所以只覆盖"移动组件 + Electron 共存"。

### 5.4 修正后的桌面结论

**组件仍然不该驱动桌面选型**（§1–§4 的结论不变，而且 ADR-0024 已按"同步存储"这条无关理由选了 Electron）。

但**"桌面覆盖是白拿的"这个说法要撤回**：
- **macOS**：靠 Continuity，可达，但**依赖 iOS 组件先做完**，且交互回到 iPhone
- **Windows**：靠 PWA，不需要原生代码，但 **Edge 独占 + 刷新下限 12h（需 Web Push 补救）+ 本地安装可靠性待实测**
- **想要不降级的桌面组件，就必须有桌面壳 + 平台组件载体**，而 macOS 那条还压着一个未实测的签名问题

---

## 6. 鸿蒙：组件应当与壳**解耦**

现状：鸿蒙壳未跑起来（HAP 已能产出但未签名、缺模拟器镜像），而 ADR-0004 自己写明"若鸿蒙跑不起来，可能退化为 RN 覆盖 iOS/Android + 鸿蒙单独 ArkUI"。

**关键判断**：服务卡片是独立的 `FormExtensionAbility`，它**只需要读一份快照** —— 不需要 RN 运行时，也不需要整个 App 的 UI 树。

→ 所以 **鸿蒙卡片可以独立于 RNOH 的成败推进**（走一张薄 ArkTS 卡片，或独立元服务），这**移除了一个关键路径风险**：不必等"RN 在鸿蒙上真跑起来"才能有鸿蒙组件。

⚠️ 前提与约束（研究线在查实证）：仍需 DevEco + 签名 +（若要分发）AGC 上架；卡片的**定时刷新有每日配额**（每卡每天上限、00:00 重置），所以**"实时"这个词在鸿蒙卡片上不成立**，只能靠推送刷新。

---

## 7. 真正需要拍板的决策

| # | 决策 | 为什么是现在 |
|---|---|---|
| 1 | 🔴 **快照是明文还是设备密钥加密** | **这是唯一的枢纽决策**。上游把明文 JSON 放进 App Group 是因为它**不是 E2EE**；heyta 是。选明文 = 任务标题离开加密 DB（仍不出本机、不经服务端），属**威胁模型变更**，须按 ADR-0006 / ADR-0013 的惯例显式记录 |
| 2 | **组件里要不要解密** | 若要，则按 [ADR-0003](../adr/0003-multi-platform-strategy.md) §2.3，"新增平台必须扩展跨语言加密互操作测试" —— 而 `research/tools/crypto-interop` **目前只有 TS ↔ Python**。**组件解密 = 新增一个 Swift/Kotlin/ArkTS 加密实现**，这是真实的长期维护成本，且是选明文的有力论据 |
| 3 | 锁屏组件的默认可见性 | 做错是隐私事故 |
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

**架构上（与 [改造计划](../plans/multi-platform-widgets.md) 一致）：**

- 契约、选择器、意图队列语义放进 `packages/widget-core`（纯 TS 零依赖，**类型上产生不了 op**）
- **一份 golden fixture 喂所有端解析器**（上游就是这么锁住 Kotlin↔Swift 两端形状的）
- 意图 → op 的唯一转换点在 `packages/app-host`（`actions.ts` / `host.ts` 所在处，符合 §3.5）
- **原生绝不重新推导"今天"**：应用发的是**判断结果**（`validUntil`），不是判断的输入。上游对此有长注释说明为什么 —— 因为原生**无论如何算不出来**（重复任务实例化、逾期结转都只在应用跑过之后才存在）

---

## 9. 待核实清单

> 图例：⏳ 研究线仍在外 · ✅ 已回填（结论见括号）

- 🔴 ⏳ **Developer ID（非 App Store）分发的 macOS 应用能否带 WidgetKit 扩展 + App Group** —— **仍是最大的桌面未知数**，决定"原生 Mac 组件"可不可行
- ✅ **Windows PWA 组件的刷新频率** → **已回填：PBS 下限 12 小时**（Chromium 源码 `kMinPeriodicSyncEventsInterval`），且桌面端无 OS 级唤醒。**"当日任务"走 PBS 不成立**，须靠 **Web Push + `widgets.updateByTag`**（见 §5.1）
- ✅ **Windows PWA 组件是否必须走 Store** → **已回填：文档没这么说**，官方 demo 就是本地 Edge 安装；但只有 Store 路径被官方背书，本地安装有 2023 年翻车记录、2025–2026 无正面报告 → **必须自测**（见 §5.1）
- ⏳ **Windows 原生组件是否必须 MSIX 打包；Electron 产物能否注册 WinRT COM server widget provider**
- ⏳ **自建域名 PWA 用 Edge 本地安装后，组件是否稳定出现** —— 建议在 Win11 24H2/25H2 + 最新 Edge 上真机实测
- ⏳ **`widgets` 能力是否仍带灰度/flag**（Edge 108 时称 experimental，未找到 GA 公告）
- ⏳ **manifest `screenshots` 的确切尺寸** —— Edge 文档 `600×400` vs picker 文档 `300×304`，**口径冲突**
- ⏳ **`auth: true` 的语义**（认证态组件如何取数据）
- ⏳ **`widgetclick` 里能否 await 完 IndexedDB 写事务**（SW 生命周期；设计上应包 `event.waitUntil`）
- ⏳ **iPhone 不在附近时 Continuity 组件是显示缓存还是消失** —— Apple 未写，旁证两种都有
- ⏳ **E2EE 产品（Bitwarden / Proton / Standard Notes 等）实际怎么做组件**，尤其**锁屏泄露**与审计发现
- ⏳ **Apple 多平台 WidgetKit 共享的确切边界**
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
