import { loadCommitProofKeyring, signCommitProof, verifyCommitProof } from './commit-proof';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Operation } from '../sync/sync.types';
import { prisma } from '../db';
import { authorizeAutomationOperation } from '../entitlement';

export interface InboundUploadIdentity {
  credentialHash: string;
  databaseEpoch: string;
  tokenVersion: number;
  commitProofs?: Readonly<Record<string, string>>;
}
type SqlReader = Pick<Prisma.TransactionClient, '$queryRaw'>;
const EPOCH = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EVENT = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;

/** Authenticated JWT version is supplied by middleware, never the body. */
export function readInboundUploadIdentity(
  rawHeaders: readonly string[], tokenVersion: number | undefined,
): InboundUploadIdentity | undefined {
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion! < 0) return undefined;
  const headers = new Map<string, string>();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    if (name !== 'x-heyta-worker-token' && name !== 'x-heyta-database-epoch') continue;
    if (headers.has(name)) return undefined;
    headers.set(name, rawHeaders[i + 1]);
  }
  const token = headers.get('x-heyta-worker-token');
  const databaseEpoch = headers.get('x-heyta-database-epoch');
  if (!token || !/^[0-9a-f]{64}$/.test(token) || !databaseEpoch || !EPOCH.test(databaseEpoch)) return undefined;
  return { credentialHash: createHash('sha256').update(token).digest('hex'), databaseEpoch, tokenVersion: tokenVersion! };
}

/** Called only by future entitlement-gated registration; does not persist or authorize. */
export function generateWorkerCredential(): { workerId: string; token: string; credentialHash: string } {
  const token = randomBytes(32).toString('hex');
  return { workerId: randomUUID(), token, credentialHash: createHash('sha256').update(token).digest('hex') };
}

export interface RegisteredAutomationWorker {
  workerId: string;
  workerToken: string;
  syncClientId: string;
  databaseEpoch: string;
}

/**
 * Register one durable local worker. The token is returned once and only its
 * hash is persisted. Re-registering the same client/epoch revokes the prior
 * worker under the account lock before creating the replacement, so a lost
 * local secret cannot remain valid indefinitely.
 */
export async function registerAutomationWorker(
  userId: number,
  syncClientId: string,
  databaseEpoch: string,
): Promise<RegisteredAutomationWorker> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/.test(syncClientId) || !EPOCH.test(databaseEpoch)) {
    throw new Error('Invalid automation worker registration');
  }
  const generated = generateWorkerCredential();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await tx.automationWorker.updateMany({
      where: { userId, syncClientId, databaseEpoch, revokedAt: null },
      data: { revokedAt: BigInt(Date.now()) },
    });
    await tx.automationWorker.create({ data: {
      id: generated.workerId,
      userId,
      credentialHash: generated.credentialHash,
      syncClientId,
      databaseEpoch,
    }});
  });
  return { workerId: generated.workerId, workerToken: generated.token, syncClientId, databaseEpoch };
}

export async function revokeAutomationWorker(userId: number, workerId: string): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[0-9a-f-]{36}$/.test(workerId)) return false;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    return tx.automationWorker.updateMany({
      where: { id: workerId, userId, revokedAt: null },
      data: { revokedAt: BigInt(Date.now()) },
    });
  });
  return result.count === 1;
}

export interface IssueAutomationCommitPermitInput {
  userId: number;
  tokenVersion: number;
  clientId: string;
  workerToken: string;
  databaseEpoch: string;
  eventId: string;
  opId: string;
  ruleId: string;
  ruleVersion: number;
  parseVersion: number;
  resultDigest: string;
  itemCount: number;
  /** 自托管在线核验下，首次许可必须自带绑定本事件的 action 票据。 */
  ticket?: string;
}

