import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';

/**
 * 邮箱 + 口令的**认证流程**（`src/password/service.ts`）—— 计划 W1 判据，钉 J10 / J11 / J12。
 *
 * 这一组要挡的不是"能不能登录"，而是四类**只有失败时才看得出来**的东西：
 *
 * 1. 🔴 **反枚举（J11）**：账号不存在 / 没设口令 / 口令错 —— 三条路的码、句子、
 *    以及**有没有真的算一次哈希**必须一致。少算一次哈希就是一个秒表预言机。
 * 2. **锁定锁的是口令这个认证器（J10）**，不是账号；而且锁定期过后**计数要作废** ——
 *   否则用户老实等满 15 分钟，回来打错一个字就当场再锁 15 分钟，界面上无从解释。
 * 3. **顺序**：「邮箱未验证」这句话只能出现在口令验对**之后**，否则它是最省事的枚举器。
 * 4. 🔴 **响应里不许有 `passwordHash`（J12）**，也不许有能拿去离线爆破的东西。
 *
 * 哈希层与策略层都换成了**假实现**：真实 Argon2id 一次 ~300 ms，一条爆破用例要跑五次，
 * 而且这里要验的是**流程判定**，不是参数强度（那由 `password-hash.spec.ts` 用已知答案钉）。
 * `withHashSlot` 保持**真实现** —— 闸门本身就是流程的一部分。
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

import {
  LOGIN_LOCKOUT_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  PasswordAuthError,
  PASSWORD_ACCOUNT_LOCKED_MESSAGE,
  PASSWORD_EMAIL_NOT_VERIFIED_MESSAGE,
  PASSWORD_INVALID_CREDENTIALS_MESSAGE,
  loginWithEmailPassword,
  registerWithEmailPassword,
} from '../src/password/service';
import { PasswordBackendBusy, hashGateStats, resetHashGateForTests, withHashSlot } from '../src/password/concurrency';

const SECRET = process.env.JWT_SECRET;
if (SECRET === undefined) throw new Error('测试进程里没有 JWT_SECRET —— 看 server/.env / setup 链');

const EMAIL = 'vaulted@example.com';
const PASSWORD = 'correct horse battery staple';
/** 一条形状合法的 PHC 串：假实现返回它，真实策略参数由 `password-hash.spec.ts` 钉。 */
const PHC = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$Q2xpZW50U2lnbmF0dXJlT2ZUaGVUZXN0';

interface RowOverrides {
  passwordHash?: string | null;
  isVerified?: number;
  failedLoginAttempts?: number;
  lockedUntil?: bigint | null;
  tokenVersion?: number;
}

