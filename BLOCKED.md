# BLOCKED — 待裁决清单

**2 项待裁决**（第 1、2 项不由本次改动造成），外加第 3 项 ——
**已于 2026-09-30 当场定案并落地了第一半**（见文末，保留原文以便读它的推理）。

---

## 1. `pnpm check` 的 e2e 段当前是红的：`motivation.spec.ts` 两条

> 记录时间：2026-09-30。**不是本次任务的改动造成的** —— 见下面的对照实验。

| 项 | 值 |
|---|---|
| 失败用例 | `e2e/tests/motivation.spec.ts` 的<br>① `🔴 今日进度卡常驻做事视图，且不在设置页与成长页`（`[data-testid="today-progress"]` 解析到 **0 个**元素）<br>② `每个视图都有实质内容（白屏检测）`（`习惯` 视图 body 文本长度 **60**，阈值 `> 60`） |
| 复现 | 稳定复现（单跑该文件同样 2 红、5 绿），**不是负载型 flake** |
| 归因证据 | **对照实验**：把我对 `apps/web/src/App.tsx` 的两行改动（一行 import + 一行 `<AdminPanel />`）**临时撤掉后重跑，同样 2 红**。⇒ 与本次改动无关 |
| 嫌疑来源 | 工作树里**别的会话未提交的 M3「共享 UI」迁移**：`packages/ui/src/**` 有一批修改与**未跟踪新文件**（`ai/`、`auth/`、`calendar/`、`search/`、`subtasks/`…），`apps/web/src/features/motivation/TodayProgressBanner.tsx` 有 1 行改动、`packages/ui/src/habits/HabitBoard.tsx` +20 行 |
| 为什么本任务不动它 | ① 不在本次改动范围内；② 那批文件有并行分支正在改，动它会撞车；③ 判据本身可能也需要跟着 M3 换装走（第 ② 条的 `> 60` 阈值在"空数据 + 空态只有一句话"时恰好就是 60） |

**本次交付的所有门禁与套件都是绿的**（详见 `PROGRESS.md`）。红的只有这一处，
且已用对照实验证明与本次改动无关。

### 给下一个人的建议顺序

1. 先确认 `packages/ui/src` 那批未提交改动是**谁的、要不要留** —— 若它们本身就未完成，
   先让那条线自己收口；
2. 再看 `[data-testid="today-progress"]`：它由**共享组件** `TodayProgressCard`
   经 `TodayProgressBanner.tsx:45` 的 `testID` 注入。0 个元素意味着**那条接线断了**，
   不是选择器过期（该文件自己的注释记着"换装时 e2e 里按旧类名定位会静默过期"这条教训）；
3. 最后看 `> 60` 那条阈值：它的意图是"白屏检测"，但**空数据下的合法空态就是 60 字符** ——
   这属于"判据钉在一个编出来的数字上"（与 `e2e/live-site/live-domain.spec.ts`
   里 `#root` 字符数那条同一类）。合理修法是改成**按视图断言一个真实元素可见**，
   而不是调大数字。

---

## 本次任务的过程记录（已自愈，不需裁决）

- **`tar` 打包工作树覆盖了生产 `.env`**（详见
  [`docs/reference/environment-traps.md`](docs/reference/environment-traps.md)
  与 [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md) §3.8）。
  已从 `.env.bak-20260930T063250Z` 完整恢复并重新施加域名改动；
  数据库未受损（实测 8 个用户可查）。
- **`deploy.sh` 因 `caddy` 绑不上 :80 而以"启动失败"收尾。** 迁移与 `supersync`
  容器**都成功了**，最终两个容器都 `healthy`。这是 compose 栈与宿主 nginx 的
  固有冲突，不是应用故障（已入档）。
- **两道结构性门禁各拦下我一次**：`ht-*` 族不许新增（把 `.ht-admin` 折进
  `.ht-settings__admin-*`）、空态必须用共享 `EmptyState`（并把词条名里的
  `empty` 段去掉）。两处都是"判据对了、我第一版写错了"，按判据改而不是放宽判据。

---

## 2. `pnpm verify:i18n-failures`（**不在 `pnpm check` 里**）当前 4/91 红

> 记录时间：2026-09-30。**不是本次改动造成的** —— 证据见下。

这 4 条的退出码是 **`-1`**，而那正是 `runCase` 的**初始值** ⇒ 它们不是"断言没红"，
而是 **`body()` 自己抛了异常**（脚本原文：
「探针自己抛了异常（多半是锚点失效）」）。

