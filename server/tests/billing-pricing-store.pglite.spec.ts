import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COUNTED_REDEMPTION_STATES,
  CouponDefinitionRejectedError,
  CouponQuotaExceededError,
  PriceVersionConflictError,
  createOrderWithReservation,
  createPrismaSqlExecutor,
  expireStaleOrders,
  loadCoupons,
  loadCouponUsage,
  loadPriceOverrides,
  publishPriceVersion,
  reverseOrderOnRefund,
  settleOrderPaid,
  toMillis,
  upsertCoupon,
  type PrismaLikeClient,
  type SqlExecutor,
} from '../src/billing/pricing-store';
import { DEFAULT_PRICE_BOOK, resolveEffectivePrice } from '../src/billing/price-book';
import { quoteOrder } from '../src/billing/quote';
import { normalizeCouponCode, type CouponDefinition } from '../src/billing/coupon';
import { PRICING_SCHEMA_DDL } from './pricing-ddl.helper';

/**
 * 持久化层的证据文件：**真的 PostgreSQL**（PGlite）上跑真的 SQL。
 *
 * ## 为什么不是"注入一个内存假 store"
 *
 * 这一层要证明的东西全部是**数据库语义**：行锁、唯一约束、CHECK 约束、
 * 事务回滚。用内存假 store 测这些，测到的是"假 store 的实现"，与发布物无关
 * （同一个教训见 `migration-index.helper.ts` 的文件头）。
 *
 * ## 🔴 单连接 ⇒ 真并发测不了，这一点不掩饰
 *
 * PGlite 是**单连接**的，两个 `BEGIN` 无法并存，所以"两个并发请求抢最后一张券"
 * 在这里跑不出真交错。本文件因此分两层给证据：
 *
 * 1. **顺序语义**：把名额用满 → 下一次预留真的抛 `CouponQuotaExceededError`；
 *    sweep 之后同一个名额真的被放出来。这是限额的**行为**证据。
 * 2. **机制形状**：用一个记录语句的执行器断言"锁行 → 数名额 → 插入"**在同一个
 *    事务里、按这个顺序**发生。把 `FOR UPDATE` 删掉或把计数挪出事务，这条会红。
 *
 * 剩下那一小块 —— "PostgreSQL 的行锁真的会阻塞另一个事务" —— 是 PostgreSQL
 * 文档明确保证的行为（见 `docs/reference/pricing-and-coupons.md` §3 的引用），
 * 但它**没有在本仓库里被实测过**，所以在该文档 §7 的不核实项里写明。
 */

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

let db: PGlite;
let base: SqlExecutor;

/** 把语句记进日志的包装器。用于断言**顺序**与**事务边界**。 */
const wrap = (inner: SqlExecutor, log: string[]): SqlExecutor => ({
  query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
    log.push(sql.replace(/\s+/g, ' ').trim());
    return inner.query<T>(sql, params);
  },
  execute: async (sql: string, params: readonly unknown[] = []): Promise<number> => {
    log.push(sql.replace(/\s+/g, ' ').trim());
    return inner.execute(sql, params);
  },
  transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> =>
    inner.transaction((tx) => fn(wrap(tx, log))),
});

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
    transaction: async <T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> => {
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

let userSeq = 0;
const freshUser = async (): Promise<number> => {
  userSeq += 1;
  const res = await base.query<{ id: number }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [`u${userSeq}@example.test`],
  );
  return Number(res[0]!.id);
};

const couponDef = (overrides: Partial<CouponDefinition> = {}): CouponDefinition => ({
  id: 'launch-2026',
  code: 'LAUNCH',
  name: '上线推广',
  benefit: { kind: 'fixed', amountOffMinor: 2_000 },
  currency: 'CNY',
  priceIds: null,
  validFrom: NOW - HOUR,
  validUntil: NOW + 30 * 24 * HOUR,
  maxRedemptions: null,
  maxRedemptionsPerUser: null,
  minimumOrderMinor: null,
  firstPurchaseOnly: false,
  regions: null,
  enabled: true,
  ...overrides,
});

const publishCoupon = (def: CouponDefinition, now = NOW) =>
  upsertCoupon(base, { definition: def, actor: 'test', note: '测试', now });

/**
 * **只报价**：不改任何状态。返回的是一份可以落库的报价快照。
 *
 * 拆出这一步是为了能**忠实地模拟并发**：PGlite 是单连接，没法让两个事务真交错，
 * 但"两个请求都先拿到一份'名额还够'的报价，然后先后去预留"是**可以**在这里
 * 精确重放的 —— 而那正是线上并发抢最后一张券时发生的每一件事。
 */
