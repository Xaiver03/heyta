# 通知中心 + 活动（福利中心）

> 状态：**已完成**（2026-09-29）
> 依据：[`pricing-and-entitlements.md`](../reference/pricing-and-entitlements.md)（权益词表）、
> [`subscription-boundary.md`](subscription-boundary.md) §2（只限制托管同步，不锁数据）、
> [`motivation-and-progression.md`](motivation-and-progression.md)（激励体系的回路诊断）。

---

## 1. 这一轮补的是什么缺口

在此之前 heyta **没有通知中心**，也**没有任何"邀请"机制** —— 落地页上如果写了
"邀请好友送会员"，那是**一句无法兑现的话**：没有任何一张表记住谁邀请了谁、
发了几天，因而既发不出去、也无法对账。

两个缺口其实是一个：**账号级事件没有落点**。任务数据走 op-log（E2EE，服务端看不到），
而"有人用你的邀请码激活了"这类事**根本不涉及用户内容**，它属于账号层，
此前却没有任何地方存放它。

所以这一轮同时做了三件事：

| 层 | 交付 |
|---|---|
| 数据 | 三张账号级表：`invite_codes` / `referrals` / `account_notifications` |
| 机制 | 邀请注册 → 被邀请人验证邮箱 → 邀请人得 **5 天 `hosting`** + 收到一条通知 |
| 界面 | rail 底部**铃铛**（带未读徽标）→ 面板两个 Tab：**通知** / **活动** |

形态照滴答清单的实测形态（铃铛在侧栏底部、点开是「通知 / 活动」两个 Tab）。

---

## 2. 🔴 最重要的一条：权益判定从"最新一行"改成"多个来源取并集"

这一条**不是顺带重构，而是邀请机制能安全上线的前提**，所以放在最前面。

### 它修的是一个静默丢时长的 bug

邀请奖励写进 `subscriptions` 表（`provider = 'invite'`），而**奖励行是在付费行之后建的**。
而在此之前，权益守卫读订阅用的是：

```ts
prisma.subscription.findFirst({ where: { userId }, orderBy: { id: 'desc' } })  // 最新那一行说了算
```

只有一个 provider（微信）时这是对的 —— 一个用户最多一行。加上邀请行之后，
库里会有两行，而"最新"会挑中**后建的奖励行**：

```
  id=7   provider='wechat'  currentPeriodEnd=+20 天   grants=['hosting']
  id=9   provider='invite'  currentPeriodEnd=+5  天   grants=['hosting']   ← 后建，被挑中
```

用户付了钱的 20 天里有 **15 天凭空消失**，表现为"我明明没到期，怎么被降级了"。
两行都合法、都 `active`、`grants` 都对 —— **没有任何一层会报错**。

### 现在

`evaluateCapabilityAcross(rows, capability, now)`：**任一行有效且覆盖该项能力即放行**（OR）。
每一行代表一个独立的权益来源（付费 / 邀请 / 将来的运营赠送），用户拥有的能力是它们的**并集**。
`defaultLoadSubscriptions` 改成 `findMany`，守卫改走 `evaluateCapabilityAcross`。

- 为什么不是 AND：会让"买过 hosting + 被邀请拿过 hosting"的人被两道门各拒一次。
- 判定顺序保持"**先判有效、再判能力**"（既有语义，未改）。
- 拒绝时返回**第一条有信息量的原因**，而不是笼统的 `NO_SUBSCRIPTION` ——
  否则运维会去找一条并不存在的缺失订阅。

证据：`server/tests/entitlement-across.spec.ts`（13 条，含"付费 20 天 + 邀请 5 天 → 放行"的核心回归）。

---

## 3. 数据模型（三张表）

详见 `server/prisma/schema.prisma` 的模型注释与迁移 `20261002000000_add_invites_and_notifications/migration.sql`。

