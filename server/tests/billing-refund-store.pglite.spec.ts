/**
 * 退款状态机与权益回收的**库层**证据：真 PostgreSQL 语义（PGlite）上跑真 SQL。
 *
 * ## 为什么这一层不能用假 store
 *
 * 本文件要证明的东西全部是**数据库事实**：三条 CHECK 挡住的那三种半真状态、
 * 条件更新的**影响行数**（幂等的唯一依据）、订单行取锁之后"查开着的退款 + 插一行"
 * 的串行性、以及订单状态翻转与"数剩余已付订单"的**先后**。
 * 用内存假 store 测这些，测到的是假 store 的实现，与发布物无关。
 *
 * ## 🔴 与 `billing-pricing-store.pglite.spec.ts` 同一个已知边界
 *
 * PGlite 是**单连接**的：两个 `BEGIN` 无法并存，所以"两个管理员同时点批准"
 * 在这里跑不出真交错。本文件能给的是**机制形状**（先取锁再判、条件更新在后）
 * 与**顺序语义**（第二次申请真的读到第一次那一行），这两条加起来是这里可达的最强证据。
 * "PostgreSQL 的行锁真的会阻塞另一个事务"是文档保证的行为，**没有在本仓库实测过**，
 * 所以它记在 ADR-0053 §5 的边界里，而不是在这里当成已证。
 *
 * ## 迁移结构从**发布物**读，不抄第二份
 *
 * 建表 SQL 由 `pricing-ddl.helper.ts` 的 `REFUND_SCHEMA_DDL` 从
 * `prisma/migrations/20261014000000_add_refunds/migration.sql` 读出来，并带约束名锚点。
 * 抄一份的测试只能证明"抄本是对的"，而迁移改了它会更安静地继续通过 ——
 * 同一条教训见那个 helper 的文件头。
 */
import { PGlite } from '@electric-sql/pglite';
import { SUBSCRIPTION_PERIOD_DAYS } from '@heyta/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { REFUND_WINDOW_MS } from '../src/billing/refund-policy';
import {
  applyRefundResult,
  buildOutRefundNo,
  decideRefund,
  isRefundStatus,
  listRefunds,
  refundChannelOf,
  requestRefund,
  submitRefundToChannel,
  REFUND_STATUSES,
} from '../src/billing/refund-store';
import { upsertCoupon, type SqlExecutor, type SqlRunner } from '../src/billing/pricing-store';
import type { CouponDefinition } from '../src/billing/coupon';
import type { BillingAdapter, CreateRefundInput, RefundResult } from '../src/billing/types';
import { PRICING_SCHEMA_DDL, REFUND_SCHEMA_DDL } from './pricing-ddl.helper';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

/**
 * 顺序有讲究：定价那五张表先建（`refunds` 的外键指向 `checkout_orders`），
 * 再建退款表与可被回收的 `subscriptions` 替身。两份 DDL 都来自
 * `pricing-ddl.helper.ts` —— 它读**发布中的迁移文件**并带锚点检查，
 * 所以本文件里没有任何一份手抄的表结构。
 */
const SCHEMA_DDL = `${PRICING_SCHEMA_DDL}\n${REFUND_SCHEMA_DDL}`;

