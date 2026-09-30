# M2 spike：原生壳 + 内嵌共享 Web UI（Windows / WinUI 3 + WebView2）

> 状态：**M2-A ✅ / M2-B ✅ / M2-C ✅ / M2-D ✅ / M2-macOS ✅（2026-09-29）**
> 上位决策：[ADR-0037](../../../adr/0037-desktop-ui-falls-back-to-webview.md)（桌面 UI 退回 M2）
> 目标机：`windows-pc`（Win11 Pro 10.0.26200，交互式 session 2，WebView2 Runtime **154.0.4258.37**）+ 本机 macOS（SwiftUI + WKWebView）

---

## 0. 一句话

**`packages/ui` 的共享 UI 在原生 WinUI 3 壳的 WebView2 里真的渲染出来了 —— 而且与原生控件同屏并存。**
（截图见 `evidence/m2a-window-ok.png`；两条任务行带 `⚠ 已逾期` / `□ 高` 徽章，那是 `TaskBadges` 的真实输出。）

## 1. 为什么做这个 spike

[ADR-0036](../../../adr/0036-main-battlefield-and-rn-single-source-ui.md) 原本的桌面路线是 RNW（RN 平台实现）。
[S1 spike](../rnw-content-island/README.md) + 我补的 v145 对照证明**RNW 原生侧在本机起不来**
（补上它要求的 MSVC v145 后**仍然是同一个 `0xC0000409`、仍然无窗口**）。
⇒ [ADR-0037](../../../adr/0037-desktop-ui-falls-back-to-webview.md) 改走 **M2：原生壳 + 内嵌共享 Web UI**。

**M2 的判据拆成两个子问题**（这是本轮自己做的决定，理由是它们可以独立证伪）：

| 子问题 | 问的是 | 状态 |
|---|---|---|
| **M2-A** | 共享 UI（`packages/ui`）能不能在**原生壳里的 WebView2** 里渲染出来？ | ✅ **通过** |
| **M2-B** | 壳能不能把**它自己的真数据**（`listTasks()`，来自 Jint + SQLite）交给这份 UI？ | ✅ **通过** |
| **M2-C** | 共享 UI 里的**交互**能不能写回壳的 SQLite？ | ✅ **通过** |
| **M2-D** | 🔴 **真应用**（`apps/web`，不只是切片）能不能在壳里 **Windows** 里跑起来、且**注册/登录前置**成立？ | ✅ **通过** |
| **M2-macOS** | 同一件事在 **macOS（WKWebView）** 上成立吗？ | ✅ **通过**，且**已接成常设门禁** |

M2-A 是门槛：**共享 UI 若在这个宿主里渲染不出来，M2 整条路就不成立**，那要重新考虑退路。

## 2. M2-A 怎么做的

| 步 | 做法 |
|---|---|
| 共享 UI 产物 | `pnpm --filter @heyta/web build` → `apps/web/dist`（3.0 MB，静态） |
| 拷到目标机 | `tar` + `scp`（**`COPYFILE_DISABLE=1` 且 `--exclude='._*'`** —— 本仓记过的 AppleDouble 坑） |
| 壳改动 | `apps/desktop-windows/HeytaWindows/MainWindow.xaml` 加一行 `<WebView2 x:Name="SharedUi" />`；`.xaml.cs` 加 `MountSharedUiAsync()` |
| 本地内容怎么服务 | **`SetVirtualHostNameToFolderMapping("heyta.local", <dist>, Allow)`** —— **不用 `file://`**：那条路下没有正常 origin，service worker / fetch / module 的行为都与真浏览器不同，测出来的"能渲染"不能代表真实形态 |
| 加载哪个页面 | `https://heyta.local/index.html?slice=1` —— 仓库**既有**的 M1 垂直切片入口（`apps/web/src/dev/universal-slice.tsx`），用**固定种子数据**渲染 `packages/ui` 的 `TaskList` |
| **断言** | 轮询 `ExecuteScriptAsync`，取**组件自己打的 testID** 计数：`[data-testid="universal-slice"]` 与 `[data-testid^="task-item-"]` |

