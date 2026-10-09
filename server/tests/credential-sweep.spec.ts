/**
 * 过期凭据清扫（`account/credential-sweep.ts`）的判据。
 *
 * 这一族存在的理由不是"代码没测"，而是**错法各不一样**：
 *
 * | 写错的样子 | 症状 | 哪条用例挡它 |
 *|---|---|---|
 *| 清扫条件里漏了"已过期" | 用户点邮件链接说"链接已过期"，而链接才发出去两分钟 | J-S1 |
 *| 四列配错对（清 `loginToken` 却把重置那列的时间置 null） | 令牌还在库里、时间没了 ⇒ 以后每一趟都看不见它，而那句"一次性"成了假话 | J-S2 |
 *| 只清 `users` 那四列，忘了换绑那行 | `pending_email` 那份**新邮箱明文**永久留在库与每晚备份里 | J-S3 / J-S4 |
 *| 会话行没有阈值或阈值拍脑袋 | 设备名与 UA 留多久变成一句没有依据的话 | J-S5 |
 *| 某一趟炸了就整条停 | 后面几列再也不会被扫 | **刻意不做局部吞掉**：整条抛出，由 `sync/cleanup.ts` 那一步的 try/catch 记一条响亮 error，下一趟日扫重来。这条形状由 J-S6 的另一半场钉住 —— 它要求每一格报告的都是各路**真正删掉的行数**，所以"为了绿而吞掉失败、把计数写成 0"会当场红（变异臂 `cs-7-sessions-unreported` 证明的就是这一半） |
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  /** 一行 `users`。列名用 Prisma 的 camelCase，值原样存着以便逐字段对账。 */
  type UserRow = Record<string, string | bigint | number | null>;
  const users: UserRow[] = [];
  const changeRequests: Array<Record<string, unknown>> = [];
  // 每一次 `updateMany` 都记下来：判据要看**配的那一对列名**，不是只看"被叫了几次"。
  const calls: Array<{ where: unknown; data: Record<string, unknown> }> = [];

  const matchesExpired = (where: unknown, row: UserRow): boolean => {
    const w = (where ?? {}) as Record<string, { not?: unknown; lt?: bigint }>;
    for (const [column, condition] of Object.entries(w)) {
      const value = row[column];
      if (condition.not === null && (value === null || value === undefined)) return false;
      if (condition.lt !== undefined) {
        if (value === null || value === undefined) return false;
        if (BigInt(value as bigint) >= condition.lt) return false;
      }
    }
    return true;
  };

  return {
    users,
    changeRequests,
    calls,
    prisma: {
      user: {
        updateMany: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
          calls.push({ where: args.where, data: args.data });
          let count = 0;
          for (const row of users) {
            if (!matchesExpired(args.where, row)) continue;
            for (const [column, value] of Object.entries(args.data)) row[column] = value;
            count += 1;
          }
          return { count };
        }),
      },
      emailChangeRequest: {
        deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
          const where = args.where as {
            AND?: Array<{ OR: Array<Record<string, unknown>> }>;
          };
          const before = changeRequests.length;
          // `where` 匹配的那一行就是**要被删**的那一行（真 Prisma 的语义）。
          // 写成反的会让 J-S3 / J-S4 一起反向通过 —— 那正是"两条用例互相抵消"的形状。
          const matchesDeletion = (row: Record<string, unknown>): boolean =>
            (where.AND ?? []).every((clause) =>
              clause.OR.some((condition) => {
                const [column, expected] = Object.entries(condition)[0] as [string, unknown];
                if (expected === null) return row[column] === null || row[column] === undefined;
                const bounds = expected as { lt?: bigint };
                if (bounds.lt !== undefined) {
                  const value = row[column];
                  return (
                    value !== null && value !== undefined && BigInt(value as bigint) < bounds.lt
                  );
                }
                return false;
              }),
            );
          for (let i = changeRequests.length - 1; i >= 0; i -= 1) {
            if (matchesDeletion(changeRequests[i]!)) changeRequests.splice(i, 1);
          }
          return { count: before - changeRequests.length };
        }),
      },
    },
  };
});

const sessionSpy = vi.hoisted(() => ({ deleteSessionsOlderThan: vi.fn().mockResolvedValue(3) }));

vi.mock('../src/db', () => ({ prisma: fake.prisma }));
vi.mock('../src/account/access-sessions', () => sessionSpy);

import {
  SESSION_ROW_RETENTION_MS,
  sweepExpiredAccountCredentials,
} from '../src/account/credential-sweep';

const NOW = 1_700_000_000_000;
const PAST = BigInt(NOW - 60_000);
const FUTURE = BigInt(NOW + 60_000);

const userRow = (overrides: Record<string, string | bigint | null> = {}): void => {
  fake.users.push({ id: fake.users.length + 1, ...overrides });
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.users.length = 0;
  fake.changeRequests.length = 0;
  fake.calls.length = 0;
  sessionSpy.deleteSessionsOlderThan.mockResolvedValue(3);
});