/** 与 `billing-pricing-store.pglite.spec.ts` 同形的执行器（各文件自带夹具，不跨文件共享状态）。 */
const createPgliteExecutor = (pglite: PGlite): SqlExecutor => {
  const executor: SqlExecutor = {
    query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
      const res = await pglite.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    execute: async (sql: string, params: readonly unknown[] = []): Promise<number> => {
      const res = await pglite.query(sql, params as unknown[]);
      return res.affectedRows ?? 0;
    },
    transaction: async <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => {
      await pglite.exec('BEGIN');
      try {
        const result = await fn(executor);
        await pglite.exec('COMMIT');
        return result;
      } catch (error) {
        await pglite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return executor;
};

const norm = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** 把语句记进日志的包装器 —— 用于断言**顺序**（不是断言条数）。 */
const wrapRunner = (inner: SqlRunner, log: string[]): SqlRunner => ({
  query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
    log.push(norm(sql));
    return inner.query<T>(sql, params);
  },
  execute: async (sql: string, params: readonly unknown[] = []): Promise<number> => {
    log.push(norm(sql));
    return inner.execute(sql, params);
  },
});

const wrap = (inner: SqlExecutor, log: string[]): SqlExecutor => ({
  ...wrapRunner(inner, log),
  // 🔴 `BEGIN` 记的是**被测代码开了几次事务**（包装器自己数的），不是 PGlite 的日志。
  // 这条断言问的是"订单 + 券 + 权益是不是在同一次提交里翻"，所以它必须来自这里，
  // 而不是来自 SQL 文本 —— 事务边界在 `transaction()` 那一层，语句文本里看不见。
  transaction: <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => {
    log.push('BEGIN');
    return inner.transaction((tx) => fn(wrapRunner(tx, log)));
  },
});

let db: PGlite;
let base: SqlExecutor;

let seq = 0;

const one = async <T>(sql: string, params: readonly unknown[] = []): Promise<T> => {
  const rows = await base.query<T>(sql, params);
  if (rows.length !== 1) throw new Error(`期望恰好一行，读到 ${rows.length} 行：${norm(sql)}`);
  return rows[0]!;
};

const insertUser = async (email = `u${(seq += 1)}@example.test`): Promise<number> => {
  const rows = await base.query<{ id: number }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
  return Number(rows[0]!.id);
};

/**
 * 造一张收银台订单。默认形态：原价 900、券减 500、**实付 400**。
 *
 * 为什么默认带折扣：`refunds.amount_minor` 冻结的必须是实付，原价与实付不相等
 * 才让"退错金额"在数字上可见（两边都是 400 时，抄错列也测不出来）。
 */
const insertOrder = async (
  userId: number,
  overrides: {
    readonly originalAmountMinor?: number;
    readonly discountMinor?: number;
    readonly paidAt?: number | null;
    readonly status?: string;
    readonly currency?: string;
    readonly provider?: string;
  } = {},
): Promise<number> => {
  const original = overrides.originalAmountMinor ?? 900;
  const discount = overrides.discountMinor ?? 500;
  const paidAt = overrides.paidAt === null ? null : (overrides.paidAt ?? NOW - DAY);
  const status = overrides.status ?? (paidAt === null ? 'pending' : 'paid');
  const rows = await base.query<{ id: number }>(
    `INSERT INTO checkout_orders
       (out_trade_no, user_id, provider, price_id, currency, region,
        original_amount_minor, discount_minor, final_amount_minor,
        status, quoted_at, expires_at, paid_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'hosted-monthly', $4, 'CN', $5, $6, $7, $8, $9, $10, $11, $12, $12)
     RETURNING id`,
    [
      `hy${userId}x${(seq += 1)}xrefund`,
      userId,
      overrides.provider ?? 'wechat',
      overrides.currency ?? 'CNY',
      original,
      discount,
      original - discount,
      status,
      NOW - 2 * HOUR,
      NOW - HOUR,
      paidAt,
      NOW - 3 * HOUR,
    ],
  );
  return Number(rows[0]!.id);
};

/**
 * 核销一行券（`applied`）—— 退款必须把它翻成 `reversed`。
 *
 * 🔴 先经 `upsertCoupon` 发布父行，而不是手抄一条 `INSERT INTO coupons`：
 * `coupon_redemptions.coupon_id` 是真外键，第一版这里就是漏了父行才被库挡下的。
 * 走**发布路径**意味着券表那侧的 CHECK / 必填列由生产代码负责，本文件不复制第二套表结构。
 */
const REDEEMED_COUPON: CouponDefinition = {
  id: 'launch-2026',
  code: 'LAUNCH',
  name: '上线推广',
  benefit: { kind: 'fixed', amountOffMinor: 500 },
  currency: 'CNY',
  priceIds: null,
  validFrom: NOW - HOUR,
  validUntil: NOW + 30 * DAY,
  maxRedemptions: null,
  maxRedemptionsPerUser: null,
  minimumOrderMinor: null,
  firstPurchaseOnly: false,
  regions: null,
  enabled: true,
};

const insertAppliedRedemption = async (userId: number, orderId: number): Promise<void> => {
  await upsertCoupon(base, { definition: REDEEMED_COUPON, actor: 'test', note: '测试', now: NOW });
  await base.execute(
    `INSERT INTO coupon_redemptions
       (coupon_id, user_id, order_id, state, original_amount_minor, discount_minor,
        final_amount_minor, currency, reserved_until, created_at, applied_at)
     VALUES ('launch-2026', $1, $2, 'applied', 900, 500, 400, 'CNY', $3, $4, $4)`,
    [userId, orderId, NOW, NOW - 2 * HOUR],
  );
};

const insertSubscription = async (
  userId: number,
  currentPeriodEnd: number | null,
  overrides: { readonly provider?: string } = {},
): Promise<number> => {
  const rows = await base.query<{ id: number }>(
    `INSERT INTO subscriptions (user_id, provider, status, current_period_end, last_event_at, updated_at)
     VALUES ($1, $2, 'active', $3, $4, $4) RETURNING id`,
    [userId, overrides.provider ?? 'wechat', currentPeriodEnd, NOW - DAY],
  );
  return Number(rows[0]!.id);
};

const readRefund = (id: number) =>
  one<{
    status: string;
    amount_minor: number;
    period_days: number;
    currency: string;
    refunded_at: number | null;
    decided_at: number | null;
    reason: string | null;
    operator_note: string | null;
    provider_refund_id: string | null;
  }>(`SELECT * FROM refunds WHERE id = $1`, [id]);

const readOrder = (id: number) =>
  one<{ status: string; settled_at: number | null; out_trade_no: string; final_amount_minor: number }>(
    `SELECT * FROM checkout_orders WHERE id = $1`,
    [id],
  );

const readSubscription = (userId: number) =>
  one<{ status: string | null; current_period_end: number | null }>(
    `SELECT * FROM subscriptions WHERE user_id = $1 LIMIT 1`,
    [userId],
  );

const countRefunds = async (): Promise<number> => {
  const rows = await base.query<{ n: number }>('SELECT count(*)::int AS n FROM refunds');
  return Number(rows[0]!.n);
};

const auditActions = async (target: string): Promise<string[]> => {
  const rows = await base.query<{ action: string }>(
    `SELECT action FROM pricing_audit_log WHERE target = $1 ORDER BY id`,
    [target],
  );
  return rows.map((r) => r.action);
};

/** 申请 → 批准，返回可用的退款 id。批准后行停在 `approved`，还没发给通道。 */
const requestedRefund = async (
  orderId: number,
  actor = 'admin:1',
): Promise<{ refundId: number; outRefundNo: string; amountMinor: number }> => {
  const result = await requestRefund(base, { orderId, now: NOW, actor });
  if (result.outcome !== 'requested') throw new Error(`测试前提不成立：${result.outcome}`);
  return { refundId: result.refundId, outRefundNo: result.outRefundNo, amountMinor: result.amountMinor };
};

const approve = async (refundId: number): Promise<void> => {
  const decided = await decideRefund(base, {
    refundId,
    decision: 'approve',
    actor: 'admin:1',
    note: '批准',
    now: NOW,
  });
  if (decided.outcome !== 'decided') throw new Error(`测试前提不成立：${decided.outcome}`);
};

/**
 * 只实现 `refund()` 的通道替身，其余四个方法**逐个补桩并抛**。
 *
 * 🔴 不是"用不到就不写"：省略 = 类型上得靠一次 `as` 的谎，而这里要钉住的正是
 * "退款这条路径不会顺手去调下单 / 验签 / 撤销"。
 */
const refundStub = (
  behavior: { readonly ok: true; readonly result: RefundResult } | { readonly ok: false; readonly error: Error },
): { readonly adapter: BillingAdapter; readonly calls: CreateRefundInput[] } => {
  const calls: CreateRefundInput[] = [];
  const adapter: BillingAdapter = {
    provider: 'wechat',
    supportedCurrencies: ['CNY'],
    async createCheckout() {
      throw new Error('退款路径不该下单');
    },
    async verifyWebhook() {
      throw new Error('退款路径不该验签');
    },
    mapSubscriptionState: () => null,
    async revokeEntitlement() {
      throw new Error('退款路径不该走撤销');
    },
    async refund(input) {
      calls.push(input);
      if (behavior.ok) return behavior.result;
      throw behavior.error;
    },
  };
  return { adapter, calls };
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA_DDL);
  base = createPgliteExecutor(db);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(
    'DELETE FROM refunds; DELETE FROM coupon_redemptions; DELETE FROM checkout_orders;' +
      ' DELETE FROM subscriptions; DELETE FROM pricing_audit_log; DELETE FROM users;',
  );
});

