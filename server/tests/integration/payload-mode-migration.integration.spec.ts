/**
 * ADR-0080 S2：在**真实 PostgreSQL** 上证明"关掉加密"这一趟的发布边界。
 *
 * 这里不经过 HTTP，直接调 staging 服务 —— 因为要证的是事务内的三件事同时成立：
 *   ① 每条 retained op 的 payload 变成明文，且 `is_payload_encrypted = false`；
 *   ② 账号 `payload_mode` 翻成 `readable`；
 *   ③ 密钥包**真的被删掉**（不是留着等下次）。
 *
 * 数据库 CHECK 会替我们再验一遍"readable 目标不得带密钥世代"。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { vaultKeyMigrationService } from '../../src/sync/services/vault-key-migration.service';

const DATABASE_URL = process.env.DATABASE_URL;

const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value ?? null) ?? 'null', 'utf8');

/** vault 信封：魔数 + 版本 1 + 8 字节世代 + 载荷。 */
const vaultPayload = (generation: number): string => {
  const magic = Buffer.from('heyta-vault-op/', 'ascii');
  const bytes = Buffer.alloc(magic.length + 1 + 8 + 29);
  magic.copy(bytes);
  bytes.writeUInt8(1, magic.length);
  bytes.writeDoubleBE(generation, magic.length + 1);
  return bytes.toString('base64');
};

