/**
 * 后台三种订阅发放的判据（ADR-0076）。
 * =====================================
 *
 * 这一组钉的不是"能不能点"，是**发放会不会说出一句假话**。九类，每条都能红：
 *
 *   1. 🔴 **发放不建订单行**。营收看板只读 `checkout_orders` 与 `refunds`，所以
 *      "赠送不污染营收"必须是**结构**上的，而不是"我们记得没写那张表"。
 *      载体：事务里那个 `tx` 只有三个 model，任何 `tx.checkoutOrder.…` 都会当场抛。
 *   2. 🔴 **只写 `provider='admin-grant'` 那一行**：`findFirst` 的 `where` 必须带
 *      provider。少了它，"收回"会去动那个付过钱的人的到期日 —— 而付费行是
 *      "有人买过"的证据，改它就是伪造购买事实（ADR-0076 §3.1）。
 *   3. `grants` 从 SKU 派生，**客户端发不出来**：载荷是 `strictObject`。
 *   4. 未知 SKU ⇒ 400 且**不落任何一行**（`grantsForSku` 的 `null` 不许折成 `[]`）。
 *   5. 交付不了的档位 ⇒ 409，理由原样带出（收银台挡住的东西后台也挡）。
 *   6. `days` 越界 / 非整数 ⇒ 400，且不进事务。
 *   7. 🔴 审计与订阅写在**同一个事务**里 —— 两个方向都要能红：写成根 client 不行，
 *      挪到事务返回之后再补也不行。所以这里的桩是**两套 spy**：`mocks`（根）与
 *      `txMocks`（事务里）。共用一套 spy 的话，`tx.` 改成 `client.` 是测不出来的。
 *   8. `upgrade` **不改** `currentPeriodEnd`（它的定义就是"一天都不加"）。
 *   9. 没有有效发放行时 `revoke`/`upgrade` ⇒ 409，界面不许把"没动到东西"说成"已完成"。
 *
 * 全部假 prisma：这一组不碰库。表**形状**的证据在
 * `subscription-grant-schema.pglite.spec.ts`（那份跑的是发布中的迁移文件）。
 *
 * ⚠️ 本文件用 `vi.useFakeTimers({ toFake: ['Date'] })` 把 `Date.now()` 钉在 `NOW` 上。
 *   不这么做会得到一类**只有机器时区不是 UTC 时才出现**的假失败：`NOW` 取 08:00Z，
 *   而这台开发机（UTC+8）的真实时刻在它之前，于是"周期已过的行"在 store 眼里还没过期。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

import { DEFAULT_PRICE_BOOK, SKU_GRANTS } from '../src/billing/price-book';

/**
 * 「这一档现在交付不了」是一种**临时状态**，而 `NOT_YET_DELIVERABLE_SKUS` 现在是空的
 * （ADR-0054 之后）。空清单不等于"这条闸门不需要测" —— 恰恰相反：没有下一档进来时，
 * 这条判据是**唯一**能证明那道调用还在的地方。
 *
 * 所以这里只把 `notSellableReason` 换成一个可注入的版本，其余（`SKU_GRANTS`、
 * `grantsForSku`、`resolveEffectivePrice`…）**保持真的那一份** —— 全 mock 会测到一个
 * 不存在的模块图，而"闸门还在"这件事就又变回一句注释。
 */
const priceBookMock = vi.hoisted(() => ({ blocked: null as string | null }));

vi.mock('../src/billing/price-book', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/billing/price-book')>();
  return {
    ...actual,
    notSellableReason: (priceId: string) =>
      priceBookMock.blocked === priceId
        ? '云端 AI 的计量还没接上'
        : actual.notSellableReason(priceId),
  };
});

/** 根 client：路由拿到的那一枚。后台的写**一张都不许落到这里**。 */
const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  subscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  subscriptionGrant: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
}));

/** 事务里那一枚。与 `mocks` **分开**是判据 7 的载体（见文件头）。 */
const txMocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  subscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  subscriptionGrant: { create: vi.fn() },
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

const { adminRoutes } = await import('../src/admin/admin.routes');
const {
  ADMIN_GRANT_PROVIDER,
  GRANT_DAYS_MAX,
  grantSubscription,
  listGrantSkuOptions,
  resolveGrantGrants,
} = await import('../src/admin/subscription-grant-store');

