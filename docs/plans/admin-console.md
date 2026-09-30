# 运营管理后台：只做 heyta 真实有的运营面

> 状态：**已完成**（首版，2026-09-30）
> 决策：[ADR-0038](../adr/0038-admin-console-scope.md)（**为什么复用 SSOS 的模式、为什么不照搬它的页面、为什么不做 RBAC**）
> 起因：产品负责人问「我这个项目是不是需要一个管理后台？SSOS 那个是不是可以直接照抄？」

---

## 0. 一句话

**抄模式，不抄页面。** SSOS 的后台是 42 个页面 / ~12.5k 行前端 + 35 个 Hono 路由 / ~8k 行后端，
覆盖租户、税务规则、合规知识库、Mailu 邮件中心 —— 这些领域在 heyta **没有对应数据模型**。
真正可复用的是它的**骨架**（受保护子树、一次 Guard、每资源一个数据钩子、统一分页、
服务端是唯一裁决者），而 heyta 能管的只有：用户、订阅、订单、优惠码、邀请、通知、设备、配额。

---

## 1. 交付清单

| 层 | 文件 | 说明 |
|---|---|---|
| 决策 | `docs/adr/0038-admin-console-scope.md` | 范围、权限模型、明确不做的事 |
| 迁移 | `server/prisma/migrations/20261003000000_add_admin_flag/migration.sql` | `users.is_admin BOOLEAN NOT NULL DEFAULT false` |
| 授权核心 | `server/src/admin/admins.ts` | 授予 / 撤销 / 列表，**拒绝撤销最后一个管理员** |
| CLI | `server/scripts/admin.ts` + `package.json` 的 `admin:grant` / `admin:revoke` / `admin:list` | 唯一的授权入口（没有自助入口） |
| 鉴权 | `server/src/admin/admin.middleware.ts` | `requireAdmin`：认证 + 判权**同一个 hook**（顺序不可能排错） |
| 接口 | `server/src/admin/admin.routes.ts` | `/api/admin/*`：概览、用户、订阅、订单、优惠码、邀请 + 三个支持动作 |
| 注册 | `server/src/server.ts` | `register(adminRoutes, { prefix: '/api/admin' })` |
| 客户端 | `packages/app-host/src/admin-client.ts` | 宿主无关的传输层（AGENTS §3.5） |
| 状态 | `apps/web/src/features/admin/store.ts` | 探测 + 按标签页按需拉取 |
| 界面 | `apps/web/src/features/admin/AdminPanel.tsx` + `apps/web/src/styles/app.css` 的 `.ht-admin__*` | 挂在设置页里 |

---

## 2. 范围：首版只读 + 三个不碰钱的动作

**读**：概览统计、用户（列表/详情）、订阅、订单、优惠码、邀请/推荐、同步设备。

**写**（只有三个，都不涉及钱，都可逆）：

| 动作 | 为什么它在首版 | 正确性要点 |
|---|---|---|
| 解锁账号 | 最高频的支持诉求 | 必须**同时**清 `lockedUntil` 与 `failedLoginAttempts` —— 只清前者的话用户再输错一次就立刻又被锁上 |
| 调整存储配额 | 用户撞到配额时唯一能救的动作 | 下限 1 MiB：设成 0 会制造一个用户看不懂的"神秘同步失败" |
| 强制登出 | 账号被盗时唯一能在服务端立刻止血的动作 | 走 `tokenVersion++`（JWT 无状态）。⚠️ **不撤销 passkey** —— 那是设备本地的 |

**明确不做**：改订阅、退款、发券、群发通知。

- 前三个动到钱与权益，各自需要幂等键、审计记录、失败回滚，以及与 `billing/apply-event` 现有路径的协调。
- 群发自由文本会**同时**破坏两条既有立场：通知的 `kind` 是封闭词表
  （`packages/domain/src/activity.ts` 的 `NOTIFICATION_KINDS`），且服务端只存
  **语义 + 参数**、不存渲染好的文案（`server/src/activity/notifications.ts` 文件头）。
  真要做营销触达，那是另一条线。

---

## 3. 权限模型：单级 `is_admin`

```
users.is_admin BOOLEAN NOT NULL DEFAULT false
```

- **没有人生来是管理员** ⇒ 一个忘了配置的环境退化成"没有后台"，而不是"人人都是后台"。
- 授权只能由 CLI（在服务器上）或已有管理员显式做。**没有任何自助入口。**
- **不做 RBAC**。成本不在第一张表，在它带来的全部配套（角色管理界面、权限码词表、
  "谁能改角色"这个自指问题的答案、每加一个端点都想一遍挂哪个权限码），
  而它现在的收益是 0 —— 只有一个运营者。
