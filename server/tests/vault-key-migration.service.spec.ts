import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  packageRow: null as any,
  operations: [] as any[],
  syncState: { userId: 1, lastSeq: 2, snapshotData: Buffer.from('old-cache') } as any,
  migrations: new Map<string, any>(),
}));

vi.mock('../src/db', () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback({
      $queryRaw: vi.fn().mockResolvedValue([{ lastSeq: state.syncState.lastSeq }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      userSyncState: {
        upsert: vi.fn().mockResolvedValue(state.syncState),
        findUnique: vi.fn().mockResolvedValue(state.syncState),
        update: vi.fn().mockImplementation(async ({ data }: any) => {
          state.syncState = { ...state.syncState, ...data, snapshotData: null };
          return state.syncState;
        }),
      },
      vaultKeyPackage: {
        findUnique: vi.fn().mockResolvedValue(state.packageRow),
        update: vi.fn().mockImplementation(async ({ data }: any) => {
          state.packageRow = { ...state.packageRow, ...data };
          return state.packageRow;
        }),
      },
      operation: {
        findMany: vi.fn().mockResolvedValue(state.operations),
        updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
          const row = state.operations.find((candidate) =>
            candidate.id === where.id && candidate.serverSeq === where.serverSeq,
          );
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
      vaultKeyMigration: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) =>
          state.migrations.get(`${where.userId_requestId.userId}:${where.userId_requestId.requestId}`) ?? null,
        ),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `migration-${data.requestId}`, ...data };
          state.migrations.set(`${data.userId}:${data.requestId}`, row);
          return row;
        }),
      },
    })),
  },
}));

import { VaultKeyMigrationError, VaultKeyMigrationService } from '../src/sync/services/vault-key-migration.service';

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

const vaultPayload = (generation: number): string => {
  const magic = Buffer.from('heyta-vault-op/', 'ascii');
  const bytes = Buffer.alloc(magic.length + 1 + 8 + 29);
  magic.copy(bytes);
  bytes.writeUInt8(1, magic.length);
  bytes.writeDoubleBE(generation, magic.length + 1);
  return bytes.toString('base64');
};

const legacyPayload = (): string => Buffer.alloc(28, 9).toString('base64');

const requestFor = (overrides: Record<string, unknown> = {}) => ({
  requestId: 'migration-1',
  expectedKeyVersion: 1,
  expectedLatestSeq: 2,
  targetPayloadKeyVersion: 1,
  package: packageFor(2),
  operations: state.operations.map((row) => ({
    id: row.id,
    serverSeq: row.serverSeq,
    payload: vaultPayload(1),
  })),
  ...overrides,
});

describe('VaultKeyMigrationService', () => {
  beforeEach(() => {
    state.packageRow = {
      userId: 1,
      keyVersion: 1,
      packageData: packageFor(1),
      activePayloadKeyVersion: null,
      updatedAt: 1n,
    };
    state.operations = [
      { id: 'op-a', serverSeq: 1, payload: legacyPayload(), payloadBytes: 100n, vectorClock: { a: 1 }, isPayloadEncrypted: true },
      { id: 'op-b', serverSeq: 2, payload: legacyPayload(), payloadBytes: 100n, vectorClock: { a: 2 }, isPayloadEncrypted: true },
    ];
    state.syncState = { userId: 1, lastSeq: 2, snapshotData: Buffer.from('old-cache') };
    state.migrations.clear();
  });

  it('verifies the complete id/seq inventory and commits package, generation, ops, snapshot and quota atomically', async () => {
    const service = new VaultKeyMigrationService();
    const result = await service.migrate(1, requestFor());

    expect(result).toEqual({
      requestId: 'migration-1',
      keyVersion: 2,
      payloadKeyVersion: 1,
      latestSeq: 2,
      migratedOperationCount: 2,
    });
    expect(state.packageRow.activePayloadKeyVersion).toBe(1);
    expect(state.packageRow.keyVersion).toBe(2);
    expect(state.operations.every((row) => row.payload === vaultPayload(1))).toBe(true);
    expect(state.operations.every((row) => row.isPayloadEncrypted)).toBe(true);
    expect(state.syncState.snapshotData).toBeNull();
  });

  it('returns the durable result for a lost-response retry without reapplying the migration', async () => {
    const service = new VaultKeyMigrationService();
    const first = await service.migrate(1, requestFor());
    const second = await service.migrate(1, requestFor());
    expect(second).toEqual(first);
    expect(state.migrations.size).toBe(1);
  });

  it.each(['missing', 'duplicate', 'legacy', 'wrong generation'] as const)(
    'rejects %s manifests before publishing anything',
    async (label) => {
    const valid = requestFor();
    const request = label === 'missing'
      ? requestFor({ operations: [valid.operations[0]] })
      : label === 'duplicate'
        ? requestFor({ operations: [valid.operations[0], valid.operations[0]] })
        : label === 'legacy'
          ? requestFor({ operations: valid.operations.map((op) => ({ ...op, payload: legacyPayload() })) })
          : requestFor({ operations: valid.operations.map((op) => ({ ...op, payload: vaultPayload(2) })) });
    const code = label === 'legacy'
      ? 'legacy_payload'
      : label === 'wrong generation'
        ? 'wrong_payload_generation'
        : 'migration_coverage_mismatch';
    const before = state.operations.map((row) => [row.id, row.payload]);
    try {
      await new VaultKeyMigrationService().migrate(1, request as any);
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
    expect(state.operations.map((row) => [row.id, row.payload])).toEqual(before);
    expect(state.packageRow.keyVersion).toBe(1);
    expect(state.migrations.size).toBe(0);
    },
  );

  it('rejects a stale sequence and never treats wrapper keyVersion as payload generation', async () => {
    const request = requestFor({ expectedLatestSeq: 1, targetPayloadKeyVersion: 7 });
    await expect(new VaultKeyMigrationService().migrate(1, request as any)).rejects.toBeInstanceOf(VaultKeyMigrationError);
    expect(state.packageRow.activePayloadKeyVersion).toBeNull();
  });
});
