# `apps/desktop-linux` —— Linux 原生壳（GTK4 / C）

> 状态：**已可构建、已可运行**。跨语言冒烟的条数**由冒烟自己报**（本文件此前写死一个数字，六天就漂了）：
> `./heyta-smoke` 成功时打印 `HEYTA_LINUX_SMOKE=OK n/n`，`check:linux-shell` 读的就是这一行，
> 并把 `0/0` 与"缺这一行"都判红。
> ⚠️ **别拿 `grep -c 'check(' src/smoke.c` 当条数**（我今天就这么错过一次：那个数现量 22，实跑 13）——
> 每条判据的成功分支旁边都配了一条 `check(false, …)` 的失败分支，两者互斥，源码计数是**两倍上界**。
> 窗口已在无头 Linux 上启动并截图 —— 见 [`evidence/`](evidence/)。
> 决策依据：[ADR-0034](../../docs/adr/0034-windows-native-winui3-not-rnw.md)（"`packages/ui` 对原生壳归零"）、
> 计划：[Linux 端适配计划](../../docs/plans/linux-adaptation.md)（本端的工单状态与待拍点）
> 与 [多端原生构建计划](../../docs/plans/desktop-native-migration.md) §4；
> 载体操作：[Linux 载体操作手册](../../docs/runbooks/linux-dev-box.md)。

⚠️ **UI 的适配与统一不在这里**（那是另一条线在做）。这个壳只负责：
把窗口搭起来、把事件转成 `heyta_api` 调用、把错误显示出来。

---

## 0. 它替换掉了什么

替换的是 `apps/desktop`（Electron）。证据：那条路产出的
`release/heyta-linux-x64/` 里是 `chrome-sandbox` + `chrome_*.pak` + `LICENSES.chromium.html`
—— Chromium + Node，**不是原生**。

**至此七端全部是原生壳**：Windows（WinUI 3）、macOS（SwiftUI）、Linux（GTK4）、
iOS / Android（React Native + 原生小组件）、鸿蒙（RNOH + ArkTS）、Web（定义如此）。

## 1. 三层，与 Windows / macOS 两侧刻意同构

```
┌─ main.c（GTK4，需要图形会话）──────────────────────────────────┐
│  窗口、界面、把事件转成 heyta_api 调用。**一行业务规则都不许写在这里。**│
└───────────────────────────┬────────────────────────────────────┘
                            │ 同一个可执行文件内
┌─ heyta_api.c / heyta_host.c / heyta_driver.c ──────────────────┐
│  heyta_api   类型化包装（唯一 C 侧 API）                        │
│  heyta_host  JS 引擎宿主（**libjavascriptcoregtk-4.1**）        │
│  heyta_driver 同步 SqliteDriver（**libsqlite3**）              │
└───────────────────────────┬────────────────────────────────────┘
                            │ 只认识「函数名 + JSON」
┌─ packages/app-host/src/native-bridge.ts（TS，唯一真源）─────────┐
│  业务与存储全在这里，和 web / mobile / Windows / macOS **同一份**。│
└───────────────────────────────────────────────────────────────┘
```

🔴 **为什么选 `libjavascriptcoregtk-4.1`**：它与 macOS 自带的是**同一个引擎家族**。
换一个 JS 运行时（QuickJS / SpiderMonkey）意味着"引擎语义差异"这类坑要再算一遍；
用同一个引擎，那些结论直接复用。

## 2. 怎么构建、怎么跑

```bash
# 前置（Ubuntu/Debian）—— 一条幂等的脚本，缺哪格点名哪格
bash ../../scripts/linux/setup-build-host.sh --step verify
sudo bash ../../scripts/linux/setup-build-host.sh --step gtk

# ① 打包 TS 门面（在**仓库根**跑；与另两个壳共用同一个产物）
node packages/app-host/scripts/build-native-bridge.mjs

# ② 跨语言那一层：无头冒烟（**不需要 X**；条数以现量为准，见文件头）
cd apps/desktop-linux && make
HEYTA_BRIDGE_BUNDLE=../../packages/app-host/bridge-bundle/native-bridge.js ./heyta-smoke

# ③ 窗口（需要显示；无头机器见 §4）
HEYTA_BRIDGE_BUNDLE=... ./heyta-linux
```

## 3. 🔴 三端"错误怎么过边界"的完整对照

| | Windows（Jint） | macOS（JSC） | Linux（JSC, C API） |
|---|---|---|---|
| native 抛异常 | 可转成 JS `try/catch`（`CatchClrExceptions`） | ❌ 不能（Swift 也接不住 ObjC 异常） | ❌ **C 里没有异常** |
| 本壳做法 | 抛异常 | 返回**信封** | 返回**信封** |

三端因此**共用同一个 TS 侧驱动包装**（`native-bridge.ts` 的 `throwIfDriverError`）：
有信封就拆开并 `throw`，没有就走普通异常。

信封的转义**借引擎做**（`JSON.stringify`），不手写 —— 因为 SQLite 的错误消息里
**带双引号**（`near "THIS": syntax error`），手拼会得到语法坏掉的 JSON，
而 TS 侧解析失败时会当成"不是信封"**静默放过** ⇒ 错误被吞掉。

## 4. 无头 Linux 上怎么验证 GUI（Xvfb）

