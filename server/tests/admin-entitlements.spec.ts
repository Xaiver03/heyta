/**
 * 后台「此刻能用」那份并集读数的判据（`admin.routes.ts::projectEntitlements`）。
 * ============================================================================
 *
 * ## 这一组钉的不是"能不能读出行"，是**后台会不会念出一句守卫没判过的话**
 *
 * 权益是跨行的并集。`entitlement.ts::evaluateCapabilityAcross` 的头注释里那条事故
 * 是这一格的由来：库里两行都合法、都 `active`，而"最新那一行说了算"会挑中到期更早
 * 的那一条 —— 用户付过的 20 天里有 15 天凭空消失，没有任何一层报错。
 * 后台如果自己也数一遍行，它就有**第二套**标准，漂移的表现是运营说"他还有"而闸门说"他没有"。
 *
 * 所以这里的每条判据都按"**读数必须等于守卫的裁决**"来写：
 *
 *   1. 🔴 **最新一行过期、旧一行还活着** ⇒ 托管仍然 ✓，且来源是**活着那一条**。
 *      这一条就是那起事故的形状：写成 `findFirst(orderBy id desc)` 的实现会当场红。
 *   2. 🔴 只给 `hosting` 的那一档 ⇒ `ai` 必须是 ✕，且码是 `GRANT_NOT_INCLUDED`
 *      （"已到期"与"没买这一档"是两件不同的人工动作，混起来运营就不知道催谁）。
 *   3. 🔴 `official` 模式下自动收集跟订阅走；**未配模式**时它是 ✕，
 *      而且**不许**把那些行念成来源 —— 守卫那时候根本没看它们。
 *   4. `reason` 只能是机器码（ADR-0074 §三.1：散文进日志，不进线协议）。
 *   5. 一条订阅都没有 ⇒ 三档全 ✕ 且码是 `NO_SUBSCRIPTION`，界面才有"没订过任何档"可念。
 *
 * 全部假 prisma：这一组不碰库。真库形状的证据在 `admin-routes.spec.ts`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

/** 根 client：路由与 `requireAdmin` 共用这一枚，按 `where.id` 分流（1 = 后台操作者，5 = 被查的人）。 */
const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  subscription: { findMany: vi.fn() },
  automationEntitlementBinding: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

const { adminRoutes } = await import('../src/admin/admin.routes');
const { ADMIN_GRANT_PROVIDER } = await import('../src/admin/subscription-grant-store');

let app: FastifyInstance;
const AUTH = { authorization: 'Bearer test-token' };

const NOW = Date.parse('2026-10-25T08:00:00.000Z');
const DAY = 86_400_000;
const OPERATOR_ID = 1;
const TARGET_ID = 5;

/**
 * 一条库里的订阅行。`id` 越大越"新"（`orderBy id desc` 挑的就是它），
 * 判据 1 靠这两个维度造出"最新的那条反而先到期"。
 */
const subRow = (
  over: Partial<{
    id: number;
    provider: string | null;
    priceId: string | null;
    status: string | null;
    grants: string[];
    currentPeriodEnd: bigint | null;
  }> = {}
) => ({
  id: 7,
  provider: 'wechat',
  priceId: 'hosted-monthly',
  status: 'active',
  grants: ['hosting'],
  currentPeriodEnd: BigInt(NOW + 20 * DAY),
  createdAt: BigInt(NOW),
  updatedAt: BigInt(NOW),
  ...over,
});

const USER_DETAIL = {
  id: TARGET_ID,
  email: 'someone@example.test',
  isVerified: 1,
  isAdmin: false,
  lockedUntil: null,
  createdAt: new Date(NOW),
  storageUsedBytes: 1024n,
  storageQuotaBytes: 2048n,
  failedLoginAttempts: 0,
  termsAcceptedAt: null,
  termsDocumentVersion: null,
  tokenVersion: 1,
  checkoutOrders: [],
  devices: [],
  _count: { passkeys: 0, operations: 0, notifications: 0 },
};

/** 读数里的一行（与 `projectEntitlements` 的出参同形）。 */
interface EntitlementReading {
  capability: string;
  allowed: boolean;
  reason: string | null;
  sources: { provider: string | null; priceId: string | null; currentPeriodEnd: number | null }[];
}

/** 发一次 `GET /users/:id`，返回 `entitlements` 那一块。 */
async function entitlementsOf(): Promise<EntitlementReading[]> {
  const res = await app.inject({ method: 'GET', url: '/api/admin/users/5', headers: AUTH });
  expect(res.statusCode).toBe(200);
  return (JSON.parse(res.payload) as { entitlements: EntitlementReading[] }).entitlements;
}

