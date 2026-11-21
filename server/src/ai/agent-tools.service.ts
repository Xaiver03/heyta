/**
 * `/api/agent/tools` 的生产接线：把 route 需要的 catalog / resolveGrants / execute /
 * authenticate 组装好，`execute` 从该用户的 op 归约状态执行只读工具。
 *
 * ⚠️ 逐账号工具授权存储尚未建表（需迁移）；当前策略：登录用户可使用全部**只读**工具
 * （不包含任何 `destructive-irreversible`）。这是产品策略，不是实现细节，落地逐账号授权时改这里。
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middleware';

import {
  SERVER_AGENT_TOOLS,
  executeAgentTool,
  materializeUserState,
  type AgentToolExecuteResult,
  type ServerAgentTool,
} from './agent-tools.execute.js';
import type { ReplayOperationRow } from '../sync/op-replay.js';
import type { AgentToolsRoutesOptions } from './agent-tools.routes.js';

/** 最小 prisma 依赖面（便于测试注入假实现）。 */
export interface OpsReader {
  operation: {
    findMany: (args: {
      where: { userId: number };
      orderBy: { serverSeq: 'asc' };
      select: Record<string, boolean>;
    }) => Promise<unknown[]>;
  };
}

const OP_SELECT = {
  id: true,
  serverSeq: true,
  opType: true,
  entityType: true,
  entityId: true,
  entityIds: true,
  payload: true,
  schemaVersion: true,
  isPayloadEncrypted: true,
  repairBaseServerSeq: true,
} as const;

/** 用某用户的 op 归约出状态，再执行一个工具。 */
export async function executeAgentToolForUser(
  db: OpsReader,
  userId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<AgentToolExecuteResult> {
  const tools = SERVER_AGENT_TOOLS;
  if (!tools.some((t) => t.name === name)) {
    return { ok: false, reason: 'not-found', message: '没有这个工具。' };
  }
  const rows = (await db.operation.findMany({
    where: { userId: Number(userId) },
    orderBy: { serverSeq: 'asc' },
    select: OP_SELECT as unknown as Record<string, boolean>,
  })) as ReplayOperationRow[];
  let state;
  try {
    state = materializeUserState(rows);
  } catch {
    // E2EE 账号（加密 payload）服务端读不到明文 —— 如实拒绝，不静默返回空。
    return { ok: false, reason: 'encrypted-account', message: '该账号启用了端到端加密，服务端无法读取明文来执行工具。' };
  }
  return executeAgentTool(state, name, args);
}

/** 组装 route 选项（生产用）。 */
export function buildAgentToolsOptions(db: OpsReader): AgentToolsRoutesOptions {
  const catalog: ServerAgentTool[] = [...SERVER_AGENT_TOOLS];
  return {
    authenticate: (request: unknown, reply: unknown) => authenticate(request as FastifyRequest, reply as FastifyReply),
    catalog,
    resolveGrants: () =>
      Object.fromEntries(catalog.map((t) => [t.name, t.risk !== 'destructive-irreversible'])),
    execute: (name, args, ctx) => executeAgentToolForUser(db, ctx.userId, name, args),
  };
}

