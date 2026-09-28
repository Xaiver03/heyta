# ADR-0034：Windows 桌面端走 WinUI 3 / Windows App SDK 原生，而不是 react-native-windows

> 状态：**待确认**
> 日期：2026-09-28
> **全部取代** [ADR-0032](0032-windows-native-via-rnw.md)（该文选 RNW）；
> **部分取代** [ADR-0031](0031-native-apps-everywhere-not-pwa.md) §3 结论 1 的 Windows 一行
> （那里经 ADR-0032 改成 RNW，本 ADR 改成 WinUI 3）

---

## 1. 背景与约束

### 1.1 触发：唯一一条被降权的判据，正好是 ADR-0032 用来否决 .NET 的那条

产品要求（原话）：

> 「我们尽可能需要原生，包括 Windows 上面也需要原生。**哪怕是代码量偏大。**」

[ADR-0032](0032-windows-native-via-rnw.md) 是在**同一句话**下写的，但它仍然把

> 「D. .NET MAUI / WinUI 3 手写 → ✗ **第五份 UI 实现**」

写进了否决栏 —— **那条否决理由的全文就是"代码量"**。既然代码量已经明确不是判据，
这一栏就必须**重新审**，而不是沿用。

本 ADR 就是那次重审的结果。

### 1.2 🔴 决定性的新事实：RNW 停在 0.84，而 0.84 已经出了支持窗口

ADR-0032 §3.1 写了一条**前置**：

> 「🔴 **先把 RN 抬到受支持的版本，再上 RNW。**」

**这条前置是自我否定的。** 2026-09-28 复核 npm registry 实测：

```
$ curl -s https://registry.npmjs.org/react-native-windows | jq '."dist-tags"'
latest   = 0.84.0        v0.83-stable = 0.83.2   v0.82-stable = 0.82.8
preview  = 0.85.0-preview.2                      v0.81-stable = 0.81.36
$ # 稳定版 0.85 / 0.86 / 0.87 —— 全部 ABSENT
$ curl -s https://registry.npmjs.org/react-native | jq '."dist-tags".latest'
0.87.1        （发布 2026-08-26）
```

| 事实 | 值 | 来源 |
|---|---|---|
| RNW 最新稳定版 | **0.84.0**（`peerDependency: react-native 0.84.1`） | npm registry，2026-09-28 实抓 |
| RNW 有没有 0.85 / 0.86 / 0.87 稳定版 | **没有**（只有 `0.85.0-preview.2`） | 同上 |
| RN 上游最新稳定版 | **0.87.1** | 同上 |
| heyta 现在停在 | RN **0.84.1**（`apps/mobile/package.json`） | 仓库 |

⇒ **RNW 与 RN 是"版本号一一对应"的**（ADR-0032 §2 自己引的官方 support matrix）。
既然 RNW 没有 0.85+ 的稳定版，那么"把 RN 抬到受支持版本"就**等于放弃 RNW**。

**这条把 RNW 的代价重新定价了**：

| | ADR-0032 的说法 | 复核后的实际情况 |
|---|---|---|
| RNW 的代价 | "要跟 RN 发布火车走" —— 被描述成一种**未来的维护负担** | 实际上是**现在就锁死**：整个 monorepo（含 `apps/mobile`，旗舰移动端）必须**冻在 RN 0.84.1** —— 一个**已经在上游支持窗口之外**的版本 |

🔴 **这是本次推翻 ADR-0032 的唯一决定性理由。**
它**不是**"代码量"问题 —— 代码量已经被产品明确授权。
它是**产品**问题：为了 Windows 桌面的一个壳，把旗舰移动端钉死在一个拿不到 RN 修复的版本上。
"代码量偏大"授权的是一次性的量，**不授权让另一个已在交付的产品停止获得上游支持**。

### 1.3 另一条被复核推翻的说法：C3「组件 provider 只能写 C++/WinRT、且无先例」

ADR-0032 §3 把 C3 记成：

