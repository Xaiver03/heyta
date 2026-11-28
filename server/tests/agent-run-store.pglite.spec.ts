/**
 * Agent run/session 存储层：真 PGlite 跑 ADR-0093 的建表 SQL，验四表约束与断点续传形状。
 *
 * 证明的：迁移 SQL 可执行；消息 seq 唯一；删会话级联删消息/运行/事件；`seq > after` 续传有序；
 * `last_event_id` 随事件推进；终态落 finished_at。
 * 不证明的：HTTP 鉴权与 SSE 分帧（后续路由层测试覆盖）。
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlRunner } from '../src/billing/pricing-store';
import {
  appendAgentMessage,
  appendAgentRunEvent,
  createAgentSession,
  finishAgentRun,
  readAgentRunEventsSince,
  startAgentRun,
} from '../src/ai/agent-run-store';

const MIGRATION = resolve(__dirname, '../prisma/migrations/20261128180000_add_agent_run_sessions/migration.sql');

function runner(db: PGlite): SqlRunner {
  return {
    query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> =>
      (await db.query(sql, params as unknown[])).rows as T[],
    execute: async (sql: string, params: readonly unknown[] = []): Promise<number> => {
      const result = (await db.query(sql, params as unknown[])) as { affectedRows?: number };
      return result.affectedRows ?? 0;
    },
  };
}

let db: PGlite;
let sql: SqlRunner;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  sql = runner(db);
});

afterAll(async () => {
  await db.close();
});

describe('agent run/session 存储', () => {
  it('会话+消息可写；同会话重复 seq 被唯一约束挡下', async () => {
    await createAgentSession(sql, { id: 's1', userId: 7, title: '测试' });
    await appendAgentMessage(sql, { id: 'm1', sessionId: 's1', role: 'user', content: '你好', seq: 1 });
    await expect(
      appendAgentMessage(sql, { id: 'm1dup', sessionId: 's1', role: 'user', content: '重复', seq: 1 }),
    ).rejects.toThrow();
  });

  it('事件按 seq 落库，last_event_id 推进，seq>after 有序续传', async () => {
    await createAgentSession(sql, { id: 's2', userId: 7 });
    await startAgentRun(sql, { id: 'r2', sessionId: 's2' });
    await appendAgentRunEvent(sql, { runId: 'r2', seq: 1, type: 'text', payload: { delta: 'a' } });
    await appendAgentRunEvent(sql, { runId: 'r2', seq: 2, type: 'tool-started', payload: { tool: 'list_tasks' } });
    await appendAgentRunEvent(sql, { runId: 'r2', seq: 3, type: 'done', payload: {} });

    const last = await sql.query<{ last_event_id: number }>(
      'SELECT "last_event_id" FROM "agent_runs" WHERE "id"=$1',
      ['r2'],
    );
    expect(last[0]?.last_event_id).toBe(3);

    const resumed = await readAgentRunEventsSince(sql, 'r2', 1);
    expect(resumed.map((e) => e.seq)).toEqual([2, 3]);
    expect(resumed[0]?.type).toBe('tool-started');
  });

  it('终态写 finished_at', async () => {
    await finishAgentRun(sql, { runId: 'r2', status: 'completed' });
    const rows = await sql.query<{ status: string; finished_at: unknown }>(
      'SELECT "status","finished_at" FROM "agent_runs" WHERE "id"=$1',
      ['r2'],
    );
    expect(rows[0]?.status).toBe('completed');
    expect(rows[0]?.finished_at).not.toBeNull();
  });

  it('删会话级联删消息/运行/事件', async () => {
    await sql.execute('DELETE FROM "agent_sessions" WHERE "id"=$1', ['s2']);
    const msgs = await sql.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM "agent_messages" WHERE "session_id"=$1', ['s2']);
    const runs = await sql.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM "agent_runs" WHERE "session_id"=$1', ['s2']);
    const events = await sql.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM "agent_run_events" WHERE "run_id"=$1', ['r2']);
    expect(msgs[0]?.n).toBe(0);
    expect(runs[0]?.n).toBe(0);
    expect(events[0]?.n).toBe(0);
  });
});
