/** 服务端全链路：route → executeAgentToolForUser → op 归约 → list_tasks（不 stub execute）。 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { agentToolsRoutes } from '../src/ai/agent-tools.routes.js';
import { SERVER_AGENT_TOOLS, executeAgentTool } from '../src/ai/agent-tools.execute.js';
import { executeAgentToolForUser, type OpsReader } from '../src/ai/agent-tools.service.js';

function fakeDb(rows: unknown[]): OpsReader {
  return { operation: { findMany: async () => rows } };
}

const rows = [
  { id: 'a', serverSeq: 0, opType: 'CRT', entityType: 'TASK', entityId: 't1', payload: { title: '写周报' }, schemaVersion: 1, isPayloadEncrypted: false },
  { id: 'b', serverSeq: 1, opType: 'CRT', entityType: 'TASK', entityId: 't2', payload: { title: '已删' }, schemaVersion: 1, isPayloadEncrypted: false },
  { id: 'c', serverSeq: 2, opType: 'DEL', entityType: 'TASK', entityId: 't2', payload: {}, schemaVersion: 1, isPayloadEncrypted: false },
];

describe('服务端全链路（route→service→replay→只读工具）', () => {
  it('POST list_tasks 经真实归约返回未删除任务；GET 列出只读目录', async () => {
    const app = Fastify();
    app.addHook('preHandler', async (request) => {
      (request as unknown as { user?: { userId: number } }).user = { userId: 42 };
    });
    const db = fakeDb(rows);
    await app.register(agentToolsRoutes, {
      catalog: SERVER_AGENT_TOOLS,
      resolveGrants: () => Object.fromEntries(SERVER_AGENT_TOOLS.map((t) => [t.name, true])),
      execute: (name, args, ctx) => executeAgentToolForUser(db, ctx.userId, name, args),
    });

    const list = await app.inject({ method: 'GET', url: '/api/agent/tools' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.tools.map((t: { name: string }) => t.name)).toContain('list_tasks');

    const post = await app.inject({ method: 'POST', url: '/api/agent/tools/list_tasks', payload: { args: {} } });
    expect(post.statusCode).toBe(200);
    const body = post.json() as { ok: boolean; data: Array<{ title: string }> };
    expect(body.ok).toBe(true);
    expect(body.data.map((t) => t.title)).toEqual(['写周报']);
    // 直接校验 execute 也一致（防 route 层偷偷改写）
    const direct = executeAgentTool({ TASK: { t1: { title: '写周报' } } } as never, 'list_tasks', {});
    expect(direct.ok).toBe(true);
  });
});