> 「RNW New Arch **不支持 C#**（官方 FAQ 原文）；而微软样例与 `tauri-plugin-widgets` 的 provider **都是 C#**
> ⇒ 意味着**没有现成样例可抄**」

"没有样例可抄"**只对 RNW 成立，不对 .NET 成立**。微软**同时**发布了 C++/WinRT 版和 **C# 版**的官方教程：

- C++/WinRT 版：<https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-win32>
  正文原文：*"This sample code in this article is adapted from the Windows App SDK Widgets Sample.
  **To implement a widget provider using C#, see [Implement a widget provider in a win32 app (C#)]**"*
- **C# 版**：<https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-cs>
  （2026-09-28 实抓 HTTP 200，标题原文 *"Implement a widget provider in a **C# Windows App**"*，
  步骤第一步就是 *"Create a new **C# console app**"*，前置为
  *"Visual Studio 2022 or later with the WinUI application development workload"*）

⇒ **"RNW 只能 C++/WinRT"是选 RNW 造成的，不是 Windows 平台的性质。**
换成 .NET 栈，这条路**有官方 C# 教程可抄**，C3 从"无先例"降为"照文档做"。

### 1.4 C1「同步 SQLite 驱动」同样是**栈相关**的，不是平台性质

ADR-0032 把 C1 记成"全计划门槛"。复核：**在 .NET 栈上这一条基本不存在。**

`Microsoft.Data.Sqlite` 是 **ADO.NET** provider，API **全同步** ——
官方文档原文（<https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/>，2026-09-28 实抓）：

> *"Microsoft.Data.Sqlite is a lightweight **ADO.NET** provider for SQLite."*
> *"This library implements the common ADO.NET abstractions for connections, commands, data readers"*
> 示例代码：`connection.Open();` / `command.ExecuteReader()` —— 同步调用，无 async 变体

而 heyta 的 `SqliteDriver`（`packages/storage/src/sqlite/sqlite-driver.ts` §17–19）要求的正是：

> 「接口故意做得很窄：只有**同步**的 `exec` / `run` / `all` / `close`。同步是有意的 ——
> 原生桥（JSI / NAPI）通常就是同步调用」

⇒ 在 .NET 栈上，"同步驱动"是**默认形态**；在 RNW 栈上，它需要写一个 C++/WinRT TurboModule
并确认 New Arch 的同步方法语义 —— **难度差一个量级，而这个差异来自选栈，不来自 Windows。**

### 1.5 C2「原生库缺口」的真实规模：heyta 只有 **4 个**原生库，不是 2716 里的 2.8%

ADR-0032 §3 用生态级数字描述 C2（"2716 个库里只有 73 个支持 Windows = 2.8%"）。
这个数字**不是 heyta 的暴露面**。实测 `apps/mobile/package.json` 依赖，逐个数：

| heyta 的原生依赖 | RN Directory 声明 Windows | 上游仓库有 `windows/` 目录 | 判定 |
|---|---|---|---|
| `@op-engineering/op-sqlite` | ❌ 未声明 | ❌ 404 | 🔴 缺口（= C1） |
| `react-native-safe-area-context` | ❌ 不在 Directory | ❌ 404 | 🔴 缺口 |
| `react-native-get-random-values` | ❌ 不在 Directory | ❌ 404 | 🔴 缺口 |
| `react-native-svg` | ❌ 不在 Directory | ✅ **200** | ✅ 有 Windows 实现 |
| 其余（`fast-text-encoding` / `lucide-react-native`） | — | 纯 JS，无原生代码 | ✅ 无缺口 |

复现：`curl` RN Directory 的 `react-native-libraries.json` 后按 `windows` 字段计数
（2026-09-28 实抓：total 2717、`windows` present=73、`macos` present=54，与调研一致），
再对每个仓库探测 `https://github.com/<repo>/tree/<HEAD>/windows` 的 HTTP 状态。

