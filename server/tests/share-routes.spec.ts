import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/shares/*` 的契约测试（W2 判据，照 admin-console / activity 先例）。
 *
 * 盯住三类洞：
 * ① 不认证（新端点族全部 401）；
 * ② role 硬门被绕开（viewer/commenter 的写必须被服务端拒 —— 客户端 UI
 *    约束只是软门，ADR-0062 决策 6）；
 * ③ 邀请生命周期（一次性 token、吊销、过期、29 人上限）。
 *
 * 认证由 `tests/setup.ts` 的全局 `verifyToken` mock 承担（恒为 userId 1），
 * 所以「没带头 → 401」与「带了头 → 业务断言」两层都测得到。
 */

const mocks = vi.hoisted(() => ({
  share: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  shareMember: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  shareInvitation: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  shareOperation: {
    createMany: vi.fn(),
    findMany: vi.fn(),
  },
  wsNotifyShareOps: vi.fn(),
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ notifyShareOps: mocks.wsNotifyShareOps }),
}));

import { shareRoutes } from '../src/shares/share.routes';

let app: FastifyInstance;

const AUTH = { authorization: 'Bearer test-token' };

/** 一条能通过线协议 schema 的合法 TASK op（编辑者/所有者可写）。 */
const taskOp = {
  id: 'op-1',
  clientId: 'client-a',
  actionType: 'add task',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: { title: 'hello' },
  vectorClock: { 'client-a': 1 },
  timestamp: 1_700_000_000_000,
  schemaVersion: 1,
  isPayloadEncrypted: true,
};

const activeShare = {
  id: 'share-1',
  ownerUserId: 1n,
  keyEpoch: 1,
  lastServerSeq: 5,
  deletedAt: null,
};