let app: FastifyInstance;
const AUTH = { authorization: 'Bearer test-token' };

const NOW = Date.parse('2026-10-25T08:00:00.000Z');
const DAY = 86_400_000;

/** 一条库里的发放行。`over` 用来造"已收回""已过期""没有周期"这些形状。 */
const grantRow = (
  over: Partial<{
    id: number;
    userId: number;
    provider: string | null;
    priceId: string | null;
    grants: string[];
    status: string | null;
    currentPeriodEnd: bigint | null;
  }> = {}
) => ({
  id: 11,
  userId: 5,
  provider: ADMIN_GRANT_PROVIDER,
  externalSubscriptionId: null,
  priceId: 'hosted-monthly',
  grants: ['hosting'],
  status: 'active',
  currentPeriodEnd: BigInt(NOW + 30 * DAY),
  lastEventAt: BigInt(NOW),
  createdAt: BigInt(NOW),
  updatedAt: BigInt(NOW),
  ...over,
});

const txPayload = () => ({
  user: txMocks.user,
  subscription: txMocks.subscription,
  subscriptionGrant: txMocks.subscriptionGrant,
});

beforeEach(async () => {
  vi.clearAllMocks();
  priceBookMock.blocked = null;
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });

  // `tests/setup.ts` 把 `verifyToken` 钉成"任何 Bearer 都有效、userId = 1"，
  // 所以 actor 一定是 1；后台判权那一步查的是 1 号是不是管理员（走的是**根** client）。
  mocks.user.findUnique.mockResolvedValue({ isAdmin: true });
  txMocks.user.findUnique.mockResolvedValue({ id: 5 });

  txMocks.subscription.findFirst.mockResolvedValue(null);
  txMocks.subscription.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 11,
      userId: 5,
      externalSubscriptionId: null,
      lastEventAt: BigInt(NOW),
      createdAt: BigInt(NOW),
      updatedAt: BigInt(NOW),
      ...data,
    }),
  );
  txMocks.subscription.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ ...grantRow(), ...data }),
  );
  txMocks.subscriptionGrant.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ id: 90, ...data }),
  );

  mocks.subscriptionGrant.count.mockResolvedValue(0);
  mocks.subscriptionGrant.findMany.mockResolvedValue([]);

  /**
   * 🔴 事务里的 `tx` **只给这三个 model**。
   *
   * 这不是偷懒，是判据 1 的载体：`checkout_orders` 不在 `tx` 上，所以"发放顺手建一条
   * 订单"这种写法在本组测试里会当场 `TypeError`，而不是"要有人记得断言它没被调用"。
   */
  mocks.$transaction.mockImplementation(
    async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(txPayload()),
  );

  app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.useRealTimers();
});

/** 时间戳一律是 `BigInt`（Prisma 给的形状），断言时统一收成 number。 */
const ms = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

const auditPayload = (): Record<string, unknown> => {
  const call = txMocks.subscriptionGrant.create.mock.calls[0]?.[0] as {
    data: Record<string, unknown>;
  };
  return call.data;
};

// ─────────────────────────────────────────────────────────────────────────
// 判据 2：只写发放行
// ─────────────────────────────────────────────────────────────────────────

describe('发放只作用在 provider=admin-grant 的那一行', () => {
  it('🔴 找发放行时 where 带 provider —— 少了它就是"按 userId 找一条订阅"', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: 30, reason: '内测授权' },
    });

    expect(txMocks.subscription.findFirst).toHaveBeenCalledWith({
      where: { userId: 5, provider: ADMIN_GRANT_PROVIDER },
      orderBy: { id: 'desc' },
    });
  });

  it('🔴 已经存在的付费行不会被改写：update 的 where 只有发放行的 id', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(grantRow({ id: 11 }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/revoke',
      headers: AUTH,
      payload: { userId: 5, reason: '内测结束' },
    });

    expect(res.statusCode).toBe(200);
    expect(txMocks.subscription.update).toHaveBeenCalledTimes(1);
    expect(txMocks.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11 } }));
    // `findFirst` 只可能被调用一次：查的就是发放行。**没有**第二次"列出他所有订阅"的读，
    // 那会是"顺手把别的行也一起处理掉"那条路的起点。
    expect(txMocks.subscription.findFirst).toHaveBeenCalledTimes(1);
  });

  it('收回写的是 status=canceled + 到期=now，而不是删掉那一行', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(grantRow());

    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/revoke',
      headers: AUTH,
      payload: { userId: 5, reason: '内测结束' },
    });

    const { data } = txMocks.subscription.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data.status).toBe('canceled');
    expect(ms(data.currentPeriodEnd)).toBe(NOW);
    // ⚠️ "行留着"这一条在这里是**结构性**的：桩上的 `subscription` 只有
    // findFirst/create/update 三样，写 `delete` 会当场 TypeError。所以这里**不**断言
    // "`delete` 没被调用"——那条断言永远为真，等于没有断言。
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 判据 1：发放不进营收
// ─────────────────────────────────────────────────────────────────────────

