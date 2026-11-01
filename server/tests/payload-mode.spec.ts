import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncPayloadModeResponseSchema } from '@heyta/shared-schema';

/**
 * ADR-0080 S0：账号级载荷模式的读取端。
 *
 * 这组断言只钉四件事 —— 它们全都是"读不到时怎么办"，因为读取成功那一格
 * 由数据库决定，而**读取失败那一格决定安全边界**：
 *   ① 存的是 readable ⇒ 读回 readable
 *   ② 没有行（从没同步过）⇒ e2ee
 *   ③ 存了个不认识的值 ⇒ e2ee（不是抛错、不是放行）
 *   ④ 读抛异常 ⇒ e2ee 且**仍然回 200**（一次数据库抖动不该让整条同步挂掉，
 *      更不该因为挂了就落到宽松那一档）
 */

const mocks = vi.hoisted(() => ({
  closeForUser: vi.fn(),
  userSyncState: { findUnique: vi.fn(), upsert: vi.fn() },
  vaultKeyPackage: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  operation: { count: vi.fn() },
  $queryRaw: vi.fn(),
  syncService: { getLatestSeq: vi.fn() },
}));

vi.mock('../src/auth', () => ({
  verifyToken: vi.fn().mockResolvedValue({ valid: true, userId: 1, email: 'test@example.test' }),
  revokeAllTokens: vi.fn(),
}));
vi.mock('../src/db', () => ({ prisma: mocks }));
vi.mock('../src/sync/sync.service', () => ({ getSyncService: () => mocks.syncService }));
vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ notifyNewOps: vi.fn(), closeForUser: mocks.closeForUser }),
}));

import { syncRoutes } from '../src/sync/sync.routes';

const AUTH = { authorization: 'Bearer test-token' };

describe('GET /api/sync/payload-mode (ADR-0080)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.user.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0, isVerified: 1 });
    mocks.vaultKeyPackage.findUnique.mockResolvedValue(null);
    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns readable when the account has switched encryption off', async () => {
    mocks.userSyncState.findUnique.mockResolvedValue({ payloadMode: 'readable' });

    const res = await app.inject({ method: 'GET', url: '/api/sync/payload-mode', headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'readable' });
    expect(syncPayloadModeResponseSchema.safeParse(res.json()).success).toBe(true);
  });

  it('returns e2ee for an account that has never synced (no row at all)', async () => {
    mocks.userSyncState.findUnique.mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: '/api/sync/payload-mode', headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'e2ee' });
  });

  it('fails closed to e2ee when the stored value is unrecognised', async () => {
    mocks.userSyncState.findUnique.mockResolvedValue({ payloadMode: 'someday-maybe' });

    const res = await app.inject({ method: 'GET', url: '/api/sync/payload-mode', headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'e2ee' });
  });

  it('fails closed to e2ee and still answers when the read throws', async () => {
    mocks.userSyncState.findUnique.mockRejectedValue(new Error('connection reset'));

    const res = await app.inject({ method: 'GET', url: '/api/sync/payload-mode', headers: AUTH });

    // 200 而不是 500：一次读失败不能让客户端以为"模式未知"，否则它会停下来；
    // 而 e2ee 这一档下客户端只会写密文 —— 服务端拒收是可观测的，写明文不是。
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'e2ee' });
  });

  it('answers without any key package existing (the readable-mode shape)', async () => {
    mocks.userSyncState.findUnique.mockResolvedValue({ payloadMode: 'readable' });
    mocks.vaultKeyPackage.findUnique.mockResolvedValue(null);

    const mode = await app.inject({ method: 'GET', url: '/api/sync/payload-mode', headers: AUTH });
    const pkg = await app.inject({ method: 'GET', url: '/api/sync/key-package', headers: AUTH });

    expect(mode.json()).toEqual({ mode: 'readable' });
    // 这两个必须能区分：模式端点 200，包端点 404。混成一个端点就分不出来了。
    expect(pkg.statusCode).toBe(404);
  });
});