| 表 | 作用 | 关键约束 |
|---|---|---|
| `invite_codes` | 一个账号一张码，**惰性生成**（第一次打开「活动」页时才建） | `code` 唯一且归一化；`user_id` 唯一 |
| `referrals` | 一条邀请关系：谁邀请了谁、有没有兑现 | `invitee_user_id` **唯一**；不可自邀；结算**全有或全无** |
| `account_notifications` | 账号级通知（目前只有 `referral-activated`） | `kind` 非空；`payload` 必须是 JSON 对象 |

### 为什么单独一张 `invite_codes` 而不是给 `users` 加一列

加一列也能跑，但那会把一件**运营事实**（可停用、可轮换）焊进账号身份表。
分开之后 `users` 不必为一个福利功能变宽，本迁移对既有表**零 ALTER** ——
也就没有"给已有行加必填列"的风险（AGENTS.md §3.3）。

### 🔴 五条手工 CHECK 是承重的，不是装饰

`prisma migrate diff` 生成不出它们，所以逐条手工加了，并**逐条写了它防的是哪一种静默故障**。
其中两条最要紧：

- `referrals_no_self_invite`：**防铸币**。邀请奖励是凭空多出 5 天会员，
  自邀一旦成立，一个人就能零成本把会员续到无限远。发奖不可逆，所以最后一道防线放在库里。
- `referrals_settlement_all_or_nothing`：拒绝"已激活但没发奖"的半成品行 ——
  那种行的表现是界面上"成功邀请 +1"而会员一天没涨，两个数字分别在两张表里，对不上时没有任何东西会报错。

证据：`server/tests/activity-schema.pglite.spec.ts`（21 条，跑的是**发布中的迁移 SQL**）。
**已用变异验证会红**：拿掉"不可自邀"与"payload 必须是对象"两条约束 → 4 条用例当场失败。

---

## 4. 邀请机制：规则与口径

| 项 | 取值 | 理由 |
|---|---|---|
| 奖励 | **5 天 `hosting`** | 一次凭空多出来的会员，敞口可算（≈ ¥0.83 托管成本）；5 天够双方真的用上一次 |
| "激活" | 被邀请人**完成邮箱验证** | 注册那一刻邮箱可能是编的；验证是**只有邮箱主人**才能做的动作 |
| 上限 | 30 天内最多**绑定 20 条** | 让"无限续期"这条路不存在。判定放在**绑定**而不是发奖 —— 见下 |
| 自邀 | 拒绝 | 防铸币 |
| 一人一次 | `invitee_user_id` 唯一 | 数据库级保证，不靠应用层"查一下有没有" |

### 🔴 上限为什么放在"绑定"而不是"发奖"

| 放在哪 | 后果 |
|---|---|
| **绑定**（已选） | 超限时根本不建这条邀请，于是"**建了的邀请一定会发奖**"是恒真的 |
| 发奖 | 会造出"已激活但没发奖"的行，被 `referrals_settlement_all_or_nothing` 拒绝；放松那条约束就等于接受两个数字对不上 |

代价：未验证的挂起邀请也占额度。可接受 —— 额度是 20，诚实用户不会有 20 个拖着不验证的邀请。

### 发奖的钱从哪里扣

写进 `subscriptions`，`provider = 'invite'`，**一行一用户**（与 `apply-event.ts` 的
"一行一用户 / (userId, provider)"约定一致），到期日用**收钱路径的同一个函数**
`extendSubscriptionPeriod`（`max(now, 已有到期日) + N 天`）叠加，绝不覆盖。

`price_id` 如实写 `null`（档位未知）—— 它**不是一次购买**，编一个 `hosted-monthly` 进去等于伪造购买事实。
**因此邀请行不是 SKU**，不参与 `check:pricing-consistency` 的两个 SKU 断言。

### 结算发生在验证事务**内部**

`settleReferralActivation` 跑在 `verifyEmail` 的 `$transaction` 里，换来三件事：
不会重复发（CAS `activatedAt: null` + 唯一约束）、不会半途（会员与通知同生共死）、
**失败可重试**（回滚 → 令牌保留 → 用户再点一次邮件即可）。

代价：结算真的坏了会让邮箱验证一起失败。所以它的所有写入都按构造满足那三条 CHECK，而不是"但愿它不抛"。

---

## 5. 客户端

