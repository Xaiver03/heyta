import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppHost } from '@heyta/app-host';
const platform = vi.hoisted(() => ({ open: vi.fn(), driver: vi.fn(), write: vi.fn(), publish: vi.fn() }));
vi.mock('@heyta/app-host', () => ({ openAppHost: platform.open }));
vi.mock('../src/db/op-sqlite-driver', () => ({ opSqliteDriverFactory: platform.driver }));
vi.mock('../src/sync/config', () => ({ readSyncConfig: vi.fn() }));
vi.mock('../src/privacy/consent-gate', () => ({ consentFetch: vi.fn() }));
vi.mock('../src/sync/write-signal', () => ({ emitLocalWrite: platform.write }));
vi.mock('../src/widgets/publish-source', () => ({ hostPublishSource: vi.fn(() => ({})) }));
vi.mock('../src/widgets/publish', () => ({ publishWidgetSnapshot: platform.publish }));
vi.mock('../src/lib/vault-secure-storage', () => ({ isVaultRootAutoUnlockDisabled: vi.fn(), loadVaultRootKey: vi.fn() }));
import { getOpenTaskHostIfReady, openTaskHost, resetTaskHostCache } from '../src/db/open-host';

function deferred() {
  let resolve!: (host: AppHost) => void, reject!: (error: Error) => void;
  const promise = new Promise<AppHost>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function host() { return { close: vi.fn(), dispatch: vi.fn() } as unknown as AppHost; }
beforeEach(() => { resetTaskHostCache(); vi.clearAllMocks(); platform.open.mockReset(); });
afterEach(() => { resetTaskHostCache(); });

it('concurrent screens share one platform opening and one ready host', async () => {
  const opening = deferred(); platform.open.mockReturnValueOnce(opening.promise);
  const first = openTaskHost(), second = openTaskHost();
  expect(first).toBe(second); expect(getOpenTaskHostIfReady()).toBeUndefined();
  opening.resolve(host());
  expect(await first).toBe(await second);
  expect(getOpenTaskHostIfReady()).toBe(await first); expect(platform.open).toHaveBeenCalledTimes(1);
});

it('an old opening cannot resurrect its host after a new database generation is ready', async () => {
  const oldOpening = deferred(), newOpening = deferred();
  platform.open.mockReturnValueOnce(oldOpening.promise).mockReturnValueOnce(newOpening.promise);
  const old = openTaskHost(); const oldResult = old.catch((error: unknown) => error);
  resetTaskHostCache(); const current = openTaskHost();
  newOpening.resolve(host()); const ready = await current;
  const stale = host(); oldOpening.resolve(stale);
  expect(await oldResult).toBeInstanceOf(Error);
  expect(stale.close).toHaveBeenCalledTimes(1);
  expect(getOpenTaskHostIfReady()).toBe(ready);
  expect(openTaskHost()).toBe(current);
});

it('a failed current platform opening can be retried instead of caching the rejection forever', async () => {
  platform.open.mockRejectedValueOnce(new Error('database temporarily unavailable')).mockResolvedValueOnce(host());
  await expect(openTaskHost()).rejects.toThrow('temporarily unavailable');
  await expect(openTaskHost()).resolves.toBeDefined();
  expect(platform.open).toHaveBeenCalledTimes(2);
});

it('a late failure from an old generation cannot discard a newer pending opening', async () => {
  const oldOpening = deferred(), newOpening = deferred();
  platform.open.mockReturnValueOnce(oldOpening.promise).mockReturnValueOnce(newOpening.promise);
  const old = openTaskHost().catch((error: unknown) => error);
  resetTaskHostCache(); const current = openTaskHost();
  oldOpening.reject(new Error('old open failed')); await old;
  expect(openTaskHost()).toBe(current);
  newOpening.resolve(host()); await current;
  expect(platform.open).toHaveBeenCalledTimes(2);
});
