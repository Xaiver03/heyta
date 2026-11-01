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

  /*
   * 🔴 S5 的 macOS 那一格（ADR-0080 §5.4 / §5.5）：**壳的钥匙串优先于 `sessionStorage`**。
   *
   * 顺序反了不会报错 —— 只会在壳里表现为"关掉 App 就要重新输口令"：
   * 冷启动时 `sessionStorage` 是空的，先读它就拿不到任何东西，钥匙串那份永远轮不到。
   * 所以这里同时钉两件事：**问了钥匙串**，且**没去读 sessionStorage 那一格**。
   */
  it('放进壳的钥匙串里 ⇒ 先问它，且不读 sessionStorage（冷启动免输靠的就是这个顺序）', async () => {
    const account = `${ACCOUNT_PREFIX}-keychain`;
    const root = 'WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo=';
    const load = vi.fn(async () => root);
    (globalThis as { heytaVaultKeychain?: unknown }).heytaVaultKeychain = {
      load,
      save: vi.fn(async () => true),
      clear: vi.fn(async () => true),
    };
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const fetchImpl = vi.fn(async () => ({ status: 404, ok: false } as Response));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      await getWebVaultSession(account, SERVER, async () => 'token');
      expect(load).toHaveBeenCalledWith(SERVER, account);
      /* 只数"读那一格"的调用：别的 key 与本次判据无关。 */
      const vaultKeyReads = getItem.mock.calls
        .map((call) => String(call[0]))
        .filter((key) => key.startsWith('heyta.vault.root.v1'));
      expect(vaultKeyReads, '壳里不该再退回去读 sessionStorage 那一格').toHaveLength(0);
    } finally {
      delete (globalThis as { heytaVaultKeychain?: unknown }).heytaVaultKeychain;
      getItem.mockRestore();
      vi.unstubAllGlobals();
      invalidateWebVaultSession();
    }
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
