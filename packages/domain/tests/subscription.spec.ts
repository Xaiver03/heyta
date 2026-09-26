/**
 * 客户端权益读取与降级判定的测试。
 *
 * 三条硬约束在这里被机械钉住：
 *   1. **到期边界与服务端一致**（半开区间 `[start, end)`，`now === end` 即过期）；
 *   2. **fail-open**：问不到服务端时**不降级**；
 *   3. 词表与服务端**不许漂移**（直接读服务端源文件对账）。
 *
 * 本文件不碰任何任务数据 —— 权益判定接受不了任务字段（见 `subscription.ts` 文件头）。
 */
import { readFileSync } from 'node:fs';
import { extendSubscriptionPeriod } from '../src/subscription.js';
import { describe, expect, it } from 'vitest';

import {
  ENTITLEMENT_DENIAL_REASONS,
  HOSTED_SYNC_SUBSCRIPTION_ERROR_CODE,
  UNKNOWN_ENTITLEMENT_DENIAL_REASON,
  decideHostedSyncAccess,
  evaluateSubscriptionPeriod,
  isEntitlementDenialReason,
  parseHostedEntitlementResponse,
  type HostedEntitlementReading,
} from '../src/subscription.js';

/** 与服务端测试同一个"现在"，便于对照边界。 */
const NOW = 1_700_000_000_000;

describe('evaluateSubscriptionPeriod —— 到期边界是半开区间 [start, end)', () => {
  it('exactly at the period end is already expired', () => {
    expect(evaluateSubscriptionPeriod(NOW, NOW)).toBe('expired');
  });

  it('one millisecond before the end is still active', () => {
    expect(evaluateSubscriptionPeriod(NOW + 1, NOW)).toBe('active');
  });

  it('one millisecond after the end is expired', () => {
    expect(evaluateSubscriptionPeriod(NOW - 1, NOW)).toBe('expired');
  });

  it('a far-future period end is active', () => {
    expect(evaluateSubscriptionPeriod(32_503_680_000_000, NOW)).toBe('active');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['string', '1700000000000'],
    ['bigint', 1_700_000_000_000n],
  ])('treats a %s period end as unknown (never guesses)', (_label, value) => {
    expect(evaluateSubscriptionPeriod(value, NOW)).toBe('unknown');
  });

  it('treats a non-finite now as unknown', () => {
    expect(evaluateSubscriptionPeriod(NOW + 1, Number.NaN)).toBe('unknown');
  });
});

describe('isEntitlementDenialReason', () => {
  it('accepts exactly the server vocabulary', () => {
    for (const reason of ENTITLEMENT_DENIAL_REASONS) {
      expect(isEntitlementDenialReason(reason)).toBe(true);
    }
    expect(isEntitlementDenialReason('SOMETHING_NEW')).toBe(false);
    expect(isEntitlementDenialReason(42)).toBe(false);
  });
});