⚠️ **这条已经做成脚本，别手抄数字**：`node research/tools/windows-native-gaps.mjs`
（2026-09-28 实测输出：8 个直接依赖 → 4 个原生 → **3 个缺口**）。
脚本刻意**不自动判定"哪个包是原生模块"** —— 第一版按"上游有没有 `windows/` 目录"
一刀切，把 `react` / `fast-text-encoding` / `lucide-react-native` 这些**纯 JS** 包
全报成了缺口（7 个）。**一个会撒谎的数字比没有数字更糟**，所以原生清单是显式手维护的，
而脚本负责证明它没过期（清单条目还在不在依赖里 / 有没有声明 `codegenConfig` 的包被漏掉）。

⇒ **C2 是 3 个库，不是"整个生态"** —— 而且其中 2 个（safe-area / random-values）在桌面窗口上
语义本就接近于常量，属于**可替换**而不是"重写原生模块"。

---

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. WinUI 3 / Windows App SDK（C#）**（本 ADR 选它） | ✅ 真原生（Composition 渲染的原生控件，非 WebView）<br>✅ **不碰 RN 版本** ⇒ 移动端可以自由升级<br>✅ C1 消失（ADO.NET 同步 API）<br>✅ **C3 消失（官方 C# provider 教程）**<br>✅ 无 2.8% 生态天花板：Win32/.NET 全 API 面 | ① **另写一整套 UI**（已授权）<br>② `packages/domain` 单源问题要单独解（§3.1）<br>③ `packages/ui` 对 Windows 不再复用 | §1.2/§1.3/§1.4/§1.5；Windows App SDK NuGet `2.5.1`（widgets 要求 ≥ 2.3.1） |
| **B. RNW（ADR-0032 的原选择）** | 复用 `packages/ui` 与 TS 领域层；RN 心智与移动端一致 | 🔴 **把整个 monorepo 冻在 RN 0.84.1**（上游已不支持）—— 代价落在**移动端产品**上，不是落在代码量上<br>3 个原生库缺口<br>同步 SQLite 要写 C++/WinRT TurboModule<br>provider 只能 C++/WinRT | §1.2 |
| **C. RNW + 双 RN 版本流**（移动端升到 0.87，Windows 单独钉 0.84.1） | 保住了 RNW 的复用，又不停住移动端 | 🔴 两条 RN 工具链 + `packages/ui` 必须同时兼容两个 RN minor；RNW 侧永远停在死支线上，**只推迟不解决** | 无先例；pnpm 隔离可支持，但 Metro/Babel 版本矩阵未验证（§5） |
| **D. .NET MAUI** | 跨平台（Windows/Android/iOS 一套 XAML） | 🔴 MAUI 的**全部价值在跨平台**，而 heyta 的移动端是 RN ⇒ 那个价值用不上，只多一层抽象；Windows 上 MAUI 底下**本来就是 WinUI 3** | 选 A 即可；MAUI 不提供 A 之外的 Windows 能力 |
| **E. 保持 Electron** | 已实测可用，零新增 | 🔴 不是原生 —— Chromium + Node，正是本次要摆脱的 | [`../runbooks/desktop.md`](../runbooks/desktop.md) §5.5–§5.6 |
| **F. Tauri** | 复用 `apps/web` 最多 | 🔴 **WebView2 渲染 ⇒ UI 不是原生** | [调研 §7.2](../research/desktop-shell-selection.md) |

**"为什么不选看起来更显然的 RNW"** —— 因为它看起来显然的**唯一**理由是"版本精确对齐 0.84.1"，
而对齐到的那个版本**已经不被上游支持**，且 RNW **没有更新的稳定版可对齐**。
那条"对齐"在 2026-09-28 是**负债**，不是资产。

---

## 3. 结论

**Windows 桌面端用 WinUI 3 / Windows App SDK 原生实现（C#），新增 `apps/desktop-windows`。**
Electron（`apps/desktop`）在 Windows 侧降级为**过渡壳 / 基线 / 对照基准**，与 ADR-0032 的定位一致。

同时**接受两笔明确成本**（不藏）：

