import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 账号安全面（换绑 + 登录会话）的 **HTTP 层**判据。工单 W1/W2 的路由那一半。
 *
 * ## 三层判据的分工（不许互相冒充）
 *
 * | 层 | 文件 | 管什么 |
 * |---|---|---|
 * | 核心逻辑 | `email-change.spec.ts` | 两边都点才生效、存哈希、回滚、并发 |
 * | 库层/鉴权层 | `access-sessions.spec.ts` | 行存在性、列表过滤、白名单投影、缓存空窗的**形状** |
 * | **本文件** | 路由 | 哪几条要 Bearer、状态码映射、**撤销一枚后那枚立刻 401 而别的枚仍能用** |
 *
 * 🔴 为什么 J-W2a 必须在 HTTP 层判：撤销那一枚走的是 `revokeSession`（删行），
 * 而 `verifyToken` 命中认证缓存时**整段跳过库**。所以"点了退出但它还在"这件事
 * 只在真请求上才现形 —— 库层单测里它永远是"行没了"，看着像修好了。
 * 这一组用**真实**的 `auth`/`authCache`/`middleware`，只 mock 数据库与发信。
 *
 * ## 这一组还要挡的四类坏实现
 *
 * 1. **新路由忘了挂 `preHandler`** —— 所以第一条**遍历**所有路由，不抽查。
 * 2. **撤销一枚却把整账号踢下线** —— 断的是两半：那一枚 401 **且另一枚 200**。
 * 3. **响应把凭据一起发出去** —— 会话列表里出现 `jti` 明文或令牌原样就算红。
 * 4. **未认证那条路由变成枚举器** —— `confirm` 的畸形 body 与无效链接必须同码同句。
 */

vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

const SECRET = process.env.JWT_SECRET;
if (SECRET === undefined) throw new Error('测试进程里没有 JWT_SECRET');

const fake = vi.hoisted(() => {
  const state: {
    users: Map<number, Record<string, unknown>>;
    sessions: Map<string, Record<string, unknown>>;
  } = { users: new Map(), sessions: new Map() };

  const project = (
    row: Record<string, unknown> | null | undefined,
    select?: Record<string, boolean>,
  ): Record<string, unknown> | null => {
    if (row === null || row === undefined) return null;
    if (!select) return { ...row };
    return Object.fromEntries(
      Object.entries(select)
        .filter(([, on]) => on)
        .map(([key]) => [key, row[key] === undefined ? null : row[key]]),
    );
  };

  const applyData = (row: Record<string, unknown>, data: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(data)) {
      const current = row[key];
      if (value !== null && typeof value === 'object' && 'increment' in value) {
        const delta = Number((value as { increment: number }).increment);
        row[key] = Number(current ?? 0) + delta;
      } else {
        row[key] = value;
      }
    }
  };

  const user = {
    findUnique: vi.fn(async ({ where, select }: any) =>
      project(state.users.get(where.id) ?? null, select),
    ),
    findUniqueOrThrow: vi.fn(async ({ where, select }: any) => {
      const row = state.users.get(where.id);
      if (row === undefined) throw new Error('Record not found');
      return project(row, select);
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const row = state.users.get(where.id);
      if (row === undefined) throw new Error('Record not found');
      applyData(row, data);
      return project(row, select);
    }),
  };

  const accessSession = {
    create: vi.fn(async ({ data }: any) => {
      const row = { ...data };
      state.sessions.set(String(row.jtiHash), row);
      return { ...row };
    }),
    findFirst: vi.fn(async ({ where, select }: any) => {
      const row = [...state.sessions.values()].find(
        (candidate) => candidate.jtiHash === where.jtiHash && candidate.userId === where.userId,
      );
      return project(row ?? null, select);
    }),
    findMany: vi.fn(async ({ where, select }: any) =>
      [...state.sessions.values()]
        .filter((c) => c.userId === where.userId && c.tokenVersion === where.tokenVersion)
        .map((row) => project(row, select)),
    ),
    update: vi.fn(async ({ where, data }: any) => {
      const row = state.sessions.get(String(where.jtiHash));
      if (row === undefined) throw new Error('Row not found');
      applyData(row, data);
      return { ...row };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const before = state.sessions.size;
      for (const [key, row] of [...state.sessions.entries()]) {
        if (where.userId !== undefined && row.userId !== where.userId) continue;
        if (where.jtiHash !== undefined && row.jtiHash !== where.jtiHash) continue;
        state.sessions.delete(key);
      }
      return { count: before - state.sessions.size };
    }),
  };

  return { state, user, accessSession, project };
});

