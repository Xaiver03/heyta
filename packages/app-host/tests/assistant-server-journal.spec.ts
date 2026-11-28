/** 客户端 journal 核心：session/run 建立、seq 单调、终态；纯注入不碰网络。 */
import { describe, expect, it } from 'vitest';

import {
  startAssistantJournal,
  type JournalTransport,
} from '../src/index.js';

function fakeTransport() {
  const calls: {
    createdSessions: { title?: string }[];
    createdRuns: string[];
    events: { runId: string; seq: number; type: string; payload: unknown }[];
    finishes: { runId: string; status: string; error?: string }[];
  } = { createdSessions: [], createdRuns: [], events: [], finishes: [] };
  let seq = 0;
  const transport: JournalTransport = {
    createSession: (input) => {
      calls.createdSessions.push(input);
      return Promise.resolve('sess-1');
    },
    createRun: (sessionId) => {
      calls.createdRuns.push(sessionId);
      return Promise.resolve('run-1');
    },
    postEvent: (input) => {
      calls.events.push(input);
      seq += 1;
      return Promise.resolve();
    },
    finishRun: (input) => {
      calls.finishes.push(input);
      return Promise.resolve();
    },
  };
  return { transport, calls };
}

describe('startAssistantJournal', () => {
  it('新建会话 + run，事件 seq 从 1 单调递增', async () => {
    const { transport, calls } = fakeTransport();
    const journal = await startAssistantJournal(transport, { title: 'T' });
    expect(journal.sessionId).toBe('sess-1');
    expect(journal.runId).toBe('run-1');
    expect(calls.createdSessions).toEqual([{ title: 'T' }]);
    expect(calls.createdRuns).toEqual(['sess-1']);

    await journal.record('text', { delta: 'a' });
    await journal.record('tool-started', { tool: 'list_tasks' });
    expect(calls.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(calls.events[1]).toMatchObject({ type: 'tool-started', payload: { tool: 'list_tasks' } });
  });

  it('复用已有会话不新建；终态带 error', async () => {
    const { transport, calls } = fakeTransport();
    const journal = await startAssistantJournal(transport, { sessionId: 'sess-x' });
    expect(calls.createdSessions).toHaveLength(0);
    expect(calls.createdRuns).toEqual(['sess-x']);
    await journal.finish('failed', 'boom');
    expect(calls.finishes).toEqual([{ runId: 'run-1', status: 'failed', error: 'boom' }]);
  });
});
