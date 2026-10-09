import { inboundEnvelopeSchema, inboundDraftEventIdSchema, inboundDraftSnapshotSchema, inboundDraftDecisionSchema,
  type InboundDraftDecision, type InboundDraftSnapshot } from '@heyta/shared-schema';
import { authorizeAutomationOperation, authorizeAutomationWrite } from '../entitlement';
import { INBOUND_AUTOMATION_FIELDS, type InboundAutomationField } from '@heyta/inbound-core';
import { prisma } from '../db';

const LEASE_MS = 60_000;
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;

export interface AutomationWorkerIdentity {
  credentialHash: string;
  databaseEpoch: string;
  tokenVersion: number;
}

export interface ClaimedAutomationEvent {
  eventId: string;
  ruleId: string;
  ruleVersion: number;
  receivedAt: number;
  contentType: 'application/json' | 'text/plain';
  payloadCiphertext: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  attempt: number;
  allowedFields: readonly InboundAutomationField[];
  targetProjectId?: string;
  timezone?: string;
  parseVersion: number;
  maxItems: number;
}

const assertUser = (userId: number): void => {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('Invalid automation worker');
};

/** Account settings expose metadata only, never encrypted or plaintext bodies. */
export async function listAutomationEvents(userId: number) {
  assertUser(userId);
  const rows = await prisma.automationEvent.findMany({ where: { userId },
    orderBy: [{ createdAt: 'desc' }, { eventId: 'asc' }], take: 50,
    select: { eventId: true, ruleId: true, ruleVersion: true, status: true, reasonCode: true, attempt: true, createdAt: true },
  });
  return rows.map(({ createdAt, ...row }) => ({ ...row, receivedAt: createdAt.getTime() }));
}

/** Explicit user choice; a timer/lease expiry is never sufficient to reparse. */
export async function retryUncertainAutomationEvent(input: {
  userId: number; eventId: string; expectedAttempt: number; expectedRuleVersion: number;
}, at?: Date): Promise<{ eventId: string; state: 'queued' }> {
  assertUser(input.userId);
  if (!EVENT_ID.test(input.eventId) || !Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt < 1 ||
      !Number.isSafeInteger(input.expectedRuleVersion) || input.expectedRuleVersion < 1) throw new Error('Invalid automation retry');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
    const now = at ?? new Date();
    const event = await tx.automationEvent.findFirst({ where: { userId: input.userId, eventId: input.eventId } });
    if (!event || event.status !== 'needs-confirmation' || event.reasonCode !== 'model-result-uncertain' ||
        event.attempt !== input.expectedAttempt || event.ruleVersion !== input.expectedRuleVersion ||
        event.payloadCiphertext === null || event.expiresAt <= now) throw new Error('Automation event cannot be retried');
    const rule = await tx.automationRule.findFirst({ where: { id: event.ruleId, userId: input.userId,
      enabled: true, deletedAt: null, version: input.expectedRuleVersion } });
    const permit = await tx.automationCommitPermit.findUnique({ where: { userId_ruleId_eventId: {
      userId: input.userId, ruleId: event.ruleId, eventId: event.eventId,
    } } });
    if (!rule || permit) throw new Error('Automation event cannot be retried');
    await tx.automationEvent.update({ where: { userId_ruleId_eventId: { userId: input.userId, ruleId: event.ruleId, eventId: event.eventId } }, data: {
      status: 'queued', reasonCode: null, leaseWorkerId: null, leaseExpiresAt: null, leaseGeneration: { increment: 1 },
    } });
    return { eventId: event.eventId, state: 'queued' as const };
  });
}

interface DraftSession { userId: number; tokenVersion: number; eventId: string }

const assertDraftSession = (input: DraftSession): void => {
  assertUser(input.userId);
  if (!Number.isSafeInteger(input.tokenVersion) || input.tokenVersion < 0 || !inboundDraftEventIdSchema.safeParse(input.eventId).success) {
    throw new Error('Invalid automation draft session');
  }
};

