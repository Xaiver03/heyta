# ADR-0038：管理后台**复用 SSOS 的模式**，但只做 heyta 真实有的运营面

> 状态：**已接受**
> 日期：2026-09-30
> 相关：[ADR-0011](0011-local-api-mcp.md)（本机 API/MCP 的授权立场）、
> [ADR-0023](0023-managed-ai-quota-not-implemented.md)（未交付能力必须挡住入口）
> 落地计划：[`../plans/admin-console.md`](../plans/admin-console.md)

---

## 1. 背景与约束

### 1.1 要做什么

heyta 需要一个**运营管理后台**：看用户、看订阅与订单、看优惠码与邀请。
起因是产品负责人的直接提问 —— "我这个项目是不是需要一个管理后台？
你可以看一下 SSOS 它们的管理后台是怎么做的？我是觉得可以直接照抄的，
因为反正都是我自己的项目。"

### 1.2 关键事实：SSOS 的后台与 heyta 的领域**不是一回事**

SSOS（同一位产品负责人的另一个项目）的管理后台实测规模：

| 项 | SSOS |
|---|---|
| 前端 | `apps/client/src/pages/admin` —— **42 个 .tsx / ~12.5k 行**，含 `ai-config/` 子目录；`components/admin/*Guard, AdminLayout`；`hooks/admin/*` 22 个文件 / ~3.2k 行 |
| 覆盖领域 | 用户、**租户**、**税务规则/税历**、**合规知识库/法规源/政策申报**、**Mailu 邮件中心**、信用点、发票（含增值税专票）、营收看板、活动、落地页 CMS、申诉、系统设置… |
| 后端 | `services/api/src/routes/admin/*` —— **35 个 Hono 路由文件 / ~8k 行**，裸 SQL + Drizzle |
| 鉴权 | 三级：`superAdminMiddleware`（JWT + `users.is_super_admin` 或 `admin_user_roles`）/ `requireSuperAdmin` / `requireAdminPermission(code)` 的**完整 RBAC**（`admin_user_roles → admin_role_permissions → admin_permissions`） |
| 技术栈 | React 18 + Vite 6 + react-router 7 + **shadcn/ui**（58 个组件）+ TanStack Query 5 + Tailwind |

heyta 侧实测：

| 项 | heyta |
|---|---|
| 后端 | Fastify **5** + Prisma 5.22 + zod（**不是** Hono/Drizzle） |
| 前端 | React **19** + **react-native-web** 0.21 + Vite 7 + lucide-react；**没有** react-router、**没有** TanStack Query、**没有** shadcn；features/ 目录布局 + 自有 `design-system` 强 token 纪律 |
| 管理面 | **零** —— `server/src` 里 "admin" 只出现在一句注释里；`User` 模型**没有**任何角色字段 |
| 可管理数据 | `User` / `Subscription` / `CheckoutOrder` / `PaymentEvent` / `Coupon` / `CouponRedemption` / `InviteCode` / `Referral` / `AccountNotification` / `SyncDevice` / `storageQuota` |

**⇒ 两边共享的只有"用户"这一个领域。** 租户、税务、合规知识库、Mailu、
发票、信用点在 heyta **没有对应数据模型**，搬过来是无处落地的空壳。

### 1.3 硬约束

1. **不能为不存在的组织模型付成本。** heyta 目前**只有一位运营者**（产品负责人本人）。
   照搬三级 RBAC 需要三张表 + 权限码词表 + 角色管理界面，服务的是一个不存在的问题。
2. **门禁不会因为"是后台"而放宽。** `pnpm check` 里 design/tokens/layering/
   ui-language 等门禁对新增 UI 同样生效；`server/` 的改动要过迁移纪律（AGENTS §4）。
3. **管理面是攻击面。** 它能读到全站用户与订单 —— 鉴权必须 fail-closed，
   且**默认没有人是管理员**。

---

## 2. 决策

**一、复用 SSOS 的"模式"，不搬它的"页面"。**

复用的是这五件（它们是 SSOS 后台真正值得学的部分）：

| 模式 | 在 heyta 的落地 |
|---|---|
| 后台是**主应用里的一个受保护子树**，不是独立 app | `apps/web` 里一个仅管理员可见的视图 |
| **Guard 在路由入口**做一次，不在每个组件里各判一次 | 服务端 `requireAdmin` + 前端一次能力探测 |
| **一个资源一个数据钩子**，页面只管渲染 | `apps/web/src/features/admin/api.ts` 一组函数 |
| 列表统一分页 | 服务端 `limit`/`offset` + 响应带 `total` |
| 服务端是**权限的最终裁决者**，前端只做呈现 | 前端隐藏入口 ≠ 授权；每个 `/api/admin/*` 都过 `requireAdmin` |

