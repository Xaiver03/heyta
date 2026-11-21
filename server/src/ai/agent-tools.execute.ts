/**
 * 服务端工具执行器（`/api/agent/tools` 的 `execute` 落点）。
 *
 * 服务端没有"物化实体表"——它只存 op。这里复用**已有的** `replayOpsToState`
 * （`server/src/sync/op-replay.ts`，快照生成也在用）把某用户的 op 归约成状态，
 * 再在**只读**范围内提供少数读工具。
 *
 * ## 边界（诚实）
 *
 * - **只读**：本文件只服务读工具（list_*）。写工具（create/update/...）需要把写
 *   经服务端权威写入链路落成 op，属独立工作；届时 `executeAgentTool` 返回
 *   `not-implemented`，路由如实回 501，绝不假装成功。
 * - **E2EE 账号**：`replayOpsToState` 对加密 payload 直接抛错（服务端读不到明文）。
 *   这与"默认明文、服务端可读"一致：开启 E2EE 的账号**本来就不该**由服务端执行工具。
 * - 只认**已定义的读工具子集**（`SERVER_AGENT_TOOLS`）。设备端 `@heyta/local-api`
 *   的工具目录是超集，服务端不依赖它（依赖方向不允许）。
 */
import type { ReplayOperationRow } from '../sync/op-replay.js';
import { replayOpsToState } from '../sync/op-replay.js';

export interface ServerAgentTool {
  readonly name: string;
  readonly description: string;
  readonly risk: 'read' | 'write' | 'destructive-reversible' | 'destructive-irreversible';
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** 服务端**能执行**的只读工具子集（device 目录是超集，这里不复制它的全部）。 */
export const SERVER_AGENT_TOOLS: readonly ServerAgentTool[] = [
  {
    name: 'list_tasks',
    description: '列出未删除、未归档的任务（按标题）。',
    risk: 'read',
    parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'list_projects',
    description: '列出未删除、未归档的清单。',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_notes',
    description: '列出未删除的便签（不含正文，只含标题/摘要标记）。',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export type MaterializedState = Record<string, Record<string, Record<string, unknown>>>;

/** 把某用户的 op 归约成物化状态（复用快照的同一实现）。 */
export function materializeUserState(rows: readonly ReplayOperationRow[]): MaterializedState {
  return replayOpsToState([...rows]) as MaterializedState;
}

function isAlive(entity: Record<string, unknown> | undefined): boolean {
  if (entity === undefined) return false;
  if (entity['deletedAt'] !== undefined && entity['deletedAt'] !== null) return false;
  if (entity['purgedAt'] !== undefined && entity['purgedAt'] !== null) return false;
  return true;
}
function isArchived(entity: Record<string, unknown>): boolean {
  return (
    (entity['archived'] === true) ||
    (entity['archivedAt'] !== undefined && entity['archivedAt'] !== null)
  );
}

export type AgentToolExecuteResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: string; readonly message: string };

export function executeAgentTool(
  state: MaterializedState,
  name: string,
  args: Readonly<Record<string, unknown>>,
): AgentToolExecuteResult {
  switch (name) {
    case 'list_tasks': {
      const tasks = Object.values(state['TASK'] ?? {})
        .filter(isAlive)
        .filter((t) => !isArchived(t))
        .map((t) => ({ id: t['id'], title: t['title'], completed: t['completed'] === true }));
      const limit = typeof args['limit'] === 'number' ? Math.max(0, args['limit']) : 100;
      return { ok: true, data: tasks.slice(0, limit) };
    }
    case 'list_projects': {
      const projects = Object.values(state['PROJECT'] ?? {})
        .filter(isAlive)
        .filter((p) => !isArchived(p))
        .map((p) => ({ id: p['id'], name: p['name'] }));
      return { ok: true, data: projects };
    }
    case 'list_notes': {
      const notes = Object.values(state['NOTE'] ?? {})
        .filter(isAlive)
        .map((n) => ({ id: n['id'], title: n['title'] }));
      return { ok: true, data: notes };
    }
    default:
      return { ok: false, reason: 'not-implemented', message: `服务端暂未提供工具「${name}」的执行。` };
  }
}
