/**
 * SQLite 适配器 —— iOS / HarmonyOS 的生产存储实现，也用于 Node 端校验。
 *
 * 实现 {@link DbAdapter}，并且**必须通过与 IndexedDB / 内存实现完全相同的那一套
 * 共享契约**（`tests/contract/adapter.contract.ts`）。这是 ADR-0003 §2.2 的硬要求：
 * 换后端时上层一行不用改。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个必须处理对的设计点（都是"看起来能跑、其实错了"的形状）：
 *
 * 1. **🔴 键序必须与 IndexedDB 一致。**
 *    IndexedDB 的键序是 number < string < array。SQLite 默认的列比较恰好是
 *    数值 < 文本（存储类顺序），**但这只有在列没有 NUMERIC 亲和性时成立** ——
 *    若把主键列声明成 INTEGER/TEXT，SQLite 会把 `'123'` 这种文本键悄悄转成数字，
 *    于是 `meta` 的 `"key"` 与 `"123"` 会撞在一起。所以所有键列**不声明类型**
 *    （BLOB 亲和性，不做任何转换），让 SQLite 按值自身的存储类比较。
 *    复合键则拆成多列 `ORDER BY pk0, pk1`：逐列比较 = 数组逐元素比较，
 *    且每列内部的 number < string 与 IndexedDB 的元素类型序一致。
 *    故意**不用** JSON 字符串编码复合键 —— 那会把 `10` 排在 `2` 前面。
 *
 * 2. **事务必须是真的。** 单连接 SQLite 用 `BEGIN IMMEDIATE` / `COMMIT` /
 *    `ROLLBACK`，并且所有操作通过 FIFO 队列串行化（调用方永远不加锁）。
 *    回滚覆盖**已有记录的修改**：整条 DML 都在同一个 SQLite 事务里。
 *
 * 3. **唯一索引冲突时整条记录不入库。** 索引值直接作为主表的列 + 真正的
 *    `UNIQUE INDEX`，冲突发生在单条 INSERT 上 —— 不会留下"记录在、索引不在"
 *    的半截状态。`addToleratingDuplicate` 的去重语义依赖它。
 * ─────────────────────────────────────────────────────────────────────────
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
import type { SqlValue, SqliteDriver } from './sqlite-driver.js';

/** 落进 SQLite 的键分量。 */
type KeyValue = string | number;

/** 驱动返回的一行。 */
type SqlRow = Record<string, SqlValue>;

/** 标识符引用。store / index 名来自代码常量，但仍然一律引用，防止名字里出现关键字。 */
const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

/** 自增计数器的表名。独立于业务 store，避免污染 `ALL_STORES`。 */
const SEQ_TABLE = '__heyta_seq';

// ───────────────────────────────────────────────────────────────────────────
// 键比较 —— 必须与 IndexedDB 一致，语义与 `memory-adapter.ts` 相同。
// （内存实现里的 compareKeys 没有导出；这里复制一份而不是去改动它，
//  因为契约要求"实现之间可替换"，而不是"实现之间互相 import"。）
// ───────────────────────────────────────────────────────────────────────────

function keyRank(k: unknown): number {
  if (typeof k === 'number') return 0;
  if (typeof k === 'string') return 2;
  if (Array.isArray(k)) return 4;
  return 3;
}

