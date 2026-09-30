# 交接：桌面端「真应用的存储 → 壳的 SQLite」（B）+ macOS 定案（A）

> 状态：**A 已完成**；**B 的 Windows 端已全绿并已翻成默认**（存储宿主默认开；
> 数据真的落进壳的 `.sqlite` + 重启之后还在 + 旧 OPFS 数据被导入；
> 证据在 `apps/desktop-windows/evidence/storage-host/`）；
> **macOS 的壳侧托管也已验绿**（JavaScriptCore + libsqlite3，同一条判据，
> 证据在 `apps/desktop-macos/evidence/storage-host/`）。
> **B 只剩 macOS 的 WKWebView 接线**；**C、D 未动**。
> 交接日期：**2026-09-30**（CST）
> 给**全新会话**用：不从聊天记录继承任何前提。每条都带可复现命令或实测输出。
>
> 🔴 本文只记**当前停在哪**与**下一步怎么走**，不重复已定下的决策。那些在
> [`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) §4.2/§4.3、
> [`ADR-0037`](../adr/0037-desktop-ui-falls-back-to-webview.md)、
> [`BLOCKED.md` 第 3 项](../../BLOCKED.md)、`AGENTS.md §7` 里。

---

## 0. 一句话现状

产品负责人钉死「**主战场 = 移动端 + macOS + Windows，Web 不是**」，要求按顺序兑现四件事
（A 定案 macOS 机制 → B 桌面存储接到壳 SQLite → C 补 macOS 登录后旅程 → D 解 RP-ID 阻塞）。

- **A ✅ 已完成**：macOS 目标机制 = **M2**（原生壳 + 壳内 WebView 加载共享 UI），
  并给出**可判定的重开条件**；两份权威文档的冲突已消除。
- **B 🟢 Windows 端已绿**：壳里的真应用现在**真的**把数据写进壳自己的 `heyta.sqlite`
  （页侧报 `STORAGE=shell`；从壳外扫那个库能看到载荷与 `CREATE TABLE "ops"`；
  **杀掉应用重开之后那条任务还在**）。剩 macOS 壳 + OPFS→壳导入 + 翻默认开关（§5）。
- **C ⬜ / D ⬜ 未开始**。

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

## 5. B 剩下的：macOS 的 WKWebView 接线（按序）

Windows 整套已经做完并翻成默认（§2.4 + 证据目录）。macOS 的**壳侧托管**也已验绿
（`AppApi.openOpLog` / `handleHostMessage` + `heyta-smoke`，见
`apps/desktop-macos/evidence/storage-host/`）。**只剩把 WKWebView 接上**：

1. **注入 shim**：`WKUserScript`（`atDocumentStart`）写
   `window.__heytaHostStoragePort = { postMessage: (m) => window.webkit.messageHandlers.heytaStorage.postMessage(m), addEventListener: (t, l) => window.addEventListener('message', l) }`
   —— 形状必须与 Windows 那份**逐字同构**（`postMessage` + `addEventListener`）。
2. **转发**：`WKScriptMessageHandler` 收 → `AppApi.handleHostMessage` → 对返回的每一串
   `evaluateJavaScript("window.postMessage(<json>, '*')")`（或 `callAsyncJavaScript`）。
   ⚠️ 门面的两个字符串**不要解释**（不解析、不改写）—— 与 Windows 的纪律一致。
3. **`app` 模式跳过 `open()`**：那会建第二个引擎（见 §2.2 第 3 条）。
4. **证据里加 `STORAGE=`**：读 `globalThis.__heytaStorage.backend` 写到壳的证据文件
   （Windows 那边在 `MainWindow.xaml.cs` 的 `WriteEvidence`，可照抄字段名）。
5. 🔴 **验证机制要另想**（这一条与 §6 的 C 是同一道题）：
   **WKWebView 没有 CDP**，Playwright 也没有 WebKit 附着 API，所以不能照搬
   Windows 的 `connectOverCDP`。可行方向：`apps/desktop-macos` 已有的
   **壳内 `evaluateJavaScript` 探针**（`HeytaMacApp.swift` 的 `firstScreenProbe` /
   `openAccountMenuProbe`，由 `scripts/check-macos-window.mjs` 驱动）
   —— 把它扩成"旅程 + 后端断言"，并要求"从壳外读 `.sqlite`"那一格照旧。

## 6. C 与 D（未开始，但已知形状）

- **C：macOS 的"注册/登录之后"旅程验收**。现状：`apps/desktop-macos` 只有
  `firstScreenProbe` / `openAccountMenuProbe`（首屏 + 菜单 IA），登录**之后**全无。
  🔴 两个硬约束（先想清楚再动手）：**WKWebView 没有 CDP**（Playwright 也**没有** WebKit 的附着 API），
  且 macOS 的注册/登录走**系统通行密钥**（无虚拟认证器通道 ⇒ 那一步必须有人）。
  可选路径：壳内探针驱动旅程（验得了 IA/同步，验不了真通行密钥）／让 macOS 走 magic-link
  （与移动端同路，可自动化）／保留人工 Touch ID 一步并如实记为人工。
  参考实现：`scripts/check-macos-window.mjs` + `apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift`。
- **D：解开共享 UI 旅程的 RP-ID 阻塞**。现状：`pnpm verify:web-auth`（vite + 真浏览器）被
  **Chromium 拒收 IP 字面量做 WebAuthn RP ID** 挡着（`WEBAUTHN_RP_ID='127.0.0.1'`）。
  上一轮会话已经把方向定在"**换成 `localhost` 试试**"（`vite --host localhost` + `WEBAUTHN_RP_ID=localhost`），
  但**没有实测**。相关文件：`scripts/verify-web-auth-journey.mjs`、`e2e/playwright.auth-journey.config.ts`、
  `e2e/auth-journey/helpers.ts`。
  ⚠️ 注意：`apps/web` 的构建产物**就是两个桌面端渲染的那一份**，所以这条不只是"web 的事"。

---

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

## 8. 已经跑绿的验证（交接时的真实数字）

| 命令 | 结果 |
|---|---|
| `pnpm --filter @heyta/storage exec vitest run tests/contract.spec.ts` | **252/252** |
| `pnpm --filter @heyta/storage test` | **314/314** |
| `pnpm --filter @heyta/app-host test` | **739/739** |
| `pnpm --filter @heyta/node-host test` | **139/139** |
| `cd apps/web && pnpm exec vitest run` | **993 通过**（+3 为本次新增） |
| `HEYTA_BRIDGE_BUNDLE=… dotnet run -c Release --project apps/desktop-windows/smoke/Smoke.csproj` | **21 项全绿、exit 0** |
| `node research/tools/docs-link-check.mjs` | **exit 0**（无死链/失效锚点） |
| `pnpm verify:windows-auth`（上一件工作，与本轮无关） | **6/6、exit 0**（连跑两次） |

**B 的真机判据（§4）也已跑通**：`STORAGE=shell` + 从壳外扫到载荷与 `ops` 表 +
**重启之后那条任务还在**（`titleCount=1`）。证据见 §2.4 的链接。

⚠️ 仍然**没绿**的是：macOS 壳（同一套存储宿主）、OPFS→壳的一次性导入、
以及"把默认开关翻过来"。**别把这三件说成已完成。**

---

## 9. 下一轮的开头指令建议

> 读 `docs/plans/desktop-storage-host-handoff.md`。**B 的 Windows 端与 OPFS 导入都已经绿了**
> （§2.4 有证据），不要再重做它们。下一件按 §5：**翻默认开关**
> （前置已完成），然后接 **macOS 壳** —— 注意 WKWebView **没有 CDP**，
> 它的验证要另想机制（与 §6 的 C 是同一道题，建议一起设计）。
> 回执要求与这次一致：**从壳外读 `.sqlite`** + **重启之后还在** + 人看过的截图 + 注入验证。