export async function issueAutomationCommitPermit(input: IssueAutomationCommitPermitInput): Promise<{ eventId: string; opId: string; proof: string; itemCount: number }> {
  if (!Number.isSafeInteger(input.userId) || input.userId < 1 || !Number.isSafeInteger(input.tokenVersion) || input.tokenVersion < 0 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/.test(input.clientId) || !EPOCH.test(input.databaseEpoch) ||
      !EVENT.test(input.eventId) || input.opId !== `inbound:${input.eventId}` ||
      !/^[0-9a-f-]{36}$/.test(input.ruleId) || !Number.isInteger(input.ruleVersion) || input.ruleVersion < 1 ||
      !Number.isInteger(input.parseVersion) || input.parseVersion < 1 || !/^[0-9a-f]{64}$/.test(input.resultDigest) ||
      !Number.isInteger(input.itemCount) || input.itemCount < 1 || input.itemCount > 50 || !/^[0-9a-f]{64}$/.test(input.workerToken)) {
    throw new Error('Invalid automation commit permit');
  }
  const keyring = loadCommitProofKeyring();
  if (!keyring) throw new Error('Automation commit signing is not configured');
  const credentialHash = createHash('sha256').update(input.workerToken).digest('hex');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
    const worker = await tx.automationWorker.findFirst({ where: {
      userId: input.userId, credentialHash, syncClientId: input.clientId,
      databaseEpoch: input.databaseEpoch, revokedAt: null,
      user: { tokenVersion: input.tokenVersion, isVerified: 1 },
    }});
    if (!worker) throw new Error('Automation worker is not authorized');
    const event = await tx.automationEvent.findUnique({ where: { userId_ruleId_eventId: {
      userId: input.userId, ruleId: input.ruleId, eventId: input.eventId,
    } } });
    const existing = await tx.automationCommitPermit.findUnique({ where: { userId_ruleId_eventId: {
      userId: input.userId, ruleId: input.ruleId, eventId: input.eventId,
    } } });
    if (existing) {
      const same = existing.userId === input.userId && existing.workerId === worker.id && existing.opId === input.opId &&
        existing.ruleId === input.ruleId && existing.ruleVersion === input.ruleVersion && existing.parseVersion === input.parseVersion &&
        existing.resultDigest === input.resultDigest && existing.itemCount === input.itemCount;
      if (!same) throw new Error('Automation event already authorized with different content');
      return {
        eventId: existing.eventId, opId: existing.opId,
        proof: signCommitProof({ userId: input.userId, workerId: worker.id, syncClientId: input.clientId,
          databaseEpoch: input.databaseEpoch, eventId: existing.eventId, itemCount: existing.itemCount }, keyring),
        itemCount: existing.itemCount,
      };
    }
    // Retention is an authorization boundary, independent of the cleanup job.
    // An existing exact permit above remains valid for an already committed intent.
    if (!event || event.expiresAt <= new Date() || event.status !== 'prepared' || event.ruleVersion !== input.ruleVersion ||
        event.parseVersion !== input.parseVersion || event.resultDigest !== input.resultDigest ||
        event.resultItemCount !== input.itemCount || event.resultCiphertext === null) {
      throw new Error('Automation event is not prepared for commit');
    }
    // The HTTP guard is too early: a subscription can end while this request
    // waits for the account lock. Keep existing owner permits recoverable, but
    // authorize a first permit against locked, current subscription rows — and on
    // a self-hosted instance against a ticket one-time-consumed **inside** this
    // transaction, so a rolled-back grant cannot burn a nonce and a shared 30-second
    // binding cannot stand in for this specific commit.
    if (!(await authorizeAutomationOperation({
      client: tx, userId: input.userId, action: 'commit-permit', eventId: input.eventId,
      ...(input.ticket === undefined ? {} : { ticket: input.ticket }),
    })).allowed) {
      throw new Error('Automation entitlement is no longer valid');
    }
    const rule = await tx.automationRule.findFirst({ where: { id: input.ruleId, userId: input.userId, deletedAt: null, enabled: true, version: input.ruleVersion } });
    if (!rule) throw new Error('Automation rule is not enabled');
    const created = await tx.automationCommitPermit.create({ data: {
      eventId: input.eventId, userId: input.userId, workerId: worker.id, opId: input.opId,
      ruleId: input.ruleId, ruleVersion: input.ruleVersion, parseVersion: input.parseVersion,
      resultDigest: input.resultDigest, itemCount: input.itemCount,
    }});
    return {
      eventId: created.eventId, opId: created.opId,
      proof: signCommitProof({ userId: input.userId, workerId: worker.id, syncClientId: input.clientId,
        databaseEpoch: input.databaseEpoch, eventId: created.eventId, itemCount: created.itemCount }, keyring),
      itemCount: created.itemCount,
    };
  });
}

