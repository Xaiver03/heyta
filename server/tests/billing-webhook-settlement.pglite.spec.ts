import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';

/**
 * webhook 的**结算路径**：真 Fastify + 真 SQL（PGlite）+ 只在两处打桩。
 *
 * 这个文件存在的理由是这条链在接线之前**根本没有生产调用方**：
 * `settleOrderPaid` 写好了、测试也有，但 webhook 从不调它 —— 于是用户用了券
 * 下单、付了钱、权益也发了，那笔 `checkout_orders` 却永远停在 `pending`，
 * 券的 `reserved` 名额被一张**已经付过款**的订单永久占住。
 *
 * ## 覆盖面（与它**不**覆盖的）
 *
 * ✅ 证明的：
 * - 结算真的发生在 webhook 的事务里：订单 `pending → paid`、核销
 *   `reserved → applied`；
 * - 授予按**订单冻结的 SKU**（`checkout_orders.price_id`），不是 adapter 的
 *   金额启发式 —— 后者对打折单会给出**错的档位**；
 * - adapter 给不出档位（`requiresOrderSettlement`）时，权威出路仍然存在；
 * - 金额对不上 → 不结算、不授予（fail-closed）；
 * - 重复投递 → 200 + 零副作用；同一订单的第二个事件不重复授予；
 * - 结算参与**调用方**的事务（外层回滚连它一起回滚）。
 *
 * ❌ **不**证明的：真实微信回执的报文形状（`wechat-adapter.spec.ts` 覆盖）、
 * 真实商户号与真实到账（没有凭证）。这里的 adapter 是 HMAC 假 adapter。
 *
 * ## 存储是**两个**
 *
 * Prisma 在本仓库的测试里是 mock 的（没有 `$queryRawUnsafe`），所以：
 * - 订单 / 券 / 核销的 SQL 跑在 **PGlite** 上（真 PostgreSQL 语义）；
 * - 订阅行写在一个**内存 mock** 上（与既有 `billing-webhook.routes.spec.ts` 同形）。
 *
 * 因此"同一个事务"这件事在这里只能证明到**接线层**：webhook 调的是
 * `settleOrderPaidInTransaction(tx-runner, …)` 而不是自己开事务的
 * `settleOrderPaid`；`SqlRunner` 的参与性由本文件的最后一个用例单独证明。
 * 生产里两者共用同一个 Prisma 事务，这一点没有被这组测试覆盖，如实写明。
 */

const TEST_SECRET = 'settlement-test-secret';
const PROVIDER = 'wechat';
const USER_ID = 7;
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const mocks = vi.hoisted(() => {
  const state = {
    seenPaymentEvents: new Set<string>(),
    paymentEventSeq: 0,
    subscriptions: new Map<string, Record<string, unknown>>(),
    subscriptionSeq: 0,
    subscriptionCreateCalls: 0,
    subscriptionUpdateCalls: 0,
  };
  const prisma = {
    paymentEvent: { create: vi.fn(), update: vi.fn() },
    subscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, state };
});

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));

import { webhookRoutes, BILLING_AUDIT_EVENTS, applySettlementToEvent } from '../src/billing/webhook.routes';
import type { WebhookRoutesOptions } from '../src/billing/webhook.routes';
import { Logger } from '../src/logger';
import {
  createOrderWithReservation,
  loadCoupons,
  loadCouponUsage,
  loadPriceOverrides,
  settleOrderPaidInTransaction,
  upsertCoupon,
  type SettleOrderOutcome,
  type SqlExecutor,
  type SqlRunner,
} from '../src/billing/pricing-store';
import {
  DEFAULT_PRICE_BOOK,
  SKU_GRANTS,
  grantsForSku,
} from '../src/billing/price-book';
import { quoteOrder } from '../src/billing/quote';
import { normalizeCouponCode, type CouponDefinition } from '../src/billing/coupon';
import type {
  BillingAdapter,
  CheckoutResult,
  CreateCheckoutInput,
  NormalizedPaymentEvent,
  OneTimeGrant,
  RevokeEntitlementInput,
  SubscriptionStatus,
  WebhookHeaders,
  WebhookVerification,
} from '../src/billing/types';
import { PRICING_SCHEMA_DDL, REFUND_SCHEMA_DDL } from './pricing-ddl.helper';
import { decideRefund, requestRefund } from '../src/billing/refund-store';

let db: PGlite;
let sql: SqlExecutor;
let runner: SqlRunner;
let app: FastifyInstance | undefined;
let auditSpy: MockInstance;
let errorSpy: MockInstance;

const createPgliteExecutor = (pglite: PGlite): SqlExecutor => {
  const inner: SqlRunner = {
    query: async <T>(query: string, params: readonly unknown[] = []): Promise<T[]> => {
      const res = await pglite.query(query, params as unknown[]);
      return res.rows as T[];
    },
    execute: async (query: string, params: readonly unknown[] = []): Promise<number> => {
      const res = await pglite.query(query, params as unknown[]);
      return res.affectedRows ?? 0;
    },
  };
  return {
    ...inner,
    transaction: async <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => {
      await pglite.exec('BEGIN');
      try {
        const result = await fn(inner);
        await pglite.exec('COMMIT');
        return result;
      } catch (error) {
        await pglite.exec('ROLLBACK');
        throw error;
      }
    },
  };
};

