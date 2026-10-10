# `apps/desktop-macos` —— macOS 原生壳（SwiftUI / Swift）

> 状态：**已可构建、已可运行**。核心冒烟 **14/14**；窗口已在真机启动并自截屏
> —— 见 [`evidence/window-first-run.png`](evidence/window-first-run.png)。
> 决策依据：[ADR-0034](../../docs/adr/0034-windows-native-winui3-not-rnw.md)（"`packages/ui` 对原生壳归零"）、
> 计划：[多端原生构建计划](../../docs/plans/desktop-native-migration.md) §3。

⚠️ **UI 的适配与统一不在这里**（那是另一条线在做）。这个壳只负责：
把窗口搭起来、把事件转成 `AppApi` 调用、把错误显示出来。

---

## 0. 它替换掉了什么

替换的是 `apps/desktop`（Electron）。证据：那条路产出的
`release/heyta-darwin-arm64/heyta.app/Contents/Frameworks/` 里是
**`Electron Framework.framework`** —— 也就是 Chromium + Node，**不是原生**。
Electron 那两个端（macOS / Linux）正是"很难调用原生组件能力"的那一类。

## 1. 三层，与 Windows 侧刻意同构

```
┌─ HeytaMac/（SwiftUI，需要图形会话）────────────────────────────┐
│  窗口、界面、把事件转成 AppApi 调用。**一行业务规则都不许写在这里。** │
└───────────────────────────┬────────────────────────────────────┘
                            │ 同一个 Swift 目标内
┌─ HeytaShellCore/（`swift build` 就能测）───────────────────────┐
│  SqliteBridge.swift  同步 SqliteDriver（**libsqlite3，macOS 自带**）│
│  ScriptHost.swift    JS 引擎宿主（**JavaScriptCore，macOS 自带**）  │
│  AppApi.swift        类型化包装（唯一 Swift 侧 API）              │
└───────────────────────────┬────────────────────────────────────┘
                            │ 只认识「函数名 + JSON」
┌─ packages/app-host/src/native-bridge.ts（TS，唯一真源）─────────┐
│  业务与存储全在这里，和 web / mobile / Windows 壳**同一份**。      │
└───────────────────────────────────────────────────────────────┘
```

🔴 **macOS 这条路比 Windows 那条省**：JavaScriptCore 与 libsqlite3 都是
**macOS 自带**的 —— 不引第三方依赖，也就不进 NuGet/SPM 许可证清单。

## 2. 怎么构建、怎么跑

```bash
# ① 打包 TS 门面（在**仓库根**跑；产物是构建产物，不入库）
node packages/app-host/scripts/build-native-bridge.mjs
#    → packages/app-host/bridge-bundle/native-bridge.js
#    （与 Windows 壳加载的是**同一个文件**）

# ② 跨语言那一层：无头冒烟（14/14）
cd apps/desktop-macos && swift run heyta-smoke

# ③ 窗口
swift run HeytaMac
# 或**取证**（跑起来 → 自截屏 → 校验 → 与 screencapture 交叉验证 → 落 evidence）
bash apps/desktop-macos/scripts/capture-window.sh
```

前置：Xcode / Swift 6（本机实测 Swift 6.4，Xcode 27.1 beta）。

### 🔴 窗口取证：必须用 `CGWindowListCreateImage`，不能用"应用自己重绘"

三种"看起来更干净"的内进程渲染**全部实测证伪**（详见
`evidence/window-first-run.txt` 与 `Sources/HeytaMac/HeytaMacApp.swift` 的注释）：

| 方式 | 实测结果 |
|---|---|
| `view.cacheDisplay(in:to:)` | 走 AppKit `draw(_:)`；SwiftUI 文字走 **`CGDisplayList`** 私有路径拿不到 ⇒ **文字糊成横向色带** |
| `CALayer.render(in:)` | 同样拿不到 `CGDisplayList`，且是**左下原点** ⇒ 既糊又上下翻转 |
| `ImageRenderer` | SwiftUI 官方快照，但**渲染不了 `List` / `TextField` / `Toggle`** ⇒ 整片变成"禁止"占位符 |
| ✅ **`SCScreenshotManager`**（ScreenCaptureKit） | 问窗口服务器要一份**合成结果** ⇒ 文字/抗锯齿/深浅色都对，**被遮挡也不影响** |
| ~~`CGWindowListCreateImage`~~ | 能用但与 `screencapture -l` 同源；**macOS 14 起已废弃**，已迁移掉 |

