import { decodeBase64, encodeBase64 } from '@heyta/sync-core';

export interface InboundRecipientRegistration {
  keyEpoch: number;
  /** Canonical unpadded base64url, as required by the registration API. */
  publicKey: string;
  packageVersion: number;
}
export class InboundRecipientRemoteError extends Error {
  constructor(readonly code: 'authentication' | 'conflict' | 'transport' | 'invalid-response') {
    super(`Inbound recipient registration failed: ${code}`);
  }
}
const revision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function registration(value: unknown): InboundRecipientRegistration {
  if (value === null || typeof value !== 'object') throw new InboundRecipientRemoteError('invalid-response');
  const raw = value as Record<string, unknown>;
  if (!revision(raw.keyEpoch) || !revision(raw.packageVersion) || typeof raw.publicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw.publicKey)) {
    throw new InboundRecipientRemoteError('invalid-response');
  }
  const canonical = raw.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '=';
  const bytes = new Uint8Array(decodeBase64(canonical));
  if (bytes.length !== 32 || encodeBase64(bytes) !== canonical) throw new InboundRecipientRemoteError('invalid-response');
  return { keyEpoch: raw.keyEpoch, packageVersion: raw.packageVersion, publicKey: raw.publicKey };
}

/** Public metadata only. A registration is never evidence of private-key recovery. */
export function createInboundRecipientRemote(options: {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
}) {
  const url = new URL('/api/automation/recipient-key', options.baseUrl);
  const request = async (method: 'GET' | 'PUT', body?: unknown): Promise<Response> => {
    const token = await options.getToken();
    if (!token) throw new InboundRecipientRemoteError('authentication');
    let response: Response;
    try {
      response = await (options.fetchImpl ?? globalThis.fetch)(url, {
        method, redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new InboundRecipientRemoteError('transport'); }
    if (response.status === 401 || response.status === 403) throw new InboundRecipientRemoteError('authentication');
    if (response.status === 409) throw new InboundRecipientRemoteError('conflict');
    return response;
  };
  const read = async (response: Response): Promise<InboundRecipientRegistration> => {
    if (!response.ok) throw new InboundRecipientRemoteError('transport');
    try { return registration(await response.json()); }
    catch { throw new InboundRecipientRemoteError('invalid-response'); }
  };
  return {
    serverOrigin: url.origin,
    async get(): Promise<InboundRecipientRegistration | undefined> {
      const response = await request('GET');
      return response.status === 404 ? undefined : read(response);
    },
    async put(value: InboundRecipientRegistration, expectedPackageVersion: number | null): Promise<InboundRecipientRegistration> {
      const checked = registration(value);
      if (expectedPackageVersion !== null && (!revision(expectedPackageVersion) || checked.packageVersion <= expectedPackageVersion)) {
        throw new InboundRecipientRemoteError('conflict');
      }
      const result = await read(await request('PUT', { ...checked, expectedPackageVersion }));
      if (result.keyEpoch !== checked.keyEpoch || result.packageVersion !== checked.packageVersion || result.publicKey !== checked.publicKey) {
        throw new InboundRecipientRemoteError('invalid-response');
      }
      return result;
    },
  };
}
