import { describe, expect, it, vi } from 'vitest';
import { generateInboundKeyPair, sealInbound } from '@heyta/inbound-core';
import { runInboundAutomationEvent } from '../src/inbound-runner.js';

describe('inbound automation runner', () => {
  it('uses the host fetch port, projects fields, and publishes one frozen result', async () => {
    const pair = generateInboundKeyPair();
    const claimed = {
      eventId: 'event-1', ruleId: 'rule-1', ruleVersion: 1,
      contentType: 'application/json' as const,
      payloadCiphertext: JSON.stringify(await sealInbound(
        new TextEncoder().encode(JSON.stringify({ title: 'Inbox', secret: 'must-not-leave' })),
        pair.publicKey,
        { accountId: 'account', serverOrigin: 'http://127.0.0.1:4321', ruleId: 'rule-1', eventId: 'event-1', purpose: 'input', keyEpoch: 1 },
      )),
      leaseGeneration: 1, leaseExpiresAt: '2030-01-01T00:00:00.000Z', attempt: 1,
      allowedFields: ['title'] as const, parseVersion: 1, maxItems: 50,
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ tasks: [{ title: 'Inbox', priority: 1 }] }) } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const publish = vi.fn().mockResolvedValue({});
    const result = await runInboundAutomationEvent({
      claimed,
      privateKey: pair.privateKey,
      accountId: 'account', serverOrigin: 'http://127.0.0.1:4321', keyEpoch: 1,
      allowedFields: ['title'],
      routing: {
        enabled: true, allowRemote: false,
        endpoints: [{ id: 'local', label: 'local', endpoint: 'http://127.0.0.1:4321/v1', model: 'test' }],
        routes: { 'inbound-automation': [{ endpointId: 'local' }] },
      },
      consents: [], systemPrompt: 'Return tasks JSON', parseVersion: 1,
      fetchImpl, publish, now: () => 1_700_000_000_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(requestBody.messages.at(-1).content).not.toContain('must-not-leave');
    expect(result.payload.tasks[0]).toMatchObject({ id: 'inbound:event-1:0', title: 'Inbox', priority: 1 });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-1', itemCount: 1 }));
    pair.privateKey.fill(0);
  });
});
