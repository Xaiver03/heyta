import { describe, expect, it, vi } from 'vitest';

import {
  beginCentralAuth,
  createCentralCookieFetch,
  getCentralAuthConfig,
  getCentralAuthSession,
} from '../src/central-auth.js';

function response(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe('官方 Web 中央认证客户端', () => {
  it('严格读取配置，并为请求使用 Cookie transport', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('include');
      return response({ mode: 'oidc', loginPath: '/api/auth/oidc/start', documentVersion: 'v1' });
    });
    const result = await getCentralAuthConfig({ baseUrl: 'https://heyta.example', fetchImpl });
    expect(result).toEqual({ ok: true, value: { mode: 'oidc', loginPath: '/api/auth/oidc/start', documentVersion: 'v1' } });
  });

  it('读取匿名会话的 CSRF，并以同一枚 CSRF 发起 OIDC', async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      if (calls.length === 1) return response({ authenticated: false, csrfToken: 'csrf-token' });
      return response({ authorizationUrl: 'https://identity.example/authorize?state=s' });
    });
    const session = await getCentralAuthSession({ baseUrl: 'https://heyta.example', fetchImpl });
    expect(session.ok && session.value.csrfToken).toBe('csrf-token');
    const started = await beginCentralAuth({
      baseUrl: 'https://heyta.example',
      csrfToken: session.ok ? session.value.csrfToken : '',
      termsAccepted: true,
      documentVersion: 'v1',
      fetchImpl,
    });
    expect(started).toEqual({ ok: true, value: { authorizationUrl: 'https://identity.example/authorize?state=s' } });
    expect(new Headers(calls[1]?.headers).get('x-csrf-token')).toBe('csrf-token');
  });

  it('Cookie fetch 清掉 Authorization，并只在同源写 CSRF', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => response({ ok: true, credentials: init?.credentials }));
    const fetchCookie = createCentralCookieFetch('https://heyta.example', () => 'csrf-token', fetchImpl);
    await fetchCookie('https://heyta.example/api/sync/ops', { method: 'POST', headers: { authorization: 'Bearer leaked' } });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('authorization')).toBeNull();
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('csrf-token');
  });
});
