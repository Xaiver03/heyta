import { describe, expect, it } from 'vitest';
import {
  assertShareMemberKeyEnvelope,
  buildShareOpSignatureMessage,
  decryptShareRecord,
  deriveShareIdentityKeyPair,
  deriveShareOperationKey,
  encryptShareRecord,
  generateShareIdentitySeed,
  generateShareListKey,
  openListKeyEnvelope,
  planShareRekey,
  reencryptShareRecord,
  sealListKeyForRecipient,
  shareKeyFingerprint,
  signShareOperation,
  verifyShareOperationSignature,
} from '../src/share-keys';

const SHARE_A = 'share-aaa';
const SHARE_B = 'share-bbb';
// record 三件套（encrypt/decrypt/reencrypt）的全身份 AAD 所需的线上身份。
const mkIdentity = (id: string) => ({
  clientId: 'device-shared', actionType: 'edit task', opType: 'UPD',
  entityType: 'TASK', entityId: id, timestamp: 1_700_000_000_000, schemaVersion: 1,
});

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('share identity keys', () => {
  it('derives stable, purpose-separated key pairs from one seed', () => {
    const seed = generateShareIdentitySeed();
    const a = deriveShareIdentityKeyPair(seed);
    const b = deriveShareIdentityKeyPair(seed);
    expect(hex(a.ed25519PublicKey)).toBe(hex(b.ed25519PublicKey));
    expect(hex(a.x25519PublicKey)).toBe(hex(b.x25519PublicKey));
    // Ed25519 and X25519 sub-seeds are HKDF-separated: one seed must never
    // serve both curves.
    expect(hex(a.ed25519SecretKey)).not.toBe(hex(a.x25519SecretKey));
    expect(hex(a.ed25519PublicKey)).not.toBe(hex(a.x25519PublicKey));
  });

  it('different seeds give different keys (fixed-seed known answer)', () => {
    const fixedSeed = new Uint8Array(32).fill(7);
    const pair = deriveShareIdentityKeyPair(fixedSeed);
    // Known answer pins the HKDF derivation across dependency upgrades.
    expect(hex(pair.ed25519PublicKey)).toMatchSnapshot();
    expect(hex(pair.x25519PublicKey)).toMatchSnapshot();
    const other = deriveShareIdentityKeyPair(new Uint8Array(32).fill(8));
    expect(hex(other.ed25519PublicKey)).not.toBe(hex(pair.ed25519PublicKey));
  });

  it('rejects seeds that are not 32 bytes', () => {
    expect(() => deriveShareIdentityKeyPair(new Uint8Array(16))).toThrow();
    expect(() => deriveShareIdentityKeyPair(new Uint8Array(0))).toThrow();
  });
});

describe('share operation keys', () => {
  it('separates domains by share id and epoch', () => {
    const listKey = generateShareListKey();
    const k1 = deriveShareOperationKey(listKey, SHARE_A, 1);
    expect(hex(deriveShareOperationKey(listKey, SHARE_A, 1))).toBe(hex(k1));
    expect(hex(deriveShareOperationKey(listKey, SHARE_B, 1))).not.toBe(hex(k1));
    expect(hex(deriveShareOperationKey(listKey, SHARE_A, 2))).not.toBe(hex(k1));
  });
});

