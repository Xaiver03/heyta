# 原生小组件：滴答清单有什么、heyta 能做哪些、怎么做

> **调研日期**：2026-09-27
> **调研范围**：滴答清单各端组件清单（厂商自述）；heyta 各端现状（本仓库实测）；iOS / Android / 鸿蒙的实现路径与平台限制；heyta 特有的 op-log / E2EE / 门禁约束
> **状态**：**调研结论，未拍板。** 按 [`docs/README.md`](../README.md) 的分工，本文只给证据；要固化的决策见 §7，须新开 ADR。

---

## 🔴 勘误（同日追加）：§0 对 macOS / Windows 的"做不了"**已被推翻**

本文 §0 的结论是"macOS / Windows 做不了，因为没有桌面壳"。**那个结论基于"必须走原生组件"这个未经检验的前提** —— 后续在写[改造计划](../plans/multi-platform-widgets.md)时发现，这两端各自有一条官方捷径，**都不需要新建壳**：

| 平台 | §0 原结论 | 实际 | 证据 |
|---|---|---|---|
| **macOS** | ❌ 做不了 | ✅ **不需要 Mac App** —— macOS 14+ 可把 **iPhone 的组件**放到 Mac 桌面（Continuity），同一 Apple 账号 + iPhone 在附近或同 Wi-Fi，且**支持交互** | [Apple 支持文档](https://support.apple.com/guide/mac-help/mchl3e281fc9/mac) |
| **Windows** | ❌ 做不了 | ✅ **不需要 Windows App** —— Win11 小部件支持 **PWA widget provider**（官方原文：*"a packaged Win32 desktop app **or a Progressive Web App (PWA)**"*），**不需要 C++/C# 代码** | [MS Learn: PWA widgets](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps-chromium/how-to/widgets) |

⚠️ 两条捷径都**有代价，不是白拿**：macOS 那条依赖用户有 iPhone 且在同一网络（是**降级形态**，不是真·Mac 原生组件）；Windows 那条要求 `apps/web` 先变成可安装的 PWA（**实测现在不是**，见 [计划 §3.1](../plans/multi-platform-widgets.md)）。

**真正被壳卡住的只剩鸿蒙**（以及"真·原生桌面组件"这个可选项）。§0 的表格与"一句话"保留原文不改，作为当时结论的记录。

---

## 0. 先看结论

**能做的是 iOS 和 Android —— 而且不是"勉强能做"，是上游已经跑通过一遍、有一份可抄的架构。做不了的是鸿蒙、macOS、Windows —— 但原因不是"组件难写"，是 heyta 还没有那些壳。**

| 平台 | 滴答清单有组件吗 | heyta 现在能做吗 | 前置条件 |
|---|---|---|---|
| **iOS** | ✅ 最全（锁屏 / 桌面 / StandBy / 实时活动 / 控制中心 / 手表） | ✅ **能做** | 新增 WidgetKit extension target + App Group + 第一个自定义原生模块 |
| **Android** | ✅ 多（桌面 5 尺寸 / 锁屏卡片 / 时间轴 / MIUI 小部件） | ✅ **能做** | 新增 AppWidget provider（原生或 Glance） |
| **鸿蒙** | ✅ 有（官方帮助中心有「鸿蒙」页签） | ❌ **做不了** | 🔴 `apps/mobile` 下**没有鸿蒙工程**（[AGENTS.md](../../AGENTS.md) §2）—— 先得有壳 |
| **macOS** | ✅ 有（帮助中心有页签；macOS 14 起可拖到桌面且可交互）—— ⚠️ **精确清单未核实**（§1.3） | ❌ **做不了** | 没有 Mac 壳（`apps/` 只有 web / mobile / node-host / landing） |
| **Windows** | ✅ 有（任务栏 / 托盘右键添加） | ❌ **做不了** | 没有 Windows 壳 |
| **Web** | —— | ❌ **不存在这种东西** | 浏览器没有系统级组件 API；PWA 只有 Badging / shortcuts |
| **Apple Watch** | ✅ 表盘复杂功能 + 智能叠放 + 点击完成 | ❌ **暂不做** | 需要 watchOS app target；且要先解决「手表上没有 op-log 怎么勾选」 |

> **一句话**：滴答清单的"很多应用上都有组件"，是**它已经在 5 个平台出了 App** 的结果，不是它把组件技术做得比谁好。heyta 的组件上限 = 它的壳的数量（2 个真壳：iOS / Android）。

---

## 1. 滴答清单到底有哪些组件（事实层）

来源：滴答清单官方帮助中心〈[🌮 小组件](https://help.dida365.com/articles/6950366960659988480)〉。厂商自述，所以"有没有"这件事的置信度高于第三方文章。

### 1.1 iOS

| 类别 | 具体内容 | 系统要求（厂商原文） |
|---|---|---|
| 锁屏组件 | 任务、习惯等 | **iOS 16** + 滴答清单 6360+；iPad 需 **iPadOS 17** + 6700+ |
| 桌面组件 | **任务**（任务 / 任务完成统计 / 添加任务）、**日历**（今日日历 / 日视图 / 月视图）、**四象限**、**习惯**（今日习惯 / 本周习惯 / 习惯热力图 / 习惯周进度）、**番茄专注**（今日专注 / 专注时间分布 / 常用专注）、**倒数纪念日** | iOS 15+ 可加；**iOS 27+ 部分组件支持超大尺寸** |
| StandBy | 任务列表 / 今日习惯 / 今日专注；**StandBy 里还支持实时活动** | **iOS 17** |
| 控制中心 | **8 个控件**：添加任务、今日任务、番茄专注、正计时、打开日历、打开四象限、打开专注、打开习惯（其中 4 个可配置指向不同清单） | **iOS 18** |
| 实时活动 | 专注、任务、习惯 | ActivityKit |
| Apple Watch | 表盘复杂功能（任务 / 习惯）+ **智能叠放**；**表盘与叠放里的任务和习惯组件都支持点击完成** | watchOS 10 叠放 |

厂商 FAQ 里两条关键的：

- **「iOS 小组件为什么不能支持点击完成任务？→ iOS 桌面小组件已支持交互，需要将系统升级至 iOS 17」** —— 即交互能力是 **17+**，16 及以下只能看。
- **「Mac 如何把小组件放在桌面上？→ macOS 14.0 已支持将小组件放在桌面上，并且支持交互」**。

### 1.2 Android

| 类别 | 具体内容 |
|---|---|
| 桌面组件 | **任务 5 种不同大小**；**日历+任务**、**日历月视图**（两款尺寸）；**四象限**；**倒数纪念日**；**习惯** |
| 锁屏卡片 | 锁屏查看今日任务 + 快速添加任务（双指捏合进入锁屏编辑添加） |
| 时间轴 | 厂商 FAQ：**「安卓端的日视图叫做时间轴」**，长按小部件 → 编辑小部件 → 配置 |
| 厂商定制 | **MIUI 小部件**两款（任务 / 习惯）；华为 / 小米 / OPPO / vivo / 三星各有一套添加路径 |

### 1.3 鸿蒙 / macOS / Windows

帮助中心为这三个平台**各有独立页签**（这是确认的）。但抓取时页签被拍平，页面里剩下的两段清单**无法可靠判定各自属于哪个平台**：

- 一段写「我们提供**五种**不同小组件」却列了 6 个名字：任务、四象限、今日习惯、今日日历、日历月视图、倒数纪念日；
- 另一段写「我们提供**六种**不同小组件」：任务、日历、四象限、番茄专注、习惯、倒数纪念日。

⚠️ **「哪一段是鸿蒙 / 哪一段是 Windows」属于未核实**，见 §8。厂商自述里也确认了 macOS 与 Windows 的添加方式（Windows：任务栏右击图标 / 托盘右键 / 设置 → 桌面小部件），所以**「这三端都有组件」本身是确认的**，只是精确清单待核。

---

## 2. heyta 各端现状（决定可行性的另一半）

本仓库实测（2026-09-27）：

| 端 | 现状 | 对组件的意义 |
|---|---|---|
| `apps/web` | IndexedDB 壳，✅ 可用 | 浏览器**没有**系统级组件可做 |
| `apps/mobile` | RN **0.84.1** + `@op-engineering/op-sqlite` **18.2.5**；Android `minSdk 24` / `targetSdk 36` / `compileSdk 36`；iOS `IPHONEOS_DEPLOYMENT_TARGET = 15.1` | ✅ 组件的主战场 |
| `apps/node-host` | 非 Web 验证壳 | 不是产品端，不可能有组件 |
| `apps/landing` | 落地页 | 无关 |
| **鸿蒙工程** | 🔴 **不存在**（只有树外探针验证过构建链）→ [AGENTS.md](../../AGENTS.md) §2、[roadmap](../plans/roadmap.md) §5.3 | 组件**被壳卡住** |
| **macOS / Windows 壳** | 🔴 **不存在** | 同上 |

### 2.1 三个会被组件直接咬到的本地事实

1. 🔴 **iOS 的 bundle id 还是 RN 模板默认值**：`org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)`（Debug / Release 两处都是）。
   加 WidgetKit extension 要在开发者门户注册 **App ID + App Group**，而 App Group 的 ID 一旦上线就"很难改"（旧容器里的数据会变成孤儿）。**所以换 bundle id 这件事必须发生在建组件的同一次改动里，而不是之后。**
2. **两端都还没有任何自定义原生模块**：`apps/mobile/ios/HeytaMobile/` 只有 `AppDelegate.swift` 与资源；`apps/mobile/android/app/src/main/java/com/heytamobile/` 只有 `MainActivity.kt` + `MainApplication.kt`。
   → 组件要的"应用 → 共享存储"和"队列 → JS"两条桥，**是本仓库第一次写原生模块**，不是复用既有设施。
3. **实体清单决定"能显示什么"**（`packages/shared-schema/src/entity-types.ts`）：

| 滴答清单的组件 | heyta 有没有对应物 |
|---|---|
| 任务 / 今日清单 | ✅ `TASK` |
| 四象限 | ✅ **派生视图**，非独立存储（[ADR-0015](../adr/0015-four-quadrant-as-derived-view.md)） |
| 日历 / 月视图 / 时间轴 | ✅ 由 `TASK` 的 `dueDate` 派生（`CalendarScreen`、`verify:mobile-calendar`） |
| 习惯（今日 / 热力图 / 周进度） | ✅ `HABIT` + `HABIT_LOG`（`packages/app-host/src/habit-actions.ts`） |
| 番茄专注（今日专注 / 时长分布） | ✅ `FOCUS_SESSION`（`packages/app-host/src/focus-actions.ts`、`FocusScreen`、`verify:mobile-focus`） |
| 添加任务 | ✅ 可走快速捕获写入路径 |
| **倒数纪念日** | ❌ **没有这个实体**。⚠️ 别被 `packages/domain/src/countdown.ts` 误导 —— 那个文件算的是**任务剩余时间**（"还剩 3 天"），文件头写得很清楚，不是纪念日 |

→ **组件类型与已有功能的映射基本齐全，唯一缺口是"倒数纪念日"**：不是组件做不出来，是产品里没有这个东西。要不要为组件单独造一个实体，是产品决策（见 §7 第 5 条）。

---

## 3. 架构：承重的是契约，不是渲染技术

上游 Super Productivity（heyta 的 op-log 就是从它 vendored 来的，MIT）**已经在 Android 上跑通、并把同一套搬到 iOS**。它的设计值得整段照抄，因为它踩过的坑和 heyta 要踩的是同一批：

> 来源：[`research/upstream/super-productivity/docs/android-home-screen-widget.md`](../../research/upstream/super-productivity/docs/android-home-screen-widget.md)（维护中的契约文档）与 [`.../plans/2026-07-07-ios-home-screen-widget-port.md`](../../research/upstream/super-productivity/docs/plans/2026-07-07-ios-home-screen-widget-port.md)（移植计划，含逐项对照表）

**四条不变量：**

1. **单向快照、单一写者。** 只有应用写 `widget_data`（版本化 JSON，`v: 1`）；原生侧**只读**。未知 `v` → **fail closed 到空列表**，不是"尽力解析"。
2. **点击只写意图队列，原生绝不改快照。** 勾选先落到 `WidgetDoneQueue`（last-wins 的 `{taskId: boolean}`），**渲染期叠加** pending 覆盖层，所以进程死了用户也能立刻看到状态变化。
3. **"今天"由应用判定，原生不重算。** 快照带 `dayStr` + `validUntil`，原生只做一件事：`now >= validUntil` → 显示"已过期"。**不复制逻辑日边界、不物化重复任务、不处理逾期顺延。**
4. **刷新靠显式推送，不靠轮询。** iOS 用 `TimelineProvider` 单一 entry + `.never` 策略，每次刷新都是应用写完快照后的一次 `reloadTimelines`。

**为什么这套形状对 heyta 是必须的，而不是可选的：**

- [AGENTS.md](../../AGENTS.md) §3.4：**一个用户意图 = 一个 op；被回放/来自远端的 op 不得再次触发副作用。**
- [AGENTS.md](../../AGENTS.md) §3.5：**op 的构造只允许在 `packages/app-host`。**
- `scripts/check-layering.mjs` 的 `no-op-construction-in-apps` 规则会拦外壳自己拼 op（当年一次抓出 17 处）。

→ 所以"在组件里勾选任务"的**唯一合法形状**是：

```
组件点击 → 原生写意图队列（共享存储）
        → 应用回到前台 / resume
        → JS 读队列 → 调 @heyta/app-host 的 action → 恰好一个 op
```

**绝不能让原生直接改状态、直接写 SQLite、或直接发 op。** 这正好也是上游的形状 —— 两边独立收敛到同一个设计，是个好信号。

### 3.1 渲染技术是可换的，契约不是

快照契约定好之后，三端"怎么把 JSON 画出来"可以各自选，互不影响：

| 方案 | 许可 | 维护性（2026-09-27 实测） | 评价 |
|---|---|---|---|
| **原生 RemoteViews / WidgetKit / ArkTS** | 随平台 | —— | ✅ **推荐**。只需要读一个 JSON 画 UI；零 JS 依赖，不必把 op-log 拖进后台进程 |
| **Jetpack Glance** | Apache-2.0 ✅ | androidx 活跃 | ✅ Android 的现代写法（Compose 风格 → 编译成 RemoteViews） |
| **`react-native-android-widget`** | **MIT** ✅ | last commit **2026-09-20**、Release 0.22.1（2026-08-17）→ 通过 [AGENTS.md](../../AGENTS.md) §3.1 门槛 | ⚠️ 能用，但它的模型是 **headless JS**（`registerWidgetTaskHandler`，系统每次更新都会唤醒你的 JS 去 `renderWidget`）——见下 |

⚠️ **`react-native-android-widget` 的诱人之处与陷阱**：它让你"用 RN 组件写 widget"，看起来省了一个平台的 UI 工作量。但它的渲染发生在**无 UI 的 JS 进程**里，而 heyta 的今天列表来自 op-log 物化状态 —— 在那条路上你要么每次更新都 hydrate 一遍（重），要么还是得先写一份快照（那就没省到）。**而且它只覆盖 Android，iOS 照样得写 SwiftUI。** 所以"省一个平台的 UI"这个收益，实际上买不到。

> 本仓库已有的能力可以复用：`packages/design-system` 已经产出 **Swift / ArkTS / RN** 三端 token（`pnpm check:tokens` 钉住同步）。组件配色应当消费它，而不是手抄 hex。

---

## 4. 平台给的刷新预算（决定"看起来是不是实时"）

这是做组件最容易低估的一层 —— **没有任何一个平台允许你"想刷就刷"**。

| 平台 | 机制 | 硬限制 | 来源 |
|---|---|---|---|
| iOS | WidgetKit timeline + 系统预算 | 预算是**动态的**、按天分配，由系统按多种因素决定；不能靠频繁 `reloadTimelines` 绕开 | [Keeping a widget up to date](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date) |
| iOS | **WidgetKit push**（APNs `content-changed`） | 组件可在"应用不在前台"时被推送刷新 —— 这是补跨设备新鲜度的正道 | [同上](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date) |
| Android | `updatePeriodMillis` | **小于 30 分钟的值不支持（系统按 30 分钟处理）**；`0` = 关闭周期更新 | [Create an advanced widget](https://developer.android.com/develop/ui/views/appwidgets/advanced) |
| Android | 锁屏组件 | Android 16 **QPR1 之后的 AOSP 版本**起对手机/平板开放；`xml-36` 里用 `"not_keyguard"` 可**主动退出** | [Widgets on lock screen: FAQ](https://android-developers.googleblog.com/2025/03/widgets-on-lock-screen-faq.html) |
| 鸿蒙 | `updateDuration` / `scheduledUpdateTime` | **粒度 30 分钟**；且**每张卡片每天最多 50 次**定时刷新，达配额后当天不再触发，**0 点重置** | [ArkTS 卡片交互概述](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-ui-widget-interaction-overview)、[被动刷新](https://github.com/liasica/harmonyos-skills/blob/master/harmonyos/references/harmonyos-guides/arkts-ui-widget-passive-refresh.md) |
| 鸿蒙 | FormExtensionAbility | **进程不能常驻后台**，生命周期回调里不能做长任务 | 同上 |

**这对 heyta 的直接含义**：组件在"应用没打开"时**必然是旧的**。上游把这件事写成了明文的"故意限制"：

> 「组件反映的是应用最后一次能跑起来时产出的状态。进程死了它就无法生成新一天的任务、也收不到跨端变更。30 分钟的平台刷新是不精确的，还可能被 Doze 推迟。」

heyta 若要做"跨端实时"，那是一个**独立的后台同步设计**（iOS `BGAppRefreshTask` / Android `WorkManager`），不属于组件这一刀。**别把它混进来**，否则组件的验收会被后台同步的不确定性污染。

---

## 5. heyta 特有的四个约束（比选型更值得先解决）

### 5.1 E2EE：明文快照是一次威胁模型变更，须显式记一笔

组件进程读不到加密 DB 里的东西，而它**也跑不动解密**：

- [AGENTS.md](../../AGENTS.md) §7 第 26 条实测：Hermes 上纯 JS Argon2id 首次派生 **30–40 秒**（无 JIT）；而 WidgetKit 给 `getTimeline` 的执行窗口很短（**Apple 未公开具体秒数**，见 §8）。**把 Argon2id 放进组件是行不通的。**
- 所以只剩两条路：**(a)** App Group / SharedPreferences 里放**明文**快照；**(b)** 放一份**用设备密钥加密**的快照，密钥存共享 Keychain，组件里做一次对称解密（AES-GCM 是廉价的，Argon2id 才贵）。

⚠️ 这不是纯技术选择：**选 (a) 意味着任务标题会以明文形态出现在应用私有容器之外。** 它仍在**应用自己的 App Group 容器内**、也**不经过服务端**，但不再只躺在加密 DB 里 —— 对 E2EE 产品而言这是一次**威胁模型变更**。heyta 处理这类"例外"的既有惯例是**显式记录**（参照 [ADR-0006](../adr/0006-supply-modes.md)、[ADR-0013](../adr/0013-cloud-ai-and-maas.md) 对"托管 AI 与 E2EE 互斥"的处理方式）—— **不要让它悄悄发生。**

### 5.2 锁屏可见性 = 隐私

iOS 锁屏组件、Android 16 锁屏组件、Live Activity 都是**未解锁就可见**的。一个 E2EE 产品把任务标题放到锁屏上，是用户没有预期过的一件事。需要：**默认脱敏（只显示数量）或一个明确的开关**，而不是"能显示就显示"。

⚠️ Android 那边甚至有现成的**退出机制**：`"not_keyguard"`（§4 表）。做不做锁屏组件，本身就是个决策点。

### 5.3 现有门禁**扫不到原生代码**（实测）

这是本次调研里最不显眼、但最该先修的一条 —— 它意味着组件这块的纪律**目前没有任何自动保护**：

| 门禁 | 实际扫描范围 | 组件原生代码会怎样 |
|---|---|---|
| `pnpm check:design` | `SCAN_EXT = .ts .tsx .js .jsx .css` | Swift / Kotlin / ArkTS 里的裸 hex **不会被拦** |
| `pnpm check:ui-language` | `ROOTS = apps/landing/src`、`apps/web/src`、`apps/mobile/src` | 原生组件里的硬编码文案**不会被拦**（上游也承认它的 widget chrome 是 English-only） |
| `pnpm check:layering` | `EXTENSIONS = .ts .tsx .mts .cts`，且 `SKIP_DIRS` **含 `ios` / `android`** | 原生代码里"业务上该怎么做"**不会被拦** |

🔴 **第三条最危险**：`no-op-construction-in-apps` 这条规则当初正是为了拦住"外壳自己拼 op"（当年一次抓出 17 处真实违规）。**组件会重新制造同一个诱惑** —— 原生侧已经拿到了任务列表，顺手算个"今天"、顺手写条记录，比回 JS 走 op-log 近得多。

→ 结论：**要么靠契约 + 测试守着，要么扩门禁。** 按本仓库的既有做法，扩门禁是正确方向，且必须**先用注入验证它会失败**（[AGENTS.md](../../AGENTS.md) §5 末尾："不能失败的检查没有价值"）。

### 5.4 组件是全平台第一个"原生 + 有业务语义"的代码

在组件之前，`apps/mobile` 的原生侧只有 `AppDelegate.swift` / `MainActivity.kt` 这类纯接线。组件引入的是**第一段含有产品判断的原生代码**（哪怕只是"显示哪几条"）。[AGENTS.md](../../AGENTS.md) §3.5 的判据要在这里被认真执行一次：**判断方法很直接 —— 这段代码里有没有任何一行在决定"业务上该怎么做"？有就是提取得不够。**

---

## 6. 建议的第一刀（最小可验证）

**不要按平台铺开，先按"最贵的两个未知数"切。**

### 6.1 范围

✅ 做：

- **iOS 桌面组件**：`.systemMedium` + `.systemLarge`
- **Android 桌面组件**：一个 4×2
- 内容：**只读「今天」+ 勾选完成**
- 快照契约落 `v: 1`，**三端解析器锁同一份 golden JSON**（同一份 fixture 同时喂 Kotlin / Swift 测试 —— 上游的做法，防两套解析器漂移）

❌ 不做（明确推迟）：锁屏组件、Live Activity、控制中心控件、Apple Watch、新建任务、撤销、逐任务深链、鸿蒙、macOS、Windows、跨端实时刷新

### 6.2 为什么是这一刀

它验证的是**最贵的两个未知数**，而不是最容易的部分：

1. 快照 / 队列契约在 heyta 的 op-log 上**真的成立** —— 组件勾选 → 回到前台 → **恰好一个 op**（不是两个，不是零个）。
2. §5.1 的明文快照决定**被接受**。（这一条如果不被接受，整个组件方向都要重算，越早知道越好。）

### 6.3 验收怎么写（按仓库习惯：零 mock、真设备）

新增 `pnpm verify:mobile-widget`，形状照 `scripts/verify-mobile-repeat.sh`：真模拟器 + 真服务端 + 真 `node-host` 设备。

必须有的判据：

- 组件上勾选一条 → **另一台设备**看到它已完成；
- 该实体在 op-log 里的 op 数**恰好 +1**（防"同步回来又写一遍"，[AGENTS.md](../../AGENTS.md) §3.4）；
- 快照 `v` 未知时组件**渲染空列表**，而不是渲染出半截数据（fail closed）；
- 应用进程被杀后，组件仍能显示最后一次快照，并把 pending 勾选叠加显示出来。

⚠️ 移动端验收有两个已记录的陷阱必须绕开：**只改 `packages/` 时 APK 会打进旧 JS bundle**（[AGENTS.md](../../AGENTS.md) §7 第 27 条），以及**"构建成功 ≠ 产物是新的"**（同条）。组件大部分在原生侧，但队列 drain 落在 JS 侧，两条都会踩到。

---

## 7. 需要拍板的事（ADR 候选）

| # | 要决定的 | 为什么它不能拖 |
|---|---|---|
| 1 | **快照是明文还是设备密钥加密**（§5.1） | 决定整个方向的可行性；E2EE 产品的威胁模型变更必须显式记录，不能默认 |
| 2 | **锁屏组件的默认可见性**（§5.2）；是否做锁屏组件 | 做错了是隐私事故，不是体验问题 |
| 3 | **渲染层技术栈**：原生（推荐）vs `react-native-android-widget` | 定错会把 op-log 拖进 headless 进程，且省不到 iOS 的工 |
| 4 | **是否扩门禁覆盖原生代码**（§5.3） | 不扩，则 §3 的四条不变量**只靠人读文档守**——而文档守不住（[AGENTS.md](../../AGENTS.md) §5 原话） |
| 5 | **是否为"倒数纪念日"造实体** | heyta 没有这个功能；只为组件造实体是本末倒置，但要明确说"不做" |
| 6 | **iOS bundle id / App Group ID 定名** | App Group ID 上线后极难改，旧容器数据会成孤儿（§2.1 第 1 条） |
| 7 | **是否把 macOS / Windows 壳排进 P3** | 不排，则这两端的组件永远不存在；排了，那是比组件大得多的工程 |

---

## 8. 未核实（不要当结论用）

1. **鸿蒙 / macOS / Windows 各自的精确组件清单** —— 帮助中心页签拍平，两段清单归属无法判定（§1.3）。
2. **滴答清单鸿蒙版服务卡片的实际形态**（有几款、是否可交互）。公开报道只确认它接入了 HarmonyOS NEXT 与日历视图提醒。
3. **heyta 的 op-sqlite 库文件能否被 iOS extension 从 App Group 打开。** 本方案（快照契约）**不需要**这条，但作为备选路径是否可行未做实验。
4. **macOS 14 桌面组件对 "Designed for iPad" 应用是否可用。** 这会影响"将来做 Mac 端"的成本估算。
5. **各平台应用市场对组件的审核要求**（尤其国内各安卓渠道的锁屏卡片）—— 本次未查。
6. **WidgetKit push（APNs `content-changed`）在 E2EE 下能推到什么程度** —— 推送只能告知"变了"，解密仍要设备密钥；这条与 §5.1 的决策耦合，未展开。
7. **WidgetKit `getTimeline` / AppIntent 的执行时间窗口的具体秒数** —— Apple 只公开"预算是动态的、按天分配"，**没有公开单次执行的上限秒数**（§5.1 因此只敢说"很短"，不敢给数字）。若要压着上限设计，须自己上真机测。

---

## 附：来源

**厂商事实（滴答清单）**

- 滴答清单帮助中心〈🌮 小组件〉：<https://help.dida365.com/articles/6950366960659988480>（各端组件清单、系统版本要求、FAQ）
- 滴答清单功能页：<https://ticktick.com/features?language=zh_cn>

**平台官方**

- Apple，Keeping a widget up to date：<https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date>
- Apple，Adding interactivity to widgets and Live Activities：<https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities>
- Android，Create an advanced widget（`updatePeriodMillis` ≥ 30 分钟）：<https://developer.android.com/develop/ui/views/appwidgets/advanced>
- Android，Create an app widget with Glance：<https://developer.android.com/develop/ui/compose/glance/create-app-widget>
- Android Developers Blog，Widgets on lock screen: FAQ：<https://android-developers.googleblog.com/2025/03/widgets-on-lock-screen-faq.html>
- 华为，ArkTS 卡片交互概述（定时刷新配额）：<https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-ui-widget-interaction-overview>

**候选依赖（许可证与维护性实测 2026-09-27）**

- `sAleksovski/react-native-android-widget` —— **MIT**，last commit `2026-09-20T09:05:14Z`，Release 0.22.1（2026-08-17）→ 通过 §3.1 门槛。文档：<https://saleksovski.github.io/react-native-android-widget/docs/api/register-widget-task-handler>
- `androidx/androidx`（含 Glance）—— **Apache-2.0**，last commit `2026-09-27T01:11:48Z`
- 两者均已记入 [`research/ticktick-clone-oss-research.md`](../../research/ticktick-clone-oss-research.md) §9

**仓库内证据**

- [`docs/plans/roadmap.md`](../plans/roadmap.md) —— P3「平台特有能力」：小组件 / 通知 / CalDAV，状态 ⏸
- [`docs/research/feature-matrix.md`](feature-matrix.md) —— 9.5「桌面小组件 / 移动端 Widget」标 P1，「待办类产品的留存关键」
- [`research/upstream/super-productivity/docs/android-home-screen-widget.md`](../../research/upstream/super-productivity/docs/android-home-screen-widget.md) —— 上游维护中的组件契约
- [`research/upstream/super-productivity/docs/plans/2026-07-07-ios-home-screen-widget-port.md`](../../research/upstream/super-productivity/docs/plans/2026-07-07-ios-home-screen-widget-port.md) —— 上游 iOS 移植计划（含逐项架构对照）
- [`research/upstream/super-productivity/android/app/src/main/java/com/superproductivity/superproductivity/widget/WidgetData.kt`](../../research/upstream/super-productivity/android/app/src/main/java/com/superproductivity/superproductivity/widget/WidgetData.kt) —— 快照解析器的参考实现（含 `isNull` / `takeIf` 这类边界处理）
