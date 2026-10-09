import { describe, expect, it } from 'vitest';
import { OpType, type Operation } from '@heyta/sync-core';
import { SyncClient, type SyncClientOptions } from '../src/client.js';

const receipt = 'owner-held-test-receipt';
const workerToken = 'a'.repeat(64);
const makeOp = (id: string): Operation<string> => ({ id, clientId: 'a', actionType: 'test',
  entityType: 'TASK', entityId: id.startsWith('inbound:') ? `${id}:0` : id,
  opType: id.startsWith('inbound:') ? OpType.Batch : OpType.Create,
  payload: {}, vectorClock: { a: 1 }, timestamp: 1000, schemaVersion: 1 });
const authorization = { workerToken, databaseEpoch: 'db-a', commitProofs: { 'inbound:event': receipt, 'inbound:unrelated': 'must-not-send' } };
function harness(getAuth: SyncClientOptions['getInboundUploadAuthorization'], rejection?: 'http' | 'op') {
  const requests: Array<{ url: string; init?: RequestInit; body?: any }> = [];
  const uploaded: string[] = []; const discarded: string[] = [];
  const scopeReads: unknown[] = [];
  const client = new SyncClient({ baseUrl: 'https://sync.example.test', clientId: 'a',
    getToken: async () => 'account-token', getPassword: async () => undefined,
    encryptionMode: 'vault', getPayloadCipher: async () => ({
      encrypt: async () => Buffer.alloc(44, 7).toString('base64'), decrypt: async () => '{}',
    }),
    getLastServerSeq: async () => 0, setLastServerSeq: async () => {},
    getLocalOps: async () => [makeOp('inbound:event'), makeOp('manual')],
    markUploaded: async (seqs) => { uploaded.push(...seqs.keys()); },
    markRejected: async (ids) => { discarded.push(...ids); },
    applyRemote: async () => {}, mergeRemoteClock: async () => {}, markHistoryIncomplete: async () => {},
    redispatch: async () => {}, discardLocal: async () => {}, getOpsForEntity: async () => [],
    getOpById: async () => undefined, redispatchPayload: async () => {},
    getInboundUploadAuthorization: async (scope) => { scopeReads.push(scope); return getAuth?.(scope); },
    fetchImpl: (async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url: String(url), init, body });
      if (init?.method !== 'POST') return Response.json({ ops: [], hasMore: false, latestSeq: 0 });
      if (body.ops[0].id.startsWith('inbound:') && rejection === 'http') {
        return Response.json({ errorCode: 'INBOUND_AUTH_REQUIRED' }, { status: 403 });
      }
      return Response.json({ results: body.ops.map((op: { id: string }, index: number) =>
        op.id.startsWith('inbound:') && rejection === 'op'
          ? { opId: op.id, accepted: false, errorCode: 'INBOUND_AUTH_REQUIRED' }
          : { opId: op.id, accepted: true, serverSeq: index + 1 }), latestSeq: 1 });
    }) as typeof fetch,
  });
  return { client, requests, uploaded, discarded, scopeReads };
}
describe('inbound upload credentials remain outside synchronized data', () => {
  it('sends credentials only on its inbound upload and filters unrelated receipts', async () => {
    const h = harness(async () => authorization); await h.client.sync();
    expect(h.uploaded).toEqual(['inbound:event', 'manual']);
    expect(h.scopeReads).toEqual([{ baseUrl: 'https://sync.example.test', clientId: 'a', token: 'account-token', opIds: ['inbound:event'] }]);
    const posts = h.requests.filter((r) => r.init?.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.init!.redirect).toBe('error');
    expect(new Headers(posts[0]!.init!.headers).get('x-heyta-worker-token')).toBe(workerToken);
    expect(posts[0]!.body.inboundCommitProofs).toEqual({ 'inbound:event': receipt });
    expect(JSON.stringify(posts[0]!.body.ops)).not.toContain(receipt);
    for (const request of h.requests.slice(1)) {
      expect(new Headers(request.init?.headers).has('x-heyta-worker-token')).toBe(false);
      expect(JSON.stringify(request.body ?? {})).not.toContain(receipt);
    }
  });
  it.each([undefined, { ...authorization, workerToken: 'malformed' }, { ...authorization, commitProofs: {} }])('missing or invalid journal keeps inbound pending and allows ordinary sync', async (auth) => {
    const h = harness(async () => auth); await h.client.sync();
    expect(h.uploaded).toEqual(['manual']); expect(h.discarded).toEqual([]);
    expect(h.requests.filter((r) => r.init?.method === 'POST')).toHaveLength(1);
    expect(h.requests.some((r) => r.init?.method !== 'POST')).toBe(true);
  });
  it.each(['http', 'op'] as const)('server %s denial never permanently discards a recoverable op', async (rejection) => {
    const h = harness(async () => authorization, rejection); await h.client.sync();
    expect(h.uploaded).toEqual(['manual']); expect(h.discarded).toEqual([]);
    expect(h.requests.some((r) => r.init?.method !== 'POST')).toBe(true);
  });
});
