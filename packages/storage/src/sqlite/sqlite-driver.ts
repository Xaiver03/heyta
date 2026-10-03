/**
 * SQLite 驱动的**最小接口**。
 *
 * 存在的理由（ADR-0003 §2.2）：
 *
 * > 没有 SQLite 实现，原生端根本跑不起来。
 *
 * 但 SQLite **不是一种绑定**：
 *   - Node 测试 / 校验路径 → `node:sqlite` 内置模块（见 `node-sqlite-driver.ts`）
 *   - iOS                 → 注入原生绑定（Swift / SQLite3 C API）
 *   - HarmonyOS           → 注入 ArkTS 绑定
 *
 * 如果 `SqliteAdapter` 直接 `import` 某个绑定，适配器逻辑就会被**复制三份** ——
 * 而那正是"同一套契约测试跑遍所有实现"想避免的漂移。所以这里只定义
 * 驱动接口，`SqliteAdapter` 只依赖它；**适配器逻辑只存在一份**。
 *
 * 接口故意做得很窄：只有同步的 `exec` / `run` / `all` / `close`。
 * 同步是有意的 —— 原生桥（JSI / NAPI）通常就是同步调用，而
 * `DbAdapter` 的并发契约由适配器内部的 FIFO 队列负责，不依赖驱动。
 */

/** 能绑定进 SQLite 的标量值。 */
export type SqlValue = string | number | null | Uint8Array;

/**
 * {@link SqliteDriver.removeDatabase} 的返回值：持久容器的处置结果。
 *
 * 它**必须带上"没删掉的原因"**。理由与 `DbAdapter.destroy` 同一条：
 * 这一层是"文件到底还在不在"的唯一知情人，而注销承诺的实话就靠它。
 */
export interface SqliteContainerRemoval {
  readonly target: string;
  readonly containerRemoved: boolean;
  readonly reason?: string;
}

/**
 * 一条 SQL 的最小驱动。
 *
 * 实现方只需保证：
 * - 语句是**同步**执行的（调用返回时已经执行完）
 * - `?:` 占位符按位置绑定 `params`
 * - 出错时抛异常（不要返回错误对象），适配器靠异常触发回滚
 */
export interface SqliteDriver {
  /** 执行一段（可以包含多条语句的）SQL，不返回结果。用于 DDL / BEGIN / COMMIT。 */
  exec(sql: string): void;

  /** 执行一条写入语句。 */
  run(sql: string, params?: readonly SqlValue[]): void;

  /** 执行一条查询语句并取回全部行。 */
  all<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): T[];

  /** 关闭连接。必须幂等。 */
  close(): void;

  /**
   * 可选：**移除数据库文件本身**（不是清空表）。
   *
   * 🔴 与 `DbAdapter.destroy` 为什么一个必填、一个可选 —— 这个不对称是**有意的**，
   * 别把它当成疏漏：
   *
   * · `destroy` 必填，因为它的缺失会**静默留下明文**（漏了不会报错），
   *   而适配器层是 TypeScript 的，编译器能一次查全。
   * · 这一层可选，因为驱动的**实现方跨出 TypeScript**：Swift / C# / ArkTS
   *   的原生桥（`apps/desktop-macos`、`apps/desktop-windows`、`apps/node-host`
   *   之外还有 `app-host` 的 `native-bridge.ts`）不在同一个编译单元里，
   *   把必填加在它们身上只会得到"改不动 → 整条契约被绕过"。
   *
   * ⚠️ 代价说清楚：**驱动没有这个方法时，销毁只做到"清空内容"，文件还在**。
   * 适配器不会把它藏起来 —— 它会在 {@link DbDestroyReport} 里给出
   * `containerRemoved: false` 与原因，而调用方**必须**把这一句说出去。
   * 已验证的三个 TypeScript 驱动（node / sqlite-wasm OPFS / op-sqlite）**都有**，
   * 缺的那一方是原生桥，登记在 `docs/plans/trash-and-archive.md` 批次 E。
   *
   * 实现要点：
   *  - 必须在 `close()` **之后**调用（适配器负责这个顺序），否则删的是还被
   *    句柄占着的文件 —— 在 POSIX 上那等于"文件消失了但数据还活着"。
   *  - 顺手带走 SQLite 的旁挂文件（`-wal` / `-shm`），只删主文件会留下
   *    一份能重放回明文的日志。
   *  - 文件本来就不存在 = **成功**（幂等），不是错误。
   */
  removeDatabase?(): SqliteContainerRemoval | Promise<SqliteContainerRemoval>;

  /**
   * 可选：判定一个异常是否属于"唯一约束冲突"。
   *
   * `addToleratingDuplicate` 依赖它把冲突吸收成 `{ ok: false }` 而不是让
   * 整个事务失败（IndexedDB 那边对应 `preventDefault()`）。
   *
   * 不实现时适配器回退到识别 SQLite 标准的错误文本 / 扩展结果码
   * （UNIQUE constraint failed / 1555 / 2067）。原生绑定若能给出更可靠的
   * 判定，实现这个方法即可 —— 适配器逻辑不需要改。
   */
  isUniqueViolation?(error: unknown): boolean;
}