### 🔴 为什么断言不满足于"窗口出来了"

"窗口出现了" ≠ "共享 UI 渲染出来了"。本仓反复吃过"截图看起来有东西、其实不对"的亏，
所以这里取的是**组件自己打的锚点**（`testID` → react-native-web → `data-testid`），
而不是"界面上有字"。

## 3. 实测结果

### ✅ 正常路径（`evidence/m2a-window-ok.txt`）

```
WINDOW=heyta
M2A_NOTE=M2-A：共享 UI 已渲染 "{\"slice\":1,\"rows\":4,\"title\":\"heyta\"}"
PROBE="{\"slice\":1,\"rows\":4,\"title\":\"heyta\"}"
ALIVE pid=17192
WINDOW_RECT=52,52,1152x587
PNG_SAVED=True bytes=45256
RESULT=WINDOW_OK
```

`slice:1`（切片根挂载了）+ **`rows:4`**（4 条共享任务行渲染了）。
构建：`DOTNET_EXIT=0` / 15s / **0 警告 0 错误**。

### 🔴 反假通过（`evidence/m2a-injected-empty-root.txt`）

把 `HEYTA_WEB_ROOT` 指向一个**空目录**（共享 UI 产物不存在）：

```
M2A_NOTE=M2-A：等了 20 秒仍没渲染出共享行，最后一次探测="{\"slice\":0,\"rows\":0,\"title\":\"heyta.local\"}"
PROBE="{\"slice\":0,\"rows\":0,\"title\":\"heyta.local\"}"
WEB_ROOT=C:\src\empty-web-root
```

`slice:0` / `rows:0` / `title:heyta.local`（404 页）⇒ 断言**转红**。
**同一份断言在两种输入下给出相反结论** —— 这条才是它能承重的证据。

## 4. 🔴 这个 spike 自己翻过一次车，值得记下来

**第一版的断言是错的，而它在界面上说了谎。**

`ExecuteScriptAsync` 返回的是**被 JSON 编码过一次**的字符串：
内容是 `"{\"slice\":1,\"rows\":4,...}"`，**不是** `{"slice":1,...}`。
我第一版写的是 `probe.Contains("\"rows\":")` —— 那个子串在 `\"rows\":` 里
**根本不存在**（第二引号前面有个反斜杠），于是：

> **界面明明渲染了 4 行，状态栏却写着「等了 20 秒仍没渲染出共享行」。**

这正是本仓最忌讳的形状（"界面说谎"），而且它**看起来完全正常** ——
窗口出来了、共享 UI 也画出来了，只有那行字是反的。
修法是先 `JsonSerializer.Deserialize<string>()` 取出内层 JSON 再解析（见 `ProbeRows`）。

📌 **教训**：跨语言取回一个"求值结果"时，**先把它的编码层数搞清楚**，
再用结构化解析 —— 别拿 `Contains` 去猜。这与 §7 里 `aka.ms` 那条（HTTP 200 不等于拿到 exe）
是同一类问题：**"看起来对"的判据必须被结构化验证替代**。

## 4b. M2-B：壳把自己**真数据**交给共享 UI —— ✅ 通过

### 做法

| 步 | 做法 |
|---|---|
| 桥补一个**实体级**出口 | `packages/app-host/src/native-bridge.ts` 新增 **`listTaskEntities()`** —— 返回**完整 `Task`**（不是为手写 ListView 裁出来的窄 `TaskView`） |
| C# 侧**不建模** | `AppApi.ListTaskEntitiesJson()` **原样转发**桥返回的 JSON 字符串。壳保持最薄（`apps/desktop-windows/README.md` 的纪律） |
| 壳**推**给页面 | `MainWindow.xaml.cs` 在页面加载后调 `window.__heytaSetTasks(<json>)` |
| 新增入口 | `apps/web/src/dev/shell-host.tsx`（`?shell=1`）接住并渲染 `TaskList` |
| 种一个非空的库 | 给 **smoke 工具**（不是产品壳）加了环境变量门控的播种模式：`HEYTA_SEED_DB` + `HEYTA_SEED_COUNT` |

