import {
  createReminderReconciler,
  reconcileReminderDelivery,
  type ReminderDeliveryPort,
} from '@heyta/app-host';

import { openTaskHost } from '../db/open-host';
import { onLocalWrite } from '../sync/write-signal';
import {
  consumeNativeDelivered,
  acknowledgeNativeDelivered,
  cancelStaleNativeReminders,
  reminderAuthorizationStatus,
  requestReminderAuthorization,
  peekNativeUncertainReminders,
  scheduleNativeReminder,
} from './reminder-native';

/** Mobile only supplies the native notification-center port. Protocol decisions live in app-host. */
async function reconcileOnce(): Promise<void> {
  const host = await openTaskHost();
  const delivery: ReminderDeliveryPort = {
    authorizationStatus: reminderAuthorizationStatus,
    schedule: scheduleNativeReminder,
    cancelStale: cancelStaleNativeReminders,
    peekDelivered: consumeNativeDelivered,
    acknowledgeDelivered: acknowledgeNativeDelivered,
  };
  await reconcileReminderDelivery(host, delivery, { maxPending: nativeReminderLimit() });
  const next = await peekNativeUncertainReminders();
  if (JSON.stringify(next) !== JSON.stringify(uncertainOccurrences)) {
    uncertainOccurrences = next;
    for (const listener of listeners) listener();
  }
}

// Local delivery evidence is a view input, never an op or shared reminder field.
let uncertainOccurrences: readonly string[] = [];
const listeners = new Set<() => void>();
export const getUncertainReminderOccurrences = (): readonly string[] => uncertainOccurrences;
export function subscribeReminderDelivery(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const reconcileNativeReminders = createReminderReconciler(reconcileOnce);

/** Local notifications must work offline; dataRevision only advances on sync. */
export function subscribeNativeReminderWrites(onError: (error: unknown) => void): () => void {
  return onLocalWrite(() => { void reconcileNativeReminders().catch(onError); });
}

/** The OS permission prompt need not cause an AppState change (notably Android).
 * Reconcile again when it completes, even if the reminder's write already fired
 * its dataRevision while authorization was still undetermined.
 */
export async function authorizeNativeReminders(): Promise<void> {
  await requestReminderAuthorization();
  await reconcileNativeReminders();
}

function nativeReminderLimit(): number | undefined {
  try {
    const rn = require('react-native') as { Platform?: { OS?: string } };
    return rn.Platform?.OS === 'ios' ? 64 : undefined;
  } catch {
    return undefined;
  }
}
