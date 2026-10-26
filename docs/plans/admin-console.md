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
2. 解锁 / 改配额 / 强制登这**三个支持动作没有审计表**，记录方式是 `Logger`。
   （后台另外那三条发放动作**有**表 —— `subscription_grants` 逐笔落理由与操作者，
   ADR-0076 §2 二；两类不是一回事，别照着这句去查发放记录。）
   要给支持动作做合规级审计（谁在什么时候改了谁），需要一张 `admin_audit_log` ——
   那时**新发一个 ADR**，不要悄悄加一张表。
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
同报 `errno -9, syscall 'spawn'`。单次成功**不能**当恢复判据；
有效做法是失败就转去做读写文件的活，**不要循环重试**。

🔴 **本轮（同日更晚）把"按句柄分布"这条也推翻了。** 直接从宿主日志取窗口
（`~/.qoder-cn/logs`，`grep -rIh EBADF`）：`20:03:06 → 20:10:01` 这段里
**四条互不相干的 spawn 调用点同时**报同一个错 —— `[ShellExecService] execute failed`
（而且是**另一条会话、另一个项目**的命令，`cwd=/tmp/originx-verify`）、
`Error during GrepLogic execution`、以及插件的
`Hook execution failed for event 'UserPromptSubmit' (qoder-context)`；
栈顶统一落在 `@qoder-ai/qoder-cn-agent-sdk/dist/_worker/qoder-worker-runtime.obf.mjs` 里的
`ChildProcess.spawn`。所以坏的是**宿主进程的一段时间窗**，不是谁的句柄 ——
"派给一个新 subagent 就能拿到可用句柄"随之失效（本轮一个 subagent 连 `git diff` 都没发出去）。
另外三条并发只读 Bash 探针**全部成功且时间戳依次错开** ⇒ 宿主自己就把 Bash 串行了，
"并发 spawning 调用是触发形状"作为原因**同样不成立**。

**真修（有数字）**：本机装的是 **0.2.3**，
`https://static.qoder.com.cn/qoder-app/releases/latest-mac.yml` 上是 **0.4.3**（2026-09-26），
且 0.4.3 的包**已经下载暂存**在 `~/Library/Caches/qoder-cn-updater/pending/Qoder-CN-mac-arm64.zip`，
本地 sha512 转 base64 后与 feed **逐字相同**（⚠️ 两者编码不同，直接字符串比会误判不一致）。
✅ **已验证**：版本差、pending 包存在、哈希与 0.4.3 一致。
✅ **退出即自动安装**（本轮已从产品包里取证，不是靠默认值猜）：
`app.asar` 里 `this.autoInstallOnAppQuit = true;` 就是实际取值，配套
`addQuitHandler()` 在 `autoInstallOnAppQuit` 为真时注册 before-quit 安装；
五种覆盖写法（`= false` / `=false` / `: false` / `: !1` / `= !1`）**各 0 命中**。
缓存根目录的 `update.zip` 与 `pending/` 里的包同为 **251,645,198 B**，
与 feed 里 0.4.3 的 `size` 一致（两处都是 15:10 落的盘）。
⇒ **完全退出 Qoder CN.app 再重开 = 装上 0.4.3**；界面里的"重启以更新"是同一条路的显式版本。
🟡 剩下唯一没证的：**装上之后 EBADF 是否真的不再成窗出现** —— 那要重开之后才观测得到。

⚠️ **一条差点成立的假证据**：`grep -arl "Update will not be installed on quit" ~/.qoder-cn/logs`
命中了两个日志文件，看着像 updater 写过这条日志 —— 其实那是**本轮我自己把这句话敲进命令、
被会话日志原样记下来的回音**（文件名里就是当前 session/宿主 pid `p60129`）。
在" agent 自己的日志"里 grep 自己刚输入的字符串，永远会命中。
⚠️ 无论哪条路，重启都会杀掉同机所有在跑的会话（取证当时另有会话在跑 `pnpm reinstall:all`、
`pnpm verify:web-auth`、`playwright … auth-journey`，其中一条的父进程就是宿主 pid）——
**时机由产品负责人挑，agent 不自行重启宿主。**

