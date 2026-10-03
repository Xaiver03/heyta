/**
 * 提醒的**到点自醒**判据（W9 ②）
 * ================================
 *
 * ## 要证的那件事，以及它以前为什么不成立
 *
 * 投递是**订阅 `due`** 的，而 `due` 只在**引擎变化**时重算 —— 于是
 * "用户建完提醒就把手从键盘上拿开"这一种（也是最高频的一种）情况下，
 * 到点那一刻**没有任何东西会去问一次**。`App.tsx` 里唯一的周期 tick 是
 * `store.refreshNow()`（60 秒，喂"今天"视图），它**不重算 `due`**。
 *
 * ⇒ 症状：提醒建好了、界面显示"待触发"、时间到了，**通知不响**，而全绿。
 *
 * ## 四条判据各挡什么
 *
 *   1. **到点自己响**：建一条**未来**的提醒，之后**不再产生任何 op**，
 *      只推进时钟 ⇒ 必须恰好投一次。（补自醒之前这条是红的，就是它的价值。）
 *   2. 🔴 **恰好一次**：继续推进很久（多个醒点、跨过自然日）⇒ 仍然只有一次。
 *      变异：拿掉 `notify.ts` 里那份 `shown` 去重 ⇒ 立刻变成两次。
 *   3. **醒的时候不写 op**：定时器只能**读**。写一条 `firedAt` 会让对端
 *      把同一条提醒再弹一遍（AGENTS.md §3.4：被回放/远端的 op 不得再触发副作用）。
 *   4. **没有未来触发点时不排定时器**：否则 `setTimeout(0)` 回来→再算→再排，
 *      是个能把主线程转死的空转循环（这类定时器最经典的死法）。
 *
 * ⚠️ 1–4 用**假时钟**（要精确跨触发点，真等 25 小时不现实）。
 * 最后另有一条**真时钟 + 真 `<App />`** 的：它证的是"这个钟挂在真实应用树里"，
 * 那是假时钟证不了的 —— 挂载点一旦被删，只有它会红。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reminder } from '@heyta/domain';

import { MAX_WAKE_SLEEP_MS, nextReminderWakeAt } from '../src/features/reminders/use-reminder-wake.js';
import { useReminderStore } from '../src/features/reminders/store.js';
import { requireEngine } from '../src/lib/oplog.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { __resetOpLogForTests, initOpLog, useTaskStore } = await import(
  '../src/features/tasks/store.js'
);
const { useReminderNotifications } = await import(
  '../src/features/reminders/use-reminder-notifications.js'
);

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 记账用的假通知构造器。 */
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

/**
 * 只干"投递 + 自醒"这一件事的探针组件。
 *
 * 刻意不挂整棵 `<App />`：这里要证的是"钟自己醒、醒了只投一次"，
 * 挂整棵树会把别的 effect（实时同步、`refreshNow`…）也拉进来 ——
 * 它们**任何一条**在触发点之后重算一次 `due`，就能让第 1 条判据在
 * 没有自醒定时器的情况下假绿。真实挂载树由最后一个用例单独覆盖。
 */
function Probe(): React.JSX.Element {
  useReminderNotifications();
  return <div data-testid="wake-probe" />;
}

async function mountProbe(): Promise<void> {
  const { I18nProvider } = await import('@heyta/i18n');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <Probe />
      </I18nProvider>,
    );
  });
}

