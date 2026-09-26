import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENTITLEMENT_POLICY,
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