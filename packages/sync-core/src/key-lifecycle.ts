/**
 * Versioned E2EE key lifecycle primitives.
 *
 * This module deliberately does not change the existing password ciphertext
 * format. It is the key-package protocol used by the next vault format:
 * a random vault root key is wrapped independently by the E2EE passphrase and
 * by a one-time recovery code. Feature keys are HKDF-SHA256 subkeys of that
 * root. The server never receives any of these plaintext values.
 */

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  aesDecrypt,
  aesEncrypt,
  decodeBase64,
  encodeBase64,
  getRandomBytes,
  getTextDecoder,
  getTextEncoder,
  IV_LENGTH,
  KEY_LENGTH,
  SALT_LENGTH,
} from './encryption/web-crypto';
import { deriveKeyFromPassword } from './encryption/argon2';

export const VAULT_KEY_PACKAGE_VERSION = 1 as const;
export const VAULT_KEY_VERSION = 1;
const RECOVERY_CODE_BYTES = 24;
const RECOVERY_CODE_LENGTH = 40;
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_LOOKUP = new Map([...RECOVERY_ALPHABET].map((c, i) => [c, i]));

export const VAULT_KEY_PURPOSES = ['sync', 'ai-task-planning', 'ai-feedback'] as const;
export type VaultKeyPurpose = (typeof VAULT_KEY_PURPOSES)[number];

export const isVaultKeyPurpose = (value: unknown): value is VaultKeyPurpose =>
  typeof value === 'string' && (VAULT_KEY_PURPOSES as readonly string[]).includes(value);

export interface WrappedVaultKey {
  kdf: 'argon2id';
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface VaultKeyPackage {
  version: typeof VAULT_KEY_PACKAGE_VERSION;
  keyVersion: number;
  rootKeyFingerprint: string;
  passphrase: WrappedVaultKey;
  recovery: WrappedVaultKey;
}

export interface CreatedVaultKeyPackage {
  package: VaultKeyPackage;
  /** Display once, then discard. The package contains no recoverable copy. */
  recoveryCode: string;
  /** Keep only in the locked session / OS key store; never sync this value. */
  rootKey: Uint8Array;
}

export interface EncryptedVaultRecord {
  id: string;
  purpose: VaultKeyPurpose;
  keyVersion: number;
  ciphertext: string;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertSafeKeyVersion: (value: unknown) => asserts value is number = (value) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid vault key version');
  }
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

export const assertWrappedVaultKey: (value: unknown) => asserts value is WrappedVaultKey = (value) => {
  if (!isPlainRecord(value) || Object.keys(value).length !== 4 ||
      value.kdf !== 'argon2id') throw new Error('Invalid vault key wrapper');
  const salt = decodeStrictBase64(value.salt, 'vault key salt');
  const iv = decodeStrictBase64(value.iv, 'vault key IV');
  const ciphertext = decodeStrictBase64(value.ciphertext, 'vault key ciphertext');
  if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH ||
      ciphertext.length !== KEY_LENGTH + 16) throw new Error('Invalid vault key wrapper');
};

export const assertVaultKeyPackage: (value: unknown) => asserts value is VaultKeyPackage = (value) => {
  if (!isPlainRecord(value) || Object.keys(value).length !== 5 ||
      value.version !== VAULT_KEY_PACKAGE_VERSION ||
      typeof value.rootKeyFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.rootKeyFingerprint)) {
    throw new Error('Invalid vault key package');
  }
  assertSafeKeyVersion(value.keyVersion);
  assertWrappedVaultKey(value.passphrase);
  assertWrappedVaultKey(value.recovery);
};

export const assertEncryptedVaultRecord: (value: unknown) => asserts value is EncryptedVaultRecord = (value) => {
  if (!isPlainRecord(value) || Object.keys(value).length !== 4 ||
      typeof value.id !== 'string' || value.id.length === 0 ||
      !isVaultKeyPurpose(value.purpose)) throw new Error('Invalid encrypted vault record');
  assertSafeKeyVersion(value.keyVersion);
  const envelope = decodeStrictBase64(value.ciphertext, 'vault record ciphertext');
  if (envelope.length < 1 + IV_LENGTH + 16 || envelope[0] !== VAULT_KEY_PACKAGE_VERSION) {
    throw new Error('Invalid vault record envelope');
  }
};

