import { describe, expect, it } from 'vitest';
import {
  COUPON_REJECTION_EXPLANATION,
  COUPON_REJECTION_REASONS,
  EMPTY_COUPON_USAGE,
  InvalidCouponDefinitionError,
  evaluateCoupon,
  normalizeCouponCode,
  validateCouponDefinition,
  type CouponContext,
  type CouponDefinition,
  type CouponRejectionReason,
  type CouponUsage,
  type Region,
} from '../src/billing/coupon';
import {
  DEFAULT_PAYMENT_WINDOW_MS,
  MAX_COUPONS_PER_ORDER,
  QuotePricingError,
  isSellableCurrency,
  quoteOrder,
  type QuoteRequest,
} from '../src/billing/quote';
import { DEFAULT_PRICE_BOOK, type PriceBookEntry } from '../src/billing/price-book';
import type { Currency } from '../src/billing/money';

/**
 * 券的判定 + 计价的证据文件。
 *
 * 三条纪律：
 *
 * 1. **每一个拒绝原因都必须被真的走到。** 末尾那条"原因覆盖"测试把这个要求
 *    变成可执行的：表里的期望原因集合必须**恰好等于**枚举本身。一个永远不可能
 *    被触发的 `reason` 是一个死分支，而它看起来像"已经处理过了"。
 * 2. **每个"不能用"的用例都配一个"能用"的对照。** 只测拒绝的话，
 *    一个恒返回 rejected 的实现会全绿。
 * 3. **不测实现，测不变量。** 例如"折扣取整偏向用户"这条，断言的是
 *    `final × 10000 ≤ original × (10000 − bp)`，而不是某个具体数字。
 */

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const YEAR_MS = 365 * 24 * HOUR;

