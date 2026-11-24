/**
 * 已存视图（D1 ①）
 *
 * 裁决（计划 D1 那节）：能存什么 = TaskFilter 联合的一个值（不做自由构造器）；
 * 跨不跨端 = v1 本地不同步；谁能改 = 本地 ⇒ 不产生 op。
 */

import { randomId } from '@heyta/app-host';
import type { TaskFilter } from '@heyta/domain';

export interface SavedFilter {
  readonly id: string;
  readonly name: string;
  readonly filter: TaskFilter;
}

const STORAGE_KEY = 'heyta.filters.saved';

export function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSavedFilters(filters: SavedFilter[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

export function addSavedFilter(name: string, filter: TaskFilter): SavedFilter[] {
  const list = loadSavedFilters();
  const entry: SavedFilter = { id: randomId(), name, filter };
  const next = [...list, entry];
  saveSavedFilters(next);
  return next;
}

export function removeSavedFilter(id: string): SavedFilter[] {
  const next = loadSavedFilters().filter((f) => f.id !== id);
  saveSavedFilters(next);
  return next;
}

/**
 * 命中某一筛选值的已存视图名（没有则 `undefined`）。
 *
 * 用在页头标题：套用一条组合筛选后，标题显示用户给它起的名字，比一个泛泛的
 * 「筛选结果」有用。比较用 `JSON.stringify` —— 这些筛选都是浅层、字段稳定的
 * 字面量对象，序列化即值相等（与 `FilterPanel.sameFilter` 同一条口径）。
 */
export function savedFilterNameOf(filter: TaskFilter): string | undefined {
  const target = JSON.stringify(filter);
  return loadSavedFilters().find((entry) => JSON.stringify(entry.filter) === target)?.name;
}
