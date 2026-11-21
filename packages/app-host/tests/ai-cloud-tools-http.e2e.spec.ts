/**
 * 云端工具传输的**真 HTTP** 端到端：起一个本地 http server 充当 `/api/agent/tools`，
 * 让 `createHttpCloudToolTransport` + `runCloudAgentTurn` 走真实 socket 跑一遍。
 *
 * 这不是"注入假 fetch"——它验证：
 *   · URL / method / Authorization 头 / body 的**真实线形态**；
 *   · 真 `fetch`（Node 22 全局）能拿到服务端 JSON 信封；
 *   · 工具结果回灌后循环继续并出最终回答。
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CloudToolDescriptor } from '../src/ai-cloud-tools.js';
import { createHttpCloudToolTransport } from '../src/ai-cloud-tools.js';
import { runCloudAgentTurn, type HarnessModelReply } from '../src/agent-harness.js';

interface Seen {
  method?: string;
  path?: string;
  auth?: string;
  idem?: string;
  body?: string;
}

describe('云端工具传输（真 HTTP）', () => {
  let server: Server;
  let baseUrl = '';
  const seen: Seen = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += String(c)));
      req.on('end', () => {
        seen.method = req.method;
        seen.path = req.url;
        seen.auth = req.headers['authorization'] as string | undefined;
        seen.idem = req.headers['idempotency-key'] as string | undefined;
        seen.body = body;
        res.setHeader('content-type', 'application/json');
        if (req.method === 'POST' && req.url === '/api/agent/tools/list_tasks') {
          res.end(JSON.stringify({ ok: true, data: [{ title: '写周报' }, { title: '开会' }] }));
        } else if (req.method === 'POST' && req.url === '/api/agent/tools/create_task') {
          res.end(JSON.stringify({ ok: true, data: { applied: true } }));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, reason: 'not-found', message: '没有这个工具' }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('循环 → 真 HTTP 工具 → 结果回灌 → 最终回答', async () => {
    const transport = createHttpCloudToolTransport({
      baseUrl,
      getToken: () => 'tok-test-123',
    });
    const tools: CloudToolDescriptor[] = [
      { name: 'list_tasks', description: '列任务', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    ];
    const scripted: HarnessModelReply[] = [
      { toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: {} }] },
      { text: '你有 2 个任务：写周报、开会。' },
    ];
    const result = await runCloudAgentTurn('我有哪些任务', {
      transport,
      tools,
      systemPrompt: 's',
      runId: 'run-1',
      callModel: async () => scripted.shift()!,
    });

    expect(result.text).toBe('你有 2 个任务：写周报、开会。');
    expect(result.steps).toEqual([{ tool: 'list_tasks', ok: true }]);
    // 真实线形态
    expect(seen.method).toBe('POST');
    expect(seen.path).toBe('/api/agent/tools/list_tasks');
    expect(seen.auth).toBe('Bearer tok-test-123');
    expect(seen.idem).toBe('run-1:s0:c1');
    expect(JSON.parse(seen.body!)).toEqual({ args: {} });
  });

  it('服务端 404 → 工具失败作为 tool 消息回给模型', async () => {
    const transport = createHttpCloudToolTransport({ baseUrl });
    const tools: CloudToolDescriptor[] = [
      { name: 'no_such_tool', description: 'x', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    ];
    const scripted: HarnessModelReply[] = [
      { toolCalls: [{ id: 'c2', name: 'no_such_tool', arguments: {} }] },
      { text: '抱歉，这个工具不可用。' },
    ];
    const result = await runCloudAgentTurn('x', {
      transport,
      tools,
      systemPrompt: 's',
      callModel: async () => scripted.shift()!,
    });
    expect(result.steps[0]?.ok).toBe(false);
    expect(result.text).toBe('抱歉，这个工具不可用。');
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('没有这个工具');
  });
});
