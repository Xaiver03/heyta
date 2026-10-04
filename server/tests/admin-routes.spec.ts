import { readFile } from 'node:fs/promises';
import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDEMPTION_STATES, type RedemptionState } from '../src/billing/pricing-store';

/**
 * `/api/admin/*` 的**安全边界**与契约。
 *
 * 管理端点是这个服务端上权限最高的一组路径 —— 它能读到全站用户与订单。
 * 所以下面钉的不是"字段对不对"，而是**谁能进来**：
 *
 *   1. 没有令牌 ⇒ 401；
 *   2. 有令牌但 `is_admin = false` ⇒ 403；
 *   3. 有令牌但用户已不存在 ⇒ **同一个** 403（不泄漏"这个账号存在但没权限"）；
 *   4. 只有 `is_admin = true` 才拿得到数据。
 *
 * 另外两条容易写错的：
 *   - 🔴 **白名单投影**：数据库把 `passwordHash` 也返回时，响应里不许有它；
 *   - 🔴 **BigInt 序列化**：Prisma 的时间戳/金额列是 `BigInt`，漏一个转换就是整个端点 500。
 *
 * 全局 setup 把 `verifyToken` mock 成"任何 Bearer 都有效、userId = 1"
 * （`tests/setup.ts`），所以这里只控制"1 号用户是不是管理员"。
 */

const mocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  subscription: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  checkoutOrder: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  coupon: { count: vi.fn(), findMany: vi.fn() },
  couponRedemption: { count: vi.fn() },
  inviteCode: { count: vi.fn(), findMany: vi.fn() },
  referral: { count: vi.fn(), findMany: vi.fn() },
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

import { adminRoutes } from '../src/admin/admin.routes';

let app: FastifyInstance;

const AUTH = { authorization: 'Bearer test-token' };
const ADMIN_ROW = { isAdmin: true };
const NON_ADMIN_ROW = { isAdmin: false };

/** 让 `requireAdmin` 的查库返回"是/不是管理员"。 */
const setAdmin = (isAdmin: boolean): void => {
  mocks.user.findUnique.mockResolvedValue(isAdmin ? ADMIN_ROW : NON_ADMIN_ROW);
};

