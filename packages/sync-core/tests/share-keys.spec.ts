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
  const message = (ciphertext: string) => buildShareOpSignatureMessage({
    opId: 'op-1', clientId: 'client-1', shareId: SHARE_A, keyEpoch: 1, ciphertext,
  });

  it('verifies a genuine signature and rejects tampering', () => {
    const author = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    const sig = signShareOperation(author.ed25519SecretKey, message('cipher-text-1'));
    expect(verifyShareOperationSignature(author.ed25519PublicKey, message('cipher-text-1'), sig)).toBe(true);
    // Anyone re-attaching a different ciphertext breaks the binding.
    expect(verifyShareOperationSignature(author.ed25519PublicKey, message('cipher-text-2'), sig)).toBe(false);
    // A forged "author" cannot produce a valid signature under the real author's key.
    const forger = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    expect(verifyShareOperationSignature(author.ed25519PublicKey, message('cipher-text-1'), signShareOperation(
      forger.ed25519SecretKey,
      message('cipher-text-1'),
    ))).toBe(false);
  });

  it('never throws on malformed inputs — verification only returns false', () => {
    const author = deriveShareIdentityKeyPair(generateShareIdentitySeed());
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      new Uint8Array(0),
      new Uint8Array(64),
    )).toBe(false);
    expect(verifyShareOperationSignature(
      author.ed25519PublicKey,
      message('x'),
      new Uint8Array([1, 2, 3]),
    )).toBe(false);
  });
});
