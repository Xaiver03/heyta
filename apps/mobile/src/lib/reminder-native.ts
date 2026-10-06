/** 移动端原生提醒桥：系统投递与 op-log 事实之间的唯一边界。 */

export type NativeReminderPermission = 'granted' | 'denied' | 'default' | 'unsupported';

interface NativeReminderModule {
  authorizationStatus(): Promise<string>;
  requestAuthorization(): Promise<string>;
  schedule(id: string, atMs: number, title: string, body: string): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  cancelStale(keepIds: readonly string[], pendingIds: readonly string[]): Promise<boolean>;
  peekDelivered(): Promise<readonly string[]>;
  /** iOS can lose OS delivery evidence after a notification is cleared. */
  peekUncertain?(): Promise<readonly string[]>;
  acknowledgeDelivered(ids: readonly string[]): Promise<boolean>;
}

function module(): NativeReminderModule | undefined {
  try {
    const rn = require('react-native') as { NativeModules?: Record<string, unknown> };
    return rn.NativeModules?.HeytaReminder as NativeReminderModule | undefined;
  } catch {
    return undefined;
  }
}

let warned = false;
function native(): NativeReminderModule | undefined {
  const found = module();
  if (found === undefined && !warned) {
    warned = true;
    console.warn('[reminder] 当前平台没有原生提醒模块，提醒保持为未投递状态');
  }
  return found;
}

export async function requestReminderAuthorization(): Promise<NativeReminderPermission> {
  const found = native();
  if (found === undefined) return 'unsupported';
  try {
    const result = await found.requestAuthorization();
    return result === 'granted' || result === 'denied' || result === 'default'
      ? result
      : 'denied';
  } catch (error) {
    console.warn('[reminder] 请求通知权限失败：', error);
    return 'denied';
  }
}

export async function reminderAuthorizationStatus(): Promise<NativeReminderPermission> {
  const found = native();
  if (found === undefined) return 'unsupported';
  try {
    const result = await found.authorizationStatus();
    return result === 'granted' || result === 'denied' || result === 'default' ? result : 'denied';
  } catch { return 'denied'; }
}

export async function scheduleNativeReminder(
  id: string,
  atMs: number,
  title: string,
  body: string,
): Promise<boolean> {
  const found = native();
  if (found === undefined) return false;
  try {
    return await found.schedule(id, atMs, title, body);
  } catch (error) {
    console.warn('[reminder] 排程失败：', error);
    return false;
  }
}

export async function cancelNativeReminder(id: string): Promise<boolean> {
  const found = native();
  if (found === undefined) return false;
  try {
    return await found.cancel(id);
  } catch (error) {
    console.warn('[reminder] 取消排程失败：', error);
    return false;
  }
}

export async function cancelStaleNativeReminders(keepIds: readonly string[], pendingIds: readonly string[]): Promise<boolean> {
  const found = native();
  if (found === undefined) return false;
  try { return await found.cancelStale(keepIds, pendingIds); } catch (error) {
    console.warn('[reminder] 清理过期排程失败：', error);
    return false;
  }
}

export async function consumeNativeDelivered(): Promise<readonly string[]> {
  const found = native();
  if (found === undefined) return [];
  try {
    const ids = await found.peekDelivered();
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch (error) {
    console.warn('[reminder] 回收已投递提醒失败：', error);
    throw error;
  }
}

export async function acknowledgeNativeDelivered(ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const found = native();
  if (found === undefined) return false;
  try { return await found.acknowledgeDelivered(ids); } catch { return false; }
}

export async function peekNativeUncertainReminders(): Promise<readonly string[]> {
  const found = native();
  if (found?.peekUncertain === undefined) return [];
  const ids = await found.peekUncertain();
  return ids.filter((id): id is string => typeof id === 'string');
}

export function resetReminderNativeWarningForTests(): void {
  warned = false;
}
