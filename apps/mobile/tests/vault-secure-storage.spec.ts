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

  it('deletes after an in-flight save across independently created wrappers', async () => {
    const account = { ...scope, accountId: 'late-native-save' };
    let finishSave!: () => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; });
    const finish = new Promise<void>((resolve) => { finishSave = resolve; });
    let item: string | null = null;
    let marker: string | undefined;
    const events: string[] = [];
    const native: VaultSecureStorageNative = {
      load: async () => item,
      save: async (_origin, _account, root) => {
        started();
        await finish;
        item = root;
        events.push('save');
        return true;
      },
      remove: async () => { item = null; events.push('remove'); return true; },
    };
    const prefs = { read: () => marker, write: (_name: string, value: string) => { marker = value; return true; } };
    const saver = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), prefs);
    const logout = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), prefs);
    const saving = saver.save(account, key);
    const rejected = expect(saving).rejects.toThrow('保存期间已失效');
    await start;
    const removing = logout.remove(account);
    expect(marker).toBe('1');
    finishSave();
    await rejected;
    await removing;
    expect(item === null, 'logout must leave no native root even when an older save resolves late').toBe(true);
    expect(events).toEqual(['save', 'remove']);
    await expect(saver.load(account)).resolves.toBeUndefined();
  });

  it('does not return a root from a native load that resolves after logout', async () => {
    const account = { ...scope, accountId: 'late-native-load' };
    let finishLoad!: (value: string) => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; });
    const native = nativeFixture();
    native.load = vi.fn(() => {
      started();
      return new Promise<string>((resolve) => { finishLoad = resolve; });
    });
    let marker = '0';
    const prefs = { read: () => marker, write: (_name: string, value: string) => { marker = value; return true; } };
    const reader = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), prefs);
    const logout = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), prefs);
    const loading = reader.load(account);
    await start;
    const removing = logout.remove(account);
    finishLoad(key);
    await expect(loading).resolves.toBeUndefined();
    await removing;
    expect(native.remove).toHaveBeenCalledOnce();
  });

  it('still attempts native deletion if the preference fence cannot be persisted', async () => {
    const account = { ...scope, accountId: 'failed-fence' };
    const native = nativeFixture();
    const storage = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), {
      read: () => '0', write: () => false,
    });
    await expect(storage.remove(account)).rejects.toThrow('禁用状态未能写入');
    expect(native.remove).toHaveBeenCalledOnce();
    await expect(storage.load(account)).resolves.toBeUndefined();
    expect(native.load).not.toHaveBeenCalled();
  });

  it('an explicit later opt-in can enable the same account again', async () => {
    const account = { ...scope, accountId: 'later-opt-in' };
    let marker = '0';
    const native = nativeFixture();
    native.load = vi.fn(async () => key);
    const storage = createRememberedUnlockVaultStorage(createVaultSecureStorage(native), {
      read: () => marker, write: (_name, value) => { marker = value; return true; },
    });
    await storage.remove(account);
    await expect(storage.load(account)).resolves.toBeUndefined();
    await storage.save(account, key);
    await expect(storage.load(account)).resolves.toBe(key);
  });
});
