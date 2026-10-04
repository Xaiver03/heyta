/**
 * Non-secret, account-scoped guidance for a device revoke.
 *
 * The server invalidates every session when one device is revoked. The
 * surviving user must therefore see the root-rotation instruction again after
 * remounting the settings screen. This is a device preference, never sync
 * data, and it is cleared only after a successful root rotation.
 */

import { deleteDevicePref, readDevicePref, writeDevicePref } from '../prefs/device-prefs';

const PREFIX = 'vault.deviceRevocationGuidance.v1:';

function key(accountId: string, serverUrl: string): string | undefined {
  const account = accountId.trim();
  if (account === '') return undefined;
  try {
    return `${PREFIX}${new URL(serverUrl).origin}\u0000${account}`;
  } catch {
    return undefined;
  }
}

export interface DeviceRevocationGuidancePrefs {
  readonly read: (key: string) => string | undefined;
  readonly write: (key: string, value: string) => boolean;
  readonly remove: (key: string) => boolean;
}

export function createDeviceRevocationGuidanceStore(prefs: DeviceRevocationGuidancePrefs) {
  return {
    has(accountId: string, serverUrl: string): boolean {
      const guidanceKey = key(accountId, serverUrl);
      return guidanceKey !== undefined && prefs.read(guidanceKey) === 'pending';
    },
    save(accountId: string, serverUrl: string): boolean {
      const guidanceKey = key(accountId, serverUrl);
      return guidanceKey !== undefined && prefs.write(guidanceKey, 'pending');
    },
    clear(accountId: string, serverUrl: string): boolean {
      const guidanceKey = key(accountId, serverUrl);
      return guidanceKey !== undefined && prefs.remove(guidanceKey);
    },
  };
}

const productionStore = createDeviceRevocationGuidanceStore({
  read: readDevicePref,
  write: writeDevicePref,
  remove: deleteDevicePref,
});

export function hasDeviceRevocationGuidance(accountId: string, serverUrl: string): boolean {
  return productionStore.has(accountId, serverUrl);
}

export function saveDeviceRevocationGuidance(accountId: string, serverUrl: string): boolean {
  return productionStore.save(accountId, serverUrl);
}

export function clearDeviceRevocationGuidance(accountId: string, serverUrl: string): boolean {
  return productionStore.clear(accountId, serverUrl);
}
