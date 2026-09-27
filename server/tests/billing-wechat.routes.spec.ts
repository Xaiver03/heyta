import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { PGlite } from '@electric-sql/pglite';

/**
 * 微信支付 webhook 的**路由级**测试：
 * 真实 adapter（本进程现生成的 RSA 密钥 + 现加密的 AES-GCM 密文）
 * 穿过真实的 `webhookRoutes`（含 `(provider, providerEventId)` 唯一约束的
 * 真实形状），只在 prisma 上打桩。
 *
 * 🔴 覆盖面明确写下来：**没有真实商户号、没有真单**。
 * 这里证明的是"同一 out_trade_no 的第二投被唯一约束挡住""两笔真实购买是两次授予"
 * "验签/时效失败不落行"，**不是**"微信会接受我们的请求"。
 *
 * ## 为什么这里也起了一个 PGlite（只有空表）
 *
 * 接线之后 webhook 会对 **`checkout_orders`** 做一次真 SQL 查询（结算）。
 * 这些用例**没有建过订单**，所以查询走的是"查不到订单"（`unknown-order`），
 * 路由随即**回落**到接线前的行为（adapter 的金额声明）—— 这正是本文件要覆盖的
 * 那一段。SQL 是真的（真 PostgreSQL 语义、真空表），不是打桩返回 `[]`：
 * 打桩会掩盖"表名/列名写错"这类错误。
 * 结算成功后按订单 SKU 授予的路径由 `billing-webhook-settlement.pglite.spec.ts` 覆盖。
 */
const DAY = 24 * 60 * 60 * 1000;
const PERIOD = 30 * DAY;   // 🔴 月付：一次购买 = 30 天（ADR-0020 §2.2）
const NOW = 1_700_000_000_000;

const mocks = vi.hoisted(() => {
  interface Row {
    id: number;
    provider: string;
    externalSubscriptionId: string | null;
    status: string | null;
    currentPeriodEnd: bigint | number | null;
    lastEventAt: bigint | number | null;
    userId: number;
    createdAt: number;
    updatedAt: number;
  }
  const state = {
    seenPaymentEvents: new Set<string>(),
    paymentEventSeq: 0,
    rows: [] as Row[],
    subscriptionSeq: 0,
    createCalls: 0,
    updateCalls: 0,
  };
  const prisma = {
    paymentEvent: { create: vi.fn(), update: vi.fn() },
    // 🔴 刻意**不定义任何 delete**：若被测代码调用了删除，这里会直接抛。
    subscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, state };
});

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));

import { webhookRoutes, BILLING_AUDIT_EVENTS } from '../src/billing/webhook.routes';
import {
  buildWechatOutTradeNo,
  createWechatBillingAdapter,
} from '../src/billing/wechat.adapter';
import { createNoopBillingAdapter } from '../src/billing/noop.adapter';
import { Logger } from '../src/logger';
import { PRICING_SCHEMA_DDL } from './pricing-ddl.helper';
import {
  TEST_WECHAT_API_V3_KEY,
  TEST_WECHAT_APP_ID,
  TEST_WECHAT_MCH_ID,
  TEST_WECHAT_NOTIFY_URL,
  TEST_WECHAT_SERIAL_NO,
  buildWechatPaymentWebhook,
  createWechatTestKeyPair,
} from './wechat-test-fixture.helper';

const { privateKey, publicKey } = createWechatTestKeyPair();

/** 只有结构、没有订单的真空库：给 webhook 的结算 SQL 一个真实落点。 */
let ordersDb: PGlite;
const ordersRunner = {
  query: async <T>(query: string, params: readonly unknown[] = []): Promise<T[]> => {
    const res = await ordersDb.query(query, params as unknown[]);
    return res.rows as T[];
  },
  execute: async (query: string, params: readonly unknown[] = []): Promise<number> => {
    const res = await ordersDb.query(query, params as unknown[]);
    return res.affectedRows ?? 0;
  },
};

