/**
 * 邮箱验证码登录的**客户端**契约（2026-10-10）
 * =====================================================
 *
 * 服务端的挑战流在 `server/tests/` 与集成档里钉；这里钉的是宿主共用那三个函数：
 *   · 诱饵响应（无 `emailDelivered` 字段）**必须**被读成"成功、去查收件箱"，
 *     而不是 malformed —— 那是反枚举设计在客户端的半边；
 *   · `emailDelivered: false` 必须原样浮出来（界面要能说"信没发出去"）；
 *   · 会话解析复用 `parseSession`：缺 token/user 判 malformed，绝不当成功；
 *   · `login_code_rate_limited` + 429 归 `rate-limited`（新码进白名单表，
 *     那张对账表在 hosted-password-auth.spec 里逐码核对）。
 *
 * 🔴 这些判据都能失败：把客户端读取器改坏（比如把缺字段当真）任何一条都会红。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  FAILURE_REASON_BY_SERVER_CODE,
  requestEmailLoginCode,
  resendEmailLoginCode,
  verifyEmailLoginCode,
  type HostedAuthOptions,
} from '../src/hosted-auth.js';

const options = (baseUrl: string): HostedAuthOptions => ({ baseUrl });

function fetchOnceResponds(body: unknown, status = 201): typeof fetch {
  const impl = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
  return impl;
}

describe('邮箱验证码登录（客户端）', () => {
  it('诱饵响应（无 emailDelivered）读成成功挑战 —— 客户端不许造出"邮箱不存在"这一档', async () => {
    const impl = fetchOnceResponds({
      challengeId: 'decoy-challenge',
      expiresAt: Date.now() + 600_000,
      resendAvailableAt: Date.now() + 60_000,
    });
    const outcome = await requestEmailLoginCode({ baseUrl: 'https://x.test', fetchImpl: impl } as never, 'a@b.test');
    // @ts-expect-error narrowing by hand in the test
    expect(outcome.ok).toBe(true);
  });

  it('emailDelivered: false 原样浮出 —— 界面要能说"信没发出去"', async () => {
    const impl = fetchOnceResponds(
      { challengeId: 'c', expiresAt: Date.now() + 600_000, resendAvailableAt: Date.now() + 60_000, emailDelivered: false },
    );
    const outcome = await requestEmailLoginCode({ baseUrl: 'https://x.test', fetchImpl: impl } as never, 'a@b.test');
    expect(outcome.ok && outcome.emailDelivered === false).toBe(true);
  });

  it('verify：会话形状完整才当成功', async () => {
    const impl = fetchOnceResponds(
      { token: 'jwt-token', user: { id: 1, email: 'a@b.test', locale: 'zh-CN' } },
      200,
    );
    const outcome = await verifyEmailLoginCode(
      { baseUrl: 'https://x.test', fetchImpl: impl } as never,
      { challengeId: 'c', code: '123456' },
    );
    expect(outcome.ok && outcome.session.token === 'jwt-token').toBe(true);
  });

  it('verify：缺 token 的响应判 malformed，绝不当成功', async () => {
    const impl = fetchOnceResponds({ user: { id: 1, email: 'a@b.test' } }, 200);
    const outcome = await verifyEmailLoginCode(
      { baseUrl: 'https://x.test', fetchImpl: impl } as never,
      { challengeId: 'c', code: '123456' },
    );
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('malformed-response');
  });

  it('登录码限速：新码 login_code_rate_limited 在白名单表里，归 rate-limited', () => {
    expect(FAILURE_REASON_BY_SERVER_CODE['login_code_rate_limited']).toBe('rate-limited');
    expect(FAILURE_REASON_BY_SERVER_CODE['invalid_login_challenge']).toBe('invalid-input');
  });

  it('resend：challengeId 归属，客户端不再次提交邮箱', async () => {
    const impl = vi.fn(fetchOnceResponds({ challengeId: 'c', expiresAt: 1, resendAvailableAt: 1 }));
    await resendEmailLoginCode({ baseUrl: 'https://x.test', fetchImpl: impl as unknown as typeof fetch } as never, 'challenge-1');
    expect(impl).toHaveBeenCalled();
    const [, rawInit] = (impl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(String(rawInit.body)).not.toContain('@');
  });
});
