import { describe, expect, it } from 'vitest';

import { createSharePayloadCipher, type ShareSyncKey } from '../src/share-payload-cipher';
import type { SyncPayloadIdentity } from '../src/payload-cipher';

const SHARE_A = 'share-aaa';
const SHARE_B = 'share-bbb';
const listKey = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);
const keyAt = (epoch: number, fill: number): ShareSyncKey => ({
  shareId: SHARE_A,
  keyEpoch: epoch,
  listKey: listKey(fill),
});

const identity = (overrides: Partial<SyncPayloadIdentity> = {}): SyncPayloadIdentity => ({
  id: 'op-1',
  clientId: 'device-A1',
  actionType: 'edit task',
  opType: 'UPD',
  entityType: 'TASK',
  entityId: 'task-1',
  timestamp: 1_700_000_000_000,
  schemaVersion: 1,
  ...overrides,
});

describe('share payload cipher（薄委托层，格式 = sync-core record 信封）', () => {
  it('round-trips: encrypt with the current epoch, decrypt back the same payload', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    const payload = JSON.stringify({ title: 'hello 中文' });
    const stored = await cipher.encrypt(payload, identity());
    expect(await cipher.decrypt(stored, identity())).toBe(payload);
  });

  it('载荷即 record 信封：version 字节 + 明文世代头（自描述，rekey 过渡期选钥靠它）', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(3, 7) });
    const stored = await cipher.encrypt('x', identity());
    const raw = Buffer.from(stored, 'base64');
    expect(raw[0]).toBe(1); // SHARE_KEYS_FORMAT_VERSION
    expect(new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getFloat64(1, false)).toBe(3);
  });

  it('AAD binding: the same ciphertext decrypts only under the exact op identity', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    const stored = await cipher.encrypt('secret', identity());
    await expect(cipher.decrypt(stored, identity({ id: 'op-2' }))).rejects.toThrow();
    await expect(cipher.decrypt(stored, identity({ entityType: 'NOTE' }))).rejects.toThrow();
    await expect(cipher.decrypt(stored, identity({ timestamp: 1 }))).rejects.toThrow();
    const raw = Buffer.from(stored, 'base64');
    raw[raw.length - 1] ^= 0x01;
    await expect(cipher.decrypt(raw.toString('base64'), identity())).rejects.toThrow();
  });

  it('key domain: another list key or another share cannot read it', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    const stored = await cipher.encrypt('secret', identity());
    const otherList = createSharePayloadCipher({ current: keyAt(1, 8) });
    await expect(otherList.decrypt(stored, identity())).rejects.toThrow();
    const otherShare = createSharePayloadCipher({
      current: { shareId: SHARE_B, keyEpoch: 1, listKey: listKey(7) },
    });
    await expect(otherShare.decrypt(stored, identity())).rejects.toThrow();
  });

  it('rekey transition: old-epoch ops read via `previous`; without it the epoch is unavailable', async () => {
    const oldCipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    const legacyStored = await oldCipher.encrypt('before rekey', identity());
    const newCipher = createSharePayloadCipher({
      current: keyAt(2, 8),
      previous: [keyAt(1, 7)],
    });
    expect(await newCipher.decrypt(legacyStored, identity())).toBe('before rekey');
    const newStored = await newCipher.encrypt('after rekey', identity());
    await expect(oldCipher.decrypt(newStored, identity())).rejects.toThrow();
    const freshOnly = createSharePayloadCipher({ current: keyAt(2, 8) });
    await expect(freshOnly.decrypt(legacyStored, identity())).rejects.toThrow('Share key epoch unavailable');
  });

  it('reencrypt: 迁移到新世代后新钥可读、旧钥不可读，且逐字节幂等', async () => {
    const oldCipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    const from = identity({ id: 'op-m-1' });
    const stored = await oldCipher.encrypt('要迁移的内容', from);
    // 🔴 reencrypt 的 toListKey 必须就是新世代 cipher 的那把钥——第一版给了
    // 另一把随机钥，迁移副本连"自己的 cipher"都解不开（夹具自相矛盾）。
    const toKey = listKey(9);
    const newCipher = createSharePayloadCipher({
      current: { shareId: SHARE_A, keyEpoch: 2, listKey: toKey },
      previous: [keyAt(1, 7)],
    });
    const to = { identity: identity({ id: 'op-m-1' }), toListKey: toKey, toEpoch: 2 };
    const migrated1 = await newCipher.reencrypt(stored, from, to);
    const migrated2 = await newCipher.reencrypt(stored, from, to);
    // 确定性 IV：同输入逐字节相同（幂等可续传，AGENTS 规则 16）。
    expect(migrated2).toBe(migrated1);
    const opened = await newCipher.decrypt(migrated1, identity({ id: 'op-m-1' }));
    expect(opened).toBe('要迁移的内容');
    await expect(oldCipher.decrypt(migrated1, identity({ id: 'op-m-1' }))).rejects.toThrow();
  });

  it('configuration fails closed: duplicate epochs, bad key length, bad share id, bad epoch', () => {
    expect(() => createSharePayloadCipher({
      current: keyAt(1, 7), previous: [keyAt(1, 8)],
    })).toThrow('Duplicate share key epoch');
    expect(() => createSharePayloadCipher({
      current: { shareId: SHARE_A, keyEpoch: 1, listKey: new Uint8Array(16) },
    })).toThrow('Invalid share list key');
    expect(() => createSharePayloadCipher({
      current: { shareId: '', keyEpoch: 1, listKey: listKey(1) },
    })).toThrow('Invalid share id');
    expect(() => createSharePayloadCipher({
      current: { shareId: SHARE_A, keyEpoch: 0, listKey: listKey(1) },
    })).toThrow('Invalid share key epoch');
  });

  it('垃圾 base64 被拒（record 版本字节校验）', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    await expect(cipher.decrypt(Buffer.from('garbage').toString('base64'), identity()))
      .rejects.toThrow();
  });
});
