/** A3 transport proof: real TCP, auth, route schemas and PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { encrypt } from '@heyta/sync-core';

describe.skipIf(!process.env.DATABASE_URL)('signed frontier over HTTP/PostgreSQL', () => {
  const db = new PrismaClient();
  const app = Fastify();
  let base: string;
  let userId: number;
  let authorization: string;
  let cipher: string;
  let frontier: { token: string; vectorClock: Record<string, number> };
  const priorSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'causal-frontier-isolated-integration-secret-32';
    const { initSyncService } = await import('../../src/sync/sync.service');
    const { syncRoutes } = await import('../../src/sync/sync.routes');
    initSyncService();
    const user = await db.user.create({ data: { email: `frontier-${randomUUID()}@test.local`, isVerified: 1 } });
    userId = user.id;
    authorization = `Bearer ${jwt.sign({ userId, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET)}`;
    cipher = await encrypt('{}', 'frontier-integration-password');
    await app.register(syncRoutes, { prefix: '/api/sync' });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  }, 30000);

  afterAll(async () => {
    await app.close();
    if (userId !== undefined) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
    const { disconnectDb } = await import('../../src/db');
    await disconnectDb();
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  });

  const makeOp = (clientId: string, vectorClock: Record<string, number>) => ({
    id: randomUUID(), clientId, vectorClock, actionType: 'CRT_TASK', opType: 'CRT',
    entityType: 'TASK', entityId: randomUUID(), payload: cipher,
    isPayloadEncrypted: true, timestamp: Date.now(), schemaVersion: 1,
  });
  const post = (path: string, body: unknown) => fetch(`${base}/api/sync/${path}`, {
    method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  it('issues a full signed frontier alongside the legacy snapshot metadata', async () => {
    const hundredAndOneClients = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`device-${index}`, index + 1]),
    );
    const snapshot = { ...makeOp('seed', hundredAndOneClients), opType: 'SYNC_IMPORT', entityType: 'ALL' };
    const uploaded = await post('ops', { clientId: 'seed', ops: [snapshot] });
    expect(uploaded.status).toBe(200);
    expect((await uploaded.json()).results[0].accepted).toBe(true);
    const response = await fetch(`${base}/api/sync/ops?sinceSeq=0&excludeClient=next`, { headers: { authorization } });
    expect(response.status).toBe(200);
    const body = await response.json();
    frontier = body.causalFrontier;
    expect(Object.keys(frontier.vectorClock)).toHaveLength(101);
    expect(frontier.vectorClock['device-100']).toBe(101);
    expect(frontier.token).toMatch(/^cf1\./);
    expect(body.capabilities.causalFrontierDelta).toBe(true);
  });

  it('expands before storage, downloads complete clocks and retries idempotently', async () => {
    const op = { ...makeOp('next', { next: 1 }), vectorClockEncoding: 'frontier-delta' };
    const request = { clientId: 'next', lastKnownServerSeq: 1, causalFrontierToken: frontier.token, ops: [op] };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await post('ops/causal', request);
      expect(response.status).toBe(200);
      expect((await response.json()).results[0]).toMatchObject({ accepted: true, serverSeq: 2 });
    }
    expect(await db.operation.count({ where: { id: op.id } })).toBe(1);
    const storedClock = (await db.operation.findUniqueOrThrow({ where: { id: op.id } })).vectorClock as Record<string, number>;
    expect(Object.keys(storedClock)).toHaveLength(102);
    expect(storedClock['device-100']).toBe(101);
    expect(storedClock.next).toBe(1);
    const response = await fetch(`${base}/api/sync/ops?sinceSeq=1`, { headers: { authorization } });
    const downloaded = (await response.json()).ops[0].op;
    expect(Object.keys(downloaded.vectorClock)).toHaveLength(102);
    expect(downloaded.vectorClock['device-100']).toBe(101);
    expect(downloaded.vectorClockEncoding).toBeUndefined();
  });

  it('rejects missing/tampered proofs and invalid deltas without writing anything', async () => {
    const before = await db.operation.count({ where: { userId } });
    for (const patch of [
      {}, { causalFrontierToken: `${frontier.token}x` },
      { causalFrontierToken: frontier.token, vectorClock: { 'device-100': 100, next: 2 } },
    ]) {
      const op = { ...makeOp('next', patch.vectorClock ?? { next: 2 }), vectorClockEncoding: 'frontier-delta' };
      const response = await post('ops/causal', { clientId: 'next', ops: [op], causalFrontierToken: patch.causalFrontierToken });
      expect(response.status).toBe(400);
      expect((await response.json()).errorCode).toBe('INVALID_VECTOR_CLOCK');
    }
    expect(await db.operation.count({ where: { userId } })).toBe(before);
  });

  it('rejects a frontier from another account through the authenticated HTTP route', async () => {
    const other = await db.user.create({ data: { email: `other-${randomUUID()}@test.local`, isVerified: 1 } });
    try {
      const response = await fetch(`${base}/api/sync/ops/causal`, {
        method: 'POST', headers: {
          authorization: `Bearer ${jwt.sign({ userId: other.id, email: other.email, tokenVersion: 0 }, process.env.JWT_SECRET!)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ clientId: 'next', causalFrontierToken: frontier.token,
          ops: [{ ...makeOp('next', { next: 1 }), vectorClockEncoding: 'frontier-delta' }] }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).errorCode).toBe('INVALID_VECTOR_CLOCK');
      expect(await db.operation.count({ where: { userId: other.id } })).toBe(0);
    } finally { await db.user.delete({ where: { id: other.id } }); }
  });

  it('stores all 4096 dimensions and explicitly rejects 4097 through HTTP', async () => {
    const vectorClock = Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [`d${i}`, i + 1]));
    const accepted = makeOp('d0', vectorClock);
    let response = await post('ops', { clientId: 'd0', ops: [accepted] });
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].accepted).toBe(true);
    expect((await db.operation.findUniqueOrThrow({ where: { id: accepted.id } })).vectorClock).toEqual(vectorClock);
    const rejected = makeOp('d0', { ...vectorClock, extra: 1 });
    response = await post('ops', { clientId: 'd0', ops: [rejected] });
    expect(response.status).toBe(200);
    expect((await response.json()).results[0]).toMatchObject({ accepted: false, errorCode: 'INVALID_VECTOR_CLOCK' });
    expect(await db.operation.findUnique({ where: { id: rejected.id } })).toBeNull();
  });
});