describe('🔴 库层：三条 CHECK 挡住的正是那三种半真状态', () => {
  /** 绕过所有应用层函数直接写库 —— 这些用例测的是**结构**，不是状态机。 */
  const insertRawRefund = async (
    orderId: number,
    userId: number,
    values: {
      readonly amount?: number;
      readonly periodDays?: number;
      readonly status?: string;
      readonly refundedAt?: number | null;
      readonly outRefundNo?: string;
    } = {},
  ) =>
    base.execute(
      `INSERT INTO refunds
         (order_id, user_id, provider, out_refund_no, amount_minor, currency, period_days,
          status, refunded_at, created_at, updated_at)
       VALUES ($1, $2, 'wechat', $3, $4, 'CNY', $5, $6, $7, $8, $8)`,
      [
        orderId,
        userId,
        values.outRefundNo ?? `hyrf-raw-${orderId}-${(seq += 1)}`,
        values.amount ?? 400,
        values.periodDays ?? SUBSCRIPTION_PERIOD_DAYS,
        values.status ?? 'requested',
        values.refundedAt ?? null,
        NOW,
      ],
    );

  it('金额必须是正数：0 与负数都进不了库', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    await expect(insertRawRefund(orderId, userId, { amount: 0 })).rejects.toThrow(/refunds_amount_positive/);
    await expect(insertRawRefund(orderId, userId, { amount: -5 })).rejects.toThrow(/refunds_amount_positive/);
    await expect(insertRawRefund(orderId, userId, { amount: 400 })).resolves.toBe(1);
  });

  it('🔴 `period_days = 0` 进不了库 —— 那正是"钱退了、权益一格没动"的形状', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    await expect(insertRawRefund(orderId, userId, { periodDays: 0 })).rejects.toThrow(
      /refunds_period_days_range/,
    );
    // 上界挡的是"把年度档当月度回收"：今天全仓只有 30 天这一段，越界的值只能是写错了。
    await expect(insertRawRefund(orderId, userId, { periodDays: 400 })).rejects.toThrow(
      /refunds_period_days_range/,
    );
  });

  it('🔴 `success ⟺ refunded_at` 是**双向**的：两个方向的后果相反，少测一边就等于没测', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    // 方向一：通道说退成了、我们这边没写时间戳 ⇒ "订单已退款而权益还在"。
    await expect(insertRawRefund(orderId, userId, { status: 'success' })).rejects.toThrow(
      /refunds_success_needs_refunded_at/,
    );
    // 方向二：一条 `failed` 被回收逻辑当成已退 ⇒ "没退钱却扣了天数"。
    await expect(insertRawRefund(orderId, userId, { status: 'failed', refundedAt: NOW })).rejects.toThrow(
      /refunds_success_needs_refunded_at/,
    );
    // 合起来才是这条约束的意义：只测一边时，把另一边删掉照样全绿。
    await expect(insertRawRefund(orderId, userId, { status: 'success', refundedAt: NOW })).resolves.toBe(1);
  });

  it('`out_refund_no` 唯一：同一个号插不进去两次（重试必须换号）', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    await insertRawRefund(orderId, userId, { outRefundNo: 'hyrf-dup' });
    await expect(insertRawRefund(orderId, userId, { outRefundNo: 'hyrf-dup' })).rejects.toThrow(
      /refunds_out_refund_no_key|duplicate key/i,
    );
  });

  it('退款号形状：带订单号（微信后台只能按它搜），同一秒两次申请也不撞号', () => {
    const a = buildOutRefundNo(7, NOW);
    expect(a).toMatch(/^hyrf7x\d{10}x[0-9a-f]{12}$/);
    expect(a).not.toBe(buildOutRefundNo(7, NOW));
    expect(buildOutRefundNo(7, NOW, 'deadbeef')).toBe(`hyrf7x${Math.floor(NOW / 1000)}xdeadbeef`);
  });

  it('状态词表：库不设 CHECK，由 `isRefundStatus` 在写路径上把守（词表本身要能被看见）', () => {
    expect([...REFUND_STATUSES].sort()).toEqual(
      ['abnormal', 'approved', 'closed', 'failed', 'processing', 'rejected', 'requested', 'success'].sort(),
    );
    expect(isRefundStatus('processing')).toBe(true);
    // `refunded` 是**订单**的词，不是退款的词：混用会让条件更新永远挡不住。
    expect(isRefundStatus('refunded')).toBe(false);
    expect(isRefundStatus(undefined)).toBe(false);
  });
});

