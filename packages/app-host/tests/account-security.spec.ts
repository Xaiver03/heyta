/**
 * 换绑邮箱 + 登录会话的**客户端契约**测试（工单 W3）。
 *
 * 🔴 这一组挡的不是解析对不对，而是**客户端与服务端之间那份契约本身**：
 * 路径逐字、方法、Bearer 出现在哪几条、失败归成哪一类 reason。
 * 这些漂移的症状是"某台设备上点了退出登录、那枚令牌在服务端还活一整年"，
 * 而本地一切正常。
 *
 * 另一半是 fail-safe：未配置不发请求、没 `fetch` 不崩、
 * 2xx 但响应不像话**绝不当成功**。
 *
 * ⚠️ 全程零联网：`fetch` 一律注入。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  EMAIL_CHANGE_ERROR_CODES,
  EMAIL_CHANGE_PATHS,
  SESSION_ERROR_CODES,
  SESSION_PATHS,
} from '@heyta/shared-schema';

import {
  FAILURE_REASON_BY_SERVER_CODE,
  type HostedAuthOptions,
} from '../src/hosted-auth.js';
import {
  ACCOUNT_SECURITY_PATHS,
  cancelEmailChange,
  emailChangeStage,
  getEmailChangeStatus,
  listHostedSessions,
  logoutCurrentDevice,
  logoutEveryDevice,
  planSignOut,
  requestEmailChange,
  revokeHostedSession,
} from '../src/account-security.js';

const BASE = 'http://127.0.0.1:3000';
const TOKEN = 'a'.repeat(64);
const SESSION_ID = 'b'.repeat(64);

interface Call {
  url: string;
  method: string | undefined;
  headers: Headers | Record<string, string> | string[][] | undefined;
  body: unknown;
}

const responder = (spec: { status: number; body?: unknown }) =>
  ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(input), method: init?.method, headers: init?.headers, body: raw });
    return Promise.resolve({
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      json: () => Promise.resolve(spec.body ?? {}),
      headers: new Headers(),
    } as Response);
  }) as unknown as typeof fetch;

let calls: Call[] = [];

// 🔴 每条用例自己重新数一遍：`toHaveLength(0)` 与 `callAt(0)` 都建立在这个重置上，
// 少了它后面每一条都在给**前面所有用例**的调用打分（那是一条永远通过的判据的反面）。
beforeEach(() => {
  calls = [];
});

const options = (overrides: Partial<HostedAuthOptions> = {}): HostedAuthOptions => ({
  baseUrl: BASE,
  fetchImpl: responder({ status: 200, body: {} }),
  ...overrides,
});

const bearerOf = (call: Call): string | undefined => {
  const headers = call.headers as Record<string, string> | undefined;
  return headers?.['authorization'];
};

/**
 * 取第 n 次调用。**取不到就抛**，不把 `undefined` 交给断言去打分 ——
 * "这一发根本没发出去"是一条真判据，但它必须是**响的**，不是 `expect(undefined.url)`。
 */
const callAt = (n: number): Call => {
  const call = calls[n];
  if (call === undefined) throw new Error(`第 ${String(n + 1)} 次请求从未发出`);
  return call;
};

const ok = (body: unknown): HostedAuthOptions => options({ fetchImpl: responder({ status: 200, body }) });
const fail = (status: number, body: unknown): HostedAuthOptions =>
  options({ fetchImpl: responder({ status, body }) });

