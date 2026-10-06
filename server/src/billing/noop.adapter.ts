/**
 * 「空 provider」（no-op）adapter。
 *
 * 两个用途，缺一不可：
 *
 * 1. **证明接口可被实现** —— 一个不依赖任何 SDK、不碰任何网络的最小实现，
 *    如果连它都满足不了 `BillingAdapter`，说明接口形状本身有问题。
 * 2. **自托管场景下的默认实现** —— 自托管实例不接任何支付商。这时
 *    `revokeEntitlement` / 映射都必须是**无副作用**的，`verifyWebhook` 必须
 *    **fail-closed 地拒绝**（没有 secret 就无法验签，放行等于伪造）。
 *
 * 🔴 它**不引入任何依赖、不发任何出站请求**。
 *
 * ⚠️ **已知缺口（有意留在这里，不要假装不存在）**：拒付不一定有 webhook 事件
 * （Lemon Squeezy 作为 MoR 自己吃掉拒付），所以真实的权益回收还需要一个
 * **定期对账**兜底 —— 本轮没有实现它，因为选型尚未定稿。
 */
import type {
  BillingAdapter,
  CheckoutResult,
  CreateRefundInput,
  CreateCheckoutInput,
  RefundResult,
  RevokeEntitlementInput,
  SubscriptionStatus,
  WebhookHeaders,
  WebhookVerification,
} from './types';

/** 没有配置任何真实支付商时，尝试发起结账会得到的错误。 */
export class BillingProviderNotConfiguredError extends Error {
  readonly code = 'BILLING_PROVIDER_NOT_CONFIGURED';

  constructor(provider: string) {
    super(
      `Billing provider "${provider}" is not configured. ` +
        `This instance has no payment provider; configure one before creating checkouts.`,
    );
    this.name = 'BillingProviderNotConfiguredError';
  }
}

/** no-op adapter 的固定 provider 名。 */
export const NOOP_PROVIDER = 'noop';

/**
 * 构造空 provider。
 *
 * 行为逐条：
 * - `createCheckout` → **抛** `BillingProviderNotConfiguredError`。
 *   刻意不做成"返回一个假 URL"：静默的假成功会把用户引到一个不存在的收银台，
 *   而那正是最晚才会被发现的失败。
 * - `verifyWebhook` → **永远拒绝**（fail-closed）。没有配置 secret 就没有"验签通过"
 *   这回事；放行等于任何人都能伪造订阅状态。
 * - `mapSubscriptionState` → 恒 `null`（没有状态机）。
 * - `revokeEntitlement` → **什么都不做**。它是"自托管默认什么都不做"的落点，
 *   也是"绝不删数据"的机械保证：这里没有任何 `prisma.delete*` 调用。
 *
 * 🔴 `supportedCurrencies: []` 是**空的、也是诚实的**：它不是"一个收不了钱的通道"
 * 的近似，它就是"这里没有通道"。任何一个币种都不在它的能力里 —— 收银台本来也
 * 会把 noop 过滤掉（见 `checkout.routes.ts` 的 ④），这个空数组是那条过滤的
 * 类型层面回声，不是重复判据。
 */
export const createNoopBillingAdapter = (): BillingAdapter => ({
  provider: NOOP_PROVIDER,
  supportedCurrencies: [],

  async createCheckout(_input: CreateCheckoutInput): Promise<CheckoutResult> {
    throw new BillingProviderNotConfiguredError(NOOP_PROVIDER);
  },

  async verifyWebhook(
    _rawBody: Buffer,
    _headers: WebhookHeaders,
  ): Promise<WebhookVerification> {
    return { ok: false, reason: 'no-billing-provider-configured' };
  },

  mapSubscriptionState(_providerState: unknown): SubscriptionStatus | null {
    return null;
  },

  async revokeEntitlement(_input: RevokeEntitlementInput): Promise<void> {
    // 有意为空：自托管默认什么都不做，且**绝不删除任何服务端数据**。
    // 到期 / 退款只影响"能不能新增设备接入"（entitlement 守卫），不影响已有数据。
  },

  /**
   * 🔴 与 `createCheckout` 同一个形状：**抛**，不是"返回一个成功的假象"。
   *
   * 为什么这里绝不能返回 `{ status: 'success' }`：退款流程只在通道确认 `success`
   * 之后回收权益（`refund-store.ts`）。一个假的 success 会让自托管实例
   * **在一分钱都没退出去的情况下把用户的托管同步砍掉 30 天** ——
   * 那是 ADR-0026 禁止的半真状态里最坏的那个方向（用户既没拿到钱、又丢了权益）。
   *
   * 这个方法**存在**且**必填**（而不是 `refund?()`）正是为了这一点：
   * "没有通道"是一个要被如实上报的事实，不是一个可以让调用方忘了处理的缺省。
   */
  async refund(_input: CreateRefundInput): Promise<RefundResult> {
    throw new BillingProviderNotConfiguredError(NOOP_PROVIDER);
  },
});
