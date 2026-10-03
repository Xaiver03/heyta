import { describe, expect, it } from 'vitest';
import { vaultKeyPackageSchema, vaultKeyPackageUploadSchema } from '../src';

const wrapped = {
  kdf: 'argon2id' as const,
  salt: `${'A'.repeat(22)}==`,
  iv: 'A'.repeat(16),
  ciphertext: 'A'.repeat(64),
};
const valid = {
  version: 1 as const,
  keyVersion: 1,
  rootKeyFingerprint: 'a'.repeat(64),
  passphrase: wrapped,
  recovery: wrapped,
};

describe('opaque vault key-package contract', () => {
  it('accepts the package without any plaintext secret field', () => {
    expect(vaultKeyPackageUploadSchema.parse({ package: valid, expectedKeyVersion: 0 })).toEqual({
      package: valid,
      expectedKeyVersion: 0,
    });
    expect(JSON.stringify(valid)).not.toContain('"rootKey"');
    expect(JSON.stringify(valid)).not.toContain('"recoveryCode"');
  });

  it('rejects key-package version and fingerprint mutations', () => {
    expect(vaultKeyPackageSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
    expect(vaultKeyPackageSchema.safeParse({ ...valid, rootKeyFingerprint: 'z'.repeat(64) }).success).toBe(false);
    expect(vaultKeyPackageSchema.safeParse({ ...valid, keyVersion: 0 }).success).toBe(false);
  });

  it('rejects malformed wrappers and unknown fields', () => {
    expect(vaultKeyPackageSchema.safeParse({
      ...valid,
      passphrase: { ...wrapped, salt: 'salt' },
    }).success).toBe(false);
    expect(vaultKeyPackageSchema.safeParse({
      ...valid,
      passphrase: { ...wrapped, iv: `${'A'.repeat(15)}!` },
    }).success).toBe(false);
    expect(vaultKeyPackageSchema.safeParse({
      ...valid,
      passphrase: { ...wrapped, extra: true },
    }).success).toBe(false);
    expect(vaultKeyPackageSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });

  it('requires an exact one-step expected-version advance on upload', () => {
    expect(vaultKeyPackageUploadSchema.safeParse({ package: valid, expectedKeyVersion: 0 }).success).toBe(true);
    expect(vaultKeyPackageUploadSchema.safeParse({ package: valid, expectedKeyVersion: 1 }).success).toBe(false);
    expect(vaultKeyPackageUploadSchema.safeParse({ package: valid, expectedKeyVersion: -1 }).success).toBe(false);
    expect(vaultKeyPackageUploadSchema.safeParse({ package: valid }).success).toBe(false);
  });
});
