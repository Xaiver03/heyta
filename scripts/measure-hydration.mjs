#!/usr/bin/env node
/** D: repeatable real-file SQLite baseline; generated data is always temporary. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { OpLogEngine } from '../packages/op-log/dist/index.js';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '../packages/storage/dist/index.js';
import { NodeSqliteDriver } from '../packages/storage/dist/sqlite/node-sqlite-driver.js';

const counts = process.argv.slice(2).map(Number);
if (!counts.length) counts.push(1000, 10000, 100000);
if (counts.some((n) => !Number.isSafeInteger(n) || n < 1)) throw new Error('Expected positive integer history sizes');
const results = [];
for (const count of counts) {
  const folder = mkdtempSync(join(tmpdir(), 'heyta-hydration-'));
  const open = async () => {
    const db = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(join(folder, 'history.db')) });
    await db.init();
    return db;
  };
  let db = await open();
  try {
    let store = new DbOpLogStore(db);
    const op = (i) => ({ id: `op-${i}`, clientId: 'bench', vectorClock: { bench: i },
      timestamp: i, entityType: 'TASK', entityId: `task-${i % 1000}`,
      opType: 'UPD', actionType: 'UPD_TASK', schemaVersion: 1,
      payload: { title: `revision-${i}`, priority: i % 4 } });
    for (let i = 1; i <= count; i += 1000) {
      await store.appendImported(Array.from({ length: Math.min(1000, count - i + 1) }, (_, j) => op(i + j)));
    }
    db.close(); db = await open(); store = new DbOpLogStore(db);
    const full = new OpLogEngine({ store, clientId: 'bench' });
    const fullStart = performance.now();
    const fullResult = await full.recover();
    const fullMs = performance.now() - fullStart;
    assert.equal(fullResult.replayed, count);
    await full.checkpoint();
    const checkpointBytes = Buffer.byteLength(JSON.stringify(await store.readCheckpoint()));
    await store.appendImported(Array.from({ length: 100 }, (_, i) => op(count + i + 1)));
    await full.rebuildFromLog();
    const expected = JSON.stringify(full.getState());
    const clock = full.getClock();
    db.close(); db = await open(); store = new DbOpLogStore(db);
    let fullScans = 0;
    const readAll = store.getAllOps.bind(store);
    store.getAllOps = (...args) => { if (args[1] === undefined) fullScans++; return readAll(...args); };
    const incremental = new OpLogEngine({ store, clientId: 'bench' });
    const tailStart = performance.now();
    const tailResult = await incremental.recover();
    const tailMs = performance.now() - tailStart;
    assert.equal(tailResult.replayed, 100);
    assert.equal(fullScans, 0);
    assert.equal(JSON.stringify(incremental.getState()), expected);
    assert.deepEqual(incremental.getClock(), clock);
    results.push({ historyOps: count, tailOps: 100, fullMs: +fullMs.toFixed(1),
      incrementalMs: +tailMs.toFixed(1), checkpointBytes, fullScans });
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ runtime: process.version, platform: process.platform, results }, null, 2));
