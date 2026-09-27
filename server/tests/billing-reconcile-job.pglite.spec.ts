import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `reconcile-job.ts` —— 把对账接到 Prisma 上的那层**薄胶水**，用真 SQL 驱动着测。
 *
 * ## 为什么需要这个文件
 *
 * `billing-reconcile.pglite.spec.ts` 覆盖的是 `reconcile.ts` 的纯逻辑，它**绕过**
 * 了本文件：把 Prisma 包成 `SqlExecutor`、给每条订单开一个事务、把 `input` 的三个
 * 字段（`now` / `provider` / `paymentEventIdPrefix` / `limit`）如实透传下去。
 * 参数顺序写反、事务边界画错、时钟读错 —— 纯逻辑测试一条都抓不到。
 *
 * ## 这里怎么做到"真经过胶水"
 *
 * 我们不 mock 掉胶水，而是**从外面递一个 PGlite 支撑的假 Prisma client**
 * （`runBillingReconciliation` 的第三参，默认值是生产 `prisma`）：
 *
 * - `$queryRawUnsafe` / `$executeRawUnsafe` 直接打 PGlite（**真 PostgreSQL 语义**），
 *   并**按 Prisma 的形状返回**：查询给一个行数组（不是 `{ rows }`），
 *   执行给受影响行数（不是 `{ rowCount }`）；
 * - `$transaction` 用 `BEGIN` / `COMMIT` / `ROLLBACK` 真开事务，并**数次数**；
 * - `tx.subscription.*` 是内存替身（权益写入的存储与本主题无关，见下）。
 *
 * 因此断言的每一条都真的穿过了 `reconcile-job.ts`：
 * 参数数组（`$1/$2/$3` 的顺序）、事务打开次数、真实回滚后的库状态。
 *
 * ## 不证明什么
 *
 * `tx.subscription.*` 是替身而不是真 Prisma：权益**存储**的形状不在本文件范围内
 * （真实 Prisma 的 `subscription` 委托在 CI 里没有 PostgreSQL）。SQL 本身、参数、
 * 事务边界、以及结算对订单/券的真实写入都在 PGlite 上真跑。
 */

