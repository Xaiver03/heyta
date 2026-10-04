import { describe, expect, it } from 'vitest';

import {
  HOSTED_SYNC_DEVICES_PATH,
  HostedDeviceManagementError,
  listHostedSyncDevices,
  revokeHostedSyncDevice,
  type HostedDeviceManagementOptions,
} from '../src/device-management.js';

type Call = { url: string; init: RequestInit | undefined };

function recordingFetch(response: {
  status: number;
  body?: unknown;
  jsonThrows?: boolean;
}): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve({
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json: response.jsonThrows === true
        ? () => Promise.reject(new Error('not json'))
        : () => Promise.resolve(response.body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const options = (fetchImpl: typeof fetch): HostedDeviceManagementOptions => ({
  baseUrl: 'https://sync.example.test/',
  getToken: () => Promise.resolve('token-123'),
  fetchImpl,
});

describe('hosted sync device management', () => {
  it('lists devices through the authenticated GET contract', async () => {
    const { impl, calls } = recordingFetch({
      status: 200,
      body: { devices: [{ clientId: 'A-device_1', lastSeenAt: 123 }] },
    });

    await expect(listHostedSyncDevices(options(impl))).resolves.toEqual([
      { clientId: 'A-device_1', lastSeenAt: 123 },
    ]);
    expect(calls[0]?.url).toBe(`https://sync.example.test${HOSTED_SYNC_DEVICES_PATH}`);
    expect(calls[0]?.init?.method).toBe('GET');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer token-123');
  });

  it('revokes the requested device and requires root-key rotation', async () => {
    const { impl, calls } = recordingFetch({
      status: 200,
      body: { success: true, clientId: 'E-device_2', requiresKeyRotation: true },
    });

    await expect(revokeHostedSyncDevice(options(impl), 'E-device_2')).resolves.toEqual({
      clientId: 'E-device_2',
      requiresKeyRotation: true,
    });
    expect(calls[0]?.url).toBe(`https://sync.example.test${HOSTED_SYNC_DEVICES_PATH}/E-device_2`);
    expect(calls[0]?.init?.method).toBe('DELETE');
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it('rejects malformed or mismatched responses', async () => {
    const malformed = recordingFetch({ status: 200, body: { devices: [{ clientId: 'bad id', lastSeenAt: 1 }] } });
    await expect(listHostedSyncDevices(options(malformed.impl))).rejects.toMatchObject({
      code: 'invalid-response',
    });

    const mismatched = recordingFetch({
      status: 200,
      body: { success: true, clientId: 'other', requiresKeyRotation: true },
    });
    await expect(revokeHostedSyncDevice(options(mismatched.impl), 'A-device_1')).rejects.toMatchObject({
      code: 'invalid-response',
    });
  });

  it('maps auth, malformed JSON, and network failures to typed errors', async () => {
    const unauthorized = recordingFetch({ status: 401, body: { error: 'expired' } });
    await expect(listHostedSyncDevices(options(unauthorized.impl))).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    });

    const malformed = recordingFetch({ status: 200, jsonThrows: true });
    await expect(listHostedSyncDevices(options(malformed.impl))).rejects.toBeInstanceOf(HostedDeviceManagementError);
    await expect(listHostedSyncDevices(options(malformed.impl))).rejects.toMatchObject({ code: 'invalid-response' });

    const network = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    await expect(listHostedSyncDevices(options(network))).rejects.toMatchObject({ code: 'request-failed' });
  });

  it('does not send invalid client ids', async () => {
    const { impl, calls } = recordingFetch({ status: 200, body: {} });
    await expect(revokeHostedSyncDevice(options(impl), 'bad/id')).rejects.toMatchObject({
      code: 'invalid-client-id',
    });
    expect(calls).toHaveLength(0);
  });
});
