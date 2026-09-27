# 多端小组件改造计划

> 状态：**规划中**
> 证据与平台事实见 [native-widgets.md](../research/native-widgets.md)（调研结论层，本文件是**执行层**）。
> 与 [phase-2-multi-platform.md](phase-2-multi-platform.md) 的关系：**这份计划是它的一个输出形态，不是它的后续阶段。**

---

## 0. 这份计划在回答什么

**多端适配是既定方向（[ADR-0003](../adr/0003-multi-platform-strategy.md)、P2）。所以"没有壳"不是否决理由 —— 是排序问题。**

真正要回答的是这个：

> 在适配每一端的时候，**顺手把小组件做对**，而不是等每一端做完再回头补。

因为返工成本是**不对称**的：

| | 先埋结构 | 后补 |
|---|---|---|
| 签名 / 容器 / App Group | 第一端多付一次 | **每一端都要重开**（App Group ID 上线后改不了） |
| 快照契约 | 写一次 | 每端各写一份 → **必然漂移**（本项目已踩过 5 次，见 [AGENTS.md](../../AGENTS.md) §3.5） |
| 门禁 | 一次扩到位 | 每端都要重新判断原生代码归谁管 |
| 契约测试 | 一份 golden fixture 喂所有端 | 每端自己造 fixture → **锁不住同一形状** |

**核心判断：小组件的承重结构不在任何一端，在 `packages/`。端上只该有"读一个 JSON、画出来、把点击写回队列"这三件事。**

---

## 1. 🔴 多端适配现在就必须做对的 5 件事

> 这一节是整份计划里**最重要的部分** —— 它列的都是在适配过程中**顺手就能做、但错过就要返工**的事。

### 1.1 iOS：bundle id 与 App Group ID 在第一次真机签名时定死

现状：`apps/mobile/ios/HeytaMobile.xcodeproj/project.pbxproj` 里 **Debug / Release 两处都还是 RN 模板默认值** —— `org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)`。

- 组件要 App Group，App Group 要注册 App ID → **模板默认 bundle id 不该被注册**。
- App Group ID **上线后极难改**：改了旧容器里的数据就成孤儿。

**动作**：iOS 第一次配真机签名/上架时，一次性定下 bundle id 与 `group.<bundle-id>`，并把 App Group capability 同时加到 app target 与（将来的）widget target 上。

### 1.2 每个新壳建立时预留 widget 的目录与共享容器（**只占位，不写逻辑**）

- 鸿蒙壳：`entry/src/main/ets/` 下预留 `widget/` 与 `form_config.json` 的位置
- 桌面壳（若做）：预留 Xcode widget extension target / MSIX widget provider 的位置
- **不写任何组件逻辑**，只保证"以后加不用动工程结构"

### 1.3 `packages/widget-core` 与 golden fixture 先落

纯 TS、零端依赖，**不依赖任何一端的壳**。它可以在多端适配的**同一时间**并行开工（见 §2.1）。

### 1.4 🔴 不要把 op-sqlite 的库文件移进 App Group

一个很自然但**错误**的念头："让 widget 直接读 SQLite 不就行了"。后果：

- widget 进程与 app 进程**跨进程双写同一个 SQLite 文件** → 锁竞争、`SQLITE_BUSY`、WAL 争用
- 上游**明确放弃**了这条路，选的是"单向 JSON 快照"（[android-home-screen-widget.md](../../research/upstream/super-productivity/docs/android-home-screen-widget.md)：*"Native code must never rewrite the snapshot"*）

**动作**：库文件留在应用私有容器；组件只读**共享存储里的一份快照**。

### 1.5 快照的写入口只有一个

"单一写者"是不变量，不是建议：只有应用写快照，组件**只写意图队列**。这条要在代码结构上就不可能违反（见 §2.3）。

---

## 2. 改造：四个新东西（全部在 `packages/`）

### 2.1 `packages/widget-core`（新包）

**纯 TS、零运行时依赖** —— 与 `packages/ai` / `packages/local-api` 同一档纪律。

