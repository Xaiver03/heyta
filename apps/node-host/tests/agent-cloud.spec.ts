/**
 * Node 宿主 Agent 闭环验收：真实 SQLite 文件 + 真实引擎 + 本地工具传输 + 循环 + 撤销。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCloudAgentTurn, toCloudToolDescriptors, type HarnessModelReply } from '@heyta/app-host';
import { afterEach, describe, expect, it } from 'vitest';

import { openNodeHost, type NodeHost } from '../src/host.js';
import { createNodeAgentToolTransport } from '../src/agent-cloud.js';

const dirs: string[] = [];
const hosts: NodeHost[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-agent-'));
  dirs.push(dir);
  return join(dir, 'heyta.sqlite');
}

afterEach(() => {
  for (const h of hosts.splice(0)) h.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Node 宿主 Agent 闭环（真实 SQLite）', () => {
  it('循环经本地传输读回真实任务；写入后 undoSince 整段撤销', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    hosts.push(host);
    await host.addTask('写周报');
    await host.addTask('开会');

    const grants = { list_tasks: true } as const;
    const transport = createNodeAgentToolTransport(host, grants as never);
    const scripted: HarnessModelReply[] = [
      { toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: {} }] },
      { text: '你有两个任务。' },
    ];
    const turn = await runCloudAgentTurn('我有哪些任务', {
      transport,
      tools: toCloudToolDescriptors(grants as never),
      systemPrompt: 's',
      runId: 'node-run-1',
      callModel: async () => scripted.shift()!,
    });

    expect(turn.text).toBe('你有两个任务。');
    const toolMsg = turn.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('写周报');
    expect(toolMsg?.content).toContain('开会');

    // 撤销这次 AI 操作（本地写入）：记录 seq → 写 → undoSince
    const seq = await host.engine.currentLocalSeq();
    await host.addTask('AI 刚建的');
    expect(host.listTasks().some((t) => t.title === 'AI 刚建的')).toBe(true);
    const outcome = await host.engine.undoSince(seq);
    expect(outcome.status).toBe('applied');
    expect(host.listTasks().some((t) => t.title === 'AI 刚建的')).toBe(false);
  });
});
