import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * **换绑登录邮箱**的服务端核心（工单 W1，裁决在 [ADR-0063](../../docs/adr/0063-email-rebinding-and-per-session-revocation.md) §2.1–§2.4）。
 *
 * 🔴 这里的数据层是一个**有状态的内存假库**，不是 `vi.fn()` 的调用记录仪。
 * 理由就在这两组判据的名字里：J-W1a 要断的是"`users.email` **一字不变**"、J-W1b 要断的是
 * "**恰好**生效一次"。调用记录仪分不出这两件事 —— 它只能回答"`update` 被调了几次"，
 * 而"调了一次但写的是别的值""该调却没调""并发下两个人各调一次"在它眼里长得一样。
 * 只有状态机有资格判状态。
 *
 * ## 这一组要挡的五类坏实现
 *
 * 1. 🔴 **单边生效**。换绑的整条立场是"两边都点才算"（旧邮箱是这个账号唯一的找回通道；
 *    只通知不要求点击 = 一个持有会话又控制着新邮箱的人可以把找回通道换走）。
 *    症状最轻的版本是"只点一边就把 email 改了"，最重的是"改了、还发了会话"。
 * 2. 🔴 **库里躺明文凭证**。形状检查抓不住这一条：明文那 64 个 hex 与哈希那 64 个 hex
 *    在 `toMatch(/^[0-9a-f]{64}$/)` 下**完全一样**。所以必须做**两个出口对照**
 *    ——「发进邮件的那句话」的 SHA-256 是不是就是落进那一列的值（W2 立下的判据形状）。
 * 3. **限流把第一封信变成死链接**。冷却窗口内的正确行为是**一个字节都不动**；
 *    写成"重新签发一对令牌"的话，用户手上第一封信当场点不通，而界面告诉他"已经在进行中"。
 * 4. **发信失败留下活凭证**：库里那张请求没有邮件携带 ⇒ 用户看不到、点不了，
 *    却占着 `pending_email` 的唯一索引，让他连"换一个地址再试"都做不到。
 * 5. 🔴 **反枚举**：查不到 / 已过期 / 已被撤销 / 令牌属于上一张请求，
 *    几种情况**同一个码同一句话**。`confirm` 是那八条路由里唯一不要 Bearer 的那条，
 *    所以它是邮箱之外唯一能被外部试探的出口。
 *
 * ⚠️ 全程不碰数据库。迁移本身（`user_id` 主键、`pending_email` 唯一、级联删除）的证据在
 * `email-change-schema.pglite.spec.ts`，HTTP 层的鉴权边界在 `account-security.routes.spec.ts`，
 * 三件事不许互相冒充。
 */

// 必须在 `../src/auth` 那条导入链之前设好（`getJwtSecret()` 跑在模块顶层）。
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

const emailSpies = vi.hoisted(() => ({
  sendEmailChangeAuthorizeEmail: vi.fn(),
  sendEmailChangeConfirmEmail: vi.fn(),
  sendEmailChangedEmail: vi.fn(),
}));

const cacheSpies = vi.hoisted(() => ({ invalidate: vi.fn() }));

const spiedLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  audit: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../src/logger', () => ({ Logger: spiedLogger }));
vi.mock('../src/auth-cache', () => ({ authCache: cacheSpies }));
vi.mock('../src/email', () => emailSpies);
/**
 * 实时通道的间谍。它**本身就是判据**（同 `password-recovery.spec.ts` 里 `authCache` 那一个）：
 * 通道只在 upgrade 时鉴权，所以只 bump 计数器时，旧设备**已经开着的那个页面**继续收 op，
 * 而这一族的 JWT 里还带着**上一个**地址。
 */
const wsSpies = vi.hoisted(() => ({ closeForUser: vi.fn() }));
vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => wsSpies,
}));

/**
 * 🔴 让那两枚令牌**可预期**：`randomBytes(32)` 在这条流程里每被调用一次，就轮换一格，
 * 于是"发起"得到的永远是这两句固定的 hex。
 *
 * 这不是为了少写几行。它让"库里那一列 = 发出去那句的哈希"这条判据可以**逐字节写死**
 * （`hashToken(OLD_LINK)`），也才让下面那条"重发之后，旧链接不许确认新请求"有资格存在 ——
 * 那一条要的是"手上这枚链接的哈希**不在**当前那一行里"，随机令牌下造不出这个状态。
 *
 * 其余长度（比如别处要 16 字节）仍走真实实现，本文件不关心它们的值。
 */
const deterministicRandomBytes = vi.hoisted(() => {
  const links = ['d'.repeat(64), 'e'.repeat(64)];
  let index = 0;
  return (size: number): Buffer | null =>
    size === 32 ? Buffer.from(links[index++ % links.length], 'hex') : null;
});

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: (size: number): Buffer => {
      const seeded = deterministicRandomBytes(size);
      return seeded ?? actual.randomBytes(size);
    },
  };
});

const OLD_EMAIL_NORMALIZED = 'old.user@example.test';
const OLD_EMAIL_RAW = 'Old.User@Example.test';
const NEW_EMAIL = 'new.user@example.test';
/** 邮件里那两句话（256 bit 随机值的 hex）。测试用固定值，好做出口对照。 */
const OLD_LINK = 'd'.repeat(64);
const NEW_LINK = 'e'.repeat(64);