⚠️ 前两种最坏的地方是**看起来很可信**：尺寸对、内容比例 ~96%、色阶 255，
空白检测完全通过 —— 只有人眼能发现字全是坏的。这也是为什么取证脚本
**内置了与 `screencapture -l<windowID>` 的交叉验证**（两者同源，尺寸必须一致）。

✅ **技术债已还清（2026-09-28）**：已从废弃的 `CGWindowListCreateImage` 迁到
**ScreenCaptureKit 的 `SCScreenshotManager`**，编译**零警告**。
代价是自截屏改成 async（`Task` + `await`），失败时显式 `exit(4)` 而不是写一张空图。

**迁移的正确性有硬证据**：新旧两个 API 产出的 PNG **sha256 逐字节一致**
（`523a6f5940d2ab9f`）—— 一个像素都没变，所以之前所有的取证结论依然成立。

## 3. 🔴 两端在"错误怎么过边界"上**不一样**（本轮最值得记的一条）

| | Windows（Jint） | macOS（JavaScriptCore） |
|---|---|---|
| native 方法抛异常 | CLR 异常默认冒泡给宿主、**中断脚本**；开 `CatchClrExceptions` 后成为 JS 可 `try/catch` 的错误 | native(JSExport) 里抛 `NSException` **不会**变成 JS 异常；而 **Swift 接不住 ObjC 异常**（直接抛 = 终止进程） |
| 本壳的做法 | 抛异常，由 Jint 转 | 返回**信封** `{"__heytaDriverError":"…"}` |

拆信封的是 TS 侧的 `throwIfDriverError`（`native-bridge.ts`），
于是**两端共用同一个驱动包装**：有信封就拆并 `throw`，没有就走异常。
判据收得很紧（必须 `{` 开头 + 能 parse 成对象 + 该键是字符串）——
松一点会把"某一行数据的值恰好是这个字符串"误判成驱动出错。

## 4. 实测证据

```
WINDOW_SIZE=900x560
WINDOW_TITLE=heyta
PNG_BYTES=82721
```

窗口底部那行是**真实数据**：`库：~/Library/Application Support/heyta/heyta.sqlite　设备：muksxxj9-1-rkqbq2pj`
—— clientId 是从 SQLite 里读出来、穿过 `app-host` 到 SwiftUI 的。库里的表和别的端一样：

```
__heyta_seq  archive  meta  ops  ops__mt3  state
```

## 5. 编译坑（都踩过并修了）

| 现象 | 根因 | 修法 |
|---|---|---|
| `cannot find 'sqlite3_open_v2' in scope` | `.linkedLibrary("sqlite3")` 只解决**链接**，不给声明 | 加 `import SQLite3`（macOS SDK 自带 module） |
| `'self' used before 'super.init' call` | `NSObject` 子类在 `super.init()` 前不能用自己的方法，而 pragma 要靠 `self.exec` 设 | `handle = opened` 之后立刻 `super.init()`，再设 pragma |
| `main actor-isolated var 'failures' can not be mutated` | Swift 6 严格并发：`main.swift` 顶层代码与顶层 `var` 都归 `@MainActor` | 辅助函数一起标 `@MainActor` |
| 从命令行起动后"像没起来" | `swift run` 的进程默认不是常规 App（无 Dock 图标、窗口不到前台） | `NSApp.setActivationPolicy(.regular)` + `activate` |

## 6. 已知缺口

| 缺口 | 说明 |
|---|---|
| **厂商契约还没在 JSC 上重放** | Windows 侧有 `check:crosslang-contract`（原样契约重放）。macOS 侧只有壳自己的冒烟；条数**不写在这里**（写过一次"14 条"，六天后就漂了），现量：`grep -c '^\s*check(' Sources/heyta-smoke/main.swift` |
| **打包 / 签名 / 公证** | 未做。目前只能 `swift run`；`.app` 打包与 Developer ID 公证都还没有 |
| **系统小组件** | 已实现原生 WidgetKit 扩展、四模板、签名打包和加密数据桥；扩展身份意图写入通过。**系统 Gallery 添加与实际按钮尚未验收通过**，见 [UX-S9-138](../../docs/plans/product-ux-optimization.md)。 |
| **同步未接线** | 门面故意不传 `serverUrl` ⇒ 不建同步客户端。要接就在 facade 加函数，不是写进 Swift |
| **界面只有任务列表** | 象限 / 清单 / 标签 / 重复 / 备注编辑 / 设置都还没有门面 |
| **不在 JS/TS 门禁里** | `check:design` 等扫描器看不到 Swift；`check:row-single-source` 也看不到 SwiftUI |
