/**
 * 支付商无关的 billing 抽象层：**类型与接口**。
 *
 * 设计依据：`docs/plans/subscription-provider-selection.md` §4
 * 「抽象层设计：能抽象什么、抽象不掉什么」。那份结论说得很清楚：
 *
 * - 接口**只暴露五个方法**（`createCheckout` / `verifyWebhook` /
 *   `mapSubscriptionState` / `revokeEntitlement` / `refund`）——
 *   最后一个是 2026-10-05 补的（ADR-0053），因为它**必填**才有意义：
 *   没有通道的 adapter 也要能"照收请求然后拒"，见 `noop.adapter.ts`；
 * - 「状态映射表」与「金额单位换算」是每个 adapter 的**私有细节** ——
 *   这两处是最容易用错的地方，绝不能泄漏成共享的常量表；
 * - 🔴 **幂等不是 adapter 的职责**：七家支付商的幂等机制互不相同
 *   （Stripe `Idempotency-Key` / PayPal `PayPal-Request-Id` / 支付宝·微信只有
 *   `out_trade_no` / Paddle **官方明确不支持**客户端幂等键），
 *   所以本文件里**刻意不出现任何 "idempotency" 字样**，去重一律由
 *   `payment_events` 的 `(provider, providerEventId)` 唯一约束承担。
 *   若把这条责任写在接口上，下一个人会以为 adapter 能保证去重。
 *
 * 🔴 本模块**不引入任何支付商 SDK、不加任何依赖**。选型仍待用户确认实体状况，
 * 这里只把接口形状定死，让 Paddle ↔ Creem ↔ 支付宝 之间换手只改一个 adapter。
 */

import type { Currency } from './money';

/**
 * 我方统一的、**provider 无关**的订阅状态枚举。
 *
 * 取这七个值而不是"照抄某一家"的原因：不同 provider 的状态字面量语义**不同构**
 * （Paddle 有 `paused`，Stripe 没有对应物），所以枚举必须能表达"暂停"这类语义，
 * 而**把 provider 字面量映射到这里的表，是每个 adapter 的私有细节**。
 *
 * 约定：
 * - `trialing`  试用期内 —— 是否算权益由 `entitlement.ts` 的**策略**决定，不由这里决定；
 * - `active`    有效订阅；
 * - `past_due`  扣款失败但在宽限/重试中；
 * - `paused`    暂停（Paddle 等有该语义；Stripe 用映射到 `canceled`/`unpaid` 表达）；
 * - `canceled`  已取消（可能仍在周期内，也可能立即失效 —— 看 `currentPeriodEnd`）；
 * - `expired`   已到期；
 * - `unpaid`    欠费。
 *
 * ⚠️ 这个枚举**不是双射**：provider 侧可能有枚举里没有的值（Creem 的
 * `scheduled_cancel`、Lemon Squeezy 的 `on_trial`），要**归并**到最近的一个；
 * 也可能有枚举里没有、但 webhook 事件里出现的状态（**Creem 的枚举里没有
 * `expired`，但它的 webhook 有 `subscription.expired`**）——
 * 这正是"必须事件驱动、不能只靠轮询 provider 枚举"的原因。
 */
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'paused',
  'canceled',
  'expired',
  'unpaid',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** 运行时判据（webhook 载荷不可全信，落库前要挡一道）。 */
export const isSubscriptionStatus = (value: unknown): value is SubscriptionStatus =>
  typeof value === 'string' &&
  (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);

/**
 * webhook 的原始 header 集合。**不是**只给一个签名字符串。
 *
 * 为什么必须是全部 header：验签有两个谱系，且都拿不全信息就实现不了 ——
 * - **对称 HMAC**：Stripe `Stripe-Signature`、Paddle `Paddle-Signature`
 *   （每个 destination 一个 secret）、Lemon Squeezy `X-Signature`；
 * - **非对称证书链**：支付宝 RSA2（用支付宝公钥）、微信
 *   `WECHATPAY2-SHA256-RSA2048`（验签串 = `timestamp\nnonce\nbody\n`，还要
 *   **平台证书轮换**）、PayPal（`cert_url` + `transmission_sig`）。
 *
 * header 的值允许是 `string[]`：同一 header 重复出现时 Node/Fastify 会这样给。
 * 验签逻辑在 adapter 内部完成，本接口只负责把原料原样递进去。
 */
