# ADR-0026：退款/拒付侧的权益回收**本轮不做** —— 缺的是「逐笔支付的权益账本」，不是一个 webhook handler

> 状态：**已接受**
> 日期：2026-09-27
> 取代：无。本 ADR **不**改变 [ADR-0017](0017-single-paid-tier-and-payment-channel.md) /
> [ADR-0018](0018-adjustable-pricing-and-coupons.md) / [ADR-0020](0020-ai-subscription-two-tiers.md)
> 的任何价格或通道结论 —— 它判定的是**退款侧的落地顺序**，并记录一个被查实的建模缺口。
> 相关：[ADR-0023](0023-managed-ai-quota-not-implemented.md)（同一形状的"本轮不做 + 最小清单"）。

## 1. 背景与约束

**收银台与到账侧已经通了**（`docs/reference/pricing-and-coupons.md` §7 第 18 条）：
`POST /api/billing/checkout` → 报价 → 冻结订单 → `adapter.createCheckout`；
到账 webhook 在**同一个事务**里调 `settleOrderPaidInTransaction`，按订单冻结的
`price_id` 写回 `subscriptions.grants`。

**退款侧有三个洞，而且它们不是同一个洞：**

| # | 缺什么 | 证据 | 这一条的性质 |
|---|---|---|---|
| 1 | 退款通知进不到业务层 | `wechat.adapter.ts` 对非 `TRANSACTION.SUCCESS` 的 `event_type` 一律返回 `{ ok: false, reason: 'unsupported-event-type' }` → 路由回 401 | **有意**的 loud 选择：文件内注释写明"明确拒绝而不是静默忽略，静默忽略会落一条 PaymentEvent 却没有对应语义，比 401 更难排查" |
| 2 | 订单/核销的状态同步没人调 | `reverseOrderOnRefund`（`pricing-store.ts:1121`）**零生产调用方**：它把订单置 `refunded`、核销置 `reversed` | 只是**没接线**。它本身是"退款被**确认之后**的状态同步"，不是发起退款 |
| 3 | 权益回收端口没接 | `WechatPayAdapterOptions.onRevoke`（`wechat.adapter.ts:458`）在生产装配处（`registry.ts` 的 `createWechatBillingAdapter` 调用）**没有注入**，所以 `revokeEntitlement` 是有意的空操作 | 接线 + **一个没有答案的语义问题**（见下） |

### 🔴 硬约束：权益模型里没有"哪一笔支付买了哪一段"

这一条是本 ADR 的核心，也是它**不能**像洞 2 那样"顺手接上"的原因。

- 权益落在一行 `Subscription` 上（`schema.prisma:162`），它的字段是
  `grants[]` / `status` / `currentPeriodEnd` / `lastEventAt`。
  **没有任何字段记录"哪一笔支付买了哪一段"**。
- 一次支付是**叠加**到同一个到期日（一次性支付路径 + `extendSubscriptionPeriod`），
  而能力是**替换**而不是并集（`apply-event.ts:70`："一次支付把这一行的能力集合设成
  这次买的那一档"）。
- 写入路径按 `findFirst({ userId, provider })` 找那一行（`webhook.routes.ts:325`）——
  连 `@@unique([userId, provider])` 都不存在，"一行一用户"是**意图**，不是被约束保证的事实。

**推论（这才是关键）**：`退第 2 笔、保留第 1 笔` 在这套模型里**无法表达**。
一旦按"这笔退款"去回收，能作用的最小单位就是**整行** ——
也就是把用户**更早那笔合法购买**一起撤销（过度回收）。
这不是"实现得糙一点"，而是"没有正确的答案可选"。

两条独立的阻塞还叠在上面：

- **退款政策本身未定**（`docs/plans/subscription-boundary.md:138`：*"未定，落地前必须写进
  `server/legal/terms-of-service.md`"*；[ADR-0017](0017-single-paid-tier-and-payment-channel.md) §5 同）。
  那是**业主决定**，不是编码。政策决定的是"什么时候退"，不是"退了之后账怎么记"——
  但下面 §3 的选项 B 恰恰需要它来定"整行失效"是否可接受。