const { prismaMock } = vi.hoisted(() => ({
  // `reconcile-job.ts` / `webhook.routes.ts` 在模块顶层 `import { prisma }`；
  // 这里只为让 import 成立。测试永远走注入的 client，并断言这个 mock 没被动过。
  prismaMock: {
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    subscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../src/db', () => ({ prisma: prismaMock }));

import { DEFAULT_RECONCILE_LIMIT } from '../src/billing/reconcile';
import { runBillingReconciliation } from '../src/billing/reconcile-job';
import type { ReconcilePrismaClient } from '../src/billing/reconcile-job';
import { PAYMENT_EVENTS_SCHEMA_DDL, PRICING_SCHEMA_DDL } from './pricing-ddl.helper';

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface QueryCall {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface SubRow {
  readonly id: number;
  readonly userId: number;
  readonly provider: string;
  readonly externalSubscriptionId: string | null;
  readonly status: string;
  readonly currentPeriodEnd: number | null;
  readonly lastEventAt: number;
  readonly priceId: string | null;
  readonly grants: readonly string[];
}

interface HarnessOptions {
  /**
   * 把整数列以**字符串**返回（node-postgres 传统上对 int8 就是字符串，
   * Prisma 对 `BigInt` 列返回 `bigint`）。用来证明胶水读的字段名与归一化
   * 没写死某一种驱动类型 —— 读错字段会变成 `Number(undefined)` / 非法时间。
   */
  readonly coerceIntegersToString?: boolean;
}

/** 一个 Prisma 形状、PGlite 支撑的假 client —— 记录每一次 SQL 调用与事务次数。 */
const createHarness = (pglite: PGlite, options: HarnessOptions = {}) => {
  const queryCalls: QueryCall[] = [];
  const executeCalls: QueryCall[] = [];
  let transactions = 0;
  let commits = 0;
  let rollbacks = 0;
  let failNextQuery = false;
  let failSubscriptionCreateForUser: number | null = null;

  const subRows = new Map<number, SubRow>();
  let seq = 0;

  const coerce = (rows: readonly Record<string, unknown>[]): unknown[] => {
    if (options.coerceIntegersToString !== true) return [...rows];
    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
      }
      return out;
    });
  };

  // Prisma 的 `$queryRawUnsafe` 返回**行数组**；这里原样照做。
  const $queryRawUnsafe = async (sql: string, ...params: unknown[]): Promise<unknown[]> => {
    if (failNextQuery) {
      failNextQuery = false;
      throw new Error('candidate query exploded (test hook)');
    }
    queryCalls.push({ sql, params });
    const result = await pglite.query(sql, params);
    return coerce(result.rows as readonly Record<string, unknown>[]);
  };

  // Prisma 的 `$executeRawUnsafe` 返回**受影响行数**（number，不是对象）。
  const $executeRawUnsafe = async (sql: string, ...params: unknown[]): Promise<number> => {
    executeCalls.push({ sql, params });
    const result = await pglite.query(sql, params);
    return result.affectedRows ?? 0;
  };

  const subscription = {
    findFirst: async (args: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      for (const row of subRows.values()) {
        const matchesExternal =
          where.externalSubscriptionId === undefined ||
          row.externalSubscriptionId === where.externalSubscriptionId;
        const matchesUser = where.userId === undefined || row.userId === where.userId;
        const matchesProvider = where.provider === undefined || row.provider === where.provider;
        if (matchesExternal && matchesUser && matchesProvider) {
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
    create: async (args: { data: Omit<SubRow, 'id'> }) => {
      if (failSubscriptionCreateForUser !== null && args.data.userId === failSubscriptionCreateForUser) {
        throw new Error(`subscription.create exploded for userId=${args.data.userId} (test hook)`);
      }
      seq += 1;
      subRows.set(seq, { id: seq, ...args.data });
      return { id: seq };
    },
    update: async (args: { where: { id: number }; data: Partial<SubRow> }) => {
      const previous = subRows.get(args.where.id);
      if (previous === undefined) return null;
      const next = { ...previous, ...args.data };
      subRows.set(args.where.id, next);
      return next;
    },
  };

  const tx = { $queryRawUnsafe, $executeRawUnsafe, subscription };

  const client = {
    $queryRawUnsafe,
    $executeRawUnsafe,
    subscription,
    $transaction: async <T>(fn: (transaction: ReconcilePrismaClient) => Promise<T>): Promise<T> => {
      transactions += 1;
      await pglite.exec('BEGIN');
      try {
        const result = await fn(tx as unknown as ReconcilePrismaClient);
        await pglite.exec('COMMIT');
        commits += 1;
        return result;
      } catch (error) {
        await pglite.exec('ROLLBACK');
        rollbacks += 1;
        throw error;
      }
    },
  } as unknown as ReconcilePrismaClient;

  return {
    client,
    queryCalls,
    executeCalls,
    stats: () => ({ transactions, commits, rollbacks }),
    armQueryFailure: () => {
      failNextQuery = true;
    },
    armSubscriptionCreateFailure: (userId: number) => {
      failSubscriptionCreateForUser = userId;
    },
    subscriptions: (): readonly SubRow[] => [...subRows.values()],
  };
};

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`${PRICING_SCHEMA_DDL}\n${PAYMENT_EVENTS_SCHEMA_DDL}`);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(
    `TRUNCATE coupon_redemptions, checkout_orders, payment_events, pricing_audit_log,
              coupons, subscriptions, users RESTART IDENTITY CASCADE`,
  );
  prismaMock.$transaction.mockClear();
  prismaMock.$queryRawUnsafe.mockClear();
  prismaMock.$executeRawUnsafe.mockClear();
});

const insertUser = async (email: string): Promise<number> => {
  const result = await db.query<{ id: unknown }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email],
  );
  return Number(result.rows[0]!.id);
};

