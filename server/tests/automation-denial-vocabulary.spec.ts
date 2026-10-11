import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 服务端那两张拒绝原因词表的**分离**判据。
 *
 * 为什么要有这一份（而不是只靠 `packages/domain/tests/subscription.spec.ts` 那条）：
 * 那条守卫比对的是「订阅读取那张表 ↔ 客户端认识的词表」，它红了只说明两张表不一致，
 * 不说明**是哪一侧多出来的**。本线在 2026-10-11 就是把 8 枚自动收集的理由并进了
 * 订阅那张表（`e8b3e982` / `4b84584d`），于是那条守卫红了整整一天，
 * 而红的时候没有任何一层能指出"自动收集的理由不该在那张表里"。
 * 这一份钉的是服务端自己的形状：两张表**各自成员封闭**且**互不相交**。
 *
 * 读的是源文件文本而不是 import 类型 —— 类型在运行时不存在，
 * 而这张表真正会漂移的地方就是那段声明本身（同一个手法 `packages/domain` 那条守卫也在用）。
 */
const SOURCE = readFileSync(new URL('../src/entitlement.ts', import.meta.url), 'utf8');

const unionMembers = (typeName: string): string[] => {
  const match = new RegExp(`export type ${typeName} =([\\s\\S]*?);`).exec(SOURCE);
  if (match === null) throw new Error(`词表 ${typeName} 不在 server/src/entitlement.ts 里了`);
  return [...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
};

/** 订阅读取那一路：客户端对每一枚都有一句"没有订阅／到期了"式文案。 */
const SUBSCRIPTION = [
  'GRANT_NOT_INCLUDED',
  'INVALID_NOW',
  'INVALID_PERIOD_END',
  'MISSING_GRANTS',
  'MISSING_PERIOD_END',
  'NO_SUBSCRIPTION',
  'PERIOD_ENDED',
  'STATUS_NOT_ENTITLED',
];

/** 自动收集那一路：界面走 `waiting-entitlement`／停止重试，不是"请订阅"。 */
const AUTOMATION = [
  'BINDING_EXPIRED',
  'DEPLOYMENT_MISMATCH',
  'ENTITLEMENT_MODE_UNCONFIGURED',
  'ENTITLEMENT_TICKET_REJECTED',
  'ENTITLEMENT_TICKET_REQUIRED',
  'ISSUER_NOT_CONFIGURED',
  'NO_BINDING',
  'REVOKED_VERSION',
];

describe('server/src/entitlement.ts 的两张拒绝原因词表', () => {
  it('订阅读取那张表成员逐字锁定（多一枚少一枚都要在这里重新判断）', () => {
    expect(unionMembers('EntitlementDenialReason').sort()).toEqual(SUBSCRIPTION);
  });

  it('自动收集那张表成员逐字锁定', () => {
    expect(unionMembers('AutomationEntitlementDenialReason').sort()).toEqual(AUTOMATION);
  });

  it('🔴 两张表互不相交 —— 自动收集的理由不许并进订阅读取那一张', () => {
    const shared = unionMembers('EntitlementDenialReason').filter((r) =>
      unionMembers('AutomationEntitlementDenialReason').includes(r),
    );
    expect(shared, `这两枚同时出现在两张表里：${shared.join(', ')}`).toEqual([]);
  });

  it('托管额度的 `QUOTA_EXCEEDED` 不在任何一张里（它是计数器裁决，不是订阅裁决）', () => {
    const all = [...unionMembers('EntitlementDenialReason'), ...unionMembers('AutomationEntitlementDenialReason')];
    expect(all).not.toContain('QUOTA_EXCEEDED');
  });

  it('判定结果那两型都还在，且自动收集那一路能容纳两张表的成员（official 模式会委托给订阅裁决）', () => {
    expect(SOURCE).toContain('export type EntitlementDecision =');
    expect(SOURCE).toContain('export type AutomationEntitlementDecision =');
    expect(unionMembers('AnyEntitlementDenialReason')).toEqual([]);
    expect(SOURCE).toMatch(
      /export type AnyEntitlementDenialReason =\s*EntitlementDenialReason \| AutomationEntitlementDenialReason;/,
    );
  });
});
