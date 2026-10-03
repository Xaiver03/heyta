import Fastify, { FastifyInstance } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 账号语言（`users.locale`）的读侧与写侧契约
 * —— 应用语言解析链第 2 层（docs/plans/i18n-multilingual.md §3，2026-10-01 拍板）。
 *
 * 🔴 这一组要挡的不是"字段对不对"，而是**优先级**：
 *
 *   发信：`body.locale`（客户端显式）> 账号语言 > `zh-CN`
 *
 * ⚠️ 2026-10-03 起 `Accept-Language` **不在链里了**（产品负责人拍板：默认中文，
 * 英文只能是用户自己的选择 —— 浏览器语言不是选择）。这一组里那两条"带英文
 * 浏览器头"的用例因此从"回落 Accept-Language"改判成"仍然是中文"。
 *
 * 加这一列要修的真实场景：在中文浏览器里把应用切成英文的用户（客户端此刻
 * 还没带 body.locale 的旧版本），邮件永远是中文 —— 账号语言补上这个洞。
 * 而它**不许**盖过客户端显式传来的语言：那是用户此刻正看着的界面。
 *
 * 写侧：`PUT /api/account/locale` 只认 SERVER_LOCALES、只写令牌主人的行。
 */

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
}));

const authSpies = vi.hoisted(() => ({
  requestLoginMagicLink: vi.fn().mockResolvedValue({ message: 'neutral' }),
  registerWithMagicLink: vi.fn().mockResolvedValue({ message: 'neutral' }),
}));

vi.mock('../src/db', () => ({ prisma: mocks }));
// setup.ts 的导入链会把 `middleware` 的 `verifyToken` 绑定钉在**真实现**上，
// 这里的 mock 只对 api.ts 的直接导入生效 —— 所以 PUT 用例签的是**真** JWT，
// 并让 verifyToken 的查库（mock 过的 prisma）返回一行有效的已验证用户。
vi.mock('../src/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...authSpies };
});

import { apiRoutes } from '../src/api';

// 🔴 `getJwtSecret()` 跑在 `../src/auth` 的**模块顶层** ⇒ 令牌相关 import 一加载就要读它。
//    开发机上有 `server/.env` 兜着，而**干净检出（CI 的唯一形态）没有** —— 于是这文件不是断言失败，
//    是加载期就红。约定同 `password-recovery.spec.ts` / `magic-link-registration.spec.ts`：
//    用 `vi.hoisted` 在所有 import 之前把测试密钥放好，`??=` 保证自己显式设过值的文件不被覆盖。
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

let app: FastifyInstance;

// 真 secret：auth.ts 在模块加载期就从 env 取好了（server/.env 由测试进程加载）。
const SECRET = process.env.JWT_SECRET;
if (SECRET === undefined) throw new Error('测试进程里没有 JWT_SECRET —— 看 server/.env / setup 链');

const AUTH = {
  authorization: `Bearer ${jwt.sign({ userId: 1, email: 'test@test.com', tokenVersion: 0 }, SECRET, { expiresIn: '1h' })}`,
};
const EMAIL = 'polyglot@example.com';