### 结果（`evidence/m2b-window-real-data.txt`）

```
SEED_VERIFY=3                                    ← 壳的库真有 3 条
M2A_NOTE=M2-B：壳推了真数据、共享 UI 渲染了 "{\"host\":1,\"rows\":3,\"note\":\"…已收到 3 条（原始 638 字节）\"}"
PROBE="{\"host\":1,\"rows\":3,…}"
RESULT=WINDOW_OK   PNG bytes=59058
```

**截图人眼确认**（`evidence/m2b-window-real-data.png`）：**同一个窗口**里，
**手写的原生 ListView**（3 条真任务 + 复选框）与**共享 `packages/ui` 的 UI**
（同样的 3 条）**同时存在**。⇒ **一份数据、两个渲染器、一个窗口。**

### 反假通过（`pushed=0`）

把壳里"推数据"那一步注入成空操作（`if (false && _api is not null)`）→ 重编 → 跑：

```
M2A_NOTE=M2-B：20 秒内没渲染出共享行（pushed=0），最后一次探测="{\"host\":1,\"rows\":0,…}"
```

⇒ 断言**转红** ⇒ 还原（`diff` 为空）→ 复绿（`rows:3`）。
**同一份断言在两种输入下给出相反结论。**

### 🔴 这一步顺手回答了 **G4**（方案 §4.4 的"窄门面缺口"）

**答案：不会自动消失，而且缺口是实打实的。** 实测形态：

> 窄门面（`TaskView`：id/title/done/completedAt/note）**能**驱动"手写的 3 列 ListView"，
> **驱动不了共享 UI** —— 后者要完整 `Task`（优先级/截止/标签/重复/…）。

所以共享 UI 上桌面时，门面**必须**补出实体级出口 —— 就是本轮加的 `listTaskEntities()`。
⚠️ 它是**只读**的：写方向（共享 UI 的交互回到壳）**仍未设计**，别顺手加写方法
把"写通道长什么样"这个未决问题偷偷定下来。

## 4c. M2-C：共享 UI 的**交互写回**壳的 SQLite —— ✅ 通过

### 通道：用 WebView2 自己的 `postMessage` / `WebMessageReceived`

**不自造轮子** —— 官方通道已经处理好同源判定、序列化与线程切换。

| 方向 | 机制 |
|---|---|
| 宿主 → 页面（读） | `ExecuteScriptAsync("window.__heytaSetTasks(<json>)")` |
| 页面 → 宿主（写） | `window.chrome.webview.postMessage(JSON.stringify({op,id,done}))` → 壳的 `WebMessageReceived` |

**两侧都刻意不做业务判断**：页面只交"用户点了哪一条"；壳只把 op 转成 `AppApi` 调用
（背后是四端共用的 app-host）。任何一侧写"该不该变、变成什么"都等于分叉出第二份实现。

### 🔴 页面**刻意不做乐观更新**

写完等宿主把新列表推回来再重画。乐观更新会让"写失败"看起来像"写成功"（列表已经变了），
而本仓最忌讳的正是这个。**慢一点，但对得上。**

### 结果（`evidence/m2c-window-read-write.txt`）

```
WRITE_HANDLED=1     ← 壳收到并处理了 1 次写
DB_DONE=1           ← 壳**自己的 SQLite** 里已完成数 0→1
DB_TOTAL=3
WRITE_NOTE=M2-C ✅ 读+写都成立：…；写处理 1 次，库里已完成 0→1
```

🔴 **判据取的是 `_api.ListTasks()`（壳读自己的库），不是页面里的 DOM 状态** ——
DOM 变了只说明共享 UI 重画了，那与"数据真的写下去了"是两件事。

**截图人眼确认**：点完之后，**上方原生 ListView 里那条已沉的最后一位、勾选框是已勾状态**，
下方共享 UI 也按共享展示序把已完成的排到最后 —— **两个渲染器给出同一个答案**。

### 反假通过（写处理器空操作）

