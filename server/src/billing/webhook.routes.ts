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
 * ⚠️ **已知缺口**：拒付不一定有事件（MoR 自己吃掉拒付，见 `noop.adapter.ts`），
 * 所以真实权益回收还需要**定期对账**兜底。本轮没实现，因为选型未定稿。
 */
import { createHash } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { Logger } from '../logger';
import { ENTITLEMENT_AUDIT_EVENTS } from '../entitlement';
import { applyPaymentEvent } from './apply-event';
import type { ExistingSubscription } from './apply-event';
import { extendSubscriptionPeriod } from '@heyta/domain';
import {
  createBillingAdapterRegistry,
  DEFAULT_BILLING_ADAPTERS,
} from './registry';
import type { BillingAdapter, NormalizedPaymentEvent } from './types';

/** 本模块新增的审计事件名。`SUBSCRIPTION_CHANGED` 复用 entitlement 里的既有常量。 */
export const BILLING_AUDIT_EVENTS = {
  /** 重复投递被唯一约束挡住，未产生任何副作用。 */
  DUPLICATE: 'PAYMENT_EVENT_DUPLICATE',
  /** 验签失败（伪造 / 配置错误），未落任何行。 */
  VERIFICATION_FAILED: 'WEBHOOK_VERIFICATION_FAILED',
} as const;

export interface WebhookRoutesOptions {
  /**
   * 可注册的 adapter 列表。省略时只有空 provider（自托管默认）。
   * 🔴 测试通过它注入一个"有 secret 的假 adapter"，**不是真实 SDK**。
   */
  adapters?: readonly BillingAdapter[];
  /** 可注入时钟（epoch 毫秒）。默认 `Date.now`。 */
  now?: () => number;
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
        return reply.status(404).send({ error: 'Unknown billing provider' });
      }

      const rawBody = readRawBody(req.body);
      if (rawBody === null) {
        // 只可能是有人在本插件作用域外注册了别的解析器 —— 明确报错，
        // 而不是拿一个"看起来能验签"的空 buffer 继续。
        return reply.status(415).send({ error: 'Raw request body is required' });
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
        return reply.status(401).send({ error: 'Invalid webhook signature' });
      }

      const event = verification.event;
      const digest = digestPayload(rawBody);
      const receivedAt = now();

      let duplicate = false;
      let applied: Awaited<ReturnType<typeof applyPaymentEvent>> | undefined;

      try {
        applied = await prisma.$transaction(async (tx) => {
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

          // ② 占位成功才处理。
          const result = await applyPaymentEvent(event, {
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
            createSubscription: (data) => tx.subscription.create({ data }),
            updateSubscription: (id, data) =>
              tx.subscription.update({ where: { id }, data }),
            // 周期叠加的**唯一服务端实现**（本体在 packages/domain，跨包 import
            // 被硬约束挡住，故曾以镜像形式存在；现直接使用 @heyta/domain。
            extendPeriod: extendSubscriptionPeriod,
            now,
          });

          await tx.paymentEvent.update({
            where: { id: inserted.id },
            data: {
              processedAt: BigInt(now()),
              subscriptionId:
                result.status === 'applied' || result.status === 'stale'
                  ? result.subscriptionId
                  : null,
            },
          });

          return result;
        });
      } catch (err) {
        if (isDuplicatePaymentEventError(err)) {
          duplicate = true;
        } else {
          // 事务已整体回滚（含那条 PaymentEvent），支付商重投时会真正重试。
          // 这里必须让 5xx 冒出去，不能吞成 200 —— 那才是静默丢事件。
          throw err;
        }
      }

      if (duplicate || applied === undefined) {
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

      return reply.status(200).send({ received: true });
    },
  );
};

export type { NormalizedPaymentEvent };
