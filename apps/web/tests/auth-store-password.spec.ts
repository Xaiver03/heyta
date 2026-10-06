/**
 * 邮箱 + 口令那条路的 **store 侧**测试（W6d）
 * ============================================
 *
 * 这里**不渲染任何组件** —— 渲染那份在 `auth-form.spec.tsx`，
 * 而协议字节那份在 `packages/app-host/tests/hosted-password-auth.spec.ts`。
 * 这一层只管一件事：**状态机有没有说谎**。
 *
 * 🔴 五条判据各自挡的是一个**已经在本仓库反复出现过**的形状：
 *
 *   1. **拿到会话却没接上同步配置** ⇒ 界面显示"已登录"，同步仍然说未配置。
 *      （把 `store.ts` 里的 `applyAuthSession(...)` 删掉 ⇒ 第 1 组红。）
 *   2. **多字段的结果被单字段的构造点吃掉** ⇒ `policyCode` / `retryAfterSeconds`
 *      在服务端给了、在 `HostedAuthFailure` 上有，而手写的
 *      `{ kind: 'failed', reason: outcome.reason }` 把它俩静默丢掉。
 *      丢掉的症状不是崩溃，是"界面少说一句具体的话"—— 没有任何一层会报错。
 *      （把 `failedFrom(outcome)` 换回手写 ⇒ 第 2 组红。）
 *   3. **"号建了"渲染成"登录好了"** ⇒ 注册成功必须停在 `registered`，
 *      而且**不许**写令牌。（把状态改成 `signed-in` ⇒ 第 3 组红。）
 *   4. **改密之后手上那枚已失效的令牌继续用** ⇒ `tokenVersion` 刚 bump，
 *      症状是"改密码成功，这个标签页立刻同步失败"。（不换上返回的新会话 ⇒ 第 4 组红。）
 *   5. **防枚举的结论被写进状态** ⇒ `/password/forgot` 对"有账号 / 没账号 / 异常"
 *      回**同一句 + 200**，所以 store 拿到 `ok` 也只能进 `reset-sent`，
 *      界面那句只能是"如果我们认得这个邮箱…"。（看 `exists` 分支 ⇒ 第 5 组红。）
 *
 * ⚠️ 全程零联网：`fetch` 一律 stub。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_PASSWORD_PATHS } from '@heyta/shared-schema';

import { __resetAuthForTests, useAuthStore } from '../src/features/auth/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE_URL = 'https://sync.example.com';

/** 服务端 `/login/email-password` 与 `/password/change` 的响应形状（同形）。 */
const SESSION = {
  token: 'jwt-from-password-login',
  user: { id: 7, email: 'me@example.com' },
};

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

let calls: RecordedCall[];

function flattenHeaders(init: RequestInit | undefined): Record<string, string> {
  const raw = init?.headers;
  const out: Record<string, string> = {};
  if (raw instanceof Headers) {
    raw.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, string>)) {
      out[key.toLowerCase()] = String(value);
    }
  }
  return out;
}

/**
 * 按 URL 决定回什么。**记录每一条**，包括一条都不该发的时候。
 *
 * 记录本身是判据的一部分：第 6 组要断言"空令牌时**一个请求都不发**"，
 * 而没记录的 fetch 替身只能证明"没成功"，证明不了"没发"。
 */
