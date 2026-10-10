/**
 * 支付商 webhook 端点：`POST /api/billing/webhooks/:provider`。
 *
 * 与 `apiRoutes` 并列注册（`server.ts` 里 `{ prefix: '/api/billing' }`）。
 *
 * 🔴 **不套 `authenticate`** —— 调用方是支付商的机器，没有 JWT；身份靠
 * **验签**（由 adapter 负责，见 `types.ts` 的 `WebhookVerification`）。
 *
 * 🔴 **幂等流程必须是"先插入、再处理"**：
 *
 *   收到事件 → 验签 → **尝试插入 `PaymentEvent`（靠 `(provider, providerEventId)`
 *   复合唯一约束）** → 插入成功才处理 → 插入冲突则**直接返回 200 且不做任何副作用**。
 *
 * 刻意**不用**"先查询有没有、再插入"那种写法：两步之间有竞态，重投会双开。
 * 唯一约束是唯一可靠的落点（`subscription-provider-selection.md` §4/§8）。
 *
 * 🔴 **重复投递必须回 200**：返回非 2xx 会让支付商一直重试
 * （Creem 会重投 5 次、Stripe 指数退避数天）。"已收到"才是它想听的结果。
 *
 * 🔴 **绝不存原始 payload**：只存 SHA-256 digest（可能含买家 PII）。
 *
 * 🔴 插入 + 处理 + 标记 `processedAt` 在**一个事务**里：处理失败时整个事务回滚，
 * 那条 `PaymentEvent` 也不会留下 —— 否则支付商重投会被当成"重复"而永远不再处理，
 * 事件被静默丢弃。这个形状同时避开了"为补偿而删审计行"。
 *
 * 🔴 **订单结算也在同一个事务里**（`settleOrderPaidInTransaction`），且**只在
 * 事件带商户订单号（`outTradeNo`）时发生**：
 *
 *   验签 → 插入 PaymentEvent → 有订单号？→ 结算那张 `checkout_orders`
 *        （比订单冻结的 `final_amount_minor`、把券的 `reserved` 转 `applied`）
 *        → 按**订单冻结的 SKU** 决定授予什么（而不是 adapter 的金额启发式）
 *        → 写订阅行 → 标记 processedAt
 *
 * 在这之前 `settleOrderPaid` **零生产调用方**：用户用了券下单、付了钱、权益也发了，
 * 但那笔订单永远停在 `pending`，券的 `reserved` 名额被一张已付款的订单永久占住。
 * 那条链的两个"钱上的决定"（金额、SKU）都留在没被调用的那一侧。
 *
 * ⚠️ **已知缺口**：拒付不一定有事件（MoR 自己吃掉拒付，见 `noop.adapter.ts`），
 * 所以真实权益回收还需要**定期对账**兜底。本轮没实现，因为选型未定稿。
 * 同理，本文件对"**本文件接线之前**就已经付过款、却从没被结算过"的存量订单不做
 * 回填 —— 那些订单的 `PaymentEvent` 已经落库，重投会被幂等约束挡住、不会补结算。
 * 那属于对账任务的范围，不是 webhook 的职责。
 */
import { createHash } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { Logger } from '../logger';
import { ENTITLEMENT_AUDIT_EVENTS } from '../entitlement';
import { applyPaymentEvent } from './apply-event';
import type {
  ApplyPaymentEventDeps,
  ExistingSubscription,
  PaymentEventApplyOutcome,
} from './apply-event';
import { extendSubscriptionPeriod, SUBSCRIPTION_PERIOD_DAYS } from '@heyta/domain';
import {
  createBillingAdapterRegistry,
  DEFAULT_BILLING_ADAPTERS,
} from './registry';
import { grantsForSku } from './price-book';
import { applyRefundResultInTransaction, type ApplyRefundResultOutcome } from './refund-store';
import {
  createPrismaSqlRunner,
  settleOrderPaidInTransaction,
} from './pricing-store';
import type {
  PrismaTransactionClient,
  SettleOrderOutcome,
  SqlRunner,
} from './pricing-store';
import type { BillingAdapter, NormalizedPaymentEvent } from './types';

