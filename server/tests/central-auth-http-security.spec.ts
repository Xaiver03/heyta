import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredentialCipher } from '../src/central-auth/crypto';
import { CENTRAL_COOKIES, CentralHttpError, createHttpSecurity, readCentralCredential, setCentralCookie, uniqueCookie } from '../src/central-auth/http-security';
const origin = 'https://heyta.example';
const cipher = new CredentialCipher('a1'.repeat(32));
const security = createHttpSecurity(cipher, origin);
afterEach(() => vi.useRealTimers());
function headers(csrf: string, extra: Record<string, string | undefined> = {}) { return { origin, cookie: `${CENTRAL_COOKIES.csrf}=${csrf}`, 'x-csrf-token': csrf, ...extra }; }
async function csrf(token?: string) {
  const app = Fastify();
  app.get('/', async (_req, reply) => ({ csrf: security.csrf(reply, token) }));
  const response = await app.inject('/'); await app.close(); return response;
}
describe('central HTTP credential binding', () => {
  it('sets host-only Secure session/pending HttpOnly cookies and a readable no-store CSRF cookie', async () => {
    const app = Fastify();
    app.get('/', async (_req, reply) => { setCentralCookie(reply, 'session', 'synthetic.token', 10); security.writePending(reply, { browser: 'a'.repeat(43), pendingId: 'pending' }); return { csrf: security.csrf(reply) }; });
    const response = await app.inject('/'); await app.close();
    const cookies = response.headers['set-cookie'] as string[];
    expect(cookies).toHaveLength(3); expect(response.headers['cache-control']).toBe('no-store');
    for (const value of cookies) { expect(value).toContain('Secure'); expect(value).toContain('Path=/'); expect(value).toContain('SameSite=Lax'); expect(value).not.toContain('Domain='); }
    expect(cookies[0]).toContain('HttpOnly'); expect(cookies[1]).toContain('HttpOnly'); expect(cookies[2]).not.toContain('HttpOnly');
  });
  it('binds anonymous and authenticated CSRF proofs to separate sessions', async () => {
    const value = (await csrf('session-a')).json().csrf;
    expect(() => security.verifyCsrf({ headers: headers(value) }, 'session-a')).not.toThrow();
    for (const token of [undefined, 'session-b']) expect(() => security.verifyCsrf({ headers: headers(value) }, token)).toThrow(CentralHttpError);
    const anon = (await csrf()).json().csrf;
    expect(() => security.verifyCsrf({ headers: headers(anon) })).not.toThrow();
    expect(() => security.verifyCsrf({ headers: headers(anon) }, 'session-a')).toThrow();
  });
  it('refuses foreign/missing Origin, cross-site metadata, tampering and Unicode mismatch without RangeError', async () => {
    const value = (await csrf()).json().csrf;
    for (const extra of [{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'x-csrf-token': '界'.repeat(value.length) }])
      expect(() => security.verifyCsrf({ headers: headers(value, extra) })).toThrow(CentralHttpError);
    expect(() => security.verifyCsrf({ headers: headers('tampered') })).toThrow(CentralHttpError);
  });
  it('expires CSRF and rejects purpose confusion', async () => {
    vi.useFakeTimers();
    const value = (await csrf()).json().csrf;
    vi.advanceTimersByTime(600_001);
    expect(() => security.verifyCsrf({ headers: headers(value) })).toThrow(CentralHttpError);
    expect(() => security.readPending({ headers: { cookie: `${CENTRAL_COOKIES.pending}=${value}` } })).toThrow(CentralHttpError);
  });
  it('requires a same-origin launch confirmation bound to its cookie and page secret', async () => {
    const launchSecret = 'a'.repeat(43);
    const app = Fastify();
    app.get('/', async (_req, reply) => ({ page: security.writeLaunchPage(reply, launchSecret) }));
    const response = await app.inject('/'); await app.close();
    const page = response.json().page as string;
    const launchCookie = (response.headers['set-cookie'] as string[])[0]!.split(';')[0]!;
    expect(launchCookie).toContain(`${CENTRAL_COOKIES.launch}=`);
    expect((response.headers['set-cookie'] as string[])[0]).toContain('HttpOnly');
    expect(() => security.verifyLaunchPage({ headers: { origin, cookie: launchCookie } }, launchSecret, page)).not.toThrow();
    for (const headers of [
      { origin: 'https://evil.example', cookie: launchCookie },
      { origin, cookie: `${launchCookie}; ${launchCookie}` },
      { origin, cookie: `${CENTRAL_COOKIES.launch}=invalid` },
      { origin, cookie: launchCookie, 'sec-fetch-site': 'cross-site' },
    ]) expect(() => security.verifyLaunchPage({ headers }, launchSecret, page)).toThrow(CentralHttpError);
    expect(() => security.verifyLaunchPage({ headers: { origin, cookie: launchCookie } }, 'b'.repeat(43), page)).toThrow();
    expect(() => security.verifyLaunchPage({ headers: { origin, cookie: launchCookie } }, launchSecret, 'b'.repeat(43))).toThrow();
    vi.useFakeTimers();
    vi.advanceTimersByTime(600_001);
    expect(() => security.verifyLaunchPage({ headers: { origin, cookie: launchCookie } }, launchSecret, page)).toThrow(CentralHttpError);
  });
  it('rejects duplicate, oversized, empty and ambiguous credentials; never falls back', () => {
    expect(() => uniqueCookie(`${CENTRAL_COOKIES.session}=a; ${CENTRAL_COOKIES.session}=b`, CENTRAL_COOKIES.session)).toThrow();
    expect(() => uniqueCookie('x'.repeat(16385), CENTRAL_COOKIES.session)).toThrow();
    expect(() => readCentralCredential({ headers: { cookie: `${CENTRAL_COOKIES.session}=`, authorization: 'Bearer valid' } })).toThrow();
    expect(() => readCentralCredential({ headers: { cookie: `${CENTRAL_COOKIES.session}=` } })).toThrow();
    for (const authorization of ['Bearer  token', 'bearer token', 'Bearer token extra']) expect(() => readCentralCredential({ headers: { authorization } })).toThrow();
    expect(readCentralCredential({ headers: { authorization: 'Bearer token' } })).toEqual({ token: 'token', transport: 'bearer' });
  });
});
