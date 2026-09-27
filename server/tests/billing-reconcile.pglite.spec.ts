import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { extendSubscriptionPeriod } from '@heyta/domain';

/**
 * 存量订单对账（Gap B）：真 SQL（PGlite = 真 PostgreSQL），只在权益写入处用
 * 一个内存替身（与 `billing-apply-event.spec.ts` 同形）。
 *
 * ## 这里证明什么
 *
 * - **定义**："已付款但未结算" = `checkout_orders.status ∈ (pending, expired)`
 *   且存在一条 `payment_events`，其 `provider_event_id = 'payment_succeeded:' || out_trade_no`。
 *   （**不是** `settled_at IS NULL`：`expired` 行也被写了 `settled_at`。）
 * - **补结算走的是 webhook 的同一份逻辑**：`settleAndApplyEvent` ——
 *   订单 → `paid`、券核销 `reserved/expired` → `applied`、订阅行按订单冻结的
 *   `price_id` 授予。
 * - **安全重跑**：第二次一条候选都找不到；即便被扫到，结算也会返回 `already-paid`
 *   且不重复叠加周期。
 * - **诚实的边界**：没有支付事件记录的订单不会被猜着补；留下
 *   `order_amount_mismatch` 审计的订单被排除；没有时间戳的事件被跳过。
 *
 * ## 不证明什么
 *
 * `reconcile-job.ts`（Prisma 装配）与 webhook 路由本身不在本文件覆盖范围内 ——
 * 本文件直接调 `settleAndApplyEvent`，那正是路由现在调用的同一个函数。
 */

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// `webhook.routes.ts` 在模块顶层 `import { prisma }`；这里只为让 import 成立，
// 本文件不经过任何路由 / Prisma 路径。
vi.mock('../src/db', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}));

import { settleAndApplyEvent } from '../src/billing/webhook.routes';
import {
  findUnsettledPaidOrders,
  reconcileUnsettledPaidOrders,
} from '../src/billing/reconcile';
import type { ReconcileApplier } from '../src/billing/reconcile';
import type { ApplyPaymentEventDeps } from '../src/billing/apply-event';
import type { SqlExecutor, SqlRunner } from '../src/billing/pricing-store';
import { grantsForSku } from '../src/billing/price-book';
import { PRICING_SCHEMA_DDL, PAYMENT_EVENTS_SCHEMA_DDL } from './pricing-ddl.helper';

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

interface SubRow {
  readonly id: number;
  readonly userId: number;
  readonly provider: string;
  readonly status: string | null;
  readonly currentPeriodEnd: number | null;
  readonly lastEventAt: number | null;
  readonly grants: readonly string[];
  readonly priceId: string | null;
}

/** 权益写入的替身：只实现 `ApplyPaymentEventDeps`，不碰数据库。 */
const createSubscriptionStore = () => {
  const rows = new Map<number, SubRow>();
  let seq = 0;
  const deps: ApplyPaymentEventDeps = {
    findSubscription: async () => null,
    findSubscriptionByUser: async (userId, provider) => {
      for (const row of rows.values()) {
        if (row.userId === userId && row.provider === provider) {
          return {
            id: row.id,
            status: row.status,
            currentPeriodEnd: row.currentPeriodEnd,
            lastEventAt: row.lastEventAt,
          };
        }
      }
      return null;
    },
    createSubscription: async (data) => {
      seq += 1;
      rows.set(seq, {
        id: seq,
        userId: data.userId,
        provider: data.provider,
        status: data.status,
        currentPeriodEnd: data.currentPeriodEnd,
        lastEventAt: data.lastEventAt,
        grants: [...data.grants],
        priceId: data.priceId,
      });
      return { id: seq };
    },
    updateSubscription: async (id, data) => {
      const prev = rows.get(id);
      if (prev === undefined) return;
      rows.set(id, {
        ...prev,
        status: data.status,
        currentPeriodEnd: data.currentPeriodEnd,
        lastEventAt: data.lastEventAt,
        grants: [...data.grants],
        priceId: data.priceId,
      });
    },
    extendPeriod: extendSubscriptionPeriod,
    now: () => NOW,
  };
  return { deps, rows, all: (): readonly SubRow[] => [...rows.values()] };
};

let db: PGlite;
let executor: SqlExecutor;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`${PRICING_SCHEMA_DDL}\n${PAYMENT_EVENTS_SCHEMA_DDL}`);
  executor = createPgliteExecutor(db);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(
    `TRUNCATE coupon_redemptions, checkout_orders, payment_events, pricing_audit_log,
              coupons, subscriptions, users RESTART IDENTITY CASCADE`,
  );
});

const insertUser = async (email = 'u@example.com'): Promise<number> => {
  const rows = await executor.query<{ id: unknown }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email],
  );
  return Number(rows[0]!.id);
};

