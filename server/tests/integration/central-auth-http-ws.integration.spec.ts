/** Real product HTTP/TLS + WebSocket + PostgreSQL, independent MIT issuer fixture. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixturePaths = vi.hoisted(() => { process.env.JWT_SECRET = 's'.repeat(64); process.env.DATABASE_URL = process.env.HEYTA_CENTRAL_TEST_DATABASE_URL;
  const paths = { key: process.env.HEYTA_OIDC_TEST_KEY!, cert: process.env.HEYTA_OIDC_TEST_CERT! };
  delete process.env.HEYTA_OIDC_TEST_KEY; delete process.env.HEYTA_OIDC_TEST_CERT; return paths; });
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import * as jwt from 'jsonwebtoken';
import { prisma } from '../../src/db';
import { acquireAuthenticationRuntime } from '../../src/central-auth/runtime';
import { centralAuthRoutes } from '../../src/central-auth/routes';
import { installCentralRoutePolicy } from '../../src/central-auth/route-policy';
import { CENTRAL_COOKIES } from '../../src/central-auth/http-security';
import { digest, randomSecret } from '../../src/central-auth/crypto';
import { authenticate } from '../../src/middleware';
import { apiRoutes } from '../../src/api';
import { accountSecurityRoutes } from '../../src/account/account-security.routes';
import { syncRoutes } from '../../src/sync/sync.routes';
import { initSyncService } from '../../src/sync/sync.service';
import { adminRoutes } from '../../src/admin/admin.routes';
import { wsRoutes } from '../../src/sync/websocket.routes';
import { getWsConnectionService, resetWsConnectionService } from '../../src/sync/services/websocket-connection.service';
import { issueSession, verifyToken } from '../../src/auth';
import { authCache } from '../../src/auth-cache';
import { CentralOidcProvider } from '../fixtures/central-oidc-provider';
import { LEGAL_SET_VERSION, OFFICIAL_HOSTED_DOMAIN } from '../../src/legal.generated';
import { SESSION_PATHS } from '@heyta/shared-schema';

const target = new URL(process.env.HEYTA_CENTRAL_TEST_DATABASE_URL!);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !/^\/heyta_central_auth_oidc[a-z0-9_]*test$/.test(target.pathname) || target.search || target.hash) throw new Error('Unsafe fixture database');
const origin = `https://${OFFICIAL_HOSTED_DOMAIN}`;
const tlsKey = readFileSync(fixturePaths.key), tlsCert = readFileSync(fixturePaths.cert);
delete process.env.HEYTA_OIDC_TEST_KEY; delete process.env.HEYTA_OIDC_TEST_CERT;
let app: FastifyInstance, provider: CentralOidcProvider, owner: Awaited<ReturnType<typeof acquireAuthenticationRuntime>>, network: string;
const sockets = new Set<WebSocket>();
beforeEach(async () => {
  await prisma.centralHandoff.deleteMany();
  await prisma.centralRevocation.deleteMany(); await prisma.centralGrant.deleteMany(); await prisma.centralAttempt.deleteMany();
  await prisma.centralPending.deleteMany(); await prisma.centralIdentity.deleteMany(); await prisma.user.deleteMany(); await prisma.accountTombstone.deleteMany();
  process.env.HEYTA_OIDC_TEST_KEY = fixturePaths.key;
  process.env.HEYTA_OIDC_TEST_CERT = fixturePaths.cert;
  provider = await new CentralOidcProvider().start();
  delete process.env.HEYTA_OIDC_TEST_KEY; delete process.env.HEYTA_OIDC_TEST_CERT;
  Object.defineProperty(provider, 'redirectUri', { value: `${origin}/api/auth/oidc/callback` });
  const config = provider.config();
  Object.assign(process.env, { PUBLIC_URL: origin, HEYTA_AUTH_MODE: 'oidc', HEYTA_AUTH_DEPLOYMENT: 'official',
    HEYTA_OIDC_ISSUER: config.issuer, HEYTA_OIDC_CLIENT_ID: config.clientId, HEYTA_OIDC_CLIENT_SECRET: config.clientSecret,
    HEYTA_OIDC_REDIRECT_URI: config.redirectUri, HEYTA_OIDC_SESSION_ENCRYPTION_KEY: config.sessionEncryptionKey });
  owner = await acquireAuthenticationRuntime(config);
  app = Fastify({ https: { key: tlsKey, cert: tlsCert } });
  installCentralRoutePolicy(app);
  await centralAuthRoutes(app, owner.runtime);
  await app.register(websocket);
  await app.register(wsRoutes, { prefix: '/api/sync' });
  await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: true });
  await app.register(accountSecurityRoutes, { prefix: '/api' });
  initSyncService();
  await app.register(syncRoutes, { prefix: '/api/sync' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  app.get('/private', { preHandler: authenticate }, async (req) => ({ userId: req.user!.userId }));
  app.post('/private', { preHandler: authenticate }, async (req) => ({ userId: req.user!.userId }));
  network = await app.listen({ host: '127.0.0.1', port: 0 });
});
afterEach(async () => {
  for (const socket of sockets) socket.terminate(); sockets.clear();
  const ws = getWsConnectionService(); ws.stopHeartbeat(); ws.closeAll(); await ws.drainAuthorization();
  await app?.close(); await owner?.stop(); resetWsConnectionService(); await provider?.close();
});
afterAll(async () => prisma.$disconnect());
class Browser {
  cookies = new Map<string, string>();
  cookie() { return [...this.cookies].map(([k,v]) => `${k}=${v}`).join('; '); }
  remember(response: Response) {
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0], split = pair.indexOf('='); if (cookie.includes('Max-Age=0')) this.cookies.delete(pair.slice(0,split)); else this.cookies.set(pair.slice(0,split),pair.slice(split+1)); }
  }
  async request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${network}${path}`, { method, redirect: 'manual', headers: {
      cookie: this.cookie(), origin, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers,
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    this.remember(response);
    return response;
  }
  async form(path: string, body: string) {
    const response = await fetch(`${network}${path}`, { method: 'POST', redirect: 'manual',
      headers: { cookie: this.cookie(), origin, 'content-type': 'text/plain' }, body });
    this.remember(response);
    return response;
  }
  async start(terms = true) {
    const session = await (await this.request('/api/auth/central/session')).json() as { csrfToken: string };
    const response = await this.request('/api/auth/oidc/start', 'POST', terms ? { termsAccepted: true, documentVersion: LEGAL_SET_VERSION } : {}, { 'x-csrf-token': session.csrfToken });
    expect(response.status).toBe(200);
    const result = await response.json() as { authorizationUrl: string };
    return provider.callback(result.authorizationUrl);
  }
  async login(subject?: string) {
    const callback = await this.start();
    if (subject) provider.codes.get(new URL(callback).searchParams.get('code')!)!.subject = subject;
    const response = await this.request(new URL(callback).pathname + new URL(callback).search, 'GET', undefined, { host: 'attacker.example' });
    expect(response.status, await response.clone().text()).toBe(303); expect(response.headers.get('location')).toBe(`${origin}/app/`);
    expect(await response.text()).not.toContain(this.cookies.get(CENTRAL_COOKIES.session));
    return response;
  }
  csrf() { return { 'x-csrf-token': this.cookies.get(CENTRAL_COOKIES.csrf)! }; }
}
async function socket(browser: Browser, suffix = 'aaaaaa', extraQuery = '', extraHeaders: Record<string,string> = {}) {
  const ws = new WebSocket(network.replace('https:', 'wss:') + `/api/sync/ws?clientId=E${suffix}${extraQuery}`, { headers: { cookie: browser.cookie(), origin, ...extraHeaders } });
  sockets.add(ws);
  const messages: unknown[] = []; ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
  await new Promise<void>((resolve,reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  return { ws, messages, closed };
}
async function settled(predicate: () => boolean) {
  for (let i=0;i<100;i++) { if (predicate()) return; await new Promise((r)=>setTimeout(r,10)); }
  throw new Error('Timed out waiting for bounded socket condition');
}
describe('central HTTP and established WS', () => {
  it('lets a device initiate OIDC without a Web session and claims only once after browser pairing', async () => {
    const verifier = randomSecret();
    const start = await fetch(`${network}/api/auth/oidc/device/start`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceChallenge: digest(verifier),
        termsAccepted: true, documentVersion: LEGAL_SET_VERSION }) });
    expect(start.status, await start.clone().text()).toBe(200);
    const initiated = await start.json() as { handoffId: string; launchUrl: string; pairingCode: string };
    expect(initiated.launchUrl).not.toContain(verifier);
    const browser = new Browser(), path = new URL(initiated.launchUrl).pathname;
    const first = await browser.request(path), second = await browser.request(path);
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    const page = /name="page" value="([A-Za-z0-9_-]{43})"/.exec(await second.text())?.[1];
    expect(page).toBeTruthy();
    const secret = path.slice(path.lastIndexOf('/') + 1);
    const wrong = await browser.form('/api/auth/oidc/device/launch',
      `launch=${secret}\r\npage=${page}\r\ncode=000000000000\r\n`);
    expect(wrong.status).toBe(410);
    const launched = await browser.form('/api/auth/oidc/device/launch',
      `launch=${secret}\r\npage=${page}\r\ncode=${initiated.pairingCode}\r\n`);
    expect(launched.status, await launched.clone().text()).toBe(303);
    const authorizationUrl = launched.headers.get('location')!;
    expect(authorizationUrl).not.toContain(verifier);
    const callback = await provider.callback(authorizationUrl);
    const result = await browser.request(new URL(callback).pathname + new URL(callback).search);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(browser.cookies.has(CENTRAL_COOKIES.session)).toBe(false);
    const claim = async (value: string) => fetch(`${network}/api/auth/oidc/device/claim`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handoffId: initiated.handoffId, verifier: value }) });
    expect((await claim(randomSecret())).status).toBe(410);
    const delivered = await claim(verifier);
    expect(delivered.status, await delivered.clone().text()).toBe(200);
    const session = await delivered.json() as { token: string; status: string };
    expect(session.status).toBe('claimed'); expect(session.token).toBeTruthy();
    expect((await claim(verifier)).status).toBe(410);
    expect((await fetch(`${network}/private`, { headers: { authorization: `Bearer ${session.token}` } })).status).toBe(200);
  });
  it('completes a real callback with host-only cookie, verified consent and CSRF-protected API; rejects local mint', async () => {
    const browser = new Browser(), response = await browser.login();
    const cookies = response.headers.getSetCookie();
    expect(cookies.filter((c) => c.startsWith(CENTRAL_COOKIES.session + '='))).toHaveLength(1);
    expect(cookies.find((c) => c.startsWith(CENTRAL_COOKIES.session + '='))).toMatch(/Secure;.*HttpOnly/);
    expect(cookies.every((c) => !c.includes('Domain='))).toBe(true);
    const user = await prisma.user.findFirstOrThrow(); expect(user.termsDocumentVersion).toBe(LEGAL_SET_VERSION); expect(user.termsAcceptedAt).not.toBeNull();
    expect((await browser.request('/private')).status).toBe(200);
    expect((await browser.request('/private', 'POST', {})).status).toBe(403);
    expect((await browser.request('/private', 'POST', {}, browser.csrf())).status).toBe(200);
    expect((await browser.request('/private', 'POST', {}, { ...browser.csrf(), origin: 'https://evil.example' })).status).toBe(403);
    const session = await (await browser.request('/api/auth/central/session')).text();
    expect(session).not.toContain(browser.cookies.get(CENTRAL_COOKIES.session));
    for (const material of provider.issued) { expect(session).not.toContain(material.accessToken); expect(session).not.toContain(material.refreshToken); }
    await expect(issueSession({ id: user.id }, { userAgent: 'synthetic' })).rejects.toThrow('central_authentication_required');
  });
  it('refuses forged terms, duplicated callback query/cookies and old or mismatched browser transactions', async () => {
    const browser = new Browser(); await browser.request('/api/auth/central/session');
    expect((await browser.request('/api/auth/oidc/start', 'POST', { termsAccepted: true, documentVersion: 'forged' }, browser.csrf())).status).toBe(400);
    const callback = await browser.start(); const pending = browser.cookies.get(CENTRAL_COOKIES.pending)!;
    const path = new URL(callback).pathname + new URL(callback).search;
    expect((await browser.request(path + '&state=duplicate')).status).toBe(400);
    browser.cookies.set(CENTRAL_COOKIES.pending,pending);
    expect((await browser.request(path, 'GET', undefined, { cookie: `${browser.cookie()}; ${CENTRAL_COOKIES.pending}=${pending}` })).status).toBe(400);
    browser.cookies.set(CENTRAL_COOKIES.pending,pending);
    await browser.start(); expect((await browser.request(path)).status).not.toBe(303);
    expect(await prisma.user.count()).toBe(0);
  });
  it('does not create an account without explicit product consent and never replays a callback into another JWT', async () => {
    const browser = new Browser(), callback = await browser.start(false);
    expect((await browser.request(new URL(callback).pathname + new URL(callback).search)).status).not.toBe(303);
    expect(await prisma.user.count()).toBe(0);
    const callback2 = await browser.start(), pending = browser.cookies.get(CENTRAL_COOKIES.pending)!;
    const path = new URL(callback2).pathname + new URL(callback2).search;
    expect((await browser.request(path)).status).toBe(303);
    const token = browser.cookies.get(CENTRAL_COOKIES.session);
    browser.cookies.set(CENTRAL_COOKIES.pending,pending);
    expect((await browser.request(path)).status).not.toBe(303);
    expect(browser.cookies.get(CENTRAL_COOKIES.session)).toBe(token); expect(await prisma.accessSession.count()).toBe(1);
  });
  it('rechecks warmed HTTP sessions, rejects legacy/no-grant JWT, and only emits ACCOUNT_CLOSED for actual account deletion', async () => {
    const browser = new Browser(); await browser.login(); const token = browser.cookies.get(CENTRAL_COOKIES.session)!;
    expect((await verifyToken(token)).valid).toBe(true); expect((await verifyToken(token)).valid).toBe(true);
    const user = await prisma.user.findFirstOrThrow(); expect(authCache.get(user.id, (await prisma.centralGrant.findFirstOrThrow()).sessionHash!)).toBeDefined();
    for (const extra of [{}, { jti: 'c'.repeat(32) }]) {
      const forged = jwt.sign({ userId: user.id, email: user.email, tokenVersion: user.tokenVersion, ...extra }, process.env.JWT_SECRET!, { expiresIn: '1h' });
      expect(await verifyToken(forged)).toMatchObject({ valid: false, code: 'TOKEN_REVOKED' });
    }
    provider.accesses.clear(); expect(await verifyToken(token)).toMatchObject({ valid: false, code: 'TOKEN_REVOKED' });
    expect(await prisma.user.count()).toBe(1);
    await owner.runtime!.coordinator.closeProductAccount(user.id);
    expect(await verifyToken(token)).toMatchObject({ valid: false, code: 'ACCOUNT_CLOSED' });
  });
  it('closes already established WS after central revoke and does not affect an independently live sibling session', async () => {
    const a = new Browser(); await a.login(); const subject = provider.issued[0].subject;
    const b = new Browser(); await b.login(subject);
    const sa = await socket(a, 'aaaaaa'), sb = await socket(b, 'bbbbbb');
    await settled(() => sa.messages.length > 0 && sb.messages.length > 0);
    sa.messages.length = 0; sb.messages.length = 0;
    provider.accesses.delete(provider.issued[0].accessToken);
    sa.ws.send(JSON.stringify({ type: 'presence_state', payload: 'secret-opaque' }));
    expect(await sa.closed).toBe(4003);
    getWsConnectionService().notifyNewOps((await prisma.user.findFirstOrThrow()).id, 'other-client', 55);
    await settled(() => sb.messages.length > 0);
    expect(sa.messages).toHaveLength(0); expect(JSON.stringify(sb.messages)).not.toContain('secret-opaque');
    expect((await b.request('/private')).status).toBe(200);
  });
  it('returns 503 / WS 1013 on central outage, preserves the account, and permits explicit local logout with durable outbox', async () => {
    const browser = new Browser(); await browser.login(); const s = await socket(browser); await settled(() => s.messages.length > 0);
    const listener = provider.server.listeners('request')[0];
    provider.server.removeAllListeners('request'); provider.server.on('request', (_req,res) => { res.writeHead(503); res.end(); });
    const result = await browser.request('/private'); expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ code: 'CENTRAL_UNAVAILABLE' });
    const retained = browser.cookies.get(CENTRAL_COOKIES.session); expect((await browser.request('/api/auth/central/session')).status).toBe(503); expect(browser.cookies.get(CENTRAL_COOKIES.session)).toBe(retained);
    getWsConnectionService().notifyNewOps((await prisma.user.findFirstOrThrow()).id, 'other', 50);
    expect(await s.closed).toBe(1013); expect(await prisma.user.count()).toBe(1);
    expect((await browser.request(`/api/${SESSION_PATHS.logout}`, 'POST', {}, browser.csrf())).status).toBe(200);
    expect(await prisma.accessSession.count()).toBe(0); expect(await prisma.centralRevocation.count()).toBe(1);
    provider.server.removeAllListeners('request'); provider.server.on('request', listener as never);
    expect((await owner.runtime!.worker.tick()).confirmed).toBe(1);
  });
  it('rechecks and closes an idle real WS at the production heartbeat interval without an application message', async () => {
    const browser = new Browser(); await browser.login(); const s = await socket(browser); await settled(() => s.messages.length > 0);
    const touch = vi.fn(); getWsConnectionService().startHeartbeat(touch); provider.accesses.clear();
    expect(await s.closed).toBe(4003); expect(touch).not.toHaveBeenCalled();
  }, 40_000);
  it('refuses WS URL tokens and cross-site Cookie upgrades', async () => {
    const browser = new Browser(); await browser.login();
    const query = await socket(browser, 'aaaaaa', '&token=' + browser.cookies.get(CENTRAL_COOKIES.session)); expect(await query.closed).toBe(4003);
    const foreign = await socket(browser, 'bbbbbb', '', { origin: 'https://evil.example' }); expect(await foreign.closed).toBe(4003);
    expect(getWsConnectionService().getConnectionCount()).toBe(0);
  });
  it('replace-token revokes the product grants and requires a fresh OIDC login without minting a token', async () => {
    const browser = new Browser(); await browser.login();
    const result = await browser.request('/api/replace-token', 'POST', {}, browser.csrf()); expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ reauthenticationRequired: true, loginPath: '/api/auth/oidc/start' });
    expect(await prisma.accessSession.count()).toBe(0); expect(await prisma.centralGrant.count({ where: { revokedAt: null } })).toBe(0);
    expect(await prisma.centralRevocation.count()).toBe(1);
  });
  it('product revoke-all and administrator logout remove every grant and close established sockets', async () => {
    const browser = new Browser(); await browser.login(); const subject = provider.issued[0].subject;
    const sibling = new Browser(); await sibling.login(subject);
    const ws = await socket(sibling); await settled(() => ws.messages.length > 0);
    const response = await browser.request(`/api/${SESSION_PATHS.revokeAll}`, 'POST', {}, browser.csrf());
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ count: 2 }); expect(await ws.closed).toBe(4003);
    expect(await prisma.accessSession.count()).toBe(0); expect(await prisma.centralRevocation.count()).toBe(2);
    const admin = new Browser(); await admin.login(subject);
    const user = await prisma.user.findFirstOrThrow(); await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    const result = await admin.request(`/api/admin/users/${user.id}/logout`, 'POST', {}, admin.csrf());
    expect(result.status, await result.clone().text()).toBe(200); expect(await prisma.accessSession.count()).toBe(0);
    expect(await prisma.centralGrant.count({ where: { revokedAt: null } })).toBe(0);
  });
  it('device revoke keeps device denial and central revocations in the same transaction, including rollback', async () => {
    const browser = new Browser(); await browser.login(); const user = await prisma.user.findFirstOrThrow();
    const clientId = 'Eaaaaaa';
    await prisma.syncDevice.create({ data: { userId: user.id, clientId, createdAt: BigInt(Date.now()), lastSeenAt: BigInt(Date.now()) } });
    await prisma.automationWorker.create({ data: { id: 'synthetic-worker', userId: user.id, credentialHash: 'f'.repeat(64), syncClientId: clientId, databaseEpoch: 'synthetic-epoch' } });
    await expect(owner.runtime!.coordinator.logoutProduct(user.id, async (tx) => {
      await tx.syncDevice.deleteMany({ where: { userId: user.id } }); throw new Error('synthetic rollback');
    })).rejects.toThrow('synthetic rollback');
    expect(await prisma.syncDevice.count()).toBe(1); expect(await prisma.accessSession.count()).toBe(1); expect(await prisma.centralRevocation.count()).toBe(0);
    const result = await browser.request(`/api/sync/devices/${clientId}`, 'DELETE', undefined, browser.csrf());
    expect(result.status, await result.clone().text()).toBe(200); expect(await result.json()).toMatchObject({ requiresKeyRotation: true });
    expect(await prisma.syncDevice.count()).toBe(0); expect(await prisma.revokedSyncDevice.count()).toBe(1); expect((await prisma.automationWorker.findUniqueOrThrow({ where: { id: 'synthetic-worker' } })).revokedAt).not.toBeNull();
    expect(await prisma.accessSession.count()).toBe(0); expect(await prisma.centralRevocation.count()).toBe(1);
  });
  it('definitive invalid session clears HttpOnly credentials and supplies anonymous CSRF for a fresh login', async () => {
    const browser = new Browser(); await browser.login();
    provider.accesses.clear();
    const result = await browser.request('/api/auth/central/session'); expect(result.status).toBe(401);
    expect((await result.json()).code).toBe('TOKEN_REVOKED'); expect(browser.cookies.has(CENTRAL_COOKIES.session)).toBe(false);
    const start = await browser.request('/api/auth/oidc/start', 'POST', {}, browser.csrf()); expect(start.status).toBe(200);
  });
  it('product account closure writes tombstone and outbox atomically', async () => {
    const browser = new Browser(); await browser.login(); const token = browser.cookies.get(CENTRAL_COOKIES.session)!;
    expect((await browser.request('/api/account', 'DELETE', undefined, browser.csrf())).status).toBe(200);
    expect(await prisma.user.count()).toBe(0); expect(await prisma.accountTombstone.count()).toBe(1); expect(await prisma.centralRevocation.count()).toBe(1);
    expect(await verifyToken(token)).toMatchObject({ code: 'ACCOUNT_CLOSED' });
  });
});
