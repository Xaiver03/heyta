/**
 * provider 名 → `BillingAdapter` 的注册表。
 *
 * 🔴 **fail-closed**：没有注册的 provider 一律解析不到 adapter，路由回 404，
 * 不落任何 `PaymentEvent`。自托管默认只注册空 provider（见 `noop.adapter.ts`）。
 *
 * 这里刻意不做任何"自动探测当前用哪家"的逻辑 ——
 * `subscription-integration.md` §5 已经钉死：代码里**没有** `SELF_HOSTED` /
 * `IS_OFFICIAL` 之类程序化标志，付费闸门只能由运营者显式开启，
 * 而支付商只能由运营者显式注册。
 */
import { createNoopBillingAdapter } from './noop.adapter';
import type { BillingAdapter } from './types';

export interface BillingAdapterRegistry {
  /** 找不到时返回 `undefined`（调用方 fail-closed）。 */
  get(provider: string): BillingAdapter | undefined;
  /** 已注册的 provider 名，按注册顺序。 */
  providers(): readonly string[];
}

export const createBillingAdapterRegistry = (
  adapters: readonly BillingAdapter[],
): BillingAdapterRegistry => {
  const byProvider = new Map<string, BillingAdapter>();
  for (const adapter of adapters) {
    // 重复注册是配置错误，直接抛而不是静默覆盖 —— 否则"注册了哪家"取决于顺序。
    if (byProvider.has(adapter.provider)) {
      throw new Error(`Duplicate billing adapter for provider "${adapter.provider}"`);
    }
    byProvider.set(adapter.provider, adapter);
  }

  return {
    get: (provider) => byProvider.get(provider),
    providers: () => [...byProvider.keys()],
  };
};

/**
 * 默认注册表：只有空 provider。
 *
 * 真实支付商（Paddle / Creem / 支付宝…）的 adapter 要等选型与实体状况确认后再加，
 * **本轮不接任何 SDK**（`subscription-provider-selection.md` §8）。
 */
export const DEFAULT_BILLING_ADAPTERS: readonly BillingAdapter[] = [
  createNoopBillingAdapter(),
];
