/** Web vault session adapter.
 *
 * The web op-log may run in a SQLite worker, so the opaque key package gets a
 * separate IndexedDB database. It never stores a root key or passphrase: only
 * the validated wrapped package and account/server binding cross this boundary.
 */
import { IndexedDbAdapter } from '@heyta/storage';
import {
  createVaultKeyMigrationRemote,
  createVaultMigrationInventorySource,
  createVaultMigrationJournal,
  acknowledgeVaultPayloadMigration,
  cancelVaultPayloadMigrationForScope,
  migrateVaultPayloads,
  createVaultKeyPackageRemote,
  createVaultKeyPackageStore,
  type PendingVaultCreation,
  type VaultMigrationProgress,
  createVaultKeySession,
  type VaultKeyPackageRemote,
  type VaultKeySession,
} from '@heyta/app-host';
import type { VaultKeyMigrationResponse } from '@heyta/shared-schema';
import { createWebAuthFetch } from './central-fetch.js';

const DB_NAME = 'heyta-vault';

import { clearSessionVaultRoot, readSessionVaultRoot, writeSessionVaultRoot } from './vault-root-cache';
import { clearDeviceVaultRoot, loadDeviceVaultRoot, saveDeviceVaultRoot } from './vault-root-keychain';
import { readVaultKeyPlacement } from './vault-root-preference';

let storePromise: ReturnType<typeof createVaultKeyPackageStore> | undefined;
let adapterPromise: Promise<IndexedDbAdapter> | undefined;
let session: VaultKeySession | undefined;
let sessionScopeKey: string | undefined;
let sessionBindingKey: string | undefined;
let sessionEpoch = 0;
let inFlightLoad: {
  scopeKey: string;
  bindingKey: string;
  epoch: number;
  promise: Promise<VaultKeySession>;
} | undefined;

/**
 * Serialize account-local vault mutations with ordinary Web sync.
 *
 * Root migration has an inventory/stage/commit window.  A sync started by a
 * retry timer or the realtime hint must not upload in that window: the
 * migration manifest pins `latestSeq`, so a local upload there would turn a
 * perfectly valid migration into a self-inflicted `stale_latest_seq` failure.
 * The queue is deliberately process-local; writes from another device remain
 * concurrent and must still be reported by the server.
 */
let webSyncMutationTail: Promise<void> = Promise.resolve();