describe('member key envelopes', () => {
  const setup = async () => {
    const owner = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const alice = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const bob = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const listKey = generateShareListKey();
    return { owner, alice, bob, listKey };
  };

  it('round-trips: the recipient recovers the same list key', async () => {
    const { alice, listKey } = await setup();
    const envelope = await sealListKeyForRecipient({
      listKey,
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    const opened = await openListKeyEnvelope({
      envelope,
      recipientX25519SecretKey: alice.x25519SecretKey,
    });
    expect(hex(opened)).toBe(hex(listKey));
  });

  it('a different member cannot open it', async () => {
    const { alice, bob, listKey } = await setup();
    const envelope = await sealListKeyForRecipient({
      listKey,
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    await expect(openListKeyEnvelope({
      envelope,
      recipientX25519SecretKey: bob.x25519SecretKey,
    })).rejects.toThrow('not sealed for this recipient');
  });

  it('bindings fail closed: share id, epoch and ciphertext tampering all rejected', async () => {
    const { alice, listKey } = await setup();
    const envelope = await sealListKeyForRecipient({
      listKey,
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    // Replay to another share.
    await expect(openListKeyEnvelope({
      envelope: { ...envelope, shareId: SHARE_B },
      recipientX25519SecretKey: alice.x25519SecretKey,
    })).rejects.toThrow();
    // Replay to another epoch.
    await expect(openListKeyEnvelope({
      envelope: { ...envelope, keyEpoch: 2 },
      recipientX25519SecretKey: alice.x25519SecretKey,
    })).rejects.toThrow();
    // Flip a ciphertext byte (GCM auth).
    const raw = Buffer.from(envelope.ciphertext, 'base64');
    raw[raw.length - 1] ^= 0x01;
    await expect(openListKeyEnvelope({
      envelope: { ...envelope, ciphertext: raw.toString('base64') },
      recipientX25519SecretKey: alice.x25519SecretKey,
    })).rejects.toThrow();
  });

  it('carries no plaintext key material on its JSON surface', async () => {
    const { alice, listKey } = await setup();
    const envelope = await sealListKeyForRecipient({
      listKey,
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    assertShareMemberKeyEnvelope(envelope);
    const surface = JSON.stringify(envelope);
    expect(surface).not.toContain(Buffer.from(listKey).toString('base64'));
    expect(surface).not.toContain(hex(listKey));
  });
});

describe('rekey', () => {
  it('produces epoch+1 envelopes that each remaining member can open to the same new key', async () => {
    const alice = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const bob = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const plan = await planShareRekey({
      shareId: SHARE_A,
      fromEpoch: 1,
      remainingMemberX25519PublicKeys: [alice.x25519PublicKey, bob.x25519PublicKey],
    });
    expect(plan.toEpoch).toBe(2);
    expect(plan.envelopes).toHaveLength(2);
    const aliceKey = await openListKeyEnvelope({
      envelope: plan.envelopes[0]!,
      recipientX25519SecretKey: alice.x25519SecretKey,
    });
    const bobKey = await openListKeyEnvelope({
      envelope: plan.envelopes[1]!,
      recipientX25519SecretKey: bob.x25519SecretKey,
    });
    expect(hex(aliceKey)).toBe(hex(plan.newListKey));
    expect(hex(bobKey)).toBe(hex(plan.newListKey));
    // The removed member (not in the remaining list) has no epoch-2 envelope;
    // their epoch-1 envelope cannot be replayed as epoch 2.
    const stale = await sealListKeyForRecipient({
      listKey: generateShareListKey(),
      shareId: SHARE_A,
      keyEpoch: 1,
      recipientX25519PublicKey: alice.x25519PublicKey,
    });
    await expect(openListKeyEnvelope({
      envelope: { ...stale, keyEpoch: plan.toEpoch },
      recipientX25519SecretKey: alice.x25519SecretKey,
    })).rejects.toThrow();
  });

  it('refuses to rekey to an empty membership', async () => {
    await expect(planShareRekey({
      shareId: SHARE_A,
      fromEpoch: 1,
      remainingMemberX25519PublicKeys: [],
    })).rejects.toThrow('at least one remaining member');
  });
});

describe('history re-encryption', () => {
  const makeRecord = async (listKey: Uint8Array, id: string, epoch: number, body = 'task payload 中文') =>
    encryptShareRecord({
      id,
      plaintext: new TextEncoder().encode(body),
      shareId: SHARE_A,
      listKey,
      keyEpoch: epoch,
      identity: mkIdentity(id),
    });

  it('re-encrypts to the new epoch and the old key stops reading it', async () => {
    const oldListKey = generateShareListKey();
    const newListKey = generateShareListKey();
    const record = await makeRecord(oldListKey, 'op-1', 1);
    const migrated = await reencryptShareRecord({
      record,
      shareId: SHARE_A,
      fromListKey: oldListKey,
      toListKey: newListKey,
      toEpoch: 2,
      identity: mkIdentity('op-1'),
    });
    expect(migrated.keyEpoch).toBe(2);
    expect(migrated.ciphertext).not.toBe(record.ciphertext);
    const opened = new TextDecoder().decode(await decryptShareRecord({
      record: migrated,
      shareId: SHARE_A,
      listKey: newListKey,
      identity: mkIdentity('op-1'),
    }));
    expect(opened).toBe('task payload 中文');
    // Old list key must not read new-epoch data.
    await expect(decryptShareRecord({
      record: migrated,
      shareId: SHARE_A,
      listKey: oldListKey,
      identity: mkIdentity('op-1'),
    })).rejects.toThrow();
    // Wrong share binding must fail too.
    await expect(decryptShareRecord({
      record: migrated,
      shareId: SHARE_B,
      listKey: newListKey,
      identity: mkIdentity('op-1'),
    })).rejects.toThrow();
  });

  it('is idempotent: re-running a chunk yields byte-identical ciphertext', async () => {
    const oldListKey = generateShareListKey();
    const newListKey = generateShareListKey();
    const record = await makeRecord(oldListKey, 'op-2', 1);
    const first = await reencryptShareRecord({
      record, shareId: SHARE_A, fromListKey: oldListKey, toListKey: newListKey, toEpoch: 2,
      identity: mkIdentity('op-2'),
    });
    const second = await reencryptShareRecord({
      record, shareId: SHARE_A, fromListKey: oldListKey, toListKey: newListKey, toEpoch: 2,
      identity: mkIdentity('op-2'),
    });
    expect(second.ciphertext).toBe(first.ciphertext);
    // Re-running on an already-migrated record is a no-op.
    const third = await reencryptShareRecord({
      record: first, shareId: SHARE_A, fromListKey: oldListKey, toListKey: newListKey, toEpoch: 2,
      identity: mkIdentity('op-2'),
    });
    expect(third.ciphertext).toBe(first.ciphertext);
    // Interrupted-migration resume: different record ids still diverge (unique IVs).
    const other = await makeRecord(oldListKey, 'op-3', 1);
    const migratedOther = await reencryptShareRecord({
      record: other, shareId: SHARE_A, fromListKey: oldListKey, toListKey: newListKey, toEpoch: 2,
      identity: mkIdentity('op-3'),
    });
    expect(migratedOther.ciphertext).not.toBe(first.ciphertext);
  });

  it('fails closed on wrong from-key', async () => {
    const listKey = generateShareListKey();
    const wrongKey = generateShareListKey();
    const record = await makeRecord(listKey, 'op-4', 1);
    await expect(reencryptShareRecord({
      record, shareId: SHARE_A, fromListKey: wrongKey, toListKey: generateShareListKey(), toEpoch: 2,
      identity: mkIdentity('op-4'),
    })).rejects.toThrow();
  });
});

describe('op signatures', () => {
  // 签名域 = 服务端能看见、读侧会据以判定的一切字段（除 serverSeq / receivedAt）。
  // 见 ADR-0069 裁决三：vectorClock 今天不被任何完整性机制绑住，而并发判定读的就是它。
  const baseParts = {
    opId: 'op-1',
    clientId: 'client-1',
    shareId: SHARE_A,
    keyEpoch: 1,
    actionType: 'edit task',
    opType: 'UPD',
    entityType: 'TASK',
    entityId: 'task-1',
    entityIds: ['task-1', 'task-2'],
    schemaVersion: 7,
    clientTimestamp: 1_700_000_000_000,
    vectorClock: { 'client-1': 3, 'client-2': 1 },
    ciphertext: 'cipher-text-1',
  };
  const message = (parts: Partial<typeof baseParts> = {}) =>
    buildShareOpSignatureMessage({ ...baseParts, ...parts });
  const author = deriveShareIdentityKeyPair(generateShareIdentitySeed());
  const signOn = (parts: Partial<typeof baseParts> = {}): Uint8Array =>
    signShareOperation(author.ed25519SecretKey, message(parts));
  const verifiesOn = (parts: Partial<typeof baseParts> = {}): boolean =>
    verifyShareOperationSignature(author.ed25519PublicKey, message(parts), signOn());

  it('a genuine signature verifies over the full field set', () => {
    expect(verifiesOn()).toBe(true);
  });

  // 🔴 一枚字段一条用例：一条用例里塞十二个断言，坏掉的那一枚就没人知道是哪一枚。
  const tamperTable: Array<[string, Partial<typeof baseParts>]> = [
    ['opId', { opId: 'op-2' }],
    ['clientId', { clientId: 'client-9' }],
    ['shareId', { shareId: SHARE_B }],
    ['keyEpoch', { keyEpoch: 2 }],
    ['actionType', { actionType: 'delete task' }],
    ['opType', { opType: 'DEL' }],
    ['entityType', { entityType: 'NOTE' }],
    ['entityId', { entityId: 'task-2' }],
    ['entityIds', { entityIds: ['task-1', 'task-3'] }],
    ['schemaVersion', { schemaVersion: 8 }],
    ['clientTimestamp', { clientTimestamp: 1_700_000_000_001 }],
    ['vectorClock', { vectorClock: { 'client-1': 4, 'client-2': 1 } }],
    ['ciphertext', { ciphertext: 'cipher-text-2' }],
  ];

  it.each(tamperTable)('rejects a one-field rewrite of %s', (_field, parts) => {
    expect(verifiesOn(parts)).toBe(false);
  });

  it('binds the causal clock, so a rewritten vectorClock cannot fake an ordering', () => {
    // 这一枚是 ADR-0069 裁决三存在的全部理由：不签它，服务端就能把两条并发伪装成有先后。
    expect(verifiesOn({ vectorClock: { 'client-1': 3 } })).toBe(false);
    expect(verifiesOn({ vectorClock: { 'client-1': 3, 'client-2': 1, 'client-3': 0 } })).toBe(false);
  });

  it('is stable under jsonb key reordering — the same clock must not read as tampering', () => {
    // `vector_clock` 在服务端是 jsonb：它不保留键序。签名方与验签方各自 stringify 一份
    // 逻辑上相同的时钟若拿到不同字节，每一台非签名者的设备都会把这枚合法签名读成失败。
    const reordered = { 'client-2': 1, 'client-1': 3 };
    expect(hex(message({ vectorClock: reordered }))).toBe(hex(message()));
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      message({ vectorClock: reordered }),
      signOn(),
    )).toBe(true);
  });

  it('treats entityIds as a set: order is not load-bearing, membership is', () => {
    expect(hex(message({ entityIds: ['task-2', 'task-1'] }))).toBe(hex(message()));
    expect(verifiesOn({ entityIds: ['task-2'] })).toBe(false);
  });

  it('normalises absent metadata to null, so omitting a field cannot fork the message', () => {
    // 缺省与显式 null 必须同形，否则"这一枚没传"与"这一枚是 null"会签出两个不同的域。
    const withoutOptionals = buildShareOpSignatureMessage({
      opId: baseParts.opId, clientId: baseParts.clientId, shareId: baseParts.shareId,
      keyEpoch: baseParts.keyEpoch, ciphertext: baseParts.ciphertext,
    });
    const withNulls = buildShareOpSignatureMessage({
      ...baseParts,
      actionType: null, opType: null, entityType: null, entityId: null,
      entityIds: null, schemaVersion: null, clientTimestamp: null, vectorClock: null,
    });
    expect(hex(withoutOptionals)).toBe(hex(withNulls));
  });

  it('fails loudly on values JSON would silently rewrite, instead of signing a different message', () => {
    expect(() => message({ clientTimestamp: 1n as unknown as number })).toThrow(
      'Invalid share op signature clientTimestamp',
    );
    expect(() => message({ clientTimestamp: Number.NaN })).toThrow(
      'Invalid share op signature clientTimestamp',
    );
    expect(() => message({ vectorClock: { a: 1n } })).toThrow('Invalid share op signature value');
    expect(() => message({ vectorClock: { a: Number.POSITIVE_INFINITY } })).toThrow(
      'Invalid share op signature value',
    );
    expect(() => message({ entityIds: ['task-1', ''] })).toThrow(
      'Invalid share op signature entityIds',
    );
    expect(() => message({ schemaVersion: 0 })).toThrow('Invalid share op signature schemaVersion');
  });

  it('rejects a signature forged under another member key', () => {
    const forger = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      message(),
      signShareOperation(forger.ed25519SecretKey, message()),
    )).toBe(false);
  });

  it('never throws on malformed inputs — verification only returns false', () => {
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      new Uint8Array(0),
      new Uint8Array(64),
    )).toBe(false);
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      message(),
      new Uint8Array([1, 2, 3]),
    )).toBe(false);
  });
});
