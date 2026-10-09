import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';

/**
 * 口令**找回 / 重置 / 改密**（`src/password/recovery.ts`）—— 计划 W3 判据，钉 J13 / J14。
 *
 * 这一组要挡的四类东西，每一类都有一个对应的"看起来正常"的坏实现：
 *
 * 1. 🔴 **`/forgot` 不许是邮箱存在性预言机**：账号不存在 / 没设口令 / 已有一张活链接
 *    三种情况**同一句**、**同一个返回**、而且**什么都不写**。
 *    注册与登录那两条已经把这件事钉过一遍；这条是第三条出口，也是最便宜的
 *    （它连口令都不用猜）。
 * 2. 🔴 **两个出口对照**（W2 立下的判据形状）：**发进邮件的那句话**的 SHA-256
 *    必须**就是**落进 `reset_password_token` 的那个值。
 *    形状检查分不出明文和哈希（两者都是 64 个 `[0-9a-f]`），所以这一条才是那一刀的另半边。
 * 3. **顺序**：策略校验在**消费一次性链接之前**。反过来的症状是用户被"口令太短"
 *    打回、而链接已经烧掉，他得回邮箱重新点一次。
 * 4. 🔴 **成功后不发会话（J14）**，但**要 bump `tokenVersion`（J13）** ——
 *    这两件事是一对：旧设备全部失效，而这次操作本身**不**换来一个新会话。
 *
 * 哈希层与策略层换成假实现（真实 Argon2id 一次 ~300 ms），`withHashSlot` 保持真实现；
 * **邮件层换成间谍** —— 这里要断言的正是"发没发、发给谁、带的那句话是什么"。
 */

// 必须在 `../src/auth` 被 import **之前**设好 —— `getJwtSecret()` 跑在模块顶层。
// `vi.hoisted` 提升到所有 import 与 `vi.mock` 工厂之前（同 `magic-link-registration.spec.ts`）。
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

const mocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    /** ADR-0063：`issueSession()` 签名前回读 `email` / `tokenVersion`（不接受调用方传值）。 */
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
  dummyVerify: vi.fn(),
}));

const policySpies = vi.hoisted(() => ({ checkNewPassword: vi.fn() }));

const emailSpies = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
  sendPasswordChangedEmail: vi.fn(),
}));

/**
 * 认证缓存的间谍。它不是"顺手 mock 掉"—— 🔴 **它本身就是这一组的一条判据**：
 * `verifyToken` 命中缓存时**不查库**，而缓存里存的就是 `tokenVersion`。
 * 所以"bump 了计数器"和"旧设备真的被登出了"之间隔着这个对象，
 * 漏掉 `invalidate` 的症状是：库里那格已经 +1、日志也打了、人还在里面（J13 假绿）。
 */
const cacheSpies = vi.hoisted(() => ({ invalidate: vi.fn() }));

/**
 * 实时通道的间谍。和 `authCache` 那一个同一条理由 —— **它本身就是一组判据**：
 * 通道只在 WebSocket **upgrade** 时鉴权，之后靠心跳维持，所以只 bump 计数器时
 * 旧设备**已经开着的那个页面**会继续收 op 通知（`closeForUser` 上的原话）。
 * 那个动作在界面上完全不可见，所以它必须有人盯着。
 */
const wsSpies = vi.hoisted(() => ({ closeForUser: vi.fn(), notifyNewOps: vi.fn() }));

const spiedLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../src/db', () => ({ prisma: mocks }));
vi.mock('../src/logger', () => ({ Logger: spiedLogger }));
vi.mock('../src/auth-cache', () => ({ authCache: cacheSpies }));
vi.mock('../src/password/hash', () => hashSpies);
vi.mock('../src/password/policy', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...policySpies };
});
vi.mock('../src/email', () => emailSpies);
vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => wsSpies,
}));

/**
 * 🔴 把真实 `../src/auth` 取回来。`tests/setup.ts` 全局把它 mock 成了一个**闭合工厂**
 * （只有 `verifyToken` / 两个常量 / `verifyEmail`），里面**没有** `issueSession`。
 * 改密成功要**真的**签一枚会话 JWT，而下面那条用例要把这枚 JWT **解开来**核对
 * `tokenVersion` 是不是库里 bump 之后的那个值 —— 所以这里不能是假实现。
 * 同 `password-auth-flow.spec.ts` 的做法。
 */
