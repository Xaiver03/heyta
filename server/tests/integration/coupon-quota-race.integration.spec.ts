/**
 * 🔴 **真库上的行锁并发**：多个事务同时预留，抢最后一张券。
 *
 * ## 为什么必须是真 PostgreSQL
 *
 * `tests/billing-pricing-store.pglite.spec.ts` 里的同名用例给的是**顺序**语义：
 * PGlite 是**单连接**，两个 `BEGIN` 无法并存。所以它证明不了
 * 「两个事务同时看见 `9/10`」这件事真的会发生，也证明不了 `FOR UPDATE` 拦得住它。
 * （`docs/plans/pricing-coupons-handoff.md` §10 第一条写的就是这个。）
 *
 * 本文件同时补上另一个洞：`createPrismaSqlExecutor` 是整个 `pricing-store.ts` 里
 * **唯一没被 PGlite 覆盖的一段**（CI 没有 PostgreSQL）。它只做转发，但
 * 「`number` → `BIGINT`、JS 数组 → `text[]` 真的绑对了吗」在真库上跑一遍才算数 ——
 * 而本文件的每一发预留都要经过它。
 *
 * ## 怎么保证"真的在并发"，而不是碰巧串行
 *
 * 只断言"恰好一个成功"是**可以空转**的：两个事务一前一后跑完，结果也是恰好一个成功。
 * 所以这里给 `SqlExecutor` 包了一层**会合栏**（`withRendezvous`）：两个事务都走到
 * "给券行上锁"那一步**之前**互相等齐，然后**同时**发出 `SELECT … FOR UPDATE`。
 * 于是至少有一个真的会阻塞在行锁上 —— 被测的就是这个机制本身，不是它的近似。
 *
 * ## 运行
 *
 * 需要真库；`DATABASE_URL` 缺失时整组 skip（与仓库里另外 18 个 integration spec 一致）。
 *
 *   DATABASE_URL=postgresql://… npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/coupon-quota-race.integration.spec.ts
 *
 * ✅ 本文件**已注册**进 `server/package.json` 的 `test:integration:postgres`
 * （在此之前它只在 CI 之外被手动跑过 —— `server/package.json` 当时被另一条
 * 工作流改着，见 handoff §5.4）。所以 CI 现在真的会跑这组并发用例。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { DEFAULT_PRICE_BOOK } from '../../src/billing/price-book';
import { normalizeCouponCode, type CouponDefinition } from '../../src/billing/coupon';
import { quoteOrder, type OrderQuote } from '../../src/billing/quote';
import {
  CouponQuotaExceededError,
  createOrderWithReservation,
  createPrismaSqlExecutor,
  upsertCoupon,
  type SqlExecutor,
  type SqlRunner,
} from '../../src/billing/pricing-store';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const RUN_ID = `${Date.now()}-${process.pid}`;
const EMAIL_PREFIX = `coupon-race-${RUN_ID}@test.local`;
const COUPON_PREFIX = `coupon-race-${RUN_ID}`;
const OUT_TRADE_PREFIX = `coupon-race-${RUN_ID}-`;
const ACTOR = 'coupon-quota-race.spec';

/**
 * 会合栏：前 `expected` 个到达者一起等，最后一个到达时放行全部。
 *
 * 用途见文件头 —— 没有它，这个测试就退化成"两个顺序调用"。
 */
const makeBarrier = (expected: number): (() => Promise<void>) => {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= expected) release();
    await gate;
  };
};

/**
 * 把 `SqlExecutor` 包一层：**事务里的第一条语句之前**先过会合栏。
 *
 * 刻意包在 `transaction` 里面（`wrap(tx)`），因为要卡住的正是事务内那条
 * `SELECT … FROM coupons … FOR UPDATE`，不是事务的开场。
 */
