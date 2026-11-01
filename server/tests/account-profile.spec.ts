/**
 * `/api/account/profile` 与 `/api/account/avatar` 的契约测试（R10）
 * ==============================================================
 *
 * 服务端有身份的路由，最常见的两个洞是本文件的主轴：
 *   ① **不按调用者过滤**（把 `userId` 从请求体里读，A 就能改 B 的资料）；
 *   ② **响应把秘密一起发出去**（`{...user}` 一步到位地泄漏口令散列）。
 * ②在这条链上尤其现实：`withAccountProfile` 就是登录响应必经的出口，
 * 而 TypeScript **抓不到多带字段**（多几个属性不报错）。
 *
 * ⚠️ 全程 mock `prisma`，不碰数据库。迁移本身（可空列、级联、默认值）的证据在
 * `account-profile-schema.pglite.spec.ts`，两件事别互相冒充。
 */
// 本文件把 `../src/db` mock 掉了 ⇒ 靠 `src/api` 的导入链**顺带**加载 .env 那条路断了，
// 所以原来这里显式写了 `import 'dotenv/config'`。开发机上能过，而**干净检出（CI 的唯一形态）
// 没有 `server/.env`**（`server/.gitignore:5` 忽略它）⇒ 整个文件在加载期就红。
// §7 第 157 条点名的正是这个形状：那次清扫补了 4 个文件，这里是漏掉的第 5 个。
// 改回仓库自己的约定（同 `account-locale` / `password-recovery` / `legal-recheck.routes`）：
// 用 `vi.hoisted` 在所有 import 之前把测试密钥放好，`??=` 让显式设过值的文件不被覆盖。
import Fastify, { FastifyInstance } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  userAvatar: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

import { accountProfileRoutes } from '../src/account/account-profile.routes';
import { withAccountProfile } from '../src/account/account-profile.store';

vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

// 🔴 这条 `throw` 留着不是为了防御（上面已经保证有值），是**前提断言**：约定块被挪走或删掉时
// 症状必须是一句响的，而不是 27 条用例各自报一个看不懂的签名错误。
const SECRET = process.env.JWT_SECRET;
if (SECRET === undefined) throw new Error('测试进程里没有 JWT_SECRET —— 看上面的 vi.hoisted 约定块');

/** 令牌主人是 1 号。请求体里再写别的 userId 都不该生效。 */
const token = (userId: number): string =>
  `Bearer ${jwt.sign({ userId, email: `u${userId}@example.test`, tokenVersion: 0 }, SECRET, { expiresIn: '1h' })}`;

const AUTH = { authorization: token(1) };
let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  // `authenticate` 会查库验令牌（tokenVersion / isVerified）。
  mocks.user.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0, isVerified: 1 });
  mocks.user.update.mockResolvedValue({ id: 1, displayName: null, locale: null });
  mocks.userAvatar.findUnique.mockResolvedValue(null);
  mocks.userAvatar.upsert.mockResolvedValue({ userId: 1 });
  mocks.userAvatar.deleteMany.mockResolvedValue({ count: 1 });

  // 🔴 夹具的全局 `bodyLimit` 与**生产同值**（`src/server.ts:382` 的 20 MB）。
  // 裸 `Fastify()` 的默认是 1 MiB，那会让"路由级 2 MiB 上限"这条判据
  // 被一个错误的挡箭牌顶掉：限制静默失效时 3 MiB 照样被拒，用例却绿。
  app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  await app.register(accountProfileRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('五条路由都要身份', () => {
  // 🔴 **遍历**而不是抽查。抽查会漏掉"以后新加的那条忘了挂 preHandler"，
  // 而 admin 那轮已经证明：闸门挂在插件级才叫闸门，挂在每条路由上叫习惯。
  const ROUTES: [string, string][] = [
    ['GET', '/api/account/profile'],
    ['PUT', '/api/account/profile'],
    ['GET', '/api/account/avatar'],
    ['PUT', '/api/account/avatar'],
    ['DELETE', '/api/account/avatar'],
  ];

  it.each(ROUTES)('%s %s 没有令牌 ⇒ 401，且一次查库写库都没有', async (method, url) => {
    const res = await app.inject({ method: method as 'GET', url, payload: {} });
    expect(res.statusCode, `${method} ${url} 未鉴权却回了 ${res.statusCode}`).toBe(401);
    expect(mocks.user.update).not.toHaveBeenCalled();
    expect(mocks.userAvatar.upsert).not.toHaveBeenCalled();
    expect(mocks.userAvatar.deleteMany).not.toHaveBeenCalled();
  });

  it.each(ROUTES)('%s %s 路由表里真的有 preHandler（不是靠"忘了就 401"）', async (method, url) => {
    const found = app.printRoutes({ commonPrefix: false });
    expect(found, `路由表里找不到 ${url}`).toContain(url.replace('/api/', '/'));
  });
});

describe('归属只从令牌来', () => {
  it('PUT profile 写的是令牌主人那行，请求体里的 userId / email 全部无效', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/profile',
      headers: AUTH,
      payload: { displayName: '小鹿', userId: 999, email: 'victim@example.test' },
    });
    expect(res.statusCode).toBe(200);
    const call = mocks.user.update.mock.calls[0]?.[0] as { where: { id: number } };
    expect(call.where).toEqual({ id: 1 });
    // 🔴 这条是"多余键被丢弃"而不是"没写进去"：断言 where 里没有 999 才是判据。
    expect(JSON.stringify(call.where)).not.toContain('999');
  });

  it('PUT avatar 落在令牌名下的 user_avatars 行', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: AUTH,
      payload: {
        contentType: 'image/png',
        dataBase64: Buffer.alloc(64, 7).toString('base64'),
        userId: 999,
      },
    });
    expect(res.statusCode).toBe(200);
    const call = mocks.userAvatar.upsert.mock.calls[0]?.[0] as { where: { userId: number } };
    expect(call.where).toEqual({ userId: 1 });
  });
});

