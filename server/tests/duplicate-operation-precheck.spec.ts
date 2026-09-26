/**
 * Tests for the duplicate operation pre-check fix.
 *
 * REGRESSION TEST: This tests the fix for a bug where duplicate operations
 * would abort PostgreSQL transactions, causing all subsequent operations
 * in a batch to fail with error 25P02 ("transaction is aborted").
 *
 * The fix checks for existing operations BEFORE attempting to insert,
 * avoiding the P2002 unique constraint error that would abort the transaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from '../src/sync/sync.service';
import { DEFAULT_SYNC_CONFIG, SYNC_ERROR_CODES } from '../src/sync/sync.types';
import { prisma } from '../src/db';

const TEST_TIMESTAMP = Date.now() - 1000;

// Test data for creating mock operations
const createTestOp = (overrides: Record<string, any> = {}) => ({
  id: 'test-op-id',
  clientId: 'client-1', // Must match the clientId passed to uploadOps
  actionType: '[Test] Action',
  opType: 'UPD',
  entityType: 'TASK',
  entityId: 'entity-1',
  payload: { foo: 'bar' },
  vectorClock: { 'client-1': 1 },
  timestamp: TEST_TIMESTAMP,
  schemaVersion: 1,
  ...overrides,
});

/**
 * 🔴 语义变更（本轮）：**精确重复 = 幂等成功**，不再是硬拒绝。
 *
 * 原行为：磁盘上已有同一个 op（`isSameDuplicateOperation` 判定内容逐字段一致）
 * 时回 `accepted: false` + `DUPLICATE_OPERATION`。
 *
 * 为什么改：`DUPLICATE_OPERATION` 的字面意思是"服务端已经有了"，而那
 * **正是上传想要的结果**。把它当失败，客户端就不会去标记"已上传"，
 * 于是队列永不清空 → 下次重传整批 → 又全是重复 → **这台设备的同步永久卡死**
 * （数据没丢，但用户看到"同步一直失败 + 待上传数永远不减"）。
 *
 * 现在回 `accepted: true` + **原来那个 serverSeq**，与
 * `sync.routes.snapshot-handler.ts` 里 BACKUP_IMPORT / REPAIR 的幂等分支同形。
 *
 * ⚠️ **边界没有放松**：id 撞上"另一条不同的 op"仍然硬拒绝 `INVALID_OP_ID`
 * —— 下面 "different payload / vector clock / persisted metadata"、
 * "another user operation"、"insert-race ID collisions" 这几条**故意保持不变**，
 * 它们正是"幂等重试"与"id 冲突"的分界线。
 */
