import {
  assertEncryptedVaultRecord,
  assertVaultKeyPackage,
  decryptVaultRecord,
  encodeBase64,
  decodeBase64,
  encryptVaultRecord,
  type EncryptedVaultRecord,
  type VaultKeyPackage,
} from '@heyta/sync-core';
import { vaultKeyPackageSchema } from '@heyta/shared-schema';
import { META_KEYS, STORES, type DbAdapter } from '@heyta/storage';

export interface VaultKeyPackageScope {
  /** Stable authenticated account identifier, never inferred from clientId. */
  accountId: string;
  /** Canonical server origin (scheme + host + optional port). */
  serverOrigin: string;
}

interface PersistedScopeRecord {
  accountId: string;
  serverOrigin: string;
}

interface PersistedPendingRootRotation {
  version: 1;
  accountId: string;
  serverOrigin: string;
  package: VaultKeyPackage;
  /** The target root is encrypted under the currently unlocked root. */
  targetRoot: EncryptedVaultRecord;
}

const parseScope = (value: unknown): VaultKeyPackageScope => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid persisted vault key-package scope');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.accountId !== 'string' ||
      record.accountId.length === 0 || typeof record.serverOrigin !== 'string' ||
      record.serverOrigin.length === 0) {
    throw new Error('Invalid persisted vault key-package scope');
  }
  return { accountId: record.accountId, serverOrigin: record.serverOrigin };
};

/**
 * Persists only the opaque wrapped key package in the local database.
 * The root key and recovery code deliberately have no method here: they live
 * in the unlocked session / platform secure storage, never in op-log or meta.
 */
export interface VaultKeyPackageStore {
  load(): Promise<VaultKeyPackage | undefined>;
  loadScope(): Promise<VaultKeyPackageScope | undefined>;
  /** `null` is a known legacy cohort; `undefined` means no local observation. */
  loadPayloadKeyVersion(): Promise<number | null | undefined>;
  /** Update only the observed server generation; do not clear a pending draft. */
  savePayloadKeyVersion(payloadKeyVersion: number | null): Promise<void>;
  save(keyPackage: VaultKeyPackage): Promise<void>;
  /** Persist package and account/server binding in one local transaction. */
  saveBound(keyPackage: VaultKeyPackage, scope: VaultKeyPackageScope, payloadKeyVersion?: number | null): Promise<void>;
  savePendingRootRotation(
    pendingPackage: VaultKeyPackage,
    scope: VaultKeyPackageScope,
    currentRootKey: Uint8Array,
    targetRootKey: Uint8Array,
  ): Promise<void>;
  /** Read the staged package without decrypting its root, while locked. */
  peekPendingRootRotationPackage(
    scope: VaultKeyPackageScope,
  ): Promise<VaultKeyPackage | undefined>;
  loadPendingRootRotation(
    scope: VaultKeyPackageScope,
    currentRootKey: Uint8Array,
  ): Promise<{ package: VaultKeyPackage; rootKey: Uint8Array } | undefined>;
  clearPendingRootRotation(): Promise<void>;
  clear(): Promise<void>;
}

