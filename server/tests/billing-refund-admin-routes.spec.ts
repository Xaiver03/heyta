import { PGlite } from '@electric-sql/pglite';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 后台那四条退款路由的**行为**契约（闸门本身在 `admin-routes.spec.ts` 里逐条对账）。
 *
 * 这一组要钉的是三件"只有路由层才会犯"的错：
 *
 * 1. 🔴 **例外批准必须带理由**：`operatorApproved: true` 而不给 `note` ⇒ 400。
 *    一次没有理由的例外批准，事后与"运营手滑"在库里**长得一模一样**。
 * 2. 🔴 **通道失败要报 200，不报 502**：批准那一刻决定已经落库了，
 *    通道拒了是下一步的事实（它落在 `refunds.status='failed'` + 审计里）。
 *    报 500 会让运营以为"什么都没发生"而再点一次 —— 而那一次是**第二次向通道发起退款**。
 * 3. 🔴 **挑 adapter 按订单当初的 provider**：换过支付商之后旧单只能回到旧通道去退，
 *    这台实例没注册它就得如实 409，而不是拿现在配的那家去发一次注定失败的请求。
 *
 * ## 存储
 *
 * Prisma 在本仓库测试里是 mock 的，所以这里注入的是一个 **PGlite 支撑的
 * `PrismaLikeClient`**：真 SQL、真约束、真事务，只有 Prisma 的参数绑定那一层薄胶水
 * 被替身顶掉（同 `billing-pricing-store.pglite.spec.ts` 那条边界）。
 */

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));

import { adminRoutes } from '../src/admin/admin.routes';
import {
  createPrismaSqlExecutor,
  type PrismaLikeClient,
  type PrismaTransactionClient,
} from '../src/billing/pricing-store';
import { requestRefund } from '../src/billing/refund-store';
import type {
  BillingAdapter,
  CheckoutResult,
  CreateCheckoutInput,
  CreateRefundInput,
  RefundResult,
  RevokeEntitlementInput,
  SubscriptionStatus,
  WebhookHeaders,
  WebhookVerification,
} from '../src/billing/types';
import { PRICING_SCHEMA_DDL, REFUND_SCHEMA_DDL } from './pricing-ddl.helper';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/**
 * 🔴 这里**不能**用固定常量当"现在"：路由调 `requestRefund` 时传的是 `Date.now()`，
 * 而窗口判定是 `now - paidAt`。用一个未来时刻当 NOW 会让"8 天前付的款"算出**负数**，
 * 于是超窗那条判据永远不触发 —— 第一版就是在这里拿到 201 而不是 409 的。
 */
const NOW = Date.now();
const USER_ID = 11;

let db: PGlite;
let app: FastifyInstance | undefined;
let sql: ReturnType<typeof createPrismaSqlExecutor>;

const client: PrismaLikeClient = mocks.prisma as unknown as PrismaLikeClient;

const AUTH = { authorization: 'Bearer test-token' };

/**
 * 只配一个 provider 的 adapter 注册表替身。
 *
 * 🔴 五个方法逐个补桩：`createCheckout` / `verifyWebhook` / `revokeEntitlement`
 * 一旦被退款路径调用就是接线接错了，让它抛比让它静默成功有用。
 */
const refundAdapter = (
  provider: string,
  behavior:
    | { readonly ok: true; readonly result: RefundResult }
    | { readonly ok: false; readonly error: Error },
): { readonly adapter: BillingAdapter; readonly calls: CreateRefundInput[] } => {
  const calls: CreateRefundInput[] = [];
  return {
    calls,
    adapter: {
      provider,
      supportedCurrencies: ['CNY'],
      async createCheckout(_input: CreateCheckoutInput): Promise<CheckoutResult> {
        throw new Error('后台退款路由不该下单');
      },
      async verifyWebhook(_body: Buffer, _headers: WebhookHeaders): Promise<WebhookVerification> {
        throw new Error('后台退款路由不该验签');
      },
      mapSubscriptionState(_state: unknown): SubscriptionStatus | null {
        return null;
      },
      async revokeEntitlement(_input: RevokeEntitlementInput): Promise<void> {
        throw new Error('后台退款路由不该走撤销');
      },
      async refund(input: CreateRefundInput): Promise<RefundResult> {
        calls.push(input);
        if (behavior.ok) return behavior.result;
        throw behavior.error;
      },
    },
  };
};

const buildApp = async (adapters: readonly BillingAdapter[]): Promise<void> => {
  app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin', adapters });
  await app.ready();
};

