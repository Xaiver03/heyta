/**
 * op-sqlite 驱动：`@heyta/storage` 的 `SqliteDriver` 在 iOS/鸿蒙 上的实现
 * ==========================================================================
 *
 * 🔴 这是移动端**唯一允许出现的平台差异**（AGENTS.md §3.5）。
 * 它只做一件事：把 op-sqlite 的 API 翻译成 `SqliteDriver`。
 * 任何"业务上该怎么做"的代码出现在这里都是分层失败。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 这里有一个**真实的、未解决的**取舍，必须写下来而不是假装没有：
 *
 * `SqliteDriver` 的四个方法**全是同步的**：
 *
 *     exec(sql): void
 *     run(sql, params?): void
 *     all<T>(sql, params?): T[]
 *     close(): void
 *
 * 而 op-sqlite 的主 API 是**异步**的（`execute` 返回 Promise）。
 * 它提供的同步版本是 `executeSync` —— **会阻塞 JS 线程**（官方文档原话：
 * "it will block the JS thread and therefore your UI and should be used with caution"）。
 *
 * 所以这个实现选择了 `executeSync`：能跑，而且不需要改动 `packages/storage` 一行。
 * **代价是真实的**：RN 只有一条 JS 线程，而 `engine.recover()` 会重放整条日志，
 * 每一次重放都是一次同步查询。手机上几千条 op 的日志，启动时可能阻塞住界面
 * 几百毫秒 —— 这正是 UIX Pro 里"性能"那一项要盯的东西。
 *
 * **真正的修法**是把 `SqliteDriver` 改成异步**并贯穿整个 `packages/storage`**。
 * 那是一次跨包的大改（适配器、`DbOpLogStore`、全部测试），本轮没有做。
 * 在那之前，**这个阻塞是已知且被记录的，不是被忽略的**。
 *
 * 为什么仍然选 op-sqlite：它是候选里维护最活跃的（2026-09 仍在发版）、MIT、
 * 且提供了 `executeSync` 这个"能立刻拿到结果"的入口。没有同步入口的库
 * （如纯异步的封装）**根本无法实现这个接口**。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { open, type DB, type Scalar } from '@op-engineering/op-sqlite';
import type { SqliteContainerRemoval, SqliteDriver, SqlValue } from '@heyta/storage';

export interface OpSqliteDriverOptions {
  /** 数据库名（不含路径）。op-sqlite 会放到平台约定的目录下。 */
  name: string;
  /** 存放位置，默认由 op-sqlite 选（iOS 上是 Documents）。 */
  location?: string;
}

/**
 * `@heyta/storage` 的 `SqlValue` 比 op-sqlite 的 `Scalar` 窄：
 * 前者不含 ArrayBuffer。转换在这里显式做，**不做 `as any`** ——
 * 后者会让"某个调用方传了 Blob"这类问题一直静默到运行期。
 */
function toScalar(value: SqlValue): Scalar {
  return value;
}

/** op-sqlite 的异常里，唯一约束冲突长什么样。 */
const UNIQUE_PATTERNS = [
  /UNIQUE constraint failed/i,
  /UNIQUE constraint/i,
  // SQLite 扩展结果码：1555 = SQLITE_CONSTRAINT_PRIMARYKEY，2067 = SQLITE_CONSTRAINT_UNIQUE
  /\b1555\b/,
  /\b2067\b/,
];

export class OpSqliteDriver implements SqliteDriver {
  private readonly db: DB;
  private readonly name: string;
  private closed = false;

  constructor(options: OpSqliteDriverOptions) {
    this.name = options.name;
    this.db = open(
      options.location !== undefined
        ? { name: options.name, location: options.location }
        : { name: options.name },
    );
  }

  exec(sql: string): void {
    this.assertOpen();
    // 含多条语句的 DDL / BEGIN / COMMIT。op-sqlite 的 executeSync 走
    // sqlite3_prepare 循环，可以吃多语句。
    this.db.executeSync(sql);
  }

  run(sql: string, params?: readonly SqlValue[]): void {
    this.assertOpen();
    this.db.executeSync(sql, params ? params.map(toScalar) : undefined);
  }

  all<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): T[] {
    this.assertOpen();
    const result = this.db.executeSync(sql, params ? params.map(toScalar) : undefined);
    // op-sqlite 把行放在 `rows`；`res` 是旧字段名，不依赖它。
    return (result.rows ?? []) as T[];
  }

  close(): void {
    // 必须幂等（接口要求）。RN 的热重载会让 close 被调用不止一次。
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /**
   * 原生绑定能给出比"匹配错误文本"更可靠的判定，所以实现它。
   * 适配器仍然保留文本回退，这条只是提高准确度 —— 见接口注释。
   */
  isUniqueViolation(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : String((error as { message?: unknown } | null)?.message ?? '');
    if (message === '') return false;
    return UNIQUE_PATTERNS.some((re) => re.test(message));
  }

  /**
   * 删掉原生侧那个库文件（`DB.delete()`）。
   *
   * 🔴 **不在 `assertOpen()` 后面**：契约规定的顺序是"适配器先 close，再让驱动删文件"，
   * 所以走到这里时 `closed` **必然是 true**。把它放在断言之后就会得到
   * "已关闭的驱动"这个错，而症状是"报告说没删干净"—— 一次会把人引向
   * 完全错误方向的假故障。
   *
   * ⚠️ op-sqlite 在 **web** 构建里把这个方法实现成"抛 unsupported"
   *   （`src/functions.web.ts`），而 mobile 的 web 目标恰好会走到那份实现。
   *   这里不装作它不存在：捕获后如实报 `containerRemoved: false` 并带上原因，
   *   界面上那句"这台设备上的我没清干净"就是靠它说出来的。
   */
  removeDatabase(): SqliteContainerRemoval {
    const target = this.name;
    try {
      this.db.delete();
      return { target, containerRemoved: true };
    } catch (error) {
      return {
        target,
        containerRemoved: false,
        reason: `database-delete-failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error(
        'OpSqliteDriver 已关闭。请注入一个 driver 工厂（driverFactory）而不是复用已关闭的实例。',
      );
    }
  }
}

/**
 * 驱动工厂。
 *
 * 🔴 必须是**工厂**而不是实例：`SqliteAdapter.close()` 之后靠它透明重开，
 * 而 op-sqlite 的 `DB` 关闭后不可复用。传实例会在第一次 close 后炸在
 * "已关闭的驱动"上 —— 与 `NodeSqliteDriver` 是同一个约束。
 */
export function opSqliteDriverFactory(options: OpSqliteDriverOptions): () => SqliteDriver {
  return () => new OpSqliteDriver(options);
}