/** Account-visible ciphertext only; draft plaintext never reaches this service. */
export async function readAutomationDraft(input: DraftSession, at?: Date): Promise<InboundDraftSnapshot> {
  assertDraftSession(input);
  return prisma.$transaction(async (tx) => {
    const users = await tx.$queryRaw<{ tokenVersion: number; isVerified: number }[]>`
      SELECT token_version AS "tokenVersion", is_verified AS "isVerified" FROM users WHERE id = ${input.userId} FOR UPDATE
    `;
    if (users[0]?.tokenVersion !== input.tokenVersion || users[0]?.isVerified !== 1) throw new Error('Automation draft session expired');
    const row = await tx.automationEvent.findFirst({ where: {
      userId: input.userId, eventId: input.eventId, status: 'needs-confirmation', reasonCode: 'needs-confirmation',
      expiresAt: { gt: at ?? new Date() }, resultCiphertext: { not: null },
    }, select: { eventId: true, ruleId: true, ruleVersion: true, parseVersion: true, expiresAt: true,
      attempt: true, resultDigest: true, resultItemCount: true, resultCiphertext: true } });
    if (!row || row.expiresAt <= (at ?? new Date())) throw new Error('Automation draft is not available');
    const { expiresAt: _expiry, ...snapshot } = row;
    const checked = inboundDraftSnapshotSchema.safeParse(snapshot);
    if (!checked.success) throw new Error('Automation draft is not available');
    return checked.data;
  });
}

/** Confirm a sealed edited batch, or cancel it, with the exact draft revision. */
export async function decideAutomationDraft(input: DraftSession & InboundDraftDecision & { ticket?: string },
  at?: Date): Promise<{ eventId: string; state: 'prepared' | 'cancelled' }> {
  assertDraftSession(input);
  const { userId, tokenVersion, eventId, ticket, ...body } = input;
  const parsed = inboundDraftDecisionSchema.safeParse(body);
  if (!parsed.success) throw new Error('Invalid automation draft decision');
  const decision = parsed.data;
  return prisma.$transaction(async (tx) => {
    const users = await tx.$queryRaw<{ tokenVersion: number; isVerified: number }[]>`
      SELECT token_version AS "tokenVersion", is_verified AS "isVerified" FROM users WHERE id = ${userId} FOR UPDATE
    `;
    if (users[0]?.tokenVersion !== tokenVersion || users[0]?.isVerified !== 1) throw new Error('Automation draft session expired');
    // Cancel remains possible without a subscription. Confirm is authorized
    // **after** the account lock, and in self-hosted mode that authorization is a
    // one-time ticket scoped to this event — an earlier HTTP guard is insufficient,
    // and a shared 30-second binding would let one ticket confirm every draft.
    if (decision.decision === 'confirm') {
      if (!(await authorizeAutomationOperation({
        client: tx, userId, action: 'draft-confirm', eventId,
        ...(ticket === undefined ? {} : { ticket }), now: (at ?? new Date()).getTime(),
      })).allowed) {
        throw new Error('Automation entitlement is no longer valid');
      }
    }
    const current = await tx.automationEvent.findFirst({ where: {
      userId, eventId, status: 'needs-confirmation', reasonCode: 'needs-confirmation',
      attempt: decision.expectedAttempt, ruleVersion: decision.expectedRuleVersion, resultDigest: decision.expectedDigest,
      expiresAt: { gt: at ?? new Date() },
    } });
    if (!current || current.resultCiphertext === null || current.parseVersion === null) throw new Error('Automation draft revision conflict');
    const identity = { userId, ruleId: current.ruleId, eventId: current.eventId };
    const permit = await tx.automationCommitPermit.findUnique({ where: { userId_ruleId_eventId: identity } });
    if (permit || current.expiresAt <= (at ?? new Date())) throw new Error('Automation draft revision conflict');
    if (decision.decision === 'cancel') {
      const updated = await tx.automationEvent.updateMany({ where: { ...identity, status: 'needs-confirmation',
        reasonCode: 'needs-confirmation', attempt: decision.expectedAttempt, ruleVersion: decision.expectedRuleVersion,
        resultDigest: decision.expectedDigest, expiresAt: { gt: at ?? new Date() } },
        data: { status: 'cancelled', reasonCode: 'user-cancelled', payloadCiphertext: null, resultCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null } });
      if (updated.count !== 1) throw new Error('Automation draft revision conflict');
      return { eventId: current.eventId, state: 'cancelled' as const };
    }
    const rule = await tx.automationRule.findFirst({ where: { id: current.ruleId, userId,
      enabled: true, deletedAt: null, version: current.ruleVersion, parseVersion: current.parseVersion }, select: { maxItems: true } });
    const recipient = await tx.automationRecipientKey.findUnique({ where: { userId }, select: { keyEpoch: true } });
    const envelope = inboundEnvelopeSchema.parse(JSON.parse(decision.resultCiphertext));
    if (!rule || decision.resultItemCount > rule.maxItems || !recipient || envelope.keyEpoch !== recipient.keyEpoch ||
        current.expiresAt <= (at ?? new Date())) throw new Error('Automation draft revision conflict');
    const updated = await tx.automationEvent.updateMany({ where: { ...identity, status: 'needs-confirmation',
      reasonCode: 'needs-confirmation', attempt: decision.expectedAttempt, ruleVersion: decision.expectedRuleVersion,
      resultDigest: decision.expectedDigest, expiresAt: { gt: at ?? new Date() } }, data: {
      status: 'prepared', reasonCode: null, resultDigest: decision.resultDigest, resultItemCount: decision.resultItemCount,
      resultCiphertext: decision.resultCiphertext, leaseWorkerId: null, leaseExpiresAt: null,
    } });
    if (updated.count !== 1) throw new Error('Automation draft revision conflict');
    return { eventId: current.eventId, state: 'prepared' as const };
  });
}

