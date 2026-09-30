# BLOCKED — 待裁决清单

**第 1、2 项已于 2026-09-30 的收尾轮解决并落地**（各自保留原文以便读推理，
下面写清了"当时的假设哪里错了"）。剩下 **2 项待裁决**：第 3 项
（**已于 2026-09-30 当场定案并落地了第一半**，见文末）与第 4 项
（四端重装里两端因**环境**装不上：mac 无图形会话权限、windows 主机不可达）。

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

## 4. 🔴 四端重装（AGENTS §6.1.1）**跑了，两端因环境装不上** —— 需要用户处置

> 记录时间：2026-09-30 收尾轮。`pnpm reinstall:all` 完整执行，**没有用 `--skip`、没有降级判据**；
> 失败的两端如实报红（脚本整体 exit 1）。

| 端 | 结果 | 判据行 / 证据 |
|---|---|---|
| **android** | ✅ 清旧包 → release APK 重打（63M）→ 模拟器全新安装 `Success` → 截图判据 | `contentRatio 0.068`、**主蓝命中 9279**、`/tmp/heyta-reinstall-android.png`（人已看过：heyta 欢迎页、中文、主蓝按钮） |
| **ios** | ✅ 模拟器卸旧 → Release 重打 → 全新安装 → **新鲜度判据**（已装的包比源码新）+ 截图 | `contentRatio 0.066`、**主蓝命中 9450**、`/tmp/heyta-reinstall-ios.png`（人已看过，同一面欢迎页） |
| **mac** | 🔴 `.app` 已重打、已签名（Developer ID 链完整）、已装进 `/Applications`，**卡在这台的启动判据** | `sandbox_extension_issue_file_to_process failed … (Operation not permitted)` + `SCShareableContent 里始终没有窗口 34662` ⇒ 截图判据拿不到图。**根因不在产品**：同一进程树里 `screencapture -x` 直接报 `could not create image from display` —— 这台机器上**发起方没有屏幕录制 / 图形会话权限** |
| **windows** | 🔴 **拒绝打包**（源码同步没通过就不打，正是 §7 第 82 条要防的"装旧树还报绿"） | `ssh: connect to host 10.111.127.237 port 22: No route to host` ⇒ `scp: Connection closed` ⇒ `源码包送不过去（windows-pc 不可达？）` |

**要用户做的两件事**：

1. **mac**：给发起这些命令的那个应用（这次是 Qoder；平时是 Terminal/iTerm）在
   「系统设置 → 隐私与安全性 → **屏幕录制**」里打勾并重开它。
   没有这个权限，`check:macos-window` 与 `reinstall:all` 的 mac 段**必然红**，
   而那**不是代码坏了**（换一个有权限的父进程就能过）。
2. **windows**：把打包机 `windows-pc`（`10.111.127.237`）重新接上（开机 / 同网段 / SSH 可达），
   然后 `pnpm reinstall:desktop`。⚠️ 它**不可达时脚本就是红的**，这是设计 ——
   别用 `--skip windows` 把它蒙过去。

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