| 组 | 用例 | 真因 |
|---|---|---|
| `recurrence` | `zh 词条「每天」→「每日」` / `en 词条漏出中文` | 脚本改的是 `packages/i18n/dist/index.js`，但 `tsup.config.ts` 是**多入口**（R7：根入口 + 单语言子路径）⇒ 词条被 code-split 进 `chunk-*.js`，`index.js` 只是 1176 字节的 re-export 桩，**里面永远没有词条** ⇒ 锚点必然找不到 |
| `sync` | `web 壳把两种失败指到同一条词条` / `移动端不再区分原因` | 脚本的 `SYNC_FAILURE_COPY` 指向 `apps/web/src/features/sync/sync-failure-copy.ts`，而该文件**已不存在**（`git ls-files` 说它不在索引里、`git log` 说它历史上存在过 ⇒ 在某次已提交的重构里被移走/删掉，脚本常量没跟着改）；`apps/mobile/src/sync/status-text.ts` 的锚点也早已不匹配 |

**归因证据**：
- 本次改动**碰过的** 3 个锚点在 `landing` 组，现在**全绿** ✅
  （`<html lang>` / English canonical / hreflang 三件套）——
  这 3 条原先硬编码旧域名，本次已改成从产物里读 `SITE_ORIGIN`，不再随域名过期。
- 上面 4 条涉及的文件里，`sync-failure-copy.ts` **从未出现在本次改动中**（`git ls-files` 可证），
  `dist/index.js` 的结构由 `tsup.config.ts` 的多入口配置决定、与"加了词条"无关。

**为什么本轮不动它**：`apps/web/src/features/sync/{SyncBar,store}.tsx?` 当前**有别的会话的未提交改动**
（`git status` 显示 ` M`）—— 动 sync 组会直接撞车。

**建议修法**（都不改判据的强度）：
1. `recurrence` 两条：别写死 `dist/index.js`，改成"在 `packages/i18n/dist/` 里找到**含该锚点**的那个文件再改"
   （或把 `I18N_DIST` 指向 `chunk-*.js` 中匹配的那个）。写死产物文件名会被每一次构建的哈希改掉。
2. `sync` 两条：把 `SYNC_FAILURE_COPY` / `MOBILE_STATUS_TEXT` 常量更新到重构后的新位置
   —— 这正是"换装共享组件时，脚本里的旧路径会静默过期"的同一类问题。

---

## 3. ✅ **已定案**（甲）+ 第一半已落地：桌面端真应用存储 → 壳的 SQLite

