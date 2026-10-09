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
import type { Prisma } from '@prisma/client';
import { loadConfigFromEnv } from './config';
import { prisma } from './db';
import { getAuthUser } from './middleware';
import { Logger } from './logger';
import {
  AutomationEntitlementError,
  isAutomationEntitlementBindingUsable,
  loadAutomationEntitlementKeyring,
  redeemAutomationEntitlementTicket,
  type AutomationEntitlementAction,
  type AutomationEntitlementBindingRecord,
  type AutomationEntitlementKeyring,
  type EntitlementDatabase,
} from './automation/entitlement-ticket';

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
export const ENTITLEMENT_CAPABILITIES = ['hosting', 'ai', 'automation'] as const;

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
  | 'GRANT_NOT_INCLUDED'
  /** 自托管在线核验：部署没声明判定来源，自动收集不可用。 */
  | 'ENTITLEMENT_MODE_UNCONFIGURED'
  /** 自托管在线核验：本部署没有官方验签钥匙环。 */
  | 'ISSUER_NOT_CONFIGURED'
  /** 自托管在线核验：还没有任何有效的官方绑定。 */
  | 'NO_BINDING'
  /** 自托管在线核验：绑定已过 30 秒窗口，需要新票据。 */
  | 'BINDING_EXPIRED'
  /** 自托管在线核验：绑定记录的签发者/实例不是当前部署的那一个。 */
  | 'DEPLOYMENT_MISMATCH'
  /** 自托管在线核验：绑定的吊销版本低于运营者设定的下限。 */
  | 'REVOKED_VERSION'
  /** 自托管在线核验：这次操作必须自带一次性票据。 */
  | 'ENTITLEMENT_TICKET_REQUIRED'
  /** 一次性票据被拒；稳定子码见 `code`。 */
  | 'ENTITLEMENT_TICKET_REJECTED';

export type EntitlementDecision =
  | { allowed: true }
  | { allowed: false; reason: EntitlementDenialReason; code?: string };

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

/**
 * 🔴 自动收集权益的**判定来源**由部署模式决定，两模式互斥：
 *
 * - `official`：官方托管实例，付费事实源是本机 `subscriptions` 的 `automation` grant。
 * - `selfhost-online`：用户自己的实例。本机订阅行**不是**自动收集的权益来源 ——
 *   负责人 2026-10-07 的裁决是"自托管同档授权"，即权益来自**官方账号**，
 *   而本机唯一能证明它的是官方签发的在线票据（协议 §4：首版在线核验、不承诺离线宽限）。
 *   让本地订阅放行等于"在自己的库里给自己发货"。
 *
 * 为什么必须显式配置、不给默认：代码里没有任何"这是官方实例"的程序化标志
 * （见 `config.ts` 的 `entitlements` 注释），猜一次就会在自托管者身上误伤。
 * 未配置 = 自动收集不可用（响的拒绝），而不是静默落到某一边。
 */
export const AUTOMATION_ENTITLEMENT_MODES = ['official', 'selfhost-online'] as const;
export type AutomationEntitlementMode = (typeof AUTOMATION_ENTITLEMENT_MODES)[number];

export const resolveAutomationEntitlementMode = (
  raw = process.env.AUTOMATION_ENTITLEMENT_MODE,
): AutomationEntitlementMode | undefined => {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'official' || value === 'selfhost-online') return value;
  throw new Error(`Invalid AUTOMATION_ENTITLEMENT_MODE: ${raw}. Use 'official' or 'selfhost-online'.`);
};

/** 权益读取的最小形状：判定只认这两份来源，不认整个 Prisma 客户端。 */
export interface AutomationEntitlementSource {
  readSubscriptions(userId: number): PromiseLike<readonly EntitlementSubscription[]>;
  readBinding(userId: number): PromiseLike<AutomationEntitlementBindingRecord | null>;
}

/** 事务客户端在此只需要原始查询与绑定读取；类型直接取 Prisma 生成的那个。 */
type AutomationEntitlementTransaction = Pick<Prisma.TransactionClient, '$queryRaw' | 'automationEntitlementBinding'>;

/**
 * 账号锁内使用的来源。
 *
 * 🔴 订阅行**必须共享锁定**（`FOR SHARE`）：权益撤销与提交许可的授予是两条并发事务，
 * 只读不锁会让"读到的权益快照"在提交前被改写，而账号行的 `FOR UPDATE` 挡不住
 * `subscriptions` 上的写入（`billing/webhook.routes.ts` 与 `activity/invite.ts`
 * 都不取账号锁）。协议 §2 把提交许可的原子落盘定为线性化点，前提就是这一把锁。
 */