async function findWorker(tx: any, userId: number, clientId: string, identity: AutomationWorkerIdentity): Promise<{ id: string } | undefined> {
  const row = await tx.automationWorker.findFirst({ where: {
    userId, credentialHash: identity.credentialHash, syncClientId: clientId,
    databaseEpoch: identity.databaseEpoch, revokedAt: null,
    user: { tokenVersion: identity.tokenVersion, isVerified: 1 },
  }, select: { id: true } });
  return row ?? undefined;
}

const toClaim = (row: any, rule?: any): ClaimedAutomationEvent => ({
  eventId: row.eventId, ruleId: row.ruleId, ruleVersion: row.ruleVersion, receivedAt: row.createdAt.getTime(),
  contentType: row.contentType === 'text/plain' ? 'text/plain' : 'application/json',
  payloadCiphertext: row.payloadCiphertext, leaseGeneration: row.leaseGeneration,
  leaseExpiresAt: row.leaseExpiresAt.toISOString(), attempt: row.attempt,
  allowedFields: Array.isArray(rule?.allowedFields) && rule.allowedFields.every((field: unknown): field is InboundAutomationField =>
    typeof field === 'string' && (INBOUND_AUTOMATION_FIELDS as readonly string[]).includes(field))
    ? rule.allowedFields : ['title'],
  ...(typeof rule?.targetProjectId === 'string' ? { targetProjectId: rule.targetProjectId } : {}),
  ...(typeof rule?.timezone === 'string' ? { timezone: rule.timezone } : {}),
  parseVersion: Number.isInteger(rule?.parseVersion) && rule.parseVersion >= 1 ? rule.parseVersion : 1,
  maxItems: Number.isInteger(rule?.maxItems) && rule.maxItems >= 1 && rule.maxItems <= 50 ? rule.maxItems : 50,
});

