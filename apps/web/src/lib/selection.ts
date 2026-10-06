/**
 * 选中态（Web 壳）
 * ==================
 *
 * 规则**不在这个文件里** —— 它在 `@heyta/app-host` 的 `selection.ts`
 * （每类至多一个、换一条是替换、回落只认实体存在性、没变不通知）。
 * 这里只留三样宿主必须自己给的东西：
 *
 *   1. **单例**：一个浏览器标签页一份。刷新页面回到"没选中"，这是对的 ——
 *      选中态是视图态，不进 op-log、不同步（另一台设备选了什么与本机无关）。
 *   2. **React 绑定**：`useSyncExternalStore`。为什么不放进 `@heyta/ui`：
 *      实测 `packages/ui` 对 `@heyta/app-host` 是**零 import**（方向是 app-host → ui 的下游，
 *      反过来会把展示层绑到接线层上）；而 app-host 自己零 UI 依赖，
 *      拽进 react 会连累 node-host / CLI。所以胶水留在宿主，且胶水里不许有规则。
 *   3. **回落的事实源**：只有本壳知道实体在不在（物化状态在 op-log 引擎里）。
 *
 * 🔴 `aliveIds` 必须是"**实体还在不在**"，不许写成"当前筛选下可不可见"。
 * 后者的症状很具体也很贵：用户从「今天」切到「收集箱」，正在详情面里编辑的
 * 那条任务就被判定"不存在"、面板自己关掉。
 */

import {
  createSelectionStore,
  pruneSelection,
  type SelectableKind,
  type SelectionStore,
} from '@heyta/app-host';
import { listAlive, type MaterializedState } from '@heyta/op-log';
import { useSyncExternalStore } from 'react';

/** 全壳唯一实例。别处再 `createSelectionStore()` 就是第二个所有者。 */
export const selection: SelectionStore = createSelectionStore();

/** 读某一类当前选中的 id。**没有选中返回 `null`**，不是 `undefined`。 */
export function useSelected(kind: SelectableKind): string | null {
  // getSnapshot 返回**原始值** ⇒ 引用天然稳定，正是 useSyncExternalStore 要的形态。
  return useSyncExternalStore(selection.subscribe, () => selection.get(kind));
}

/**
 * 按物化状态跑一次回落。
 *
 * 🔴 **触发源是宿主的数据，不是选中态自己**：数据变了才需要问"选中的那条还在不在"。
 * 而这里读的是 `store.entities`（zustand 里那份物化状态快照），**不是** `currentState()` ——
 * 后者在未初始化时会直接抛（`requireEngine()`），把它挂进挂载路径上就是
 * "刷新页面偶发白屏"那种形状的坑。
 */
export function pruneSelectionFromEntities(entities: MaterializedState): void {
  pruneSelection(selection, {
    task: existsIn(aliveIds(entities.tasks)),
    habit: existsIn(aliveIds(entities.habits)),
    note: existsIn(aliveIds(entities.notes)),
    // 🔴 词表只有这三类，而这不是省事：清单/标签在两侧都是**筛选**（点它换中间那一栏），
    // 纪念日还没进物化状态。给一个没有消费者的类别写谓词，得到的是一条
    // 永远绿、永远不成立的判据 —— 断言 D（`check:selection-single-source`）就是拦这个的。
  });
}

function aliveIds<T extends { id: string; deletedAt?: number }>(
  bucket: Record<string, T>,
): Set<string> {
  return new Set(listAlive(bucket).map((entity) => entity.id));
}

function existsIn(ids: Set<string>): (id: string) => boolean {
  return (id) => ids.has(id);
}
