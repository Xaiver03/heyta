/**
 * 认证客户端的语言通道（应用语言解析链，2026-10-01 拍板）。
 *
 * 钉三件契约：
 *   1. 发信类请求带上 `options.locale`（`body.locale`）—— 服务端按
 *      「显式 body > 账号语言 > Accept-Language > zh-CN」解析；
 *   2. 登录响应里的 `user.locale` 被解析出来（账号语言是**采纳建议**，
 *      集合外的值当缺失处理，不判 malformed）；
 *   3. `updateAccountLocale` 打对路径 / 方法 / Bearer / 请求体。
 *
 * ⚠️ 全程零联网：`fetch` 一律注入（与 hosted-auth.spec.ts 同一套纪律）。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  HOSTED_AUTH_PATHS,
  beginPasskeyRegistration,
  completePasskeyRegistration,
  registerWithMagicLink,
  requestMagicLink,
  requestPasskeyRecovery,
  updateAccountLocale,
  verifyMagicLink,
  type HostedAuthOptions,
} from '../src/hosted-auth.js';

interface RecordedCall {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string> | undefined;
  readonly body: unknown;
}

/** 记录全部调用的 fetch，总是回 200 + 给定响应体。 */
function okFetch(body: unknown): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve({
      status: 200,
      ok: true,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const opts = (over: Partial<HostedAuthOptions> = {}): HostedAuthOptions => ({
  baseUrl: 'https://sync.example.com',
  ...over,
});

describe('发信类请求带上 options.locale（body.locale）', () => {
  it('requestMagicLink：带 locale 时进请求体；不带时**没有这个键**', async () => {
    const withLocale = okFetch({ message: 'ok' });
    await requestMagicLink(opts({ locale: 'en', fetchImpl: withLocale.impl }), 'a@b.c');
    expect(withLocale.calls[0]?.body).toEqual({ email: 'a@b.c', locale: 'en' });

    const bare = okFetch({ message: 'ok' });
    await requestMagicLink(opts({ fetchImpl: bare.impl }), 'a@b.c');
    expect(bare.calls[0]?.body).toEqual({ email: 'a@b.c' });
  });

  it('registerWithMagicLink / requestPasskeyRecovery / passkey 注册两步同样携带', async () => {
    const f1 = okFetch({ message: 'ok' });
    await registerWithMagicLink(opts({ locale: 'en', fetchImpl: f1.impl }), {
      email: 'a@b.c',
      termsAccepted: true,
    });
    expect(f1.calls[0]?.body).toMatchObject({ locale: 'en' });

    const f2 = okFetch({ message: 'ok' });
    await requestPasskeyRecovery(opts({ locale: 'en', fetchImpl: f2.impl }), 'a@b.c');
    expect(f2.calls[0]?.body).toMatchObject({ locale: 'en' });

    const credential = { id: 'x', rawId: 'x', type: 'public-key', response: {} };
    const f3 = okFetch({ options: {} });
    await beginPasskeyRegistration(opts({ locale: 'en', fetchImpl: f3.impl }), {
      email: 'a@b.c',
      termsAccepted: true,
    });
    expect(f3.calls[0]?.body).toMatchObject({ locale: 'en' });

    const f4 = okFetch({ message: 'ok' });
    await completePasskeyRegistration(opts({ locale: 'en', fetchImpl: f4.impl }), {
      email: 'a@b.c',
      credential,
    });
    expect(f4.calls[0]?.body).toMatchObject({ locale: 'en' });
  });
});

describe('登录响应里的账号语言（user.locale）', () => {
  it('合法值被解析出来 —— 客户端靠它在新设备上采纳账号语言', async () => {
    const f = okFetch({ token: 'jwt', user: { id: 1, email: 'a@b.c', locale: 'en' } });
    const outcome = await verifyMagicLink(opts({ fetchImpl: f.impl }), 'tok');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.session.user.locale).toBe('en');
  });

  it('🔴 集合外的值当缺失，不判 malformed —— 它是建议，不是必需要素', async () => {
    const f = okFetch({ token: 'jwt', user: { id: 1, email: 'a@b.c', locale: 'klingon' } });
    const outcome = await verifyMagicLink(opts({ fetchImpl: f.impl }), 'tok');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.session.user.locale).toBeUndefined();
  });

  it('老服务端不带这个字段 ⇒ 照常成功（向后兼容）', async () => {
    const f = okFetch({ token: 'jwt', user: { id: 1, email: 'a@b.c' } });
    const outcome = await verifyMagicLink(opts({ fetchImpl: f.impl }), 'tok');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.session.user.locale).toBeUndefined();
  });
});

describe('updateAccountLocale（写侧）', () => {
  it('PUT 到 /api/account/locale，带 Bearer 与请求体', async () => {
    const f = okFetch({ locale: 'en' });
    const outcome = await updateAccountLocale(opts({ fetchImpl: f.impl }), 'jwt-tok', 'en');
    expect(outcome.ok).toBe(true);
    expect(f.calls[0]?.url).toBe(`https://sync.example.com${HOSTED_AUTH_PATHS.accountLocale}`);
    expect(f.calls[0]?.method).toBe('PUT');
    expect(f.calls[0]?.headers?.['authorization']).toBe('Bearer jwt-tok');
    expect(f.calls[0]?.body).toEqual({ locale: 'en' });
  });

  it('空令牌 ⇒ invalid-input，一个请求都不发', async () => {
    const f = okFetch({ locale: 'en' });
    const outcome = await updateAccountLocale(opts({ fetchImpl: f.impl }), '   ', 'en');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('invalid-input');
    expect(f.calls).toHaveLength(0);
  });

  it('非 2xx ⇒ 失败可判定（fire-and-forget 的调用方也要能分辨）', async () => {
    const impl = vi.fn(() =>
      Promise.resolve({ status: 500, ok: false, json: () => Promise.resolve({}) } as unknown as Response),
    ) as unknown as typeof fetch;
    const outcome = await updateAccountLocale(opts({ fetchImpl: impl }), 'jwt-tok', 'en');
    expect(outcome.ok).toBe(false);
  });
});
