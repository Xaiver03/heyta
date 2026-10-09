import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_ENTITLEMENT_TICKET_HEADER } from '@heyta/inbound-core';
import { advanceAutomationAiAttempt, reserveAutomationAiAttempt, claimAutomationEvent, createInboundUploadAuthorization, journalCommitProofBeforeDispatch, publishAutomationResult, readAutomationPreparedResult, registerAutomationWorker, renewAutomationLease, requestCommitPermitAndJournal, AutomationEntitlementRequiredError } from '../src/inbound-worker';

const credential = {
  workerId: '11111111-1111-4111-8111-111111111111', workerToken: 'a'.repeat(64), userId: 'u',
  clientId: 'client', databaseEpoch: 'epoch', serverOrigin: 'https://example.test',
};

describe('inbound worker host wiring', () => {
  it('freezes source only at reserve and rejects a mismatched reservation', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ periodAnchor: null, billingSource: 'local', state: 'reserved' }))
      .mockResolvedValueOnce(Response.json({ changed: true }))
      .mockResolvedValueOnce(Response.json({ periodAnchor: null, billingSource: 'direct', state: 'reserved' }));
    const options = { baseUrl: 'https://example.test', token: 'jwt', worker: credential, eventId: 'event',
      ruleId: credential.workerId, parseVersion: 1, attempt: 1, leaseGeneration: 1, fetchImpl };
    await expect(reserveAutomationAiAttempt({ ...options, billingSource: 'local' })).resolves.toMatchObject({ billingSource: 'local' });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1].body)).billingSource).toBe('local');
    await expect(advanceAutomationAiAttempt({ ...options, from: 'reserved', to: 'sent' })).resolves.toBe(true);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1].body))).not.toHaveProperty('billingSource');
    await expect(reserveAutomationAiAttempt({ ...options, billingSource: 'local' })).rejects.toThrow('Invalid automation AI reservation response');
  });

  it('loads a bound secret and only returns proofs for inbound operations', async () => {
    const secrets = { load: vi.fn().mockResolvedValue(credential), save: vi.fn(), clear: vi.fn() };
    const journal = { load: vi.fn().mockImplementation(async (id: string) => id === 'event' ? 'proof' : undefined), save: vi.fn(), remove: vi.fn() };
    const get = createInboundUploadAuthorization({ userId: 'u', secrets, journal });
    await expect(get({ baseUrl: 'https://example.test/api', clientId: 'client', token: 'jwt', opIds: ['inbound:event', 'ordinary'] }))
      .resolves.toEqual({ workerToken: 'a'.repeat(64), databaseEpoch: 'epoch', commitProofs: { 'inbound:event': 'proof' } });
    expect(journal.load).toHaveBeenCalledWith('event');
  });

  it('fails closed on origin or client mismatch', async () => {
    const secrets = { load: vi.fn().mockResolvedValue(credential), save: vi.fn(), clear: vi.fn() };
    const journal = { load: vi.fn(), save: vi.fn(), remove: vi.fn() };
    const get = createInboundUploadAuthorization({ userId: 'u', secrets, journal });
    await expect(get({ baseUrl: 'not a url', clientId: 'client', token: 'jwt', opIds: ['inbound:event'] })).resolves.toBeUndefined();
    secrets.load.mockResolvedValue({ ...credential, clientId: 'other' });
    await expect(get({ baseUrl: 'https://example.test', clientId: 'client', token: 'jwt', opIds: ['inbound:event'] })).resolves.toBeUndefined();
  });

  it('journals before dispatch and leaves the receipt on dispatch failure', async () => {
    const calls: string[] = [];
    const journal = { load: vi.fn(), save: vi.fn(async () => { calls.push('save'); }), remove: vi.fn() };
    await expect(journalCommitProofBeforeDispatch(journal, 'event', 'proof', async () => { calls.push('dispatch'); throw new Error('offline'); })).rejects.toThrow('offline');
    expect(calls).toEqual(['save', 'dispatch']);
  });

  it('registers through HTTP and saves the secret before returning', async () => {
    const save = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ workerId: credential.workerId,
      workerToken: credential.workerToken, syncClientId: credential.clientId, databaseEpoch: credential.databaseEpoch }), { status: 201 }));
    const result = await registerAutomationWorker({ baseUrl: 'https://example.test', token: 'jwt', userId: 'u',
      clientId: 'client', databaseEpoch: 'epoch', secrets: { load: vi.fn(), save, clear: vi.fn() }, fetchImpl });
    expect(result.serverOrigin).toBe('https://example.test');
    expect(save).toHaveBeenCalledWith(result);
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer jwt' });
  });

  it('journals the signed permit returned by HTTP', async () => {
    const save = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ eventId: 'event', opId: 'inbound:event', proof: 'body.sig' }), { status: 201 }));
    const proof = await requestCommitPermitAndJournal({ baseUrl: 'https://example.test', token: 'jwt', worker: credential,
      request: { clientId: 'client', databaseEpoch: 'epoch', eventId: 'event', opId: 'inbound:event', ruleId: credential.workerId,
        ruleVersion: 1, parseVersion: 1, resultDigest: 'a'.repeat(64), itemCount: 1 }, journal: { load: vi.fn(), save, remove: vi.fn() }, fetchImpl });
    expect(proof).toBe('body.sig');
    expect(save).toHaveBeenCalledWith('event', 'body.sig');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-heyta-worker-token']).toBe('a'.repeat(64));
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt');
  });

  it('claims and renews opaque events without exposing worker secrets to the body', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ eventId: 'event', ruleId: 'rule', ruleVersion: 1,
        payloadCiphertext: '{}', receivedAt: 1_700_000_000_000, leaseGeneration: 2, leaseExpiresAt: '2030-01-01T00:00:00.000Z', attempt: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ eventId: 'event', ruleId: 'rule', ruleVersion: 1,
        payloadCiphertext: '{}', receivedAt: 1_700_000_000_000, leaseGeneration: 2, leaseExpiresAt: '2030-01-01T00:01:00.000Z', attempt: 1 }), { status: 200 }));
    const claimed = await claimAutomationEvent({ baseUrl: 'https://example.test', token: 'jwt', worker: credential, fetchImpl });
    expect(claimed?.eventId).toBe('event');
    const renewed = await renewAutomationLease({ baseUrl: 'https://example.test', token: 'jwt', worker: credential,
      eventId: 'event', leaseGeneration: 2, fetchImpl });
    expect(renewed.leaseGeneration).toBe(2);
    const claimBody = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body));
    expect(claimBody).toEqual({ clientId: 'client' });
    expect(claimBody.workerToken).toBeUndefined();
  });

  it('publishes a frozen encrypted result and validates the opaque response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ eventId: 'event', state: 'prepared', parseVersion: 1 }), { status: 200 }));
    await expect(publishAutomationResult({ baseUrl: 'https://example.test', token: 'jwt', worker: credential,
      itemCount: 1,
      eventId: 'event', leaseGeneration: 2, parseVersion: 1, resultDigest: 'b'.repeat(64), resultCiphertext: '{}' , fetchImpl }))
      .resolves.toEqual({ eventId: 'event', state: 'prepared', parseVersion: 1 });
  });

  it('recovers an encrypted prepared result without returning task plaintext', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ eventId: 'event', ruleId: 'rule', ruleVersion: 2,
      parseVersion: 3, resultDigest: 'b'.repeat(64), resultItemCount: 1, resultCiphertext: 'opaque', state: 'prepared' }), { status: 200 }));
    const result = await readAutomationPreparedResult({ baseUrl: 'https://example.test', token: 'jwt', worker: credential, eventId: 'event', fetchImpl });
    expect(result?.resultCiphertext).toBe('opaque');
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain('clientId=client');
  });
});

