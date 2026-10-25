import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/prefs/device-prefs', () => ({
  readDevicePref: vi.fn(),
  writeDevicePref: vi.fn(),
}));

import {
  createRememberedUnlockVaultStorage,
  createVaultSecureBlobStorage,
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
    loadBlob: vi.fn(async () => null),
    saveBlob: vi.fn(async () => true),
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
      loadBlob: async () => null,
      saveBlob: async () => true,
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

/**
 * 密钥料（blob）通道。
 *
 * 🔴 这组用例的存在理由来自 2026-10-25 的 iOS 旅程实测：share 密钥环那份变长 JSON
 * 当时走的是 root key 那对接口，原生按契约拒了（`vault root key 必须是 32 字节 Base64`），
 * 手机入群因此永远走不到成功态。夹具喂的是假 vault，那对契约只有真机能撞出来 ——
 * 这里能钉住的是"密钥料不许再走 root key 那对"这一条形状纪律。
 */
describe('vault blob（密钥料）通道', () => {
  it('load/save 走 blob，绝不碰 root key 那对接口', async () => {
    const native = nativeFixture();
    const blob = 'NOT-32-BYTES-AT-ALL';
    await expect(createVaultSecureBlobStorage(native).load(scope)).resolves.toBeUndefined();
    await createVaultSecureBlobStorage(native).save(scope, blob);
    expect(native.loadBlob).toHaveBeenCalledWith('https://sync.example.test/', 'account-1');
    expect(native.saveBlob).toHaveBeenCalledWith('https://sync.example.test/', 'account-1', blob);
    expect(native.load).not.toHaveBeenCalled();
    expect(native.save).not.toHaveBeenCalled();
  });

  it('原生返回的字符串原样交出，null 如实是「没有」', async () => {
    const native = nativeFixture();
    native.loadBlob = vi.fn(async () => '{"version":1,"entries":[]}');
    await expect(createVaultSecureBlobStorage(native).load(scope)).resolves.toBe('{"version":1,"entries":[]}');
  });

  it('空值在打原生桥之前就拒（不许把空槽写进钥匙串冒充密钥）', async () => {
    const native = nativeFixture();
    await expect(createVaultSecureBlobStorage(native).save(scope, '  ')).rejects.toThrow('密钥料不能为空');
    expect(native.saveBlob).not.toHaveBeenCalled();
  });

  it('native 报 false ⇒ 抛，且不会顺手删掉旧值', async () => {
    const native = nativeFixture();
    native.saveBlob = vi.fn(async () => false);
    const storage = createVaultSecureBlobStorage(native);
    await expect(storage.save(scope, 'X')).rejects.toThrow('密钥料未能写入安全存储');
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('缺 blob 通道的旧原生：blob 端口具名失败，root key 端口不受影响', () => {
    const legacy = { load: async () => null, save: async () => true, remove: async () => true } as unknown as VaultSecureStorageNative;
    expect(() => createVaultSecureBlobStorage(legacy)).toThrow('缺少密钥料（blob）通道');
    expect(() => createVaultSecureStorage(legacy)).not.toThrow();
  });
});