vi.mock('../src/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));

import { hashToken } from '../src/auth-tokens';
import {
  PASSWORD_NOT_SET_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_SUCCESS_MESSAGE,
  PASSWORD_RESET_TTL_MS,
  changePassword,
  requestPasswordReset,
  resetPasswordWithToken,
} from '../src/password/recovery';
import {
  PASSWORD_ACCOUNT_LOCKED_MESSAGE,
  PASSWORD_INVALID_CREDENTIALS_MESSAGE,
  PASSWORD_INVALID_RESET_LINK_MESSAGE,
  PasswordAuthError,
} from '../src/password/service';
import { resetHashGateForTests } from '../src/password/concurrency';

const SECRET = process.env.JWT_SECRET;
if (SECRET === undefined) throw new Error('测试进程里没有 JWT_SECRET —— 看 server/.env / setup 链');

const EMAIL = 'vaulted@example.com';
const NEW_PASSWORD = 'a brand new passphrase';
const PHC = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$Q2xpZW50U2lnbmF0dXJlT2ZUaGVUZXN0';
/** 已落库的重置令牌列的值：形状与 `hashToken(randomBytes(32).hex)` 一致。 */
const STORED_TOKEN_HASH = 'a'.repeat(64);
const LIVE_TOKEN = 'b'.repeat(64);

const passwordRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 7,
  email: EMAIL,
  locale: 'zh-CN',
  passwordHash: PHC,
  tokenVersion: 3,
  lockedUntil: null,
  ...overrides,
});

/** 取出某次写库调用（`{ where, data }`）里被写进 `data` 的那一格。 */
const dataOf = (call: unknown): Record<string, unknown> =>
  (call as { data?: Record<string, unknown> }).data ?? {};

const whereOf = (call: unknown): Record<string, unknown> =>
  (call as { where?: Record<string, unknown> }).where ?? {};

const isResetLinkCall = (call: unknown): boolean => {
  const key = (arg: unknown) => 'resetPasswordToken' in ((arg as object) ?? {});
  return key(dataOf(call)) || key(whereOf(call));
};

/** `updateMany` 里碰到那两格的调用，按发生顺序。 */
const resetLinkCalls = (): unknown[] =>
  mocks.user.updateMany.mock.calls.map((c) => c[0]).filter(isResetLinkCall);

/** 申请重置时那条**占位**的 `updateMany`（带 `OR` 条件）。 */
const claimData = (): Record<string, unknown> => dataOf(resetLinkCalls()[0]);
const claimWhere = (): Record<string, unknown> => whereOf(resetLinkCalls()[0]);

beforeEach(() => {
  vi.clearAllMocks();
  resetHashGateForTests();
  mocks.user.findUnique.mockResolvedValue(null);
  mocks.user.findFirst.mockResolvedValue(null);
  // 🔴 带 `tokenVersion` 的返回值：`changePassword` 是从这次 `update` 的**返回**里
  // 读回新版本的（不是 `旧值 + 1` 算出来的），所以 mock 必须给这一格。
  mocks.user.update.mockResolvedValue({ tokenVersion: 4 });
  mocks.user.updateMany.mockResolvedValue({ count: 1 });
  // 🔴 ADR-0063：`issueSession` 在签名**之前**回读账号行的 `email` / `tokenVersion`。
  // 默认值取**上面那次 `update` 写回的那一格**（4）—— 真库里"bump 提交之后再读"读到的
  // 就是它，所以这两格在夹具里也必须同源。要断言别的版本，用例自己覆盖（见下面改密那条）。
  mocks.user.findUniqueOrThrow.mockResolvedValue({ email: EMAIL, tokenVersion: 4 });
  // 会话行：`create` 是 `issueSession` 插的那一行，`deleteMany` 是"全设备登出"删的那些。
  // 返回值要有 `count` —— `revokeAllSessions` 读它，给 `undefined` 会当场抛。
  mocks.accessSession.create.mockResolvedValue({});
  mocks.accessSession.deleteMany.mockResolvedValue({ count: 3 });
  hashSpies.hashPassword.mockResolvedValue(PHC);
  hashSpies.verifyPassword.mockResolvedValue(true);
  hashSpies.dummyVerify.mockResolvedValue(undefined);
  policySpies.checkNewPassword.mockImplementation(async (raw: string) => ({
    ok: true,
    normalized: raw,
  }));
  emailSpies.sendPasswordResetEmail.mockResolvedValue(true);
  emailSpies.sendPasswordChangedEmail.mockResolvedValue(true);
  mocks.user.update.mockResolvedValue({ tokenVersion: 4 });
});

