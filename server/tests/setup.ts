/**
 * Vitest test setup file.
 *
 * This file provides mock implementations for the legacy SQLite-based
 * test infrastructure after the migration to Prisma.
 */
import { vi, beforeEach } from 'vitest';
import {
  isEntityArrayBranchQuery,
  entityArrayBranchRows,
} from './sync.service.test-state';

// In-memory storage for test data
interface TestData {
  users: Map<number, any>;
  operations: Map<string, any>;
  syncDevices: Map<string, any>;
  userSyncStates: Map<number, any>;
}

let testData: TestData = {
  users: new Map(),
  operations: new Map(),
  syncDevices: new Map(),
  userSyncStates: new Map(),
};

let serverSeqCounter = 0;

// Mock better-sqlite3 style database interface
const createMockDb = () => {
  const mockDb = {
    prepare: (sql: string) => {
      return {
        run: (...args: any[]) => {
          // Parse and execute the SQL statement
          if (sql.includes('INSERT INTO users')) {
            const [id, email] = args;
            testData.users.set(id, { id, email, password_hash: 'hash', is_verified: 1 });
            return { changes: 1 };
          }
          if (sql.includes('UPDATE operations SET received_at')) {
            // Handle time-based updates for tests
            return { changes: 1 };
          }
          if (sql.includes('UPDATE sync_devices SET last_seen_at')) {
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: (...args: any[]) => {
          if (sql.includes('FROM sync_devices')) {
            const [userId, clientId] = args;
            return testData.syncDevices.get(`${userId}:${clientId}`);
          }
          return undefined;
        },
        all: (...args: any[]) => {
          return [];
        },
      };
    },
    exec: (sql: string) => {
      // For schema creation, no-op
    },
    transaction: (fn: () => void) => {
      return () => fn();
    },
  };
  return mockDb;
};

let mockDb: ReturnType<typeof createMockDb> | null = null;

// Export mock functions that match the old SQLite-based API
export const initDb = (dataPath: string, inMemory: boolean = false) => {
  testData = {
    users: new Map(),
    operations: new Map(),
    syncDevices: new Map(),
    userSyncStates: new Map(),
  };
  serverSeqCounter = 0;
  mockDb = createMockDb();
};

export const getDb = () => {
  if (!mockDb) {
    throw new Error('Database not initialized. Call initDb first.');
  }
  return mockDb;
};

// Mock the db module
vi.mock('../src/db', () => {
  const applySelect = (op: any, select?: Record<string, boolean>) => {
    if (!op || !select) {
      return op;
    }

    return Object.fromEntries(
      Object.entries(select)
        .filter(([, shouldSelect]) => shouldSelect)
        .map(([key]) => [key, op[key]]),
    );
  };

  const matchesWhere = (op: any, where: any) => {
    if (!where) {
      return true;
    }

    if (
      Array.isArray(where.OR) &&
      !where.OR.some((alternative: any) => matchesWhere(op, alternative))
    ) {
      return false;
    }

    if (where.userId !== undefined && op.userId !== where.userId) return false;
    if (where.id !== undefined && op.id !== where.id) return false;
    if (where.entityType !== undefined && op.entityType !== where.entityType) {
      return false;
    }
    if (where.entityId !== undefined && op.entityId !== where.entityId) return false;
    // entity_ids @> ARRAY[id]. No production caller uses this via the typed API any
    // more — detectConflictForEntity's array branch is raw SQL (see the $queryRaw
    // mock below) — but keep the matcher generic so this shim stays a faithful
    // stand-in for Prisma's filter semantics.
    if (
      where.entityIds?.has !== undefined &&
      !(Array.isArray(op.entityIds) && op.entityIds.includes(where.entityIds.has))
    ) {
      return false;
    }
    if (where.clientId !== undefined) {
      if (typeof where.clientId === 'object' && where.clientId !== null) {
        if (where.clientId.not !== undefined && op.clientId === where.clientId.not) {
          return false;
        }
      } else if (op.clientId !== where.clientId) {
        return false;
      }
    }

    if (where.serverSeq?.gt !== undefined && op.serverSeq <= where.serverSeq.gt) {
      return false;
    }
    if (where.serverSeq?.gte !== undefined && op.serverSeq < where.serverSeq.gte) {
      return false;
    }
    if (where.serverSeq?.lt !== undefined && op.serverSeq >= where.serverSeq.lt) {
      return false;
    }
    if (where.serverSeq?.lte !== undefined && op.serverSeq > where.serverSeq.lte) {
      return false;
    }

    if (where.opType?.in && !where.opType.in.includes(op.opType)) {
      return false;
    }
    if (typeof where.opType === 'string' && op.opType !== where.opType) {
      return false;
    }
    if (where.repairBaseServerSeq === null && op.repairBaseServerSeq != null) {
      return false;
    }
    if (where.repairBaseServerSeq?.not === null && op.repairBaseServerSeq == null) {
      return false;
    }
    if (
      where.isPayloadEncrypted !== undefined &&
      op.isPayloadEncrypted !== where.isPayloadEncrypted
    ) {
      return false;
    }

    return true;
  };

  const sortOperations = (ops: any[], orderBy: any) => {
    if (orderBy?.serverSeq === 'desc') {
      return ops.sort((a, b) => b.serverSeq - a.serverSeq);
    }
    if (orderBy?.serverSeq === 'asc') {
      return ops.sort((a, b) => a.serverSeq - b.serverSeq);
    }
    return ops;
  };

  const hasOperationUniqueConflict = (row: any) =>
    Array.from(testData.operations.values()).some(
      (op) =>
        op.id === row.id ||
        (op.userId === row.userId &&
          row.serverSeq !== undefined &&
          op.serverSeq === row.serverSeq),
    );

  // Create Prisma mock with all needed operations
  const prismaMock = {
    $transaction: vi.fn().mockImplementation(async (callback: any) => {
      // Create a transaction context
      const tx = {
        vaultKeyPackage: { findUnique: vi.fn().mockResolvedValue(null) },
        operation: {
          create: vi.fn().mockImplementation(async (args: any) => {
            serverSeqCounter++;
            const op = {
              ...args.data,
              serverSeq: serverSeqCounter,
              receivedAt: BigInt(Date.now()),
            };
            testData.operations.set(args.data.id, op);
            return op;
          }),
          createMany: vi.fn().mockImplementation(async (args: any) => {
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            let count = 0;

            for (const row of rows) {
              if (hasOperationUniqueConflict(row)) {
                if (args.skipDuplicates) {
                  continue;
                }
                throw new Error('Unique constraint failed');
              }

              testData.operations.set(row.id, {
                ...row,
                receivedAt: row.receivedAt ?? BigInt(Date.now()),
              });
              count++;
            }

            return { count };
          }),
          findUnique: vi.fn().mockImplementation(async (args: any) => {
            // (user_id, server_seq) compound unique — used by the conflict lookup's
            // array branch to fetch the winning row once its max serverSeq is known.
            const compound = args.where?.userId_serverSeq;
            if (compound) {
              const match = Array.from(testData.operations.values()).find(
                (op: any) =>
                  op.userId === compound.userId && op.serverSeq === compound.serverSeq,
              );
              return applySelect(match, args.select) || null;
            }
            // Check if operation with given ID exists
            return (
              applySelect(testData.operations.get(args.where?.id), args.select) || null
            );
          }),
          findFirst: vi.fn().mockImplementation(async (args: any) => {
            const ops = sortOperations(
              Array.from(testData.operations.values()).filter((op) =>
                matchesWhere(op, args.where),
              ),
              args.orderBy,
            );
            return applySelect(ops[0], args.select) || null;
          }),
          findMany: vi.fn().mockImplementation(async (args: any) => {
            const ops = Array.from(testData.operations.values()).filter((op) =>
              matchesWhere(op, args.where),
            );
            return sortOperations(ops, args.orderBy).map((op) =>
              applySelect(op, args.select),
            );
          }),
          count: vi.fn().mockImplementation(async (args: any) => {
            return Array.from(testData.operations.values()).filter((op) =>
              matchesWhere(op, args.where),
            ).length;
          }),
          aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        userSyncState: {
          findUnique: vi.fn().mockImplementation(async (args: any) => {
            return testData.userSyncStates.get(args.where.userId) || null;
          }),
          upsert: vi.fn().mockImplementation(async (args: any) => {
            const existing = testData.userSyncStates.get(args.where.userId);
            const result = existing
              ? { ...existing, ...args.update }
              : { userId: args.where.userId, ...args.create };
            testData.userSyncStates.set(args.where.userId, result);
            return result;
          }),
          update: vi.fn().mockImplementation(async (args: any) => {
            const existing = testData.userSyncStates.get(args.where.userId);
            if (existing) {
              const updated = { ...existing };
              // Handle Prisma's increment syntax: { lastSeq: { increment: 1 } }
              if (args.data?.lastSeq?.increment !== undefined) {
                updated.lastSeq = (existing.lastSeq || 0) + args.data.lastSeq.increment;
              } else if (args.data?.lastSeq?.decrement !== undefined) {
                updated.lastSeq = (existing.lastSeq || 0) - args.data.lastSeq.decrement;
              } else {
                Object.assign(updated, args.data);
              }
              testData.userSyncStates.set(args.where.userId, updated);
              return updated;
            }
            return null;
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        syncDevice: {
          upsert: vi.fn().mockImplementation(async (args: any) => {
            // Handle both key naming conventions (Prisma uses userId_clientId)
            const compositeKey = args.where.userId_clientId || args.where.clientId_userId;
            const key = `${compositeKey.userId}:${compositeKey.clientId}`;
            const result = { ...args.create, ...args.update };
            testData.syncDevices.set(key, result);
            return result;
          }),
          count: vi.fn().mockResolvedValue(1),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        user: {
          findUnique: vi.fn().mockImplementation(async (args: any) => {
            return testData.users.get(args.where.id) || null;
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        vaultKeyMigration: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { reservedStorageBytes: 0n } }),
        },
        // Every raw query issued inside the transaction must be recognised here and
        // anything unknown must THROW. A tolerant default is how the array branch
        // stayed silently stubbed out: conflict.ts reads an unrecognised row via
        // `arrayBranchRows[0]?.maxSeq ?? null`, i.e. as "no match", so the branch
        // disappears instead of failing.
        $queryRaw: vi
          .fn()
          .mockImplementation(async (strings: any, ...params: unknown[]) => {
            // Single-entity conflict lookup, array branch (raw SQL since the fix for
            // the full-history scan).
            if (isEntityArrayBranchQuery(strings)) {
              return entityArrayBranchRows(testData.operations, params);
            }
            const sql = Array.isArray(strings) ? strings.join('') : String(strings);
            if (sql.includes('FROM user_sync_state') && sql.includes('FOR UPDATE')) {
              const [txUserId] = params as [number];
              const syncState = testData.userSyncStates.get(txUserId);
              return [{
                lastSeq: syncState?.lastSeq ?? 0,
                latestStateReplacementSeq: syncState?.latestStateReplacementSeq ?? null,
              }];
            }
            if (sql.includes('SELECT id FROM users WHERE id') && sql.includes('FOR UPDATE')) {
              return [];
            }
            throw new Error(`Unmocked raw query in tx: ${sql}`);
          }),
        // The upload transaction writes the storage counter atomically via
        // $executeRaw to keep the data write and the counter delta in a single
        // commit. Default mock is a no-op; specs that care about counter
        // behaviour mock it explicitly.
        $executeRaw: vi.fn().mockResolvedValue(1),
      };
      if (typeof callback === 'function') {
        return callback(tx);
      }
      // Handle array of promises (batch transaction)
      return Promise.all(callback);
    }),
    operation: {
      create: vi.fn(),
      createMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    userSyncState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    syncDevice: {
      upsert: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      // 🔴 ADR-0063：`issueSession()` 现在在签名**之前**回读账号行的 `email` /
      // `tokenVersion`（不再接受调用方传值），所以凡能走到"换会话"的用例都会打这一格。
      // 数据源与本文件事务那侧的 `user.findUnique` 相同（同一张 `testData.users`），
      // 而**查不到就抛** —— 这正是 Prisma `...OrThrow` 的语义，也是一个宽容默认给不了的：
      // 把"没有这一行"回成 `{}` 会让签名拿到 `undefined`，症状看起来像产品缺陷。
      // 绝大多数 spec 用不到这张内存表（它们本来就在 mock `user`），它们显式
      // `vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ email, tokenVersion })`。
      findUniqueOrThrow: vi.fn().mockImplementation(async (args: any) => {
        const row = testData.users.get(args?.where?.id);
        if (!row) {
          throw new Error(
            `P2025 (test shim): no user row for id=${args?.where?.id} ` +
              `— seed testData.users or mock prisma.user.findUniqueOrThrow explicitly`,
          );
        }
        return applySelect(row, args?.select) || row;
      }),
    },
    // 🔴 ADR-0063 的会话面。**只**登记这一对，而且刻意没有"宽容默认"：
    // `create` 落进同一张内存表、`findFirst` 从里面读 —— 因为"这一枚会话还活着吗"
    // 的判据就是**那一行的存在**（撤销 = 删行）。把 `findFirst` 桩成 `null` 会把
    // 每一枚带 `jti` 的令牌都判成 `TOKEN_REVOKED`，那是伪装成产品失败的夹具故障
    // （同本文件 `$queryRaw` 的立场：未知的就抛）。
    // `findMany` / `update` / `deleteMany` 这里没有：现在没有用例经过它们，
    // 需要时按同样的手法补，而不是让一个 no-op 默认替实现做判断。
    accessSession: (() => {
      const rows = new Map<string, any>();
      return {
        create: vi.fn().mockImplementation(async (args: any) => {
          rows.set(args.data.jtiHash, { ...args.data });
          return args.data;
        }),
        findFirst: vi.fn().mockImplementation(async (args: any) => {
          const row = rows.get(args?.where?.jtiHash);
          if (!row || (args?.where?.userId !== undefined && row.userId !== args.where.userId)) {
            return null;
          }
          return applySelect(row, args?.select) || row;
        }),
      };
    })(),
    vaultKeyMigration: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { reservedStorageBytes: 0n } }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ total: BigInt(0) }]),
    $executeRaw: vi.fn().mockResolvedValue(0),
  };

  return {
    prisma: prismaMock,
    // Legacy SQLite-style exports for backwards compatibility
    initDb: (dataPath: string, inMemory: boolean = false) => {
      testData = {
        users: new Map(),
        operations: new Map(),
        syncDevices: new Map(),
        userSyncStates: new Map(),
      };
      serverSeqCounter = 0;
      mockDb = createMockDb();
    },
    getDb: () => {
      if (!mockDb) {
        mockDb = createMockDb();
      }
      return mockDb;
    },
  };
});

// Mock auth module
vi.mock('../src/auth', () => ({
  verifyToken: vi
    .fn()
    .mockResolvedValue({ valid: true, userId: 1, email: 'test@test.com' }),
  VERIFICATION_TOKEN_EXPIRY_MS: 24 * 60 * 60 * 1000,
  MAX_VERIFICATION_RESEND_COUNT: 20,
  verifyEmail: vi.fn().mockResolvedValue(true),
}));

// Reset test data before each test
beforeEach(() => {
  testData = {
    users: new Map(),
    operations: new Map(),
    syncDevices: new Map(),
    userSyncStates: new Map(),
  };
  serverSeqCounter = 0;
  vi.clearAllMocks();
});