vi.mock('../src/db', () => ({ prisma: { user: fake.user, accessSession: fake.accessSession } }));

const spiedLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  audit: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../src/logger', () => ({ Logger: spiedLogger }));
vi.mock('../src/email', () => ({
  sendEmailChangeAuthorizeEmail: vi.fn().mockResolvedValue(true),
  sendEmailChangeConfirmEmail: vi.fn().mockResolvedValue(true),
  sendEmailChangedEmail: vi.fn().mockResolvedValue(true),
}));

/** 真实的 `verifyToken` / `issueSession` / `revokeAllTokens`（缓存空窗只有真实现才测得出）。 */
vi.mock('../src/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));

// 换绑**核心**在这份文件里换成假实现：本层要判的是"码 → 状态码"的映射与鉴权边界，
// 核心逻辑的判据在 `email-change.spec.ts`（两层各管各的，见文件头那张表）。
const emailChangeSpies = vi.hoisted(() => ({
  requestEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
  getEmailChangeStatus: vi.fn(),
  cancelEmailChange: vi.fn(),
}));
vi.mock('../src/account/email-change', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    EmailChangeError: (actual as { EmailChangeError: unknown }).EmailChangeError,
    EMAIL_CHANGE_HTTP_STATUS_BY_CODE: (actual as { EMAIL_CHANGE_HTTP_STATUS_BY_CODE: unknown })
      .EMAIL_CHANGE_HTTP_STATUS_BY_CODE,
    ...emailChangeSpies,
  };
});

const wsSpies = vi.hoisted(() => ({
  closeForUser: vi.fn(),
  closeForClient: vi.fn(),
  closeForSession: vi.fn(),
}));
vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => wsSpies,
}));

import { authCache } from '../src/auth-cache';
import { issueSession } from '../src/auth';
import { EmailChangeError } from '../src/account/email-change';
import { accountSecurityRoutes } from '../src/account/account-security.routes';
import { sessionIdOf } from '../src/account/access-sessions';

const USER_ID = 7;
const OTHER_ID = 8;
const EMAIL = 'someone@example.test';

const userRow = (id: number, tokenVersion = 0): Record<string, unknown> => ({
  id,
  email: `u${String(id)}@example.test`,
  isVerified: 1,
  tokenVersion,
});

const jtiOf = (token: string): string =>
  (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { jti: string }).jti;

/** 没有 `jti` 的旧令牌：本轮之前签的就是这个形状。 */
const legacyToken = (userId = USER_ID): string =>
  jwt.sign({ userId, email: `u${String(userId)}@example.test`, tokenVersion: 0 }, SECRET, {
    expiresIn: '1h',
  });

let app: FastifyInstance;

const signIn = async (userId = USER_ID): Promise<{ token: string; sessionId: string }> => {
  const token = await issueSession({ id: userId }, { userAgent: 'RouteTest/1.0' });
  return { token, sessionId: sessionIdOf(jtiOf(token)) };
};

const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

