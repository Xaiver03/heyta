/**
 * 触发点：同步之后通知小组件。
 * ==============================
 *
 * 🔴 这个文件要挡的是**"推送把同步搞坏"**和**"载荷里有用户数据"**这两类错误。
 *
 * 调用点在同步热路径上（`uploadOpsHandler`）。那里任何一次抛出都会让
 * **用户的任务同步失败** —— 而"组件没刷新"与"任务没同步"完全不是一个量级。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureWidgetPush,
  isWidgetPushConfigured,
  notifyWidgetSubscribers,
  PUSH_COALESCE_WINDOW_MS,
  resetWidgetPushCoalesce,
  WIDGET_REFRESH_PAYLOAD,
} from '../src/push/notify';
import type { PushSubscriptionStore, StoredPushSubscription } from '../src/push/subscriptions';

const VAPID = { privateKey: Buffer.alloc(32, 1), publicKey: Buffer.alloc(65, 2) };

function fakeStore(rows: StoredPushSubscription[]) {
  const calls: string[] = [];
  const store: PushSubscriptionStore = {
    async upsert() {
      calls.push('upsert');
      return { id: 0 };
    },
    async listForUser() {
      calls.push('listForUser');
      return rows;
    },
    async deleteById(id) {
      calls.push(`delete:${id}`);
    },
    async recordSuccess(id) {
      calls.push(`success:${id}`);
    },
    async incrementFailure(id) {
      calls.push(`fail:${id}`);
      return 1;
    },
    async deleteByEndpoint() {
      calls.push('deleteByEndpoint');
      return 0;
    },
  };
  return { store, calls };
}

const SUB: StoredPushSubscription = {
  id: 1,
  endpoint: 'https://push.example/abc',
  p256dh: 'p',
  auth: 'a',
};

/** 每次测试后都要复位模块级状态，否则合并窗口会跨用例生效。 */
afterEach(() => {
  configureWidgetPush(null);
  resetWidgetPushCoalesce();
  vi.restoreAllMocks();
});

describe('🔴 没配 VAPID 时什么都不做 —— 包括一次数据库查询', () => {
  it('未配置时 listForUser 都不被调用', async () => {
    const { store, calls } = fakeStore([SUB]);
    // ⚠️ **不**调用 configureWidgetPush（等价于没配 VAPID）。
    await notifyWidgetSubscribers(1, { store });
    // 自托管是默认形态，而这是同步热路径 —— 每一次多余查询
    // 都会被乘以每个用户、每次上传。
    expect(calls).toEqual([]);
  });

  it('isWidgetPushConfigured 反映真实状态', () => {
    expect(isWidgetPushConfigured()).toBe(false);
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    expect(isWidgetPushConfigured()).toBe(true);
  });

  it('configureWidgetPush(null) 之后又变回未配置', () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    configureWidgetPush(null);
    expect(isWidgetPushConfigured()).toBe(false);
  });

  it('配了但没有 store 时只警告、不抛', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    await expect(notifyWidgetSubscribers(1)).resolves.toBeUndefined();
  });
});

describe('载荷不含任何用户数据', () => {
  it('🔴 载荷是一个固定的小 JSON，只说明「醒一醒」', () => {
    const parsed = JSON.parse(WIDGET_REFRESH_PAYLOAD) as Record<string, unknown>;
    expect(parsed).toEqual({ type: 'heyta:widget-refresh' });
    // 服务端**没有密钥**，造不出 E2EE 快照 —— 所以载荷里不可能、
    // 也不应该有任何任务数据。
    expect(WIDGET_REFRESH_PAYLOAD).not.toMatch(/title|task|due|完成|任务/i);
  });

  it('实际发出去的明文就是这个固定载荷', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const seen: string[] = [];
    const { store } = fakeStore([SUB]);
    await notifyWidgetSubscribers(1, {
      store,
      send: (async (input: { plaintext: string }) => {
        seen.push(input.plaintext);
        return { kind: 'sent' as const, bodyBytes: 144 };
      }) as never,
    });
    expect(seen).toEqual([WIDGET_REFRESH_PAYLOAD]);
  });
});

