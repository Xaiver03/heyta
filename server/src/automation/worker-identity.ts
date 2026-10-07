import { loadCommitProofKeyring, verifyCommitProof } from './commit-proof';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Operation } from '../sync/sync.types';

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

export const isInboundOperation = (op: Pick<Operation, 'id'>): boolean => typeof op.id === 'string' && op.id.startsWith('inbound:');

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
