# S1 Spike — `react-native-windows` 作为 heyta 桌面 UI 复用机制

- **日期**：2026-09-29
- **机器**：`windows-pc`（Windows 11 Pro 10.0.26200，SSH 可达，交互式 session 2 = 用户 `41478`）
- **结论一句话**：**JS 侧成立（`packages/ui` 真的能在 `platform=windows` 下打进 Metro bundle，单源、走 token）；原生侧不成立——RNW 0.84 要求 MSVC 工具集 `v145`，本机只有 `v143`，且 `v143` 兜底构建出来的 exe 启动即 fail-fast。因此 S1-1/S1-5 未通过。**

---

## 0. 这次 spike 最初的判断错在哪

任务书给的前提里有一条**需要更正**：

> `react-native-turbo-sqlite` …… 纯 C++ TurboModule，同一份实现跨 Android/iOS/macOS/Windows

实测（npm tarball 内容，见 §3）**基本成立但不是"同一份构建"**：它有真的 `windows/ReactNativeTurboSqlite.vcxproj` + `.sln` + `cpp/windows-jsi/ReactNativeTurboSqliteJSI.h`，共享的是 `cpp/`（`TurboSqliteModule.cpp` / `DatabaseHostObject.cpp` / `sqlite3.c` / sqlcipher）。所以是**共享 C++ 源码、各自 project**。

另外，任务书没有提到、但**实测是第一个拦路虎**的东西：`react-native-windows@0.84.0` 的 CLI **依赖 `pwsh.exe`（PowerShell 7）**，本机只有 Windows PowerShell 5.1。见 §1.3。

---

## 1. `windows-pc` 工具链现状

### 1.1 一开始就有的（实测）

| 项 | 值 | 命令 |
|---|---|---|
| OS | Windows 11 Pro `10.0.26200` | `(Get-CimInstance Win32_OperatingSystem).Version` |
| 交互式会话 | `console` / `41478` / **session 2 / Active** | `query session` |
| SSH 会话 | **session 0，且 `IsAdmin=True`** | `(Get-WindowsPrincipal).IsInRole(Administrator)` |
| Node | `v24.19.0` | `node --version` |
| npm | `11.17.0` | `npm.cmd --version` |
| npx | `11.17.0` | |
| .NET SDK | `10.0.401` | `dotnet --version` |
| git | `2.55.0.windows.3` | |
| winget | `v1.29.380` | |
| Windows SDK | `10.0.26100.0`（Include + Lib） | |
| Visual Studio | **只有 VS 2022 BuildTools `17.14.37710.0`** | `vswhere -all -format json` |
| MSBuild | `…\2022\BuildTools\MSBuild\Current\Bin\amd64\MSBuild.exe` | |
| MSVC | **`14.44.35207`（= v143）**，`cl.exe` 在 `Hostx64\x64` | |
| VS 工作负载 | `Workload.VCTools`、`Workload.MSBuildTools` | `vswhere -requires` |
| VS 组件（缺） | `ComponentGroup.UWP.VC.v143`、`Workload.NativeDesktop`、`Workload.Universal`、`Windows11SDK.22621`、`Windows10SDK.19041`、`VC.ATL(MFC)` 全部 **MISSING** | |
| WindowsAppRuntime | `1.8 (8000.994.2142.0)`、`2 (2.5.1.0)` 均已安装 | `Get-AppxPackage` |
| C 盘可用 | ~134 GB | |

> ⚠️ 我第一次用 `vswhere -requires X -find '…'` 探测，得到了 4 个"MISSING"，**那是探测方式错了**：`cl.exe` 和 `MSBuild.exe` 其实都在。后来改成 `-requires <id> -property installationPath` 逐个判定才拿到上表。

### 1.2 我装了什么

