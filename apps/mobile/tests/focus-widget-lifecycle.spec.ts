import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppHost } from '@heyta/app-host';
import type { WidgetFocus } from '@heyta/widget-core';

const platform = vi.hoisted(() => ({
  currentState: 'active',
  listener: undefined as undefined | ((state: string) => void),
  dispatch: vi.fn(async () => undefined),
  seal: vi.fn(async (payload: string) => payload),
  write: vi.fn(async (_envelope: string) => true),
  activity: vi.fn(async () => 'noop'),
  drain: vi.fn(async () => null),
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() { return platform.currentState; },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      platform.listener = listener;
      return { remove: () => { platform.listener = undefined; } };
    },
  },
}));
vi.mock('../src/db/open-host', () => {
  const host = { dispatch: platform.dispatch } as unknown as AppHost;
  return { openTaskHost: async () => host, getOpenTaskHostIfReady: () => host };
});
vi.mock('../src/widgets/widget-bridge', () => ({
  sealWidgetSnapshot: platform.seal,
  setWidgetSnapshot: platform.write,
  syncFocusActivity: platform.activity,
}));
vi.mock('../src/widgets/drain', () => ({ drainWidgetIntentsNow: platform.drain }));
// Only the platform host is substituted. Timer state, publication planning,
// coalescing and cleanup fencing below are the production implementations.
vi.mock('../src/widgets/publish-source', async () => {
  const { currentFocusState } = await import('../src/lib/focus-timer');
  return {
    hostPublishSource: () => ({
      read: () => ({
        state: { tasks: { 'focus-task': { id: 'focus-task', title: 'QA focus task', createdAt: 1, updatedAt: 1 } }, projects: {}, habits: {}, habitLogs: {} },
        focus: currentFocusState(),
      }),
    }),
  };
});

import {
  __resetFocusTimerForTests, abortFocus, pauseFocus, resumeFocus, startFocus,
} from '../src/lib/focus-timer';
import { __resetWidgetLifecycleForTests, startWidgetLifecycle } from '../src/widgets/lifecycle';
import { __resetWidgetPublishForTests, beginWidgetCleanup } from '../src/widgets/publish';

let stop: (() => void) | undefined;
async function flush(): Promise<void> {
  // Settle the real read -> plan -> seal -> write -> activity promise chain.
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}
function lastFocus(): WidgetFocus | undefined {
  const json = platform.seal.mock.calls.at(-1)?.[0];
  return json === undefined ? undefined : JSON.parse(json).focus;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T03:00:00Z'));
  vi.clearAllMocks();
  platform.currentState = 'active';
  __resetFocusTimerForTests();
  __resetWidgetLifecycleForTests();
  __resetWidgetPublishForTests();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  __resetFocusTimerForTests();
  __resetWidgetLifecycleForTests();
  __resetWidgetPublishForTests();
  vi.useRealTimers();
});