### 7.6 别重走的死路

1. 不要为了让 e2e 变绿而把「徽标消失」改成"本地乐观补丁也能过"的断言 —— 它成立
   恰恰因为假服务端的列表跟着 `fake.locked` 变。
2. 邀请码的判据必须落在 `admin-codes` 这个列表上（`referrals` 行里也带着同一个 `code`）。
3. 改完 `packages/i18n` 必须 `pnpm --filter @heyta/i18n build`（AGENTS §7 第 79 条）。
4. 别把 `store.ts` 里 `loadUsers` 的 `offset`/`query` 省成默认值 —— 那会把用户翻页翻回第一页。
5. 遇到 e2e 随机红，**先查 trace 里有没有 `[vite] hot updated`**（§7.4），再怀疑产品代码。

---

## 8. 追加（2026-10-24）：一个能敲的地址、营收看板、运营公告

产品负责人这一轮的原始问题有三个：后台做好了没、能不能像 SSOS 那样有一个后台、
以及**能不能用域名访问到**。前两个的答复是"已经做好了"（§1–§7 那一轮），
第三个是真缺口：`/admin` 当时**测得 404**，后台只存在于设置浮层里的一格里 ——
运营者必须先登录、再开设置、再滚到最底下，才看得到自己那面板。

取向定了两条（2026-10-24 拍板）：**独立后台壳 + `/admin` 地址**，功能范围**加营收看板与运营公告**。

### 8.1 入口：一个地址，不是第二个应用

- `apps/web/src/features/admin/route.ts` 是**唯一**那枚路径判定，`App.tsx` 在
  所有 hook 跑完之后整棵换成 `<AdminConsolePage />`。
  🔴 判定是**整段相等**（`/admin`、`/app/admin`，容忍尾斜杠），**不是** `endsWith`：
  后者会让自托管者自己的 `…/team/admin` 之类路径被后台壳劫走。
- nginx 那一条 `location = /admin { alias /var/www/heyta-app/index.html; }`
  **不是访问控制**，它只是"这个地址有人接"。真的那道闸是服务端插件里的 `requireAdmin`。
  资源仍走 `location /app/assets/`，所以**不需要第二份产物**、不需要新子域名、不动证书。
- 侧栏那一份清单在 `features/admin/nav.ts`，设置页的 tab 条与 `/admin` 的侧栏
  **共用它**。加一格只改一处；漏改的表现是"后台里有一格点不到"，
  判据是 `admin-panel.spec.tsx` 里那份逐格点名的清单。

### 8.2 营收看板：净收入是**读**来的，不是界面减出来的

`GET /api/admin/revenue?days=&offsetMinutes=`（`server/src/admin/admin.routes.ts`）。
三条立场，每条都带一把会红的尺：

| 立场 | 为什么不能反着做 | 判据 |
|---|---|---|
| 逐日分桶按**运营者所在时区**裁（`offsetMinutes`） | 用 UTC 裁 ⇒ 北京时间早上 8 点前的进账落到**昨天** | `server/tests/admin-revenue.spec.ts` 那对"同一笔钱两种偏移落在两个桶 / 一个桶"的对照臂 |
| 币种**只分开、不相加** | 混币求和是一个没有意义的数，而它会出现在"今日营收"那一格 | 同上，逐币种分组 |
| `totalNetMinor` 由服务端算 | 界面自己 `paid − refunded` 就是第二套标准（哪些退款算数是业务判定） | `admin-revenue.spec.tsx` 用 `1200 − 500 ≠ 400` 的响应体钉住；e2e 同一形状再钉一次 |

### 8.3 运营公告：一条内容通道，不是一种通知

