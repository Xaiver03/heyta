import { sessionIssuer } from "../fixtures/central-session-issuer";
/** Real TLS, standard client, real PostgreSQL ownership. All credentials synthetic. */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CentralAuthRepository } from '../../src/central-auth/repository';
import { CredentialCipher, digest, randomSecret } from '../../src/central-auth/crypto';
import { createCentralOidcClient } from '../../src/central-auth/oidc-client';
import { CentralOidcProvider, type Mode } from '../fixtures/central-oidc-provider';
const url = process.env.HEYTA_CENTRAL_TEST_DATABASE_URL;
if (!url) throw new Error('Explicit isolated PostgreSQL URL required');
const target = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !/^\/heyta_central_auth_oidc[a-z0-9_]*test$/.test(target.pathname) || target.search || target.hash) throw new Error('Unsafe test database');
const db = new PrismaClient({ datasources: { db: { url } } });
const repo = new CentralAuthRepository(db, new CredentialCipher('44'.repeat(32)), sessionIssuer);
let provider: CentralOidcProvider;
beforeEach(async () => {
  await db.centralRevocation.deleteMany(); await db.centralGrant.deleteMany(); await db.centralAttempt.deleteMany();
  await db.centralPending.deleteMany(); await db.centralIdentity.deleteMany();
  await db.user.deleteMany({ where: { email: { endsWith: '@central.test' } } });
  provider = await new CentralOidcProvider().start();
});
afterEach(async () => { if (provider) await provider.close(); });
afterAll(async () => db.$disconnect());
async function setup(mode: Mode = 'good', port: Parameters<typeof createCentralOidcClient>[1] = repo) {
  provider.nextMode = mode;
  const client = await createCentralOidcClient(provider.config(), port);
  const browser = randomSecret();
  const pending = await client.begin({ browser });
  const callbackUrl = await provider.callback(pending.authorizationUrl);
  return { client, browser, callbackUrl, pending };
}
async function applied() {
  const session = await setup();
  const result = await session.client.exchange(session);
  const { grantId } = await repo.completeAuthorization({ attemptId: result.attemptId, accessExpiresAt: result.accessExpiresAt, subject: result.subject,
    rootSid: result.rootSid, expiresAt: Date.now() + 3600_000,
    newUser: { email: `${randomSecret()}@central.test`, termsAcceptedAt: Date.now(), termsDocumentVersion: 'test@1' } });
  return { ...session, result, grantId };
}
describe('durable OIDC transport', () => {
  it('uses real TLS/ES256/PKCE and accepts an older central SSO auth_time', async () => {
    const s = await setup();
    const result = await s.client.exchange(s);
    expect(result.authTime).toBeLessThan(Date.now() - 3000_000);
    expect(result.rootSid).toBe('shared-central-root');
    const attempt = await repo.inspectAttempt(result.attemptId);
    expect(attempt?.status).toBe('RESULT');
    const stored = await repo.readResult(result.attemptId);
    expect(stored.tokens.accessToken === provider.issued[0].accessToken).toBe(true);
    expect(await s.client.userInfo(stored.tokens.accessToken!, result.subject)).toEqual({ subject: result.subject, verifiedEmail: 'fixture@central.test' });
    expect(provider.requests.some((r) => r.path.endsWith('/jwks'))).toBe(true);
    expect(await db.accessSession.count()).toBe(0);
    await expect(s.client.exchange(s)).rejects.toThrow('central_unavailable');
    expect(provider.tokenPosts).toBe(1);
  });
  it.each<Mode>(['bad-signature', 'bad-alg', 'bad-issuer', 'bad-audience', 'bad-nonce', 'expired', 'future-auth', 'no-auth', 'no-id', 'wrong-client', 'inactive', 'wrong-type', 'expired-access', 'error-material'])(
    'persists material even when %s fails validation', async (mode) => {
      const s = await setup(mode);
      await expect(s.client.exchange(s)).rejects.toThrow(/^central_/);
      const attempts = await db.centralAttempt.findMany();
      expect(attempts).toHaveLength(1); expect(attempts[0].status).toBe('RESULT');
      const stored = await repo.readResult(attempts[0].id);
      expect(stored.tokens.accessToken === provider.issued[0].accessToken).toBe(true);
      expect(provider.revocations).toBe(0); expect(provider.tokenPosts).toBe(1);
      await expect(s.client.exchange(s)).rejects.toThrow(); expect(provider.tokenPosts).toBe(1);
    },
  );
  it.each<Mode>(['bad-json', 'redirect', 'oversize', 'drop-response'])(
    'does not retry or claim known failure after %s', async (mode) => {
      const s = await setup(mode);
      await expect(s.client.exchange(s)).rejects.toThrow(/^central_/);
      const attempts = await db.centralAttempt.findMany();
      expect(attempts).toHaveLength(1); expect(attempts[0].status).toBe('DISPATCHED');
      await expect(s.client.exchange(s)).rejects.toThrow();
      expect(provider.tokenPosts).toBe(1); expect(provider.revocations).toBe(0);
      expect(provider.requests.some((r) => r.path.endsWith('/retry'))).toBe(false);
    },
  );
  it('bounds full-body time, not just response headers', async () => {
    const s = await setup('slow-body');
    const start = Date.now();
    await expect(s.client.exchange(s)).rejects.toThrow(/^central_/);
    expect(Date.now() - start).toBeLessThan(17_000);
    expect((await db.centralAttempt.findMany())[0].status).toBe('DISPATCHED');
    expect(provider.tokenPosts).toBe(1);
  }, 20_000);
  it('lost COMMIT receipt preserves durable ownership and never blindly revokes', async () => {
    const port = {
      prepare: repo.prepare.bind(repo), dispatchAuthorization: repo.dispatchAuthorization.bind(repo), beginRefresh: repo.beginRefresh.bind(repo),
      recordResult: async (...args: Parameters<CentralAuthRepository['recordResult']>) => {
        await repo.recordResult(...args); throw new Error('synthetic lost COMMIT receipt with sensitive upstream detail');
      },
    };
    const s = await setup('good', port);
    await expect(s.client.exchange(s)).rejects.toThrow(/^central_unavailable$/);
    expect((await db.centralAttempt.findMany())[0].status).toBe('RESULT');
    expect(provider.revocations).toBe(0);
    await expect(s.client.exchange(s)).rejects.toThrow(); expect(provider.tokenPosts).toBe(1);
  });
  it('does not start signature verification before material COMMIT returns', async () => {
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const arrived = new Promise<void>((resolve) => { reached = resolve; });
    const port = { prepare: repo.prepare.bind(repo), dispatchAuthorization: repo.dispatchAuthorization.bind(repo), beginRefresh: repo.beginRefresh.bind(repo),
      recordResult: async (...args: Parameters<CentralAuthRepository['recordResult']>) => { reached(); await gate; return repo.recordResult(...args); } };
    const s = await setup('bad-signature', port);
    const result = s.client.exchange(s).then(() => false, () => true);
    await arrived;
    expect(provider.requests.some((r) => r.path.endsWith('/jwks'))).toBe(false);
    release(); expect(await result).toBe(true);
    expect(provider.requests.some((r) => r.path.endsWith('/jwks'))).toBe(true);
  });
  it('concurrent users have separate captures and duplicate callbacks dispatch once', async () => {
    const client = await createCentralOidcClient(provider.config(), repo);
    const sessions = await Promise.all(Array.from({ length: 6 }, async () => {
      const browser = randomSecret(); const p = await client.begin({ browser });
      return { browser, callbackUrl: await provider.callback(p.authorizationUrl) };
    }));
    const results = await Promise.all(sessions.map((s) => client.exchange(s)));
    for (const result of results) {
      const stored = await repo.readResult(result.attemptId);
      expect(provider.issued.find((t) => t.accessToken === stored.tokens.accessToken)?.subject === result.subject).toBe(true);
    }
    expect(new Set(results.map((r) => r.subject)).size).toBe(6);
    const s = await setup();
    const outcomes = await Promise.allSettled([s.client.exchange(s), s.client.exchange(s)]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1); expect(provider.tokenPosts).toBe(7);
  });
  it('timeout during COMMIT wait leaves late result owned and never validates or revokes it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let recorded!: () => void;
    const saved = new Promise<void>((resolve) => { recorded = resolve; });
    const port = { prepare: repo.prepare.bind(repo), dispatchAuthorization: repo.dispatchAuthorization.bind(repo), beginRefresh: repo.beginRefresh.bind(repo),
      recordResult: async (...args: Parameters<CentralAuthRepository['recordResult']>) => {
        await gate; const result = await repo.recordResult(...args); recorded(); return result;
      } };
    const s = await setup('good', port);
    await expect(s.client.exchange(s)).rejects.toThrow('central_timeout');
    expect(provider.tokenPosts).toBe(1);
    release(); await saved;
    expect((await db.centralAttempt.findMany())[0].status).toBe('RESULT');
    expect(provider.requests.some((r) => r.path.endsWith('/jwks'))).toBe(false);
    expect(provider.revocations).toBe(0);
    await expect(s.client.exchange(s)).rejects.toThrow(); expect(provider.tokenPosts).toBe(1);
  }, 20_000);
  it('binding requests fresh central login and rejects an old auth_time even with a newly issued ID token', async () => {
    const user = await db.user.create({ data: { email: `${randomSecret()}@central.test`, isVerified: 1 } });
    const sessionHash = digest(randomSecret());
    await db.accessSession.create({ data: { jtiHash: sessionHash, userId: user.id, tokenVersion: user.tokenVersion,
      createdAt: BigInt(Date.now()), lastSeenAt: BigInt(Date.now()) } });
    const client = await createCentralOidcClient(provider.config(), repo);
    const browser = randomSecret();
    const p = await client.begin({ browser, link: { userId: user.id, sessionHash, tokenVersion: user.tokenVersion, authenticatedAt: Date.now() } });
    const auth = new URL(p.authorizationUrl);
    expect(auth.searchParams.get('prompt')).toBe('login consent'); expect(auth.searchParams.get('max_age')).toBe('0');
    await expect(client.exchange({ browser, callbackUrl: await provider.callback(p.authorizationUrl) })).rejects.toThrow();
    expect((await db.centralAttempt.findMany())[0].status).toBe('RESULT');
  });
  it.each(['state', 'iss', 'redirect', 'duplicate', 'browser'])('rejects callback %s before token dispatch', async (kind) => {
    const s = await setup(); const callback = new URL(s.callbackUrl);
    if (kind === 'state') callback.searchParams.set('state', 'invalid');
    if (kind === 'iss') callback.searchParams.set('iss', 'https://other.example.test');
    if (kind === 'redirect') callback.pathname = '/another';
    if (kind === 'duplicate') callback.searchParams.append('code', 'duplicate');
    await expect(s.client.exchange({ callbackUrl: callback.href, browser: kind === 'browser' ? 'other' : s.browser })).rejects.toThrow();
    expect(provider.tokenPosts).toBe(0);
  });
  it.each(['cross-origin', 'http', 'query', 'fragment', 'credentials', 'issuer'])('rejects metadata %s', async (kind) => {
    provider.metadataPatch = kind === 'issuer' ? { issuer: `${provider.issuer}/` } : { token_endpoint:
      kind === 'cross-origin' ? 'https://example.test/token' : kind === 'http' ? provider.issuer.replace('https:', 'http:') + '/token' :
      kind === 'query' ? `${provider.issuer}/token?q=1` : kind === 'fragment' ? `${provider.issuer}/token#f` : provider.issuer.replace('https://', 'https://user:pass@') + '/token' };
    await expect(createCentralOidcClient(provider.config(), repo)).rejects.toThrow();
    expect(provider.tokenPosts).toBe(0);
  });
  it.each<Mode>(['no-id', 'good'])('refresh supports %s and keeps a distinct durable attempt', async (mode) => {
    const s = await applied(); provider.nextRefreshMode = mode;
    const result = await s.client.refresh(s.grantId);
    expect(result.subject).toBe(s.result.subject); expect(result.attemptId).not.toBe(s.result.attemptId);
    expect((await repo.inspectAttempt(result.attemptId))?.status).toBe('RESULT');
    expect((await repo.inspectAttempt(s.result.attemptId))?.status).toBe('APPLIED');
    await expect(s.client.refresh(s.grantId)).rejects.toThrow(); expect(provider.tokenPosts).toBe(2);
  });
  it.each<Mode>(['wrong-subject', 'bad-signature', 'bad-alg', 'bad-audience', 'bad-issuer'])('refresh rejects %s after saving rotated material', async (mode) => {
    const s = await applied(); provider.nextRefreshMode = mode;
    await expect(s.client.refresh(s.grantId)).rejects.toThrow();
    expect((await db.centralAttempt.findFirstOrThrow({ where: { kind: 'refresh' } })).status).toBe('RESULT');
    expect(provider.revocations).toBe(0); expect(provider.tokenPosts).toBe(2);
  });
  it.each<Mode>(['wrong-userinfo', 'unverified-email'])('userinfo enforces %s boundary', async (mode) => {
    const s = await setup(mode); const result = await s.client.exchange(s);
    const material = await repo.readResult(result.attemptId);
    if (mode === 'wrong-userinfo') await expect(s.client.userInfo(material.tokens.accessToken!, result.subject)).rejects.toThrow();
    else expect(await s.client.userInfo(material.tokens.accessToken!, result.subject)).toEqual({ subject: result.subject });
  });
  it('trusted revocation invalidates opaque access material', async () => {
    const s = await setup(); const result = await s.client.exchange(s);
    const material = await repo.readResult(result.attemptId);
    await s.client.revoke(material.tokens.accessToken!, 'access_token');
    await expect(s.client.introspect(material.tokens.accessToken!, result.subject)).rejects.toThrow();
    expect(provider.revocations).toBe(1);
  });
});