| | 成本 | 处置 |
|---|---|---|
| **C-A** | **一整套 Windows UI 要另写** | 已由产品授权（"哪怕是代码量偏大"）。按 [计划](../plans/desktop-native-migration.md) W1 的顺序：先最小切片，再铺开 |
| **C-B** | 🔴 **`packages/domain` 的单源问题** | 见 §3.1 —— **这是本 ADR 唯一真正没解决的问题**，必须由 spike 拍板 |

### 3.1 🔴 唯一未决的子问题：`packages/domain`（6603 行纯 TS 业务逻辑）怎么保持单源

`packages/domain` 23 个文件、6603 行、**纯 TS 无框架依赖**（`package.json` 原文：
"纯业务逻辑，无框架依赖"），承载四象限 / 习惯连续天数 / 番茄钟状态机 / 重复规则。
它被 web、mobile、鸿蒙、widget-core **全部复用**，是本仓最核心的资产。

C# 进程**跑不了 TS**。两条路，**由 W0 spike 拍板，本文不预先选定**：

| 子选项 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **D1. C# 移植 + 黄金夹具校验** | `packages/domain` 用 C# 重写，用**同一批 golden fixture**（本仓已有先例：`packages/widget-core/fixtures/` 被 ArkTS / Swift / Kotlin 共用）逐字节校验 | 无新运行时；C# 侧是"一等公民" | 🔴 **核心业务逻辑变成两份源** —— 不是一次性代码量，是**永久双份维护**；夹具只能抓漂移，不能免除每次改动写两遍 |
| **D2. C# UI + 内嵌 JS 引擎跑同一份 TS bundle** | `packages/domain` 照常由 tsup 打成单文件 bundle，C# 侧用 JS 引擎（如 Jint / ClearScript）在进程内执行 | ✅ **领域逻辑仍是单源**，与 web/mobile 同一份字节 | 多一个运行时依赖，需过 [AGENTS.md §3.1](../../AGENTS.md) 可维护性门槛；跨边界的数据编组成本未实测 |

⚠️ **"代码量偏大"授权的是 D1 的*一次性*体积，不是它*永久*的双份维护。**
所以 D1 不是默认答案 —— 这一点必须写清楚，否则 spike 会顺着"反正代码量无所谓"直接滑进 D1。

### 3.2 什么情况下回到 RNW

**触发条件（写死，不需要重新辩论）**：
`react-native-windows` 发布 **≥ 0.87 的 stable**（即有与一个**仍在 RN 支持窗口内**的版本
精确对齐的 release）→ 重新评估本 ADR。在那之前 RNW 不进入候选。

现在只有一个 `0.85.0-preview.2` —— **不作为交付依据**：稳定版才是可依赖的。

---

## 4. 后果

- **`apps/mobile` 保住了版本自由**：移动端可以按自己的节奏升 RN，不再被桌面壳反向锁死。
  这是本 ADR 相对 ADR-0032 的**主要收益**。
- **`packages/ui` 的价值对 Windows 归零** —— 必须如实承认。它仍服务
  web / mobile / 鸿蒙 / Electron（macOS+Linux），但**不再是"Windows 也能复用"的那个故事**。
  ADR-0024 §2.1 的方向在非 Windows 端继续成立。
- 🔴 **门禁必须同步扩张**，否则新壳就是新盲区：
  `check:design` 的 `SCAN_ROOTS`、`check:layering`、`check:native-deps`、`check:licenses`
  都要覆盖 `apps/desktop-windows`（C# 代码不在现有 JS/TS 扫描器覆盖内 ⇒
  **需要新的、语言无关的兜底**，见计划 §6）。
- **`check:licenses` 的口径要扩**：`.NET` / `Windows App SDK` / `Microsoft.Data.Sqlite` /
  `SQLitePCLRaw` 是**非 npm** 依赖，现有 `research/tools/license-inventory.mjs` 只扫 npm ⇒
  要么扩脚本，要么新开一份清单。**不能因为"扫不到"就默认合规。**
