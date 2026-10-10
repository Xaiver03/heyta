import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/notifications*` 与 `/api/activity` 的契约测试。
 *
 * 这几条路由都带身份，而有身份的路由最常见的两个洞是：
 * ① **不按调用者过滤**（`ids` 从请求里来，只按 id 更新就能改别人的数据）；
 * ② **"缺省即全部"** 这种看似方便的语义（一个客户端 bug 就能静默清空徽标）。
 * 下面每一条都直接盯住这两个洞。
 */

const mocks = vi.hoisted(() => ({
  accountNotification: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  inviteCode: { findUnique: vi.fn(), create: vi.fn() },
  referral: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
  },
  subscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

import { activityRoutes } from '../src/activity/activity.routes';

let app: FastifyInstance;

const AUTH = { authorization: 'Bearer test-token' };

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.accountNotification.findMany.mockResolvedValue([]);
  mocks.accountNotification.count.mockResolvedValue(0);
  mocks.accountNotification.updateMany.mockResolvedValue({ count: 0 });
  mocks.inviteCode.findUnique.mockResolvedValue({ userId: 1, code: 'ABCD2345' });
  mocks.referral.findMany.mockResolvedValue([]);
  mocks.referral.count.mockResolvedValue(0);
  mocks.referral.aggregate.mockResolvedValue({ _sum: { rewardDays: null } });

  app = Fastify();
  await app.register(activityRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('身份：一律要求令牌', () => {
  it('没有 Authorization 头 → 401（三条路由都是）', async () => {
    for (const [method, url] of [
      ['GET', '/api/notifications'],
      ['POST', '/api/notifications/read'],
      ['GET', '/api/activity'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('GET /api/notifications', () => {
  it('返回列表与未读数（两者来自同一次读取）', async () => {
    mocks.accountNotification.findMany.mockResolvedValue([
      {
        id: 2,
        kind: 'referral-activated',
        payload: { displayName: 'star', days: 5 },
        createdAt: 1_800_000_000_000n,
        readAt: null,
      },
      {
        id: 1,
        kind: 'referral-activated',
        payload: { displayName: 'Y', days: 5 },
        createdAt: 1_799_000_000_000n,
        readAt: 1_799_500_000_000n,
      },
    ]);
    mocks.accountNotification.count.mockResolvedValue(1);

    const res = await app.inject({ method: 'GET', url: '/api/notifications', headers: AUTH });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      notifications: { id: number; createdAt: number; readAt: number | null }[];
      unreadCount: number;
    };
    expect(body.unreadCount).toBe(1);
    expect(body.notifications.map((n) => n.id)).toEqual([2, 1]);
    // bigint 必须以 number 出去（JSON 序列化不了 bigint）。
    expect(body.notifications[0]!.createdAt).toBe(1_800_000_000_000);
    expect(body.notifications[0]!.readAt).toBeNull();
    expect(body.notifications[1]!.readAt).toBe(1_799_500_000_000);
  });

  it('🔴 只查调用者自己的通知（userId 取自令牌，不取自请求）', async () => {
    await app.inject({ method: 'GET', url: '/api/notifications', headers: AUTH });

    expect(mocks.accountNotification.findMany.mock.calls[0]![0].where).toEqual({
      userId: 1,
    });
    expect(mocks.accountNotification.count.mock.calls[0]![0].where).toEqual({
      userId: 1,
      readAt: null,
    });
  });

  it('新的在前', async () => {
    await app.inject({ method: 'GET', url: '/api/notifications', headers: AUTH });
    expect(mocks.accountNotification.findMany.mock.calls[0]![0].orderBy).toEqual({
      createdAt: 'desc',
    });
  });

  it('limit 透传，并夹在合法区间内', async () => {
    await app.inject({ method: 'GET', url: '/api/notifications?limit=5', headers: AUTH });
    expect(mocks.accountNotification.findMany.mock.calls[0]![0].take).toBe(5);
  });

  it('limit 非法 → 400（而不是静默用默认值继续，也不是 500）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications?limit=abc',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation_failed', message: 'Validation failed' });
  });

  it('limit=0 → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications?limit=0',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('不带 limit → 用默认值（不是"不限量"）', async () => {
    await app.inject({ method: 'GET', url: '/api/notifications', headers: AUTH });
    expect(mocks.accountNotification.findMany.mock.calls[0]![0].take).toBe(30);
  });
});

describe('POST /api/notifications/read', () => {
  it('指定 id → 标记这些', async () => {
    mocks.accountNotification.updateMany.mockResolvedValue({ count: 2 });
    mocks.accountNotification.count.mockResolvedValue(0);

    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/read',
      headers: AUTH,
      payload: { ids: [3, 4] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2, unreadCount: 0 });
  });

  it('🔴 越权防线：where 里必须同时带 userId（ids 来自请求体）', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/notifications/read',
      headers: AUTH,
      payload: { ids: [999] },
    });

    const where = mocks.accountNotification.updateMany.mock.calls[0]![0].where as {
      userId: number;
      readAt: null;
      id: { in: number[] };
    };
    expect(where.userId).toBe(1);
    expect(where.readAt).toBeNull();
    expect(where.id).toEqual({ in: [999] });
  });

  it('all: true → 不带 id 条件（清空这个人的未读）', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/notifications/read',
      headers: AUTH,
      payload: { all: true },
    });

    const where = mocks.accountNotification.updateMany.mock.calls[0]![0].where as Record<
      string,
      unknown
    >;
    expect(where).toEqual({ userId: 1, readAt: null });
    expect('id' in where).toBe(false);
  });

  it('🔴 空体 → 400：刻意不做"缺省即全部"（一个客户端 bug 会静默清空徽标）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/read',
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.accountNotification.updateMany).not.toHaveBeenCalled();
  });

  it('ids 为空数组 → 400（"标 0 条"多半是 bug，不是意图）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/read',
      headers: AUTH,
      payload: { ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('ids 里有非正整数 → 400', async () => {
    for (const ids of [[0], [-1], [1.5], ['1']]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notifications/read',
        headers: AUTH,
        payload: { ids },
      });
      expect(res.statusCode, JSON.stringify(ids)).toBe(400);
    }
  });

  it('all 传 false → 400（只有字面量 true 才算"全部"）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/read',
      headers: AUTH,
      payload: { all: false },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/activity', () => {
  it('返回活动目录，邀请活动带上地址与进度', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/activity', headers: AUTH });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      campaigns: {
        id: string;
        kind: string;
        invite?: {
          inviteCode: string;
          rewardDays: number;
          invited: number;
          activated: number;
          daysEarned: number;
          windowCap: number;
        };
      }[];
    };

    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0]!.id).toBe('invite-friends');
    expect(body.campaigns[0]!.kind).toBe('invite');
    expect(body.campaigns[0]!.invite).toMatchObject({
      inviteCode: 'ABCD2345',
      rewardDays: 5,
      windowCap: 20,
    });
  });

  it('🔴 惰性发码：没有码时建一张，并把新码返回', async () => {
    mocks.inviteCode.findUnique.mockResolvedValue(null);
    mocks.inviteCode.create.mockResolvedValue({ code: 'NEWC0DE1' });

    const res = await app.inject({ method: 'GET', url: '/api/activity', headers: AUTH });

    const body = res.json() as { campaigns: { invite?: { inviteCode: string } }[] };
    expect(body.campaigns[0]!.invite!.inviteCode).toBe('NEWC0DE1');
    expect(mocks.inviteCode.create).toHaveBeenCalledOnce();
  });

  it('🔴 三个汇总数字来自全量聚合，不是那一页列表', async () => {
    // 列表故意只返回 1 条，而聚合说"邀请 7 人 / 已激活 5 人 / 共 25 天"。
    // 如果实现从列表里数数，这里就会得到 1 / 1 / 5 —— 两个数字对不上。
    mocks.referral.findMany.mockResolvedValue([
      {
        code: 'ABCD2345',
        createdAt: 1_800_000_000_000n,
        activatedAt: 1_800_000_001_000n,
        rewardDays: 5,
        invitee: { email: 'star@example.com' },
      },
    ]);
    mocks.referral.count
      .mockResolvedValueOnce(7) // invited
      .mockResolvedValueOnce(5) // activated
      .mockResolvedValueOnce(7); // windowInvited
    mocks.referral.aggregate.mockResolvedValue({ _sum: { rewardDays: 25 } });

    const res = await app.inject({ method: 'GET', url: '/api/activity', headers: AUTH });
    const body = res.json() as {
      campaigns: {
        invite?: {
          invited: number;
          activated: number;
          daysEarned: number;
          referrals: { displayName: string | null }[];
        };
      }[];
    };

    const invite = body.campaigns[0]!.invite!;
    expect(invite.invited).toBe(7);
    expect(invite.activated).toBe(5);
    expect(invite.daysEarned).toBe(25);
    expect(invite.referrals).toHaveLength(1);
    expect(invite.referrals[0]!.displayName).toBe('star');
  });

  it('只统计调用者自己的邀请', async () => {
    await app.inject({ method: 'GET', url: '/api/activity', headers: AUTH });
    expect(mocks.referral.findMany.mock.calls[0]![0].where).toEqual({
      inviterUserId: 1,
    });
  });
});