| 装的东西 | 怎么装 | 为什么 |
|---|---|---|
| **PowerShell 7.6.6** | `winget install --id Microsoft.PowerShell --exact --silent` → 退出码 **0** | **RNW CLI 硬依赖 `pwsh.exe`**，见 §1.3 |
| **Windows SDK 10.0.22621.0** | `winget install --id Microsoft.WindowsSDK.10.0.22621 --exact --silent` → 退出码 **0** | 模板把 SDK 钉在 22621，缺它直接 `MSB8036` |
| 长路径 | `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1` | RNW 官方前置要求（原本是 `0`） |

### 1.3 🔴 第一个真拦路虎：RNW 0.84 的 CLI 需要 `pwsh.exe`

`npm install react-native-windows@^0.84.0` 成功之后：

```
$ npx react-native init-windows --overwrite --no-telemetry --logging
error: unknown command 'init-windows'
```

`init-windows` 是 RNW 注册的命令，而 RN CLI 会把**探测时抛异常的依赖静默丢掉**。直接 require 它的配置就能看到真正的原因：

```
$ node -e "require('react-native-windows/react-native.config.js')"
THREW: Unable to find pwsh.exe. It should have been made available by `yarn install`.

$ react-native config   →   dependencies: { "react-native-safe-area-context": ... }   # 没有 react-native-windows
```

抛出这句的文件（全仓 grep 定位）：

```
C:\src\heyta-rnw-spike\HeytaRnwSpike\node_modules\@react-native-windows\find-dotnet-tools\lib-commonjs\findDotnetTools.js
```

装完 PowerShell 7 之后，同一个 require 立刻好了：

```
OK commands= autolink-windows,codegen-windows,init-windows,run-windows
platforms= windows
```

**教训**：RN CLI 的依赖扫描失败是**静默**的，症状（`unknown command`）离根因（缺 pwsh）很远。以后遇到 RNW 命令"不存在"，第一步就是 `node -e "require('react-native-windows/react-native.config.js')"`。

### 1.4 🔴 第二个（也是真正的）拦路虎：`v145` 平台工具集

装完 pwsh 之后 `init-windows --overwrite` **成功**（退出码 0，12394 ms），生成 `windows/HeytaRnwSpike.sln` 等 29 个文件。生成的 vcxproj 里：

```xml
<PlatformToolset>v145</PlatformToolset>          <!-- HeytaRnwSpike.vcxproj:53 -->
<WindowsTargetPlatformVersion>10.0</WindowsTargetPlatformVersion>
```

本机的情况：

```
MSBuild\Microsoft\VC\v170\Platforms\x64\PlatformToolsets\   →   只有 v143
VC\Tools\MSVC\                                              →   只有 14.44.35207
winget search Microsoft.VisualStudio.2026                   →   无匹配（只有 2022 BuildTools 17.14.41）
```

#### 实测一：只补 SDK，仍然 `MSB8020`

先修掉 SDK（`MSB8036`）之后，用 **solution** 构建 app 工程（必须走 sln，因为 `ExperimentalFeatures.props` 是靠 `$(SolutionDir)` 导入的；直接构建 vcxproj 会让 `UseExperimentalNuget` 掉回 false 而去编 RNW 源码）：

```
$ MSBuild windows\HeytaRnwSpike.sln -restore -t:HeytaRnwSpike -p:Configuration=Debug -p:Platform=x64
  Discovered package 'react-native-windows' with version '0.84.0'
  Success: No auto-linking changes necessary. (32ms)
  Success: No codegen-windows changes necessary. (1ms)
error MSB8020: 无法找到 v145 的生成工具(平台工具集="v145")。
  若要使用 v145 生成工具进行生成，请安装 v145 生成工具。
  [HeytaRnwSpike.vcxproj]
MSBUILD_EXIT=1  elapsed_s=16.3
```

注意此时 autolink / codegen **都是绿的**，SDK 错误也消失了 —— **`v145` 是唯一的阻塞错误**。

#### 实测二：改 `v143` 能编能链，但**运行时崩**

把生成的 vcxproj 里 `v145` 改成 `v143`（一处）：

