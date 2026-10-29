import { useSyncExternalStore } from 'react';
import type { InboundAutomationRule } from '@heyta/app-host';

/**
 * 这台设备所在账号**有哪些自动收集规则**，供设置面只读展示。
 *
 * 🔴 为什么要有这一格：手机上此前能看见"这一趟做了什么"和"这台设备准备好了没有"，
 * 却看不见**规则本身** —— 用户说不出"我有几条规则、它们是谁在处理"，
 * 只能回到 web 才知道。工单 `inbound-automation-work-brief.md` §3 A9 第 4 项。
 *
 * 🔴 只存展示要用的四样，**不存凭据、不存收件密钥、不存事件 id**：
 * 这是设置面的第二份出口，带上什么都等于给用户内容另开一条路。
 * ⚠️ 拉取发生在 `lifecycle.ts`（前台那一趟）里，组件本身仍然不发请求 —— 与
 * `status.ts` 那两枚 store 同一条形状。
 */
export interface InboundRuleSnapshot {
  readonly id: string;
  readonly keyId: string;
  readonly enabled: boolean;
  readonly hostedExtraction: boolean;
}

let current: readonly InboundRuleSnapshot[] | undefined;
const listeners = new Set<() => void>();

export function publishInboundRules(rules: readonly InboundAutomationRule[]): void {
  const next = rules
    .filter((rule) => rule.deletedAt === null)
    .map((rule) => ({ id: rule.id, keyId: rule.keyId, enabled: rule.enabled, hostedExtraction: rule.hostedExtraction }));
  if (current !== undefined && current.length === next.length && current.every((item, index) => {
    const other = next[index]!;
    return item.id === other.id && item.keyId === other.keyId && item.enabled === other.enabled && item.hostedExtraction === other.hostedExtraction;
  })) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getInboundRules(): readonly InboundRuleSnapshot[] | undefined {
  return current;
}

export function subscribeInboundRules(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInboundRules(): readonly InboundRuleSnapshot[] | undefined {
  return useSyncExternalStore(subscribeInboundRules, getInboundRules);
}
