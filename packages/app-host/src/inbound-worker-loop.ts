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
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  return Object.assign(() => { stopped = true; clearInterval(timer); }, { wake: tick });
}