```
$ MSBuild windows\HeytaRnwSpike.sln -restore -t:HeytaRnwSpike -p:Configuration=Debug -p:Platform=x64
  pch.cpp
  HeytaRnwSpike.cpp
  ... JsiAbiApi.cpp / TurboModuleProvider.cpp / NodeApiJsiRuntime.cpp ...
  HeytaRnwSpike.vcxproj -> C:\src\heyta-rnw-spike\HeytaRnwSpike\windows\x64\Debug\HeytaRnwSpike.exe
MSBUILD_EXIT=0  elapsed_s=40.7
```

**16 个错误 → 0 个错误，exe 产出。** 但把 exe 放进交互式 session 2 启动：

```
=== session 2 user=41478 ===
EXE_EXISTS=True
PID=4956
EXITED_EARLY code=-1073740791
RESULT=NO_WINDOW
```

`-1073740791` = `0xC0000409` = `STATUS_STACK_BUFFER_OVERRUN`（fail-fast）。WER 报告给出精确位置：

```
事件名称: BEX64
P1: HeytaRnwSpike.exe   P2: 0.0.0.0   P3: 6abaa3be
P4: ucrtbase.dll        P5: 10.0.26100.9444   P6: 2bbefd73
P7: 00000000000a527e
P8: c0000409            P9: 0000000000000007
```

`P9 = 7` → **`FAST_FAIL_GS_COOKIE_INIT`**，故障模块是 **`ucrtbase.dll`**。

WER 的 `LoadedModule` 列表说明**崩的不是 WinAppSDK 引导**（这些全都加载成功了）：

```
LoadedModule[10]=C:\WINDOWS\System32\ucrtbase.dll
LoadedModule[16]=C:\WINDOWS\SYSTEM32\ucrtbased.dll
LoadedModule[21]=...\windows\x64\Debug\Microsoft.ReactNative.dll    ← RNW DLL 已加载
LoadedModule[23]=...\SYSTEM32\d2d1.dll
LoadedModule[26]=...\SYSTEM32\DWrite.dll
LoadedModule[29]=C:\WINDOWS\SYSTEM32\icu.dll
```

#### 我的判断（区分"实测"与"推断"）

- **实测**：`v143` 兜底能编能链，但 exe 启动时在 `ucrtbase.dll` 里 `FAST_FAIL_GS_COOKIE_INIT` fail-fast；失败点在 CRT 初始化，不在 WinAppSDK 引导。
- **推断（未证实）**：这是 **app(v143, MSVC 14.44) 与 RNW 预编译 DLL(v145, MSVC 14.5x) 工具集不一致**的典型签名。我**没有** v145 构建可以对照，所以不能把这条当成已证事实。
- **可下的结论**：**在 `windows-pc` 现状下，RNW 0.84 出不来一个能开窗口的进程。**

#### 出路是可验证存在的

```
curl.exe -o NUL -w "%{http_code}" -L https://aka.ms/vs/18/release/vs_BuildTools.exe   →   200
curl.exe -o NUL -w "%{http_code}" -L https://aka.ms/vs/17/release/vs_BuildTools.exe   →   200
```

`vs/18`（VS 2026）引导器**存在且可下载**。装它 + C++ 工作负载即可拿到 `v145`。**这次 spike 没有执行这一步**（属于独立的大动作，不是 spike 量级），所以"装了 VS 2026 之后能不能跑起来"是**未验证**。

---

## 2. S1-0…S1-5 逐条判定