describe('路径逐字等于契约（漂移的症状是 404，不是报错）', () => {
  it('三条换绑路由 + 四条会话路由，`/api` 那一层只在客户端存在', () => {
    expect(ACCOUNT_SECURITY_PATHS.changeRequest).toBe(`/api/${EMAIL_CHANGE_PATHS.request}`);
    expect(ACCOUNT_SECURITY_PATHS.changeStatus).toBe(`/api/${EMAIL_CHANGE_PATHS.status}`);
    expect(ACCOUNT_SECURITY_PATHS.changeCancel).toBe(`/api/${EMAIL_CHANGE_PATHS.cancel}`);
    expect(ACCOUNT_SECURITY_PATHS.sessions).toBe(`/api/${SESSION_PATHS.list}`);
    expect(ACCOUNT_SECURITY_PATHS.sessionsRevokeAll).toBe(`/api/${SESSION_PATHS.revokeAll}`);
    expect(ACCOUNT_SECURITY_PATHS.logout).toBe(`/api/${SESSION_PATHS.logout}`);
    expect(ACCOUNT_SECURITY_PATHS.sessionRevoke(SESSION_ID)).toBe(
      `/api/${SESSION_PATHS.list}/${SESSION_ID}`,
    );
  });

  it('请求真的打在那个 URL 上（表对了但调用点拼错是另一种 404）', async () => {
    await requestEmailChange(ok({ message: 'm', expiresAt: 1, resendAvailableAt: 2 }), TOKEN, 'n@e.test');
    expect(callAt(0).url).toBe(`${BASE}/api/${EMAIL_CHANGE_PATHS.request}`);
    expect(callAt(0).method).toBe('POST');

    await getEmailChangeStatus(ok({ pending: false, awaitingOld: false, awaitingNew: false }), TOKEN);
    expect(callAt(1).url).toBe(`${BASE}/api/${EMAIL_CHANGE_PATHS.status}`);
    expect(callAt(1).method).toBe('GET');
    // 🔴 GET 不许带请求体：带了就是"客户端以为 status 会改状态"，而它不会。
    expect(callAt(1).body).toBeUndefined();

    await revokeHostedSession(ok({ success: true }), TOKEN, SESSION_ID);
    expect(callAt(2).url).toBe(`${BASE}/api/${SESSION_PATHS.list}/${SESSION_ID}`);
    expect(callAt(2).method).toBe('DELETE');
  });

  it('🔴 这一层**没有** confirm 那条路：点邮件的人手上没有会话，出口是服务端那张凭据页', () => {
    const urls = Object.values(ACCOUNT_SECURITY_PATHS)
      .map((entry) => (typeof entry === 'string' ? entry : ''))
      .filter((entry) => entry !== '');
    for (const url of urls) {
      expect(url).not.toContain(EMAIL_CHANGE_PATHS.confirm);
    }
  });

  it('🔴 「退出这一台」与「退出所有设备」各自打在**自己的**那条 URL 上', async () => {
    // 界面上这两句是分开的两个动作（措辞判据在 web/移动那两层）。但把它们接错的
    // 地方在共享层：`logoutCurrentDevice` 打去 revoke-all，界面上那句"只退出这一台"
    // 就成了假话，而症状是"另一台设备也被踢了" —— 只有对着真 URL 才现形。
    // 这条判据不是补上来的：变异 M12（把 logout 的调用点换成 sessionsRevokeAll）
    // 在这一层**活下来过**，所以它现在必须存在。
    await logoutCurrentDevice(ok({ message: 'Signed out.' }), TOKEN);
    expect(callAt(0).url).toBe(`${BASE}/api/${SESSION_PATHS.logout}`);
    expect(callAt(0).method).toBe('POST');

    await logoutEveryDevice(ok({ success: true, count: 2 }), TOKEN);
    expect(callAt(1).url).toBe(`${BASE}/api/${SESSION_PATHS.revokeAll}`);
    expect(callAt(1).method).toBe('POST');

    // 反向对照：两条路由本身必须不同形 —— 否则上面两个断言可以在"并成一条"之后同时成立。
    expect(SESSION_PATHS.logout).not.toBe(SESSION_PATHS.revokeAll);
  });
});