describe('parseHostedEntitlementResponse —— 只读服务端既有的 402 表达', () => {
  it('reads the server refusal verbatim', () => {
    expect(
      parseHostedEntitlementResponse({
        status: 402,
        body: {
          error: 'A paid subscription is required to use this hosted service.',
          errorCode: HOSTED_SYNC_SUBSCRIPTION_ERROR_CODE,
          reason: 'PERIOD_ENDED',
        },
      }),
    ).toEqual({ kind: 'denied', reason: 'PERIOD_ENDED' });
  });

  it('carries currentPeriodEnd through when the server happens to send one', () => {
    expect(
      parseHostedEntitlementResponse({
        status: 402,
        body: {
          errorCode: HOSTED_SYNC_SUBSCRIPTION_ERROR_CODE,
          reason: 'PERIOD_ENDED',
          currentPeriodEnd: NOW,
        },
      }),
    ).toEqual({ kind: 'denied', reason: 'PERIOD_ENDED', currentPeriodEnd: NOW });
  });

  it('does NOT guess an unknown reason as expired', () => {
    expect(
      parseHostedEntitlementResponse({
        status: 402,
        body: { errorCode: HOSTED_SYNC_SUBSCRIPTION_ERROR_CODE, reason: 'BRAND_NEW_REASON' },
      }),
    ).toEqual({ kind: 'denied', reason: UNKNOWN_ENTITLEMENT_DENIAL_REASON });
  });

  it('treats a 402 from some other paywall as unavailable (we do not own that vocabulary)', () => {
    expect(
      parseHostedEntitlementResponse({
        status: 402,
        body: { errorCode: 'STORAGE_QUOTA_EXCEEDED', reason: 'PERIOD_ENDED' },
      }),
    ).toEqual({ kind: 'unavailable', cause: 'unexpected-response' });
  });

  it('treats 2xx as entitled, whatever the body says', () => {
    expect(parseHostedEntitlementResponse({ status: 200, body: {} })).toEqual({
      kind: 'entitled',
    });
  });

  it.each([401, 403, 404, 429, 500, 0])('treats HTTP %s as unavailable', (status) => {
    expect(parseHostedEntitlementResponse({ status })).toEqual({
      kind: 'unavailable',
      cause: 'unexpected-response',
    });
  });

  it('survives a non-object body on a 402', () => {
    expect(
      parseHostedEntitlementResponse({ status: 402, body: 'not json' }),
    ).toEqual({ kind: 'unavailable', cause: 'unexpected-response' });
  });
});

describe('decideHostedSyncAccess —— fail-open：不确定的时候不限制用户', () => {
  const unrestrictedReadings: readonly [string, HostedEntitlementReading][] = [
    ['not configured', { kind: 'unconfigured' }],
    ['no token', { kind: 'unavailable', cause: 'no-token' }],
    ['network failure', { kind: 'unavailable', cause: 'network' }],
    ['unexpected response', { kind: 'unavailable', cause: 'unexpected-response' }],
    ['entitled', { kind: 'entitled' }],
  ];

  it.each(unrestrictedReadings)('%s → unrestricted', (_label, reading) => {
    expect(decideHostedSyncAccess(reading, NOW).kind).toBe('unrestricted');
  });

  it('a denied reading is the ONLY thing that restricts', () => {
    const access = decideHostedSyncAccess({ kind: 'denied', reason: 'PERIOD_ENDED' }, NOW);
    expect(access).toEqual({ kind: 'restricted', reason: 'PERIOD_ENDED', expired: true });
  });

  it('flags PERIOD_ENDED as expired', () => {
    const access = decideHostedSyncAccess({ kind: 'denied', reason: 'PERIOD_ENDED' }, NOW);
    expect(access.kind === 'restricted' && access.expired).toBe(true);
  });

  it('does not flag other refusals as expired', () => {
    for (const reason of ['NO_SUBSCRIPTION', 'STATUS_NOT_ENTITLED', 'INVALID_NOW'] as const) {
      const access = decideHostedSyncAccess({ kind: 'denied', reason }, NOW);
      expect(access.kind === 'restricted' && access.expired).toBe(false);
    }
  });

  it('an unknown reason still restricts but never claims "expired"', () => {
    const access = decideHostedSyncAccess(
      { kind: 'denied', reason: UNKNOWN_ENTITLEMENT_DENIAL_REASON },
      NOW,
    );
    expect(access).toEqual({
      kind: 'restricted',
      reason: UNKNOWN_ENTITLEMENT_DENIAL_REASON,
      expired: false,
    });
  });

  it('uses a server-supplied period end to decide "expired"', () => {
    const access = decideHostedSyncAccess(
      { kind: 'denied', reason: 'STATUS_NOT_ENTITLED', currentPeriodEnd: NOW },
      NOW,
    );
    expect(access.kind === 'restricted' && access.expired).toBe(true);
  });
});

