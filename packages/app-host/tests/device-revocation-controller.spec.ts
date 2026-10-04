import { describe, expect, it } from 'vitest';

import {
  HostedDeviceManagementError,
  runHostedDeviceRevocation,
  revokeHostedSyncDeviceBound,
  type HostedSyncAuthSnapshot,
} from '../src/device-management.js';

const auth: HostedSyncAuthSnapshot = {
  accountId: 'account-1',
  baseUrl: 'https://sync.example.test',
  token: 'old-token',
};

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

function sequenceFetch(...responses: Array<Response | Error>): { fetchImpl: typeof fetch; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  let index = 0;
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ?? {});
    const next = responses[index++];
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('bound hosted device revocation', () => {
  it('refuses a confirmation whose account changed before the request', async () => {
    const fetch = sequenceFetch(response(200, { success: true, clientId: 'device-1', requiresKeyRotation: true }));
    let current: HostedSyncAuthSnapshot | undefined = { ...auth };
    current = { ...auth, accountId: 'account-2' };

    await expect(revokeHostedSyncDeviceBound({
      auth,
      clientId: 'device-1',
      readCurrentAuth: () => current,
      fetchImpl: fetch.fetchImpl,
    })).rejects.toMatchObject({ code: 'session-changed' });
    expect(fetch.calls).toHaveLength(0);
  });

  it('uses the confirmed token even if the live reader later changes', async () => {
    let current: HostedSyncAuthSnapshot | undefined = { ...auth };
    const fetch = sequenceFetch(response(200, { success: true, clientId: 'device-1', requiresKeyRotation: true }));
    const originalFetch = fetch.fetchImpl;
    const changingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      current = { ...auth, token: 'new-token' };
      return originalFetch(input, init);
    }) as typeof fetch.fetchImpl;
    const result = await revokeHostedSyncDeviceBound({
      auth,
      clientId: 'device-1',
      readCurrentAuth: () => current,
      fetchImpl: changingFetch,
    });
    expect(result).toMatchObject({ status: 'committed', authStillCurrent: false });
    expect((fetch.calls[0]?.headers as Record<string, string>).authorization).toBe('Bearer old-token');
  });

  it('reports response loss followed by 401 as ambiguous', async () => {
    const fetch = sequenceFetch(new Error('socket closed'), response(401, { error: 'expired' }));
    const result = await revokeHostedSyncDeviceBound({
      auth,
      clientId: 'device-1',
      readCurrentAuth: () => auth,
      fetchImpl: fetch.fetchImpl,
    });
    expect(result).toEqual({ status: 'ambiguous', authStillCurrent: true });
    expect(fetch.calls).toHaveLength(2);
  });

  it('also fences when both the original request and the retry lose the response', async () => {
    const fetch = sequenceFetch(new Error('socket closed'), new Error('offline again'));
    const result = await revokeHostedSyncDeviceBound({
      auth,
      clientId: 'device-1',
      readCurrentAuth: () => auth,
      fetchImpl: fetch.fetchImpl,
    });
    expect(result).toEqual({ status: 'ambiguous', authStillCurrent: true });
    expect(fetch.calls).toHaveLength(2);
  });

  it('runs the local cleanup path for an ambiguous retry failure', async () => {
    const fetch = sequenceFetch(new Error('socket closed'), new Error('offline again'));
    let guidance = 0;
    let cleanup = 0;
    const result = await runHostedDeviceRevocation({
      auth,
      clientId: 'device-1',
      readCurrentAuth: () => auth,
      fetchImpl: fetch.fetchImpl,
      persistRotationGuidance: () => { guidance += 1; },
      clearCurrentSession: () => { cleanup += 1; },
    });
    expect(result).toEqual({ status: 'ambiguous', authStillCurrent: true });
    expect(guidance).toBe(1);
    expect(cleanup).toBe(1);
  });

  it.each([
    ['truncated JSON', undefined],
    ['mismatched device', { success: true, clientId: 'other-device', requiresKeyRotation: true }],
  ])('fences a revoke with an unverifiable success response: %s', async (_label, body) => {
    // The server has already committed before serializing the response. A bad
    // response must not count as success, but cannot prove that no revoke ran.
    const fetch = sequenceFetch(response(200, body), response(401, { error: 'TOKEN_REVOKED' }));
    const events: string[] = [];
    const result = await runHostedDeviceRevocation({
      auth,
      clientId: 'device-1',
      readCurrentAuth: () => auth,
      fetchImpl: fetch.fetchImpl,
      persistRotationGuidance: () => { events.push('guidance'); },
      clearCurrentSession: () => { events.push('cleanup'); },
    });
    expect(result).toEqual({ status: 'ambiguous', authStillCurrent: true });
    expect(events).toEqual(['guidance', 'cleanup']);
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls.every(call =>
      (call.headers as Record<string, string>).authorization === 'Bearer old-token')).toBe(true);
  });

  it('retries a response-loss request once and accepts the idempotent success', async () => {
    const fetch = sequenceFetch(
      new HostedDeviceManagementError('socket closed', 'request-failed'),
      response(200, { success: true, clientId: 'device-1', requiresKeyRotation: true }),
    );
    const result = await revokeHostedSyncDeviceBound({
      auth,
      clientId: 'device-1',
      readCurrentAuth: () => auth,
      fetchImpl: fetch.fetchImpl,
    });
    expect(result).toMatchObject({ status: 'committed', revocation: { clientId: 'device-1' } });
    expect(fetch.calls).toHaveLength(2);
  });

  it('does not clear a newer session while guidance persistence is in flight', async () => {
    const fetch = sequenceFetch(response(200, { success: true, clientId: 'device-1', requiresKeyRotation: true }));
    let current: HostedSyncAuthSnapshot | undefined = auth;
    let cleared = false;
    await runHostedDeviceRevocation({
      auth,
      clientId: 'device-1',
      readCurrentAuth: () => current,
      fetchImpl: fetch.fetchImpl,
      persistRotationGuidance: async () => {
        current = { ...auth, token: 'new-token' };
      },
      clearCurrentSession: () => { cleared = true; },
    });
    expect(cleared).toBe(false);
  });

  it('still fences the bound session when guidance persistence fails', async () => {
    const fetch = sequenceFetch(response(200, { success: true, clientId: 'device-1', requiresKeyRotation: true }));
    let cleared = false;
    await expect(runHostedDeviceRevocation({
      auth,
      clientId: 'device-1',
      readCurrentAuth: () => auth,
      fetchImpl: fetch.fetchImpl,
      persistRotationGuidance: async () => {
        throw new Error('local guidance storage unavailable');
      },
      clearCurrentSession: () => { cleared = true; },
    })).rejects.toThrow('local guidance storage unavailable');
    expect(cleared).toBe(true);
  });
});