const insertPaidOrder = async (overrides: {
  readonly finalAmountMinor?: number;
  readonly originalAmountMinor?: number;
  readonly discountMinor?: number;
  readonly paidAt?: number;
  readonly provider?: string;
} = {}): Promise<number> => {
  const original = overrides.originalAmountMinor ?? 900;
  const discount = overrides.discountMinor ?? 500;
  const rows = (await db.query(
    `INSERT INTO checkout_orders
       (out_trade_no, user_id, provider, price_id, currency, region,
        original_amount_minor, discount_minor, final_amount_minor,
        status, quoted_at, expires_at, paid_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'hosted-monthly', 'CNY', 'CN', $4, $5, $6, 'paid', $7, $8, $9, $10, $10)
     RETURNING id`,
    [
      `hy-admin-${Math.random().toString(36).slice(2, 10)}`,
      USER_ID,
      overrides.provider ?? 'wechat',
      original,
      discount,
      overrides.finalAmountMinor ?? original - discount,
      NOW - 2 * HOUR,
      NOW - HOUR,
      overrides.paidAt ?? NOW - HOUR,
      NOW - 3 * HOUR,
    ],
  )) as { rows: { id: number }[] };
  return Number(rows.rows[0]!.id);
};

const refundRow = async (id: number) => {
  const rows = (await db.query(
    `SELECT status, amount_minor, refunded_at, reason, provider FROM refunds WHERE id = $1`,
    [id],
  )) as { rows: Record<string, unknown>[] };
  return rows.rows[0] ?? null;
};

const orderStatus = async (id: number) => {
  const rows = (await db.query(`SELECT status FROM checkout_orders WHERE id = $1`, [
    id,
  ])) as { rows: { status: string }[] };
  return rows.rows[0]?.status ?? null;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`${PRICING_SCHEMA_DDL}\n${REFUND_SCHEMA_DDL}`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db.exec(
    'DELETE FROM refunds; DELETE FROM subscriptions; DELETE FROM coupon_redemptions;' +
      ' DELETE FROM checkout_orders; DELETE FROM pricing_audit_log; DELETE FROM users;',
  );
  await db.exec(`INSERT INTO users (id, email) VALUES (${USER_ID}, 'buyer@example.test')`);

  sql = createPrismaSqlExecutor(client);
  mocks.prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
  mocks.prisma.$queryRawUnsafe.mockImplementation(async (query: string, ...params: unknown[]) => {
    const res = await db.query(query, params as unknown[]);
    return res.rows;
  });
  mocks.prisma.$executeRawUnsafe.mockImplementation(async (query: string, ...params: unknown[]) => {
    const res = await db.query(query, params as unknown[]);
    return res.affectedRows ?? 0;
  });
  mocks.prisma.$transaction.mockImplementation(
    async (fn: (tx: PrismaTransactionClient) => Promise<unknown>) =>
      fn(mocks.prisma as unknown as PrismaTransactionClient),
  );
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /api/admin/refunds —— 申请', () => {
  it('窗口内的单：201，冻结的是**实付**而不是原价', async () => {
    await buildApp([]);
    const orderId = await insertPaidOrder();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/admin/refunds',
      headers: AUTH,
      payload: { orderId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, outcome: 'requested', amountMinor: 400 });
    const body = res.json() as { refundId: number };
    expect(await refundRow(body.refundId)).toMatchObject({ status: 'requested', amount_minor: 400 });
  });

  it('🔴 `operatorApproved: true` 不带理由 ⇒ 400，而且一条退款行都不许多出来', async () => {
    await buildApp([]);
    const orderId = await insertPaidOrder({ paidAt: NOW - 8 * DAY });
    const res = await app!.inject({
      method: 'POST',
      url: '/api/admin/refunds',
      headers: AUTH,
      payload: { orderId, operatorApproved: true },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { issues: { path: string }[] }).issues.map((i) => i.path)).toContain('note');
    const rows = (await db.query('SELECT count(*)::int AS n FROM refunds')) as {
      rows: { n: number }[];
    };
    expect(rows.rows[0]!.n).toBe(0);

    // 同一个开关带上理由就应当放行 —— 否则这条判据可以靠"永远不传 operatorApproved"绕过。
    const withNote = await app!.inject({
      method: 'POST',
      url: '/api/admin/refunds',
      headers: AUTH,
      payload: { orderId, operatorApproved: true, note: '客诉已线下核实' },
    });
    expect(withNote.statusCode).toBe(201);
  });

  it('超窗且没有例外 ⇒ 409 + 原因（不是 400：请求本身没写错）', async () => {
    await buildApp([]);
    const orderId = await insertPaidOrder({ paidAt: NOW - 8 * DAY });
    const res = await app!.inject({
      method: 'POST',
      url: '/api/admin/refunds',
      headers: AUTH,
      payload: { orderId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: 'WINDOW_PASSED' });
  });

  it('订单不存在 ⇒ 404；`orderId` 非法 ⇒ 400（校验只有一套，不在 handler 里再写一份）', async () => {
    await buildApp([]);
    const missing = await app!.inject({
      method: 'POST',
      url: '/api/admin/refunds',
      headers: AUTH,
      payload: { orderId: 999999 },
    });
    expect(missing.statusCode).toBe(404);

    for (const orderId of [0, -1, 1.5, 'abc']) {
      const bad = await app!.inject({
        method: 'POST',
        url: '/api/admin/refunds',
        headers: AUTH,
        payload: { orderId },
      });
      expect(bad.statusCode, JSON.stringify(orderId)).toBe(400);
    }
  });
});

