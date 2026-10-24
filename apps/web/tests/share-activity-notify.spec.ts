/**
 * M5 壳这一层的投递判据 —— 计划写的那句「**无订阅偏好 ⇒ 零打扰**」落在这里。
 * ============================================================================
 *
 * ## 为什么这组断言值得存在
 *
 * "该不该响"的判断在 `@heyta/ui`（`selectNotifiedActivities`），拉到什么活动
 * 的判断在 `@heyta/app-host`（`share-signals`），两边各有单测。而**接起来断**
 * 才是本仓最高发的失效形状：谓词返回了 `[]`，壳却照样弹；或者偏好读盘读出一块
 * 坏数据 ⇒ 整节回落 ⇒ 用户关掉的开关又响了。所以这里测的是**接线之后**的行为：
 * 从磁盘偏好 + 一批到达的活动，一路到"构造器被叫了几次、带的是什么 tag"。
 *
 * 🔴 假 ctor 计数是唯一算数的读数。"调了 Notification"本身不算判据 ——
 *    判的是**没该响的时候一次都没调**。
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTIFICATION_PREFS, selectNotifiedActivities } from '@heyta/ui';

import {
  deliverShareActivityNotifications,
  type ShareActivityNotifyLabels,
} from '../src/features/share/share-activity-notify.js';
import {
  PREFS_STORAGE_KEY,
  loadShareNotificationPrefs,
  saveShareNotificationPrefs,
} from '../src/features/share/share-notif-prefs.js';
import type { NotificationCtor } from '../src/features/reminders/notify.js';
import {
  dispatchShareSignal,
  hasShareSignalSink,
  setShareSignalSink,
} from '../src/lib/share-signal-sink.js';

/** 与 `reminder-notify.spec.ts` 同形状的记账构造器（真 Notification 在 jsdom 里不存在，而且会有副作用）。 */
function fakeCtor(permission: NotificationPermission = 'granted'): {
  ctor: NotificationCtor;
  calls: { title: string; options?: { body?: string; tag?: string } }[];
} {
  const calls: { title: string; options?: { body?: string; tag?: string } }[] = [];
  const ctor = function (
    this: unknown,
    title: string,
    options?: { body?: string; tag?: string },
  ): unknown {
    calls.push({ title, options });
    return {};
  } as unknown as NotificationCtor;
  (ctor as { permission: NotificationPermission }).permission = permission;
  return { ctor, calls };
}

/** 内存 Storage，形状对齐 localStorage（DOM 类型齐全，不然 typecheck 不过）。 */
const makeStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => void map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as Storage;
};

const LABELS: ShareActivityNotifyLabels = {
  title: 'heyta',
  body: (kind) => `正文:${kind}`,
};

const SHARE = 'share-77';
const SEQ = 5;

