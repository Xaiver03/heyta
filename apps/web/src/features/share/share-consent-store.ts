/**
 * 共享同意态（PIPL 23 那一步的凭证）的**读写真源**。
 *
 * 这个键原来住在 `ShareFeature.tsx` 的模块体里，于是只有 owner 那一屏读得到它。
 * ADR-0071 之后通知路径也要读它（没同意过 ⇒ 一条都不响），而磁盘上的同意**只许有一份**：
 * 两个读者各自 `JSON.parse` 各自的口径，就等于没有真相（同 `share-notif-prefs.ts` 那条理由）。
 *
 * 🔴 只落本地、不出网。
 */

import type { ShareConsentStore } from '@heyta/ui';

export const CONSENT_STORAGE_KEY = 'heyta.share-consent.v1';

export function loadShareConsent(storage: Storage): ShareConsentStore {
  try {
    const raw = storage.getItem(CONSENT_STORAGE_KEY);
    return raw === null ? {} : (JSON.parse(raw) as ShareConsentStore);
  } catch {
    return {};
  }
}

export function saveShareConsent(storage: Storage, store: ShareConsentStore): void {
  storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(store));
}
