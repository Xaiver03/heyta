/**
 * 把归一化后的支付事件应用到 `Subscription` 行。
 *
 * 这是"权益授予"的唯一写入路径，它必须同时满足两条硬要求：
 *
 * 1. 🔴 **乱序安全** —— 投递不保证顺序（`subscription-provider-selection.md` §5）。
 *    "取消"事件完全可能**晚到**而**事件时间更早**，此时它绝不能把新状态覆盖回去。
 *    所以新旧判定只用 `event.occurredAt` 对比订阅行上的 `lastEventAt`，
 *    **不看到达顺序，也不用 `updatedAt`**。
 * 2. 🔴 **绝不删数据** —— `subscription-boundary.md` §2。到期 / 退款只改 `status`
 *    与 `currentPeriodEnd`，本文件里没有任何删除调用。服务端已有数据一个字不动。
 *
 * ⚠️ **抽象不掉的第二处**：`occurredAt` 来自各 provider 自己的 payload，
 * 有的明确要求按它排序（Paddle 的 `occurred_at`），有的要 adapter 自己找时间戳。
 * 所以它由 adapter 归一化后必填传进来。
 *
 * 本函数**不做验签、不做去重**：验签在 adapter 里，去重在 webhook 路由的
 * `(provider, providerEventId)` 唯一约束里。调用本函数时事件已经通过那两道闸。
 */
import type { NormalizedPaymentEvent, SubscriptionStatus } from './types';

/** 应用结果。审计日志按它区分"真改了"与"看过但没动"。 */
export type PaymentEventApplyOutcome =
  | { readonly status: 'applied'; readonly subscriptionId: number }
  | { readonly status: 'stale'; readonly subscriptionId: number }
  | { readonly status: 'ignored'; readonly reason: PaymentEventIgnoreReason };

export type PaymentEventIgnoreReason =
  | 'NO_SUBSCRIPTION_REFERENCE'
  | 'NO_SUBSCRIPTION_STATE'
  | 'NO_USER_REFERENCE'
  | 'INVALID_OCCURRED_AT';

/** 既有订阅行的最小形状（Prisma 行是它的超集）。 */
export interface ExistingSubscription {
  readonly id: number;
  readonly status?: string | null;
  readonly currentPeriodEnd?: number | bigint | null;
  /** 已应用事件中最大的 `occurredAt`；`null`/`undefined` = 没有基线。 */
  readonly lastEventAt?: number | bigint | null;
}

/** 写入用的字段（**没有任何删除字段**）。 */
export interface SubscriptionWrite {
  readonly provider: string;
  readonly externalSubscriptionId: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: number | null;
  readonly lastEventAt: number;
  readonly updatedAt: number;
}

/**
 * 可注入的存储端口。默认实现查 `prisma`（在 `webhook.routes.ts` 里接线），
 * 但纯逻辑在这里，因此乱序 / 边界能不碰数据库地测。
 */
export interface ApplyPaymentEventDeps {
  findSubscription(externalSubscriptionId: string): Promise<ExistingSubscription | null>;
  createSubscription(
    data: SubscriptionWrite & { userId: number; createdAt: number },
  ): Promise<{ id: number }>;
  updateSubscription(id: number, data: SubscriptionWrite): Promise<unknown>;
  /** 可注入时钟，仅用于 `updatedAt`，不参与新旧判定。 */
  now(): number;
}

/**
 * 时间戳归一化：接受 `number` / `bigint`，非法值返回 `undefined`（**不抛异常**）。
 * 与 `entitlement.ts` 的 `toEpochMillis` 同形（那里是纯判定，这里是写入侧）。
 */
const toEpochMillis = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return Number(value);
  }
  return undefined;
};

export const applyPaymentEvent = async (
  event: NormalizedPaymentEvent,
  deps: ApplyPaymentEventDeps,
): Promise<PaymentEventApplyOutcome> => {
  if (event.externalSubscriptionId === null) {
    // 支付宝 / 微信这类"没有订阅对象"的 provider 会走到这里：合法，不是错误。
    //
    // ⚠️ **已知缺口，选型定稿前必须解决**：阶段一（国内）的结论是
    // **一次性年付 + 到期提醒手动续费**（`subscription-provider-selection.md`
    // 「阶段一（国内）的唯一现实路径」），也就是**没有自动续费的 provider**。
    // 那种 provider 的 webhook 只有"一笔订单付成功了 + 这次买到哪一天"，
    // 没有订阅 id —— 按当前实现它会被记进 `payment_events` 审计，
    // 但**不会**创建 / 延长 `Subscription`。要接它，adapter 必须先决定
    // "一笔一次性支付如何映射成稳定的订阅行 + 如何叠加周期"，
    // 那是 provider 相关的语义（§4「抽象不掉的」），不能在这里猜。
    // 本轮不选型、不接 SDK，所以刻意保留这个 ignore 分支并把它写下来。
    return { status: 'ignored', reason: 'NO_SUBSCRIPTION_REFERENCE' };
  }
  if (event.status === null) {
    // 有订阅引用但没有可映射的状态：不动权益，交由对账（见 noop.adapter 的缺口注释）。
    return { status: 'ignored', reason: 'NO_SUBSCRIPTION_STATE' };
  }

  const occurredAt = toEpochMillis(event.occurredAt);
  if (occurredAt === undefined) {
    return { status: 'ignored', reason: 'INVALID_OCCURRED_AT' };
  }

  const existing = await deps.findSubscription(event.externalSubscriptionId);
  const now = deps.now();

  const write: SubscriptionWrite = {
    provider: event.provider,
    externalSubscriptionId: event.externalSubscriptionId,
    status: event.status,
    currentPeriodEnd: event.currentPeriodEnd,
    lastEventAt: occurredAt,
    updatedAt: now,
  };

  if (existing === null) {
    if (event.userId === null) {
      // 没有用户归属就没法建行；不猜、不按 email 模糊匹配。
      return { status: 'ignored', reason: 'NO_USER_REFERENCE' };
    }
    const created = await deps.createSubscription({
      ...write,
      userId: event.userId,
      createdAt: now,
    });
    return { status: 'applied', subscriptionId: created.id };
  }

  // 🔴 乱序闸门：只有**事件时间更早**才算过期。相等按"可应用"处理，
  // 因为精确重复已被 `(provider, providerEventId)` 唯一约束挡在前面。
  const baseline = toEpochMillis(existing.lastEventAt);
  if (baseline !== undefined && occurredAt < baseline) {
    return { status: 'stale', subscriptionId: existing.id };
  }

  await deps.updateSubscription(existing.id, write);
  return { status: 'applied', subscriptionId: existing.id };
};
