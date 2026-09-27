/**
 * 自动同步调度的测试
 * ====================
 *
 * 🔴 这些用例存在的理由：自动同步的**触发时机**看一眼就懂，
 * 真正会出错的是**并发** —— 而它的失败方式全都**不报错**：
 *
 *   · "同步进行中又改了一次" → 那次改动要等到下次前台才出去
 *     （用户看到的是"我明明改了，另一台设备上没有"）；
 *   · "离线时自动重排"      → 每 15 秒打一次服务端的热循环；
 *   · "未配置也去同步"      → 每次回到前台刷一条吓人的错误，
 *     而用户只是还没填凭据。
 *
 * 所以这里**不测"能不能同步"**（那是 E2E 的事），只测**什么时候排、排几次、清不清 dirty**。
 * 时间全部是假的：真定时器测不了"恰好在这一刻又写了一次"。
 */

import { describe, expect, it } from 'vitest';

import {
  createAutoSyncScheduler,
  FAILURE_BACKOFF_MS,
  MIN_GAP_MS,
  WRITE_DEBOUNCE_MS,
} from '../src/sync/auto-sync-core';

/**
 * 假时钟 + 假定时器 + 可控的同步结果。
 *
 * `sync()` 返回一个**由测试决定何时兑现**的 promise —— 这样才能造出
 * "同步还在跑的时候又发生了一次写入"这个关键时序。
 */
function harness(options: { ready?: boolean; throwing?: boolean } = {}) {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const pending: Array<(v: boolean) => void> = [];
  /** 每次 `sync()` 被调用的时刻。 */
  const syncAt: number[] = [];
  let ready = options.ready ?? true;
  const errors: unknown[] = [];

  const scheduler = createAutoSyncScheduler({
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    sync: () => {
      syncAt.push(now);
      if (options.throwing === true) return Promise.reject(new Error('boom'));
      return new Promise<boolean>((resolve) => pending.push(resolve));
    },
    ready: () => ready,
    onError: (error) => errors.push(error),
  });

  /** 让已排的微任务跑完（`fire()` 是 async 的）。 */
  async function settle(): Promise<void> {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  }

  /** 推进假时钟，按时间顺序触发到期的定时器。 */
  async function advance(ms: number): Promise<void> {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at);
      if (due.length === 0) break;
      const [id, t] = due[0];
      timers.delete(id);
      now = t.at;
      t.fn();
      await settle();
    }
    now = target;
  }

  /** 兑现最早那次还没结算的 `sync()`。 */
  async function finish(settled: boolean): Promise<void> {
    const resolve = pending.shift();
    if (resolve === undefined) throw new Error('没有在等结算的 sync()');
    resolve(settled);
    await settle();
  }

  return {
    scheduler,
    advance,
    finish,
    syncAt,
    errors,
    now: () => now,
    setReady: (v: boolean) => {
      ready = v;
    },
    pendingCount: () => pending.length,
  };
}

describe('自动同步：什么时候排', () => {
  it('本地写入后**不立刻**同步，等防抖期满', async () => {
    const h = harness();
    h.scheduler.notifyLocalWrite();

    await h.advance(WRITE_DEBOUNCE_MS - 1);
    expect(h.syncAt).toEqual([]);

    await h.advance(1);
    expect(h.syncAt).toEqual([WRITE_DEBOUNCE_MS]);
  });

  it('连续写入合并成一次（防抖被重置）', async () => {
    const h = harness();
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS - 1);
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS - 1);
    expect(h.syncAt).toEqual([]);

    await h.advance(1);
    expect(h.syncAt).toHaveLength(1);
  });

  it('回到前台立刻同步（不防抖）——用户切回来就是要看最新的', async () => {
    const h = harness();
    h.scheduler.notifyForeground();
    await h.advance(0);
    expect(h.syncAt).toEqual([0]);
  });

  it('刚填完凭据立刻同步一次', async () => {
    const h = harness();
    h.scheduler.notifyConfigured();
    await h.advance(0);
    expect(h.syncAt).toEqual([0]);
  });

  it('两次自动同步之间有最小间隔（写入很密也不会打满）', async () => {
    const h = harness();
    h.scheduler.notifyForeground();
    await h.advance(0);
    await h.finish(true);
    expect(h.syncAt).toEqual([0]);

    // 紧接着又写一次：要等 MIN_GAP 之后才跑。
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS);
    expect(h.syncAt).toEqual([0]);

    await h.advance(MIN_GAP_MS);
    expect(h.syncAt).toHaveLength(2);
  });
});

