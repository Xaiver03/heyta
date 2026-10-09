import { describe, expect, it, vi } from 'vitest';
import { createInboundRulesRemote } from '../src/inbound-rules-remote.js';
import { AutomationEntitlementRequiredError } from '../src/inbound-worker.js';
import { AutomationTicketError, type AutomationTicketRequest } from '../src/inbound-entitlement-tickets.js';
import { AUTOMATION_ENTITLEMENT_TICKET_HEADER } from '@heyta/inbound-core';

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

/**
 * 规则面那两个受权益闸门的写。整族按表跑：以后这里再多一条要票的写，
 * 忘记接票的那一枚会在这一族里红，而不是红在用户"点了没反应"上。
 */
describe('automation rule transport entitlement ticket', () => {
  const ticket = `${'e'.repeat(40)}.${'f'.repeat(88)}`;
  const gatedWrites: readonly {
    readonly name: string;
    readonly action: string;
    readonly run: (remote: ReturnType<typeof createInboundRulesRemote>) => Promise<unknown>;
    readonly accepted: () => Response;
  }[] = [
    { name: 'rule-enable', action: 'rule-enable',
      run: (remote) => remote.setEnabled(rule.id, true),
      accepted: () => response({ ...rule, enabled: true }) },
    { name: 'sender-credential-issue', action: 'sender-credential-issue',
      run: (remote) => remote.issueSenderCredential(rule.id, 'hook'),
      accepted: () => response({ credentialId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', keyId: 'hook', secret: 's'.repeat(43), ruleId: rule.id }, 201) },
  ];

  it('attaches the ticket the action asked for, on the head and not in the body', async () => {
    for (const write of gatedWrites) {
      const asked: AutomationTicketRequest[] = [];
      const fetch = vi.fn().mockImplementation(async (_url: URL, init?: RequestInit) => write.accepted());
      const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch,
        getEntitlementTicket: async (request) => { asked.push(request); return ticket; } });
      await write.run(remote);
      expect({ name: write.name, asked }).toEqual({ name: write.name, asked: [{ action: write.action, ruleId: rule.id }] });
      const headers = (fetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
      expect({ name: write.name, ticket: headers[AUTOMATION_ENTITLEMENT_TICKET_HEADER] ?? null }).toEqual({ name: write.name, ticket });
      expect({ name: write.name, bodyHasTicket: String(fetch.mock.calls[0]?.[1]?.body).includes(ticket) })
        .toEqual({ name: write.name, bodyHasTicket: false });
    }
  });

  it('asks for no ticket where the route needs none, including turning a rule off', async () => {
    const asked: string[] = [];
    const fetch = vi.fn().mockImplementation(async (_url: URL, init?: RequestInit) => (init?.method === 'GET' ? response({ rules: [rule] }) : response(rule)));
    const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch,
      getEntitlementTicket: async (request) => { asked.push(request.action); return ticket; } });
    await remote.list();
    await remote.setEnabled(rule.id, false);
    await remote.update(rule.id, { targetProjectId: 'project' });
    await remote.remove(rule.id);
    expect(asked).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.every(([, init]) => !Object.keys((init?.headers ?? {}) as Record<string, string>).includes(AUTOMATION_ENTITLEMENT_TICKET_HEADER))).toBe(true);
  });

  it('reports a 402 as a missing entitlement instead of a transport failure', async () => {
    for (const write of gatedWrites) {
      const fetch = vi.fn().mockResolvedValue(response({ error: 'Subscription required', errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'entitlement-lapsed' }, 402));
      const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch,
        getEntitlementTicket: async () => ticket });
      const caught = await write.run(remote).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(AutomationEntitlementRequiredError);
      expect((caught as AutomationEntitlementRequiredError).reason).toBe('entitlement-lapsed');
      expect((caught as Error).message).not.toContain(ticket);
    }
  });

  it('lets the ticket source failure through instead of relabelling it as transport', async () => {
    const fetch = vi.fn().mockResolvedValue(response(rule));
    const remote = createInboundRulesRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch,
      getEntitlementTicket: async () => { throw new AutomationTicketError('AUTOMATION_LINK_NOT_BOUND', true); } });
    const caught = await remote.setEnabled(rule.id, true).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(AutomationTicketError);
    expect((caught as AutomationTicketError).waiting).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