/** 本模块新增的审计事件名。`SUBSCRIPTION_CHANGED` 复用 entitlement 里的既有常量。 */
export const BILLING_AUDIT_EVENTS = {
  /** 重复投递被唯一约束挡住，未产生任何副作用。 */
  DUPLICATE: 'PAYMENT_EVENT_DUPLICATE',
  /** 验签失败（伪造 / 配置错误），未落任何行。 */
  VERIFICATION_FAILED: 'WEBHOOK_VERIFICATION_FAILED',
  /**
   * 这张支付对应的 `checkout_orders` 行被**权威结算**了一次（或结算判定为不授予）。
   *
   * 与 `ENTITLEMENT_CHANGED` **分开**是刻意的：订单结算与权益授予是两件事，
   * 一笔 `amount-mismatch` 的支付会结算失败但**没有任何权益写入** ——
   * 只报后者会让"有一笔钱没能交付权益，原因在订单上"看不出来。
   */
  SETTLED: 'ORDER_SETTLED',
  /**
   * 一条**退款通知**被处理了一次（回收 / 只记状态 / 幂等命中 / 对不上账）。
   *
   * 与 `SETTLED` 分开是同一个理由的两半：那一条说"有一笔钱进来了，订单侧怎么判"，
   * 这一条说"有一笔钱出去了，权益侧怎么回"。把它们混成一个事件名，
   * 日志里就分不清"授予失败"与"回收失败" —— 而后者是要退钱给用户的。
   */
  REFUND_APPLIED: 'REFUND_APPLIED',
} as const;

export interface WebhookRoutesOptions {
  /**
   * 可注册的 adapter 列表。省略时只有空 provider（自托管默认）。
   * 🔴 测试通过它注入一个"有 secret 的假 adapter"，**不是真实 SDK**。
   */
  adapters?: readonly BillingAdapter[];
  /** 可注入时钟（epoch 毫秒）。默认 `Date.now`。 */
  now?: () => number;
  /**
   * 🔴 **测试缝**：把 Prisma 的**事务 client** 包成 `SqlRunner`。
   *
   * 生产默认就是 `createPrismaSqlRunner` —— 结算 SQL 因此跑在**当前这个事务**
   * 里，与 `tx.subscription.*` 的权益写入同生共死（这正是本模块要保证的）。
   *
   * 单测里 Prisma 是 mock 的、没有 `$queryRawUnsafe`，所以测试注入一个
   * **PGlite 支撑的 runner**：SQL 仍然是真的被 PostgreSQL 语义跑过一遍，
   * 只是与 mock 的订阅行分处两个存储。这个边界在
   * `billing-webhook.routes.spec.ts` 的文件头写明，不假装是同一条连接。
   */
  sqlRunner?: (tx: PrismaTransactionClient) => SqlRunner;
}

/** 原始 payload 的摘要。**这是唯一落库的 payload 派生信息。** */
const digestPayload = (rawBody: Buffer): string =>
  createHash('sha256').update(rawBody).digest('hex');

/**
 * 这个错误是不是**我们自己的** `(provider, providerEventId)` 唯一冲突。
 *
 * 结构化判定而非 `instanceof`，理由有二：
 * 1. 单测里 prisma 是 mock 的，`instanceof PrismaClientKnownRequestError` 不成立；
 * 2. **必须有字段级判据** —— `payment_events` 之外的 P2002（例如
 *    `subscriptions.external_subscription_id` 的竞态）不能被误判成"重复投递"，
 *    否则一次真实的订阅写入竞态会被当成幂等命中而静默吞掉。
 */
export const isDuplicatePaymentEventError = (err: unknown): boolean => {
  const candidate = err as { code?: unknown; meta?: { target?: unknown } } | null;
  if (candidate?.code !== 'P2002') return false;
  const target = candidate.meta?.target;
  const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return fields.includes('provider_event_id') || fields.includes('payment_events');
};

/** Fastify 的 `req.body` 在 `parseAs: 'buffer'` 之后就是原始字节。 */
const readRawBody = (body: unknown): Buffer | null =>
  Buffer.isBuffer(body) ? body : null;

