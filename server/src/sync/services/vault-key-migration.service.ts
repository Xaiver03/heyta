import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  type VaultKeyMigrationChunk,
  type VaultKeyMigrationManifest,
  type VaultKeyMigrationStageResponse,
  type VaultKeyMigrationRequest,
  type VaultKeyMigrationResponse,
  type VaultKeyMigrationInventoryPage,
  vaultKeyMigrationInventoryPageSchema,
  vaultKeyMigrationChunkSchema,
  vaultKeyMigrationManifestSchema,
  vaultKeyMigrationRequestSchema,
  vaultKeyPackageSchema,
} from '@heyta/shared-schema';
import { isEncryptedPayloadTransportShape } from '@heyta/sync-core';
import { prisma } from '../../db';
import { stableJsonStringify } from '../conflict';
import { inspectVaultPayloadGeneration } from '../vault-payload';

export const VAULT_KEY_MIGRATION_TTL_MS = 24 * 60 * 60 * 1000;
export const VAULT_KEY_MIGRATION_MAX_CHUNK_BYTES = 32 * 1024 * 1024;
export const VAULT_KEY_MIGRATION_MAX_CHUNK_OPERATIONS = 1_000;
export const VAULT_KEY_MIGRATION_INVENTORY_PAGE_SIZE = 500;

const MIGRATION_STATES = ['STAGING', 'PUBLISHED', 'CANCELLED', 'EXPIRED'] as const;
type MigrationState = (typeof MIGRATION_STATES)[number];

export class VaultKeyMigrationError extends Error {
  constructor(
    readonly code:
      | 'key_package_not_found'
      | 'stale_key_version'
      | 'stale_latest_seq'
      | 'migration_request_reused'
      | 'migration_coverage_mismatch'
      | 'legacy_payload'
      | 'wrong_payload_generation'
      | 'invalid_payload'
      | 'migration_already_active'
      | 'migration_expired'
      | 'migration_cancelled'
      | 'migration_not_ready'
      | 'migration_quota_exceeded'
      | 'chunk_too_large'
      | 'chunk_conflict',
    message: string,
    readonly statusCode: 400 | 404 | 409 | 413 = 409,
  ) {
    super(message);
    this.name = 'VaultKeyMigrationError';
  }
}

type MigrationOperationRow = {
  id: string;
  serverSeq: number;
  payload: unknown;
  payloadBytes: bigint;
  vectorClock: unknown;
  isPayloadEncrypted: boolean;
};

type MigrationManifestRow = {
  id: string;
  requestId: string;
  requestFingerprint: string;
  state: string;
  expectedKeyVersion: number;
  expectedLatestSeq: number;
  targetPayloadKeyVersion: number;
  keyVersion: number;
  latestSeq: number;
  expectedOperationCount: number;
  expectedPayloadBytes: bigint;
  uploadedOperationCount: number;
  uploadedPayloadBytes: bigint;
  reservedStorageBytes: bigint;
  migratedOperationCount: number;
  expiresAt: bigint;
  cancelledAt: bigint | null;
  packageData: unknown;
};

const requestFingerprint = (request: VaultKeyMigrationRequest): string =>
  createHash('sha256')
    .update(stableJsonStringify(request))
    .digest('base64url');

const responseFromRow = (row: {
  requestId: string;
  keyVersion: number;
  targetPayloadKeyVersion: number;
  latestSeq: number;
  migratedOperationCount: number;
}): VaultKeyMigrationResponse => ({
  requestId: row.requestId,
  keyVersion: row.keyVersion,
  payloadKeyVersion: row.targetPayloadKeyVersion,
  latestSeq: row.latestSeq,
  migratedOperationCount: row.migratedOperationCount,
});

const asMigrationState = (state: string): MigrationState =>
  (MIGRATION_STATES as readonly string[]).includes(state)
    ? state as MigrationState
    : 'STAGING';

const stageResponseFromRow = (row: MigrationManifestRow): VaultKeyMigrationStageResponse => ({
  requestId: row.requestId,
  state: asMigrationState(row.state),
  keyVersion: row.keyVersion,
  payloadKeyVersion: row.targetPayloadKeyVersion,
  expectedLatestSeq: row.expectedLatestSeq,
  expectedOperationCount: row.expectedOperationCount,
  uploadedOperationCount: row.uploadedOperationCount,
  expectedPayloadBytes: Number(row.expectedPayloadBytes),
  uploadedPayloadBytes: Number(row.uploadedPayloadBytes),
  expiresAt: Number(row.expiresAt),
  migratedOperationCount: row.migratedOperationCount,
  latestSeq: row.latestSeq,
});

const migrationSelect = {
  id: true,
  requestId: true,
  requestFingerprint: true,
  state: true,
  expectedKeyVersion: true,
  expectedLatestSeq: true,
  targetPayloadKeyVersion: true,
  keyVersion: true,
  latestSeq: true,
  expectedOperationCount: true,
  expectedPayloadBytes: true,
  uploadedOperationCount: true,
  uploadedPayloadBytes: true,
  reservedStorageBytes: true,
  migratedOperationCount: true,
  expiresAt: true,
  cancelledAt: true,
  packageData: true,
} as const;

const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value ?? null) ?? 'null', 'utf8');

