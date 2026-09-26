/**
 * 会员权益（entitlement）：判定 + preHandler 守卫 + 运营者开关。
 *
 * 产品边界见 `docs/plans/subscription-boundary.md`，接入点见
 * `docs/plans/subscription-integration.md`。这里只做三件事：
 *
 *   1. 一个**纯判定函数** `evaluateEntitlement` —— 无副作用、不碰数据库、可单测。
 *   2. 一个 preHandler 守卫 `createEntitlementGuard` —— 形状照 `middleware.ts` 的
 *      `authenticate`：失败时 `reply` 错误 + 复用 `Logger.audit`。
 *   3. 🔴 **运营者开关，默认关**。关着的时候守卫直接放行，**一次数据库都不查**。
 *      自托管默认全放行是 heyta 的立身之本（见 `config.ts` 的 `entitlements`）。
 *
 * 🔴 订阅关系是**服务端表，不是 op**，所以这里不产生、也不消费任何 op-log 记录
 * （`AGENTS.md §3.4`）。
 */
import { FastifyReply, FastifyRequest } from 'fastify';
import { loadConfigFromEnv } from './config';
import { prisma } from './db';
import { getAuthUser } from './middleware';
import { Logger } from './logger';

/** 审计事件名。复用既有 `Logger.audit`，不新造一套日志。 */
export const ENTITLEMENT_AUDIT_EVENTS = {
  /** 权益被拒。 */
  DENIED: 'ENTITLEMENT_DENIED',
  /** 订阅变更。由后续的 billing webhook 发出，本轮没有写入路径。 */
  CHANGED: 'SUBSCRIPTION_CHANGED',
} as const;

/**
 * 权益被拒时对外的错误码。与 `SYNC_ERROR_CODES` 并列但独立 —— 它是服务端计费闸门，
 * 不是同步协议错误，塞进线协议错误码会让客户端误以为是 op 被拒。
 */
export const ENTITLEMENT_ERROR_CODE = 'SUBSCRIPTION_REQUIRED';

const ENTITLEMENT_ERROR_MESSAGE =
  'A paid subscription is required to use this hosted service.';

/**
 * 判定策略。默认只有 `active` 算有效；`past_due` / `canceled` / `expired`
 * 以及任何未知状态一律视为无权益。
 *
 * 做成参数而不是写死，是因为"宽限期要不要放行 past_due"是产品决定，
 * 而判定函数必须能单独测出每种策略的行为，不依赖改动全局常量。
 */
export interface EntitlementPolicy {
  /** 哪些订阅状态算"有效"。 */
  readonly entitledStatuses: readonly string[];
}

export const DEFAULT_ENTITLEMENT_POLICY: EntitlementPolicy = {
  entitledStatuses: ['active'],
};

/** 判定所依据的订阅最小形状（Prisma 行是它的超集）。 */
export interface EntitlementSubscription {
  status?: string | null;
  /** epoch 毫秒；Prisma 的 `BigInt?` 列到这里就是 `bigint | null`。 */
  currentPeriodEnd?: number | bigint | null;
}

/** 拒绝原因。对外可区分，写进审计与响应体。 */
export type EntitlementDenialReason =
  | 'NO_SUBSCRIPTION'
  | 'STATUS_NOT_ENTITLED'
  | 'MISSING_PERIOD_END'
  | 'INVALID_PERIOD_END'
  | 'PERIOD_ENDED'
  | 'INVALID_NOW';

export type EntitlementDecision =
  | { allowed: true }
  | { allowed: false; reason: EntitlementDenialReason };

/**
 * 把订阅里的时间戳归一成 epoch 毫秒，非法值返回 `undefined`（**不抛异常**）。
 *
 * 接受 `number` 与 `bigint`，因为 Prisma 的 `BigInt` 列在运行时是 `bigint`。
 * 负数、`NaN`、`Infinity`、字符串、对象一律算"无法确定时间"。
 * 超出 `Number.MAX_SAFE_INTEGER` 的 `bigint` 也返回 `undefined` —— 转成 `number`
 * 会静默丢精度，那比拒绝更坏。
 */
const toEpochMillis = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined;
    }
    return Number(value);
  }
  return undefined;
};

