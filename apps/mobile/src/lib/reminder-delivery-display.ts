/**
 * 设置页「提醒送达」那一节的**判定层**（纯函数，不碰 RN）。
 *
 * 🔴 为什么单独抽出来：`apps/mobile/tests/` 下零 `.tsx`、也没有 RN 渲染设施
 * （先例与理由见 `tests/managed-tier-copy.spec.ts` 文件头）。"哪一行该出现、
 * 那一格该说什么词"全是会画错给用户看的东西 —— 它们必须能被断言，
 * 而不是作为组件里一段没人验证过的三元表达式。
 *
 * ⚠️ 三行各自问的是**不同的问句**，措辞不许并成一个：
 *   · 通知授权 / 精确闹钟 → "允许 / 未允许"；
 *   · 省电豁免 → "已豁免 / 受省电限制"。
 * 把第三种写成"未允许"会指错系统里那个开关。
 */

import { reminderPhase, type Reminder } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';

import type { BatteryFallback, NativeGate, NativeReminderPermission } from './reminder-native';

/** 三把闸门在这台设备上的读数（全部从原生读来，本层不判断任何业务）。 */
export interface DeliveryReadings {
  readonly notification: NativeReminderPermission;
  /** 这台设备**有没有**"本应用的通知设置"这一页；与授权状态无关。 */
  readonly settingsPage: NativeGate;
  readonly exactAlarm: NativeGate;
  readonly battery: NativeGate;
}

export type DeliveryRowId = 'notification' | 'exactAlarm' | 'battery';

export interface DeliveryRow {
  readonly id: DeliveryRowId;
  readonly testID: string;
  readonly labelKey: MessageKey;
  readonly valueKey: MessageKey;
  /** 没放行 ⇒ 用警示色（这一格的意思是"提醒可能不响"，不是中性读数）。 */
  readonly warning: boolean;
}

/** `'unsupported'` ⇒ 那道闸门在这台设备上**不存在** ⇒ 整行不渲染，而不是说成"未允许"。 */
export function deliveryRows(readings: DeliveryReadings, os: string): readonly DeliveryRow[] {
  const rows: DeliveryRow[] = [];

  if (readings.settingsPage !== 'unsupported') {
    rows.push({
      id: 'notification',
      testID: 'reminder-settings-notification',
      labelKey: 'reminder.settings.notification',
      valueKey: valueKey(readings.notification, 'reminder.settings.allowed', 'reminder.settings.notAllowed'),
      warning: readings.notification !== 'granted',
    });
  }
  if (os === 'android' && readings.exactAlarm !== 'unsupported') {
    rows.push({
      id: 'exactAlarm',
      testID: 'reminder-settings-exact-alarm',
      labelKey: 'reminder.settings.exactAlarm',
      valueKey: valueKey(readings.exactAlarm, 'reminder.settings.allowed', 'reminder.settings.notAllowed'),
      warning: readings.exactAlarm !== 'granted',
    });
  }
  if (os === 'android' && readings.battery !== 'unsupported') {
    rows.push({
      id: 'battery',
      testID: 'reminder-settings-battery',
      labelKey: 'reminder.settings.battery',
      valueKey: valueKey(readings.battery, 'reminder.settings.exempted', 'reminder.settings.optimized'),
      warning: readings.battery !== 'granted',
    });
  }
  return rows;
}

function valueKey(
  value: NativeReminderPermission | NativeGate,
  granted: MessageKey,
  denied: MessageKey,
): MessageKey {
  if (value === 'granted') return granted;
  // `'default'` = 系统**还没问过你**。说成"未允许"是在替用户做一个他没做过的决定。
  if (value === 'default') return 'reminder.settings.notAsked';
  return denied;
}

/**
 * 那一跳之后该说的话。
 *
 * 🔴 `'appSettings'` 不是成功也不是失败：这台 ROM 没有「忽略电池优化」那一页，
 * 原生退到了应用信息页。把它说成"已向你申请"是撒谎，说成"打不开"也不对，
 * 所以它必须有**自己的一句**。
 */
