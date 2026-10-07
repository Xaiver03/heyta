/**
 * Rail 布局是这台设备上的阅读偏好，不是同步数据。
 *
 * 用户可以把常用视图固定到 rail、把低频视图收进 More，或调整顺序。
 * 这份偏好只保存 key，不写 op-log，也不跨设备同步；功能模块关闭后，
 * 不会把已经关闭的视图重新画回来。
 */

import type { ViewKey } from './view-tabs.js';

export interface RailPreference {
  readonly primary: readonly ViewKey[];
  readonly overflow: readonly ViewKey[];
}

const STORAGE_KEY = 'heyta.shell.rail';

function isViewKey(value: unknown): value is ViewKey {
  return typeof value === 'string' && [
    'tasks', 'search', 'calendar', 'quadrant', 'habits', 'focus', 'timeline', 'growth', 'notes', 'countdown', 'trash', 'settings',
  ].includes(value);
}

function readKeys(value: unknown): ViewKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isViewKey);
}

export function loadRailPreference(): RailPreference | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const value = parsed as { primary?: unknown; overflow?: unknown };
    const primary = readKeys(value.primary);
    const overflow = readKeys(value.overflow);
    if (primary.length === 0 && overflow.length === 0) return undefined;
    return { primary, overflow };
  } catch {
    return undefined;
  }
}

export function saveRailPreference(preference: RailPreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // 隐私模式或存储配额失败不影响本次布局。
  }
}

export function clearRailPreference(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 读写本地偏好永不阻断应用启动。
  }
}