> 记录时间：2026-09-30。背景：产品负责人重述 **ADR-0036 P5 / 主计划 §1.1**——
> 「主战场 = 移动端 + macOS + Windows，**Web 不是**」。而桌面壳今天的形态是
> **原生壳里包着一个把自己的数据存在 WebView OPFS 里的 web 应用**（M2-D 已知边界）。
>
> ### 定案（产品负责人 2026-09-30 选甲）
>
> **甲**：不新写桥，只换**传输**；后端由**壳注入的标记**选定，并把选中的后端
> **强制写进壳的证据**（`m2-evidence` 加 `STORAGE=`）。代价是改一条既有纪律
> （从"纯环境变量"变成"宿主标记 + 强制上报"），换取**只需一份产物**。
>
> ### 已完成（写到这里时都绿了）
>
> **存储层（第一半）**
>
> | 项 | 结果 |
> |---|---|
> | 桥是**传输无关**的 | ✅ 实测：`serveOpLogWorker(port)` / `createWorkerOpLogStore(worker)` 只吃 `postMessage`/`onmessage`，**不需要新桥** |
> | 🔴 裸 JSON **不够** | ✅ 实测抓到：`markUploaded(ReadonlyMap)` 的 `Map` 在 JSON 里变 `{}` ⇒ `serverSeqsByOpId is not iterable`（13 条契约同时红） |
> | 线码 `oplog-wire-codec.ts` | ✅ 新增 `encodeOpLogWire`/`decodeOpLogWire` + **对称的** `createOpLogWirePort`（两侧各包一次）；**它自己有个真 bug 被契约抓住**：`undefined` 的盒子只写了 1 个键，而 `isBox` 要求恰好 2 个 ⇒ `range` 从 `undefined` 变成真值对象 ⇒ **"写进去了但读不出来"**（12 条红） |
> | 契约项 | ✅ 新增「宿主边界（**裸 JSON + 两侧线码** = WebView 传输）」，跑的是**同一套** `OpLogStore` 契约，且用的是壳将要用的**真**包装器 ⇒ 线码够不够用由它担保。**252/252** |
>
> **页侧（第二半）**
>
> | 项 | 结果 |
> |---|---|
> | 后端选择 | ✅ `StorageBackend` 加 `'shell'`：**宿主注入 `__heytaHostStoragePort` 才走它**，且优先于 `VITE_HEYTA_STORAGE`；没有端口时行为逐字不变 |
> | 页侧传输 | ✅ `openStorage()` 第三分支：`createOpLogWirePort(宿主端口)` → 复用**同一个** `createWorkerOpLogSession`（与 Worker 那条路只差传输） |
> | 上报 | ✅ **复用既有的** `globalThis.__heytaStorage.backend`（`initOpLog()` 本来就在写），**没有新增第二套机制** |
> | app 级判据 | ✅ `apps/web/tests/storage-backend-shell.spec.ts`：选择 3 条 + 一条端到端（交握拿到**壳侧给出的** `clientId`，并记录**壳侧实际收到的调用**非空）。**变异验证**：把端口判定改成 `if (false && …)` ⇒ **恰好那 2 条红**，env 那条仍绿 |
> | 回归 | ✅ storage 314/314、web **993 通过**（+3）、`@heyta/storage` / `@heyta/app-host` / `@heyta/web` typecheck 全 exit 0 |
>
> **壳侧（第三半）—— 桥的面与判据已在**本机**验过**
>
> | 项 | 结果 |
> |---|---|
> | 关键前提 | ✅ `openAppHost({driverFactory,dbPath})` **早就在跑**：壳里已经有完整存储栈（引擎 + 原生 SQLite + clientId）。所以 B 的壳侧不是"从零托管"，而是**把 store 暴露出去** |
> | 只允许一个引擎 | ✅ 新增 `openOpLogStore()`（`app-host`，**不建引擎**）并与 `openAppHost` **共用同一段配方**（adapter→store→clientId，不复制）⇒ 壳在 `app` 模式只调 `openOpLog`，引擎归页侧 |
> | 桥的新面 | ✅ `HeytaApp.openOpLog()`（返回**库给出的** clientId）+ `HeytaApp.invokeOpLog({requestJson})`；后者用**与 Worker 桥同一个** `handleOpLogWorkerRequest`，并在两端成对套线码 |
> | 跨语言判据 | ✅ `apps/desktop-windows/smoke` 新增 5 条：`openOpLog` 拿到 clientId、空库 `getAllOps`=0、`appendLocal` 返回 seq `[1]`、再 `getAllOps` 读回**正是刚写那条**、以及 🔴 **C# 独立读那个 `.sqlite`，`ops` 表里有行**（不经 TS 栈） |
> | 本机就能跑 | ✅ **不需要 Windows**：`HEYTA_BRIDGE_BUNDLE=… dotnet run -c Release --project apps/desktop-windows/smoke/Smoke.csproj` ⇒ **19 项全绿、exit 0**（本机 dotnet 10.0.108） |
> | 注入验证 | ✅ 把 `openOpLog` 改成"假装打开成功、不真建 store" ⇒ `invokeOpLog` **响亮抛错**（`op-log 存储还没打开`）⇒ 判据非空转 |
> | 回归 | ✅ app-host 739/739、node-host 139/139、web 993、storage 314；`app-host` typecheck exit 0 |
>
> **WebView2 管道（第四半）—— ✅ Windows 端到端已验到绿**（2026-09-30）
>
> | 判据 | 结果 |
> |---|---|
> | 页侧自己报告走了壳的存储 | `STORAGE=shell` + `STORAGE_HOST=on`（写进壳的证据文件） |
> | 数据真的在壳的库里 | 从**壳外**扫 `%LOCALAPPDATA%\heyta\heyta.sqlite`：`WAL title=True ops_table=True`（不依赖 sqlite3 CLI，字节级 UTF-8 扫描；应用持着库 ⇒ 要 `FileShare.ReadWrite`） |
> | **重启之后还在** | 杀掉应用 → 重开 → `titleCount=1`。那一轮的 WebView OPFS **从没见过**那条数据 ⇒ 只可能来自壳的 SQLite |
> | 证据 | [`apps/desktop-windows/evidence/storage-host/`](apps/desktop-windows/evidence/storage-host/README.md)（三份产物 + 人看过的截图 + 边界） |
> | 过程中抓到的一个真漏子 | 桥的 bundle **不入库**而 csproj 只"拷贝已存在的那个" ⇒ 同步不带它就**静默用旧桥**。修：进同步清单 + **第二个新鲜度锚点** |
>
> ### 还剩什么（下一步）
>
> 1. ✅ **OPFS → 壳的一次性导入已经做完并验通**（守卫与 IndexedDB 那条路径**共用一份实现**：只在目标为空时导入 / `appendImported` / 不删来源 / 失败不阻断启动）。判据链与**注入验证**见 [`apps/desktop-windows/evidence/storage-host/`](apps/desktop-windows/evidence/storage-host/README.md) 的 `import-1..5`；
> 2. ✅ **默认开关已翻**（存储宿主默认开；`HEYTA_SHELL_STORAGE=0` 是逃生门）。⚠️ 自此 `heyta.sqlite` 是**唯一**事实来源（OPFS 只在首次导入时被读一次、且不删）；
> 3. 🟡 **macOS 壳侧托管已验绿**（JavaScriptCore + libsqlite3，同一条判据，证据在 `apps/desktop-macos/evidence/storage-host/`）。**只剩 WKWebView 接线**（`WKUserScript` + `WKScriptMessageHandler` + `STORAGE=`）。⚠️ WKWebView **没有 CDP** ⇒ 那一格的验证不能照搬 Playwright 附着，要用 macOS 壳已有的**壳内 `evaluateJavaScript` 探针**（`check-macos-window.mjs` 那条路）—— 这与 C 是同一道题；
> 4. 两端的回执要求一致：**从壳外读 `.sqlite`** + **重启之后还在** + 人看过的截图。

