import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
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

/**
 * `inbound-worker.ts` 里所有会打到自动化 API 的导出调用。分母由下面那条自检从真源算，
 * 不是抄这张表时想到的条数 —— 漏一笔，那一笔的 402/请求头就没人量。
 */
const gatedCalls: readonly {
  readonly name: string;
  /** 真身：`inbound-worker.ts` 导出的那笔 HTTP 调用。分母自检按这个字段对账。 */
  readonly fn: string;
  readonly run: (fetchImpl: typeof fetch, entitlementTicket?: string) => Promise<unknown>;
  readonly accepted: () => Response;
  /** 这一笔服务端收票据（协议 §4 的六个受票据动作之一）。其余几笔只是同一条闸门的邻居。 */
  readonly takesTicket?: boolean;
  /** 这一笔带请求体 ⇒ `content-type: application/json` 是它的承重头（GET 那笔没有体）。 */
  readonly carriesBody?: boolean;
}[] = [
  {
    name: 'worker-register', fn: 'registerAutomationWorker',
    run: (fetchImpl, entitlementTicket) => registerAutomationWorker({
      baseUrl: 'https://example.test', token: 'jwt', userId: 'u', clientId: 'client', databaseEpoch: 'epoch',
      secrets: { load: vi.fn(), save: vi.fn(), clear: vi.fn() },
      ...(entitlementTicket === undefined ? {} : { entitlementTicket }), fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ workerId: credential.workerId, workerToken: credential.workerToken,
      syncClientId: credential.clientId, databaseEpoch: credential.databaseEpoch }), { status: 201 }),
  },
  {
    name: 'commit-permit', fn: 'requestCommitPermitAndJournal',
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
    name: 'event-claim', fn: 'claimAutomationEvent',
    run: (fetchImpl, entitlementTicket) => claimAutomationEvent({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential,
      ...(entitlementTicket === undefined ? {} : { entitlementTicket }), fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ state: 'empty' }), { status: 200 }),
  },
  {
    name: 'ai-reserve', fn: 'reserveAutomationAiAttempt',
    run: (fetchImpl, entitlementTicket) => reserveAutomationAiAttempt({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential, eventId: 'event', ruleId: credential.workerId,
      parseVersion: 1, attempt: 1, leaseGeneration: 1, billingSource: 'local',
      ...(entitlementTicket === undefined ? {} : { entitlementTicket }), fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ periodAnchor: null, billingSource: 'local', state: 'reserved' }), { status: 200 }),
  },
  {
    name: 'result-publish', fn: 'publishAutomationResult',
    run: (fetchImpl, entitlementTicket) => publishAutomationResult({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential, eventId: 'event', leaseGeneration: 1,
      parseVersion: 1, itemCount: 1, resultDigest: 'b'.repeat(64), resultCiphertext: '{}',
      ...(entitlementTicket === undefined ? {} : { entitlementTicket }), fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ eventId: 'event', state: 'prepared', parseVersion: 1 }), { status: 200 }),
  },
  // ↓ 这三笔以前不在表里，而 402 的读法恰好漏了其中两笔（`renew` 与 `state`）。
  // 分母不能是"我抄的时候想到的那几笔"：它是 `inbound-worker.ts` 里所有会打到自动化 API 的导出调用。
  // 路由表在 `server/src/api.ts`：`/renew` 与 `/ai-attempt/state` 的 preHandler 都挂着
  // `createEntitlementGuard({ capability: 'automation' })` ⇒ 它们**会**回 402，
  // 而把 402 读成"传输失败"就是把"等权益"报成"出错了"（服务端那边同一条纪律写在 reserve 那格的注释里）。
  {
    name: 'lease-renew', fn: 'renewAutomationLease',
    takesTicket: false,
    run: (fetchImpl) => renewAutomationLease({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential, eventId: 'event', leaseGeneration: 1, fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ eventId: 'event', ruleId: credential.workerId, ruleVersion: 1,
      receivedAt: 1, contentType: 'application/json', payloadCiphertext: '{}', leaseGeneration: 1,
      leaseExpiresAt: '2026-01-01T00:00:00.000Z', attempt: 1 }), { status: 200 }),
  },
  {
    name: 'ai-attempt-state', fn: 'advanceAutomationAiAttempt',
    takesTicket: false,
    run: (fetchImpl) => advanceAutomationAiAttempt({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential, eventId: 'event', ruleId: credential.workerId,
      parseVersion: 1, attempt: 1, leaseGeneration: 1, from: 'reserved', to: 'sent', fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ changed: true }), { status: 200 }),
  },
  {
    // 这一笔的路由（`/events/recover`）**故意**不带权益闸门：已经拿到许可的本地意图要能在订阅到期后补传。
    // 它进表是为了钉住"分母是全的"，以及"万一以后有人给这条路由加闸门，402 也不会被读成传输失败"。
    name: 'result-recover', fn: 'readAutomationPreparedResult',
    takesTicket: false,
    carriesBody: false,
    run: (fetchImpl) => readAutomationPreparedResult({
      baseUrl: 'https://example.test', token: 'jwt', worker: credential, eventId: 'event', fetchImpl,
    }),
    accepted: () => new Response(JSON.stringify({ eventId: 'event', ruleId: credential.workerId, ruleVersion: 1,
      parseVersion: 1, resultDigest: 'a'.repeat(64), resultItemCount: 1, resultCiphertext: '{}',
      state: 'prepared' }), { status: 200 }),
  },
];

