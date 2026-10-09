import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';

const jwtSecret = vi.hoisted(() => {
  const secret = 'a'.repeat(32);
  process.env.JWT_SECRET = secret;
  return secret;
});

vi.mock('../src/auth', async (importOriginal) => {
  return await importOriginal();
});

vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { verifyToken, revokeAllTokens } from '../src/auth';
import { authCache } from '../src/auth-cache';
import { sessionIdOf } from '../src/account/access-sessions';
import { prisma } from '../src/db';

const createToken = (tokenVersion: number = 0): string =>
  jwt.sign({ userId: 1, email: 'user@example.com', tokenVersion }, jwtSecret, {
    expiresIn: '1h',
  });

describe('auth verification cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCache.clear();
  });

  it('should reuse a warm verified-token cache entry', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 1,
      tokenVersion: 0,
      isVerified: 1,
    } as any);

    const token = createToken();

    // 🔴 形状逐字钉住（ADR-0063 §4 第 1 条）：这一枚是**手工签的、payload 里没有 `jti`**，
    // 所以 `sessionId` 必须是 `null` —— 它钉的正是"没有 jti 的令牌不可单独撤销"那一支。
    // `tokenVersion` 在 `createToken()` 里带了 0，所以它照旧出现在返回值里。
    await expect(verifyToken(token)).resolves.toEqual({
      valid: true,
      tokenVersion: 0,
      userId: 1,
      email: 'user@example.com',
      sessionId: null,
    });
    await expect(verifyToken(token)).resolves.toEqual({
      valid: true,
      tokenVersion: 0,
      userId: 1,
      email: 'user@example.com',
      sessionId: null,
    });

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('should fall through to the database on tokenVersion mismatch', async () => {
    authCache.set(1, null, 1, true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 1,
      tokenVersion: 0,
      isVerified: 1,
    } as any);

    await expect(verifyToken(createToken(0))).resolves.toEqual(
      expect.objectContaining({ valid: true }),
    );

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  /**
   * 🔴 **另一台设备不许替被撤销的那一枚免查会话边界。**
   *
   * 这条是 2026-10-09 由 `research/tools/account-email-sessions-http-probe.mjs` 的判据 25
   * 照出来的真缺陷：缓存原来按 `userId` 存一格"合法"，命中就整段跳过 `sessionIsLive`，
   * 于是撤销 C 之后只要 B 还在同步（B 的每次请求都重写那一格），**C 的令牌继续回 200**。
   * 界面上那句"退出哪一台，它的下一次请求就要重新登录"因此是假的。
   *
   * 修法是把会话身份放进键（`server/src/auth-cache.ts` 文件头写了成因）。
   * 变异（证明这条判据有牙）：把 `keyOf` 换成只按 `userId`
   * ⇒ 这一条转红（C 命中 B 那一格，`valid: true`）。
   */
  it('a warm entry for one session must not let another revoked session skip the session check', async () => {
    const tokenB = jwt.sign(
      { userId: 1, email: 'user@example.com', tokenVersion: 0, jti: 'jti-live-b' },
      jwtSecret,
      { expiresIn: '1h' },
    );
    const tokenC = jwt.sign(
      { userId: 1, email: 'user@example.com', tokenVersion: 0, jti: 'jti-revoked-c' },
      jwtSecret,
      { expiresIn: '1h' },
    );

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 1,
      tokenVersion: 0,
      isVerified: 1,
    } as any);
    // 走 setup.ts 里那台**有状态**的会话替身：B 那一枚建行、C 那一枚不建
    // （等价于"C 已被撤销 = 行不在了"），不自己重写 `findFirst`。
    await prisma.accessSession.create({
      data: {
        jtiHash: sessionIdOf('jti-live-b'),
        userId: 1,
        tokenVersion: 0,
        lastSeenAt: BigInt(Date.now()),
      },
    } as any);

    // B 活着：第一次打库、第二次命中缓存 —— 这一格现在带的是 B 的会话身份。
    await expect(verifyToken(tokenB)).resolves.toEqual(expect.objectContaining({ valid: true }));
    const readsAfterB = vi.mocked(prisma.user.findUnique).mock.calls.length;
    await expect(verifyToken(tokenB)).resolves.toEqual(expect.objectContaining({ valid: true }));
    expect(vi.mocked(prisma.user.findUnique).mock.calls.length).toBe(readsAfterB);

    // C 那一枚**已经不在库里**：它必须自己去打库、被会话边界拒掉，
    // 而不是沾 B 那一格的光。
    await expect(verifyToken(tokenC)).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        code: 'TOKEN_REVOKED',
      }),
    );
  });

  it('should invalidate the cache when revoking all tokens', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 1,
      tokenVersion: 0,
      isVerified: 1,
    } as any);
    const token = createToken();

    await verifyToken(token);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    vi.mocked(prisma.user.update).mockResolvedValue({} as any);
    await revokeAllTokens(1);

    vi.mocked(prisma.user.findUnique).mockClear();
    await verifyToken(token);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('should not re-cache a token when invalidation happens during verification', async () => {
    const token = createToken(0);
    let resolveFindUnique!: (value: {
      id: number;
      tokenVersion: number;
      isVerified: number;
    }) => void;

    vi.mocked(prisma.user.findUnique)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFindUnique = resolve;
        }) as ReturnType<typeof prisma.user.findUnique>,
      )
      .mockResolvedValueOnce({
        id: 1,
        tokenVersion: 1,
        isVerified: 1,
      } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    const inFlightVerification = verifyToken(token);
    await Promise.resolve();

    await revokeAllTokens(1);
    resolveFindUnique({ id: 1, tokenVersion: 0, isVerified: 1 });

    await expect(inFlightVerification).resolves.toEqual(
      expect.objectContaining({ valid: true }),
    );

    await expect(verifyToken(token)).resolves.toEqual({
      valid: false,
      code: 'TOKEN_REVOKED',
      reason: 'Token was revoked. Please log in again to get a new token.',
      // 2026-10-03（批次 E / E1）：失效结果多了必填的 `code`。这一支是 **撤销**，
      // 不是注销 —— 客户端将来只在 ACCOUNT_CLOSED 下销毁本地库，所以把码钉在这里
      // 也顺手钉住了"改密/全设备登出走的是这一支"。判据见 account-closed-signal.spec.ts。
      code: 'TOKEN_REVOKED',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('bounds invalidationVersions and keeps recent invalidations newest', () => {
    // A long-ago invalidation must not pin heap forever.
    authCache.invalidate(1);
    expect(authCache.getInvalidationVersion(1)).toBe(1);

    // Push >10k distinct invalidations so user 1 (the oldest) is evicted.
    for (let userId = 2; userId <= 10_002; userId++) {
      authCache.invalidate(userId);
    }

    // Evicted -> reverts to the default (0). Memory is bounded.
    expect(authCache.getInvalidationVersion(1)).toBe(0);
    // A freshly-invalidated user sits at the MRU tail and is retained, so the
    // CAS race protection still holds for the window that matters.
    expect(authCache.getInvalidationVersion(10_002)).toBe(1);
  });
});
