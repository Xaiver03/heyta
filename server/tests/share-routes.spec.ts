import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 🔴 夹具用**生产那套签名件**（`signShareOpWire` / `encryptShareRecord`），不在测试里
// 自己拼一份签名域。理由与本仓所有"夹具照生产"的先例同源：自己拼的那一份会与
// `share-keys.ts` 同时改错，于是服务端验签的判据永远验不到真签名。
import {
  deriveShareIdentityKeyPair,
  encryptShareRecord,
  signShareOpWire,
} from '@heyta/sync-core';

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
  /** ADR-0070 的成员面信号。与上面那枚**分开数**：两条语义不同，合并成一枚就再也判不出"发错条"。 */
  wsNotifyShareRoster: vi.fn(),
  // 转让所有权（W6）用数组式事务：mock 只需把操作数组并发跑掉，断言看的是
  // 各 update 的调用参数（含顺序 —— 三处写的先后由路由保证，mock 不改变它）。
  $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({
    notifyShareOps: mocks.wsNotifyShareOps,
    notifyShareRosterChanged: mocks.wsNotifyShareRoster,
  }),
}));

import { shareRoutes } from '../src/shares/share.routes';

let app: FastifyInstance;

const AUTH = { authorization: 'Bearer test-token' };

/**
 * 一条**签过名的**合法 TASK op（编辑者/所有者可写）。
 *
 * 三个细节都是判据的一部分，不是夹具的讲究：
 * - 载荷是**真信封**（`encryptShareRecord`）：签名域里的 `keyEpoch` 从信封头读，
 *   随手编一个字符串会让装配器抛错，症状看起来像"服务端拒签"。
 * - `timestamp` 与签名域里的 `clientTimestamp` 必须是同一个数（写侧、服务端、读侧三名一号）。
 * - `tamper` 是**签完之后**再改线上那一份 —— 这就是"有人在动这条 op"的形状。
 */
const author = deriveShareIdentityKeyPair(new Uint8Array(32).fill(11));
const forger = deriveShareIdentityKeyPair(new Uint8Array(32).fill(12));
const shareListKey = new Uint8Array(32).fill(7);
const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

interface SignedOpOptions {
  id?: string;
  entityType?: string;
  entityId?: string;
  opType?: string;
  actionType?: string;
  timestamp?: number;
  schemaVersion?: number;
  vectorClock?: Record<string, number>;
  payload?: unknown;
  /** 用谁的私钥签（默认本机那位作者）；`signerMemberId` 声明成谁 ⇒ 由下面那枚单独控。 */
  signingKey?: Uint8Array;
  signerMemberId?: string;
  /** 真在册的那枚 shareId（默认与请求里的 share 一致）。 */
  shareId?: string;
  /** 签完之后对线上字段做一次改动（失法臂）。 */
  tamper?: Record<string, unknown>;
  /** 干脆不带签名（存量 op 的形状）。 */
  dropSignature?: boolean;
}

async function signedOp(options: SignedOpOptions = {}) {
  const id = options.id ?? 'op-1';
  const identity = {
    clientId: 'client-a',
    actionType: options.actionType ?? 'add task',
    opType: options.opType ?? 'CRT',
    entityType: options.entityType ?? 'TASK',
    entityId: options.entityId ?? 'task-1',
    timestamp: options.timestamp ?? 1_700_000_000_000,
    schemaVersion: options.schemaVersion ?? 1,
  };
  const record = await encryptShareRecord({
    id,
    plaintext: new TextEncoder().encode(JSON.stringify(options.payload ?? { title: 'hello' })),
    shareId: options.shareId ?? 'share-1',
    listKey: shareListKey,
    keyEpoch: 1,
    identity,
  });
  const wire = {
    id,
    ...identity,
    payload: record.ciphertext,
    vectorClock: options.vectorClock ?? { 'client-a': 1 },
    isPayloadEncrypted: true,
    schemaVersion: identity.schemaVersion,
    clientTimestamp: identity.timestamp,
  };
  const signature = signShareOpWire(options.signingKey ?? author.ed25519SecretKey, {
    shareId: options.shareId ?? 'share-1',
    signerMemberId: options.signerMemberId ?? 'member-1',
    wire,
  });
  const out: Record<string, unknown> = {
    ...identity,
    id,
    payload: record.ciphertext,
    vectorClock: options.vectorClock ?? { 'client-a': 1 },
    isPayloadEncrypted: true,
  };
  if (!options.dropSignature) out['signature'] = signature;
  return { ...out, ...(options.tamper ?? {}) };
}