| 决定 | 为什么 |
|---|---|
| 入口是 rail 底部的**普通 `<button>`**，不是 `role="tab"` | `smoke.spec.ts` / `motivation.spec.ts` 把 rail 的 tab 数量与文案**逐字**钉死（10 个、顺序固定）。铃铛是**动作**（打开面板），与旁边的「帮助」同类 |
| 面板 `position: fixed` | `nav.ht-rail` 有 `overflow-y: auto`（裁剪容器），`absolute` 的宽面板会被切掉。锚点由 CSS 从 `--ht-layout-rail-width` 算出，不靠 JS 量尺寸 |
| 铃铛是 `nav.ht-rail` 的**直接子按钮** | 贴底靠 `.ht-rail__tab--tool:first-of-type { margin-top: auto }`；包一层 div 会让铃铛拿不到它，与「帮助」之间裂开一大块空白 |
| 通知与活动**分开加载** | 见下 |
| 三个请求全部 **fail-open 且不抛** | 一个"看通知"的入口不该成为新的崩溃点 |
| 未知 `kind` **整条跳过** | 服务端加新事件时老客户端会遇到它；画一张空白卡片看起来像界面坏了 |

### 🔴 活动只在「活动」Tab 真的被打开时才拉

`GET /api/activity` 会**惰性创建**这个账号的邀请码（服务端的 get-or-create）。
如果"未读徽标"那次加载顺带把活动也拉了，那么**每个用户每次打开应用都会写一行邀请码** ——
包括那些永远不会去邀请人的人。所以：通知在挂载时拉（徽标要在面板关着时就有），
活动只在切到那个 Tab 时拉。这是"邀请码惰性生成"在客户端的对应动作。

### 读不到 ≠ 没有通知

`unconfigured`（没配服务器）与 `unavailable`（配了但读不到）**分开说**，
且失败时**不清空**已读到的数据。把一次失败显示成"还没有通知"会让用户以为自己错过了什么。

### 邀请码在注册处的形态

`AuthPanel` 增加一个**可见、可编辑**的邀请码输入框，初值来自 URL 的 `?invite=`。
不隐藏它，因为：有人是口头/截图拿到码的、链接里的码可能被截断、用户应该看得见自己在被谁邀请。

形状不对时**不发出去，也不禁用注册按钮** —— 用户是来注册账号的，一个抄错的码不该把他挡在门外。
判据用 `@heyta/domain` 的 `inspectInviteCodeShape`，与**服务端查表前**用的是同一个函数。

---

## 6. 证据（验收怎么跑的）

| 层 | 命令 / 文件 | 结果 |
|---|---|---|
| 迁移的 CHECK 真的会拦 | `server/tests/activity-schema.pglite.spec.ts` | 21 条通过；**变异验证**：拿掉 2 条约束 → 4 条红 |
| 纯逻辑（归一化 / 绑定判定 / 载荷校验） | `packages/domain/tests/activity.spec.ts` | 通过 |
| 发码 / 绑定 / 发奖 / 结算幂等 | `server/tests/activity-invite.spec.ts` | 34 条通过 |
| 路由契约（含越权与"缺省即全部"两个洞） | `server/tests/activity-routes.spec.ts` | 19 条通过 |
| 权益取并集（核心回归） | `server/tests/entitlement-across.spec.ts` | 13 条通过 |
| 读取层（E2EE 无载荷 + fail-open） | `packages/app-host/tests/inbox.spec.ts` | 通过 |
| 界面与 store | `apps/web/tests/inbox.spec.tsx` | 18 条通过；**变异验证**：把活动改成挂载即拉 + 让未知 kind 也渲染 → 4 条红 |
| **真浏览器** | `e2e/tests/inbox.spec.ts` | 3 条通过（含空态截图那条） |
| rail 的既有锁定未被破坏 | `e2e/tests/smoke.spec.ts` + `motivation.spec.ts` | 9 条通过 |

**截图（人已看过）**：`e2e/test-results/` 下的
`inbox-closed.png`（面板关着 + 未读徽标）、`inbox-notifications.png`、
`inbox-activity.png`、`inbox-unconfigured.png`、
`inbox-empty.png` 与 `inbox-activity-empty.png`（共享 `EmptyState` 在面板里的实际外观）。