interface InsertOrderInput {
  readonly userId: number;
  readonly outTradeNo: string;
  readonly provider?: string;
  readonly status?: 'pending' | 'expired' | 'paid';
  readonly amountMinor?: number;
  readonly priceId?: string;
}

const insertOrder = async (input: InsertOrderInput): Promise<number> => {
  const amount = input.amountMinor ?? 500;
  const result = await db.query<{ id: unknown }>(
    `INSERT INTO checkout_orders
       (out_trade_no, user_id, provider, price_id, currency, region,
        original_amount_minor, discount_minor, final_amount_minor,
        coupon_id, status, quoted_at, expires_at, rejected_coupons_json,
        paid_at, settled_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'CNY', 'CN', $5, 0, $5, NULL, $6, $7, $8, NULL,
             NULL, NULL, $7, $7)
     RETURNING id`,
    [
      input.outTradeNo,
      input.userId,
      input.provider ?? 'wechat',
      input.priceId ?? 'hosted-monthly',
      amount,
      input.status ?? 'pending',
      NOW,
      NOW + 2 * 60 * 60 * 1000,
    ],
  );
  return Number(result.rows[0]!.id);
};

const insertPaymentEvent = async (input: {
  readonly providerEventId: string;
  readonly provider?: string;
  readonly occurredAt?: number | null;
}): Promise<void> => {
  await db.query(
    `INSERT INTO payment_events (provider, provider_event_id, event_type, occurred_at, received_at)
     VALUES ($1, $2, 'payment_succeeded', $3, $4)`,
    [
      input.provider ?? 'wechat',
      input.providerEventId,
      input.occurredAt === undefined ? NOW : input.occurredAt,
      NOW,
    ],
  );
};

const readOrder = async (
  orderId: number,
): Promise<{ status: string; providerEventId: string | null; paidAt: unknown }> => {
  const result = await db.query<{
    status: unknown;
    provider_event_id: unknown;
    paid_at: unknown;
  }>('SELECT status, provider_event_id, paid_at FROM checkout_orders WHERE id = $1', [orderId]);
  const row = result.rows[0]!;
  return {
    status: String(row.status),
    providerEventId:
      row.provider_event_id === null || row.provider_event_id === undefined
        ? null
        : String(row.provider_event_id),
    paidAt: row.paid_at,
  };
};

/** 找出"候选查询"那一次 `$queryRawUnsafe` —— 用它断言参数顺序。 */
const candidateQueryCalls = (calls: readonly QueryCall[]): readonly QueryCall[] =>
  calls.filter((call) => call.sql.includes('FROM checkout_orders o'));