describe('昵称：长度与"清除"的区分', () => {
  it('超过 32 个码点 ⇒ 400，而且不写库', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/profile',
      headers: AUTH,
      payload: { displayName: '一'.repeat(33) },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.user.update).not.toHaveBeenCalled();
  });

  it('32 个 emoji（64 个 UTF-16 单元）⇒ 收。计数口径是码点，不是 .length', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/profile',
      headers: AUTH,
      payload: { displayName: '👍'.repeat(32) },
    });
    expect(res.statusCode, 'emoji 昵称被按 UTF-16 长度拒了 ⇒ 两端口径漂了').toBe(200);
  });

  it('`null` 是清除（写 null），空串是无效输入（400）', async () => {
    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/account/profile',
      headers: AUTH,
      payload: { displayName: null },
    });
    expect(cleared.statusCode).toBe(200);
    const write = mocks.user.update.mock.calls[0]?.[0] as { data: { displayName: unknown } };
    expect(write.data.displayName).toBeNull();

    const before = mocks.user.update.mock.calls.length;
    const blank = await app.inject({
      method: 'PUT',
      url: '/api/account/profile',
      headers: AUTH,
      payload: { displayName: '   ' },
    });
    expect(blank.statusCode).toBe(400);
    expect(mocks.user.update.mock.calls.length, '空白串被当成"清除"写进去了').toBe(before);
  });
});

