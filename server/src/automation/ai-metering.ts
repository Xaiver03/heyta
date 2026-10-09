import { prisma } from '../db';
import { createPrismaSqlExecutor, createPrismaSqlRunner, type SqlExecutor, type SqlRunner } from '../billing/pricing-store';
import { consumeManagedAiRequest, type AiMeteringDenialReason } from '../ai/metering';

export const AUTOMATION_AI_ATTEMPT_STATES = ['reserved', 'sent', 'consumed', 'released', 'unknown'] as const;
export type AutomationAiAttemptState = (typeof AUTOMATION_AI_ATTEMPT_STATES)[number];
const ATTEMPT_TRANSITIONS: Readonly<Record<AutomationAiAttemptState, readonly AutomationAiAttemptState[]>> = {
  reserved: ['sent', 'released', 'unknown'],
  sent: ['consumed', 'released', 'unknown'],
  consumed: [], released: [], unknown: [],
};

export interface AutomationAiAttemptKey {
  userId: number;
  ruleId: string;
  eventId: string;
  parseVersion: number;
  attempt: number;
}

export interface AutomationAiReservationAuth {
  clientId: string;
  credentialHash: string;
  databaseEpoch: string;
  tokenVersion: number;
  leaseGeneration: number;
}

export interface ReservedAutomationAiAttempt extends AutomationAiAttemptKey {
  periodAnchor: number | null;
  billingSource: 'local' | 'direct' | 'managed';
  state: AutomationAiAttemptState;
}

const validId = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;
const validRule = /^[0-9a-f-]{36}$/;
const assertKey = (key: AutomationAiAttemptKey): void => {
  if (!Number.isSafeInteger(key.userId) || key.userId < 1 || !validRule.test(key.ruleId) || !validId.test(key.eventId) ||
      !Number.isInteger(key.parseVersion) || key.parseVersion < 1 || !Number.isInteger(key.attempt) || key.attempt < 1) {
    throw new Error('Invalid automation AI attempt');
  }
};

/**
 * 🔴 托管额度/权益计量**拒了这一次物理调用**时抛它，路由必须把它收口成 **402**
 * （`replyAutomationMeteringRejection`），不许落进"任何异常都算 409"的那个 `catch`。
 *
 * 理由与写事务授权那一路同一条：402 是宿主唯一会拿去"停止重试并显示等待权益"的信号。
 * 额度耗尽对宿主来说是**终态**（这个周期不会再放行），而 409 在宿主里读起来是
 * "这次传输失败了"⇒ 一次退避重试循环，用户界面只显示报错，永远看不到"本月 300 次用完了"。
 *
 * `used` / `limit` 原样带出去：设置页那两个数字与"额度用尽"那句文案要靠它们，
 * 而不是让界面再发一次请求去猜。
 */
export class AutomationAiMeteringDeniedError extends Error {
  constructor(readonly denial: { reason: AiMeteringDenialReason; used: number; limit: number }) {
    super(`Automation AI metering denied: ${denial.reason}`);
    this.name = 'AutomationAiMeteringDeniedError';
  }
}

/**
 * Reserve one model attempt and consume the normal AI-period quota in one
 * database transaction. A retry of the same attempt key is idempotent and
 * does not consume another request.
 */
