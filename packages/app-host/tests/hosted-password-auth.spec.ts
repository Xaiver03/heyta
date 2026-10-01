/**
 * 邮箱 + 口令那条路的**契约测试**（计划 W5）。
 *
 * 与 `hosted-auth.spec.ts` 同一立场：要挡的不是"解析对不对"，而是客户端与服务端
 * 之间那份契约 —— 路径、方法、请求体字段、凭据从哪儿取、**失败怎么归类**。
 * 口令这条路多出来的那一层是：`code` → `reason` 的**一一对应**。
 *
 * 🔴 为什么这一组值得单独写：这一层漂移**没有任何类型错误或构建失败会报**。
 * 服务端加了码而白名单少一行，表现是"一种本来能说清的失败变成一句笼统的话"，
 * 而四端各自把那句话翻译成了什么，取决于各自界面上恰好有什么。
 *
 * ⚠️ 全程零联网：`fetch` 一律注入。
 */
import { describe, expect, it } from 'vitest';
import {
  AUTH_PASSWORD_PATHS,
  PASSWORD_AUTH_ERROR_CODES,
  PASSWORD_POLICY_CODES,
} from '@heyta/shared-schema';

import {
  FAILURE_REASON_BY_SERVER_CODE,
  HOSTED_AUTH_PATHS,
  changePassword,
  loginWithEmailPassword,
  registerWithEmailPassword,
  requestPasswordReset,
  resetPasswordWithToken,
  setInitialPassword,
  type HostedAuthOptions,
} from '../src/hosted-auth.js';

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly body: unknown;
}

