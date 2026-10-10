import Fastify, { FastifyInstance } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/account/legal-consent` 两条路由的**路由级**契约（G-27）。
 *
 * 判定与写入的逻辑不在这儿测 —— 那些在 `legal-recheck.spec.ts`（18 条，六道变异）。
 * 这一份只测**只有路由层才有**的四件事，因为它们坏了不会让逻辑层的任何一条变红：
 *
 * | 判据 | 坏了会怎样 |
 * |---|---|
 * | 没有 Authorization → **401** | 未登录也能读到"这个账号同意过哪一版"，以及**替别人写一条同意记录** —— 那是伪造留痕 |
 * | `userId` 只取自令牌 | 传别人的 id 就能替别人确认，留痕当场变成假证据 |
 * | 请求体形状 → **400** | 缺字段时被当成"版本不符"（409），客户端会以为要重新登录而不是自己写错了 |
 * | 逻辑层的两个拒绝码 → **409** 而不是 200 | 客户端把"没写进去"读成"已经确认过了"，于是不再弹窗 —— 补签在这条路上静默失效 |
 *
 * 🔴 这里的 401 走的是**真 `authenticate`**（只桩掉 `../src/auth` 里的注册/登录函数，
 * `verifyToken` 与 `middleware.ts` 都是真的），所以"忘挂 preHandler"这类错误会真的红。
 */

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  userConsent: { findFirst: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../src/db', () => ({ prisma: mocks }));
vi.mock('../src/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requestLoginMagicLink: vi.fn().mockResolvedValue({ message: 'neutral' }),
    registerWithMagicLink: vi.fn().mockResolvedValue({ message: 'neutral' }),
  };
});

import { apiRoutes } from '../src/api';
import { LEGAL_SET_VERSION } from '../src/legal.generated';

// 🔴 `getJwtSecret()` 跑在 `../src/auth` 的**模块顶层** ⇒ 令牌相关 import 一加载就要读它。
//    开发机上有 `server/.env` 兜着，而**干净检出（CI 的唯一形态）没有** —— 于是这文件不是断言失败，
//    是加载期就红。约定同 `password-recovery.spec.ts` / `magic-link-registration.spec.ts`：
//    用 `vi.hoisted` 在所有 import 之前把测试密钥放好，`??=` 保证自己显式设过值的文件不被覆盖。
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

const OLD = 'terms@1.0;privacy@1.0;minors@1.0';
const OFFICIAL_URL = 'https://heyta.waytofuture.cn';
const SELF_HOSTED_URL = 'https://heyta.example-corp.com';

let app: FastifyInstance;

const SECRET = process.env.JWT_SECRET;
if (SECRET === undefined) throw new Error('测试进程里没有 JWT_SECRET —— 看 server/.env / setup 链');

const authHeaderFor = (userId: number) => ({
  authorization: `Bearer ${jwt.sign(
    { userId, email: `u${userId}@example.test`, tokenVersion: 0 },
    SECRET,
    { expiresIn: '1h' },
  )}`,
});

const VERIFIED_ROW = { id: 7, tokenVersion: 0, isVerified: 1 };

const setPublicUrl = (url: string) => {
  process.env.PUBLIC_URL = url;
};

beforeEach(async () => {
  vi.clearAllMocks();
  setPublicUrl(OFFICIAL_URL);

  // `user.findUnique` 同时被两处用到：真 authenticate 查令牌版本，判定读那列指针。
  // 按 select 里有没有 termsDocumentVersion 分流 —— 而不是靠调用顺序猜是哪一处。
  mocks.user.findUnique.mockImplementation(async ({ select }: any) => {
    if (select && 'termsDocumentVersion' in select) {
      return { termsAcceptedAt: BigInt(1_700_000_000_000), termsDocumentVersion: OLD };
    }
    return VERIFIED_ROW;
  });
  mocks.user.update.mockResolvedValue({ id: 7 });
  mocks.userConsent.findFirst.mockResolvedValue(null);
  mocks.userConsent.create.mockImplementation(async ({ data }: any) => data);
  mocks.userConsent.upsert.mockImplementation(async ({ create }: any) => create);
  mocks.$transaction.mockImplementation(async (fn: any) =>
    typeof fn === 'function' ? fn(mocks) : Promise.all(fn),
  );

  app = Fastify();
  await app.register(apiRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  delete process.env.PUBLIC_URL;
});

describe('GET /api/account/legal-consent', () => {
  it('没有 Authorization → 401，且**一次判定都没跑**（不拿匿名请求去查账号）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/account/legal-consent' });
    expect(res.statusCode).toBe(401);
    expect(mocks.userConsent.findFirst).not.toHaveBeenCalled();
  });

  it('登录后指针是旧版 → 200 且 `needsReconfirm: true`，把两版都带回去', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/account/legal-consent',
      headers: authHeaderFor(7),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      needsReconfirm: true,
      reason: 'version-changed',
      currentVersion: LEGAL_SET_VERSION,
      recordedVersion: OLD,
    });
  });

  it('🔴 自建实例 → 200 且 `needsReconfirm: false`（那台机器上没有可宣告的版本）', async () => {
    setPublicUrl(SELF_HOSTED_URL);
    const res = await app.inject({
      method: 'GET',
      url: '/api/account/legal-consent',
      headers: authHeaderFor(7),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().needsReconfirm).toBe(false);
    expect(res.json().reason).toBe('not-applicable');
    // 且不查库 —— 不查是"这条路整体关闭"的证据，不是省一次查询而已。
    expect(mocks.userConsent.findFirst).not.toHaveBeenCalled();
  });

  it('返回的是**结构化原因码**，没有任何文案（文案归 packages/i18n）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/account/legal-consent',
      headers: authHeaderFor(7),
    });
    const body = res.json();
    expect(['current', 'version-changed', 'unprovable', 'not-applicable']).toContain(body.reason);
    // 汉字出现在服务端对外响应里 = 公页语域门禁之外的一条泄漏路径。
    expect(JSON.stringify(body)).not.toMatch(/[一-鿿]/);
  });
});

describe('POST /api/account/legal-consent', () => {
  const good = { documentVersion: LEGAL_SET_VERSION, acceptedAt: 1_800_000_000_000 };

  it('没有 Authorization → 401，且**没写任何一行**', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/legal-consent',
      payload: good,
    });
    expect(res.statusCode).toBe(401);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(mocks.userConsent.upsert).not.toHaveBeenCalled();
  });

  it('带着**当前这一版**来确认 → 200，且整件事只开一次事务', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/legal-consent',
      headers: authHeaderFor(7),
      payload: good,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, recordedVersion: LEGAL_SET_VERSION });
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    // 指针必须跟着更新，否则下一个人启动时又被同一版拦一次。
    expect(mocks.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { termsDocumentVersion: LEGAL_SET_VERSION } }),
    );
  });

  it('缺字段 / 类型不对 → **400**（不是 409：那是客户端写错了请求，不是状态不允许）', async () => {
    // 🔴 每个 payload 只缺/错**一个**字段，并且断言 issue 的 path 就是那个字段。
    // 把多种非法塞进同一条 `{}` 用例是假判据：`{}` 会因为缺 acceptedAt 而 400，
    // 于是"拿掉 documentVersion 的必填"这条变异照样全绿（实测过，见台账 G-27 行）。
    const cases: Array<[string, unknown, string]> = [
      ['缺 documentVersion', { acceptedAt: 1_800_000_000_000 }, 'documentVersion'],
      ['缺 acceptedAt', { documentVersion: LEGAL_SET_VERSION }, 'acceptedAt'],
      ['空串版本', { documentVersion: '', acceptedAt: 1_800_000_000_000 }, 'documentVersion'],
      ['时刻不是整数', { documentVersion: LEGAL_SET_VERSION, acceptedAt: 'x' }, 'acceptedAt'],
    ];
    for (const [label, payload, path] of cases) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/account/legal-consent',
        headers: authHeaderFor(7),
        payload,
      });
      expect({ label, code: res.statusCode }).toEqual({ label, code: 400 });
      const issues = (res.json() as { details?: Array<{ path?: unknown[] }> }).details;
      expect({ label, paths: issues?.map((i) => i.path?.join('.')) }).toEqual({ label, paths: [path] });
      expect(mocks.$transaction).not.toHaveBeenCalled();
    }
  });

  it('🔴 拿旧版来确认 → 409 `version_mismatch`，零写入（不许写出一条版本号写错的留痕）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/legal-consent',
      headers: authHeaderFor(7),
      payload: { documentVersion: OLD, acceptedAt: 1_800_000_000_000 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'version_mismatch', message: 'Legal consent could not be recorded.' });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('自建实例上确认 → 409 `instance_cannot_name_text`，零写入', async () => {
    setPublicUrl(SELF_HOSTED_URL);
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/legal-consent',
      headers: authHeaderFor(7),
      payload: good,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'instance_cannot_name_text', message: 'Legal consent could not be recorded.' });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 `userId` 只取自令牌：另一个人带着自己的令牌**碰不到**别人的行', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/account/legal-consent',
      headers: authHeaderFor(42),
      payload: { ...good, userId: 7 } as unknown,
    });
    // BigInt 会把 JSON.stringify 直接炸掉（`acceptedAt` 就是 BigInt），所以序列化要带 replacer。
    const calls = [mocks.user.update, mocks.userConsent.upsert, mocks.userConsent.create]
      .flatMap((m) => m.mock.calls)
      .map((c) => JSON.stringify(c, (_k, v) => (typeof v === 'bigint' ? `n:${v}` : v)));
    expect(calls.length).toBeGreaterThan(0);
    // 42 = 令牌主人；7 = 请求体里塞的那个别人的 id。
    expect(calls.some((call) => call.includes('"userId":7'))).toBe(false);
    expect(calls.every((call) => call.includes('42'))).toBe(true);
  });
});