决策在 [`ADR-0075`](../adr/0075-announcements-are-a-content-channel.md)。
要点只复述三句，其余以那份为准：

- 🔴 **"有效"只有服务端那一次查询是裁决者**。后台列表那一格显示的
  `pending / active / expired` 是服务端算好发回来的（连同它算的时候那一枚 `now`），
  界面**不许**再拿 `Date.now()` 比 `publishedAt` / `expiresAt`。
  两处都判的症状不是"数字不对"，是**「运营以为已经下架了，用户还看得见」**。
- 忽略记在**这台设备**上。服务端记"谁读过哪条公告"= 新增一次账号级个人信息处理，
  换来的只是少点一次关闭，与本地优先 + 端到端加密这个前提方向相反。
- 标题与正文是**运营写的自由文本**（数据），`level` 才是闭词表（`info` / `warning`）。
  所以文案门禁不套它，但那一格顶部常驻一句**明文下发**的警告，
  且它**不随列表为空而消失**（`admin-announcements.spec.tsx` 钉的就是这一条）。

### 8.4 真浏览器查出来、jsdom 查不出的两条缺陷

两条同一族：**挂载那一次就去拉，而那一刻闸门还没开**。

1. `/admin` 在全新浏览器里停在「连不上服务器，请检查网络后重试」，
   真话是"你还没同意联网"。修：这一页也挂 `PrivacyConsentSheet`，
   内容区由 `useNetworkAllowed()` 决定挂不挂。
2. 应用顶部那一横条公告**永远不会出现** —— 同意之前那一发被
   `installConsentGatedFetch()` 挡下，失败被读成"没有公告"（那是对的处理），
   而答完同意之后**没人再拉一次**。修：`AnnouncementBanner` 的 effect 由
   `networkAllowed` + `baseUrl` + `token` 驱动，判定本身仍在闸门与服务端里。

🔴 第 2 条值得留在台账里，因为它给的是一个**通用的错法形状**：
"读不到就不画"这一侧的宽容，会让"什么时候问一次"这个生命周期错误**静默**。
jsdom 那一套里同意早已答好、凭据是 `setState` 直接塞的，所以它测得一片绿。
以后加任何"顶部一条外部内容"的读面，先问这一句：**闸门开之前拉的那一次，之后还有人补拉吗？**

### 8.5 这一轮的落点与现量命令

- 判据：`apps/web/tests/admin-console-route.spec.tsx`、`admin-revenue.spec.tsx`、
  `admin-announcements.spec.tsx`、`announcement-banner.spec.tsx`、
  `server/tests/admin-revenue.spec.ts`、`announcements-admin-routes.spec.ts`、
  `packages/app-host/tests/announcement-client.spec.ts`；
  真浏览器：`e2e/tests/admin-console-route.spec.ts`、`e2e/tests/announcement-banner.spec.ts`，
  图在 `apps/web/evidence/admin-console/`。条数自己数，别抄这里：
  `ls apps/web/tests/admin-*.spec.tsx apps/web/tests/announcement-*.spec.tsx | wc -l`。
- 迁移：`server/prisma/migrations/20261024000000_add_announcements/`。
  🔴 只走 `cd server && sh scripts/migrate-deploy.sh`。
  这一张表**故意没有外键**（`created_by` 指向 `users`，但删号不许连带删掉公告历史，
  也不许因为约束挡住回收流程），理由写在迁移头部。
- 上线顺序（**不能倒**）：先跑迁移 ⇒ 再部署服务端并重启 ⇒ 再 `pnpm --filter @heyta/web build`
  + `rsync` 产物 ⇒ 最后动边缘那一条 location。
  先动边缘的话，`/admin` 会把**旧产物**交出去，那一屏上没有后台壳，
  读起来像"这个地址坏了"。
  ⚠️ 这一条当时写的是"最后 `server/scripts/nginx-sync.sh --apply`"——**那句对本域名是错的**
  （边缘是 caddy-edge，那份 nginx 文件没人读），2026-10-25 上线时踩到，改法与读数在 §9.3/§9.4。

