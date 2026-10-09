# PROGRESS — AI 审计 + 域名迁移到 waytofuture.cn + 管理后台

> 上一轮（补隐私闸门缺口）的记录在 git 历史里，已被本轮取代。

## 理解的目标／顺序／最大风险（≤10 行）

1. **三件事**（产品负责人原话）：① 检查 AI 功能是否做完整了；② 项目是不是需要管理后台
   （「SSOS 那个是不是可以直接照抄」）；③ 后端域名都改成 `waytofuture.cn` 的子域名并上线。
2. 顺序：先给 AI 结论（只读）→ 再迁域名（ICP 备案等着它）→ 最后做管理后台
   （它要动 schema，风险最高，放最后）。
3. 最大风险：**域名迁移会换掉 `WEBAUTHN_RP_ID`** —— 旧域名上已注册的 passkey 全部失效，
   不可两边兼容（与 2026-09-27 那次同一代价，已当面确认）。
4. 第二大风险：管理后台要**动 `users` 表**（加一列）且要**开一个新的攻击面**
   （能读全站用户与订单）。前者走迁移纪律，后者 fail-closed 默认关闭。
5. 只改：`server/**`、`packages/{i18n,app-host,ui}`、`apps/web/**`、`apps/landing/**`、
   `e2e/**`、`docs/**`。**不碰** `packages/ui/src` 那批别的会话正在改的未跟踪文件。
6. 算得对 > 改得少 > 做得快；拿不准进 `BLOCKED.md`，不停下等。

## 任务 0 基线（2026-09-30 实测）

| 命令 | 要求 | 实测 | 结论 |
|---|---|---|---|
| `pnpm --filter @heyta/sync-server test` | 全绿 | **1789 passed** / 1 skipped | ✅ |
| `pnpm --filter @heyta/web test` | 全绿 | **987 passed** / 12 skipped | ✅ |
| `pnpm --filter @heyta/app-host test` | 全绿 | **739 passed** | ✅ |
| `pnpm --filter @heyta/i18n test` | 全绿 | **10 passed** | ✅ |
| `pnpm check` | exit 0 | 当时 🔴 e2e `motivation.spec.ts` 2 红（**预存在**）→ **收尾轮已修**（见 §收尾轮）。**2026-09-30 13:40 三次更正本行**（前两次都错过，过程见 `BLOCKED.md` §8）：`check` 是 `package.json` 的一条 `&&` 链（**46 段**；22:41 更正：本行原写 45，那是 ` && ` **分隔符**的个数）。🔴 **22:30 第四次更正：那一行里两个结论都过期了。** ① **断点位置**：22:02 跑整链（`/tmp/heyta-check-full.log`）断在**第 20 段 `check:macos-window`** ⇒ 第 1–19 段本轮全过（含 `check:l4`/`check:design`），**第 21–46 段仍一次都没执行**（"其后 34 段"这个数不能跨断点继承，断点换了它就得重数；**22:41 已补测，见下面 ④**）。② **基线红不红了**：`bfbff487`「fix(design): 桌面回跳浮条改用设计 token」（22:00:52）**已提交并已推送**，`git merge-base --is-ancestor bfbff487 origin/main` → 0，`origin/main` 与 `HEAD` 里该文件 blob 逐字节相同（`4fd4ced8…`）；22:26 单独跑 `check:l4` `✅ 没有样式字面量…（103 个文件）`、`check:design` `✅ 无硬编码设计变量`（307 个源文件）均 exit 0 ⇒ **干净检出的 `origin/main` 在这一批上是绿的**。③ 第 20 段那一红的**原因在同一轮内换了第二次**：13:37 是 `spawnSync bash ETIMEDOUT`（阶段 ⑤ 没跑到），22:02 是走到了 ⑤ 而 M2 判据报 `已登录`（取证链 `CAPTURE_METHOD=screencapturekit` / `CROSSCHECK=ok(2240x1440)` / content 0.049 全绿）。我试的逃生门 `HEYTA_WEBKIT_EPHEMERAL=1` **已被 A/B 证伪**：壳侧存储宿主 `HEYTA_SHELL_STORAGE` 默认 ON（会话在 `~/Library/Application Support/heyta/heyta.sqlite`，`-wal` 是活的），非持久 WebView 存储擦不到它，反而让页面自己起不来（`contentOnModalRatio 0.008`、`handler:"undefined"`）⇒ **没有为此改门禁代码**。④ **22:41 第五次更正：把第 20 段"之后"真的跑完了**（21 段串行、只读、逐段取进程退出码，HEAD 全程 `f2d5a078`）⇒ **19 绿 / 2 红**，过程与逐字输出见 `BLOCKED.md` §8「22:41 把第 20 段之后跑完了一遍」。两处红：`check:docs`(25) 22:41 红、22:42 **复跑 exit 0**（并发取证会话正在重写 `evidence/window-first-run.png`，门禁读到的是"文件不在"的那一瞬 ⇒ **动作是复测，不是修**）；`check:shell-unicode`(42) 🔴 红在**已提交代码**里（`f4e42f68`，`reinstall-all.sh:184` 的 `$MAC_SELFIE（` 被全角括号吞掉变量名 ⇒ UTF-8 默认 locale 下那行打印成「截图证据：窗口）」、**两个截图路径整个没了**，而退出码不受影响、`RESULT_mac=OK` 照打）⇒ **已修成 `${MAC_SELFIE}` 并复验 `check:shell-unicode` exit 0 / `bash -n` 通过**。 | 🔴 **仍未 exit 0**（⚠️ 这一句 22:55 **第六次更正**已推翻，见本行末尾；保留原文是为了让人看清"卡在别人的未提交改动"这个判断的保质期只有 14 分钟）：第 20 段 `check:macos-window` 现在卡在**另一条会话一笔已验证但尚未提交的改动**（`scripts/check-macos-window.mjs` 22:41 实测仍是 ` M`），不在代码本身；第 42 段本轮已修；干净检出的 `origin/main` 上 `check:l4`/`check:design` **已 🟢**。✅ **第 22–44 段实测全绿**（21 段逐个跑，含 `check:windows-shell` 是**真跑不是跳过**、`check:linux-shell` 是**响亮跳过返回 0**）。⚠️ **还有 5 段未知**：`check:journey-coverage`(21)、`check:ai-e2e`(40)、`check:landing-e2e`(41)、`screenshot:verify`(45)、`pnpm -r test`(46) —— 都没跑（会起浏览器/清共用的 `e2e/test-results/`，而并发会话正在同一个工作树取证），**不要读成"它们不红"**。~~本行的净结论：**"未知"从 25 段缩到 5 段**，而不是"只剩一处红"~~ 🔴 **22:55 第六次更正：那 5 段全部补测完成，整链第一次 `FULL_CHECK_EXIT=0`。** 过程：22:48 先跑一次 → 断在**第 40 段 `check:ai-e2e`**（`57 failed / 6 passed`，几乎全是 `ERR_CONNECTION_REFUSED at http://127.0.0.1:4318/`）；三条证据把它定成**并发端口抢占，不是代码坏了**（① 我的日志里 `⚠️  端口 4318 被占用：pid 39558（node）—— 清掉` —— 前置脚本 `scripts/check-ai-e2e-preflight.mjs:83` 会 `SIGKILL` 占端口的进程；② 对方日志末行 `Command was killed with SIGKILL … vite --port 4318 --strictPort`；③ 约 35s 后我自己的 vite 也消失）。**22:55 先确认 4318/4319 空闲再串行重跑** ⇒ `FULL_CHECK_EXIT=0`（22:59:17）、全链零 `✘`：`check:ai-e2e` **63 passed / 2 skipped**（Goal 第 1 项那两条 `motivation.spec.ts` **7 条全 ✓**，与"整链 exit 0"在同一次运行里同时成立）、`check:landing-e2e` 6 passed、第 20 段在链里绿且证据核到产品路径（`STORAGE=shell` + `STORAGE_HOST=on`）、`check:docs` `✅ 无死链、无"本机有仓库里没有"的链接`（Goal 第 3 项的两条豁免逐条打印了理由）、`pnpm -r test` server **91 文件 / 1806 passed**、web 77 文件。⚠️ **这条 0 的边界**：它是在**共享工作树**里测的，当时有 **12 个外来脏文件**（`apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift`、`apps/web/src/{App.tsx,features/inbox/InboxBell.tsx,styles/app.css}`、`docs/plans/admin-console.md`、`packages/design-system/**` 含 `tokens.css` 与其生成物、`packages/i18n/src/locales/{zh-CN,en}.ts`）⇒ **不等于干净检出的 `origin/main` 也绿**，要在检出上重跑才能拿仓库属性的结论。✅ **`pnpm verify:i18n-failures` 23:02 复测：91 个用例全部符合预期（该绿的绿、该红的红），exit 0** —— 在同一批外来 `packages/i18n` 词条改动在场的情况下仍然成立。📌 本行净结论换成：**"断在第 X 段"是上一次运行的属性，不是仓库的属性** —— 同一段代码在 22:48 红 57 条、22:55 一条不差全绿；链断了先查端口与 `pgrep`，再看 diff（已登记 traps 第 87 条）。 |

## 改动

### ① AI 功能完整度审计（只读）

- 新增 `docs/research/ai-feature-completeness-audit.md`。
- 结论：**本地自带端点（BYO-key）模式完整**；**托管/云 AI 是刻意受阻**，且受阻点
  （`retention-undecided` 运行时门禁、"300 次/月"配额未实现 + 禁售）全部仍在代码里。
  - 🔴 **上面这句是审计当时的读数，现已作废**（2026-10-05）：`retention-undecided` 这个 reason
    与 `NOT_YET_DELIVERABLE_SKUS` 里那一条都已随 [ADR-0054](docs/adr/0054-managed-ai-retention-and-selling-preconditions.md)
    撤除（保留策略定案 + 计量已实现，禁售按 0023 自己写的顺序解除）；
    ⚠️ 但这一档**在客户端仍然打不开**（0054 §8），所以"托管 AI 对用户可用"并不因此成立。
    该审计另外三个真缺口的状态见 [ai-assistant-closure.md](docs/plans/ai-assistant-closure.md)。
- 真正的缺口 3 个：受保护条目 `readable:false` 没有产品机制（最严重，压在入站 AI
  的隐私承诺上）、"发特征不发原文"从未实现（文档债）、工具调用 P3/P4 未开始。

### ② 域名迁移 → `https://heyta.waytofuture.cn`（**已上线**）

- DNS（tccli `waytofuture` profile）→ nginx 新站点 → certbot（有效期至 2026-12-29）
  → 服务端 `.env` 五项 → 落地页 `VITE_*` 构建参数 → 应用重建。
- 动因是**备案倒逼**：腾讯云 ICP APP 备案三平台填报的就是这个域名，而备案要求
  填报的域名真的指向那台服务器。见 `docs/runbooks/deployment.md` §3.7.2。
- 顺带修掉一条**错误纪律**：`DEFAULT_SITE_ORIGIN` 说"换域名不要改这个常量"——
  那是错的，`check:entries` 会用默认值重生成再与提交物逐字节比对，必须一起改。

### ③ PWA 子路径缺陷（迁移验收时抓到的**预存在**缺陷）

- 应用挂在 `/app/` 下，但 `SW_URL` 写死 `/sw.js`、manifest 的 `start_url`/`scope`/`icons`
  也是根绝对路径 ⇒ 线上 `/sw.js` 与 `/icons/*.png` 返回**落地页 HTML**，
  SW 注册报 `SecurityError`、**PWA 装出来的入口是落地页**。
- 修法：`SW_URL` 由 `import.meta.env.BASE_URL` 派生；manifest 全部改**相对地址**
  （相对 manifest 自己解析 ⇒ 根路径与子路径同一份产物都对）。
- 变异验证：两处各自改回旧写法 ⇒ 对应测试转红。线上复验：SW 真的注册在 `/app/sw.js`，
  控制台从 2 条（含 SecurityError）变成 **0 条**。

### ④ 运营管理后台（**已上线**）

- 决策 `docs/adr/0038-admin-console-scope.md`：**抄 SSOS 的模式、不抄它的页面**。
  SSOS 那 42 个页面服务的是租户/税务/合规/Mailu，heyta 一个对应模型都没有。
- 权限：`users.is_admin BOOLEAN NOT NULL DEFAULT false`（迁移 `20261003000000_add_admin_flag`）。
  **没有人生来是管理员**；授权只能由 CLI 显式做。
- 范围：概览 / 用户 / 订阅 / 订单 / 优惠码 / 邀请 + **三个不碰钱的动作**
  （解锁、调配额、强制登出）。明确不做改订阅/退款/发券/群发通知。
- 闸门：插件级 `addHook('preHandler', requireAdmin)` ⇒ **新增路由忘了鉴权不可能**。

### ⑤ 新增的验收套件

- `e2e/playwright.live-site.config.ts` + `e2e/live-site/live-domain.spec.ts`：
  **线上**真浏览器验收 5 条（域名迁移、中英入口、凭据页同源、管理端点 401、PWA 子路径）。
  域名用 `--host-resolver-rules` 钉到真实 IP 并加 `--no-proxy-server` ——
  否则在这台开发机上验的是**本地代理**，代理一关就变成假绿。

### ⑥ 管理后台的真浏览器契约（补 §6.2 规定一欠的账）

新增 `e2e/tests/admin-console.spec.ts`：5 条真浏览器用例 + 10 张截图（`e2e/test-results/admin-*.png`，
**每张都打开看过**）。此前 `grep -rln admin e2e/tests/` 是**零命中** —— 后台的判据全在 jsdom 与服务端
两侧，而"界面能用"这个结论**没有任何一张图支撑**（正是 §7 第 80 条那一类）。

- 被测对象是真的：真 DOM、真 `fetch`、真 store、真点六个 Tab。**只有服务端响应体是造的**
  （这套 e2e 不跑真服务端，它要 PostgreSQL），与 `stub-provider.mjs` 同一条纪律。
- 三个动作的判据是**读回服务端的值**：假服务端收到 POST 时自己改状态（`fake.locked` /
  `failedLogins` / `quotaBytes`），界面要显示新值只有一条路 —— 真发 POST 再真拉 GET。
  **变异验证**：拿掉 `store.unlockUser` 里那句 `await get().openUser(id)` ⇒ 界面仍显示「已完成。」
  而 `失败登录` 停在 5 ⇒ 该条精确报红（跑完已还原，`git status` 对该文件干净）。
- 两条"看不见多出来的东西"：403 ⇒ 面板与失败文案**都不渲染**；未登录 ⇒ 一个 `/api/admin/*` 都不发。
- 🔴 本轮**探针自己**写错的两处（都不是产品缺陷，注释都留在 spec 里）：
  ① 用 `ADMIN.length`（带协议与端口，31 字符）去裁 `url.pathname`（19 字符）⇒ 恒为空串 ⇒
  每个分支都落空 ⇒ 全部请求掉进 404，症状长得像"后台整块没实现"；
  ② 请求记录形如 `GET /users?limit=50`，判据写 `split('?')[0] === '/users'` —— 方法前缀还留在里面
  ⇒ 这条**在任何实现下都必红**。假绿与假红同样是"判据不可用"。
- 🔴 顺带照出两条**产品缺陷**（只有真浏览器看得见，jsdom 那套全绿时它们一直存在），**本轮都已修**：
  ① 邀请页**只渲染 referrals** —— `/invites` 响应里的 `codes.items` 拉回来了，界面上块都不块
  ⇒ 现在两面都渲染（`admin-codes` + `admin-referrals`，小节标题走新词条，中英同步）；
  ② 解锁只重拉**详情**，用户列表那一行的「已锁定」徽标不跟着变，而再点一次 Tab 也不会重拉
  ⇒ 运营者解完锁，列表还在说"已锁定"。修法是共享的 `reloadAfterUserAction(id)`：
  详情 **+** 当前页列表都重新读回来（带着原 `offset` 与搜索词），
  🔴 不做"本地抹徽标"的乐观补丁 —— 服务端是唯一裁决者，没读回来的状态不该上界面。
  两条各留一条回归判据（e2e + jsdom），第 ② 条**已做变异验证**：拿掉 `loadUsers` ⇒ 恰好 1 红。

## 进度

- [x] ① AI 审计报告落盘
- [x] ② 域名迁移上线 + 文档 §3.7.2
- [x] ③ PWA 缺陷修复 + 变异验证 + 线上复验
- [x] ④ 管理后台：ADR / 计划 / 迁移 / CLI / 后端 / 客户端 / 前端 / 测试
- [x] ④ 部署上线：迁移已应用、`/api/admin/overview` → 401、前端已上（均在容器里核实）
- [x] ⑤ 线上验收 5/5 绿；五道结构性门禁全绿
- [x] ⚠️→✅ **交还用户：授权第一个管理员 —— 已完成**（2026-09-30 实测：
      `admin.js list` → `共 1 位管理员：#14 allen030703@163.com 已验证=是`）
- [x] ⚠️→✅ `pnpm check` 的 e2e 段 2 红 —— **收尾轮已修**（判据换成按视图锚点 + 三条变异验证），见下面「收尾轮」
- [x] ⑥ 管理后台真浏览器契约：**5 条全绿 + 10 张图都看过 + 一处变异验证**（见上面 §⑥）
- [x] ✅ ⑥ 顺带登记的两条产品边界**已修**（`cbb5517c`）：邀请页新增 `admin-codes`
      列表（码 · 归属人 · 用量 · 建码时间），解锁/调配额/强制登出成功后**回读服务端**
      刷新用户列表的「已锁定」徽标（不是本地乐观补丁 —— ADR-0038）

## 交还用户的一件事

1. **ICP 备案的「提交审核」**：仍然只差用户本人那一下（三个同意项 + 视频核身），
   域名现在真的通了 —— 见 `docs/runbooks/icp-app-filing.md` §一。

> ✅ **原来还挂在这里的「授权第一个管理员」已经做完了**（2026-09-30 在容器里实测）：
> `admin.js list` → `共 1 位管理员：#14 allen030703@163.com 已验证=是`。
> 授权动作本身只能在**容器里**跑（`DATABASE_URL` 的主机名 `postgres` 从宿主机解析不到），
> 且服务器上**不要**用 `pnpm admin:grant`（镜像里是编译产物，生产装依赖带 `--omit=dev`，
> 没有 `ts-node`）：
> ```bash
> ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js grant <email>'
> ```

## 收尾轮（2026-09-30）：把推送后遗留的四项清掉

目标不是"加功能"，是把**几条不会失败的判据**变成会失败的，并且把 §6.1.1 的固定收尾真的跑一次。

### ① `motivation.spec.ts` 两条红 —— 前提先被推翻

`BLOCKED.md` 原来写的「0 个元素 ⇒ 那条 `testID` 接线断了」**是错的**：接线完好，
`任务` 视图恰好渲染 1 个 `[data-testid="today-progress"]`。真因是
**一次已提交的产品改动**（`02fef9a7`：进度卡从"常驻做事视图"收窄成只在任务视图）
而 e2e 契约没跟上 —— 症状在两种原因下长得一样，所以归因只能靠实测。

- 契约改成与决定一致：`CARD_ON=['任务']`，`CARD_OFF` **由 `TABS` 派生**（加视图不会漏）。
- `body 文本 > 60` 那条阈值判据**删掉阈值**：改成 `VIEW_ANCHOR: Record<Tab, string>`
  逐视图断言"它自己的那块板 `toHaveCount(1)`"，再加两条对账（锚点表键 ↔ `TABS` 双向）。
- 顺带修一个抓不到的潜在缺陷：`e2e/tests/helpers.ts` 的 `switchView` label 联合漏了
  `日历`/`搜索`，而调用点早就在传 —— e2e 没有 typecheck，所以它**永远不会红**。
- **三条变异验证**：放宽渲染门 ⇒ `日历 不该显示今日进度卡`(0/1)；把卡挪走 ⇒
  `任务 应当显示今日进度卡`(1/0)；在**产品侧**打断 `habit-board` 的 `testID` ⇒
  白屏检测精确红在 `习惯` 一个视图。改完 **7 passed**、`check:ai-e2e` 整组 exit 0。

### ② `verify:i18n-failures` 4 条红 —— 全是探针锚点过期，不是产品缺陷

| 真因 | 修法 |
|---|---|
| 锚点写死 `packages/i18n/dist/index.js`，多入口 + code-split 后词条在 `chunk-*.js` | 新增 `i18nDistFileWith()` 在 dist 里现查"真的含这条锚点"的那个文件；0 命中 / 多命中 / 无 dist **一律抛错**（不静默跳过） |
| 注入目标 `apps/web/src/features/sync/sync-failure-copy.ts` 已被 M3 第四刀删除 | 注入改打共享层 `packages/ui/src/sync/model.ts` 那张表，跑 `@heyta/ui` 自己的 `sync-model.spec.ts`（读源码，不受 dist 新鲜度影响） |
| 移动端锚点随同一刀消失 | 换成当前调用点 `const key = syncFailureMessageKey(status.reason);` ⇒ 置 `undefined`，"已知原因各有各的句子"必红 |

全量 **91/91 符合预期、exit 0**；用例总数仍是 91（没靠删用例变绿）。

### ③ `check:docs` 的死角：「本机有、仓库里没有」

`research/tools/docs-link-check.mjs` 原先只按**文件系统**解析链接 —— 指向被 `.gitignore`
拦住的产物（`icp-app-filing.values.local.md`）或本机 agent 目录（`.agents/skills/…`）的链接
**永远绿**，而在干净检出（CI 的唯一形态）上是死链。现在：

- 判据换成两半：**本机不存在** = 死链；**本机有但 `git ls-files` 没有** = 独立一档，判红。
- 目录不参与（git 不跟踪目录）；**未被跟踪的文档里的链接**也不参与（本机草稿不该卡别人）。
- 要放行必须显式登记进 `UNTRACKED_LINK_OK` 并**写一句理由**（同 §3.2 许可证 `REVIEWED_OTHER` 的手法）；
  拿不到 `git ls-files` ⇒ **exit 1 并说明"这一半无法执行"**，不静默通过。
- 实测：208 个 md / 1352 条链接 / 335 条章节引用 / 54 个锚点，两条既有链接已登记（命中 2 + 1 次）。
- **三条注入**：① 删掉那条登记 ⇒ 红并逐条点出 `icp-app-filing.md:65 / :270`；
  ② 在被跟踪文档里加一条指向未跟踪临时文件的链接 ⇒ 红在 `:279`（跑完删掉，回 exit 0）；
  ③ `PATH` 里没有 git ⇒ 红并说明拒绝给出"通过"的结论。

### ④ 四端重装（AGENTS §6.1.1）—— **23:16–23:32 那一轮：四端全绿、`REINSTALL_EXIT=0`**

`bash scripts/reinstall-all.sh` 完整执行（**没用 `--skip`、没用 `--only`、没降判据**；
全量输出 `/tmp/heyta-reinstall3.txt`，四张截图**都真的打开看过**）：

| 端 | 结论 |
|---|---|
| mac | ✅ 重打 → 公证 `Accepted` → `The staple and validate action worked!` → 装进 `/Applications` → 截图 `2124x1508` / 内容 100.0% / **主蓝 62**（门禁判的是那张 WebView 快照） |
| windows | ✅ 源码包 14M 送过去 + **sha256 新鲜度对账通过**（`web-dist/index.html=4a0761e2c76f7203…`）→ 远端 `ADD_APPX=OK` / `PAYLOAD_WEBDIST=True` / `M2D=OK` / `RESULT=OK` |
| android | ✅ APK 重打 63M → 模拟器全新安装 → 截图 `1080x2400` / **主蓝 9279** |
| ios | ✅ Release 重打 → 全新安装 → **已装的包比源码新** → 截图 `1206x2622` / **主蓝 9450** |

⚠️ **这一节此前写的是"两端因环境红"（mac 无屏幕录制权限 / windows 主机不可达）—— 两条都不是终态，
而且 mac 那条的归因本身就是错的**：那一轮红在 `swift build`（两个**当时未跟踪**的 Swift 文件），
`reinstall-all.sh` **第一段就失败**，连打包都没走到。那两个文件后来由它们的**所有者提交了**，
`swift build` 现在报 `Build complete!`；windows 打包机也已接回。
完整对账（含"§4 与 §7 在同一文件里互相矛盾、用 `heyta-reinstall2.txt:6` 判掉"那条）写在 `BLOCKED.md` §4 / §7。

读上面这张表必须一起读的**两条**限定：

1. **装的是当前工作树，不是 `origin/main`** —— 本轮工作树仍有 24 处未提交，分属另外两条会话
   （`apps/desktop-macos/**` 的存储宿主线；`apps/landing/**` + `packages/design-system/**` +
   `packages/i18n/**` + `packages/ui/**` 的文档中心 / 排版线）。
2. **mac 的"全新安装"只对视图成立，不对数据成立** —— 那张 WebView 快照里仍看得见
   另一个会话留下的探测任务（`B-mac-*`），它们落在另一条存储路径上，这次清理没覆盖。

### 这一轮的门禁现状

`pnpm check` **整条链 exit 0**（22:59:17 那一次，46 段全过，含 `check:macos-window`、
`check:ai-e2e`、`check:docs`、`pnpm -r test`；`sync-server` 因沙箱里 `prisma generate`
EPERM 排除，它本身只贡献 1 skipped / 0 passed）。
⚠️ 这里此前写着"**除 `check:macos-window` 之外**全部 exit 0" —— 那是**旧状态**，
第 20 段后来在整链里跑绿了（判据行 `STORAGE=shell` / `STORAGE_HOST=on`，
要核的那一行在 `<tmpdir>/heyta-macos-m2-gate-<pid>.txt`，**不在链日志里**）。

⚠️ 一次批量里 `check:journey-coverage` / `check:ai-e2e` / `pnpm -r test` **各红过一次**，
**单独重跑三条全绿** —— 与另一个会话的 `pnpm build`（tsup `clean: true` 会先删 dist）并发撞上去了。
记在 `BLOCKED.md` 第 4 项末尾，别照着它归因到代码。

---

# 本轮 PROGRESS — 帮助中心 → SSOS 式文档中心（goal 1790782112262-64a449）

> 规格真身：`docs/plans/help-center-docs-expansion.md`。本轮记录只追加，不动上面几轮。

## 开工回执（≤10 行）

1. **目标**：`/help` 从"1 hub + 6 篇（只有 2 个分类有正文）"扩成**五个分类都有 ≥2 篇真内容**的文档中心，
   补分类页、侧栏折叠 + 移动端抽屉、自动页内目录、搜索、真界面配图，中英两版同时成立。
2. **顺序**（按依赖排）：结构骨架 → 内容写满 → 配图 → 搜索 → 收口。内容排在配图前：
   图是插进已有分区的，先有正文才有地方放图。
3. **让步顺序**：内容说得对 > 结构齐全 > 页面数量多。§5 那 25 条禁语是法，同义改写绕过也算失败。
4. **最大风险**：`docs.ts:60` 用 `Extract<…, { path: \`/help/${string}\` }>` 判"什么算一篇文章"，
   分类页的路径形状 `/help/<分类>` **同样匹配** ⇒ 会被当成文章、强制要 `DOCS_ENTRIES` 正文。
   必须先加判别字段（`docsKind`）收窄派生类型，再注册分类页。
5. **第二风险**：`pages.ts` 不许有相对的运行时导入（生成器直接 type-strip 加载），
   新增字段的类型要写在本文件里。
6. **第三风险**：i18n 两个 locale 文件是共享碰撞面（另一条线在改），提交按行/hunk 过滤。
7. **基线（2026-09-30 实测，任务 0 已核对，三条全绿）**：typecheck exit 0、
   `screenshot:verify` 18 个目标全过、`check:landing-e2e` **6 passed**。

## 任务 1 结构骨架 ✅（2026-09-30）

**交付**：分类页 `/help/sync`、`/help/data`（只给有文章的分类建，绑模块走
`DOCS_CATEGORY_MODULES` 那道 `Record`，漏绑编译不过）；侧栏分组折叠（`hidden={!open}`
+ CSS `[hidden]{display:none}`，**收起是"看不见"不是"不存在"**）；文章页自动页内目录
（`DocsToc` 吃 `article.sections` —— 与渲染 `<section id>` 是同一份数据，不手写第二份清单）。

🔴 **注册表的读法**：`SITE_PAGES` 是 `as const` 元组 ⇒ 元素类型是逐条字面量对象的联合，
没标 `docsKind` 的成员在类型上**没有这条属性**（TS2339），而"只含可选字段"的参数类型
会撞上 weak type 检测（TS2345）。走接口读一遍就都对：`const ALL_PAGES: readonly SitePage[] = SITE_PAGES;`。

**验收**：`pnpm check:entries` 绿（33 份入口）；`pnpm check:design` 绿（未新增 token）；
landing typecheck exit 0；`pnpm check:landing-e2e` **9 passed / E2E_EXIT=0**
（基线 6 条逐字未动，新增 3 条：分类页 / 折叠能收能开 / 点目录滚到那一节）。

**反向验证**（三条一次注入，`/tmp/heyta-landing-e2e-mutation.log`）——
`3 failed / 6 passed / E2E_EXIT=1`，每条红在它该管的那一句判据上：

| 注入 | 精确报红 |
|---|---|
| `DocsNav` 分组 `aria-current` 判据取反 | 「当前分组指向本页」 |
| `DocsNav` 改成 `{open && articles.map(…)}`（收起即卸载） | 「收起后链接仍在 DOM 里（只是不可见）」 |
| `DocsToc` 改成 `sections.slice(1)` | 「目录条目必须等于渲染出的分区（目录：#when-it-syncs #what-the-server-cannot-see）」 |

三处**已逐字还原**（`grep` 复查零命中），还原后重跑 → `9 passed (13.1s)` / `E2E_EXIT=0`。

**§6.2 规定一：四张图都打开看过**（`e2e/landing-results/`）——
`landing-docs-category.png` 分类页 = 速答三条 + 深入阅读四张卡 + 侧栏当前分组亮蓝；
`landing-docs-groups-open.png` 两分组展开、6 条链接、当前篇蓝色药丸；
`landing-docs-groups-collapsed.png` 收起那组 4 条链接消失、另一组不受影响、箭头从 `⌄` 变 `›`；
`landing-docs-toc-scrolled.png` 滚到第三节「服务端到底看不到什么」，标题正好在吸顶导航下沿。

## 任务 2 内容写满 ✅（2026-09-30）

**交付**：新增 **8 篇**有正文的文章（不是目标里的 9 篇 —— 见下面「为什么是 8 篇」），
五个分类每个都有 **≥2 篇真内容**。每篇 = `SITE_PAGES` 注册表条目 + `DOCS_ENTRIES` 正文
+ 中英两套词条。分类页扩到 5 个（start / organize / sync / data / trust）。

**数字**：`site.docs.*` **272 条 / 每语言**，中英**零单边**（`check:ui-language` 判据）；
locale 总数 zh **2339** = en **2339**；`/help/**` 提交物 **40 个入口**（20 篇 × 2 语言）；
`check:entries` 全量 **55 份入口** exit 0。

### 为什么是 8 篇而不是 9 篇（两处折叠，不是少写）

| 原计划的独立文章 | 折进了哪里 | 为什么这样更好 |
|---|---|---|
| 「功能模块开关怎么关」 | `first-run.s3` + `views.s5` | 开关是**设备本地偏好**（不进 op-log），这句话的产品意义就是"换台设备要重开一遍" —— 拆成独立一篇会让它在侧栏里跟"怎么建任务"平级，读者反而找不到 |
| 「设备增删与退出所有设备」 | `loss.s2w1` | 「丢了三样东西」那篇的第二条警告本来就在讲设备，另起一篇会逼读者为一条警告读一整个页面 |

🔴 折叠的判据不是"我觉得顺"，是**让步顺序**：内容说得对 > 结构齐全 > 页面数量多。
凑第 9 篇 = 拿页面数换内容质量，方向反了。

### 反向验证：三条新判据能不能失败（`/tmp/heyta-mutation.log`）

三处注入（脚本 `/tmp/heyta-mut/{inject,unject,run}.sh`，一次性工具，不入库）：

| 注入 | 打在哪 | 期望抓住它的判据 |
|---|---|---|
| A | `docs.ts` 的 `loss` 条目删掉 5 条 `bodyKeys` ⇒ 正文只剩 7 段 | 「正文段落数（死规矩 ≥ 8）」 |
| B | `DocsCategoryPage.tsx` 卡片列表混进 sync 分类的四篇 | 「卡片必须恰好等于侧栏这一组的文章」 |
| C | `en.ts` 的 `site.docs.loss.title` 误填成中文原标题 | 「英文页标题不该含中文」 |

**结果：注入后 `4 failed / 8 passed`（原 6 条逐字未动全 ✓），还原后 `12 passed`。**

⚠️ **预期 3 红、实际 4 红，这不是"多红了一条就算过"**：多出来的是 `770` 那条
（五个分类页可达），因为注入 B 改的是**卡片数据源**，同一次渲染同时被 `439`（单页判据）
和 `770`（五页循环）抓住。红得多是**判据覆盖更宽**的证据，但我原话写的是"恰好 3 红"，
所以这里必须更正：**"恰好"这个词用错了** —— 一条缺陷打中两条判据是正常形状，
写预期时应该写"红必须落在这三条新判据上、原 6 条不许红"，而不是数条数。