/** 上传夹具默认"这个人已经在册"（ADR-0069 裁决二的补发腿走完之后就是这个状态）。 */
const memberAs = (role: string) => ({
  id: 'member-1', role, userId: 1n, shareId: 'share-1', signingPublicKey: toB64(author.ed25519PublicKey),
});

const activeShare = {
  id: 'share-1',
  ownerUserId: 1n,
  keyEpoch: 1,
  lastServerSeq: 5,
  deletedAt: null,
};

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
  it('没有 Authorization 头 → 401（16 条端点逐一遍历）', async () => {
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
      ['PUT', '/api/shares/share-1/members/member-1/signing-key'],
      ['DELETE', '/api/shares/share-1/members/member-1'],
      ['POST', '/api/shares/share-1/transfer'],
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
      payload: { ops: [await signedOp()] },
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
      payload: { ops: [await signedOp()] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_ROLE_FORBIDDEN');
  });

  it('commenter 写 COMMENT 被接受（W3 起 ENTITY_TYPES 已认，commenter 唯一可写实体）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('commenter'));
    mocks.share.update.mockResolvedValue({ lastServerSeq: 6 });
    mocks.shareMember.findMany.mockResolvedValue([]);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ id: 'op-comment', entityType: 'COMMENT', entityId: 'comment-1' })] },
    });
    const body = res.json();
    expect(body.accepted).toHaveLength(1);
    expect(body.rejected).toHaveLength(0);
  });

  it('viewer 写 COMMENT 仍被拒——role 门，不是实体门', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('viewer'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ id: 'op-comment-2', entityType: 'COMMENT', entityId: 'comment-2' })] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_ROLE_FORBIDDEN');
  });

  it('editor 写个人域实体（REMINDER）被拒 —— 提醒是每成员自己的', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ entityType: 'REMINDER' })] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_ENTITY_TYPE_NOT_SHAREABLE');
  });

  it('未知实体被拒为 INVALID_ENTITY_TYPE（线协议语义，不是权限语义）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ entityType: 'GHOST' })] },
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
      payload: { ops: [await signedOp(), await signedOp({ id: 'op-2', entityId: 'task-2' })] },
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
    // 🔴 ADR-0070：op 上传**不**发成员面信号 —— "日志多了第 N 条内容"与"名册/信封/公钥变了"
    // 是两条语义，客户端那条闸门各自只认自己那一条；并进一条会让面板为每条评论重取名册。
    expect(mocks.wsNotifyShareRoster).not.toHaveBeenCalled();
  });

  it('同一批里合法与非法混合：各走各的（一条坏的不能拖死一批）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    mocks.share.update.mockResolvedValue({ lastServerSeq: 6 });
    mocks.shareMember.findMany.mockResolvedValue([]);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp(), await signedOp({ id: 'op-bad', entityType: 'REMINDER' })] },
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
      payload: { ops: [await signedOp()] },
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
      payload: { ops: [await signedOp()] },
    });
    expect(res.json().accepted).toHaveLength(1);
  });
});

