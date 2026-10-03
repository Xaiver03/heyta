/** Real PostgreSQL proof for the all-operation atomic vault migration boundary. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { vaultKeyMigrationService } from '../../src/sync/services/vault-key-migration.service';
import { computeOpStorageBytes } from '../../src/sync/sync.const';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('atomic vault payload migration over HTTP/PostgreSQL', () => {
  const db = new PrismaClient();
  const app = Fastify();
  let userId: number;
  let authorization: string;
  let base: string;
  const packageFor = (keyVersion: number) => ({
    version: 1,
    keyVersion,
    rootKeyFingerprint: 'a'.repeat(64),
    passphrase: { kdf: 'argon2id', salt: Buffer.alloc(16, 1).toString('base64'), iv: Buffer.alloc(12, 2).toString('base64'), ciphertext: Buffer.alloc(48, 3).toString('base64') },
    recovery: { kdf: 'argon2id', salt: Buffer.alloc(16, 4).toString('base64'), iv: Buffer.alloc(12, 5).toString('base64'), ciphertext: Buffer.alloc(48, 6).toString('base64') },
  });
  const vaultPayload = (generation: number): string => {
    const magic = Buffer.from('heyta-vault-op/', 'ascii');
    const bytes = Buffer.alloc(magic.length + 1 + 8 + 29);
    magic.copy(bytes);
    bytes.writeUInt8(1, magic.length);
    bytes.writeDoubleBE(generation, magic.length + 1);
    return bytes.toString('base64');
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'vault-key-migration-http-integration-secret-32';
    const { initSyncService } = await import('../../src/sync/sync.service');
    const { syncRoutes } = await import('../../src/sync/sync.routes');
    initSyncService();
    const user = await db.user.create({
      data: { email: `vault-migration-${randomUUID()}@test.local`, isVerified: 1 },
    });
    userId = user.id;
    authorization = `Bearer ${jwt.sign({ userId, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET!)}`;
    await db.userSyncState.create({
      data: { userId, lastSeq: 2, snapshotData: Buffer.from('legacy-snapshot'), lastSnapshotSeq: 2 },
    });
    await db.vaultKeyPackage.create({
      data: { userId, keyVersion: 1, packageData: packageFor(1), createdAt: 1n, updatedAt: 1n },
    });
    for (const [id, seq] of [['migration-op-a', 1], ['migration-op-b', 2]] as const) {
      await db.operation.create({
        data: {
          id, userId, clientId: 'client-a', serverSeq: seq,
          actionType: 'UPDATE', opType: 'UPD', entityType: 'TASK', entityId: id,
          entityIds: [], payload: Buffer.alloc(28, 9).toString('base64'), payloadBytes: 100n,
          vectorClock: { 'client-a': seq }, schemaVersion: 1,
          clientTimestamp: BigInt(seq), receivedAt: BigInt(seq), isPayloadEncrypted: true,
        },
      });
    }
    await app.register(syncRoutes, { prefix: '/api/sync' });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  }, 30000);

  afterAll(async () => {
    await app.close();
    if (userId !== undefined) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });

  it('commits the complete replacement and returns a durable idempotent result', async () => {
    const body = {
      requestId: 'atomic-migration-http-1',
      expectedKeyVersion: 1,
      expectedLatestSeq: 2,
      targetPayloadKeyVersion: 1,
      package: packageFor(2),
      operations: [1, 2].map((serverSeq) => ({
        id: serverSeq === 1 ? 'migration-op-a' : 'migration-op-b',
        serverSeq,
        payload: vaultPayload(1),
      })),
    };
    const first = await fetch(`${base}/api/sync/key-migration`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).migratedOperationCount).toBe(2);

    const retry = await fetch(`${base}/api/sync/key-migration`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(retry.status).toBe(200);

    const rows = await db.operation.findMany({ where: { userId }, orderBy: { serverSeq: 'asc' } });
    expect(rows.every((row) => row.payload === vaultPayload(1))).toBe(true);
    const pkg = await db.vaultKeyPackage.findUniqueOrThrow({ where: { userId } });
    expect(pkg.keyVersion).toBe(2);
    expect(pkg.activePayloadKeyVersion).toBe(1);
    expect((await db.userSyncState.findUniqueOrThrow({ where: { userId } })).snapshotData).toBeNull();

    const staleUpload = await fetch(`${base}/api/sync/ops`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-a',
        lastKnownServerSeq: 2,
        ops: [{
          id: 'post-migration-legacy-op', clientId: 'client-a', actionType: 'UPDATE',
          opType: 'UPD', entityType: 'TASK', entityId: 'post-migration-legacy-op',
          payload: Buffer.alloc(28, 7).toString('base64'), vectorClock: { 'client-a': 3 },
          timestamp: Date.now(), schemaVersion: 1, isPayloadEncrypted: true,
        }],
      }),
    });
    expect(staleUpload.status).toBe(200);
    const staleBody = await staleUpload.json() as { results: Array<{ accepted: boolean; errorCode?: string }> };
    expect(staleBody.results[0]?.accepted).toBe(false);
    expect(staleBody.results[0]?.errorCode).toBe('E2EE_REQUIRED');
  }, 30000);

  it('serves a migration-only complete retained inventory with a signed bound cursor', async () => {
    const first = await fetch(`${base}/api/sync/key-migration/inventory?limit=1`, { headers: { authorization } });
    expect(first.status).toBe(200);
    const page = await first.json() as {
      operations: Array<{ id: string; serverSeq: number; payload: string; causalFullState: boolean }>;
      latestSeq: number;
      retainedFromSeq: number;
      complete: boolean;
      nextCursor?: string;
      snapshot: { present: boolean };
    };
    expect(page.operations).toHaveLength(1);
    expect(page.operations[0]?.payload).toBeTruthy();
    expect(page.latestSeq).toBe(2);
    expect(page.retainedFromSeq).toBe(1);
    expect(page.snapshot.present).toBe(false);
    expect(page.complete).toBe(false);
    expect(page.nextCursor).toMatch(/^vmi1\./);

    const second = await fetch(`${base}/api/sync/key-migration/inventory?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`, { headers: { authorization } });
    expect(second.status).toBe(200);
    const tail = await second.json() as typeof page;
    expect(tail.operations.map((operation) => operation.serverSeq)).toEqual([2]);
    expect(tail.complete).toBe(true);
    expect(tail.nextCursor).toBeUndefined();

    const tampered = await fetch(`${base}/api/sync/key-migration/inventory?cursor=${encodeURIComponent(`${page.nextCursor}x`)}`, { headers: { authorization } });
    expect(tampered.status).toBe(400);
    expect((await tampered.json()).error).toBe('migration_coverage_mismatch');
  }, 30000);

  it('rejects an incomplete manifest without changing the published generation', async () => {
    const response = await fetch(`${base}/api/sync/key-migration`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'atomic-migration-http-incomplete',
        expectedKeyVersion: 2,
        expectedLatestSeq: 2,
        targetPayloadKeyVersion: 2,
        package: packageFor(3),
        operations: [{ id: 'migration-op-a', serverSeq: 1, payload: vaultPayload(2) }],
      }),
    });
    expect(response.status).toBe(409);
    expect((await db.vaultKeyPackage.findUniqueOrThrow({ where: { userId } })).activePayloadKeyVersion).toBe(1);
  }, 30000);

  it('stages bounded chunks, tolerates retries/concurrency, and publishes atomically', async () => {
    const manifest = {
      requestId: 'staged-migration-http-1',
      expectedKeyVersion: 2,
      expectedLatestSeq: 2,
      targetPayloadKeyVersion: 2,
      package: packageFor(3),
      expectedOperationCount: 2,
      expectedPayloadBytes: Buffer.byteLength(JSON.stringify(vaultPayload(2)), 'utf8') * 2,
    };
    const started = await fetch(`${base}/api/sync/key-migration`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(manifest),
    });
    expect(started.status).toBe(200);
    expect((await started.json()).state).toBe('STAGING');

    // The staging manifest owns this replacement budget. A normal ops upload
    // arriving while it is active must see the reservation in the same quota
    // decision and be rejected before its operation transaction can commit.
    const beforeReservationUpload = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { storageUsedBytes: true },
    });
    await db.user.update({
      where: { id: userId },
      data: { storageQuotaBytes: beforeReservationUpload.storageUsedBytes + BigInt(manifest.expectedPayloadBytes) },
    });
    const competingUpload = await fetch(`${base}/api/sync/ops`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-a',
        lastKnownServerSeq: 2,
        ops: [{
          id: 'reservation-competing-upload',
          clientId: 'client-a',
          actionType: 'UPDATE',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 'reservation-competing-upload',
          payload: vaultPayload(2),
          vectorClock: { 'client-a': 3 },
          timestamp: Date.now(),
          schemaVersion: 1,
          isPayloadEncrypted: true,
        }],
      }),
    });
    expect(competingUpload.status).toBe(413);
    expect((await competingUpload.json()).errorCode).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(await db.operation.findUnique({ where: { id: 'reservation-competing-upload' } })).toBeNull();
    // Let the staged migration finish under the normal account quota.
    await db.user.update({
      where: { id: userId },
      data: { storageQuotaBytes: 100n * 1024n * 1024n },
    });

    const sendChunk = (index: number, id: string) => fetch(`${base}/api/sync/key-migration/${manifest.requestId}/chunks`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: manifest.requestId,
        chunkId: `chunk-${index}`,
        chunkIndex: index,
        operations: [{ id, serverSeq: index + 1, payload: vaultPayload(2) }],
      }),
    });
    const [chunkA, chunkB] = await Promise.all([
      sendChunk(0, 'migration-op-a'),
      sendChunk(1, 'migration-op-b'),
    ]);
    expect(chunkA.status).toBe(200);
    expect(chunkB.status).toBe(200);
    const retry = await sendChunk(0, 'migration-op-a');
    expect(retry.status).toBe(200);
    expect((await retry.json()).uploadedOperationCount).toBe(2);

    const status = await fetch(`${base}/api/sync/key-migration/${manifest.requestId}`, { headers: { authorization } });
    expect((await status.json()).uploadedOperationCount).toBe(2);
    const committed = await fetch(`${base}/api/sync/key-migration/${manifest.requestId}/commit`, {
      method: 'POST', headers: { authorization },
    });
    expect(committed.status).toBe(200);
    expect((await committed.json()).state).toBe('PUBLISHED');
    expect((await db.vaultKeyPackage.findUniqueOrThrow({ where: { userId } })).activePayloadKeyVersion).toBe(2);
    const rows = await db.operation.findMany({ where: { userId }, orderBy: { serverSeq: 'asc' } });
    expect(rows.every((row) => row.payload === vaultPayload(2))).toBe(true);
  }, 30000);

  it('releases an expired reservation and rejects quota reservations atomically', async () => {
    const manifest = {
      requestId: 'staged-migration-expiry',
      expectedKeyVersion: 3,
      expectedLatestSeq: 2,
      targetPayloadKeyVersion: 3,
      package: packageFor(4),
      expectedOperationCount: 2,
      expectedPayloadBytes: Buffer.byteLength(JSON.stringify(vaultPayload(3)), 'utf8') * 2,
    };
    const started = await fetch(`${base}/api/sync/key-migration`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(manifest),
    });
    expect(started.status).toBe(200);
    const staging = await db.vaultKeyMigration.findUniqueOrThrow({ where: { userId_requestId: { userId, requestId: manifest.requestId } } });
    expect(staging.reservedStorageBytes).toBe(BigInt(manifest.expectedPayloadBytes));
    await db.vaultKeyMigration.update({ where: { id: staging.id }, data: { expiresAt: BigInt(Date.now() - 1) } });
    expect(await vaultKeyMigrationService.cleanupExpired(10)).toBe(1);
    const expired = await db.vaultKeyMigration.findUniqueOrThrow({ where: { id: staging.id } });
    expect(expired.state).toBe('EXPIRED');
    expect(expired.reservedStorageBytes).toBe(0n);

    const used = (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { storageUsedBytes: true } })).storageUsedBytes;
    await db.user.update({ where: { id: userId }, data: { storageQuotaBytes: used } });
    const denied = await fetch(`${base}/api/sync/key-migration`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ ...manifest, requestId: 'staged-migration-over-quota', expectedPayloadBytes: 1 }),
    });
    expect(denied.status).toBe(409);
    expect((await denied.json()).error).toBe('migration_quota_exceeded');
    await db.user.update({ where: { id: userId }, data: { storageQuotaBytes: 100n * 1024n * 1024n } });

    const rollbackManifest = {
      requestId: 'staged-migration-rollback',
      expectedKeyVersion: 3,
      expectedLatestSeq: 2,
      targetPayloadKeyVersion: 3,
      package: packageFor(4),
      expectedOperationCount: 2,
      expectedPayloadBytes: Buffer.byteLength(JSON.stringify(vaultPayload(3)), 'utf8') * 2,
    };
    const rollbackStart = await fetch(`${base}/api/sync/key-migration`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(rollbackManifest),
    });
    expect(rollbackStart.status).toBe(200);
    const rollbackChunk = await fetch(`${base}/api/sync/key-migration/${rollbackManifest.requestId}/chunks`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: rollbackManifest.requestId, chunkId: 'rollback-0', chunkIndex: 0, operations: [
        { id: 'migration-op-a', serverSeq: 1, payload: vaultPayload(3) },
        { id: 'migration-op-b', serverSeq: 2, payload: vaultPayload(3) },
      ] }),
    });
    expect(rollbackChunk.status).toBe(200);
    const before = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { storageUsedBytes: true } });
    await db.operation.delete({ where: { id: 'migration-op-b' } });
    const rollbackCommit = await fetch(`${base}/api/sync/key-migration/${rollbackManifest.requestId}/commit`, {
      method: 'POST', headers: { authorization },
    });
    expect(rollbackCommit.status).toBe(409);
    const after = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { storageUsedBytes: true } });
    expect(after.storageUsedBytes).toBe(before.storageUsedBytes);
    expect((await db.vaultKeyPackage.findUniqueOrThrow({ where: { userId } })).activePayloadKeyVersion).toBe(2);
    const cancelled = await fetch(`${base}/api/sync/key-migration/${rollbackManifest.requestId}`, {
      method: 'DELETE', headers: { authorization },
    });
    expect(cancelled.status).toBe(200);
  }, 30000);

  it('rechecks a reservation created after the preflight quota read before committing an upload', async () => {
    const user = await db.user.create({ data: { email: `vault-quota-race-${randomUUID()}@test.local`, isVerified: 1 } });
    const raceUserId = user.id;
    const raceAuthorization = `Bearer ${jwt.sign({ userId: raceUserId, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET!)}`;
    const payload = vaultPayload(1);
    const vectorClock = { 'race-client': 1 };
    const delta = computeOpStorageBytes({ payload, vectorClock }).bytes;
    const advisoryKey = 834729183n;
    const triggerName = 'heyta_test_quota_race_trigger';
    const functionName = 'heyta_test_quota_race_sleep';

    try {
      await db.userSyncState.create({ data: { userId: raceUserId, lastSeq: 0 } });
      await db.vaultKeyMigration.create({ data: {
        userId: raceUserId,
        requestId: 'quota-race-reservation',
        requestFingerprint: 'quota-race-fingerprint',
        state: 'STAGING',
        expectedKeyVersion: 1,
        expectedLatestSeq: 0,
        targetPayloadKeyVersion: 1,
        keyVersion: 2,
        latestSeq: 0,
        expectedOperationCount: 0,
        expectedPayloadBytes: 0n,
        reservedStorageBytes: 0n,
        expiresAt: BigInt(Date.now() + 60_000),
        packageData: packageFor(2),
        createdAt: BigInt(Date.now()),
      } });
      await db.user.update({ where: { id: raceUserId }, data: { storageQuotaBytes: BigInt(delta), storageUsedBytes: 0n } });
      await db.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          IF NEW.id = 'quota-race-operation' THEN
            PERFORM pg_advisory_lock(${advisoryKey.toString()});
            PERFORM pg_sleep(0.5);
            PERFORM pg_advisory_unlock(${advisoryKey.toString()});
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await db.$executeRawUnsafe(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON operations
        FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `);

      const upload = fetch(`${base}/api/sync/ops`, {
        method: 'POST',
        headers: { authorization: raceAuthorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'race-client',
          ops: [{
            id: 'quota-race-operation',
            clientId: 'race-client',
            actionType: 'UPD_TASK',
            opType: 'UPD',
            entityType: 'TASK',
            entityId: 'quota-race-task',
            payload,
            vectorClock,
            timestamp: Date.now(),
            schemaVersion: 1,
            isPayloadEncrypted: true,
          }],
        }),
      });

      let triggerObserved = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const probe = await db.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_lock(${advisoryKey}) AS locked`;
        if (probe[0]?.locked === false) {
          triggerObserved = true;
          break;
        }
        if (probe[0]?.locked === true) {
          await db.$queryRaw`SELECT pg_advisory_unlock(${advisoryKey})`;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(triggerObserved).toBe(true);

      await db.vaultKeyMigration.update({
        where: { userId_requestId: { userId: raceUserId, requestId: 'quota-race-reservation' } },
        data: { reservedStorageBytes: 1n },
      });
      const response = await upload;
      expect(response.status).toBe(200);
      const body = await response.json() as { results: Array<{ accepted: boolean; errorCode?: string }> };
      expect(body.results[0]).toMatchObject({ accepted: false, errorCode: 'STORAGE_QUOTA_EXCEEDED' });
      expect(await db.operation.findUnique({ where: { id: 'quota-race-operation' } })).toBeNull();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON operations`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await db.user.delete({ where: { id: raceUserId } });
    }
  }, 30000);
});
