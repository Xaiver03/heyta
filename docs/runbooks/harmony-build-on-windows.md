# 鸿蒙（RNOH）构建：在 `windows-pc` 上跑

> 状态：**能出 HAP，但是 entry 模块的包**（2026-11-01 实测）。

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

## 还差什么（下一刀）

要复现文档里那个 **20 MB 带全部原生库的 release HAP**，还需要
`verify-harmony-rnoh.sh` 那条链里的两步：**真 codegen + autolinking** 与
**`hermes_bundle.hbc` 打包**。那两步目前只有 macOS 版本，要照 `verify-harmony-rnoh.sh`
的逻辑改写成 Windows 侧（`ohpm install` 拉 RNOH 依赖 → `react-native bundle-harmony` → 再 assembleHap）。
在这两步搬过去之前，**不要把本文件产出的 HAP 当成"可安装的成品"**。
