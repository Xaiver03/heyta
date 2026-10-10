import { expect, it, vi } from 'vitest';
import { IndexedDbAdapter } from '@heyta/storage';
import { createInboundCommitJournal, createVaultWrappedAutomationWorkerStore } from '@heyta/app-host';
const vault = vi.hoisted(() => ({ root: new Uint8Array(32).fill(9), unlocked: true }));
vi.mock('../src/lib/vault-session.js', () => ({
  getWebVaultSession: async () => ({ state: vault.unlocked ? 'unlocked' : 'locked', copyUnlockedRootKey: () => vault.root.slice() }),
}));
vi.mock('../src/lib/oplog.js', () => ({ requireEngine: vi.fn() }));
import { getWebInboundUploadAuthorization } from '../src/features/settings/inbound-runtime.js';

it('loads the persisted worker and receipt for normal sync and refuses a locked or wrong account', async () => {
  const db = new IndexedDbAdapter('heyta-inbound');
  await db.init();
  const secrets = createVaultWrappedAutomationWorkerStore(db, async () => vault.root.slice());
  const credential = { userId: 'account', clientId: 'client', workerId: 'worker', workerToken: 'a'.repeat(64), databaseEpoch: 'epoch', serverOrigin: 'https://sync.example.test' };
  try {
    await secrets.save(credential);
    await createInboundCommitJournal(db).save('event', 'owner-proof');
    const input = { baseUrl: credential.serverOrigin, clientId: credential.clientId, token: 'token', opIds: ['inbound:event'] };
    expect(await getWebInboundUploadAuthorization('account', input)).toEqual({ workerToken: credential.workerToken, databaseEpoch: 'epoch', commitProofs: { 'inbound:event': 'owner-proof' } });
    expect(await getWebInboundUploadAuthorization('other-account', input)).toBeUndefined();
    expect(await getWebInboundUploadAuthorization('account', { ...input, clientId: 'other-client' })).toBeUndefined();
    vault.unlocked = false;
    expect(await getWebInboundUploadAuthorization('account', input)).toBeUndefined();
  } finally {
    vault.unlocked = true;
    await secrets.clear({ userId: 'account', clientId: 'client', serverOrigin: credential.serverOrigin });
    await createInboundCommitJournal(db).remove('event');
    db.close();
  }
});