const aadFor = (
  kind: 'passphrase' | 'recovery' | 'record',
  purpose: string,
  keyVersion: number,
  recordId = '',
): Uint8Array => getTextEncoder().encode(JSON.stringify([
  'heyta:vault-key',
  VAULT_KEY_PACKAGE_VERSION,
  kind,
  purpose,
  keyVersion,
  recordId,
]));

const fingerprint = (rootKey: Uint8Array): string =>
  Array.from(sha256(rootKey), (b) => b.toString(16).padStart(2, '0')).join('');

const wrapRootKey = async (
  rootKey: Uint8Array,
  secret: string,
  kind: 'passphrase' | 'recovery',
  keyVersion: number,
): Promise<WrappedVaultKey> => {
  assertSafeKeyVersion(keyVersion);
  const salt = getRandomBytes(SALT_LENGTH);
  const iv = getRandomBytes(IV_LENGTH);
  const derived = await deriveKeyFromPassword(secret, salt);
  const ciphertext = await aesEncrypt(
    derived.keyBytes,
    iv,
    rootKey,
    aadFor(kind, 'root', keyVersion),
  );
  return {
    kdf: 'argon2id',
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(ciphertext),
  };
};

const unwrapRootKey = async (
  wrapped: WrappedVaultKey,
  secret: string,
  kind: 'passphrase' | 'recovery',
  keyVersion: number,
): Promise<Uint8Array> => {
  assertWrappedVaultKey(wrapped);
  assertSafeKeyVersion(keyVersion);
  if (wrapped.kdf !== 'argon2id') throw new Error('Unsupported vault key KDF');
  const salt = new Uint8Array(decodeBase64(wrapped.salt));
  const iv = new Uint8Array(decodeBase64(wrapped.iv));
  if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH) {
    throw new Error('Invalid vault key wrapper');
  }
  const derived = await deriveKeyFromPassword(secret, salt);
  const rootKey = await aesDecrypt(
    derived.keyBytes,
    iv,
    new Uint8Array(decodeBase64(wrapped.ciphertext)),
    aadFor(kind, 'root', keyVersion),
  );
  if (rootKey.length !== KEY_LENGTH) throw new Error('Invalid vault root key');
  return rootKey;
};

const encodeRecoveryBody = (bytes: Uint8Array): string => {
  let acc = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += RECOVERY_ALPHABET[(acc >>> bits) & 31];
    }
  }
  if (bits > 0) out += RECOVERY_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
};

const decodeRecoveryBody = (body: string): Uint8Array | null => {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const char of body) {
    const value = RECOVERY_LOOKUP.get(char);
    if (value === undefined) return null;
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 255);
    }
  }
  // 39 base32 symbols represent exactly 24 bytes plus three zero pad bits.
  if (out.length !== RECOVERY_CODE_BYTES || (acc & ((1 << bits) - 1)) !== 0) return null;
  return new Uint8Array(out);
};

/** Generate a 192-bit recovery code with a checksum and human grouping. */
export const generateRecoveryCode = (): string => {
  const body = encodeRecoveryBody(getRandomBytes(RECOVERY_CODE_BYTES));
  const bytes = decodeRecoveryBody(body);
  if (!bytes) throw new Error('Recovery code encoder invariant failed');
  const checksum = RECOVERY_ALPHABET[sha256(bytes)[0] & 31];
  return `${body}${checksum}`.match(/.{1,4}/g)!.join('-');
};

/** Returns the canonical ungrouped code, or throws before it reaches KDF work. */
export const normalizeRecoveryCode = (input: string): string => {
  const normalized = input.replaceAll('-', '').replaceAll(' ', '').toUpperCase();
  if (normalized.length !== RECOVERY_CODE_LENGTH) throw new Error('Invalid recovery code');
  const body = normalized.slice(0, -1);
  const bytes = decodeRecoveryBody(body);
  if (!bytes || normalized.at(-1) !== RECOVERY_ALPHABET[sha256(bytes)[0] & 31]) {
    throw new Error('Invalid recovery code');
  }
  return normalized;
};