describe('七条路由都要 Bearer，且未配置/空令牌时一个请求都不发', () => {
  const calls7: Array<(o: HostedAuthOptions, t: string) => Promise<unknown>> = [
    (o, t) => requestEmailChange(o, t, 'new@example.test'),
    (o, t) => getEmailChangeStatus(o, t),
    (o, t) => cancelEmailChange(o, t),
    (o, t) => listHostedSessions(o, t),
    (o, t) => revokeHostedSession(o, t, SESSION_ID),
    (o, t) => logoutEveryDevice(o, t),
    (o, t) => logoutCurrentDevice(o, t),
  ];

  it.each(calls7.map((fn, i) => [i, fn] as const))('#%i 带上服务端认的那个头', async (_i, fn) => {
    await fn(ok({ success: true, message: 'm', count: 1, sessions: [], pending: false, awaitingOld: false, awaitingNew: false, expiresAt: 1, resendAvailableAt: 2 }), TOKEN);
    expect(bearerOf(callAt(0))).toBe(`Bearer ${TOKEN}`);
  });

  it.each(calls7.map((fn, i) => [i, fn] as const))('#%i 令牌为空 ⇒ 不发请求', async (_i, fn) => {
    const result = await fn(options(), '   ');
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, reason: 'invalid-input' });
  });

  it.each(calls7.map((fn, i) => [i, fn] as const))('#%i 未配置地址 ⇒ 不发请求（自托管不受影响）', async (_i, fn) => {
    const result = await fn(options({ baseUrl: '', fetchImpl: responder({ status: 200 }) }), TOKEN);
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, reason: 'unconfigured' });
  });

  it('网络层抛错 ⇒ network，不是进程崩溃', async () => {
    const throwing = (() => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(logoutCurrentDevice(options({ fetchImpl: throwing }), TOKEN)).resolves.toMatchObject({
      ok: false,
      reason: 'network',
    });
  });
});

describe('失败归类只按服务端的稳定码，不按状态码', () => {
  it('429 + `email_change_cooldown` ⇒ 不是"你发得太猛"，而是"两封信已经在路上"', async () => {
    const result = await requestEmailChange(
      fail(429, { error: 'x', code: 'email_change_cooldown' }),
      TOKEN,
      'new@example.test',
    );
    expect(result).toMatchObject({ ok: false, reason: 'email-change-cooldown', code: 'email_change_cooldown' });
  });

  it('409 + `email_taken` ⇒ `email-taken`（这条只在已认证的 request 侧存在）', async () => {
    const result = await requestEmailChange(fail(409, { error: 'x', code: 'email_taken' }), TOKEN, 'n@e.test');
    expect(result).toMatchObject({ ok: false, reason: 'email-taken' });
  });

  it('400 + `email_unchanged` / `invalid_change_link` 各自一个 reason，不塌成 invalid-input', async () => {
    const unchanged = await requestEmailChange(fail(400, { error: 'x', code: 'email_unchanged' }), TOKEN, 'n@e.test');
    const link = await cancelEmailChange(fail(400, { error: 'x', code: 'invalid_change_link' }), TOKEN);
    expect(unchanged).toMatchObject({ ok: false, reason: 'email-unchanged' });
    expect(link).toMatchObject({ ok: false, reason: 'invalid-change-link' });
  });

  it('会话撤销三种"撤不动"同一句：400 + `unknown_session`', async () => {
    const result = await revokeHostedSession(fail(400, { error: 'x', code: 'unknown_session' }), TOKEN, SESSION_ID);
    expect(result).toMatchObject({ ok: false, reason: 'unknown-session' });
  });

  it('🔴 词表里每一个服务端码都有客户端映射（加了码忘了映射会静默退化成状态分类）', () => {
    const codes = [...EMAIL_CHANGE_ERROR_CODES, ...SESSION_ERROR_CODES];
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(FAILURE_REASON_BY_SERVER_CODE[code], `服务端码 ${code} 没有客户端映射`).toBeDefined();
    }
  });
});

