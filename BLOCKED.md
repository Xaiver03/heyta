# BLOCKED — 待裁决清单

**第 1、2 项已于 2026-09-30 的收尾轮解决并落地**（各自保留原文以便读推理，
下面写清了"当时的假设哪里错了"）。第 3 项**已于 2026-09-30 当场定案并落地了第一半**（见文末）。
第 4 项（四端重装）**23:16–23:32 那一轮四端全绿、脚本 `REINSTALL_EXIT=0`**（§7）——
所以这一节**下面原来写的"还剩两项待裁决"已经不成立**：~~待裁决的只剩
**§3 的第二半**（四条平台门禁"响亮跳过 ⇒ 退出 0"要不要改成判红）、~~
**§5**（`§7 第 N 条`编号体系对不上，修它必须动 `AGENTS.md`）和 **§6**（落在别人线上）。

> ✅ **§3 的第二半也已裁决并落地**（2026-10-01 文档中心收尾 Goal 任务 3）：
> 分界 = **平台不符 / 工具链不存在 ⇒ 合法跳过（exit 0 + 响亮 SKIP 行）；
> 平台与工具都在、取证却失败 ⇒ 判红（exit 1）**。逐条对过四个脚本：
> `check-macos-shell` / `check-windows-shell` / `check-linux-shell` 的跳过分支
> 本来就全是"平台或工具缺失"（合规，未动）；唯一违背分界的是
> `check-macos-window` 的 **exit 4（ScreenCaptureKit 未授权）→ 静默跳过**，
> 已改判红并写明修法（给终端授屏幕录制权限）。变异验证：把取证脚本指到
> exit 4 的桩 ⇒ 门禁 exit 1 且红在授权指引上；还原后真实跑一遍 exit 0。
> 非 darwin 分支本机无法实测 ⇒ 未改动、如实记录"未实测"。
> 变异红 / 真实绿的完整输出在 PROGRESS.md 本轮记录。

🔴 而 23:16 那一轮顺带把**本文件自己两条过期归因**照了出来 ——
§4 与 §7 原先写着"mac 因**环境**（无屏幕录制权限）装不上"，实测**不是**：
真正的原因是有两个**尚未提交**的 Swift 文件编译失败，而它们后来由**所有者提交了**，
`swift build` 现在绿。已按实测改写，原文留在各节里。

---

## 1. ✅ **已解决**（2026-09-30 收尾轮）：`motivation.spec.ts` 两条红

> 🔴 **本条当时的假设是错的，留在这里就是为了看清它错在哪。**
> 下面第 2 步写着「0 个元素意味着**那条接线断了**，不是选择器过期」—— 实测**两者都不是**：
> `TodayProgressCard` 的 `testID` 一路透传正常，`任务` 视图恰好渲染 **1 个**
> `[data-testid="today-progress"]`。真正的原因是**一次已提交的产品改动**
> （`02fef9a7`，2026-09-30：进度卡从"常驻做事视图"收窄成**只在任务视图**），
> 而 e2e 契约没跟着改 —— 红的是**契约过期**，不是接线，也不是产品坏了。
> 症状（0 个元素）在"契约过期"和"接线断了"两种情况下**长得一模一样**，
> 这就是为什么归因必须靠实测而不是靠读注释。

| 收尾轮做了什么 | 结果 |
|---|---|
| 契约改成与产品决定一致 | `CARD_ON = ['任务']`；`CARD_OFF` **由 `TABS` 派生**（加视图不会漏），两个浮层（设置/搜索）单独排除 |
| 阈值型判据换掉 | 「每个视图都有实质内容」的 `body 文本 > 60` ⇒ 新增 `VIEW_ANCHOR: Record<Tab, string>`，**逐视图断言它自己的那块板 `toHaveCount(1)`**；并加两条对账（锚点表的键 ↔ `TABS` 双向），新视图不登记锚点就直接红 |
| 顺带修掉一个潜在缺陷 | `e2e/tests/helpers.ts` 的 `switchView` label 联合**漏了 `日历`/`搜索`**，而两处调用点已经在传它们 —— e2e 不在根工作区、没有 typecheck，所以永远不会红（esbuild 只转译）。已补齐 |
| 全量结果 | `e2e/tests/motivation.spec.ts` **7 passed**；`pnpm check:ai-e2e` 整组 **exit 0** |

**三条变异验证**（证明新判据会红，且红得精确）：

| # | 注入 | 实测 |
|---|---|---|
| A | `App.tsx` 渲染门放宽成 `tasks \|\| calendar` | `Error: 日历 不该显示今日进度卡` / Expected `0` / Received `1`（`motivation.spec.ts:165`） |
| A2 | 渲染门挪到 `growth`（卡片离开任务视图） | `Error: 任务 应当显示今日进度卡` / Expected `1` / Received `0`（`:161`） |
| B | 在**产品侧**打断锚点（`HabitsView.tsx:260` `testID="habit-board"` 改名） | 白屏检测精确报 `习惯 视图的根锚点 [data-testid="habit-board"] 必须渲染出来` / Expected `1` / Received `0`（`:254`）—— 一次只红一个视图，说明"红了能直接定位到哪个视图的哪个组件" |

没有调大任何数字、没有删任何断言、没有放宽阈值。下面原文照留。

---

### 原始记录（已解决，保留以便读它的推理）

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

## 2. ✅ **已解决**（2026-09-30 收尾轮）：`pnpm verify:i18n-failures` 4 条红

> 逐条查过：**四条全是探针自己的锚点过期，没有一条是产品缺陷**。
> 修法一条都没降低判据强度（改的是"注入点搬到逻辑现在住的地方"，不是"少注入一处"）。

| 组 / 用例 | 真因（收尾轮实测） | 修法 |
|---|---|---|
| `recurrence`「zh 词条『每天』→『每日』」<br>`recurrence`「en 词条漏出中文」 | 锚点写死在 `packages/i18n/dist/index.js`，而 `tsup.config.ts` 多入口 + code-split 后词条各在**独立 chunk** 里：`index.js` 只有 1176 字节 ⇒ **永远不可能命中** | 新增 `i18nDistFileWith(anchor)`：在 `packages/i18n/dist/**/*.js` 里找**真的含这条锚点**的那个文件；0 命中 / 多命中 / 没有 dist 三种情况一律**响亮抛错**（静默跳过 = 这条检查永远通过）。实测 zh 锚点唯一命中 `chunk-E5BUEZYD.js`、en 锚点唯一命中 `chunk-BRR4QWD2.js` |
| `sync`「web 壳把两种失败指到同一条词条」 | 注入目标 `apps/web/src/features/sync/sync-failure-copy.ts` **已被 M3 第四刀删除**（那张表收进 `packages/ui/src/sync/model.ts`），`readFileSync` 直接 ENOENT | 注入改打**共享层那张表**，跑 `@heyta/ui` 自己的 `tests/sync-model.spec.ts`（它读源码，不受 `dist/` 新鲜度影响；web 壳确实消费这张表仍由本组末尾 `webSyncRun` 的基线绿钉住）。用例改名「共享表把两种失败指到同一条词条」—— 现在两端共用一份，指错就是**两端同时**给错的下一步 |
| `sync`「移动端不再区分原因」 | 锚点 `": t(SYNC_FAILURE_KEY[status.reason]);"` 随 M3 第四刀消失（本地那张表删了，改成 `syncFailureMessageKey` 的投影） | 锚点换成当前调用点 `const key = syncFailureMessageKey(status.reason);` ⇒ 改成 `const key = undefined;`，移动端套件里「已知失败原因各有各的句子」必红 —— 这条钉的仍是**壳有没有真的去区分** |

**结果**：`node scripts/verify-i18n-failures.mjs` 全量 **91 个用例全部符合预期、exit 0**
（`recurrence` 10/10、`sync` 5/5 单独也各跑过一次）。用例总数仍是 91，没有靠删用例变绿。

✅ **23:02 复测：仍然 91/91、exit 0**。值得复测的原因不是"保险"，是**这套探针的锚点正好压在
别人正在改的文件上** —— 上表那三条注入分别打在 `packages/i18n/dist/**/*.js` 的 chunk、
`packages/ui/src/sync/model.ts` 与移动端调用点上，而当时工作树里躺着**外来的
`packages/i18n/src/locales/{zh-CN,en}.ts`** 与 `apps/web/src/{App.tsx,features/inbox/InboxBell.tsx,styles/app.css}`。
⇒ **保质期**：只要有人改了词条文案（`『每天』/『每日』`那类锚点）或改了 `syncFailureMessageKey` 的调用形状，
这几条会**报"锚点找不到"而红** —— 那是探针在说话，不是产品坏了，按上表的修法换锚点。

---

### 原始记录（已解决，保留以便读它的推理）

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
> 3. ✅ **macOS 的 WKWebView 接线也做完了**：真应用走壳的 SQLite（`STORAGE=shell`），且**从壳外读到那条经界面写入的数据**（`heyta.sqlite-wal: title=True`）。⚠️ WKWebView **没有 CDP** ⇒ 造数据用的是壳内 `evaluateJavaScript` 的旅程探针（`HEYTA_STORAGE_JOURNEY`）—— 那条机制正是 C 要用的；
> 4. 两端的回执要求一致：**从壳外读 `.sqlite`** + **重启之后还在** + 人看过的截图。
>
> ### 🔴 C 卡住了（2026-09-30 量出，不是猜的）
>
> **macOS 壳里通行密钥做不了**：带焦点实测 `isUserVerifyingPlatformAuthenticatorAvailable() === false`
> ⇒ 走不到 Touch ID（用户看到"没反应/超时"）；不带焦点则是 `NotAllowedError: The document is not focused`
> （`HEYTA_NO_FOCUS=1` 与本仓取证约定冲突）。硬件已排除（`bioutil -r` 正常，Mac16,5）。
> 另外产品负责人指出**登录界面不符合正常用户旅程**（不该让用户填服务地址）。
> ⇒ C 需要先定一个产品选择（壳内通行密钥 / 系统浏览器 `ASWebAuthenticationSession` / magic-link），
> 三个选项与实测细节见 [`docs/plans/desktop-storage-host-handoff.md`](docs/plans/desktop-storage-host-handoff.md) §6。
> **在选项定下来之前不要往"壳内通行密钥"加代码**。
>
> ✅ **C 的机制已落地并验绿**（第 10 轮）：壳内探针走"请求登录链接 → 粘贴令牌"，
> `AUTH_STATE=signed-in`；走的是面板**产品已有**的「粘贴登录链接 / 令牌」入口。
> ✅ **红/绿一对都拿到了**（有效令牌 ⇒ `signed-in`；坏令牌 ⇒ `signed-out` + 面板说出原因）。
>
> 🔴 **顺带修掉一起真事故（第 11 轮）**：`packages/i18n/src/locales/*.js` 是两份 **CJS 残渣**
> （未被跟踪、被 `.gitignore` 忽略 ⇒ `git status` 看不见），而打包器**选中了它们**
> ⇒ `dist` 里带**裸 `exports`** ⇒ 浏览器首跳就抛 `Can't find variable: exports`，
> **两个桌面壳与任何打包产物全废**（`vite dev` 看不出来，所以 D 绿而壳全挂）。
> 修法：删残渣 + 重打 `@heyta/i18n` + 重打 `apps/web/dist`。
>
> ✅ **D 已完成**（第 9 轮）：RP ID 从 IP 字面量换成 `localhost`（根因：RP ID 必须是 origin 的域名后缀，而 Chromium 拒收 IP 字面量），`pnpm verify:web-auth` **6/6 绿**且**注入验证**过（翻回 IP 即红）。证据在 `apps/web/evidence/auth-journey/`。

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

---

## 4. ✅ 四端重装（AGENTS §6.1.1）—— 本节是**20:xx 那轮"两端红"的原文**，两条红都已解除

> 记录时间：2026-09-30 收尾轮。`pnpm reinstall:all` 完整执行，**没有用 `--skip`、没有降级判据**；
> 失败的两端如实报红（脚本整体 exit 1）。
> ✅ **现状**：两端均已跑绿，最新一轮 23:16–23:32 **四端全绿、`REINSTALL_EXIT=0`**，判据与证据在 **§7**。

> 🔴 **下面 mac 那一行的归因是错的，留原文就是为了看清它怎么错的。**
> 写"发起方没有屏幕录制 / 图形会话权限"时，那一轮**确实**打印过 `could not create image from display`，
> 但重装真正**断在更早的一环**：`reinstall-all.sh` 第 1 段 `swift build` 当场编译失败，
> 红在两个**当时未跟踪**的 Swift 文件上（`ShellAuthSession.swift` / `ShellAuth.swift`）——
> 打包根本没走到取图那一步，所以那条权限报错**不是这一轮红的原因**。
> 23:16 复跑时这两个文件**已由所有者提交**、`swift build` 报 `Build complete!`，mac 段随之全绿。
> 归因错在哪：把**日志里出现过的第一条错误**当成了**流程断掉的那一条**，没有核对断点在第几段。
>
> 🔴 **而且 §4 与 §7 在同一文件里互相矛盾，本轮把它判掉了**：
> §4 那行写着"`.app` 已重打、已签名、已装进 `/Applications`"，§7 写着"`🔴 打包失败`"。
> `/tmp/heyta-reinstall2.txt:6`（`═══ 1. macOS ═══` 之后第一行就是 `🔴 打包失败`，末尾 `:46` 是
> `🔴 mac：失败`、`:51` 是 `EXIT=1`）判定 **§7 对**：那一轮 mac 段**第一段就红了，什么都没重打、什么都没装**。
> "已重打已签名已装进"描述的是**更早一次手工打包**，被误当成这一轮重装的结果 ——
> 这是"**把上一轮的产物状态记进这一轮的结论**"，同一会话在两天里踩过第二次（第一次是 §7 第 82 条）。

| 端 | 结果 | 判据行 / 证据 |
|---|---|---|
| **android** | ✅ 清旧包 → release APK 重打（63M）→ 模拟器全新安装 `Success` → 截图判据 | `contentRatio 0.068`、**主蓝命中 9279**、`/tmp/heyta-reinstall-android.png`（人已看过：heyta 欢迎页、中文、主蓝按钮） |
| **ios** | ✅ 模拟器卸旧 → Release 重打 → 全新安装 → **新鲜度判据**（已装的包比源码新）+ 截图 | `contentRatio 0.066`、**主蓝命中 9450**、`/tmp/heyta-reinstall-ios.png`（人已看过，同一面欢迎页） |
| **mac** | 🔴 `.app` 已重打、已签名（Developer ID 链完整）、已装进 `/Applications`，**卡在这台的启动判据** | `sandbox_extension_issue_file_to_process failed … (Operation not permitted)` + `SCShareableContent 里始终没有窗口 34662` ⇒ 截图判据拿不到图。**根因不在产品**：同一进程树里 `screencapture -x` 直接报 `could not create image from display` —— 这台机器上**发起方没有屏幕录制 / 图形会话权限** |
| **windows** | 🔴 **拒绝打包**（源码同步没通过就不打，正是 §7 第 82 条要防的"装旧树还报绿"） | `ssh: connect to host 10.111.127.237 port 22: No route to host` ⇒ `scp: Connection closed` ⇒ `源码包送不过去（windows-pc 不可达？）` |

**当时写给用户的两件事 —— 现在逐条对账**：

1. **mac**：给发起这些命令的那个应用（这次是 Qoder；平时是 Terminal/iTerm）在
   「系统设置 → 隐私与安全性 → **屏幕录制**」里打勾并重开它。
   没有这个权限，`check:macos-window` 与 `reinstall:all` 的 mac 段**必然红**，
   而那**不是代码坏了**（换一个有权限的父进程就能过）。
   ✅ **这条不用做了**：23:16 那轮 mac 段一路走到公证、装订票据、装进 `/Applications`、
   自截屏并数出主蓝 62 个像素 —— 权限本来就够，红的是编译。**但它作为规则仍然成立**：
   真没给权限时这两条会红，且那不是代码坏了。
2. **windows**：把打包机 `windows-pc`（`10.111.127.237`）重新接上（开机 / 同网段 / SSH 可达），
   然后 `pnpm reinstall:desktop`。⚠️ 它**不可达时脚本就是红的**，这是设计 ——
   别用 `--skip windows` 把它蒙过去。
   ✅ **已接上并复跑**：本轮 `ssh` 通、源码包 14M 送过去、新鲜度对账通过、
   远端 `ADD_APPX=OK` / `PAYLOAD_WEBDIST=True` / `M2D=OK` / `RESULT=OK`（§7）。
   ⚠️ 这条"不可达就红、不许 `--skip` 蒙过去"**是脚本行为的说明，不是待办** —— 留着因为它决定了这张表能被读成什么。

### 顺带记两类"看起来是故障、其实不是"的红（都实测过）

| 现象 | 真因 | 该怎么读 |
|---|---|---|
| `check:journey-coverage` / `check:ai-e2e` / `pnpm -r test` 在同一次批量里**各红一次**，单独重跑**三条全绿** | 与**另一个会话的构建并发**撞上了（`pnpm build` 里 tsup 带 `clean: true`，会先把 `packages/*/dist` 删掉再写）—— 读的一侧正好读到空/半份 | 结构性门禁红了，先**单独重跑那一步**再归因；能单独跑绿 = 不是代码坏了（§7 元规则一：先怀疑探针） |
| `apps/mobile test` 首跑报 3 条 unhandled rejection：`Flow is not supported`，指向 `react-native/index.js` 的 copyright 头，测试本身 **418 全过** | 冷缓存下某条动态 import 把 `@heyta/ui` 的入口（含 RN）拖进了 node 环境；跑过一次后不再出现 | 这条**已经写在** `apps/mobile/tests/auth-flow.spec.ts` 的文件头注释里（"移动端测试刻意不 import `@heyta/ui`"）。它仍是**一个真实的脆弱点**：判据退出码被一个不影响断言的 rejection 决定。修法要么给 `@heyta/ui` 加纯逻辑子入口（`status-text.ts` 文件头第 1 条早就登记过），要么让 vitest 不把这类转换期 rejection 记成失败 —— **本轮没动**，留给下一条改 mobile 测试线的会话 |

---

## 5. 🔴 `§7 第 82 条`现在**指四件不同的事** —— 编号已不再唯一标识一条陷阱；修它必须动 `AGENTS.md`，所以在等一次拍板

> 记录时间：2026-09-30 收尾轮（查 Goal 第 3 项的余波时撞上的）。
> 归属清楚（没有人正在改这两个文件的编号区），**但修复动作落在 `AGENTS.md` §7 的规则区**，
> 而 AGENTS §8 明确写着"不修改 `AGENTS.md` 的**规则**部分，除非用户在当前任务里明确要求"。
> 所以这一条我只**测量并登记**，没有动手。

### 实测（都是可复现命令，不是印象）

```bash
# A) 两个文件里被多条规则复用的编号
grep -nE "^[[:space:]]*[0-9]{1,3}\. (🔴|⚠️)" docs/reference/environment-traps.md AGENTS.md \
  | grep -oE "^[^:]+:[0-9]+:[[:space:]]*[0-9]{1,3}\." \
  | sed -E 's/.*[^0-9]([0-9]{1,3})\./\1/' | sort -n | uniq -c | awk '$1>1{print "#"$2" 被用 "$1" 次"}'
# B) 全部指向这些编号的引用
grep -rnE "第 8[0-3] 条" AGENTS.md BLOCKED.md PROGRESS.md docs scripts e2e apps
```

| 编号 | 被几条不同规则占用 | 分别是什么 |
|---|---|---|
| `38` | 2 | traps `:708` 一个常量当两种单位用（`grace` 既是日历日又是漏次数）· traps `:779` 软键盘吞 tap、点工具报 `success` |
| `77` `78` `79` | 各 2 | traps 里**两套并列序列**（见下） |
| `80` `81` | 各 3 | traps 序列一 `:1692`（`.env` 只给一部分加引号）/`:1720`（SES `SendStatus: 0` ≠ 送到了）· traps 序列二 `:1890`（`am start` 静默失败）/`:1900`（RNW 命令"不存在"先查 `pwsh.exe`）· `AGENTS.md:931`（RN-web 吞 keydown）/`:970`（窗口取证三坑） |
| **`82`** | **4** | `AGENTS.md:906` 非空白挡不住错误屏（主蓝判据）· `AGENTS.md:993` 远端字节 == 本地工作树 · `traps:1751` `pnpm build` 报成功却不产出 `.d.ts` · `traps:1911` `aka.ms` 短链回退到 Bing 且回 `HTTP 200` |
| `83` | 3 | `traps:1775` 别在主工作树里构建要发布的前端产物 · `AGENTS.md:953` 探针改变被测状态 / 原生控件跟系统强调色 · `AGENTS.md:1019` MSIX 脚本必须纯 ASCII |

> 🔴 **22:12 复测：本节结构全对，四个具体数字要更正**（§9 的更正指回这里，所以两边都留字）：
> ① **`#83` 在 traps 文件内部只出现一次** —— 上表那个"3"是**跨 AGENTS+traps 合并命名空间**的计数
> （traps `:1775` 一次 + AGENTS 两条）。traps 内部真重复的是 **`#38` 与 `#77…#82`**。
> ② 本节引用的 `:1890 / :1900 / :1911` 三条行号**已漂移 +9**（`e4767d0f` 之后）⇒ 现为 `:1899 / :1909 / :1920`。
> ③ "末段 **7** 条 `###` 无号"现在是 **10** 条（`:1933 :1950 :1970 :1979 :2015 :2039 :2083 :2105 :2123 :2139`）
> ⇒ 甲方案第 5 步的号段应是 `98–107`，不是 `98–104`。
> ④ "引用共 **20** 处（scripts 6 处）"复测不复现：实测 **27 处 / 12 个文件**，`scripts/` 只有 **2** 处。
> ⑤ 另加一条本节没说的：**traps 里 `#1…#85` 每个号都存在**，所以"下一个空号是 **86**"。
>
> ⚠️ 这四条错的都是**同一个性质**：号与结构对得上，**行号与计数随别人并发写入漂移**。
> 所以引用它们时必须带**测量时刻**（本节原来只有日期）—— 这正是 AGENTS §5.1 那条
> "『没有入口』这句话的保质期取决于别人什么时候补上它"的同一课，只不过这次是行号。

四条结构性事实（都是实测）：

1. **traps 文件里有两套并列序列**：`:1616` 起 `77…85`，紧接着 `:1848` 又从 `77` 重新开始到 `82`。
   两者都出自同一个提交 `f5f823cf`（提交信息还写着"环境陷阱 83 条"，而文件里最大编号是 **85**）。
2. **`AGENTS.md` §7 自己写了六条 inline 正文**（`:906 :931 :953 :970 :993 :1019`，顺序还是 `82,80,83,81,82,83` 倒着走的），
   而它同一节的开头写着"**全部正文在** `docs/reference/environment-traps.md` … 新的条目**追加到 traps 文件末尾**，不要写回本文件"。
   🔴 这六条的主题（`stopPropagation` / `accent-color` / `contentRatio` 主蓝 / `window-id.swift` / sha256 对账）
   在 traps 文件里 **grep 命中 0 次** —— 也就是说这六条规则的正文**只活在 AGENTS.md 里**，
   而索引声称它们在另一个文件中。
3. **`AGENTS.md` 的号段表只覆盖了那六条里的前四条**。表里 `80–83` 一格写的是
   `#80 RNW 吞 keydown`、`#81 窗口取证三坑`、`#82 错误屏"非空白"`、`#83 探针污染状态`，
   而后补的两条正文（`:993` 远端字节 == 本地工作树、`:1019` MSIX 脚本必须纯 ASCII）**占了同一个号却没进表**。
   直接后果：`AGENTS.md:711` 那句"📌 教训进 §7 第 82 / 83 条"说的是后两条，
   而**按同一份文件里的号段表去读，它指向的是前两条** —— 索引与正文在同一个文件里互相指错。
4. **末段还有 7 条 `###` 条目从来没拿到编号**（`:1924 :1941 :1961 :1970 :2006 :2030 :2074`），
   其中"e2e 套件不能与自己并发"正是 AGENTS §7 用"同一份 traps 文件里"指代、却没有号可指的那一条。

**引用受害面**：`第 8[0-3] 条`形式的引用共 **20 处**（`AGENTS.md` 3 处、`scripts/` 6 处、其余在 docs / PROGRESS / BLOCKED）。
其中最刺眼的一处是**同一个文件里同一个字符串指两条规则**：`AGENTS.md:381` 的"§7 第 82 条"要表达的是主蓝判据，
`:390` 的"§7 第 82 条"要表达的是远端字节对账。

### 为什么这是"门禁挡不住的死角"（和 Goal 第 3 项同一族）

`check:docs` 解析的是**链接**：指向不存在的文件会红。而**编号引用不是链接** ——
`§7 第 82 条`写作纯文本，命中四条规则它照样 exit 0。
按本轮 Goal 的说法：这是一条**永远不会失败的检查**。它比死链更贵，因为这些号是 §7 唯一的人类检索键，
`§7` 元规则一（先怀疑探针）依赖的正是"号能定位到唯一一条"。

### 我**没有**做的两件事，以及为什么

1. **没有加一条"编号必须唯一"的门禁**。它今天一上来就会红，而唯一能让它绿的写法是把现存 8 个重复号
   **全部登记成"已知豁免"** —— 那等于把判据放宽到迁就欠账（AGENTS §8.4：不要为了让测试变绿而改测试）。
   🔴 正确顺序是**先修编号、再加门禁**，让门禁因"编号干净"而绿，而不是因"欠账全豁免"而绿。
2. **没有自己重排编号**。任何可行的重排都必然同时改 `AGENTS.md`：
   把 traps 序列二改成 `86–91` 之后，AGENTS 号段表里的 `#77 sed 的 C locale`、`#79 i18n 改完必须 build`
   会**改指到序列一的两条别的规则**；所以"只修 traps、不动 AGENTS"这个省事版本**不存在**。

### 拍板后的修复顺序（甲，推荐）

1. traps 序列二 `77–82` → `86–91`（按行号精确改，六处）。
2. `AGENTS.md` §7 那六条 inline 正文整段搬进 traps 末尾 → `92–97`，AGENTS 只留索引（这才符合它自己写的纪律）。
3. 同步 AGENTS 号段表（"83 条"改成实测条数、`80–83` 段改成新号）与 20 处 `第 N 条`引用。
   ⚠️ 顺序上**先改号、再改引用**，并逐条对着上表核对含义 —— 这一步最容易"改对了号、指错了规则"。
4. 新增 `scripts/check-trap-numbering.mjs` 挂进 `pnpm check`：编号唯一 + 严格递增 +
   每个 `§7 第 N 条`恰好命中一条 + `AGENTS.md` §7 不许出现 inline 正文；
   并用注入验证能红（造一个重复号、造一个孤儿引用、在 AGENTS 里塞一条 inline 正文）。
5. 末段 7 条 `###` 条目补号 `98–104`。

（乙，低成本但没修根）只把 20 处引用改成"traps 文件名 + 小节标题"形式，号系统留着不动 ——
好处是引用立刻无歧义，坏处是 §7 的检索键仍然是坏的，且门禁仍然加不了。

**要用户裁决的就一件事**：允不允许本轮（或下一轮）修改 `AGENTS.md` §7 的规则区。
允许 ⇒ 走甲；不允许 ⇒ 走乙或维持现状，但**别加那条会豁免全部现状的门禁**。

---

## 6. 🔴 §4 那两条"环境红"**已实测解除** —— 但顺着它挖出 `capture-window.sh` 的一条**死代码**：`-3811` 重试从来没执行过，取证失败的原因也从来没打印过

> 记录时间：2026-09-30（复跑 `pnpm check` 那一轮）。

### §4 的状态更新（都是实测，不是"看起来应该好了"）

| §4 里记的阻塞 | 现在 |
|---|---|
| **mac**：发起方没有屏幕录制权限 ⇒ 同一进程树里 `screencapture -x` 报 `could not create image from display` | ✅ **权限已给**：`screencapture -x /tmp/probe-screen.png` 在**同一进程树**里产出 **1030125 B** 真图（`Sep 30 20:46`）。🔴 但 mac 段**仍然拿不到窗口图** —— 原因换成了下面那条 `-3811`，**不是同一件事** |
| **windows**：`ssh: connect to host 10.111.127.237 port 22: No route to host` | ✅ **已接回**：`nc -z -G 4 10.111.127.237 22` succeeded，`ssh windows-pc hostname` 返回主机名（不只是端口通，是真的登进去了） |

### 死代码：`set -e` 在应用那一行就把脚本杀了

`pnpm check:macos-window` **exit 0**，输出只有 8 行，跳过消息是
"取图基础设施不可用（ScreenCaptureKit 起不来 / 未授权）"，**里面没有原因**。
原因一直老老实实写在被丢弃的日志里（`/tmp/heyta-mac-capture-run-1.log`）：

```
ScreenCaptureKit 报错：Error Domain=...SCStreamErrorDomain Code=-3811 "音频/视频捕捉失败，无法开始流播放"
截图失败（多半是没给屏幕录制权限）
```

机制在 `apps/desktop-macos/scripts/capture-window.sh`：`:28` 是 `set -euo pipefail`，
`:56-57` 直接执行 HeytaMac，**没有**捕获退出码。应用在取图失败时按设计 `exit(4)` ⇒
`set -e` 当场终止整个脚本，于是三件本该发生的事一件没发生：

| 文件里写的 | 实际 |
|---|---|
| `:58` `sed 's/^/  /' "$RUN_LOG"` —— 把原因打进输出 | **从未执行** ⇒ 证据里没有原因，这正是它文件头"它的输出本身就是证据"想避免的事 |
| `:60-64` 对 `-3811` **重试一次**（`6a16a7e5` 今天专门为"门禁随机红一次"加的） | 🔴 **死代码，永不触发** |
| `:74-76` 打印"🔴 取图基础设施不可用"并 `exit 4` | 没执行。脚本最终的 4 是**应用那个 4 撞上来的巧合** |

🔴 后果不是"少打一行字"：**门禁区分"环境不给"与"真故障"靠的就是那句被吞掉的话**。
应用若以别的码失败（真故障），同样没有任何原因输出，只留 exit 1 给下一个人猜。
复现（不碰仓库代码，只复现 shell 语义）：

