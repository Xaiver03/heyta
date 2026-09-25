/**
 * `node:sqlite` 的**本地补齐类型声明**。
 *
 * 为什么需要它：本仓库锁定的 `@types/node` 是 20.x，其 `node:sqlite`
 * 类型尚未收录（`node:sqlite` 在 Node 22.5 才出现，类型更晚）。而运行时
 * 明确是 Node 22.22.3 —— 也就是说**运行时支持、类型包不支持**。
 *
 * 选择补一份最小声明，而不是：
 *   - 升级 `@types/node`（会把整个工作区的 Node 类型面放大，且与其它包联动）
 *   - 引入第三方 SQLite 绑定（违反"不引入新依赖"）
 *   - 用 `any` 强转（丢掉类型安全）
 *
 * 只声明本项目实际用到的表面。故意是 `.d.ts`，不产生任何运行时代码。
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
