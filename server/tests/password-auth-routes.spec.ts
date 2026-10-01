import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 邮箱 + 口令两个端点的**HTTP 契约**（`src/api.ts`）—— 计划 W1 判据。
 *
 * `password-auth-flow.spec.ts` 钉的是"判定对不对"，这一组钉的是"判定怎么变成响应"：
 *
 * 1. 🔴 **五个错误码各自的状态码**（401 / 403 / 400 / 429 / 503），以及两处
 *    `Retry-After`。选错状态码不是风格问题：429 说"你慢点"、503 说"我这儿满了"，
 *    客户端的退避策略按它决定惩罚谁。
 * 2. **锁定的句子不许泄露内部容量语义** —— `PasswordBackendBusy.message` 描述的是
 *    哪个闸门满了，直接透传等于把内部结构说给攻击者听。
 * 3. 🔴 **`passwordHash` 不许出现在任何一个响应里**（J12），包括错误响应。
 * 4. 「同意」的时间戳只在**真的收到** `termsAccepted: true` 时才写（`auth.ts` 那条
 *    "绝不发明一次同意"的纪律，注册这条路不能开后门）。
 *
 * 传输上限（`MAX_PASSWORD_CODE_POINTS * 2`）与策略上限**两层都以码点计**（实测 zod 4.6.5
 * 的 `.max()` 数的是码点，不是 UTF-16 单元）。传输线刻意画在策略线**之外**，
 * 这样"口令太长"那句才有机会带着 `policyCode` 出来 —— 这里用 emoji 把两层的接缝钉住。
 *
 * 哈希层换成假实现（真实 Argon2id 一次 ~300 ms），闸门保持真实现。
 */

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));

const hashSpies = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  needsRehash: vi.fn(),
  dummyVerify: vi.fn(),
}));

const policySpies = vi.hoisted(() => ({ checkNewPassword: vi.fn() }));

const authSpies = vi.hoisted(() => ({ registerWithMagicLink: vi.fn() }));

const spiedLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../src/db', () => ({ prisma: mocks }));
vi.mock('../src/logger', () => ({ Logger: spiedLogger }));
vi.mock('../src/password/hash', () => hashSpies);
vi.mock('../src/password/policy', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...policySpies };
});
vi.mock('../src/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...authSpies };
});

import { apiRoutes, passwordAuthResponseOf } from '../src/api';
import { PasswordAuthError, PASSWORD_ACCOUNT_LOCKED_MESSAGE } from '../src/password/service';
import {
  PasswordBackendBusy,
  hashGateStats,
  resetHashGateForTests,
  withHashSlot,
} from '../src/password/concurrency';
import { MAX_PASSWORD_CODE_POINTS } from '../src/password/policy';

const EMAIL = 'vaulted@example.com';
const PASSWORD = 'correct horse battery staple';
const PHC = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$Q2xpZW50U2lnbmF0dXJlT2ZUaGVUZXN0';

// 每个用例自己 register（`requireTermsConsent` 是要验的变量），所以这里在
// `afterEach` 之前可能还没建 —— 关闭时要判空。
let app: FastifyInstance;

const readyRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 7,
  email: EMAIL,
  locale: 'zh-CN',
  passwordHash: PHC,
  isVerified: 1,
  tokenVersion: 3,
  failedLoginAttempts: 0,
  lockedUntil: null,
  ...overrides,
});

const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url: `/api${url}`, payload: payload as Record<string, unknown> });

/** 占满哈希闸门（槽位 + 整条队列），让下一次哈希**当场**被拒。返回放行函数。 */
const saturateHashGate = (): (() => void) => {
  const releases: Array<() => void> = [];
  const blocker = (): Promise<void> =>
    new Promise<void>((resolve) => {
      releases.push(resolve);
    });
  const { slots } = hashGateStats();
  // 队列上限是 32（`concurrency.ts` 的 `MAX_WAITING`）：槽满 + 队满 ⇒ 下一个当场 503。
  for (let i = 0; i < slots + 32; i += 1) {
    void withHashSlot(blocker).catch(() => undefined);
  }
  return () => {
    releases.forEach((done) => done());
    resetHashGateForTests();
  };
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetHashGateForTests();
  mocks.user.findUnique.mockResolvedValue(null);
  mocks.user.update.mockResolvedValue(readyRow());
  mocks.user.updateMany.mockResolvedValue({ count: 1 });
  hashSpies.verifyPassword.mockResolvedValue(true);
  hashSpies.needsRehash.mockReturnValue(false);
  hashSpies.dummyVerify.mockResolvedValue(undefined);
  hashSpies.hashPassword.mockResolvedValue(PHC);
  policySpies.checkNewPassword.mockImplementation(async (raw: string) => ({
    ok: true,
    normalized: raw,
  }));
  authSpies.registerWithMagicLink.mockResolvedValue({
    message: 'Registration successful. Please check your email to verify your account.',
  });
});

afterEach(async () => {
  // 每个用例自己 register（`requireTermsConsent` 是要验的变量），所以这里可能是空的。
  if (app) await app.close();
});

