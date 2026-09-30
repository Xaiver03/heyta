# `apps/desktop-windows` —— Windows 原生壳（WinUI 3 / C#）

> 状态：**已可构建、已可运行**。
> 壳在真 Windows 上构建通过（0 警告 0 错误）；跨语言那一层有**自动化冒烟**
> （任意 OS 可跑，12/12）；🔴 **窗口已在真机桌面会话里启动并截图**
> —— 见 [`evidence/window-first-run.png`](evidence/window-first-run.png)
> （原始日志不单独存档 —— 仓库的 `.gitignore` 明确忽略 `*.log`；
> 下面 §7 里把关键行**逐字**列出来了。）
> 决策依据：[ADR-0034](../../docs/adr/0034-windows-native-winui3-not-rnw.md)、
> 计划：[多端原生构建计划](../../docs/plans/desktop-native-migration.md) §2。

---

## 0. 它是什么，以及**不是**什么

Windows 端交付**真正的原生应用**：WinUI 3 / Windows App SDK，原生控件、原生窗口。

- ❌ **不是 PWA**（PWA 在任何端都不是交付形态，[ADR-0031](../../docs/adr/0031-native-apps-everywhere-not-pwa.md) §4）
- ❌ **不是 Electron**（`apps/desktop` 是 macOS/Linux 的过渡壳，见计划 §3–§4）
- ❌ 也不是「塞一个 WebView 进去」—— WebView 不是原生 UI

## 1. 三层，以及每一层**为什么**存在

```
┌─ HeytaWindows/（WinUI 3，仅 Windows 构建）──────────────────────┐
│  App.xaml / MainWindow.xaml / TaskItem.cs / MainWindow.xaml.cs │
│  只做三件事：窗口、界面、把事件转成 API 调用。                  │
│  **一行业务规则都不许写在这里。**                              │
└───────────────────────────┬────────────────────────────────────┘
                            │ ProjectReference
┌─ Heyta.Windows.Core/（net10.0，**任意 OS 可构建/可测**）────────┐
│  SqliteBridge.cs  同步 SqliteDriver（Microsoft.Data.Sqlite）   │
│  ScriptHost.cs    Jint 引擎、bundle 加载、微任务泵、JSON 编组   │
│  AppApi.cs        类型化包装（唯一 C# 侧 API）                  │
│  **这里没有一行 Windows API** —— 所以它能进 CI。               │
└───────────────────────────┬────────────────────────────────────┘
                            │ 只认识「函数名 + JSON」
┌─ packages/app-host/src/native-bridge.ts（TS，唯一真源）───────┐
│  open / listTasks / addTask / setTaskDone / removeTask         │
│  业务与存储全在这里，和 web / mobile / macOS / Linux 同一份。   │
└───────────────────────────────────────────────────────────────┘
```

### 🔴 可维护性的三条硬约束

1. **业务逻辑只有一份。** C# 侧**不许**读 schema、拼 op、算派生视图。
   排序、完成态、象限…… 全在 TS 里做完再过来。
   一旦 C# 自己算一遍，就是本仓反复记为「同一条规则两个实现，然后漂移」的形状。
2. **写操作只有一个入口。** 壳只能调 facade，facade 只能调 `createTaskActions`
   —— 与 Web 宿主的 `dispatchIntent()` 同一条纪律（AGENTS.md §3.4）。
3. **能进 CI 的部分不许留在 Windows 上。** 壳里最容易错的是**跨语言那一层**，
   而它一点 Windows API 都不需要 ⇒ 拆成 `net10.0` 的 Core，**在 Linux/macOS 上就能验**。
   留在 Windows 上的只剩 XAML + 窗口生命周期，那部分靠人眼看。

## 2. 怎么构建、怎么跑

```bash
# ① 打包 TS 门面（在**仓库根**跑；产物是构建产物，不入库）
node packages/app-host/scripts/build-native-bridge.mjs
#    → packages/app-host/bridge-bundle/native-bridge.js（约 1.2 MB，整个 app-host 栈）

# ② 跨语言那一层：无头冒烟（任意 OS，已通过 12/12）
HEYTA_BRIDGE_BUNDLE="$PWD/packages/app-host/bridge-bundle/native-bridge.js" \
  dotnet run -c Release --project apps/desktop-windows/smoke/Smoke.csproj

# ③ 壳本体：**只在 Windows 上**
dotnet build apps/desktop-windows/HeytaWindows/HeytaWindows.csproj -c Release -p:Platform=x64
```

前置：`node`（打包门面）、`dotnet SDK ≥ 10`（本机实测 10.0.108 / Windows 上 10.0.401）。
⚠️ **不需要 Visual Studio** —— `dotnet build` 就够（实测，见
[winui3-toolchain-probe](../../research/spikes/winui3-toolchain-probe/README.md)）。

⚠️ ① 必须在仓库根跑：门面要解析 `@heyta/*`，而那需要 workspace 的 `node_modules`。

## 3. 为什么门面住在 `packages/app-host` 而不是这里