export const createVaultKeyPackageStore = (adapter: DbAdapter): VaultKeyPackageStore => ({
  async load(): Promise<VaultKeyPackage | undefined> {
    const record = await adapter.get<{ key: string; value: unknown }>(
      STORES.META,
      META_KEYS.VAULT_KEY_PACKAGE,
    );
    if (!record) return undefined;
    const parsed = vaultKeyPackageSchema.safeParse(record.value);
    if (!parsed.success) throw new Error('Invalid persisted vault key package');
    return parsed.data;
  },
  async loadScope(): Promise<VaultKeyPackageScope | undefined> {
    const record = await adapter.get<{ key: string; value: unknown }>(
      STORES.META,
      META_KEYS.VAULT_KEY_SCOPE,
    );
    if (!record) return undefined;
    return parseScope(record.value);
  },
  async loadPayloadKeyVersion(): Promise<number | null | undefined> {
    const record = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.VAULT_PAYLOAD_KEY_VERSION);
    if (!record) return undefined;
    if (record.value === null) return null;
    if (!Number.isSafeInteger(record.value) || (record.value as number) <= 0) {
      throw new Error('Invalid persisted vault payload key generation');
    }
    return record.value as number;
  },
  async savePayloadKeyVersion(payloadKeyVersion: number | null): Promise<void> {
    if (payloadKeyVersion !== null &&
        (!Number.isSafeInteger(payloadKeyVersion) || payloadKeyVersion <= 0)) {
      throw new Error('Invalid vault payload key generation');
    }
    await adapter.put(STORES.META, {
      key: META_KEYS.VAULT_PAYLOAD_KEY_VERSION,
      value: payloadKeyVersion,
    });
  },
  async save(keyPackage: VaultKeyPackage): Promise<void> {
    const parsed = vaultKeyPackageSchema.safeParse(keyPackage);
    if (!parsed.success) throw new Error('Invalid vault key package');
    await adapter.put(STORES.META, {
      key: META_KEYS.VAULT_KEY_PACKAGE,
      value: parsed.data,
    });
  },
  async saveBound(keyPackage: VaultKeyPackage, scope: VaultKeyPackageScope, payloadKeyVersion?: number | null): Promise<void> {
    const parsed = vaultKeyPackageSchema.safeParse(keyPackage);
    if (!parsed.success) throw new Error('Invalid vault key package');
    if (payloadKeyVersion !== undefined && payloadKeyVersion !== null &&
        (!Number.isSafeInteger(payloadKeyVersion) || payloadKeyVersion <= 0)) {
      throw new Error('Invalid vault payload key generation');
    }
    const persistedScope: PersistedScopeRecord = parseScope(scope);
    await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
      await tx.put(STORES.META, {
        key: META_KEYS.VAULT_KEY_PACKAGE,
        value: parsed.data,
      });
      await tx.put(STORES.META, {
        key: META_KEYS.VAULT_KEY_SCOPE,
        value: persistedScope,
      });
      if (payloadKeyVersion !== undefined) {
        await tx.put(STORES.META, { key: META_KEYS.VAULT_PAYLOAD_KEY_VERSION, value: payloadKeyVersion });
      } else {
        await tx.delete(STORES.META, META_KEYS.VAULT_PAYLOAD_KEY_VERSION);
      }
      // A successful package install closes any locally staged root draft in
      // the same transaction as the package/generation pair.
      await tx.delete(STORES.META, META_KEYS.VAULT_PENDING_ROOT_ROTATION);
    });
  },
  async savePendingRootRotation(pendingPackage, scope, currentRootKey, targetRootKey): Promise<void> {
    assertVaultKeyPackage(pendingPackage);
    if (currentRootKey.length !== 32 || targetRootKey.length !== 32) throw new Error('Invalid vault root key');
    const persistedScope: PersistedScopeRecord = parseScope(scope);
    const targetRoot = await encryptVaultRecord(
      `pending-root-rotation:${scope.accountId}\u0000${scope.serverOrigin}`,
      JSON.stringify({ targetRoot: encodeBase64(targetRootKey) }),
      currentRootKey,
      'sync',
      pendingPackage.keyVersion - 1,
    );
    await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
      await tx.put(STORES.META, {
        key: META_KEYS.VAULT_PENDING_ROOT_ROTATION,
        value: {
          version: 1,
          accountId: persistedScope.accountId,
          serverOrigin: persistedScope.serverOrigin,
          package: pendingPackage,
          targetRoot,
        } satisfies PersistedPendingRootRotation,
      });
    });
  },
  async peekPendingRootRotationPackage(scope): Promise<VaultKeyPackage | undefined> {
    const record = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.VAULT_PENDING_ROOT_ROTATION);
    if (!record || typeof record.value !== 'object' || record.value === null || Array.isArray(record.value)) {
      return undefined;
    }
    const value = record.value as Partial<PersistedPendingRootRotation>;
    if (value.version !== 1 || value.accountId !== scope.accountId || value.serverOrigin !== scope.serverOrigin ||
        value.package === undefined) {
      return undefined;
    }
    const parsed = vaultKeyPackageSchema.safeParse(value.package);
    if (!parsed.success) throw new Error('Invalid persisted pending vault rotation package');
    return parsed.data;
  },
  async loadPendingRootRotation(scope, currentRootKey): Promise<{ package: VaultKeyPackage; rootKey: Uint8Array } | undefined> {
    if (currentRootKey.length !== 32) throw new Error('Invalid vault root key');
    const record = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.VAULT_PENDING_ROOT_ROTATION);
    if (!record || typeof record.value !== 'object' || record.value === null || Array.isArray(record.value)) return undefined;
    const value = record.value as Partial<PersistedPendingRootRotation>;
    if (value.version !== 1 || value.accountId !== scope.accountId || value.serverOrigin !== scope.serverOrigin ||
        value.package === undefined || value.targetRoot === undefined) return undefined;
    const pendingPackage = vaultKeyPackageSchema.parse(value.package);
    assertEncryptedVaultRecord(value.targetRoot);
    const plaintext = await decryptVaultRecord(value.targetRoot, currentRootKey);
    const parsed = JSON.parse(plaintext) as { targetRoot?: unknown };
    if (typeof parsed.targetRoot !== 'string') throw new Error('Invalid persisted pending vault rotation');
    const rootKey = new Uint8Array(decodeBase64(parsed.targetRoot));
    if (rootKey.length !== 32) throw new Error('Invalid persisted pending vault rotation root');
    return { package: pendingPackage, rootKey };
  },
  async clearPendingRootRotation(): Promise<void> {
    await adapter.delete(STORES.META, META_KEYS.VAULT_PENDING_ROOT_ROTATION);
  },
  async clear(): Promise<void> {
    await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
      await tx.delete(STORES.META, META_KEYS.VAULT_KEY_PACKAGE);
      await tx.delete(STORES.META, META_KEYS.VAULT_KEY_SCOPE);
      await tx.delete(STORES.META, META_KEYS.VAULT_PAYLOAD_KEY_VERSION);
      await tx.delete(STORES.META, META_KEYS.VAULT_MIGRATION_JOURNAL);
      await tx.delete(STORES.META, META_KEYS.VAULT_PENDING_ROOT_ROTATION);
    });
  },
});