describe('passwordAuthResponseOf：五个码 → 状态码的唯一映射表', () => {
  it('不经过 Fastify 也能钉住（这个函数刻意不碰 reply）', () => {
    expect(
      passwordAuthResponseOf(new PasswordAuthError('invalid_credentials', 'Invalid credentials')),
    ).toEqual({ status: 401, body: { error: 'Invalid credentials', code: 'invalid_credentials' } });

    expect(
      passwordAuthResponseOf(
        new PasswordAuthError('email_not_verified', 'Email not verified. Check your inbox for the verification link.'),
      ),
    ).toEqual({
      status: 403,
      body: {
        error: 'Email not verified. Check your inbox for the verification link.',
        code: 'email_not_verified',
      },
    });

    expect(
      passwordAuthResponseOf(
        new PasswordAuthError('password_policy_violation', 'That password does not meet the requirements.', undefined, 'too_short'),
      ),
    ).toEqual({
      status: 400,
      body: {
        error: 'That password does not meet the requirements.',
        code: 'password_policy_violation',
        policyCode: 'too_short',
      },
    });
  });

  it('🔴 锁定是 **429 + Retry-After**（不是 423：WebDAV 语义，代理与客户端库普遍不认识）', () => {
    const res = passwordAuthResponseOf(
      new PasswordAuthError('account_locked', PASSWORD_ACCOUNT_LOCKED_MESSAGE, 120),
    );
    expect(res.status).toBe(429);
    expect(res.retryAfterSeconds).toBe(120);
    expect(res.body.error).toBe(PASSWORD_ACCOUNT_LOCKED_MESSAGE);
  });

  it('锁定缺 retryAfterSeconds 时兜底为整个锁定时长（不写"0 秒后再来"）', () => {
    const res = passwordAuthResponseOf(new PasswordAuthError('account_locked', 'locked'));
    expect(res.retryAfterSeconds).toBe(900);
  });

  it('🔴 过载是 **503 而不是 429**：闸门满是我们的容量问题，报 429 等于惩罚无辜用户', () => {
    const res = passwordAuthResponseOf(new PasswordAuthError('password_backend_busy', 'busy'));
    expect(res.status).toBe(503);
    expect(res.retryAfterSeconds).toBe(4);
    // 内部那句"哪个闸门满了、排了多少"不许透传。
    expect(res.body.error).not.toMatch(/saturated|slot|queue/i);
  });
});

describe('POST /register/email-password', () => {
  it('成功：201 + 那句中性的"去看收件箱"，**不发会话**', async () => {
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    const res = await post('/register/email-password', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(201);
    expect(res.json().message).toMatch(/check your email/i);
    expect(res.body).not.toContain('token');
  });

  it('🔴 没有真的收到 termsAccepted 就不写同意时间（"绝不发明一次同意"）', async () => {
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    await post('/register/email-password', { email: EMAIL, password: PASSWORD });
    const args = authSpies.registerWithMagicLink.mock.calls[0] as unknown as Array<
      string | number | undefined | Record<string, unknown>
    >;
    expect(args[1]).toBeUndefined();

    await post('/register/email-password', { email: EMAIL, password: PASSWORD, termsAccepted: true });
    const withConsent = authSpies.registerWithMagicLink.mock.calls[1] as unknown as Array<
      string | number | undefined | Record<string, unknown>
    >;
    expect(typeof withConsent[1]).toBe('number');
  });

  it('要求同意的实例上，缺勾选框是校验失败（400），不是"注册成功但没记"', async () => {
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: true });
    const res = await post('/register/email-password', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().error)).toMatch(/Validation failed/);
    expect(authSpies.registerWithMagicLink).not.toHaveBeenCalled();
  });

  it('策略不过 ⇒ 400 + code + policyCode，且**没有**为它哈希一次', async () => {
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    policySpies.checkNewPassword.mockResolvedValue({ ok: false, code: 'too_common' });

    const res = await post('/register/email-password', { email: EMAIL, password: 'password' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'That password does not meet the requirements.',
      code: 'password_policy_violation',
      policyCode: 'too_common',
    });
    expect(hashSpies.hashPassword).not.toHaveBeenCalled();
  });

  it('🔴 传输线在策略线之外：256 个码点的口令**到达策略层**，而不是被 zod 抢先 400', async () => {
    // 实测 zod 4.6.5 的 `.max()` 数的是码点（不是 UTF-16 单元），所以这条不是单位换算，
    // 而是"用户能看见的那句归策略层"：zod 的 `Validation failed` 没有 `code`，
    // 客户端按词条表翻不出"口令太长"这句中文。
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });

    const atLimit = '\u{1F600}'.repeat(MAX_PASSWORD_CODE_POINTS);
    expect(atLimit.length).toBe(MAX_PASSWORD_CODE_POINTS * 2); // 若哪天按单元算，这里先露馅
    const ok = await post('/register/email-password', { email: EMAIL, password: atLimit });
    expect(ok.statusCode).toBe(201);
    expect(policySpies.checkNewPassword).toHaveBeenCalledWith(atLimit);
  });

  it('超过传输上限的体积攻击由 zod 挡在门外（不会为一个 10 MB 字符串去哈希）', async () => {
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });

    const oversized = 'x'.repeat(MAX_PASSWORD_CODE_POINTS * 2 + 1);
    const rejected = await post('/register/email-password', { email: EMAIL, password: oversized });
    expect(rejected.statusCode).toBe(400);
    expect(String(rejected.json().error)).toMatch(/Validation failed/);
    expect(policySpies.checkNewPassword).not.toHaveBeenCalled();
  });

  it('口令太长 ⇒ 400 带 policyCode=too_long（客户端据此取那句中文）', async () => {
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    policySpies.checkNewPassword.mockResolvedValue({ ok: false, code: 'too_long' });

    const res = await post('/register/email-password', {
      email: EMAIL,
      password: 'x'.repeat(MAX_PASSWORD_CODE_POINTS + 1),
    });
    expect(res.json()).toEqual({
      error: 'That password does not meet the requirements.',
      code: 'password_policy_violation',
      policyCode: 'too_long',
    });
  });

  it('邮箱已被占用也是那句中性消息（这个端点不是邮箱存在性预言机）', async () => {
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    authSpies.registerWithMagicLink.mockResolvedValue({
      message: 'Registration successful. Please check your email to verify your account.',
    });
    const res = await post('/register/email-password', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(201);
    expect(res.json().message).toMatch(/check your email/i);
  });
});

