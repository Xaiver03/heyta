import { Prisma } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closeForUser: vi.fn(),
  user: { findUnique: vi.fn() },
  vaultKeyPackage: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  syncService: {
    listDevices: vi.fn(),
    getLatestSeq: vi.fn(),
    getOnlineDeviceCount: vi.fn(),
    getStorageInfo: vi.fn(),
    revokeDevice: vi.fn(),
  },
}));

vi.mock('../src/auth', () => ({
  verifyToken: vi.fn().mockResolvedValue({ valid: true, userId: 1, email: 'test@example.test' }),
  revokeAllTokens: vi.fn(),
}));
vi.mock('../src/db', () => ({ prisma: mocks }));
vi.mock('../src/sync/sync.service', () => ({ getSyncService: () => mocks.syncService }));
vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ notifyNewOps: vi.fn(), closeForUser: mocks.closeForUser }),
}));

import { revokeAllTokens } from '../src/auth';
import { syncRoutes } from '../src/sync/sync.routes';

const PACKAGE = {
  version: 1,
  keyVersion: 1,
  rootKeyFingerprint: 'a'.repeat(64),
  passphrase: { kdf: 'argon2id', salt: Buffer.alloc(16, 1).toString('base64'), iv: Buffer.alloc(12, 2).toString('base64'), ciphertext: Buffer.alloc(48, 3).toString('base64') },
  recovery: { kdf: 'argon2id', salt: Buffer.alloc(16, 4).toString('base64'), iv: Buffer.alloc(12, 5).toString('base64'), ciphertext: Buffer.alloc(48, 6).toString('base64') },
};
const AUTH = { authorization: 'Bearer test-token' };