const withRendezvous = (inner: SqlExecutor, rendezvous: () => Promise<void>): SqlExecutor => {
  /** 事务**内**的面：只有读写（对应 `SqlRunner`）。会合栏就挂在这里。 */
  const wrapRunner = (exec: SqlRunner, state: { tripped: boolean }): SqlRunner => ({
    query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
      if (!state.tripped) {
        state.tripped = true;
        await rendezvous();
      }
      return exec.query<T>(sql, params);
    },
    execute: (sql, params = []) => exec.execute(sql, params),
  });

  const wrap = (exec: SqlExecutor, state: { tripped: boolean }): SqlExecutor => ({
    ...wrapRunner(exec, state),
    transaction: <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> =>
      exec.transaction((tx) => fn(wrapRunner(tx, { tripped: false }))),
  });

  return wrap(inner, { tripped: false });
};

describeWithDb('Coupon quota race (PostgreSQL)', () => {
  let observer: PrismaClient;
  let sql: SqlExecutor;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');
    observer = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    sql = createPrismaSqlExecutor(observer);
  });

  afterAll(async () => {
    if (!observer) return;
    // 顺序受外键约束：券上挂着的引用是 RESTRICT，先清引用再清券。
    await observer.pricingAuditLog.deleteMany({ where: { target: { startsWith: COUPON_PREFIX } } });
    await observer.couponRedemption.deleteMany({ where: { couponId: { startsWith: COUPON_PREFIX } } });
    await observer.checkoutOrder.deleteMany({ where: { outTradeNo: { startsWith: OUT_TRADE_PREFIX } } });
    await observer.coupon.deleteMany({ where: { id: { startsWith: COUPON_PREFIX } } });
    await observer.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX.split('@')[0]! } } });
    await observer.$disconnect();
  });

  const makeCoupon = async (suffix: string, maxRedemptions: number | null): Promise<CouponDefinition> => {
    const id = `${COUPON_PREFIX}-${suffix}`;
    const definition: CouponDefinition = {
      id,
      code: `RACE${suffix.toUpperCase()}`,
      name: `并发预留测试券 ${suffix}`,
      benefit: { kind: 'percent', percentOffBp: 2_000 },
      currency: 'CNY',
      priceIds: null,
      validFrom: Date.now() - 60_000,
      validUntil: null,
      maxRedemptions,
      maxRedemptionsPerUser: null,
      minimumOrderMinor: null,
      firstPurchaseOnly: false,
      regions: null,
      enabled: true,
    };
    // 走真正的写入口，而不是裸 SQL —— 顺带验证 `upsertCoupon` 的参数绑定。
    await upsertCoupon(sql, { definition, actor: ACTOR, note: 'race setup', now: Date.now() });
    return definition;
  };

  const makeUser = async (suffix: string): Promise<number> => {
    const user = await observer.user.create({
      data: { email: `${EMAIL_PREFIX.split('@')[0]!}-${suffix}@test.local` },
    });
    return user.id;
  };

  /**
   * 报价是**纯函数**：它只能给出"这一刻该给他看什么价"。
   * 两份报价都会说"券能用" —— 那正是竞态的**前提**，不是 bug。
   */
  const buildQuote = (coupon: CouponDefinition): OrderQuote =>
    quoteOrder(
      {
        // 🔴 这里曾经是 `'annual'`（ADR-0017 的 ¥99 年付时代）。ADR-0020 把 SKU
        //    换成 `hosted-monthly` / `hosted-ai-monthly` 之后，`'annual'` 在基线价目表里
        //    不存在了，`resolveEffectivePrice` 直接抛 `UnknownPriceError` ——
        //    也就是这个用例从那次改价起就一直是**红的**。
        //    之所以没人发现，正是因为本文件当时**不在** `test:integration:postgres`
        //    清单里（handoff §5.4）：CI 不跑它，"注册"这一步本身就是修复的一半。
        priceId: 'hosted-monthly',
        currency: 'CNY',
        region: 'CN',
        candidateCodes: [coupon.code ?? coupon.id],
      },
      {
        baseline: DEFAULT_PRICE_BOOK,
        overrides: [],
        couponsByCode: new Map([[normalizeCouponCode(coupon.code ?? coupon.id), coupon]]),
        now: Date.now(),
      },
    );

  const reserve = (userId: number, outTradeNo: string, quote: OrderQuote) =>
    createOrderWithReservation(sql, { userId, provider: 'wechat', outTradeNo, quote, now: Date.now() });

  /**
   * 把 N 个"同时发生"的预留跑出来。
   *
   * ⚠️ `out_trade_no` 上有**唯一约束**，而多个用例都会用同一批下标 ——
   * 所以 `label` 是必需的，否则第二个用例会撞上第一个用例的订单号，
   * 失败原因会是一个和并发毫无关系的唯一键冲突（这个坑实测踩过一次）。
   */
  const race = async (
    label: string,
    quote: OrderQuote,
    userIds: readonly number[],
  ): Promise<PromiseSettledResult<{ orderId: number; redemptionId: number | null }>[]> => {
    const count = userIds.length;
    const rendezvous = makeBarrier(count);
    const raced = withRendezvous(sql, rendezvous);
    const attempts = userIds.map((userId, index) =>
      createOrderWithReservation(raced, {
        userId,
        provider: 'wechat',
        outTradeNo: `${OUT_TRADE_PREFIX}${label}-${index}`,
        quote,
        now: Date.now(),
      }),
    );
    return Promise.allSettled(attempts);
  };

  const rejectionOf = (results: PromiseSettledResult<unknown>[]): unknown[] =>
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as unknown);

  it('🔴 两个并发预留抢**最后一张**券：恰好一个成功，另一个拿到 CouponQuotaExceededError', async () => {
    // 前提断言：报价这一层**看不出来**名额会被抢 —— 两份报价都必须说"能用"。
    // 如果这里就有一个是 null，那竞态根本没建立，后面的"恰好一个成功"会变成空转。
    const coupon = await makeCoupon('total-1', 1);
    const quote = buildQuote(coupon);
    expect(quote.appliedCouponId).toBe(coupon.id);

    const [userA, userB] = [await makeUser('total-1-a'), await makeUser('total-1-b')];
    const results = await race('total-1', quote, [userA, userB]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const reasons = rejectionOf(results);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBeInstanceOf(CouponQuotaExceededError);
    expect((reasons[0] as CouponQuotaExceededError).reason).toBe('total');
    expect((reasons[0] as CouponQuotaExceededError).couponId).toBe(coupon.id);

    // 落库的不变量：券只被核销了一次，订单也只有一张带这张券。
    // 这比"恰好一个成功"更强 —— 它不看返回值，直接看事实。
    const redemptions = await observer.couponRedemption.count({ where: { couponId: coupon.id } });
    const orders = await observer.checkoutOrder.count({ where: { couponId: coupon.id } });
    expect(redemptions).toBe(1);
    expect(orders).toBe(1);
  });

  it('🔴 五个并发预留抢 2 个名额：恰好两个成功（"限量券超发一张"的放大版）', async () => {
    const coupon = await makeCoupon('total-2', 2);
    const quote = buildQuote(coupon);
    expect(quote.appliedCouponId).toBe(coupon.id);

    const userIds = await Promise.all([1, 2, 3, 4, 5].map((n) => makeUser(`total-2-${n}`)));
    const results = await race('total-2', quote, userIds);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const reasons = rejectionOf(results);
    expect(reasons).toHaveLength(3);
    for (const reason of reasons) {
      expect(reason).toBeInstanceOf(CouponQuotaExceededError);
    }

    const redemptions = await observer.couponRedemption.count({ where: { couponId: coupon.id } });
    expect(redemptions).toBe(2);
  });

  it('不限名额时并发预留全部成功（证明上面两条不是"什么都拒"）', async () => {
    const coupon = await makeCoupon('unlimited', null);
    const quote = buildQuote(coupon);
    expect(quote.appliedCouponId).toBe(coupon.id);

    const userIds = await Promise.all([1, 2, 3].map((n) => makeUser(`unlimited-${n}`)));
    const results = await race('unlimited', quote, userIds);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await observer.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(3);
  });
});
