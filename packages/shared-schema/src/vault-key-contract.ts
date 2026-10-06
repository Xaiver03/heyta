import { z } from 'zod';

const base64OfBytes = (bytes: number) => {
  const encodedLength = Math.ceil(bytes / 3) * 4;
  return z.string()
    .length(encodedLength)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .refine((value) => {
      const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
      return Math.floor((value.length * 3) / 4) - padding === bytes;
    }, `must be canonical base64 for ${bytes} bytes`);
};

const safePositiveInteger = z.number().int().positive().refine(Number.isSafeInteger, 'must be a safe integer');
const safeNonNegativeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger, 'must be a safe integer');

/**
 * Opaque key-package transport. The server may store and return this object,
 * but it cannot open either wrapper and must never receive rootKey/recoveryCode.
 */
export const VAULT_KEY_PATHS = {
  package: 'sync/key-package',
  devices: 'sync/devices',
} as const;

export const wrappedVaultKeySchema = z.object({
  kdf: z.literal('argon2id'),
  salt: base64OfBytes(16),
  iv: base64OfBytes(12),
  ciphertext: base64OfBytes(48),
}).strict();

export const vaultKeyPackageSchema = z.object({
  version: z.literal(1),
  keyVersion: safePositiveInteger,
  rootKeyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  passphrase: wrappedVaultKeySchema,
  recovery: wrappedVaultKeySchema,
}).strict();

export const vaultKeyPackageUploadSchema = z.object({
  package: vaultKeyPackageSchema,
  expectedKeyVersion: safeNonNegativeInteger,
}).strict().superRefine((value, ctx) => {
  if (value.package.keyVersion !== value.expectedKeyVersion + 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['package', 'keyVersion'],
      message: 'keyVersion must advance exactly one version from expectedKeyVersion',
    });
  }
});

/**
 * GET response. `payloadKeyVersion` is the active ciphertext generation and
 * deliberately stays separate from the wrapper/package revision: changing an
 * E2EE passphrase rewrites wrappers without rewriting every operation.
 */
export const vaultKeyPackageResponseSchema = z.object({
  package: vaultKeyPackageSchema,
  payloadKeyVersion: safePositiveInteger.nullable(),
}).strict();

export type WrappedVaultKeyContract = z.infer<typeof wrappedVaultKeySchema>;
export type VaultKeyPackageContract = z.infer<typeof vaultKeyPackageSchema>;
export type VaultKeyPackageUpload = z.infer<typeof vaultKeyPackageUploadSchema>;
export type VaultKeyPackageResponse = z.infer<typeof vaultKeyPackageResponseSchema>;
