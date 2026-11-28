/** Agent run/session 路由：鉴权/归属/托管闸门/续传/取消（PGlite 真 SQL + Fastify 注入）。 */
import { PGlite } from '@electric-sql/pglite';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SqlRunner } from '../src/billing/pricing-store';
import { agentSessionsRoutes } from '../src/ai/agent-sessions.routes';
import { createAgentSession, getAgentRunOwner } from '../src/ai/agent-run-store';

const MIGRATION = resolve(__dirname, '../prisma/migrations/20261128180000_add_agent_run_sessions/migration.sql');
const ME = 42;

let db: PGlite;
let sql: SqlRunner;

function runner(pg: PGlite): SqlRunner {
  return {
    query: async <T>(query: string, params: readonly unknown[] = []): Promise<T[]> =>
      (await pg.query(query, params as unknown[])).rows as T[],
    execute: async (query: string, params: readonly unknown[] = []): Promise<number> => {
      const r = (await pg.query(query, params as unknown[])) as { affectedRows?: number };
      return r.affectedRows ?? 0;
    },
  };
}

async function makeApp(opts: { userId?: number | null; requireManaged?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    if (opts.userId !== null && opts.userId !== undefined) {
      (request as unknown as { user?: { userId: number } }).user = { userId: opts.userId };
    }
  });
  await app.register(agentSessionsRoutes, {
    sql,
    ...(opts.requireManaged === false ? { requireManaged: () => false } : {}),
  });
  return app;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  sql = runner(db);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('TRUNCATE "agent_run_events","agent_runs","agent_messages","agent_sessions"');
});

describe('agentSessionsRoutes', () => {
  it('未登录 ⇒ 401', async () => {
    const app = await makeApp({ userId: null });
    const res = await app.inject({ method: 'POST', url: '/api/ai/agent/sessions', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, reason: 'unauthorized' });
    await app.close();
  });

  it('建会话 + 列本会话', async () => {
    const app = await makeApp({ userId: ME });
    const created = await app.inject({ method: 'POST', url: '/api/ai/agent/sessions', payload: { title: 'T' } });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    expect(typeof id).toBe('string');
    const list = await app.inject({ method: 'GET', url: '/api/ai/agent/sessions' });
    expect(list.json().data.sessions.map((s: { id: string }) => s.id)).toContain(id);
    await app.close();
  });

  it('非本人会话 ⇒ 404（不泄露存在性）', async () => {
    await createAgentSession(sql, { id: 'other', userId: 7 });
    const app = await makeApp({ userId: ME });
    const res = await app.inject({ method: 'GET', url: '/api/ai/agent/sessions/other/messages' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('run 追加事件后 after 续传有序；取消落 cancelled', async () => {
    const app = await makeApp({ userId: ME });
    const sessionId = (await app.inject({ method: 'POST', url: '/api/ai/agent/sessions', payload: {} })).json().data.id as string;
    const runId = (await app.inject({ method: 'POST', url: `/api/ai/agent/sessions/${sessionId}/runs` })).json().data.id as string;

    for (const seq of [1, 2, 3]) {
      const r = await app.inject({
        method: 'POST',
        url: `/api/ai/agent/runs/${runId}/events`,
        payload: { seq, type: 'text', payload: { n: seq } },
      });
      expect(r.statusCode).toBe(200);
    }
    const resumed = await app.inject({ method: 'GET', url: `/api/ai/agent/runs/${runId}/events?after=1` });
    expect(resumed.json().data.events.map((e: { seq: number }) => e.seq)).toEqual([2, 3]);

    const cancel = await app.inject({ method: 'POST', url: `/api/ai/agent/runs/${runId}/cancel` });
    expect(cancel.statusCode).toBe(200);
    const owner = await getAgentRunOwner(sql, runId);
    expect(owner?.status).toBe('cancelled');
    await app.close();
  });

  it('托管闸门关闭 ⇒ 建会话 403 managed-required', async () => {
    const app = await makeApp({ userId: ME, requireManaged: false });
    const res = await app.inject({ method: 'POST', url: '/api/ai/agent/sessions', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, reason: 'managed-required' });
    await app.close();
  });
});