把 `WebMessageReceived` 的处理器注入成 `if (true) return;` → 重编 → 跑：

```
WRITE_HANDLED=0   DB_DONE=0   WRITE_NOTE=M2-C 🔴 写方向没成立
```

⇒ 断言**转红** ⇒ 还原（`diff` 为空）⇒ 复绿（`1` / `1`）。

### 🔴 这一步也抓到一个真实的两渲染器不一致

第一次跑通之后看截图发现：**写完之后只有 WebView 被推了新列表，手写的原生 ListView 没刷新**
⇒ 上方显示"全未完成"、下方显示"完成 1 条" —— **同一份数据、同一屏、两个相反的答案**。

修法是一行：写完调用 `Refresh()`。
📌 那条手写列表本来要被 M2 替换掉，**但在它被删掉之前，它不许说谎**。

## 4d. M2-D：**真应用**在壳里跑起来，且注册/登录**前置** —— ✅ 通过

### 做法：一个环境变量切换两种模式

| `HEYTA_WEB_MODE` | 加载什么 | 回答什么问题 |
|---|---|---|
| `shell`（默认） | `?shell=1` —— 只验读写通道的最小入口 | M2-A/B/C 的**机制** |
| **`app`** | 🔴 **`apps/web` 的真应用**（无 query） | 桌面端的**用户旅程**是否完整 |

两者分开是刻意的：通道要一个**确定性的最小场地**（混进真实数据层只会让失败原因变模糊）；
而旅程要的就是**真应用本身**。

### 结果（`evidence/m2d-real-app-front-loaded-auth.txt`）

```
PROBE="{\"host\":0,\"rows\":0,\"signin\":1,\"capture\":1,\"note\":\"\"}"
M2A_NOTE=M2-D ✅ 桌面壳里的真应用：注册/登录入口 1 个、采集框 1 个 —— **前置成立**（冷启动第一屏就可达）
```

**截图人眼确认**（`evidence/m2d-real-app-front-loaded-auth.png`）：
壳里画出来的是**真应用** —— hepta 标题 + **收藏箱**侧栏 + 搜索框 + 日期/倒计时 tab +
**未同步**，以及右上角**蓝色的「登录 / 注册」**。

⇒ 🔴 **桌面端冷启动第一屏就有注册/登录入口**，这正是产品负责人的硬要求
（"注册/登录一定要前置，不能藏在设置里"）。
而且这份界面**就是 `apps/web` 的构建产物** —— 与 web 字面上同一份代码。

### 反假通过（空产物目录）

把 `HEYTA_WEB_ROOT` 指向空目录（**只改环境变量，不必重编**）：

```
M2A_NOTE=M2-D 🔴 真应用没画出来（或没有前置登录入口）：{"host":0,"rows":0,"signin":0,"capture":0}
```

⇒ 断言**转红**（`evidence/m2d-injected-empty-root.txt`）。

### 🔴 这一步**不能**说明什么（重要，别读多了）

1. 🔴 **壳里的真应用用的是浏览器 IndexedDB，不是壳的 SQLite。**
   M2-C 的读写通道验的是 `?shell=1` 那个最小入口；**真应用还没有接到壳的存储上**。
   ⇒ 所以现在桌面端的形态是：**旅程 UI 完整**（含前置登录）+ **数据落在 WebView 自己的 IndexedDB 里**，
   与壳的 SQLite **是两份**。**把真应用的存储指到壳的 SQLite 是下一步。**
2. **同步未验**：应用里的"未同步"就是当前真实状态。
3. 截图里上方那条手写 ListView 显示的是**壳的** 3 条任务，下方真应用显示的是**它自己的**空库 ——
   两者**本来就不是同一份数据**（见第 1 条）。这不是 bug，是上面那条限制的可见形态。

## 4e. M2-macOS：同一个架构在 macOS 上成立 —— ✅ 通过，且**已接成常设门禁**

### 做法