---

## 9. 追加（2026-10-25）：后台的三种订阅发放

裁决在 [ADR-0076](../adr/0076-admin-subscription-grants.md)。这一节只写**落地清单与读数**，
不复述理由。

### 9.1 交付清单

| # | 件 | 落点 |
|---|---|---|
| 1 | `subscription_grants` 表 + 迁移 | `server/prisma/schema.prisma`、`server/prisma/migrations/20261025000000_add_subscription_grants/` |
| 2 | 发放存储层（三动作 + 审计同事务） | `server/src/admin/subscription-grant-store.ts` |
| 3 | 五条路由 | `server/src/admin/admin.routes.ts`：`GET /skus`、`GET /subscriptions/grants`、`POST /subscriptions/{grant,upgrade,revoke}` |
| 4 | app-host 客户端 | `packages/app-host/src/admin-client.ts` |
| 5 | 后台「发放」tab + store 动作 | `apps/web/src/features/admin/{AdminPanel,store}.ts`、`apps/web/src/styles/app/admin.css` |
| 6 | 中英词条 | `packages/i18n/src/locales/{en-US,zh-CN}.ts` |

### 9.2 判据（每条都要能红，写完做变异验证）

| 判据 | 钉住的东西 | 变异（改坏哪一行 ⇒ 必须红） |
|---|---|---|
| 发放用的那个事务客户端**只暴露三枚 model**（`subscription` / `subscriptionGrant` / `user`） | ADR-0076 §4.2「发放不进营收」——营收只读 `checkout_orders`，所以"发一条订单"在代码里**写不出来**，不是"记得别写" | 往 `GrantTx` 上加第四枚 model |
| 付费行的 5 个字段在"发放→收回"全程不变 | §2 二"只写 `admin-grant` 行" | 让 revoke 把 `where` 放宽到全部 provider |
| 未知 SKU ⇒ 400 且**无审计行、无订阅行** | §2 三第 1 道闸门 | 把 `grantsForSku(...) === null` 折成 `?? []` |
| `notSellableReason` 非 null ⇒ 拒绝发放 | §1.3.4（收银台挡住的东西后台也挡） | 删掉那次 `notSellableReason` 调用 |
| `days` 越界/NaN/小数 ⇒ 400 | §2 三第 3 道闸门 | 把 `max` 去掉 |
| 请求体多一个 `grants` 键 ⇒ 400 | §3.3（客户端发不出能力） | 把 `strictObject` 换成 `object` |
| 审计行与订阅行在同一事务里 | §2 四末尾 | 把审计写挪到事务外、写在 await 之后 |
| `upgrade` 不改 `currentPeriodEnd`；`grant` 不改别人的行 | §2 一那张表的"语义"列 | 让 upgrade 也调 `extendSubscriptionPeriod` |
| 收回没有发放行 ⇒ 404，不折成 ok | 界面不许谎称成功 | 把 `count === 0` 那一路折进成功分支 |

### 9.3 上线顺序

迁移 ⇒ 服务端镜像重建换容器 ⇒ web 产物 build + rsync ⇒ **边缘那一条 location**。
默认走 `node scripts/deploy-ssh.mjs`（沙箱是默认，真发生产要 `--apply --yes-production`），
它把"送源码 / 建镜像 / 空库跑迁移 / 打 `/health` / 换容器"串成一条带 sha256 对账的链。

🔴 **最后那一步不是 `server/scripts/nginx-sync.sh --apply`** —— 本域名 2026-10-24 起由
`caddy-edge` 服务（`ssh finlaw 'ss -ltnp | grep :443'` 现量），`nginx.service` 是 masked，
`/etc/nginx/sites-available/*` 与仓库里那份 `server/deploy/nginx/heyta.waytofuture.cn.conf`
**都是死配置**。那一课 ADR-0054 §落地动作 3 记过一次，本轮又踩了一遍 ——
差别是这次**计划里写着它**，所以那句话已按上面的形状改掉。
线上真正在跑的站点片段：`/etc/caddy/sites.d/00-heyta.caddy`（改法见 §9.4）。