describe('2xx 但响应不像话 ⇒ 绝不当成功', () => {
  it('发起成功缺 `expiresAt` ⇒ malformed（界面拿 0 会说"已过期"这句假话）', async () => {
    const result = await requestEmailChange(ok({ message: 'm', resendAvailableAt: 2 }), TOKEN, 'n@e.test');
    expect(result).toMatchObject({ ok: false, reason: 'malformed-response' });
  });

  it('status 缺 `pending` ⇒ malformed，而不是当成"没有活请求"', async () => {
    const result = await getEmailChangeStatus(ok({ awaitingOld: true, awaitingNew: true }), TOKEN);
    expect(result).toMatchObject({ ok: false, reason: 'malformed-response' });
  });

  it('🔴 这一层的解析是**白名单**，所以 `currentEmail` 必须活着穿过去', async () => {
    // 它丢掉一切不点名的键。服务端加了字段而这里不点名 ⇒ 症状是"响应里明明有，
    // 界面还是旧的"，而那一格只有真设备验收才看得见（第 11 趟步骤 10 就是这么红的）。
    const result = await getEmailChangeStatus(
      ok({ pending: true, awaitingOld: true, awaitingNew: false, pendingEmail: 'n@e.test', currentEmail: 'o@e.test', expiresAt: 1, resendAvailableAt: 2 }),
      TOKEN,
    );
    expect(result).toMatchObject({ ok: true, currentEmail: 'o@e.test' });
  });

  it('🔴 `pending: false` 那一支**也要**把地址带回去 —— 生效之后最需要它的那一刻', async () => {
    // 换绑生效 = 活请求被删掉。若把 `currentEmail` 和 `pending` 一起门控，
    // 界面在"刚换完"这一格恰好读不到真值，而其余四格都读得到 —— 一条只在最该生效时失效的判据。
    const result = await getEmailChangeStatus(
      ok({ pending: false, awaitingOld: false, awaitingNew: false, currentEmail: 'new@e.test' }),
      TOKEN,
    );
    expect(result).toMatchObject({ ok: true, pending: false, currentEmail: 'new@e.test' });
  });

  it('空串按"服务端没给"处理，不当成一个能显示的邮箱（也不报错）', async () => {
    const result = await getEmailChangeStatus(
      ok({ pending: false, awaitingOld: false, awaitingNew: false, currentEmail: '' }),
      TOKEN,
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok !== true) throw new Error('前提不成立');
    expect('currentEmail' in result).toBe(false);
  });

  it('🔴 会话列表里**少一个字段**就整份判 malformed —— 少一行是"看不见那台还登录着的设备"', async () => {
    const result = await listHostedSessions(
      ok({ sessions: [{ sessionId: SESSION_ID, createdAt: 1, lastSeenAt: 2, deviceName: null, userAgent: null }] }),
      TOKEN,
    );
    expect(result).toMatchObject({ ok: false, reason: 'malformed-response' });
  });

  it('会话列表齐整时逐行交出，`null` 与缺键都读成 null', async () => {
    const result = await listHostedSessions(
      ok({ sessions: [{ sessionId: SESSION_ID, createdAt: 1, lastSeenAt: 2, current: true }] }),
      TOKEN,
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok !== true) throw new Error('前提不成立');
    expect(result.sessions[0]).toEqual({
      sessionId: SESSION_ID,
      createdAt: 1,
      lastSeenAt: 2,
      current: true,
      deviceName: null,
      userAgent: null,
    });
  });

  it('撤销响应里 `success` 不是字面量 true ⇒ malformed（"没撤成"不能报成"撤好了"）', async () => {
    for (const body of [{ success: false }, { success: 'true' }, {}]) {
      const result = await revokeHostedSession(ok(body), TOKEN, SESSION_ID);
      expect(result).toMatchObject({ ok: false, reason: 'malformed-response' });
    }
  });
});

