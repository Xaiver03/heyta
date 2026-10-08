import { describe, expect, it, vi } from 'vitest';
import { generateInboundKeyPair } from '@heyta/inbound-core';
import { createInboundRecipientRemote } from '../src/inbound-recipient-remote.js';

const pair = generateInboundKeyPair();
pair.privateKey.fill(0);
const registered = { keyEpoch: 1, packageVersion: 1, publicKey: pair.publicKey.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('recipient registration transport', () => {
  it('authenticates GET/PUT and preserves the exact CAS fence', async () => {
    const fetch = vi.fn().mockImplementationOnce(async () => json({}, 404)).mockImplementation(async () => json(registered));
    const remote = createInboundRecipientRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    expect(await remote.get()).toBeUndefined();
    expect(await remote.put(registered, null)).toEqual(registered);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', redirect: 'error', headers: { authorization: 'Bearer token' } });
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual({ ...registered, expectedPackageVersion: null });
    expect(await remote.get()).toEqual(registered);
  });
  it('does not overwrite another device after a CAS conflict', async () => {
    const fetch = vi.fn().mockResolvedValue(json({}, 409));
    const remote = createInboundRecipientRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    await expect(remote.put(registered, null)).rejects.toMatchObject({ code: 'conflict' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('fails closed on missing authentication, invalid metadata and mismatched publication', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...registered, keyEpoch: 2 }));
    const remote = createInboundRecipientRemote({ baseUrl: 'https://example.test', getToken: async () => undefined, fetchImpl: fetch });
    await expect(remote.get()).rejects.toMatchObject({ code: 'authentication' });
    expect(fetch).not.toHaveBeenCalled();
    const auth = createInboundRecipientRemote({ baseUrl: 'https://example.test', getToken: async () => 'token', fetchImpl: fetch });
    await expect(auth.put(registered, null)).rejects.toMatchObject({ code: 'invalid-response' });
    fetch.mockResolvedValue(json({ ...registered, publicKey: 'A'.repeat(42) + 'B' }));
    await expect(auth.get()).rejects.toMatchObject({ code: 'invalid-response' });
  });
});