⚠️ 仓库里**没有**那份 caddy 片段的副本，也没有对应的 `--check/--pull/--apply`。
于是"线上有哪些 location"这件事对 caddy 又变回不可 diff 的了 ——
这正是 `nginx-sync.sh` 文件头写的那条理由。补这一格的动作记在 §9.4「还欠的」。

### 9.4 上线（2026-10-25，一次做完的读数）

| 步 | 读数 |
|---|---|
| 沙箱 | 镜像可建；OCI revision 标签 == 送出去的 commit；**含 `20261025000000_add_subscription_grants` 的整条迁移链在空库跑通**；`/health=200`；只删自己创建的三枚对象 |
| 生产 | `ROLLBACK_TAG=supersync:rollback-20261025T043018` → `MIGRATE_RC=0` → `SWAPPED` → `HEALTH=200` |
| 产物 | `HEYTA_WEB_BASE=/app/` 构建 → `check:web-artifact:app` 绿 → rsync 前后各 9 个 asset 同名；发布前远端整目录备份在 `~/heyta-app.bak-20261025-admin` |
| 边缘 | `/admin` 200 + `cache-control: no-cache` + 与 `/app/` **逐字节同一份 HTML**；`/admin/` 301 → `/admin`；`/app/`、`/`、`/health` 无回归，未知路径仍真 404 |
| 判据 | `e2e/live-site/live-admin-entry.spec.ts` 两条（这一格地址本身）+ `live-manifest` 三条，全绿；条数自己数：`ls e2e/live-site/live-*.spec.ts \| wc -l` |

**三个动作在真线上各点了一遍**（一次性管理员账号，做完即删）：
图证在 `apps/web/evidence/admin-console/live-admin-grants-{before,after,revoked}.png`
与 `live-admin-revenue.png`（这四张打的是**公网域名 + 真库**，与
`admin-route-grants-*.png` 那两张假端点的本机图不是一回事）。
`grant 30 天` 的周期差 == 2,592,000,000 ms（恰好 30 天）；`upgrade` 的
`currentPeriodEnd` **逐字不变**（"一天都不加"在真库上成立）；`revoke` 把那一行折到 `now`。
发放记录五条，倒序，每条带理由与操作者；`checkout_orders` 全程 **0 行**，
营收那一格显示的是共享空态"这个窗口里没有进账，也没有退款" ——
ADR-0076 §4.2「发放不进营收」这条立场第一次有了线上读数（此前只有那条
"事务里只有三枚 model，`tx.checkoutOrder` 写不出来"的结构性判据）。

收尾读数（现量命令：`ssh finlaw 'sudo -n docker exec supersync-postgres sh -c '"'"'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from users), (select count(*) from users where is_admin), (select count(*) from subscriptions where provider=$$admin-grant$$), (select count(*) from subscription_grants)"'"'"''`）：
用户回到 11、管理员 0、`admin-grant` 订阅行 0、**发放审计行留 5 条**。
最后那一格是**故意的**：`subscription_grants` 按设计没有外键（ADR-0076 §2 二），
删号不许连带抹掉"谁在什么时候为什么发过什么"。

