/**
 * share-key-store 可移植层的验收：**真实口令信封**（`createPasswordPayloadCipher`，
 * 真 AES-GCM——不是 mock 的 encrypt/decrypt 对）往返 listKey，端口用内存假实现注入。
 *
 * 每条判据都对应一种会静默丢数据/丢钥的形状；理由正文在
 * `packages/app-host/src/share-key-store.ts` 的文件头与函数注释里。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createPasswordPayloadCipher, createSharePayloadCipher } from '@heyta/sync-client';

import {
  SHARE_KEY_STORAGE_PORTABLE_KEY,
  base64ToBytesPortable,
  bytesToBase64Portable,
  deleteShareKeyPortable,
  getShareKeyEntryPortable,
  parseShareKeyStore,
  readShareOwnIdentityPortable,
  removeShareKeyFromStore,
  serializeShareKeyStore,
  storeShareIdentityPortable,
  unwrapShareIdentitySeedPortable,
  unwrapShareKeyRingPortable,
  unwrapShareListKeyPortable,
  wrapAndStoreShareKeyPortable,
  type ShareKeyStoragePort,
  type ShareKeyStoreShape,
} from '../src/share-key-store.js';

/** 内存假端口：与 localStorage 同形（一格一个字符串），但契约是异步的。 */
const makePort = () => {
  const map = new Map<string, string>();
  const port: ShareKeyStoragePort = {
    async get(key) { return map.has(key) ? (map.get(key) as string) : null; },
    async set(key, value) { void map.set(key, value); },
    async remove(key) { void map.delete(key); },
  };
  return { port, map };
};

const makeCipher = () => createPasswordPayloadCipher('verify-password-123');
const listKey = (fill: number) => new Uint8Array(32).fill(fill);
const rawOf = (map: Map<string, string>) => map.get(SHARE_KEY_STORAGE_PORTABLE_KEY) ?? '';

describe('share-key-store · 与 web 旧实现的字节兼容（升级不丢钥）', () => {
  it('盘上键名钉死为 web 那枚字面量', () => {
    expect(SHARE_KEY_STORAGE_PORTABLE_KEY).toBe('heyta.share-keys.v1');
  });

  it('web 序列化的串能被 portable 解析，portable 序列化的串能被 web 的读法解析（逐字节回写一致）', () => {
    // 这枚串是 HEAD 上 `apps/web/.../saveShareKeyStore` 会写出的形状（JSON.stringify({version, entries})）。
    const webSerialized = JSON.stringify({
      version: 1,
      entries: [{
        shareId: 's-legacy',
        keyEpoch: 2,
        wrappedListKey: 'ENVELOPE-A',
        priorKeys: [{ keyEpoch: 1, wrappedListKey: 'ENVELOPE-B' }],
        wrappedIdentitySeed: 'ENVELOPE-C',
        ownMemberId: 'mem-1',
      }],
    });
    const parsed = parseShareKeyStore(webSerialized);
    expect(parsed.entries[0]?.priorKeys).toEqual([{ keyEpoch: 1, wrappedListKey: 'ENVELOPE-B' }]);
    // 反向：portable 序列化回写必须与 web 那枚逐字节相同（不许多出/丢失字段、不许改键序）。
    expect(serializeShareKeyStore(parsed)).toBe(webSerialized);
  });

  it('坏 JSON / 坏版本 / entries 非数组 ⇒ 空存储（与 web 同形）', () => {
    expect(parseShareKeyStore(null).entries).toEqual([]);
    expect(parseShareKeyStore('not-json').entries).toEqual([]);
    expect(parseShareKeyStore(JSON.stringify({ version: 99, entries: [1] })).entries).toEqual([]);
  });

  it('base64 与 btoa/atob/Buffer 逐字节一致（含三种填充形状），且实现不碰平台件', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/share-key-store.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bbtoa\(|\batob\(|\bBuffer\b/);
    for (const len of [0, 1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 7 + len) % 256);
      const portable = bytesToBase64Portable(bytes);
      expect(portable).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytesPortable(portable))).toEqual(Array.from(bytes));
      // Node 的 atob/btoa 形状交叉（web 壳那两份 shim 用的就是它们）。
      expect(Array.from(base64ToBytesPortable(globalThis.btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')))))
        .toEqual(Array.from(bytes));
    }
    expect(() => base64ToBytesPortable('AAAA=')).toThrow();
    expect(() => base64ToBytesPortable('A!$E')).toThrow();
  });

  it('removeShareKeyFromStore 只按 shareId 剔除，不碰其余条目', () => {
    const store: ShareKeyStoreShape = {
      version: 1,
      entries: [
        { shareId: 'a', keyEpoch: 1, wrappedListKey: 'X' },
        { shareId: 'b', keyEpoch: 1, wrappedListKey: 'Y' },
      ],
    };
    expect(removeShareKeyFromStore(store, 'a').entries.map((e) => e.shareId)).toEqual(['b']);
  });
});