/**
 * 🔴 漂移守卫。
 *
 * 客户端的错误码与拒绝原因联合**必须**与服务端逐字一致。漂移的后果是
 * **静默的**：客户端认不出服务端的拒绝，于是 fail-open 地什么都不做 ——
 * 没有报错、没有提示，只是这条线永远不生效。
 *
 * 所以这里直接读服务端源文件对账（而不是把同一份字面量再抄一遍 ——
 * 抄一遍只能证明"我抄得对"，证明不了"它没变"）。
 */
describe('contract with server/src/entitlement.ts', () => {
  const serverSource = readFileSync(
    new URL('../../../server/src/entitlement.ts', import.meta.url),
    'utf8',
  );

  it('the error code is identical on both sides', () => {
    const match = /export const ENTITLEMENT_ERROR_CODE = '([^']+)'/.exec(serverSource);
    expect(match?.[1]).toBe(HOSTED_SYNC_SUBSCRIPTION_ERROR_CODE);
  });

  it('every denial reason we know about exists on the server, and no extra ones do', () => {
    const union = /export type EntitlementDenialReason =([\s\S]*?);/.exec(serverSource);
    expect(union).not.toBeNull();
    const serverReasons = [...(union?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(serverReasons.length).toBeGreaterThan(0);
    expect([...serverReasons].sort()).toEqual([...ENTITLEMENT_DENIAL_REASONS].sort());
  });

  it('the boundary rule is still `now >= periodEnd` on the server', () => {
    // 边界是产品决定里唯一一个"两处各判一次"会真的出错的地方，
    // 所以连比较方向也一起钉住。
    expect(serverSource).toMatch(/now >= periodEnd/);
  });
});

describe('extendSubscriptionPeriod —— 一次支付如何变成一段时长', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 1_800_000_000_000; // 固定时刻，避免用到真实时钟

  it('首次购买：从当前时刻起算 365 天', () => {
    expect(extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: null })).toBe(
      NOW + 365 * DAY,
    );
  });

  it('🔴 提前续费必须叠加 —— 不许丢掉已经付过钱的剩余时间', () => {
    // 还剩 100 天时又买了一年：应该是 100 + 365 = 465 天，
    // 而不是被重置成 365 天。
    const existing = NOW + 100 * DAY;
    const next = extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: existing });

    expect(next).toBe(NOW + 465 * DAY);
    // 钉住"没有被重置"这个性质本身，而不只是钉住那个数字。
    expect(next).toBeGreaterThan(existing + 364 * DAY);
  });

  it('已过期后续费：从当前时刻起算，不从过期的端点起算', () => {
    // 到期日已经过去 10 天。若拿它去叠加，新买的时长会有 10 天埋在过去。
    const lapsed = NOW - 10 * DAY;
    expect(extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: lapsed })).toBe(
      NOW + 365 * DAY,
    );
  });

  it('到期日正好是当前时刻：按"已到期"处理，从 now 起算', () => {
    expect(extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: NOW })).toBe(
      NOW + 365 * DAY,
    );
  });

  it('连续两次提前续费：时长单调递增，永不倒退', () => {
    const first = extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: null });
    const second = extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: first });
    const third = extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: second });

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(third).toBe(NOW + 3 * 365 * DAY);
  });

  it('可以指定别的时长（默认 365 天不是硬编码）', () => {
    expect(
      extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: null, days: 30 }),
    ).toBe(NOW + 30 * DAY);
  });

  it('🔴 非有限输入必须抛异常 —— 这是收钱路径，算不出来就要响', () => {
    expect(() =>
      extendSubscriptionPeriod({ now: Number.NaN, currentPeriodEnd: null }),
    ).toThrow();
    expect(() =>
      extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: Number.NaN }),
    ).toThrow();
    expect(() =>
      extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: null, days: 0 }),
    ).toThrow();
    expect(() =>
      extendSubscriptionPeriod({ now: NOW, currentPeriodEnd: null, days: -1 }),
    ).toThrow();
  });
});