- **没有任何已配置的支付通道**：`WECHAT_PAY_ENABLED` 未设 → 生产 adapter 列表只有 `noop`
  （`registry.ts` 的 `createBillingAdaptersFromConfig`）。所以退款通知今天**既到不了、
  也无法端到端验证**。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 只接订单侧**：adapter 接受退款通知 → 订单置 `refunded` / 核销置 `reversed`，**权益不动** | 字面满足 handoff §12.3-3；账务更准确；退款后那张订单不再挂 `pending` | 造出一个**半真状态**：订单说"已退款"，而用户**仍然持有已付费权益**。运维看到"退款已处理"会合理地以为权益也没了 —— 这正是本仓库反复拒绝的那类形状 | 洞 3 未解 |
| **B. 本轮不写退款路径，把缺口写成本 ADR + 最小清单**（**选它**） | 不制造半真状态；把"不做"变成**有终点、可复算**的决定；不写无法验证的代码 | 洞 2 的 `reverseOrderOnRefund` **仍然是零生产调用方**；退款通知仍回 401 | 下面 §5 的清单 |
| C. 全量做：新增**逐笔支付权益账本**（新表 + 迁移）再做正确的按笔回收 | 唯一能让回收**正确**的一条路 | 动 schema / 迁移 / 权益模型 / 判定路径，是一个**独立工作流**，明显大于本任务书；而且退款政策未定，账本的形状会被政策牵着走 | `schema.prisma:162`；`apply-event.ts:70` |
| D. 让 adapter 对退款通知回 200「已收到但不处理」 | 通道不再无限重投 | 把"明确拒绝"换成"静默忽略"—— 而文件内注释**已经否决过**这个形状（"比 401 更难排查"）；且它不解决任何一个真问题 | `wechat.adapter.ts:728` 的注释 |

## 3. 结论

**退款/拒付侧的权益回收在本轮不做。** 三条硬约束：

1. 🔴 **不写"订单侧反转但权益不动"的半截路径**（否决选项 A）。
   在没有逐笔账本的情况下，那会让系统进入一个**对账时无法自解释**的状态。
2. **回收的正确性取决于 §5 第 1 条的粒度决定**（账本 vs 政策），
   在它落地之前，任何回收实现都是猜的。
3. **`reverseOrderOnRefund` 继续零生产调用方 —— 但这一条从今以后是显式记录，
   不是"忘了接"。** 洞 1 的 401 继续保留，且同样是**有意**的。

> ⚠️ **为什么"不做"在这里是负责任的答案**：唯一能正确回收的路径要改权益模型，
> 而模型形状取决于一个**尚未做出的产品/法务决定**（退款政策）。
> 此刻正确的动作是把缺口、约束与终点写清楚，
> 而不是在一个无法表达"退哪一笔"的模型上写一个必然过度回收的 handler。

## 4. 后果

**接受这个决策意味着：**

- 手动/运营发起退款之后，**服务端不会自动**回收权益，也不会自动把订单置 `refunded`。
  目前只能手工改库 —— 而这一点必须写在运维文档里，不能靠"应该有代码处理"。
- 一笔已确认的退款会**继续占用券名额**（`reversed` 是计数状态，
  见 `pricing-and-coupons.md` §4.4）—— 这是既有设计，本 ADR 不改变它。
- 一旦接退款通道，**adapter 的 401 会变成运维噪音**（微信会按策略重投）。
  这是"明确拒绝"的已知代价，**不是新的 bug**。

**哪些约束需要靠规范兜住：**

- 退款政策必须先于实现（§5 第 1、5 条）。它是本 ADR 的**前置条件**，不是后续打磨项。
- 任何"手工回收权益"的跑单操作都必须留下审计行（沿用 `pricing_audit_log` 的形状）。
- 🔴 **本 ADR 没有配套门禁**（"不做"没有可失败的门禁）。它的终点由 §5 的清单定义：
  **清单清空之日，就是本 ADR 被取代之日。**

## 5. 最小实现清单（所以"不做"是一个有终点的决定）

1. **决定权益粒度**，二选一，且必须是正式决策：
   - (a) **逐笔支付权益账本**：新表按 `(order_id / provider_event_id)` 记
     `periodDays` + `grants` + `priceId` + `occurred_at`，到期日由账本**求和/取最大**导出，
     `Subscription` 退化成派生视图；
   - (b) **政策级"任一退款即整行失效"**：更简单，但它会**撤销更早的合法购买**，
     所以只有在退款政策明确接受这一点时才可选。
2. **adapter 归一化退款通知**（`REFUND.SUCCESS` / `REFUND.ABNORMAL` / `REFUND.CLOSED` →
   `NormalizedPaymentEvent` 上的**显式**退款声明，`oneTimeGrant: null`），
   必须走**同一套**验签 + 时间戳时效 + AES-GCM 解密，且失败仍然 fail-closed。