export type WebhookHeaders = Readonly<Record<string, string | string[] | undefined>>;

/**
 * adapter 把 provider 的 webhook 归一化成的**我方统一事件**。
 *
 * 🔴 `occurredAt` 是**事件发生时间**（取自 payload 内部），不是到达时间。
 * 七家支付商共同的前提是"至少一次投递 + 不保证顺序"，所以权益判定必须用它
 * 而不是到达顺序 —— Paddle 是唯一在文档里明确要求按 `occurred_at` 排序的，
 * 其余各家要 adapter 自己从 payload 里找时间戳。**这是抽象不掉的一处**，
 * 所以把它做成归一化结果里的必填字段。
 *
 * 字段可为 `null` 是刻意的，对应三种真实情况：
 * - 支付宝 / 微信**没有订阅状态机**（只有单次支付）→ `status` 为 `null`；
 * - 事件可能没有可识别的周期结束时间 → `currentPeriodEnd` 为 `null`；
 * - 事件可能不带我们这边的用户标识（只能靠 `externalSubscriptionId` 关联）→
 *   `userId` 为 `null`。真实 adapter 应从 checkout 时写入的 metadata / custom_data 取。
 */
export interface NormalizedPaymentEvent {
  /** 支付商标识，与 `PaymentEvent.provider` 同值。 */
  readonly provider: string;
  /**
   * 支付商侧的事件 id —— 幂等键。**同一事件重投必须得到同一个值。**
   *
   * ⚠️ 注意 Paddle 的 `evt_`（事件 id）与 `ntf_`（通知 id，**每次投递都不同**）
   * 是两个字段，用错会把每次重投都当成新事件。这个区分是 adapter 的私有细节。
   */
  readonly providerEventId: string;
  /** 归一化事件类型（adapter 的私有词表 → 这里的值），用于审计与日志。 */
  readonly eventType: string;
  /** 事件发生时间（epoch 毫秒）。见上方说明。 */
  readonly occurredAt: number;
  /** 外部订阅 id；`null` = 这个 provider 没有订阅对象（支付宝 / 微信单次支付）。 */
  readonly externalSubscriptionId: string | null;
  /** 归一化状态；`null` = 该 provider 没有订阅状态机。 */
  readonly status: SubscriptionStatus | null;
  /** 当前周期结束（epoch 毫秒）；`null` = 无法确定。 */
  readonly currentPeriodEnd: number | null;
  /** 我方用户 id（从 checkout metadata 取）；`null` = 事件未携带。 */
  readonly userId: number | null;
  /**
   * 一次性支付的授予信息。**只有"没有订阅对象"的 provider（支付宝 / 微信）才带它。**
   *
   * 🔴 为什么必须由 adapter 显式给出、而不是让 `applyPaymentEvent` 从"没有订阅 id"
   * 推断："没有订阅引用"也可能是**一条我们根本没打算授予权益的事件**
   * （退款、对账通知…）。把推断写进通用层，等于让任何没有订阅引用的事件都变成
   * "发一年权益" —— 受益的是攻击者。所以授予必须是**事件上的显式声明**。
   *
   * 语义见 `docs/plans/subscription-boundary.md` §6.2：一次支付把
   * `(userId, provider)` 那一行的到期日按
   * `max(now, 已有到期日 ?? now) + periodDays` 叠加。
   */
  readonly oneTimeGrant?: OneTimeGrant | null;
  /**
   * 🔴 **这是一笔真钱，但 adapter 无法从金额判断它买的是哪一档。**
   *
   * 什么时候会置位：金额不在价目表上时（典型来源是**用券打折后的实付**，
   * 例如 ¥12 档用 ¥7 券 → 实付 ¥5，而 ¥5 恰好是另一档的原价）。
   *
   * 为什么必须把它和"没有授予语义的事件"分开：两者以前都返回
   * `oneTimeGrant: null`，于是 `apply-event.ts` 把它们**归成同一个原因**
   * `NO_SUBSCRIPTION_REFERENCE` —— 那对一笔真实到账的支付是**假话**，
   * 而且它与退款 / 对账通知无法区分。运维在日志里看到的只会是
   * "一笔被忽略的通知"，而不是"有一笔钱没能交付权益"。
   *
   * 🔴 置位时**不授予**（fail-closed），因为金额推不出档位；权威判定只能拿
   * **订单上冻结的** `final_amount_minor` 与 SKU 来做（`settleOrderPaid`）。
   * 见 `docs/reference/pricing-and-coupons.md` §7 第 9 条。
   */
  readonly requiresOrderSettlement?: boolean;
  /**
   * 🔴 **商户订单号** —— 这一笔支付对应的、我们**已经冻结**的 `checkout_orders` 行。
   *
   * 由 adapter 从 provider 的明细里**显式**取出（微信是 `out_trade_no`），
   * **不是**从 `providerEventId` 里反解。理由是"权威判定属于订单"：
   * 只有拿到订单号，webhook 才能在**同一个事务**里把权威结算交给
   * `settleOrderPaid`（比订单冻结的 SKU 与 `final_amount_minor`），
   * 而不是继续相信"实付金额落在价目表上"这个会错的启发式。
   *
   * `null`/缺省 = 这一笔与任何冻结订单无关（旧路径 / 非收银台的支付）。
   * 那条路径沿用 adapter 自己的授予声明（`oneTimeGrant`）。
   */
  readonly outTradeNo?: string | null;
  /**
   * **支付商回执里的实付金额**（最小单位整数）。
   *
   * 🔴 它是**原始事实**，不是判定：判定由 `settleOrderPaid` 拿它去和订单上
   * 冻结的 `final_amount_minor` 比，本层**不做任何比较**。
   * `null`/缺省 = 事件没带金额，此时带 `outTradeNo` 的支付会 fail-closed
   * （没有金额就没有权威校验可以过）。
   */
  readonly paidAmountMinor?: number | null;
  /**
   * 🔴 **退款通知的显式声明**（ADR-0053）。与 `oneTimeGrant` 完全并列、互斥。
   *
   * 为什么必须是一个**声明字段**，而不是让通用层从"`eventType` 里有 REFUND"推断：
   * `apply-event.ts` 的既有立场是"授予必须是事件上的显式声明，不能从
   * '没有订阅引用'推断"—— 反过来的推断同样坏：任何一条我们没打算动的
   * 通知（撤销、对账、将来的争议）都会被误认成一次退款回收。
   *
   * 有这一项 ⇒ webhook 路由**只**更新退款行与权益，**绝不**授予任何权益；
   * 没有这一项 ⇒ 这条路径不做任何退款处理。
   *
   * ⚠️ 它是**通道给的事实**，不是"我们已经退完钱"：只有
   * `status === 'success'` 才允许回收（见 `refund-store.ts`）。
   */
  readonly refundNotice?: RefundNotice | null;
}

