import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0080 S2：**关掉端到端加密**那一趟的 staging。
 *
 * 这一组只钉"模式决定的那四个判断点"，不重跑整台 staging 机器：
 *   ① 起点必须是 e2ee（否则没有可关的东西）；
 *   ② manifest 不得携带新密钥包 / 目标世代（那是"打开"才有的）；
 *   ③ 分片必须是**明文 JSON**，混进密文就拒；
 *   ④ 发布时 `is_payload_encrypted` 必须写成 false，且密钥包**真的被删掉**。
 */

const state = vi.hoisted(() => ({
  packageRow: null as any,
  syncState: { userId: 1, lastSeq: 2, payloadMode: 'e2ee', snapshotData: null } as any,
  operations: [] as any[],
  migration: null as any,
  stagedOps: [] as any[],
  /** 捕获发布 SQL 里绑定的"是否加密"参数。 */
  payloadFlags: [] as unknown[],
}));

const packageFor = (keyVersion: number) => ({
  version: 1 as const,
  keyVersion,
  rootKeyFingerprint: 'a'.repeat(64),
  passphrase: {
    kdf: 'argon2id' as const,
    salt: Buffer.alloc(16, 1).toString('base64'),
    iv: Buffer.alloc(12, 2).toString('base64'),
    ciphertext: Buffer.alloc(48, 3).toString('base64'),
  },
  recovery: {
    kdf: 'argon2id' as const,
    salt: Buffer.alloc(16, 4).toString('base64'),
    iv: Buffer.alloc(12, 5).toString('base64'),
    ciphertext: Buffer.alloc(48, 6).toString('base64'),
  },
});

const ciphertext = (): string => Buffer.alloc(44, 7).toString('base64');
const plaintext = (): string => JSON.stringify({ title: '买牛奶' });

const tx = {
  $queryRaw: vi.fn(async () => [{ lastSeq: state.syncState.lastSeq }]),
  $executeRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    // 发布 SQL 的绑定参数里带着 is_payload_encrypted 的取值。
    const flag = values.find((value) => typeof value === 'boolean');
    if (typeof flag === 'boolean') state.payloadFlags.push(flag);
    return state.stagedOps.length;
  }),
  userSyncState: {
    upsert: vi.fn(async () => state.syncState),
    findUnique: vi.fn(async () => state.syncState),
    update: vi.fn(async ({ data }: any) => {
      state.syncState = { ...state.syncState, ...data };
      return state.syncState;
    }),
  },
  user: {
    findUnique: vi.fn(async () => ({ storageUsedBytes: 0n, storageQuotaBytes: 1n << 40n })),
  },
  vaultKeyPackage: {
    findUnique: vi.fn(async () => state.packageRow),
    updateMany: vi.fn(async ({ data }: any) => {
      state.packageRow = { ...state.packageRow, ...data };
      return { count: 1 };
    }),
    deleteMany: vi.fn(async () => {
      const existed = state.packageRow !== null;
      state.packageRow = null;
      return { count: existed ? 1 : 0 };
    }),
  },
  vaultKeyMigration: {
    findUnique: vi.fn(async () => state.migration),
    findFirst: vi.fn(async () => null),
    aggregate: vi.fn(async () => ({ _sum: { reservedStorageBytes: 0n } })),
    count: vi.fn(async () => 0),
    create: vi.fn(async ({ data }: any) => {
      state.migration = { id: 'migration-1', ...data };
      return state.migration;
    }),
    update: vi.fn(async ({ data }: any) => {
      state.migration = { ...state.migration, ...data };
      return state.migration;
    }),
  },
  vaultKeyMigrationChunk: {
    findUnique: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => ({ id: 'chunk-row-1', ...data })),
    deleteMany: vi.fn(async () => ({ count: 1 })),
  },
  vaultKeyMigrationOperation: {
    createMany: vi.fn(async ({ data }: any) => {
      state.stagedOps.push(...data);
      return { count: data.length };
    }),
    count: vi.fn(async () => state.stagedOps.length),
    deleteMany: vi.fn(async () => ({ count: state.stagedOps.length })),
  },
  operation: {
    count: vi.fn(async () => state.operations.length),
    findMany: vi.fn(async () => state.operations),
  },
};

