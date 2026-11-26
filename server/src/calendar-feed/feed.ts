/**
 * 从物化状态生成日历订阅 ICS（服务端 / 测试共用）
 * ============================================
 *
 * 服务端把用户的 op-log 回放成 `state`（`state['TASK']` 是 id→Task 的桶），这里只用
 * `@heyta/domain` 的 `tasksToIcs`（与客户端导出**同一份**实现），保证两条路输出一致。
 */

import { tasksToIcs, type Task } from '@heyta/domain';

/** 从物化状态里取出任务数组（只做形状过滤，不做业务判断）。 */
export function tasksFromState(state: Readonly<Record<string, unknown>>): Task[] {
  const bucket = state['TASK'];
  if (bucket === null || typeof bucket !== 'object' || Array.isArray(bucket)) return [];
  return Object.values(bucket as Record<string, unknown>).filter(
    (entry): entry is Task => entry !== null && typeof entry === 'object',
  );
}

/** 由物化状态生成 `.ics` 文本。 */
export function buildCalendarIcsFromState(
  state: Readonly<Record<string, unknown>>,
  options: { readonly now?: number; readonly domain?: string } = {},
): string {
  return tasksToIcs(tasksFromState(state), options);
}
