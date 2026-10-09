import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock (both are hoisted, but vi.hoisted first)
const jwtSignSpy = vi.hoisted(() => {
  // Must set JWT_SECRET before auth.ts loads (getJwtSecret runs at module scope)
  process.env.JWT_SECRET = 'a'.repeat(32);
  return vi.fn().mockReturnValue('mock-jwt-token');
});

// The global setup.ts mocks '../src/auth' with only verifyToken.
// We need the real replaceToken, so override with importOriginal.
vi.mock('../src/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Keep verifyToken mocked (from setup.ts pattern)
    verifyToken: vi.fn().mockResolvedValue({ valid: true, userId: 1, email: 'test@test.com' }),
  };
});

// Spy on jwt.sign to capture its arguments
// Must include JsonWebTokenError/TokenExpiredError since auth.ts destructures them from the jwt namespace
vi.mock('jsonwebtoken', () => {
  class JsonWebTokenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'JsonWebTokenError';
    }
  }
  class TokenExpiredError extends JsonWebTokenError {
    expiredAt: Date;
    constructor(message: string, expiredAt: Date) {
      super(message);
      this.name = 'TokenExpiredError';
      this.expiredAt = expiredAt;
    }
  }
  return {
    default: {
      sign: (...args: unknown[]) => jwtSignSpy(...args),
      verify: vi.fn(),
      JsonWebTokenError,
      TokenExpiredError,
    },
    sign: (...args: unknown[]) => jwtSignSpy(...args),
    verify: vi.fn(),
    JsonWebTokenError,
    TokenExpiredError,
  };
});

// Mock logger to suppress output
vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { replaceToken, JWT_EXPIRY } from '../src/auth';
import { prisma } from '../src/db';

describe('replaceToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: $transaction calls the callback with a mock tx
    vi.mocked(prisma.$transaction).mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            update: vi.fn().mockResolvedValue({ tokenVersion: 5 }),
          },
        };
        return cb(tx);
      },
    );

    // 🔴 ADR-0063：`replaceToken` 现在把签名交给 `issueSession`，而它**回读账号行**
    // （`select: { email, tokenVersion }`）—— 事务里 bump 之后读到的那一格，就是默认那
    // 一笔 `update` 写回的 5。下面每条用例把它和自己那一次 `update` 的返回值对齐：
    // 两格各写各的数字也能绿，但那样"令牌带的是库里那一格"就不再是判据了。
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      email: 'user@example.com',
      tokenVersion: 5,
    } as any);
  });

  it('should use JWT_EXPIRY (365d)', async () => {
    await replaceToken(1, 'user@example.com');

    expect(jwtSignSpy).toHaveBeenCalledTimes(1);
    const [, , options] = jwtSignSpy.mock.calls[0];
    expect(options.expiresIn).toBe(JWT_EXPIRY);
    expect(options.expiresIn).toBe('365d');
  });

  it('should include incremented tokenVersion in JWT payload', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            update: vi.fn().mockResolvedValue({ tokenVersion: 42 }),
          },
        };
        return cb(tx);
      },
    );
    // 回读那一格 = 上面 bump 之后的那一格（同一次提交后的同一行）。
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      email: 'user@example.com',
      tokenVersion: 42,
    } as any);

    await replaceToken(1, 'user@example.com');

    expect(jwtSignSpy).toHaveBeenCalledTimes(1);
    const [payload] = jwtSignSpy.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        userId: 1,
        email: 'user@example.com',
        tokenVersion: 42,
      }),
    );
  });

  it('should return the correct user info and token', async () => {
    // 这一条查的是 id 7 那一行：回读到的 email 与调用方传进来的**同一个**，
    // 否则夹具内部就自相矛盾了（断言看不见，但下一位读者会）。
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      email: 'test@test.com',
      tokenVersion: 5,
    } as any);

    const result = await replaceToken(7, 'test@test.com');

    expect(result).toEqual({
      token: 'mock-jwt-token',
      user: { id: 7, email: 'test@test.com' },
    });
  });

  it('should increment tokenVersion via transaction', async () => {
    let capturedUpdateArgs: unknown = null;
    vi.mocked(prisma.$transaction).mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            update: vi.fn().mockImplementation(async (args: unknown) => {
              capturedUpdateArgs = args;
              return { tokenVersion: 10 };
            }),
          },
        };
        return cb(tx);
      },
    );
    // 与上面那次 `update` 写回的值同源（10）—— 回读发生在 bump 提交之后。
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      email: 'user@example.com',
      tokenVersion: 10,
    } as any);

    await replaceToken(3, 'user@example.com');

    expect(capturedUpdateArgs).toEqual(
      expect.objectContaining({
        where: { id: 3 },
        data: { tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      }),
    );
  });
});