**指纹还原**（完成条件 2 的证据，逐字相同）：

```
56e3e8d9de13038a82a544745120745be28845d1a6c6f545c70c3b987836ab4d  apps/landing/src/site/docs.ts
e5ec32e58f3d42aab6ddc14c6ef45a38f9843b35d4b2baf2d752fd3b73f2ef9e  apps/landing/src/pages/DocsCategoryPage.tsx
8090183773e212b5762fd4249da452ae410eeeccae1ea518a1d8ae2a89c6c3ff  packages/i18n/src/locales/en.ts
```

en.ts 是**共享碰撞面**（另一条会话在改它），所以还原用的是**单行反向替换**
（`unject.mjs` 正则匹配那一行、要求恰好一次、已干净则短路），**不是整份 `cp`** ——
cp 会把别人那 222 行改动一起覆盖掉。还原后 `git diff --stat` 对该文件仍是 222 行，
我那一行回到 `'Three things you can lose: which one comes back'`。

### 本轮踩到的两个坑（都已修，都不是产品缺陷）

1. 🔴 **第一次变异跑执行了 0 条测试**：`cd e2e && npx playwright test docs-centre` 用的是
   **默认 config**，而默认 config 的 webServer 是 `apps/web` dev（**:4318**），
   那个端口是另一条会话的 —— 报 `Error: http://127.0.0.1:4318 is already used`。
   landing 套件必须显式 `--config playwright.landing.config.ts`（:4320）。
   ✅ 修法两层：① 两条 playwright 命令都带 config；② **注入前**加 `lsof -iTCP:4320` 闸门，
   端口不空闲就 `exit 8` **在动手改工作树之前**退出 —— 否则一次白跑会把三处缺陷留在树里。
   ⚠️ 有意**没有**用 `scripts/check-ai-e2e-preflight.mjs`：它会 `SIGKILL` 占端口的进程，
   而那台 vite 是别人的（§7 那条"并发互杀取证"）。
2. **`docsArticlesOf()` 是侧栏和卡片**共同**的数据源**（`docs.ts:689`），所以注入 B 如果
   改那个 filter，"卡片 == 侧栏这一组"这条判据在结构上**永远抓不到**（两边同时变错）。
   注入点必须放在卡片层（`DocsCategoryPage.tsx` 的消费处）。
   📌 一般规律：**判据要能失败，先要看清两个观测量是不是同一个变量导出来的。**

### §6.2 规定一：八张图都打开看过（`e2e/landing-results/`）

五个分类页（start / organize / sync / data / trust）+ 三篇文章页（含一篇英文版），
结论：分类页 = 速答 + 深入阅读卡片，侧栏当前分组亮蓝；文章页正文段落数与目录条数一致，
**页面上没有出现过词条 key 字面量**（那条判据也在跑）。

## 任务 3 配图 ✅（2026-09-30）

**交付**：`apps/landing/scripts/gen-help-figures.mjs`（映射 → 复制进
`apps/landing/public/assets/help/<文章>/<Wxx>-<slug>.png`，`--check` 逐张比 sha256、
比对尺寸、查孤儿产物）+ `src/site/helpFigures.ts`（**每篇一份扁平清单**，没图就写
`[]` —— 新增文章时必须回答"该不该配图"）+ `PageSections` 的 `figures` 插槽 +
`.lp-figure` CSS（全 token）+ e2e 两条新判据（**14 passed**，基线 6 条逐字未动）。

**图号不是人写的**：`图 <章>-<序>`，章 = 文章在 `SITE_PAGES` 里的序号（14/15/20/25），
由 `docsFiguresOf()` 渲染期算；前缀词「图 / Figure」在 i18n 里，**不拼进 number**。
`docsFiguresOf()` 对不认识的分区分**直接抛** —— 图挂错地方会炸在构建期，不会静默画歪。

**五张图**：first-run/W01、concepts/W03、views/W02 + views/W05、trash/W07。

### 🔴 一处「建议」偏差：没有往 `targets.mjs` 追加目标

任务书建议追加真界面目标。**实际用了已提交的 18 张产物**（`W01`/`W02`/`W03`/`W05`/`W07`
正是四篇要的那几个视图），一张都没重抓。理由：目标表是**判卷侧的文件**，
追加目标等于让 `screenshot:verify` 的通过口径跟着本轮走 —— 而复用现有产物时它 18 个目标
**一字未动仍然全绿**，这才是"没破既有裁决"的证据。真的需要新视图时再追加。

### EN 版整片不挂图（已记 BLOCKED.md）

`DocsArticlePage` 用 `locale === 'zh-CN' ? docsFiguresOf(article) : []`。
18 张产物全是中文界面：`capture.mjs:117` 写死 `locale: 'zh-CN'`，而它是**判卷文件**碰不得 ⇒
本轮英文配图在结构上做不到。**英文页面因此没有图，这是一个已知缺口，不是漏渲染。**

### 反向验证（两条都要，一条比一条狠）

**① 生成器会发现复制品失踪**（任务书点名的那条）：

```
❌ 缺少复制品 apps/landing/public/assets/help/trash/W07-trash.png —— 跑 gen-help-figures.mjs
1 处与映射不一致。        CHECK_RED_EXIT=1
```
重跑生成器 → `✅ 配图产物就绪：5 张，本次写入 1 张` → `--check` →
`✅ 配图产物与映射一致：5 张（sha256 逐张对过）` / `CHECK_GREEN_EXIT=0`，
且 `cmp` 证明恢复出来的字节与删掉前**逐字相同**（`RESTORED_BYTE_IDENTICAL=yes`）。

**② 截图校验未破**：`pnpm screenshot:verify` → `✅ 截图校验通过（注册表共 18 个目标；
已生成的均尺寸正确、无 alpha、非空白）`。

### 新判据为什么这么写（防三种"探针够不着"）

- **先滚动再判定**：`loading="lazy"` 的图在首屏外**根本不发请求**，直接读 `naturalWidth`
  会拿到 0 —— 那不是图坏了，是探针没到。helper 逐张 `scrollIntoViewIfNeeded()`
  并等 `complete && naturalWidth > 0` 才开始打分。
- **反向对照**（第 14 条）：**没配图的十篇一张都不许多画**，否则"图挂错文章"这条永远不会红；
  同时断言英文版 0 张图 —— locale 判据被**写反**时，段落数、目录、状态码全都还是绿的。
- **期望表写在 spec 里、不从注册表导入**：判据要是 `docsFiguresOf()` 导出来的，
  "图号对不对"就变成自证（同任务 2 那条 `docsArticlesOf()` 的教训）。

### 两处刻意的取舍

1. `<img>` **不写** `width`/`height`：尺寸事实源是 `targets.mjs` 的 viewport × scale，
   再在渲染处写一遍就是第二份真相。`--check` 已经从同一处推导并比对过。
2. `aspect-ratio: 8 / 5` 写在 CSS 里并**注明它是抓图预设**（1440×900），
   不是审美取值 —— 这条纪律在 `check:design` 下是裸值，写注释是为了让下一个人知道它从哪来。

### §6.2 规定一：人眼看过（`e2e/landing-results/`）

`landing-figures-first-run.png`（图 14-1）、`landing-figures-views.png`（图 20-1 + 20-2）、
`landing-figures-concepts.png`、`landing-figures-trash.png` + 四张 `-en` 对照（0 图）。
图号、图注、宿主分区、真中文界面全部对上。
⚠️ 元素级截图会把**吸顶导航 / 吸顶侧栏**拍进图中间 —— 那是 Playwright 截 `#main` 的产物，
不是版面缺陷（整页截图里没有）。

## 任务 4 搜索 ✅（2026-09-30）

**交付**：`apps/landing/src/site/DocsSearch.tsx`（新）+ `docsSearchHits()`（`docs.ts:754`）
+ 两处挂载（`HelpPage.tsx:59` hub 自己一份、`DocsLayout.tsx:78` 分类页与文章页那一份）
+ CSS `.lp-docs__search*`（全 token；结果列表在流内，不给 `position`/`z-index`）
+ i18n 5 条 key、中英各一份（`site.docs.search.label/placeholder/clear/none/truncated`，
改完照 §7 第 79 条重新 `pnpm --filter @heyta/i18n build`）。
e2e 基线那 14 条逐字未动，新增 2 条 → **16 passed (45.5s)**。

### 🔴 一处「建议」偏差：没有生成 `search-index.json`

任务书建议"生成静态 `search-index.json` + 前端过滤"。**实际是渲染期从注册表派生** ——
`docsSearchHits()` 读 `SITE_PAGES` 与 `DOCS_ENTRIES` 的分区 key，索引里没有文案。
理由三条：

1. **生成物只能带 key**，而标题必须用**当前 locale** 解一遍才能匹配"中文页搜中文标题"。
   多一张 JSON 就是把 key 抄一遍、再多一个必须同步的产物：改了词条没重生成，
   搜索会搜到旧标题，**而没有任何一层会报错**。
2. 入口页本来就是构建期生成的，再加一步 `gen:search-index` 等于多一条构建链
   与一个必须挂进门禁的 `--check`，收益是 0。
3. 「零新依赖」这条仍然成立，而且比生成方案更彻底 —— 没有产物、没有生成脚本。

代价说清：搜的范围是**已注册的标题（文章 + 分区）**，搜不到正文里的词。这是刻意的：
规格要的是"搜标题、跳锚点"，把正文进索引，那 8 条结果全是噪音。同一条记 BLOCKED.md B4。

### 锚点契约只验能确定的那一半

命中分区 → href 带 `#<section id>`。**跨页滚动不验**：这是 MPA（`main.tsx` 按 pathname
选页面），一次点击是整页重载，而目标 `<section>` 是 React 渲染出来的 —— "到了没有"
取决于时序，写成断言就是一条会随机红的判据。✅ 换成**两个方向都确定的那条**：
带 `#` 的行，那个 id 必须真的在目标页面上渲染出来（`anchorsByPage()` 按目标路径分组 →
打开那一页 → 数 `section.lp-row` 的 id；**期望值从浏览器里取**，不写死锚点清单），
再配一条"`#` 与 `data-section` 属性必须同起同落"（spec:1131）。

其余钉住的：只搜**当前 locale 的标题**（英文版出汉字即红）、`MAX_RESULTS = 8`（`DocsSearch.tsx:47`）
与那句"仅显示前 {count} 条"用的是**同一个常量**、结果**只在输入时挂载**（所以
`#main .lp-docs__link` 那几条冻结计数不受影响）、空态文案里**不许出现词条 key 字面量**、
窄屏 390×844 上**全页恰好一个**搜索框且不靠抽屉就能用（`drawerOpen === false`
+ 不横向溢出 + 高度 > 20）。

### 反向验证（红 → 绿）

把 `hitHref()` 那行临时改成 `return base;`（带 `MUTATION-INJECT` 标记，分区行不再带锚点）：

```
Error: 带锚点的行必须标 data-section：/help/passphrase/[false] /help/passphrase/[true]
       /help/passphrase/[true] /help/loss/[true]
1 failed
```

两次运行（含重试）都红，报错信息**直接把坏掉的 href 列出来**。还原成逐字相同的那一行后
`PW_EXIT=0` / `16 passed`。📌 那条"锚点必须真在页面上"（:1145）这次没跑到 ——
一条缺陷先被更靠前的判据抓住，这是判据覆盖更宽，不是更弱的证据。

### §6.2 规定一：两张图都打开看过

`e2e/landing-results/landing-docs-search.png`（1280×900，`/help/` 输「口令」→ 4 行，
每行标题都含「口令」，其中三条带锚点）、`landing-docs-search-narrow.png`
（390×844，`/help/sync/`：搜索框在正文之上、抽屉没开、页面无横向溢出）。

## 任务 5 收口 ✅（2026-09-30）

### 门禁链：七段全绿

一条命令后台串行跑完七段，退出码逐段落盘（`/tmp/task5e.txt`）：

```
S1_typecheck=0  S2_check_entries=0  S3_ui_language=0  S4_docs=0
S5_screenshot_verify=0  S6_help_figures=0  S7_landing_e2e=0
```

对应数字：入口页 **55 份**与注册表逐字节一致；词条表 **zh 2379 / en 2379**（工作树口径，含另一条线那批）；
死链检查 **215 个 Markdown / 1367 个相对链接**零死链；截图 **18 个目标**尺寸正确、无 alpha、非空白；
配图 `--check` 的 sha256 全对；landing e2e **17 passed (1.1m)**。

`S4_docs` 这一条在上一轮是 **1**，红点就是 `docs/plans/help-center-docs-expansion.md` 自己 ——
任务书里那句「⚠️ `pnpm check:docs` 会对那两个新计划文件报"未跟踪"——预期，别删文件、别改白名单」预告的就是它：
`docs/plans/README.md` 新增的那一行指向它，而 `check:docs` 只认 `git ls-files`，
一个只在本机存在、仓库没跟踪的计划文件在干净检出（CI 的唯一形态）上就是死链。
三条出路里选了门禁**自己列出的第 ① 条**（`git add` 它）。
📌 留着的原因是它的形状：**判据没错，错的是"文件先写、提交在后"这个顺序** —— 预告过的红不等于没抓到的红。

### 🔴 真正的红：第 17 条 test 抓出 `data` 组只有一篇有正文

上一轮 `S7_landing_e2e=1`，报错是 `data：中文版有正文的文章数（死规矩 ≥ 2）Expected: >= 2, Received: 1`
（`docs-centre.spec.ts:1295`）。这张表当场把病灶指出来：`selfhost` 只渲染出 **3** 段、`transfer` **4** 段，
过不了「≥5 段且 ≥300 字」这条线 —— 也就是**内容薄**，不是判据严。

三条路里前两条都是任务书点名的作弊（**放松断言**、把 `<li>` 算成正文段落），走的是第三条：
**把这两篇写厚**。补了六个分区 × 中英两套共 **23 条新词条**：

| 文章 | 新分区 | 每条主张的事实来源 |
|---|---|---|
| `selfhost` | 起来之后日常做哪三件事 / 备份出来的是密文 / 界面显示离线先看这条 | `server/src/config.ts`（`CORS_ORIGINS` 默认值、生产环境拒通配）、AGENTS §4 |
| `transfer` | 同步与搬文件是两条路 / 为什么只肯导进空库 / 导进去之后核对什么 | `packages/app-host/src/import-dump.ts`（空库闸门与拒绝理由）、`export-dump.ts`（实体清单 + `counts`） |

🔴 有一条原本想写的主张（同步 `ready()` 要地址与令牌同时具备）**查不到可靠出处，直接没写** ——
宁可少一段，不写一句撑不住的。段落数从 3/4 涨到 **11/11**，判据一个字没动。

顺带修掉这条 test 自己的取证缺陷：证据表原来在**循环之后**才打印，
失败时数字全丢，只剩一句 `Expected >= 2, Received 1`。改成每个分类**先打印后断言**
（`rows.push` → `console.log` → `expect`），动的只有打印时机，阈值与断言原样。

### 共享工作树：按 hunk 切，而不是按行切

两个 locale 文件同时被另一条线改（`web.shell.sidebar.resize`、`web.projects.addNew`、
`web.tags.addNew`、8 条 `web.calendar.*`，以及一条**改写** `site.changelog.20261005.body`
的旧版）。**按行过滤会造出重复 key**：本轮有两条改动本身就是**改写既有词条**
（`site.features.pending.body`、`site.help.a.repeat`），只插新行不删旧行，
`check:ui-language` 那个冻结解析器（要求 `entries.size === entryLikeLines`）当场就红。

所以过滤以 **hunk** 为单位，四条规则：改动块里既有我的行又有别人的行 ⇒ **停下来人工处理**；
只有我的行 ⇒ 整块套用（这就是"改写"）；别人的改写 ⇒ **跳过并保留 HEAD 那行**；
纯新增 ⇒ 只留我的行。落地用 `git hash-object -w` + `git update-index --cacheinfo`，
工作树一个字不动（另一条线的半成品仍在暂存区外）。

三道独立复核（都贴了输出）：白名单路径过滤 = 暂存集里没有地界外的文件；
12 条外来 key 在暂存 blob 里 `LEAKED=none`，而 HEAD 的 changelog 那行原样保留；
中英 key 集合相等（`zh=2368 en=2368 onlyZh=0 onlyEn=0`，`site.docs.*` 各 **312** 条，空值 `zh=0 en=0`）。

🔴 第三道不是"我也写一个解析器对一下"：是把 `scripts/check-ui-language.mjs` 里
`const ENTRY = …` 到 `parseCatalog` 结束那一段**逐字切出来**（`FROZEN_PARSER_SHA=2ddab6abd9a9`）、
`new Function` 装上 `readFileSync` 后**直接喂两个暂存 blob**。判卷标准是这个门禁唯一的硬约束
（`entries.size === entryLikeLines`），复现它等于没验。

### 判卷标准没动（指纹复核）

`scripts/screenshots/{png-stats,capture,verify-artifacts}.mjs` 三个 sha256 与开工时逐字相同，
`scripts/check-*.mjs` 与 `gen-entries.mjs` 在 `git diff`／`git diff --cached` 里都是 0 行。
`e2e/landing/docs-centre.spec.ts` 原有 **6 条** test 的函数体逐字包含在最终文件里
（脚本比对：`HEAD_tests=6 verbatimPresentInStaged=6 changed=none`），条数 6 → 16 → 17 只增。
唯一动过的共享部分是 `ARTICLE_IDS` 那份**期望清单**（6 篇 → 14 篇）——
它是判据的输入而不是判据本身，而且方向是收紧：侧栏必须列出全部十四篇。

### 完成条件 1 的实测数字

第 17 条 test 在真浏览器里**数页面段落**（`<p>` with `.lp-prose`，不读注册表），十四篇 × 中英两版：

```
start     first-run   zh 12段/ 732字 · en 12段/2131字
start     concepts    zh 14段/ 751字 · en 14段/2216字   → 中文 2 篇 / 英文 2 篇
sync      how         zh  6段/ 350字 · en  6段/1000字
sync      account     zh  4段/ 301字 · en  4段/ 897字
sync      passphrase  zh  5段/ 318字 · en  5段/1062字
sync      conflict    zh  3段/ 308字 · en  3段/ 978字   → 中文 2 篇 / 英文 2 篇（how、passphrase）
organize  views       zh 13段/ 770字 · en 13段/2492字
organize  repeat      zh 12段/ 784字 · en 12段/2311字
organize  reminders   zh 12段/ 730字 · en 12段/2212字   → 中文 3 篇 / 英文 3 篇
data      selfhost    zh 11段/ 738字 · en 11段/2423字
data      transfer    zh 11段/ 788字 · en 11段/2385字
data      trash       zh 12段/ 723字 · en 12段/2137字   → 中文 3 篇 / 英文 3 篇
trust     privacy     zh 14段/ 873字 · en 14段/2699字
trust     loss        zh 12段/ 670字 · en 12段/2221字   → 中文 2 篇 / 英文 2 篇
```

五个分类**每组的"有正文"篇数**（死规矩 ≥ 5 段且 ≥ 300 字）中英都是 `2 / 2 / 3 / 3 / 2`，
最小的一组是 `sync` 与 `trust`，都过线；`data` 是本轮从 1 篇补到 3 篇的那一组。
入口目录：`check:entries` 报 **55 份**，其中 `/help/**` 实测 **40 份**（每语言 20 = 1 hub + 14 篇 + 5 个分类页），
完成条件 1 那条硬线「≥ 12 篇 × 2 语言」= 24 份，超出一倍有余。
`conflict`、`account` 这两篇段落数低于 5，是从未列入"深读"配额的旧篇 —— 它们仍各自渲染出 300 字以上，
只是任务书要求的"每组 ≥2 篇"由同组更厚的文章兜住，**没有为了让它们过线去改判据**。

🔴 §6.2 规定一：`e2e/landing-results/landing-body-selfhost.png` 是本轮**新截图**（03:27），人打开看过 ——
三个新分区中文正常、页内目录数到 **6 条**、侧栏五组折叠、搜索框在位、页面上没有词条 key 字面量。

## 任务 5 收口：一笔提交 + 干净检出复验（2026-09-30）

提交 `b71546fd`（父 `544c9894`，57 files / +7666 −84，本地一笔，**未 push、未 amend**）。

落笔前三个自查（都针对"共享工作树里别把别人的东西带走"）：

| 自查 | 结果 |
|---|---|
| 索引里的路径是否全在本轮白名单内 | `OUT_OF_BOUNDS=none` |
| 判卷文件指纹（5 份：`png-stats` / `capture` / `verify-artifacts` / `check-ui-language` / `gen-entries`） | 工作树 = HEAD = 索引三处逐字相同 |
| 那 6 条既有断言 | `HEAD_tests=6 verbatimPresentInStaged=6 changed=none`，`skip`/`todo` 计数 0 |

hunk 过滤从词条表里**丢下** 11 个 key：逐个查过全是 `web.*` 且已提交代码零引用（`LEAKED=none`）；
反向再查 landing 代码里 507 处字面 `site.*` 引用在暂存词条里**全部有值**。
按 hunk 而不是按行，是因为冻结判卷器有条硬不变量 `entries.size === entryLikeLines`
（`scripts/check-ui-language.mjs:440-464`），按行摘会留下"键在值不在"的半条词条 —— 那是必红。

落笔后干净检出复验（`git worktree add --detach /tmp/heyta-clean` 挂在 `b71546fd`）：

```
C1_ui_language=0   ✅ 文案合规（扫描 246 个文件、304 处文案；词条表 zh 2368 条 / en 2368 条）
C2_docs=0          ✅ 无死链、无"本机有仓库里没有"的链接、无失效锚点（检查 54 处页内锚点 / 1365 个相对链接）
C5_shot_verify=0   ✅ 截图校验通过（注册表共 18 个目标；已生成的均尺寸正确、无 alpha、非空白）
```

🔴 **诚实记录一条**：同一批里 `check:entries` 与 `gen-help-figures --check` **第一次是红的**，
报 `ERR_MODULE_NOT_FOUND: Cannot find package '@heyta/i18n'`。
那不是内容失败 —— 干净 worktree 没有 `node_modules`，而 `@heyta/i18n` 的 exports 指向 `./dist/*.js`，
**裸检出必须先 `pnpm install` 再构建 i18n**（§7 第 79 条的同族）。补做这两步后：

```
C3_entries=0    入口文件与注册表一致（55 份）。
C4_figures=0    ✅ 配图产物与映射一致：5 张（sha256 逐张对过）
```

所以这两条 gate 在**提交物自身**上成立，CI 上不会因为我这台机器的状态而红。
复验完 `git worktree remove` 摘掉临时 worktree，主检出未受影响。

### 🔴 上面那张自查表里，第一行当初是**量的错东西**（2026-09-30 收尾时发现并重量）

`OUT_OF_BOUNDS=none` 那格用的命令是 `git diff-tree --no-commit-id --name-only -r b71546fd 15a093c4` ——
**`diff-tree` 拿到两个 commit 参数时比的是这两个 commit 之间**，不是"各自对父提交"。
所以它只输出了 1 行（`PROGRESS.md`，即第二笔相对第一笔的差异），过滤白名单后自然剩 0 行。
⇒ 那个 `none` **没有证明任何事**，它量的样本里根本不含第一笔那 57 个文件。
形状和 §7 第 82 条同源：**"命令退出码 0 + 输出看起来对"不等于"判据跑在了正确的对象上"**。

正确的量法是对**整个交付区间**比（父 = 开工前的 `544c9894`）：

```
DELIVERY_FILE_COUNT=57
OUT_OF_BOUNDS=0
=== 按目录归类 ===
   1 BLOCKED.md
   1 PROGRESS.md
  50 apps          ← 全部在 apps/landing/ 下
   2 docs
   1 e2e
   2 packages      ← 只有 locales/zh-CN.ts 与 en.ts
```

结论不变（57 个文件全在白名单内），但**结论现在是被量出来的，不是被猜出来的**。
`BLOCKED.md` 确认在这批里（随 `b71546fd` 提交，工作树无残留）。

### 最终 HEAD（`15a093c4`）上复跑的判据

```
S1_typecheck=0        apps/web / apps/mobile / apps/node-host / apps/desktop 全部 Done
S2_check_entries=0    入口文件与注册表一致（55 份）。
S5_screenshot_verify=0  ✅ 截图校验通过（注册表共 18 个目标；已生成的均尺寸正确、无 alpha、非空白）
LANDING_E2E_EXIT=0    17 passed (1.1m)
```

判卷文件指纹（工作树 vs HEAD，5 份逐对）：`6cee9282` png-stats / `118e9df9` capture /
`cf3b9f05` verify-artifacts / `f38e73fa` check-ui-language / `29de12b3` gen-entries —— 全等。
既有断言对账：`BEFORE(544c9894)_tests=6 HEAD_tests=17 verbatimPresentInHEAD=6 changed=none`、
`skip_or_todo_markers_in_HEAD_spec=0`。

配图反向验证（最终 HEAD 上重跑一次，不引用旧日志）：

```
REVERSE_VERIFY_EXIT=1     ❌ 缺少复制品 apps/landing/public/assets/help/trash/W07-trash.png —— 跑 gen-help-figures.mjs
                          1 处与映射不一致。
REGEN_EXIT=0
RESTORED_CHECK_EXIT=0     ✅ 配图产物与映射一致：5 张（sha256 逐张对过）
sha_before=ce124c26353989db73312d98e6298ff5afe15bb4
sha_after =ce124c26353989db73312d98e6298ff5afe15bb4   BYTE_IDENTICAL=yes
(RESIDUE 为空 = 无工作树残留)
```


---

## 2026-10-01 整改轮：文档中心去开发向 + 自托管篇扩写成开发者级 ✅

起因是产品负责人对上一轮交付的复查指令：「文档中心绝对不能放开发相关的东西。
除非是自托管的那一块，自托管的那个说明 —— 自托管可以写详细开发者的。」
上一轮在任务书自己的标准下全绿（含独立复验），但"口音"这条标准当时不在任务书里，
于是 `purgedAt` / `repeatRule` / `SQLite` / `RFC 5545` / `向量时钟` 全部进了公开正文，
且没有任何一层报错（`check:ui-language` 的禁词表不扫词条表本身 —— 字典里放什么，
页面上就说什么）。

**内容侧**（中英同步改写，段落数保持/只增）：
11 处去开发向（trash 两处 / repeat 三处+删一处 / how 两处 / transfer 两处 /
first-run / privacy 两处）+ hub 速答 `site.help.a.repeat` 同病同修（门禁第一轮抓到的）。
自托管篇 6 节 → 11 节：怎么装（镜像钉版本 / `docker compose up` 不是部署 /
`--build` 的内存与缓存代价）· 环境变量逐个说（`JWT_SECRET` 换掉的代价、
`WEBAUTHN_*` 换域名的代价、`CORS_ORIGINS` 默认指上游演示站、SMTP 六件套）·
数据库与迁移（只向前、超时退出码）· 服务端存了什么（Argon2id + AES-GCM、
明文拒收）· 命令行宿主（十条命令 + `HEYTA_*` 环境变量 + 设不了重复规则的边界）。
新增的每一条论断都对着 `server/env.example` / `server/README.md` /
`server/docker-compose.yml` / `apps/node-host/src/cli.ts` 核过 —— 含"部署机构建峰值
>1.5 GB、缓存每次 ~1.4 GB 不自动清"与"启动迁移默认关，`docker compose up` 单独
拉起来会跑在没迁移过的表结构上"这两条 README 原文数字。

**门禁侧**：新增 `scripts/check-docs-voice.mjs`（`pnpm check:docs-voice`，已接入
`check` 链紧跟 `check:ui-language`）。扫两个 locale 的全部 `site.*` 词条（992 条），
禁词表 30 项，豁免自托管相关 key（`site.docs.selfhost.*` + 平台/集成页 selfhost 段，
共 120 条）。扫描量与豁免量各有一条防呆底线（解析器坏了必须响红，不许静默通过）。

**变异验证**（观测量，非引用记忆）：往 `site.docs.trash.s3p1` 注入 `purgedAt` +
`SQLite` ⇒ **恰好 2 红**、逐条指到同一个 key；往豁免区 `site.docs.selfhost.s9p1`
注入 `Docker` ⇒ **不误杀**（豁免精确）；还原后逐字复绿（992 / 120 / 0 命中）。

**门禁七段全 exit 0**：`check:entries`（55 份）/ `check:ui-language`（zh 2407 = en 2407，
含另一条线工作树里未提交的 key；提交集自身的数字在提交时按 hunk 过滤后另核）/
`check:docs-voice` / `check:docs` / `gen-help-figures --check` / `screenshot:verify` /
landing `tsc --noEmit`；landing e2e 17 条结果见下一条记录。

**边界裁决**（写进了任务书 §11）：RRULE / JSON / Markdown / MCP / API 刻意不进禁词表
—— 界面里就有"自定义 RRULE"输入框、导出的文件就是 JSON、本机 API / MCP 是设置里的
真实开关。禁它们会误杀正确的产品文案。"开发向"的定义：只在代码/部署里存在、
访客无法在界面上遇到的东西。

---

## 2026-10-01 文档中心收尾轮（Goal：B1 英文配图全链 / B5 陷阱入档 / 平台门禁裁决落地）

开工状态：main = `c249c618`，工作树带着另一条线 39 处未提交改动（日历侧栏 /
design-system / 两个 locale / package.json / environment-traps.md）。
基线门禁全绿：`check:entries` 55 份 · `check:ui-language` zh 2407 = en 2407 ·
`check:docs-voice` 992 / 120 / 0 · `gen-help-figures --check` 5 张 ·
`screenshot:verify` 18 目标 · landing e2e 17 passed。
**18 张既有产物 sha256 清单**存开工快照（任务 1 的"zh 逐字节不变"以此对账）。

### 任务 1：B1 —— 英文配图全链 ✅

**关键实测发现（改了实现形状）**：web 应用**刻意不读 navigator.language**
（`apps/web/src/lib/locale.ts` 文件头），Playwright 的 `locale: 'en'` 只改浏览器
协商，**切不动界面语言**。真信号是 `?lang=` 参数（已存偏好 > `?lang=` > 默认中文，
fresh context 无偏好）。⇒ 采集器对非默认 locale 的目标把 `?lang=` 拼进 URL。

- `targets.mjs`：TARGETS 加 `locale` 字段（默认 zh-CN）+ 5 个英文目标
  （W01-en/W02-en/W03-en/W05-en/W07-en，readyText 取 en 词条真实值
  Tasks/Quadrants/Habits/Timeline/Trash，不纳入 appStore）。
- `capture.mjs`：locale 按目标声明进 newContext + `?lang=` 拼 URL（tab 与 path
  两条分支都拼）。**既有 18 张 zh 产物 sha256 逐张与基线相同 —— 中文侧零扰动**。
- 5 张英文截图采集成功；**五张全部人眼核过**（Inbox / Your inbox is empty /
  Quadrants 的 Do now/Schedule/Delegate/Drop / Habits / Timeline / Trash
  全是真英文界面）。
- `helpFigures.ts`：`HelpFigure.locale` 字段；zh 5 条不动、en 5 条成对追加
  （同 sectionId / 同 slug / 同一对词条 key，targetId 指向 en 目标）；
  新增 `assertHelpFigurePairs()` —— 每篇的 (sectionId, slug) 必须 zh/en 成对，
  生成器入口第一个执行它：**映射不成对，一个字节都不写**（这条拦的就是 B1 的
  形状："只给一种语言加了图" e2e 与 --check 都不会红）。
- `docs.ts`：`docsFiguresOf(article, locale)` —— 先按 locale 过滤再编号，
  两语言图号一致（`图 20-1` / `Figure 20-1`）、文件互不串。
- `DocsArticlePage.tsx`：locale 闸（`locale === 'zh-CN' ? … : []`）删除，
  改为按 locale 取图。
- en 词条两处与实测截图不符的修正：first-run 图注 "Done" → "Completed"
  （英文界面侧栏真实标签）、timeline alt 去掉英文页没有的"当天完成数"。
- **变异验证**：把 en first-run 的 targetId 指回 `W01`（图源变成中文产物）
  ⇒ e2e 第 14 条 **1 failed，红在「第 1 张必须是英文界面产物」**；还原后
  整套 **17 passed**。⚠️ 这条变异 `--check` 抓不到（同名复制品内容一致）——
  正好证明第 14 条的浏览器判据**有独立的重量**。

### 任务 2：B5 —— diff-tree 陷阱入档 §7 ✅

`docs/reference/environment-traps.md` 追加**第 90 条**（编号取当前最大 89+1；
89 是另一条线工作树里未提交的条目，已提交最大 88）。内容 = B5 实测
（diff-tree 两参比 A↔B 不是各自对父 ⇒ 空测量）+ 一般规律"对账命令先证明
自己量到了该量的样本"，同批把同一天的姊妹款（hunk 过滤只比对增行、漏判对方
改写自己正文的 hunk）写进同一条。AGENTS §7 索引表补 `86–90` 行。
BLOCKED.md B5 标记已入档。
⚠️ 提交纪律：该文件工作树里对方 #89 在我前脚、紧贴文件尾 ⇒ hunk 过滤切不开，
走 **HEAD + 我的条目**重建式暂存（与 package.json 同法）。

