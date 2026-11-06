/**
 * 任务列表的**展示顺序**（唯一一份）
 * ===================================
 *
 * ## 🔴 它为什么在 `packages/domain` 而不在 `packages/ui`
 *
 * 这条规则原本只写在 `packages/ui/src/task-list/model.ts`。那在**只有一个 UI 层**
 * 的时候是对的（`docs/plans/multi-platform-adaptation.md` 的 M0 判据：
 * 展示判断逻辑不得在 `apps/*` 定义）。但它有一个**分层上的死角**：
 *
 * ```
 * packages/ui   （L3，peer 依赖 react / react-native）
 *      ↑ 只能被 apps/* 与宿主消费
 * packages/app-host （L2，零框架依赖）
 * ```
 *
 * 于是 `packages/app-host` **够不到**它 —— 而桌面壳的窄门面
 * （`src/native-bridge.ts` 的 `listTasks`）恰恰在 app-host 里，
 * 它当时自己写了一份 `(createdAt, id)` 排序。**两份排序就此并存**：
 *
 * | 位置 | 顺序 |
 * |---|---|
 * | `packages/ui` 的 `sortTasksForDisplay` | 完成态 → 截止日升序（无截止最后）→ 原序 |
 * | `packages/app-host` 的 `listTasks` | `(createdAt, id)` |
 *
 * ⇒ **同一个账号，桌面壳与 web/mobile 的任务顺序不一样。** 这不是"哪个更好"的问题，
 * 它是本仓明令禁止的"同一事实两份源"（`AGENTS.md` §3.5）。
 *
 * ## 解法：把规则放到**两个包都能取到、且都不引入框架**的那一层
 *
 * 放在 `packages/domain` 而不是把 `packages/ui` 拉进 app-host 的依赖里 ——
 * 后者会让 app-host **拖进 React**（它今天零框架依赖，这是它能被 CLI / 原生壳 /
 * Worker 复用的前提）。
 *
 * 这条规则本身也确实属于领域知识：它回答的是"用户应该按什么顺序看到自己的任务"，
 * 是一个**产品规则**，不是渲染细节。渲染层只负责把它画出来。
 */

import { Priority, type Task } from './entities.js';
import { dueLocalDateOf } from './date.js';

/**
 * 列表可选的**排序口径**。
 *
 * 只有三档，而且是刻意的：
 *
 * - **没有「按标题」**。标题是用户自己的字，排序要用 `localeCompare`，而它在
 *   Hermes / V8 / JSC 上的 ICU 数据并不保证一致 —— 同一份数据在手机上和桌面壳上
 *   排出两个顺序，正是这个文件存在的理由（见上面那次「两份排序并存」事故）。
 *   按标题找东西的那叫**搜索**，不叫排序。
 * - **「手动拖拽」走 `Task.order`**（每次拖动 = 一条 op，字段已存在、可选）。
 */
export type TaskSortKey = 'display' | 'addedAt' | 'priority' | 'manual';

/** 供界面渲染选项 —— 菜单顺序就是这里的顺序，**不许各写第二份**。 */
export const TASK_SORT_KEYS: readonly TaskSortKey[] = ['display', 'addedAt', 'priority', 'manual'];

/**
 * 同一档口径内部的比较。返回 0 = 这一档分不出先后，由外层用**原序**兜底。
 *
 * 🔴 「已完成沉底」在**每一档**都排在最前：它不是排序偏好，而是这张列表的
 * 前提（"接下来做什么"里不该混进已经做完的）。所以它写在分支**外面** ——
 * 让「按添加时间」把刚勾掉的那条顶到第一行，用户的第一反应是自己点错了。
 *
 * 🔴 「置顶在前」同样写在分支**外面**，理由不是抄上面那条的形状：
 * 用户点「置顶」说的是"这条我要先看见"，而它**不该因为他顺手换了排序档位就失效** ——
 * 把 pin 塞进 `case 'display'` 里，表现就是"切到「按优先级」之后我钉的东西不见了"。
 * 它只比**有没有 `pinnedAt`**，不比时刻（比时刻会变成"后钉的压过先前钉的"，
 * 与 `entities.ts` 的 `byPinnedFirst` 同一个口径，见
 * [ADR-0083](../../../docs/adr/0083-task-abandonment-fifth-state-and-share-boundary.md) §3.2）。
 *
 * ⚠️ 它是**组内**顺序，不是跨组搬运：分组由 `task-filter.ts` 的 `groupTasksByDate`
 * 决定，而它保持入参顺序，所以这里前置一次落到界面上就是"每个日期组里置顶的排最前"。
 * 做成跨组搬运等于把注意力语义和排程语义混成一个字段（0083 §3.2 明确不要那个）。
 */