/** 假微信 adapter：HMAC 验签，事件的**一切**都由请求体决定。 */
interface TestPayload {
  eventId: string;
  outTradeNo: string;
  paidAmountMinor: number;
  userId?: number | null;
  occurredAt?: number;
  /** adapter 的金额启发式结论；`null` = 它给不出档位（真实里的打折单）。 */
  declaredPriceId: string | null;
  declaredGrants?: string[];
  /**
   * 🔴 有这一格 = 这条通知**不是**"有一笔钱进来了"，而是通道在告知一张退款的结果。
   * 真实 adapter 里它由 `event_type` 是 `REFUND.*` 推出来（`wechat.adapter.ts`），
   * 这里直接由请求体给，为的是把"路由看见 refundNotice 就走回收分支"这条接线钉住。
   */
  refundNotice?: {
    outRefundNo: string;
    providerRefundId: string | null;
    status: 'success' | 'abnormal' | 'closed';
  } | null;
}

const createTestAdapter = (): BillingAdapter => ({
  provider: PROVIDER,
  // 这个 fake 只用来测结算，收银台从不选它；声明 CNY 与真实 provider 一致。
  supportedCurrencies: ['CNY'],
  async createCheckout(_input: CreateCheckoutInput): Promise<CheckoutResult> {
    return { qrCode: 'weixin://wxpay/bizpayurl?pr=FAKE' };
  },
  async verifyWebhook(
    rawBody: Buffer,
    headers: WebhookHeaders,
  ): Promise<WebhookVerification> {
    const raw = headers['x-test-signature'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    const expected = createHmac('sha256', TEST_SECRET).update(rawBody).digest('hex');
    if (typeof provided !== 'string' || provided !== expected) {
      return { ok: false, reason: 'bad-signature' };
    }
    const parsed = JSON.parse(rawBody.toString('utf8')) as TestPayload;
    // 🔴 退款通知在这一支**先**出去，且带的是 `oneTimeGrant: null` + `userId: null`：
    // 它与"有一笔钱进来了"共用这张表，但下游动作完全相反（一个是发权益、一个是收权益）。
    // 让它落到下面那条路径的后果是 `NO_SUBSCRIPTION_REFERENCE` —— 什么都不做，
    // 而库里看起来像"这条事件本来就不该动权益"。
    if (parsed.refundNotice != null && parsed.refundNotice !== undefined) {
      const notice = parsed.refundNotice;
      return {
        ok: true,
        event: {
          provider: PROVIDER,
          // 幂等键带状态（与 `buildWechatRefundEventId` 同一形状）：
          // 同一笔退款的 ABNORMAL 之后转 SUCCESS 不能被前一条挡掉。
          providerEventId: `refund_${notice.status}:${notice.outRefundNo}`,
          eventType: `refund_${notice.status}`,
          occurredAt: parsed.occurredAt ?? NOW,
          externalSubscriptionId: null,
          status: null,
          currentPeriodEnd: null,
          userId: null,
          oneTimeGrant: null,
          outTradeNo: parsed.outTradeNo,
          paidAmountMinor: null,
          refundNotice: notice,
        },
      };
    }
    const grant: OneTimeGrant | null =
      parsed.declaredPriceId === null
        ? null
        : {
            periodDays: 30,
            priceId: parsed.declaredPriceId,
            grants: parsed.declaredGrants ?? grantsForSku(parsed.declaredPriceId) ?? [],
          };
    return {
      ok: true,
      event: {
        provider: PROVIDER,
        providerEventId: parsed.eventId,
        eventType: grant === null ? 'payment_amount_mismatch' : 'payment_succeeded',
        occurredAt: parsed.occurredAt ?? NOW,
        externalSubscriptionId: null,
        status: null,
        currentPeriodEnd: null,
        userId: parsed.userId ?? USER_ID,
        oneTimeGrant: grant,
        requiresOrderSettlement: grant === null,
        outTradeNo: parsed.outTradeNo,
        paidAmountMinor: parsed.paidAmountMinor,
      },
    };
  },
  mapSubscriptionState(_state: unknown): SubscriptionStatus | null {
    return null;
  },
  async revokeEntitlement(_input: RevokeEntitlementInput): Promise<void> {},
});

const sign = (body: string): string =>
  createHmac('sha256', TEST_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');

const eventBody = (overrides: Partial<TestPayload> & { outTradeNo: string }): string =>
  JSON.stringify({
    eventId: 'evt_1',
    paidAmountMinor: 500,
    declaredPriceId: 'hosted-monthly',
    occurredAt: NOW,
    ...overrides,
  });

const buildApp = async (options: WebhookRoutesOptions = {}): Promise<void> => {
  app = Fastify();
  await app.register(webhookRoutes, {
    prefix: '/api/billing',
    adapters: [createTestAdapter()],
    now: () => NOW,
    // 🔴 生产默认是 `createPrismaSqlRunner`；mock prisma 上没有原始查询，
    //    所以这里注入一个 **PGlite 支撑的 runner**。
    sqlRunner: () => runner,
    ...options,
  });
  await app.ready();
};

const deliver = (body: string) =>
  app!.inject({
    method: 'POST',
    url: `/api/billing/webhooks/${PROVIDER}`,
    headers: { 'content-type': 'application/json', 'x-test-signature': sign(body) },
    payload: body,
  });

const couponDef = (overrides: Partial<CouponDefinition> = {}): CouponDefinition => ({
  id: 'launch',
  code: 'LAUNCH',
  name: '上线推广',
  benefit: { kind: 'fixed', amountOffMinor: 100 },
  currency: 'CNY',
  priceIds: null,
  validFrom: 0,
  validUntil: NOW + 30 * 24 * HOUR,
  maxRedemptions: null,
  maxRedemptionsPerUser: null,
  minimumOrderMinor: null,
  firstPurchaseOnly: false,
  regions: null,
  enabled: true,
  ...overrides,
});

/** 真报价 + 真冻结：订单与券的预留都按生产路径落进 PGlite。 */
const placeOrder = async (
  priceId: string,
  options: { readonly coupon?: CouponDefinition; readonly outTradeNo: string; readonly now?: number },
) => {
  const now = options.now ?? NOW;
  if (options.coupon !== undefined) {
    await upsertCoupon(sql, {
      definition: options.coupon,
      actor: 'test',
      note: '测试',
      now,
    });
  }
  const codes = options.coupon === undefined ? [] : [options.coupon.code];
  const { coupons } = await loadCoupons(sql);
  const usage = await loadCouponUsage(
    sql,
    codes.map(normalizeCouponCode).flatMap((c) => {
      const hit = coupons.find((x) => x.code === c);
      return hit === undefined ? [] : [hit.id];
    }),
    USER_ID,
  );
  const quote = quoteOrder(
    { priceId, currency: 'CNY', region: 'CN', candidateCodes: codes, usageByCouponId: usage },
    {
      baseline: DEFAULT_PRICE_BOOK,
      overrides: await loadPriceOverrides(sql),
      couponsByCode: new Map(coupons.filter((c) => c.code !== null).map((c) => [c.code!, c])),
      now,
    },
  );
  const created = await createOrderWithReservation(sql, {
    userId: USER_ID,
    provider: PROVIDER,
    outTradeNo: options.outTradeNo,
    quote,
    now,
  });
  return { quote, ...created };
};

const orderRow = async (outTradeNo: string) => {
  const rows = await sql.query<{ status: string; price_id: string; final_amount_minor: number }>(
    `SELECT status, price_id, final_amount_minor FROM checkout_orders WHERE out_trade_no = $1`,
    [outTradeNo],
  );
  return rows[0] ?? null;
};

const redemptionState = async (orderId: number) => {
  const rows = await sql.query<{ state: string }>(
    `SELECT state FROM coupon_redemptions WHERE order_id = $1`,
    [orderId],
  );
  return rows.map((r) => r.state);
};

beforeAll(async () => {
  db = new PGlite();
  // 退款那两张表也建在这里：本文件下半部分要证明 webhook 的**退款分支**真的走回收，
  // 而回收是对 `refunds` + `subscriptions` 两张表做真 SQL。
  await db.exec(`${PRICING_SCHEMA_DDL}\n${REFUND_SCHEMA_DDL}`);
  sql = createPgliteExecutor(db);
  runner = { query: sql.query, execute: sql.execute };
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(
    'DELETE FROM refunds; DELETE FROM subscriptions; DELETE FROM coupon_redemptions;' +
      ' DELETE FROM checkout_orders; DELETE FROM coupons; DELETE FROM price_versions;' +
      ' DELETE FROM pricing_audit_log; DELETE FROM users;',
  );
  await db.exec(
    `INSERT INTO users (id, email) VALUES (${USER_ID}, 'buyer@example.test') ON CONFLICT DO NOTHING`,
  );

  vi.clearAllMocks();
  auditSpy = vi.spyOn(Logger, 'audit').mockImplementation(() => {});
  errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});

  mocks.state.seenPaymentEvents.clear();
  mocks.state.paymentEventSeq = 0;
  mocks.state.subscriptions.clear();
  mocks.state.subscriptionSeq = 0;
  mocks.state.subscriptionCreateCalls = 0;
  mocks.state.subscriptionUpdateCalls = 0;

  mocks.prisma.$transaction.mockImplementation(
    (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.prisma),
  );
  mocks.prisma.paymentEvent.create.mockImplementation(
    (args: { data: { provider: string; providerEventId: string } }) => {
      const key = `${args.data.provider}:${args.data.providerEventId}`;
      if (mocks.state.seenPaymentEvents.has(key)) {
        throw { code: 'P2002', meta: { target: ['provider', 'provider_event_id'] } };
      }
      mocks.state.seenPaymentEvents.add(key);
      mocks.state.paymentEventSeq += 1;
      return Promise.resolve({ id: mocks.state.paymentEventSeq });
    },
  );
  mocks.prisma.paymentEvent.update.mockResolvedValue({});
  mocks.prisma.subscription.findFirst.mockImplementation(
    (args: { where: { externalSubscriptionId?: string; userId?: number } }) => {
      if (args.where.externalSubscriptionId !== undefined) {
        return Promise.resolve(
          mocks.state.subscriptions.get(String(args.where.externalSubscriptionId)) ?? null,
        );
      }
      if (args.where.userId !== undefined) {
        const row = [...mocks.state.subscriptions.values()].find(
          (candidate) => candidate.userId === args.where.userId,
        );
        return Promise.resolve(row ?? null);
      }
      return Promise.resolve(null);
    },
  );
  mocks.prisma.subscription.create.mockImplementation(
    (args: { data: Record<string, unknown> }) => {
      mocks.state.subscriptionCreateCalls += 1;
      mocks.state.subscriptionSeq += 1;
      const row = { id: mocks.state.subscriptionSeq, ...args.data };
      mocks.state.subscriptions.set(String(args.data.externalSubscriptionId), row);
      return Promise.resolve(row);
    },
  );
  mocks.prisma.subscription.update.mockImplementation(
    (args: { where: { id: number }; data: Record<string, unknown> }) => {
      mocks.state.subscriptionUpdateCalls += 1;
      for (const [key, row] of mocks.state.subscriptions) {
        if (row.id === args.where.id) {
          const next = { ...row, ...args.data };
          mocks.state.subscriptions.set(key, next);
          return Promise.resolve(next);
        }
      }
      return Promise.resolve({});
    },
  );

  await buildApp();
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
  auditSpy.mockRestore();
  errorSpy.mockRestore();
});