### 任务 3：平台门禁跳过分支 —— 分界落地 ✅

裁决（Goal 采纳任务书 §10 建议案）：**平台不符 / 工具链不存在 ⇒ 合法跳过
（exit 0 + 响亮 SKIP）；平台与工具都在、取证失败 ⇒ 判红**。
逐条对过四个脚本：`check-macos-shell`（非 darwin / 无 swift 跳过，其余全硬
失败）、`check-windows-shell`（无 dotnet 跳过）、`check-linux-shell`（平台 /
GTK 依赖缺失跳过）—— 三条的跳过本来就全在合法一侧，**未动**。
唯一违背分界的是 `check-macos-window` 的 **exit 4（ScreenCaptureKit 未授权）
→ 静默跳过**，改为**判红**并写明修法（系统设置给终端授屏幕录制权限）；
文件头的跳过/判红分界说明同步改写。

**变异验证**：把 `CAPTURE` 指到 exit 4 的桩 ⇒ 门禁 **exit 1**，红在
「不再静默跳过（2026-10-01 裁决）」与授权指引上；还原后零残留
（`git diff` 里 MUTATION 计数 = 0），真实跑一遍见下方退出码。
**非 darwin / 非 Aqua 分支本机无法实测 ⇒ 未改动、如实记录"未实测"。**
（"有 Aqua 会话却取不到图"那条本来就是判红，未动。）

**真实门禁第一跑红了 —— 而且红得有价值**：交叉验证尺寸不一致
（自截图 2240×1440 vs 独立截屏 2124×1508）。排查 = **§7 第 81.3 条的现场重现**：
机器上常驻**用户自己装的** `/Applications/Heyta.app`（标题同为 "heyta"），
`window-id.swift` 只按标题筛、`head -1` 撞上用户的窗口 —— 拿**正在使用中的产品**
的窗口尺寸跟取证实例的自截图比，必红；而这个"僵尸"既不能杀也不该杀。
修法（取证链内的最小消歧）：`window-id.swift` 加可选 `--pid` 过滤
（`kCGWindowOwnerPID`；不带参数行为与过去完全一致），
`capture-window.sh` 传入自己起的实例 PID（`$CROSSCHECK_PID`）。
**重跑：交叉验证 2240×1440 = 2240×1440 ✓**（退出码见文末）。
⚠️ 这一处动了 `apps/desktop-macos/scripts/`（超出 Goal §8.3 预告的文件清单）——
理由：不修它，"取证失败判红"这条裁决在这台**开着 heyta 的主力机**上永远跑不出绿，
门禁会从"静默跳过"变成"永远假红"，两个方向都不诚实。

### 门禁收尾（最终 HEAD 复跑，退出码见文末清单）

`check:entries` / `check:ui-language` / `check:docs-voice` / `check:docs` /
`gen-help-figures --check`（**10 张**）/ `screenshot:verify`（**23 目标**）/
landing `tsc --noEmit` / landing e2e（**17 passed**，含改写后的第 14 条）/
`check:macos-window` 真实跑。

本轮只动 apps/landing、scripts/screenshots、scripts/check-macos-window.mjs、
packages/i18n、e2e/landing、docs/、BLOCKED.md、PROGRESS.md、AGENTS.md（§7 表）——
不产出客户端包，**四端重装不适用**（沿用 b71546fd 先例）。

**真实门禁的完整经过（六跑，每一跑都有结论）**：

| 跑 | 结果 |
|---|---|
| 1 | 交叉验证尺寸不一致（2240×1440 vs 2124×1508）⇒ 红 —— §7 #81.3 现场：用户自己装的 Heyta.app 撞进按标题选窗的清单 ⇒ 修：`window-id.swift --pid` 消歧 |
| 2 | 交叉验证 ✓ 但脚本 10 分钟超时（ETIMEDOUT）⇒ 新问题现形 |
| 3 | 复现超时；受控实验证明壳对 TERM 正常退出（独立 8 秒起停）⇒ 挂点不在应用 |
| 4 | 每 15 秒采样进程树：卡的是交叉验证的 `node -`（stdin 模块）—— 打印完「尺寸一致」不退出，`sample` 抓到它在 ESM 求值微任务里 100% CPU 空转 |
| 5 | 换成脚本文件 `crosscheck-dimensions.mjs` 后首跑：**取证脚本自报 exit 4（ScreenCaptureKit 未授权）⇒ 新分支响亮判红** —— 旧代码这里是静默 exit 0 假绿，正是 §10 要堵的形状；这条红线在真实世界（不经注入）自己触发了 |
| 6 | **exit 0 全绿**：窗口非空不透明、CAPTURE_METHOD=screencapturekit、交叉验证 2240×1440=2240×1440（PID 消歧）、快照 contentOnModalRatio 达标、M2 身份入口/菜单合规/滴答导入面板全过 |

🔴 顺带把一个潜伏的形状钉死了：交叉验证的比对是 heredoc `node -`（stdin 模块），
**红了能跑、绿了挂死** —— 失败路径秒退（run 1 之前从没人等它走完成功路径），
成功路径把 bash 的 `wait` 挂到门禁 10 分钟超时。已改为仓库标准形态
`crosscheck-dimensions.mjs`（判据逐字保留：1x/2x 归一判等）。

### 收尾验收清单（最终工作树逐条退出码）

```
pnpm -r typecheck                                → exit 0
pnpm --filter @heyta/i18n build                  → exit 0
pnpm --filter @heyta/landing gen:entries         → exit 0（入口 4 份图注/alt 相关更新随提交）
pnpm check:entries                               → exit 0（55 份）
node scripts/check-ui-language.mjs               → exit 0（zh 2407 = en 2407）
node scripts/check-docs-voice.mjs                → exit 0（site.* 992 / 豁免 120 / 命中 0）
node research/tools/docs-link-check.mjs          → exit 0
node apps/landing/scripts/gen-help-figures.mjs --check → exit 0（10 张，sha256 逐张）
node scripts/screenshots/verify-artifacts.mjs    → exit 0（注册表 23 目标）
pnpm --filter @heyta/landing exec tsc --noEmit   → exit 0
pnpm check:landing-e2e                           → exit 0（17 passed，含改写后的第 14 条）
node scripts/check-macos-window.mjs（真实跑）      → exit 0（第 6 跑；第 5 跑按新分界响亮红）
zh 产物对账：18 张 sha256 与开工基线逐张相同        → BYTE_IDENTICAL=yes
变异验证：e2e 第 14 条（en 图源指回 zh 产物）        → 1 failed 指到断言；还原 → 17 passed
变异验证：门禁 exit 4 桩                          → exit 1 红在授权指引；还原 → 零残留
```

本轮不产出客户端包，四端重装不适用（沿用 b71546fd 先例）。
（任务 3 相关）四条平台门禁各自的退出码与 SKIP/FAIL 行 —— 在最终 HEAD（1030a560）实跑补齐：

```
node scripts/check-macos-shell.mjs   → exit 0（darwin + swift 在 ⇒ 真跑：swift 冒烟 32 项断言全过，
                                       「跨语言那一层 + 落盘 全部通过」——非跳过，是实测）
node scripts/check-windows-shell.mjs → exit 0（本机有 dotnet ⇒ 真跑：esbuild 打包门面 + C#↔TS 冒烟
                                       22 项断言全过，含「C# 独立读壳的 .sqlite」——非跳过，是实测）
node scripts/check-linux-shell.mjs   → exit 0 + SKIP 行：「当前平台是 darwin —— Linux 原生壳的冒烟
                                       已跳过（本壳依赖 GTK4 与 libjavascriptcoregtk-4.1，
                                       装不到 macOS/Windows 上）」—— 合法跳过（平台不符）
node scripts/check-macos-window.mjs（真实跑）→ 第 5 跑 exit 1 红在「取证 exit 4 ⇒ 不再静默跳过」
                                       授权指引（新分界在真实世界首次触发）；第 6 跑 exit 0 全绿
```

四条的裁决分界在实测中的落点：两条**真跑全绿**（比"合法跳过"更强的证据）、
一条**合法跳过**（平台不符，SKIP 行含原因）、一条**判红分支真实触发过**
（exit 4 授权指引）且修复环境后**真实全绿**。

### 部署记录（2026-10-01）：文档中心三轮上线生产 ✅

- **范围**：仅落地页（`/var/www/heyta-landing/`）。server 零牵连（`check:server-copy`
  「2 种语言 × 50 条」/`check:server-design`「41 个」双绿，无需重建镜像）；
  `apps/web` 无改动，`/app/` 不动。
- **构建来源 = 干净 detached worktree @ `2b2f1cb8`**：共享工作树里另一条线未提交的
  changelog 词条改写**不随构建上线**（产物 grep「入口没接上」= 0、HEAD 版词条 = 1）。
  构建带 `VITE_SITE_URL=https://heyta.waytofuture.cn VITE_APP_URL=https://heyta.waytofuture.cn/app/`
  （deployment.md §3.7.2 的现值）。
- **上线**：先备份 `~/heyta-landing-backup-20261001-121659.tar.gz`（488KB，回滚用，保留）
  ⇒ `rsync -az --delete dist/ ubuntu-jcli:/var/www/heyta-landing/`。
- **线上验收**：9 条 URL 全 200（含 `/assets/help/first-run/W01-en-tasks.png` 为
  `image/png`、`/app/` 200、`/health` 200）；主 bundle 与 zh 词条 chunk **线上字节 ==
  本地构建（cmp 逐字节相同）**；canonical = `heyta.waytofuture.cn`；「立即使用」
  指向 `/app/` 在 bundle 内；zh chunk 含新分区（要配的环境变量 / 命令行宿主）、
  旧句「命令行宿主只能」= 0。
- **真浏览器**：`playwright.live-site.config.ts` **6 passed**；补两发截屏判定 ——
  `/help/selfhost/` 命中「要配的环境变量」、`/en/help/first-run/` 命中 `Figure 14-1`
  （英文页真挂英文图）、console/pageerror = 0。

### 链 5（2026-10-02，Goal「同意先于任何请求」G-11 / G-12）：真浏览器判据补上，并抓出一条**只在生产构建里存在**的缺陷

**这一轮的净结论**：`apps/web` 的"未同意零出站"从**单测级**升级为**真浏览器 + 生产构建**级，
而正是这条新判据把我自己在同一轮里引入的产品缺陷照了出来 —— 当时在场的 **95 条单测级判据**（还没有下面那 4 条）对它全绿。

| 层 | 判据 | 变异验证 |
|---|---|---|
| `packages/app-host`（闸门本体） | 26 条 | 30 个臂逐个红 |
| `apps/web`（启动序列 + 面板 + 读态） | 38 条 = 8 + 17 + 9 + 4 | 每个关键断言各一臂 |
| `apps/mobile`（同一道闸） | 35 条 | 拿掉闸门即红 |
| 🔴 **真浏览器（生产构建）** | **7 条**：未同意 ⇒ 出站清单为空 **且** `getRegistration()` 为 `null`；同意 ⇒ **同一个量翻过来** | `networkAllowed: () => true` ⇒ **恰好 3 红**，还原后 7 绿 |
| 合计 | **99 条单测级 + 7 条真浏览器 = 106 条** | — |

**照出来的真缺陷（§7 第 103 条）**：把 `registerWidgetServiceWorker()` 从 `main.tsx` 顶层
挪进 `startupNetwork.arm()`（= `await initOpLog()` **之后**）之后，它内部那句
`window.addEventListener('load', …)` **挂在 `load` 已经放完之后 ⇒ 永远不触发**，
症状是**生产构建里 Service Worker 从来不注册**，而且**控制台零输出**。
dev 构建（`import.meta.env.PROD` 为假）与 jsdom（没有 SW）都看不见它 ⇒ 单层判据永远绿。
修法：调用时按 `document.readyState` 分流（已 `complete` 就直接注册），
新单测 `apps/web/tests/pwa-register-readystate.spec.ts` 4 条钉住四种形状。

**第二条入档的取证教训（§7 第 104 条）**：我原先写的正向对照「同意之后出站清单里出现
`/sw.js`」**永远不可能满足** —— Chromium 取 SW 脚本不经过页面的请求流，
`page.on('request')` 收不到它（注册明明成功，请求事件 0 条）。
换成 `navigator.serviceWorker.getRegistration()` 做对照 + 一次分类器自检（页面自己
`fetch('/sw.js')` 必须数得出），否则"零出站"那条是恒真。

**接进门禁**：根 `package.json` 新增 `check:privacy-consent-e2e`（**先重建 `apps/web/dist`**
再跑，§7 元规则 3），已插在 `check:ai-e2e` 之后进入 `pnpm check`。
本轮复跑：**7 passed**（改法务文案之后重跑，仍是 7 绿）。

**法务文本跟着事实改（不留假话）**：privacy / data-rights / minors 三份的"修订记录"
去掉过期承诺；⚠️ 我改的时候把**内部缺口编号与仓库路径写进了对外正文**，
`public-copy-register` 的「公页不许说贡献者语言」两条当场判红 ⇒ 在**源**上修掉六处，
重跑两个生成器 + `@heyta/i18n` build，`check:legal-copy` / `check:server-legal` /
`check:legal-host` / `check:entries` / `check:ui-language`（zh 2650 = en 2650）/
`check:docs` / `check:claims` / `check:docs-voice` 全绿，legal **57** / landing **1303** 全绿。

**全量单测**：18 个包跑完 —— app-host 42 文件、mobile 31、ui 22、landing 22、web 95 通过 /
2 跳过，**只剩 1 条红**：`apps/web/tests/habits-list-pane.spec.tsx:311`（习惯图标选择器），
归属**并行会话未提交**的 `HabitIconPicker/HabitsList/HabitsView` + 新文件
`packages/design-system/src/icon-size.ts`，本轮一行没碰 ⇒ 取证与修法登记在 `BLOCKED.md` **B9**。
server 侧本轮新增的 `terms-consent-version.spec.ts` **12 passed**（单独跑，pglite）。

🟡 **未闭合**：**G-33 只剩移动壳那半**（首启面板的模拟器/实机截图）。它需要
`pnpm reinstall:mobile` 把当前产物装上设备，而那会把另一条会话的半成品一起装上去（§7 第 82 条），
所以按「做不了的登记为缺口」处理，不在本轮硬做。转 `effective` 之前必须补。

### 2026-10-02：仓库整理轮（基线审计 → 两个大文件拆分 → repo-cleanup Skill）

**先拿数字再动手**（同口径命令，排除生成物/证据目录）：

| 信号 | 基线 | 结论 |
|---|---|---|
| 文件行数 Top | App.tsx **2603**、app.css **3163**、landing.css 2775（i18n/法务/server-spec 属天然聚合，剔除） | 前两个是本轮目标 |
| >120 列长行 | 1502 行 / 121 文件，**85% 是词条/法条单行字符串** | 不动（手拆字符串零收益、伤 zh/en 同步） |
| 重复块（jscpd, ui+web） | 31 克隆 / 506 行 / **0.97%** | 不动（反漂移纪律在起作用） |
| 死代码（knip） | 未配 entry ⇒ 输出全是桶导出误报 | **登记为下轮候选**（先配 entry 再信） |

**执行（两个纯移动提交）**：

1. `App.tsx 2603→2198`：导航/视图登记 + NavButton/EmptyState/isActive 搬进
   `features/shell/{view-tabs.ts,NavButton.tsx,EmptyState.tsx}`。承重配套：
   landing 外壳对账按**源码文本**解析声明块 —— 读取路径跟着搬，并修掉一个
   注释锚点碰撞（新文件注释含 `const ALWAYS_ON_VIEW_TABS` 字面串 ⇒ indexOf
   先命中注释 ⇒ 对账拿空）。
2. `app.css 3163→聚合器 30 行 + 14 模块`：@import 顺序 = 原文件顺序 = 级联顺序
   （narrow.css 媒体块压最后）。两道按路径锚定的门禁跟着搬：排版豁免表
   **归一化模块路径回聚合器**（组合数一个不多一个不少）、ht-* 族棘轮改扫全部模块。

**判据**：web 1353 / landing 1303 全绿；check:design / check:row-single-source 绿；
vite build 产物含首尾模块内容；**真浏览器双主题截图人已看**（三栏结构完整、
深色是深蓝灰非反色、零 pageerror）。

**方法已固化**：`.agents/skills/repo-cleanup/SKILL.md`（审计→计划→执行→收尾四阶段，
含"按路径/按文本读代码的门禁盘点"这条实测出的收尾清单）。

### 2026-10-02：四端重装（§6.1.1 固定收尾）—— 3 端直过，iOS 修了两个真问题后过

| 端 | 判据 | 人眼看图 |
|---|---|---|
| mac | 安装副本自截屏 1082x716、主蓝 **1306** | ✅ 三栏完整、蓝白、中文 |
| windows | ADD_APPX=OK + RESULT=OK + PAYLOAD_WEBDIST=True + M2D=OK（远端 sha256 对账先过） | ✅ 真应用 + 身份菜单 |
| android | APK 63M 重打、全新安装、主蓝 **4036**；首启=隐私同意面板，点「同意并联网」后主界面主蓝 **9279** | ✅ 两段都看了 |
| ios | 重打 → 全新安装 → 新鲜度 → 主蓝 **5355** | ✅ 隐私同意首启面板（中性提问复核） |

iOS 端的两个真问题（都入档）：

1. **构建失败（traps #106）**：清过 `ios/build` 后首次 xcodebuild 必撞
   Generate Specs 竞态（脚本阶段只声明了 log 一个输出，编译与生成并行调度）——
   报"文件不存在"而构建结束后文件全在。修法 = pod install 预生成（安装期
   `run_codegen!`）。同轮确认：已提交的预编译版 Podfile.lock 在本机（路径含
   空格）无法再生，带 `RCT_USE_PREBUILT_RNCORE=0` 跑出来的源码构建图
   （+1115/−260）`check:native-deps` 仍绿，本次随提交接受切换。
2. **启动即黑屏（真产品缺口，已修）**：iOS 26+ SDK 构建的应用在 iOS 27.1
   运行时**强制 UIScene 生命周期**，RN 0.84 模板的经典 AppDelegate 不满足 ⇒
   UIKit 拒绝启动、纯黑屏、进程活着（构建全绿、界面判据全红）。补
   `SceneDelegate.swift` + Info.plist 场景清单 + AppDelegate 的
   `configurationForConnecting`（单场景，窗口创建与 RN 挂载挪进场景代理）。
   ⚠️ 排查时先被"截图黑"带偏：这台机器唯一运行时 iOS 27.1 只支持折叠屏
   iPhone Duo（双显示器），另一会话建的实例把内容渲在截不到的那块屏上 ——
   新建一台 Duo 后同一构建主蓝 5355，证明应用本身没问题。

📌 本轮人眼验收的教训（自我纠错记录）：验证截图时我曾两次复用**别的截图的
URL** 去做分析、还被**带引导词的提问**骗出过一次"确认"——全部作废重验。
有效结论一律以「文件自己上传的 URL + 中性提问 + png-stats 客观数字」三重
一致为准。

### 2026-10-02（续）：iOS 交互验收补跑 —— 修两把夹具刀，核心链路已绿；余项与流程固化

**进度**（`IOS_UDID=<Duo>` 六轮迭代，最后一轮 59 过 / 7 失败）：

- ✅ **核心链路全绿、无 mock**：FAB → Composer → op 落真 SQLite（ops 0→1、
  opType=CRT、向量时钟含自己）→「同步」→ 服务端 → **笔记本（node-host 真
  SQLite）读到同一条**；uploadStatus pending → uploaded；实时通道
  wsConnections ≥ 1。
- ✅ 夹具两刀（traps #108/#109）：滚动三魔数从 iPhone 17 Pro 继承导致
  Duo（逻辑屏 678）上"阈值内≠可见、起点在屏外"——改为从 AX 树
  Application frame 实时推导；「添加」子串撞「排序：按添加时间」⇒
  composer_open 恒真——shim 加 `--exact`。同轮：modal 清理循环补隐私
  面板出口（「以后再说/同意并联网」，验收语境选"以后再说"，同意这个
  法律决定留给真人）；"不在树上就跳过"在**全新安装语境**收紧为如实红
  （它此前会把"页面状态不对"洗成"可能已设好"）。
- ⬜ **余 7 红**（未定论，修复 agent 撞用量上限中断）：集中在两簇 ——
  ①输入原语（idb 的 type 在这台 27.1 Duo 上多次"回读 0 字符"）；②**自动
  同步腿**：凭据齐、手动同步通，但"不点按钮 360 秒自出去"不触发
  （Android 同判据绿）——**若复现稳定，这是产品线索不是夹具线索**
  （§7 元规则一：先怀疑探针，已怀疑过两轮，剩下的要按产品查）。
  下轮从「Automerge 上行去抖在 iOS 前台/后台态的判定」查起。

### 2026-10-02（晚）：B10 当日闭合 + traps #110 机制化收口（#113）

两件同日收口，都是"把借口删掉、让红绿回到真实"：

**① B10：服务端补上一次性登录链接令牌的签发能力**（`POST /api/test/mint-login-link`，
TEST_MODE 才注册）。根因：`/create-user` 给的是 JWT 访问令牌，而应用「粘贴邮件里的
链接或令牌」吃的是 ADR-0039 邮件链接流的一次性令牌 —— 形态不匹配，主路径 12+ 轮
结构性走不通。修法：`auth.ts` 抽出 `mintLoginMagicLinkToken()`（生产发信与 test 路由
**同一个函数**，形态不可能分叉），test 路由对已验证邮箱强制新签一枚、不发邮件直接返回。
判据三层：单测 4 条（含 🔴 **往返**：路由吐的令牌被生产 `verifyLoginMagicLink` 换出带
`tokenVersion` 的会话；变异 = 路由改回返 JWT ⇒ 恰好 2 条承重红）；真服务端 curl 往返
（mint 64hex → 产品端点 verify 200 → 同令牌二刷 401）；run14 主路径真实走通。
相邻 4 个 spec 共 69 条全绿（行为等价重构）。`verify-mobile-ios.sh` 的
**MAINPATH_GAP 降级注记整体删除** —— 主路径走不通从此是真红。

**② traps #110（脚本运行中被编辑炸假语法错误）机制化**：27 个长跑
verify/reinstall 脚本入口加**自快照 bootstrap**（同目录 `.原名.snap.PID` 拷贝 +
`exec` 副本；守卫用 `$0` basename 而非 env，避免漏给子脚本），`.gitignore` 收快照名，
新门禁 `check:script-snapshot` 进 `pnpm check`（标记须在前 15 行 —— 挪到尾部等于没有；
删块/挪位两种变异都实测红）。**A/B 实验证据**：无 bootstrap 的脚本被运行中编辑后，
**注释行的内容被执行成命令**（`command not found` on a comment line —— 错位铁证）；
有 bootstrap 的同一编辑零影响、快照自清。本轮 run14 就是活例：它跑在快照上，
期间我改了源文件的注释，运行实例无感。详见 traps #113。

**run14–run20 经过（同晚，环境战）**：run14 折在构建 —— 并行会话 `pnpm install`
使 Pods 工程失配（traps #115，`pod install` 9 秒对账即愈）；run15–17 三连同死在
"文字送不进"，重启模拟器无效，最终定性为**宿主机被打满**（另一项目的 vitest×4、
WindowServer 94%、simruntime 进程 92% 空转，负载 128）—— iOS 27.1 模拟器的
无障碍桥**整机阵亡**（对照实验：系统设置 App 的树也读不出；App 进程活着、
界面在渲染）。隔离轮 run20（专属模拟器 + 专属 /tmp）证到：**此前 12+ 轮全红的
输入原语与 op 落库全绿**，主路径 UI 步待安静窗口补。配套落地：模拟器专属实例
（`simctl create` iPhone-Duo）+ 脚本四个隔离旋钮；ADB 挂死探针加超时（traps #114）。

**21:2x–21:35 第二段（负载回落后的归因战）**：宿主 `intelligencetasksd` 从 20:23
崩循环约一小时（26 份 Swift XPC entitlement 断言 —— macOS 27.2 beta 系统病），
期间**所有**模拟器的 AX 桥整机阵亡（App 活着、界面在渲染、树全空；traps #122）；
崩循环停后重启模拟器即恢复。iOS 27.1 seed 只认 Duo（iPhone 全系 create 403）⇒
下载 27.0 全量运行时，建 `heyta-iphone-17pro`。**归因判决（数据库级）**：主树 App
提交即崩 ×5 份 .ips；干净 HEAD worktree 构建同一操作 **ops=1 落库、App 存活** ⇒
崩溃源是并行会话**未提交的在途文件**，已提交代码无责。27.0 输入原语差入档
（traps #121：set-value 不进 RN 状态、HID 无中文 keycode，ASCII 全路径实测可用）。


---

# 本轮 PROGRESS — 多端入口对齐·第二批（Goal 1791013705594-6dec11，开工 2026-10-03 15:4x）

## 开工回执（≤10 行）

1. **目标**：把移动端与 web 之间那批「零件都在、没人接线」的差集接上——便签编辑链、
   清单/标签改名与归档、习惯改名/删除、成长三件（热力图/周小结/补打卡）、移动端权益可见，
   每条带可复跑判据，最后 `pnpm check` 全量绿 + 四端重装绿。
2. **顺序**：任务 1（判据登记补齐）**排在所有功能前**——因为每批功能都要新增判据，
   而本仓已实测有 6 个真机脚本"写了没人登记"（无别名 / 不在 MANIFEST），先把这个洞堵上，
   否则本轮交付会重演同一件事。然后 2 便签链 → 3 改名删除 → 4 成长与权益。
3. **让步顺序**：判据真实 > 功能做完 > 做得快。
4. **最大风险**：`packages/i18n/src/locales/{en,zh-CN}.ts` 与 `package.json`、
   `packages/ui/src/index.ts` 此刻**正被并行会话改着**（实测 28 个白名单路径为 `M`），
   而每条新词条都必须动 locale。⇒ 提交一律走「HEAD + 只我的 hunk 重建暂存」，
   绝不整文件 `git add`（本仓 2026-09-30 那轮有先例与做法）。
5. **第二风险**：`apps/mobile/src/screens` 的 l4 内联样式基线**已顶格 90** ⇒
   新屏一律走 `apps/mobile/src/ui/kit` 与样式表，一个 `style={{}}` 都不许新增。
6. **第三风险**：新动作（`renameTag` / 习惯改名）会连带触发 `check:reachability`
   与 op-log 纪律（一个意图一个 op），且**不许 bump `CURRENT_SCHEMA_VERSION`**。
7. 任务 0 三条基线已核对：`check` 链 **62** 段、l4 基线 **104 / 90**、mobile spec **35** —— 全部与任务书一致。

## 任务 1 判据登记补齐 ✅（2026-10-03 16:0x）

**做了什么**（四件，全部只动地界内的文件）：

| 件 | 落地 |
|---|---|
| 6 个别名 | `package.json` 新增 `verify:mobile-account` / `-reminder-ring` / `-quadrant-fill` / `-sort-sheet` / `-task-row` / `verify:universal-slice` ⇒ **`no_alias` 6 → 0**（29 个 `verify-*.sh` 现在全有别名） |
| 2 个进 MANIFEST | `check-script-snapshot.mjs:37-68` 加 `verify-mobile-account.sh` 与 `-reminder-ring.sh`（28 → **30 条** = `reinstall-all.sh` + 磁盘上全部 29 个 `verify-*.sh`）⇒ **`no_manifest` 2 → 0** |
| 那两个文件补 bootstrap | 它们**原来整块都没有**（任务书只说"进 MANIFEST"，实测进之前必须先加块，否则门禁按判据正确报红）。块从 `verify-mobile-quadrant-fill.sh:3-19` **逐字复制**，标记落在**第 3 行**（判据上限 15） |
| 过期理由改成实测 | `check-script-snapshot.mjs:19-23` 那段「它俩未跟踪 / 已暂存未提交」被 `git ls-files` 否证 ⇒ 重写为「前提实测过期 + 显式清单剩下的两条真实理由 + **本门禁不查漏登记**」 |

**journey-coverage 的 mobile 册**：2 条 → **25 条**（`check-journey-coverage.mjs:87-…`）。收录判据写成三条同时成立
（有 `verify:*` 别名 / 真机零 mock / 验的是一段用户旅程），并把「原来只有 2 条」归因到与本门禁文件头
同一条失效形状（手写清单漏掉的不是细节，是整个条目）；`covers` 那句「真机脚本待独占模拟器」也已换成实测读数。

**`verify-mobile-lists.sh:377`**：`psql -h … -U rocalight -d … 2>/dev/null | sed` 那种"只打印不判定"改成
四个 env 可覆盖（`HEYTA_E2E_DB{,_USER,_HOST,_PORT}`，沿用 `verify-mobile-auth.sh:125-126` 已有约定，
默认值等价）+ **读数不是纯数字就 `bad()`** + `0` 也 `bad()`。
两分支都实测过：真库回 `0` ⇒ 走判定分支；`-d bogus_db` ⇒ `psql: error: … does not exist` 进 `bad()`（**不再静默**）。

**验收读数**（每条都在对话里贴了原文）：`check:script-snapshot` ✅ 30 个脚本 exit 0；
`check:journey-coverage` ✅ 五端全过（mobile 25 个）`JOURNEY_EXIT=0`；`bash -n` 三个改动脚本全过。

**反向验证（两条变异 + 一条机制冒烟）**：
1. 删 `verify-mobile-account.sh` 的 bootstrap 块 ⇒ `❌ … 缺自快照 bootstrap` exit **1**；`cmp` 证明还原逐字节相同后 exit **0**。
2. 删 MANIFEST 里的一条 ⇒ **exit 0（不红）** —— 任务书那条"必须红"的前提不成立，已登记 **B36.1** 待拍。
3. 机制冒烟（`/tmp/g6/snaptest`，不入库）：用同一段块跑 `probe.sh`，运行途中往源文件追加 30 行 ⇒
   `RUN-AS: …/.probe.sh.snap.53835` + `STILL-ALIVE after source edit` + exit 0 + 快照零残留 —— 新加的两块**真的在跑**。

**顺带撞出的两条真问题**（都记在 B36）：`check:shell-unicode` 在**当前 HEAD 上是红的**（`mutate-closeout-gates.sh:223/232/242`，
`cc974fbd` 提交，地界外 ⇒ 不代改）；同批扫出的 `verify-mobile-repeat.sh:675` 在我地界内、已就地修成 `${XY15C}`。

### 任务 1 的两条更正与一条事故（2026-10-03 16:1x）

1. 🔴 **完成条件里"62 段"要写明载体**：HEAD（`76cbee51`）上是 **61** 段 —— 第 62 段
   `check:op-log-semantics` 是并发会话**未提交**的 package.json 改动。任务 0 量的 62 没错，
   但它是工作树读数（同一段代码在 22:48 红 57 条、22:55 全绿那个形状的同族）。
2. 🔴 **HEAD 上 `check:shell-unicode` 是红的**（3 处 `mutate-closeout-gates.sh`，地界外）⇒
   "check 全量 exit 0"目前不由本条线单独可达，见 B36.2。
3. ⚠️ **我自己造了一次共享工作树事故并已还原**（全程记在 **B37**）：为让 package.json 只带我的 hunk
   做了 temp-swap，而备份那步 `cp` 因为同一行里 `sh -c` 的引号解析失败**整行都没执行**，
   于是覆盖了并发会话那 2 行未提交改动；已按覆盖前 diff 原文逐字重建（`git diff --numstat` 回到 `2/1`）。
   往后本条线的规矩：**temp-swap 前 `test -f 备份 || exit 1` 写进同一条链**，副作用事后必须测量。

### 任务 3 改名与删除（2026-10-03 17:4x，本条线）

**做了什么**（两端 + 共享层 + 词条，无新依赖、无 schema 变更）：
- 动作层：`renameTag`（新，`packages/app-host/src/project-actions.ts`）、`renameHabit`（新，`habit-actions.ts`）各**一条 UPD、载荷只有 `name`**。
- 移动端：`ListsSection`（改名 + 归档/取消归档 + 「显示已归档」开关）、`TagsSection`（改名）、
  `HabitsScreen`（改名内联框 + 删除），`icons.tsx` 补 `action.rename`（与共享层那支铅笔同字形）。
- web：`features/projects/{store,ProjectsPanel}` 补 `renameTag` 调用点 + 标签行 rename；
  `features/habits/{store,HabitsView}` 补 `renameHabit` 与**已有却零调用点**的 `deleteHabit`。
- 共享层：`archivedProjects()` 进 `projects/model.ts` 并从 `@heyta/ui` 导出（两端「哪几条算已归档」不再各写一遍），
  `OrganizerList.tsx` 补它缺的 `Check` 图标导入（这是 UI 包 dts 构建当时唯一失败原因）。

**判据（现量）**：`apps/mobile/tests/organizer-rename.spec.ts` **26 条全绿**；
`pnpm --filter @heyta/mobile test` = **39 files / 612 passed / 0 skipped**（开工基线 35 files）；
`pnpm --filter @heyta/web test` = 114 files / **1562 passed**（13 skipped 是既有的浏览器 E2E 默认跳过，非本批新增）；
`check:reachability` / `check:ui-language` / `check:l4` / `check:row-single-source` / `check:layering` / `check:design` 各 **exit 0**；
mobile 与 web 的 `typecheck` 均 0 错。三个新改动屏的 `style={{` 计数 = **0**（棘轮 90 不许净增）。