describe('发放不产生任何钱的记录', () => {
  it('🔴 事务拿到的 model 只有那三个 —— 没有 `checkoutOrder`，"顺手建一条订单"写不出来', async () => {
    const seen: string[][] = [];
    mocks.$transaction.mockImplementation(
      async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = txPayload();
        seen.push(Object.keys(tx).sort());
        return fn(tx);
      },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: 30, reason: '内测授权' },
    });
    expect(res.statusCode).toBe(200);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(['subscription', 'subscriptionGrant', 'user']);
  });

  it('三个动作各只开**一个**事务（不多一次"先查后写"的窗口）', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(grantRow());

    for (const [url, payload] of [
      [
        '/api/admin/subscriptions/grant',
        { userId: 5, sku: 'hosted-monthly', days: 30, reason: '内测授权' },
      ],
      ['/api/admin/subscriptions/upgrade', { userId: 5, sku: 'hosted-ai-monthly', reason: '内测授权' }],
      ['/api/admin/subscriptions/revoke', { userId: 5, reason: '内测结束' }],
    ] as const) {
      mocks.$transaction.mockClear();
      const res = await app.inject({ method: 'POST', url, headers: AUTH, payload });
      expect(res.statusCode).toBe(200);
      expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 判据 3：能力从 SKU 派生，客户端发不出来
// ─────────────────────────────────────────────────────────────────────────

describe('grants 的唯一来源是价目表', () => {
  it('🔴 载荷里多一个 `grants` 键 ⇒ 400，且一行都不写', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: {
        userId: 5,
        sku: 'hosted-monthly',
        days: 30,
        reason: '内测授权',
        grants: ['hosting', 'ai', 'automation'],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_grant');
    expect(txMocks.subscription.create).not.toHaveBeenCalled();
    expect(txMocks.subscription.update).not.toHaveBeenCalled();
    expect(txMocks.subscriptionGrant.create).not.toHaveBeenCalled();
  });

  it('写入的 grants 等于该 SKU 在价目表里的那一份', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-ai-monthly', days: 7, reason: '内测授权' },
    });

    const { data } = txMocks.subscription.create.mock.calls[0]?.[0] as {
      data: { grants: string[] };
    };
    expect(data.grants).toEqual([...(SKU_GRANTS['hosted-ai-monthly'] ?? [])]);
  });

  it('🔴 `priceId` 与 `grants` 是同一个 SKU 的两半（不许一档给能力、另一档给名字）', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-ai-monthly', days: 7, reason: '内测授权' },
    });

    const { data } = txMocks.subscription.create.mock.calls[0]?.[0] as {
      data: { priceId: string; grants: string[] };
    };
    expect(data.priceId).toBe('hosted-ai-monthly');
    expect(data.grants).toEqual([...(SKU_GRANTS[data.priceId] ?? [])]);
  });

  it('`grantsForSku` 的 null 与 [] 不混：未知 SKU 拒发，不给"一条零能力的订阅"', () => {
    expect(() => resolveGrantGrants('hosted-yearly-nope')).toThrowError(/不在能力表里/u);
    expect(resolveGrantGrants('hosted-monthly')).toEqual(['hosting']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 判据 5：交付不了的档位不发
// ─────────────────────────────────────────────────────────────────────────

describe('不可交付的档位拒绝发放', () => {
  it('🔴 这一档进了"交付不了"清单 ⇒ 409 + 理由带出 + 零写入', async () => {
    priceBookMock.blocked = 'hosted-ai-monthly';

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-ai-monthly', days: 30, reason: '内测授权' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'sku_not_deliverable',
      reason: 'SKU_NOT_DELIVERABLE',
      sku: 'hosted-ai-monthly',
    });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 `reason` 是**码**，不是一句话（服务端写的中文不许绕过词条表进界面）', async () => {
    priceBookMock.blocked = 'hosted-ai-monthly';

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-ai-monthly', days: 30, reason: '内测授权' },
    });

    // 传输层只搬 `reason` 那一格（`admin-client.ts::readServerReason`），
    // 所以这里塞进一句人话 = 那句话会原样出现在切了英文的界面上。
    const body = res.json() as { reason?: string };
    expect(body.reason).toMatch(/^[A-Z0-9_]+$/u);
  });

  it('同档位的**升档**也走同一道闸门（两条路由不许各判一半）', async () => {
    priceBookMock.blocked = 'hosted-ai-monthly';
    txMocks.subscription.findFirst.mockResolvedValue(grantRow());

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/upgrade',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-ai-monthly', reason: '内测授权' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('sku_not_deliverable');
    expect(txMocks.subscription.update).not.toHaveBeenCalled();
  });

  it('`GET /skus` 把这一档列出来但标成不可发（下拉里看得见、点了会拒）', async () => {
    priceBookMock.blocked = 'hosted-ai-monthly';

    const res = await app.inject({ method: 'GET', url: '/api/admin/skus', headers: AUTH });
    const skus = res.json().skus as { priceId: string; sellable: boolean }[];

    expect(skus.find((s) => s.priceId === 'hosted-ai-monthly')?.sellable).toBe(false);
    expect(skus.find((s) => s.priceId === 'hosted-monthly')?.sellable).toBe(true);
  });

  it('🔴 投影里**没有那句中文散文**（`sellable` 是布尔，理由只进日志 —— ADR-0074 §三.1）', async () => {
    priceBookMock.blocked = 'hosted-ai-monthly';

    const res = await app.inject({ method: 'GET', url: '/api/admin/skus', headers: AUTH });

    // 那句 `'云端 AI 的计量还没接上'` 如果被塞进响应，英文界面就会漏出中文，
    // 而它没有任何一处能翻译。这一条断的是它**不在字段里**，不是"界面没读它"。
    expect(res.json().skus.some((s: unknown) => JSON.stringify(s).includes('计量还没接上'))).toBe(
      false,
    );
    expect(Object.keys((res.json().skus as Record<string, unknown>[])[0] ?? {}).sort()).toEqual([
      'grants',
      'priceId',
      'sellable',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 判据 6：天数与理由
// ─────────────────────────────────────────────────────────────────────────

describe('天数与理由闸门', () => {
  it.each([
    ['0', 0],
    ['负数', -5],
    ['小数', 7.5],
    ['超上界', GRANT_DAYS_MAX + 1],
  ])('%s ⇒ 400 且不进事务', async (_label, days) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days, reason: '内测授权' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_grant');
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 上界那个数只有一份：路由 400 的边界就是 store 导出的那个常量', async () => {
    // 这条测的是**没有第二份数字**。写死 `1..3650` 也能让上面那组通过，
    // 但下一次抬上界时改一处、留一处的就是它 —— 那种漂移不会报错，
    // 只会变成"界面说能发 5000 天，服务端说不能"。
    const ok = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: GRANT_DAYS_MAX, reason: '内测授权' },
    });
    expect(ok.statusCode).toBe(200);

    const over = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: GRANT_DAYS_MAX + 1, reason: '内测授权' },
    });
    expect(over.statusCode).toBe(400);
  });

  it('空理由 ⇒ 400（`reason` 是强制的，不是"建议填"）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: 30, reason: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 判据 7：审计与写在同一个事务
// ─────────────────────────────────────────────────────────────────────────

describe('审计与权益写在同一个事务里', () => {
  it('🔴 写全部走事务里那个 client，根 client 一格没写', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: 30, reason: '内测授权' },
    });

    expect(txMocks.subscription.create).toHaveBeenCalledTimes(1);
    expect(txMocks.subscriptionGrant.create).toHaveBeenCalledTimes(1);
    // 把 `tx.subscriptionGrant` 改成 `client.subscriptionGrant` 就是从这里红的：
    // 那一步在事务**外**补日志，崩溃时会留下"权益发出去了但没人知道是谁发的"。
    expect(mocks.subscription.create).not.toHaveBeenCalled();
    expect(mocks.subscription.update).not.toHaveBeenCalled();
    expect(mocks.subscriptionGrant.create).not.toHaveBeenCalled();
  });

  it('🔴 审计的 create 发生在事务回调**内部**（不在 await 之后）', async () => {
    let insideTransaction = false;
    mocks.$transaction.mockImplementation(
      async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        insideTransaction = true;
        const out = await fn(txPayload());
        insideTransaction = false;
        return out;
      },
    );
    txMocks.subscriptionGrant.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        expect(insideTransaction).toBe(true);
        return { id: 90, ...data };
      },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: 30, reason: '内测授权' },
    });
    expect(res.statusCode).toBe(200);
    expect(txMocks.subscriptionGrant.create).toHaveBeenCalledTimes(1);
  });

  it('审计行带的是**当时**的档位、天数、前后到期日与 actor', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(
      grantRow({ currentPeriodEnd: BigInt(NOW + 10 * DAY) }),
    );

    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: 30, reason: ' 内测授权 ' },
    });

    expect(auditPayload()).toMatchObject({
      userId: 5,
      actorUserId: 1,
      action: 'grant',
      sku: 'hosted-monthly',
      days: 30,
      grants: ['hosting'],
      // 理由两端空白被裁掉，但**不**为空 —— 它是给人读的那句话。
      reason: '内测授权',
    });
    expect(ms(auditPayload().beforePeriodEnd)).toBe(NOW + 10 * DAY);
    expect(ms(auditPayload().afterPeriodEnd)).toBe(NOW + 10 * DAY + 30 * DAY);
  });

  it('`revoke` 的审计不重新声明档位：sku/days 留空，那一档由它自己那条记录说', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(grantRow());

    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/revoke',
      headers: AUTH,
      payload: { userId: 5, reason: '内测结束' },
    });

    expect(auditPayload().sku).toBeNull();
    expect(auditPayload().days).toBeNull();
    expect(auditPayload().grants).toEqual([]);
    expect(ms(auditPayload().afterPeriodEnd)).toBe(NOW);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 判据 8：升档一天都不加