const memberAs = (role: string) => ({ id: 'member-1', role, userId: 1n, shareId: 'share-1' });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.share.create.mockImplementation(async (args: { data: { id: string } }) => ({
    id: args.data.id,
    keyEpoch: 1,
    createdAt: args.data.createdAt,
  }));
  mocks.shareMember.create.mockImplementation(async (args: { data: { id: string; role: string } }) => ({
    id: args.data.id,
    role: args.data.role,
  }));
  mocks.shareMember.count.mockResolvedValue(1);
  mocks.shareOperation.createMany.mockResolvedValue({ count: 1 });
  mocks.wsNotifyShareOps.mockClear();

  app = Fastify();
  await app.register(shareRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('身份：新端点族全部要求令牌', () => {
  it('没有 Authorization 头 → 401（14 条端点逐一遍历）', async () => {
    for (const [method, url] of [
      ['POST', '/api/shares'],
      ['GET', '/api/shares'],
      ['GET', '/api/shares/share-1'],
      ['POST', '/api/shares/share-1/invitations'],
      ['GET', '/api/shares/share-1/invitations'],
      ['DELETE', '/api/shares/share-1/invitations/inv-1'],
      ['POST', '/api/shares/invitations/accept'],
      ['GET', '/api/shares/share-1/members'],
      ['PATCH', '/api/shares/share-1/members/member-1'],
      ['PUT', '/api/shares/share-1/members/member-1/envelope'],
      ['DELETE', '/api/shares/share-1/members/member-1'],
      ['POST', '/api/shares/share-1/leave'],
      ['POST', '/api/shares/share-1/ops'],
      ['GET', '/api/shares/share-1/ops/causal'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('POST /api/shares', () => {
  it('创建共享：share + owner 成员行，201 返回 shareId', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/shares', headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.role).toBe('owner');
    expect(body.shareId).toBeTruthy();
    expect(mocks.shareMember.create).toHaveBeenCalledTimes(1);
    expect(mocks.shareMember.create.mock.calls[0]![0].data.role).toBe('owner');
  });
});

describe('成员边界：非成员看到的一律是 404', () => {
  it('share 不存在或调用者不是成员 → 404（不是 403 —— 存在性不外泄）', async () => {
    mocks.share.findFirst.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/shares/share-1', headers: AUTH });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SHARE_NOT_FOUND');
  });

  it('被移除的成员（removedAt 非空行不匹配）→ 404', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/shares/share-1/members', headers: AUTH });
    expect(res.statusCode).toBe(404);
  });
});

describe('🔴 role 硬门（POST /shares/:id/ops）', () => {
  beforeEach(() => {
    // 重复 id 预检的默认夹具：库里没有同 id op。
    mocks.shareOperation.findMany.mockResolvedValue([]);
  });
  it('viewer 的写被服务端拒绝（客户端 UI 只是软门）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('viewer'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [taskOp] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rejected[0].code).toBe('SHARE_ROLE_FORBIDDEN');
    expect(body.accepted).toHaveLength(0);
    expect(mocks.share.update).not.toHaveBeenCalled();
    expect(mocks.shareOperation.createMany).not.toHaveBeenCalled();
  });

  it('commenter 写 TASK 被拒（COMMENT 实体在 W3 之前本来就不可共享）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('commenter'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [taskOp] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_ROLE_FORBIDDEN');
  });

  it('editor 写个人域实体（REMINDER）被拒 —— 提醒是每成员自己的', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [{ ...taskOp, entityType: 'REMINDER' }] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_ENTITY_TYPE_NOT_SHAREABLE');
  });

  it('未知实体被拒为 INVALID_ENTITY_TYPE（线协议语义，不是权限语义）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [{ ...taskOp, entityType: 'GHOST' }] },
    });
    expect(res.json().rejected[0].code).toBe('INVALID_ENTITY_TYPE');
  });

  it('editor 写 TASK 被接受：块状发号 + WS 信号（不带内容）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    // 原计数 5，本批预留 2 个 ⇒ update 返回新水位 7，块内序号 6、7。
    mocks.share.update.mockResolvedValue({ lastServerSeq: 7 });
    mocks.shareMember.findMany.mockResolvedValue([{ userId: 1n }, { userId: 2n }]);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [taskOp, { ...taskOp, id: 'op-2', entityId: 'task-2' }] },
    });
    const body = res.json();
    expect(body.accepted).toEqual([
      { id: 'op-1', serverSeq: 6 },
      { id: 'op-2', serverSeq: 7 },
    ]);
    expect(body.latestServerSeq).toBe(7);
    expect(mocks.share.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastServerSeq: { increment: 2 } } }),
    );
    const inserted = mocks.shareOperation.createMany.mock.calls[0]![0].data as Array<{ serverSeq: number }>;
    expect(inserted.map((r) => r.serverSeq)).toEqual([6, 7]);
    // WS 信号只带 shareId 与序号，不带任何 op 内容。
    expect(mocks.wsNotifyShareOps).toHaveBeenCalledWith([1, 2], 'share-1', 'client-a', 7);
  });

  it('同一批里合法与非法混合：各走各的（一条坏的不能拖死一批）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    mocks.share.update.mockResolvedValue({ lastServerSeq: 6 });
    mocks.shareMember.findMany.mockResolvedValue([]);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [taskOp, { ...taskOp, id: 'op-bad', entityType: 'REMINDER' }] },
    });
    const body = res.json();
    expect(body.accepted).toHaveLength(1);
    expect(body.rejected).toHaveLength(1);
  });

  it('🔴 已存在的 op id（跨 share 重试/重放）→ 逐 op 拒绝 DUPLICATE_OPERATION，不是 500', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    mocks.shareOperation.findMany.mockResolvedValue([{ id: 'op-1' }]);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [taskOp] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toHaveLength(0);
    expect(body.rejected).toEqual([{ id: 'op-1', code: 'DUPLICATE_OPERATION' }]);
    expect(mocks.share.update).not.toHaveBeenCalled();
    expect(mocks.shareOperation.createMany).not.toHaveBeenCalled();
  });

  it('无重复时预检不放行空集——正常接受路径不受影响', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    mocks.shareOperation.findMany.mockResolvedValue([]);
    mocks.share.update.mockResolvedValue({ lastServerSeq: 6 });
    mocks.shareMember.findMany.mockResolvedValue([]);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [taskOp] },
    });
    expect(res.json().accepted).toHaveLength(1);
  });
});

