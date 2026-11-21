/** 云端 Agent 工具 API 路由：形状/鉴权/授权/风险/幂等（execute 注入）。 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  agentToolsRoutes,
  type AgentToolCatalogEntry,
  type AgentToolExecuteResult,
} from '../src/ai/agent-tools.routes.js';

const catalog: AgentToolCatalogEntry[] = [
  { name: 'list_tasks', description: '列任务', parameters: { type: 'object', properties: {}, additionalProperties: false }, risk: 'read' },
  { name: 'create_task', description: '建任务', parameters: { type: 'object', properties: {}, additionalProperties: false }, risk: 'write' },
  { name: 'purge_all', description: '彻底删', parameters: { type: 'object', properties: {}, additionalProperties: false }, risk: 'destructive-irreversible' },
];

async function makeApp(opts: {
  grants?: Record<string, boolean>;
  execute?: (name: string, args: Record<string, unknown>, ctx: { userId: string }) => Promise<AgentToolExecuteResult>;
  withUser?: boolean;
}) {
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    if (opts.withUser !== false) {
      (request as unknown as { user?: { userId: number } }).user = { userId: 42 };
    }
  });
  await app.register(agentToolsRoutes, {
    catalog,
    resolveGrants: () => opts.grants ?? { list_tasks: true, create_task: true, purge_all: true },
    ...(opts.execute === undefined ? {} : { execute: opts.execute }),
  });
  return app;
}

describe('agentToolsRoutes', () => {
  it('未登录 → 401', async () => {
    const app = await makeApp({ withUser: false });
    const res = await app.inject({ method: 'GET', url: '/api/agent/tools' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('GET 只返回已授权 + 非不可逆工具', async () => {
    const app = await makeApp({ grants: { list_tasks: true, create_task: false, purge_all: true } });
    const res = await app.inject({ method: 'GET', url: '/api/agent/tools' });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['list_tasks']); // create 未授权、purge 不可逆 → 都不返回
  });

  it('POST 未授权 → 403 not-granted；不可逆 → 403 irreversible-blocked', async () => {
    const app = await makeApp({ grants: { list_tasks: true } });
    const r1 = await app.inject({ method: 'POST', url: '/api/agent/tools/create_task', payload: { args: {} } });
    expect(r1.statusCode).toBe(403);
    expect(r1.json().reason).toBe('not-granted');

    const app2 = await makeApp({ grants: { purge_all: true } });
    const r2 = await app2.inject({ method: 'POST', url: '/api/agent/tools/purge_all', payload: { args: {} } });
    expect(r2.statusCode).toBe(403);
    expect(r2.json().reason).toBe('irreversible-blocked');
  });

  it('POST 已授权 → 调 execute 并返回信封；未接执行器 → 501', async () => {
    let called: { name: string; args: unknown; userId: string } | undefined;
    const app = await makeApp({
      execute: async (name, args, ctx) => {
        called = { name, args, userId: ctx.userId };
        return { ok: true, data: [{ title: 'A' }] };
      },
    });
    const res = await app.inject({ method: 'POST', url: '/api/agent/tools/list_tasks', payload: { args: { completed: false } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, data: [{ title: 'A' }] });
    expect(called).toEqual({ name: 'list_tasks', args: { completed: false }, userId: '42' });

    const noExec = await makeApp({});
    const r501 = await noExec.inject({ method: 'POST', url: '/api/agent/tools/list_tasks', payload: { args: {} } });
    expect(r501.statusCode).toBe(501);
  });

  it('生产只读目录下，写工具不在目录 → 404 not-found', async () => {
    const app = Fastify();
    app.addHook('preHandler', async (request) => {
      (request as unknown as { user?: { userId: number } }).user = { userId: 42 };
    });
    const readOnlyCatalog = catalog.filter((t) => t.risk === 'read');
    await app.register(agentToolsRoutes, { catalog: readOnlyCatalog, resolveGrants: () => ({ create_task: true }), execute: async () => ({ ok: true, data: 1 }) });
    const res = await app.inject({ method: 'POST', url: '/api/agent/tools/create_task', payload: { args: { title: 'X' } } });
    expect(res.statusCode).toBe(404);
    expect(res.json().reason).toBe('not-found');
  });

  it('Idempotency-Key：同一键重复 POST 只执行一次', async () => {
    let calls = 0;
    const app = await makeApp({
      execute: async () => {
        calls += 1;
        return { ok: true, data: { applied: true } };
      },
    });
    const req = () =>
      app.inject({
        method: 'POST',
        url: '/api/agent/tools/create_task',
        payload: { args: { title: 'Z' } },
        headers: { 'idempotency-key': 'run-1' },
      });
    const a = await req();
    const b = await req();
    expect(a.json()).toEqual({ ok: true, data: { applied: true } });
    expect(b.json()).toEqual(a.json());
    expect(calls).toBe(1);
  });
});