| 内容 | 说明 |
|---|---|
| `widgetSnapshotSchema`（zod，`v: 1`） | 契约的唯一事实源。字段与边界见 [native-widgets.md](../research/native-widgets.md) §3；🔴 **未知 `v` 必须 fail closed 到空列表** |
| **选择器** | 从物化状态算快照：「今天」「四象限」「今日习惯」「今日专注」。复用 `packages/domain`（四象限已是派生视图，[ADR-0015](../adr/0015-four-quadrant-as-derived-view.md)） |
| **意图队列语义** | `DoneIntent = { taskId, targetIsDone }` 的 last-wins 合并、去重、**跳过"已经在目标状态"的**（防回放噪声） |
| 🔴 **不构造 op** | 与 `packages/local-api` 同一条红线：**类型上就产生不了 op** |

**为什么它必须是独立的包**：它是**唯一能被三端（Kotlin / Swift / ArkTS / JS）测试共同锁定的东西**。

### 2.2 一份 golden JSON fixture 喂所有平台的解析器

- `packages/widget-core/fixtures/v1.golden.json`
- 必须覆盖的边界（上游的解析器逐条处理过，都是有原因的）：**缺 `projectId`**（是省略，不是 `null`）、**JSON null 映射成字符串 `"null"`** 的陷阱、**未知 `v`**、空列表、**超过 20 条**、`validUntil` 缺失/为 `0`
- 各端单测**读同一份文件**：Kotlin 单测、Swift 单测、ArkTS 测试、TS 测试

> 上游就是这么做的：`android-widget.selectors.spec.ts` 与 `WidgetDataTest.kt` **锁同一份形状**。
> 本仓库的等价物是 `packages/sync-core/tests/argon2-known-answer.spec.ts` 用向量钉字节 —— 同一个手法，换个对象。

### 2.3 意图 → op 的唯一转换点（并入 `packages/app-host`）

- 新文件 `packages/app-host/src/widget-actions.ts`，导出 `drainWidgetIntents(...)`
- 🔴 **恰好一个用户意图 = 一个 op**（[AGENTS.md](../../AGENTS.md) §3.4）
- 各端外壳只做：读队列 → 交给它 → 把新快照写回共享存储

**这是"组件勾选完成"的完整合法路径**：

```
组件点击 → 原生/SW 写意图队列（共享存储）
        → 应用回前台 / resume
        → JS 读队列 → drainWidgetIntents() → 恰好一个 op
```

### 2.4 门禁：组件是全平台第一段"原生 + 有业务语义"的代码

现状是**没有任何自动保护**（实测，见 [native-widgets.md](../research/native-widgets.md) §5.3）：

| 门禁 | 扫描范围 | 漏掉什么 |
|---|---|---|
| `check:design` | `.ts .tsx .js .jsx .css` | Swift / Kotlin / ArkTS 里的裸 hex |
| `check:ui-language` | `apps/landing/src`、`apps/web/src`、`apps/mobile/src` | 原生组件里的硬编码文案 |
| `check:layering` | `.ts .tsx .mts .cts`，`SKIP_DIRS` **含 `ios`/`android`** | 🔴 **原生代码里"业务上该怎么做"** |

**动作**：新增 `scripts/check-widgets.mjs`（或扩既有三条），至少钉住两条：

1. 原生 widget 代码里**不得出现**计算"今天"/逻辑日边界/物化重复任务的形状（这些只能来自快照）
2. 原生 widget 代码**不得**写状态或构造 op（只能写意图队列）

⚠️ 按本仓库规矩：**必须先用注入违规文件验证它会失败**（[AGENTS.md](../../AGENTS.md) §5 末尾："不能失败的检查没有价值"）。而且旧的三条门禁的扩展名/SKIP_DIRS 是**刻意**写窄的 —— 扩它们要单独判断，别顺手改。

### 2.5 UI 生成器：**先不做**

一个很自然的念头：写一个"声明式 layout spec → SwiftUI / RemoteViews XML / ArkTS / Adaptive Card"的生成器，一次覆盖所有端。`packages/design-system` 已有同类先例（tokens → Swift/ArkTS/RN + `check:tokens` 钉同步），技术上顺手。

**但 v1 不做。** 理由是收益与时机不匹配：

- v1 只有 **1–2 个变体 × 3 端** = 手写更便宜，且生成器本身要维护
- 生成器**只有在变体数量上来之后才划算**。滴答清单光 iOS 桌面就有 ~15 款 —— **那时**才需要生成
- 现在做生成器，是在**需求形状还没稳定时**固化一套抽象