**二、权限模型用单级 `User.isAdmin`，不做 RBAC。**

具体：`users` 加一个 `is_admin BOOLEAN NOT NULL DEFAULT false`，
一个 CLI 脚本授权（`pnpm admin:grant <email>` / `admin:revoke` / `admin:list`）。
理由见 §3.1。

**三、范围只覆盖 heyta 真实有的运营面**，且**首版只读 + 三个低风险支持动作**：

- 读：概览统计、用户（列表/详情）、订阅、订单、优惠码、邀请/推荐、通知、同步设备
- 写（仅三个，都不涉及钱）：**解锁被锁账号**、**调整存储配额**、**强制登出**（`tokenVersion++`）
- **不做**：改订阅/退款/发券/群发通知。

**四、明确不做"自由文本群发通知"。** 现有通知表的 `kind` 是**封闭词表**
（`packages/domain/src/activity.ts` 的 `NOTIFICATION_KINDS`），
且 `server/src/activity/notifications.ts` 的文件头写死了立场：
服务端存**语义 + 参数**，不存渲染好的文案（文案的唯一事实源是 `packages/i18n`，
用户随时切语言）。群发自由文本会**同时**破坏这两条。
真要做营销触达，那是另一条线（需要新的 kind + 词条），不是后台的一个文本框。

---

## 3. 为什么这么选

### 3.1 为什么不做 RBAC

RBAC 的成本不在第一张表，在**它带来的全部配套**：角色管理界面、权限码词表、
"谁能改角色"这个自指问题的答案、以及每一次新增端点都要想一遍"该挂哪个权限码"。
而它现在的收益是 **0** —— 只有一个运营者，"给谁什么权限"这个问题不存在。

判据不是"RBAC 更专业"，而是**"现在换掉它代价大不大"**：`isAdmin` → RBAC
是一次**加法**（加角色表、把 `isAdmin` 迁成 `role='admin'`），不是重写。
所以先要简单的那一半。

⚠️ 触发升级的条件要写清楚：**当出现第二个需要后台、但不应看到全部数据的人**时，
就该把这份 ADR 换掉。

### 3.2 为什么不照搬 SSOS 的 35 个后端路由

它们是 Hono + Drizzle + 裸 SQL。在 heyta 里要逐条重写成 Fastify + Prisma，
**且 30/35 个文件查询的表在 heyta 不存在**。真正能复用的是"有哪些端点、
每个端点返回什么形状"这份**设计**，而那份设计里与 heyta 数据模型交集的部分
只有一小块。抄 8k 行换来的是 8k 行的维护面。

### 3.3 为什么前端不引入 react-router / TanStack Query

heyta 的 web 是**单页 + 视图切换**（`App.tsx` 的视图状态机），
且 `apps/web` 刻意没有路由库；引入 react-router 只为承载后台，
会让"应用怎么导航"出现第二套答案 —— 这正是 ADR-0036 反对的单源被破坏。
数据获取同理：现有 features 的手写 store + `fetch` 已经够用，
后台只有一张列表 + 一个详情，引入 TanStack Query 是为它新建一层缓存语义。

### 3.4 为什么首版是只读 + 三个动作

"改订阅" "退款" "发券" 都会动到**钱与权益**，而它们各自需要：
幂等键、审计记录、失败回滚、以及与 `billing/` 现有 `apply-event` 路径的协调。
那是一个独立的工作单元，不该塞进"先让运营看得见"的第一次交付里。
**"看得见"本身就能回答大多数支持工单**（这个用户是什么状态、有没有付钱、
卡在哪一步），所以它是正确的第一步。

三个写动作之所以被放进首版：它们**不碰钱**，且都是高频支持诉求，
而且每一个都是**单行更新 + 可逆**（解锁重新计数、配额重新设值、登出重新登录）。

---

## 4. 后果

### 4.1 好的

- 运营第一次能回答"这个用户付钱了没有 / 卡在哪"，不用直连数据库。
- 管理面与主应用同一套东西：同一份 design-system、同一套 token 门禁、
  同一个部署产物 —— **没有第二个应用要部署、要发版、要配 CORS**。
- 默认没有人是管理员（`DEFAULT false`），且授权是一个**显式、可审计**的动作。

### 4.2 代价与风险（要认下来）

1. **`isAdmin` 是账号级的全有全无。** 一旦授权，那个人能看到全部用户与订单。
   在只有一个运营者的当下这是可接受的，但它**不是**一个可以长期不变的答案（§3.1）。
