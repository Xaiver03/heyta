export interface InboundWorkerLoopOptions {
  /** One claim/process attempt. The loop never runs two attempts together. */
  processOnce: () => Promise<unknown>;
  /** Return false while the host is backgrounded, locked or not authorized. */
  isRunnable?: () => boolean;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

/**
 * Start a foreground-safe worker loop. The timer is only a wake-up signal:
 * every actual attempt rechecks `isRunnable`, and an in-flight attempt fences
 * later ticks. Stopping the loop prevents a queued async completion from
 * scheduling more work.
 */
export interface InboundWorkerLoop {
  (): void;
  /** Manual, focus and timer triggers share the same in-flight fence. */
  wake(): Promise<void>;
}

export function startInboundWorkerLoop(options: InboundWorkerLoopOptions): InboundWorkerLoop {
  const intervalMs = options.intervalMs ?? 30_000;
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error('Invalid inbound worker interval');
  let stopped = false;
  let running = false;
  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      if (options.isRunnable?.() !== false) await options.processOnce();
    }
    catch (error) {
      // Reporting must not turn a timer wake-up into an unhandled rejection.
      try { options.onError?.(error); } catch { /* reporter failure is isolated */ }
    }
    finally { running = false; }
  };
  /**
   * 🔴 所有 `tick()` 都走这一层，永不裸 `void tick()`（崩溃审计 2026-11-08 · U05）。
   *
   * `tick` **现在**内部已有 try/catch/finally，把 `processOnce`、`isRunnable`
   * 与 `onError` 全罩住了 —— 也就是说当前**不会**产生未处理拒绝。
   * 但这条安全性依赖"那个 catch 不被收窄"，而收窄它是完全合理的重构
   * （例如"只该包 processOnce，isRunnable 是纯函数不该需要兜底"）。
   * 一旦收窄，`void tick()` 就变成 unhandled rejection，
   * 而调用点散在启动与 `setInterval` 两处，review 时看不见。
   *
   * 所以把兜底做成**结构性的**：即使 `tick` 将来违约抛出，
   * 这里也把它转成一次 `onError` 上报 —— 而不是让进程/宿主去接。
   */
  const runTick = (): void => {
    void tick().catch((error: unknown) => {
      // 第二层兜底。到这一层说明 `tick` 的 catch 漏了东西，
      // 仍然只上报、不外抛 —— 定时器唤醒绝不能变成未处理拒绝。
      try {
        options.onError?.(error);
      } catch {
        // 上报器自己失败也不再扩散。
      }
    });
  };
  runTick();
  const timer = setInterval(runTick, intervalMs);
  return Object.assign(() => { stopped = true; clearInterval(timer); }, { wake: tick });
}
