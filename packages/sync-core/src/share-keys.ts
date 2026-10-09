/**
 * Shared-list key distribution primitives (ADR-0062).
 *
 * Pure functions only: identity key derivation, list-key domain separation,
 * member envelopes, rekey planning and idempotent history re-encryption.
 * Transport, storage and the server protocol live in packages/sync-client and
 * server/ — this module stays host-agnostic like the rest of sync-core.
 *
 * Cryptographic shape:
 * - One 32-byte identity seed per user (wrapped by the vault root key, never
 *   synced plaintext). Ed25519 (op signatures, "who changed this") and X25519
 *   (envelope encryption) sub-seeds are HKDF-separated from it: one seed must
 *   never serve both purposes.
 * - Each shared list has a random 256-bit listKey, versioned by keyEpoch.
 *   Operation keys are HKDF(listKey, shareId, keyEpoch) so a key captured in
 *   one share or epoch does not decrypt another.
 * - Member envelopes seal the listKey to a member's X25519 public key with an
 *   AAD binding on (shareId, keyEpoch, recipient fingerprint): an envelope
 *   captured for one share/epoch/recipient cannot be replayed elsewhere.
 * - Rekey = fresh listKey + fresh envelopes + deterministic-IV re-encryption
 *   of history. The deterministic IV makes re-running a migration chunk
 *   byte-identical, so interrupted migrations can be compared and resumed
 *   (AGENTS 规则 16: random nonces would make replayed requests unverifiable).
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  aesDecrypt,
  aesEncrypt,
  decodeBase64,
  encodeBase64,
  getRandomBytes,
  getTextEncoder,
  IV_LENGTH,
  KEY_LENGTH,
} from './encryption/web-crypto';

export const SHARE_KEYS_FORMAT_VERSION = 1 as const;
export const SHARE_IDENTITY_SEED_LENGTH = 32;
export const SHARE_LIST_KEY_LENGTH = 32;

export interface ShareIdentityKeyPair {
  /** Signing key pair (Ed25519). Secret side is the 32-byte seed. */
  ed25519PublicKey: Uint8Array;
  ed25519SecretKey: Uint8Array;
  /** Envelope key pair (X25519). Secret side is clamped on use. */
  x25519PublicKey: Uint8Array;
  x25519SecretKey: Uint8Array;
}

export interface ShareMemberKeyEnvelope {
  formatVersion: typeof SHARE_KEYS_FORMAT_VERSION;
  shareId: string;
  keyEpoch: number;
  /** sha256 hex of the recipient X25519 public key — who may open this. */
  recipientFingerprint: string;
  /** sha256 hex of the ephemeral sealing key — bound into the AAD. */
  ephemeralFingerprint: string;
  /** base64 ephemeral X25519 public key (ECIES: needed to derive the KEK). */
  ephemeralPublicKey: string;
  iv: string;
  ciphertext: string;
}

export interface ShareEncryptedRecord {
  id: string;
  /**
   * 写入时的清单密钥世代。🔴 世代**同时**编码在信封头里（自描述）：
   * 解密方从信封头取世代选钥，本字段用于调用方显式对账
   * （例如成员端断言"我拿到的信封世代 = share 当前世代"）。
   */
  keyEpoch: number;
  /** base64 envelope: version byte + keyEpoch(float64 BE) + IV + AES-GCM body。 */
  ciphertext: string;
}

/** 线上 op 身份（除 op id 外的全部字段）——record 迁移与 wire 层共用的那一份。 */
export interface ShareRecordIdentity {
  clientId: string;
  actionType: string;
  opType: string;
  entityType: string;
  entityId?: string;
  entityIds?: string[];
  timestamp: number;
  schemaVersion: number;
}

export interface ShareRekeyPlan {
  shareId: string;
  fromEpoch: number;
  toEpoch: number;
  newListKey: Uint8Array;
  envelopes: ShareMemberKeyEnvelope[];
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertSafeEpoch: (value: unknown) => asserts value is number = (value) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid share key epoch');
  }
};