describe('POST /password/forgot：它不是邮箱存在性预言机', () => {
  it('🔴 三种"什么都不该发生"的情况返回**逐字相同**的中性响应', async () => {
    // ① 账号根本没有
    mocks.user.findUnique.mockResolvedValue(null);
    const noAccount = await requestPasswordReset({ email: EMAIL });
    // ② 有账号，但从来没有口令这个认证器（纯通行密钥 / 魔法链接注册的）
    mocks.user.findUnique.mockResolvedValue({ id: 7, email: EMAIL, passwordHash: null });
    const noPassword = await requestPasswordReset({ email: EMAIL });
    // ③ 有口令，但上一张链接还在有效期内（见下面那条限流用例）
    mocks.user.findUnique.mockResolvedValue({ id: 7, email: EMAIL, passwordHash: PHC });
    mocks.user.updateMany.mockResolvedValueOnce({ count: 0 });
    const throttled = await requestPasswordReset({ email: EMAIL });

    expect(noAccount).toEqual({ message: PASSWORD_RESET_REQUEST_MESSAGE });
    expect(noPassword).toEqual(noAccount);
    expect(throttled).toEqual(noAccount);
  });

  it('🔴 没有口令的账号**不写库、不发信**（写了就等于替他领了一张链接）', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 7, email: EMAIL, passwordHash: null });
    await requestPasswordReset({ email: EMAIL });
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
    expect(emailSpies.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('账号不存在时连一次查询外的写都不发生，且日志不分级（日志也是响应之外的信号）', async () => {
    mocks.user.findUnique.mockResolvedValue(null);
    await requestPasswordReset({ email: 'nobody@example.com' });
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
    expect(emailSpies.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(spiedLogger.error).not.toHaveBeenCalled();
    expect(spiedLogger.warn).not.toHaveBeenCalled();
  });

  it('🔴 两个出口对照：**邮件里那句话**的 SHA-256 == 落进 `reset_password_token` 的值', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 7, email: EMAIL, passwordHash: PHC });

    await requestPasswordReset({ email: EMAIL, locale: 'en' });

    expect(emailSpies.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const sentTo = emailSpies.sendPasswordResetEmail.mock.calls[0][0] as string;
    const sentToken = emailSpies.sendPasswordResetEmail.mock.calls[0][1] as string;
    const sentLocale = emailSpies.sendPasswordResetEmail.mock.calls[0][2] as string;
    expect(sentTo).toBe(EMAIL);
    // `locale` 一路透传到发信层（邮件是**为收件人**渲染的）。
    expect(sentLocale).toBe('en');
    // 发出去的是 256 bit 随机值的 hex，不是那枚哈希本身。
    expect(sentToken).toMatch(/^[0-9a-f]{64}$/);
    expect(sentToken).not.toBe(hashToken(sentToken));

    const written = claimData();
    // 这一条是整个 W2 立场的落地判据：库里那格必须是**发出去那句**的哈希。
    // 若哪天有人把 `hashToken` 拿掉，这里红；把发信那句换成别的值，这里也红。
    expect(written.resetPasswordToken).toBe(hashToken(sentToken));
    expect(written.resetPasswordTokenExpiresAt).toBeTypeOf('bigint');
  });

  it('过期时间由 TTL 常量推导，不是写死的一个数', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 7, email: EMAIL, passwordHash: PHC });
    const before = Date.now();
    await requestPasswordReset({ email: EMAIL });
    const data = claimData();
    const expiresAt = Number(data.resetPasswordTokenExpiresAt as bigint);
    expect(expiresAt).toBeGreaterThanOrEqual(before + PASSWORD_RESET_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + PASSWORD_RESET_TTL_MS);
  });

  it('🔴 限流是**那一行本身**：上一张链接还活着时不写新令牌、不发第二封信', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 7, email: EMAIL, passwordHash: PHC });
    // `claim.count === 0` 就是"WHERE 里那串 OR 没匹配上"= 上一张还在有效期内
    mocks.user.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await requestPasswordReset({ email: EMAIL });

    expect(mocks.user.updateMany).toHaveBeenCalledTimes(1);
    expect(emailSpies.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ message: PASSWORD_RESET_REQUEST_MESSAGE });
  });

  it('限流那条 WHERE 必须**只**挡住"还活着"的：三格 OR 缺一不可', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 7, email: EMAIL, passwordHash: PHC });
    await requestPasswordReset({ email: EMAIL });
    const where = claimWhere();
    // 🔴 少了 `id` 这一格，这条 `updateMany` 就是**全表**的：任何一个别的用户
    // 手上有一张活链接，就会替这个人占住那次"申请"。
    expect(where.id).toBe(7);
    // 漏掉 `{ expiresAt: null }` 那一格，历史上没设过过期时间的行就**永远**领不到链接。
    const or = where.OR as Array<Record<string, unknown>>;
    expect(or).toHaveLength(3);
    expect(or).toContainEqual({ resetPasswordToken: null });
    expect(or).toContainEqual({ resetPasswordTokenExpiresAt: null });
    expect(or.some((c) => 'lte' in ((c.resetPasswordTokenExpiresAt ?? {}) as object))).toBe(true);
  });

  it('🔴 发信失败 ⇒ 回滚刚写进去的令牌（库里不留没有邮件携带的有效凭证）', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 7, email: EMAIL, passwordHash: PHC });
    emailSpies.sendPasswordResetEmail.mockResolvedValue(false);

    await requestPasswordReset({ email: EMAIL });

    const sentToken = emailSpies.sendPasswordResetEmail.mock.calls[0][1] as string;
    const calls = resetLinkCalls();
    expect(calls).toHaveLength(2);
    expect(dataOf(calls[1]).resetPasswordToken).toBeNull();
    expect(dataOf(calls[1]).resetPasswordTokenExpiresAt).toBeNull();
    expect(spiedLogger.error).toHaveBeenCalled();
    // 回滚必须**带着那枚令牌**当条件：不带的话，一个迟到的失败会把别人刚申请到的
    // 那张有效链接清掉（用户视角：邮件到了、点进去说链接无效）。
    expect(whereOf(calls[1]).resetPasswordToken).toBe(hashToken(sentToken));
  });

  it('中性句里不许出现"没找到这个邮箱"这类字样（措辞也是通道）', () => {
    expect(PASSWORD_RESET_REQUEST_MESSAGE.toLowerCase()).toContain('if that email');
    expect(PASSWORD_RESET_REQUEST_MESSAGE).not.toMatch(/not found|does not exist|no account/i);
  });
});