- ⚠️ **升级触发条件**：出现**第二个需要后台、但不应看到全部数据的人**时，
  就该把 ADR-0038 换掉。`is_admin` → RBAC 是一次加法，不是重写。

### 怎么授权第一个管理员

```bash
# 那个人必须**已经注册过**（管理员是账号上的一列，不是一张独立的表）
pnpm --filter @heyta/server admin:grant someone@example.com
pnpm --filter @heyta/server admin:list
pnpm --filter @heyta/server admin:revoke someone@example.com   # 拒绝撤销最后一个
```

⚠️ **拒绝撤销最后一个管理员不是洁癖**：撤销错了不会报错，它只是让后台对所有人关闭，
而恢复需要直连数据库改一行。所以那条判定必须在**写之前**。

---

## 4. 判据（全部为自动化测试，且各自做过变异验证）

| 判据 | 位置 | 变异验证（拿掉实现 ⇒ 该条转红） |
|---|---|---|
| 存量用户**不许**变成管理员 | `server/tests/admin-migration.pglite.spec.ts`（PGlite，跑**发布中的迁移 SQL**） | 把 `DEFAULT false` 改成 `DEFAULT true` ⇒ 2 条转红 |
| 拒绝撤销最后一个管理员 | `server/tests/admin-admins.spec.ts` | 拿掉 `countAdmins() <= 1` 判定 ⇒ 1 条转红 |
| **每条** admin 路由都要 401/403 | `server/tests/admin-routes.spec.ts`（遍历全部 10 条路由） | — |
| 响应是白名单投影（无 `passwordHash` / token） | 同上 | 把投影改成 `...row` 摊平 ⇒ 转红 |
| 未登录 / 未配服务器**不发请求** | `packages/app-host/tests/admin-client.spec.ts` | 拿掉取令牌的空值短路 ⇒ 2 条转红 |
| 非管理员界面**什么都不渲染** | `apps/web/tests/admin-panel.spec.tsx` | — |
| **真浏览器**：六个 Tab 各自按需拉取、动作读回服务端值、403/未登录不渲染 | `e2e/tests/admin-console.spec.ts`（5 条 + 10 张截图，经 `check:ai-e2e` 进 `pnpm check`） | 拿掉 `store.unlockUser` 里那句 `openUser` ⇒ 界面仍显示「已完成。」而 `失败登录` 停在 5 ⇒ 该条转红 |

> 📌 一条教训（已写进测试注释）："未登录不发请求"这条规则**住在 `admin-client` 里**，
> 不在 web store 里。我一开始把断言记在 store 的一段提前 `return` 上，
> 结果**把那整段删掉测试依然全绿** —— 因为真正的闸在客户端。
> 判据钉错层的症状是"看起来在保护一件事，其实保护的是另一件"。
> 所以现在 web 那层只保留端到端确认，规则的单点判据在 admin-client。

---

## 5. 已知边界（不是缺陷）

1. `is_admin` 是账号级的**全有全无**。见 §3 的升级触发条件。
2. 三个写动作**没有审计表**，记录方式是 `Logger`。要做合规级审计
   （谁在什么时候改了谁），需要一张 `admin_audit_log` —— 那时**新发一个 ADR**，
   不要悄悄加一张表。
3. 后台代码进了主应用 bundle。首版靠"入口只对已授权用户渲染"隔离，
   但**前端从来不是保密手段** —— 保密由服务端 `requireAdmin` 承担。
4. 计数与列表是**即时查询**，没有缓存。用户量到十万级时要重新看这一块
   （现在的实现没有任何分页以外的优化，也没打算有）。

---

## 6. 真浏览器契约查出来的两条缺陷（✅ 已修，2026-09-30）

这两条 jsdom 那套全绿时就一直存在，是补 §4 最后一行那张契约**当场**照出来的。
修完各留下一条回归判据（e2e 与 jsdom 各一处），不是"改完就宣布完事"。

1. **邀请页不渲染邀请码。** `/api/admin/invites` 一个响应带两面（`codes` + `referrals`），
   `tab === 'invites'` 分支原来只渲染后者 —— 运营者看得见谁被邀请了，
   看不见码本身、它属于谁、有没有被停用。
   现在两面都渲染（`admin-codes` / `admin-referrals`，各带小节标题）；
   服务端用**同一个 `?offset=`** 裁两边 ⇒ 分页器仍然只有一个。
   判据必须落在 `admin-codes` 这个列表上：referrals 行里也带着同一个 `code`，
   只断言"面板里出现了 `ABCD2345`"会钉不住。