- **Windows 小组件这条路反而变短了**：C# provider 有官方教程，且 MSIX 打包是 WinUI 3 的
  标准交付形态（widgets 本身就要求 packaged app）。
- 不接受"用 Tauri 换更少代码"的反提议：Tauri 的渲染层是 WebView2，不满足"原生 UI"这个前提。

---

## 5. 未核实项

1. 🔴 **`windows-pc` 上现在没有任何 .NET 工具链。** 2026-09-28 实测（SSH →
   `powershell -NoProfile`）：

   | 探测 | 结果 |
   |---|---|
   | `dotnet --version` | **absent** |
   | `vswhere.exe`（`C:\Program Files (x86)\Microsoft Visual Studio\Installer\`） | **absent** |
   | `node --version` | `v24.19.0` ✅ |
   | `C:\src\heyta` | 存在 ✅ |
   | OS | Windows 11 专业版 |

   ⇒ **Visual Studio 2022（含 WinUI 工作负载）+ .NET SDK 是必须先装的前置**，
   而**装机本身没做**。这是 W0-1。
   ⚠️ **2026-09-28 追加实测，本条已部分推翻**：.NET SDK **10.0.401** 已用
   `winget install Microsoft.DotNet.SDK.10` 装上，且**该机从未装过 Visual Studio**
   （`C:\Program Files\Microsoft Visual Studio` 不存在）的情况下，
   一个 WinUI 3 / Windows App SDK **2.5.1** 工程 **`dotnet build` 成功**
   （0 警告 0 错误，约 46 s）。⇒ **"必须先装 VS"这条前置至少对编译不成立**，
   省掉一个 10~20 GB 的共享机安装。细节与**未证事项**（能不能开窗、CI 镜像、
   MSIX 打包路径、C# COM exe server 工程是否仍需 VS）见
   [spike README](../../research/spikes/winui3-toolchain-probe/README.md)。
2. **D1 vs D2 未拍板** —— §3.1 的 spike 没做。这是全计划真正的未知数。
   ⚠️ **2026-09-28 追加**：spike **已做**，结论见下方 §6。**D1/D2 仍未最终拍板**，
   但 D2 的"同一份字节两台引擎结果一致"这一半**已被实测证明**。
3. **WinUI 3 应用在 `windows-pc` 上能否真正起来**（含 Windows App SDK 2.5.1 的
   self-contained / framework-dependent 选择）—— 未在本机 init 过任何工程。
4. **C# `IWidgetProvider` 与 WinUI 3 主应用共存**的工程形态 —— 官方教程是"C# 控制台应用"
   起手，**没有**说它与一个 WinUI 3 主应用同 solution 时怎么组织。机制成立、组合未验证。
5. **非 npm 依赖的许可证清单**（§4）—— 没有做。
6. **`apps/desktop-windows` 的测试怎么进 `pnpm check`** —— C# 不在现有
   `pnpm -r test` / vitest 体系内，需要新的一条 `dotnet test` 通道（不在 macOS 上可跑）。
7. **Windows 打包件的可见窗口截图**仍未取得（无头会话限制，与壳无关）。

---

## 6. 追加：§3.1 领域层 spike 的实测结果（2026-09-28）

**结论：D2 的"同一份字节"这一半成立。** 复现：`bash research/spikes/domain-single-source/run.sh`（exit 0）。

| 观测 | 值 |
|---|---|
| bundle | `@heyta/domain` 自包含 IIFE，**338445 字节 / 146 个导出**，零 `require` |
| 引擎 A | **node v22.22.3 / `vm.createContext`（空沙箱）** —— 常见宿主全局（`process`/`require`/`window`/`fetch`/`Buffer`…）都定义成**一访问就抛错**的 getter |
| 引擎 B | **.NET 10.0.8 / Jint 4.16.4.0**（MIT，纯 C#，无原生依赖） |
| 用例 | **22 条，两侧都成功 22 条，结果逐条一致** |
| bundle 触碰宿主全局 | **0 次** |

用例不是"能加载"就算过，覆盖了：纯日期运算（跨月/跨年/闰年末、`daysBetween` 双向）、
**打包进来的 `ical.js` RRULE 求值**（每周一三、`BYMONTHDAY=-1`、以及 `FREQ=SECONDLY`
那条已知会抛错的保护路径）、多行 checkbox 正则、`computeTodayProgress` 的整个返回对象、
`describeRecurrence` 的中文产出。

⇒ **`packages/domain` 不需要为了 Windows 变成两份源**（D1 的主要代价因此可以避免）。

### 6.1 这个结果**没有**证明的事（不要外推）

1. **22 条用例是采样，不是全量**。Jint 对全部 ES 语法/内建的支持面**未验**；
   真正的验收要等 W1 把整个领域层接上去、用 `packages/domain` 自己的测试反过来验 C# 侧。
2. **跨引擎的浮点/大整数边界未验** —— 现有用例只有一条浮点，且恰好是二进制可精确比较的 `2/3`。
3. **性能与内存完全未测**。Jint 是解释执行；若领域层在 UI 热路径被高频调用，开销可能不可接受。
   **这一条足以让 D2 在 W1 被否掉**，所以它进 W1，不算已结清。
4. **打包形态不等价**：spike 用的是 esbuild 现场产出的 IIFE，
   而 `packages/domain` 正式的 tsup 产物是 ESM + CJS，两者是否等价未测。
5. **Jint vs ClearScript 未比较** —— 选 Jint 只因它**无原生依赖**（本决策正在为"少一个原生依赖"付代价），
   ClearScript/V8 可能更快，未测。

### 6.2 W0-2（同步 SQLite 驱动）也过了 —— C1 现在**不再是待验项**

**结论：C1 结清。** 复现：`bash research/spikes/sqlite-driver-csharp/run.sh`（exit 0）。

**未改一行的** `SqliteAdapter`（`packages/storage`）在 **.NET 10 + Jint 4.16.4** 里，
跑在 **C# 提供的同步 `SqliteDriver`**（`Microsoft.Data.Sqlite` 10.0.12）之上，
契约里最容易挂的每一条都过了：复合主键 store、唯一索引、
**`addToleratingDuplicate` 吸收冲突 = `{ok:false, reason:"duplicate"}`**、
**multiEntry 索引命中数正确**、事务提交、以及**回滚后值不存在**。
C# 侧还开了一个**新连接**独立复核盘上的库（`__heyta_seq` / `archive` / `meta` / `ops` /
`ops__mt3` / `state` + 各索引，行数对得上）—— 不信 JS 的自述。

⇒ §1.4 的判断（"C1 是**栈相关**的，不是 Windows 平台的性质"）**从推理变成了实测**。

🔴 **同时撞出两个"默认值就是错的"陷阱**（都不测就不会知道，且只在第一次真冲突时现形）：

1. **`Microsoft.Data.Sqlite` 只认具名参数**，而 heyta 的 `SqliteDriver` 契约是
   `?` **位置**占位符 ⇒ 任何 Windows 侧的真驱动都必须做 `?` → `$pN` 的翻译，
   且必须**跳过字符串字面量**里的 `?`（否则 `WHERE title = 'a?b'` 会被静默改坏）。
2. **Jint 默认把 CLR 异常冒泡给宿主、中断脚本**（官方文档原文）⇒ 而 heyta 的存储契约
   **整个建立在异常上**（驱动抛错 → 适配器回滚 → `isUniqueViolation` 吸收冲突）。
   **不打开 `CatchClrExceptions`，一条重复写入会直接杀掉整个桌面进程。**

⚠️ **仍未结清**（进 W1）：**blob（`Uint8Array`）过不了 JSON 桥** ——
契约的 `SqlValue` 含二进制，当前的 JSON 编组**根本表达不了**；
以及**完整契约重放**（`packages/storage/tests/contract/adapter.contract.ts` 的几十条断言，
本 spike 只挑了最危险的 16 步）。细节见
[spike README](../../research/spikes/sqlite-driver-csharp/README.md)。
