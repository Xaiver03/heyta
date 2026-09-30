# ADR-0037：桌面 UI 退回 **M2（原生壳 + 内嵌共享 Web UI）** —— RNW 路线实测不可用

> 状态：**已接受**（2026-09-29）
> 取代/收窄：[ADR-0036](0036-main-battlefield-and-rn-single-source-ui.md) §3.2 里"Windows → `react-native-windows`"那一格
> 证据：[S1 spike 报告](../research/spikes/rnw-content-island/README.md) + [多端统一方案](../plans/multi-end-unified-strategy.md) §7.1b/§7.1c
> 决定：**桌面端（Windows / macOS / Linux）的共享 UI 走"原生壳 + 内嵌 Web UI"，不走 RN 平台实现。**

---

## 1. 背景

[ADR-0036](0036-main-battlefield-and-rn-single-source-ui.md) 把"UI 单源"定为：**用 React Native 作唯一 UI 实现，
各端 RN 平台实现把它渲染成该平台的原生控件**（Windows → RNW、macOS → RN-macOS、Web → react-native-web）。
那个决定的依据是**版本对齐**：`react-native-windows@0.84.0` 的 `peerDependencies` 恰好是
`react-native 0.84.1` + `react 19.2.3`，与 heyta 的 `apps/mobile` **逐字相同** —— 当时判定"零版本改动、今天就能做"。

ADR-0036 同时**写死了门槛**：M1a 必须通过 [S1 spike](../plans/multi-end-unified-strategy.md) 的判据才能铺开，
并预写了分级处置，其中一条是「**VS 2026 装成但窗口仍崩 ⇒ 放弃 RNW 路线**」。

## 2. 实测（这是本 ADR 的全部依据）

| 步 | 实测结果 |
|---|---|
| `packages/ui` 能否进 RNW 的 Metro bundle | ✅ **能，零改动**。`platform=windows` bundle 1,895,932 B，exit 0；`task-item-`/`task-toggle-` 各出现 **1** 次（无第二份行组件）；`color.primary`/`size.row-min-height` 等 token 全在 |
| RNW 0.84 要求的工具集 | **MSVC v145（VS 2026）**，模板 `<PlatformToolset>v145</PlatformToolset>` 钉死 |
| 本机原有 | 只有 VS 2022 BuildTools（**v143**） |
| 用 v143 兜底 | 能编能链（exit 0 / 40.7s），但启动即 **`0xC0000409` FAST_FAIL_GS_COOKIE_INIT**（崩在 `ucrtbase.dll` 的 CRT 初始化），**窗口从未出现** |
| **补上 v145**（本 ADR 新增的对照） | ✅ VS 2026 BuildTools 装成（MSVC 14.51.36231、`PlatformToolsets\v145` 就位），`PlatformToolset` 还原为 v145 ⇒ **`MSBUILD_EXIT=0` / 48s / exe 3,483,136 B**（v143 那份是 3,245,568 B，两者 mtime 与大小都不同） |
| 启动 v145 产物 | 🔴 **仍然是 `0xC0000409`，仍然 `RESULT=NO_WINDOW`** |

⇒ **工具集不是变量。** 把 RNW 要求的工具集补齐之后，**崩法逐字相同**。

## 3. 备选与结论

| 备选 | 判定 |
|---|---|
| **继续查 RNW 为什么崩在 CRT** | ❌ 不选。崩点在**任何 JS 与模块加载之前**，属上游（RNW/Microsoft.ReactNative）在该机器上的启动期问题；继续投入是**赌一个未知的上游缺陷**，而不是补一个已知缺口 |
| **装"完整版" VS 2026（含 atlmfc 等全部推荐组件）再试** | ❌ 不选。⚠️ 如实记录：这次 v145 构建的 `LIB` 里有两处**不存在的路径**警告（`…\14.51.36231\atlmfc\lib\x64` 等），说明装的是精简组件集，所以"完整安装能不能跑"**未被验证**。**但工具集那一格已经被填上且没有改变结果**，加组件属于"再赌一次" |
| **改回 WinUI 3 手写 UI** | ❌ 不选。那正是"三份 UI"，违反产品负责人钉死的"**UI 组件一定要复用**" |
| ✅ **M2：原生壳 + 内嵌 Web UI** | ✅ **选它** |

**M2 的机制**：原生壳（WinUI 3 / SwiftUI / GTK4）保留"只有原生才拿得到的东西"
（窗口、菜单、托盘、通知、URL scheme、文件关联、系统小组件、钥匙串），
**UI 用一份共享实现渲染** —— 就是 `packages/ui` 经 `react-native-web` 的那份产物，
与 `apps/web` **字面上同一份代码**。