const onlySubscription = () => [...mocks.state.subscriptions.values()][0]!;

describe('webhook 结算路径 —— 订单与券', () => {
  it('🔴 用券的单：订单真的被结算、券的 reserved 名额转成 applied，且 grant 来自订单冻结的 SKU', async () => {
    // 这一条同时钉住两件事：
    //   ① 结算真的发生了（接线之前订单永远停在 pending、名额永远占着）；
    //   ② 授予用的档位来自**订单**。adapter 看到的实付是 ¥5（¥12 用 ¥7 券），
    //      而 ¥5 恰好是 `hosted-monthly` 的原价 —— 它的启发式会授予**错的档位**
    //      （只有 hosting，丢掉 ai）。订单冻结的是 `hosted-ai-monthly`。
    const placed = await placeOrder('hosted-ai-monthly', {
      coupon: couponDef({ benefit: { kind: 'fixed', amountOffMinor: 700 } }),
      outTradeNo: 'hy-settle-1',
    });
    expect(placed.quote.finalAmountMinor).toBe(500);

    const res = await deliver(
      eventBody({
        outTradeNo: 'hy-settle-1',
        paidAmountMinor: 500,
        // adapter 的（错的）启发式：500 == hosted-monthly 原价。
        declaredPriceId: 'hosted-monthly',
        declaredGrants: ['hosting'],
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    // ① 订单推进到 paid；券的预留转成已核销。
    expect((await orderRow('hy-settle-1'))?.status).toBe('paid');
    expect(await redemptionState(placed.orderId)).toEqual(['applied']);

    // ② 权威档位来自订单。
    const subscription = onlySubscription();
    expect(subscription.priceId).toBe('hosted-ai-monthly');
    expect(subscription.grants).toEqual([...SKU_GRANTS['hosted-ai-monthly']!]);
    expect(subscription.status).toBe('active');
    // 对照：adapter 声明的那一档确实更小 —— 证明这条断言不是"两条路恰好同值"。
    expect(subscription.grants).not.toEqual(['hosting']);
  });

  it('🔴 adapter 给不出档位（requiresOrderSettlement）时，订单是权威出路', async () => {
    // ¥5 档用 ¥2 券 → 实付 ¥3，落不到任何档位原价上。接线之前这条路径
    // `applyPaymentEvent` 返回 REQUIRES_ORDER_SETTLEMENT，**权益一个字节都不写**。
    const placed = await placeOrder('hosted-monthly', {
      coupon: couponDef({ benefit: { kind: 'fixed', amountOffMinor: 200 } }),
      outTradeNo: 'hy-settle-2',
    });
    expect(placed.quote.finalAmountMinor).toBe(300);

    const res = await deliver(
      eventBody({
        outTradeNo: 'hy-settle-2',
        paidAmountMinor: 300,
        declaredPriceId: null,
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    expect((await orderRow('hy-settle-2'))?.status).toBe('paid');
    expect(await redemptionState(placed.orderId)).toEqual(['applied']);

    const subscription = onlySubscription();
    expect(subscription.priceId).toBe('hosted-monthly');
    expect(subscription.grants).toEqual(['hosting']);
    expect(subscription.status).toBe('active');
  });

  it('🔴 带订单号但订单不存在：回落到适配器声明（不是静默不授予）', async () => {
    // 收银台一定先建订单；"有订单号却查不到订单"意味着这不是收银台的支付
    // （手工单 / 第三方）。这时没有比 adapter 的金额声明更权威的东西，
    // 所以沿用接线前的行为，而不是把它当成"金额对不上"。
    const res = await deliver(
      eventBody({ outTradeNo: 'hy-not-ours', paidAmountMinor: 500, declaredPriceId: 'hosted-monthly' }),
    );

    expect(res.statusCode).toBe(200);
    expect([...mocks.state.subscriptions.values()]).toHaveLength(1);
    expect(onlySubscription().priceId).toBe('hosted-monthly');
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: BILLING_AUDIT_EVENTS.SETTLED,
        outcome: 'unknown-order',
        outTradeNo: 'hy-not-ours',
      }),
    );
  });

  it('🔴 金额对不上 → 订单不结算、不授予（fail-closed），并留下结算审计', async () => {
    const placed = await placeOrder('hosted-monthly', { outTradeNo: 'hy-settle-3' });

    const res = await deliver(
      eventBody({ outTradeNo: 'hy-settle-3', paidAmountMinor: 400 }),
    );

    expect(res.statusCode).toBe(200);
    // 订单仍然 pending（可以在支付窗口内被 sweep 扫成 expired），没有被误判成已付。
    expect((await orderRow('hy-settle-3'))?.status).toBe('pending');
    expect(await redemptionState(placed.orderId)).toEqual([]);
    // 没有任何权益写入。
    expect(mocks.state.subscriptionCreateCalls).toBe(0);
    expect(mocks.state.subscriptionUpdateCalls).toBe(0);
    expect(mocks.prisma.subscription.create).not.toHaveBeenCalled();

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: BILLING_AUDIT_EVENTS.SETTLED,
        outcome: 'amount-mismatch',
        outTradeNo: 'hy-settle-3',
      }),
    );
  });
});

