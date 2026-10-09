import { describe, expect, it, vi } from 'vitest';
import { generateInboundKeyPair, inboundTaskDigest, sealInbound } from '@heyta/inbound-core';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { OpType, type Operation } from '@heyta/sync-core';
import { processInboundAutomationEvent } from '../src/inbound-process.js';

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