interface InsertOrderInput {
  readonly userId: number;
  readonly outTradeNo: string;
  readonly status?: 'pending' | 'expired' | 'paid' | 'refunded' | 'failed';
  readonly amountMinor?: number;
  readonly priceId?: string;
  readonly couponId?: string | null;
  readonly discountMinor?: number;
}

const insertOrder = async (input: InsertOrderInput): Promise<number> => {
  const amount = input.amountMinor ?? 500;
  const discount = input.discountMinor ?? 0;
  const rows = await executor.query<{ id: unknown }>(
    `INSERT INTO checkout_orders
       (out_trade_no, user_id, provider, price_id, currency, region,
        original_amount_minor, discount_minor, final_amount_minor,
        coupon_id, status, quoted_at, expires_at, rejected_coupons_json,
        paid_at, settled_at, created_at, updated_at)
     VALUES ($1, $2, 'wechat', $3, 'CNY', 'CN', $4, $5, $6, $7, $8, $9, $10, NULL,
             $11, $11, $9, $9)
     RETURNING id`,
    [
      input.outTradeNo,
      input.userId,
      input.priceId ?? 'hosted-monthly',
      amount,
      discount,
      amount - discount,
      input.couponId ?? null,
      input.status ?? 'pending',
      NOW,
      NOW + 2 * 60 * 60 * 1000,
      input.status === 'paid' || input.status === 'refunded' ? NOW : null,
    ],
  );
  return Number(rows[0]!.id);
};

