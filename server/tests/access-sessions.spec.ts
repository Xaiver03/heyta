import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';

/**
 * 登录会话这一层（`src/account/access-sessions.ts` + `src/auth.ts` 的 `issueSession`/`verifyToken`）。
 * 工单 W2，裁决在 [ADR-0063](../../docs/adr/0063-email-rebinding-and-per-session-revocation.md) §2.5。
 *
 * ## 这一组要挡的东西，按危险程度排
 *
 * 1. 🔴 **"撤销一枚却把别人一起撤了"**。这是本笔的核心，也是最容易被"顺手全 bump"
 *    糊过去的地方：`tokenVersion++` 同样能让那一枚失效，测试不会红任何东西，
 *    而用户想要的"退出这一台"变成了"把四台全踢下线"。
 *    所以下面那条判据断的是**两半**：那一枚被拒 **且另一枚仍然能用**。
 *    只写前半条的测试，对一个整天 bump 的实现照样全绿。
 * 2. **一枚"自己验不过"的令牌**。`issueSession` 必须**先插行后签名**：反过来时插行失败
 *    会留下一枚刚签好、却在第一次请求就 401 的令牌交给用户，而它的症状与"密码错了"
 *    长得一模一样。
 * 3. **列表说谎**。只列"版本号还等于账号上那个"的行：少了这个过滤，改过一次密码之后
 *    「登录设备」会继续列出那些其实早就登不进来的设备，"退出这一台"对它们无能为力。
 * 4. **`current` 信了客户端**。必须比服务端自己验出来的 `jti`，否则用户会在别的设备上
 *    把"退出登录"点成撤销自己的。
 *
 * ⚠️ 三层判据各管各的，不许互相冒充：
 * 这里是**库层与鉴权层**；"撤销之后那枚令牌立刻 401、别的枚不受影响"要过认证缓存这一道，
 * 那是 HTTP 层的事实，钉在 `account-security.routes.spec.ts`；
 * 两张表的 DDL 与级联钉在迁移那份 pglite 证据里。
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
    createShouldThrow: boolean;
  } = { users: new Map(), sessions: new Map(), createShouldThrow: false };

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

  /** `{ increment: n }` 与直接赋值；BigInt 不退化成 number。 */
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

  const user = {
    findUnique: vi.fn(async ({ where, select }: any) =>
      project(state.users.get(where.id) ?? null, select),
    ),
    findUniqueOrThrow: vi.fn(async ({ where, select }: any) => {
      const row = state.users.get(where.id);
      if (row === undefined) throw new Error(`Record not found on 'users' where ${JSON.stringify(where)}`);
      return project(row, select);
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const row = state.users.get(where.id);
      if (row === undefined) throw new Error(`Record not found on 'users' where ${JSON.stringify(where)}`);
      applyData(row, data);
      return project(row, select);
    }),
  };

  const accessSession = {
    create: vi.fn(async ({ data }: any) => {
      if (state.createShouldThrow) throw new Error('database is unavailable');
      // 🔴 外键：`user_id` 指向不存在的账号时真库会拒（`RESTRICT`/`CASCADE` 那一半），
      // 假库必须一样拒 —— 否则"给一个不存在的人留下会话行"这种状态在这里测不出来。
      if (state.users.get(data.userId) === undefined) {
        throw new Error('Foreign key violation: user_id');
      }
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
    findMany: vi.fn(async ({ where, orderBy, select }: any) => {
      let rows = [...state.sessions.values()].filter(
        (candidate) =>
          candidate.userId === where.userId && candidate.tokenVersion === where.tokenVersion,
      );
      if (orderBy?.createdAt === 'desc') {
        rows = rows.sort((a, b) => Number((b.createdAt as bigint) - (a.createdAt as bigint)));
      }
      return rows.map((row) => project(row, select));
    }),
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
        if (where.createdAt?.lt !== undefined && !(row.createdAt < where.createdAt.lt)) continue;
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

/**
 * 🔴 把真实 `../src/auth` 取回来。`tests/setup.ts` 全局把它 mock 成一个**闭合工厂**
 * （只有 `verifyToken` / 两个常量 / `verifyEmail`），里面没有 `issueSession` ——
 * 而这一组要验的就是"铸令牌"那一步。同 `password-recovery.spec.ts` 的做法。
 */
vi.mock('../src/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));

import { authCache } from '../src/auth-cache';
import { issueSession, revokeAllTokens, verifyToken } from '../src/auth';
import {
  SESSION_LAST_SEEN_WRITE_INTERVAL_MS,
  deleteSessionsOlderThan,
  listSessions,
  recordSession,
  revokeAllSessions,
  revokeSession,
  sessionIdOf,
  sessionIsLive,
} from '../src/account/access-sessions';

const USER_ID = 7;
const EMAIL = 'someone@example.test';

const userRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: USER_ID,
  email: EMAIL,
  isVerified: 1,
  tokenVersion: 0,
  ...overrides,
});

/** 手工签一枚带 `jti` 的令牌（绕过 `issueSession`，用来造"签名有效但库里没那一行"）。 */
const bareToken = (jti: string, tokenVersion = 0): string =>
  jwt.sign({ userId: USER_ID, email: EMAIL, tokenVersion, jti }, SECRET, { expiresIn: '1h' });

/** payload 只是 base64url，不需要密钥就能取出来。 */
const jtiOf = (token: string): string =>
  (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { jti: string }).jti;

const claimsOf = (token: string): Record<string, unknown> =>
  jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as Record<string, unknown>;

const signIn = async (userAgent = 'TestUA/1.0'): Promise<{ token: string; sessionId: string }> => {
  const token = await issueSession({ id: USER_ID }, { userAgent });
  return { token, sessionId: sessionIdOf(jtiOf(token)) };
};

const sessionRow = (sessionId: string): Record<string, unknown> =>
  fake.state.sessions.get(sessionId)!;

beforeEach(() => {
  vi.clearAllMocks();
  authCache.clear();
  fake.state.users = new Map([[USER_ID, userRow()]]);
  fake.state.sessions = new Map();
  fake.state.createShouldThrow = false;
});

afterEach(() => {
  authCache.clear();
});

describe('issueSession：铸一枚令牌 = 签名 + 落那一行', () => {
  it('🔴 落库的 `jtiHash` 就是那枚令牌里 `jti` 的 SHA-256（撤销按它寻址，不按令牌）', async () => {
    const { token, sessionId } = await signIn();

    expect(sessionId).toMatch(/^[0-9a-f]{64}$/);
    const row = sessionRow(sessionId);
    expect(row.userId).toBe(USER_ID);
    expect(row.userAgent).toBe('TestUA/1.0');
    // 🔴 这一行的列集合就是"身份元数据"的全部：没有令牌、没有口令、没有 IP、没有 `jti` 明文。
    expect(Object.keys(row).sort()).toEqual(
      ['createdAt', 'deviceName', 'jtiHash', 'lastSeenAt', 'tokenVersion', 'userId', 'userAgent'].sort(),
    );
    // （不用 `JSON.stringify`：那两列是 BigInt，序列化直接抛 —— 那是夹具的坑，不是产品的形状。）
    expect(Object.values(row).map(String).join(' ')).not.toContain(token);
  });

  it('🔴 先插行、后签名：插行失败时**一枚令牌都不交出去**', async () => {
    fake.state.createShouldThrow = true;
    await expect(issueSession({ id: USER_ID })).rejects.toThrow();
    expect(fake.state.sessions.size).toBe(0);
  });

  it('签名里的 `email`/`tokenVersion` 都由这里**回读**，不接受调用方传进来的值', async () => {
    fake.state.users.set(USER_ID, userRow({ tokenVersion: 4 }));
    const token = await issueSession({ id: USER_ID });
    const claims = claimsOf(token);
    expect(claims.tokenVersion).toBe(4);
    expect(claims.email).toBe(EMAIL);
    // 🔴 那一行的 `token_version` 必须是**同一个 4**：列表按它过滤，
    // 两个值分别去读就会造出"列出来却撤不掉"的那台设备。
    expect(sessionRow(sessionIdOf(jtiOf(token))).tokenVersion).toBe(4);
  });

  it('账号行不存在 ⇒ 抛（不静默签出一枚指向不存在用户的令牌）', async () => {
    fake.state.users.delete(USER_ID);
    await expect(issueSession({ id: 999 })).rejects.toThrow();
  });

  it('每一枚令牌的 `jti` 都不同（两次登录不是同一台设备的同一枚会话）', async () => {
    const first = await signIn();
    const second = await signIn();
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(fake.state.sessions.size).toBe(2);
  });
});

describe('🔴 撤销一枚：那一枚被拒，而别的枚仍然能用', () => {
  it('撤其中一枚 ⇒ 只有那一枚的存在性为假，另一枚照旧活着', async () => {
    const a = await signIn();
    const b = await signIn();

    expect(await revokeSession(USER_ID, a.sessionId)).toBe(true);
    expect(await sessionIsLive(USER_ID, a.sessionId)).toBe(false);
    // 🔴 这一半才是这一笔的全部内容。一个"顺手把 tokenVersion 一起 bump"的实现
    // 能让上面那条照样通过，却在这里红 —— 而那正是"退出这一台却把四台全踢下线"的形状。
    expect(await sessionIsLive(USER_ID, b.sessionId)).toBe(true);
    expect(fake.state.users.get(USER_ID)!.tokenVersion).toBe(0);
  });

  it('带 `jti` 的令牌而**库里没有那一行** ⇒ verifyToken 拒（撤销=删行，不是标记位）', async () => {
    const token = bareToken('cafebabe'.repeat(4));
    await expect(verifyToken(token)).resolves.toMatchObject({ valid: false, code: 'TOKEN_REVOKED' });
  });

  it('撤不动的三种情况同一个 `false`（不存在 / 不是他的 / 已经撤过）', async () => {
    const a = await signIn();
    expect(await revokeSession(USER_ID, 'f'.repeat(64))).toBe(false);
    expect(await revokeSession(999, a.sessionId)).toBe(false);
    expect(await revokeSession(USER_ID, a.sessionId)).toBe(true);
    // 🔴 同一个人撤同一枚第二次也是 `false` —— 界面因此不许说"这个会话不存在"，
    // 只能说"刷新一下这个列表"（三者同一句的立场在 `session-contract.ts`）。
    expect(await revokeSession(USER_ID, a.sessionId)).toBe(false);
    expect(fake.state.sessions.size).toBe(0);
  });

  it('别人的那一枚撤不动（`where` 里带着 userId，这个形状写不出来）', async () => {
    const a = await signIn();
    fake.state.users.set(8, userRow({ id: 8 }));
    expect(await revokeSession(8, a.sessionId)).toBe(false);
    expect(fake.state.sessions.size).toBe(1);
  });

  it('全设备登出 ⇒ 每一枚都被拒，且计数器那一档仍然守着没有 `jti` 的旧令牌', async () => {
    const a = await signIn();
    const b = await signIn();
    const legacy = jwt.sign({ userId: USER_ID, email: EMAIL, tokenVersion: 0 }, SECRET, {
      expiresIn: '1h',
    });
    await revokeAllTokens(USER_ID);
    for (const token of [a.token, b.token, legacy]) {
      await expect(verifyToken(token)).resolves.toMatchObject({ valid: false, code: 'TOKEN_REVOKED' });
    }
    expect(fake.state.users.get(USER_ID)!.tokenVersion).toBe(1);
  });
});

describe('verifyToken 对 `jti` 的读法', () => {
  it('没有 `jti` 的令牌（本轮之前签的）仍然过，但**这一层不因此失效**', async () => {
    const legacy = jwt.sign({ userId: USER_ID, email: EMAIL, tokenVersion: 0 }, SECRET, {
      expiresIn: '1h',
    });
    await expect(verifyToken(legacy)).resolves.toMatchObject({ valid: true, sessionId: null });
    // 🔴 而**带** `jti` 的那一条检查必须还在。只写上面那条的话，把
    // `if (sessionId !== null && …)` 整个删掉也照样绿（旧令牌本来就不查库），
    // 所以这里必须用一枚"有 jti、没行"的令牌单独证一次它会红。
    // `authCache.clear()` 是把上一行刚填进去的缓存清掉 —— 缓存命中会整段跳过库，
    // 那正是下面那条特征用例要钉住的东西。
    authCache.clear();
    await expect(verifyToken(bareToken('deadbeef'.repeat(4)))).resolves.toMatchObject({ valid: false });
  });

  it('🔴 特征：缓存命中时这一层**整段跳过** ⇒ "撤销必须当场 invalidate" 是安全属性，不是优化', async () => {
    /**
     * 这一条记录的是一个**真实存在**的空窗，而不是夹具的毛病：
     * 命中缓存那条路会**整段跳过库面检查**，所以**某一枚自己那一格**还焐着的时候，
     * 库里那一行虽然已经删掉，这一枚在缓存 TTL 内仍然被放行，而**没有任何一层会报错**。
     *
     * 唯一的补救是每个撤销出口都当场 `authCache.invalidate(userId)`
     * （`account-security.routes.ts` 里那两处都带着 `AUTH_CACHE_INVALIDATION` 标记）。
     * 那条补救的判据住在 `account-security.routes.spec.ts` 的"撤销一枚后那枚立刻 401、
     * 别的枚仍能用"；这里把**空窗本身**测下来，是为了让
     * "把 invalidate 当成可选优化删掉"这件事在两个文件里都红，而不是只在一个。
     *
     * 🔴 最后那两条测的是**另一格**空窗，10-09 之前它也真实存在：那时缓存**按 `userId` 分格**，
     * 于是"用 B 焐热 → 撤 C → C 仍然 200"——B 的下一次鉴权把 C 的判断替做了。
     * 现在缓存按会话分格（`auth-cache.ts` 的 `keyOf`）。同一件事还在 `auth-cache.spec.ts`
     * 与真库集成 `链路 3b` 各钉一次，三层读数与逐层变异见计划 §6.7。
     */
    const a = await signIn();
    const b = await signIn();
    await verifyToken(a.token); // 把 (tokenVersion, isVerified) 放进**它自己那一格**
    expect(authCache.get(USER_ID, a.sessionId)).not.toBeNull();
    expect(await revokeSession(USER_ID, a.sessionId)).toBe(true);

    // 不失效缓存 ⇒ 这一枚仍然过。这不是期望行为，是**自己那一格的 TTL 空窗形状**。
    await expect(verifyToken(a.token)).resolves.toMatchObject({ valid: true });
    // 失效之后 ⇒ 同一枚立刻被拒。
    authCache.invalidate(USER_ID);
    await expect(verifyToken(a.token)).resolves.toMatchObject({ valid: false, code: 'TOKEN_REVOKED' });
    // 而 `b` 不受牵连（撤销一枚不等于全设备登出）。
    await expect(verifyToken(b.token)).resolves.toMatchObject({ valid: true });
    // 🔴 B 刚被焐热这一件事，不能替 A 那一枚做判断 —— 把缓存键改回只按 `userId`，这一条立刻红，
    // 而上面四条在两种键形状下**都还是绿的**（这就是为什么这一条要单独写在这里）。
    await expect(verifyToken(a.token)).resolves.toMatchObject({ valid: false, code: 'TOKEN_REVOKED' });
  });

  it('`jti` 是空串 ⇒ 按"没有这一层"处理，而不是去查一枚空主键', async () => {
    await expect(verifyToken(bareToken(''))).resolves.toMatchObject({ valid: true, sessionId: null });
  });

  it('缓存命中时**不打会话表**（这一层不能把鉴权变成热读路径）', async () => {
    const { token } = await signIn();
    await verifyToken(token);
    fake.accessSession.findFirst.mockClear();
    await verifyToken(token);
    expect(fake.accessSession.findFirst).not.toHaveBeenCalled();
  });

  it('缓存未命中时才查会话，而 `sessionId` 回给调用方（「退出登录」要撤的就是这一枚）', async () => {
    const { token, sessionId } = await signIn();
    fake.accessSession.findFirst.mockClear();
    const result = await verifyToken(token);
    expect(result).toMatchObject({ valid: true, sessionId });
    expect(fake.accessSession.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('「登录设备」这张列表不许说谎', () => {
  it('🔴 只列"版本号还等于账号上那个"的行：全局 bump 之后列表自己空掉', async () => {
    await signIn();
    await signIn();
    expect(await listSessions(USER_ID, 0, null)).toHaveLength(2);

    fake.state.users.set(USER_ID, userRow({ tokenVersion: 1 }));
    // 两行的 `token_version` 都还是 0 ⇒ 它们已经登不进来了，于是也不该出现在列表里。
    // 少了这个过滤，"退出这一台"会列出几台撤不掉的设备 —— 界面从此在说假话。
    expect(await listSessions(USER_ID, 1, null)).toEqual([]);
    // 而按**旧**版本号问一次仍然看得到（证明过滤的主语确实是这个参数，不是别的什么）
    expect(await listSessions(USER_ID, 0, null)).toHaveLength(2);
  });

  it('恰好一行 `current`，而且来自服务端自己验出的那一枚', async () => {
    const a = await signIn();
    const b = await signIn('TestUA/2.0');
    const rows = await listSessions(USER_ID, 0, b.sessionId);
    expect(rows.filter((row) => row.current)).toHaveLength(1);
    expect(rows.find((row) => row.current)?.sessionId).toBe(b.sessionId);
    expect(rows.find((row) => row.sessionId === a.sessionId)?.current).toBe(false);
  });

  it('手上这一枚为 `null`（旧令牌）时**没有**一行自称 current', async () => {
    await signIn();
    const rows = await listSessions(USER_ID, 0, null);
    expect(rows.every((row) => !row.current)).toBe(true);
  });

  it('🔴 白名单投影：没有 `jti` 明文、没有令牌、没有 IP', async () => {
    const { token, sessionId } = await signIn();
    const rows = await listSessions(USER_ID, 0, sessionId);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(jtiOf(token));
    expect(serialized).not.toContain('eyJ');
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['createdAt', 'current', 'deviceName', 'lastSeenAt', 'sessionId', 'userAgent'].sort(),
      );
    }
  });

  it('按创建时间倒序（"最近登录的排最前"是界面上唯一说得过去的顺序）', async () => {
    const first = await signIn();
    const second = await signIn();
    // 两次登录落在**同一毫秒**时 `createdAt` 相等，排序就没有答案可判（那是一条永远
    // 靠运气绿的判据）。这里把两行的时间写成明确的新旧，让"倒序"这件事本身可判。
    sessionRow(first.sessionId).createdAt = BigInt(1_000);
    sessionRow(second.sessionId).createdAt = BigInt(2_000);
    const rows = await listSessions(USER_ID, 0, null);
    expect(rows.map((row) => row.sessionId)).toEqual([second.sessionId, first.sessionId]);
  });

  it('别人的行读不到（`where` 里带着 userId）', async () => {
    await signIn();
    expect(await listSessions(999, 0, null)).toEqual([]);
  });
});

describe('last_seen 的节流与容错', () => {
  it('五分钟内不重复写这一行（否则每次鉴权缓存未命中都是一次数据库写）', async () => {
    const { sessionId } = await signIn();
    fake.accessSession.update.mockClear();
    expect(await sessionIsLive(USER_ID, sessionId)).toBe(true);
    expect(fake.accessSession.update).not.toHaveBeenCalled();
  });

  it('超过间隔才写，写的是**现在**', async () => {
    const { sessionId } = await signIn();
    const row = sessionRow(sessionId);
    row.lastSeenAt = BigInt(Date.now() - SESSION_LAST_SEEN_WRITE_INTERVAL_MS - 1000);
    const before = Date.now();
    expect(await sessionIsLive(USER_ID, sessionId)).toBe(true);
    expect(Number(sessionRow(sessionId).lastSeenAt)).toBeGreaterThanOrEqual(before);
  });

  it('🔴 这一格写失败**不能**把一次合法请求变成 500（但必须响亮地记日志）', async () => {
    const { token, sessionId } = await signIn();
    sessionRow(sessionId).lastSeenAt = BigInt(
      Date.now() - SESSION_LAST_SEEN_WRITE_INTERVAL_MS - 1,
    );
    fake.accessSession.update.mockRejectedValueOnce(new Error('write conflict'));
    await expect(verifyToken(token)).resolves.toMatchObject({ valid: true });
    expect(spiedLogger.error).toHaveBeenCalled();
  });
});

describe('留存清扫与全量撤销', () => {
  it('只删**早于**给定时点的行（新会话不能被清扫顺手带走）', async () => {
    const fresh = await signIn();
    const stale = await signIn();
    sessionRow(stale.sessionId).createdAt = BigInt(1_000);

    expect(await deleteSessionsOlderThan(2_000)).toBe(1);
    expect(fake.state.sessions.has(fresh.sessionId)).toBe(true);
    expect(fake.state.sessions.has(stale.sessionId)).toBe(false);
  });

  it('`revokeAllSessions` 只删行，**不**动计数器（那一半是调用方的事）', async () => {
    await signIn();
    await signIn();
    expect(await revokeAllSessions(USER_ID)).toBe(2);
    expect(fake.state.users.get(USER_ID)!.tokenVersion).toBe(0);
    expect(fake.state.sessions.size).toBe(0);
  });

  it('账号行不存在时 `recordSession` 抛（不给一个不存在的人留会话行）', async () => {
    await expect(
      recordSession({ jti: 'a'.repeat(32), userId: 999, tokenVersion: 0 }),
    ).rejects.toThrow();
  });
});