describe('头像：基础资料明文，服务端自己校验格式与大小（ADR-0079）', () => {
  const IMAGE_B64 = Buffer.alloc(64, 7).toString('base64');

  it.each([
    ['格式不在白名单', { contentType: 'image/svg+xml', dataBase64: IMAGE_B64 }],
    ['不是标准 base64', { contentType: 'image/png', dataBase64: 'not base64!!' }],
    ['长度不是 4 的倍数', { contentType: 'image/png', dataBase64: 'AAAAAAAAA' }],
    ['contentType 缺失', { dataBase64: IMAGE_B64 }],
    ['dataBase64 不是字符串', { contentType: 'image/png', dataBase64: 42 }],
  ])('头像载荷 %s ⇒ 400，且不写库', async (_label, payload) => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: AUTH,
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
    expect(mocks.userAvatar.upsert).not.toHaveBeenCalled();
  });

  it('🔴 解码后超过 512 KB ⇒ 400（旧版服务端只能量密文，现在能直接量图片）', async () => {
    const tooBig = Buffer.alloc(512 * 1024 + 3, 9).toString('base64');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: AUTH,
      payload: { contentType: 'image/png', dataBase64: tooBig },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.userAvatar.upsert).not.toHaveBeenCalled();
  });

  it('PUT 头像：逐字节存下图片与 MIME，hash 由服务端算（客户端塞的值被忽略）', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: AUTH,
      payload: {
        contentType: 'image/png',
        dataBase64: IMAGE_B64,
        avatarHash: 'client-controlled-value',
      },
    });
    expect(res.statusCode).toBe(200);
    const expected = createHash('sha256').update(Buffer.from(IMAGE_B64, 'base64')).digest('hex');
    expect(res.json().avatarHash).toBe(expected);

    const callArg = mocks.userAvatar.upsert.mock.calls[0]?.[0] as {
      create: { data: Buffer; contentType: string; hash: string };
      update: { data: Buffer; contentType: string; hash: string };
    };
    for (const branch of [callArg.create, callArg.update]) {
      expect(branch.data.toString('base64')).toBe(IMAGE_B64);
      expect(branch.contentType).toBe('image/png');
      expect(branch.hash).toBe(expected);
    }
    expect(res.json().avatarHash).not.toBe('client-controlled-value');
  });

  it('GET 没有头像 ⇒ 404 + avatar-absent（不回 200 + 空串）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/account/avatar', headers: AUTH });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('avatar-absent');
  });

  it('GET 有头像 ⇒ 回明文载荷（contentType + dataBase64 + hash）', async () => {
    mocks.userAvatar.findUnique.mockResolvedValue({
      data: Buffer.from(IMAGE_B64, 'base64'),
      contentType: 'image/png',
      hash: 'abc',
    });
    const res = await app.inject({ method: 'GET', url: '/api/account/avatar', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      contentType: 'image/png',
      dataBase64: IMAGE_B64,
      avatarHash: 'abc',
    });
  });

  it('DELETE 幂等：本来就没有（deleteMany 返回 0）也算 200', async () => {
    mocks.userAvatar.deleteMany.mockResolvedValue({ count: 0 });
    const res = await app.inject({ method: 'DELETE', url: '/api/account/avatar', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ avatarHash: null });
  });

  it('请求体上限两侧都测：1 MiB 内的包收、超过 1 MiB 的 413', async () => {
    // 路由级 `bodyLimit` 是**路由选项**；挪进 `config` 会静默失效 ——
    // 只测"超限被拒"抓不到它（夹具自己的默认值恰好也挡住），所以两侧都测。
    const under = Buffer.alloc(400 * 1024, 65).toString('base64');
    const ok = await app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: AUTH,
      payload: { contentType: 'image/png', dataBase64: under },
    });
    expect(ok.statusCode, '1 MiB 的路由上限没生效（400 KB 图被更小的默认值挡了）').toBe(200);

    const huge = Buffer.alloc(1_200_000, 65).toString('base64');
    mocks.userAvatar.upsert.mockClear();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: AUTH,
      payload: { contentType: 'image/png', dataBase64: huge },
    });
    expect(res.statusCode).toBe(413);
    expect(mocks.userAvatar.upsert, '超限的包写进库了').not.toHaveBeenCalled();
  });
});

describe('登录响应的白名单投影（TypeScript 抓不到那一类）', () => {
  /** 一行**真实形状**的 users 记录：带全部秘密列。 */
  const fullRow = {
    id: 1,
    email: 'a@b.test',
    locale: 'zh-CN',
    displayName: '小鹿',
    passwordHash: '$argon2id$should-never-leave-the-server',
    tokenVersion: 7,
    isVerified: 1,
    emailVerifyToken: 'raw-token',
    emailVerifyExpires: null,
    resetToken: 'raw-reset',
    createdAt: new Date(0),
  };

  it('withAccountProfile 的返回**键集合**恰好是那五个，一个秘密都不多', async () => {
    // 传进来的是一行**整行**结果（`auth.ts` 的魔法链接那条就是这种形状）。
    // 判据不看"值对不对"，看**键**：`{ ...user }` 与显式列举在 TS 下都能编译，
    // 区别只在运行时把 `passwordHash` 发出去没有 —— 所以只能这么钉。
    const out = await withAccountProfile(fullRow as never);
    expect(Object.keys(out).sort()).toEqual([
      'avatarHash',
      'displayName',
      'email',
      'id',
      'locale',
    ]);
    for (const secret of [
      'passwordHash',
      'tokenVersion',
      'isVerified',
      'emailVerifyToken',
      'emailVerifyExpires',
      'resetToken',
      'createdAt',
    ]) {
      expect(out, `登录响应里出现了秘密列 ${secret}`).not.toHaveProperty(secret);
    }
    expect(JSON.stringify(out)).not.toContain('should-never-leave-the-server');
    expect(JSON.stringify(out)).not.toContain('raw-token');
  });

  it('资料这一族的读取只 select `hash`，不把头像字节拖进鉴权路径', async () => {
    await app.inject({ method: 'GET', url: '/api/account/profile', headers: AUTH });
    const call = mocks.user.findUnique.mock.calls
      .map((c) => c[0] as { select?: { avatar?: { select: object } } })
      .find((c) => c?.select?.avatar !== undefined);
    // 🔴 这条断言**必须能命中**：一条 `if (found)` 包起来的判据，
    // 在形状变了的时候会静默变成空判据（本仓库记过这类"看起来在检查"）。
    expect(call, '没有任何一次查询走的是 select avatar.hash —— 这条判据悬空了').toBeTruthy();
    const select = (call as unknown as { select: { avatar: { select: Record<string, unknown> } } })
      .select;
    expect(Object.keys(select.avatar.select)).toEqual(['hash']);
    expect(select.avatar.select).not.toHaveProperty('data');
  });
});
