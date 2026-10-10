/**
 * 提醒投递 —— **"到点了真的告诉用户"**
 * ======================================
 *
 * ## 这个文件防的是什么
 *
 * 2026-09-29 实测：`features/reminders/store.ts` 的 `due`（注释写着
 * "**已到点、还没投递的提醒**"）**被算出来并写进 state，而没有任何东西读它**；
 * 全仓也**一个 `new Notification(` 都没有**。
 *
 * ⇒ 用户可以建提醒、提醒能同步、能到点，但**到点之后什么事都不会发生**。
 * 这就是 13 项复核里第 2 项"只有订阅、没有显示路径"的真实形态。
 *
 * ## 🔴 判据为什么是"投了几条、投的是什么"
 *
 * 用**注入假 ctor** 的方式测：真 `Notification` 在 jsdom 里不存在，
 * 而且真去调它会弹系统通知（测试不该有副作用）。
 * 于是"选哪几条、跳过哪几条、正文是不是任务标题"全都可断言 ——
 * 而这些正是会出错的地方。**"调了 Notification"本身不算判据**。
 */

import { describe, expect, it } from 'vitest';

import type { Reminder, Task } from '@heyta/domain';

import {
  deliverDueReminders,
  notificationPermission,
  notificationsSupported,
  requestNotificationPermission,
  type NotificationCtor,
} from '../src/features/reminders/notify.js';

/** 记账用的假通知构造器。 */
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
  (ctor as { requestPermission?: () => Promise<NotificationPermission> }).requestPermission = () =>
    Promise.resolve('granted');
  return { ctor, calls };
}

function task(id: string, title: string): Task {
  return { id, title, createdAt: 0, updatedAt: 0 } as Task;
}

function reminder(id: string, taskId: string, triggerAt = 1000): Reminder {
  return { id, taskId, triggerAt, createdAt: 0, updatedAt: 0 } as Reminder;
}

const LABELS = { title: 'heyta', body: (t: string) => `该做「${t}」了` };

describe('notificationsSupported', () => {
  it('没有 Notification（jsdom 默认）时是 false —— 不抛', () => {
    expect(notificationsSupported(undefined)).toBe(false);
  });

  it('有构造器但 `permission` 不是字符串时也当不支持', () => {
    // ⚠️ 非安全上下文（http:// 自托管）下 `new Notification()` 会直接抛。
    // 只判 `typeof === 'function'` 会把它误判成"可用"。
    const weird = function (): unknown {
      return {};
    } as unknown as NotificationCtor;
    expect(notificationsSupported(weird)).toBe(false);
  });

  it('正常的构造器是 true', () => {
    expect(notificationsSupported(fakeCtor().ctor)).toBe(true);
  });
});

describe('notificationPermission', () => {
  it('不支持时返回独立状态，界面才能给出正确说明', () => {
    expect(notificationPermission(undefined)).toBe('unsupported');
  });

  it('透传真实权限', () => {
    expect(notificationPermission(fakeCtor('default').ctor)).toBe('default');
    expect(notificationPermission(fakeCtor('granted').ctor)).toBe('granted');
  });
});

describe('requestNotificationPermission', () => {
  it('调用底层 requestPermission 并透传结果', async () => {
    const { ctor } = fakeCtor('default');
    await expect(requestNotificationPermission(ctor)).resolves.toBe('granted');
  });

  it('底层抛错时返回 `error`（**永不抛**）', async () => {
    const ctor = function (): unknown {
      return {};
    } as unknown as NotificationCtor;
    (ctor as { permission: NotificationPermission }).permission = 'default';
    (ctor as { requestPermission: () => Promise<NotificationPermission> }).requestPermission = () =>
      Promise.reject(new Error('被策略拒绝'));
    await expect(requestNotificationPermission(ctor)).resolves.toBe('error');
  });
});

