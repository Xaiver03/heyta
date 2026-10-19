/** MIT interoperability driver. Loads the separately installed central service as
 * an external test dependency; no central implementation or test code is copied.
 * Run through verify-central-oidc.mjs --central for a verified temporary TLS CA.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { CentralAuthRepository } = require('../dist/src/central-auth/repository.js');
const { CredentialCipher, digest, randomSecret } = require('../dist/src/central-auth/crypto.js');
const { createCentralOidcClient } = require('../dist/src/central-auth/oidc-client.js');
const centralRoot = process.env.HEYTA_CENTRAL_SERVER_ROOT;
const productUrl = process.env.HEYTA_CENTRAL_TEST_DATABASE_URL;
if (!centralRoot || !productUrl) throw new Error('Explicit central source root and isolated product PostgreSQL URL required');
const target = new URL(productUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && /^\/heyta_central_auth_oidc[a-z0-9_]*test$/.test(target.pathname) && !target.search && !target.hash);
const external = (path) => import(pathToFileURL(resolve(centralRoot, path)).href);
// This helper validates an independent localhost-only OIDC_TEST_DATABASE_URL.
const fixture = await external('apps/identity-server/test/postgres-helper.js');
const { createIdentityServer } = await external('apps/identity-server/src/server.js');
const { CREDENTIAL_COOKIE } = await external('apps/identity-server/src/authority.js');
const schema = await fixture.createPostgresSchema();
const centralDb = fixture.newDb(schema);
const productDb = new PrismaClient({ datasources: { db: { url: productUrl } } });
const repo = new CentralAuthRepository(productDb, new CredentialCipher('55'.repeat(32)));
let identity, account;
const listener = createServer({ key: readFileSync(process.env.HEYTA_OIDC_TEST_KEY), cert: readFileSync(process.env.HEYTA_OIDC_TEST_CERT) }, (req, res) => {
  if (!identity) { res.writeHead(503); res.end(); return; }
  // Use the real central request listener on an encrypted socket with its exact Host.
  identity.server.emit('request', req, res);
});
const audit = [];
const check = (name, value) => { assert.ok(value, name); audit.push(name); };
try {
  await new Promise((done) => listener.listen(0, '127.0.0.1', done));
  const origin = `https://127.0.0.1:${listener.address().port}`;
  const issuer = `${origin}/api/oidc`;
  const redirectUri = 'https://heyta.example.test/api/auth/oidc/callback';
  const clientId = `heyta-${randomSecret()}`, clientSecret = randomSecret();
  account = await fixture.createFixture(centralDb, { clientId, clientSecret, confidential: true, redirectUris: [redirectUri] });
  const outsiderSecret = randomSecret();
  const outsider = await fixture.createFixture(centralDb, { clientId: `other-${randomSecret()}`, clientSecret: outsiderSecret, confidential: true, redirectUris: [redirectUri] });
  // Start from the central service's exported test configuration interface.
  const config = fixture.providerConfig({ clientId, clientSecret, confidential: true, redirectUris: [redirectUri], jwks: fixture.makeKeySet().jwks });
  config.issuer = issuer; config.centralLoginUrl = `${origin}/login`;
  config.clients.push(...fixture.providerConfig({ clientId: outsider.client.id, clientSecret: outsiderSecret, confidential: true, redirectUris: [redirectUri] }).clients);
  identity = await createIdentityServer({ db: centralDb, config });
  const oidc = await createCentralOidcClient({ mode: 'oidc', deployment: 'official', issuer, clientId, clientSecret,
    redirectUri, sessionEncryptionKey: '55'.repeat(32) }, repo);
  async function authorize() {
    const browser = randomSecret();
    const pending = await oidc.begin({ browser });
    const cookies = new Map([[CREDENTIAL_COOKIE, account.credentialValue]]);
    let next = pending.authorizationUrl;
    for (let step = 0; step < 12; step++) {
      const response = await fetch(next, { redirect: 'manual', headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0], split = pair.indexOf('='); cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      if (response.status === 200) {
        const page = await response.text();
        const csrf = page.match(/name="csrf" value="([^"]+)"/)?.[1];
        assert.ok(csrf, 'real central consent CSRF');
        const consent = await fetch(next, { method: 'POST', redirect: 'manual', headers: { origin,
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ csrf, decision: 'approve' }) });
        for (const cookie of consent.headers.getSetCookie()) {
          const pair = cookie.split(';', 1)[0], split = pair.indexOf('='); cookies.set(pair.slice(0, split), pair.slice(split + 1));
        }
        assert.equal(consent.status, 303, 'real central consent response');
        next = consent.headers.get('location');
      } else {
        assert.ok([302, 303].includes(response.status), 'real central authorization redirect');
        next = response.headers.get('location');
      }
      assert.ok(next, 'authorization location');
      if (next.startsWith(`${redirectUri}?`)) {
        const result = await oidc.exchange({ browser, callbackUrl: next });
        const { grantId } = await repo.completeAuthorization({ attemptId: result.attemptId, subject: result.subject,
          rootSid: result.rootSid, sessionHash: digest(randomSecret()), expiresAt: Date.now() + 3600_000,
          newUser: { email: account.account.primaryEmail, termsAcceptedAt: Date.now(), termsDocumentVersion: 'test@1' } });
        return { result, grantId, browser, callbackUrl: next };
      }
      assert.equal(new URL(next).origin, origin, 'redirect stays on the trusted central issuer');
    }
    throw new Error('real central authorization exceeded step bound');
  }
  const a = await authorize(), b = await authorize();
  check('real ES256 discovery/code/PKCE/JWKS flow', a.result.subject === account.subject);
  check('A/B authorizations own separate grants', a.grantId !== b.grantId);
  check('same central identity is reused without email merge', await productDb.centralIdentity.count({ where: { issuer } }) === 1);
  check('real auth_time is not replaced by token iat', a.result.authTime === Math.floor(account.credential.authenticatedAt.getTime() / 1000) * 1000);
  const first = await productDb.centralGrant.findUniqueOrThrow({ where: { id: a.grantId } });
  const cipher = new CredentialCipher('55'.repeat(32));
  const old = cipher.open(`grant:${first.id}:${first.version}`, first.tokensCipher);
  const user = await oidc.userInfo(old.accessToken, a.result.subject);
  check('real userinfo subject binding', user.subject === account.subject);
  check('real userinfo verified email', user.verifiedEmail === account.account.primaryEmail);
  const outsiderOidc = await createCentralOidcClient({ mode: 'oidc', deployment: 'official', issuer, clientId: outsider.client.id,
    clientSecret: outsiderSecret, redirectUri, sessionEncryptionKey: '66'.repeat(32) }, repo);
  await assert.rejects(outsiderOidc.introspect(old.accessToken, a.result.subject));
  check('real issuer rejects opaque access introspection by another client', true);
  const refresh = await oidc.refresh(a.grantId);
  check('real refresh material is durable before application', (await repo.inspectAttempt(refresh.attemptId)).status === 'RESULT');
  const rotated = await repo.readResult(refresh.attemptId);
  check('real refresh rotates the opaque credential', rotated.tokens.refreshToken !== old.refreshToken);
  await repo.completeRefresh(refresh.attemptId, Date.now() + 3600_000);
  await assert.rejects(oidc.exchange({ browser: a.browser, callbackUrl: a.callbackUrl }));
  check('duplicate real callback cannot redispatch', true);
  await oidc.revoke(rotated.tokens.refreshToken, 'refresh_token');
  await assert.rejects(oidc.introspect(rotated.tokens.accessToken, a.result.subject));
  const second = await productDb.centralGrant.findUniqueOrThrow({ where: { id: b.grantId } });
  const other = cipher.open(`grant:${second.id}:${second.version}`, second.tokensCipher);
  check('revoking A leaves real grant B active', (await oidc.introspect(other.accessToken, b.result.subject)).subject === b.result.subject);
  await oidc.revoke(other.refreshToken, 'refresh_token');
  process.stdout.write(JSON.stringify({ ok: true, assertions: audit, tlsVerification: true, service: 'external central identity-server', databases: 'two isolated PostgreSQL stores' }, null, 2) + '\n');
} finally {
  listener.closeAllConnections();
  await new Promise((done) => listener.close(done));
  if (account) {
    const grants = await productDb.centralGrant.findMany({ where: { issuer: identity?.config.issuer }, select: { id: true } });
    for (const grant of grants) await repo.revokeGrant(grant.id);
    // All these rows are confined to the explicit isolated test database.
    await productDb.centralRevocation.deleteMany(); await productDb.centralGrant.deleteMany(); await productDb.centralAttempt.deleteMany();
    await productDb.centralPending.deleteMany(); await productDb.centralIdentity.deleteMany();
    await productDb.user.deleteMany({ where: { email: account.account.primaryEmail } });
  }
  await productDb.$disconnect(); await centralDb.$disconnect(); await fixture.dropPostgresSchema(schema);
}