interface InventoryCursor {
  v: 1;
  userId: number;
  latestSeq: number;
  retainedFromSeq: number;
  afterSeq: number;
}

const INVENTORY_CURSOR_PREFIX = 'vmi1.';
const inventoryCursorSecret = (): string | undefined => {
  const secret = process.env.JWT_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
};
const encodeCursorBody = (body: string): string => Buffer.from(body, 'utf8').toString('base64url');
const inventoryCursorSignature = (body: string, secret: string): string =>
  createHmac('sha256', secret).update('heyta:vault-migration-inventory:v1\0').update(body).digest('base64url');

const issueInventoryCursor = (value: InventoryCursor): string => {
  const secret = inventoryCursorSecret();
  if (!secret) throw new VaultKeyMigrationError('migration_coverage_mismatch', 'inventory cursor signing is unavailable', 409);
  const body = encodeCursorBody(JSON.stringify(value));
  return `${INVENTORY_CURSOR_PREFIX}${body}.${inventoryCursorSignature(body, secret)}`;
};

const verifyInventoryCursor = (token: string, userId: number): InventoryCursor | undefined => {
  const secret = inventoryCursorSecret();
  if (!secret || token.length > 4096 || !token.startsWith(INVENTORY_CURSOR_PREFIX)) return undefined;
  const rest = token.slice(INVENTORY_CURSOR_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const body = rest.slice(0, dot);
  const signature = rest.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return undefined;
  const expected = inventoryCursorSignature(body, secret);
  const actual = Buffer.from(signature, 'base64url');
  const expectedBytes = Buffer.from(expected, 'base64url');
  if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) return undefined;
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<InventoryCursor>;
    const { latestSeq, retainedFromSeq, afterSeq } = value;
    if (value.v !== 1 || value.userId !== userId ||
        typeof latestSeq !== 'number' || !Number.isSafeInteger(latestSeq) || latestSeq < 0 ||
        typeof retainedFromSeq !== 'number' || !Number.isSafeInteger(retainedFromSeq) || retainedFromSeq < 1 ||
        typeof afterSeq !== 'number' || !Number.isSafeInteger(afterSeq) || afterSeq < 0 ||
        afterSeq > latestSeq) return undefined;
    return { v: 1, userId, latestSeq, retainedFromSeq, afterSeq };
  } catch {
    return undefined;
  }
};

/**
 * Publishes a client-produced, full-history ciphertext replacement in one
 * database transaction. The server only inspects envelope metadata; it never
 * receives or derives the vault root key.
 */
