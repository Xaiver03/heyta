import { describe, expect, it } from 'vitest';

import { createPasswordPayloadCipher } from '@heyta/sync-client';

import {
  loadShareKeyStore,
  removeShareKey,
  unwrapShareListKey,
  wrapAndStoreShareKey,
} from '../src/features/share/share-key-store';

/**
 * share-key-store 的验收：**真实口令信封**（`createPasswordPayloadCipher`，
 * 真 AES-GCM——不是 mock 的 encrypt/decrypt 对）往返 listKey。
 *
 * 存储用内存替身实现 Storage 接口（map + JSON 序列化与 localStorage 同形）。
 */
const makeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
};

const makeCipher = () => createPasswordPayloadCipher('verify-password-123');

const listKey = (fill: number) => new Uint8Array(32).fill(fill);

describe('share-key-store', () => {
  it('wrap → unwrap 往返还原同一把 listKey（真实口令信封）', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    await wrapAndStoreShareKey({ storage, cipher, shareId: 's1', listKey: listKey(7), keyEpoch: 1 });
    const opened = await unwrapShareListKey({ storage, cipher, shareId: 's1' });
    expect(opened).toEqual(listKey(7));
  });

  it('落盘的是密文：localStorage 里搜不到 listKey 的 base64', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    await wrapAndStoreShareKey({ storage, cipher, shareId: 's1', listKey: listKey(7), keyEpoch: 1 });
    const onDisk = storage._map.get('heyta.share-keys.v1') ?? '';
    expect(onDisk).not.toContain(Buffer.from(listKey(7)).toString('base64'));
  });

  it('换钥（rekey）= 同 shareId 覆盖世代与信封，不出现第二条', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    await wrapAndStoreShareKey({ storage, cipher, shareId: 's1', listKey: listKey(7), keyEpoch: 1 });
    await wrapAndStoreShareKey({ storage, cipher, shareId: 's1', listKey: listKey(8), keyEpoch: 2 });
    const store = loadShareKeyStore(storage);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].keyEpoch).toBe(2);
    const opened = await unwrapShareListKey({ storage, cipher, shareId: 's1' });
    expect(opened).toEqual(listKey(8));
  });

  it('错误口令（vault 未解锁的形状）⇒ 解不开 ⇒ undefined（如实显示需要解锁）', async () => {
    const storage = makeStorage();
    await wrapAndStoreShareKey({
      storage, cipher: createPasswordPayloadCipher('right-password'), shareId: 's1',
      listKey: listKey(7), keyEpoch: 1,
    });
    const wrongSession = makeCipher(); // 不同口令 = 不同 sync 钥
    const opened = await unwrapShareListKey({ storage, cipher: wrongSession, shareId: 's1' });
    expect(opened).toBeUndefined();
  });

  it('removeShareKey 剔除一条；坏 JSON/坏版本按空存储处理', () => {
    const storage = makeStorage();
    const store = loadShareKeyStore(storage);
    const afterRemove = removeShareKey(store, 's1');
    expect(afterRemove.entries).toHaveLength(0);
    storage._map.set('heyta.share-keys.v1', 'not-json');
    expect(loadShareKeyStore(storage).entries).toHaveLength(0);
    storage._map.set('heyta.share-keys.v1', JSON.stringify({ version: 99, entries: [1] }));
    expect(loadShareKeyStore(storage).entries).toHaveLength(0);
  });
});