const insertPaymentEvent = async (input: {
  readonly providerEventId: string;
  readonly occurredAt?: number | null;
  readonly provider?: string;
  readonly eventType?: string;
}): Promise<void> => {
  await executor.execute(
    `INSERT INTO payment_events (provider, provider_event_id, event_type, occurred_at, received_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.provider ?? 'wechat',
      input.providerEventId,
      input.eventType ?? 'payment_succeeded',
      input.occurredAt === undefined ? NOW : input.occurredAt,
      NOW,
    ],
  );
};

const insertMismatchAudit = async (orderId: number): Promise<void> => {
  await executor.execute(
    `INSERT INTO pricing_audit_log (action, target, before_json, after_json, actor, note, created_at)
     VALUES ('order_amount_mismatch', $1, NULL, NULL, 'system', 'test', $2)`,
    [`order:${orderId}`, NOW],
  );
};

const insertCoupon = async (id: string): Promise<void> => {
  await executor.execute(
    `INSERT INTO coupons (id, code, name, kind, percent_off_bp, amount_off_minor, currency,
                          applies_to_all_prices, applies_to_all_regions, valid_from, enabled,
                          created_at, updated_at)
     VALUES ($1, $2, 'test coupon', 'percent', 2000, NULL, 'CNY', true, true, 0, true, 0, 0)`,
    [id, id],
  );
};

const insertRedemption = async (input: {
  readonly orderId: number;
  readonly couponId: string;
  readonly userId: number;
  readonly state: 'reserved' | 'expired';
  readonly finalAmountMinor: number;
}): Promise<void> => {
  await executor.execute(
    `INSERT INTO coupon_redemptions
       (coupon_id, user_id, order_id, state, original_amount_minor, discount_minor,
        final_amount_minor, currency, reserved_until, created_at)
     VALUES ($1, $2, $3, $4, 500, 100, $5, 'CNY', $6, $7)`,
    [
      input.couponId,
      input.userId,
      input.orderId,
      input.state,
      input.finalAmountMinor,
      NOW + 2 * 60 * 60 * 1000,
      NOW,
    ],
  );
};

const readOrder = async (
  orderId: number,
): Promise<{ status: string; provider_event_id: string | null; settled_at: unknown }> => {
  const rows = await executor.query<{
    status: unknown;
    provider_event_id: unknown;
    settled_at: unknown;
  }>('SELECT status, provider_event_id, settled_at FROM checkout_orders WHERE id = $1', [orderId]);
  const row = rows[0]!;
  return {
    status: String(row.status),
    provider_event_id:
      row.provider_event_id === null || row.provider_event_id === undefined
        ? null
        : String(row.provider_event_id),
    settled_at: row.settled_at,
  };
};

const readRedemptionState = async (orderId: number): Promise<string> => {
  const rows = await executor.query<{ state: unknown }>(
    'SELECT state FROM coupon_redemptions WHERE order_id = $1',
    [orderId],
  );
  return String(rows[0]!.state);
};

const makeApply = (store: ReturnType<typeof createSubscriptionStore>): ReconcileApplier =>
  (event) =>
    executor.transaction(async (tx) =>
      settleAndApplyEvent(event, { sql: tx, subscriptions: store.deps }),
    );

describe('对账：已付款但未结算的订单', () => {
  it('🔴 pending 的已付款订单被补结算，并走 webhook 的授予路径（订单 + 订阅行）', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder({ userId, outTradeNo: 'hy-1' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:hy-1' });
    const store = createSubscriptionStore();

    const report = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));

    expect(report).toMatchObject({ scanned: 1, settled: 1, refused: 0, skipped: 0 });
    expect(report.outcomes[0]!.settlement).toMatchObject({
      outcome: 'granted',
      orderId,
      priceId: 'hosted-monthly',
    });
    expect(await readOrder(orderId)).toMatchObject({
      status: 'paid',
      provider_event_id: 'payment_succeeded:hy-1',
    });
    // 权益**确实**被授予，而且能力来自订单冻结的 SKU。
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({
      status: 'active',
      priceId: 'hosted-monthly',
      grants: [...(grantsForSku('hosted-monthly') ?? [])],
    });
    expect(store.all()[0]!.currentPeriodEnd).toBe(NOW + 30 * DAY_MS);
  });

  it('expired（被 sweep 扫过）的已付款订单同样补结算，并报出 afterExpiry', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder({ userId, outTradeNo: 'hy-exp', status: 'expired' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:hy-exp' });
    const store = createSubscriptionStore();

    const report = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));

    expect(report.settled).toBe(1);
    expect(report.outcomes[0]!.settlement).toMatchObject({ outcome: 'granted', afterExpiry: true });
    expect((await readOrder(orderId)).status).toBe('paid');
  });

  it('带券的订单：核销从 reserved 推到 applied（结算的两半都在同一个事务里）', async () => {
    const userId = await insertUser();
    await insertCoupon('LAUNCH');
    const orderId = await insertOrder({
      userId,
      outTradeNo: 'hy-coupon',
      couponId: 'LAUNCH',
      discountMinor: 100,
    });
    await insertRedemption({
      orderId,
      couponId: 'LAUNCH',
      userId,
      state: 'reserved',
      finalAmountMinor: 400,
    });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:hy-coupon' });
    const store = createSubscriptionStore();

    const report = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));

    expect(report.settled).toBe(1);
    expect(await readRedemptionState(orderId)).toBe('applied');
  });

  it('🔴 安全重跑：第二次一条候选都找不到，不会重复授予', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder({ userId, outTradeNo: 'hy-2' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:hy-2' });
    const store = createSubscriptionStore();

    const first = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));
    const second = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));

    expect(first.settled).toBe(1);
    expect(second).toMatchObject({ scanned: 0, settled: 0, refused: 0, skipped: 0 });
    // 只有一行订阅，且周期**没有**被叠加第二次。
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]!.currentPeriodEnd).toBe(NOW + 30 * DAY_MS);
    expect((await readOrder(orderId)).status).toBe('paid');
  });

  it('🔴 边界：没有支付事件记录的订单**不在候选里**（对账不凭猜补账）', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder({ userId, outTradeNo: 'hy-no-event' });
    const store = createSubscriptionStore();

    const report = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));

    expect(report).toMatchObject({ scanned: 0, settled: 0 });
    expect((await readOrder(orderId)).status).toBe('pending');
    expect(store.all()).toHaveLength(0);
  });

  it('边界：留下 order_amount_mismatch 审计的订单被排除（金额对不上要人看）', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder({ userId, outTradeNo: 'hy-mismatch' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:hy-mismatch' });
    await insertMismatchAudit(orderId);
    const store = createSubscriptionStore();

    const report = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));

    expect(report.scanned).toBe(0);
    expect((await readOrder(orderId)).status).toBe('pending');
  });

  it('边界：已经 paid 的订单不是候选（不会二次结算）', async () => {
    const userId = await insertUser();
    await insertOrder({ userId, outTradeNo: 'hy-paid', status: 'paid' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:hy-paid' });
    const store = createSubscriptionStore();

    const report = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));

    expect(report.scanned).toBe(0);
  });

  it('边界：事件 id 前缀不是支付成功（如未来的退款 / 别的 provider）→ 不匹配', async () => {
    const userId = await insertUser();
    await insertOrder({ userId, outTradeNo: 'hy-other' });
    await insertPaymentEvent({ providerEventId: 'refund_succeeded:hy-other' });
    const store = createSubscriptionStore();

    const report = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));

    expect(report.scanned).toBe(0);
  });

  it('边界：支付事件没有时间戳 → 跳过并报出来，绝不编一个时间', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder({ userId, outTradeNo: 'hy-no-time' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:hy-no-time', occurredAt: null });
    const store = createSubscriptionStore();

    const report = await reconcileUnsettledPaidOrders(executor, { now: NOW }, makeApply(store));

    expect(report).toMatchObject({ scanned: 1, settled: 0, skipped: 1 });
    expect((await readOrder(orderId)).status).toBe('pending');
    expect(store.all()).toHaveLength(0);
  });

  it('findUnsettledPaidOrders 只读且如实带出候选字段', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder({ userId, outTradeNo: 'hy-read' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:hy-read' });

    const candidates = await findUnsettledPaidOrders(executor, { limit: 10 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      orderId,
      outTradeNo: 'hy-read',
      userId,
      provider: 'wechat',
      priceId: 'hosted-monthly',
      finalAmountMinor: 500,
      providerEventId: 'payment_succeeded:hy-read',
    });
  });
});