**两条变异，各自精确转红再还原转绿**：
1. 摘掉 `ListsSection` 的整个 `onRename` 块 ⇒ `接线：入口在两端都真的连着` 那条红（**1 failed | 25 passed**）；还原后 26/26。
2. 给 `renameTag` 的载荷多塞一个 `color: '3'`（重建 `@heyta/app-host` 后跑）⇒
   `AssertionError: expected [ 'name', 'color' ] to deeply equal [ 'name' ]`（**1 failed | 25 passed**）；
   还原源码 + 重建，`grep -c 'color: "3"' dist/index.js` = **0**，26/26。

**一条产品裁决（自己拍的，理由写进代码）**：只给 `onArchive` 不给 `includeArchived` + 显示开关 = **单向门**，
所以三条必须同批落地；标签**不接归档**（`Tag` 没有 `archived` 字段，不是漏做）。

**未做/已登记**：新建清单的父级选择器（P2-6 的另一半，见 B40）；web 侧行为用例（`apps/web/tests/**` 在地界外，见 B38）。

## AI 覆盖面收口（Goal 1791019648012-9e53f6，2026-10-03 15:2x–20:0x）🟡 三项闭合 / 一项挂上游

细节全在 `docs/plans/ai-event-tool-contract.md` §15.5–§15.9，本节只放**带载体的读数**（抄件必漂）。

**① 合并 🟡 —— "并成一条集成线" ✅，"落到本地 main" 🟡 未做（01:3x 现量：11 个别人未提交的文件挡路，
`git merge-tree` 反而 rc=0 零冲突；落地代价与逐条归属在 `BLOCKED.md` B65）** ——
`feat/ai-entity-coverage` + `feat/assistant-history-local-persistence` +
`integrate/2026-10-03-closeout` 并成一条集成线。落地形状**从快进改成带对账的合并**，因为 `main`
在这批工作期间前进了三次（`792f9b2d` → `192a516d` → `1694b7d0` → `120c8153`）。
预演 `git merge-tree --write-tree` 零冲突；两侧文件交集**只有 i18n 两份词条表**，逐条量过：
三处参照键数 2850 / 2841 / 2860、重复键 0、单边键 0、算术闭合；合并结果 tree 与预演预测
`b08b020c` 逐字节相同。

**② 集成态验证 ✅ 有一趟有效读数，🟡 合并后的复核被环境挡在门外** —— 最新一趟：载体
`heyta-wt-ai-closeout @ 187057bb`（01:34 起跑，负载门 load≈12 放行），`pnpm -r build` **rc=0**，
逐段链 **73 段 = 64 绿 / 8 红 / 1 按规则不跑**（`check:ai-e2e` 会 SIGKILL 别人在 4318/4319 的 vite，
traps #87 ⇒ 记"未跑"不记"通过"）。8 条红逐条带归属在 `BLOCKED.md` **B65**，一句话版本：
65 `check:shell-unicode` 是**本批自己的**（6 处 `$VAR` 紧跟中文 ⇒ 值被吞），已当场修完并复跑该段 rc=0；
其余 7 条属成长/详情/日历/总接线/W9/自托管×vault 六条线，其中 26 与 31 两条门禁**根本不在 main**，
落地当天才显形。五条隐私不变量在这一趟里全部有 rc=0 的段号（43/44/61/63 + 24/25/27/50）。
🔴 顺带量到"落地会把 main 从 **63 段** 带到 **73 段**"，新增的 10 段是别人的门禁 —— 见 B65。
01:4x 在并行会话两次 merge 之后的 `2e50ee97` 上复核：四条**源码级** gate 仍 rc=0，
而 `check:privacy-consent-e2e` 翻红 —— **现量否证成"不是产品"**：`priorityColorToken` 在
`packages/ui/src/index.ts:1097` 有、`packages/ui/dist` 里 0 命中（dist 落后于合并后的源码，
traps #27/#79 那一族），我补跑的 `pnpm -r build` 又撞到 `apps/node-host` DTS 阶段 `TS7006`，
而单跑那个包**是过的**、端口两版逐字相同 ⇒ 多 tsup 抢同一棵 dist 的竞态。现量 `load 515` +
对端 7 个构建进程 ⇒ **按环境无效记录，不降级判据**，重开条件写在 B65。
（前一趟读数：载体 `10dc0bd4` 的"61 段 / 断在第 51 段 `check:ai-e2e`"已过期 —— 段数与红集都换了，
🔴 但那句"第 54 段 `check:shell-unicode` 在 main 上是红的、本线 `1a6640f2` 已修，落地会让它从红变绿"
**只对了半天**：后来那批 W1–W4 旋钮把同一写法长回来了 6 处，本轮再修一次 ——
"修过"从来不等于"不会再漂"，能等于的只有常驻门禁。）

**③ 交付 ⏸（不是判据不够，是载体刚被改过 + 环境无效）** —— 四段现状：mac ✅（B61 已闭合，
安装副本自截屏非空白且主蓝命中）、Windows ✅（任务 #29，判据五条住进 `scripts/lib/msix-install-facts.sh`，
用户点名的「自动创建快捷方式」实现与判据齐）、Android ✅（23:35 拿到绿读数）、iOS 🟡 未闭合（B62，
三台 `Booted` 全有主）。🔴 新情况：01:4x 之后载体的源码被并行会话两次 merge 改过，
而 §6.1.1 这条固定收尾装的是**当前产物** ⇒ `pnpm reinstall:all` 必须在**新尖端**重跑才有效，
此刻 `load 515` + 对端 7 个构建进程 + 设备被占 ⇒ **环境无效，未跑**（不降级判据、不拿旧读数顶）。

> 🔴 22:0x 现量把上面这段里**我自己写错的两处**改掉，原文形状留在下面，因为它们是同一种错的两个实例：
> ① 原句写"四个读取点已接上" —— 实际是**一个**调用点（`reinstall-all.sh:249 msix_check_facts`）
> 读一份**五项**清单（`scripts/lib/msix-install-facts.sh` 在 `:158` 被 source）。"多个读取点"
> 在这里不是优点，恰恰是要避免的形状：同一条判断写四遍才会漂。现量：
> `grep -c msix_check_facts scripts/reinstall-all.sh` = 1。
> ② 原句只写 `install-and-capture.ps1:110-133` 不带目录 —— 本仓 `scripts/windows/` 与
> `apps/desktop-windows/scripts/` **两处都有 ps1**，光给文件名会让下一位去敲一条不存在的路径
> （本轮就是这样撞了一次）。另：该脚本 `LC_ALL=C grep '[^ -~\t]'` 命中 **0** 行 = 纯 ASCII 成立
> （AGENTS §6.1 那条 PS 5.1 的硬要求）。

**③ 22:36–22:42 第一次真跑的实际结局：4 端里 1 端绿、1 端红、2 端是我主动停的** ——
守门（连续两次干净采样）放开后 `step3` 于 22:36:22 起跑，起跑现场由脚本自己记：
载体 `133550d7`、工作树未提交 **0**、`emulator-5554 device`、windows-pc `REACHABLE`。

| 端 | 结果 | 判据行 |
|---|---|---|
| windows | ✅ | `源码包 31M` → `远端新鲜度对账通过（web-dist/index.html=217cae2a252d8948… bridge=bae7d24d7a6a5320… assets/*.js=7 枚一致）` → `远端打包 + 安装 + 启动截图完成` → **`远端取证：判据齐了：5 条全在位`**（即 `ADD_APPX/RESULT/PAYLOAD_WEBDIST/M2D/SHORTCUT_OK`，**用户点名的快捷方式这项第一次随真跑绿**） |
| mac | 🔴 | `package-app.sh` 在"④ 启动验证"就失败：`sandbox_extension_issue_file_to_process … Operation not permitted` + ScreenCaptureKit `-3811` ⇒ **装新那步从未执行**（现量：`/Applications/Heyta.app` mtime 仍 **19:05**，`/tmp/heyta-macos-dist/Heyta.app` 是 **22:37**）。签名部分完好（`valid on disk` / `satisfies its DR` / `V5S2LT9YV8`）。两个候选归因与隔离复跑判据登记在 **`B61`** |
| android | ⏹ 我停的 | 该段刚进 gradle 构建，而 22:41 现量并行会话的 `verify-mobile-reminder-ring.sh`（pid 50463）**正跑在同一台 `emulator-5554`** 上；下一步就是 `adb uninstall` ⇒ 会清掉别人正在验的设备。AGENTS §8 第 9 条禁止并行覆盖共享设备，故 `kill` 我自己那段（取证 `~/scratch-heyta/reinstall-2236/ABORTED-mobile.txt`） |
| ios | ⏹ 未起跑 | 同上中止 |

停的代价与善后都写明：**这轮不算 ③ 完成**（只有 1/4 端拿到"装上且是当前产物"的判据），
也不算产品失败（mac 红未定性、mobile 是环境不许并行）。中止后清掉载体里那个未跟踪的
`apps/mobile/android/.kotlin/` —— 它会被 `git ls-files -co --exclude-standard` 当"未跟踪非忽略"
送进 Windows 的源码包，留着就等于让"远端 == 本地工作树"这条对账比的是**一个带脏缓存的树**；
现量 `git status --porcelain` 回到 **0**。

**③ 23:04–23:1x 第二趟（两段式闸门跑，载体 `8a947a16`→`eedb3759`，起跑时工作树 0）：段 1 两端全绿**

| 端 | 结果 | 判据行（只认 summary 行与退出码） |
|---|---|---|
| mac | ✅ **B61 闭合** | `✅ 打包完成` → **`✅ 已安装到 /Applications/Heyta.app`**（上一趟这一步从未执行）→ `✅ 窗口 1092x723、heyta-reinstall-mac-installed.png.webview.png 内容占比 100.0%、主蓝命中 1266 —— 是共享 UI`（阈值 20；历史上那张真界面是 1269，同一量级）→ `stat` 现量安装副本 mtime **23:05:40** > 产物 **23:04:48**。**人真的打开了那张图**：深色收集箱 + 全 rail + 首屏「在使用联网功能之前」同意门（`同意并联联网` / `只用本机` + 服务条款/隐私政策） |
| windows | ✅ 五条再取一次 | `远端新鲜度对账通过（web-dist/index.html=217cae2a252d8948… bridge=bae7d24d7a6a5320… assets/*.js=7 枚一致）` → `远端取证：判据齐了：5 条全在位`，逐条现量：`ADD_APPX=OK` / `RESULT=OK` / `PAYLOAD_WEBDIST=True` / `M2D=OK` / `SHORTCUT_OK=True` |
| 汇总行 | 如实 | `⏭ android：本轮显式跳过（--skip）—— 这端**没有**验证当前产物`（ios 同）—— 段 1 的"没装的端大字列出"这条设计在第二趟仍然成立 |
| android / ios | ⏹ **环境无效（exit 3），本轮未拿到读数** | 23:18:53 重投（载体 `302442fe`，起跑时工作树 0），闸门全过（3 次干净采样 + 负载门 23:19:34 放开），起跑 **30s** 后监视器命中真对端并中止我自己这段：`92196 bash …/01_PROJECTS/heyta/scripts/.verify-mobile-reminder-ring.sh.snap.92196`（**主检出路径**，不是我载体里的）。这是今晚**第二次**同一形状（第一次 22:41 pid 50463，见上表）⇒ `B62` 那条"共享设备没有锁"现在有两次独立取证。**不降级判据、不拿旧 APK 凑装**，也不另起 AVD（理由写在 B62 末段） |

🔴 这一趟和上一趟的**闸门差别**才是 ③ 能连绿两次的原因：负载判断交回仓内单一所有者
`scripts/lib/wait-for-quiet-host.sh`（我手写的两版抄件都坏过，一版从不参与判定、一版比较恒假），
设备占用那一半才留在我自己的脚本里（仓内没有它的所有者 = `B62`）。

**③ 23:27–23:5x 第三趟（载体 `2d79d625`→`3a4d9175`）：android 拿到绿，代价写在下面；ios 按环境无效记**

| 端 | 结果 | 判据行（`~/scratch-heyta/reinstall-gated-2327/stage2-android-ios.log` 逐字） |
|---|---|---|
| android | ✅ **四条判据在位**，但**踩在对端的设备上** | `release APK 已重打（ 64M）` → `模拟器 emulator-5554 全新安装成功` → `前台窗口确认：mCurrentFocus=Window{… com.heyta/com.heytamobile.MainActivity}` → `窗口 1080x2400、内容占比 58.3%、主蓝命中 4001 —— 是共享 UI`。🔴 23:5x 现量：那台 `emulator-5554` 的 qemu（pid 36840，21:55 起跑）命令行是 **`-avd heyta-w3-yearly`**，AVD 建号 12:04，而 `goal-multi-end-coverage.md:771` 早写明「这台 AVD 是**并行会话在用的设备**，`reinstall` 会 `pm clear`/卸装它」⇒ **我这一段的 `adb uninstall com.heyta` 清掉了对方正在验收的设备**。读数有效、动作越界，两条都记（取证与病根见 §15.36 第 1 条与 `B62` 23:5x 段） |
| ios | ⏹ **环境无效，本轮不跑**（不降级判据） | 23:54:35 起跑，23:55:56 过设备闸门（对端 pid 93192 = 主检出的 `.verify-mobile-ios-reminder.sh.snap.93192` 两次命中后三次干净采样），进负载闸门（`load 32.56` / 阈值 `12`）后**我在闸门里把它停了**（pid 99764，残留 0）。原因不是负载：三台 `Booted` 现量全有主 —— `heyta-iphone-17pro`（19:32 写入）**恰好是对端脚本的盲选回退目标**（默认名 `iPhone 17 Pro` 在本机不存在 ⇒ `grep Booted \| head -1` = `FE195661`）、`heyta-ios-isolated`（**23:53** 刚写过 = 活现场）、`iPhone Duo heyta` 被 `ui-review-fill-zh-timeline.md:1542` 当别人的证据载体登记 ⇒ 任何一台 `simctl uninstall` 都是不可恢复的越界 |

⚠️ 这张表必须和**同一文件里另一条会话的读数**一起读：`PROGRESS.md:177-187` 记的
「23:16–23:32 四端全绿、`REINSTALL_EXIT=0`（含 ios：`Release 重打 → 全新安装 → 包比源码新 → 主蓝 9450`）」
是**从主检出跑他们那棵工作树**的结果，不是我这条集成线的产物 ——
我的 87+ 笔还没落 `main`，所以"ios 端已装当前产物"这句话对我**不成立**，对他们成立。
🔴 顺带一条由这次对账浮出的通用事实：**这些脚本按串口/名字选设备，而设备的所有权既不住在串口里、
也不住在那个默认名字里**（`reinstall-all.sh:270` 的 `SERIAL=…:-emulator-5554` 与
`verify-mobile-ios-reminder.sh:74-79` 的 `head -1` 回退是同一个缺口的两面）。

⇒ **③ 的现量结论**：mac ✅ · windows ✅ · android ✅（代价已记）· **ios ⏹ 环境无效**。
关闭条件二选一：(a) `B62` 那把带 ttl 的认领锁；(b) 一个明确窗口 —— 对端 `verify-mobile-*` 全停
**且他们的 `head -1` 指针不落在我要用的那台上**。

**④ 23:2x 收口（载体 `2d79d625`）——台账侧做完的与没做完的都列**：

| 项 | 状态 | 读数 |
|---|---|---|
| `B61`（mac 段红） | ✅ 闭合 | 四条判据全中（见上表），并写明"这次绿只证明不总是失败" |
| `B62`（共享设备无锁） | 🔄 证据**三份** + 一把新的盲区 | 22:41 与 23:20 两次同形状撞车（第二次带完整命令行）；23:5x 补第三份，但它**不是撞车**：android 那端的绿读数是在对端的 AVD 上拿到的（`emulator-5554` → `-avd heyta-w3-yearly`），闸门全程绿灯 ⇒ 这把闸门看不见"设备是谁的"。ios 侧同一趟查出三台 `Booted` 全有主，其中一台正是对端脚本的 `head -1` 盲选目标 |
| `B63`（**新登记**：traps 编号台账缺陷） | ⏹ 要人拍 | `#38/#93/#94/#95` 各住两条不同条目、缺号 `#83/#84/#85/#120`、AGENTS.md 自己把 `82`/`83` 各写两条；引用 13 处，扣掉 2 处 PIPL 法条 ⇒ 真实 11 处（含 4 处验收脚本注释）。**要改的两个文件在主检出都是 `M`** ⇒ 不就地重排号 |
| `check:docs` | ✅ rc=0（00:52 载体 `d718f248` 现量） | 上一行 23:23 那条读数里"**4 死链 + 1 处失效章节引用**"已经过期：**死链 0 条**（那 4 条目标不再被任何文档指向，具体谁改的没查，本行不主张），只剩那 1 处失效章节引用 —— 而它**住在记账文本自己身上**：这一行当时用反引号把"某个不存在的章节号"原样抄了一遍，而 `docs-link-check` 的 `SECTION_REF_RE`（`research/tools/docs-link-check.mjs:305`）按「路径 `.md` + 空格 + `§数字`」的**字面形状**扫，不看它是不是正被引用 ⇒ **记录那条红的句子自己就是那条红**。现在把它写成不落在那个形状里的说法，`check:docs` 转绿，且没有把红藏起来：真正指向不存在章节的原始引用出自 `cd839ec5` 批次二交接文档，全仓 `grep` 现量确认它已不在（改前唯一命中就是本行自己）。⚠️ 取这条读数别再只 `tail -12`：章节引用那块印在死链块**前面**，tail 会把它切掉（我 23:08 就差点读成"只有 4 处"） |
| `check:legal-permissions` | 🔴 rc=1，**已提交态的红，不归本批**（登记为 `B64`） | 载体 `d718f248` 现量 **7 条 ❌**。根因不是法务线：**W9 把申请面改了没翻条款** —— `b0ba4a35 23:58 feat(app-host,mobile,web): W9 提醒的原生投递（ADR-0051）` 往 `AndroidManifest.xml` 加 `POST_NOTIFICATIONS` + `SCHEDULE_EXACT_ALARM`、往 iOS `Info.plist` 加 `NSUserNotificationsUsageDescription`，而 `permissions.ts` / `third-parties.ts` 里**六个位置（中英各三）**还写着"移动端不申请通知授权" ⇒ 那句对外条款当场是假话。这条门禁正是为此写的（`017adc3e 20:16` 把通知臂改成"六个字面位置、两侧对称"，W9 落地时它精准指到该翻的那句 —— 门禁按设计工作了）。第 7 条是 `SCHEDULE_EXACT_ALARM` 既不在 `PRIVACY_ITEMS` 也不在 `NON_PRIVACY_ANDROID_PERMISSIONS` ⇒ 它拒绝给出"通过"。⚠️ **不由本批代翻**：那六句要写的是"什么时候申请、申请来做什么、被拒怎么降级"，这些事实只有 W9 的所有者有；我照门禁提示语编一段对外法务条款，比留着这条红更贵。四个相关文件现量都**干净** ⇒ 不是谁在飞，是合并态本身红了：**`pnpm check` 在它翻之前结构性不可全绿**，`e54b899b`（② 那趟干净检出的载体）同样含 `b0ba4a35` 为祖先 ⇒ 那一趟的逐段读数里这一段必红。现量命令：`NO_COLOR=1 node scripts/check-legal-permissions.mjs` |
| AGENTS §9 那一行 | ⏹ 排在落地之后 | 落地未完成（`B60`：15 个文件、别人未提交 **1,266** 行），§9 现在改就是改一个还没进 main 的状态 |
| traps 待入三条 | ✅ 已入 **3 条**（`#196` 新开 + `#197` + `#198`；载体 `a05b4263` 与其后一笔，00:5x–01:1x 现量：目标文件当时**干净**） | `#196`（`.gitignore` 尾斜杠挡不住软链，两腿实测 `rc=0/1` + `0 枚/21 枚`；附"按对象类型分类必须用 `-uall`"）、`#197`（`sandbox_extension_issue_file_to_process … Operation not permitted` 是噪声，**同一行在成功运行里也出现** ⇒ 它连必要条件都不是；真正的红在第一段 `swift build`）、`#198`（macOS 没有 `setsid` ⇒ `nohup setsid` 只留一行错误、任务当场不存在，症状与"闸门在等"在日志上不可分 ⇒ 投放后台后第一个动作是用 pid 证明它在）。另**扩 `#168`**（撤回那条已完成的待办：`scripts/lib/wait-for-quiet-host.sh` 存在、7 个脚本 source 它）、**扩 `#169`**（android 端"串口≠设备" + 反向那面：我新 boot 一台会改写对端 `grep Booted \| head -1` 的指针，他们静默换机且不报错）。🔴 **本行第一版写过"另两条早已被别人入档（grep 现量各 1 命中）"—— 那句是错的，已撤回**：两处命中读原文后分别是 `#76`（tccli 写日志的 `PermissionError`）和 `#130`（`nohup` 继承 C locale 那条末尾的一句泛指），**都不是这两件事**；`sandbox_extension` 与 `ScreenCaptureKit` 全文现量 **0 命中** ⇒ 两条确实没入过。**needle 命中不等于同一件事 —— 计数判据必须把命中行读一遍**（同 `#185`，而我这次是在"我已经读过了"的状态下读错的）。 |
| AGENTS 号段索引 | ✅ 补两行（同一笔 `a05b4263`） | 现量：索引表止于 `165–176`，而正文有 **#177–#196 一整段没索引**，且 **`91–160` 那一段历史上就没有行**（`grep -oE '^[0-9]+\. '` 筛区间现量）。补的 `91–160` 那行**只写"这段有内容、条数请现量"**——本文件自己就规定不写条数。顺带查出这一段**物理顺序与编号不同序**（`#191–#195` 夹在 `#177` 与 `#178` 之间），已写进行里 ⇒ 按行号推断"号到几了"会读错，取最大号要 `sort -n`。**逐号索引仍归 `B63`**（要连"局部列表要不要并进全局号"一起拍）。 |


**④ 台账 ✅** —— 本节 + `B36` 第 2 条的 closure 指针 + 新登记 `B56`（那条挂上游的红）+
`AGENTS.md` 三处漂移登记（`:35` 漏列 `ai-tool-call.ts`、`:37` 未提工具目录已按实体拆包、
`:295` 写"2592 通过"实际 **7839**）+ `AGENTS §7` 索引 vs `environment-traps.md` 的缺号审计。
`pnpm check:docs` rc=0。

**22:0x 续（同一节的读数被现量部分否证，留原文不重写）** ——
本节写的载体 `/private/tmp/heyta-final` **已在 21:32 那次重启里连目录一起被清空**
（提交完好、未提交改动与 `/tmp` 下的臂脚本丢失），现载体
`…/01_PROJECTS/heyta-wt-ai-closeout`；上面"① 合并 ✅"只覆盖到"三个分支并成一条线"，
`main → 集成线`那一次是 22:0x 才做的，**且有两处冲突**（台账尾部，按并集解），
不是上面那句"预演零冲突"能代替的。② 的读数已被新载体上的一份完整读数取代：
**build rc=0 / 61 段 = 56 绿 · 4 红 · 1 段按规则不跑**，四条红分别是
`check:docs`（4 条死链**全部继承自 main** ⇒ 上面那句 `rc=0` 在合并态不再成立）、
`check:privacy-consent-e2e` 与 `check:landing-e2e`（**环境无效**：新载体的
`e2e/node_modules` 未装，失败原文 `unknown command 'test'`，用时 5s/1s 也证明没跑到浏览器）、
`pnpm -r test`（**不在本线的产品红**：`packages/ui` 的 `toOrganizerTree` 节点多出 `archived`，
而它自己的测试断言"只有 `id`/`name`/`children`"。本线在 `packages/ui/` 下改动 **0 文件**、
该源文件与 spec 两侧**逐字节相同** ⇒ main 单跑同样红；最后一动是 `192a516d`，
与 `B56` 那条 organizer 零宽同源）。逐条证据在
`docs/plans/ai-event-tool-contract.md` §15.25–§15.27。

---

## 任务 4（成长三件 + 权益可见）—— 2026-10-03 18:2x–18:4x

**做的顺序**：先把词条字形统一（一个 5 分钟的改动，但它决定 `t()` 能不能直接喂变量）→
把 `buildShareSummary` 从 web 抽进 `app-host`（不抽就必然长出第二份）→ 移动端接 `share` →
接权益块 → 最后才写判据文件。**为什么只做了三件中的两件**：`activityDays` 与 `onRepair`
被**冻结判卷**钉着（`growth-display.spec.ts:365` / `:302` 断言的正是"本端还没接"这个状态），
绕过去会得到一块没有无障碍名的热力图和一个不出现的按钮 —— 那恰好是判据要拦的假绿。
不绕、不改判卷，写成 B41/B42/B43 并各带"最小一步"。

**落地**：
- `web.growth.year.heatmap` 的 `{{count}}` → `{count}`（中英两侧本来就有 4 处 `{{` 全在注释里，
  判据"去注释后计数 = 0"带了一条"原文件确实含 `{{`"的阳性对照，防的是判据自己坏掉）；
  `GrowthView.tsx:237` 从 `.replace('{{count}}', …)` 改成 `t(key, { count })`。
- 新建 `packages/app-host/src/share-summary.ts`：`buildShareSummary` + `SHARE_SUMMARY_KEYS`。
  🔴 `t` 的类型用**本地字面量联合**而不是 `@heyta/i18n` 的 `MessageKey` —— app-host 不新增对 i18n
  的依赖边，而"词条改名/漏译"仍然在宿主调用点变成编译错误（靠 `strictFunctionTypes`）。
  web 侧 `copy.ts` 留一层**转发门面**（`apps/web/tests/motivation.spec.ts` 从那个路径 import，
  而那文件不可改），输出逐字节不变。
- 移动端 `GrowthScreen` 传 `share`：复制走 **RN 核心 `Clipboard.setString`**（实测 0.84.1 两端
  仍注册），零新依赖、零手搓原生模块；`icons.tsx` 加 `'growth.share': Copy`（与 `growth.week` 不同字形）。
- 新建 `EntitlementSection.tsx` 挂在「我的」页：四态只渲两态（`unconfigured`/`unavailable`
  整块不渲染 —— 探测失败不等于没权益）。新增 `mobile.profile.entitlement.entitled` 中英各一条。

**判据**：`apps/mobile/tests/growth-share-summary.spec.ts` 13 条。mobile 全量
**40 files / 625 passed / 0 skipped**（基线 39/612，+1 文件 +13 条）；web 全量
**1564 passed / 13 skipped**（基线 1562/13，跳过数没动）。五个工程 typecheck exit 0
（`pnpm -r typecheck` 曾在 `packages/legal` 红 —— 那是别人在飞的 +117 行；10-04 13:42 复量那一格 exit 0，那笔已由属主带修落地，见 B46）。
六道门禁各 exit 0：`check:reachability` / `:ui-language` / `:design` / `:l4`（web 98≤104、
mobile screens **恰在 90**）/ `:payment-entry` / `:pricing`。

**两条变异（红→绿，原话级读数）**：
1. 摘掉 `share={share}` ⇒ `AssertionError: expected '/**\n * 「我的成长」…' to contain 'share={share}'`
   （**1 failed | 12 passed**），还原后 `2 passed / 45 passed`。
2. 把共享层的小结第二行换成硬编码 `'打卡 ' + checkIns + ' 次'`（改 `src` 后**重建 dist** 才跑，
   判据读的是 dist）⇒ **三条同时红**：keyOnly 注入那条（行的**顺序/数量**变了）、
   zh 精确串（`to contain '打卡 5 次 · 完成 2 件 · 专注 30 分钟'`）、
   en 零 CJK（`expected '打卡 5 次' not to match /[一-龥]/u`）。还原源码 + 重建 ⇒ 45/45。

**未闭合（都登记了编号，不当已做）**：热力图 B41 / 补打卡 B42 / `onFreshStart` 无动作 B43 /
剪贴板设备级读回 B44 / 权益拿不到到期日 B45 / `packages/legal` 的 typecheck 红归属 B46。
任务 2 的真机判据 `verify-mobile-notes.sh` 本轮第三次尝试仍被环境挡：现量 **负载 23.5**、
`:3100` 无服务、`:3000` 是别人的 e2e 栈（pidfile 对得上 PID 80257）——
按纪律"环境无效 ≠ 产品失败"，不硬挤、不去起第二个 postgres。

### 提交后的自洽复查：上一笔漏了 4 个文件（已补）

复跑「HEAD 单独检出能不能编译」时发现 `120c8153` **不自洽**：它里面的
`apps/mobile/src/screens/NoteEditScreen.tsx:41` 与 `apps/web/src/features/notes/NotesView.tsx`
都 `import { NoteEditor } from '@heyta/ui'`，而 HEAD 的 `packages/ui` 里**没有这个组件**。
干净检出会编译不过 —— 混工作树里跑绿，是因为漏下的文件还在工作树上。

漏的 4 个路径（全部属任务 2，也全部在我的地界内）：

| 路径 | 漏了什么 |
|---|---|
| `packages/ui/src/notes/NoteEditor.tsx` | 整个文件未跟踪（共享编辑器本体，215 行） |
| `packages/ui/src/notes/model.ts` | `isNoteDraftBlank`（+14 行纯追加；HEAD 计数 0） |
| `packages/ui/src/notes/NotesBoard.tsx` | 5 处 `draft.trim()===''` 换成同一条判据（5/5，无行为变化） |
| `packages/ui/src/index.ts` | 我的导出块（15 行，本来就设计成末尾追加） |

**为什么会漏**：上一笔的归属过滤是「从 28 个已跟踪路径里挑我的 hunk」，
而未跟踪的新文件**不在这 28 个里**，所以过滤器从源头上看不见它们；
`git diff-tree --diff-filter=A` 只列"这笔新增了什么"，不列"本该新增却缺席什么"。
**补法**：反向查 —— 拿 HEAD 的 import 图去问"每个具名导入在 HEAD 的导出面里有没有"，
缺席的就是漏网的。探针做过阳性对照（往 `share-summary.ts` 塞一根
`from './definitely-missing-file'` ⇒ 16 条含它，撤掉 ⇒ 15 条），
残留 3 条假阳性分别是 `export type {` 形状（`TaskSection`）与断言字符串里的
import 语句原文（`./NoteEditScreen`、`./NotesSection`），已逐条读到字面行确认。

### 收尾复跑：HEAD 自洽、链 58/62 绿、四条 skip 归属

**1. 干净检出自洽（补交之后）** —— 拿纯 HEAD 的树（`git archive` 抽出 960 个 ts/tsx）做两件事：

| 探针 | 阳性对照 | 真残留 |
|---|---|---|
| 每条相对 import 能否在 HEAD 树里解析到文件 | 往 `share-summary.ts` 塞一根 `from './definitely-missing-file'` ⇒ 16 条含它，撤掉 ⇒ 15 条 | 0（15 条假阳性逐条读到字面行：断言字符串里的 import 原文、文档注释里的路径、探针不认 `.mjs`/`export type`） |
| 每条跨包具名导入能否在 HEAD 的导出面里找到 | 同一个收集器先漏 `export type {` ⇒ 补上后 i18n 那 4 个类型名不再报 | 0（`NoteEditor`/`NoteEditorLabels` 那 4 条已随补交消失；`domain` 的 5 个类型名逐条读到 `export interface`/`export type` 声明行 —— 之前那轮 0 命中是 `\b` 在 POSIX ERE 里不认，探针坏不是仓库坏） |

**2. `pnpm check` 逐段（段数硬门 = 62，实落 62 行）**：静态 50 段全 `exit=0`；补跑 8 段
（`typecheck` / `macos-shell` / `macos-window` / `windows-shell` / `linux-shell` / `arkts` /
`screenshot:verify` / `-r test`）全 `exit=0`。**合 58 段绿、0 段红**；没跑的 4 段与原因在 **B48**
（`build` 与三段 e2e 会在别人跑到一半时重写 dist / SIGKILL 他们的 vite）。
**B46 就此解除**：`pnpm -r typecheck` 整链绿。

**3. skip 账（"skipped 必须 0"这条的逐包读数）**：`mobile 40 files/625 passed`、`ui 26/473`、
`app-host 48/1002`、`widget-core 6/193`、`landing 22/1303`、`sync-client 6/98`、`op-log 7/99`、
`node-host 9/165`、`desktop 2/12` —— **这些包 skipped 全为 0**。有跳过的是两处既有机制，
不是我引入的：`apps/web` 13 条（`e2e-sync.integration.spec.ts` 里
`describe.skipIf(URL_BASE === undefined)`，就是文档说的"真实服务端类默认跳过"）与 `server` 1 条。
HEAD 的 `apps/web`+`apps/mobile` 里 `.skip(` 标记数 = **0**；我那两笔提交新增的 3 处"skip 字样"
命中全是 `raise SystemExit(...)`（被 `xit\(` 这条宽松分支抓到，逐行看过真值形态）。

