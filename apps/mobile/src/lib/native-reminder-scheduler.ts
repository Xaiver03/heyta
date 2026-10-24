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
  type NativeReminderPermission,
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
    notifyDeliveryListeners();
  }
}

// Local delivery evidence is a view input, never an op or shared reminder field.
let uncertainOccurrences: readonly string[] = [];
const listeners = new Set<() => void>();
export const getUncertainReminderOccurrences = (): readonly string[] => uncertainOccurrences;
function notifyDeliveryListeners(): void {
  for (const listener of listeners) listener();
}
export function subscribeReminderDelivery(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const reconcileNativeReminders = createReminderReconciler(reconcileOnce);

/** Local notifications must work offline; dataRevision only advances on sync. */
export function subscribeNativeReminderWrites(onError: (error: unknown) => void): () => void {
  return onLocalWrite(() => { void reconcileNativeReminders().catch(onError); });
}

/**
 * 上次交给界面的授权读数；`null` = 本进程还没问过系统。
 *
 * 🔴 为什么界面需要这一声：iOS/Android 的**授权弹窗不把应用退到后台**（它盖在界面之上），
 * 用户答完那一句时 `AppState` 根本不变。少了这一声通知，提醒面那句"到点不会响"
 * 会一直挂着，直到用户自己把应用切出去再切回来 —— 而那一行的意思恰恰是"现在还没放行"。
 */
let lastAuthorization: NativeReminderPermission | null = null;

/**
 * 向系统要通知权限，并把**结果交回去**（调用方与界面据此刷新，不再吞掉）。
 *
 * ⚠️ 返回的是系统那一刻的读数，不是"用户点了什么"：Android 上请求不会弹（权限装在清单里），
 * 回的是 `granted`/`denied`；iOS 上用户拒掉就是 `denied`，永远不再变。
 */
export async function authorizeNativeReminders(): Promise<NativeReminderPermission> {
  const status = await requestReminderAuthorization();
  await reconcileNativeReminders();
  if (lastAuthorization !== status) {
    lastAuthorization = status;
    notifyDeliveryListeners();
  }
  return status;
}

function nativeReminderLimit(): number | undefined {
  try {
    const rn = require('react-native') as { Platform?: { OS?: string } };
    return rn.Platform?.OS === 'ios' ? 64 : undefined;
  } catch {
    return undefined;
  }
}
