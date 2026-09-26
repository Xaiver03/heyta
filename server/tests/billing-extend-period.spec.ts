import { describe, it, expect } from 'vitest';
import {
  SUBSCRIPTION_PERIOD_DAYS as SERVER_PERIOD_DAYS,
  extendSubscriptionPeriod as serverExtend,
} from '../src/billing/extend-period';
// 🔴 相对路径直接 import **domain 的源文件**（不是 dist，避免测到过期构建产物）。
// 测试文件不受 server/tsconfig.json 的 rootDir 约束，所以这条路是通的 ——
// 这正是"服务端代码没法复用、但测试能核对"的原因（见 extend-period.ts 的文件头）。
import {
  SUBSCRIPTION_PERIOD_DAYS as DOMAIN_PERIOD_DAYS,
  extendSubscriptionPeriod as domainExtend,
} from '../../packages/domain/src/subscription';

/**
 * 🔴 **漂移守卫**：`server/src/billing/extend-period.ts` 是
 * `packages/domain/src/subscription.ts` 的镜像（服务端无法跨包 import，
 * 原因见那份文件头）。这里把两份实现放在**同一张用例表**上比对，
 * 连"什么时候抛异常"都要一致。
 *
 * 这个测试的全部价值是：**下一次有人只改一边时，这里立刻红。**
 * 单调"两份实现看起来一样"的注释做不到这件事。
 */

interface Case {
  readonly name: string;
  readonly input: { now: number; currentPeriodEnd: number | null; days?: number };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

const cases: readonly Case[] = [
  {
    name: '首次购买：没有已付时长，从 now 起算',
    input: { now: NOW, currentPeriodEnd: null },
  },
  {
    name: '🔴 提前续费：已有到期日在未来 → 叠加而不是覆盖',
    input: { now: NOW, currentPeriodEnd: NOW + 90 * DAY },
  },
  {
    name: '已过期：到期日在过去 → 从 now 起算（不埋进过去）',
    input: { now: NOW, currentPeriodEnd: NOW - 30 * DAY },
  },
  {
    name: '边界：到期日正好等于 now → 从 now 起算',
    input: { now: NOW, currentPeriodEnd: NOW },
  },
  {
    name: '自定义时长',
    input: { now: NOW, currentPeriodEnd: NOW + DAY, days: 30 },
  },
  {
    name: '较长已付剩余（多年叠加）',
    input: { now: NOW, currentPeriodEnd: NOW + 10 * 365 * DAY },
  },
  {
    name: 'now = 0 且无历史',
    input: { now: 0, currentPeriodEnd: null },
  },
];

describe('extend-period 漂移守卫：server 镜像 vs packages/domain', () => {
  it('默认时长常量一致', () => {
    expect(SERVER_PERIOD_DAYS).toBe(DOMAIN_PERIOD_DAYS);
  });

  for (const testCase of cases) {
    it(`输出一致：${testCase.name}`, () => {
      const fromServer = serverExtend(testCase.input);
      const fromDomain = domainExtend(testCase.input);
      expect(fromServer).toBe(fromDomain);
      expect(Number.isFinite(fromServer)).toBe(true);
    });
  }

  const throwingCases: readonly {
    readonly name: string;
    readonly input: { now: number; currentPeriodEnd: number | null; days?: number };
  }[] = [
    { name: 'now 是 NaN', input: { now: Number.NaN, currentPeriodEnd: null } },
    { name: 'now 是 Infinity', input: { now: Number.POSITIVE_INFINITY, currentPeriodEnd: null } },
    { name: 'currentPeriodEnd 是 NaN', input: { now: NOW, currentPeriodEnd: Number.NaN } },
    {
      name: 'currentPeriodEnd 是 Infinity',
      input: { now: NOW, currentPeriodEnd: Number.POSITIVE_INFINITY },
    },
    { name: 'days = 0', input: { now: NOW, currentPeriodEnd: null, days: 0 } },
    { name: 'days 为负', input: { now: NOW, currentPeriodEnd: null, days: -1 } },
    { name: 'days 是 NaN', input: { now: NOW, currentPeriodEnd: null, days: Number.NaN } },
  ];

  for (const testCase of throwingCases) {
    it(`抛异常行为一致：${testCase.name}`, () => {
      expect(() => serverExtend(testCase.input)).toThrow();
      expect(() => domainExtend(testCase.input)).toThrow();
    });
  }

  it('spec 里的核心等式：max(now, 已有到期日) + 365 天', () => {
    const futureEnd = NOW + 90 * DAY;
    expect(serverExtend({ now: NOW, currentPeriodEnd: futureEnd })).toBe(
      futureEnd + 365 * DAY,
    );
    expect(serverExtend({ now: NOW, currentPeriodEnd: NOW - DAY })).toBe(
      NOW + 365 * DAY,
    );
  });
});