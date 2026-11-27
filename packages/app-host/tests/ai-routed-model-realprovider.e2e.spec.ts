/**
 * 真实 OpenAI 兼容端点的**两步**工具调用（本地 http 服务模拟）：
 * 证明 `assistant.tool_calls` + `tool` 帧被正确发出，第二步不会因缺帧 400。
 *
 * 用真实 socket + 真实 `invokeRouted`（不是注入 fetch），是最接近"真实 provider"的离线证据。
 */
import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { AiRoutingConfig } from '@heyta/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCloudAgentTurn } from '../src/agent-harness.js';
import { createRoutedModelCall } from '../src/ai-routed-model.js';
import { toCloudToolDescriptors, type CloudToolTransport } from '../src/ai-cloud-tools.js';
import type { LocalApiConfig } from '@heyta/local-api';

interface Body {
  messages?: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }>;
  tools?: unknown[];
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += String(c)));
    req.on('end', () => resolve(JSON.parse(b || '{}') as Body));
  });
}

describe('真实端点形状：两步工具调用不 400', () => {
  let server: Server;
  let base = '';
  const seen: Body[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      void (async () => {
        const body = await readBody(req);
        seen.push(body);
        res.setHeader('content-type', 'application/json');
        const isFirst = seen.length === 1;
        // 严格模拟真实端点：第二步若 assistant.tool_calls / tool_call_id 缺失，回 400。
        if (!isFirst) {
          const msgs = body.messages ?? [];
          const hasAssistantToolCalls = msgs.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
          const hasToolMsg = msgs.some((m) => m.role === 'tool' && typeof m.tool_call_id === 'string');
          if (!hasAssistantToolCalls || !hasToolMsg) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: { message: 'assistant.tool_calls or tool.tool_call_id missing' } }));
            return;
          }
        }
        const message = isFirst
          ? { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_tasks', arguments: '{}' } }] }
          : { role: 'assistant', content: '你有 2 个任务：写周报、开会。' };
        res.end(JSON.stringify({ id: 'chatcmpl-x', choices: [{ index: 0, message, finish_reason: isFirst ? 'tool_calls' : 'stop' }] }));
      })();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('第一步要工具 → 回灌 → 第二步到达（含 assistant.tool_calls 与 tool 帧）→ 最终回答', async () => {
    const routing: AiRoutingConfig = {
      enabled: true,
      allowRemote: false,
      endpoints: [{ id: 'local', label: 'local', endpoint: base, model: 'm', capabilities: ['structured_output', 'tool_calling'] }],
      routes: { 'tool-calling': [{ endpointId: 'local' }] },
    };
    const transport: CloudToolTransport = { invoke: async () => ({ ok: true, data: [{ title: '写周报' }, { title: '开会' }] }) };
    const grants = { list_tasks: true } as unknown as LocalApiConfig['grants'];

    const result = await runCloudAgentTurn('我有啥任务', {
      transport,
      tools: toCloudToolDescriptors(grants),
      systemPrompt: 's',
      callModel: createRoutedModelCall({ routing, consents: [] }),
    });

    expect(result.text).toBe('你有 2 个任务：写周报、开会。');
    expect(result.steps).toEqual([{ tool: 'list_tasks', kind: 'read', ok: true }]);
    // 第二步请求确含 assistant.tool_calls 与 tool 帧（否则模拟端点会回 400，result 不会成功）
    const second = seen[1]!;
    expect(second.messages?.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))).toBe(true);
    expect(second.messages?.some((m) => m.role === 'tool' && m.tool_call_id === 'c1')).toBe(true);
  });
});
