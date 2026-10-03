import { beforeEach, describe, expect, it } from 'vitest';
import { INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { decodeBase64, setArgon2ParamsForTesting } from '@heyta/sync-core';
import {
  VaultSessionError,
  createVaultKeyPackageStore,
  createVaultKeySession,
  type VaultKeyPackageRemote,
} from '../src';

const scope = { accountId: 'user-1', serverOrigin: 'https://sync.example.test' };

const makeStore = async () => {
  const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await adapter.init();
  return createVaultKeyPackageStore(adapter);
};

describe('vault key session', () => {
  beforeEach(() => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  it('keeps creation pending until recovery confirmation and fails closed while locked', async () => {
    const store = await makeStore();
    const session = await createVaultKeySession({ store, scope });
    const pending = await session.beginCreation('correct horse battery staple');
    expect(session.state).toBe('locked');
    expect(await session.getPayloadCipher()).toBeUndefined();
    await expect(session.confirmAndPublish(pending, 'wrong')).rejects.toMatchObject({
      code: 'recovery-confirmation-mismatch',
    });
    await expect(store.load()).resolves.toBeUndefined();

    const remote: VaultKeyPackageRemote = {
      serverOrigin: scope.serverOrigin,
      get: async () => pending.package,
      put: async (pkg, expected) => {
        expect(expected).toBe(0);
        return pkg;
      },
    };
    await session.confirmAndPublish(pending, pending.recoveryCode, remote);
    expect(session.state).toBe('unlocked');
    const retainedCipher = await session.getPayloadCipher();
    expect(retainedCipher).toBeDefined();
    expect((await store.load())?.rootKeyFingerprint).toBe(pending.package.rootKeyFingerprint);
    expect(JSON.stringify(await store.load())).not.toContain('recoveryCode');
    session.lock();
    expect(session.state).toBe('locked');
    expect(await session.getPayloadCipher()).toBeUndefined();
    await expect(retainedCipher!.encrypt('secret', {
      id: 'op-1', clientId: 'client-1', actionType: 'create', opType: 'ADD',
      entityType: 'TASK', entityId: 'task-1', timestamp: 1, schemaVersion: 1,
    })).rejects.toThrow('Vault is locked');
  });

  it('wipes pending root buffers when the session is locked', async () => {
    const store = await makeStore();
    const session = await createVaultKeySession({ store, scope });
    const pending = await session.beginCreation('passphrase');
    session.lock();
    await expect(session.confirmAndPublish(pending, pending.recoveryCode)).rejects.toMatchObject({
      code: 'pending-invalid',
    });
  });

  it('accepts only a fingerprint-matching root key from an opted-in secure store', async () => {
    const store = await makeStore();
    const session = await createVaultKeySession({ store, scope });
    const pending = await session.beginCreation('passphrase');
    await session.confirmAndPublish(pending, pending.recoveryCode);
    const root = session.copyUnlockedRootKey();
    session.lock();
    session.unlockWithRootKey(root);
    expect(session.state).toBe('unlocked');
    root.fill(0);
    expect(() => session.unlockWithRootKey(new Uint8Array(32))).toThrow(VaultSessionError);
    expect(() => session.copyUnlockedRootKey()).not.toThrow();
  });

  it('fails closed after recovery unlock until a new wrapper is published', async () => {
    const store = await makeStore();
    const session = await createVaultKeySession({ store, scope });
    const initial = await session.beginCreation('old passphrase');
    await session.confirmAndPublish(initial, initial.recoveryCode);

    session.lock();
    await session.unlockWithRecoveryCode(initial.recoveryCode);
    expect(session.requiresRecoveryRotation).toBe(true);
    expect(await session.getPayloadCipher()).toBeUndefined();

    const changed = await session.beginPassphraseChange('new passphrase');
    await session.confirmAndPublish(changed, changed.recoveryCode);
    expect(session.requiresRecoveryRotation).toBe(false);
    expect(await session.getPayloadCipher()).toBeDefined();
  });

  it('does not install a KDF result after the session is locked mid-operation', async () => {
    const store = await makeStore();
    const session = await createVaultKeySession({ store, scope });
    const initial = await session.beginCreation('passphrase');
    await session.confirmAndPublish(initial, initial.recoveryCode);

    session.lock();
    const unlocking = session.unlockWithPassphrase('passphrase');
    session.lock();
    await expect(unlocking).rejects.toMatchObject({ code: 'vault-locked' });
    expect(session.state).toBe('locked');
  });

  it('preserves the local old package when publication is uncertain, then resumes idempotently', async () => {
    const store = await makeStore();
    const session = await createVaultKeySession({ store, scope });
    const initial = await session.beginCreation('old passphrase');
    const remoteState: { package?: typeof initial.package } = {};
    const firstRemote: VaultKeyPackageRemote = {
      serverOrigin: scope.serverOrigin,
      get: async () => remoteState.package,
      put: async () => { throw new Error('network lost after commit'); },
    };
    await expect(session.confirmAndPublish(initial, initial.recoveryCode, firstRemote)).rejects.toThrow('network lost after commit');
    await expect(store.load()).resolves.toBeUndefined();

    // A response lost after the server committed is recovered by an exact GET.
    const committedRemote: VaultKeyPackageRemote = {
      serverOrigin: scope.serverOrigin,
      get: async () => remoteState.package,
      put: async (pkg) => { remoteState.package = pkg; throw new Error('response lost'); },
    };
    await session.confirmAndPublish(initial, initial.recoveryCode, committedRemote);
    expect((await store.load())?.keyVersion).toBe(1);
  });

  it('pins account/server scope and rejects downgrade or same-version root conflicts', async () => {
    const store = await makeStore();
    const first = await createVaultKeySession({ store, scope });
    const pending = await first.beginCreation('passphrase');
    await first.confirmAndPublish(pending, pending.recoveryCode);
    await expect(createVaultKeySession({ store, scope: { ...scope, accountId: 'other' } }))
      .rejects.toMatchObject({ code: 'scope-mismatch' });

    const changed = await first.beginPassphraseChange('new passphrase');
    await first.confirmAndPublish(changed, changed.recoveryCode);

    const locked = await createVaultKeySession({ store, scope });
    await expect(locked.refreshFromRemote({
      serverOrigin: scope.serverOrigin,
      get: async () => pending.package,
      put: async () => pending.package,
    })).rejects.toMatchObject({ code: 'remote-downgrade' });
    await expect(locked.refreshFromRemote({
      serverOrigin: scope.serverOrigin,
      get: async () => ({ ...changed.package, rootKeyFingerprint: 'b'.repeat(64) }),
      put: async () => changed.package,
    })).rejects.toMatchObject({ code: 'remote-root-conflict' });
  });

  it('changes passphrase with the same root and keeps old-version payloads readable', async () => {
    const store = await makeStore();
    const session = await createVaultKeySession({ store, scope });
    const initial = await session.beginCreation('old passphrase');
    await session.confirmAndPublish(initial, initial.recoveryCode);
    const oldCipher = await session.getPayloadCipher();
    expect(oldCipher).toBeDefined();
    const changed = await session.beginPassphraseChange('new passphrase');
    expect(changed.package.rootKeyFingerprint).toBe(initial.package.rootKeyFingerprint);
    await session.confirmAndPublish(changed, changed.recoveryCode);
    expect(session.keyPackage?.keyVersion).toBe(2);
    session.lock();
    await session.unlockWithPassphrase('new passphrase');
    expect(await session.getPayloadCipher()).toBeDefined();
    await expect(session.unlockWithPassphrase('old passphrase')).rejects.toBeDefined();
  });

  it('uses the server payload generation instead of the wrapper revision for new writes', async () => {
    const store = await makeStore();
    const session = await createVaultKeySession({ store, scope });
    const initial = await session.beginCreation('old passphrase');
    await session.confirmAndPublish(initial, initial.recoveryCode);
    const changed = await session.beginPassphraseChange('new passphrase');
    await session.confirmAndPublish(changed, changed.recoveryCode);
    expect(session.keyPackage?.keyVersion).toBe(2);

    await session.refreshFromRemote({
      serverOrigin: scope.serverOrigin,
      get: async () => changed.package,
      getState: async () => ({ package: changed.package, payloadKeyVersion: 1 }),
      put: async () => changed.package,
    });
    const cipher = await session.getPayloadCipher();
    const encoded = await cipher!.encrypt('payload', {
      id: 'op-1', clientId: 'client-1', actionType: 'create', opType: 'ADD',
      entityType: 'TASK', entityId: 'task-1', timestamp: 1, schemaVersion: 1,
    });
    const bytes = new Uint8Array(decodeBase64(encoded));
    expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .getFloat64('heyta-vault-op/'.length + 1, false)).toBe(1);
  });

  it('root rotation migrates before installing the new package and generation', async () => {
    const store = await makeStore();
    const session = await createVaultKeySession({ store, scope });
    const initial = await session.beginCreation('old passphrase');
    await session.confirmAndPublish(initial, initial.recoveryCode);
    const pending = await session.beginRootRotation('new passphrase');
    await expect(session.confirmAndMigrateRootRotation(pending, 'wrong', async () => ({
      keyVersion: 2,
      payloadKeyVersion: 1,
    }))).rejects.toMatchObject({ code: 'recovery-confirmation-mismatch' });
    expect(session.keyPackage?.rootKeyFingerprint).toBe(initial.package.rootKeyFingerprint);

    let migrated = false;
    const result = await session.confirmAndMigrateRootRotation(pending, pending.recoveryCode, async (input) => {
      migrated = true;
      expect(input.currentPackage.rootKeyFingerprint).toBe(initial.package.rootKeyFingerprint);
      expect(input.targetPackage.rootKeyFingerprint).toBe(pending.package.rootKeyFingerprint);
      expect(input.currentRootKey).not.toEqual(input.targetRootKey);
      return { keyVersion: 2, payloadKeyVersion: 2 };
    });
    expect(migrated).toBe(true);
    expect(result.payloadKeyVersion).toBe(2);
    expect(session.keyPackage?.rootKeyFingerprint).toBe(pending.package.rootKeyFingerprint);
    expect(session.payloadKeyVersion).toBe(2);
    expect(session.state).toBe('unlocked');
  });
});
