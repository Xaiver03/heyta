/**
 * 内存存储适配器 —— **参考实现**。
 *
 * 存在的理由不是"测试方便"，而是 ADR-0003 §2.2 的硬要求：
 *
 * > `DbAdapter` / `OpLogStore` 只暴露最小必要操作……
 * > **同一套契约测试跑遍所有实现** —— 换后端时上层一行不用改
 *
 * 只有一个实现时，"存储可替换"只是**声明**：接口上任何被 IndexedDB 的
 * 具体行为悄悄决定的东西（键的比较顺序、唯一索引冲突时整条记录不入库、
 * 访问未列入事务的 store 要报错……）都不会有人发现，直到移植到 SQLite
 * 时才集中爆炸。第二个实现 + 同一套契约，是唯一能把声明变成事实的办法。
 *
 * ⚠️ 它是**内存**实现：进程结束即消失。不要拿它当生产存储。
 */

import {
  assertIterateLimit,
  DEFAULT_ITERATE_LIMIT,
  type DbAdapter,
  type DbCursorAction,
  type DbCursorVisitor,
  type DbIndexQuery,
  type DbIterateOptions,
  type DbKey,
  type DbKeyRange,
  type DbTx,
  type DbTxMode,
  type StoreSchema,
} from '../db.types.js';

/**
 * 🔴 键的比较必须与 IndexedDB **一致**，否则"同一套契约"是假的。
 *
 * IndexedDB 的键序是：number < date < string < binary < array。
 * 数组按元素逐个比较，前缀短的排前面。
 * 这个顺序决定了 `getAll(range)` 和游标遍历的结果顺序 —— 上层代码
 * （例如"待上传队列按 seq 升序"）依赖它，所以不能随手用字符串比较糊过去。
 */
function compareKeys(a: DbKey | DbKey[], b: DbKey | DbKey[]): number {
  const rank = (k: unknown): number => {
    if (typeof k === 'number') return 0;
    if (k instanceof Date) return 1;
    if (typeof k === 'string') return 2;
    if (Array.isArray(k)) return 4;
    return 3;
  };

  if (Array.isArray(a) || Array.isArray(b)) {
    const arrA = Array.isArray(a) ? a : [a];
    const arrB = Array.isArray(b) ? b : [b];
    // 类型不同的两侧不该被当作数组比较，先按类型序排开
    if (Array.isArray(a) !== Array.isArray(b)) {
      return rank(a) - rank(b);
    }
    const len = Math.min(arrA.length, arrB.length);
    for (let i = 0; i < len; i++) {
      const diff = compareKeys(arrA[i] as DbKey, arrB[i] as DbKey);
      if (diff !== 0) return diff;
    }
    return arrA.length - arrB.length;
  }

  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) return rankDiff;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  // 注意：`DbKey` 只有 string | number —— Date 不在契约里，
  // 所以这里不需要（也不该）有 Date 分支。`rank()` 里留 Date 只是为了让
  // 键序排在 string 之前的那条规则在注释上完整。
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * 唯一约束冲突的内部信号。
 *
 * 只在适配器内部使用：`add` 把它当作真错误抛出，`addToleratingDuplicate`
 * 把它转成 `{ ok: false, reason: 'duplicate' }`。
 * 不导出到公共类型 —— 上层不该靠 instanceof 判断重复。
 */
class DuplicateKeyError extends Error {
  constructor(what: string) {
    super(`唯一键冲突：${what}`);
    this.name = 'DuplicateKeyError';
  }
}

/** 稳定的 Map 键。数组要保序，所以不能只 String()。 */
function serializeKey(key: DbKey | DbKey[]): string {
  return JSON.stringify(key);
}

/** 沿点分路径取值。`op.id` 要能取到嵌套字段。 */
function valueAtPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** 把 keyPath（字符串或数组）解析成一个键；任一字段缺失则返回 undefined。 */
function keyFromPath(value: unknown, keyPath: string | readonly string[]): DbKey | DbKey[] | undefined {
  if (typeof keyPath === 'string') {
    const v = valueAtPath(value, keyPath);
    return typeof v === 'string' || typeof v === 'number' ? v : undefined;
  }
  const parts: DbKey[] = [];
  for (const p of keyPath) {
    const v = valueAtPath(value, p);
    if (typeof v !== 'string' && typeof v !== 'number') return undefined;
    parts.push(v);
  }
  return parts;
}