/**
 * 归一化后的退款通知。
 *
 * 🔴 幂等键仍然走 `providerEventId`（`(provider, providerEventId)` 那道唯一的闸）。
 * adapter 必须保证**同一笔退款的同一状态**重投时给出同一个 `providerEventId`，
 * 而不同状态（`ABNORMAL` 后转 `SUCCESS`）给出**不同**的键 —— 否则后一个状态
 * 会被前一个挡掉，那笔钱永远结不了。
 */
export interface RefundNotice {
  /** 我方退款单号：回调侧唯一能把通知认回 `refunds` 那一行的依据。 */
  readonly outRefundNo: string;
  /** 通道侧退款 id。`null` = 通知里没带（微信的退款通知带，但对账路径不该依赖它）。 */
  readonly providerRefundId: string | null;
  /** 通道说这笔退款现在是什么状态。 */
  readonly status: ProviderRefundStatus;
}

/**
 * 一次性支付的授予声明。由"没有订阅对象"的 provider（微信）给出。
 *
 * 🔴 **档位与能力必须一起带下来**，不能只带天数。只有天数的话，
 * `hosted-monthly`（¥5）与 `hosted-ai-monthly`（¥12）会写进**同一行订阅**、
 * 得到完全一样的结果 —— 用户付 ¥12 拿到 ¥5 的东西，且没有任何代码能发现。
 */
