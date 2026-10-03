/**
 * IndexedDB 适配器
 * ==================
 *
 * 实现 {@link DbAdapter}。Web 端的生产存储。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个必须处理对的 IndexedDB 陷阱（都踩过 / 都是真实故障形状）：
 *
 * 1. **事务会在"没有待处理请求"时自动提交。**
 *    一旦 await 了一个非 IDB 的 promise（比如 fetch、setTimeout），
 *    事务就关闭了，后续操作报 `TransactionInactiveError`。
 *    这是 IndexedDB 最难查的错误之一，因为它在简单测试里不会出现。
 *    → 本适配器**不 await 任何外部 promise**，所有请求排在同一批里。
 *
 * 2. **`transaction.oncomplete` 才是提交点，不是最后一个 request.onsuccess。**
 *    在 onsuccess 里就 resolve 会让调用方以为已提交，实际可能被回滚。
 *    → 只在 `oncomplete` resolve，`onabort`/`onerror` reject。
 *
 * 3. **`add()` 主键冲突是 `ConstraintError`，不是"已存在"。**
 *    去重逻辑必须靠唯一索引 + 错误码，不能靠先查后写
 *    （那有 TOCTOU 竞态：两个并发写入都能查到"不存在"）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type {
  DbAdapter,
  DbCursorAction,
  DbCursorVisitor,
  DbIndexQuery,
  DbIterateOptions,
  DbKey,
  DbKeyRange,
  DbTx,
  DbTxMode,
  DbTolerantAddResult,
  StoreSchema,
} from '../db.types.js';
import { assertIterateLimit } from '../db.types.js';
import { StorageError, asStorageError, storageError } from '../errors.js';
import {
  ALL_STORES,
  OP_FIELDS,
  OP_INDEXES,
  STORES,
  type StoreName,
} from '../stores.js';

/** 建库所需的 store 与索引定义。持久化结构，改动要谨慎（见 stores.ts）。 */
// `StoreSchema` 已提到 `db.types.ts` —— 它必须在实现之间共享。
// 这里重新导出，保持既有 import 路径可用。

export type { StoreSchema };

export /**
 * IndexedDB schema 版本。
 *
 * ⚠️ **加索引/加 store 必须 bump 这个值。**
 * 已有数据库不会因为代码变了就重建 —— `onupgradeneeded` 只在
 * 请求的版本**高于**磁盘上的版本时触发。不 bump 的话新索引永远不会
 * 被创建，而基于它的查询会**静默返回空**（同 applyStatus 那类坑）。
 *
 * v2：新增 `by_uploadStatus` 索引（离线上传队列）。
 */
const DB_SCHEMA_VERSION = 2;

export const INDEXEDDB_SCHEMA: StoreSchema[] = [
  {
    name: STORES.OPS,
    keyPath: OP_FIELDS.SEQ,
    autoIncrement: true,
    indexes: [
      // ⚠️ keyPath 必须指向 `op.*`。存进去的记录形状是 { op, source, applyStatus }，
      // op 的业务字段是**嵌套**的。我第一版把 keyPath 写成顶层 `entityType`，
      // 于是索引全部命中不到任何记录 —— 不报错，只是查询恒返回空。
      { name: OP_INDEXES.OP_ID, keyPath: `op.${OP_FIELDS.OP_ID}`, unique: true },
      { name: OP_INDEXES.PENDING_UPLOAD, keyPath: OP_FIELDS.UPLOAD_STATUS },
      {
        name: OP_INDEXES.ENTITY,
        keyPath: [`op.${OP_FIELDS.ENTITY_TYPE}`, `op.${OP_FIELDS.ENTITY_ID}`],
      },
      {
        name: OP_INDEXES.ENTITY_IDS,
        keyPath: `op.${OP_FIELDS.ENTITY_IDS}`,
        multiEntry: true,
      },
      // applyStatus 是**字符串**（不是布尔）—— 布尔不能作为 IDB 键
      { name: OP_INDEXES.PENDING_APPLY, keyPath: OP_FIELDS.APPLY_STATUS },
    ],
  },
  {
    name: STORES.STATE,
    keyPath: ['entityType', 'entityId'],
  },
  {
    name: STORES.META,
    keyPath: 'key',
  },
  {
    name: STORES.ARCHIVE,
    keyPath: OP_FIELDS.SEQ,
    indexes: [
      { name: OP_INDEXES.OP_ID, keyPath: `op.${OP_FIELDS.OP_ID}`, unique: true },
    ],
  },
];

