/**
 * 任务行上的提醒面板
 * ====================
 *
 * 🔴 这个文件钉的是"最后一米"那类失效：`REMINDER` 一直是合法实体名、
 * `createReminderActions` 早就存在、op 能同步到所有设备 —— 但 Web 上
 * **没有任何入口能建它**。补上面板之后要保证的四件事：
 *
 *   1. **无截止时间时不许渲染「截止时」按钮** —— 那个按钮文案对应
 *      相对提前量 `0`，而没有截止时间就没有参照物，点下去 `app-host`
 *      会**明确抛错**。无截止时间时唯一入口是 `reminder.absolute.1h`
 *      的绝对时刻按钮，且建出来的必须是 `now + 1 小时`（键名里的 `1h`
 *      就是那条契约）。
 *   2. **按钮下标 ↔ 提前量预设必须逐项对齐**。「显示提前 30 分钟、
 *      实际建提前 1 天」这类错位没有任何类型/渲染断言能抓到，只有
 *      拿真实点击结果与 `REMINDER_OFFSET_PRESETS_MS[i]` 逐个比才钉得住。
 *   3. **动作抛错要看得见**（超过每任务上限），不是静默吞掉。
 *   4. 用的是**真的 op-log 与真的 store**（`fake-indexeddb`），不是 mock ——
 *      否则只能证明"组件会调回调"，证明不了"回调走到了 op-log"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 等的是**条件**，不是固定 tick
 *
 * 点击回调是 `void store.xxx(...)`（fire-and-forget），落盘要穿过
 * `dispatch → op-log 引擎 → IndexedDB → notify → refresh` 好几段微/宏任务。
 * 固定等两个 `setTimeout(0)` 在空载时够、全量并行时会不够（同类 flake
 * 已在 `notes-view.spec.tsx` 上真实发生过）。统一改成轮询条件 + 超时。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyState } from '@heyta/op-log';
import { I18nProvider, zhCN, type I18nValue } from '@heyta/i18n';
import { REMINDER_OFFSET_PRESETS_MS } from '@heyta/domain';
import { HeytaUiProvider } from '@heyta/ui';

import {
  __resetOpLogForTests,
  initOpLog,
  useTaskStore,
} from '../src/features/tasks/store.js';
import { useReminderStore } from '../src/features/reminders/store.js';
import { REMINDER_OFFSET_KEYS, reminderListLabels } from '../src/features/reminders/ReminderPanel.js';

const { ReminderPanel } = await import('../src/features/reminders/ReminderPanel.js');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 复刻 i18n 的 `t`：用真词条表，不自己编文案。 */
const t = ((key: string) => zhCN[key as keyof typeof zhCN]) as I18nValue['t'];