interface Spec {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** 记录全部调用的 fetch 替身（比 `hosted-auth.spec.ts` 那份多一个 `headers`）。 */
function stubFetch(
  responder: (url: string) => Spec,
): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, init, body: rawBody === undefined ? undefined : JSON.parse(rawBody) });
    const spec = responder(url);
    return Promise.resolve({
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      headers: new Headers(spec.headers ?? {}),
      json: () => Promise.resolve(spec.body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = (body: unknown, headers?: Record<string, string>) =>
  stubFetch(() => ({ status: 200, body, headers }));

const opts = (over: Partial<HostedAuthOptions> = {}): HostedAuthOptions => ({
  baseUrl: 'https://sync.example.com',
  ...over,
});

const SESSION = { token: 'jwt-new', user: { id: 7, email: 'a@b.c' } };
const NEUTRAL = { message: 'If an account with that email exists…' };

/** 六条路的完整 URL（`/api` 前缀 + 契约里的相对形状）。 */
const urlFor = (path: string) => `https://sync.example.com/api${path}`;

describe('六条路的路径就是共享契约那六条', () => {
  /**
   * 🔴 两个方向都钉：请求打出去的 URL 必须等于 `'/api' + 契约`，而 app-host 常量表里
   * 那五条也必须等于同一个串。少了后一半，"app-host 自己另写了一条路径、
   * 而测试用同一个变量去比"就会全绿 —— 那等于没测。
   */
  it('六条各自对上，且常量表逐项等于契约', async () => {
    const login = stubFetch(() => ({ status: 200, body: SESSION }));
    await loginWithEmailPassword(opts({ fetchImpl: login.impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    });
    expect(login.calls[0]!.url).toBe(urlFor(AUTH_PASSWORD_PATHS.login));
    expect(login.calls[0]!.init?.method).toBe('POST');

    const forgot = stubFetch(() => ({ status: 200, body: NEUTRAL }));
    await requestPasswordReset(opts({ fetchImpl: forgot.impl }), 'a@b.c');
    expect(forgot.calls[0]!.url).toBe(urlFor(AUTH_PASSWORD_PATHS.forgot));

    const reset = stubFetch(() => ({ status: 200, body: NEUTRAL }));
    await resetPasswordWithToken(opts({ fetchImpl: reset.impl }), {
      token: 't',
      password: 'p'.repeat(9),
    });
    expect(reset.calls[0]!.url).toBe(urlFor(AUTH_PASSWORD_PATHS.reset));

    const change = stubFetch(() => ({ status: 200, body: SESSION }));
    await changePassword(opts({ fetchImpl: change.impl }), 'jwt', {
      currentPassword: 'a'.repeat(9),
      newPassword: 'b'.repeat(9),
    });
    expect(change.calls[0]!.url).toBe(urlFor(AUTH_PASSWORD_PATHS.change));

    const register = stubFetch(() => ({ status: 201, body: NEUTRAL }));
    await registerWithEmailPassword(opts({ fetchImpl: register.impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    });
    expect(register.calls[0]!.url).toBe(urlFor(AUTH_PASSWORD_PATHS.register));

    const set = stubFetch(() => ({ status: 200, body: { message: 'Password set' } }));
    await setInitialPassword(opts({ fetchImpl: set.impl }), 'jwt', {
      newPassword: 'b'.repeat(9),
    });
    expect(set.calls[0]!.url).toBe(urlFor(AUTH_PASSWORD_PATHS.set));
    expect(set.calls[0]!.init?.method).toBe('POST');

    expect({
      emailPasswordRegister: HOSTED_AUTH_PATHS.emailPasswordRegister,
      emailPasswordLogin: HOSTED_AUTH_PATHS.emailPasswordLogin,
      passwordForgot: HOSTED_AUTH_PATHS.passwordForgot,
      passwordReset: HOSTED_AUTH_PATHS.passwordReset,
      passwordChange: HOSTED_AUTH_PATHS.passwordChange,
      passwordSet: HOSTED_AUTH_PATHS.passwordSet,
    }).toEqual({
      emailPasswordRegister: `/api${AUTH_PASSWORD_PATHS.register}`,
      emailPasswordLogin: `/api${AUTH_PASSWORD_PATHS.login}`,
      passwordForgot: `/api${AUTH_PASSWORD_PATHS.forgot}`,
      passwordReset: `/api${AUTH_PASSWORD_PATHS.reset}`,
      passwordChange: `/api${AUTH_PASSWORD_PATHS.change}`,
      passwordSet: `/api${AUTH_PASSWORD_PATHS.set}`,
    });
  });
});

describe('请求体：只放服务端要的字段', () => {
  it('注册：没勾同意时 termsAccepted 键**不存在**（不替用户发明同意）', async () => {
    const { impl, calls } = ok(NEUTRAL);
    await registerWithEmailPassword(opts({ fetchImpl: impl }), {
      email: ' a@b.c ',
      password: 'pass phrase',
    });
    expect(calls[0]!.body).toEqual({ email: 'a@b.c', password: 'pass phrase' });
    expect(Object.keys(calls[0]!.body as object)).not.toContain('termsAccepted');
  });

  it('注册：勾了才发 true；邀请码**原样**发出不归一化', async () => {
    const { impl, calls } = ok(NEUTRAL);
    await registerWithEmailPassword(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      password: 'pass phrase',
      termsAccepted: true,
      inviteCode: '  Hey TA-9 ',
    });
    expect(calls[0]!.body).toEqual({
      email: 'a@b.c',
      password: 'pass phrase',
      termsAccepted: true,
      inviteCode: '  Hey TA-9 ',
    });
  });

  it('🔴 口令一个字都不加工：邮箱 trim，口令原样（含首尾空格）', async () => {
    const { impl, calls } = ok(SESSION);
    await loginWithEmailPassword(opts({ fetchImpl: impl }), {
      email: ' a@b.c ',
      password: ' P@ss word ',
    });
    // 归一化（NFC + NFKC，按码点）只在服务端一处发生。客户端再归一一次就是
    // 第二套规则 —— 那正是"同一句口令在两端字节不同"的生成方式。
    expect(calls[0]!.body).toEqual({ email: 'a@b.c', password: ' P@ss word ' });
    expect(calls[0]!.body).not.toHaveProperty('locale');
  });

  it('三条发信 / 换会话的路都带 locale；登录不带（它不发信）', async () => {
    const withLocale = opts({ locale: 'en' as const });

    const a = stubFetch(() => ({ status: 200, body: NEUTRAL }));
    await registerWithEmailPassword({ ...withLocale, fetchImpl: a.impl }, {
      email: 'a@b.c',
      password: 'pass phrase',
    });
    expect((a.calls[0]!.body as Record<string, unknown>)['locale']).toBe('en');

    const b = stubFetch(() => ({ status: 200, body: NEUTRAL }));
    await requestPasswordReset({ ...withLocale, fetchImpl: b.impl }, 'a@b.c');
    expect((b.calls[0]!.body as Record<string, unknown>)['locale']).toBe('en');

    const c = stubFetch(() => ({ status: 200, body: NEUTRAL }));
    await resetPasswordWithToken({ ...withLocale, fetchImpl: c.impl }, {
      token: 't',
      password: 'pass phrase',
    });
    expect((c.calls[0]!.body as Record<string, unknown>)['locale']).toBe('en');

    const d = stubFetch(() => ({ status: 200, body: SESSION }));
    await loginWithEmailPassword({ ...withLocale, fetchImpl: d.impl }, {
      email: 'a@b.c',
      password: 'pass phrase',
    });
    expect(d.calls[0]!.body).not.toHaveProperty('locale');
  });

  it('改口令：Bearer 头上带令牌，体里只有两个口令字段', async () => {
    const { impl, calls } = ok(SESSION);
    await changePassword(opts({ fetchImpl: impl }), ' jwt-7 ', {
      currentPassword: 'old phrase',
      newPassword: 'new phrase',
    });
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer jwt-7');
    expect(calls[0]!.body).toEqual({ currentPassword: 'old phrase', newPassword: 'new phrase' });
  });

  it('🔴 空令牌**一个请求都不发**（改口令）', async () => {
    const { impl, calls } = ok(SESSION);
    const outcome = await changePassword(opts({ fetchImpl: impl }), '   ', {
      currentPassword: 'a'.repeat(9),
      newPassword: 'b'.repeat(9),
    });
    expect(calls).toHaveLength(0);
    expect(outcome).toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('空邮箱 / 空口令：不发请求就判 invalid-input', async () => {
    // 🔴 这里**也**注入 fetch 并数调用次数，而不是留一个空的 options：
    // 不注入时这条断言其实什么都没挡 —— 哪天提前 return 没了，它会真的发出
    // 一次请求，在 CI 里表现为一次超时/网络错误，而不是"发了不该发的"。
    const { impl, calls } = ok(NEUTRAL);
    const cases = [
      () => registerWithEmailPassword(opts({ fetchImpl: impl }), { email: '   ', password: 'b'.repeat(9) }),
      () => registerWithEmailPassword(opts({ fetchImpl: impl }), { email: 'a@b.c', password: '' }),
      () => loginWithEmailPassword(opts({ fetchImpl: impl }), { email: 'a@b.c', password: '' }),
      () => requestPasswordReset(opts({ fetchImpl: impl }), '  '),
      () => resetPasswordWithToken(opts({ fetchImpl: impl }), { token: '', password: 'b'.repeat(9) }),
      () => resetPasswordWithToken(opts({ fetchImpl: impl }), { token: 't', password: '' }),
    ];
    for (const run of cases) {
      const outcome = await run();
      expect(outcome).toMatchObject({ ok: false, reason: 'invalid-input' });
    }
    expect(calls).toHaveLength(0);
  });

  it('baseUrl 为空 ⇒ 五条路零请求（未配置就不该发信）', async () => {
    const { impl, calls } = ok(NEUTRAL);
    const none = opts({ baseUrl: '', fetchImpl: impl });
    await registerWithEmailPassword(none, { email: 'a@b.c', password: 'p'.repeat(9) });
    await loginWithEmailPassword(none, { email: 'a@b.c', password: 'p'.repeat(9) });
    await requestPasswordReset(none, 'a@b.c');
    await resetPasswordWithToken(none, { token: 't', password: 'p'.repeat(9) });
    await changePassword(none, 'jwt', { currentPassword: 'a', newPassword: 'b' });
    expect(calls).toHaveLength(0);
  });

  it('宿主没有 fetch ⇒ network，不抛错', async () => {
    const globalFetch = globalThis.fetch;
    // @ts-expect-error 故意拿走全局量（Hermes 某些配置下就是没有）
    delete globalThis.fetch;
    try {
      const outcome = await loginWithEmailPassword(opts({ baseUrl: 'https://x.test' }), {
        email: 'a@b.c',
        password: 'p'.repeat(9),
      });
      expect(outcome).toMatchObject({ ok: false, reason: 'network' });
    } finally {
      globalThis.fetch = globalFetch;
    }
  });
});

describe('code → reason：一一对应（这一组是 W5 的全部目的）', () => {
  /**
   * 🔴 共享契约里每一个口令错误码，客户端白名单必须有一行。
   *
   * 少一行**不会有任何类型错误**（表是 `Record<string, ...>`），症状是那种失败
   * 静默退回"按状态码分类" —— 于是 `account_locked` 会说成"网络繁忙"、
   * `no_password_set` 会说成"链接无效"，两句都是错的。
   */
  it('八个服务端码逐个都在白名单里，且映射到八个**互不相同**的原因', () => {
    expect(PASSWORD_AUTH_ERROR_CODES).toHaveLength(8); // 阳性对照：不是对着空表跑
    const reasons = new Set<string>();
    for (const code of PASSWORD_AUTH_ERROR_CODES) {
      const reason = FAILURE_REASON_BY_SERVER_CODE[code];
      expect(reason, `白名单少了 ${code}`).toBeDefined();
      // 上面那条已经会抛，这里的收窄只是给类型看。
      if (reason !== undefined) reasons.add(reason);
    }
    // 八个码 → 八个不同原因。合并任意两个都会让某一半人听到一句对不了动作的话。
    expect(reasons.size).toBe(PASSWORD_AUTH_ERROR_CODES.length);
  });

  /** 表驱动：状态码 + code → 原因 + 原样透传的 `code`。 */
  const cases: Array<{ status: number; code: string; reason: string }> = [
    { status: 401, code: 'invalid_credentials', reason: 'invalid-credentials' },
    { status: 403, code: 'email_not_verified', reason: 'email-not-verified' },
    { status: 429, code: 'account_locked', reason: 'password-locked' },
    { status: 503, code: 'password_backend_busy', reason: 'password-backend-busy' },
    { status: 400, code: 'password_policy_violation', reason: 'password-policy' },
    { status: 400, code: 'invalid_reset_link', reason: 'invalid-reset-link' },
    { status: 400, code: 'no_password_set', reason: 'no-password-set' },
    { status: 400, code: 'password_already_set', reason: 'password-already-set' },
  ];

  for (const { status, code, reason } of cases) {
    it(`${status} + ${code} → ${reason}`, async () => {
      const { impl } = stubFetch(() => ({ status, body: { error: 'x', code } }));
      const outcome = await loginWithEmailPassword(opts({ fetchImpl: impl }), {
        email: 'a@b.c',
        password: 'p'.repeat(9),
      });
      expect(outcome).toMatchObject({ ok: false, reason, status, code });
    });
  }

  /**
   * 🔴 两条"状态码分类会给错答案"的码单独钉：429 默认给 `rate-limited`
   * （"你发得太猛"），503 默认给 `server-error`（"我们不知道为什么"）。
   * 服务端在这两个码上**明说了**原因，白名单的作用就是把它们从笼统结论里抢回来。
   */
  it('白名单确实**覆盖**了状态码分类，而不是可有可无', async () => {
    const locked = stubFetch(() => ({
      status: 429,
      body: { error: 'x', code: 'account_locked' },
    }));
    const a = await loginWithEmailPassword(opts({ fetchImpl: locked.impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    });
    expect(a).toMatchObject({ reason: 'password-locked' });
    expect(a).not.toMatchObject({ reason: 'rate-limited' });

    const busy = stubFetch(() => ({
      status: 503,
      body: { error: 'x', code: 'password_backend_busy' },
    }));
    const b = await loginWithEmailPassword(opts({ fetchImpl: busy.impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    });
    expect(b).toMatchObject({ reason: 'password-backend-busy' });
    expect(b).not.toMatchObject({ reason: 'server-error' });
  });

  /**
   * 白名单的**反面**：一个我们还不认识的码（服务端以后加的）必须退回状态码分类，
   * 而不是被塞进某个可能错的原因。这条断言同时是"上一轮那个 `some-future-reason`
   * 测试"在 code 层的对应物。
   */
  it('未来新增的码 ⇒ 按状态码保守分类，且 code 原样可见', async () => {
    const { impl } = stubFetch(() => ({ status: 400, body: { error: 'x', code: 'brand_new_code' } }));
    const outcome = await loginWithEmailPassword(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid-input', code: 'brand_new_code' });
  });

  it('🔴 没有 code 时**不许**靠对 message 做字符串匹配来判（文案一改就静默失效）', async () => {
    const { impl } = stubFetch(() => ({ status: 401, body: { error: 'Invalid credentials' } }));
    const outcome = await loginWithEmailPassword(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    });
    expect(outcome).toMatchObject({ reason: 'unauthorized' });
    // 类型上失败分支才带 code，所以这里经由 toMatchObject 断言"它不存在"。
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBeUndefined();
  });
});

describe('policyCode：策略拒绝的下一层判别', () => {
  it('四个策略码逐个都透传', async () => {
    expect(PASSWORD_POLICY_CODES).toHaveLength(4);
    for (const policyCode of PASSWORD_POLICY_CODES) {
      const { impl } = stubFetch(() => ({
        status: 400,
        body: { error: 'x', code: 'password_policy_violation', policyCode },
      }));
      const outcome = await registerWithEmailPassword(opts({ fetchImpl: impl }), {
        email: 'a@b.c',
        password: 'p'.repeat(9),
      });
      expect(outcome).toMatchObject({ reason: 'password-policy', policyCode });
    }
  });

  /**
   * 🔴 白名单，不是"照原样透传字符串"。服务端给一个没写过词条的码时，
   * 界面必须落回那句统称（`password-policy` 还在，`policyCode` 缺失），
   * 而不是把那个内部串显示给用户。
   */
  it('词表外的 policyCode ⇒ 缺失，且原始串不进 policyCode', async () => {
    const { impl } = stubFetch(() => ({
      status: 400,
      body: { error: 'x', code: 'password_policy_violation', policyCode: 'too_boring' },
    }));
    const outcome = await changePassword(opts({ fetchImpl: impl }), 'jwt', {
      currentPassword: 'a'.repeat(9),
      newPassword: 'b'.repeat(9),
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'password-policy' });
    expect((outcome as { policyCode?: unknown }).policyCode).toBeUndefined();
  });
});

describe('Retry-After：只收正整数秒', () => {
  it('429 + Retry-After: 300 ⇒ retryAfterSeconds = 300', async () => {
    const { impl } = stubFetch(() => ({
      status: 429,
      body: { error: 'x', code: 'account_locked' },
      headers: { 'retry-after': '300' },
    }));
    const outcome = await loginWithEmailPassword(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    });
    expect(outcome).toMatchObject({ reason: 'password-locked', retryAfterSeconds: 300 });
  });

  /**
   * `0`、负数、日期串、没有头 ⇒ 一律**缺失**。
   * 缺失与 0 是两件事：界面拿到 0 会显示"再等 0 秒"，拿到 NaN 会显示"再等 NaN 秒"。
   */
  it('不可用的 Retry-After 形状全部归成缺失', async () => {
    for (const value of [undefined, '0', '-5', 'Wed, 21 Oct 2026 07:28:00 GMT', 'abc']) {
      const { impl } = stubFetch(() => ({
        status: 429,
        body: { error: 'x', code: 'account_locked' },
        ...(value === undefined ? {} : { headers: { 'retry-after': value } }),
      }));
      const outcome = await loginWithEmailPassword(opts({ fetchImpl: impl }), {
        email: 'a@b.c',
        password: 'p'.repeat(9),
      });
      expect((outcome as { retryAfterSeconds?: unknown }).retryAfterSeconds, String(value)).toBe(
        undefined,
      );
    }
  });
});

describe('成功分支：服务端说什么就是什么，不多不少', () => {
  it('注册 / 找回 / 重置：成功只有 message，**类型上就拿不到会话**', async () => {
    // ⚠️ 这里必须自带 fetch 替身：文件头的"全程零联网"靠的是每一处都注入，
    // 漏一处不会报错，只会真的发一次请求（然后在本机以 network 失败告终）。
    const options = opts({ fetchImpl: ok(NEUTRAL).impl });
    const runs: Array<() => Promise<unknown>> = [
      () => registerWithEmailPassword(options, { email: 'a@b.c', password: 'p'.repeat(9) }),
      () => requestPasswordReset(options, 'a@b.c'),
      () => resetPasswordWithToken(options, { token: 't', password: 'p'.repeat(9) }),
    ];
    for (const run of runs) {
      const outcome = (await run()) as Record<string, unknown>;
      expect(outcome.ok).toBe(true);
      // 🔴 重置成功**不发会话**（ADR-0040）。这里钉的是"客户端连读都没读"：
      // 身上不许出现 session / token 任何一个。
      expect(outcome).not.toHaveProperty('session');
      expect(outcome).not.toHaveProperty('token');
    }
  });

  it('注册 / 找回 / 重置：message 取服务端那句中性话，原样透传', async () => {
    const withBody = (body: unknown) => opts({ fetchImpl: ok(body).impl });
    expect(
      await registerWithEmailPassword(withBody(NEUTRAL), {
        email: 'a@b.c',
        password: 'p'.repeat(9),
      }),
    ).toMatchObject({ ok: true, message: NEUTRAL.message });
    expect(await requestPasswordReset(withBody(NEUTRAL), 'a@b.c')).toMatchObject({
      ok: true,
      message: NEUTRAL.message,
    });
  });

  it('登录与改口令：换出会话；响应体读不懂 ⇒ malformed-response，**绝不当成功**', async () => {
    const loginGood = ok(SESSION);
    expect(await loginWithEmailPassword(opts({ fetchImpl: loginGood.impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    })).toEqual({ ok: true, session: { token: 'jwt-new', user: { id: 7, email: 'a@b.c' } } });

    // 200 但缺 token —— 一枚空令牌会让同步静默失败，那是最难归因的形状。
    for (const body of [{}, { user: SESSION.user }, { token: '' }, { token: 't' }, 'not-an-object']) {
      const impl = ok(body).impl;
      expect(
        await loginWithEmailPassword(opts({ fetchImpl: impl }), {
          email: 'a@b.c',
          password: 'p'.repeat(9),
        }),
      ).toMatchObject({ ok: false, reason: 'malformed-response' });
      expect(
        await changePassword(opts({ fetchImpl: impl }), 'jwt', {
          currentPassword: 'a'.repeat(9),
          newPassword: 'b'.repeat(9),
        }),
      ).toMatchObject({ ok: false, reason: 'malformed-response' });
    }
  });

  it('🔴 改口令成功必须换回**新**会话（旧令牌已随 tokenVersion 失效）', async () => {
    const { impl } = ok(SESSION);
    const outcome = await changePassword(opts({ fetchImpl: impl }), 'jwt-old', {
      currentPassword: 'a'.repeat(9),
      newPassword: 'b'.repeat(9),
    });
    expect(outcome).toMatchObject({ ok: true, session: { token: 'jwt-new' } });
  });

  it('账号语言随会话一起回来（口令登录与魔法链接同形）', async () => {
    const { impl } = ok({ token: 'jwt', user: { id: 1, email: 'a@b.c', locale: 'en' } });
    const outcome = await loginWithEmailPassword(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    });
    expect(outcome).toMatchObject({ ok: true, session: { user: { locale: 'en' } } });
  });
});

describe('响应体不是 JSON 时仍按状态码给结论', () => {
  /**
   * 反代配错 / 返回 HTML 时 `response.json()` 会抛。状态码仍然有效 ——
   * 因为解析失败就丢掉结论，会把"服务端根本没答对"读成"什么都没发生"。
   */
  it('401 + 解析不了的体 ⇒ unauthorized（不是 malformed-response）', async () => {
    const impl = (() =>
      Promise.resolve({
        status: 401,
        ok: false,
        headers: new Headers(),
        json: () => Promise.reject(new Error('not json')),
      } as unknown as Response)) as unknown as typeof fetch;

    const outcome = await loginWithEmailPassword(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      password: 'p'.repeat(9),
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'unauthorized', status: 401 });
  });

  it('200 + 解析不了的体 ⇒ malformed-response（**绝不当成功**）', async () => {
    const impl = (() =>
      Promise.resolve({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: () => Promise.reject(new Error('not json')),
      } as unknown as Response)) as unknown as typeof fetch;

    expect(
      await loginWithEmailPassword(opts({ fetchImpl: impl }), {
        email: 'a@b.c',
        password: 'p'.repeat(9),
      }),
    ).toMatchObject({ ok: false, reason: 'malformed-response' });
  });
});

/**
 * 「给账号加上**第一个**登录口令」这条路（`/password/set`）。
 *
 * 🔴 它存在的理由是真实缺陷：passkey-only / 魔法链接注册的账号，`change` 会回
 * `no_password_set`，而 `forgot` 对没有口令认证器的账号**刻意不发信**（反枚举）——
 * 也就是说在补上这条路由之前，这类账号**永远**加不上登录密码，而界面词条
 * （`common.auth.error.lastPasskey`）早就在建议"或者设一个登录密码"。
 *
 * 这一组钉的是它**不是 `change` 的别名**：不验当前口令、不回会话、不换令牌。
 * 这三样中任何一样"顺手补上"，症状都是"加个密码，手机和笔记本一起掉线"
 * 或"界面刚说成功，用户这个标签页就被踢出去"。
 */
describe('setInitialPassword：加认证器，不是换钥匙', () => {
  it('请求体只有 newPassword —— 没有 currentPassword，也没有 token', async () => {
    const { impl, calls } = ok({ message: 'Password set' });
    await setInitialPassword(opts({ fetchImpl: impl }), 'jwt', { newPassword: 'b'.repeat(9) });
    expect(calls[0]!.body).toEqual({ newPassword: 'b'.repeat(9) });
    expect(Object.keys(calls[0]!.body as object)).not.toContain('currentPassword');
  });

  it('口令原样发出，一个字符都不加工（归一化只在服务端一处）', async () => {
    const { impl, calls } = ok({ message: 'Password set' });
    await setInitialPassword(opts({ fetchImpl: impl }), 'jwt', { newPassword: '  P@ss word ' });
    expect(calls[0]!.body).toEqual({ newPassword: '  P@ss word ' });
  });

  it('带 locale 时随体发出（它不是发信的路，但账号语言仍然要跟过去）', async () => {
    const { impl, calls } = ok({ message: 'Password set' });
    await setInitialPassword({ ...opts({ locale: 'en' }), fetchImpl: impl }, 'jwt', {
      newPassword: 'b'.repeat(9),
    });
    expect((calls[0]!.body as Record<string, unknown>)['locale']).toBe('en');
  });

  it('🔴 成功**不回会话**：身上不许出现 session / token —— 令牌没被作废，换了才会掉线', async () => {
    const outcome = (await setInitialPassword(
      opts({ fetchImpl: ok({ message: 'Password set' }).impl }),
      'jwt',
      { newPassword: 'b'.repeat(9) },
    )) as Record<string, unknown>;
    expect(outcome.ok).toBe(true);
    expect(outcome).not.toHaveProperty('session');
    expect(outcome).not.toHaveProperty('token');
    expect(outcome.message).toBe('Password set');
  });

  it('空 token ⇒ unauthorized，**一个字节都不发**', async () => {
    const { impl, calls } = ok({ message: 'Password set' });
    const outcome = await setInitialPassword(opts({ fetchImpl: impl }), '   ', {
      newPassword: 'b'.repeat(9),
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });

  it('空 newPassword ⇒ invalid-input，**一个字节都不发**', async () => {
    const { impl, calls } = ok({ message: 'Password set' });
    const outcome = await setInitialPassword(opts({ fetchImpl: impl }), 'jwt', {
      newPassword: '',
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });

  it('Bearer 头就是那枚**旧**令牌（这条路不换它）', async () => {
    const { impl, calls } = ok({ message: 'Password set' });
    await setInitialPassword(opts({ fetchImpl: impl }), 'jwt-keep-me', {
      newPassword: 'b'.repeat(9),
    });
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer jwt-keep-me');
  });

  /**
   * 🔴 成功**只看 HTTP 2xx**，message 读不懂就给空串。
   *
   * 这条不是洁癖：把"服务端那句问候语解析失败"判成失败，用户会以为密码没设上、
   * 再点一次 —— 而第二次拿到的是 `password_already_set`。一句"明明成功了却说失败"
   * 在这条路上会把人推进死循环。
   */
  it('200 但 message 读不懂 ⇒ 仍然算成功，message 是空串（不替服务端编话）', async () => {
    for (const body of [{}, { message: '' }, { message: 42 }, 'not-an-object']) {
      const outcome = await setInitialPassword(opts({ fetchImpl: ok(body).impl }), 'jwt', {
        newPassword: 'b'.repeat(9),
      });
      expect(outcome).toMatchObject({ ok: true, message: '' });
    }
  });
});