interface TestUser {
  id: number;
  email: string;
  isVerified: number;
  tokenVersion: number;
  resetPasswordToken: string | null;
  resetPasswordTokenExpiresAt: bigint | null;
  loginToken: string | null;
  loginTokenExpiresAt: bigint | null;
}

interface TestRequest {
  userId: number;
  pendingEmail: string;
  oldToken: string | null;
  newToken: string | null;
  oldExpiresAt: bigint | null;
  newExpiresAt: bigint | null;
  oldConfirmedAt: bigint | null;
  newConfirmedAt: bigint | null;
  requestedAt: bigint;
  lastSentAt: bigint;
  resendCount: number;
}

/** `access_sessions` 的一行。换绑生效那一步要删的就是这些行。 */
interface TestSession {
  jtiHash: string;
  userId: number;
  tokenVersion: number;
}

/**
 * ── 有状态的内存假库 ──────────────────────────────────────────────
 *
 * 🔴 整块住在 `vi.hoisted` 里：`vi.mock('../src/db', …)` 的工厂在**被测模块被 import 的
 * 那一瞬间**就要拿到这个对象，而模块体里的 `const` 那时还没初始化（TDZ）。
 * 与 `password-recovery.spec.ts` 的 `mocks` 同一个理由，只是这里需要的不是一组空 `vi.fn()`，
 * 是一台状态机。
 */
const fake = vi.hoisted(() => {
  const state: {
    users: Map<number, TestUser>;
    requests: Map<number, TestRequest>;
    sessions: Map<string, TestSession>;
  } = { users: new Map(), requests: new Map(), sessions: new Map() };

  const project = (
    row: Record<string, unknown> | null | undefined,
    select?: Record<string, boolean>,
  ): Record<string, unknown> | null => {
    if (row === null || row === undefined) return null;
    if (!select) return { ...row };
    return Object.fromEntries(
      Object.entries(select)
        .filter(([, on]) => on)
        // 🔴 `undefined` 一律读成 `null`：Prisma 里一列可空字段的取值是 null，不是"没有这个键"。
        // 假库把"没写过的键"漏成 undefined，`oldConfirmedAt === null` 就会读成 false，
        // 于是这条判据在**假库**的红/绿与在产品里没关系（实测：`awaitingOld` 恒 false）。
        .map(([key]) => [key, row[key] === undefined ? null : row[key]]),
    );
  };

  /**
   * 只实现这条流程真正用到的那些谓词形状：标量相等、`= null`、`{ not: null }`、`OR`。
   * 其余形状由下面的 `unknownKey` 响亮拒绝 —— 静宽容是假绿的标准来源。
   */
  const matches = (row: object, where: Record<string, unknown>): boolean => {
    const candidate = row as Record<string, unknown>;
    if (where.OR !== undefined) {
      return (where.OR as Array<Record<string, unknown>>).some((alt) => matches(row, alt));
    }
    for (const [key, condition] of Object.entries(where)) {
      // 库里读出来的一行**每列都在**（可空列是 null，不是缺键），所以缺键按 null 处理。
      const value = candidate[key] ?? null;
      if (condition === null) {
        if (value !== null) return false;
        continue;
      }
      if (typeof condition === 'object' && condition !== null && 'not' in condition) {
        const not = (condition as { not: unknown }).not;
        if (not === null && (value === null || value === undefined)) return false;
        if (not !== null && value === not) return false;
        continue;
      }
      if (value !== condition) return false;
    }
    return true;
  };

  /** `{ increment: n }` 与直接赋值；BigInt 保持 BigInt（`BigInt + 1` 会退化成 number）。 */
  const applyData = (row: Record<string, unknown>, data: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(data)) {
      const current = row[key];
      if (value !== null && typeof value === 'object' && 'increment' in value) {
        const delta = Number((value as { increment: number }).increment);
        const base = Number(current ?? 0);
        row[key] = typeof current === 'bigint' ? BigInt(base + delta) : base + delta;
      } else {
        row[key] = value;
      }
    }
  };

  const uniqueViolation = (target: string): Error =>
    new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target },
    });

  /** `users.email` 的唯一索引：换绑生效那一步要过的就是它。 */
  const assertEmailFree = (email: string, selfId: number): void => {
    for (const user of state.users.values()) {
      if (user.id !== selfId && user.email === email) throw uniqueViolation('users.email');
    }
  };

  const assertPendingEmailFree = (pendingEmail: string, selfUserId: number): void => {
    for (const request of state.requests.values()) {
      if (request.userId !== selfUserId && request.pendingEmail === pendingEmail) {
        throw uniqueViolation('email_change_requests.pending_email');
      }
    }
  };

  const allRequests = (where: Record<string, unknown>): TestRequest[] =>
    [...state.requests.values()].filter((row) => matches(row, where));

  const emailChangeRequest = {
    findUnique: vi.fn(async ({ where, select }: any) =>
      project(allRequests(where)[0] ?? null, select),
    ),
    findFirst: vi.fn(async ({ where, select }: any) =>
      project(allRequests(where)[0] ?? null, select),
    ),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = allRequests(where);
      for (const row of rows) applyData(row as unknown as Record<string, unknown>, data);
      return { count: rows.length };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const rows = allRequests(where);
      for (const row of rows) state.requests.delete(row.userId);
      return { count: rows.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = allRequests(where)[0];
      if (existing) {
        // 唯一索引对**更新**同样生效：把这一行改成别人占着的地址一样要撞。
        assertPendingEmailFree(update.pendingEmail ?? existing.pendingEmail, existing.userId);
        applyData(existing as unknown as Record<string, unknown>, update);
        return { ...existing };
      }
      assertPendingEmailFree(create.pendingEmail, create.userId);
      // 建行时补齐所有可空列 —— 真库里读出来**每列都在**（缺键会让 `toBeNull()` 读到 undefined）。
      const created: TestRequest = {
        oldToken: null,
        newToken: null,
        oldExpiresAt: null,
        newExpiresAt: null,
        oldConfirmedAt: null,
        newConfirmedAt: null,
        requestedAt: BigInt(0),
        lastSentAt: BigInt(0),
        resendCount: 0,
        ...create,
      };
      state.requests.set(created.userId, created);
      return { ...created };
    }),
  };

  const user = {
    findUnique: vi.fn(async ({ where, select }: any) => {
      const row =
        where.id !== undefined
          ? state.users.get(where.id)
          : [...state.users.values()].find((candidate) => candidate.email === where.email);
      return project((row ?? null) as Record<string, unknown> | null, select);
    }),
    findUniqueOrThrow: vi.fn(async ({ where, select }: any) => {
      const row = state.users.get(where.id);
      if (!row) throw new Error(`Record not found on 'users' where ${JSON.stringify(where)}`);
      return project(row as unknown as Record<string, unknown>, select);
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const row = state.users.get(where.id);
      if (!row) throw new Error(`Record not found on 'users' where ${JSON.stringify(where)}`);
      if (typeof data.email === 'string') assertEmailFree(data.email, row.id);
      applyData(row as unknown as Record<string, unknown>, data);
      return project(row as unknown as Record<string, unknown>, select);
    }),
  };

  const allSessions = (where: Record<string, unknown>): TestSession[] =>
    [...state.sessions.values()].filter((row) => matches(row, where));

  /**
   * `access_sessions` 的假表。它在这里**有状态**，因为下面那条判据断的是
   * "换绑生效之后这个人的会话行**真的没了**"—— 调用记录仪只能回答"deleteMany 被调过"，
   * 而那对一个漏删的实现同样绿。
   */
  const accessSession = {
    create: vi.fn(async ({ data }: any) => {
      state.sessions.set(data.jtiHash, {
        jtiHash: data.jtiHash,
        userId: data.userId,
        tokenVersion: data.tokenVersion,
      });
      return { ...data };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const rows = allSessions(where);
      for (const row of rows) state.sessions.delete(row.jtiHash);
      return { count: rows.length };
    }),
  };

  const sessionsOf = (userId: number): TestSession[] =>
    [...state.sessions.values()].filter((row) => row.userId === userId);

  const prisma = {
    user,
    emailChangeRequest,
    accessSession,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ user, emailChangeRequest, accessSession }),
    ),
  };

  return { state, prisma, user, emailChangeRequest, accessSession, sessionsOf, uniqueViolation };
});