describe('share-key-store · 信封往返（真实口令信封）', () => {
  it('wrap → unwrap 往返还原同一把 listKey', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's1', listKey: listKey(7), keyEpoch: 1 });
    expect(await unwrapShareListKeyPortable({ port, cipher, shareId: 's1' })).toEqual(listKey(7));
  });

  it('落盘的是密文：存储里搜不到 listKey 的 base64', async () => {
    const { port, map } = makePort();
    await wrapAndStoreShareKeyPortable({ port, cipher: makeCipher(), shareId: 's1', listKey: listKey(7), keyEpoch: 1 });
    expect(rawOf(map)).not.toContain(Buffer.from(listKey(7)).toString('base64'));
  });

  it('错误口令（vault 未解锁的形状）⇒ 解不开 ⇒ undefined（如实显示需要解锁）', async () => {
    const { port } = makePort();
    await wrapAndStoreShareKeyPortable({
      port, cipher: createPasswordPayloadCipher('right-password'), shareId: 's1', listKey: listKey(7), keyEpoch: 1,
    });
    expect(await unwrapShareListKeyPortable({ port, cipher: makeCipher(), shareId: 's1' })).toBeUndefined();
  });

  it('storeShareIdentity → unwrapShareIdentitySeed 往返；ownMemberId 可读；readShareOwnIdentity 露出两对钥', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    const seed = new Uint8Array(32).fill(3);
    await storeShareIdentityPortable({ port, cipher, shareId: 's9', identitySeed: seed, ownMemberId: 'mem-42' });
    expect((await getShareKeyEntryPortable(port, 's9'))?.ownMemberId).toBe('mem-42');
    expect(await unwrapShareIdentitySeedPortable({ port, cipher, shareId: 's9' })).toEqual(seed);
    const identity = await readShareOwnIdentityPortable({ port, cipher, shareId: 's9' });
    expect(identity?.memberId).toBe('mem-42');
    expect(identity?.x25519SecretKey.length).toBe(32);
    expect(identity?.ed25519SecretKey.length).toBe(32);
    // 身份种子不明文落盘（这一条对 portable 层同样成立——信封是同一套）。
    expect((await getShareKeyEntryPortable(port, 's9'))?.wrappedIdentitySeed).not.toBe(bytesToBase64Portable(seed));
  });

  it('换钥收新 listKey 时不回传身份 ⇒ 旧身份被沿用；显式传新的照样覆盖', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    const seed = new Uint8Array(32).fill(3);
    await storeShareIdentityPortable({ port, cipher, shareId: 's9', identitySeed: seed, ownMemberId: 'mem-42' });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's9', listKey: listKey(5), keyEpoch: 2 });
    expect((await getShareKeyEntryPortable(port, 's9'))?.wrappedIdentitySeed).toBeDefined();
    expect(await unwrapShareIdentitySeedPortable({ port, cipher, shareId: 's9' })).toEqual(seed);
    expect((await getShareKeyEntryPortable(port, 's9'))?.ownMemberId).toBe('mem-42');
    await wrapAndStoreShareKeyPortable({
      port, cipher, shareId: 's9', listKey: listKey(6), keyEpoch: 3,
      identitySeed: new Uint8Array(32).fill(9), ownMemberId: 'mem-43',
    });
    expect((await getShareKeyEntryPortable(port, 's9'))?.ownMemberId).toBe('mem-43');
  });

  it('deleteShareKeyPortable 真落盘（离开清单后条目消失，而不是只改了内存）', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's1', listKey: listKey(7), keyEpoch: 1 });
    await deleteShareKeyPortable({ port, shareId: 's1' });
    expect(parseShareKeyStore(await port.get(SHARE_KEY_STORAGE_PORTABLE_KEY)).entries).toHaveLength(0);
    expect(await getShareKeyEntryPortable(port, 's1')).toBeUndefined();
  });
});

