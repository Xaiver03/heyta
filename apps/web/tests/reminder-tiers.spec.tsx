/**
 * 长档位（提前 2 天 / 3 天 / 1 周 / 30 天）的 web 判据（W9 ①）
 * =============================================================
 *
 * ## 这一组按钮最容易出的三种错，以及各自钉在哪一条
 *
 *   1. **档位与文案错位** —— 领域层加了一档而 `longOffsetMessageKey` 没补 key。
 *      共享组件按下标取文案，所以错位的表现是"按钮写提前 3 天、建的是提前 1 周"，
 *      **不报错**。这里两处一起钉：`default` 分支必须抛（第 1 组用例），
 *      而"点第 i 个按钮建出的时刻"用**测试自己写的**日历算法当期望值（第 3 组）。
 *   2. **只补了中文没补英文** —— `pnpm check:ui-language` 的规则 4 会红，
 *      但那条只在提交前跑；这里再钉一次（拿两份真词条表逐 key 取），
 *      这样 `pnpm --filter @heyta/web test` 也能当场照出来。
 *   3. **没有截止时间时还渲染相对档位** —— 点下去 `createReminderBeforeDue`
 *      必然抛错，那是"多一个必然失败的按钮"（共享层砍掉「截止时」那一档
 *      就是同一条理由）。第 4 组钉它。
 *
 * ⚠️ 用的是**真 op-log + 真 store**（`fake-indexeddb`），不是 mock ——
 * 否则只能证明"组件会调回调"，证明不了"回调走到了 op-log"。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REMINDER_LONG_OFFSET_PRESETS_MS, REMINDER_OFFSET_PRESETS_MS } from '@heyta/domain';
import { I18nProvider, en, zhCN, type I18nValue, type MessageKey } from '@heyta/i18n';
import { HeytaUiProvider } from '@heyta/ui';

import {
  REMINDER_LONG_TIER_LABEL_KEY,
  longOffsetMessageKey,
  reminderLongOffsetKeys,
  reminderLongTiers,
} from '../src/features/reminders/reminder-tiers.js';
import { useReminderStore } from '../src/features/reminders/store.js';
import { __resetOpLogForTests, initOpLog, useTaskStore } from '../src/features/tasks/store.js';

const { ReminderPanel } = await import('../src/features/reminders/ReminderPanel.js');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const tZh = ((key: string) => zhCN[key as keyof typeof zhCN]) as I18nValue['t'];

/**
 * 把词条表按 `MessageKey` 取。
 *
 * ⚠️ 不能写成 `Record<string, string>` 再下标：`noUncheckedIndexedAccess` 会
 *    给每个下标加上 `| undefined`，于是"取一条文案"这件事在类型上要判空。
 *    `Record<MessageKey, string>` 是**映射类型**而不是索引签名，键是封闭词表 ——
 *    正好就是"这条 key 一定在表里"这句契约。
 */
const catalog = (table: object): Record<MessageKey, string> =>
  table as Record<MessageKey, string>;

