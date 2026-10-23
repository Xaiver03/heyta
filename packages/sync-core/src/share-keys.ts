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

/**
 * Canonical op-signature message.
 *
 * 🔴 定下来的规则（ADR-0069 裁决三）：**签名域 = 线协议里服务端看得见、且共享日志会据以判定的
 * 全部字段** —— `serverSeq` / `receivedAt` 由服务端分配，客户端签的那一刻不可知，签不进去。
 * 两枚个人日志专用字段（`syncImportReason` / `repairBaseServerSeq`）也**不在**域里：
 * share 那张表从来没有这两列（现量：`grep -n "syncImportReason\|repairBaseServerSeq" server/prisma/schema.prisma`），
 * 没有落库就没有"被改动后还读得出来"这件事。**翻案条件**：共享日志哪天开始存它们，它们必须同时进域。
 *
 * 🔴 **顺序即协议**：下面那一只数组就是签名域的字节形状，加字段一律**追加在末尾**、
 * 不许插在中间（插在中间 = 让所有已签的 op 集体变成"验不过"，而这一步没有任何迁移能补救）。
 *
 * ⚠️ **密钥世代（`keyEpoch`）不单独进域**：它在密文信封的头 9 字节里自描述
 * （`encodeRecordEnvelope`），而**整个信封就是域里那枚 `ciphertext`** ⇒ 改世代必然改密文字节，
 * 签名照样废。单列它不增加任何完整性，只会多要签名者先解析一份信封格式（`shareRecordEpoch`）——
 * 那等于把"签名的字节形状"绑在信封编码器上：任何不产出这个信封的加密实现（替身、
 * 以后换的 AEAD 封装）都签不出来，而它签不出的原因是域里一枚**冗余**字段。
 * **翻案条件**：哪天服务端把世代存成独立列并按列判定（不再从信封读回来），它必须同时进域。
 *
 * 为什么不是"只签密文"：那些元数据今天已经被 AEAD 的 AAD 绑住（`opRecordAad`），改它们会解不开；
 * 但**服务端没有清单钥**，它永远做不了 AAD 一致性检查 —— 要让它能在上传边界就拒掉伪造件，
 * 签名必须覆盖这些字段。另有一格从来不被任何完整性机制绑住：`vectorClock` 不在 AAD 里，
 * 而并发判定与冲突可见性读的正是它 —— 服务端重写它就能把两条并发伪装成有先后。
 * 读侧还要能分出**两种不同的失败**："签名无效"（有人在动我的数据）与"解不开"（世代/钥的问题，
 * ADR-0016 那一族）。域里少一枚字段，这两类就会互相顶包。
 */
export interface ShareOpSignatureParts {
  opId: string;
  clientId: string;
  shareId: string;
  /**
   * 写这条 op 的**成员行 id**（share 作用域，不是 userId）。
   *
   * 🔴 它必须在签名域里：读侧要挑出"该用谁的钥验"，而这个号是服务端写进库的
   * （上传者是谁由认证决定，不由客户端声明）。不在域里的话，服务端改这一格
   * 就能把一条真成员写的 op **重署名**成另一个人，而签名照样成立。
   */
  signerMemberId?: string | null;
  ciphertext: string;
  actionType?: string | null;
  opType?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** 批量作用域。集合语义 ⇒ 顺序**不**进签名域（见下）。 */
  entityIds?: readonly string[] | null;
  schemaVersion?: number | null;
  /** 线协议上的毫秒数（`number`）。传 `bigint` 会响亮失败，不会被静默丢字段。 */
  clientTimestamp?: number | null;
  vectorClock?: unknown;
  /**
   * 🔴 时钟是**完整前集**还是"对某个前沿的增量"（`vectorClockEncoding`）。
   * 这一枚必须签：同一份 `vectorClock` 字节配上不同的 encoding 是两种意思，
   * 而改这一格不需要动时钟本身 —— 不签它，"改序伪装成有先后"就又回来了一条路。
   */
  vectorClockEncoding?: string | null;
  /** 载荷是不是密文。不签它，中间人翻掉这一格就能把密文读成明文形状。 */
  isPayloadEncrypted?: boolean | null;
}

