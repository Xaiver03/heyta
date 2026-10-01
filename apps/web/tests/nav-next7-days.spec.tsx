/**
 * 侧栏的「最近 7 天」—— 智能清单入口（goal 页 10 · 缺口 b）
 * ==========================================================
 *
 * 🔴 窗口的**归属规则**在领域层（`packages/domain/tests/task-filter.spec.ts`
 * 钉的是"哪条任务算在这 7 天里"）。这一组只钉**宿主这三件事**：
 *
 *   1. 侧栏那一行点得动，而且点下去**换的是筛选**（不是又开一个视图）；
 *   2. 侧栏上的**计数**与点进去数出来的行数一致 —— 它们必须同源于 `filterTasks`；
 *   3. 🔴 标签上写的天数与领域的 `NEXT_SEVEN_DAYS` **同源**：
 *      「最近 7 天」配一个 6 天的窗口，界面上一个字都看不出来。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addDays, NEXT_SEVEN_DAYS, parseLocalDate, toLocalDate } from '@heyta/domain';

import { initOpLog, __resetOpLogForTests } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { emptyState } from '@heyta/op-log';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
import { LocaleHost } from '../src/lib/locale-host.js';

const NINE_AM = 9 * 60 * 60 * 1000;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  localStorage.clear();
  __resetOpLogForTests();
  await initOpLog(`nav-next7-${Math.random().toString(36).slice(2)}`);
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

/**
 * 列表里**所有**任务行的名字（跨分组头收集）。
 *
 * ⚠️ 探针只认 `[role="checkbox"]` 的 `aria-label`（`完成：{title}`），
 * 理由与 `task-groups.spec.tsx` 同一条：每行尾部的下拉会把全部任务标题
 * 渲染进 `textContent`，用文本包含判定会**恒真**。
 */
function listedTasks(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[data-testid^="task-group-"] [role="checkbox"]')]
    .map((box) => box.getAttribute('aria-label') ?? '')
    .sort();
}

/** 某天（本地日历日）当天 9:00 的 epoch ms。 */
const at = (offsetDays: number): number => {
  const date = addDays(toLocalDate(Date.now()), offsetDays);
  return parseLocalDate(date).getTime() + NINE_AM;
};

describe('侧栏的「最近 7 天」', () => {
  /**
   * 五条任务，恰好各占窗口的一种边界。
   *
   * ⚠️ **不是**在 `beforeEach` 里种好、空态那条再 `setState` 去掉 ——
   * 那些任务已经进了 **op-log**，覆盖 `entities` 只改物化状态，下一次
   * notify 会按 op-log 重算把它们**全部带回来**。症状是"清空后界面却是空的
   * 那句文案没出现"，而原因在两层之外。要不同的数据集就各自种，别擦桌子。
   */
  async function seedFiveBoundaries(): Promise<void> {
    await act(async () => {
      await useTaskStore.getState().addTask('逾期的', { dueDate: at(-1) });
      await useTaskStore.getState().addTask('今天的', { dueDate: at(0) });
      await useTaskStore.getState().addTask('窗口最后一天的', { dueDate: at(NEXT_SEVEN_DAYS - 1) });
      await useTaskStore.getState().addTask('第八天的', { dueDate: at(NEXT_SEVEN_DAYS) });
      await useTaskStore.getState().addTask('没有日期的');
    });
  }

  beforeEach(async () => {
    useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
  });

  it('🔴 点侧栏那一行：列表只剩窗口内的两条，逾期/第八天/无截止都不在', async () => {
    await seedFiveBoundaries();
    const el = await mountApp();
    const found = el.querySelector<HTMLElement>('[data-testid="nav-scope-next7Days"]');
    expect(found, '侧栏应该有「最近 7 天」这一行').not.toBeNull();
    // `expect().not.toBeNull()` 不窄化类型（它不是断言函数，编译器不认）——
    // 拿 `found!` 之前先让它**在运行时**必须是有的，上面那行就是干这件事的。
    const row = found!;

    await act(async () => {
      row.click();
    });

    expect(listedTasks(el)).toEqual(['完成：今天的', '完成：窗口最后一天的']);
    expect(row.getAttribute('aria-current'), '点下去要说得出它是当前项').toBe('true');
    expect(useTaskStore.getState().filter.kind, '换的是筛选，不是又开一个视图').toBe('next7Days');
  });

  it('🔴 侧栏计数 == 点进去数出来的行数', async () => {
    await seedFiveBoundaries();
    const el = await mountApp();
    const row = el.querySelector<HTMLElement>('[data-testid="nav-scope-next7Days"]')!;
    const count = el.querySelector<HTMLElement>('[data-testid="nav-scope-next7Days-count"]');
    expect(count, '有任务时计数要在').not.toBeNull();
    expect(count!.textContent, '计数应当是 2（今天 + 窗口最后一天）').toBe('2');

    await act(async () => {
      row.click();
    });
    expect(listedTasks(el), '计数与行数不是两套判据').toHaveLength(Number(count!.textContent));
  });

  it('🔴 标签上的天数与领域的 NEXT_SEVEN_DAYS 同源', async () => {
    await seedFiveBoundaries();
    const el = await mountApp();
    // ⚠️ 读 `-label` 而不是整行：整行的 textContent 是 `最近 7 天2`，
    // 那个 2 是计数 —— 拿整行判"标签上的数 == 常数"会在常数变成 2 时假通过。
    const label =
      el.querySelector<HTMLElement>('[data-testid="nav-scope-next7Days-label"]')?.textContent ?? '';
    // 「最近 7 天」里的这个数就是领域那个常数 —— 各写一遍迟早对不上，
    // 而对不上的表现是"清单叫 7 天、少给你一天"，界面上一个字都看不出来。
    expect(label).toContain(String(NEXT_SEVEN_DAYS));
  });

  it('空的那一列有空状态，且说的是这一列的话（不是收集箱的兜底文案）', async () => {
    // 只种**窗口外**那一条 ⇒ 这一列必须是空的（见上面那条 ⚠️：不要先种满再擦）。
    await act(async () => {
      await useTaskStore.getState().addTask('第八天的', { dueDate: at(NEXT_SEVEN_DAYS) });
    });
    const el = await mountApp();
    await act(async () => {
      el.querySelector<HTMLElement>('[data-testid="nav-scope-next7Days"]')!.click();
    });
    const empty = el.querySelector<HTMLElement>('[data-testid="empty-state"]');
    expect(empty, '这一列空下来时必须有空状态').not.toBeNull();
    expect(empty!.textContent, '空态要说这一列的话').toContain('未来 7 天');
    expect(empty!.textContent, '不许拿收集箱的兜底文案糊过去').not.toContain('收集箱');
  });

  it('🔴 换筛选时不留上一条筛选的行（今天 ↔ 最近 7 天）', async () => {
    await seedFiveBoundaries();
    const el = await mountApp();
    await act(async () => {
      el.querySelector<HTMLElement>('[data-testid="nav-scope-today"]')!.click();
    });
    expect(listedTasks(el), '「今天」只有那一条').toEqual(['完成：今天的']);

    await act(async () => {
      el.querySelector<HTMLElement>('[data-testid="nav-scope-next7Days"]')!.click();
    });
    expect(listedTasks(el), '切清单不该把上一条的行留在屏上').toEqual([
      '完成：今天的',
      '完成：窗口最后一天的',
    ]);
    expect(
      el.querySelector('[data-testid="nav-scope-today"]')!.getAttribute('aria-current'),
      '当前项只有一行',
    ).toBe('false');
  });
});
