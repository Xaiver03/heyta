import { Logger } from '../logger';

/**
 * 错误处理高阶函数的**唯一**入口（`server/src/sync/services/` 的统一抽取目标）。
 *
 * 抽它的动机是消除 `try { ... } catch (err) { Logger.x(...); return fallback; }`
 * 这一形状在服务层的重复。但**重复的形状 ≠ 等价的语义**，
 * 所以这个 helper 刻意做得很小：它只负责「记一条日志、然后交还控制权」，
 * 兜底值、日志级别、日志文案**全部由调用方显式给出**，不做任何推断。
 *
 * 🔴 **三条边界，违反即改变行为（本次重构的最高铁律）：**
 *
 * 1. **它不吞掉不该吞的异常。** 只有 `shouldHandle` 明确返回 true 才走兜底；
 *    其余一律原样 `throw`。省略 `shouldHandle` 等于「全部兜底」，
 *    这个默认值**只对确实要把所有失败都转成兜底值**的调用点可用。
 *    例如 `P2002` 那几处唯一约束竞争判断（`if (code !== 'P2002') throw err;`）
 *    必须传 `shouldHandle`，否则会把本该冒泡的数据库错误吞成「无事发生」。
 *
 * 2. **它不吞掉不该有的副作用。** `onError` 在日志之后、返回兜底值之前执行，
 *    且**只有 `shouldHandle` 通过时才执行**。原代码里 `await this._invalidateCachedSnapshot(userId)`
 *    之类的清理动作就落在这里 —— 放进 `onError` 与留在原地行为一致，
 *    放进不恰当的位置（例如无条件执行）会把「只在特定错误下清理」变成「总是清理」。
 *
 * 3. **它不改变日志级别与文案。** 级别与文案是两个独立参数，
 *    因为原代码里同样是「记日志 + 兜底」，`Logger.debug` 与 `Logger.error` 混用
 *    （WebSocket 关闭失败是 debug，快照失效是 error）。统一成一种级别 = 改变可观测性。
 *
 * ⚠️ **不适用**于以下情形，请勿为了「统一」而套用：
 * - catch 体里 `throw`（传播路径改变）；
 * - catch 体里根据错误内容走**状态机分支**（如按 `session_inactive` 选关闭码）；
 * - catch 体返回值被调用方当作**控制流信号**（如 `boolean` 决定是否回滚）；
 * - 纯解析守卫，如 `try { JSON.parse(x) } catch { return false }`（那里没有服务语义）。
 */
export type ErrorLogger = (message: string, error: unknown) => void;

export interface WithErrorHandlerOptions<T> {
  /**
   * 出错时要记的日志文案。可以是固定串，也可以由 error 派生 ——
   * 与 `label` 二选一，二者都给的以 `message` 为准。
   */
  message?: string | ((error: unknown) => string);
  /**
   * 出错时要记的标签。仅当未提供 `message` 时使用。
   */
  label?: string;
  /**
   * 返回兜底值。调用方保证它的类型与正常路径一致。
   */
  fallback: T;
  /**
   * 日志级别。默认 `error`。
   *
   * ⚠️ 默认值只是「多数调用点如此」，**不要依赖默认值去猜**：
   * 迁移既有代码时，必须把原来的级别原样传进来（原为 `warn`/`debug` 的照传）。
   */
  level?: 'error' | 'warn' | 'info' | 'debug';
  /**
   * 兜底之前要执行的清理/补偿动作。可以异步。
   * 只有 `shouldHandle` 通过时才会执行。
   */
  onError?: (error: unknown) => void | Promise<void>;
  /**
   * 判定该错误是否走兜底。返回 false（或抛错）则原样重抛。
   *
   * 省略 = 全部兜底。**省略前请确认这个调用点确实不该让任何异常冒泡。**
   */
  shouldHandle?: (error: unknown) => boolean;
  /**
   * 自定义日志器，默认用进程级 `Logger`。
   * 主要给测试注入用，生产代码不必传。
   */
  logger?: ErrorLogger;
}

const defaultLogger: ErrorLogger = (message, error) => {
  Logger.error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
};

/**
 * 把错误处理收敛成一层。被包装的函数**除非走到兜底，否则行为与原来逐字一致**：
 * 参数、返回值、异常传播路径、副作用时机都不变。
 *
 * @example 记日志并返回 null（原 `Logger.error(...) + return null`）
 * ```ts
 * const load = withErrorHandler(
 *   async (userId: number) => client.userSyncState.findUnique({ where: { userId } }),
 *   { message: (e) => `read failed: ${String(e)}`, fallback: null },
 * );
 * ```
 *
 * @example 只兜 P2002，其余重抛（保持唯一约束竞争的语义）
 * ```ts
 * const create = withErrorHandler(
 *   async (data: Row) => prisma.userSyncState.create({ data }),
 *   {
 *     label: 'create raced',
 *     fallback: null,
 *     shouldHandle: (e) => (e as { code?: string }).code === 'P2002',
 *   },
 * );
 * ```
 *
 * @example 兜底前先做清理（`onError` 只在兜底路径执行）
 * ```ts
 * const read = withErrorHandler(
 *   async (userId: number) => gunzip(await load(userId)),
 *   {
 *     label: 'decompress failed',
 *     fallback: null,
 *     onError: async () => { await invalidate(userId); },
 *   },
 * );
 * ```
 */
export const withErrorHandler = <Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T> | T,
  options: WithErrorHandlerOptions<T>,
): ((...args: Args) => Promise<T>) => {
  const {
    message,
    label,
    fallback,
    level = 'error',
    onError,
    shouldHandle,
    logger,
  } = options;

  const log: ErrorLogger =
    logger ??
    ((text: string, error: unknown) => {
      const payload = error instanceof Error ? error.message : String(error);
      const line = `${text}: ${payload}`;
      switch (level) {
        case 'warn':
          Logger.warn(line);
          break;
        case 'info':
          Logger.info(line);
          break;
        case 'debug':
          Logger.debug(line, error);
          break;
        default:
          Logger.error(line);
          break;
      }
    });

  return async (...args: Args): Promise<T> => {
    try {
      return await fn(...args);
    } catch (error) {
      // `shouldHandle` 自己抛错时**不能**被当成「该兜底」——
      // 那会把判定逻辑的 bug 伪装成一次正常的错误处理。直接重抛原错误。
      let handle = true;
      if (shouldHandle) {
        try {
          handle = shouldHandle(error);
        } catch {
          handle = false;
        }
      }
      if (!handle) throw error;

      log(
        typeof message === 'function'
          ? message(error)
          : (message ?? label ?? 'Unhandled error'),
        error,
      );
      if (onError) await onError(error);
      return fallback;
    }
  };
};

export default withErrorHandler;
