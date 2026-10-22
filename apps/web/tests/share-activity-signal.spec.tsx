/**
 * M5 的**接线**判据 —— 不是各段自己的单元测试，是"接起来不断"
 * ==========================================================
 *
 * 计划给这一片的判据是两句：**有信号 ⇒ 拉取**、**无订阅偏好 ⇒ 零打扰**。
 * 前半句由 `verify:collab-sync` 第 11 步在真服务端上证（WS 扇出 → 宿主拉取 → 活动判定），
 * 后半句由 `share-activity-notify.spec.ts` 证投递件本身。这一枚钉的是**中间那段**：
 * `useShareActivitySignal` 这个壳有没有把"过了闸门的清单"交给投递件。
 *
 * 🔴 为什么值得单独一枚：把 `reading.activities` 直接喂给 `deliver...`（漏掉闸门）
 *    在两侧的单测里都是绿的 —— 闸门在 `@heyta/ui` 测过、投递在壳里测过，
 *    **只有接起来那一行**没被任何人测。这正是本仓最高发的失效形状。
 *
 * mock 的只有**边**（那一份共享实例、本地引擎、盘上的日志），
 * 判断本体（`createShareOpsSignalHandler` / `selectNotifiedActivities`）走真实代码。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_NOTIFICATION_PREFS, type ShareNotificationPrefs } from '@heyta/ui';

vi.mock('../src/lib/oplog.js', () => ({
  hasEngine: () => true,
  requireEngine: () => ({ getClientId: () => 'device-test' }),
}));

/**
 * 一次信号拉回**两条**活动（`CRT` + `DEL`，线协议字面量）。
 * 只有这样"只开一档"才量得出闸门在不在：漏掉闸门就是弹两条，过了闸门就是一条。
 *
 * 夹具一份，同时喂"存储"与"拉取"两侧：真实下行会把折叠后的 op 落到盘上，
 * 替身也必须落 —— 否则宿主算出的差集永远是空，测的就不是接线而是夹具。
 * ⚠️ 必须住在 `vi.hoisted` 里：mock 工厂在 import 阶段就执行，那会儿模块体的
 *    `const` 还在暂时性死区。
 */
const rig = vi.hoisted(() => {
  const incoming = [
    {
      id: 'op-c-1',
      clientId: 'device-other',
      timestamp: 1_700_000_000_000,
      vectorClock: { 'device-other': 1 },
      actionType: 'add comment',
      opType: 'CRT',
      entityType: 'COMMENT',
      entityId: 'comment-1',
      schemaVersion: 1,
      payload: { body: '别人写的评论' },
    },
    {
      id: 'op-c-2',
      clientId: 'device-other',
      timestamp: 1_700_000_000_001,
      vectorClock: { 'device-other': 2 },
      actionType: 'delete comment',
      opType: 'DEL',
      entityType: 'COMMENT',
      entityId: 'comment-0',
      schemaVersion: 1,
      payload: {},
    },
  ];
  return { log: { ops: [] as unknown[] }, pulled: 0, incoming };
});

vi.mock('../src/features/share/comment-actions.js', () => ({
  createStorageShareLog: () => ({
    load: () => rig.log,
    save: (_id: string, state: { ops: unknown[] }) => void (rig.log = state),
    list: () => ['share-1'],
    cursor: () => 0,
    setCursor: () => undefined,
  }),
}));

/*
 * M2 起这一片不再自己 `createWebShareComments`，而是问 `share-session.ts` 要那一份
 * （这台会话里只有一份，合并视图与写路由读的是它的缓存）。
 * ⚠️ 这里**必须**替身整枚模块而不是让它真跑：真实现会去读同步 store 的登录态并建 vault 会话，
 * 而那两件事各有自己的判据（`share-session.spec.ts`），混进来就分不清是哪一格坏了。
 */
