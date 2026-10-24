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
 *| 孤儿会话的判据写宽了（漏掉"未激活"或"无口令"或年龄） | 删掉一条**真会话** ⇒ 用户当场被登出，而且是"另一条刚登录的路发的"那一条 | J-S7 |
 *| 把候选**账号数**当成删掉的行数报出去 | 日志里那格数字永远说谎，"非 0 是信号"这个用法当场失效 | J-S8 |
 *| 某一趟炸了就整条停 | 后面几列再也不会被扫 | **刻意不做局部吞掉**：整条抛出，由 `sync/cleanup.ts` 那一步的 try/catch 记一条响亮 error，下一趟日扫重来。这条形状由 J-S6 的另一半场钉住 —— 它要求每一格报告的都是各路**真正删掉的行数**，所以"为了绿而吞掉失败、把计数写成 0"会当场红（变异臂 `cs-7-sessions-unreported` 证明的就是这一半） |
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  /** 一行 `users`。列名用 Prisma 的 camelCase，值原样存着以便逐字段对账。 */
  type UserRow = Record<string, string | bigint | number | null>;
  /** 一行 `access_sessions`：只留判据要看的三格（`createdAt` 在真库里是 `BigInt`）。 */
  type SessionRow = { jtiHash: string; userId: number; createdAt: bigint };
  const users: UserRow[] = [];
  const changeRequests: Array<Record<string, unknown>> = [];
  const accessSessions: SessionRow[] = [];
  // 每一次 `updateMany` 都记下来：判据要看**配的那一对列名**，不是只看"被叫了几次"。
  const calls: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  // 孤儿会话那两问的入参：判据要看的是"问得够窄、有界、阈值来自常量"，不是只看被叫过。
  const userFindManyArgs: Array<Record<string, unknown>> = [];
  const sessionDeleteArgs: Array<{ where: unknown }> = [];

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
    accessSessions,
    calls,
    userFindManyArgs,
    sessionDeleteArgs,
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
        /**
         * 只实现本文件需要的那一种 `where`：`{ isVerified: 0, passwordHash: null }`。
         *
         * 🔴 未知列**宁可炸**也不要静默放过 —— 一个"忽略不认识的条件的 fake"会让
         * "判据写得比实现宽"这一整类错误永远绿着（本仓 `environment-traps` 反复记的
         * "假实现比真实现宽松"就是这个形状）。
         *
         * 列没写 == `NULL`（`row[column] ?? null`）：现有几条用例的 `userRow()` 不写
         * `passwordHash`，在真库里那就是 NULL，假实现必须跟真库一样读它。
         */
        findMany: vi.fn(
          async (args: {
            where: Record<string, unknown>;
            select?: Record<string, boolean>;
            orderBy?: Record<string, 'asc' | 'desc'>;
            take?: number;
          }) => {
            userFindManyArgs.push(args as unknown as Record<string, unknown>);
            const unsupported = Object.keys(args.where).filter(
              (column) => column !== 'isVerified' && column !== 'passwordHash',
            );
            if (unsupported.length > 0) {
              throw new Error(
                `fake prisma: user.findMany 的 where.${unsupported.join('/')} 没有实现`,
              );
            }
            const matched = users.filter((row) =>
              Object.entries(args.where).every(
                ([column, expected]) => (row[column] ?? null) === expected,
              ),
            );
            // 真 Prisma 在没有 `orderBy` 时的顺序是**不保证**的；这里按 id 排是为了让
            // "前 take 个是谁"可复现。判据要看的是**实现有没有传 orderBy**（见 J-S7），
            // 不是这个假排序。
            matched.sort((left, right) => Number(left.id) - Number(right.id));
            const limited = args.take === undefined ? matched : matched.slice(0, args.take);
            return limited.map((row) => ({ id: row.id as number }));
          },
        ),
      },
      accessSession: {
        /**
         * 只实现 `{ userId: { in }, createdAt: { lt } }`，其余形状抛。
         *
         * 与上面同一条理由：一个"把不认识的 where 当空条件删光"的 fake 会让
         * "实现忘了带年龄判据"变成"删得更多、测试更红"—— 那还好；反过来"忽略
         * `userId.in`" 才是致命的静默放过。两种都宁可炸。
         */
        deleteMany: vi.fn(
          async (args: { where: { userId?: { in?: number[] }; createdAt?: { lt?: bigint } } }) => {
            sessionDeleteArgs.push({ where: args.where });
            const inList = args.where.userId?.in;
            const cutoff = args.where.createdAt?.lt;
            if (!Array.isArray(inList) || typeof cutoff !== 'bigint') {
              throw new Error(
                'fake prisma: accessSession.deleteMany 只实现 { userId: { in }, createdAt: { lt } }',
              );
            }
            if (Object.keys(args.where).length !== 2) {
              throw new Error(
                'fake prisma: accessSession.deleteMany 收到了第三个条件，假实现不会照做 —— 宁可炸',
              );
            }
            const before = accessSessions.length;
            for (let i = accessSessions.length - 1; i >= 0; i -= 1) {
              const row = accessSessions[i]!;
              if (!inList.includes(row.userId)) continue;
              if (!(row.createdAt < cutoff)) continue;
              accessSessions.splice(i, 1);
            }
            return { count: before - accessSessions.length };
          },
        ),
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
  ORPHAN_SESSION_MIN_AGE_MS,
  ORPHAN_SESSION_USER_SCAN_LIMIT,
  purgeOrphanSessions,
  SESSION_ROW_RETENTION_MS,
  sweepExpiredAccountCredentials,
} from '../src/account/credential-sweep';