/**
 * 🔴 纯判定：订阅状态 + 当前时间 + 策略 → 允许 / 拒绝 + 原因。
 *
 * 语义（每一条都有对应测试）：
 * - `null` / `undefined` 订阅 → 拒绝 `NO_SUBSCRIPTION`。
 * - 状态不在策略白名单（含 `null`）→ 拒绝 `STATUS_NOT_ENTITLED`。
 * - `currentPeriodEnd` 缺失 → 拒绝 `MISSING_PERIOD_END`。
 * - `currentPeriodEnd` 非法（负数 / NaN / Infinity / 超大 bigint / 非数字）→
 *   拒绝 `INVALID_PERIOD_END`。
 * - **边界是半开区间 `[start, currentPeriodEnd)`**：`now === currentPeriodEnd`
 *   的那一刻已经**过期**（拒绝 `PERIOD_ENDED`），`now` 小于它才放行。
 *   选半开区间是为了让"到期时刻"只有一个确定答案，而不是两处各判一次。
 * - `now` 本身非法（NaN / Infinity）→ 拒绝 `INVALID_NOW`：拿不到当前时间时，
 *   "放行"是静默的，拒绝才是响的。
 * - `currentPeriodEnd` 在未来是**正常情况**（未到期），照常放行。
 *
 * 不抛任何未捕获异常。
 */
export const evaluateEntitlement = (
  subscription: EntitlementSubscription | null | undefined,
  now: number,
  policy: EntitlementPolicy = DEFAULT_ENTITLEMENT_POLICY,
): EntitlementDecision => {
  if (subscription === null || subscription === undefined) {
    return { allowed: false, reason: 'NO_SUBSCRIPTION' };
  }

  const status = typeof subscription.status === 'string' ? subscription.status : null;
  if (status === null || !policy.entitledStatuses.includes(status)) {
    return { allowed: false, reason: 'STATUS_NOT_ENTITLED' };
  }

  const rawEnd = subscription.currentPeriodEnd;
  if (rawEnd === null || rawEnd === undefined) {
    return { allowed: false, reason: 'MISSING_PERIOD_END' };
  }
  const periodEnd = toEpochMillis(rawEnd);
  if (periodEnd === undefined) {
    return { allowed: false, reason: 'INVALID_PERIOD_END' };
  }

  if (!Number.isFinite(now)) {
    return { allowed: false, reason: 'INVALID_NOW' };
  }

  if (now >= periodEnd) {
    return { allowed: false, reason: 'PERIOD_ENDED' };
  }

  return { allowed: true };
};

/** 守卫读到的开关形状（`ServerConfig['entitlements']` 的子集）。 */
export interface EntitlementGateConfig {
  enabled: boolean;
}

export interface EntitlementGuardOptions {
  /** 闸门开关。省略时读环境（`loadConfigFromEnv().entitlements`），默认关。 */
  gate?: EntitlementGateConfig;
  /** 判定策略。省略用 `DEFAULT_ENTITLEMENT_POLICY`。 */
  policy?: EntitlementPolicy;
  /** 可注入时钟，便于把"到期边界"测成确定场景。默认 `Date.now`。 */
  now?: () => number;
  /** 可注入订阅读取，便于不碰数据库地单测守卫。默认查 `prisma`。 */
  loadSubscription?: (userId: number) => Promise<EntitlementSubscription | null>;
}

export type EntitlementGuard = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<FastifyReply | void>;

const defaultLoadSubscription = async (
  userId: number,
): Promise<EntitlementSubscription | null> =>
  prisma.subscription.findFirst({
    where: { userId },
    orderBy: { id: 'desc' },
  });

/**
 * preHandler 守卫。
 *
 * 🔴 **必须注册在 `authenticate` 之后** —— Fastify 的 hook 按注册顺序执行，
 * 排在前面会让 `getAuthUser` 抛 "User not authenticated"。
 * 见 `sync/sync.routes.ts` 里紧挨 `authenticate` 的那一行。
 *
 * 🔴 开关默认关：`gate.enabled === false` 时**直接返回**，不鉴权、不查库。
 * 这是"自托管默认免费"的代码保证。
 */
export const createEntitlementGuard = (
  options: EntitlementGuardOptions = {},
): EntitlementGuard => {
  const gate = options.gate ?? loadConfigFromEnv().entitlements;
  const policy = options.policy ?? DEFAULT_ENTITLEMENT_POLICY;
  const now = options.now ?? Date.now;
  const loadSubscription = options.loadSubscription ?? defaultLoadSubscription;

  return async (req, reply) => {
    if (!gate.enabled) {
      // 🔴 默认关的闸门在这里结束：没有身份读取、没有数据库查询。
      return;
    }

    const user = getAuthUser(req);
    const subscription = await loadSubscription(user.userId);
    const decision = evaluateEntitlement(subscription, now(), policy);
    if (decision.allowed) {
      return;
    }

    Logger.audit({
      event: ENTITLEMENT_AUDIT_EVENTS.DENIED,
      userId: user.userId,
      errorCode: ENTITLEMENT_ERROR_CODE,
      reason: decision.reason,
      ip: req.ip,
    });

    return reply.status(402).send({
      error: ENTITLEMENT_ERROR_MESSAGE,
      errorCode: ENTITLEMENT_ERROR_CODE,
      reason: decision.reason,
    });
  };
};