describe('opaque vault key-package routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.user.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0, isVerified: 1 });
    mocks.vaultKeyPackage.findUnique.mockResolvedValue(null);
    mocks.vaultKeyPackage.updateMany.mockResolvedValue({ count: 0 });
    mocks.vaultKeyPackage.create.mockImplementation(async ({ data }: { data: unknown }) => ({
      packageData: (data as { packageData: unknown }).packageData,
    }));
    mocks.vaultKeyPackage.deleteMany.mockResolvedValue({ count: 1 });
    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('stores and returns only the wrapped package', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/sync/key-package', headers: AUTH, payload: { expectedKeyVersion: 0, package: PACKAGE } });
    expect(put.statusCode).toBe(200);
    const write = mocks.vaultKeyPackage.create.mock.calls[0]?.[0] as { data: { packageData: Record<string, unknown> } };
    expect(write.data.packageData).toEqual(PACKAGE);
    expect(JSON.stringify(write.data.packageData)).not.toContain('"rootKey":');
    expect(JSON.stringify(write.data.packageData)).not.toContain('"recoveryCode":');
    expect(mocks.vaultKeyPackage.updateMany).not.toHaveBeenCalled();

    mocks.vaultKeyPackage.findUnique.mockResolvedValue({ packageData: PACKAGE });
    const get = await app.inject({ method: 'GET', url: '/api/sync/key-package', headers: AUTH });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ package: PACKAGE, payloadKeyVersion: null });
  });

  it('rejects plaintext secrets and stale key versions before writing', async () => {
    const plaintext = await app.inject({
      method: 'PUT', url: '/api/sync/key-package', headers: AUTH,
      payload: { expectedKeyVersion: 0, package: { ...PACKAGE, rootKey: 'plaintext-root', recoveryCode: 'plaintext-recovery' } },
    });
    expect(plaintext.statusCode).toBe(400);
    expect(mocks.vaultKeyPackage.create).not.toHaveBeenCalled();

    mocks.vaultKeyPackage.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique violation', { code: 'P2002', clientVersion: 'test' }));
    mocks.vaultKeyPackage.findUnique.mockResolvedValue({ keyVersion: 2, packageData: PACKAGE });
    const stale = await app.inject({ method: 'PUT', url: '/api/sync/key-package', headers: AUTH, payload: { expectedKeyVersion: 0, package: PACKAGE } });
    expect(stale.statusCode).toBe(409);
    expect(mocks.vaultKeyPackage.create).toHaveBeenCalledTimes(1);
  });

  it('makes a retry of the identical package idempotently successful', async () => {
    mocks.vaultKeyPackage.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique violation', { code: 'P2002', clientVersion: 'test' }));
    mocks.vaultKeyPackage.findUnique.mockResolvedValue({ keyVersion: 1, packageData: PACKAGE });
    const res = await app.inject({ method: 'PUT', url: '/api/sync/key-package', headers: AUTH, payload: { expectedKeyVersion: 0, package: PACKAGE } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ package: PACKAGE });
  });

  it('requires authentication and refuses to strand ciphertext by removing its key package', async () => {
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/sync/key-package' });
    expect(unauthenticated.statusCode).toBe(401);
    const removed = await app.inject({ method: 'DELETE', url: '/api/sync/key-package', headers: AUTH });
    expect(removed.statusCode).toBe(409);
    expect(mocks.vaultKeyPackage.deleteMany).not.toHaveBeenCalled();
  });

  it('revokes a device with an immediate socket close and key-rotation signal', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/api/sync/devices/Android-abc_123', headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      clientId: 'Android-abc_123',
      requiresKeyRotation: true,
    });
    expect(mocks.syncService.revokeDevice).toHaveBeenCalledWith(1, 'Android-abc_123');
    expect(revokeAllTokens).toHaveBeenCalledWith(1);
    expect(mocks.closeForUser).toHaveBeenCalledWith(1);
  });

  it('rejects malformed device ids before revocation', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/sync/devices/bad%2Fid', headers: AUTH });
    expect(res.statusCode).toBe(400);
    expect(mocks.syncService.revokeDevice).not.toHaveBeenCalled();
  });

  it('compares the unlocked version and fingerprint atomically, not a less-than version', async () => {
    mocks.vaultKeyPackage.updateMany.mockResolvedValue({ count: 1 });
    const next = { ...PACKAGE, keyVersion: 2 };
    const res = await app.inject({ method: 'PUT', url: '/api/sync/key-package', headers: AUTH,
      payload: { expectedKeyVersion: 1, package: next } });
    expect(res.statusCode).toBe(200);
    expect(mocks.vaultKeyPackage.updateMany).toHaveBeenCalledWith({
      where: { userId: 1, keyVersion: 1,
        packageData: { path: ['rootKeyFingerprint'], equals: PACKAGE.rootKeyFingerprint } },
      data: expect.objectContaining({ keyVersion: 2, packageData: next }),
    });
    expect(mocks.vaultKeyPackage.create).not.toHaveBeenCalled();
  });

  it('rejects a root change until ciphertext and key can be committed together', async () => {
    mocks.vaultKeyPackage.findUnique.mockResolvedValue({ keyVersion: 1, packageData: PACKAGE });
    const res = await app.inject({ method: 'PUT', url: '/api/sync/key-package', headers: AUTH,
      payload: { expectedKeyVersion: 1, package: { ...PACKAGE, keyVersion: 2, rootKeyFingerprint: 'b'.repeat(64) } } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'root_rotation_requires_atomic_migration' });
  });

  it('does not treat database failures as a create race', async () => {
    mocks.vaultKeyPackage.create.mockRejectedValueOnce(new Error('database unavailable'));
    const res = await app.inject({ method: 'PUT', url: '/api/sync/key-package', headers: AUTH,
      payload: { expectedKeyVersion: 0, package: PACKAGE } });
    expect(res.statusCode).toBe(500);
    expect(mocks.vaultKeyPackage.findUnique).not.toHaveBeenCalled();
  });

  it('accepts an identical retry even when JSONB returns reordered object keys', async () => {
    mocks.vaultKeyPackage.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      'unique violation', { code: 'P2002', clientVersion: 'test' }));
    const reordered = Object.fromEntries(Object.entries(PACKAGE).reverse());
    reordered.passphrase = Object.fromEntries(Object.entries(PACKAGE.passphrase).reverse());
    mocks.vaultKeyPackage.findUnique.mockResolvedValue({ keyVersion: 1, packageData: reordered });
    const res = await app.inject({ method: 'PUT', url: '/api/sync/key-package', headers: AUTH,
      payload: { expectedKeyVersion: 0, package: PACKAGE } });
    expect(res.statusCode).toBe(200);
  });

});