/** 判定一个键是否落在区间内。 */
function inRange(key: DbKey | DbKey[], range?: DbKeyRange): boolean {
  if (range === undefined) return true;
  const { lower, upper, lowerOpen, upperOpen } = range;
  if (lower !== undefined) {
    const diff = compareKeys(key, lower);
    if (diff < 0 || (diff === 0 && lowerOpen === true)) return false;
  }
  if (upper !== undefined) {
    const diff = compareKeys(key, upper);
    if (diff > 0 || (diff === 0 && upperOpen === true)) return false;
  }
  return true;
}

/** 判定一个索引条目是否命中查询（标量 = 精确、数组 = 复合精确、对象 = 区间）。 */
function matchesIndexQuery(entryKey: DbKey | DbKey[], query?: DbIndexQuery): boolean {
  if (query === undefined) return true;
  if (typeof query === 'string' || typeof query === 'number') {
    return compareKeys(entryKey, query) === 0;
  }
  if (Array.isArray(query)) {
    return serializeKey(entryKey) === serializeKey(query);
  }
  return inRange(entryKey, query);
}

interface PhysicalRecord {
  key: DbKey | DbKey[];
  value: Record<string, unknown>;
}

interface PhysicalStore {
  schema: StoreSchema;
  records: Map<string, PhysicalRecord>;
  autoIncrement: number;
}

/**
 * 内存适配器。
 *
 * 并发契约与 `DbAdapter` 一致：所有方法都可安全并发调用。
 * 这里靠**同步执行 + 微任务边界**天然串行化，不需要额外加锁。
 */
export class MemoryDbAdapter implements DbAdapter {
  private stores = new Map<string, PhysicalStore>();
  private closing = false;
  private syncDepth = 0;
  private txQueue: Promise<unknown> = Promise.resolve();

  constructor(schema: readonly StoreSchema[] = []) {
    for (const s of schema) {
      this.stores.set(s.name, {
        schema: s,
        records: new Map(),
        autoIncrement: 0,
      });
    }
  }

  async init(): Promise<void> {
    this.closing = false;
  }

  close(): void {
    this.closing = true;
  }

  /** 建表。可重复调用（幂等），用于测试里动态加 store。 */
  defineStore(schema: StoreSchema): void {
    if (this.stores.has(schema.name)) return;
    this.stores.set(schema.name, { schema, records: new Map(), autoIncrement: 0 });
  }

  // ── 公开 API：每条都开一个单 store 事务 ──────────────────────

  add(store: string, value: unknown): Promise<number> {
    return this.transaction([store], 'readwrite', async (tx) => tx.add(store, value));
  }

  put(store: string, value: unknown, key?: DbKey): Promise<void> {
    return this.transaction([store], 'readwrite', async (tx) => tx.put(store, value, key));
  }

  get<T>(store: string, key: DbKey): Promise<T | undefined> {
    return this.transaction([store], 'readonly', async (tx) => tx.get<T>(store, key));
  }

  getAll<T>(store: string, range?: DbKeyRange, limit?: number): Promise<T[]> {
    return this.transaction([store], 'readonly', async (tx) => tx.getAll<T>(store, range, limit));
  }

  delete(store: string, key: DbKey): Promise<void> {
    return this.transaction([store], 'readwrite', async (tx) => tx.delete(store, key));
  }

  clear(store: string): Promise<void> {
    return this.transaction([store], 'readwrite', async (tx) => tx.clear(store));
  }

  count(store: string, range?: DbKeyRange): Promise<number> {
    return this.transaction([store], 'readonly', async (tx) => tx.count(store, range));
  }

  getFromIndex<T>(store: string, index: string, key: DbKey | DbKey[]): Promise<T | undefined> {
    return this.transaction([store], 'readonly', async (tx) => tx.getFromIndex<T>(store, index, key));
  }

  getKeyFromIndex(store: string, index: string, key: DbKey | DbKey[]): Promise<DbKey | undefined> {
    return this.transaction([store], 'readonly', async (tx) => tx.getKeyFromIndex(store, index, key));
  }

  getAllFromIndex<T>(store: string, index: string, query?: DbIndexQuery): Promise<T[]> {
    return this.transaction([store], 'readonly', async (tx) => tx.getAllFromIndex<T>(store, index, query));
  }

  countFromIndex(store: string, index: string, query?: DbIndexQuery): Promise<number> {
    return this.transaction([store], 'readonly', async (tx) => tx.countFromIndex(store, index, query));
  }

  iterate<T>(store: string, options: DbIterateOptions, visit: DbCursorVisitor<T>): Promise<void> {
    return this.transaction([store], 'readwrite', async (tx) => tx.iterate<T>(store, options, visit));
  }