describe('🔴 逐 op 签名闸门（POST /shares/:id/ops，ADR-0069 裁决四）', () => {
  beforeEach(() => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareOperation.findMany.mockResolvedValue([]);
    mocks.share.update.mockResolvedValue({ lastServerSeq: 6 });
    mocks.shareMember.findMany.mockResolvedValue([]);
  });

  it('真签名被接受，且落库那行带着被验过的签名与**认证上传者**的成员行 id', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const op = await signedOp();
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH, payload: { ops: [op] },
    });
    expect(res.json().accepted).toHaveLength(1);
    const [row] = mocks.shareOperation.createMany.mock.calls[0]![0].data as Array<{
      signature: string; signerMemberId: string;
    }>;
    // 🔴 存下来的签名必须就是上传那枚（没被改写、没被丢弃），作者是认证出来的那一行。
    expect(row.signature).toBe(op['signature']);
    expect(row.signerMemberId).toBe('member-1');
  });

  it('无签上传 ⇒ SHARE_OP_UNSIGNED，且**一条都没落库**', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ dropSignature: true })] },
    });
    const body = res.json();
    expect(body.rejected).toEqual([{ id: 'op-1', code: 'SHARE_OP_UNSIGNED' }]);
    expect(body.accepted).toHaveLength(0);
    expect(mocks.shareOperation.createMany).not.toHaveBeenCalled();
    expect(mocks.share.update).not.toHaveBeenCalled();
  });

  it('成员行没有登记签名公钥 ⇒ SHARE_OP_SIGNING_KEY_UNREGISTERED（带签也一样拒）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue({ ...memberAs('editor'), signingPublicKey: null });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH, payload: { ops: [await signedOp()] },
    });
    expect(res.json().rejected).toEqual([{ id: 'op-1', code: 'SHARE_OP_SIGNING_KEY_UNREGISTERED' }]);
    expect(mocks.shareOperation.createMany).not.toHaveBeenCalled();
  });

  // 🔴 一枚字段一条失法：域里少钉一枚就是"改它不收钱"的那一格。
  const tamperTable: Array<[string, Record<string, unknown>]> = [
    ['entityId（改内容指向）', { entityId: 'task-99' }],
    ['entityType（改成别的实体族）', { entityType: 'NOTE' }],
    ['opType（把删除伪装成新增）', { opType: 'DEL' }],
    ['actionType（换动作标签）', { actionType: 'delete task' }],
    ['vectorClock（把并发伪装成有先后）', { vectorClock: { 'client-a': 9 } }],
    ['schemaVersion', { schemaVersion: 2 }],
    ['timestamp（与签名域里那个数不同）', { timestamp: 1_700_000_000_001 }],
    ['isPayloadEncrypted（把密文读成明文形状）', { isPayloadEncrypted: false }],
    ['clientId（换设备署名）', { clientId: 'client-z' }],
  ];
  it.each(tamperTable)('签完之后改 %s ⇒ SHARE_OP_SIGNATURE_INVALID，不落库', async (_label, tamper) => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ tamper })] },
    });
    expect(res.json().rejected).toEqual([{ id: 'op-1', code: 'SHARE_OP_SIGNATURE_INVALID' }]);
    expect(mocks.shareOperation.createMany).not.toHaveBeenCalled();
  });

  it('载荷换一条（AAD 会拒，但服务端**没有清单钥**，只有签名能在这里挡）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ tamper: { id: 'op-swapped' } })] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_OP_SIGNATURE_INVALID');
  });

  it('别人的钥签的合法载荷 ⇒ invalid（在册公钥不认它）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ signingKey: forger.ed25519SecretKey })] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_OP_SIGNATURE_INVALID');
  });

  it('🔴 不许代签：op 自己声明是别人写的 ⇒ 域对不上，拒（服务端只认认证上传者）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ signerMemberId: 'member-2' })] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_OP_SIGNATURE_INVALID');
    expect(mocks.shareOperation.createMany).not.toHaveBeenCalled();
  });

  it('跨清单重放一枚合法签名 ⇒ invalid（shareId 在域里）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ shareId: 'share-other' })] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_OP_SIGNATURE_INVALID');
  });

  it('同批混合：签名坏的那条拒、合法那条照常落库（不整批 400、也不"记一笔然后收下"）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: {
        ops: [await signedOp({ id: 'op-ok' }), await signedOp({ id: 'op-bad', dropSignature: true })],
      },
    });
    const body = res.json();
    expect(body.accepted).toEqual([{ id: 'op-ok', serverSeq: 6 }]);
    expect(body.rejected).toEqual([{ id: 'op-bad', code: 'SHARE_OP_UNSIGNED' }]);
    const rows = mocks.shareOperation.createMany.mock.calls[0]![0].data as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['op-ok']);
  });

  it('🔴 role 门排在签名门之前：viewer 的坏签名报的是权限，不是签名', async () => {
    // 顺序不是风格：把签名门放在前面，就等于让 viewer 用一条探测请求读出"这条签名对不对"。
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('viewer'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/ops', headers: AUTH,
      payload: { ops: [await signedOp({ dropSignature: true })] },
    });
    expect(res.json().rejected[0].code).toBe('SHARE_ROLE_FORBIDDEN');
  });

  it('下载把签名与作者带出来（读侧三态判据读的就是这两格）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    mocks.shareOperation.findMany.mockResolvedValue([
      {
        id: 'op-1', shareId: 'share-1', clientId: 'client-a', serverSeq: 6, actionType: 'add task',
        opType: 'CRT', entityType: 'TASK', entityId: 'task-1', entityIds: [], payload: 'x',
        vectorClock: {}, schemaVersion: 1, clientTimestamp: 1n, isPayloadEncrypted: true,
        signerMemberId: 'member-1', signature: 'sig-b64',
      },
      {
        id: 'op-legacy', shareId: 'share-1', clientId: 'client-b', serverSeq: 7, actionType: 'add task',
        opType: 'CRT', entityType: 'TASK', entityId: 'task-2', entityIds: [], payload: 'y',
        vectorClock: {}, schemaVersion: 1, clientTimestamp: 2n, isPayloadEncrypted: true,
        signerMemberId: null, signature: null,
      },
    ]);
    const res = await app.inject({
      method: 'GET', url: '/api/shares/share-1/ops/causal?after=0', headers: AUTH,
    });
    const rows = res.json().ops as Array<{ id: string; signature: string | null; signerMemberId: string | null }>;
    expect(rows[0]).toMatchObject({ id: 'op-1', signature: 'sig-b64', signerMemberId: 'member-1' });
    // 存量：null 是"未签名"，不是"已验证"。
    expect(rows[1]).toMatchObject({ id: 'op-legacy', signature: null, signerMemberId: null });
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