```bash
bash /tmp/sete-probe.sh   # ⇒ 只打印"步骤 1"；"步骤 2"那行永远不出现；PROBE_EXIT=4
```

### 顺带证伪了我自己的一条猜测（别照着它改）

我原以为可以让门禁在 exit-4 分支里继续跑那两条**不需要录屏权限**的判据
（WebView `takeSnapshot` 快照 + M2 身份入口探测 —— 门禁 `check-macos-window.mjs:189` 就是这么宣传的）。
**实测不成立**：应用是在取图那一步就 `exit(4)` 的，
`/tmp/heyta-macos-window-gate-*.webview.png` 与 `/tmp/heyta-macos-m2-gate-*.txt` **一个都不存在**
（`ls` 报 no matches）。所以"把稳定判据从跳过里救出来"**需要应用侧配合**，不是门禁单方改得动的。

### 待裁决（两条都落在别人的线上，所以我没动）

1. **`capture-window.sh` 的应用调用要捕获退出码**（`... || capture_status=$?`，随后照原样打印日志 / 判 `-3811` 重试 / 分支）。
   文件在 `apps/desktop-macos/**` —— Goal 边界里点名"别的会话正在改、不碰不提交不还原"的那条线，
   **一行都没改**。
2. **`check-macos-window.mjs` 在拿不到窗口时 `exit 0`**（`:59-63` 的 `skip()`）与 §7 第 81 条
   "交叉验证链上任何一环取不到都必须**响亮失败**，绝不能静默跳过"**方向相反**。
   但那是该会话自己在 `:40-45` 论证过的取舍（"那不是通过，是如实标注的未覆盖"），
   改成判红等于替他们推翻今天刚写的裁决。**要拍的板是**：环境取不到图时，
   这条门禁应当 🔴 红（逼权限/基础设施就位），还是 ✅ 绿但印一句"没验过"（现状）？
   现状的代价是 `pnpm check` 里**有一条永远不会失败的判据**，而 macOS 壳"窗口画出来了"这句话
   在权限就位前**从来没被验过**。

---

## 7. ✅ Goal 第 4 项的收尾：`pnpm reinstall:all` **23:16–23:32 四端全绿、`REINSTALL_EXIT=0`**

> 记录时间：2026-09-30 23:32。命令 `bash scripts/reinstall-all.sh`（**后台跑**，§6.2 规定二），
> 全量输出 `/tmp/heyta-reinstall3.txt`（42 行；末尾就是那四行 ✅ 与 `REINSTALL_EXIT=0`）。
> **没有 `--skip`、没有 `--only`、没有降级判据**。四张截图**都真的打开看过**。

| 端 | 结论 | 判据行（脚本自己打印的实测值） | 证据（人已看过） |
|---|---|---|---|
| **mac** | ✅ | `✅ 打包完成（.app + .dmg…）` → 公证 `Current status: … Accepted` → `The staple and validate action worked!` → `✅ 已安装到 /Applications/Heyta.app` → `✅ 截图 2124x1508、内容占比 100.0%、主蓝命中 62 —— 是共享 UI` | `/tmp/heyta-reinstall-mac-installed.png`（窗口）+ `…mac-installed.png.webview.png`（共享 UI 快照，门禁判的就是这张）—— 暗色主题真界面：rail、收集箱、勾选框是主蓝 |
| **windows** | ✅ | `✅ 源码包 14M（跟踪 + 未跟踪 + web-dist + bridge-bundle）` → `✅ 远端新鲜度对账通过（web-dist/index.html=4a0761e2c76f7203… bridge=4fad40c990c547f1…）` → 远端 `ADD_APPX=OK` / `PAYLOAD_WEBDIST=True` / `M2D=OK` / `RESULT=OK` / `1152x587 内容 29.3%` | `dist/windows/packaged-first-run.png`（56097 B，23:21）—— 真应用 + 头像菜单开着，第一项「登录 / 注册」、**无**「退出登录」 |
| **android** | ✅ | `✅ release APK 已重打（63M…）` → `✅ 模拟器 emulator-5554 全新安装成功` → `✅ 截图 1080x2400、内容占比 6.8%、主蓝命中 9279 —— 是共享 UI` | `/tmp/heyta-reinstall-android.png` —— 首屏「注册 / 登录」主蓝按钮 |
| **ios** | ✅ | `✅ 已安装进模拟器（全新安装）`（UDID `1B785D80-…ADBC`）→ `✅ 已装的包比源码新 —— 这一轮装的是当前产物` → `✅ 截图 1206x2622、内容占比 6.7%、主蓝命中 9450 —— 是共享 UI` | `/tmp/heyta-reinstall-ios.png` —— 与 android 同一张首屏 |

📌 顺带收了上一条提交里那个 bug 的尾：`✅ 截图证据：…（窗口）+ …（共享 UI）` 这一行
**现在两个路径都能打出来**了（`f175a0ae` 修的是全角括号吞掉 `$VAR` 变量名），
所以这轮的证据不是靠人脑补出来的路径。

### 🔴 §6 那条 `-3811` 死代码：本轮**复核过代码**，结论是"没被修掉"，而 README 写着"已修"

本轮 mac 段真的走到了打包 / 公证 / 安装 / 自截屏，所以下面 20:58 那节里
"没有得到复验机会"那句限定**过期**。复核的是代码而不是行为 —— `-3811` 是**偶发瞬时**错误，
本轮一次都没触发，所以"跑绿了"证明不了它被修：

| 核对点 | 实测（23:4x） |
|---|---|
| `apps/desktop-macos/scripts/capture-window.sh:28` | 仍是 `set -euo pipefail` |
| 同文件 `:93-94`（调 `HeytaMac`） | **仍然没有捕获退出码**（`grep -n 'capture_status'` 无命中） |
| `HeytaMacApp.swift:166-168` | 取图失败仍然 `exit(4)` |

⇒ §6 登记的机制**原样还在**：应用以 4 退出时，`set -e` 先终止脚本，所以
`:91-103` 那段 `-3811` 重试**不会被执行到第二次**、`:95` 那句"把原因打进输出"的 `sed` 同理。
⚠️ 而 `apps/desktop-macos/evidence/README.md:73-76` 已经把它写成 **✅ 已修 + 三条分支注入验证过**。
两句话唯一能同时成立的读法是：**"注入 `-3811` ⇒ exit 4"确实成立**（那个 4 是应用撞上来的巧合，§6 早写过），
所以门禁的**响亮跳过**行为是对的；但**"重试一次"与"打印原因"这两条仍然是死的**。
这条落在 `apps/desktop-macos/**`（Goal 边界点名不碰），**本轮只复核、一行未改**，留给该会话裁决。

### 上一轮（20:58）的原文：结论 3 绿 1 红

> 记录时间：2026-09-30 20:58。命令同上，全量输出 `/tmp/heyta-reinstall2.txt`（52 行）。
> 脚本自身 **`EXIT=1`** ——
> 有端失败就整体判红，没有 `--skip`、没有降级、没有静默跳过（§6.1.1 那条"任一端失败 ⇒ 整体退出 1"是**真的会兑现**的）。
> 🔴 **下面 mac 那行的"见下面的根因"指向的归因，已被本节上面更正**：红的是编译，不是取图权限。

| 端 | 结论 | 判据行（脚本打印的实测值） | 证据 |
|---|---|---|---|
| **mac** | 🔴 **失败** | `🔴 打包失败` → `error: Build failed` | 见下面的根因 |
| **windows** | ✅ | `ADD_APPX=OK` / `PAYLOAD_WEBDIST=True` / `M2D=OK` / `RESULT=OK`；新鲜度对账 `web-dist/index.html=d5de0b1d70d8b1be…`；`1152x587 内容 32.1%` | `dist/windows/packaged-first-run.png`（55861 B，20:54）—— **人已看过**：rail + 收集箱 + 头像菜单第一项「登录 / 注册」、**无**「退出登录」 |
| **android** | ✅ | `release APK 已重打（63M）` + `模拟器 emulator-5554 全新安装成功` | `/tmp/heyta-reinstall-android.png` —— **人已看过**：首屏「注册 / 登录」主蓝按钮 + 「先离线使用」 |
| **ios** | ✅ | `✅ 构建成功` + `✅ 已安装进模拟器（全新安装）` + `✅ 已装的包比源码新 —— 这一轮装的是当前产物` | `/tmp/heyta-reinstall-ios.png`（156577 B，20:58）—— **人已看过**：与 android 同一张首屏 |

### mac 那一条红：既不是环境问题，也不是产品缺陷，是**边界目录里的在途代码**

`reinstall-all.sh` 第 1 段先跑 `swift build`，编译当场红在两个**未跟踪**文件上
（`git status` 显示 `?? apps/desktop-macos/Sources/HeytaMac/ShellAuthSession.swift`、
`?? apps/desktop-macos/Sources/HeytaShellCore/ShellAuth.swift`）：

```
ShellAuthSession.swift:36:73: error: cannot find type 'ASPresentationAnchor' in scope
ShellAuthSession.swift:36:42: error: cannot find type 'ASWebAuthenticationSession' in scope
ShellAuthSession.swift:21:25: error: cannot find 'ShellAuth' in scope
```

前两条的典型成因是缺 `import AuthenticationServices`，第三条是 `HeytaShellCore` 那侧还没接上 ——
**都属于另一个会话正在做的"macOS WKWebView 存储宿主 / 壳内授权"那条线**，
Goal 边界点名"不碰、不提交、不还原"，所以**一行都没改**。

> ⚠️ **下面这条限定已被本节上面的"§6 复核"取代**（写它的时候 mac 还没走到打包，
> 所以只能声明"没复验机会"；23:16 走到之后已按代码复核，结论是**机制原样还在**）：
>
> 🔴 ~~由此得出一条与 §6 有关的重要限定：本轮 mac 段**连打包都没走到**，
> 所以 §6 登记的那条 `-3811` 死代码**没有得到复验机会**，它的状态仍然是"已定位、未修、待裁决"。
> 下一轮不要把"这轮 mac 红的原因是编译错"误读成"§6 那条已经解决了"。~~
>
> 后半句**至今成立**：mac 红因是编译错，从来不构成"§6 那条解决了"的证据。

### 🔴 读这两张表时必须一起读的**两条**限定：装的是**当前工作树**，而且"全新安装"只对视图成立

1. **装的是工作树，不是已推送的 commit。** 20:58 那轮工作树有 400+ 未提交改动；
   23:16 这轮收敛到 **24 处**，仍**不干净**，分属另外两条会话：
   `apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift`（存储宿主那条线）、
   `packages/design-system/**`（token / typography）、`packages/i18n/src/locales/{zh-CN,en}.ts`、
   `packages/ui/src/theme.tsx`、`apps/web/src/{App.tsx,features/inbox/InboxBell.tsx,features/projects/ProjectsPanel.tsx,styles/app.css}`、
   `server/src/design.generated.ts`、`package.json`、`apps/landing/**`（帮助中心那条线）、
   以及未跟踪的 `scripts/check-text-color.mjs`、`docs/plans/help-center-docs-expansion.md`。
   ⇒ 判据"装上的是**当前产物**"成立；"装上的是 `origin/main` 那批已推送代码"**不成立**。
   §6.1.1 的这条收尾**没有**"从干净检出打包"这一环 —— 在多人共用一个工作树的现状下，
   它验的是工作树。这不是本轮的缺陷，但它决定了这两张表能被读成什么。
2. **mac 的"全新安装"只对视图成立，不对数据成立。** 该段清的是
   `/Applications/Heyta.app` + `/tmp/heyta-macos-dist` + `$HOME/Library/WebKit/cloud.finlaw.heyta.desktop`，
   而 `…mac-installed.png.webview.png` 里**仍看得见另一个会话留下的探测任务**
   （`B-mac-shell-storage-1790761707` / `B-mac-shot-1790762056` / `B-mac-final-1790763473`）
   —— 它们落在另一条存储路径上，这次清理没覆盖到。
   ⇒ 那张截图证明的是"**装上的包能起来并渲染共享 UI**"，**不证明**"这是一台空数据的干净安装"。

> 📌 §6 与 §7 写于 2026-09-30 21:01 那次 Bash 工具故障（`spawn EBADF`，连 `pwd` 都起不来）期间，
> **写下时未提交**。接手后先核对它有没有真的落地：`git log --oneline -- BLOCKED.md | head -3`。

---

## 8. 🔴 `origin/main` **自己是红的**：`check` 的 `&&` 链一次只暴露第一个红，实测断点之后共有 3 处

> ⚠️ **这个标题的两半在 22:29 都过期了，但原文保留**：①「`origin/main` 自己是红的」在
> `check:l4`/`check:design` 这一批上**已不成立**（`bfbff487` 已提交并推送，见下面「第三次纠正」），
> 现在整条链的红只剩第 20 段 `check:macos-window` 那一个位置、且是**本机状态**造成的；
> ②「断点之后共有 3 处」是 13:37 从**当时的第 11 段**往后数出来的，断点现在移到了**第 20 段**，
> 其后 25 段本轮**一次都没跑** —— 数字不能跨断点继承。
> 留原文是为了让下一轮看清**结论的保质期**：它不是"错了"，它是"曾经对、现在要重测"。

记录时间：21:05 初稿 → 21:08 第一次纠正 → **21:15 第二次纠正（本轮实测）**。
证据：`/tmp/heyta-check-run.txt:619-652`（`$ node scripts/check-l4-no-style.mjs` 那段，末尾 `:651` 是
`[ELIFECYCLE] Command failed with exit code 1.`）；断点之后的门禁由本轮**单独跑**测得（见下表）。

> 🔴 **第一次纠正（21:08）**：我最初把这里写成"`pnpm check` 现在只剩一处红"。
> **那句是错的，而且错在一个会反复出现的形状上。**
> `check` 是 `package.json:43` 里的一条 **`&&` 链**，`check:l4` 排在**中间**（实测：整条链
> 按 `' && '` 切是 **46 段**（22:41 更正：原写 45 是**分隔符**个数，off-by-one），`check:l4` 是**第 11 段**），
> 链在它这里就断了 ⇒ 它**之后的 35 段本轮一次都没执行**（原写 34，同上）。
> 正确的说法是「**只测到第一处红**」，不是「只剩一处红」——
> 前者是测量结果，后者是我从测量结果里**多读出来的**，而它恰好是最容易被当成结论转述的那半句。
>
> 🔴 **第二次纠正（21:15）**：我随后又写成"它拦的是**别人的在途代码**"。
> **那句也是错的。** `git show HEAD:apps/web/src/features/auth/desktop-handoff.ts` 里
> 那 7 个裸值**一条不少**（HEAD 的 `:90/:91/:97`，与工作树同一批，只是行号被别人的 +16/−8
> 挪到了 `:97/:98/:104`）。引入它的是**已推送的** `5d65d120`。
> ⇒ **干净检出 `origin/main` 跑 `pnpm check` 就是红的。** 这不是"门禁在拦在途工作"，
> 是**仓库的基线本身没绿**，而 `&&` 链让这件事看起来像"只有一个小问题"。
>
> （我 21:05 那次 `git status` 读到的是 `??`，21:15 已经是 ` M` —— 那条线**在这轮中间把它提交了**。
> 所以"归属"这类判断**必须带时间戳**，它是会过期的观测，不是事实。）
>
> 🔴 **第三次纠正（22:29，本轮）**：上面那句加粗的「**干净检出 `origin/main` 跑 `pnpm check` 就是红的**」
> **在它写下的时刻是对的，现在它自己成了那条"必须带时间戳"的观测的受害者。** 那条线把 token 化
> **提交了并推送了**：`bfbff487`「fix(design): 桌面回跳浮条改用设计 token…」（22:00:52），
> `git merge-base --is-ancestor bfbff487 origin/main` → **0**，而且 `origin/main` 与 `HEAD` 里
> 这个文件的 **blob 哈希逐字节相同**（`4fd4ced8ce38…`）。对 `origin/main` 的内容再 grep 那 6 个值：
> **只剩 `:97` 一句注释里的 `#111827`**（注释文本不是判据对象，两道门禁都不抓它）。
> ⇒ **`check:l4` / `check:design` 对干净检出的 `origin/main` 现在也是绿的**
> （22:26 各单独跑一次：`✅ 没有样式字面量、没有自定义 CSS 变量（扫描 103 个文件）`、
> `✅ 无硬编码设计变量`（307 个源文件），均 exit 0）。
> ⚠️ **但这不等于 `pnpm check` 绿** —— 链断在**第 20 段** `check:macos-window`（见下面 22:02 那节），
> 而它红的原因是**本机登录态**，不是代码。
> 这次更正的实际作用是**把结论收窄**：「仓库的基线本身没绿」现在只对第 20 段成立，
> 而第 20 段那一红**在一台没有活的壳会话的机器上不会复现** —— 它比原来那条更接近"门禁自己的问题"。
> 📌 顺手记一条方法：**「工作树里已经改了」和「基线已经绿了」是两个命题**。前者 21:15 就成立，
> 后者要等 22:00 那次提交。能把它们分开的只有 `git show <ref>:<file>`，`git status` 分不开。
>
> ⚠️ 顺带一句关于 `PROGRESS.md`「任务 0 基线」表里 `pnpm check` 那一行：那里曾写着"现在整条链只剩
> `check:macos-window` 红"。那句话**在它写下的那一轮可以是真的**，但它**不可能由本轮的运行支持**
> —— 21:05 那一轮连 `check:macos-window` 都没跑到。本轮（21:15 的单独运行）已把它补测成**已知状态**。
> 这也是 §7 元规则 1（先怀疑探针）的一种面目：**探针没跑到的地方，输出上长得像"没问题"**。

**21:15 首测 → 13:37 复测（各门禁单独跑，绕开 `&&` 链）**。⚠️ 这一轮**HEAD 动了两次**
（`da0b411e` → `c7277cef`，都是那条 macOS 壳线的），结论必须以"右列"为准：

| 门禁 | 21:15 | 13:37 | 说明 |
|---|---|---|---|
| `check:l4` | 🔴 1 处 | 🟢 **但只在带未提交改动的工作树里** | ~~`git show HEAD:…desktop-handoff.ts` **仍然有那 7 个值**（HEAD `:97/:98/:104`）。那个会话**正在把它们改成 token，还没提交**。⇒ **干净检出 `origin/main` 照旧红。**~~ 🔴 **22:29 更正：这一格整段过期。** `bfbff487`（22:00:52）已把 token 化**提交并推送**，`origin/main` 的 blob 与工作树相同 ⇒ **干净检出也是 🟢**（见上面「第三次纠正」）。 |
| `check:design` | 🔴 1 处 | 🟢 同上 | 与 `check:l4` 是**同一笔债在两处计息**，不是两个问题。⇒ 22:29 同样转绿（`✅ 无硬编码设计变量`，307 个源文件，exit 0）。 |
| `check:journey-coverage` | 🔴 2 failed (28) | 🟢 28 passed, exit 0, 7.98s | 已在他们这轮的提交里转绿（`pending-login.spec.ts` 现在干净）。**不是本轮改的。** |
| `check:macos-shell` | 未测 | 🟢 **18/18** | 含 `ready` 握手 clientId 相等、Swift 独立读 SQLite、state/scheme 拒绝。 |
| **`check:macos-window`** | 未测 | 🔴 **exit 1** | **环境/工具链原因，不是产品**：构建 ✅、截图 ✅（`2240x1440`、contentRatio 100.0%、colorSpan 245）、交叉验证 ✅，然后 `check-macos-window.mjs:87` 那个 10 分钟 `spawnSync` 超时在阶段 ⑤（M2 壳内身份探针）炸：`❌ 取证脚本没能启动：spawnSync bash ETIMEDOUT`；前面还有 `首屏始终没起来，按兜底截一张`。无 `HeytaMac` 僵尸残留。 ⚠️ **这一行只是 13:37 的原因，已不是现在的原因** —— 22:02 那一轮**没有超时**、走到了阶段 ⑤、取证链全绿，红在 M2 的 `已登录`。见下面「22:02 第三次测」。**同一个门禁号，同一轮之内换了两次原因。** |
| `check:docs` / `ui-language` / `licenses` / `pricing` / `ai-quota` | 🟢 exit 0 | （未复测） | 21:15 测得。 |

> 🔴 **所以"`check:macos-window` 仍红"这件事，兜兜转转又成立了** —— 而它和 `PROGRESS.md`
> 「任务 0 基线」那一轮写的**不是同一个原因**：那时它红在产品，现在它红在**取证脚本自己超时**。
> 这正说明为什么"某门禁红"这种结论**不能跨轮继承**：门禁号不变，红的原因每轮都可能换。
> ⚠️ 归属：这条**属于那条 macOS 壳线正在改的面**（`c7277cef` 的标题就是"壳侧反向授权端到端走通"），
> 本轮**不去修它** —— 见 §7 mac 段那两个编译失败的 Swift 文件同批的说明。

Goal 第 1、2、3 项已提交并推送（各自的验证是**单独跑**的，不依赖这条链：
`docs-link-check` 随时可用 `node research/tools/docs-link-check.mjs` 复现 exit 0 并打印两条豁免
—— 原来这里指向 `/tmp/dl.txt`，那是个易失路径，已改成给命令本身；
`motivation.spec.ts` 与 i18n 探针各做过变异验证），
第 4 项已实跑（§7）。所以下面这处红是**链上第一个**拦住的，不是唯一的。

```
断言 A/B：L4 视图不许有样式字面量与自定义 CSS 变量
🔴 7 处：
   apps/web/src/features/auth/desktop-handoff.ts:90  [px 长度字面量]   12px
   apps/web/src/features/auth/desktop-handoff.ts:90  [px 长度字面量]   16px
   apps/web/src/features/auth/desktop-handoff.ts:91  [颜色字面量]      #111827
   apps/web/src/features/auth/desktop-handoff.ts:91  [颜色字面量]      #f9fafb
   apps/web/src/features/auth/desktop-handoff.ts:91  [px 长度字面量]   14px
   apps/web/src/features/auth/desktop-handoff.ts:91  [z-index 字面量]  z-index:2147483647
   apps/web/src/features/auth/desktop-handoff.ts:97  [颜色字面量]      #93c5fd
```

⚠️ **这 7 行的行号属于 21:05 那个工作树 = `HEAD`（`5d65d120`）**。那个会话随后在这个文件上叠了
+16/−8，**当前工作树里它们在 `:97/:98/:104`**。按行号跳过去会跳错 —— 用值本身搜
（`2147483647` 是全仓唯一的好锚点）。

**它拦的是什么**：`handOffToShell()` 往 `document.body` 上挂的那个**可见兜底链接**
（自动跳自定义 scheme 被浏览器拒绝时的出口）。代码里的注释解释了为什么用内联样式：
"这一层要在**任何**主题/布局下都能显示，而它挂载的时刻应用可能正处于任意状态（登录成功那一瞬）"。
意图能理解，但 **§5 的规则不看意图**：裸 hex / px / ms / z-index 一律走 token。

**门禁自己给的修法（原文照抄，别改写也别放宽）**：

> 修法：用 `cssVar('color.…')`（web）或 `tokens['color.…']`（RN）。缺哪个 token 就先往 `tokens.css` 加。
> ⇒ L4 的职责是"查询 + 组合"，不是"定样式"（`dida-view-unification.md` §4.1）。
> 这个值该搬到 L1/L2：`packages/ui` 的 primitives/patterns（web 与 RN 共用）或 app 自己的 ui kit。
> **不要把判据放宽** —— 窄是刻意的（见文件头）。

两条给修它的人的观察：内联样式字符串里放 `var(--ht-…)` 是合法的，所以"手挂 DOM、不进 React 树"
**不妨碍**用 `cssVar()`；真正需要判断的是 `z-index:2147483647` 这种"永远压在最上面"的语义
**该不该有一个 token**（`--ht-z-max`？），以及这个浮层本身是不是该下沉成 L1/L2 的一个 primitive。

### 本轮为什么一行都没改

1. ~~**它是 Goal 边界点名的那条线**：文件未跟踪，与"macOS WKWebView 存储宿主"那批在途工作同批。~~
   🔴 **这条理由已在 21:15 被自己的证据推翻**（见本节开头第二次纠正：`git show HEAD:` 里那 7 个值
   一条不少，`5d65d120` 已推送）。留着它是为了让下一轮看清**它是怎样被推翻的**：
   一条"归属"判断被写成理由时，它的有效性取决于观测时间，而不取决于措辞。
   **所以推翻后不要把它换成"那就不修了"** —— 它是仓库级欠债，只是**本轮仍然没修**，
   理由换成下面两条更弱的：

   1a. **那个会话此刻正握着这个文件**（` M`，+16/−8 未提交）。我改同一处 = 制造冲突或把他们的
   在途改动扫进我的提交（Goal 边界明令禁止后者）。
   1b. **修法大概率要新增 token**（`--ht-z-max` 之类），而 `tokens.css` 一改就会连带
   三端生成器、`check:tokens`、`server/src/design.generated.ts`、`check:server-design`。
   本轮 Bash/Grep/Glob 持续 `spawn EBADF`（见 §7 那条限定），**这串连带判据一条都验不了**。
2. ~~**Bash 跑不了，所以"改完没验"**。~~ **这条单独不成立，别拿它当理由**：
   本轮 21:15 那批门禁实测，是通过**起一个子代理跑一条批量命令**拿到的 ——
   主进程 `spawn EBADF` 不影响子代理的 shell（已两次复现）。
   所以"跑不了 `check:l4`"从来不是挡箭牌；真正拦住的是 **1a（有人在写）** 和
   **1b（连带判据面太大）**。把工具故障写成理由，会掩盖"其实是可以做的，只是不该我做"。

### 顺带：断言 C 在催一件事，本轮**刻意没做**

```
✅ apps/web/src/features（L4 视图）：内联样式 89 处 ≤ 基线 104（已降 15 处）。 ⬇️ 建议下调到 89
✅ apps/mobile/src/screens（L4 视图）：内联样式 72 处 ≤ 基线 90（已降 18 处）。 ⬇️ 建议下调到 72
```

脚本自己给的理由成立："基线不跟着降就会变成永久豁免，'只减不增'就只剩前半句"。
但 **89 和 72 是对着当前工作树数的**，而这两个目录正被别的会话改（§7 那条限定）。
**把基线钉成别人的中途快照**，会让那个会话在下一轮无缘无故变红。
等它们没人动时再下调，下调后跑一次注入（加一处 `style={{…}}`）确认它真的会红。

### 接手后按这个顺序做

> ⚠️ 原先这里写的是"先跑 `git status --porcelain` 判归属"。**那条已经做完了**（21:15：已跟踪、
> 已随 `5d65d120` 推送）。下面直接是动作。**再核对一次没有坏处 —— 但要带时间戳记录结论。**

1. **确认那个会话是否已把 token 化提交**：`git status --porcelain -- apps/web/src/features/auth/desktop-handoff.ts`。
   13:37 实测：` M`（24 加 / 5 删），**HEAD 里那 7 个值一条不少**。
   ⇒ 若他们先落了，本节的 2 就自动关闭；**若没落，这就是干净检出的红，谁先碰谁修**。
2. **修那 7 个值**（`check:l4` 与 `check:design` 会**一起**转绿，它们是同一笔债）。
   🔴 **改动范围只许碰样式**：这个文件实现的是 **ADR-0039 §2.3「桌面壳的反向授权回跳」**，
   里面 `DESKTOP_CALLBACK_SCHEME = 'heyta'` 的注释明写着"这是壳**第一次**对外承诺一个 URL scheme ——
   改动它是破坏性变更"。⇒ 那个 `heyta://auth#token=…&state=…` 的**语义一个字节都不能动**，
   兜底链接的 `data-testid="desktop-handoff-link"` 是别人验收的断言钩子，也**不许顺手改**。
   缺 token 就先往 `tokens.css` + `TOKEN_GROUPS` 加，然后按顺序跑
   `pnpm check:tokens && pnpm check:design && pnpm check:l4 && pnpm check:server-design`
   （生成物链路：`tokens.css` → 三端生成器 → `server/src/design.generated.ts`）。
3. ~~判 `pending-login.spec.ts` 那两条红~~ **13:37 已关**：`check:journey-coverage` exit 0（28 passed），
   在他们这轮的提交里转绿了。**别再去"修"一个已经绿的东西** —— 这条留着是为了记下它曾经红过、
   以及它是**被谁**关掉的（不是我）。
4. ~~补 `check:macos-window` / `check:macos-shell`~~ **已测**（见上表）：`macos-shell` 🟢 18/18，
   `macos-window` 🔴 exit 1。⇒ 下一步**不是"测"**，是判那个 `spawnSync bash ETIMEDOUT`
   （`check-macos-window.mjs:87` 的 10 分钟上限，阶段 ⑤ M2 壳内身份探针）
   到底是**探针够不着**还是**壳真起不来** —— 前面那句 `首屏始终没起来，按兜底截一张`
   指向前者需要排查，而 §7 第 81 条的三个静默坑同属这条链。**归 macOS 壳线，本轮不动。**
   🔴 **22:02 更正：这一条的问题定义已经过期。** 那一轮**没有** ETIMEDOUT，取证链
   （`CAPTURE_METHOD=screencapturekit` / `CROSSCHECK=ok(2240x1440)` / content 0.049）全绿，
   红只在 M2 那句 `已登录`。⇒ 要排查的不再是"探针够不着"，而是**"门禁的判据不该取决于
   这台机器上有没有人登录过"**，而我试的那条逃生门（`HEYTA_WEBKIT_EPHEMERAL=1`）**已被 A/B 证伪**
   （见上面「那条逃生门现在不管用了」）。归属仍是 macOS 壳线。
5. **下调断言 C 的基线**（见上面那节），前提是先确认那两个目录没人正在改。

**每一步都要跑注入验证**（加一处裸值 ⇒ 确认 `check:l4` 红），否则这条改动仍然只是"看起来绿了"。

**不要再靠"再跑一次整条 `pnpm check`"来想知道后面还有什么红** —— 它会在同一个位置再断一次，
而它会给你一份**看起来很短**的清单。要么像本轮这样逐个跑，要么把 `&&` 链换成"跑完全部再汇总"
（后者是门禁自身的缺陷，见下面最后一条）。