export async function withWebSyncMutationExclusive<T>(action: () => Promise<T>): Promise<T> {
  const previous = webSyncMutationTail;
  let release!: () => void;
  webSyncMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

async function packageStore(): Promise<ReturnType<typeof createVaultKeyPackageStore>> {
  if (storePromise !== undefined) return storePromise;
  adapterPromise ??= (async () => {
    const adapter = new IndexedDbAdapter(DB_NAME);
    await adapter.init();
    return adapter;
  })();
  storePromise = createVaultKeyPackageStore(await adapterPromise);
  return storePromise;
}

export async function getWebVaultSession(
  accountId: string,
  serverUrl: string,
  getToken?: () => Promise<string | undefined>,
  authTransport: 'bearer' | 'cookie' = 'bearer',
): Promise<VaultKeySession> {
  const origin = new URL(serverUrl).origin;
  const normalizedAccountId = accountId.trim();
  if (normalizedAccountId === '') throw new Error('Vault account id is required');
  const key = `${normalizedAccountId}\u0000${origin}`;
  const binding = `${key}\u0000${await getToken?.() ?? ''}`;
  // React StrictMode and the sync store can ask for the same session during
  // one render. Share that exact load instead of letting the second request
  // advance the invalidation epoch and kill the first request mid-hydration.
  const existing = inFlightLoad;
  if (existing !== undefined && existing.scopeKey === key && existing.bindingKey === binding &&
      existing.epoch === sessionEpoch) {
    return existing.promise;
  }
  const promise = (async (): Promise<VaultKeySession> => {
    let created = false;
    if (session === undefined || sessionBindingKey !== binding) {
      const creationEpoch = sessionEpoch + 1;
      sessionEpoch = creationEpoch;
      session?.lock();
      const nextSession = await createVaultKeySession({
        store: await packageStore(),
        scope: { accountId: normalizedAccountId, serverOrigin: origin },
      });
      if (creationEpoch !== sessionEpoch) {
        nextSession.lock();
        throw new Error('Web vault session was invalidated during load');
      }
      session = nextSession;
      sessionScopeKey = key;
      sessionBindingKey = binding;
      created = true;
      // ADR-0080：这台设备记住过 root 就直接解锁 —— 刷新之后不该再要一次口令。
      // 解不开（换过口令/换过 root）就把缓存清掉，退回"请解锁"，不猜。
      /*
       * 🔴 先问**壳的钥匙串**，再退 `sessionStorage`（ADR-0080 §5.4 / §5.5）。
       *
       * 顺序不能反：在 macOS 壳里两条腿都在（桥在 + sessionStorage 也能用），
       * 而只有钥匙串能活过**进程重启**。反过来先读 sessionStorage 的话，
       * "冷启动免输"就永远拿不到 —— 那时 sessionStorage 是空的。
       *
       * 三种返回值要分清：`undefined` = 没有桥（普通浏览器）；`null` = 有桥但没记住；
       * `Uint8Array` = 拿到了。前两种都落到 sessionStorage 那一格，行为与以前一致。
       */
      const scope = { accountId: normalizedAccountId, serverOrigin: origin };
      const fromKeychain = readVaultKeyPlacement() === 'ask'
        ? null
        : await loadDeviceVaultRoot(scope);
      const remembered = readVaultKeyPlacement() === 'ask'
        ? undefined
        : (fromKeychain ?? readSessionVaultRoot(scope));
      if (remembered === undefined && readVaultKeyPlacement() === 'ask') {
        // 从"设备"切到"每次都要输"之后，旧的那份必须真的消失，而不是留着等下次。
        clearSessionVaultRoot({ accountId: normalizedAccountId, serverOrigin: origin });
      }
      if (remembered !== undefined) {
        try {
          nextSession.unlockWithRootKey(remembered);
        } catch {
          clearSessionVaultRoot({ accountId: normalizedAccountId, serverOrigin: origin });
        } finally {
          remembered.fill(0);
        }
      }
    }
    const epoch = sessionEpoch;
    if (created && getToken !== undefined) {
      // The package revision and the active ciphertext generation are separate.
      // Read the authenticated server metadata before the first sync after a
      // reload so a passphrase re-wrap cannot make new uploads use the revision
      // number as its payload generation.
      await session!.refreshFromRemote(getWebVaultRemote(serverUrl, getToken ?? (async () => undefined), authTransport));
    }
    if (epoch !== sessionEpoch || session === undefined) {
      session?.lock();
      throw new Error('Web vault session was invalidated during load');
    }
    return session;
  })();
  inFlightLoad = { scopeKey: key, bindingKey: binding, epoch: sessionEpoch, promise };
  try {
    return await promise;
  } finally {
    if (inFlightLoad?.promise === promise) inFlightLoad = undefined;
  }
}

/**
 * 成功解锁之后把 root 记进这个标签页（ADR-0080 §5.4）。
 *
 * 恢复码解锁也记：它同样证明"这台设备现在是可信的"。但**轮换要求未满足**
 * （`requiresRecoveryRotation`）时不记 —— 那时旧 root 马上就要作废。
 */
export async function rememberCurrentWebVaultRoot(): Promise<void> {
  if (session === undefined || sessionScopeKey === undefined) return;
  if (session.requiresRecoveryRotation) return;
  // 第二个轴（ADR-0080 §5.5）：用户选了"每次都要输"就**不写**这把钥匙。
  if (readVaultKeyPlacement() === 'ask') return;
  const [accountId, serverOrigin] = sessionScopeKey.split('\u0000');
  if (accountId === undefined || serverOrigin === undefined) return;
  const root = session.copyUnlockedRootKey();
  try {
    /*
     * 桥在（macOS 壳）就写**钥匙串**，并且**不写** `sessionStorage`：
     * 两条腿同时写的话，"锁屏读不到 ⇒ 降级要口令"会被 sessionStorage 那份悄悄兜住，
     * 于是降级路径永远测不到，而用户以为自己设的"每次都要输"生效了。
     */
    const saved = await saveDeviceVaultRoot({ accountId, serverOrigin }, root);
    if (!saved) writeSessionVaultRoot({ accountId, serverOrigin }, root);
  } finally {
    root.fill(0);
  }
}

/**
 * 显式锁定：清掉这台设备记住的 root，然后锁会话。
 *
 * 🔴 两条腿都要清（`sessionStorage` + 壳的钥匙串）。只清一条的话，
 * 症状是"点了锁定，重开 App 又自己开了"——用户会以为锁定按钮坏了。
 * 清是 fire-and-forget：清不掉也不能把登出路径卡住（与 `vault-root-cache.ts` 同一条）。
 */
export function lockWebVaultSession(): void {
  if (sessionScopeKey !== undefined) {
    const [accountId, serverOrigin] = sessionScopeKey.split('\u0000');
    if (accountId !== undefined && serverOrigin !== undefined) {
      clearSessionVaultRoot({ accountId, serverOrigin });
      void clearDeviceVaultRoot({ accountId, serverOrigin });
    }
  }
  session?.lock();
}

/** Synchronously fence the web vault before credentials are cleared. */
export function invalidateWebVaultSession(): void {
  if (sessionScopeKey !== undefined) {
    const [accountId, serverOrigin] = sessionScopeKey.split('\u0000');
    if (accountId !== undefined && serverOrigin !== undefined) {
      clearSessionVaultRoot({ accountId, serverOrigin });
    }
  }
  sessionEpoch += 1;
  session?.lock();
  session = undefined;
  sessionScopeKey = undefined;
  sessionBindingKey = undefined;
}

export function getWebVaultRemote(
  baseUrl: string,
  getToken: () => Promise<string | undefined>,
  authTransport: 'bearer' | 'cookie' = 'bearer',
): VaultKeyPackageRemote {
  return createVaultKeyPackageRemote({ baseUrl, getToken, authTransport,
    fetchImpl: authTransport === 'cookie'
      ? createWebAuthFetch(baseUrl, 'cookie')
      : globalThis.fetch.bind(globalThis) });
}

export async function confirmWebVaultRootRotation(
  session: VaultKeySession,
  pending: PendingVaultCreation,
  enteredRecoveryCode: string,
  options: {
    baseUrl: string;
    token: string;
    authTransport?: 'bearer' | 'cookie';
    password?: string;
    onProgress?: (progress: VaultMigrationProgress) => void;
  },
): Promise<VaultKeyMigrationResponse> {
  return withWebSyncMutationExclusive(async () => {
    const adapter = await adapterPromise;
    if (adapter === undefined) throw new Error('Vault storage is unavailable');
    const remoteOptions = {
      baseUrl: options.baseUrl,
      getToken: async () => options.token,
      authTransport: options.authTransport,
      fetchImpl: options.authTransport === 'cookie'
        ? createWebAuthFetch(options.baseUrl, 'cookie')
        : globalThis.fetch.bind(globalThis),
    };
    const currentPayloadKeyVersion = session.payloadKeyVersion ?? null;
    const targetPayloadKeyVersion = (session.payloadKeyVersion ?? 0) + 1;
    const migrationRemote = createVaultKeyMigrationRemote(remoteOptions);
    const journal = createVaultMigrationJournal(adapter);
    let published: VaultKeyMigrationResponse | undefined;
    await session.confirmAndMigrateRootRotation(pending, enteredRecoveryCode, async (input) => {
      published = await migrateVaultPayloads({
        inventory: createVaultMigrationInventorySource(remoteOptions),
        remote: migrationRemote,
        package: input.targetPackage,
        expectedKeyVersion: input.currentPackage.keyVersion,
        currentPayloadKeyVersion,
        targetPayloadKeyVersion,
        currentRootKey: input.currentRootKey,
        targetRootKey: input.targetRootKey,
        ...(currentPayloadKeyVersion === null && options.password !== undefined
          ? { legacyPassword: options.password }
          : {}),
        journal,
        journalScope: `${session.scope.accountId}\u0000${session.scope.serverOrigin}`,
        clearJournalOnPublished: false,
        onProgress: options.onProgress,
      });
      return published;
    });
    if (published === undefined) throw new Error('Vault migration did not publish a result');
    await acknowledgeVaultPayloadMigration(
      journal,
      `${session.scope.accountId}\u0000${session.scope.serverOrigin}`,
      published.requestId,
    );
    return published;
  });
}

/** Cancel server staging before dropping the locally encrypted pending draft. */
export async function cancelWebVaultRootRotation(
  session: VaultKeySession,
  options: { baseUrl: string; token: string; authTransport?: 'bearer' | 'cookie' },
): Promise<void> {
  await withWebSyncMutationExclusive(async () => {
    const adapter = await adapterPromise;
    if (adapter === undefined) throw new Error('Vault storage is unavailable');
    const remoteOptions = {
      baseUrl: options.baseUrl,
      getToken: async () => options.token,
      authTransport: options.authTransport,
      fetchImpl: options.authTransport === 'cookie'
        ? createWebAuthFetch(options.baseUrl, 'cookie')
        : globalThis.fetch.bind(globalThis),
    };
    const journal = createVaultMigrationJournal(adapter);
    const remote = createVaultKeyMigrationRemote(remoteOptions);
    const journalScope = `${session.scope.accountId}\u0000${session.scope.serverOrigin}`;
    await cancelVaultPayloadMigrationForScope(remote, journal, journalScope);
    await session.cancelPendingRootRotation();
  });
}
