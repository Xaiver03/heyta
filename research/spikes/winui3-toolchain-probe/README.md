# Spike：WinUI 3 到底需不需要 Visual Studio？（Windows 原生的 W0-1）

> **结论（2026-09-28 实测）**：**不需要。** 在 `windows-pc` 上，
> 只有 **.NET SDK 10.0.401 + Windows SDK 10.0.26100.0**、**完全没有 Visual Studio**
> 的机器上，一个 WinUI 3（Windows App SDK **2.5.1**）工程 **`dotnet build` 成功**
> —— *"已成功生成。0 个警告 0 个错误"*，`BUILD_EXIT=0`。
>
> ⚠️ **只证明了"能编译"，没有证明"能开窗"** —— 见下面"没有证明的事"。

---

## 为什么值得单独探一次

[多端原生构建计划](../../../docs/plans/desktop-native-migration.md) §2 决定 Windows 走
WinUI 3 / Windows App SDK 原生（[ADR-0034](../../../docs/adr/0034-windows-native-winui3-not-rnw.md)），
而微软官方文档写的**前置条件**是：

> *"Visual Studio 2022 or later with the **WinUI application development workload**."*
> —— <https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-cs>

那句前置如果成立，W0-1 就要在一台**同时是 Android 构建机**的共享 Windows 上装
一个 10~20 GB 的 VS 工作负载。**值不值得装、装在哪，取决于这句话是不是真的** ——
所以先花 46 秒测一次，而不是先装 20 GB。

## 实测环境与结果

| 项 | 值 |
|---|---|
| 主机 | `windows-pc`（Windows 11 专业版） |
| Visual Studio | **`C:\Program Files\Microsoft Visual Studio` 不存在 ⇒ 从未安装** |
| Windows SDK | `C:\Program Files (x86)\Windows Kits\10\Include` → **`10.0.26100.0`** ✅ |
| .NET SDK | 探测前**没有**；本次用 `winget install Microsoft.DotNet.SDK.10` 装上 → **10.0.401** |
| Windows App SDK | NuGet **`Microsoft.WindowsAppSDK` 2.5.1**（widgets 要求 ≥ 2.3.1） |
| 构建 | `dotnet build -c Debug` → **0 个警告 0 个错误**，`BUILD_EXIT=0`，用时 约 46 s |
| **产物** | **`HeytaWinProbe.exe` = 162304 字节**（真 PE 可执行文件）+ `HeytaWinProbe.dll` = 30208 字节 |
| XAML 编译 | 跑过了（`App.xaml` / `MainWindow.xaml` 都参与了构建） |

```
DOTNET=10.0.401
VS_INSTALL_DIR=False
WINSDK_KITS=10.0.26100.0
BUILD_EXIT=0
ARTIFACT=.\bin\Debug\net10.0-windows10.0.19041.0\win-x64\HeytaWinProbe.exe bytes=162304
ARTIFACT=.\bin\Debug\net10.0-windows10.0.19041.0\win-x64\HeytaWinProbe.dll bytes=30208
```

## 复现

```bash
scp research/spikes/winui3-toolchain-probe/probe.ps1 windows-pc:C:/src/heyta-winprobe.ps1
ssh windows-pc 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\src\heyta-winprobe.ps1'
```

脚本会在 `C:\src\heyta-winprobe` 建一个最小的 WinUI 3 工程
（`App.xaml` + `MainWindow.xaml` + `app.manifest`，unpackaged：`WindowsPackageType=None`）
并构建它。前置只有 `dotnet`（没有就 `winget install Microsoft.DotNet.SDK.10`）。

## ⚠️ 这个探测**没有**证明的事

1. 🔴 **没有证明它"能跑起来开窗"。** 这里只验了**编译**。
   跑起来还差两件事：① unpackaged WinUI 3 需要**机器上装了 Windows App SDK 运行时**
   （光有 NuGet 包不够）；② **需要一个真实桌面会话** —— 而 SSH 进来的是无会话环境。
   **"能编译"和"能开窗"是两件事**，别混（这个仓库为同类混淆付过代价，
   见 [`ci-and-runner.md` §8.1](../../../docs/runbooks/ci-and-runner.md)）。
2. **没有证明 CI 上可行。** 这里用的是交互式 SSH 到一个已登录过的机器；
   CI runner 的镜像里有没有 Windows SDK 10.0.26100.0 **未验**。
3. **没有证明 VS 完全不需要。** 编译不需要，但以下很可能仍然要 VS：
   XAML 设计器、`dotnet new` 的 WinUI 模板、MSIX 打包的 `EnableMsixTooling` 路径、
   以及 widgets 那个 **C# COM exe server** 工程（官方教程是"在 VS 里新建控制台应用"）。
   ⇒ 结论应表述为：**"命令行编译 WinUI 3 不需要 VS"，不是"这条路线不需要 VS"。**
4. **没有验 x64/arm64 的其它组合**，也没有验 release 配置与单文件发布。
5. **没有验 Windows SDK 是不是 NuGet 带进来的** —— 机器上本来就装了 10.0.26100.0，
   所以"不装 VS 也能有 SDK"这一步没被隔离验证。

## 一个自己的坑（已修）

第一版脚本把产物路径**猜**成 `bin\x64\Debug\...`，而实际是 `bin\Debug\...`
（`Platforms` 属性只在显式传 `-p:Platform` 时才参与输出路径），
于是打印了一个**假的** `EXE_EXISTS=False`。
现在改成**递归找**产物再打印，不猜路径。
