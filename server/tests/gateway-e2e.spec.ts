/** AI 网关端到端（离线）：文件配置 → storePrimaryConfig 选上游 → 真实 HTTP 调该上游。 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { saveGatewayUpstreams } from '../src/ai/gateway-store';
import { storePrimaryConfig } from '../src/ai/gateway-store';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += String(c)));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/chat/completions') {
        const body = JSON.parse(b || '{}') as { model?: string };
        res.end(JSON.stringify({ id: 'x', model: body.model, choices: [{ message: { role: 'assistant', content: 'hi' } }] }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });

describe('gateway e2e (offline)', () => {
  it('文件配置的上游可被选中，并被真实 HTTP 调用成功', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gwe2e-'));
    const file = join(dir, 'gw.json');
    try {
      saveGatewayUpstreams(
        [{ id: 'pp', label: 'PP', baseUrl: `${base}/v1`, apiKey: 'k', modelId: 'pp-model', enabled: true, priority: 0, weight: 1 }],
        {},
        file,
      );
      const env = { AI_GATEWAY_FILE: file };
      const cfg = storePrimaryConfig(env, file);
      expect(cfg).toBeDefined();
      expect(cfg!.id).toBe('pp');
      expect(cfg!.modelId).toBe('pp-model');
      const res = await fetch(`${cfg!.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg!.apiKey}` },
        body: JSON.stringify({ model: cfg!.modelId, messages: [{ role: 'user', content: 'hello' }] }),
      });
      expect(res.ok).toBe(true);
      const json = (await res.json()) as { model: string; choices: { message: { content: string } }[] };
      expect(json.model).toBe('pp-model');
      expect(json.choices[0]!.message.content).toBe('hi');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