export const isInboundOperation = (op: Pick<Operation, 'id'>): boolean => typeof op.id === 'string' && op.id.startsWith('inbound:');

/** Only call after accepting this exact op, inside the same upload transaction. */
export async function completeInboundOperation(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>, userId: number, op: Pick<Operation, 'id'>,
): Promise<void> {
  if (!isInboundOperation(op)) return;
  // The permit is the binding to the rule/event; never infer it from caller data.
  // Deleted rules may have erased the ledger, in which case a valid owner proof
  // still authorizes the upload but must not recreate deleted event metadata.
  await tx.$executeRaw`
    UPDATE automation_events e
    SET status = 'completed', reason_code = NULL, lease_worker_id = NULL, lease_expires_at = NULL
    FROM automation_commit_permits p
    WHERE p.user_id = ${userId} AND p.op_id = ${op.id}
      AND e.user_id = p.user_id AND e.rule_id = p.rule_id AND e.event_id = p.event_id
      AND e.status <> 'completed'
  `;
}

/**
 * Run before HTTP cache lookup AND within the upload transaction holding the
 * users row lock. Revocation takes that same lock. No process-local grants.
 * Ciphertext hides fields: we validate owner and public batch shape, not content.
 */
export async function authorizeInboundOperations(
  db: SqlReader, userId: number, clientId: string, ops: readonly Operation[],
  identity: InboundUploadIdentity | undefined,
): Promise<boolean> {
  const inbound = ops.filter(isInboundOperation);
  if (inbound.length === 0) return true;
  if (!identity) return false;
  const permits = await db.$queryRaw<Array<{ workerId: string; opId: string | null; eventId: string | null; itemCount: number | null }>>`
    SELECT w.id AS "workerId", p.op_id AS "opId", p.event_id AS "eventId", p.item_count AS "itemCount"
    FROM automation_workers w
    JOIN users u ON u.id = w.user_id
    LEFT JOIN automation_commit_permits p ON p.worker_id = w.id AND p.user_id = w.user_id
      AND p.op_id = ANY(${inbound.map((op) => op.id)}::text[])
    WHERE w.credential_hash = ${identity.credentialHash}
      AND w.user_id = ${userId} AND w.sync_client_id = ${clientId}
      AND w.database_epoch = ${identity.databaseEpoch} AND w.revoked_at IS NULL
      AND u.token_version = ${identity.tokenVersion} AND u.is_verified = 1
  `;
  const workerId = permits[0]?.workerId;
  if (!workerId) return false;
  const byId = new Map(permits.filter((permit) => permit.opId !== null).map((permit) => [permit.opId, permit]));
  // Missing active rows can follow rule deletion. Only a server-authenticated
  // owner receipt can preserve the already-authorized intent across that erase.
  const keyring = inbound.some((op) => !byId.has(op.id) && identity.commitProofs?.[op.id])
    ? loadCommitProofKeyring() : undefined;
  return inbound.every((op) => {
    const stored = byId.get(op.id);
    const proof = !stored && identity.commitProofs?.[op.id]
      ? verifyCommitProof(identity.commitProofs[op.id], keyring) : undefined;
    const permit = stored ?? (proof && proof.userId === userId && proof.workerId === workerId &&
      proof.syncClientId === clientId && proof.databaseEpoch === identity.databaseEpoch
      ? proof : undefined);
    if (!permit || !permit.eventId || permit.itemCount === null || !EVENT.test(permit.eventId) || op.id !== `inbound:${permit.eventId}` ||
        op.clientId !== clientId || op.entityType !== 'TASK' || op.opType !== 'BATCH' ||
        (op.entityIds != null && !Array.isArray(op.entityIds)) ||
        !Number.isInteger(permit.itemCount) || permit.itemCount < 1 || permit.itemCount > 50) return false;
    const scope = [op.entityId, ...(op.entityIds ?? [])];
    return scope.length === permit.itemCount && scope.every((id, index) => id === `inbound:${permit.eventId}:${index}`);
  });
}
