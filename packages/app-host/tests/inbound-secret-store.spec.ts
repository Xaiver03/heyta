import { describe, expect, it } from 'vitest';
import { INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { createInboundRecipientKeyStore } from '../src/inbound-key-store.js';
import { createInboundCommitJournal, createVaultWrappedAutomationWorkerStore } from '../src/inbound-secret-store.js';

describe('inbound durable secrets', () => {
  it('re-wraps worker token and recipient key across a Vault root rotation', async () => {
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    const oldRoot = new Uint8Array(32).fill(1);
    const newRoot = new Uint8Array(32).fill(2);
    const credential = {
      workerId: '11111111-1111-4111-8111-111111111111', workerToken: 'a'.repeat(64), userId: 'u',
      clientId: 'client', databaseEpoch: 'epoch', serverOrigin: 'https://example.test',
    };
    const workerStore = createVaultWrappedAutomationWorkerStore(db, async () => oldRoot.slice());
    const keyStore = createInboundRecipientKeyStore(db);
    const scope = { accountId: 'u', serverOrigin: 'https://example.test', keyEpoch: 1 };
    const privateKey = new Uint8Array(32).fill(7);
    await workerStore.save(credential);
    await keyStore.save(scope, privateKey, oldRoot);
    expect((await workerStore.load({ userId: 'u', clientId: 'client', serverOrigin: scope.serverOrigin }))?.workerToken).toBe(credential.workerToken);
    expect((await keyStore.load(scope, oldRoot))?.every((byte) => byte === 7)).toBe(true);
    const rewrap = workerStore.rewrap;
    if (rewrap === undefined) throw new Error('worker store has no rewrap port');
    await rewrap({ userId: 'u', clientId: 'client', serverOrigin: scope.serverOrigin }, oldRoot, newRoot);
    await keyStore.rewrap(oldRoot, newRoot, scope);
    const workerWithNewRoot = createVaultWrappedAutomationWorkerStore(db, async () => newRoot.slice());
    expect((await workerWithNewRoot.load({ userId: 'u', clientId: 'client', serverOrigin: scope.serverOrigin }))?.workerToken).toBe(credential.workerToken);
    expect((await keyStore.load(scope, newRoot))?.every((byte) => byte === 7)).toBe(true);
    await expect(keyStore.load(scope, oldRoot)).rejects.toThrow();
    oldRoot.fill(0); newRoot.fill(0); privateKey.fill(0); db.close();
  });

  it('keeps the commit journal opaque and durable in the shared meta store', async () => {
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    const journal = createInboundCommitJournal(db);
    await journal.save('event', 'opaque-proof');
    expect(await journal.load('event')).toBe('opaque-proof');
    await journal.remove('event');
    expect(await journal.load('event')).toBeUndefined();
    db.close();
  });

  it('binds worker recovery to the client id and merges concurrent receipts', async () => {
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    const root = new Uint8Array(32).fill(4);
    const credential = {
      workerId: '22222222-2222-4222-8222-222222222222', workerToken: 'b'.repeat(64), userId: 'u',
      clientId: 'client-a', databaseEpoch: 'epoch', serverOrigin: 'https://example.test',
    };
    const workers = createVaultWrappedAutomationWorkerStore(db, async () => root.slice());
    await workers.save(credential);
    expect(await workers.load({ userId: 'u', clientId: 'client-b', serverOrigin: credential.serverOrigin })).toBeUndefined();
    const journal = createInboundCommitJournal(db);
    await Promise.all([
      journal.save('event-a', 'proof-a'),
      journal.save('event-b', 'proof-b'),
    ]);
    expect(await journal.load('event-a')).toBe('proof-a');
    expect(await journal.load('event-b')).toBe('proof-b');
    root.fill(0); db.close();
  });
});
