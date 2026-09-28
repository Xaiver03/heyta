# `apps/desktop-linux` —— Linux 原生壳（GTK4 / C）

> 状态：**已可构建、已可运行**。核心冒烟 **12/12**；窗口已在无头 Linux 上启动并截图
> —— 见 [`evidence/`](evidence/)。
> 决策依据：[ADR-0034](../../docs/adr/0034-windows-native-winui3-not-rnw.md)（"`packages/ui` 对原生壳归零"）、
> 计划：[多端原生构建计划](../../docs/plans/desktop-native-migration.md) §4。

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
# 前置（Ubuntu/Debian）
sudo apt-get install -y build-essential pkg-config \
    libgtk-4-dev libjavascriptcoregtk-4.1-dev libsqlite3-dev

# ① 打包 TS 门面（在**仓库根**跑；与另两个壳共用同一个产物）
node packages/app-host/scripts/build-native-bridge.mjs

# ② 跨语言那一层：无头冒烟（12/12，**不需要 X**）
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
| **打包 / 分发** | 未做。目前只能 `make` 出可执行文件；没有 .deb / AppImage / Flatpak |
| **系统集成** | 未做（.desktop 入口、图标主题、MIME、单实例） |
| **同步未接线** | 门面故意不传 `serverUrl` ⇒ 不建同步客户端 |
| **界面只有任务列表** | 象限 / 清单 / 标签 / 重复 / 备注编辑 / 设置都还没有门面 |
| **只在 Ubuntu 24.04 上验过** | 22.04 上 GTK4 是 4.6.9，本壳用到的是稳定 API，但**没实测** |
| **不在 JS/TS 门禁里** | `check:design` 等扫描器看不到 C |
| **`check:linux-shell` 只在 Linux 上跑** | 非 Linux 显式跳过（GTK4 装不上） |