describe('webhook 结算路径 —— 幂等', () => {
  it('🔴 同一事件重复投递：第二次 200 + duplicate，订单与权益都只处理一次', async () => {
    await placeOrder('hosted-monthly', {
      coupon: couponDef({ benefit: { kind: 'fixed', amountOffMinor: 200 } }),
      outTradeNo: 'hy-settle-4',
    });
    const body = eventBody({
      outTradeNo: 'hy-settle-4',
      paidAmountMinor: 300,
      declaredPriceId: null,
    });

    const first = await deliver(body);
    const second = await deliver(body);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true });
    expect(second.json()).toEqual({ received: true, duplicate: true });

    // 结算幂等：状态是终态，不会被"再结算一次"改写。
    expect((await orderRow('hy-settle-4'))?.status).toBe('paid');
    // 权益只写一次。
    expect(mocks.state.subscriptionCreateCalls).toBe(1);
    expect(mocks.state.subscriptionUpdateCalls).toBe(0);
    // 重复投递不落"已结算"审计之外的第二次副作用。
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: BILLING_AUDIT_EVENTS.DUPLICATE }),
    );
  });

  it('🔴 同一订单的**第二个**事件：结算判为 already-paid，不重复授予（周期不叠加）', async () => {
    await placeOrder('hosted-monthly', {
      coupon: couponDef({ benefit: { kind: 'fixed', amountOffMinor: 200 } }),
      outTradeNo: 'hy-settle-5',
    });

    const first = await deliver(
      eventBody({
        eventId: 'evt_a',
        outTradeNo: 'hy-settle-5',
        paidAmountMinor: 300,
        declaredPriceId: null,
      }),
    );
    // 第二个事件：不同的 providerEventId（P2002 挡不住），但指向同一张订单。
    const second = await deliver(
      eventBody({
        eventId: 'evt_b',
        outTradeNo: 'hy-settle-5',
        paidAmountMinor: 300,
        declaredPriceId: null,
        occurredAt: NOW + 1000,
      }),
    );

    expect(first.json()).toEqual({ received: true });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ received: true });

    expect((await orderRow('hy-settle-5'))?.status).toBe('paid');
    // 授予只发生一次 —— 第二笔被 `already-paid` 挡住，没有再次加 30 天。
    expect(mocks.state.subscriptionCreateCalls).toBe(1);
    expect(mocks.state.subscriptionUpdateCalls).toBe(0);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: BILLING_AUDIT_EVENTS.SETTLED,
        outcome: 'already-paid',
      }),
    );
  });
});