describe.skipIf(!DATABASE_URL)('关掉端到端加密：真实 PostgreSQL 发布边界', () => {
  const db = new PrismaClient();
  let userId: number;
  const requestId = `turn-off-${randomUUID()}`;
  const plaintextA = JSON.stringify({ title: '买牛奶' });
  const plaintextB = JSON.stringify({ title: '交水费' });

  const packageFor = (keyVersion: number) => ({
    version: 1,
    keyVersion,
    rootKeyFingerprint: 'a'.repeat(64),
    passphrase: {
      kdf: 'argon2id',
      salt: Buffer.alloc(16, 1).toString('base64'),
      iv: Buffer.alloc(12, 2).toString('base64'),
      ciphertext: Buffer.alloc(48, 3).toString('base64'),
    },
    recovery: {
      kdf: 'argon2id',
      salt: Buffer.alloc(16, 4).toString('base64'),
      iv: Buffer.alloc(12, 5).toString('base64'),
      ciphertext: Buffer.alloc(48, 6).toString('base64'),
    },
  });

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `turn-off-${randomUUID()}@test.local`, isVerified: 1, storageQuotaBytes: BigInt(1 << 30) },
    });
    userId = user.id;
    // 这条用例模拟"已经开着加密的账号"：显式写 e2ee（ADR-0081 之后新账号默认是明文）。
    await db.userSyncState.create({ data: { userId, lastSeq: 2, payloadMode: 'e2ee' } });
    await db.vaultKeyPackage.create({
      data: { userId, keyVersion: 1, packageData: packageFor(1), activePayloadKeyVersion: 1, createdAt: 1n, updatedAt: 1n },
    });
    for (const [seq, id] of [[1, 'op-a'], [2, 'op-b']] as const) {
      await db.operation.create({
        data: {
          id: `${requestId}-${id}`, userId, clientId: 'client-a', serverSeq: seq,
          actionType: 'UPDATE', opType: 'UPD', entityType: 'TASK', entityId: id,
          entityIds: [], payload: Buffer.alloc(28, 9).toString('base64'), payloadBytes: 100n,
          vectorClock: { 'client-a': seq }, schemaVersion: 1,
          clientTimestamp: BigInt(seq), receivedAt: BigInt(seq), isPayloadEncrypted: true,
        },
      });
    }
  }, 30000);

  afterAll(async () => {
    if (userId !== undefined) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });

  it('begin → chunk → commit 之后：明文、readable、包已删', async () => {
    const a = `${requestId}-op-a`;
    const b = `${requestId}-op-b`;

    await vaultKeyMigrationService.begin(userId, {
      requestId,
      targetMode: 'readable',
      expectedKeyVersion: 1,
      expectedLatestSeq: 2,
      expectedOperationCount: 2,
      expectedPayloadBytes: jsonBytes(plaintextA) + jsonBytes(plaintextB),
    });

    await vaultKeyMigrationService.uploadChunk(userId, {
      requestId,
      chunkId: 'chunk-1',
      chunkIndex: 0,
      operations: [
        { id: a, serverSeq: 1, payload: plaintextA },
        { id: b, serverSeq: 2, payload: plaintextB },
      ],
    });

    const published = await vaultKeyMigrationService.commit(userId, requestId);
    expect(published.state).toBe('PUBLISHED');
    expect(published.targetMode).toBe('readable');
    expect(published.keyVersion).toBeNull();
    expect(published.payloadKeyVersion).toBeNull();

    const syncState = await db.userSyncState.findUnique({ where: { userId }, select: { payloadMode: true } });
    expect(syncState?.payloadMode).toBe('readable');

    // 包必须真的没了：readable 模式下没有任何一把钥匙能打开它。
    expect(await db.vaultKeyPackage.findUnique({ where: { userId } })).toBeNull();

    const ops = await db.operation.findMany({ where: { userId }, orderBy: { serverSeq: 'asc' } });
    expect(ops.map((op) => op.payload)).toEqual([plaintextA, plaintextB]);
    expect(ops.every((op) => op.isPayloadEncrypted === false)).toBe(true);
  }, 60000);

  it('已经是 readable 再发起同一趟 ⇒ wrong_payload_mode（不是静默成功）', async () => {
    await expect(
      vaultKeyMigrationService.begin(userId, {
        requestId: `${requestId}-again`,
        targetMode: 'readable',
        expectedKeyVersion: 1,
        expectedLatestSeq: 2,
        expectedOperationCount: 2,
        expectedPayloadBytes: jsonBytes(plaintextA) + jsonBytes(plaintextB),
      }),
    ).rejects.toMatchObject({ code: 'wrong_payload_mode' });
  });

  it('readable → e2ee：首次发布包、世代从 1 起、行重新标成已加密', async () => {
    const a = `${requestId}-op-a`;
    const b = `${requestId}-op-b`;
    const openRequestId = `${requestId}-open`;
    const cipher = vaultPayload(1);

    await vaultKeyMigrationService.begin(userId, {
      requestId: openRequestId,
      targetMode: 'e2ee',
      expectedKeyVersion: 0,
      expectedLatestSeq: 2,
      targetPayloadKeyVersion: 1,
      package: packageFor(1),
      expectedOperationCount: 2,
      expectedPayloadBytes: jsonBytes(cipher) * 2,
    });

    await vaultKeyMigrationService.uploadChunk(userId, {
      requestId: openRequestId,
      chunkId: 'chunk-1',
      chunkIndex: 0,
      operations: [
        { id: a, serverSeq: 1, payload: cipher },
        { id: b, serverSeq: 2, payload: cipher },
      ],
    });

    const published = await vaultKeyMigrationService.commit(userId, openRequestId);
    expect(published.targetMode).toBe('e2ee');
    expect(published.keyVersion).toBe(1);
    expect(published.payloadKeyVersion).toBe(1);

    const pkg = await db.vaultKeyPackage.findUnique({ where: { userId } });
    expect(pkg?.keyVersion).toBe(1);
    expect(pkg?.activePayloadKeyVersion).toBe(1);

    const syncState = await db.userSyncState.findUnique({ where: { userId }, select: { payloadMode: true } });
    expect(syncState?.payloadMode).toBe('e2ee');

    const ops = await db.operation.findMany({ where: { userId }, orderBy: { serverSeq: 'asc' } });
    expect(ops.every((op) => op.isPayloadEncrypted === true)).toBe(true);
  }, 60000);

});
