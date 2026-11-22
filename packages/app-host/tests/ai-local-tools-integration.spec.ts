/**
 * 本地工具传输 —— **真实引擎 + 真实宿主**的集成测试。
 *
 * 证明 `createLocalToolTransport` 不是"只映射结果"：它经 `runSelectedTool` 在真实
 * 物化数据上执行。覆盖：
 *   · 只读工具 `list_tasks` 真的读回种子任务；
 *   · 写工具 `create_task` 只产出提案 → 传输回 `write-needs-confirm`，**不落库**。
 */
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { Operation } from '@heyta/sync-core';
import type { LocalApiConfig } from '@heyta/local-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';
import { createLocalApiHost } from '../src/local-api-host.js';
import { toCloudToolDescriptors } from '../src/ai-cloud-tools.js';
import { createAutoWriteLocalToolTransport, createLocalToolTransport } from '../src/ai-local-tools.js';
import { runCloudAgentTurn, type HarnessModelReply } from '../src/agent-harness.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;

const now = (): number => 1_700_000_000_000;

beforeEach(async () => {
  adapter = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => new NodeSqliteDriver(':memory:') });
  await adapter.init();
  engine = new OpLogEngine({ store: new DbOpLogStore<Operation<string>>(adapter), clientId: 'client-test', now });
  actions = createTaskActions(engine, { now, newTaskId: (() => { let n = 0; return () => `t-${++n}`; })() });
});

afterEach(() => adapter.close());

const grants = { list_tasks: true, create_task: true } as LocalApiConfig['grants'];

function makeTransport() {
  const host = createLocalApiHost(engine, actions, { isReadable: () => true });
  return createLocalToolTransport({ host, grants, getGrants: () => grants });
}

describe('createLocalToolTransport 对真实宿主', () => {
  it('只读 list_tasks 读回真实种子任务', async () => {
    const host = createLocalApiHost(engine, actions, { isReadable: () => true });
    await host.submit({ action: 'create-task', title: '写周报' });
    await host.submit({ action: 'create-task', title: '开会' });

    const transport = makeTransport();
    const scripted: HarnessModelReply[] = [
      { toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: {} }] },
      { text: '你有任务。' },
    ];
    const result = await runCloudAgentTurn('我有哪些任务', {
      transport,
      tools: toCloudToolDescriptors(grants),
      systemPrompt: 's',
      callModel: async () => scripted.shift()!,
    });

    expect(result.steps).toEqual([{ tool: 'list_tasks', ok: true }]);
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('写周报');
    expect(toolMsg?.content).toContain('开会');
  });

  it('写工具 create_task → write-needs-confirm，且不落库', async () => {
    const transport = makeTransport();
    const scripted: HarnessModelReply[] = [
      { toolCalls: [{ id: 'c1', name: 'create_task', arguments: { title: '新任务' } }] },
      { text: '需要你确认。' },
    ];
    const result = await runCloudAgentTurn('建个任务', {
      transport,
      tools: toCloudToolDescriptors(grants),
      systemPrompt: 's',
      callModel: async () => scripted.shift()!,
    });

    expect(result.steps[0]?.ok).toBe(false);
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('需要确认');
    // 未落库：再 list_tasks 仍是空的
    const listed = await transport.invoke('list_tasks', {});
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.data).toEqual([]);
  });
});

import { executeAiToolProposal } from '../src/ai-tool-run.js';

describe('写路径 D1 端到端：seq → 确认写 → undoSince', () => {
  it('AI 提议建任务、确认后落库、undoSince 整段撤销', async () => {
    const host = createLocalApiHost(engine, actions, { isReadable: () => true });
    const seqBefore = await engine.currentLocalSeq();

    const result = await executeAiToolProposal(
      host,
      { ruleId: 'r', tool: 'create_task', intent: { action: 'create-task', title: 'AI 建的任务' } },
      'exec-1',
      { getGrants: () => ({ create_task: true }) as never },
    );
    expect(result.ok).toBe(true);
    // 落库：能读到
    const listed = await host.listTasks?.({});
    const titles = (listed ?? []).map((t) => t.title);
    expect(titles).toContain('AI 建的任务');

    // 撤销这次 AI 操作（本地写入段）
    const outcome = await engine.undoSince(seqBefore);
    expect(outcome.status).toBe('applied');
    const after = await host.listTasks?.({});
    expect((after ?? []).map((t) => t.title)).not.toContain('AI 建的任务');
  });
});


describe('可写传输：Harness 模式 AI 直接写 + undoSince 撤销（D1）', () => {
  it('create_task 经 auto-write 传输真落库；undoSince 撤销', async () => {
    const host = createLocalApiHost(engine, actions, { isReadable: () => true });
    const grants2 = { create_task: true } as LocalApiConfig['grants'];
    const transport = createAutoWriteLocalToolTransport({ host, grants: grants2, getGrants: () => grants2 });
    const seq = await engine.currentLocalSeq();
    const r = await transport.invoke('create_task', { title: 'Harness 写的' });
    expect(r.ok).toBe(true);
    const listed = await host.listTasks?.({});
    expect((listed ?? []).map((t) => t.title)).toContain('Harness 写的');
    const outcome = await engine.undoSince(seq);
    expect(outcome.status).toBe('applied');
    const after = await host.listTasks?.({});
    expect((after ?? []).map((t) => t.title)).not.toContain('Harness 写的');
  });
});


describe('AI 写入 = 普通 op（与手动写同一条同步链，非本地孤岛）', () => {
  it('executeAiToolProposal 产生的 op 带 clientId/vectorClock，可被同步客户端上传', async () => {
    const host = createLocalApiHost(engine, actions, { isReadable: () => true });
    const res = await executeAiToolProposal(
      host,
      { ruleId: 'r', tool: 'create_task', intent: { action: 'create-task', title: 'AI 同步验证' } },
      'exec-sync',
      { getGrants: () => ({ create_task: true }) as never },
    );
    expect(res.ok).toBe(true);
    const entityId = 'taskId' in res ? String(res.taskId) : undefined;
    expect(entityId).toBeDefined();
    const ops = await engine.getOpsForEntity('TASK', entityId!);
    expect(ops.length).toBeGreaterThan(0);
    const op = ops[ops.length - 1]!;
    // 与手动写同形：带本机 clientId 与向量时钟 —— 同步客户端据此上传、其他端据此收敛。
    expect(op.clientId).toBe('client-test');
    expect(Object.keys(op.vectorClock ?? {}).length).toBeGreaterThan(0);
  });
});
