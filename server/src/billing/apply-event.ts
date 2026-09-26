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
import type { ExtendSubscriptionPeriodInput } from '@heyta/domain';

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
  /**
   * 外部订阅 id。**可为 `null`**：一次性支付的 provider（支付宝 / 微信）
   * 没有订阅对象，`(userId, provider)` 那一行的这个字段长期是 `null`
   * （PostgreSQL 的 `UNIQUE` 允许多个 `NULL`，所以不会互相冲突）。
   */
  readonly externalSubscriptionId: string | null;
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
  /**
   * 按 `(userId, provider)` 找那**一行长期复用**的订阅。
   *
   * 🔴 一次性支付的 provider 没有 `externalSubscriptionId` 可查，
   * 唯一稳定的定位方式就是"这个用户的这个 provider 那一行"
   * （`subscription-boundary.md` §6.2「一行一用户」）。**不要每笔支付插一行。**
   */
  findSubscriptionByUser(
    userId: number,
    provider: string,
  ): Promise<ExistingSubscription | null>;
  createSubscription(
    data: SubscriptionWrite & { userId: number; createdAt: number },
  ): Promise<{ id: number }>;
  updateSubscription(id: number, data: SubscriptionWrite): Promise<unknown>;
  /**
   * 周期叠加纯函数，**以端口注入**。
   *
   * 为什么注入而不是 import：`server` 包没有 `@heyta/domain` 依赖，
   * 而硬约束不许改 `server/package.json` / lockfile。把算法做成端口，
   * 至少保证**本文件里没有第二份公式** —— 见 `@heyta/domain` 的 `extendSubscriptionPeriod`。
   */
  extendPeriod(input: ExtendSubscriptionPeriodInput): number;
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

/**
 * 🔴 一次性支付的授予路径（阶段一的**主路径**，不是边界情况）。
 *
 * `subscription-boundary.md` §6.2 的规则，逐条落在这里：
 *
 * - **一行一用户**：`(userId, provider)` 复用一行，`externalSubscriptionId = null`；
 * - **一次支付 = +365 天**：`max(now, 已有的 currentPeriodEnd ?? now) + 365天`
 *   （算术在注入的 `extendPeriod` 里，本文件不含公式）；
 * - **绝不删除**：只写 `status` / `currentPeriodEnd`，这里没有任何删除调用；
 * - **永不 `now + 365天`**：那会让提前续费的用户丢掉已付过钱的剩余时间。
 *
 * 幂等**不在这里**：同一 `out_trade_no` 的重复回调在路由层被
 * `(provider, providerEventId)` 唯一约束挡住（`webhook.routes.ts`）。本函数
 * 只按 `lastEventAt` 做乱序防护，与订阅路径同一套语义。
 */
const applyOneTimeGrant = async (
  event: NormalizedPaymentEvent,
  deps: ApplyPaymentEventDeps,
  periodDays: number,
): Promise<PaymentEventApplyOutcome> => {
  const occurredAt = toEpochMillis(event.occurredAt);
  if (occurredAt === undefined) {
    return { status: 'ignored', reason: 'INVALID_OCCURRED_AT' };
  }
  if (event.userId === null) {
    // 没有用户归属就没法建行 / 找不到行；不猜、不按 email 模糊匹配。
    return { status: 'ignored', reason: 'NO_USER_REFERENCE' };
  }

  const existing = await deps.findSubscriptionByUser(event.userId, event.provider);
  const now = deps.now();

  // 🔴 乱序闸门，与订阅路径逐字同形：只有**事件时间更早**才算过期。
  // 相等按"可应用"处理 —— 精确重复已被唯一约束挡在前面。
  const baseline = existing === null ? undefined : toEpochMillis(existing.lastEventAt);
  if (existing !== null && baseline !== undefined && occurredAt < baseline) {
    return { status: 'stale', subscriptionId: existing.id };
  }

  // 已有的到期日：非法值按"没有已付时长"处理（`extendPeriod` 会从 now 起算），
  // 而不是把一个垃圾值喂进收钱路径让它抛。
  const currentPeriodEnd =
    existing === null ? null : (toEpochMillis(existing.currentPeriodEnd) ?? null);

  const nextPeriodEnd = deps.extendPeriod({ now, currentPeriodEnd, days: periodDays });

  const write: SubscriptionWrite = {
    provider: event.provider,
    // 🔴 微信没有订阅对象，这一列长期是 null（一行一用户，不是一笔支付一行）。
    externalSubscriptionId: null,
    status: 'active',
    currentPeriodEnd: nextPeriodEnd,
    lastEventAt: occurredAt,
    updatedAt: now,
  };

  if (existing === null) {
    const created = await deps.createSubscription({
      ...write,
      userId: event.userId,
      createdAt: now,
    });
    return { status: 'applied', subscriptionId: created.id };
  }

  await deps.updateSubscription(existing.id, write);
  return { status: 'applied', subscriptionId: existing.id };
};

export const applyPaymentEvent = async (
  event: NormalizedPaymentEvent,
  deps: ApplyPaymentEventDeps,
): Promise<PaymentEventApplyOutcome> => {
  if (event.externalSubscriptionId === null) {
    // 支付宝 / 微信这类"没有订阅对象"的 provider 会走到这里。
    //
    // 🔴 授予必须是**事件上的显式声明**（`event.oneTimeGrant`），不能从
    // "没有订阅引用"推断：退款 / 对账通知同样没有订阅引用，而它们**不该发权益**。
    // 把推断写进通用层等于让任何这类事件都变成"发一年"。
    if (event.oneTimeGrant != null) {
      return applyOneTimeGrant(event, deps, event.oneTimeGrant.periodDays);
    }
    // 没有声明授予语义的事件：记进 `payment_events` 审计，但不动权益。
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