export const lockedAutomationEntitlementSource = (tx: AutomationEntitlementTransaction): AutomationEntitlementSource => ({
  readSubscriptions: async (userId) => {
    const rows = await tx.$queryRaw`SELECT status, current_period_end AS "currentPeriodEnd", grants FROM subscriptions WHERE user_id = ${userId} FOR SHARE`;
    return (Array.isArray(rows) ? rows : []) as readonly EntitlementSubscription[];
  },
  readBinding: (userId) => tx.automationEntitlementBinding.findUnique({ where: { userId } }),
});

/** 不在事务内（HTTP preHandler）使用的来源：读快照、不锁行，也不是任何判定的最终依据。 */
export const prismaAutomationEntitlementSource = (): AutomationEntitlementSource => ({
  readSubscriptions: (userId) => prisma.subscription.findMany({ where: { userId }, orderBy: { id: 'desc' } }),
  readBinding: (userId) => prisma.automationEntitlementBinding.findUnique({ where: { userId } }),
});

/**
 * 自动收集的权益判定：先按部署模式选来源，再判定。
 *
 * 官方模式只看订阅；自托管在线模式只看**当前部署配置的那个签发者/实例**下
 * 仍然有效、且不低于吊销下限的短期绑定 —— 只看 `expiresAt` 会让"换实例、换钥、
 * 调高吊销版本"对已存在的绑定完全无效。订阅行在这一模式下不参与判定。
 */
export async function evaluateAutomationEntitlementForUser(input: {
  userId: number;
  now?: number;
  source?: AutomationEntitlementSource;
  policy?: EntitlementPolicy;
  mode?: AutomationEntitlementMode | undefined;
  keyring?: AutomationEntitlementKeyring | undefined;
}): Promise<EntitlementDecision> {
  const mode = input.mode === undefined ? resolveAutomationEntitlementMode() : input.mode;
  const now = input.now ?? Date.now();
  if (mode === undefined) return { allowed: false, reason: 'ENTITLEMENT_MODE_UNCONFIGURED' };
  const source = input.source ?? prismaAutomationEntitlementSource();
  const policy = input.policy ?? DEFAULT_ENTITLEMENT_POLICY;
  if (mode === 'official') {
    return evaluateCapabilityAcross(await source.readSubscriptions(input.userId), 'automation', now, policy);
  }
  const keyring = input.keyring === undefined ? loadAutomationEntitlementKeyring() : input.keyring;
  if (!keyring) return { allowed: false, reason: 'ISSUER_NOT_CONFIGURED' };
  const binding = await source.readBinding(input.userId);
  if (binding === null) return { allowed: false, reason: 'NO_BINDING' };
  if (!isAutomationEntitlementBindingUsable(binding, keyring, now)) {
    if (binding.issuer !== keyring.issuer || binding.installationId !== keyring.instanceId) return { allowed: false, reason: 'DEPLOYMENT_MISMATCH' };
    if (binding.revocationVersion < (keyring.minRevocationVersion ?? 0)) return { allowed: false, reason: 'REVOKED_VERSION' };
    return { allowed: false, reason: 'BINDING_EXPIRED' };
  }
  return { allowed: true };
}

/**
 * 🔴 在写事务内为**这一次操作**授权。自托管在线模式下这必须是消费一枚 action/作用域
 * 相符的一次性票据（调用方已持有账号锁），而不是复用 30 秒绑定 —— 绑定只用于
 * 无法逐次出示票据的公网接收路径（协议 §4 披露的那个窗口）。
 */
export async function authorizeAutomationOperation(input: {
  client: EntitlementDatabase;
  userId: number;
  action: AutomationEntitlementAction;
  ruleId?: string;
  eventId?: string;
  ticket?: string;
  now?: number;
  source?: AutomationEntitlementSource;
  policy?: EntitlementPolicy;
  mode?: AutomationEntitlementMode | undefined;
  keyring?: AutomationEntitlementKeyring | undefined;
}): Promise<EntitlementDecision> {
  const mode = input.mode === undefined ? resolveAutomationEntitlementMode() : input.mode;
  const now = input.now ?? Date.now();
  if (mode === undefined) return { allowed: false, reason: 'ENTITLEMENT_MODE_UNCONFIGURED' };
  if (mode === 'official') {
    return evaluateAutomationEntitlementForUser({ userId: input.userId, now, source: input.source ?? lockedAutomationEntitlementSource(input.client), policy: input.policy, mode, keyring: input.keyring });
  }
  if (input.ticket === undefined) return { allowed: false, reason: 'ENTITLEMENT_TICKET_REQUIRED' };
  try {
    await redeemAutomationEntitlementTicket({
      client: input.client, userId: input.userId, action: input.action,
      ...(input.ruleId !== undefined ? { ruleId: input.ruleId } : {}),
      ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
      token: input.ticket,
      keyring: input.keyring === undefined ? loadAutomationEntitlementKeyring() : input.keyring,
    });
    return { allowed: true };
  } catch (error) {
    if (error instanceof AutomationEntitlementError) return { allowed: false, reason: 'ENTITLEMENT_TICKET_REJECTED', code: error.code };
    throw error;
  }
}

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
  /**
   * 自托管在线核验读到的短期绑定（**整条记录**，不是只取两个字段）：
   * 判定要看签发者/实例/吊销版本，只回 `expiresAt` 会把这些防线在读数里就抹掉。
   */
  loadAutomationBinding?: (userId: number) => Promise<AutomationEntitlementBindingRecord | null>;
  /** 部署模式与官方钥匙环；省略时读显式 env，不猜。 */
  automationMode?: AutomationEntitlementMode | undefined;
  automationKeyring?: AutomationEntitlementKeyring | undefined;
  /**
   * 这道闸门是否**为这一次请求**消费一张 action 票据。
   *
   * 声明了 `action` 的路由在自托管在线模式下必须带一张与该 action/作用域逐字相符的
   * 一次性票据；官方托管模式下 `action` 不改变判定（仍看订阅），所以给既有路由补上
   * action 不会改变那一路的行为。
   */
  action?: AutomationEntitlementAction;
  /** 从请求里取本次操作的作用域（路由参数或正文）。 */
  scope?: (req: FastifyRequest) => { ruleId?: string; eventId?: string };
  /** 只在部分请求上判定（例如"关闭规则不要求付费"）。返回 false 时整道闸门跳过。 */
  when?: (req: FastifyRequest) => boolean;
}