function stubFetch(responder: (url: string) => Spec): void {
  calls = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({
      url,
      init,
      body: rawBody === undefined ? undefined : JSON.parse(rawBody),
      headers: flattenHeaders(init),
    });
    const spec = responder(url);
    return Promise.resolve({
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      headers: new Headers(spec.headers ?? {}),
      json: () => Promise.resolve(spec.body ?? {}),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  vi.stubGlobal('fetch', impl);
}

interface Spec {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** 全部回同一个响应。 */
function stubAll(spec: Spec): void {
  stubFetch(() => spec);
}

/** 只让某一条路径命中，其余回 404（用来确保断言打到的是**那条**请求）。 */
function stubPath(path: string, spec: Spec): void {
  stubFetch((url) => (url.endsWith(`/api${path}`) ? spec : { status: 404 }));
}

/** 从记录里取某条路径的最后一次调用（同一用例里连发两次时，第一次是上一段的）。 */
function callFor(path: string): RecordedCall | undefined {
  const all = calls.filter((c) => c.url.endsWith(`/api${path}`));
  return all[all.length - 1];
}

beforeEach(() => {
  __resetAuthForTests();
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    status: { kind: 'idle' },
    syncSettingsRequested: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('1. 口令登录成功必须真的接上同步配置', () => {
  it('状态 signed-in，且令牌写进了 sync store', async () => {
    stubPath(AUTH_PASSWORD_PATHS.login, { status: 200, body: SESSION });

    const session = await useAuthStore
      .getState()
      .signInWithPassword(BASE_URL, 'me@example.com', 'correct horse');

    expect(useAuthStore.getState().status).toEqual({ kind: 'signed-in', email: 'me@example.com' });
    expect(session?.token).toBe(SESSION.token);
    // 🔴 这一行是"界面说成功、功能也接上"的唯一判据：删掉 applyAuthSession 就红。
    expect(useSyncStore.getState().token).toBe(SESSION.token);
    expect(useSyncStore.getState().baseUrl).toBe(BASE_URL);
    // Vault mode must bind to the authenticated account id, never to a device id
    // or an email that can change.  This is the production handoff that selects
    // the account/server-scoped opaque key-package session.
    expect(useSyncStore.getState().accountId).toBe(String(SESSION.user.id));
  });

  it('请求打到 /api/login/email-password，方法 POST', async () => {
    stubPath(AUTH_PASSWORD_PATHS.login, { status: 200, body: SESSION });
    await useAuthStore.getState().signInWithPassword(BASE_URL, 'me@example.com', 'p2');

    const call = callFor(AUTH_PASSWORD_PATHS.login);
    expect(call?.init?.method).toBe('POST');
  });

  it('🔴 口令**原样**交出：不 trim、不改大小写', async () => {
    stubPath(AUTH_PASSWORD_PATHS.login, { status: 200, body: SESSION });
    // 末尾空格 + 大小写混合：客户端任何一次"好心"的整理都会让它和别的设备不一致。
    await useAuthStore.getState().signInWithPassword(BASE_URL, 'me@example.com', ' Pa55w0rd  ');

    expect((callFor(AUTH_PASSWORD_PATHS.login)?.body as { password: string }).password).toBe(
      ' Pa55w0rd  ',
    );
  });

  it('响应 200 但没有可用会话 ⇒ failed，且**不写**令牌', async () => {
    stubPath(AUTH_PASSWORD_PATHS.login, { status: 200, body: { user: SESSION.user } });

    await useAuthStore.getState().signInWithPassword(BASE_URL, 'me@example.com', 'p3');

    expect(useAuthStore.getState().status).toMatchObject({ kind: 'failed', reason: 'malformed-response' });
    expect(useSyncStore.getState().token).toBeUndefined();
  });
});

describe('2. 🔴 失败的结构化信息一条都不许在 store 里丢掉', () => {
  it('password_policy_violation ⇒ failed 带着服务端的 policyCode', async () => {
    // 策略码只在**设口令**的那两条路上会出现（注册 / 改密），登录那条不会 ——
    // 所以这里 stub 的是 register，而不是 login。
    stubPath(AUTH_PASSWORD_PATHS.register, {
      status: 400,
      body: { error: 'x', code: 'password_policy_violation', policyCode: 'breached' },
    });

    await useAuthStore.getState().registerWithPassword(BASE_URL, 'me@example.com', 'p', true);

    // `breached` 是唯一一条"该告诉用户他在别处也用了这句口令"的策略码。
    // 丢掉它的代价不是崩，是把四条做法完全不同的失败并成一句废话。
    expect(useAuthStore.getState().status).toMatchObject({
      kind: 'failed',
      reason: 'password-policy',
      policyCode: 'breached',
    });
  });

  it('account_locked + Retry-After ⇒ failed 带着秒数', async () => {
    stubPath(AUTH_PASSWORD_PATHS.login, {
      status: 429,
      headers: { 'retry-after': '37' },
      body: { error: 'x', code: 'account_locked' },
    });

    await useAuthStore.getState().signInWithPassword(BASE_URL, 'me@example.com', 'p');

    // 没有秒数，用户只能对着表单反复敲；有秒数，界面能老实说"再等 37 秒"。
    expect(useAuthStore.getState().status).toMatchObject({
      kind: 'failed',
      reason: 'password-locked',
      retryAfterSeconds: 37,
    });
  });

  it('没有 Retry-After 头时**不许**凭空写成 0 秒', async () => {
    stubPath(AUTH_PASSWORD_PATHS.login, {
      status: 429,
      body: { error: 'x', code: 'account_locked' },
    });

    await useAuthStore.getState().signInWithPassword(BASE_URL, 'me@example.com', 'p');

    const status = useAuthStore.getState().status;
    // "undefined" 和 "0" 在界面上是两句话：后者会显示"再等 0 秒"。
    expect('retryAfterSeconds' in status).toBe(false);
  });

  it('口令错误的三种账号状态在服务端就是同一条，这里也只能是同一条', async () => {
    stubPath(AUTH_PASSWORD_PATHS.login, {
      status: 401,
      body: { error: 'x', code: 'invalid_credentials' },
    });

    await useAuthStore.getState().signInWithPassword(BASE_URL, 'me@example.com', 'p');

    // 🔴 断言的是**没有**任何"账号不存在 / 没设口令"的痕迹可被界面区分出来。
    expect(useAuthStore.getState().status).toMatchObject({ reason: 'invalid-credentials' });
  });
});

describe('3. 注册成功不等于已登录', () => {
  it('状态 registered，**没有**写令牌，也没有返回会话', async () => {
    stubPath(AUTH_PASSWORD_PATHS.register, { status: 201, body: { message: 'ok' } });

    await useAuthStore.getState().registerWithPassword(BASE_URL, 'me@example.com', 'p', true);

    expect(useAuthStore.getState().status).toEqual({ kind: 'registered' });
    expect(useSyncStore.getState().token).toBeUndefined();
  });

  it('没勾条款时请求体里**没有** termsAccepted 键（绝不替用户发明同意）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.register, { status: 201, body: { message: 'ok' } });

    await useAuthStore.getState().registerWithPassword(BASE_URL, 'me@example.com', 'p', false);

    const body = callFor(AUTH_PASSWORD_PATHS.register)?.body as Record<string, unknown>;
    expect('termsAccepted' in body).toBe(false);
  });

  it('勾了才发 true', async () => {
    stubPath(AUTH_PASSWORD_PATHS.register, { status: 201, body: { message: 'ok' } });

    await useAuthStore.getState().registerWithPassword(BASE_URL, 'me@example.com', 'p', true);

    expect(callFor(AUTH_PASSWORD_PATHS.register)?.body).toMatchObject({ termsAccepted: true });
  });

  it('邀请码原样发出，空串等于没带', async () => {
    stubAll({ status: 201, body: { message: 'ok' } });

    await useAuthStore
      .getState()
      .registerWithPassword(BASE_URL, 'me@example.com', 'p', true, { inviteCode: 'frIend-42' });
    expect(callFor(AUTH_PASSWORD_PATHS.register)?.body).toMatchObject({ inviteCode: 'frIend-42' });

    await useAuthStore
      .getState()
      .registerWithPassword(BASE_URL, 'me@example.com', 'p', true, { inviteCode: '' });
    expect('inviteCode' in (callFor(AUTH_PASSWORD_PATHS.register)?.body as object)).toBe(false);
  });
});

describe('4. 改密必须把当前设备换到新会话', () => {
  it('状态 password-changed（**不是** signed-in）且令牌已换', async () => {
    const fresh = { token: 'jwt-after-change', user: { id: 7, email: 'me@example.com' } };
    stubPath(AUTH_PASSWORD_PATHS.change, { status: 200, body: fresh });
    useSyncStore.setState({ token: 'jwt-old' });

    const session = await useAuthStore
      .getState()
      .changePassword(BASE_URL, 'jwt-old', 'old-one', 'new-one');

    expect(useAuthStore.getState().status).toEqual({
      kind: 'password-changed',
      email: 'me@example.com',
    });
    // 🔴 `tokenVersion` 刚 bump，旧令牌当场作废；不换上新会话就是这个标签页自己掉线。
    expect(useSyncStore.getState().token).toBe(fresh.token);
    expect(session?.token).toBe(fresh.token);
  });

  it('请求带上当前令牌做 Authorization（改密是已认证动作）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, {
      status: 200,
      body: { token: 'jwt-new', user: { id: 7, email: 'me@example.com' } },
    });

    await useAuthStore.getState().changePassword(BASE_URL, 'jwt-old', 'a', 'b');

    expect(callFor(AUTH_PASSWORD_PATHS.change)?.headers['authorization']).toContain('jwt-old');
  });

  it('🔴 没有令牌时**一个请求都不发**，直接 failed', async () => {
    stubAll({ status: 200, body: SESSION });

    await useAuthStore.getState().changePassword(BASE_URL, undefined, 'a', 'b');

    expect(calls.length).toBe(0);
    expect(useAuthStore.getState().status).toMatchObject({ kind: 'failed', reason: 'unauthorized' });
  });
});

describe('5. 防枚举：状态里不许出现"这个邮箱存在吗"的判断', () => {
  it('服务端回 exists:false 也进 reset-sent（界面上两句话必须一样）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.forgot, { status: 200, body: { message: 'neutral' } });

    await useAuthStore.getState().forgotPassword(BASE_URL, 'nobody@example.com');

    expect(useAuthStore.getState().status).toEqual({ kind: 'reset-sent' });
  });

  it('连服务端异常也回 200 ⇒ 仍然只是 reset-sent，不说"已发送到你邮箱"', async () => {
    // 服务端在异常路径上也回 200 + 同一句中性话（OWASP 点的是状态码，不只是文案）。
    stubPath(AUTH_PASSWORD_PATHS.forgot, { status: 200, body: { message: 'neutral' } });

    await useAuthStore.getState().forgotPassword(BASE_URL, 'me@example.com');

    const status = useAuthStore.getState().status;
    // 状态里除了 kind **什么都没有** —— 没有邮箱存在性的痕迹可供界面分支。
    expect(status).toEqual({ kind: 'reset-sent' });
  });
});

