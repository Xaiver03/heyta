/** Independent MIT protocol fixture. Real TLS and ES256; no application issuer code. */
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';

export type Mode = 'good' | 'bad-signature' | 'bad-alg' | 'bad-issuer' | 'bad-audience' | 'bad-nonce' |
  'expired' | 'future-auth' | 'no-auth' | 'wrong-subject' | 'no-id' | 'wrong-client' | 'inactive' |
  'wrong-type' | 'expired-access' | 'wrong-userinfo' | 'unverified-email' | 'error-material' |
  'bad-json' | 'redirect' | 'oversize' | 'slow-body' | 'drop-response' | 'delay';
type Grant = { subject: string; nonce: string; challenge: string; mode: Mode; authTime: number };
const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
export class CentralOidcProvider {
  readonly clientId = 'heyta-fixture';
  readonly secret = 'synthetic-central-secret';
  readonly redirectUri = 'https://heyta.example.test/api/auth/oidc/callback';
  readonly keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  readonly otherKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  readonly codes = new Map<string, Grant>();
  readonly refreshes = new Map<string, Grant>();
  readonly accesses = new Map<string, Grant>();
  readonly requests: { path: string; method: string }[] = [];
  readonly issued: { accessToken: string; refreshToken: string; subject: string }[] = [];
  nextMode: Mode = 'good';
  nextRefreshMode: Mode = 'good';
  metadataPatch: Record<string, unknown> = {};
  tokenPosts = 0;
  revocations = 0;
  issuer = '';
  server!: Server;
  async start() {
    const cert = process.env.HEYTA_OIDC_TEST_CERT, key = process.env.HEYTA_OIDC_TEST_KEY;
    if (!cert || !key) throw new Error('Use verify-central-oidc.mjs to supply the test CA');
    this.server = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, async (req, res) => {
      const url = new URL(req.url!, this.issuer);
      this.requests.push({ path: url.pathname, method: req.method! });
      const json = (body: unknown, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
      };
      if (url.pathname.endsWith('/.well-known/openid-configuration')) {
        return json({ issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`,
          userinfo_endpoint: `${this.issuer}/userinfo`, introspection_endpoint: `${this.issuer}/introspect`,
          revocation_endpoint: `${this.issuer}/revoke`, jwks_uri: `${this.issuer}/jwks`,
          id_token_signing_alg_values_supported: ['ES256'], code_challenge_methods_supported: ['S256'],
          response_types_supported: ['code'], subject_types_supported: ['public'],
          authorization_response_iss_parameter_supported: true, ...this.metadataPatch });
      }
      if (url.pathname.endsWith('/jwks')) return json({ keys: [{ ...this.keys.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'ES256', use: 'sig' }] });
      if (url.pathname.endsWith('/authorize')) {
        if (url.searchParams.get('client_id') !== this.clientId || url.searchParams.get('redirect_uri') !== this.redirectUri ||
          url.searchParams.get('code_challenge_method') !== 'S256') return json({ error: 'invalid_request' }, 400);
        const code = randomUUID();
        this.codes.set(code, { subject: randomUUID(), nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')!,
          mode: this.nextMode, authTime: Math.floor(Date.now() / 1000) - 3600 });
        this.nextMode = 'good';
        const callback = new URL(this.redirectUri);
        callback.search = new URLSearchParams({ code, state: url.searchParams.get('state')!, iss: this.issuer }).toString();
        res.writeHead(302, { location: callback.href }); res.end(); return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      if (url.pathname.endsWith('/token') || url.pathname.endsWith('/introspect') || url.pathname.endsWith('/revoke')) {
        const basic = Buffer.from(req.headers.authorization?.slice(6) || '', 'base64').toString().split(':').map((part) => decodeURIComponent(part.replace(/\+/g, ' ')));
        if (!req.headers.authorization?.startsWith('Basic ') || basic.length !== 2 || basic[0] !== this.clientId || basic[1] !== this.secret) return json({ error: 'invalid_client' }, 401);
      }
      if (url.pathname.endsWith('/token')) {
        this.tokenPosts++;
        const refreshing = params.get('grant_type') === 'refresh_token';
        const grant = refreshing ? this.refreshes.get(params.get('refresh_token')!) : this.codes.get(params.get('code')!);
        if (!grant || (!refreshing && (params.get('redirect_uri') !== this.redirectUri || hash(params.get('code_verifier')!) !== grant.challenge))) return json({ error: 'invalid_grant' }, 400);
        if (refreshing) { this.refreshes.delete(params.get('refresh_token')!); grant.mode = this.nextRefreshMode; }
        else this.codes.delete(params.get('code')!);
        const accessToken = randomUUID(), refreshToken = randomUUID();
        this.accesses.set(accessToken, { ...grant }); this.refreshes.set(refreshToken, { ...grant });
        this.issued.push({ accessToken, refreshToken, subject: grant.subject });
        const now = Math.floor(Date.now() / 1000);
        const claims: Record<string, unknown> = {
          iss: this.issuer, aud: this.clientId, sub: grant.subject, nonce: grant.nonce, iat: now, exp: now + 300,
          auth_time: grant.authTime, sid: 'shared-central-root',
        };
        const mode = grant.mode;
        if (mode === 'bad-issuer') claims.iss = 'https://wrong.example.test';
        if (mode === 'bad-audience') claims.aud = 'another-client';
        if (mode === 'bad-nonce') claims.nonce = 'wrong-nonce';
        if (mode === 'expired') claims.exp = now - 30;
        if (mode === 'future-auth') claims.auth_time = now + 60;
        if (mode === 'no-auth') delete claims.auth_time;
        if (mode === 'wrong-subject') claims.sub = 'different-subject';
        const header = Buffer.from(JSON.stringify({ alg: mode === 'bad-alg' ? 'HS256' : 'ES256', kid: 'fixture' })).toString('base64url');
        const payload = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
        const signature = sign('sha256', Buffer.from(payload), { key: mode === 'bad-signature' ? this.otherKeys.privateKey : this.keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
        const response = { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 300,
          ...(mode === 'no-id' ? {} : { id_token: `${payload}.${signature}` }) };
        if (mode === 'drop-response') { res.destroy(); return; }
        if (mode === 'bad-json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{broken'); return; }
        if (mode === 'redirect') { res.writeHead(307, { location: `${this.issuer}/retry` }); res.end(); return; }
        if (mode === 'oversize') { json({ ...response, extra: 'x'.repeat(70_000) }); return; }
        if (mode === 'slow-body') {
          res.writeHead(200, { 'content-type': 'application/json' }); res.write('{');
          // Deliberately unfinished until the client timeout destroys the socket.
          return;
        }
        if (mode === 'delay') await new Promise((resolve) => setTimeout(resolve, 80));
        return json(mode === 'error-material' ? { error: 'invalid_grant', ...response } : response, mode === 'error-material' ? 400 : 200);
      }
      if (url.pathname.endsWith('/introspect')) {
        const grant = this.accesses.get(params.get('token')!);
        if (!grant) return json({ active: false });
        return json({ active: grant.mode !== 'inactive', sub: grant.subject, client_id: grant.mode === 'wrong-client' ? 'other-client' : this.clientId,
          token_type: grant.mode === 'wrong-type' ? 'DPoP' : 'Bearer', exp: Math.floor(Date.now() / 1000) + (grant.mode === 'expired-access' ? -30 : 300) });
      }
      if (url.pathname.endsWith('/userinfo')) {
        const grant = this.accesses.get(req.headers.authorization?.slice(7) || '');
        if (!grant) return json({ error: 'invalid_token' }, 401);
        return json({ sub: grant.mode === 'wrong-userinfo' ? 'other' : grant.subject, email: 'fixture@central.test', email_verified: grant.mode !== 'unverified-email' });
      }
      if (url.pathname.endsWith('/revoke')) {
        this.revocations++;
        this.accesses.delete(params.get('token')!); this.refreshes.delete(params.get('token')!);
        return json({});
      }
      json({ error: 'not_found' }, 404);
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.issuer = `https://127.0.0.1:${(this.server.address() as AddressInfo).port}/oidc`;
    return this;
  }
  config() {
    return { mode: 'oidc' as const, deployment: 'official' as const, issuer: this.issuer, clientId: this.clientId,
      clientSecret: this.secret, redirectUri: this.redirectUri, sessionEncryptionKey: '44'.repeat(32) };
  }
  async callback(url: string) {
    const response = await fetch(url, { redirect: 'manual' });
    if (response.status !== 302) throw new Error('Fixture authorization failed');
    return response.headers.get('location')!;
  }
  async close() {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
