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
