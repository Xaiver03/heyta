/**
 * 底层数据库抽象。
 *
 * 设计参考了 Super Productivity 的 `src/app/op-log/persistence/op-log-db-adapter.ts`（MIT）
 * —— 但这是 heyta 自己的实现，不是搬运。参考的核心是**两条架构判断**：
 *
 * 1. **适配器自己负责并发串行化，调用方永远不需要加锁。**
 *    IndexedDB 原生就会把作用域重叠的事务串行化，作用域不相交的可以并发；
 *    而单连接的 SQLite 必须内部串行化。把这个差异**关在适配器内部**，
 *    上层代码才能对"用哪个存储"完全无感。
 *
 * 2. **接口只暴露最小必要操作**，不做 ORM。
 *    待办应用的数据访问模式很集中，一个键值 + 索引的抽象就够；
 *    过早引入 ORM 会把存储选择锁死。
 *
 * 目标：**换存储实现时，上层一行都不用改。**
 */

/** 主键类型。IndexedDB 允许 string | number，SQLite 亦然。 */
export type DbKey = string | number;

/** 主键区间（闭开区间，与 IndexedDB 的 IDBKeyRange 语义一致）。 */
export interface DbKeyRange {
  lower?: DbKey;
  upper?: DbKey;
  lowerOpen?: boolean;
  upperOpen?: boolean;
}

/** 索引查询：既可以是区间，也可以是精确键列表。 */
export type DbIndexQuery = DbKeyRange | DbKey[];

export type DbTxMode = 'readonly' | 'readwrite';

export type DbCursorDirection = 'next' | 'prev';

/** 游标访问者的返回值，决定下一步动作。 */
export type DbCursorAction = 'continue' | 'stop' | 'delete' | 'delete-stop';

export type DbCursorVisitor<T> = (value: T, key: DbKey) => DbCursorAction;

export interface DbIterateOptions {
  direction?: DbCursorDirection;
  /** 从该键开始（含）。 */
  lower?: DbKey;
  /** 到该键结束（含）。 */
  upper?: DbKey;
  /** 最多访问多少条。 */
  limit?: number;
  /** 走哪个索引；不传则走主键。 */
  index?: string;
}

/**
 * 事务句柄。只有通过 {@link DbAdapter.transaction} 列出的 store 才能被访问。
 *
 * ⚠️ 本接口**不提供嵌套事务**。嵌套 `transaction` 调用是调用方的 bug，
 * 适配器应抛错而不是静默降级。
 */
export interface DbTx {
  add(store: string, value: unknown): Promise<number>;
  put(store: string, value: unknown, key?: DbKey): Promise<void>;
  get<T>(store: string, key: DbKey): Promise<T | undefined>;
  getAll<T>(store: string, range?: DbKeyRange): Promise<T[]>;
  delete(store: string, key: DbKey): Promise<void>;
  clear(store: string): Promise<void>;
  count(store: string, range?: DbKeyRange): Promise<number>;

  getFromIndex<T>(store: string, index: string, key: DbKey | DbKey[]): Promise<T | undefined>;
  getKeyFromIndex(store: string, index: string, key: DbKey | DbKey[]): Promise<DbKey | undefined>;
  getAllFromIndex<T>(store: string, index: string, query?: DbIndexQuery): Promise<T[]>;
  countFromIndex(store: string, index: string, query?: DbIndexQuery): Promise<number>;

  iterate<T>(store: string, options: DbIterateOptions, visit: DbCursorVisitor<T>): Promise<void>;
}

/**
 * 存储适配器。IndexedDB、SQLite 等实现此接口。
 *
 * 并发契约（**重要**）：所有方法都必须**可安全并发调用**。
 * 实现方要么依赖 IndexedDB 的原生事务语义，要么在内部用 FIFO 队列串行化
 * （单连接 SQLite）。**调用方不需要在自己这一层加锁。**
 */
export interface DbAdapter {
  /** 打开/创建数据库。幂等，且可安全并发调用。 */
  init(): Promise<void>;

  /** 关闭连接。后续操作会透明地重新打开。 */
  close(): void;

  // ── 基础键值操作 ──────────────────────────────────────────
  add(store: string, value: unknown): Promise<number>;
  put(store: string, value: unknown, key?: DbKey): Promise<void>;
  get<T>(store: string, key: DbKey): Promise<T | undefined>;
  getAll<T>(store: string, range?: DbKeyRange): Promise<T[]>;
  delete(store: string, key: DbKey): Promise<void>;
  clear(store: string): Promise<void>;
  count(store: string, range?: DbKeyRange): Promise<number>;

  // ── 索引操作 ─────────────────────────────────────────────
  getFromIndex<T>(store: string, index: string, key: DbKey | DbKey[]): Promise<T | undefined>;
  getKeyFromIndex(store: string, index: string, key: DbKey | DbKey[]): Promise<DbKey | undefined>;
  getAllFromIndex<T>(store: string, index: string, query?: DbIndexQuery): Promise<T[]>;
  countFromIndex(store: string, index: string, query?: DbIndexQuery): Promise<number>;

  // ── 游标 ────────────────────────────────────────────────
  iterate<T>(store: string, options: DbIterateOptions, visit: DbCursorVisitor<T>): Promise<void>;

  // ── 事务 ────────────────────────────────────────────────
  /**
   * 在 `stores` 上执行单个原子事务。
   * 返回的 Promise 决议时提交，拒绝时回滚。
   */
  transaction<T>(stores: string[], mode: DbTxMode, fn: (tx: DbTx) => Promise<T>): Promise<T>;
}

/**
 * 断言 `iterate` 的 limit 合法。
 *
 * 存在的理由：无上限的游标遍历是移动端卡死的常见原因，
 * 让它**在开发期就炸**，而不是等线上用户报"应用打开就卡住"。
 */
export const assertIterateLimit = (limit?: number): void => {
  if (limit === undefined) return;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`iterate limit 必须是正整数，收到：${String(limit)}`);
  }
};

/** 默认遍历上限。防止漏传 limit 时扫全表。 */
export const DEFAULT_ITERATE_LIMIT = 10_000;