describe('requestRefund：申请那一步就把金额与天数冻住', () => {
  it('窗口内：落 `requested`，冻的是**实付**而不是原价', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const result = await requestRefund(base, { orderId, now: NOW, actor: 'admin:1' });

    expect(result).toMatchObject({ outcome: 'requested', amountMinor: 400 });
    if (result.outcome !== 'requested') return;
    expect(await readRefund(result.refundId)).toMatchObject({
      status: 'requested',
      amount_minor: 400,
      currency: 'CNY',
      refunded_at: null,
    });
    // 天数 = 授予侧那一段，**不是**这一层自己写的数。
    expect((await readRefund(result.refundId)).period_days).toBe(SUBSCRIPTION_PERIOD_DAYS);
    expect(await auditActions(`refund:${result.refundId}`)).toContain('refund_requested');
  });

  it('🔴 冻结是真的：之后改写订单那一行，退款行一动不动', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const { refundId } = await requestedRefund(orderId);

    // 把这张单改成"没用券"（原价 = 实付 = 900，仍然过 `amounts_coherent`）。
    await base.execute(
      `UPDATE checkout_orders SET discount_minor = 0, final_amount_minor = 900 WHERE id = $1`,
      [orderId],
    );
    expect((await readRefund(refundId)).amount_minor).toBe(400);
  });

  it('超窗默认不退；例外只打开时间窗，且被拒不落退款行', async () => {
    const userId = await insertUser();
    const late = await insertOrder(userId, { paidAt: NOW - REFUND_WINDOW_MS - 1 });
    expect(await requestRefund(base, { orderId: late, now: NOW, actor: 'admin:1' })).toMatchObject({
      outcome: 'denied',
      reason: 'WINDOW_PASSED',
    });
    expect(await auditActions(`order:${late}`)).toContain('refund_denied');
    // 🔴 被拒不落行：否则它会变成一条永远批不掉的僵尸申请，占住"这一单已有开着的退款"。
    expect(await countRefunds()).toBe(0);

    const approved = await requestRefund(base, {
      orderId: late,
      now: NOW,
      actor: 'admin:1',
      operatorApproved: true,
      note: '客诉已线下核实',
    });
    expect(approved.outcome).toBe('requested');
    if (approved.outcome !== 'requested') return;
    expect((await readRefund(approved.refundId)).operator_note).toBe('客诉已线下核实');
  });

  it('🔴 同一单不许有第二条开着的退款（两次批准 = 两次发给通道）', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const { refundId } = await requestedRefund(orderId);

    expect(
      await requestRefund(base, { orderId, now: NOW + MIN, actor: 'admin:2' }),
    ).toMatchObject({ outcome: 'denied', reason: 'REFUND_ALREADY_OPEN' });
    expect(await countRefunds()).toBe(1);
    expect((await readRefund(refundId)).status).toBe('requested');
  });

  it('已 `refunded` 的单报的是那条原因，不是"开着的退款"', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId, { status: 'refunded' });
    expect(
      await requestRefund(base, { orderId, now: NOW, actor: 'admin:1' }),
    ).toMatchObject({ outcome: 'denied', reason: 'ALREADY_REFUNDED' });
  });

  it('未付款 / 已失败的单不可退（`ORDER_NOT_PAYABLE`）', async () => {
    const userId = await insertUser();
    for (const overrides of [{ paidAt: null }, { status: 'failed' }] as const) {
      const orderId = await insertOrder(userId, overrides);
      expect(
        await requestRefund(base, { orderId, now: NOW, actor: 'admin:1' }),
        JSON.stringify(overrides),
      ).toMatchObject({ outcome: 'denied', reason: 'ORDER_NOT_PAYABLE' });
    }
  });

  it('🔴 `rejected` / `failed` 不算"开着"：换一条新申请（换号）是可行路径', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const first = await requestedRefund(orderId);
    expect(
      await decideRefund(base, {
        refundId: first.refundId,
        decision: 'reject',
        actor: 'admin:1',
        note: '不符合口径',
        now: NOW + MIN,
      }),
    ).toMatchObject({ outcome: 'decided', status: 'rejected' });

    const retry = await requestRefund(base, { orderId, now: NOW + 2 * MIN, actor: 'admin:1' });
    expect(retry.outcome).toBe('requested');
    if (retry.outcome !== 'requested') return;
    expect(retry.outRefundNo).not.toBe(first.outRefundNo);
    expect(await countRefunds()).toBe(2);
  });

  it('订单不存在 → not-found；库里币种陌生 → 抛，不按 CNY 猜', async () => {
    expect(await requestRefund(base, { orderId: 999999, now: NOW, actor: 'admin:1' })).toEqual({
      outcome: 'not-found',
    });

    const userId = await insertUser();
    // 想造出"库里有陌生币种"只有一条路：临时把订单表那条 CHECK 拆掉。
    // 这里要证的正是**应用层**自己会拒，而不是靠库兜着。
    await db.exec('ALTER TABLE checkout_orders DROP CONSTRAINT checkout_orders_currency_known');
    try {
      const eur = await insertOrder(userId, { currency: 'EUR' });
      await expect(requestRefund(base, { orderId: eur, now: NOW, actor: 'admin:1' })).rejects.toThrow(
        /不在词表里/,
      );
      expect(await countRefunds()).toBe(0);
    } finally {
      await db.exec('DELETE FROM checkout_orders');
      await db.exec(
        `ALTER TABLE checkout_orders ADD CONSTRAINT checkout_orders_currency_known CHECK (currency IN ('CNY','USD'))`,
      );
    }
    // 约束**必须**是加回来的状态：拆了没装回去，后面每一条用例都在测一个不存在的闸门。
    await expect(insertOrder(await insertUser(), { currency: 'EUR' })).rejects.toThrow(
      /checkout_orders_currency_known/,
    );
  });
});

