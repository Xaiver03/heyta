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
import type { NormalizedPaymentEvent, OneTimeGrant, SubscriptionStatus } from './types';
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
  | 'INVALID_OCCURRED_AT'
  /**
   * 🔴 **观察到了一笔真钱，但推不出它买的是哪一档**（用券打折后的实付金额
   * 落不到任何档位原价上）。不授予是刻意的（fail-closed），但它**不是
   * "无事发生"**：需要拿订单上冻结的 SKU 与实付去做权威结算
   * （`settleOrderPaid`）。见 `docs/reference/pricing-and-coupons.md` §7 第 9 条。
   */
  | 'REQUIRES_ORDER_SETTLEMENT';

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
  /**
   * 🔴 买的是哪一档（SKU id）。一次性支付路径会写它；订阅式 provider 目前
   * 拿不到档位，写 `null`（"未知"）。判定**不看**这一列，它只用于追溯与运营。
   */
  readonly priceId: string | null;
  /**
   * 🔴 这一行实际授予的能力（`hosting` / `ai`）。**权益判定唯一看的就是它。**
   *
   * 语义是**替换**而不是并集：一次支付把这一行的能力集合设成**这次买的那一档**
   * 的能力。降级（先买 ¥12、后买 ¥5）会立即生效 —— 因为"一行订阅只有一个到期日"，
   * 拆不出两个并行的档位。并集是**更坏**的那个选择：它会让"降级"永远不生效，
   * 于是用户付 ¥5 却一直用着 ¥12 的能力。
   *
   * 类型是可变数组（不是 `readonly`），因为它会被原样交给 Prisma 的
   * `String[]` 列 —— 只读数组在那里过不了类型。
   */
  readonly grants: string[];
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
 * - **一次支付 = +30 天**：`max(now, 已有的 currentPeriodEnd ?? now) + 30天`
 *   （算术在注入的 `extendPeriod` 里，本文件不含公式）；
 * - **绝不删除**：只写 `status` / `currentPeriodEnd`，这里没有任何删除调用；
 * - **永不 `now + 30天`**：那会让提前续费的用户丢掉已付过钱的剩余时间。
 *
 * 幂等**不在这里**：同一 `out_trade_no` 的重复回调在路由层被
 * `(provider, providerEventId)` 唯一约束挡住（`webhook.routes.ts`）。本函数
 * 只按 `lastEventAt` 做乱序防护，与订阅路径同一套语义。
 */
const applyOneTimeGrant = async (
  event: NormalizedPaymentEvent,
  deps: ApplyPaymentEventDeps,
  grant: OneTimeGrant,
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

  const nextPeriodEnd = deps.extendPeriod({ now, currentPeriodEnd, days: grant.periodDays });

  const write: SubscriptionWrite = {
    provider: event.provider,
    // 🔴 微信没有订阅对象，这一列长期是 null（一行一用户，不是一笔支付一行）。
    externalSubscriptionId: null,
    status: 'active',
    currentPeriodEnd: nextPeriodEnd,
    // 🔴 档位与能力**必须一起写**。只写到期日的话，¥5 与 ¥12 会落成完全一样的行 ——
    // 用户付 ¥12 拿到的东西和 ¥5 一模一样，而没有任何代码能发现。
    // 未知档位如实写 `null`（不是编一个），能力则如实写 adapter 投影出来的那一组。
    priceId: grant.priceId,
    // 复制一份可变数组：`OneTimeGrant.grants` 是只读的（它来自价目表的常量），
    // 而 Prisma 的 `String[]` 列收的是可变数组。
    grants: [...grant.grants],
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
      return applyOneTimeGrant(event, deps, event.oneTimeGrant);
    }
    // 🔴 "有一笔真钱，但推不出它买的是哪一档" —— 与下面那条**必须分开**。
    // 典型来源：用券打折后的实付金额落不到任何档位原价上。
    // 归成 `NO_SUBSCRIPTION_REFERENCE` 对一笔真实到账的支付是**假话**，
    // 而且它与退款 / 对账通知无法区分，运维在日志里看不到"有一笔钱没交付权益"。
    // 这里仍然**不授予**（fail-closed，金额推不出档位），但原因如实、可查。
    // 权威判定属于 `settleOrderPaid`（比订单冻结的 SKU 与实付）。
    if (event.requiresOrderSettlement === true) {
      return { status: 'ignored', reason: 'REQUIRES_ORDER_SETTLEMENT' };
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
    // 🔴 订阅式 provider 的档位**目前拿不到**：归一化事件里没有 SKU
    // （`NormalizedPaymentEvent` 只带订阅状态与周期），而 provider 选型本身
    // 还是未决的（`docs/plans/subscription-provider-selection.md`）。
    //
    // ⚠️ 所以这里如实写"未知档位 + 不授予任何能力"，而**不是**猜一个
    // `['hosting']`。后果是 fail-closed：这条路径上的用户会拿到
    // `GRANT_NOT_INCLUDED`。这在本仓库里**今天是不可达的** ——
    // 唯一实现的 provider（微信）的 `mapSubscriptionState` 明确返回 `null`，
    // 事件永远带不上 `status`，因此在上面就返回了 `NO_SUBSCRIPTION_STATE`。
    //
    // 🔴 谁实现第一个订阅式 provider，谁就必须把 grants 接进来
    // （给 `NormalizedPaymentEvent` 加一个与 `oneTimeGrant` 并列的授予声明），
    // 否则每一个订阅用户都会被闸门拒绝，而拒绝原因看起来像"没买这一档"。
    priceId: null,
    grants: [],
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
