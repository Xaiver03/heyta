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
（`pnpm -r typecheck` 现在会红在 `packages/legal`，那是别人在飞的 +117 行，见 B46）。
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