vi.mock('../src/db', () => ({ prisma: fake.prisma }));

import { hashToken } from '../src/auth-tokens';
import {
  EMAIL_CHANGE_APPLIED_MESSAGE,
  EMAIL_CHANGE_CONFIRMED_MESSAGE,
  EMAIL_CHANGE_REQUESTED_MESSAGE,
  EMAIL_CHANGE_TTL_MS,
  EmailChangeError,
  cancelEmailChange,
  confirmEmailChange,
  getEmailChangeStatus,
  requestEmailChange,
} from '../src/account/email-change';

const baseUser = (overrides: Partial<TestUser> = {}): TestUser => ({
  id: 7,
  email: OLD_EMAIL_NORMALIZED,
  isVerified: 1,
  tokenVersion: 3,
  resetPasswordToken: null,
  resetPasswordTokenExpiresAt: null,
  loginToken: null,
  loginTokenExpiresAt: null,
  ...overrides,
});

const baseRequest = (overrides: Partial<TestRequest> = {}): TestRequest => ({
  userId: 7,
  pendingEmail: NEW_EMAIL,
  oldToken: hashToken(OLD_LINK),
  newToken: hashToken(NEW_LINK),
  oldExpiresAt: BigInt(Date.now() + EMAIL_CHANGE_TTL_MS),
  newExpiresAt: BigInt(Date.now() + EMAIL_CHANGE_TTL_MS),
  oldConfirmedAt: null,
  newConfirmedAt: null,
  requestedAt: BigInt(Date.now()),
  lastSentAt: BigInt(Date.now()),
  resendCount: 0,
  ...overrides,
});

const capture = async (promise: Promise<unknown>): Promise<EmailChangeError> => {
  try {
    await promise;
  } catch (err) {
    return err as EmailChangeError;
  }
  throw new Error('期望抛出 EmailChangeError，结果成功了');
};

/** 取出发信层收到的那句（参数表是 `[收件人, 令牌, 待绑地址?, locale?]`）。 */
const mailed = (spy: ReturnType<typeof vi.fn>, call: number, arg: number): unknown =>
  spy.mock.calls[call]?.[arg];

