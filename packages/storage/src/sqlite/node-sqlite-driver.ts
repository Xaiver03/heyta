/**
 * Node 平台的 SQLite 驱动 —— 基于内置 `node:sqlite` 的 `DatabaseSync`。
 *
 * ⚠️ **`node:sqlite` 在 Node 22 是实验特性。**
 * 在这里是**可接受的**，因为它只用于测试 / 校验路径，**不是原生端的交付绑定**：
 * iOS 注入原生绑定、HarmonyOS 注入 ArkTS 绑定（见 `sqlite-driver.ts`）。
 * 我们**没有**、也**不应该**为它引入第三方依赖（如 better-sqlite3）——
 * 那会新增许可证与可维护性审查面，而内置模块正好覆盖测试需求。
 *
 * 为什么单独成文件而不放进 `sqlite-adapter.ts`：
 * 适配器必须能被原生端（没有 `node:sqlite`）打包。把 Node 专属的 import
 * 隔离在这里，`SqliteAdapter` 才能只依赖 `SqliteDriver` 接口。
 */

import { DatabaseSync } from 'node:sqlite';

import { rmSync } from 'node:fs';

import type { SqliteContainerRemoval, SqlValue, SqliteDriver } from './sqlite-driver.js';

export class NodeSqliteDriver implements SqliteDriver {
  private db: DatabaseSync | undefined;

  constructor(private readonly path: string) {
    this.db = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.requireDb().exec(sql);
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    this.requireDb()
      .prepare(sql)
      .run(...params);
  }

  all<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): T[] {
    return this.requireDb().prepare(sql).all(...params) as T[];
  }

  close(): void {
    if (this.db === undefined) return;
    this.db.close();
    this.db = undefined;
  }

  /**
   * 删掉库文件，连带 SQLite 的旁挂文件。
   *
   * 🔴 `-wal` 与 `-shm` 必须一起删：只删主文件会留下一份 **能把明文重放出来的日志**
   *  （WAL 里是已提交但尚未回填进主文件的页）。这三个必须一起处置。
   *
   * ⚠️ `:memory:` 没有文件 —— 关掉连接就是销毁，直接报"容器没了"。
   */
  removeDatabase(): SqliteContainerRemoval {
    const target = this.path;
    if (target === ':memory:') return { target, containerRemoved: true };

    let failure: unknown;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        // `force: true` 让"文件本来就不存在"是成功而不是错误（幂等）。
        rmSync(target + suffix, { force: true });
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) {
      return {
        target,
        containerRemoved: false,
        reason: `删除库文件失败：${failure instanceof Error ? failure.message : String(failure)}`,
      };
    }
    return { target, containerRemoved: true };
  }

  private requireDb(): DatabaseSync {
    if (this.db === undefined) {
      throw new Error(
        'NodeSqliteDriver 已关闭。请注入一个 driver 工厂（driverFactory）而不是复用已关闭的实例。',
      );
    }
    return this.db;
  }
}
