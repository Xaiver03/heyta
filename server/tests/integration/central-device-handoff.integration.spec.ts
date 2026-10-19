/** Device handoff invariants against an explicitly isolated real PostgreSQL database. */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CredentialCipher, digest, randomSecret } from '../../src/central-auth/crypto';
import { CentralAuthRepository } from '../../src/central-auth/repository';
import { sessionIssuer } from '../fixtures/central-session-issuer';

const raw = process.env.HEYTA_CENTRAL_TEST_DATABASE_URL;
if (!raw) throw new Error('HEYTA_CENTRAL_TEST_DATABASE_URL is required');
const target = new URL(raw);
if (target.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    !/^\/heyta_central_auth_[a-z0-9_]*test$/.test(target.pathname) || target.search || target.hash)
  throw new Error('Unsafe device test database');
const db = new PrismaClient({ datasources: { db: { url: raw } } });
const cipher = new CredentialCipher('54'.repeat(32));
const repo = new CentralAuthRepository(db, cipher, sessionIssuer);
const browser = randomSecret(), verifier = randomSecret();
const pairingCode = 'A1B2C3D4E5F6';
const issuer = 'https://identity.example.test', clientId = 'heyta-device-test';

beforeEach(async () => {
  await db.centralHandoff.deleteMany();
  await db.centralRevocation.deleteMany();
  await db.centralGrant.deleteMany();
  await db.centralAttempt.deleteMany();
  await db.centralPending.deleteMany();
  await db.centralIdentity.deleteMany();
  await db.user.deleteMany({ where: { email: { endsWith: '@device.test' } } });
});
afterAll(async () => db.$disconnect());

async function handoff() {
  const launchSecret = randomSecret();
  const pending = await repo.prepare({ issuer, clientId,
    redirectUri: 'https://heyta.example.test/api/auth/oidc/callback', browser,
    nonce: randomSecret(), verifier: randomSecret() });
  const row = await repo.createHandoff({ pendingId: pending.id, browser,
    deviceChallenge: digest(verifier), launchSecret, pairingCode,
    authorizationUrl: `${issuer}/authorize?state=${pending.state}`,
    terms: { acceptedAt: Date.now(), documentVersion: 'test@1' } });
  return { pending, row, launchSecret };
}
async function ready() {
  const { pending, row, launchSecret } = await handoff();
  await repo.launchHandoff(launchSecret, pairingCode);
  const attempt = await repo.dispatchAuthorization(pending.state, browser);
  await repo.recordResult(attempt.id, attempt.dispatchToken, {
    accessToken: `synthetic-at-${attempt.id}`, refreshToken: `synthetic-rt-${attempt.id}`,
    expiresAt: Date.now() + 300_000,
  });
  const subject = randomSecret();
  const result = await repo.completeAuthorization({ attemptId: attempt.id,
    subject, accessExpiresAt: Date.now() + 300_000,
    expiresAt: Date.now() + 3600_000, handoffId: row.id,
    newUser: { email: `${randomSecret()}@device.test`, termsAcceptedAt: Date.now(), termsDocumentVersion: 'test@1' } });
  return { row, result, subject };
}