describe('Duplicate Operation Pre-check', () => {
  let syncService: SyncService;

  beforeEach(() => {
    syncService = new SyncService();
  });

  describe('uploadOps with duplicate operation', () => {
    it('should treat an exact retry as idempotent success without aborting the batch', async () => {
      const existingOp = createTestOp({
        id: 'dup-op-1',
        entityId: 'task-1',
        vectorClock: { 'client-1': 1 },
      });
      await syncService.uploadOps(1, 'client-1', [existingOp]);

      const ops = [
        createTestOp({
          id: 'dup-op-1',
          entityId: 'task-1',
          vectorClock: { 'client-1': 1 },
        }),
        createTestOp({
          id: 'new-op-2',
          entityId: 'task-2',
          vectorClock: { 'client-1': 2 },
        }),
        createTestOp({
          id: 'new-op-3',
          entityId: 'task-3',
          vectorClock: { 'client-1': 3 },
        }),
      ];

      const results = await syncService.uploadOps(1, 'client-1', ops);

      expect(results).toHaveLength(3);
      // 幂等成功：回的是**原来那条**的序号，而且没有占用新的序号
      expect(results[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });
      expect(results[0].errorCode).toBeUndefined();
      expect(results[1]).toMatchObject({
        accepted: true,
        serverSeq: 2,
      });
      expect(results[2]).toMatchObject({
        accepted: true,
        serverSeq: 3,
      });
    });

    it('should return the original serverSeq when the pre-check hits an exact retry', async () => {
      // First, upload an operation
      const originalOp = createTestOp({ id: 'original-op-id', entityId: 'task-1' });
      const firstResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
      expect(firstResult[0].accepted).toBe(true);

      // Now try to upload the same operation again
      const duplicateOp = createTestOp({ id: 'original-op-id', entityId: 'task-1' });
      const duplicateResult = await syncService.uploadOps(1, 'client-1', [duplicateOp]);

      // 幂等成功，且序号就是原来那个（不是新分配的）
      expect(duplicateResult[0].accepted).toBe(true);
      expect(duplicateResult[0].serverSeq).toBe(firstResult[0].serverSeq);
      expect(duplicateResult[0].error).toBeUndefined();
      expect(duplicateResult[0].errorCode).toBeUndefined();
    });

    it('should treat an exact retry as idempotent success when JSON field order differs', async () => {
      const originalOp = createTestOp({
        id: 'json-order-op',
        payload: {
          top: 'value',
          nested: { a: 1, b: 2 },
        },
        vectorClock: { 'client-1': 1, 'client-2': 2 },
      });
      await syncService.uploadOps(1, 'client-1', [originalOp]);

      const duplicateOp = createTestOp({
        id: 'json-order-op',
        payload: {
          nested: { b: 2, a: 1 },
          top: 'value',
        },
        vectorClock: { 'client-2': 2, 'client-1': 1 },
      });
      const duplicateResult = await syncService.uploadOps(1, 'client-1', [duplicateOp]);

      expect(duplicateResult[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });
    });

    it('should reject same-id operations with different payload content', async () => {
      const originalOp = createTestOp({
        id: 'payload-collision-op',
        payload: { title: 'original' },
      });
      await syncService.uploadOps(1, 'client-1', [originalOp]);

      const collisionResult = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'payload-collision-op',
          payload: { title: 'changed' },
        }),
      ]);

      expect(collisionResult[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      });
      expect(collisionResult[0].errorCode).not.toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
    });

    it('should reject same-id operations with different vector clocks', async () => {
      const originalOp = createTestOp({
        id: 'vector-clock-collision-op',
        vectorClock: { 'client-1': 1 },
      });
      await syncService.uploadOps(1, 'client-1', [originalOp]);

      const collisionResult = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'vector-clock-collision-op',
          vectorClock: { 'client-1': 2 },
        }),
      ]);

      expect(collisionResult[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      });
      expect(collisionResult[0].errorCode).not.toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
    });

    it('should reject same-id operations with different persisted metadata', async () => {
      const baseTimestamp = Date.now() - 1000;
      const originalOp = createTestOp({
        id: 'metadata-collision-op',
        timestamp: baseTimestamp,
        schemaVersion: 1,
        isPayloadEncrypted: true,
        syncImportReason: 'initial',
      });
      await syncService.uploadOps(1, 'client-1', [originalOp]);

      const collisionCases = [
        createTestOp({
          id: 'metadata-collision-op',
          timestamp: baseTimestamp + 1,
          schemaVersion: 1,
          isPayloadEncrypted: true,
          syncImportReason: 'initial',
        }),
        createTestOp({
          id: 'metadata-collision-op',
          timestamp: baseTimestamp,
          schemaVersion: 2,
          isPayloadEncrypted: true,
          syncImportReason: 'initial',
        }),
        createTestOp({
          id: 'metadata-collision-op',
          timestamp: baseTimestamp,
          schemaVersion: 1,
          isPayloadEncrypted: false,
          syncImportReason: 'initial',
        }),
        createTestOp({
          id: 'metadata-collision-op',
          timestamp: baseTimestamp,
          schemaVersion: 1,
          isPayloadEncrypted: true,
          syncImportReason: 'retry',
        }),
      ];

      for (const collisionOp of collisionCases) {
        const collisionResult = await syncService.uploadOps(1, 'client-1', [collisionOp]);

        expect(collisionResult[0]).toMatchObject({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
        });
        expect(collisionResult[0].errorCode).not.toBe(
          SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        );
      }
    });

    it('should treat an exact retry as idempotent success when future timestamps are clamped', async () => {
      const baseTimestamp = 1_700_000_000_000;
      const farFuture = baseTimestamp + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 10_000;

      vi.useFakeTimers();
      vi.setSystemTime(baseTimestamp);
      try {
        const originalOp = createTestOp({
          id: 'clamped-duplicate-op',
          timestamp: farFuture,
        });
        const firstResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
        expect(firstResult[0]).toMatchObject({ accepted: true });

        vi.setSystemTime(baseTimestamp + 5_000);
        const duplicateResult = await syncService.uploadOps(1, 'client-1', [
          createTestOp({
            id: 'clamped-duplicate-op',
            timestamp: farFuture,
          }),
        ]);

        expect(duplicateResult[0]).toMatchObject({
          accepted: true,
          serverSeq: 1,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('should treat an exact retry as idempotent success when the retry is no longer clamped', async () => {
      const baseTimestamp = 1_700_000_000_000;
      const retryTimestamp = baseTimestamp + 10_000;
      const farFuture = baseTimestamp + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 10_000;

      vi.useFakeTimers();
      vi.setSystemTime(baseTimestamp);
      try {
        const originalOp = createTestOp({
          id: 'clamp-boundary-duplicate-op',
          timestamp: farFuture,
        });
        const firstResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
        expect(firstResult[0]).toMatchObject({ accepted: true });

        vi.setSystemTime(retryTimestamp);
        const duplicateResult = await syncService.uploadOps(1, 'client-1', [
          createTestOp({
            id: 'clamp-boundary-duplicate-op',
            timestamp: farFuture,
          }),
        ]);

        expect(duplicateResult[0]).toMatchObject({
          accepted: true,
          serverSeq: 1,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not consume a new server sequence for an idempotent retry', async () => {
      const originalOp = createTestOp({
        id: 'seq-original',
        entityId: 'task-seq-original',
        vectorClock: { 'client-1': 1 },
      });

      const firstResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
      expect(firstResult[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });

      const duplicateResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
      expect(duplicateResult[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });
      // 关键性质：幂等重试回原来的序号，**不**消耗新序号
      expect(duplicateResult[0].serverSeq).toBe(1);

      const nextResult = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'seq-next',
          entityId: 'task-seq-next',
          vectorClock: { 'client-1': 2 },
        }),
      ]);

      expect(nextResult[0]).toMatchObject({
        accepted: true,
        serverSeq: 2,
      });
    });

    it('should not abort the transaction when an exact retry is in the middle of the batch', async () => {
      // Upload first op to make it a "duplicate" for later
      const existingOp = createTestOp({ id: 'existing-op', entityId: 'task-existing' });
      await syncService.uploadOps(1, 'client-1', [existingOp]);

      // Now upload batch where middle op is a duplicate
      const batchOps = [
        createTestOp({
          id: 'new-op-1',
          entityId: 'task-1',
          vectorClock: { 'client-1': 2 },
        }),
        createTestOp({
          id: 'existing-op',
          entityId: 'task-existing',
          vectorClock: { 'client-1': 1 },
        }), // Duplicate!
        createTestOp({
          id: 'new-op-3',
          entityId: 'task-3',
          vectorClock: { 'client-1': 3 },
        }),
      ];

      const results = await syncService.uploadOps(1, 'client-1', batchOps);

      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        accepted: true,
        serverSeq: 2,
      });
      expect(results[1]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });
      expect(results[1].errorCode).toBeUndefined();
      expect(results[2]).toMatchObject({
        accepted: true,
        serverSeq: 3,
      });
    });

    it('should answer an older exact retry with idempotent success instead of a conflict', async () => {
      const olderOp = createTestOp({
        id: 'older-op',
        entityId: 'task-same',
        vectorClock: { 'client-1': 1 },
      });
      const newerOp = createTestOp({
        id: 'newer-op',
        entityId: 'task-same',
        vectorClock: { 'client-1': 2 },
      });

      await syncService.uploadOps(1, 'client-1', [olderOp, newerOp]);

      const results = await syncService.uploadOps(1, 'client-1', [olderOp]);

      // 旧 op 正好命中幂等分支：既不算冲突，也不该让客户端永远重传
      expect(results[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });
      expect(results[0].errorCode).toBeUndefined();
    });

    it('should not treat another user operation with the same ID as duplicate success', async () => {
      await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'cross-user-collision',
          clientId: 'client-1',
          entityId: 'task-user-1',
          vectorClock: { 'client-1': 1 },
        }),
      ]);

      const collisionResult = await syncService.uploadOps(2, 'client-2', [
        createTestOp({
          id: 'cross-user-collision',
          clientId: 'client-2',
          entityId: 'task-user-2',
          vectorClock: { 'client-2': 1 },
        }),
      ]);

      expect(collisionResult[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      });
      expect(collisionResult[0].errorCode).not.toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(collisionResult[0].serverSeq).toBeUndefined();

      const nextResult = await syncService.uploadOps(2, 'client-2', [
        createTestOp({
          id: 'user-2-next',
          clientId: 'client-2',
          entityId: 'task-user-2-next',
          vectorClock: { 'client-2': 2 },
        }),
      ]);

      expect(nextResult[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });
    });

    it('should answer a lost insert race with the concurrent row as idempotent success', async () => {
      const raceTimestamp = Date.now() - 1000;
      const tx = {
        operation: {
          deleteMany: vi.fn(),
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'race-op',
              userId: 1,
              // 幂等分支要回"并发插入那条"的序号，所以 mock 必须带上它
              serverSeq: 1,
              clientId: 'client-1',
              actionType: '[Test] Action',
              opType: 'UPD',
              entityType: 'TASK',
              entityId: 'task-race',
              entityIds: [],
              payload: { foo: 'bar' },
              vectorClock: { 'client-1': 1 },
              schemaVersion: 1,
              clientTimestamp: BigInt(raceTimestamp),
              receivedAt: BigInt(raceTimestamp),
              isPayloadEncrypted: false,
              syncImportReason: null,
              repairBaseServerSeq: null,
            }),
          findFirst: vi.fn().mockResolvedValue(null),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        userSyncState: {
          upsert: vi.fn().mockResolvedValue({ userId: 1, lastSeq: 0 }),
          update: vi
            .fn()
            .mockResolvedValueOnce({ userId: 1, lastSeq: 1 })
            .mockResolvedValueOnce({ userId: 1, lastSeq: 0 }),
        },
        syncDevice: {
          upsert: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn(),
        },
        user: {
          update: vi.fn(),
        },
        // entity_ids branch of the conflict lookup (raw SQL): no multi-entity op
        // stored, so no max — keeps the array branch from consuming a findUnique
        // mock slot.
        $queryRaw: vi.fn().mockResolvedValue([{ maxSeq: null }]),
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) =>
        callback(tx),
      );

      const results = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'race-op',
          entityId: 'task-race',
          timestamp: raceTimestamp,
        }),
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });
      expect(results[0].errorCode).toBeUndefined();
      expect(tx.operation.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
      expect(tx.userSyncState.update).toHaveBeenNthCalledWith(1, {
        where: { userId: 1 },
        data: { lastSeq: { increment: 1 } },
      });
      expect(tx.userSyncState.update).toHaveBeenNthCalledWith(2, {
        where: { userId: 1 },
        data: { lastSeq: { decrement: 1 } },
      });
      expect(tx.syncDevice.upsert).not.toHaveBeenCalled();
      expect(prisma.syncDevice.upsert).toHaveBeenCalled();
    });

    it('should reject insert-race ID collisions instead of marking them synced', async () => {
      const raceTimestamp = Date.now() - 1000;
      const tx = {
        operation: {
          deleteMany: vi.fn(),
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'collision-race-op',
              userId: 2,
              clientId: 'client-2',
              actionType: '[Test] Action',
              opType: 'UPD',
              entityType: 'TASK',
              entityId: 'task-other-user',
              entityIds: [],
              payload: { foo: 'bar' },
              vectorClock: { 'client-1': 1 },
              schemaVersion: 1,
              clientTimestamp: BigInt(raceTimestamp),
              receivedAt: BigInt(raceTimestamp),
              isPayloadEncrypted: false,
              syncImportReason: null,
              repairBaseServerSeq: null,
            }),
          findFirst: vi.fn().mockResolvedValue(null),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        userSyncState: {
          upsert: vi.fn().mockResolvedValue({ userId: 1, lastSeq: 0 }),
          update: vi
            .fn()
            .mockResolvedValueOnce({ userId: 1, lastSeq: 1 })
            .mockResolvedValueOnce({ userId: 1, lastSeq: 0 }),
        },
        syncDevice: {
          upsert: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn(),
        },
        user: {
          update: vi.fn(),
        },
        // entity_ids branch of the conflict lookup (raw SQL): no multi-entity op
        // stored, so no max — keeps the array branch from consuming a findUnique
        // mock slot.
        $queryRaw: vi.fn().mockResolvedValue([{ maxSeq: null }]),
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) =>
        callback(tx),
      );

      const results = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'collision-race-op',
          entityId: 'task-race',
          timestamp: raceTimestamp,
        }),
      ]);

      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      });
      expect(results[0].errorCode).not.toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(tx.userSyncState.update).toHaveBeenNthCalledWith(2, {
        where: { userId: 1 },
        data: { lastSeq: { decrement: 1 } },
      });
      expect(tx.syncDevice.upsert).not.toHaveBeenCalled();
      expect(prisma.syncDevice.upsert).toHaveBeenCalled();
    });

    it('should not report non-id insert skips as duplicate operations', async () => {
      const tx = {
        operation: {
          deleteMany: vi.fn(),
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        userSyncState: {
          upsert: vi.fn().mockResolvedValue({ userId: 1, lastSeq: 0 }),
          update: vi.fn().mockResolvedValue({ userId: 1, lastSeq: 1 }),
        },
        syncDevice: {
          upsert: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn(),
        },
        user: {
          update: vi.fn(),
        },
        // entity_ids branch of the conflict lookup (raw SQL): no multi-entity op
        // stored, so no max — keeps the array branch from consuming a findUnique
        // mock slot.
        $queryRaw: vi.fn().mockResolvedValue([{ maxSeq: null }]),
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) =>
        callback(tx),
      );

      const results = await syncService.uploadOps(1, 'client-1', [
        createTestOp({ id: 'seq-conflict-op', entityId: 'task-seq-conflict' }),
      ]);

      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
      });
      // Generic, non-leaky message. The original Prisma exception text (which
      // can include SQL fragments, column / FK names) is only emitted to the
      // server log; the per-op error returned to the client must not leak it.
      expect(results[0].error).toBe('Transaction failed - please retry');
      expect(tx.userSyncState.update).toHaveBeenCalledTimes(1);
      expect(tx.syncDevice.upsert).not.toHaveBeenCalled();
      expect(prisma.syncDevice.upsert).not.toHaveBeenCalled();
    });

    it('should classify PostgreSQL repeatable-read serialization failures as retryable', async () => {
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(
        new Error('could not serialize access due to concurrent update'),
      );

      const results = await syncService.uploadOps(1, 'client-1', [
        createTestOp({ id: 'serialization-op', entityId: 'task-serialization' }),
      ]);

      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
      });
      expect(results[0].error).toContain('Concurrent transaction conflict');
    });
  });

  describe('error codes', () => {
    it('should answer an exact retry idempotently, not with INTERNAL_ERROR', async () => {
      // The key regression: Before the fix, duplicates caused INTERNAL_ERROR
      // because the P2002 exception aborted the transaction and subsequent
      // queries failed with 25P02, which was caught as INTERNAL_ERROR.

      const op = createTestOp({ id: 'test-dup-error-code' });

      // Upload once
      await syncService.uploadOps(1, 'client-1', [op]);

      // Upload again (duplicate)
      const result = await syncService.uploadOps(1, 'client-1', [op]);

      // 幂等成功，绝不是 INTERNAL_ERROR
      expect(result[0].accepted).toBe(true);
      expect(result[0].serverSeq).toBe(1);
      expect(result[0].errorCode).not.toBe(SYNC_ERROR_CODES.INTERNAL_ERROR);
    });
  });
});