**4. 又被我这批否证的注释**：`packages/ui/src/habits/HabitBoard.tsx` 第 3 条"删除习惯没有进这一刀 /
习惯建出来就删不掉"已改成"曾未接、现已接（走的正是它自己提的『并入详情层』那条）"并挂上判据。
同一次全仓扫还扫到地界外的一条（`docs/research/trash-and-archive-best-practice.md:179`）⇒ **不代改**，
登记 **B47** 并把一行改法留给它的 owner。

---

## 19:2x：那两张"我以为没取证"的真机截图 —— 归位 + 一种新的产物对账法

**事实更正**：我在 B49 里写过"§3 那两行设备级截图未取证"。`ls apps/mobile/evidence/` 实测
`android-notes-1-editor-open.png` / `android-notes-2-list-after-edit.png` **存在且非空**（17:20:20 / 17:20:36）。
两张都打开看过：图 1 是「编辑便签」那屏（标题 + 返回箭头 + 多行框里 `note-e2e-171747-read-once` +
「× 取消」/主蓝「✓ 保存」），图 2 是「我的」→便签卡上**改过之后**的 `note-e2e-171747-edited`。
**错在哪**：我按脚本第 12 步那条**整体判据**（三张齐才算过）倒推出"一张都没有" —— 整体没过
推不出局部不存在。**登记"未取证"之前先 `ls` 目标目录。**

**产物新鲜度怎么证（这轮的真正产出）**：逐字节复现做不到 —— 那枚 `app-release.apk` 已被并行会话
19:07 的构建覆盖（`stat` 现量 19:07:35，晚于截图 2 小时）。能立住的是三条合起来：
① 便签链六个源文件最后写入 16:20:39–16:31:23，此后 `git diff HEAD` 逐字为空；
② 这一趟 needle 自带时间戳 `note-e2e-171747` = 17:17:47，**晚于最后一次源码改动 46 分钟以上**；
③ 图 1 那一屏由 `NoteEditScreen` + `NoteEditor` 渲染，两文件 16:21 前不存在 ⇒
**早于它们的构建画不出这张图**。③ 是"旧产物"假设的否证，也是我先前那个假设该死的理由。
把这三条写进审计 §3.2，同时把矩阵那行的措辞从"未取证"改成"两张已入库 + 第 8 步之后三腿仍缺"，
边界写清不躺赢：**没有**第三张（第 8 步 搜索点开便签），第 6/7 步的 op 判据与第 9–11 步的跨设备三腿
也**没有**真机证据 ⇒ 矩阵行保持 ✅（那是"接线完成"的判据，单测 + 变异已钉），但缺口逐条挂在 §3.2 与 B48/B49。

**本轮门禁读数**（新加的 §3.2 不引死链、不动口径）：`docs-link-check exit=0`、`check-docs-voice exit=0`。

---

## 19:3x：任务书拍板那半件（`check:ai-coverage` 按端枚举）—— 变异第一次存活，修的是门禁

读数、三处改动、以及"为什么不能用子串判"都在 goal §7.26。这里只留两条对我下次有用的：

- **变异臂第一次是存活的**，而且存活原因是我的正则只认单引号 `from '…'`，探针写的是双引号。
  我差点把这读成"这条规则没牙"就过去 —— 判据存活先问"探针真打到它了吗"，再问"它是不是没牙"。
  修完两条臂（双引号 / 多行 + `as` 别名）都精确点名缺的 3 条并 `exit=1`，还原 `exit=0`、探针残留 0 文件。
- **子串判在这个仓库会自己造红**：`tool-calling` 的入口名就叫 `request`，移动端 3 个文件本来在写
  `requestPasswordReset`。新加一条"按名字找调用点"的判据之前，先 `Grep` 那个名字在本仓有多少**无关**命中。

---

## 19:4x：任务 4 最后一条子项（词条字形）定论 —— 结论是"本来就只有一种"，交付物是测量不是改动

全部读数与复跑载体在 goal §7.27。这里留三条对我下次有用的：

- **任务书那句"两种字形统一"预设了一个不存在的事实**：`{{count}}` 只活在 4 行注释里（讲
  react-activity-calendar 那个库形状的来历），真值 100% 是单层 `{count}`。遇到"要我修 X"先量 X
  还在不在 —— 已经在的修复不需要一次提交，但**需要一条会红的常驻判据 + 一次实测的变异**，
  否则我和"以为修了"的人区别不大。
- **一次变异只红了一条臂，另一条臂存活的原因查实了**：`translate()` 走的是
  `require.resolve('@heyta/i18n')` → **`packages/i18n/dist/index.js`**（19:29 构建），改 src 不重 build
  打不到它。我**没有**为它去重建 `dist` —— 那是共享产物，别的会话正在跑打包与设备验收。
  写明"哪条臂守哪一层载体"比"跑了两条臂"有用。
- **第一次量是假空**：`grep -c "{{count}}" packages/i18n/src/*.ts` → 0/0，因为 glob 没进 `src/locales/`。
  零命中要么配注入对照（这次两条都配了），要么先验 glob 能不能命中它自己的目录。

---

## 20:1x：完成条件逐条现量（§7.28）+ 两条原话被实测否证 + 一处死链当场改对

写台账前把每条约束都重新量了一遍，结论与读数在 **goal §7.28**（条件 1 逐行、条件 2 逐条，各带复跑命令）。
三条对以后有用的：

- **两条"被冻结判据钉住"里，一条的因果是假的、另一条的机制我说浅了。**
  `growth-display.spec.ts:364` 那句"传了 activityDays 这条会先红"否证 —— `:365` 只读适配层；
  B42 的真实机制是 `HabitStreakList.tsx:269` 的 **或**条件（`onRepair` 有值但标签是 `undefined`
  ⇒ 按钮根本不渲染、不报错）。**登记"拦不住"之前要读被拦那行的渲染条件**，
  否则下一批会照着"改判据就行"去排活，而真拦路的是共享组件里那个 `||`。
- **权益那条"要改服务端"我这次读到底才敢写**：`entitlement.ts` 那次 GET 一个响应字段都不消费，
  而 web 侧"到期条"同样只有 `expired`/`refused` 两个布尔（`SubscriptionNotice.tsx:78`）
  ⇒ 两端都拿不到日期，不是我移动端漏接。
- **抄来的编号必须在落盘前 `ls` 一次。** 我把新契约写成 `docs/adr/0050-…`（读的是并行会话刚改的
  AGENTS.md），几分钟内它把号让给 **0051**（0050 现在是 E2EE 密钥生命周期）。两处已就地改对。
  ⚠️ 顺手量到的两件都写进 §7.28 而不是藏起来：
  ① `docs/adr/0051-mobile-reminder-delivery.md` **此刻还没被 git 跟踪**（`ls-files` 报 "Did you forget to
  'git add'?"）⇒ 我这两处引用在干净检出上暂时指不到东西 —— 那是他们的文件，不代 add；
  ② ~~**`pnpm check:docs` 现在 exit=1（27 处死链），而且一条都不是我的**~~ ⇒ **21:3x 复跑三趟后加严并更正**：
  `check:docs` 是 `pnpm check` 的**第 34 段**，所以可过段数从"58/62"降到 **57/62**（我上一版那句 58 是错的）；
  总数**是活的**（同一小时 27 → 32 → 33，分布每趟都变）；**"一条都不是我的"这句仍然成立**（三趟都 0 命中）。
  但**"全部只在混合工作树成立"是我这次量出来的错话**：逐条问 `git show HEAD:<源>` 里还写没写这个引用之后，
  **有 3 条 HEAD 上就红**（`detail-pane-alignment.md:4` 与 `detail-pane-alignment-and-spaced-review.md:101` 的两条，
  两份源文件工作树**干净**、HEAD 已跟踪 ⇒ 是"引用提交了、目标没 `git add`"，CI 一样红）；
  其余 **24 / 29 / 30** 条才是别人的未提交引用指向未 add 的文件。
  取证命令与完整归属表在 goal 文档 **§7.28 末尾**。
  🔴 **归属探针自己差点给出第 4 条假红**：目标名是通用的 `README.md` 时，按 basename 去 HEAD grep 命中 6 行，
  探针判它"HEAD 上就红"，而 HEAD 版那份文件只有 2709 行、引用在未提交的第 2737 行 ⇒ **判死链归属要用链接整串，
  不能用 basename**；反向也一样，头一趟我按解析后的**绝对路径**去 grep，文档里写的是相对串，0 命中差点被我
  当成"HEAD 没引用"。两条都写进 §7.28。
  ✅ 顺带做出一个**行内代码 vs 链接形状**的 A/B：我为了写这条，在正文里用反引号抄了一个指向未跟踪文件的
  `[.](…)` 形状，改完复跑 `check:docs` —— **我的文件 0 命中**，而同一个目标在别人的 `[]( )` 形态里被报了出来
  ⇒ 证实"我引的 0051 没进死链账是因为形状不是链接，不是因为它是好的"。
  `check:docs-voice` 与 `check:row-single-source` 同刻 **exit=0**（我这轮纯文档改动没撞它们）。

## 21:3x–22:0x（载体 8519de39 之后）：check:docs 的归属量到底 + 把"父子"这一项查穿并自我更正

- **环境不在窗口，没挤**：`vm.loadavg` 1min=**91**（16 核）、`:3000` 仍被 PID 80257 占、
  有人在 `/tmp/heyta-reminder-ios4` 编 iOS（`clang … iphonesimulator27` 在跑）。
  ⇒ 四端重装与三条 Playwright 段这轮**没跑**，不拿旧载体读数顶替。
- **`check:docs` 三趟 27→32→33，我把它逐条拆到 HEAD**：24/29/30 条只在混合工作树成立，
  **3 条 HEAD 上就红**（别人的引用进了提交、目标文件漏 `git add`），**本条线 0 条**。
  于是 `pnpm check` 的可过段数从"58/62"**降到 57/62**（`check:docs` 是第 34 段，我先前把它漏在 4 段之外）。
  立 **B51**，并把 B50 里我自己那句 `check:docs exit=0` 划线更正。
- 🔴 **自己的探针差点造出一条假红**：按 **basename** 去 HEAD grep 判归属，目标叫 `README.md` 的那条命中 6 行
  ⇒ 被判"HEAD 上就红"，实际 HEAD 版那份文件只有 2709 行、引用在未提交的 2737 行。
  反向也错一趟：按**解析后的绝对路径** grep，文档里写的是相对串 ⇒ 0 命中差点被我当成"HEAD 没引用"。
  **判引用存在与否要用链接整串 + 词边界。**
- ✅ **顺手撞出一个 A/B**：我为写这条教训，在正文里用反引号抄了个指向未跟踪文件的 `[.](…)` 形状，
  复跑 `check:docs` 我的文件 **0 命中**、同一目标在别人的 `[]( )` 形态里被报出来
  ⇒ 证实"我引的 0051 没进死链账是形状问题，不是它是好的"。
- **把 🟡 那行的"父子"查穿，并且把自己写满的结论改小**（立 **B52**）：
  `ProjectActions` 接口面上确实没有改父的方法，**但我第一版那句"没有任何一个能改父"说满了**——
  下一趟探针（查有没有通用 `updateProject`）把它否证了：`project-actions.ts:165` 那个私有派发器
  **payload 是开放的**，rename/setColor/archive 都是它的一行包装 ⇒ 写侧只差一个同形状包装 + 守卫，
  真缺的是**两端界面**（web 也没有嵌套）与跨端形态裁决。
  🔴 一般规律：**判"某写动作不存在"，光列接口方法名不够，还得看接口背后那个通用派发器有没有被别的动作共用。**
  ⚠️ 同一趟 `grep 'moveProject'` 命中 13 行，全是 **`removeProject`** 的子串 ⇒ 又是一条 needle 形状错，改 `-w` 后重测。
- **未闭合**（原样继承，不粉饰）：条件 2 的 5 段红 + 四端重装 + `verify:mobile-notes` 剩余腿。


### 2026-10-03 · 架构 B/C 续验与规则落地

B/C 尚未完成：B 的密钥包/服务端基础不等于生产日志迁移和恢复闭环；C 的编译通过不等于
OS 通知投递通过。原 [多端计划](docs/plans/goal-multi-end-coverage.md) 批三和 AGENTS W9
已纠正为实施中；[A/E/D 证据](docs/research/aed-implementation-evidence.md) 明确旧范围边界。
依据用户要求，把完成范围对账、经验回写、安全测试不得放宽生产鉴权、模拟器/变异独占、
通知回执事实分层写入 AGENTS §8；具体事故扩充环境陷阱 #181 并追加提醒验收条目。
[文档中心](docs/README.md) 已链接 B/C ADR 与既有证据，避免成为孤立记忆。
这些新增流程约束目前是人工执行规则，不宣称已全部由自动门禁覆盖。

## 21:2x（载体 96f3293d 之后）：交接落盘 + 提交纪律里又踩到两条

- 新建 `docs/plans/multi-end-coverage-handoff.md`（同目录已有 10 份 `*-handoff.md`，形态一致），
  并从 goal §7.29 与 `docs/README.md` 的 plans 索引各挂一处（AGENTS §8「新文档必须由原计划或文档中心链接」）。
- **Goal 状态没有变**：条件 1 = 3 ✅ / 3 🟡（🟡 的三条拦路全在本批权限外：B41/B42 要翻冻结判据、B45 要动服务端、
  B52 要跨端形态裁决）；条件 2 未达成（`pnpm check` **57/62**、四端重装**本轮没跑**）。
  ⇒ **不标 complete**，交接给下一个会话按 §5 的顺序接着跑。
- 🔴 **本轮两条新踩的坑**（都记进了交接文档的"死胡同警告"）：
  ① 脚本开了 `set -o pipefail` 之后，`if ! diff -u A B | grep -q …` **永远走 else 分支** ——
  `diff` 在有差异时退 1，管道整体状态被 pipefail 变成 1，匹配成功也被读成失败。
  我在这条上**空转了四趟**，中途还把它误判成"脚本里写中文 needle 不匹配"（改成直接 `grep 文件` 立刻通）。
  ② `git commit --only` 之后共享索引仍停在**上一笔 HEAD** ⇒ `git status` 报 `MM`，
  而别人一次**裸** `git commit` 就会把我这几百行倒回去。收尾必须按**路径**把索引刷到新内容
  （`git update-index --cacheinfo 100644,<HEAD blob>,<path>`，路径清单里**不能混目录**）。
- ⚠️ 我又犯了一次记忆里那条"Edit 别吃掉相邻块的边界行"：给 `docs/README.md` 插索引行时
  把 `old_string` 写成"那一行 + 换行"，结果两行被粘成一行（`… 不重复决策 || [subscription-wechat…`）。
  当场用 python 精确修回（needle 命中数断言 = 1），净效果校验为 **+1 行 / 0 删**
  （那 1 条删除是并行会话自己对 ADR-0043 表格行的改写，不是我造成的）。

## 21:4x 自查：`96f3293d` 替并行会话提交了整节 ⇒ 提交共享台账的配方改成"blob = HEAD + 我的文本"

- 现象：`PROGRESS.md` 1358–1366 行（`### 2026-10-03 · 架构 B/C 续验与规则落地`）不是我写的，
  被我这笔提交带走了。守卫只验了"单 hunk + 删除 0 行"—— **追加的形状不等于作者的归属**。
- 后果：那句里的 `[A/E/D 证据](docs/research/aed-implementation-evidence.md)` 指向**未跟踪**文件
  ⇒ `check:docs` 在 HEAD 上报 1 处死链、出处 `PROGRESS.md:1362`，committer 是我、句子不是我写的。
  目标文件在本机存在（3907 B / 20:46），是 owner 还没 `git add`；我不代 add、也不代改别人的句子。
- 已登记 **B53**（含可复跑的 blame 取证与五条新配方）。历史不重写 —— 倒回去会删掉别人那节。

### 2026-10-03 · B/C 续验：授权竞态与通知证据

- C 首次系统授权完成后显式再次调度，保留本地意图独立落库；三种授权时序测试通过。
- iOS 本机不确定投递证据已接到共享提醒列表的说明，不改同步 phase；旧 occurrence 在 snooze 后不再提示。共享行模型 11 项、提醒动作/投递/重复 56 项通过，UI/mobile 类型检查通过。
- 原则回写 AGENTS §8、ADR-0051 与环境陷阱 #189；真实通知脚本修正为“取消前仍有通知”的正向对照，避免先点击 autoCancel 后假绿。
- 当前工作区 build、Android Release 构建通过；真实 Android/iOS 投递与恢复 UI 仍在执行，不能用构建结果替代 B/C 的完成证据。
- 22:55 续验：当前 Android Release 的提醒主链 11 项全部通过，包含取消前通知存在的正向对照、真实十分钟贪睡、SIGKILL 后系统投递与点击返回；两张系统通知截图已人工查看，证据回写 ADR-0051 和多端覆盖计划 §4。B 原子迁移配额竞态正在修复，iOS、跨端恢复、最终全仓门禁与四端重装未完成，Goal 保持 active。
- Android 安全存储在当前 Debug 安装产物上完成五阶段真实 instrumentation：账号 scope 隔离、跨四个独立进程读写/删除、整机重启后读回均通过。APK 哈希与阶段结果位于 `apps/mobile/evidence/android-vault-storage.txt`；脚本入口 `pnpm verify:android-vault-storage` 已接入自快照门禁，并由 ADR-0050 链接。此结果不冒充锁屏禁读、iOS Keychain 或生产恢复 UI 验收。
- 23:39 Android C 补验完成：权限恢复、force-stop + 整机重启后再次启动补发、未到期 pending alarm 删除各 5/5；系统与 SQLite 双判据验证没有伪造 fired。前后截图已核看并由 ADR-0051 链接，原计划批三状态同步更正；调度器空实现的 Release 变异被 OS 通知断言抓到。过程约束继续融入 AGENTS §8 与现有 ADR，不建孤立记忆文件。iOS、生产密钥迁移 UI、全量门禁与四端重装仍未完成。

### 2026-10-04 · B 端到端反证补强

- 按用户要求继续把经验融入原入口：AGENTS §8 补入密文 journal、AAD 下载规范表示，以及在预检后建立预留的事务屏障判据。ADR-0050 保留真实失败边界。
- 更强的真实 PostgreSQL/HTTP 用例抓到两条未闭合缺口：迁移 inventory 的 `entityIds: []` 与普通下载省略字段产生不同 AAD，新设备 full-state 解密失败；预检后建立 reservation 时普通 upload 仍可越过配额。正在修复，不能用此前 3/3、5/5 的较窄测试宣布完成。
- 新增既有 ADR 链接的 `pnpm verify:vault-web`：三个独立 Chromium context，经真实生产 HTTP 路径创建、恢复、轮换和下载；00:20 三台新设备真实旅程已全绿（创建 → 恢复后强制 wrapper 轮换 → root 迁移 → 新设备下载重建），尚不覆盖 legacy 历史。恢复码截图遮挡、trace/video 关闭，避免测试证据保存秘密。Goal 保持 active。
- 00:06 补上移动端原生安全存储的保存/登出串行化与在途读取失效：12/12 行为测试通过；隔离副本取消串行化后，登出仍残留原生 root 的判据转红。该约束已并入 AGENTS §8.10 与 ADR-0050，原生设备仍须在最终当前安装产物上续验。

- 00:28 独立复核发现首次建包误判 legacy 历史世代，以及 wrapper 更新与迁移并发覆盖；服务端正补事务判据。另将 payload cipher 的空 `entityIds` 规范为下载时的省略形状：新回归先在 AES 认证处失败，再修复后 14/14 通过；非空列表篡改仍必须拒绝。

- 00:39 Web 真 PostgreSQL 旅程扩至 3/3：旧密文首次建包与迁移、新设备恢复，以及 chunk 网络中断重启续传、commit 响应丢失查询同 requestId、取消后刷新无 pending 全部通过；DEV StrictMode 并发 session 已合并，fixture 1/1。全仓 typecheck 通过；全量测试抓到新增三类密钥表未同步隐私文档，已补中英用途/留存/注销类别及草案版本 1.2，legal 66/66。后续继续全量测试与原生验收。

- 01:00 Web 并发迁移真链路已先证红：inventory 屏障后在界面新建任务并同步，commit 返回 409、generation 没有推进。前两次探针被 Service Worker 绕过，修正为独立 context 禁 SW 并断言屏障确实命中后才得到产品缺陷证据；过程并入环境陷阱 #191 和 AGENTS §8.9，互斥修复进行中。

- 2026-10-04 续验：迁移服务端已 PUBLISHED 但浏览器未收到响应的真实 reload 用例补到 5/5 全绿。生产入口现在保留 ciphertext-only journal，只有新 package/root 与 payload generation 在本地同一事务 `saveBound` 成功后才 ack 清理；随后再次 root rotation 通过，证明 journal 不会阻塞后续迁移。证据见 ADR-0050 与 `apps/web/evidence/vault-panel/pg-commit-restart-*`。Web build 另修正 ServiceWorkerRegistration 的异步注销调用。Goal 仍 active：Android Vault 真实 UI、iOS OS 投递/Keychain、最终全仓门禁与四端当前源码重装未完成。

- Android B 续验边界（2026-10-04）：当前 Release 安装产物已完成真实认证、保存并启用同步、Vault 创建、恢复码二次确认、显式“记住解锁”和解锁状态显示；证据为 [`android-vault-created.png`](apps/mobile/evidence/android-vault-created.png)，已人工查看且不含恢复码、root 或口令。Android Keystore 的跨进程、设备重启、scope 隔离和删除持久性仍以 [`android-vault-storage.txt`](apps/mobile/evidence/android-vault-storage.txt) 的五阶段结果为准。后续续验已形成冷启动 remembered-root 与真实 UI logout fence 的脱敏记录（[`android-vault-cold-start.txt`](apps/mobile/evidence/android-vault-cold-start.txt)）；logout 后重新认证的密码请求虽被服务端接受，Release AuthScreen 未进入 session / “保存并启用同步”，所以“再认证后保持锁定”仍未通过。轮换和跨端任务互读也尚未形成移动安装产物证据，不能用首次会话的 opt-in 结果替代；规则继续维护在 ADR-0050，不另建记忆文档。

- 2026-10-04 iOS 提醒续验：修复 `HeytaReminderModuleBridge.m` 的导出名错配（`RCT_EXTERN_MODULE` 实际导出 `HeytaReminderModule`，JS 读取 `HeytaReminder`），改为 `RCT_EXTERN_REMAP_MODULE` 后，Release 模拟器真实日志出现授权 `granted=true`、排程 `error=none`；`heyta-reminder-receipts.json` 有 `posted/receipts`，启动 reconcile 后 SQLite 出现同时含 `firedAt` 与 `firedForTriggerAt` 的 REMINDER op。隐私覆盖层先由 AX 真实关闭并复核消失。证据与限制已写入 ADR-0051：这证明 iOS 模拟器 OS 投递闭环，不替代实体设备通知权限或 iOS Keychain 验收；本轮未取得新的 Keychain 实机证据。
- C 的容量算法补上独立边界测试：`apps/mobile/tests/native-reminder-plan.spec.ts` 用 65 个按时间排序的 occurrence 验证规划器只返回最早 64 个，并确认第 65 个不会挤掉更早项；移动端测试现为 731/731 通过。此项只关闭共享规划器的确定性规则，不能把它记成 iOS 系统通知中心的 64 条窗口证据；后者仍待真实设备/模拟器窗口滚动验收。

### 2026-10-04 02:0x–02:2x · D-3 收口：① 落地成事实，②③ 排在同一条等窗口的队列上（落地载体 `de296b9d`）

- **① 合并落地**：main 于 02:06:07 Fast-forward 到集成线 `de296b9d`，三条源分支（覆盖面 / 助手会话历史 / closeout）现量都在 main 里；
  本批代码与五段 AI/法务门禁在 main 的 `scripts.check` 串里逐枚取到（段数 02:2x 现量 **74** —— 目标原文"HEAD 上 61 段、工作树 62 段"已过期，报段数必须带载体）。
  落地那一刻挡路的交集是 4 枚而非 11 枚，其中 3 枚由所有者自己在 `258813a8` 提交后归零 ⇒ 没有吞任何 hunk。
- **两条我自己的说法被撤回**（细节在 `docs/plans/ai-event-tool-contract.md` §15.43）：
  ① `host.submit` 真正被钉的性质是"非注释命中**两处**＝全部入口"（内置 AI + MCP／本机 API），不是 Goal 原文那句"恰好一处"；
  ② 五条隐私不变量里**只有两条有 `check:*` 门禁钉**（submit 计数、出境披露话术），另外三条靠类型层与单测
  （`grep -rl isToolGranted scripts/` = 0、`grep -rln fallback-needs-consent scripts/` = 0）⇒ 登记为下一批候选，本批不代开工单、也不谎称有门禁。
- **一根探针被当场否证并写回原句**：`sed 's/^\s*//'`（BSD 不认 `\s`）把"合并更新集 ∩ 主检出脏项"从 **4** 读成 **0**，而 0 正是放行条件
  ⇒ 空集读数当放行前必须先跑一条**必然命中**的对照。这一条同时挂进 `BLOCKED.md` B65 的复核段。
- **②③ 现在的形状**：一条等窗口的队列 `~/scratch-heyta/heyta-deliver-on-window.sh` ——
  现场闸门（pattern 里含**别人那趟链**的每个 argv 形状，不与它挤同一个窗口）→ 仓库那道负载门（阈值 12，不自定）
  → 链逐段读数（载体=落地载体）→ **非 docs 漂移必须为 0 才允许起装** → `check:ai-e2e`（用 4318/4319 端口空闲当门，因为它的 preflight 会 SIGKILL 那两个端口上的进程）
  → 四端重装（`IOS_DEVICE_NAME` 显式给，不 `head -1` 猜设备）。每条前置等满都以 **exit 3** 收尾（环境无效 ≠ 产品失败），全程不 push。
- **④ 收口对账（10-04 17:5x 现量，尖端 `1cda2053`）**：**①** 已按四条逐枚 `git merge-base --is-ancestor` 复量闭合；**②** 的 `apps/web` 全量套件跑成（`Test Files 132 passed | 2 skipped`、`Tests 1756 passed | 13 skipped`、rc=0；跑者没记起跑 HEAD，故用「两代载体之间 `apps/web|packages` 改动集合 = 0 文件」把这枚读数钉到当前提交），余下的是全仓 `pnpm -r build` + `-r typecheck`；**③** 已按产品负责人授权停掉两棵确定不会自己走的进程（挂死 13h5x 的公证链，服务端零提交记录；无主孤儿 vitest 18h17m，`ppid=1` 且 cwd 指向已删除的工作树），现量窗口五格里设备面与工作树两格已绿，**只剩负载一格**，而此刻吃 CPU 的是交互层（WindowServer / IDE helper / 模拟器 qemu）⇒ 开窗取决于并发会话何时 idle，**不按放宽阈值处理**；四端重装的读数仍由那条等窗口队列产出，DONE 必须打印 `SHORTCUT_OK` + `PAYLOAD_WEBDIST=True` + `M2D=OK` + sha256 对账。明细 `BLOCKED.md` B76 补记 #11–#13 与 `docs/plans/ai-assistant-closure.md` §8 那张矩阵。

- B/C 全量验收补正：隔离工作树固定源码后，门禁抓出 C 权限说明仍声称“移动端不申请通知”。现将 Android/iOS 本地通知、精确闹钟与拒绝后的行为同步写入既有中英权限清单/第三方说明，草案版本更新为 1.1，并重生成服务端版本指纹。安全存储验收要求并入 AGENTS §8.10：探针调用生产入口、实际属性精确比较、跨进程删除在新进程读空，不能把替身或同进程结果记成运行时闭环。

- B/C 收口续验：C# 存储契约重放补全真实契约所需的断言能力，66/66 通过，负向自验确认错误不会吞掉。通知权限说明继续核对隐私正文，消除中英文“只有 INTERNET／没有通知权限”的旧承诺，privacy 草案推进至 1.3，法律测试 66/66。隔离全量浏览器门禁尚未通过：已捕获详情列挤占主区后页头溢出、按钮被遮挡，以及后台验收夹具遗漏公开调休端点；修复和复验进行中，不计作完成。

- B/C 隔离复验（2026-10-04 03:0x）：浏览器原失败项定向复跑 20/21 通过，唯一剩余是固定手势起点落进新详情列；改为目标行几何 + `elementFromPoint` 前提后，日历日档 5/5 通过。已实际打开修复后的日历页头、拖到次日以及助手暗色截图。完整浏览器套件仍须复跑，另有导出契约动态加载器错误在排查；不能把本轮定向结果写成全仓门禁通过。

- B/C 固定源码真实复验（2026-10-04 03:1x）：requestId 绑定修复后，Web＋HTTP＋PostgreSQL 五条 Vault 旅程再次 5/5 通过（15.6 秒），包含三设备、旧历史、迁移中新增任务、重启续传/取消与已提交未收到响应的恢复。固定截图已更新并回看新设备读取旧任务；该结论仍不覆盖未完成的移动端旅程。隔离树完整 `pnpm check` 正在执行。

- 2026-10-04 收尾复核（**后续状态已由本节末尾的 iOS 取消续验更正；本行只保留当时快照**）：隔离树中的 `@heyta/app-host` 64 个文件/1306 项、移动端 47 个文件/709 项、
  `@heyta/legal` 66 项以及 `@heyta/sync-core` 19 个文件/303 项定向测试通过；完整递归测试仍不能记为绿，
  因隔离树同步修正后暴露了环境/提交态差异（外部 TFA 锁、过期迁移探针，以及 web/server 用例超时，原因尚待串行对照验证）。
  这类失败没有被放宽判据。iOS 模拟器提醒已取得真实排程与 `firedAt + firedForTriggerAt` 回执，
  但通知中心标题截图与未来提醒删除的 `DEL`/ledger 清理仍未形成证据；Android Vault 冷启动恢复、logout fence、
  轮换和跨端互读也仍未完成。四端 `reinstall:all` 与最终 `pnpm check` 仍是 Goal 的收尾门槛。

- B/C 串行对照（2026-10-04 10:31–10:32）：固定隔离树执行 `pnpm -r --workspace-concurrency=1 test`，
  20 个包全部执行，11,202 项通过、14 项跳过、退出 0；此前超时的 Web 六文件 43 项和服务端两文件 61 项
  也分别复跑通过。测试内容与超时阈值未改；该结果只证明此隔离副本，不覆盖主工作树后续变动。
  主树 `pnpm -r typecheck` 通过（不含未提供该脚本的 server）；完整 `pnpm check` 则在新增存储契约所需的
  C# shim matcher 处中止。补齐严格大小比较后真实 C# 原样契约 67/67 通过，另有 20 条正反例与 `.not` 自验，
  规则与结果写回既有 C# spike README。整链、移动端剩余旅程和四端重装仍未完成。

- 固定隔离树后续验证：自托管入口、Web SQLite 存储/旧库迁移、Web 产物、自快照、移动首启、截图校验均通过。
  再跑完整 `pnpm check` 已通过构建、类型与浏览器套件之前的门禁；在 `check:ai-e2e` 启动前被另一项目
  的 TFA 测试锁拒绝（已核对持锁进程仍在运行），浏览器本轮未执行，不能记作整链通过。
  下一轮从浏览器套件继续，不绕过资源锁。

- B/C iOS 取消续验补正（2026-10-04）：真实 UI 的未来提醒取消 21/21 通过，SQLite 同一实体的 DEL、AX 行消失和原生 ledger 清理均成立；已打开删除后截图核对任务详情显示“还没有提醒”。先前失败源自脚本 `10/4` 与实际 AX `10-04` 不匹配，原计划与 ADR 摘要已同步更正。后续审查要求 full 旅程精确绑定本轮实体/毫秒级 occurrence，并在截图前断言同一任务详情，避免旧记录或其他页面误算通过；这些补强及 killed-process/系统通知截图仍在续验中。

- B/C 固定副本浏览器门禁（2026-10-04 10:48）：`check:ai-e2e` 退出 0，154 项通过、2 项跳过；已重新打开 Vault 明暗两张完成态截图，界面与遮密处理正常。`check:shell-unicode` 也通过。隐私同意套件在运行前被另一会话的有效 TFA 锁拒绝，尚未执行；落地页套件及最终当前源码对账仍待完成。固定副本基线为 `73b36a6d` 加本轮验证覆盖文件，不能用它为随后变化的主树背书。

- B/C 帮助入口补齐（2026-10-04）：真实看图抓到“无恢复”和“后台只有自建推送”的过时承诺，修正原有 25 对中英词条并重生成 4 份 FAQ/口令 HTML；原帮助导航不变。i18n 26 项、landing 1317 项、重跑真实浏览器 landing 18 项通过，恢复帮助中英与提醒说明三张图已人工看过并从 ADR-0050/0051 链接。隐私同意浏览器 7/7 也通过。规则已融入 AGENTS §8.17 和原环境陷阱 #212。审查同时发现设备撤销缺用户入口，已继续补实现；B/C Goal 尚未完成。

- B/C 11:42 续验：app-host 构建恢复正常，设备管理及共享撤销编排定向 10/10 通过。iOS 在原 killed-process occurrence 所属模拟器修正直接 idb 的 TCP 参数后，系统通知中心实际显示 `ios-reminder-delivery-105035`，截图已人工核看，SQLite 标题、entityId、triggerAt 与 fired receipt 一一对应。原 ADR-0051 摘要、批次三状态表和环境陷阱 #208 已同步更新；AGENTS §6.2 固化截图清旧文件与传输参数一致规则。跨设备 fired、iOS 权限/容量边界及最终当前产物验收仍未完成。

