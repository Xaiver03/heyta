import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';

/**
 * `/api/test/mint-login-link` 的契约 —— BLOCKED B10 的收口判据。
 *
 * 这条路由存在的理由只有一句话：E2E 要往应用的「粘贴邮件里的链接或令牌」
 * 输入框里贴**邮件链接形态的一次性令牌**，而此前 test 端点只能给 JWT 访问
 * 令牌 —— 形态不匹配，主路径 12+ 轮结构性走不通，还被误读过产品红。
 *
 * 🔴 最承重的一条用例是**往返**：路由吐出的令牌，必须能被**生产消费方**
 * `verifyLoginMagicLink`（`POST /api/login/magic-link/verify` 的实现）换成
 * 带 `tokenVersion` 的会话。变异验证过它真的会红：把路由改成返回
 * `issueSession(user)`（JWT —— B10 原病的形状），往返这条立刻失败，
 * 因为 JWT 的哈希 ≠ 落库的那枚哈希。
 *
 * 单次消费的语义（第二枚必败）不在这里新造覆盖 —— 那是
 * `verifyLoginMagicLink` 自己的契约；这里只钉"test 路由给出的东西
 * 在那条路上**真的走得通**"。
 */

// `../src/auth` 在模块顶层读 `JWT_SECRET`，必须在 import 之前就有值。
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
}));

const spiedLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../src/db', () => ({ prisma: mocks }));
vi.mock('../src/logger', () => ({ Logger: spiedLogger }));
vi.mock('../src/email', () => ({
  sendLoginMagicLinkEmail: vi.fn().mockResolvedValue(true),
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
}));
// `tests/setup.ts` 对 `../src/auth` 有一份**全局** mock（只提供少数几个函数）。
// 这一组恰好相反：被测物就是 auth 的真实现（`mintLoginMagicLinkToken` /
// `verifyLoginMagicLink`），所以在**本文件**把 mock 整体换回真模块 ——
// 文件内的 `vi.mock` 会覆盖 setup 的同名 mock（password-auth-routes 同款手法）。
vi.mock('../src/auth', async (importOriginal) => await importOriginal());

import { testRoutes } from '../src/test-routes';
import { verifyLoginMagicLink } from '../src/auth';
import { hashToken } from '../src/auth-tokens';

const buildApp = async () => {
  const app = Fastify();
  await app.register(testRoutes, { prefix: '/api/test' });
  return app;
};

const verifiedUser = {
  id: 42,
  email: 'someone@example.com',
  isVerified: 1,
  tokenVersion: 3,
};

describe('POST /api/test/mint-login-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('邮箱不存在 → 404（不签发任何东西）', async () => {
    mocks.user.findUnique.mockResolvedValue(null);
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mint-login-link',
      payload: { email: verifiedUser.email },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'user-not-found' });
    expect(mocks.user.updateMany).not.toHaveBeenCalled();
  });

  it('邮箱未验证 → 409（与生产 requestLoginMagicLink 的闸门一致）', async () => {
    mocks.user.findUnique.mockResolvedValue({ ...verifiedUser, isVerified: 0 });
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mint-login-link',
      payload: { email: verifiedUser.email },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'email-not-verified' });
  });

  it('🔴 往返：签出的令牌能被生产的 verifyLoginMagicLink 换成带 tokenVersion 的会话', async () => {
    mocks.user.findUnique.mockResolvedValue(verifiedUser);
    // 第一次 updateMany = 路由先清旧令牌；第二次 = mint 的原子占槽。
    mocks.user.updateMany.mockResolvedValue({ count: 1 });
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mint-login-link',
      payload: { email: verifiedUser.email },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; email: string };
    expect(body.email).toBe(verifiedUser.email);
    // 🔴 形态钉死：32 字节随机十六进制 —— 邮件链接里的那种，不是 JWT。
    //    （贴令牌输入框两端各有一个点就走不通，这句是在防"顺手签个 JWT 回去"。）
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);

    // 落库的是它的 SHA-256（写读两侧同一个 hashToken —— auth-tokens 的纪律）。
    const mintWrite = mocks.user.updateMany.mock.calls
      .map((c) => c[0])
      .find((w) => typeof w?.data?.loginToken === 'string');
    expect(mintWrite).toBeDefined();
    expect(mintWrite.data.loginToken).toBe(hashToken(body.token));

    // 消费方按哈希查回来 —— verify 侧不走任何 test 专用代码。
    mocks.user.findFirst.mockResolvedValue({
      ...verifiedUser,
      loginToken: mintWrite.data.loginToken,
      loginTokenExpiresAt: BigInt(Date.now() + 60_000),
    });
    const session = await verifyLoginMagicLink(body.token);

    const claims = jwt.decode(session.token) as Record<string, unknown>;
    expect(claims.userId).toBe(verifiedUser.id);
    expect(claims.email).toBe(verifiedUser.email);
    // tokenVersion 在 —— 少了它，"改密/登出全部设备"对这枚会话就失效了。
    expect(claims.tokenVersion).toBe(verifiedUser.tokenVersion);
  });

  it('重复签发拿到的是新的一枚（强制新签：清旧 → 占槽，各一次）', async () => {
    mocks.user.findUnique.mockResolvedValue(verifiedUser);
    mocks.user.updateMany.mockResolvedValue({ count: 1 });
    const app = await buildApp();

    const first = (
      await app.inject({
        method: 'POST',
        url: '/api/test/mint-login-link',
        payload: { email: verifiedUser.email },
      })
    ).json() as { token: string };
    const second = (
      await app.inject({
        method: 'POST',
        url: '/api/test/mint-login-link',
        payload: { email: verifiedUser.email },
      })
    ).json() as { token: string };

    expect(second.token).toMatch(/^[0-9a-f]{64}$/);
    expect(second.token).not.toBe(first.token);
    // 每次调用恰好两笔写：清旧 + 占槽。
    expect(mocks.user.updateMany).toHaveBeenCalledTimes(4);
  });
});