const buildQuote = async (
  userId: number,
  options: { readonly codes?: readonly string[]; readonly now?: number } = {},
) => {
  const now = options.now ?? NOW;
  const { coupons } = await loadCoupons(base);
  const codes = options.codes ?? [];
  const usage = await loadCouponUsage(
    base,
    codes.map(normalizeCouponCode).flatMap((c) => {
      const hit = coupons.find((x) => x.code === c);
      return hit === undefined ? [] : [hit.id];
    }),
    userId,
  );
  return quoteOrder(
    { priceId: 'annual', currency: 'CNY', region: 'CN', candidateCodes: codes, usageByCouponId: usage },
    {
      baseline: DEFAULT_PRICE_BOOK,
      overrides: await loadPriceOverrides(base),
      couponsByCode: new Map(coupons.filter((c) => c.code !== null).map((c) => [c.code!, c])),
      now,
    },
  );
};

/** **把一份已经算好的报价冻进库里**，并预留名额。这是唯一会改状态的一步。 */
const reserve = (userId: number, quote: ReturnType<typeof quoteOrder>, options: { readonly outTradeNo?: string; readonly now?: number } = {}) =>
  createOrderWithReservation(base, {
    userId,
    provider: 'wechat',
    outTradeNo: options.outTradeNo ?? `hy${userId}x${Math.random().toString(36).slice(2, 8)}xdeadbeef`,
    quote,
    now: options.now ?? NOW,
  });

/** 报价 + 建单一条龙（顺序路径，测试里最常用）。 */
const placeOrder = async (
  userId: number,
  options: { readonly codes?: readonly string[]; readonly outTradeNo?: string; readonly now?: number } = {},
) => {
  const quote = await buildQuote(userId, options);
  const created = await reserve(userId, quote, options);
  return { quote, ...created };
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(PRICING_SCHEMA_DDL);
  base = createPgliteExecutor(db);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(
    'DELETE FROM coupon_redemptions; DELETE FROM checkout_orders; DELETE FROM coupons; DELETE FROM price_versions; DELETE FROM pricing_audit_log; DELETE FROM users;',
  );
});

describe('时间戳归一化：驱动差异的收敛点', () => {
  it('number / bigint / 十进制字符串都接受（Prisma 给 bigint、node-postgres 给 string）', () => {
    expect(toMillis(1_800_000_000_000)).toBe(1_800_000_000_000);
    expect(toMillis(1_800_000_000_000n)).toBe(1_800_000_000_000);
    expect(toMillis('1800000000000')).toBe(1_800_000_000_000);
  });

  it('非法值返回 undefined，**不**静默当成 0（那会让报价窗口变成 1970 年）', () => {
    for (const bad of [-1, 1.5, 'abc', '', '1e3', null, undefined, Number.NaN, 2n ** 63n]) {
      expect(toMillis(bad)).toBeUndefined();
    }
  });
});

