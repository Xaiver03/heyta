/**
 * `GET /api/admin/revenue` 的判据。
 * ==================================
 *
 * 这一格的风险不是"能不能读出来"，是**读出来的数是不是那个数的意思**。
 * 四件事各自有一条：
 *
 *   1. 🔴 **日界由 `offsetMinutes` 裁**。这台服务器跑 UTC，而"今天收了多少"
 *      是运营者那个日子的问题。不裁的话，北京时间 0–8 点的进账会算到昨天 ——
 *      一个每天都差一点、但永远对不上的数。
 *   2. 🔴 **不跨币种合并**。混币求和是一个"错得很像真的"数字：它会显示出来、
 *      会进图表、没有任何一处报错。
 *   3. 🔴 **零与缺席是两件事**：窗口里的每一天都要有一个点，否则界面上
 *      "没画出来的那根柱子"会被读成"那天没人付钱"，而它其实只是没被列出来。
 *   4. 退款那一格走的是 `refunded_at IS NOT NULL` 这个**谓词**（不是 `status`），
 *      而且它落在 `where` 上 —— 所以这一条断的是发出去的查询长什么样。
 *
 * 全部用假 prisma：这一组不碰库，碰的是"聚合与边界"这段纯逻辑 + 参数校验。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  checkoutOrder: { findMany: vi.fn() },
  refund: { findMany: vi.fn() },
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

const { adminRoutes } = await import('../src/admin/admin.routes');

let app: FastifyInstance;

const AUTH = { authorization: 'Bearer test-token' };

/** 一个 UTC 时刻的 epoch 毫秒。 */
const at = (iso: string): number => Date.parse(iso);

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.user.findUnique.mockResolvedValue({ isAdmin: true });
  mocks.checkoutOrder.findMany.mockResolvedValue([]);
  mocks.refund.findMany.mockResolvedValue([]);

  app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('日界由调用方给的时区偏移裁', () => {
  /**
   * 两笔进账，UTC 上差 5 小时，但**跨过了北京的午夜**：
   *
   *   · `2026-10-23T15:00Z` = 北京 10-23 23:00
   *   · `2026-10-23T20:00Z` = 北京 10-24 04:00
   *
   * 按 UTC 裁 ⇒ 两笔同在 10-23 那一格（分不开）；按北京裁 ⇒ 一格 500、一格 700。
   * 所以"两笔落在不同 `dayMs`"这一条断言，**只有真的做了偏移才会成立**。
   */
  it('offsetMinutes=480 时，跨过北京午夜的两笔落在不同的日格', async () => {
    mocks.checkoutOrder.findMany.mockResolvedValue([
      { paidAt: BigInt(at('2026-10-23T15:00:00Z')), currency: 'CNY', finalAmountMinor: 500 },
      { paidAt: BigInt(at('2026-10-23T20:00:00Z')), currency: 'CNY', finalAmountMinor: 700 },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/revenue?days=7&offsetMinutes=480',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const points = body.series[0].points as { dayMs: number; paidMinor: number }[];

    const nonzero = points.filter((point) => point.paidMinor > 0);
    expect(nonzero).toHaveLength(2);
    expect(nonzero.map((point) => point.paidMinor).sort()).toEqual([500, 700]);
    // 两格的 dayMs 必须不同 —— 这一条就是"偏移真的参与了取整"的证据。
    expect(new Set(nonzero.map((point) => point.dayMs)).size).toBe(2);
  });

  it('offsetMinutes 缺省（0 = UTC）时，那两笔落在同一格', async () => {
    mocks.checkoutOrder.findMany.mockResolvedValue([
      { paidAt: BigInt(at('2026-10-23T15:00:00Z')), currency: 'CNY', finalAmountMinor: 500 },
      { paidAt: BigInt(at('2026-10-23T20:00:00Z')), currency: 'CNY', finalAmountMinor: 700 },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/revenue?days=7', headers: AUTH });
    const points = res.json().series[0].points as { paidMinor: number }[];
    const nonzero = points.filter((point) => point.paidMinor > 0);
    // 对照臂：同一批数据、没有偏移 ⇒ 合成一格、1200。
    // 这一条与上一条**必须同时成立**，否则说明分桶跟偏移无关（那才是真 bug）。
    expect(nonzero).toHaveLength(1);
    expect(nonzero[0]!.paidMinor).toBe(1_200);
  });
});

describe('币种', () => {
  it('🔴 两个币种各一条序列，响应里没有任何跨币种合计', async () => {
    mocks.checkoutOrder.findMany.mockResolvedValue([
      { paidAt: BigInt(at('2026-10-23T01:00:00Z')), currency: 'CNY', finalAmountMinor: 1_200 },
      { paidAt: BigInt(at('2026-10-23T02:00:00Z')), currency: 'USD', finalAmountMinor: 990 },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/revenue?days=7', headers: AUTH });
    const body = res.json();

    expect(body.series.map((series: { currency: string }) => series.currency)).toEqual(['CNY', 'USD']);
    // 顶层不许出现一个"总营收"字段：把 1200 分与 990 分加在一起没有意义。
    expect(body.totalPaidMinor).toBeUndefined();
    expect(body.total).toBeUndefined();
    expect(body.series[0].totalPaidMinor).toBe(1_200);
    expect(body.series[1].totalPaidMinor).toBe(990);
  });
});

describe('零与缺席', () => {
  it('窗口里的每一天都有一个点（没有活动的那几天是 0，不是不列）', async () => {
    mocks.checkoutOrder.findMany.mockResolvedValue([
      { paidAt: BigInt(at('2026-10-23T01:00:00Z')), currency: 'CNY', finalAmountMinor: 100 },
    ]);

    const res = await app.inject({ method: 'GET', url: "/api/admin/revenue?days=7", headers: AUTH });
    const points = res.json().series[0].points as { paidMinor: number }[];

    expect(points).toHaveLength(7);
    expect(points.filter((point) => point.paidMinor === 0)).toHaveLength(6);
  });
});

describe('退款的谓词', () => {
  it('🔴 按 `refunded_at` 非空取，而不是按 `status`', async () => {
    mocks.refund.findMany.mockResolvedValue([
      { refundedAt: BigInt(at('2026-10-23T03:00:00Z')), currency: 'CNY', amountMinor: 300 },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/revenue?days=7', headers: AUTH });
    const where = mocks.refund.findMany.mock.calls[0]![0] as {
      where: { refundedAt: Record<string, unknown> };
    };

    // `status` 是一个**关于**事实的字段；`refunded_at` 才是事实（钱真的出去了）。
    expect(where.where.refundedAt).toBeDefined();
    expect(where.where.refundedAt.not).toBeNull();
    expect(where.where.status).toBeUndefined();

    const series = res.json().series[0];
    expect(series.totalRefundedMinor).toBe(300);
    expect(series.totalRefundedOrders).toBe(1);
    // 净收入由服务端折，界面只念。
    expect(series.totalNetMinor).toBe(-300);
  });
});

describe('参数校验与准入', () => {
  it.each(['days=0', 'days=999', 'days=abc', 'offsetMinutes=9999'])(
    '%s ⇒ 400（不给一个静默夹紧的窗口）',
    async (query) => {
      const res = await app.inject({ method: 'GET', url: `/api/admin/revenue?${query}`, headers: AUTH });
      expect(res.statusCode).toBe(400);
    },
  );

  it('未登录 ⇒ 401，非管理员 ⇒ 403', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/revenue' });
    expect(anonymous.statusCode).toBe(401);

    mocks.user.findUnique.mockResolvedValue({ isAdmin: false });
    const denied = await app.inject({ method: 'GET', url: '/api/admin/revenue', headers: AUTH });
    expect(denied.statusCode).toBe(403);
    // 被拒时一次库都不许查（闸门在聚合之前）。
    expect(mocks.checkoutOrder.findMany).not.toHaveBeenCalled();
  });
});
