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
  WECHAT_OUT_TRADE_NO_MAX_LENGTH,
  WECHAT_PROVIDER,
  WECHAT_SIGNATURE_MAX_AGE_MS,
  WechatApiError,
  WechatInvalidAmountError,
  WechatInvalidDescriptionError,
  WechatInvalidOutTradeNoError,
  WechatUnknownPriceError,
  assertUsableOutTradeNo,
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
} from '@heyta/domain';
export type { ExtendSubscriptionPeriodInput } from '@heyta/domain';

// 可调价 + 优惠券（见 docs/adr/0018-adjustable-pricing-and-coupons.md）。
// 纯函数层：金额算术 / 版本化价目表 / 券判定 / 计价。
export {
  CURRENCIES,
  MIN_CHARGEABLE_AMOUNT_MINOR,
  MINOR_UNITS_PER_MAJOR,
  PERCENT_OFF_BP_MAX,
  PERCENT_SCALE,
  breakdownAmount,
  clampDiscountMinor,
  computeDiscountMinor,
  formatMinor,
  isCurrency,
  isMinorAmount,
  isPercentOffBp,
} from './money';
export type { AmountBreakdown, Currency, DiscountBenefit } from './money';

export {
  DEFAULT_PRICE_BOOK,
  InvalidPriceBookError,
  PriceBookOverlapError,
  PriceNotEffectiveError,
  UnknownPriceError,
  assertValidPriceBook,
  isEntryEffectiveAt,
  projectPrices,
  resolveEffectivePrice,
  resolvePriceEntry,
  validatePriceBook,
} from './price-book';
export type { PriceBookEntry } from './price-book';

export {
  COUPON_REJECTION_EXPLANATION,
  COUPON_REJECTION_REASONS,
  EMPTY_COUPON_USAGE,
  InvalidCouponDefinitionError,
  REGIONS,
  evaluateCoupon,
  isRegion,
  normalizeCouponCode,
  validateCouponDefinition,
} from './coupon';
export type {
  CouponAccepted,
  CouponBenefit,
  CouponContext,
  CouponDefinition,
  CouponEvaluateRejection,
  CouponEvaluation,
  CouponRejected,
  CouponRejectionReason,
  CouponUsage,
  Region,
} from './coupon';

export {
  DEFAULT_PAYMENT_WINDOW_MS,
  MAX_COUPONS_PER_ORDER,
  QuotePricingError,
  isSellableCurrency,
  quoteOrder,
} from './quote';
export type { OrderQuote, QuoteRequest, RejectedCoupon } from './quote';

// 持久化层：SQL 走 `SqlExecutor` 端口，于是同一份 SQL 能在 PGlite（真的 PostgreSQL）
// 上被跑一遍。见 docs/reference/pricing-and-coupons.md §7。
export {
  AUDIT_ACTIONS,
  COUNTED_REDEMPTION_STATES,
  CouponDefinitionRejectedError,
  CouponQuotaExceededError,
  ORDER_STATUSES,
  PriceVersionConflictError,
  REDEMPTION_STATES,
  appendAudit,
  createOrderWithReservation,
  createPrismaSqlExecutor,
  expireStaleOrders,
  failOrder,
  loadCouponUsage,
  loadCoupons,
  loadPriceOverrides,
  loadPricingAudit,
  publishPriceVersion,
  reverseOrderOnRefund,
  serializeRejections,
  settleOrderPaid,
  toCouponDefinition,
  toMillis,
  upsertCoupon,
} from './pricing-store';
export type {
  AuditAction,
  CouponWrite,
  CreateOrderInput,
  InvalidCouponRow,
  OrderStatus,
  PrismaLikeClient,
  PrismaTransactionClient,
  PricingAuditEntry,
  PublishPriceInput,
  RedemptionState,
  SettleOrderOutcome,
  SettleOrderPaidInput,
  SqlExecutor,
  SqlRunner,
} from './pricing-store';

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
