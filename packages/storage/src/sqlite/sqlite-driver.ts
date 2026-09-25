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
