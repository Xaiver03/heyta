import { describe, expect, it, vi } from 'vitest';
import { createInboundRulesRemote } from '../src/inbound-rules-remote.js';

const rule = { id: '11111111-1111-4111-8111-111111111111', version: 1, enabled: false, keyId: 'hook', createdAt: '2026-01-01T00:00:00.000Z', deletedAt: null, allowedFields: ['title'], targetProjectId: null, timezone: 'UTC', parseVersion: 1, authorizationVersion: 1, maxItems: 50 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('automation rule transport', () => {
  it('keeps rule CRUD in one host-neutral client and forwards config exactly', async () => {
    const fetch = vi.fn().mockImplementation(async (_url: URL, init?: RequestInit) => response(init?.method === 'GET' ? { rules: [rule] } : rule));
    const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    expect(await remote.list()).toEqual([rule]);
    await remote.create('hook', { allowedFields: ['title', 'dueDate'], timezone: 'Asia/Shanghai', maxItems: 2 });
    await remote.update(rule.id, { targetProjectId: 'project' });
    await remote.setEnabled(rule.id, true);
    await remote.remove(rule.id);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ keyId: 'hook', allowedFields: ['title', 'dueDate'], timezone: 'Asia/Shanghai', maxItems: 2 });
  });
  it('fails closed on auth, entitlement and malformed responses', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ error: 'x' }, 403));
    const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    await expect(remote.list()).rejects.toMatchObject({ code: 'forbidden' });
    const malformed = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: vi.fn().mockResolvedValue(response({ rules: [{}] })) });
    await expect(malformed.list()).rejects.toMatchObject({ code: 'transport' });
  });
});