- 后续取证审查补强：iOS full 验收标题由仅精确到秒改为带当前脚本进程 nonce，避免快速重跑命中通知中心残留的同名旧通知；该规则已写入 AGENTS §8.11 与 ADR-0051。`verify-mobile-ios-reminder.sh` 语法检查、app-host 撤销/提醒定向测试 12/12 通过；未以此替代真实 iOS 权限/容量和四端当前产物验收。

- B 撤销最终接线定向复验：隔离副本补齐 packages/web 源码依赖并逐文件哈希对账后，真实 Web/HTTP/PostgreSQL 六条 Vault 旅程再次 6/6（17.1 秒）；共享 controller 已包含 guidance 持久化失败仍清会话与异步绑定复核。Vault 设置浏览器 1/1，明暗图已人工核看。另修同步设置、集成页与自建文章 5 对过期恢复说明，文案门禁通过。上述结果仍非全仓最终门禁与四端当前安装产物完成。

- C 跨设备协议续验（2026-10-04 13:01）：新增 PostgreSQL 集成入口下的两条真实 HTTP/加密/独立 SQLite 旅程，2/2 通过、零跳过；覆盖远端 fired、pending 取消、重开、改期、贪睡、每日重复及旧回执隔离。首轮账号串扰修为逐例独立账号，不放宽断言。ADR-0051 当前摘要、边界表、原计划批次三和 AGENTS §8.11 同步更新；受控通知 port 不算 OS 投递证据，原生边界仍待验。

- B/C 边界反证续验：提醒 HTTP 三条变异均被具名 AssertionError 抓到，源码逐字恢复并重建。真实 Vault/HTTP/PG + 观察型模型端点的 AI 出境旅程 1/1（3.6 秒），披露/结果截图已人工查看；证明 title 精确投影与账号/root/功能密钥不出境，未把回环模型观察器写成托管 AI 上线。AGENTS、ADR0050/0051、文档入口与原环境陷阱 #188 已同步更新；AI 反向变异仍在继续。

- B AI 字段投影反证完成：既有 `mutate-e2ee-key-lifecycle.mjs --egress` 在固定副本跑正控 1/1、整任务序列化变异命中具名断言、逐字还原及重建后 1/1，三轮零跳过；ADR0050 当前表已同步更正为反证通过。未替代 iOS 安装产物、实体设备 Keychain 或全仓最终收尾。

- B 验收诊断防泄漏：真实反证发现 Playwright 自动 aria 错误上下文独立于截图 mask/trace 开关；Vault 配置、表单 helper 和布尔秘密断言已补齐保护。新 `check:vault-diagnostics` 正反两臂通过并接入全仓门禁与 Vault 入口；当前七条 Vault/AI 测试对固定产物复验 7/7（19.9 秒）。经验融入 AGENTS、ADR0050、原威胁模型与环境陷阱 #199，未另建记忆文档。 HTTP fixture 另验 1/1（3.5 秒），亮暗图已查看；静态生产产物下须关闭 Service Worker 才能可靠命中 HTTP fixture，原因并入 #199。文档死链、表格及门禁接线检查通过。

- B iOS Release ↔ Node host 收口（2026-10-04）：专用 iOS Release 安装产物在真实 Fastify + PostgreSQL 服务端上显式解锁 Vault 后上传任务；独立真实 SQLite Node host 以 authenticated `accountId`、轮换后 E2EE 口令和 JWT 同步并读出该任务。Node host 再写入第二条任务并同步，iOS Release 真包重新同步后 AX 树读到 `B Node to iOS task 20261004`。两端均是 payload codec，`keyVersion=2`、`payloadKeyVersion=2`；脱敏证据见 [`ios-node-vault-interop-20261004.txt`](apps/mobile/evidence/ios-node-vault-interop-20261004.txt)。这次补上的是 iOS 当前 generation 的双向互读，未把它写成 iOS legacy migration。

- B JWT fence 真实 HTTP 证据（2026-10-04）：同一旅程撤销 Node 设备后，撤销前 JWT 对 key package、ops 下载、ops 上传和 status 全部返回 `401 TOKEN_REVOKED`；新 JWT 对照旧上传前后 `latestSeq=2` 不变。此项确认服务端 tokenVersion 边界和“失败请求不改服务端事实”，但不替代 iOS UI 撤销后的本地 session/native root 清理与可信设备 root rotation。旧 root 只保留确定性 fixture 的 `root-key-mismatch`/旧世代解密拒绝证据，未伪称为 iOS 进程外真 root 证据；完整边界已写回 ADR-0050。

- B 移动撤销清理补强（2026-10-04）：审计发现设备撤销后的原生 root 删除失败会发生在 token 已清除之后；原先局部错误会因 `authStillCurrent=false` 提前返回而丢失，无法沿用登出已有的重试入口。`VaultSettingsSection → SettingsScreen → ProfileScreen` 现把失败的 `serverOrigin + accountId` scope 提交给既有 `vaultCleanupPending` 状态，保留 remembered-unlock fence 并让用户重试 native remove；新增源接线回归判据，防止任一父层断开这条状态链。`@heyta/mobile` typecheck、51 个测试文件/732 项与 `git diff --check` 通过；这只是本地失败恢复接线，仍不替代 iOS Release 真包的完整撤销、重新认证、root rotation 与密文迁移证据。

- 2026-10-04 E 状态机验证补强：在独占测试窗口定向运行 `pnpm --filter @heyta/op-log exec vitest run tests/semantic-invariants.spec.ts`，1 个文件 / 5 条通过；同窗口完整 `@heyta/op-log` 运行 9 个文件 / 112 条通过。新增的固定 seed 生成器让两台独立引擎分别经过不同批次、乱序和重复远程投递，再与纯 reducer 规范投影、逐维最大时钟和彼此可见状态对账；完整历史重试返回空 `applied` 且不推进时钟。随后运行 `node scripts/mutate-op-log-semantics.mjs`，A/D/E 九类变异全部被至少一条断言抓到。规则已写入 `AGENTS.md` §8，并同步到 [A/E/D 实施证据](docs/research/aed-implementation-evidence.md) 与 [冲突分类学](docs/research/op-log-e2-conflict-taxonomy.md)；A/D/E 的其它端到端证据仍按原文边界，不把这次定向测试扩大成全仓完成。

- 2026-10-04 D 当前树测量：重建 `packages/storage` 与 `packages/op-log` 后运行 `node scripts/measure-hydration.mjs 100000`，真实 SQLite 100,000 条历史全量恢复 10,790.9ms，checkpoint 后 100 条尾部 40.1ms，`fullScans=0`；脱敏原始输出为 `/tmp/heyta-aed-hydration-current-20261004.log`。这只更新 D 的当前 Node/SQLite 证据，不替代 Hermes 或最终全仓门禁。

- 2026-10-04 A/D 定向复核：`@heyta/sync-core` 的 frontier、100/101 时钟和冲突分类测试 3 个文件 / 14 条通过；`@heyta/op-log` 的 checkpoint 与 full-state recovery 2 个文件 / 39 条通过。当前环境未设置 `DATABASE_URL`，故真实 HTTP/PostgreSQL frontier 集成没有被误记为“通过”（它按 `skipIf` 不执行）；现有真实 HTTP/PG 记录仍按其原载体和边界保留在 ADR-0046/0047 与 A/E/D 证据中。

- B/C 收尾窗口复核（2026-10-04 15:48 CST）：活树上的 `pnpm check` 在 `pnpm -r build` 的 `@heyta/ai` 阶段被外部进程以 `SIGTERM` 终止，退出码 143；日志没有产品断言失败，也没有跑到后续门禁和 workspace tests。因此本轮只能登记为“未完成/环境终止”，不能写成全仓通过。四端重装队列仍在另一棵隔离树运行，当前未抢占设备或重启第二趟。

- 2026-10-04 B 撤销恢复规则补强：代码审查发现 DELETE 首次响应丢失、同绑定重试再次网络失败时，控制器原先会直接抛错，可能跳过本地 token/Vault session/remembered-unlock fence/native root 清理。现统一把二次网络失败、非成功 HTTP 与响应校验失败归为 `ambiguous`，继续执行完整本地围栏，并以固定回归测试证明两次 response loss 不会留下旧 root。该边界已同步写入 `AGENTS.md` §8 的第 19 条与 ADR-0050；未扩大为移动端真实撤销旅程证据。
- 2026-10-04 B 共享撤销编排修复复验：`@heyta/app-host` 定向运行后实际为 68 个测试文件 / 1343 项通过（含两次 response loss 后 `ambiguous` 与本地清理回归）；`@heyta/mobile` 51 个测试文件 / 732 项通过；app-host/mobile typecheck、文档死链/章节/表格检查及 `git diff --check` 均通过。该结果是实现层与失败恢复证据，仍不替代 iOS 真包完整撤销旅程、实体 Keychain 和 C 的原生 OS 缺口。
- 2026-10-04 16:xx 全仓门禁续跑：`pnpm check` 的构建、workspace typecheck、`check:reachability` 与 `check:shell-surfaces` 均通过；在 `check:op-log-semantics` 的变异基线处被仓库测试闸门拒绝，原因是另一会话持有 `/tmp/tfa-test.lock`（pid 8721，非产品断言失败），因此本轮退出 1，不能记作全仓通过。待锁释放后须从该门禁重跑并继续完整链。
- 2026-10-04 16:xx 全仓门禁续跑补记：本轮自行启动的 `pnpm check` 在 `pnpm -r build` 最早四个 tsup 子进程停滞约 18 分钟，`/tmp/audit-pnpm-check16.log` 无新增且进程均为本轮检查树；已仅终止该检查树，未触碰其他会话、模拟器或重装进程。该轮仍按环境挂起记账，不能视为通过；后续改用可轮询日志重跑。
- 2026-10-04 16:xx 构建复验补记：单独 `pnpm -r build` 已实际打印各 workspace 产物生成成功，但实时输出会令工具会话脱离，残留 tsup/esbuild service 进程不退出；已仅终止本轮自己的构建树，未触碰其他会话。后续使用日志重定向与退出码轮询，避免把输出管道挂起误判为构建失败。
- 2026-10-04 16:xx 构建日志复核：低输出后台 `pnpm -r build` 在 `shared-schema/sync-core` DTS 启动阶段对应进程消失且未写入退出码；此前各 package 已打印产物成功，但无法证明全链 exit 0。外部隔离 Vitest 仍占用高 CPU，故本轮只记为环境中止，待其结束后重跑，不把部分产物记作完整构建通过。

- B 撤销响应格式失败续验（2026-10-04）：首次成功响应 JSON 损坏或设备标识不符，也可能发生在服务端提交之后；新增两条先红后绿回归，修复共享编排后设备管理两文件 15/15。低层仍拒绝非法响应，上层按不确定提交保留提示并清会话，规则写回 AGENTS §8.19 与 ADR0050。本次串行全工作区测试（修复前基线）11335 通过、14 跳过；修复后 app-host 全包 68 文件、1345 项通过，typecheck 通过。未替代原生平台和当前产物门禁。

- B/C 当前主树门禁续跑（2026-10-04）：完整 `pnpm check` 已通过 build/typecheck 与前置结构、许可证、原生桥/bundle、Vault 诊断门禁；浏览器套件 155 passed、2 flaky、2 skipped（8.2 分钟），两条不稳定项为 AI 助手会话/单步提案切主题后丢失状态，失败图已查看，未隐去重试记录。链在隐私用例启动前被另一会话有效 TFA 锁拦截，未记为完整 check 通过；从该节点续跑，不绕过锁。主树仍有并行变更，最终安装产物必须重新核对。

- B/C 门禁续段：隐私浏览器 7/7、落地页 18/18、Web SQLite/IndexedDB 迁移、产物自洽、移动首启及截图注册检查已通过；存储/迁移截图已查看，不能把仍盖着首启面板的图当成任务列表视觉证据。看图发现首启隐私词条仍误称本机模式禁用所有通知，已中英同步改为不接收服务器推送、授权后的移动本地提醒可用；经验并入 ADR0051 原帮助说明段。

- B/C 首启文案复验：更新词条后的真实隐私浏览器 7/7（8.6 秒），首启图已打开检查；i18n 26/26、build 与文案门禁通过。规则融入 AGENTS §8.18、环境陷阱 #212 与 ADR0051 原帮助段，不新增孤立记忆入口。联网同意不等于系统通知授权；该证据不替代原生投递，也不意味着旧移动安装包已包含新词条。
- B Node host 本地优先收口（2026-10-04）：`openNodeHost` 不再在构造阶段拉取 key-package；真实 SQLite 的构造、列举、写入、pending、导出均经 `vi.fn` 证明零网络请求，只有显式 `sync()` 才触发远端并把失败交给调用者。`@heyta/node-host` 11 个测试文件 / 186 条通过，typecheck 通过。规则写回 AGENTS §8.10 与 ADR-0050；Android 非空双向互读证据仍不等于独立 fingerprintChanged root 轮换证据。
- C iOS 边界续验（2026-10-04）：permission-recovery 实际点击“不允许”，probe 读到 denied/pending=0/delivered=0 且 SQLite 无 fired；恢复停在 App-Prefs 未进入 heyta 通知设置，失败截图近黑且已人工查看，未升格为 UI 通过。restart-recovery 已证明关机顺序，但 probe 未产出快照；已修 RunLoop，需重编译复跑。AX 最小滚动距离、UDID 并发门禁和 probe 早于通知 delegate 接线均已修，四模式仍待真实 OS 级通过；文档入口只保留 ADR-0051，不留未跟踪截图死链。
- C iOS 边界续验更新（2026-10-04）：使用 `/tmp/heyta-ios-reminder-probe-check4` 重编译后重跑 restart-recovery；真实 occurrence `task-muto7yz3-2-ezsapvj0:1791109440000` 在关机状态跨 trigger 并重新 boot，顺序判据通过，但脚本轮询仍先于 iOS 27 冷启动 probe 文件写入而失败，未取得 recovery receipt。统一日志随后确认 probe 最终写出 `authorization=granted`、`pending=[]`、`delivered=[]` 和 scheduled ledger；脚本等待上限已从 45 秒提高到 120 秒。probe 早退生命周期原因仍标为待验证假设，不能据此关闭 restart 边界；Settings 已改为真实 AX 路径 `App → heyta → 通知、横幅、声音、标记 → 允许通知`，下一轮需重跑。
- C iOS 验收器自愈修复（2026-10-04）：真实 TCP companion 在目标模拟器上连续返回 AX/HID 请求，但 AX 空树触发 shutdown/boot 后，脚本错误地回到 Unix-domain `ensure_idb_companion`，将 TCP 地址当作 socket/二进制路径，导致重启后载体失败。`scripts/verify-mobile-ios.sh` 现单独保存 `IDB_COMPANION_BIN`，TCP 模式在重启后按原端口重启 companion，并继续使用 `idb --companion HOST:PORT`；Unix 模式保持 `--companion-path`。`bash -n` 已通过，修复已写入 [AGENTS.md](AGENTS.md) 与 [ADR-0051](docs/adr/0051-mobile-reminder-delivery.md)。这只改变验收载体的自愈，不能把尚未完成的 iOS 权限恢复、重启补算、不确定回执、64 条窗口或 B 的真包撤销旅程标成完成。
- C iOS AX 载体继续对照（2026-10-04）：TCP companion 重启自愈已能恢复并接受 gRPC，但共享 `scripts/lib/mobile-e2e.sh` 的 `idb_ui`/AX 计数仍把 TCP 地址传给 `--companion-path`，使健康树被误读为 0。现已让共享 helper 与 `ios-ax-shim.py` 统一按 `HOST:PORT` 选择 `--companion`；同一专用 UDID 的 TCP 11005 只读对照为 `AX_LABELS=11`、`JSON_OK=1`。修复通过两份脚本 `bash -n` 与 `git diff --check`，规则入档为环境陷阱 #264。完整 B/C iOS 旅程仍未闭合。
- B iOS 主认证路径对账（2026-10-04）：真实 Release iOS 输入验收在 TCP companion 修复后完成 67 项通过；唯一红灯定位为脚本漏按 AuthScreen 真实阶段“保存并启用同步”——粘贴令牌成功只产生内存 session，必须按该按钮才写入 sync config 并启动 `syncNow`。已补 `scripts/verify-mobile-ios.sh` 的阶段回读/点击，并将规则写入 [ADR-0050](docs/adr/0050-e2ee-key-lifecycle-and-recovery.md)、[AGENTS.md](AGENTS.md) 与环境陷阱 #265；此前 67/1 结果不升格为产品失败。需用当前脚本重跑确认主路径绿，其他 B/C 未闭合边界仍保留待验。

- D-3 ③ 四端当前产物收口（2026-10-05 02:1x–02:3x，载体 `heyta-wt-ai-closeout` @ `afe7ff7a`）：android/ios 一趟、mac/windows 一趟，四端**全部装在同一棵树**并逐张人眼看过截图（android/ios＝全新安装首屏同意卡，mac＝`.webview.png` 的首屏品牌帧）。Windows 六条取证齐：`ADD_APPX=OK` `PAYLOAD_WEBDIST=True` `SHORTCUT_CREATED=True` `SHORTCUT_RESOLVES=True` `M2D=OK` `RESULT=OK`；mac 另有安装对账（9 个 chunk 同一次构建）与**装好的那份**跑出的 M2 探针（身份入口成立／菜单合规／导入面板可达）。🔴 这一趟同时是 AGENTS §6.1「远程真打出 APK」那条**尚未实测**判据的第一次读数（远端 19 tasks executed、APK 66,915,556 B、sha256 与 mtime 逐字对账）；AGENTS 正文此刻被并行会话脏着，所以这条读数只落在 B79 补记 #2，不代改规则文件。生产按手册顺序重发（站点先 → 应用后）：`check:entries` 76 份 rc=0、`check:web-artifact:app` rc=0、两次 rsync rc=0。余两格未闭合读数：`check:ai-e2e`（链第 69 段）与发布后的 live-site 套件——都被宿主内存闸门挡在别人的 `vitest run` 锁外，未放宽、未并发。明细与逐条读数在 `BLOCKED.md` B79 补记 #2。

- D-3 ②③④ 读数闭合（2026-10-05 02:3x–03:1x，载体尖端 `9c3557c1`）：上一行留的两格"预期不是读数"都翻成读数了——**链第 69 段 `check:ai-e2e` 159 passed / 2 skipped / 0 failed rc=0**（AI 助手两族全绿，`bfbdc5f2` 那条修法在真浏览器真断点下成立），**发布后线上套件 live-site 23 passed rc=0**（真 TLS + 钉真实 IP + 零代理；其中一条 `console.error` 是无效 token 那条用例的**预期**行为，判据只禁 `[pageerror]`）。四端改装到尖端并逐张看图；`c3049c88` 的 iOS 去重补上真构建证据（`Skipping duplicate build file` 4 → **0**，同日志 `BUILD SUCCEEDED` 有 1 枚作阳性对照）。生产**不必为这两个提交重发**且有哈希证据：尖端重打 `/app/` 载体后 `index.html` sha256 与线上**逐字相同**（`21f981dd…`），两提交间产品面只差一枚 pbxproj。🔴 新撞见并修掉三处：全尖端第一趟 ios 腿红在 `pod install` 的 CocoaPods 偶发崩溃（`path name contains null byte`，手跑第二次 rc=0；脚本**不重试**这一格留给下一位连同判据）；W5 一条 e2e 的夹具守卫把"今天恰好是月初"当日历事实（每月 5 号后每天必红）⇒ 界改 `1..31` + 三臂有牙；Podfile 里 fmt 绕行那句"可能已升级"**每次** install 都印 ⇒ 三分支、真失效才红。明细 `BLOCKED.md` B79 补记 #3。

- D-3 交付差额（首屏帧/图标进线上）+ 补记 #3 那格回填（2026-10-05 03:3x–04:1x，载体 `ad61621a`）：上一行"生产**不必为这两个提交重发**"的判据（产品面只差一枚 pbxproj）被 `66ce1545` 推翻——那一次动的正是 `apps/web/src/boot-splash.ts`，它进 entry chunk。⇒ 按手册顺序重发（站点先 → 应用后，五步 rc 全 0 含 `check:web-artifact:app`），发完的等式有哈希：载体 `/app/` 产物 `index.html` sha256 `5abcb0e889ed40b0…` **==** 线上逐字相同，entry 由 `index-BEJaUzcy.js` 换成 `index-DtOAMgSr.js` 且把线上那份拉下来对着看到了兜底代码；线上套件复验 **live-site 23 passed rc=0**。**顺带修掉一条无界移除路径**（`66ce1545`）：首屏遮罩的退场押在"`animationend` 会来"上，而页面以 `visibilityState==='hidden'` 起跑时 WebKit 不推进 CSS 动画（`playState:running / currentTime:0`，5 拍 8 秒一个字段没动）⇒ 遮罩永久盖着应用。查出来的方式是门禁红不是投诉（`check:macos-window` 比值 0.046 → **0.011** 而 M2 探针三条全 ✅）；修法两半（不可见直接摘 / 可见则等 `animationend` + 由计算样式推导的 `+120ms` 有界兜底），判据 6 条 + 两臂变异 + 真 WKWebView 复跑读到 `null` + 门禁回到 **0.046 rc=0** 且那张图人眼看过。🔴 这条同时否证了此前**全部** mac 像素证据的载体：那些图量的都是品牌帧，而"主蓝命中 2169 ⇒ 是共享 UI"就是拿品牌帧的蓝底板过的（§7 #82 的形状）。补记 #3 明写"留给下一位"的 `pod install` 重试格已填（`ad61621a`，两趟两本账、两趟都失败仍判红、三臂台架 OK/FAIL/FAIL）。🟡 **还剩两格"没量到"**：② 的逐段读数与 ③ 的四端重装此刻由队列 pid **70122** 在阶段 2 跑（现装的四端仍是 `9c3557c1` 的产物），落账前"四端装的是含 `66ce1545` 的树"不成立。明细 `BLOCKED.md` B79 补记 #4。

- D-3 ②③ 两格"没量到"翻成读数（2026-10-05 04:0x–04:5x，链载体 `ad61621a` / 重装载体 `f8ecbd8f`）：**② 干净检出链 `rc=0`，分母现量 84 段 = 82 绿 / 1 红 / 1 按规则不跑 / 0 环境挡**——唯一红是第 42 段 `check:docs`（三条"已提交文档引用了未提交章节"），而**其中一条是本线自己造的**：`docs-link-check` 的引用正则吃的是"同行 `.md` + `§` + 数字"这个**文本形状**，我用来记录别人坏了的那句话本身就被解析成第三条引用 ⇒ `808d584a` 只改自己那一行（编号写成"编号 10.87"），干净检体现量 **3 → 2**，剩下两条归回收站/归档那条线。第 69 段 `check:ai-e2e` 按规则不在链里跑（preflight 会 SIGKILL 别人 vite，§7 #87）⇒ 队列阶段 4 单独补跑 **`AI_E2E rc=0`**。**③ 四端 `REINSTALL rc=0` + `LANDING-CURRENT`（post_drift=0）**：mac `PAX_MAC=MATCH`（已装 `index-C9iddvlQ.js` sha == 载体 `5c83a10f4c0f…`）、android `MATCH`（66,915,556 B == 构建、`lastUpdateTime 04:23:50`）、windows `FACTS-OK facts=5` + `WIN-FRESH`、ios 先报 `MISMATCH` ⇒ **查出来是探针在读错设备**：本机四台同时 Booted，探针 `head -1` 挑到别人的 `heyta-batch2-closeout`（10-04 17:04 那枚），而真目标 `heyta-iphone-17pro` 的 `main.jsbundle` sha `7655111d0df1…` **逐字等于构建产物**（mtime 04:26:59）；🔴 **这个盲选生产脚本 `reinstall-all.sh:365` 早就改掉了**（B76 那批的注释就写着"下一个动作是 simctl uninstall"），我在只读探针里把它重写了一遍 ⇒ 选择式照抄生产 + 同一个 `IOS_DEVICE_NAME` 旋钮，三臂台架 `MATCH`/`MISMATCH`/`NOT-READABLE` 全中。五枚图逐张人眼看过（mac 两枚 / ios 04:27 / android 4:24 / windows 真应用 + 菜单），**mac 的"窗口"那枚是近空的**（后台壳不合成 WKWebView）⇒ 内容判据数 `.webview.png`，窗口那枚只当尺寸核对。✅ **整链随后在 `808d584a` 补跑过**（04:36–04:59，同一枚干净载体，`chain-ai-closeout-0436`）：`pass=82 / fail=1 / skip=1 / total=84 / env-blocked=0`，与 `ad61621a` 逐项同数，唯一红仍是别线那两条"引用未提交章节"⇒ **② 的正式读数绑 `808d584a`**。（先写"没重跑"再补跑，是因为那 16 笔全是文档；补跑把"按路径集合推断等价"换成了直接读数。）明细 `BLOCKED.md` B79 补记 #5。

- B iOS Release Vault 首次发布续验（2026-10-05）：当前 Release 安装产物完成真实认证、显式“保存并启用同步”、Vault 创建与恢复码二次确认、解锁及加密任务上传；服务端回读 `key_version=1`、`active_payload_key_version=1` 和 5 条 operation。脱敏证据已链入 [ADR-0050](docs/adr/0050-e2ee-key-lifecycle-and-recovery.md) 的实施记录（证据文件不记录账号、令牌、恢复码、口令或 root）。这只关闭 iOS Release 的首次 Vault 发布腿，设备撤销后的本地清理、可信设备 root rotation、iOS legacy migration 与实体设备 Keychain 锁屏语义仍待验。当前文档检查：`check-doc-citations`、`check-md-table-rows`、`check:ios-ax-shim`、提醒脚本 `bash -n` 均通过；`check:docs` 仅因新证据文件尚未纳入 Git 跟踪而红，待同一变更纳入该文件后复跑。
- **大规模合并（产品经理视角的一次收口）2026-10-05 09:2x–11:4x，载体 `heyta-wt-merge` @ 分支 `merge/20261005`**：
  把主检出 9 组未提交改动按逻辑分组提交（`f9152fbf`…`fd8cd780`，其中两笔是**代提交**——作者是在飞的别的会话，
  提交信息里逐条写明"代提交"与不签发的部分），再把四条线并成一棵：`origin/main` → 自托管分发（载体 + 尖端两笔）
  → **详情面 184 笔 / 19 处冲突** → 本地 main 尖端 → 三次追平。冲突面**没有一处按左右文字接龙解**：
  追加型台账（`detail-pane-alignment.md` / `self-host-distribution-audit.md` / `environment-traps.md`）一律按**节次与号段**重排，
  代码面按"两侧的能力都不许掉"重派（`App.tsx` 那一栏现在是 `focus → notes → AI 面` 的按视图分派，
  main 的 AI 兜底与分支的两面同时保住，`ref={detailRef}` 是 `detailHasRoom` 的承重所以留着）。
  🔴 **traps 撞号撞了两轮**：第一次把分支的 #215/#216 续到 #273/#274，追平 main 时主线把这两个号连同 #275/#276 又各自占了
  ⇒ 按"先落 main 的号不动、后到的续号"再续到 **#279–#282**，别名链长在条目自己那一行（下一个人只读条目），
  并 sweep 全仓 4 处活引用 + `AGENTS.md` §7 索引行 `177–276 → 177–282`；顺手把 `trash-and-archive.md:9971` 那行
  "待入 traps #273" **就地标注它已被占**（照抄会撞第三次）。
  **合并照出来的真缺陷（不是冲突）**：① 习惯 `checkIn` 的下界两侧不一致（一条线当 `<=0` 无效、外部 MCP 契约承诺的是"不小于 0"）
  ⇒ 按对外契约裁决并改写两侧判据（`3f22029a`）；② `server/README.md` 把一次性披露挤到第 134 行 ⇒ 重排回 102（`4fa88938`）；
  ③ 三处"各自都对、并起来才红"的门禁：`verify-mobile-card-export.sh` 在 source lib 之后写裸 `trap` 把快照自删摘掉、
  回收站两端各一枚 `busyId` 没登记、`countdown` 这个第 12 个 ViewKey 从没对"选中"交代过立场（`ba57b1eb`）；
  ④ 追平之后 `pnpm -r typecheck` 第一次红在一处类型收窄（并顺手把同段那条 `if (!second.ok) return;` **静默跳过**改成抛，
  它失败时后面四条断言一条都不跑而用例照样绿，`aa33064d`）。
  **读数（全部在合流态同一棵树上现量）**：`pnpm -r build` RC=0、`pnpm -r typecheck` RC=0、
  `pnpm -r test` **RC=0 / 20 个包 / 11607 passed**（上一趟那条 `calendar-sidebar` 的 5s 超时单独复跑 **13 passed** ⇒ 记为并行负载超时不是产品失败）；
  静态门禁分母**从 `package.json` 的 `check` 链现量**（90 段里 85 枚 `check:*`，排除 5 段会抢共享载体的：
  `check:ai-e2e` / `check:privacy-consent-e2e` / `check:landing-e2e` / `check:macos-window` / `check:apk-freshness`）
  ⚠️ 那 5 段里的 4 段**随后在锁让路之后补跑完**（`56e08da8`）：`check:ai-e2e` **196 passed / 7.6m**、
  `check:landing-e2e` **22 passed**、`check:privacy-consent-e2e` **7 passed**、`check:apk-freshness`（它是 `--self-test`）rc=0，
  外加链上非 `check:*` 的两段 `check:entries`（76 份 rc=0）与 `screenshot:verify`（23 个目标 rc=0）；
  **只剩 `check:macos-window` 没跑**——本机此刻躺着一枚 `/Applications/Heyta.app`（pid 772）在用户手里，
  那条门禁会 pkill 同名旧实例，跑它等于把用户的窗口拿走（§8.9 只对自己创建的对象动手）。
  ⇒ **80 段跑完，79 绿 / 1 红**。
  🔴 **那一红当时的解释是错的，留原文是为了让人看清"红字自己说的原因"也要复核**：它打印的是
  "断言 A：winFacts 扫不到 ⇒ 判据失效"，我第一版把它读成"两栏未取证，归落地后的四端重装"——
  两句都不对：未取证那一栏走的是响亮跳过（`HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 才折成红），
  真正判红的是断言 A 把 `dist/windows/install-capture.txt` 这枚**未跟踪的取证产物**当成源码锚点扫
  ⇒ 每一枚干净检出上 `pnpm check` 结构性必红。已修成"两侧名字对账"并补四臂台架（`56e08da8`，
  `AS_EXPECTED=10/10`），入册为环境陷阱 **#283** 的同批；两栏未取证**仍然**归落地后的 `pnpm reinstall:desktop`，
  只是它不再是这条红的原因。`check:vault-diagnostics` 那一红查出来是**载体缺件**
  （`e2e/` 是独立 workspace，这棵 worktree 从没装过它 ⇒ 探针读不到报告），`cd e2e && pnpm install` 后两腿 PASS。
  详情面那一族按它自己 §3e 留的处置补完：合流时 `--ours` 取的 10 枚证据 PNG **重跑三个 spec 重出并逐张看过**
  （`8 passed / 11.8s`，`0a1475a2` 的提交信息里逐枚写读数）。
  🔴 **已推送**：`git push https://github.com/Xaiver03/heyta.git merge/20261005:main` ⇒ `d1ab7f26..8ace31e9`（**fast-forward，无 force**；
  这台机器上 SSH 那条通道不可达，走的是既有的 HTTPS，未改任何 remote 配置）。
  ⚠️ **还剩两格没闭合，别读成已完成**：① **本地 main 落地**——主检出此刻有 21 枚未提交文件，其中
  `AGENTS.md` / `docs/README.md` / `package.json` / `trash-and-archive.md` / `android-build-on-windows.md` 与本批**同文件重叠**，
  `git merge` 在脏树上会拒绝，归各所有者提交后执行（main 在两个小时内自己推进了 6 笔，这是个移动靶）；
  ② 上面那两栏**未取证**，要在落地后的那棵树上跑四端重装才量得到。
