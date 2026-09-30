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

