/**
 * 通行密钥自助管理 —— HTTP 层。
 *
 * 服务层测试（`passkey-management.spec.ts`）钉的是谓词；这一组钉的是
 * **客户端实际看得见的东西**：状态码、机器码、以及响应体里到底有什么。
 *
 * 负向路径是重点：
 *   - 未认证 → 401，且**一个删除都没发生**；
 *   - 删别人的 → 404，且响应与"删一个根本不存在的 id"**逐字节相同**
 *     （这是"不泄露存在性"唯一能失败得起来的写法：不是断言文案里没有
 *     某个词，而是断言两种输入的输出完全一样）；
 *   - 删最后一条 → 409 + 可判别码，且响应里没有 `success: true`；
 *   - 缺口 B → 两个 401 的 `code` 不同，且都不是笼统的 `Authentication failed`。
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ closeForUser: vi.fn() }),
}));

vi.mock('../src/db', () => {
  const mockPrisma = {
    user: { findUnique: vi.fn() },
    passkey: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma };
});

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import { apiRoutes } from '../src/api';
import { prisma } from '../src/db';
import * as auth from '../src/auth';
import * as simplewebauthn from '@simplewebauthn/server';

const mockPrisma = prisma as unknown as {
  user: { findUnique: Mock };
  passkey: {
    findMany: Mock;
    findFirst: Mock;
    findUnique: Mock;
    deleteMany: Mock;
    update: Mock;
    updateMany: Mock;
  };
  $transaction: Mock;
};
const verifyTokenMock = auth.verifyToken as unknown as Mock;
const mockGenerateAuthentication = simplewebauthn.generateAuthenticationOptions as Mock;
const mockVerifyAuthentication = simplewebauthn.verifyAuthenticationResponse as Mock;

const AUTH = { authorization: 'Bearer some-token' };

describe('通行密钥自助管理（HTTP）', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认：令牌有效，属于 user 1。
    verifyTokenMock.mockResolvedValue({ valid: true, userId: 1, email: 'owner@example.com' });
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    );
    mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.passkey.findFirst.mockResolvedValue(null);
    mockGenerateAuthentication.mockResolvedValue({ challenge: 'c', rpId: 'localhost' });

    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/passkeys', () => {
    it('未认证 → 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/passkeys' });
      expect(res.statusCode).toBe(401);
      expect(mockPrisma.passkey.findMany).not.toHaveBeenCalled();
    });

    it('认证后返回自己的凭据清单，且**不含** publicKey / credentialId', async () => {
      mockPrisma.passkey.findMany.mockResolvedValue([
        {
          id: 'pk_row_1',
          createdAt: new Date('2026-01-02T03:04:05.000Z'),
          lastUsedAt: null,
          // 敏感列刻意也塞进 mock 行里：
          credentialId: Buffer.from([1, 2, 3, 4]),
          publicKey: Buffer.from([5, 6, 7, 8]),
        },
      ]);

      const res = await app.inject({ method: 'GET', url: '/api/passkeys', headers: AUTH });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        passkeys: [
          { id: 'pk_row_1', createdAt: '2026-01-02T03:04:05.000Z', lastUsedAt: null },
        ],
      });
      // 原始响应体（不是解析后的对象）里也不许出现这两个词。
      expect(res.body).not.toContain('publicKey');
      expect(res.body).not.toContain('credentialId');
      expect(res.body).not.toContain('credentialID');
      expect(res.body).not.toContain('counter');
    });
  });

  describe('DELETE /api/passkeys/:id', () => {
    it('未认证 → 401，且一个删除都没发生', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/api/passkeys/pk_row_1' });

      expect(res.statusCode).toBe(401);
      expect(mockPrisma.passkey.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('删除自己的某一条 → 200 { success: true }', async () => {
      mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/passkeys/pk_row_1',
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockPrisma.passkey.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'pk_row_1', userId: 1 }),
        }),
      );
    });

    it('🔴 删别人的 → 404（不是 403），且响应与"删不存在的 id"逐字节相同', async () => {
      mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.passkey.findFirst.mockResolvedValue(null);

      const others = await app.inject({
        method: 'DELETE',
        url: '/api/passkeys/belongs-to-user-2',
        headers: AUTH,
      });
      const ghost = await app.inject({
        method: 'DELETE',
        url: '/api/passkeys/no-such-row-at-all',
        headers: AUTH,
      });

      expect(others.statusCode).toBe(404);
      // 403 会说"存在但不归你"；这条断言就是防它回来的。
      expect(others.statusCode).not.toBe(403);
      expect(others.json()).toEqual({
        error: 'Passkey not found',
        code: 'passkey_not_found_for_user',
      });
      // 不泄露存在性：两种输入必须产出**完全相同**的响应。
      expect(others.statusCode).toBe(ghost.statusCode);
      expect(others.body).toBe(ghost.body);
    });

    it('🔴 删最后一条 → 409 + last_passkey_required，绝不是成功', async () => {
      mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.passkey.findFirst.mockResolvedValue({ id: 'pk_row_1' });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/passkeys/pk_row_1',
        headers: AUTH,
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe('last_passkey_required');
      expect(body.success).not.toBe(true);
      expect(body.error).toContain('only passkey');
    });

    it('空 id → 400，且不发删除', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/api/passkeys/', headers: AUTH });
      // 路由不匹配空段 → 404；这里只是确认它没有被当成"删全部"。
      expect([400, 404]).toContain(res.statusCode);
      expect(mockPrisma.passkey.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/passkeys/:id（改名）', () => {
    const patch = (
      url: string,
      payload?: unknown,
      headers: Record<string, string> = AUTH,
    ): ReturnType<typeof app.inject> =>
      app.inject({
        method: 'PATCH',
        url,
        headers,
        ...(payload === undefined ? {} : { payload }),
      });

    it('未认证 → 401，且一次改名都没发生', async () => {
      const res = await patch('/api/passkeys/pk_row_1', { name: 'x' }, {});

      expect(res.statusCode).toBe(401);
      expect(mockPrisma.passkey.updateMany).not.toHaveBeenCalled();
    });

    it('改自己的某一条 → 200 { success: true }', async () => {
      mockPrisma.passkey.updateMany.mockResolvedValue({ count: 1 });

      const res = await patch('/api/passkeys/pk_row_1', { name: 'MacBook 的 Touch ID' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockPrisma.passkey.updateMany).toHaveBeenCalledWith({
        where: { id: 'pk_row_1', userId: 1 },
        data: { name: 'MacBook 的 Touch ID' },
      });
    });

    it('name: null → 200，且 data.name 是 null（去掉名字）', async () => {
      mockPrisma.passkey.updateMany.mockResolvedValue({ count: 1 });

      const res = await patch('/api/passkeys/pk_row_1', { name: null });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.passkey.updateMany).toHaveBeenCalledWith({
        where: { id: 'pk_row_1', userId: 1 },
        data: { name: null },
      });
    });

    it('🔴 改别人的 → 404（不是 403），且与"改不存在的 id"逐字节相同', async () => {
      mockPrisma.passkey.updateMany.mockResolvedValue({ count: 0 });

      const others = await patch('/api/passkeys/belongs-to-user-2', { name: 'x' });
      const ghost = await patch('/api/passkeys/no-such-row-at-all', { name: 'x' });

      expect(others.statusCode).toBe(404);
      // 403 会说"存在但不归你"；这条断言就是防它回来的。
      expect(others.statusCode).not.toBe(403);
      expect(others.json()).toEqual({
        error: 'Passkey not found',
        code: 'passkey_not_found_for_user',
      });
      // 不泄露存在性：两种输入必须产出**完全相同**的响应。
      expect(others.body).toBe(ghost.body);
    });

    it('🔴 改名的 404 与删除的 404 **逐字节相同**（同一件事只能有一种说法）', async () => {
      mockPrisma.passkey.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.passkey.findFirst.mockResolvedValue(null);

      const renamed = await patch('/api/passkeys/belongs-to-user-2', { name: 'x' });
      const deleted = await app.inject({
        method: 'DELETE',
        url: '/api/passkeys/belongs-to-user-2',
        headers: AUTH,
      });

      expect(renamed.statusCode).toBe(deleted.statusCode);
      expect(renamed.body).toBe(deleted.body);
    });

    it('🔴 超长 → 400 + passkey_name_too_long，且**根本没写库**', async () => {
      const res = await patch('/api/passkeys/pk_row_1', { name: 'x'.repeat(61) });

      expect(res.statusCode).toBe(400);
      // 不写库是关键：不是"写完再骂"。
      expect(mockPrisma.passkey.updateMany).not.toHaveBeenCalled();
    });

    it('请求体里塞 userId 改不了归属（zod 剥未知键）', async () => {
      mockPrisma.passkey.updateMany.mockResolvedValue({ count: 1 });

      const res = await patch('/api/passkeys/pk_row_1', {
        name: 'still mine',
        userId: 2,
        id: 'some-other-row',
      });

      expect(res.statusCode).toBe(200);
      // 🔴 归属仍然来自令牌：`where.id` 是 URL 里的那条，`userId` 是 1。
      expect(mockPrisma.passkey.updateMany).toHaveBeenCalledWith({
        where: { id: 'pk_row_1', userId: 1 },
        data: { name: 'still mine' },
      });
    });

    it('name 不是字符串 → 400，且不写库', async () => {
      const res = await patch('/api/passkeys/pk_row_1', { name: 123 });

      expect(res.statusCode).toBe(400);
      expect(mockPrisma.passkey.updateMany).not.toHaveBeenCalled();
    });

    it('没有请求体 → 400，且不写库', async () => {
      const res = await patch('/api/passkeys/pk_row_1');

      expect(res.statusCode).toBe(400);
      expect(mockPrisma.passkey.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('缺口 B：/api/login/passkey/verify 的可判别 401', () => {
    const credential = {
      id: 'NdTCzq0G8dA8cObw41B8',
      rawId: 'raw',
      type: 'public-key',
      response: {
        clientDataJSON: 'x',
        authenticatorData: 'y',
        signature: 'z',
      },
      clientExtensionResults: {},
    };

    /** 先要一个 challenge —— 两步都是公开调用，模拟真实浏览器。 */
    const beginLogin = async (email: string): Promise<void> => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email,
        isVerified: 1,
        passkeys: [{}],
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/login/passkey/options',
        payload: { email },
      });
      expect(res.statusCode).toBe(200);
    };

    it('陈旧凭据（服务端已删）→ code = passkey_not_found', async () => {
      mockPrisma.passkey.findUnique.mockResolvedValue(null);
      await beginLogin('stale@example.com');

      const res = await app.inject({
        method: 'POST',
        url: '/api/login/passkey/verify',
        payload: { email: 'stale@example.com', credential },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('passkey_not_found');
      expect(res.json().error).not.toBe('Authentication failed');
    });

    it('凭据验签失败 → code = passkey_verification_failed', async () => {
      mockPrisma.passkey.findUnique.mockResolvedValue({
        id: 'pk_row_1',
        credentialId: Buffer.from(credential.id),
        publicKey: Buffer.from([1, 2, 3]),
        counter: BigInt(0),
        transports: null,
        user: { id: 1, email: 'live@example.com', isVerified: 1 },
      });
      mockVerifyAuthentication.mockRejectedValue(new Error('bad signature'));
      await beginLogin('live@example.com');

      const res = await app.inject({
        method: 'POST',
        url: '/api/login/passkey/verify',
        payload: { email: 'live@example.com', credential },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('passkey_verification_failed');
      expect(res.json().error).not.toBe('Authentication failed');
    });

    it('两种情况的码**不同**，且都由服务端给出稳定值', async () => {
      mockPrisma.passkey.findUnique.mockResolvedValueOnce(null);
      await beginLogin('stale@example.com');
      const stale = await app.inject({
        method: 'POST',
        url: '/api/login/passkey/verify',
        payload: { email: 'stale@example.com', credential },
      });

      mockPrisma.passkey.findUnique.mockResolvedValueOnce({
        id: 'pk_row_2',
        credentialId: Buffer.from(credential.id),
        publicKey: Buffer.from([1, 2, 3]),
        counter: BigInt(0),
        transports: null,
        user: { id: 1, email: 'live@example.com', isVerified: 1 },
      });
      mockVerifyAuthentication.mockRejectedValue(new Error('bad signature'));
      await beginLogin('live@example.com');
      const broken = await app.inject({
        method: 'POST',
        url: '/api/login/passkey/verify',
        payload: { email: 'live@example.com', credential },
      });

      const staleCode = stale.json().code;
      const brokenCode = broken.json().code;
      expect(staleCode).toBe('passkey_not_found');
      expect(brokenCode).toBe('passkey_verification_failed');
      expect(staleCode).not.toBe(brokenCode);
    });
  });
});