- **② 的桌面半格已就地关掉（同一载体，10-05 12:2x–12:3x）**：`NO_COLOR=1 bash scripts/reinstall-all.sh --only mac,windows`
  ⇒ **`REINSTALL_RC=0`**，汇总两行都是 ✅（"已清旧包、重打、重装、有当前产物判据"），另外两行大字列出
  "⏭ android／ios：不在 `--only` 范围 —— 这端**没有**验证当前产物"。读数（日志 `/tmp/heyta-reinstall-desktop.log`）：
  mac 侧安装对账 **9 个 chunk 与本机 `apps/web/dist` 同一次构建**、窗口 `2164x1432`、
  `.webview.png` 内容占比 **71.4%**、**主蓝命中 1127**（§7 第 82 条那条判据，不是"非空白"）；
  windows 侧远端新鲜度对账 **`web-dist/index.html=d224aeea6de8f658…` / `bridge=c4802ee077443329…` / `assets/*.js=7 枚一致`**
  （§7 第 82 条的"远端字节 == 本地工作树"），远端取证 **"判据齐了：5 条全在位"**。
  🔴 **两张图都打开看过**（§6.2 规定一第 4 条）：装出来的都是真共享 UI —— 收集箱 + 四象限 + 清单/标签侧栏 +
  右栏「AI 工具调用 / 对话助手」+ 首启联网同意卡；windows 那张还开着头像菜单，**「登录 / 注册」是第一项、没有「退出登录」**
  （2026-09-30 那单的身份入口判据在**当前产物**里仍然成立）。
  ⇒ 跑完后 `node scripts/check-shell-surfaces.mjs` **5 绿 / 0 红、未取证 0 栏**：那两栏从此有产物读数，不再靠"没打过包"解释。
  🔴 **没把 android/ios 也跑掉是决定，不是遗漏**：这台机器此刻有**两条别的会话的 iOS 设备台架在飞**
  （`/tmp/heyta-reinstall-ios.png` 11:34、`/tmp/heyta-reinstall-android.png` 11:29 都是**主检出那棵树**的产物，
  不是这棵合流树），§8.9 不许共享载体上并行覆盖 —— 移动两半要么等台架空出来、要么归落地后那棵树跑一次全量。
  ⚠️ 顺带把"当前产物"这个词用准：**四端里只有桌面两端装的是合流态**，别把 `REINSTALL_RC=0` 读成四端。
  **① 的读数换成现量**（12:4x）：追平 `main` 后（`82aeb9ac`，那 2 笔只碰 `calendar-profile-handoff.md` 与
  `calendar-line-commit-only-arms.sh`，合流态上把那枚 rig 的 `--list` 重跑成 **pass=9 fail=0**），
  落地阻塞面 = `git diff --name-only main merge/20261005`（**345 文件**）∩ 主检出未提交（**29 文件**）
  = **恰好 8 枚**：`AGENTS.md` `PROGRESS.md` `docs/README.md` `docs/plans/trash-and-archive.md`
  `docs/reference/environment-traps.md` `docs/runbooks/android-build-on-windows.md` `package.json`
  `research/tools/mutation-rigs/README.md` —— 全是在飞会话的**文档与链配置**，不 stash、不代提交，
  归各所有者落笔后 `git merge --ff-only merge/20261005`（远端 `main` 已经是这条线，所以落地只是把本地那棵跟上，
  不影响别人从 `origin/main` 并入）。
  另记一条**看图照出来、但不属于本批口径**的产品观察：四象限与时间线那两张图里右栏是空的，
  这是 main 侧既有设计（`App.tsx:1605` 的 `aiPanels` 自己写着 `{contentView === 'tasks' && …}`），
  而产品负责人 2026-10-04 那句"无状态的时候默认显示 AI Chatbot"要不要从任务视图扩到全视图，归详情面那一单判——
  我没有在合并笔里顺手改产品语义。

- **收尾轮（2026-10-05 12:4x–12:5x，同一载体）：三处"两套状态"的过期断言 + 装机判据的一条下界**
  1. 🔴 **我上一笔写下的"不跑 `check:macos-window` 的理由"是过期的**：那句说"它会 pkill 同名旧实例、
     等于把用户的窗口拿走"。现量：`capture-window.sh` 早在 **09-30** 就改成"记 PID + `trap … EXIT` 只收自己起的那个"、
     **10-01** 又给选窗加了 `--pid "$CROSSCHECK_PID"`（`pkill -f HeytaMac` 只剩注释里的历史，`grep -nE '^\s*pkill'`
     在这条路径上零命中）。跑完 ⇒ **`exit 0`**：`contentOnModalRatio **0.327**`（阈值 0.02）、
     M2 三条 ✅、交叉验证 `CROSSCHECK=ok(2240x1440)`。⇒ 链上那 5 段排除项里，**这一段的读数现在有了**，
     80 段的"1 段没跑"收成 0。教训同族于 §7 元规则 1：**"不能跑"这个判断本身也要复核，它可能是上一轮读到的旧代码。**
  2. 🔴 **那条"首屏品牌帧 vs 就绪锚点"的未闭合格已经关了，而且关法与在册的"正解"不是同一条**：
     真根因是遮罩的**移除路径没有上界**（后台壳页 `visibilityState==='hidden'` 时 WebKit 不推进 CSS 动画 ⇒
     `animationend` 一次都不来），已由 `66ce1545`（10-05 03:51，`boot-splash.ts`：不可见直接摘 +
     由 `animationDuration` 推导的有界兜底 + 六条判据两臂变异）修掉。
     ⚠️ 而 `BLOCKED.md:4982` 与那枚门禁注释里写的正解"给就绪锚点加一条 `#heyta-boot` 已摘除"**是被否证的**：
     遮罩根本不摘时，那条锚点只会把自截图拖进 45s 兜底那一格，红还是红。已把注释改成真根因 + 一句"先查移除有没有上界，
     不要动锚点、不要调低阈值"（`scripts/check-macos-window.mjs`），`BLOCKED.md` 那一格留给该线自己收（它正被别人写着）。
  3. **三处"四条跳过分支尚未拍"是过期断言，就地更正**：裁决 `1030a560`（10-01 12:03"平台门禁跳过分支裁决落地"）
     比它们都早 —— `help-center-docs-expansion.md` §10 写于 10-01 03:38（早 8 小时，属正常滞后），
     而 `goal-multi-end-coverage.md` 的两处写于 **10-03 12:42 / 13:53（晚两天）**，
     因为它是**从那份旧文档抄的**、没读被抄的那枚门禁。现量：只剩"平台不符 / 没有 `swift`"两条绿色跳过，
     `exit 4` 与"有 Aqua 却取不到图"判红。⚠️ 一般规律：**"尚未拍"这类句子的保质期取决于别人有没有拍完，
     抄它的人必须去读被裁决的那个本体。**
  4. 🔴 **装机判据的一条真缺陷 + 有推导的下界**（`scripts/reinstall-all.sh` 的 `shot_ok`，四端共用这一层）：
     首屏**品牌帧**那块底板本身就是主蓝 `#2563EB`（`gen-boot-splash.mjs` 的 `--heyta-boot-plate: PRIMARY`），
     现量三张 ⇒ 品牌帧 内容占比 **0.00943 / 主蓝 2000**、真界面 **0.7141 / 1127**、最空的真图（浮层压暗底）
     **0.1034 / 835**。也就是说"主蓝 ≥ 20"不但拦不住它，还给它打了真界面的**一倍以上**；
     它今天没骗过去只因为 `looksBlank` 的 0.01 压在 0.00943 上，**余量 5.7%**，而这两个数之间没有因果关系。
     ⇒ 新增 `MIN_CONTENT_RATIO = 0.05`（取最低真图实测的一半：对品牌帧 5.3 倍、对最低真图 2 倍；
     不复用那枚门禁的 0.02，因为它是从"错误屏 0.004 / 未合成 0.006"推的，对品牌帧只剩 2.1 倍）。
     **五臂 A/B**：品牌帧 ⇒ 🔴 `rc=1`（同时被 `looksBlank` 与新下界各抓一次）；mac 真装机 / android / ios /
     最空真图 ⇒ 四条 `rc=0` 且逐条打印占比数字。⚠️ 顺手记一次**我自己的探针错**：第一次量我用
     `looksBlank(<路径字符串>)`，而它的入参是 `inspectPng` 的**结果对象** ⇒ 传字符串时 `undefined < 0.01` 恒为
     `false`，我当场把品牌帧读成"非空白"、并据此写下"它把四条判据全部满分满足"这句**过强的话**（已在同一笔里改回来）。
     📌 待入 traps（**不抢号**：`git diff --numstat` 现量 `183 1`，未提交部分里已有 **#284/#285** 在飞）：
     「`looksBlank` 收的是 stats 对象不是路径，传路径恒 `false`」+「装机判据的主蓝命中数会把品牌帧打得比真界面更高，
     占比下界必须从最低真图推」。
  🔴 **同一轮照出的第二枚真缺陷（探针自己的入参形状）**：`scripts/screenshots/png-stats.mjs` 里
  `looks*` 一族收 **stats 对象**、`count*` 一族收 **路径**，两族相邻、名字都像谓词 —— 把路径喂给
  `looksBlank()` 时 `stats.contentRatio` 是 `undefined`，而 `undefined < 0.01` 恒 `false`
  ⇒ 那条"判空白"的判据**不是变红，是被无声摘掉**（§7 元规则 2 点名的形状，且这枚判据有
  **20 个调用点**、四端打包/门禁/移动验收都在用）。修法三层：① `requireStats()` 在两个 `looks*`
  入口**响亮抛** `TypeError`（点名函数 + 打出被误传的路径 + 给修法）；② 用例从 13 条补到 **16 条**
  （第一条是**阳性对照**：把错误用法那个式子原样写进断言，证明它确实恒 `false`；第二条才断言"现在会抛"）；
  ③ README 那句"分两层"跟着改成**三层**（不留两套状态）。
  **牙齿现量**：摘掉两处 `requireStats()` ⇒ `14 pass / 2 fail`（`not ok 15`、`not ok 16`）；
  全部 7 处 `st/stats` 赋值点逐条核过都来自 `inspectPng(...)` ⇒ 没有把任何一条现有判据改红；
  `screenshot:verify` 复跑 **23 个目标 rc=0**。
  ⚠️ 顺带**否证掉自己上一条假设**：我一度以为 `verify-artifacts.mjs:83` 的 `looksBlank(file)` 是同一个 bug
  的活体（它旁边 `countBrandBlue(file)` 收的就是路径），读到手发现那枚 `file` 是
  `inspectPng()` 的返回值（`:44`）—— **同名变量不等于同一种形状，判之前要读到赋值那一行**。
  📌 **登记一条缺口，不在本轮代改**：`pnpm screenshot:test`（跑这 16 条）在 `package.json` 里**只有定义、
  没有任何自动载体**（现量：`node -e` 扫全部 scripts，除自身外零引用；`check` 链里零命中；
  `check:gate-wiring` 只扫 `check:*` 名字，`screenshot:test` 从它的分母里漏出去）。
  为什么不并进链：`check:gate-wiring` 的允许表里此刻正写着一条同族裁决 ——
  「链段分母被并行会话计数，此时并进去会把别人的读数改成谁都对不上」（`check:android-build-host` 那条），
  而主检出的 `package.json` 这一小时里确实被别人改过链那一行（加 `check:ios-ax-shim`）。
  ⇒ 两个候选落点交给下一个数分母的人定：**并进链**（改 `check` 那一行），或
  **挂在已有的 `screenshot:verify` 定义里**（只改那一枚脚本的定义行，不动分母）。
  📌 **同一枚洞的落点是现量数出来的，不是猜的**：全仓把主蓝当**阈值**用的只有两枚
  （`grep -n 'countBrandBlue('` 去掉定义/测试/打印语句 ⇒ `scripts/reinstall-all.sh:140` 与
  `apps/desktop-macos/scripts/package-app.sh:248`），两处都补了同一条 0.05 下界并各自 A/B 过：
  前者五臂（品牌帧红 / mac·android·ios·最空真图绿），后者**四臂**（品牌帧两种传法都红、
  真装机与最空真图绿，读数 0.9% / 71.4% / 10.3%）。`verify-mobile-notes.sh:711` 那处印主蓝但
  明写"不当阈值用"，不动。⚠️ 后者的判据代码是 `package-app.sh` 里的一段 heredoc，
  验法是把**那段真实代码**从文件里抽出来跑（不是照抄一遍），跑前把相对 import 改成绝对路径。

## 2026-10-09 · 入站自动收集（付费自动收集）Goal 开工回执

1. 目标：让负责人能对 AC-1～AC-8 逐条点头，之后才允许开公网接收与售卖。
2. 顺序：T1 签发端与账号绑定 → T2 宿主续票据与票据消费所在事务 → T3 双真宿主 13 个故障窗口 → T4 事件级计量账本 → T5 界面层入库 → T6 对外说明与限定取代旧承诺的 ADR → T7 全仓门禁与四端重装 → T8 严格复审。前四件决定"能不能卖"，后四件决定"敢不敢开"。
3. 最大风险：赶进度时最容易偷工的就是**判定算得对**这一格 —— 票据或权益任何一处放宽，直接变成"自托管白送"或"收钱不交付"，所以每条新判据都要过一次反向验证（亲手弄红再还原）。
4. 任务 0 已逐条亲手复跑（本机 16:52–16:54）：`python3 research/tools/verify-inbound-worker-identity.py` **38/38** 且 rc=0；`server` 票据+草稿+公网接收三文件 **47/47**；`node scripts/check-migrations.mjs` rc=0；`node scripts/check-docs-voice.mjs` rc=0；`node research/tools/license-inventory.mjs` rc=0；`node research/tools/docs-link-check.mjs` rc=1，唯一一条不是本线（`apps/desktop-windows/README.md:89`）；`grep -c '^- \[ \] \*\*AC-' docs/plans/inbound-automation.md` = 8、已勾 0。
5. 发现**任务书自己写错了两条判据**，已记 `BLOCKED.md` B102 并在那里给出改用版本：窗口数不许按行号数（行号区间里坐着别人的实施顺序），完成条件第 2 条那种"与开工快照枚数相同"在并行提交下量的不是我的动作。
6. 界面层的挡路条件已解除：`packages/i18n` 进了 HEAD，界面用到的 72 个词条键中英两侧都齐（现量见 B102 与计划里那条更正），计划里那句旧断言就地改写，不留两套状态。

### T1 签发端与账号绑定握手（2026-10-09 17:3x–17:5x）

- **持久层**：两枚新迁移 `20261018180000_add_automation_entitlement_issuance`
  （subjects / activations / links）与 `20261018190000_add_automation_entitlement_revocations`，
  `node scripts/check-migrations.mjs` rc=0；`prisma validate` 通过、`prisma generate` 通过。
  🔴 **一次性真库装置里这两枚 SQL 在 PostgreSQL 14.18 上逐条应用成功**（日志见下条，装置在测试腿之前被载体挡住）。
- **为什么主键这么长**：`activations` 用 `@@id([userId, installationId])` ⇒ "一台实例同时最多一张活码"
  是表的形状而不是一个要维护的标志位；`links` 用 `installationId` 做主键 ⇒ 一台实例只有一个当前绑定，
  **换主体必须先撤销**（否则一枚新码就能顶掉别人在这台实例上的绑定）。
- **绑实的那一格**：`session` 票据的 `officialSubject / installationId / localAccountUuid`
  三个 claims 全部取自 `links` 行，请求体一个字都不参与；此前"客户端自报本地账号"那一格
  由兑换激活码这一步把它钉成服务端记录的事实。
- **吊销在线刷新**：下限落 `automation_entitlement_revocations`（官方侧存运营者抬上去的值，
  自托管侧存**上一次验过签**的清单值），判定用的下限 = 环境变量与库里那一个的**较大值**
  （`withAutomationRevocationFloor`，接在 `evaluateAutomationEntitlementForUser` 与
  `authorizeAutomationOperation` 两处，不改已入库的票据内核）。清单由客户端**转述**，
  但只认用本部署公钥环验过签的那个数，且合并只升不降。
- **判据**：新增 `server/tests/automation-entitlement-issuer.spec.ts` **12 条**，与既有票据
  套件 20 条同跑 **32/32 绿、0 跳过**；`npx tsc --noEmit -p tsconfig.json`（server 全项目）**0 错**。
  任务书要求的三条各有一条红的落点：错实例（`ACTIVATION_INVALID`）、错主体
  （`LINK_CONFLICT`）、吊销落后（`REVOKED_VERSION` 走闸门 + `AUTOMATION_REVOCATION_STALE` 走票据）。
- ✅ **真库那一腿读数已取到**（18:06，一次性 PostgreSQL 14.18 + 真 HTTP + 真 Ed25519，零 mock）：
  `python3 research/tools/verify-inbound-worker-identity.py` → **`Tests 43 passed (43)`、`Test Files 1 passed (1)`、PY_RC=0**
  （本线基线 38 条 + 这一段新增 5 条）。⚠️ 中间三次被本机内存闸门挡下（`立即可用 138/185MB < 384MB`，
  占载体的是并行会话的 e2e，pid=90222）—— **不降那个阈值、不改装置**，等台账放开才跑出来的。
- 🔴 **臂 5 抓出一条真缺陷（不是测试写法坏了）**：`createEntitlementGuard` 组装的 `source` 只有
  `readSubscriptions` + `readBinding`，所以"在线刷新的吊销下限"**从没被 HTTP 闸门读过** —— 写进库之后
  只挡住了 `/verify` 那一处显式核验，`PUT /automation/recipient-key` 与逐次 action 票据照旧放行。
  修在闸门两处（无 action 分支补 `readRevocationFloor`；有 action 分支把 `source` 换成
  `lockedAutomationEntitlementSource(tx)`，下限在**同一把事务**里读），并新增注入点
  `loadAutomationRevocationFloor`。反向验证两条各恰好 1 红：
  臂 5（摘掉 action 分支的下限读）→ `expected 'AUTOMATION_SUBJECT_CONFLICT' to be 'AUTOMATION_REVOCATION_STALE'`；
  臂 6（摘掉无 action 分支的下限读）→ `expected 200 to be 402`。两臂还原后 `cmp` 逐字一致。
  📌 可迁移的那条：**同一份下限要按"谁消费它"枚举**，只在一处接线等于没接。
- 集成段修掉两处我自己写错的测试（都不是产品判定）：`installationId` 简写引用了不存在的变量
  （那个 describe 里叫 `installation`）；"旧下限"票据曾去取一条本场景从未创建的绑定行，现在三元组
  取自 `links` 行；`recipient-key` 的请求体改成按库里当前 `packageVersion` 递推，否则路由自己的 409
  会抢在闸门的 402 前面，红的是别的账。
- ⚠️ **还欠的那格**：还原两臂之后再跑一次装置时被内存闸门拒了启动（同上那条，18:07 那趟）。
  43/43 对应的是 `cmp` 逐字相同的那一份源码，但**合并态整仓重跑**（`pnpm -r test` / `pnpm check`）
  仍欠着 → `BLOCKED.md` B104。
- 文档回写：`docs/plans/inbound-automation.md` 文末新增「2026-10-09 T1 签发端与账号绑定握手」一节，
  P1-3 那条与两处"仍然没闭合的"旧断言都指向它（不留两套状态）；`docs/reference/inbound-automation-protocol.md`
  §4 把握手与在线刷新的**机制**写实（活码域分隔、明文只出一次、`session` 三字段取自 `links`、下限取 max），
  未闭合清单只剩续票据/展示、票据供给方、票据消费所在事务三格。门禁：`check-docs-voice` rc=0、
  `check-migrations` rc=0、`docs-link-check` rc=1 且唯一一条仍是那条非本线的（`apps/desktop-windows/README.md:89`）。
- ✅ **T1 已入库（六笔，只本地提交、未 push）**：`3fcc3bef` 持久层（schema + 两枚迁移）·
  `b087dd67` 签发端与判定层 · `dc1750ab` HTTP 面 · `8f3df6ed` 判据 · `82e16169` 计划与协议 ·
  `302e1802` 台账。每笔 `--stat` 的枚数等于点名的枚数（3/2/1/2/2/2，逐笔读回贴在上面那条命令的输出里）。
  `server/src/api.ts` 走的是"**HEAD 那一份 + 本线切片**"的 blob（别人的在飞改动一个字没带走）：
  现量 = 提交后 `git diff HEAD -- server/src/api.ts | grep -c '^+.*[Aa]utomation'` → **0**，
  而剩下的 131/33 全是 `normalizeEmail` / `sessionMetaFromRequest` / registration-otp 那一族。
- ⚠️ **共享索引的那一格必须跟着刷**：plumbing 提交之后主索引对**新 HEAD** 是落后的，`git status` 会把
  刚提交的六笔内容报成 `D`（暂存删除）+ `??`（未跟踪）。这不是丢文件，是索引不知道 HEAD 里有它们 ——
  真正的问题是别人随后用主索引做一笔提交就会把这两枚迁移和签发端**整个退回**。
  刷之前先证"索引里没有别人的暂存工作"（逐枚对 `idx blob == 旧 HEAD blob`，八枚全等、四枚新路径无条目），
  再逐枚点名 `git update-index --add --cacheinfo 100644,$(git rev-parse HEAD:<path>),<path>`；
  复验：本线 12 枚路径的状态行只剩 ` M server/src/api.ts`（那是在飞改动，不是我的）。
- 入库后门禁读数：`check-migrations` rc=0、`license-inventory` rc=0、AC 未勾 8 / 已勾 0。
  切片带过去的 14 枚 import 符号在 HEAD 里逐个 `git grep` 命中 ≥1（`requireAdmin` 也在）——
  这是"拼出来的那一份树"的**符号级**核对，整树编译仍在 T7 的隔离副本上做，不拿它冒充。

## 2026-10-09 22:1x · T2 第三格（票据消费从闸门事务挪进业务写事务）—— ✅ 本格闭合

- 做了什么：五处逐次放行动作（`worker-register` / `rule-enable` / `sender-credential-issue` /
  `event-claim` / `result-publish`）的闸门改成 `precheckOnly: true`（只离线预检，不开事务不写库），
  票据经路由传给各自的服务，在**业务写事务内、账号锁之后、第一笔不可逆写之前**消费。
  `authorizeAutomationWrite` 的射程定为"有没有一次性东西要烧"：没出示票据就什么都不做 ——
  官方模式没有一次性凭据，写成"再判一次订阅"会让每次内部写入都去读订阅行，那是重复判定不是加防护。
- 🔴 顺手抓到并当场修完的一条（是我自己 T1 留的）：`selfhost-online` 没配公钥环时原来抛裸 `Error`
  出 preHandler ⇒ HTTP **500**；客户端把 500 读成"服务端坏了、重试"。两处调用点（闸门与
  `authorizeAutomationOperation`）都改成回 `ISSUER_NOT_CONFIGURED` 判拒 ⇒ **402**，
  那个会抛的 `configuredAutomationKeyring()` 已删。**判据口径没动**：402/403 的分布照旧。
- 边界（不包装成完成）：`ai-reserve` **仍由闸门消费** —— 它的计量走位置参数的 `SqlRunner` 端口，
  接不住 Prisma 形状的 redeem；要么复制一份判定（正是本仓库"同一个判断写三遍"那个漂移源头），
  要么改端口形状（牵连托管额度那一路）。两个都不便宜，所以留在闸门并在路由上注明，
  同时进计划 T2 那节的落点表。
- 读数：六文件单测 `Tests 51 passed (51)` rc=0；新形状判卷单跑 `Tests 10 passed (10)`；
  真库 `--config vitest.integration.config.ts --maxWorkers=1` ⇒ `Tests 45 passed (45)`、`REAL_RC=0`
  （一次性库 `heyta_inbound_wtx_20261009`，本机 homebrew postgresql@15，迁移已用仓库脚本应用）。
  ⚠️ 那次"No test files found"不是红：默认 `vitest.config.ts` 的 `exclude` 里就排掉了
  `tests/integration/**`，集成腿必须带 `--config vitest.integration.config.ts`。
  静态门：`tsc --noEmit` rc=0、`check-docs-voice` rc=0、`check-migrations` rc=0、
  `license-inventory` rc=0、`docs-link-check` rc=1 且唯一一条仍是那条非本线的、
  AC 未勾 8 / 已勾 0。
- 反向验证两臂（各只红自己那一条，都 `cp` + `cmp` 从 `.mut-bak` 还原后复跑为绿）：
  臂 1 摘掉 `precheckOnly` ⇒ 真库那条回滚判据红（`expected 402 to be 409`）；
  臂 2 把授权移到 `automationSenderCredential.updateMany` 之后 ⇒ 形状那条红
  （`expected 797 to be less than 619`）。🔴 **臂 2 真库那套打不红**：吊销与后续失败同事务，
  回滚把差别抹平 —— 所以形状判据是它唯一防线，这条判据不许因为"真库更全"而被当成多余。
- 📌 一条判据教训（臂 2 的第一版是**假臂**）：标记写成 `.create` 时，"在 create 之前、却在吊销之后"
  这种改法照样满足判据，所以变异注入后什么都不会红。标记必须落在**第一笔不可逆写**上
  （吊销旧 worker / 旧凭据那两笔 `updateMany`）。另外那次假臂差点没被看出来是因为它同时被内存闸门
  挡住了启动 —— **存活读数之前先 `sed -n` 把改动后的那几行打出来确认变异真进了产物**。
- ✅ 已入库四笔（只本地提交、未 push）：`4b84584d` 判定层与业务写事务落点（5 文件）·
  `c6808d1e` HTTP 面（1 文件，`api.ts` 走"HEAD + 本线切片"）· `3e7f7e41` 判据（2 文件）·
  `ce52fa26` 计划与协议（2 文件）。每笔 `--stat` 的枚数等于点名枚数（5/1/2/2）。
  切片核对：`diff /tmp/api.slice.ts server/src/api.ts` 的 164 行差异里 `[Aa]utomation` 命中 **0**
  ⇒ 我的改动全进切片、别人的注册验证码/`normalizeEmail`/`issueSession` 那一片一个字没带走。
  共享索引按新 HEAD 逐枚刷过（刷前先证 9 枚已有路径 `idx blob == 旧 HEAD blob`、新文件无条目），
  复验：本线十枚路径的状态只剩 ` M server/src/api.ts`（那是在飞改动）。
- T2 还欠三格（都在本线地界内，下一轮做）：宿主每 30 秒续票据、`X-Heyta-Entitlement-Ticket`
  的供给方（app-host 里还没有生产者）、`waiting-entitlement` 展示。
  `automation_entitlement_clocks` 的退役清扫登记成 `BLOCKED.md` **B106**（落点越界 + 判据口径要人拍）。

## 2026-10-10 00:2x–00:4x · T2 续：逐次动作的取票通道（服务端这一半闭合）+ 顺手把本线测试的类型错清掉

- 做了什么：闸门那五处逐次放行动作要的 `X-Heyta-Entitlement-Ticket` **第一次有了供给方** —— 官方实例上
  `POST /automation/entitlement/ticket`（`server/src/api.ts`）按绑定行签发 8 枚非 `session` 动作的票据，
  作用域照 `AUTOMATION_ENTITLEMENT_SCOPES` 走（带 rule / 带 event / 都不带，三档互斥），
  主体、实例、本地账号三枚字段**只从 `automation_entitlement_links` 读回**，请求体一个字都不参与。
  `server/src/automation/entitlement-issuer.ts` 新增 `signAutomationEntitlementActionTicket`；
  `session` 明确拒（`AUTOMATION_ISSUER_ACTION_UNKNOWN`）—— 混用会让一次登录换到一张通用通行证。
- 🔴 边界（这条通道判什么、不判什么）：官方那侧只判"主体 X 可不可以对这个作用域做动作 Y"，
  **不判**这条 rule／event 是不是真属于那个本地账号 —— 归属只有客户实例知道（它看不到用户的 E2EE 数据）。
  写进了计划与协议两份文档，别被读成"官方帮着校验归属"。
- 判据：`server/tests/automation-entitlement-issuer.spec.ts` 12 → **17**（新增那 5 条含一枚分母自检
  `expect(actions).toHaveLength(8)`，动作词表加一项而作用域没登记 ⇒ 那条先红）；
  `server/tests/integration/inbound-worker-identity.integration.spec.ts` 45 → **46**。
- 读数（都在对话里贴过）：`Tests 17 passed (17)` · 八文件腿 `Test Files 8 passed (8) / Tests 83 passed (83)` ·
  真库装置 `Tests 46 passed (46)` + `PY_RC=0` · `npx tsc --noEmit` rc=0。
  反向验证两臂：臂 1 摘掉 `session` 那道拒 ⇒ `Tests 1 failed | 16 passed (17)`；
  臂 2 把作用域判定改成"带不带都行" ⇒ 同样 `1 failed | 16 passed (17)`；两臂都 `cmp -s` 证过逐字还原。
- ✅ 已入库三笔（只本地、未 push）：`0b7ff357` 签发端与 HTTP 通道（2 文件 +98/−2）·
  `ad7112e0` 判据两腿（2 文件 +135）· `ec58db71` 入库装置 `research/tools/verify-inbound-api-slice.py`（1 文件 +156）。
  `api.ts` 是混合文件，走"HEAD + 只带本线那两段"的切片配方；切片的三条不变量（每段只允许一枚顶层声明、
  锚点必须命中一次、删掉的行必须恰好等于那一行 import）都写进装置并有 `--self-test` 三臂。
  ⚠️ 第一版切片用"第一个裸 `);`"当结束标记，**把别人那 531 行吞进来**（打印 `+584`），是这套不变量逼出来的形状。
- 顺手抓到并当场修完的一类（B107）：本线那两枚**测试文件**里有 4 处类型错（不存在的类型名、替身行推导丢了
  索引签名、可空列直接进 `JSON.parse`）—— `server/tsconfig.json` 的 `include` 不含 `tests/**`，
  所以它们**不参与任何类型检查**，只有真跑那一条腿才现形。修法都不动断言；复量本线 4→0、全仓 224→220、
  `tsc` 仍 rc=0、两文件 `Tests 37 passed (37)`。**正式把 tests 纳入类型检查会一次亮 220 片别人线的红**，
  那是全仓判卷口径 ⇒ 记 B107 等负责人拍，本线不代改构建配置。
- 环境事实（本线的命令要照它写）：**vitest 对点名的不存在文件不报错**，只跑存在的那几枚还报 rc=0
  —— 我那条"八文件腿"的第一次尝试实际只跑了两枚。点名枚数必须自己数、再和 `Test Files` 那行对账。
  另一条：这台机器的测试内存闸门在 00:3x–00:4x 连拒三次（291MB、105MB < 384MB），
  按"不动别人 pid、不调低阈值"处置为换下一项 ⇒ B104 那一格（还原后的装置复跑）**仍开着**。
- 🔴 本轮自己造的一个错，如实记着：那两笔（`426d4eff`、`6d06bae4`）**是空提交** —— 当轮重写的列交函数把路径参数也 `shift` 掉了，
  树与父逐字相同而 `commit-tree`/`update-ref` 一律成功，`--oneline` 里看不出任何异样。是"读回 `--stat` 的枚数"这条规矩把它抓出来的。
  真笔已重落，两枚空笔留在历史里（并行会话已把它们当父，不改写别人的历史），全过程与三道闸在 **B108**。

- T2 宿主生命周期（app-host 那一半 ✅ 已入库 `a9ca6464`，7 文件）：新增 `inbound-entitlement-tickets.ts`
  （按动作取票 + 安装身份），`inbound-worker.ts` 五个闸门调用可附 `x-heyta-entitlement-ticket`、
  402 回类型化的 `AutomationEntitlementRequiredError`（带服务端 `reason`），`inbound-process.ts`
  在 claim / ai-reserve / result-publish / commit-permit 四处**各取各的一枚**，权益不足回
  `waiting-entitlement` 状态而不是回一条报错。判据读数每次现量：
  `ls packages/app-host/tests/inbound-*.spec.ts | xargs npx --no-install vitest run --no-color`
  （点名枚数必须等于 `Test Files` 那行；本轮实测基线 11 文件 65 测试 → 加完这批 11 文件 76 测试，
  新增那 13 条住在 `inbound-entitlement-tickets.spec.ts`。条数每次重新取，别抄这里的数）。
  反向验证 6 臂（票据头永不附 / 永远附 / 摘掉 claim 的 402 分支 / 摘掉某一处取票展开 /
  把等待族放宽成"所有取票错误" / 摘掉 402 那一层捕获）各红且只红对应那条，逐臂 `diff -q` 证还原。
  ⚠️ 臂本身也会骗人：第一次写"永远附票"那枚时把箭头函数改成了块体，vitest 报的是
  `Transform failed` + `Tests no tests` —— **编译不过的红不是行为红**，重写成 `=> ({…})` 才拿到真读数。
  还欠两格（都在宿主外壳那侧，不在 app-host）：**每 30 秒续 `session` 票据**、`waiting-entitlement` 的界面展示。

## 2026-10-10 17:5x：宿主侧落两格，另量出一道拦路的前置（**这是接着做的人要先看的一段**）

`70f1dcd0`（点名列回 `6 files changed, 188 insertions(+), 8 deletions(-)`；`index.ts` 走混合切片配方，
切片 = HEAD + 只我那一行：922→923，外来标识符 `habit-export` 在切片里 0 次而工作树 1 次）落的两格：

1. **草稿确认取自己那一枚票**：`createInboundDraftReviewer` → `decideDraft(..., {action:'draft-confirm', eventId})`；
   取消不取票（服务端允许无订阅取消）。app-host 侧新增 4 条判据 + 3 条负向对照。
2. **安装身份的落盘**：`packages/app-host/src/inbound-installation-store.ts`（只写一次 / 坏值不覆盖 / 退登不清），
   7 条判据。住在 app-host 而非各壳：web 与 node-host 共用同一个 `DbAdapter` 端口（AGENTS §3.5）。

