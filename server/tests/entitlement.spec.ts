import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENTITLEMENT_POLICY,
  evaluateCapability,
  evaluateEntitlement,
} from '../src/entitlement';

/**
 * 纯判定函数的行为钉死。
 *
 * 这里**不碰数据库、不碰 Fastify** —— 边界（尤其是"正好等于周期结束时刻"）
 * 必须能在没有服务端、没有时钟抖动的环境里确定地复现。
 */
describe('evaluateEntitlement', () => {
  const NOW = 1_700_000_000_000;

  it('allows an active subscription whose period ends in the future', () => {
    expect(
      evaluateEntitlement(
        { status: 'active', currentPeriodEnd: NOW + 86_400_000 },
        NOW,
      ),
    ).toEqual({ allowed: true });
  });

  it('treats a BigInt period end (Prisma shape) the same as a number', () => {
    expect(
      evaluateEntitlement(
        { status: 'active', currentPeriodEnd: BigInt(NOW + 1) },
        NOW,
      ),
    ).toEqual({ allowed: true });
  });

  describe('period end boundary is the half-open interval [start, end)', () => {
    it('rejects at exactly the period end instant', () => {
      expect(
        evaluateEntitlement({ status: 'active', currentPeriodEnd: NOW }, NOW),
      ).toEqual({ allowed: false, reason: 'PERIOD_ENDED' });
    });

    it('allows one millisecond before the end', () => {
      expect(
        evaluateEntitlement({ status: 'active', currentPeriodEnd: NOW + 1 }, NOW),
      ).toEqual({ allowed: true });
    });

    it('rejects one millisecond after the end', () => {
      expect(
        evaluateEntitlement({ status: 'active', currentPeriodEnd: NOW - 1 }, NOW),
      ).toEqual({ allowed: false, reason: 'PERIOD_ENDED' });
    });

    it('allows a far-future period end (a future timestamp is a valid grant)', () => {
      expect(
        evaluateEntitlement({ status: 'active', currentPeriodEnd: 32_503_680_000_000 }, NOW),
      ).toEqual({ allowed: true });
    });
  });

  describe('missing subscription', () => {
    it('rejects null', () => {
      expect(evaluateEntitlement(null, NOW)).toEqual({
        allowed: false,
        reason: 'NO_SUBSCRIPTION',
      });
    });

    it('rejects undefined', () => {
      expect(evaluateEntitlement(undefined, NOW)).toEqual({
        allowed: false,
        reason: 'NO_SUBSCRIPTION',
      });
    });
  });

  describe('status gate', () => {
    it.each(['past_due', 'canceled', 'expired', 'trialing', 'ACTIVE'])(
      'rejects status %s under the default policy',
      (status) => {
        expect(
          evaluateEntitlement({ status, currentPeriodEnd: NOW + 1 }, NOW),
        ).toEqual({ allowed: false, reason: 'STATUS_NOT_ENTITLED' });
      },
    );

    it('rejects a missing or non-string status', () => {
      expect(
        evaluateEntitlement({ currentPeriodEnd: NOW + 1 }, NOW),
      ).toEqual({ allowed: false, reason: 'STATUS_NOT_ENTITLED' });
      expect(
        evaluateEntitlement({ status: null, currentPeriodEnd: NOW + 1 }, NOW),
      ).toEqual({ allowed: false, reason: 'STATUS_NOT_ENTITLED' });
      expect(
        evaluateEntitlement(
          { status: 42 as unknown as string, currentPeriodEnd: NOW + 1 },
          NOW,
        ),
      ).toEqual({ allowed: false, reason: 'STATUS_NOT_ENTITLED' });
    });

    it('honours a caller-supplied policy that also entitles past_due', () => {
      const policy = { entitledStatuses: ['active', 'past_due'] };
      expect(
        evaluateEntitlement(
          { status: 'past_due', currentPeriodEnd: NOW + 1 },
          NOW,
          policy,
        ),
      ).toEqual({ allowed: true });
      // The default policy has not been mutated by passing an override.
      expect(DEFAULT_ENTITLEMENT_POLICY.entitledStatuses).toEqual(['active']);
    });
  });

  describe('period end presence and validity', () => {
    it('rejects a missing period end', () => {
      expect(evaluateEntitlement({ status: 'active' }, NOW)).toEqual({
        allowed: false,
        reason: 'MISSING_PERIOD_END',
      });
      expect(
        evaluateEntitlement({ status: 'active', currentPeriodEnd: null }, NOW),
      ).toEqual({ allowed: false, reason: 'MISSING_PERIOD_END' });
      expect(
        evaluateEntitlement({ status: 'active', currentPeriodEnd: undefined }, NOW),
      ).toEqual({ allowed: false, reason: 'MISSING_PERIOD_END' });
    });

    it.each([
      ['NaN', Number.NaN],
      ['+Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['a negative epoch', -1],
      ['a numeric string', '1700000000000'],
      ['an object', {}],
      ['a boolean', true],
    ])('rejects %s as an invalid period end without throwing', (_label, value) => {
      expect(
        evaluateEntitlement(
          { status: 'active', currentPeriodEnd: value as number },
          NOW,
        ),
      ).toEqual({ allowed: false, reason: 'INVALID_PERIOD_END' });
    });

    it('rejects a BigInt beyond Number.MAX_SAFE_INTEGER instead of losing precision', () => {
      expect(
        evaluateEntitlement(
          { status: 'active', currentPeriodEnd: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
          NOW,
        ),
      ).toEqual({ allowed: false, reason: 'INVALID_PERIOD_END' });
      expect(
        evaluateEntitlement({ status: 'active', currentPeriodEnd: -5n }, NOW),
      ).toEqual({ allowed: false, reason: 'INVALID_PERIOD_END' });
      // Exactly MAX_SAFE_INTEGER is still representable in a number.
      expect(
        evaluateEntitlement(
          {
            status: 'active',
            currentPeriodEnd: BigInt(Number.MAX_SAFE_INTEGER),
          },
          NOW,
        ),
      ).toEqual({ allowed: true });
    });
  });

  describe('clock validity', () => {
    it('rejects an invalid current time instead of silently allowing', () => {
      expect(
        evaluateEntitlement({ status: 'active', currentPeriodEnd: NOW + 1 }, Number.NaN),
      ).toEqual({ allowed: false, reason: 'INVALID_NOW' });
      expect(
        evaluateEntitlement(
          { status: 'active', currentPeriodEnd: NOW + 1 },
          Number.POSITIVE_INFINITY,
        ),
      ).toEqual({ allowed: false, reason: 'INVALID_NOW' });
    });
  });

  it('never throws on hostile input', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      {},
      { status: 'active', currentPeriodEnd: null },
      { status: Symbol('x') as unknown as string, currentPeriodEnd: NOW },
      { status: 'active', currentPeriodEnd: Symbol('x') as unknown as number },
    ];
    for (const value of hostile) {
      expect(() =>
        evaluateEntitlement(
          value as Parameters<typeof evaluateEntitlement>[0],
          NOW,
        ),
      ).not.toThrow();
    }
  });
});