describe('decideRefund：唯一的闸门是一条条件更新', () => {
  it('批准 → `approved`；第二次批准或拒绝都被挡，且什么都没改', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const { refundId } = await requestedRefund(orderId);

    expect(
      await decideRefund(base, { refundId, decision: 'approve', actor: 'admin:1', note: '确认退款', now: NOW }),
    ).toMatchObject({ outcome: 'decided', status: 'approved' });
    expect(await auditActions(`refund:${refundId}`)).toEqual(['refund_requested', 'refund_decided']);

    expect(
      await decideRefund(base, { refundId, decision: 'approve', actor: 'admin:2', note: '再点一次', now: NOW + MIN }),
    ).toEqual({ outcome: 'not-decidable' });
    expect(
      await decideRefund(base, { refundId, decision: 'reject', actor: 'admin:2', note: '改主意', now: NOW + 2 * MIN }),
    ).toEqual({ outcome: 'not-decidable' });
    // 🔴 第二次连时间和理由都不许动 —— 那才是"两个管理员同时点批准"只有一个生效的证据。
    expect(await readRefund(refundId)).toMatchObject({ status: 'approved', decided_at: NOW });
  });

  it('拒绝把进来了的原因写进行里', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const { refundId } = await requestedRefund(orderId);
    expect(
      await decideRefund(base, {
        refundId,
        decision: 'reject',
        actor: 'admin:1',
        note: '超窗且无客诉',
        now: NOW,
      }),
    ).toMatchObject({ outcome: 'decided', status: 'rejected' });
    expect(await readRefund(refundId)).toMatchObject({
      reason: 'OPERATOR_REJECTED',
      operator_note: '超窗且无客诉',
    });
  });

  it('不存在的 id → not-found（与"已决定过"是两件事：后台要回 404 而不是 409）', async () => {
    expect(
      await decideRefund(base, { refundId: 424242, decision: 'approve', actor: 'admin:1', note: 'x', now: NOW }),
    ).toEqual({ outcome: 'not-found' });
  });
});

