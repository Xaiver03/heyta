import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_ENTITLEMENT_TICKET_HEADER, generateInboundKeyPair, inboundTaskDigest, sealInbound } from '@heyta/inbound-core';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { OpType, type Operation } from '@heyta/sync-core';
import { processInboundAutomationEvent } from '../src/inbound-process.js';
import { AutomationTicketError, type AutomationTicketRequest } from '../src/inbound-entitlement-tickets.js';

describe('inbound automation process', () => {
  it.each([false, true])('runs claim → AI → encrypted result; confirmation=%s fences permit and op', async (needsConfirmation) => {
    const pair = generateInboundKeyPair();
    const inputEnvelope = await sealInbound(
      new TextEncoder().encode(JSON.stringify({ title: 'From webhook', secret: 'excluded' })),
      pair.publicKey,
      { accountId: 'account', serverOrigin: 'http://127.0.0.1:4321', ruleId: 'rule', eventId: 'event', purpose: 'input', keyEpoch: 1 },
    );
    const worker = { workerId: '11111111-1111-4111-8111-111111111111', workerToken: 'a'.repeat(64), userId: 'account', clientId: 'client', databaseEpoch: 'epoch', serverOrigin: 'http://127.0.0.1:4321' };
    const journal = new Map<string, string>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/automation/events/recover') return Response.json({ state: 'empty' });
      if (url.pathname === '/api/automation/events/claim') {
        return new Response(JSON.stringify({ eventId: 'event', ruleId: 'rule', ruleVersion: 1, contentType: 'application/json',
          targetProjectId: 'project', payloadCiphertext: JSON.stringify(inputEnvelope), receivedAt: 1_700_000_000_000, leaseGeneration: 1, leaseExpiresAt: '2030-01-01T00:00:00.000Z', attempt: 1 }), { status: 200 });
      }
      if (url.pathname.endsWith('/ai-attempt/reserve')) {
        expect(JSON.parse(String(init?.body)).billingSource).toBe('local');
        return new Response(JSON.stringify({ periodAnchor: null, billingSource: 'local', state: 'reserved' }), { status: 200 });
      }
      if (url.pathname.endsWith('/ai-attempt/state')) return new Response(JSON.stringify({ changed: true }), { status: 200 });
      if (url.pathname === '/v1/chat/completions') return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks: [{ title: 'From webhook', priority: 2 }], needsConfirmation }) } }] }), { status: 200 });
      if (url.pathname.endsWith('/result')) return new Response(JSON.stringify({ eventId: 'event', state: needsConfirmation ? 'needs-confirmation' : 'prepared', parseVersion: 1 }), { status: 200 });
      if (url.pathname === '/api/automation/commit-permit') return new Response(JSON.stringify({ eventId: 'event', opId: 'inbound:event', proof: 'opaque-proof' }), { status: 201 });
      void init;
      return new Response('unexpected', { status: 500 });
    });
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA); await db.init();
    const store = new DbOpLogStore<Operation<string>>(db, 0);
    const engine = new OpLogEngine({ store, clientId: 'client', now: () => 1_700_000_000_000 });
    try {
      await engine.dispatch({ entityType: 'PROJECT', entityId: 'project', opType: OpType.Create, payload: { title: 'Target' } });
      const result = await processInboundAutomationEvent({
        baseUrl: 'http://127.0.0.1:4321', token: 'account-token', worker, privateKey: pair.privateKey,
        journal: { load: async (id) => journal.get(id), save: async (id, proof) => { journal.set(id, proof); }, remove: async (id) => { journal.delete(id); } },
        accountId: 'account', keyEpoch: 1, allowedFields: ['title'], routing: {
          enabled: true, allowRemote: false, endpoints: [{ id: 'local', label: 'local', endpoint: 'http://127.0.0.1:4321/v1', model: 'test' }],
          routes: { 'inbound-automation': [{ endpointId: 'local' }] },
        }, consents: [], systemPrompt: 'Return tasks JSON', parseVersion: 1, taskBatch: { dispatchValidated: engine.dispatchValidated.bind(engine) }, fetchImpl: fetchMock,
      });
      expect(result).toEqual({ state: needsConfirmation ? 'needs-confirmation' : 'submitted', eventId: 'event', itemCount: 1 });
      if (!needsConfirmation) expect(engine.getState().tasks['inbound:event:0']).toMatchObject({ title: 'From webhook', priority: 2, projectId: 'project' });
      expect((await store.getAllOps()).filter((row) => row.op.opType === OpType.Batch)).toHaveLength(needsConfirmation ? 0 : 1);
      expect(journal.get('event')).toBe(needsConfirmation ? undefined : 'opaque-proof');
      expect(fetchMock.mock.calls.some(([request]) => new URL(String(request)).pathname === '/api/automation/commit-permit')).toBe(!needsConfirmation);
      expect(fetchMock).toHaveBeenCalled();
    } finally { pair.privateKey.fill(0); db.close(); }
  });

  it.each([
    { explicitEvent: true, corruptTasks: false },
    { explicitEvent: false, corruptTasks: false },
    { explicitEvent: false, corruptTasks: true },
    { explicitEvent: false, corruptTasks: false, invalidateAt: 'recovery' },
    { explicitEvent: false, corruptTasks: false, invalidateAt: 'permit' },
    { explicitEvent: false, corruptTasks: false, invalidateAt: 'dispatch' },
  ])('checks the frozen receipt and live session before recovery: %j', async ({ explicitEvent, corruptTasks, invalidateAt }) => {
    const oldPair = generateInboundKeyPair();
    const currentPair = generateInboundKeyPair();
    const payload = {
      heytaTaskBatch: 1 as const,
      source: { version: 1 as const, eventId: 'event-old', ruleId: 'rule', ruleVersion: 1, parseVersion: 1, digest: 'a'.repeat(64) },
      tasks: [{ id: 'inbound:event-old:0', title: 'Recovered', priority: 0 as const }],
    };
    payload.source.digest = inboundTaskDigest(payload.tasks);
    if (corruptTasks) payload.tasks[0]!.title = 'Changed after digest';
    const resultEnvelope = await sealInbound(new TextEncoder().encode(JSON.stringify(payload)), oldPair.publicKey, {
      accountId: 'account', serverOrigin: 'http://127.0.0.1:4321', ruleId: 'rule', eventId: 'event-old', purpose: 'result', keyEpoch: 1,
    });
    const worker = { workerId: '11111111-1111-4111-8111-111111111111', workerToken: 'a'.repeat(64), userId: 'account', clientId: 'client', databaseEpoch: 'epoch', serverOrigin: 'http://127.0.0.1:4321' };
    const journal = new Map<string, string>();
    let active = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if ((invalidateAt === 'recovery' && url.pathname.endsWith('/recover')) ||
          (invalidateAt === 'permit' && url.pathname.endsWith('/commit-permit'))) active = false;
      if (url.pathname.endsWith('/result') || url.pathname.endsWith('/recover')) return new Response(JSON.stringify({ eventId: 'event-old', ruleId: 'rule', ruleVersion: 1, parseVersion: 1, resultDigest: payload.source.digest, resultItemCount: 1, resultCiphertext: JSON.stringify(resultEnvelope), state: 'prepared' }), { status: 200 });
      if (url.pathname === '/api/automation/commit-permit') return new Response(JSON.stringify({ eventId: 'event-old', opId: 'inbound:event-old', proof: 'opaque-proof' }), { status: 201 });
      return new Response('unexpected', { status: 500 });
    });
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA); await db.init();
    const store = new DbOpLogStore<Operation<string>>(db, 0);
    const engine = new OpLogEngine({ store, clientId: 'client', now: () => 1_700_000_000_000 });
    try {
      const processing = processInboundAutomationEvent({
        baseUrl: 'http://127.0.0.1:4321', token: 'account-token', worker, privateKey: currentPair.privateKey,
        loadPrivateKey: async (epoch) => epoch === 1 ? oldPair.privateKey : undefined,
        journal: { load: async (id) => journal.get(id), save: async (id, proof) => { journal.set(id, proof); }, remove: async (id) => { journal.delete(id); } },
        accountId: 'account', keyEpoch: 2, targetProjectId: 'later-ui-setting', allowedFields: ['title'], routing: { enabled: false, allowRemote: false, endpoints: [], routes: {} },
        consents: [], systemPrompt: 'unused', parseVersion: 1, ...(explicitEvent ? { eventId: 'event-old' } : {}),
        assertActive: () => { if (!active) throw new Error('Session changed'); },
        taskBatch: { dispatchValidated: (intent, validate) => {
          if (invalidateAt === 'dispatch') active = false;
          return engine.dispatchValidated(intent, validate);
        } }, fetchImpl: fetchMock,
      });
      if (invalidateAt !== undefined) {
        await expect(processing).rejects.toThrow('Session changed');
        expect(await store.getAllOps()).toHaveLength(0);
        expect(fetchMock).toHaveBeenCalledTimes(invalidateAt === 'recovery' ? 1 : 2);
        // A receipt saved before local dispatch remains available for recovery.
        expect(journal.size).toBe(invalidateAt === 'dispatch' ? 1 : 0);
        return;
      }
      if (corruptTasks) {
        await expect(processing).rejects.toThrow('does not match its server receipt');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await store.getAllOps()).toHaveLength(0);
        expect(journal.size).toBe(0);
        return;
      }
      const result = await processing;
      expect(result).toEqual({ state: 'submitted', eventId: 'event-old', itemCount: 1 });
      expect(engine.getState().tasks['inbound:event-old:0']).toMatchObject({ title: 'Recovered' });
      expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([explicitEvent ? '/api/automation/events/event-old/result' : '/api/automation/events/recover', '/api/automation/commit-permit']);
    } finally { oldPair.privateKey.fill(0); currentPair.privateKey.fill(0); db.close(); }
  });
});

