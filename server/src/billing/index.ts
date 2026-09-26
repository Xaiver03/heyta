/**
 * billing 模块出口。
 *
 * 🔴 零运行时依赖：本模块只定义支付商无关的接口形状 + 一个空实现，
 * **不接任何真实支付商 SDK**（选型待用户确认实体状况，
 * 见 `docs/plans/subscription-provider-selection.md` §8）。
 */
export {
  SUBSCRIPTION_STATUSES,
  isSubscriptionStatus,
} from './types';
export type {
  BillingAdapter,
  CheckoutResult,
  CreateCheckoutInput,
  NormalizedPaymentEvent,
  RevokeEntitlementInput,
  SubscriptionStatus,
  WebhookHeaders,
  WebhookVerification,
} from './types';

export {
  BillingProviderNotConfiguredError,
  NOOP_PROVIDER,
  createNoopBillingAdapter,
} from './noop.adapter';

export {
  DEFAULT_BILLING_ADAPTERS,
  createBillingAdapterRegistry,
  createBillingAdaptersFromConfig,
  isWechatBillingRegistered,
} from './registry';
export type { BillingAdapterRegistry } from './registry';

// 微信支付（Native 扫码）。🔴 零依赖：全部用 `node:crypto` 手写。
export {
  WECHAT_API_BASE_URL,
  WECHAT_DEFAULT_PRICES,
  WECHAT_NATIVE_PATH,
  WECHAT_NOTIFY_PATH,
  WECHAT_ONE_TIME_PERIOD_DAYS,
  WECHAT_PROVIDER,
  WECHAT_SIGNATURE_MAX_AGE_MS,
  WechatApiError,
  WechatUnknownPriceError,
  buildRequestSignatureMessage,
  buildWechatAuthorizationHeader,
  buildWechatOutTradeNo,
  buildWebhookSignatureMessage,
  createWechatBillingAdapter,
  decryptWechatResource,
  isWechatTimestampFresh,
  normalizePemKey,
  parseUserIdFromAttach,
  parseUserIdFromOutTradeNo,
  parseWechatTime,
  signWechatRequest,
  verifyWechatSignature,
} from './wechat.adapter';
export type {
  WechatPayAdapterOptions,
  WechatPrice,
  WechatRequestSignatureInput,
  WechatResourceCiphertext,
} from './wechat.adapter';

// 一次性支付的周期叠加（服务端侧镜像 + 漂移守卫，见对应文件头）。
export {
  SUBSCRIPTION_PERIOD_DAYS,
  extendSubscriptionPeriod,
} from './extend-period';
export type { ExtendSubscriptionPeriodInput } from './extend-period';

export { applyPaymentEvent } from './apply-event';
export type {
  ApplyPaymentEventDeps,
  ExistingSubscription,
  PaymentEventApplyOutcome,
  PaymentEventIgnoreReason,
  SubscriptionWrite,
} from './apply-event';

export {
  BILLING_AUDIT_EVENTS,
  isDuplicatePaymentEventError,
  webhookRoutes,
} from './webhook.routes';
export type { WebhookRoutesOptions } from './webhook.routes';
