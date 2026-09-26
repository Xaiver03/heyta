import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as zlib from 'zlib';

/**
 * 权益守卫的**路由级**测试。
 *
 * 样板是 `e2ee-upload-gate.routes.spec.ts`：`Fastify()` + `register(routes, {prefix})`
 * + `vi.mock('../src/auth')` + `vi.mock('../src/db')` + `app.inject()`。
 * 🔴 不用 `sync.routes.spec.ts` 当样板 —— 它已被 `vitest.config.ts` exclude。
 *
 * 这里测的是**真实接线**：守卫挂在 `sync/sync.routes.ts` 的 `authenticate` 之后，
 * 开关从环境变量读。所以"默认关"和"打开"两条路径都经过真实现。
 */
const mocks = vi.hoisted(() => {
  const syncService = {
    isRateLimited: vi.fn(),
    checkOpsRequestDedup: vi.fn(),
    getLatestStateReplacementSeq: vi.fn(),
    cacheOpsRequestResults: vi.fn(),
    checkSnapshotRequestDedup: vi.fn(),
    cacheSnapshotRequestResult: vi.fn(),
    checkStorageQuota: vi.fn(),
    uploadOps: vi.fn(),
    cacheSnapshotIfReplayable: vi.fn(),
    prepareSnapshotCache: vi.fn(),
    updateStorageUsage: vi.fn(),
    runWithStorageUsageLock: vi.fn(),
    getLatestSeq: vi.fn(),
    getOpsSinceWithSeq: vi.fn(),
    getStorageInfo: vi.fn(),
    getCachedSnapshotBytes: vi.fn(),
    getMaxClockDriftMs: vi.fn(),
    filterValidOpsForQuota: vi.fn(),
    getPrevalidatedPayloadBytes: vi.fn(),
  };
  const prisma = {
    operation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
  };

  return {
    syncService,
    prisma,
    notifyNewOps: vi.fn(),
  };
});

vi.mock('../src/auth', () => ({
  verifyToken: vi.fn().mockResolvedValue({
    valid: true,
    userId: 1,
    email: 'test@test.com',
  }),
}));

vi.mock('../src/sync/sync.service', () => ({
  getSyncService: () => mocks.syncService,
}));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({
    notifyNewOps: mocks.notifyNewOps,
  }),
}));

vi.mock('../src/db', () => ({
  prisma: mocks.prisma,
}));

import { syncRoutes } from '../src/sync/sync.routes';
import { ENTITLEMENT_AUDIT_EVENTS, ENTITLEMENT_ERROR_CODE } from '../src/entitlement';
import { Logger } from '../src/logger';

const VALID_ENVELOPE_B64 = Buffer.alloc(44, 7).toString('base64');

const createEncryptedOp = (clientId: string, id = 'op-1') => ({
  id,
  clientId,
  actionType: 'ADD_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: VALID_ENVELOPE_B64,
  isPayloadEncrypted: true,
  vectorClock: {},
  timestamp: Date.now(),
  schemaVersion: 1,
});

const originalEnv = { ...process.env };

