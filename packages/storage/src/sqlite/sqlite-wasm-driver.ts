/**
 * Web 平台的 SQLite 驱动 —— 基于 `@sqlite.org/sqlite-wasm` + OPFS 的
 * SyncAccessHandle（SAH）Pool VFS。
 *
 * 决策与全部取舍见 [ADR-0027](../../../../docs/adr/0027-unified-client-storage-sqlite-everywhere.md)。
 * 这里只记实现上**会踩坑**的四件事。
 *
 * ─────────────────────────────────────────────────────────────
 * 一、为什么工厂是 `async`，而返回的驱动是**同步**的
 * ─────────────────────────────────────────────────────────────
 * 这不是前后不一致，而是这个 API 的真实形状：
 *
 * - `installOpfsSAHPoolVfs()` **本身是异步的**（一次性初始化池，要锁 OPFS 资源）；
 * - 但它产出的 `OpfsSAHPoolDb` 继承自 `oo1.DB`，而 `oo1.DB` 的方法是**同步**的
 *   （`selectObjects: function(sql, bind) { return __selectAll(...) }`，
 *   是 `function` 而不是 `async function`）。
 *
 * 所以正确的用法是：**异步开一次，之后全部同步调用**。
 * 于是 `SqliteDriver` 的同步接口**一行都不用改** —— 这正是 ADR-0027 §3.2 的落点。
 *
 * 🔴 反过来做（以为整个 API 都是异步的、去把 `SqliteDriver` 改成 async）
 * 会牵动**三端全部驱动与适配器**：为一个 web，让移动端和桌面端一起承担复杂度。
 *
 * ─────────────────────────────────────────────────────────────
 * 二、为什么用**动态 import**
 * ─────────────────────────────────────────────────────────────
 * 这个包会把 852 KB 的 `sqlite3.wasm` 和 628 KB 的 bootstrap 一起带进来。
 * 静态 import 会让**任何**碰过这个文件的打包目标都背上它 ——
 * 包括完全用不到 web 的桌面端与移动端。
 *
 * 与 `node-sqlite-driver.ts` 同一个理由：平台专属的依赖必须被隔离，
 * 别的端才不会被牵连。动态 import 把"什么时候付这个体积"交给调用方。
 *
 * ─────────────────────────────────────────────────────────────
 * 三、驱动本体与 OPFS **解耦**，是为了可测
 * ─────────────────────────────────────────────────────────────
 * `SqliteWasmDriver` 单独导出、只接受一个已经打开好的 `Oo1Db`，自己不碰 OPFS。
 *
 * 因为 OPFS 只在浏览器里有：如果把"映射逻辑对不对"和"OPFS 能不能用"绑在一起，
 * 那连最普通的 `exec`/`run`/`all`/`close` 语义（占位符绑定、行形状、幂等关闭）
 * 都得靠一个重得多的环境去兜。
 *
 * 拆开之后：**映射逻辑**在 Node 里用内存库跑契约测试，
 * **OPFS 接入**在真浏览器里单独验。两者失败时的指向也完全不同 ——
 * 一个是"映射错了"，一个是"环境不支持"。
 *
 * ─────────────────────────────────────────────────────────────
 * 四、OPFS 的路径**必须绝对**
 * ─────────────────────────────────────────────────────────────
 * SAH Pool VFS 只认绝对路径（相对路径不会被正确识别，这是它文档里写明的怪癖）。
 * 所以文件名统一由本模块规范化，调用方不该自己拼。
 */

import type { SqliteDriver, SqlValue } from './sqlite-driver.js';

/**
 * `oo1.DB` 中我们真正用到的那一小部分。
 *
 * ⚠️ 这里**故意手写**而不是从包里 import 类型：
 * 该包是纯 `.mjs` 分发、没有随附 `.d.ts`。为拿一个类型去引 `@types/...`
 * 或维护一份全量声明都不划算。
 * 只声明我们调用得到的成员 —— 多声明只会给出"这个 API 存在"的错觉，
 * 而我们不用的部分没有任何东西会去验。
 */
export interface Oo1Db {
  /** 可传字符串（可含多条语句），或带绑定的选项对象。 */
  exec(sql: string): unknown;
  exec(options: {
    readonly sql: string;
    readonly bind?: readonly SqlValue[];
    readonly rowMode?: 'object' | 'array';
    readonly returnValue?: 'resultRows' | 'this';
  }): unknown;
  close(): void;
}