describe('结算的事务参与性（`SqlRunner` 那一层）', () => {
  it('🔴 `settleOrderPaidInTransaction` 随调用方的事务一起回滚', async () => {
    // 生产里它跑在 webhook 的 Prisma 事务里；这里用 PGlite 的事务证明它
    // **不会自己开事务**：如果实现改成 `sql.transaction(...)`，它会在外层抛错
    // 之前先提交，下面两条断言立刻变红。
    const placed = await placeOrder('hosted-monthly', { outTradeNo: 'hy-settle-6' });

    await expect(
      sql.transaction(async (tx) => {
        const outcome = await settleOrderPaidInTransaction(tx, {
          outTradeNo: 'hy-settle-6',
          providerEventId: 'evt_rollback',
          paidAmountMinor: 500,
          now: NOW,
        });
        expect(outcome.outcome).toBe('granted');
        throw new Error('外层事务失败');
      }),
    ).rejects.toThrow('外层事务失败');

    // 回滚后：订单仍是 pending，没有任何已核销行。
    expect((await orderRow('hy-settle-6'))?.status).toBe('pending');
    expect(await redemptionState(placed.orderId)).toEqual([]);
    // 也没有留下任何审计行（审计与更新同属一个事务）。
    const audits = await sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pricing_audit_log',
    );
    expect(Number(audits[0]?.n)).toBe(0);
  });

  it('🔴 结算落在 webhook 的事务里：事务失败时订单与审计一起回滚', async () => {
    // 这是"同一事务"的端到端证据：让 mock 的 `$transaction` 真的驱动 PGlite 的
    // BEGIN/COMMIT/ROLLBACK，再让事务在**结算之后、结束之前**失败
    // （`paymentEvent.update` 写 processedAt 失败）。
    // 如果接线把结算放到 `$transaction` 外面，PGlite 会自行提交 → 订单变 paid → 红。
    const placed = await placeOrder('hosted-monthly', {
      coupon: couponDef({ benefit: { kind: 'fixed', amountOffMinor: 200 } }),
      outTradeNo: 'hy-settle-8',
    });
    mocks.prisma.paymentEvent.update.mockRejectedValueOnce(new Error('processedAt 写失败'));
    // 清掉建单/发券留下的审计，让"有没有结算审计"是从 0 开始的对照。
    await db.exec('DELETE FROM pricing_audit_log');
    mocks.prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        await db.exec('BEGIN');
        try {
          const result = await fn(mocks.prisma);
          await db.exec('COMMIT');
          return result;
        } catch (error) {
          await db.exec('ROLLBACK');
          throw error;
        }
      },
    );

    const res = await deliver(
      eventBody({ outTradeNo: 'hy-settle-8', paidAmountMinor: 300, declaredPriceId: null }),
    );

    // 非 2xx → 支付商会重投。整笔处理失败时**不能**吞成 200。
    expect(res.statusCode).toBe(500);
    // 🔴 结算的三处写入（订单 / 核销 / 审计）随外层一起回滚。
    expect((await orderRow('hy-settle-8'))?.status).toBe('pending');
    // 券的预留**还在**（下单时就写好了），但**没有**被推进到 applied。
    expect(await redemptionState(placed.orderId)).toEqual(['reserved']);
    const audits = await sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pricing_audit_log',
    );
    expect(Number(audits[0]?.n)).toBe(0);
  });

  it('`granted` 结论带回订单冻结的档位（调用方据此决定授予什么）', async () => {
    await placeOrder('hosted-monthly', { outTradeNo: 'hy-settle-7' });
    const outcome = await sql.transaction((tx) =>
      settleOrderPaidInTransaction(tx, {
        outTradeNo: 'hy-settle-7',
        providerEventId: 'evt_price',
        paidAmountMinor: 500,
        now: NOW,
      }),
    );
    expect(outcome).toEqual({
      outcome: 'granted',
      orderId: expect.any(Number),
      userId: USER_ID,
      priceId: 'hosted-monthly',
      afterExpiry: false,
      quotaExceeded: false,
    });
  });
});

