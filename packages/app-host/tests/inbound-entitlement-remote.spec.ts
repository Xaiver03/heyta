import { describe, expect, it, vi } from 'vitest';
import { verifyAutomationEntitlementTicket } from '../src/inbound-entitlement-remote.js';

const account = '22222222-2222-4222-8222-222222222222';

describe('automation entitlement transport', () => {
  it('sends a bearer ticket and accepts only an active expiry', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: 'active', expiresAt: '2026-10-09T00:00:30.000Z' }), { status: 200 }));
    const status = await verifyAutomationEntitlementTicket({ baseUrl: 'https://example.test', token: 'jwt', ticket: 'opaque-ticket', localAccountUuid: account, fetchImpl: fetch });
    expect(status.state).toBe('active');
    expect(fetch).toHaveBeenCalledWith(new URL('/api/automation/entitlement/verify', 'https://example.test'), expect.objectContaining({
      method: 'POST', redirect: 'error', headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
    }));
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({ ticket: 'opaque-ticket', localAccountUuid: account });
  });

  it('rejects malformed UUID, error responses and malformed expiry', async () => {
    const fetch = vi.fn();
    await expect(verifyAutomationEntitlementTicket({ baseUrl: 'https://example.test', token: 'jwt', ticket: 'x', localAccountUuid: 'bad', fetchImpl: fetch })).rejects.toThrow('Invalid local account UUID');
    fetch.mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(verifyAutomationEntitlementTicket({ baseUrl: 'https://example.test', token: 'jwt', ticket: 'x', localAccountUuid: account, fetchImpl: fetch })).rejects.toThrow('verification failed');
    fetch.mockResolvedValue(new Response(JSON.stringify({ state: 'active', expiresAt: 'bad' }), { status: 200 }));
    await expect(verifyAutomationEntitlementTicket({ baseUrl: 'https://example.test', token: 'jwt', ticket: 'x', localAccountUuid: account, fetchImpl: fetch })).rejects.toThrow('Invalid automation entitlement response');
  });
});
