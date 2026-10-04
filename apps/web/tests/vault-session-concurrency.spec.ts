import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setArgon2ParamsForTesting } from '@heyta/sync-core';
import {
  getWebVaultRemote,
  getWebVaultSession,
  invalidateWebVaultSession,
  withWebSyncMutationExclusive,
} from '../src/lib/vault-session.js';

const SERVER = 'https://vault-concurrency.example.test';
const ACCOUNT_PREFIX = `vault-concurrency-${Date.now()}`;

describe('web vault session loading', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('heyta-vault');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });

  beforeEach(async () => {
    invalidateWebVaultSession();
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  it('shares a concurrent same-binding load instead of invalidating the first caller', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 404, ok: false } as Response));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const first = getWebVaultSession(`${ACCOUNT_PREFIX}-same`, SERVER, async () => 'token');
      const second = getWebVaultSession(`${ACCOUNT_PREFIX}-same`, SERVER, async () => 'token');
      const [a, b] = await Promise.all([first, second]);

      expect(a).toBe(b);
      // Only the shared loader performs the authenticated package refresh.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      invalidateWebVaultSession();
    }
  });

  it('serializes Web mutations so migration cannot overlap a sync', async () => {
    const events: string[] = [];
    let releaseMigration!: () => void;
    const migration = withWebSyncMutationExclusive(async () => {
      events.push('migration:start');
      await new Promise<void>((resolve) => { releaseMigration = resolve; });
      events.push('migration:commit');
    });
    await Promise.resolve();
    const sync = withWebSyncMutationExclusive(async () => {
      events.push('sync:start');
    });
    await Promise.resolve();
    expect(events).toEqual(['migration:start']);
    releaseMigration();
    await Promise.all([migration, sync]);
    expect(events).toEqual(['migration:start', 'migration:commit', 'sync:start']);
  });

  it('rejects a wrapper-only key-package PUT response', async () => {
    const session = await getWebVaultSession(`${ACCOUNT_PREFIX}-strict`, SERVER);
    const pending = await session.beginCreation('passphrase');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ package: pending.package }),
    } as Response)));
    try {
      await expect(getWebVaultRemote(SERVER, async () => 'token').put(pending.package, 0))
        .rejects.toThrow('Invalid remote vault key-package response');
    } finally {
      vi.unstubAllGlobals();
      invalidateWebVaultSession();
    }
  });
});