export function landingCopy(
  row: DeliveryRowId,
  result: boolean | BatteryFallback,
): { readonly key: MessageKey; readonly alert: boolean } | null {
  if (row === 'battery') {
    if (result === 'appSettings') return { key: 'reminder.settings.batteryLanding', alert: false };
    if (result === 'unavailable') return { key: 'reminder.settings.batteryFailed', alert: true };
    return null;
  }
  if (result !== false) return null;
  return {
    key: row === 'notification' ? 'reminder.settings.notificationFailed' : 'reminder.settings.exactAlarmFailed',
    alert: true,
  };
}

/** 提醒面（任务详情的提醒那一块）该说的降级话。 */
export interface ReminderFaceNotice {
  /** 是哪一句（"到点不会响" vs "可能迟到几分钟" —— 两个不同的主张，不许并成一句）。 */
  readonly key: MessageKey;
  /** 「去系统设置」这一跳该落到哪一行对应的系统页面。 */
  readonly row: DeliveryRowId;
  /**
   * 系统里到底有没有那一页可跳。
   *
   * 🔴 与"要不要说这句"是**两个问句**：通知被拒 ⇒ 到点不会响，这是事实，
   * 没有回头路也得说（不说就是让用户以为会响）；而那一个入口画不画，
   * 取决于这台设备给不给得出那一页 —— 画一个点了没反应的按钮比没有按钮更糟。
   */
  readonly canOpen: boolean;
}

/**
 * 提醒面那一句降级状态。
 *
 * 🔴 与设置页那一节的分工：设置页摊开**三道闸门各自**的读数（用户想去核对的地方），
 * 提醒面只说**当前这一刻最要紧的那一件事**。所以这里最多返回一句，优先级是
 * "根本不会响" > "会迟到" —— 通知被拒时准点不准点已经不重要了。
 *
 * 🔴 三档读数的处理各不相同，每一档都有会说错话的形状：
 * · `'denied'` ⇒ 说。这是用户已经做过的决定，且改不了（应用自己再也问不出弹窗）。
 * · `'default'`（系统还没问过）⇒ **不说**。那一刻系统弹窗正挂在屏幕上，
 *   界面上先写一句"到点不会响"是替用户做一个他还没做的决定。
 * · `'unsupported'` ⇒ 不说。这台设备没有那道闸门，说了就是让用户去找一个找不到的开关。
 *
 * ⚠️ 精确闹钟那一句仍然要求 `deliveryRows()` 里有这一行（= 这台设备是 Android 12+
 * 且真的读到了这个开关）；通知那一句不要求 —— 通知被拒这件事与"有没有那一页可跳"无关。
 * "这一行在这台设备上存在吗"复用 `deliveryRows()` 的答案，不在这里再判一遍平台条件：
 * 两处各写一份 `os === 'android'` 就会漂成"设置页有、提醒面没有"。
 *
 * ⚠️ "还没有响的提醒"一条都没有时返回 `null`（空列表上方凭空报警是没有证据的告警）。
 * 判"算不算还没有响"走领域层那一个 `reminderPhase`，不在这里写第二份
 * `firedAt === undefined` —— 与 `deliveryUncertain` 不渲染结束态是同一条纪律。
 */
export function reminderFaceNotice(
  readings: DeliveryReadings,
  os: string,
  reminders: readonly Reminder[],
  at: number,
): ReminderFaceNotice | null {
  const pending = reminders.filter((reminder) => {
    const phase = reminderPhase(reminder, at);
    return phase !== 'fired' && phase !== 'dismissed';
  });
  if (pending.length === 0) return null;
  const present = new Set(deliveryRows(readings, os).map((row) => row.id));
  // 🔴 Android 上"授权还在、通知总开关被关掉"是真会发生的组合
  //（`notificationSettingsStatus()` 读的是那个开关，不是授权），
  // 那一刻同样一条都不会响。只看 `notification` 会在这种时候保持沉默。
  const notificationBlocked = readings.notification === 'denied' || readings.settingsPage === 'denied';
  if (notificationBlocked) {
    return { key: 'reminder.delivery.blockedNotification', row: 'notification', canOpen: present.has('notification') };
  }
  if (readings.exactAlarm === 'denied' && present.has('exactAlarm')) {
    return { key: 'reminder.delivery.blockedExactAlarm', row: 'exactAlarm', canOpen: true };
  }
  return null;
}