beforeEach(async () => {
  vi.clearAllMocks();

  mocks.subscription.groupBy.mockResolvedValue([]);
  mocks.subscription.count.mockResolvedValue(0);
  mocks.subscription.findMany.mockResolvedValue([]);
  mocks.checkoutOrder.groupBy.mockResolvedValue([]);
  mocks.checkoutOrder.count.mockResolvedValue(0);
  mocks.checkoutOrder.findMany.mockResolvedValue([]);
  mocks.coupon.count.mockResolvedValue(0);
  mocks.coupon.findMany.mockResolvedValue([]);
  mocks.couponRedemption.count.mockResolvedValue(0);
  mocks.inviteCode.count.mockResolvedValue(0);
  mocks.inviteCode.findMany.mockResolvedValue([]);
  mocks.referral.count.mockResolvedValue(0);
  mocks.referral.findMany.mockResolvedValue([]);
  mocks.user.count.mockResolvedValue(0);
  mocks.user.findMany.mockResolvedValue([]);

  app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const ALL_ROUTES: readonly (readonly [string, string])[] = [
  ['GET', '/api/admin/overview'],
  ['GET', '/api/admin/users'],
  ['GET', '/api/admin/users/1'],
  ['POST', '/api/admin/users/1/unlock'],
  ['POST', '/api/admin/users/1/quota'],
  ['POST', '/api/admin/users/1/logout'],
  ['GET', '/api/admin/subscriptions'],
  ['GET', '/api/admin/orders'],
  ['GET', '/api/admin/coupons'],
  ['GET', '/api/admin/invites'],
  // W4b 调休/补班录入面（三条新路由；判据细节在 `holiday-admin-routes.spec.ts`，
  // 这里只管一件事：**它们进不了闸门就没有任何别的地方在守**）。
  ['GET', '/api/admin/holiday-adjustments'],
  ['PUT', '/api/admin/holiday-adjustments/years'],
  ['DELETE', '/api/admin/holiday-adjustments/years?year=2027'],
];

/**
 * 🔴 「遍历全部路由」这句话**此前是假的** —— 上面那张表是手抄的，
 * 新增一条路由不会自动进这本账，而漏掉的那条正好是"没人测它有没有闸门"的那条。
 * 下面三条用例把它变成真的：路由清单从**注册完成的 app** 里取，与表逐条对账。
 *
 * 为什么用「数方法条目」而不是「解析 `printRoutes()` 的路径树」：
 * 那棵树带**前缀压缩**（实测输出里 `overview` 与 `orders` 挂在 `o` 底下，
 * 参数化路由写成 `:id` 再套一层 `/`）。自己拼路径字符串的解析器会数出
 * `/o/verview` 这种东西，于是每条都"未注册"，红的原因和真实原因无关。
 * 数 `METHOD` 条目 + 用 `inject` 探"存不存在"这两件事都不依赖树形，
 * 而它们合起来覆盖了两个方向（表里有但没注册 / 注册了但表里没有）。
 *
 * `HEAD` 一律排除：Fastify 给每条 GET 自动加一个 HEAD，它不是一个新入口。
 */
function registeredMethodCount(): number {
  const groups = app.printRoutes({ commonDeps: false }).match(/\(([^)]*)\)/g) ?? [];
  return groups.reduce(
    (acc, group) =>
      acc + group.slice(1, -1).split(',').filter((m) => m.trim() !== 'HEAD').length,
    0,
  );
}

describe('🔴 「遍历全部路由」这句话本身（判据的判据）', () => {
  it('表里每一条都**真的注册了** —— 未注册的入口 `inject` 会是 404', async () => {
    for (const [method, url] of ALL_ROUTES) {
      const res = await app.inject({ method, url });
      // 闸门命中是 401（preHandler 在路由**之后**跑），路由没了才是 404。
      // 把这条单独钉出来，是为了让"路由改名了"报在这里，
      // 而不是让上面那两个 describe 报成"某条路由没有闸门"—— 那是假根因。
      expect(res.statusCode, `${method} ${url} 没有注册`).not.toBe(404);
    }
  });

  it('反方向：注册数 == 表长 ⇒ 新增入口**必须**先登记进这张表', () => {
    // 有人加了一条 `/api/admin/refunds` 而没写进表 ⇒ 这里 12 !== 13 当场红。
    // ⚠️ 这条是**数量**对账，不是集合对账：它能拦住"忘了登记"这一类，
    //    拦不住"登记的 URL 拼错了但同时漏了另一条"这种两两抵消。
    //    后一半由上面那条（逐条非 404）补 —— 两条合起来才闭合，删任何一条都会留一个洞。
    expect(registeredMethodCount()).toBe(ALL_ROUTES.length);
  });

  it('解析器自己也要有哨兵：数出来 0 条就是解析器坏了，不是"没有路由"', () => {
    // §7 元规则 2：一条永远通过的判据比没有判据更糟。
    // `?? []` 让"匹配失败"变成 0，而 `0 === 0` 在表为空时会假绿 ——
    // 所以这里断言它数得出的**就是**表的长度，且长度本身 > 0。
    expect(ALL_ROUTES.length).toBeGreaterThan(0);
    expect(registeredMethodCount()).toBeGreaterThan(0);
  });
});

describe('🔴 准入：插件级闸门覆盖**每一条**路由', () => {
  it('没有 Authorization 头 ⇒ 每条路由都是 401', async () => {
    for (const [method, url] of ALL_ROUTES) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('有令牌但不是管理员 ⇒ 每条路由都是 403', async () => {
    setAdmin(false);
    for (const [method, url] of ALL_ROUTES) {
      const res = await app.inject({ method, url, headers: AUTH });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('🔴 用户不存在与"不是管理员"返回**同一个**响应（不泄漏账号是否存在）', async () => {
    mocks.user.findUnique.mockResolvedValue(null);
    const missing = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: AUTH });

    setAdmin(false);
    const notAdmin = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: AUTH });

    expect(missing.statusCode).toBe(403);
    expect(missing.statusCode).toBe(notAdmin.statusCode);
    expect(missing.body).toBe(notAdmin.body);
  });

  it('管理员 ⇒ 通过闸门（拿到 200）', async () => {
    setAdmin(true);
    const res = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: AUTH });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /overview', () => {
  it('🔴 BigInt 的金额与时间戳能序列化（漏转换 = 整个端点 500）', async () => {
    setAdmin(true);
    mocks.subscription.groupBy.mockResolvedValue([
      { status: 'active', _count: { _all: 3 } },
      { status: 'canceled', _count: { _all: 1 } },
    ]);
    // 两个 groupBy 调用形状不同：按 status 的与按 currency 的。
    mocks.checkoutOrder.groupBy.mockImplementation((args: { by: string[] }) =>
      Promise.resolve(
        args.by[0] === 'currency'
          ? [{ currency: 'CNY', _sum: { finalAmountMinor: 12_345n }, _count: { _all: 2 } }]
          : [{ status: 'paid', _count: { _all: 2 } }],
      ),
    );

    const res = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: AUTH });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orders.paidByCurrency).toEqual([
      { currency: 'CNY', paidOrders: 2, revenueMinor: 12345 },
    ]);
    // 营收按币种分组，不做跨币种求和 —— 混币求和是一个"错得很像真的"的数字。
    expect(Array.isArray(body.orders.paidByCurrency)).toBe(true);
  });

  it('"有效订阅"用的是 entitlement 的状态词表，不是写死的字符串', async () => {
    setAdmin(true);
    mocks.subscription.groupBy.mockResolvedValue([
      { status: 'active', _count: { _all: 3 } },
      { status: 'past_due', _count: { _all: 5 } },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: AUTH });
    const body = res.json();

    expect(body.subscriptions.total).toBe(8);
    // `DEFAULT_ENTITLEMENT_POLICY` 只有 active 算有效 ⇒ past_due 不计入。
    expect(body.subscriptions.active).toBe(3);
    expect(body.subscriptions.entitledStatuses).toContain('active');
  });

  it('🔴 「已结算的核销」数的是 `settledAt` 那一列，不是 `state` 的一个取值', async () => {
    setAdmin(true);
    mocks.couponRedemption.count.mockResolvedValue(7);

    const res = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: AUTH });

    // 词表（`REDEMPTION_STATES`）里没有 `settled` 这个取值：写 `state: 'settled'`
    // 会命中一个**存在的索引**，于是又快又错地恒返回 0 —— 界面上就是一个"没人用券"。
    expect(mocks.couponRedemption.count).toHaveBeenCalledWith({ where: { settledAt: { not: null } } });
    expect(res.json().coupons.settledRedemptions).toBe(7);
  });

  it('🔴 管理路由里出现的核销状态字面量必须全部来自词表（真源只有一处）', async () => {
    const src = await readFile(new URL('../src/admin/admin.routes.ts', import.meta.url), 'utf8');
    // ⚠️ 必须先剥注释再匹配：本文件上面那段解释"以前写成 `state: 'settled'`"的注释
    //   本身就是**对这个形状的转述**，不剥的话分类器会把说明当成违规。
    const code = src
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
      .join('\n');
    const literals = [...code.matchAll(/state:\s*'([a-z_]+)'/g)].map((m) => m[1]);
    const outside = literals.filter((s) => !REDEMPTION_STATES.includes(s as RedemptionState));
    expect(outside, `词表外的核销状态：${outside.join(', ')}`).toEqual([]);

    // 阳性对照：这条分类器自己必须能红 —— 拿一个已知违规的写法喂它。
    const probe = [...`count({ where: { state: 'settled' } })`.matchAll(/state:\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(probe.filter((s) => !REDEMPTION_STATES.includes(s as RedemptionState))).toEqual(['settled']);
  });
});