  /**
   * 单事务。**失败时整体回滚**。
   *
   * 回滚是真的要实现的：上层（例如 `appendLocal`）依赖"要么全落盘要么全不落"，
   * 一个假的事务会让崩溃恢复逻辑建立在不存在的保证上。
   */
  async transaction<T>(stores: string[], _mode: DbTxMode, fn: (tx: DbTx) => Promise<T>): Promise<T> {
    /**
     * 🔴 嵌套检测**只能**覆盖"同步前缀"，这是刻意的取舍。
     *
     * 为什么不能用一个"有事务在跑"的布尔标志：那会把**并发**也拦下来，
     * 而 `DbAdapter` 的契约明确要求"所有方法都可安全并发调用"。
     * 我第一版就是这么写的，契约测试立刻报"并发事务不能落盘" ——
     * 把并发当嵌套，等于让一个本来正确的用法变成错误。
     *
     * 为什么不能完全检测：跨 `await` 之后，JS 里没有可移植的办法知道
     * "当前这段代码是不是某个事务 fn 的后继"（浏览器没有 AsyncLocalStorage）。
     *
     * 所以这里只抓**同步前缀**里的嵌套调用：`fn(tx)` 调用到它第一个 `await`
     * 之间是同步执行的，这段时间里再调 `transaction()` 必然是真嵌套。
     * 过了 await 才调的嵌套会走队列而不是抛错 —— 那是已知的、有文档的边界。
     */
    if (this.syncDepth > 0) {
      throw new Error('不支持嵌套事务：在事务里又调用了 transaction()');
    }

    for (const name of stores) {
      if (!this.stores.has(name)) {
        throw new Error(
          `事务访问了未定义的 store：「${name}」。已定义：${[...this.stores.keys()].join(', ')}`,
        );
      }
    }

    // 快照用于回滚。浅拷贝足够：记录对象本身在事务里不会被就地改写。
    const snapshot = new Map<string, { records: Map<string, PhysicalRecord>; autoIncrement: number }>();
    for (const name of stores) {
      const s = this.stores.get(name)!;
      snapshot.set(name, { records: new Map(s.records), autoIncrement: s.autoIncrement });
    }

    const run = async (): Promise<T> => {
      this.syncDepth++;
      let pending: Promise<T>;
      try {
        pending = fn(this.makeTx(stores));
      } finally {
        // 只覆盖 fn 的同步前缀 —— 见上面关于嵌套检测的说明
        this.syncDepth--;
      }
      try {
        return await pending;
      } catch (error) {
        // 🔴 回滚必须是真的。上层（如 appendLocal）依赖"要么全落盘要么全不落"，
        // 一个假的事务会让崩溃恢复建立在不存在的保证上。
        for (const [name, snap] of snapshot) {
          const s = this.stores.get(name)!;
          s.records = snap.records;
          s.autoIncrement = snap.autoIncrement;
        }
        throw error;
      }
    };

    // FIFO 串行化：单连接（内存 / SQLite）必须自己排队，调用方不加锁。
    // 与 IndexedDB 的"重叠作用域事务被串行化"在可观察行为上一致。
    const result = this.txQueue.then(run, run);
    // 队列本身不能因为某次事务失败而中断
    this.txQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 构造事务句柄。`allowed` 里的 store 才可访问 —— 访问别的直接报错，不静默降级。 */
  private makeTx(allowed: string[]): DbTx {
    const assert = (store: string): PhysicalStore => {
      if (!allowed.includes(store)) {
        throw new Error(`store「${store}」不在本次事务的范围内：${allowed.join(', ')}`);
      }
      const s = this.stores.get(store);
      if (!s) {
        throw new Error(`未定义的 store：「${store}」`);
      }
      return s;
    };

    const findIndex = (store: PhysicalStore, indexName: string) => {
      const idx = store.schema.indexes?.find((i) => i.name === indexName);
      if (!idx) {
        throw new Error(`store「${store.schema.name}」上没有索引「${indexName}」`);
      }
      return idx;
    };

    /** 收集某记录在一个索引上的全部条目（multiEntry 会展开成多个）。 */
    const indexEntries = (
      store: PhysicalStore,
      idx: NonNullable<StoreSchema['indexes']>[number],
      value: Record<string, unknown>,
    ): (DbKey | DbKey[])[] => {
      /**
       * ⚠️ 这里**不能**直接用 `keyFromPath()`。
       *
       * `keyFromPath` 是给**主键**用的，它把数组值判为非法（主键只能是
       * string | number）。而 multiEntry 索引恰恰指向一个**数组字段**
       * （线上 `op.entityIds` 就是），于是它返回 `undefined` ——
       * 索引恒不命中，且**不报错**。契约测试第一次跑就把这个抓出来了。
       */
      if (typeof idx.keyPath === 'string') {
        const raw = valueAtPath(value, idx.keyPath);
        if (raw === undefined) return [];
        if (idx.multiEntry === true) {
          if (!Array.isArray(raw)) return [];
          return raw.filter((v) => typeof v === 'string' || typeof v === 'number') as DbKey[];
        }
        if (typeof raw !== 'string' && typeof raw !== 'number') return [];
        return [raw];
      }

      const composite = keyFromPath(value, idx.keyPath);
      if (composite === undefined) return [];
      if (idx.multiEntry === true && Array.isArray(composite)) {
        return composite.map((v) => v as DbKey);
      }
      return [composite];
    };

    const applyAction = (action: DbCursorAction, record: PhysicalRecord, store: PhysicalStore): 'continue' | 'stop' => {
      switch (action) {
        case 'continue':
          return 'continue';
        case 'stop':
          return 'stop';
        case 'delete':
          store.records.delete(serializeKey(record.key));
          return 'continue';
        case 'delete-stop':
          store.records.delete(serializeKey(record.key));
          return 'stop';
      }
    };

    const sortedRecords = (store: PhysicalStore): PhysicalRecord[] =>
      [...store.records.values()].sort((a, b) => compareKeys(a.key, b.key));

    /**
     * 插入一条记录。唯一冲突时抛 `DuplicateKeyError`（内部型别），
     * 由 `add` 直接抛出、由 `addToleratingDuplicate` 转成结果对象。
     *
     * 抽出来是为了让两个入口**共用同一套唯一性判定** ——
     * 各写一份必然漂移，而"容忍重复"与"不容忍重复"对唯一性的理解
     * 一旦不一致，去重就会变成碰运气。
     */
    const insert = (storeName: string, value: unknown): { key: number } => {
      const store = assert(storeName);
      const record = value as Record<string, unknown>;
      const keyPath = store.schema.keyPath;
      let key = keyPath === undefined ? undefined : keyFromPath(record, keyPath);

      if (key === undefined) {
        if (keyPath !== undefined && store.schema.autoIncrement !== true) {
          throw new Error(`store「${storeName}」的记录缺少主键字段「${String(keyPath)}」`);
        }
        key = ++store.autoIncrement;
        // 自增时把键写回记录，与 IndexedDB 的 in-line key 行为一致
        if (keyPath !== undefined) {
          const path = typeof keyPath === 'string' ? keyPath : keyPath[0];
          if (path !== undefined) record[path] = key;
        }
      } else if (typeof key === 'number' && key > store.autoIncrement) {
        store.autoIncrement = key;
      }

      // 🔴 唯一索引冲突要**阻止整条记录入库**，不是"跳过索引但留下记录"。
      // `addToleratingDuplicate` 依赖这个行为做幂等去重。
      for (const idx of store.schema.indexes ?? []) {
        if (idx.unique !== true) continue;
        for (const entry of indexEntries(store, idx, record)) {
          for (const existing of store.records.values()) {
            if (existing.key === key) continue;
            for (const otherEntry of indexEntries(store, idx, existing.value)) {
              if (compareKeys(entry, otherEntry) === 0) {
                throw new DuplicateKeyError(idx.name);
              }
            }
          }
        }
      }

      if (store.records.has(serializeKey(key))) {
        throw new DuplicateKeyError(String(keyPath ?? '主键'));
      }
      store.records.set(serializeKey(key), { key, value: record });
      return { key: typeof key === 'number' ? key : 0 };
    };

    return {
      add: async (storeName, value) => {
        const { key } = insert(storeName, value);
        return key;
      },

      /**
       * 容忍唯一冲突的插入。
       *
       * 语义与 IndexedDB 实现一致：冲突时**不抛错**，而是报告 `duplicate`，
       * 且**记录不入库**、事务继续。op-log 的幂等去重完全靠这个行为 ——
       * 同一个 opId 被重复投递是正常路径（同步会重放），不是异常。
       */
      addToleratingDuplicate: async (storeName, value) => {
        try {
          const { key } = insert(storeName, value);
          return { ok: true as const, key };
        } catch (error) {
          if (error instanceof DuplicateKeyError) {
            return { ok: false as const, reason: 'duplicate' as const };
          }
          throw error;
        }
      },
      put: async (storeName, value, explicitKey) => {
        const store = assert(storeName);
        const record = value as Record<string, unknown>;
        const keyPath = store.schema.keyPath;
        const key = explicitKey ?? (keyPath === undefined ? undefined : keyFromPath(record, keyPath));
        if (key === undefined) {
          throw new Error(`store「${storeName}」的 put 缺少主键`);
        }
        store.records.set(serializeKey(key), { key, value: record });
      },

      get: async <T,>(storeName: string, key: DbKey) => {
        const store = assert(storeName);
        return store.records.get(serializeKey(key))?.value as T | undefined;
      },

      getAll: async <T,>(storeName: string, range?: DbKeyRange, limit?: number) => {
        assertIterateLimit(limit);
        const store = assert(storeName);
        return sortedRecords(store)
          .filter((r) => inRange(r.key, range))
          .slice(0, limit)
          .map((r) => r.value as T);
      },

      delete: async (storeName, key) => {
        const store = assert(storeName);
        store.records.delete(serializeKey(key));
      },

      clear: async (storeName) => {
        const store = assert(storeName);
        store.records.clear();
      },

      count: async (storeName, range?: DbKeyRange) => {
        const store = assert(storeName);
        return [...store.records.values()].filter((r) => inRange(r.key, range)).length;
      },

      getFromIndex: async <T,>(storeName: string, indexName: string, key: DbKey | DbKey[]) => {
        const store = assert(storeName);
        const idx = findIndex(store, indexName);
        for (const r of sortedRecords(store)) {
          for (const entry of indexEntries(store, idx, r.value)) {
            if (compareKeys(entry, key) === 0) return r.value as T;
          }
        }
        return undefined;
      },

      getKeyFromIndex: async (storeName, indexName, key) => {
        const store = assert(storeName);
        const idx = findIndex(store, indexName);
        for (const r of sortedRecords(store)) {
          for (const entry of indexEntries(store, idx, r.value)) {
            if (compareKeys(entry, key) === 0) {
              // ⚠️ 复合主键的 store 这里实际是数组，而 `DbAdapter` 只声明了
              // `DbKey`。接口在这一处比 IndexedDB 的真实行为窄 —— 不扩大它，
              // 因为现有调用方（meta/ops）都用单键；在这里显式标注这个已知落差。
              return r.key as DbKey;
            }
          }
        }
        return undefined;
      },

      getAllFromIndex: async <T,>(storeName: string, indexName: string, query?: DbIndexQuery) => {
        const store = assert(storeName);
        const idx = findIndex(store, indexName);
        const out: T[] = [];
        for (const r of sortedRecords(store)) {
          for (const entry of indexEntries(store, idx, r.value)) {
            if (matchesIndexQuery(entry, query)) {
              out.push(r.value as T);
              break; // multiEntry 同一条记录只应出现一次
            }
          }
        }
        return out;
      },

      countFromIndex: async (storeName, indexName, query?: DbIndexQuery) => {
        const store = assert(storeName);
        const idx = findIndex(store, indexName);
        let n = 0;
        for (const r of sortedRecords(store)) {
          for (const entry of indexEntries(store, idx, r.value)) {
            if (matchesIndexQuery(entry, query)) {
              n++;
              break;
            }
          }
        }
        return n;
      },

      iterate: async <T,>(storeName: string, options: DbIterateOptions, visit: DbCursorVisitor<T>) => {
        const store = assert(storeName);

        // 与 IndexedDB 实现一致：非法 limit 立刻炸，不要等它扫全表把移动端卡死
        assertIterateLimit(options.limit);

        const { direction = 'next', lower, upper, limit, index } = options;
        let candidates: PhysicalRecord[];

        if (index === undefined) {
          candidates = sortedRecords(store).filter((r) => inRange(r.key, { lower, upper }));
        } else {
          const idx = findIndex(store, index);
          candidates = sortedRecords(store).filter((r) =>
            indexEntries(store, idx, r.value).some((entry) => inRange(entry, { lower, upper })),
          );
        }

        if (direction === 'prev') candidates.reverse();

        const cap = limit ?? DEFAULT_ITERATE_LIMIT;
        let visited = 0;
        for (const record of candidates) {
          if (visited >= cap) break;
          visited++;
          const action = visit(record.value as T, record.key as DbKey);
          if (applyAction(action, record, store) === 'stop') break;
        }
      },
    };
  }
}
