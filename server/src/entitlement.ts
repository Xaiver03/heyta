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
 * 🔴 能力词表 —— "这一行能用到哪些付费能力"。
 *
 * 与下面**四处**同源，四处并存不是重复而是纵深：
 * - `docs/reference/pricing-and-entitlements.md` 的 `pricing-ssot` 块（`grants`）；
 * - `scripts/check-pricing-consistency.mjs` 的 `ALLOWED_GRANTS`（门禁）；
 * - `prisma/schema.prisma` 里 `Subscription.grants` 的注释；
 * - 迁移 `20260929000000_add_subscription_grants` 的
 *   `subscriptions_grants_known` CHECK（数据库最后一道防线）。
 *
 * 理由很具体：词表是权益判定的基础，**拼错一个字母**（`aI` / `A1`）会让判定
 * 静默拒绝一个已经付过钱的用户 —— 那是这类故障里最难查的一种。
 */
export const ENTITLEMENT_CAPABILITIES = ['hosting', 'ai'] as const;

export type EntitlementCapability = (typeof ENTITLEMENT_CAPABILITIES)[number];

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
  /**
   * 这一行实际授予的能力（`Subscription.grants`，Prisma 的 `String[]`）。
   *
   * `null` / `undefined` 表示**读取方没有拿到这一列**（例如旧调用点只 select 了
   * 状态与到期日）—— 那是"未知"，一律拒绝；而 `[]` 表示"确实没有任何能力"。
   * 两者都必须 fail-closed，但原因不同（`MISSING_GRANTS` vs `GRANT_NOT_INCLUDED`），
   * 所以不合并成一个判断。
   */
  grants?: readonly string[] | null;
}

/** 拒绝原因。对外可区分，写进审计与响应体。 */
export type EntitlementDenialReason =
  | 'NO_SUBSCRIPTION'
  | 'STATUS_NOT_ENTITLED'
  | 'MISSING_PERIOD_END'
  | 'INVALID_PERIOD_END'
  | 'PERIOD_ENDED'
  | 'INVALID_NOW'
  | 'MISSING_GRANTS'
  | 'GRANT_NOT_INCLUDED';

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
 *
 * ⚠️ 导出是给邀请奖励那条路径用的（`activity/invite.ts` 要把库里已有的
 * `currentPeriodEnd` 喂给 `extendSubscriptionPeriod`）。**不要**在别处再写一份：
 * 这个转换里有一条"超大 bigint 必须被拒绝"的规则，抄一遍就会漏一遍。
 */