## 4. 为什么这不是"退而求其次"

M2 需要的三样东西**今天全部已就位且已被验证**：

1. **能出窗口的原生壳** —— `apps/desktop-windows` 的 MSIX **已装上、窗口已截图**
   （`apps/desktop-windows/evidence/packaged-first-run.txt`：`ADD_APPX=OK` / `RESULT=OK` / `WINDOW_RECT=1152x587`）；
   macOS 原生壳同理（`check:macos-window` 四条断言全过，窗口截图人眼确认过）。
2. **`Microsoft.Web.WebView2` 已在 NuGet 许可证清单里**（`Microsoft.Web.WebView2@1.0.3719.77`）——
   许可证这一关已经走过。
3. **共享 UI 已能被消费** —— `apps/web` 用的就是 `packages/ui` + `react-native-web`，**同一份代码**。

⇒ **M2 = 把已经在跑的 web UI，搬进已经在跑的 Windows 壳里。**

## 5. 后果（必须如实认账）

- 🔴 **接受残差**：桌面端的 UI **不是原生控件**。失去的是"原生手感"，
  以及"RN 内容岛与 XAML 并排"那条路（S1 也已实测它**不是模板能力**，
  要自己写 WinUI 3 宿主并手工同步位置/DPI/焦点/Z 序）。
  换取的是：**UI 组件真的只有一份**（产品负责人的硬要求），且**今天就能做**。
- 🔴 **ADR-0036 的"RN 全端"收窄为**：iOS / Android / 鸿蒙（已是 RN）+ Web（`react-native-web`）。
  macOS 的 `react-native-macos` 也一并搁置 —— 它落后 6 个 minor，
  而 M2 在同一套机制下**不需要它**。
- ⚠️ **S1-5（RN 与 XAML 并排）单独立项为"不做"**，理由见上：它不是模板能力。
- ✅ **S1 的证据与脚本全部保留**（`docs/research/spikes/rnw-content-island/`，442 行 README + 11 个脚本）。
  它们是"这条路走过、结论是这样"的证据 —— 删掉就等于让下一个人重走一遍。
- ✅ **复活条件（写死）**：若 RNW 发布一个在**本机这类环境上能开出窗口**的版本
  （判据：`HeytaRnwSpike.exe` 在 session 2 里不 `EXITED_EARLY`、且截到非空窗口 png），
  且 `react-native-svg` 的 Windows 工程在 New Architecture 下能产出 `OutputPath`
  （当前报 `RNSVG.vcxproj` 没有 `BaseOutputPath/OutputPath`）—— 那时可以重新评估 M1a。
  **在那之前 RNW 不进入候选。**

## 5b. M2 的门槛已实测通过（2026-09-29）

本 ADR 选 M2 时，M2 自己还是**未被验证的假设**。现已补上第一个门槛
（[spike 报告](../research/spikes/m2-webview-shell/README.md)，含截图与两份回执）：

**M2-A ✅ 通过**：`packages/ui` 的共享 UI 在 `apps/desktop-windows` 原生 WinUI 3 壳的
**WebView2** 里**真实渲染**（探测：`slice:1, rows:4`；截图里原生 chrome 与共享 UI **同屏并存**）。
**反假通过**：把产物目录指向空目录 ⇒ `slice:0, rows:0` ⇒ 断言转红。

⚠️ **仍未验**：**M2-B**（壳把真 `listTasks()` 数据交给共享 UI）、MSIX 打包形态、
性能、UI 的写入方向、macOS/Linux 两壳。

## 6. 未核实项

1. **v145 + 完整 VS 2026 组件集**能不能让 RNW 跑起来 —— 未验证（见 §3 的如实标注）。
2. RNW 崩溃的**根因**未定位 —— 只确认"崩在 CRT 初始化、且与工具集无关"。
3. `react-native-macos` 的 0.84 何时发布（tracker #3098 的 PR 仍是开的）——
   本 ADR 之后**不再阻塞任何事**，仅作记录。
4. M2 的 shell ↔ WebView 通道形态与 SQLite 归属 —— 属 M2 的 spike，见方案的 §4.3。

---

*本 ADR 的结论建立在**两组对照**上（v143 / v145 各一次真机构建 + 启动）。
它们是本仓对"原生侧不成立"这一判断的唯一依据，请勿在没有新对照的情况下推翻。*