/**
 * 订阅编排的承重测试。
 * ====================
 *
 * 🔴 这个文件要挡住的是**"一次外部故障或我们自己的故障去删用户数据"**。
 *
 * 最危险的写法是"推送失败 N 次就删订阅" —— 听起来像清理，
 * 实际效果是：推送服务一次大规模 5xx，**所有用户的订阅被清空**，
 * 而恢复之后没有任何东西知道该把它们加回来。
 *
 * 所以下面每一条 `it` 都在问同一个问题的不同侧面：
 * **这一种失败，该不该动那一行？**
 */

import { describe, expect, it } from 'vitest';

import {
  deliverWidgetPushToUser,
  PUSH_FAILURE_THRESHOLD,
  type PushSubscriptionStore,
  type StoredPushSubscription,
} from '../src/push/subscriptions';

/** 内存实现 —— 顺带把"库里的真实行为"钉下来（比如 upsert 要重置计数）。 */
function fakeStore(initial: StoredPushSubscription[] = []) {
  const rows = new Map<number, StoredPushSubscription>(initial.map((r) => [r.id, r]));
  const failures = new Map<number, number>();
  const log: string[] = [];
  let nextId = 1000;
  const store: PushSubscriptionStore = {
    async upsert({ endpoint }) {
      log.push(`upsert:${endpoint}`);
      return { id: ++nextId };
    },
    async listForUser(userId) {
      return [...rows.values()].filter((r) => userIdOf(r, userId));
    },
    async deleteById(id) {
      log.push(`delete:${id}`);
      rows.delete(id);
    },
    async recordSuccess(id) {
      log.push(`success:${id}`);
      failures.set(id, 0);
    },
    async incrementFailure(id) {
      const next = (failures.get(id) ?? 0) + 1;
      failures.set(id, next);
      log.push(`fail:${id}:${next}`);
      return next;
    },
    async deleteByEndpoint(endpoint) {
      for (const [id, r] of rows) if (r.endpoint === endpoint) rows.delete(id);
      log.push(`deleteByEndpoint:${endpoint}`);
      return 1;
    },
  };
  return { store, rows, failures, log };
}

/** 让假 store 记住 user 归属。 */
const owners = new WeakMap<StoredPushSubscription, number>();
function userIdOf(row: StoredPushSubscription, userId: number): boolean {
  return (owners.get(row) ?? 0) === userId;
}
function sub(id: number, userId: number): StoredPushSubscription {
  const row: StoredPushSubscription = {
    id,
    endpoint: `https://push.example/${id}`,
    p256dh: 'p'.repeat(87),
    auth: 'a'.repeat(22),
  };
  owners.set(row, userId);
  return row;
}

const base = { userId: 1, plaintext: '{}', vapid: { privateKey: Buffer.alloc(32), publicKey: Buffer.alloc(65) }, subject: 'mailto:x@y.z' };

describe('基本成功路径', () => {
  it('一个订阅发送成功 → 记成功、不删', async () => {
    const s = sub(1, 1);
    const { store, rows, log } = fakeStore([s]);
    const summary = await deliverWidgetPushToUser(
      { store, send: async () => ({ kind: 'sent' }) },
      base,
    );
    expect(summary).toMatchObject({ attempted: 1, sent: 1, removed: 0 });
    expect(rows.has(1)).toBe(true);
    expect(log).toContain('success:1');
  });

  it('多个订阅各发一条', async () => {
    const { store } = fakeStore([sub(1, 1), sub(2, 1), sub(3, 1)]);
    const summary = await deliverWidgetPushToUser(
      { store, send: async () => ({ kind: 'sent' }) },
      base,
    );
    expect(summary.attempted).toBe(3);
    expect(summary.sent).toBe(3);
  });

  it('没有订阅时是"一件也没做"，不是失败', async () => {
    const { store } = fakeStore([]);
    const summary = await deliverWidgetPushToUser(
      { store, send: async () => ({ kind: 'sent' }) },
      base,
    );
    expect(summary).toMatchObject({ attempted: 0, sent: 0, removed: 0 });
    expect(summary.outcomes).toEqual([]);
  });

  it('🔴 一个用户的推送不会发给另一个用户的订阅', async () => {
    const { store } = fakeStore([sub(1, 1), sub(2, 2)]);
    const sentTo: number[] = [];
    await deliverWidgetPushToUser(
      { store, send: async (x) => { sentTo.push(x.id); return { kind: 'sent' }; } },
      { ...base, userId: 1 },
    );
    expect(sentTo).toEqual([1]);
  });
});