export const toEpochMillis = (value: unknown): number | undefined => {
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

/**
 * 🔴 能力判定：在"订阅有效"之上再问一句"**这一项能力**有没有被买下来"。
 *
 * 为什么分成两个函数，而不是把 `capability` 塞进 `evaluateEntitlement`：
 * 这是两个语义不同的问题，而且**各自都要能单独失败**。
 * - `evaluateEntitlement` = 这条订阅此刻有效吗（状态 + 到期日）；
 * - `evaluateCapability` = 有效的话，它的能力集合覆盖 `capability` 吗。
 *
 * 合成一个函数之后，"已到期"与"没买这一档"会退化成同一个原因字符串，
 * 而运营必须区分这两件事：前者要催续费，后者是**卖了没交付**（用户付了 ¥12
 * 却只拿到 hosting），处理方式完全不同。
 *
 * 顺序是刻意的：**先判有效、再判能力**。反过来写的话，一条已过期但 grants
 * 正确的订阅会以 `allowed: true` 通过能力检查，"到期"被静默漏掉。
 */
export const evaluateCapability = (
  subscription: EntitlementSubscription | null | undefined,
  capability: EntitlementCapability,
  now: number,
  policy: EntitlementPolicy = DEFAULT_ENTITLEMENT_POLICY,
): EntitlementDecision => {
  const base = evaluateEntitlement(subscription, now, policy);
  if (!base.allowed) {
    return base;
  }

  // `base.allowed === true` 已保证 subscription 既非 null 也非 undefined。
  //
  // 🔴 必须用 `Array.isArray` 而不是只判 `== null`：字符串**也有** `includes`，
  // 于是 `'hosting,ai'` 这种"数组被序列化成了字符串"的形态会被当成集合用，
  // 而子串匹配会让 `includes('ai')` 返回 `true` —— 一个本该 fail-closed 的
  // 位置变成了 fail-open。数据边界上不做类型信任。
  const grants = subscription?.grants;
  if (!Array.isArray(grants)) {
    return { allowed: false, reason: 'MISSING_GRANTS' };
  }
  if (!grants.includes(capability)) {
    return { allowed: false, reason: 'GRANT_NOT_INCLUDED' };
  }

  return { allowed: true };
};

/**
 * 🔴 **跨多行的能力判定**：只要**任何一行**在当下有效且覆盖这项能力，就放行。
 *
 * ## 为什么必须有它 —— 这是一个静默丢掉用户已付时长的坑
 *
 * 在这个函数出现之前，守卫读订阅用的是
 * `findFirst({ where: { userId }, orderBy: { id: 'desc' } })`，也就是
 * **"最新那一行说了算"**。在只有微信一个 provider 时这是对的：
 * 一个用户最多只有一行。
 *
 * 邀请奖励打破了这个前提。奖励写进 `subscriptions` 时用的是
 * `provider = 'invite'`（见 `activity/invite.ts`），于是库里会出现**两行**：
 *
 * ```
 *   id=7   provider='wechat'  currentPeriodEnd=+20 天   grants=['hosting']
 *   id=9   provider='invite'  currentPeriodEnd=+5  天   grants=['hosting']   ← 后建的
 * ```
 *
 * "最新那一行"会挑中 id=9，而它的到期日更早 —— 于是用户付了钱的 20 天里有
 * 15 天**凭空消失**，表现为"我明明还没到期，怎么被降级了"。
 * 没有任何一层会报错：两行都合法、都 active、grants 都对。
 *
 * ## 语义
 *
 * 这是"**任一**行满足即可"（OR），不是"所有行都要满足"（AND）。
 * 每一行代表一个独立的权益来源（付费、邀请、将来的运营赠送），
 * 它们各自授予自己的能力；用户拥有的能力是这些来源的**并集**。
 * 按 AND 判会让"买过 hosting + 被邀请拿过 hosting"的人被两道门各拒一次。
 *
 * `now` 非法时**每一行都会**拒绝（`INVALID_NOW`），所以整体也拒绝 —— 与单行版一致。
 */
export const evaluateCapabilityAcross = (
  subscriptions: readonly EntitlementSubscription[] | null | undefined,
  capability: EntitlementCapability,
  now: number,
  policy: EntitlementPolicy = DEFAULT_ENTITLEMENT_POLICY,
): EntitlementDecision => {
  const rows = Array.isArray(subscriptions) ? subscriptions : [];
  if (rows.length === 0) {
    return { allowed: false, reason: 'NO_SUBSCRIPTION' };
  }

  // 拒绝时返回**第一条有信息量的原因**，而不是笼统的"被拒"。
  // `NO_SUBSCRIPTION` 不是有信息量的那种（它只说明这一行不是订阅），
  // 所以它排在后面 —— 否则一个"有一行过期 + 一行不覆盖该能力"的用户
  // 会拿到 `NO_SUBSCRIPTION`，运维会去找一条并不存在的缺失订阅。
  let fallback: EntitlementDecision = { allowed: false, reason: 'NO_SUBSCRIPTION' };
  for (const row of rows) {
    const decision = evaluateCapability(row, capability, now, policy);
    if (decision.allowed) return decision;
    if (fallback.allowed === false && fallback.reason === 'NO_SUBSCRIPTION') {
      fallback = decision;
    }
  }
  return fallback;
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
  /**
   * 这道闸门守的是**哪一项能力**。默认 `hosting` —— 既有调用点
   * （`sync/sync.routes.ts` 的官方托管同步）守的就是它，默认值保证那一处的
   * 行为不变。云端 AI 的路由必须显式传 `'ai'`。
   */
  capability?: EntitlementCapability;
  /** 可注入时钟，便于把"到期边界"测成确定场景。默认 `Date.now`。 */
  now?: () => number;
  /**
   * 订阅读取（**全部行**）。省略时查 `prisma`。
   *
   * ⚠️ 名字是复数、返回数组：权益是**多个来源的并集**（付费 / 邀请 / 将来的赠送），
   * 单数形状会在下一次加来源时被误用成"最新一行说了算"。
   */
  loadSubscriptions?: (userId: number) => Promise<EntitlementSubscription[]>;
}

export type EntitlementGuard = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<FastifyReply | void>;

/**
 * 默认的订阅读取：**取该用户的全部行**，而不是最新那一条。
 *
 * 🔴 这个 `findMany`（而不是 `findFirst` + `orderBy id desc`）是邀请奖励的
 * **必要配套**：奖励行 `provider='invite'` 是在付费行之后建的，
 * "最新一行说了算"会把用户已付的时长丢掉。完整推演见
 * `evaluateCapabilityAcross` 的头注释。
 *
 * ⚠️ 行数天然有界（同一 provider 按约定复用一行），所以这里不需要 `take`。
 */
const defaultLoadSubscriptions = async (
  userId: number,
): Promise<EntitlementSubscription[]> =>
  prisma.subscription.findMany({
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
  const capability = options.capability ?? 'hosting';
  const now = options.now ?? Date.now;
  const loadSubscriptions = options.loadSubscriptions ?? defaultLoadSubscriptions;

  return async (req, reply) => {
    if (!gate.enabled) {
      // 🔴 默认关的闸门在这里结束：没有身份读取、没有数据库查询。
      return;
    }

    const user = getAuthUser(req);
    const subscriptions = await loadSubscriptions(user.userId);
    // 🔴 走 `evaluateCapabilityAcross` 而不是单行版：只有它会把
    // "付费行 + 邀请行"当成**两个独立的权益来源**取并集。
    // 用单行版（或"最新一行"）会让邀请行把付费时长盖掉 —— 见该函数的头注释。
    const decision = evaluateCapabilityAcross(subscriptions, capability, now(), policy);
    if (decision.allowed) {
      return;
    }

    Logger.audit({
      event: ENTITLEMENT_AUDIT_EVENTS.DENIED,
      userId: user.userId,
      errorCode: ENTITLEMENT_ERROR_CODE,
      reason: decision.reason,
      // 把"守的是哪一项能力"一起记下来：同一个 402 在 hosting 与 ai 上的
      // 含义完全不同，而响应体里的 reason 不足以区分（运维要查日志）。
      capability,
      ip: req.ip,
    });

    return reply.status(402).send({
      error: ENTITLEMENT_ERROR_MESSAGE,
      errorCode: ENTITLEMENT_ERROR_CODE,
      reason: decision.reason,
    });
  };
};