describe('自动同步：并发与丢数据（本文件的核心）', () => {
  it('🔴 同步进行中又写入 → 结束后**必须**再同步一次（否则那次写入静默丢掉）', async () => {
    const h = harness();
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS);
    expect(h.syncAt).toEqual([WRITE_DEBOUNCE_MS]);
    expect(h.pendingCount()).toBe(1);

    // 同步还挂着的时候，用户又改了一次。
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS);

    // 第一趟结束（成功）。
    await h.finish(true);
    expect(h.scheduler.debugState().dirty).toBe(true);

    // 于是必须再排一次 —— 而且要在最小间隔之后真的跑起来。
    await h.advance(MIN_GAP_MS + WRITE_DEBOUNCE_MS);
    expect(h.syncAt).toHaveLength(2);
    await h.finish(true);
    expect(h.scheduler.debugState().dirty).toBe(false);
  });

  it('同步期间没有新写入 → 结束后不再排（不会空转）', async () => {
    const h = harness();
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS);
    await h.finish(true);
    expect(h.scheduler.debugState().dirty).toBe(false);

    await h.advance(MIN_GAP_MS * 4);
    expect(h.syncAt).toHaveLength(1);
  });

  it('同步进行中连写多次 → 也只再排一次（合并）', async () => {
    const h = harness();
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS);

    h.scheduler.notifyLocalWrite();
    h.scheduler.notifyLocalWrite();
    h.scheduler.notifyLocalWrite();
    await h.finish(true);

    await h.advance(MIN_GAP_MS + WRITE_DEBOUNCE_MS);
    expect(h.syncAt).toHaveLength(2);
  });
});

describe('自动同步：失败与离线不许变成热循环', () => {
  it('没结算（离线）→ 保留 dirty，但**不自动重排**', async () => {
    const h = harness();
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS);
    await h.finish(false);

    expect(h.scheduler.debugState().dirty).toBe(true);
    // 离线时不该自己一遍遍重试。
    await h.advance(FAILURE_BACKOFF_MS * 10);
    expect(h.syncAt).toHaveLength(1);
  });

  it('失败冷却期内的新触发要被推迟到冷却结束', async () => {
    const h = harness();
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS);
    await h.finish(false);

    // 冷却是 15 秒，而最小间隔是 5 秒 —— 取更晚的那个。
    h.scheduler.notifyForeground();
    await h.advance(FAILURE_BACKOFF_MS - 1);
    expect(h.syncAt).toHaveLength(1);

    await h.advance(1);
    expect(h.syncAt).toHaveLength(2);
  });

  it('结算成"有冲突"也算结算 —— 不自动重试（冲突要人去选）', async () => {
    const h = harness();
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS);
    await h.finish(true);

    expect(h.scheduler.debugState().dirty).toBe(false);
    await h.advance(MIN_GAP_MS * 4);
    expect(h.syncAt).toHaveLength(1);
  });

  it('`sync()` 意外抛异常 → 不能把调度器卡死（还会响应下一次触发）', async () => {
    const h = harness({ throwing: true });

    h.scheduler.notifyForeground();
    await h.advance(0);
    expect(h.syncAt).toHaveLength(1);
    expect(h.errors).toHaveLength(1);

    // 🔴 关键：`running` 在 `finally` 里复位了，所以还能再排。
    //    只在成功路径复位的话，一次异常会让自动同步**永久停摆**，
    //    而表现是"从此再也不自动同步了"，没有任何一处会报错。
    //    ⚠️ 异常走的是"没结算"那条路，冷却按 FAILURE_BACKOFF_MS 算（不是 MIN_GAP_MS）——
    //    这里必须等够冷却，否则测的其实是"冷却没生效"。
    h.scheduler.notifyForeground();
    await h.advance(FAILURE_BACKOFF_MS - 1);
    expect(h.syncAt).toHaveLength(1);

    await h.advance(1);
    expect(h.syncAt).toHaveLength(2);
  });
});

describe('自动同步：未配置 / 后台不排', () => {
  it('未就绪（没凭据 / 不在前台）时，写入不排同步，但 dirty 留着', async () => {
    const h = harness({ ready: false });
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS * 5);
    expect(h.syncAt).toEqual([]);
    expect(h.scheduler.debugState().dirty).toBe(true);
  });

  it('后台写入 → 回到前台时把它带出去', async () => {
    const h = harness({ ready: false });
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS * 2);
    expect(h.syncAt).toEqual([]);

    h.setReady(true);
    h.scheduler.notifyForeground();
    await h.advance(0);
    expect(h.syncAt).toHaveLength(1);
    await h.finish(true);
    expect(h.scheduler.debugState().dirty).toBe(false);
  });

  it('未配置时回到前台**不**同步（否则会刷一条注定失败的错）', async () => {
    const h = harness({ ready: false });
    h.scheduler.notifyForeground();
    await h.advance(MIN_GAP_MS * 2);
    expect(h.syncAt).toEqual([]);
  });

  it('dispose 之后不再排', async () => {
    const h = harness();
    h.scheduler.dispose();
    h.scheduler.notifyLocalWrite();
    await h.advance(WRITE_DEBOUNCE_MS * 5);
    expect(h.syncAt).toEqual([]);
  });
});
