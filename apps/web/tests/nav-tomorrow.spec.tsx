/**
 * 侧栏的「明天」—— 智能清单第三档（R10，2026-11-07）
 * ==================================================
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
  await initOpLog(`nav-tomorrow-${Math.random().toString(36).slice(2)}`);
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

describe('侧栏的「明天」', () => {
  /**
   * 四条任务，各占「明天」这一档的一种边界：昨天（逾期）、今天、**明天**、后天。
   *
   * ⚠️ 与「最近 7 天」那份同一个教训：任务一旦进了 op-log，覆盖 `entities` 只改物化状态，
   * 下一次 notify 会按 op-log 重算把它们全带回来 —— 所以**各自种数据集，别擦桌子**。
   */
  async function seedFour(): Promise<void> {
    await act(async () => {
      await useTaskStore.getState().addTask('逾期的', { dueDate: at(-1) });
      await useTaskStore.getState().addTask('今天的', { dueDate: at(0) });
      await useTaskStore.getState().addTask('明天的', { dueDate: at(1) });
      await useTaskStore.getState().addTask('后天的', { dueDate: at(2) });
    });
  }

  beforeEach(async () => {
    useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
  });

  it('🔴 点侧栏那一行：列表只剩明天那一条（今天/后天/逾期都不在）', async () => {
    await seedFour();
    const el = await mountApp();
    const found = el.querySelector<HTMLElement>('[data-testid="nav-scope-tomorrow"]');
    expect(found, '侧栏应该有「明天」这一行').not.toBeNull();
    const row = found!;

    await act(async () => {
      row.click();
    });

    expect(listedTasks(el)).toEqual(['完成：明天的']);
    expect(row.getAttribute('aria-current'), '点下去要说得出它是当前项').toBe('true');
    expect(useTaskStore.getState().filter.kind, '换的是筛选，不是又开一个视图').toBe('tomorrow');
  });

  it('🔴 侧栏计数 == 点进去数出来的行数（两者同源于 filterTasks）', async () => {
    await seedFour();
    const el = await mountApp();
    const row = el.querySelector<HTMLElement>('[data-testid="nav-scope-tomorrow"]')!;
    const badge = row.textContent ?? '';
    expect(badge, '明天那一行要显示计数 1').toContain('1');

    await act(async () => {
      row.click();
    });
    expect(listedTasks(el)).toHaveLength(Number(/(\d+)/.exec(badge)?.[1] ?? -1));
  });

  it('🔴 「明天」与「今天」互不吃掉：来回切不留上一条筛选的行', async () => {
    await seedFour();
    const el = await mountApp();
    const today = el.querySelector<HTMLElement>('[data-testid="nav-scope-today"]')!;
    const tomorrow = el.querySelector<HTMLElement>('[data-testid="nav-scope-tomorrow"]')!;

    await act(async () => {
      today.click();
    });
    expect(listedTasks(el)).toEqual(['完成：今天的']);

    await act(async () => {
      tomorrow.click();
    });
    expect(listedTasks(el)).toEqual(['完成：明天的']);

    await act(async () => {
      today.click();
    });
    expect(listedTasks(el)).toEqual(['完成：今天的']);
  });

  it('🔴 「最近 7 天」含明天，但那不是同一档（它同时含后天）', async () => {
    await seedFour();
    const el = await mountApp();
    const next7 = el.querySelector<HTMLElement>('[data-testid="nav-scope-next7Days"]')!;
    await act(async () => {
      next7.click();
    });
    expect(listedTasks(el)).toEqual(['完成：后天的', '完成：明天的', '完成：今天的'].sort());
  });
});