/** `applySettlementToEvent` 的分支表：每一种结算结论 → 有效事件。 */
describe('`applySettlementToEvent` 逐结论的分支', () => {
  const event = (): NormalizedPaymentEvent => ({
    provider: PROVIDER,
    providerEventId: 'evt_unit',
    eventType: 'payment_succeeded',
    occurredAt: NOW,
    externalSubscriptionId: null,
    status: null,
    currentPeriodEnd: null,
    userId: USER_ID,
    // adapter 声明了**错的**档位 —— 结算结论必须覆盖它。
    oneTimeGrant: { periodDays: 30, priceId: 'hosted-monthly', grants: ['hosting'] },
    requiresOrderSettlement: false,
    outTradeNo: 'hy-unit',
    paidAmountMinor: 500,
  });

  const granted = (priceId: string | null): SettleOrderOutcome => ({
    outcome: 'granted',
    orderId: 1,
    userId: USER_ID,
    priceId,
    afterExpiry: false,
    quotaExceeded: false,
  });

  it('granted：用订单冻结的 SKU 覆盖 adapter 的档位与能力', () => {
    const result = applySettlementToEvent(event(), granted('hosted-ai-monthly'));
    expect(result?.oneTimeGrant).toEqual({
      periodDays: 30,
      priceId: 'hosted-ai-monthly',
      grants: ['hosting', 'ai', 'automation'],
    });
    expect(result?.requiresOrderSettlement).toBe(false);
  });

  it('granted 但订单没记档位 → null（不编一个档位出来）', () => {
    expect(applySettlementToEvent(event(), granted(null))).toBeNull();
  });

  it('granted 但档位不在能力表里 → null（不猜能力）', () => {
    expect(applySettlementToEvent(event(), granted('ghost-sku'))).toBeNull();
  });

  it('already-paid / amount-mismatch / order-not-grantable → null（不写权益）', () => {
    expect(
      applySettlementToEvent(event(), { outcome: 'already-paid', orderId: 1, userId: USER_ID }),
    ).toBeNull();
    expect(
      applySettlementToEvent(event(), {
        outcome: 'amount-mismatch',
        orderId: 1,
        userId: USER_ID,
        expectedMinor: 500,
        actualMinor: 400,
      }),
    ).toBeNull();
    expect(
      applySettlementToEvent(event(), {
        outcome: 'order-not-grantable',
        orderId: 1,
        userId: USER_ID,
        status: 'refunded',
      }),
    ).toBeNull();
  });

  it('unknown-order → 原样返回同一个事件（没有订单可裁决）', () => {
    const input = event();
    const result = applySettlementToEvent(input, {
      outcome: 'unknown-order',
      outTradeNo: 'hy-unit',
    });
    expect(result).toBe(input);
  });
});

