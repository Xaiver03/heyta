import { describe, expect, it, vi } from 'vitest';

import {
  beginCentralAuth,
  beginCentralDeviceAuth,
  claimCentralDeviceAuth,
  createCentralCookieFetch,
  getCentralAuthConfig,
  getCentralAuthSession,
} from '../src/central-auth.js';
import { sha256TextHex } from '@heyta/sync-core';

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

describe('原生与 CLI 共用的设备 handoff 客户端', () => {
  it('只送 verifier 的 SHA-256，凭据不经 Cookie，拒绝外域启动链接', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => response({
      handoffId: '12345678-1234-1234-1234-123456789abc',
      launchUrl: `https://heyta.example/api/auth/oidc/device/launch/${'a'.repeat(43)}`,
      pairingCode: 'A1B2C3D4E5F6', expiresAt: Date.now() + 600_000,
    }));
    const result = await beginCentralDeviceAuth({ baseUrl: 'https://heyta.example',
      termsAccepted: true, documentVersion: 'v1', fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('omit');
    const sent = JSON.parse(String(init.body)) as { deviceChallenge: string; verifier?: string };
    expect(sent.deviceChallenge).toBe(sha256TextHex(result.value.verifier));
    expect(sent.verifier).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain(result.value.verifier);
    const wrong = await beginCentralDeviceAuth({ baseUrl: 'https://heyta.example',
      fetchImpl: vi.fn(async () => response({ handoffId: result.value.handoffId,
        launchUrl: `https://evil.example/api/auth/oidc/device/launch/${'a'.repeat(43)}`,
        pairingCode: 'A1B2C3D4E5F6', expiresAt: Date.now() + 600_000 })) });
    expect(wrong).toMatchObject({ ok: false, reason: 'malformed-response' });
  });
  it('区分等待与领取，并拒绝畸形令牌响应', async () => {
    const id = '12345678-1234-1234-1234-123456789abc', verifier = 'b'.repeat(43);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit');
      return response({ status: 'pending' }, 202);
    });
    expect(await claimCentralDeviceAuth({ baseUrl: 'https://heyta.example', fetchImpl }, id, verifier))
      .toEqual({ ok: true, value: { status: 'pending' } });
    const claimed = await claimCentralDeviceAuth({ baseUrl: 'https://heyta.example',
      fetchImpl: vi.fn(async () => response({ status: 'claimed', token: 'synthetic.jwt',
        user: { id: 7, email: 'user@example.test' }, expiresAt: Date.now() + 100_000 })) }, id, verifier);
    expect(claimed.ok && claimed.value.status).toBe('claimed');
    const malformed = await claimCentralDeviceAuth({ baseUrl: 'https://heyta.example',
      fetchImpl: vi.fn(async () => response({ status: 'claimed', token: '', user: { id: 7, email: 'x' }, expiresAt: 1 })) }, id, verifier);
    expect(malformed).toMatchObject({ ok: false, reason: 'malformed-response' });
  });
});
