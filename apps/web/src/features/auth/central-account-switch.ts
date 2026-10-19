import { getCentralAuthSession } from '@heyta/app-host';

import { consentFetch } from '../privacy/consent-gate.js';
import { useSyncStore } from '../sync/store.js';
import { bindCentralAccount, centralAccountBindingExists, centralAccountBindingSnapshot, withCentralAccountBindingLock } from '../../lib/central-account-binding.js';
import { eraseWebLocalData, WEB_DATABASE_NAMES } from '../../lib/local-data-destruction.js';

export type CentralAccountSwitchResult = 'cleared' | 'session-changed' | 'erasure-incomplete';

/** Only a deliberate user action after JSON export may call this operation. */
export async function clearLocalDataForCentralAccountSwitch(
  baseUrl: string,
  expectedBinding: string | null,
): Promise<CentralAccountSwitchResult> {
  const state = useSyncStore.getState();
  const target = state.centralBindingTarget;
  if (state.centralBindingConflict !== 'mismatch' || !target || state.centralAccountSwitching ||
      expectedBinding === null || expectedBinding === 'unavailable' ||
      centralAccountBindingSnapshot() !== expectedBinding) return 'session-changed';
  try {
    if (new URL(baseUrl).origin !== target.origin) return 'session-changed';
  } catch { return 'session-changed'; }

  const session = await getCentralAuthSession({ baseUrl, fetchImpl: consentFetch });
  if (!session.ok || !session.value.authenticated || String(session.value.user.id) !== target.subject ||
      centralAccountBindingSnapshot() !== expectedBinding) return 'session-changed';

  const result = await withCentralAccountBindingLock(async (): Promise<CentralAccountSwitchResult> => {
    if (centralAccountBindingSnapshot() !== expectedBinding ||
        useSyncStore.getState().centralBindingTarget?.subject !== target.subject) return 'session-changed';
    useSyncStore.getState().beginCentralAccountSwitch();
    if (!useSyncStore.getState().centralAccountSwitching) return 'session-changed';
    let cleared = false;
    try {
      const reports = await eraseWebLocalData(expectedBinding);
      const erased = reports.length >= WEB_DATABASE_NAMES.length + 5 &&
        reports.every((item) => item.containerRemoved) && !centralAccountBindingExists();
      // Pin only the confirmed target before releasing the cross-tab lock.
      cleared = erased && bindCentralAccount(baseUrl, target.subject) === 'bound';
      return cleared ? 'cleared' : 'erasure-incomplete';
    } catch {
      return 'erasure-incomplete';
    } finally {
      if (!cleared) useSyncStore.getState().finishCentralAccountSwitch();
    }
  });
  return result ?? 'erasure-incomplete';
}