> 📌 **给门禁维护者的一条结构性观察**（本轮不修，只登记）：`check` 是一条 `&&` 链
> （`package.json:43`，实测 **46 段**），结构上决定了**一次运行永远只暴露第一个红**。
> ⚠️ **本节初稿此处写的是 45，那是个 off-by-one**：45 是 ` && ` **分隔符**的个数，
> N 段只有 N−1 个分隔符 ⇒ **46 段**。22:41 用 `s.split(' && ').length` 复算，同时确认
> `check:macos-window` **确实是第 20 段**（那个号没错）。**错的那个号已经流进 `PROGRESS.md`**，
> 两处一起改。
> 这本身是有意的（早发现早停、省时间），但它有一个副作用值得记住：
> **"我修好了 A，现在 check 该绿了"这个预期在这条链上系统性不成立** ——
> 修掉一个只会让**下一个**现形。§7 第 82 条那个"四轮全绿"是同一族问题的反面
> （判据太松 ⇒ 全绿），这里是判据太严 + 链条太短视（一次只看一个）。
> 所以转述 `pnpm check` 的结果时，必须带一句"链断在 X，X 之后未测"。
>

### 🔴 22:02 第三次测：断点从第 11 段**移到了第 20 段**，而 `check:macos-window` 的红在**同一轮内**换了原因

记录时间：整链 21:55–22:02（`/tmp/heyta-check-full.log`，59468 B，子代理跑，捕获的是进程真实退出码）；
A/B 是 22:14–22:20。

整条 `pnpm check` 现在断在 **第 20 段 `check:macos-window`** ⇒ **第 1–19 段本轮全过**
（含 `check:l4` / `check:design` —— 那条线的 token 化改动**在这一轮的工作树里落地了**），
而 **第 21–46 段照旧一次都没执行**（号数以 22:41 更正后的 46 段为准；那一段**已在下面「22:41 把第 22 段之后跑完了一遍」里补测**）。
上一节那句"链断在 X，X 之后未测"本轮又用了一次，
只不过 X 换了：**断点不是仓库的属性，是上一次运行的属性**。

`check:macos-window` 这次红的**不是** 13:37 那个 `spawnSync bash ETIMEDOUT`。逐字：

```
✅ CAPTURE_METHOD=screencapturekit   CROSSCHECK=ok(2240x1440)   contentOnModalRatio 0.049
✅ 壳里的共享 UI 真的渲染出来了
   🔴 缺：冷启动第一屏的身份入口（头像） / 未登录时头像菜单的 IA（第一项=登录/注册、无退出登录） / 设置里的滴答导入入口
      探测结论：M2-macOS ✅ **已登录**（退出登录 1 个、登录入口 0 个；设置项 1 个）
```

⇒ 像素/空白/交叉验证**全绿**，只有 M2 那条身份判据红，而它红是因为**壳处于已登录态**，
不是产品坏了。`:523-525` 那条"门禁号不变、红的原因每轮都可能换"的规律，本轮是它的**第二个实例，
且发生在同一轮之内**（13:37 → 21:55）。

### 那条逃生门现在不管用了：`HEYTA_WEBKIT_EPHEMERAL=1` 的 A/B（结论：**不加**）

`HeytaMacApp.swift:403-417` 的注释说这个开关就是为这道门禁造的（"同一台机器上只要有人真的登录过一次，
门禁就会失败"）。而 `check-macos-window.mjs:88-92` 和 `apps/desktop-macos/scripts/capture-window.sh:56,106`
**两个调用点都没设它**。于是做了 A/B。**假设被证伪**，所以本轮**不给门禁的 env 块加这一行**。

| 跑 | 设了什么 | exit | 结果 |
|---|---|---|---|
| 对照 | 不设 | **1** | 只有 M2 红（就是上面那段 `已登录`）；取证链全绿 |
| 甲 | `HEYTA_WEBKIT_EPHEMERAL=1` | **0** | ⚠️ **这个 0 不是通过** —— `capture-window.sh` 返回 `exit 4`（屏幕录制权限/SCK 临时不可用），门禁走的是**跳过分支**，`grep M2-macOS` **零命中**，M2 根本没被评 |
| 乙 | 同上，取证链正常 | **1** | **红在两处**（比对照更糟）：`contentOnModalRatio 0.008 < 0.02`「壳里画的不是真应用」+ M2 探测 12 次全失败 `{identity:0, handler:"undefined", scripts:1}` |
| 丙 | 同上 | — | **无效** —— 被并发会话的 `pkill -f "Products/Debug/HeytaMac"` SIGTERM（PID 49358，22:19:04 起，同一台机器同一个工作树在跑同一个实验） |

**机制（代码 + 磁盘两边都对上）**：`ShellStorageHost.swift:71` 只有显式 `HEYTA_SHELL_STORAGE=0` 才关
⇒ **存储宿主默认 ON**；`~/Library/Application Support/heyta/heyta.sqlite` 73728 B，配 `-wal` 123632 B
（18:17）与 `-shm`（22:03）**都是活的**。会话早已**不在 WebView 存储里**，
`.nonPersistent()` 擦不到它；而它把页面自己的启动也弄断了
（`handler:"undefined"` = 页面侧够不到 `heytaStorage` 这条 WKScriptMessageHandler）。

⇒ **`HeytaMacApp.swift:403-417` 那段注释的前提已经过期**：它假设"登录态在 WebView 存储里"，
而默认 ON 的壳侧存储宿主推翻了这个假设。**代价大于收益**：擦了不该擦的、还让 app 起不来。
**归 macOS 壳线**（Goal 边界明令不碰 `apps/desktop-macos/**`），本轮只登记。

### 顺带登记一个新死角：这道门禁的**跳过分支返回 0**

`exit 4` → 打印「⚠️ …已跳过 … 这一条**没有被验过**」→ **`process.exit(0)`**
（`check-macos-window.mjs:59-63` 与 `:100-104`）。也就是说 **`pnpm check` 可以全绿，
而这一条从未执行**。这跟 §7 第 81 条"静默跳过等于装饰"同族，区别是这里**不静默** ——
它响亮地说出来了，**但退出码不响应它自己的那句话**。
"输出里印着警告"不等于"退出码表达了警告"，这和 §7 第 82 条那句
"人眼复核四个字印在输出里不等于人看过"是**同一个形状**。

本轮**没改它**，因为改它需要一个裁决：**非 mac 平台上跳过是对的**（`check:macos-shell` 那批
"非本机平台响亮跳过"是刻意的），所以不能一律判红 —— 得区分"平台不适用"与"本机本该能验而工具链不可用"。
**这条等门禁维护者/用户拍。**

⚠️ **方法教训（记进 §7 元规则一的另一副面目）**：A/B 甲那次 `exit 0` 如果直接当成"假设成立"就写进代码，
就是**把跳过读成通过**。要判"设了开关之后到底有没有走到 M2"，唯一可靠的方法是
**grep 那三行判据文本存不存在**，不是看退出码。另：这类实验必须**串行**、
且每次 `pgrep -f HeytaMac` 确认没有别的会话在 `pkill` —— 本轮丙就是被人当旧实例杀掉的。

### 🔴 22:36 再更正三条：本节上面关于 `check:macos-window` 的写法有三处说过头了

我把它当成"本轮测完就可以登记"的一条来写，但读完 macOS 壳线在途的证据后，**我自己的表述要收窄**：

1. **"A/B 证伪"只对「单设」那一半成立。** 完整修法要**两个 env 同时给**：非持久 WebView 仓
   **+ 显式指桥**。我只跑了前者，所以我的结论准确范围是**"只给 `HEYTA_WEBKIT_EPHEMERAL=1` 不够"**，
   不是"这条路线不成立"。四格矩阵在另一条会话的证据里：
   `apps/desktop-macos/evidence/storage-host/README.md`。
   ⇒ 本节上面那句「假设被证伪，所以本轮不给门禁加这一行」**动作是对的、结论下多了**；
   不加的理由现在有两个：单设不够，而且**那个 env 块正被另一条会话改**
   （22:32 实测 `scripts/check-macos-window.mjs` 是 ` M`）—— 我改它就是在他们的 diff 上叠一层。

   ✅ **22:38 补：另一半组合已经被测过了，而且是绿的。** ⚠️ **这条不是我测的** ——
   我这边没有跑过两 env 同给那一臂，也不该跑（`capture-window.sh` 启动即 `pkill` 旧 `HeytaMac`，
   并发跑会让对方正在写的取证互相作废）。下面是 macOS 壳线那条会话的记录，逐字转述并注明出处：
   独立跑 `pnpm check:macos-window` **exit 0**，`AUTH_STATE=signed-out`、M2 三条判据全 ✅、
   `contentOnModalRatio 0.072`、`STORAGE=shell` + `STORAGE_HOST=on`
   （⇒ **确实走的是产品那条壳内 SQLite，不是页侧兜底** —— 正是我上面第 3 条要补读的那一行）。
   ⇒ **所以 Goal 那条"`pnpm check` exit 0"现在卡在的是一笔未提交的改动，不是未知的代码状态**：
   修法有效、已验证、只差他们提交。**我本轮不替他们提交、不碰那两个文件。**
   ✅ **22:55 该等待已解除**：那笔改动随后被提交（`check-macos-window.mjs` 在 `07338fe9`），
   而第 20 段**在整链里跑绿**（见下面「22:55 串行重跑整链」，含 `STORAGE=shell` 的产品路径证据）。
   这句话留在这里是因为它当时**是真瓶颈**，而"催别人提交"这个动作现在**不需要做了**。

2. 🔴 **这一段根本不能"跳着段单跑"**，而我本轮**所有单独跑它的记录都违反了这个前提**。
   `bridge-bundle/native-bridge.js` 是 **gitignored 产物**，由**前一段** `check:macos-shell` 重新生成
   ⇒ 单独 `node scripts/check-macos-window.mjs` 用的是**上一次跑 `macos-shell` 留下的旧桥**
   （或没有桥）。这直接解释了甲/乙那次的 `handler:"undefined"`：
   它可能**不是** `.nonPersistent()` 造成的，而是**桥不在**。
   ⇒ **本节那张 A/B 表的证据等级要降一级**：它能证"只给一个 env 没让它变绿"，
   证不了"两个都给会怎样"，也证不了那个 `contentOnModalRatio 0.008` 是 env 还是缺桥导致的。

3. **我写了"取证链全绿"，但我没读过 `STORAGE=` 那一行。** 桥缺失时存储宿主会**静默退化 `.off`**，
   界面**照样画得出来** —— 于是那份证据走的是**页侧兜底**（`STORAGE=sqlite`）而**不是产品路径**
   （`STORAGE=shell` 壳内 SQLite）。裸 SwiftPM 可执行文件旁边没有桥、打包的 `Heyta.app` 里有
   ⇒ **只有裸可执行文件那条取证需要显式指桥**。
   ⇒ 判"这次取证是不是产品路径"要看 `STORAGE=` 那一行，**不是看"图出来了没有"**。
   我上面那些"取证链全绿"只核了 `CAPTURE_METHOD` / `CROSSCHECK` / `contentOnModalRatio`，
   **没有核 `STORAGE=`** ⇒ 那句话现在只能读成"像素层面全绿"，不能读成"产品路径已验证"。

📌 三条是同一个形状的三个面：**这道门禁的输出里，"绿"的每一层都要问一句它核的是哪一行**
（`exit 0` 可能是跳过、`图出来了` 可能是兜底、`跑到 M2 了` 可能用的是旧桥）。
下一轮跑它之前：先跑 `check:macos-shell`，再跑 `check:macos-window`，然后**同时核
`STORAGE=` 和那三行 M2 判据文本**，缺一不结论。

🔴 **22:55 更正：上面这句"grep `STORAGE=`"按字面执行不了**，我写它时没查那行落在哪。
实测：`STORAGE=` 与 `M2_MACOS_NOTE=` 都写在 **`<tmpdir>/heyta-macos-m2-gate-<pid>.txt`**
（`scripts/check-macos-window.mjs:75` 的 `NOTE`，经 `HEYTA_M2_EVIDENCE` 传给壳，
文件名刻意**不能**等于截屏那份 `OUT`，否则被 `OUT.txt` 覆盖 —— 该行注释记了这个坑），
而 `check:macos-window` 的 stdout 与 `<tmpdir>/heyta-macos-window-gate-<pid>.txt`
**只有一层窗口取证**（实测那份里只有 `WINDOW_SIZE` / `WINDOW_TITLE` / `PNG_BYTES` /
`CAPTURE_METHOD` / `CROSSCHECK` 五个键，**没有 `STORAGE`**）。
⇒ 可执行的判据是：**跑完后读 `heyta-macos-m2-gate-<pid>.txt`**，
在**链日志之外**的那份文件里核 `STORAGE=shell`（产品路径）而不是 `STORAGE=sqlite`（页侧兜底）。
📌 这是元规则一的又一面：**"我规定要核这一行"不等于"我知道这一行在哪"** ——
一条无法执行的验证指令，比没有指令更让人安心，也更容易被下一轮直接跳过。

### 22:41 把第 20 段**之后**跑完了一遍：一个红自己好了，另一个红在**已提交的代码**里（已修）

记录时间：22:41–22:43。串行、只读、每段**直接取进程退出码**（不接管道，避开 §7 第 45 条）；
HEAD 起止都是 `f2d5a078` 没动 ⇒ 这 21 个数对这一枚提交有效。

**为什么值得单独跑这一遍**：§8 前面每一轮都只得到"断在第 X 段，X 之后未测"。Goal 要的是
"把它挡不住的死角变成能失败的状态"——而**没跑过的那 25 段才是最大的死角**，比任何一处红都大。

测得 21 段：**19 绿 / 2 红**。绿的里值得点名的三个：
`check:windows-shell`（第 23 段）**不是跳过** —— `Heyta.Windows.Core` 在 darwin 上真跑了，
含"C# 独立读壳的 .sqlite"；`check:linux-shell`（第 24 段）是**响亮跳过并返回 0**（GTK4 装不到 mac，符合预期）；
`check:docs`（第 25 段）的输出顺带证明了 Goal 第 3 项的改动**在真跑**：
「本机有、仓库里没有」已登记 **2 条豁免**、干净检出上缺席放行 0 条。

🔴 **红 1：`check:docs` —— 复跑就绿了，所以我没改任何东西。**
22:41 逐字：`apps/desktop-macos/README.md:4 -> evidence/window-first-run.png` 死链。
22:42 复跑 **exit 0**。原因：那个 PNG 此刻是 ` M` —— **并发取证会话正在重写它**，
门禁读到的是"文件不在"的那一瞬。
⇒ 正确动作是**复测**，不是修：按 22:41 那份输出去"修 README 的链接"会把一条好链接改坏。
这是 §7 元规则一（先怀疑探针）的**新面目**：**探针没错、被测对象在动。**
⚠️ 同时登记它的边界：`evidence/*.png` 是门禁的输入，取证会话重写它期间 `check:docs` 会短暂红
⇒ **并发会话活跃时跑整链，红不必然属于你。**

🔴 **红 2：`check:shell-unicode`（第 42 段）—— 在已提交代码里的真缺陷，已修。**
`git status` 里 `scripts/reinstall-all.sh` **干净** ⇒ 不是我碰谁的文件，是在 `f4e42f68`（另一条会话本轮提交，
22:41 时**还没推**）。逐字：`:184  echo "  截图证据：$MAC_SELFIE（窗口）+ $MAC_SELFIE_WV（共享 UI）"`。

为什么写它的人看不见自己的 bug（同一台机器的 A/B）：

| 环境 | 那一行打印出来 |
|---|---|
| 本机默认（UTF-8） | `截图证据：窗口）+ 共享 UI）` —— **两个路径整个没了** |
| `LC_ALL=C` | `截图证据：/tmp/heyta-reinstall-mac-installed.png（窗口）+ …webview.png（共享 UI）` 正常 |

⇒ C locale 下跑一次就"看起来没问题"，而**退出码不受影响**（`RESULT_mac=OK` 照打）——
所以重装流程一路报绿，**只有那条指向截图的指针被吃掉了**。
这正是这条门禁存在的理由，也是它**第一次在一枚真实提交上抓到东西**。

**修法 = 门禁自己给的那一种**：`$var` → `${var}`（会展开处两者等价，只是不再被全角括号吞名）。
`pnpm check:shell-unicode` 由红转 **exit 0**（扫了 61 个 `.sh`），`bash -n` 通过。
变异方向已验：把两个 `${}` 改回裸 `$var` 就是 22:41 那份红。
⚠️ 归属说明：这是**别人本轮提交的行**，但它不在 Goal 的边界清单里（边界只圈 `apps/desktop-macos/**` 与 `BLOCKED.md`），
且文件当时**没有在途 diff** ⇒ 修它不会叠到别人的改动上。
📌 它是 §7 第 64 条那个形状的**同日复发**：那条陷阱记的正是"`$var` 紧跟全角字符"，
而这次栽的是**当天新写的重装脚本**。有门禁 ≠ 人会记得 —— 这条门禁是唯一让它复不上的东西。

**没测的 5 段（不要读成"它们不红"）**：`check:journey-coverage`(21)、`check:ai-e2e`(40)、
`check:landing-e2e`(41)、`screenshot:verify`(45)、`pnpm -r test`(46) —— 这五段都会**起浏览器或清
`e2e/test-results/`**，而并发会话正在同一个工作树取证（那个目录是**共用**的，一跑就会删掉对方已提交结论的唯一证据）；
`check:macos-window`(20) 本身也没跑——它是已知断点，且跑它会 `pkill` 掉对方的取证进程。

⇒ **Goal 那条"`pnpm check` exit 0"的准确状态现在是这样**：第 20 段等 macOS 线把他们已验证的 env 块提交；
第 42 段本轮修掉；第 22–44 段实测全绿；**还有 5 段未知**。
整链还跑不出 0，但**"未知"从 25 段缩到 5 段** —— 而"未知变小"才是这条 Goal 真正买到的东西。

> 🔴 **上面这两行在 22:55 就过期了**，留原文是为了让人看清它当时错在哪半句：
> 第 20 段的 env 块**已经提交**（`07338fe9`）并**在整链里跑绿**；那"未知的 5 段"**全部补测完成**；
> 整链**跑出了 `FULL_CHECK_EXIT=0`**。"未知从 25 段缩到 5 段"这句买到的东西**比它预期的小** ——
> 因为"未知"后来清零了。逐字记录见下面 22:48 / 22:55 两节。

### 22:48 整链第一次跑满 46 段：断在第 40 段 `check:ai-e2e`，57 红

记录时间：22:48–22:52。`pnpm check` **`FULL_CHECK_EXIT=1`**，断点是第 40 段
（`Running 65 tests using 1 worker` ⇒ `57 failed / 2 skipped / 6 passed`）。
**第 1–39 段全过**，包括此前两轮都被当成已知断点的**第 20 段 `check:macos-window`** ——
它在链里绿了，这本身是本轮的新事实。

第一反应应该是"代码坏了"，因为它红得**很多、很整齐**：57 条失败，
`page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4318/` 占绝大多数。
但取证指向**探针侧**，三条硬证据：

| # | 证据 | 出处 |
|---|---|---|
| 1 | **我的运行杀掉了别人的 dev server** | 我的日志：`⚠️  端口 4318 被占用：pid 39558（node）—— 清掉`（`scripts/check-ai-e2e-preflight.mjs:81`，紧接着 `:83` 的 `process.kill(…, 'SIGKILL')`） |
| 2 | **对方脚本收到了这次击杀** | 对方日志末行：`Command was killed with SIGKILL (Forced termination): vite --host 127.0.0.1 --port 4318 --strictPort` |
| 3 | **约 35s 后我自己的 vite 也没了** | 套件跑过半开始 `ERR_CONNECTION_REFUSED`；只有 5 条是真跑过的 |

⇒ **判定：第 40 段的 57 红不属于被测代码**，属于"同一台机器两条会话抢同一个写死端口"。
⚠️ **诚实的缺口**：**谁在 22:49:4x 杀掉了我的 vite，我没抓到 pid** —— 我只有"它消失了"这一条。
不影响结论（见下：同一份代码、串行重跑就绿），但**这句话不许被转述成"已查明"**。

### ✅ 22:55 串行重跑整链：`FULL_CHECK_EXIT=0` —— Goal 的 exit 0 判据第一次成立

记录时间：22:55:0x–22:59:17。**先确认 4318/4319 空闲**（`lsof -ti tcp:4318 -sTCP:LISTEN` 为空），
再用 `/tmp/heyta-run-check-2255.sh` 把 46 段**一次跑完**，并在链前后各打一次端口与
`pgrep -f 'playwright test'` 快照（防的就是 22:48 那种抢占）。结果：

- **`FULL_CHECK_EXIT=0`**（22:59:17），全链**零条 `✘`**。
- 第 40 段 `check:ai-e2e`：`Running 65 tests using 1 worker` ⇒ **63 passed / 2 skipped**。
  **第 1 项那两条就在里面**：`e2e/tests/motivation.spec.ts` #31–#37 **7 条全 ✓**，
  含「🔴 今日进度卡只在任务视图；其余视图（含两个浮层）都没有」和
  「每个视图都渲染出自己的那块板（白屏检测）」—— Goal 要的"exit 0（含第 1 项那两条）"**同一次运行里同时成立**。
- 第 41 段 `check:landing-e2e`：**6 passed**。
- 第 20 段 `check:macos-window` 在链里绿，且**证据核到了产品路径**：
  `<tmpdir>/heyta-macos-m2-gate-88802.txt` 里 `STORAGE=shell` + `STORAGE_HOST=on` +
  `PAGE_ORIGIN=heyta-local://app` + `SECURE_CONTEXT=yes` + `AUTH_STATE=signed-out`，
  M2 三条判据（身份入口成立 / 身份菜单合规 / 滴答导入面板可达）全 ✓。
  ⇒ 上一节第 3 条要补的那一行**这次读了**，而且读的是对的文件。
- 第 25 段 `check:docs`：`✅ 无死链、无"本机有仓库里没有"的链接、无失效章节引用、无失效锚点`，
  并把 Goal 第 3 项的两条豁免**逐条打印了理由** —— 证明那支改动在真跑，不是静默放行。
- 第 46 段 `pnpm -r test`：server **91 文件 / 1806 passed**、web **77 文件**、
  app-host 36 文件、mobile 28、node-host 8、design-system / i18n 等各绿；
  第 30 段 `check:design`：`没有样式字面量、没有自定义 CSS 变量（扫描 103 个文件）`。

🔴 **这条 exit 0 的适用范围必须写在一起，否则它会被读成"干净检出上也是 0"**：
它是在**共享工作树**里测的，`git status` 当时有 **12 个不属于本轮的外来脏文件**
（`apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift`、`apps/web/src/{App.tsx,features/inbox/InboxBell.tsx,styles/app.css}`、
`docs/plans/admin-console.md`、`packages/design-system/**`（含 `src/tokens.css` 与其 4 份生成物）、
`packages/i18n/src/locales/{zh-CN,en}.ts`）。
⇒ **绿 ≠ 这些改动之外的 `origin/main` 也绿**；尤其 `check:design` 与 `check:ui-language`
明显吃到了那批**在途的 token / 词条改动**。下一轮要在**干净检出**上重跑才能拿仓库属性的结论。

📌 **本轮真正学到的一条**：`&&` 链"断在第 X 段"是**上一次运行的属性**，不是仓库的属性 ——
同一段（第 40 段）在 22:48 红 57 条、在 22:55 一条不差地全绿，**代码一个字没改**。
所以"链断了"之后第一件事是**看端口/pgrep**，不是看 diff。
已登记为本文件**第 87 条**（含"前置脚本会 `SIGKILL` 别人的 dev server"这条新事实与可执行判据）。

---

## 9. 🔴 「§7 第 N 条」这个引用体系**已经对不上了** —— 而且门禁看不见它，因为它的形状被**故意**判成散文

记录时间：2026-09-30 13:37–13:40（子代理实测；本轮 Bash 仍 `spawn EBADF`）。

**为什么这一节值得单独写**：Goal 的原话是"让 `pnpm check` 与它挡不住的死角都变成能失败的状态"。
第 3 项修掉的是**链接**指向不存在目标；这一条是同一个家族的**另一种目标** ——
**指向不存在的编号**。仓库里到处写着「§7 第 82 条」，而**没有任何一道门禁检查过这个编号存在**。

### 实测到的三个事实（都带出处）

1. **`docs/reference/environment-traps.md` 最大号 = 85，且 `#38` 与 `#77–82` 全部同号两义。**
   🔴 **本条初稿写的是"最大号 82、只有 #38 真重复"，那个数是错的**，22:12 复测推翻（过程见下）。
   实测：`#38` 两次（`:708` grace 单位混用 / `:779` 软键盘吞 tap），
   `#77…#82` **各两次** —— 文件里有**两套并列序列**：
   序列甲 `:1616 :1641 :1660 :1692 :1720 :1751 :1775 :1794 :1818` = `77…85`，
   序列乙 `:1848 :1867 :1881 :1899 :1909 :1920` = 又一遍 `77…82`。
   两套讲的是**完全不同的陷阱**（甲：ArrayBuffer/jsdom、`pnpm build` 不产 `.d.ts`、主工作树构建产物…
   乙：`sed` 的 C locale、远端 `pwsh.exe`、`i18n` 改完必须 build、`am start`、`aka.ms` 短链），
   所以这不是"同一条写了两遍"，是**六个号各自指向两件不同的事**。

   **初稿为什么会数错 —— 这是一条元规则一的现成标本**：探针写的是 `^[0-9]+\. `，
   而序列甲那九条的行首**有一个空格缩进**。一个空格就让它们在正则里**整体隐形**：
   既看不见 `#83 #84 #85`（于是得出"最大 82"），也看不见 `77–82` 的第二遍
   （于是得出"只有 #38 重复"）。**两个结论错在同一个原因上**，
   而错的形状恰好是"看起来是干净的部分结果"——它没有报出一条荒谬的数，所以自查发现不了，
   只有**换一个基准**（按缩进分组计数：行首 92 处、缩进 22 处）才暴露。
   同一份文件、两个人（§5 与 §9）各查一次得出不同结论时，**必须现查**，不能择相信其中一份。

2. **`AGENTS.md` 自己带着 6 条 80–83 的正文，而那些陷阱在 traps 文件里根本不存在。**
   `AGENTS.md:475` 声称"**83 条**实测踩过"，号段表列的是"80–83 壳与安装包验收（2026-09-30 新增）"。
   实际那 6 条在 `:931`=80、`:970`=81、**:906 与 :993 都是 82**、**:953 与 :1019 都是 83**
   —— 不但撞号，**顺序还是 82、80、83、81、82、83**（同一份文件内部就先乱了）。
   🔴 拿它们各自的**独有词**去 traps 文件搜：`stopPropagation`、`accent-color`、`window-id.swift`、
   `png-stats`、`countColor`、`looksBlank`、`CROSSCHECK`、`M2D` —— **命中 0 处**
   （只有一个不相干的 `screencapture` 在 `:404`）。
   ⇒ 那 6 条**写进了 AGENTS.md 正文**，违反了它自己同节立的规则：
   "新的条目**追加到 traps 文件末尾**（编号递增），**不要写回本文件**"。

3. **于是同一个号在两个文件里是两件不同的事。**
   traps `:1899`=80 是 `am start -n $PKG/.MainActivity`、`:1909`=81 是 `pwsh.exe`、
   `:1920`=82 是 `aka.ms/<短链>`；而 AGENTS.md 的 80/81/82 是 RNW 吞 keydown / 窗口取证三坑 /
   错误屏"非空白"。**「§7 第 82 条」这句话现在同时有四个候选。**

⚠️ **本节上面（§8）就用了这个坏掉的体系** —— "见 §7 第 82 条那个四轮全绿"、
"§7 第 81 条的三个静默坑"，指的是 AGENTS.md 里那两条，**不是** traps 文件的 81/82。
本轮**不回头改这些引用**，因为改到哪条取决于第 1 步怎么重编号，现在改会被改第二遍。

### 为什么 `check:docs` 抓不到（这是关键，不是"忘了加"）

`research/tools/docs-link-check.mjs` 有四道检查（死链 / 本机有仓库没有 / 跨文档 `§N` / 页内锚点），
两条都恰好放过这种引用：

- `claimedTitle()` 里**明写着**："指代写法（`§7 第 74 条`、`§7 #26`）是散文，不是标题" ⇒ 返回 `null` 放过。
  这个保守**是对的**（它防的是"一屏误报、其中没有一条是真的"），代价就是这类引用**零检查**。
- `sectionNumbers()` 只认 `#{2,6} 数字` 标题和表格行号 —— 而 traps 的条目是**列表项**
  `82. 🔴 …`，**不是标题**。所以把 traps 的条目号写成"章节号"去引用，得到的结论是"该章节号不存在"。

🔴 **这一支会红，是本轮在自己身上试出来的**：本节初稿真的写了"文件名紧挨 `§82`"那种引用，
`docs-link-check` 当场 exit 1 并把那一行报出来。**它拦住了，但拦错在意料之外** ——
"查不到就报红"这一支是活的，死的是另一支（见上面两条：`第 N 条` 形状被当散文放过）。
所以修法第 2 步要补的是**"编号存在、但指向的条目其实有四个候选"这一类**，那才是现在零覆盖的。

⇒ **这是一个"永远不会失败的检查"覆盖不到的、全新的目标类型**：编号命名空间的一致性。

### 修法（**顺序是硬约束**：门禁不能出生就是红的）

1. **先和解编号** —— 把 AGENTS.md 那 6 条**搬进** traps 文件，按 traps 自己的序列重编号。
   🔴 **号要从 §5 的那份实测取，不能取本节初稿**：初稿写"正确号是 83 起"，
   而 traps 实际最大号是 **85**（`#83 #84 #85` 已被 ArrayBuffer/`pnpm build` 不产 `.d.ts`/主工作树构建占了），
   从 83 起会**当场再造三对重复**。下一个空号是 **86**。
   §5 的甲方案已经把目标写全：序列乙 `77–82` → `86–91`、AGENTS 六条 inline → `92–97`、
   末段那 **10** 条无号 `###` → `98–107`（§5 原文写 7 条，是它自己的行号漂移，见 §5 的更正）。
   再同步改掉仓库里所有指向"AGENTS 版 80–83"的引用（现测 **27 处 / 12 个文件**，不是 20 处）。
   **这一步要改 `AGENTS.md`。**