/**
 * 订单结算结论 → 交给 `applyPaymentEvent` 的**有效事件**。
 *
 * ## 为什么需要这一层
 *
 * 一笔支付可能有**两个**"它买的是哪一档"的来源：
 *
 * 1. adapter 的金额启发式（`oneTimeGrant`："实付 = 某一档原价"）；
 * 2. **订单上冻结的 SKU**（`checkout_orders.price_id`）。
 *
 * 只要这一笔挂在一张我们冻结过的订单上，**只有 (2) 是权威的**：
 * (1) 对打折单会给出**错的档位，或给不出档位** —— ¥12 档用 ¥7 券实付 ¥5，
 * 而 ¥5 恰好是另一档的原价。所以这里用结算结论**覆盖** adapter 的声明，
 * 而不是两套并存（两套并存等于两套裁决标准）。
 *
 * ## 没有订单时**不动**事件
 *
 * 收银台一定会先建订单，所以"带订单号却查不到订单"（`unknown-order`）在正常
 * 路径上不该发生；真出现时它是**别人的单**（手工单 / 第三方），而我们没有比
 * adapter 的金额声明更权威的东西。这时原样返回事件（回落 + 审计），
 * 比"静默不授予"更诚实。`unknown-order` 因此是**唯一**一个保留原事件的不授予结论。
 *
 * ## 返回 `null` = 不写权益（fail-closed）
 *
 * 两种来源，**都不编一个档位出来**：
 * - 结算有结论但没授予（`already-paid` / `amount-mismatch` /
 *   `order-not-grantable`）；
 * - `granted` 但订单没记档位（`priceId === null`）或档位不在能力表里
 *   （`grantsForSku` 返回 `null`）。
 *
 * `already-paid` 也返回 `null` 是**幂等**的一部分：同一张订单的第二个事件
 * 不该把权益再发一次（周期会被重复叠加）。
 */
export const applySettlementToEvent = (
  event: NormalizedPaymentEvent,
  settlement: SettleOrderOutcome,
  periodDays: number = SUBSCRIPTION_PERIOD_DAYS,
): NormalizedPaymentEvent | null => {
  // 没有可裁决的订单 → 回落：这不是"收银台的支付"，沿用接线前的行为
  // （adapter 自己的 `oneTimeGrant`）。
  if (settlement.outcome === 'unknown-order') return event;
  if (settlement.outcome !== 'granted') return null;
  const priceId = settlement.priceId;
  if (priceId === null) return null;
  const grants = grantsForSku(priceId);
  if (grants === null) return null;
  return {
    ...event,
    // 档位与能力一起给（`OneTimeGrant` 的注释解释了为什么不能只给天数）。
    oneTimeGrant: { periodDays, priceId, grants: [...grants] },
    // 已经由订单权威判定过了，不再是"待结算"。
    requiresOrderSettlement: false,
  };
};

/**
 * Prisma 事务 client 上**权益写入所需的那个委托**。
 *
 * 用结构类型而不是 import Prisma 的具体类型：借方（webhook 的 `tx`）与
 * 对账（`reconcile.ts`）拿到的是同一个 Prisma 事务 client，但两处的类型
 * 推导来源不同。声明成"我只用这三件事"之后，两边都能原样传进来，
 * 而不会为了一个类型去 `as any`（那会让真正的不匹配静默）。
 */