// ─────────────────────────────────────────────────────────────────────────

describe('免费升级只换档位', () => {
  it('🔴 update 的 data 里不许出现 currentPeriodEnd', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(
      grantRow({ currentPeriodEnd: BigInt(NOW + 3 * DAY) }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/upgrade',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-ai-monthly', reason: '内测授权' },
    });
    expect(res.statusCode).toBe(200);

    const { data } = txMocks.subscription.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(data)).not.toContain('currentPeriodEnd');
    expect(data.priceId).toBe('hosted-ai-monthly');
    expect(data.grants).toEqual(['hosting', 'ai', 'automation']);
  });

  it('🔴 打在**已收回**的发放行上是 409，不是一次伪装的重新发放', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(
      grantRow({ status: 'canceled', currentPeriodEnd: BigInt(NOW - DAY) }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/upgrade',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-ai-monthly', reason: '内测授权' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('no_active_grant');
    expect(txMocks.subscription.update).not.toHaveBeenCalled();
  });

  it('周期已经过了但状态还没人改 ⇒ 同样 409（后台不许说"他还有效"）', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(
      grantRow({ status: 'active', currentPeriodEnd: BigInt(NOW - 1) }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/revoke',
      headers: AUTH,
      payload: { userId: 5, reason: '内测结束' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('审计里 `afterPeriodEnd` 等于 `beforePeriodEnd`（这次动作的语义里没有"加了多久"）', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(
      grantRow({ currentPeriodEnd: BigInt(NOW + 3 * DAY) }),
    );

    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/upgrade',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-ai-monthly', reason: '内测授权' },
    });

    expect(auditPayload().days).toBeNull();
    expect(ms(auditPayload().afterPeriodEnd)).toBe(ms(auditPayload().beforePeriodEnd));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 判据 9：没有可动的东西 ≠ 已完成
// ─────────────────────────────────────────────────────────────────────────

describe('没有发放行时的几种说法', () => {
  it('revoke 打在一个从没被发放过的人身上 ⇒ 409', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/revoke',
      headers: AUTH,
      payload: { userId: 5, reason: '内测结束' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('no_active_grant');
    expect(txMocks.subscription.update).not.toHaveBeenCalled();
    expect(txMocks.subscriptionGrant.create).not.toHaveBeenCalled();
  });

  it('目标账号不存在 ⇒ 404 `user_not_found`（这里可以说出来：不存在不是权限状态）', async () => {
    // 判权那一次（根 client）照常放行；store 里查目标账号那一次（tx）说没有。
    txMocks.user.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 999, sku: 'hosted-monthly', days: 30, reason: '内测授权' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('user_not_found');
    expect(txMocks.subscription.create).not.toHaveBeenCalled();
  });

  it('grant 打在已收回的行上 ⇒ 复活并从 now 重新起算（发放的三种时态之一）', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(
      grantRow({ status: 'canceled', currentPeriodEnd: BigInt(NOW - 5 * DAY) }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: 7, reason: '再给一周' },
    });
    expect(res.statusCode).toBe(200);

    const { data } = txMocks.subscription.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data.status).toBe('active');
    expect(ms(data.currentPeriodEnd)).toBe(NOW + 7 * DAY);
  });

  it('已有周期还没过 ⇒ 接在旧到期日**后面**，不覆盖已发的时长', async () => {
    txMocks.subscription.findFirst.mockResolvedValue(
      grantRow({ currentPeriodEnd: BigInt(NOW + 20 * DAY) }),
    );

    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: 7, reason: '续一周' },
    });

    const { data } = txMocks.subscription.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(ms(data.currentPeriodEnd)).toBe(NOW + 27 * DAY);
  });

  it('没有发放行时新建的行走 create，`externalSubscriptionId` 如实留空', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/subscriptions/grant',
      headers: AUTH,
      payload: { userId: 5, sku: 'hosted-monthly', days: 30, reason: '内测授权' },
    });

    const { data } = txMocks.subscription.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data.externalSubscriptionId).toBeNull();
    expect(data.provider).toBe(ADMIN_GRANT_PROVIDER);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 读面