describe('🔴 用户列表的白名单投影', () => {
  it('数据库返回了 passwordHash / token，响应里也**一个都不许有**', async () => {
    setAdmin(true);
    mocks.user.findMany.mockResolvedValue([
      {
        id: 1,
        email: 'a@example.test',
        isVerified: 1,
        isAdmin: false,
        lockedUntil: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        storageUsedBytes: 10n,
        storageQuotaBytes: 20n,
        // 这些列**不在** select 里，但如果有人把投影改成 `...row`，它们就会漏出去。
        passwordHash: '$argon2id$secret',
        loginToken: 'secret-token',
        verificationToken: 'secret-verification',
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: AUTH });

    expect(res.statusCode).toBe(200);
    const [row] = res.json().items;
    expect(Object.keys(row).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'isAdmin',
      'isVerified',
      'locked',
      'lockedUntil',
      'storageQuotaBytes',
      'storageUsedBytes',
    ]);
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('secret-token');
    expect(res.body).not.toContain('argon2id');
  });

  it('🔴 `locked` 是**算出来的**：过期的 lockedUntil 不算锁定', async () => {
    setAdmin(true);
    const past = BigInt(Date.now() - 60_000);
    const future = BigInt(Date.now() + 60_000);
    mocks.user.findMany.mockResolvedValue([
      {
        id: 1,
        email: 'past@example.test',
        isVerified: 1,
        isAdmin: false,
        lockedUntil: past,
        createdAt: new Date(0),
        storageUsedBytes: 0n,
        storageQuotaBytes: 1n,
      },
      {
        id: 2,
        email: 'future@example.test',
        isVerified: 1,
        isAdmin: false,
        lockedUntil: future,
        createdAt: new Date(0),
        storageUsedBytes: 0n,
        storageQuotaBytes: 1n,
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: AUTH });
    const items = res.json().items as { email: string; locked: boolean }[];

    // 一个过去的时间戳在前端看是"已锁定"，而它其实早就自动解锁了。
    expect(items.find((u) => u.email === 'past@example.test')?.locked).toBe(false);
    expect(items.find((u) => u.email === 'future@example.test')?.locked).toBe(true);
  });
});

describe('三个支持动作', () => {
  it('🔴 解锁必须**同时**清 lockedUntil 与 failedLoginAttempts', async () => {
    setAdmin(true);
    mocks.user.update.mockResolvedValue({ id: 1, email: 'a@example.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/1/unlock',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    // 只清 lockedUntil 的话，用户再输错一次就**立刻**又被锁上，工单会再来一次。
    expect(mocks.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lockedUntil: null, failedLoginAttempts: 0 } }),
    );
  });

  it('强制登出走 tokenVersion 自增（而不是"删令牌"，JWT 是无状态的）', async () => {
    setAdmin(true);
    mocks.user.update.mockResolvedValue({ id: 1, email: 'a@example.test', tokenVersion: 4 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/1/logout',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tokenVersion: { increment: 1 } } }),
    );
  });

  it('配额：拒绝 0（那会制造一个用户看不懂的"神秘同步失败"）', async () => {
    setAdmin(true);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/1/quota',
      headers: AUTH,
      payload: { quotaBytes: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.user.update).not.toHaveBeenCalled();
  });

  it('配额：合法值写进去', async () => {
    setAdmin(true);
    mocks.user.update.mockResolvedValue({
      id: 1,
      email: 'a@example.test',
      storageQuotaBytes: 2_097_152n,
      storageUsedBytes: 0n,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/1/quota',
      headers: AUTH,
      payload: { quotaBytes: 2_097_152 },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { storageQuotaBytes: 2_097_152n } }),
    );
  });

  it('用户不存在（Prisma P2025）⇒ 404，不是 500', async () => {
    setAdmin(true);
    mocks.user.update.mockRejectedValue(
      Object.assign(new Error('Record to update not found.'), { code: 'P2025' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/999/unlock',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(404);
  });
});
