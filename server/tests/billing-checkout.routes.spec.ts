import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

/**
 * 收银台的**路由级**测试：真 Fastify + 真 SQL（PGlite）+ 真 `authenticate`，
 * 只在"验签"与"通道"两处打桩。
 *
 * 🔴 覆盖面明确写下来：**没有真实商户号、没有真单、没有真的收款二维码。**
 * 这里证明的是"从 HTTP 请求到库里那一行"的每一个**我们自己的**决定是对的：
 * 金额只从服务端来、订单号在落库与下单两处一致、券名额真的被预留/释放、
 * 以及不可交付的档在**任何**报价之前就被挡掉。
 * **不是**"微信会接受我们的请求"。
 *
 * 用 PGlite 而不是 mock prisma 的理由：这条链的价值全在**顺序**上
 * （报价 → 冻结 → 下单），用 mock 断言调用序列只能证明我们写下了自己期望的
 * 序列；跑真 SQL 才能证明库里那一行的金额、状态、券预留真的对了。
 */

/** 桩掉验签，但**保留真实的 `authenticate`** —— 于是 401 是真的 401 路径。 */
const H = vi.hoisted(() => ({ USER_ID: 7, GOOD_TOKEN: 'good-token' }));
const mocks = vi.hoisted(() => ({ prisma: {} as Record<string, unknown> }));

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));
vi.mock('../src/auth', () => ({
  verifyToken: async (token: string) =>
    token === H.GOOD_TOKEN
      ? { valid: true, userId: H.USER_ID, email: 'buyer@example.com' }
      : { valid: false, reason: 'invalid-token' },
}));

import { checkoutRoutes } from '../src/billing/checkout.routes';
import type { CheckoutRoutesOptions } from '../src/billing/checkout.routes';
import { createNoopBillingAdapter } from '../src/billing/noop.adapter';
import type {
  BillingAdapter,
  CheckoutResult,
  CreateCheckoutInput,
  RevokeEntitlementInput,
  SubscriptionStatus,
  WebhookHeaders,
  WebhookVerification,
} from '../src/billing/types';
import type { SqlExecutor, SqlRunner } from '../src/billing/pricing-store';
import { PRICING_SCHEMA_DDL } from './pricing-ddl.helper';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

let db: PGlite;
let sql: SqlExecutor;
let app: FastifyInstance;

/** 假通道：只记下它收到了什么，好断言"发出去的那一单"与"库里冻的那一单"一致。 */
const checkoutCalls: CreateCheckoutInput[] = [];
let checkoutBehaviour: 'qr' | 'throw' = 'qr';

const fakeAdapter: BillingAdapter = {
  provider: 'wechat',
  // 真实微信通道只收 CNY（`WECHAT_SUPPORTED_CURRENCIES`）。这个 fake 必须声明
  // 同样的能力 —— 收银台正是按"声明的能力"选通道，而那条判据是本 spec 要测的东西。
  supportedCurrencies: ['CNY'],
  createCheckout: async (input): Promise<CheckoutResult> => {
    checkoutCalls.push(input);
    if (checkoutBehaviour === 'throw') throw new Error('通道侧炸了');
    return { qrCode: 'weixin://wxpay/bizpayurl?pr=FAKE' };
  },
  verifyWebhook: async (_body: Buffer, _headers: WebhookHeaders): Promise<WebhookVerification> => ({
    ok: false,
    reason: 'not-used-in-this-spec',
  }),
  mapSubscriptionState: (_state: unknown): SubscriptionStatus | null => null,
  revokeEntitlement: async (_input: RevokeEntitlementInput): Promise<void> => {},
};

const createPgliteExecutor = (pglite: PGlite): SqlExecutor => {
  const runner: SqlRunner = {
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
    ...runner,
    transaction: async <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => {
      await pglite.exec('BEGIN');
      try {
        const result = await fn(runner);
        await pglite.exec('COMMIT');
        return result;
      } catch (error) {
        await pglite.exec('ROLLBACK');
        throw error;
      }
    },
  };
};

const buildApp = async (options: CheckoutRoutesOptions = {}): Promise<FastifyInstance> => {
  const instance = Fastify({ logger: false });
  await instance.register(checkoutRoutes, {
    prefix: '/api/billing',
    adapters: [fakeAdapter],
    now: () => NOW,
    sql,
    successUrl: 'https://example.test/paid',
    cancelUrl: 'https://example.test/cancel',
    ...options,
  });
  await instance.ready();
  return instance;
};