3. **`webhook.routes.ts` 增加退款分支**：同一个事务里做
   `reverseOrderOnRefund`（订单/核销）+ 账本回收；幂等仍由
   `(provider, providerEventId)` 唯一约束承担。
4. **回收端口的注入**：要么在 `registry.ts` 注入 `onRevoke`，要么（更可能）让路由直接做 ——
   adapter 没有数据库访问（`wechat.adapter.ts` 的 `onRevoke` 注释已说明）。
5. **退款政策写进 `server/legal/terms-of-service.md`**（`subscription-boundary.md:138` 一直留着它）。
6. **定期对账兜底**：MoR（Lemon Squeezy）**自己吃掉拒付**、没有独立事件，
   所以事件驱动永远不完整（`noop.adapter.ts` 与 `types.ts` 的 `revokeEntitlement` 注释都记着这条）。

## 6. 未核实项

- **微信退款通知的真实载荷字段未核实。** 本 ADR 只按 APIv3 通知的通用形状
  （`resource` 密文 + 解密后含 `out_trade_no` / `refund_status` / `amount.refund`）推断，
  **没有对着微信官方文档逐字段核对**。
- **退款通知的幂等键未定**：`TRANSACTION.SUCCESS` 用 `out_trade_no` 编 `providerEventId`；
  退款通知是否该用 `out_refund_no`（以及它是否总在载荷里）需要核实，否则重投可能被当成新事件。
- **`@@unique([userId, provider])` 的缺失是否是刻意的**（schema 上只有 `@@index([userId])`），
  未核实。如果"一行一用户"真的是不变量，那它现在**没有被约束保证** ——
  这是一个独立于本 ADR 的观察，不要顺手在这里加约束（`AGENTS.md §3.3`）。
- **退款路径无法端到端验证**：本机与仓库都没有配置支付通道，
  所以本 ADR 的任何结论都只经过代码阅读与真库结构核对，**没有一笔真实的退款通知**。
- **本轮的实测数据库是 PostgreSQL 15.13**（Homebrew，`127.0.0.1:5432`），
  而仓库声明的下限是 **16**（`operations-autovacuum-reloptions` 断言
  `server_version_num >= 160000`，本机因此失败）。所以任何"在真库上验过"的说法
  都带这条环境注解。

## 7. 勘误（2026-10-05）

**只追加，正文一字未改。** 触发它的是 [ADR-0053](0053-refunds-only-for-countable-segments.md)
落地时的三处实测，其中第 1 条是**正文里的断言已被证伪**（规则 1a 的第①类）：

1. **§3 第 3 条「`reverseOrderOnRefund` 继续零生产调用方」已经不成立。**
   它现在有生产调用方：`server/src/billing/refund-store.ts` 的
   `retractEntitlementInTx` 经
   `reverseOrderOnRefundInTransaction` 在**通道确认 `success` 之后**调它
   （`grep -n "reverseOrderOnRefundInTransaction" server/src/billing/refund-store.ts` 现量）。
   洞 2 因此关闭，且关闭的方式**不是**选项 A：权益回收与订单反转在同一个事务里，
   所以没有留下"订单已退款而权益还在"那半格。
2. **洞 1 的 401 已按 §5 第 2 条的形状改掉**：`wechat.adapter.ts` 现在归一化
   `REFUND.SUCCESS / ABNORMAL / CLOSED`，退款通知不再被拒收。
   归一化出来的事件带 `oneTimeGrant: null` + `userId: null`，
   即 §5 第 2 条要求的"显式退款声明"。
3. **§1 那条硬约束本身没有被推翻**（`subscriptions` 仍然记不下"哪一笔买了哪一段"），
   被收窄的是**适用范围**：ADR-0053 只在"经收银台下的单"这个可数域里按笔回收，
   域外（没有 `out_trade_no` 的旧兼容到账）照本 ADR 的结论**拒发**。
   §5 第 1 条（决定权益粒度）因此**仍未完成** —— 它现在是 ADR-0053 §6 第 1 条那个终点。
4. **§5 第 5 条（退款政策写进法务条款）也仍未完成**：临时口径
   （`server/src/billing/refund-policy.ts` 的 7×24 小时全额）只在代码与 ADR-0053 里，
   对外文案要业主确认后才动（`AGENTS.md §8` 工作流第 18 条）。
