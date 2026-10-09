import { describe, expect, it, vi } from 'vitest';
import { generateInboundKeyPair, openInbound, sealInbound } from '@heyta/inbound-core';
import { runInboundAutomationEvent, type InboundAutomationRunOptions } from '../src/inbound-runner.js';

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
      receivedAt: 1_700_000_000_000, leaseGeneration: 1, leaseExpiresAt: '2030-01-01T00:00:00.000Z', attempt: 1,
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
      fetchImpl, publish, now: () => 1_800_000_000_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(requestBody.messages.at(-1).content).not.toContain('must-not-leave');
    expect(JSON.parse(requestBody.messages.at(-1).content).context.receivedAt).toBe(new Date(claimed.receivedAt).toISOString());
    expect(result.payload.tasks[0]).toMatchObject({ id: 'inbound:event-1:0', title: 'Inbox', priority: 1 });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-1', itemCount: 1 }));
    pair.privateKey.fill(0);
  });
});

async function fixture() {
  const pair = generateInboundKeyPair();
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks: [{ title: 'Captured' }] }) } }] })));
  const reserve = vi.fn(async () => ({ state: 'reserved' }));
  const advance = vi.fn(async () => true);
  const publish = vi.fn(async (_input: Parameters<InboundAutomationRunOptions['publish']>[0]) => undefined);
  const options: InboundAutomationRunOptions = {
    privateKey: pair.privateKey, accountId: 'account', serverOrigin: 'http://127.0.0.1:4321', keyEpoch: 1,
    claimed: { eventId: 'event', ruleId: 'rule', ruleVersion: 1, contentType: 'application/json',
      payloadCiphertext: JSON.stringify(await sealInbound(new TextEncoder().encode('{"title":"Captured"}'), pair.publicKey,
        { accountId: 'account', serverOrigin: 'http://127.0.0.1:4321', ruleId: 'rule', eventId: 'event', purpose: 'input', keyEpoch: 1 })),
      receivedAt: 1_700_000_000_000, leaseGeneration: 1, leaseExpiresAt: '2030-01-01T00:00:00Z', attempt: 1, allowedFields: ['title'], parseVersion: 1, maxItems: 50 },
    allowedFields: ['title'], routing: { enabled: true, allowRemote: false,
      endpoints: [{ id: 'local', label: 'local', endpoint: 'http://127.0.0.1:4321/v1', model: 'test' }],
      routes: { 'inbound-automation': [{ endpointId: 'local' }] } },
    consents: [], systemPrompt: 'Return JSON', parseVersion: 1, fetchImpl: fetchMock, reserve, advance, publish,
  };
  return { options, pair, fetchMock, reserve, advance, publish };
}

describe('inbound send boundary', () => {
  it.each(['local', 'direct'] as const)('freezes %s billing before the physical request', async (source) => {
    const { options, pair, reserve, fetchMock } = await fixture();
    if (source === 'direct') {
      options.routing = { ...options.routing, allowRemote: true,
        endpoints: [{ id: 'local', label: 'remote', endpoint: 'https://provider.example/v1', model: 'test' }] };
      options.consents = [{ feature: 'inbound-automation', destination: 'user-endpoint', grantedAt: 1 }];
    }
    try {
      await runInboundAutomationEvent(options);
      expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ billingSource: source }));
      expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    } finally { pair.privateKey.fill(0); }
  });

  it.each(['disabled', 'no-route', 'no-consent'] as const)('does not reserve quota when %s blocks the request', async (reason) => {
    const { options, pair, fetchMock, reserve, advance } = await fixture();
    try {
      if (reason === 'disabled') options.routing = { ...options.routing, enabled: false };
      if (reason === 'no-route') options.routing = { ...options.routing, routes: {} };
      if (reason === 'no-consent') options.routing = { ...options.routing, allowRemote: true,
        endpoints: [{ id: 'local', label: 'remote', endpoint: 'https://provider.example/v1', model: 'test' }] };
      await expect(runInboundAutomationEvent(options)).rejects.toThrow('model failed');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
      expect(advance).not.toHaveBeenCalled();
    } finally { pair.privateKey.fill(0); }
  });

  it('does not send after losing the attempt CAS', async () => {
    const { options, pair, fetchMock, advance, publish } = await fixture();
    advance.mockResolvedValue(false);
    try {
      await expect(runInboundAutomationEvent(options)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(advance).toHaveBeenCalledTimes(1);
      expect(publish).not.toHaveBeenCalled();
    } finally { pair.privateKey.fill(0); }
  });

  it('does not silently send to a second endpoint after an ambiguous provider failure', async () => {
    const { options, pair, fetchMock, reserve, advance } = await fixture();
    options.routing = { ...options.routing,
      endpoints: [...options.routing.endpoints, { id: 'backup', label: 'backup', endpoint: 'http://127.0.0.1:4322/v1', model: 'test' }],
      routes: { 'inbound-automation': [{ endpointId: 'local' }, { endpointId: 'backup' }] } };
    fetchMock.mockImplementation(async () => new Response('', { status: 503 }));
    try {
      await expect(runInboundAutomationEvent(options)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(advance).toHaveBeenLastCalledWith(expect.objectContaining({ from: 'sent', to: 'unknown' }));
    } finally { pair.privateKey.fill(0); }
  });

  it('decrypts old input, uses the provider secret, and seals the result to the current epoch', async () => {
    const { options, pair, publish } = await fixture();
    const current = generateInboundKeyPair();
    const retained = pair.privateKey.slice();
    options.privateKey = current.privateKey;
    options.keyEpoch = 2;
    options.loadPrivateKey = async (epoch) => epoch === 1 ? retained : undefined;
    options.secretStore = { get: async () => 'provider-secret' };
    options.routing = { ...options.routing, endpoints: options.routing.endpoints.map((endpoint) => ({ ...endpoint, keyRef: 'key' })) };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer provider-secret');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"tasks":[{"title":"Captured"}]}' } }] }));
    });
    options.fetchImpl = fetchMock;
    try {
      await runInboundAutomationEvent(options);
      expect(retained.every((byte) => byte === 0)).toBe(true);
      const published = publish.mock.calls[0]?.[0] as unknown as { resultCiphertext: string };
      const envelope = JSON.parse(published.resultCiphertext);
      expect(envelope.keyEpoch).toBe(2);
      const opened = await openInbound(envelope, current.privateKey, { accountId: 'account', serverOrigin: options.serverOrigin,
        ruleId: 'rule', eventId: 'event', purpose: 'result', keyEpoch: 2 });
      expect(JSON.parse(new TextDecoder().decode(opened)).tasks[0].title).toBe('Captured');
    } finally { pair.privateKey.fill(0); current.privateKey.fill(0); retained.fill(0); }
  });
});