export async function reserveAutomationAiAttempt(
  key: AutomationAiAttemptKey,
  now = Date.now(),
  limit?: number,
  sql?: SqlExecutor,
  auth?: AutomationAiReservationAuth,
  billingSource: 'local' | 'direct' | 'managed' = 'direct',
): Promise<ReservedAutomationAiAttempt> {
  assertKey(key);
  const executor = sql ?? createPrismaSqlExecutor(prisma);
  return executor.transaction(async (tx: SqlRunner) => {
    if (auth !== undefined) {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [key.userId]);
      const workers = await tx.query<{ id: string }>(
        `SELECT w.id FROM automation_workers w JOIN users u ON u.id = w.user_id
          WHERE w.user_id = $1 AND w.credential_hash = $2 AND w.sync_client_id = $3
            AND w.database_epoch = $4 AND w.revoked_at IS NULL AND u.token_version = $5 AND u.is_verified = 1`,
        [key.userId, auth.credentialHash, auth.clientId, auth.databaseEpoch, auth.tokenVersion],
      );
      const workerId = workers[0]?.id;
      if (!workerId) throw new Error('Automation worker is not authorized');
      const leased = await tx.query<{ ok: number }>(
        `SELECT 1 AS ok FROM automation_events e JOIN automation_rules r ON r.id = e.rule_id AND r.user_id = e.user_id
          WHERE e.user_id = $1 AND e.rule_id = $2 AND e.event_id = $3
          AND e.status = 'leased' AND e.lease_worker_id = $4 AND e.lease_generation = $5
          AND e.lease_expires_at > clock_timestamp() AND e.expires_at > clock_timestamp()
          AND e.attempt = $6 AND r.parse_version = $7 AND r.version = e.rule_version
          AND r.enabled = true AND r.deleted_at IS NULL FOR UPDATE OF e`,
        [key.userId, key.ruleId, key.eventId, workerId, auth.leaseGeneration, key.attempt, key.parseVersion],
      );
      if (leased.length !== 1) throw new Error('Automation lease is no longer valid');
    }
    const existing = await tx.query<any>(
      `SELECT period_anchor, billing_source, state FROM automation_ai_attempts
        WHERE user_id = $1 AND rule_id = $2 AND event_id = $3 AND parse_version = $4 AND attempt = $5`,
      [key.userId, key.ruleId, key.eventId, key.parseVersion, key.attempt],
    );
    if (existing.length > 0) {
      const row = existing[0]!;
      if (row.billing_source !== billingSource) throw new Error('Automation AI billing source conflicts with existing attempt');
      return { ...key, periodAnchor: row.period_anchor === null ? null : Number(row.period_anchor),
        billingSource, state: row.state as AutomationAiAttemptState };
    }

    // Only a physical managed-cloud request consumes the hosted counter. Local
    // and BYO endpoint calls still get a durable attempt row so retries and
    // unknown outcomes remain auditable without charging the hosted quota.
    let periodAnchor: number | null = null;
    if (billingSource === 'managed') {
      const quota = await consumeManagedAiRequest({ userId: key.userId, now, limit, sql: tx });
      if (!quota.allowed) throw new AutomationAiMeteringDeniedError({ reason: quota.reason, used: quota.used, limit: quota.limit });
      periodAnchor = quota.periodAnchor;
    }
    await tx.execute(
      `INSERT INTO automation_ai_attempts
        (user_id, rule_id, event_id, parse_version, attempt, period_anchor, billing_source, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'reserved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [key.userId, key.ruleId, key.eventId, key.parseVersion, key.attempt, periodAnchor, billingSource],
    );
    return { ...key, periodAnchor, billingSource, state: 'reserved' as const };
  });
}

/**
 * Advance only along the declared attempt state machine; stale transitions are no-ops.
 *
 * 🔴 `reserved → released` 把预留的托管额度**退回去**，且与 CAS 在同一个事务里。
 * 理由是 P1-4 那条：预留就消耗，而"预留了但物理请求根本没发出"这一路（租约掉了、
 * Vault 锁了、同意撤了）如果不退，就是**为用户没发生的那一次收费** —— 重试还会再扣一次。
 * `sent → released` **不退**：那一趟真的发出去了，供应商那侧已经产生一次物理调用。
 * `unknown` 也不退（计划裁决"不确定时对账不重建"，把不确定的那次算给用户比白送更符合披露）。
 *
 * 只退一次的机制是那条 CAS 本身：`WHERE state = $6` 让并发的那一路匹配 0 行，
 * 退款语句挂在"CAS 命中"这一侧，所以重复调用不可能退第二下。
 */
export async function advanceAutomationAiAttempt(
  key: AutomationAiAttemptKey,
  from: AutomationAiAttemptState,
  to: AutomationAiAttemptState,
  sql?: SqlExecutor,
  auth?: AutomationAiReservationAuth,
  now = Date.now(),
): Promise<boolean> {
  assertKey(key);
  if (!AUTOMATION_AI_ATTEMPT_STATES.includes(from) || !AUTOMATION_AI_ATTEMPT_STATES.includes(to) || !ATTEMPT_TRANSITIONS[from].includes(to)) throw new Error('Invalid automation AI attempt state transition');
  const executor = sql ?? createPrismaSqlExecutor(prisma);
  const refundable = from === 'reserved' && to === 'released';
  return executor.transaction(async (tx) => {
    if (auth !== undefined) {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [key.userId]);
      const workers = await tx.query<{ id: string }>(`SELECT w.id FROM automation_workers w JOIN users u ON u.id = w.user_id
        WHERE w.user_id = $1 AND w.credential_hash = $2 AND w.sync_client_id = $3 AND w.database_epoch = $4
          AND w.revoked_at IS NULL AND u.token_version = $5 AND u.is_verified = 1`,
        [key.userId, auth.credentialHash, auth.clientId, auth.databaseEpoch, auth.tokenVersion]);
      const workerId = workers[0]?.id;
      if (!workerId) throw new Error('Automation worker is not authorized');
      // Starting a physical request requires a live lease, body and rule.
      // Settling a request already sent may happen after retention or expiry.
      const leased = await tx.query<{ ok: number }>(`SELECT 1 AS ok FROM automation_events e
        JOIN automation_rules r ON r.id = e.rule_id AND r.user_id = e.user_id
        WHERE e.user_id = $1 AND e.rule_id = $2 AND e.event_id = $3
        AND e.status IN ('leased','prepared','needs-confirmation') AND e.lease_worker_id = $4 AND e.lease_generation = $5
        AND e.attempt = $6 AND r.parse_version = $7
        AND ($8::boolean = false OR (e.status = 'leased' AND e.lease_expires_at > clock_timestamp()
          AND e.expires_at > clock_timestamp() AND r.enabled = true AND r.deleted_at IS NULL AND r.version = e.rule_version))
        FOR UPDATE OF e`,
        [key.userId, key.ruleId, key.eventId, workerId, auth.leaseGeneration, key.attempt, key.parseVersion, to === 'sent']);
      if (leased.length !== 1) throw new Error('Automation lease is no longer valid');
    }
    const changed = await tx.query<{ period_anchor: unknown; billing_source: string }>(
      `UPDATE automation_ai_attempts SET state = $7, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND rule_id = $2 AND event_id = $3 AND parse_version = $4 AND attempt = $5 AND state = $6
        RETURNING period_anchor, billing_source`,
      [key.userId, key.ruleId, key.eventId, key.parseVersion, key.attempt, from, to],
    );
    const row = changed[0];
    if (row === undefined) return false;
    // `local` / `direct` 从未消耗托管计数器，也就没有可退的东西；`managed` 那一行的
    // `period_anchor` 由库层 CHECK 保证非空，所以这里只判来源。
    if (refundable && row.billing_source === 'managed') {
      // `requests > 0` 是**必要**的而不是装饰：计数器行可能已被 45 天保留期删掉，
      // 也可能被运维手工调过。少了这个守卫，那一路会撞在
      // `ai_usage_counters_requests_non_negative` 那条 CHECK 上，于是
      // "退回额度"这件好事变成"释放租约的那次调用整个 409"。
      await tx.execute(
        `UPDATE ai_usage_counters SET requests = requests - 1, updated_at = $3::bigint
          WHERE user_id = $1::integer AND period_anchor = $2::bigint AND requests > 0`,
        [key.userId, String(row.period_anchor), now],
      );
    }
    return true;
  });
}

/** 逐周期 / 逐事件的托管计量对账读数。 */
export interface AutomationAiReconciliation {
  userId: number;
  /** 该账号每个计费周期一行：自动收集净额应为多少 vs 计数器实际记了多少。 */
  periods: ReadonlyArray<{
    periodAnchor: number;
    /** 仍占用额度的托管尝试（reserved/sent/consumed/unknown）。 */
    chargedAttempts: number;
    /** 已退回额度的托管尝试（reserved → released）。 */
    refundedAttempts: number;
    /** 计数器里实际记的数（含**非**自动收集的托管 AI 手工用量）。 */
    counterRequests: number;
    /** `counterRequests < chargedAttempts` ⇒ 额度被少记或多退，是真缺陷。 */
    short: boolean;
    /** 计数器多出来的那部分：手工托管 AI 用量，**不是**缺陷，只披露到这一层。 */
    unexplainedByAutomation: number;
  }>;
  /** 逐事件（含解析版本与尝试号）的归属明细。 */
  events: ReadonlyArray<{
    ruleId: string;
    eventId: string;
    parseVersion: number;
    attempt: number;
    state: AutomationAiAttemptState;
    billingSource: string;
  }>;
}

/**
 * 🔴 **managed 额度与自动收集逐事件对账**（P1-4 要求的读路径，AC-1 那句"重试账目可对账"就靠它）。
 *
 * 口径里有一条必须写清的边界：`ai_usage_counters` 是**账号级**计数器，
 * 托管代理路由（人工 AI）与自动收集**共用同一行**，而人工那一侧刻意不留逐请求记录
 * （那张表"只有四列"本身就是 ADR-0054 §2 的保留承诺）。所以这里**不能**断言
 * "计数器 == 自动收集尝试数"，只能判两个方向里唯一能算缺陷的那一个：
 *
 * | 形状 | 判读 |
 * |---|---|
 * | `counterRequests < chargedAttempts` | 🔴 少记或多退 —— 账目不可能这样，`short: true` |
 * | `counterRequests > chargedAttempts` | 多出来的是人工托管用量，`unexplainedByAutomation` 原样披露 |
 *
 * 只读：一条写都不发。
 */
export async function reconcileAutomationAiMetering(input: {
  userId: number;
  sql?: SqlExecutor;
}): Promise<AutomationAiReconciliation> {
  if (!Number.isSafeInteger(input.userId) || input.userId < 1) throw new Error('Invalid user id');
  const executor = input.sql ?? createPrismaSqlExecutor(prisma);
  const attempts = await executor.query<{
    period_anchor: unknown; billing_source: string; state: string;
    rule_id: string; event_id: string; parse_version: number; attempt: number;
  }>(
    `SELECT period_anchor, billing_source, state, rule_id, event_id, parse_version, attempt
       FROM automation_ai_attempts WHERE user_id = $1 ORDER BY period_anchor, rule_id, event_id, parse_version, attempt`,
    [input.userId],
  );
  const counters = await executor.query<{ period_anchor: unknown; requests: unknown }>(
    `SELECT period_anchor, requests FROM ai_usage_counters WHERE user_id = $1 ORDER BY period_anchor`,
    [input.userId],
  );
  const toNumber = (value: unknown): number => {
    const raw = typeof value === 'string' && /^\d+$/.test(value.trim()) ? BigInt(value.trim()) : value;
    const num = typeof raw === 'bigint' ? Number(raw) : Number(raw);
    if (!Number.isSafeInteger(num)) throw new Error(`计量对账：${String(value)} 不是可核对的数字形状`);
    return num;
  };
  const chargedByPeriod = new Map<number, number>();
  const refundedByPeriod = new Map<number, number>();
  for (const row of attempts) {
    if (row.billing_source !== 'managed' || row.period_anchor === null) continue;
    const anchor = toNumber(row.period_anchor);
    const bucket = row.state === 'released' ? refundedByPeriod : chargedByPeriod;
    bucket.set(anchor, (bucket.get(anchor) ?? 0) + 1);
  }
  const anchors = [...new Set([...chargedByPeriod.keys(), ...refundedByPeriod.keys(),
    ...counters.map((row) => toNumber(row.period_anchor))])].sort((a, b) => a - b);
  const counterByAnchor = new Map(counters.map((row) => [toNumber(row.period_anchor), toNumber(row.requests)]));
  return {
    userId: input.userId,
    periods: anchors.map((periodAnchor) => {
      const chargedAttempts = chargedByPeriod.get(periodAnchor) ?? 0;
      const counterRequests = counterByAnchor.get(periodAnchor) ?? 0;
      return {
        periodAnchor, chargedAttempts,
        refundedAttempts: refundedByPeriod.get(periodAnchor) ?? 0,
        counterRequests,
        short: counterRequests < chargedAttempts,
        unexplainedByAutomation: Math.max(0, counterRequests - chargedAttempts),
      };
    }),
    events: attempts.map((row) => ({
      ruleId: row.rule_id, eventId: row.event_id, parseVersion: Number(row.parse_version),
      attempt: Number(row.attempt), state: row.state as AutomationAiAttemptState, billingSource: row.billing_source,
    })),
  };
}