vi.mock('../src/db', () => ({
  prisma: { $transaction: vi.fn(async (callback: (client: any) => Promise<unknown>) => callback(tx)) },
}));

import { VaultKeyMigrationError, VaultKeyMigrationService } from '../src/sync/services/vault-key-migration.service';

const readableManifest = (overrides: Record<string, unknown> = {}) => ({
  requestId: 'turn-off-1',
  targetMode: 'readable' as const,
  expectedKeyVersion: 1,
  expectedLatestSeq: 2,
  expectedOperationCount: 2,
  expectedPayloadBytes: plaintext().length * 2,
  ...overrides,
});

describe('关掉加密的 staging（ADR-0080）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.packageRow = {
      userId: 1,
      keyVersion: 1,
      packageData: packageFor(1),
      activePayloadKeyVersion: 1,
      updatedAt: 1n,
    };
    state.syncState = { userId: 1, lastSeq: 2, payloadMode: 'e2ee', snapshotData: null };
    state.operations = [
      { id: 'op-a', serverSeq: 1, payload: ciphertext(), payloadBytes: 100n, vectorClock: { a: 1 } },
      { id: 'op-b', serverSeq: 2, payload: ciphertext(), payloadBytes: 100n, vectorClock: { a: 2 } },
    ];
    state.migration = null;
    state.stagedOps = [];
    state.payloadFlags = [];
  });

  it('begin 接受 readable：落库时三个密钥列必须为空', async () => {
    const service = new VaultKeyMigrationService();
    await service.begin(1, readableManifest());

    expect(state.migration.targetMode).toBe('readable');
    expect(state.migration.keyVersion).toBeNull();
    expect(state.migration.targetPayloadKeyVersion).toBeNull();
    // Prisma 用 DbNull 这个哨兵表示"把 Json? 列写成 SQL NULL"，落库结果就是 NULL。
    expect(state.migration.packageData).toBe(Prisma.DbNull);
    expect(state.migration.expectedKeyVersion).toBe(1);
  });

  it('begin 拒绝"已经是 readable"的账号（没有可关的东西）', async () => {
    state.syncState = { ...state.syncState, payloadMode: 'readable' };
    const service = new VaultKeyMigrationService();

    await expect(service.begin(1, readableManifest())).rejects.toMatchObject({
      code: 'wrong_payload_mode',
    });
  });

  it('begin 拒绝携带密钥包的 readable manifest（那是"打开"的形状）', async () => {
    const service = new VaultKeyMigrationService();

    await expect(
      service.begin(1, readableManifest({ package: packageFor(2), targetPayloadKeyVersion: 2 })),
    ).rejects.toMatchObject({ code: 'migration_coverage_mismatch' });
  });

  it('chunk 拒绝把密文塞进明文迁移', async () => {
    const service = new VaultKeyMigrationService();
    await service.begin(1, readableManifest());
    state.migration = { ...state.migration, state: 'STAGING', expiresAt: BigInt(Date.now() + 60_000) };

    await expect(
      service.uploadChunk(1, {
        requestId: 'turn-off-1',
        chunkId: 'chunk-1',
        chunkIndex: 0,
        operations: [{ id: 'op-a', serverSeq: 1, payload: ciphertext() }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('chunk 接受明文 JSON，并把它暂存', async () => {
    const service = new VaultKeyMigrationService();
    await service.begin(1, readableManifest());
    state.migration = { ...state.migration, state: 'STAGING', expiresAt: BigInt(Date.now() + 60_000) };

    await service.uploadChunk(1, {
      requestId: 'turn-off-1',
      chunkId: 'chunk-1',
      chunkIndex: 0,
      operations: [{ id: 'op-a', serverSeq: 1, payload: plaintext() }],
    });

    expect(state.stagedOps).toHaveLength(1);
    expect(state.stagedOps[0].payload).toBe(plaintext());
  });
});

describe('关掉加密的 publish（ADR-0080）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.packageRow = {
      userId: 1,
      keyVersion: 1,
      packageData: packageFor(1),
      activePayloadKeyVersion: 1,
      updatedAt: 1n,
    };
    state.syncState = { userId: 1, lastSeq: 2, payloadMode: 'e2ee', snapshotData: null };
    state.operations = [
      { id: 'op-a', serverSeq: 1, payload: ciphertext(), payloadBytes: 100n, vectorClock: { a: 1 } },
      { id: 'op-b', serverSeq: 2, payload: ciphertext(), payloadBytes: 100n, vectorClock: { a: 2 } },
    ];
    state.stagedOps = [];
    state.payloadFlags = [];
    // 一个已完整上传、可发布的 staging 行。
    state.migration = {
      id: 'migration-1',
      requestId: 'turn-off-1',
      requestFingerprint: 'fp',
      state: 'STAGING',
      targetMode: 'readable',
      expectedKeyVersion: 1,
      expectedLatestSeq: 2,
      targetPayloadKeyVersion: null,
      keyVersion: null,
      latestSeq: 2,
      expectedOperationCount: 2,
      expectedPayloadBytes: 2n * BigInt(plaintext().length),
      uploadedOperationCount: 2,
      uploadedPayloadBytes: 2n * BigInt(plaintext().length),
      reservedStorageBytes: 0n,
      migratedOperationCount: 0,
      expiresAt: BigInt(Date.now() + 60_000),
      cancelledAt: null,
      packageData: null,
    };
    state.stagedOps = [
      { migrationId: 'migration-1', operationId: 'op-a', serverSeq: 1, payload: plaintext(), payloadBytes: 1n, storageBytes: 1n },
      { migrationId: 'migration-1', operationId: 'op-b', serverSeq: 2, payload: plaintext(), payloadBytes: 1n, storageBytes: 1n },
    ];
  });

  it('发布时写入"未加密"标志、删掉密钥包、翻账号模式', async () => {
    const service = new VaultKeyMigrationService();
    const result = await service.commit(1, 'turn-off-1');

    expect(state.payloadFlags).toContain(false);
    expect(state.packageRow).toBeNull();
    expect(state.syncState.payloadMode).toBe('readable');
    expect(result.targetMode).toBe('readable');
    expect(result.keyVersion).toBeNull();
    expect(result.payloadKeyVersion).toBeNull();
    expect(result.state).toBe('PUBLISHED');
  });

  it('包在 staging 期间被换掉 ⇒ stale_key_version，且不改模式', async () => {
    state.packageRow = { ...state.packageRow, keyVersion: 9 };
    const service = new VaultKeyMigrationService();

    await expect(service.commit(1, 'turn-off-1')).rejects.toBeInstanceOf(VaultKeyMigrationError);
    expect(state.syncState.payloadMode).toBe('e2ee');
  });
});

