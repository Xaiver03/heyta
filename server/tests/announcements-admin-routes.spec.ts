/**
 * 运营公告的后台写面判据（ADR-0075）。
 * ====================================
 *
 * 这一组钉的是四件"错了会对外说话"的事：
 *
 *   1. 🔴 **`state` 由服务端算**，而且 `now` 随响应一起给 ——
 *      界面自己比时间戳会造出第二个裁决者，症状是"运营以为已经下架了，用户还看得见"。
 *   2. 🔴 **下架 0 行 ⇒ 404，不折成"已完成"** —— 把没发生过的动作说成完成了，
 *      与退款那几条同一族（`refund_not_found` 那条先例）。
 *   3. `level` 词表外 ⇒ 400，且**不入库**。
 *   4. "失效早于生效"是一个操作失误，不是一种合法状态 ⇒ 400 + 具名 `reason`。
 *
 * 全部假 prisma：这一组不碰库。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  announcement: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

const { adminRoutes } = await import('../src/admin/admin.routes');

let app: FastifyInstance;
const AUTH = { authorization: 'Bearer test-token' };

/** 一条库里的行（BigInt 时间戳，与 Prisma 给的一致）。 */
const row = (over: Partial<{ id: number; title: string; level: string; publishedAt: bigint; expiresAt: bigint | null }> = {}) => ({
  id: 1,
  title: '今晚维护',
  body: '22:00–22:30 同步服务不可用',
  level: 'info',
  publishedAt: BigInt(Date.now() - 60_000),
  expiresAt: null,
  createdBy: 7,
  createdAt: BigInt(1),
  updatedAt: BigInt(1),
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.user.findUnique.mockResolvedValue({ isAdmin: true });
  mocks.announcement.findMany.mockResolvedValue([]);
  mocks.announcement.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 42,
    ...data,
  }));
  mocks.announcement.deleteMany.mockResolvedValue({ count: 1 });

  app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /announcements 的 `state`', () => {
  it('三档状态由服务端算：还没生效 / 挂着 / 已过期', async () => {
    const now = Date.now();
    mocks.announcement.findMany.mockResolvedValue([
      row({ id: 1, publishedAt: BigInt(now + 600_000) }),
      row({ id: 2, publishedAt: BigInt(now - 600_000) }),
      row({ id: 3, publishedAt: BigInt(now - 600_000), expiresAt: BigInt(now - 1) }),
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/announcements', headers: AUTH });
    const body = res.json();

    expect(body.announcements.map((item: { state: string }) => item.state)).toEqual([
      'pending',
      'active',
      'expired',
    ]);
    // `now` 必须随响应给出去：界面拿它自己那只表算下一次判读，就是第二套标准。
    expect(typeof body.now).toBe('number');
  });

  it('后台投影带 `createdBy`（运营要知道是谁发的）', async () => {
    mocks.announcement.findMany.mockResolvedValue([row({ createdBy: 7 })]);
    const res = await app.inject({ method: 'GET', url: '/api/admin/announcements', headers: AUTH });
    expect(res.json().announcements[0].createdBy).toBe(7);
  });
});

describe('POST /announcements', () => {
  const valid = {
    title: '今晚维护',
    body: '22:00–22:30 同步服务不可用',
    level: 'info',
    publishedAtMs: 1_760_000_000_000,
  };

  it('落库的是发过来的那些字段，响应回的是库里那一行', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/announcements',
      headers: AUTH,
      payload: valid,
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.announcement.create).toHaveBeenCalledTimes(1);
    const data = mocks.announcement.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.title).toBe('今晚维护');
    expect(data.level).toBe('info');
    expect(data.publishedAt).toBe(BigInt(valid.publishedAtMs));
    // 没给失效时刻 ⇒ 存 `null`（"不过期"），不是存一个 0。
    expect(data.expiresAt).toBeNull();
    // 归属记的是**当前这个管理员**，不是调用方传进来的谁。
    expect(data.createdBy).toBe(1);
  });

  it('词表外的 `level` ⇒ 400，且一行都不许多写', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/announcements',
      headers: AUTH,
      payload: { ...valid, level: 'urgent' },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.announcement.create).not.toHaveBeenCalled();
  });

  it('空标题 / 空正文 ⇒ 400', async () => {
    for (const over of [{ title: '   ' }, { body: '' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/announcements',
        headers: AUTH,
        payload: { ...valid, ...over },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(mocks.announcement.create).not.toHaveBeenCalled();
  });

  it('🔴 失效早于生效 ⇒ 400 + 具名 reason（那是一次手滑，不是一种状态）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/announcements',
      headers: AUTH,
      payload: { ...valid, expiresAtMs: valid.publishedAtMs - 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toBe('EXPIRES_BEFORE_PUBLISH');
    expect(mocks.announcement.create).not.toHaveBeenCalled();
  });
});

describe('DELETE /announcements/:id', () => {
  it('删到 ⇒ ok', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/announcements/5', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, withdrawn: true });
    expect(mocks.announcement.deleteMany.mock.calls[0]![0]).toEqual({ where: { id: 5 } });
  });

  it('🔴 删到 0 行 ⇒ 404，不许折成"已完成"', async () => {
    mocks.announcement.deleteMany.mockResolvedValue({ count: 0 });
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/announcements/5', headers: AUTH });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('announcement_not_found');
  });

  it('id 不是正整数 ⇒ 400', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/announcements/abc', headers: AUTH });
    expect(res.statusCode).toBe(400);
  });
});