function compareKeys(a: KeyValue | KeyValue[], b: KeyValue | KeyValue[]): number {
  if (Array.isArray(a) || Array.isArray(b)) {
    // 数组与标量不做逐元素比较，先按类型序排开
    if (Array.isArray(a) !== Array.isArray(b)) return keyRank(a) - keyRank(b);
    const arrA = a as KeyValue[];
    const arrB = b as KeyValue[];
    const len = Math.min(arrA.length, arrB.length);
    for (let i = 0; i < len; i++) {
      const diff = compareKeys(arrA[i]!, arrB[i]!);
      if (diff !== 0) return diff;
    }
    return arrA.length - arrB.length;
  }

  const rankDiff = keyRank(a) - keyRank(b);
  if (rankDiff !== 0) return rankDiff;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function keyInRange(key: KeyValue | KeyValue[], range?: DbKeyRange): boolean {
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

/** 沿点分路径取值（`op.id` 要能取到嵌套字段）。 */
function valueAtPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** 自增时把键写回记录（in-line key），与 IndexedDB / 内存实现一致。 */
function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const next = current[segment];
    if (next === null || typeof next !== 'object') current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = value;
}

function isKeyValue(v: unknown): v is KeyValue {
  return typeof v === 'string' || typeof v === 'number';
}

// ───────────────────────────────────────────────────────────────────────────
// schema → 物理计划
// ───────────────────────────────────────────────────────────────────────────

interface IndexPlan {
  name: string;
  /** 主表中承载索引值的列（multiEntry 没有内联列）。 */
  columns: string[];
  multiEntry: boolean;
  unique: boolean;
  /** multiEntry 的子表（一条记录一条索引项的展开结果）。 */
  childTable?: string;
  childIndex?: string;
  /** 归一化后的 keyPath 分量。 */
  paths: string[];
}

interface StorePlan {
  schema: StoreSchema;
  table: string;
  pkColumns: string[];
  pkPaths: string[];
  dataColumn: string;
  indexes: IndexPlan[];
  byName: Map<string, IndexPlan>;
}

function buildStorePlan(schema: StoreSchema): StorePlan {
  const table = schema.name;
  const pkPaths = typeof schema.keyPath === 'string' ? [schema.keyPath] : [...schema.keyPath];
  const pkColumns = pkPaths.map((_p, i) => `pk${i}`);

  const indexes: IndexPlan[] = [];
  const byName = new Map<string, IndexPlan>();

  (schema.indexes ?? []).forEach((index, ordinal) => {
    const paths = typeof index.keyPath === 'string' ? [index.keyPath] : [...index.keyPath];
    if (index.multiEntry === true && paths.length !== 1) {
      // IndexedDB 本身也禁止 multiEntry 使用数组 keyPath（InvalidAccessError）。
      // 与其静默按内存实现的"展开数组"语义跑，不如在这里明确拒绝。
      throw new Error(
        `索引「${index.name}」：multiEntry 只支持单个 keyPath，收到 ${JSON.stringify(index.keyPath)}`,
      );
    }
    const plan: IndexPlan = {
      name: index.name,
      multiEntry: index.multiEntry === true,
      unique: index.unique === true,
      paths,
      columns: index.multiEntry === true ? [] : paths.map((_p, i) => `ix${ordinal}_${i}`),
      childTable: index.multiEntry === true ? `${table}__mt${ordinal}` : undefined,
      childIndex: index.multiEntry === true ? `${table}__mt${ordinal}_elem` : undefined,
    };
    indexes.push(plan);
    byName.set(plan.name, plan);
  });

  return { schema, table, pkColumns, pkPaths, dataColumn: 'data', indexes, byName };
}

class SqliteAdapter implements DbAdapter {
  private readonly plans: StorePlan[] = [];
  private readonly planByName = new Map<string, StorePlan>();
  private driver: SqliteDriver | undefined;
  private opening: Promise<SqliteDriver> | undefined;

  /**
   * FIFO 队列。单连接 SQLite 不能并发跑事务，所以适配器自己排队 ——
   * 这正是 `DbAdapter` 契约"调用方不需要加锁"的落地方式。
   */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * 嵌套检测只覆盖**同步前缀**，取舍与理由同 `memory-adapter.ts`：
   * 用一个全局布尔会把**并发**也当成嵌套拦下来，而并发是契约明确要求的合法用法。
   */
  private syncDepth = 0;

  /**
   * ⚠️ 注入的是驱动**工厂**而不是驱动实例。原因：`DbAdapter.close()` 要求
   * "后续操作透明重开"，而一个已 `close()` 的驱动实例无法复活。
   * 工厂让 close → 重开成立（原生端每次重开注入新的句柄）。
   */
  private readonly driverFactory: () => SqliteDriver;

  constructor(options: SqliteAdapterOptions) {
    this.driverFactory = options.driverFactory;
    for (const schema of options.schema) {
      const plan = buildStorePlan(schema);
      this.plans.push(plan);
      this.planByName.set(plan.table, plan);
    }
  }

  // ── 生命周期 ──────────────────────────────────────────────

  init(): Promise<void> {
    return this.ensureOpen().then(() => undefined);
  }

  close(): void {
    this.driver?.close();
    this.driver = undefined;
    this.opening = undefined;
  }

  /** 打开连接并建 schema。幂等（`CREATE ... IF NOT EXISTS`），可并发调用。 */
  private ensureOpen(): Promise<SqliteDriver> {
    if (this.driver !== undefined) return Promise.resolve(this.driver);
    if (this.opening !== undefined) return this.opening;
    this.opening = Promise.resolve().then(() => {
      const driver = this.driverFactory();
      try {
        this.createSchema(driver);
      } catch (error) {
        driver.close();
        this.opening = undefined;
        throw error;
      }
      this.driver = driver;
      return driver;
    });
    return this.opening;
  }

  private createSchema(driver: SqliteDriver): void {
    for (const plan of this.plans) {
      const definitions = [
        // 键列/索引列故意**不声明类型** → BLOB 亲和性 → 不做数值转换。
        ...plan.pkColumns.map((c) => q(c)),
        ...plan.indexes
          .filter((i) => !i.multiEntry)
          .flatMap((i) => i.columns.map((c) => q(c))),
        `${q(plan.dataColumn)} TEXT NOT NULL`,
        `PRIMARY KEY (${plan.pkColumns.map(q).join(', ')})`,
      ];
      driver.exec(
        `CREATE TABLE IF NOT EXISTS ${q(plan.table)} (${definitions.join(', ')})`,
      );

      for (const index of plan.indexes) {
        if (index.multiEntry) {
          driver.exec(
            `CREATE TABLE IF NOT EXISTS ${q(index.childTable!)} (${[
              ...plan.pkColumns.map((c) => q(c)),
              '"elem"',
            ].join(', ')})`,
          );
          driver.exec(
            `CREATE INDEX IF NOT EXISTS ${q(index.childIndex!)} ON ${q(index.childTable!)} ("elem")`,
          );
          continue;
        }
        const unique = index.unique ? 'UNIQUE ' : '';
        driver.exec(
          `CREATE ${unique}INDEX IF NOT EXISTS ${q(`${plan.table}__i${index.columns[0]}`)} ` +
            `ON ${q(plan.table)} (${index.columns.map(q).join(', ')})`,
        );
      }
    }

    driver.exec(
      `CREATE TABLE IF NOT EXISTS ${q(SEQ_TABLE)} ("store" TEXT PRIMARY KEY, "next" INTEGER NOT NULL)`,
    );
  }

  // ── 事务 ─────────────────────────────────────────────────

  transaction<T>(
    stores: string[],
    _mode: DbTxMode,
    fn: (tx: DbTx) => Promise<T>,
  ): Promise<T> {
    if (this.syncDepth > 0) {
      throw new Error('不支持嵌套事务：在事务里又调用了 transaction()');
    }
    // 提前同步校验，让"store 拼错/未列入"立刻炸，而不是排到队尾才炸
    for (const name of stores) {
      if (!this.planByName.has(name)) {
        throw new Error(
          `事务访问了未定义的 store：「${name}」。已定义：${[...this.planByName.keys()].join(', ')}`,
        );
      }
    }

    const run = async (): Promise<T> => {
      const driver = await this.ensureOpen();
      driver.exec('BEGIN IMMEDIATE');
      let pending: Promise<T>;
      this.syncDepth++;
      try {
        pending = fn(this.makeTx(stores, driver));
      } catch (error) {
        // fn 的同步前缀就抛了：回滚后原样抛出
        this.syncDepth--;
        try {
          driver.exec('ROLLBACK');
        } catch {
          // 已回滚
        }
        throw error;
      }
      this.syncDepth--;
      try {
        const result = await pending;
        driver.exec('COMMIT');
        return result;
      } catch (error) {
        // 🔴 这是"取消已提交修改"的唯一正确做法：整个 SQLite 事务回滚。
        // 只删新插入的行是不够的 —— 已有记录被改动时不会恢复。
        try {
          driver.exec('ROLLBACK');
        } catch {
          // 连接可能已坏，别让 rollback 的失败盖住原始错误
        }
        throw error;
      }
    };

    const result = this.queue.then(run, run);
    // 队列不能因为某次事务失败而中断
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // ── 顶层便捷方法：各自包一个单 store 事务 ────────────────

  add(store: string, value: unknown): Promise<number> {
    return this.transaction([store], 'readwrite', (tx) => tx.add(store, value));
  }

  put(store: string, value: unknown, key?: DbKey): Promise<void> {
    return this.transaction([store], 'readwrite', (tx) => tx.put(store, value, key));
  }

  get<T>(store: string, key: DbKey): Promise<T | undefined> {
    return this.transaction([store], 'readonly', (tx) => tx.get<T>(store, key));
  }

  getAll<T>(store: string, range?: DbKeyRange): Promise<T[]> {
    return this.transaction([store], 'readonly', (tx) => tx.getAll<T>(store, range));
  }

  delete(store: string, key: DbKey): Promise<void> {
    return this.transaction([store], 'readwrite', (tx) => tx.delete(store, key));
  }

  clear(store: string): Promise<void> {
    return this.transaction([store], 'readwrite', (tx) => tx.clear(store));
  }

  count(store: string, range?: DbKeyRange): Promise<number> {
    return this.transaction([store], 'readonly', (tx) => tx.count(store, range));
  }

  getFromIndex<T>(store: string, index: string, key: DbKey | DbKey[]): Promise<T | undefined> {
    return this.transaction([store], 'readonly', (tx) => tx.getFromIndex<T>(store, index, key));
  }

  getKeyFromIndex(store: string, index: string, key: DbKey | DbKey[]): Promise<DbKey | undefined> {
    return this.transaction([store], 'readonly', (tx) => tx.getKeyFromIndex(store, index, key));
  }

  getAllFromIndex<T>(store: string, index: string, query?: DbIndexQuery): Promise<T[]> {
    return this.transaction([store], 'readonly', (tx) =>
      tx.getAllFromIndex<T>(store, index, query),
    );
  }

  countFromIndex(store: string, index: string, query?: DbIndexQuery): Promise<number> {
    return this.transaction([store], 'readonly', (tx) => tx.countFromIndex(store, index, query));
  }

  iterate<T>(
    store: string,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void> {
    // readwrite 而不是 readonly：访问者可返回 'delete' / 'delete-stop'
    return this.transaction([store], 'readwrite', (tx) => tx.iterate<T>(store, options, visit));
  }

  private makeTx(allowed: string[], driver: SqliteDriver): DbTx {
    const assert = (store: string): StorePlan => {
      if (!allowed.includes(store)) {
        throw new Error(
          `store「${store}」不在本次事务的范围内：${allowed.join(', ')}`,
        );
      }
      const plan = this.planByName.get(store);
      if (plan === undefined) throw new Error(`未定义的 store：「${store}」`);
      return plan;
    };

    const findIndex = (plan: StorePlan, indexName: string): IndexPlan => {
      const index = plan.byName.get(indexName);
      if (index === undefined) {
        throw new Error(`store「${plan.table}」上没有索引「${indexName}」`);
      }
      return index;
    };

    /**
     * 插入一条记录，返回分配的键。唯一冲突由调用方决定如何处理。
     *
     * ⚠️ 自增计数器**在 INSERT 成功之后**才落盘。若插入前就递增，
     * `addToleratingDuplicate` 吞掉重复项时会留下 seq 空洞 ——
     * 而 seq 是同步游标的基础，空洞 = 增量同步永久漏数据。
     */
    const insertRecord = (storeName: string, value: unknown): { key: number; pk: KeyValue[] } => {
      const plan = assert(storeName);
      const record = value as Record<string, unknown>;
      const recordKey = this.readRecordKey(plan, record);
      let pk: KeyValue[];
      let allocated: number | undefined;

      if (recordKey === undefined) {
        if (plan.schema.autoIncrement !== true) {
          throw new Error(
            `store「${storeName}」的记录缺少主键字段「${plan.pkPaths.join(', ')}」`,
          );
        }
        allocated = this.peekAutoIncrement(driver, plan);
        pk = [allocated];
        // 与 IndexedDB / 内存实现一致：自增键写回记录本身（in-line key）
        setAtPath(record, plan.pkPaths[0]!, allocated);
      } else {
        pk = recordKey;
      }

      // 单条 INSERT：唯一索引冲突整条失败，不留半截数据
      this.insertRow(driver, plan, pk, record);

      if (allocated !== undefined) {
        this.writeSeq(driver, plan, allocated);
      } else if (plan.schema.autoIncrement === true && typeof pk[0] === 'number') {
        this.bumpAutoIncrement(driver, plan, pk[0]);
      }
      return { key: typeof pk[0] === 'number' ? pk[0] : 0, pk };
    };

    return {
      add: async (storeName, value) => insertRecord(storeName, value).key,

      /**
       * 容忍唯一冲突的插入（`DbTx` 接口要求，op-log 幂等去重的核心）。
       *
       * SQLite 里单条约束冲突**不会**中止整个事务（这点与 IndexedDB 相反 ——
       * IndexedDB 必须 `preventDefault()` 才不中止事务），所以直接捕获即可，
       * 后续语句与 COMMIT 仍能正常执行。
       */
      addToleratingDuplicate: async (storeName, value) => {
        try {
          const { key } = insertRecord(storeName, value);
          return { ok: true as const, key };
        } catch (error) {
          if (this.isUniqueViolation(driver, error)) {
            return { ok: false as const, reason: 'duplicate' as const };
          }
          throw error;
        }
      },

      put: async (storeName, value, explicitKey) => {
        const plan = assert(storeName);
        const record = value as Record<string, unknown>;
        const pk = this.normalizeExplicitKey(plan, explicitKey) ?? this.readRecordKey(plan, record);
        if (pk === undefined) {
          throw new Error(`store「${storeName}」的 put 缺少主键`);
        }
        // 先删后插：原子性由外层 SQLite 事务保证；这样 child（multiEntry）
        // 的旧索引项也一定被清掉，不会留下指向已改记录的幽灵条目。
        this.deleteRow(driver, plan, pk);
        this.insertRow(driver, plan, pk, record);
      },

      get: async <T,>(storeName: string, key: DbKey) => {
        const plan = assert(storeName);
        const pk = this.normalizeExplicitKey(plan, key);
        if (pk === undefined) return undefined;
        const rows = driver.all<SqlRow>(
          `SELECT ${q(plan.dataColumn)} FROM ${q(plan.table)} WHERE ${pkWhere(plan)}`,
          pk,
        );
        return rows.length === 0 ? undefined : (JSON.parse(String(rows[0]![plan.dataColumn])) as T);
      },

      getAll: async <T,>(storeName: string, range?: DbKeyRange) => {
        const plan = assert(storeName);
        return this.fetchRecords(driver, plan, range).map((r) => r.data as T);
      },

      delete: async (storeName, key) => {
        const plan = assert(storeName);
        const pk = this.normalizeExplicitKey(plan, key);
        if (pk === undefined) return;
        this.deleteRow(driver, plan, pk);
      },

      clear: async (storeName) => {
        const plan = assert(storeName);
        driver.run(`DELETE FROM ${q(plan.table)}`);
        for (const index of plan.indexes) {
          if (index.multiEntry) driver.run(`DELETE FROM ${q(index.childTable!)}`);
        }
      },

      count: async (storeName, range?: DbKeyRange) => {
        const plan = assert(storeName);
        // 复合主键的区间在 JS 里过滤（见 fetchRecords），所以这里统一走 count 逻辑
        if (plan.pkColumns.length === 1 && range !== undefined) {
          const params: SqlValue[] = [];
          const where = rangeConditions(q(plan.pkColumns[0]!), range, params);
          const rows = driver.all<SqlRow>(
            `SELECT COUNT(*) AS n FROM ${q(plan.table)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`,
            params,
          );
          return Number(rows[0]?.['n'] ?? 0);
        }
        return this.fetchRecords(driver, plan, range).length;
      },

      getFromIndex: async <T,>(storeName: string, indexName: string, key: DbKey | DbKey[]) => {
        const plan = assert(storeName);
        const index = findIndex(plan, indexName);
        const records = this.fetchIndexRecords(driver, plan, index, key);
        return records.length === 0 ? undefined : (records[0]!.data as T);
      },

      getKeyFromIndex: async (storeName, indexName, key) => {
        const plan = assert(storeName);
        const index = findIndex(plan, indexName);
        const records = this.fetchIndexRecords(driver, plan, index, key);
        return records.length === 0 ? undefined : toDbKey(plan, records[0]!.pk);
      },

      getAllFromIndex: async <T,>(storeName: string, indexName: string, query?: DbIndexQuery) => {
        const plan = assert(storeName);
        const index = findIndex(plan, indexName);
        return this.fetchIndexRecords(driver, plan, index, query).map((r) => r.data as T);
      },

      countFromIndex: async (storeName, indexName, query?: DbIndexQuery) => {
        const plan = assert(storeName);
        const index = findIndex(plan, indexName);
        return this.fetchIndexRecords(driver, plan, index, query).length;
      },

      iterate: async <T,>(
        storeName: string,
        options: DbIterateOptions,
        visit: DbCursorVisitor<T>,
      ) => {
        const plan = assert(storeName);
        assertIterateLimit(options.limit);

        const { direction = 'next', lower, upper, limit, index } = options;
        let records: PhysicalRecord[];
        if (index === undefined) {
          records = this.fetchRecords(driver, plan, { lower, upper });
        } else {
          const indexPlan = findIndex(plan, index);
          records = this.fetchIndexRecords(driver, plan, indexPlan, { lower, upper });
        }
        if (direction === 'prev') records.reverse();

        const cap = limit ?? DEFAULT_ITERATE_LIMIT;
        let visited = 0;
        for (const record of records) {
          if (visited >= cap) break;
          visited++;
          const action: DbCursorAction = visit(record.data as T, toDbKey(plan, record.pk));
          if (action === 'delete' || action === 'delete-stop') {
            this.deleteRow(driver, plan, record.pk);
          }
          if (action === 'stop' || action === 'delete-stop') break;
        }
      },
    };
  }

  // ── 物理操作 ─────────────────────────────────────────────

  private readRecordKey(plan: StorePlan, record: Record<string, unknown>): KeyValue[] | undefined {
    const out: KeyValue[] = [];
    for (const path of plan.pkPaths) {
      const v = valueAtPath(record, path);
      if (!isKeyValue(v)) return undefined;
      out.push(v);
    }
    return out;
  }

  private normalizeExplicitKey(plan: StorePlan, key: DbKey | DbKey[] | undefined): KeyValue[] | undefined {
    if (key === undefined) return undefined;
    const parts = Array.isArray(key) ? key : [key];
    if (parts.length !== plan.pkColumns.length) return undefined;
    if (!parts.every(isKeyValue)) return undefined;
    return parts;
  }

  /**
   * 计算下一个自增键，但**不落盘**（插入成功后才由调用方写回计数器）。
   * 同时参考计数器与表内 MAX，避免计数器表丢失后回退复用旧键。
   */
  private peekAutoIncrement(driver: SqliteDriver, plan: StorePlan): number {
    const seqRow = driver.all<SqlRow>(
      `SELECT "next" FROM ${q(SEQ_TABLE)} WHERE "store" = ?`,
      [plan.table],
    )[0];
    const stored = seqRow === undefined ? 0 : Number(seqRow['next']);
    const maxRow = driver.all<SqlRow>(
      `SELECT MAX(${q(plan.pkColumns[0]!)}) AS "m" FROM ${q(plan.table)}`,
    )[0];
    const maxPk = maxRow !== undefined && typeof maxRow['m'] === 'number' ? maxRow['m'] : 0;
    return Math.max(stored, maxPk) + 1;
  }

  /** 判定异常是否为唯一约束冲突；驱动可选择精确实现。 */
  private isUniqueViolation(driver: SqliteDriver, error: unknown): boolean {
    if (driver.isUniqueViolation !== undefined) return driver.isUniqueViolation(error);
    return defaultIsUniqueViolation(error);
  }

  private bumpAutoIncrement(driver: SqliteDriver, plan: StorePlan, key: number): void {
    const seqRow = driver.all<SqlRow>(
      `SELECT "next" FROM ${q(SEQ_TABLE)} WHERE "store" = ?`,
      [plan.table],
    )[0];
    const stored = seqRow === undefined ? 0 : Number(seqRow['next']);
    if (key > stored) this.writeSeq(driver, plan, key);
  }

  private writeSeq(driver: SqliteDriver, plan: StorePlan, next: number): void {
    driver.run(
      `INSERT OR REPLACE INTO ${q(SEQ_TABLE)} ("store", "next") VALUES (?, ?)`,
      [plan.table, next],
    );
  }

  private insertRow(
    driver: SqliteDriver,
    plan: StorePlan,
    pk: KeyValue[],
    record: Record<string, unknown>,
  ): void {
    const columns = [...plan.pkColumns];
    const values: SqlValue[] = [...pk];

    for (const index of plan.indexes) {
      if (index.multiEntry) continue;
      const entry = inlineIndexValues(index, record);
      for (let i = 0; i < index.columns.length; i++) {
        columns.push(index.columns[i]!);
        values.push(entry === undefined ? null : entry[i]!);
      }
    }

    columns.push(plan.dataColumn);
    values.push(JSON.stringify(record));

    driver.run(
      `INSERT INTO ${q(plan.table)} (${columns.map(q).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      values,
    );

    for (const index of plan.indexes) {
      if (!index.multiEntry) continue;
      for (const element of multiEntryValues(index, record)) {
        driver.run(
          `INSERT INTO ${q(index.childTable!)} (${[
            ...plan.pkColumns.map(q),
            '"elem"',
          ].join(', ')}) VALUES (${[...plan.pkColumns.map(() => '?'), '?'].join(', ')})`,
          [...pk, element],
        );
      }
    }
  }

  private deleteRow(driver: SqliteDriver, plan: StorePlan, pk: KeyValue[]): void {
    driver.run(`DELETE FROM ${q(plan.table)} WHERE ${pkWhere(plan)}`, pk);
    for (const index of plan.indexes) {
      if (index.multiEntry) {
        driver.run(`DELETE FROM ${q(index.childTable!)} WHERE ${pkWhere(plan)}`, pk);
      }
    }
  }

  private fetchRecords(
    driver: SqliteDriver,
    plan: StorePlan,
    range?: DbKeyRange,
  ): PhysicalRecord[] {
    const params: SqlValue[] = [];
    let where = '';
    // 单列主键：区间下推到 SQL（ops 的 seq 区间是最热的查询）。
    // 复合主键：SQL ORDER BY pk 后按逐元素比较在 JS 里过滤 —— 结果顺序与
    // IndexedDB 的"按主键升序"一致，且不会把 `10` 排在 `2` 前。
    const pushDown = plan.pkColumns.length === 1 && range !== undefined;
    if (pushDown) {
      const conditions = rangeConditions(q(plan.pkColumns[0]!), range!, params);
      if (conditions.length > 0) where = ` WHERE ${conditions.join(' AND ')}`;
    }

    const rows = driver.all<SqlRow>(
      `SELECT * FROM ${q(plan.table)}${where} ORDER BY ${orderByPk(plan)}`,
      params,
    );

    const projected = rows.map((row) => this.toPhysicalRecord(plan, row));
    return pushDown ? projected : projected.filter((r) => keyInRange(r.pk, range));
  }

  private fetchIndexRecords(
    driver: SqliteDriver,
    plan: StorePlan,
    index: IndexPlan,
    query?: DbIndexQuery,
  ): PhysicalRecord[] {
    if (index.multiEntry) {
      const params: SqlValue[] = [];
      const conditions: string[] = [];
      if (query !== undefined) {
        if (isKeyValue(query)) {
          conditions.push('c."elem" = ?');
          params.push(query);
          // multiEntry 的索引项永远是标量，数组/复合查询不可能命中
        } else if (Array.isArray(query)) {
          return [];
        } else {
          conditions.push(...rangeConditions('c."elem"', query, params));
        }
      }
      const extra = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
      const rows = driver.all<SqlRow>(
        `SELECT s.* FROM ${q(plan.table)} s ` +
          `WHERE EXISTS (SELECT 1 FROM ${q(index.childTable!)} c ` +
          `WHERE ${joinOnPk('c', 's', plan)}${extra}) ` +
          `ORDER BY ${orderByPk(plan, 's')}`,
        params,
      );
      return rows.map((row) => this.toPhysicalRecord(plan, row));
    }

    const params: SqlValue[] = [];
    const conditions: string[] = [];

    if (query === undefined) {
      // 索引键缺失的记录在 IndexedDB 里**没有索引项**，全索引扫描不该带出它们。
      for (const column of index.columns) conditions.push(`${q(column)} IS NOT NULL`);
    } else if (isKeyValue(query)) {
      if (index.columns.length !== 1) return [];
      conditions.push(`${q(index.columns[0]!)} = ?`);
      params.push(query);
    } else if (Array.isArray(query)) {
      if (query.length !== index.columns.length) return [];
      index.columns.forEach((column, i) => {
        conditions.push(`${q(column)} = ?`);
        params.push(query[i]!);
      });
    } else if (index.columns.length === 1) {
      conditions.push(...rangeConditions(q(index.columns[0]!), query, params));
    } else {
      // 复合索引的区间查询：取回后按元组逐元素比较过滤（与内存实现一致，
      // 且不必手写 SQL 的字典序元组比较）。
      for (const column of index.columns) conditions.push(`${q(column)} IS NOT NULL`);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = driver.all<SqlRow>(
      `SELECT * FROM ${q(plan.table)}${where} ORDER BY ${orderByPk(plan)}`,
      params,
    );

    let projected = rows.map((row) => this.toPhysicalRecord(plan, row));
    if (
      query !== undefined &&
      !isKeyValue(query) &&
      !Array.isArray(query) &&
      index.columns.length > 1
    ) {
      projected = projected.filter((r) =>
        keyInRange(
          index.columns.map((c) => r.row[c] as KeyValue),
          query,
        ),
      );
    }
    return projected;
  }

  private toPhysicalRecord(plan: StorePlan, row: SqlRow): PhysicalRecord {
    return {
      data: JSON.parse(String(row[plan.dataColumn])),
      pk: plan.pkColumns.map((c) => row[c] as KeyValue),
      row,
    };
  }
}

interface PhysicalRecord {
  data: unknown;
  pk: KeyValue[];
  /** 原始行，留给"复合索引区间"这类需要回看索引列的过滤。 */
  row: SqlRow;
}

// ───────────────────────────────────────────────────────────────────────────
// SQL 片段生成
// ───────────────────────────────────────────────────────────────────────────

/**
 * 驱动的默认"唯一冲突"判定。
 *
 * SQLite 的扩展结果码 1555 / 2067 分别对应主键冲突与唯一索引冲突，
 * 文本是标准的 `UNIQUE constraint failed: ...`。原生绑定多数会透出其中之一。
 * 若绑定两者都不给，应实现 `SqliteDriver.isUniqueViolation` 精确覆盖。
 */
function defaultIsUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { errcode?: unknown; code?: unknown; message?: unknown };
  for (const code of [candidate.errcode, candidate.code]) {
    if (typeof code === 'number' && (code === 1555 || code === 2067)) return true;
  }
  return (
    typeof candidate.message === 'string' &&
    /UNIQUE constraint failed/i.test(candidate.message)
  );
}

function pkWhere(plan: StorePlan, alias?: string): string {
  const prefix = alias === undefined ? '' : `${alias}.`;
  return plan.pkColumns.map((c) => `${prefix}${q(c)} = ?`).join(' AND ');
}

function joinOnPk(left: string, right: string, plan: StorePlan): string {
  return plan.pkColumns.map((c) => `${left}.${q(c)} = ${right}.${q(c)}`).join(' AND ');
}

function orderByPk(plan: StorePlan, alias?: string): string {
  const prefix = alias === undefined ? '' : `${alias}.`;
  return plan.pkColumns.map((c) => `${prefix}${q(c)}`).join(', ');
}

function rangeConditions(column: string, range: DbKeyRange, params: SqlValue[]): string[] {
  const conditions: string[] = [];
  if (range.lower !== undefined) {
    conditions.push(`${column} ${range.lowerOpen === true ? '>' : '>='} ?`);
    params.push(range.lower);
  }
  if (range.upper !== undefined) {
    conditions.push(`${column} ${range.upperOpen === true ? '<' : '<='} ?`);
    params.push(range.upper);
  }
  return conditions;
}

/** 内联索引值；任一分量缺失/非键 → 没有索引项（返回 undefined → 存 NULL）。 */
function inlineIndexValues(
  index: IndexPlan,
  record: Record<string, unknown>,
): KeyValue[] | undefined {
  const out: KeyValue[] = [];
  for (const path of index.paths) {
    const v = valueAtPath(record, path);
    if (!isKeyValue(v)) return undefined;
    out.push(v);
  }
  return out;
}

/** multiEntry 索引项：数组字段展开，同一记录内重复元素去重（IndexedDB 语义）。 */
function multiEntryValues(index: IndexPlan, record: Record<string, unknown>): KeyValue[] {
  const raw = valueAtPath(record, index.paths[0]!);
  if (!Array.isArray(raw)) return [];
  const out: KeyValue[] = [];
  for (const v of raw) {
    if (isKeyValue(v) && !out.some((existing) => compareKeys(existing, v) === 0)) out.push(v);
  }
  return out;
}

function toDbKey(plan: StorePlan, pk: KeyValue[]): DbKey {
  // ⚠️ 复合主键时这里实际是数组，而 `DbAdapter` 只声明了 `DbKey`。
  // 与内存实现一样，在边界处收窄；现有调用方都走单键。
  return (plan.pkColumns.length === 1 ? pk[0]! : (pk as unknown as DbKey)) as DbKey;
}

export interface SqliteAdapterOptions {
  schema: readonly StoreSchema[];
  /** 见构造函数说明：注入**工厂**，让 `close()` 后的透明重开成立。 */
  driverFactory: () => SqliteDriver;
}

export { SqliteAdapter };