export const createVaultKeyPackage = async (
  passphrase: string,
  keyVersion = VAULT_KEY_VERSION,
): Promise<CreatedVaultKeyPackage> => {
  if (passphrase.length === 0) throw new Error('E2EE passphrase is required');
  assertSafeKeyVersion(keyVersion);
  const rootKey = getRandomBytes(KEY_LENGTH);
  const recoveryCode = normalizeRecoveryCode(generateRecoveryCode());
  return {
    rootKey,
    recoveryCode,
    package: {
      version: VAULT_KEY_PACKAGE_VERSION,
      keyVersion,
      rootKeyFingerprint: fingerprint(rootKey),
      passphrase: await wrapRootKey(rootKey, passphrase, 'passphrase', keyVersion),
      recovery: await wrapRootKey(rootKey, recoveryCode, 'recovery', keyVersion),
    },
  };
};

export const unlockVaultWithPassphrase = async (
  keyPackage: VaultKeyPackage,
  passphrase: string,
): Promise<Uint8Array> => {
  assertVaultKeyPackage(keyPackage);
  const rootKey = await unwrapRootKey(keyPackage.passphrase, passphrase, 'passphrase', keyPackage.keyVersion);
  if (fingerprint(rootKey) !== keyPackage.rootKeyFingerprint) throw new Error('Vault key fingerprint mismatch');
  return rootKey;
};

export const unlockVaultWithRecoveryCode = async (
  keyPackage: VaultKeyPackage,
  recoveryCode: string,
): Promise<Uint8Array> => {
  assertVaultKeyPackage(keyPackage);
  const normalized = normalizeRecoveryCode(recoveryCode);
  const rootKey = await unwrapRootKey(keyPackage.recovery, normalized, 'recovery', keyPackage.keyVersion);
  if (fingerprint(rootKey) !== keyPackage.rootKeyFingerprint) throw new Error('Vault key fingerprint mismatch');
  return rootKey;
};

/** HKDF domain separation prevents a sync key from being reused by AI export. */
export const deriveVaultFeatureKey = (
  rootKey: Uint8Array,
  purpose: VaultKeyPurpose,
  keyVersion = VAULT_KEY_VERSION,
): Uint8Array => {
  if (rootKey.length !== KEY_LENGTH) throw new Error('Invalid vault root key');
  if (!isVaultKeyPurpose(purpose)) throw new Error('Invalid vault key purpose');
  assertSafeKeyVersion(keyVersion);
  return hkdf(
    sha256,
    rootKey,
    undefined,
    getTextEncoder().encode(`heyta:feature-key:${purpose}:v${keyVersion}`),
    KEY_LENGTH,
  );
};

export const encryptVaultRecord = async (
  id: string,
  plaintext: string,
  rootKey: Uint8Array,
  purpose: VaultKeyPurpose,
  keyVersion = VAULT_KEY_VERSION,
): Promise<EncryptedVaultRecord> => {
  if (typeof id !== 'string' || id.length === 0) throw new Error('Invalid encrypted vault record id');
  if (typeof plaintext !== 'string') throw new Error('Invalid vault record plaintext');
  const iv = getRandomBytes(IV_LENGTH);
  const key = deriveVaultFeatureKey(rootKey, purpose, keyVersion);
  const body = await aesEncrypt(
    key,
    iv,
    getTextEncoder().encode(plaintext),
    aadFor('record', purpose, keyVersion, id),
  );
  const envelope = new Uint8Array(1 + IV_LENGTH + body.length);
  envelope[0] = VAULT_KEY_PACKAGE_VERSION;
  envelope.set(iv, 1);
  envelope.set(body, 1 + IV_LENGTH);
  return { id, purpose, keyVersion, ciphertext: encodeBase64(envelope) };
};

export const decryptVaultRecord = async (
  record: EncryptedVaultRecord,
  rootKey: Uint8Array,
): Promise<string> => {
  assertEncryptedVaultRecord(record);
  if (rootKey.length !== KEY_LENGTH) throw new Error('Invalid vault root key');
  const envelope = new Uint8Array(decodeBase64(record.ciphertext));
  if (envelope.length < 1 + IV_LENGTH + 16 || envelope[0] !== VAULT_KEY_PACKAGE_VERSION) {
    throw new Error('Invalid vault record envelope');
  }
  const key = deriveVaultFeatureKey(rootKey, record.purpose, record.keyVersion);
  const plaintext = await aesDecrypt(
    key,
    envelope.slice(1, 1 + IV_LENGTH),
    envelope.slice(1 + IV_LENGTH),
    aadFor('record', record.purpose, record.keyVersion, record.id),
  );
  return getTextDecoder().decode(plaintext);
};