describe('POST /password/reset：一次性链接换口令', () => {
  const liveLink = () => {
    mocks.user.findFirst.mockResolvedValue({
      id: 7,
      email: EMAIL,
      resetPasswordTokenExpiresAt: BigInt(Date.now() + 60_000),
    });
  };

  it('🔴 策略校验**在消费链接之前**：策略不过时那一行令牌原封不动', async () => {
    policySpies.checkNewPassword.mockResolvedValueOnce({ ok: false, code: 'too_short' });
    liveLink();

    await expect(
      resetPasswordWithToken({ token: LIVE_TOKEN, password: 'short' }),
    ).rejects.toMatchObject({ code: 'password_policy_violation' });

    // 一条 `updateMany` 都不该发生：链接**没被烧掉**，用户改对口令就能直接用同一条链接。
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
    expect(hashSpies.hashPassword).not.toHaveBeenCalled();
  });

  it('🔴 成功：一次带条件的 UPDATE 同时做完「换口令 + 清链接 + bump tokenVersion + 解自己的锁」', async () => {
    liveLink();

    const result = await resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD });

    const consume = resetLinkCalls()[0];
    expect(dataOf(consume).passwordHash).toBe(PHC);
    expect(dataOf(consume).resetPasswordToken).toBeNull();
    expect(dataOf(consume).resetPasswordTokenExpiresAt).toBeNull();
    // 🔴 J13 的第一半：全设备登出的**计数器**这一半 —— 它只管得住下一次的 HTTP 请求。
    // 缓存那一半在下面的 describe，通道与会话行那一半在文件末尾那个 describe（J13 的第三半）。
    expect(dataOf(consume).tokenVersion).toEqual({ increment: 1 });
    // 攻击者不能"先输错五次锁住、再走重置"把人挡在自己账号外面 —— 重置顺手解掉锁。
    expect(dataOf(consume).failedLoginAttempts).toBe(0);
    expect(dataOf(consume).lockedUntil).toBeNull();
    // 消费必须是**带条件**的（不是先查再改），否则双击同一封邮件会给两次成功。
    expect(whereOf(consume).resetPasswordToken).toBe(hashToken(LIVE_TOKEN));
    expect(whereOf(consume).resetPasswordTokenExpiresAt).toMatchObject({ gt: expect.any(BigInt) });

    expect(result).toEqual({ message: PASSWORD_RESET_SUCCESS_MESSAGE });
  });

  it('🔴 J14：重置成功**不发会话** —— 返回值里没有 token，也没有 user.id', async () => {
    liveLink();
    const result = await resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD });
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('user');
    // 兜一道：确认不是"签了但没返回"。（`issueSession` 在 `auth.ts`，这里没 mock，
    // 所以只能验"产物里没有 JWT 形状的东西"。）
    expect(JSON.stringify(result)).not.toMatch(/eyJ/);
  });

  it('成功那句不许读成"你已经登录了"', () => {
    expect(PASSWORD_RESET_SUCCESS_MESSAGE).toMatch(/Sign in with your new password/);
    expect(PASSWORD_RESET_SUCCESS_MESSAGE).not.toMatch(/signed in|logged in|you are in/i);
  });

  it('🔴 查不到 / 已过期 / 已被用过：三种都是**同一个码同一句话**', async () => {
    // ① 查不到（从没有过 / 已经被清掉）
    mocks.user.findFirst.mockResolvedValue(null);
    const unknown = await capture(
      resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD }),
    );

    // ② 过期
    mocks.user.findFirst.mockResolvedValue({
      id: 7,
      email: EMAIL,
      resetPasswordTokenExpiresAt: BigInt(Date.now() - 1000),
    });
    const expired = await capture(
      resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD }),
    );

    // ③ 被并发的第二个请求用掉了（`consumed.count === 0`）
    const unknownAndExpiredWrites = resetLinkCalls();
    liveLink();
    mocks.user.updateMany.mockResolvedValueOnce({ count: 0 });
    const used = await capture(
      resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD }),
    );

    for (const err of [unknown, expired, used]) {
      expect(err).toBeInstanceOf(PasswordAuthError);
      expect(err.code).toBe('invalid_reset_link');
      expect(err.message).toBe(PASSWORD_INVALID_RESET_LINK_MESSAGE);
    }
    // 🔴 三条都不许发"口令已改"的告知信 —— 它是"这一条真的走通了"的唯一外部标记。
    expect(emailSpies.sendPasswordChangedEmail).not.toHaveBeenCalled();
    // ① 查不到 / ② 过期 两条**没有换口令的写**。
    // （③ 的 `updateMany` 里带着 `passwordHash` 是**对的** —— 它的 `count === 0`
    // 才是要判的东西：那条 UPDATE 一个字都没改。改成"看 data 形状"会把这个
    // 正确实现判成违规，那正是一条"永远通过的判据"的反面。）
    // `length === 1` 是**前提断言**：② 确实清了一次。少了它，上面那个循环
    // 可能在对一个空数组打分（AGENTS §7 第 90 条同族）。
    expect(unknownAndExpiredWrites).toHaveLength(1);
    for (const call of unknownAndExpiredWrites) {
      expect(dataOf(call).passwordHash).toBeUndefined();
      expect(dataOf(call).resetPasswordToken).toBeNull();
    }
  });

  it('过期时当场清掉那枚死令牌（不是判据，但不许让它长期躺在库里）', async () => {
    mocks.user.findFirst.mockResolvedValue({
      id: 7,
      email: EMAIL,
      resetPasswordTokenExpiresAt: BigInt(Date.now() - 1000),
    });
    await capture(resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD }));
    const cleared = dataOf(resetLinkCalls()[0]);
    expect(cleared.resetPasswordToken).toBeNull();
  });

  it('过期时间那一格是 null 也算过期（缺字段的行不能变成永久链接）', async () => {
    mocks.user.findFirst.mockResolvedValue({
      id: 7,
      email: EMAIL,
      resetPasswordTokenExpiresAt: null,
    });
    const err = await capture(
      resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD }),
    );
    expect(err.code).toBe('invalid_reset_link');
  });

  it('🔴 告知信在**成功之后**发一封，带着收件人地址', async () => {
    liveLink();
    await resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD });
    expect(emailSpies.sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    expect(emailSpies.sendPasswordChangedEmail.mock.calls[0][0]).toBe(EMAIL);
  });

  it('🔴 失败路径**不**发信（挂到失败上就是一条骚扰他人的通道，也顺带泄露"这邮箱有账号"）', async () => {
    // 故意与上一条分开写：`vi.clearAllMocks()` 在同一条用例里会把
    // `updateMany` 的默认返回抹成 `undefined`，于是流程**因为测试脚手架**而失败 ——
    // 那种"红/绿"不指向任何产品行为。
    mocks.user.findFirst.mockResolvedValue(null);
    await capture(resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD }));
    expect(emailSpies.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it('告知信发不出去**不能**把成功变成失败', async () => {
    liveLink();
    emailSpies.sendPasswordChangedEmail.mockResolvedValue(false);
    await expect(
      resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD }),
    ).resolves.toEqual({ message: PASSWORD_RESET_SUCCESS_MESSAGE });
    expect(spiedLogger.error).toHaveBeenCalled();
  });

  it('🔴 两个出口对照（重置这一侧）：库里按**收到那句**的哈希查', async () => {
    liveLink();
    await resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD });
    expect(mocks.user.findFirst.mock.calls[0][0]).toMatchObject({
      where: { resetPasswordToken: hashToken(LIVE_TOKEN) },
    });
  });
});