试过放在 `apps/desktop-windows/bridge/`，**行不通**：它要 `import '@heyta/app-host'`，
而本目录不是 workspace 包（没有 `package.json`），下面没有 `node_modules`，
esbuild 从那里往上走也解析不到。三个选项里选了最省事、最不容易漂移的：

| 选项 | 判定 |
|---|---|
| 给本目录建 `package.json` + `pnpm install` | ❌ 要动 lockfile，而此时另一个会话正在同一个仓库里改 `package.json` |
| bundler 里用 `nodePaths` 借别的 app 的 `node_modules` | ❌ 把 A 的依赖树借给 B 用，比问题本身更难维护 |
| **放进 `packages/app-host/src/native-bridge.ts`** | ✅ 天然解析得到 `@heyta/*`，**且自动进入该包既有的 typecheck** |

## 4. 🔴 两个"本机绿、Windows 上必炸"的坑（都是冒烟抓出来的）

### 坑 1：`--platform=neutral` **默认不理 `main` 字段**

打包时报 `Could not resolve "hash-wasm"`。看着像缺依赖，其实是解析规则没配：
`neutral` 平台的 `mainFields` 默认是**空数组**，而 `hash-wasm` 只有 `main`。
⇒ `bundle-spike.mjs` 里显式给了 `mainFields: ['module','main']` + `conditions`。

### 坑 2：**驱动包装必须在 JS 侧**，不能把 CLR 对象直接交给适配器

第一版 `driverFactory: () => clrDriver`，一跑就炸：

```
HeytaApp.open 失败：'c' is an invalid start of a value. LineNumber: 0
  at all (native-bridge.js:11966)   ← 适配器在 JSON.parse 行数据
```

原因：契约里 `driver.all(sql, params)` 的第二个参数是**参数数组**，
而 C# 的 `all` 收的是 **JSON 文本** —— Jint 把 JS 数组塞给 `string` 形参得到垃圾字符串。
⇒ 参数与行的编组只在 JS 侧发生一次，C# 只看见字符串。
这与 W0-2 spike 里验证过的形状逐字相同。

**这两个坑都发生在"Windows 上真的跑起来"之前** —— 这正是把 Core 拆出来的回报。

## 5. 已知缺口（不要假装没有）

| 缺口 | 说明 |
|---|---|
| ~~没有开窗截图~~ | ✅ **已关闭（2026-09-28）**：在真机的**交互式桌面会话**里启动并截图成功 —— `MAIN_WINDOW_HANDLE=328280`、`MAIN_WINDOW_TITLE=heyta`、`1152x587`、`DB_EXISTS=True`。见 [`evidence/`](evidence/)。复现步骤见 §7 |
| **打包 / 签名 / 安装器** | 未做（MSIX 与签名证书都缺）；目前只能 `dotnet build` 出 exe |
| **系统小组件** | 未做。widgets 要求 **packaged app** + 一个独立的 `IWidgetProvider` COM exe server；计划 §2.3 W2 |
| **同步未接线** | facade 故意不传 `serverUrl` ⇒ 不建同步客户端。要接的时候是**在 facade 加一个函数**，不是把同步写进 C# |
| **界面只有任务列表** | 象限 / 清单 / 标签 / 重复 / 备注编辑 / 设置都还没有门面 |
| **编组开销** | 用 JSON 文本过边界，实测约 **4.9 µs/行**（[基准](../../research/spikes/sqlite-driver-csharp/README.md)）。这是**已知取舍**，换的是"类型映射只有一处" |
| **Jint 约束不可捕获** | 引擎失控（死循环/内存暴涨）会**杀掉整个进程**。W1 要么做隔离，要么显式接受（已进计划风险登记） |
| **不在任何门禁里** | `check:design` / `check:layering` 等扫描器都是 JS/TS 的，看不到 C#。计划 §6 已登记要补 |
| 🔴 **「任务行单一来源」门禁看不见这里的 XAML** | `scripts/check-row-single-source.mjs` 只扫 JS/TS（`.tsx`），而 `MainWindow.xaml` 里的任务行模板**是第二份实现**。**这是刻意的例外，不是漏网**：原生 UI 不可能复用 React 组件 —— 这正是 [ADR-0034](../../docs/adr/0034-windows-native-winui3-not-rnw.md) §4 已经承认的「`packages/ui` 对 Windows 归零」。⚠️ 代价要认：**任务行的视觉/行为在 Windows 上会独立漂移**，门禁不会替你发现。要么接受，要么将来为它加一条"渲染同一份数据契约"的视觉回归 |

## 6. 下一步（按价值排序）