/**
 * 把一个查询参数转成 IDB 能接受的形式。
 *
 * ⚠️ 三种情况必须分开，不能一律 buildRange：
 *   - undefined        → undefined（全表）
 *   - 数组             → 复合索引的精确匹配，直接传
 *   - 标量（string/number）→ **直接传**，不能塞进 buildRange
 *                        （buildRange 只认 {lower, upper} 形状的对象，
 *                         传标量会得到 undefined，静默变成全表扫描）
 *   - 区间对象         → buildRange
 */
function toIdbQuery(
  query?: DbIndexQuery,
): IDBValidKey | IDBValidKey[] | IDBKeyRange | undefined {
  if (query === undefined) return undefined;
  if (Array.isArray(query)) return query as IDBValidKey[];
  if (typeof query === 'string' || typeof query === 'number') return query;
  return buildRange(query);
}

/** 构造 IDBKeyRange，处理开闭区间。 */
function buildRange(range?: DbKeyRange): IDBKeyRange | undefined {
  if (range === undefined) return undefined;
  const { lower, upper, lowerOpen, upperOpen } = range;

  if (lower !== undefined && upper !== undefined) {
    return IDBKeyRange.bound(lower, upper, lowerOpen ?? false, upperOpen ?? false);
  }
  if (lower !== undefined) return IDBKeyRange.lowerBound(lower, lowerOpen ?? false);
  if (upper !== undefined) return IDBKeyRange.upperBound(upper, upperOpen ?? false);
  return undefined;
}

/** 把我们的游标动作映射到 IDB 的 cursor 方法。 */
function applyCursorAction(cursor: IDBCursorWithValue, action: DbCursorAction): boolean {
  switch (action) {
    case 'continue':
      cursor.continue();
      return true;
    case 'stop':
      return false;
    case 'delete':
      cursor.delete();
      cursor.continue();
      return true;
    case 'delete-stop':
      cursor.delete();
      return false;
  }
}

/**
 * 把 IDBRequest 包成 Promise。
 *
 * ⚠️ 只在 `onerror` 里 reject —— 不要在这里处理事务级别的错误，
 * 那由 {@link IndexedDbAdapter.transaction} 统一处理，否则会双重 reject。
 *
 * ⚠️⚠️ `suppressError` 是**必须的**，不是优化：
 * IndexedDB 里一个请求报错时，错误事件会**冒泡并中止整个事务** ——
 * 除非在 onerror 里调用 `preventDefault()`。
 * 所以"唯一索引冲突就跳过这条、继续写其余的"这种需求，
 * **不 preventDefault 是做不到的**：事务会被中止，整批回滚。
 * 我第一版没做，表现为去重完全失效（重复 op 全被写进去了）。
 */
function req<T>(request: IDBRequest<T>, suppressError = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => {
      if (suppressError) {
        // 阻止错误冒泡到事务，事务得以继续
        event.preventDefault();
        event.stopPropagation();
      }
      reject(storageError(request.error, 'IndexedDB 请求失败', { kind: 'request-failed' }));
    };
  });
}

/** 尝试 add 的结果。冲突不是错误，是"已存在"。 */
/**
 * @deprecated 用 `db.types.ts` 的 {@link DbTolerantAddResult}。
 *
 * 这里曾经有一份**自己的**定义。共享契约一跑就暴露了：
 * 接口上声明的是 `DbTolerantAddResult`（key 是 number），
 * 而这里是 `IDBValidKey` —— 两套定义，一个概念。
 * 已合并，别名只为不改动既有引用。
 */
export type AddOutcome = DbTolerantAddResult;