| 判据 | 判定 | 证据 |
|---|---|---|
| **S1-0**（原生依赖缺口） | ✅ 通过（见 §3） | tarball 内容粒度实测 |
| **S1-1**（渲染 heyta 组件 + 真 SQLite 数据） | ⚠️ **部分通过** | JS 侧全通（bundle 成功、行来自 SQLite）；**渲染侧未通过**（无窗口） |
| **S1-2**（单源，没有第二份行组件） | ✅ 通过（bundle 级） | bundle 里 `task-item-` / `task-toggle-` 各 **1** 次 |
| **S1-3**（样式来自 design-system token） | ✅ 通过（bundle 级） | token key 全在 bundle 里，`resolveNativeTokens` 在 |
| **S1-4** | — | 任务书没定义，未做 |
| **S1-5**（RN 与 XAML 混排 + 数据互通） | ❌ **未做**（且倾向不可行） | 见 §4 |

### 2.1 做了什么的实证

`init-windows --overwrite` 成功：

```
i Using template 'cpp-app'...
new windows\HeytaRnwSpike\HeytaRnwSpike.vcxproj
new windows\HeytaRnwSpike.Package\HeytaRnwSpike.Package.wapproj
new windows\HeytaRnwSpike.sln
Success: init-windows completed. (12394ms)
INIT_WINDOWS_EXIT=0
```

我把 `packages/{ui,design-system,domain}/dist` 拷到 Windows 侧 `HeytaRnwSpike/heyta/`（沿用本仓 `packages/app-host/bridge-bundle/native-bridge.js` 的跨端共用先例），并在 `metro.config.js` 里加 `extraNodeModules`，然后在 `App.tsx` 里：

```tsx
import { HeytaUiProvider, TaskList, useHeytaTokens } from '@heyta/ui';
import rawTasks from './heyta-data/tasks.json';
```

Metro bundle **成功**：

```
$ npx react-native bundle --platform windows --dev false --entry-file index.js \
      --bundle-output windows\x64\Debug\Bundle\index.windows.bundle
LOG:Writing bundle output to: ...\index.windows.bundle
LOG:Done writing bundle output
BUNDLE_EXIT=0   elapsed_s=19.7   BUNDLE_BYTES=1895932
```

> 顺带一个真实的解析证据：第一次 bundle 失败时报的是 `Unable to resolve module ./heyta-data/tasks.json`（App.tsx:14），而 `@heyta/ui` 在 App.tsx:13 —— **Metro 已经越过 `@heyta/ui` 才在下一行失败**，说明 `@heyta/ui` / `@heyta/design-system` / `@heyta/domain` / `lucide` / `react-native-svg` / `ical.js` 这条依赖面在 RNW 的 Metro 下是**可解析**的。

### 2.2 S1-2 单源（bundle 级）

```
occurrences of "task-item-"   (TaskRow 外层 testID)      = 1
occurrences of "task-toggle-" (TaskRow 勾选框 testID)     = 1
occurrences of "row-title"    (语义文字样式)              = 15
```

`task-item-` / `task-toggle-` 是 `packages/ui/src/task-list/TaskRow.tsx` 里**唯一**的 `testID` 字面量。bundle 里各出现 **1 次**，即 RNW 应用里没有第二份行组件。

### 2.3 S1-3 设计变量

bundle 里全都在：`color.primary`、`size.row-min-height`、`size.checkbox`、`touch-target.min`、`resolveNativeTokens` —— 即样式经过 `@heyta/design-system` 的 RN token 层（`HeytaUiProvider` → `useHeytaTokens()`），不是裸值。

### 2.4 S1-1 数据来自真 SQLite

用 **`node:sqlite`**（Node 24 内置，真 SQLite 引擎）在 Windows 侧建真库、真 INSERT、真 SELECT：

```
SQLITE_FILE=C:\src\heyta-rnw-spike\HeytaRnwSpike\heyta-data\heyta-spike.sqlite
SQLITE_FILE_BYTES=12288
ROWS_RETURNED=6
FIRST_ROW_TITLE=Ship the RNW content-island spike
[["t1","Ship the RNW content-island spike",false],
 ["t2","Replace safe-area-context with a Metro alias",false],
 ["t5","Confirm v145 toolset requirement (blocked)",true],
 ["t6","Read the shared TaskRow from packages/ui",true]]
```