2. **后台代码进了主应用的 bundle。** 首版用**按需加载**隔离，且入口只对
   已授权用户渲染；但"代码在包里"这件事本身意味着前端不能作为保密手段 ——
   **保密必须由服务端 `requireAdmin` 承担**。
3. **`isAdmin` 不能靠用户自己拿到。** 没有任何自助入口；只能由 CLI（在服务器上）
   或已有管理员授予。这是 fail-closed 的选择。
4. 三个写动作**没有审计表**。当前记录方式是 `Logger`。真要做合规级审计
   （谁在什么时候改了谁），需要一张 `admin_audit_log` —— 那时再发一个新 ADR，
   不要悄悄加一张表。

### 4.3 明确不变的

- **服务端是唯一裁决者。** 前端隐藏入口是 UX，不是安全。
- **管理端点一律不返回密文/密钥类字段**：`passwordHash`、各类 token、
  `Passkey.credentialId`/公钥 一律不出现在响应里（白名单投影，与
  `packages/local-api` 的 `projectForTool` 同一立场）。
- **不新增通知 kind、不改动计费路径。**

---

## 5. 勘误（2026-10-03）

按 [`README.md`](README.md) §1a 的边界写：本节**只追加**，上面正文一字未改；它属于允许的那两类
（① 正文里的某个断言与现状不符、② 该决定的落地进度），**不是**结论变更 —— 结论若真要变，是新写一份 ADR。

**① §2 第三条那个"三"字，今天不再是当前范围的描述。**
正文写的是「写（仅三个，都不涉及钱）」，这在 2026-09-30 是完整的。2026-10-03 的 W4b 加了**第四个写动作**：
公共事实（调休/补班）的年度录入，由 [ADR-0052](0052-public-facts-are-deployer-supplied.md) 定性。
⇒ 读 §2 第三条时请带上这一条：**"仅三个"是当时的范围决定，不是当前清单。**
之所以不直接把 bullet 改成四个：那条"仅三个"是当时取舍的**证据本身**（§3.4 整节论证靠它 —— 为什么首版敢只做三个动作），
改掉它，后来人就没法 reconstruct 当时的判断了。

**② 新加的那一个和原来三个不是同一种东西 —— 差别在作用域，不在"涉不涉及钱"。**
三个支持动作（解锁 / 调配额 / 强制登出）的作用域都是**单个账号**；公共事实录入的作用域是**该部署方的全体用户**
（录错一年，所有人日历上错一年，且用户端看不出"这条来自部署方"、没有除撤销之外的自愈路径）。
⇒ ADR-0052 §4 代价第 1 条据此给写面钉了三道：**权限最高的一组 + 只能整年替换 + 出处（`papers`）必填**，
而不是"把它当第四个支持动作照样放行"。

**③ §4.2 第 4 条（"三个写动作没有审计表"）里的"三个"同样过时。**
审计表那件事的结论**没变**（要合规级审计就新发 ADR，不悄悄加表）；变的是它覆盖的对象数量，
以及其中一条判断的强度 —— 公共事实录入是这四个里**唯一会渲染给全体用户**的，
`Logger` 那层留痕对它是否够用，是 §4.2 当时没有考虑过的一种东西。

**没破的不变量（逐条核过，不是"应该没破"）**：§4.3 三条一条没动 ——
管理端点仍不返回密文/密钥类字段（`holidayAdjustmentAdminDeleteQuerySchema` 是 `strictObject`，只接 `year`）；
**没有新增通知 kind**（这条下行不走 `account_notifications`）；**没有碰计费路径**（不涉及 `Subscription`/`CheckoutOrder`/`Coupon`）。
§2 第二条（单级 `isAdmin`，不做 RBAC）也没变：新三端点走的是**同一个** `addHook('preHandler', requireAdmin)`，
所以"新增路由忘了鉴权是不可能的"那条结构性保证继续成立。

**证据与读数（写明是哪一趟 —— 代码此刻还没合进 main）**：
`git grep -n "holiday-adjustments" feat/countdown-w4b -- server/src/admin/admin.routes.ts`
⇒ `:772` GET、`:783` PUT `/holiday-adjustments/years`、`:842` DELETE（年份走查询串，`20:30 现量`）；
公开读面 `server/src/holidays/holiday-adjustment.routes.ts:89`（`fastify.get`，**无 `preHandler authenticate`**，
对照 `server/src/push/push.routes.ts:127` 那条挂了鉴权的先例）；
契约在 `packages/shared-schema/src/holiday-adjustment-contract.ts`（`papers` ≥1、整年替换、`PUBLIC_FACT_SHAPES`）。
⚠️ `pnpm check:public-facts` 那条门禁**尚未接进 `pnpm check`** —— 别把本文读成它已存在。