```bash
Xvfb :99 -screen 0 1280x800x24 &
export DISPLAY=:99 GDK_BACKEND=x11 GSK_RENDERER=cairo
HEYTA_EXIT_AFTER_MS=9000 ./heyta-linux &      # 限时自退 ⇒ 确定性，不靠 kill 时机
sleep 5 && import -window root window.png
```

⚠️ 两个不显然的点：
- **`GSK_RENDERER=cairo`**：GTK4 默认走 `ngl`（OpenGL），Xvfb 没有 GPU，
  会打印 `libEGL warning: DRI3 error`（**不是错误**）并可能渲染失败 ⇒ 显式退回软件渲染。
- **`HEYTA_EXIT_AFTER_MS`**：不让它自退的话，只能靠 `sleep` + `kill` 掐时机，
  而"截到图了吗"就变成一个碰运气的事。

## 5. 编译坑（都踩过并修了）

| 现象 | 根因 | 修法 |
|---|---|---|
| `fatal error: JavaScriptCore/JavaScriptCore.h: No such file or directory` | **`JavaScriptCore.h` 是 macOS 的伞头文件**；Linux 上同一个引擎的伞头叫 `JavaScript.h`（`libjavascriptcoregtk-4.1-dev` 里没有前者） | 新增 `src/heyta_jsengine.h` 按平台选伞头，`#ifdef` 只出现这一处 |
| `implicit declaration of JSGlobalContextGetGlobalObject` | 该函数 **macOS 专有** | 改用 `JSContextGetGlobalObject`（两端都有） |
| `implicit declaration of JSObjectGetArrayLength` | 同上，**macOS 专有** | 改成读 `length` 属性（两端语义一致） |
| `gtk_application_window_set_child` 未声明 | GTK4 里 `set_child` 在 **GtkWindow** 上，不在 GtkApplicationWindow | 改用 `gtk_window_set_child()` |
| 证据行印出 `WINDOW_SIZE=0x0` | 刚 `present` 完窗口还没被分配尺寸 | 延后 600ms 再取。**宁可不打印，也不打印一个假值** |

## 6. 已知缺口

| 缺口 | 说明 |
|---|---|
| ~~没走 M2（曾是本端最大的缺口）~~ **已走 M2（07 03:4x 运行取证 / 07 04:4x 包内取证）** | 本端现在与 mac、Windows 同构：原生 GTK4 壳 + 壳内 **WebKitGTK 6.0** WebView 加载**与其它端同一份** `apps/web/dist`（路线出处 `docs/plans/multi-end-unified-strategy.md` §4.3）。🔴 下面那份手写的 GTK 界面**不再是产品**，它现在只有一个身份：**找不到共享 UI 产物时的回退屏**（`heyta_web.c` 四处候选都落空才渲染它）。判据与读数：`check:linux-shell` 的 M2 那一档 + runbook §5.7–§5.9；台账那一格已翻 `reachable` |
| **打包 / 分发** | `.deb` 由 `scripts/package-deb.sh` 产出，入口 `pnpm build:linux <目标机>\|local`（在那台 Ubuntu 载体上跑，布局 FHS：包内 `/usr/share/heyta/web-dist` = 与其它端同一份共享 UI；取证与读数见 [runbook §5.9](../../docs/runbooks/linux-dev-box.md)）。**未做**：没有签名/更新渠道、产物没有进每轮固定收尾（`reinstall-all.sh` 的 Linux 第五端 = 计划 E7）、装进系统（`dpkg -i`）那一档（脚本默认不解包安装，取证走 `dpkg-deb -x`） |
| **系统集成** | `.desktop` 入口与图标随 `.deb` 落；MIME 关联、单实例**未做** |
| **同步未接线**（🔴 M2 **没有**关掉这一格 —— 07 05:2x 现量更正） | 共享门面 `packages/app-host/src/native-bridge.ts:38` 明写"目前不接同步：不传 `serverUrl` ⇒ `openAppHost` 不建同步客户端"。M2 换的是**界面那一层**（壳内 WebView 载共享 UI），业务接线仍然全部来自门面，所以这一格与 mac 壳同档、**不是** Linux 特有缺陷，也不该在手写壳里补。原先这行写的"M2 之后这一条随共享 UI 一起消失"是没读门面就下的结论 |
| ~~界面只有任务列表~~ **界面 = 与其它端同一份共享 UI** | M2 之后象限 / 日历 / 清单 / 标签 / 设置这些面**由 `apps/web/dist` 带进来**，不再需要逐个补原生门面（那正是 §6.3 要删手写界面的理由）。⚠️ 它们出现与否仍由**共享层的功能模块开关**决定，与 web 端同口径；壳侧的取证只证到"首屏 + 同意卡"那一屏（runbook §5.9 那张图），逐面的可达性由 `check:shell-surfaces` 的 D1–D4 管 |
| **只在 Ubuntu 24.04 上验过** | 22.04 上 GTK4 是 4.6.9，本壳用到的是稳定 API，但**没实测** |
| **门禁覆盖**（本行此前写的是"不在 JS/TS 门禁里"，只对了一半） | `check:native-bare-values.mjs` **已经把 `.c/.h` 纳入射程**（含本目录）；`check:design` 那份 JS 扫描器确实看不到 C |
| **`check:linux-shell` 只在 Linux 上跑** | 非 Linux 显式跳过（GTK4 装不上）。🔴 严格档 `HEYTA_REQUIRE_LINUX_SHELL=1`：把"跳过"一律判红 —— 这枚门禁此前在 mac 与 CI 载体上**一次都没真执行过**，那就是一枚不会失败的判据 |
