import Fastify, { FastifyInstance } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 批次 E / 工单 E1：**注销账号必须是一个可辨识的信号。**
 *
 * 产品要求是「删除账号一定要彻底销毁」。服务端那半今天就是真删
 * （`api.ts` 的 `DELETE /account` → `deleteAccountWithTombstone()` → 一个事务里写墓碑 +
 * `prisma.user.delete` → 数据库级联；墓碑那半见 ADR-0055），
 * 但对用户而言"彻底销毁"还差另一半：**数据在设备上是一份明文本地库**（本地优先的设计），
 * 服务端删完之后，其它设备一行都不会少。
 *
 * 那另一半要落地，前置条件是客户端能分清"这个 401 意味着我的账号已经不存在了"
 * 和"这个 401 只是令牌被撤销 / 过期 / 邮箱还没验证"。**误判的代价是毁掉用户的数据** ——
 * 改一次密码就会让所有设备的 `tokenVersion` 前进（`auth.ts:207/:229`、`api.ts:913`），
 * 管理员强制登出、passkey 恢复同理，它们今天与"账号已注销"回的是**同一状态码**，
 * 而"注销"和"邮箱未验证"甚至共用同一句 `'Account unavailable'`。
 *
 * 所以这一组判据钉的不是"有没有 code"，而是**那条销毁动作的唯一安全触发条件**：
 * 每个可能让令牌失效的原因各自有码，且**除 ACCOUNT_CLOSED 外没有一个能长得像它**。
 *
 * ✅ 状态码那一半已随 E1b 落地（2026-10-04）：注销走 **410**，其余仍 401。
 * 留这条注释是为了让后来者看清曾经的取舍 —— 以及为什么 410 只对外说"别再重试"，
 * **客户端要不要销毁本机数据仍然只认稳定码**（见 sync-client 的 `isAccountClosedFailure`）。
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  tombstoneUpsert: vi.fn(),
  closeForUser: vi.fn(),
}));

// `DELETE /account` 走 `deleteAccountWithTombstone(tx, …)`（ADR-0055），它拿的是事务客户端，
// 所以这里必须把 `$transaction` 做成**跑回调的 runner**而不是空 mock：
// 空 mock 会让事务体根本不执行，而这条用例照样绿 —— 那正是"注销打掉缓存"这一腿最假的过法。
vi.mock('../src/db', () => ({
  prisma: {
    user: mocks,
    $transaction: (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        user: {
          findUniqueOrThrow: (...a: unknown[]) => mocks.findUniqueOrThrow(...a),
          delete: (...a: unknown[]) => mocks.delete(...a),
        },
        accountTombstone: { upsert: (...a: unknown[]) => mocks.tombstoneUpsert(...a) },
      }),
  },
}));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ closeForUser: mocks.closeForUser }),
}));

// 全局 setup 把 `../src/auth` 整个 mock 掉了；这里要用**真** verifyToken，
// 因为本轮要证的正是它内部那六个分支各自回什么码。
vi.mock('../src/auth', async (importOriginal) => await importOriginal());

