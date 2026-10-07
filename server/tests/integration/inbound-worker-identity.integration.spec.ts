/** Real HTTP + PostgreSQL. Permits seeded here; registration/issuance is a later slice. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { generateWorkerCredential } from '../../src/automation/worker-identity';

const DATABASE_URL = process.env.DATABASE_URL;
describe.skipIf(!DATABASE_URL)('inbound identity through ordinary sync HTTP', () => {
  const db = new PrismaClient();
  const app = Fastify();
  const workerA = generateWorkerCredential();
  const workerB = generateWorkerCredential();
  const epoch = randomUUID();
  const clientA = `a-${randomUUID()}`;
  const clientB = `b-${randomUUID()}`;
  const eventId = randomUUID();
  const oldSecret = process.env.JWT_SECRET;
  let userId: number;
  let otherId: number;
  let base: string;
  let token: string;
  let otherToken: string;
  const op = {
    id: `inbound:${eventId}`, clientId: clientA, entityType: 'TASK', opType: 'BATCH',
    actionType: 'BATCH', entityId: `inbound:${eventId}:0`, entityIds: [`inbound:${eventId}:1`],
    payload: Buffer.alloc(44, 7).toString('base64'), isPayloadEncrypted: true,
    vectorClock: { [clientA]: 1 }, timestamp: Date.now(), schemaVersion: 1,
  };
  const upload = async (workerToken: string | undefined, overrides: {
    epoch?: string; token?: string; op?: Record<string, unknown>; path?: string;
  } = {}) => fetch(`${base}/api/sync/${overrides.path ?? 'ops'}`, {
    method: 'POST', headers: { authorization: overrides.token ?? token, 'content-type': 'application/json',
      ...(workerToken ? { 'x-heyta-worker-token': workerToken } : {}),
      'x-heyta-database-epoch': overrides.epoch ?? epoch },
    body: JSON.stringify({ clientId: clientA, requestId: 'inbound-identity-retry', ops: [overrides.op ?? op] }),
  });
  beforeAll(async () => {
    process.env.JWT_SECRET = 'inbound-identity-test-secret-at-least-32';
    const { initSyncService } = await import('../../src/sync/sync.service');
    const { syncRoutes } = await import('../../src/sync/sync.routes');
    initSyncService();
    const user = await db.user.create({ data: { email: `inbound-${randomUUID()}@test.local`, isVerified: 1 } });
    const other = await db.user.create({ data: { email: `inbound-${randomUUID()}@test.local`, isVerified: 1 } });
    userId = user.id; otherId = other.id;
    const sign = (id: number, email: string) => `Bearer ${jwt.sign({ userId: id, email, tokenVersion: 0 }, process.env.JWT_SECRET!)}`;
    token = sign(user.id, user.email); otherToken = sign(other.id, other.email);
    for (const [worker, client] of [[workerA, clientA], [workerB, clientB]] as const) {
      await db.automationWorker.create({ data: { id: worker.workerId, userId,
        credentialHash: worker.credentialHash, syncClientId: client, databaseEpoch: epoch } });
    }
    await db.automationCommitPermit.create({ data: { eventId, userId, workerId: workerA.workerId,
      opId: op.id, ruleId: randomUUID(), ruleVersion: 1, parseVersion: 1, resultDigest: 'a'.repeat(64), itemCount: 2 } });
    await app.register(syncRoutes, { prefix: '/api/sync' });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  }, 30000);
  afterAll(async () => {
    await app.close();
    if (userId) await db.user.delete({ where: { id: userId } });
    if (otherId) await db.user.delete({ where: { id: otherId } });
    await db.$disconnect();
    const { disconnectDb } = await import('../../src/db'); await disconnectDb();
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
  });
  it('rejects missing credentials without writing', async () => {
    expect((await upload(undefined)).status).toBe(403);
    expect(await db.operation.count({ where: { id: op.id } })).toBe(0);
  });
  it('rejects B even when BOTH clientId claims are A, on both upload paths', async () => {
    for (const path of ['ops', 'ops/causal']) expect((await upload(workerB.token, { path })).status).toBe(403);
    expect(await db.operation.count({ where: { id: op.id } })).toBe(0);
  });
  it('rejects wrong account, database epoch and scope', async () => {
    expect((await upload(workerA.token, { token: otherToken })).status).toBe(403);
    expect((await upload(workerA.token, { epoch: 'different-db' })).status).toBe(403);
    expect((await upload(workerA.token, { op: { ...op, entityIds: ['arbitrary-task'] } })).status).toBe(403);
    expect((await upload(workerA.token, { op: { ...op, opType: 'CRT' } })).status).toBe(403);
  });
  it('accepts owner and exact retry once, but the populated request cache cannot authorize B', async () => {
    const first = await upload(workerA.token); expect(first.status).toBe(200);
    const body = await first.json() as any; expect(body.results[0].accepted).toBe(true);
    const retry = await upload(workerA.token); expect(retry.status).toBe(200);
    expect((await retry.json() as any).deduplicated).toBe(true);
    expect((await upload(workerB.token)).status).toBe(403);
    expect((await upload(undefined)).status).toBe(403);
    expect(await db.operation.count({ where: { id: op.id } })).toBe(1);
  });
  it('internal upload callers cannot bypass identity checks for an exact persisted duplicate', async () => {
    const { getSyncService } = await import('../../src/sync/sync.service');
    const result = await getSyncService().uploadOps(userId, clientA, [structuredClone(op)] as never);
    expect(result[0].accepted).toBe(false);
    expect(await db.operation.count({ where: { id: op.id } })).toBe(1);
  });
  it('rechecks the authenticated JWT version against durable account state', async () => {
    const { authorizeInboundOperations, readInboundUploadIdentity } = await import('../../src/automation/worker-identity');
    const identity = readInboundUploadIdentity(['x-heyta-worker-token', workerA.token, 'x-heyta-database-epoch', epoch], 0);
    await db.user.update({ where: { id: userId }, data: { tokenVersion: 1 } });
    expect(await authorizeInboundOperations(db, userId, clientA, [op] as never, identity)).toBe(false);
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    token = `Bearer ${jwt.sign({ userId, email: user.email, tokenVersion: 1 }, process.env.JWT_SECRET!)}`;
    expect((await upload(workerA.token)).status).toBe(200);
  });
  it('rejects revoked owner before cached response', async () => {
    const { DeviceService } = await import('../../src/sync/services/device.service');
    await new DeviceService().revokeDevice(userId, clientA);
    expect((await upload(workerA.token)).status).toBe(403);
  });
  it('cannot reuse the reserved identity through snapshot cache or persistence', async () => {
    const response = await fetch(`${base}/api/sync/snapshot`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: clientA, opId: op.id, requestId: 'snapshot-forgery',
        state: op.payload, isPayloadEncrypted: true, vectorClock: {}, schemaVersion: 1, reason: 'initial' }),
    });
    // Existing snapshot contract requires UUID opIds and rejects before cache.
    expect(response.status).toBe(400);
  });
  it('rechecks revocation after HTTP preflight while upload waits on its transaction lock', async () => {
    const worker = generateWorkerCredential();
    const event = randomUUID();
    const raceOp = { ...op, id: `inbound:${event}`, entityId: `inbound:${event}:0`,
      entityIds: [`inbound:${event}:1`], vectorClock: { [clientA]: 2 } };
    await db.automationWorker.create({ data: { id: worker.workerId, userId,
      credentialHash: worker.credentialHash, syncClientId: clientA, databaseEpoch: epoch } });
    await db.automationCommitPermit.create({ data: { eventId: event, userId, workerId: worker.workerId,
      opId: raceOp.id, ruleId: randomUUID(), ruleVersion: 1, parseVersion: 1, resultDigest: 'b'.repeat(64), itemCount: 2 } });
    let unlock!: () => void;
    let locked!: () => void;
    const barrier = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM user_sync_state WHERE user_id = ${userId} FOR UPDATE`;
      locked(); await barrier;
    }, { timeout: 15000 });
    await ready;
    let pending: Promise<Response> | undefined;
    try {
      pending = upload(worker.token, { op: raceOp });
      // The real backend reports the upload blocked after HTTP authorization.
      let waiting = false;
      for (let i = 0; i < 500; i++) {
        const rows = await db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query ILIKE '%user_sync_state%' AND pid <> pg_backend_pid()
        `;
        if (Number(rows[0].count) > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      const { DeviceService } = await import('../../src/sync/services/device.service');
      await new DeviceService().revokeDevice(userId, clientA);
    } finally { unlock(); await holder; }
    const response = await pending!;
    expect(response.status).toBe(200);
    expect((await response.json() as any).results[0].accepted).toBe(false);
    expect(await db.operation.count({ where: { id: raceOp.id } })).toBe(0);
  }, 20000);
  it('account deletion cascades both tables despite the composite worker ownership FK', async () => {
    await db.user.delete({ where: { id: userId } });
    expect(await db.automationWorker.count({ where: { userId } })).toBe(0);
    expect(await db.automationCommitPermit.count({ where: { userId } })).toBe(0);
    userId = 0;
  });
});