describe('M4 逐 op 签名公钥在册（ADR-0069 裁决二）', () => {
  const KEY_A = 'B'.repeat(43);
  const KEY_B = 'C'.repeat(43);

  // ── 接受邀请那一腿 ────────────────────────────────────────────────────────
  it('接受邀请带签名公钥 ⇒ 新建的成员行把它和封装公钥一起存下', async () => {
    mocks.shareInvitation.findUnique.mockResolvedValue({
      id: 'inv-1', shareId: 'share-1', revokedAt: null, expiresAt: 9_999_999_999_999n,
    });
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(null);
    mocks.shareMember.create.mockResolvedValue({ id: 'member-9', role: 'editor' });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/invitations/accept', headers: AUTH,
      payload: { token: 'token-abcdefabcdefabcdef', identityPublicKey: 'A'.repeat(43), signingPublicKey: KEY_A },
    });
    expect(res.statusCode).toBe(200);
    const created = mocks.shareMember.create.mock.calls[0]![0].data;
    expect(created.identityPublicKey).toBe('A'.repeat(43));
    expect(created.signingPublicKey).toBe(KEY_A);
  });

  it('接受邀请没带签名公钥 ⇒ 存 null —— 服务端不替谁编一枚公钥', async () => {
    mocks.shareInvitation.findUnique.mockResolvedValue({
      id: 'inv-1', shareId: 'share-1', revokedAt: null, expiresAt: 9_999_999_999_999n,
    });
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(null);
    mocks.shareMember.create.mockResolvedValue({ id: 'member-9', role: 'editor' });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/invitations/accept', headers: AUTH,
      payload: { token: 'token-abcdefabcdefabcdef', identityPublicKey: 'A'.repeat(43) },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.shareMember.create.mock.calls[0]![0].data.signingPublicKey).toBeNull();
  });

  it('老成员复用同一行、这次没带公钥 ⇒ 更新语句里不许出现这一格（清空 = 抹掉他的历史）', async () => {
    mocks.shareInvitation.findUnique.mockResolvedValue({
      id: 'inv-1', shareId: 'share-1', revokedAt: null, expiresAt: 9_999_999_999_999n,
    });
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue({ ...memberAs('editor'), removedAt: 1n, signingPublicKey: KEY_A });
    mocks.shareMember.update.mockResolvedValue({ ...memberAs('editor'), signingPublicKey: KEY_A });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/invitations/accept', headers: AUTH,
      payload: { token: 'token-abcdefabcdefabcdef', identityPublicKey: 'A'.repeat(43) },
    });
    expect(res.statusCode).toBe(200);
    const data = mocks.shareMember.update.mock.calls[0]![0].data;
    expect('signingPublicKey' in data).toBe(false);
    expect(data.removedAt).toBeNull();
  });

  it('老成员复用同一行却带来**另一枚**公钥 ⇒ 409，且成员行一次都不写', async () => {
    mocks.shareInvitation.findUnique.mockResolvedValue({
      id: 'inv-1', shareId: 'share-1', revokedAt: null, expiresAt: 9_999_999_999_999n,
    });
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue({ ...memberAs('editor'), removedAt: 1n, signingPublicKey: KEY_A });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/invitations/accept', headers: AUTH,
      payload: { token: 'token-abcdefabcdefabcdef', identityPublicKey: 'A'.repeat(43), signingPublicKey: KEY_B },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SHARE_SIGNING_KEY_CONFLICT');
    expect(mocks.shareMember.update).not.toHaveBeenCalled();
    expect(mocks.shareInvitation.update).not.toHaveBeenCalled();
  });

  // ── 自证发布那一腿（本人、幂等、只补公钥） ────────────────────────────────
  it('本人 PUT ⇒ 写的是调用者自己那一行，只动 signingPublicKey 一格', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    // 这一条测的是「首次发布」那一格：库里这行还没有公钥。
    // memberAs 的默认夹具已预填一枚（签名闸门要用），这里必须显式清空，
    // 否则先撞上「已有 ≠ 本次 ⇒ 409」，测到的就不是发布腿了。
    mocks.shareMember.findFirst.mockResolvedValue({ ...memberAs('owner'), signingPublicKey: null });
    mocks.shareMember.update.mockResolvedValue({});
    const res = await app.inject({
      method: 'PUT', url: '/api/shares/share-1/members/member-1/signing-key', headers: AUTH,
      payload: { signingPublicKey: KEY_A },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.shareMember.update).toHaveBeenCalledWith({
      where: { id: 'member-1' }, data: { signingPublicKey: KEY_A },
    });
  });

  it('owner 也挡不住：PUT 别人的 memberId ⇒ 404，一次写入都没有', async () => {
    // 调用者本行是 owner —— 代填别人公钥的那扇门必须由这一条钉死，
    // 否则「这条 op 是谁写的」的判定权就交给了第三方（服务端自己也算第三方）。
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('owner'));
    const res = await app.inject({
      method: 'PUT', url: '/api/shares/share-1/members/member-2/signing-key', headers: AUTH,
      payload: { signingPublicKey: KEY_A },
    });
    expect(res.statusCode).toBe(404);
    expect(mocks.shareMember.update).not.toHaveBeenCalled();
  });

  it('已在册再 PUT 一枚不同的 ⇒ 409，不覆盖', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue({ ...memberAs('editor'), signingPublicKey: KEY_A });
    const res = await app.inject({
      method: 'PUT', url: '/api/shares/share-1/members/member-1/signing-key', headers: AUTH,
      payload: { signingPublicKey: KEY_B },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SHARE_SIGNING_KEY_CONFLICT');
    expect(mocks.shareMember.update).not.toHaveBeenCalled();
  });

  it('同值重发 ⇒ 200（补发失败后的重试走同一条路径，不该要求客户端分辨）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue({ ...memberAs('editor'), signingPublicKey: KEY_A });
    mocks.shareMember.update.mockResolvedValue({});
    const res = await app.inject({
      method: 'PUT', url: '/api/shares/share-1/members/member-1/signing-key', headers: AUTH,
      payload: { signingPublicKey: KEY_A },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().signingPublicKey).toBe(KEY_A);
  });

  it('公钥形状不对（解不出 32 字节）⇒ 400，不落库', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const res = await app.inject({
      method: 'PUT', url: '/api/shares/share-1/members/member-1/signing-key', headers: AUTH,
      payload: { signingPublicKey: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.shareMember.update).not.toHaveBeenCalled();
  });

  // ── 读回 ───────────────────────────────────────────────────────────────────
  it('成员列表把 signingPublicKey 读回来，没在册的那一行如实是 null', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    mocks.shareMember.findMany.mockResolvedValue([
      { ...memberAs('owner'), userId: 1n, addedAt: 1n, keyEnvelope: null, memberKeyEpoch: 1, identityPublicKey: 'pub-A', signingPublicKey: KEY_A },
      { ...memberAs('editor'), id: 'member-2', userId: 2n, addedAt: 2n, keyEnvelope: null, memberKeyEpoch: 1, identityPublicKey: 'pub-B', signingPublicKey: null },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/shares/share-1/members', headers: AUTH });
    const body = res.json();
    expect(body.members[0].signingPublicKey).toBe(KEY_A);
    expect(body.members[1].signingPublicKey).toBeNull();
  });
});

describe('转让所有权（POST /shares/:id/transfer，W6）', () => {
  // B-10 之后，"合格的接收方"必须是**手里有当前世代信封**的那个人（`activeShare.keyEpoch` = 1）。
  // 这一行就是那三头验收臂里的"补齐 ⇒ 必须过"。
  const targetEditor = {
    ...memberAs('editor'),
    id: 'member-2',
    userId: 2n,
    keyEnvelope: { alg: 'x25519-xsalsa20-poly1305', ct: 'sealed' },
    memberKeyEpoch: 1,
  };

  beforeEach(() => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    // mockReset 而不是只排 Once 链：上一条用例没消费完的 Once 队列会**排在**新链
    // 前面被先消费（validation 用例不查库就会留下两条），顺序就漂了。
    mocks.shareMember.findFirst.mockReset();
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce(targetEditor);
    mocks.share.update.mockResolvedValue({});
    mocks.shareMember.update.mockResolvedValue({});
    mocks.$transaction.mockClear();
  });

  it('owner 转给 editor：换 owner + 原 owner 降 editor + share.ownerUserId，三处一个事务', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/transfer', headers: AUTH,
      payload: { memberId: 'member-2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      shareId: 'share-1',
      ownerId: 2,
      newOwnerMemberId: 'member-2',
      demotedMemberId: 'member-1',
      demotedRole: 'editor',
    });
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    const ops = mocks.$transaction.mock.calls[0]![0] as unknown[];
    expect(ops, '三处写必须都进同一个事务').toHaveLength(3);
    // 🔴 语义核心（变异臂钉在这）：share.ownerUserId 是详情/列表 ownerId 的事实源；
    // 新 owner 升 owner；**原 owner 必须降 editor** —— 拿掉第三条写，下面这组
    // 断言恰好红（共享清单不允许出现双 owner）。
    expect(mocks.share.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'share-1' }, data: { ownerUserId: 2n } }),
    );
    expect(mocks.shareMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member-2' }, data: { role: 'owner' } }),
    );
    expect(mocks.shareMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member-1' }, data: { role: 'editor' } }),
    );
  });

  // 🔴 B-10 的失法臂①：这是**新成员默认就在的形状** —— 接受邀请那条写路径建成员时
  // 带 `memberKeyEpoch: share.keyEpoch` 却不带 `keyEnvelope`，所以"世代对齐"单独看
  // 会放行一个刚接手就解不开自己清单的 owner。这一臂就是为了让"只比世代"的写法红。
  it('B-10：目标世代对齐但手里没有信封 → 409，一处都不写', async () => {
    mocks.shareMember.findFirst.mockReset();
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce({ ...targetEditor, keyEnvelope: null });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/transfer', headers: AUTH,
      payload: { memberId: 'member-2' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SHARE_TRANSFER_TARGET_UNSEALED');
    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(mocks.share.update).not.toHaveBeenCalled();
    expect(mocks.shareMember.update).not.toHaveBeenCalled();
  });

  // 🔴 B-10 的失法臂②：信封非空但那是**上一世代**的钥（owner 换过密钥、还没给他重发）。
  // 这一臂钉住"只看信封非空"的写法 —— 反方向的假绿：臂① 挡不住它，臂② 挡不住臂①。
  it('B-10：目标有信封但世代落后于当前 share.keyEpoch → 409，一处都不写', async () => {
    mocks.share.findFirst.mockReset();
    mocks.share.findFirst.mockResolvedValue({ ...activeShare, keyEpoch: 2 });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/transfer', headers: AUTH,
      payload: { memberId: 'member-2' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SHARE_TRANSFER_TARGET_UNSEALED');
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('editor 调转让 → 403（owner 专属动作）', async () => {
    mocks.shareMember.findFirst.mockReset();
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('editor'))
      .mockResolvedValueOnce(targetEditor);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/transfer', headers: AUTH,
      payload: { memberId: 'member-2' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('SHARE_ROLE_FORBIDDEN');
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('目标不是本共享的活跃成员 → 404（存在性不外泄）', async () => {
    mocks.shareMember.findFirst.mockReset();
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/transfer', headers: AUTH,
      payload: { memberId: 'member-x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('转让给自己 → 400', async () => {
    mocks.shareMember.findFirst.mockReset();
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce(memberAs('owner'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/transfer', headers: AUTH,
      payload: { memberId: 'member-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('载荷缺 memberId → 400（validation_failed，统一信封）', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/transfer', headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
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

/**
 * ADR-0070：成员面九条写路径各发一条 `share_roster_changed`，且**只在这九条**上发。
 *
 * 判据按"这一条信号有没有人等"写：
 *  · 每条成功路径都必须发 —— 少任何一条，撤掉面板与入群对话框那两枚轮询之后，
 *    对应那件事就退化成"刷新页面才看得到"（界面上不报错，纯静默）。
 *  · op 上传路径**不许**发成员面信号 —— 它有自己的那条（语义是"日志多了第 N 条"）。
 *  · 失败路径（401/403/404/409/410）一条都不发 —— 名册没变。
 *  · 名单是**写之后**查的 ⇒ 被移除/退出的人不在扇出里。
 *  · 扇出炸了不许把写结果一起带走。
 */
describe('ADR-0070 成员面信号（share_roster_changed）', () => {
  const twoMembers = [{ userId: 1n }, { userId: 2n }];

  beforeEach(() => {
    /*
     * 🔴 必须先清 `findFirst` 的 Once 链再排自己的：Once 队列**优先于** `mockResolvedValue`，
     * 而前面那些 describe 的 `beforeEach` 会往里排两三条（转让那一族排的就是 owner + 接收方）。
     * 不排干净的话，这一组读到的是上一族留下的那"第 N 个人"，
     * 症状读起来像产品坏了 —— owner 却被判 403（我第一趟就是这么红的）。
     */
    mocks.share.findFirst.mockReset();
    mocks.shareMember.findFirst.mockReset();
    mocks.shareMember.findMany.mockReset();
    mocks.shareMember.update.mockReset();
    mocks.shareMember.count.mockReset();
    mocks.shareMember.create.mockReset().mockImplementation(
      async (args: { data: { id: string; role: string } }) => ({ id: args.data.id, role: args.data.role }),
    );
    mocks.shareInvitation.create.mockReset();
    mocks.shareInvitation.update.mockReset();
    mocks.shareInvitation.updateMany.mockReset();
    mocks.shareInvitation.findUnique.mockReset();
  });

  it('发邀请 ⇒ 发给当前成员（owner 另一台设备也在同一 userId 下）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('owner'));
    mocks.shareMember.findMany.mockResolvedValue([{ userId: 1n }]);
    mocks.shareInvitation.create.mockResolvedValue({ id: 'inv-1', expiresAt: 1n });
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/invitations', headers: AUTH, payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(mocks.wsNotifyShareRoster).toHaveBeenCalledWith([1], 'share-1');
    expect(mocks.wsNotifyShareOps, '成员面变化不是 op 信号').not.toHaveBeenCalled();
  });

  it('吊销邀请 ⇒ 发（邀请列表也是面板那一份详情里的东西）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('owner'));
    mocks.shareMember.findMany.mockResolvedValue(twoMembers);
    mocks.shareInvitation.updateMany.mockResolvedValue({ count: 1 });
    const res = await app.inject({
      method: 'DELETE', url: '/api/shares/share-1/invitations/inv-1', headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.wsNotifyShareRoster).toHaveBeenCalledWith([1, 2], 'share-1');
  });

  it('接受邀请 ⇒ 发（owner 那台等着看见新人，新人自己的其余设备也是）', async () => {
    mocks.shareInvitation.findUnique.mockResolvedValue({
      id: 'inv-1', shareId: 'share-1', revokedAt: null, expiresAt: 9_999_999_999_999n,
    });
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(null);
    mocks.shareMember.count.mockResolvedValue(1);
    mocks.shareMember.create.mockResolvedValue({ id: 'member-9', role: 'editor' });
    mocks.shareMember.findMany.mockResolvedValue(twoMembers);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/invitations/accept', headers: AUTH,
      payload: { token: 'token-abcdefabcdefabcdef', identityPublicKey: 'A'.repeat(43) },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.wsNotifyShareRoster).toHaveBeenCalledWith([1, 2], 'share-1');
  });

  it('改角色 ⇒ 发（被改者那一台要立刻知道自己的新档位）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce({ ...memberAs('editor'), id: 'member-2' });
    mocks.shareMember.update.mockResolvedValue({});
    mocks.shareMember.findMany.mockResolvedValue(twoMembers);
    const res = await app.inject({
      method: 'PATCH', url: '/api/shares/share-1/members/member-2', headers: AUTH,
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.wsNotifyShareRoster).toHaveBeenCalledWith([1, 2], 'share-1');
  });

  it('🔴 信封下发 ⇒ 发。这是入群对话框那枚轮询撤掉后唯一的驱动', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce({ ...memberAs('editor'), id: 'member-2' });
    mocks.shareMember.update.mockResolvedValue({});
    mocks.share.update.mockResolvedValue({});
    mocks.shareMember.findMany.mockResolvedValue(twoMembers);
    const res = await app.inject({
      method: 'PUT', url: '/api/shares/share-1/members/member-2/envelope', headers: AUTH,
      payload: { keyEpoch: 2, keyEnvelope: { recipientFingerprint: 'x', ciphertext: 'y' } },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.wsNotifyShareRoster).toHaveBeenCalledWith([1, 2], 'share-1');
  });

  it('签名公钥自证 ⇒ 发（别人手里那份验签名册靠它才不是死的）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue({ ...memberAs('owner'), signingPublicKey: null });
    mocks.shareMember.update.mockResolvedValue({});
    mocks.shareMember.findMany.mockResolvedValue(twoMembers);
    const res = await app.inject({
      method: 'PUT', url: '/api/shares/share-1/members/member-1/signing-key', headers: AUTH,
      payload: { signingPublicKey: 'B'.repeat(43) },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.wsNotifyShareRoster).toHaveBeenCalledWith([1, 2], 'share-1');
  });

  it('移除成员 ⇒ 发的名单里**不含**被移除者（名单是写之后查的）', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce({ ...memberAs('editor'), id: 'member-2' });
    mocks.shareMember.update.mockResolvedValue({});
    mocks.shareMember.findMany.mockResolvedValue([{ userId: 1n }]);
    const res = await app.inject({
      method: 'DELETE', url: '/api/shares/share-1/members/member-2', headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.wsNotifyShareRoster).toHaveBeenCalledWith([1], 'share-1');
  });

  it('退出 ⇒ 发给剩下的人（含 owner），退出者自己不在内', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue({ ...memberAs('editor'), id: 'member-2', userId: 2n });
    mocks.shareMember.update.mockResolvedValue({});
    mocks.shareMember.findMany.mockResolvedValue([{ userId: 1n }]);
    const res = await app.inject({ method: 'POST', url: '/api/shares/share-1/leave', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(mocks.wsNotifyShareRoster).toHaveBeenCalledWith([1], 'share-1');
  });

  it('转让 ⇒ 发，且在事务提交之后才发（半途发出去别人会读到双 owner）', async () => {
    const targetEditor = {
      ...memberAs('editor'), id: 'member-2', userId: 2n,
      keyEnvelope: { alg: 'x25519-xsalsa20-poly1305', ct: 'sealed' }, memberKeyEpoch: 1,
    };
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce(targetEditor);
    mocks.share.update.mockResolvedValue({});
    mocks.shareMember.update.mockResolvedValue({});
    mocks.shareMember.findMany.mockResolvedValue(twoMembers);
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/transfer', headers: AUTH, payload: { memberId: 'member-2' },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.$transaction, '信号必须在事务之后').toHaveBeenCalledTimes(1);
    expect(mocks.wsNotifyShareRoster).toHaveBeenCalledWith([1, 2], 'share-1');
  });

  it('创建清单只影响本人 ⇒ 不发成员面信号（本人的其余设备走个人 op-log）', async () => {
    mocks.shareMember.findFirst.mockResolvedValue(null);
    const created = await app.inject({ method: 'POST', url: '/api/shares', headers: AUTH, payload: {} });
    expect(created.statusCode).toBe(201);
    expect(mocks.wsNotifyShareRoster).not.toHaveBeenCalled();
  });

  it('被拒的写一条都不发：editor 发邀请 403、转让不合格接收方 409', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('editor'));
    const forbidden = await app.inject({
      method: 'POST', url: '/api/shares/share-1/invitations', headers: AUTH, payload: {},
    });
    expect(forbidden.statusCode).toBe(403);
    expect(mocks.wsNotifyShareRoster).not.toHaveBeenCalled();

    mocks.shareMember.findFirst
      .mockReset()
      .mockResolvedValueOnce(memberAs('owner'))
      .mockResolvedValueOnce({ ...memberAs('editor'), id: 'member-2', keyEnvelope: null });
    const unsealed = await app.inject({
      method: 'POST', url: '/api/shares/share-1/transfer', headers: AUTH, payload: { memberId: 'member-2' },
    });
    expect(unsealed.statusCode).toBe(409);
    expect(mocks.wsNotifyShareRoster).not.toHaveBeenCalled();
  });

  it('🔴 扇出炸了（名单查询失败）⇒ 写结果不受影响，也不许把 500 抛给调用方', async () => {
    mocks.share.findFirst.mockResolvedValue(activeShare);
    mocks.shareMember.findFirst.mockResolvedValue(memberAs('owner'));
    mocks.shareInvitation.create.mockResolvedValue({ id: 'inv-1', expiresAt: 1n });
    mocks.shareMember.findMany.mockRejectedValue(new Error('ws fanout blew up'));
    const res = await app.inject({
      method: 'POST', url: '/api/shares/share-1/invitations', headers: AUTH, payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(mocks.wsNotifyShareRoster).not.toHaveBeenCalled();
  });
});
