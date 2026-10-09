import { prisma } from '../db';
import { createPrismaSqlExecutor, createPrismaSqlRunner, type SqlExecutor, type SqlRunner } from '../billing/pricing-store';
import { consumeManagedAiRequest } from '../ai/metering';

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
      if (!quota.allowed) throw new Error(`Automation AI quota denied: ${quota.reason}`);
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

/** Advance only along the declared attempt state machine; stale transitions are no-ops. */
export async function advanceAutomationAiAttempt(
  key: AutomationAiAttemptKey,
  from: AutomationAiAttemptState,
  to: AutomationAiAttemptState,
  sql?: SqlExecutor,
  auth?: AutomationAiReservationAuth,
): Promise<boolean> {
  assertKey(key);
  if (!AUTOMATION_AI_ATTEMPT_STATES.includes(from) || !AUTOMATION_AI_ATTEMPT_STATES.includes(to) || !ATTEMPT_TRANSITIONS[from].includes(to)) throw new Error('Invalid automation AI attempt state transition');
  const executor = sql ?? createPrismaSqlExecutor(prisma);
  if (auth !== undefined) {
    return executor.transaction(async (tx) => {
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
      const changed = await tx.query<{ ok: number }>(
        `UPDATE automation_ai_attempts SET state = $7, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $1 AND rule_id = $2 AND event_id = $3 AND parse_version = $4 AND attempt = $5 AND state = $6
          RETURNING 1 AS ok`, [key.userId, key.ruleId, key.eventId, key.parseVersion, key.attempt, from, to]);
      return changed.length === 1;
    });
  }
  const changed = await executor.query<{ ok: number }>(
    `UPDATE automation_ai_attempts SET state = $7, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND rule_id = $2 AND event_id = $3 AND parse_version = $4 AND attempt = $5 AND state = $6
      RETURNING 1 AS ok`,
    [key.userId, key.ruleId, key.eventId, key.parseVersion, key.attempt, from, to],
  );
  return changed.length === 1;
}
