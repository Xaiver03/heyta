/**
 * 移动端 share 密钥落盘端口的验收（两半式，本壳惯例）：
 *
 * 1. **值导入**：`createShareKeyStoragePort` 喂假 `VaultSecureStorage`（Map 实现），
 *    钉住"落在哪一格、槽内形状、坏槽降级、remove 清槽"这些真行为 —— 测试不碰原生模块。
 * 2. **去注释的源码文本**：钉住反向判据（不许把密钥料写进 device-prefs、
 *    不许在外壳里长出第二份判定本体/键名字面量）。不先剥注释，`not.toMatch` 会假绿。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/prefs/device-prefs', () => ({
  readDevicePref: vi.fn(),
  writeDevicePref: vi.fn(),
  deleteDevicePref: vi.fn(),
}));

import {
  createShareKeyStoragePort,
  shareKeyStoreScope,
} from '../src/lib/share-key-store';
import { SHARE_KEY_STORAGE_PORTABLE_KEY } from '@heyta/app-host';
import type { VaultSecureStorage, VaultSecureStorageScope } from '../src/lib/vault-secure-storage';

import { read, stripComments } from './source-reading';

const SCOPE: VaultSecureStorageScope = { serverOrigin: 'https://sync.example.test', accountId: 'account-1' };

/** 假原生：每个 (serverOrigin, accountId) 一格 —— 与 `VaultSecureStorage` 同契约。 */
const makeVault = () => {
  const slots = new Map<string, string | undefined>();
  const slotKey = (scope: VaultSecureStorageScope) => `${scope.serverOrigin}\u0000${scope.accountId}`;
  const vault: VaultSecureStorage = {
    async load(scope) { return slots.get(slotKey(scope)); },
    async save(scope, value) { slots.set(slotKey(scope), value); },
    async remove(scope) { slots.delete(slotKey(scope)); },
  };
  return { vault, slots, slotKey };
};

describe('mobile share-key 端口 · 值导入那半', () => {
  let kit: ReturnType<typeof makeVault>;
  let port: ReturnType<typeof createShareKeyStoragePort>;

  beforeEach(() => {
    kit = makeVault();
    port = createShareKeyStoragePort(kit.vault, SCOPE);
  });

  it('密钥料落在 vault root key 之外的**兄弟槽**（同 origin，accountId 带 #share-keys 后缀）', async () => {
    await port.set(SHARE_KEY_STORAGE_PORTABLE_KEY, '{"version":1,"entries":[]}');
    const shareSlot = `https://sync.example.test\u0000account-1#share-keys`;
    expect(kit.slots.has(shareSlot)).toBe(true);
    // root key 那一格（原始 accountId）必须还是空的 —— 覆盖它就是覆盖 vault。
    expect(kit.slots.has(`https://sync.example.test\u0000account-1`)).toBe(false);
    expect(shareKeyStoreScope(SCOPE)).toEqual({ serverOrigin: SCOPE.serverOrigin, accountId: 'account-1#share-keys' });
  });

  it('get/set/remove 往返，键不存在如实返回 null（≠ 空串，core 靠这个区分"没存过"）', async () => {
    expect(await port.get(SHARE_KEY_STORAGE_PORTABLE_KEY)).toBeNull();
    await port.set(SHARE_KEY_STORAGE_PORTABLE_KEY, 'PAYLOAD');
    expect(await port.get(SHARE_KEY_STORAGE_PORTABLE_KEY)).toBe('PAYLOAD');
    await port.remove(SHARE_KEY_STORAGE_PORTABLE_KEY);
    expect(await port.get(SHARE_KEY_STORAGE_PORTABLE_KEY)).toBeNull();
  });

  it('remove 掉槽里最后一个键 ⇒ 整槽删除（不留一枚空映射挂着）', async () => {
    await port.set('a', '1');
    await port.set('b', '2');
    await port.remove('a');
    expect(kit.slots.size).toBe(1);
    expect(await port.get('b')).toBe('2');
    await port.remove('b');
    expect(kit.slots.size).toBe(0);
  });

  it('remove 不存在的键 ⇒ 幂等，不动槽', async () => {
    await port.set('a', '1');
    await port.remove('missing');
    expect(await port.get('a')).toBe('1');
  });

  it('坏槽（被别的写入方污染过）⇒ get 如实 null、下一次 set 整块覆盖（与 core 的坏 JSON ⇒ 空存储同形）', async () => {
    await kit.vault.save(shareKeyStoreScope(SCOPE), 'not-a-json-map');
    expect(await port.get(SHARE_KEY_STORAGE_PORTABLE_KEY)).toBeNull();
    await port.set(SHARE_KEY_STORAGE_PORTABLE_KEY, 'FRESH');
    expect(await port.get(SHARE_KEY_STORAGE_PORTABLE_KEY)).toBe('FRESH');
  });
});

describe('mobile share-key 端口 · 源码文本那半', () => {
  const src = () => stripComments(read('apps/mobile/src/lib/share-key-store.ts'));

  it('密钥料不落 device-prefs（sqlite 是普通盘，ADR-0062 的口径）', () => {
    expect(src()).not.toMatch(/device-prefs/);
  });

  it('判定本体不在外壳长出第二份：没有 priorKeys/信封/base64 的手活', () => {
    expect(src()).not.toMatch(/priorKeys|wrappedListKey|btoa|atob|Buffer/);
  });

  it('盘上键名只引用 app-host 那枚常量，本壳不抄字面量', () => {
    expect(src()).not.toMatch(/heyta\.share-keys\.v1/);
  });

  it('端口实现确实吃 vault-secure-storage 的既有 scope 惯例', () => {
    expect(src()).toMatch(/vault-secure-storage/);
    expect(src()).toMatch(/ShareKeyStoragePort/);
  });
});
