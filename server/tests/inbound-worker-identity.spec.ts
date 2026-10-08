import { describe, expect, it } from 'vitest';
import { generateWorkerCredential, readInboundUploadIdentity, authorizeInboundOperations } from '../src/automation/worker-identity';

describe('inbound credential parsing', () => {
  const credential = generateWorkerCredential();
  const headers = ['X-Heyta-Worker-Token', credential.token, 'X-Heyta-Database-Epoch', 'db-1'];
  it('generates independent high-entropy credentials and hashes only the credential', () => {
    expect(credential.token).toMatch(/^[0-9a-f]{64}$/);
    expect(credential.credentialHash).not.toBe(credential.token);
    expect(generateWorkerCredential().token).not.toBe(credential.token);
    expect(readInboundUploadIdentity(headers, 4)).toEqual({ credentialHash: credential.credentialHash, databaseEpoch: 'db-1', tokenVersion: 4 });
  });
  it('rejects duplicate protected headers including case aliases', () => {
    expect(readInboundUploadIdentity([...headers, 'x-heyta-worker-token', credential.token], 0)).toBeUndefined();
    expect(readInboundUploadIdentity([...headers, 'X-HEYTA-DATABASE-EPOCH', 'db-1'], 0)).toBeUndefined();
  });
  it('rejects missing JWT version, noncanonical token and unbounded epoch', () => {
    expect(readInboundUploadIdentity(headers, undefined)).toBeUndefined();
    expect(readInboundUploadIdentity(headers, -1)).toBeUndefined();
    expect(readInboundUploadIdentity([headers[0], credential.token.toUpperCase(), headers[2], 'db-1'], 0)).toBeUndefined();
    expect(readInboundUploadIdentity([headers[0], credential.token, headers[2], 'x'.repeat(129)], 0)).toBeUndefined();
  });
  it('ordinary operations do not query automation tables', async () => {
    const db = { $queryRaw: () => { throw new Error('must not query'); } };
    expect(await authorizeInboundOperations(db as never, 1, 'a', [{ id: 'ordinary' }] as never, undefined)).toBe(true);
    expect(await authorizeInboundOperations(db as never, 1, 'a', [{ id: 'inbound:event' }] as never, undefined)).toBe(false);
  });
});
