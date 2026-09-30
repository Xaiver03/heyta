/**
 * 提醒投递的**接线** —— "函数写好了，但有没有人调它？"
 * ========================================================
 *
 * ## 🔴 这个文件与 `reminder-notify.spec.ts` 的分工
 *
 * | 文件 | 钉的东西 | 它**抓不到**的 |
 * |---|---|---|
 * | `reminder-notify.spec.ts` | `deliverDueReminders` 的**纯逻辑**（选哪几条、去重、正文） | 有没有调用点 |
 * | **本文件** | **真 `<App />` 挂起来之后，通知真的出去了** | 具体选了哪几条（上面那个管） |
 *
 * 分开的理由是本仓最高发的那类失效：**纯函数有测试、有覆盖率，而没有任何调用点**。
 * 第 2 项幻觉（"只有订阅、没有显示路径"）正是这个形状 ——
 * `reminders/store.ts` 里 `due` 早就被算出来写进 state 了，**没人读**。
 * 只测纯逻辑的话，那种状态**全绿**。
 *
 * ## 为什么注入假 `Notification` 而不是真的发
 *
 * jsdom 里没有 `Notification`，而且真发会弹系统通知（测试不该有副作用）。
 * 装上假的之后，"真的有人 `new` 了一次"就是可断言的 —— 而那正是接线存在的证据。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useReminderStore } = await import('../src/features/reminders/store.js');

/** 记账用的假通知构造器 —— 每次都记下 title/body。 */
const calls: { title: string; body: string | undefined }[] = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve(FakeNotification.permission);
  }
  constructor(title: string, options?: { body?: string }) {
    calls.push({ title, body: options?.body });
  }
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let dbName: string;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * 轮询等到条件成立。
 *
 * 🔴 **这个文件第一版用的是"建完提醒 → `flush()` 一次 → 断言"，
 * 而它是抖的**（3 次全量里红 1 次）：投递由 **store 变化**驱动，
 * 而 store 由 **op-log 的通知**驱动 —— 那一跳是异步的，快慢取决于
 * 前一条用例留下的调度状态。固定一次 `flush()` 在快的时候够、慢的时候不够。
 *
 * ⚠️ 这类抖动的坏处不是"偶尔红"，而是**它会被当成环境问题而绕过**，
 * 于是那条断言实际上不再保护任何东西。所以改成等到（或超时带现场）。
 */
async function waitFor(label: string, cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await flush();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error(`等待「${label}」超时`);
}

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  await flush();
}

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  calls.length = 0;
  FakeNotification.permission = 'granted';
  (globalThis as unknown as { Notification: unknown }).Notification = FakeNotification;

  dbName = `reminder-wiring-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
});

describe('提醒投递的接线（真 App）', () => {
  it('🔴 到点的提醒会**真的**产出一条系统通知 —— 而且调用点是存在的那一个', async () => {
    // 建一条任务，再给它一个**刚刚过去**的提醒时刻。
    //
    // 🔴 偏移必须**明显小于** `REMINDER_PAST_GRACE_MS`（1 分钟）。
    //    第一版用的是 `-60_000` —— 正好卡在宽限边界上，于是"有时刚好在窗口内、
    //    有时被判成太远"，而**症状是 3 次全量里红 1 次**。
    //    那种抖动最坏的地方不是偶尔红，而是它会被当成环境问题绕过，
    //    于是这条断言实际上不再保护任何东西。
    const justPast = -5_000;
    await useTaskStore.getState().addTask('交周报');
    const taskId = Object.keys(useTaskStore.getState().entities.tasks)[0];
    expect(taskId, '任务没建起来').toBeDefined();

    // 🔴 先挂 App 再建提醒：投递由 store 变化驱动（见 hook 文件头）。
    await mount();
    expect(calls, '刚挂载时不该有通知').toHaveLength(0);

    await act(async () => {
      await useReminderStore.getState().addAbsolute(taskId!, Date.now() + justPast);
    });
    // 等到投递真的发生（见 `waitFor` 的说明：固定一次 flush 是抖的）。
    await waitFor('通知被投递', () => calls.length > 0);

    expect(
      calls.length,
      `到点的提醒没有产出通知 —— 投递路径没有接线。已投：${JSON.stringify(calls)}`,
    ).toBeGreaterThan(0);
    // 正文必须是**那条任务**，不是一句泛泛的话（那等于没告诉用户任何事）。
    expect(calls.some((c) => (c.body ?? '').includes('交周报'))).toBe(true);
  });

  it('🔴 权限没开时**不投**（而不是投了失败）—— 且不抛', async () => {
    FakeNotification.permission = 'default';
    await useTaskStore.getState().addTask('不该被通知的事');
    const taskId = Object.keys(useTaskStore.getState().entities.tasks)[0];
    await mount();

    await act(async () => {
      await useReminderStore.getState().addAbsolute(taskId!, Date.now() - 5_000);
    });
    await flush();

    expect(calls, '权限没开却投了').toHaveLength(0);
  });

  it('设置页里有「提醒通知」那一节，且**已授权时不给按钮**', async () => {
    await mount();
    // 经头像进设置（设置不在 rail 上）。
    const avatar = container!.querySelector<HTMLButtonElement>('[data-testid="account-menu-avatar"]');
    expect(avatar).not.toBeNull();
    await act(async () => {
      avatar!.click();
    });
    const item = container!.querySelector<HTMLButtonElement>('[data-testid="account-menu-settings"]');
    await act(async () => {
      item!.click();
    });
    await flush();

    expect(
      container!.querySelector('[data-testid="reminder-notify-panel"]'),
      '设置页里没有「提醒通知」那一节',
    ).not.toBeNull();
    // 已授权 ⇒ 不给按钮（再给一个只会让人去点）。
    expect(container!.querySelector('[data-testid="reminder-notify-granted"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="reminder-notify-request"]')).toBeNull();
    // 局限必须写出来，否则用户会把它当系统级闹钟。
    expect(
      container!.querySelector('[data-testid="reminder-notify-limit"]')?.textContent ?? '',
    ).toContain('开着');
  });

  it('🔴 权限被拒时**不给申请按钮**（点了不会有任何反应的那种按钮不该存在）', async () => {
    FakeNotification.permission = 'denied';
    await mount();
    const avatar = container!.querySelector<HTMLButtonElement>('[data-testid="account-menu-avatar"]');
    await act(async () => {
      avatar!.click();
    });
    const item = container!.querySelector<HTMLButtonElement>('[data-testid="account-menu-settings"]');
    await act(async () => {
      item!.click();
    });
    await flush();

    expect(container!.querySelector('[data-testid="reminder-notify-denied"]')).not.toBeNull();
    expect(
      container!.querySelector('[data-testid="reminder-notify-request"]'),
      '被拒之后浏览器不会再弹框 —— 这个按钮点了必然没反应',
    ).toBeNull();
  });
});
