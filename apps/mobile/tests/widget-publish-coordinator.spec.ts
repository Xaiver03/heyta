import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginWidgetCleanup, isWidgetPublishBlocked, registerWidgetActivity, resetWidgetPublishCoordinatorForTests,
} from '../src/widgets/publish-coordinator';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error('native activity failed')); });
  return { promise, resolve, reject };
}
async function flush(): Promise<void> { for (let index = 0; index < 15; index += 1) await Promise.resolve(); }
beforeEach(resetWidgetPublishCoordinatorForTests);
afterEach(resetWidgetPublishCoordinatorForTests);

describe('widget cleanup waits for native activities', () => {
  it('waits for every activity, including a failed update, before granting the cleanup lease', async () => {
    const first = deferred(); const second = deferred();
    registerWidgetActivity(first.promise); registerWidgetActivity(second.promise);
    let acquired = false;
    const cleanup = beginWidgetCleanup().then((lease) => { acquired = true; return lease; });
    expect(isWidgetPublishBlocked()).toBe(true);
    first.resolve(); await flush();
    expect(acquired).toBe(false);
    second.reject();
    const lease = await cleanup;
    expect(acquired).toBe(true);
    lease.release(true);
    expect(isWidgetPublishBlocked()).toBe(false);
  });

  it('overlapping cleanups wait for the same update and retain a failed-cleanup fence', async () => {
    const activity = deferred(); registerWidgetActivity(activity.promise);
    const first = beginWidgetCleanup(); const second = beginWidgetCleanup();
    activity.resolve();
    const a = await first; const b = await second;
    a.release(true);
    expect(isWidgetPublishBlocked()).toBe(true);
    b.release(false);
    expect(isWidgetPublishBlocked()).toBe(true);
    const retry = await beginWidgetCleanup();
    retry.release(true);
    expect(isWidgetPublishBlocked()).toBe(false);
  });
});