vi.mock('../src/features/share/share-session.js', () => ({
  ensureWebShareSession: async () => ({
    actions: {},
    channel: { dispatch: async () => undefined, stateFor: () => ({}) },
    commentsForTask: () => [],
    pullForTask: async () => undefined,
    pullShareOps: async () => {
      rig.pulled += 1;
      const fresh = rig.incoming.filter(
        (op) => !rig.log.ops.some((e) => (e as { id: string }).id === op.id),
      );
      rig.log = { ops: [...rig.log.ops, ...fresh] };
      return { fetched: fresh.length, added: fresh.length, cursor: 7, pages: 1 };
    },
  }),
}));

import { PREFS_STORAGE_KEY } from '../src/features/share/share-notif-prefs.js';
import { useShareActivitySignal } from '../src/features/share/use-share-activity-signal.js';
import { dispatchShareSignal, hasShareSignalSink } from '../src/lib/share-signal-sink.js';
import { useSyncStore } from '../src/features/sync/store.js';

type Recorded = { title: string; options?: { body?: string; tag?: string } };

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let sent: Recorded[] = [];

/** 记账用的 `globalThis.Notification` 替身（jsdom 里没有真的，也不该有）。 */
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  constructor(title: string, options?: { body?: string; tag?: string }) {
    sent.push({ title, options });
  }
}

function SignalHost(): null {
  useShareActivitySignal();
  return null;
}

const setPrefs = (prefs: Partial<ShareNotificationPrefs>) => {
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
};

/** 信号进来之后那串 await 要走完，所以冲刷一个宏任务而不是只排空微任务。 */
const fireSignal = async (shareId: string, latestSeq: number) => {
  await act(async () => {
    dispatchShareSignal(shareId, latestSeq);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(async () => {
  rig.log = { ops: [] };
  rig.pulled = 0;
  sent = [];
  localStorage.clear();
  (globalThis as unknown as { Notification: unknown }).Notification = FakeNotification;
  useSyncStore.setState({
    baseUrl: 'http://sync.test',
    token: 'tok-test',
    accountId: 'acct-test',
    authTransport: 'bearer',
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<SignalHost />);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  delete (globalThis as unknown as { Notification: unknown }).Notification;
});

describe('useShareActivitySignal · 信号 → 闸门 → 投递', () => {
  it('挂载之后本机就是信号消费者', () => {
    expect(hasShareSignalSink()).toBe(true);
  });

  it('🔴 偏好全关时来一条信号 ⇒ 照样去拉（内容要落到本机日志），但一条都不弹', async () => {
    setPrefs(DEFAULT_NOTIFICATION_PREFS);
    await fireSignal('share-1', 7);
    expect(rig.pulled, '拉取不该被偏好挡住 —— 挡住就是不收敛了').toBe(1);
    expect(sent, '无订阅偏好 ⇒ 零打扰').toHaveLength(0);
  });

  it('🔴 只开"有人新增评论" ⇒ 到达的两类里只弹一条，tag 精确到这一代', async () => {
    setPrefs({
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { ...DEFAULT_NOTIFICATION_PREFS.activities, onAdded: true },
    });
    await fireSignal('share-1', 7);
    expect(rig.pulled).toBe(1);
    expect(sent.map((s) => s.options?.tag)).toEqual(['share:share-1:added:7']);
  });

  it('两档都开 ⇒ 两条都弹（闸门不是"只留第一条"那种写法）', async () => {
    setPrefs({
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: {
        ...DEFAULT_NOTIFICATION_PREFS.activities,
        onAdded: true,
        onDeleted: true,
      },
    });
    await fireSignal('share-1', 7);
    expect(sent.map((s) => s.options?.tag)).toEqual([
      'share:share-1:added:7',
      'share:share-1:deleted:7',
    ]);
  });

  it('本机没有这份 share ⇒ 一次请求都不发（信号是按账号扇的，不是按设备）', async () => {
    setPrefs({
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { ...DEFAULT_NOTIFICATION_PREFS.activities, onAdded: true },
    });
    await fireSignal('share-本机没有', 3);
    expect(rig.pulled).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('卸载之后注销消费者（注册点唯一，不留第二个读者）', () => {
    act(() => root?.unmount());
    root = undefined;
    expect(hasShareSignalSink()).toBe(false);
  });
});
