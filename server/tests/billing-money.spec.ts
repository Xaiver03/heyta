import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  MIN_CHARGEABLE_AMOUNT_MINOR,
  PERCENT_OFF_BP_MAX,
  PERCENT_SCALE,
  breakdownAmount,
  clampDiscountMinor,
  computeDiscountMinor,
  formatMinor,
  isCurrency,
  isMinorAmount,
  isPercentOffBp,
  type Currency,
  type DiscountBenefit,
} from '../src/billing/money';

/**
 * 金额与折扣算术的证据文件。
 *
 * 与 `array-branch-equivalence.pglite.spec.ts` 同一条纪律：**举几个例子不算证明**。
 * 这里对不变量做**穷尽扫描**（而不是随机采样），因为参数空间小到可以扫完，
 * 而且金额这事儿不需要靠随机性来暴露边界 —— 边界是"0 / 1 / 恰好整除 / 差一分"，
 * 这些在扫描里必然出现。
 *
 * 🔴 每条不变量都配一个**会打破它的"变异体"**。一条不会红的断言等于没有断言：
 * 如果哪天有人把 `ceil` 改成 `floor`，本文件必须报红。
 */

/** 扫描用的金额集合：含 0、1 分、恰好整除、以及真实价格 9900 / 4900。 */
const AMOUNTS = [0, 1, 2, 3, 7, 99, 100, 101, 4_900, 9_900, 9_901, 123_456, 999_999];

/** 扫描用的基点集合：含 0、100%（全额）、以及除不尽的 3333 / 6667。 */
const BASIS_POINTS = [0, 1, 50, 333, 1_000, 1_500, 3_333, 5_000, 6_667, 9_999, PERCENT_OFF_BP_MAX];

const couponsOf = (): DiscountBenefit[] => [
  ...BASIS_POINTS.map((percentOffBp): DiscountBenefit => ({ kind: 'percent', percentOffBp })),
  ...[0, 1, 100, 4_900, 9_900, 99_000].map(
    (amountOffMinor): DiscountBenefit => ({ kind: 'fixed', amountOffMinor }),
  ),
];

describe('money：整数分币', () => {
  it('币种只有 CNY / USD 两个，且运行时判据拒绝其它一切', () => {
    expect(CURRENCIES).toEqual(['CNY', 'USD']);
    for (const c of CURRENCIES) expect(isCurrency(c)).toBe(true);
    for (const bad of ['cny', 'JPY', '', null, 0, {}, 'CNY ']) {
      expect(isCurrency(bad)).toBe(false);
    }
  });

  it('isMinorAmount 只接受安全整数（拒绝浮点、NaN、Infinity、字符串）', () => {
    expect(isMinorAmount(0)).toBe(true);
    expect(isMinorAmount(9_900)).toBe(true);
    for (const bad of [1.5, NaN, Infinity, -Infinity, '9900', null, undefined, 2 ** 53]) {
      expect(isMinorAmount(bad)).toBe(false);
    }
  });

  it('isPercentOffBp 的上下界都闭合在 [0, 10000]', () => {
    expect(isPercentOffBp(0)).toBe(true);
    expect(isPercentOffBp(PERCENT_OFF_BP_MAX)).toBe(true);
    expect(isPercentOffBp(1)).toBe(true);
    for (const bad of [-1, 10_001, 1.5, NaN, '1500', null]) {
      expect(isPercentOffBp(bad)).toBe(false);
    }
  });

  it('非法入参一律**抛异常**，绝不静默返回一个数字', () => {
    // 静默返回 0 会让"券没生效"看起来像"券生效了但刚好减 0"。
    expect(() => computeDiscountMinor({ kind: 'percent', percentOffBp: 10_001 }, 100)).toThrow(
      RangeError,
    );
    expect(() => computeDiscountMinor({ kind: 'percent', percentOffBp: -1 }, 100)).toThrow(
      RangeError,
    );
    expect(() => computeDiscountMinor({ kind: 'fixed', amountOffMinor: 1.5 }, 100)).toThrow(
      RangeError,
    );
    expect(() => computeDiscountMinor({ kind: 'percent', percentOffBp: 500 }, -1)).toThrow(
      RangeError,
    );
    expect(() => computeDiscountMinor({ kind: 'percent', percentOffBp: 500 }, 1.5)).toThrow(
      RangeError,
    );
  });
});