/**
 * 只认**出现一次**的 `X-Heyta-Entitlement-Ticket`。
 *
 * 与 `readInboundUploadIdentity` 同一个理由：框架会把重复头合并成 `a, b`，
 * 那样一张坏票据就能盖住一张好票据。取原始头、重复即当作没带。
 */
export const readAutomationEntitlementTicketHeader = (rawHeaders: readonly string[]): string | undefined => {
  let found: string | undefined;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() !== 'x-heyta-entitlement-ticket') continue;
    if (found !== undefined) return undefined;
    found = rawHeaders[i + 1];
  }
  return found !== undefined && found.length > 0 && found.length <= 8192 && /^[A-Za-z0-9_.~-]+$/.test(found) ? found : undefined;
};

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

const defaultLoadAutomationBinding = async (
  userId: number,
): Promise<AutomationEntitlementBindingRecord | null> =>
  prisma.automationEntitlementBinding.findUnique({ where: { userId } });

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
  const loadAutomationBinding = options.loadAutomationBinding ?? defaultLoadAutomationBinding;

  return async (req, reply) => {
    if (options.when && !options.when(req)) return;
    if (!gate.enabled && capability !== 'automation') {
      // Free self-hosted sync remains ungated; automation always requires its paid grant.
      return;
    }

    const user = getAuthUser(req);
    const action = options.action;
    let decision: EntitlementDecision;
    if (capability !== 'automation') {
      decision = evaluateCapabilityAcross(await loadSubscriptions(user.userId), capability, now(), policy);
    } else if (action === undefined) {
      decision = await evaluateAutomationEntitlementForUser({
        userId: user.userId,
        now: now(),
        policy,
        source: { readSubscriptions: () => loadSubscriptions(user.userId), readBinding: () => loadAutomationBinding(user.userId) },
        ...(options.automationMode !== undefined ? { mode: options.automationMode } : {}),
        ...(options.automationKeyring !== undefined ? { keyring: options.automationKeyring } : {}),
      });
    } else {
      const rawHeaders = req.raw?.rawHeaders;
      const ticket = Array.isArray(rawHeaders) ? readAutomationEntitlementTicketHeader(rawHeaders) : undefined;
      decision = await prisma.$transaction((tx) => authorizeAutomationOperation({
        // 🔴 声明了 action 的闸门在**自己的事务**里消费票据：票据的一次性与它放行的
        // 那次写操作同生共死，回滚不烧 nonce。写事务内的授权（草稿确认、首次许可）
        // 在各自的事务里另判，不经过这里。
        client: tx,
        userId: user.userId,
        action,
        ...(options.scope ? options.scope(req) : {}),
        ...(ticket === undefined ? {} : { ticket }),
        now: now(),
        policy,
        ...(options.automationMode !== undefined ? { mode: options.automationMode } : {}),
        ...(options.automationKeyring !== undefined ? { keyring: options.automationKeyring } : {}),
      }));
    }
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
      // 票据被拒时子码只此一处有值：运维要区分"过期"和"作用域不符"，
      // 而这两个都叫 402。绝不记票据正文。
      ...(decision.code === undefined ? {} : { ticketCode: decision.code }),
      ip: req.ip,
    });

    return reply.status(402).send({
      error: ENTITLEMENT_ERROR_MESSAGE,
      errorCode: ENTITLEMENT_ERROR_CODE,
      reason: decision.reason,
      ...(decision.code === undefined ? {} : { ticketCode: decision.code }),
    });
  };
};