describe('share-key-store · collectPriorKeys 的三条判据（换钥不丢旧世代）', () => {
  it('① 同一世代重试 ⇒ 覆盖而不是攒出两条同号', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-dupe', listKey: listKey(1), keyEpoch: 1 });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-dupe', listKey: listKey(9), keyEpoch: 2 });
    // 重试同一代（PUT 半路失败后重跑）不该在账上留两条 epoch2。
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-dupe', listKey: listKey(9), keyEpoch: 2 });
    const ring = await unwrapShareKeyRingPortable({ port, cipher, shareId: 's-dupe' });
    expect(ring?.previous.map((k) => k.keyEpoch)).toEqual([1]);
    expect(() => createSharePayloadCipher(ring!)).not.toThrow();
  });

  it('② 与新当前世代同号的旧账条目被丢掉（否则建密码器撞号直接抛）', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-clash', listKey: listKey(1), keyEpoch: 1 });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-clash', listKey: listKey(2), keyEpoch: 2 });
    // 回到 epoch1（比如 owner 撤回了那次换钥）：账上那条同号的"旧账"必须消失。
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-clash', listKey: listKey(1), keyEpoch: 1 });
    const entry = await getShareKeyEntryPortable(port, 's-clash');
    expect(entry?.keyEpoch).toBe(1);
    expect(entry?.priorKeys?.map((p) => p.keyEpoch), '与新当前同号的 epoch1 旧条被丢，只剩 epoch2').toEqual([2]);
    const ring = await unwrapShareKeyRingPortable({ port, cipher, shareId: 's-clash' });
    expect(() => createSharePayloadCipher(ring!)).not.toThrow();
    expect(ring?.previous.map((k) => k.keyEpoch)).toEqual([2]);
  });

  it('③ 空信封不进账（入群窗口的空串占位是"没有钥"，不是一把旧钥）', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    await storeShareIdentityPortable({
      port, cipher, shareId: 's-empty', identitySeed: new Uint8Array(32).fill(4), ownMemberId: 'mem-7',
    });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-empty', listKey: listKey(1), keyEpoch: 1 });
    const entry = await getShareKeyEntryPortable(port, 's-empty');
    expect(entry?.priorKeys, '空信封没被当成旧世代记进账').toBeUndefined();
  });

  it('世代号从新到旧排（读的人一眼看得出当前是哪代）', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-sort', listKey: listKey(1), keyEpoch: 1 });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-sort', listKey: listKey(2), keyEpoch: 2 });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-sort', listKey: listKey(4), keyEpoch: 4 });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId: 's-sort', listKey: listKey(3), keyEpoch: 3 });
    const entry = await getShareKeyEntryPortable(port, 's-sort');
    expect(entry?.priorKeys?.map((p) => p.keyEpoch)).toEqual([4, 2, 1]);
  });
});

