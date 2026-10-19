/** Official Web cookie-session transport.
 *
 * This is deliberately separate from hosted-auth.ts.  The latter is the
 * self-hosted bearer protocol; official Web authentication never returns a
 * product token to JavaScript.  The browser only carries the host-only
 * HttpOnly cookie issued by the product server.
 */
import { CENTRAL_AUTH_PATHS } from '@heyta/shared-schema';
import { joinEndpointUrl } from './endpoint-url.js';

export type CentralAuthUser = { id: number; email: string };
/** In-memory UI marker; it is never a credential and must never be persisted or sent. */
export const CENTRAL_COOKIE_SESSION_MARKER = '__heyta_cookie_session__';
export type CentralAuthConfig = {
  mode: 'oidc' | 'local';
  loginPath: typeof CENTRAL_AUTH_PATHS.start;
  documentVersion: string | null;
};
export type CentralAuthSession =
  | { authenticated: false; csrfToken: string }
  | { authenticated: true; user: CentralAuthUser; csrfToken: string };
export type CentralAuthFailureReason = 'network' | 'unavailable' | 'rejected' | 'malformed-response';
export type CentralAuthFailure = { ok: false; reason: CentralAuthFailureReason; status?: number };

export type CentralAuthOutcome<T> = { ok: true; value: T } | CentralAuthFailure;

export interface CentralAuthOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const fetchFor = (options: CentralAuthOptions): typeof fetch | undefined =>
  options.fetchImpl ?? globalThis.fetch?.bind(globalThis);

const parseJson = async (response: Response): Promise<unknown> => {
  try { return await response.json(); } catch { return undefined; }
};

const originUrl = (baseUrl: string, path: string): string => joinEndpointUrl(baseUrl, path);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validCsrf(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value) && value.length > 0;
}

export async function getCentralAuthConfig(options: CentralAuthOptions): Promise<CentralAuthOutcome<CentralAuthConfig>> {
  const fetchImpl = fetchFor(options);
  if (fetchImpl === undefined || options.baseUrl.trim() === '') return { ok: false, reason: 'network' };
  try {
    const response = await fetchImpl(originUrl(options.baseUrl, CENTRAL_AUTH_PATHS.config), {
      method: 'GET', credentials: 'include', headers: { accept: 'application/json' },
    });
    const body = await parseJson(response);
    if (!response.ok) return { ok: false, reason: response.status === 409 ? 'unavailable' : 'rejected', status: response.status };
    if (!record(body) || (body.mode !== 'oidc' && body.mode !== 'local') ||
        body.loginPath !== CENTRAL_AUTH_PATHS.start ||
        (body.documentVersion !== null && typeof body.documentVersion !== 'string')) {
      return { ok: false, reason: 'malformed-response', status: response.status };
    }
    return { ok: true, value: {
      mode: body.mode,
      loginPath: CENTRAL_AUTH_PATHS.start,
      documentVersion: body.documentVersion as string | null,
    } };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export async function getCentralAuthSession(options: CentralAuthOptions): Promise<CentralAuthOutcome<CentralAuthSession>> {
  const fetchImpl = fetchFor(options);
  if (fetchImpl === undefined || options.baseUrl.trim() === '') return { ok: false, reason: 'network' };
  try {
    const response = await fetchImpl(originUrl(options.baseUrl, CENTRAL_AUTH_PATHS.session), {
      method: 'GET', credentials: 'include', headers: { accept: 'application/json' },
    });
    const body = await parseJson(response);
    if (response.status === 401 || response.status === 410) {
      if (!record(body) || !validCsrf(body.csrfToken)) return { ok: false, reason: 'malformed-response', status: response.status };
      return { ok: true, value: { authenticated: false, csrfToken: body.csrfToken } };
    }
    if (!response.ok) return { ok: false, reason: response.status === 409 ? 'unavailable' : 'rejected', status: response.status };
    if (!record(body) || body.authenticated !== false && body.authenticated !== true || !validCsrf(body.csrfToken))
      return { ok: false, reason: 'malformed-response', status: response.status };
    if (body.authenticated === false) return { ok: true, value: { authenticated: false, csrfToken: body.csrfToken } };
    const user = body.user;
    const userId = record(user) ? user.id : undefined;
    const userEmail = record(user) ? user.email : undefined;
    if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0 || typeof userEmail !== 'string' || userEmail === '')
      return { ok: false, reason: 'malformed-response', status: response.status };
    return { ok: true, value: { authenticated: true, user: { id: userId as number, email: userEmail }, csrfToken: body.csrfToken } };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export async function beginCentralAuth(
  options: CentralAuthOptions & { csrfToken: string; termsAccepted?: boolean; documentVersion?: string },
): Promise<CentralAuthOutcome<{ authorizationUrl: string }>> {
  const fetchImpl = fetchFor(options);
  if (fetchImpl === undefined || options.baseUrl.trim() === '' || !validCsrf(options.csrfToken)) return { ok: false, reason: 'rejected' };
  try {
    const body = options.termsAccepted === true
      ? { termsAccepted: true, documentVersion: options.documentVersion }
      : {};
    const response = await fetchImpl(originUrl(options.baseUrl, CENTRAL_AUTH_PATHS.start), {
      method: 'POST', credentials: 'include',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': options.csrfToken },
      body: JSON.stringify(body),
      redirect: 'error',
    });
    const value = await parseJson(response);
    if (!response.ok) return { ok: false, reason: response.status === 409 ? 'unavailable' : 'rejected', status: response.status };
    if (!record(value) || typeof value.authorizationUrl !== 'string' || value.authorizationUrl === '')
      return { ok: false, reason: 'malformed-response', status: response.status };
    let url: URL;
    try { url = new URL(value.authorizationUrl); } catch { return { ok: false, reason: 'malformed-response', status: response.status }; }
    if (url.protocol !== 'https:') return { ok: false, reason: 'malformed-response', status: response.status };
    return { ok: true, value: { authorizationUrl: url.href } };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export function createCentralCookieFetch(
  baseUrl: string,
  getCsrfToken: () => string | undefined,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  const origin = new URL(baseUrl).origin;
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin);
    const method = (init.method ?? (typeof input === 'object' && !(input instanceof URL) ? input.method : undefined) ?? 'GET').toUpperCase();
    const headers = new Headers(typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    // Cookie sessions must never be sent with a second credential source.
    headers.delete('authorization');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && url.origin === origin) {
      const csrf = getCsrfToken();
      if (csrf !== undefined) headers.set('x-csrf-token', csrf);
    }
    return fetchImpl(url.href, { ...init, headers, credentials: 'include' });
  };
}