/**
 * 能力判定：在"订阅有效"之上再问一句"**这一项能力**有没有买下来"。
 *
 * 这一层存在之前，判定的全部内容就是"有没有一条活跃订阅" —— 于是 ¥5 与 ¥12
 * 在代码里不可区分，用户付 ¥12 拿到和 ¥5 一样的东西。这一组测试就是
 * "两档真的分了"的证据。
 */
describe('evaluateCapability', () => {
  const NOW = 1_700_000_000_000;
  const live = (grants: readonly string[] | null) => ({
    status: 'active',
    currentPeriodEnd: NOW + 86_400_000,
    grants,
  });

  it('买的是 ¥5（只有 hosting）→ HostedSync 放行、AI 拒绝', () => {
    expect(evaluateCapability(live(['hosting']), 'hosting', NOW)).toEqual({ allowed: true });
    expect(evaluateCapability(live(['hosting']), 'ai', NOW)).toEqual({
      allowed: false,
      reason: 'GRANT_NOT_INCLUDED',
    });
  });

  it('买的是 ¥12（hosting + ai）→ 两项都放行', () => {
    for (const capability of ['hosting', 'ai'] as const) {
      expect(evaluateCapability(live(['hosting', 'ai']), capability, NOW)).toEqual({
        allowed: true,
      });
    }
  });

  it('🔴 顺序：订阅无效时**先**报订阅的原因，不会因为 grants 齐全就放行', () => {
    // 反过来写的话（先看 grants 再看有效期），一条已过期但 grants 正确的订阅
    // 会以 allowed:true 通过 —— "到期"被静默漏掉。这是最贵的一类顺序错误。
    const expiredButGranted = {
      status: 'active',
      currentPeriodEnd: NOW - 1,
      grants: ['hosting', 'ai'],
    };
    expect(evaluateCapability(expiredButGranted, 'ai', NOW)).toEqual({
      allowed: false,
      reason: 'PERIOD_ENDED',
    });
    expect(evaluateCapability(null, 'ai', NOW)).toEqual({
      allowed: false,
      reason: 'NO_SUBSCRIPTION',
    });
  });

  it('🔴 `[]` 与 `null` 都拒绝，但原因不同', () => {
    // `[]` = 这一行确实没有任何能力（也是老行的默认值）；
    // `null`/`undefined` = 读取方没拿到这一列（部署或 select 写错）。
    expect(evaluateCapability(live([]), 'hosting', NOW)).toEqual({
      allowed: false,
      reason: 'GRANT_NOT_INCLUDED',
    });
    expect(evaluateCapability(live(null), 'hosting', NOW)).toEqual({
      allowed: false,
      reason: 'MISSING_GRANTS',
    });
    expect(
      evaluateCapability({ status: 'active', currentPeriodEnd: NOW + 1 }, 'hosting', NOW),
    ).toEqual({ allowed: false, reason: 'MISSING_GRANTS' });
  });

  it('能力集合里出现未知词 → 不匹配任何已知能力（不因为"有东西"就放行）', () => {
    expect(evaluateCapability(live(['hosting', 'A1']), 'ai', NOW)).toEqual({
      allowed: false,
      reason: 'GRANT_NOT_INCLUDED',
    });
    // 但已知的那一项不受影响 —— 一个拼错的词不该拖垮整行。
    expect(evaluateCapability(live(['hosting', 'A1']), 'hosting', NOW)).toEqual({
      allowed: true,
    });
  });

  it('🔴 非数组的 grants 一律按 MISSING_GRANTS 拒绝 —— 字符串的 `includes` 是子串匹配', () => {
    // 这一条防的是一个**具体的 fail-open**：字符串也有 `includes`，于是
    // `'hosting,ai'` 会被当集合用，而 `'hosting,ai'.includes('ai')` 是 `true`。
    // 判定必须拒绝，而不是"看起来能用"。
    const hostile = [
      { status: 'active', currentPeriodEnd: NOW + 1, grants: 'hosting,ai' },
      { status: 'active', currentPeriodEnd: NOW + 1, grants: 'ai' },
      { status: 'active', currentPeriodEnd: NOW + 1, grants: 42 },
      { status: 'active', currentPeriodEnd: NOW + 1, grants: { 0: 'ai', length: 1 } },
    ];
    for (const value of hostile) {
      // 不抛异常……
      expect(() =>
        evaluateCapability(
          value as unknown as Parameters<typeof evaluateCapability>[0],
          'ai',
          NOW,
        ),
      ).not.toThrow();
      // ……并且**明确拒绝**（只是"不抛"是不够的：fail-open 也不抛）。
      expect(
        evaluateCapability(
          value as unknown as Parameters<typeof evaluateCapability>[0],
          'ai',
          NOW,
        ),
      ).toEqual({ allowed: false, reason: 'MISSING_GRANTS' });
    }
  });
});