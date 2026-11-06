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
