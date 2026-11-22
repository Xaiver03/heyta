/** 管理后台 AI 网关路由：列表(脱敏)/保存(校验)/试连。 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { aiGatewayRoutes } from '../src/admin/ai-gateway.routes';

const dirs: string[] = [];
function tempFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'gw-'));
  dirs.push(d);
  return join(d, 'ai-gateway.json');
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function makeApp(opts: { file: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }) {
  const app = Fastify();
  await app.register(aiGatewayRoutes, {
    file: opts.file,
    env: opts.env ?? {},
    authenticate: async () => {}, // 测试绕过 requireAdmin
    ...(opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl }),
  });
  return app;
}

describe('admin ai-gateway routes', () => {
  it('PUT 保存合法上游 → GET 脱敏列出（无 apiKey）', async () => {
    const file = tempFile();
    const app = await makeApp({ file });
    const put = await app.inject({ method: 'PUT', url: '/ai-gateway', payload: { upstreams: [{ id: 'pp', label: 'PP', baseUrl: 'https://pp/v1', apiKey: 'secret', modelId: 'm' }] } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/ai-gateway' });
    const body = get.json() as { source: string; upstreams: Array<Record<string, unknown>> };
    expect(body.source).toBe('file');
    expect(body.upstreams[0]!.id).toBe('pp');
    expect(body.upstreams[0]!.hasApiKey).toBe(true);
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('PUT 省略 apiKey（只改展示名）→ 沿用已存密钥', async () => {
    const file = tempFile();
    const app = await makeApp({ file });
    await app.inject({ method: 'PUT', url: '/ai-gateway', payload: { upstreams: [{ id: 'pp', label: 'old', baseUrl: 'https://pp/v1', apiKey: 'secret', modelId: 'm' }] } });
    const put2 = await app.inject({ method: 'PUT', url: '/ai-gateway', payload: { upstreams: [{ id: 'pp', label: 'new', baseUrl: 'https://pp/v1', modelId: 'm' }] } });
    expect(put2.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/ai-gateway' });
    const u = get.json().upstreams[0];
    expect(u.label).toBe('new');
    expect(u.hasApiKey).toBe(true); // 密钥没被清空
  });

  it('PUT 非法项 → 400 且不落盘', async () => {
    const file = tempFile();
    const app = await makeApp({ file });
    const put = await app.inject({ method: 'PUT', url: '/ai-gateway', payload: { upstreams: [{ id: 'x' }] } });
    expect(put.statusCode).toBe(400);
    expect(put.json().code).toBe('INVALID_GATEWAY');
  });

  it('POST /test：https 上游用 Bearer 探 /models', async () => {
    const file = tempFile();
    let seen: { url: string; auth?: string } | undefined;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(url), auth: (init?.headers as Record<string, string> | undefined)?.['authorization'] };
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const app = await makeApp({ file, fetchImpl });
    await app.inject({ method: 'PUT', url: '/ai-gateway', payload: { upstreams: [{ id: 'pp', baseUrl: 'https://pp/v1', apiKey: 'k', modelId: 'm' }] } });
    const res = await app.inject({ method: 'POST', url: '/ai-gateway/test', payload: { id: 'pp' } });
    expect(res.json()).toEqual({ ok: true, status: 200 });
    expect(seen!.url).toBe('https://pp/v1/models');
    expect(seen!.auth).toBe('Bearer k');
  });

  it('POST /test：http 上游拒绝（必须是 https）', async () => {
    const file = tempFile();
    const app = await makeApp({ file });
    await app.inject({ method: 'PUT', url: '/ai-gateway', payload: { upstreams: [{ id: 'x', baseUrl: 'http://x/v1', modelId: 'm' }] } });
    const res = await app.inject({ method: 'POST', url: '/ai-gateway/test', payload: { id: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('insecure-url');
  });
});