2. **然后才加门禁**：在 `docs-link-check.mjs` 加第五道 —— 从 AGENTS.md §7 指针解析出 traps 文件路径，
   用**能吃下缩进**的正则（`^ {0,3}[0-9]{1,3}\. `）建「编号 → 标题」映射，断言三件事：
   **(a)** 无重号、**(b)** AGENTS.md 声称的条数与实际相符、**(c)** 全仓库每条 `§7 第 N 条` / `§7 #N`
   解析到**恰好一条**。三者任一不满足 ⇒ 红。
   🔴 **别照抄本节初稿写的 `^[0-9]+\. `** —— 那正是让上面 9 条（序列甲 `77–85`）整体隐形的锚点。
   照它建出来的门禁**出生就是瞎的**：看不见六个重号里的六个，还会自信地报绿。
   注入验证三条：手工加第二条 `^77. ` ⇒ (a) 红；某处写「§7 第 999 条」⇒ (c) 红；
   把 AGENTS 的"83 条"改成"200 条"⇒ (b) 红。**三条都必须能红，否则这道检查是装饰。**
3. **最后**才把 §8 那条 `&&` 链观察按新号追加进 traps 文件（第 4 步之后它才有确定的号）。

🔴 **卡在第 1 步，需要产品负责人拍板**：AGENTS.md 的规则区明写着
"不修改 `AGENTS.md` / `CONTRIBUTING.md` 的**规则**部分，除非用户在当前任务里明确要求"。
搬那 6 条**是**在改规则文件（虽然改的是它混进来的正文，不是规则本身）。
**本轮不擅自动它** —— 这正是 Goal 边界里"不碰别的会话、不顺手改"要防的那类事：
一个看起来机械的重编号会改到**几十个文件**，而其中至少三条线正在同时写 `AGENTS.md` 与 traps 文件。

---

## 10. ✅ Goal 第 3 项那道新门禁**落地一小时内就抓到一例真的** —— 但它不在我这一轮的地界里

> 记录时间：2026-10-01 00:15（`/tmp/dl-now.txt` 的 mtime，不写跑命令的时刻是因为我只信文件时间）。
> 命令与输出：`node research/tools/docs-link-check.mjs` ⇒ **exit 1**。

```
🔴 发现 1 处**本机有、仓库里没有**的链接 —— 它们在干净检出（CI 的唯一形态）上是死链：
   docs/plans/README.md:16
      -> help-center-docs-expansion.md   （解析到 docs/plans/help-center-docs-expansion.md，
                                          本机存在，但 git 没有跟踪它）
```

**归属**：这一例**不是本轮改出来的**，是**另一条会话的在途工作**撞上的
（`docs/plans/README.md` 与 `docs/plans/help-center-docs-expansion.md` 都在他们那批未提交里 ——
本轮开工时工作树 24 处脏，00:23 复测已经是 48 处，**这个数字只会随别人干活变大，别拿它当依据**）。
`HEAD` 上这一行不存在（`git show HEAD:docs/plans/README.md | sed -n '16p'` 是另一条表格行）。

🔴 **"所以 `origin/main` 上是绿的"这句以前是推断，现在是实测**（2026-10-01 00:23）：
在 HEAD 拉了一个临时 detached worktree，在里面直接跑同一道门禁 ——

```
git worktree add --detach /tmp/heyta-head-check HEAD
cd /tmp/heyta-head-check && node research/tools/docs-link-check.mjs   # ⇒ exit 0
git worktree remove /tmp/heyta-head-check
```

它报的是"✅ 无死链、无『本机有仓库里没有』的链接"，并另外印出 8 条指向 `research/upstream/`
等刻意不入库目录的**跳过**说明。⇒ 门禁在干净检出（= CI 的形态）上绿，红只在工作树。
**这个方法本身就是这道门禁的用法**：要区分"仓库红"和"我的机器红"，就在 HEAD 的临时 worktree 里跑。

**三条出路里该走哪条**（脚本自己印的三条，逐条判过）：
① **`git add docs/plans/help-center-docs-expansion.md`** —— 它是要入库的规格真身，不含私密数据；
② 不该用（链接本身是对的，索引就该指向它）；
③ 不该用（"`UNTRACKED_LINK_OK`"是给**刻意只活在本机**的东西的，往登记簿里塞一条常规计划文档，
等于把这道门禁的判据作废 —— 这正是 §3.2 许可证 `REVIEWED_OTHER` 要给成本的理由）。

⇒ **本轮不动它**：改 `docs/plans/README.md` 或替他们的计划文件决定入库，都是在替另一条会话做收口。
把结论留在这里，让他们 `git add` 那一个文件就绿。

### 顺带：我在这条命令上**自己踩了 §7 第 45 条**，值得留着

第一次跑的是 `node …mjs 2>&1 | tail -12; echo "DOCS_EXIT=$?"` ⇒ 它印了 **`DOCS_EXIT=0`**，
而真实退出码是 **1** —— 管道后面 `$?` 是 `tail` 的。
🔴 如果我只看那一行，就会写下"新门禁落地后仍然报绿"这个**完全相反**的结论。
同一轮里第二条命令把输出重定向到文件后再取 `$?`，才拿到 1。
**判据是退出码的流程，一律先重定向再取码**（§7 第 45 条的又一次命中，不是新条目）。

### 顺带第二条：`PROGRESS.md` 只能"提交半个文件"，而这条路有个会坑别人的尾巴

`PROGRESS.md` 里同时躺着另一条会话追加的那 22 行（文档中心那一轮）。按边界不能替他们提交，
也不能把他们的字节从工作树里抹掉 ⇒ 只能走 plumbing：从 `HEAD:PROGRESS.md` 造一份只含我这段的
临时文件 → `hash-object -w` → 临时索引 `write-tree` → `commit-tree` → `update-ref`（**带旧值 = CAS**）。
提交与推送都成功了，但 `git status` 随后对这两份文件报 **`MM`** ——
**plumbing 只移动了 ref，没刷新真实 index**，索引里还是提交前的旧 blob。
🔴 危险不在我这一侧：这时候别人一次再普通不过的 `git commit -a`
就会把旧 blob 当"当前内容"提交，**把刚推上去的那条改动静默抵消，一个冲突都不报**。
✅ 收尾已做（`git update-index --cacheinfo 100644,<新 blob>,<路径>` 两条 + `git diff --cached` 复验为空），
坑本身登记成 **§7 第 88 条**。

---

# 本轮 BLOCKED — 帮助中心 → SSOS 式文档中心（goal 1790782112262-64a449）

> 待裁决清单。**规格真身**：`docs/plans/help-center-docs-expansion.md`。
> 上面那十节是别的轮的账，本轮记录只追加在末尾，不动别人的字节。

## B1. ✅ **已解决**（2026-10-01 收尾轮，方案 1+2 合并落地）：英文版一篇图都没有

`DocsArticlePage` 里配图的条件是 `locale === 'zh-CN'`。为什么必须写这一条：
**18 张真界面产物全是中文界面**，因为 `scripts/screenshots/capture.mjs:117` 写死
`locale: 'zh-CN'` —— 而 `capture.mjs` 是任务书点名的**判卷文件，碰都不许碰**。

> 🔴 **本条当时的假设过期了，留在这里看清它错在哪**：「判卷文件碰都不许碰」是
> **那一轮**的冻结令，不是永久禁令。2026-10-01 收尾轮拿到解冻后，方案 1+2 一起
> 落地：`capture.mjs` 的 locale 改为**按目标声明**（`targets.mjs` 加 `locale`
> 字段；英文目标走 `?lang=` 参数 —— web 应用刻意不读 navigator.language，
> 只改浏览器协商不会切界面语言），新增 5 个英文目标（W01-en / W02-en / W03-en /
> W05-en / W07-en），`screenshots/` 18 → 23；映射表 zh/en 成对
> （`assertHelpFigurePairs` 在生成器入口钉住）；`DocsArticlePage` 改为按 locale
> 取图。**既有 18 张 zh 产物 sha256 逐张不变**（与开工前清单对账过），中文侧
> 零扰动。e2e 第 14 条按新产品事实改写：英文版必须挂 `*-en-*.png` 产物、一张
> 中文产物都不许出现；变异验证（en 图源指回 zh 产物）恰好红在该断言上。

- ~~现状：**中文 5 张图 / 英文 0 张图**，e2e 第 14 条把"英文版 0 张"钉成了判据（不是遗漏，是被验住的状态）。~~
- ~~三条出路，请领导拍：~~
  1. ✅ 下一轮把 `capture.mjs` 的语言变成参数并**同批更新它的判卷指纹**（最干净，代价是动判卷文件）；
  2. ✅ 给英文界面另建抓取目标（`targets.mjs` 可追加，但 `capture.mjs` 那个常量仍会挡住）；
  3. ~~接受"文档中心英文无图"（当前状态）。~~
- ⚠️ **不要**用"英文页挂中文界面的图"凑数 —— 那是骗读者，规格 §5 与 SSOS 截图政策都不允许。
  （这条**仍然成立且升级成了逐张断言**：e2e 第 14 条现在要求英文页每个 `src`
  精确等于 `*-en-*.png`，图号前缀必须是 "Figure"、不许出现中文「图」字。）

## B2. 两张候选图被否，不是没找到图

| 候选 | 否决理由 | 依据 |
|---|---|---|
| `W08`（同步设置面板） | 画面里是**内部配置路径与 token 命令** | 规格 §5 第 16 条：不许出现内部标识（SSH 别名 / 公网 IP / 密钥路径 / ZeroTier ID）；SSOS 政策：不许提交含 token 的截图 |
| `L07`（文档页自身截图） | 截图内容就是**正在被读的这类页面**，属自指装饰 | SSOS 政策明文禁止「Screenshots of docs pages as article illustrations」「Decorative screenshots that do not explain the adjacent text」 |

📌 记在这里是为了下一轮：**不是"少配了两张图"，是这两张永远不该配。**

## B3. 刻意没做的两件"顺手活"（任务书点名不许做，登记以防下一轮误当成待办）

1. `check:shell-unicode` 那个红 —— 未动，本轮**也没有复跑它**，所以它的当前状态我不管。
2. 排版那条线（`packages/design-system/**`、`apps/web/src/App.tsx`、i18n 两个 locale）
   的半成品 —— 未动。本轮在 i18n 里只**追加** `site.docs.*` 词条，
   提交时按行/hunk 过滤，别人的改动不进我的 `git diff --cached`。

## B4. 「建议」偏差一处（不是缺口，是选了更好的路）

任务书建议搜索用**生成的 `search-index.json`**。实际做成**运行时从注册表 + i18n 派生**。
理由：索引要用的每一项（文章标题、分区标题、锚点、语言路径）页面渲染时**本来就已经算过一遍**，
再落一份 JSON 就是第二份真相 —— 新增一篇而忘记重跑生成器，搜索会**静默漏掉那一整篇**，
而没有任何一层会报错（正是"报警器坏了没人知道"的形状）。零依赖这一条同样成立（根本没引依赖）。
代价：索引随主包进 JS，比单独 fetch 一个 JSON 略大（当前是 20 篇 × 2 语言的**标题级**数据）。

## B5. ✅ **已入档**（2026-10-01 收尾轮）：该进 §7 的实测陷阱

`git diff-tree -r --no-commit-id --name-only A B`（**两个** commit 参数）比的是 **A 与 B 之间**，
不是"各自对父提交"。本轮用它做"提交里有没有别人的文件"这道自查，得到 `OUT_OF_BOUNDS=none`，
而它实际只输出了 1 行（`PROGRESS.md`）—— 那个结论是**空测**：样本里根本不含主提交那 57 个文件。
正确写法：对区间比 `git diff --name-only <开工前的父> HEAD`，或每个 commit 单独
`git show --name-only`。本轮已用正确写法重量（结论不变，57 个文件全在白名单内，见 PROGRESS.md）。

它与 §7 第 82 条同源：**退出码 0 + 输出"看起来对"不等于判据跑在了正确的对象上**。

✅ **已落地**：2026-10-01 收尾轮解冻了该文件（上一轮的只读令只限那一轮），
已按编号递增追加为 `docs/reference/environment-traps.md` **第 90 条**
（同批把同一天的姊妹款——hunk 过滤只比对增行、漏判对方"改写自己正文"的 hunk——
写进了同一条的"一般规律"），AGENTS §7 索引表补了 `86–90` 行。**本条可以销账。**

## B6. 🔴 `pnpm --filter @heyta/mobile test` 退出 1 而 28 个文件全过 —— 既有的测试基础设施红，**不是 i18n 这轮改出来的**

i18n 实施轮撞见并当场归因，登记在这里防止下一轮把它当成国际化改动的回归。

**症状**：`Test Files 28 passed (28) / Tests 418 passed (418) / Errors 3 errors`，**exit 1**。
三条 `Unhandled Rejection` 全是同一个：`RolldownError: Parse failure … Flow is not supported`，
对象是 `node_modules/.../react-native/index.js:1:0`（RN 的 copyright 头），
文本都写着 `This error originated in "tests/auth-flow.spec.ts"`。
调用链 `vite@8.3.1 ssrTransformScript → rolldown@1.2.11 parseAstAsync` —— 即**node 侧的
`require('react-native')` / `require('@op-engineering/op-sqlite')` 被 vite 拦去做了 SSR 变换**，
同步抛错被 `try/catch` 吃掉（界面上的"[prefs] 设备本地偏好库不可用"就是它），
但**异步那一半没人接** ⇒ vitest 记成 unhandled rejection ⇒ 进程非零退出。

**归属证据（三条，都是实测）**：

| 实验 | 结果 | 说明 |
|---|---|---|
| 把本轮改过的两个 spec 从命令里**排除**再跑全量 | `26 passed / 381 passed / Errors 3`，exit 1 | 与本轮改动无关，红照旧 |
| 单独跑 `auth-flow` / `locale` / `widget-bridge` / `sync-status-text` | 各自 exit 0，无 Parse failure | 归因行是**时机**不是**因果**（§7 元规则一"先怀疑探针"）|
| `git log -1` 那批触发模块 | `src/prefs/device-prefs.ts` + `tests/auth-flow.spec.ts` 同为 `72dd32fc`（2026-09-30，别的会话） | 红来自那一次提交，本轮没碰这两个文件 |

**为什么没当场修**：候选修法（给 `apps/mobile` 加一份 `vitest.config.ts` 把 `react-native` /
`op-sqlite` 排除在 SSR 变换外）会同时改**这 28 个文件共同的**模块解析行为，
而它必须靠"跑全量才知道有没有弄坏别的用例"来验证 —— 和本轮 i18n 的七步没有交集。
**它挡的是 `pnpm check` 末尾的 `pnpm -r test`，不挡任何一条 i18n 门禁。**

**复现**：`cd apps/mobile && npx vitest run`（并行或 `--no-file-parallelism` 都复现；单文件不复现）。
**建议改法**（下一轮）：要么在 `apps/mobile` 加 vitest 配置外置这两个包，
要么把 `device-prefs.ts` / `locale.ts` / `widget-bridge.ts` 三处 `require` 前加一个
零 import 的运行时判定（如 `globalThis.HermesInternal` / JSI 存在性），让 node 侧根本不进加载器。

## B7. 🔴 `pnpm check:ui-language` 现在红，红的不是口令这一轮 —— 是另一条**未提交**的多行词条

**症状**：`🔴 无法解析词条表：packages/i18n/src/locales/en.ts；看起来像词条的行有 2653 行，只解析出 2652 条`。

**那一条**（`git show HEAD:…` 里**不存在** ⇒ 未提交的新增）：

```ts
  'web.board.planCaption':
    "This task's internal checklist plan (order and estimates) — not the same coordinate system as the timeline board.",
```

`check-ui-language.mjs` 的解析器是**按行**的（文件头写明"一行一条、key 与 value 都用单引号"），
`ENTRY_LIKE` 命中这一行而 `ENTRY` 不命中 ⇒ 条数不等 ⇒ 按设计失败。双引号 + 折行两处都违形。

**A/B 实测**（就地折成单行 → 跑门禁 → 逐字节复原）：折起来 `exit=0`，词条表报 `zh-CN 2653 条 / en 2653 条`；
复原后仍然红。⇒ **红只来自这一行**，同批其他人写的中文词条与本轮新增的 `common.auth.form.serverUrlRequired`
（zh/en 各一条）都解析得到。

**为什么没当场修**：那是别人**尚未提交**的一行，改它等于把别人的工作卷进我的提交。
**修法（归该轮的所有者）**：折成一行并把 value 里的 `task's` 写成 `\'`，或整条改用不含裸撇号的措辞。

## B8. 🔴 `apps/web` 全量测试一次红 63 个文件 —— 共享的 `packages/ui/dist` 被一次**失败的 build** 清空了

**症状**（2026-10-02 00:43）：`npx vitest run` 报 `Test Files 63 failed | 33 passed`，
每一条的错误都是同一句：

```
Error: Failed to resolve entry for package "@heyta/ui".
The package may have incorrect main/module/exports specified in its package.json.
```

**实测原因**：`packages/ui/dist` 目录**空的**（`ls` 无输出，mtime 00:43）。
手动跑 `pnpm --filter @heyta/ui build` 以 **exit 1** 失败，因为并行会话正在写的
`packages/ui/src/timeline/TimelineBoard.tsx` **连解析都不过**：

```
src/timeline/TimelineBoard.tsx(598,15): error TS1005: ')' expected.
src/timeline/TimelineBoard.tsx(598,16): error TS2552: Cannot find name 'row'. Did you mean 'rows'?
```

`stat -f %m` 显示那个文件在 **00:44:03** 刚被写过 ⇒ 它是"写了一半"，不是"写坏了没人管"。

**归属**：不是本会话那两笔（`2ef48b76` 认证面板变薄壳 / `0cbcf3e5` 门禁注释更正）造成的。
反证是同一条命令在 00:35 的两次运行：那一刻 dist 完好，
`auth-journey / auth-panel / auth-recovery / auth-form / signin-entry` **100 passed**，
而我这两笔只动 `AuthPanel.tsx` + 三份 auth spec + `scripts/check-ui-provider.mjs`。

**为什么没当场修**：那是别人未提交、且正在写的文件，补它 = 替他们决定时间线板的设计，
而我没有他们的意图（`row` vs `rows` 只是语法层表象）。

**修法（归该轮的所有者）**：`TimelineBoard.tsx` 写完后重新 `pnpm --filter @heyta/ui build`；
在那之前 `apps/web` 的任何**全量**测试结论都不可信（只有不 import `@heyta/ui` 的文件能跑）。

📌 **可迁移的判据**：共享工作树里，`packages/*/dist` 是**所有会话共用的单点产物** ——
谁的那次 build 失败，就把别人的验证窗口一起关掉。所以"红一片"的第一动作是
`ls packages/*/dist` + 看错误是不是 `Failed to resolve entry`，**不是**翻自己的 diff。

## B9. ✅ **已解除**（2026-10-02 19:03）🟡 `apps/web` 全量测试剩 **1 条红**：习惯图标选择器 —— 被测文件是并行会话**未提交**的改动

**症状**（2026-10-02 01:15，`pnpm -r --filter '!@heyta/sync-server' test`）：只有这一个失败，
其余 17 个包全绿（app-host 42 文件、mobile 31、legal 57、landing 1303、ui 22）。

```
FAIL tests/habits-list-pane.spec.tsx > D. 图标选择器：存闭集 key，不存字形名
     > 🔴 选一个字形 → **落库的是 key**，且行首圆盘跟着变
AssertionError: expected '<svg …' not to be '<svg …'   // habits-list-pane.spec.tsx:311
```

第 309 行**过了**（`storedIcon(name) === 'book'` ⇒ key 确实落库），红的是第 311 行
`expect(after).not.toBe(before)` —— 选了 `book` 之后，行首圆盘的 `<svg>` outerHTML **一字未变**。

**归属**：这条断言管的四个文件在本工作树里是**别人未提交**的状态，本会话一行都没碰：

| 状态 | 文件 |
|---|---|
| `M` | `apps/web/src/features/habits/HabitIconPicker.tsx` |
| `M` | `apps/web/src/features/habits/HabitsList.tsx` |
| `M` | `apps/web/src/features/habits/HabitsView.tsx` |
| `M` | `apps/web/src/features/habits/HabitGoalEditor.tsx` |
| `??` | `packages/design-system/src/icon-size.ts`（新文件，图标尺寸的统一） |

本会话那两链（隐私同意闸门 + 法务文本）动的是 `apps/web/src/{main.tsx,pwa/register.ts}`、
`apps/web/src/features/privacy/`、`packages/app-host/src/privacy-consent.ts`、
`packages/legal` 与它的生成物 —— **与习惯/图标没有交集**，而且 i18n 侧只改了 `site.legal.*` 词条。

**为什么没当场修**：那是别人**正在写、还没提交**的图标选择器。第 311 行要的是
"换图标要看得见"，而它红的可能有三种根因（默认字形恰好就是 `book`、picker 写了 key 但
圆盘仍从旧字段取字形、`icon-size.ts` 那次统一把外层 `<svg>` 变成常量），
**选哪个等于替他们决定这个组件的行为**，我没有他们的意图。

**修法（归该轮的所有者）**：先分清是**产品**还是**契约** ——
`cd apps/web && npx vitest run tests/habits-list-pane.spec.tsx` 里把 `before` 与 `after`
两个字符串打出来；相同 ⇒ 圆盘没有从落库的 key 取字形（产品），
或测试选的那个字形本来就是该习惯的默认字形（契约，改成选一个**一定不同**的）。

📌 **这一条对下一轮的含义**：本轮"全量单测绿"这句话**不能这么写** ——
准确口径是 **1322 passed / 1 failed，而那 1 条属于图标选择器那一轮**。
不要把它当成自己的红灯去翻自己的 diff，也不要为了让汇总变绿去动别人的文件。

**解除取证**（2026-10-02 19:03，本轮）：图标那一轮已提交，`npx vitest run tests/habits-list-pane.spec.tsx`
= **19 passed / 0 failed**，原第 311 行（换图标要看得见）在内。上面那句"不能这么写"仍然成立 ——
它约束的是**当时**那次汇总的口径，不是现在的状态。

## B11. ✅ **已解除**（2026-10-02 19:40）🔴 四条 legal-links 全红在**同一个与本轮无关的动作**上 —— 未提交的隐私同意面板把整个界面盖住了

> 编号说明：这一条登记时误用了 `B9`（与上面"习惯图标选择器"那条同号）。
> 改号为 `B11` 并把解除取证补在下面 —— **编号只增不改**，所以同号两件事必须拆开。

**症状**（2026-10-02 01:13）：`npx playwright test --config=playwright.legal-links.config.ts`
里已完成的 4 条**全部** `Test timeout of 120000ms exceeded`，而失败点都在
`openAuthPanel()` 的**第一下点击**，不是我迁移的那批锚点：

```
Error: locator.click: waiting for getByTestId('account-menu-avatar')
  - element is visible, enabled and stable
  - <div role="presentation">…</div> from <main class="ht-main">…</main> subtree intercepts pointer events
  - 231 × retrying click action
```

**实测原因**：工作树里多了一个**未跟踪**的 `apps/web/src/features/privacy/`
（隐私同意面板），而 `apps/web/src/App.tsx`（已修改，未提交）在 1961 行把它挂进了渲染树。
`shouldAskOnFirstLaunch()` = `privacyConsent.undecided()` ⇒ **全新浏览器上下文必然为真**
（Playwright 每条用例一个新 context，localStorage 是空的），
面板以一个 `role="presentation"` 的遮罩铺满 `<main class="ht-main">`，
于是**任何**需要点 UI 的 e2e 都被它先拦住。

**归属**：整条隐私同意线（`packages/app-host/src/privacy-consent.ts`、
`apps/web/src/features/privacy/`、`apps/mobile/.../AuthScreen.tsx` 里那些
`requireNetworkConsent()`、`e2e/tests/privacy-consent-zero-egress.spec.ts`）
都在别人的 diff 里，`git cat-file -e HEAD:packages/app-host/src/privacy-consent.ts`
报 "not in HEAD"。本会话这一轮只动了 `e2e/**` 的锚点。

**为什么没当场修**：这不是"界面在说谎"那一类缺陷 —— 面板**应该**盖住首启界面。
要在别的套件里跑下去，只有两条路，都不该由我来定：
① 各 e2e 套件统一在 `openApp()` 里先作一个同意决定（那要选「同意并联网」还是「只用本机」，
   是一个**产品语义**的选择，而且认证旅程需要联网，选错了整批红）；
② 让遮罩只覆盖内容区而不吃 rail 的指针事件（那是那个功能自己的设计问题）。
两条都归该轮的所有者。

**恢复验证的动作**（等那轮提交后重跑，判据本身不用改）：
`cd e2e && npx playwright test --config=playwright.legal-links.config.ts`（5 条），
以及 `pnpm verify:email-web`。**在那之前，本工作树里任何"真浏览器"结论都不可信** ——
与 B8（`packages/*/dist` 被一次失败的 build 清空）同形状：单点状态被并行会话占着，
红的不是我的 diff。

**解除取证**（2026-10-02 19:40，本轮）：上面那两条路里选了 **①**，而且那三个"该由谁定"的
产品语义已经定下来了 ——

1. **共享启动路径的默认档 = `local-only`**（`e2e/tests/helpers.ts` 的 `openApp(page, path, consent)`）。
   默认不出门，是因为**默认值必须站在隐私那一侧**：新写一条验收的人不选档时，
   得到的行为应该是"零字节离开本机"，而不是"悄悄联网"。
2. **要出门的调用点显式传 `accepted`** —— 认证旅程需要网络，所以它是**逐点声明**的，
   不靠默认。`e2e/auth-journey/helpers.ts` 的 `openApp` 固定 `accepted`（那条线整条都在联网）。
3. 🔴 **"计数为 0"这一类反向判据必须用 `accepted`** —— 这是本轮实测出来的，不是洁癖：
   `local-only` 下全局 fetch 被闸门替换，**任何请求都发不出去**，于是"某端点请求数 = 0"
   在两种情况下都成立：契约真的不要求它、和它被闸门挡了。拿它当判据等于没有判据。
   同一条机制也让 `inbox.spec.ts` 的「未配置服务器」那条红过一轮 ——
   它要钉的 `unconfigured` 是**拉了之后**的读态（`store.ts:115`），
   而 `local-only` 下 `InboxBell.tsx:313` 的 `pollNotifications()` 提前 `return` 且**不改状态**，
   界面永远停在空态，**结构性到不了那个分支**。

三条判据各自复跑：`playwright.legal-links.config.ts` **5 passed**、
`pnpm verify:email-web` **exit 0**（真 SMTP + 真服务端 + 真浏览器，全判据 ✅）、
`pnpm verify:password-web` **2 passed**（口令这条路 7 张截图）。
🔴 **离线全量套件这一轮没能给出一个可信的单一数字**（两次跑分不同，原因见 B12）：

| 跑 | 时间 | 结果 |
|---|---|---|
| 第一次 | 19:14–19:21 | **93 passed / 1 flaky / 2 skipped**（96 条） |
| 第二次 | 19:33–19:43 | **87 passed / 6 failed / 1 flaky / 2 skipped** |

六条红**共享同一个原因**（`/api/account/legal-consent` 非 2xx），且**不在本条要证的三件事里** ——
细节与归属登记在 **B12**。本条的解除判据是那三条各自复跑，不是这个套件数字。

📌 **可迁移的判据**：一条 e2e 失败**先定位它红在第几步**，再看那一步是不是自己改过的代码。
四条同时红在**同一个 `click()`**、而错误里写着"别的元素 intercepts pointer events"，
那个"别的元素"就是探针环境的变量 —— 它属于**谁的工作树状态**，不属于被测契约。

📌 **第二一般规律（解除时才浮出来）**：一个"首启必须拦人"的遮罩一旦进共享启动路径，
它就把**所有**验收劈成两档 —— "能出门"和"不能出门"。这时**默认档选哪边不是风格问题**，
它决定后来者忘传参数时测到的是哪条分支。所以默认档必须配一条**能失败的判据**
（本轮 = `privacy-consent-zero-egress.spec.ts`），否则"默认"只是文档里的一句话。

## B12. ✅ **已解除**（2026-10-02 19:58）🔴 隐私/法务重确认线的接线落进工作树后，离线 e2e 六条红在同一个非 2xx 上 —— `/api/account/legal-consent` 客户端在调、夹具没给它打桩

**症状**（2026-10-02 19:43，`cd e2e && npx playwright test`）：**6 failed / 87 passed / 1 flaky / 2 skipped**。
六条的失败信息**逐字相同**：

```
Error: 除已登记缺失外不该有非 2xx：["/api/account/legal-consent"]
```

命中的是 `tests/admin-console.spec.ts` 四条 + `tests/inbox.spec.ts` 两条。
判据本身在 `admin-console.spec.ts:538-544` 与 `inbox.spec.ts:191-197`（`KNOWN_MISSING` 只登记了
`/favicon.ico`）。

**实测机制**（逐环核过，不是推测）：

1. 客户端会问一次账号级法务重确认：`packages/app-host/src/legal-recheck.ts:152` 的 `ask()`
   → `:160` `getLegalConsentStatus()` → `packages/app-host/src/hosted-auth.ts:103`
   `accountLegalConsent: '/api/account/legal-consent'`。
2. 真实服务端有这两个路由（GET 读侧 `server/src/api.ts:636`、POST 写侧 `:673`，
   逻辑在 `server/src/legal-recheck.ts`），离线夹具里**没有**：这两条 spec 把
   `baseUrl` 塞成 `http://127.0.0.1:4319`（`admin-console.spec.ts:41`、`inbox.spec.ts:31`），
   也就是 `e2e/stub-provider.mjs`，而它的契约是**只实现模型接口** ——
   `!url.includes('/chat/completions')` 一律 404（`stub-provider.mjs:139-143`）。
   各 spec 自己的 `page.route` 表是按端点**逐个**打桩的
   （`/api/sync/status`、`/api/notifications`、`/api/activity`、`/api/passkeys`、`/api/admin/**`），
   没桩的那条路径就真打到 4319 上 ⇒ **404**。
   ⚠️ 本条初稿在这里写过两句错的：① "桩不服务它"落点写成 `stub-provider.mjs` 之外的地方；
   ② 更离谱的一版说它"落在 vite dev(4318) 上（`vite.config.ts` 无 `/api` 代理）"——
   `proxy` 0 命中是真的，但**结论用错了地方**：`baseUrl` 指向的是 4319，不是 4318。
   教训：**"哪个端口接住了这个请求"要看塞进 `baseUrl` 的那个常量，不能看应用自己的 origin。**