describe('entitlement gate on sync routes', () => {
  let app: FastifyInstance | undefined;
  let auditSpy: MockInstance;

  const authHeaders = {
    authorization: 'Bearer mock-token',
    'content-type': 'application/json',
  };

  const buildApp = async (): Promise<void> => {
    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  };

  const injectOp = (payload: unknown = { ops: [createEncryptedOp('client-1')], clientId: 'client-1' }) =>
    app!.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: authHeaders,
      payload: payload as Record<string, unknown>,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENTITLEMENT_GATE_ENABLED;

    mocks.syncService.isRateLimited.mockReturnValue(false);
    mocks.syncService.checkOpsRequestDedup.mockReturnValue(null);
    mocks.syncService.getLatestStateReplacementSeq.mockResolvedValue(null);
    mocks.syncService.checkSnapshotRequestDedup.mockReturnValue(null);
    mocks.syncService.getMaxClockDriftMs.mockReturnValue(60_000);
    mocks.syncService.filterValidOpsForQuota.mockImplementation((ops: unknown[]) => ops);
    mocks.syncService.checkStorageQuota.mockResolvedValue({
      allowed: true,
      currentUsage: 0,
      quota: 100 * 1024 * 1024,
    });
    mocks.syncService.uploadOps.mockResolvedValue([
      { opId: 'op-1', accepted: true, serverSeq: 1 },
    ]);
    mocks.syncService.cacheSnapshotIfReplayable.mockResolvedValue(null);
    mocks.syncService.prepareSnapshotCache.mockImplementation((state: unknown) => {
      const serialized = JSON.stringify(state);
      const data = zlib.gzipSync(serialized);
      return {
        data,
        bytes: data.length,
        stateBytes: Buffer.byteLength(serialized, 'utf8'),
        cacheable: false,
      };
    });
    mocks.syncService.updateStorageUsage.mockResolvedValue(undefined);
    mocks.syncService.runWithStorageUsageLock.mockImplementation(
      async (_userId: number, fn: () => Promise<unknown>) => fn(),
    );
    mocks.syncService.getLatestSeq.mockResolvedValue(1);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({ ops: [], latestSeq: 1 });
    mocks.syncService.getStorageInfo.mockResolvedValue({
      storageUsedBytes: 0,
      storageQuotaBytes: 100 * 1024 * 1024,
    });
    mocks.syncService.getCachedSnapshotBytes.mockResolvedValue(0);
    mocks.prisma.operation.findFirst.mockResolvedValue(null);
    mocks.prisma.operation.findUnique.mockResolvedValue(null);
    mocks.prisma.operation.findMany.mockResolvedValue([]);
    mocks.prisma.subscription.findFirst.mockResolvedValue(null);

    auditSpy = vi.spyOn(Logger, 'audit').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    process.env = { ...originalEnv };
    auditSpy.mockRestore();
  });

  describe('gate OFF (the default, and what self-hosters get)', () => {
    it('passes a subscription-less user through, and never queries the database', async () => {
      // A query at all would reject the request: the assertion below proves the
      // request returned 200 *without* the guard reading subscriptions.
      mocks.prisma.subscription.findFirst.mockRejectedValue(
        new Error('the gate must not query subscriptions while disabled'),
      );

      await buildApp();
      const response = await injectOp();

      expect(response.statusCode).toBe(200);
      expect(response.json().results[0].accepted).toBe(true);
      expect(mocks.prisma.subscription.findFirst).not.toHaveBeenCalled();
      expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
    });

    it('passes everyone through regardless of any subscription state', async () => {
      await buildApp();
      const expired = {
        status: 'expired',
        currentPeriodEnd: BigInt(Date.now() - 60_000),
      };
      mocks.prisma.subscription.findFirst.mockResolvedValue(expired);

      // Even with an expired row present, an enabled=false gate ignores it.
      const response = await injectOp();
      expect(response.statusCode).toBe(200);
      expect(mocks.prisma.subscription.findFirst).not.toHaveBeenCalled();
    });

    it('explicitly setting the env var to false still disables the gate', async () => {
      process.env.ENTITLEMENT_GATE_ENABLED = 'false';
      mocks.prisma.subscription.findFirst.mockRejectedValue(
        new Error('the gate must not query subscriptions while disabled'),
      );

      await buildApp();
      const response = await injectOp();

      expect(response.statusCode).toBe(200);
      expect(mocks.prisma.subscription.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('gate ON (official hosted instance only)', () => {
    beforeEach(() => {
      process.env.ENTITLEMENT_GATE_ENABLED = 'true';
    });

    it('rejects a user with no subscription with a distinguishable error and audits it', async () => {
      mocks.prisma.subscription.findFirst.mockResolvedValue(null);

      await buildApp();
      const response = await injectOp();

      expect(response.statusCode).toBe(402);
      const body = response.json();
      expect(body.errorCode).toBe(ENTITLEMENT_ERROR_CODE);
      expect(body.errorCode).not.toBe('STORAGE_QUOTA_EXCEEDED');
      expect(body.reason).toBe('NO_SUBSCRIPTION');
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);

      // Denied before the upload handler ran.
      expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();

      // The denial is written through the existing audit mechanism.
      expect(auditSpy).toHaveBeenCalledOnce();
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: ENTITLEMENT_AUDIT_EVENTS.DENIED,
          userId: 1,
          errorCode: ENTITLEMENT_ERROR_CODE,
          reason: 'NO_SUBSCRIPTION',
        }),
      );
    });

    it('allows a user with an active, unexpired subscription', async () => {
      mocks.prisma.subscription.findFirst.mockResolvedValue({
        status: 'active',
        currentPeriodEnd: BigInt(Date.now() + 86_400_000),
      });

      await buildApp();
      const response = await injectOp();

      expect(response.statusCode).toBe(200);
      expect(response.json().results[0].accepted).toBe(true);
      expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
      expect(auditSpy).not.toHaveBeenCalled();
    });

    it('rejects an expired subscription with reason PERIOD_ENDED', async () => {
      mocks.prisma.subscription.findFirst.mockResolvedValue({
        status: 'active',
        currentPeriodEnd: BigInt(Date.now() - 1),
      });

      await buildApp();
      const response = await injectOp();

      expect(response.statusCode).toBe(402);
      expect(response.json().reason).toBe('PERIOD_ENDED');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: ENTITLEMENT_AUDIT_EVENTS.DENIED,
          reason: 'PERIOD_ENDED',
        }),
      );
    });

    it('rejects a non-entitled status such as past_due', async () => {
      mocks.prisma.subscription.findFirst.mockResolvedValue({
        status: 'past_due',
        currentPeriodEnd: BigInt(Date.now() + 86_400_000),
      });

      await buildApp();
      const response = await injectOp();

      expect(response.statusCode).toBe(402);
      expect(response.json().reason).toBe('STATUS_NOT_ENTITLED');
    });

    it('runs after authenticate: an unauthenticated request is 401, not a guard crash', async () => {
      await buildApp();
      const response = await app!.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { 'content-type': 'application/json' },
        payload: { ops: [createEncryptedOp('client-1')], clientId: 'client-1' },
      });

      expect(response.statusCode).toBe(401);
      // The guard never got as far as reading a subscription.
      expect(mocks.prisma.subscription.findFirst).not.toHaveBeenCalled();
    });
  });
});