describe('share-key-store · 密钥环（换钥后的混合世代）', () => {
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

  it('🔴 换钥后两个世代的密文都还解得开；对照臂：只喂当前那把必须红 /epoch/i', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    const shareId = 's-ring';
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId, listKey: listKey(1), keyEpoch: 1 });
    const ringV1 = await unwrapShareKeyRingPortable({ port, cipher, shareId });
    expect(ringV1?.previous, '第一次入群时环里没有旧世代').toEqual([]);
    const oldPayload = await createSharePayloadCipher(ringV1!).encrypt('换钥之前写的那条', wireIdentity('op-old'));

    await wrapAndStoreShareKeyPortable({ port, cipher, shareId, listKey: listKey(2), keyEpoch: 2 });
    const ringV2 = await unwrapShareKeyRingPortable({ port, cipher, shareId });
    expect(ringV2?.current.keyEpoch).toBe(2);
    expect(ringV2?.previous.map((k) => k.keyEpoch), '旧世代留在环里而不是消失').toEqual([1]);

    const after = createSharePayloadCipher(ringV2!);
    expect(await after.decrypt(oldPayload, wireIdentity('op-old'))).toBe('换钥之前写的那条');

    const currentOnly = createSharePayloadCipher({ current: ringV2!.current });
    await expect(currentOnly.decrypt(oldPayload, wireIdentity('op-old'))).rejects.toThrow(/epoch/i);
  });

  it('连换两次 ⇒ 三代都在环里，盘上仍只有一条 shareId 条目', async () => {
    const { port, map } = makePort();
    const cipher = makeCipher();
    const shareId = 's-three';
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId, listKey: listKey(1), keyEpoch: 1 });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId, listKey: listKey(2), keyEpoch: 2 });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId, listKey: listKey(3), keyEpoch: 3 });
    const ring = await unwrapShareKeyRingPortable({ port, cipher, shareId });
    expect(ring?.current.keyEpoch).toBe(3);
    expect(ring?.previous.map((k) => k.keyEpoch).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(parseShareKeyStore(rawOf(map)).entries.filter((e) => e.shareId === shareId)).toHaveLength(1);
  });

  it('vault 换口令 ⇒ 整份环解不开（undefined），而不是"环里没有旧世代"这种半谎', async () => {
    const { port } = makePort();
    await wrapAndStoreShareKeyPortable({ port, cipher: makeCipher(), shareId: 's-lock', listKey: listKey(1), keyEpoch: 1 });
    await wrapAndStoreShareKeyPortable({ port, cipher: makeCipher(), shareId: 's-lock', listKey: listKey(2), keyEpoch: 2 });
    const wrong = createPasswordPayloadCipher('another-password-456');
    expect(await unwrapShareKeyRingPortable({ port, cipher: wrong, shareId: 's-lock' })).toBeUndefined();
  });

  it('🔴 旧世代里某一把解不开 ⇒ 只跳过它并保留其余（与"整份环解不开"分档）', async () => {
    const { port, map } = makePort();
    const cipher = makeCipher();
    const shareId = 's-partial';
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId, listKey: listKey(1), keyEpoch: 1 });
    await wrapAndStoreShareKeyPortable({ port, cipher, shareId, listKey: listKey(2), keyEpoch: 2 });
    // 篡改账上那条旧世代的信封（模拟 Keychain 被清过一格 / 记录被换）。
    const store = parseShareKeyStore(rawOf(map));
    (store.entries[0]!.priorKeys![0] as { wrappedListKey: string }).wrappedListKey = 'GARBAGED-BYTES';
    await port.set(SHARE_KEY_STORAGE_PORTABLE_KEY, serializeShareKeyStore(store));
    const ring = await unwrapShareKeyRingPortable({ port, cipher, shareId });
    expect(ring, '当前世代解得开 ⇒ 环不是 undefined').toBeDefined();
    expect(ring?.current.keyEpoch).toBe(2);
    expect(ring?.current.listKey).toEqual(listKey(2));
    expect(ring?.previous, '坏掉的那条被跳过而不是拖垮整份环').toEqual([]);
  });

  it('空信封条目（入群窗口）⇒ 环是 undefined，不是"当前世代是一把空钥"', async () => {
    const { port } = makePort();
    const cipher = makeCipher();
    await storeShareIdentityPortable({
      port, cipher, shareId: 's-pending', identitySeed: new Uint8Array(32).fill(4), ownMemberId: 'mem-7',
    });
    expect(await unwrapShareKeyRingPortable({ port, cipher, shareId: 's-pending' })).toBeUndefined();
    expect(await unwrapShareListKeyPortable({ port, cipher, shareId: 's-pending' })).toBeUndefined();
  });
});