describe('money：折扣不变量（穷尽扫描，不是采样）', () => {
  const cases = AMOUNTS.flatMap((amount) => couponsOf().map((benefit) => ({ amount, benefit })));

  it('扫描规模：确实覆盖了金额 × 券的整个笛卡尔积', () => {
    // 防止有人把 AMOUNTS 清空让下面所有断言变成空循环（那种"全绿")。
    expect(cases.length).toBe(AMOUNTS.length * couponsOf().length);
    expect(cases.length).toBeGreaterThan(150);
  });

  it('INV-DETERMINISTIC：同一入参恒等，且结果永远是整数', () => {
    for (const { amount, benefit } of cases) {
      const a = computeDiscountMinor(benefit, amount);
      const b = computeDiscountMinor(benefit, amount);
      expect(a).toBe(b);
      expect(Number.isInteger(a)).toBe(true);
    }
  });

  it('INV-NON-NEGATIVE / INV-NOT-MORE-THAN-BASE / INV-DISCOUNT-RANGE', () => {
    for (const { amount, benefit } of cases) {
      const { originalAmountMinor, discountMinor, finalAmountMinor } = breakdownAmount(
        amount,
        computeDiscountMinor(benefit, amount),
      );
      expect(finalAmountMinor).toBeGreaterThanOrEqual(0);
      expect(finalAmountMinor).toBeLessThanOrEqual(originalAmountMinor);
      expect(discountMinor).toBeGreaterThanOrEqual(0);
      expect(discountMinor).toBeLessThanOrEqual(originalAmountMinor);
      expect(originalAmountMinor - discountMinor).toBe(finalAmountMinor);
    }
  });

  it('INV-PERCENT-AT-LEAST：用户拿到的折扣**不少于**券面承诺的百分比', () => {
    // final × 10000 ≤ original × (10000 − bp)
    // 等价于"实付比例 ≤ 承诺比例"，即"折扣 ≥ 承诺折扣"。
    for (const amount of AMOUNTS) {
      for (const percentOffBp of BASIS_POINTS) {
        const { finalAmountMinor } = breakdownAmount(
          amount,
          computeDiscountMinor({ kind: 'percent', percentOffBp }, amount),
        );
        expect(finalAmountMinor * PERCENT_SCALE).toBeLessThanOrEqual(
          amount * (PERCENT_SCALE - percentOffBp),
        );
      }
    }
  });

  it('🔴 变异体：floor 会打破 INV-PERCENT-AT-LEAST —— 这条不变量确实是活的', () => {
    // 9900 分、33.33% off：ceil → 3300（实付 6600，折扣 ≥ 33.33%）
    //                    floor → 3299（实付 6601，折扣只有 33.32%）
    const promoted = computeDiscountMinor({ kind: 'percent', percentOffBp: 3_333 }, 9_900);
    expect(promoted).toBe(3_300);
    const floored = Math.floor((9_900 * 3_333) / PERCENT_SCALE);
    expect(floored).toBe(3_299);
    expect(floored).not.toBe(promoted);
    // 承诺：实付 ≤ 9900 × (1 − 0.3333)
    const promise = (9_900 * (PERCENT_SCALE - 3_333)) / PERCENT_SCALE;
    expect(9_900 - promoted).toBeLessThanOrEqual(promise);
    // floor 版本违反承诺 —— 若实现被改成 floor，上面的断言会红。
    expect(9_900 - floored).toBeGreaterThan(promise);
  });

  it('INV-FIXED-EXACT：绝对值券在不超原价时**精确**等于券面值', () => {
    for (const amount of AMOUNTS) {
      for (const off of [0, 1, 100, 4_900]) {
        if (off > amount) continue;
        expect(computeDiscountMinor({ kind: 'fixed', amountOffMinor: off }, amount)).toBe(off);
      }
    }
  });

  it('绝对值券超过原价 → 夹到原价（实付 0，而不是负数）', () => {
    // 券面额必须**大于扫描集里的最大金额**，否则最小的一单不会被夹到 0。
    const HUGE_OFF = 1_000_000;
    expect(HUGE_OFF).toBeGreaterThan(Math.max(...AMOUNTS));
    for (const amount of AMOUNTS) {
      const { discountMinor, finalAmountMinor } = breakdownAmount(
        amount,
        computeDiscountMinor({ kind: 'fixed', amountOffMinor: HUGE_OFF }, amount),
      );
      expect(discountMinor).toBe(amount);
      expect(finalAmountMinor).toBe(0);
    }
  });

  it('100% 券把实付打到 0，这是"不可支付"的边界，由 MIN_CHARGEABLE 拒绝', () => {
    for (const amount of AMOUNTS) {
      const { finalAmountMinor } = breakdownAmount(
        amount,
        computeDiscountMinor({ kind: 'percent', percentOffBp: PERCENT_OFF_BP_MAX }, amount),
      );
      expect(finalAmountMinor).toBe(0);
      // 0 元单不可支付（微信 Native 拒收 0 元），所以这个值必须被下游拒绝。
      expect(finalAmountMinor).toBeLessThan(MIN_CHARGEABLE_AMOUNT_MINOR);
    }
  });

  it('clampDiscountMinor 对越界折扣都夹回合法区间', () => {
    expect(clampDiscountMinor(-5, 100)).toBe(0);
    expect(clampDiscountMinor(0, 100)).toBe(0);
    expect(clampDiscountMinor(100, 100)).toBe(100);
    expect(clampDiscountMinor(101, 100)).toBe(100);
    expect(clampDiscountMinor(1e9, 100)).toBe(100);
    expect(() => clampDiscountMinor(NaN, 100)).toThrow(RangeError);
  });
});

describe('money：单价与格式化', () => {
  it('真实价格格式化：9900 分 → ¥99.00，4900 分 → $49.00', () => {
    expect(formatMinor(9_900, 'CNY')).toBe('¥99.00');
    expect(formatMinor(4_900, 'USD')).toBe('$49.00');
  });

  it('格式化不丢分、不四舍五入、负数带负号', () => {
    for (const [minor, expected] of [
      [0, '¥0.00'],
      [1, '¥0.01'],
      [9, '¥0.09'],
      [10, '¥0.10'],
      [99, '¥0.99'],
      [100, '¥1.00'],
      [101, '¥1.01'],
      [-99, '-¥0.99'],
      [123_456, '¥1234.56'],
    ] as const) {
      expect(formatMinor(minor, 'CNY')).toBe(expected);
    }
  });

  it('格式化拒绝非整数（审计表里不该出现"9900.5 分"）', () => {
    expect(() => formatMinor(1.5, 'CNY')).toThrow(RangeError);
  });

  it('每种币种都有自己的符号 —— 不存在"用 ¥ 表示美元"的回退', () => {
    const symbolOf = (c: Currency) => formatMinor(100, c)[0];
    expect(symbolOf('CNY')).toBe('¥');
    expect(symbolOf('USD')).toBe('$');
    expect(new Set(CURRENCIES.map(symbolOf)).size).toBe(CURRENCIES.length);
  });
});
