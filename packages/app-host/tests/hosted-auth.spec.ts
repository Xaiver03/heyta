/**
 * 认证客户端的测试。
 *
 * 🔴 这一组要挡的不是"解析对不对"，而是**客户端与服务端之间那份契约本身**：
 * 路径、方法、请求体字段、凭据从哪儿取、失败怎么归类。
 * 这些一旦漂移，症状是"某台设备永远登不进自己的服务器"，而本地一切正常。
 *
 * 另一半是 **fail-safe**：未配置不发请求、没有 `fetch` 不崩、
 * 2xx 但响应不像话**绝不当成功**。
 *
 * ⚠️ 全程零联网：`fetch` 一律注入。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  HOSTED_AUTH_PATHS,
  beginPasskeyLogin,
  beginPasskeyRegistration,
  completePasskeyLogin,
  completePasskeyRecovery,
  completePasskeyRegistration,
  extractAuthLinkToken,
  getPasskeyRecoveryOptions,
  registerWithMagicLink,
  requestMagicLink,
  requestPasskeyRecovery,
  verifyEmailAddress,
  verifyMagicLink,
  type HostedAuthOptions,
} from '../src/hosted-auth.js';

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly body: unknown;
}

/** 造一个记录全部调用的 fetch，并按脚本回响应。 */
function recordingFetch(
  responder: (url: string) => { status: number; body?: unknown; jsonThrows?: boolean },
): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({
      url,
      init,
      body: rawBody === undefined ? undefined : JSON.parse(rawBody),
    });
    const spec = responder(url);
    return Promise.resolve({
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      json: () =>
        spec.jsonThrows === true
          ? Promise.reject(new Error('not json'))
          : Promise.resolve(spec.body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** 总会成功的 fetch（响应体可指定）。 */
function okFetch(body: unknown): { impl: typeof fetch; calls: RecordedCall[] } {
  return recordingFetch(() => ({ status: 200, body }));
}

const opts = (over: Partial<HostedAuthOptions> = {}): HostedAuthOptions => ({
  baseUrl: 'https://sync.example.com',
  ...over,
});

const SESSION = { token: 'jwt-123', user: { id: 7, email: 'a@b.c' } };

describe('认证契约：路径 / 方法 / 请求体字段', () => {
  it('登录链接：POST /api/login/magic-link，体里只有 email', async () => {
    const { impl, calls } = okFetch({ message: 'If an account with that email exists…' });
    const outcome = await requestMagicLink(opts({ fetchImpl: impl }), ' a@b.c ');

    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://sync.example.com${HOSTED_AUTH_PATHS.magicLinkRequest}`);
    expect(calls[0]!.init?.method).toBe('POST');
    // 归一过了空白，但**没有**改写大小写或做别的加工（服务端自己归一）。
    expect(calls[0]!.body).toEqual({ email: 'a@b.c' });
    expect((calls[0]!.init?.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
  });

  it('注册：POST /api/register/magic-link，没勾同意时**不出现** termsAccepted 键', async () => {
    const { impl, calls } = okFetch({ message: 'Registration successful.' });
    await registerWithMagicLink(opts({ fetchImpl: impl }), { email: 'a@b.c' });

    expect(calls[0]!.url).toBe(`https://sync.example.com${HOSTED_AUTH_PATHS.magicLinkRegister}`);
    // 🔴 不许替用户发明同意：键就不该存在（服务端那侧是 z.literal(true)，缺键即拒绝）。
    expect(calls[0]!.body).toEqual({ email: 'a@b.c' });
    expect(Object.keys(calls[0]!.body as object)).not.toContain('termsAccepted');
  });

  it('注册：用户真的勾了才带上 termsAccepted: true', async () => {
    const { impl, calls } = okFetch({ message: 'Registration successful.' });
    await registerWithMagicLink(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      termsAccepted: true,
    });
    expect(calls[0]!.body).toEqual({ email: 'a@b.c', termsAccepted: true });
  });

  it('登录链接换令牌：POST /api/login/magic-link/verify，体里只有 token', async () => {
    const { impl, calls } = okFetch(SESSION);
    await verifyMagicLink(opts({ fetchImpl: impl }), ' raw-token ');
    expect(calls[0]!.url).toBe(`https://sync.example.com${HOSTED_AUTH_PATHS.magicLinkVerify}`);
    expect(calls[0]!.body).toEqual({ token: 'raw-token' });
  });

  it('邮箱验证：POST /api/verify-email', async () => {
    const { impl, calls } = okFetch({ message: 'Email verified successfully' });
    const outcome = await verifyEmailAddress(opts({ fetchImpl: impl }), 'tok');
    expect(calls[0]!.url).toBe(`https://sync.example.com${HOSTED_AUTH_PATHS.verifyEmail}`);
    expect(calls[0]!.body).toEqual({ token: 'tok' });
    expect(outcome.ok).toBe(true);
  });

  it('通行密钥：注册 options / 注册 verify 的路径与体', async () => {
    const optionsFetch = okFetch({ challenge: 'abc', rp: { id: 'example.com' } });
    const begin = await beginPasskeyRegistration(opts({ fetchImpl: optionsFetch.impl }), {
      email: 'a@b.c',
    });
    expect(optionsFetch.calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeyRegisterOptions}`,
    );
    expect(optionsFetch.calls[0]!.body).toEqual({ email: 'a@b.c' });
    expect(begin.ok).toBe(true);

    const verifyFetch = okFetch({ message: 'ok' });
    await completePasskeyRegistration(opts({ fetchImpl: verifyFetch.impl }), {
      email: 'a@b.c',
      credential: { id: 'cred', response: { clientDataJSON: 'x' } },
    });
    expect(verifyFetch.calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeyRegisterVerify}`,
    );
    // 🔴 credential **原样透传**，一个字段都不加工 —— 校验它的是服务端。
    expect(verifyFetch.calls[0]!.body).toEqual({
      email: 'a@b.c',
      credential: { id: 'cred', response: { clientDataJSON: 'x' } },
    });
  });

  it('通行密钥：登录 options / 登录 verify / 恢复三段的路径与体', async () => {
    const loginOptions = okFetch({ challenge: 'xyz' });
    await beginPasskeyLogin(opts({ fetchImpl: loginOptions.impl }), 'a@b.c');
    expect(loginOptions.calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeyLoginOptions}`,
    );

    const loginVerify = okFetch(SESSION);
    const login = await completePasskeyLogin(opts({ fetchImpl: loginVerify.impl }), {
      email: 'a@b.c',
      credential: { id: 'cred' },
    });
    expect(loginVerify.calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeyLoginVerify}`,
    );
    expect(login.ok && login.session.token).toBe('jwt-123');

    const recover = okFetch({ message: 'neutral' });
    await requestPasskeyRecovery(opts({ fetchImpl: recover.impl }), 'a@b.c');
    expect(recover.calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeyRecoverRequest}`,
    );

    const recoverOptions = okFetch({ email: 'a@b.c', options: { challenge: 'r' } });
    const beginRecovery = await getPasskeyRecoveryOptions(opts({ fetchImpl: recoverOptions.impl }), 'tok');
    expect(recoverOptions.calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeyRecoverOptions}`,
    );
    expect(recoverOptions.calls[0]!.body).toEqual({ token: 'tok' });
    expect(beginRecovery.ok && beginRecovery.email).toBe('a@b.c');

    const recoverComplete = okFetch({ message: 'Passkey has been reset successfully.' });
    await completePasskeyRecovery(opts({ fetchImpl: recoverComplete.impl }), {
      token: 'tok',
      credential: { id: 'cred' },
    });
    expect(recoverComplete.calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeyRecoverComplete}`,
    );
    expect(recoverComplete.calls[0]!.body).toEqual({ token: 'tok', credential: { id: 'cred' } });
  });
});

describe('🔴 凭据形式：令牌在响应体里，不在 cookie 里', () => {
  it('登录链接验证把 body.token 取出来当会话', async () => {
    const { impl } = okFetch(SESSION);
    const outcome = await verifyMagicLink(opts({ fetchImpl: impl }), 'tok');
    expect(outcome).toEqual({ ok: true, session: SESSION });
  });

  it('通行密钥登录同样产出会话', async () => {
    const { impl } = okFetch(SESSION);
    const outcome = await completePasskeyLogin(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      credential: { id: 'c' },
    });
    expect(outcome).toEqual({ ok: true, session: SESSION });
  });

  it('验证邮箱**不产出令牌** —— 界面不许把它当"已登录"', async () => {
    const { impl } = okFetch({ message: 'Email verified successfully' });
    const outcome = await verifyEmailAddress(opts({ fetchImpl: impl }), 'tok');
    expect(outcome.ok).toBe(true);
    // 类型上就没有 session 字段；运行期也不许平白多一个。
    expect(Object.keys(outcome)).not.toContain('session');
  });
});

describe('fail-safe：未配置 / 输入为空时不发请求', () => {
  it('没填服务端地址 → unconfigured，且一个请求都不发', async () => {
    const { impl, calls } = okFetch(SESSION);
    const outcome = await requestMagicLink(opts({ baseUrl: '', fetchImpl: impl }), 'a@b.c');
    expect(outcome).toEqual({ ok: false, reason: 'unconfigured' });
    expect(calls).toHaveLength(0);
  });

  it('空邮箱 → invalid-input，且不发请求', async () => {
    const { impl, calls } = okFetch(SESSION);
    const outcome = await requestMagicLink(opts({ fetchImpl: impl }), '   ');
    expect(outcome).toEqual({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });

  it('空令牌 → invalid-input，且不发请求', async () => {
    const { impl, calls } = okFetch(SESSION);
    const outcome = await verifyMagicLink(opts({ fetchImpl: impl }), ' ');
    expect(outcome).toEqual({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });
});

describe('失败是可判定的结果，不是异常', () => {
  it('400 → invalid-input，并原样带上服务端的安全错误串', async () => {
    const { impl } = recordingFetch(() => ({
      status: 400,
      body: { error: 'You must accept the linked legal documents to register' },
    }));
    const outcome = await registerWithMagicLink(opts({ fetchImpl: impl }), { email: 'a@b.c' });
    expect(outcome).toEqual({
      ok: false,
      reason: 'invalid-input',
      status: 400,
      message: 'You must accept the linked legal documents to register',
    });
  });

  it('401 → unauthorized（令牌/链接无效或过期）', async () => {
    const { impl } = recordingFetch(() => ({
      status: 401,
      body: { error: 'Invalid or expired login link' },
    }));
    const outcome = await verifyMagicLink(opts({ fetchImpl: impl }), 'tok');
    expect(outcome).toEqual({
      ok: false,
      reason: 'unauthorized',
      status: 401,
      message: 'Invalid or expired login link',
    });
  });

  it('403 → not-allowed（该实例不允许这个邮箱注册）', async () => {
    const { impl } = recordingFetch(() => ({
      status: 403,
      body: { error: 'Registration is not allowed for this email address.' },
    }));
    const outcome = await registerWithMagicLink(opts({ fetchImpl: impl }), { email: 'a@b.c' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('not-allowed');
      expect(outcome.status).toBe(403);
    }
  });

  it('429 → rate-limited', async () => {
    const { impl } = recordingFetch(() => ({ status: 429 }));
    const outcome = await requestMagicLink(opts({ fetchImpl: impl }), 'a@b.c');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('rate-limited');
  });

  it('5xx → server-error', async () => {
    const { impl } = recordingFetch(() => ({ status: 500, body: { error: 'boom' } }));
    const outcome = await requestMagicLink(opts({ fetchImpl: impl }), 'a@b.c');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('server-error');
  });

  it('网络层抛错 → network', async () => {
    const impl = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    const outcome = await requestMagicLink(opts({ fetchImpl: impl }), 'a@b.c');
    expect(outcome).toEqual({ ok: false, reason: 'network' });
  });

  it('🔴 宿主根本没有 fetch（某些 Hermes 配置）→ network，而不是进程崩溃', async () => {
    vi.stubGlobal('fetch', undefined);
    try {
      // 不传 fetchImpl，逼它走 globalThis.fetch 那条路。
      const outcome = await requestMagicLink(opts(), 'a@b.c');
      expect(outcome).toEqual({ ok: false, reason: 'network' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('2xx 但响应体不是 JSON → malformed-response', async () => {
    const { impl } = recordingFetch(() => ({ status: 200, jsonThrows: true }));
    const outcome = await requestMagicLink(opts({ fetchImpl: impl }), 'a@b.c');
    expect(outcome).toEqual({ ok: false, reason: 'malformed-response', status: 200 });
  });
});

describe('🔴 「把失败态当成成功」必须被抓住', () => {
  it('200 但响应体里没有 token → malformed-response（不是"登录成功"）', async () => {
    const { impl } = okFetch({ user: { id: 1, email: 'a@b.c' } });
    const outcome = await verifyMagicLink(opts({ fetchImpl: impl }), 'tok');
    expect(outcome).toEqual({ ok: false, reason: 'malformed-response' });
  });

  it('200 但 token 是空串 → malformed-response', async () => {
    const { impl } = okFetch({ token: '', user: { id: 1, email: 'a@b.c' } });
    const outcome = await verifyMagicLink(opts({ fetchImpl: impl }), 'tok');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('malformed-response');
  });

  it('200 但 user 缺 id → malformed-response', async () => {
    const { impl } = okFetch({ token: 'jwt', user: { email: 'a@b.c' } });
    const outcome = await verifyMagicLink(opts({ fetchImpl: impl }), 'tok');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('malformed-response');
  });

  it('通行密钥 options 不是对象 → malformed-response', async () => {
    const { impl } = okFetch('not-an-object');
    const outcome = await beginPasskeyRegistration(opts({ fetchImpl: impl }), { email: 'a@b.c' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('malformed-response');
  });

  it('恢复 options 缺 email 或 options → malformed-response', async () => {
    const missingEmail = okFetch({ options: { challenge: 'r' } });
    const a = await getPasskeyRecoveryOptions(opts({ fetchImpl: missingEmail.impl }), 'tok');
    expect(a.ok).toBe(false);

    const missingOptions = okFetch({ email: 'a@b.c' });
    const b = await getPasskeyRecoveryOptions(opts({ fetchImpl: missingOptions.impl }), 'tok');
    expect(b.ok).toBe(false);
  });
});

describe('地址拼接', () => {
  it('根地址末尾的斜杠不会拼出双斜杠', async () => {
    const { impl, calls } = okFetch(SESSION);
    await verifyMagicLink(opts({ baseUrl: 'https://sync.example.com/', fetchImpl: impl }), 'tok');
    expect(calls[0]!.url).toBe(`https://sync.example.com${HOSTED_AUTH_PATHS.magicLinkVerify}`);
  });
});

describe('extractAuthLinkToken：从用户粘贴的东西里取出令牌', () => {
  it('完整链接', () => {
    expect(extractAuthLinkToken('https://sync.example.com/magic-login?token=abc123')).toBe('abc123');
  });

  it('相对链接（服务端页面上复制下来的那种）', () => {
    expect(extractAuthLinkToken('/verify-email?token=deadbeef')).toBe('deadbeef');
  });

  it('带其它查询参数，token 不在第一个', () => {
    expect(extractAuthLinkToken('https://h/magic-login?utm=x&token=abc123&y=1')).toBe('abc123');
  });

  it('百分号编码的令牌会被解码', () => {
    expect(extractAuthLinkToken('https://h/magic-login?token=a%2Bb')).toBe('a+b');
  });

  it('裸令牌原样返回（去空白）', () => {
    expect(extractAuthLinkToken('  abc123  ')).toBe('abc123');
  });

  it('粘了一整段话 → undefined（不是把整段当令牌发给服务端）', () => {
    expect(extractAuthLinkToken('这是邮件里的链接 abc123 快打开')).toBeUndefined();
  });

  it('空串 / 没有 token 参数的链接 → undefined', () => {
    expect(extractAuthLinkToken('')).toBeUndefined();
    expect(extractAuthLinkToken('https://h/magic-login?foo=bar')).toBeUndefined();
    expect(extractAuthLinkToken('https://h/magic-login?token=')).toBeUndefined();
  });
});
