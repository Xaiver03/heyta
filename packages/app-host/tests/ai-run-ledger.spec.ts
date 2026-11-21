/**
 * AI 运行账（run ledger）测试：把"这次 AI 发送写了几条"变成可断言的事实。
 * 这是"撤销这次 AI 操作"的地基（审计 §2-D2 / §3-P0-2 的记录半边）。
 */
import { describe, expect, it } from 'vitest';

import type { LocalApiHost, LocalApiWriteIntent, LocalApiWriteResult } from '@heyta/local-api';

import { executeAiToolProposal, type AiToolProposal, type AiToolAuthorization } from '../src/ai-tool-run.js';
import { aiRunWrites } from '../src/ai-run-ledger.js';

function makeHost(ok: boolean): LocalApiHost {
  const host = {
    submit: async (_intent: LocalApiWriteIntent): Promise<LocalApiWriteResult> =>
      ({ ok } as unknown as LocalApiWriteResult),
  };
  return host as unknown as LocalApiHost;
}

const auth: AiToolAuthorization = {
  getGrants: () => ({ create_task: true, create_note: true }) as never,
};

const createTask: AiToolProposal = {
  ruleId: 'r1',
  tool: 'create_task',
  intent: { action: 'create-task', title: 'A' },
};
const createNote: AiToolProposal = {
  ruleId: 'r2',
  tool: 'create_note',
  intent: { action: 'create-note', content: 'B' },
};

describe('AI 运行账 ai-run-ledger', () => {
  it('一次发送（executionId）的成功写入被记到该 runId 下', async () => {
    const host = makeHost(true);
    await executeAiToolProposal(host, createTask, 'run-1', auth);
    const writes = aiRunWrites(host, 'run-1');
    expect(writes.map((w) => w.tool)).toEqual(['create_task']);
    expect(writes[0]?.action).toBe('create-task');
    expect(writes[0]?.runId).toBe('run-1');
  });

  it('不同 runId 互不混入', async () => {
    const host = makeHost(true);
    await executeAiToolProposal(host, createTask, 'runA', auth);
    await executeAiToolProposal(host, createNote, 'runB', auth);
    expect(aiRunWrites(host, 'runA').map((w) => w.tool)).toEqual(['create_task']);
    expect(aiRunWrites(host, 'runB').map((w) => w.tool)).toEqual(['create_note']);
  });

  it('同一 executionId 的重复提交只记一次（去重不重复记账）', async () => {
    const host = makeHost(true);
    await executeAiToolProposal(host, createTask, 'run-dup', auth);
    await executeAiToolProposal(host, createTask, 'run-dup', auth);
    expect(aiRunWrites(host, 'run-dup').length).toBe(1);
  });

  it('写入失败不记账（没落库就不算写过）', async () => {
    const host = makeHost(false);
    await executeAiToolProposal(host, createTask, 'run-fail', auth);
    expect(aiRunWrites(host, 'run-fail')).toEqual([]);
  });
});
