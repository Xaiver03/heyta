/**
 * 通知中心 / 活动读取层的测试。
 *
 * 🔴 这一组守两件事，都不是"解析对不对"那么轻：
 *
 * 1. **E2EE 硬约束的机械保障。** 这三个请求为了显示通知而发出，
 *    所以它们**一个任务字段都不许带**。这里不看注释，直接抓真正传进
 *    `fetch` 的 `RequestInit` 来断言（与 `entitlement.spec.ts` 同一手法）。
 * 2. **fail-open 且方向正确。** 未配置 / 没令牌 / 断网 / 非 2xx / 响应畸形，
 *    一律不许被解读成"没有通知" —— 那会让用户以为自己没有未读。
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_PATH,
  NOTIFICATIONS_PATH,
  NOTIFICATIONS_READ_PATH,
  fetchAccountNotifications,
  fetchActivityFeed,
  markNotificationsRead,
  type InboxRequestOptions,
} from '../src/inbox.js';

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function recordingFetch(
  responder: (url: string) => { status: number; body?: unknown; jsonThrows?: boolean },
): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const spec = responder(String(input));
    return Promise.resolve({
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      json: () =>
        spec.jsonThrows === true
          ? Promise.reject(new Error('not json'))
          : Promise.resolve(spec.body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const BASE: InboxRequestOptions = {
  baseUrl: 'http://127.0.0.1:3000',
  getToken: async () => 'tok-1',
};

const okJson = (body: unknown) => () => ({ status: 200, body });

describe('E2EE：请求里不含任何用户内容', () => {
  it('读取通知是一次不带 body 的 GET', async () => {
    const { impl, calls } = recordingFetch(okJson({ notifications: [], unreadCount: 0 }));
    await fetchAccountNotifications({ ...BASE, fetchImpl: impl });

    expect(calls).toHaveLength(1);
    const init = calls[0]!.init!;
    expect(init.method).toBe('GET');
    expect('body' in init).toBe(false);
    // URL 里也没有实体 / op / 任务字段。
    expect(calls[0]!.url).toBe(`http://127.0.0.1:3000${NOTIFICATIONS_PATH}`);
  });

  it('读取活动是一次不带 body 的 GET', async () => {
    const { impl, calls } = recordingFetch(okJson({ campaigns: [] }));
    await fetchActivityFeed({ ...BASE, fetchImpl: impl });

    const init = calls[0]!.init!;
    expect(init.method).toBe('GET');
    expect('body' in init).toBe(false);
    expect(calls[0]!.url).toBe(`http://127.0.0.1:3000${ACTIVITY_PATH}`);
  });

  it('🔴 标记已读的 body 里**只有通知 id**，没有任何任务内容', async () => {
    const { impl, calls } = recordingFetch(okJson({ updated: 2, unreadCount: 0 }));
    await markNotificationsRead({ ...BASE, fetchImpl: impl, ids: [3, 4] });

    const init = calls[0]!.init!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ ids: [3, 4] });
    expect(calls[0]!.url).toBe(`http://127.0.0.1:3000${NOTIFICATIONS_READ_PATH}`);
  });

  it('带身份：Authorization 头就是那个令牌', async () => {
    const { impl, calls } = recordingFetch(okJson({ notifications: [], unreadCount: 0 }));
    await fetchAccountNotifications({ ...BASE, fetchImpl: impl });

    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-1');
  });
});

describe('fail-open：读不到 ≠ 没有通知', () => {
  it('未配置服务器 → unconfigured，且**一个请求都不发**', async () => {
    const { impl, calls } = recordingFetch(okJson({}));
    const reading = await fetchAccountNotifications({
      ...BASE,
      baseUrl: '   ',
      fetchImpl: impl,
    });

    expect(reading).toEqual({ kind: 'unconfigured' });
    expect(calls).toHaveLength(0);
  });

  it('没有令牌 → unavailable/no-token，也不发请求', async () => {
    const { impl, calls } = recordingFetch(okJson({}));
    const reading = await fetchAccountNotifications({
      ...BASE,
      getToken: async () => undefined,
      fetchImpl: impl,
    });

    expect(reading).toEqual({ kind: 'unavailable', cause: 'no-token' });
    expect(calls).toHaveLength(0);
  });

  it('断网 → unavailable/network（不抛）', async () => {
    const impl = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const reading = await fetchAccountNotifications({ ...BASE, fetchImpl: impl });
    expect(reading).toEqual({ kind: 'unavailable', cause: 'network' });
  });

  it('非 2xx → unavailable/http', async () => {
    const { impl } = recordingFetch(() => ({ status: 500, body: {} }));
    const reading = await fetchAccountNotifications({ ...BASE, fetchImpl: impl });
    expect(reading).toEqual({ kind: 'unavailable', cause: 'http' });
  });

  it('响应体不是 JSON → unavailable/malformed', async () => {
    const { impl } = recordingFetch(() => ({ status: 200, jsonThrows: true }));
    const reading = await fetchAccountNotifications({ ...BASE, fetchImpl: impl });
    expect(reading).toEqual({ kind: 'unavailable', cause: 'malformed' });
  });

  it('🔴 形状不对 → malformed，**不是** ready + 空列表', async () => {
    // 这正是"读不到被当成没有通知"的形状：如果这里返回 ready/[]，
    // 界面会显示"还没有通知"，而真相是响应变了。
    const { impl } = recordingFetch(okJson({ unreadCount: 0 }));
    expect(await fetchAccountNotifications({ ...BASE, fetchImpl: impl })).toEqual({
      kind: 'unavailable',
      cause: 'malformed',
    });

    const { impl: impl2 } = recordingFetch(okJson({ notifications: [], unreadCount: 'x' }));
    expect(await fetchAccountNotifications({ ...BASE, fetchImpl: impl2 })).toEqual({
      kind: 'unavailable',
      cause: 'malformed',
    });
  });
});

describe('通知列表解析', () => {
  it('正常的一条能解析出来', async () => {
    const { impl } = recordingFetch(
      okJson({
        notifications: [
          {
            id: 1,
            kind: 'referral-activated',
            payload: { displayName: 'star', days: 5 },
            createdAt: 1_800_000_000_000,
            readAt: null,
          },
        ],
        unreadCount: 1,
      }),
    );

    const reading = await fetchAccountNotifications({ ...BASE, fetchImpl: impl });
    expect(reading.kind).toBe('ready');
    if (reading.kind !== 'ready') return;
    expect(reading.unreadCount).toBe(1);
    expect(reading.notifications).toHaveLength(1);
    expect(reading.notifications[0]).toMatchObject({ id: 1, readAt: null });
  });

  it('🔴 坏的那条被丢掉，好的那条照样出来', async () => {
    const { impl } = recordingFetch(
      okJson({
        notifications: [
          { id: 'not-a-number', kind: 'referral-activated', createdAt: 1, readAt: null },
          { id: 2, kind: 'referral-activated', payload: {}, createdAt: 1, readAt: null },
        ],
        unreadCount: 1,
      }),
    );

    const reading = await fetchAccountNotifications({ ...BASE, fetchImpl: impl });
    expect(reading.kind).toBe('ready');
    if (reading.kind !== 'ready') return;
    expect(reading.notifications.map((n) => n.id)).toEqual([2]);
  });

  it('未读数缺失 → malformed（宁可说读不到，也不显示一个错的 0）', async () => {
    const { impl } = recordingFetch(okJson({ notifications: [] }));
    expect(await fetchAccountNotifications({ ...BASE, fetchImpl: impl })).toEqual({
      kind: 'unavailable',
      cause: 'malformed',
    });
  });

  it('limit 会进查询串；不传时**不拼** limit（默认值只由服务端决定）', async () => {
    const a = recordingFetch(okJson({ notifications: [], unreadCount: 0 }));
    await fetchAccountNotifications({ ...BASE, fetchImpl: a.impl, limit: 5 });
    expect(a.calls[0]!.url).toBe(`http://127.0.0.1:3000${NOTIFICATIONS_PATH}?limit=5`);

    const b = recordingFetch(okJson({ notifications: [], unreadCount: 0 }));
    await fetchAccountNotifications({ ...BASE, fetchImpl: b.impl });
    expect(b.calls[0]!.url).toBe(`http://127.0.0.1:3000${NOTIFICATIONS_PATH}`);
  });
});

describe('标记已读', () => {
  it('不传 ids → 发 `{ all: true }`，而不是空体', async () => {
    // 🔴 服务端刻意不接受"缺省即全部"（见 activity.routes.ts 的 MarkReadSchema）。
    // 这里如果发了空体，服务端会 400 —— 那是**设计如此**：一个客户端 bug
    // 不该能静默清空用户的未读徽标。
    const { impl, calls } = recordingFetch(okJson({ updated: 3, unreadCount: 0 }));
    await markNotificationsRead({ ...BASE, fetchImpl: impl });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ all: true });
  });

  it('成功时回传服务端的 updated / unreadCount', async () => {
    const { impl } = recordingFetch(okJson({ updated: 2, unreadCount: 1 }));
    expect(await markNotificationsRead({ ...BASE, fetchImpl: impl, ids: [1, 2] })).toEqual({
      kind: 'ok',
      updated: 2,
      unreadCount: 1,
    });
  });

  it('响应畸形 → unavailable/malformed（不假装成功）', async () => {
    const { impl } = recordingFetch(okJson({ updated: 'two' }));
    expect(await markNotificationsRead({ ...BASE, fetchImpl: impl })).toEqual({
      kind: 'unavailable',
      cause: 'malformed',
    });
  });
});

describe('活动解析', () => {
  const campaign = {
    id: 'invite-friends',
    kind: 'invite',
    invite: {
      inviteCode: 'ABCD2345',
      rewardDays: 5,
      invited: 3,
      activated: 2,
      daysEarned: 10,
      windowInvited: 3,
      windowCap: 20,
      windowDays: 30,
      referrals: [
        {
          code: 'ABCD2345',
          displayName: 'star',
          createdAt: 1,
          activatedAt: 2,
          rewardDays: 5,
        },
      ],
    },
  };

  it('正常解析（含 referrals）', async () => {
    const { impl } = recordingFetch(okJson({ campaigns: [campaign] }));
    const reading = await fetchActivityFeed({ ...BASE, fetchImpl: impl });
    expect(reading.kind).toBe('ready');
    if (reading.kind !== 'ready') return;
    expect(reading.campaigns[0]!.invite?.inviteCode).toBe('ABCD2345');
    expect(reading.campaigns[0]!.invite?.referrals).toHaveLength(1);
  });

  it('🔴 kind=invite 但进度解析不出来 → **整条活动被丢掉**', async () => {
    // 渲染一张"只有标题、没有任何可操作内容"的活动卡比不渲染更坏：
    // 它看起来像活动坏了，而真实原因是响应形状变了。
    const { impl } = recordingFetch(
      okJson({ campaigns: [{ id: 'invite-friends', kind: 'invite', invite: {} }] }),
    );
    const reading = await fetchActivityFeed({ ...BASE, fetchImpl: impl });
    expect(reading.kind).toBe('ready');
    if (reading.kind !== 'ready') return;
    expect(reading.campaigns).toHaveLength(0);
  });

  it('未知 kind 且没有 invite 字段 → 保留（它可能是一个不需要进度的活动）', async () => {
    const { impl } = recordingFetch(
      okJson({ campaigns: [{ id: 'spring-festival', kind: 'promo' }] }),
    );
    const reading = await fetchActivityFeed({ ...BASE, fetchImpl: impl });
    expect(reading.kind).toBe('ready');
    if (reading.kind !== 'ready') return;
    expect(reading.campaigns).toEqual([{ id: 'spring-festival', kind: 'promo' }]);
  });

  it('campaigns 不是数组 → malformed', async () => {
    const { impl } = recordingFetch(okJson({ campaigns: {} }));
    expect(await fetchActivityFeed({ ...BASE, fetchImpl: impl })).toEqual({
      kind: 'unavailable',
      cause: 'malformed',
    });
  });

  it('invite 里数字缺失 → 整条丢掉（不拿 NaN 渲染统计行）', async () => {
    const broken = {
      ...campaign,
      invite: { ...campaign.invite, daysEarned: undefined },
    };
    const { impl } = recordingFetch(okJson({ campaigns: [broken] }));
    const reading = await fetchActivityFeed({ ...BASE, fetchImpl: impl });
    expect(reading.kind).toBe('ready');
    if (reading.kind !== 'ready') return;
    expect(reading.campaigns).toHaveLength(0);
  });
});