const post = (
  body: unknown,
  token: string | null = H.GOOD_TOKEN,
): ReturnType<FastifyInstance['inject']> =>
  app.inject({
    method: 'POST',
    url: '/api/billing/checkout',
    payload: body as Record<string, unknown>,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });

/** 库里那一单。断言的是**行**，不是"函数被调用过"。 */
const orderRow = async (outTradeNo: string) => {
  const rows = await sql.query<{
    status: string;
    price_id: string;
    original_amount_minor: number;
    discount_minor: number;
    final_amount_minor: number;
    coupon_id: string | null;
    currency: string;
    region: string;
  }>(
    `SELECT status, price_id, original_amount_minor, discount_minor,
            final_amount_minor, coupon_id, currency, region
       FROM checkout_orders WHERE out_trade_no = $1`,
    [outTradeNo],
  );
  return rows[0] ?? null;
};

const insertCoupon = async (): Promise<void> => {
  await sql.execute(
    `INSERT INTO coupons
       (id, code, name, kind, percent_off_bp, amount_off_minor, currency,
        applies_to_all_prices, price_ids, applies_to_all_regions, regions,
        valid_from, valid_until, minimum_order_minor, first_purchase_only,
        enabled, created_at, updated_at)
     VALUES ('launch', 'LAUNCH', '首发立减一元', 'fixed', NULL, 100, 'CNY',
             true, '{}', true, '{}', 0, $1, NULL, false, true, 0, 0)`,
    [NOW + 30 * 24 * HOUR],
  );
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(PRICING_SCHEMA_DDL);
  sql = createPgliteExecutor(db);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(
    'DELETE FROM coupon_redemptions; DELETE FROM checkout_orders; DELETE FROM coupons; DELETE FROM price_versions; DELETE FROM pricing_audit_log; DELETE FROM users;',
  );
  await db.exec(
    `INSERT INTO users (id, email) VALUES (${H.USER_ID}, 'buyer@example.com') ON CONFLICT DO NOTHING`,
  );
  checkoutCalls.length = 0;
  checkoutBehaviour = 'qr';
  app = await buildApp();
});

