import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createHash, createHmac } from 'node:crypto';

/**
 * webhook 路由 + 幂等闸门 + adapter 接口的**路由级**测试。
 *
 * 样板是 `e2ee-upload-gate.routes.spec.ts`：`Fastify()` + `register(routes,{prefix})`
 * + `vi.mock('../src/db')` + `app.inject()`。
 * 🔴 不用 `sync.routes.spec.ts` 当样板 —— 它已被 `vitest.config.ts` exclude。
 *
 * 这里用的是一个**假 adapter**（自带 HMAC secret），**不是任何真实支付商 SDK**：
 * 选型未定稿，本轮不接 SDK（`subscription-provider-selection.md` §8）。
 * 假 adapter 刻意走"原始 body + 全部 header"的验签形状，从而把接口契约也钉住。
 */

const TEST_SECRET = 'test-secret';
const TEST_PROVIDER = 'testpay';

/** 内存里的 `(provider, providerEventId)` 唯一集合 + subscription 行。 */
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
    paymentEvent: {
      create: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma, state };
});

vi.mock('../src/db', () => ({
  prisma: mocks.prisma,
}));

import { webhookRoutes, BILLING_AUDIT_EVENTS } from '../src/billing/webhook.routes';
import { createNoopBillingAdapter } from '../src/billing/noop.adapter';
import { createEntitlementGuard } from '../src/entitlement';
import { Logger } from '../src/logger';
import type {
  BillingAdapter,
  CreateCheckoutInput,
  RevokeEntitlementInput,
  SubscriptionStatus,
  WebhookHeaders,
  WebhookVerification,
} from '../src/billing/types';

/** 假 adapter：对称 HMAC 验签，签名覆盖**原始字节**。 */
const createTestAdapter = (provider = TEST_PROVIDER): BillingAdapter => ({
  provider,
  // 这个 fake 只用来测 webhook 路由，收银台从不选它；声明 CNY 与真实 provider 一致。
  supportedCurrencies: ['CNY'],
  async createCheckout(_input: CreateCheckoutInput) {
    return { redirectUrl: 'https://pay.example.test/checkout' };
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
    // 验签通过后才解析。用原始 buffer 解析，证明路由确实把 rawBody 递了进来。
    const parsed = JSON.parse(rawBody.toString('utf8')) as {
      eventId: string;
      type: string;
      occurredAt: number;
      subscriptionId?: string | null;
      status?: string | null;
      periodEnd?: number | null;
      userId?: number | null;
    };
    return {
      ok: true,
      event: {
        provider,
        providerEventId: parsed.eventId,
        eventType: parsed.type,
        occurredAt: parsed.occurredAt,
        externalSubscriptionId: parsed.subscriptionId ?? null,
        status: (parsed.status ?? null) as SubscriptionStatus | null,
        currentPeriodEnd: parsed.periodEnd ?? null,
        userId: parsed.userId ?? null,
      },
    };
  },
  mapSubscriptionState(providerState: unknown): SubscriptionStatus | null {
    // 映射表是 adapter 的私有细节 —— 这里故意用一个与统一枚举不同的字面量。
    if (providerState === 'ACTIVE') return 'active';
    if (providerState === 'TRIALING') return 'trialing';
    return null;
  },
  async revokeEntitlement(_input: RevokeEntitlementInput): Promise<void> {
    // 有意为空：回收只改权益状态，绝不删数据。
  },
});