describe('device handoff durable ownership', () => {
  it('requires the separate pairing code and consumes launch exactly once', async () => {
    const { row, launchSecret } = await handoff();
    expect((await repo.inspectHandoffLaunch(launchSecret)).id).toBe(row.id);
    await expect(repo.launchHandoff(launchSecret, '000000000000')).rejects.toMatchObject({ code: 'handoff_unavailable' });
    expect((await db.centralHandoff.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
    const launched = await repo.launchHandoff(launchSecret, pairingCode);
    expect(launched.browser).toBe(browser);
    await expect(repo.launchHandoff(launchSecret, pairingCode)).rejects.toMatchObject({ code: 'handoff_unavailable' });
  });
  it('refuses a wrong device without consuming and permits only one concurrent claim', async () => {
    const { row, result } = await ready();
    expect(result.token).toBeUndefined();
    await expect(repo.claimHandoff(row.id, randomSecret())).rejects.toMatchObject({ code: 'handoff_unavailable' });
    const outcomes = await Promise.allSettled([repo.claimHandoff(row.id, verifier), repo.claimHandoff(row.id, verifier)]);
    const fulfilled = outcomes.filter((v): v is PromiseFulfilledResult<Awaited<ReturnType<typeof repo.claimHandoff>>> => v.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]!.value.status).toBe('claimed');
    if (fulfilled[0]!.value.status === 'claimed') expect(fulfilled[0]!.value.token).toBeTruthy();
    expect((await db.centralHandoff.findUniqueOrThrow({ where: { id: row.id } })).tokenCipher).toBeNull();
    expect(await db.centralGrant.count()).toBe(1);
  });
  it('rejects an expired unclaimed handoff and enqueues grant revocation', async () => {
    const { row, result } = await ready();
    await db.centralHandoff.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(repo.claimHandoff(row.id, verifier)).rejects.toMatchObject({ code: 'handoff_unavailable' });
    await repo.cleanup();
    expect((await db.centralHandoff.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('EXPIRED');
    expect((await db.centralGrant.findUniqueOrThrow({ where: { id: result.grantId } })).revokedAt).not.toBeNull();
    expect(await db.centralRevocation.count()).toBe(1);
  });
  it('clears the sealed bearer when the grant is revoked before claim', async () => {
    const { row, result } = await ready();
    await repo.revokeGrant(result.grantId);
    await expect(repo.claimHandoff(row.id, verifier)).rejects.toMatchObject({ code: 'handoff_unavailable' });
    const stored = await db.centralHandoff.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe('REVOKED'); expect(stored.tokenCipher).toBeNull();
  });
  it('rolls back both grant and sealed bearer when the session issuer fails', async () => {
    const { pending, row, launchSecret } = await handoff();
    await repo.launchHandoff(launchSecret, pairingCode);
    const attempt = await repo.dispatchAuthorization(pending.state, browser);
    await repo.recordResult(attempt.id, attempt.dispatchToken, { accessToken: 'synthetic-at', expiresAt: Date.now() + 300_000 });
    const failing = new CentralAuthRepository(db, cipher, async () => { throw new Error('synthetic issuer failure'); });
    await expect(failing.completeAuthorization({ attemptId: attempt.id, subject: randomSecret(),
      accessExpiresAt: Date.now() + 300_000, expiresAt: Date.now() + 3600_000, handoffId: row.id,
      newUser: { email: `${randomSecret()}@device.test`, termsAcceptedAt: Date.now(), termsDocumentVersion: 'test@1' },
    })).rejects.toThrow('synthetic issuer failure');
    expect(await db.centralGrant.count()).toBe(0);
    const stored = await db.centralHandoff.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe('LAUNCHED'); expect(stored.tokenCipher).toBeNull();
  });
  it('refuses issuance when a user-row lock crosses the handoff expiry', async () => {
    const first = await ready();
    const firstGrant = await db.centralGrant.findUniqueOrThrow({ where: { id: first.result.grantId } });
    const { pending, row, launchSecret } = await handoff();
    await repo.launchHandoff(launchSecret, pairingCode);
    const attempt = await repo.dispatchAuthorization(pending.state, browser);
    await repo.recordResult(attempt.id, attempt.dispatchToken, {
      accessToken: `synthetic-at-${attempt.id}`, expiresAt: Date.now() + 300_000,
    });
    await db.centralHandoff.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + 800) } });
    let locked!: () => void, release!: () => void;
    const lockReady = new Promise<void>((resolve) => { locked = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${firstGrant.userId} FOR UPDATE`;
      locked();
      await hold;
    });
    await lockReady;
    const result = repo.completeAuthorization({ attemptId: attempt.id, subject: first.subject,
      accessExpiresAt: Date.now() + 300_000, expiresAt: Date.now() + 3600_000, handoffId: row.id,
    }).then(() => ({ applied: true }), (error: { code: string }) => ({ applied: false, code: error.code }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    release();
    await blocker;
    expect(await result).toEqual({ applied: false, code: 'result_unavailable' });
    expect(await db.centralGrant.count()).toBe(1);
    expect((await db.centralHandoff.findUniqueOrThrow({ where: { id: row.id } })).tokenCipher).toBeNull();
  });
});
