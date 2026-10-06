/**
 * The shared security half of mobile logout and device revocation.
 *
 * Both paths must fence the remembered-unlock preference, invalidate the
 * already-open host synchronously, clear live credentials, and then remove the
 * native root-key item. Keeping that order in one injectable function prevents
 * a new caller from accidentally implementing the weaker "clear token only"
 * path.
 */

import {
  disableVaultRootAutoUnlock,
  removeVaultRootKey,
  type VaultSecureStorageScope,
} from './vault-secure-storage';
import { invalidateTaskHostVaultSession } from '../db/open-host';
import { clearSyncConfig } from '../sync/config';

export type VaultSessionCleanupDependencies = {
  readonly invalidateSession: () => void;
  readonly clearCredentials: () => void;
  readonly disableAutoUnlock: (scope: VaultSecureStorageScope) => void;
  readonly removeRootKey: (scope: VaultSecureStorageScope) => Promise<void>;
};

export type VaultSessionCleanupResult = {
  readonly secureStorageError?: unknown;
};

const productionDependencies: VaultSessionCleanupDependencies = {
  invalidateSession: invalidateTaskHostVaultSession,
  clearCredentials: clearSyncConfig,
  disableAutoUnlock: disableVaultRootAutoUnlock,
  removeRootKey: removeVaultRootKey,
};

/**
 * Clear the current mobile auth session. Cleanup errors are returned after the
 * auth fence has completed so callers can offer an explicit retry without
 * leaving credentials or a live vault session behind.
 */
export async function clearMobileVaultSession(
  scope: VaultSecureStorageScope | undefined,
  overrides: Partial<VaultSessionCleanupDependencies> = {},
): Promise<VaultSessionCleanupResult> {
  const deps = { ...productionDependencies, ...overrides };
  let secureStorageError: unknown;
  if (scope !== undefined) {
    try {
      deps.disableAutoUnlock(scope);
    } catch (error) {
      secureStorageError = error;
    }
  }
  deps.invalidateSession();
  deps.clearCredentials();
  if (scope !== undefined) {
    try {
      await deps.removeRootKey(scope);
    } catch (error) {
      secureStorageError ??= error;
    }
  }
  return secureStorageError === undefined ? {} : { secureStorageError };
}