const of = (list: EntitlementReading[], capability: string): EntitlementReading => {
  const found = list.find((item) => item.capability === capability);
  if (found === undefined) throw new Error(`读数里没有这一档：${capability}`);
  return found;
};

function stubUserDetail(subscriptions: ReturnType<typeof subRow>[]): void {
  mocks.user.findUnique.mockImplementation(
    async ({ where }: { where: { id: number } }) =>
      where.id === OPERATOR_ID ? { isAdmin: true } : { ...USER_DETAIL, subscriptions },
  );
  // `official` 模式下自动收集那一判会**自己再读一次**订阅（那是守卫的读取路径，
  // 不是这里另开的一份）—— 两处给同一批行，判据才只在"判定对不对"上动。
  mocks.subscription.findMany.mockResolvedValue(subscriptions);
}

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env.AUTOMATION_ENTITLEMENT_MODE;
  mocks.automationEntitlementBinding.findUnique.mockResolvedValue(null);
  mocks.$queryRaw.mockResolvedValue([]);

  app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('🔴 并集：不是"最新那一行说了算"', () => {
  it('最新那一行已过期、旧那一行还活着 ⇒ 仍然 ✓，且来源是活着那一条', async () => {
    // 顺序**照 `orderBy id desc`** 给（数据库返回的就是这个顺序，桩不许替它重排）：
    // 于是 `findFirst` 那一类旧实现会挑中 id=9 那条已过期的，给出 ✕ ——
    // 而库里明明还有一条到 20 天后的有效行，用户付过的时长正在被静默丢掉。
    stubUserDetail([
      subRow({ id: 9, provider: 'invite', priceId: null, currentPeriodEnd: BigInt(NOW - DAY) }),
      subRow({ id: 7, currentPeriodEnd: BigInt(NOW + 20 * DAY) }),
    ]);

    const reading = of(await entitlementsOf(), 'hosting');
    expect(reading.allowed).toBe(true);
    expect(reading.sources).toHaveLength(1);
    expect(reading.sources[0]?.provider).toBe('wechat');
    expect(reading.sources[0]?.currentPeriodEnd).toBe(NOW + 20 * DAY);
  });

  it('两条行都授予同一项能力 ⇒ 两条都念出来（来源不是只挑一条）', async () => {
    stubUserDetail([
      subRow({ id: 9, provider: 'invite', priceId: null, currentPeriodEnd: BigInt(NOW + 5 * DAY) }),
      subRow({ id: 7, currentPeriodEnd: BigInt(NOW + 20 * DAY) }),
    ]);

    const reading = of(await entitlementsOf(), 'hosting');
    expect(reading.allowed).toBe(true);
    expect(reading.sources.map((row) => row.provider)).toEqual(['invite', 'wechat']);
  });

  it('一条已收回（`canceled`）+ 一条活着 ⇒ ✓ 且只念活着那条', async () => {
    stubUserDetail([
      subRow({ id: 9, provider: ADMIN_GRANT_PROVIDER, status: 'canceled', currentPeriodEnd: BigInt(NOW - 1) }),
      subRow({ id: 7, currentPeriodEnd: BigInt(NOW + 30 * DAY) }),
    ]);

    const reading = of(await entitlementsOf(), 'hosting');
    expect(reading.allowed).toBe(true);
    expect(reading.sources).toHaveLength(1);
    expect(reading.sources[0]?.provider).toBe('wechat');
  });
});

