/** Real PostgreSQL + HTTP proof for the production app-host migration planner. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { encrypt, decodeBase64 } from '@heyta/sync-core';
import { createVaultPayloadCipher } from '@heyta/sync-client';
import { createSyncClient } from '@heyta/app-host';
import { OpLogEngine, serializeMaterializedState } from '../../../packages/op-log/dist/index.js';
import {
  createVaultKeyMigrationRemote,
  createVaultMigrationInventorySource,
  createVaultMigrationJournal,
  migrateVaultPayloads,
  type VaultKeyMigrationRemote,
} from '@heyta/app-host';
import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('client vault migration planner over real HTTP/PostgreSQL', () => {
  const db = new PrismaClient();
  const app = Fastify();
  let userId: number;
  let authorization: string;
  let base: string;
  const oldPassword = 'legacy-e2ee-passphrase';
  const oldRoot = new Uint8Array(32).fill(31);
  const newRoot = new Uint8Array(32).fill(47);
  const packageFor = (keyVersion: number) => ({
    version: 1 as const,
    keyVersion,
    rootKeyFingerprint: 'a'.repeat(64),
    passphrase: { kdf: 'argon2id' as const, salt: Buffer.alloc(16, keyVersion).toString('base64'), iv: Buffer.alloc(12, keyVersion).toString('base64'), ciphertext: Buffer.alloc(48, keyVersion).toString('base64') },
    recovery: { kdf: 'argon2id' as const, salt: Buffer.alloc(16, keyVersion + 1).toString('base64'), iv: Buffer.alloc(12, keyVersion + 1).toString('base64'), ciphertext: Buffer.alloc(48, keyVersion + 1).toString('base64') },
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'vault-key-migration-client-integration-secret-32';
    const { initSyncService } = await import('../../src/sync/sync.service');
    const { syncRoutes } = await import('../../src/sync/sync.routes');
    initSyncService();
    const user = await db.user.create({ data: { email: `vault-client-${randomUUID()}@test.local`, isVerified: 1 } });
    userId = user.id;
    authorization = `Bearer ${jwt.sign({ userId, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET!)}`;
    // Simulate a retained server snapshot. The first retained causal full-state
    // operation is the only boundary that makes clearing this cache safe.
    await db.userSyncState.create({
      data: { userId, lastSeq: 3, snapshotData: Buffer.from('legacy-snapshot'), lastSnapshotSeq: 1 },
    });
    await db.vaultKeyPackage.create({ data: { userId, keyVersion: 1, packageData: packageFor(1), createdAt: 1n, updatedAt: 1n } });
    for (const seq of [1, 2, 3]) {
      const id = `client-migration-op-${seq}`;
      const opType = seq === 1 ? 'SYNC_IMPORT' : 'UPD';
      const identity = { id, clientId: 'legacy-device', actionType: 'UPDATE', opType, entityType: 'TASK', entityId: id, timestamp: seq, schemaVersion: 1 };
      const payload = await encrypt(JSON.stringify({ title: `task-${seq}` }), oldPassword);
      await db.operation.create({
        data: {
          id, userId, clientId: 'legacy-device', serverSeq: seq, actionType: 'UPDATE', opType, entityType: 'TASK', entityId: id,
          entityIds: [], payload, payloadBytes: BigInt(Buffer.byteLength(JSON.stringify(payload), 'utf8')),
          vectorClock: { 'legacy-device': seq }, schemaVersion: 1, clientTimestamp: BigInt(seq), receivedAt: BigInt(seq), isPayloadEncrypted: true,
        },
      });
      void identity;
    }
    await app.register(syncRoutes, { prefix: '/api/sync' });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  }, 30000);

  afterAll(async () => {
    await app.close();
    if (userId !== undefined) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });

  it('exposes a retained causal replay base when a snapshot cache is present', async () => {
    const inventoryResponse = await fetch(`${base}/api/sync/key-migration/inventory`, { headers: { authorization } });
    expect(inventoryResponse.status).toBe(200);
    const page = await inventoryResponse.json() as {
      operations: Array<{ serverSeq: number; causalFullState: boolean }>;
      snapshot: { present: boolean; lastSnapshotSeq?: number; replayBaseServerSeq?: number };
    };
    expect(page.operations[0]).toMatchObject({ serverSeq: 1, causalFullState: true });
    expect(page.snapshot).toMatchObject({ present: true, lastSnapshotSeq: 1, replayBaseServerSeq: 1 });
  }, 30000);

  it('plans legacy password ciphertexts from complete HTTP inventory and atomically publishes new root ciphertext', async () => {
    const transport = { baseUrl: base, getToken: async () => authorization.slice('Bearer '.length) };
    const remote = createVaultKeyMigrationRemote(transport);
    const inventory = createVaultMigrationInventorySource(transport);
    const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await adapter.init();
    const journal = createVaultMigrationJournal(adapter);
    const result = await migrateVaultPayloads({
      inventory, remote, journal, journalScope: `scope-${userId}`,
      package: packageFor(2), expectedKeyVersion: 1, currentPayloadKeyVersion: null, targetPayloadKeyVersion: 1,
      currentRootKey: oldRoot, targetRootKey: newRoot, legacyPassword: oldPassword,
      requestId: 'client-planner-publish-1', maxChunkPayloadBytes: 1024,
    });
    expect(result.migratedOperationCount).toBe(3);
    expect((await db.userSyncState.findUniqueOrThrow({ where: { userId } })).snapshotData).toBeNull();
    const rows = await db.operation.findMany({ where: { userId }, orderBy: { serverSeq: 'asc' } });
    const cipher = createVaultPayloadCipher({ current: { keyVersion: 1, rootKey: newRoot } });
    for (const row of rows) {
      const identity = { id: row.id, clientId: row.clientId, actionType: row.actionType, opType: row.opType, entityType: row.entityType, entityId: row.entityId ?? undefined, entityIds: row.entityIds, timestamp: Number(row.clientTimestamp), schemaVersion: row.schemaVersion };
      expect(await cipher.decrypt(row.payload as string, identity)).toContain('task-');
      expect(Buffer.from(decodeBase64(row.payload as string)).subarray(0, 'heyta-vault-op/'.length).toString('ascii')).toBe('heyta-vault-op/');
    }
  }, 30000);

  it('recovers a response lost on chunk N across fresh planner instances using the ciphertext journal', async () => {
    const transport = { baseUrl: base, getToken: async () => authorization.slice('Bearer '.length) };
    const rawRemote = createVaultKeyMigrationRemote(transport);
    const inventory = createVaultMigrationInventorySource(transport);
    const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await adapter.init();
    const journal = createVaultMigrationJournal(adapter);
    let lost = false;
    const interruptedRemote: VaultKeyMigrationRemote = {
      ...rawRemote,
      async uploadChunk(chunk) {
        const response = await rawRemote.uploadChunk(chunk);
        if (!lost && chunk.chunkIndex === 1) { lost = true; throw new Error('chunk N response lost'); }
        return response;
      },
    };
    const options = {
      inventory, remote: interruptedRemote, journal, journalScope: `scope-${userId}`,
      package: packageFor(3), expectedKeyVersion: 2, currentPayloadKeyVersion: 1, targetPayloadKeyVersion: 2,
      currentRootKey: newRoot, targetRootKey: new Uint8Array(32).fill(63),
      requestId: 'client-planner-resume-1', maxChunkPayloadBytes: 200,
    } as const;
    await expect(migrateVaultPayloads(options)).rejects.toThrow('chunk N response lost');
    const secondJournal = createVaultMigrationJournal(adapter);
    const result = await migrateVaultPayloads({ ...options, remote: rawRemote, journal: secondJournal });
    expect(result.migratedOperationCount).toBe(3);
    await expect(secondJournal.load(`scope-${userId}`, 'client-planner-resume-1')).resolves.toBeUndefined();
  }, 30000);

  it('re-encrypts a real causal full-state base and tail so a fresh HTTP client rebuilds the same state', async () => {
    const user = await db.user.create({ data: { email: `vault-client-rebuild-${randomUUID()}@test.local`, isVerified: 1 } });
    const rebuildUserId = user.id;
    const rebuildAuthorization = `Bearer ${jwt.sign({ userId: rebuildUserId, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET!)}`;
    const sourceAdapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await sourceAdapter.init();
    const sourceStore = new DbOpLogStore(sourceAdapter);
    let sourceId = 0;
    const source = new OpLogEngine({
      store: sourceStore,
      clientId: 'rebuild-source',
      now: () => 10,
      nextOpId: () => `rebuild-${++sourceId}`,
    });
    await source.dispatch({ entityType: 'TASK', entityId: 'task-rebuild', opType: 'UPD', payload: { title: 'from full state', priority: 1 } });
    const first = (await source.getPendingUpload())[0]!;
    await source.markUploaded(new Map([[first.id, 1]]));
    // The prefix before the retained maintenance op has already been drained.
    await sourceStore.setLastServerSeq(2);
    const checkpoint = (await source.createSyncCheckpoint()).ops[0]!;
    await source.markUploaded(new Map([[checkpoint.id, 3]]));
    const tail = (await source.dispatch({ entityType: 'TASK', entityId: 'task-rebuild', opType: 'UPD', payload: { priority: 7 } })).ops[0]!;
    expect(checkpoint).toMatchObject({ opType: 'REPAIR', entityType: 'ALL', payload: { repairBaseServerSeq: 2 } });

    const persistedOperations = [
      { op: checkpoint, serverSeq: 3 },
      { op: tail, serverSeq: 4 },
    ];
    await db.userSyncState.create({ data: {
      userId: rebuildUserId,
      lastSeq: 4,
      snapshotData: Buffer.from(JSON.stringify(checkpoint.payload)),
      lastSnapshotSeq: 3,
    } });
    await db.vaultKeyPackage.create({ data: { userId: rebuildUserId, keyVersion: 1, packageData: packageFor(1), createdAt: 1n, updatedAt: 1n } });
    for (const { op, serverSeq } of persistedOperations) {
      const identity = {
        id: op.id,
        clientId: op.clientId,
        actionType: op.actionType,
        opType: op.opType,
        entityType: op.entityType,
        entityId: op.entityId,
        entityIds: op.entityIds,
        timestamp: op.timestamp,
        schemaVersion: op.schemaVersion,
      };
      const payload = await encrypt(JSON.stringify(op.payload), oldPassword);
      await db.operation.create({ data: {
        id: op.id,
        userId: rebuildUserId,
        clientId: op.clientId,
        serverSeq,
        actionType: op.actionType,
        opType: op.opType,
        entityType: op.entityType,
        entityId: op.entityId,
        entityIds: op.entityIds ?? [],
        payload,
        payloadBytes: BigInt(Buffer.byteLength(JSON.stringify(payload), 'utf8')),
        vectorClock: op.vectorClock,
        schemaVersion: op.schemaVersion,
        clientTimestamp: BigInt(op.timestamp),
        receivedAt: BigInt(op.timestamp),
        isPayloadEncrypted: true,
        repairBaseServerSeq: op.opType === 'REPAIR' && typeof op.payload === 'object' && op.payload !== null &&
          'repairBaseServerSeq' in op.payload && typeof op.payload.repairBaseServerSeq === 'number'
          ? op.payload.repairBaseServerSeq : null,
      } });
      void identity;
    }

    try {
      const transport = { baseUrl: base, getToken: async () => rebuildAuthorization.slice('Bearer '.length) };
      const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
      await adapter.init();
      const journal = createVaultMigrationJournal(adapter);
      const result = await migrateVaultPayloads({
        inventory: createVaultMigrationInventorySource(transport),
        remote: createVaultKeyMigrationRemote(transport),
        journal,
        journalScope: `scope-${rebuildUserId}`,
        package: packageFor(2),
        expectedKeyVersion: 1,
        expectedLatestSeq: 4,
        currentPayloadKeyVersion: null,
        targetPayloadKeyVersion: 1,
        currentRootKey: oldRoot,
        targetRootKey: newRoot,
        legacyPassword: oldPassword,
        requestId: 'client-planner-rebuild-1',
        maxChunkPayloadBytes: 64 * 1024,
      });
      expect(result.migratedOperationCount).toBe(2);
      expect((await db.userSyncState.findUniqueOrThrow({ where: { userId: rebuildUserId } })).snapshotData).toBeNull();

      const targetAdapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
      await targetAdapter.init();
      const targetStore = new DbOpLogStore(targetAdapter);
      const target = new OpLogEngine({ store: targetStore, clientId: 'rebuild-target', now: () => 11 });
      const targetCipher = createVaultPayloadCipher({ current: { keyVersion: 1, rootKey: newRoot } });
      const migratedRows = await db.operation.findMany({ where: { userId: rebuildUserId }, orderBy: { serverSeq: 'asc' } });
      for (const row of migratedRows) {
        const identity = {
          id: row.id,
          clientId: row.clientId,
          actionType: row.actionType,
          opType: row.opType,
          entityType: row.entityType,
          entityId: row.entityId ?? undefined,
          entityIds: row.entityIds,
          timestamp: Number(row.clientTimestamp),
          schemaVersion: row.schemaVersion,
        };
        await expect(targetCipher.decrypt(row.payload as string, identity)).resolves.toBeTruthy();
      }
      const rawDownload = await fetch(`${base}/api/sync/ops?sinceSeq=0&limit=500`, { headers: { authorization: rebuildAuthorization } });
      const rawDownloadBody = await rawDownload.json() as { ops?: Array<{ serverSeq: number; op: Record<string, unknown> }> };
      for (const envelope of rawDownloadBody.ops ?? []) {
        const op = envelope.op;
        const identity = {
          id: op.id as string,
          clientId: op.clientId as string,
          actionType: op.actionType as string,
          opType: op.opType as string,
          entityType: op.entityType as string,
          entityId: op.entityId as string | undefined,
          entityIds: op.entityIds as string[] | undefined,
          timestamp: op.timestamp as number,
          schemaVersion: op.schemaVersion as number,
        };
        try {
          await targetCipher.decrypt(op.payload as string, identity);
        } catch (error) {
          throw new Error(
            `download decrypt failed seq=${String(envelope.serverSeq)} ` +
            `identity=${JSON.stringify(identity)} cause=${String(error)}`,
          );
        }
      }
      const client = createSyncClient({
        engine: target,
        store: targetStore,
        baseUrl: base,
        getToken: async () => rebuildAuthorization.slice('Bearer '.length),
        getPassword: async () => undefined,
        encryptionMode: 'vault',
        getPayloadCipher: async () => targetCipher,
        applyRemote: async (ops) => { await target.applyRemote(ops); },
      });
      const syncStatus = await client.sync();
      expect(syncStatus, JSON.stringify(syncStatus)).toMatchObject({ kind: 'synced' });
      expect(serializeMaterializedState(target.getState())).toEqual(serializeMaterializedState(source.getState()));
      expect(target.getState().tasks['task-rebuild']).toMatchObject({ title: 'from full state', priority: 7 });
    } finally {
      await db.user.delete({ where: { id: rebuildUserId } });
      sourceAdapter.close();
    }
  }, 30000);
});