describe('POST /api/admin/refunds/:id/approve —— 批准之后才发给通道', () => {
  const requested = async (): Promise<{ refundId: number; orderId: number }> => {
    const orderId = await insertPaidOrder();
    const result = await requestRefund(sql, { orderId, now: Date.now(), actor: 'admin:1' });
    if (result.outcome !== 'requested') throw new Error(`测试前提不成立：${result.outcome}`);
    return { refundId: result.refundId, orderId };
  };

  it('通道当场受理 ⇒ 200 + `processing`，`refunded_at` 仍为空、订单仍 `paid`', async () => {
    const { adapter, calls } = refundAdapter('wechat', {
      ok: true,
      result: { providerRefundId: '503000000', status: 'processing' },
    });
    await buildApp([adapter]);
    const { refundId, orderId } = await requested();

    const res = await app!.inject({
      method: 'POST',
      url: `/api/admin/refunds/${refundId}/approve`,
      headers: AUTH,
      payload: { note: '已核实客诉' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, outcome: 'submitted', status: 'processing' });
    expect(calls).toHaveLength(1);
    expect(await refundRow(refundId)).toMatchObject({ status: 'processing', refunded_at: null });
    expect(await orderStatus(orderId)).toBe('paid');
  });

  it('🔴 通道抛错 ⇒ 仍是 200 + `channel-failed`（报 500 会诱导运营再点一次，那是第二次发起退款）', async () => {
    class ChannelDown extends Error {
      constructor() {
        super('通道 500');
        this.name = 'WechatApiError';
      }
    }
    const { adapter, calls } = refundAdapter('wechat', { ok: false, error: new ChannelDown() });
    await buildApp([adapter]);
    const { refundId, orderId } = await requested();

    const res = await app!.inject({
      method: 'POST',
      url: `/api/admin/refunds/${refundId}/approve`,
      headers: AUTH,
      payload: { note: '批准' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, outcome: 'channel-failed', reason: 'WechatApiError' });
    expect(await refundRow(refundId)).toMatchObject({ status: 'failed', reason: 'WechatApiError' });
    // 通道只被调用了一次：失败**不重试**，重试是运营再申请一条（换号）。
    expect(calls).toHaveLength(1);
    // 失败**不把订单写成已退款** —— 钱没动，账上就不许出现退款态。
    expect(await orderStatus(orderId)).toBe('paid');
  });

  it('🔴 这台实例没注册那一单当初的通道 ⇒ 409，批准仍然落库、钱一分不发', async () => {
    const { adapter, calls } = refundAdapter('alipay_legacy', {
      ok: true,
      result: { providerRefundId: 'x', status: 'success' },
    });
    await buildApp([adapter]);
    // 订单是 wechat 的，而这台实例只配了别家 —— 换支付商之后的真实形状。
    const orderId = await insertPaidOrder({ provider: 'wechat' });
    const request = await requestRefund(sql, { orderId, now: Date.now(), actor: 'admin:1' });
    if (request.outcome !== 'requested') throw new Error('测试前提不成立');

    const res = await app!.inject({
      method: 'POST',
      url: `/api/admin/refunds/${request.refundId}/approve`,
      headers: AUTH,
      payload: { note: '批准' },
    });
    expect(res.statusCode).toBe(409);
    // 🔴 409 的体里必须带**机器码**：`error` 是给人读的散文，而后台界面要按码选措辞
    // （这一条是"钱没发出去"那种必须让运营看见的事实，折成一句笼统冲突就是界面说谎）。
    expect(res.json()).toMatchObject({
      reason: 'REFUND_PROVIDER_NOT_REGISTERED',
      status: 'approved',
      channel: 'unavailable',
    });
    expect(calls).toHaveLength(0);
    expect(await refundRow(request.refundId)).toMatchObject({ status: 'approved', refunded_at: null });
    expect(await orderStatus(orderId)).toBe('paid');
  });

  it('第二次批准 ⇒ 409（决定只能做一次）；理由为空的批准 ⇒ 400', async () => {
    const { adapter } = refundAdapter('wechat', {
      ok: true,
      result: { providerRefundId: '503000000', status: 'processing' },
    });
    await buildApp([adapter]);
    const { refundId } = await requested();
    const first = await app!.inject({
      method: 'POST',
      url: `/api/admin/refunds/${refundId}/approve`,
      headers: AUTH,
      payload: { note: '批准' },
    });
    expect(first.statusCode).toBe(200);
    const second = await app!.inject({
      method: 'POST',
      url: `/api/admin/refunds/${refundId}/approve`,
      headers: AUTH,
      payload: { note: '再点一次' },
    });
    expect(second.statusCode).toBe(409);
    // 与上面同一条形：这一档 409 也得带码，否则界面只能说"状态冲突"而说不出"已经决定过了"。
    expect(second.json()).toMatchObject({ reason: 'NOT_DECIDABLE' });

    const { refundId: other } = await requested();
    const noNote = await app!.inject({
      method: 'POST',
      url: `/api/admin/refunds/${other}/approve`,
      headers: AUTH,
      payload: { note: '   ' },
    });
    expect(noNote.statusCode).toBe(400);
    expect(await refundRow(other)).toMatchObject({ status: 'requested' });
  });

  it('不存在的退款 id ⇒ 404（与"已经决定过"是两件事）', async () => {
    const { adapter } = refundAdapter('wechat', {
      ok: true,
      result: { providerRefundId: 'x', status: 'processing' },
    });
    await buildApp([adapter]);
    const res = await app!.inject({
      method: 'POST',
      url: '/api/admin/refunds/424242/approve',
      headers: AUTH,
      payload: { note: '批准' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('拒绝与列表', () => {
  it('拒绝：200 + 行落 `rejected`，订单与权益一格都不动', async () => {
    await buildApp([]);
    const orderId = await insertPaidOrder();
    const request = await requestRefund(sql, { orderId, now: Date.now(), actor: 'admin:1' });
    if (request.outcome !== 'requested') throw new Error('测试前提不成立');

    const res = await app!.inject({
      method: 'POST',
      url: `/api/admin/refunds/${request.refundId}/reject`,
      headers: AUTH,
      payload: { note: '不符合口径' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, outcome: 'decided', status: 'rejected' });
    expect(await refundRow(request.refundId)).toMatchObject({
      status: 'rejected',
      reason: 'OPERATOR_REJECTED',
    });
    expect(await orderStatus(orderId)).toBe('paid');
  });

  it('GET /refunds：可按账号筛，且返回的是白名单字段（不带内部列名）', async () => {
    await buildApp([]);
    const orderId = await insertPaidOrder();
    const request = await requestRefund(sql, { orderId, now: Date.now(), actor: 'admin:1' });
    if (request.outcome !== 'requested') throw new Error('测试前提不成立');

    const res = await app!.inject({ method: 'GET', url: '/api/admin/refunds', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { refunds: Record<string, unknown>[] };
    expect(body.refunds).toHaveLength(1);
    expect(Object.keys(body.refunds[0]!).sort()).toEqual([
      'amountMinor',
      'currency',
      'id',
      'orderId',
      'outRefundNo',
      'periodDays',
      'provider',
      'status',
      'userId',
    ]);

    const filtered = await app!.inject({
      method: 'GET',
      url: '/api/admin/refunds?userId=999',
      headers: AUTH,
    });
    expect((filtered.json() as { refunds: unknown[] }).refunds).toHaveLength(0);

    const bad = await app!.inject({
      method: 'GET',
      url: '/api/admin/refunds?limit=99999',
      headers: AUTH,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('🔴 已经批准过一次的行不能再拒绝（同一道条件更新闸门）', async () => {
    const { adapter } = refundAdapter('wechat', {
      ok: true,
      result: { providerRefundId: 'x', status: 'processing' },
    });
    await buildApp([adapter]);
    const orderId = await insertPaidOrder();
    const request = await requestRefund(sql, { orderId, now: Date.now(), actor: 'admin:1' });
    if (request.outcome !== 'requested') throw new Error('测试前提不成立');
    // 🔴 批准走**路由**而不是直接调 `decideRefund`：只有路由会把决定接着发给通道，
    // 于是行才真的停在 `processing`（"已经发过钱的那一步不能被拒绝擦掉"要的是这个状态）。
    const approved = await app!.inject({
      method: 'POST',
      url: `/api/admin/refunds/${request.refundId}/approve`,
      headers: AUTH,
      payload: { note: '批准' },
    });
    expect(approved.statusCode).toBe(200);

    const res = await app!.inject({
      method: 'POST',
      url: `/api/admin/refunds/${request.refundId}/reject`,
      headers: AUTH,
      payload: { note: '改主意' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: 'NOT_DECIDABLE' });
    // 批准之后已经发给通道，行停在 `processing` —— 拒绝不能把它擦回 `requested`。
    expect(await refundRow(request.refundId)).toMatchObject({ status: 'processing' });
  });
});