### 实测到的现状（三条，都是这轮现查的）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 桌面壳里"真应用的数据"落在 **WebView 自己的 OPFS**（VFS 名 `heyta-web`），与壳的 `heyta.sqlite` **是两份** | `apps/web/src/lib/oplog.ts` → `apps/web/src/worker/storage.worker.ts`（`createOpfsSahPoolDriverFactory`）；`docs/research/spikes/m2-webview-shell/README.md` §4d |
| 2 | `packages/storage` 的形状**已经为"注入原生绑定"设计好了**：窄接口 `SqliteDriver`（`exec`/`run`/`all`/`close`），注释明写 iOS→Swift 注入、HarmonyOS→ArkTS 注入，且"**适配器逻辑只存在一份**" | `packages/storage/src/sqlite/sqlite-driver.ts` 文件头 |
| 3 | 🔴 **`SqliteDriver` 是同步的，而页 → 壳的通道是异步的** | 接口注释"语句是**同步**执行的"；`MainWindow.xaml.cs` 用 `WebMessageReceived`（异步） |

### ~~分叉~~（**已裁决**：选甲；以下是当时的对比，保留以便读它的推理）

| 路 | 做法 | 代价 | 风险 |
|---|---|---|---|
| **甲（我推荐）** | 照 `IndexedDbAdapter` 的形状新增一个**异步** `DbAdapter` / `OpLogStore`，把存储操作 RPC 到壳，SQL 在壳里跑（壳已有 `Microsoft.Data.Sqlite` + `SqliteBridge.cs`，且 `packages/storage` 契约**已在 Jint 下重放过 50/50**） | 中：异步适配器 + 壳侧 RPC 面 + 后端选择 + **OPFS→壳的一次性导入**（照 `migrateLegacyIndexedDb` 的形状，只在目标为空时导入） | 要决定壳侧 RPC 开在 **op 级还是 SQL 级**；要决定"一个构建 vs 两个构建"（见下） |
| **乙** | 把同步驱动搬过桥：`SharedArrayBuffer` + `Atomics.wait`，在 Worker 里把异步桥变同步 | 高 | 🔴 **SAB 需要跨源隔离（COOP/COEP）**，而产物用 `SetVirtualHostNameToFolderMapping` 服务、**拿不到自定义响应头**（得靠 `WebResourceRequested` 手工注入）；`Atomics.wait` 又只能在工作线程里用 |

### ~~待裁决的那件事~~（**已裁决**：选「壳注入标记 + 强制上报」；以下保留推理）

`apps/web/dist` 是**同一个构建**同时给 web 与两个桌面端用的。而本仓既有纪律是
**用显式环境变量选存储后端**（`VITE_HEYTA_STORAGE`，理由逐字见 `oplog.ts`：
「探测会让"这次到底用了哪条路"变得不可知」）。两者相撞，只能二选一：

1. **为桌面端单独构建一份**（`VITE_HEYTA_STORAGE=native`）—— 纪律不变，但**产物变两份**；
2. **允许"由壳注入标记 + 把选中的后端强制上报"**（推荐）：判定仍是显式的（标记是宿主注入的，不是嗅探环境），
   且把结果写进壳的 `m2-evidence`（那里已有 `WEB_MODE=` 这种字段，加一个 `STORAGE=` 即可）——
   但**它改了一条既有纪律**，所以不擅自定。

**在裁决前我不动 B 的代码**：猜错方向会白改**存储归属**，
而它落在 AGENTS.md §3「schema 与持久化字段」的硬约束面上，返工代价远大于等一次拍板。