describe('同模式轮换（ADR-0050 root rotation）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.migration = null;
    state.stagedOps = [];
    state.payloadFlags = [];
  });

  it('🔴 e2ee → e2ee 的 begin 必须被接受（换根钥匙时模式不变）', async () => {
    // 这条是回归判据：曾经写成 `currentMode === targetMode` 就把根轮换一起拒了，
    // 真浏览器 E2E 报 `wrong_payload_mode` 才暴露。
    state.syncState = { userId: 1, lastSeq: 2, payloadMode: 'e2ee', snapshotData: null };
    state.packageRow = {
      userId: 1,
      keyVersion: 1,
      packageData: packageFor(1),
      activePayloadKeyVersion: 1,
      updatedAt: 1n,
    };
    const service = new VaultKeyMigrationService();

    await service.begin(1, {
      requestId: 'rotate-1',
      targetMode: 'e2ee',
      expectedKeyVersion: 1,
      expectedLatestSeq: 2,
      targetPayloadKeyVersion: 2,
      package: packageFor(2),
      expectedOperationCount: 2,
      expectedPayloadBytes: 2 * 64,
    });

    expect(state.migration.targetMode).toBe('e2ee');
    expect(state.migration.keyVersion).toBe(2);
    expect(state.migration.targetPayloadKeyVersion).toBe(2);
  });

  it('readable → readable 仍然要拒（没有可关的东西）', async () => {
    state.syncState = { userId: 1, lastSeq: 2, payloadMode: 'readable', snapshotData: null };
    const service = new VaultKeyMigrationService();

    await expect(service.begin(1, readableManifest())).rejects.toMatchObject({ code: 'wrong_payload_mode' });
  });
});