3. 于是那条"除登记外不许有非 2xx"的判据把每一条**已登录且配了服务器**的用例都判红。

🔴 客户端的闸门是**对的**：`legal-recheck.ts:155` 在 `token === '' || baseUrl === ''` 时直接 `return`，
所以未配置的应用不会发这一枪 —— 红的是**夹具没跟上生产契约**，不是产品多发请求。
（同一份判据在 `admin-console.spec.ts:772` 那条"刻意不塞凭据"的用例上是**成立**的，它没红。）

**归属**（初稿这里写错了，按实测改正）：本条曾写"`881aa92a` 在两次全量跑之间完成提交"——
**那句是错的**：`git log -1 --format=%ad --date=format:%H:%M:%S 881aa92a` = **08:46:13**，
比两次跑都早约 11 小时，而**两次跑之间 HEAD 一笔没动**
（`git log --since 19:21 --until 19:33` 空；最近一笔 `6a5f03c8` 19:14:48 落在第一次跑的内部）。
**真正在两次跑之间出现的是工作树里的未提交改动**（取证时刻的状态）：

| 文件 | 取证时的 git 状态 | mtime | 与两次跑的关系 |
|---|---|---|---|
| `apps/web/src/main.tsx`（`:29` 引 `askLegalRecheck`、`:67` 把它挂进 `createStartupNetwork`） | `M` | **19:29:10** | 正好落在第一次结束(19:21)与第二次开始(19:33)之间 ⇒ 第二次才可能红 |
| `packages/app-host/src/legal-recheck.ts` | `??` 未跟踪 | **19:40:05** | 第二次跑的**中途**还在被写 |
| `apps/web/src/features/legal-recheck/gate.ts` | `??`（整目录未跟踪） | 19:46:26 | 同上 |
| `packages/app-host/src/{hosted-auth,index}.ts` | `M`（881aa92a 之上又有未提交改动） | — | 调用链的另一半 |
| `apps/web/tests/legal-recheck-gate.spec.ts` 等 | `??` | — | 那条线自己的判据也在途 |

⇒ 这条红最初登记时**不属于本条线**，也不在库里。**19:48 该线自己落地了**
（`bd703b62 feat(legal,G-27)` 把判定与出口搬进 `app-host`、`a1e2e671 feat(web,G-27)` 装上面板与第二道出站闸），
落地时**没有补夹具** —— 所以这不是"别人在途的噪声"，是一条**会 standing 的红**。

### ✅ 已解除（2026-10-02 19:58）：修法取上面三个方向里的 ①，并且它确实是"夹具没跟上生产契约"

**A/B 就是解除过程本身**（同一棵树、同一份 config，只差那三行）：

| 跑 | 时刻 | 结果 |
|---|---|---|
| 修改前（HEAD 已含 `a1e2e671`） | 19:53 | **6 failed / 2 passed**，六条同一句 `除已登记缺失外不该有非 2xx：["/api/account/legal-consent"]` |
| 修改后 | 19:58 | **8 passed，exit 0** |

⇒ "六条红"不是 flaky、不是 dist 漂移，**改这一处就整片消失**；而这条判据的牙齿没有被削弱
（`KNOWN_MISSING` 仍只有 `/favicon.ico`，"不许有意外的非 2xx"照旧 armed）。

**改动**（三处，全在 e2e 夹具侧，产品代码零字节）：

- `e2e/tests/helpers.ts` 新增 `stubLegalRecheck(page, origin = STUB_ORIGIN)` ——
  应答体刻意**只住这一处**（字段集抄自服务端 handler：`needsReconfirm`/`reason`/
  `currentVersion`/`recordedVersion`，且 `reason` 必须是 `LEGAL_CONSENT_REASONS`
  （`packages/app-host/src/hosted-auth.ts:936`）里的一个，否则
  `parseLegalConsentStatus`（`:963`）整条判 `malformed-response`）。
- `e2e/tests/admin-console.spec.ts` 的 `seed()`、`e2e/tests/inbox.spec.ts` 的
  `seedServerAndStubRoutes()` 与"空态"那条各自的塞凭据之后 —— 各调一次。
- **没有**给 `account-menu.spec.ts` 加：它的 `baseUrl` 是 `https://sync.example`（不存在的域），
  请求以网络错误收场而不是"非 2xx 响应"，那条判据本来就不会被它触发。

**为什么这是无副作用的那个**：② 登记进 `KNOWN_MISSING`＝承认这个 404 是预期，
今后真出 404 也没人看得见；③ 让客户端对 404 静默降级＝把"服务端不认这个路由"与
"这台实例不需要补签"混成同一个状态，而这两件事的界面含义相反。
① 只补夹具的前提（"这个账号当前不需要补签"），与 `inbox.spec.ts` 里既有的那句说法一致：
"塞了凭据之后它就会发，所以要给这个假服务端补上 —— 否则无关的 404 会把真正的失败淹掉"。

⚠️ **本轮当场踩到的一条自伤**（记在这里因为它花掉了一整轮跑测）：
给 `stubLegalRecheck` 写的 JSDoc 里有一句 `` `**/api/**` `` ——
**块注释里出现的 `*/` 会提前闭合注释**，后面的中文于是变成代码，
`helpers.ts` 以 `ReferenceError: api is not defined` 炸掉整套。
写注释里的 glob 时别用 `**/x/**` 这种带 `*/` 的形态（改成"覆盖整个 `/api` 前缀"这类说法）。

📌 **可迁移的判据（这次最值钱的一条）**：**同一棵树两次全量跑分不同，先查三样东西在中间有没有动过
—— ① HEAD、② `packages/*/dist`、③ 工作树里别人**未提交／未跟踪**的源码 —— 再谈"产品 flaky"**。
本轮三条证据全在，而且**这次起作用的是第 ③ 条**（HEAD 两次几乎相同，见上面归属表）。
先说另外两条：
`git worktree list` 显示并行会话在 `/tmp/heyta-g5m` 跑 `reinstall-all.sh --only android,ios`；
`packages/i18n/dist` 的 mtime = **19:30:24**，正好落在一次 `--repeat-each=3` 的复跑窗口里，
而那次 vite 打出 **63 条** `Pre-transform error: Failed to load url .../packages/i18n/dist/index.js …
Does the file exist?`。
**逐次对账**（数的是同一次运行里 vite 的 pre-transform 报错条数）：

| 跑 | pre-transform 报错 | 结果 |
|---|---|---|
| 离线第一次 19:14–19:21 | **38** | 93 passed / 1 flaky |
| `search-overlay --repeat-each=3` | **63** | 4 failed（其中三条是"元素找不到"＝模块没加载上）|
| 离线第二次 19:33–19:43 | **0** | 87 passed / 6 failed —— 六条**同一个** `legal-consent` 原因 |

⇒ 前两次的红**不能当产品结论**用（探针环境在跑测中途被换过），第三次的六条是干净的、可归因的。
🔴 一条**没被这条解释掉**的：`search-overlay.spec.ts:128` 的
「padding-top 128 / 实测上隙 125.32」差了 **2.68px**，而判据是 `≤ 2` —— 那是**容差本身太紧**，
不是 dist 漂移能产生的形态（模块加载失败不会只把间距挪 2.68px）。登记给该线：
要么按分数像素（devicePixelRatio/缩放）放宽容差，要么把判据改成"上隙明显小于下隙"那种方向判据
（它下面第 130 行已经是方向判据了）。
同族：B8（`dist` 被一次失败的 build 清空）、§7 第 82 条（"重装了一遍"≠"装的是当前源码"）。
**查第 ③ 条的命令**（本表就是这么得出的）：`git status --porcelain <关心的目录>` 看有没有 `M`/`??`，
再 `stat -f '%Sm %N' -t '%H:%M:%S' <文件>` 把 mtime 对到两次跑的时间窗里。

## B10. ✅ 已闭合（2026-10-02 同日）：服务端 test 端点缺"签发一次性登录链接令牌"能力 —— iOS 验收的贴令牌主路径结构性走不通

**定性**：夹具/测试基建缺口，不是产品缺陷（2026-10-02，verify-mobile-ios 13 轮定位）。

**症状**：`verify-mobile-ios.sh` 第 5 步主路径（「注册 / 登录」→ 粘贴令牌 → 验证并登录）
**12+ 轮从未通过**，每轮都靠兜底表单（设置面手填三件套）走通凭据链路。

**根因**：`POST /api/test/create-user`（`server/src/test-routes.ts`）返回的是
**JWT 访问令牌**（`jwt.sign({userId, email, tokenVersion})`）；而应用「粘贴邮件里的
链接或令牌」吃的是 **ADR-0039 邮件链接流的一次性令牌**（服务端签发、可消费一次的
登录链接令牌）。形态不匹配 ⇒ 贴进去 ⇒ 登录永不完成 ⇒ 210 秒窗口必超时。

**修法（已落地）**：
- `server/src/auth.ts` 把签发逻辑抽成 `mintLoginMagicLinkToken()`（随机 32 字节 hex、
  落库只存 SHA-256、15 分钟过期、原子占槽）—— 生产 `requestLoginMagicLink` 与
  test 路由走**同一个函数**，令牌形态不可能再分叉；
- `server/src/test-routes.ts` 新增 `POST /api/test/mint-login-link`（TEST_MODE 才注册）：
  对既有已验证邮箱**强制新签**一枚（先清旧再占槽，避开生产"未过期静默复用"的抖动），
  不发邮件、直接返回令牌；
- `verify-mobile-ios.sh` 建号后即 mint，主路径贴它；**MAINPATH_GAP 降级注记整体删除** ——
  走不通从此是真红。

**判据**：
- 单测 `server/tests/test-routes-mint-login-link.spec.ts` 4 条：404 / 409 /
  🔴 **往返**（路由吐的令牌能被生产 `verifyLoginMagicLink` 换出带 `tokenVersion` 的会话）/
  重复签发必为新枚。**变异验证**：把路由改回返回 JWT（B10 原病形状）⇒ 恰好那 2 条承重用例红；
- 真服务端 curl 往返：create-user → mint（64 hex）→ **产品端点** `POST /api/login/magic-link/verify`
  200（JWT 含 userId/email/tokenVersion）→ 同令牌二刷 **401**（单次消费）；
- `verify-mobile-ios.sh` 隔离轮（run20，专属模拟器 + 专属 /tmp）：此前 12+ 轮全红的
  **输入原语与 op 落库全绿**（FAB → Composer → 文字注入 → CRT op 进真 SQLite、
  向量时钟含自己），一次性令牌已签出。主路径（贴令牌 → 验证并登录）的 UI 步
  **尚未在健康环境走完**：当晚宿主机被多个并行项目的测试/构建打满（负载 128、
  WindowServer 94%），iOS 27.1 模拟器的无障碍桥**整机阵亡**（连系统设置 App 的
  树都读不出），run15–20 的后半程全是它的下游（traps #116）。隔离旋钮已落地
  （`IOS_UDID` / `HEYTA_IOS_DERIVED` / `HEYTA_IOS_LAPTOP_DB` / `HEYTA_IOS_BUILD_LOG`），
  安静窗口一条命令即可补全绿 —— 走不通仍是真红，降级注记已删。
- **归因判决（21:35，数据库级判据）**：主树 App 的"提交即崩"在**干净 HEAD
  worktree 构建上不复现**（提交 → ops=1 落真 SQLite → App 存活无崩溃）；
  主树（含并行会话未提交在途文件）同一操作五份 SIGABRT（TurboModule void
  调用抛 OC 异常）。⇒ **崩溃源 = 并行会话的在途文件，已提交代码无责**
  （干净树里就有它们）。等其收口后即可全绿。
- **iPhone 机型已落地**：iOS 27.1 seed 运行时只认 Duo（iPhone 全系 create
  即 403）；已下载 **iOS 27.0 全量运行时**并建 `heyta-iphone-17pro`
  （402×874 标准几何）。剩余适配一件：27.0 上 `set-value` 不触发 RN
  onChangeText、HID 无中文 keycode（traps #121）—— 中文标题需走剪贴板
  粘贴或 ASCII 替代，脚本待适配。

**相邻回归**：`magic-link-registration` / `email-locale-wire` / `password-auth-routes` /
`auth-cache` 共 69 条全绿 —— `auth.ts` 的抽取是行为等价重构。


---

## 2026-10-02 12:12–12:15：我在别人正在用的模拟器上发过输入（自报）+ 一条对所有会话成立的凭据暴露事实

**谁**：G5 移动端像素那条线（本条目的作者）。**设备**：`emulator-5554`。

- 我在 12:12:28 / 12:12:56 / 12:13:15 / 12:14:05 向这台设备发过 **4 次 `input tap` 与 1 次
  `input text "row-check-30pct"`**，目的是取"共享 `TaskRow` 在移动端的行级像素"。
  动手前读的现场判据是 `ps Axo command | grep -F 'verify-mobile'` = **0**、
  `adb -s emulator` = **0**、loadavg 29 —— **三条都读对了，结论仍然是错的**：
  屏内那行「已同意与服务器通信 · **决定于 2026-10-02 12:13**」证明那一刻**有人正在实时配置这台设备**
  （脚本进程不在 `ps` 里 ≠ 设备没人用 —— 人肉点、别的工具、或另一条会话的交互式 shell 都不长这样）。
  我的 tap 因此落进了别人的界面。
- 已立刻停手。**没有创建任何任务**（12:13:15 之后的 dump 里不存在 `row-check` 行）。
  🔴 **请正在用这台设备的那条线复核两件事**：
  ① 你那 15 个 ASCII 字符有没有被读进当时聚焦的字段（我发 `input text` 那一刻 dump 里聚焦的是
  `content-desc="新任务标题"`，但焦点可能在你我之间换手）；
  ② 收集箱 / 回收站里有没有多出一条 `row-check-30pct`。
- 🔴 **对所有会话都成立的一条事实**（不是缺陷登记，是取证纪律）：
  **「设置 › 同步」面板把访问令牌按明文渲染**（那个输入框不是 `password` 型），
  所以**任何截到这一屏的取证图都会带出一枚活凭据**。本轮我拍到的那两张
  （`/tmp/g5a-state.png`、`/tmp/g5a-state2.png`）已**当场删除、未进任何提交**
  （`git grep -l 'JUZ' -- apps` 为空，未跟踪里也没有）。
  ⇒ 建议：截图判据避开这一屏；或把该字段改成**默认掩码 + 显式揭示**（这条要动的是
  设置面板本身，归本条线之外，先登记不代做）。
- 📌 我这边留下的可复用结论已经入库，不需要你处理：iOS 那台的行级数字在
  `apps/mobile/evidence/reinstall-20261002-2007-ios-task-row.txt`（`b361f756`），
  台账在 `docs/plans/ui-review-fill-zh-timeline.md` 的 G5 段（`401ff648`）。
  **安卓那台的同一张图我登记为"未实测"**，不再在这台设备上尝试。

## B13. ✅ **已解除**（2026-10-02 20:31）🔴 全量离线套件的最后两条红都不是产品：一条是 **vite dev 的 HMR socket 冒充应用的实时通道**（同一枚硬币的另一面是"确认后真的重连"这条正向对照在 dev 下**恒真**），一条是**在入场动画的中间帧量几何**

**先给结论数字**（三次跑，日志都还在）：

| 时间 | 跑法 | 结果 | 日志 |
|---|---|---|---|
| 20:08 | 主配置全量（B12 修完之后） | **98 passed / 2 failed / 2 skipped**，`EXIT=1` | `/tmp/full-after-b12.log` |
| 20:1x | 只跑被改的两支 | **9 passed (44.9s)** | `/tmp/two-fix.log` |
| 20:2x | 主配置全量（本条修完之后） | **100 passed / 2 skipped**，`EXIT=0` | `/tmp/full-after-two-fixes.log` |

那 2 条 skip 是 `desktop-window.spec.ts:290/:304`（Electron GUI 两条，本机条件下本来就走跳过分支），
与本条无关。**这一次 B9 家族的收口终于有一个可信的单一数字了**（B12 那一轮登记过"这轮没给出单一数字"）。

### 红 1 —— `legal-reconfirm-gate.spec.ts:168`「待补签…op-log 与实时通道两个出口都是零」

**症状**（逐字）：

```
Error: 待补签却建了实时通道：ws://127.0.0.1:4318/?token=8-cC4f_Ev09e
- Array []
+ Array [ "ws://127.0.0.1:4318/?token=8-cC4f_Ev09e" ]
```

读起来像"G-27 那道闸没拦住实时通道"，也就是**产品闸门失效**。实测它拦住了：

1. 应用的实时端点由 `buildRealtimeUrl` 生成（`packages/sync-client/src/realtime.ts:200`），
   形状固定是 `ws://<baseUrl>/api/sync/ws?token=…&clientId=…` —— **有路径、有 clientId**。
2. 红的那条是**根路径、没有 clientId**、令牌是 12 位随机串。
3. 主配置 `playwright.config.ts:87-88` 的 webServer 是
   `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port 4318` —— **dev 服务器**，
   它的 HMR 客户端每条页面都会开一条 `ws://127.0.0.1:4318/?token=…`。
   端口（4318 = 应用自己的 origin）+ 路径（`/`）两条都对得上，与产品无关。

⇒ 判据里的 `sockets` 是**来者不拒**的：`stubRecheck()` 的
`page.on('websocket', s => sockets.push(s.url()))`（原 `:89`）把 HMR 一起数了进去。

**更要命的是反方向**（这条是本体的收获）：同一个计数器还供着用例 4 的正向对照
`poll(sockets.length) > 0`（"确认之后实时通道真的重开"）。**在 dev 下它数到的那条握手就是 HMR**
⇒ 那句"不恒真"的承诺（spec 文件头 `:33-34` 白纸黑字写着「这一支里**不恒真**的出口判据是实时通道」）
在主配置下**是恒真的**（§7 元规则 2：一条永远通过的判据比没有判据更糟）。

**归属**：不是 B12 那种"别人在途的改动"，而是那条线**落地时自带的 standing 红** ——
他们的取证是**另一套配置**跑的：`playwright.legal-reconfirm.config.ts`（端口 4323 +
`pnpm --filter @heyta/web build` + `vite preview`，见文件头 `:11`），preview **没有 HMR**，
所以 `3503e256`（20:02:04 提交）交付时它是 **6 passed**，证据存在
`apps/web/evidence/legal-reconfirm-gate/run.txt` —— 那个文件里印的 socket 是
`ws://127.0.0.1:4323/api/sync/ws?token=E2E-TOKEN-123&clientId=cf1a5874-…`，**形状完全对得上第 1 条**。
同一份判据、两套配置、两个结论 ⇒ **spec 住在主配置的 `testDir` 里，而它的判据成立与否长在 webServer 上**。

**修法**（只动探针，一行的过滤器 + 常量）：`e2e/tests/legal-reconfirm-gate.spec.ts` 新增
`const REALTIME_WS_PATH = '/api/sync/ws'`，监听处改成
`if (new URL(s.url()).pathname === REALTIME_WS_PATH) sockets.push(s.url())`。

**修完这条判据的牙齿靠什么证明**（没有变异产品代码，靠同一个可观测量的两个方向各自成立）：
待补签时过滤后的计数是 **0**（用例 1 绿），确认之后它是 **>0**（用例 4 绿）——
同一个量、同一个过滤器，两个方向都数得到，所以两个都不是恒真。
而"HMR 会不会被误计"这一侧由修前的原始错误信息证明（它确实进过这个数组）。

### 红 2 —— `search-overlay.spec.ts` 贴顶判据 ⅱ 报 `padding-top 128 / 实测上隙 125.31800746917725`（差 2.682 > 容差 2）

**这条是我的**（#25 收口引入的时机变化）：这一组原先是 `page.goto(APP_URL)`，
收口 B9 家族时改成走共享入口 `openApp()`（它要先做完首启隐私同意、再把界面钉在中文）
⇒ 量几何的时机从"动画早已落位"挪进了"动画进行中"。

机制（不是猜，是量出来的）：`.ht-search-overlay` 自己挂着 `ht-sheet-in`
（`apps/web/src/styles/app/sheets.css:123`，`from { transform: translateY(+space-2) }`），
卡片另挂 `ht-material-in`（同文件 `:154`，`from { transform: translateY(-space-1) }`）。
**两条位移方向相反、时长与相位不同** ⇒ 中间帧的 `card.y - surface.y`
= `padding + 卡片位移 − 浮层位移`，与被约束的那个常量不是一个量。落位后差值归 0。

**修法**：新增 `settledGeometry(card, surface)` —— 连续两次取 `boundingBox()`，
两盒的 `y` 都动不了（< 0.01px）才算落位，40 轮还不停就**响亮地失败**；阈值 `≤ 2` 一个字节没改。
⚠️ 刻意不用 `document.getAnimations()`：页面上任何一条无关动画（骨架屏、番茄钟）
都会把等待拖成超时，症状又像"界面坏了"。这里要的可测性定义就是"要量的这两个盒子不动了"。

**变异复验（红→绿双向都跑了）**：把 `sheets.css:119` 的 `align-items: flex-start` 改成 `center` ⇒
`1 failed / EXIT=1`，错误行 **`padding-top 128 / 实测上隙 326`**（永久缺口，落位之后照样红 ⇒ 牙齿在）；
`git checkout -- apps/web/src/styles/app/sheets.css` 还原（已核 `:119` 回到 `flex-start`、
该文件 `git status` 干净）⇒ 再跑为绿。

### 同轮量过之后**没有采纳**的一处改动（写下来，因为它是"顺手改坏判据"的形状）

`privacy-consent-zero-egress.spec.ts:95` 有同一把未过滤的尺子，我一度按红 1 的形状把它也改成
"只数 `/api/sync/ws`"。量完两处事实之后**改回来了**：

1. 主配置 `playwright.config.ts:28` 有 `testIgnore: /privacy-consent-zero-egress\.spec\.ts/` ——
   它**不进全量套件**；
2. 收走它的是 `playwright.privacy-consent.config.ts`，那份用 `vite preview`（端口 4322）⇒ **没有 HMR**，
   它今天绿不是运气。

而这支判据的对象是**负向**的（"同意之前一个 WebSocket 都不许建"）：把它收成"只数某个路径"，
将来任何新增的 WS（厂商 SDK、协作通道）都会从计数里**隐身** —— 等于把一条负向判据改成恒真。
**两个方向需要两种过滤形状**：正向只认真端点（要证的是"那条通道真的重开"），
负向必须宽（要证的是"一个都不发"），只排掉可识别的开发期客户端。

📌 **可迁移的判据（两条）**：
1. **e2e 判据的可信度有一部分长在 webServer 上，不长在 spec 里。** 复用别人的 spec 前先问三句：
   这套 webServer 是 dev 还是 preview；它有没有自己会发网络/WS 的**开发期客户端**；
   这条判据是正向还是负向（它决定过滤器该宽还是该窄）。
2. **几何类判据的隐含前提是被测对象静止** —— CSS 入场动画让"元素出现"与"元素就位"是两个时刻，
   `toBeVisible()` 只保证前者。截图要等（本文件既有条目），量几何同样要等。

细节入档：`docs/reference/environment-traps.md` **#118**（WS 计数 × 配置身份）、
**#119**（动画中间帧量几何 + 变异复验）。

## 2026-10-02 21:19：我把**另一条会话未提交的 App.tsx 改动**提交进 main 了（自报，已回退）

### 发生了什么

我用一份自己写的 plumbing 提交脚本（`/tmp/heyta-mine-commit.sh`，"只提交我列出的那几个路径"）。
它对每个路径取的是**工作树内容**建 blob。`apps/web/src/App.tsx` 在我开工**之前**就是脏的
（另一条会话的 theme 持久化改动在里面），于是"工作树内容" = HEAD + **他们的两个 hunk** + 我的一行。
一次 `commit-tree` + `update-ref` 就把他们没打算提交的东西提交进了 main。

**它没有任何一处看起来像出错**：退出码 0、`--stat` 正常、提交信息是我写的。
唯一的信号是 `--stat` 里 App.tsx 那一行写着 **`13 ++-`**，而我预期的是 1 行。
是我自己因为"数字不对"去 `git show` 看了一眼，才发现的。

### 处置（全部只动分支指针与索引，**没有碰工作树一个字节**）

| 步 | 命令 | 结果 |
|---|---|---|
| 回退 | `git update-ref refs/heads/main <A> <B>`（CAS） | 坏提交 `0cec7047` 不在 HEAD 历史里（`merge-base --is-ancestor` 判否） |
| 修索引 | 我那 7 个路径的索引条目刷回 A 的 blob | `git diff -- App.tsx` 只剩他们的 `@@ -172` 与 `@@ -1703` |
| 重做 | 用 `git show HEAD:App.tsx` + **只打我那一行** 的临时文件建 blob，再走一遍 plumbing | `1898803d`：App.tsx `2 +-`（1 加 1 删） |
| 复核 | `git diff --cached --name-only \| wc -l` | 他们已暂存的 **29 条**一条没动 |

工作树里他们的两个 hunk **原样还在**（`rememberThemeChoice` 那处 26/4 也还在），
他们随时可以继续 `git add` 自己的东西。没有任何人的改动丢失。

### 🔴 一般规律（这条值得留下来）

**"只提交我列出的路径" ≠ "只提交我的改动"。** 路径级隔离在**共享工作树**里是假的粒度 ——
一个路径内部可以叠着两个会话的 hunk，而 `hash-object <工作树文件>` 把它们**一视同仁**。
⇒ 提交前的正确问题不是"我要提交哪几个文件"，而是
**"这几个文件在我开工之前脏不脏"**。开工时抓的那一份 `git status --porcelain`
就是回答它的唯一实物 —— 我手里一直有那份，**却没用它**。

### 已修的机制（不是"下次注意"）

1. `/tmp/heyta-predirty.txt`：开工前已脏的路径清单（16 条，取自本会话第一条 `git status`）。
2. `heyta-mine-commit.sh` 现在**先做归属检查再碰索引**：清单里的路径若没显式传
   `path=<base-blob>`，直接 exit 1，并把"它现在相对 HEAD 的未提交改动"（numstat）
   和该用的 base blob 一起打出来。已实测：拿 `apps/web/src/lib/theme.ts`（26/4 脏）试，
   脚本红着退出，`HEAD` 未变。
3. 提交后固定打印**别人已暂存的条目数** —— 那个数变了就是我带走了别人的东西。

### 请另一条会话核对一件事

`0cec7047` 在那 1 分钟里是 `refs/heads/main` 的指向。如果你们那段时间读过
`git diff HEAD -- apps/web/src/App.tsx`（或 `git status`），你们看到的会是
"**干净**"—— 那不是我留下的状态，现在已经是 `1898803d` + 你们的两个 hunk 在工作树里。
你们的 theme 改动**一行都没丢**，但也**一行都没提交** —— 请按原计划自己提交。

## B14. 🔴 当前树上的 **5 条红是"账号资料"那半件事的**，不是邮箱+口令这条线的（2026-10-03 01:20 取证）

现象（两条独立通道，同一个根）：

| 通道 | 红字 |
|---|---|
| `cd server && npx vitest run` | `magic-link-registration.spec.ts > Login magic-link requests > should consume a login token with a token-scoped atomic update`：session 的 `user` 多了 `avatarHash` / `displayName` / `locale` |
| `cd e2e && npx playwright test`（离线全量） | `admin-console.spec.ts` 4 条（:567 / :602 / :686 / :746），第一条的原文是 `除已登记缺失外不该有非 2xx：["/api/account/profile","/api/account/profile"]`，后面三条是它的连锁（面板压根没渲染出来）。数字：**96 passed / 2 skipped / 4 failed，EXIT=1** |

归属证据（不是推测）：

```
git grep -l accountProfile HEAD -- packages apps   →  空
工作树：packages/shared-schema/src/account-profile-contract.ts（新文件）
        packages/app-host/src/hosted-auth.ts:113 HOSTED_AUTH_PATHS.accountProfile
        server/src/auth.ts 里 `withAccountProfile` 命中 4 次，HEAD 里 0 次
```

⇒ 这是一件**正在做**的事（契约 + app-host 端口 + 服务端 store 三处都还没提交），
调用方在启动/头像菜单里发了 `GET /api/account/profile`，而 **e2e 那套假端点没有这一条**，
于是 `admin-console.spec.ts` 那条"除已登记缺失外不许有非 2xx"的自检把它抓出来了 ——
**那条判据在正常工作**，它抓到的是"新端点没同步进测试载体"。

闭口需要两样，都由做这件事的人补（我不顺手改，理由见
`docs/plans/email-password-auth.md` §12.5：同一批未提交源码正被另一个会话写）：

1. e2e 假端点补 `GET/PUT /api/account/profile` 的桩（或按 `KNOWN_MISSING` 那条纪律登记，
   但**登记要带理由**，见 `admin-console.spec.ts:545` 附近那三条出路）；
2. `magic-link-registration.spec.ts:524` 那条断言按新的 `user` 形状改，并写明为什么
   （"session 里带展示字段"是这次的目的，不是回归）。

同批对照：**邮箱+口令这条线自己的数是全绿的** —— server `tsc` exit 0、
`self-host-email-verification.spec.ts` 9/9、app-host 911、i18n 22、web 1431、
mobile 538、`verify:password-web` 真浏览器旅程 2 passed / exit 0。

---

## B15. ✅ **已解除**（2026-10-03 02:51，`/tmp/restore-run23.log`）🔴 批五的设备验收被**宿主机负载**卡住（2026-10-03 00:59–01:10 取证）—— 已把"环境不成立"和"产品红"分成两个退出码，还缺一个低负载窗口

**解除取证**：02:46–02:51 那一轮（run23）负载允许，**24 项全绿 / exit 0**，
上面"还欠的证据"四条全部补齐：② 后半（截断版走同一条文件路径仍被拒、一个字节没写）、
④a（还原后同步不落失败态 —— 并在此过程中发现**原判据断错了不变量**，改写见 traps #138）、
④b（还原后手机自己写的那条 op 20s 内出现在服务端）、以及 M1/M2 两条变异各
**14 绿 2 红**且红恰好落在被拿掉的那两步上。下面原诊断**逐字保留**，
因为"负载把 `uiautomator` 打成空文件"这件事仍然对所有设备验收脚本成立。