let dbName: string;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;

  dbName = `reminder-test-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  useTaskStore.setState({
    entities: emptyState(),
    filter: { kind: 'all' },
    now: Date.now(),
    ready: false,
  });
  useReminderStore.setState({ byTask: {}, due: [], error: undefined });
  await initOpLog(dbName);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

/** 建一条任务（可带截止时间），返回它自己的 id。 */
async function addTask(title: string, dueDate?: number): Promise<string> {
  const before = new Set(Object.keys(useTaskStore.getState().entities.tasks));
  await act(async () => {
    await useTaskStore.getState().addTask(title, dueDate === undefined ? undefined : { dueDate });
  });
  const created = Object.keys(useTaskStore.getState().entities.tasks).find(
    (id) => !before.has(id),
  );
  expect(created, '没找到刚建出来的任务').toBeDefined();
  return created!;
}

/**
 * 挂一个**真的接在 store 上**的提醒面板。
 *
 * 卸掉上一次是必需的：同一个用例里挂多个任务面板时，旧树仍然订阅着 store，
 * 会让后面的事件派发到两个树上。
 */
async function mountFor(taskId: string): Promise<HTMLDivElement> {
  act(() => {
    root?.unmount();
  });
  container?.remove();

  const task = useTaskStore.getState().entities.tasks[taskId];
  expect(task, '夹具任务不存在').toBeDefined();

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <HeytaUiProvider>
          <ReminderPanel task={task!} />
        </HeytaUiProvider>
      </I18nProvider>,
    );
  });
  return container;
}

function byTestId(view: HTMLElement, testId: string): HTMLElement | null {
  return view.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * 轮询等到条件成立。超时带现场 —— 否则失败信息只有"等超时了"。
 *
 * 🔴 默认 2s **必须小于 vitest 的单测超时（5s）**。等同时，超时会在
 * `await act(...)` 中途被强制掐断 —— 那个 act 永远不结算，下一条用例
 * 就会撞上 "overlapping act() calls" 并渲染出**空 DOM**，
 * 表现为一串与被测行为毫无关系的失败（实测踩过）。
 */
async function waitFor(label: string, cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await flush();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(
    `等待「${label}」超时\n当前界面文本：\n${(container?.textContent ?? '').slice(0, 600)}`,
  );
}

function click(view: HTMLElement, testId: string): void {
  const button = byTestId(view, testId);
  expect(button, `找不到按钮 ${testId}`).not.toBeNull();
  act(() => {
    button!.click();
  });
}

/** 某任务当前的存活提醒（来自动作层）。 */
function remindersOf(taskId: string): readonly { triggerAt: number; id: string }[] {
  return useReminderStore.getState().byTask[taskId] ?? [];
}

describe('A. 提前量预设与文案的下标对齐', () => {
  it('🔴 `labels.offsets` 的长度/顺序与 `REMINDER_OFFSET_PRESETS_MS` 完全一致', () => {
    const labels = reminderListLabels(t, 'zh-CN');
    // 长度对不上 = 有一档没有文案（共享层会画出空按钮）。
    expect(labels.offsets).toHaveLength(REMINDER_OFFSET_PRESETS_MS.length);
    // 顺序对不上 = "提前 30 分钟"的按钮点下去建的是另一个时刻（静默错位）。
    expect(REMINDER_OFFSET_KEYS).toHaveLength(REMINDER_OFFSET_PRESETS_MS.length);
    expect([...labels.offsets]).toEqual(
      REMINDER_OFFSET_KEYS.map((key) => zhCN[key as keyof typeof zhCN]),
    );
  });

  it('🔴 第 i 档按钮建出的提醒 = dueDate − `REMINDER_OFFSET_PRESETS_MS[i]`', async () => {
    /**
     * 期望值按**档位的语义**算，而不是无脑 `dueDate - offset`（W9 ③）。
     *
     * 不足一天的档位说的就是"那 N 毫秒"；整天以上的说的是"前 N 个**日历日**的
     * 同一套钟表时间" —— 在有夏令时的时区里两者相差一小时，而这条判据若继续
     * 写 `dueDate - DAY`，它会在每年那两天把正确的产品行为报成红。
     * 这里用测试自己写的 `setDate` 当独立 oracle（不 import 领域层的实现）。
     */
    const expectedTriggerAt = (dueDate: number, offsetMs: number): number => {
      if (offsetMs < DAY || offsetMs % DAY !== 0) return dueDate - offsetMs;
      const d = new Date(dueDate);
      d.setDate(d.getDate() - offsetMs / DAY);
      return d.getTime();
    };

    for (let index = 0; index < REMINDER_OFFSET_PRESETS_MS.length; index += 1) {
      const dueDate = Date.now() + 30 * 24 * HOUR;
      // 每档用一条新任务：每任务存活提醒有上限，全建在同一条上会撞上限。
      const taskId = await addTask(`第 ${String(index)} 档`, dueDate);
      const view = await mountFor(taskId);

      click(view, `reminder-add-${String(index)}`);
      await waitFor(`第 ${String(index)} 档建出提醒`, () => remindersOf(taskId).length === 1);

      const created = remindersOf(taskId);
      const expected = expectedTriggerAt(dueDate, REMINDER_OFFSET_PRESETS_MS[index]!);
      expect(
        created[0]?.triggerAt,
        `第 ${String(index)} 档的提前量错位了`,
      ).toBe(expected);
      // 物化状态里也是同一个值（证明真的落了 op，不是只改了本地字段）。
      expect(useTaskStore.getState().entities.reminders[created[0]!.id]?.triggerAt).toBe(expected);
    }
  });
});

describe('B. 没有截止时间时只有绝对时刻入口', () => {
  it('🔴 不渲染「截止时」预设按钮，渲染 `reminder.absolute.1h` 的按钮', async () => {
    const taskId = await addTask('没有截止时间');
    const view = await mountFor(taskId);

    // 预设一个都不渲染（`reminder-add-0` 就是文案为「截止时」的那一档）。
    expect(byTestId(view, 'reminder-add-0')).toBeNull();
    expect(byTestId(view, 'reminder-add-3')).toBeNull();

    const absolute = byTestId(view, 'reminder-add-absolute');
    expect(absolute, '无截止时间时缺少绝对时刻入口').not.toBeNull();
    expect(absolute?.textContent ?? '').toContain(zhCN['reminder.absolute.1h']);
    // 必须解释"为什么没有提前量预设"，而不是让按钮静默消失。
    expect(view.textContent ?? '').toContain(zhCN['reminder.hint.noDueDate']);
  });

  it('🔴 点绝对时刻按钮建的是 `now + 1 小时` 的提醒', async () => {
    const taskId = await addTask('没有截止时间');
    const view = await mountFor(taskId);

    const before = Date.now() + HOUR;
    click(view, 'reminder-add-absolute');
    await waitFor('绝对时刻提醒建出来', () => remindersOf(taskId).length === 1);
    const after = Date.now() + HOUR;

    const created = remindersOf(taskId);
    expect(created[0]!.triggerAt).toBeGreaterThanOrEqual(before);
    expect(created[0]!.triggerAt).toBeLessThanOrEqual(after);
  });

  it('🔴 超过每任务上限时把错误显示出来，不静默吞掉', async () => {
    const taskId = await addTask('没有截止时间');
    const view = await mountFor(taskId);

    // 上限是 5 条（`MAX_REMINDERS_PER_TASK`）；连点 8 次必然撞上限。
    // 🔴 每次点击的触发时刻必须**逐次不同**：幂等分支（`reminder-actions.ts` 的
    //    `writeNew`，按 `taskId:triggerAt` 认实体）走在封顶检查**前面**，两次点击落进
    //    同一毫秒就合成同一条、永远撞不到上限。
    // ⚠️ 这件事此前靠"两次点击之间真实时钟自己走了 3ms"来保证，而负载高时定时器会合并、
    //    多次点击落进同一毫秒 ⇒ 该用例偶发假红（单独跑必绿）。把 `Date.now()` 冻住可 100%
    //    复现那一次红 —— 现在改成按**点击序号**推进时钟，用例前提不再取决于机器负载。
    const realNow = Date.now.bind(Date);
    let step = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + step * MINUTE);
    try {
      for (let i = 0; i < 8; i += 1) {
        step += 1;
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 3));
          click(view, 'reminder-add-absolute');
        });
      }

      await waitFor('超上限的错误被记下', () => useReminderStore.getState().error !== undefined);
      await waitFor('错误渲染出来', () => view.querySelector('[role="alert"]') !== null);
    } finally {
      clock.mockRestore();
    }

    const alert = view.querySelector('[role="alert"]');
    expect(alert?.textContent ?? '').toContain('最多 5 条提醒');
  });
});

describe('C. 有截止时间时的相对提前量', () => {
  it('🔴 点「提前 30 分钟」→ 物化状态里 `triggerAt === dueDate − 30 分钟`', async () => {
    const dueDate = Date.now() + 10 * 24 * HOUR;
    const taskId = await addTask('有截止时间', dueDate);
    const view = await mountFor(taskId);

    // 预设顺序：0 / 5m / 15m / 30m / 1h / 1d —— 下标 3 是 30 分钟。
    const thirtyIndex = REMINDER_OFFSET_PRESETS_MS.indexOf(30 * MINUTE);
    expect(thirtyIndex, '预设里没有「提前 30 分钟」').toBe(3);
    click(view, `reminder-add-${String(thirtyIndex)}`);
    await waitFor('相对提前量提醒建出来', () => remindersOf(taskId).length === 1);

    const created = remindersOf(taskId);
    expect(created[0]!.triggerAt).toBe(dueDate - 30 * MINUTE);
    expect(useTaskStore.getState().entities.reminders[created[0]!.id]?.triggerAt).toBe(
      dueDate - 30 * MINUTE,
    );
    // 有截止时间时**不渲染**绝对时刻入口。
    expect(byTestId(view, 'reminder-add-absolute')).toBeNull();
  });
});