const signBody = (body: string): string =>
  createHmac('sha256', TEST_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');

const digestOf = (body: string): string =>
  createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');

describe('billing webhook routes', () => {
  let app: FastifyInstance | undefined;
  let auditSpy: MockInstance;

  const buildApp = async (adapters?: readonly BillingAdapter[]): Promise<void> => {
    app = Fastify();
    await app.register(webhookRoutes, {
      prefix: '/api/billing',
      ...(adapters ? { adapters } : {}),
    });
    await app.ready();
  };

  const deliver = (provider: string, body: string, signature?: string) =>
    app!.inject({
      method: 'POST',
      url: `/api/billing/webhooks/${provider}`,
      headers: {
        'content-type': 'application/json',
        ...(signature === undefined ? {} : { 'x-test-signature': signature }),
      },
      payload: body,
    });

  const eventBody = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      eventId: 'evt_1',
      type: 'subscription.renewed',
      occurredAt: 2_000,
      subscriptionId: 'sub_1',
      status: 'active',
      periodEnd: 9_000,
      userId: 1,
      ...overrides,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    auditSpy = vi.spyOn(Logger, 'audit').mockImplementation(() => {});

    mocks.state.seenPaymentEvents.clear();
    mocks.state.paymentEventSeq = 0;
    mocks.state.subscriptions.clear();
    mocks.state.subscriptionSeq = 0;
    mocks.state.subscriptionCreateCalls = 0;
    mocks.state.subscriptionUpdateCalls = 0;

    // 交互式事务在 mock 下直接以 prisma 自身为 tx 跑回调。
    mocks.prisma.$transaction.mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.prisma),
    );

    // 唯一约束的**真实形状**：键是 (provider, providerEventId) 复合。
    mocks.prisma.paymentEvent.create.mockImplementation(
      (args: { data: { provider: string; providerEventId: string } }) => {
        const key = `${args.data.provider}:${args.data.providerEventId}`;
        if (mocks.state.seenPaymentEvents.has(key)) {
          // Prisma 的 P2002 形状，且带字段级 target —— 路由据此区分
          // `payment_events` 唯一冲突与其它唯一冲突。
          throw {
            code: 'P2002',
            meta: { target: ['provider', 'provider_event_id'] },
          };
        }
        mocks.state.seenPaymentEvents.add(key);
        mocks.state.paymentEventSeq += 1;
        return Promise.resolve({ id: mocks.state.paymentEventSeq });
      },
    );
    mocks.prisma.paymentEvent.update.mockResolvedValue({});

    mocks.prisma.subscription.findFirst.mockImplementation(
      (args: {
        where: { externalSubscriptionId?: string; userId?: number };
      }) => {
        // webhook 处理按外部 id 查。
        if (args.where.externalSubscriptionId !== undefined) {
          return Promise.resolve(
            mocks.state.subscriptions.get(args.where.externalSubscriptionId) ?? null,
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
    // 🔴 entitlement 守卫走的是 `findMany`（**全部行**，不是最新那一行）：
    // 权益是多个来源的并集（付费 / 邀请奖励），按最新一行判定会把用户
    // 已付的时长丢掉。见 `src/entitlement.ts` 的 `evaluateCapabilityAcross`。
    mocks.prisma.subscription.findMany.mockImplementation(
      (args: { where: { userId?: number } }) => {
        const rows = [...mocks.state.subscriptions.values()].filter(
          (candidate) =>
            args.where.userId === undefined || candidate.userId === args.where.userId,
        );
        return Promise.resolve(rows);
      },
    );
    mocks.prisma.subscription.create.mockImplementation(
      (args: { data: Record<string, unknown> }) => {
        mocks.state.subscriptionCreateCalls += 1;
        mocks.state.subscriptionSeq += 1;
        const row = { id: mocks.state.subscriptionSeq, ...args.data };
        mocks.state.subscriptions.set(
          String(args.data.externalSubscriptionId),
          row,
        );
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
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    auditSpy.mockRestore();
  });

  it('🔴 同一 providerEventId 投递两次：第二次零副作用，且两次都回 200', async () => {
    await buildApp([createTestAdapter()]);
    const body = eventBody();
    const signature = signBody(body);

    const first = await deliver(TEST_PROVIDER, body, signature);
    const second = await deliver(TEST_PROVIDER, body, signature);

    // 支付商重投时非 2xx 会导致它一直重试 —— 两次都必须 200。
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true });
    expect(second.json()).toEqual({ received: true, duplicate: true });

    // 🔴 权益只被授予/更新一次。
    expect(mocks.state.subscriptionCreateCalls).toBe(1);
    expect(mocks.state.subscriptionUpdateCalls).toBe(0);
    expect(mocks.prisma.subscription.create).toHaveBeenCalledOnce();
    // 落库的订阅只有一条。
    expect(mocks.state.subscriptions.size).toBe(1);
    expect(mocks.state.seenPaymentEvents.size).toBe(1);

    // 第二次的审计事件是"重复"，不是"变更"。
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: BILLING_AUDIT_EVENTS.DUPLICATE,
        provider: TEST_PROVIDER,
        providerEventId: 'evt_1',
      }),
    );
  });

  it('🔴 不同 provider 的相同 eventId 不算重复（唯一键是复合的）', async () => {
    await buildApp([
      createTestAdapter('provider-a'),
      createTestAdapter('provider-b'),
    ]);
    // 同一个 eventId，但两个 provider 各自的订阅对象不同
    // （`externalSubscriptionId` 在 schema 里是全局唯一，所以这里必须给不同的值）。
    const bodyA = eventBody({ subscriptionId: 'sub_a' });
    const bodyB = eventBody({ subscriptionId: 'sub_b' });

    const a1 = await deliver('provider-a', bodyA, signBody(bodyA));
    const b1 = await deliver('provider-b', bodyB, signBody(bodyB));

    // 两笔都真的被处理了 —— 没有任何一条被当成重复。
    expect(a1.statusCode).toBe(200);
    expect(b1.statusCode).toBe(200);
    expect(a1.json()).toEqual({ received: true });
    expect(b1.json()).toEqual({ received: true });
    expect(mocks.state.seenPaymentEvents.size).toBe(2);
    expect([...mocks.state.seenPaymentEvents].sort()).toEqual([
      'provider-a:evt_1',
      'provider-b:evt_1',
    ]);
    expect(mocks.state.subscriptionCreateCalls).toBe(2);
    expect(auditSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: BILLING_AUDIT_EVENTS.DUPLICATE }),
    );

    // 同 provider 的同一 eventId 仍然会撞（对照，证明复合键的另一半真的在起作用）。
    const a2 = await deliver('provider-a', bodyA, signBody(bodyA));
    expect(a2.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.state.subscriptionCreateCalls).toBe(2);
    // 对照第二条也确认：provider-b 的那条不受 provider-a 的重投影响。
    const b2 = await deliver('provider-b', bodyB, signBody(bodyB));
    expect(b2.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.state.subscriptionCreateCalls).toBe(2);
  });

  it('🔴 验签失败：拒绝，且不落 PaymentEvent（否则 eventId 会被攻击者占掉）', async () => {
    await buildApp([createTestAdapter()]);
    const body = eventBody();

    const response = await deliver(TEST_PROVIDER, body, 'deadbeef');

    expect(response.statusCode).toBe(401);
    // 🔴 关键断言：没有落任何行。否则真事件到达时会被当成重复而丢弃。
    expect(mocks.prisma.paymentEvent.create).not.toHaveBeenCalled();
    expect(mocks.state.seenPaymentEvents.size).toBe(0);
    expect(mocks.prisma.subscription.create).not.toHaveBeenCalled();

    // 之后用**真签名**投递同一 eventId，必须仍能被处理（没被垃圾请求占坑）。
    const ok = await deliver(TEST_PROVIDER, body, signBody(body));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ received: true });
    expect(mocks.state.subscriptionCreateCalls).toBe(1);
  });

  it('空 provider + 自托管默认：webhook fail-closed，权益闸门默认关且不查库', async () => {
    // 默认注册表（不传 adapters）就是空 provider。
    await buildApp();

    const rejected = await deliver('noop', eventBody());
    expect(rejected.statusCode).toBe(401);
    expect(mocks.prisma.paymentEvent.create).not.toHaveBeenCalled();

    // 未注册的 provider 直接 404（fail-closed），同样不落行。
    const unknown = await deliver('not-registered', eventBody());
    expect(unknown.statusCode).toBe(404);
    expect(mocks.prisma.paymentEvent.create).not.toHaveBeenCalled();

    // 🔴 与既有 entitlement 的"默认关"一致：gate 关着时不鉴权、不查库。
    const loadSubscriptions = vi.fn();
    const guard = createEntitlementGuard({ loadSubscriptions });
    const result = await guard(
      {} as never,
      {} as never,
    );
    expect(result).toBeUndefined();
    expect(loadSubscriptions).not.toHaveBeenCalled();
    expect(mocks.prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.subscription.findMany).not.toHaveBeenCalled();
  });

  it('🔴 不存原始 payload：只落 SHA-256 digest，买家 PII 不出现任何落库字段', async () => {
    await buildApp([createTestAdapter()]);
    const body = eventBody({
      buyerEmail: 'buyer@example.com',
      buyerName: 'Ada Lovelace',
      buyerAddress: '12 Analytical Engine Way',
    });

    const response = await deliver(TEST_PROVIDER, body, signBody(body));
    expect(response.statusCode).toBe(200);

    type CreateArgs = { data: Record<string, unknown> };
    const createArgs = mocks.prisma.paymentEvent.create.mock.calls[0][0] as CreateArgs;

    // digest 是原始 body 的 SHA-256，可审计、可去重，但不含原文。
    expect(createArgs.data.payloadDigest).toBe(digestOf(body));
    expect(createArgs.data.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect('payload' in createArgs.data).toBe(false);

    // 🔴 整个落库参数的序列化结果里，一个 PII 字段都不许出现。
    // （BigInt 不能直接 JSON.stringify，用 replacer 转成字符串再检查。）
    const serialized = JSON.stringify(createArgs, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serialized).not.toContain('buyer@example.com');
    expect(serialized).not.toContain('Ada Lovelace');
    expect(serialized).not.toContain('Analytical Engine Way');
    // 原始 body 本身也不是任何落库字段。
    expect(serialized).not.toContain(body);
  });

  it('🔴 乱序到达：事件时间更早的"取消"不覆盖更新的状态（用 occurredAt，不用到达顺序）', async () => {
    await buildApp([createTestAdapter()]);

    // 先生成"续费成功"（事件时间较新）。
    const renewal = eventBody({
      eventId: 'evt_renew',
      type: 'subscription.renewed',
      occurredAt: 2_000,
      status: 'active',
      periodEnd: 9_000,
    });
    const applied = await deliver(TEST_PROVIDER, renewal, signBody(renewal));
    expect(applied.statusCode).toBe(200);
    expect(mocks.state.subscriptions.get('sub_1')?.status).toBe('active');
    expect(mocks.state.subscriptions.get('sub_1')?.lastEventAt).toBe(2_000);

    // "取消"事件**后到达**，但它的事件时间更早（1_000 < 2_000）。
    const cancel = eventBody({
      eventId: 'evt_cancel',
      type: 'subscription.canceled',
      occurredAt: 1_000,
      status: 'canceled',
      periodEnd: 9_000,
    });
    const stale = await deliver(TEST_PROVIDER, cancel, signBody(cancel));
    expect(stale.statusCode).toBe(200);

    // 🔴 状态没有被回退：仍然是 active / 仍然是更新的 lastEventAt。
    const row = mocks.state.subscriptions.get('sub_1');
    expect(row?.status).toBe('active');
    expect(row?.lastEventAt).toBe(2_000);
    // 过期事件不触发第二次写。
    expect(mocks.state.subscriptionUpdateCalls).toBe(0);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'SUBSCRIPTION_CHANGED',
        outcome: 'stale',
      }),
    );
  });

  it('到期 / 退款只改状态，绝不删除服务端数据', async () => {
    await buildApp([createTestAdapter()]);

    const expired = eventBody({
      eventId: 'evt_expired',
      type: 'subscription.expired',
      occurredAt: 3_000,
      status: 'expired',
      periodEnd: 2_500,
    });
    const response = await deliver(TEST_PROVIDER, expired, signBody(expired));
    expect(response.statusCode).toBe(200);

    expect(mocks.state.subscriptions.get('sub_1')?.status).toBe('expired');
    // 没有以任何形式删除订阅 / 任务数据。
    const prismaAny = mocks.prisma as unknown as Record<string, unknown>;
    expect(prismaAny.deleteSubscription).toBeUndefined();
    expect(prismaAny.deleteMany).toBeUndefined();
  });

  it('到期判定被真正使用：webhook 写下的 expired 会让权益守卫拒绝，且不删数据', async () => {
    await buildApp([createTestAdapter()]);

    const expired = eventBody({
      eventId: 'evt_expired_gate',
      type: 'subscription.expired',
      occurredAt: 5_000,
      status: 'expired',
      periodEnd: 4_000,
    });
    const written = await deliver(TEST_PROVIDER, expired, signBody(expired));
    expect(written.statusCode).toBe(200);
    expect(mocks.state.subscriptions.get('sub_1')?.status).toBe('expired');

    // 用真实守卫（默认 loadSubscription 查 prisma）读刚写下的这一行。
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    const guard = createEntitlementGuard({
      gate: { enabled: true },
      now: () => 10_000,
    });
    const result = await guard(
      { user: { userId: 1, email: 'u@test.com' }, ip: '127.0.0.1' } as never,
      reply as never,
    );

    expect(result).toBe(reply);
    expect(reply.status).toHaveBeenCalledWith(402);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'STATUS_NOT_ENTITLED' }),
    );

    // 🔴 降级 ≠ 删数据：订阅行原样还在（到期只影响"能不能新增设备接入"）。
    expect(mocks.state.subscriptions.size).toBe(1);
    expect(mocks.state.subscriptions.get('sub_1')?.status).toBe('expired');
  });
});