读数（当日现量，别抄）：`ls packages/app-host/tests/inbound-*.spec.ts | xargs npx --no-install vitest run --no-color`
⇒ `Test Files 12 passed (12)` / `Tests 91 passed (91)`，跳过 0；
`npx --no-install tsc --noEmit -p tsconfig.spec.json` rc=0；`npx --no-install tsup` rc=0
（`createAutomationInstallationMetaStore` 在 `dist/index.js`/`.d.ts` 各命中 2 次）。
反向验证 4 臂：身份可被覆盖 1 红 / 坏值按空 1 红 / 确认不带票 2 红 / 取消也去取票 1 红，
逐臂还原后与变异前**全文逐字相等**（比对方式是读回原文比较，不是只看"跑绿了"）。

🔴 **web 侧故意没接取票源**，因为量到一条会让接线变成回退的事实：
票只在 `official` 模式的实例上签得出（`server/src/api.ts:660-664`），签票又要求这台 `installationId`
已有绑定行（`server/src/automation/entitlement-issuer.ts:323-324`），而客户端既没有"签发方 URL"这个概念、
也没有绑定握手的调用方（`packages/app-host/src/inbound-entitlement-remote.ts` 只有 `verify` 一个出口）。
⇒ 无条件取票会把官方实例上**已订阅、本来能用**的用户读成"等待权益"。三条候选修法与代价登记成 **B109**，
那一格连着一次新的数据出境（自托管实例的用户要把 installationId + 账号 JWT 送到官方域名），**不代拍**。

`waiting-entitlement` 的界面展示也量到了硬边界：**词条不存在**（`zh-CN.ts:5261-5265` 只有四条状态），
而 `packages/i18n` 正被并行会话写着（`git status --porcelain -- packages/i18n` = 3 条脏）。
挪用 `failed` 那条会把"没买到资格"说成"处理失败"，是任务书点名要消除的那类错，所以登记成 **B110** 并写好一次成对的
中英追加；词条进去后我这边的收尾是两行（`useState` 联合 + 返回类型换成 `InboundAutomationCycleResult`）。
顺手记 **B111**：安装身份的 META 键按仓库惯例该进 `packages/storage` 的 `META_KEYS`，那个文件不在本线白名单。

下一格（不受 B109/B110 挡）：**T3 的双真 SQLite 宿主 13 个故障窗口装置** —— 照
`research/tools/verify-inbound-worker-identity.py` 的形状新建 `verify-inbound-*.py`，自报 n/n 且拒绝 0/0。

## 2026-10-10 02:0x · 起 T3 之前先量了 HEAD 自不自洽 —— 量出 41 条红，并把本线自己那一半关掉了（**这是接着做的人要先看的一段**）

T3 要在两个真 SQLite 宿主上跑故障窗口，而宿主跑的是 `@heyta/app-host` 的 **dist 产物**。所以动手前的第一把尺不是判据，是"HEAD 到底能不能编译"。两条尺同一轮跑：

| 尺 | 读数 |
|---|---|
| 工作树 `pnpm exec tsc --noEmit -p tsconfig.spec.json`（app-host） | **rc=0，0 条错** |
| 同一根尺跑在干净的分离检出（tracked 文件逐字等于已提交点） | **rc=2，41 条错** |
| 分离检出里 `pnpm exec tsup` | **rc=1**，dts 报 `src/index.ts(25,8) TS2305: Module '"./host.js"' has no exported member 'InboundAutomationHostOptions'` |

41 条全部是"已提交的代码引用尚未提交的成员"，五处来源、四处在本线地界之外 —— 明细、归因表、三条修法与要拍的板在 **`BLOCKED.md` B112**。这一格把前面几轮写的"app-host typecheck rc=0"限定住了：**那是工作树读数，不是 HEAD 读数**；T7 那三条命令在 HEAD 上过不去，与别的线无关的部分由 B103 记着。

本线地界内当场关掉的那一半：`InboundAutomationHostOptions` 的定义搬进 `packages/app-host/src/inbound-host-options.ts`（形状与未提交那版 `host.ts` 里的逐字相同），`index.ts` 改从它 re-export ⇒ 本线自己那条 dts 失败消失，HEAD 的 app-host 打包不再被本线挡着。

| 项 | 读数 |
|---|---|
| 切片与反向验证 | `python3 research/tools/verify-inbound-host-options-slice.py --self-test` ⇒ 三臂全部拒绝、`臂数=3，全部成立=True`、rc=0；不带 `--self-test` ⇒ `切片相对 HEAD：+2 行 / -1 行`，删加逐字打印，rc=0 |
| 工作树 app-host typecheck（搬完之后） | rc=0，0 条错 |
| 工作树 app-host `tsup` | rc=0 |
| app-host inbound 测试 | `Test Files 12 passed (12) / Tests 91 passed (91)`，跳过 0（与上一轮基线同数） |
| 未提交的 web 界面层四条 inbound 用例 | `Test Files 4 passed (4) / Tests 8 passed (8)`，跳过 0 —— 文件仍未入库（T5 被 B112 的四处接缝挡住，现在落只会让 HEAD 更红） |

边界，不包装成完成：
1. 这格没有真复跑 HEAD 级 dts（那要一棵带 node_modules 的干净检出，现成那枚分离检出不是本会话建的，不动别人的载体）。按错文构造这一格是关掉了；**下一条会话请起自己的隔离副本真复跑一次**，预期 TS2305 那一行消失、`META_KEYS.INBOUND_*` 那 24 条仍在（判 HEAD 用 tsc，别用 dts —— 外包在 dts 里按各自 `.d.ts` 解析，分离检出的 dist 可能比源码新，这 24 条不一定现形）。
2. `host.ts` 落地时**必须删掉它自己那份同名 interface、改从 `./inbound-host-options.js` 导入**，否则一枚契约两处定义（AGENTS.md §3.5 那个"抽取了但旧的那份没删"的形状）。该文件不在本线白名单，只能登记。
3. B109（票由哪个 URL 签发）与 B110（waiting 词条）仍然开着；B112 是第三条拦路的，且它挡的是 T3/T5/T7 三格。

下一格（不受 B109/B110/B112 挡）：T4 的事件级计量账本 —— 全在 `server/src/automation/` + `server/tests/` 地界内，`pnpm --filter @heyta/server test` 自己就能判，不依赖 app-host 的 dist。

## 2026-10-10 02:2x · T4（P1-4）事件级计量账本：落了两处语义缺口，并第一次把"冻结解析结果"逐条现量

（上一节写的"下一格"就是这一格。它确实在 `server/src/automation/` + `server/tests/` 地界内做完，零外部前提。）

**量出来的不是缺表，是缺语义**：账本形状（复合主键 + `billing_source`/`period_anchor` 的库层 CHECK）在三枚迁移里早就立着。
本轮补的是两处：① `reserved → released`（预留了却没发出去）不退托管额度 ⇒ 用户在一次没打到供应商的尝试上付费，重试还要再扣；
② 没有逐事件/逐周期的对账读路径 ⇒ "额度少了一次"这类账当时没人能判是不是自动收集造成的。

**退款实现挂在 CAS 命中那一侧**，不是另加"已退过"标志位：状态转移那条 `UPDATE … WHERE state = $6` 本身只可能命中一次，
退款与它同事务，所以"重复释放不退第二次"由库保证。`sent → released` 与任何 `→ unknown` **不退**（前者供应商真的花了一次，
后者不知道 —— 两种选择都有一种是错的，而不退是"少白送一次"那一侧）。重试是新 `attempt`、重新扣：一次物理调用一次额度，这是刻意的。

**对账口径诚实处理共用计数器**：`ai_usage_counters` 是账号级的，人工托管对话与自动收集共用同一行，而人工侧刻意不留逐请求记录
（ADR-0054 §2 那张表四列）。所以只有 `counter < charged` 一个方向算缺陷；多出来的部分原样披露成 `unexplainedByAutomation`，
**不判成缺陷** —— 把它判成缺陷等于宣称这个账号除了自动收集不该用托管 AI，那不是这段代码知道的，也不是对外承诺过的。

| 项 | 现量读数 |
|---|---|
| `cd server && npx --no-install tsc --noEmit -p tsconfig.json` | **rc=0**，0 条错，本线文件 0 条 |
| `npx --no-install vitest run tests/automation-ai-metering.spec.ts tests/automation-ai-metering.pglite.spec.ts` | `Test Files 2 passed (2)` / `Tests 16 passed (16)`，跳过 0（既有桩式那 4 条未动仍绿） |
| 新那 12 条的载体 | 真 PGlite；DDL 从**发布中的迁移文件**按后缀推导目录读，锚点缺失就抛（不静默建半张表） |
| 四臂反向验证 | 拿掉退款 ⇒ 3 红；去掉 `requests > 0` 守卫 ⇒ 1 红；让 `sent → released` 也退 ⇒ 1 红；把人工用量当缺陷 ⇒ 2 红。逐臂还原后源码哈希 `432e423772f9a5a0`，复跑 12/12 |
| 全套 `server` | `Test Files 2 failed \| 153 passed (155)` / `Tests 6 failed \| 2733 passed \| 1 skipped (2740)` —— **6 红 + 1 跳都不是本线**：换入 HEAD 版 `ai-metering.ts` 复跑同两文件，红集逐字相同（6 failed / 97 passed）。归属与那枚 HEAD 上就有的 `it.skip` 登记 **B115** |
| 入库 | `0788432dc5788b881f7b57503defd6d86d1183b3`，点名列回 `点名枚数=2 实际变动=2`（`server/src/automation/ai-metering.ts`、`server/tests/automation-ai-metering.pglite.spec.ts`），提交前 `git diff --cached --name-only \| wc -l` = 0 |

**「冻结已取得的解析结果」这一格是本轮才逐条现量的**（此前只写在计划里，从没量过 —— 这正是 §7 那条"能力已实现 ≠ 机制在位"的形状）：
`packages/app-host/src/inbound-process.ts:92` 先读冻结回执 → 94 行那个三元让 claim 只在没有冻结结果时发生 → 129 行不给 `transport`
→ 157 行 `if (transport)` 跳过整个解析与预留，**恢复路径上一次模型调用都不发**；恢复出的密文要 121-126 行逐字段对上服务端回执（含对任务列表重算一次摘要）；
服务端 `events.ts:296-300` 只在 `(parseVersion, digest, ciphertext, itemCount)` 全等时幂等成功。钉住它的是既有断言
`packages/app-host/tests/inbound-process.spec.ts:124`（断言的是**请求路径序列** `[recover, commit-permit]`，多一次 claim 就多一次解析与预留，当场红）。
反向验证：把 `inbound-process.ts:94` 的 `recovered === undefined` 改成恒真 ⇒ `Tests 5 failed \| 9 passed (14)`；
从 `.mut-bak` 还原后哈希 `ded53859a863242c` 与改前逐字相同、`git status` 该文件干净，复跑 `Tests 14 passed (14)`。共享工作树没留变异。

**T4 做完的与没做的，逐条对上 P1-4 那句话**：
按事件/解析版本/尝试归属 ✅（账本形状既有 + 本轮的对账读路径）｜reserve/consume/release/unknown ✅（状态机既有）｜
退款 ✅｜冻结已取得的解析结果 ✅（本轮现量，机制在位）｜managed 额度与自动收集能逐事件对账 ✅（口径边界见上）。
**没做的三格不包装成完成**：① 对账函数**没有消费者**（两个落点都在白名单外，A/B/C 与推荐登记 **B113**）；
② `unknown` 不退这一句要不要写进对外说明是 T6 的事，而"按供应商回执二次判定"与 ADR-0054 那张四列表不能同时要，登记 **B114**；
③ 跨周期退款退的是那枚尝试行自己记的锚（真库腿 256 行那条用例钉着），售卖文案要不要提它 → T6。

AC 现量（同轮）：`grep -c '^- \[ \] \*\*AC-' docs/plans/inbound-automation.md` = **8**、
`grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md` = **0** —— 一条都没勾，公网接收与售卖继续关闭。
下一格：T2 剩余里唯一不受 B109/B112 挡的那半 —— 每 30 秒续 `session` 票据（`waiting-entitlement` 展示被 B110 的词条地界挡着，
clocks 退役清扫被 B106 挡着）。

## 2026-10-10 02:4x · T2 那半格：`session` 心跳的消费者（机制与判据入库，消费者仍是零个）

上一节末尾指的"下一格"就是这一格，它做完的部分只依赖 `packages/app-host/` 自己，不受 B109/B110/B112 挡。

**量出来的形状还是"零件都在、没人接"**：`verifyAutomationEntitlementTicket` 有实现有测试而**一个消费者都没有**，
服务端 `/api/automation/entitlement/session` 在 app-host 侧**连客户端函数都不存在**。绑定行的寿命等于票据寿命，
票据窗口 ≤30 秒 ⇒ 宿主不续期，一次收信之后最多 30 秒公网接收就**静默**变成"这台实例没有权益"。
新文件 `packages/app-host/src/inbound-session-keepalive.ts`（236 行）补的就是那一条心跳。

三条不是"看起来对"的判定：

1. **排期从服务端答复推，不拍墙上时钟**：下一次 = `expiresAt - 剩余寿命/3`（夹 ≥1 秒防热循环）。
   用比例而不是毫秒数，因为它说出含义——一个窗口里最多还容得下两次失败续期；退避档位同样从寿命推
   （`寿命 × 2^(连败-1)`，上限 `30 × 寿命`，上限只为"签发器不可达时别热循环"存在，不是对外承诺的数字）。
2. **三族失败各有归宿**：`waiting-entitlement` 与 `retrying` 都**继续退避重试**（订阅到账后用户不必重开应用）；
   签发侧说"这个请求本身不对"（作用域不符/绑定冲突/寿命越界）判 `error` 并**不再排下一次** ——
   把 bug 说成订阅问题是说谎，对着签发器猛敲是二次伤害。
3. **票据正文只在那一次往返里活着**：状态对象里没有 `ticket`、没有 `localAccountUuid`，只有稳定码；
   新增的 `AutomationEntitlementVerifyError` 只带稳定码，**不回显响应里的自由文本 `error`**。

| 项 | 现量读数 |
|---|---|
| `packages/app-host` `npx --no-install tsc --noEmit -p tsconfig.spec.json` | **rc=0，0 条错** |
| `vitest run tests/inbound-session-keepalive.spec.ts tests/inbound-entitlement-remote.spec.ts` | `Test Files 2 passed (2)` / `Tests 14 passed (14)`，跳过 0 |
| 本线 inbound 全族（`ls tests/inbound-*.spec.ts \| xargs vitest run`） | `Test Files 13 passed (13)` / `Tests 103 passed (103)` —— 上一轮同尺 12/91 ⇒ 净 +1 文件/+12 条，没有一条变少 |
| `npx tsup`（app-host 产物） | rc=0 |
| 四臂反向验证 | A 排期改固定 20s ⇒ 1 红；B 去单飞 ⇒ 1 红；C `retrying` 判成 `error` ⇒ 1 红；D 票据塞进状态 ⇒ 2 红 |
| 还原 | 源码哈希 `7678c7cc5a028ab1` 与改前逐字相同，复跑 `Tests 12 passed (12)`；`.mut-bak` 已删，共享工作树没留变异 |
| 入库 | `de18b73002f72f34c99df94a3b5fec63058ae6fc`，`点名枚数=4 实际变动=4`，`4 files changed, 491 insertions(+), 4 deletions(-)`；提交后 `git read-tree HEAD`，`staged_after=0` |

🔴 **A 臂是这四臂里最有价值的一条**：它证明"排期由服务端答复推导"不是注释而是判据。写死的常数恰好在 30s 窗口下等于 20_000，
所以只给一个窗口的那条用例挡不住它 —— 用例**同时**给了 30s 与 12s 两个窗口（20_000 与 8_000），一个数字守不住两条。

**切片账（共享检出里的第二次手工切片，登记 B117）**：`packages/app-host/src/index.ts` 相对 HEAD 只有 1 处差异
（替换第 902 行那枚 export，+7/−1），而工作树里另有 **13 处不属于本笔的未提交差异**（B112 那四处接缝正被别人写），
一行都没被带走。判据用 `difflib` 的真实 opcode（`len(ops)==1` + base 切片逐字等于旧行 + 新切片逐字等于我给的行），
第一次那版用"行集合差"数新增行数：`export {` 在文件里别处也存在 ⇒ 把 7 行数成 6，断言当场失败 —— 已换成 opcode 判定。

仍然不包装成完成：
1. **`startAutomationSessionKeepalive` 已导出、已进 HEAD，但没有一处在宿主里 start 它** ⇒ 消费者数量现量是 0。
   前置就是 B109（签发方 URL 从哪来 + 绑定握手的调用方在哪），登记 **B116**。
2. `waiting-entitlement` 的界面文案等 B110（`packages/i18n` 地界）；`automation_entitlement_clocks` 的退役清扫等 B106。
3. 这一格没有真机/真宿主读数 —— 心跳的两跳打到真服务端要等 B109 落地后由 T3 那套双真 SQLite 宿主一起取。

AC 现量（同轮）：`grep -c '^- \[ \] \*\*AC-' docs/plans/inbound-automation.md` = **8**、
`grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md` = **0**。
下一格：T6 对外说明。**起手就量到一条改变任务形状的事实**（登记 B118）：任务书那句"新写一枚 ADR 限定取代 ADR-0017/0020"
已经被 [ADR-0060](docs/adr/0060-automation-entitlement-and-retention.md) 占着 —— 它 §2 逐字就是"本决定仅针对自动收集，
限定取代 ADR-0017 与 ADR-0020 中'自托管的所有功能都不校验付费资格'的适用范围"，状态是**已接受（2026-10-07 负责人裁决）**，
而计划 §W0 那句"商业限定见 ADR-0060"早就链着它 ⇒ 再写一枚同号不同文的 ADR 是制造两套裁决，`docs/adr/` 也在白名单外。
⇒ T6 能在白名单内做的只剩 `docs/reference/` 那两份（协议 + 定价事实源）；
"中英条款、帮助"两半的落点在 `packages/legal/src/documents/` 与词条/帮助页，全在白名单外，
而 `pnpm check` 里那六枚 `check:legal-*` + `check:ai-quota` 会把生成物与真源逐字对账 —— 只改 `docs/reference/` 那一层
会不会把某把尺改红，要在动笔前现量，不能猜。

## 2026-10-10 03:0x · T6 第一批：`docs/reference/inbound-automation-protocol.md` 与 HEAD 对账，改掉三处会说谎的句子

按 B118 的现量结论做（ADR 那一半已由 ADR-0060 占着、`docs/adr/` 与 `packages/legal`、词条都在白名单外），
本批只动白名单内那两份里被 HEAD 推翻的措辞。**先量后写**：改的三句每一句都有当轮的代码位置对着。

| 改掉的说法 | 为什么它当时是假的 | 现在的写法 |
|---|---|---|
| 「`X-Heyta-Entitlement-Ticket` 在客户端侧还没有供给方」 | `inbound-worker.ts` 里五对（选项声明 + 请求头附着）、`inbound-rules-remote.ts:105/177`、`inbound-draft-review.ts:128` —— 除 `session` 之外八个动作全带票 | 逐动作列出落点，并写明"续租不带票：它不在动作词表里"、"取消那支不带票请求"（45 行现量） |
| 「各宿主每 30 秒续票据」整句挂在未闭合里 | 机制与判据已在 HEAD（`de18b730`），缺的是**没有宿主 start 它** | 拆成两半写：机制闭合 / 消费者数量现量 0，并明写"公网接收不得因这条心跳入库就被读成绑定会自己续上" |
| 「累计模型周期额度不退还」 | T4 之后 `reserved → released` 会把 `managed` 那一枚退回计数器（同一条 CAS 内），这句话照原样读会反过来说 | 限定成"删除规则不退还**已经消耗掉的**额度"，并指出唯一反向情形退的是"一次没有发生的事情" |

新增的对外可读段落：三种状态转移各自的计费方向表（`reserved→released` 退 / `sent→released` 不退 / `→unknown` 不退，
各自一句为什么）、退款挂在 CAS 侧所以"只退一次"由库保证、跨周期退的是那枚尝试行自己的 `periodAnchor`、
以及**对账读路径的口径边界**（账号级共用计数器 ⇒ 只判"计数器 < 已计费尝试数"一个方向，多出来原样披露）。
对账函数**还没有界面或后台消费者**这一句也写进去了（B113），不把它写成"运营已经能查"。

| 项 | 现量读数 |
|---|---|
| `node scripts/check-docs-voice.mjs` | rc=0 —— ⚠️ **这条读数不给本批背书**：它自己打印"扫描 site.* 1074 条"，`docs/reference/` 不在它的分母里 |
| `node research/tools/docs-link-check.mjs` | **两次读数都记**：本批改完第一跑 **rc=0**，收尾复跑 **rc=1**，红的那一条始终是开工快照里那条别线的 `apps/desktop-windows/README.md:89 → scripts/windows/launch-data-transfer-qa.ps1`（本机有、git 没跟踪）。⇒ 它在同一轮里随 HEAD/索引摆动，**不是本线引入的死链**（本批新增文本 grep 不出任何指向未跟踪文件的链接），归属仍是那条线的 |
| `node scripts/check-doc-citations.mjs` | rc=0，`SELFTEST=pass`（路径维/无锚维/假 SHA 维三臂都抓到），文档 1 份、span 2000、锚 8 枚 |
| `node scripts/check-ai-quota-consistency.mjs` / `check-pricing-consistency.mjs` | 各 rc=0 —— 本批没动 `pricing-and-entitlements.md`，这两条是"没有把额度口径改成分叉"的证据 |
| 表格结构尺（`check-md-table-rows.mjs`）的**覆盖现量** | 🔴 它的 `FILES` 是一张**显式登记表**，本线那两份**不在表里** ⇒ 直接跑它 rc=0 对本批证明为零。做法：把那枚脚本的 `FILES` 换成 `PROGRESS.md`、`BLOCKED.md`、计划与本份协议四份、`CODE_SPAN_BASELINE` 清空（那是别人文件的登记），跑同一份判据代码 ⇒ `4 个文件 … 都一致`，rc=0 |
| 上面那把尺拓到本线的反向验证 | 往协议文档尾部注入一枚 2 列的行（表头 3 列）⇒ **`protocol.md:195 这一块的表头下面没有分隔行（GFM 把它当裸文字渲染 ⇒ 列数判据对整个碎片失效）`**，rc=1；从 `.mut-bak` 还原后哈希 `68f8f56dc73171d8` 与注入前逐字相同，复跑 rc=0，`.mut-bak` 已删、工作树只剩本批的合法修改 |

登记 **B119**：`scripts/check-md-table-rows.mjs` 的登记表不含 `docs/plans/inbound-automation.md` 与本份协议文档
⇒ 本线往后每次加表都得自己带一次"把 FILES 换成本线两份跑同一份判据代码"的现量，或者由仓库治理把这两枚并进登记表
（那是别人那把尺的覆盖口径，本线不代改，理由见 B107 同一族）。

仍未闭合（不包装成完成）：中英条款与帮助页同步（白名单外，B118）、`unknown` 那一句要不要写进对外文案（B114 裁决）、
每周期 300 次那句要不要说明跨周期退款那一格（B114/本批同族）、`waiting-entitlement` 界面文案（B110）。
AC 现量：未勾 8 / 已勾 0。

## 2026-10-10 03:1x · T6 第二批：定价事实源与 §6 的 `grants` 对上了，并把 B118 要求的那批尺逐枚跑了一遍

上一节按 B118 只做了"该不该动笔"的判断，这一节是动笔的那半 —— 全在白名单内的那枚
`docs/reference/pricing-and-entitlements.md`。**先量后写**，动笔前发现一处同一份文档内的自相矛盾：

- §1 那张表的「授予」列两行写 `hosting` + `ai`；
- §6 的 `pricing-ssot` 块写 `grants: ["hosting","ai","automation"]`（门禁 `check:pricing` 只比 JSON 块与价目表代码，**比不出表格 prose**）
  ⇒ 这句话以前没有任何一层在守，而它是对外承诺的正文。ADR-0060 §1 已裁决 `automation` 随 AI 档授予，
  所以**表是错的、JSON 是对的**，按裁决把表补齐并加限定，不改 JSON、不动价格与 SKU 数。

改了四处，每处都指到裁决或代码：

| 落点 | 改法 | 依据 |
|---|---|---|
| §1 表两行 | 授予列补 `automation`，并在"现在能买吗"那格写清 **解除禁售 ≠ 自动收集可用** | ADR-0060 §1；§2.2 的六条未闭合 |
| §1 「自建自托管永久免费、不校验」 | 加限定：普通同步仍然免费不校验；自动收集在自建实例只看官方签发票据，**这条限定取代 ADR-0017/0020 那句的适用范围** | ADR-0060 §2 逐字 |
| §1 「没有任何功能是被钱锁住的」 | 读成"收费清单上没有功能，只有服务"：`automation` 在 grants 里是因为它必须借云端 AI 那台服务器代发，**不新增 SKU、不改售价周期、不按事件另收费** | ADR-0060 §1 |
| §2 权益对照 | 新增自动收集那一行（三档各说各的：自建要绑官方付费主体 / ¥5 不含 / ¥12 授予但未到可交付） | 协议 §4 |

新增 **§2.2**：五句对外必须说清的口径（一次物理调用=一次额度、从未发出的那次退回、已发出与 `unknown` 照计、
**额度是共用的不是另给一份**、删规则不退已消耗的、7 天与摘要留到规则删除、撤销有至多 30 秒窗口必须披露、
走云端 AI 那一段**不是端到端加密**），每条带锚点；再加"为什么现在不许卖"的六条具名缺口
（B109/B110/B112/B106 系 + T3/T5/B113），末尾留现量命令而不是抄数。

**B118 要求的那次"逐枚复跑"做了**（尺名按 `check` 链现量重取，不靠记忆）：20 枚对外承诺类门禁里
**16 枚 rc=0**：`check:pricing`、`check:ai-quota`、`check:ui-language`、`check:legal-copy`、`check:legal-permissions`、
`check:legal-host`、`check:legal-closure-truth`、`check:legal-gdpr`、`check:egress-wording`、`check:docs-voice`、
`check:claims`、`check:detail-pane-c1-coverage`、`check:journey-coverage`、`check:integration-coverage`、
`check:payment-entry`、`check:ai-coverage`。⇒ **本批没有把任何一把对外尺改红**，
"只改能改的那两份会把尺改红或把口径改成分叉"那个担心被现量否证。

**4 枚红，逐条归属到别线**（都不是本批造成的，且落点全在白名单外，登记 **B120**）：

| 尺 | 它报的 | 归因 |
|---|---|---|
| `check:legal-tools` | 本机接口工具目录 30 条里有 4 条（`append_task_checklist`、`get_task_estimate_context`、`set_task_estimate`、`set_task_priorities`）没进法务中英表 | 别的线加的工具；要补的表在 `packages/legal/src/documents/`（白名单外）。**这正是 AGENTS 那条"封闭句式必须对账"的门禁在自己起作用** |
| `check:server-legal` | `server/src/legal.generated.ts` 与 `@heyta/legal` 版本指纹不一致（`privacy@1.9;personal-info-list@1.6;…`） | 有人改了对外文本版本号没重生成；生成的那枚文件不在白名单，重生成命令它自己给出来了 —— 属那条线的一键活 |
| `check:reachability` | 「已建模 ≠ 可达」红在 `COMMENT` 那一族 | 与本线实体无关（本线 13 枚实体登记齐全的那一段它自己打了 ✅） |
| `check:docs` | 开工快照里那条未跟踪 `.ps1` | 同一条，别线 |

⚠️ 这四枚 + `server` 全套那 6 条红（B115）会一起挡在 T7 的 `pnpm check` 上；本线不顺手修、不代改判卷口径，
只把它们在同一张表里列全，好让负责人一眼看出"合流之前 `pnpm check` 不会自己绿"。

表格结构尺的载体复现（同 B119 那把尺，清单换成含本批这枚的**五份**）：`5 个文件 … 都一致`，rc=0。
AC 现量：未勾 8 / 已勾 0（同轮跑的两条 grep，见上一条目）。

## 2026-10-10 03:1x · T8 逐条复审第一版：AC-1～AC-8 每一条有没有一把能复跑的尺

逐格表（命令 + 当日读数 + 它量的是哪一句）落在[唯一计划](docs/plans/inbound-automation.md)
文末同名小节，这里只记本轮**新量出来的三件事**，不复述那张表。

1. **有尺的那几格当日全绿**：12 条测试命令 = 41 个测试文件 / 418 条 / 跳过 0
   （合计由每份日志里 vitest 自己打的两行汇总相加得到，不是手加）。
   与任务书 0 那一格唯一对不上的数字是 `verify-inbound-worker-identity.py`：写下的是 38/38，本轮 **46/46**
   —— 方向是**多**（T1 的签发/绑定/吊销几组用例进来了），所以"测试数只许 ≥ 基线"这一条成立。
2. **三条句子根本没有尺**（这才是复审的产出，不是"还没测"）：AC-3「两个独立真实宿主跑 13 个窗口」缺装置，
   `research/tools/verify-inbound-*.py` 现量只有 3 枚，其中两枚是入库切片器；AC-6「用户独立完成那条旅程」
   那半缺尺（真浏览器那份只有 2 条，且**文件头自述走 route 桩**，它量的是界面形状不是旅程）；
   AC-8 矩阵**无产物**。三格各自挡在 B112（HEAD 仍缺四枚成员：`git show HEAD:` 逐枚命中 **0**，
   六枚文件仍 `M`）与 B109/B110 上 —— 现在硬做等于在没有可编译的树上写装置。
3. **本批新做的一枚双向臂 ⇒ 登记 B121**：对外表格里「这一档授予哪些 capability」那一列**不在任何尺的分母里**
   （删掉 prose 那枚 `automation` ⇒ `check:pricing` 与 `check:ai-quota` 都 rc=0；
   阳性对照把 JSON 块 `300` 改 `299` ⇒ `check:ai-quota` rc=1 并逐条点名 5 处消费者）。
   两臂之间与之后各还原一次，sha256 前缀 `05303dfe5088f029` 逐字相同、该文件 porcelain 为空。
   修法是改判卷口径 ⇒ 不在本线自己动。
4. **把第三次手工的"表格形状"配方收成常驻装置** `research/tools/verify-inbound-doc-tables.py`（白名单内路径，
   就是 B119 那格留的"该固化"的债）：它不重写判据，运行时把本线四份**并进** `scripts/check-md-table-rows.mjs`
   的登记表。当日读数：`12 + 4 = 16 份 …✔`（本线四份形状干净，含本轮新写那三张表）；
   `--self-test` 三臂 `臂数=3，全部成立=True`，真 rc=0。造它时先错在一版**替换**清单，
   于是报出别线那枚文件的"反引号基线 3 现量 0"，而真尺同日 rc=0 —— 那格的教训写在计划那一节末尾。
5. **把完成条件第 2 条换成一枚能复跑的尺** `research/tools/verify-inbound-commit-scope.py`（B102 里登记的那条替代量法，
   原来只有我手工跑的读数，现在固化了）。当日读数：
   `窗口起 2026-10-09 16:52　本线笔数=34　涉及路径=43　越界=0`，rc=**0**；`--self-test` rc=**0**，
   臂数由它自己打印（阳性对照那臂要**逐枚命中**已知三枚越界，不是"报了点什么"就算过）。
   造它时踩到两格，都记在计划那一节：① 第二臂原来写成"窗口 `1995-01-01` 之后应当为空"，
   实测它枚举到 **41** 笔 —— 那是**整条历史**不是空分母，臂的方向写反了；改成调用真入口 `report()` 取一个未来窗口，
   它必须回 `REFUSE`（rc=1）才算"没枚举到东西不许报干净"。
   ② 更要紧的一格：笔的归属是按提交信息里的 `自动收集` 取的，而**本机 git user 对所有并行会话同值**，
   作者字段区分不了 —— 若我自己某一笔没带这个词，`越界=0` 就是漏了分母的假绿。
   手工反查（窗口内 186 笔，按词命中 34）先量出**动了 `server/tests/`、`server/src/api.ts` 却没被计入的有 7 笔**，
   逐笔读 subject 确认它们是账号标准套件那条线的（那些路径同样在**它们的**白名单内，不该算我越界），
   于是不能用"有没有动到共用路径"来反查；改成只属于本线的独占路径清单反查 ⇒ 漏网 **0** 笔。
   这一格固化成第三臂，且它带**分母自检**：计入的那些笔里必须真的有独占路径（当日 16 笔），
   否则"漏网=0"是空集给的而不是过滤器给的。

一条取证纪律，记下来防下一次误读：本轮**第一跑**那枚 Python 装置是 rc=1，红因是宿主侧并发档
`内存闸门拒绝启动：轻量档已有 2 趟在跑（上限 2）`，占用者是**另一个仓库**的 vitest。
按 §7 那条"先怀疑探针"，这一格记成**环境未闭合**而不是产品红；第二跑拿到 46/46。
另：`... | tail` 那种写法读到的 rc 是 `tail` 的，本轮两枚切片器自测的 rc 是**不经管道**取的（各自 rc=0）。

仍未闭合（不包装成完成）：AC-3 的双宿主装置（等 B112 拍板）、AC-6 的旅程与真浏览器复跑
（复跑会改写白名单外那 16 枚已跟踪 PNG，故本轮不动它）、AC-7 的中英条款与帮助（B118）、
AC-8 的矩阵产物（B112 + T7 三条命令）、T2 心跳的消费者（B109）。AC 现量：**未勾 8 / 已勾 0**。
