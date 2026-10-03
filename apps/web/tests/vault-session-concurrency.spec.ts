import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setArgon2ParamsForTesting } from '@heyta/sync-core';
import { getWebVaultSession, invalidateWebVaultSession } from '../src/lib/vault-session.js';

const SERVER = 'https://vault-concurrency.example.test';

describe('web vault session loading', () => {
  beforeEach(async () => {
    invalidateWebVaultSession();
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('heyta-vault');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });

  it('shares a concurrent same-binding load instead of invalidating the first caller', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 404, ok: false } as Response));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const first = getWebVaultSession('concurrent-account', SERVER, async () => 'token');
      const second = getWebVaultSession('concurrent-account', SERVER, async () => 'token');
      const [a, b] = await Promise.all([first, second]);

      expect(a).toBe(b);
      // Only the shared loader performs the authenticated package refresh.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      invalidateWebVaultSession();
    }
  });
});