**空态**：三处空态都走共享 `EmptyState`（`packages/ui`），
面板正文整体包在 `HeytaUiProvider` 里 —— `check:ui-provider` 与
`check:empty-state` 都盯着这两件事。宿主侧的两处**文案**按仓库既有形状
登记进后者的债务账（见 §7 第 8 条）。

---

## 7. 已知边界（不是缺陷，但不要当成已经做了）

1. **奖励会顺带延长 `ai`**。若邀请人正在用 `hosted-ai-monthly`（grants 含 `ai`），
   到期日是**整行**叠加的，所以那 5 天里 `ai` 也延了。这是"5 天会员"的口径下
   **过度授予**而非克扣，且金额极小（¥12 档 5 天 ≈ ¥2）。要做成精确授予，
   需要把奖励拆成独立权益来源（而不是叠加在同一行）。
2. **活动目录是静态配置**，不是数据库表（`packages/domain` 的 `CAMPAIGN_CATALOG`）。
   没有运营后台时，一张没人能编辑的表比静态配置更会说假话。
   触发改成表的条件写在那个常量上方（限时限量 / 需要不发版下线 / 活动数 > 3）。
3. **不做系统级通知。** 这一轮做的是**应用内**通知中心；OS 级投递（含移动端通知库依赖）
   仍属于 [`site-and-parity-alignment.md`](site-and-parity-alignment.md) 的 B1-1，未动。
4. **本地事件不进通知中心。** 它只装服务端**本来就知道**的账号级事实；
   "任务到期"这类需要解密用户内容的事件在 E2EE 下不可能由服务端产生。
5. **被邀请人看不到自己的归因**。按产品规则奖励只发给邀请人，所以被邀请人界面
   不显示"你被 X 邀请了"。若要给被邀请人也发奖励，改动点在 `settleReferralActivation`
   （同一个事务里给 `inviteeUserId` 也发一次 + 写一条通知），并需要重新过一遍上限口径。
6. **`provider = 'invite'` 的行对用户不可见**。目前没有任何"我的订阅"页面列出 `subscriptions`；
   将来若做那个页面，必须**排除**邀请行（它不是购买，列出来会让"我买过什么"说假话）。
7. **没有对账/清理任务**。`referrals` 里长期挂起的邀请（对方一直不验证）不会过期；
   它们只占绑定额度，不发奖，所以不会资损，但会慢慢积累。
8. **空态账 +2**。三处空态（"还没有通知" / "暂时没有活动" / "还没有邀请记录"）
   **渲染**已经收编到共享 `EmptyState`（面板正文整体包在 `HeytaUiProvider` 里，
   `check:ui-provider` 盯着），但**文案**仍落在宿主侧的两个文件里，
   因为共享层不许 import `@heyta/i18n`（会拖进第二份 React，`check:mobile-bundle` 盯着）。
   这两条按仓库既有形状登记进 `scripts/check-empty-state.mjs` 的债务账
   （与 `timeline/labels.ts` / `categories/copy.ts` / `notes` / `reminders` 同形，
   登记项里写了"为什么不能用共享实现"）。
   ⚠️ 仍然**不满足**的地方已写在登记项里：共享 `EmptyState` 是**页面级**的
   （居中 + `space.16` 上下留白），而这三处是**面板级**的 —— 缺口是
   "区块级空态要不要成为共享组件的一档（`size?: 'page' | 'section'`）"，本仓尚未定。
9. **移动端还没有这个入口。** 这一轮的界面只落在 **Web / 桌面**（rail 在 `apps/web`，
  Electron 壳加载的就是同一份渲染器）。移动端是另一套 RN 界面，
  它的通知中心与活动页**没做** —— 数据与服务端已经有了（同一套 API），
  缺的只是那一端的面板。产品负责人这一轮明确要的是"电脑端放到侧边栏下面"，
  所以这是**范围**而不是遗漏；补的时候不需要动服务端。