describe('focus changes publish system widgets immediately', () => {
  it('start, pause, resume and abort update the container without any unrelated write or foreground event', async () => {
    stop = startWidgetLifecycle();
    await flush();
    platform.seal.mockClear(); platform.write.mockClear(); platform.activity.mockClear();

    startFocus('focus-task');
    await flush();
    expect(lastFocus()).toMatchObject({ active: true, sessionTitle: 'QA focus task' });
    expect(lastFocus()?.endsAt).toBeTypeOf('number');
    expect(platform.dispatch).not.toHaveBeenCalled();
    expect(platform.activity).toHaveBeenCalledTimes(1);

    pauseFocus();
    await flush();
    expect(lastFocus()).toMatchObject({ active: true, sessionTitle: 'QA focus task' });
    expect(lastFocus()?.endsAt).toBeUndefined();
    resumeFocus();
    await flush();
    expect(lastFocus()).toMatchObject({ active: true, sessionTitle: 'QA focus task' });
    expect(lastFocus()?.endsAt).toBeTypeOf('number');
    await abortFocus();
    await flush();
    expect(lastFocus()).toEqual({ active: false });
    expect(platform.dispatch).toHaveBeenCalledTimes(1);
    expect(platform.write).toHaveBeenCalledTimes(4);
  });

  it('display ticks do not reseal or rewrite the snapshot', async () => {
    stop = startWidgetLifecycle();
    await flush();
    startFocus();
    await flush();
    platform.seal.mockClear(); platform.write.mockClear(); platform.activity.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(platform.seal).not.toHaveBeenCalled();
    expect(platform.write).not.toHaveBeenCalled();
    expect(platform.activity).not.toHaveBeenCalled();
  });

  it('natural completion clears running focus and records just one session', async () => {
    stop = startWidgetLifecycle();
    await flush();
    startFocus();
    await flush();
    platform.write.mockClear();
    await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
    await flush();
    expect(lastFocus()).toEqual({ active: false });
    expect(platform.write).toHaveBeenCalledTimes(1);
    expect(platform.dispatch).toHaveBeenCalledTimes(1);
  });

  it('unmount removes the state listener and a restart registers only one owner', async () => {
    stop = startWidgetLifecycle();
    await flush();
    stop();
    platform.write.mockClear();
    startFocus();
    await flush();
    expect(platform.write).not.toHaveBeenCalled();
    stop = startWidgetLifecycle();
    const duplicateStop = startWidgetLifecycle();
    await flush();
    duplicateStop();
    platform.write.mockClear();
    pauseFocus();
    await flush();
    expect(platform.write).toHaveBeenCalledTimes(1);
  });

  it('account cleanup blocks focus refresh and live activity together', async () => {
    stop = startWidgetLifecycle();
    await flush();
    const lease = await beginWidgetCleanup();
    platform.write.mockClear(); platform.activity.mockClear();
    startFocus();
    await flush();
    expect(platform.write).not.toHaveBeenCalled();
    expect(platform.activity).not.toHaveBeenCalled();
    lease.release(true);
  });

  it('a wake waiting on drain cannot republish its old host after cleanup has completed', async () => {
    let finishDrain: (() => void) | undefined;
    platform.drain.mockImplementationOnce(() => new Promise<null>((resolve) => { finishDrain = () => resolve(null); }));
    stop = startWidgetLifecycle();
    await flush();
    expect(finishDrain).toBeDefined();
    expect(platform.write).not.toHaveBeenCalled();
    const lease = await beginWidgetCleanup();
    lease.release(true);
    finishDrain!();
    await flush();
    expect(platform.write).not.toHaveBeenCalled();
    expect(platform.activity).not.toHaveBeenCalled();
  });

  it('cleanup waits for an already-started native live activity call before clearing', async () => {
    stop = startWidgetLifecycle();
    await flush();
    let finishActivity: (() => void) | undefined;
    platform.activity.mockImplementationOnce(() => new Promise<string>((resolve) => { finishActivity = () => resolve('updated'); }));
    startFocus('focus-task');
    await flush();
    expect(finishActivity).toBeDefined();
    let cleanupFinished = false;
    const cleanup = beginWidgetCleanup().then((lease) => { cleanupFinished = true; return lease; });
    await flush();
    expect(cleanupFinished).toBe(false);
    finishActivity!();
    const lease = await cleanup;
    expect(cleanupFinished).toBe(true);
    lease.release(true);
  });

  it('an old owner stopped during drain cannot resume work after the lifecycle restarts', async () => {
    let finishDrain: (() => void) | undefined;
    platform.drain.mockImplementationOnce(() => new Promise<null>((resolve) => { finishDrain = () => resolve(null); }));
    const oldStop = startWidgetLifecycle();
    await flush();
    oldStop();
    stop = startWidgetLifecycle();
    await flush();
    platform.write.mockClear(); platform.activity.mockClear();
    finishDrain!();
    await flush();
    expect(platform.write).not.toHaveBeenCalled();
    expect(platform.activity).not.toHaveBeenCalled();
    oldStop();
    startFocus();
    await flush();
    expect(platform.write).toHaveBeenCalledTimes(1);
  });
});