/** 建任务 + 一条触发时刻由参数决定的提醒，返回**物化状态里那条的 id**。 */
async function seedReminder(triggerAt: number): Promise<string> {
  await act(async () => {
    await useTaskStore.getState().addTask('自醒测试任务');
  });
  const taskId = Object.keys(useTaskStore.getState().entities.tasks)[0]!;
  await act(async () => {
    await useReminderStore.getState().addAbsolute(taskId, triggerAt);
  });
  // 🔴 id 从**状态里读**，不在测试里重拼 `${taskId}:${triggerAt}` ——
  //    那条拼法住在一句 `addAbsolute` 不回值的事实背后，重拼等于把
  //    "提醒 id 的形状"抄成第二份（它一旦被改，测试会拿着旧形状去查新数据，
  //    然后以 `DataError` 或"查不到"收场，而不是以一条清楚的断言失败）。
  const [created] = useReminderStore.getState().byTask[taskId] ?? [];
  expect(created, '提醒没进 store').toBeDefined();
  return created!.id;
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function opCount(entityId: string): Promise<number> {
  return (await requireEngine().getOpsForEntity('REMINDER', entityId)).length;
}

beforeEach(async () => {
  calls.length = 0;
  FakeNotification.permission = 'granted';
  (globalThis as unknown as { Notification: unknown }).Notification = FakeNotification;
  __resetOpLogForTests();
  useTaskStore.setState({ filter: { kind: 'all' }, ready: false });
  useReminderStore.setState({ byTask: {}, due: [], error: undefined });
  await initOpLog(`reminder-wake-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
  vi.useRealTimers();
});

describe('1–2. 到点自醒 + 恰好一次（假时钟，之后不再有任何 op）', () => {
  /**
   * 先**真**写完，再接管时钟。
   *
   * 🔴 顺序不能反：`fake-indexeddb` 的写要经过宏任务，而 `vi.useFakeTimers()`
   *    默认把这些一起接管 —— 在假定时器里 `await addAbsolute(...)` 会**永不 resolve**
   *    （实测：五条用例整批 5 秒超时）。所以落 op 用真定时器，
   *    **写完之后再**冻结并接管 `Date` + `setTimeout`，此时探针挂载才拿得到假钟。
   * 只接管这几个：`toFake` 显式列出，不碰 `queueMicrotask` / `setImmediate`，
   * 否则后面那句"读一次 op 数"（要过 IndexedDB）也会死锁。
   */
  function takeOverClock(): void {
    vi.useFakeTimers({
      now: Date.now(),
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
  }

  it('🔴 到点恰好投一次（提前一秒不响；响的那条正文是任务标题）', async () => {
    const triggerAt = Date.now() + 30 * SECOND;
    await seedReminder(triggerAt);
    takeOverClock();
    await mountProbe();
    expect(calls, '还没到点就投了').toHaveLength(0);

    await advance(29 * SECOND);
    expect(calls, '提前一秒就响了 —— 醒得早不是问题，响得早是').toHaveLength(0);

    await advance(2 * SECOND);
    expect(calls.length, '到点没响 —— "到点自醒"没挂上，或醒了没去问一遍 due').toBe(1);
    expect(calls[0]?.body ?? '').toContain('自醒测试任务');
  });

  it('🔴 继续推进很久（多个醒点 + 跨过自然日）仍然只有那一条', async () => {
    await seedReminder(Date.now() + 30 * SECOND);
    takeOverClock();
    await mountProbe();
    await advance(MINUTE);
    expect(calls).toHaveLength(1);

    // 🔴 **连续再问几次**：一条已经过去、但没人替它写 `firedAt` 的提醒会一直
    //    留在 `due` 里，所以每一次醒、每一次引擎变化都会把它再投一遍 ——
    //    挡住这个的就是 `notify.ts` 里那份 `shown` 去重。
    //    变异（拿掉 `if (shown.has(...)) continue`）时这一格报的是
    //    `expected [...] to have a length of 1 but got 4`，不是超时。
    for (let tick = 0; tick < 3; tick += 1) {
      await act(async () => {
        useReminderStore.getState().recheck();
      });
    }
    expect(calls.length, `同一条被重复投递：${JSON.stringify(calls)}`).toBe(1);

    // 再走 3 小时：分段睡会让定时器反复落在"已经过去"的那条上。
    await advance(3 * HOUR);
    // 再走一整天：跨自然日，去重集合不许因为"新的一天"而失效。
    await advance(DAY);
    expect(calls.length, `重复投递了 —— 去重没生效：${JSON.stringify(calls)}`).toBe(1);
  });

  it('醒点按**最早那条**排（两条不同时刻：先响早的、再响晚的，各一次）', async () => {
    const early = Date.now() + 10 * MINUTE;
    await seedReminder(early);
    await seedSecondReminder(early + 10 * MINUTE);
    takeOverClock();
    await mountProbe();

    await advance(11 * MINUTE);
    expect(calls, '第一条到点时没响 / 或两条一起响').toHaveLength(1);
    await advance(10 * MINUTE);
    expect(calls, '第二条到点时没接着响（排程只排了一次就没续上）').toHaveLength(2);
  });

  it('🔴 醒的时候不写 op（定时器只读；写会让对端再弹一遍）', async () => {
    const id = await seedReminder(Date.now() + 5 * SECOND);
    takeOverClock();
    await mountProbe();
    await advance(10 * SECOND);
    expect(calls).toHaveLength(1);
    await advance(2 * HOUR);
    vi.useRealTimers(); // 读 op 数要过 IndexedDB，必须在真定时器下

    expect(await opCount(id), '定时器投了一条 op 出去（投递不是写数据的时机）').toBe(1);
    // 只有建它的那一条 Create op：`firedAt` 没被顺手写上。
    const saved = useReminderStore.getState().byTask[taskIdOf(id)]?.find((r) => r.id === id);
    expect(saved?.firedAt, '定时器写了 firedAt').toBeUndefined();
    expect(saved?.dismissedAt, '定时器写了 dismissedAt').toBeUndefined();
  });
});

describe('3. 排程算术（纯函数，不碰 DOM）', () => {
  const reminder = (over: Partial<Reminder> & { id: string }): Reminder => ({
    taskId: 't1',
    triggerAt: 1000,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });

  it('没有未来的触发点 → undefined（**不排定时器**，否则就是空转循环）', () => {
    const byTask = {
      t1: [reminder({ id: 'a', triggerAt: 500 }), reminder({ id: 'b', triggerAt: 1_000 })],
    };
    expect(nextReminderWakeAt(byTask, 1_000)).toBeUndefined();
  });

  it('取**最早**的未来的那个，且看的是 `reminderEffectiveAt`（含 snooze）', () => {
    const byTask = {
      t1: [reminder({ id: 'a', triggerAt: 5_000 })],
      t2: [reminder({ id: 'b', triggerAt: 9_000, snoozedUntil: 3_000 })],
      t3: [reminder({ id: 'c', triggerAt: 2_000, snoozedUntil: 7_000 })],
    };
    expect(nextReminderWakeAt(byTask, 2_500)).toBe(3_000);
    // 已过点的那条不参与排程（防空转）。
    expect(nextReminderWakeAt({ t1: [reminder({ id: 'a', triggerAt: 100 })] }, 2_500)).toBeUndefined();
  });

  it('墓碑也参与排程（多醒一次无害；在这里判 deletedAt 就是第二份判据）', () => {
    const byTask = { t1: [reminder({ id: 'a', triggerAt: 4_000, deletedAt: 100 })] };
    expect(nextReminderWakeAt(byTask, 0)).toBe(4_000);
  });

  it('🔴 分段睡的上限**必须小于** setTimeout 的 2^31-1 ms 溢出点', () => {
    // "提前 30 天"这一档超过了溢出点（见 `reminder-tiers.spec.tsx` 那条前提判据），
    // 所以 MAX_WAKE_SLEEP_MS 是唯一让它不立刻触发的东西。阈值由溢出点推导。
    expect(MAX_WAKE_SLEEP_MS).toBeLessThan(2_147_483_647);
    expect(30 * DAY).toBeGreaterThan(2_147_483_647);
  });
});

/** 第二条提醒（挂在**另一条任务**上：同一任务有存活上限，且排程要跨任务取最早）。 */
async function seedSecondReminder(triggerAt: number): Promise<string> {
  await act(async () => {
    await useTaskStore.getState().addTask('第二条任务');
  });
  const taskIds = Object.keys(useTaskStore.getState().entities.tasks);
  const taskId = taskIds[taskIds.length - 1]!;
  await act(async () => {
    await useReminderStore.getState().addAbsolute(taskId, triggerAt);
  });
  const [created] = useReminderStore.getState().byTask[taskId] ?? [];
  expect(created, '第二条提醒没进 store').toBeDefined();
  return created!.id;
}

function taskIdOf(entityId: string): string {
  const at = entityId.lastIndexOf(':');
  return at < 0 ? '' : entityId.slice(0, at);
}

describe('4. 真实应用树里这个钟确实挂着（真时钟 + 真 <App />）', () => {
  // 显式放宽到 25 秒：这条要**真等**一个触发点（1.2 秒）+ 再等一段证明不重复（2.5 秒），
  // 而挂载真 `<App />` 本身就要跑一轮渲染。默认 5 秒会在断言之前先超时 ——
  // 那种红不是判据红，是夹具没给够时间。
  it('🔴 不点任何东西、不产生第二条 op，一条 1.2 秒后的提醒自己响了恰好一次', async () => {
    vi.useRealTimers();
    const { App } = await import('../src/App.js');
    const { LocaleHost } = await import('../src/lib/locale-host.js');
    const { I18nProvider } = await import('@heyta/i18n');

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        // `App` 自己已经在 `<App>` 内用 `useI18n`，这里与 wiring 套件同一挂法。
        <I18nProvider locale="zh-CN">
          <LocaleHost>
            <App />
          </LocaleHost>
        </I18nProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(calls, '刚挂载就该没有任何通知').toHaveLength(0);

    const triggerAt = Date.now() + 1_200;
    await act(async () => {
      await seedReminder(triggerAt);
    });
    expect(calls, '还没到点就响了').toHaveLength(0);

    // 等到响（真定时器：不响就是超时，超时信息里带着它等了多少）。
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && calls.length === 0) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
    expect(
      calls.length,
      '真 <App /> 里到点没自醒（等了 6000 ms）—— 自醒定时器没挂在应用树上',
    ).toBe(1);

    // 再过 3 秒：仍然只有一条。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    });
    expect(calls.length, `重复投递：${JSON.stringify(calls)}`).toBe(1);
  }, 25_000);
});
