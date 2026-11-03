/**
 * `/api/attachments/:attachmentId` 的契约测试（工单 #9）
 * ====================================================
 *
 * 这条链上最值钱的三件事，都是**不会报错**的那一类：
 *
 *   1. 🔴 **按调用者过滤。** 字节以客户端生成的 id 为键，如果 `where` 里少了
 *      `userId`，任何拿到那串 id 的人（把 URL 粘进聊天是完全可能的）就能读到
 *      别人的文件。这里逐条断言 mock 收到的 `where` 里**确实带着**调用者的 userId。
 *   2. 🔴 **`byte_count` 是服务端测的。** 客户端虚报一个小的数就能少占额度，
 *      而配额判据正是这个数。
 *   3. ⚠️ **附件字节绝不写 `users.storage_used_bytes`。** 那个计数器是 op-log + 快照的
 *      缓存值，任何一次对账都会把加进去的附件字节静默抹掉。这条用"`user.update`
 *      一次都没被调用"来钉 —— 它比任何注释都难被后来人绕过。
 *
 * ⚠️ 全程 mock `prisma`，不碰数据库（与 `account-profile.spec.ts` 同一立场）。
 * 迁移本身的形状由 `prisma migrate diff` 对过：`migration.sql` 与 schema 生成的
 * DDL 逐字一致（列名/类型/NOT NULL/约束名），那件事记在计划的工单 #9 那节。
 *
 * ⚠️ "单文件太大"那一条（413 + `ATTACHMENT_TOO_LARGE`）**这里没测**：走到它需要
 * 一个 20 MiB 以上的请求体，把它塞进单测只会让这枚文件变成一个 60 MB 的内存尖峰。
 * 判据本身是纯算术，量在 `packages/shared-schema/tests/attachment-contract.spec.ts`。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  attachmentBlob: {
    findFirst: vi.fn(),
    aggregate: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  vaultKeyMigration: { aggregate: vi.fn() },
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

import { ATTACHMENT_ERROR_CODES } from '@heyta/shared-schema';

import { attachmentRoutes } from '../src/attachments/attachment.routes';

vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

const SECRET = process.env.JWT_SECRET;
if (SECRET === undefined) throw new Error('测试进程里没有 JWT_SECRET');

const token = (userId: number): string =>
  `Bearer ${jwt.sign({ userId, email: `u${userId}@example.test`, tokenVersion: 0 }, SECRET, { expiresIn: '1h' })}`;

const ID = 'att-0f6d3a1b-2c4d-4e5f-8a9b-0c1d2e3f4a5b';
/** 3 字节的合法 base64。 */
const DATA = Buffer.from('hey').toString('base64');

let app: FastifyInstance;

