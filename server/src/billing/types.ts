/**
 * 支付商无关的 billing 抽象层：**类型与接口**。
 *
 * 设计依据：`docs/plans/subscription-provider-selection.md` §4
 * 「抽象层设计：能抽象什么、抽象不掉什么」。那份结论说得很清楚：
 *
 * - 接口**只暴露四个方法**（`createCheckout` / `verifyWebhook` /
 *   `mapSubscriptionState` / `revokeEntitlement`）；
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
  readonly oneTimeGrant?: { readonly periodDays: number } | null;
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
 * 支付商 adapter。
 *
 * 🔴 只有这四个方法，且**没有任何"幂等"语义**。去重在 webhook 路由里由
 * `payment_events` 的复合唯一约束完成（先插入 → 冲突即返回 200 且无副作用）。
 */
export interface BillingAdapter {
  /** 该 adapter 对应的 provider 名（与 `NormalizedPaymentEvent.provider` 同值）。 */
  readonly provider: string;

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
}