describe('改价：append 一版，不是就地改一行', () => {
  it('第一次改价只是插入一版，不关闭任何东西', async () => {
    const result = await publishPriceVersion(base, {
      entry: { priceId: 'annual', currency: 'CNY', amountMinor: 6_900, effectiveFrom: 0, effectiveUntil: null },
      effectiveFrom: NOW,
      actor: '运营',
      note: '双十一',
    });
    expect(result.closedVersionId).toBeNull();
    const rows = await loadPriceOverrides(base);
    expect(rows).toEqual([
      { priceId: 'annual', currency: 'CNY', amountMinor: 6_900, effectiveFrom: NOW, effectiveUntil: null, note: '双十一' },
    ]);
  });

  it('第二次改价把上一版收口，新的一版接管 —— 任何时刻只有一版生效', async () => {
    await publishPriceVersion(base, {
      entry: { priceId: 'annual', currency: 'CNY', amountMinor: 6_900, effectiveFrom: 0, effectiveUntil: null },
      effectiveFrom: NOW,
      actor: '运营',
      note: '双十一',
    });
    const second = await publishPriceVersion(base, {
      entry: { priceId: 'annual', currency: 'CNY', amountMinor: 7_900, effectiveFrom: 0, effectiveUntil: null },
      effectiveFrom: NOW + 7 * 24 * HOUR,
      actor: '运营',
      note: '恢复价',
    });
    expect(second.closedVersionId).not.toBeNull();

    const rows = await loadPriceOverrides(base);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ amountMinor: 6_900, effectiveUntil: NOW + 7 * 24 * HOUR });
    expect(rows[1]).toMatchObject({ amountMinor: 7_900, effectiveUntil: null });

    // 用同一个解析函数按**两个时间点**各问一次 —— 这就是"历史订单能按当时的价格解释"。
    const during = resolveEffectivePrice(DEFAULT_PRICE_BOOK, rows, {
      priceId: 'annual',
      currency: 'CNY',
      now: NOW + HOUR,
    });
    const after = resolveEffectivePrice(DEFAULT_PRICE_BOOK, rows, {
      priceId: 'annual',
      currency: 'CNY',
      now: NOW + 8 * 24 * HOUR,
    });
    expect(during.amountMinor).toBe(6_900);
    expect(after.amountMinor).toBe(7_900);
  });

  it('🔴 新版生效时刻不晚于旧版起点 → 拒绝（否则两版会重叠，报价变成未定义）', async () => {
    await publishPriceVersion(base, {
      entry: { priceId: 'annual', currency: 'CNY', amountMinor: 6_900, effectiveFrom: 0, effectiveUntil: null },
      effectiveFrom: NOW,
      actor: '运营',
      note: '双十一',
    });
    await expect(
      publishPriceVersion(base, {
        entry: { priceId: 'annual', currency: 'CNY', amountMinor: 5_900, effectiveFrom: 0, effectiveUntil: null },
        effectiveFrom: NOW,
        actor: '运营',
        note: '错误的重叠',
      }),
    ).rejects.toThrow(PriceVersionConflictError);
    // 被拒之后价目表仍然是"一版开区间"，没有被写坏。
    const rows = await loadPriceOverrides(base);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.effectiveUntil).toBeNull();
  });

  it('非法的金额在**写库前**就被拒（价目表坏掉没有合理的降级行为）', async () => {
    await expect(
      publishPriceVersion(base, {
        entry: { priceId: 'annual', currency: 'CNY', amountMinor: 0, effectiveFrom: 0, effectiveUntil: null },
        effectiveFrom: NOW,
        actor: '运营',
        note: '0 元',
      }),
    ).rejects.toThrow();
  });

  it('每一次改价都留审计，且 before/after 都有值', async () => {
    await publishPriceVersion(base, {
      entry: { priceId: 'annual', currency: 'CNY', amountMinor: 6_900, effectiveFrom: 0, effectiveUntil: null },
      effectiveFrom: NOW,
      actor: '运营甲',
      note: '双十一',
    });
    await publishPriceVersion(base, {
      entry: { priceId: 'annual', currency: 'CNY', amountMinor: 7_900, effectiveFrom: 0, effectiveUntil: null },
      effectiveFrom: NOW + HOUR,
      actor: '运营乙',
      note: '恢复',
    });
    const audit = await base.query<{ actor: string; before_json: string | null; after_json: string | null }>(
      `SELECT actor, before_json, after_json FROM pricing_audit_log ORDER BY id`,
    );
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actor: '运营甲', before_json: null, after_json: expect.stringContaining('6900') });
    expect(audit[1]).toMatchObject({ actor: '运营乙', before_json: expect.stringContaining('6900'), after_json: expect.stringContaining('7900') });
  });
});