beforeEach(() => {
  vi.clearAllMocks();
  fake.state.users = new Map([[7, baseUser()]]);
  fake.state.requests = new Map();
  // 两台已登录设备 = 两行会话，`tokenVersion` 用账号上那个（3）⇒ 生效前它们在列表里是活的。
  fake.state.sessions = new Map([
    ['a'.repeat(64), { jtiHash: 'a'.repeat(64), userId: 7, tokenVersion: 3 }],
    ['b'.repeat(64), { jtiHash: 'b'.repeat(64), userId: 7, tokenVersion: 3 }],
  ]);
  emailSpies.sendEmailChangeAuthorizeEmail.mockResolvedValue(true);
  emailSpies.sendEmailChangeConfirmEmail.mockResolvedValue(true);
  emailSpies.sendEmailChangedEmail.mockResolvedValue(true);
});

describe('requestEmailChange：一次发起，两封信', () => {
  it('🔴 J-W1c 两个出口对照：**邮件里那两句**的 SHA-256 == 落进那两列的值', async () => {
    const result = await requestEmailChange({ userId: 7, newEmail: NEW_EMAIL });

    expect(result.message).toBe(EMAIL_CHANGE_REQUESTED_MESSAGE);
    expect(emailSpies.sendEmailChangeAuthorizeEmail).toHaveBeenCalledTimes(1);
    expect(emailSpies.sendEmailChangeConfirmEmail).toHaveBeenCalledTimes(1);

    const row = fake.state.requests.get(7);
    expect(row).toBeDefined();
    // 旧邮箱那一侧的收件人是**当前地址**（不是待绑地址），且是归一化后的形态。
    expect(mailed(emailSpies.sendEmailChangeAuthorizeEmail, 0, 0)).toBe(OLD_EMAIL_NORMALIZED);
    expect(mailed(emailSpies.sendEmailChangeConfirmEmail, 0, 0)).toBe(NEW_EMAIL);

    const mailedOld = mailed(emailSpies.sendEmailChangeAuthorizeEmail, 0, 1) as string;
    const mailedNew = mailed(emailSpies.sendEmailChangeConfirmEmail, 0, 1) as string;
    // 发出去的是随机 hex，不是那枚哈希本身。
    expect(mailedOld).toMatch(/^[0-9a-f]{64}$/);
    expect(mailedNew).toMatch(/^[0-9a-f]{64}$/);
    expect(mailedOld).not.toBe(mailedNew);

    // 🔴 这一刀才是"存哈希"这条立场的落地判据。形状断言挡不住明文（两者都是 64 个 hex）：
    // 把 `hashToken` 摘掉这里红；把发信那句换成别的值（写了另一枚令牌进库）这里也红。
    // 令牌在本夹具里是固定的（上面那个 `node:crypto` mock），所以能逐字节写死。
    expect(mailedOld).toBe(OLD_LINK);
    expect(mailedNew).toBe(NEW_LINK);
    expect(row?.oldToken).toBe(hashToken(OLD_LINK));
    expect(row?.newToken).toBe(hashToken(NEW_LINK));
    expect(row?.oldToken).not.toBe(mailedOld);
    expect(row?.newToken).not.toBe(mailedNew);
    // 第二封信的收件人与正文里的待绑地址必须是同一个值（正文里那句"你要换成的是 X"）。
    expect(mailed(emailSpies.sendEmailChangeAuthorizeEmail, 0, 2)).toBe(NEW_EMAIL);
  });

  it('待绑地址写进库里时已经归一化（`pending_email` 与 `users.email` 必须同一口径）', async () => {
    await requestEmailChange({ userId: 7, newEmail: `  ${NEW_EMAIL.toUpperCase()}  ` });
    expect(fake.state.requests.get(7)?.pendingEmail).toBe(NEW_EMAIL);
    expect(mailed(emailSpies.sendEmailChangeConfirmEmail, 0, 0)).toBe(NEW_EMAIL);
  });

  it('同一个地址（只差大小写/空格）⇒ `email_unchanged`，无写无发信', async () => {
    const err = await capture(
      requestEmailChange({ userId: 7, newEmail: `  ${OLD_EMAIL_RAW.toUpperCase()}  ` }),
    );
    expect(err.code).toBe('email_unchanged');
    expect(fake.state.requests.size).toBe(0);
    expect(emailSpies.sendEmailChangeConfirmEmail).not.toHaveBeenCalled();
  });

  it('🔴 去重判断**在签发令牌之前**：被占用的地址不留下任何活请求', async () => {
    fake.state.users.set(8, baseUser({ id: 8, email: NEW_EMAIL }));
    const err = await capture(requestEmailChange({ userId: 7, newEmail: NEW_EMAIL }));

    expect(err.code).toBe('email_taken');
    expect(fake.state.requests.size).toBe(0);
    expect(emailSpies.sendEmailChangeAuthorizeEmail).not.toHaveBeenCalled();
    expect(emailSpies.sendEmailChangeConfirmEmail).not.toHaveBeenCalled();
  });

  it('🔴 地址被别人的**在途请求**占着 ⇒ 同一个 `email_taken`，不是 500', async () => {
    // `users.email` 里查不到那个地址（还没生效），但 `pending_email` 的唯一索引会拒。
    // 少了这道预检，这个人收到的是一个**没有稳定码**的 HTTP 500。
    fake.state.users.set(8, baseUser({ id: 8, email: 'someone.else@example.test' }));
    fake.state.requests.set(8, baseRequest({ userId: 8 }));

    const err = await capture(requestEmailChange({ userId: 7, newEmail: NEW_EMAIL }));
    expect(err.code).toBe('email_taken');
    expect(err.message).toBe('Another account is already using that email address.');
    // 预检早退 ⇒ 连 upsert 都不该发生。
    expect(fake.emailChangeRequest.upsert).not.toHaveBeenCalled();
  });

  it('🔴 预检与写之间挤进来一个（TOCTOU）⇒ 唯一索引兜住，仍是 `email_taken`', async () => {
    fake.emailChangeRequest.upsert.mockImplementationOnce(async () => {
      throw fake.uniqueViolation('email_change_requests.pending_email');
    });
    const err = await capture(requestEmailChange({ userId: 7, newEmail: NEW_EMAIL }));
    expect(err.code).toBe('email_taken');
    // 不是这张请求的拥有者却发出去两封信 = 两个收件箱里躺着点不通的链接。
    expect(emailSpies.sendEmailChangeAuthorizeEmail).not.toHaveBeenCalled();
    expect(emailSpies.sendEmailChangeConfirmEmail).not.toHaveBeenCalled();
  });

  it('当前邮箱未验证 ⇒ `email_not_verified`，无写无发信', async () => {
    fake.state.users.set(7, baseUser({ isVerified: 0 }));
    const err = await capture(requestEmailChange({ userId: 7, newEmail: NEW_EMAIL }));
    expect(err.code).toBe('email_not_verified');
    expect(fake.state.requests.size).toBe(0);
  });

  it('🔴 J-W1e 冷却窗口内：那一行**一个字节都不动**（第一封信仍然点得通）', async () => {
    const first = await requestEmailChange({ userId: 7, newEmail: NEW_EMAIL });
    const snapshot = { ...fake.state.requests.get(7)! };

    const err = await capture(requestEmailChange({ userId: 7, newEmail: NEW_EMAIL }));

    expect(err.code).toBe('email_change_cooldown');
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(fake.state.requests.get(7)).toEqual(snapshot);
    // 只发了一轮信：第二次连一封都不许发。
    expect(emailSpies.sendEmailChangeConfirmEmail).toHaveBeenCalledTimes(1);
    expect(first.resendAvailableAt).toBeGreaterThan(Date.now());
  });

  it('🔴 J-W1f 任一封发不出去 ⇒ 整张请求撤掉（库里不留没有邮件携带的活凭证）', async () => {
    emailSpies.sendEmailChangeConfirmEmail.mockResolvedValue(false);

    const err = await capture(requestEmailChange({ userId: 7, newEmail: NEW_EMAIL }));

    expect(err.code).toBe('invalid_change_link');
    // 不是"清掉失败那一侧的令牌"，是整张撤掉：留着另一侧就还占着唯一索引，
    // 用户连换一个地址再试都做不到。
    expect(fake.state.requests.size).toBe(0);
    expect(spiedLogger.error).toHaveBeenCalled();
  });

  it('重新发起（冷却窗口已过）⇒ 令牌整对轮换、两边的确认都清零', async () => {
    fake.state.requests.set(
      7,
      baseRequest({
        lastSentAt: BigInt(Date.now() - EMAIL_CHANGE_TTL_MS - 1000),
        requestedAt: BigInt(Date.now() - EMAIL_CHANGE_TTL_MS - 1000),
        oldConfirmedAt: BigInt(1),
        newConfirmedAt: BigInt(1),
      }),
    );

    await requestEmailChange({ userId: 7, newEmail: NEW_EMAIL });

    const row = fake.state.requests.get(7)!;
    expect(row.oldToken).toBe(
      hashToken(mailed(emailSpies.sendEmailChangeAuthorizeEmail, 0, 1) as string),
    );
    expect(row.newToken).toBe(
      hashToken(mailed(emailSpies.sendEmailChangeConfirmEmail, 0, 1) as string),
    );
    expect(row.oldConfirmedAt).toBeNull();
    expect(row.newConfirmedAt).toBeNull();
    expect(row.resendCount).toBe(1);
  });

  it('账号行不存在（令牌指向的人已被删）⇒ 响亮地抛，不静默造出一张孤儿请求', async () => {
    fake.state.users.delete(7);
    await expect(requestEmailChange({ userId: 7, newEmail: NEW_EMAIL })).rejects.toThrow();
    expect(fake.state.requests.size).toBe(0);
  });
});