**现象（不是产品缺陷）**：本机 1 分钟负载在 18~81 之间起伏（16 核）时，
`uiautomator` 连续 10 次抓不到界面，`dump` 会把 `/tmp/ui.xml` **截成空文件**，
于是 `scripts/verify-mobile-restore.sh` 一轮报出 6–9 条"看起来各自独立"的红：
"选择器里没找到文件"、"找不到输入框：服务器地址"、"同步按钮既不空闲也不在忙"。
同一台机器上另有两条会话在跑重活（`ps` 里能看到别的仓库的 vitest）。

**已落地的机制**（都在 `scripts/verify-mobile-restore.sh` 里，不是"下次注意"）：

1. 开头 `wait_for_quiet_host`：负载 > 核数的 3/4 就等，等不到（默认 900s，
   可用 `HEYTA_RESTORE_LOAD_WAIT` 放宽）以 **exit 3** 结束 ——
   与 `require_screen` 同一个约定：**1 = 有断言失败，3 = 这轮在环境上不成立**。
2. UI 断言前 `require_screen`（判据逐屏找的那条路径）。
3. "谁在前台"只取 `mCurrentFocus` 一行，并把超时时的实际焦点打出来。
4. 滚动区间收到 `y ∈ [700, 1250]`：实测软键盘开着时 swipe 划过按键会把
   `GT GT GT … y` 打进正在聚焦的粘贴框（traps #126）。
5. 选择器路线"当前视图(Recent)"与"根菜单→Downloads"**两条都试**并打印实际走了哪条，
   失败分支先 `close_picker` 再报错（traps #125/#127）。

**已经证到的部分**（`/tmp/restore-run13.log`，00:06 那一轮，负载允许时跑的）：
判据① 三条全绿（入口在、两条路都在、垃圾内容被预检拒绝且说出人话）、
判据② 前半绿（选文件读出「任务 3 · 清单 1 · 标签 1 —— 共 5 条，5 条操作日志」→
确认 → "还原成功"）、判据③ 绿（任务列表 3/3）。截图落在
`apps/mobile/evidence/android-restore-{done,tasks}.png`。

**还欠的证据**（都需要一轮低负载跑，命令已就绪）：
② 后半（**截断版走选文件路径**同样被拒）、④a（备份 opId 出现在服务端，带分母、
轮询到命中或超时）、④b（还原后手机还能写还能推：出现备份里没有的新 opId）、
以及两条变异 M1/M2。⚠️ ④a 在 run13 也报过 `0/5`，那是**读太早**：
无 WebAssembly 时端到端密钥要纯 JS 逐批算，14 分钟后界面自己变成
"已全部上传 + 上次成功同步"（traps #129），现在改成轮询 + 打印等待秒数。

**归属（防误提交）**：本条线改动的路径是
`apps/mobile/src/screens/ExportScreen.tsx`、`apps/mobile/src/lib/local-file-read.ts`（新）、
`apps/mobile/android/app/src/main/java/com/heytamobile/fs/{LocalFsModule,LocalFsPackage}.kt`（新）、
`apps/mobile/android/app/src/main/java/com/heytamobile/MainApplication.kt`、
`apps/mobile/package.json`、`apps/mobile/ios/Podfile.lock` + `Pods/`、
`packages/i18n/src/locales/{zh-CN,en}.ts`、`packages/op-log/src/engine.ts`、
`scripts/verify-mobile-restore.sh`（新）、`e2e/restore-export.cjs`（新）、根 `package.json`
（**只加 `verify:mobile-restore` 那一行** —— 该文件另有别人已暂存的 hunk）。

**落地时的更正**（2026-10-03 提交那一刻逐 hunk 重数过）：上面这份清单里有**两条不是改动**——
`packages/op-log/src/engine.ts` 只被读过、没被改；`Pods/` 是 gitignore 的产物。
实际进提交的是：两个新 Kotlin 文件 + `MainApplication.kt`（2 hunk）+ `local-file-read.ts`（新）
+ `ExportScreen.tsx` + `apps/mobile/package.json`（1 行：`@react-native-documents/picker@12.0.2`，
MIT、未归档、末次提交 2026-07-28 ⇒ §3.1/§3.2 过）+ `Podfile.lock`（32 行纯新增，全属那个 pod）
+ `pnpm-lock.yaml`（14 行纯新增，在 `HEAD + 我的 package.json` 的隔离检出里
`pnpm install --lockfile-only` 生成，不含别的会话在锁上的 churn）
+ `packages/i18n/src/locales/{zh-CN,en}.ts`（**各只有 `mobile.restore.done` 那 1 行**）
+ `scripts/vite-rnw-resolve.{mjs,d.mts}` + `apps/desktop/vite.config.ts`（B16 第 3 项）
+ 本条线与 traps 的文档。

---

## B16. 两条**对所有会话成立**的验收栈事实 + 一条我顺手修掉但没修完的债（2026-10-03 01:35–01:50 取证）

### 1) 🔴 :3000 上那个 E2E 服务端是 **18:56 起的旧进程**，而 `server/dist` 是 **00:53** 重建的

症状：移动端新 APK 有账号级补签闸门（G-27），旧进程里**没有**
`/api/account/legal-consent`（实测 curl → 404），于是 `syncNow()` 一条 op 都不发，
`verify-mobile-restore` 判据④ 轮询满 300s 得到"服务端命中 0/5"——读起来像
"还原毒化了同步队列"，实际是栈自己的服务端比应用旧。
当前 dist 起来之后同一条请求回的是
`{"needsReconfirm":false,"reason":"not-applicable",…}`（本机 `PUBLIC_URL` 非官方域名 ⇒
不拦人，见 `server/src/legal-consent.ts` 第 3 条排除项）。

### 2) 🔴 E2E 库 `heyta_mobile_smoke` 之前**少两条迁移**，而这件事被旧进程掩盖着

`20261007000000_add_user_consent_history` / `20261008000000_add_account_profile` 未应用。
旧 Prisma client 不选 `users.display_name` ⇒ "建号成功 /health ok"全为真；
换成当前 dist 立刻 `P2022: The column users.display_name does not exist`。
我已用 `sh scripts/migrate-deploy.sh` 应用（两条含 CONCURRENTLY，不能用 `migrate deploy` 直跑；
需要 `PATH` 带 `research/tools/macos-sed-shim`，且**要显式 export `DATABASE_URL`** ——
`scripts/migrate-deploy.sh` 不读 `server/.env` 里那套）。

**给后来者**：跑设备验收前先确认这三份产物同代（APK mtime ≥ 源码 mtime、
服务端进程启动时间 ≥ dist mtime、`prisma migrate status` 无 pending）。
`verify-mobile-restore.sh` 现在开局自己探第 2 条（401=同代 / 404=旧 ⇒ `exit 3`），
别的脚本还没有这条。

### 3) 🟡 我修了桌面端构建，但**没把重复的那份删掉**（归属：桌面端那条线）

`scripts/vite-rnw-resolve.mjs` 之前用 `createRequire(import.meta.url)` 把解析锚在
`scripts/`（那里没有任何 node_modules 通道）⇒ `apps/desktop build` 从引入它那次提交起
**从来没成功过**（`MODULE_NOT_FOUND`，Vite 连配置都加载不完），而 `pnpm check` 不打包，
所以没有任何一条命令会因此失败。现在改成由调用方注入 `import.meta.url`，
`pnpm --filter @heyta/desktop build` 实测绿（`renderer-dist/assets/index-*.js` 出来了）。

🔴 **没收尾的那半**：`apps/web/vite.config.ts` 里仍然是它自己那份**内联副本**
（同一段别名/后缀/dedupe 逻辑），也就是说这个 helper 文件头承诺的
"两个 Vite 应用逐字相同"今天是**两份实现**，漂移只是没人去对。
按 §3.5 的教训，收尾动作是**把 web 那份换成 import 并删掉旧的**，
不是再写一份更好的。我没顺手做，因为 `apps/web` 那一整片此刻有别的会话未提交的改动。

---

## B17. 🔴 `reminders-panel.spec.tsx` 那条"超过每任务上限"是**全量跑才红**的探针 bug（2026-10-03 03:41 取证，归属：提醒那条线）

**症状**：`pnpm --filter @heyta/web test` 里 1 红，红在
`tests/reminders-panel.spec.tsx > B. … > 🔴 超过每任务上限时把错误显示出来，不静默吞掉`
（`waitFor` 超时，界面文本里 6 条提醒都画出来了、就是等不到那句错误）。
**单跑同一个文件 6/6 全绿。** 本机 `vm.loadavg` 当时 **39**。

**为什么我判定它不是产品红**：同一形状昨天在 R10 那条线上刚被钉死过一次 ——
`apps/web/tests/profile-panel.spec.tsx` 的两条头像用例用
"固定刷两次宏任务"去等一条 **≥3 个异步边界**的链，
load 59 时全量必红、单跑必过；改成"轮询到条件成立"（`waitUntil`，
等不到就把当前出站请求列出来）之后，load **105** 连跑两趟全绿。
提醒这条的 `waitFor` 也是"数固定次点击 + 等一个结果"，只是坏在另一处。
`61536ed3 test(web): 提醒上限用例的 8 次点击移进 act() —— flake 归因落地`
说明这条已经被归因过一轮，**但归因不等于修完**。

**我没有动它**，两个理由：
1. 该文件的所有者刚刚提交过一版针对它的改动，此刻很可能还在改（AGENTS 的并行会话纪律：
   别人在点的那套界面连判据文件都不要顺手改）；
2. 我的改动会落在**他们的** flake 归因之上，两边合起来看不出谁对。

**给所有者的一步修法**（照 `profile-panel.spec.tsx:87` 那个 `waitUntil` 抄即可）：
把"点 8 次然后等文本出现"改成"点 8 次 ⇒ `waitUntil('上限错误出现', …)`"，
超时消息里**打出当前界面文本**（现在这条已经在打了，保持）。
🔴 别改成"把 `waitFor` 的 timeout 调大"—— 那是把探针 bug 变成永久豁免。

---

## B18. 🔴 `pnpm check` 断在 `check:l4`，而**断点在本批开工之前就存在**（2026-10-03 04:08 实测）

> 编号说明：这一条登记时误用了 `B17`（与上面"reminders 探针全量跑才红"那条同号，那条是
> 03:41 落的）。**编号只增不改**，所以同号两件事必须拆开 —— 本条改号为 `B18`。

按"干净检出"跑收尾批的 `pnpm check`（`git worktree add --detach` + 先 `rm -rf packages/*/dist apps/*/dist`），
链断在第 12 段：

```
🔴 apps/mobile/src/screens（L4 视图）：内联样式 113 处 > 基线 90（多了 23 处）
```

**这不是本批造成的**，判据是实测不是推断 —— 同一道门禁跑在**本批开工前的那一笔**
（`ccd3cd83`，即 `HEAD~3`）上：

| 检出 | `apps/mobile/src/screens` 内联样式 | 基线 | 结论 |
|---|---|---|---|
| `ccd3cd83`（批五开工前） | **111** | 90 | 🔴 已红 21 处 |
| `771c35c9`（本批三笔之后） | 113 | 90 | 🔴 红 23 处（本批 +2） |

基线 90 是"M3 棘轮第四次"（`scripts/check-l4-no-style.mjs:161`）钉下的，之后有 21 处
新增内联样式进了移动端 screens 而没人重跑过这道门禁 —— 因为**本机有 dist、链断不到第 12 段**
（traps #147/#148 同一族）。

**归属**：这 21 处是 M3 样式迁移那条线的活（门禁自己的话："方向是让视图改用共享模式组件，
而不是继续在 features 里写内联样式"，且明写**不许为了变绿把基线调高**）。本批不动它。

本批那 +2 处在 `ExportScreen.tsx` 的还原卡上，写的是该文件**已有的**同一形式
（`<Card style={{ gap: tokens['space.3'] }}>`，文件里原有 4 处一模一样），
`Card` 内部默认 `gap: space.2`，所以去掉会改视觉。为不改视觉而消掉这 2 处需要把
`tokens` 从 hook 作用域搬到模块级 StyleSheet —— 那是 M3 的形状，留给那条线一次做完。

## B19. ✅ **已解除**（2026-10-03 04:31，对方跑完自己放了端口）🔴 4318/4319 被**另一条会话的 e2e**占着，本会话欠的两条浏览器验收因此没跑（04:30 取证）

**现场**（`lsof` + `ps`，不是我猜的）：

| 进程 | 是什么 | 启动 |
|---|---|---|
| `12704` | `node /private/tmp/heyta-g5/e2e/.../@playwright/test/cli.js test` | 04:21:35 |
| `12720` | `node stub-provider.mjs` → 监听 **4319** | 04:21:36 |
| `12722` | `pnpm --filter @heyta/web exec vite --port 4318 --strictPort` → 监听 **4318** | 04:21:36 |

它跑的是 `/private/tmp/heyta-g5` 那份**隔离检出**（源码是它的，端口是共享的）。

**为什么这就够了阻塞**：`e2e/playwright.config.ts` 那两条 `webServer` 是
`reuseExistingServer: false` —— 我这边一起跑就会**先 SIGKILL 它的 4318/4319 再占**，
也就是 traps #87 记过的那个形状（症状是对方的用例莫名红）。所以这不是"要不要等一下"，
是**不许跑**。

**本会话欠的两条**（都在等端口，不在等产品）：

1. **R9 尾巴**：`tests/narrow-sweep.spec.ts` + `tests/motivation.spec.ts`。
   这两份最后一次改动在 `3d481852`（"首启隐私同意的出路收进 openApp"），
   工作树里**已干净**（改动被那笔提交带走了），但**改完从没跑过**。
   `cd e2e && npx playwright test tests/narrow-sweep.spec.ts tests/motivation.spec.ts --reporter=list --retries=0`
2. **变异臂 L 复跑**：`e2e/tests/calendar-week.spec.ts` 最后一例在本批从"两档"改成
   "三档（月/周/时间线）"，臂 L 的归因串（`只有` / `档位下拉里出现了`）需要重验一次。
   `python3 /tmp/mutate-r11.py L` —— ⚠️ **电池没跑完不起第二趟**（traps #142）。

**本会话已经跑过的**（时间上早于对方启动，没有互相打断）：日历 e2e 家族 **16/16**
（含新增的 `calendar-view-family.spec.ts` 1 条 + 截图人看），以及
`apps/web` 全量 **1496 passed / 12 skipped / 0 未处理拒绝**。

**移动端那条不在这里欠**：`pnpm verify:mobile-calendar` 现在跑**测的是旧 APK**
（装的产物早于本批改 `packages/ui` —— traps #27 的原形状）。它的前置是 §6.1.1 的
`pnpm reinstall:all`，而那**不能在这个共用工作树里跑**（会动别人的未提交产物）。

### 解除（04:31）

**没有去动对方的进程** —— 是它自己跑完释放的。释放后两条都跑了：

| 欠账 | 命令 | 结果 |
|---|---|---|
| R9 尾巴（那两份 spec 自 `3d481852` 起从没跑过） | `npx playwright test tests/narrow-sweep.spec.ts tests/motivation.spec.ts` | **17/17 通过**（含"塌缩态扫描：日历/四象限/习惯/时间线/番茄钟/成长/便签/回收站"+ 搜索与设置浮层） |
| 臂 L 复跑（`calendar-week.spec.ts` 最后一例被本批改名/改期望） | `python3 /tmp/mutate-r11.py L` | **精确红且归因成功**：`档位下拉里出现了 4 项`，红条数=1，`restored=True` |

📌 这一条的价值不在"跑绿了"，在**它把"共享端口的 e2e 必须先量现场"这件事留下了现场**：
`reuseExistingServer: false` 意味着我一起跑就会 SIGKILL 别人的 webServer，
所以"能不能跑 e2e"的判据不是"有没有红"，而是**4318/4319 的持有者 PID 是谁家**。

## B20. 🔴 四份**未跟踪的生产者**被**已跟踪的消费者**importing —— 提交时漏一个就得到一个干净检出不上的仓库（2026-10-03 04:36 取证）

共享工作树里本会话**不 `git add`**（见 §B15/§B19 的归属纪律），所以新文件全部留在未跟踪态。
而消费者是**已跟踪且已修改**的。判据不是"看起来会断"，是逐条量过：

| 消费者（已跟踪，工作树里改了） | 它 import 的生产者（🔴 未跟踪） | 只提交消费者的后果 |
|---|---|---|
| `apps/web/src/App.tsx` | `features/calendar/CalendarHeaderToolbar.tsx`、`features/calendar/useCalendarLabels.ts`、`features/settings/ProfilePanel.tsx`、`features/settings/avatar-encode.ts` | `TS2307 Cannot find module` —— **整个 `@heyta/web` 构建不出来** |
| `packages/shared-schema/src/index.ts` | `src/account-profile-contract.ts` | 炸的是**所有** import `@heyta/shared-schema` 的包（op-log / storage / sync-client / 各壳） |
| `apps/web/src/features/calendar/CalendarView.tsx` | `features/calendar/useCalendarLabels.ts` | 同上，范围小一点 |
| `server/src/account/account-profile.routes.ts`（本身未跟踪） | —— | 它和 `packages/app-host/tests/hosted-account-profile.spec.ts` 是**同一批**，别只落一半 |

**取证命令**（HEAD 里那些引用**一条都不存在**，所以断点完全由"这笔提交带了哪些文件"决定）：

```bash
git show HEAD:apps/web/src/App.tsx | grep -c 'CalendarHeaderToolbar\|ProfilePanel'   # → 0
git show HEAD:packages/shared-schema/src/index.ts | grep -c account-profile-contract  # → 0
git status --porcelain --untracked-files=all | grep '^??' | grep -E 'src/|tests/'
```

这正是 traps **#147** 记过的形状（"消费者已提交、生产者在未提交的工作树里"在本机**永远绿**，
因为本机磁盘上有那份文件），只是这次不是 `dist` 掩护类型，而是**同一台机器上的未跟踪源文件**掩护构建。

### 分组清单（提交者按组收，别混）

- **日历线（R11 批一–批五，本会话）**：`CalendarHeaderToolbar.tsx`、`useCalendarLabels.ts`、
  `apps/web/tests/calendar-capture.spec.tsx`、`calendar-view-family.spec.tsx`、
  `e2e/tests/calendar-{cells,week,capture,view-family}.spec.ts`、
  `apps/web/evidence/calendar-{cells,week,capture,view-family}/`。
- **资料线（R10，两条会话都碰过）**：`packages/shared-schema/src/account-profile-contract.ts`、
  `apps/web/src/features/settings/{ProfilePanel.tsx,avatar-encode.ts}`、
  `server/src/account/account-profile.routes.ts`、
  `packages/app-host/tests/hosted-account-profile.spec.ts`、
  `apps/web/tests/{profile-panel,account-profile-entry}.spec.tsx`、`apps/web/evidence/profile-panel/`。
- **主题线**：`e2e/tests/theme-switch-contrast.spec.ts`（本会话）。
  ⚠️ `apps/web/tests/theme-boot-no-persist.spec.tsx` **不是本会话产出的**，归属另一条线。
- **图标/取证**：`apps/web/evidence/quadrant-icon/`（R12，本会话）；
  `apps/web/evidence/password-web-journey/` 那两张 **不是本会话的**。
- **弹层放置（R11 收尾顺带，本会话）**：`apps/web/evidence/due-editor-placement/`
  （README + 改前/改后两张）。源文件 `DueEditor.tsx` 与两份 spec **都是已跟踪的**，
  所以这一组只有证据目录是新的。
- **倒数纪念日线**：`docs/adr/0044-*`、`docs/plans/countdown-anniversary.md`、
  `docs/research/countdown-anniversary-data-and-images.md`（`check:docs` 那 7 条里有 3 条是它们）。

## B21. 🔴 多端覆盖批五**给 `check:l4` 的棘轮添了 2 处内联样式**（114 → 116，基线 90）—— 记账，不在收尾里顺手做（2026-10-03 05:04 实测）

`check:l4` 断言 C 数的是"含 `style={{` 的**行数**"（`scripts/check-l4-no-style.mjs:242`，
基线写在文件头，单位已钉死为行）。逐口径实测：

| 参照 | 门禁打印（跑出来的数） | `git grep -c -F 'style={{'` 原样 |
|---|---|---|
| `ccd3cd83` / `51d828c5^`（本批开工前） | **111**（B18 实跑） | **114** |
| HEAD `9a0ea6d5`（本批四笔之后） | **113**（`/tmp/rr-12.log`） | **116** |
| 门禁基线 | 90 | — |

🔴 **两个口径差 2–3 行，原因已定位**：门禁在数之前先 `stripComments()`
（`scripts/check-l4-no-style.mjs:378`），**注释里出现的 `style={{` 不算账** —— 纯 grep 会把它算进
116。所以**引用数字必须写明是哪个口径**：本条下面一律用**门禁打印的 111 → 113**，
delta 与 grep 口径的 114 → 116 **同为 +2**，结论不受口径影响。

🔴 门禁在本批开工**之前就是红的**（111 > 90，M3 那条线的账），但**本批确实又添了 2 处**：
`ExportScreen.tsx` 还原卡的 `<Card style={{ gap: tokens['space.3'] }}>`（与上方两张导出卡对齐）
和预览块的 `<View style={{ gap: tokens['space.2'] }}>`。

**为什么不顺手做掉**（三条都成立才停手，不是嫌麻烦）：

1. 消掉净增的**唯一零视觉代价**做法是把重复的 gap 字面量收成组件内命名常量 ——
   那只是把 `style={{` 从这一行挪到那一行，**棘轮数字变好而"视图不写样式"没有推进**，
   属于给判据化妆。
2. 真修法在**共享层**：`Card` 的默认 `gap` 已经是 `space.2`（`apps/mobile/src/ui/kit.tsx:550`），
   要么让视图不再传 `style`，要么给 `Card` 一个 `gap` 档位。那会动到**所有屏共用的**组件，
   改完必须重跑移动端截图判据 —— 不是收尾批该带的大小。
3. 现在动 `ExportScreen.tsx` 的布局，等于让已交付的 run23/run24 设备验收**测的是旧产物**
   （traps #27 的原形状），要补一次 `pnpm reinstall:mobile` + 一次 `verify:mobile-restore`。

**下一步（谁做都行，成本已量化）**：给 `Card` 加 `gap` 档位 → 把 `ExportScreen.tsx` 的 6 处
（本批 2 + 既有 4）全部换成 prop → 门禁打印的数从 **113** 降到 ≤109（一次消掉 4 处）。
**不许**改基线数字。

## B22. 🔴 `check:ai-e2e` 在提交态上 **3 failed / 98 passed**：我先前归因成"并发干扰"，**那条归因是错的，这里撤回** —— 真身是提交态落后于别人**未提交**的工作（2026-10-03 04:29 取证，05:16–05:19 低负载复跑）

跑的是隔离检出 `/tmp/heyta-g5`（HEAD `9a0ea6d5`，装完 dist、装完 `e2e` 依赖），
日志 `/tmp/rr-49.log`。三条红：

| spec | 失败形态 |
|---|---|
| `tests/due-date-edit.spec.ts:49` | `locator.click` 重试 60s 超时，`element is outside of the viewport`（`10月18日` 那一格） |
| `tests/motivation.spec.ts:184` | `日历 页的居中标题应当就是「日历」` —— 34 次重试读到的都是 `<h1>收集箱</h1>` |
| `tests/narrow-sweep.spec.ts:33` | 塌缩态扫描：日历（同一条视图切换） |

### ⚠️ 撤回：不是并发

我原本写"两条在两分钟后被另一条会话跑绿 ⇒ 是端口争用"。**低负载复跑把它证伪了**：
05:16–05:19，`--workers=1`、`:4318`/`:4319` **无监听者**、`loadavg 7.17 / 16 核（45%）`
—— **三条全部复现**（`15 passed / 3 failed`，`/tmp/g5-e2e-lowload.log`）。
并发确实存在（B19 记的那次是真的），但它**不是这三条红的原因**。

### 真身：提交态缺了别人工作树里还没提交的改动

同一批 spec 在**主树**（脏）跑绿：04:31 对方 B19 记的 `narrow-sweep` + `motivation` **17/17**、
04:58 `/tmp/e2e-full-r11b.log` 的 `due-date-edit` **5.1s 通过**。
而主树 `git status` 里恰好是这三条红的**责任面**全是 `M`（未提交）：

| 未提交文件 | numstat | 对应哪条红 |
|---|---|---|
| `apps/web/src/features/shell/view-tabs.ts` | +25 / −11 | 点 tab 不换视图（motivation:184、narrow-sweep 日历） |
| `apps/web/src/App.tsx` | +108 / −36 | 同上（视图切换的接线） |
| `apps/web/src/features/calendar/CalendarView.tsx` | +40 / −49 | 同上 |
| `apps/web/src/features/tasks/DueEditor.tsx` | +39 / −10 | `due-date-edit` 的弹层放置（对方 traps `150` 正是这条的判据） |

📌 与 traps **#147**（本机 `dist/` 掩护未提交的生产者）、**B20**（未跟踪的生产者被已跟踪的消费者
importing）同族，只是这次藏的是**行为**而不是文件：**"干净检出上红"不等于"红的那条线缺东西"，
也可能是别人已经修好但还没提交** —— 判据是去主树看那批文件是不是 `M`，一条 `git status` 就够。

### 不是本批引入的（已排除）

本批在 web 侧只改了 `packages/ui/src/date-picker/DatePicker.tsx` 的无障碍属性写法
（`accessibilityState` → `aria-selected`）。失败日志里那一行元素上
`aria-label="10月18日" aria-selected="false"` **两个属性都在** ⇒ 我的改动生效了，
而红的是它的**几何位置**，与属性写法无关。

### 欠的一步（命令写死，别用"改天"结掉）

等那条线把 `view-tabs.ts` / `App.tsx` / `DueEditor.tsx` 提交之后，在**干净检出**重跑：

```bash
lsof -nP -iTCP:4319 -sTCP:LISTEN        # 先确认端口持有者不是别人（B19 的判据）
cd e2e && npx playwright test tests/due-date-edit.spec.ts tests/motivation.spec.ts \
  tests/narrow-sweep.spec.ts --reporter=list --retries=0 --workers=1
```

**仍红**才轮到本条线（共享 `DatePicker` 的弹层放置）负责；在那之前改本批任何代码都是抢别人的活。



**🔴 07:5x 在当前 HEAD（`8b41648a`）的干净检出上复跑：仍然 3 failed / 98 passed，但归因可以从"提交态落后"升级到"点到文件"**

复跑环境：`/tmp/heyta-ios-ab` detached 到 `8b41648a`，先 `pnpm -r build`（`BUILD_EXIT=0`）再跑两段。
三条失败逐条对上了主工作树里**别人未提交**的文件（`git status --porcelain -- apps/web`）：

| 失败 | 断言的实际形态 | 正在被修的那个文件（未提交） |
|---|---|---|
| `due-date-edit.spec.ts:49` | `locator.click` 超时：日期格 `aria-label="10月18日"` **解析得到、但永远不"visible, enabled and stable"** ⇒ 弹层放置问题 | `apps/web/src/features/tasks/DueEditor.tsx`（未提交的那版在重写弹层放置几何，注释里**点名**这条 spec） |
| `motivation.spec.ts:184`（R9） | `.ht-header__title` 期望「日历」收到**「收集箱」** | `apps/web/src/App.tsx` + `features/shell/view-tabs.ts`（未提交 diff 里自己写着：日历是后加进 `MODULE_VIEW_TABS` 的、**没登记进那张标题回落表**） |
| `narrow-sweep.spec.ts:33`（日历） | 同上，同一个根因的第二处表现 | 同上 |
| `check:landing-e2e` | 仍然 **2 failed / 15 passed**（`docs-centre.spec.ts` 配图张数 / 反向对照） | B24 那条判据缺陷，未提交侧没有对应文件 —— 归因不变 |

📌 这条更新的价值在**把"等别人提交"变成可核对的三枚文件名**：下一位复跑时只要 `git status` 里这三枚不再脏，就应该期待 `check:ai-e2e` 转绿；如果它们已经提交而这条仍红，那 B22 的归因就被证伪，要重新查。

🔴 **2026-10-03 09:5x 复核（HEAD `c444d827`）：上面那句"预期转绿"的前提已经成立，而这一条还没重跑 —— 所以 B22 既没被证实也没被证伪，状态从"归因待定"改成"待重验"。**
三枚文件现已全部提交（`apps/web/src/App.tsx` 与 `apps/web/src/features/shell/view-tabs.ts` 在 `c0783d2f`，`apps/web/src/features/tasks/DueEditor.tsx` 在 `adb627cc`），`git status` 里它们都不再脏。
本轮没有跑 `check:ai-e2e`，两个原因写在 goal §7.10：同机 `vm.loadavg` 实测 80.64（那种负载下 Playwright 的读数没资格进台账），
且这道门禁的 preflight 会 SIGKILL 别的会话的 dev server（traps #87），而此刻别人正在 `packages/ui/src/calendar` 上写代码。
**下一位复跑时按两种结果分别处置，不要写成"应该已经好了"**：转绿 ⇒ B22 的归因成立，可直接关闭；
仍红 ⇒ 归因被证伪（"提交态落后于未提交的工作"这句到此为止），这 3 条要重新查它们本身。

