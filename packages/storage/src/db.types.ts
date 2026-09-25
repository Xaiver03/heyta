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

/**
 * store / 索引的**声明形状**。所有实现共用同一份 —— 不是各实现各写一份。
 *
 * 🔴 抽出它的理由：如果 IndexedDB 与 SQLite 各自定义自己的 schema 类型，
 * "同一套契约测试跑遍所有实现"就无从谈起 —— 连"有哪些 store、哪些索引"
 * 都会漂移，而那正是持久化结构的一部分。
 */
export interface StoreIndexSchema {
  name: string;
  /** 支持点分路径（`op.id`）；数组表示复合索引。 */
  keyPath: string | string[];
  unique?: boolean;
  /** 数组字段展开成多个索引条目（线上 `entityIds` 就是）。 */
  multiEntry?: boolean;
}

export interface StoreSchema {
  name: string;
  /** 数组表示复合主键。 */
  keyPath: string | string[];
  autoIncrement?: boolean;
  indexes?: StoreIndexSchema[];
}

/** 主键类型。IndexedDB 允许 string | number，SQLite 亦然。 */
export type DbKey = string | number;

/** 主键区间（闭开区间，与 IndexedDB 的 IDBKeyRange 语义一致）。 */
export interface DbKeyRange {
  lower?: DbKey;
  upper?: DbKey;
  lowerOpen?: boolean;
  upperOpen?: boolean;
}

/**
 * 索引查询：区间、标量键、或复合索引的键数组。
 *
 * ⚠️ **标量必须包含在内。** 我第一版写成 `DbKeyRange | DbKey[]`，
 * 于是 `getAllFromIndex(store, idx, 'pending')` 这类单键查询**通不过类型检查**，
 * 而它恰恰是最常用的形式（查某个状态、某个外键）。
 * 少了它，实现里只能靠 `as any` 绕过 —— 那就把类型安全丢了。
 */
export type DbIndexQuery = DbKeyRange | DbKey | DbKey[];

export type DbTxMode = 'readonly' | 'readwrite';

export type DbCursorDirection = 'next' | 'prev';

/** 游标访问者的返回值，决定下一步动作。 */
export type DbCursorAction = 'continue' | 'stop' | 'delete' | 'delete-stop';

export type DbCursorVisitor<T> = (value: T, key: DbKey) => DbCursorAction;

/**
 * `addToleratingDuplicate` 的结果。
 *
 * 判别联合而不是 `{ ok: boolean; key?: number }`：后者让调用方必须对
 * `key` 做非空断言，而"成功却没有 key"实际上是**不可能**的状态。
 */
export type DbTolerantAddResult =
  | { ok: true; key: number }
  | { ok: false; reason: 'duplicate' };

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

  /**
   * 插入；若触发**唯一索引冲突**则报告"已存在"而**不使事务失败**。
   *
   * 🔴 这个方法必须在接口里，因为它承载了 op-log 的一条关键语义：
   * 同一个 opId 被重复投递是**正常路径**（同步会重放、客户端会重试），
   * 不是异常。
   *
   * 它曾经**只存在于 `IndexedDbAdapter` 上而不在接口里** ——
   * `DbOpLogStore` 于是只能靠 `as DbTx & {...}` 强转去调用它。
   * 强转本身就是信号：接口没有表达使用者的真实需求。后果是任何新适配器
   * （比如 SQLite、内存实现）只要按接口老实实现，就会在运行时报
   * "addToleratingDuplicate is not a function"。共享契约一跑就抓到了。
   *
   * 🔴 实现要点：冲突必须被**适配器内部**吸收（IndexedDB 里是
   * `preventDefault()`），否则错误冒泡会中止整个事务，把整批写入回滚掉 ——
   * 那会让"跳过重复项、继续写其余的"变成"整批都不写"。
   */
  addToleratingDuplicate(store: string, value: unknown): Promise<DbTolerantAddResult>;
  put(store: string, value: unknown, key?: DbKey): Promise<void>;
  get<T>(store: string, key: DbKey): Promise<T | undefined>;
  getAll<T>(store: string, range?: DbKeyRange): Promise<T[]>;
  delete(store: string, key: DbKey): Promise<void>;
  clear(store: string): Promise<void>;
  count(store: string, range?: DbKeyRange): Promise<number>;

  getFromIndex<T>(store: string, index: string, key: DbKey | DbKey[]): Promise<T | undefined>;
  getKeyFromIndex(store: string, index: string, key: DbKey | DbKey[]): Promise<DbKey | undefined>;

  /**
   * 按索引查询，返回**全部**命中记录。
   *
   * 🔴 **返回顺序未定义。**
   *
   * 实测各实现并不一致：IndexedDB 原生的 `getAllFromIndex` 按**索引键**排序，
   * 而内存实现与 SQLite 实现按**主键**排序。三者都能满足"返回哪些记录"，
   * 但顺序不同。
   *
   * 这不是缺陷，是**必须被写下来的事实** —— 否则将来有人合理地假设
   * 它按索引键有序（因为 IndexedDB 就是这样），在 SQLite 上会静默拿到
   * 另一个顺序。**依赖顺序的调用方必须自己 sort。**
   *
   * `DbOpLogStore` 里每个需要顺序的地方（`findPendingUpload` /
   * `findPendingApply` / `getOpsForEntity`）都已显式按 `seq` 排序，
   * 并由 OpLogStore 契约锁住，所以上传顺序是安全的。
   */
  getAllFromIndex<T>(store: string, index: string, query?: DbIndexQuery): Promise<T[]>;

  /** 按索引计数。与 {@link getAllFromIndex} 不同，计数与顺序无关。 */
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

  /**
   * 按索引查询，返回**全部**命中记录。
   *
   * 🔴 **返回顺序未定义。**
   *
   * 实测各实现并不一致：IndexedDB 原生的 `getAllFromIndex` 按**索引键**排序，
   * 而内存实现与 SQLite 实现按**主键**排序。三者都能满足"返回哪些记录"，
   * 但顺序不同。
   *
   * 这不是缺陷，是**必须被写下来的事实** —— 否则将来有人合理地假设
   * 它按索引键有序（因为 IndexedDB 就是这样），在 SQLite 上会静默拿到
   * 另一个顺序。**依赖顺序的调用方必须自己 sort。**
   *
   * `DbOpLogStore` 里每个需要顺序的地方（`findPendingUpload` /
   * `findPendingApply` / `getOpsForEntity`）都已显式按 `seq` 排序，
   * 并由 OpLogStore 契约锁住，所以上传顺序是安全的。
   */
  getAllFromIndex<T>(store: string, index: string, query?: DbIndexQuery): Promise<T[]>;

  /** 按索引计数。与 {@link getAllFromIndex} 不同，计数与顺序无关。 */
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
