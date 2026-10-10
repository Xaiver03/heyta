import { describe, expect, it, vi } from 'vitest';
import {
  AutomationTicketError, createAutomationTicketSource, loadOrCreateAutomationInstallationId, newAutomationInstallationId,
  type AutomationInstallationStore, type AutomationTicketRequest,
} from '../src/inbound-entitlement-tickets';

const installation = '33333333-3333-4333-8333-333333333333';
const rule = '44444444-4444-4444-8444-444444444444';
const event = 'evt-1';

/** 固定时刻：票据寿命是唯一能被响应体拉长的东西，判它必须有一个不动的"现在"。 */
const NOW = Date.parse('2026-10-09T00:00:00.000Z');
const inMs = (ms: number): string => new Date(NOW + ms).toISOString();

const source = (fetchImpl: typeof fetch): ((request: AutomationTicketRequest) => Promise<string>) =>
  createAutomationTicketSource({ baseUrl: 'https://example.test', token: 'jwt', installationId: installation, fetchImpl, now: () => NOW });

describe('automation action ticket source', () => {
  it('asks for exactly one action and returns only the ticket', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ticket: 'a.b', action: 'event-claim', expiresAt: inMs(30_000) }));
    await expect(source(fetchImpl)({ action: 'event-claim' })).resolves.toBe('a.b');
    expect(fetchImpl).toHaveBeenCalledWith(new URL('/api/automation/entitlement/ticket', 'https://example.test'),
      expect.objectContaining({ method: 'POST', redirect: 'error' }));
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer jwt' });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1].body))).toEqual({ installationId: installation, action: 'event-claim' });
  });

  it('carries the scope the action requires and nothing else', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ticket: 'a.b', action: 'ai-reserve', expiresAt: inMs(30_000) }));
    await expect(source(fetchImpl)({ action: 'ai-reserve', eventId: event })).resolves.toBe('a.b');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1].body))).toEqual({ installationId: installation, action: 'ai-reserve', eventId: event });
  });

  it('refuses locally what the issuer could never sign, without a round trip', async () => {
    const fetchImpl = vi.fn();
    const get = source(fetchImpl);
    // `session` 只能由绑定握手那一条路拿到；把它当逐次动作来取票就等于一次登录换一张通用通行证。
    await expect(get({ action: 'session' } as unknown as AutomationTicketRequest)).rejects.toThrow('UNKNOWN_ACTION');
    // 三格分开报：缺该带的、和多了不该带的，是两种缺陷，宿主排障时不该混成一句。
    await expect(get({ action: 'rule-enable' })).rejects.toThrow('RULE_SCOPE_MISSING');
    await expect(get({ action: 'commit-permit', ruleId: rule })).rejects.toThrow('EVENT_SCOPE_MISSING');
    await expect(get({ action: 'worker-register', ruleId: rule })).rejects.toThrow('SCOPE_NOT_ALLOWED');
    await expect(get({ action: 'event-claim', eventId: 'bad id with spaces' })).rejects.toThrow('INVALID_EVENT_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an installation that is not a UUID before any request', async () => {
    const fetchImpl = vi.fn();
    expect(() => createAutomationTicketSource({ baseUrl: 'https://example.test', token: 'jwt', installationId: 'not-a-uuid', fetchImpl }))
      .toThrow('INVALID_INSTALLATION_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a ticket for another action as no ticket at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ticket: 'a.b', action: 'draft-confirm', expiresAt: inMs(30_000) }));
    await expect(source(fetchImpl)({ action: 'event-claim' })).rejects.toThrow('MALFORMED_TICKET_RESPONSE');
  });

  it('will not accept a lifetime longer than the contract allows', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ticket: 'a.b', action: 'event-claim', expiresAt: inMs(30_001) }));
    await expect(source(fetchImpl)({ action: 'event-claim' })).rejects.toThrow('TICKET_LIFETIME_OUT_OF_BOUNDS');
    fetchImpl.mockResolvedValue(Response.json({ ticket: 'a.b', action: 'event-claim', expiresAt: inMs(0) }));
    await expect(source(fetchImpl)({ action: 'event-claim' })).rejects.toThrow('TICKET_LIFETIME_OUT_OF_BOUNDS');
  });

  it('separates "this instance has no entitlement yet" from "the request is wrong"', async () => {
    const fetchImpl = vi.fn();
    const get = source(fetchImpl);
    for (const code of ['AUTOMATION_LINK_NOT_BOUND', 'AUTOMATION_ISSUER_NOT_CONFIGURED', 'AUTOMATION_ISSUER_NOT_ON_THIS_INSTANCE']) {
      fetchImpl.mockResolvedValue(Response.json({ code, message: code }, { status: 403 }));
      const error = await get({ action: 'event-claim' }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AutomationTicketError);
      expect((error as AutomationTicketError).waiting).toBe(true);
      expect((error as AutomationTicketError).code).toBe(code);
    }
    fetchImpl.mockResolvedValue(Response.json({ code: 'AUTOMATION_SUBJECT_MISMATCH', message: 'x' }, { status: 403 }));
    const defect = await get({ action: 'event-claim' }).catch((caught: unknown) => caught);
    expect((defect as AutomationTicketError).waiting).toBe(false);
    fetchImpl.mockResolvedValue(new Response('not json', { status: 503 }));
    expect((await get({ action: 'event-claim' }).catch((caught: unknown) => caught) as AutomationTicketError).code).toBe('HTTP_503');
  });

  it('never puts the ticket body into the rejection message', async () => {
    const secret = `${'a'.repeat(40)}.${'b'.repeat(88)}`;
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ticket: secret, action: 'draft-confirm', expiresAt: inMs(30_000) }));
    const error = await source(fetchImpl)({ action: 'event-claim' }).catch((caught: unknown) => caught);
    expect(String((error as Error).message)).not.toContain(secret);
    expect(JSON.stringify((error as Error).message)).not.toContain(secret.slice(0, 12));
  });

  it('accepts only a non-empty ticket', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ticket: '', action: 'event-claim', expiresAt: inMs(30_000) }));
    await expect(source(fetchImpl)({ action: 'event-claim' })).rejects.toThrow('MALFORMED_TICKET_RESPONSE');
  });

  it('reads the bearer token at call time so a rotated session is not sent stale', async () => {
    let token = 'old';
    // 每次调用给一份新响应：`mockResolvedValue(Response.json(…))` 把同一个已读过的 body
    // 交给第二次调用，症状是"被测代码坏了"，其实是夹具只够喂一次。
    const fetchImpl = vi.fn().mockImplementation(async () => Response.json({ ticket: 'a.b', action: 'event-claim', expiresAt: inMs(30_000) }));
    const get = createAutomationTicketSource({ baseUrl: 'https://example.test', token: () => token, installationId: installation, fetchImpl, now: () => NOW });
    await get({ action: 'event-claim' });
    token = 'new';
    await get({ action: 'event-claim' });
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer old' });
    expect((fetchImpl.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer new' });
  });
});

describe('installation identity', () => {
  it('generates a v4 UUID through the platform random source', () => {
    const value = newAutomationInstallationId();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newAutomationInstallationId()).not.toBe(value);
  });

  it('reuses a stored id and only writes when there is none', async () => {
    const store: AutomationInstallationStore = { load: vi.fn().mockResolvedValue(installation), save: vi.fn() };
    await expect(loadOrCreateAutomationInstallationId(store)).resolves.toBe(installation);
    expect(store.save).not.toHaveBeenCalled();

    const fresh: AutomationInstallationStore = { load: vi.fn().mockResolvedValue(undefined), save: vi.fn() };
    const created = await loadOrCreateAutomationInstallationId(fresh);
    expect(fresh.save).toHaveBeenCalledWith(created);
  });

  it('refuses to run on a stored id it cannot send', async () => {
    const store: AutomationInstallationStore = { load: vi.fn().mockResolvedValue('previous-corruption'), save: vi.fn() };
    await expect(loadOrCreateAutomationInstallationId(store)).rejects.toThrow('STORED_INSTALLATION_ID_INVALID');
    expect(store.save).not.toHaveBeenCalled();
  });
});
