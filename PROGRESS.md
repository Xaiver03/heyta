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
| `pnpm check` | exit 0 | 当时 🔴 e2e `motivation.spec.ts` 2 红（**预存在**）→ **收尾轮已修**（见 §收尾轮）。现在整条链只剩 `check:macos-window` 红，且是**这台机器上发起方没有屏幕录制权限**（`screencapture` 直接报 `could not create image from display`），不是代码坏了 | ⚠️ 见 `BLOCKED.md` 第 4 项 |

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

## 进度

- [x] ① AI 审计报告落盘
- [x] ② 域名迁移上线 + 文档 §3.7.2
- [x] ③ PWA 缺陷修复 + 变异验证 + 线上复验
- [x] ④ 管理后台：ADR / 计划 / 迁移 / CLI / 后端 / 客户端 / 前端 / 测试
- [x] ④ 部署上线：迁移已应用、`/api/admin/overview` → 401、前端已上（均在容器里核实）
- [x] ⑤ 线上验收 5/5 绿；五道结构性门禁全绿
- [ ] ⚠️ **交还用户**：授权第一个管理员（需要用户指定账号邮箱）
- [x] ⚠️→✅ `pnpm check` 的 e2e 段 2 红 —— **收尾轮已修**（判据换成按视图锚点 + 三条变异验证），见下面「收尾轮」

## 交还用户的两件事

1. **授权第一个管理员**（后台现在是"锁着"的，这是设计）：
   ```bash
   ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js list'
   ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js grant <你的邮箱>'
   ```
   那个人必须**已经注册过**。⚠️ 服务器上**不要**用 `pnpm admin:grant`（镜像里是编译产物，
   生产装依赖带 `--omit=dev`，没有 `ts-node`）。
2. **ICP 备案的「提交审核」**：仍然只差用户本人那一下（三个同意项 + 视频核身），
   域名现在真的通了 —— 见 `docs/runbooks/icp-app-filing.md` §一。

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
