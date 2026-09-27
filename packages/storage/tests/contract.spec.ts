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
import { createWorkerOpLogStore, serveOpLogWorker } from '../src/sqlite/oplog-worker-bridge.js';
import { NodeSqliteDriver } from '../src/sqlite/node-sqlite-driver.js';
import { SqliteAdapter } from '../src/sqlite/sqlite-adapter.js';
import {
  SqliteWasmDriver,
  type Oo1Db,
} from '../src/sqlite/sqlite-wasm-driver.js';

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

/**
 * Web 的 `sqlite-wasm` 实现，**在 Node 里用内存库**跑同一套契约。
 *
 * 🔴 这里测的是 `SqliteWasmDriver` 的**映射逻辑**（占位符绑定、行形状、
 * 幂等关闭、唯一冲突判定），**不是 OPFS** —— OPFS 只在浏览器里有，
 * 它的接入由真浏览器单独验。
 *
 * 之所以能把两者分开，是因为驱动的构造只要求一个已经打开的 `oo1.DB`
 * 对象，不自己碰 OPFS（见 `sqlite-wasm-driver.ts` 文件头第三段）。
 * 合在一起的话，连"绑定参数对不对"都得靠真浏览器去兜 ——
 * 而真浏览器比这里慢几个数量级，失败时的指向也远没有这么清楚。
 */
const wasmInit = async (): Promise<{ oo1: { DB: new (p: string, f?: string) => Oo1Db } }> => {
  // 该包无类型声明，且入口通过全局暴露初始化函数（不是 export default）。
  await import('@sqlite.org/sqlite-wasm');
  const init = (globalThis as { sqlite3InitModule?: () => Promise<never> }).sqlite3InitModule;
  if (init === undefined) throw new Error('sqlite3InitModule 未定义');
  return (await init()) as unknown as { oo1: { DB: new (p: string, f?: string) => Oo1Db } };
};

const sqliteWasmDb = async (): Promise<SqliteAdapter> => {
  const sqlite3 = await wasmInit();
  const db = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    // `'c'` = 建库标志。内存库每个用例一份，与 `freshIndexedDb` 对应。
    driverFactory: () => new SqliteWasmDriver(new sqlite3.oo1.DB(':memory:', 'c')),
  });
  await db.init();
  return db;
};

/**
 * 一对**进程内**端口，模拟 `postMessage` 的两端。
 *
 * 🔴 为什么不用真 Worker：这里要验的是**协议与转发**（方法名对不对、参数过不过得去、
 * 异常能不能带着堆栈回来），而不是浏览器的消息设施本身。
 * 真的起一个 Worker 会把失败原因埋在浏览器进程边界后面，比这里慢几个数量级、
 * 指向也远没有这么清楚 —— 而真 Worker 由 `scripts/verify-web-sqlite.mjs` 单独验。
 *
 * ⚠️ **投递必须是异步的**（真实 `postMessage` 就是异步的）。
 * 这里用 `queueMicrotask`，于是"代理假设响应会同步到达"这类错误会当场暴露，
 * 而不是在真浏览器里才偶发。
 */
function inProcessPortPair(): {
  /** 主线程那侧：`createWorkerOpLogStore` 拿到的就是它。 */
  mainSide: {
    postMessage(message: unknown): void;
    addEventListener(type: string, listener: (event: { data: unknown }) => void): void;
  };
  /** Worker 那侧：`serveOpLogWorker` 拿到的就是它。 */
  workerSide: {
    postMessage(message: unknown): void;
    onmessage: ((event: { data: unknown }) => void) | null;
  };
} {
  const mainListeners: Array<(event: { data: unknown }) => void> = [];
  let workerOnMessage: ((event: { data: unknown }) => void) | null = null;

  const mainSide = {
    postMessage(message: unknown): void {
      queueMicrotask(() => workerOnMessage?.({ data: message }));
    },
    addEventListener(_type: string, listener: (event: { data: unknown }) => void): void {
      mainListeners.push(listener);
    },
  };

  const workerSide = {
    postMessage(message: unknown): void {
      queueMicrotask(() => {
        for (const listener of mainListeners) listener({ data: message });
      });
    },
    get onmessage(): ((event: { data: unknown }) => void) | null {
      return workerOnMessage;
    },
    set onmessage(value: ((event: { data: unknown }) => void) | null) {
      workerOnMessage = value;
    },
  };

  return { mainSide, workerSide };
}

describe('DbAdapter 实现一致性', () => {
  runDbAdapterContract({ name: 'MemoryDbAdapter', create: memoryDb });
  runDbAdapterContract({
    name: 'IndexedDbAdapter',
    create: () => freshIndexedDb(`contract-${++counter}`),
  });
  runDbAdapterContract({ name: 'SqliteAdapter', create: sqliteDb });
  /**
   * 🔴 **M4 的核心判据**：web 的驱动与桌面/测试用的驱动跑的是**同一套契约**。
   * 这一行就是 ADR-0027「存储统一」的证据 —— 加一行，自动获得全部覆盖。
   */
  runDbAdapterContract({ name: 'SqliteWasmDriver', create: sqliteWasmDb });

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
  runOpLogStoreContract({
    name: 'SqliteWasmDriver',
    createDb: sqliteWasmDb,
    create: (db) => new DbOpLogStore(db),
  });

  /**
   * 🔴 **Worker 桥接的透明性**（`oplog-worker-bridge.ts`）。
   *
   * 这是 M4-3 的关键判据：web 端最终用的不是 `DbOpLogStore` 本身，
   * 而是"隔着 Worker 的那个代理"。如果代理把某个方法的参数丢掉、或把返回值
   * 的形状改了，上层会**静默**拿到错的数据 —— 所以它必须过**同一套**契约，
   * 而不是另写几条"桥能通"的断言。
   *
   * 这一行通过 = 隔着 Worker 的行为与本地直连**逐条相同**。
   */
  runOpLogStoreContract({
    name: 'Worker 桥接（Worker 侧 SqliteWasmDriver + 主线程代理）',
    createDb: sqliteWasmDb,
    create: (db) => {
      const store = new DbOpLogStore(db);
      const { mainSide, workerSide } = inProcessPortPair();
      // 顺序要紧：先把服务端挂上，再建代理 —— 否则最初的几条消息会丢在空气里。
      serveOpLogWorker(workerSide, Promise.resolve({ store, clientId: 'contract' }));
      return createWorkerOpLogStore(mainSide);
    },
  });
});