const ticket = `${'c'.repeat(40)}.${'d'.repeat(88)}`;
const ticketHeader = (options: RequestInit): Record<string, string> => options.headers as Record<string, string>;

/** 需要逐次票据的五个闸门调用。整族按表跑，漏接一票的那一条就会红。 */
const gatedCalls: readonly {
  readonly name: string;
  readonly run: (fetchImpl: typeof fetch, entitlementTicket?: string) => Promise<unknown>;
  readonly accepted: () => Response;
}[] = [
  {
    name: 'worker-register',
    run: (fetchImpl, entitlementTicket) => registerAutomationWorker({
      baseUrl: 'https://example.test', token: 'jwt', userId: 'u', clientId: 'client', databaseEpoch: 'epoch',
      secrets: { load: vi.fn(), save: vi.fn(), clear: vi.fn() },
      ...(entitlementTicket === undefined ? {} : { entitlementTicket }), fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ workerId: credential.workerId, workerToken: credential.workerToken,
      syncClientId: credential.clientId, databaseEpoch: credential.databaseEpoch }), { status: 201 }),
  },
  {
    name: 'commit-permit',
    run: (fetchImpl, entitlementTicket) => requestCommitPermitAndJournal({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential,
      request: { clientId: 'client', databaseEpoch: 'epoch', eventId: 'event', opId: 'inbound:event', ruleId: credential.workerId,
        ruleVersion: 1, parseVersion: 1, resultDigest: 'a'.repeat(64), itemCount: 1 },
      journal: { load: vi.fn(), save: vi.fn(), remove: vi.fn() },
      ...(entitlementTicket === undefined ? {} : { entitlementTicket }), fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ eventId: 'event', opId: 'inbound:event', proof: 'body.sig' }), { status: 201 }),
  },
  {
    name: 'event-claim',
    run: (fetchImpl, entitlementTicket) => claimAutomationEvent({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential,
      ...(entitlementTicket === undefined ? {} : { entitlementTicket }), fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ state: 'empty' }), { status: 200 }),
  },
  {
    name: 'ai-reserve',
    run: (fetchImpl, entitlementTicket) => reserveAutomationAiAttempt({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential, eventId: 'event', ruleId: credential.workerId,
      parseVersion: 1, attempt: 1, leaseGeneration: 1, billingSource: 'local',
      ...(entitlementTicket === undefined ? {} : { entitlementTicket }), fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ periodAnchor: null, billingSource: 'local', state: 'reserved' }), { status: 200 }),
  },
  {
    name: 'result-publish',
    run: (fetchImpl, entitlementTicket) => publishAutomationResult({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential, eventId: 'event', leaseGeneration: 1,
      parseVersion: 1, itemCount: 1, resultDigest: 'b'.repeat(64), resultCiphertext: '{}',
      ...(entitlementTicket === undefined ? {} : { entitlementTicket }), fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ eventId: 'event', state: 'prepared', parseVersion: 1 }), { status: 200 }),
  },
];