describe('confirmEmailChange：两边都点才生效', () => {
  /**
   * 起一张活请求。先删掉上一张是因为下面那几条判据关心的是**这张新请求**的状态，
   * 而"上一张还在冷却窗口里就不许再发"那一格由 request 组的 J-W1e 单独钉 ——
   * 两条判据各测各的，混在一条用例里就分不出红的是哪一个。
   */
  const start = async (): Promise<void> => {
    fake.state.requests.delete(7);
    await requestEmailChange({ userId: 7, newEmail: NEW_EMAIL });
  };

  it('🔴 J-W1a 只点一边 ⇒ `users.email` 一字不变、计数器不动、applied:false', async () => {
    await start();
    const before = { ...fake.state.users.get(7)! };

    const result = await confirmEmailChange(OLD_LINK);

    expect(result).toEqual({ message: EMAIL_CHANGE_CONFIRMED_MESSAGE, applied: false });
    expect(fake.state.users.get(7)).toEqual(before);
    expect(fake.state.requests.get(7)?.oldConfirmedAt).not.toBeNull();
    expect(fake.state.requests.get(7)?.newConfirmedAt).toBeNull();
    // 完成通知说的是"已经改成"—— 只点一边时发它就是谎。
    expect(emailSpies.sendEmailChangedEmail).not.toHaveBeenCalled();
  });

  it('🔴 J-W1b 两边都点 ⇒ 恰好生效一次：地址换成、已验证、计数器 +1、在途凭证清空', async () => {
    await start();
    fake.state.users.set(
      7,
      baseUser({ resetPasswordToken: 'a'.repeat(64), loginToken: 'b'.repeat(64) }),
    );

    await confirmEmailChange(OLD_LINK);
    const result = await confirmEmailChange(NEW_LINK);

    expect(result).toEqual({ message: EMAIL_CHANGE_APPLIED_MESSAGE, applied: true });
    const after = fake.state.users.get(7)!;
    expect(after.email).toBe(NEW_EMAIL);
    // 新地址是点开信的人证明过归属的 ⇒ 留在 0 会让他"换绑成功但登不进来"。
    expect(after.isVerified).toBe(1);
    // 🔴 J13 同族：JWT 的 payload 里带着 `email`，换绑之后每一枚在途令牌写的都是上一个地址。
    expect(after.tokenVersion).toBe(4);
    expect(after.resetPasswordToken).toBeNull();
    expect(after.loginToken).toBeNull();
    expect(fake.state.requests.size).toBe(0);
  });

  it('J-W1b 补：生效后再点同一枚链接 ⇒ `invalid_change_link`，**不会**第二次 +1', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);
    await confirmEmailChange(NEW_LINK);

    const err = await capture(confirmEmailChange(NEW_LINK));
    expect(err.code).toBe('invalid_change_link');
    expect(fake.state.users.get(7)!.tokenVersion).toBe(4);
    expect(emailSpies.sendEmailChangedEmail).toHaveBeenCalledTimes(2);
  });

  it('同一边点击两次（另一边的确认不丢）⇒ 第二次 `invalid_change_link`', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);

    const err = await capture(confirmEmailChange(OLD_LINK));
    expect(err.code).toBe('invalid_change_link');
    // 第一次的确认还在：他还能等另一边，而不必整个重来。
    expect(fake.state.requests.get(7)?.oldConfirmedAt).not.toBeNull();
    expect(fake.state.users.get(7)!.email).toBe(OLD_EMAIL_NORMALIZED);
  });

  it('🔴 J-W1b 的并发半边：另一边在你之前把生效做掉了 ⇒ 仍回 applied:true，且只 +1', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);

    // 模拟"另一个人同时点了最后一边"：在这个请求进事务删行之前，替它把整件事做完。
    // 只把返回值改成 `count: 0` 而什么都不做是不够的 —— 那只能证明"没写第二遍"，
    // 证明不了"读到的是别人写好的结果"。
    const original = fake.emailChangeRequest.deleteMany.getMockImplementation()!;
    let won = false;
    fake.emailChangeRequest.deleteMany.mockImplementation(async (args: any) => {
      const isApplyStep = (args.where as Record<string, unknown>).oldConfirmedAt !== undefined;
      if (isApplyStep && !won) {
        won = true;
        const row = fake.state.requests.get(7)!;
        fake.state.users.set(
          7,
          baseUser({ email: row.pendingEmail, tokenVersion: 4, isVerified: 1 }),
        );
        fake.state.requests.delete(7);
        return { count: 0 };
      }
      return (original as (a: unknown) => Promise<unknown>)(args);
    });

    const result = await confirmEmailChange(NEW_LINK);

    expect(result).toEqual({ message: EMAIL_CHANGE_APPLIED_MESSAGE, applied: true });
    // 🔴 恰好 4，不是 5：输的那个人**没有**再 bump 一次。
    expect(fake.state.users.get(7)!.tokenVersion).toBe(4);
    expect(fake.state.users.get(7)!.email).toBe(NEW_EMAIL);
    fake.emailChangeRequest.deleteMany.mockImplementation(original);
  });

  it('🔴 J-W1g 生效**不发会话** —— 返回值里没有 JWT，也没有用户对象', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);
    const result = await confirmEmailChange(NEW_LINK);

    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('user');
    expect(JSON.stringify(result)).not.toMatch(/eyJ/);
  });

  it('🔴 生效必须踢掉认证缓存：库里 +1 与"旧设备真的登出"之间隔着那 30 s', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);
    cacheSpies.invalidate.mockClear();

    await confirmEmailChange(NEW_LINK);
    expect(cacheSpies.invalidate).toHaveBeenCalledWith(7);
  });

  it('只点一边时**不**碰认证缓存（没有 bump，就没有该失效的东西）', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);
    expect(cacheSpies.invalidate).not.toHaveBeenCalled();
  });

  it('🔴 生效必须关掉全部实时通道并删掉会话行（计数器只管得住下一次 HTTP 请求）', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);
    wsSpies.closeForUser.mockClear();
    expect(fake.sessionsOf(7)).toHaveLength(2);

    await confirmEmailChange(NEW_LINK);
    // 通道那一半：实时通道只在 upgrade 时鉴权，不关掉时那个页面会带着**上一个地址**那枚令牌
    // 继续实时收这个账号的 op，而界面上写着"已登出"。
    expect(wsSpies.closeForUser).toHaveBeenCalledWith(7);
    // 库面那一半：`listSessions` 已经按 `tokenVersion` 过滤，所以**列表不会说谎**；
    // 这一条断的是"当场已知死掉的行"不再按 365 天留着（`credential-sweep` 的留存上界）。
    expect(fake.sessionsOf(7)).toHaveLength(0);
  });

  it('🔴 只点一边 ⇒ 不关通道、两行会话都还在（一枚没生效的申请不该让任何设备掉线）', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);
    expect(wsSpies.closeForUser).not.toHaveBeenCalled();
    expect(fake.sessionsOf(7)).toHaveLength(2);
  });

  it('生效给**两个**地址各发一封完成通知（旧地址那一封是"不是本人"的唯一知道方式）', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);
    await confirmEmailChange(NEW_LINK);

    const targets = emailSpies.sendEmailChangedEmail.mock.calls.map((c) => c[0]);
    expect([...targets].sort()).toEqual([NEW_EMAIL, OLD_EMAIL_NORMALIZED].sort());
    expect(spiedLogger.audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'EMAIL_CHANGED', userId: 7 }),
    );
  });

  it('完成通知发不出去**不能**把成功报成失败', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);
    emailSpies.sendEmailChangedEmail.mockResolvedValue(false);

    await expect(confirmEmailChange(NEW_LINK)).resolves.toEqual({
      message: EMAIL_CHANGE_APPLIED_MESSAGE,
      applied: true,
    });
    expect(fake.state.users.get(7)!.email).toBe(NEW_EMAIL);
    expect(spiedLogger.error).toHaveBeenCalled();
  });

  it('🔴 那个地址在两步之间被别的账号注册走了 ⇒ 与"链接无效"**同一句**，且整体回滚', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);

    // 让事务里那一步撞上唯一索引，正是那两步之间发生的事。
    fake.user.update.mockImplementationOnce(async () => {
      throw fake.uniqueViolation('users.email');
    });

    const err = await capture(confirmEmailChange(NEW_LINK));
    // 🔴 刻意**不是** `email_taken`。这一条路由不要 Bearer，而"这个地址已经有账号了"
    // 是一句账号存在性断言 —— 说出口就是给未认证的出口留枚举通道。
    // 那句可执行的实话留在**认证过的** `request` 那一侧（见上面 `email_taken` 那条用例）。
    expect(err.code).toBe('invalid_change_link');
    // 回滚 ⇒ 旧地址还在、计数器没动、确认还在（他可以换个地址重来）。
    expect(fake.state.users.get(7)!.email).toBe(OLD_EMAIL_NORMALIZED);
    expect(fake.state.users.get(7)!.tokenVersion).toBe(3);
    expect(cacheSpies.invalidate).not.toHaveBeenCalled();
    expect(emailSpies.sendEmailChangedEmail).not.toHaveBeenCalled();
    // 🔴 回滚那一趟**不许**留下撤线动作：事务回滚了，两行会话都还是活的、通道也不许关。
    // 症状是"这次换绑失败了，我自己的四台设备全被踢下线"。
    expect(wsSpies.closeForUser).not.toHaveBeenCalled();
    expect(fake.sessionsOf(7)).toHaveLength(2);
  });

  it('🔴 未认证的 `confirm` 不许说出任何账号存在性：四条失败路径同码同句', async () => {
    const failures: EmailChangeError[] = [];

    // ① 从没有过这枚令牌。
    failures.push(await capture(confirmEmailChange('f'.repeat(64))));

    // ② 已过期。
    await start();
    fake.state.requests.get(7)!.oldExpiresAt = BigInt(Date.now() - 1000);
    failures.push(await capture(confirmEmailChange(OLD_LINK)));

    // ③ 已被撤销。
    await start();
    await cancelEmailChange(7);
    failures.push(await capture(confirmEmailChange(OLD_LINK)));

    // ④ 那个地址被别的账号抢走了（唯一索引拒绝）—— 这一条是本轮新写的分支，
    // 也是最容易被顺手改成 `email_taken` 的那一条，所以它必须出现在**这一组**里。
    await start();
    await confirmEmailChange(OLD_LINK);
    fake.user.update.mockImplementationOnce(async () => {
      throw fake.uniqueViolation('users.email');
    });
    failures.push(await capture(confirmEmailChange(NEW_LINK)));

    for (const err of failures) {
      expect(err.code).toBe('invalid_change_link');
      // 措辞里不许出现"已有账号/被占用/存在"这类字样 —— 那是另一种通道。
      expect(err.message).not.toMatch(/account|taken|exist|register/i);
    }
  });

  it('🔴 J-W1h 查不到 / 已过期 / 已被撤销：三种都是**同一个码同一句话**', async () => {
    const never = await capture(confirmEmailChange('f'.repeat(64)));

    await start();
    fake.state.requests.get(7)!.oldExpiresAt = BigInt(Date.now() - 1000);
    const expired = await capture(confirmEmailChange(OLD_LINK));

    await start();
    await cancelEmailChange(7);
    const cancelled = await capture(confirmEmailChange(OLD_LINK));

    for (const err of [never, expired, cancelled]) {
      expect(err).toBeInstanceOf(EmailChangeError);
      expect(err.code).toBe('invalid_change_link');
      expect(err.message).toBe('That link is not valid. Start the change again from the app.');
    }
    expect(emailSpies.sendEmailChangedEmail).not.toHaveBeenCalled();
    expect(fake.state.users.get(7)!.email).toBe(OLD_EMAIL_NORMALIZED);
  });

  it('过期时当场清掉**这一边**，另一边与它的确认都不动', async () => {
    await start();
    await confirmEmailChange(NEW_LINK);
    fake.state.requests.get(7)!.oldExpiresAt = BigInt(Date.now() - 1000);

    await capture(confirmEmailChange(OLD_LINK));

    const after = fake.state.requests.get(7)!;
    expect(after.oldToken).toBeNull();
    expect(after.oldExpiresAt).toBeNull();
    expect(after.newToken).toBe(hashToken(NEW_LINK));
    expect(after.newConfirmedAt).not.toBeNull();
  });

  it('过期时间那一格是 null 也算过期（缺字段的行不能变成永久链接）', async () => {
    await start();
    fake.state.requests.get(7)!.newExpiresAt = null;
    const err = await capture(confirmEmailChange(NEW_LINK));
    expect(err.code).toBe('invalid_change_link');
  });

  it('🔴 重发之后，手上那枚**旧**链接不许去确认那张**新**请求', async () => {
    await start();
    const original = fake.emailChangeRequest.findFirst.getMockImplementation()!;
    // 在"按令牌找到行"与"落这一边的确认"之间，另一次发起把整对令牌换掉了。
    fake.emailChangeRequest.findFirst.mockImplementationOnce(async (args: any) => {
      const found = await (original as (a: unknown) => Promise<unknown>)(args);
      const row = fake.state.requests.get(7)!;
      row.oldToken = '0'.repeat(64);
      row.newToken = '1'.repeat(64);
      return found;
    });

    const err = await capture(confirmEmailChange(OLD_LINK));
    expect(err.code).toBe('invalid_change_link');
    // 🔴 少了 `where` 里那枚哈希，这里会把**新**请求的旧侧确认打上：
    // 新信里的链接点不通，而新请求却在替一枚旧链接干活。
    expect(fake.state.requests.get(7)!.oldConfirmedAt).toBeNull();
  });

  it('J-W1i 撤销之后两边再点都判 `invalid_change_link`', async () => {
    await start();
    await confirmEmailChange(OLD_LINK);
    await cancelEmailChange(7);

    for (const link of [OLD_LINK, NEW_LINK]) {
      const err = await capture(confirmEmailChange(link));
      expect(err.code).toBe('invalid_change_link');
    }
    expect(fake.state.users.get(7)!.email).toBe(OLD_EMAIL_NORMALIZED);
  });
});

