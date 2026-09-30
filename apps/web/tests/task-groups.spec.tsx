/**
 * 任务列表的**日期分组头**（滴答同款，goal-layout-audit.md 页 7）
 * ================================================================
 *
 * ## 判据是什么
 *
 * 1. **分组真的发生**：逾期 / 今天 / 无截止时间各成一组，组头带组内计数；
 * 2. **「顺延」真的走 op-log**：点它之后逾期任务**挪到今天组** ——
 *    而不是只把组头藏起来（那会让用户以为任务丢了）；
 * 3. **「已完成」不分组**：完成时间不是截止时间，日期组头对它是误导。
 *
 * ## 🔴 为什么探针是"数勾选框"，不是"找标题文本"
 *
 * 每一行尾部都有本端控件（子任务选择器 / 清单 / 重复规则…），它们的
 * **下拉选项会把全部任务标题渲染进每一行**（<option> 的文本也算
 * `textContent`）。所以"这个组里有没有『某任务』"用文本包含判定的话，
 * **每一组都恒真** —— 第一版就是这么写的，断言全绿但什么都没测到
 * （DOM dump 实证：逾期组的 textContent 里躺着眼今天组的任务名）。
 * 勾选框的 `aria-label`（`完成：{title}`）只在**真正的任务行**上出现，
 * 用它数行才是数行。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startOfDay } from '@heyta/domain';

import { initOpLog, __resetOpLogForTests } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { emptyState } from '@heyta/op-log';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
// 🔴 用**线上同一个**壳（`main.tsx` 也用它）—— 在测试里自己拼 Provider 就是第二份接线。
import { LocaleHost } from '../src/lib/locale-host.js';

const DAY = 24 * 60 * 60 * 1000;
const NINE_AM = 9 * 60 * 60 * 1000;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  localStorage.clear();
  __resetOpLogForTests();
  await initOpLog(`task-groups-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

async function mountApp(): Promise<HTMLDivElement> {
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
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}

/** 某个分组 section 里**真正的任务行**（勾选框 aria-label = `完成：{title}`）。 */
function rowsOf(el: HTMLElement, testid: string): string[] {
  return [...el.querySelectorAll(`[data-testid="${testid}"] [role="checkbox"]`)]
    .map((box) => box.getAttribute('aria-label') ?? '')
    .sort();
}

/** 日期组的 testid 后缀是**真实日期**（`date-YYYY-MM-DD`），不要在测试里猜它。 */
function dateGroupOf(el: HTMLElement, titlePart: string): HTMLElement | undefined {
  return [...el.querySelectorAll<HTMLElement>('[data-testid^="task-group-date-"]')].find((sec) =>
    sec.querySelector('[data-testid$="-head"]')?.textContent?.includes(titlePart),
  );
}

/**
 * 等 op-log 的**异步落库链**走完（dispatch → 引擎 → IndexedDB → notify）。
 * 它跨多个宏任务，单等一个 `setTimeout(0)` 等不全 —— 实测会得到"断言跑在
 * 通知前面"的竞态：同一份测试时红时绿，比没有测试更糟。
 */
async function waitForState(cond: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!cond() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

describe('任务列表的日期分组头', () => {
  it('🔴 逾期 / 今天 / 无截止时间各成一组，组头带组内计数', async () => {
    useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' }, query: '' });
    await act(async () => {
      await useTaskStore
        .getState()
        .addTask('逾期的那个', { dueDate: startOfDay(Date.now()) - DAY + NINE_AM });
      await useTaskStore
        .getState()
        .addTask('今天到期的那个', { dueDate: startOfDay(Date.now()) + 15 * 60 * 60 * 1000 });
      await useTaskStore.getState().addTask('没日期的那个');
    });

    const el = await mountApp();

    const overdue = el.querySelector('[data-testid="task-group-overdue"]');
    expect(overdue, '逾期组应在').not.toBeNull();
    // 🔴 组头是共享层 `TaskGroupHead`（2026-09-30 收编，check:row-single-source
    //    拦掉了 web 手写 CSS）—— 探针用它的 testID，不用任何 class。
    const headOf = (section: Element): string =>
      section.querySelector('[data-testid$="-head"]')?.textContent ?? '';
    expect(headOf(overdue!), '逾期组头措辞').toContain('已过期');
    expect(headOf(overdue!), '逾期组计数 = 1').toContain('1');
    expect(rowsOf(el, 'task-group-overdue')).toEqual(['完成：逾期的那个']);

    const today = dateGroupOf(el, '今天');
    expect(today, '今天组应在').toBeDefined();
    expect(headOf(today!), '今天组头措辞').toContain('今天');
    expect(rowsOf(el, today!.getAttribute('data-testid')!)).toEqual(['完成：今天到期的那个']);

    expect(headOf(el.querySelector('[data-testid="task-group-undated"]')!), '无截止时间组头')
      .toContain('无截止时间');
    expect(rowsOf(el, 'task-group-undated')).toEqual(['完成：没日期的那个']);
  });

  it('🔴 点「顺延」：逾期任务**真的挪到今天**（DOM 与 store 两层都断）', async () => {
    useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' }, query: '' });
    await act(async () => {
      await useTaskStore
        .getState()
        .addTask('该顺延的', { dueDate: startOfDay(Date.now()) - DAY + NINE_AM });
    });

    const el = await mountApp();
    expect(el.querySelector('[data-testid="task-group-overdue"]'), '逾期组先在').not.toBeNull();

    const button = el.querySelector<HTMLButtonElement>('[data-testid="task-group-postpone"]');
    expect(button, '逾期组头必须有「顺延」').not.toBeNull();
    await act(async () => {
      button!.click();
    });

    // ① store 层：dueDate 真的变成了今天（保留 09:00 的时刻）。等落库链走完。
    await waitForState(() => {
      const task = Object.values(useTaskStore.getState().entities.tasks).find(
        (t) => t.title === '该顺延的',
      );
      return task?.dueDate === startOfDay(Date.now()) + NINE_AM;
    });
    const moved = Object.values(useTaskStore.getState().entities.tasks).find(
      (task) => task.title === '该顺延的',
    );
    expect(moved?.dueDate, '顺延后应是今天 09:00').toBe(startOfDay(Date.now()) + NINE_AM);

    // ② DOM 层：逾期组没了，任务出现在列表里 —— 不是被藏起来。等重渲染。
    await waitForState(() => el.querySelector('[data-testid="task-group-overdue"]') === null);
    expect(el.querySelector('[data-testid="task-group-overdue"]'), '顺延后逾期组应消失').toBeNull();
    const allRows = [...el.querySelectorAll('[data-testid="task-list"] [role="checkbox"]')].map(
      (box) => box.getAttribute('aria-label') ?? '',
    );
    expect(allRows, '任务必须还在列表里（挪组，不是消失）').toContain('完成：该顺延的');
  });

  it('「已完成」筛选不分组（完成时间不是截止时间，日期组头对它是误导）', async () => {
    useTaskStore.setState({ entities: emptyState(), filter: { kind: 'completed' }, query: '' });
    await act(async () => {
      await useTaskStore.getState().addTask('做完的', { dueDate: startOfDay(Date.now()) });
      const id = Object.keys(useTaskStore.getState().entities.tasks)[0];
      if (id !== undefined) await useTaskStore.getState().toggleComplete(id);
    });

    const el = await mountApp();
    expect(
      el.querySelector('[data-testid^="task-group-"]'),
      '已完成列表不该出现日期组头',
    ).toBeNull();
    expect(el.querySelector('[data-testid="task-list"]'), '列表本体仍在').not.toBeNull();
  });
});
