import { describe, expect, it } from 'vitest';

import { emptyShareLogState } from '@heyta/app-host';
import { createPasswordPayloadCipher, createSharePayloadCipher } from '@heyta/sync-client';

import {
  deleteShareKey,
  getShareKeyEntry,
  loadShareKeyStore,
  removeShareKey,
  storeShareIdentity,
  unwrapShareIdentitySeed,
  unwrapShareKeyRing,
  unwrapShareListKey,
  wrapAndStoreShareKey,
} from '../src/features/share/share-key-store';
import { clearStorageShareLog, createStorageShareLog } from '../src/features/share/comment-actions';

/**
 * share-key-store 的验收：**真实口令信封**（`createPasswordPayloadCipher`，
 * 真 AES-GCM——不是 mock 的 encrypt/decrypt 对）往返 listKey。
 *
 * 存储用内存替身实现 Storage 接口（map + JSON 序列化与 localStorage 同形）。
 */
const makeStorage = () => {
  const map = new Map<string, string>();
  return {
    // DOM Storage 的完整形状（typecheck 对齐浏览器类型，不只是本文件用到的三个方法）。
    get length() { return map.size; },
    clear: () => void map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  } as Storage & { _map: Map<string, string> };
};

const makeCipher = () => createPasswordPayloadCipher('verify-password-123');

/** 盘上这一条 share 的条目（换钥不该在同一 shareId 下攒出第二条）。 */
const entriesOf = (storage: Storage, shareId: string) =>
  loadShareKeyStore(storage).entries.filter((e) => e.shareId === shareId);

const listKey = (fill: number) => new Uint8Array(32).fill(fill);

describe('share-key-store · 身份种子与 memberId（W4 接线）', () => {
  const seed = new Uint8Array(32).fill(3);

  it('storeShareIdentity → unwrapShareIdentitySeed 往返；ownMemberId 可读', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    await storeShareIdentity({ storage, cipher, shareId: 's9', identitySeed: seed, ownMemberId: 'mem-42' });
    expect(getShareKeyEntry(storage, 's9')?.ownMemberId).toBe('mem-42');
    expect(await unwrapShareIdentitySeed({ storage, cipher, shareId: 's9' })).toEqual(seed);
  });

  it('身份种子不明文落盘（密文信封，不是 base64 裸放）', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    await storeShareIdentity({ storage, cipher, shareId: 's9', identitySeed: seed, ownMemberId: 'mem-42' });
    const onDisk = storage._map.get('heyta.share-keys.v1') ?? '';
    expect(onDisk).not.toContain('AAAAB');
  });

  it('wrong口令解不开身份种子 ⇒ undefined（如实显示需要解锁，不抛）', async () => {
    const storage = makeStorage();
    await storeShareIdentity({ storage, cipher: makeCipher(), shareId: 's9', identitySeed: seed, ownMemberId: 'mem-42' });
    const wrongCipher = createPasswordPayloadCipher('another-password-456');
    expect(await unwrapShareIdentitySeed({ storage, cipher: wrongCipher, shareId: 's9' })).toBeUndefined();
  });

  it('换钥收新 listKey 时**不回传**身份种子 ⇒ 旧身份被沿用（M3 把这条坑收进函数里）', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    await storeShareIdentity({ storage, cipher, shareId: 's9', identitySeed: seed, ownMemberId: 'mem-42' });
    // 换钥只交"世代 + 新钥"，不带身份——抹掉身份种子等于这台设备再也解不开新信封，
    // 所以保留旧值是唯一不丢东西的做法（旧的形状是"调用方必须记得回填"，靠记性保命）。
    await wrapAndStoreShareKey({ storage, cipher, shareId: 's9', listKey: listKey(5), keyEpoch: 2 });
    expect(getShareKeyEntry(storage, 's9')?.wrappedIdentitySeed).toBeDefined();
    expect(await unwrapShareIdentitySeed({ storage, cipher, shareId: 's9' })).toEqual(seed);
    expect(getShareKeyEntry(storage, 's9')?.ownMemberId).toBe('mem-42');
    // 显式传新的照样覆盖（换设备重新入群那条路）。
    await wrapAndStoreShareKey({ storage, cipher, shareId: 's9', listKey: listKey(6), keyEpoch: 3, identitySeed: new Uint8Array(32).fill(9), ownMemberId: 'mem-43' });
    expect(getShareKeyEntry(storage, 's9')?.ownMemberId).toBe('mem-43');
  });

  it('deleteShareKey 真落盘（离开清单后条目消失，而不是只改了内存）', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    await wrapAndStoreShareKey({ storage, cipher, shareId: 's1', listKey: listKey(7), keyEpoch: 1 });
    deleteShareKey(storage, 's1');
    expect(loadShareKeyStore(storage).entries).toHaveLength(0);
    expect(getShareKeyEntry(storage, 's1')).toBeUndefined();
  });
});

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
    expect(store.entries[0]!.keyEpoch).toBe(2);
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

