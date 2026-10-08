import { afterEach, describe, expect, it, vi } from 'vitest';
import { startInboundWorkerLoop } from '../src/inbound-worker-loop.js';

afterEach(() => { vi.useRealTimers(); });

describe('inbound worker lifecycle loop', () => {
  it('serializes manual and timer wake-ups and fences all triggers after stop', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const processOnce = vi.fn(() => first);
    const loop = startInboundWorkerLoop({ processOnce, intervalMs: 10 });
    await loop.wake();
    await vi.advanceTimersByTimeAsync(100);
    expect(processOnce).toHaveBeenCalledTimes(1);
    loop();
    release();
    await loop.wake();
    await vi.advanceTimersByTimeAsync(100);
    expect(processOnce).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads live eligibility on every trigger without restarting the timer', async () => {
    vi.useFakeTimers();
    let runnable = false;
    const processOnce = vi.fn(async () => undefined);
    const loop = startInboundWorkerLoop({ processOnce, intervalMs: 10, isRunnable: () => runnable });
    await vi.advanceTimersByTimeAsync(20);
    expect(processOnce).not.toHaveBeenCalled();
    runnable = true;
    await loop.wake();
    expect(processOnce).toHaveBeenCalledTimes(1);
    runnable = false;
    await vi.advanceTimersByTimeAsync(20);
    expect(processOnce).toHaveBeenCalledTimes(1);
    loop();
  });

  it('recovers after gate, processor and reporter errors without rejecting wake-ups', async () => {
    vi.useFakeTimers();
    const failure = new Error('gate failure');
    const isRunnable = vi.fn().mockImplementationOnce(() => { throw failure; }).mockReturnValue(true);
    const processOnce = vi.fn().mockRejectedValueOnce(new Error('process failure')).mockResolvedValue(undefined);
    const onError = vi.fn(() => { throw new Error('report failure'); });
    const loop = startInboundWorkerLoop({ processOnce, isRunnable, onError });
    expect(onError).toHaveBeenCalledWith(failure);
    await expect(loop.wake()).resolves.toBeUndefined();
    await expect(loop.wake()).resolves.toBeUndefined();
    expect(processOnce).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    loop();
  });
});