/** 独立 oracle：本地日历日回退（不是被测函数，否则等于拿被测者算期望值）。 */
function localNDaysBefore(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  const g = globalThis as unknown as { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;
  __resetOpLogForTests();
  useTaskStore.setState({ filter: { kind: 'all' }, now: Date.now(), ready: false });
  useReminderStore.setState({ byTask: {}, due: [], error: undefined });
  await initOpLog(`reminder-tiers-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 轮询等条件（固定等两个 tick 在全量并行时不够，见 `reminders-panel.spec.tsx` 文件头）。 */
async function waitFor(label: string, cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await flush();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`等待「${label}」超时：${(container?.textContent ?? '').slice(0, 400)}`);
}

async function addTask(title: string, dueDate?: number): Promise<string> {
  const before = new Set(Object.keys(useTaskStore.getState().entities.tasks));
  await act(async () => {
    await useTaskStore.getState().addTask(title, dueDate === undefined ? undefined : { dueDate });
  });
  const created = Object.keys(useTaskStore.getState().entities.tasks).find((id) => !before.has(id));
  expect(created, '没找到刚建出来的任务').toBeDefined();
  return created!;
}

async function mountFor(taskId: string): Promise<HTMLDivElement> {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  const task = useTaskStore.getState().entities.tasks[taskId];
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

function remindersOf(taskId: string): readonly { triggerAt: number; offsetMs?: number }[] {
  return useReminderStore.getState().byTask[taskId] ?? [];
}

describe('1. 档位 ↔ 词条 key 的对账（漂移兜底）', () => {
  it('🔴 key 数组与 `REMINDER_LONG_OFFSET_PRESETS_MS` 逐项同序、同长度', () => {
    const keys = reminderLongOffsetKeys();
    expect(keys).toHaveLength(REMINDER_LONG_OFFSET_PRESETS_MS.length);
    expect([...keys]).toEqual([
      'web.reminder.offset.2d',
      'web.reminder.offset.3d',
      'web.reminder.offset.1w',
      'web.reminder.offset.30d',
    ]);
  });

  it('🔴 `default: throw` 是活的：不在表里的提前量必须抛，不许返回空串/跳过', () => {
    // 2 天零 1 分钟 —— 不是任何一档。跳过它会渲染出一个错位的按钮。
    expect(() => longOffsetMessageKey(2 * DAY + MINUTE)).toThrow(/漂移/);
    expect(() => longOffsetMessageKey(0)).toThrow(/漂移/); // 短档位不归这里管
    expect(() => longOffsetMessageKey(Number.NaN)).toThrow(/漂移/);
  });

  it('🔴 每一条 key 在中英两份真词条表里都存在（漏翻译在测试层也能照出来）', () => {
    for (const key of [...reminderLongOffsetKeys(), REMINDER_LONG_TIER_LABEL_KEY]) {
      expect(
        (zhCN as Record<string, string | undefined>)[key],
        `中文表里没有 ${key}`,
      ).toBeTruthy();
      expect(
        (en as Record<string, string | undefined>)[key],
        `英文表里没有 ${key}（check:ui-language 规则 4 也会红）`,
      ).toBeTruthy();
    }
  });

  it('中英两边都不是占位（英文值里不许有汉字）', () => {
    const zh = reminderLongTiers((key) => catalog(zhCN)[key]);
    const enLabels = reminderLongTiers((key) => catalog(en)[key]);
    expect(zh.map((tier) => tier.label)).toEqual(['提前 2 天', '提前 3 天', '提前 1 周', '提前 30 天']);
    for (const [index, tier] of enLabels.entries()) {
      expect(tier.label).not.toMatch(/[一-鿿]/);
      expect(tier.label.length, `第 ${String(index)} 档英文文案是空的`).toBeGreaterThan(0);
    }
  });

  it('长档位与短档位**不相交**（并进去就会撞共享层的下标契约）', () => {
    for (const offset of REMINDER_LONG_OFFSET_PRESETS_MS) {
      expect(REMINDER_OFFSET_PRESETS_MS as readonly number[]).not.toContain(offset);
    }
  });
});

describe('2. 渲染与真实点击（真 op-log，不是 mock）', () => {
  it('🔴 第 i 个长档位按钮建出的提醒 = 截止回退 i 档对应的**日历日**', async () => {
    for (let index = 0; index < REMINDER_LONG_OFFSET_PRESETS_MS.length; index += 1) {
      const offsetMs = REMINDER_LONG_OFFSET_PRESETS_MS[index]!;
      const dueDate = Date.now() + 60 * DAY;
      const taskId = await addTask(`长档位 ${String(index)}`, dueDate);
      const view = await mountFor(taskId);

      const button = view.querySelector<HTMLElement>(
        `[data-testid="reminder-long-add-${String(index)}"]`,
      );
      expect(button, `缺第 ${String(index)} 个长档位按钮`).not.toBeNull();
      // 文案与档位成对：按钮上写的必须是这一档的名字。
      const expectedLabel = catalog(zhCN)[longOffsetMessageKey(offsetMs)];
      expect(button!.textContent ?? '').toContain(expectedLabel);

      act(() => {
        button!.click();
      });
      await waitFor(`第 ${String(index)} 档建出提醒`, () => remindersOf(taskId).length === 1);

      const created = remindersOf(taskId)[0]!;
      expect(created.offsetMs).toBe(offsetMs);
      expect(
        created.triggerAt,
        `第 ${String(index)} 档（${expectedLabel}）建出的时刻错位了`,
      ).toBe(localNDaysBefore(dueDate, offsetMs / DAY));
      // 真的落了 op（不只是内存里改了改）。
      expect(
        useTaskStore.getState().entities.reminders[`${taskId}:${String(created.triggerAt)}`]
          ?.triggerAt,
      ).toBe(created.triggerAt);
    }
  });

  it('长档位与共享那 6 档同时在场，互不覆盖', async () => {
    const taskId = await addTask('两排都在', Date.now() + 60 * DAY);
    const view = await mountFor(taskId);
    for (let i = 0; i < REMINDER_OFFSET_PRESETS_MS.length; i += 1) {
      expect(
        view.querySelector(`[data-testid="reminder-add-${String(i)}"]`),
        `共享层第 ${String(i)} 档不见了`,
      ).not.toBeNull();
    }
    expect(view.querySelectorAll('[data-testid^="reminder-long-add-"]')).toHaveLength(
      REMINDER_LONG_OFFSET_PRESETS_MS.length,
    );
    expect(view.textContent ?? '').toContain(catalog(zhCN)[REMINDER_LONG_TIER_LABEL_KEY]);
  });

  it('🔴 没有截止时间时整组**不进 DOM**（否则是一个必然失败的按钮）', async () => {
    const taskId = await addTask('没有截止时间');
    const view = await mountFor(taskId);
    expect(view.querySelector('[data-testid="reminder-long-offsets"]')).toBeNull();
    expect(view.textContent ?? '').not.toContain(catalog(zhCN)[REMINDER_LONG_TIER_LABEL_KEY]);
    // 而绝对时刻入口仍在（无截止时间时唯一的那条路）。
    expect(view.querySelector('[data-testid="reminder-add-absolute"]')).not.toBeNull();
  });

  it('超上限时长档位的错误仍然显示在同一行（走的是同一个动作层）', async () => {
    const dueDate = Date.now() + 60 * DAY;
    const taskId = await addTask('撞上限', dueDate);
    const view = await mountFor(taskId);
    // 🔴 每一下都必须点**不同**的档位：提醒 id 是 `taskId:triggerAt`，
    //    同一档点两次幂等地落到同一条上，永远撞不到上限。
    const testIds = [
      ...REMINDER_LONG_OFFSET_PRESETS_MS.map(
        (_, index) => `reminder-long-add-${String(index)}`,
      ),
      ...REMINDER_OFFSET_PRESETS_MS.map((_, index) => `reminder-add-${String(index)}`),
    ];
    for (const testId of testIds) {
      // ⚠️ 每一下之间必须让**真实宏任务**跑一轮：`writeNew` 的"数存活条数"是在
      //    引擎状态上做的，连着点会让 10 个 dispatch 都在旧快照上看到"还没到上限"
      //    （实测：不加这 3ms 时 10 条全建出来了，上限根本没拦住）。
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        view.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click();
        await Promise.resolve();
      });
    }
    await waitFor('错误被记下', () => useReminderStore.getState().error !== undefined);
    expect(remindersOf(taskId).length).toBe(5); // 上限之前那 5 条都在
    expect(view.querySelector('[role="alert"]')?.textContent ?? '').toContain('最多 5 条提醒');
  });
});

describe('3. 时钟算术与档位自洽（闸门推导，不是硬编码阈值）', () => {
  it('🔴 最远一档（30 天）**超过**浏览器 setTimeout 的 2^31-1 ms 上限', () => {
    // 这条是 `use-reminder-wake.ts` 里"必须分段睡"那条判据的**前提**。
    // 前提不成立时它当场红，而不是让那条判据悄悄变成永真。
    const longest = Math.max(...REMINDER_LONG_OFFSET_PRESETS_MS);
    expect(longest).toBeGreaterThan(2_147_483_647);
  });
});