describe('券：写入与读取', () => {
  it('新建一张券 → created=true，且写审计', async () => {
    const result = await publishCoupon(couponDef());
    expect(result.created).toBe(true);
    const audit = await base.query<{ action: string; target: string }>(
      'SELECT action, target FROM pricing_audit_log',
    );
    expect(audit).toEqual([{ action: 'coupon_upserted', target: 'launch-2026' }]);
  });

  it('同一 id 再写一次是更新（不是插第二行），created=false', async () => {
    await publishCoupon(couponDef());
    const second = await publishCoupon(couponDef({ name: '改名了' }));
    expect(second.created).toBe(false);
    const rows = await loadCoupons(base);
    expect(rows.coupons).toHaveLength(1);
    expect(rows.coupons[0]!.name).toBe('改名了');
  });

  it('🔴 定义不合法的券**写不进去**（不让问题推迟到用户输入那个码的那一刻）', async () => {
    await expect(publishCoupon(couponDef({ code: 'launch' }))).rejects.toThrow(
      CouponDefinitionRejectedError,
    );
    await expect(
      publishCoupon(couponDef({ benefit: { kind: 'percent', percentOffBp: 0 } })),
    ).rejects.toThrow(CouponDefinitionRejectedError);
  });

  it('数组字段往返：applies_to_all_* 与 null 语义一一对应', async () => {
    await publishCoupon(
      couponDef({ id: 'scoped', code: 'SCOPED', priceIds: ['annual'], regions: ['CN'] }),
    );
    await publishCoupon(couponDef({ id: 'open', code: 'OPEN', priceIds: null, regions: null }));
    const { coupons } = await loadCoupons(base);
    const scoped = coupons.find((c) => c.id === 'scoped')!;
    const open = coupons.find((c) => c.id === 'open')!;
    expect(scoped.priceIds).toEqual(['annual']);
    expect(scoped.regions).toEqual(['CN']);
    expect(open.priceIds).toBeNull();
    expect(open.regions).toBeNull();
  });

  it('坏掉的一行被**分出来**而不是让整批读取失败（与价目表刻意不同）', async () => {
    await publishCoupon(couponDef());
    // 绕过应用层直接写一行坏数据：CHECK 允许它（percent_off_bp 在范围内），
    // 但领域层认为"validUntil 早于 validFrom"是错的。
    // 🔴 这一行的**每一列都满足数据库的 CHECK**，但领域层认为它是坏的：
    // `minimum_order_minor = amount_off_minor` 意味着"刚好到门槛的那一单会被夹到
    // 0 元"，而 0 元单无法支付。数据库没有这条 CHECK（它需要知道两列的语义关系），
    // 所以这正是"两层判据各有各的洞、两层都要有"的具体例子。
    await base.execute(
      `INSERT INTO coupons
         (id, code, name, kind, percent_off_bp, amount_off_minor, currency,
          applies_to_all_prices, price_ids, applies_to_all_regions, regions,
          valid_from, valid_until, minimum_order_minor, first_purchase_only,
          enabled, created_at, updated_at)
       VALUES ($1, $2, $3, 'fixed', NULL, 2000, 'CNY', true, '{}', true, '{}', 0, $4, 2000, false, true, 0, 0)`,
      ['broken', 'BROKEN', '坏券', NOW + 30 * 24 * HOUR],
    );
    const result = await loadCoupons(base);
    expect(result.coupons.map((c) => c.id)).toEqual(['launch-2026']);
    expect(result.invalid.map((i) => i.id)).toEqual(['broken']);
    expect(result.invalid[0]!.problems.join()).toContain('门槛');
  });

  it('写错的区域值被报出来，而不是被静默过滤掉', async () => {
    await base.execute(
      `INSERT INTO coupons
         (id, code, name, kind, percent_off_bp, amount_off_minor, currency,
          applies_to_all_prices, price_ids, applies_to_all_regions, regions,
          valid_from, valid_until, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, 'fixed', NULL, 2000, 'CNY', true, '{}', false, '{MARS}', 0, NULL, true, 0, 0)`,
      ['typo', 'TYPO', '区域写错'],
    );
    const result = await loadCoupons(base);
    expect(result.coupons).toEqual([]);
    expect(result.invalid[0]!.problems.join()).toContain('不认识的值');
  });

  it('用量只数"计数的"状态：expired 不算、reserved 与 reversed 算', async () => {
    const user = await freshUser();
    await publishCoupon(couponDef());
    const { orderId } = await placeOrder(user, { codes: ['LAUNCH'] });
    // 预留状态就该被数进去（否则刷预留就能把限量券占满）。
    let usage = await loadCouponUsage(base, ['launch-2026'], user);
    expect(usage['launch-2026']).toMatchObject({ totalRedemptions: 1, userRedemptions: 1 });

    await expireStaleOrders(base, { now: NOW + 10 * HOUR });
    usage = await loadCouponUsage(base, ['launch-2026'], user);
    expect(usage['launch-2026']).toMatchObject({ totalRedemptions: 0, userRedemptions: 0 });

    // 重新占一个名额再退款：`reversed` 必须**继续计数**（退款不归还名额）。
    const second = await placeOrder(user, { codes: ['LAUNCH'] });
    await settleOrderPaid(base, {
      outTradeNo: await outTradeNoOf(second.orderId),
      providerEventId: 'evt-1',
      paidAmountMinor: 7_900,
      now: NOW + 2 * HOUR,
    });
    await reverseOrderOnRefund(base, { orderId: second.orderId, now: NOW + 3 * HOUR });
    usage = await loadCouponUsage(base, ['launch-2026'], user);
    expect(usage['launch-2026']).toMatchObject({ totalRedemptions: 1, userRedemptions: 1 });
    void orderId;
  });

  it('COUNTED_REDEMPTION_STATES 的口径是"含 reversed、不含 expired"', () => {
    expect([...COUNTED_REDEMPTION_STATES].sort()).toEqual(['applied', 'reserved', 'reversed']);
    expect(COUNTED_REDEMPTION_STATES).not.toContain('expired');
  });
});