describe('per-action entitlement ticket on the worker transport', () => {
  it('carries each gated call its own ticket in the header and never in the body', async () => {
    for (const call of gatedCalls) {
      const fetchImpl = vi.fn().mockImplementation(async () => call.accepted());
      await call.run(fetchImpl, ticket);
      const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
      expect({ name: call.name, ticket: ticketHeader(init)[AUTOMATION_ENTITLEMENT_TICKET_HEADER] ?? null })
        .toEqual({ name: call.name, ticket });
      expect({ name: call.name, bodyHasTicket: String(init.body).includes(ticket) })
        .toEqual({ name: call.name, bodyHasTicket: false });
    }
  });

  it('sends no ticket header at all when the host has none', async () => {
    for (const call of gatedCalls) {
      const fetchImpl = vi.fn().mockImplementation(async () => call.accepted());
      await call.run(fetchImpl);
      const headers = ticketHeader(fetchImpl.mock.calls[0]?.[1] as RequestInit);
      expect({ name: call.name, hasHeader: AUTOMATION_ENTITLEMENT_TICKET_HEADER in headers })
        .toEqual({ name: call.name, hasHeader: false });
      expect({ name: call.name, authorization: headers.authorization }).toEqual({ name: call.name, authorization: 'Bearer jwt' });
    }
  });

  it('reports a 402 as a missing entitlement, not as a transport failure', async () => {
    for (const call of gatedCalls) {
      const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
        error: 'Subscription required', errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'entitlement-lapsed',
      }), { status: 402 }));
      const caught = await call.run(fetchImpl, ticket).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(AutomationEntitlementRequiredError);
      expect((caught as AutomationEntitlementRequiredError).reason).toBe('entitlement-lapsed');
      expect((caught as Error).message).not.toContain(ticket);
    }
  });

  it('keeps the older transport rejections for anything that is not a 402', async () => {
    for (const call of gatedCalls) {
      const fetchImpl = vi.fn().mockImplementation(async () => new Response('{}', { status: 500 }));
      const caught = await call.run(fetchImpl, ticket).catch((error: unknown) => error);
      expect({ name: call.name, entitlement: caught instanceof AutomationEntitlementRequiredError })
        .toEqual({ name: call.name, entitlement: false });
      expect(caught).toBeInstanceOf(Error);
    }
  });

  it('falls back to the status code when a rejection body carries no reason', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('gateway went away', { status: 402 }));
    await expect(claimAutomationEvent({ baseUrl: 'https://example.test', token: 'jwt', worker: credential, fetchImpl }))
      .rejects.toThrow('Automation entitlement required: HTTP_402');
  });
});
