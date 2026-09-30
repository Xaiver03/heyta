import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENTITLEMENT_POLICY,
  evaluateCapability,
  evaluateCapabilityAcross,
  type EntitlementSubscription,
} from '../src/entitlement';

/**
 * `evaluateCapabilityAcross` —— 权益是**多个来源的并集**。
 *
 * ## 🔴 这个文件守的是一条会静默丢钱的回归
 *
 * 在这个函数出现之前，守卫读订阅用的是
 * `findFirst({ where: { userId }, orderBy: { id: 'desc' } })`：**最新那一行说了算**。
 * 只有一个 provider（微信）时那是对的 —— 一个用户最多一行。
 *
 * 邀请奖励打破了它：奖励写进 `subscriptions` 时 `provider = 'invite'`，
 * 于是库里会有两行，而奖励行**是后建的**。按"最新一行"判定，一个
 * "付费到 20 天后 + 被邀请拿 5 天"的用户会被判到那 5 天上，
 * **已付的 15 天凭空消失**，且每一层都不会报错。
 *
 * 所以下面那条"付费行更晚到期 → 仍然放行"的用例是整个文件的核心，
 * 其余用例是把并集语义的边界钉死。
 */

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const paidLong: EntitlementSubscription = {
  status: 'active',
  currentPeriodEnd: NOW + 20 * DAY,
  grants: ['hosting'],
};

/** 后建的那一行：`id` 更大，到期日更早。这正是回归的形状。 */
const inviteShort: EntitlementSubscription = {
  status: 'active',
  currentPeriodEnd: NOW + 5 * DAY,
  grants: ['hosting'],
};

describe('并集语义：任一来源满足即可', () => {
  it('🔴 付费到 20 天后 + 邀请到 5 天后 → 放行（不能只看最新那一行）', () => {
    // 顺序刻意与 `findMany({ orderBy: { id: 'desc' } })` 的产出一致：
    // 奖励行在后建，所以排在前面。
    const rows = [inviteShort, paidLong];
    expect(evaluateCapabilityAcross(rows, 'hosting', NOW)).toEqual({ allowed: true });

    // 反证：单行版只看第一行（= 最新那行）会拒绝。这正是要修的行为。
    expect(evaluateCapability(inviteShort, 'hosting', NOW).allowed).toBe(true);
    expect(evaluateCapability(paidLong, 'hosting', NOW).allowed).toBe(true);
  });

  it('🔴 顺序无关：把两行反过来还是放行', () => {
    expect(evaluateCapabilityAcross([paidLong, inviteShort], 'hosting', NOW)).toEqual({
      allowed: true,
    });
  });

  it('付费行过期、邀请行还有效 → 放行（邀请正是用来兜住这种情况的）', () => {
    const expiredPaid: EntitlementSubscription = {
      status: 'active',
      currentPeriodEnd: NOW - DAY,
      grants: ['hosting'],
    };
    expect(
      evaluateCapabilityAcross([inviteShort, expiredPaid], 'hosting', NOW),
    ).toEqual({ allowed: true });
  });

  it('两行都过期 → 拒绝，原因是 PERIOD_ENDED', () => {
    const expired = (id: number): EntitlementSubscription => ({
      status: 'active',
      currentPeriodEnd: NOW - id * DAY,
      grants: ['hosting'],
    });
    const decision = evaluateCapabilityAcross([expired(1), expired(2)], 'hosting', NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe('PERIOD_ENDED');
  });

  it('能力取并集：一行 hosting、一行 ai → 两项都放行', () => {
    const hostingOnly: EntitlementSubscription = {
      status: 'active',
      currentPeriodEnd: NOW + DAY,
      grants: ['hosting'],
    };
    const aiOnly: EntitlementSubscription = {
      status: 'active',
      currentPeriodEnd: NOW + DAY,
      grants: ['ai'],
    };
    expect(evaluateCapabilityAcross([aiOnly, hostingOnly], 'hosting', NOW).allowed).toBe(
      true,
    );
    expect(evaluateCapabilityAcross([aiOnly, hostingOnly], 'ai', NOW).allowed).toBe(true);
    expect(evaluateCapabilityAcross([hostingOnly], 'ai', NOW).allowed).toBe(false);
  });

  it('🔴 不是 AND：一行缺 grants 不该拖累另一行', () => {
    // 按 AND 判的话，"只有 ai"那行会让 hosting 被拒 —— 而 hosting 明明买过。
    const aiOnly: EntitlementSubscription = {
      status: 'active',
      currentPeriodEnd: NOW + DAY,
      grants: ['ai'],
    };
    expect(evaluateCapabilityAcross([aiOnly, paidLong], 'hosting', NOW)).toEqual({
      allowed: true,
    });
  });
});

describe('空与非法输入：fail-closed', () => {
  it('没有行 → NO_SUBSCRIPTION', () => {
    const decision = evaluateCapabilityAcross([], 'hosting', NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe('NO_SUBSCRIPTION');
  });

  it('null / undefined → NO_SUBSCRIPTION（不是崩溃）', () => {
    expect(evaluateCapabilityAcross(null, 'hosting', NOW).allowed).toBe(false);
    expect(evaluateCapabilityAcross(undefined, 'hosting', NOW).allowed).toBe(false);
  });

  it('🔴 非数组 → NO_SUBSCRIPTION，而不是把字符串当集合（fail-closed）', () => {
    expect(
      evaluateCapabilityAcross('hosting,ai' as never, 'hosting', NOW).allowed,
    ).toBe(false);
  });

  it('🔴 now 非法 → 每一行都拒绝，整体也拒绝', () => {
    const decision = evaluateCapabilityAcross([paidLong], 'hosting', Number.NaN);
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe('INVALID_NOW');
  });

  it('🔴 拒绝原因优先给有信息量的那条，而不是笼统的 NO_SUBSCRIPTION', () => {
    // 第一行 grants 缺失（MISSING_GRANTS，有用），第二行已过期（PERIOD_ENDED，有用）。
    // 如果实现直接返回第一行的结果也没问题 —— 但绝不能返回 NO_SUBSCRIPTION：
    // 那会让运维去找一条并不存在的缺失订阅。
    const missingGrants: EntitlementSubscription = {
      status: 'active',
      currentPeriodEnd: NOW + DAY,
      grants: null,
    };
    const decision = evaluateCapabilityAcross([missingGrants], 'hosting', NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe('MISSING_GRANTS');
  });

  it('状态不在白名单的行不会"挡住"另一条有效行', () => {
    const pastDue: EntitlementSubscription = {
      status: 'past_due',
      currentPeriodEnd: NOW + 30 * DAY,
      grants: ['hosting'],
    };
    expect(evaluateCapabilityAcross([pastDue, inviteShort], 'hosting', NOW)).toEqual({
      allowed: true,
    });
  });

  it('策略可注入：把 past_due 也算有效时，只有那一行也能放行', () => {
    const pastDue: EntitlementSubscription = {
      status: 'past_due',
      currentPeriodEnd: NOW + DAY,
      grants: ['hosting'],
    };
    expect(
      evaluateCapabilityAcross([pastDue], 'hosting', NOW, {
        entitledStatuses: ['active', 'past_due'],
      }).allowed,
    ).toBe(true);
    expect(
      evaluateCapabilityAcross([pastDue], 'hosting', NOW, DEFAULT_ENTITLEMENT_POLICY)
        .allowed,
    ).toBe(false);
  });
});
