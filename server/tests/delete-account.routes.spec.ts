import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  closeForUser: vi.fn(),
  userDelete: vi.fn(),
  tombstoneUpsert: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ closeForUser: mocks.closeForUser }),
}));

// The global setup.ts prisma mock exposes only user.findUnique/update — this
// route's cascade call (user.delete) is not on it, so redeclare the surface.
// 🔴 `$transaction` is faked as a **runner** (`cb({…})`), not as `vi.fn()`:
// a bare mock would let the route pass while the transaction body never ran,
// and the tombstone would go unwritten in the test while being "asserted" green.
vi.mock('../src/db', () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => {
      mocks.transaction(cb);
      return cb({
        user: {
          findUniqueOrThrow: async () => ({ email: 'someone@example.test' }),
          delete: (...args: unknown[]) => mocks.userDelete(...args),
        },
        accountTombstone: {
          upsert: (...args: unknown[]) => mocks.tombstoneUpsert(...args),
        },
      });
    },
    // 🔴 这里**故意不再挂** `user.delete`：路由绕过 `$transaction` 直接删的话,
    // 那次删除会当场 TypeError ⇒ 500，而不是"看起来过了"。
  },
}));

import { apiRoutes } from '../src/api';

/**
 * `DELETE /api/account` cascades away the user's sync_devices rows, but an open
 * websocket keeps answering pings, so the dead-connection branch never reaps
 * it. Since #9598 that socket's heartbeat touch re-INSERTs a device row every
 * throttle window, tripping sync_devices_user_id_fkey against a user that no
 * longer exists. The route must close the user's sockets, and must do it after
 * the delete so no reconnect can re-authenticate and re-orphan one.
 */
describe('DELETE /api/account (socket teardown)', () => {
  let app: FastifyInstance;

  const inject = () =>
    app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { authorization: 'Bearer some-token' },
    });

  beforeEach(async () => {
    mocks.closeForUser.mockClear();
    mocks.userDelete.mockClear().mockResolvedValue({ id: 1 });
    mocks.tombstoneUpsert.mockClear().mockResolvedValue({ userId: 1 });
    mocks.transaction.mockClear();
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('closes the deleted user’s websockets', async () => {
    const res = await inject();

    expect(res.statusCode).toBe(200);
    expect(mocks.closeForUser).toHaveBeenCalledWith(1);
  });

  it('closes them after the cascade, not before', async () => {
    await inject();

    expect(mocks.userDelete).toHaveBeenCalled();
    expect(mocks.closeForUser).toHaveBeenCalled();
    expect(mocks.closeForUser.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.userDelete.mock.invocationCallOrder[0],
    );
  });

  it('leaves sockets open when the delete fails', async () => {
    mocks.userDelete.mockRejectedValue(new Error('db down'));

    const res = await inject();

    expect(res.statusCode).toBe(500);
    expect(mocks.closeForUser).not.toHaveBeenCalled();
  });

  it('writes the tombstone in the SAME transaction, before the delete (ADR-0055)', async () => {
    const res = await inject();

    expect(res.statusCode).toBe(200);
    // 🔴 一次事务，不是两次提交：分开提交的形状是"账号没了、墓碑没落"，
    // 而那正是恢复时没有任何一层记得该拒绝谁的那一半。
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tombstoneUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.tombstoneUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.userDelete.mock.invocationCallOrder[0],
    );
  });

  it('the tombstone carries a hash, never the plaintext address', async () => {
    await inject();

    const call = mocks.tombstoneUpsert.mock.calls[0]?.[0] as object;
    expect(call).toBeDefined();
    const hash = (call as { create?: { emailHash?: string } }).create?.emailHash;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(call)).not.toContain('someone@example.test');
  });
});
