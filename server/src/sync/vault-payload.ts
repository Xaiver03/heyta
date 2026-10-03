import { isEncryptedPayloadTransportShape } from '@heyta/sync-core';

const VAULT_OPERATION_MAGIC = Buffer.from('heyta-vault-op/', 'ascii');
const VAULT_OPERATION_FORMAT_VERSION = 1;
const HEADER_LENGTH = VAULT_OPERATION_MAGIC.length + 1 + 8;
const MIN_GCM_BODY_LENGTH = 1 + 12 + 16;

export type VaultPayloadGeneration =
  | { kind: 'legacy' }
  | { kind: 'vault'; keyVersion: number }
  | { kind: 'invalid'; reason: string };

/**
 * Inspect only the public envelope header. The server deliberately never
 * decrypts the body; this is solely the generation gate used after an atomic
 * migration has published a payload generation.
 */
export const inspectVaultPayloadGeneration = (
  value: unknown,
): VaultPayloadGeneration => {
  if (!isEncryptedPayloadTransportShape(value)) {
    return { kind: 'invalid', reason: 'payload is not a ciphertext transport value' };
  }
  const bytes = Buffer.from(value, 'base64');
  const hasMagic = VAULT_OPERATION_MAGIC.every((byte, index) => bytes[index] === byte);
  if (!hasMagic) return { kind: 'legacy' };
  if (bytes.length < HEADER_LENGTH + MIN_GCM_BODY_LENGTH) {
    return { kind: 'invalid', reason: 'vault envelope is truncated' };
  }
  if (bytes[VAULT_OPERATION_MAGIC.length] !== VAULT_OPERATION_FORMAT_VERSION) {
    return { kind: 'invalid', reason: 'unsupported vault envelope version' };
  }
  const keyVersion = bytes.readDoubleBE(VAULT_OPERATION_MAGIC.length + 1);
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
    return { kind: 'invalid', reason: 'invalid vault payload generation' };
  }
  return { kind: 'vault', keyVersion };
};

export const matchesVaultPayloadGeneration = (
  payload: unknown,
  expected: number,
): boolean => {
  const inspected = inspectVaultPayloadGeneration(payload);
  return inspected.kind === 'vault' && inspected.keyVersion === expected;
};
