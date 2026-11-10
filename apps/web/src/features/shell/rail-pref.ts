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

/**
 * rail 布局里**认得的** view key。
 *
 * 🔴 **F-04**（2026-11-10）：这份名单曾经是**手抄**的 12 个字面量，
 * 与 `view-tabs.ts` 的 `ViewKey` 联合类型**没有任何对账** ——
 * `ViewKey` 加了成员而这里没跟，那个视图就**静默地不可固定**
 *（存进 localStorage 也会被下面的 `readKeys()` 过滤掉），
 * 而不会有任何判据变红。
 *
 * 实测代价：`kanban` 就是这么漏的（它与"不在 `FEATURE_MODULE_KEYS` 里"
 * 一起构成两条入口全断，见 `.ai-night-audit/2026-11-10/03-findings.md` F-01）。
 *
 * ⚠️ 为什么**仍然**要有一份运行时名单、而不直接用类型：这个函数判的是
 * **从 localStorage 读回来的 `unknown`** —— 用户可以手改、旧版本可能写进过
 * 已删除的 key。类型在运行时不存在，所以名单必须在。
 * 但这份名单现在是 `Record<ViewKey, true>`，**少一个 key 就是编译错误**。
 */
export const RAIL_VIEW_KEYS: Readonly<Record<ViewKey, true>> = {
  tasks: true,
  search: true,
  calendar: true,
  quadrant: true,
  kanban: true,
  habits: true,
  focus: true,
  timeline: true,
  growth: true,
  notes: true,
  countdown: true,
  trash: true,
  settings: true,
};

function isViewKey(value: unknown): value is ViewKey {
  return typeof value === 'string' && Object.hasOwn(RAIL_VIEW_KEYS, value);
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

