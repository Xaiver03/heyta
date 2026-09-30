# 交接：桌面端「真应用的存储 → 壳的 SQLite」（B）+ macOS 定案（A）

> 状态：**A 已完成**（⚠️ 它的判据只覆盖**链接/锚点**一致性 —— 见 §1 的边界）；**B 已完成（两个桌面端）** —— Windows 已全绿并翻成默认；
> macOS 的 WKWebView 接线也做完了，真应用确实走壳的 SQLite，且**从壳外读到那条数据**。
> 证据：`apps/desktop-windows/evidence/storage-host/` + `apps/desktop-macos/evidence/storage-host/`。
> **B 完成了**；**D 也完成了**（`pnpm verify:web-auth` 6/6 绿，且**注入验证**过了 ——
> RP ID 从 IP 字面量换成 `localhost`；证据在 `apps/web/evidence/auth-journey/`）。
> **C 的红/绿一对都拿到了**（壳内探针走"请求登录链接 → 粘贴令牌"：
> 有效令牌 ⇒ `AUTH_STATE=signed-in`；坏令牌 ⇒ `AUTH_STATE=signed-out` + 面板说出失败原因）。
> 🔴 拿到红的路上撞上并修掉了一起**真事故**：`dist` 在浏览器里根本跑不起来
> （`Can't find variable: exports`），根因是 **gitignore 藏起来的两份 CJS 残渣** —— 见 §5。
> **macOS 窗口门禁那条缺陷也修好了**（判据改到 WebView 快照上，红/绿一对已验）。
> ✅ **产品选择已定**（2026-09-30，产品负责人）：**壳里的鉴权交给系统浏览器**
> —— 打开**我们自己的站点**做反向授权，回调把会话带回壳（见 §6.6）。
> 四件事 A/B/C/D 全部交付；§6.6 另附**鉴权机制清点**（邮箱+密码这条路**目前不存在**）。
> 🔴 另有一条**顺带发现的缺陷**待修（macOS 窗口门禁假绿）——见 §5 末尾。
> ✅ **当前 Goal（2026-09-30 起）：邮箱全链路 + 桌面鉴权走系统浏览器反向授权 + 手机号预留。**
> **web 那条腿已经全绿**（`node scripts/verify-email-web-chain.mjs`，9/9）；
> 本轮把那个长期没人盯的"点了邮件链接回来还是未登录"**定位到根因并修掉了** ——
> 确认页与应用**分属两个 agent cluster**（服务端 helmet 的 COOP/OAC vs 静态产物没有），
> `sessionStorage` 跨不过去 ⇒ 会话改走 **URL fragment**。2×2 证据见 §10。
> 🔴 **未做**：Windows 壳侧的反向授权接线、手机号预留、真实 SMTP 实跑、真系统浏览器的人工那一跑。
> 交接日期：**2026-09-30**（CST）
> 给**全新会话**用：不从聊天记录继承任何前提。每条都带可复现命令或实测输出。
>
> 🔴 本文只记**当前停在哪**与**下一步怎么走**，不重复已定下的决策。那些在
> [`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) §4.2/§4.3、
> [`ADR-0037`](../adr/0037-desktop-ui-falls-back-to-webview.md)、
> [`BLOCKED.md` 第 3 项](../../BLOCKED.md)、`AGENTS.md §7` 里。

---

## 0. 一句话现状

产品负责人钉死「**主战场 = 移动端 + macOS + Windows，Web 不是**」，先按顺序兑现了 A/B/C/D
（A 定案 macOS 机制 → B 桌面存储接到壳 SQLite → C 补 macOS 登录后旅程 → D 解 RP-ID 阻塞），
**四件全部交付**；随后转入**当前 Goal**（§10）。

| # | 事 | 状态 |
|---|---|---|
| **A** | macOS 目标机制 = **M2**（原生壳 + 壳内 WebView 加载共享 UI），并给出可判定的重开条件 | ✅ |
| **B** | 桌面两端真应用的数据写进**壳自己的 `heyta.sqlite`**（页侧报 `STORAGE=shell`；壳外扫得到载荷与 `ops` 表；重启后还在） | ✅ 两端 |
| **C** | macOS 登录后旅程（壳内探针：有效令牌 ⇒ `AUTH_STATE=signed-in`；坏令牌 ⇒ 说出失败原因） | ✅ 红/绿一对 |
| **D** | RP ID 从 IP 字面量换成 `localhost`（Chromium 拒收 IP 字面量）⇒ `verify:web-auth` 6/6 + 注入 | ✅ |
| **当前 Goal** | 邮箱全链路 + 桌面鉴权**走系统浏览器反向授权** + 手机号**预留** | 🟡 **web 腿已绿；Windows 壳侧与手机号预留未做**（§10） |

⚠️ 两件"看着像问题、其实不是"的：`pnpm check` 不是全绿（§6.5），
以及 macOS 目标里的"同 shell 的第二个窗口"（§7）。

---

## 1. A：已完成（可当作事实，不用重做）

**结论**：macOS = **M2**（SwiftUI 原生壳 + 壳内 WKWebView 加载共享 UI），
**不是**"过渡到 RN-macOS 原生控件"。两条依据：

1. `react-native-macos` 最新 `0.81.9`、peer **精确锁** `react-native@0.81.6`，而 heyta 在 `0.84.1`
   ⇒ 要用它得把 `apps/mobile` 降到 0.81 或维护两条 RN 版本流。上游 RN 已 0.87.1，落后 6 个 minor，
   追赶 tracker `microsoft/react-native-macos#3098` **没有承诺日期**。
2. 🔴 **"等版本对齐"本身不是充分条件**：RNW **就是**版本逐字对齐的（`0.84.0` ↔ RN `0.84.1`），
   补上它要求的 MSVC v145 后**仍然崩在 CRT、窗口从未出现**。

**重开条件（三条同时满足才重开）**：① `react-native-macos` 发布 peer 与 heyta 当前 minor 对齐的版本且不需要降级；
② 一次 spike 证明**能出窗口**（不是"能编过"）+ **能渲染 `packages/ui`** + **交互能写回壳存储**；
③ 有人看过截图且判据能因注入转红。**只满足①不算**。

改动落点（都在 `docs/` 里）：`plans/multi-end-unified-strategy.md` §4.2 目标态表 + §4.3 机制表/定案；
`adr/0036-…md` 状态行与 §3.2 表；`research/multi-platform-best-practice.md` 顶部追注；
`plans/desktop-native-migration.md` 顶部追注。
**验证**：`node research/tools/docs-link-check.mjs` ⇒ `✅ 无死链、无失效章节引用、无失效锚点`（exit 0）。

⚠️ **这条判据的边界（实测，2026-09-30）**：它抓的是**链接与锚点**，**不抓正文里的 `§N` 引用**。
- 注入「坏掉一个链接」⇒ `🔴 发现 1 个死链`、exit 1 ✅（能转红）；
- 注入「把 `§4.2` 改成不存在的 `§4.99`」⇒ **exit 0**（放过）。
⇒ 「两份文档的冲突已消除」这件事**不是**这条检查证得了的：它**只**保证引用不断；
  结论本身是靠**读内容**得出的（人/agent 复核）。**别把它读成"检查通过 = 结论正确"。**

---

## 2. B：已经做完并**验证过**的部分（别重做）

B 的目标：桌面壳（Windows/macOS）里**真应用的数据**要落在**壳自己的 `heyta.sqlite`**，
而不是 WebView 自己的 OPFS。

### 2.1 关键发现：**不用写新桥**

`packages/storage` 的 Worker 桥**本来就是传输无关的**：
`serveOpLogWorker(port)` / `createWorkerOpLogStore(worker)` 只吃 `postMessage` / `onmessage`。
所以桌面端换的只是**传输**，桥与 `OpLogStore` 契约一行没改。

### 2.2 三个必须记住的技术事实（都是实测踩出来的）

| # | 事实 | 后果 |
|---|---|---|
| 1 | 🔴 **裸 JSON 过不了宿主边界**：`markUploaded(ReadonlyMap)` 的 `Map` 在 JSON 里变成 `{}` | 13 条存储契约同时红（`serverSeqsByOpId is not iterable`）⇒ 必须有线码 |
| 2 | 🔴 线码自己踩过一个坑：`undefined` 的盒子第一版只写 **1 个键**，而解码侧 `isBox` 要求**恰好 2 个** | `getAllOps(range)` 的 `range` 从 `undefined` 变成真值对象 ⇒ 读回空数组，而写入/seq/队列全正常 ⇒ **"写进去了但读不出来"**（12 条红） |
| 3 | 🔴 **只允许一个引擎**：`openAppHost()` 会建 `OpLogEngine`；而 `app` 模式里引擎属于**页侧真应用** | 两个引擎同库会各自为政（向量时钟 / `appliedOpIds` 漂移）⇒ 壳在 `app` 模式**不得**调 `open()` |

### 2.3 已完成清单

| 层 | 交付 | 判据 / 验证 |
|---|---|---|
| **存储层** | `packages/storage/src/sqlite/oplog-wire-codec.ts`：`encodeOpLogWire` / `decodeOpLogWire` / **对称的** `createOpLogWirePort`（两侧各包一次）；随桥一起从 `@heyta/storage` 主入口导出 | `packages/storage/tests/contract.spec.ts` 新增「宿主边界（**裸 JSON + 两侧线码** = WebView 传输）」契约项 ⇒ **252/252 全绿**（用的是壳将要用的**真**包装器） |
| **页侧** | `apps/web/src/lib/oplog.ts`：`StorageBackend` 加 `'shell'`（**宿主注入 `__heytaHostStoragePort` 才走它**，优先于 `VITE_HEYTA_STORAGE`）；`openStorage()` 第三分支 = `createOpLogWirePort(端口)` → 复用**同一个** `createWorkerOpLogSession`；**主动催 `ready`**（`oplog-hello` 每 200ms 一次，直到 ready 到达 —— 否则壳推早了就永久卡启动） | `apps/web/tests/storage-backend-shell.spec.ts` **3/3**；**变异**：端口判定改 `if (false && …)` ⇒ **恰好 2 条红**；web 套件 **993 通过**、storage **314** |
| **壳侧桥** | `packages/app-host/src/host.ts` 新增 `openOpLogStore()`（**不建引擎**，与 `openAppHost` **共用同一段配方**）；`native-bridge.ts` 新增 `openOpLog()`（返回**库给出的** clientId）与 `handleHostMessage({messageJson}) → {outboundJson[]}`（收一条回多条；`hello` ⇒ 回 `ready`；请求 ⇒ 用**与 Worker 桥同一个** `handleOpLogWorkerRequest`）；`AppApi` 加 `OpenOpLog` / `HandleHostMessage`（**C# 只搬字符串**） | `apps/desktop-windows/smoke`：**21 项全绿、exit 0**，本机即可跑（`dotnet 10.0.108`）：<br>`HEYTA_BRIDGE_BUNDLE=$PWD/packages/app-host/bridge-bundle/native-bridge.js dotnet run -c Release --project apps/desktop-windows/smoke/Smoke.csproj`<br>🔴 判据本体：**用 `SqliteBridge` 从 C# 独立读那个 `.sqlite`，`ops` 表里有行**（不经 TS 栈）<br>**变异**：`openOpLog` 假装成功但不建 store ⇒ `invokeOpLog` 响亮抛错 |
| **同步管线** | `scripts/lib/sync-windows-sources.sh`：**把 `bridge-bundle/native-bridge.js` 加进同步清单**，并加**第二个新鲜度锚点**（它不入库、csproj 只"拷贝已存在的那个" ⇒ 早先会静默用**旧桥**） | 实测输出：`✅ 远端新鲜度对账通过（web-dist/index.html=abf3193c… bridge=4fad40c9…）` |
| **C# 接线** | `MainWindow.xaml.cs`：`_webMode` 上提到构造函数；`_storageHostEnabled = app 模式 && HEYTA_SHELL_STORAGE=1`；`TryInitialize(openHost:)` 在存储宿主模式下**不打开壳的引擎**；`AddScriptToExecuteOnDocumentCreatedAsync` 注入 shim；`WebMessageReceived` 里把消息转 `HandleHostMessage` 并 `PostWebMessageAsJson` 回每一条；证据里加 **`STORAGE=`** | shim **已确认注入成功**（页面里 `typeof window.__heytaHostStoragePort === 'object'`，键为 `postMessage`/`addEventListener`）；`STORAGE=` 这一格**当场抓到了一次真配置错**（见 §4 教训 2） |

### 2.4 ✅ Windows 端已验到绿（2026-09-30 实测，证据已入库）

真机（`windows-pc`）带着 `-ShellStorage` 启动壳之后，**三步判据全过**：

```
① 壳自带的事实：   RESULT=OK   cdp_browser=Edg/154.0.4258.37   shell_storage=True
② 页侧自己报告：   BACKEND=shell
   壳的 STORAGE 行：STORAGE=shell / STORAGE_HOST=on / DB_DONE=-1 / DB_TOTAL=-1
③ 从**壳外**扫那个库（PowerShell 直接扫字节，不用 sqlite3 CLI）：
   MAIN bytes=4096  title=False ops_table=False
   WAL  bytes=168952 title=True  ops_table=True     ← 载荷与 CREATE TABLE "ops" 都在
④ 重启之后还在：   scripts/verify-shell-storage-windows.mjs --expect <标题>
                   ⇒ RESULT {"mode":"read","backend":"shell","titleCount":1}
```

🔴 第 ④ 条是**最关键**的：那条任务是在**只走壳存储**的那一轮建的 ——
**那一轮的 WebView OPFS 从没见过它** —— 所以重开还能看到它，只可能来自壳的 SQLite。

证据与边界（含"当前还在 WAL 里、尚未 checkpoint 回主库"这一条）：
[`apps/desktop-windows/evidence/storage-host/`](../../apps/desktop-windows/evidence/storage-host/README.md)（三份产物各证明什么、以及人看过的截图）

---

## 3. ✅ 两处修复**已应用**（当时的诊断与修法都留在这里）

### ✅ 修复 1（`backend=sqlite` 的真因）：重打 web 产物

Windows 上的 `apps/web/dist` 是**旧产物** —— 它早于我在 `oplog.ts` 里加的 `'shell'` 后端，
所以页侧 `resolveStorageBackend()` 里那段"有端口就走 shell"的代码**根本不在那个产物里**。
（页侧那 3 条测试跑的是**源码**，不是 `dist`，所以本地全绿而真机不生效。）

```bash
cd <repo>
pnpm --filter @heyta/web build                       # 重打 dist
bash -c 'source scripts/lib/sync-windows-sources.sh && sync_windows_sources windows-pc'
```

⚠️ 这是本仓反复记过的**同一类**故障（"本地改了、装的是旧产物"）。**每次代码变完都要重打。**

### ✅ 修复 2：证据文件为空（我引入的 bug）

`apps/desktop-windows/HeytaWindows/MainWindow.xaml.cs` 的 `WriteEvidence()` 里：

```csharp
$"DB_DONE={_api?.ListTasks().Count(t => t.Done) ?? -1}{Environment.NewLine}" +   // ~584
$"DB_TOTAL={_api?.ListTasks().Count ?? -1}{Environment.NewLine}" +              // ~585
```

存储宿主模式下 `TryInitialize(openHost: false)` **没有** `_api.Open()`，
于是 `_api.ListTasks()` 抛错（"宿主还没打开"），而整个 `try` 被 `catch { }` 吞掉
⇒ **证据文件一个字都没写**（实测：`shell-evidence.txt` 为空）。
修法：这两行在 `_storageHostEnabled` 时直接写 `-1`（或抽一个 `TaskCounts()` 帮手），
并在注释里写明"存储宿主模式下引擎在页侧，壳数不出来"。

---

## 4. ✅ B 的真机判据（已跑通；下面就是可复现的顺序）

```bash
# ① 重打 + 同步（修复 1）
pnpm --filter @heyta/web build
bash -c 'source scripts/lib/sync-windows-sources.sh && sync_windows_sources windows-pc'

# ② 清掉壳的库与旧证据（判据要干净）
ssh windows-pc "powershell -NoProfile -Command \"Remove-Item \\\"\$env:LOCALAPPDATA\heyta\heyta.sqlite*\\\" -Force -EA SilentlyContinue; Remove-Item 'C:\src\heyta-win-journey\shell-evidence.txt' -Force -EA SilentlyContinue\""

# ③ 带存储宿主开关发布并启动（脚本会做 dotnet publish + 补 XAML 资源 + 注入交互式会话）
scp scripts/windows/launch-winui-shell-cdp.ps1 windows-pc:C:/src/heyta-launch-winui-shell-cdp.ps1
ssh windows-pc "powershell -NoProfile -ExecutionPolicy Bypass -File C:/src/heyta-launch-winui-shell-cdp.ps1 -CdpPort 9287 -ShellStorage"
#   期望末行：RESULT=OK，且 shell_storage=True

# ④ 开隧道 + 跑判据脚本（它断言 backend=shell，并经界面建一条任务）
ssh -N -L 127.0.0.1:9287:127.0.0.1:9287 windows-pc &
HEYTA_WIN_CDP=http://127.0.0.1:9287 node scripts/verify-shell-storage-windows.mjs
#   期望：BACKEND=shell 且 RESULT {"backend":"shell","title":"B-shell-storage-<ts>"}

# ⑤ 🔴 从壳外读那个 .sqlite —— 这一步才是"数据真的在壳的库里"的证据
ssh windows-pc "powershell -NoProfile -Command \"<读 %LOCALAPPDATA%\heyta\heyta.sqlite 的 ops 表，找 ④ 打印的标题>\""

# ⑥ 顺带核对证据：STORAGE= 必须是 shell
ssh windows-pc "powershell -NoProfile -Command \"Get-Content 'C:\src\heyta-win-journey\shell-evidence.txt' | Select-String 'STORAGE|WEB_MODE|M2D'\""
```

**注**：`scripts/verify-shell-storage-windows.mjs` 是这次交接新落的脚本（2026-09-30 只跑到一半 ——
身份门与后端读取都工作，最后卡在修复 1）。它需要 `@playwright/test` 在仓库根可解析（本机实测可以）。

---

## 5. ✅ B 已完成 —— 以及一条顺带发现的缺陷

**Windows**：存储宿主默认开；数据真的落进壳的 `.sqlite`；重启后还在；旧 OPFS 数据被导入。

**macOS**：`WKUserScript` 注入 shim + `WKScriptMessageHandler` 转发 + `window.postMessage(JSON.parse(...), '*')`
回推；`ShellStorageHost.swift` 负责"能不能兑现承诺"的判定。判据两步：

| 步 | 结果 |
|---|---|
| 真应用自述 | `STORAGE_HOST=on` / `STORAGE=shell`（写进壳的证据文件） |
| 🔴 从壳外读 `.sqlite` | `heyta.sqlite-wal: title=True`，mtime 就是那一次运行（两次运行、两个标题都成立） |

⚠️ macOS 上"造出那条数据"用的是 `evaluateJavaScript`（**没有 CDP**）：
`HEYTA_STORAGE_JOURNEY=<标题>` 触发一段"往采集框打字 + 回车"的脚本。这条机制
**正是 C 需要的那条路**（见 §6）。

### 🔴 共享工作树的"产物残渣"已经三次弄红别人的检查（本轮各修一次）

本仓是**多个会话共用的工作树**，而 `dist/` 全在 `.gitignore` 里 ——
于是**陈旧/残缺的构建产物既不出现在 `git status`、又能让检查变红**。三次实例：

| 症状 | 根因 | 修法 |
|---|---|---|
| 应用的浏览器包抛 `Can't find variable: exports`（**两个桌面壳全废**） | `packages/i18n/src/locales/*.js` 是 `tsc` 落下的 **CJS 残渣**，打包器**选中了它们** | 删残渣 + 重打 `@heyta/i18n` + 重打 `apps/web/dist` |
| `apps/desktop` typecheck 报 `Could not find a declaration file for '@heyta/domain'` | `packages/domain/dist` 是**残的**（声明文件在、但 tsc 用不了） | 重打 `@heyta/domain` |
| `pnpm check` 挂在 `server build`（更早一轮，别人的在途文件） | 别的会话的未跟踪文件 | 不是我的，未动 |

⚠️ 判据：**看到 `pnpm check` 红，先分辨"是谁的源码"还是"产物残渣"** ——
后者重打对应包即可，而且它**不会**出现在任何 diff 里。

### ✅ 已修：macOS 窗口门禁曾被"没有应用的窗口"喂饱（第 13 轮）

**问题（第 12 轮量准）**：门禁 **exit 0**、四条断言全过，**而它接受的那张图**
（人已看过）是**暗窗口 + 一行诊断文字**、没有应用界面。成因：那一刻
**WebView 内容没合成进窗口**（AppKit 画了、WebContent 没画），而这在窗口不前台时是**常态**。

**修法**：自截屏时另写一份 **`WKWebView.takeSnapshot`**（`<png>.webview.png`）——
不走窗口服务器、不需要录屏权限，所以稳定。两份产物各证一件事：

| 产物 | 它证明 |
|---|---|
| 窗口截图 | 一个真的 macOS 窗口（标题/尺寸/非空/取图方式/尺寸交叉验证） |
| **WebView 快照** | 🔴 **壳里那份共享 UI 真的渲染出来了** |

判据取 **`contentOnModalRatio ≥ 0.02`**（比值、与主题无关）。
⚠️ **不是主蓝**：壳跟随系统外观，暗色下主蓝几乎不出现（真应用那张只有 46 个主蓝像素）。
⚠️ `edgePairs` 不能用（三张图都是 ~20034，归一分母）。

三张已知图：真应用（暗）**0.057** / 暗窗口无应用 0.006 / 过期回退屏 0.004。

**红/绿一对**：真应用 ⇒ ✅ 通过；**把首屏换成空白页** ⇒ 快照 0.000 ⇒ 🔴 红。

证据：`apps/desktop-macos/evidence/webview-snapshot-2026-09-30.txt` +
`webview-snapshot-real-app-2026-09-30.png` + `window-gate-accepted-2026-09-30.*`（问题现场）。

**也已修：`-3811` 不再让门禁随机变红**（第 14 轮）。

`ScreenCaptureKit` 会偶发 `SCStreamErrorDomain Code=-3811 "无法开始流播放"` —— 它是**瞬时**的，
而门禁的"环境 vs 真故障"启发式把它判成**真故障**（因为 `launchctl managername` 是 Aqua）
⇒ 门禁随机红一次、重跑才过。现在：

1. `capture-window.sh` 对**这一条明确的瞬时错误重试一次**（别的失败不重试，不会被掩盖）；
2. 仍失败 ⇒ 脚本 **exit 4** 自述"取图基础设施不可用"（与"应用/编译坏了"分开）；
3. 门禁收到 exit 4 ⇒ **响亮跳过**（"这一条没有被验过，别把这次的绿读成窗口画出来了"）。

**三条都实测过**：注入 `-3811` 文本 ⇒ 脚本 exit 4（且观察到重试行）；
把注入版换进门禁 ⇒ 门禁 exit 0 + 响亮跳过；换回真脚本 ⇒ exit 0、判据 0.057。

## 6. C 与 D

### C：🔴 卡在一个**已量出**的技术事实 + 一个待产品负责人拍板的选择（第 8 轮）

**已落地**：`AUTH_STATE=signed-out|signed-in` 判据（登录前后**各有恰好一种**合法菜单 IA；
两者都在/都不在 ⇒ 红）。未登录那条已回归通过。

**量出来的结论：macOS 壳里通行密钥做不了。**

| 测量 | 结果 |
|---|---|
| 页面 origin / 安全上下文 | `heyta-local://app`，`SECURE_CONTEXT=yes`，`PublicKeyCredential` 存在 |
| 平台认证器是否可用（**带焦点**） | 🔴 **`uvpaa=false`** ⇒ 走不到 Touch ID |
| 不带焦点时 | `NotAllowedError: The document is not focused` |
| 硬件反例已排除 | 这台机器 Touch ID 正常（`bioutil -r` → `Biometrics for unlock: 1`；Mac16,5，4 个生物传感器） |
| 服务端侧 | 正常：`WebAuthn config: rpID=app, origin=heyta-local://app` 两次都记到了 |

⇒ 用户看到"没反应 / 已取消或超时"的**直接原因**就是 `uvpaa=false`。
**推断（未实测，别当成结论）**：WKWebView 的 WebAuthn 要求 app 与 RP ID 的域名有关联
（`com.apple.developer.associated-domains` 的 `webcredentials:` + 服务端 AASA），
而 `apps/desktop-macos` 里**没有这类配置**，RP ID 又只有 `app` 一个标签。

🔴 **另一个独立陷阱**：`HEYTA_NO_FOCUS=1`（本仓取证/截屏脚本的既定约定，`AGENTS §6.2` 规定二）
会让**任何** WebAuthn 调用失败。⇒ 跑鉴权验收时**不能带它**，而那意味着验收会抢用户焦点。
这条冲突要显式记着，它不是脚本的 bug。

#### ✅ 机制已落地，且**红/绿一对都拿到了**（第 10–11 轮）

两条硬约束把路定死了：通行密钥在壳里**不可用**（`uvpaa=false`）、magic-link 的回跳腿需要
**深链**而 macOS 壳**没有**深链处理。**而鉴权面板自带一条产品已有的入口**
（`web.auth.paste.label`：「或者粘贴登录链接 / 令牌」）—— 正是为"拿不到深链"准备的。

C 的机制 = **两半，都走界面**（壳内探针，`callAsyncJavaScript`）：

1. `HEYTA_AUTH_JOURNEY=register-link|send-link` + `HEYTA_AUTH_EMAIL`：头像 → 登录/注册 →
   填服务端地址 + 邮箱 → 点「注册新账号」/「发送登录链接」；
2. `HEYTA_AUTH_JOURNEY=paste-token` + `HEYTA_AUTH_TOKEN`：打开面板 → 粘贴令牌 → 点「完成登录」。

| 输入 | 权威判据（`AUTH_STATE`，事后重新点数菜单 IA） |
|---|---|
| 有效令牌 | ✅ `signed-in` |
| 🔴 坏令牌 | `signed-out` + 面板「链接无效或已过期，请重新发送一封」 |

⚠️ **探针里的 `panelClosed` 不是判据**：面板在成功与失败时**都会关掉**，所以它是假阳性。
**权威判据只有 `AUTH_STATE`。**

⚠️ 两条会误导人的实测：**TEST_MODE 下注册自动验证**（`is_verified=1`、验证令牌已清）⇒
"点邮件验证链接"这一步在验收里不需要；**对不存在的邮箱，登录链接故意静默**（防枚举，
库里不会有令牌）⇒ 必须先注册。

#### 🔴 顺带修掉的一起真事故：dist 在浏览器里根本跑不起来（第 11 轮）

第一次跑注入时应用**整个不挂载**（`identity:0`），**对照实验（不带鉴权旅程）也一样**。
加 `HEYTA_BOOT_DIAG=1` 后原因立刻有名有姓：**`ReferenceError: Can't find variable: exports`**。

1. `packages/i18n/src/locales/` 下有两份 **CJS 残渣** `en.js` / `zh-CN.js`（`tsc` 落的）；
2. 它们**未被跟踪、且被 `.gitignore` 忽略**（`packages/i18n/src/locales/*.js`）
   ⇒ **`git status` 看不见**，但打包器解析 `./locales/en` 时**选中了 `.js`**；
3. `@heyta/i18n` 的 `dist/index.js` 因此混合了 ESM+CJS，浏览器包里带着**裸 `exports`** ⇒ 首跳即抛。

**修法**：删残渣 + 重打 `@heyta/i18n` + 重打 `apps/web/dist`（裸 `exports` 归 0，应用恢复挂载）。
⚠️ **影响面**：打的是产物 ⇒ **两个桌面壳与任何打包产物全废**，而 `vite dev`
（`verify:web-auth`）**看不出来** —— 这就是为什么 D 绿而壳全挂。
⚠️ 这类"**被 gitignore 藏起来的构建残渣**"不显示在任何 diff 里，却能让产物报废。

### 6.6 ✅ 定案：壳里的鉴权走**系统浏览器反向授权**（2026-09-30 产品负责人）

> 「鉴权用系统浏览器吧，就是用我们的……我觉得应该是用浏览器来反向授权来登录」

**为什么这是唯一站得住的选择**（三条都是本轮量出来的事实，不是取舍）：

| 事实 | 出处 |
|---|---|
| 壳里**通行密钥不可用**：带焦点实测 `uvpaa=false`；不带焦点则 `NotAllowedError: The document is not focused` | `apps/desktop-macos/evidence/storage-host/webauthn-*.txt` |
| 壳里**没有深链**（无 `CFBundleURLTypes`、无 `application(_:open:)`）⇒ magic-link 的回跳腿不存在 | 全仓 grep 为空 |
| 而**正常 https origin 上通行密钥是好用的** | D：Chromium 里 6/6，注入翻回 IP 即红 |

⇒ 把登录页放在**我们的站点**（正常 https origin、真正的 RP ID）用**系统浏览器**打开，
通行密钥由系统在浏览器里完成，再经回调把会话带回壳。它同时解掉
"壳里没有 CDP""文档没有焦点""没有深链"三个约束。

**落地要点（下一轮的第一件事）**：
1. 壳侧 `ASWebAuthenticationSession`（`swift` 侧，`prefersEphemeralWebBrowserSession` 视需要）
   + 注册一个**回调 URL scheme**（这是壳第一次引入 URL scheme —— 见 §6 的 C 里"没有深链"那条）；
2. 站点侧：一个**专给桌面壳的授权起点**（带 `state`/PKCE 之类的绑定），成功后回调
   `heyta://auth#token=…`；
3. 壳把令牌交给**页侧既有的登录路径**（`applyAuthToken` 那条）—— **不要在壳里另写一份**；
4. 判据：`AUTH_STATE=signed-in`（已有）+ **从壳外读 `.sqlite`**（已有）+ 注入验证。

⚠️ **在它落地之前，不要往"壳内通行密钥"加代码**（那是本轮量出不可行的那条）。

### 6.7 鉴权机制清点：**邮箱+密码这条路目前不存在**（产品负责人要求"检查一下"）

**问**：现在不应该用邮箱+密码登录吗？本地不能邮箱+密码登录吗？没有完整的注册机制吗？

**查的结果（服务端 + 客户端 + 表结构）**：

| 层 | 事实 |
|---|---|
| **路由** | 只有 `register/passkey/{options,verify}`、`login/passkey/{options,verify}`、`register/magic-link`、`login/magic-link`、`login/magic-link/verify`（`server/src/api.ts`）。**没有** `register/password`，也**没有** `login/password` |
| **客户端** | `AuthPanel` 里**没有任何密码输入框**（无 `type="password"`）；提供的是「发送登录链接 / 注册新账号 / 用通行密钥注册 / 用通行密钥登录 / 找回链接 / 粘贴链接或令牌」 |
| **表结构** | `User.passwordHash` **存在但可空**，注释写着 "Nullable for passkey-only users"；`resetPasswordToken` / `failedLoginAttempts` / `lockedUntil` 也在 |
| **密码哈希用在哪** | `bcryptjs` **只在 `server/src/test-routes.ts`**（TEST_MODE 的 `/api/test/create-user`）里用 ⇒ 那是**测试造号**，不是产品路径 |
| **既定决策** | [ADR-0029](../adr/0029-refuse-to-delete-last-passkey.md) §1 明说：浏览器端 `AuthPanel` 提供的是**通行密钥与邮箱魔法链接两条路**，并因此**不允许**自助删除最后一条通行密钥 |

⇒ **"完整的注册机制"是有的**，只是**不是密码式的**：
`register/magic-link`（邮箱注册）+ `register/passkey/*`；登录 `login/magic-link/verify` + `login/passkey/verify`；
恢复 `recover/passkey`。**`passwordHash` 是遗留/未来字段，没有任何一条路在用它。**

🔴 **而这正是"本地为什么别扭"的根**：magic-link **依赖邮件可达**
（ADR-0029 自己记着"自建实例上 SMTP 未必配好"），而通行密钥在**壳里**不可用
⇒ 本地/自建场景下**两条路都难走通**。产品负责人问的"为什么整出那么多登录方式"，
答案是：**不是多，是两条都不合用**；定案的系统浏览器反向授权正是同时解掉这两条短板的做法
（浏览器里通行密钥好用，且不依赖邮件）。

⚠️ 若**还要**加邮箱+密码，那是一件**新产品决定**（涉及服务端路由、密码策略、找回流程、
以及 `passwordHash` 从"可空遗留"变成"一等凭据"的迁移）——**本次没有做**，也不在四件事内。

### D：✅ 已完成（第 9 轮）—— RP ID 换成 `localhost`，6/6 绿 + 注入验证

**修的是**：页面 origin `127.0.0.1:4329` → **`localhost:4329`**，`rpId` → **`localhost`**，
`WEBAUTHN_ORIGIN` → `http://localhost:4329`。**根因**：RP ID 必须是 origin 的**域名后缀**，
而 **Chromium 拒收 IP 字面量**；修之前界面只说"这个浏览器或设备不支持通行密钥"，
看着像**设备能力问题**，实际是**地址形态问题**。

🔴 **注入验证**：把三处翻回 IP 字面量 ⇒ J1 当场红
（`Received: "这个浏览器或设备不支持通行密钥…"`）；还原 ⇒ **6 passed**。
两侧必须用**同一个名字**（`vite --host localhost` 与 Playwright 的 `webServer.url`），
混用会复现"服务起了却等 120 秒超时"（2026-09-29 的坑）。

**路上修掉两个真 bug —— 都在判据本身，不在产品代码**（只有 RP ID 修好、
旅程第一次跑到底之后才暴露）：

1. 🔴 **凭据快照没随登录前进**：每次都注入注册那一刻的 `signCount` ⇒ 计数器倒退 ⇒
   服务端按 FIDO 拒收（文案"通行密钥验证没有通过"）。修：登录成功后读回最新快照。
   ⚠️ Windows 侧同一条。
2. 🔴 **J5 的断言曾是空真**：退出登录会**关掉菜单**，"退出登录项不存在"于是恒成立。
   修：重新点开头像，在**打开**的菜单上断言。⚠️ Windows W5 同一条。

证据（含 7 张截图与两轮的完整输出）：`apps/web/evidence/auth-journey/`。

⚠️ **这条旅程跑在 Chromium 里，不是桌面壳里** —— 它证明共享 UI 的认证旅程本身可用。
macOS 壳里**仍不可用**（`uvpaa=false`，见上面 C）。

---

## 6.5 `pnpm check` 当前**不是全绿**，以及为什么那与四件事无关（第 14 轮）

`pnpm check` 走到 **e2e 浏览器套件**才红，红的是**一条**：

```
[chromium] › tests/ai-breakdown.spec.ts › AI 拆解：真浏览器端到端旅程
Error: 假端点应该累计收到 1 次调用，实际：[]
（同一次：1 flaky「页8 扫描：回收站」、2 skipped、56 passed）
```

**归属证据（不是本轮改动引起的）**：

- `apps/web/src` 的 `git status` **空** —— 被测源码零改动；
- **AI 功能源码我一行没碰**；
- e2e 跑的是 **vite dev（源码）**，不是 `apps/web/dist`，所以本轮重打产物与它无关；
- 同一目录下有别的会话**未跟踪的** `e2e/tests/admin-console.spec.ts` ⇒ 那边正在动 e2e。

⚠️ 本轮我**确实修掉了 `pnpm check` 的另一处红**（在本条之前）：
`apps/desktop typecheck` 报 `Could not find a declaration file for '@heyta/domain'`
⇒ 重打 `@heyta/domain` 即恢复（见上面"产物残渣"那段）。

⇒ **引用 `pnpm check` 的结论时请连带说明这一条**：它红在一条与四件事无关的 e2e 用例上。

## 7. 现状里"看着像问题、其实不是"的东西（别去修）

1. **`pnpm check` 是红的**，但它挂在 `server build` 的 `TS6059`：
   `server/scripts/gen-server-copy.ts`（**未跟踪**、16:21 创建）与 `server/package.json`（16:20 改）
   是**另一个并发会话**的在途改动。`pnpm -r test` **exit 0**（server 1789 / app-host 739 / web 993 /
   mobile 418 / node-host 139 / desktop 12）。
2. **`apps/desktop-windows/evidence/journey/` 里第 4、5 张截图逐字相同** —— 那是正常的：
   W3（同步后）与 W4（新设备恢复后）在界面上本来就是同一个画面。W4 的承重判据是
   **重置设备时断言本地为空 + 服务端日志 `Download: 1 ops (sinceSeq=0)`**，不是截图。
3. `windows-pc` 会**中途掉线**（ZeroTier 抖动）。`scripts/verify-windows-shell-journey.mjs` 已对
   **瞬时网络**做有限重试、对**新鲜度对不上**不重试。
4. 壳跑完**会留在 Windows 上开着**（它是常驻应用，验收脚本不替你关）。

---

## 8. 已经跑绿的验证（交接时的真实数字，2026-09-30 本轮实测）

| 命令 | 结果 |
|---|---|
| `pnpm --filter @heyta/web test` | **1011 通过 / 12 跳过**（+8 为本轮新增的 fragment 通道用例） |
| `pnpm --filter @heyta/web typecheck` | exit 0 |
| `node scripts/verify-email-web-chain.mjs` | **9/9 ✅**（+ 3 份注入，见 §10.3） |
| `pnpm verify:email-auth` | **11 ✅** + 注入 |
| `pnpm verify:web-auth`（J1–J7） | **7/7、exit 0、23.9s**（⚠️ **必须单独跑**：并发时 6.6 分钟且随机红 —— §10.5） |
| `pnpm check:web-storage` | exit 0（⚠️ 同样只在单独跑时绿） |
| `pnpm check:journey-coverage` | exit 0（28 passed） |
| `pnpm check:server-copy` | exit 0 |
| `pnpm check:docs` | exit 0 |
| `pnpm verify:windows-auth`（上一件工作，与本轮无关） | 6/6、exit 0 |

⚠️ **仍然没绿 / 没做**的：Windows 壳侧反向授权接线、手机号预留、真实 SMTP 实跑、
真系统浏览器的人工那一跑（§10.4）。**别把这几件说成已完成。**
`pnpm check` 整链不是全绿，原因见 §6.5。

---

## 9. 下一轮的开头指令建议

> 读 `docs/plans/desktop-storage-host-handoff.md`。**A/B/C/D 与"邮箱链路的 web 腿"都已经绿了，别重做。**
>
> 🔴 **本轮之后剩下的是这三件**（按建议顺序）：
>
> 1. **Windows 壳侧的反向授权接线**（系统默认浏览器 + 自定义协议回调 + `state` 校验）。
>    macOS 那份是**可照抄的模板**：`apps/desktop-macos/Sources/HeytaShellCore/ShellAuth.swift`
>    是**纯逻辑**（`makeState`/`authorizationURL`/`parseCallback`，含"拒收 query 里的令牌、
>    拒收 state 不匹配"），壳里的 `HeytaMacApp.swift` 只做接线。
>    ⚠️ Windows 的协议注册、以及 `CoreWebView2Environment.CreateAsync` 那个 API 在本机
>    不可用（`CS1501`，已实测）—— 别假设它在那儿。
>    ⚠️ 复用 `scripts/verify-windows-shell-journey.mjs` 与
>    `scripts/lib/auth-journey-server.mjs`（两条壳路共用同一份服务端引导）。
>
> 2. **手机号注册/登录的"预留"**：schema + 接口契约 + 客户端钩子 +
>    `AUTH_PHONE_ENABLED`（**默认关**）+ **一份能判"预留本身"的契约测试**。
>    ⚠️ 没有真实短信网关 ⇒ **不许**说它能用；"预留"的判据是**契约**，不是端到端。
>
> 3. **真实 SMTP 实跑**：本机是 Ethereal 兜底；要在自建实例上跑一遍
>    `pnpm verify:email-auth` 与 `node scripts/verify-email-web-chain.mjs`，
>    把那两处"本机走 Ethereal"的限定**换成实测**。
>
> ⚠️ **做任何浏览器验收前先看 §10.5 第 1 条**：并发跑会互相饿死，
> 红了先单独重跑再归因（`pnpm verify:web-auth` 单独 23.9s / 并发 6.6 分钟且随机红）。

---

## 10. 当前 Goal：邮箱全链路 + 桌面反向授权 + 手机号预留

> 目标原文（产品负责人）：把注册/登录做成**邮箱全链路**（请求 → 真发一封 → 打开链接 → 会话落地；
> 本地走 Ethereal 兜底、自建/生产走真实 SMTP），把**桌面壳（macOS/Windows）的鉴权改走
> 系统浏览器反向授权**，并**预留手机号注册/登录的全链路**（schema + 接口契约 + 客户端钩子 +
> 默认关闭的开关，且"预留"本身有契约测试可判）。每一环都要有能因注入转红的判据、真实证据与
> 人看过的截图；边界如实记录。

### 10.1 ✅ 已经绿了的（别重做）

| 环 | 证据 | 命令 |
|---|---|---|
| **服务端一个校验核心**：`POST /api/auth/email/verify` 同时吃登录令牌与注册令牌；`verifyEmailLink()` 按令牌种类分流 | 11 格 ✅ + 注入（把 `GET /verify-email` 改回"GET 就消费"⇒ 当场 401） | `pnpm verify:email-auth` |
| **`GET /verify-email` 不再消费令牌**（防邮件客户端链接预取：Outlook SafeLinks / Gmail 预览会在用户点之前抓一遍） | 同上那份注入就是它的红 | 同上 |
| **web 全链路**：真浏览器 + 真邮件 + 同源反代（`/api`+确认页 → API，其余 → `apps/web/dist`） | **9/9 ✅**；三份注入见 §10.3 | `node scripts/verify-email-web-chain.mjs` |
| **macOS 壳反向授权**：`ShellAuth.swift` 纯逻辑（`makeState`/`authorizationURL`/`parseCallback`）+ `ASWebAuthenticationSession` + `CFBundleURLTypes` 注册 `heyta` scheme | `AUTH_CALLBACK=ok` + `AUTH_STATE=signed-in`；**坏 state 被拒**（`shell-auth-badstate.txt`） | 见 `apps/desktop-macos/evidence/storage-host/` |
| **web 侧反向授权**：`desktop-handoff.ts`（`buildDesktopCallback` / `handOffToShell` / `maybeHandOffToShell`） | J7 ✅（回跳 `heyta://auth#token=…&state=…`，**令牌不进 query**） | `pnpm verify:web-auth` |

### 10.2 🔴 本轮定位并修掉的根因：**"点了邮件链接回来还是未登录"**

这条腿**坏了很久没人发现**，因为它以前**没有任何判据**盯着。加判据的当轮就红了，
仪器（写入时间线 + 每次 `pagehide` 的存储快照）给出：

```
写入时间线      ：确认页 set sessionToken / loginEmail / loginBaseUrl（真的写了）
确认页 pagehide ：sessionKeys = [sessionToken, loginEmail, loginBaseUrl]   ← 最后一刻还在
应用启动那一刻  ：sessionKeys = []                                        ← 没跟过来
                 （时间线里**没有任何 removeItem** —— 不是被谁清的）
```

**根因**：确认页由同步服务端渲染，带 `@fastify/helmet` 的**默认**头
`Cross-Origin-Opener-Policy: same-origin` + `Origin-Agent-Cluster: ?1`；
应用（`/app/`，静态产物）**两个头都没有** ⇒ 从确认页跳到 `/app/` 会
**切换 browsing instance**，`sessionStorage` 不跟回来
（`localStorage` 不受影响 —— 那条时间线正是靠它才活到了 `/app/`）。

**修法**：会话改走 **URL 的 `fragment`**（`/app/#sessionToken=…&loginBaseUrl=…&loginEmail=…`），
应用读完**立刻** `history.replaceState` 抹掉。理由：
fragment 不发给服务端、不进 `Referer`、不进访问日志，是 URL 的一部分所以**一定跨得过去**；
而且它**不依赖服务端与反代的头配置保持一致** —— 自建换个反代不会再坏一次。

> ⚠️ **别把它"简化"回 `sessionStorage`**：那条通路靠的是"两个独立部署件的头恰好一致"这个默契。
> ⚠️ 上游模块里"别把令牌放进 URL"讲的其实是 **query**（`?token=…` 会进日志与 `Referer`）；
> fragment 两类泄漏都没有，且严格**小于** localStorage（应用启动失败时随标签页消失）。

**桌面壳仍然走 `sessionStorage`** —— 它在**同一份文档里**写、再 `load()`，不存在 cluster 切换，
且那条路已经验绿。两条投递、**一套键名**、一个消费点（`consumePendingLogin()` 按
**fragment → 壳交付的会话 → 链接令牌** 取）。

### 10.3 红/绿 2×2（每一格都有落盘文件）

见 `apps/web/evidence/email-chain/README.md`：

| 投递 \ 响应头 | 带 COOP/OAC（**生产的真实形状**） | 摘掉 COOP/OAC（注入） |
|---|---|---|
| `sessionStorage`（修复前） | **结果类 ❌**（真的登不上） | 结果类 ✅ / 结构类 ❌ |
| **`fragment`（现在）** | **✅ 全绿** | **✅ 全绿** |

左上红 + 右上绿 ⇒ 因果钉死；左下/右下全绿 ⇒ 修法成立且不依赖头配置。
另有一份 `drop-fragment` 注入（把 fragment 投递也摘掉）让结果类与结构类**一起红**
⇒ 证明那两格判据**是活的**。

⚠️ 判据分 `outcome` / `structure` 两类并在总结里**分开点名**："结果类全绿、结构类红"
= **用户其实能用，红的是保证**。混成一句"未通过"会让人以为产品坏了。

### 10.4 🔴 没做 / 没验（不许说成已完成）

| 事项 | 状态 |
|---|---|
| **Windows 壳侧的反向授权接线**（系统默认浏览器 + 自定义协议回调 + `state` 校验） | 🔴 **未做** |
| **手机号注册/登录预留**（schema + 接口契约 + 客户端钩子 + `AUTH_PHONE_ENABLED` 默认关 + 契约测试） | 🔴 **未做** |
| **真实 SMTP 实跑** | 🔴 **我没跑过**。产品负责人说自建 SMTP 已好，但**本机走 Ethereal 兜底**，这条判据没在真实 SMTP 上实测 |
| **真系统浏览器的人工那一跑**（`ASWebAuthenticationSession` 弹窗、人在浏览器里完成登录） | 🔴 **从未执行**（需要人）；验过的是**逻辑**与壳内探针 |
| **Windows 壳端的反向授权真机跑** | 🔴 未做 |

### 10.5 本轮顺带学到的三条（都是实测，别再踩）

1. **并发跑验收会互相饿死**：同一条 `pnpm verify:web-auth` **单独跑 23.9s / 7 绿**，
   而和另一个浏览器验收并发时是 **6.6 分钟**且随机红（J2 红一次、J3 红一次，两次红的**不是同一条**）。
   ⇒ 与 `BLOCKED.md` 那条元规则一致：**结构性门禁红了先单独重跑再归因**。
2. **注入必须在反代里改响应体、且失配要当场抛**。改源文件的注入跑完会留下一个**改坏了的仓库**；
   而静默失配会造出**假证据**（注入没生效 ⇒ 仍然全绿 ⇒ 我却当成"判据是活的"）。
3. **诊断要收进失败分支**。那套仪器（写入时间线 / `pagehide` 快照 / 文档响应头）解开了一个
   静默失效，但一组十几行；绿的时候只淹掉"到底判了什么"，所以它们现在**只在红的时候打印**。