describe('submitRefundToChannel：只有通道确认的那一条边动权益', () => {
  it('🔴 没批准的行一步都不许发：`not-submittable`、通道零调用、权益一格不动', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const periodEnd = NOW + 20 * DAY;
    await insertSubscription(userId, periodEnd);
    const { refundId } = await requestedRefund(orderId);
    const { adapter, calls } = refundStub({ ok: true, result: { providerRefundId: 'rf-1', status: 'success' } });

    expect(await submitRefundToChannel(base, { refundId, adapter, now: NOW })).toMatchObject({
      outcome: 'not-submittable',
      status: 'requested',
    });
    expect(calls).toHaveLength(0);
    expect((await readOrder(orderId)).status).toBe('paid');
    expect((await readSubscription(userId)).current_period_end).toBe(periodEnd);
  });

  it('发给通道的请求体：号、金额、币种全部取自**冻结的那一行**', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const { refundId } = await requestedRefund(orderId);
    await approve(refundId);
    const { adapter, calls } = refundStub({
      ok: true,
      result: { providerRefundId: '50300000000', status: 'processing' },
    });
    await submitRefundToChannel(base, { refundId, adapter, now: NOW + MIN });

    expect(calls).toHaveLength(1);
    expect(calls[0]!).toMatchObject({
      outTradeNo: (await readOrder(orderId)).out_trade_no,
      refundAmountMinor: 400,
      totalAmountMinor: 400,
      currency: 'CNY',
    });
    expect(calls[0]!.outRefundNo).toMatch(/^hyrf\d+x\d{10}x[0-9a-f]{12}$/);
  });

  it('通道回 `processing`：只推进状态，`refunded_at` 仍为空、订单仍 `paid`', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const periodEnd = NOW + 20 * DAY;
    await insertSubscription(userId, periodEnd);
    const { refundId } = await requestedRefund(orderId);
    await approve(refundId);
    const { adapter } = refundStub({ ok: true, result: { providerRefundId: '50300000', status: 'processing' } });

    expect(await submitRefundToChannel(base, { refundId, adapter, now: NOW + MIN })).toMatchObject({
      outcome: 'submitted',
      status: 'processing',
    });
    const stored = await readRefund(refundId);
    expect(stored.status).toBe('processing');
    // 🔴 这条边**不许**写 `refunded_at`，而库的 CHECK 保证写了就进不去。
    expect(stored.refunded_at).toBeNull();
    expect((await readOrder(orderId)).status).toBe('paid');
    expect((await readSubscription(userId)).current_period_end).toBe(periodEnd);
  });

  it('🔴 通道抛错 → 行落 `failed` + 原因，权益不动，并且可以再申请一条', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const periodEnd = NOW + 20 * DAY;
    await insertSubscription(userId, periodEnd);
    const { refundId } = await requestedRefund(orderId);
    await approve(refundId);
    // 真的通道错误类都会设 `name`（`wechat.adapter.ts` 那七个都设了）。
    class WechatRefundExceedsPaymentError extends Error {
      constructor() {
        super('退款额超过可退额');
        this.name = 'WechatRefundExceedsPaymentError';
      }
    }
    const { adapter } = refundStub({ ok: false, error: new WechatRefundExceedsPaymentError() });

    expect(await submitRefundToChannel(base, { refundId, adapter, now: NOW + MIN })).toMatchObject({
      outcome: 'channel-failed',
      reason: 'WechatRefundExceedsPaymentError',
    });
    expect(await readRefund(refundId)).toMatchObject({
      status: 'failed',
      reason: 'WechatRefundExceedsPaymentError',
      refunded_at: null,
    });
    expect((await readOrder(orderId)).status).toBe('paid');
    expect((await readSubscription(userId)).current_period_end).toBe(periodEnd);
    expect(await auditActions(`refund:${refundId}`)).toContain('refund_channel_failed');

    expect((await requestRefund(base, { orderId, now: NOW + 2 * MIN, actor: 'admin:1' })).outcome).toBe(
      'requested',
    );
  });

  it('🔴 message 一个字都不许进 `reason`；没名字的错也记成哨兵值而不是 "Error"', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    const { refundId } = await requestedRefund(orderId);
    await approve(refundId);
    const { adapter } = refundStub({ ok: false, error: new Error('响应丢了：<整段通道响应体>') });

    expect(await submitRefundToChannel(base, { refundId, adapter, now: NOW + MIN })).toMatchObject({
      outcome: 'channel-failed',
      reason: 'REFUND_CHANNEL_FAILED',
    });
    const stored = await readRefund(refundId);
    // 断言的是**不包含**：message 里那段通道响应体绝不能被写进这一列（它经后台渲染给运营看）。
    expect(stored.reason).not.toContain('响应丢了');
    expect(stored.reason).not.toContain('<');
  });

  it('🔴 通道当场回 `success`：状态与 `refunded_at` 同一个落点写，权益按那一段回收', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    // 45 天：让"这一单只买了 30 天"在数字上可见（扣满 30 天后还剩 15 天）。
    await insertSubscription(userId, NOW + 45 * DAY);
    const { refundId } = await requestedRefund(orderId);
    await approve(refundId);
    const { adapter } = refundStub({ ok: true, result: { providerRefundId: '50300001', status: 'success' } });

    expect(await submitRefundToChannel(base, { refundId, adapter, now: NOW + MIN })).toMatchObject({
      outcome: 'submitted',
      status: 'success',
    });
    expect(await readRefund(refundId)).toMatchObject({
      status: 'success',
      refunded_at: NOW + MIN,
      provider_refund_id: '50300001',
    });
    expect((await readOrder(orderId)).status).toBe('refunded');
    // 唯一一笔已付订单被翻掉 ⇒ 剩余 0 笔 ⇒ 到期日落到 now，整行失效。
    expect(await readSubscription(userId)).toMatchObject({
      current_period_end: NOW + MIN,
      status: 'expired',
    });
  });
});