bundle 里能查到这些**来自 SQLite 的**标题：

```
bundle contains "Ship the RNW content-island spike" -> True
bundle contains "v145 toolset requirement"          -> True
```

> 🔴 **这里必须说清楚边界**：SQLite 的读发生在**构建前置步骤**里（`gen-tasks.cjs`），**不是 RNW 应用在运行时自己开库**。原因是应用侧没有任何 Windows SQLite 驱动（§3.1）。所以 S1-1 只能算"数据确实来自 SQLite"，**不能**算"应用实时查 SQLite"。

---

## 3. 三个原生依赖缺口的实际结论

全部按 **npm tarball 实际内容**核（不看 README），`tar tzf … | grep '^package/windows/'`：

| 依赖 | `windows/` 文件数 | 判定 | 备注 |
|---|---|---|---|
| `@op-engineering/op-sqlite@18.2.5` | **0** | ❌ **无 Windows**，证实 | 顶层只有 `android cpp ios lib node src` |
| `react-native-safe-area-context@5.10.0` | **0** | ❌ **无 Windows**，证实 | `codegenConfig` 只有 ios/android |
| `react-native-get-random-values@2.0.0` | **0** | ❌ **无 Windows**，证实 | 只有 `android ios index.web.js spec` |
| `react-native-svg@15.15.5` | **153** | ✅ **有 Windows**，证实 | 含 `windows/RNSVG/Fabric/*` |
| `react-native-turbo-sqlite@0.7.0` | **14** | ✅ **有 Windows**（比任务书预期更明确） | 见下 |

`react-native-turbo-sqlite@0.7.0` 的 Windows 侧**不是桩**：

```
windows/ReactNativeTurboSqlite/ReactNativeTurboSqlite.vcxproj      ← 完整 MSBuild 工程
windows/ReactNativeTurboSqlite.sln
windows/ReactNativeTurboSqlite/ReactPackageProvider.idl
cpp/windows-jsi/ReactNativeTurboSqliteJSI.h                        ← Windows-JSI 专用头
cpp/TurboSqliteModule.cpp  cpp/DatabaseHostObject.cpp
cpp/sqlite3.c  cpp/sqlcipher/sqlite3.c                             ← 自带 SQLite/SQLCipher
```

### 3.1 SQLite：方案能解，但**被同一个 v145 挡住**

- `react-native-turbo-sqlite` 是**首选**：MIT，有真 Windows 工程，自带 SQLite 合并源码。
- ⚠️ **但它的 Windows vcxproj 也钉了 `v145`**（我解包核过）：
  ```xml
  <PlatformToolset>v145</PlatformToolset>   <!-- react-native-turbo-sqlite/windows/…vcxproj:101 -->
  ```
  所以它**不能**绕过 §1.4 的 gate —— 这是**系统性**的，不是 RNW 模板一处的笔误。
- 自己写 RNW TurboModule（复用 `packages/storage` 的 `SqliteDriver` 端口 / 本仓已有的 `SqliteBridge.cs`）同样要过 v145。
- **结论**：SQLite 缺口**在工具链修好之后可解**；在当前机器上**解不了**。

### 3.2 safe-area-context：Metro 别名可行

桌面没有刘海，`react-native-safe-area-context` 只需要提供返回零 inset 的 `SafeAreaProvider` / `useSafeAreaInsets`。用 `resolver.resolveRequest`（或 `extraNodeModules`）把它指到一个本地 shim 即可 —— 这正是我在 §2.1 用 `extraNodeModules` 把 `@heyta/*` 指到 vendored dist 的**同一个手法**。**未被 RNW 原生构建阻塞，本次未实测**（需要窗口才能看出 inset 是否为 0）。

### 3.3 get-random-values：必须写真 TurboModule，且不能用 Math.random

`react-native-get-random-values` 无 Windows。heyta 的加密依赖真 CSPRNG，所以只能是 Win32 `BCryptGenRandom` 的极小 TurboModule（`bcrypt.dll` 在 WER 的 `LoadedModule[28]` 里已在进程中，系统自带）。**未实现、未实测**，且它同样要过 v145。

