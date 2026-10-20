import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { CredentialCipher, digest, randomSecret } from './crypto';

export const CENTRAL_COOKIES = { session: '__Host-heyta-session', csrf: '__Host-heyta-csrf',
  pending: '__Host-heyta-oidc', launch: '__Host-heyta-launch' } as const;
const TEN_MINUTES = 600_000;
export class CentralHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export function uniqueCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  if (header.length > 16384) throw new CentralHttpError(400, 'invalid_cookie');
  const values = header.split(';').map((s) => s.trim()).filter((s) => s.slice(0, s.indexOf('=')) === name);
  if (values.length > 1) throw new CentralHttpError(400, 'invalid_cookie');
  return values[0]?.slice(name.length + 1);
}
function append(reply: FastifyReply, value: string) {
  const old = reply.getHeader('set-cookie');
  reply.removeHeader('set-cookie');
  reply.header('set-cookie', [...(Array.isArray(old) ? old.map(String) : old ? [String(old)] : []), value]);
}
export function setCentralCookie(reply: FastifyReply, kind: keyof typeof CENTRAL_COOKIES, value: string, maxAge: number) {
  if (!/^[A-Za-z0-9_.-]*$/.test(value)) throw new Error('Invalid cookie encoding');
  append(reply, `${CENTRAL_COOKIES[kind]}=${value}; Path=/; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${kind === 'csrf' ? '' : '; HttpOnly'}`);
  reply.header('Cache-Control', 'no-store');
}
export function clearCentralSession(reply: FastifyReply) {
  setCentralCookie(reply, 'session', '', 0); setCentralCookie(reply, 'csrf', '', 0);
}
export function requireSameOrigin(req: Pick<FastifyRequest, 'headers'>, origin: string) {
  if (req.headers.origin !== origin || (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin'))
    throw new CentralHttpError(403, 'forbidden');
}
export function createHttpSecurity(cipher: CredentialCipher, origin: string) {
  function csrf(reply: FastifyReply, token?: string) {
    const value = cipher.seal('http-csrf', { random: randomSecret(), binding: token ? digest(token) : null, expires: Date.now() + TEN_MINUTES });
    setCentralCookie(reply, 'csrf', value, TEN_MINUTES / 1000);
    return value;
  }
  function verifyCsrf(req: Pick<FastifyRequest, 'headers'>, token?: string) {
    requireSameOrigin(req, origin);
    const cookie = uniqueCookie(req.headers.cookie, CENTRAL_COOKIES.csrf), header = req.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || Buffer.byteLength(cookie) !== Buffer.byteLength(header) ||
        !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) throw new CentralHttpError(403, 'forbidden');
    try {
      const data = cipher.open<{ binding: string | null; expires: number }>('http-csrf', cookie);
      if (data.binding !== (token ? digest(token) : null) || !Number.isSafeInteger(data.expires) || data.expires <= Date.now()) throw new Error();
    } catch { throw new CentralHttpError(403, 'forbidden'); }
  }
  return { csrf, verifyCsrf,
    writeLaunchPage(reply: FastifyReply, launchSecret: string) {
      const page = randomSecret();
      setCentralCookie(reply, 'launch', cipher.seal('http-launch', {
        launchHash: digest(launchSecret), pageHash: digest(page), expires: Date.now() + TEN_MINUTES,
      }), TEN_MINUTES / 1000);
      return page;
    },
    verifyLaunchPage(req: Pick<FastifyRequest, 'headers'>, launchSecret: string, page: string) {
      requireSameOrigin(req, origin);
      try {
        if (!/^[A-Za-z0-9_-]{43}$/.test(launchSecret) || !/^[A-Za-z0-9_-]{43}$/.test(page)) throw new Error();
        const cookie = uniqueCookie(req.headers.cookie, CENTRAL_COOKIES.launch);
        if (!cookie) throw new Error();
        const data = cipher.open<{ launchHash: string; pageHash: string; expires: number }>('http-launch', cookie);
        const launch = Buffer.from(digest(launchSecret), 'hex'), expectedLaunch = Buffer.from(data.launchHash, 'hex');
        const actualPage = Buffer.from(digest(page), 'hex'), expectedPage = Buffer.from(data.pageHash, 'hex');
        if (launch.length !== expectedLaunch.length || actualPage.length !== expectedPage.length ||
            !timingSafeEqual(launch, expectedLaunch) || !timingSafeEqual(actualPage, expectedPage) ||
            !Number.isSafeInteger(data.expires) || data.expires <= Date.now()) throw new Error();
      } catch { throw new CentralHttpError(403, 'forbidden'); }
    },
    writePending(reply: FastifyReply, data: { browser: string; pendingId: string; terms?: { acceptedAt: number; documentVersion: string } }) {
      setCentralCookie(reply, 'pending', cipher.seal('http-pending', { ...data, expires: Date.now() + TEN_MINUTES }), TEN_MINUTES / 1000);
    },
    readPending(req: Pick<FastifyRequest, 'headers'>) {
      try {
        const cookie = uniqueCookie(req.headers.cookie, CENTRAL_COOKIES.pending);
        if (!cookie) throw new Error();
        const data = cipher.open<{ browser: string; pendingId: string; expires: number; terms?: { acceptedAt: number; documentVersion: string } }>('http-pending', cookie);
        if (!Number.isSafeInteger(data.expires) || data.expires <= Date.now() || !/^[A-Za-z0-9_-]{43}$/.test(data.browser)) throw new Error();
        return data;
      } catch { throw new CentralHttpError(400, 'invalid_callback'); }
    },
  };
}
/** Never fall back from a bad Cookie to an Authorization header. */
export function readCentralCredential(req: Pick<FastifyRequest, 'headers'>) {
  const cookie = uniqueCookie(req.headers.cookie, CENTRAL_COOKIES.session), auth = req.headers.authorization;
  if (cookie !== undefined && auth !== undefined) throw new CentralHttpError(400, 'ambiguous_credentials');
  if (cookie !== undefined) {
    if (!cookie) throw new CentralHttpError(401, 'TOKEN_INVALID');
    return { token: cookie, transport: 'cookie' as const };
  }
  if (!auth || !/^Bearer [^\s]+$/.test(auth)) throw new CentralHttpError(401, 'TOKEN_INVALID');
  return { token: auth.slice(7), transport: 'bearer' as const };
}