export interface OneTimeGrant {
  /** 授予天数。 */
  readonly periodDays: number;
  /**
   * 买的是哪一档（SKU id）。`null` = adapter 不知道 —— 判定走 `grants`，不走它。
   */
  readonly priceId: string | null;
  /**
   * 这一档授予的能力（`hosting` / `ai`），由 adapter 从**价目表**投影而来：
   * 金额 → 档位 → 能力的映射只有它知道。落到订阅行之后，权益判定就再也
   * 不需要价目表了（这正是那一列存在的理由）。
   */
  readonly grants: readonly string[];
}

/**
 * 验签 + 归一化的结果。
 *
 * 失败时**只带一个不泄漏内部细节的 reason**，由路由统一回 401。
 * 🔴 验签失败**绝不能落 `PaymentEvent`**：否则攻击者可以用垃圾请求把 eventId
 * 占掉，真事件到达时被当成重复而丢弃。这是真实攻击面。
 */
export type WebhookVerification =
  | { readonly ok: true; readonly event: NormalizedPaymentEvent }
  | { readonly ok: false; readonly reason: string };

/** `createCheckout` 的入参。金额用**最小单位整数**，避免浮点与"元字符串"歧义。 */
export interface CreateCheckoutInput {
  /** 我方用户 id，adapter 应把它写进 provider 侧的 metadata，供 webhook 关联回来。 */
  readonly userId: number;
  /** 套餐 / 价格标识（provider 侧或我方定义的 price id）。 */
  readonly priceId: string;
  /**
   * 🔴 **这一单实际要收多少**（最小单位正整数），由**计价层**冻结后传入。
   *
   * 为什么金额是入参、而不是 adapter 自己去查价目表：价格有**运行期版本**
   * （`price_versions`，带生效区间），只有计价层知道"这一刻该收多少"，
   * 而且那个数已经和券一起冻在 `checkout_orders.final_amount_minor` 上。
   * 让 adapter 自己查价目表就等于**多一个价格事实源** —— 运营者改价之后
   * 报价层收新价、收银台按旧价下单，两边静默分叉，正是 ADR-0018 §3.1 要消灭的形状。
   *
   * 所以 adapter 不再持有价目表语义；它只负责把给定的金额签出去。
   */
  readonly amountMinor: number;
  /**
   * 🔴 **这一单收的是哪个币种**，由**计价层**冻结后传入，与 `amountMinor` 同源。
   *
   * 为什么币种也必须进契约：`amountMinor` 是**最小单位的整数**，它本身不带币种。
   * 一个 `USD` 的 `500` 与一个 `CNY` 的 `500` 在数值上完全相等、语义上差 7 倍，
   * 而**没有任何一层会因此报错** —— 收银台按报价冻 USD、adapter 内部硬编码
   * `currency: 'CNY'`，于是用户被按人民币收了一笔美元单，订单上却写着 USD。
   * 这是 ADR-0018 §3.1 要消灭的"静默分叉"的又一处，只是这次分叉的是币种而不是数。
   *
   * 🔴 **必填，没有默认值。** 给一个默认币种等于把这个洞重新打开：调用方少传一次，
   * 美元单就又被静默当成人民币发出去。adapter 必须拿它与自己的
   * `supportedCurrencies` 对齐，不匹配就**在收钱之前**拒（见 `supportedCurrencies`）。
   */
  readonly currency: Currency;
  /**
   * 商户订单号 —— **由调用方生成，adapter 必须原样使用**，不得自己再生成一个。
   *
   * 🔴 为什么必须是入参：`createOrderWithReservation` 把报价冻结在
   * `checkout_orders.out_trade_no` 上，而回调（`settleOrderPaid`）是按
   * **订单号**去认这一单的。adapter 若另生成一个，库里冻的是 A、发给通道的是 B，
   * 回调到达时按 B 查不到订单 → `unknown-order` → **一笔真实到账的钱授予不出去**。
   *
   * 所以顺序只能是「**先冻结、后下单**」：调用方先 `quoteOrder` → 生成订单号 →
   * `createOrderWithReservation(..., outTradeNo)` → 再把**同一个** `outTradeNo`
   * 连同 `amountMinor` 交给 adapter。反过来（先下单再冻结）会在"名额已满"时留下
   * 一个通道侧已经存在、用户还能扫码付款的订单 —— 那时我们没有对应的冻结金额，
   * 收也不是、拒也不是。
   *
   * 不传时 adapter 退回自己生成（向后兼容尚无冻结概念的旧调用方）；但那意味着
   * 这一单**没有**与之对应的冻结订单，只有旧路径才该这么做。
   */
  readonly outTradeNo?: string;
  /**
   * 账单上给用户看的商品名。不传时由 adapter 按 `priceId` 投影出默认值。
   *
   * ⚠️ 金额**不**从这里取，也不从 adapter 的价目表取 —— 只从 `amountMinor`。
   */
  readonly description?: string;
  /** 成功后的回跳地址。 */
  readonly successUrl: string;
  /** 取消后的回跳地址。 */
  readonly cancelUrl: string;
}