export class IndexedDbAdapter implements DbAdapter {
  private db: IDBDatabase | undefined;
  private opening: Promise<IDBDatabase> | undefined;

  constructor(private readonly dbName: string = 'heyta') {}

  init(): Promise<void> {
    return this.open().then(() => undefined);
  }

  /**
   * 打开数据库。
   *
   * **并发安全**：用 `opening` 缓存 in-flight 的 Promise ——
   * 否则并发 init 会开多个连接，而 upgrade 事务在多个连接间会互相阻塞。
   */
  private open(): Promise<IDBDatabase> {
    if (this.db !== undefined) return Promise.resolve(this.db);
    if (this.opening !== undefined) return this.opening;

    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_SCHEMA_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of INDEXEDDB_SCHEMA) {
          const objectStore = db.objectStoreNames.contains(store.name)
            ? request.transaction!.objectStore(store.name)
            : db.createObjectStore(store.name, {
                keyPath: store.keyPath,
                autoIncrement: store.autoIncrement ?? false,
              });

          for (const index of store.indexes ?? []) {
            if (objectStore.indexNames.contains(index.name)) continue;
            objectStore.createIndex(index.name, index.keyPath, {
              unique: index.unique ?? false,
              multiEntry: index.multiEntry ?? false,
            });
          }
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        // 连接被外部关闭（如浏览器回收）时清掉缓存，下次调用会重开
        request.result.onclose = () => {
          this.db = undefined;
          this.opening = undefined;
        };
        resolve(request.result);
      };