---

## 4. S1-5（RN 与原生 XAML 混排）

**判定：未做；且按 RNW 0.84 的现状，这一条比任务书预估的难得多。**

实测到的事实：

1. **RNW 0.84 只有 1 个 app 模板**。官方文档列了 4 个，但 tarball 里 `templates/` 只有 `cpp-app` 与 `cpp-lib` 两个目录，`old/` 只剩一个 `generateWrapper.js`（旧 UWP 模板按需下载）。live 的 `--template` 默认就是 `cpp-app`：
   > React Native Windows Application (**New Arch, WinAppSDK, C++)** — 一个 **Win32 窗口级** RN 应用。

2. **模板没有任何 XAML**。`HeytaRnwSpike.cpp` 的 `WinMain` 走的是：
   ```cpp
   auto reactNativeWin32App{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};
   auto appWindow{reactNativeWin32App.AppWindow()};
   appWindow.Title(L"HeytaRnwSpike");
   reactNativeWin32App.Start();
   ```
   即**整窗就是 RN**，没有 XAML 树可挂。

3. **content island 的 API 存在，但是 composition 级 + `[experimental]`**。`Microsoft.ReactNative/ReactNativeIsland.idl` 在 0.84 里有，但它：
   ```idl
   [webhosthidden] [experimental]
   runtimeclass ReactNativeIsland {
     ReactNativeIsland(Microsoft.UI.Composition.Compositor compositor);
     Microsoft.UI.Content.ContentIsland Island { get; }
     ...
   }
   ```

4. **RNW 自己是拿 HWND 挂的，不是拿 XAML 控件挂的**。`ReactNativeWindow.cpp`：
   ```cpp
   auto desktopChildSiteBridge =
       winrt::Microsoft::UI::Content::DesktopChildSiteBridge::Create(Compositor(), m_appWindow.Id());
   desktopChildSiteBridge.ResizePolicy(ContentSizePolicy::ResizeContentToParentWindow);
   desktopChildSiteBridge.Show();
   ```
   即 `DesktopChildSiteBridge`（**HWND 子窗口**）—— 不是"XAML 树里的一个元素"。

5. **不存在 XAML 树内的 ContentIsland 宿主控件**。我在本机 WinAppSDK 的 winmd 里扫过：
   ```
   HIT ContentIsland          <- microsoft.windowsappsdk.interactiveexperiences/2.1.9/.../Microsoft.UI.winmd
   HIT DesktopChildSiteBridge <- …/Microsoft.UI.winmd
   HIT ContentIsland          <- microsoft.windowsappsdk.winui/2.3.9/metadata/Microsoft.UI.Xaml.winmd
   ```
   **`ContentIslandHost` 一次都没命中。**

**含义**：要做 S1-5，得**手写一个 WinUI 3 XAML 应用**，然后用 `DesktopChildSiteBridge` 把 `ReactNativeIsland` 作为**子 HWND 贴到 XAML 元素位置上**（手工同步位置/DPI/焦点/Z 序）。任务书里"微软声称的 XAML 与 RN 并排混排"在 RNW 0.84 里**不是模板给的能力**，而是一个自研工程。

---

## 5. 截图 / 窗口

**没有成功的窗口截图。** 我没有 `read_image` 任何"RNW 窗口"图，因为**窗口从未出现**。

`schtasks /ru <user> /it` 那套投递机制本身**完全正常**（照抄 `apps/desktop-windows/scripts/capture-window.ps1`）：

```
=== session 2 user=41478 ===
EXE_EXISTS=True
PID=4956
EXITED_EARLY code=-1073740791
RESULT=NO_WINDOW
```

应用在 session 2 里**确实被启动了**（有 PID、有退出码），只是启动即崩。所以"机制可用、应用不可用"是分开的两个结论。

