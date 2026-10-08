import { describe, expect, it } from 'vitest';
import { wrapInboundKey } from '@heyta/inbound-core';
import { INDEXEDDB_SCHEMA, META_KEYS, MemoryDbAdapter, STORES } from '@heyta/storage';
import { createInboundRecipientKeyStore } from '../src/inbound-key-store.js';

const scope = { accountId: 'account', serverOrigin: 'https://example.test', keyEpoch: 1 };
const root = new Uint8Array(32).fill(1);
const key = new Uint8Array(32).fill(7);
async function setup() {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  return { db, keys: createInboundRecipientKeyStore(db) };
}

describe('recipient key epochs', () => {
  it('upgrades legacy records without losing queued-event keys', async () => {
    const { db, keys } = await setup();
    await db.put(STORES.META, { key: META_KEYS.INBOUND_RECIPIENT_KEY, value: {
      version: 1, scope, wrapped: await wrapInboundKey(key, root, scope),
    } });
    await keys.save({ ...scope, keyEpoch: 2 }, new Uint8Array(32).fill(8), root);
    expect(await keys.load(scope, root)).toEqual(key);
    expect(await keys.load({ ...scope, keyEpoch: 2 }, root)).toEqual(new Uint8Array(32).fill(8));
    expect(await keys.load({ ...scope, keyEpoch: 3 }, root)).toBeUndefined();
    db.close();
  });

  it('preserves concurrent saves from independent store instances', async () => {
    const { db, keys } = await setup();
    await Promise.all([keys.save(scope, key, root), createInboundRecipientKeyStore(db).save({ ...scope, keyEpoch: 2 }, key, root)]);
    expect(await keys.load(scope, root)).toEqual(key);
    expect(await keys.load({ ...scope, keyEpoch: 2 }, root)).toEqual(key);
    db.close();
  });

  it('rotates all epochs of only the selected account and origin', async () => {
    const { db, keys } = await setup();
    const other = { ...scope, accountId: 'other' };
    const otherOrigin = { ...scope, serverOrigin: 'https://other.test' };
    const otherRoot = new Uint8Array(32).fill(3);
    const nextRoot = new Uint8Array(32).fill(2);
    await keys.save(scope, key, root);
    await keys.save({ ...scope, keyEpoch: 2 }, key, root);
    await keys.save(other, key, otherRoot);
    await keys.save(otherOrigin, key, otherRoot);
    expect(await keys.rewrap(root, nextRoot, scope)).toBe(true);
    expect(await keys.load(scope, nextRoot)).toEqual(key);
    expect(await keys.load({ ...scope, keyEpoch: 2 }, nextRoot)).toEqual(key);
    expect(await keys.load(other, otherRoot)).toEqual(key);
    expect(await keys.load(otherOrigin, otherRoot)).toEqual(key);
    await expect(keys.load(scope, root)).rejects.toThrow();
    db.close();
  });

  it('fails a corrupt rotation atomically and refuses to overwrite unknown records', async () => {
    const { db, keys } = await setup();
    await keys.save(scope, key, root);
    await keys.save({ ...scope, keyEpoch: 2 }, key, new Uint8Array(32).fill(3));
    await expect(keys.rewrap(root, new Uint8Array(32).fill(2), scope)).rejects.toThrow();
    expect(await keys.load(scope, root)).toEqual(key);
    await db.put(STORES.META, { key: META_KEYS.INBOUND_RECIPIENT_KEY, value: { version: 99 } });
    await expect(keys.save(scope, key, root)).rejects.toThrow('Invalid stored inbound keys');
    db.close();
  });
});