2. **解锁之后列表还在说"已锁定"。** 三个动作原来只重拉**详情**，
   用户列表那一行的徽标不跟着变；而"点两下不重拉"是**有意的**设计（§1「按标签页按需拉取」）
   ⇒ 界面留下一条已经不成立的事实，而且没有任何动作能把它刷掉。
   修法是一个共享的 `reloadAfterUserAction(id)`：详情 **和**当前页的列表都重新读回来，
   带着原 `offset` 与搜索词 —— 重置成第一页会让运营者刚定位到的那一屏凭空跳走。
   🔴 刻意**不**采用"本地把徽标抹掉"的乐观补丁：服务端是唯一裁决者（ADR-0038），
   没读回来的状态不该出现在界面上 —— 那与它要修的缺陷是同一类问题。

两条的判据都做过变异验证。第 2 条的证法是**让假服务端自己变**
（`usersPageBody(fake)` 的 `locked` 跟着 `fake.locked`）：拿掉 `loadUsers` 那一句 ⇒
徽标仍在 ⇒ 恰好 1 红。如果假服务端不变，一个只改本地副本的实现也能让断言通过
（AGENTS §7 元规则 2）。

---

## 7. 收尾（2026-09-30）：验证结果、提交范围，与两条环境真相

> 判据与设计理由在 §4 与 §6；这一节只回答"跑到哪儿了、结论是什么"。

### 7.1 提交范围：8 个路径，其中 3 个是**共享文件**

```
apps/web/src/features/admin/AdminPanel.tsx        邀请页渲染两面
apps/web/src/features/admin/store.ts              reloadAfterUserAction
apps/web/tests/admin-panel.spec.tsx               +2 条回归判据（共 10 条）
packages/i18n/src/locales/zh-CN.ts                ⚠️ 共享：只入 1 个 hunk
packages/i18n/src/locales/en.ts                   ⚠️ 共享：只入 1 个 hunk
e2e/tests/admin-console.spec.ts                   新增文件（未跟踪）
docs/plans/admin-console.md                       本节
PROGRESS.md                                       ⚠️ 共享：只入 2 个 hunk
```

🔴 **两个词条文件里绝大部分不是本轮的**：`landing.selfhost.*` 整段重写、
`landing.footer.licenseNote`、约 120 条 `site.docs.*`（其注释直接指向未跟踪的
`apps/landing/tests/public-copy-register.spec.tsx`）都是另一条会话的在途活。
本轮在两边各只有 **3 条** `web.admin.*`。`PROGRESS.md` 的 `@@ -24`（`pnpm check`
那一行的状态更正，引用了未提交的 `BLOCKED.md §8`）同样不是本轮写的。
⇒ 这三个文件**不许 `git add`**，只能生成过滤补丁后 `git apply --cached` 只入自己的 hunk。
判据：`git diff --cached` 里两个 locale 文件各自只该出现 3 行 `+`。

🔴 **同一个工作树里有别的会话在飞**：`apps/web/src/features/auth/**`、
`apps/web/tests/desktop-handoff.spec.ts`、`e2e/auth-journey/**`、`e2e/tests/helpers.ts`、
`apps/landing/**`、`apps/web/evidence/email-chain/*`、`server/public/magic-login-confirm.js`。
**不要动，也不要 `git add -A`** —— 那会把别人未完成的活一起提交。

### 7.2 验证结果（同机同树）

| 命令 | 结果 |
|---|---|
| `pnpm check:ai-e2e`（**全量** e2e） | `EXIT=0`：**62 passed / 1 flaky / 2 skipped**，`admin-console.spec.ts` **5/5**（那条 flaky 见 §7.4） |
| `pnpm --filter @heyta/web test` | **1003 passed / 12 skipped**（含本轮 +2 条） |
| `pnpm --filter @heyta/i18n test` | 10/10 |
| `pnpm --filter {web,i18n,app-host,design-system} typecheck` | 全绿 |
| `pnpm check:ui-language` | 绿，词条 zh 2146 / en 2146（**新词条必须中英同步**） |
| 变异验证 | 短路 `loadUsers` ⇒ **恰好 1 红**（徽标仍在），已还原 |

截图**已打开看过**（AGENTS §6.2 规定一）：
`e2e/test-results/admin-invite-codes.png`（邀请码 + 推荐关系两面都在）、
`admin-user-unlock-list.png`（列表三行分别是「管理员」/ **无徽标** /「未验证」⇒ 已锁定确实消失）。

### 7.3 🔴 全量 `pnpm check` 拿不到绿，而且断点比上一轮登记的更早