describe('POST /password/change：当前设备不掉线，其余全部掉线', () => {
  it('成功：返回**一枚新的、带着 bump 后 tokenVersion 的**会话', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow());
    // 🔴 故意让它与 `passwordRow()` 里的 3 差一格（读到的是 3，写回来的是 5）：
    // 如果实现是 `user.tokenVersion + 1` 而不是**读回这次 UPDATE 的返回值**，
    // 签出来的就是 4。而在"读到 3 之后、写之前另有一次改密/强制登出把计数器推到 4"
    // 的真实并发下，这枚刚发给用户的新令牌**一落地就已经过期**。
    // 取 5 而不是 4 是为了让这条判据**能失败** —— 两边都是 4 的话，算术与读回两种写法
    // 都满足断言，等于没测。
    mocks.user.update.mockResolvedValue({ tokenVersion: 5 });
    // 🔴 回读那一格 = **这次 UPDATE 写回之后的值**（`issueSession` 读的就是 bump 提交后的
    // 同一行）。写 5 而不是 3：夹具替实现"预先知道结果"没有意义，而写 3 会把下面那条
    // `tokenVersion: 5` 的判据变成"要求实现去读旧值"。算术版（`3 + 1 = 4`）在这里仍然红。
    mocks.user.findUniqueOrThrow.mockResolvedValue({ email: EMAIL, tokenVersion: 5 });

    const result = await changePassword(7, 'old one', NEW_PASSWORD);

    const data = dataOf(mocks.user.update.mock.calls[0][0]);
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data.passwordHash).toBe(PHC);
    // 刚证明了手里有当前口令 ⇒ 那封"可能是别人申请的"邮件该失效
    expect(data.resetPasswordToken).toBeNull();
    expect(data.resetPasswordTokenExpiresAt).toBeNull();

    // 🔴 J13 的第二半：这枚新令牌里的 `tokenVersion` 必须等于库里 bump 后的值，
    // 否则它和旧设备身上那些一起失效了 —— 改个密码把自己的标签页踢出去。
    // `issueSession` 签的是 `{ userId, email, tokenVersion }`（没有 `sub`），
    // 所以这里断言的是**载荷里的那三格**，不是 JWT 标准 claim。
    const claims = jwt.verify(result.token, SECRET!, { algorithms: ['HS256'] }) as {
      userId: number;
      email: string;
      tokenVersion: number;
    };
    expect(claims.tokenVersion).toBe(5);
    expect(claims.userId).toBe(7);
    expect(claims.email).toBe(EMAIL);
    expect(result.user).toEqual({ id: 7, email: EMAIL, locale: 'zh-CN' });
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('🔴 当前口令错 ⇒ 计入登录那条**同一个**计数器（否则改密是条不会被锁的爆破通道）', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow({ failedLoginAttempts: 1 }));
    hashSpies.verifyPassword.mockResolvedValue(false);

    const err = await capture(changePassword(7, 'wrong', NEW_PASSWORD));
    expect(err.code).toBe('invalid_credentials');

    // 计数走 `increment`（一条语句里的读-改-写），不是"先读再写" ——
    // 后者在并发爆破下会丢计数，而那正是"永远锁不上"的形状。
    expect(dataOf(mocks.user.update.mock.calls[0][0]).failedLoginAttempts).toEqual({
      increment: 1,
    });
    // 口令**没**被换。
    expect(
      mocks.user.update.mock.calls.some((c) => 'passwordHash' in dataOf(c[0])),
    ).toBe(false);
    expect(emailSpies.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it('当前口令对、新口令不满足策略 ⇒ 什么都不写，也不发信', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow());
    policySpies.checkNewPassword.mockResolvedValueOnce({ ok: false, code: 'common_password' });

    const err = await capture(changePassword(7, 'old one', '12345678'));
    expect(err.code).toBe('password_policy_violation');
    expect(mocks.user.update).not.toHaveBeenCalled();
    expect(emailSpies.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it('🔴 账号根本没有口令 ⇒ `no_password_set`，不是 `invalid_credentials`', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow({ passwordHash: null }));

    const err = await capture(changePassword(7, 'whatever', NEW_PASSWORD));
    // 报成"口令错"会把他引向"我是不是忘了口令"的死循环 —— 他从来没有过口令。
    expect(err.code).toBe('no_password_set');
    expect(err.message).toBe(PASSWORD_NOT_SET_MESSAGE);
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();
    expect(hashSpies.dummyVerify).not.toHaveBeenCalled();
  });

  it('口令认证器被锁着 ⇒ 改密这条路也读同一把锁（不能只挡登录按钮）', async () => {
    mocks.user.findUnique.mockResolvedValue(
      passwordRow({ lockedUntil: BigInt(Date.now() + 60_000) }),
    );

    const err = await capture(changePassword(7, 'old one', NEW_PASSWORD));
    expect(err.code).toBe('account_locked');
    expect(err.message).toBe(PASSWORD_ACCOUNT_LOCKED_MESSAGE);
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(hashSpies.verifyPassword).not.toHaveBeenCalled();
  });

  it('已过的锁不挡路（与登录那条同一个"窗口过后重新数"的契约）', async () => {
    mocks.user.findUnique.mockResolvedValue(
      passwordRow({ lockedUntil: BigInt(Date.now() - 1000) }),
    );
    await expect(changePassword(7, 'old one', NEW_PASSWORD)).resolves.toHaveProperty('token');
  });

  it('未验证邮箱**不**挡改密：他手上已经有一枚有效会话了', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow({ isVerified: 0 }));
    await expect(changePassword(7, 'old one', NEW_PASSWORD)).resolves.toHaveProperty('token');
  });

  it('账号行查不到（令牌指向的人已被删）⇒ invalid_credentials，且不崩', async () => {
    mocks.user.findUnique.mockResolvedValue(null);
    const err = await capture(changePassword(999, 'old one', NEW_PASSWORD));
    expect(err.code).toBe('invalid_credentials');
    expect(err.message).toBe(PASSWORD_INVALID_CREDENTIALS_MESSAGE);
  });

  it('成功后发一封告知信', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow());
    await changePassword(7, 'old one', NEW_PASSWORD);
    expect(emailSpies.sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
  });

  it('告知信发不出去不影响改密结果', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow());
    emailSpies.sendPasswordChangedEmail.mockResolvedValue(false);
    await expect(changePassword(7, 'old one', NEW_PASSWORD)).resolves.toHaveProperty('token');
  });
});