describe('share 密钥环 · 换钥后的混合世代（M3）', () => {
  const wireIdentity = (id: string) => ({
    id,
    clientId: 'device-A',
    actionType: 'add comment',
    opType: 'CRT' as const,
    entityType: 'COMMENT',
    entityId: 'c-1',
    timestamp: 1_700_000_000_000,
    schemaVersion: 1,
  });

  it('🔴 换钥后**两个世代的密文都还解得开**（只喂当前那把 = 评论区整块卡死）', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    const shareId = 's-ring';
    await wrapAndStoreShareKey({ storage, cipher, shareId, listKey: listKey(1), keyEpoch: 1 });

    // epoch1 写的一条评论。
    const ringV1 = await unwrapShareKeyRing({ storage, cipher, shareId });
    expect(ringV1?.previous, '第一次入群时环里没有旧世代').toEqual([]);
    const oldPayload = await createSharePayloadCipher(ringV1!).encrypt('换钥之前写的那条', wireIdentity('op-old'));

    // 换钥到 epoch2。
    await wrapAndStoreShareKey({ storage, cipher, shareId, listKey: listKey(2), keyEpoch: 2 });
    const ringV2 = await unwrapShareKeyRing({ storage, cipher, shareId });
    expect(ringV2?.current.keyEpoch, '当前是那把新钥').toBe(2);
    expect(ringV2?.previous.map((k) => k.keyEpoch), '旧世代留在环里而不是消失').toEqual([1]);

    const after = createSharePayloadCipher(ringV2!);
    expect(await after.decrypt(oldPayload, wireIdentity('op-old')), '换钥之后旧评论必须还读得回').toBe('换钥之前写的那条');
    const newPayload = await after.encrypt('换钥之后写的那条', wireIdentity('op-new'));
    expect(await after.decrypt(newPayload, wireIdentity('op-new'))).toBe('换钥之后写的那条');

    // 对照：只喂当前那把（换钥之前的写法）——旧载荷必须解不开，这就是那条卡死的来源。
    const currentOnly = createSharePayloadCipher({ current: ringV2!.current });
    await expect(currentOnly.decrypt(oldPayload, wireIdentity('op-old'))).rejects.toThrow(/epoch/i);
  });

  it('连换两次 ⇒ 三代都在环里（日志是追加模型，epoch1 的评论还躺在库里）', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    const shareId = 's-three';
    await wrapAndStoreShareKey({ storage, cipher, shareId, listKey: listKey(1), keyEpoch: 1 });
    await wrapAndStoreShareKey({ storage, cipher, shareId, listKey: listKey(2), keyEpoch: 2 });
    await wrapAndStoreShareKey({ storage, cipher, shareId, listKey: listKey(3), keyEpoch: 3 });
    const ring = await unwrapShareKeyRing({ storage, cipher, shareId });
    expect(ring?.current.keyEpoch).toBe(3);
    expect(ring?.previous.map((k) => k.keyEpoch).sort((a, b) => a - b), '1 与 2 都还在').toEqual([1, 2]);
    expect(entriesOf(storage, shareId), '盘上仍然只有一条（换钥不新增 share 条目）').toHaveLength(1);
  });

  it('同一世代重复写 ⇒ 覆盖而不是攒出两条同号（建密码器对重复世代是直接抛错）', async () => {
    const storage = makeStorage();
    const cipher = makeCipher();
    const shareId = 's-dupe';
    await wrapAndStoreShareKey({ storage, cipher, shareId, listKey: listKey(1), keyEpoch: 1 });
    await wrapAndStoreShareKey({ storage, cipher, shareId, listKey: listKey(9), keyEpoch: 2 });
    // 重试同一代（比如 PUT 半路失败后重跑）不该在账上留两条 epoch2。
    await wrapAndStoreShareKey({ storage, cipher, shareId, listKey: listKey(9), keyEpoch: 2 });
    const ring = await unwrapShareKeyRing({ storage, cipher, shareId });
    expect(ring?.previous.map((k) => k.keyEpoch), '旧世代只剩 epoch1').toEqual([1]);
    expect(() => createSharePayloadCipher(ring!)).not.toThrow();
  });

  it('vault 换口令 ⇒ 环整块解不开（undefined），而不是"环里没有旧世代"这种半谎', async () => {
    const storage = makeStorage();
    await wrapAndStoreShareKey({ storage, cipher: makeCipher(), shareId: 's-lock', listKey: listKey(1), keyEpoch: 1 });
    await wrapAndStoreShareKey({ storage, cipher: makeCipher(), shareId: 's-lock', listKey: listKey(2), keyEpoch: 2 });
    const wrong = createPasswordPayloadCipher('another-password-456');
    expect(await unwrapShareKeyRing({ storage, cipher: wrong, shareId: 's-lock' })).toBeUndefined();
  });

  it('clearStorageShareLog 把日志、游标与索引那一格一起清掉（离场只清一半 = 别人的评论还读得到）', () => {
    const storage = makeStorage();
    const log = createStorageShareLog(storage);
    log.save('s-out', emptyShareLogState());
    log.setCursor('s-out', 42);
    expect(log.list()).toContain('s-out');
    clearStorageShareLog(storage, 's-out');
    expect(log.load('s-out'), '日志没了').toBeUndefined();
    expect(log.cursor('s-out'), '游标退到 0').toBe(0);
    expect(log.list(), '索引里那一格也没了').not.toContain('s-out');
  });
});
