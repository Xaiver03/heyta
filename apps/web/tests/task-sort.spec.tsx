/**
 * 任务列表的排序控件（goal 页 10 · 缺口 d）
 * =========================================
 *
 * 🔴 排序**判据**在领域层（`packages/domain/tests/task-order.spec.ts` 钉的是
 * "每一档怎么比"）。这一组钉的是**宿主这四件事**，它们每一件都能单独坏掉而领域测试全绿：
 *
 *   1. 控件**带可见的文字标签** —— 页头上两个裸 chip 的教训（2026-09-30 产品负责人：
 *      "用户根本不知道它们是什么"）：说不清作用范围的控件，加了等于没加；
 *   2. 选下去**真的换了行序**（`sort` 这个 prop 一路透传到共享层，中间没被吞掉）；
 *   3. 刷新后**还是那一档**（设备本地存储；不进 op-log —— 它是阅读偏好不是用户意图）；
 *   4. 🔴 三档排出**三个不同**的顺序。只断言"这些任务都在屏上"的话，
 *      `sort` 被完全忽略也能过 —— 那是最典型的一条假绿判据（§7 第 46 条）。
 *
 * ⚠️ 种的数据**全部没有截止时间**：这样三条任务落在同一个日期分组里
 * （分组会把列表切成多个 `TaskList`，而档位只在**组内**生效，见 `model.ts` 的
 * `flattenSections` 刻意不重排）。跨组比较顺序会验的不是排序，是分组。
 *
 * ⚠️ **变异 `packages/ui`/`packages/domain` 来验证本文件时必须先 rebuild。**
 * web 的测试吃的是工作区包的 **dist**，不是 src —— 实测：改了 src 不打包，
 * 六条用例全绿，看起来像"判据不承重"，其实是探针根本没跑到改过的那份代码
 * （§7 第 27/79 条同一族）。rebuild 之后同一次变异**恰好红两条**（顺序 + 重挂）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Priority } from '@heyta/domain';
import { emptyState } from '@heyta/op-log';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
import { LocaleHost } from '../src/lib/locale-host.js';
import { initOpLog, __resetOpLogForTests } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/**
 * 🔴 自己推进的时钟：`createdAt` 来自 `Date.now`，而同一台设备连续建两条
 * **经常落在同一毫秒**里。真时钟下"按添加时间"会退化成插入顺序，
 * 于是下面那条"三档三个不同顺序"的判据会**随机变红**（app-host 的
 * `byCanonicalOrder` 注释里写的就是同一件事）。
 */
let tick = 1_700_000_000_000;

beforeEach(async () => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockImplementation(() => (tick += 1_000));
  __resetOpLogForTests();
  await initOpLog(`task-sort-${Math.random().toString(36).slice(2)}`);
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
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
 * 屏上行的**DOM 顺序**（不是字母序 —— 这里要断言的就是顺序本身）。
 *
 * ⚠️ 探针只认 `[role="checkbox"]` 的 `aria-label`：每行尾部那些下拉会把别的
 * 标题也渲染进 `textContent`，用文本包含判定会恒真（同 `task-groups.spec.tsx`）。
 */
function rowOrder(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[data-testid^="task-group-"] [role="checkbox"]')].map(
    (box) => box.getAttribute('aria-label') ?? '',
  );
}

async function seedThree(): Promise<void> {
  await act(async () => {
    // 建完即设优先级：`addTask` 的入参里没有 createdAt，而优先级有独立的一条 op。
    await useTaskStore.getState().addTask('甲');
    await useTaskStore.getState().addTask('乙');
    await useTaskStore.getState().addTask('丙');
  });
  const tasks = Object.values(useTaskStore.getState().entities.tasks);
  const byTitle = new Map(tasks.map((t) => [t.title, t.id]));
  await act(async () => {
    await useTaskStore.getState().setPriority(byTitle.get('甲')!, Priority.None);
    await useTaskStore.getState().setPriority(byTitle.get('乙')!, Priority.High);
    await useTaskStore.getState().setPriority(byTitle.get('丙')!, Priority.Medium);
  });
}

