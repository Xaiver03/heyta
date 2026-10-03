import type { VaultKeyPackage } from '@heyta/sync-core';
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
  save(keyPackage: VaultKeyPackage): Promise<void>;
  /** Persist package and account/server binding in one local transaction. */
  saveBound(keyPackage: VaultKeyPackage, scope: VaultKeyPackageScope): Promise<void>;
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
  async save(keyPackage: VaultKeyPackage): Promise<void> {
    const parsed = vaultKeyPackageSchema.safeParse(keyPackage);
    if (!parsed.success) throw new Error('Invalid vault key package');
    await adapter.put(STORES.META, {
      key: META_KEYS.VAULT_KEY_PACKAGE,
      value: parsed.data,
    });
  },
  async saveBound(keyPackage: VaultKeyPackage, scope: VaultKeyPackageScope): Promise<void> {
    const parsed = vaultKeyPackageSchema.safeParse(keyPackage);
    if (!parsed.success) throw new Error('Invalid vault key package');
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
    });
  },
  async clear(): Promise<void> {
    await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
      await tx.delete(STORES.META, META_KEYS.VAULT_KEY_PACKAGE);
      await tx.delete(STORES.META, META_KEYS.VAULT_KEY_SCOPE);
    });
  },
});
