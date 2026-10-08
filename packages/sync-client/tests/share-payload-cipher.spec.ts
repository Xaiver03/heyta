import { describe, expect, it } from 'vitest';

import {
  createSharePayloadCipher,
  isSharePayloadTransportShape,
  type ShareSyncKey,
} from '../src/share-payload-cipher';
import type { SyncPayloadIdentity } from '../src/payload-cipher';

const SHARE_A = 'share-aaa';
const listKey = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

const keyAt = (epoch: number, fill: number): ShareSyncKey => ({
  shareId: SHARE_A,
  keyEpoch: epoch,
  listKey: listKey(fill),
});

const identity = (overrides: Partial<SyncPayloadIdentity> = {}): SyncPayloadIdentity => ({
  id: 'op-1',
  clientId: 'client-a',
  actionType: 'add task',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  timestamp: 1_700_000_000_000,
  schemaVersion: 1,
  ...overrides,
});

describe('share payload cipher', () => {
  it('round-trips: encrypt with the current epoch, decrypt back the same payload', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    const payload = JSON.stringify({ title: 'hello 中文' });
    const envelope = await cipher.encrypt(payload, identity());
    expect(await cipher.decrypt(envelope, identity())).toBe(payload);
  });

  it('envelope carries the share marker and the epoch in the clear header', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(3, 7) });
    const envelope = await cipher.encrypt('x', identity());
    expect(isSharePayloadTransportShape(envelope)).toBe(true);
    const raw = Buffer.from(envelope, 'base64');
    expect(raw.subarray(0, 15).toString('latin1')).toBe('heyta-share-op/');
    expect(raw[15]).toBe(1);
    // keyEpoch float64 BE at offset 16
    expect(new DataView(raw.buffer).getFloat64(16, false)).toBe(3);
    expect(isSharePayloadTransportShape('not-base64-!!!')).toBe(false);
    expect(isSharePayloadTransportShape(Buffer.from('heyta-vault-op/x').toString('base64'))).toBe(false);
  });

  it('AAD binding: the same ciphertext decrypts only under the exact op identity', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    const envelope = await cipher.encrypt('secret', identity());
    await expect(cipher.decrypt(envelope, identity({ id: 'op-2' }))).rejects.toThrow();
    await expect(cipher.decrypt(envelope, identity({ entityType: 'NOTE' }))).rejects.toThrow();
    await expect(cipher.decrypt(envelope, identity({ timestamp: 1 }))).rejects.toThrow();
    // 篡改一个密文字节同样必炸（GCM 认证）。
    const raw = Buffer.from(envelope, 'base64');
    raw[raw.length - 1] ^= 0x01;
    await expect(cipher.decrypt(raw.toString('base64'), identity())).rejects.toThrow();
  });

  it('key domain: another list key or another share cannot read it', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    const envelope = await cipher.encrypt('secret', identity());
    const otherList = createSharePayloadCipher({ current: keyAt(1, 8) });
    await expect(otherList.decrypt(envelope, identity())).rejects.toThrow();
    const otherShare = createSharePayloadCipher({
      current: { shareId: 'share-bbb', keyEpoch: 1, listKey: listKey(7) },
    });
    await expect(otherShare.decrypt(envelope, identity())).rejects.toThrow();
  });

  it('rekey transition: old-epoch ops read via `previous`; without it the epoch is unavailable', async () => {
    const oldCipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    const legacyEnvelope = await oldCipher.encrypt('before rekey', identity());
    const newCipher = createSharePayloadCipher({
      current: keyAt(2, 8),
      previous: [keyAt(1, 7)],
    });
    expect(await newCipher.decrypt(legacyEnvelope, identity())).toBe('before rekey');
    // 新写入用新世代，旧 cipher 读不了。
    const newEnvelope = await newCipher.encrypt('after rekey', identity());
    await expect(oldCipher.decrypt(newEnvelope, identity())).rejects.toThrow();
    // 不带 previous 的纯新世代 cipher：旧信封报世代不可用。
    const freshOnly = createSharePayloadCipher({ current: keyAt(2, 8) });
    await expect(freshOnly.decrypt(legacyEnvelope, identity())).rejects.toThrow('Share key epoch unavailable');
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

  it('non-share envelopes are refused, not mis-decoded', async () => {
    const cipher = createSharePayloadCipher({ current: keyAt(1, 7) });
    await expect(cipher.decrypt(Buffer.from('garbage').toString('base64'), identity()))
      .rejects.toThrow('Not a share operation envelope');
    // vault 信封也不是 share 信封。
    await expect(cipher.decrypt(Buffer.from('heyta-vault-op/abcdefgh').toString('base64'), identity()))
      .rejects.toThrow('Not a share operation envelope');
  });
});
