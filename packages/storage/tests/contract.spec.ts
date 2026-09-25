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

import { INDEXEDDB_SCHEMA, IndexedDbAdapter } from '../src/indexeddb/indexeddb-adapter.js';
import { MemoryDbAdapter } from '../src/memory/memory-adapter.js';

import { runDbAdapterContract } from './contract/adapter.contract.js';

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

describe('DbAdapter 实现一致性', () => {
  runDbAdapterContract({
    name: 'MemoryDbAdapter',
    create: async () => {
      const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
      await db.init();
      return db;
    },
  });

  runDbAdapterContract({
    name: 'IndexedDbAdapter',
    create: () => freshIndexedDb(`contract-${++counter}`),
  });
});
