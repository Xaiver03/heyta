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

import type { Task } from './entities.js';

/**
 * 列表展示顺序：**未完成在前，已完成在后；都按截止时间升序，无截止的排最后。**
 *
 * 为什么是这三条：
 *   - 未完成在前 —— 已完成的对"接下来做什么"没有信息量；
 *   - 截止近的在前 —— 这是用户扫这一眼的目的；
 *   - 无截止的排最后 —— 它们没有紧迫性，但**不能丢**（收集箱里就是这类）。
 *
 * ⚠️ 必须是**稳定**排序。同一天到期的任务之间若顺序随机，每次 relayout 都会
 * 抖一下，而"列表会自己换位置"是用户最直接的不信任来源。
 * `Array.prototype.sort` 在 ES2019 起保证稳定，但这里仍显式带上下标兜底 ——
 * 依赖一条"语言规范保证"而没人写下来，下一个读代码的人会以为是巧合。
 */
export function sortTasksForDisplay(tasks: readonly Task[]): readonly Task[] {
  const indexed = tasks.map((task, index) => ({ task, index }));
  indexed.sort((a, b) => {
    const aDone = a.task.completedAt !== undefined;
    const bDone = b.task.completedAt !== undefined;
    if (aDone !== bDone) return aDone ? 1 : -1;

    // `undefined`（无截止）排在有截止的后面。用 Infinity 而不是 0：
    // 0 是 1970-01-01，会被当成"最紧急"，正好排反。
    const aDue = a.task.dueDate ?? Number.POSITIVE_INFINITY;
    const bDue = b.task.dueDate ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    return a.index - b.index;
  });
  return indexed.map((entry) => entry.task);
}