describe('🔴 J13 的第二半：`tokenVersion` +1 之后必须把认证缓存踢掉', () => {
  /**
   * `verifyToken` 命中 `authCache` 时**根本不查库**，而缓存条目里存的就是
   * `tokenVersion`。所以"我在库里把计数器 +1 了"与"旧设备被登出了"之间
   * 隔着这个内存对象：漏掉 `invalidate` 的话，那条 JWT 在 TTL（30 s）内
   * 仍然被判定有效 —— 而**没有任何一层会报错**，日志还会写"all sessions revoked"。
   *
   * 这条判据的形状与 `auth.ts` 里 `revokeAllTokens` 的一致：写**前后各一次**
   * （中间那次并发 `verify` 会把旧版本回填进缓存，只写后面一次挡不住它）。
   */
  const invalidatedIds = () => cacheSpies.invalidate.mock.calls.map((c) => c[0] as number);

  it('重置：消费成功 ⇒ 至少两次失效，且都是这个人的 id', async () => {
    mocks.user.findFirst.mockResolvedValue({
      id: 7,
      email: EMAIL,
      resetPasswordTokenExpiresAt: BigInt(Date.now() + 60_000),
    });
    await resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD });
    expect(invalidatedIds()).toEqual([7, 7]);
  });

  it('重置：链接无效时**不**碰缓存（没发生写，就不该有失效动作）', async () => {
    mocks.user.findFirst.mockResolvedValue(null);
    await capture(resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD }));
    expect(cacheSpies.invalidate).not.toHaveBeenCalled();
  });

  it('改密：写前写后各一次', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow());
    await changePassword(7, 'old one', NEW_PASSWORD);
    expect(invalidatedIds()).toEqual([7, 7]);
  });

  it('🔴 改密当前口令错 ⇒ 不碰缓存（那次 bump 没发生，踢了等于替攻击者做事）', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow());
    hashSpies.verifyPassword.mockResolvedValue(false);
    await capture(changePassword(7, 'wrong', NEW_PASSWORD));
    expect(cacheSpies.invalidate).not.toHaveBeenCalled();
  });
});