describe('🔴 合并窗口：勾 5 个任务不能发 5 条推送', () => {
  it('窗口内第二次调用不再发送', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store, calls } = fakeStore([SUB]);
    const send = (async () => ({ kind: 'sent' as const, bodyBytes: 144 })) as never;

    await notifyWidgetSubscribers(1, { store, send, nowMs: 1_000_000 });
    await notifyWidgetSubscribers(1, { store, send, nowMs: 1_000_000 + 1_000 });

    // 第二次连 listForUser 都不该做。
    expect(calls.filter((c) => c === 'listForUser')).toHaveLength(1);
  });

  it('过了窗口就会再发一次', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store, calls } = fakeStore([SUB]);
    const send = (async () => ({ kind: 'sent' as const, bodyBytes: 144 })) as never;

    await notifyWidgetSubscribers(1, { store, send, nowMs: 1_000_000 });
    await notifyWidgetSubscribers(1, {
      store,
      send,
      nowMs: 1_000_000 + PUSH_COALESCE_WINDOW_MS,
    });

    expect(calls.filter((c) => c === 'listForUser')).toHaveLength(2);
  });

  it('🔴 合并是按用户的，一个用户不该压掉另一个用户', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store, calls } = fakeStore([SUB]);
    const send = (async () => ({ kind: 'sent' as const, bodyBytes: 144 })) as never;

    await notifyWidgetSubscribers(1, { store, send, nowMs: 1_000_000 });
    await notifyWidgetSubscribers(2, { store, send, nowMs: 1_000_000 });

    expect(calls.filter((c) => c === 'listForUser')).toHaveLength(2);
  });

  it('resetWidgetPushCoalesce 会清掉窗口', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store, calls } = fakeStore([SUB]);
    const send = (async () => ({ kind: 'sent' as const, bodyBytes: 144 })) as never;

    await notifyWidgetSubscribers(1, { store, send, nowMs: 1_000_000 });
    resetWidgetPushCoalesce();
    await notifyWidgetSubscribers(1, { store, send, nowMs: 1_000_001 });

    expect(calls.filter((c) => c === 'listForUser')).toHaveLength(2);
  });
});

describe('🔴 从不抛异常 —— 推送失败不能让同步失败', () => {
  it('store.listForUser 抛异常时被吞掉', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const store = {
      listForUser: async () => {
        throw new Error('数据库连不上');
      },
    } as unknown as PushSubscriptionStore;
    // 这一条是**承重**的：调用方在同步热路径上。
    await expect(notifyWidgetSubscribers(1, { store })).resolves.toBeUndefined();
  });

  it('发送抛异常时被吞掉', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store } = fakeStore([SUB]);
    await expect(
      notifyWidgetSubscribers(1, {
        store,
        send: (async () => {
          throw new Error('EADDRNOTAVAIL');
        }) as never,
      }),
    ).resolves.toBeUndefined();
  });

  it('recordSuccess 抛异常时也被吞掉', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const store = {
      listForUser: async () => [SUB],
      recordSuccess: async () => {
        throw new Error('写台账失败');
      },
      deleteById: async () => {},
      incrementFailure: async () => 1,
      upsert: async () => ({ id: 0 }),
      deleteByEndpoint: async () => 0,
    } as unknown as PushSubscriptionStore;
    await expect(
      notifyWidgetSubscribers(1, {
        store,
        send: (async () => ({ kind: 'sent' as const, bodyBytes: 144 })) as never,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('结果被正确转译到订阅台账', () => {
  it('gone → 删掉那一行', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store, calls } = fakeStore([SUB]);
    await notifyWidgetSubscribers(1, {
      store,
      send: (async () => ({ kind: 'gone' as const, bodyBytes: 0 })) as never,
    });
    expect(calls).toContain('delete:1');
  });

  it('🔴 rejected → **不**计数、**不**删除（那是我们自己的 bug）', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store, calls } = fakeStore([SUB]);
    await notifyWidgetSubscribers(1, {
      store,
      send: (async () => ({ kind: 'rejected' as const, reason: 'VAPID 错', bodyBytes: 0 })) as never,
    });
    expect(calls).not.toContain('fail:1');
    expect(calls).not.toContain('delete:1');
  });

  it('🔴 retryable → **不**计数（推送服务的问题不是用户的错）', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store, calls } = fakeStore([SUB]);
    await notifyWidgetSubscribers(1, {
      store,
      send: (async () => ({ kind: 'retryable' as const, bodyBytes: 0 })) as never,
    });
    expect(calls).not.toContain('fail:1');
  });

  it('sent → 记成功', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store, calls } = fakeStore([SUB]);
    await notifyWidgetSubscribers(1, {
      store,
      send: (async () => ({ kind: 'sent' as const, bodyBytes: 144 })) as never,
    });
    expect(calls).toContain('success:1');
  });

  it('没有订阅时静默结束', async () => {
    configureWidgetPush({ vapidKeys: VAPID, subject: 'mailto:a@b.c' }, null);
    const { store, calls } = fakeStore([]);
    await notifyWidgetSubscribers(1, { store });
    expect(calls).toEqual(['listForUser']);
  });
});