vi.mock('../src/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

import { verifyToken } from '../src/auth';
import { authCache } from '../src/auth-cache';
import { apiRoutes } from '../src/api';

vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

const SECRET = process.env.JWT_SECRET;
if (SECRET === undefined) throw new Error('测试进程里没有 JWT_SECRET');

const tokenFor = (userId = 1, tokenVersion = 0, expiresIn = '1h'): string =>
  jwt.sign({ userId, email: 'user@example.com', tokenVersion }, SECRET!, { expiresIn });

const EXPIRED_TOKEN = tokenFor(1, 0, '-1s');
const GARBAGE_TOKEN = 'not-a-jwt-at-all';

/**
 * 🔴 三段的、header 能解、**payload 不是 JSON** 的一枚 —— 与上面那枚不是一回事。
 *
 * `not-a-jwt-at-all` 走的是 jsonwebtoken 的 "jwt malformed"（`JsonWebTokenError`），
 * 而这一枚在它**解码 payload 那一步**抛的是裸 `SyntaxError`：既不是 expired
 * 也不是 `JsonWebTokenError`，于是落到 `auth.ts` 末尾"数据库错误必须当 500 传播"那一支被 rethrow。
 *
 * 实测（2026-10-05 05:2x，同一台 TEST_MODE 服务端，两个请求只差令牌形状）：
 *   这一枚 → **HTTP 500** `{"statusCode":500,"error":"Internal Server Error"}`
 *   结构合法、签名错 → **HTTP 401** `{"error":"Invalid token","code":"TOKEN_INVALID"}`
 * 后果两条：① 客户端按**稳定码**判要不要销毁本机明文（ADR-0049），500 没有码 ⇒
 * 移动端把"我的令牌是坏的"渲染成 `同步失败：HTTP 500 — Internal Server Error`；
 * ② 真机验收里"401 不许清库"那条负向对照**测不到它想测的那条路径**（它拿到的是 500）。
 */
const MALFORMED_PAYLOAD_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.000000000000000000000000000000.sub-not-real';

/** 真查库那一行的形状（`isVerified` 在库里是 0/1）。 */
const VERIFIED = { id: 1, tokenVersion: 0, isVerified: 1 };
const UNVERIFIED = { id: 1, tokenVersion: 0, isVerified: 0 };

let app: FastifyInstance;

const callProtectedRoute = (token: string) =>
  app.inject({
    method: 'PUT',
    url: '/api/account/locale',
    headers: { authorization: `Bearer ${token}` },
    payload: { locale: 'en' },
  });

beforeEach(async () => {
  vi.clearAllMocks();
  authCache.clear();
  mocks.update.mockResolvedValue({ id: 1 });
  mocks.delete.mockResolvedValue({ id: 1 });
  mocks.findUniqueOrThrow.mockResolvedValue({ email: 'someone@example.test' });
  mocks.tombstoneUpsert.mockResolvedValue({ userId: 1 });
  mocks.findUnique.mockResolvedValue(VERIFIED);

  app = Fastify();
  await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('失效原因的可辨识码（真 verifyToken）', () => {
  it('🔴 账号行不存在（注销过的账号）⇒ ACCOUNT_CLOSED', async () => {
    mocks.findUnique.mockResolvedValue(null);

    const result = await verifyToken(tokenFor());

    expect(result).toMatchObject({ valid: false, code: 'ACCOUNT_CLOSED' });
  });

  it('🔴 邮箱未验证 ⇒ 不得是 ACCOUNT_CLOSED（否则"没点验证链接"会被当成可以删库）', async () => {
    mocks.findUnique.mockResolvedValue(UNVERIFIED);

    const result = await verifyToken(tokenFor());

    expect(result).toMatchObject({ valid: false, code: 'ACCOUNT_UNVERIFIED' });
    expect(result).not.toMatchObject({ code: 'ACCOUNT_CLOSED' });
    // 这两支以前共用同一句 reason —— 那句文本现在仍然共用，所以**文本不能当判据**：
    expect(result).toMatchObject({ reason: 'Account unavailable' });
  });

  it('🔴 tokenVersion 不符 ⇒ TOKEN_REVOKED，不得等于注销', async () => {
    // 这一支同时覆盖：改密码、登出所有设备、管理员强制登出、passkey 恢复、撤销并换发令牌。
    // 它们**都不是注销**，账号名下的数据还在。
    mocks.findUnique.mockResolvedValue({ ...VERIFIED, tokenVersion: 7 });

    const result = await verifyToken(tokenFor(1, 0));

    expect(result).toMatchObject({ valid: false, code: 'TOKEN_REVOKED' });
    expect(result).not.toMatchObject({ code: 'ACCOUNT_CLOSED' });
  });

  it('过期与签名无效 ⇒ TOKEN_INVALID，不得等于注销', async () => {
    const expired = await verifyToken(EXPIRED_TOKEN);
    expect(expired).toMatchObject({ valid: false, code: 'TOKEN_INVALID' });

    const garbage = await verifyToken(GARBAGE_TOKEN);
    expect(garbage).toMatchObject({ valid: false, code: 'TOKEN_INVALID' });

    for (const r of [expired, garbage]) expect(r).not.toMatchObject({ code: 'ACCOUNT_CLOSED' });
  });

  it('🔴 payload 解不出 JSON 的令牌 ⇒ 401 TOKEN_INVALID，不是 500、更不是注销', async () => {
    // 单元层：这一枚**不许抛出去**（抛出去=路由层 500）。
    const result = await verifyToken(MALFORMED_PAYLOAD_TOKEN);
    expect(result).toMatchObject({ valid: false, code: 'TOKEN_INVALID' });
    expect(result).not.toMatchObject({ code: 'ACCOUNT_CLOSED' });

    // 路由层：判的是用户真正看到的那个数 —— 500 会被移动端渲染成"同步失败：HTTP 500"，
    // 而按稳定码判是否清库的那条链在 500 上**什么都读不到**。
    const res = await callProtectedRoute(MALFORMED_PAYLOAD_TOKEN);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('数据库故障仍然抛出去，不许伪装成任何一种失效码', async () => {
    // 这是既有立场（auth.ts 的注释原话：DB 错误必须当 500，不能冒充鉴权失败）。
    // 本轮它多了一层意义：**"读不到库"绝不能被客户端读成"账号注销了"进而删本地库。**
    mocks.findUnique.mockRejectedValue(new Error('db down'));

    await expect(verifyToken(tokenFor())).rejects.toThrow('db down');
  });

  it('正向对照：正常账号仍然通过，且**不带**失效码', async () => {
    const result = await verifyToken(tokenFor());

    expect(result).toEqual({ valid: true, userId: 1, email: 'user@example.com' });
  });
});

describe('稳定码要出到线上（真路由 + 真 authenticate）', () => {
  it('🔴 账号已注销：**410** 响应体带 code=ACCOUNT_CLOSED（E1b）', async () => {
    mocks.findUnique.mockResolvedValue(null);

    const res = await callProtectedRoute(tokenFor());

    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ code: 'ACCOUNT_CLOSED' });
  });

  it('🔴 410 是**注销独占**的：其余三种失效各自仍是 401，且码各不相同', async () => {
    // 这一条钉的是"状态码这一维也携带了信息"：410 只说"这个账号永远不会再有效"。
    // 把 TOKEN_REVOKED（改口令 / 被踢下线）也推到 410，就等于对外宣称
    // "重新登录也没用" —— 而那种情况下用户重新登录是**能**继续用的。
    const cases: Array<[string, () => void, string]> = [
      ['TOKEN_REVOKED', () => mocks.findUnique.mockResolvedValue({ ...VERIFIED, tokenVersion: 3 }), tokenFor(1, 0)],
      ['ACCOUNT_UNVERIFIED', () => mocks.findUnique.mockResolvedValue(UNVERIFIED), tokenFor()],
    ];
    for (const [expected, seed, token] of cases) {
      authCache.clear();
      seed();
      const res = await callProtectedRoute(token);
      expect(res.statusCode, expected).toBe(401);
      expect(res.json().code, expected).toBe(expected);
    }
    authCache.clear();
    const expired = await callProtectedRoute(EXPIRED_TOKEN);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().code).toBe('TOKEN_INVALID');
  });

  it('没带 Authorization 头 ⇒ 401 但响应体里没有任何注销码', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/account/locale', payload: { locale: 'en' } });

    expect(res.statusCode).toBe(401);
    // 这条是"缺令牌"，与"账号没了"是两件事；缺 code 就是它的信号。
    expect(res.json()).not.toHaveProperty('code');
  });

  it('🔴 注销那一次必须打掉鉴权缓存里的 ghost：预热后注销，旧令牌再请求要 410 ACCOUNT_CLOSED', async () => {
    // `api.ts` 在 delete 前后各 invalidate 一次。这条腿钉的就是那两行：
    // 缓存里如果留着"这个 userId 有效"，注销后的设备会**继续成功**，
    // 于是既拿不到销毁信号、也说明"删了"这件事在响应面上根本不可见。
    const token = tokenFor();
    expect(await verifyToken(token)).toMatchObject({ valid: true }); // 预热缓存

    mocks.findUnique.mockResolvedValue(null); // 账号行已经级联删掉了

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleted.statusCode).toBe(200);

    const after = await callProtectedRoute(token);
    expect(after.statusCode).toBe(410);
    expect(after.json()).toMatchObject({ code: 'ACCOUNT_CLOSED' });
  });
});