---

## 6. 全部未验证项与失败项的精确原因

### 失败

| # | 失败项 | 精确原因 | 证据 |
|---|---|---|---|
| F1 | 默认（v145）构建 | `error MSB8020: 无法找到 v145 的生成工具(平台工具集="v145")` | `MSBUILD_EXIT=1`, 16.3s |
| F2 | MSIX 打包工程（`*.wapproj`） | `error MSB4019: 找不到导入的项目 …\MSBuild\Microsoft\DesktopBridge\Microsoft.DesktopBridge.props` —— UWP/MSIX 打包组件未装 | MSBuild 输出 |
| F3 | Windows SDK 22621 | `error MSB8036: 找不到 Windows SDK 版本 10.0.22621.0` → **已修**（装了 SDK 22621） | 修完后该错误消失 |
| F4 | `init-windows` 未注册 | `Unable to find pwsh.exe` → RN CLI 静默丢弃 RNW → `unknown command 'init-windows'` → **已修**（装 PowerShell 7.6.6） | §1.3 |
| F5 | v143 兜底构建的 exe 运行 | 启动即 `0xC0000409` / `FAST_FAIL_GS_COOKIE_INIT`，故障模块 `ucrtbase.dll` | WER `Report.wer`，`P9=7` |
| F6 | S1-5 | 见 §4：无 XAML 模板；`ReactNativeIsland` 是 composition 级 + experimental；RNW 自己用 `DesktopChildSiteBridge`(HWND)；winmd 里无 `ContentIslandHost` | |

### 未验证

1. **装了 VS 2026 / MSVC v145 之后能否跑起来** —— 未做。引导器 `https://aka.ms/vs/18/release/vs_BuildTools.exe` 实测 HTTP **200**。
2. **F5 的因果**：我推断是 v143 app ↔ v145 DLL 的工具集不一致，**没有 v145 对照实验**，所以这只是推断。
3. **应用运行时实时查 SQLite** —— 无 Windows 驱动，未做（数据是构建期从 SQLite 导出的）。
4. **safe-area-context 零 inset shim** —— 未做（要窗口才能验）。
5. **`BCryptGenRandom` TurboModule** —— 未实现。
6. **XAML 与 RN 并排 + 数据互通** —— 未做。
7. **Release 构建 / MSIX 安装** —— 未做（wapproj 本身 F2 就过不去）。
8. **`<HeytaUiProvider>` 的真实渲染** —— bundle 成功 ≠ 渲染成功。Provider 的 `useColorScheme` / `AccessibilityInfo` 在 RNW 上是否可用，**没有运行时证据**。

---

## 7. 判断：要不要按 RNW 路线铺开 Windows

**我的判断：现在不要。先把"能不能出一个窗口"这一步单独做完，再决定。**

理由（都基于上面的实测，而不是 RNW 的定位宣传）：

1. **门槛不是版本对齐，而是工具链换血。** 任务书认为"零版本改动"就是最大优势，实测确实如此（RN 0.84.1 / React 19.2.3 与 RNW 0.84.0 的 peerDeps 完全吻合，`init-windows` 一次过）。**但真正的门是 MSVC `v145`**：它属于 VS 2026（`vs/18`），本机是 VS 2022 BuildTools 17.14。这把"评估一个 UI 复用方案"变成了"先给这台机器换一代 Visual Studio"。而且 `react-native-turbo-sqlite` 也钉 v145 —— **说明整个 RNW 0.84 生态在这一点上是一致的**，不是个别模板的疏忽。

2. **`v143` 兜底方案是假的路。** 它能编能链（16 个错误 → 0），但 exe 启动即 fail-fast。如果没有做这一步，很容易得出"改一行工具集就绕过去了"的错误结论。**"能构建" ≠ "能运行"**，这条在本次实测里被完整走了一遍。