      request.onerror = () =>
        reject(storageError(request.error, '无法打开 IndexedDB', { kind: 'open-failed' }));
      // 🔴 这一条**无条件**抛（`onblocked` 事件没有 error 对象），
      // 所以它是错误屏上真正会露出来的那句中文。
      request.onblocked = () =>
        reject(
          new StorageError(
            'IndexedDB 升级被其它标签页阻塞 —— 请关闭该应用的其它窗口后重试',
            { kind: 'upgrade-blocked' },
          ),
        );
    });

    return this.opening;
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
    this.opening = undefined;
  }

  // ── 事务 ────────────────────────────────────────────────

  /**
   * 执行一个原子事务。
   *
   * ⚠️ 返回的 Promise **在 oncomplete 才决议**（见文件头陷阱 2）。
   */
  async transaction<T>(
    stores: string[],
    mode: DbTxMode,
    fn: (tx: DbTx) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();

    return new Promise<T>((resolve, reject) => {
      let idbTx: IDBTransaction;
      try {
        idbTx = db.transaction(stores, mode);
      } catch (error) {
        // 走到这里几乎只有一种可能：调用的 store 名或模式不合法 —— 编程错误。
        reject(asStorageError(error, '无法开始事务', { kind: 'programming-error' }));
        return;
      }

      let result: T;
      let settled = false;

      idbTx.oncomplete = () => {
        settled = true;
        resolve(result);
      };
      idbTx.onabort = () => {
        if (settled) return;
        settled = true;
        reject(storageError(idbTx.error, 'IndexedDB 事务被中止', { kind: 'transaction-failed' }));
      };
      idbTx.onerror = () => {
        if (settled) return;
        settled = true;
        reject(storageError(idbTx.error, 'IndexedDB 事务失败', { kind: 'transaction-failed' }));
      };

      const tx = this.makeTx(idbTx, stores);

      fn(tx).then(
        (value) => {
          result = value;
          // ⚠️ 这里**不 resolve** —— 等 oncomplete。
          // 但有个陷阱：如果 fn 里没有发出任何请求（例如只做纯计算），
          // 事务不会有待处理请求，oncomplete 可能已经/即将触发。
          // 主动 commit 一下是安全的（已提交时是 no-op）。
          try {
            idbTx.commit?.();
          } catch {
            // 老浏览器没有 commit()，忽略
          }
        },
        (error: unknown) => {
          settled = true;
          try {
            idbTx.abort();
          } catch {
            // 已结束
          }
          reject(asStorageError(error, '事务内的操作失败', { kind: 'request-failed' }));
        },
      );
    });
  }

  private makeTx(idbTx: IDBTransaction, allowed: string[]): DbTx {
    const storeNames = new Set(allowed);

    const assert = (store: string): void => {
      if (!storeNames.has(store)) {
        // 明确抛错而不是让 IDB 抛 —— 后者信息量太低
        throw new StorageError(
          `事务未包含 store「${store}」。请把它加进 transaction([...]) 的列表：${allowed.join(', ')}`,
          { kind: 'programming-error' },
        );
      }
    };

    const store = (name: string): IDBObjectStore => {
      assert(name);
      return idbTx.objectStore(name);
    };

    const api: DbTx & {
      addToleratingDuplicate: (storeName: string, value: unknown) => Promise<DbTolerantAddResult>;
    } = {
      add: (s, value) => req(store(s).add(value)) as Promise<number>,

      /**
       * 冲突可容忍的 add。
       *
       * 用在 op-log 写入上：同一个 opId 被重复投递是**正常路径**
       * （同步会重放、客户端会重试），不是异常。
       */
      addToleratingDuplicate: async (storeName, value) => {
        try {
          const key = await req(store(storeName).add(value), true);
          // 本项目所有主键都是 string | number，且自增键一定是 number。
          // 在边界处收窄，而不是把 `DbTolerantAddResult.key` 放宽到 IDBValidKey
          // —— 那会让上层也被迫处理 Date / ArrayBuffer。
          return { ok: true, key: typeof key === 'number' ? key : Number(key) };
        } catch (error) {
          // 🔴 看的是**驱动自己的**错误名。抛出来的现在一律是 `StorageError`
          // （`name` 已经被换成 `'StorageError'`），所以必须往 `cause` 里找
          // —— 否则唯一索引冲突会被当成真失败，幂等写入直接坏掉。
          const driverError = error instanceof StorageError ? error.cause : error;
          if (
            typeof driverError === 'object' &&
            driverError !== null &&
            'name' in driverError &&
            (driverError as { name: string }).name === 'ConstraintError'
          ) {
            return { ok: false, reason: 'duplicate' };
          }
          throw error;
        }
      },
      put: (s, value, key) =>
        key === undefined
          ? req(store(s).put(value)).then(() => undefined)
          : req(store(s).put(value, key)).then(() => undefined),
      get: <T,>(s: string, key: DbKey) =>
        req(store(s).get(key)) as Promise<T | undefined>,
      getAll: <T,>(s: string, range?: DbKeyRange, limit?: number) => {
        assertIterateLimit(limit);
        return req(store(s).getAll(buildRange(range), limit)) as Promise<T[]>;
      },
      delete: (s, key) => req(store(s).delete(key)).then(() => undefined),
      clear: (s) => req(store(s).clear()).then(() => undefined),
      count: (s, range?: DbKeyRange) => req(store(s).count(buildRange(range))),

      getFromIndex: <T,>(s: string, index: string, key: DbKey | DbKey[]) =>
        req(store(s).index(index).get(key)) as Promise<T | undefined>,
      // IDBValidKey 比我们的 DbKey 宽（还包含 Date / ArrayBuffer），
      // 但本项目所有主键都是 string | number。在边界处收窄并注明，
      // 而不是把 DbKey 放宽到 IDBValidKey —— 那会让上层也得处理 Date。
      getKeyFromIndex: (s, index, key) =>
        req(store(s).index(index).getKey(key)) as Promise<DbKey | undefined>,
      getAllFromIndex: <T,>(s: string, index: string, query?: DbIndexQuery) => {
        return req(store(s).index(index).getAll(toIdbQuery(query))) as Promise<T[]>;
      },
      countFromIndex: (s, index, query?: DbIndexQuery) => {
        return req(store(s).index(index).count(toIdbQuery(query)));
      },

      iterate: <T,>(
        s: string,
        options: DbIterateOptions,
        visit: DbCursorVisitor<T>,
      ) => this.iterateIn(store(s), options, visit),
    };
    return api;
  }

  /** 游标遍历。抽出来是因为顶层方法和事务方法共用它。 */
  private iterateIn<T>(
    source: IDBObjectStore | IDBIndex,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void> {
    assertIterateLimit(options.limit);

    return new Promise<void>((resolve, reject) => {
      let visited = 0;
      const limit = options.limit;
      const range = buildRange({ lower: options.lower, upper: options.upper });
      const direction: IDBCursorDirection = options.direction ?? 'next';

      const request = source.openCursor(range, direction);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null) {
          resolve();
          return;
        }
        if (limit !== undefined && visited >= limit) {
          resolve();
          return;
        }

        visited += 1;
        // cursor.key 是 IDBValidKey（比 DbKey 宽，含 Date/ArrayBuffer）。
        // 本项目主键都是 string|number，边界处收窄并注明。
        const action = visit(cursor.value as T, cursor.key as DbKey);
        if (!applyCursorAction(cursor, action)) {
          resolve();
        }
      };

      request.onerror = () =>
        reject(storageError(request.error, 'IndexedDB 游标失败', { kind: 'request-failed' }));
    });
  }

  // ── 顶层便捷方法：包一个单 store 事务 ────────────────────

  async add(store: string, value: unknown): Promise<number> {
    return this.transaction([store], 'readwrite', (tx) => tx.add(store, value));
  }

  async put(store: string, value: unknown, key?: DbKey): Promise<void> {
    return this.transaction([store], 'readwrite', (tx) => tx.put(store, value, key));
  }

  async get<T>(store: string, key: DbKey): Promise<T | undefined> {
    return this.transaction([store], 'readonly', (tx) => tx.get<T>(store, key));
  }

  async getAll<T>(store: string, range?: DbKeyRange, limit?: number): Promise<T[]> {
    return this.transaction([store], 'readonly', (tx) => tx.getAll<T>(store, range, limit));
  }

  async delete(store: string, key: DbKey): Promise<void> {
    return this.transaction([store], 'readwrite', (tx) => tx.delete(store, key));
  }

  async clear(store: string): Promise<void> {
    return this.transaction([store], 'readwrite', (tx) => tx.clear(store));
  }

  async count(store: string, range?: DbKeyRange): Promise<number> {
    return this.transaction([store], 'readonly', (tx) => tx.count(store, range));
  }

  async getFromIndex<T>(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<T | undefined> {
    return this.transaction([store], 'readonly', (tx) =>
      tx.getFromIndex<T>(store, index, key),
    );
  }

  async getKeyFromIndex(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<DbKey | undefined> {
    return this.transaction([store], 'readonly', (tx) =>
      tx.getKeyFromIndex(store, index, key),
    );
  }

  async getAllFromIndex<T>(
    store: string,
    index: string,
    query?: DbIndexQuery,
  ): Promise<T[]> {
    return this.transaction([store], 'readonly', (tx) =>
      tx.getAllFromIndex<T>(store, index, query),
    );
  }

  async countFromIndex(
    store: string,
    index: string,
    query?: DbIndexQuery,
  ): Promise<number> {
    return this.transaction([store], 'readonly', (tx) =>
      tx.countFromIndex(store, index, query),
    );
  }

  async iterate<T>(
    store: string,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void> {
    // ⚠️ 用 readwrite 而不是 readonly：访问者可以返回 'delete' / 'delete-stop'，
    // 而 `cursor.delete()` 在只读事务里会抛 AbortError，
    // 失败方式还是"整个事务中止"而不是一个清晰的错误。
    return this.transaction([store], 'readwrite', async (tx) => {
      await tx.iterate<T>(store, options, visit);
    });
  }

  /** 删除整个数据库。测试与"清除所有数据"用。 */
  async destroy(): Promise<void> {
    this.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(storageError(request.error, '删除数据库失败', { kind: 'request-failed' }));
      request.onblocked = () => resolve(); // 有其它连接时也可能成功
    });
  }
}

/** 所有 store 名（供建库与测试断言）。 */
export const ALL_STORE_NAMES: StoreName[] = ALL_STORES;