describe('POST /login/email-password', () => {
  const makeApp = async (): Promise<void> => {
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
  };

  it('成功：200 + { token, user }，原始响应体里没有 passwordHash', async () => {
    await makeApp();
    mocks.user.findUnique.mockResolvedValue(readyRow());
    const res = await post('/login/email-password', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; user: Record<string, unknown> };
    expect(typeof body.token).toBe('string');
    expect(Object.keys(body.user).sort()).toEqual(['email', 'id', 'locale']);
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain(PHC);
    expect(res.body).not.toContain('tokenVersion');
  });

  it('🔴 口令错 / 账号不存在 / 没设口令：同码同句同状态，日志也同级别', async () => {
    await makeApp();
    hashSpies.verifyPassword.mockResolvedValue(false);

    mocks.user.findUnique.mockResolvedValue(readyRow());
    const wrongPassword = await post('/login/email-password', { email: EMAIL, password: PASSWORD });

    mocks.user.findUnique.mockResolvedValue(null);
    const unknownEmail = await post('/login/email-password', {
      email: 'nobody@example.com',
      password: PASSWORD,
    });

    mocks.user.findUnique.mockResolvedValue(readyRow({ passwordHash: null }));
    const noPasswordSet = await post('/login/email-password', { email: EMAIL, password: PASSWORD });

    for (const res of [wrongPassword, unknownEmail, noPasswordSet]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Invalid credentials', code: 'invalid_credentials' });
    }
    // 分级成 error/info 的话，日志本身就成了可读出来的信号。
    const loginWarns = spiedLogger.warn.mock.calls.filter((c) =>
      /Password login failed/.test(String(c[0])),
    );
    expect(loginWarns).toHaveLength(3);
    expect(spiedLogger.error).not.toHaveBeenCalled();
  });

  it('未验证邮箱 ⇒ 403（口令已验对，"重来一次"是错的暗示）', async () => {
    await makeApp();
    mocks.user.findUnique.mockResolvedValue(readyRow({ isVerified: 0 }));
    const res = await post('/login/email-password', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('email_not_verified');
  });

  it('锁定 ⇒ 429 + Retry-After 头', async () => {
    await makeApp();
    mocks.user.findUnique.mockResolvedValue(
      readyRow({ failedLoginAttempts: 5, lockedUntil: BigInt(Date.now() + 300_000) }),
    );
    const res = await post('/login/email-password', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(290);
    expect(res.json().code).toBe('account_locked');
  });

  it('🔴 闸门满 ⇒ 503 + Retry-After，且用的是路由自己那句（内部容量语义不外泄）', async () => {
    await makeApp();
    mocks.user.findUnique.mockResolvedValue(null);
    const free = saturateHashGate();
    try {
      const res = await post('/login/email-password', { email: EMAIL, password: PASSWORD });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('password_backend_busy');
      expect(String(res.json().error)).toMatch(/too many sign-in requests/i);
      expect(String(res.json().error)).not.toMatch(/saturated|slot/i);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      free();
    }
  });

  it('空 body / 缺字段是校验失败，不是 500', async () => {
    await makeApp();
    expect((await post('/login/email-password', { email: EMAIL })).statusCode).toBe(400);
    expect((await post('/login/email-password', {})).statusCode).toBe(400);
    expect((await post('/login/email-password', { email: 'not-an-email', password: PASSWORD })).statusCode).toBe(400);
  });
});