`EXIT=1`，断在**整条链的第一道** `check:entries`：13 个生成物
（`help/{how,account,passphrase,conflict,selfhost,transfer}` + `en/` 同名 + `public/sitemap.xml`）
与站点注册表不一致 —— 那是另一条会话正在建的文档中心。`check` 是一条 `&&` 链，
于是**其后约 43 道门禁（含 `check:l4`、`check:ai-e2e`、`pnpm -r test`）一次都没执行**。

单独跑那几道红的，落点**全部在别人的在途文件里**：

| 门禁 | 红点 |
|---|---|
| `check:entries` | `apps/landing` 的 13 个生成物（他人未提交） |
| `check:l4` | 7 处样式字面量，**全在**未跟踪的 `apps/web/src/features/auth/desktop-handoff.ts:97/98/104` |
| `check:design` | 同一文件同一处裸 `z-index:2147483647` |
| `pnpm -r typecheck` | 只红在 `apps/landing`（缺 5 个新页面组件 + 一处 `import '….ts'`） |

本轮的做法是**单独跑覆盖这 8 个路径的门禁**（§7.2 那张表），而不是替别人改文件、
或跑 `gen:entries` 把链刷绿 —— 后者会改写 13 个受版本管理的 HTML，那是别人未完成的活。
⚠️ 代价要说清楚：**"全量 check 绿"这一条本轮没有证据**，下一个接手的人拿到树的时候
应该先重跑一次 `pnpm check`，而不是相信这里记的红灯都是别人的。

⚠️ **部署侧不需要动**：两条都在 web 界面/状态层，服务端零改动，线上镜像与迁移无关。

### 7.4 🔴 那条 flaky 的根因：共享工作树 + vite HMR，不是产品、也不是判据

`admin-console.spec.ts:563` 概览用例首次**失败**、重试 17s **通过**。取证（`trace.zip`）：

1. 失败瞬间的 DOM 快照与截图都显示页面停在**任务视图**，设置浮层根本不在 ——
   而 `openSettingsView` 自带的 `.ht-header__title = 设置` 断言**是通过的**。
2. 把 trace 里的动作与 console 事件按时间轴交错：那条断言通过之后立刻涌进
   **约 90 条 `[vite] hot updated`**，其中 `/src/App.tsx` 出现 **8 次**，
   还有 `/src/features/admin/AdminPanel.tsx`、`AccountMenu.tsx`、`packages/i18n/dist/*`，
   以及多条 `Could not Fast Refresh … invalidate` —— 不兼容 Fast Refresh 时 vite 会**整页 reload**。
3. reload 把 SPA 状态清回初始视图 ⇒ 浮层连同后台面板一起没了 ⇒ `admin-panel` 永不出现。

📌 **一般规律**：e2e 的 dev server 服务的是**当前工作树**，所以**任何会话往树里写文件，
都会打断在飞的 e2e**，而症状长得像"界面整块没实现"。这与"重验证串行跑"是同一件事的两个面：
光把自己那几轮排开不够，同树并发改文件就会造出假红。

### 7.5 环境：`spawn EBADF`（**更正**此前写错的诊断）

本节原来写着"`cd "带空格的路径" && …` 与 `dir_path` 两种写法都会中"，读起来像**写法**有问题。
实测把这条推翻了：与写法、路径空格、iCloud、fd/进程/线程 ulimit、磁盘与 inode 余量**都无关**，
故障在 **Qoder 宿主进程的 spawn 路径**上 —— 同一宿主下的 `Bash`/`Grep`/`Glob` 三个 spawner
同报 `errno -9, syscall 'spawn'`，且**按句柄**分布：新会话或新 subagent 拿到的是可用的新句柄
（本轮的全量 e2e 与 web 套件就是这么跑出来的）。单次成功**不能**当恢复判据；
有效做法是失败就转去做读写文件的活，或把一条批量命令交给一个新 subagent，**不要循环重试**。
彻底恢复靠重启宿主 app。

### 7.6 别重走的死路

1. 不要为了让 e2e 变绿而把「徽标消失」改成"本地乐观补丁也能过"的断言 —— 它成立
   恰恰因为假服务端的列表跟着 `fake.locked` 变。
2. 邀请码的判据必须落在 `admin-codes` 这个列表上（`referrals` 行里也带着同一个 `code`）。
3. 改完 `packages/i18n` 必须 `pnpm --filter @heyta/i18n build`（AGENTS §7 第 79 条）。
4. 别把 `store.ts` 里 `loadUsers` 的 `offset`/`query` 省成默认值 —— 那会把用户翻页翻回第一页。
5. 遇到 e2e 随机红，**先查 trace 里有没有 `[vite] hot updated`**（§7.4），再怀疑产品代码。