/** `installOpfsSAHPoolVfs()` resolve 出来的工具对象的**必要子集**。 */
export interface OpfsSahPoolUtil {
  readonly vfsName?: string;
  readonly OpfsSAHPoolDb: new (filename: string, options?: unknown) => Oo1Db;
  getFileCount?(): number;
  getCapacity?(): number;
}

export interface SqliteWasmDriverOptions {
  /**
   * 数据库文件名（会被规范化成 SAH Pool 要求的绝对路径）。
   *
   * ⚠️ 换名字等于**换一个空库**：SAH Pool 把文件名映射到自己的池里，
   * 旧名字下的数据不会自动出现。
   */
  readonly filename: string;

  /**
   * VFS 注册名。同一 origin 下多个应用要用**不同的**名字与目录，
   * 否则会互相抢 OPFS 锁（这是包文档里明确警告的失败模式）。
   */
  readonly vfsName?: string;

  /**
   * 池容量。默认只够一两个库加临时文件。
   * `addCapacity` 是异步且**跨会话持久**的，所以这里一次性给够。
   */
  readonly initialCapacity?: number;

  /**
   * 🔴 初始化时清空。**只用于测试**。
   *
   * 名字沿用上游的 `clearOnInit`：语义就是"把池里每个槽清干净"，
   * 看一眼就知道它会**真的删数据** —— 不需要靠注释去提醒。
   */
  readonly clearOnInit?: boolean;
}

/**
 * 打开一个 web SQLite 驱动。
 *
 * **异步只到这一行为止**：返回值上的所有操作都是同步的（理由见文件头第一段）。
 */
export async function openSqliteWasmDriver(
  options: SqliteWasmDriverOptions,
): Promise<SqliteDriver> {
  /**
   * ⚠️ 这里是**两步**，别合并成一句。
   *
   * `loadSqlite3Module()` 拿到的是**初始化函数**（`sqlite3InitModule`），
   * 不是已初始化的模块 —— 要**调用它**才会得到带 `util` / `oo1` 的对象。
   * 漏掉这次调用时，报错是 `Property 'util' does not exist on type 'Sqlite3InitModule'`，
   * 它指向的是"类型不对"，而真实原因是"少调了一次函数"。
   *
   * 这一步同时就是**异步边界的终点**：之后的 DB 操作全是同步的（见文件头第一段）。
   */
  const initModule = await loadSqlite3Module();
  const sqlite3 = await initModule();

  const vfsName = options.vfsName ?? 'heyta-opfs';
  /**
   * 🔴 `installOpfsSAHPoolVfs` 挂在 **`sqlite3` 顶层**，**不在 `sqlite3.util` 下**。
   *
   * 这个位置是**真浏览器**才能验出来的：Node 里根本没有 OPFS，所以
   * Node 侧探针（版本、行形状、唯一冲突报文都能验）**碰不到这条路径**。
   * 写错时浏览器里报的是
   * `TypeError: Cannot read properties of undefined (reading 'installOpfsSAHPoolVfs')`,
   * 指向"util 不存在"，而真实原因是"这个函数不在 util 下面"。
   *
   * 来源：`dist/sqlite3-worker1.mjs` 里 `sqlite3.installOpfsSAHPoolVfs = async function(...)`。
   */
  const pool = (await sqlite3.installOpfsSAHPoolVfs({
    name: vfsName,
    /**
     * 目录名与 VFS 名绑在一起：换名字必须同时换目录，
     * 否则两个注册会指向同一批文件、互相抢锁（包文档明确警告过）。
     */
    directory: `.${vfsName}`,
    initialCapacity: options.initialCapacity ?? 8,
    ...(options.clearOnInit === true ? { clearOnInit: true } : {}),
  })) as OpfsSahPoolUtil;

  return new SqliteWasmDriver(new pool.OpfsSAHPoolDb(normalizeFilename(options.filename)));
}

/**
 * 把文件名规范化成 SAH Pool 要求的**绝对路径**（见文件头第四段）。
 *
 * 幂等：已经以 `/` 开头就原样返回。
 * 拼错的表现是"打开了一个空库"而**不是**报错，所以这里不允许多拼一次前缀。
 */
