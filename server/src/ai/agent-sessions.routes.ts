/**
 * Agent run/session 服务端 API（ADR-0093，仅托管档）
 * =================================================
 *
 * 只做 HTTP 语义：鉴权（userId 取自会话票据）、归属校验、托管档闸门、错误信封、
 * 断点续传的 `after` 查询；数据读写全部走注入的 `SqlRunner`（`agent-run-store`），
 * 所以能用 PGlite 做真 SQL 的路由测试。
 *
 * 路由：
 * - POST   /api/ai/agent/sessions              建会话
 * - GET    /api/ai/agent/sessions              列本会话
 * - GET    /api/ai/agent/sessions/:id/messages 读消息
 * - POST   /api/ai/agent/sessions/:id/runs     发起 run
 * - POST   /api/ai/agent/runs/:id/events       追加事件（由 run 驱动方写）
 * - GET    /api/ai/agent/runs/:id/events?after= 断点续传读事件
 * - POST   /api/ai/agent/runs/:id/cancel       取消 run
 */
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';

import type { SqlRunner } from '../billing/pricing-store';
import {
  appendAgentRunEvent,
  createAgentSession,
  finishAgentRun,
  getAgentRunOwner,
  getAgentSession,
  listAgentMessages,
  listAgentSessions,
  readAgentRunEventsSince,
  startAgentRun,
} from './agent-run-store';

export interface AgentSessionsRoutesOptions {
  readonly authenticate?: (request: unknown, reply: unknown) => Promise<unknown> | unknown;
  /** 追加的 preHandler（生产传 `createEntitlementGuard({ capability: 'ai' })` 作托管档闸门）。 */
  readonly extraHooks?: readonly unknown[];
  readonly sql: SqlRunner;
  /** 托管档闸门：返回 false ⇒ 403 managed-required。省略 = 放行（测试/自托管内部）。 */
  readonly requireManaged?: (request: unknown) => Promise<boolean> | boolean;
}

function userIdOf(request: unknown): number | undefined {
  const user = (request as { user?: { userId?: number | string; id?: number | string } }).user;
  if (user === undefined) return undefined;
  const value = user.userId ?? user.id;
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function unauthorized(reply: unknown): unknown {
  (reply as { code: (n: number) => unknown }).code(401);
  return { ok: false, reason: 'unauthorized', message: '未登录。' };
}

function notFound(reply: unknown): unknown {
  (reply as { code: (n: number) => unknown }).code(404);
  return { ok: false, reason: 'not-found', message: '不存在。' };
}

export const agentSessionsRoutes: FastifyPluginAsync<AgentSessionsRoutesOptions> = async (app, options) => {
  if (options.authenticate !== undefined) {
    app.addHook('preHandler', options.authenticate as never);
  }
  for (const hook of options.extraHooks ?? []) {
    app.addHook('preHandler', hook as never);
  }

  const allowManaged = async (request: unknown): Promise<boolean> => {
    if (options.requireManaged === undefined) return true;
    return await options.requireManaged(request);
  };

  const requireOwnedSession = async (id: string, userId: number): Promise<boolean> => {
    const session = await getAgentSession(options.sql, id);
    return session !== undefined && session.user_id === userId;
  };

  app.post('/api/ai/agent/sessions', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) return unauthorized(reply);
    if (!(await allowManaged(request))) {
      reply.code(403);
      return { ok: false, reason: 'managed-required', message: '服务端会话仅托管档可用。' };
    }
    const body = (request.body ?? {}) as { title?: unknown };
    const id = randomUUID();
    await createAgentSession(options.sql, {
      id,
      userId,
      title: typeof body.title === 'string' ? body.title : null,
    });
    reply.code(201);
    return { ok: true, data: { id } };
  });

  app.get('/api/ai/agent/sessions', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) return unauthorized(reply);
    const sessions = await listAgentSessions(options.sql, userId);
    return { ok: true, data: { sessions } };
  });

  app.get('/api/ai/agent/sessions/:id/messages', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) return unauthorized(reply);
    const id = (request.params as { id: string }).id;
    if (!(await requireOwnedSession(id, userId))) return notFound(reply);
    const messages = await listAgentMessages(options.sql, id);
    return { ok: true, data: { messages } };
  });

  app.post('/api/ai/agent/sessions/:id/runs', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) return unauthorized(reply);
    if (!(await allowManaged(request))) {
      reply.code(403);
      return { ok: false, reason: 'managed-required', message: '服务端会话仅托管档可用。' };
    }
    const sessionId = (request.params as { id: string }).id;
    if (!(await requireOwnedSession(sessionId, userId))) return notFound(reply);
    const id = randomUUID();
    await startAgentRun(options.sql, { id, sessionId });
    reply.code(201);
    return { ok: true, data: { id } };
  });

  app.post('/api/ai/agent/runs/:id/events', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) return unauthorized(reply);
    const runId = (request.params as { id: string }).id;
    const owner = await getAgentRunOwner(options.sql, runId);
    if (owner === undefined || owner.user_id !== userId) return notFound(reply);
    const body = (request.body ?? {}) as { seq?: unknown; type?: unknown; payload?: unknown };
    const seq = Number(body.seq);
    if (!Number.isInteger(seq) || seq <= 0 || typeof body.type !== 'string') {
      reply.code(400);
      return { ok: false, reason: 'bad-event', message: 'seq 需正整数、type 需字符串。' };
    }
    await appendAgentRunEvent(options.sql, { runId, seq, type: body.type, payload: body.payload ?? null });
    return { ok: true, data: { seq } };
  });

  app.get('/api/ai/agent/runs/:id/events', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) return unauthorized(reply);
    const runId = (request.params as { id: string }).id;
    const owner = await getAgentRunOwner(options.sql, runId);
    if (owner === undefined || owner.user_id !== userId) return notFound(reply);
    const afterRaw = (request.query as { after?: string }).after;
    const after = afterRaw === undefined ? 0 : Number(afterRaw);
    const events = await readAgentRunEventsSince(options.sql, runId, Number.isFinite(after) ? after : 0);
    return { ok: true, data: { events } };
  });

  app.post('/api/ai/agent/runs/:id/cancel', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) return unauthorized(reply);
    const runId = (request.params as { id: string }).id;
    const owner = await getAgentRunOwner(options.sql, runId);
    if (owner === undefined || owner.user_id !== userId) return notFound(reply);
    await finishAgentRun(options.sql, { runId, status: 'cancelled' });
    return { ok: true, data: { id: runId } };
  });

  app.post('/api/ai/agent/runs/:id/finish', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) return unauthorized(reply);
    const runId = (request.params as { id: string }).id;
    const owner = await getAgentRunOwner(options.sql, runId);
    if (owner === undefined || owner.user_id !== userId) return notFound(reply);
    const body = (request.body ?? {}) as { status?: unknown; error?: unknown };
    const status = body.status;
    if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
      reply.code(400);
      return { ok: false, reason: 'bad-status', message: 'status 需 completed/failed/cancelled。' };
    }
    await finishAgentRun(options.sql, {
      runId,
      status,
      error: typeof body.error === 'string' ? body.error : null,
    });
    return { ok: true, data: { id: runId } };
  });
};