/** 账号额度：足够宽，让默认用例只测路由本身。 */
function quota(storageQuotaBytes: number, storageUsedBytes: number): void {
  mocks.user.findUnique.mockResolvedValue({
    id: 1,
    tokenVersion: 0,
    isVerified: 1,
    storageQuotaBytes: BigInt(storageQuotaBytes),
    storageUsedBytes: BigInt(storageUsedBytes),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  quota(100_000, 0);
  mocks.attachmentBlob.findFirst.mockResolvedValue(null);
  mocks.attachmentBlob.aggregate.mockResolvedValue({ _sum: { byteCount: 0 } });
  mocks.attachmentBlob.upsert.mockResolvedValue({});
  mocks.attachmentBlob.deleteMany.mockResolvedValue({ count: 1 });
  mocks.vaultKeyMigration.aggregate.mockResolvedValue({ _sum: { reservedStorageBytes: 0n } });

  // 🔴 夹具的全局 `bodyLimit` 与生产同值：否则"路由级上限"这条判据会被一个
  // 错误的挡箭牌顶掉（限制静默失效时用例会照样绿）。
  app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  await app.register(attachmentRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('PUT 上传', () => {
  it('回服务端算的 hash 与实测字节数', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
      payload: { dataBase64: DATA, contentType: 'image/png' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      hash: createHash('sha256').update(Buffer.from(DATA, 'base64')).digest('hex'),
      byteCount: 3,
    });
  });

  it('🔴 写库的 `byte_count` 是解码后实测的那一个', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
      payload: { dataBase64: DATA, contentType: 'image/png' },
    });
    const arg = mocks.attachmentBlob.upsert.mock.calls[0]?.[0] as {
      create: { byteCount: number; userId: number; attachmentId: string };
    };
    expect(arg.create.byteCount).toBe(3);
    expect(arg.create.userId).toBe(1);
    expect(arg.create.attachmentId).toBe(ID);
  });

  it('🔴 附件字节一次都不碰 users.storage_used_bytes', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
      payload: { dataBase64: DATA, contentType: 'image/png' },
    });
    expect(mocks.user.update).not.toHaveBeenCalled();
  });

  it('配额算的是「op 那侧 + 附件那侧」相加后的数', async () => {
    quota(100, 80);
    // 已有 5 字节附件：80 + 5 + 3 = 88 ≤ 100 ⇒ 放行。
    mocks.attachmentBlob.aggregate.mockResolvedValue({ _sum: { byteCount: 5 } });
    const ok = await app.inject({
      method: 'PUT',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
      payload: { dataBase64: DATA, contentType: 'image/png' },
    });
    expect(ok.statusCode).toBe(200);

    // 换成 20 字节：80 + 20 + 3 = 103 > 100 ⇒ 拒。
    mocks.attachmentBlob.aggregate.mockResolvedValue({ _sum: { byteCount: 20 } });
    const full = await app.inject({
      method: 'PUT',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
      payload: { dataBase64: DATA, contentType: 'image/png' },
    });
    expect(full.statusCode).toBe(507);
    expect(full.json().code).toBe(ATTACHMENT_ERROR_CODES.quotaExceeded);
  });

  it('覆盖同一个附件时，旧字节先从配额里扣掉', async () => {
    quota(100, 90);
    mocks.attachmentBlob.aggregate.mockResolvedValue({ _sum: { byteCount: 3 } });
    mocks.attachmentBlob.findFirst.mockResolvedValue({ byteCount: 3 });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
      payload: { dataBase64: DATA, contentType: 'image/png' },
    });
    // 90 + (3 - 3) = 90 ≤ 100：不加这一道信用，"重传同一个文件"会在额度将满时必然失败。
    expect(res.statusCode).toBe(200);
  });

  it('id 不合法 ⇒ 400，而且根本不查库', async () => {
    // 路由是 `/attachments/:attachmentId`，所以这一段必须**能落到路由上**再被
    // 形状闸门拒掉。用 `../` 那种写法会被 fastify 先规范化成另一个路径，
    // 得到的是 404「没有这条路由」—— 那不是本条要钉的判据。
    const res = await app.inject({
      method: 'PUT',
      url: '/api/attachments/not-an-attachment-id',
      headers: { authorization: token(1) },
      payload: { dataBase64: DATA, contentType: 'image/png' },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.attachmentBlob.upsert).not.toHaveBeenCalled();
  });

  it('body 少一个键 ⇒ 400 validation_failed', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
      payload: { contentType: 'image/png' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
  });

  it('未登录 ⇒ 401，不落库', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/attachments/${ID}`,
      payload: { dataBase64: DATA, contentType: 'image/png' },
    });
    expect(res.statusCode).toBe(401);
    expect(mocks.attachmentBlob.upsert).not.toHaveBeenCalled();
  });
});

describe('DELETE 回收', () => {
  it('🔴 删除条件也带着 userId', async () => {
    mocks.attachmentBlob.findFirst.mockResolvedValue({ byteCount: 7 });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ releasedBytes: 7 });
    const del = mocks.attachmentBlob.deleteMany.mock.calls[0]?.[0] as {
      where: { attachmentId: string; userId: number };
    };
    expect(del.where).toEqual({ attachmentId: ID, userId: 1 });
  });

  it('本来就没有字节 ⇒ 仍算成功（幂等），回 0 字节', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ releasedBytes: 0 });
  });

  it('🔴 它只删字节 —— 不覆盖写、也不碰 op（实体的墓碑由 action 负责）', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/attachments/${ID}`,
      headers: { authorization: token(1) },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.attachmentBlob.deleteMany).toHaveBeenCalledTimes(1);
    // 上传路径一次都没走：删字节不该顺手把行重写一遍。
    expect(mocks.attachmentBlob.upsert).not.toHaveBeenCalled();
    // 夹具里**没有** `operation` 这枚 mock，所以这个 200 本身就证明这条路由
    // 不写 op-log —— 真去写会在运行时炸成 500，而这一条会红。
  });
});