describe('请求体的形状', () => {
  it('🔴 `locale` 透传进发信那一发（邮件是为收件人渲染的）', async () => {
    await requestEmailChange({ ...ok({ message: 'm', expiresAt: 1, resendAvailableAt: 2 }), locale: 'en' }, TOKEN, '  New@Example.test ');
    expect(callAt(0).body).toEqual({ newEmail: 'New@Example.test', locale: 'en' });
  });

  it('没给 locale 时**不发**这个键（服务端据此走账号语言那一档）', async () => {
    await requestEmailChange(ok({ message: 'm', expiresAt: 1, resendAvailableAt: 2 }), TOKEN, 'n@e.test');
    expect(callAt(0).body).toEqual({ newEmail: 'n@e.test' });
  });

  it('新地址只有空白 ⇒ 本地就拦下，不发请求', async () => {
    for (const value of ['', '   ']) {
      const result = await requestEmailChange(options(), TOKEN, value);
      expect(result).toMatchObject({ ok: false, reason: 'invalid-input' });
    }
    expect(calls).toHaveLength(0);
  });

  it('🔴 会话 id 形状不合法 ⇒ 不发请求（别让任意字符串进 URL 路径段）', async () => {
    for (const bad of ['', 'not-a-hash', SESSION_ID.slice(0, 63), `${SESSION_ID}../../`]) {
      const result = await revokeHostedSession(options(), TOKEN, bad);
      expect(result).toMatchObject({ ok: false, reason: 'invalid-input' });
    }
    expect(calls).toHaveLength(0);
  });
});

describe('退出登录之后本机该怎么办（三个壳共用这一条判定）', () => {
  it('服务端撤成 ⇒ 清本机凭据，不需要警告', async () => {
    const result = await logoutCurrentDevice(ok({ message: 'Signed out.' }), TOKEN);
    expect(planSignOut(result)).toEqual({ clearLocalCredentials: true, serverRevocationPending: false });
  });

  it('🔴 服务端没撤成 ⇒ 本机**照清**，但界面必须说这一枚还挂在服务器上', async () => {
    const result = await logoutCurrentDevice(fail(500, { error: 'boom' }), TOKEN);
    expect(planSignOut(result)).toEqual({ clearLocalCredentials: true, serverRevocationPending: true });
  });

  it('🔴 登出所有设备之后**这一台也算退出** ⇒ 同一条判定（否则界面上这台还显示已登录）', async () => {
    const result = await logoutEveryDevice(ok({ success: true, count: 3 }), TOKEN);
    expect(result).toMatchObject({ ok: true, count: 3 });
    expect(planSignOut(result).clearLocalCredentials).toBe(true);
  });

  it('撤销指定的那一枚会把 id 带回去（界面就地摘行，不必再拉一次列表）', async () => {
    const result = await revokeHostedSession(ok({ success: true }), TOKEN, SESSION_ID);
    expect(result).toEqual({ ok: true, sessionId: SESSION_ID });
  });
});

describe('界面上那句"还等谁点"只有一个来源', () => {
  const status = (over: Record<string, unknown>) => ({
    pending: true,
    awaitingOld: false,
    awaitingNew: false,
    ...over,
  });

  it('五种阶段各自一个值，不靠壳自己拼布尔', () => {
    expect(emailChangeStage(status({ pending: false }))).toBe('idle');
    expect(emailChangeStage(status({ awaitingOld: true, awaitingNew: true }))).toBe('awaiting-both');
    expect(emailChangeStage(status({ awaitingNew: true }))).toBe('awaiting-new');
    expect(emailChangeStage(status({ awaitingOld: true }))).toBe('awaiting-old');
  });

  it('🔴 `pending` 为真却两边都不等 ⇒ 报 invalid，不说"等另一边"也不说"已生效"', () => {
    // 生效那一步会整行删掉，所以这个组合本不该存在；它出现就说明服务端处在
    // 一种我们没写过的状态 —— 界面必须老实，而不是挑一句最像的话。
    expect(emailChangeStage(status({}))).toBe('invalid');
  });
});
