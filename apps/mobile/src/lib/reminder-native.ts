/** 移动端原生提醒桥：系统投递与 op-log 事实之间的唯一边界。 */

export type NativeReminderPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/**
 * 系统**闸门**的词表（与 `NativeReminderPermission` 不是一套词）。
 *
 * 🔴 为什么单独一套：这三道门（通知设置页 / 精确闹钟 / 省电豁免）里，
 * iOS **根本没有**后两道，Android 6.0 以下也没有省电豁免这道。
 * 把"这台设备上不存在这个开关"说成"你没允许"，用户会去找一个找不到的开关 ——
 * 所以 `unsupported` 必须是**独立的一档**，界面上那一行**整行消失**
 *（判据在 `reminder-delivery-display.ts`，那里把它从行列表里剔掉）。
 */
export type NativeGate = 'granted' | 'denied' | 'unsupported';

/**
 * 「忽略电池优化」那一跳的**落点**。
 *
 * 🔴 三档各说一句不同的话（`landingCopy`）：
 * · `'requested'` —— 系统那一页真的起来了（什么都不必补，说了就是抢用户的话）；
 * · `'appSettings'` —— 这台 ROM 把电池优化页摘了，原生退到**应用信息页**。
 *   那一页上没有一个叫"忽略电池优化"的开关，所以不许说成"已向你要过授权"；
 * · `'unavailable'` —— 两个页面都起不来 ⇒ 如实说没打开。
 */
export type BatteryFallback = 'requested' | 'appSettings' | 'unavailable';

interface NativeReminderModule {
  authorizationStatus(): Promise<string>;
  requestAuthorization(): Promise<string>;
  /** 系统「通知」设置页在不在、能不能跳（iOS: `app-settings:`；Android: `ACTION_APP_NOTIFICATION_SETTINGS`）。
   *  🔴 两端**同一个名字**：这个名字在 TS 侧是可选的，原生拼错了界面只会看到
   *  `unsupported` —— 而那是"这平台没有这一档"的读数，拼错就永久伪装成平台差异。 */
  openNotificationSettings?(): Promise<boolean>;
  /** `NotificationManager.areNotificationsEnabled()` 那一档；iOS 上不给（见下面的兜底）。 */
  notificationSettingsStatus?(): Promise<string>;
  /** `AlarmManager.canScheduleExactAlarms()`；Android 12 以下不给 ⇒ `unsupported`。 */
  exactAlarmStatus?(): Promise<string>;
  /** 拉 `ACTION_REQUEST_SCHEDULE_EXACT_ALARM` 那一页。回 `false` = 这台机器上没有那一页。 */
  requestExactAlarmPermission?(): Promise<boolean>;
  /** `PowerManager.isIgnoringBatteryOptimizations()`；Android 6.0 以下不给 ⇒ `unsupported`。 */
  batteryOptimizationStatus?(): Promise<string>;
  /** 拉电池优化白名单页；ROM 摘掉那一页时退到应用信息页（落点由返回值说话）。 */
  openBatteryOptimizationSettings?(): Promise<string>;
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

/** 把原生回的那个字符串折成 `NativeGate`；认不出一律 `unsupported`（"读不到"≠"被拒"）。 */
function asGate(value: unknown): NativeGate {
  return value === 'granted' || value === 'denied' ? value : 'unsupported';
}

/**
 * 「这一行能不能出现」的兜底表。
 *
 * 🔴 模块**没实现**某个方法时不许猜：
 * · iOS 没实现某个方法 ⇒ 那一行也不该出现（`unsupported`）；
 * · 但 `notificationSettingsStatus` 在 iOS 上**本来就不存在**（iOS 没有
 *   "通知总开关被关掉而授权还在"这一档），所以按"不构成阻碍"回 `granted`，
 *   由界面那一行照常给出 `app-settings:` 的入口 —— 那个入口在 iOS 上真的能用。
 */
const gateWhenAbsent: Record<'notification' | 'exactAlarm' | 'battery', NativeGate> = {
  notification: 'granted',
  exactAlarm: 'unsupported',
  battery: 'unsupported',
};

/** 设置页那一行的读数：通知总开关（Android 有；iOS 退到上面那张表）。 */
export async function notificationSettingsStatus(): Promise<NativeGate> {
  const found = native();
  if (found?.notificationSettingsStatus === undefined) return gateWhenAbsent.notification;
  try {
    return asGate(await found.notificationSettingsStatus());
  } catch {
    return 'unsupported';
  }
}

/** 精确闹钟这道门（Android 12+ 才有）。 */
export async function exactAlarmStatus(): Promise<NativeGate> {
  const found = native();
  if (found?.exactAlarmStatus === undefined) return gateWhenAbsent.exactAlarm;
  try {
    return asGate(await found.exactAlarmStatus());
  } catch {
    return 'unsupported';
  }
}

/** 省电豁免这道门（Android 6+ 才有）。豁免 = `granted`，受限制 = `denied`。 */
export async function batteryOptimizationStatus(): Promise<NativeGate> {
  const found = native();
  if (found?.batteryOptimizationStatus === undefined) return gateWhenAbsent.battery;
  try {
    return asGate(await found.batteryOptimizationStatus());
  } catch {
    return 'unsupported';
  }
}

/** 跳系统「通知」设置。`false` = 这一跳没成，界面要说"没能打开"，不许沉默。 */
export async function openNotificationSettings(): Promise<boolean> {
  const found = native();
  if (found?.openNotificationSettings === undefined) return false;
  try {
    return (await found.openNotificationSettings()) === true;
  } catch {
    return false;
  }
}

/**
 * 跳「创建精确闹钟」那一页（`ACTION_REQUEST_SCHEDULE_EXACT_ALARM`）。
 *
 * ⚠️ 只由设置页那一行**在用户手势里**触发。系统在这里**不回话**
 *（那一页是设置页，用户拨完不会给应用一个回调），所以本函数只回答
 * "那一页起来了吗"，不回答"用户最后选了啥" —— 后者由回前台时重读 `exactAlarmStatus()` 拿到。
 */
export async function requestExactAlarmPermission(): Promise<boolean> {
  const found = native();
  if (found?.requestExactAlarmPermission === undefined) return false;
  try {
    return (await found.requestExactAlarmPermission()) === true;
  } catch {
    return false;
  }
}

/** 跳「忽略电池优化」，并把**落点**如实交回来（三档三句话，见 `BatteryFallback`）。 */
export async function openBatteryOptimizationSettings(): Promise<BatteryFallback> {
  const found = native();
  if (found?.openBatteryOptimizationSettings === undefined) return 'unavailable';
  try {
    const value = await found.openBatteryOptimizationSettings();
    return value === 'requested' || value === 'appSettings' ? value : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function resetReminderNativeWarningForTests(): void {
  warned = false;
}