describe('过期凭据清扫', () => {
  it('J-S1 🔴 还没过期的那一格不许动（清掉等于把人关在刚发出的邮件里）', async () => {
    userRow({ resetPasswordToken: 'hash-live', resetPasswordTokenExpiresAt: FUTURE });
    userRow({ loginToken: 'hash-dead', loginTokenExpiresAt: PAST });

    const report = await sweepExpiredAccountCredentials(NOW);

    expect(report.resetTokens).toBe(0);
    expect(fake.users[0]).toMatchObject({
      resetPasswordToken: 'hash-live',
      resetPasswordTokenExpiresAt: FUTURE,
    });
    // 同一趟里过期那列必须真的被清 —— 否则"不许动未过期的"可以靠"什么都不动"作弊通过。
    expect(report.loginTokens).toBe(1);
    expect(fake.users[1]).toMatchObject({ loginToken: null, loginTokenExpiresAt: null });
  });

  it('J-S2 🔴 四列各清各的配对：令牌列与它的过期时刻必须在同一次写里成对出现', async () => {
    userRow({
      verificationToken: 'v',
      verificationTokenExpiresAt: PAST,
      resetPasswordToken: 'r',
      resetPasswordTokenExpiresAt: PAST,
      passkeyRecoveryToken: 'p',
      passkeyRecoveryTokenExpiresAt: PAST,
      loginToken: 'l',
      loginTokenExpiresAt: PAST,
    });

    const report = await sweepExpiredAccountCredentials(NOW);
    expect(report).toMatchObject({
      verificationTokens: 1,
      resetTokens: 1,
      recoveryTokens: 1,
      loginTokens: 1,
    });

    // 逐对钉：`{ loginToken: null, resetPasswordTokenExpiresAt: null }` 这种配错对的写法
    // 在这一条会红，而在"总数对不对"那种判据下永远是绿的（数出来一样是 4）。
    const pairs = fake.calls.map((call) => Object.keys(call.data).sort().join('+'));
    expect(new Set(pairs)).toEqual(
      new Set([
        'verificationToken+verificationTokenExpiresAt',
        'resetPasswordToken+resetPasswordTokenExpiresAt',
        'passkeyRecoveryToken+passkeyRecoveryTokenExpiresAt',
        'loginToken+loginTokenExpiresAt',
      ]),
    );
    // 条件里必须带着"这一列有值且已过期" —— 少了 `not: null`，每一趟都会给全表写 null。
    for (const call of fake.calls) {
      const conditions = Object.values(call.where as Record<string, Record<string, unknown>>);
      expect(conditions.length).toBe(1);
      expect(conditions[0]).toEqual({ not: null, lt: BigInt(NOW) });
    }
  });

  it('J-S3 换绑那行：只要还有**任何一边**在等，就不许删', async () => {
    fake.changeRequests.push({
      userId: 1,
      pendingEmail: 'new@example.com',
      oldToken: null,
      newToken: 'hash-live',
      oldExpiresAt: null,
      newExpiresAt: FUTURE,
    });
    // 镜像那一半：old 侧还在等、new 侧无人持有。只查 `new*` 一侧的实现会把它删掉，
    // 而用户手里那封"确认换绑"的旧邮箱链接会当场失效 —— 症状是"点了说链接已过期"。
    fake.changeRequests.push({
      userId: 1,
      pendingEmail: 'new@example.com',
      oldToken: 'hash-live',
      newToken: null,
      oldExpiresAt: FUTURE,
      newExpiresAt: null,
    });

    const report = await sweepExpiredAccountCredentials(NOW);

    expect(report.changeRequests).toBe(0);
    expect(fake.changeRequests).toHaveLength(2);
  });

  it('J-S4 两边都无人持有（过期或从未签发）⇒ 删掉，那份新邮箱明文跟着走', async () => {
    fake.changeRequests.push({
      userId: 2,
      pendingEmail: 'gone@example.com',
      oldToken: 'hash-dead',
      newToken: null,
      oldExpiresAt: PAST,
      newExpiresAt: null,
    });

    const report = await sweepExpiredAccountCredentials(NOW);

    expect(report.changeRequests).toBe(1);
    expect(fake.changeRequests).toHaveLength(0);
  });

  it('J-S5 会话行的阈值从 JWT 生命周期推导，不是拍一个数', async () => {
    await sweepExpiredAccountCredentials(NOW);

    expect(sessionSpy.deleteSessionsOlderThan).toHaveBeenCalledWith(NOW - SESSION_ROW_RETENTION_MS);
    // 阈值必须真的等于 365 天：`JWT_EXPIRY` 改成别的值时，这一条要红着提醒改这里。
    expect(SESSION_ROW_RETENTION_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it('J-S6 🔴 每一格报告的都是各路真正删掉的行数，0 也必须在场', async () => {
    // 三个非零 + 两个零。为什么两边都要：
    //  - **零要在场**：日志里"跑了但没活干"必须能与"根本没跑到"分开（`cleanup.ts` 同一条理由）。
    //  - **非零要原样**：只看"六个键都在"的判据，会把 `sessions` 写死成 0 也算通过 ——
    //    变异臂 `cs-7-sessions-unreported` 就是拿这个形状照出来的（第一版这条真的存活了）。
    //    同理，任何"吞掉一次失败、报 0 保平安"的写法都会在这里红，而那正是政策里
    //    "过期即失效"那句话被悄悄断供的样子。
    userRow({ verificationToken: 'v', verificationTokenExpiresAt: PAST });
    userRow({ loginToken: 'l', loginTokenExpiresAt: PAST });
    fake.changeRequests.push({
      oldToken: 'a',
      oldExpiresAt: PAST,
      oldConfirmedAt: null,
      newToken: 'b',
      newExpiresAt: PAST,
      newConfirmedAt: null,
    });
    sessionSpy.deleteSessionsOlderThan.mockResolvedValue(7);

    const report = await sweepExpiredAccountCredentials(NOW);

    expect(report).toEqual({
      verificationTokens: 1,
      resetTokens: 0,
      recoveryTokens: 0,
      loginTokens: 1,
      changeRequests: 1,
      sessions: 7,
    });
  });
});