/**
 * 宿主生命周期这一层只判两件事：闸门动作各取各的一票（票据一次使用），以及权益不足
 * 回 `waiting-entitlement` 而不是把缺陷一起吞掉。业务语义由上面两组用例守着。
 */
describe('inbound automation entitlement lifecycle', () => {
  const harness = async (input: {
    getEntitlementTicket?: (request: AutomationTicketRequest) => Promise<string>;
    claimResponse?: () => Response;
  } = {}) => {
    const pair = generateInboundKeyPair();
    const inputEnvelope = await sealInbound(
      new TextEncoder().encode(JSON.stringify({ title: 'From webhook', secret: 'excluded' })),
      pair.publicKey,
      { accountId: 'account', serverOrigin: 'http://127.0.0.1:4321', ruleId: 'rule', eventId: 'event', purpose: 'input', keyEpoch: 1 },
    );
    const worker = { workerId: '11111111-1111-4111-8111-111111111111', workerToken: 'a'.repeat(64), userId: 'account', clientId: 'client', databaseEpoch: 'epoch', serverOrigin: 'http://127.0.0.1:4321' };
    const requests: { readonly pathname: string; readonly ticket: string | undefined }[] = [];
    const fetchMock = vi.fn(async (resource: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(resource));
      requests.push({ pathname: url.pathname, ticket: (init?.headers as Record<string, string> | undefined)?.[AUTOMATION_ENTITLEMENT_TICKET_HEADER] });
      if (url.pathname === '/api/automation/events/recover') return Response.json({ state: 'empty' });
      if (url.pathname === '/api/automation/events/claim') return input.claimResponse?.() ?? Response.json({
        eventId: 'event', ruleId: 'rule', ruleVersion: 1, contentType: 'application/json', targetProjectId: 'project',
        payloadCiphertext: JSON.stringify(inputEnvelope), receivedAt: 1_700_000_000_000, leaseGeneration: 1,
        leaseExpiresAt: '2030-01-01T00:00:00.000Z', attempt: 1,
      });
      if (url.pathname.endsWith('/ai-attempt/reserve')) return Response.json({ periodAnchor: null, billingSource: 'local', state: 'reserved' });
      if (url.pathname.endsWith('/ai-attempt/state')) return Response.json({ changed: true });
      if (url.pathname === '/v1/chat/completions') return Response.json({ choices: [{ message: { content: JSON.stringify({ tasks: [{ title: 'From webhook', priority: 2 }] }) } }] });
      if (url.pathname.endsWith('/result')) return Response.json({ eventId: 'event', state: 'prepared', parseVersion: 1 });
      if (url.pathname === '/api/automation/commit-permit') return Response.json({ eventId: 'event', opId: 'inbound:event', proof: 'opaque-proof' });
      return Response.json({ unexpected: true }, { status: 500 });
    });
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA); await db.init();
    const store = new DbOpLogStore<Operation<string>>(db, 0);
    const engine = new OpLogEngine({ store, clientId: 'client', now: () => 1_700_000_000_000 });
    const journal = new Map<string, string>();
    let state: string | undefined;
    let error: unknown;
    try {
      await engine.dispatch({ entityType: 'PROJECT', entityId: 'project', opType: OpType.Create, payload: { title: 'Target' } });
      const result = await processInboundAutomationEvent({
        baseUrl: 'http://127.0.0.1:4321', token: 'account-token', worker, privateKey: pair.privateKey,
        journal: { load: async (id) => journal.get(id), save: async (id, proof) => { journal.set(id, proof); }, remove: async (id) => { journal.delete(id); } },
        accountId: 'account', keyEpoch: 1, allowedFields: ['title'], routing: {
          enabled: true, allowRemote: false, endpoints: [{ id: 'local', label: 'local', endpoint: 'http://127.0.0.1:4321/v1', model: 'test' }],
          routes: { 'inbound-automation': [{ endpointId: 'local' }] },
        }, consents: [], systemPrompt: 'Return tasks JSON', parseVersion: 1,
        taskBatch: { dispatchValidated: engine.dispatchValidated.bind(engine) }, fetchImpl: fetchMock,
        ...(input.getEntitlementTicket === undefined ? {} : { getEntitlementTicket: input.getEntitlementTicket }),
      });
      state = result.state;
    } catch (caught) {
      error = caught;
    }
    const ops = await store.getAllOps();
    const batchOps = ops.filter((row) => row.op.opType === OpType.Batch).length;
    pair.privateKey.fill(0); db.close();
    return { state, error, requests, batchOps, proof: journal.get('event') };
  };

  it('takes one ticket per gated action and reuses none of them', async () => {
    const taken: AutomationTicketRequest[] = [];
    const run = await harness({ getEntitlementTicket: async (request) => { taken.push(request); return `t${taken.length}`; } });
    expect(taken).toEqual([
      { action: 'event-claim' },
      { action: 'ai-reserve', eventId: 'event' },
      { action: 'result-publish', eventId: 'event' },
      { action: 'commit-permit', eventId: 'event' },
    ]);
    const gated = run.requests.filter((entry) => entry.pathname !== '/v1/chat/completions')
      .map((entry) => ({ path: entry.pathname
        .replace('/api/automation/events/recover', 'recover')
        .replace('/api/automation/events/claim', 'claim')
        .replace('/api/automation/commit-permit', 'commit-permit')
        .replace('/api/automation/events/event/', 'event:'),
      ticket: entry.ticket ?? null }));
    // 整条请求台账：票据只出现在四个闸门动作上，且四枚各用一次；
    // 续租与尝试状态转换不带票，恢复读取也不带票。
    expect(gated).toEqual([
      { path: 'recover', ticket: null },
      { path: 'claim', ticket: 't1' },
      { path: 'event:ai-attempt/reserve', ticket: 't2' },
      { path: 'event:ai-attempt/state', ticket: null },
      { path: 'event:ai-attempt/state', ticket: null },
      { path: 'event:result', ticket: 't3' },
      { path: 'commit-permit', ticket: 't4' },
    ]);
    expect({ state: run.state, error: run.error, batchOps: run.batchOps, proof: run.proof })
      .toEqual({ state: 'submitted', error: undefined, batchOps: 1, proof: 'opaque-proof' });
  });

  it('sends no ticket anywhere when the host has no issuer, which is the official mode', async () => {
    const run = await harness();
    expect(run.requests.every((entry) => entry.ticket === undefined)).toBe(true);
    expect({ state: run.state, batchOps: run.batchOps }).toEqual({ state: 'submitted', batchOps: 1 });
  });

  it('reports a waiting ticket denial as a state, not an error, and writes nothing', async () => {
    const run = await harness({ getEntitlementTicket: async () => { throw new AutomationTicketError('AUTOMATION_LINK_NOT_BOUND', true); } });
    expect({ state: run.state, error: run.error, batchOps: run.batchOps, proof: run.proof })
      .toEqual({ state: 'waiting-entitlement', error: undefined, batchOps: 0, proof: undefined });
    expect(run.requests.map((entry) => entry.pathname)).toEqual(['/api/automation/events/recover']);
  });

  it('reports a server-side 402 as the same state, without any local write', async () => {
    const run = await harness({ claimResponse: () => new Response(JSON.stringify({
      error: 'Subscription required', errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'entitlement-lapsed',
    }), { status: 402 }) });
    expect({ state: run.state, error: run.error, batchOps: run.batchOps }).toEqual({ state: 'waiting-entitlement', error: undefined, batchOps: 0 });
  });

  it('still throws a ticket that is broken rather than missing, so a defect is not reported as a subscription problem', async () => {
    const run = await harness({ getEntitlementTicket: async () => { throw new AutomationTicketError('AUTOMATION_SUBJECT_MISMATCH', false); } });
    expect(run.error).toBeInstanceOf(AutomationTicketError);
    expect({ state: run.state, code: (run.error as AutomationTicketError).code, batchOps: run.batchOps })
      .toEqual({ state: undefined, code: 'AUTOMATION_SUBJECT_MISMATCH', batchOps: 0 });
  });

  it('does not retry the cycle after a denial, so a lapsed entitlement cannot loop the worker', async () => {
    let ticketCalls = 0;
    const run = await harness({ getEntitlementTicket: async () => { ticketCalls += 1; throw new AutomationTicketError('AUTOMATION_ISSUER_NOT_CONFIGURED', true); } });
    expect({ state: run.state, ticketCalls }).toEqual({ state: 'waiting-entitlement', ticketCalls: 1 });
  });
});
