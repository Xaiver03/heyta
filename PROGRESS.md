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

### ④ 四端重装（AGENTS §6.1.1）—— 跑了，两端因环境红

`pnpm reinstall:all` 完整执行（**没用 `--skip`、没降判据**）：

| 端 | 结论 |
|---|---|
| android | ✅ APK 重打 63M → 模拟器全新安装 `Success` → 截图 `contentRatio 0.068` / **主蓝 9279** |
| ios | ✅ Release 重打 → 全新安装 → **已装的包比源码新** → 截图 `contentRatio 0.066` / **主蓝 9450** |
| mac | 🔴 `.app` 已重打已签名已装进 `/Applications`，卡在启动判据：`SCShareableContent` 拿不到窗口，而同一进程树里 `screencapture -x` 直接报 `could not create image from display` ⇒ **发起方没有屏幕录制权限** |
| windows | 🔴 `ssh … 10.111.127.237: No route to host` ⇒ 源码同步没通过 ⇒ **脚本按设计拒绝打包**（宁可不装也不装旧产物） |

两张截图**人都看过了**：都是 heyta 欢迎页（中文、主蓝「注册 / 登录」），不是错误屏。
两端要用户处置的路径写在 `BLOCKED.md` 第 4 项 —— ⚠️ **那一版本轮没有提交**：
`BLOCKED.md` 同时带着另一条线（macOS 存储宿主）未提交的改动，按边界不替它提交。
在它们提交之前，工作树里那份才是完整的。

### 这一轮的门禁现状

`pnpm check` 这条链上，除 `check:macos-window`（上面那条环境原因）之外**全部 exit 0** ——
包括 `check:ai-e2e`、`check:docs`、`pnpm -r test`（`sync-server` 因沙箱里 `prisma generate`
EPERM 排除，它本身只贡献 1 skipped / 0 passed）。

⚠️ 一次批量里 `check:journey-coverage` / `check:ai-e2e` / `pnpm -r test` **各红过一次**，
**单独重跑三条全绿** —— 与另一个会话的 `pnpm build`（tsup `clean: true` 会先删 dist）并发撞上去了。
记在 `BLOCKED.md` 第 4 项末尾，别照着它归因到代码。