const assertShareId: (value: unknown) => asserts value is string = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('Invalid share id');
  }
};

const assertListKey = (value: Uint8Array): void => {
  if (value.length !== SHARE_LIST_KEY_LENGTH) throw new Error('Invalid share list key');
};

const assertX25519PublicKey = (value: Uint8Array): void => {
  if (value.length !== KEY_LENGTH) throw new Error('Invalid X25519 public key');
};

const assertX25519SecretKey = (value: Uint8Array): void => {
  if (value.length !== KEY_LENGTH) throw new Error('Invalid X25519 secret key');
};

const assertEd25519SecretKey = (value: Uint8Array): void => {
  if (value.length !== KEY_LENGTH) throw new Error('Invalid Ed25519 secret key');
};

const assertBytes32 = (value: Uint8Array, label: string): void => {
  if (value.length !== KEY_LENGTH) throw new Error(`Invalid ${label}`);
};

const decodeStrictBase64 = (value: unknown, label: string): Uint8Array => {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  try {
    const bytes = new Uint8Array(decodeBase64(value));
    // Reject non-canonical encodings accepted by permissive atob implementations.
    if (encodeBase64(bytes) !== value) throw new Error(`Invalid ${label}`);
    return bytes;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
};

/** sha256 hex fingerprint of a public key (house style: 64 lowercase hex chars). */
export const shareKeyFingerprint = (publicKey: Uint8Array): string => {
  assertX25519PublicKey(publicKey);
  return Array.from(sha256(publicKey), (b) => b.toString(16).padStart(2, '0')).join('');
};

const envelopeInfo = (
  shareId: string,
  keyEpoch: number,
  recipientFingerprint: string,
  ephemeralFingerprint: string,
): Uint8Array =>
  getTextEncoder().encode(JSON.stringify([
    'heyta:share-key-envelope',
    SHARE_KEYS_FORMAT_VERSION,
    shareId,
    keyEpoch,
    recipientFingerprint,
    ephemeralFingerprint,
  ]));

const envelopeAad = envelopeInfo;

const opRecordAad = (
  shareId: string,
  keyEpoch: number,
  recordId: string,
  identity: ShareRecordIdentity,
): Uint8Array =>
  getTextEncoder().encode(JSON.stringify([
    'heyta:share-op-record',
    SHARE_KEYS_FORMAT_VERSION,
    shareId,
    keyEpoch,
    recordId,
    identity.clientId, identity.actionType, identity.opType, identity.entityType,
    identity.entityId ?? null,
    identity.entityIds?.length ? identity.entityIds : null,
    identity.timestamp, identity.schemaVersion,
  ]));
// 🔴 绑定字段清单与 wire 层（sync-client share AAD）保持同一份规范化。
// 所有成员都持清单密钥——没有身份绑定，一张密文可以改名成另一条 op 重放。
// 改这份字段清单 = 改防重放承诺，需要变异测试与评审。

/**
 * Identity sub-seeds are HKDF-separated from the master seed: Ed25519 keys
 * must never double as X25519 keys (different curve contexts, different
 * validation rules — reusing one secret across both is a known footgun).
 */
const identitySubSeed = (masterSeed: Uint8Array, purpose: 'ed25519' | 'x25519'): Uint8Array =>
  hkdf(
    sha256,
    masterSeed,
    undefined,
    getTextEncoder().encode(`heyta:share-identity-key:${purpose}:v${SHARE_KEYS_FORMAT_VERSION}`),
    KEY_LENGTH,
  );

export const generateShareIdentitySeed = (): Uint8Array =>
  getRandomBytes(SHARE_IDENTITY_SEED_LENGTH);

export const generateShareListKey = (): Uint8Array =>
  getRandomBytes(SHARE_LIST_KEY_LENGTH);

export const deriveShareIdentityKeyPair = (seed: Uint8Array): ShareIdentityKeyPair => {
  assertBytes32(seed, 'share identity seed');
  const ed25519Seed = identitySubSeed(seed, 'ed25519');
  const x25519Seed = identitySubSeed(seed, 'x25519');
  return {
    ed25519PublicKey: ed25519.getPublicKey(ed25519Seed),
    ed25519SecretKey: ed25519Seed,
    x25519PublicKey: x25519.getPublicKey(x25519Seed),
    x25519SecretKey: x25519Seed,
  };
};

/** Operation key for one share at one epoch. Different share/epoch ⇒ different key. */
export const deriveShareOperationKey = (
  listKey: Uint8Array,
  shareId: string,
  keyEpoch: number,
): Uint8Array => {
  assertListKey(listKey);
  assertShareId(shareId);
  assertSafeEpoch(keyEpoch);
  return hkdf(
    sha256,
    listKey,
    undefined,
    getTextEncoder().encode(`heyta:share-op-key:v${SHARE_KEYS_FORMAT_VERSION}:${shareId}:e${keyEpoch}`),
    KEY_LENGTH,
  );
};

/**
 * Seal the listKey to one recipient (ECIES with a fresh ephemeral X25519 key
 * per envelope). The sealing side needs no secret of its own — authenticity
 * of the *sender* is not claimed here; membership is the server's job and op
 * authorship is proven by Ed25519 signatures, not by who sealed the envelope.
 */
export const sealListKeyForRecipient = async (args: {
  listKey: Uint8Array;
  shareId: string;
  keyEpoch: number;
  recipientX25519PublicKey: Uint8Array;
}): Promise<ShareMemberKeyEnvelope> => {
  const { listKey, shareId, keyEpoch, recipientX25519PublicKey } = args;
  assertListKey(listKey);
  assertShareId(shareId);
  assertSafeEpoch(keyEpoch);
  assertX25519PublicKey(recipientX25519PublicKey);
  const recipientFingerprint = shareKeyFingerprint(recipientX25519PublicKey);
  const ephemeralSecret = getRandomBytes(KEY_LENGTH);
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecret);
  const ephemeralFingerprint = shareKeyFingerprint(ephemeralPublicKey);
  const shared = x25519.getSharedSecret(ephemeralSecret, recipientX25519PublicKey);
  const kek = hkdf(
    sha256,
    shared,
    undefined,
    envelopeInfo(shareId, keyEpoch, recipientFingerprint, ephemeralFingerprint),
    KEY_LENGTH,
  );
  const iv = getRandomBytes(IV_LENGTH);
  const body = await aesEncrypt(
    kek,
    iv,
    listKey,
    envelopeAad(shareId, keyEpoch, recipientFingerprint, ephemeralFingerprint),
  );
  return {
    formatVersion: SHARE_KEYS_FORMAT_VERSION,
    shareId,
    keyEpoch,
    recipientFingerprint,
    ephemeralFingerprint,
    ephemeralPublicKey: encodeBase64(ephemeralPublicKey),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(body),
  };
};