/**
 * 收银台形态。**二者之一是必然**，不假设只有重定向：
 * 微信 Native 返回二维码，MoR 返回重定向 URL。
 */
export type CheckoutResult =
  | { readonly redirectUrl: string; readonly qrCode?: undefined }
  | { readonly qrCode: string; readonly redirectUrl?: undefined };

/** `revokeEntitlement` 的入参。 */
export interface RevokeEntitlementInput {
  readonly externalSubscriptionId: string;
  /** 归一化后的原因，例如 `refund` / `chargeback` / `expired`。 */
  readonly reason: string;
  /** 触发时间（epoch 毫秒）。 */
  readonly occurredAt: number;
}

/**
 * `refund` 的入参。**金额是两个数，不是一个。**
 *
 * 🔴 为什么必须同时给"原单实付"与"本次退多少"：微信（以及支付宝 / Stripe 的
 * 部分退款）都要求 `refund ≤ total`，而这个 `total` 是**那一单的实付**。
 * 只传退款金额时，adapter 要么去查价目表（多一个价格事实源，正是 ADR-0018 §3.1
 * 要消灭的形状），要么把原价当 total（用了券的单会算错，见 `refund-policy.ts`
 * 里 `AMOUNT_UNVERIFIED` 那一条）。两个数都由调用方从**订单行**上取。
 */
export interface CreateRefundInput {
  /** 要退的那一单的商户订单号（`checkout_orders.out_trade_no`）。 */
  readonly outTradeNo: string;
  /**
   * 我方退款单号 —— **通道的幂等键**，由调用方生成、adapter 原样使用。
   *
   * 与下单侧同一个理由：回调（`REFUND.*`）只带这个号回锚，adapter 若另生成一个，
   * 库里冻的是 A、通道记的是 B ⇒ 到账通知永远对不上任何一行。
   */
  readonly outRefundNo: string;
  /** 本次退出的金额（最小单位整数）。只能等于订单的实付 —— 本仓不做部分退。 */
  readonly refundAmountMinor: number;
  /** 那一单的**实付**总额（最小单位整数）。 */
  readonly totalAmountMinor: number;
  /** 🔴 必填、无默认，理由同 `CreateCheckoutInput.currency`：数不带币种就不可比。 */
  readonly currency: Currency;
  /** 给通道 / 账单侧的理由文本。不参与任何判定。 */
  readonly reason?: string;
}

/**
 * 通道给出的退款终态。
 *
 * 🔴 这个词表**不是**我方的状态机（那在 `refund-store.ts` 的 `REFUND_STATUSES`）：
 * 这里只有通道会答复的四种。`SUCCESS` 与 `PROCESSING` 分开是必须的 ——
 * 只有 `SUCCESS` 才允许动权益，把 `PROCESSING` 当成成功会造成
 * "通道还没退钱、用户已经掉权益"，那与 ADR-0026 禁的是同一类半真状态。
 */
export type ProviderRefundStatus = 'processing' | 'success' | 'abnormal' | 'closed';

/** `refund` 的返回。`providerRefundId` 可空：某些通道在受理时不给号。 */
export interface RefundResult {
  readonly providerRefundId: string | null;
  readonly status: ProviderRefundStatus;
}

/**
 * 支付商 adapter。
 *
 * 🔴 只有这四个方法，且**没有任何"幂等"语义**。去重在 webhook 路由里由
 * `payment_events` 的复合唯一约束完成（先插入 → 冲突即返回 200 且无副作用）。
 */
export interface BillingAdapter {
  /** 该 adapter 对应的 provider 名（与 `NormalizedPaymentEvent.provider` 同值）。 */
  readonly provider: string;

