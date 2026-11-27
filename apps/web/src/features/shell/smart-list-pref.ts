/**
 * 智能清单显示配置的**本机持久化**（#18）
 * =====================================
 *
 * 判断（词表 / 归并 / 排序）住在 `@heyta/domain` 的 `smart-list.ts`；
 * 这里只做两件事：从 localStorage 读、写回 localStorage。
 *
 * 与 `modules.ts` / `rail-pref.ts` 同一条纪律：**这是这台设备的界面偏好，
 * 不进 op-log、不跨设备同步**；读失败退到默认值、写失败静默（隐私模式下 localStorage 会抛，
 * 而"读不到偏好"绝不等于"应用起不来"）。
 */

import {
  DEFAULT_SMART_LIST_CONFIG,
  normalizeSmartListConfig,
  type SmartListConfig,
} from '@heyta/domain';

const STORAGE_KEY = 'heyta.shell.smartList';

export function loadSmartListConfig(): SmartListConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SMART_LIST_CONFIG;
    return normalizeSmartListConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_SMART_LIST_CONFIG;
  }
}

export function saveSmartListConfig(config: SmartListConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 存不上不影响本次生效（与 theme / modules 同）。
  }
}