export const assertShareMemberKeyEnvelope: (value: unknown) => asserts value is ShareMemberKeyEnvelope =
  (value) => {
    if (!isPlainRecord(value) || Object.keys(value).length !== 8 ||
        value.formatVersion !== SHARE_KEYS_FORMAT_VERSION) {
      throw new Error('Invalid share member key envelope');
    }
    assertShareId(value.shareId);
    assertSafeEpoch(value.keyEpoch);
    if (typeof value.recipientFingerprint !== 'string' ||
        !/^[0-9a-f]{64}$/.test(value.recipientFingerprint) ||
        typeof value.ephemeralFingerprint !== 'string' ||
        !/^[0-9a-f]{64}$/.test(value.ephemeralFingerprint)) {
      throw new Error('Invalid share member key envelope');
    }
    const ephemeralPublicKey = decodeStrictBase64(value.ephemeralPublicKey, 'share envelope ephemeral key');
    const iv = decodeStrictBase64(value.iv, 'share envelope IV');
    const ciphertext = decodeStrictBase64(value.ciphertext, 'share envelope ciphertext');
    if (ephemeralPublicKey.length !== KEY_LENGTH ||
        iv.length !== IV_LENGTH ||
        ciphertext.length !== SHARE_LIST_KEY_LENGTH + 16) {
      throw new Error('Invalid share member key envelope');
    }
  };

