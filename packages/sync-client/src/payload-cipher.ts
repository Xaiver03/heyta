import {
  decodeBase64, decrypt, decryptVaultRecord, encodeBase64, encrypt,
  encryptVaultRecord, isEncryptedPayloadTransportShape,
} from '@heyta/sync-core';

/** Immutable operation identity authenticated along with the encrypted payload. */
export interface SyncPayloadIdentity {
  id: string;
  clientId: string;
  actionType: string;
  opType: string;
  entityType: string;
  entityId?: string;
  entityIds?: string[];
  timestamp: number;
  schemaVersion: number;
}

export interface SyncPayloadCipher {
  encrypt(payload: string, identity: SyncPayloadIdentity): Promise<string>;
  decrypt(payload: string, identity: SyncPayloadIdentity): Promise<string>;
}

/** A vault host must supply an unlock-session provider; omission is not legacy mode. */
export type SyncEncryptionOptions =
  | { encryptionMode?: 'password'; getPayloadCipher?: never }
  | { encryptionMode: 'vault'; getPayloadCipher: () => Promise<SyncPayloadCipher | undefined> };

// ASCII marker distinguishes the new envelope from unversioned legacy salts.
// A recognised marker with a bad version/tag NEVER falls back to the password.
const MAGIC = Uint8Array.from('heyta-vault-op/', (char) => char.charCodeAt(0));
const FORMAT_VERSION = 1;
const HEADER_LENGTH = MAGIC.length + 1 + 8;
const hasVaultMarker = (bytes: Uint8Array): boolean =>
  bytes.length >= MAGIC.length && MAGIC.every((byte, index) => bytes[index] === byte);

const identityAAD = (op: SyncPayloadIdentity): string => JSON.stringify([
  op.id, op.clientId, op.actionType, op.opType, op.entityType,
  // HTTP inventory/download omit empty entityIds. Authenticate that canonical
  // identity before encryption too, while retaining every nonempty target list.
  op.entityId ?? null, op.entityIds?.length ? op.entityIds : null, op.timestamp, op.schemaVersion,
]);

export const createPasswordPayloadCipher = (password: string): SyncPayloadCipher => ({
  encrypt: (payload) => encrypt(payload, password),
  async decrypt(payload) {
    if (hasVaultMarker(new Uint8Array(decodeBase64(payload)))) {
      throw new Error('Vault key required for encrypted operation');
    }
    return decrypt(payload, password);
  },
});

export interface VaultSyncKey {
  keyVersion: number;
  rootKey: Uint8Array;
}

/**
 * New-format-only writes with explicit legacy reads for migration. The caller
 * must obtain/publish the wrapped package before using this codec. This does
 * not migrate historical operations or persist any plaintext key.
 */
export function createVaultPayloadCipher(options: {
  current: VaultSyncKey;
  previous?: readonly VaultSyncKey[];
  legacyPassword?: string;
  /** Resolve historical keys lazily; never enumerate untrusted version ranges. */
  resolveKeyVersion?: (keyVersion: number) => Uint8Array | undefined;
}): SyncPayloadCipher {
  const keys = new Map<number, Uint8Array>();
  for (const entry of [...(options.previous ?? []), options.current]) {
    if (!Number.isSafeInteger(entry.keyVersion) || entry.keyVersion <= 0 || entry.rootKey.length !== 32) {
      throw new Error('Invalid vault sync key');
    }
    if (keys.has(entry.keyVersion)) throw new Error('Duplicate vault key version');
    // Capture a session snapshot; mutation of the caller's buffer cannot change
    // encryption halfway through a sync batch.
    keys.set(entry.keyVersion, entry.rootKey.slice());
  }
  const keyVersion = options.current.keyVersion;
  const currentKey = keys.get(keyVersion)!;
  const legacy = options.legacyPassword ? createPasswordPayloadCipher(options.legacyPassword) : undefined;
  return {
    async encrypt(payload, identity) {
      const record = await encryptVaultRecord(identityAAD(identity), payload, currentKey, 'sync', keyVersion);
      const body = new Uint8Array(decodeBase64(record.ciphertext));
      const bytes = new Uint8Array(HEADER_LENGTH + body.length);
      bytes.set(MAGIC);
      bytes[MAGIC.length] = FORMAT_VERSION;
      new DataView(bytes.buffer).setFloat64(MAGIC.length + 1, keyVersion, false);
      bytes.set(body, HEADER_LENGTH);
      return encodeBase64(bytes);
    },
    async decrypt(payload, identity) {
      if (!isEncryptedPayloadTransportShape(payload)) throw new Error('Invalid encrypted operation');
      const bytes = new Uint8Array(decodeBase64(payload));
      if (!hasVaultMarker(bytes)) {
        if (!legacy) throw new Error('Legacy key required for encrypted operation');
        return legacy.decrypt(payload, identity);
      }
      if (bytes.length < HEADER_LENGTH + 29 || bytes[MAGIC.length] !== FORMAT_VERSION) {
        throw new Error('Invalid vault operation envelope');
      }
      const version = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(MAGIC.length + 1, false);
      if (!Number.isSafeInteger(version) || version <= 0) throw new Error('Invalid vault key version');
      const rootKey = keys.get(version) ?? options.resolveKeyVersion?.(version);
      if (!rootKey) throw new Error('Vault key version unavailable');
      return decryptVaultRecord({
        id: identityAAD(identity), purpose: 'sync', keyVersion: version,
        ciphertext: encodeBase64(bytes.slice(HEADER_LENGTH)),
      }, rootKey);
    },
  };
}