/** 一个各方面都合法的基准券，测试只改它的一两个字段。 */
const baseCoupon = (overrides: Partial<CouponDefinition> = {}): CouponDefinition => ({
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

const baseContext = (overrides: Partial<CouponContext> = {}): CouponContext => ({
  now: NOW,
  priceId: 'annual',
  currency: 'CNY',
  originalAmountMinor: 9_900,
  region: 'CN',
  usage: EMPTY_COUPON_USAGE,
  ...overrides,
});

const usage = (overrides: Partial<CouponUsage> = {}): CouponUsage => ({
  ...EMPTY_COUPON_USAGE,
  ...overrides,
});

describe('券码归一化', () => {
  it('大小写与首尾空白都不影响结果 —— 用户敲 `launch ` 与 `LAUNCH` 是同一张券', () => {
    for (const raw of ['launch', 'LAUNCH', ' Launch ', '\tLaunch\n', 'LaUnCh']) {
      expect(normalizeCouponCode(raw)).toBe('LAUNCH');
    }
  });

  it('不改动中间的字符（连字符、数字都保留）', () => {
    expect(normalizeCouponCode(' xhs-2026 ')).toBe('XHS-2026');
  });
});

describe('券定义校验', () => {
  it('基准券合法', () => {
    expect(validateCouponDefinition(baseCoupon())).toEqual([]);
  });

  it('百分比券合法（含边界外的常见值）', () => {
    for (const bp of [1, 500, 5_000, 9_999]) {
      expect(
        validateCouponDefinition(
          baseCoupon({ benefit: { kind: 'percent', percentOffBp: bp } }),
        ),
      ).toEqual([]);
    }
  });

  it('🔴 0% 与 100% 的券是**配置错误**，不是"低调的券"或"免费送"', () => {
    const zero = validateCouponDefinition(
      baseCoupon({ benefit: { kind: 'percent', percentOffBp: 0 } }),
    );
    expect(zero.join()).toContain('percentOffBp = 0');
    const full = validateCouponDefinition(
      baseCoupon({ benefit: { kind: 'percent', percentOffBp: 10_000 } }),
    );
    expect(full.join()).toContain('无法完成支付');
  });

  it('码未归一化时报错（大写与去空白只能在归一化函数里做）', () => {
    expect(validateCouponDefinition(baseCoupon({ code: 'launch' })).join()).toContain('归一化');
    expect(validateCouponDefinition(baseCoupon({ code: ' LAUNCH' })).join()).toContain('归一化');
    expect(validateCouponDefinition(baseCoupon({ code: '' })).join()).toContain('非空字符串');
  });

  it('空 priceIds / 空 regions 是死券，不是"全部适用"', () => {
    expect(validateCouponDefinition(baseCoupon({ priceIds: [] })).join()).toContain('死券');
    expect(validateCouponDefinition(baseCoupon({ regions: [] })).join()).toContain('全部');
  });

  it('`null` 在**每一个**维度上表示"全部"，而币种是单独的维度', () => {
    // priceIds / regions / 门槛 / 两个限额 都是 null → 该维度不设限。
    const wide = baseCoupon({
      priceIds: null,
      regions: null,
      minimumOrderMinor: null,
      maxRedemptions: null,
      maxRedemptionsPerUser: null,
    });
    for (const region of ['CN', 'INTL'] as const) {
      expect(evaluateCoupon(wide, baseContext({ region })).ok).toBe(true);
    }
    // 🔴 但 currency **不是**"null = 全部"：它必须精确相等。
    // 一张 CNY 券在 USD 单上必须被拒 —— 两种钱之间没有我们定义的汇率。
    const onUsd = evaluateCoupon(wide, baseContext({ currency: 'USD', region: 'INTL' }));
    expect(onUsd.ok).toBe(false);
    if (!onUsd.ok) expect(onUsd.reason).toBe('currency_mismatch');
  });

  it('限额 0 报错（等于停用，该用 enabled=false）', () => {
    for (const field of ['maxRedemptions', 'maxRedemptionsPerUser'] as const) {
      expect(validateCouponDefinition(baseCoupon({ [field]: 0 })).join()).toContain('正');
    }
  });

  it('validUntil 早于 validFrom 报错（这张券从没生效过）', () => {
    expect(
      validateCouponDefinition(baseCoupon({ validFrom: NOW, validUntil: NOW - 1 })).join(),
    ).toContain('从来没有生效过');
  });

  it('面额 ≥ 门槛且门槛 > 0 → 每一单都会被夹到不可支付，报错', () => {
    const problems = validateCouponDefinition(
      baseCoupon({
        benefit: { kind: 'fixed', amountOffMinor: 9_900 },
        minimumOrderMinor: 9_900,
      }),
    );
    expect(problems.join()).toContain('门槛');
  });

  it('返回的是**全部**问题，不是第一个（改一次就能改完）', () => {
    const problems = validateCouponDefinition(
      baseCoupon({ code: 'bad', maxRedemptions: 0, regions: [] }),
    );
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('券判定：能用（每条拒绝都有对照）', () => {
  it('最朴素的一张券：立减 20 元，9900 → 7900', () => {
    const result = evaluateCoupon(baseCoupon(), baseContext());
    expect(result).toEqual({
      ok: true,
      couponId: 'launch-2026',
      discountMinor: 2_000,
      finalAmountMinor: 7_900,
    });
  });

  it('八折券 = 2000bp（减 20%）→ 9900 减 1980，实付 7920', () => {
    // 基点语义是"减多少"，不是"付多少"：八折 = 减 20% = 2000bp。
    // 把 8000bp 当成"八折"会让实付变成 1980 —— 这正是这个字段最容易搞反的地方。
    const result = evaluateCoupon(
      baseCoupon({ benefit: { kind: 'percent', percentOffBp: 2_000 } }),
      baseContext(),
    );
    expect(result).toEqual({
      ok: true,
      couponId: 'launch-2026',
      discountMinor: 1_980,
      finalAmountMinor: 7_920,
    });
  });

  it('🔴 8000bp 是"减 80%"不是"八折" —— 语义搞反会让实付只剩两成', () => {
    const result = evaluateCoupon(
      baseCoupon({ benefit: { kind: 'percent', percentOffBp: 8_000 } }),
      baseContext(),
    );
    expect(result).toEqual({
      ok: true,
      couponId: 'launch-2026',
      discountMinor: 7_920,
      finalAmountMinor: 1_980,
    });
  });

  it('🔴 除不尽时取整**偏向用户**：33.33% off 实付 6600 而不是 6601', () => {
    const result = evaluateCoupon(
      baseCoupon({ benefit: { kind: 'percent', percentOffBp: 3_333 } }),
      baseContext(),
    );
    expect(result).toEqual({
      ok: true,
      couponId: 'launch-2026',
      discountMinor: 3_300,
      finalAmountMinor: 6_600,
    });
    // 用户拿到的折扣不少于 33.33%
    if (result.ok) {
      expect(result.finalAmountMinor * 10_000).toBeLessThanOrEqual(9_900 * (10_000 - 3_333));
    }
  });

  it('不限区域时两个区域都能用；一旦限区域，另一个就成对照地被拒', () => {
    const anywhere = baseCoupon({ regions: null });
    for (const region of ['CN', 'INTL'] as const) {
      expect(evaluateCoupon(anywhere, baseContext({ region })).ok).toBe(true);
    }
    const cnOnly = baseCoupon({ regions: ['CN'] });
    expect(evaluateCoupon(cnOnly, baseContext({ region: 'CN' })).ok).toBe(true);
    expect(evaluateCoupon(cnOnly, baseContext({ region: 'INTL' })).ok).toBe(false);
  });

  it('限 USD 的券在 USD 单上能用（另有 CNY 单拒绝的对照）', () => {
    const usd = baseCoupon({
      benefit: { kind: 'fixed', amountOffMinor: 1_000 },
      currency: 'USD',
    });
    expect(evaluateCoupon(usd, baseContext({ currency: 'USD', region: 'INTL' })).ok).toBe(true);
  });

  it('门槛恰好等于原价时**能用**（`>=` 与 `>` 的边界是有意的）', () => {
    const gated = baseCoupon({ minimumOrderMinor: 9_900 });
    expect(evaluateCoupon(gated, baseContext()).ok).toBe(true);
  });

  it('限额恰好用完上一次仍能用（max=2、已用 1，还能再用一次）', () => {
    const limited = baseCoupon({ maxRedemptions: 2, maxRedemptionsPerUser: 2 });
    expect(evaluateCoupon(limited, baseContext({ usage: usage({ totalRedemptions: 1 }) })).ok).toBe(
      true,
    );
  });

  it('拉新券对从未付费的用户能用', () => {
    const fresh = baseCoupon({ firstPurchaseOnly: true });
    expect(evaluateCoupon(fresh, baseContext({ usage: usage({ userHasPaidOrder: false }) })).ok).toBe(
      true,
    );
  });
});

/**
 * 表驱动的拒绝用例。
 *
 * `expected` 里的原因稍后会被拿去与枚举本身比对（见最后一组测试），
 * 所以**漏写一个原因**会让那个测试失败 —— 这是"死分支"的守门人。
 */
const REJECTION_CASES: ReadonlyArray<{
  readonly label: string;
  readonly coupon: CouponDefinition;
  readonly context: CouponContext;
  readonly expected: CouponRejectionReason;
}> = [
  {
    label: '已停用',
    coupon: baseCoupon({ enabled: false }),
    context: baseContext(),
    expected: 'disabled',
  },
  {
    label: '还没到生效时间',
    coupon: baseCoupon({ validFrom: NOW + 1 }),
    context: baseContext(),
    expected: 'not_started',
  },
  {
    label: '已过期（validUntil 是闭区间，晚一毫秒就失效）',
    coupon: baseCoupon({ validUntil: NOW - 1 }),
    context: baseContext(),
    expected: 'expired',
  },
  {
    label: '币种不符：¥20 的券用在 $49 的单上',
    coupon: baseCoupon({ currency: 'CNY' }),
    context: baseContext({ currency: 'USD', region: 'INTL' }),
    expected: 'currency_mismatch',
  },
  {
    label: '区域不符：大陆券用在海外单上',
    coupon: baseCoupon({ regions: ['CN'] }),
    context: baseContext({ region: 'INTL' }),
    expected: 'region_mismatch',
  },
  {
    label: '不适用于所购项目',
    coupon: baseCoupon({ priceIds: ['monthly'] }),
    context: baseContext(),
    expected: 'price_not_applicable',
  },
  {
    label: '未达门槛',
    coupon: baseCoupon({ minimumOrderMinor: 9_901 }),
    context: baseContext(),
    expected: 'order_below_minimum',
  },
  {
    label: '拉新券但用户已经付过费',
    coupon: baseCoupon({ firstPurchaseOnly: true }),
    context: baseContext({ usage: usage({ userHasPaidOrder: true }) }),
    expected: 'first_purchase_only',
  },
  {
    label: '这张券被用满了',
    coupon: baseCoupon({ maxRedemptions: 100 }),
    context: baseContext({ usage: usage({ totalRedemptions: 100 }) }),
    expected: 'total_redemption_limit_reached',
  },
  {
    label: '这个用户用这张券的次数已达上限',
    coupon: baseCoupon({ maxRedemptionsPerUser: 1 }),
    context: baseContext({ usage: usage({ userRedemptions: 1 }) }),
    expected: 'user_redemption_limit_reached',
  },
  {
    label: '🔴 减完之后是 0 元单 —— 不是"券不够好"，是"这一单收不了钱"',
    coupon: baseCoupon({ benefit: { kind: 'fixed', amountOffMinor: 9_900 } }),
    context: baseContext(),
    expected: 'not_chargeable_after_discount',
  },
  {
    label: '原价只有 1 分、券减 50% —— 取整偏向用户后减掉那 1 分，实付为 0',
    coupon: baseCoupon({ benefit: { kind: 'percent', percentOffBp: 5_000 } }),
    context: baseContext({ originalAmountMinor: 1 }),
    expected: 'not_chargeable_after_discount',
  },
];

describe('券判定：不能用的每一条都有理由', () => {
  for (const c of REJECTION_CASES) {
    it(`${c.expected}：${c.label}`, () => {
      const result = evaluateCoupon(c.coupon, c.context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(c.expected);
        expect(result.couponId).toBe(c.coupon.id);
      }
    });
  }

  it('🔴 面额恰好等于原价时剩 1 分 → 能用（可支付下限是 1 分，不是 2 分）', () => {
    // 与上面两条 0 元用例成对照：证明拒绝的是"不足 1 分"，不是"折扣很大"。
    const result = evaluateCoupon(
      baseCoupon({ benefit: { kind: 'fixed', amountOffMinor: 9_899 } }),
      baseContext(),
    );
    expect(result).toEqual({
      ok: true,
      couponId: 'launch-2026',
      discountMinor: 9_899,
      finalAmountMinor: 1,
    });
  });

  it('🔴 拒绝原因没有死分支：用例覆盖的原因集合**恰好等于**枚举本身', () => {
    const covered = new Set(REJECTION_CASES.map((c) => c.expected));
    // 这两个只有编排层能产生，见 `CouponEvaluateRejection` 的说明。
    covered.add('unknown_coupon');
    covered.add('stacking_not_allowed');
    expect([...covered].sort()).toEqual([...COUPON_REJECTION_REASONS].sort());
  });

  it('每个原因都有一句给人看的中文解释（新加原因会编译不过）', () => {
    for (const reason of COUPON_REJECTION_REASONS) {
      expect(COUPON_REJECTION_EXPLANATION[reason].length).toBeGreaterThan(0);
      expect(COUPON_REJECTION_EXPLANATION[reason]).not.toBe(reason);
    }
  });

  it('定义不合法时**抛异常**，不静默当"不能用"处理', () => {
    // 一张定义就坏掉的券出现在计价路径上 = 数据已损坏，必须响。
    const broken = baseCoupon({ benefit: { kind: 'percent', percentOffBp: 99_999 } });
    expect(() => evaluateCoupon(broken, baseContext())).toThrow(InvalidCouponDefinitionError);
  });
});

// ---------------------------------------------------------------------------
// 计价编排
// ---------------------------------------------------------------------------

const makeRequest = (overrides: Partial<QuoteRequest> = {}): QuoteRequest => ({
  priceId: 'annual',
  currency: 'CNY',
  region: 'CN',
  candidateCodes: [],
  ...overrides,
});

const couponMap = (...coupons: readonly CouponDefinition[]): ReadonlyMap<string, CouponDefinition> =>
  new Map(coupons.map((c) => [normalizeCouponCode(c.code ?? `@@${c.id}`), c] as const));

const quote = (
  request: Partial<QuoteRequest>,
  deps: {
    readonly coupons?: readonly CouponDefinition[];
    readonly overrides?: readonly PriceBookEntry[];
    readonly now?: number;
  } = {},
) =>
  quoteOrder(makeRequest(request), {
    baseline: DEFAULT_PRICE_BOOK,
    overrides: deps.overrides ?? [],
    couponsByCode: couponMap(...(deps.coupons ?? [])),
    now: deps.now ?? NOW,
  });

describe('计价：价格来自价目表，不来自别处', () => {
  it('没有券时原价 = 实付 = 9900', () => {
    const q = quote({});
    expect(q).toMatchObject({
      priceId: 'annual',
      currency: 'CNY',
      region: 'CN',
      originalAmountMinor: 9_900,
      discountMinor: 0,
      finalAmountMinor: 9_900,
      appliedCouponId: null,
      rejectedCoupons: [],
    });
  });

  it('海外价 4900，币种跟请求走（两支价格各自独立）', () => {
    const q = quote({ currency: 'USD', region: 'INTL' });
    expect(q.originalAmountMinor).toBe(4_900);
    expect(q.currency).toBe('USD');
  });

  it('报价带支付窗口，且窗口是正的', () => {
    const q = quote({});
    expect(q.quotedAt).toBe(NOW);
    expect(q.expiresAt).toBe(NOW + DEFAULT_PAYMENT_WINDOW_MS);
    expect(q.expiresAt).toBeGreaterThan(q.quotedAt);
  });

  it('🟢 数据库覆盖版本优先于代码基线（这就是"改价不改代码"）', () => {
    const q = quote(
      {},
      {
        overrides: [
          {
            priceId: 'annual',
            currency: 'CNY',
            amountMinor: 6_900,
            effectiveFrom: NOW - HOUR,
            effectiveUntil: null,
            note: '双十一',
          },
        ],
      },
    );
    expect(q.originalAmountMinor).toBe(6_900);
  });

  it('🔴 覆盖版本里的空隙**不回落到基线** —— 按旧价静默收款比报错更糟', () => {
    expect(() =>
      quote(
        {},
        {
          overrides: [
            {
              priceId: 'annual',
              currency: 'CNY',
              amountMinor: 6_900,
              effectiveFrom: NOW + HOUR,
              effectiveUntil: null,
            },
          ],
        },
      ),
    ).toThrow(QuotePricingError);
  });

  it('🔴 认不出的 SKU 直接抛，**绝不**按 0 元下单', () => {
    expect(() => quote({ priceId: 'lifetime' })).toThrow(QuotePricingError);
  });

  it('覆盖版本把价格写成 0 时被拒（手工 SQL 写坏价目表也要拦住）', () => {
    expect(() =>
      quote(
        {},
        {
          overrides: [
            {
              priceId: 'annual',
              currency: 'CNY',
              amountMinor: 0,
              effectiveFrom: 0,
              effectiveUntil: null,
            },
          ],
        },
      ),
    ).toThrow(QuotePricingError);
  });
});

describe('计价：选券', () => {
  const launch = baseCoupon({ id: 'launch', code: 'LAUNCH' });
  const big = baseCoupon({
    id: 'big',
    code: 'BIG',
    benefit: { kind: 'fixed', amountOffMinor: 3_000 },
  });

  it('用户敲的码命中 → 用上它', () => {
    const q = quote({ candidateCodes: ['launch'] }, { coupons: [launch, big] });
    expect(q.appliedCouponId).toBe('launch');
    expect(q.finalAmountMinor).toBe(7_900);
  });

  it('大小写不影响命中（大小写归一化在计价链路上真的生效）', () => {
    expect(quote({ candidateCodes: ['  lAuNcH '] }, { coupons: [launch] }).appliedCouponId).toBe(
      'launch',
    );
  });

  it('🔴 **不**自动换成折扣更大的券 —— 订单上记的券必须与用户敲的一致', () => {
    const q = quote({ candidateCodes: ['LAUNCH', 'BIG'] }, { coupons: [launch, big] });
    expect(q.appliedCouponId).toBe('launch');
    expect(q.discountMinor).toBe(2_000);
    expect(q.rejectedCoupons).toEqual([
      expect.objectContaining({ couponId: 'big', reason: 'stacking_not_allowed' }),
    ]);
  });

  it('第一个可用之前被拒的候选会留下原因，后面可用的照样生效', () => {
    const expired = baseCoupon({
      id: 'old',
      code: 'OLD',
      validUntil: NOW - 1,
    });
    const q = quote({ candidateCodes: ['OLD', 'LAUNCH'] }, { coupons: [expired, launch] });
    expect(q.appliedCouponId).toBe('launch');
    expect(q.rejectedCoupons).toEqual([
      expect.objectContaining({ couponId: 'old', reason: 'expired' }),
    ]);
  });

  it('不存在的码 → unknown_coupon，且**不影响**没有券时的价格', () => {
    const q = quote({ candidateCodes: ['NOPE'] }, { coupons: [launch] });
    expect(q.appliedCouponId).toBeNull();
    expect(q.finalAmountMinor).toBe(9_900);
    expect(q.rejectedCoupons).toEqual([
      { couponId: null, rawCode: 'NOPE', reason: 'unknown_coupon', explanation: '没有这个优惠码' },
    ]);
  });

  it('拒绝记录里保留用户**原样输入**的码（排查时要知道他到底敲了什么）', () => {
    const q = quote({ candidateCodes: ['  nope  '] }, {});
    expect(q.rejectedCoupons[0]!.rawCode).toBe('  nope  ');
  });

  it('同一张券由两个码指向时只评估一次 —— 拒绝列表里不会出现两条"同一张券"', () => {
    // 两个候选码都指向 launch（用一个码的别名字段模拟：这里直接用同名券的 id 相同）。
    const q = quote({ candidateCodes: ['LAUNCH', 'LAUNCH'] }, { coupons: [launch] });
    expect(q.appliedCouponId).toBe('launch');
    expect(q.rejectedCoupons).toEqual([]);
  });

  it('第一个候选不可用时第二个照常顶上（用户敲错了码不该丢掉他另一张券）', () => {
    const wrongCurrency = baseCoupon({
      id: 'usd-only',
      code: 'USDONLY',
      currency: 'USD',
    });
    const q = quote({ candidateCodes: ['USDONLY', 'LAUNCH'] }, { coupons: [wrongCurrency, launch] });
    expect(q.appliedCouponId).toBe('launch');
    expect(q.rejectedCoupons[0]).toMatchObject({
      couponId: 'usd-only',
      reason: 'currency_mismatch',
    });
  });

  it('一单最多一张券，且这个上限是**产品决策**', () => {
    expect(MAX_COUPONS_PER_ORDER).toBe(1);
  });

  it('usageByCouponId 真的被用上了（限额检查走的是调用方给的用量）', () => {
    const limited = baseCoupon({ id: 'limited', code: 'ONCE', maxRedemptionsPerUser: 1 });
    const q = quote(
      {
        candidateCodes: ['ONCE'],
        usageByCouponId: { limited: usage({ userRedemptions: 1 }) },
      },
      { coupons: [limited] },
    );
    expect(q.appliedCouponId).toBeNull();
    expect(q.rejectedCoupons[0]).toMatchObject({ reason: 'user_redemption_limit_reached' });
  });

  it('没给用量时按"从未用过"处理（新用户的第一单就是这个形状）', () => {
    const limited = baseCoupon({ id: 'limited', code: 'ONCE', maxRedemptionsPerUser: 1 });
    expect(quote({ candidateCodes: ['ONCE'] }, { coupons: [limited] }).appliedCouponId).toBe(
      'limited',
    );
  });

  it('没有候选码时不产生任何拒绝记录（不是"拒绝了什么"）', () => {
    expect(quote({}, { coupons: [launch] }).rejectedCoupons).toEqual([]);
  });
});

describe('计价：可支付币种', () => {
  it('只有 CNY / USD 是可售币种', () => {
    expect(isSellableCurrency('CNY')).toBe(true);
    expect(isSellableCurrency('USD')).toBe(true);
    for (const bad of ['EUR', 'cny', '', null, 1]) expect(isSellableCurrency(bad)).toBe(false);
  });

  it('区域是独立维度：币种相同但区域不同，券仍然可以按区域被拒', () => {
    const cnOnly = baseCoupon({ regions: ['CN'] });
    const q = quote(
      { currency: 'CNY', region: 'INTL', candidateCodes: ['LAUNCH'] },
      { coupons: [cnOnly] },
    );
    expect(q.rejectedCoupons[0]).toMatchObject({ reason: 'region_mismatch' });
  });
});

describe('计价：不变量（扫描全部币种 × 全部候选券组合）', () => {
  const currencies: Currency[] = ['CNY', 'USD'];
  const regions: Region[] = ['CN', 'INTL'];
  const coupons = [
    baseCoupon({ id: 'a', code: 'A', benefit: { kind: 'percent', percentOffBp: 3_333 } }),
    baseCoupon({ id: 'b', code: 'B', benefit: { kind: 'fixed', amountOffMinor: 1_000 } }),
    baseCoupon({ id: 'c', code: 'C', benefit: { kind: 'fixed', amountOffMinor: 99_000 } }),
    baseCoupon({ id: 'd', code: 'D', currency: 'USD', benefit: { kind: 'percent', percentOffBp: 5_000 } }),
    baseCoupon({ id: 'e', code: 'E', enabled: false }),
  ];

  it('任何 (%s) 组合下：折扣 ∈ [0, 原价]、实付 = 原价 − 折扣、且实付 ≥ 1 分', () => {
    for (const currency of currencies) {
      for (const region of regions) {
        for (const code of ['A', 'B', 'C', 'D', 'E', 'ZZZ', '']) {
          const q = quote(
            { currency, region, candidateCodes: [code] },
            { coupons },
          );
          expect(q.originalAmountMinor).toBeGreaterThan(0);
          expect(q.discountMinor).toBeGreaterThanOrEqual(0);
          expect(q.discountMinor).toBeLessThanOrEqual(q.originalAmountMinor);
          expect(q.originalAmountMinor - q.discountMinor).toBe(q.finalAmountMinor);
          expect(q.finalAmountMinor).toBeGreaterThanOrEqual(1);
          expect(q.currency).toBe(currency);
        }
      }
    }
  });

  it('同一入参反复报价结果恒等（报价是纯函数）', () => {
    const req = { currency: 'CNY' as Currency, region: 'CN' as Region, candidateCodes: ['A'] };
    const first = quote(req, { coupons });
    const second = quote(req, { coupons });
    expect(second).toEqual(first);
  });
});