const NOW = 1_700_000_000_000;
const PAST = BigInt(NOW - 60_000);
const FUTURE = BigInt(NOW + 60_000);
/** 够旧：两天前 —— 离 24 小时那条线还有一整天，不靠"刚好差 1ms"过关。 */
const OLD = NOW - 2 * 24 * 60 * 60 * 1000;

/** 一行 `users`，返回它的 id（会话行要按 id 挂在账号上）。 */
const userRow = (overrides: Record<string, string | bigint | number | null> = {}): number => {
  const id = fake.users.length + 1;
  fake.users.push({ id, ...overrides });
  return id;
};

/** 一行 `access_sessions`。`createdAtMs` 用毫秒，落进 fake 时转成真库那种 `BigInt`。 */
const sessionRow = (userId: number, createdAtMs: number): string => {
  const jtiHash = `s-${fake.accessSessions.length + 1}`;
  fake.accessSessions.push({ jtiHash, userId, createdAt: BigInt(createdAtMs) });
  return jtiHash;
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.users.length = 0;
  fake.changeRequests.length = 0;
  fake.accessSessions.length = 0;
  fake.calls.length = 0;
  fake.userFindManyArgs.length = 0;
  fake.sessionDeleteArgs.length = 0;
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
    // 三个非零 + 三个零。为什么两边都要：
    //  - **零要在场**：日志里"跑了但没活干"必须能与"根本没跑到"分开（`cleanup.ts` 同一条理由）。
    //  - **非零要原样**：只看"六个键都在"的判据，会把 `sessions` 写死成 0 也算通过 ——
    //    变异臂 `cs-7-sessions-unreported` 就是拿这个形状照出来的（第一版这条真的存活了）。
    //    同理，任何"吞掉一次失败、报 0 保平安"的写法都会在这里红，而那正是政策里
    //    "过期即失效"那句话被悄悄断供的样子。
    //  - `orphanSessions: 0` 在这里是**真的 0**（这两个账号既没写 `isVerified: 0`、也没写
    //    `passwordHash: null`，所以不在候选集里），不是"这一格还没接线"—— 接线与否由
    //    J-S8 的非零那一半钉住，两半合起来才是"这一格真的在报"。
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
      orphanSessions: 0,
    });
  });

  it('J-S7 🔴 只删「账号未激活」**且**「行够旧」的那些：三条会话里只删第三条', async () => {
    // 四个账号 × 各一条会话，只有一条该被删。
    //   - ① 已激活账号的旧会话；② 未激活账号的**新**会话；③ 未激活账号的旧会话
    //     —— 这就是题面要求的那三条，只删③。
    //   - ④ 未激活但**已有口令**的旧会话：不是凑数，见下。
    //
    // 🔴 ① 的 `passwordHash` 故意是 `null`（通行密钥专用账号 —— schema 上那句
    //    "Nullable for passkey-only users" 就是这个形状）。如果这里写成"已激活 + 有口令"，
    //    **删掉 `isVerified: 0` 这条判据也不会有任何用例变红**：那条行本来就被
    //    `passwordHash: null` 挡在外面了。而"通行密钥用户被静默登出"恰恰是这条判据
    //    写宽之后最贵的代价 —— 他连口令都没有，只能靠那台设备。
    //   - ② 钉年龄判据（删掉它就删到这条刚发出去的会话）。
    //   - ④ 钉 `passwordHash: null`（删掉它就删到这条"口令先落、还没激活"的
    //    老邮件链接注册账号的会话）。
    const activated = userRow({ isVerified: 1, passwordHash: null });
    const unverifiedNew = userRow({ isVerified: 0, passwordHash: null });
    const unverifiedOld = userRow({ isVerified: 0, passwordHash: null });
    const pendingPassword = userRow({ isVerified: 0, passwordHash: 'argon2-pending' });

    const activatedOld = sessionRow(activated, OLD);
    const freshButUnverified = sessionRow(unverifiedNew, NOW - 60_000);
    const orphan = sessionRow(unverifiedOld, OLD);
    const pendingOld = sessionRow(pendingPassword, OLD);

    const purged = await purgeOrphanSessions(NOW);

    // 真正删掉的行数：**只有**一条。
    expect(purged).toBe(1);
    expect(fake.accessSessions.map((row) => row.jtiHash)).toEqual([
      activatedOld,
      freshButUnverified,
      pendingOld,
    ]);
    expect(fake.accessSessions.some((row) => row.jtiHash === orphan)).toBe(false);

    // 判据要**问得窄**：两个条件都进 `where`（账号侧），而不是先捞全表再在 JS 里过滤。
    expect(fake.userFindManyArgs).toHaveLength(1);
    expect(fake.userFindManyArgs[0]).toMatchObject({
      where: { isVerified: 0, passwordHash: null },
      select: { id: true },
    });
    // 候选账号集**有界**：这一趟是清残渣，不是全表扫。
    expect(fake.userFindManyArgs[0]!.take).toBe(ORPHAN_SESSION_USER_SCAN_LIMIT);
    expect(ORPHAN_SESSION_USER_SCAN_LIMIT).toBeLessThanOrEqual(500);
    // `orderBy` 不是装饰：没有它，"前 take 个"每次可以是不同的那批，
    // 后面的账号就永远轮不到（见 `purgeOrphanSessions` 第 ③ 段）。
    expect(fake.userFindManyArgs[0]!.orderBy).toEqual({ id: 'asc' });

    // 删除条件必须是"这两个账号 + 早于阈值"，且阈值**从常量推导**（不是写死一个数）。
    expect(fake.sessionDeleteArgs).toHaveLength(1);
    expect(fake.sessionDeleteArgs[0]!.where).toEqual({
      userId: { in: [unverifiedNew, unverifiedOld] },
      createdAt: { lt: BigInt(NOW - ORPHAN_SESSION_MIN_AGE_MS) },
    });
    expect(ORPHAN_SESSION_MIN_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('J-S8 报告里 `orphanSessions` 数出来的就是真正删掉的行数（0 与非零都要在）', async () => {
    // 前一半：空集 ⇒ 报 0，而且**不该**发那条没有意义的 `deleteMany`。
    const empty = await sweepExpiredAccountCredentials(NOW);
    expect(empty.orphanSessions).toBe(0);
    expect(fake.sessionDeleteArgs).toHaveLength(0);

    // 后一半：**2 个账号、3 条该删的行** + 1 条不够旧。这个不对称是关键 ——
    // 把候选**账号数**（2）当成行数（3）报出去的实现，在这里会红；
    // 只有一条账号一条行的话两种写法都是 1，那条判据就白写了。
    const first = userRow({ isVerified: 0, passwordHash: null });
    const second = userRow({ isVerified: 0, passwordHash: null });
    sessionRow(first, OLD);
    sessionRow(first, OLD - 1_000);
    sessionRow(second, OLD);
    sessionRow(second, NOW - 60_000);

    const before = fake.accessSessions.length;
    const swept = await sweepExpiredAccountCredentials(NOW);

    // 与"假库真的少了几行"对账，而不是与实现自己的中间变量对账。
    expect(before - fake.accessSessions.length).toBe(3);
    expect(swept.orphanSessions).toBe(3);
    expect(fake.accessSessions).toHaveLength(1);
    // 同一趟里别的格子照旧：孤儿那一条不许把 365 天那一刀顶掉。
    expect(swept.sessions).toBe(3);
  });
});
