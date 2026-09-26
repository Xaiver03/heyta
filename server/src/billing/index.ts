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
} from './registry';
export type { BillingAdapterRegistry } from './registry';

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
