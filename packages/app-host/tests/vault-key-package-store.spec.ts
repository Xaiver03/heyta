import { describe, expect, it } from 'vitest';
import { INDEXEDDB_SCHEMA, MemoryDbAdapter, STORES } from '@heyta/storage';
import { createVaultKeyPackageStore } from '../src';

describe('vault key package local persistence', () => {
  it('stores only the opaque package in meta and can clear it', async () => {
    const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await adapter.init();
    const store = createVaultKeyPackageStore(adapter);
    const keyPackage = {
      version: 1 as const,
      keyVersion: 1,
      rootKeyFingerprint: 'a'.repeat(64),
      passphrase: { kdf: 'argon2id' as const, salt: `${'A'.repeat(22)}==`, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(64) },
      recovery: { kdf: 'argon2id' as const, salt: `${'B'.repeat(22)}==`, iv: 'B'.repeat(16), ciphertext: 'B'.repeat(64) },
    };
    await store.save(keyPackage);
    await expect(store.load()).resolves.toEqual(keyPackage);
    const meta = await adapter.get<{ key: string; value: unknown }>(STORES.META, 'vaultKeyPackageV1');
    expect(JSON.stringify(meta)).not.toContain('"rootKey":');
    await store.clear();
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('fails closed for malformed persisted metadata and rejects malformed saves', async () => {
    const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await adapter.init();
    const store = createVaultKeyPackageStore(adapter);
    await adapter.put(STORES.META, {
      key: 'vaultKeyPackageV1',
      value: { version: 2 },
    }, 'vaultKeyPackageV1');
    await expect(store.load()).rejects.toThrow('Invalid persisted vault key package');
    await expect(store.save({ version: 1 } as never)).rejects.toThrow('Invalid vault key package');
  });
});