describe('🔴 gone（404/410）：立刻删掉', () => {
  it('gone 的行被删除，且会通知调用方', async () => {
    const { store, rows } = fakeStore([sub(1, 1)]);
    const gone: number[] = [];
    const summary = await deliverWidgetPushToUser(
      { store, send: async () => ({ kind: 'gone' }), onGone: (id) => gone.push(id) },
      base,
    );
    expect(rows.has(1)).toBe(false);
    expect(summary).toMatchObject({ attempted: 1, sent: 0, removed: 1 });
    expect(gone).toEqual([1]);
  });

  it('gone 不计入失败次数（它不需要阈值就已经处理完了）', async () => {
    const { store, failures } = fakeStore([sub(1, 1)]);
    await deliverWidgetPushToUser({ store, send: async () => ({ kind: 'gone' }) }, base);
    expect(failures.get(1)).toBeUndefined();
  });
});

describe('🔴 retryable（429/5xx）：绝不动那一行', () => {
  it('retryable 不删除、不计数', async () => {
    const { store, rows, failures } = fakeStore([sub(1, 1)]);
    const summary = await deliverWidgetPushToUser(
      { store, send: async () => ({ kind: 'retryable' }) },
      base,
    );
    expect(rows.has(1)).toBe(true);
    expect(failures.get(1)).toBeUndefined();
    expect(summary.removed).toBe(0);
    expect(summary.outcomes[0]).toMatchObject({ kind: 'retryable', removed: false });
  });

  it('🔴 连续 100 次 retryable 也不会删掉订阅（推送服务的问题不是用户的错）', async () => {
    const { store, rows } = fakeStore([sub(1, 1)]);
    for (let i = 0; i < 100; i += 1) {
      await deliverWidgetPushToUser({ store, send: async () => ({ kind: 'retryable' }) }, base);
    }
    expect(rows.has(1)).toBe(true);
  });
});

describe('🔴 rejected（400/401/403）：是我们自己的 bug，也不能删', () => {
  it('rejected 不删除、不计数，但要通知调用方（否则没人知道配置错了）', async () => {
    const { store, rows, failures } = fakeStore([sub(1, 1)]);
    const rejected: Array<[number, string]> = [];
    const summary = await deliverWidgetPushToUser(
      {
        store,
        send: async () => ({ kind: 'rejected', reason: 'VAPID 错了' }),
        onRejected: (id, reason) => rejected.push([id, reason]),
      },
      base,
    );
    expect(rows.has(1)).toBe(true);
    expect(failures.get(1)).toBeUndefined();
    expect(summary.outcomes[0]).toMatchObject({ kind: 'rejected', removed: false });
    expect(rejected).toEqual([[1, 'VAPID 错了']]);
  });

  it('🔴 连续 100 次 rejected 也不会删（改完配置就该恢复，而订阅必须还在）', async () => {
    const { store, rows } = fakeStore([sub(1, 1)]);
    for (let i = 0; i < 100; i += 1) {
      await deliverWidgetPushToUser({ store, send: async () => ({ kind: 'rejected' }) }, base);
    }
    expect(rows.has(1)).toBe(true);
  });
});