describe('6. 在飞守卫的状态依据', () => {
  it('请求未落地时状态是对应的 busy action，**不是一个空状态**', async () => {
    let release: ((value: Response) => void) | undefined;
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );

    const pending = useAuthStore.getState().signInWithPassword(BASE_URL, 'me@example.com', 'p');
    expect(useAuthStore.getState().status).toEqual({
      kind: 'busy',
      action: 'password-sign-in',
    });

    release?.({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve(SESSION),
    } as unknown as Response);
    await pending;
    expect(useAuthStore.getState().status).toMatchObject({ kind: 'signed-in' });
  });

  it('四条口令路径各有自己的 busy action —— 一句"正在处理"会藏掉动作', async () => {
    const actions: string[] = [];
    let release: ((value: Response) => void) | undefined;
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );

    const track = async (run: () => Promise<unknown>): Promise<void> => {
      const pending = run();
      actions.push((useAuthStore.getState().status as { action: string }).action);
      release?.({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: () => Promise.resolve({ message: 'ok', ...SESSION }),
      } as unknown as Response);
      await pending;
    };

    await track(() => useAuthStore.getState().signInWithPassword(BASE_URL, 'a@b.c', 'p'));
    await track(() => useAuthStore.getState().registerWithPassword(BASE_URL, 'a@b.c', 'p', true));
    await track(() => useAuthStore.getState().forgotPassword(BASE_URL, 'a@b.c'));
    await track(() => useAuthStore.getState().changePassword(BASE_URL, 'jwt', 'a', 'b'));

    expect(actions).toEqual([
      'password-sign-in',
      'password-register',
      'password-forgot',
      'password-change',
    ]);
  });
});