/**
 * Re-encrypt every record before returning any result. A corrupt record makes
 * the whole operation fail, so callers can atomically publish the new bundle.
 */
export const reencryptVaultRecords = async (
  records: readonly EncryptedVaultRecord[],
  oldRootKey: Uint8Array,
  newRootKey: Uint8Array,
  newKeyVersion: number,
): Promise<EncryptedVaultRecord[]> => {
  if (oldRootKey.length !== KEY_LENGTH || newRootKey.length !== KEY_LENGTH) {
    throw new Error('Invalid vault root key');
  }
  assertSafeKeyVersion(newKeyVersion);
  const plaintexts = await Promise.all(records.map(async (record) => ({
    record,
    plaintext: await decryptVaultRecord(record, oldRootKey),
  })));
  return Promise.all(
    plaintexts.map(({ record, plaintext }) =>
      encryptVaultRecord(record.id, plaintext, newRootKey, record.purpose, newKeyVersion),
    ),
  );
};

export const rotateVaultKey = async (
  currentPackage: VaultKeyPackage,
  currentRootKey: Uint8Array,
  newPassphrase: string,
): Promise<CreatedVaultKeyPackage> => {
  assertVaultKeyPackage(currentPackage);
  if (currentRootKey.length !== KEY_LENGTH) throw new Error('Invalid vault root key');
  if (fingerprint(currentRootKey) !== currentPackage.rootKeyFingerprint) {
    throw new Error('Current vault key does not match key package');
  }
  return createVaultKeyPackage(newPassphrase, currentPackage.keyVersion + 1);
};

/**
 * Re-wrap the same vault root after an E2EE passphrase change.
 *
 * This is intentionally separate from {@link rotateVaultKey}: changing the
 * passphrase must not silently imply a data migration.  A fresh recovery code
 * is generated because the old recovery wrapper is authenticated with the old
 * key-package version and cannot be safely carried forward without retaining
 * the old recovery secret.  The caller must publish the returned package with
 * the server CAS before replacing its local package.
 */
export const rewrapVaultKeyPackage = async (
  currentPackage: VaultKeyPackage,
  currentRootKey: Uint8Array,
  newPassphrase: string,
): Promise<CreatedVaultKeyPackage> => {
  assertVaultKeyPackage(currentPackage);
  if (currentRootKey.length !== KEY_LENGTH) throw new Error('Invalid vault root key');
  if (fingerprint(currentRootKey) !== currentPackage.rootKeyFingerprint) {
    throw new Error('Current vault key does not match key package');
  }
  return createVaultKeyPackageWithRoot(
    currentRootKey,
    newPassphrase,
    currentPackage.keyVersion + 1,
  );
};

/** Internal shared constructor for initial creation and same-root re-wrap. */
const createVaultKeyPackageWithRoot = async (
  rootKey: Uint8Array,
  passphrase: string,
  keyVersion: number,
): Promise<CreatedVaultKeyPackage> => {
  if (passphrase.length === 0) throw new Error('E2EE passphrase is required');
  if (rootKey.length !== KEY_LENGTH) throw new Error('Invalid vault root key');
  assertSafeKeyVersion(keyVersion);
  const recoveryCode = normalizeRecoveryCode(generateRecoveryCode());
  return {
    rootKey: rootKey.slice(),
    recoveryCode,
    package: {
      version: VAULT_KEY_PACKAGE_VERSION,
      keyVersion,
      rootKeyFingerprint: fingerprint(rootKey),
      passphrase: await wrapRootKey(rootKey, passphrase, 'passphrase', keyVersion),
      recovery: await wrapRootKey(rootKey, recoveryCode, 'recovery', keyVersion),
    },
  };
};

/** Exported for tests and migration tools; fingerprints are non-secret. */
export const vaultRootKeyFingerprint = fingerprint;