/**
 * Open an envelope as the recipient. Fails closed unless every binding
 * matches: sealed to this key, for this share, at this epoch, with this
 * ephemeral key (GCM auth covers the whole AAD).
 */
export const openListKeyEnvelope = async (args: {
  envelope: ShareMemberKeyEnvelope;
  recipientX25519SecretKey: Uint8Array;
}): Promise<Uint8Array> => {
  const { envelope, recipientX25519SecretKey } = args;
  assertShareMemberKeyEnvelope(envelope);
  assertX25519SecretKey(recipientX25519SecretKey);
  const ownPublicKey = x25519.getPublicKey(recipientX25519SecretKey);
  if (shareKeyFingerprint(ownPublicKey) !== envelope.recipientFingerprint) {
    throw new Error('Share key envelope was not sealed for this recipient');
  }
  const ephemeralPublicKey = new Uint8Array(decodeBase64(envelope.ephemeralPublicKey));
  if (shareKeyFingerprint(ephemeralPublicKey) !== envelope.ephemeralFingerprint) {
    throw new Error('Share key envelope ephemeral key mismatch');
  }
  const shared = x25519.getSharedSecret(recipientX25519SecretKey, ephemeralPublicKey);
  const kek = hkdf(
    sha256,
    shared,
    undefined,
    envelopeInfo(envelope.shareId, envelope.keyEpoch, envelope.recipientFingerprint, envelope.ephemeralFingerprint),
    KEY_LENGTH,
  );
  const listKey = await aesDecrypt(
    kek,
    new Uint8Array(decodeBase64(envelope.iv)),
    new Uint8Array(decodeBase64(envelope.ciphertext)),
    envelopeAad(envelope.shareId, envelope.keyEpoch, envelope.recipientFingerprint, envelope.ephemeralFingerprint),
  );
  assertListKey(listKey);
  return listKey;
};

/**
 * Rekey = fresh listKey (epoch+1) + one envelope per remaining member.
 * The previous listKey is deliberately not an input: envelopes only ever
 * carry the new key, so a member removed before the rekey cannot unwrap it.
 */
export const planShareRekey = async (args: {
  shareId: string;
  fromEpoch: number;
  remainingMemberX25519PublicKeys: Uint8Array[];
}): Promise<ShareRekeyPlan> => {
  const { shareId, fromEpoch, remainingMemberX25519PublicKeys } = args;
  assertShareId(shareId);
  assertSafeEpoch(fromEpoch);
  if (remainingMemberX25519PublicKeys.length === 0) {
    throw new Error('Share rekey requires at least one remaining member');
  }
  const toEpoch = fromEpoch + 1;
  const newListKey = generateShareListKey();
  const envelopes: ShareMemberKeyEnvelope[] = [];
  for (const memberPublicKey of remainingMemberX25519PublicKeys) {
    envelopes.push(await sealListKeyForRecipient({
      listKey: newListKey,
      shareId,
      keyEpoch: toEpoch,
      recipientX25519PublicKey: memberPublicKey,
    }));
  }
  return { shareId, fromEpoch, toEpoch, newListKey, envelopes };
};

/**
 * Deterministic IV for re-encryption: same (new key, record id) always yields
 * the same IV, so re-running a migration chunk produces byte-identical
 * ciphertext (idempotent, comparable, resumable). GCM safety holds because a
 * given record id is re-encrypted under a given epoch key exactly once.
 */
const rekeyIv = (newOperationKey: Uint8Array, recordId: string): Uint8Array =>
  hkdf(
    sha256,
    newOperationKey,
    undefined,
    getTextEncoder().encode(`heyta:share-rekey-iv:v${SHARE_KEYS_FORMAT_VERSION}:${recordId}`),
    IV_LENGTH,
  );