export interface SubscriptionTxDelegate {
  findFirst(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
}

export interface SubscriptionTxClient {
  readonly subscription: SubscriptionTxDelegate;
}

/**
 * 把 Prisma 事务 client 接成 `ApplyPaymentEventDeps`。
 *
 * 🔴 **这是 webhook 与对账共用的唯一一份接线。** 它以前内联在路由里，
 * 于是"对账也要按同一套语义写权益"就必然要抄一份 —— 抄一份等于两套判定。
 */
export const buildSubscriptionApplyDeps = (
  tx: SubscriptionTxClient,
  now: () => number,
): ApplyPaymentEventDeps => ({
  findSubscription: (externalSubscriptionId) =>
    tx.subscription.findFirst({
      where: { externalSubscriptionId },
    }) as Promise<ExistingSubscription | null>,
  // 🔴 一次性支付（支付宝 / 微信）没有订阅 id，只能按 (userId, provider)
  // 定位那**一行长期复用**的订阅（`subscription-boundary.md` §6.2）。
  findSubscriptionByUser: (userId, provider) =>
    tx.subscription.findFirst({
      where: { userId, provider },
    }) as Promise<ExistingSubscription | null>,
  createSubscription: (data) => tx.subscription.create({ data }) as Promise<{ id: number }>,
  updateSubscription: (id, data) => tx.subscription.update({ where: { id }, data }),
  // 周期叠加的**唯一服务端实现**（本体在 packages/domain，跨包 import
  // 被硬约束挡住，故曾以镜像形式存在；现直接使用 @heyta/domain）。
  extendPeriod: extendSubscriptionPeriod,
  now,
});

/** `settleAndApplyEvent` 的返回。两半都可能为 `null`（各自代表"没做这一步"）。 */
export interface SettleAndApplyResult {
  readonly settlement: SettleOrderOutcome | null;
  readonly result: PaymentEventApplyOutcome | null;
}

export interface SettleAndApplyDeps {
  /** 事务内的 SQL 面 —— 结算必须与权益写入同生共死。 */
  readonly sql: SqlRunner;
  readonly subscriptions: ApplyPaymentEventDeps;
}

/**
 * 一笔**已验证**支付事件的完整业务应用：先按商户订单号做权威结算，再按结算
 * 结论写权益。
 *
 * 🔴 **webhook 与对账（`reconcile.ts`）共用这一份，不许各写一份。**
 * 到账 webhook 与"补结算历史订单"要做的是同一件事，差别只在**谁触发**与
 * **事务边界谁开**：
 *
 * - webhook：在它自己的 Prisma 事务里调它（`sql` = 那个事务的 runner）；
 * - 对账：为每张订单开一个 Prisma 事务，在事务里调它。
 *
 * 结算与权益写入必须落在**同一个**事务里：分开写会留下"权益发了、订单没结算
 * （券的 `reserved` 名额被永久占住）"或反之的半截状态。
 * `settleOrderPaidInTransaction` 收的是 `SqlRunner`（不是 `SqlExecutor`），
 * 正是为了能落进一个已经开着的事务。
 *
 * `settlement === null`（事件没有订单号）与 `result === null`（结算判定为
 * 不该/不能授予）是**两件事**，都由返回值如实带出，不合并成 `undefined`。
 */
export const settleAndApplyEvent = async (
  event: NormalizedPaymentEvent,
  deps: SettleAndApplyDeps,
): Promise<SettleAndApplyResult> => {
  let settlement: SettleOrderOutcome | null = null;
  if (event.outTradeNo != null) {
    if (event.paidAmountMinor != null) {
      settlement = await settleOrderPaidInTransaction(deps.sql, {
        outTradeNo: event.outTradeNo,
        providerEventId: event.providerEventId,
        paidAmountMinor: event.paidAmountMinor,
        now: deps.subscriptions.now(),
      });
    } else {
      // 有订单号却没有实付金额：没有可比的权威金额，fail-closed。
      // 订单留在 `pending`（会被 sweep 扫成 `expired`），不授予权益。
      Logger.error('webhook：带订单号的支付没有实付金额 —— 拒绝结算，不授予权益', {
        provider: event.provider,
        providerEventId: event.providerEventId,
        outTradeNo: event.outTradeNo,
      });
    }
  }

  // 权益写入。**不走两套判定**：
  // - 有订单且结算有结论 → 由结算结论决定（`applySettlementToEvent`
  //   返回 null = 不写；`unknown-order` 例外，见该函数注释）；
  // - 没有订单号（兼容路径 / 非收银台支付）→ 沿用 adapter 自己的授予声明。
  const eventForApply =
    event.outTradeNo == null
      ? event
      : settlement === null
        ? null
        : applySettlementToEvent(event, settlement);

  const result =
    eventForApply === null ? null : await applyPaymentEvent(eventForApply, deps.subscriptions);

  return { settlement, result };
};

export const webhookRoutes = async (
  fastify: FastifyInstance,
  options: WebhookRoutesOptions = {},
): Promise<void> => {
  const registry = createBillingAdapterRegistry(
    options.adapters ?? DEFAULT_BILLING_ADAPTERS,
  );
  const now = options.now ?? Date.now;

  // 🔴 验签需要**原始 body**：JSON.parse 会丢掉签名字节（键序 / 空白 / 编码）。
  // 与 `sync/sync.routes.ts` 的 `addContentTypeParser(..., { parseAs: 'buffer' })`
  // 同形：这里只把原始 buffer 交出去，解析由 adapter 自己决定。
  // 本插件作用域内的 parser 覆盖不泄漏到其它路由。
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body: Buffer, done) => {
      done(null, body);
    },
  );

  fastify.post<{ Params: { provider: string } }>(
    '/webhooks/:provider',
    {
      // 路由级限流：webhook 是公网无认证入口，必须防刷（同 api.ts 的写法）。
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const provider = req.params.provider;
      const adapter = registry.get(provider);

      // fail-closed：没注册的 provider 不接、不落行。
      if (adapter === undefined) {
        return reply.status(404).send({ code: 'unknown_billing_provider', message: 'Unknown billing provider' });
      }

      const rawBody = readRawBody(req.body);
      if (rawBody === null) {
        // 只可能是有人在本插件作用域外注册了别的解析器 —— 明确报错，
        // 而不是拿一个"看起来能验签"的空 buffer 继续。
        return reply.status(415).send({ code: 'raw_request_body_is_required', message: 'Raw request body is required' });
      }

      const verification = await adapter.verifyWebhook(rawBody, req.headers);

      // 🔴 验签失败**绝不落 `PaymentEvent`**：否则攻击者可以用垃圾请求
      // 把某个 eventId 提前占掉，真事件到达时被当成重复而丢弃。
      if (!verification.ok) {
        Logger.audit({
          event: BILLING_AUDIT_EVENTS.VERIFICATION_FAILED,
          userId: 0, // 还没有可归因的用户
          provider,
          reason: verification.reason,
          ip: req.ip,
        });
        return reply.status(401).send({ code: 'invalid_webhook_signature', message: 'Invalid webhook signature' });
      }

      const event = verification.event;
      const digest = digestPayload(rawBody);
      const receivedAt = now();

      let duplicate = false;
      // `null` = 这一笔**没有权益写入**（由订单结算判定为不该/不能授予），
      // 与 `duplicate` 是两回事，所以不再用 `undefined` 兼表后者。
      let applied: PaymentEventApplyOutcome | null = null;
      let settlement: SettleOrderOutcome | null = null;
      // 退款通知的处理结论。`null` = 这一条**不是**退款通知。
      let refundOutcome: ApplyRefundResultOutcome | null = null;

      try {
        const outcome = await prisma.$transaction(async (tx) => {
          // ① 先占位。唯一冲突在这里抛出 → 整个事务回滚 → 下面的 catch 判为重复。
          const inserted = await tx.paymentEvent.create({
            data: {
              provider: event.provider,
              providerEventId: event.providerEventId,
              eventType: event.eventType,
              payloadDigest: digest,
              occurredAt: Number.isFinite(event.occurredAt)
                ? BigInt(Math.trunc(event.occurredAt))
                : null,
              receivedAt: BigInt(receivedAt),
            },
            select: { id: true },
          });

          // ② + ③ 占位成功才处理：**结算 + 权益写入共用唯一一份业务逻辑**
          //    （`settleAndApplyEvent`，见其注释）。有商户订单号 = 这一笔挂在一张
          //    我们冻结过的 `checkout_orders` 上 → 权威结算在这里、在这个事务里。
          //
          //    🔴 结算与权益写入必须在同一个事务里：分开写会留下
          //    "权益发了、订单没结算（券的 `reserved` 名额被永久占住）"或反之的
          //    半截状态。`settleOrderPaidInTransaction` 收的是 `SqlRunner`（不是
          //    `SqlExecutor`），正是为了能落在这个已经开着的事务里。
          // 🔴 退款通知走**另一条**路，绝不进 `settleAndApplyEvent`。
          // 那条路的语义是"有一笔钱进来了 → 该授予什么"，而退款通知里**没有**新的钱；
          // 让它走进去的后果是 `applyPaymentEvent` 按"没有订阅引用"归成
          // `NO_SUBSCRIPTION_REFERENCE` 而**什么都不做** —— 钱退了、权益却不回来，
          // 且库里看起来像"这条事件本来就不该动权益"。
          // 声明式分流（`event.refundNotice`）与授予侧的 `oneTimeGrant` 是同一条纪律。
          const runner = (options.sqlRunner ?? createPrismaSqlRunner)(tx);
          let orderSettlement: SettleOrderOutcome | null = null;
          let result: PaymentEventApplyOutcome | null = null;
          let refund: ApplyRefundResultOutcome | null = null;
          if (event.refundNotice != null) {
            refund = await applyRefundResultInTransaction(runner, {
              outRefundNo: event.refundNotice.outRefundNo,
              status: event.refundNotice.status,
              providerRefundId: event.refundNotice.providerRefundId,
              now: now(),
            });
          } else {
            const settled = await settleAndApplyEvent(event, {
              sql: runner,
              subscriptions: buildSubscriptionApplyDeps(tx, now),
            });
            orderSettlement = settled.settlement;
            result = settled.result;
          }

          await tx.paymentEvent.update({
            where: { id: inserted.id },
            data: {
              processedAt: BigInt(now()),
              subscriptionId:
                result !== null &&
                (result.status === 'applied' || result.status === 'stale')
                  ? result.subscriptionId
                  : null,
            },
          });

          return { result, orderSettlement, refund };
        });
        applied = outcome.result;
        settlement = outcome.orderSettlement;
        refundOutcome = outcome.refund;
      } catch (err) {
        if (isDuplicatePaymentEventError(err)) {
          duplicate = true;
        } else {
          // 事务已整体回滚（含那条 PaymentEvent），支付商重投时会真正重试。
          // 这里必须让 5xx 冒出去，不能吞成 200 —— 那才是静默丢事件。
          throw err;
        }
      }

      if (duplicate) {
        Logger.audit({
          event: BILLING_AUDIT_EVENTS.DUPLICATE,
          userId: event.userId ?? 0,
          provider: event.provider,
          reason: 'duplicate-provider-event-id',
          providerEventId: event.providerEventId,
          ip: req.ip,
        });
        return reply.status(200).send({ received: true, duplicate: true });
      }

      // 结算审计。**独立于权益审计**：`amount-mismatch` / `already-paid` 这类
      // 结论必须能在日志里被查到"钱在订单这一侧发生了什么"。
      if (settlement !== null) {
        Logger.audit({
          event: BILLING_AUDIT_EVENTS.SETTLED,
          userId: event.userId ?? 0,
          provider: event.provider,
          providerEventId: event.providerEventId,
          outTradeNo: event.outTradeNo,
          outcome: settlement.outcome,
          orderId: 'orderId' in settlement ? settlement.orderId : undefined,
          ip: req.ip,
        });
        if (
          settlement.outcome === 'granted' &&
          (settlement.afterExpiry || settlement.quotaExceeded)
        ) {
          // 🔴 "到账晚于过期"与"名额超发"是**要告警**的，不是正常路径。
          // 授予照样发生了（用户真的付了钱），但运营必须知道。
          Logger.warn('webhook：订单结算出现需要关注的边界（已照常授予）', {
            orderId: settlement.orderId,
            afterExpiry: settlement.afterExpiry,
            quotaExceeded: settlement.quotaExceeded,
          });
        }
      }

      // 🔴 退款通知的审计。`unknown-refund` 必须能在日志里查到 —— 它的意思是
      // "通道退了一笔我们库里没有记录的钱"，那是需要人对账的事实，不是无事发生。
      if (refundOutcome !== null) {
        Logger.audit({
          event: BILLING_AUDIT_EVENTS.REFUND_APPLIED,
          // 退款通知**不带**用户归属（那是 `refunds` 那一行上的事实），
          // 而审计行的形状要求一个 userId —— 与 `SETTLED` 那条同一做法。
          userId: event.userId ?? 0,
          provider: event.provider,
          providerEventId: event.providerEventId,
          outRefundNo: event.refundNotice?.outRefundNo,
          outcome: refundOutcome.outcome,
          refundId: 'refundId' in refundOutcome ? refundOutcome.refundId : undefined,
          ip: req.ip,
        });
        if (refundOutcome.outcome === 'unknown-refund') {
          Logger.warn('webhook：收到一条对不上任何退款记录的通道通知（需要人工对账）', {
            provider: event.provider,
            outRefundNo: event.refundNotice?.outRefundNo,
            status: event.refundNotice?.status,
          });
        }
      }

      if (applied !== null) {
        Logger.audit({
          event: ENTITLEMENT_AUDIT_EVENTS.CHANGED,
          userId: event.userId ?? 0,
          provider: event.provider,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          outcome: applied.status,
          reason: applied.status === 'ignored' ? applied.reason : undefined,
          ip: req.ip,
        });
      }

      return reply.status(200).send({ received: true });
    },
  );
};

export type { NormalizedPaymentEvent };