| 步 | 做法 |
|---|---|
| 壳改动 | `apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift` 加 `HeytaSchemeHandler`（`WKURLSchemeHandler`）+ `SharedWebView`（`NSViewRepresentable`） |
| 加载什么 | **与 Windows 逐字相同的产物**（`apps/web/dist`）、同一个入口 `index.html` |
| 🔴 本地内容怎么服务 | **自定义 scheme `heyta-local://`** —— **不用 `file://`**。理由与 Windows 侧逐字相同（`file://` 没有正常 origin），Windows 用 `SetVirtualHostNameToFolderMapping`，macOS 的对应物就是 `WKURLSchemeHandler`。**不能双标。** |
| 断言 | `evaluateJavaScript` 取**组件自己打的 testID** 计数（`account-menu-avatar` 身份入口 / 打开菜单后的 `sync-signin-entry` / `添加任务` 采集框） |

### 结果（`evidence/m2-macos-real-app-front-loaded-auth.{png,txt}`）

```
M2_MACOS_NOTE=M2-macOS ✅ 桌面壳里的真应用：注册/登录入口 1 个、采集框 1 个 —— **前置成立**
```

**截图人眼确认**：原生 SwiftUI chrome 在上，**共享 UI 在下** —— hepta + **收藏箱** + 今天 +
搜索 + 日期/倒计时 + **未同步** + 🔴 **「登录 / 注册以…」** + 0/0。

### ✅ 已接成**常设门禁**

`check:macos-window`（已在 `pnpm check` 链路里）现在会带上 `HEYTA_WEB_ROOT` 启动壳，
并断言**壳里的真应用把注册/登录画在冷启动第一屏**。

⇒ **macOS 的"注册/登录前置"从此有常设验收，而且能因注入转红。**

### 反假通过（两处）

- **门禁级**：把门禁里的产物目录改指空目录 ⇒
  `🔴 壳里的真应用没有把注册/登录前置：…(heyta error 404.)` ⇒ **exit=1**；还原复绿、`diff` 为空。
  （`evidence/m2-macos-injected-empty-root.txt`）
- **壳级**：直接跑壳、产物指空 ⇒ `M2-macOS 🔴 主框架没加载成（provisional）：…404.`

### 🔴 这里抓到我自己一个真 bug（值得记）

macOS 侧我**只实现了 `didFail`，没实现 `didFailProvisionalNavigation`**。
而"主框架根本没加载成"（404 / 目录不存在 / 协议不支持）走的是**后者** ⇒
那条失败路径**没有任何回调**，探测不启动、证据一个字不写 ——
**看起来像"证据丢了"，而不是"断言转红了"**。

📌 教训：跨平台的**失败回调名字不一样**，只照着一个平台抄会漏；
而"漏了失败回调"的症状恰恰是**沉默**，与"这次没问题"长得一模一样。
（Windows 侧对应的是 `WebMessageReceived` + `ExecuteScriptAsync` 的异常路径，那边没问题。）

## 4f. 桌面端的**滴答导入入口**：不需要新代码，只需要一条断言（2026-09-29）

M2 之后桌面壳加载的**就是 `apps/web` 的同一份构建**，而那个构建里**早就有**导入面板。
⇒ 「三端入口」在 M2 架构下**收敛成「共享 UI 有它」** —— 这正是"UI 组件一定要复用"想要的结果。

⚠️ 但**加载成功 ≠ 那个入口可达**：设置 tab 点不点得开、面板在不在，是加载成功也照样可能假的事。
所以 macOS 的探针**分成三段**：

| 段 | 查什么 |
|---|---|
| 1 | 冷启动第一屏：**身份入口头像** `account-menu-avatar` + 采集框（**身份入口成立**） |
| 2 | **点头像 → 验身份菜单 IA**：第一项必须是 `sync-signin-entry`、必须有设置项、未登录时**不得**有 `account-menu-signout`；然后点菜单里的「设置」（按 testID 找，**不写死索引**） |
| 3 | 设置里再查 `[data-testid="ticktick-import-panel"]` / `ticktick-file` |