✅ **10:04 补跑完成，B22 归因被证实 —— 关闭。** 隔离检出 `/tmp/heyta-g5` 先 `fetch && reset --hard` 到 main（`HEAD=0c171df1`、`dirty=0`），再 `pnpm install`（倒数日批次带了 `lunar-typescript`，不装就是旧代产物，traps #27）→ `pnpm -r build`（`BUILD=0`）→ `cd e2e && pnpm install` → 核过 `4318`/`4319` 监听数为 0 之后跑 `pnpm run test`（**绕开 `check:ai-e2e-preflight` 那句 SIGKILL**，traps #87；它只负责清端口，我自己核了端口就等于满足了它的前提）。
结果 **113 passed / 2 skipped / 0 failed，`E2E=0`**（5.5 分钟）。⇒ 那三条红确实是"提交态落后于未提交的工作"，随 `adb627cc`/`c0783d2f` 一起消失；既不是产品缺陷，也不是最初写的"并发干扰"。
分母从 101 涨到 115 是别条线新增的用例，与本轮无关。**这条不再有未闭合项。**
⚠️ 顺带一条**产品事实**（不是本条线的账，但值得被看见）：日历页页头会挂着上一个视图的象限名，这个缺陷在**已提交的 main** 上就存在，两位读者别把它读成"测试太挑"。
## B23. 🔴 `check:empty-state` 的两处红：一处是**判据缺陷**（已修），另一处是**别人那条线的新站点**（登记，不代改）（2026-10-03 05:27 取证）

### 已修的那处不是产品问题，是门禁把"照它自己的修法做"判成违规

`apps/mobile/src/screens/NotificationsScreen.tsx` 被记成"新的手写空态"，但它第 34 行
`import { EmptyState } from '@heyta/ui'`、第 194/252 行都是
`<EmptyState title={t('mobile.inbox.empty')} testID=… />` —— **这正是门禁自己给出的修法**
（报告原文："用共享的 `EmptyState`"）。marker 原来按"文件里出现过空态词条"记账，
于是"收编后的样子"和"又手写一份"在判据上长得一模一样，而红字指着共享组件那一行。
**一条让正确做法必然变红的判据，教的是别用共享组件。**

✅ 收紧：只数落在 `<EmptyState …>` 元素**之外**的空态词条渲染（按位置判，不按文件判）。
三份探针在 `HEYTA_CHECK_ROOT` 副本上实测（脚本文件头的 E4/E5/E6）：

| 探针 | 结果 |
|---|---|
| 手写 `<Text>{t('probe.list.empty')}</Text>` | **点名该文件**，新站点 1→2 ✅ 会红 |
| 只用 `<EmptyState title={t('probe.shared.empty')} … />` | **不点名**，新站点仍是基线数 ✅ 修法可达 |
| 同一文件里"共享组件 + 另写一处" | **点名该文件**，1→2 ✅ 没被整文件豁免 |

### 顺手按门禁自己的提示做了对账：登记表 26 → 24

收紧后门禁打印"有 2 个登记站点已消失 ⇒ 建议从 `EMPTY_SITES` 删掉"。
🔴 **删之前逐行看过渲染形状**，不是"看起来没问题"：
`apps/web/src/features/inbox/InboxBell.tsx:223` 与 `InviteActivityCard.tsx:145` 都是
共享 `EmptyState`（且该段登记注释**早就写着**"渲染已经收编"）—— 是 marker 太宽把它们错记着。
与文件里 `ListsSection` / `TagsSection` 那次移除是同一个动作。
⚠️ **债没有消失**：面板级空态"长得像页面级"那个缺口仍挂在 `site-and-parity-alignment.md` 的欠账上。

### 剩下的那处不是本条线的

`apps/mobile/src/screens/SecurityScreen.tsx:272` 的
`<Text variant="row-meta" tone="subtle">{t('mobile.security.passkeys.empty')}</Text>`
—— 该屏由 `804842be`（「账号与安全」屏，2026-10-02 23:28）引入，**不属于多端覆盖这五批**。
两条正当出路（**由那条线选，不要为了变绿加 `EMPTY_SITES` 一行**，那等于把债合法化）：

1. 换成共享 `EmptyState` —— 但它是**设置卡片里的一行占位**，共享实现是页面级
   （居中 + 上下 64px），换过去是**视觉回归**；
2. 若确实需要"区块级空态"，正确动作是**先给它加一档**（`size?: 'page' | 'section'`，
   与 `NotesBoard` / `ReminderList` 记的是同一个缺口），再让这两处都消费它。

**现状**：`check:empty-state` 从 2 处红降到 1 处红，仍红 ⇒ `pnpm check` 仍断不到后面。
本条不代改别人的屏。

## B24. 🔴 `check:landing-e2e` 那 2 处红是**判据断在一个没人实现过的目录名上**（文档中心那条线；2026-10-03 05:30 取证）

症状（`/tmp/rr-51.log`，15 passed / 2 failed）：`landing/docs-centre.spec.ts:959` 与 `:1013`
都红在 `first-run：指向复制品的 <img> 数必须等于配图数`，`Expected: 1 / Received: 0`。
🔴 **同一条用例里前一个断言（页面上 `.lp-figure` 的张数）是过的** —— 图在页面上，
只是 `<img>` 的 src 前缀对不上。

### 两边各说什么（逐行取证，不是猜）

| 侧 | 事实 |
|---|---|
| 判据 | `e2e/landing/docs-centre.spec.ts:950` 数的是 `#main img[src^="/assets/docs/"]`；`:993`/`:1054` 断言 src 逐字等于 `/assets/docs/<id>/<file>` |
| 产物 | 复制品住在 `apps/landing/public/assets/help/`，由 `apps/landing/scripts/gen-help-figures.mjs` 生成、`apps/landing/src/site/helpFigures.ts` 渲染 ⇒ 页面上是 `/assets/help/…` |
| 提交态目录 | `git ls-tree -d HEAD apps/landing/public/assets/` **只有 `help`**，没有 `docs` |
| 来处 | `f82ace65`（10-02 08:46「帮助中心迁到 /docs 文档站形态」）把页面 `apps/landing/help/ → docs/` 整体搬了，**图片目录没跟着搬** |

⇒ 这两条红**不是环境、不是并发、也不是本条线**：判据断的是"目录也叫 docs 了"这个**尚未发生**的布局。

📌 最扎心的是这件事**早就被预言过**：`apps/landing/src/site/helpFigures.ts:217-218` 原文写着
"`public/assets/help/` 这条规则有四处表达（映射、生成器、渲染器、孤儿检查），
而'把 `assets/help` 改名'这种活只需要改一处就能让另外三处悄悄断掉"。
**现在是第五处（e2e 判据）单独改了名** —— 同一条规律的反方向发作。

### 两条正当出路（由那条线选）

1. **搬产物**：`public/assets/help/ → docs/` + 同步那四处表达 + 重跑 `check:entries`
   （落地页产物是逐字节对账的，75 份入口会变）；
2. **改判据回到现实**：spec 里的 `/assets/docs/` 前缀改回 `/assets/help/`，
   并把"页面在 `/docs/` 而图在 `/assets/help/`"这条不一致**显式写进注释**（否则下一次还会有人改一半）。

⚠️ 不要"为了让套件绿"随便挑一条：选 1 会改线上 URL，选 2 要承认布局不一致。
**本条不代改。**

📊 **10:04 补一条只属于证据的东西（不是选择，也不是代改）**：出路 2 我**试过并量过**，只为了把那条线缺的那块信息补上 ——
在隔离检出里把 spec 那三处字面改回 `/assets/help/` 后，`docs-centre.spec.ts` 从 **15 passed / 2 failed** 变到 **17 passed / 0 failed，`PLAYWRIGHT=0`**（1.2 分钟，`LANDING_BUILD=0`）。
同时浏览器里的 DBG 行给出现场事实：页面渲染出来的 src 是 `/assets/help/first-run/W01-tasks.png`，且 `mainImgs` 与配图张数相等 —— **图在访客面前是好的**，红的只有判据那个前缀字面。
🔴 改完我**把主工作树的改动撤回了**（`git checkout -- e2e/landing/docs-centre.spec.ts`，撤回后与 HEAD 逐字节相同），因为选 2 等于替那条线承认"页面在 `/docs` 而图在 `/assets/help`"是长期形态，而选 1 会改线上 URL 并要求重跑 `check:entries`（75 份入口产物逐字节对账）。**这是产品决定，不该由我这个要绿的 Goal 替它做。** 边界原句（"不要为了让套件绿随便挑一条"）写在上面，仍然有效。

### ✅ B24 关闭（2026-10-03 12:0x，提交 `e446e54e`）：产品负责人把这道选择交给我了，于是它不再是"替别人拍板"

上面那句"不该由我替它做"在**当时**是对的，而**授权条件变了**：产品负责人 2026-10-03 明确说
「你来想办法跳过阻塞，或者说解决阻塞。我授权你来解决阻塞。你可以从产品的角度去考虑这个问题，
从产品的角度考虑哪一个设计更加合理，然后呢去采用这个设计。」—— 于是这条决定有了主语，
本条的"由那条线选"由**产品负责人本人**接下，不是我这个要绿的 Goal 自作。
**边界规则本身不撤**：下一次再出现"两条出路各有代价且代价落在别人面上"，仍然要先有主语。

选 **出路 1（搬产物）**，产品理由只有一条：用户可见的 URL 跟着页面走。
出路 2 不是"回到现实"，是把一次**没搬完的迁移**追认成长期形态 —— 页面在 `/docs/`、图在 `/assets/help/`
这个不一致没有任何一处文档为它论证过，它只是 `f82ace65` 漏掉的那一半。

🔴 **上面那条代价估计被实测否证了，留在这里是因为它错得很有代表性**：
"要同步那四处表达 + 75 份入口产物逐字节对账会变大改动" —— 真实改动是**一行常量** + 一次 `git mv`。
四处表达早被收成一处（`helpFigures.ts` 里 `ON_DISK_PREFIX` 由 `URL_PREFIX` 派生，
生成器与孤儿扫描 import 同一处），而入口 HTML 里**根本不含配图 URL** ⇒ `check:entries`
exit 0、75 份产物一字未变。**代价估计写的是"当初那个形状"的账，不是现在这棵树的账** ——
一条写在文档里的成本，保质期等于最后一次重构。

实测读数（载体：隔离检出 `/tmp/heyta-g5`，工作树与主检出该文件逐字节相同，`cmp` 判等）：

| 判据 | 读数 |
|---|---|
| `gen-help-figures --check` | exit 0（10 张复制品与映射一致） |
| 变异：前缀改回 `/assets/help` | exit 1「缺少复制品 … 10 处与映射不一致」 |
| `check:landing-e2e`（正常态） | **17 passed / 0 failed**（改前在同一棵树上 15/2） |
| 🔴 变异：前缀改成坏的 `/assets/doc` | **2 failed / 15 passed / `MUT_INNER_EXIT=1`**，红的正是 `docs-centre.spec.ts:959`（五张配图真的挂在指定分区上）与 `:1013`（反向对照）—— **与原 B24 那两处红逐字同名同号**。⇒ 那两条判据对这个常量真的有牙齿，而"牙齿的形状"就是回到这处红 |
| `check:entries` | exit 0（入口文件与注册表一致，75 份） |
| `@heyta/landing` typecheck | exit 0 |

⚠️ 变异臂的量法记一笔：坏前缀那一趟每条配图用例要**等满 1.5 分钟**（图 404 ⇒ `naturalWidth` 等到超时），
所以整趟 7 分钟，比正常态的 1.2 分钟长得多 —— 这不是探针坏了，**"变慢"本身就是那两条判据在等它们唯一认的东西**。
变异结束后已把常量还原（`RESTORED_LINE=232:const URL_PREFIX = '/assets/docs';`，并与主检出 `cmp` 判等）。

## B25. 🔴 本文件（`BLOCKED.md`）在**索引里**的那份是 1508 行的旧版，只到 B10 —— 谁按当前暂存条目提交，会抹掉 HEAD 里已有的 10 段（到 B24，2026-10-03 06:30 取证）

**取证**（三个源各量一次，不看 `git status` 的 `M` 就发现不了）：

| 源 | 行数 | 最后一个 `## B` | 有 `^## B23\.` 吗 |
|---|---|---|---|
| `git show HEAD:BLOCKED.md` | 2158 | B24 | ✅ |
| `git show :BLOCKED.md`（**暂存**） | **1508** | **B10** | ❌ |
| 工作树 | 2259 | B24 | ✅ |

也就是说：暂存条目比 HEAD 少 **650 行**，而少的恰好是**那次 add 之后陆续提交进来的**段落（别的条线的和本条线的都有）。
`git status` 只会告诉人"这文件已暂存且改动"（`MM`），**不会**告诉人是往旧方向改。
一次 `git commit`（不带 `add`）就会把这 14 段从 HEAD 里删掉，而提交信息里不会有任何痕迹。

**成因**（不是谁的错，是共享工作树的结构性形状）：那条会话 `git add BLOCKED.md` 时
HEAD 里还没有 B11；之后本文件被其他会话推进过多次。`git add` 记的是**那一刻的工作树**，
而它比对的是**那一刻的 HEAD** —— HEAD 后来动了，暂存条目不会跟着动，也不会报警。

## B26. 🔴 ios 段在**长活的隔离检出**上重装不出来：兜底补好后，旧树里 `pod install` 自己崩 —— 换新克隆 4.9 秒解决（2026-10-03 06:45–06:58 实测）

**发生了什么**：`c7f0e33a` + `d25161ce` 改了 `packages/ui` ⇒ 按 §6.1.1 三端要重打重装。
`bash scripts/reinstall-all.sh --only mac,ios,windows`（`/tmp/heyta-g5`）结果 mac ✅ / windows ✅ / **ios 🔴**。

**为什么以前不红**：ios 段以前**一个字都没提 pod**（`grep -n 'pod ' scripts/reinstall-all.sh` 命中 0），
它默认沙盒是好的。而 `apps/mobile/ios/Pods/` 是 gitignored 的 —— 隔离检出换一次 HEAD，
`Pods/Manifest.lock` 与 `Podfile.lock` 就对不上（实测差 `hermes-engine` + `ReactCodegen` 两行 `SPEC CHECKSUMS`），
xcodebuild 第一步 `[CP] Check Pods Manifest.lock` 就死。**失败信息只说"构建失败 + 日志末尾"**，
读起来像产品坏了，实际缺的是构建输入。

**已修的部分**（`840effb1`）：进 xcodebuild 前比两个 lock 的 sha256，不一致就跑 `pod install`，
装完再验一次；仍不同步就**跳过 xcodebuild** 并且**不再 tail 上一轮的构建日志**。
这条兜底"能红"的证据是现场跑出来的（`/tmp/g5-ri-ios2.log`）：它打印了中止原因，
而不是给人一份旧日志的尾巴。

**没修的部分（本条登记的债）**：旧树里 `pod install` 本身崩在 CocoaPods 1.17.0 + Ruby 4.0.7 的
`ArgumentError - path name contains null byte`（`project.rb:452`，崩在 "Generating Pods project"）。
`rm -rf Pods` 无效；`node scripts/check-native-deps.mjs` ✅（不是 lock 与 package.json 不一致）。
**A/B 排除了路径**：同一个 commit `840effb1` 现开新克隆，`/tmp/heyta-ios-ab` 与
`/Users/rocalight/heyta-ios-ri` 两处 `pod install` **都 exit 0**（`git clone` + `pnpm install` 只要 4.4–4.9 秒）
⇒ 变量是那棵**长活的旧树**，不是 `/tmp`。ios 判据最后在新克隆上取的：
`REINSTALL_EXIT=0`、新鲜度 ✅、主蓝 **4136**（与改动前同一个数），截图人看过（首启隐私同意面板 + 真中文）。

⚠️ **未定位**：具体哪个路径让 `realdirpath` 拿到 NUL 没查到（要扫 1.9 GB 的文件名）。
上游 CocoaPods #12798 / #12866 都还 open。**别照"旧检出重试一次"行动** —— 直接换新克隆。
一般规律与"包管理器自己的 up-to-date 不能当排除证据"写在 traps **#154**。

## B27. 🔴 B18 那句"剩的 17 处全部属 M3"是错的 —— 其中 **10 处是本条线批四欠的**；而且**把它们清完门禁也不会绿**（107 − 10 = 97 > 基线 90）（2026-10-03 07:08 逐条 blame）

**取证**（gate 口径：整文件剥注释后数 `style={{`；不是 `grep -c`）：

- 当前 HEAD 上 24 个屏共 **107** 处，基线 90。
- `apps/mobile/src/screens/SecurityScreen.tsx` 的 **10** 处，`git blame --line-porcelain` 逐行数：**全部**来自同一笔 `804842be`（804842be_feat(mobile): 「账号与安全」屏 —— 手机上第一次能改登录密码、管理通行密钥）—— 而那笔就是**本 goal 的批四**（§7 第四行）。
- 对照：`NotificationsScreen.tsx` 的 11 处全部来自 `896d6c74`（10-02 17:36，前一条会话的 mobile-ios 收口），**不是**本 goal 的批二 —— 同一条屏"被本 goal 用过"不等于"本 goal 写的"。

🔴 **所以 B18 的归因要改两处**：

1. "剩的 17 处全部属 M3" —— 不成立。超线部分里有 10 处是本条线自己添的（批四新建屏时
   直接写了内联 `gap` / `flexDirection`）。
2. 但**清完本条线这 10 处也不会让 `check:l4` 变绿**：107 − 10 = 97，
   仍 > 基线 90。这条算术必须写在账上 —— 否则"我把自己的账清了"会被读成"门禁该绿了"，
   而下一位读者会在这里找一个不会出现的绿。

**本条登记的动作**（本条线自己做，不摊给别人）：把那 10 处换成共享组件的 prop ——
`Stack` 的 `GapTier` 补 `'tight'`（= `space.1`，默认值不变 ⇒ 现有调用方零影响）、
新增横向 `HStack`（`flexDirection: row` + 同一套 `gap` 档 + `align`），`Text` 补 `grow?: boolean`
（就是那三处 `style={{ flex: 1 }}`）。判据沿用 B21 那套：**带默认值的可选 prop ⇒ 其余消费者逐字节不变**，
改完在 `check:l4` 上量数、跑 `@heyta/mobile` 测试 + typecheck，再重装 android 重跑
`verify-mobile-account`（它驱动的就是这一屏）并对比主蓝命中数。

⚠️ 唯一没被这套抽象盖住的是 `NotificationsScreen.tsx:298` 的 `alignSelf: 'flex-start'`（别人那条线的，
本条不代改）。

**还账实测（2026-10-03 07:2x，`bb41e9fe` + `6997592c` + `6834b4ae`）**：

- 10 处里清掉 **9** 处，留 1 处（passkeys 列表项的"子卡表面"：`gap` + `backgroundColor: color.surface-sunken`
  + `radius.md` + `padding` 四件事一起 —— 那是视觉表面不是布局意图，为消一处内联去给共享层发明第二处没人用的 API 不划算）。
- `check:l4` 现量：apps/mobile/src/screens 内联样式 **98** 处 > 基线 90（多 8 处）。
  🔴 **本条上面那句"107 − 10 = 97"是预测，实测是 98** —— 差的 1 就是留着那处。门禁**仍然红**，
  剩的 8 处按本条的 blame 归 M3 那条线；本条线不再欠账。
- 零视觉代价三条数字（全部现抽，不手抄）：android 重装后启动屏主蓝命中 **4036**、1080x2400、内容占比 55.4% —— 与 `d25161ce` 那轮逐项相同；
  这一屏的两张证据图聚合值也逐项相同（通行密钥屏 主蓝 8425 / 内容 8.1%，改密成功态 主蓝 9254 / 内容 9.2%，两张人都看过）；
  `verify-mobile-account` 在重装后的包上 **通过 13 项 / 失败 0 项**。
- ⚠️ **一条覆盖边界，别把"零视觉代价"读过头**：`HStack` 与 `Text grow` 只出现在**通行密钥列表行**里，
  而移动端没有 WebAuthn 桥 ⇒ 这一屏在设备上**永远是空态**，那两样改动的像素**没有任何设备证据**。
  设备证据盖住的只有 `Stack` 的三档 `gap`。列表行这边只有代码级等价（`HStack` 渲染出的对象就是原来那个
  `{flexDirection: row, gap: space.2, alignItems: center}`）+ typecheck + `@heyta/mobile` 测试。
  要取证得先在 web 端给同一个账号注册一枚通行密钥 —— 登记，不在本条线顺手做。

## B28. 🔴 用「HEAD 基 blob」提交共享台账 = **磁盘副本被永久落下**：下一次别人整文件 `git add` 会把我已提交的段落抹掉（2026-10-03 07:30 现量）

本条线的提交器（plumbing：临时索引 + `commit-tree`）刻意**只碰索引、不碰工作树**，为的是不带走并行会话的 hunk。
代价是：blob 从 `git show HEAD:<file>` 出发拼，写完提交后**磁盘上那份还是旧的**，而 `git status` 会把它显示成"我改的"。
B25 记的是同一件事的**索引**面目，这次量到的是**工作树**：

| 文件 | HEAD | 磁盘 | 磁盘上最大段号 |
|---|---|---|---|
| `BLOCKED.md` | 2277 行（到 B27） | 2259 行（到 B24） | **B24 —— 我提交的 B25/B26/B27 三段在磁盘上根本不存在** |
| `docs/plans/goal-multi-end-coverage.md` | 139 行 | 112 行 | 差 27 行（§7.1 整段） |
| `docs/reference/environment-traps.md` | 3785 行（最大 #154） | 4054 行（最大 #154） | 磁盘**更长** —— 里面是别人未提交的内容，不是我的旧版 |

🔴 **后果不是"文件不好看"，是内容会丢**：并行会话拿着磁盘那份继续写、然后整文件 `git add` + commit，
HEAD 里我的 B25–B27 与 goal §7.1 就**从历史上消失**（他们的提交不会报错，因为 git 只看"磁盘 vs 索引"）。
索引那份更糟：`git show :BLOCKED.md` 只有 1508 行、最大到 B10（B25 记的就是它，仍然没被那个会话提交）。

**本条做的两件事**（都不动别人的内容）：

1. 提交仍走 HEAD 基 blob（保证 HEAD 是对的）；
2. **提交后把同样的段落追加进磁盘那份**（纯追加：磁盘里没有 B25/B26/B27 才追加，有就跳过），
   让"下一次整文件 add"带走的是包含我这段的版本。这一步是**幂等**的，判据是追加前后磁盘的段落计数。

📌 一般规律：**只要一个提交流程"不写工作树"，它就在制造"提交态领先于磁盘态"的窗口**，
而这个窗口的关闭取决于**下一个写这个文件的人是否整文件覆盖**。共享判决/共享台账的单一所有者
要做的不是"提交完就走"，而是"提交完把同一份事实送回磁盘"。

## B29. 🔴 `check:docs` 在共享工作树里新红（57 段链的第 4 段），但**同一枚提交在干净检出上 exit 0** —— 红的是别人未提交的链接行 × 还没 `git add` 的目标文档（2026-10-03 08:4x 现量）

`pnpm check:docs`（`research/tools/docs-link-check.mjs`）在 `0acc7a71` 的工作树上 exit 1，报
**2 处失效章节引用 + 7 处"本机有、仓库里没有"的链接**。这**不在** goal §7.2 那 4 段红的清单里，
也不在 §7.4「两轮 57 段红段集合逐字相同」的清单里 ⇒ 先按纪律做归因，再决定修不修。

| 问 | 命令 | 读数 |
|---|---|---|
| 这红是我引进的吗？ | 看命中的文件 | 报出来的 9 行分布在 `docs/plans/README.md:110`、`goal-layout-audit.md:80,81`、`ui-review-fill-zh-timeline.md:2195/2344/2508`、`adr/0044:111/129` —— **本波一个都没碰**（本波只改 `multi-end-entry-coverage-audit.md` / `goal-multi-end-coverage.md` / 2 枚证据图） |
| 链接行是**已提交**的还是**未提交**的？ | `git show HEAD:docs/plans/README.md \| sed -n '110p'` / `git show HEAD:docs/plans/goal-layout-audit.md \| sed -n '80,81p'` | 前者**空行**，后者是"写路径/setDescription"那段，**不是报出来的那句** ⇒ 链接行活在**工作树**里，不在提交里 |
| 干净检出（CI 的唯一形态）上红不红？ | `cd /tmp/heyta-ios-ab`（detached `57b0780f`）`node research/tools/docs-link-check.mjs` | **`CLEAN_DOCS_EXIT=0`**，打印「✅ 无死链、无"本机有仓库里没有"的链接、无失效章节引用、无失效锚点」 |
| 那 3 枚目标文档到底存不存在？ | 逐枚 `git ls-files --error-unmatch` | `docs/plans/countdown-anniversary.md` / `docs/adr/0044-*.md` / `docs/research/countdown-anniversary-data-and-images.md` = **磁盘在、git 没跟踪**（倒数纪念日那条线，项目台账记着 D1/D2/D3 未拍） |

⇒ 结论：**HEAD 是干净的，红只在这台机器的混合工作树上成立**。形状是「一条线的链接改动还没提交、
它指向的文档也还没提交」，门禁按设计在提交前把它照出来 —— 这正是那条线**自己的**待办，不是缺陷。

**关闭判据**（可执行，归他们）：在主工作树跑 `node research/tools/docs-link-check.mjs` 得 exit 0，
即三枚目标文档 `git add`（或把指向它们的链接改成纯文字），并把 `adr/0044:111/129` 指向 ADR 索引（`docs/adr/README.md` 那份）的
那个章节号（它写作 §1，而该文件里根本没有 §1）换成真实存在的编号。**我不代改**：两种改法都在动他们的范围
（要么把他们的未跟踪文档塞进我的提交，要么删他们刚写的链接），且 ADR-0044 的结论归那条线拍。

📌 顺带两条现量（都属"台账要带时刻"的同族）：

1. **索引里那份 `BLOCKED.md` 仍是 1507 行、最大到 B10**（B25 当时记 1508 行 —— 差 1 行，
   说明这期间他们动过一点点，但**没有追上 HEAD 的 2333 行**）。危险不变：谁按当前暂存条目
   提交 `BLOCKED.md`，HEAD 里 B11–B28 整段会消失且**不报错**。
2. **`server/src/auth.ts` 此刻也在别人的暂存里**，而那正是 goal §7.5 的 JWT_SECRET 分析读的
   文件（`getJwtSecret()` 跑在模块顶层 `:48`）。他们若把那次调用挪进函数体内，我这批补的
   4 个 `vi.hoisted` 块就变成冗余（无害，但"承重"这个结论要重测）。下一个接手的人请先
   `git log -1 -- server/src/auth.ts` 再引用 §7.5 那张表。

🔴 **本条上面那句"HEAD 是干净的"已被我自己推翻**（写下约 10 分钟后，2026-10-03 08:5x）：
"关闭判据"那行里**转述别人坏引用**时写的 `docs/adr/README.md` 后面紧跟 `§1` ——
描述坏引用的那句话自己就是一处坏引用。干净检出 `/tmp/heyta-ios-ab` 复跑到 `d86f0439`：
`BLOCKED.md:2352 -> docs/adr/README.md ⇒ §1`、exit 1（那 7 处"本机有仓库没有"确实没进来，
因为它们活在未提交的工作树里，这部分结论不变）。

⇒ 结论的范围要收窄：`57b0780f` 那趟 exit 0 成立，但**从 `4a06d0fd` 起 HEAD 上多了我自己这一处**。
已把那句改写成不触发 `SECTION_REF_RE` 的形状（判据见 traps #158 末段）。
教训：**归因跑完不等于归因结束 —— 引用别人的坏引用时要转述成门禁认不出的形状，
并且写完立刻在干净检出上复跑同一条命令**，上一秒的 exit 0 不担保下一句写完还是 0。

## B30. 🔴 本 Goal（多端入口覆盖 · P0+P1 补齐）的收尾条件「`pnpm check` 全量绿」被两段**不在本条线手里**的红挡着，逐条写清要闭合得付出什么，以及为什么这一轮没有付（2026-10-03 10:0x 取证，HEAD `3e5cef9b`）

批五与收尾批的其他条件都已达成（还原卡 JSX、设备判据 26/0 且两条变异臂各重证一趟、四端重装、按归属纪律提交）。
只剩 `check` 链的这两段。它们都不是"再跑一遍就好"的东西：

| 段 | 现量（`3e5cef9b`，活树==HEAD 且本条线零脏文件） | 归属 | 要闭合得做什么 | 这一轮为什么没做 |
|---|---|---|---|---|
| `check:l4` | `apps/mobile/src/screens` 内联样式 **98 > 基线 90**（多 8 处，分布在 12 个屏文件里；`apps/web/src/features` 98 ≤ 104 是过的） | **M3 的账（B18）** | 按门禁自己给的方向"视图改用共享模式组件（`ListSurface` / `TaskRow` / `EmptyState`…）"做迁移，**并逐屏在设备上取改前/改后图**（本仓库的零视觉判据：同屏主蓝命中数改前后相等） | 这 8 处不是 8 行独立样式，而是"12 个屏只迁了一半"的余量。随手挑 8 处凑计数器 = 把 M3 的设计口径（哪个屏该用哪个共享件）替它定掉，还会把视觉风险铺满 12 个屏，而一次收尾批给不了 12 次逐屏设备取证。**这不是收尾，是一次独立批次。** 🔴 放宽基线（90→98）被明确禁止，也没有做 |
| `check:landing-e2e` | 实跑 **15 passed / 2 failed / `PLAYWRIGHT=1`**，与上一轮读数逐字相同 | **文档中心那条线（B24）** | 二选一：① `public/assets/help/ → docs/` + 同步 `helpFigures.ts` 那四处表达 + 重跑 `check:entries`（**会改线上 URL**，75 份入口产物逐字节对账）；② 把 spec 三处字面改回 `/assets/help/`（等于承认"页面在 `/docs` 而图在 `/assets/help`"是长期形态） | B24 本体写着"两条正当出路（**由那条线选**）… ⚠️ 不要'为了让套件绿'随便挑一条 … 本条不代改"。②我实测过效果（17/0，只作为证据写进 B24），但选它就是把别人的产品决定替它做了。我把自己的改动撤回了 |

🔴 **这条登记的价值在于把"做不到"说成有形状的事**：本 Goal 的 ③ 不是一个可以被"再努力一点"消掉的口号，
而是两段各有归属、各有代价、且都需要**产品口径**的红。硬约束（不放宽基线、不改别人的判据、不吸收别人的债凑绿）
与 ③ 在这里是**真冲突**，不是借口 —— 冲突时按硬约束，于是 `pnpm check` 全量绿这一条如实记未达成，
**Goal 不标 complete**。

要推动它，需要产品负责人二选一地拍：
- 让 **M3** 把 `apps/mobile/src/screens` 剩下的内联样式做完（我可以接，但要按一次独立批次排：设计口径 + 逐屏设备取证）；
- 让 **文档中心那条线**在 B24 的两条出路里选一条（我可以照选定的那条执行，但选择本身不该由我替它做）。

