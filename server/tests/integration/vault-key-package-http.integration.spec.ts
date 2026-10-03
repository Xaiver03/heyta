/** Real-PostgreSQL proof for opaque key-package CAS and root-rotation bounds. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('vault key-package CAS over HTTP/PostgreSQL', () => {
  const db = new PrismaClient();
  const app = Fastify();
  const priorSecret = process.env.JWT_SECRET;
  let userId: number;
  let base: string;
  let authorization: string;

  const wrapper = (seed: number) => ({
    kdf: 'argon2id',
    salt: Buffer.alloc(16, seed).toString('base64'),
    iv: Buffer.alloc(12, seed + 1).toString('base64'),
    ciphertext: Buffer.alloc(48, seed + 2).toString('base64'),
  });
  const packageFor = (keyVersion: number, rootKeyFingerprint = 'a'.repeat(64), seed = keyVersion) => ({
    version: 1,
    keyVersion,
    rootKeyFingerprint,
    passphrase: wrapper(seed),
    recovery: wrapper(seed + 10),
  });
  const put = (body: unknown) => fetch(`${base}/api/sync/key-package`, {
    method: 'PUT',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'vault-key-package-http-integration-secret-32';
    const { initSyncService } = await import('../../src/sync/sync.service');
    const { syncRoutes } = await import('../../src/sync/sync.routes');
    initSyncService();
    const user = await db.user.create({
      data: { email: `vault-key-package-${randomUUID()}@test.local`, isVerified: 1 },
    });
    userId = user.id;
    authorization = `Bearer ${jwt.sign({ userId, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET)}`;
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

  it('allows one CAS winner, makes the loser stale, and makes the winner retry idempotent', async () => {
    const initial = await put({ expectedKeyVersion: 0, package: packageFor(1) });
    expect(initial.status).toBe(200);

    const candidates = [packageFor(2, 'a'.repeat(64), 20), packageFor(2, 'a'.repeat(64), 30)];
    const responses = await Promise.all(candidates.map((pkg) => put({ expectedKeyVersion: 1, package: pkg })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);

    const winnerIndex = responses.findIndex((response) => response.status === 200);
    const loserIndex = 1 - winnerIndex;
    const winner = candidates[winnerIndex]!;
    const loser = candidates[loserIndex]!;
    const retry = await put({ expectedKeyVersion: 1, package: winner });
    expect(retry.status).toBe(200);
    const stale = await put({ expectedKeyVersion: 1, package: loser });
    expect(stale.status).toBe(409);

    const stored = await db.vaultKeyPackage.findUniqueOrThrow({ where: { userId } });
    expect(stored.keyVersion).toBe(2);
    expect(stored.packageData).toEqual(winner);
  }, 30000);

  it('revokes every old JWT while a freshly issued version can still read the package', async () => {
    const oldTokenA = jwt.sign({ userId, email: 'old-a@test.local', tokenVersion: 0 }, process.env.JWT_SECRET!);
    const oldTokenB = jwt.sign({ userId, email: 'old-b@test.local', tokenVersion: 0 }, process.env.JWT_SECRET!);
    const revoke = await fetch(`${base}/api/sync/devices/device-revoke-test`, {
      method: 'DELETE',
      headers: { authorization },
    });
    expect(revoke.status).toBe(200);

    for (const oldToken of [oldTokenA, oldTokenB]) {
      const response = await fetch(`${base}/api/sync/key-package`, {
        headers: { authorization: `Bearer ${oldToken}` },
      });
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe('TOKEN_REVOKED');
    }

    const freshToken = jwt.sign({ userId, email: 'fresh@test.local', tokenVersion: 1 }, process.env.JWT_SECRET!);
    authorization = `Bearer ${freshToken}`;
    const readable = await fetch(`${base}/api/sync/key-package`, { headers: { authorization } });
    expect(readable.status).toBe(200);
    expect((await readable.json()).package.keyVersion).toBe(2);
  }, 30000);

  it('rejects root replacement and independent package deletion', async () => {
    const rootChange = await put({
      expectedKeyVersion: 2,
      package: packageFor(3, 'b'.repeat(64), 40),
    });
    expect(rootChange.status).toBe(409);
    expect((await rootChange.json()).error).toBe('root_rotation_requires_atomic_migration');

    const removal = await fetch(`${base}/api/sync/key-package`, {
      method: 'DELETE', headers: { authorization },
    });
    expect(removal.status).toBe(409);
    expect(await db.vaultKeyPackage.findUnique({ where: { userId } })).not.toBeNull();
  });
});