**顺手修掉的一条线上缺陷（不在本轮范围里，但它是红的）**：
`/app/manifest.webmanifest` 的 `content-type` 是 `text/plain` —— `.webmanifest` 不在
Caddy 内置 mime 表里，而 nginx 时代靠 `/etc/nginx/mime.types` 那一条。
**2026-10-24 迁到 caddy 那天起就红**，只是没人再跑线上验收；本轮 `live-manifest` 两条判红抓到的。
修法：站点片段里 `@appManifest` + `header Content-Type "application/manifest+json; charset=utf-8"`，
必须排在 `handle /app*` **之前**（Caddy 的 handle 是顺序首个命中胜）。
⚠️ 校验这枚文件必须用 **`/usr/local/bin/caddy-edge validate`**，不是 PATH 上那枚 `caddy`：
后者没编进 `rate_limit` 模块，会在**别人那片** `21-originxspace.caddy` 上报
`unrecognized directive: rate_limit` 而假红（本轮实测：假红那一次自动回滚了，真镜像没动）。

**还欠的（登记，不在本轮做）**：
- ✅ ~~仓库里没有 `/etc/caddy/sites.d/*.caddy` 的副本与 `--check/--pull/--apply` 那三档~~
  —— 2026-10-25 当天补上：镜像在 `server/deploy/caddy/sites.d/`（heyta 那三片，逐字节），
  三档在 `server/scripts/caddy-sync.sh`。四臂现量：`--check` 对线上 3 片一致退出 0；
  故意改一片 ⇒ 退出 1 并点名；远端目录打错 ⇒ **拒绝**"无漂移"（空清单不判绿）；
  `--apply` 打到沙箱目录 + 假服务名 ⇒ 校验过、reload 失败 ⇒ 退出 1 并印回滚命令。
  校验用的是 `caddy-edge` 那枚二进制，理由写在 `server/deploy/caddy/README.md`。
- ✅ ~~未登录打开 `/admin` 时那句"没有配置服务器地址"其实是"没会话"~~ —— 当天就修了：
  `adminRequest` 原来先判 `baseUrl` 再判令牌，而未登录时 `baseUrl` **必然**也是空
  （官方构建的地址是账号态填进来的），于是两格都为空时先判的那个赢了。
  现在先判令牌（`packages/app-host/src/admin-client.ts` 那一处，注释写着为什么反过来不成立：
  有会话而地址为空是自托管真配错，那时 `unconfigured` 才对）。
  三处判据：传输层那条（两格都空 ⇒ `no-token`，变异验证 = 把顺序挪回去只杀它一条）、
  界面层那条（未登录那一屏不许出现"服务器地址"四个字）、
  线上那条（`live-admin-entry.spec.ts` 按 `not.toMatch(/服务器地址|server address/iu)` 判，
  不钉中文字面 —— 这一页跟着界面语言走）。
  修完的线上那一屏：`apps/web/evidence/admin-console/live-admin-logged-out.png`
  （现量文案 "You are not signed in, so the admin console is unavailable."，
  修前同一格是 "No server address is configured, …"）。
- ✅ ~~后台的运营账号今天**是 0 个**（取证那枚已删）~~ —— 2026-10-26 负责人给出运营邮箱，
  已授予：`admin.js grant` 退出 0，`admin.js list` 现量「共 1 位管理员：#23 `al***@163.com`
  已验证=是」。开号前那一步是**先确认这个账号已经在册**（那条 CLI 拒给不存在的邮箱）：
  `users` 里 11 行、`#23` 那条 `is_verified=1` 且有口令，所以登录进得来。
  要再开一个：`pnpm --filter @heyta/server admin:grant <你的邮箱>`（线上在容器里跑
  `docker exec -w /app supersync-server node dist/scripts/admin.js grant <邮箱>`）。

---

## 9.5 追加（2026-10-26）：产品意义上还欠的四格，一次做完

上一节把"能不能用"收口了，这一节收的是"运营一个人用得住不住"。四格都来自
2026-10-25 那次「管理后台从产品意义上完成了吗」的读数表，逐格都有能红的判据。