beforeEach(async () => {
  vi.clearAllMocks();
  authCache.clear();
  fake.state.users = new Map([
    [USER_ID, userRow(USER_ID)],
    [OTHER_ID, userRow(OTHER_ID)],
  ]);
  fake.state.sessions = new Map();
  emailChangeSpies.requestEmailChange.mockResolvedValue({
    message: 'ok',
    expiresAt: 1,
    resendAvailableAt: 2,
  });
  emailChangeSpies.getEmailChangeStatus.mockResolvedValue({
    pending: false,
    awaitingOld: false,
    awaitingNew: false,
  });
  emailChangeSpies.cancelEmailChange.mockResolvedValue({ message: 'cancelled' });
  emailChangeSpies.confirmEmailChange.mockResolvedValue({ message: 'confirmed', applied: false });

  app = Fastify();
  await app.register(accountSecurityRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  authCache.clear();
});

describe('鉴权边界：遍历，不抽查', () => {
  /** 除 `confirm` 之外每一条都要 Bearer。写在一起是为了让"以后新加一条忘了挂"必然红。 */
  const guarded: Array<{ label: string; method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: unknown }> = [
    { label: '换绑发起', method: 'POST', url: '/api/account/email/change/request', payload: { newEmail: 'n@e.test' } },
    { label: '换绑状态', method: 'GET', url: '/api/account/email/change/status' },
    { label: '换绑撤销', method: 'POST', url: '/api/account/email/change/cancel' },
    { label: '会话列表', method: 'GET', url: '/api/auth/sessions' },
    { label: '撤销一枚', method: 'DELETE', url: `/api/auth/sessions/${'a'.repeat(64)}` },
    { label: '登出全部', method: 'POST', url: '/api/auth/sessions/revoke-all' },
    { label: '退出本机', method: 'POST', url: '/api/auth/logout' },
  ];

  it.each(guarded)('$label：没有令牌 ⇒ 401，而且一次库都不读', async ({ method, url }) => {
    fake.user.findUnique.mockClear();
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
    expect(fake.user.findUnique).not.toHaveBeenCalled();
  });

  it('🔴 唯一那条不要 Bearer 的是 `confirm`：点邮件的人手上没有会话', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/email/change/confirm',
      payload: { token: 'a'.repeat(64) },
    });
    // 不是 401 —— 401 在这里的语义是"你的会话没了"，而这个人从来没有会话。
    expect(res.statusCode).toBe(200);
    expect(fake.user.findUnique).not.toHaveBeenCalled();
  });

  it('身份一律取自令牌：请求体里写别人的 userId/email 都不生效', async () => {
    const { token } = await signIn();
    const calls = [
      { url: '/api/account/email/change/status', method: 'GET' as const },
      { url: '/api/account/email/change/cancel', method: 'POST' as const },
      { url: '/api/auth/sessions', method: 'GET' as const },
      { url: '/api/auth/sessions/revoke-all', method: 'POST' as const },
      { url: '/api/auth/logout', method: 'POST' as const },
    ];
    for (const call of calls) {
      await app.inject({
        method: call.method,
        url: call.url,
        headers: auth(token),
        payload: { userId: OTHER_ID, id: OTHER_ID, email: 'victim@example.test' },
      });
    }
    // 🔴 每一次转给核心的都是**令牌里那个人**。
    expect(emailChangeSpies.getEmailChangeStatus.mock.calls.map((c) => c[0])).toEqual([USER_ID]);
    expect(emailChangeSpies.cancelEmailChange.mock.calls.map((c) => c[0])).toEqual([USER_ID]);
    expect(fake.state.sessions.has(sessionIdOf(jtiOf(token)))).toBe(false); // 撤的是自己那一枚
  });
});

