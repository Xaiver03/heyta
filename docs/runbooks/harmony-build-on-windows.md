# 鸿蒙（RNOH）构建：在 `windows-pc` 上跑

> 状态：**三条命令，三种产物** —— 应用壳 HAP（400 KB）/ 原生侧探针（38 MB，codegen 是桩）/ **JS 侧全链路零桩（21 MB，含 hermes bundle）**（2026-11-02 实测）。

## 为什么在 Windows 上

DevEco Studio 及其 SDK/NDK/hvigor **只有 `windows-pc` 有**
（`C:\Program Files\Huawei\DevEco Studio`）。这台 Mac 上没有
（`/Applications/DevEco-Studio.app` 不存在）——所以鸿蒙构建天然属于那台机器。

⚠️ 三个既有的 `scripts/verify-harmony-*.sh` **写死了 macOS 路径**
（`DEVECO_HOME=/Applications/DevEco-Studio.app/Contents`）。它们证的是"mac 上能不能出包"；
本文件这条走的是另一台机器，**两者不要混着读**。

## 怎么跑

```bash
node scripts/build-harmony-windows.mjs           # 同步 + 构建（HAP 留在远端）
node scripts/build-harmony-windows.mjs --pull    # 再把 .hap 拉回 dist/harmony/
node scripts/build-harmony-windows.mjs --dry-run # 只打印计划
```

八个步骤，每一步失败都**响亮点名**、且**不回落本机**（本机根本没有工具链）。

## 实测读数（2026-11-01 21:4x）

| 项 | 值 |
|---|---|
| 载体 | `windows-pc`（`C:\src\heyta`，带 `node_modules`） |
| 源码 | `git archive HEAD` 覆盖过去（HEAD `ce35811a8`） |
| 产物 | `entry\build\default\outputs\default\entry-default-unsigned.hap` |
| 体积 | **400,390 bytes** |
| 内含 | `module.json` · `resources.*` · **`ets/modules.abc`（149 KB，真编译的 ArkTS 字节码）** |
| 缺 | **没有 `.so` 原生库、没有 hermes bundle** ⇒ 这是 **entry 模块**的包，不是 RNOH 全量包 |

## 一路上踩到的四个坑（都写进了脚本注释）

1. **那台上的 `C:\src\heyta` 不是 origin 的克隆**：它的 tip 是
   `bootstrap: source snapshot from macOS working tree`，`git fetch origin` 会卡住 ⇒ 用 `git archive` 覆盖。
2. **`tar -czf -` 打工作树会带上 AppleDouble**：Windows 的 bsdtar 报
   `Archive entry has empty or unreadable filename` 并**非零退出**。
3. **连 `git archive` 打全仓也不行**：`apps/mobile/evidence/` 里有**中文文件名**的 png，
   Windows tar 报 `Invalid empty pathname`（rc 仍是 0，但那些文件没落地）⇒ 路径里 `:!apps/mobile/evidence` 排除。
4. **`DEVECO_SDK_HOME` 必须显式设**：非交互 ssh 会话**不继承**图形会话的环境变量，
   hvigor 直接报 `00303217 Configuration Error: Invalid value of 'DEVECO_SDK_HOME'`。

## 第二刀：RNOH 原生侧探针（已搬过来，2026-11-02）

`node scripts/build-harmony-rnoh-windows.mjs` —— `scripts/verify-harmony-rnoh.sh` 的 Windows 移植。
**判据一条不改**，只换了载体与写法（那台机没有 `python3`，补丁改成 Node 里做）。

```bash
node scripts/build-harmony-rnoh-windows.mjs           # 推到 windows-pc 跑，OK/BAD 原样回显
node scripts/build-harmony-rnoh-windows.mjs --dry-run # 只打印计划
node scripts/build-harmony-rnoh-windows.mjs --pull    # 再把 HAP 拉回 dist/harmony/
```

它是**两段式**的：Mac 侧 `build-harmony-rnoh-windows.mjs` 只负责探活/推脚本/计数判据；
真正干活的是 `scripts/harmony-rnoh-windows-runner.mjs`（在那台上用 DevEco 自带 node 跑）。
这样分工的原因是**引号**：探针里全是 `$`、大括号和引号，直接在 ssh 命令行里拼会被吃掉一层。

### 实测读数（2026-11-02，`windows-pc`，HEAD `f49fc49f7`）

| 项 | 值 |
|---|---|
| 判据 | **24 条全绿**（`OK` 24 / `BAD` 0） |
| 产物 | `C:\hx-rnoh\proj\entry\build\default\outputs\default\entry-default-unsigned.hap` |
| 体积 | **38,386,221 bytes** |
| `librnoh_core.so` | 5,095,848 字节（RNOH 核心，本机编译） |
| `librnoh_app.so` | 3,105,296 字节（本应用原生库，本机编译） |
| `libreactnative.so` | 13,427,160 字节（RN 的 C++） |
| `ets/modules.abc` | 945,468 字节（RNOH 的 ArkTS 已编入） |
| 原生编译证据 | `BuildNativeWithNinja... after 3 min 51 s 782 ms`（日志原文，不是退出码推断） |

**变异臂（判据能红）**：把期望的 `.so` 名改成 `librnoh_app_MUTANT.so` ⇒ **`BAD 缺 librnoh_app_MUTANT.so`，23 绿 / 1 红**。
证明那三条断言**真的在翻产物的条目表**，不是恒真。

