import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/prefs/device-prefs', () => ({
  readDevicePref: vi.fn(),
  writeDevicePref: vi.fn(),
}));

import {
  createRememberedUnlockVaultStorage,
  createVaultSecureStorage,
  isVaultRootAutoUnlockDisabled,
  normalizeVaultSecureStorageScope,
  type VaultSecureStorageNative,
} from '../src/lib/vault-secure-storage';
import { readDevicePref, writeDevicePref } from '../src/prefs/device-prefs';

const scope = { serverOrigin: ' https://sync.example.test/ ', accountId: ' account-1 ' };
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

beforeEach(() => {
  vi.mocked(readDevicePref).mockReset().mockReturnValue(undefined);
  vi.mocked(writeDevicePref).mockReset().mockReturnValue(true);
});

function nativeFixture(): VaultSecureStorageNative {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  };
}

describe('vault secure storage port', () => {
  it('normalizes and requires both scope components', () => {
    expect(normalizeVaultSecureStorageScope(scope)).toEqual({
      serverOrigin: 'https://sync.example.test/',
      accountId: 'account-1',
    });
    expect(() => normalizeVaultSecureStorageScope({ serverOrigin: '', accountId: 'a' })).toThrow();
    expect(() => normalizeVaultSecureStorageScope({ serverOrigin: 'https://x', accountId: ' ' })).toThrow();
    expect(() => normalizeVaultSecureStorageScope({ serverOrigin: 'https://x\nexample', accountId: 'a' })).toThrow();
  });

  it('has no implicit write and delegates explicit load/save/remove', async () => {
    const native = nativeFixture();
    const storage = createVaultSecureStorage(native);
    expect(native.save).not.toHaveBeenCalled();
    await expect(storage.load(scope)).resolves.toBeUndefined();
    await storage.save(scope, key);
    await storage.remove(scope);
    expect(native.load).toHaveBeenCalledWith('https://sync.example.test/', 'account-1');
    expect(native.save).toHaveBeenCalledWith('https://sync.example.test/', 'account-1', key);
    expect(native.remove).toHaveBeenCalledWith('https://sync.example.test/', 'account-1');
  });

  it('does not remove a previous key when save rejects', async () => {
    const native = nativeFixture();
    native.save = vi.fn(async () => { throw new Error('sync unavailable'); });
    const storage = createVaultSecureStorage(native);
    await expect(storage.save(scope, key)).rejects.toThrow('sync unavailable');
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('fails clearly when the native module is incomplete', () => {
    expect(() => createVaultSecureStorage({} as VaultSecureStorageNative)).toThrow('原生模块不可用');
  });

  it('missing remembered-unlock marker fails closed before native load', async () => {
    const native = nativeFixture();
    const storage = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), {
      read: () => undefined,
      write: () => true,
    });
    await expect(storage.load(scope)).resolves.toBeUndefined();
    expect(native.load).not.toHaveBeenCalled();
    expect(isVaultRootAutoUnlockDisabled(scope)).toBe(true);
  });

  it('save commits the explicit opt-in marker only after native save', async () => {
    const native = nativeFixture();
    const writes: Array<[string, string]> = [];
    const storage = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), {
      read: () => undefined,
      write: (name, value) => {
        writes.push([name, value]);
        return true;
      },
    });
    await storage.save(scope, key);
    expect(native.save).toHaveBeenCalled();
    expect(writes).toEqual([['vault.rememberedUnlockDisabled:https://sync.example.test/\u0000account-1', '0']]);
  });

  it('remove fences remembered unlock even when native deletion fails', async () => {
    const native = nativeFixture();
    native.remove = vi.fn(async () => false);
    const writes: Array<[string, string]> = [];
    const storage = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), {
      read: () => '0',
      write: (name, value) => {
        writes.push([name, value]);
        return true;
      },
    });
    await expect(storage.remove(scope)).rejects.toThrow('未能从安全存储清除');
    expect(writes).toEqual([['vault.rememberedUnlockDisabled:https://sync.example.test/\u0000account-1', '1']]);
  });

  it('does not re-enable the marker when logout races an in-flight native save', async () => {
    let releaseSave!: () => void;
    const saveStarted = new Promise<void>((resolve) => { releaseSave = resolve; });
    const native = nativeFixture();
    native.save = vi.fn(async () => {
      await saveStarted;
      return true;
    });
    const writes: Array<[string, string]> = [];
    const storage = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), {
      read: () => undefined,
      write: (name, value) => {
        writes.push([name, value]);
        return true;
      },
    });
    const saving = storage.save(scope, key);
    await Promise.resolve();
    const removing = storage.remove(scope);
    releaseSave();
    await removing;
    await expect(saving).rejects.toThrow('保存期间已失效');
    expect(writes).toEqual([['vault.rememberedUnlockDisabled:https://sync.example.test/\u0000account-1', '1']]);
  });
});
