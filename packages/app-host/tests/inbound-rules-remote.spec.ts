import { describe, expect, it, vi } from 'vitest';
import { createInboundRulesRemote } from '../src/inbound-rules-remote.js';

const rule = { id: '11111111-1111-4111-8111-111111111111', version: 1, enabled: false, keyId: 'hook', createdAt: '2026-01-01T00:00:00.000Z', deletedAt: null, allowedFields: ['title'], targetProjectId: null, timezone: 'UTC', parseVersion: 1, authorizationVersion: 1, maxItems: 50 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('automation rule transport', () => {
  it('validates encrypted draft identity, decisions and matching final state', async () => {
    const resultCiphertext = JSON.stringify({ version: 1, keyEpoch: 2, ephemeralPublicKey: 'A'.repeat(43) + '=',
      nonce: 'A'.repeat(16), ciphertext: 'A'.repeat(32) });
    const snapshot = { eventId: 'event', ruleId: rule.id, ruleVersion: 1, parseVersion: 1, attempt: 2,
      resultDigest: 'a'.repeat(64), resultItemCount: 1, resultCiphertext };
    const fetch = vi.fn().mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(response({ eventId: 'event', state: 'cancelled' }));
    const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    expect(await remote.readDraft('event')).toEqual(snapshot);
    const decision = { decision: 'cancel' as const, expectedAttempt: 2, expectedRuleVersion: 1, expectedDigest: snapshot.resultDigest };
    expect(await remote.decideDraft('event', decision)).toEqual({ eventId: 'event', state: 'cancelled' });
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: 'Bearer token' });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual(decision);
    fetch.mockResolvedValueOnce(response({ ...snapshot, eventId: 'other' }));
    await expect(remote.readDraft('event')).rejects.toMatchObject({ code: 'transport' });
    fetch.mockResolvedValueOnce(response({ eventId: 'event', state: 'prepared' }));
    await expect(remote.decideDraft('event', decision)).rejects.toMatchObject({ code: 'transport' });
    fetch.mockResolvedValueOnce(response({}, 409));
    await expect(remote.decideDraft('event', decision)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('keeps rule CRUD in one host-neutral client and forwards config exactly', async () => {
    const fetch = vi.fn().mockImplementation(async (_url: URL, init?: RequestInit) => response(init?.method === 'GET' ? { rules: [rule] } : rule));
    const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    expect(await remote.list()).toEqual([rule]);
    await remote.create('hook', { allowedFields: ['title', 'dueDate'], timezone: 'Asia/Shanghai', maxItems: 2 });
    await remote.update(rule.id, { targetProjectId: 'project' });
    await remote.setEnabled(rule.id, true);
    await remote.remove(rule.id);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ keyId: 'hook', allowedFields: ['title', 'dueDate'], timezone: 'Asia/Shanghai', maxItems: 2 });
  });
  it('fails closed on auth, entitlement and malformed responses', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ error: 'x' }, 403));
    const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    await expect(remote.list()).rejects.toMatchObject({ code: 'forbidden' });
    const malformed = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: vi.fn().mockResolvedValue(response({ rules: [{}] })) });
    await expect(malformed.list()).rejects.toMatchObject({ code: 'transport' });
  });
  it('manages sender credentials without ever accepting a malformed secret response', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ credentials: [{ credentialId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', keyId: 'hook', createdAt: '2026-01-01T00:00:00.000Z', revokedAt: null, rotatedAt: null }] }))
      .mockResolvedValueOnce(response({ credentialId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', keyId: 'hook', secret: 's'.repeat(43), ruleId: rule.id }, 201))
      .mockResolvedValueOnce(response({ revoked: true }));
    const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    expect(await remote.listSenderCredentials(rule.id)).toHaveLength(1);
    expect(await remote.issueSenderCredential(rule.id, 'hook')).toMatchObject({ ruleId: rule.id });
    expect(await remote.revokeSenderCredential('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(true);
  });
  it('sends a signed minimal test event and accepts only opaque status', async () => {
    const fetch = vi.fn().mockImplementation(async (_url: URL, init?: RequestInit) => response({ eventId: (init?.headers as Record<string, string>)['x-heyta-event-id'], state: 'queued' }, 202));
    const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    const result = await remote.testSend(rule.id, 'hook', 's'.repeat(43));
    expect(result.state).toBe('queued');
    const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-heyta-key-id']).toBe('hook');
    expect(headers['x-heyta-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/api/automation/v1/hooks/');
  });
});