### 🔴 它**不**证明什么（与 mac 版同一条边界）

探针用**四个桩**顶替 codegen/autolinking（`autolinking.cmake` no-op、空 `PackageProvider.cpp`、
空包工厂、纯 ArkTS 入口页）。所以它只回答一件事：

> **RNOH 的 C++ 在这台机器上能不能编译，并真的打进 HAP。**

不回答"RN 应用能跑起来"，也不回答"codegen 对不对"——那是
`scripts/verify-harmony-rnoh-js.sh` 那一环（仍然只有 macOS 版）。

## 一路上踩到的坑（都写进了脚本注释 / 环境陷阱）

1. **那台上的 `C:\src\heyta` 不是 origin 的克隆**：它的 tip 是
   `bootstrap: source snapshot from macOS working tree`，`git fetch origin` 会卡住 ⇒ 用 `git archive` 覆盖。
2. **`tar -czf -` 打工作树会带上 AppleDouble**：Windows 的 bsdtar 报
   `Archive entry has empty or unreadable filename` 并**非零退出**。
3. **连 `git archive` 打全仓也不行**：`apps/mobile/evidence/` 里有**中文文件名**的 png，
   Windows tar 报 `Invalid empty pathname`（rc 仍是 0，但那些文件没落地）⇒ 路径里 `:!apps/mobile/evidence` 排除。
4. **`DEVECO_SDK_HOME` 必须显式设**：非交互 ssh 会话**不继承**图形会话的环境变量，
   hvigor 直接报 `00303217 Configuration Error: Invalid value of 'DEVECO_SDK_HOME'`。
5. **`sdk-pkg.json` 的 `displayName` 不能填进 `compatibleSdkVersion`** ⇒ `00308018`，
   真因只在 `.hvigor/outputs/build-logs/build.log`。见 [traps §7 #620](../reference/environment-traps.md)。
6. **从 Node 在 Windows 上跑带空格的 `.bat/.cmd`**：引号会被吃掉两层。见 [traps §7 #621](../reference/environment-traps.md)。

## 第三刀：JS 侧全链路（零桩）—— 已搬到这台机（2026-11-02）

`node scripts/build-harmony-rnohjs-windows.mjs` —— `scripts/verify-harmony-rnoh-js.sh` 的 Windows 移植。
这一刀把探针里那**四个桩全部拿掉**：真 `@rnoh/hvigor-plugin` 跑 codegen、真 autolinking、
真 Metro→Hermes bundle。

```bash
node scripts/build-harmony-rnohjs-windows.mjs            # 跑，OK/BAD 原样回显
node scripts/build-harmony-rnohjs-windows.mjs --dry-run   # 只打印计划
node scripts/build-harmony-rnohjs-windows.mjs --pull      # 把 release HAP 拉回 dist/harmony/
```

### 实测读数（2026-11-02，`windows-pc`，HEAD `3b3250cd2`）

| 项 | 值 |
|---|---|
| 判据 | **36 条全绿**（`OK` 36 / `BAD` 0） |
| 产物 | `C:\hx-rnjs\proj\harmony\entry\build\default\outputs\default\entry-default-unsigned.hap` |
| 体积 | **21,182,580 bytes**（成品量级判据：> 20 MiB） |
| `hermes_bundle.hbc` | 1,578,968 字节，**魔数 `0x1F1903C103BC1FC6` 对得上**（不是改了扩展名的 JS） |
| `librnoh_core.so` | 1,566,504 |
| `librnoh_app.so` | 758,864 |
| `libreactnative.so` | 3,919,088 |
| 真 codegen 证据 | `RNOHPackagesFactory.{h,ets}` / `autolinking.cmake` 三份都写着 `generated by RNOH autolinking`；另有 `generated/RNOHGeneratedPackage.h` |

⚠️ `.so` 比原生侧探针那一刀小（5.1 MB / 3.1 MB / 13.4 MB），因为这一刀是 **release**（strip 过），
那一刀是 debug。**别把两组数字当矛盾。**

**变异臂（判据能红）**：把 Hermes 魔数改成 `0xDEADBEEFDEADBEEF` ⇒
**`BAD 不是 Hermes 字节码（魔数 0x1F1903C103BC1FC6）`，35 绿 / 1 红** —— 那条断言真的在读文件头。

另外还有一次**非人造**的红，价值更高：第一版 `walk()` 找 `.hap` 时顺手跳过了 `build` 目录，
于是 release **退出码 0** 却被判成"没有产出任何 .hap"。见 [traps §7 #623](../reference/environment-traps.md)。

### 🔴 它与"能装能跑"的距离

产物是 **unsigned**，本机也没有模拟器镜像 ⇒ 三条命令都**不对「RN 应用在鸿蒙上跑得起来」下结论**。
21 MB 那份是**自包含的成品形状**（bundle 进包，不依赖 Metro），但它仍然只是一个**包**，不是一次运行。

## 三条命令的取舍

| 命令 | 体积 | 顶替了什么 | 什么时候用 |
|---|---|---|---|
| `build-harmony-windows.mjs` | 400 KB | 整个原生侧 | 只想确认应用壳（ArkTS 卡片/ability）能编 |
| `build-harmony-rnoh-windows.mjs` | 38 MB | codegen/autolinking **用桩** | 只想确认 RNOH 的 C++ 能编、能进包（快，4 分钟） |
| `build-harmony-rnohjs-windows.mjs` | 21 MB | **零桩** | 要成品形状的包时用这个 |