取证（下面这几个日志在 /tmp，会被同机会话扫走 —— 表内的读数本身就是副本，traps #159）：`/tmp/g5-l4-now.log`（l4 两段现量）、`/tmp/g5-ai-e2e/chain.log` + `S6-e2e.log`（ai-e2e 113/2/0 全绿，`E2E=0`）、
`/tmp/g5-ai-e2e/landing-e2e-{pre,post}.log`（改前 15/2、把字面对齐真源后 17/0）。

### B30.1 补充：把那 8 处的归属**逐文件 blame 量了一遍**（2026-10-03 10:1x）——B27 那句"本条线不再欠账"成立，所以这笔账不该由本条线付

我一度怀疑 B27 犯了"整块 blame 把自家债记给别人"的老错（记忆里就记着这条），所以逐文件取了每一处 `style={{` 所在行的**作者笔**，不是取文件级 blame：

| 文件 | 处数 | 归属笔（日期） |
|---|---|---|
| `TaskDetailSheet.tsx` | 26 | `27764c93`(09-27) · `aff9ad1f`(09-26) · `b2b5455a`(09-28) · `d51181d6`(09-27) · `9ed11d74`(09-30) · `896d6c74`(10-02) |
| `TasksScreen.tsx` | 15 | `e9daa4b8`(09-25) · `27764c93`(09-27) · `9d5050d5`(09-27) · `b2b5455a`(09-28) · `697fba42`/`b1c40f5a`(10-01) |
| `NotificationsScreen.tsx` | 11 | 全部 `896d6c74`(10-02，`test(mobile-ios)` 那笔夹具修复) |
| `SettingsScreen.tsx` | 9 | `72dd32fc`(09-30，「补上认证与设置两面」) ×7 + `881aa92a`(10-02 隐私同意) ×2 |
| `ProfileScreen.tsx` | 9 | `8a703ef3`(09-27) ×3 · `72dd32fc`(09-30) ×3 · `b2b5455a`(09-28) · `896d6c74`(10-02) ×2 |
| `AuthScreen.tsx` | 8 | `72dd32fc`(09-30) ×4 · `881aa92a`(10-02) ×3 · `77f11d17`(10-02) ×1 |
| `TrashScreen.tsx` | 6 | 全部 `42541e70`(09-27) |
| `FocusScreen.tsx` | 5 | `aff9ad1f`(09-26) ×2 · `27764c93`(09-27) ×3 |
| `SearchScreen.tsx` | 4 | `e8d430e9`/`078971c5`(10-01) 各 2 |
| `ConflictSheet.tsx` | 3 | `aff9ad1f`(09-26) · `27764c93`(09-27) ×2 |
| `WelcomeScreen.tsx` | 3 | 全部 `72dd32fc`(09-30) |
| `SecurityScreen.tsx` | 1 | `804842be`(10-02) —— **本条线刻意留下的那一处**（passkeys 子卡表面：`gap`+`surface-sunken`+`radius.md`+`padding` 四件事一起，不是布局意图；`bb41e9fe` 文件头写明"为消一处而给共享层发明没人第二处要用的 API"是要避免的事） |
| `ExportScreen.tsx` | **0** | 本条线批五的 6 处在 `057ec9b7`/`7420d8d7`/`bb41e9fe` 里全部清零 |

⚠️ 口径：上表的处数是**纯 `grep style={{`**（合计 101，含 `PrivacyConsentSheet` 1 处），门禁 `check:l4` 的读数先 `stripComments` 再数，实测 **98**（基线 90）。两者差 3 处是注释里的示例代码。这张表给的是"每处是谁写的"，不是"门禁数到几"。

⇒ **结论**：本 Goal 自己的两个屏（`ExportScreen` 0 处、`SecurityScreen` 仅剩那 1 处且有理由）已经付清，
缺的 8 处**只能从别的条线写下的文件里取**（09-25~10-01 的 P2/布局批次、10-02 的隐私同意与 iOS 验收笔）。
所以"这 8 处属 M3/别的条线"不是挡箭牌，是 blame 的读数 —— B27 的判定成立，我在上面那个怀疑是错的，
按记忆的规矩把撤回写回原处：**没有犯"把自家债记给别人"，但差点犯了反向的错（为了凑绿去替别人重构他的屏）**。

📌 顺带给真正要付这笔账的人一条省事的地图：`NotificationsScreen` 的 11 处**同一笔**写下、
且其中 6 处是 `gap: tokens['space.2']` 与 `flexDirection:'row'+gap+alignItems:'center'` ——
正好是 kit 里 `Stack`（`gap` 缺省档）与 `HStack gap align="center"` 的**逐字节等价出口**，
一处都不用给共享层加新 API；`SettingsScreen` 另有 2 处同类（303/306）。
其余的（`TaskDetailSheet` 26 处、`TasksScreen` 15 处）才是真需要 `ListSurface`/`TaskRow` 那档设计口径的部分。

### B30.2 补充：B30 那句"只剩 check 链的这两段"当时**少算了一段**（2026-10-03 10:3x 逐段实测，HEAD `a2d0d634`）

B30 写在 10:0x，依据是"`&&` 链断在第一红之后，后面的段没执行"这一**推断**。随后把链逐段单独跑
（跳过需要设备/GUI/重负载的 12 段；`check:ai-e2e`、`check:landing-e2e` 已按 B22/B24 单独实测）
才发现最后一段 `pnpm -r test` 也是红的。✅ 两条都在本条线当场修完（都是**撞见**的仓库级红，
不是本条线欠的账，也不是为了让套件绿而改判据）：

| 那段里的失败 | 修复前现量 | 归属 | 修复笔 |
|---|---|---|---|
| `password-reset-page.spec.ts:74` | **1 failed / 22 passed**，对所有机器形态都红 | `ce23d3ab` 语言改判**漏掉的第四份判据**（文件 10-01 就在） | `c1395bf8`：反向断言 + 同页阳性对照，两次相反方向的变异各只打红一条（§7 第 167 条） |
| `account-profile.spec.ts` | 干净检出 `Test Files 1 failed` + `Tests no tests`（27 条没跑）；主检出全绿 | `7e299118`（09:38）带进来的第 5 个 `dotenv` 依赖，属 §7 第 157 条那一类 | `a2d0d634`：改回 `vi.hoisted` + `??=`，并补 `test-env-contract.spec.ts` 让这条约定第一次会失败 |

修复后的现量：主检出与干净检出的 server 整片都是 **111 files / 2095 passed / 1 skipped**；
`pnpm -r test` 在**干净检出**（`/tmp/heyta-g5` detached @ `a2d0d634`，无 `server/.env`）
**20 个 test 任务全过、`INNER_EXIT=0`**（traps #164：后台通知的退出码是包装命令的，所以这里写的是日志里的 `INNER_EXIT`）。

🔴 顺带记一次自己的错判：这一条**先被判成"隔离检出缺 `.env` 的探针缺件"**。按第 157 条的标准那句不成立
—— 干净检出是 CI 的唯一形态，"我这台机器绿"不是排除证据；两种树形各量一次才分得开谁在说谎。

⇒ B30 表格的"两段"现在是**实测**的（`check:l4` 与 `check:landing-e2e`），处置与代价未变，仍按 B30 正文。

### B30.3 ✅ 那两段**都闭合了**（2026-10-03 12:0x，提交 `e446e54e` + `f79d3733`）——但闭合的方式和 B30 预言的不一样，值得记一笔

B30 写这两段"不是再跑一遍就好的东西"，并各自给了闭合代价：`check:l4` 要「按 M3 的设计口径做迁移 +
逐屏设备取证」，`check:landing-e2e` 要「两条出路里由文档中心那条线挑一条」。**两句都被实测削掉了**：

| 段 | B30 估的代价 | 实际付出的代价 | 差在哪 |
|---|---|---|---|
| `check:landing-e2e` | 同步"四处表达" + 75 份入口产物逐字节对账会变大改动 | **一行常量 + 一次 `git mv`**，`check:entries` 对账零变化 | 四处表达早被收成一处单一事实源；入口 HTML 里不含配图 URL。见 B24 关闭段 |
| `check:l4` | 12 个屏按设计口径迁移 + 12 次逐屏设备取证 | **8 处换成 `kit` 里现成的 `Stack`/`HStack`，零新 API、零视觉变化** | B30.1 那张 blame 地图里已经写明：这 8 处（`NotificationsScreen` 6 + `SettingsScreen` 2）正是"逐字节等价出口"那一档；真正需要 `ListSurface`/`TaskRow` 设计口径的是 `TaskDetailSheet`(26)/`TasksScreen`(15)，而那些**不在超线部分里** —— 基线 90 就是留给它们的 |

🔴 **B30 那条"这不是收尾，是一次独立批次"的判断，对其中一半成立、对另一半不成立**：
它把 8 处当成"12 个屏只迁了一半的余量"，而 blame 逐处的结果显示这 8 处集中在**两个屏**、
且全是纯间距容器。一条登记写"要闭合得付出什么"的时候，代价也要带取证口径，
否则它会同时高估某些路、低估另一些路 —— 而**高估的代价会让人觉得"不做"是负责任的**。
这一轮如果不是产品负责人授权解阻塞，我会照着 B30 那句话继续不动它。

诚实的边界（别把这段读成"两条红都白捡"）：
- 提交 `f79d3733` 只把 `apps/mobile/src/screens` 从 98 带回**基线 90**，没有往下清一寸。
  M3 那 41 处（`TaskDetailSheet`/`TasksScreen`）仍然住在基线里 —— 棘轮的作用是把它们**钉住**，
  不是消掉它们。B18 那笔账**没有解除**，只是不再表现为红。
- 零视觉代价这一条目前只有**源码层证明**（`Stack` 缺省档 = `space.2`、`HStack` 的 `align` 缺省
  `undefined` ⇒ 与裸 `<View style={{flexDirection:'row', gap}}>` 逐字节等价；`testID` 经 `...rest` 透传），
  设备层的"同屏主蓝命中数改前后相等"要等 §6.1.1 那趟重装（现场不满足，见 goal §7.16）。

复量读数：`check:l4` **exit 0**（"内联样式 90 处，恰在基线 90"）、
`check:landing-e2e` **17 passed / 0 failed**，两条都做过变异：
前者把 `inbox-notifications-list` 那一处换回 `<View style={{ gap: tokens['space.2'] }}>` ⇒
**恰好 1 处超线（91 > 90）、exit 1**，随后 `git checkout --` 还原并与 `HEAD` 那个 blob `cmp` 判等；
后者把前缀改成坏的 `/assets/doc` ⇒ **恰好 2 红**（`docs-centre.spec.ts:959` 与 `:1013`）。
详细读数见 goal §7.15。

## B31. 🔴 iOS 端重装跑不起来：`pod install` 崩在 CocoaPods 的 NUL 路径上，而 **traps #154 给的解法本轮实测不复现**（2026-10-03 13:5x 取证，载体 `1ac5913a`）

§6.1.1 的固定收尾这一轮被 `f79d3733`（碰了 `apps/mobile`）触发。android 段跑绿（还顺带照出一处假绿，
修法见 `57e0e1fc` 与 goal §7.19），**ios 段一步都没走出去**：`pod install` 在 `Generating Pods project`
崩 `ArgumentError - path name contains null byte`（`cocoapods-1.17.0/lib/cocoapods/project.rb:452`
`Pathname#realdirpath`，`add_file_accessors_paths_to_pods_group`），于是脚本按设计响亮地不跑 xcodebuild。

🔴 **这条要登记的的不是这个崩溃本身（#154 早就记过），是"它当时那条被写成解法的臂"现在不成立了**：
#154 的结论是"变量是**这棵长活的树**，现开新克隆两次都 exit 0 ⇒ 没有理由在旧树上重试"。
本轮照它做：`git clone --no-hardlinks` + `pnpm install` @ **同一个 commit** ⇒ **同一处栈照崩**。
另外三条臂也当场排除：`LANG/LC_ALL=en_US.UTF-8` 不是变量（仍 exit 1）、
工具链没漂移（`/opt/homebrew/Cellar/cocoapods/1.17.0` 目录 mtime = **9 月 25 日**，ruby 4.0.7）、
`Podfile.lock` 自上一趟绿（`840effb1`）以来只差**一行 `ReactCodegen` 哈希**，
且 `git diff --name-only 840effb1..1ac5913a` 的 250 个路径里**非 ASCII 文件名 0 命中**。

⇒ 所以"换一棵新树就能跑"这句**是错的或者至少是有条件的**。四臂排除之后，剩下的唯一没查的仍是
#154 当年说的那件："哪个路径让 Ruby 拿到 NUL"（要扫 `node_modules` 里 1.9 GB 的文件名）。
**这不是本条线能当场修的**，也不是产品缺陷（App 在 android 上跑得好、iOS 侧一行代码都没动）。

要推动它，二选一：
1. 换一台 `pod install` 能过的机器（或换 ruby 3.x 下的 cocoapods）后跑
   `IOS_DEVICE_NAME="heyta-iphone-17pro" bash scripts/reinstall-all.sh --only ios`；
2. 定位那个路径：`pod install --verbose` 的日志里，崩溃前最后一段文件枚举就是嫌疑人
   （本轮的 `--verbose` 日志末尾只有栈，没有点名 —— 下一步该按 pod 分组切，
   比如临时把 `Pods/` 里某个 pod 的 `vendored_frameworks`/`source_files` 逐块注释掉做二分）。

⚠️ 在 ios 段跑绿之前，**"iOS 装的是当前源码"这句不成立**，不要引用 09:5x 那趟的 iOS 读数代替它。
🔴 **#154 原句的更正没有写进 `environment-traps.md`** —— 那个文件此刻正被并行会话写着
（工作树 +48 行未提交，#178–#180 是他们的），按同一份台账的规矩不整文件 `git add`、不往脏文件追加。
现量什么时候可以写：`git diff --numstat docs/reference/environment-traps.md` 为空。

### B31 关闭（2026-10-03 14:1x）：不是修好的，是**它自己不复现了**

上面那条"四臂排除、根因未定位"之后接着查，`pod install` 在**同一棵树**（`/tmp/heyta-ri-ios` @ `1ac5913a`）
`rm -rf Pods` 之后 exit 0，`LANG`-only 与 `LANG`+`LC_ALL` 两臂都过；`/tmp/heyta-g5` 那一趟真走了
当年崩的那一行（`Generating Pods project`）也过。⇒ **变量仍未定位**，但"这台机器跑不出 iOS 产物"
不成立了，ios 段端到端已跑绿（读数、六臂表、两条 Ruby 侧一般事实、两条边界都在
[`goal-multi-end-coverage.md`](docs/plans/goal-multi-end-coverage.md) §7.21）。

🔴 **本条上面那句"traps #154 的 remedy 已被否证"要一起收回**：#154 说"新克隆能过"、
本轮说"新克隆也崩"——**两句现在都不是当前事实**。留 #154 的更正动作照旧挂在
`environment-traps.md` 干净的时候做，但**更正的内容变了**：不是"remedy 错了"，而是
"这条崩溃不可复现、且两侧各测到一次相反结果 ⇒ 在能稳定复现之前，任何一句关于它的解法都不该写成解法"。

## B32. 任务书「只允许改」清单漏列根 `package.json`，而任务 1/2 在定义上必须改它（2026-10-03 15:4x）

任务 1 要求"6 个脚本补 `verify:` 别名"、任务 2 要求新脚本"同时补别名"——别名只住在
`package.json` 的 `scripts` 里，白名单没列它。这是**写书人的疏漏**，不是执行者越权的许可。
处置：按最小必要改，**只加/改 `scripts` 里的条目**，其余字段一个字不动；
且该文件此刻是 ` M`（并行会话有未提交改动）⇒ 提交走「HEAD + 只我的 hunk 重建暂存」，
不整文件 `git add`。留痕在本节而不是偷偷改完不提。

## B33. 移动端提醒投递：要人拍的那一句（本 Goal 按"不做"走）

批三停批的禁令是「禁止手搓原生模块」，但仓库此刻**已有两个自研 RN 原生模块**
（`apps/mobile/android/app/src/main/java/com/heytamobile/widget/WidgetModule.kt`、
`fs/LocalFsModule.kt`，iOS 侧 `HeytaWidgetCore`）。禁令的前提（"只有三方库这条路"）已经不成立。
自研薄通知模块（Android `AlarmManager` + iOS `UNUserNotificationCenter`）是唯一同时满足
判据 ①（后台/锁屏仍投递）与 ③（force-stop 后仍投递）的路，代价是 `AndroidManifest.xml`
要加 `POST_NOTIFICATIONS` 与精确闹钟权限。**这一句要产品负责人拍**，本 Goal 不动。

## B34. AI 上移动端要拍的语义，与鸿蒙更硬的那条阻塞

- AI：`classifyDestination` 只看端点 URL（`packages/ai/src/supply.ts:91-101`），
  **网络接口不在模型里** ⇒ "蜂窝算不算远程"在类型上目前无法表达。要拍的是
  "要不要为移动新增第四道按网络类型收紧的闸"。本 Goal 只做不依赖裁决的那半件
  （把 `check-ai-coverage.mjs` 改成按端枚举）。
- 鸿蒙：外部条件（模拟器镜像 + 签名）之外还有一条更硬的：**`@op-engineering/op-sqlite`
  官方不支持鸿蒙**（`docs/plans/multi-end-unified-strategy.md:1527`「鸿蒙壳最大风险点，仍未验」）
  ⇒ 买齐镜像与签名仍然造不出能用的壳。要人拍"选库还是自写存储驱动"。

## B35. `GrowthBoard.onFreshStart` 没有对应动作（本 Goal 不顺手加）

补打卡 `onRepair` 可直接接现成的 `checkIn(habitId, date)`（`packages/app-host/src/habit-actions.ts:129`）；
"重新开始" 在动作层**没有对应函数**，加它等于在本批里顺手扩 op 语义。按规矩登记，不做。

## B36. 任务 1 实测下来与任务书不符的两条（2026-10-03 16:0x，HEAD `6570e52d`）

1. 🔴 **任务书那条反向验证不成立，我做了能成立的那一条，并把原命题变成登记项。**
   任务书写「临时删掉 MANIFEST 一条 ⇒ 门禁必须红」。两次变异都跑了：
   - 把 `verify-mobile-account.sh` 的 bootstrap 块删掉 ⇒ `❌ … 缺自快照 bootstrap（HEYTA-SNAPSHOT-BOOTSTRAP）`，
     exit **1**；还原（`cmp` 逐字节相同）后 exit **0**。
   - 把 `scripts/verify-mobile-account.sh` 这一条从 MANIFEST 里删掉 ⇒ `✅ 自快照 bootstrap 全部在位（29 个脚本 + .gitignore）`，
     exit **0**（**不红**）。
   原因在门禁本体：`check-script-snapshot.mjs` 只遍历「清单里的文件」查标记与三处结构（`:73-99`），
   **从不扫磁盘** ⇒ "磁盘上有、清单里漏了一条"这一档结构上抓不到 —— 而 `account` 与 `reminder-ring`
   恰恰就是这么漏了好几天，还配了一条过期理由。**要把 `no_manifest=0` 变成常驻判据得改这个文件的判据部分，
   而任务书给我的授权只有「MANIFEST 列表」这一小节** ⇒ 登记待拍，不自作主张扩权。
   本轮每条验收都跑了这条现量命令（过渡期的对账口，`$` 在文档里不展开）：
   ```bash
   node -e 'const fs=require("fs");const s=fs.readFileSync("scripts/check-script-snapshot.mjs","utf8");const man=[...s.matchAll(/^  .(scripts\/[^"\x27]+).,$/gm)].map(m=>m[1]);const disk=fs.readdirSync("scripts").filter(f=>/^verify-.*\.sh$/.test(f)).map(f=>"scripts/"+f);console.log("no_manifest="+disk.filter(n=>!man.includes(n)).length)'
   # 别名那一档同理由：把 disk 换成与 package.json 里 verify:* 的脚本名集合做差，输出 no_alias
   ```

2. 🔴 **`check:shell-unicode` 在当前 HEAD 上是红的，三处落在我地界外。**
   `scripts/mutate-closeout-gates.sh:223/232/242` 的 `「$V1」` 被全角引号吞掉变量名，
   由 `cc974fbd`「fix(scripts): 第 7 步的"没渲染"其实是"没滚到"」提交，工作树对该文件干净
   ⇒ **已提交的技术债**，不是谁在飞的改动。这一档挡住的是完成条件 2 的「`pnpm check` 62 段 exit 0」，
   与本条线做的功能无关。我不代改别人的变异脚本，登记给那条线，一条命令就能修平：
   `python3 research/tools/fix-shell-unicode-vars.py --write`。
   同批被扫出的另一处 `scripts/verify-mobile-repeat.sh:675`（`$XY15C）`）**在我地界内**
   （`scripts/verify-mobile-*.sh`），已就地改成 `${XY15C}` 并复验门禁只报地界外那三处 ——
   那是 `3fe7f590` 提交的真缺陷（验收日志里那个坐标读数会整个丢掉），不是顺手重构。

   ✅ **2026-10-03 19:0x 由 AI 覆盖面那条线闭合（提交 `1a6640f2`）**：那三处已改成 `「${V1}」` 形状。
   这是**同一个缺陷的第二次**（`1ac5913a` 修过 4 处、`cc974fbd` 又写出 3 处），而 `check:shell-unicode`
   是**每一次 `pnpm check` 都跑**的一段 ⇒ 在本线落地之前 `main` 上第 54 段是红的。
   现量（两条一对，负向不许单独成立）：
   ```bash
   git show main:scripts/mutate-closeout-gates.sh | LC_ALL=C grep -cE '\$V[123][」』]'   # 修复前形态 = 3
   LC_ALL=C grep -cE '\$V[123][」』]' scripts/mutate-closeout-gates.sh                     # 载体上 = 0
   ```

## B37. 🔴 我自己造的一次共享工作树事故（已还原，但形状必须留档）：为了让 package.json 只带我的 hunk，覆盖了并发会话两行未提交改动（2026-10-03 16:0x）

**发生了什么**：任务 1 要往根 `package.json` 加 6 个 `verify:` 别名，而并发会话在同一文件里有
**2 行未提交**改动（`check:op-log-semantics` 那一段）。计划的四步是"备份工作树 → 写 HEAD+我的 6 行 →
`git commit --only package.json` → 还原备份"。第一条命令里 `cp package.json /tmp/pkg.mixed.json && sh -c '...'`
的 `sh -c` 单引号嵌套解析失败（zsh 在**整行**解析阶段就报错），于是**左边那条 `cp` 根本没执行** ——
备份不存在，而我认为它存在。下一步 `node insert-aliases.mjs` 直接把工作树的 `package.json` 写成了
HEAD+我的行，那 2 行随之消失（`cp /tmp/pkg.mixed.json` 报 `No such file or directory` 才暴露）。

**为什么危险**：他们那 2 行没有暂存（`git status` 是 ` M`，索引等于 HEAD），共享工作树里**没有第二份**。
如果不是本轮刚好把那段 diff 打印在会话里，恢复就只能靠猜。

**怎么还原的**：按覆盖前 `git diff` 的原文重建那两条（新增 `"check:op-log-semantics":` 一行 +
在 `check` 链的 `pnpm check:reachability && ` 之后插入 `pnpm check:op-log-semantics && `），
脚本带**四条前置断言**（锚点命中数=1、未重复、段数必须=62、我那 6 行仍在），跑完
`git diff --numstat -- package.json` 回到 **`2\t1`**，diff 正文两行与覆盖前逐字一致。

**改的纪律（本条线后面每一步都照做）**：
1. temp-swap 之前 `test -f <备份> || exit 1` 必须写进**同一条链**，不许凭"上一条命令看起来跑了"；
2. 长链里 `&&` 左边只要有一个语法错误，**整行一个字符都不会执行** —— 副作用要事后测量，不要事后回忆；
3. 更稳的做法是**不碰工作树**：改 root `package.json` 这类多人文件时，先 `git show HEAD:… > /tmp/x`、
   在 /tmp 里造好目标内容、`git hash-object -w` + `git update-index --cacheinfo` 只动索引，
   再用 `git commit --only` 之外…**本仓已证明 `--only` 取的是工作树内容**，所以这条路必须配
   `git commit`（不带 --only）且**当场 `git status` 复核索引里没有别人的暂存条目**。

## B38. `apps/web/tests/**` 不在「只允许改」清单里，任务 3 要求"两端各一组用例"因此只能一端落一半（2026-10-03 17:4x）

任务书原文：**验收：两端各一组用例**；界限原文：只允许改 `apps/mobile/src/**`、
`apps/web/src/features/{…}/**`、`packages/{ui,app-host,i18n}/src/**`…… `apps/web/tests/**` 不在其中。

**我怎么处理的（不改动别人的判卷面）**：行为判据落在**允许新建**的
`apps/mobile/tests/organizer-rename.spec.ts`，而它测的是 `@heyta/app-host` 的**真实动作层 + 真实引擎 + 真实 SQLite**，
两端调的是同一个函数，所以"改名后重放仍在 / 删除是墓碑 / 一个意图一条 op"这三件事**只有一份实现可测**；
web 那一半用**接线断言**（`store.renameTag` 有真调用点、`ProjectsPanel`/`HabitsView` 传了 `onRename`）钉住。
差的是"web 界面层的行为用例"——那需要在 `apps/web/tests/` 新建文件，超出地界，故登记不擅自扩界。

## B39. 任务 2 的真机判据被并发会话占用设备挡住；本轮另查明一次"假红"的根因是系统权限弹窗（2026-10-03 17:39–17:44）

**占用**：`scripts/verify-mobile-notes.sh` 的"别人正在用这台设备"探测拦下我这一跑，
输出 `❌ 这台设备上还有别的移动端验收在跑：68134 85182 bash ./scripts/verify-mobile-aed.sh` → **exit 3**
（按纪律：环境无效 ≠ 产品失败，不硬挤、不改别人的脚本）。审计 P2-1 与 §5 那两行**因此还没翻 ✅**。

**顺带查出的假红根因**（上一跑 17:39 那次报"找不到便签输入框"）：
填完凭据、第一次唤起中文输入法时，系统弹了「Allow Google to take pictures and record video?」，
而 `uiautomator dump` 导出的是**当前活动窗口**的树 —— 弹窗在时应用的一个节点都读不到。
修法（在我地界内的 `scripts/verify-mobile-notes.sh`）：新增 `dismiss_permission_dialog()`，
**先证明弹窗在**（读到 `Don't allow` / `不允许` 那颗按钮）才按现取坐标点"不允许"，点完复查仍在就报出来；
在第 1 步末尾与第 2 步开头各调一次。同批把第 2 步那句写死的 `input tap 945 $TAB_Y` 换成**现取坐标**
（`xy_desc "我的"`），注释写明为什么不套用 `tap_tab`（便签输入框要滚动才露出来，拿它当换页标记会把成功读成失败）。

## B40. 「新建清单时选父级」仍没做（P2-6 只翻绿了归档那一半）

`createProject(name, parentId?)` 的第二参在移动端**没有调用点**（`ListsSection.tsx:162` 只传名字），
web store 有。要补的是 composer 里的层级选择器 —— 它落在"composer 留在各端"那一条既有分工里
（`packages/ui/src/projects/model.ts` 文件头第 2 条），且需要一条新的界面判据（真机：选父级 → 笔记本读到 `parentId`）。
本批任务书没点这一件，按"不顺手扩范围"登记，不当已做。

## B47. 🔴 一条**不在本线**的产品缺陷挡住了本线的交付：侧栏清单名被四个动作按钮挤成零宽，读不出来（2026-10-03 18:5x 现量）

**症状（人眼看图，不是断言推断）**：`e2e/test-results/calendar-sidebar-迷你月历…-chromium/test-failed-1.png`
里侧栏「清单」区那一行显示的是 placeholder **「新清单」+ ✓**，刚创建的清单名**看不见**；
它下面一行是四个动作图标（色槽 / 重命名 / 归档 / 删除）。

**判据位置**：`e2e/tests/calendar-sidebar.spec.ts:86` 的
`expect(sidebar.getByText(LIST, { exact: true })).toBeVisible()` ⇒ `Received: hidden`，
两个 attempt 同一句 ⇒ **确定性**，不是负载抖动。机制：`192a516d` 给每行新加的动作组把名字
挤成**零宽 flex item**（`name: { flexShrink: 1 }` 无 `minWidth`）。

**为什么登记而不是就地修**：`git status --porcelain -- packages/ui` 此刻 10 个 `M`，
`OrganizerList.tsx` 正被并行会话改（其未提交 diff 自证："Let the action group move as one unit
instead of **shrinking the name down to a zero-width flex item**" + `minWidth: tokens['touch-target.min']`）。
代改在飞的界面 = 制造第二次共享工作树事故（`B37` 那个形状）。

**归属的三条独立证据**（全部零成本、可在干净检出复跑）：
1. `git rev-parse <载体>:packages/ui` == `git rev-parse <main>:packages/ui` == `47513f2e…`，
   而本批 40 笔提交在 `packages/ui/` 下**零文件** ⇒ 被测组件是 main 的字节。
2. 配对 A/B：同一套 117 条用例，载体 `792f9b2d`（未并 `192a516d`）单跑 `115 passed / 0 failed`；
   并进来之后 `112 + 3`。总数相等证明是同一套用例。
3. 所有者工作树带那笔未提交修复跑整链时这两条 **✓35 / ✓36 全过**
   （`/tmp/heyta-aed-check-final6.log:1243-1244`，载体 = 主检出工作树、非干净检出）。

**代价（这条为什么要单独立账）**：它不是"一条用例红着"，它让 **AGENTS §6.1.1 的固定收尾在本线上
结构上不可达** —— `pnpm check` 断在第 51 段 ⇒ `reinstall:all` 的"链 rc=0"前置永远不成立。
按红线不吸收别人的债凑绿、不放宽闸门。

**关闭判据**（由本线复跑，不需要谁点头）：
```bash
cd /private/tmp/heyta-final && git merge --no-edit main && pnpm build && pnpm check:ai-e2e
# 期望 115 passed / 0 failed / 2 skipped（同一套 117 条）
```
