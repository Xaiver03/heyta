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
import { createWechatBillingAdapter, WECHAT_PROVIDER } from './wechat.adapter';
import {
  createPaycenterBillingAdapter,
  PAYCENTER_PROVIDER,
} from './paycenter.adapter';
import type { ServerConfig } from '../config';

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

/**
 * 按**运营者配置**构造 adapter 列表。这是生产路径唯一该用的构造函数。
 *
 * - 空 provider **永远在**：它证明接口可被实现，也是"没有配支付商"时的落点；
 * - 微信**仅当 `config.wechatPay` 存在时**注册（即 `WECHAT_PAY_ENABLED=true`
 *   且六个凭证齐全，见 `config.ts`）。少一个变量是启动期硬错误，
 *   不会走到这里 —— 所以"注册得上但用不了"这种中间态不存在；
 * - 没配置时**只有 noop**：自托管 `POST /api/billing/webhooks/wechat` 回 404
 *   （fail-closed），自托管行为与加这个功能之前逐字相同。
 */
export const createBillingAdaptersFromConfig = (
  config: ServerConfig,
): readonly BillingAdapter[] => {
  const adapters: BillingAdapter[] = [createNoopBillingAdapter()];
  if (config.wechatPay !== undefined) {
    adapters.push(
      createWechatBillingAdapter({
        appId: config.wechatPay.appId,
        mchId: config.wechatPay.mchId,
        serialNo: config.wechatPay.serialNo,
        apiV3Key: config.wechatPay.apiV3Key,
        privateKey: config.wechatPay.privateKey,
        publicKey: config.wechatPay.publicKey,
        notifyUrl: config.wechatPay.notifyUrl,
      }),
    );
  }
  // 中心**仅当 `config.paycenter` 存在时**注册（即 PAYCENTER_ENABLED=true
  // 且三项凭证齐全，见 config.ts）—— 少一个变量是启动期硬错误，走不到这里，
  // 所以"注册得上但用不了"这种中间态不存在。
  //
  // ⚠️ 中心与微信**同时注册是允许的**：收银台按 `supportedCurrencies` 选通道，
  // 而两者都只收 CNY。顺序上中心在后、微信在前（保持既有行为不变），
  // 谁被选中由收银台的既有逻辑决定 —— 这正是 §1.4 的口径：汇付为主、直连兜底。
  if (config.paycenter !== undefined) {
    adapters.push(
      createPaycenterBillingAdapter({
        baseUrl: config.paycenter.baseUrl,
        clientId: config.paycenter.clientId,
        clientSecret: config.paycenter.clientSecret,
        webhookPath: config.paycenter.webhookPath,
        ...(config.paycenter.timeoutMs !== undefined ? { timeoutMs: config.paycenter.timeoutMs } : {}),
        ...(config.paycenter.paymentType !== undefined ? { paymentType: config.paycenter.paymentType } : {}),
      }),
    );
  }

  return adapters;
};

/** 已注册的 provider 名里有没有中心。给日志 / 自检用，判据与注册表一致。 */
export const isPaycenterBillingRegistered = (config: ServerConfig): boolean =>
  config.paycenter !== undefined &&
  createBillingAdaptersFromConfig(config).some(
    (adapter) => adapter.provider === PAYCENTER_PROVIDER,
  );

/** 已注册的 provider 名里有没有微信。给日志 / 自检用，判据与注册表一致。 */
export const isWechatBillingRegistered = (config: ServerConfig): boolean =>
  config.wechatPay !== undefined &&
  createBillingAdaptersFromConfig(config).some(
    (adapter) => adapter.provider === WECHAT_PROVIDER,
  );