describe('🔴 J13 的第三半：计数器 +1 只管得住下一次 HTTP 请求，实时通道与会话行要各自撤', () => {
  /**
   * 这一组钉的是"全设备登出"里**最不可见**的那一半。三条既有事实叠在一起：
   *
   * 1. `auth.ts` 里 `TOKEN_REVOKED` 的注释把"改密 / 换绑 / 管理员强制登出 / passkey 恢复"
   *    **都**算作撤销事件 —— 也就是这个仓库自己承认这些是撤销。
   * 2. WebSocket 通道只在 **upgrade** 时鉴权，之后靠心跳维持（`closeForUser` 上的原话：
   *    "without this a revoked device would keep receiving op notifications indefinitely"）。
   * 3. 计数器 +1 对**已经开着**的通道一个字都不做。
   *
   * ⇒ 只写计数器的实现，症状是：旧设备每次 HTTP 都 401，界面上写着"已登出"，
   * 而那个页面**继续实时收这个账号的 op**。对端到端加密的产品，这是"把别人踢下线"没做成。
   *
   * ⚠️ 会话行那一半（`deleteMany`）不是第二个功能的装饰：`listSessions` 已经按
   * `tokenVersion` 过滤，所以**列表不会说谎**；删行是把"当场已知死掉"的身份元数据
   * 从 365 天的留存里拿出来（`credential-sweep` 的 `SESSION_ROW_RETENTION_MS`）。
   */
  const closedFor = () => wsSpies.closeForUser.mock.calls.map((c) => c[0] as number);
  const deletedWhere = () => whereOf(mocks.accessSession.deleteMany.mock.calls[0]?.[0]);

  /** `deleteMany`（撤旧行）与 `create`（铸当前设备那一行）谁先发生。 */
  const deleteBeforeCreate = () =>
    mocks.accessSession.deleteMany.mock.invocationCallOrder[0] <
    mocks.accessSession.create.mock.invocationCallOrder[0];

  it('重置成功 ⇒ 关掉全部实时通道，并把这个人所有会话行删掉', async () => {
    mocks.user.findFirst.mockResolvedValue({
      id: 7,
      email: EMAIL,
      resetPasswordTokenExpiresAt: BigInt(Date.now() + 60_000),
    });
    await resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD });

    expect(closedFor()).toEqual([7]);
    // 🔴 删的是**这个人的全部**，不是按 `jtiHash` 删一枚 —— 按一枚删是"退出这一台"的动作。
    expect(deletedWhere()).toEqual({ userId: 7 });
  });

  it('改密成功 ⇒ 同样撤通道与行，且删行排在铸新行**之前**', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow());
    await changePassword(7, 'old one', NEW_PASSWORD);

    expect(closedFor()).toEqual([7]);
    expect(deletedWhere()).toEqual({ userId: 7 });
    // 🔴 顺序判据：这一句排到 `issueSession` 后面，就会把刚发给当前设备的那一行一起删掉，
    // 于是"当前设备不掉线"变成"当前设备从「登录设备」列表里消失"。
    // 两种写法的功能断言（撤了几枚、关没关）全都能过 —— 只有顺序看得出这一刀。
    expect(mocks.accessSession.create).toHaveBeenCalled();
    expect(deleteBeforeCreate()).toBe(true);
  });

  it('🔴 链接无效 ⇒ 不关通道、不删行（一条死链接不该是一次远程断线）', async () => {
    mocks.user.findFirst.mockResolvedValue(null);
    await capture(resetPasswordWithToken({ token: LIVE_TOKEN, password: NEW_PASSWORD }));

    expect(wsSpies.closeForUser).not.toHaveBeenCalled();
    expect(mocks.accessSession.deleteMany).not.toHaveBeenCalled();
  });

  it('🔴 当前口令错 ⇒ 不关通道、不删行（那次 bump 没发生，替攻击者断线就是替他做事）', async () => {
    mocks.user.findUnique.mockResolvedValue(passwordRow());
    hashSpies.verifyPassword.mockResolvedValue(false);
    await capture(changePassword(7, 'wrong', NEW_PASSWORD));

    expect(wsSpies.closeForUser).not.toHaveBeenCalled();
    expect(mocks.accessSession.deleteMany).not.toHaveBeenCalled();
  });
});

/** 把"必须抛错"的调用变成值，好让多条路径共用同一组逐字比较断言。 */async function capture(promise: Promise<unknown>): Promise<PasswordAuthError> {
  try {
    await promise;
  } catch (err) {
    return err as PasswordAuthError;
  }
  throw new Error('期望抛出 PasswordAuthError，结果成功了');
}
