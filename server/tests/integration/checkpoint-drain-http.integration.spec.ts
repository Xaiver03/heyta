/** D end-to-end: production cleanup really deletes the prefix in PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { OpLogEngine } from '../../../packages/op-log/dist/index.js';
import { DbOpLogStore, MemoryDbAdapter, INDEXEDDB_SCHEMA } from '../../../packages/storage/dist/index.js';
import { createSyncClient } from '../../../packages/app-host/dist/index.js';
import { OpType } from '@heyta/sync-core';

// The runner supplies a disposable database. No global/mock Prisma setup.
describe.skipIf(!process.env.DATABASE_URL)('checkpoint → real drain → fresh client', () => {
  const db = new PrismaClient();
  const app = Fastify();
  const priorSecret = process.env.JWT_SECRET;
  let userId: number;
  let token: string;
  let baseUrl: string;
  const adapters: MemoryDbAdapter[] = [];
  const postBodies: Array<{ url: string; body: string }> = [];
  beforeAll(async () => {
    process.env.JWT_SECRET = 'checkpoint-drain-isolated-integration-secret-32';
    const { initSyncService } = await import('../../src/sync/sync.service');
    const { syncRoutes } = await import('../../src/sync/sync.routes');
    initSyncService();
    const user = await db.user.create({ data: { email: `drain-${randomUUID()}@test.local`, isVerified: 1 } });
    userId = user.id;
    token = jwt.sign({ userId, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET);
    await app.register(syncRoutes, { prefix: '/api/sync' });
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });
  afterAll(async () => {
    for (const adapter of adapters) adapter.close();
    await app.close();
    if (userId !== undefined) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
    const { disconnectDb } = await import('../../src/db');
    await disconnectDb();
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  });
  const device = async (clientId: string) => {
    const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await adapter.init(); adapters.push(adapter);
    const store = new DbOpLogStore(adapter);
    const engine = new OpLogEngine({ store, clientId, nextOpId: randomUUID });
    const client = createSyncClient({ engine, store, baseUrl,
      getToken: async () => token, getPassword: async () => 'checkpoint-drain-test-password',
      applyRemote: async (ops) => { await engine.applyRemote(ops); },
      fetchImpl: async (url, init) => {
        if (init?.method === 'POST') postBodies.push({ url: String(url), body: String(init.body) });
        return fetch(url, init);
      },
    });
    return { engine, store, client };
  };
  const edit = (entityId: string, payload: unknown) => ({ entityType: 'TASK' as const, entityId, opType: OpType.Update, payload });
  const synced = (status: { kind: string }) => expect(status, JSON.stringify(status)).toMatchObject({ kind: 'synced' });

  it('retains offline changes and clock dimensions after production prefix deletion; retries are idempotent', async () => {
    const source = await device('source');
    const offline = await device('offline');
    await source.engine.observeRemoteClockDurably(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`history-${i}`, 1])));
    await source.engine.dispatch(edit('task', { title: 'from snapshot', priority: 1 }));
    synced(await source.client.sync());
    synced(await offline.client.sync());
    await offline.engine.dispatch(edit('task', { priority: 3 }));
    const snapshot = (await source.engine.createSyncCheckpoint()).ops[0]!;
    synced(await source.client.sync());
    const snapshotRow = await db.operation.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(snapshotRow.repairBaseServerSeq).toBe(1);
    const request = postBodies.find((r) => JSON.parse(r.body).ops?.some((op: { id: string }) => op.id === snapshot.id))!;
    const retry = await fetch(request.url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: request.body });
    expect(retry.status).toBe(200);
    expect((await retry.json()).results[0]).toMatchObject({ accepted: true, serverSeq: snapshotRow.serverSeq });
    expect(await db.operation.count({ where: { id: snapshot.id } })).toBe(1);

    const { StorageQuotaService } = await import('../../src/sync/services/storage-quota.service');
    const cleanup = await new StorageQuotaService().deleteOldSyncedOpsForAllUsers(Date.now() + 1000);
    expect(cleanup.affectedUserIds).toContain(userId);
    const retained = await db.operation.findMany({ where: { userId }, orderBy: { serverSeq: 'asc' } });
    expect(retained.map((row) => row.id)).toEqual([snapshot.id]);

    const fresh = await device('fresh');
    synced(await fresh.client.sync());
    expect(fresh.engine.getState().tasks.task).toMatchObject({ title: 'from snapshot', priority: 1 });
    expect(fresh.engine.getClock()['history-100']).toBe(1);
    synced(await offline.client.sync());
    synced(await fresh.client.sync());
    expect(fresh.engine.getState().tasks.task).toMatchObject({ title: 'from snapshot', priority: 3 });
    const reboot = new OpLogEngine({ store: fresh.store, clientId: 'fresh' });
    await fresh.engine.checkpoint();
    expect(await reboot.recover()).toEqual({ replayed: 0 });
    expect(reboot.getState()).toEqual(fresh.engine.getState());
    expect(reboot.getClock()).toEqual(fresh.engine.getClock());

    // A new remote write invalidates a queued maintenance snapshot. The server
    // must reject it without deleting that write or retaining it as a drain base.
    synced(await source.client.sync());
    const stale = (await source.engine.createSyncCheckpoint()).ops[0]!;
    await fresh.engine.dispatch(edit('late', { title: 'keep this' }));
    synced(await fresh.client.sync());
    expect((await source.client.sync()).kind).toBe('error');
    expect(await db.operation.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(source.engine.getState().tasks.late?.title).toBe('keep this');
    expect(await source.engine.getPendingUpload()).toEqual([]);
  }, 30000);

  it('persists upload piggyback gaps before a device can authorize another drain', async () => {
    const ahead = await device('ahead-after-reset');
    await ahead.store.setLastServerSeq(10000);
    await ahead.engine.dispatch(edit('ahead-task', { title: 'local history survived reset' }));
    await ahead.client.sync();
    expect(await ahead.store.hasIncompleteHistory()).toBe(true);
    expect(await ahead.engine.getPendingUpload()).toEqual([]);
    const reboot = new OpLogEngine({ store: ahead.store, clientId: 'ahead-after-reset' });
    await reboot.recover();
    await expect(reboot.createSyncCheckpoint()).rejects.toThrow('completely materialized');
  });
});
