/**
 * 选中态（移动壳）
 * ==================
 *
 * 与 Web 壳同一份实现：状态机、词表、回落规则全在
 * `@heyta/app-host` 的 `selection.ts`。这里只有宿主必须自己给的三样
 * （单例 / React 绑定 / 实体存在性的来源）。
 *
 * 🔴 此前本壳有两个这样的状态：`TasksScreen` 的 `detailTaskId` 与
 * `HabitsScreen` 的 `selectedId`，各自 `useState`、各自的回落规则，
 * 而且**互相不认识** —— 在任务页选中一条、切到习惯页再切回来，
 * 两边的"上一个选中"是两个互不相干的记忆。收成一份之后，
 * 跨视图保持选中是默认行为，不是要各屏再实现一次的功能。
 *
 * ⚠️ `useSyncExternalStore` 是 React 自带的订阅原语，本壳在
 * `sync/store.ts`、`lib/focus-timer.ts`、`privacy/consent-ui.ts` 已经是这个形状 ——
 * 不引状态库。**为什么不放进 `@heyta/ui`**：实测 `packages/ui` 对
 * `@heyta/app-host` 零 import，反过来会把展示层绑到接线层上。
 */

import {
  createSelectionStore,
  pruneSelection,
  type SelectableKind,
  type SelectionStore,
} from '@heyta/app-host';
import { useSyncExternalStore } from 'react';

/** 全壳唯一实例。 */
export const selection: SelectionStore = createSelectionStore();

/** 读某一类当前选中的 id；没选中是 `null`（不是 `undefined`）。 */
export function useSelected(kind: SelectableKind): string | null {
  return useSyncExternalStore(selection.subscribe, () => selection.get(kind));
}

/**
 * 按"这一屏手里有哪些实体"跑一次回落。
 *
 * 本壳的事实源是各屏自己刷出来的 id 集合（op-sqlite 的物化列表），
 * 所以调用点在刷数据之后 —— 每个屏一行，规则本身不在这里。
 *
 * 🔴 传进来的 id 集合必须是**活跃实体全集**，不是当前筛选/分组后的那一小截。
 * 写成后者会得到：用户从「今天」切到「收集箱」，正在详情面里的那条被判定
 * "不存在"、面板自己关掉。本壳的 `listTasks()` 返回的是未删除的全集，
 * 所以调用处直接用它，不要在筛完的 `groups` 上取 id。
 */
export function pruneSelectionAgainst(
  present: Partial<Record<SelectableKind, readonly string[]>>,
): void {
  const existsByKind: Partial<Record<SelectableKind, (id: string) => boolean>> = {};
  for (const kind of Object.keys(present) as SelectableKind[]) {
    const ids = new Set(present[kind]);
    existsByKind[kind] = (id) => ids.has(id);
  }
  pruneSelection(selection, existsByKind);
}