describe('per-action entitlement ticket on the worker transport', () => {
  // 票据是六个受票据动作的事；402 的读法和请求头是**全部**八笔 HTTP 调用的事。两档分母不同，
  // 各取各的：把 402 那一档写成"只有带票据的那几笔"就会漏掉 renew/state —— 这一版正是那么漏的。
  const ticketCalls = gatedCalls.filter((call) => call.takesTicket !== false);
  const bodyCalls = gatedCalls.filter((call) => call.carriesBody !== false);

  it('表的分母等于传输层真源里所有会打到自动化 API 的导出函数（漏一笔就红）', async () => {
    const source = await readFile(new URL('../src/inbound-worker.ts', import.meta.url), 'utf8');
    const exported = [...source.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]!);
    // 分母只数**真的发 HTTP** 的那些：函数体里没有 `globalThis.fetch` 的是本地动作（写 journal），不算一笔调用。
    const httpCalls = exported.filter((name) => {
      const start = source.indexOf(`export async function ${name}(`);
      const next = source.indexOf('\nexport ', start + 1);
      return source.slice(start, next === -1 ? source.length : next).includes('globalThis.fetch');
    });
    expect(gatedCalls.map((call) => call.fn).sort()).toEqual(httpCalls.sort());
  });

  it('carries each gated call its own ticket in the header and never in the body', async () => {
    for (const call of ticketCalls) {
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

  it('declares application/json on every call that carries a body', async () => {
    // 服务端那些路由用 zod `.strict()` 校请求体，而 Fastify 只在 `content-type: application/json`
    // 时把正文解析成对象 —— 少了这个头，请求体到一个**字符串**手里，校验必然 400。
    // 提交许可那一笔以前就漏了这个头：宿主拿到的永远是"Authorization failed"，
    // 而单测里没人看过这一行头（判据只验票据与状态码）。这条按表逐笔量，漏一笔的那一条红。
    for (const call of bodyCalls) {
      const fetchImpl = vi.fn().mockImplementation(async () => call.accepted());
      await call.run(fetchImpl, ticket);
      const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
      const headers = ticketHeader(init);
      expect({ name: call.name, hasBody: init.body !== undefined,
        contentType: headers['content-type'] ?? null })
        .toEqual({ name: call.name, hasBody: true, contentType: 'application/json' });
    }
  });

  it('reports a 402 as a missing entitlement, not as a transport failure', async () => {
    // 逐笔收集再整表比对，不在循环里断言：八笔里断第一笔就退出，
    // 剩下那几笔"这行有没有人守"就永远读不出来 —— 变异测试要靠名字定位到那一笔。
    const readings: Record<string, string> = {};
    for (const call of gatedCalls) {
      const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
        error: 'Subscription required', errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'entitlement-lapsed',
      }), { status: 402 }));
      const caught = await call.run(fetchImpl, ticket).catch((error: unknown) => error);
      readings[call.name] = caught instanceof AutomationEntitlementRequiredError
        ? (caught.reason === 'entitlement-lapsed' && !(caught as Error).message.includes(ticket) ? 'entitlement' : 'leaky')
        : 'transport';
    }
    expect(readings).toEqual(Object.fromEntries(gatedCalls.map((call) => [call.name, 'entitlement'])));
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