1. ~~在真 Windows 上启动窗口并截图~~ ✅ 已完成，见 §7 与 [`evidence/`](evidence/)。
2. 把无头冒烟接进门禁：🔴 **脚本有了，但还没接进 `pnpm check`** ——
   `scripts/check-windows-shell.mjs` 存在，而全仓 `package.json` 里**没有**
   `check:windows-shell` 这个 script，`pnpm check` 与 CI 也都没有引用它。
   ⚠️ 这里原先写的是"✅ `check:windows-shell` 已接进 `pnpm check`"，
   **2026-09-28 实测为假**（`grep check:windows-shell package.json` 零命中）。
   已按实测改正：**假声明比没有声明更坏**，它让下一个人以为这块有人守着。
   真正要做的两件事：加 `check:{macos,windows,linux}-shell` 三个 script，
   并把能在当前主机上跑的那一个加进 `pnpm check` 的链里。
   **还没做的**：让它在**真 Windows** 上跑（现在 macOS 也跑，但 Windows 上更接近真实）。
3. 门禁覆盖 C#：`check:licenses:nuget` 已经会扫到本目录的 `*.csproj`（它按仓库遍历）。
   ⚠️ WinUI 工程只在 Windows 上评（macOS 上还原就失败，脚本会**显式跳过并印出来**）。
4. 界面按需长：一个视图一个视图地加，**每加一个都要问"原生界面真的渲染它吗"**，
   不要为了让 C# "看起来完整"而搬运无用数据。

---

## 7. 🔴 怎么在**没有桌面的 SSH 通道**上验证一个 GUI

### 结论：可以，靠 `schtasks` 把脚本投进用户的交互式会话

```powershell
# 1) 确认那边**有**人登录着（没登录就没有桌面可画）
query user          # 要能看到 console 会话与用户
Get-Process explorer | Measure-Object   # explorer 在跑 = 有桌面

# 2) 把"启动 + 等待 + 截图"写成一个 .ps1，再用一个 .cmd 包一层把 stdout 重定向到文件
#    （直接交给计划任务的话，脚本自己解析失败时**什么都留不下**）
# 3) 注册成**交互式**计划任务并立刻运行
schtasks /create /tn heyta-window-capture /tr C:\src\heyta-capture.cmd `
  /sc once /st 00:00 /ru <用户名> /it /f
schtasks /run /tn heyta-window-capture
```

截图用 `System.Drawing` 的 `CopyFromScreen` + `GetWindowRect`（只截应用窗口，不截整屏）。

**实测证据**（截图见 [`evidence/window-first-run.png`](evidence/window-first-run.png)；
下面这段是从 Windows 侧日志里**逐字**抄下来的，原文件按仓库规则不入库）：

```
=== capture in session 2 ===
MAIN_WINDOW_HANDLE=328280
MAIN_WINDOW_TITLE=heyta
WINDOW_RECT=26,26,1152x587
PNG_SAVED=True bytes=42088
DB_EXISTS=True            ← 库真的建出来了
```

窗口里那行「还没有任务。上面写一条试试。」不是硬编码 —— 它是 `listTasks()` 穿过
Jint → `app-host` → `SQLite` 之后返回的空列表被渲染出来。**所以这张截图同时证明了整条 D2 链路。**

### 这条路上一共踩了 6 个坑（都写下来，省下一次重走）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 脚本报"意外的标记 / 缺少大括号"，**位置离现场很远** | **PowerShell 5.1 把 UTF-8 无 BOM 的脚本按 ANSI 解码**，中文注释把字符串字面量拆坏 | 脚本存成 **UTF-8 with BOM** + CRLF |
| 2 | `@'...'@` here-string 解析失败 | 同上（LF 行尾 + 无 BOM） | 同上；或干脆**避免 here-string**，用数组 `@(...) -join "`n"` |
| 3 | C# 报 `CS2015 是二进制文件而非文本文件` | macOS `tar` 把 AppleDouble `._*` 资源叉也打进了包，编译器当成源文件 | 打包用 `COPYFILE_DISABLE=1` + `--exclude='._*'` |
| 4 | 计划任务"成功"了，但**什么都没发生** | 一行残留的 `Set-Content -Value $cmd` 把刚写好的 `.cmd` **覆盖成 0 字节** | 任务返回 0 **不等于**它做了事 —— 必须回头查产物（这次是 `.cmd` 的字节数与 stdout 文件） |
| 5 | `Register-ScheduledTask -Principal` 报参数为空 | 在本机这条 SSH 通道上 `$principal` 拿到 null（**根因未查明**） | 改用 `schtasks.exe /ru <用户> /it`，实测可用 |
| 6 | 在 SSH 里直接跑 exe 得到 `0xC0000142` | 会话 0 没有桌面，WinUI 起不来 | 这是**预期**的；必须走交互式会话（也就是本节的做法） |

⚠️ 另外两条与"能不能跑"无关但会误导判断的：

- **`self-contained` 的判定别用 `Microsoft.WindowsAppRuntime.Bootstrap.dll`** ——
  自包含模式下要看 `Microsoft.WindowsAppRuntime.dll`（实测输出目录 162 个文件、
  14 个 `WindowsAppRuntime*`）。用错文件名会把"已经自包含"误判成"没自包含"。
- **日志编码**：PS 5.1 的 `Add-Content` 默认按 ANSI(GBK) 写，中文会变乱码。
  留档时按 GBK 解码再转 UTF-8，否则证据读不出来。