function normalizeFilename(filename: string): string {
  if (filename.startsWith('/')) return filename;
  return `/${filename}`;
}

/**
 * 驱动本体：把一个 `oo1.DB` **映射成** `SqliteDriver`（见文件头第三段）。
 */
export class SqliteWasmDriver implements SqliteDriver {
  private db: Oo1Db | undefined;

  constructor(db: Oo1Db) {
    this.db = db;
  }

  exec(sql: string): void {
    this.requireDb().exec(sql);
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    this.requireDb().exec({ sql, bind: params });
  }

  all<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): T[] {
    /**
     * `rowMode: 'object'` 让每一行是「列名 → 值」的对象 ——
     * `SqliteAdapter` 与另一个驱动（`node:sqlite`）都按对象取列，
     * 这里必须对齐，否则同一套契约测试在不同驱动上会读到不同形状。
     *
     * ⚠️ `?? []` 是**兜底而不是事实**：上游实现里 `resultRows` 会被初始化成
     * `[]`（`if (!opt.resultRows) opt.resultRows = [];`），所以无匹配行时
     * 拿到的是空数组。保留兜底是因为这一层隔着 wasm 边界，
     * 而"空结果"与"没拿到结果"在这里是**同一个下游行为**（返回空数组），
     * 不值得为它多一次判空分支。
     */
    const rows = this.requireDb().exec({
      sql,
      bind: params,
      rowMode: 'object',
      returnValue: 'resultRows',
    });
    return (rows ?? []) as T[];
  }

  /**
   * 关闭连接。**必须幂等**（接口要求）。
   *
   * ⚠️ 只关 DB，**不 `removeVfs()`**：VFS 是**整个 origin 共享**的注册，
   * 关掉一个库就把它摘掉，会让同页面其它已打开的库一起失效。
   * 池的生命周期应当与页面一致，而不是与某一个连接一致。
   */
  close(): void {
    if (this.db === undefined) return;
    this.db.close();
    this.db = undefined;
  }

  /**
   * 判定"唯一约束冲突"。
   *
   * `addToleratingDuplicate` 依赖它把冲突吸收成 `{ ok: false }`，
   * 而不是让整个事务失败。
   *
   * ⚠️ 这里**没有**用 SQLite 的扩展结果码：wasm 包装层把错误重新抛成了
   * JS `Error`，原始结果码不一定还挂在对象上。所以走文本匹配 ——
   * 与适配器自己的回退路径一致，不会比"不实现这个方法"更差。
   */
  isUniqueViolation(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('UNIQUE constraint failed') ||
      message.includes('1555') ||
      message.includes('2067')
    );
  }

  private requireDb(): Oo1Db {
    if (this.db === undefined) {
      throw new Error(
        'SqliteWasmDriver 已关闭。请注入一个 driver 工厂（driverFactory）而不是复用已关闭的实例。',
      );
    }
    return this.db;
  }
}

/** `sqlite3InitModule` 这个全局初始化函数的最小形状。 */
interface Sqlite3InitModule {
  (config?: unknown): Promise<{
    /** ⚠️ **顶层**，不是 `util.installOpfsSAHPoolVfs`（见 `openSqliteWasmDriver` 注释）。 */
    installOpfsSAHPoolVfs(options: unknown): Promise<unknown>;
  }>;
}

/**
 * 取到 `sqlite3InitModule`。
 *
 * ⚠️ 包的入口**不导出**这个函数，它是挂在全局上的（`globalThis.sqlite3InitModule`）。
 * 所以必须「先 import 副作用，再从全局取」——
 * 写成 `const { default: init } = await import(...)` 会拿到 `undefined`，
 * 而那个报错会指向"包没装好"，与真实原因（取法不对）无关。
 */
async function loadSqlite3Module(): Promise<Sqlite3InitModule> {
  await import('@sqlite.org/sqlite-wasm');

  const init = (globalThis as { sqlite3InitModule?: Sqlite3InitModule }).sqlite3InitModule;
  if (init === undefined) {
    throw new Error(
      '加载了 @sqlite.org/sqlite-wasm，但 globalThis.sqlite3InitModule 仍未定义。' +
        '该包的入口通过全局暴露初始化函数；若包结构变了，请对照 ADR-0027 §3.1 重新核对。',
    );
  }
  return init;
}