export const assertShareEncryptedRecord: (value: unknown) => asserts value is ShareEncryptedRecord =
  (value) => {
    if (!isPlainRecord(value) || Object.keys(value).length !== 3 ||
        typeof value.id !== 'string' || value.id.length === 0) {
      throw new Error('Invalid share encrypted record');
    }
    assertSafeEpoch(value.keyEpoch);
    // 信封 = version(1) + keyEpoch(float64) + IV(12) + GCM body(ct + 16B tag)。
    const envelope = decodeStrictBase64(value.ciphertext, 'share record ciphertext');
    if (envelope.length < 1 + 8 + IV_LENGTH + 16 || envelope[0] !== SHARE_KEYS_FORMAT_VERSION) {
      throw new Error('Invalid share record envelope');
    }
  };

const encodeRecordEnvelope = (keyEpoch: number, iv: Uint8Array, body: Uint8Array): string => {
  const out = new Uint8Array(1 + 8 + iv.length + body.length);
  out[0] = SHARE_KEYS_FORMAT_VERSION;
  new DataView(out.buffer).setFloat64(1, keyEpoch, false);
  out.set(iv, 1 + 8);
  out.set(body, 1 + 8 + iv.length);
  return encodeBase64(out);
};

/** 从信封头取世代（自描述）——解密方据此选钥，不需要调用方记得。 */
export const shareRecordEpoch = (ciphertext: string): number => {
  const envelope = decodeStrictBase64(ciphertext, 'share record ciphertext');
  if (envelope.length < 1 + 8 || envelope[0] !== SHARE_KEYS_FORMAT_VERSION) {
    throw new Error('Invalid share record envelope');
  }
  const epoch = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength)
    .getFloat64(1, false);
  if (!Number.isSafeInteger(epoch) || epoch <= 0) throw new Error('Invalid share record epoch');
  return epoch;
};

/** Encrypt one share record (an op payload) under the share's operation key. */
export const encryptShareRecord = async (args: {
  id: string;
  plaintext: Uint8Array;
  shareId: string;
  listKey: Uint8Array;
  keyEpoch: number;
  /** 线上 op 身份（除 id 外）；进 AAD——没有它，密文可以改名成另一条 op 重放。 */
  identity: ShareRecordIdentity;
}): Promise<ShareEncryptedRecord> => {
  const { id, plaintext, shareId, listKey, keyEpoch, identity } = args;
  if (typeof id !== 'string' || id.length === 0) throw new Error('Invalid share record id');
  if (plaintext.length === 0) throw new Error('Invalid share record plaintext');
  assertShareId(shareId);
  assertListKey(listKey);
  assertSafeEpoch(keyEpoch);
  const key = deriveShareOperationKey(listKey, shareId, keyEpoch);
  const iv = getRandomBytes(IV_LENGTH);
  const body = await aesEncrypt(key, iv, plaintext, opRecordAad(shareId, keyEpoch, id, identity));
  return { id, keyEpoch, ciphertext: encodeRecordEnvelope(keyEpoch, iv, body) };
};

/** Decrypt one share record. 世代从信封头取；fails on wrong share/epoch/key or tampering. */
export const decryptShareRecord = async (args: {
  record: ShareEncryptedRecord;
  shareId: string;
  listKey: Uint8Array;
  /** 与加密时相同的线上 op 身份——AAD 精确匹配才能解（防改名重放）。 */
  identity: ShareRecordIdentity;
}): Promise<Uint8Array> => {
  const { record, shareId, listKey, identity } = args;
  assertShareEncryptedRecord(record);
  assertShareId(shareId);
  assertListKey(listKey);
  const raw = new Uint8Array(decodeBase64(record.ciphertext));
  const epoch = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getFloat64(1, false);
  if (!Number.isSafeInteger(epoch) || epoch <= 0) throw new Error('Invalid share record epoch');
  const key = deriveShareOperationKey(listKey, shareId, epoch);
  return aesDecrypt(
    key,
    raw.slice(1 + 8, 1 + 8 + IV_LENGTH),
    raw.slice(1 + 8 + IV_LENGTH),
    opRecordAad(shareId, epoch, record.id, identity),
  );
};