const outTradeNoOf = async (orderId: number): Promise<string> => {
  const rows = await base.query<{ out_trade_no: string }>(
    'SELECT out_trade_no FROM checkout_orders WHERE id = $1',
    [orderId],
  );
  return rows[0]!.out_trade_no;
};

describe('下单：报价快照落库 + 名额预留', () => {
  it('没有券时只落订单，不产生核销行', async () => {
    const user = await freshUser();
    const { orderId, redemptionId, quote } = await placeOrder(user);
    expect(redemptionId).toBeNull();
    expect(quote.finalAmountMinor).toBe(9_900);
    const rows = await base.query<Record<string, unknown>>(
      'SELECT original_amount_minor, discount_minor, final_amount_minor, status, coupon_id FROM checkout_orders WHERE id = $1',
      [orderId],
    );
    expect(rows[0]).toMatchObject({
      original_amount_minor: 9_900,
      discount_minor: 0,
      final_amount_minor: 9_900,
      status: 'pending',
      coupon_id: null,
    });
  });

  it('用券时订单与核销行同时落库，金额三元组一致', async () => {
    const user = await freshUser();
    await publishCoupon(couponDef());
    const { orderId, redemptionId } = await placeOrder(user, { codes: ['LAUNCH'] });
    expect(redemptionId).not.toBeNull();
    const redemption = await base.query<Record<string, unknown>>(
      'SELECT state, original_amount_minor, discount_minor, final_amount_minor, reserved_until FROM coupon_redemptions WHERE order_id = $1',
      [orderId],
    );
    expect(redemption[0]).toMatchObject({
      state: 'reserved',
      original_amount_minor: 9_900,
      discount_minor: 2_000,
      final_amount_minor: 7_900,
    });
  });

  it('被拒的候选券也存进订单（用户来问的时候要按**当时**的定义回答）', async () => {
    const user = await freshUser();
    await publishCoupon(couponDef());
    const { orderId } = await placeOrder(user, { codes: ['NOPE'] });
    const rows = await base.query<{ rejected_coupons_json: string }>(
      'SELECT rejected_coupons_json FROM checkout_orders WHERE id = $1',
      [orderId],
    );
    const rejected = JSON.parse(rows[0]!.rejected_coupons_json) as Array<{ reason: string }>;
    expect(rejected).toEqual([expect.objectContaining({ reason: 'unknown_coupon' })]);
  });

  it('🔴 抢最后一张券：两份**都看到"还有名额"**的报价，第二份在预留时被拦下', async () => {
    await publishCoupon(couponDef({ maxRedemptions: 1 }));
    const a = await freshUser();
    const b = await freshUser();

    // 这就是并发在线上真的发生的样子 —— 两份报价都在同一个"用量 = 0"的快照上算出来。
    const quoteA = await buildQuote(a, { codes: ['LAUNCH'] });
    const quoteB = await buildQuote(b, { codes: ['LAUNCH'] });
    expect(quoteA.appliedCouponId).toBe('launch-2026');
    expect(quoteB.appliedCouponId).toBe('launch-2026');

    await expect(reserve(a, quoteA)).resolves.toBeDefined();
    // 🔴 报价值得被重新判定：**准入判定在事务里、在行锁下重做**。
    // 把这段重判删掉，这一行就会变成一条静默的超发。
    await expect(reserve(b, quoteB)).rejects.toThrow(CouponQuotaExceededError);
  });

  it('用满之后**新的**报价会直接把券拒掉（用户看到"这张券已被用满"，而不是下单失败）', async () => {
    await publishCoupon(couponDef({ maxRedemptions: 1 }));
    const a = await freshUser();
    const b = await freshUser();
    await placeOrder(a, { codes: ['LAUNCH'] });

    const fresh = await buildQuote(b, { codes: ['LAUNCH'] });
    expect(fresh.appliedCouponId).toBeNull();
    expect(fresh.rejectedCoupons[0]).toMatchObject({ reason: 'total_redemption_limit_reached' });
    // 券不能用**不影响**原价 —— 这一单照常可以下。
    expect(fresh.finalAmountMinor).toBe(9_900);
  });

  it('每人限额按**用户**分别计算', async () => {
    await publishCoupon(couponDef({ maxRedemptionsPerUser: 1 }));
    const a = await freshUser();
    const b = await freshUser();
    const quoteA1 = await buildQuote(a, { codes: ['LAUNCH'] });
    const quoteA2 = await buildQuote(a, { codes: ['LAUNCH'] });
    await expect(reserve(a, quoteA1)).resolves.toBeDefined();
    await expect(reserve(a, quoteA2)).rejects.toThrow(CouponQuotaExceededError);
    // 另一个用户不受影响 —— 限额是"每人"，不是"全局"。
    await expect(placeOrder(b, { codes: ['LAUNCH'] })).resolves.toBeDefined();
  });

  it('🔴 sweep 把没付款的名额**放出来** —— 否则限量券会被占位刷满', async () => {
    await publishCoupon(couponDef({ maxRedemptions: 1 }));
    const a = await freshUser();
    const b = await freshUser();
    const first = await placeOrder(a, { codes: ['LAUNCH'] });

    // 名额被占着：新报价直接拒券。
    expect((await buildQuote(b, { codes: ['LAUNCH'] })).appliedCouponId).toBeNull();

    const swept = await expireStaleOrders(base, { now: NOW + 3 * HOUR });
    expect(swept).toMatchObject({ redemptions: 1, orders: 1 });

    await expect(placeOrder(b, { codes: ['LAUNCH'] })).resolves.toBeDefined();
    // 过期的那一单仍然是可查的（只改状态，不删数据）。
    const rows = await base.query<{ status: string }>(
      'SELECT status FROM checkout_orders WHERE id = $1',
      [first.orderId],
    );
    expect(rows[0]!.status).toBe('expired');
  });

  it('🔴 锁的形状：锁券行 → 数名额 → 插入，全在**同一个事务**里按这个顺序', async () => {
    await publishCoupon(couponDef({ maxRedemptions: 5 }));
    const user = await freshUser();
    const log: string[] = [];
    const user2 = user;
    const { coupons } = await loadCoupons(base);
    const quote = quoteOrder(
      { priceId: 'annual', currency: 'CNY', region: 'CN', candidateCodes: ['LAUNCH'] },
      {
        baseline: DEFAULT_PRICE_BOOK,
        overrides: [],
        couponsByCode: new Map(coupons.filter((c) => c.code).map((c) => [c.code!, c])),
        now: NOW,
      },
    );
    await createOrderWithReservation(wrap(base, log), {
      userId: user2,
      provider: 'wechat',
      outTradeNo: 'hy-lock-shape',
      quote,
      now: NOW,
    });

    const indexOf = (needle: string) => log.findIndex((s) => s.includes(needle));
    const lock = indexOf('FROM coupons WHERE id = $1 FOR UPDATE');
    const count = indexOf('count(*)::int AS n FROM coupon_redemptions');
    const insertOrder = indexOf('INSERT INTO checkout_orders');
    const insertRedemption = indexOf('INSERT INTO coupon_redemptions');

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(count).toBeGreaterThan(lock);
    expect(insertOrder).toBeGreaterThan(count);
    expect(insertRedemption).toBeGreaterThan(insertOrder);
    // 🔴 把 `FOR UPDATE` 删掉、或把计数挪到事务外，上面的相对顺序就会崩。
  });
});