| 格 | 之前的形状 | 现在 | 判据落在哪 |
|---|---|---|---|
| 目标账号要手抄 | 搜到人 → 抄 `#id` → 切格子 → 粘进去 | 详情动作区第一枚「给他发一份」：带着编号落到发放格 | `admin-grants.spec.tsx`（搬过去**只有**「是谁」）+ `admin-console.spec.ts` 真浏览器那一趟 |
| 发放记录只有第一页 50 条 | `fetchAdminSubscriptionGrants({limit})`，无 Pager | 接上 `<Pager>`，页坐标用**服务端回显**的 `total` / `offset` | `admin-grants.spec.tsx`「翻页」四条（A4/A6 两臂实测红） |
| 看不见"这个人此刻能用什么" | 详情注释明写"不碰钱也不碰权益"，只给逐行 | 详情新增并集读数三行（✓/✕ + 来源 + 到期 / 拒绝码那句） | `server/tests/admin-entitlements.spec.ts` 判定本体 + `admin-entitlements.spec.tsx` 界面只念不判 |
| 升档的前置不在第一屏 | 只有撞了 409 才知道要先赠送 | lead 下面单独一句 `grant.precondition` | `admin-grants.spec.tsx`「第一屏就读得到的前置」（并判 lead 里**没有**这句 —— 两格各说一件事） |

### 并集读数这一格的立场（下一轮别改坏）

- 🔴 **判定不在界面**。`admin.routes.ts::projectEntitlements` 调的就是守卫那批函数
  （`evaluateCapabilityAcross` / `evaluateAutomationEntitlementForUser` / `evaluateCapability`）。
  界面自己数一遍行 = 第二套标准，漂移的表现是运营说"他还有"而闸门说"他没有"。
  这条不是措辞：A3 臂把界面上的勾改成 `sources.length > 0`，两条判据当场红。
- 🔴 **`automation` 的"来源"跟着部署模式走**。未配模式 / `selfhost-online` 时守卫不看订阅行，
  所以那一格的 `sources` 必须是空 —— 把没被看的行念成来源，就是一句守卫没说过的话（A2 臂）。
  界面侧对应一条：`allowed: true` 而来源为空 ⇒ 念"不来自本机订阅行"。
- ⚠️ 线上那台的读数现在是 **自动化 ✕（这台实例没配自动收集的权益来源）**：
  容器里没有 `AUTOMATION_ENTITLEMENT_MODE`（现量：
  `ssh finlaw 'sudo -n docker exec supersync-server sh -c "env | cut -d= -f1 | sort"' | grep -ci AUTOMATION` ⇒ `0`）。
  这不是本轮的缺陷也不是本轮的裁决 —— 自动收集那条线自己写着"公网接收与售卖继续关闭"，
  而三条候选修法登记在 `docs/plans/inbound-automation.md` 的 **B109**。
  本轮做的只是**让它看得见**：价目表里 `hosted-ai-monthly` 的 grants 含 `automation`，
  而 `NOT_YET_DELIVERABLE_SKUS` 是空的，"卖得出去、这台发不了"这一对必须有人在屏幕上看得见。

### 现量命令

```bash
# 判定本体 + 界面只念不判 + 翻页/搬运/前置
cd server && npx vitest run tests/admin-entitlements.spec.ts tests/admin-routes.spec.ts
cd apps/web && npx vitest run tests/admin-entitlements.spec.tsx tests/admin-grants.spec.tsx tests/admin-panel.spec.tsx
# 真浏览器那一趟（端口挪开：4318/4319 会被兄弟检出占着）
cd e2e && HEYTA_E2E_APP_PORT=4418 HEYTA_E2E_STUB_PORT=4419 npx playwright test tests/admin-console.spec.ts
```

变异六臂（锚点唯一性由脚本自己判，不唯一就响亮失败；还原只从 `.mut-bak`）：
`A1` 挑最新一行 ⇒ 2 红 / `A2` 来源不看模式 ⇒ 2 红 / `A3` 界面自己判 ⇒ 2 红 /
`A4` 翻页写死第一页 ⇒ 2 红 / `A5` 搬运不带编号 ⇒ 1 红 / `A6` 总数按本页行数算 ⇒ 3 红。

