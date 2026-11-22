import { describe, expect, it } from 'vitest';
import { adminPutAiGateway, adminTestAiUpstream, fetchAdminAiGateway } from '../src/admin-client.js';

function capture(responses: Record<string, unknown>) {
  const calls: { url: string; method: string; auth?: string; body?: unknown }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      auth: (init?.headers as Record<string, string> | undefined)?.['authorization'],
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const u = String(url);
    const key = u.includes('/test') ? 'test' : u.includes('/ai-gateway') ? 'gw' : 'x';
    return new Response(JSON.stringify(responses[key] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const options = (fetchImpl: typeof fetch) => ({ baseUrl: 'https://h', getToken: async () => 'tok', fetchImpl });

describe('admin ai-gateway client', () => {
  it('fetchAdminAiGateway GET + Bearer', async () => {
    const { calls, fetchImpl } = capture({ gw: { ok: true, source: 'env', upstreams: [], skipped: [] } });
    const r = await fetchAdminAiGateway(options(fetchImpl));
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ url: 'https://h/api/admin/ai-gateway', method: 'GET', auth: 'Bearer tok' });
  });

  it('adminPutAiGateway PUT 带 upstreams 体', async () => {
    const { calls, fetchImpl } = capture({ gw: { ok: true, upstreams: [] } });
    await adminPutAiGateway(options(fetchImpl), [{ id: 'pp', baseUrl: 'https://pp/v1', modelId: 'm' }]);
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.body).toEqual({ upstreams: [{ id: 'pp', baseUrl: 'https://pp/v1', modelId: 'm' }] });
  });

  it('adminTestAiUpstream POST {id}', async () => {
    const { calls, fetchImpl } = capture({ test: { ok: true, status: 200 } });
    const r = await adminTestAiUpstream(options(fetchImpl), 'pp');
    expect(r.ok && r.data.status).toBe(200);
    expect(calls[0]!.url).toBe('https://h/api/admin/ai-gateway/test');
    expect(calls[0]!.body).toEqual({ id: 'pp' });
  });
});
