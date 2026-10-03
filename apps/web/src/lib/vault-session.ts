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

const DB_NAME = 'heyta-vault';

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
    }
    const epoch = sessionEpoch;
    if (created && getToken !== undefined) {
      // The package revision and the active ciphertext generation are separate.
      // Read the authenticated server metadata before the first sync after a
      // reload so a passphrase re-wrap cannot make new uploads use the revision
      // number as its payload generation.
      await session!.refreshFromRemote(getWebVaultRemote(serverUrl, getToken));
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

/** Synchronously fence the web vault before credentials are cleared. */
export function invalidateWebVaultSession(): void {
  sessionEpoch += 1;
  session?.lock();
  session = undefined;
  sessionScopeKey = undefined;
  sessionBindingKey = undefined;
}

export function getWebVaultRemote(
  baseUrl: string,
  getToken: () => Promise<string | undefined>,
): VaultKeyPackageRemote {
  return createVaultKeyPackageRemote({ baseUrl, getToken });
}

export async function confirmWebVaultRootRotation(
  session: VaultKeySession,
  pending: PendingVaultCreation,
  enteredRecoveryCode: string,
  options: {
    baseUrl: string;
    token: string;
    password?: string;
    onProgress?: (progress: VaultMigrationProgress) => void;
  },
): Promise<VaultKeyMigrationResponse> {
  const adapter = await adapterPromise;
  if (adapter === undefined) throw new Error('Vault storage is unavailable');
  const remoteOptions = {
    baseUrl: options.baseUrl,
    getToken: async () => options.token,
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
      onProgress: options.onProgress,
    });
    return published;
  });
  if (published === undefined) throw new Error('Vault migration did not publish a result');
  return published;
}

/** Cancel server staging before dropping the locally encrypted pending draft. */
export async function cancelWebVaultRootRotation(
  session: VaultKeySession,
  options: { baseUrl: string; token: string },
): Promise<void> {
  const adapter = await adapterPromise;
  if (adapter === undefined) throw new Error('Vault storage is unavailable');
  const remoteOptions = {
    baseUrl: options.baseUrl,
    getToken: async () => options.token,
  };
  const journal = createVaultMigrationJournal(adapter);
  const remote = createVaultKeyMigrationRemote(remoteOptions);
  const journalScope = `${session.scope.accountId}\u0000${session.scope.serverOrigin}`;
  await cancelVaultPayloadMigrationForScope(remote, journal, journalScope);
  await session.cancelPendingRootRotation();
}