describe('reconcile-job：把对账接到 Prisma 上的胶水', () => {
  it('🔴 入口契约 + 参数映射：候选 SQL 的参数按 $1/$2/$3 顺序透传，订单被真结算', async () => {
    const userId = await insertUser('job-happy@example.com');
    const orderId = await insertOrder({ userId, outTradeNo: 'job-1' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:job-1' });
    const harness = createHarness(db);

    const report = await runBillingReconciliation({}, () => NOW, harness.client);

    expect(report).toMatchObject({ scanned: 1, settled: 1, skipped: 0, refused: 0 });
    expect(report.outcomes[0]!.settlement).toMatchObject({
      outcome: 'granted',
      orderId,
      priceId: 'hosted-monthly',
    });
    expect(report.outcomes[0]!.applied).toMatchObject({ status: 'applied' });

    // 真 SQL：订单推进到 paid，并写上找到它的那条事件 id。
    expect(await readOrder(orderId)).toMatchObject({
      status: 'paid',
      providerEventId: 'payment_succeeded:job-1',
    });
    expect(harness.subscriptions()).toHaveLength(1);
    expect(harness.subscriptions()[0]).toMatchObject({ provider: 'wechat', priceId: 'hosted-monthly' });

    // 🔴 参数映射：$1 = provider、$2 = 事件前缀、$3 = limit（默认 500）。
    // 顺序对调 / limit 丢失 / 前缀没传，都会在这里露出来。
    const calls = candidateQueryCalls(harness.queryCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual(['wechat', 'payment_succeeded:', DEFAULT_RECONCILE_LIMIT]);
    // SQL 文本把参数用在它该在的位置（$2 拼事件 id、$3 限流）。
    expect(calls[0]!.sql).toContain('e.provider_event_id = $2::text || o.out_trade_no');
    expect(calls[0]!.sql).toContain('LIMIT $3');

    // 胶水用的是注入的 client，不是模块顶层的生产 prisma。
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(prismaMock.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 自定义 provider / 事件前缀 / limit 被如实透传（不是只在默认值上碰巧对）', async () => {
    const userA = await insertUser('job-ali-1@example.com');
    const userB = await insertUser('job-ali-2@example.com');
    const userC = await insertUser('job-wx@example.com');
    const ali1 = await insertOrder({ userId: userA, outTradeNo: 'ali-1', provider: 'alipay' });
    const ali2 = await insertOrder({ userId: userB, outTradeNo: 'ali-2', provider: 'alipay' });
    const wx1 = await insertOrder({ userId: userC, outTradeNo: 'wx-1', provider: 'wechat' });
    await insertPaymentEvent({ providerEventId: 'alipay_paid:ali-1', provider: 'alipay' });
    await insertPaymentEvent({ providerEventId: 'alipay_paid:ali-2', provider: 'alipay' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:wx-1', provider: 'wechat' });
    const harness = createHarness(db);

    const report = await runBillingReconciliation(
      { provider: 'alipay', paymentEventIdPrefix: 'alipay_paid:', limit: 1 },
      () => NOW,
      harness.client,
    );

    const calls = candidateQueryCalls(harness.queryCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual(['alipay', 'alipay_paid:', 1]);

    // limit=1 真的限制了候选数，且只结算了 alipay 的那一张、没有碰 wechat。
    expect(report).toMatchObject({ scanned: 1, settled: 1, refused: 0 });
    expect((await readOrder(ali1)).status).toBe('paid');
    expect((await readOrder(ali2)).status).toBe('pending');
    expect((await readOrder(wx1)).status).toBe('pending');
    expect(harness.subscriptions()).toHaveLength(1);
    expect(harness.subscriptions()[0]).toMatchObject({ provider: 'alipay', userId: userA });
  });

  it('🔴 结果字段映射：整数列以字符串返回（node-postgres 形状）时仍读对字段', async () => {
    const userId = await insertUser('job-strings@example.com');
    const orderId = await insertOrder({ userId, outTradeNo: 'job-str', amountMinor: 1234 });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:job-str' });
    const harness = createHarness(db, { coerceIntegersToString: true });

    const report = await runBillingReconciliation({}, () => NOW, harness.client);

    expect(report).toMatchObject({ scanned: 1, settled: 1 });
    expect(report.outcomes[0]!.settlement).toMatchObject({ outcome: 'granted', orderId });
    expect(await readOrder(orderId)).toMatchObject({
      status: 'paid',
      providerEventId: 'payment_succeeded:job-str',
    });
    // occurredAt 走 `toMillis`（接受 string/bigint/number）；如果读错列名，
    // 这里会是 null，候选会被当成"没有时间戳"而 skipped。
    expect(report.outcomes[0]!.settlement).not.toBeNull();
  });

  it('🔴 事务边界：每张订单一个事务（2 张 = 2 次），不是全部一个', async () => {
    const userA = await insertUser('job-tx-1@example.com');
    const userB = await insertUser('job-tx-2@example.com');
    const orderA = await insertOrder({ userId: userA, outTradeNo: 'job-tx-1' });
    const orderB = await insertOrder({ userId: userB, outTradeNo: 'job-tx-2' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:job-tx-1' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:job-tx-2' });
    const harness = createHarness(db);

    const report = await runBillingReconciliation({}, () => NOW, harness.client);

    expect(report).toMatchObject({ scanned: 2, settled: 2, refused: 0 });
    expect(harness.stats()).toEqual({ transactions: 2, commits: 2, rollbacks: 0 });
    expect((await readOrder(orderA)).status).toBe('paid');
    expect((await readOrder(orderB)).status).toBe('paid');
  });

  it('🔴 一单失败不拖垮其他单：抛错的那单真回滚，另一单照常结算', async () => {
    const userOk = await insertUser('job-iso-ok@example.com');
    const userBad = await insertUser('job-iso-bad@example.com');
    const orderOk = await insertOrder({ userId: userOk, outTradeNo: 'job-iso-ok' });
    const orderBad = await insertOrder({ userId: userBad, outTradeNo: 'job-iso-bad' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:job-iso-ok' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:job-iso-bad' });
    const harness = createHarness(db);
    // 权益写入对 userBad 抛错 → 该订单的整个事务必须回滚。
    harness.armSubscriptionCreateFailure(userBad);

    const report = await runBillingReconciliation({}, () => NOW, harness.client);

    expect(report).toMatchObject({ scanned: 2, settled: 1, refused: 1 });
    // 好单结算并留下权益。
    expect((await readOrder(orderOk)).status).toBe('paid');
    expect(harness.subscriptions()).toHaveLength(1);
    expect(harness.subscriptions()[0]).toMatchObject({ userId: userOk });
    // 坏单**真回滚**：订单停在 pending（事务内那次 UPDATE 被撤销），没有权益行。
    expect((await readOrder(orderBad)).status).toBe('pending');
    expect(harness.stats()).toEqual({ transactions: 2, commits: 1, rollbacks: 1 });
  });

  it('🔴 零候选：干净的成功 + 零副作用（不开事务、不写任何行）', async () => {
    const harness = createHarness(db);

    const report = await runBillingReconciliation({}, () => NOW, harness.client);

    expect(report).toEqual({ scanned: 0, settled: 0, skipped: 0, refused: 0, outcomes: [] });
    expect(harness.stats()).toEqual({ transactions: 0, commits: 0, rollbacks: 0 });
    expect(candidateQueryCalls(harness.queryCalls)).toHaveLength(1);
    // 没有任何写：`$executeRawUnsafe` 一次都没被调用。
    expect(harness.executeCalls).toHaveLength(0);
    expect(harness.subscriptions()).toHaveLength(0);
  });

  it('入口契约：候选查询失败会抛出（不是伪装成空报告）', async () => {
    const harness = createHarness(db);
    harness.armQueryFailure();

    await expect(runBillingReconciliation({}, () => NOW, harness.client)).rejects.toThrow(
      'candidate query exploded (test hook)',
    );
    expect(harness.stats().transactions).toBe(0);
  });

  it('🔴 时钟：第二参时钟生效，且 input.now 覆盖它', async () => {
    const userA = await insertUser('job-clock-1@example.com');
    const userB = await insertUser('job-clock-2@example.com');
    const orderA = await insertOrder({ userId: userA, outTradeNo: 'job-clock-1' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:job-clock-1' });
    const harness = createHarness(db);
    const clock = (): number => 111;

    await runBillingReconciliation({}, clock, harness.client);
    // 第二参时钟被用上（不是 Date.now）。
    expect(Number((await readOrder(orderA)).paidAt)).toBe(111);
    expect(harness.subscriptions()[0]!.currentPeriodEnd).toBe(111 + 30 * DAY_MS);

    // 第二张订单在第一次跑之后才出现 —— 确保它是第二轮唯一候选，
    // 于是 `input.now` 与注入时钟的优先级能被单独观测。
    const orderB = await insertOrder({ userId: userB, outTradeNo: 'job-clock-2' });
    await insertPaymentEvent({ providerEventId: 'payment_succeeded:job-clock-2' });

    await runBillingReconciliation({ now: 222 }, clock, harness.client);
    // `input.now` 优先于注入的时钟。
    expect(Number((await readOrder(orderB)).paidAt)).toBe(222);
  });
});
