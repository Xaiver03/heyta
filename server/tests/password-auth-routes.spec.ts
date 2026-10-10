import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';

/**
 * 邮箱 + 口令的端点的**HTTP 契约**（`src/api.ts`）—— 计划 W1 与 W3 判据。
 *
 * `password-auth-flow.spec.ts` / `password-recovery.spec.ts` 钉的是"判定对不对"，
 * 这一组钉的是"判定怎么变成响应"：
 *
 * 1. 🔴 **八个错误码各自的状态码**（401 / 403 / 400 / 429 / 503），以及两处
 *    `Retry-After`。选错状态码不是风格问题：429 说"你慢点"、503 说"我这儿满了"，
 *    客户端的退避策略按它决定惩罚谁。
 * 2. **锁定的句子不许泄露内部容量语义** —— `PasswordBackendBusy.message` 描述的是
 *    哪个闸门满了，直接透传等于把内部结构说给攻击者听。
 * 3. 🔴 **`passwordHash` 不许出现在任何一个响应里**（J12），包括错误响应。
 * 4. 「同意」的时间戳只在**真的收到** `termsAccepted: true` 时才写（`auth.ts` 那条
 *    "绝不发明一次同意"的纪律，注册这条路不能开后门）。
 * 5. 🔴 W3 那三条**在 HTTP 层独有的**两件事：`/forgot` 连**状态码**都不许随账号
 *    存在性变化（文案中性、状态码会漏，是同一件事的另一半）；`/password/change`
 *    的 `preHandler` 真的挂上了（没挂的症状是拿不到身份时 500，而不是 401）。
 * 6. 🔴 `/password/set` 与 `/password/change` 是**两条协议**，不是同一条的两种写法：
 *    前者不发会话、**不 bump `tokenVersion`**、写库是**条件写**（并发只许一个赢）。
 *    三样各自对应一种真实伤害，见那个 describe 的表。
 *
 * 传输上限（`MAX_PASSWORD_CODE_POINTS * 2`）与策略上限**两层都以码点计**（实测 zod 4.6.5
 * 的 `.max()` 数的是码点，不是 UTF-16 单元）。传输线刻意画在策略线**之外**，
 * 这样"口令太长"那句才有机会带着 `policyCode` 出来 —— 这里用 emoji 把两层的接缝钉住。
 *
 * 哈希层换成假实现（真实 Argon2id 一次 ~300 ms），闸门保持真实现。
 */

// `../src/auth` 走 `importOriginal` 拿真实现（下面要用真 `issueSession` 签一枚
// 能解开的会话），而它在**模块顶层**读 `JWT_SECRET` ⇒ 必须在 import 之前就有值。
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

const mocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    /** ADR-0063：`issueSession()` 签名前回读 `email` / `tokenVersion`。 */
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  /** 一枚令牌 = `access_sessions` 里的一行（`recordSession`：先插行、后签名）。 */
  accessSession: { create: vi.fn(), deleteMany: vi.fn() },
}));

const hashSpies = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  needsRehash: vi.fn(),
  dummyVerify: vi.fn(),
}));

const policySpies = vi.hoisted(() => ({ checkNewPassword: vi.fn() }));

const authSpies = vi.hoisted(() => ({ registerWithMagicLink: vi.fn() }));

/**
 * 邮件层只 spy 这三封（其余导出保留真实现）。`/password/forgot` 会**真的**去发信，
 * 而这一组要钉的是"响应长什么样"，不是 SMTP —— 让它打真端点会让这 20 条用例
 * 依赖网络与凭据（没凭据的机器上永远红，那等于没有测试）。
 *
 * 🔴 第三封（ADR-0063 §2.6「新增认证器」）必须一起 spy：`/password/set` 成功时**真的会发**。
 * 不 spy 它，这一组就会在测试机上跑出一封真邮件或一次真 SMTP 连接，
 * 而"这封信到底发没发"又变成没人在看的断言。
 */
const emailSpies = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
  sendPasswordChangedEmail: vi.fn(),
  sendAuthenticatorAddedEmail: vi.fn(),
}));

const spiedLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

/**
 * 实时通道的间谍。它**本身是一条 HTTP 半边的判据**（见下面改密/重置那两条用例）：
 * 通道只在 upgrade 时鉴权，所以只 bump 计数器时，旧设备那个已经开着的页面继续收 op 通知。
 * 不 mock 它则会去碰真的 `getWsConnectionService()` 单例（跨用例共享的进程内状态）。
 */
const wsSpies = vi.hoisted(() => ({ closeForUser: vi.fn() }));