3. **S1-5 的成本被系统性低估了。** 任务书把它当成"微软声称的能力，验一遍"。实测是：RNW 0.84 **没有 XAML app 模板**，`ReactNativeIsland` 是 composition 级 `[experimental]`，RNW 自己用 **HWND 子窗口**（`DesktopChildSiteBridge`）而非 XAML 元素挂载，且 WinAppSDK 的 winmd 里**没有** XAML 树内的 island 宿主控件。所以"RN 与 XAML 并排"不是开关，是要自己写的宿主工程（含位置/DPI/焦点/Z 序的同步）。这一条的**不确定性远大于** S1-1..S1-3。

4. **JS 侧反而是好消息，而且已经证明了。** `packages/ui` / `packages/design-system` / `packages/domain` 的 dist **零改动**就能被 RNW 的 Metro 打进 `platform=windows` bundle（1.90 MB，退出码 0），且 bundle 里只有**一份** `TaskRow`（`task-item-` / `task-toggle-` 各 1 次）、token key 齐全。**"共享 UI 层能复用"这个核心命题在 JS 侧是成立的。** 需要新增的只有那个 4 个原生依赖的适配层。

5. **桌面壳已经有一条能跑的路。** 本仓 `apps/desktop-windows` 的 WinUI 3 + `dotnet build` 路线**不需要 Visual Studio**（`capture-window.sh` 的文件头已实测记录），而且已经能出窗口、能截图。RNW 路线要换掉的是**一个已验证可用**的东西，去换一个**在 2 个独立环节（v145 工具链、XAML 混排）上都未验证**的东西。以当前证据，这个交换不划算。

### 建议的下一步（按优先级，且各自都是**小**实验）

1. **装 VS 2026 BuildTools（`https://aka.ms/vs/18/release/vs_BuildTools.exe`）+ C++ 工作负载**，只为拿 `v145`；然后**只重跑** `MSBuild -t:HeytaRnwSpike` + `schtasks` 启动 + 截图。这一步的成功/失败**单独**就能决定整条路线是否继续。
2. 如果第 1 步出窗口了：再补 S1-1（`react-native-turbo-sqlite`）、safe-area shim、`BCryptGenRandom` 模块。
3. **S1-5 单独立项**，不要混在"RNW 能不能用"里 —— 它的问题不是 RNW 能不能跑，而是"手写 XAML 宿主 + HWND 子窗口同步"值不值得。
4. 若第 1 步失败（VS 2026 装不上 / 装了还崩），**明确放弃 RNW**，继续用 `apps/desktop-windows` 的 WinUI 3 原生壳；此时把精力放在"共享 UI 层怎么让 WebView/原生各自消费"上（`packages/design-system` 的 token 层已经能跨 CSS/RN/Swift/ArkTS，这条已被本仓验证）。

---

## 附：本次用到的脚本

保留在 `scripts/`（可复用），以及 Windows 侧的产物路径：

| 路径（Windows 侧） | 内容 |
|---|---|
| `C:\src\heyta-rnw-spike\HeytaRnwSpike\` | RNW 试验工程（**不在本仓**，主检出未被污染） |
| `…\windows\x64\Debug\HeytaRnwSpike.exe` | v143 兜底构建出的 exe（启动崩，见 F5） |
| `…\windows\x64\Debug\Bundle\index.windows.bundle` | 1895932 字节，含共享 `packages/ui` |
| `…\heyta-data\heyta-spike.sqlite` | 12288 字节，真 SQLite 库（node:sqlite 建） |
| `…\heyta-data\tasks.json` | 1303 字节，由上面那条 SELECT 导出 |
| `C:\src\rnw-window.txt` | 窗口取证结果（`RESULT=NO_WINDOW`） |
| `C:\ProgramData\Microsoft\Windows\WER\ReportArchive\AppCrash_HeytaRnwSpike.ex_*` | WER 崩溃报告（F5 的原始证据） |
| `C:\src\msbuild-sln.log` / `msbuild-v143.log` | 两次构建的完整 MSBuild 日志 |