describe('deliverDueReminders', () => {
  it('🔴 到点的那一条**真的投出去了**，且正文是任务标题', () => {
    const { ctor, calls } = fakeCtor('granted');
    const outcome = deliverDueReminders(
      [reminder('r1', 't1')],
      { t1: task('t1', '交周报') },
      new Set(),
      LABELS,
      ctor,
    );

    expect(outcome.delivered).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toBe('heyta');
    // 正文里必须**真的是那条任务**，而不是一句泛泛的"你有新提醒" ——
    // 那正是"没有显示路径"与"有显示路径"的分界。
    expect(calls[0]?.options?.body).toBe('该做「交周报」了');
  });

  it('🔴 同一条提醒**只投一次**（否则每次 op 都会重投，通知栏被刷屏）', () => {
    const { ctor, calls } = fakeCtor('granted');
    const shown = new Set<string>();
    const due = [reminder('r1', 't1')];
    const tasks = { t1: task('t1', '交周报') };

    deliverDueReminders(due, tasks, shown, LABELS, ctor);
    const second = deliverDueReminders(due, tasks, shown, LABELS, ctor);

    expect(calls, '第二次不该再投').toHaveLength(1);
    // 第二次没有新投的 —— 但**不是** permission 问题，所以 reason 不该是那个。
    expect(second.reason).toBe('permission');
    expect(second.delivered).toBe(0);
  });

  it('权限不是 `granted` 时**一条都不投**，且 reason 说清是权限', () => {
    const { ctor, calls } = fakeCtor('default');
    const outcome = deliverDueReminders(
      [reminder('r1', 't1')],
      { t1: task('t1', '交周报') },
      new Set(),
      LABELS,
      ctor,
    );
    expect(calls).toHaveLength(0);
    expect(outcome).toEqual({ delivered: 0, deliveredIds: [], reason: 'permission' });
  });

  it('浏览器不支持时 reason 是 `unsupported`（与"权限被拒"区分开）', () => {
    const outcome = deliverDueReminders(
      [reminder('r1', 't1')],
      { t1: task('t1', '交周报') },
      new Set(),
      LABELS,
      undefined,
    );
    expect(outcome).toEqual({ delivered: 0, deliveredIds: [], reason: 'unsupported' });
  });

  it('没有到点的提醒时 reason 是 `empty`，**不去碰权限**', () => {
    const outcome = deliverDueReminders([], {}, new Set(), LABELS, undefined);
    expect(outcome).toEqual({ delivered: 0, deliveredIds: [], reason: 'empty' });
  });

  it('任务已被删掉时跳过它，但不影响其余几条', () => {
    const { ctor, calls } = fakeCtor('granted');
    const outcome = deliverDueReminders(
      [reminder('r-gone', 'missing'), reminder('r2', 't2')],
      { t2: task('t2', '还在的任务') },
      new Set(),
      LABELS,
      ctor,
    );
    // 墓碑与提醒是两条记录，所以"提醒还在、任务没了"是真实存在的状态。
    expect(outcome.delivered).toBe(1);
    expect(calls.map((c) => c.options?.body)).toEqual(['该做「还在的任务」了']);
  });

  /**
   * 🔴 缺陷 D1 的投递面那一半：`task === undefined` **挡不住墓碑任务**。
   *
   * 已软删除的任务在表里是**存在**的（`deletedAt` 有值），而这里原来只判"在不在"，
   * 注释却写着"这种情况不投"。所以这一组必须喂一张**含墓碑的表** ——
   * 那正是动作层 `due()` 之外、调用方可能递进来的真实形状。
   */
  it('🔴 任务在表里但带 deletedAt（回收站）时不投，其余几条照投', () => {
    const { ctor, calls } = fakeCtor('granted');
    const trashed = { id: 't-gone', title: '已删除的任务', createdAt: 0, updatedAt: 0, deletedAt: 999 } as Task;
    const outcome = deliverDueReminders(
      [reminder('r-gone', 't-gone'), reminder('r2', 't2')],
      { 't-gone': trashed, t2: task('t2', '还在的任务') },
      new Set(),
      LABELS,
      ctor,
    );
    expect(outcome.delivered, '墓碑任务那条不该投出去').toBe(1);
    expect(calls.map((c) => c.options?.body)).toEqual(['该做「还在的任务」了']);
  });

  it('🔴 已彻底删除（purgedAt）的任务同样不投', () => {
    const { ctor, calls } = fakeCtor('granted');
    const purged = {
      id: 't-purged',
      title: '彻底删除的任务',
      createdAt: 0,
      updatedAt: 0,
      deletedAt: 999,
      purgedAt: 1000,
    } as Task;
    const outcome = deliverDueReminders([reminder('r-p', 't-purged')], { 't-purged': purged }, new Set(), LABELS, ctor);
    expect(outcome.delivered).toBe(0);
    expect(calls).toHaveLength(0);
  });

  /**
   * 🔴 投出去的是**哪几条**必须交回给调用方（缺陷 D14 的前半）。
   *
   * 只有条数的话，调用方无法把"firedAt"写到正确的提醒上 —— 而那正是
   * "刷新一次就再弹一遍"的根因：内存 `shown` 集合跨不了页面加载，
   * 落库靠的是 id。
   */
  it('deliveredIds 精确等于真投出去的那几条 id（顺序同输入）', () => {
    const { ctor } = fakeCtor('granted');
    const shown = new Set(['skip-me']);
    const outcome = deliverDueReminders(
      [reminder('skip-me', 't1'), reminder('a', 't1'), reminder('b', 't1')],
      { t1: task('t1', '交周报') },
      shown,
      LABELS,
      ctor,
    );
    expect(outcome.deliveredIds).toEqual(['a', 'b']);
    expect(outcome.delivered).toBe(outcome.deliveredIds.length);
  });

  it('一条都没投出去时 deliveredIds 是空数组（而不是 undefined）', () => {
    const outcome = deliverDueReminders([], {}, new Set(), LABELS, fakeCtor('granted').ctor);
    expect(outcome.deliveredIds).toEqual([]);
  });

  it('构造抛错时**不中断**其余几条，也不把那条记成已投', () => {
    const calls: string[] = [];
    const ctor = function (this: unknown, title: string, options?: { body?: string }): unknown {
      const body = options?.body ?? '';
      if (body.includes('坏')) throw new Error('系统级静默');
      calls.push(body);
      return {};
    } as unknown as NotificationCtor;
    (ctor as { permission: NotificationPermission }).permission = 'granted';

    const outcome = deliverDueReminders(
      [reminder('bad', 'tbad'), reminder('good', 'tgood')],
      { tbad: task('tbad', '坏掉的那条'), tgood: task('tgood', '正常的那条') },
      new Set(),
      LABELS,
      ctor,
    );
    expect(outcome.delivered).toBe(1);
    expect(calls).toEqual(['该做「正常的那条」了']);
  });

  it('`tag` 用提醒 id —— 同一条的重复投递在通知中心会合并而不是堆叠', () => {
    const { ctor, calls } = fakeCtor('granted');
    deliverDueReminders(
      [reminder('r-xyz', 't1')],
      { t1: task('t1', '交周报') },
      new Set(),
      LABELS,
      ctor,
    );
    expect(calls[0]?.options?.tag).toBe('r-xyz');
  });
});