describe('邀请生命周期', () => {
  it('只有 owner 能发邀请（editor → 403）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/invitations', headers: AUTH, payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(mocks.shareInvitation.create).not.toHaveBeenCalled();
  });

  it('owner 发邀请：裸 token 只出现在这一次响应里', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('owner'));
    mocks.shareInvitation.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'inv-1',
      expiresAt: args.data.expiresAt,
    }));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/invitations', headers: AUTH, payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    // 存的是散列，不是裸 token
    expect(mocks.shareInvitation.create.mock.calls[0]![0].data.tokenHash).not.toBe(body.token);
    expect(mocks.shareInvitation.create.mock.calls[0]![0].data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('邀请列表是白名单投影：tokenHash 与裸 token 都不出现在响应里', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('owner'));
    mocks.shareInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-1', invitedByEmail: 'x@y.test', tokenHash: 'f'.repeat(64),
        createdAt: 1n, expiresAt: 2n, revokedAt: null, acceptedAt: null,
      },
    ]);
    const res = await app.inject({
      method: 'GET', url: '/api/shares/share-1/invitations', headers: AUTH,
    });
    const text = res.body;
    expect(text).not.toContain('f'.repeat(64));
    expect(text).not.toContain('tokenHash');
    expect(res.json().invitations[0].invitationId).toBe('inv-1');
  });

  it('接受：吊销 → 410；过期 → 410；未知 token → 404', async () => {
    const identityPublicKey = 'A'.repeat(43);
    mocks.shareInvitation.findUnique
      .mockResolvedValueOnce({ id: 'inv-1', shareId: 'share-1', revokedAt: 5n, expiresAt: 9_999_999_999_999n })
      .mockResolvedValueOnce({ id: 'inv-1', shareId: 'share-1', revokedAt: null, expiresAt: 1n })
      .mockResolvedValueOnce(null);
    for (const [expected, why] of [[410, '吊销'], [410, '过期'], [404, '未知']] as const) {
      const res = await app.inject({
        method: 'POST', url: '/api/shares/invitations/accept', headers: AUTH,
        payload: { token: 'token-abcdefabcdefabcdef', identityPublicKey },
      });
      expect(res.statusCode, why).toBe(expected);
    }
  });

  it('接受：29 人上限（活跃成员含 owner 已满 → 403 MEMBER_LIMIT）', async () => {
    mocks.shareInvitation.findUnique.mockResolvedValue({
      id: 'inv-1', shareId: 'share-1', revokedAt: null, expiresAt: 9_999_999_999_999n,
    });
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(null);
    mocks.shareMember.count.mockResolvedValue(30);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/invitations/accept', headers: AUTH,
      payload: { token: 'token-abcdefabcdefabcdef', identityPublicKey: 'A'.repeat(43) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('SHARE_MEMBER_LIMIT');
    expect(mocks.shareMember.create).not.toHaveBeenCalled();
  });

  it('接受：正常入群记录公钥，且不写 accept 半成品（两列一起写）', async () => {
    mocks.shareInvitation.findUnique.mockResolvedValue({
      id: 'inv-1', shareId: 'share-1', revokedAt: null, expiresAt: 9_999_999_999_999n,
    });
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(null);
    mocks.shareMember.count.mockResolvedValue(1);
    mocks.shareMember.create.mockResolvedValue({ id: 'member-9', role: 'editor' });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/invitations/accept', headers: AUTH,
      payload: { token: 'token-abcdefabcdefabcdef', identityPublicKey: 'A'.repeat(43) },
    });
    expect(res.statusCode).toBe(200);
    const created = mocks.shareMember.create.mock.calls[0]![0].data;
    expect(created.identityPublicKey).toBe('A'.repeat(43));
    expect(mocks.shareInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acceptedByUserId: 1, acceptedAt: expect.any(BigInt) }),
      }),
    );
  });

  it('接受：已经是成员 → 409（不重复占行）', async () => {
    mocks.shareInvitation.findUnique.mockResolvedValue({
      id: 'inv-1', shareId: 'share-1', revokedAt: null, expiresAt: 9_999_999_999_999n,
    });
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue({ ...memberAs('viewer'), removedAt: null });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/invitations/accept', headers: AUTH,
      payload: { token: 'token-abcdefabcdefabcdef', identityPublicKey: 'A'.repeat(43) },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('owner 专属动作', () => {
  beforeEach(() => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
  });

  it('移除 owner 自己 → 400（要先转让，W6）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('owner'));
    const res = await app.inject({
      method: 'DELETE', url: '/api/shares/share-1/members/member-1', headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('owner 退出 → 400', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('owner'));
    const res = await app.inject({ method: 'POST', url: '/api/shares/share-1/leave', headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it('改 owner 的角色 → 400（转让是独立动作，不是改角色）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('owner'));
    const res = await app.inject({
      method: 'PATCH', url: '/api/shares/share-1/members/member-1', headers: AUTH,
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('移除普通成员：removedAt 置位（调用者是 owner，目标是 editor）', async () => {
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce({ ...memberAs('editor'), id: 'member-2' });
    mocks.shareMember.update.mockResolvedValue({});
    const res = await app.inject({
      method: 'DELETE', url: '/api/shares/share-1/members/member-2', headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.shareMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ removedAt: expect.any(BigInt) }) }),
    );
  });

  it('成员列表带信封：成员凭它取清单密钥（密文对他人无用）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    mocks.shareMember.findMany.mockResolvedValue([
      {
        id: 'member-1', role: 'owner', userId: 1n, addedAt: 1n,
        keyEnvelope: { recipientFingerprint: 'f', ciphertext: 'c' }, memberKeyEpoch: 1,
        identityPublicKey: 'pub-A',
      },
      {
        id: 'member-2', role: 'editor', userId: 2n, addedAt: 2n,
        keyEnvelope: null, memberKeyEpoch: 1, identityPublicKey: 'pub-B',
      },
    ]);
    const res = await app.inject({
      method: 'GET', url: '/api/shares/share-1/members', headers: AUTH,
    });
    const body = res.json();
    expect(body.members[0].hasEnvelope).toBe(true);
    expect(body.members[0].keyEnvelope).toEqual({ recipientFingerprint: 'f', ciphertext: 'c' });
    expect(body.members[1].keyEnvelope).toBeNull();
    expect(body.members[1].hasEnvelope).toBe(false);
  });

  it('信封下发：世代高于 share 时推进 share.keyEpoch（调用者是 owner）', async () => {    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce({ ...memberAs('editor'), id: 'member-2' });
    mocks.shareMember.update.mockResolvedValue({});
    mocks.share.update.mockResolvedValue({});
    const res = await app.inject({
      method: 'PUT', url: '/api/shares/share-1/members/member-2/envelope', headers: AUTH,
      payload: { keyEpoch: 2, keyEnvelope: { recipientFingerprint: 'x', ciphertext: 'y' } },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.share.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { keyEpoch: 2 } }),
    );
  });
});

describe('GET /api/shares', () => {
  it('列表 + removedMemberships（Etebase 形状）', async () => {
    mocks.shareMember.findMany
      .mockResolvedValueOnce([
        {
          id: 'member-1', role: 'owner', memberKeyEpoch: 1, keyEnvelope: { a: 1 },
          share: { id: 'share-1', ownerUserId: 1n, keyEpoch: 1, deletedAt: null },
        },
      ])
      .mockResolvedValueOnce([
        { shareId: 'share-old', removedAt: 5n },
      ]);
    const res = await app.inject({ method: 'GET', url: '/api/shares', headers: AUTH });
    const body = res.json();
    expect(body.shares).toEqual([
      { shareId: 'share-1', ownerId: 1, keyEpoch: 1, role: 'owner', memberKeyEpoch: 1, hasEnvelope: true },
    ]);
    expect(body.removedMemberships).toEqual([{ shareId: 'share-old', removedAt: 5 }]);
  });
});