function compareBySortKey(key: TaskSortKey, a: Task, b: Task): number {
  const aDone = a.completedAt !== undefined;
  const bDone = b.completedAt !== undefined;
  if (aDone !== bDone) return aDone ? 1 : -1;

  const aPinned = a.pinnedAt !== undefined;
  const bPinned = b.pinnedAt !== undefined;
  if (aPinned !== bPinned) return aPinned ? -1 : 1;

  switch (key) {
    case 'display': {
      // `undefined`（无截止）排在有截止的后面。用 Infinity 而不是 0：
      // 0 是 1970-01-01，会被当成最紧急，正好排反。
      const aDay = dueLocalDateOf(a);
      const bDay = dueLocalDateOf(b);
      if (aDay === undefined) return bDay === undefined ? 0 : 1;
      if (bDay === undefined) return -1;
      if (aDay !== bDay) return aDay < bDay ? -1 : 1;
      // Preserve the old within-day ordering for timed tasks.
      return (a.dueDate ?? 0) - (b.dueDate ?? 0);
    }
    case 'addedAt':
      // **新的在前**。收集箱是「刚记下来的东西」的容器，用户刚写的那条就是他要找的；
      // 反过来会让新任务永远埋在旧条目下面，而它明明是从上面滚进来的。
      return b.createdAt - a.createdAt;
    case 'priority':
      // **高的在前**。`undefined` 与 `None` 同义（0），自然落到最后 ——
      // 不给「没设优先级」发明中间档，那会让它插进 Low 与 Medium 之间。
      return (b.priority ?? Priority.None) - (a.priority ?? Priority.None);
    case 'manual': {
      const aOrd = a.order ?? Number.MAX_SAFE_INTEGER;
      const bOrd = b.order ?? Number.MAX_SAFE_INTEGER;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return 0;
    }
  }
}

/**
 * 按给定口径排序，**默认 `display`**（就是原来那条规则）。
 *
 * ⚠️ 必须**稳定**：同一天到期 / 同一个优先级的任务之间若顺序随机，每次 relayout
 * 都会抖一下，而「列表会自己换位置」是用户最直接的不信任来源。
 * `Array.prototype.sort` 在 ES2019 起保证稳定，但这里仍显式带上下标兜底 ——
 * 依赖一条「语言规范保证」而没人写下来，下一个读代码的人会以为是巧合。
 */
export function sortTasks(tasks: readonly Task[], key: TaskSortKey = 'display'): readonly Task[] {
  const indexed = tasks.map((task, index) => ({ task, index }));
  indexed.sort((a, b) => {
    const primary = compareBySortKey(key, a.task, b.task);
    return primary !== 0 ? primary : a.index - b.index;
  });
  return indexed.map((entry) => entry.task);
}

/**
 * 默认展示顺序：**未完成在前，已完成在后；都按截止时间升序，无截止的排最后。**
 *
 * 为什么是这三条：
 *   - 未完成在前 —— 已完成的对「接下来做什么」没有信息量；
 *   - 截止近的在前 —— 这是用户扫这一眼的目的；
 *   - 无截止的排最后 —— 它们没有紧迫性，但**不能丢**（收集箱里就是这类）。
 *
 * 🔴 它就是 `sortTasks(tasks, 'display')`，**不是另一份实现**。两个函数各写一遍
 * 比较逻辑，就是这个文件历史上那次「两份排序并存」的重演。
 */
export function sortTasksForDisplay(tasks: readonly Task[]): readonly Task[] {
  return sortTasks(tasks, 'display');
}
