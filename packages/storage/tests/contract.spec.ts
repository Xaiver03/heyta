/**
 * 同一套契约，跑遍所有 `DbAdapter` 实现。
 *
 * 🔴 这个文件本身就是 ADR-0003 §2.2 的证据：
 * 每当新增一个实现（SQLite / 原生桥接……），**只需要在这里加一行**，
 * 就自动获得全部契约覆盖。不需要、也不允许为某个实现另写一套断言 ——
 * 那样测的是实现者的假设，而不是接口本身。
 */

import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { describe } from 'vitest';

import { DbOpLogStore } from '../src/db-op-log-store.js';
import { INDEXEDDB_SCHEMA, IndexedDbAdapter } from '../src/indexeddb/indexeddb-adapter.js';
import { MemoryDbAdapter } from '../src/memory/memory-adapter.js';
import { NodeSqliteDriver } from '../src/sqlite/node-sqlite-driver.js';
import { SqliteAdapter } from '../src/sqlite/sqlite-adapter.js';

import { runDbAdapterContract } from './contract/adapter.contract.js';
import { runOpLogStoreContract } from './contract/op-log-store.contract.js';

const memoryDb = async (): Promise<MemoryDbAdapter> => {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  return db;
};

/** 每个用例一个全新的 IndexedDB 全局，避免互相污染。 */
function freshIndexedDb(name: string): Promise<IndexedDbAdapter> {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof FakeIDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = FakeIDBKeyRange;
  const db = new IndexedDbAdapter(name);
  return db.init().then(() => db);
}

let counter = 0;

/**
 * SQLite 用**内存库**跑契约：与 IndexedDB 的 `freshIndexedDb` 对应，
 * 每个用例一个全新实例，互不污染。持久化另有 `tests/sqlite.spec.ts` 用临时文件覆盖。
 */
const sqliteDb = async (): Promise<SqliteAdapter> => {
  const db = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await db.init();
  return db;
};

describe('DbAdapter 实现一致性', () => {
  runDbAdapterContract({ name: 'MemoryDbAdapter', create: memoryDb });
  runDbAdapterContract({
    name: 'IndexedDbAdapter',
    create: () => freshIndexedDb(`contract-${++counter}`),
  });
  runDbAdapterContract({ name: 'SqliteAdapter', create: sqliteDb });

  /**
   * op-log 层必须能跑在**任意** DbAdapter 上。
   * 同一份契约跑三个引擎 = ADR-0003「换引擎，上层一行不改」的证据。
   */
  runOpLogStoreContract({
    name: 'MemoryDbAdapter',
    createDb: memoryDb,
    create: (db) => new DbOpLogStore(db),
  });
  runOpLogStoreContract({
    name: 'IndexedDbAdapter',
    createDb: () => freshIndexedDb(`oplog-${++counter}`),
    create: (db) => new DbOpLogStore(db),
  });
  runOpLogStoreContract({
    name: 'SqliteAdapter',
    createDb: sqliteDb,
    create: (db) => new DbOpLogStore(db),
  });
});