describe('🔴 J-W2a：撤销一枚 ⇒ 那一枚立刻 401，而别的枚仍然能用', () => {
  it('DELETE 那一枚之后：它自己的下一个请求被拒，另一枚照常 200', async () => {
    const a = await signIn();
    const b = await signIn();

    // 先把两枚都跑一次真请求（让认证缓存里**确实**有东西 —— 撤销必须能把它踢掉）。
    expect((await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: auth(a.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: auth(b.token) })).statusCode).toBe(200);
    // 🔴 缓存**按会话分格**（`auth-cache.ts` 的 `keyOf`），所以这里要逐枚验两格都焐热了：
    // 撤销那一枚必须扫掉**它自己那一格**，而 `invalidate(userId)` 的语义是"扫掉这个用户的全部格"。
    // 早先这一行写的是 `authCache.get(USER_ID)` —— 那是按用户分格时代的探针，换成两枚之后它只会读到 `no-jti` 那一格。
    expect(authCache.get(USER_ID, a.sessionId)).not.toBeNull();
    expect(authCache.get(USER_ID, b.sessionId)).not.toBeNull();

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${a.sessionId}`,
      headers: auth(b.token),
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ success: true });

    const afterA = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: auth(a.token) });
    expect(afterA.statusCode).toBe(401);
    expect(afterA.json().code).toBe('TOKEN_REVOKED');

    // 🔴 这一半才是这一笔的全部内容。把 `revokeSession` 换成 `revokeAllTokens`
    // 或"顺手 bump 一下计数器"，上面那条照样 401，而这一条会跟着变 401 ——
    // 那正是"退出这一台却把四台全踢下线"的形状。
    const afterB = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: auth(b.token) });
    expect(afterB.statusCode).toBe(200);
    expect(fake.state.users.get(USER_ID)!.tokenVersion).toBe(0);
  });

  it('单枚撤销**不**关掉整个账号的实时通道（那是 revoke-all 的语义）', async () => {
    const a = await signIn();
    const b = await signIn();
    await app.inject({ method: 'DELETE', url: `/api/auth/sessions/${a.sessionId}`, headers: auth(b.token) });
    expect(wsSpies.closeForUser).not.toHaveBeenCalled();
    // 🔴 另一半：那一枚自己的通道必须当场关掉。只断言"没关别人的"是挡不住"谁都没关"的 ——
    // 而那正是这一格原来的样子：删了行、扫了缓存，界面上说"已退出"，那台开着的页面继续收 op。
    expect(wsSpies.closeForSession).toHaveBeenCalledTimes(1);
    expect(wsSpies.closeForSession).toHaveBeenCalledWith(USER_ID, a.sessionId);
    expect(wsSpies.closeForClient).not.toHaveBeenCalled();
  });

  it('撤不动的那一枚**一个通道都不许关**（`unknown_session` 不是"悄悄关掉别人的"）', async () => {
    const victim = await signIn(OTHER_ID);
    const attacker = await signIn(USER_ID);
    await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${victim.sessionId}`,
      headers: auth(attacker.token),
    });
    expect(wsSpies.closeForSession).not.toHaveBeenCalled();
  });

  it('撤别人的那一枚撤不动：400 `unknown_session`，而那行还在', async () => {
    const victim = await signIn(OTHER_ID);
    const attacker = await signIn(USER_ID);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${victim.sessionId}`,
      headers: auth(attacker.token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('unknown_session');
    // 🔴 措辞与"不存在""已经撤过"**同一句** —— 撤销第二次不许泄露"它存在过"。
    expect(res.json().error).toBe('That session is not valid.');
    expect(fake.state.sessions.has(victim.sessionId)).toBe(true);
  });

  it('🔴 id 形状不合法 ⇒ 400 且**不带 where 打到库里**', async () => {
    const { token } = await signIn();
    fake.accessSession.deleteMany.mockClear();
    // 只用**不会改变路由形状**的非法值：`..` 会被路径规范化拿走，那时红的不是这一条判据。
    for (const bad of ['not-a-hash', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'a'.repeat(63) + 'g']) {
      const res = await app.inject({ method: 'DELETE', url: `/api/auth/sessions/${bad}`, headers: auth(token) });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('unknown_session');
    }
    expect(fake.accessSession.deleteMany).not.toHaveBeenCalled();
  });
});

describe('登出这一台 / 登出所有设备：两条语义必须分得开', () => {
  it('`logout` 只撤手上那一枚，另一枚不受影响，也不关实时通道', async () => {
    const a = await signIn();
    const b = await signIn();

    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth(a.token) });
    expect(res.statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: auth(a.token) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: auth(b.token) })).statusCode).toBe(200);
    expect(wsSpies.closeForUser).not.toHaveBeenCalled();
  });

  it('🔴 手上这一枚是**旧令牌**（没有 `jti`）时仍然 200：对用户来说结果一样', async () => {
    const token = legacyToken();
    fake.accessSession.deleteMany.mockClear();
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth(token) });
    // "这一枚我撤不掉"是一句对用户没有行动价值的内部事实 —— 记日志，不记界面。
    expect(res.statusCode).toBe(200);
    expect(fake.accessSession.deleteMany).not.toHaveBeenCalled();
    expect(spiedLogger.info).toHaveBeenCalled();
  });

  it('`revoke-all` ⇒ 每一枚都 401（含没有 `jti` 的旧令牌），且关掉整个账号的通道', async () => {
    const a = await signIn();
    const legacy = legacyToken();

    const res = await app.inject({ method: 'POST', url: '/api/auth/sessions/revoke-all', headers: auth(a.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, count: 1 });

    for (const token of [a.token, legacy]) {
      const after = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: auth(token) });
      expect(after.statusCode).toBe(401);
      expect(after.json().code).toBe('TOKEN_REVOKED');
    }
    // 计数器那一档是**唯一**能作废旧令牌的东西，所以这一步必须在。
    expect(fake.state.users.get(USER_ID)!.tokenVersion).toBe(1);
    expect(wsSpies.closeForUser).toHaveBeenCalledWith(USER_ID);
  });
});

describe('会话列表这张响应不许泄露凭据', () => {
  it('🔴 白名单投影：响应里没有 `jti` 明文、没有令牌、没有 IP', async () => {
    const a = await signIn();
    const res = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: auth(a.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(jtiOf(a.token));
    expect(serialized).not.toContain('eyJ');
    expect(Object.keys(body.sessions[0]).sort()).toEqual(
      ['createdAt', 'current', 'deviceName', 'lastSeenAt', 'sessionId', 'userAgent'].sort(),
    );
  });

  it('恰好一行 `current`，来自服务端验出的那一枚（不信客户端传来的标记）', async () => {
    const a = await signIn();
    await signIn();
    // 🔴 客户端把 `current` 与 `sessionId` 塞进**查询串**想冒充另一枚：
    // 路由只读 `req.user`，所以那一行仍然是服务端验出来的这一枚。
    // 否则用户会在别的设备上把"退出登录"点成撤销自己的。
    const body = (
      await app.inject({
        method: 'GET',
        url: `/api/auth/sessions?current=true&sessionId=${'f'.repeat(64)}`,
        headers: auth(a.token),
      })
    ).json();
    expect(body.sessions.filter((row: { current: boolean }) => row.current)).toHaveLength(1);
    expect(body.sessions.find((row: { sessionId: string }) => row.current).sessionId).toBe(a.sessionId);
  });

  it('旧令牌（没有 `jti`）读列表时没有一行自称 current', async () => {
    await signIn();
    const body = (
      await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: auth(legacyToken()) })
    ).json();
    expect(body.sessions.every((row: { current: boolean }) => !row.current)).toBe(true);
  });
});

describe('换绑那四条：错误码到状态码的映射只按封闭词表', () => {
  const reject = (code: string): void => {
    emailChangeSpies.requestEmailChange.mockRejectedValue(
      new EmailChangeError(code as never, `message for ${code}`),
    );
  };

  const cases: Array<[string, number]> = [
    ['invalid_change_link', 400],
    ['email_not_verified', 403],
    ['email_unchanged', 400],
    ['email_taken', 409],
    ['email_change_cooldown', 429],
  ];

  it.each(cases)('$code ⇒ HTTP %i，响应体带着同一个稳定码', async (code, status) => {
    reject(code);
    const { token } = await signIn();
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/email/change/request',
      headers: auth(token),
      payload: { newEmail: 'new@example.test' },
    });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: `message for ${code}`, code });
  });

  it('冷却那一发带 `Retry-After`（界面那句"{seconds} 秒后可以重新发起"用它，不自己数）', async () => {
    emailChangeSpies.requestEmailChange.mockRejectedValue(
      new EmailChangeError('email_change_cooldown' as never, 'cooldown', 42),
    );
    const { token } = await signIn();
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/email/change/request',
      headers: auth(token),
      payload: { newEmail: 'new@example.test' },
    });
    expect(res.headers['retry-after']).toBe('42');
  });

  it('🔴 `confirm` 的畸形 body 与无效链接**同码同句**（分开报就是给枚举留门）', async () => {
    emailChangeSpies.confirmEmailChange.mockRejectedValue(
      new EmailChangeError('invalid_change_link' as never, 'That link is not valid. Start the change again from the app.'),
    );
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/account/email/change/confirm',
      payload: { nope: 1 },
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/account/email/change/confirm',
      payload: { token: 'a'.repeat(64) },
    });
    expect(malformed.statusCode).toBe(invalid.statusCode);
    expect(malformed.json()).toEqual(invalid.json());
    // 而且畸形 body **没有**进到核心逻辑（否则它拿 undefined 去查库，就多了一条外部可控路径）。
    expect(emailChangeSpies.confirmEmailChange).toHaveBeenCalledTimes(1);
  });

  it('新地址为空 / 非法格式 ⇒ 400 校验失败，不发信', async () => {
    const { token } = await signIn();
    for (const payload of [{ newEmail: '' }, { newEmail: 'not-an-email' }, {}]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/account/email/change/request',
        headers: auth(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(emailChangeSpies.requestEmailChange).not.toHaveBeenCalled();
  });

  it('非核心错误照样抛成 500（不许被 `catch` 吞成"链接无效"）', async () => {
    emailChangeSpies.requestEmailChange.mockRejectedValue(new Error('database is down'));
    const { token } = await signIn();
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/email/change/request',
      headers: auth(token),
      payload: { newEmail: 'new@example.test' },
    });
    expect(res.statusCode).toBe(500);
  });
});

describe('接线（生产入口真的注册了这两族路由 —— "路由写好了没人挂"不算做完）', () => {
  // 🔴 变异靶：删掉 `server.ts` 里 `register(accountSecurityRoutes, …)` 那一行 ⇒ 本条必须红。
  // 补这条之前**没有任何一层**守着它：上面每一组用例都是自己起一个 Fastify 再
  // `app.register(accountSecurityRoutes)`，所以生产入口少挂一行时单测照样全绿，
  // 而线上那几条路由会直接 404（症状是"界面上点了没反应"，服务端零日志）。
  // 集成那份 `email-change-and-sessions.integration.spec.ts` 真能抓到，但它没有
  // `DATABASE_URL` 时整组 `describe.skip`（见那文件头），所以不能当这一格的守卫。
  const serverSource = readFileSync(resolve(process.cwd(), 'src/server.ts'), 'utf8');

  for (const [name, file, why] of [
    ['accountSecurityRoutes', 'account-security.routes', '换绑邮箱 + 逐枚会话撤销'],
    ['accountProfileRoutes', 'account-profile.routes', '账号资料（含改登录密码）'],
  ] as const) {
    it(`${name}：import 与注册都在生产入口里（${why}）`, () => {
      expect(serverSource, `${name} 没被 import`).toContain(`from './account/${file}'`);
      // 连 prefix 一起钉：路由自己的路径是 `/account/...`，少了 `/api` 前缀就等于换了一条对外契约。
      expect(serverSource, `${name} 没注册，或注册的 prefix 不是 /api`).toContain(
        `register(${name}, { prefix: '/api' })`,
      );
    });
  }
});