describe('getEmailChangeStatus / cancelEmailChange', () => {
  it('没有活请求时老实说"没有"，但**仍然把账号当前的邮箱带回**', async () => {
    // 🔴 这一支是换绑**生效之后**界面上读到的那一发：活请求已经被删掉，
    // 而那一刻恰恰最需要真地址（不带回，界面会一直显示登录时记下的旧地址）。
    await expect(getEmailChangeStatus(7)).resolves.toEqual({
      pending: false,
      awaitingOld: false,
      awaitingNew: false,
      currentEmail: OLD_EMAIL_NORMALIZED,
    });
  });

  it('🔴 生效之后 `currentEmail` 就是**新**地址，而 `pendingEmail` 不再存在', async () => {
    await requestEmailChange({ userId: 7, newEmail: NEW_EMAIL });
    await confirmEmailChange(OLD_LINK);
    await confirmEmailChange(NEW_LINK);
    const after = await getEmailChangeStatus(7);
    expect(after).toEqual({ pending: false, awaitingOld: false, awaitingNew: false, currentEmail: NEW_EMAIL });
    expect('pendingEmail' in after).toBe(false);
  });

  it('活请求还在时两个地址**同时**在、且不相等（一个是现在的，一个是等着换上的）', async () => {
    await requestEmailChange({ userId: 7, newEmail: NEW_EMAIL });
    const status = await getEmailChangeStatus(7);
    expect(status.currentEmail).toBe(OLD_EMAIL_NORMALIZED);
    expect(status.pendingEmail).toBe(NEW_EMAIL);
    expect(status.currentEmail).not.toBe(status.pendingEmail);
  });

  it('账号行读不到 ⇒ **不带**这个键，而不是回一个空串或旧值（不编造）', async () => {
    fake.state.users.delete(7);
    const status = await getEmailChangeStatus(7);
    expect(status.pending).toBe(false);
    expect('currentEmail' in status).toBe(false);
  });

  it('界面上那句"还等哪一边"来自这里：单边确认后 awaiting 翻转', async () => {
    await requestEmailChange({ userId: 7, newEmail: NEW_EMAIL });
    const before = await getEmailChangeStatus(7);
    expect(before.pending).toBe(true);
    expect(before.awaitingOld).toBe(true);
    expect(before.awaitingNew).toBe(true);

    await confirmEmailChange(OLD_LINK);
    const after = await getEmailChangeStatus(7);
    expect(after.awaitingOld).toBe(false);
    expect(after.awaitingNew).toBe(true);
    expect(after.pendingEmail).toBe(NEW_EMAIL);
    // 过期时间由 TTL 常量推导，不是写死的一个数。
    expect(after.expiresAt).toBeGreaterThan(Date.now());
  });

  it('cancel 没有活请求时也回同一句（不区分"撤掉了"与"本来就没有"）', async () => {
    const a = await cancelEmailChange(7);
    const b = await cancelEmailChange(7);
    expect(a).toEqual(b);
    expect(fake.state.requests.size).toBe(0);
  });
});