/** verifyToken 的查库形状（PUT 路由走真 authenticate → 真查库）。 */
const VERIFIED_ROW = { id: 1, tokenVersion: 0, isVerified: 1 };

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.user.findUnique.mockResolvedValue(null);
  mocks.user.update.mockResolvedValue({ id: 1 });
  authSpies.requestLoginMagicLink.mockResolvedValue({ message: 'neutral' });
  authSpies.registerWithMagicLink.mockResolvedValue({ message: 'neutral' });

  app = Fastify();
  await app.register(apiRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('发信语言优先级：body.locale > 账号语言 > zh-CN（浏览器语言不参与）', () => {
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/api/login/magic-link', payload, headers });

  it('客户端显式 body.locale 最高 —— 哪怕账号行存的是另一种语言', async () => {
    mocks.user.findUnique.mockResolvedValue({ locale: 'zh-CN' });
    await post({ email: EMAIL, locale: 'en' });
    expect(authSpies.requestLoginMagicLink).toHaveBeenCalledWith(EMAIL, 'en');
  });

  it('🔴 没有 body.locale 时用账号语言 —— 这正是加这一列要修的场景', async () => {
    // 中文浏览器（不带 Accept-Language 的原生 fetch 正是这种）、没传 body.locale，
    // 但用户在别的设备把账号语言设成了英文 ⇒ 邮件必须是英文。
    mocks.user.findUnique.mockResolvedValue({ locale: 'en' });
    await post({ email: EMAIL });
    expect(authSpies.requestLoginMagicLink).toHaveBeenCalledWith(EMAIL, 'en');
  });

  it('账号语言赢过浏览器头 —— 头是环境噪声，账号行是明确选择', async () => {
    mocks.user.findUnique.mockResolvedValue({ locale: 'en' });
    await post({ email: EMAIL }, { 'accept-language': 'zh-CN,zh;q=0.9' });
    expect(authSpies.requestLoginMagicLink).toHaveBeenCalledWith(EMAIL, 'en');
  });

  it('🔴 没有账号语言时**中文** —— 英文浏览器头不许把首封信变成英文', async () => {
    // 2026-10-03 改判（产品负责人）：这一档原来是"回落 Accept-Language"，
    // 于是英文系统上的用户哪怕界面是中文，第一封信也是英文。
    // 变异：把 `localeFromRequest` 里的 accept-language 分支加回来 ⇒ 第一条红。
    mocks.user.findUnique.mockResolvedValue({ locale: null });
    await post({ email: EMAIL }, { 'accept-language': 'en-US,en;q=0.9' });
    expect(authSpies.requestLoginMagicLink).toHaveBeenCalledWith(EMAIL, 'zh-CN');

    await post({ email: EMAIL });
    expect(authSpies.requestLoginMagicLink).toHaveBeenLastCalledWith(EMAIL, 'zh-CN');
  });

  it('账号语言列存了集合外的值时当没有（不抛错，也不许它污染显式语言）', async () => {
    // ⚠️ 2026-10-03 改判：原来这条靠"回落 Accept-Language ⇒ en"来证明 klingon
    //   被当没有。浏览器头摘掉之后那个读数不再能区分"klingon 被忽略"和
    //   "klingon 被当默认语言"，所以判据换成显式通道：**账号行是脏值时，
    //   body.locale 必须照常赢**（脏值既没抛错、也没把请求压成默认）。
    mocks.user.findUnique.mockResolvedValue({ locale: 'klingon' });
    await post({ email: EMAIL, locale: 'en' });
    expect(authSpies.requestLoginMagicLink).toHaveBeenCalledWith(EMAIL, 'en');
  });

  it('注册端点同样吃这条优先级（客户端显式语言直通）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/register/magic-link',
      payload: { email: EMAIL, termsAccepted: true, locale: 'en' },
    });
    expect(res.statusCode).toBe(201);
    expect(authSpies.registerWithMagicLink).toHaveBeenCalledWith(
      EMAIL,
      expect.any(Number),
      undefined,
      'en',
    );
  });
});

describe('PUT /api/account/locale（解析链第 2 层的写侧）', () => {
  it('没有令牌 ⇒ 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/locale',
      payload: { locale: 'en' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('只认 SERVER_LOCALES —— 别的值一律 400，且不落库', async () => {
    mocks.user.findUnique.mockResolvedValue(VERIFIED_ROW);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/locale',
      headers: AUTH,
      payload: { locale: 'fr' },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.user.update).not.toHaveBeenCalled();
  });

  it('写进**令牌主人**那一行（归属来自令牌，不来自输入）', async () => {
    mocks.user.findUnique.mockResolvedValue(VERIFIED_ROW);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/locale',
      headers: AUTH,
      payload: { locale: 'en' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ locale: 'en' });
    // 全局 setup 把 verifyToken mock 成 userId = 1 —— 断言写的就是那一行。
    expect(mocks.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { locale: 'en' },
    });
  });
});