/** 账号行的默认形状：已验证、设了口令、没被锁。每个用例只覆盖它关心的那一格。 */
const row = (overrides: RowOverrides = {}): Record<string, unknown> => ({
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

const findUnique = (overrides: RowOverrides = {}): void => {
  mocks.user.findUnique.mockResolvedValue(row(overrides));
};

const expectAuthError = (
  err: unknown,
  code: string,
  message: string,
): PasswordAuthError => {
  expect(err).toBeInstanceOf(PasswordAuthError);
  const pwErr = err as PasswordAuthError;
  expect(pwErr.code).toBe(code);
  expect(pwErr.message).toBe(message);
  return pwErr;
};

const loginRejecting = async (overrides: RowOverrides = {}): Promise<unknown> => {
  findUnique(overrides);
  hashSpies.verifyPassword.mockResolvedValue(false);
  try {
    await loginWithEmailPassword(EMAIL, PASSWORD);
    return null;
  } catch (err) {
    return err;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  resetHashGateForTests();
  mocks.user.findUnique.mockResolvedValue(null);
  mocks.user.update.mockResolvedValue(row());
  mocks.user.updateMany.mockResolvedValue({ count: 1 });
  // 默认：口令**不对**、不需要重算、哑校验成功。
  hashSpies.verifyPassword.mockResolvedValue(false);
  hashSpies.needsRehash.mockReturnValue(false);
  hashSpies.dummyVerify.mockResolvedValue(undefined);
  hashSpies.hashPassword.mockResolvedValue(PHC);
  policySpies.checkNewPassword.mockImplementation(async (raw: string) => ({
    ok: true,
    normalized: raw.normalize('NFC').normalize('NFKC'),
  }));
  authSpies.registerWithMagicLink.mockResolvedValue({ message: 'neutral' });
});

afterEach(() => {
  resetHashGateForTests();
});

describe('🔴 J11 反枚举：三条失败路必须长得一模一样', () => {
  const cases: Array<[string, RowOverrides | null]> = [
    ['账号不存在', null],
    ['账号存在但没设口令（纯通行密钥 / 魔法链接账号）', { passwordHash: null }],
    ['口令不对', {}],
  ];

  it.each(cases)('%s ⇒ 同一个码、同一句话', async (_label, overrides) => {
    const err = await loginRejecting(overrides ?? undefined);
    expectAuthError(err, 'invalid_credentials', PASSWORD_INVALID_CREDENTIALS_MESSAGE);
  });

  it('🔴 前两条也**真的算一次哈希** —— 否则秒表就是邮箱存在性预言机', async () => {
    // 账号不存在：没有 passwordHash 可验，必须跑哑校验。
    mocks.user.findUnique.mockResolvedValue(null);
    await expect(loginWithEmailPassword(EMAIL, PASSWORD)).rejects.toThrow(
      PASSWORD_INVALID_CREDENTIALS_MESSAGE,
    );
    expect(hashSpies.dummyVerify).toHaveBeenCalledTimes(1);
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();

    // 没设口令：同样一次哑校验。
    vi.clearAllMocks();
    findUnique({ passwordHash: null });
    await expect(loginWithEmailPassword(EMAIL, PASSWORD)).rejects.toThrow(
      PASSWORD_INVALID_CREDENTIALS_MESSAGE,
    );
    expect(hashSpies.dummyVerify).toHaveBeenCalledTimes(1);
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();

    // 口令错：一次**真**校验，没有哑校验补位。
    vi.clearAllMocks();
    hashSpies.verifyPassword.mockResolvedValue(false);
    await loginRejecting();
    expect(hashSpies.verifyPassword).toHaveBeenCalledTimes(1);
    expect(hashSpies.dummyVerify).not.toHaveBeenCalled();
  });

  it('🔴 不存在 / 没设口令**不计数也不锁定** —— 枚举别人的邮箱不该把无辜账号锁在门外', async () => {
    mocks.user.findUnique.mockResolvedValue(null);
    await loginWithEmailPassword(EMAIL, PASSWORD).catch(() => null);
    expect(mocks.user.update).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.user.update.mockResolvedValue(row());
    findUnique({ passwordHash: null });
    await loginWithEmailPassword(EMAIL, PASSWORD).catch(() => null);
    expect(mocks.user.update).not.toHaveBeenCalled();
  });

  it('哑校验也走闸门：过载时同样是 PasswordBackendBusy（503 语义），绕不过容量限制', async () => {
    const { slots } = hashGateStats();
    // 用**永不落定的 promise** 占位，而不是 setTimeout：定时器会让测试进程挂住，
    // 而那会让"这条红"看起来像"环境慢"。
    const releases: Array<() => void> = [];
    const blocker = (): Promise<void> =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    // 占满槽位，再把队列也填满（`MAX_WAITING = 32`），下一个请求就该当场被拒。
    for (let i = 0; i < slots + 32; i += 1) {
      void withHashSlot(blocker).catch(() => undefined);
    }

    mocks.user.findUnique.mockResolvedValue(null);
    await expect(loginWithEmailPassword(EMAIL, PASSWORD)).rejects.toBeInstanceOf(
      PasswordBackendBusy,
    );

    releases.forEach((done) => done());
    resetHashGateForTests();
  });
});

describe('J10 锁定：5 次失败锁 15 分钟，锁的是口令这条路', () => {
  it('第 5 次失败**当场**写上 lockedUntil', async () => {
    findUnique({ failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS - 1 });
    hashSpies.verifyPassword.mockResolvedValue(false);
    // 计数是 `increment`，所以 update 返回的是**写完之后**的那一格的值。
    mocks.user.update.mockResolvedValue({ failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS });

    const err = await loginWithEmailPassword(EMAIL, PASSWORD).catch((e: unknown) => e);
    // 第五次本身仍然是"口令不对"，不是"已锁定"（否则用户永远看不到最后那次的机会）。
    expectAuthError(err, 'invalid_credentials', PASSWORD_INVALID_CREDENTIALS_MESSAGE);

    expect(mocks.user.update).toHaveBeenCalledTimes(2);
    // 🔴 第一条断言钉的是**形状**：计数必须是 `increment`（读-改-写一条语句）。
    // 先 find 再 update 的写法在并发爆破下会丢计数（两个请求各读到 4、各写回 5）——
    // 那正是"永远锁不上"的形状，而它在单线程用例里看起来完全正常。
    expect(mocks.user.update.mock.calls[0][0]).toMatchObject({
      where: { id: 7 },
      data: { failedLoginAttempts: { increment: 1 }, lockedUntil: null },
    });
    const lockData = (mocks.user.update.mock.calls[1][0] as { data: Record<string, unknown> })
      .data;
    const lockedUntil = lockData.lockedUntil as bigint;
    expect(typeof lockedUntil).toBe('bigint');
    const remaining = Number(lockedUntil - BigInt(Date.now()));
    expect(remaining).toBeGreaterThan(LOGIN_LOCKOUT_MS - 5_000);
    expect(remaining).toBeLessThanOrEqual(LOGIN_LOCKOUT_MS);
  });

  it('锁定期内：不再校验口令，直接 account_locked + 剩余秒数', async () => {
    findUnique({
      failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      lockedUntil: BigInt(Date.now() + 60_000),
    });

    const err = await loginWithEmailPassword(EMAIL, PASSWORD).catch((e: unknown) => e);
    const pwErr = expectAuthError(err, 'account_locked', PASSWORD_ACCOUNT_LOCKED_MESSAGE);
    expect(pwErr.retryAfterSeconds).toBeGreaterThan(50);
    expect(pwErr.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.user.update).not.toHaveBeenCalled();
  });

  it('🔴 锁定期**已过** ⇒ 计数一并作废（否则老实等满 15 分钟的人打错一个字就当场再被锁）', async () => {
    findUnique({
      failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      lockedUntil: BigInt(Date.now() - 1_000),
    });
    hashSpies.verifyPassword.mockResolvedValue(false);

    const err = await loginWithEmailPassword(EMAIL, PASSWORD).catch((e: unknown) => e);
    expectAuthError(err, 'invalid_credentials', PASSWORD_INVALID_CREDENTIALS_MESSAGE);

    const resets = mocks.user.update.mock.calls
      .map((call) => (call[0] as { data: Record<string, unknown> }).data)
      .filter((data) => data.failedLoginAttempts === 0);
    expect(resets.length).toBeGreaterThanOrEqual(1);
    expect(resets[0].lockedUntil).toBeNull();
  });

  it('口令验对 ⇒ 计数清零，且会话带着 tokenVersion（全设备登出赖以生效的那一格）', async () => {
    findUnique({ failedLoginAttempts: 2 });
    hashSpies.verifyPassword.mockResolvedValue(true);

    const result = await loginWithEmailPassword(EMAIL, PASSWORD);
    const cleared = mocks.user.update.mock.calls
      .map((call) => (call[0] as { data: Record<string, unknown> }).data)
      .find((data) => data.failedLoginAttempts === 0);
    expect(cleared?.lockedUntil).toBeNull();

    const claims = jwt.verify(result.token, SECRET!) as jwt.JwtPayload & { tokenVersion: number };
    expect(claims.userId).toBe(7);
    expect(claims.tokenVersion).toBe(3);
  });

  it('成功的登录**不**因为重算失败而变红（策略落后是性能问题，不是"没验过"）', async () => {
    findUnique();
    hashSpies.verifyPassword.mockResolvedValue(true);
    hashSpies.needsRehash.mockReturnValue(true);
    // 一次成功登录会写两格：先清计数，再写新哈希。只有**第二格**失败。
    mocks.user.update.mockResolvedValueOnce(row()).mockRejectedValueOnce(new Error('db down'));

    const result = await loginWithEmailPassword(EMAIL, PASSWORD);
    expect(typeof result.token).toBe('string');
    expect(spiedLogger.error).toHaveBeenCalledTimes(1);
  });

  it('重算成功后写入的是**新哈希**，且用的是当前参数产出的串', async () => {
    const fresh = '$argon2id$v=19$m=19456,t=3,p=2$c2FsdHNhbHRzYWx0c2FsdA$bmV3ZXJIYXNoVmFsdWUxMjM0NTY';
    hashSpies.hashPassword.mockResolvedValue(fresh);
    hashSpies.verifyPassword.mockResolvedValue(true);
    hashSpies.needsRehash.mockReturnValue(true);
    findUnique();

    await loginWithEmailPassword(EMAIL, PASSWORD);
    const written = mocks.user.update.mock.calls
      .map((call) => (call[0] as { data: Record<string, unknown> }).data)
      .find((data) => typeof data.passwordHash === 'string');
    expect(written?.passwordHash).toBe(fresh);
    expect(hashSpies.hashPassword).toHaveBeenCalledWith(PASSWORD);
  });
});

describe('顺序：未验证那句话只能在校验口令通过之后出现', () => {
  it('口令对 + 未验证 ⇒ email_not_verified，且**不发会话**', async () => {
    findUnique({ isVerified: 0 });
    hashSpies.verifyPassword.mockResolvedValue(true);

    const err = await loginWithEmailPassword(EMAIL, PASSWORD).catch((e: unknown) => e);
    expectAuthError(err, 'email_not_verified', PASSWORD_EMAIL_NOT_VERIFIED_MESSAGE);
  });

  it('🔴 口令**错** + 未验证 ⇒ 仍然是 invalid_credentials（否则一次请求就知道哪些邮箱注册过）', async () => {
    findUnique({ isVerified: 0 });
    hashSpies.verifyPassword.mockResolvedValue(false);

    const err = await loginWithEmailPassword(EMAIL, PASSWORD).catch((e: unknown) => e);
    expectAuthError(err, 'invalid_credentials', PASSWORD_INVALID_CREDENTIALS_MESSAGE);
  });
});

describe('🔴 J12 响应形状：不含 passwordHash，不含任何能离线爆破的东西', () => {
  it('成功登录只带 { token, user: { id, email, locale } }', async () => {
    findUnique();
    hashSpies.verifyPassword.mockResolvedValue(true);

    const result = await loginWithEmailPassword(EMAIL, PASSWORD);
    expect(Object.keys(result).sort()).toEqual(['token', 'user']);
    expect(Object.keys(result.user).sort()).toEqual(['email', 'id', 'locale']);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain(PHC);
    expect(serialized).not.toContain('failedLoginAttempts');
    expect(serialized).not.toContain('lockedUntil');
    expect(serialized).not.toContain('tokenVersion');
  });
});

describe('注册：策略在前、委托在后', () => {
  it('🔴 策略不过 ⇒ 一个字节都不哈希，也不占邮箱', async () => {
    policySpies.checkNewPassword.mockResolvedValue({ ok: false, code: 'too_short' });
    const err = await registerWithEmailPassword({ email: EMAIL, password: 'abc' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PasswordAuthError);
    expect((err as PasswordAuthError).code).toBe('password_policy_violation');
    expect((err as PasswordAuthError).policyCode).toBe('too_short');
    expect(hashSpies.hashPassword).not.toHaveBeenCalled();
    expect(authSpies.registerWithMagicLink).not.toHaveBeenCalled();
  });

  it('哈希出来的串交给**已存在的**注册路径（验证令牌、邀请码、配额、P2002 中性化都在它身上）', async () => {
    await registerWithEmailPassword({
      email: EMAIL,
      password: PASSWORD,
      termsAcceptedAt: 1_700_000_000_000,
      inviteCode: 'HEYTA5',
      locale: 'en',
    });
    expect(hashSpies.hashPassword).toHaveBeenCalledWith(PASSWORD);
    expect(authSpies.registerWithMagicLink).toHaveBeenCalledWith(
      EMAIL,
      1_700_000_000_000,
      'HEYTA5',
      'en',
      PHC,
    );
  });

  it('归一化口径只有一个：存的是策略返回的 normalized，不是原始输入', async () => {
    const raw = 'cafe\u0301 bakery 2026';
    policySpies.checkNewPassword.mockImplementation(async (value: string) => ({
      ok: true,
      normalized: value.normalize('NFC').normalize('NFKC'),
    }));
    await registerWithEmailPassword({ email: EMAIL, password: raw });
    expect(hashSpies.hashPassword).toHaveBeenCalledWith('caf\u00e9 bakery 2026');
    expect(hashSpies.hashPassword.mock.calls[0][0]).not.toBe(raw);
  });
});
