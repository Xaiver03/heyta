# `apps/desktop-windows` —— Windows 原生壳（WinUI 3 / C#）

> 状态：**最小垂直切片已通过**。壳能在真 Windows 上构建；跨语言那一层有**自动化冒烟**
> （在任意 OS 上可跑，已通过 12/12）。
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
┌─ packages/app-host/src/windows-bridge.ts（TS，唯一真源）───────┐
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
node apps/desktop-windows/scripts/build-bridge.mjs
#    → apps/desktop-windows/assets/app-bridge.js（约 1.2 MB，整个 app-host 栈）

# ② 跨语言那一层：无头冒烟（任意 OS，已通过 12/12）
HEYTA_BRIDGE_BUNDLE="$PWD/apps/desktop-windows/assets/app-bridge.js" \
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
| **放进 `packages/app-host/src/windows-bridge.ts`** | ✅ 天然解析得到 `@heyta/*`，**且自动进入该包既有的 typecheck** |

## 4. 🔴 两个"本机绿、Windows 上必炸"的坑（都是冒烟抓出来的）

### 坑 1：`--platform=neutral` **默认不理 `main` 字段**

打包时报 `Could not resolve "hash-wasm"`。看着像缺依赖，其实是解析规则没配：
`neutral` 平台的 `mainFields` 默认是**空数组**，而 `hash-wasm` 只有 `main`。
⇒ `bundle-spike.mjs` 里显式给了 `mainFields: ['module','main']` + `conditions`。

### 坑 2：**驱动包装必须在 JS 侧**，不能把 CLR 对象直接交给适配器

第一版 `driverFactory: () => clrDriver`，一跑就炸：

```
HeytaApp.open 失败：'c' is an invalid start of a value. LineNumber: 0
  at all (app-bridge.js:11966)   ← 适配器在 JSON.parse 行数据
```

原因：契约里 `driver.all(sql, params)` 的第二个参数是**参数数组**，
而 C# 的 `all` 收的是 **JSON 文本** —— Jint 把 JS 数组塞给 `string` 形参得到垃圾字符串。
⇒ 参数与行的编组只在 JS 侧发生一次，C# 只看见字符串。
这与 W0-2 spike 里验证过的形状逐字相同。

**这两个坑都发生在"Windows 上真的跑起来"之前** —— 这正是把 Core 拆出来的回报。

## 5. 已知缺口（不要假装没有）

| 缺口 | 说明 |
|---|---|
| **没有开窗截图** | 壳能构建，但"启动一个窗口并截图"需要在有桌面会话的 Windows 上做；本仓目前的 Windows 验证都是 SSH（无会话） |
| **打包 / 签名 / 安装器** | 未做（MSIX 与签名证书都缺）；目前只能 `dotnet build` 出 exe |
| **系统小组件** | 未做。widgets 要求 **packaged app** + 一个独立的 `IWidgetProvider` COM exe server；计划 §2.3 W2 |
| **同步未接线** | facade 故意不传 `serverUrl` ⇒ 不建同步客户端。要接的时候是**在 facade 加一个函数**，不是把同步写进 C# |
| **界面只有任务列表** | 象限 / 清单 / 标签 / 重复 / 备注编辑 / 设置都还没有门面 |
| **编组开销** | 用 JSON 文本过边界，实测约 **4.9 µs/行**（[基准](../../research/spikes/sqlite-driver-csharp/README.md)）。这是**已知取舍**，换的是"类型映射只有一处" |
| **Jint 约束不可捕获** | 引擎失控（死循环/内存暴涨）会**杀掉整个进程**。W1 要么做隔离，要么显式接受（已进计划风险登记） |
| **不在任何门禁里** | `check:design` / `check:layering` 等扫描器都是 JS/TS 的，看不到 C#。计划 §6 已登记要补 |

## 6. 下一步（按价值排序）

1. **在真 Windows 上启动窗口并截图**（需要桌面会话）。
2. 把无头冒烟接进门禁：`dotnet` 存在就跑，不存在就**显式报告跳过**。
3. 门禁覆盖 C#：`check:licenses:nuget` 已经会扫到本目录的 `*.csproj`（它按仓库遍历）。
4. 界面按需长：一个视图一个视图地加，**每加一个都要问"原生界面真的渲染它吗"**，
   不要为了让 C# "看起来完整"而搬运无用数据。