vi.mock('../src/db', () => ({ prisma: mocks }));
vi.mock('../src/logger', () => ({ Logger: spiedLogger }));
vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => wsSpies,
}));
vi.mock('../src/password/hash', () => hashSpies);
vi.mock('../src/password/policy', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...policySpies };
});
vi.mock('../src/email', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...emailSpies };
});
vi.mock('../src/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...authSpies };
});

import { apiRoutes, passwordAuthResponseOf } from '../src/api';
import { authCache } from '../src/auth-cache';
import {
  PASSWORD_ACCOUNT_LOCKED_MESSAGE,
  PASSWORD_ALREADY_SET_MESSAGE,
  PASSWORD_INVALID_RESET_LINK_MESSAGE,
  PASSWORD_SET_SUCCESS_MESSAGE,
  PasswordAuthError,
} from '../src/password/service';
import {
  PASSWORD_NOT_SET_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_SUCCESS_MESSAGE,
} from '../src/password/recovery';
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

/**
 * 起一个只挂 `apiRoutes` 的实例（`requireTermsConsent: false` —— 这一组不关心勾选框）。
 * 模块级一份，是因为 W3 那三个 describe 都要用；登录那个 describe 里另有一个局部的
 * `makeApp`（它带的是那个组的默认值），不共用是为了不互相牵连。
 */
const boot = async (): Promise<void> => {
  app = Fastify();
  await app.register(apiRoutes, { prefix: '/api' });
};

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
  // `../src/auth` 是真实现 ⇒ `verifyToken` 也会用同一个 `findUnique` 查身份。
  // 这里的默认值是"查不到人"，所以**未挂 token 的那几条**不会被缓存影响；
  // 需要过认证的用例自己换成 `mockImplementation` 按 `select` 分流。
  mocks.user.findFirst.mockResolvedValue(null);
  mocks.user.update.mockResolvedValue(readyRow());
  mocks.user.updateMany.mockResolvedValue({ count: 1 });
  // 🔴 ADR-0063：`issueSession` 在签名**之前**回读账号行（`select: { email, tokenVersion }`），
  // 所以每一次换会话都会多打这一格。默认值就是上面 `readyRow()` 那一行（id 7 / tokenVersion 3）；
  // 需要别的版本的用例（改密那一条）自己覆盖 —— 但它必须等于**那次 UPDATE 写回之后**的那一格，
  // 否则"令牌带的是 bump 后的版本"那条判据就变成夹具与实现各说一套。
  mocks.user.findUniqueOrThrow.mockResolvedValue({ email: EMAIL, tokenVersion: 3 });
  // 一枚令牌 = 一行 `access_sessions`（先插行、后签名）。`deleteMany` 是"全设备登出"删那些行，
  // 返回值必须带 `count` —— `revokeAllSessions` 读它。
  mocks.accessSession.create.mockResolvedValue({});
  mocks.accessSession.deleteMany.mockResolvedValue({ count: 0 });
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
  emailSpies.sendPasswordResetEmail.mockResolvedValue(true);
  emailSpies.sendPasswordChangedEmail.mockResolvedValue(true);
  emailSpies.sendAuthenticatorAddedEmail.mockResolvedValue(true);
});

afterEach(async () => {
  // 每个用例自己 register（`requireTermsConsent` 是要验的变量），所以这里可能是空的。
  if (app) await app.close();
});