export class VaultKeyMigrationService {
  private async lockUserAndSyncState(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<number> {
    await tx.userSyncState.upsert({
      where: { userId },
      create: { userId, lastSeq: 0 },
      update: {},
    });
    const state = await tx.$queryRaw<Array<{ lastSeq: number }>>`
      SELECT last_seq AS "lastSeq"
      FROM user_sync_state
      WHERE user_id = ${userId}
      FOR UPDATE
    `;
    // Keep lock ordering identical to the normal upload path: sync state first,
    // then users.  The user row serializes quota reservations with uploads.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    return state[0]?.lastSeq ?? 0;
  }

  private async findMigration(
    tx: Prisma.TransactionClient,
    userId: number,
    requestId: string,
  ): Promise<MigrationManifestRow | null> {
    return tx.vaultKeyMigration.findUnique({
      where: { userId_requestId: { userId, requestId } },
      select: migrationSelect,
    }) as Promise<MigrationManifestRow | null>;
  }

  /**
   * Return the complete retained ciphertext inventory. This is deliberately a
   * migration-only read: unlike `/ops`, it never applies snapshot fast-forward
   * or excludes a client, and every page is bound to the same signed history
   * version and retained-history boundary.
   */
  async inventory(
    userId: number,
    cursor?: string,
    requestedLimit = VAULT_KEY_MIGRATION_INVENTORY_PAGE_SIZE,
  ): Promise<VaultKeyMigrationInventoryPage> {
    const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), VAULT_KEY_MIGRATION_INVENTORY_PAGE_SIZE);
    const decoded = cursor === undefined ? undefined : verifyInventoryCursor(cursor, userId);
    if (cursor !== undefined && decoded === undefined) {
      throw new VaultKeyMigrationError('migration_coverage_mismatch', 'invalid or expired migration inventory cursor', 400);
    }
    return prisma.$transaction(async (tx) => {
      const state = await tx.userSyncState.findUnique({
        where: { userId },
        select: { lastSeq: true, snapshotData: true, lastSnapshotSeq: true },
      });
      const latestSeq = state?.lastSeq ?? 0;
      const first = await tx.operation.findFirst({
        where: { userId }, orderBy: { serverSeq: 'asc' }, select: { serverSeq: true },
      });
      const retainedFromSeq = first?.serverSeq ?? latestSeq + 1;
      if (decoded && (decoded.latestSeq !== latestSeq || decoded.retainedFromSeq !== retainedFromSeq)) {
        throw new VaultKeyMigrationError('stale_latest_seq', 'operation history changed during migration inventory', 409);
      }
      const afterSeq = decoded?.afterSeq ?? 0;
      const rows = await tx.operation.findMany({
        where: { userId, serverSeq: { gt: afterSeq } },
        orderBy: { serverSeq: 'asc' },
        take: limit + 1,
        select: {
          id: true, serverSeq: true, clientId: true, actionType: true, opType: true,
          entityType: true, entityId: true, entityIds: true, payload: true,
          clientTimestamp: true, schemaVersion: true, repairBaseServerSeq: true,
        },
      });
      const hasMore = rows.length > limit;
      if (hasMore) rows.pop();
      const operations = rows.map((row) => {
        if (typeof row.payload !== 'string') {
          throw new VaultKeyMigrationError('invalid_payload', 'migration inventory contains a non-opaque payload', 409);
        }
        return {
          id: row.id,
          serverSeq: row.serverSeq,
          clientId: row.clientId,
          actionType: row.actionType,
          opType: row.opType,
          entityType: row.entityType,
          ...(row.entityId === null ? {} : { entityId: row.entityId }),
          // Keep the authenticated operation identity canonical with the
          // ordinary download route. Prisma represents the nullable wire
          // field as an empty array for single-entity operations, while the
          // payload AAD treats omitted and [] differently.
          ...(row.entityIds.length > 0 ? { entityIds: row.entityIds } : {}),
          timestamp: Number(row.clientTimestamp),
          schemaVersion: row.schemaVersion,
          payload: row.payload,
          causalFullState: row.opType === 'SYNC_IMPORT' || row.opType === 'BACKUP_IMPORT' ||
            (row.opType === 'REPAIR' && row.repairBaseServerSeq !== null),
        };
      });
      let nextCursor: string | undefined;
      if (hasMore) {
        const last = rows[rows.length - 1];
        nextCursor = issueInventoryCursor({
          v: 1, userId, latestSeq, retainedFromSeq, afterSeq: last?.serverSeq ?? afterSeq,
        });
      }
      const snapshotPresent = state?.snapshotData !== null && state?.snapshotData !== undefined;
      let replayBaseServerSeq: number | undefined;
      if (snapshotPresent) {
        const base = await tx.operation.findFirst({
          where: {
            userId,
            ...(state?.lastSnapshotSeq === null || state?.lastSnapshotSeq === undefined
              ? {} : { serverSeq: { lte: state.lastSnapshotSeq } }),
            OR: [
              { opType: 'SYNC_IMPORT' },
              { opType: 'BACKUP_IMPORT' },
              { opType: 'REPAIR', repairBaseServerSeq: { not: null } },
            ],
          },
          orderBy: { serverSeq: 'asc' },
          select: { serverSeq: true },
        });
        replayBaseServerSeq = base?.serverSeq;
      }
      const page: VaultKeyMigrationInventoryPage = {
        operations,
        latestSeq,
        retainedFromSeq,
        complete: !hasMore,
        ...(nextCursor === undefined ? {} : { nextCursor }),
        snapshot: {
          present: snapshotPresent,
          ...(state?.lastSnapshotSeq === null || state?.lastSnapshotSeq === undefined
            ? {} : { lastSnapshotSeq: Number(state.lastSnapshotSeq) }),
          ...(replayBaseServerSeq === undefined ? {} : { replayBaseServerSeq }),
        },
      };
      const parsed = vaultKeyMigrationInventoryPageSchema.safeParse(page);
      if (!parsed.success) throw new VaultKeyMigrationError('migration_coverage_mismatch', 'migration inventory exceeded wire bounds', 409);
      return parsed.data;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  }

  private assertNotExpired(row: MigrationManifestRow, now: number): void {
    if (row.state === 'EXPIRED' || (row.state === 'STAGING' && Number(row.expiresAt) <= now)) {
      throw new VaultKeyMigrationError('migration_expired', 'key migration staging session expired', 409);
    }
    if (row.state === 'CANCELLED') {
      throw new VaultKeyMigrationError('migration_cancelled', 'key migration staging session was cancelled', 409);
    }
  }

  /** Start or resume a durable staging session. */
  async begin(
    userId: number,
    input: VaultKeyMigrationManifest,
  ): Promise<VaultKeyMigrationStageResponse> {
    const parsed = vaultKeyMigrationManifestSchema.safeParse(input);
    if (!parsed.success) {
      throw new VaultKeyMigrationError('migration_coverage_mismatch', 'invalid key migration manifest', 400);
    }
    const manifest = parsed.data;
    const fingerprint = requestFingerprint(manifest as unknown as VaultKeyMigrationRequest);
    const now = Date.now();
    const expiresAt = BigInt(now + VAULT_KEY_MIGRATION_TTL_MS);

    return prisma.$transaction(async (tx) => {
      const latestSeq = await this.lockUserAndSyncState(tx, userId);
      const prior = await this.findMigration(tx, userId, manifest.requestId);
      if (prior) {
        if (prior.requestFingerprint !== fingerprint) {
          throw new VaultKeyMigrationError('migration_request_reused', 'migration requestId was already used for a different manifest', 409);
        }
        if (prior.state === 'STAGING' && Number(prior.expiresAt) > now) {
          return stageResponseFromRow(prior);
        }
        if (prior.state === 'PUBLISHED') return stageResponseFromRow(prior);
        throw new VaultKeyMigrationError('migration_expired', 'migration requestId cannot be reused after cancellation or expiry', 409);
      }

      const currentPackage = await tx.vaultKeyPackage.findUnique({ where: { userId } });
      if (!currentPackage) throw new VaultKeyMigrationError('key_package_not_found', 'a key package must exist before payload migration', 404);
      const currentPackageData = vaultKeyPackageSchema.safeParse(currentPackage.packageData);
      if (!currentPackageData.success) throw new VaultKeyMigrationError('key_package_not_found', 'stored key package is invalid', 409);
      if (manifest.expectedKeyVersion !== currentPackage.keyVersion) throw new VaultKeyMigrationError('stale_key_version', 'key package version changed', 409);
      if (manifest.package.keyVersion !== manifest.expectedKeyVersion + 1) throw new VaultKeyMigrationError('stale_key_version', 'atomic migration must advance the wrapper revision exactly once', 409);
      const currentPayloadVersion = currentPackage.activePayloadKeyVersion ?? 0;
      if (manifest.targetPayloadKeyVersion !== currentPayloadVersion + 1) throw new VaultKeyMigrationError('wrong_payload_generation', 'target payload generation must advance exactly one generation', 409);
      if (manifest.expectedLatestSeq !== latestSeq) throw new VaultKeyMigrationError('stale_latest_seq', 'operation history changed; re-read and rebuild the migration manifest', 409);

      const operationCount = await tx.operation.count({ where: { userId } });
      if (operationCount !== manifest.expectedOperationCount) throw new VaultKeyMigrationError('migration_coverage_mismatch', 'manifest operation count does not match retained history', 409);

      const active = await tx.vaultKeyMigration.findFirst({
        where: { userId, state: 'STAGING', expiresAt: { gt: BigInt(now) } },
        select: { requestId: true },
      });
      if (active) throw new VaultKeyMigrationError('migration_already_active', 'another key migration is already staging for this account', 409);

      const user = await tx.user.findUnique({ where: { id: userId }, select: { storageUsedBytes: true, storageQuotaBytes: true } });
      const reservations = await tx.vaultKeyMigration.aggregate({
        _sum: { reservedStorageBytes: true },
        where: { userId, state: 'STAGING', expiresAt: { gt: BigInt(now) } },
      });
      const reserved = Number(reservations._sum.reservedStorageBytes ?? 0n);
      const used = Number(user?.storageUsedBytes ?? 0n);
      const quota = Number(user?.storageQuotaBytes ?? 0n);
      if (used + reserved + manifest.expectedPayloadBytes > quota) {
        throw new VaultKeyMigrationError('migration_quota_exceeded', 'migration staging reservation exceeds account quota', 409);
      }

      const created = await tx.vaultKeyMigration.create({
        data: {
          userId,
          requestId: manifest.requestId,
          requestFingerprint: fingerprint,
          state: 'STAGING',
          expectedKeyVersion: manifest.expectedKeyVersion,
          expectedLatestSeq: manifest.expectedLatestSeq,
          targetPayloadKeyVersion: manifest.targetPayloadKeyVersion,
          keyVersion: manifest.package.keyVersion,
          latestSeq: manifest.expectedLatestSeq,
          expectedOperationCount: manifest.expectedOperationCount,
          expectedPayloadBytes: BigInt(manifest.expectedPayloadBytes),
          reservedStorageBytes: BigInt(manifest.expectedPayloadBytes),
          packageData: manifest.package as unknown as Prisma.InputJsonValue,
          expiresAt,
          createdAt: BigInt(now),
        },
        select: migrationSelect,
      });
      return stageResponseFromRow(created as unknown as MigrationManifestRow);
    }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** Upload one bounded chunk. Retries with the same chunk fingerprint are idempotent. */
  async uploadChunk(userId: number, input: VaultKeyMigrationChunk): Promise<VaultKeyMigrationStageResponse> {
    const parsed = vaultKeyMigrationChunkSchema.safeParse(input);
    if (!parsed.success) throw new VaultKeyMigrationError('migration_coverage_mismatch', 'invalid key migration chunk', 400);
    const chunk = parsed.data;
    // Match computeOpStorageBytes: the JSONB string payload is stored with its
    // JSON quoting bytes, so the reservation must use JSON bytes rather than
    // the raw base64 character count.
    const payloadBytes = chunk.operations.reduce((sum, operation) => sum + jsonBytes(operation.payload), 0);
    if (payloadBytes > VAULT_KEY_MIGRATION_MAX_CHUNK_BYTES) throw new VaultKeyMigrationError('chunk_too_large', 'migration chunk exceeds byte budget', 413);
    const fingerprint = requestFingerprint(chunk as unknown as VaultKeyMigrationRequest);
    const now = Date.now();

    return prisma.$transaction(async (tx) => {
      // A chunk does not need the sync-state lock, but it must serialize with
      // another chunk and with quota cleanup through the user row.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const migration = await this.findMigration(tx, userId, chunk.requestId);
      if (!migration) throw new VaultKeyMigrationError('key_package_not_found', 'migration manifest not found', 404);
      this.assertNotExpired(migration, now);
      if (migration.state !== 'STAGING') return stageResponseFromRow(migration);
      const existingChunk = await tx.vaultKeyMigrationChunk.findUnique({
        where: { migrationId_chunkIndex: { migrationId: migration.id, chunkIndex: chunk.chunkIndex } },
      });
      const existingChunkId = await tx.vaultKeyMigrationChunk.findUnique({
        where: { migrationId_chunkId: { migrationId: migration.id, chunkId: chunk.chunkId } },
      });
      if (existingChunk || existingChunkId) {
        const priorChunk = existingChunk ?? existingChunkId;
        if (priorChunk?.requestFingerprint !== fingerprint || priorChunk.chunkIndex !== chunk.chunkIndex) {
          throw new VaultKeyMigrationError('chunk_conflict', 'chunk identity was already used for different ciphertext', 409);
        }
        return stageResponseFromRow(migration);
      }
      if (payloadBytes + Number(migration.uploadedPayloadBytes) > Number(migration.expectedPayloadBytes) ||
          chunk.operations.length + migration.uploadedOperationCount > migration.expectedOperationCount) {
        throw new VaultKeyMigrationError('migration_coverage_mismatch', 'chunk exceeds manifest count or byte budget', 409);
      }

      const ids = chunk.operations.map((operation) => operation.id);
      if (new Set(ids).size !== ids.length) throw new VaultKeyMigrationError('migration_coverage_mismatch', 'chunk contains duplicate operation identity', 400);
      const rows = await tx.operation.findMany({ where: { userId, id: { in: ids } }, select: { id: true, serverSeq: true, vectorClock: true } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const staged = chunk.operations.map((operation) => {
        const row = byId.get(operation.id);
        if (!row || row.serverSeq !== operation.serverSeq) throw new VaultKeyMigrationError('migration_coverage_mismatch', 'chunk operation identity does not match retained history', 409);
        const envelope = inspectVaultPayloadGeneration(operation.payload);
        if (envelope.kind === 'legacy') throw new VaultKeyMigrationError('legacy_payload', 'migration replacements must use the vault envelope', 409);
        if (envelope.kind === 'invalid') throw new VaultKeyMigrationError('invalid_payload', envelope.reason, 400);
        if (envelope.keyVersion !== migration.targetPayloadKeyVersion) throw new VaultKeyMigrationError('wrong_payload_generation', 'migration payload generation does not match the target', 409);
        const bytes = jsonBytes(operation.payload);
        return {
          operation,
          payloadBytes: bytes,
          storageBytes: bytes + jsonBytes(row.vectorClock),
        };
      });
      const stagedChunk = await tx.vaultKeyMigrationChunk.create({
        data: {
          migrationId: migration.id,
          chunkId: chunk.chunkId,
          chunkIndex: chunk.chunkIndex,
          requestFingerprint: fingerprint,
          operationCount: staged.length,
          payloadBytes: BigInt(payloadBytes),
          createdAt: BigInt(now),
        },
      });
      try {
        await tx.vaultKeyMigrationOperation.createMany({
          data: staged.map(({ operation, payloadBytes: bytes, storageBytes }) => ({
            migrationId: migration.id,
            chunkId: stagedChunk.id,
            operationId: operation.id,
            serverSeq: operation.serverSeq,
            payload: operation.payload,
            payloadBytes: BigInt(bytes),
            storageBytes: BigInt(storageBytes),
            createdAt: BigInt(now),
          })),
        });
      } catch (error) {
        // A duplicate operation/server sequence across chunks is a deterministic
        // manifest error. Convert Prisma's unique violation into a retryable
        // coverage response instead of leaking a 500.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new VaultKeyMigrationError('migration_coverage_mismatch', 'operation identity was already staged in another chunk', 409);
        }
        throw error;
      }
      const updated = await tx.vaultKeyMigration.update({
        where: { id: migration.id },
        data: { uploadedOperationCount: { increment: staged.length }, uploadedPayloadBytes: { increment: BigInt(payloadBytes) } },
        select: migrationSelect,
      });
      return stageResponseFromRow(updated as unknown as MigrationManifestRow);
    }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** Publish all staged rows with one short indexed UPDATE transaction. */
  async commit(userId: number, requestId: string): Promise<VaultKeyMigrationStageResponse> {
    const now = Date.now();
    return prisma.$transaction(async (tx) => {
      const latestSeq = await this.lockUserAndSyncState(tx, userId);
      const migration = await this.findMigration(tx, userId, requestId);
      if (!migration) throw new VaultKeyMigrationError('key_package_not_found', 'migration manifest not found', 404);
      if (migration.state === 'PUBLISHED') return stageResponseFromRow(migration);
      this.assertNotExpired(migration, now);
      if (migration.state !== 'STAGING') throw new VaultKeyMigrationError('migration_not_ready', 'migration is not publishable', 409);
      if (latestSeq !== migration.expectedLatestSeq) throw new VaultKeyMigrationError('stale_latest_seq', 'operation history changed; rebuild the migration manifest', 409);
      if (migration.uploadedOperationCount !== migration.expectedOperationCount ||
          Number(migration.uploadedPayloadBytes) !== Number(migration.expectedPayloadBytes)) {
        throw new VaultKeyMigrationError('migration_not_ready', 'migration chunks are incomplete', 409);
      }

      const stagedCount = await tx.vaultKeyMigrationOperation.count({ where: { migrationId: migration.id } });
      const currentCount = await tx.operation.count({ where: { userId } });
      if (stagedCount !== migration.expectedOperationCount || currentCount !== migration.expectedOperationCount) {
        throw new VaultKeyMigrationError('migration_coverage_mismatch', 'staged manifest does not cover retained history', 409);
      }
      const missing = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM vault_key_migration_operations s
        LEFT JOIN operations o
          ON o.user_id = ${userId}
         AND o.id = s.operation_id
         AND o.server_seq = s.server_seq
        WHERE s.migration_id = ${migration.id}
          AND o.id IS NULL
      `;
      if (Number(missing[0]?.count ?? 0n) !== 0) {
        throw new VaultKeyMigrationError('migration_coverage_mismatch', 'staged operation identity does not match retained history', 409);
      }

      const deltaRows = await tx.$queryRaw<Array<{ delta: bigint }>>`
        SELECT COALESCE(SUM(s.storage_bytes - o.payload_bytes), 0)::bigint AS delta
        FROM vault_key_migration_operations s
        JOIN operations o
          ON o.user_id = ${userId}
         AND o.id = s.operation_id
         AND o.server_seq = s.server_seq
        WHERE s.migration_id = ${migration.id}
      `;
      const operationDelta = deltaRows[0]?.delta ?? 0n;
      const syncState = await tx.userSyncState.findUnique({ where: { userId }, select: { snapshotData: true } });
      const snapshotDelta = syncState?.snapshotData?.length ? -syncState.snapshotData.length : 0;

      const updated = await tx.$executeRaw`
        UPDATE operations AS o
        SET payload = s.payload,
            payload_bytes = s.storage_bytes,
            is_payload_encrypted = TRUE
        FROM vault_key_migration_operations AS s
        WHERE s.migration_id = ${migration.id}
          AND o.user_id = ${userId}
          AND o.id = s.operation_id
          AND o.server_seq = s.server_seq
      `;
      if (updated !== migration.expectedOperationCount) {
        throw new VaultKeyMigrationError('migration_coverage_mismatch', 'operation set changed during migration publish', 409);
      }
      if (syncState?.snapshotData) {
        await tx.userSyncState.update({
          where: { userId },
          data: { snapshotData: null, lastSnapshotSeq: null, snapshotAt: null, snapshotSchemaVersion: null },
        });
      }

      const totalDelta = operationDelta + BigInt(snapshotDelta);
      if (totalDelta !== 0n) {
        await tx.$executeRaw`
          UPDATE users
          SET storage_used_bytes = GREATEST(storage_used_bytes + ${totalDelta}::bigint, 0::bigint)
          WHERE id = ${userId}
        `;
      }
      // Wrapper-only rewraps use the same sync-state/user lock order as this
      // commit. Keep a database CAS as a second fence: if an older process or
      // an out-of-band writer changed the package despite the lock, never
      // overwrite that wrapper with the migration's stale target package.
      const currentPackage = await tx.vaultKeyPackage.findUnique({
        where: { userId },
        select: { keyVersion: true, packageData: true },
      });
      const currentPackageData = vaultKeyPackageSchema.safeParse(currentPackage?.packageData);
      if (!currentPackage || !currentPackageData.success ||
          currentPackage.keyVersion !== migration.expectedKeyVersion) {
        throw new VaultKeyMigrationError(
          'stale_key_version',
          'key package changed while the payload migration was staging',
          409,
        );
      }
      const packageUpdated = await tx.vaultKeyPackage.updateMany({
        where: {
          userId,
          keyVersion: migration.expectedKeyVersion,
          packageData: {
            path: ['rootKeyFingerprint'],
            equals: currentPackageData.data.rootKeyFingerprint,
          },
        },
        data: {
          keyVersion: migration.keyVersion,
          packageData: migration.packageData as Prisma.InputJsonValue,
          activePayloadKeyVersion: migration.targetPayloadKeyVersion,
        },
      });
      if (packageUpdated.count !== 1) {
        throw new VaultKeyMigrationError(
          'stale_key_version',
          'key package changed while the payload migration was staging',
          409,
        );
      }
      await tx.vaultKeyMigrationOperation.deleteMany({ where: { migrationId: migration.id } });
      await tx.vaultKeyMigrationChunk.deleteMany({ where: { migrationId: migration.id } });
      const published = await tx.vaultKeyMigration.update({
        where: { id: migration.id },
        data: {
          state: 'PUBLISHED',
          reservedStorageBytes: 0n,
          migratedOperationCount: migration.expectedOperationCount,
          latestSeq,
        },
        select: migrationSelect,
      });
      return stageResponseFromRow(published as unknown as MigrationManifestRow);
    }, { timeout: 300_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async status(userId: number, requestId: string): Promise<VaultKeyMigrationStageResponse> {
    const row = await prisma.vaultKeyMigration.findUnique({
      where: { userId_requestId: { userId, requestId } },
      select: migrationSelect,
    }) as MigrationManifestRow | null;
    if (!row) throw new VaultKeyMigrationError('key_package_not_found', 'migration manifest not found', 404);
    if (row.state === 'STAGING' && Number(row.expiresAt) <= Date.now()) {
      return { ...stageResponseFromRow(row), state: 'EXPIRED' };
    }
    return stageResponseFromRow(row);
  }

  async cancel(userId: number, requestId: string): Promise<VaultKeyMigrationStageResponse> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const migration = await this.findMigration(tx, userId, requestId);
      if (!migration) throw new VaultKeyMigrationError('key_package_not_found', 'migration manifest not found', 404);
      if (migration.state === 'PUBLISHED') throw new VaultKeyMigrationError('migration_not_ready', 'published migration cannot be cancelled', 409);
      if (migration.state !== 'STAGING') return stageResponseFromRow(migration);
      await tx.vaultKeyMigrationOperation.deleteMany({ where: { migrationId: migration.id } });
      await tx.vaultKeyMigrationChunk.deleteMany({ where: { migrationId: migration.id } });
      const cancelled = await tx.vaultKeyMigration.update({
        where: { id: migration.id },
        data: { state: 'CANCELLED', reservedStorageBytes: 0n, cancelledAt: BigInt(Date.now()) },
        select: migrationSelect,
      });
      return stageResponseFromRow(cancelled as unknown as MigrationManifestRow);
    }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  /** Bounded cleanup; expired reservations stop counting immediately and rows are deleted transactionally. */
  async cleanupExpired(limit = 100, now = Date.now()): Promise<number> {
    const candidates = await prisma.vaultKeyMigration.findMany({
      where: { state: 'STAGING', expiresAt: { lte: BigInt(now) } },
      select: { userId: true, requestId: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    let cleaned = 0;
    for (const candidate of candidates) {
      const didClean = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${candidate.userId} FOR UPDATE`;
        const migration = await this.findMigration(tx, candidate.userId, candidate.requestId);
        if (!migration || migration.state !== 'STAGING' || Number(migration.expiresAt) > now) return false;
        await tx.vaultKeyMigrationOperation.deleteMany({ where: { migrationId: migration.id } });
        await tx.vaultKeyMigrationChunk.deleteMany({ where: { migrationId: migration.id } });
        await tx.vaultKeyMigration.update({ where: { id: migration.id }, data: { state: 'EXPIRED', reservedStorageBytes: 0n } });
        return true;
      }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      if (didClean) cleaned += 1;
    }
    return cleaned;
  }

  async migrate(
    userId: number,
    input: VaultKeyMigrationRequest,
  ): Promise<VaultKeyMigrationResponse> {
    const parsed = vaultKeyMigrationRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new VaultKeyMigrationError('migration_coverage_mismatch', 'invalid key migration request', 400);
    }
    const request = parsed.data;
    const fingerprint = requestFingerprint(request);
    const now = BigInt(Date.now());

    return prisma.$transaction(async (tx) => {
      // The same row serializes uploads, clean-slate replacements, causal
      // repairs, and this migration. The sequence check is therefore a real
      // CAS rather than a read-then-write race.
      await tx.userSyncState.upsert({
        where: { userId },
        create: { userId, lastSeq: 0 },
        update: {},
      });
      const locked = await tx.$queryRaw<Array<{ lastSeq: number }>>`
        SELECT last_seq AS "lastSeq"
        FROM user_sync_state
        WHERE user_id = ${userId}
        FOR UPDATE
      `;
      const latestSeq = locked[0]?.lastSeq ?? 0;

      const prior = await tx.vaultKeyMigration.findUnique({
        where: { userId_requestId: { userId, requestId: request.requestId } },
      });
      if (prior) {
        if (prior.requestFingerprint !== fingerprint) {
          throw new VaultKeyMigrationError(
            'migration_request_reused',
            'migration requestId was already used for a different request',
            409,
          );
        }
        return responseFromRow(prior);
      }

      const currentPackage = await tx.vaultKeyPackage.findUnique({ where: { userId } });
      if (!currentPackage) {
        throw new VaultKeyMigrationError(
          'key_package_not_found',
          'a key package must exist before payload migration',
          404,
        );
      }
      const currentPackageData = vaultKeyPackageSchema.safeParse(currentPackage.packageData);
      if (!currentPackageData.success) {
        throw new VaultKeyMigrationError('key_package_not_found', 'stored key package is invalid', 409);
      }
      if (request.expectedKeyVersion !== currentPackage.keyVersion) {
        throw new VaultKeyMigrationError('stale_key_version', 'key package version changed', 409);
      }
      if (request.package.keyVersion !== request.expectedKeyVersion + 1) {
        throw new VaultKeyMigrationError(
          'stale_key_version',
          'atomic migration must advance the wrapper revision exactly once',
          409,
        );
      }
      const currentPayloadVersion = currentPackage.activePayloadKeyVersion ?? 0;
      if (request.targetPayloadKeyVersion !== currentPayloadVersion + 1) {
        throw new VaultKeyMigrationError(
          'wrong_payload_generation',
          'target payload generation must advance exactly one generation',
          409,
        );
      }
      if (request.expectedLatestSeq !== latestSeq) {
        throw new VaultKeyMigrationError(
          'stale_latest_seq',
          'operation history changed; re-read and rebuild the migration manifest',
          409,
        );
      }

      const rows = (await tx.operation.findMany({
        where: { userId },
        orderBy: { serverSeq: 'asc' },
        select: {
          id: true,
          serverSeq: true,
          payload: true,
          payloadBytes: true,
          vectorClock: true,
          isPayloadEncrypted: true,
        },
      })) as MigrationOperationRow[];

      if (rows.length !== request.operations.length) {
        throw new VaultKeyMigrationError(
          'migration_coverage_mismatch',
          'migration manifest does not cover the complete retained operation set',
          409,
        );
      }

      const byId = new Map<string, (typeof request.operations)[number]>();
      const bySeq = new Map<number, string>();
      for (const operation of request.operations) {
        if (byId.has(operation.id) || bySeq.has(operation.serverSeq)) {
          throw new VaultKeyMigrationError('migration_coverage_mismatch', 'manifest contains duplicate operation identity', 400);
        }
        byId.set(operation.id, operation);
        bySeq.set(operation.serverSeq, operation.id);
      }

      let storageDelta = 0;
      for (const row of rows) {
        const replacement = byId.get(row.id);
        if (!replacement || replacement.serverSeq !== row.serverSeq || bySeq.get(row.serverSeq) !== row.id) {
          throw new VaultKeyMigrationError(
            'migration_coverage_mismatch',
            'manifest operation identity does not match server history',
            409,
          );
        }
        if (!isEncryptedPayloadTransportShape(replacement.payload)) {
          throw new VaultKeyMigrationError('invalid_payload', 'migration contains an invalid ciphertext payload', 400);
        }
        const envelope = inspectVaultPayloadGeneration(replacement.payload);
        if (envelope.kind === 'legacy') {
          throw new VaultKeyMigrationError('legacy_payload', 'migration replacements must use the vault envelope', 409);
        }
        if (envelope.kind === 'invalid') {
          throw new VaultKeyMigrationError('invalid_payload', envelope.reason, 400);
        }
        if (envelope.keyVersion !== request.targetPayloadKeyVersion) {
          throw new VaultKeyMigrationError('wrong_payload_generation', 'migration payload generation does not match the target', 409);
        }

        const oldBytes = Number(row.payloadBytes) > 0
          ? Number(row.payloadBytes)
          : jsonBytes(row.payload) + jsonBytes(row.vectorClock);
        const newBytes = Buffer.byteLength(JSON.stringify(replacement.payload), 'utf8') + jsonBytes(row.vectorClock);
        storageDelta += newBytes - oldBytes;

        const updated = await tx.operation.updateMany({
          where: { userId, id: row.id, serverSeq: row.serverSeq },
          data: {
            payload: replacement.payload,
            payloadBytes: BigInt(newBytes),
            isPayloadEncrypted: true,
          },
        });
        if (updated.count !== 1) {
          throw new VaultKeyMigrationError('migration_coverage_mismatch', 'operation disappeared during migration', 409);
        }
      }

      // A cached plaintext snapshot is not part of the opaque operation
      // manifest and must never survive the generation cutover. Clearing its
      // bytes and metadata here keeps restore routes from serving old state.
      const syncState = await tx.userSyncState.findUnique({
        where: { userId },
        select: { snapshotData: true },
      });
      const snapshotDelta = syncState?.snapshotData?.length
        ? -syncState.snapshotData.length
        : 0;
      if (syncState?.snapshotData) {
        await tx.userSyncState.update({
          where: { userId },
          data: {
            snapshotData: null,
            lastSnapshotSeq: null,
            snapshotAt: null,
            snapshotSchemaVersion: null,
          },
        });
      }

      const totalDelta = storageDelta + snapshotDelta;
      if (totalDelta !== 0) {
        await tx.$executeRaw`
          UPDATE users
          SET storage_used_bytes = GREATEST(storage_used_bytes + ${BigInt(totalDelta)}::bigint, 0::bigint)
          WHERE id = ${userId}
        `;
      }

      await tx.vaultKeyPackage.update({
        where: { userId },
        data: {
          keyVersion: request.package.keyVersion,
          packageData: request.package as unknown as Prisma.InputJsonValue,
          activePayloadKeyVersion: request.targetPayloadKeyVersion,
          updatedAt: now,
        },
      });

      const migration = await tx.vaultKeyMigration.create({
        data: {
          userId,
          requestId: request.requestId,
          requestFingerprint: fingerprint,
          state: 'PUBLISHED',
          expectedKeyVersion: request.expectedKeyVersion,
          expectedLatestSeq: request.expectedLatestSeq,
          targetPayloadKeyVersion: request.targetPayloadKeyVersion,
          keyVersion: request.package.keyVersion,
          latestSeq,
          expectedOperationCount: rows.length,
          expectedPayloadBytes: BigInt(request.operations.reduce((sum, operation) => sum + jsonBytes(operation.payload), 0)),
          uploadedOperationCount: rows.length,
          uploadedPayloadBytes: BigInt(request.operations.reduce((sum, operation) => sum + jsonBytes(operation.payload), 0)),
          reservedStorageBytes: 0n,
          migratedOperationCount: rows.length,
          expiresAt: now,
          packageData: request.package as unknown as Prisma.InputJsonValue,
          createdAt: now,
        },
      });
      return responseFromRow(migration);
    }, {
      timeout: 120_000,
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
}

export const vaultKeyMigrationService = new VaultKeyMigrationService();