beforeAll(async () => {
  ordersDb = new PGlite();
  await ordersDb.exec(PRICING_SCHEMA_DDL);
}, 60_000);

afterAll(async () => {
  await ordersDb?.close();
});

describe('wechat webhook routes（stub prisma，🔴 没有真网络 / 没有真商户号）', () => {
  let app: FastifyInstance | undefined;
  let auditSpy: MockInstance;
  let clock = NOW;

  const adapter = () =>
    createWechatBillingAdapter({
      appId: TEST_WECHAT_APP_ID,
      mchId: TEST_WECHAT_MCH_ID,
      serialNo: TEST_WECHAT_SERIAL_NO,
      apiV3Key: TEST_WECHAT_API_V3_KEY,
      privateKey,
      publicKey,
      notifyUrl: TEST_WECHAT_NOTIFY_URL,
      now: () => clock,
    });

  const buildApp = async (adapters?: readonly ReturnType<typeof adapter>[]) => {
    app = Fastify();
    await app.register(webhookRoutes, {
      prefix: '/api/billing',
      ...(adapters ? { adapters: adapters as never } : {}),
      now: () => clock,
      // 结算 SQL 走真 PGlite（空表 → 查不到订单 → 回落 adapter 声明）。
      sqlRunner: () => ordersRunner,
    });
    await app.ready();
  };

  const deliver = (
    fixture: { body: Buffer; headers: Record<string, string> },
    provider = 'wechat',
  ) =>
    app!.inject({
      method: 'POST',
      url: `/api/billing/webhooks/${provider}`,
      headers: { 'content-type': 'application/json', ...fixture.headers },
      payload: fixture.body,
    });

  const payment = (outTradeNo: string, at: number, userId = 42) =>
    buildWechatPaymentWebhook({
      privateKey,
      timestampSeconds: Math.floor(at / 1000),
      successTime: new Date(at).toISOString(),
      outTradeNo,
      userId,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    auditSpy = vi.spyOn(Logger, 'audit').mockImplementation(() => {});
    clock = NOW;

    mocks.state.seenPaymentEvents.clear();
    mocks.state.paymentEventSeq = 0;
    mocks.state.rows.length = 0;
    mocks.state.subscriptionSeq = 0;
    mocks.state.createCalls = 0;
    mocks.state.updateCalls = 0;

    mocks.prisma.$transaction.mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.prisma),
    );

    // 唯一约束的真实形状：`(provider, provider_event_id)` 复合。
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
      (args: {
        where: { externalSubscriptionId?: string; userId?: number; provider?: string };
      }) => {
        const where = args.where;
        if (where.externalSubscriptionId !== undefined) {
          return Promise.resolve(
            mocks.state.rows.find(
              (row) => row.externalSubscriptionId === where.externalSubscriptionId,
            ) ?? null,
          );
        }
        if (where.userId !== undefined) {
          return Promise.resolve(
            mocks.state.rows.find(
              (row) =>
                row.userId === where.userId &&
                (where.provider === undefined || row.provider === where.provider),
            ) ?? null,
          );
        }
        return Promise.resolve(null);
      },
    );

    mocks.prisma.subscription.create.mockImplementation(
      (args: { data: Record<string, unknown> }) => {
        mocks.state.createCalls += 1;
        mocks.state.subscriptionSeq += 1;
        const row = { id: mocks.state.subscriptionSeq, ...args.data };
        mocks.state.rows.push(row as never);
        return Promise.resolve(row);
      },
    );

    mocks.prisma.subscription.update.mockImplementation(
      (args: { where: { id: number }; data: Record<string, unknown> }) => {
        mocks.state.updateCalls += 1;
        const row = mocks.state.rows.find((candidate) => candidate.id === args.where.id);
        if (row === undefined) return Promise.resolve({});
        Object.assign(row, args.data);
        return Promise.resolve(row);
      },
    );
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    auditSpy.mockRestore();
  });

  it('🔴 同一 out_trade_no 重复回调：只授予一次，两次都回 200', async () => {
    await buildApp([adapter()]);
    const outTradeNo = buildWechatOutTradeNo(42, NOW, 'deadbeef');
    const fixture = payment(outTradeNo, NOW);

    const first = await deliver(fixture);
    const second = await deliver(fixture);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true });
    // 重复投递必须 200（非 2xx 会让微信一直重投）。
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ received: true, duplicate: true });

    // 🔴 只建了一行订阅，且它只被创建过一次、没有被"再叠一年"。
    expect(mocks.state.createCalls).toBe(1);
    expect(mocks.state.updateCalls).toBe(0);
    expect(mocks.state.rows).toHaveLength(1);
    expect(mocks.state.rows[0].currentPeriodEnd).toBe(NOW + PERIOD);
    expect(mocks.state.rows[0].externalSubscriptionId).toBeNull();
    expect(mocks.state.rows[0].status).toBe('active');

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: BILLING_AUDIT_EVENTS.DUPLICATE,
        provider: 'wechat',
        providerEventId: `payment_succeeded:${outTradeNo}`,
      }),
    );
  });

  it('🔴 不同 out_trade_no 两次真实购买 = 两次授予（叠加，不覆盖）', async () => {
    await buildApp([adapter()]);

    const first = await deliver(payment(buildWechatOutTradeNo(42, NOW, 'aaaaaaa1'), NOW));
    expect(first.statusCode).toBe(200);

    // 10 天后第二笔（提前续费）。
    clock = NOW + 10 * DAY;
    const second = await deliver(payment(buildWechatOutTradeNo(42, clock, 'bbbbbb2b'), clock));
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ received: true });

    // 仍然只有一行（一行一用户），但周期叠加了两次。
    expect(mocks.state.rows).toHaveLength(1);
    expect(mocks.state.createCalls).toBe(1);
    expect(mocks.state.updateCalls).toBe(1);
    expect(mocks.state.rows[0].currentPeriodEnd).toBe(NOW + 2 * PERIOD);
    // 两条事件都落进了审计。
    expect(mocks.state.seenPaymentEvents.size).toBe(2);
  });

  it('🔴 验签失败 → 401 且**不落 PaymentEvent**（fail-closed）', async () => {
    await buildApp([adapter()]);
    const fixture = payment(buildWechatOutTradeNo(42, NOW, 'ccccccc3'), NOW);
    const tampered = { ...fixture.headers, 'wechatpay-signature': 'AAAA' + fixture.headers['wechatpay-signature'] };

    const response = await deliver({ ...fixture, headers: tampered });

    expect(response.statusCode).toBe(401);
    expect(mocks.prisma.paymentEvent.create).not.toHaveBeenCalled();
    expect(mocks.state.rows).toHaveLength(0);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: BILLING_AUDIT_EVENTS.VERIFICATION_FAILED,
        provider: 'wechat',
      }),
    );
  });

  it('🔴 时间戳过期 → 401 且不落 PaymentEvent（防重放）', async () => {
    await buildApp([adapter()]);
    // 签名本身是"正确"的，但时间戳是一小时前 —— 重放。
    const stale = buildWechatPaymentWebhook({
      privateKey,
      timestampSeconds: Math.floor((NOW - 60 * 60 * 1000) / 1000),
      successTime: new Date(NOW - 60 * 60 * 1000).toISOString(),
      outTradeNo: buildWechatOutTradeNo(42, NOW, 'ddddddd4'),
      userId: 42,
    });

    const response = await deliver(stale);

    expect(response.statusCode).toBe(401);
    expect(mocks.prisma.paymentEvent.create).not.toHaveBeenCalled();
    expect(mocks.state.rows).toHaveLength(0);
  });

  it('🔴 周期叠加用 max：提前续费不丢已付时长', async () => {
    await buildApp([adapter()]);
    const first = await deliver(payment(buildWechatOutTradeNo(42, NOW, 'eeeeeee5'), NOW));
    expect(first.statusCode).toBe(200);
    expect(mocks.state.rows[0].currentPeriodEnd).toBe(NOW + PERIOD);

    // 🔴 续费时点必须**落在本期内**，否则测的就不是"提前续费"了。
    // 周期只有 30 天，所以取第 10 天（距到期还有 20 天）。
    clock = NOW + 10 * DAY;
    const second = await deliver(payment(buildWechatOutTradeNo(42, clock, 'fffffff6'), clock));
    expect(second.statusCode).toBe(200);

    // 从"原到期日"再叠 30 天；写成 now + 30 天会得到 NOW + 40 天（丢掉已付的 10 天）。
    expect(mocks.state.rows[0].currentPeriodEnd).toBe(NOW + 2 * PERIOD);
    expect(mocks.state.rows[0].currentPeriodEnd).not.toBe(clock + PERIOD);
  });

  it('未注册 wechat adapter（自托管默认）→ 404，且不落任何行', async () => {
    // 只用默认注册表（noop），不注册微信。
    await buildApp();
    const response = await deliver(payment(buildWechatOutTradeNo(42, NOW, '99999999'), NOW));

    expect(response.statusCode).toBe(404);
    expect(mocks.prisma.paymentEvent.create).not.toHaveBeenCalled();
    expect(mocks.state.rows).toHaveLength(0);
  });

  it('自托管默认注册表里只有 noop，且它构造得出来（接口可被实现）', () => {
    expect(createNoopBillingAdapter().provider).toBe('noop');
  });

  it('🔴 到期 / 退款只改状态，从不删除任何数据', async () => {
    await buildApp([adapter()]);
    await deliver(payment(buildWechatOutTradeNo(42, NOW, 'acccccc7'), NOW));

    // 整个 prisma 桩上不存在 delete —— 任何删除调用都会在这里抛。
    const subscriptionMethods = Object.keys(mocks.prisma.subscription);
    expect(subscriptionMethods.some((name) => /delete/i.test(name))).toBe(false);
    expect(subscriptionMethods.sort()).toEqual(['create', 'findFirst', 'update']);

    // 写入的字段里也没有任何删除语义。
    const createArg = mocks.prisma.subscription.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(createArg.data).some((key) => /delete/i.test(key))).toBe(false);
    expect(mocks.state.rows[0].status).toBe('active');
  });

  it('回调体里 attach 丢失时，从 out_trade_no 取回 userId', async () => {
    await buildApp([adapter()]);
    const fixture = buildWechatPaymentWebhook({
      privateKey,
      timestampSeconds: Math.floor(NOW / 1000),
      successTime: new Date(NOW).toISOString(),
      outTradeNo: buildWechatOutTradeNo(42, NOW, 'abcdef18'),
      attach: null,
      userId: 42,
    });

    const response = await deliver(fixture);

    expect(response.statusCode).toBe(200);
    expect(mocks.state.rows).toHaveLength(1);
    expect(mocks.state.rows[0].userId).toBe(42);
  });

  it('取不到 userId 的成功支付：落审计但不建订阅行（不猜用户）', async () => {
    await buildApp([adapter()]);
    const fixture = buildWechatPaymentWebhook({
      privateKey,
      timestampSeconds: Math.floor(NOW / 1000),
      successTime: new Date(NOW).toISOString(),
      outTradeNo: 'third-party-order',
      attach: 'nonsense',
      userId: 42,
    });

    const response = await deliver(fixture);

    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.paymentEvent.create).toHaveBeenCalledOnce();
    expect(mocks.state.rows).toHaveLength(0);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'SUBSCRIPTION_CHANGED',
        reason: 'NO_USER_REFERENCE',
      }),
    );
  });
});