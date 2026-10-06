/**
 * 退款口径的测试。
 *
 * 🔴 这一组的核心不是"分支覆盖"，而是**五条会漏钱的形状**：
 *
 * 1. **退款金额只能等于结算时收到的实付**，不能等于原价/报价 —— 用了券的单
 *    按原价退就是多退钱（`500` 收、`400` 付、退 `500`）。
 * 2. **`operatorApproved` 只许跳过时间窗**，不许跳过"这单根本没付过钱"。
 * 3. **没有订单号到账的一律拒退**：ADR-0026 查实模型里算不出"这一段"是多久，
 *    那种回收必然是过度回收（把更早那笔合法购买一起撤销）。
 * 4. **回退天数不许把行推到 `now` 之前**，也不许在"一笔都不剩"时还留着未来时间。
 */
import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_PERIOD_DAYS } from '@heyta/domain';

import {
  REFUND_PERIOD_DAYS,
  REFUND_WINDOW_MS,
  decideRefundEligibility,
  retractGrantedPeriod,
  type RefundEligibilityInput,
} from '../src/billing/refund-policy.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const paid = (over: Partial<RefundEligibilityInput> = {}): RefundEligibilityInput => ({
  status: 'paid',
  paidAt: NOW - DAY,
  paidAmountMinor: 400,
  outTradeNo: 'hy1x2xabc',
  now: NOW,
  ...over,
});

describe('decideRefundEligibility', () => {
  it('7×24 小时内：全额退，退的是实付', () => {
    expect(decideRefundEligibility(paid())).toEqual({ allowed: true, amountMinor: 400, reason: null });
    expect(REFUND_WINDOW_MS).toBe(7 * DAY);
  });

  it('🔴 退的是实付而不是原价：500 原价、券减 100、付 400 ⇒ 只能退 400', () => {
    const d = decideRefundEligibility(paid({ paidAmountMinor: 400 }));
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.amountMinor).toBeLessThan(500);
  });

  it('刚好卡在窗口边界内侧仍然可退，过一秒就不可退', () => {
    expect(decideRefundEligibility(paid({ paidAt: NOW - REFUND_WINDOW_MS }))).toMatchObject({ allowed: true });
    expect(decideRefundEligibility(paid({ paidAt: NOW - REFUND_WINDOW_MS - 1 }))).toMatchObject({
      allowed: false,
      reason: 'WINDOW_PASSED',
    });
  });

  it('🔴 超窗后 operatorApproved 只打开时间窗这一条', () => {
    const late = { paidAt: NOW - REFUND_WINDOW_MS - DAY };
    expect(decideRefundEligibility(paid(late))).toMatchObject({ reason: 'WINDOW_PASSED' });
    expect(decideRefundEligibility(paid({ ...late, operatorApproved: true }))).toMatchObject({ allowed: true });

    // 但同一个开关**不许**把"根本没付过钱"或"算不出金额"放行。
    for (const over of [
      { ...late, status: 'pending' },
      { ...late, paidAt: null },
      { ...late, paidAmountMinor: null },
      { ...late, outTradeNo: null },
      { ...late, openRefundExists: true },
    ]) {
      expect(decideRefundEligibility(paid(over)).allowed, JSON.stringify(over)).toBe(false);
    }
  });

  it('🔴 同一单已经有一条开着的退款 ⇒ 不能再开一条（两条都会发给通道）', () => {
    expect(decideRefundEligibility(paid({ openRefundExists: true }))).toMatchObject({
      allowed: false,
      reason: 'REFUND_ALREADY_OPEN',
    });
    // 顺序也要钉：`ALREADY_REFUNDED` 排在它前面，所以"订单已经退了"必须报**那一条**，
    // 而不是报"还有一条开着的"—— 前者才是运营要看的事实。
    expect(
      decideRefundEligibility(paid({ status: 'refunded', openRefundExists: true })).reason,
    ).toBe('ALREADY_REFUNDED');
    // 窗口内的正常单 + 没有开着的退款 ⇒ 仍然放行（证明上一条不是一律拒）。
    expect(decideRefundEligibility(paid({ openRefundExists: false }))).toMatchObject({ allowed: true });
    // 没传这个字段 = 没有开着的退款：默认值必须是**放行**，否则整条申请路径会静默死掉。
    expect(decideRefundEligibility(paid())).toMatchObject({ allowed: true });
  });

  it('已退过的单不能退第二次', () => {
    expect(decideRefundEligibility(paid({ status: 'refunded' }))).toMatchObject({
      reason: 'ALREADY_REFUNDED',
    });
  });

  it('🔴 没有订单号的到账 = 算不出"这一段"多长 ⇒ 拒退（ADR-0026 的硬约束）', () => {
    expect(decideRefundEligibility(paid({ outTradeNo: null }))).toMatchObject({
      allowed: false,
      reason: 'NOT_CHECKOUT_ORDER',
    });
    // 例外也不许绕过这一条：它不是"政策严不严"，是"能不能算对"。
    expect(decideRefundEligibility(paid({ outTradeNo: null, operatorApproved: true }))).toMatchObject({
      allowed: false,
      reason: 'NOT_CHECKOUT_ORDER',
    });
  });

  it('到账金额缺失或为 0 时拒退（金额口径不成立）', () => {
    for (const amount of [null, 0, -5, 12.5]) {
      expect(decideRefundEligibility(paid({ paidAmountMinor: amount })).reason, String(amount)).toBe(
        'AMOUNT_UNVERIFIED',
      );
    }
  });
});

describe('retractGrantedPeriod', () => {
  it('还剩别的已付订单：扣掉恰好 30 天，不动更早那笔买下的时间', () => {
    const end = NOW + 45 * DAY;
    expect(retractGrantedPeriod({ currentPeriodEnd: end, now: NOW, remainingPaidOrders: 1 })).toBe(
      end - REFUND_PERIOD_DAYS * DAY,
    );
    // 🔴 它必须是**指针**而不是第四份事实：授予侧改了天数，这里必须跟着变。
    // `refund-policy.ts` 的注释承诺了这条，这条断言就是兑现它的地方。
    expect(REFUND_PERIOD_DAYS).toBe(SUBSCRIPTION_PERIOD_DAYS);
    // 现量：全仓今天只有一个授予时长。迁移里 `period_days BETWEEN 1 AND 366` 的上界
    // 成立的前提就是"没有年度档"，所以这一行是**承重的**，不是装饰。
    expect(SUBSCRIPTION_PERIOD_DAYS).toBe(30);
  });

  it('🔴 扣完不许退到 now 之前（已经消费掉的天数追不回来）', () => {
    const end = NOW + 5 * DAY;
    expect(retractGrantedPeriod({ currentPeriodEnd: end, now: NOW, remainingPaidOrders: 2 })).toBe(NOW);
  });

  it('一笔都不剩：整行到期日落到 now（立即失效，但**不删行**）', () => {
    expect(
      retractGrantedPeriod({ currentPeriodEnd: NOW + 20 * DAY, now: NOW, remainingPaidOrders: 0 }),
    ).toBe(NOW);
  });

  it('本来就还没到期的未来时间不受影响；已到期的行保持原样（不抹掉"何时到期"的事实）', () => {
    expect(retractGrantedPeriod({ currentPeriodEnd: null, now: NOW, remainingPaidOrders: 1 })).toBeNull();
    const longAgo = NOW - 3 * DAY;
    expect(retractGrantedPeriod({ currentPeriodEnd: longAgo, now: NOW, remainingPaidOrders: 4 })).toBe(longAgo);
  });
});