// ─────────────────────────────────────────────────────────────────────────

describe('GET /skus 与 GET /subscriptions/grants', () => {
  it('档位下拉是 `SKU_GRANTS` 的投影，条数与它相等', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/skus', headers: AUTH });
    const body = res.json() as { skus: { priceId: string }[]; grantDaysMax: number };

    expect(body.skus.map((s) => s.priceId).sort()).toEqual(Object.keys(SKU_GRANTS).sort());
    expect(body.grantDaysMax).toBe(GRANT_DAYS_MAX);
  });

  it('🔴 下拉里没有价目表之外的档位（界面上不许硬编码一档）', () => {
    const listed = new Set(listGrantSkuOptions().map((s) => s.priceId));
    const priced = new Set(DEFAULT_PRICE_BOOK.map((e) => e.priceId));
    for (const sku of listed) expect(priced.has(sku)).toBe(true);
  });

  it('发放记录按时间倒序分页，`userId` 是可选过滤', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/admin/subscriptions/grants?userId=5&limit=20&offset=0',
      headers: AUTH,
    });

    expect(mocks.subscriptionGrant.findMany).toHaveBeenCalledWith({
      where: { userId: 5 },
      orderBy: { createdAt: 'desc' },
      take: 20,
      skip: 0,
    });
  });

  it('🔴 这一页不回显邮箱（动作史只带 userId）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/subscriptions/grants',
      headers: AUTH,
    });
    expect(JSON.stringify(res.json())).not.toContain('email');
    expect(JSON.stringify(res.json())).not.toContain('test@test.com');
  });

  it('词表外的存量审计行 ⇒ 500，不静默降级成一个假动作名', async () => {
    mocks.subscriptionGrant.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 5,
        actorUserId: 1,
        action: 'gift',
        sku: 'hosted-monthly',
        days: 30,
        grants: ['hosting'],
        beforePeriodEnd: null,
        afterPeriodEnd: BigInt(NOW),
        reason: '历史脏数据',
        createdAt: BigInt(NOW),
      },
    ]);
    mocks.subscriptionGrant.count.mockResolvedValue(1);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/subscriptions/grants',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('failed_to_load_grants');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 闸门本身
// ─────────────────────────────────────────────────────────────────────────

describe('store 直接调用时的那道第二闸门', () => {
  it('绕过路由传一个不存在的 SKU ⇒ 抛，且零写入', async () => {
    await expect(
      grantSubscription({
        userId: 5,
        sku: 'hosted-yearly-nope',
        days: 30,
        reason: '内测授权',
        actorUserId: 1,
        now: NOW,
      }),
    ).rejects.toThrowError(/不在能力表里/u);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});