describe('共享活动投递 · 偏好闸门', () => {
  it('🔴 默认偏好（三档全关）⇒ 构造器一次都没被叫', () => {
    const { ctor, calls } = fakeCtor();
    const toSurface = selectNotifiedActivities(loadShareNotificationPrefs(makeStorage()), [
      'added',
      'deleted',
    ]);
    expect(toSurface).toEqual([]);
    expect(deliverShareActivityNotifications(toSurface, SHARE, SEQ, LABELS, ctor)).toEqual({
      delivered: 0,
      reason: 'empty',
    });
    expect(calls, '没订阅就是零打扰 —— 这条臂防的是"过了闸门还是照弹"').toHaveLength(0);
  });

  it('磁盘上那块 JSON 坏了 ⇒ 回落默认（全关），仍然是零打扰', () => {
    const storage = makeStorage();
    storage.setItem(PREFS_STORAGE_KEY, '{ 不是 JSON');
    const { ctor, calls } = fakeCtor();
    const toSurface = selectNotifiedActivities(loadShareNotificationPrefs(storage), ['added']);
    deliverShareActivityNotifications(toSurface, SHARE, SEQ, LABELS, ctor);
    expect(toSurface).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('只开"新增" ⇒ 到达里有"删除"也不投它（一条，且正文来自词表）', () => {
    const storage = makeStorage();
    saveShareNotificationPrefs(storage, {
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { ...DEFAULT_NOTIFICATION_PREFS.activities, onAdded: true },
    });
    const { ctor, calls } = fakeCtor();
    const toSurface = selectNotifiedActivities(loadShareNotificationPrefs(storage), [
      'deleted',
      'added',
    ]);
    expect(toSurface).toEqual(['added']);
    expect(deliverShareActivityNotifications(toSurface, SHARE, SEQ, LABELS, ctor)).toEqual({
      delivered: 1,
    });
    expect(calls).toEqual([{ title: 'heyta', options: { body: '正文:added', tag: `share:${SHARE}:added:${String(SEQ)}` } }]);
  });
});

describe('共享活动投递 · tag 与失败形状', () => {
  it('🔴 tag 带到 latestSeq：同一条信号在通知中心合并，下一条新评论不能被合并掉', () => {
    const a = fakeCtor();
    deliverShareActivityNotifications(['added'], SHARE, SEQ, LABELS, a.ctor);
    const b = fakeCtor();
    deliverShareActivityNotifications(['added'], SHARE, SEQ + 1, LABELS, b.ctor);
    expect(a.calls[0]?.options?.tag).toBe(`share:${SHARE}:added:5`);
    expect(b.calls[0]?.options?.tag).toBe(`share:${SHARE}:added:6`);
    expect(a.calls[0]?.options?.tag).not.toBe(b.calls[0]?.options?.tag);
  });

  it('两类活动同时到达 ⇒ 两条通知、两个 tag（不是一条带过）', () => {
    const { ctor, calls } = fakeCtor();
    expect(deliverShareActivityNotifications(['added', 'deleted'], SHARE, SEQ, LABELS, ctor)).toEqual({
      delivered: 2,
    });
    expect(calls.map((c) => c.options?.tag)).toEqual([
      `share:${SHARE}:added:${String(SEQ)}`,
      `share:${SHARE}:deleted:${String(SEQ)}`,
    ]);
  });

  it('权限没给 ⇒ 零投递、reason=permission，而且不去构造', () => {
    const { ctor, calls } = fakeCtor('denied');
    expect(deliverShareActivityNotifications(['added'], SHARE, SEQ, LABELS, ctor)).toEqual({
      delivered: 0,
      reason: 'permission',
    });
    expect(calls).toHaveLength(0);
  });

  it('这台设备根本没有 Notification（jsdom / 非安全上下文）⇒ reason=unsupported，不抛', () => {
    expect(() =>
      deliverShareActivityNotifications(['added'], SHARE, SEQ, LABELS, undefined),
    ).not.toThrow();
    expect(deliverShareActivityNotifications(['added'], SHARE, SEQ, LABELS, undefined)).toEqual({
      delivered: 0,
      reason: 'unsupported',
    });
  });

  it('正文是上游组装好的那一句：投递件只拿得到标题 + 一句活动描述', () => {
    // ADR-0071：正文里**允许**有清单名，条目内容不许 —— 那句话由 `shareActivityNotificationBody`
    // 组装（判据在 `share-notification-content.spec.tsx`）。这一枚钉的是投递件这一层的
    // **接口形状**：它只拿得到标题、body、tag，没有第二个口子能塞进内容（不是运行时扫描）。
    const { ctor, calls } = fakeCtor();
    deliverShareActivityNotifications(['added'], SHARE, SEQ, LABELS, ctor);
    const options = calls[0]?.options ?? {};
    expect(Object.keys(options).sort()).toEqual(['body', 'tag']);
  });
});

describe('信号垫片', () => {
  it('未注册消费者 ⇒ 信号被丢掉且不抛（注册点在根组件，另有判据）', () => {
    setShareSignalSink(undefined);
    expect(hasShareSignalSink()).toBe(false);
    expect(() => dispatchShareSignal(SHARE, SEQ)).not.toThrow();
  });

  it('注册后 ⇒ (shareId, latestSeq) 原样递出去；注销后不再递', () => {
    const seen: [string, number][] = [];
    setShareSignalSink((shareId, latestSeq) => seen.push([shareId, latestSeq]));
    dispatchShareSignal(SHARE, SEQ);
    setShareSignalSink(undefined);
    dispatchShareSignal(SHARE, SEQ + 1);
    expect(seen).toEqual([[SHARE, SEQ]]);
    expect(hasShareSignalSink()).toBe(false);
  });
});