/**
 * 递归排序对象键的 JSON 规范化。
 *
 * 🔴 为什么必须规范而不是直接 `JSON.stringify`：`vector_clock` 与 `payload` 在服务端是
 * **jsonb** —— 它不保留键的插入顺序，还会去重。签名方与验签方各自 stringify 一份"逻辑上相同"
 * 的时钟，拿到的字节可以不同，于是每一台非签名者的设备都会把这枚合法签名读成失败。
 * 数组顺序**保留**（数组的语义是有序的），对象按键名排序。
 */
const canonicalSignatureValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalSignatureValue);
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new Error('Invalid share op signature value');
      return value;
    case 'object': {
      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) out[key] = canonicalSignatureValue(source[key]);
      return out;
    }
    default:
      // bigint / function / symbol：宁可抛，不要在 JSON 里悄悄变成一个不同的值。
      throw new Error('Invalid share op signature value');
  }
};

const assertOptionalString = (value: unknown, label: string): void => {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw new Error(`Invalid share op signature ${label}`);
  }
};

const assertOptionalPositiveInt = (value: unknown, label: string): void => {
  if (value === null || value === undefined) return;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid share op signature ${label}`);
  }
};

export const buildShareOpSignatureMessage = (parts: ShareOpSignatureParts): Uint8Array => {
  assertShareId(parts.shareId);
  if (typeof parts.opId !== 'string' || parts.opId.length === 0 ||
      typeof parts.clientId !== 'string' || parts.clientId.length === 0 ||
      typeof parts.ciphertext !== 'string' || parts.ciphertext.length === 0) {
    throw new Error('Invalid share op signature parts');
  }
  assertOptionalString(parts.signerMemberId, 'signerMemberId');
  assertOptionalString(parts.actionType, 'actionType');
  assertOptionalString(parts.opType, 'opType');
  assertOptionalString(parts.entityType, 'entityType');
  assertOptionalString(parts.entityId, 'entityId');
  assertOptionalString(parts.vectorClockEncoding, 'vectorClockEncoding');
  if (parts.isPayloadEncrypted !== null && parts.isPayloadEncrypted !== undefined &&
      typeof parts.isPayloadEncrypted !== 'boolean') {
    throw new Error('Invalid share op signature isPayloadEncrypted');
  }
  assertOptionalPositiveInt(parts.schemaVersion, 'schemaVersion');
  if (parts.clientTimestamp !== null && parts.clientTimestamp !== undefined &&
      (typeof parts.clientTimestamp !== 'number' || !Number.isFinite(parts.clientTimestamp))) {
    throw new Error('Invalid share op signature clientTimestamp');
  }
  const entityIds = parts.entityIds === null || parts.entityIds === undefined || parts.entityIds.length === 0
    // 🔴 「没有批量作用域」与「作用域是空集合」必须是**同一个域值**：服务端把缺省落成
    // `entity_ids: []`（jsonb 里不会是 null），读侧拿回来的就是 `[]`。写侧签的是"没传"、
    // 读侧重建的是"空数组"，两者不同形 ⇒ 每台非签名者的设备把自己人的合法签名读成失败。
    // 语义上这两句是同一句（"这条 op 不指向一批实体"），所以在这里折成一份。
    ? null
    : [...parts.entityIds].map((id) => {
        if (typeof id !== 'string' || id.length === 0) throw new Error('Invalid share op signature entityIds');
        return id;
      }).sort();
  const vectorClock = parts.vectorClock
    // 同上：`vector_clock` 在服务端是 jsonb，缺省的时钟存成 `{}`，读回来是 `{}` 而不是"没有"。
    // `{}` 与"没有因果前集"是同一件事（`foldShareOps` 折出来的空钟就是 `{}`），所以折成 null。
    && typeof parts.vectorClock === 'object' && !Array.isArray(parts.vectorClock)
    && Object.keys(parts.vectorClock as Record<string, unknown>).length === 0
      ? null
      : parts.vectorClock;
  return getTextEncoder().encode(JSON.stringify([
    'heyta:share-op-sig',
    SHARE_KEYS_FORMAT_VERSION,
    parts.opId,
    parts.clientId,
    parts.shareId,
    // 世代（`keyEpoch`）在这里**不占一格**：它在下一格那枚信封的头 9 字节里，
    // 动它必改动被签的字节。这一格是 M4 第三批删掉的 —— 当时全仓还一条带签名的 op
    // 都没上过线（判据：`grep -rn "signShareOpWire" packages/*/src server/src apps/*/src`
    // 只有装配点这一处），所以这是"中间不许动"这条纪律唯一一次免费执行的窗口。
    parts.signerMemberId ?? null,
    parts.actionType ?? null,
    parts.opType ?? null,
    parts.entityType ?? null,
    parts.entityId ?? null,
    entityIds,
    parts.schemaVersion ?? null,
    parts.clientTimestamp ?? null,
    canonicalSignatureValue(vectorClock),
    parts.ciphertext,
    // 🔴 追加在末尾（见上面"顺序即协议"）：这两枚是 M4 第三批才进域的，插在中间会
    // 让已签的字节形状整体位移 —— 现在还没有任何一条 op 带过签名，所以这一次是最后一次能白捡的。
    parts.vectorClockEncoding ?? null,
    parts.isPayloadEncrypted ?? null,
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

/**
 * 线 op 里签名要读到的那几枚字段（**上传形状**，不是下载形状）。
 *
 * 🔴 `clientTimestamp` 是同一个数在三个地方的三个名字之一：写侧线 op 上叫 `timestamp`、
 * 库里叫 `client_timestamp`、下载回来又叫 `clientTimestamp`。这一枚接口按**签名域里那个名字**
 * 声明，于是三处调用点都必须显式交代"我这份时间是从线 op 拿的"：
 * 写侧 `clientTimestamp: identity.timestamp`、服务端 `clientTimestamp: op.timestamp`、
 * 读侧 `clientTimestamp: row.clientTimestamp`（同名字段，直接给）。
 * 谁要是顺手填 `Date.now()`，填进去的字面量就不是这个名 —— 漂移留在原地，症状是每台
 * 非签名者的设备把一枚合法签名读成失败。
 */
export interface ShareOpWireForSignature {
  readonly id: string;
  readonly clientId: string;
  readonly actionType?: string | null;
  readonly opType?: string | null;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly entityIds?: readonly string[] | null;
  /** 密文信封（base64 字符串）。不是字符串就说明这条压根没走清单钥 ⇒ 装配处响亮抛错。 */
  readonly payload: unknown;
  readonly vectorClock?: unknown;
  readonly schemaVersion?: number | null;
  /** 线 op 上那枚 `vectorClockEncoding`（缺省 = 完整前集）。在域里，见 `ShareOpSignatureParts`。 */
  readonly vectorClockEncoding?: string | null;
  readonly isPayloadEncrypted?: boolean | null;
  readonly clientTimestamp: number;
}

/**
 * 从**线 op 那一份形状**装配签名消息 —— 写侧、服务端上传边界、读侧三处共用这一个装配器。
 *
 * 🔴 为什么必须共用："哪些字节进签名域"这件事一旦有两份实现，两份迟早漂一点，
 * 症状是每台非签名者的设备都把一枚合法签名读成失败（比不签更坏 —— 它会让人以为
 * 有完整性保护）。三处只有这一处知道域的形状，才是"协议只有一份定义"。
 *
 * `keyEpoch` **不上线也不单列**：它在密文信封头 9 字节里自描述，而信封整体就是域里那枚
 * `payload` ⇒ 改世代必然改被签的字节。这里因此**不解析信封**：签名件不需要认识信封格式，
 * 替身加密器（以及以后换的封装）也签得出来。翻案条件见 `ShareOpSignatureParts` 的注释。
 */
export const buildShareOpSignatureMessageFromWire = (
  shareId: string,
  signerMemberId: string | null | undefined,
  wire: ShareOpWireForSignature,
): Uint8Array => {
  if (typeof wire.payload !== 'string' || wire.payload.length === 0) {
    throw new Error('Invalid share op signature parts');
  }
  return buildShareOpSignatureMessage({
    opId: wire.id,
    clientId: wire.clientId,
    shareId,
    signerMemberId,
    ciphertext: wire.payload,
    actionType: wire.actionType ?? null,
    opType: wire.opType ?? null,
    entityType: wire.entityType ?? null,
    entityId: wire.entityId ?? null,
    entityIds: wire.entityIds ?? null,
    schemaVersion: wire.schemaVersion ?? null,
    vectorClockEncoding: wire.vectorClockEncoding ?? null,
    isPayloadEncrypted: wire.isPayloadEncrypted ?? null,
    clientTimestamp: wire.clientTimestamp,
    vectorClock: wire.vectorClock ?? null,
  });
};

/** 写侧：线 op ⇒ 线协议上那枚 base64 签名。装配域的那份知识只在上面那一处。 */
export const signShareOpWire = (
  ed25519SecretKey: Uint8Array,
  args: { shareId: string; signerMemberId: string; wire: ShareOpWireForSignature },
): string =>
  encodeBase64(
    signShareOperation(
      ed25519SecretKey,
      buildShareOpSignatureMessageFromWire(args.shareId, args.signerMemberId, args.wire),
    ),
  );

/**
 * 一条 op 的签名**结局**（封闭词表）。
 *
 * 🔴 四态而不是布尔：ADR-0069 裁决五要求读侧把「通过 / 未签名 / 失败」分开画，
 * 而服务端还要多一档「这个人根本没登记签名公钥」（客户端唯一能自己修的一档：去补发）。
 * 折叠成两态就等于让"世代没对上"顶包"有人在改我的数据"。
 */
export const SHARE_OP_SIGNATURE_OUTCOMES = ['verified', 'unsigned', 'invalid', 'signer-unregistered'] as const;
export type ShareOpSignatureOutcome = (typeof SHARE_OP_SIGNATURE_OUTCOMES)[number];

/**
 * 验一枚线签名，回封闭词表里的一个结局 —— 服务端上传边界与读侧共用这一处判定。
 *
 * 判定顺序是**先钥后人**：在册公钥缺失排在签名缺失之前。不是随手排的 —— 「没登记公钥」是
 * 这台设备能自己修的那一格（面板补发），而「没签名」它修不了；把可修的那一档报出去，
 * 用户才有一条出路。
 *
 * ⚠️ 「存在但形状不对」一律算 `invalid` 而不是 `unsigned`：`signature: 123` 不是"没签"，
 * 是有人在动这条 op。把伪造读成缺席，就是那条线一直防的"静默的错数据"。
 */
export const classifyShareOpSignature = (args: {
  /** 成员行上登记的 Ed25519 公钥（base64）；`null`/空表示还没在册。 */
  signingPublicKey: string | null | undefined;
  shareId: string;
  /** 服务端按**认证上传者**写进库的那个成员行 id；读侧传库里那一格。 */
  signerMemberId: string | null | undefined;
  wire: ShareOpWireForSignature;
  /** 线 op 上那枚（未经校验的 `unknown`，由调用方从**原始**请求体里取 —— 严格 schema 会把它剥掉）。 */
  signature: unknown;
}): ShareOpSignatureOutcome => {
  if (typeof args.signingPublicKey !== 'string' || args.signingPublicKey.length === 0) {
    return 'signer-unregistered';
  }
  if (args.signature === null || args.signature === undefined) return 'unsigned';
  if (typeof args.signature !== 'string' || args.signature.length === 0) return 'invalid';
  try {
    return verifyShareOperationSignature(
      // ⚠️ `decodeBase64` 回的是 **ArrayBuffer**（`encryption/web-crypto.ts:207`），
      // 直接递给 Ed25519 会被长度校验拒掉 —— 症状是"每一枚合法签名都验不过"，
      // 看起来像有人在动数据。与 `decryptShareRecord` 同一处写法：先重新包成视图。
      new Uint8Array(decodeBase64(args.signingPublicKey)),
      buildShareOpSignatureMessageFromWire(args.shareId, args.signerMemberId, args.wire),
      new Uint8Array(decodeBase64(args.signature)),
    )
      ? 'verified'
      : 'invalid';
  } catch {
    // 域装配抛错（载荷不是信封、时钟里有 bigint…）= 这条 op 无法被证明，不是"没问题"。
    return 'invalid';
  }
}