describe('🔴 有效 ≠ 买了这一项', () => {
  it('只给 `hosting` 的那一档 ⇒ `ai` 是 ✕，码是 `GRANT_NOT_INCLUDED`', async () => {
    stubUserDetail([subRow({ grants: ['hosting'] })]);

    const reading = of(await entitlementsOf(), 'ai');
    expect(reading.allowed).toBe(false);
    expect(reading.reason).toBe('GRANT_NOT_INCLUDED');
    expect(reading.sources).toHaveLength(0);
  });

  it('到期了 ⇒ 码是 `PERIOD_ENDED`，不是 `GRANT_NOT_INCLUDED`（催续费 vs 卖了没交付）', async () => {
    stubUserDetail([subRow({ grants: ['hosting', 'ai'], currentPeriodEnd: BigInt(NOW - 1) })]);

    expect(of(await entitlementsOf(), 'hosting').reason).toBe('PERIOD_ENDED');
  });

  it('一行都没有 ⇒ 三档全 ✕；托管那两档说"没订过"，自动收集说"这台没配来源"', async () => {
    // 这一条钉的是**先后**：部署模式没配时，自动收集那一判不回 `NO_SUBSCRIPTION`。
    // 回错了的症状是运营去给一个从没订过的人发订阅，而真正要修的是这台实例的配置。
    stubUserDetail([]);

    const list = await entitlementsOf();
    for (const capability of ['hosting', 'ai']) {
      const reading = of(list, capability);
      expect(reading.allowed).toBe(false);
      expect(reading.reason).toBe('NO_SUBSCRIPTION');
    }
    const automation = of(list, 'automation');
    expect(automation.allowed).toBe(false);
    expect(automation.reason).toBe('ENTITLEMENT_MODE_UNCONFIGURED');
  });

  it('一行都没有、模式配成 `official` ⇒ 自动收集也落到 `NO_SUBSCRIPTION`', async () => {
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
    stubUserDetail([]);

    expect(of(await entitlementsOf(), 'automation').reason).toBe('NO_SUBSCRIPTION');
  });

  it('`grants` 列是空数组与是 `null` 是两件事：都不许放行，但码不同', async () => {
    stubUserDetail([subRow({ grants: [] as never })]);
    const empty = of(await entitlementsOf(), 'hosting');
    expect(empty.allowed).toBe(false);
    expect(empty.reason).toBe('GRANT_NOT_INCLUDED');

    stubUserDetail([subRow({ grants: null as never })]);
    const missing = of(await entitlementsOf(), 'hosting');
    expect(missing.allowed).toBe(false);
    expect(missing.reason).toBe('MISSING_GRANTS');
  });
});

describe('🔴 自动收集那一判跟着部署模式，不跟着"看起来有行"', () => {
  it('`official`：带 `automation` 的活行 ⇒ ✓，来源就是那一条', async () => {
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
    stubUserDetail([subRow({ grants: ['hosting', 'ai', 'automation'] })]);

    const reading = of(await entitlementsOf(), 'automation');
    expect(reading.allowed).toBe(true);
    expect(reading.sources).toHaveLength(1);
  });

  it('未配模式：那一档是 ✕，而且**不许**把订阅行念成来源', async () => {
    // 这一条是本格唯一"读数会比守卫少看一步"的地方：`selfhost-online` 的判据是票据，
    // 模式没配时它一条都不放行。把库里那些行照样念出来 = 后台宣称"这人有，只是没配"，
    // 而守卫说的是"没有"。
    stubUserDetail([subRow({ grants: ['hosting', 'ai', 'automation'] })]);

    const reading = of(await entitlementsOf(), 'automation');
    expect(reading.allowed).toBe(false);
    expect(reading.reason).toBe('ENTITLEMENT_MODE_UNCONFIGURED');
    expect(reading.sources).toHaveLength(0);
    // 同一批行给的那两档照旧是 ✓ —— 拒的是这一路，不是整个账号。
    const list = await entitlementsOf();
    expect(of(list, 'hosting').allowed).toBe(true);
  });

  it('`selfhost-online` 而没有绑定行：✕ 且来源为空（本机那些行在这一路不参与判定）', async () => {
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'selfhost-online';
    // 没有 `AUTOMATION_OFFICIAL_KEYS` ⇒ 签发方未配置，连绑定都不用读。
    stubUserDetail([subRow({ grants: ['hosting', 'ai', 'automation'] })]);

    const reading = of(await entitlementsOf(), 'automation');
    expect(reading.allowed).toBe(false);
    expect(reading.sources).toHaveLength(0);
  });
});

describe('🔴 出参形状', () => {
  it('`reason` 只可能是机器码（大写下划线），永远不是一句散文', async () => {
    stubUserDetail([subRow({ currentPeriodEnd: BigInt(NOW - 1) })]);

    for (const item of await entitlementsOf()) {
      if (item.reason === null) continue;
      expect(item.reason).toMatch(/^[A-Z][A-Z0-9_]*$/u);
    }
  });

  it('三档各一行，顺序就是服务端那张词表（`ENTITLEMENT_CAPABILITIES`）', async () => {
    stubUserDetail([]);
    expect((await entitlementsOf()).map((item) => item.capability)).toEqual([
      'hosting',
      'ai',
      'automation',
    ]);
  });

  it('响应里不出现 `bigint`（BigInt 进 `JSON.stringify` 会当场抛 ⇒ 整个端点 500）', async () => {
    stubUserDetail([subRow()]);
    const res = await app.inject({ method: 'GET', url: '/api/admin/users/5', headers: AUTH });

    expect(res.statusCode).toBe(200);
    const reading = of((JSON.parse(res.payload) as { entitlements: never[] }).entitlements, 'hosting');
    expect(typeof reading.sources[0]?.currentPeriodEnd).toBe('number');
  });
});