describe('结算：幂等 + 金额比对订单', () => {
  const paidOrder = async (options: { readonly codes?: readonly string[]; readonly now?: number } = {}) => {
    const user = await freshUser();
    const { orderId } = await placeOrder(user, options);
    const outTradeNo = await outTradeNoOf(orderId);
    return { user, orderId, outTradeNo };
  };

  it('金额与订单上冻结的实付一致 → 授予，订单 paid、核销 applied', async () => {
    await publishCoupon(couponDef());
    const { orderId, outTradeNo } = await paidOrder({ codes: ['LAUNCH'] });
    const outcome = await settleOrderPaid(base, {
      outTradeNo,
      providerEventId: 'evt-1',
      paidAmountMinor: 7_900,
      now: NOW + HOUR,
    });
    expect(outcome).toMatchObject({ outcome: 'granted', afterExpiry: false, quotaExceeded: false });

    const order = await base.query<{ status: string; paid_at: unknown }>(
      'SELECT status, paid_at FROM checkout_orders WHERE id = $1',
      [orderId],
    );
    expect(order[0]!.status).toBe('paid');
    expect(toMillis(order[0]!.paid_at)).toBe(NOW + HOUR);
    const redemption = await base.query<{ state: string }>(
      'SELECT state FROM coupon_redemptions WHERE order_id = $1',
      [orderId],
    );
    expect(redemption[0]!.state).toBe('applied');
  });

  it('🔴 同一订单重复结算 → already-paid，且**不再写任何东西**（幂等）', async () => {
    const { orderId, outTradeNo } = await paidOrder();
    const first = await settleOrderPaid(base, {
      outTradeNo,
      providerEventId: 'evt-1',
      paidAmountMinor: 9_900,
      now: NOW + HOUR,
    });
    expect(first.outcome).toBe('granted');
    const second = await settleOrderPaid(base, {
      outTradeNo,
      providerEventId: 'evt-1',
      paidAmountMinor: 9_900,
      now: NOW + 2 * HOUR,
    });
    expect(second).toMatchObject({ outcome: 'already-paid', orderId });
    const order = await base.query<{ paid_at: unknown; provider_event_id: string }>(
      'SELECT paid_at, provider_event_id FROM checkout_orders WHERE id = $1',
      [orderId],
    );
    // 第一次结算的时刻没有被第二次覆盖 —— 重复投递不该改变任何事实。
    expect(toMillis(order[0]!.paid_at)).toBe(NOW + HOUR);
    expect(order[0]!.provider_event_id).toBe('evt-1');
  });

  it('🔴 金额对不上 → **不授予**，订单停在 pending（这是修掉"金额是价目表里的某一个"那个洞的地方）', async () => {
    await publishCoupon(couponDef());
    const { orderId, outTradeNo } = await paidOrder({ codes: ['LAUNCH'] });
    const outcome = await settleOrderPaid(base, {
      outTradeNo,
      providerEventId: 'evt-1',
      // 付了原价 —— 在旧实现里“9900 是价目表里的某一个”会**照常授予**，
      // 用户等于白拿了一张券。
      paidAmountMinor: 9_900,
      now: NOW + HOUR,
    });
    expect(outcome).toMatchObject({ outcome: 'amount-mismatch', expectedMinor: 7_900, actualMinor: 9_900 });
    const order = await base.query<{ status: string }>(
      'SELECT status FROM checkout_orders WHERE id = $1',
      [orderId],
    );
    expect(order[0]!.status).toBe('pending');
    const redemption = await base.query<{ state: string }>(
      'SELECT state FROM coupon_redemptions WHERE order_id = $1',
      [orderId],
    );
    expect(redemption[0]!.state).toBe('reserved');
  });

  it('认不出的订单号 → unknown-order（不猜、不建行）', async () => {
    const outcome = await settleOrderPaid(base, {
      outTradeNo: 'hy-forged',
      providerEventId: 'evt-x',
      paidAmountMinor: 9_900,
      now: NOW,
    });
    expect(outcome).toEqual({ outcome: 'unknown-order', outTradeNo: 'hy-forged' });
  });

  it('已退款的订单再次收到支付事件 → order-not-grantable（不悄悄再授予一次）', async () => {
    const { orderId, outTradeNo } = await paidOrder();
    await settleOrderPaid(base, {
      outTradeNo,
      providerEventId: 'evt-1',
      paidAmountMinor: 9_900,
      now: NOW + HOUR,
    });
    await reverseOrderOnRefund(base, { orderId, now: NOW + 2 * HOUR });
    const outcome = await settleOrderPaid(base, {
      outTradeNo,
      providerEventId: 'evt-2',
      paidAmountMinor: 9_900,
      now: NOW + 3 * HOUR,
    });
    expect(outcome).toMatchObject({ outcome: 'order-not-grantable', status: 'refunded' });
  });

  it('🔴 到账晚于过期：**照样授予**，并把 afterExpiry 报出来', async () => {
    await publishCoupon(couponDef({ maxRedemptions: 1 }));
    const a = await freshUser();
    const b = await freshUser();
    const first = await placeOrder(a, { codes: ['LAUNCH'] });
    const outTradeNo = await outTradeNoOf(first.orderId);

    // 订单过期，名额被放出来，另一个用户拿走了它。
    await expireStaleOrders(base, { now: NOW + 3 * HOUR });
    await placeOrder(b, { codes: ['LAUNCH'] });

    // 第一个用户的付款现在才到。
    const outcome = await settleOrderPaid(base, {
      outTradeNo,
      providerEventId: 'evt-late',
      paidAmountMinor: 7_900,
      now: NOW + 4 * HOUR,
    });
    expect(outcome).toMatchObject({ outcome: 'granted', afterExpiry: true });
    // 名额确实被超过了 —— 这是**有意的**方向（见 COUNTED_REDEMPTION_STATES），
    // 但它必须被**报出来**，而不是安静地发生。
    expect(outcome).toMatchObject({ quotaExceeded: true });

    const redemption = await base.query<{ state: string }>(
      'SELECT state FROM coupon_redemptions WHERE order_id = $1',
      [first.orderId],
    );
    expect(redemption[0]!.state).toBe('applied');
  });

  it('🔴 退款把核销置为 reversed，但名额**不回来**（防"买→退→再买"薅预算）', async () => {
    await publishCoupon(couponDef({ maxRedemptions: 1 }));
    const a = await freshUser();
    const b = await freshUser();
    const paid = await placeOrder(a, { codes: ['LAUNCH'] });
    const outTradeNo = await outTradeNoOf(paid.orderId);
    await settleOrderPaid(base, {
      outTradeNo,
      providerEventId: 'evt-1',
      paidAmountMinor: 7_900,
      now: NOW + HOUR,
    });
    const refunded = await reverseOrderOnRefund(base, { orderId: paid.orderId, now: NOW + 2 * HOUR });
    expect(refunded).toEqual({ orders: 1, redemptions: 1 });

    const redemption = await base.query<{ state: string }>(
      'SELECT state FROM coupon_redemptions WHERE order_id = $1',
      [paid.orderId],
    );
    expect(redemption[0]!.state).toBe('reversed');

    // 名额没有回来 —— `reversed` 仍然计数，所以下一个人拿不到这张券。
    const next = await buildQuote(b, { codes: ['LAUNCH'] });
    expect(next.appliedCouponId).toBeNull();
    expect(next.rejectedCoupons[0]).toMatchObject({ reason: 'total_redemption_limit_reached' });
    // 但仍能按原价下单（券不能用不等于买不成）。
    await expect(reserve(b, next)).resolves.toBeDefined();
  });

  it('sweep 只动过期的 pending；已支付的订单不受影响', async () => {
    const a = await freshUser();
    const b = await freshUser();
    const paidOrderA = await placeOrder(a);
    await settleOrderPaid(base, {
      outTradeNo: await outTradeNoOf(paidOrderA.orderId),
      providerEventId: 'evt-1',
      paidAmountMinor: 9_900,
      now: NOW + HOUR,
    });
    const pendingB = await placeOrder(b);
    const swept = await expireStaleOrders(base, { now: NOW + 5 * HOUR });
    expect(swept.orders).toBe(1);
    const statuses = await base.query<{ id: number; status: string }>(
      'SELECT id, status FROM checkout_orders ORDER BY id',
    );
    expect(statuses).toEqual([
      { id: paidOrderA.orderId, status: 'paid' },
      { id: pendingB.orderId, status: 'expired' },
    ]);
  });

  it('sweep 幂等：重复跑不会把已过期的行再算一次', async () => {
    const a = await freshUser();
    await placeOrder(a);
    const first = await expireStaleOrders(base, { now: NOW + 5 * HOUR });
    const second = await expireStaleOrders(base, { now: NOW + 6 * HOUR });
    expect(first.orders).toBe(1);
    expect(second).toEqual({ redemptions: 0, orders: 0 });
  });
});