describe('applyRefundResult：幂等、非 success、以及 `failed` 那一条边', () => {
  /** 走完整前半程（申请 → 批准 → 发给通道并停在 `processing`），返回通知要用的号。 */
  const inFlight = async (
    subscriptionEnd: number | null,
  ): Promise<{ userId: number; orderId: number; refundId: number; outRefundNo: string }> => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    await insertSubscription(userId, subscriptionEnd);
    const { refundId, outRefundNo } = await requestedRefund(orderId);
    await approve(refundId);
    const { adapter } = refundStub({ ok: true, result: { providerRefundId: null, status: 'processing' } });
    await submitRefundToChannel(base, { refundId, adapter, now: NOW + MIN });
    return { userId, orderId, refundId, outRefundNo };
  };

  it('🔴 同一条 success 重投：第二次 `already-applied`，时间戳与权益都不再变', async () => {
    const { orderId, refundId, outRefundNo } = await inFlight(NOW + 45 * DAY);
    expect(
      await applyRefundResult(base, {
        outRefundNo,
        status: 'success',
        providerRefundId: '50300002',
        now: NOW + 2 * MIN,
      }),
    ).toMatchObject({ outcome: 'retracted', refundId, currentPeriodEnd: NOW + 2 * MIN });
    expect(await readRefund(refundId)).toMatchObject({ status: 'success', refunded_at: NOW + 2 * MIN });

    expect(
      await applyRefundResult(base, {
        outRefundNo,
        status: 'success',
        providerRefundId: '50300002',
        now: NOW + 3 * MIN,
      }),
    ).toEqual({ outcome: 'already-applied', refundId });
    // 🔴 第二次连 `refunded_at` 都不许动：那才是"重投不产生新状态"。
    expect(await readRefund(refundId)).toMatchObject({ status: 'success', refunded_at: NOW + 2 * MIN });
    expect((await readOrder(orderId)).settled_at).toBe(NOW + 2 * MIN);
  });

  it('非 success 只落状态，一格权益都不动', async () => {
    const { userId, orderId, refundId, outRefundNo } = await inFlight(NOW + 45 * DAY);
    expect(
      await applyRefundResult(base, {
        outRefundNo,
        status: 'abnormal',
        providerRefundId: null,
        now: NOW + 2 * MIN,
      }),
    ).toMatchObject({ outcome: 'recorded', status: 'abnormal' });
    expect(await readRefund(refundId)).toMatchObject({ status: 'abnormal', refunded_at: null });
    expect((await readOrder(orderId)).status).toBe('paid');
    expect((await readSubscription(userId)).current_period_end).toBe(NOW + 45 * DAY);

    // 同一个 abnormal 再来一次 = 幂等命中（`status <> $2` 挡掉的）。
    expect(
      await applyRefundResult(base, {
        outRefundNo,
        status: 'abnormal',
        providerRefundId: null,
        now: NOW + 3 * MIN,
      }),
    ).toMatchObject({ outcome: 'already-applied' });
  });

  it('🔴 `failed` 的行收到带签名的 success ⇒ 必须回收（那是"响应丢失"的唯一出路）', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    await insertSubscription(userId, NOW + 45 * DAY);
    const { refundId, outRefundNo } = await requestedRefund(orderId);
    await approve(refundId);
    const { adapter } = refundStub({ ok: false, error: new Error('响应丢了') });
    await submitRefundToChannel(base, { refundId, adapter, now: NOW + MIN });
    expect(await readRefund(refundId)).toMatchObject({ status: 'failed' });

    expect(
      await applyRefundResult(base, {
        outRefundNo,
        status: 'success',
        providerRefundId: '50300003',
        now: NOW + 2 * MIN,
      }),
    ).toMatchObject({ outcome: 'retracted' });
    expect((await readOrder(orderId)).status).toBe('refunded');
  });

  it('陌生的 `out_refund_no` → `unknown-refund`（不是错误，但绝不静默）', async () => {
    expect(
      await applyRefundResult(base, {
        outRefundNo: 'hyrf999x0000000000xdeadbeef',
        status: 'success',
        providerRefundId: null,
        now: NOW,
      }),
    ).toEqual({ outcome: 'unknown-refund' });
  });

  it('🔴 回收量算的是"这一单买的那一段"：两笔已付时只扣 30 天，另一笔不动', async () => {
    const userId = await insertUser();
    // 授予侧的规则是死的：每笔已付订单 +30 天 ⇒ 两笔 = 到期日在 now + 60 天。
    const a = await insertOrder(userId);
    const b = await insertOrder(userId);
    await insertSubscription(userId, NOW + 60 * DAY);

    const ra = await requestedRefund(a);
    await approve(ra.refundId);
    expect(
      await applyRefundResult(base, {
        outRefundNo: ra.outRefundNo,
        status: 'success',
        providerRefundId: null,
        now: NOW + MIN,
      }),
    ).toMatchObject({ outcome: 'retracted', currentPeriodEnd: NOW + 30 * DAY });
    expect((await readOrder(b)).status).toBe('paid');

    // 第二笔也退 ⇒ 剩余 0 笔 ⇒ 整行失效。
    const rb = await requestedRefund(b);
    await approve(rb.refundId);
    expect(
      await applyRefundResult(base, {
        outRefundNo: rb.outRefundNo,
        status: 'success',
        providerRefundId: null,
        now: NOW + 2 * MIN,
      }),
    ).toMatchObject({ outcome: 'retracted', currentPeriodEnd: NOW + 2 * MIN });
    expect(await readSubscription(userId)).toMatchObject({ status: 'expired' });
  });

  it('🔴 顺序判据：先翻订单、后数剩余（反过来用户白拿 30 天，且没有任何一层会报错）', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId);
    // 45 天这一格是**判据的一部分**：反过来数就会得到 1 笔 ⇒ 扣 30 天剩 15 天，
    // 而不是"这笔钱买的时间整段都不该存在"。两个读数不同，这条才会红。
    await insertSubscription(userId, NOW + 45 * DAY);
    const { refundId, outRefundNo } = await requestedRefund(orderId);
    await approve(refundId);

    const log: string[] = [];
    expect(
      await applyRefundResult(wrap(base, log), {
        outRefundNo,
        status: 'success',
        providerRefundId: null,
        now: NOW + MIN,
      }),
    ).toMatchObject({ outcome: 'retracted' });

    const idx = (needle: string): number => log.findIndex((s) => s.includes(needle));
    const flip = idx(`SET status = 'refunded'`);
    const count = idx('count(*)::int AS n FROM checkout_orders');
    // 两条都必须**存在**：拿 `-1` 与 `-1` 比大小就是一条永远通过的判据。
    expect(flip).toBeGreaterThanOrEqual(0);
    expect(count).toBeGreaterThanOrEqual(0);
    expect(flip).toBeLessThan(count);
    // 🔴 整次回收在**一个**事务里：BEGIN 只能出现一次（订单 + 券 + 权益缺一半都说不清）。
    expect(log.filter((s) => s === 'BEGIN')).toHaveLength(1);
  });

  it('券核销翻成 `reversed`，并与订单翻转在同一次回收里', async () => {
    const { userId, orderId, outRefundNo } = await inFlight(NOW + 45 * DAY);
    await insertAppliedRedemption(userId, orderId);
    await applyRefundResult(base, {
      outRefundNo,
      status: 'success',
      providerRefundId: null,
      now: NOW + 2 * MIN,
    });
    const redemption = await one<{ state: string; settled_at: number | null }>(
      `SELECT * FROM coupon_redemptions WHERE order_id = $1`,
      [orderId],
    );
    expect(redemption.state).toBe('reversed');
    expect(redemption.settled_at).toBe(NOW + 2 * MIN);
  });

  it('🔴 没有可回收的订阅行 / 到期日是空：钱照退，但**不发明**一个到期日', async () => {
    const noSub = await insertUser();
    const orderNoSub = await insertOrder(noSub);
    const r1 = await requestedRefund(orderNoSub);
    await approve(r1.refundId);
    expect(
      await applyRefundResult(base, {
        outRefundNo: r1.outRefundNo,
        status: 'success',
        providerRefundId: null,
        now: NOW + MIN,
      }),
    ).toMatchObject({ outcome: 'retracted', currentPeriodEnd: null });
    expect((await readOrder(orderNoSub)).status).toBe('refunded');
    expect(await auditActions(`refund:${r1.refundId}`)).toContain('refund_retraction_skipped');

    const nullEnd = await insertUser();
    const orderNullEnd = await insertOrder(nullEnd);
    await insertSubscription(nullEnd, null);
    const r2 = await requestedRefund(orderNullEnd);
    await approve(r2.refundId);
    await applyRefundResult(base, {
      outRefundNo: r2.outRefundNo,
      status: 'success',
      providerRefundId: null,
      now: NOW + MIN,
    });
    expect((await readSubscription(nullEnd)).current_period_end).toBeNull();
    expect(await auditActions(`refund:${r2.refundId}`)).toContain('refund_retraction_skipped');
  });
});

describe('后台读的那两面：挑通道与列表', () => {
  it('`refundChannelOf` 报的是**订单当初的 provider**，不是这台实例现在配了哪家', async () => {
    const userId = await insertUser();
    const orderId = await insertOrder(userId, { provider: 'alipay_legacy' });
    const { refundId } = await requestedRefund(orderId);
    expect(await refundChannelOf(base, refundId)).toMatchObject({
      provider: 'alipay_legacy',
      status: 'requested',
    });
    expect(await refundChannelOf(base, 424242)).toBeNull();
  });

  it('列表按账号取、新→旧，并且不串到别人的退款', async () => {
    const a = await insertUser('a@example.test');
    const b = await insertUser('b@example.test');
    await requestedRefund(await insertOrder(a));
    await requestedRefund(await insertOrder(a));
    await requestedRefund(await insertOrder(b));

    const forA = await listRefunds(base, { userId: a });
    expect(forA).toHaveLength(2);
    expect(forA.every((r) => r.userId === a)).toBe(true);
    expect(forA[0]!.id).toBeGreaterThan(forA[1]!.id);
    expect((await listRefunds(base, { userId: b })).map((r) => r.userId)).toEqual([b]);
    expect(await listRefunds(base)).toHaveLength(3);
  });
});