```
M2_MACOS_NOTE=M2-macOS ✅ 身份入口成立（头像 1 个、采集框 1 个）；
              **身份菜单合规**（第一项 sync-signin-entry、登录入口 1 个、退出登录 0 个）；
              **设置里的滴答导入面板可达**（panel=1 file=1）
```

**已接成常设门禁**：`check:macos-window` 现在两条都断言。

**反假通过**：把 `<TickTickImportPanel />` 从 `App.tsx` 摘掉 → 重建 web → 跑 ⇒
`M2-macOS 🔴 前置成立，但**设置里没有滴答导入面板**：{"panel":0,"fileInput":0}`
（`evidence/m2-macos-settings-import-injected-removed.txt`）。
⇒ 断言转红，而**第一段仍然通过** —— 证明两条断言**相互独立**。还原 + 重建 ⇒ 复绿。

⚠️ **Windows 侧的同一条断言未做**（它的真机 spike 已过 M2-D，但没接进 `pnpm check`）。

## 5. 结论与它**不能**说明的事

**能说明**（M2 的两道门槛，都已过）：
1. 原生 WinUI 3 壳能内嵌 WebView2 并**加载本地共享 UI 产物**（M2-A）；
2. `packages/ui` 的组件（含 `TaskBadges` 的徽章）在其中**真实渲染**（M2-A）；
3. **原生控件与共享 UI 同屏并存** —— 截图为证（M2-A/M2-B）；
4. 🔴 **壳的真数据（Jint + SQLite）能到达共享 UI 并驱动它渲染**（M2-B）；
5. 🔴 **共享 UI 里的交互能写回壳的 SQLite**（M2-C）—— 判据是壳读**自己的库**，不是 DOM；
6. 🔴 **真应用（`apps/web`）能在壳里跑起来，且注册/登录在冷启动第一屏就可达**（M2-D）；
7. 🔴 **同一个架构在 macOS（WKWebView）上也成立**（M2-macOS），且**已接成常设门禁**；
8. 断言**能失败** —— M2-A/M2-D/M2-macOS 注入空产物、M2-B 注入不推数据、M2-C 注入写处理器空操作，各自转红。

**不能说明**（不许当结论用）：
1. **写方向只验了"勾完成"这一种 op** —— 新建 / 删除 / 改标题 / 同步都**未接**。
2. 🔴 **真应用的存储仍是浏览器 IndexedDB**，没接到壳的 SQLite（M2-C 的通道只验了最小入口）。
3. **打包形态未验**：这次是 `dotnet build` 的开发产物 + 环境变量指路；
   MSIX 里的 `web-dist` 怎么随包走、路径怎么定，**未做**。
3. **性能未测**：WebView2 的内存与首帧时间没测。
4. **同步未验**：壳的库与远端服务器之间还不通（认证、E2EE 口令、op 上推都没接）。
5. **macOS 只验了"真应用 + 前置登录"** —— 它的 `ShellView` 还**没有**接读写通道（M2-C 那套只在 Windows 侧）。
6. **Linux 完全没做**。macOS（WKWebView）/ Linux（WebKitGTK）同理但**未做**。
6. 那次 `wapproj` 的 `MSB4019`（缺 `Microsoft.DesktopBridge.props`）**仍在** ——
   它只影响 MSIX 打包，不影响本 spike 的结论。

## 6. 复跑方法

```powershell
# 目标机上（脚本就在本目录）
powershell -File build-shell.ps1     # 构建壳（含 WebView2）
powershell -File run-m2a.ps1         # session 2 启动 + 截图 + 取回探测
powershell -File inject-empty-root.ps1   # 反假通过：空产物目录 → 断言应转红
```

前置：`C:\src\heyta-m2\{apps\desktop-windows, packages\app-host\bridge-bundle}`（由 macOS 侧 `tar` 同步）、
`C:\src\heyta-web-dist\dist`（`apps/web` 的构建产物）。

---

*本 spike 的结论建立在**两组对照**上（正常产物 / 空产物各一次真机启动）。
它们与 `evidence/` 里的截图和回执是"共享 UI 能在原生壳里渲染"这一判断的唯一依据。*