  /**
   * 🔴 **这个通道能收哪些币种** —— 由 adapter 自己声明，收银台据此在**冻结之前**选通道。
   *
   * 为什么需要它，而不是"让 adapter 在 `createCheckout` 里抛"：收银台的顺序是
   * 「报价 → 冻结 → 下单」。等到 `createCheckout` 才拒，那张订单**已经落库**了
   * （随后被 `failOrder` 改成 `failed`）—— 用户换来的是一个 502 和一条无用的
   * 失败订单，而真实原因是"这台实例收不了这个币种"，本可以在冻结之前就说清楚。
   *
   * 🔴 **必填，空数组是合法且诚实的值**（`noop` 就是 `[]`：它不是通道，什么都收不了）。
   * 做成有默认值的可选字段会得到相反的效果：一个忘了声明的 adapter 会"什么都能收"，
   * 而那正是这个字段要防的事。
   *
   * ⚠️ 声明与实现必须一致：`createCheckout` 收到不在这个列表里的 `currency` 时
   * **必须拒**，否则收银台会按声明选它、adapter 却照收 —— 声明就成了装饰。
   */
  readonly supportedCurrencies: readonly Currency[];

  /**
   * 创建结账会话。
   *
   * ⚠️ 「无订阅的 provider」（支付宝 / 微信单次支付）也实现它，只是后续
   * 没有自动续费；这是抽象层**必须允许**的形态，不是缺实现。
   */
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult>;

  /**
   * 验签 + 归一化。
   *
   * 🔴 入参是**原始 body（Buffer）+ 全部 header**，不是一个签名字符串：
   * 微信（`timestamp\nnonce\nbody\n`）与 PayPal（`cert_url` + `transmission_sig`）
   * 只给签名字符串时**当场实现不了**。验签必须在这里、用这些原料完成。
   *
   * 🔴 验签失败必须返回 `{ ok: false }`，**不得抛异常** ——
   * 路由要能区分"攻击者伪造"与"我们自己崩了"。
   */
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): Promise<WebhookVerification>;

  /**
   * 把 provider 自家的状态字面量映射到我方统一枚举。
   *
   * ⚠️ **映射表是每个 adapter 的私有细节**，不要提取成共享表：
   * `paused` 在 Stripe 没有对应物、Creem 的 `scheduled_cancel` 与 LS 的
   * `on_trial` 需要归并 —— 这些差异正是最容易被"统一表"抹平而埋下 bug 的地方。
   * 返回 `null` = 该字面量没有语义对应（调用方按"无权益"处理）。
   */
  mapSubscriptionState(providerState: unknown): SubscriptionStatus | null;

  /**
   * 退款 / 拒付时的权益回收。
   *
   * 🔴 **只改权益状态，绝不删数据。** 见 `subscription-boundary.md` §2：
   * 「到期不许变成数据 hostage」、「服务端已有数据不许删」。
   *
   * ⚠️ **不要假设一定会收到拒付通知**：Lemon Squeezy 作为 MoR **自己吃掉拒付**，
   * 没有独立的 chargeback 事件 —— 权益回收必须有**定期对账兜底**，
   * 这是当前**已知的实现缺口**，不要假装它不存在（见 `noop.adapter.ts` 与
   * `webhook.routes.ts` 里的同一处注释）。
   */
  revokeEntitlement(input: RevokeEntitlementInput): Promise<void>;

  /**
   * 向通道发起退款。
   *
   * 🔴 **必填，不是可选方法。** 做成 `refund?()` 的话，调用方就必须写
   * `typeof adapter.refund === 'function'` 这类绕路，而那是 AGENTS §10 明确不许的
   * 形状（"测试桩缺接口时补桩，不在生产路径用可选调用绕过"）。
   * 一个**没有通道**的 adapter 的正确实现是：照收这个方法，然后
   * 抛 `BillingProviderNotConfiguredError` —— 见 `noop.adapter.ts`。
   *
   * 🔴 **不许在这一层动权益。** 这个方法只把请求发给通道；权益回收只发生在
   * 通道确认 `success` 之后（同步响应里的 `SUCCESS`，或 `REFUND.SUCCESS` 通知），
   * 且只有一个落点 `refund-store.ts#applyRefundResult`。
   * 把回收写进 adapter 会造出两个事实源：一个在通道答复里，一个在我们库里。
   */
  refund(input: CreateRefundInput): Promise<RefundResult>;
}
