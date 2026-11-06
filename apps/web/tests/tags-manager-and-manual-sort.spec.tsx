/**
 * B 包的两处界面变化：标签管理页（R8）与手动排序的写路径（R4①）
 * =============================================================
 *
 * 这一组是**用户能看到什么**的判据（交付物 ③），不是领域判据 ——
 * 领域侧在 `packages/domain/tests/{tags,manual-order}.spec.ts`，
 * 写路径与单 op 在 `packages/app-host/tests/{tag-merge,skip-occurrence}.spec.ts`。
 *
 * 这里钉的是"宿主有没有真的把那条路接上"，它们每一件都能单独坏掉而领域测试全绿：
 *
 *   1. `⋯` 里有「管理标签」这一枚（入口表那一行的真身），点开**真的挂出浮层**；
 *   2. 浮层里能看到标签、能勾选两条、能合并 —— 合并之后**列表里少一条**
 *      （被合并掉的那条从"活着的标签"里消失）；
 *   3. 🔴 **合并是一次用户意图 = 一条 op**：合并前后 op-log 的条数差 1
 *      （不是 N：那是 §3.4 要拦的形状，而它在界面上看起来完全一样）；
 *   4. 手动排序档位下拖动落点 → `setOrder` 写**一条** op，且顺序落库后重读不变。
 *
 * ⚠️ 拖拽手势本身（指针位移、dnd-kit 的几何）**不在这里测**：jsdom 里量出来的
 * 矩形是 0，写一条"在 0 上成立"的断言等于给自己发免死金牌（`ui-acceptance.md`）。
 * 这里测的是"落点算完之后**写什么**"——那正是"一次拖动 = 一条 op"的判据面。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyState } from '@heyta/op-log';
import { planManualReorder, resolveTagIds, sortTasks } from '@heyta/domain';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
import { LocaleHost } from '../src/lib/locale-host.js';
import { initOpLog, __resetOpLogForTests, currentState, readRecentOps } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { useProjectStore } from '../src/features/projects/store.js';
import { usePrivacyStore } from '../src/features/privacy/store.js';
import { tagManager } from '../src/features/tags/store.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let tick = 1_700_000_000_000;

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem(
    'privacy.consent',
    JSON.stringify({ decision: 'local-only', decidedAt: new Date().toISOString() }),
  );
  usePrivacyStore.setState({ open: false, reason: 'first-launch', notPersisted: false });
  vi.spyOn(Date, 'now').mockImplementation(() => (tick += 1_000));
  __resetOpLogForTests();
  await initOpLog(`pkg-b-${Math.random().toString(36).slice(2)}`);
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

async function openOverflow(el: HTMLElement): Promise<HTMLElement> {
  const trigger = el.querySelector<HTMLElement>('[data-testid="task-menu-open"]');
  expect(trigger, '任务视图页头必须有一枚 ⋯').not.toBeNull();
  await act(async () => {
    trigger!.click();
    await Promise.resolve();
  });
  const menu = document.querySelector<HTMLElement>('[data-testid="task-menu"]');
  expect(menu, '点开 ⋯ 之后菜单必须挂出来').not.toBeNull();
  return menu!;
}

describe('R8 标签管理：入口 → 合并 → 列表少一条', () => {
  it('`⋯` 里有「管理标签」，点开挂出浮层，屏上看得见两条标签', async () => {
    await act(async () => {
      await useProjectStore.getState().addTag('会议');
      await useProjectStore.getState().addTag('工作');
    });
    const el = await mountApp();

    const menu = await openOverflow(el);
    const entry = menu.querySelector<HTMLElement>('[data-testid="manage-tags-open"]');
    expect(entry, '⋯ 里必须有「管理标签」（入口表 manageTags 那一行的真身）').not.toBeNull();

    await act(async () => {
      entry!.click();
      await Promise.resolve();
    });
    const dialog = document.querySelector<HTMLElement>('[data-testid="tags-manager"]');
    expect(dialog, '点「管理标签」之后必须真的挂出浮层').not.toBeNull();
    // 两行标签的可选框（`renderLeading` 插槽里的多选框）。
    expect(dialog!.querySelectorAll('[data-testid^="tags-manager-select-"]')).toHaveLength(2);
  });

  it('🔴 合并两条标签只写**一条** op，且被合并掉的那条从"活着的标签"里消失', async () => {
    let a = '';
    let b = '';
    await act(async () => {
      a = (await useProjectStore.getState().addTag('会议')) ?? '';
      b = (await useProjectStore.getState().addTag('工作')) ?? '';
    });
    let taskId = '';
    await act(async () => {
      taskId = (await useTaskStore.getState().addTask('周一例会')) ?? '';
    });
    await act(async () => {
      await useTaskStore.getState().setTags(taskId, [a]);
    });

    const before = (await readRecentOps()).length;
    const beforeTags = Object.keys(currentState().tags).length;

    await act(async () => {
      await tagManager.merge(a, b);
      await Promise.resolve();
    });

    const state = currentState();
    // 一条 op：标签表多一条墓碑，任务那边一条都没写。
    expect((await readRecentOps()).length - before, '合并必须只产生一条 op').toBe(1);
    expect(state.tags[a]?.deletedAt, '被合并掉的那条进墓碑').not.toBeUndefined();
    expect(state.tags[a]?.mergedInto).toBe(b);
    // "没有任何任务还挂着被合并掉的那条"——按**有效**标签算。
    const effective = resolveTagIds(state.tasks[taskId]?.tagIds, state.tags);
    expect(effective, '有效标签里只剩目标那条').toEqual([b]);
    // 活着的标签少一条（侧栏 / 筛选 / 统计都不会再列出它）。
    const aliveTags = Object.values(state.tags).filter((tag) => tag.deletedAt === undefined);
    expect(aliveTags).toHaveLength(beforeTags - 1);
    expect(aliveTags.map((tag) => tag.id)).toEqual([b]);
  });
});

describe('R4① 手动排序：一次拖动 = 一条 op，顺序落库后重读不变', () => {
  it('拖动落点 → `setOrder` 写一条 op；重读的 manual 顺序就是拖动后的顺序', async () => {
    await act(async () => {
      await useTaskStore.getState().addTask('甲');
      await useTaskStore.getState().addTask('乙');
      await useTaskStore.getState().addTask('丙');
    });
    const manualOrder = () => {
      const state = currentState();
      return sortTasks(Object.values(state.tasks), 'manual').map((task) => task.title);
    };
    // 没排过序时手动档按 createdAt（= 建任务的顺序）。
    expect(manualOrder()).toEqual(['甲', '乙', '丙']);

    // 拖动：把「甲」拖到最后（这就是 dnd-kit 的 `onDragEnd` 交出来的两个下标）。
    const ordered = sortTasks(Object.values(currentState().tasks), 'manual');
    const plan = planManualReorder(ordered, 0, 2);
    expect(plan?.kind).toBe('move');
    if (plan?.kind !== 'move') throw new Error('unreachable');

    const before = (await readRecentOps()).length;
    await act(async () => {
      await useTaskStore.getState().setOrder(plan.id, plan.order);
      await Promise.resolve();
    });
    expect((await readRecentOps()).length - before, '一次拖动只允许写一条 op').toBe(1);
    // 顺序变了，而且**重读**（同一份物化状态）与拖动意图一致。
    expect(manualOrder()).toEqual(['乙', '丙', '甲']);
  });

  it('拖动写进去的是中值，不是"整表重排"（没被拖的那一条 order 不动）', async () => {
    await act(async () => {
      await useTaskStore.getState().addTask('甲');
      await useTaskStore.getState().addTask('乙');
    });
    const ids = Object.keys(currentState().tasks);
    // 先给两条各写一个 order，才能观察"只动被拖的那一条"。
    await act(async () => {
      await useTaskStore.getState().setOrder(ids[0]!, 10);
      await useTaskStore.getState().setOrder(ids[1]!, 20);
    });
    const keyed = () => {
      const state = currentState();
      return Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, task.order]));
    };
    const before = keyed();

    const ordered = sortTasks(Object.values(currentState().tasks), 'manual');
    const plan = planManualReorder(ordered, 1, 0);
    if (plan?.kind !== 'move') throw new Error('应当是可表示的移动');
    await act(async () => {
      await useTaskStore.getState().setOrder(plan.id, plan.order);
      await Promise.resolve();
    });

    const after = keyed();
    const untouchedId = ids.find((id) => id !== plan.id)!;
    expect(after[untouchedId], '没被拖的那一条 order 不该被重写').toBe(before[untouchedId]);
    expect(after[plan.id], '被拖的那一条落在下界之下（插到最前面）').toBe(plan.order);
    expect(plan.order!).toBeLessThan(before[untouchedId]!);
  });
});
