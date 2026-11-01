import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { payloadGateViolation, violatesE2eeGate } from '../src/sync/sync.routes.payload';

/**
 * ADR-0080 S1：载荷形状闸门按**账号模式**判定，两个方向都拒错配。
 *
 * 第一段是纯函数四格表（每个格子带"缺失标志"与"形状对不上"两个反例）；
 * 第二段是路由级的两条拒绝 —— 它们钉的是同一件事：**被拒的上传一条都不落库**。
 */

const mocks = vi.hoisted(() => ({
  syncService: {
    isRateLimited: vi.fn(),
    checkOpsRequestDedup: vi.fn(),
    cacheOpsRequestResults: vi.fn(),
    checkStorageQuota: vi.fn(),
    uploadOps: vi.fn(),
    runWithStorageUsageLock: vi.fn(),
    getLatestSeq: vi.fn(),
    filterValidOpsForQuota: vi.fn(),
  },
  prisma: {
    operation: { findMany: vi.fn() },
    userSyncState: { findUnique: vi.fn() },
  },
  verifyToken: vi.fn(),
}));

vi.mock('../src/auth', () => ({ verifyToken: mocks.verifyToken }));
vi.mock('../src/sync/sync.service', () => ({ getSyncService: () => mocks.syncService }));
vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ notifyNewOps: vi.fn() }),
}));
vi.mock('../src/db', () => ({ prisma: mocks.prisma }));

import { syncRoutes } from '../src/sync/sync.routes';

/** 密文传输形状：canonical base64、>= 28 字节（salt 16 + iv 12）。 */
const CIPHERTEXT = Buffer.alloc(44, 7).toString('base64');
/** 明文形状：一个普通 JSON 串，既不是 base64 也不是足够长的密文信封。 */
const PLAINTEXT = '{"title":"买牛奶"}';

describe('payloadGateViolation（纯函数四格表）', () => {
  it('e2ee 模式只放行"显式 true + 密文形状"', () => {
    expect(payloadGateViolation('e2ee', { isPayloadEncrypted: true, payload: CIPHERTEXT })).toBeNull();
  });

  it('e2ee 模式拒掉其余三种：缺失标志、标志为 false、标志 true 但形状是明文', () => {
    // 缺失标志不是"false-ish OK" —— 这条从 ADR-0040 起就没松过。
    expect(payloadGateViolation('e2ee', { payload: CIPHERTEXT })).toBe('need-e2ee');
    expect(payloadGateViolation('e2ee', { isPayloadEncrypted: false, payload: PLAINTEXT })).toBe('need-e2ee');
    // 说谎的 true：标志说加密、载荷其实是明文形状 —— 形状检查在这里是有牙的。
    expect(payloadGateViolation('e2ee', { isPayloadEncrypted: true, payload: PLAINTEXT })).toBe('need-e2ee');
  });

  it('readable 模式只放行"显式 false + 明文形状"', () => {
    expect(payloadGateViolation('readable', { isPayloadEncrypted: false, payload: PLAINTEXT })).toBeNull();
  });

  it('readable 模式拒掉其余三种：缺失标志、标志为 true、标志 false 但形状是密文', () => {
    expect(payloadGateViolation('readable', { payload: PLAINTEXT })).toBe('need-plaintext');
    expect(payloadGateViolation('readable', { isPayloadEncrypted: true, payload: CIPHERTEXT })).toBe('need-plaintext');
    // "半开半关"的信号：声称明文、实际是密文字节。
    expect(payloadGateViolation('readable', { isPayloadEncrypted: false, payload: CIPHERTEXT })).toBe('need-plaintext');
  });

  it('e2ee 分支与旧的违规函数逐格等价（这次改动没有放宽任何一格）', () => {
    const samples = [
      { isPayloadEncrypted: true, payload: CIPHERTEXT },
      { payload: CIPHERTEXT },
      { isPayloadEncrypted: false, payload: PLAINTEXT },
      { isPayloadEncrypted: true, payload: PLAINTEXT },
      { isPayloadEncrypted: false, payload: CIPHERTEXT },
    ];
    for (const sample of samples) {
      expect(payloadGateViolation('e2ee', sample) === null).toBe(!violatesE2eeGate(sample));
    }
  });
});

describe('上传入口按账号模式拒错配（且一条都不落库）', () => {
  let app: FastifyInstance;

  const tokenFor = (userId: number) => `user-${userId}-token`;

  const op = (payload: string, isPayloadEncrypted?: boolean) => ({
    id: 'op-1',
    clientId: 'client-1',
    actionType: 'ADD_TASK',
    opType: 'CRT',
    entityType: 'TASK',
    entityId: 'task-1',
    payload,
    ...(isPayloadEncrypted === undefined ? {} : { isPayloadEncrypted }),
    vectorClock: {},
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.verifyToken.mockResolvedValue({ valid: true, userId: 1, email: 'u1@test.com', tokenVersion: 0 });
    mocks.syncService.isRateLimited.mockReturnValue(false);
    mocks.syncService.checkOpsRequestDedup.mockReturnValue(null);
    mocks.syncService.uploadOps.mockResolvedValue([{ accepted: true, serverSeq: 1 }]);
    mocks.syncService.runWithStorageUsageLock.mockImplementation(
      async (_userId: number, fn: () => Promise<unknown>) => fn(),
    );
    mocks.syncService.checkStorageQuota.mockResolvedValue({ allowed: true, currentUsage: 0, quota: 1 << 30 });
    mocks.syncService.filterValidOpsForQuota.mockImplementation((ops: unknown[]) => ops);
    mocks.syncService.getLatestSeq.mockResolvedValue(0);
    mocks.prisma.operation.findMany.mockResolvedValue([]);

    app = Fastify();
    await app.register(rateLimit, { max: 500, timeWindow: '15 minutes' });
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const upload = async (payload: string, isPayloadEncrypted?: boolean) =>
    app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${tokenFor(1)}` },
      payload: { ops: [op(payload, isPayloadEncrypted)], clientId: 'client-1' },
    });

  it('e2ee 账号上传明文 ⇒ 400 E2EE_REQUIRED，且 uploadOps 未被调用', async () => {
    mocks.prisma.userSyncState.findUnique.mockResolvedValue({ payloadMode: 'e2ee' });

    const res = await upload(PLAINTEXT, false);

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('E2EE_REQUIRED');
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('readable 账号上传密文 ⇒ 400 PLAINTEXT_REQUIRED，且 uploadOps 未被调用', async () => {
    mocks.prisma.userSyncState.findUnique.mockResolvedValue({ payloadMode: 'readable' });

    const res = await upload(CIPHERTEXT, true);

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PLAINTEXT_REQUIRED');
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('模式读失败时按 e2ee 闸门处理（fail-closed），不接受明文', async () => {
    mocks.prisma.userSyncState.findUnique.mockRejectedValue(new Error('db down'));

    const res = await upload(PLAINTEXT, false);

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('E2EE_REQUIRED');
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });
});