describe('Prisma 端口的形状（唯一没被 PGlite 覆盖的一层）', () => {
  it('只做转发与事务包装，SQL 文本原样传下去', async () => {
    const calls: string[] = [];
    const fake: PrismaLikeClient = {
      $queryRawUnsafe: async <T>(sql: string, ...params: unknown[]): Promise<T> => {
        calls.push(`${sql} | ${params.length}`);
        return [] as unknown as T;
      },
      $executeRawUnsafe: async (sql: string): Promise<number> => {
        calls.push(sql);
        return 1;
      },
      $transaction: async <T>(fn: (tx: PrismaLikeClient) => Promise<T>): Promise<T> => fn(fake),
    };
    const executor = createPrismaSqlExecutor(fake);
    await executor.query('SELECT 1 WHERE $1 IS NOT NULL', [1]);
    expect(calls).toEqual(['SELECT 1 WHERE $1 IS NOT NULL | 1']);
    expect(await executor.execute('UPDATE t SET a = 1')).toBe(1);
    // `$queryRawUnsafe` 在 Prisma 里可能返回非数组（驱动差异），端口要兜住。
    const empty = createPrismaSqlExecutor({
      ...fake,
      $queryRawUnsafe: async <T>(): Promise<T> => undefined as unknown as T,
    });
    expect(await empty.query('SELECT 1')).toEqual([]);
  });
});