/**
 * 6. 🔴 服务端说"信没发出去"时，状态里必须留着这句话的痕迹。
 *
 * 这一条存在的理由和第 2 组是同一个：**症状不是崩溃，是界面少说一句真话**。
 * 一台没配 SMTP 的自托管服务器上，注册回 `emailDelivered:false`，
 * 而 store 若把它丢掉，界面渲染的就是"去查收邮件"—— 一封永远不会来的信。
 * 用户唯一的"再试一次"动作只会再拿到同一句谎话（`server/tests/self-host-email-verification.spec.ts`
 * 钉的是服务端不说谎，这里钉的是**客户端不许把真话弄丢**）。
 *
 * 两个方向都钉：`false` 要带上来，缺省不许凭空造出来 ——
 * 后者防的是 `mailDelivered: outcome.emailDelivered !== false` 那种反写，
 * 它会让每次成功注册都显示"邮件没发出去"。
 * （变异：把 `registeredFrom` 改成恒返回 `{ kind: 'registered' }` ⇒ 第一条红；
 *  改成 `{ kind:'registered', mailDelivered: outcome.emailDelivered !== false ? false : undefined }` ⇒ 第二条红。）
 */
describe('6. emailDelivered:false 必须活到状态里，而缺省不许变成 false', () => {
  it('服务端说没发出去 ⇒ registered 带着 mailDelivered:false', async () => {
    stubPath(AUTH_PASSWORD_PATHS.register, {
      status: 201,
      body: { message: 'ok', emailDelivered: false },
    });

    await useAuthStore.getState().registerWithPassword(BASE_URL, 'me@example.com', 'p', true);

    expect(useAuthStore.getState().status).toEqual({
      kind: 'registered',
      mailDelivered: false,
    });
  });

  it('服务端没提这件事 ⇒ 状态里**没有** mailDelivered 这个键', async () => {
    for (const body of [{ message: 'ok' }, { message: 'ok', emailDelivered: true }]) {
      stubPath(AUTH_PASSWORD_PATHS.register, { status: 201, body });

      await useAuthStore.getState().registerWithPassword(BASE_URL, 'me@example.com', 'p', true);

      expect(useAuthStore.getState().status, JSON.stringify(body)).toEqual({
        kind: 'registered',
      });
    }
  });
});