/**
 * 🔴 退款通知在 webhook 里的分流（ADR-0053）。
 *
 * 这一组存在的理由：`refund-store.ts` 的回收逻辑自己已经被
 * `billing-refund-store.pglite.spec.ts` 钉住了，但"**路由看见 `refundNotice` 就走回收、
 * 不走授予**"这条接线在两边都没有证据。它坏了以后的症状非常安静：通道退完了钱、
 * 我们落了一条 `payment_events`、`refunds` 那一行永远停在 `processing`、
 * 用户的权益一格都不动 —— 而全部单测都是绿的。
 *
 * ⚠️ 这里的存储是**两个**（文件头写明的那条边界）：授予落内存 mock 的订阅行，
 * 回收走 PGlite 上那张 `subscriptions` 替身。所以这组用例证明的是**分流与幂等**，
 * 不是"回收读到的正是授予写过的那一行" —— 后者在生产里由同一个数据库保证，
 * 在这里没有跨存储的通道可证，不假装。
 */
describe('webhook 退款分支 —— 通知走回收，不走授予', () => {
  const DAY = 24 * HOUR;

  /** 一张已经付过款的单 + 一行有 45 天未来的订阅（回收要动的东西）。 */
  const paidOrderWithEntitlement = async (outTradeNo: string) => {
    const placed = await placeOrder('hosted-monthly', { outTradeNo });
    const delivered = await deliver(
      eventBody({ outTradeNo, paidAmountMinor: placed.quote.finalAmountMinor }),
    );
    expect(delivered.statusCode).toBe(200);
    await sql.execute(
      `INSERT INTO subscriptions (user_id, provider, status, current_period_end, last_event_at, updated_at)
       VALUES ($1, 'wechat', 'active', $2, $3, $3)`,
      [USER_ID, NOW + 45 * DAY, NOW],
    );
    return placed;
  };

  const approvedRefund = async (orderId: number) => {
    const request = await requestRefund(sql, { orderId, now: NOW, actor: 'admin:1' });
    if (request.outcome !== 'requested') throw new Error(`测试前提不成立：${request.outcome}`);
    const decided = await decideRefund(sql, {
      refundId: request.refundId,
      decision: 'approve',
      actor: 'admin:1',
      note: '批准',
      now: NOW,
    });
    if (decided.outcome !== 'decided') throw new Error(`测试前提不成立：${decided.outcome}`);
    return request;
  };

  const refundNoticeBody = (outRefundNo: string, status: 'success' | 'abnormal' | 'closed') =>
    eventBody({
      outTradeNo: 'hy-refund-hook-1',
      paidAmountMinor: 500,
      declaredPriceId: null,
      eventId: `refund_${status}:${outRefundNo}`,
      refundNotice: { outRefundNo, providerRefundId: '5030000000000000000000000009', status },
    });

  const readRefundRow = async (outRefundNo: string) => {
    const rows = await sql.query<{ status: string; refunded_at: bigint | number | null }>(
      `SELECT status, refunded_at FROM refunds WHERE out_refund_no = $1`,
      [outRefundNo],
    );
    return rows[0] ?? null;
  };

  const readEntitlementEnd = async (): Promise<number | null> => {
    const rows = await sql.query<{ current_period_end: bigint | number | null }>(
      `SELECT current_period_end FROM subscriptions WHERE user_id = $1 LIMIT 1`,
      [USER_ID],
    );
    const value = rows[0]?.current_period_end;
    return value === null || value === undefined ? null : Number(value);
  };

  const auditCalls = (): Record<string, unknown>[] =>
    (auditSpy.mock.calls as unknown as [Record<string, unknown>[]][]).map((c) => c[0]);

  it('🔴 success 通知：订单转 refunded、那一段被回收，而授予侧一格都没被调用', async () => {
    const placed = await paidOrderWithEntitlement('hy-refund-hook-1');
    const { outRefundNo } = await approvedRefund(placed.orderId);
    const createCallsBefore = mocks.state.subscriptionCreateCalls;
    const updateCallsBefore = mocks.state.subscriptionUpdateCalls;

    const res = await deliver(refundNoticeBody(outRefundNo, 'success'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    expect(await readRefundRow(outRefundNo)).toMatchObject({
      status: 'success',
    });
    expect(Number((await readRefundRow(outRefundNo))!.refunded_at)).toBe(NOW);
    expect((await orderRow('hy-refund-hook-1'))?.status).toBe('refunded');
    // 唯一一笔已付订单被翻掉 ⇒ 剩余 0 笔 ⇒ 到期日落到 now。
    expect(await readEntitlementEnd()).toBe(NOW);

    // 🔴 这一组里最关键的两行：退款通知**绝不**碰授予层。
    expect(mocks.state.subscriptionCreateCalls).toBe(createCallsBefore);
    expect(mocks.state.subscriptionUpdateCalls).toBe(updateCallsBefore);

    const refundAudit = auditCalls().find((c) => c.event === BILLING_AUDIT_EVENTS.REFUND_APPLIED);
    expect(refundAudit).toMatchObject({ outcome: 'retracted', outRefundNo });
    // 审计里的 userId 不是从通知推的（通知里没有它），而是 `event.userId ?? 0` ——
    // 记成 0 是**如实**，随便填一个才是事故。
    expect(refundAudit).toMatchObject({ userId: 0 });
  });

  it('同一条通知重投：第二次按重复事件处理，`refunded_at` 不再变', async () => {
    const placed = await paidOrderWithEntitlement('hy-refund-hook-2');
    const { outRefundNo } = await approvedRefund(placed.orderId);
    expect((await deliver(refundNoticeBody(outRefundNo, 'success'))).statusCode).toBe(200);
    const first = await readRefundRow(outRefundNo);

    const second = await deliver(refundNoticeBody(outRefundNo, 'success'));
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ received: true, duplicate: true });
    expect(await readRefundRow(outRefundNo)).toEqual(first);
  });

  it('🔴 `abnormal` 通知一格权益都不动（订单必须还是 paid）', async () => {
    const placed = await paidOrderWithEntitlement('hy-refund-hook-3');
    const { outRefundNo } = await approvedRefund(placed.orderId);
    const before = await readEntitlementEnd();

    expect((await deliver(refundNoticeBody(outRefundNo, 'abnormal'))).statusCode).toBe(200);
    expect((await readRefundRow(outRefundNo))?.status).toBe('abnormal');
    expect((await orderRow('hy-refund-hook-3'))?.status).toBe('paid');
    expect(await readEntitlementEnd()).toBe(before);
    expect(auditCalls().find((c) => c.event === BILLING_AUDIT_EVENTS.REFUND_APPLIED)).toMatchObject({
      outcome: 'recorded',
    });
  });

  it('库里对不上任何退款行的通知：200 + 响亮 warn，不静默、也不改任何一行', async () => {
    await paidOrderWithEntitlement('hy-refund-hook-4');
    const before = await readEntitlementEnd();
    const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});

    const res = await deliver(refundNoticeBody('hyrf999x0000000000xdeadbeef', 'success'));
    expect(res.statusCode).toBe(200);
    expect(await readEntitlementEnd()).toBe(before);
    expect((await orderRow('hy-refund-hook-4'))?.status).toBe('paid');
    expect(auditCalls().find((c) => c.event === BILLING_AUDIT_EVENTS.REFUND_APPLIED)).toMatchObject({
      outcome: 'unknown-refund',
    });
    // 🔴 "查无此退款"必须**能被告警层看见**：它的真实含义是"通道退了一笔我们没记录的钱"。
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('🔴 只批过一次之外的状态收不到回收：没批准的行 + success 通知 = 一格都不动', async () => {
    const placed = await paidOrderWithEntitlement('hy-refund-hook-5');
    // 只申请、**不批准**：行停在 `requested`，还没有发给通道。
    const request = await requestRefund(sql, { orderId: placed.orderId, now: NOW, actor: 'admin:1' });
    if (request.outcome !== 'requested') throw new Error('测试前提不成立');
    const before = await readEntitlementEnd();

    const res = await deliver(
      refundNoticeBody(request.outRefundNo, 'success'),
    );
    expect(res.statusCode).toBe(200);
    // 回收的条件更新只认 `approved` / `processing` / `failed`；这一行不在里面。
    expect(await readRefundRow(request.outRefundNo)).toMatchObject({
      status: 'requested',
      refunded_at: null,
    });
    expect((await orderRow('hy-refund-hook-5'))?.status).toBe('paid');
    expect(await readEntitlementEnd()).toBe(before);
    expect(auditCalls().find((c) => c.event === BILLING_AUDIT_EVENTS.REFUND_APPLIED)).toMatchObject({
      outcome: 'already-applied',
    });
  });
});
