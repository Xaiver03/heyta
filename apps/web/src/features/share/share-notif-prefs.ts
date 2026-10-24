/**
 * 共享清单偏好（设置 → 同步与隐私 里那一节）的**读写真源**。
 *
 * 原来这两件事写在 `ShareNotificationSettings.tsx` 里面，于是只有那节界面读得到偏好；
 * M5 把「响不响」接进通知投递之后，**第二个读者**出现了 —— 而偏好只有一份真相，
 * 不能每个读者各自 `JSON.parse` 一遍各自的口径（磁盘上的坏数据谁回填谁说了算）。
 *
 * 🔴 只落本地、不出网（ADR-0062 决策 7：服务端零知识，改这些开关是零请求）。
 */

import { DEFAULT_NOTIFICATION_PREFS, type ShareNotificationPrefs } from '@heyta/ui';

export const PREFS_STORAGE_KEY = 'heyta.share-notif-prefs.v1';

export function loadShareNotificationPrefs(storage: Storage): ShareNotificationPrefs {
  try {
    const raw = storage.getItem(PREFS_STORAGE_KEY);
    if (raw === null) return DEFAULT_NOTIFICATION_PREFS;
    const parsed: Partial<ShareNotificationPrefs> = JSON.parse(raw) as Partial<ShareNotificationPrefs>;
    // 逐字段回填而不是整块信任磁盘：坏数据回落默认值，不让一个键拖垮整节。
    return {
      activities: {
        onCompleted:
          parsed.activities?.onCompleted ?? DEFAULT_NOTIFICATION_PREFS.activities.onCompleted,
        onAdded: parsed.activities?.onAdded ?? DEFAULT_NOTIFICATION_PREFS.activities.onAdded,
        onDeleted: parsed.activities?.onDeleted ?? DEFAULT_NOTIFICATION_PREFS.activities.onDeleted,
      },
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function saveShareNotificationPrefs(storage: Storage, prefs: ShareNotificationPrefs): void {
  storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
}