describe('🔴 failed（抛异常）：只有这一种才计数并最终删除', () => {
  it('第一次失败计数为 1，不删', async () => {
    const { store, rows, failures } = fakeStore([sub(1, 1)]);
    const summary = await deliverWidgetPushToUser(
      { store, send: async () => { throw new Error('p256dh 必须是 65 字节'); } },
      base,
    );
    expect(failures.get(1)).toBe(1);
    expect(rows.has(1)).toBe(true);
    expect(summary.outcomes[0]).toMatchObject({
      kind: 'failed',
      failureCount: 1,
      removed: false,
      reason: 'p256dh 必须是 65 字节',
    });
  });

  it(`🔴 恰好第 ${PUSH_FAILURE_THRESHOLD} 次失败才删（阈值边界）`, async () => {
    const { store, rows } = fakeStore([sub(1, 1)]);
    // 前 threshold-1 次都不能删 —— 差一次就删是"偶尔坏两次就被注销"。
    for (let i = 1; i < PUSH_FAILURE_THRESHOLD; i += 1) {
      await deliverWidgetPushToUser({ store, send: async () => { throw new Error('x'); } }, base);
      expect(rows.has(1), `第 ${i} 次失败后不该删`).toBe(true);
    }
    const summary = await deliverWidgetPushToUser(
      { store, send: async () => { throw new Error('x'); } },
      base,
    );
    expect(rows.has(1)).toBe(false);
    expect(summary.removed).toBe(1);
    expect(summary.outcomes[0]).toMatchObject({
      failureCount: PUSH_FAILURE_THRESHOLD,
      removed: true,
    });
  });

  it('🔴 中间成功一次会把计数清零（不累计跨越很久的偶发失败）', async () => {
    const { store, failures } = fakeStore([sub(1, 1)]);
    let mode: 'fail' | 'ok' = 'fail';
    const send = async () => {
      if (mode === 'fail') throw new Error('x');
      return { kind: 'sent' as const };
    };
    for (let i = 1; i < PUSH_FAILURE_THRESHOLD; i += 1) {
      await deliverWidgetPushToUser({ store, send }, base);
    }
    expect(failures.get(1)).toBe(PUSH_FAILURE_THRESHOLD - 1);
    mode = 'ok';
    await deliverWidgetPushToUser({ store, send }, base);
    expect(failures.get(1)).toBe(0);
    // 再失败 threshold-1 次仍然不该被删 —— 因为窗口被成功重置了。
    mode = 'fail';
    for (let i = 1; i < PUSH_FAILURE_THRESHOLD; i += 1) {
      await deliverWidgetPushToUser({ store, send }, base);
    }
    expect(failures.get(1)).toBe(PUSH_FAILURE_THRESHOLD - 1);
  });
});

describe('🔴 一条坏了不带塌整批', () => {
  it('三条里中间一条抛异常，前后两条照样成功', async () => {
    const { store, rows } = fakeStore([sub(1, 1), sub(2, 1), sub(3, 1)]);
    const summary = await deliverWidgetPushToUser(
      {
        store,
        send: async (x) => {
          if (x.id === 2) throw new Error('坏行');
          return { kind: 'sent' as const };
        },
      },
      base,
    );
    expect(summary).toMatchObject({ attempted: 3, sent: 2, removed: 0 });
    expect([...rows.keys()].sort()).toEqual([1, 2, 3]);
    expect(summary.outcomes.map((o) => o.kind)).toEqual(['sent', 'failed', 'sent']);
  });

  it('三种结果混在一起时各类计数正确', async () => {
    const { store, rows } = fakeStore([sub(1, 1), sub(2, 1), sub(3, 1), sub(4, 1)]);
    const summary = await deliverWidgetPushToUser(
      {
        store,
        send: async (x) => {
          if (x.id === 1) return { kind: 'sent' as const };
          if (x.id === 2) return { kind: 'gone' as const };
          if (x.id === 3) return { kind: 'retryable' as const };
          throw new Error('坏');
        },
      },
      base,
    );
    expect(summary).toMatchObject({ attempted: 4, sent: 1, removed: 1 });
    expect([...rows.keys()].sort()).toEqual([1, 3, 4]);
  });
});

describe('结果里不带 endpoint', () => {
  it('🔴 outcome 里没有 endpoint 字段（它是能力 URL，不进日志）', async () => {
    const { store } = fakeStore([sub(1, 1)]);
    // ⚠️ `failed` **不是** `send` 的合法返回 —— 它只能由 `send` 抛出来。
    //    我第一版写成 `{ kind: 'failed' }`，于是它落到 `else`（retryable）那一支，
    //    断言自然不成立。这个错误本身值得留着：**返回值里的枚举和结果里的枚举
    //    不是同一个集合**，混用会让"哪种失败"这件事在类型上就含混掉。
    const summary = await deliverWidgetPushToUser(
      {
        store,
        send: async () => {
          throw new Error('坏行');
        },
      },
      base,
    );
    const outcome = summary.outcomes[0] as unknown as Record<string, unknown>;
    expect(Object.keys(outcome).sort()).toEqual(
      ['failureCount', 'id', 'kind', 'removed', 'reason'].sort(),
    );
    expect(JSON.stringify(summary)).not.toContain('push.example');
  });
});