**触发条件（写成可判定的）**：当"变体数 × 平台数 > 10"时，再上生成器。到那时代码生成的目标不是 HTML/CSS，而是**各端的原生 widget layout**。

---

## 3. 平台矩阵：每一端走哪条路

> 🔴 这里有一个**反直觉但重要**的结论：**Windows 和 macOS 反而不用等壳** —— 两条平台自带的捷径让组件可以先落地。

| 平台 | 路径 | 要新建壳吗 | 前置 | 证据 |
|---|---|---|---|---|
| **Android** | AppWidget（RemoteViews 或 Glance） | ❌ 不需要 | 无 —— **最快能验的一端** | [Glance](https://developer.android.com/develop/ui/compose/glance/create-app-widget) |
| **iOS** | WidgetKit extension | ❌ 不需要 | bundle id + App Group（§1.1）+ **第一个自定义原生模块** | [WidgetKit](https://developer.apple.com/documentation/widgetkit) |
| **Windows** | 🔴 **PWA widget provider** | 🔴 **不需要**（但**只为 Edge 服务**，且刷新下限 **12 小时** → 需 Web Push 补） | PWA 得能从**公网 endpoint** 安装；本地安装可靠性 **待实测** | [MS Learn: PWA widgets](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps-chromium/how-to/widgets) |
| **macOS** | 🔴 **Continuity：iPhone 小组件上 Mac** | 🔴 **不需要 Mac 壳 —— 但需要 iOS 壳 + 组件（W2）** | iOS 17+ / macOS **Sonoma 14+** / Mac **所有型号**（不需 Apple Silicon）/ 同一 Apple 账号 / iPhone 在附近或同 Wi-Fi | [Apple：使用 iPhone 组件](https://support.apple.com/en-us/guide/mac-help/mchl52be5da5/mac) |
| macOS / Windows（**原生**桌面组件，后置） | WidgetKit / Windows App SDK + MSIX | ✅ 要（桌面壳 = **ADR-0024 已选 Electron**） | 🔴 macOS 侧压在"**Developer ID 分发的应用能否带 `.appex`**"这个未实测问题上 | [Windows widget providers](https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-providers) |
| **鸿蒙** | 服务卡片（ArkTS + FormExtensionAbility） | ✅ 要 | 🔴 **唯一一个"组件必须等壳"的平台** | [ArkTS 卡片](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-ui-widget-interaction-overview) |
| **Apple Watch** | watchOS widget extension（同一 Xcode 工程） | ❌ 不需要 | 快照要传到手表（WatchConnectivity）—— 后置 | [Apple: accessory widgets](https://developer.apple.com/documentation/widgetkit/creating-accessory-widgets-and-watch-complications) |
| **Web** | 无系统级组件 | —— | —— | 但 **Windows PWA 让 Web 用户在 Windows 上有组件** |

### 3.1 Windows 那条路（最便宜的一大块）

微软官方文档原话：

> *"Currently you can implement a widget provider using a packaged Win32 desktop app **or a Progressive Web App (PWA)**."*

机制（官方文档确认）：

- manifest 里加 `widgets` 成员：`name` / `description` / `icons` / `screenshots` / `tag` / `ms_ac_template` / `data` / `type` / `auth` / `update`
- service worker 监听 **`widgetinstall`** / **`widgetuninstall`** / **`widgetclick`**，用 `widgets.updateByTag` 更新
- 渲染**不是 HTML** —— 是 **Adaptive Card 模板 + JSON 数据**
- 刷新靠 **Periodic Background Sync** —— 🔴 **但这条实测下来不可用**：Chromium 源码里 `kMinPeriodicSyncEventsInterval = base::Hours(12)`，实际间隔 = 12h × 互动度系数（12/24/36h，或**永不**），且桌面端**没有 OS 级唤醒**（那是 `#if IS_ANDROID`）→ **Windows 上必须 Edge 进程活着**。
  → **"当日任务列表"必须靠 Web Push 触发 SW 调 `widgets.updateByTag`**（官方点名支持），不能靠 PBS。详见 [选型证据 §5.1](../research/multi-platform-selection-evidence.md)

**对 heyta 的意义**：这个路径**不需要任何 C++/C# 代码**，而且组件签名/容器/App Group 这些**全都不用管**。

🔴 **但有一个前置，实测过了、结果是否定的：`apps/web` 现在根本不是 PWA。**

| 检查项 | 实测结果 |
|---|---|
| web app manifest | ❌ 无（`apps/web/public/` 不存在，`index.html` 里没有 `<link rel="manifest">`） |
| service worker | ❌ 无（无 `sw.*`，无 `navigator.serviceWorker.register`） |
| PWA 插件 | ❌ 无（`package.json` 里没有 `vite-plugin-pwa` / workbox 之类） |
| `index.html` | 只有 `<meta viewport>` / `color-scheme` / `title` —— 一个纯 Vite SPA |

而 Windows PWA 组件的机制**本身就依赖 service worker**（`widgetinstall` / `widgetclick` 事件、`widgets.updateByTag`）。
→ **"把 `apps/web` 变成可安装的 PWA"是 W3 的前置**，不是顺手就有的东西。

⚠️ 另有三个必须先验的未知数（见 §7）：
1. 🔴 **它只为 Edge 服务** —— `widgets` manifest 成员**不在 W3C 规范、也不在 Chromium 源码**（grep 0 命中）→ **Chrome 用户拿不到组件**。
2. 🔴 **本地安装（不上 Store）是否稳定出组件未证实** —— 文档没说必须上 Store，官方 demo 就是本地 Edge 安装；但 2023 年有"5 台机器仅 1 台出现 + 微软称 experimental"的记录，2025–2026 **无正面实测报告**。
3. **刷新**：见上条 —— PBS 下限 12 小时，必须走 Web Push。

### 3.2 macOS 那条路（几乎零成本的附带收益）

- macOS 14+ 可以把 **iPhone 上的组件**放到 Mac 桌面，**不需要安装对应的 Mac App**，且**支持交互**
- 条件：同一 Apple 账号、iPhone 在附近或同一 Wi-Fi、`系统设置 → 桌面与程序坞 → 使用 iPhone 组件` 打开

**含义**：**iOS 组件做完，macOS 桌面组件几乎是免费的**（降级形态：依赖用户有 iPhone）。真·Mac 原生组件仍然需要桌面壳 —— 但**不再阻塞"macOS 上有组件"这件事**。

### 3.3 鸿蒙（唯一被壳卡住的）

- 服务卡片需要 ArkTS + `FormExtensionAbility` + `form_config.json`
- 卡片硬限制：`updateDuration` **粒度 30 分钟**、**每张卡片每天 50 次**定时刷新配额、**进程不能常驻后台**
- 现状：`apps/mobile` 下**没有鸿蒙工程**；P2 记录的是"构建链已实测打通（20 MB release HAP），缺模拟器镜像 + 签名"
- 路线选择（见 §7）：**跟 RN 鸿蒙壳** vs **独立元服务**（免安装、可独立上架，比整个 App 轻）

---

## 4. 排序

### 阶段 W0 —— 与多端适配**并行**，不依赖任何端

- [ ] `packages/widget-core`：schema + 选择器 + 意图队列语义
- [ ] `packages/widget-core/fixtures/v1.golden.json`
- [ ] `packages/app-host/src/widget-actions.ts`：`drainWidgetIntents()`
- [ ] `scripts/check-widgets.mjs`（**含注入验证能失败**）
- [ ] 决定 ADR 项（§6）

> W0 是纯 TS。**它可以今天就开工，而且多端适配越晚做完，它的收益越大。**

### 阶段 W1 —— Android（先做，因为它最容易验）

- [ ] AppWidget provider + `appwidget-provider` XML
- [ ] Kotlin 解析器 + 读 golden fixture 的单测
- [ ] 应用侧写快照 + 主动刷新

### 阶段 W2 —— iOS

- [ ] bundle id / App Group 定名（§1.1）
- [ ] WidgetKit extension target（部署目标定 **16 或 17**，**app 保持 15.1** —— 交互能力需要 17）
- [ ] Swift 解析器 + 读**同一份** golden fixture 的单测
- [ ] 第一个 RN 原生模块（`setWidgetSnapshot` / `drainIntentQueue`）
- [ ] **macOS 桌面组件随这一阶段获得**（Continuity）。⚠️ 三处必须写清：① 它是**本阶段的副产品**，不是独立路径（要求 iPhone 上装着带 WidgetKit 扩展的 App）；② 用户需手动开启"使用 iPhone 组件"、且 iPhone 在附近或同 Wi-Fi；③ **交互在 iPhone 上执行**（Mac 只是显示器 + 转发）

### 阶段 W3 —— Windows（PWA widget）

- [ ] 🔴 **前置：把 `apps/web` 变成可安装的 PWA**（manifest + 图标 + service worker —— 实测现在一个都没有，见 §3.1）。⚠️ 这一步会同时牵动 `check:ui-language`（manifest 里有用户可见文案）与 `check:design`（图标/主题色）
- [ ] 先做 §7 的三个 spike（**其中第 1 条不通过，这一阶段就不成立**）
- [ ] manifest `widgets` + Adaptive Card 模板 + service worker 事件
- [ ] `widgetclick` → 写意图到 IndexedDB → 应用打开时 drain

### 阶段 W4 —— 鸿蒙

- [ ] 先决：鸿蒙壳能跑 **或** 立一个元服务工程（§3.3）
- [ ] `form_config.json` + ArkTS 卡片页面 + 读同一份 golden fixture 的测试
- [ ] 注意 50 次/天配额 → **不能靠定时刷新做"实时"**

### 阶段 W5（可选，后置）

- [ ] watchOS 组件
- [ ] 锁屏组件（含隐私开关，§6）
- [ ] Live Activity（番茄专注——heyta 已有 `FOCUS_SESSION`，很合适）
- [ ] 控制中心控件 / Windows 原生组件 / Mac 原生组件（**都要先有桌面壳**）

---

## 5. 验收（每端零 mock）

### 5.1 什么能自动验、什么不能 —— 先说清楚

组件 UI 的自动化验证**在各平台都不现实**（上游实测：*"interactive widgets in the simulator are flaky"*；Android 组件渲染也没有可靠的 headless 断言）。

**所以验收拆成两层，别混为一谈：**

| 层 | 能不能自动 | 怎么验 |
|---|---|---|
| **契约**（解析、选择器、未知 `v`、边界） | ✅ **能** | 各端单测读**同一份** golden fixture |
| **数据路径**（意图队列 → 恰好一个 op） | ✅ **能** | 直接往队列里写意图（**不经过 UI**），断言 op 计数恰好 +1 |
| **渲染与点击接线**（按钮真的调了 intent） | ❌ **不能** | **真机截图取证 + 人眼复核**，写成明确的"未自动覆盖" |

🔴 **关键**：第二层覆盖了**风险最高的部分**（op-log 纪律），而且**不需要 UI**。别因为它"看起来很弱"就跳过 —— 它是唯一能自动钉住"组件不会把数据写坏"的手段。

### 5.2 跨端统一判据

- [ ] 未知 `v` → 渲染**空列表**（fail closed），不是半截数据
- [ ] 组件勾选 → **恰好一个 op**（不是两个、不是零个）
- [ ] 应用进程被杀 → 仍显示最后一次快照，且 pending 勾选被叠加显示
- [ ] 锁屏场景默认脱敏

### 5.3 脚本

形状照 `scripts/verify-mobile-repeat.sh`：真模拟器 + 真服务端 + 真 `node-host` 设备。

⚠️ 会踩到两个已记录的陷阱：**只改 `packages/` 时 APK 打进旧 JS bundle**（[AGENTS.md](../../AGENTS.md) §7 第 27 条）、**"构建成功 ≠ 产物是新的"**（同条）。W0 全在 `packages/` —— **这两条会百分之百踩到**。

---

## 6. 必须先拍的决策（ADR 候选）

| # | 决策 | 为什么不能拖 |
|---|---|---|
| 1 | 🔴 **快照是明文还是设备密钥加密** | 决定整个方向可行性。选明文 = 任务标题出现在应用私有容器之外（不经服务端，但不再只在加密 DB 里），是 E2EE 产品的**威胁模型变更**，须按 [ADR-0006](../adr/0006-supply-modes.md)/[ADR-0013](../adr/0013-cloud-ai-and-maas.md) 的惯例显式记录 |
| 2 | **锁屏组件的默认可见性** | 做错是隐私事故。Android 有现成退出机制 `"not_keyguard"` |
| 3 | **v1 上哪几个变体** | 决定 §2.5 的生成器触发点 |
| 4 | **鸿蒙走 RN 壳还是独立元服务** | 两条路成本结构完全不同 |
| 5 | **是否做原生桌面组件**（= 桌面壳决策） | 这也是 `phase-2-multi-platform.md:1717` 那个未决问题；好消息是**组件不再阻塞它** |
| 6 | **Windows 是否上 Microsoft Store** | 影响自建用户能不能用上组件 |

---

## 7. 未核实 / 必须先做的 spike

按"会不会推翻计划"排序：

1. 🔴 **Windows：自建域名 PWA 用 Edge 本地安装（不上 Store）后，组件是否稳定出现在 Widgets Board？**
   文档没要求必须上 Store，官方 demo 就是本地安装；但 2023 年有"5 台机器仅 1 台出现 + 微软称 experimental"的记录，2025–2026 **无正面实测报告**。**这条不验，W3 的可行性就是空的。**
   建议实测条件：Win11 24H2/25H2 + 最新 Edge + 一个真实 https 域名。
2. ✅ **Windows：刷新频率** → **已查明，且结论是负面的**：PBS 下限 **12 小时**（Chromium 源码 `kMinPeriodicSyncEventsInterval`），且桌面端无 OS 级唤醒（`#if IS_ANDROID`）→ **W3 必须改用 Web Push 触发 `widgets.updateByTag`**，不能靠 PBS。
2b. 🔴 **Windows：它只为 Edge 服务** —— `widgets` manifest 成员**不在 W3C 规范、也不在 Chromium 源码**（grep 0 命中）→ **Chrome 用户拿不到组件**。这是能力边界，不是 bug，须写进产品预期。
3. **快照加密方案在 iOS extension 里的真实开销**（AES-GCM 解密 + Keychain 读取）—— 对比 WidgetKit 的执行窗口够不够。Apple **未公开**窗口秒数，只能真机测。
4. **鸿蒙元服务能否承载服务卡片而不需要完整 App**（官方文档倾向"能"，但要实测一遍工程）。
5. **macOS Continuity 组件的实际可用性**（同账号 + 附近条件在真实用户环境里有多容易满足）。
6. ✅ **已查明，结论是否定的**：`apps/web` 现在**不是** PWA（无 manifest / 无 service worker / 无 PWA 插件，`index.html` 是纯 Vite SPA）→ 见 §3.1。**W3 因此多了一个前置**。

---

## 8. 成本估算

⚠️ **只有 iOS 那一行有真实锚点**，其余是**估算，未实测** —— 不要当承诺用。

| 阶段 | 估算 | 依据 |
|---|---|---|
| W0（契约 + fixture + drain + 门禁） | ~2–3 人日 | 纯 TS，无平台依赖。门禁含注入验证 |
| W1 Android | ~3–5 人日（未实测） | 参照 iOS 的锚点下调（无签名/无 Apple 流程） |
| W2 iOS | **~2–4 人日** | ✅ **有锚点**：上游对该移植的估算是"~2–4 focused days：0.5–1 在 Xcode target/App Group/门户/CI 签名，1–1.5 在扩展 + 插件，0.5 在状态层泛化，其余在真机测试"，并注明 *"App Store review is routine for widgets"* |
| W3 Windows | ~5–9 人日（未实测） | 含 spike；**外加"把 `apps/web` 变成 PWA"**（manifest + 图标 + service worker）；Adaptive Card 要重画一遍 UI，且**不能复用 HTML** |
| W4 鸿蒙 | **前置未知** | 被鸿蒙壳（或元服务工程 + 签名 + AGC 上架）支配，组件本身不是大头 |
| W5 可选 | 逐项单独估 | 每一项都可能有自己的平台前置 |

**总计（不含鸿蒙前置、不含桌面壳）**：约 **12–21 人日**。其中 **~2–3 人日可以立刻开工且不依赖任何端**。

---

## 附：这份计划刻意没有做的事

- **没有把组件塞进 P3 当一个独立项目** —— 它是多端适配的**输出形态**
- **没有让 widget 直接读 SQLite**（§1.4）—— 那是跨进程双写
- **没有上 UI 生成器**（§2.5）—— 变体数量还没到
- **没有承诺组件 UI 的自动化验收**（§5.1）—— 那个在各平台都不现实，说了就是假绿