describe('收银台 —— 认证与准入', () => {
  it('没有 Authorization 头 → 401，且**不留下任何订单**', async () => {
    const res = await post({ priceId: 'hosted-monthly' }, null);

    expect(res.statusCode).toBe(401);
    const rows = await sql.query<{ n: unknown }>('SELECT count(*)::int AS n FROM checkout_orders');
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('token 无效 → 401', async () => {
    const res = await post({ priceId: 'hosted-monthly' }, 'stale-token');
    expect(res.statusCode).toBe(401);
  });

  it('🟢 ¥12 那一档现在**可以下单**（ADR-0054 解除禁售：计量与代理路由都在了）', async () => {
    // 这一条原来断言的是**反面的事**：`409 PRICE_NOT_SELLABLE`，
    // 依据 ADR-0023 §3.1「计量存在之前不得被售卖」。那份红线没有被打断 ——
    // 它的前提（"计量不存在"）被满足了之后**它自己要求解除**：
    // `server/src/ai/metering.ts`（同一条语句里读占用+裁决+1）、
    // `managed-proxy.routes.ts`（真的按额度拦截）、`managed-endpoints.ts`（境内白名单）。
    // 🔴 所以这条断言现在是有牙的：把 `hosted-ai-monthly` 再塞回
    // `NOT_YET_DELIVERABLE_SKUS`，这里立刻回到 409 并红。
    // ⚠️ 而"调用点被删掉"这件事不在这里测 —— 那是 `pnpm check:ai-quota` §3 的臂
    // （清单可以空，那道问句不许消失）。两条判据各挡一边，别把它们并成一条。
    const res = await post({ priceId: 'hosted-ai-monthly' });

    expect(res.statusCode).toBe(200);
    const outTradeNo = res.json().outTradeNo as string;
    const row = await orderRow(outTradeNo);
    expect(row).not.toBeNull();
    expect(row!.price_id).toBe('hosted-ai-monthly');
    expect(row!.final_amount_minor).toBe(1_200);
    expect(checkoutCalls).toHaveLength(1);
    expect(checkoutCalls[0]!.amountMinor).toBe(1_200);
  });

  it('不认识的 priceId → 400 UNKNOWN_PRICE（不是 500，也不是"价目表坏了"）', async () => {
    const res = await post({ priceId: 'hosted-yearly-99' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('UNKNOWN_PRICE');
  });

  it('词表外的币种 / 区域 → 400', async () => {
    expect((await post({ priceId: 'hosted-monthly', currency: 'XYZ' })).json().code).toBe(
      'UNSUPPORTED_CURRENCY',
    );
    expect((await post({ priceId: 'hosted-monthly', region: 'MARS' })).json().code).toBe(
      'UNSUPPORTED_REGION',
    );
  });

  it('🔴 通道收不了这个币种 → 409，且**连订单都不建**（能力判定在冻结之前）', async () => {
    // 顺序是「报价 → 冻结 → 下单」。若等到 `createCheckout` 才拒，这张单**已经
    // 落库**了（随后被 failOrder 改成 failed），用户拿到的是 502 + 一条无用的
    // 失败订单，而真实原因只是"这台实例收不了美元"——本可以在建单之前说清楚。
    //
    // ⚠️ 与上面那条 `UNSUPPORTED_CURRENCY`（400，词表外的值）刻意是两个错误：
    //    那个是"这个值我们根本不认识"，这个是"这台实例没有收它的能力"。
    const res = await post({ priceId: 'hosted-monthly', currency: 'USD' });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PROVIDER_CURRENCY_UNSUPPORTED');
    expect(res.json().currency).toBe('USD');
    const rows = await sql.query<{ n: unknown }>('SELECT count(*)::int AS n FROM checkout_orders');
    expect(Number(rows[0]?.n)).toBe(0);
    expect(checkoutCalls).toHaveLength(0);
  });

  it('🔴 按**声明的能力**选通道，而不是"列表里第一个"，且发出去的是报价冻的币种', async () => {
    // 一个只收 USD 的通道。两个方向都要证明：
    // ① CNY 单**不能**因为它排在列表里就被接走（否则声明形同虚设）；
    // ② USD 单要真的走到它，并且拿到的是**报价冻的 USD**，不是写死的 CNY。
    const usdOnly: BillingAdapter = {
      ...fakeAdapter,
      provider: 'usd-only',
      supportedCurrencies: ['USD'],
    };
    const usdApp = await buildApp({ adapters: [usdOnly] });
    const inject = (payload: Record<string, unknown>) =>
      usdApp.inject({
        method: 'POST',
        url: '/api/billing/checkout',
        payload,
        headers: { authorization: `Bearer ${H.GOOD_TOKEN}` },
      });

    const cny = await inject({ priceId: 'hosted-monthly' });
    expect(cny.statusCode).toBe(409);
    expect(cny.json().code).toBe('PROVIDER_CURRENCY_UNSUPPORTED');

    const usd = await inject({ priceId: 'hosted-monthly', currency: 'USD' });
    expect(usd.statusCode).toBe(200);
    expect(usd.json().currency).toBe('USD');

    // 库里冻的那一行：币种是 USD（不是默认的 CNY）。
    const row = await orderRow(usd.json().outTradeNo as string);
    expect(row).not.toBeNull();
    expect(row!.currency).toBe('USD');
    // 🔴 交给通道的币种与金额都来自**冻结的报价行**，逐字相等。
    const sent = checkoutCalls.at(-1)!;
    expect(sent.currency).toBe('USD');
    expect(sent.amountMinor).toBe(row!.final_amount_minor);

    await usdApp.close();
  });

  it('只配了 noop（= 没配通道）→ 503，而不是让 noop 接一笔真实支付', async () => {
    const noProvider = await buildApp({ adapters: [createNoopBillingAdapter()] });
    const res = await noProvider.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      payload: { priceId: 'hosted-monthly' },
      headers: { authorization: `Bearer ${H.GOOD_TOKEN}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('BILLING_PROVIDER_NOT_CONFIGURED');
    await noProvider.close();
  });
});

describe('收银台 —— 冻结的那一单就是发出去的那一单', () => {
  it('¥5 无券 → 库里冻结 500，通道收到的也是 500 与**同一个**订单号', async () => {
    const res = await post({ priceId: 'hosted-monthly' });

    expect(res.statusCode).toBe(200);
    const outTradeNo = res.json().outTradeNo as string;
    expect(outTradeNo).toMatch(/^hy[0-9a-z]+x[0-9a-z]+x[0-9a-f]+$/);

    const row = await orderRow(outTradeNo);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.price_id).toBe('hosted-monthly');
    expect(row!.original_amount_minor).toBe(500);
    expect(row!.discount_minor).toBe(0);
    expect(row!.final_amount_minor).toBe(500);
    expect(row!.coupon_id).toBeNull();
    expect(row!.currency).toBe('CNY');

    // 🔴 关键一致性：发给通道的金额与订单号必须与库里冻的一模一样。
    // 两处不同就是"一笔真实到账的钱授予不出去"（`outTradeNo` 的注释）。
    expect(checkoutCalls).toHaveLength(1);
    expect(checkoutCalls[0]!.amountMinor).toBe(row!.final_amount_minor);
    expect(checkoutCalls[0]!.outTradeNo).toBe(outTradeNo);
    expect(checkoutCalls[0]!.amountMinor).toBe(500);

    // 响应里也只有这一单自己的事实。
    expect(res.json().amountMinor).toBe(500);
    expect(res.json().qrCode).toContain('weixin://');
  });

  it('🔴 客户端塞 amount 也没用：金额只从服务端的报价来', async () => {
    // 请求体里多出来的键 zod 会丢弃，**永远不会被读到**。这条测的是那个保证：
    // 一个想付 1 分钱的人，库里冻的仍然是 500。
    const res = await post({
      priceId: 'hosted-monthly',
      amountMinor: 1,
      finalAmountMinor: 1,
      discountMinor: 499,
    });

    expect(res.statusCode).toBe(200);
    const row = await orderRow(res.json().outTradeNo as string);
    expect(row!.final_amount_minor).toBe(500);
    expect(row!.discount_minor).toBe(0);
    expect(checkoutCalls[0]!.amountMinor).toBe(500);
  });

  it('有效券 → 折扣真的落到订单行，并且**预留**了一张核销', async () => {
    await insertCoupon();

    const res = await post({ priceId: 'hosted-monthly', couponCode: 'launch' });

    expect(res.statusCode).toBe(200);
    expect(res.json().originalAmountMinor).toBe(500);
    expect(res.json().discountMinor).toBe(100);
    expect(res.json().amountMinor).toBe(400);

    const row = await orderRow(res.json().outTradeNo as string);
    expect(row!.original_amount_minor).toBe(500);
    expect(row!.discount_minor).toBe(100);
    expect(row!.final_amount_minor).toBe(400);
    expect(row!.coupon_id).toBe('launch');

    // 🔴 名额是**预留**（reserved），不是"已核销"：付款回调才把它变成 applied。
    // 这一步错了的话，点了支付但没付的单会永久吃掉名额。
    const redemptions = await sql.query<{ state: string; final_amount_minor: number }>(
      'SELECT state, final_amount_minor FROM coupon_redemptions',
    );
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]!.state).toBe('reserved');
    expect(redemptions[0]!.final_amount_minor).toBe(400);

    // 打折之后发给通道的就是折后价。
    expect(checkoutCalls[0]!.amountMinor).toBe(400);
  });

  it('券码大小写/空格不敏感（归一化后才查）', async () => {
    await insertCoupon();

    const res = await post({ priceId: 'hosted-monthly', couponCode: '  launch  ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().discountMinor).toBe(100);
  });

  it('不认识的券码 → **买得成**，但折扣是 0 且拒绝原因可查', async () => {
    const res = await post({ priceId: 'hosted-monthly', couponCode: 'NOPE' });

    expect(res.statusCode).toBe(200);
    expect(res.json().discountMinor).toBe(0);
    expect(res.json().amountMinor).toBe(500);
    expect(res.json().rejectedCoupons).toHaveLength(1);
    expect(res.json().rejectedCoupons[0].reason).toBe('unknown_coupon');
  });
});

describe('收银台 —— 通道侧失败必须释放名额', () => {
  it('🔴 通道抛错 → 502，订单被判失败，券的预留名额被释放', async () => {
    // 这是 `failOrder` 的**第一个生产调用方**。没有这一步的话，那张券的名额
    // 会被一个永远不会付款的订单占到过期为止。
    await insertCoupon();
    checkoutBehaviour = 'throw';

    const res = await post({ priceId: 'hosted-monthly', couponCode: 'launch' });

    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('CHECKOUT_FAILED');

    const orders = await sql.query<{ status: string }>('SELECT status FROM checkout_orders');
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe('failed');

    // 名额释放的证据：那一行核销不再处于计数状态里。
    const redemptions = await sql.query<{ state: string }>(
      'SELECT state FROM coupon_redemptions',
    );
    const counted = redemptions.filter((r) =>
      ['reserved', 'applied', 'reversed'].includes(r.state),
    );
    expect(counted).toHaveLength(0);
  });
});