/**
 * Re-encrypt one record from its current epoch to `toEpoch`. Fails if the
 * record was not encrypted under `fromListKey` (wrong share/tampered). Running
 * it twice yields byte-identical output; resuming after an interruption
 * recomputes the same ciphertext instead of creating a divergent copy.
 */
export const reencryptShareRecord = async (args: {
  record: ShareEncryptedRecord;
  shareId: string;
  fromListKey: Uint8Array;
  toListKey: Uint8Array;
  toEpoch: number;
  /** 该 op 的线上身份（除 id 外）——新旧两代密文的 AAD 都要它。 */
  identity: ShareRecordIdentity;
}): Promise<ShareEncryptedRecord> => {
  const { record, shareId, fromListKey, toListKey, toEpoch, identity } = args;
  assertShareEncryptedRecord(record);
  assertShareId(shareId);
  assertSafeEpoch(toEpoch);
  assertListKey(fromListKey);
  assertListKey(toListKey);
  if (record.keyEpoch === toEpoch) return record; // already migrated — idempotent no-op
  const raw = new Uint8Array(decodeBase64(record.ciphertext));
  const fromEpoch = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getFloat64(1, false);
  if (!Number.isSafeInteger(fromEpoch) || fromEpoch <= 0) throw new Error('Invalid share record epoch');
  const fromKey = deriveShareOperationKey(fromListKey, shareId, fromEpoch);
  const plaintext = await aesDecrypt(
    fromKey,
    raw.slice(1 + 8, 1 + 8 + IV_LENGTH),
    raw.slice(1 + 8 + IV_LENGTH),
    opRecordAad(shareId, fromEpoch, record.id, identity),
  );
  const toKey = deriveShareOperationKey(toListKey, shareId, toEpoch);
  const iv = rekeyIv(toKey, record.id);
  const body = await aesEncrypt(toKey, iv, plaintext, opRecordAad(shareId, toEpoch, record.id, identity));
  return { id: record.id, keyEpoch: toEpoch, ciphertext: encodeRecordEnvelope(toEpoch, iv, body) };
};

/** Canonical op-signature message: binds the op identity to its ciphertext. */
export const buildShareOpSignatureMessage = (parts: {
  opId: string;
  clientId: string;
  shareId: string;
  keyEpoch: number;
  ciphertext: string;
}): Uint8Array => {
  assertShareId(parts.shareId);
  assertSafeEpoch(parts.keyEpoch);
  if (typeof parts.opId !== 'string' || parts.opId.length === 0 ||
      typeof parts.clientId !== 'string' || parts.clientId.length === 0 ||
      typeof parts.ciphertext !== 'string' || parts.ciphertext.length === 0) {
    throw new Error('Invalid share op signature parts');
  }
  return getTextEncoder().encode(JSON.stringify([
    'heyta:share-op-sig',
    SHARE_KEYS_FORMAT_VERSION,
    parts.opId,
    parts.clientId,
    parts.shareId,
    parts.keyEpoch,
    parts.ciphertext,
  ]));
};

export const signShareOperation = (
  ed25519SecretKey: Uint8Array,
  message: Uint8Array,
): Uint8Array => {
  assertEd25519SecretKey(ed25519SecretKey);
  if (message.length === 0) throw new Error('Invalid share op signature message');
  return ed25519.sign(message, ed25519SecretKey);
};

export const verifyShareOperationSignature = (
  ed25519PublicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean => {
  assertBytes32(ed25519PublicKey, 'Ed25519 public key');
  if (message.length === 0 || signature.length === 0) return false;
  try {
    return ed25519.verify(signature, message, ed25519PublicKey);
  } catch {
    return false;
  }
};
