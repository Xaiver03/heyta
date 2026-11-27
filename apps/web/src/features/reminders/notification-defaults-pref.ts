/**
 * 通知行为默认值的**本机持久化**（#57）
 * =====================================
 * 判断（取值范围 / 回落）在 `@heyta/domain` 的 `notification-defaults.ts`；
 * 这里只做读 / 写 localStorage。读失败退默认、写失败静默（同 modules / smart-list）。
 */

import {
  DEFAULT_NOTIFICATION_DEFAULTS,
  normalizeNotificationDefaults,
  type NotificationDefaults,
} from '@heyta/domain';

const STORAGE_KEY = 'heyta.reminders.defaults';

export function loadNotificationDefaults(): NotificationDefaults {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_NOTIFICATION_DEFAULTS;
    return normalizeNotificationDefaults(JSON.parse(raw));
  } catch {
    return DEFAULT_NOTIFICATION_DEFAULTS;
  }
}

export function saveNotificationDefaults(defaults: NotificationDefaults): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // 存不上不影响本次生效。
  }
}