describe('passwordAuthResponseOf：七个码 → 状态码的唯一映射表', () => {
  it('不经过 Fastify 也能钉住（这个函数刻意不碰 reply）', () => {
    expect(
      passwordAuthResponseOf(new PasswordAuthError('invalid_credentials', 'Invalid credentials')),
    ).toEqual({ status: 401, body: { code: 'invalid_credentials', message: 'Invalid credentials' } });

    expect(
      passwordAuthResponseOf(
        new PasswordAuthError('email_not_verified', 'Email not verified. Check your inbox for the verification link.'),
      ),
    ).toEqual({
      status: 403,
      body: {
        code: 'email_not_verified',
        message: 'Email not verified. Check your inbox for the verification link.',
      },
    });

    expect(
      passwordAuthResponseOf(
        new PasswordAuthError('password_policy_violation', 'That password does not meet the requirements.', undefined, 'too_short'),
      ),
    ).toEqual({
      status: 400,
      body: {
        code: 'password_policy_violation',
        message: 'That password does not meet the requirements.',
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
    expect(res.body.message).toBe(PASSWORD_ACCOUNT_LOCKED_MESSAGE);
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
    expect(res.body.message).not.toMatch(/saturated|slot|queue/i);
  });

  /**
   * 🔴 这两个新码是 W3 加进来的，而 `passwordAuthResponseOf` 的 switch **没有 default** ——
   * 所以"加一个错误码却忘了给它状态码"在**编译期**就过不去（这是刻意选的形状）。
   * 但编译过了不等于**选对了**：400/401/403 三者都能编译，客户端的行为完全不同，
   * 所以这两个决定仍然要在这里逐字钉住。
   */
  it('🔴 两个 400：`invalid_reset_link` 与 `no_password_set` 同状态、不同 code 与句子', () => {
    const link = passwordAuthResponseOf(
      new PasswordAuthError('invalid_reset_link', PASSWORD_INVALID_RESET_LINK_MESSAGE),
    );
    expect(link).toEqual({
      status: 400,
      body: { code: 'invalid_reset_link', message: PASSWORD_INVALID_RESET_LINK_MESSAGE },
    });

    const unset = passwordAuthResponseOf(
      new PasswordAuthError('no_password_set', PASSWORD_NOT_SET_MESSAGE),
    );
    expect(unset).toEqual({
      status: 400,
      body: { code: 'no_password_set', message: PASSWORD_NOT_SET_MESSAGE },
    });

    // 界面靠 `code` 换 CTA（一句导向「忘记密码」，一句导向"回去重新点链接"），
    // 所以这两句**不许相同** —— 相同就等于把两个 code 合并成一个，白加。
    expect(unset.body.message).not.toBe(link.body.message);
  });

  it('`no_password_set` 不许是 401：他不是"没证明你是谁"，他已经证明了（带着有效会话）', () => {
    // 401 会让通用 HTTP 层触发"重新登录"，而重新登录**恰恰**是他已经做到的事。
    expect(passwordAuthResponseOf(new PasswordAuthError('no_password_set', 'x')).status).toBe(400);
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
    expect(String(res.json().message)).toMatch(/Validation failed/);
    expect(authSpies.registerWithMagicLink).not.toHaveBeenCalled();
  });

  it('策略不过 ⇒ 400 + code + policyCode，且**没有**为它哈希一次', async () => {
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    policySpies.checkNewPassword.mockResolvedValue({ ok: false, code: 'too_common' });

    const res = await post('/register/email-password', { email: EMAIL, password: 'password' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'password_policy_violation',
      message: 'That password does not meet the requirements.',
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
    expect(String(rejected.json().message)).toMatch(/Validation failed/);
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
      code: 'password_policy_violation',
      message: 'That password does not meet the requirements.',
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

  it('🔴 会话行带上请求的 `user-agent`（工单 W10：「登录设备」列表里唯一认得出来源的一列）', async () => {
    await makeApp();
    mocks.user.findUnique.mockResolvedValue(readyRow());
    const res = await app.inject({
      method: 'POST',
      url: '/api/login/email-password',
      headers: { 'user-agent': 'HeytaTestAgent/9.9' },
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.accessSession.create).toHaveBeenCalledTimes(1);
    const row = (mocks.accessSession.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(row.userAgent).toBe('HeytaTestAgent/9.9');

    // 🔴 另一半同样要紧：**没带** UA 时那一格必须是 `null`，不许替用户编一个
    // "未知设备 / 浏览器" —— 那列是给人用来认设备的，编出来的名字会让人登错一台。
    mocks.accessSession.create.mockClear();
    const bare = await post('/login/email-password', { email: EMAIL, password: PASSWORD });
    expect(bare.statusCode).toBe(200);
    const bareRow = (mocks.accessSession.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(bareRow.deviceName).toBeNull();
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
      expect(res.json()).toEqual({ code: 'invalid_credentials', message: 'Invalid credentials' });
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
      expect(String(res.json().message)).toMatch(/too many sign-in requests/i);
      expect(String(res.json().message)).not.toMatch(/saturated|slot/i);
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

describe('POST /password/forgot：状态码也是通道', () => {
  /**
   * 服务层的 `password-recovery.spec.ts` 已经钉过"三种情况同一句话"。
   * 这一组只加**路由独有**的两条：兜底分支的状态码，以及 zod 那一层不能变成新通道。
   */
  const forgot = (payload: unknown) => post('/password/forgot', payload);

  it('🔴 兜底分支不许用 500：这条请求**含身份**，状态码分成两堆就是预言机', async () => {
    await boot();
    mocks.user.findUnique.mockResolvedValue(null);
    const ok = await forgot({ email: EMAIL });

    // 让库里那一次查询抛错（超长邮箱、并发、库抖都会走到这里，攻击者只要制造一次失败）。
    // `localeForEmail` 与 `requestPasswordReset` 都走 `findUnique`，所以谁先抛不重要 ——
    // 要钉的是**抛了之后**响应长什么样。
    mocks.user.findUnique.mockRejectedValueOnce(new Error('db down'));
    const failed = await forgot({ email: EMAIL });

    // 🔴 两次的状态码与响应体**逐字相同**。少一半都不算：文案对、状态码 500，
    // 用 `curl -o /dev/null -w '%{http_code}'` 就能把它读回来。
    expect(failed.statusCode).toBe(ok.statusCode);
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual(ok.json());
    expect(failed.json()).toEqual({ message: PASSWORD_RESET_REQUEST_MESSAGE });
    // 内部那句错不许出现在响应里。
    expect(failed.body).not.toMatch(/db down/i);
  });

  it('🔴 "有口令的账号"与"没这个账号"在 HTTP 层也逐字相同（含写库次数之外的东西）', async () => {
    await boot();
    mocks.user.findUnique.mockResolvedValue(readyRow());
    const exists = await forgot({ email: EMAIL });
    mocks.user.findUnique.mockResolvedValue(null);
    const missing = await forgot({ email: 'nobody@example.com' });

    expect(exists.statusCode).toBe(200);
    expect(missing.statusCode).toBe(200);
    expect(exists.json()).toEqual(missing.json());
    expect(exists.json()).toEqual({ message: PASSWORD_RESET_REQUEST_MESSAGE });
  });

  it('邮箱格式不对是 400 校验失败，且**一次写库都不发生**（校验层不许变成第二条路）', async () => {
    await boot();
    expect((await forgot({ email: 'not-an-email' })).statusCode).toBe(400);
    expect((await forgot({})).statusCode).toBe(400);
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
    expect(emailSpies.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe('POST /password/reset：成功不发会话（J14 的 HTTP 半边）', () => {
  const liveLinkRow = (): Record<string, unknown> => ({
    id: 7,
    email: EMAIL,
    resetPasswordTokenExpiresAt: BigInt(Date.now() + 60_000),
  });

  it('🔴 成功：200 且响应体**只有**那句"去登录" —— 多一个 key 就是发了会话', async () => {
    await boot();
    mocks.user.findFirst.mockResolvedValue(liveLinkRow());
    const res = await post('/password/reset', { token: 'b'.repeat(64), password: PASSWORD });
    expect(res.statusCode).toBe(200);
    // `toEqual` 是逐字比较：`{ token, user, message }` 这种"顺手签一枚"会直接红。
    expect(res.json()).toEqual({ message: PASSWORD_RESET_SUCCESS_MESSAGE });
    expect(res.body).not.toContain('token');
    // 🔴 J13 的 HTTP 半边：这条路必须真的把实时通道关掉（计数器只管得住下一次请求）。
    expect(wsSpies.closeForUser).toHaveBeenCalledWith(7);
  });

  it('查不到这枚令牌 ⇒ 400 + code=invalid_reset_link（不是 401：不是"你是谁"的问题）', async () => {
    await boot();
    mocks.user.findFirst.mockResolvedValue(null);
    const res = await post('/password/reset', { token: 'a'.repeat(64), password: PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'invalid_reset_link',
      message: PASSWORD_INVALID_RESET_LINK_MESSAGE,
    });
  });

  it('缺 token / 口令为空是 400 校验失败，不进服务层（不烧一次哈希）', async () => {
    await boot();
    expect((await post('/password/reset', { password: PASSWORD })).statusCode).toBe(400);
    expect((await post('/password/reset', { token: '', password: PASSWORD })).statusCode).toBe(400);
    expect((await post('/password/reset', { token: 'a'.repeat(64) })).statusCode).toBe(400);
    expect(mocks.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST /password/change：preHandler 真的挂上了（J13 的 HTTP 半边）', () => {
  /**
   * 这个 describe 钉的是**路由形状**，不是改密逻辑（后者在 `password-recovery.spec.ts`）：
   * 少写 `preHandler: authenticate` 的话，症状不是"报错"，而是 `getAuthUser(req)`
   * 拿不到身份 ⇒ 500，或者更糟：从 body 里取 userId，变成一条"给任意账号改口令"的路。
   */
  const bearerFor = (tokenVersion: number): string =>
    `Bearer ${jwt.sign(
      { userId: 7, email: EMAIL, tokenVersion },
      process.env.JWT_SECRET as string,
      { expiresIn: '1h' },
    )}`;

  /**
   * 按 `select` 分流：`verifyToken` 查的是身份那三格（`isVerified` / `tokenVersion`），
   * `changePassword` 查的是口令那几格。两次都是同一个 `findUnique` mock，
   * 所以这里靠"有没有要 `passwordHash`"来分 —— 而不是靠调用顺序（顺序会变，
   * 一旦路由多插一次查询，按顺序写的断言就会指错行）。
   */
  const routeFindUnique = (account: Record<string, unknown>): void => {
    mocks.user.findUnique.mockImplementation(async (args: unknown) => {
      const select = (args as { select?: Record<string, unknown> })?.select ?? {};
      return 'passwordHash' in select ? account : { id: 7, tokenVersion: 3, isVerified: 1 };
    });
  };

  it('🔴 没有 Authorization ⇒ 401，且**一次哈希都没跑**（死在闸门外，不是死在处理器里）', async () => {
    await boot();
    const res = await post('/password/change', {
      currentPassword: 'old one',
      newPassword: PASSWORD,
    });
    expect(res.statusCode).toBe(401);
    // 这两条是关键：如果 `preHandler` 没挂，请求会进到处理器，
    // 要么拿不到身份 500，要么去哈希 —— 而 401 + 零哈希只能是闸门外挡掉的。
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();
    expect(hashSpies.dummyVerify).not.toHaveBeenCalled();
    expect(mocks.user.update).not.toHaveBeenCalled();
  });

  it('带着有效会话 ⇒ 200 + { token, user }（与登录同形），token 里是 bump 后的版本', async () => {
    await boot();
    // `verifyToken` 与 `changePassword` 走的是**同一个** `findUnique`（都按 id 查），
    // 所以必须按 `select` 分流，不能让两次都返回同一行。
    routeFindUnique(readyRow({ isVerified: 1, tokenVersion: 3 }));
    // 写库回来的版本要**大于**令牌里那枚：这枚新会话才不会被自己刚做的 bump 作废。
    mocks.user.update.mockResolvedValue({ tokenVersion: 4 });
    // 🔴 回读那一格必须**等于上面这次 UPDATE 写回的值**（真库里是同一次提交后的同一行，
    // 而 `issueSession` 读的就是它）。写成 3 会让下面那条 `tokenVersion: 4` 的判据
    // 变成"实现得从调用方传进来的值里拿"—— 而那正是 ADR-0063 拿掉的那条通道。
    mocks.user.findUniqueOrThrow.mockResolvedValue({ email: EMAIL, tokenVersion: 4 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/password/change',
      headers: { authorization: bearerFor(3) },
      payload: { currentPassword: 'old one', newPassword: PASSWORD },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { token: string; user: Record<string, unknown> };
    expect(body.user).toEqual({ id: 7, email: EMAIL, locale: 'zh-CN' });
    expect(body.user).not.toHaveProperty('passwordHash');
    const claims = jwt.verify(body.token, process.env.JWT_SECRET as string, {
      algorithms: ['HS256'],
    }) as { userId: number; tokenVersion: number };
    expect(claims).toMatchObject({ userId: 7, tokenVersion: 4 });
    // 🔴 J13 的 HTTP 半边（改密这一条）：其余设备的实时通道当场关掉。
    expect(wsSpies.closeForUser).toHaveBeenCalledWith(7);
  });

  it('🔴 换发的那枚新会话也带上 UA（工单 W10：这条路以前签完就把来源丢了）', async () => {
    await boot();
    routeFindUnique(readyRow({ isVerified: 1, tokenVersion: 3 }));
    mocks.user.update.mockResolvedValue({ tokenVersion: 4 });
    mocks.user.findUniqueOrThrow.mockResolvedValue({ email: EMAIL, tokenVersion: 4 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/password/change',
      headers: { authorization: bearerFor(3), 'user-agent': 'HeytaChangeAgent/1.0' },
      payload: { currentPassword: 'old one', newPassword: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.accessSession.create).toHaveBeenCalledTimes(1);
    const row = (mocks.accessSession.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(row.userAgent).toBe('HeytaChangeAgent/1.0');
  });

  it('🔴 账号根本没有口令 ⇒ 400 + code=no_password_set，句子导向「忘记密码」', async () => {
    await boot();
    routeFindUnique(readyRow({ passwordHash: null }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/password/change',
      headers: { authorization: bearerFor(3) },
      payload: { currentPassword: 'old one', newPassword: PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'no_password_set', message: PASSWORD_NOT_SET_MESSAGE });
    // 这条路**不**跑哈希：他没有"输错当前口令"这回事，一次都不该算。
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();
  });

  it('缺字段是 400 校验失败，且不碰口令（当前口令不许在这里判强度）', async () => {
    await boot();
    // 先让身份过关（`preHandler` 在 zod 之前），这条要的才是"过了闸、栽在校验"那一层。
    routeFindUnique(readyRow());
    const res = await app.inject({
      method: 'POST',
      url: '/api/password/change',
      headers: { authorization: bearerFor(3) },
      payload: { newPassword: PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Validation failed');
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();
  });
});

/**
 * `POST /password/set` —— 给**从来没有口令**的账号（纯通行密钥 / 魔法链接注册）
 * 加上第一个登录口令。
 *
 * 这一组钉的是"它和 `/password/change` 是不是**真的两条协议**"。三个形状差异各对应
 * 一种真实伤害：
 *
 *   | 差异 | 少了它会怎样 |
 *   |---|---|
 *   | 不验当前口令 | 这个账号根本没有口令可验 ⇒ 客户端只能逼用户打一个他手上没有的东西 |
 *   | 🔴 **不 bump `tokenVersion`** | 加一个认证器把其余设备全踢下线 —— 而这些设备没有一台是威胁（这个人此刻就登录着） |
 *   | 不回新会话 | 形状和 `change` 一样的话，客户端那条"换会话"的接线就得写成"可能有可能没有"，而两边都写对的代价是四个宿主各判一次 |
 *
 * 🔴 还有一件只有服务端能钉的：**并发**。两次"设第一个口令"同时到达时，无条件 `update`
 * 让后写的那次**静默覆盖**前一次，而两边都收到 200。症状是"我明明设过密码，登录时却不对"，
 * 且没有任何一条日志能解释它。判据是 `updateMany` 的 `where` 里带着 `passwordHash: null`
 * 且 `count !== 1` 时报 `password_already_set`。
 *
 * ⚠️ 这里的 URL 是**写死的字面量**，不引 `AUTH_PASSWORD_PATHS.set`：那条常量在
 * `password-contract.spec.ts` 里已经钉过"注册的正是它"，这一组要钉的是**线上那串字节**。
 * 两处都引同一份常量 = 谁也不验谁。
 */
describe('POST /password/set：加认证器，不是换钥匙', () => {
  const bearer = (tokenVersion: number): string =>
    `Bearer ${jwt.sign(
      { userId: 7, email: EMAIL, tokenVersion },
      process.env.JWT_SECRET as string,
      { expiresIn: '1h' },
    )}`;

  const setWith = (token: string | undefined, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/password/set',
      ...(token === undefined ? {} : { headers: { authorization: token } }),
      payload: payload as Record<string, unknown>,
    });

  /**
   * 带**持久化**的假库：`updateMany` 真的把那一行的 `passwordHash` 写上，并且**只在
   * 它还是 null 时**写（条件写，与真实现同形）。
   *
   * 为什么要持久化：不持久就只能靠 `mockResolvedValueOnce` 演出顺序，而"第二次请求
   * 拿到的是业务答复而不是 401"这条证据要求第一次**真的改变了账号状态**。
   *
   * 🔴 `select` 里没有 `passwordHash` 的那次查询是 `verifyToken` 在查身份 —— 它只看
   * `isVerified` 与 `tokenVersion`，不许看见口令那一格。
   */
  const fakeAccount = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
    const row = readyRow({ passwordHash: null, ...overrides });
    mocks.user.findUnique.mockImplementation(async (args: unknown) => {
      const select = (args as { select?: Record<string, unknown> })?.select ?? {};
      if ('passwordHash' in select) return { ...row };
      // 🔴 ADR-0063 §2.6 那封告知信在写入**之后**按 id 回读 `{ email, locale }`。
      // 这一格必须单独分流：把它并进"验身份"那一支会让信收到 `undefined` 地址，
      // 而"收件地址取自账号那一行"这条判据就变成断言夹具自己。
      if ('locale' in select) return { email: row.email, locale: row.locale };
      return { id: 7, tokenVersion: row.tokenVersion, isVerified: row.isVerified };
    });
    mocks.user.updateMany.mockImplementation(async () => {
      if (row.passwordHash !== null) return { count: 0 };
      row.passwordHash = PHC;
      return { count: 1 };
    });
    return row;
  };

  beforeEach(() => {
    // 认证缓存是模块级的，会跨用例留下"这个 userId 的会话有效"。这一组要判的
    // 恰好包含"令牌在 set 之后还有效"，所以每条都从空缓存开始。
    authCache.clear();
  });

  it('🔴 没有 Authorization ⇒ 401：零哈希、零写库，也不许说出账号状态', async () => {
    await boot();
    const res = await setWith(undefined, { newPassword: PASSWORD });

    expect(res.statusCode).toBe(401);
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();
    expect(hashSpies.hashPassword).not.toHaveBeenCalled();
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
    // `password_already_set` 与 `no_password_set` 都**只在已认证接口**上出现，
    // 这是它们不违反 anti-enumeration 的前提。未认证的这一次不许漏出任何一个。
    expect(res.body).not.toContain('password_already_set');
    expect(res.body).not.toContain('no_password_set');
  });

  it('成功：200 且响应体**只有**那句 message —— 不发会话、不 bump 版本', async () => {
    await boot();
    fakeAccount();
    const res = await setWith(bearer(3), { newPassword: PASSWORD });

    expect(res.statusCode).toBe(200);
    // `toEqual` 是逐字比较：`{ token, user, message }` 这种"顺手签一枚"会当场红。
    expect(res.json()).toEqual({ message: PASSWORD_SET_SUCCESS_MESSAGE });
    expect(res.body).not.toContain('tokenVersion');
    // 🔴 不 bump 的直接证据：`tokenVersion` 只能经 `user.update` 写，那条路一次都没走。
    expect(mocks.user.update).not.toHaveBeenCalled();
    // 也没有"当前口令"可验：一次 verify 都不该跑。
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();
  });

  it('🔴 写库的形状：`where` 里带着 `passwordHash: null`，`data` 里只有哈希', async () => {
    await boot();
    fakeAccount();
    await setWith(bearer(3), { newPassword: PASSWORD });

    // 少了 `where` 里那一格，条件写就退化成无条件覆盖 ⇒ 并发双写两边都看"成功"。
    expect(mocks.user.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: 7, passwordHash: null },
      data: { passwordHash: PHC },
    });
  });

  it('🔴 抢输的那一次（count=0）⇒ 400 + password_already_set，**不是** 200', async () => {
    await boot();
    fakeAccount();
    // 读到的时候还是 null，写的时候别人已经抢先 ⇒ 真库里 count 是 0。
    mocks.user.updateMany.mockImplementationOnce(async () => ({ count: 0 }));

    const res = await setWith(bearer(3), { newPassword: PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'password_already_set',
      message: PASSWORD_ALREADY_SET_MESSAGE,
    });
  });

  it('账号**已经有**口令 ⇒ 400 + code，且一次哈希都不烧', async () => {
    await boot();
    fakeAccount({ passwordHash: PHC });
    const res = await setWith(bearer(3), { newPassword: PASSWORD });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'password_already_set',
      message: PASSWORD_ALREADY_SET_MESSAGE,
    });
    expect(hashSpies.hashPassword).not.toHaveBeenCalled();
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 设过之后手上那枚令牌**仍然可用**（拿到的是业务答复，不是 401）', async () => {
    await boot();
    fakeAccount();
    const first = await setWith(bearer(3), { newPassword: PASSWORD });
    expect(first.statusCode).toBe(200);

    // 假库把第一次真的写进去了 ⇒ 第二次的 400 来自业务层。
    // 如果这条路 bump 了版本，这一次会是 401，而这正是"改一个认证器把别的设备踢下线"的形状。
    const second = await setWith(bearer(3), { newPassword: PASSWORD });
    expect(second.statusCode).toBe(400);
    expect(second.json().code).toBe('password_already_set');
    expect(mocks.user.update).not.toHaveBeenCalled();
  });

  it('会话在缓存里还有效、账号却已变成未验证 ⇒ 403，且**一次写库都不发生**', async () => {
    await boot();
    const row = fakeAccount();
    // 先用一次"过了闸、栽在校验"的请求喂上认证缓存（`preHandler` 在 zod 之前）。
    expect((await setWith(bearer(3), {})).statusCode).toBe(400);

    row.isVerified = 0;
    const res = await setWith(bearer(3), { newPassword: PASSWORD });
    // 403 而不是 401：口令认证**没有**失败，是"这个账号还差最后一步"。
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('email_not_verified');
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
  });

  it('新口令不合格 ⇒ 400 + policyCode，写库一次都不发生', async () => {
    await boot();
    fakeAccount();
    policySpies.checkNewPassword.mockResolvedValueOnce({ ok: false, code: 'too_short' });

    const res = await setWith(bearer(3), { newPassword: 'short' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'password_policy_violation',
      message: 'That password does not meet the requirements.',
      policyCode: 'too_short',
    });
    expect(hashSpies.hashPassword).not.toHaveBeenCalled();
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
  });

  it('缺 newPassword / 空串是 400 校验失败，不进服务层', async () => {
    await boot();
    fakeAccount();
    expect((await setWith(bearer(3), {})).statusCode).toBe(400);
    expect((await setWith(bearer(3), { newPassword: '' })).statusCode).toBe(400);
    expect(hashSpies.hashPassword).not.toHaveBeenCalled();
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
  });

  /**
   * ADR-0063 §2.6：加第一个登录口令 = **多开一扇门** ⇒ 发那封"账号多了一种登录方式"。
   *
   * 这一组存在的理由是一条真实伤害：拿着别人遗失的会话，可以先给自己加一个
   * **他知道的**口令当持久入口，而原主一个字都收不到（`email-password-auth.md` 缺口 13）。
   * 每条各挡一种坏法 —— 少发 / 发在失败路径上 / 收件地址跟着请求体走 / 通知失败翻转成功。
   */
  describe('告知信（ADR-0063 §2.6）', () => {
    it('🔴 成功 ⇒ 发一封 password 信，收件地址是账号那一行的邮箱', async () => {
      await boot();
      fakeAccount();

      const res = await setWith(bearer(3), { newPassword: PASSWORD });
      expect(res.statusCode).toBe(200);

      expect(emailSpies.sendAuthenticatorAddedEmail).toHaveBeenCalledTimes(1);
      expect(emailSpies.sendAuthenticatorAddedEmail.mock.calls[0]).toEqual([
        EMAIL,
        'password',
        'zh-CN',
      ]);
    });

    it('🔴 抢输的那一次（count=0）⇒ 一封都不发', async () => {
      await boot();
      fakeAccount();
      mocks.user.updateMany.mockImplementationOnce(async () => ({ count: 0 }));

      expect((await setWith(bearer(3), { newPassword: PASSWORD })).statusCode).toBe(400);
      expect(emailSpies.sendAuthenticatorAddedEmail).not.toHaveBeenCalled();
    });

    it('🔴 账号**已经有**口令 ⇒ 不发：这一次什么都没加', async () => {
      await boot();
      fakeAccount({ passwordHash: PHC });

      expect((await setWith(bearer(3), { newPassword: PASSWORD })).statusCode).toBe(400);
      expect(emailSpies.sendAuthenticatorAddedEmail).not.toHaveBeenCalled();
    });

    it('🔴 未认证 ⇒ 401 且一封都不发（连账号那一行都不许多读一次）', async () => {
      await boot();
      fakeAccount();

      expect((await setWith(undefined, { newPassword: PASSWORD })).statusCode).toBe(401);
      expect(emailSpies.sendAuthenticatorAddedEmail).not.toHaveBeenCalled();
    });

    it('🔴 信发不出去 / 发信那步抛错 ⇒ **仍然 200**：口令已经设上了', async () => {
      await boot();
      // 两次各换一行**新账号**（`fakeAccount()` 会重置 `passwordHash: null`）：
      // 复用第一次那行的话，第二次拿到的是业务的 `password_already_set`，
      // 那条 200 就什么都没证明。
      fakeAccount();
      emailSpies.sendAuthenticatorAddedEmail.mockResolvedValueOnce(false);
      expect((await setWith(bearer(3), { newPassword: PASSWORD })).statusCode).toBe(200);

      fakeAccount();
      emailSpies.sendAuthenticatorAddedEmail.mockRejectedValueOnce(new Error('smtp exploded'));
      // 这两条各自对应实现里的一处 swallow：`deliver()` 返回 false，和整段 try 兜住抛出。
      // 只测前一条，摘掉外层 catch 也照样绿。
      expect((await setWith(bearer(3), { newPassword: PASSWORD })).statusCode).toBe(200);
    });

    it('语言取**账号上的** locale；没有值时走默认中文，不跟着请求体走', async () => {
      await boot();
      fakeAccount({ locale: 'en' });
      await setWith(bearer(3), { newPassword: PASSWORD });
      expect(emailSpies.sendAuthenticatorAddedEmail.mock.calls[0]).toEqual([
        EMAIL,
        'password',
        'en',
      ]);

      fakeAccount({ locale: null });
      await setWith(bearer(3), { newPassword: PASSWORD, locale: 'en' });
      expect(emailSpies.sendAuthenticatorAddedEmail.mock.calls[1]).toEqual([
        EMAIL,
        'password',
        'zh-CN',
      ]);
    });
  });
});

