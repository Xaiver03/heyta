import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createVaultKeyMigrationRemote,
  createVaultMigrationJournal,
  migrateVaultPayloads,
  type VaultKeyMigrationRemote,
  type VaultMigrationInventoryOperation,
  type VaultMigrationInventoryPage,
} from '../src';
import { createVaultPayloadCipher } from '@heyta/sync-client';
import type { VaultKeyMigrationManifest, VaultKeyMigrationStageResponse } from '@heyta/shared-schema';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';

const oldRoot = new Uint8Array(32).fill(7);
const newRoot = new Uint8Array(32).fill(9);
const journal = () => {
  const records = new Map<string, Parameters<NonNullable<import('../src').VaultMigrationJournal['save']>>[0]>();
  return {
    load: async (_scope: string, requestId: string) => records.get(requestId),
    save: async (record: Parameters<NonNullable<import('../src').VaultMigrationJournal['save']>>[0]) => { records.set(record.requestId, record); },
    clear: async (_scope: string, requestId: string) => { records.delete(requestId); },
  };
};
const keyPackage = {
  version: 1 as const,
  keyVersion: 2,
  rootKeyFingerprint: 'a'.repeat(64),
  passphrase: { kdf: 'argon2id' as const, salt: `${'A'.repeat(22)}==`, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(64) },
  recovery: { kdf: 'argon2id' as const, salt: `${'B'.repeat(22)}==`, iv: 'B'.repeat(16), ciphertext: 'B'.repeat(64) },
};

const identity = (id: string, serverSeq: number): VaultMigrationInventoryOperation => ({
  id,
  serverSeq,
  clientId: 'device-a',
  actionType: 'CREATE_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: `task-${id}`,
  timestamp: serverSeq,
  schemaVersion: 1,
  payload: '',
  causalFullState: false,
});

const stage = (overrides: Partial<VaultKeyMigrationStageResponse> = {}): VaultKeyMigrationStageResponse => ({
  requestId: 'migration-1',
  state: 'STAGING',
  keyVersion: 2,
  payloadKeyVersion: 2,
  expectedLatestSeq: 2,
  expectedOperationCount: 2,
  uploadedOperationCount: 0,
  expectedPayloadBytes: 0,
  uploadedPayloadBytes: 0,
  expiresAt: Date.now() + 60_000,
  migratedOperationCount: 0,
  latestSeq: 2,
  ...overrides,
});

const makeInventory = async (): Promise<{ getPage: (cursor?: string) => Promise<VaultMigrationInventoryPage>; pageCount: () => number }> => {
  const cipher = createVaultPayloadCipher({ current: { keyVersion: 1, rootKey: oldRoot } });
  const operations = await Promise.all([1, 2].map(async (seq) => {
    const operation = identity(`op-${seq}`, seq);
    return {
      ...operation,
      payload: await cipher.encrypt(JSON.stringify({ title: `task ${seq}` }), operation),
    };
  }));
  let pages = 0;
  const getPage = async (cursor?: string): Promise<VaultMigrationInventoryPage> => {
    pages += 1;
    if (cursor === undefined) return { operations: [operations[0]!], latestSeq: 2, retainedFromSeq: 1, complete: false, nextCursor: '1', snapshot: { present: false } };
    return { operations: [operations[1]!], latestSeq: 2, retainedFromSeq: 1, complete: true, snapshot: { present: false } };
  };
  return { getPage, pageCount: () => pages };
};