/** 选档位。原生 `<select>`：改 `value` 再派发 `change`（React 认这个组合）。 */
async function pickSort(el: HTMLElement, value: string): Promise<void> {
  const select = el.querySelector<HTMLSelectElement>('[data-testid="task-sort-select"]')!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('任务列表的排序控件', () => {
  it('🔴 控件带**可见的文字标签**，且长在页头（不是列表上方另起一条）', async () => {
    await seedThree();
    const el = await mountApp();
    const toolbar = el.querySelector<HTMLElement>('[data-testid="task-sort"]');
    expect(toolbar, '任务视图有行时就该有排序控件').not.toBeNull();
    expect(toolbar!.textContent, '标签文字必须渲染在屏上（只挂 aria-label 不算）').toContain(
      '排序方式',
    );
    // 滴答参照图第三列的页头 = 标题 + 排序 + ⋯。放在列表上方会把第一组的组头
    // 往下顶一格，而组头本身就是这一列的分区标 —— 两条工具带叠在一起读不出层级。
    expect(
      toolbar!.closest('header.ht-header'),
      '排序控件必须在页头里',
    ).not.toBeNull();
    const select = toolbar!.querySelector<HTMLSelectElement>('[data-testid="task-sort-select"]');
    expect(
      select,
      '用原生 select：与 SubtaskPicker/TaskOrganizer 一致，暗色下不必自绘弹层',
    ).not.toBeNull();
    expect(select!.getAttribute('aria-label')).toBe('排序方式');
    expect(select!.selectedOptions[0]?.textContent).toBe('默认（按截止时间）');
  });

  it('默认档就是领域的 display：插入顺序（无截止 ⇒ 组内稳定原序）', async () => {
    await seedThree();
    const el = await mountApp();
    expect(rowOrder(el)).toEqual(['完成：甲', '完成：乙', '完成：丙']);
  });

  it('🔴 三档排出**三个不同**的顺序（`sort` 被忽略时这条必红）', async () => {
    await seedThree();
    const el = await mountApp();
    const seen = new Set<string>();
    seen.add(rowOrder(el).join('|'));

    await pickSort(el, 'priority');
    const byPriority = rowOrder(el);
    expect(byPriority, '高的在前；None 与 undefined 同义 ⇒ 落最后').toEqual([
      '完成：乙',
      '完成：丙',
      '完成：甲',
    ]);

    await pickSort(el, 'addedAt');
    const byAdded = rowOrder(el);
    expect(byAdded, '新的在前：刚记下来那条就是用户要找的').toEqual([
      '完成：丙',
      '完成：乙',
      '完成：甲',
    ]);

    seen.add(byPriority.join('|'));
    seen.add(byAdded.join('|'));
    expect(seen.size, '三档必须是三个不同的顺序 —— 相同就说明某个 key 根本没生效').toBe(3);
  });

  it('🔴 重挂之后还是选的那一档（设备本地持久化，不是内存态）', async () => {
    await seedThree();
    const first = await mountApp();
    await pickSort(first, 'priority');
    expect(localStorage.getItem('heyta.taskSort'), '存的必须是档位本身').toBe('"priority"');

    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;

    const again = await mountApp();
    const select = again.querySelector<HTMLSelectElement>('[data-testid="task-sort-select"]')!;
    expect(select.value, '重挂后选中项要来自存储').toBe('priority');
    expect(rowOrder(again), '重挂后顺序也得是那一档的').toEqual([
      '完成：乙',
      '完成：丙',
      '完成：甲',
    ]);
  });

  it('存储被改成非法值时回到默认档（而不是把列表排空）', async () => {
    await seedThree();
    localStorage.setItem('heyta.taskSort', '"按心情"');
    const el = await mountApp();
    const select = el.querySelector<HTMLSelectElement>('[data-testid="task-sort-select"]')!;
    expect(select.value).toBe('display');
    expect(rowOrder(el), '非法值不能让列表变空').toHaveLength(3);
  });

  it('一行都没有时不出现排序条（没有可排的东西，就不该有个能点的控件）', async () => {
    const el = await mountApp();
    expect(el.querySelector('[data-testid="task-sort"]')).toBeNull();
  });

  it('批量选择入口只在任务列表里出现，完成后退出选择态', async () => {
    await seedThree();
    const el = await mountApp();
    const selectButton = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('选择任务'));
    expect(selectButton).toBeDefined();
    await act(async () => {
      selectButton?.click();
      await Promise.resolve();
    });
    const task = Object.values(useTaskStore.getState().entities.tasks)[0]!;
    const checkbox = el.querySelector<HTMLInputElement>(`[data-testid="bulk-select-${task.id}"]`);
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox?.click();
    });
    expect(el.textContent).toContain('已选 1 项');
    const row = el.querySelector<HTMLElement>(`[data-testid="task-item-${task.id}"]`);
    expect(row, '选择态任务行必须保留稳定锚点').not.toBeNull();
    expect(
      row?.querySelector(`button[aria-label="删除：${task.title}"]`),
      '批量选择时不应继续暴露单条删除动作',
    ).toBeNull();
    expect(
      getComputedStyle(row as HTMLElement).backgroundColor,
      '选中的任务行必须有共享层的高亮',
    ).not.toBe('rgba(0, 0, 0, 0)');
    const complete = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('批量完成'));
    expect(complete).toBeDefined();
    await act(async () => {
      complete?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(useTaskStore.getState().entities.tasks[task.id]?.completedAt).toBeDefined();
    expect(el.textContent).not.toContain('已选 1 项');
  });

  it('Esc 退出批量选择态并清除已选任务', async () => {
    await seedThree();
    const el = await mountApp();
    const selectButton = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('选择任务'))!;
    await act(async () => {
      selectButton.click();
      await Promise.resolve();
    });
    const task = Object.values(useTaskStore.getState().entities.tasks)[0]!;
    const checkbox = el.querySelector<HTMLInputElement>(`[data-testid="bulk-select-${task.id}"]`)!;
    await act(async () => {
      checkbox.click();
    });
    expect(el.textContent).toContain('已选 1 项');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(el.textContent).not.toContain('已选 1 项');
    expect(el.querySelector(`[data-testid="bulk-select-${task.id}"]`)).toBeNull();
  });
});
