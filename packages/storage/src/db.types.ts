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
 * {@link DbAdapter.destroy} 的返回值 —— **一次销毁的书面凭据，不是成功标志位**。
 *
 * 🔴 为什么要有这个形状：注销账号承诺的是"这台设备上的我不见了"，
 * 而"把每张表的行删干净"与"那个文件/那个库真的不存在了"是**两件事**。
 * 只回 `Promise<void>` 的 destroy 会让第一件读起来像第二件 ——
 * 那是政策里最贵的一类假话（见 ADR-0048 与隐私政策那句分层实话）。
 *
 * ⚠️ 调用方**必须把 `containerRemoved === false` 说出去**（界面或日志），
 * 不许把它折叠成"已销毁"。
 */
export interface DbDestroyReport {
  /** 销毁对象的标识（库名 / 文件名 / `:memory:`），用于把凭据对上号。 */
  readonly target: string;
  /**
   * true = 持久容器本身（库文件、IndexedDB 数据库）已经不在了。
   * false = 只清空了内容，容器还在（残留页理论上可被取证恢复）。
   */
  readonly containerRemoved: boolean;
  /** `containerRemoved === false` 时**必须**给出原因（缺了就说不清它为什么没成）。 */
  readonly reason?: string;
  /** 被清掉的 store 数量 —— 判据用它钉"清空这件事确实扫过了全部表"。 */
  readonly storesCleared: number;
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
  getAll<T>(store: string, range?: DbKeyRange, limit?: number): Promise<T[]>;
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
  getAll<T>(store: string, range?: DbKeyRange, limit?: number): Promise<T[]>;
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

  /**
   * **销毁本机这份明文库**：清空全部 store，并在平台允许时移除持久容器本身。
   *
   * 🔴 它**必须在接口上，而且是必填项**。这不是风格问题，是这一条承诺的形状：
   * 「注销账号 = 这台设备上的我没了」。本仓库对"该在接口上却没在接口上"
   * 已经付过一次学费 —— `addToleratingDuplicate` 当时只在 IndexedDB 实现上、
   * 不在接口里，于是新适配器"按接口老实实现"就会在运行时报
   * `is not a function`（见 {@link DbTx.addToleratingDuplicate}）。
   * `destroy` 的失败模式更糟：**漏掉它的一端不会报错，只会继续留着用户的明文**，
   * 而那正是这条承诺唯一要防的事。所以它是必填的 —— 少实现一个就是编译错误。
   *
   * 语义（契约测试逐条钉住，见 `tests/contract/adapter.contract.ts`）：
   *  1. **幂等**：销毁一份已经没了的库不是错误。
   *  2. **先排空在途事务再动手**：销毁与写入并发时，"写完又落回来"会让
   *     销毁报告说谎。
   *  3. **不 `close()` 后就完事**：`close()` 的契约是"后续操作透明重开"，
   *     它**不删任何东西**；把 close 当 destroy 是本条存在的历史原因。
   *  4. 返回 {@link DbDestroyReport}：调用方要拿到"容器到底没了没有"的书面凭据。
   *  5. **销毁即死路**：之后这个实例上的任何读写以 `AdapterDestroyedError` 失败。
   *     🔴 这一条是被实测逼出来的，不是风格：此前 `destroy()` 只做了 `close()`，
   *     而 `close()` 的契约恰恰是"后续操作透明重开" —— 于是销毁后的**第一次普通读**
   *     就把刚删掉的容器重新建成空壳（SQLite 侧 73728 字节 / 6 张空表，计划 §10.146）。
   *     那次运行同时打印了"销毁成功"和"库文件回来了"，而读出来是 0 条，
   *     所以链上每一层都有理由认为自己没说谎。
   *     第二次 `destroy()` 例外：它返回第一次的同一份报告（幂等成立，且不需要重开）。
   *     要接着用这份存储的**唯一**正当方式是新建一个实例 —— 每个真实宿主在注销之后
   *     都是这个形状（重新加载页面 / 冷启动 / 重新注册）。
   *
   * ⚠️ **删干净不等于没有残留**：SQLite 的页在磁盘上可能被恢复，SSD 无法真正
   * 擦除，备份与日志不在这次操作的作用域里。政策必须按这个边界写
   * （ADR-0048 与隐私政策的分层实话），代码不许把 report 说得比它做到的更好。
   */
  destroy(): Promise<DbDestroyReport>;
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