describe('vault payload migration orchestration', () => {
  it('uses the complete server inventory, re-encrypts in memory, chunks, and recovers a lost commit response', async () => {
    const inventory = await makeInventory();
    const chunks: string[] = [];
    let manifest: VaultKeyMigrationManifest | undefined;
    let statusCalls = 0;
    const remote: VaultKeyMigrationRemote = {
      async begin(value) {
        manifest = value;
        return stage();
      },
      async uploadChunk(value) {
        chunks.push(value.operations[0]!.payload);
        return stage({ uploadedOperationCount: chunks.length, uploadedPayloadBytes: value.operations.reduce((sum, op) => sum + JSON.stringify(op.payload).length, 0) });
      },
      async status() {
        statusCalls += 1;
        return stage({ state: 'PUBLISHED', uploadedOperationCount: 2, migratedOperationCount: 2 });
      },
      async commit() { throw new Error('response lost after commit'); },
      async cancel() { return stage({ state: 'CANCELLED' }); },
    };

    const result = await migrateVaultPayloads({
      inventory: { getPage: inventory.getPage },
      remote,
      package: keyPackage,
      expectedKeyVersion: 1,
      currentPayloadKeyVersion: 1,
      targetPayloadKeyVersion: 2,
      currentRootKey: oldRoot,
      targetRootKey: newRoot,
      requestId: 'migration-1',
      maxChunkPayloadBytes: 100,
      journal: journal(),
      journalScope: 'https://sync.example.test/account-1',
    });

    expect(inventory.pageCount()).toBe(2);
    expect(manifest?.expectedOperationCount).toBe(2);
    expect(manifest?.expectedLatestSeq).toBe(2);
    expect(chunks).toHaveLength(2);
    expect(statusCalls).toBe(1);
    expect(result.migratedOperationCount).toBe(2);

    const newCipher = createVaultPayloadCipher({ current: { keyVersion: 2, rootKey: newRoot } });
    const migratedIdentity = identity('op-1', 1);
    expect(await newCipher.decrypt(chunks[0]!, migratedIdentity)).toBe(JSON.stringify({ title: 'task 1' }));
    await expect(createVaultPayloadCipher({ current: { keyVersion: 1, rootKey: oldRoot } }).decrypt(chunks[0]!, migratedIdentity)).rejects.toThrow();
  });

  it('refuses to publish when the server reports a retained snapshot boundary', async () => {
    let began = false;
    await expect(migrateVaultPayloads({
      inventory: { getPage: async () => ({ operations: [], latestSeq: 4, retainedFromSeq: 1, complete: true, snapshot: { present: true, lastSnapshotSeq: 3 } }) },
      remote: {
        async begin() { began = true; return stage(); },
        async uploadChunk() { return stage(); },
        async status() { return stage(); },
        async commit() { return stage({ state: 'PUBLISHED' }); },
        async cancel() { return stage({ state: 'CANCELLED' }); },
      },
      package: keyPackage,
      expectedKeyVersion: 1,
      currentPayloadKeyVersion: 1,
      targetPayloadKeyVersion: 2,
      currentRootKey: oldRoot,
      targetRootKey: newRoot,
      journal: journal(),
      journalScope: 'scope-1',
    })).rejects.toMatchObject({ code: 'snapshot_boundary' });
    expect(began).toBe(false);
  });

  it('rejects a page that claims completion while returning a cursor', async () => {
    await expect(migrateVaultPayloads({
      inventory: { getPage: async () => ({ operations: [], latestSeq: 0, retainedFromSeq: 1, complete: true, nextCursor: 'unexpected', snapshot: { present: false } }) },
      remote: {} as VaultKeyMigrationRemote,
      package: keyPackage,
      expectedKeyVersion: 1,
      currentPayloadKeyVersion: 1,
      targetPayloadKeyVersion: 2,
      currentRootKey: oldRoot,
      targetRootKey: newRoot,
      journal: journal(),
      journalScope: 'scope-1',
    })).rejects.toMatchObject({ code: 'invalid_inventory' });
  });

  it('maps the HTTP transport to the staging protocol and sends the bearer token per request', async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify(stage()), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const remote = createVaultKeyMigrationRemote({ baseUrl: 'https://sync.example.test/', getToken: async () => 'token-1', fetchImpl });
    await remote.begin({
      requestId: 'migration-1', expectedKeyVersion: 1, expectedLatestSeq: 0,
      targetPayloadKeyVersion: 2, package: keyPackage, expectedOperationCount: 0, expectedPayloadBytes: 0,
    });
    expect(requests[0]!.url).toBe('https://sync.example.test/api/sync/key-migration');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer token-1');
  });

  it('resumes after a lost chunk response with the persisted ciphertext journal', async () => {
    const inventory = await makeInventory();
    const durableJournal = journal();
    const staged = new Map<string, string>();
    let loseOneResponse = true;
    let inventoryCalls = 0;
    const remote: VaultKeyMigrationRemote = {
      async begin() { return stage(); },
      async uploadChunk(chunk) {
        staged.set(chunk.chunkId, chunk.operations[0]!.payload);
        if (loseOneResponse && chunk.chunkIndex === 1) {
          loseOneResponse = false;
          throw new Error('chunk response lost after durable insert');
        }
        return stage({ uploadedOperationCount: staged.size });
      },
      async status() { return stage({ state: 'PUBLISHED', uploadedOperationCount: 2, migratedOperationCount: 2 }); },
      async commit() { return stage({ state: 'PUBLISHED', uploadedOperationCount: 2, migratedOperationCount: 2 }); },
      async cancel() { return stage({ state: 'CANCELLED' }); },
    };
    const options = {
      inventory: { getPage: async (cursor?: string) => { inventoryCalls += 1; return inventory.getPage(cursor); } },
      remote,
      package: keyPackage,
      expectedKeyVersion: 1,
      currentPayloadKeyVersion: 1,
      targetPayloadKeyVersion: 2,
      currentRootKey: oldRoot,
      targetRootKey: newRoot,
      requestId: 'journal-resume-1',
      maxChunkPayloadBytes: 100,
      journal: durableJournal,
      journalScope: 'scope-1',
    } as const;
    await expect(migrateVaultPayloads(options)).rejects.toThrow('chunk response lost');
    const firstBytes = [...staged.values()];
    const result = await migrateVaultPayloads(options);
    expect(result.migratedOperationCount).toBe(2);
    expect(inventoryCalls).toBe(2);
    expect([...staged.values()]).toEqual(firstBytes);
    await expect(durableJournal.load('scope-1', 'journal-resume-1')).resolves.toBeUndefined();
  });

  it('resumes the ciphertext journal after closing and reopening a real SQLite file', async () => {
    const inventory = await makeInventory();
    const rawStage = stage({ requestId: 'sqlite-restart-1' });
    let lost = false;
    const rawRemote: VaultKeyMigrationRemote = {
      async begin() { return rawStage; },
      async uploadChunk(_chunk) { return rawStage; },
      async status() { return stage({ requestId: 'sqlite-restart-1', state: 'PUBLISHED', migratedOperationCount: 2, uploadedOperationCount: 2 }); },
      async commit() { return stage({ requestId: 'sqlite-restart-1', state: 'PUBLISHED', migratedOperationCount: 2, uploadedOperationCount: 2 }); },
      async cancel() { return stage({ requestId: 'sqlite-restart-1', state: 'CANCELLED' }); },
    };
    const interruptedRemote: VaultKeyMigrationRemote = {
      ...rawRemote,
      async uploadChunk(chunk) {
        const response = await rawRemote.uploadChunk(chunk);
        if (!lost) { lost = true; throw new Error('sqlite process exited after chunk commit'); }
        return response;
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'heyta-vault-journal-'));
    const dbPath = join(dir, 'journal.db');
    const open = () => new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(dbPath),
    });
    const options = {
      inventory,
      package: keyPackage,
      expectedKeyVersion: 1,
      currentPayloadKeyVersion: 1,
      targetPayloadKeyVersion: 2,
      currentRootKey: oldRoot,
      targetRootKey: newRoot,
      requestId: 'sqlite-restart-1',
      maxChunkPayloadBytes: 100,
      journalScope: 'sqlite-scope-1',
    } as const;

    const firstAdapter = open();
    await firstAdapter.init();
    try {
      await expect(migrateVaultPayloads({
        ...options,
        remote: interruptedRemote,
        journal: createVaultMigrationJournal(firstAdapter),
      })).rejects.toThrow('sqlite process exited after chunk commit');
    } finally {
      firstAdapter.close();
    }

    const secondAdapter = open();
    await secondAdapter.init();
    try {
      const result = await migrateVaultPayloads({
        ...options,
        remote: rawRemote,
        journal: createVaultMigrationJournal(secondAdapter),
      });
      expect(result).toMatchObject({ requestId: 'sqlite-restart-1', migratedOperationCount: 2 });
      await expect(createVaultMigrationJournal(secondAdapter).load('sqlite-scope-1', 'sqlite-restart-1')).resolves.toBeUndefined();
    } finally {
      secondAdapter.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