/** Claim one queued event with an account lock and a monotonic lease generation. */
export async function claimAutomationEvent(
  userId: number, clientId: string, identity: AutomationWorkerIdentity, at?: Date, requestedEventId?: string, ticket?: string,
): Promise<ClaimedAutomationEvent | undefined> {
  assertUser(userId);
  if (!EVENT_ID.test(clientId) || (requestedEventId !== undefined && !EVENT_ID.test(requestedEventId))) throw new Error('Invalid automation claim');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const now = at ?? new Date();
    const worker = await findWorker(tx, userId, clientId, identity);
    if (!worker) throw new Error('Automation worker is not authorized');
    const candidates = requestedEventId
      ? await tx.$queryRaw<any[]>`SELECT * FROM automation_events WHERE event_id = ${requestedEventId} AND user_id = ${userId} FOR UPDATE`
      : await tx.$queryRaw<any[]>`SELECT * FROM automation_events WHERE user_id = ${userId} AND payload_ciphertext IS NOT NULL AND (status IN ('queued','received') OR (status = 'leased' AND lease_expires_at <= ${now})) ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const current = candidates[0];
    if (!current || current.payload_ciphertext === null || (current.status !== 'queued' && current.status !== 'received' && !(current.status === 'leased' && current.lease_expires_at <= now))) return undefined;
    if (current.expires_at <= now) {
      await tx.automationEvent.update({ where: { userId_ruleId_eventId: { userId, ruleId: current.rule_id, eventId: current.event_id } }, data: {
        status: 'expired', reasonCode: 'retention-expired', payloadCiphertext: null, resultCiphertext: null, leaseWorkerId: null, leaseExpiresAt: null,
      } });
      return undefined;
    }
    if (current.status === 'leased') {
      const attempt = await tx.automationAiAttempt.findFirst({ where: {
        userId, ruleId: current.rule_id, eventId: current.event_id,
        state: { in: ['reserved', 'sent', 'consumed', 'unknown'] },
      }, select: { state: true } });
      if (attempt) {
        // A new lease generation is not authorization to buy another model
        // request. Reconcile the previous attempt before explicit re-parsing.
        await tx.automationEvent.update({ where: { userId_ruleId_eventId: { userId, ruleId: current.rule_id, eventId: current.event_id } }, data: {
          status: 'needs-confirmation', reasonCode: 'model-result-uncertain', leaseWorkerId: null, leaseExpiresAt: null,
        } });
        return undefined;
      }
    }
    const rule = await tx.automationRule.findUnique({ where: { id: current.rule_id }, select: {
      enabled: true, deletedAt: true, version: true, allowedFields: true, targetProjectId: true,
      timezone: true, parseVersion: true, maxItems: true,
    } });
    if (!rule || !rule.enabled || rule.deletedAt !== null || rule.version !== current.rule_version) {
      await tx.automationEvent.update({ where: { userId_ruleId_eventId: { userId, ruleId: current.rule_id, eventId: current.event_id } }, data: { status: 'cancelled', reasonCode: 'rule-disabled' } });
      return undefined;
    }
    // 🔴 授权只挡"**发活**"那一笔：上面三条提前 return 的分支确实也写库，但写的都是
    // **只减不增**的终态（保留期到点抹掉密文、模型结果不明转待确认、规则已停用转取消）——
    // 它们不给这台 worker 任何新工作，反而多数是保留/合规义务要求的动作，所以不该由
    // 权益来决定做不做。真正需要票据的是下面把事件置成 `leased` 并递增 generation 那一笔。
    // 放在这里还有一个理由：空轮询（没有候选事件）一次都不该烧 nonce。
    await authorizeAutomationWrite({ client: tx, userId, action: 'event-claim', ...(ticket === undefined ? {} : { ticket }) });
    const next = await tx.automationEvent.update({ where: { userId_ruleId_eventId: { userId, ruleId: current.rule_id, eventId: current.event_id } }, data: {
      status: 'leased', leaseWorkerId: worker.id, leaseGeneration: { increment: 1 },
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS), attempt: { increment: 1 },
    } });
    return toClaim(next, rule);
  });
}

export async function renewAutomationLease(
  userId: number, clientId: string, identity: AutomationWorkerIdentity,
  eventId: string, leaseGeneration: number, at?: Date,
): Promise<ClaimedAutomationEvent> {
  assertUser(userId);
  if (!EVENT_ID.test(eventId) || !Number.isInteger(leaseGeneration) || leaseGeneration < 1) throw new Error('Invalid automation lease');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const now = at ?? new Date();
    const worker = await findWorker(tx, userId, clientId, identity);
    if (!worker) throw new Error('Automation worker is not authorized');
    const current = await tx.automationEvent.findFirst({ where: {
      eventId, userId, status: 'leased', leaseWorkerId: worker.id, leaseGeneration,
      leaseExpiresAt: { gt: now }, expiresAt: { gt: now },
    } });
    if (!current) throw new Error('Automation lease is no longer valid');
    const rule = await tx.automationRule.findUnique({ where: { id: current.ruleId }, select: {
      enabled: true, deletedAt: true, version: true, allowedFields: true, targetProjectId: true,
      timezone: true, parseVersion: true, maxItems: true,
    } });
    if (!rule || !rule.enabled || rule.deletedAt !== null || rule.version !== current.ruleVersion) throw new Error('Automation rule is no longer enabled');
    const next = await tx.automationEvent.update({ where: { userId_ruleId_eventId: { userId, ruleId: current.ruleId, eventId } }, data: { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } });
    return toClaim(next, rule);
  });
}

/** Publish a sealed, frozen result without exposing its plaintext to the service. */
export async function publishAutomationResult(input: {
  userId: number; clientId: string; identity: AutomationWorkerIdentity; eventId: string;
  leaseGeneration: number; parseVersion: number; resultDigest: string; resultCiphertext: string; itemCount: number;
  needsConfirmation?: boolean; now?: Date; ticket?: string;
}): Promise<{ eventId: string; state: string; parseVersion: number }> {
  assertUser(input.userId);
  if (!EVENT_ID.test(input.eventId) || !Number.isInteger(input.leaseGeneration) || input.leaseGeneration < 1 ||
      !Number.isInteger(input.parseVersion) || input.parseVersion < 1 || !DIGEST.test(input.resultDigest) ||
      typeof input.resultCiphertext !== 'string' || input.resultCiphertext.length > 1_000_000 ||
      !Number.isInteger(input.itemCount) || input.itemCount < 1 || input.itemCount > 50) throw new Error('Invalid automation result');
  let envelope: unknown;
  try { envelope = JSON.parse(input.resultCiphertext); } catch { throw new Error('Invalid automation result'); }
  if (!inboundEnvelopeSchema.safeParse(envelope).success) throw new Error('Invalid automation result');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
    const now = input.now ?? new Date();
    const worker = await findWorker(tx, input.userId, input.clientId, input.identity);
    if (!worker) throw new Error('Automation worker is not authorized');
    const current = await tx.automationEvent.findFirst({ where: {
      eventId: input.eventId, userId: input.userId, leaseWorkerId: worker.id,
      leaseGeneration: input.leaseGeneration, expiresAt: { gt: now },
    } });
    if (!current) throw new Error('Automation lease is no longer valid');
    if (current.status === 'prepared' || current.status === 'needs-confirmation') {
      if (current.parseVersion === input.parseVersion && current.resultDigest === input.resultDigest && current.resultCiphertext === input.resultCiphertext && current.resultItemCount === input.itemCount &&
          (current.status === 'needs-confirmation') === (input.needsConfirmation === true)) {
        return { eventId: current.eventId, state: current.status, parseVersion: current.parseVersion! };
      }
      throw new Error('Automation result conflicts with frozen result');
    }
    if (current.status !== 'leased' || current.leaseExpiresAt === null || current.leaseExpiresAt <= now) {
      throw new Error('Automation lease is no longer valid');
    }
    const rule = await tx.automationRule.findFirst({ where: { id: current.ruleId, userId: input.userId, enabled: true, deletedAt: null, version: current.ruleVersion }, select: { maxItems: true, parseVersion: true } });
    if (!rule || rule.parseVersion !== input.parseVersion) throw new Error('Automation rule is no longer enabled');
    const recipient = await tx.automationRecipientKey.findUnique({ where: { userId: input.userId }, select: { keyEpoch: true } });
    const parsedEnvelope = inboundEnvelopeSchema.parse(envelope);
    if (!recipient || parsedEnvelope.keyEpoch !== recipient.keyEpoch) throw new Error('Automation result key epoch is stale');
    const state = input.needsConfirmation ? 'needs-confirmation' : 'prepared';
    if (input.itemCount > rule.maxItems) throw new Error('Invalid automation result');
    // 重放同一份已冻结的结果在上面那条就原样返回了，不会走到这里 —— 所以这一格
    // 授权只对"真的落下一份新结果"的那一次请求烧 nonce。
    await authorizeAutomationWrite({ client: tx, userId: input.userId, action: 'result-publish', eventId: input.eventId,
      ...(input.ticket === undefined ? {} : { ticket: input.ticket }) });
    const updated = await tx.automationEvent.update({ where: { userId_ruleId_eventId: { userId: input.userId, ruleId: current.ruleId, eventId: input.eventId } }, data: {
      status: state, parseVersion: input.parseVersion, resultDigest: input.resultDigest,
      resultCiphertext: input.resultCiphertext, reasonCode: input.needsConfirmation ? 'needs-confirmation' : null,
      resultItemCount: input.itemCount,
      leaseExpiresAt: null,
    } });
    return { eventId: updated.eventId, state: updated.status, parseVersion: updated.parseVersion! };
  });
}

/** Recover a frozen encrypted result after a worker crashed before permit/journal. */
export async function readAutomationPreparedResult(
  userId: number, clientId: string, identity: AutomationWorkerIdentity, eventId?: string, at?: Date,
): Promise<{ eventId: string; ruleId: string; ruleVersion: number; parseVersion: number; resultDigest: string; resultItemCount: number; resultCiphertext: string; state: string } | undefined> {
  assertUser(userId);
  if (eventId !== undefined && !EVENT_ID.test(eventId)) throw new Error('Invalid automation result query');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const now = at ?? new Date();
    const worker = await findWorker(tx, userId, clientId, identity);
    if (!worker) throw new Error('Automation worker is not authorized');
    // A frozen result may be taken over only BEFORE a durable commit owner is
    // chosen. Once authorized, discovery belongs exclusively to that worker.
    // Confirmation drafts are deliberately excluded from automatic recovery.
    const candidates = await tx.$queryRaw<Array<{ eventId: string; ruleId: string }>>`
      SELECT e.event_id AS "eventId", e.rule_id AS "ruleId"
      FROM automation_events e
      LEFT JOIN automation_commit_permits p
        ON p.user_id = e.user_id AND p.rule_id = e.rule_id AND p.event_id = e.event_id
      LEFT JOIN automation_rules r ON r.id = e.rule_id AND r.user_id = e.user_id
      WHERE e.user_id = ${userId}
        AND (${eventId ?? null}::text IS NULL OR e.event_id = ${eventId ?? null})
        AND e.expires_at > ${now}
        AND e.result_ciphertext IS NOT NULL AND e.result_digest IS NOT NULL
        AND e.result_item_count IS NOT NULL AND e.parse_version IS NOT NULL
        AND (
          (p.worker_id = ${worker.id} AND e.status IN ('prepared', 'cancelled'))
          OR (p.worker_id IS NULL AND e.status = 'prepared'
              AND r.enabled = true AND r.deleted_at IS NULL AND r.version = e.rule_version)
        )
      ORDER BY e.created_at ASC, e.event_id ASC LIMIT 1 FOR UPDATE OF e
    `;
    const candidate = candidates[0];
    if (!candidate) return undefined;
    const row = await tx.automationEvent.findUnique({ where: { userId_ruleId_eventId: { userId, ...candidate } } });
    if (!row || row.resultCiphertext === null || row.resultDigest === null || row.resultItemCount === null || row.parseVersion === null) return undefined;
    return { eventId: row.eventId, ruleId: row.ruleId, ruleVersion: row.ruleVersion, parseVersion: row.parseVersion,
      resultDigest: row.resultDigest, resultItemCount: row.resultItemCount, resultCiphertext: row.resultCiphertext, state: row.status };
  });
}
