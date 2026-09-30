/**
 * 回收站（Web 壳）
 * ==================
 *
 * 两层断言：
 *   1. **store**：恢复/彻底删除都必须**产生 op**（D4：op-log 是唯一写入口），
 *      而不是只改 `entities`。只改本地状态的实现在这里就会红。
 *   2. **组件**：`TrashView` 的"彻底删除"必须**二次确认** ——
 *      点一下删除图标不能已经删掉了。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyState } from '@heyta/op-log';

import {
  __resetOpLogForTests,
  initOpLog,
  selectTrashedTasks,
  selectVisibleTasks,
  useTaskStore,
} from '../src/features/tasks/store.js';

const { TrashView } = await import('../src/features/trash/TrashView.js');

let dbName: string;

async function seedTrashed(title: string): Promise<string> {
  await useTaskStore.getState().addTask(title);
  const id = Object.values(useTaskStore.getState().entities.tasks).find(
    (t) => t.title === title,
  )!.id;
  await useTaskStore.getState().deleteTask(id);
  return id;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderTrash(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<TrashView />);
  });
  return container;
}

function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | null)?.click();
  });
}

/**
 * 等一个异步写入落地。
 *
 * 组件里的按钮是 `void restoreTask(id)`（fire-and-forget），而真正的写入要
 * 穿过 IndexedDB 的事务。只 `await Promise.resolve()` 一次不足以排空它 ——
 * 于是断言会在写入完成前读到旧状态，测试随机变红（比没有测试更糟）。
 * 这里显式轮询到条件成立，并给一个上限而不是无限等。
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;

  dbName = `web-trash-test-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  useTaskStore.setState({
    entities: emptyState(),
    filter: { kind: 'all' },
    now: Date.now(),
    ready: false,
  });
  await initOpLog(dbName);
});

describe('回收站 store', () => {
  it('删除后进入回收站，恢复后回到可见列表', async () => {
    const id = await seedTrashed('写文档');
    expect(selectTrashedTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);
    expect(selectVisibleTasks(useTaskStore.getState())).toHaveLength(0);

    await useTaskStore.getState().restoreTask(id);

    expect(selectTrashedTasks(useTaskStore.getState())).toHaveLength(0);
    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);
    // 墓碑真的被清掉了（不是只从列表里过滤掉）
    expect(useTaskStore.getState().entities.tasks[id]!.deletedAt).toBeUndefined();
  });

  it('彻底删除：回收站里消失、墓碑仍在、恢复被拒绝', async () => {
    const id = await seedTrashed('写文档');

    await useTaskStore.getState().purgeTask(id);

    expect(selectTrashedTasks(useTaskStore.getState())).toHaveLength(0);
    const task = useTaskStore.getState().entities.tasks[id]!;
    expect(task.purgedAt).toBeTypeOf('number');
    // 墓碑不能被清掉 —— 清掉离线端会把它当"从未删除"又同步回来
    expect(task.deletedAt).toBeTypeOf('number');

    await expect(useTaskStore.getState().restoreTask(id)).rejects.toThrow('已被彻底删除');
  });

  it('对活着的任务调 purge 会抛错', async () => {
    await useTaskStore.getState().addTask('活着');
    const id = Object.values(useTaskStore.getState().entities.tasks)[0]!.id;
    await expect(useTaskStore.getState().purgeTask(id)).rejects.toThrow('不在回收站里');
  });
});

describe('回收站界面', () => {
  it('空回收站显示空状态，不显示列表', () => {
    const el = renderTrash();
    expect(el.querySelector('[data-testid="trash-board-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="trash-board-list"]')).toBeNull();
  });

  it('显示已删除条目与恢复按钮', async () => {
    const id = await seedTrashed('写文档');
    const el = renderTrash();

    expect(el.querySelector(`[data-testid="trash-board-restore-${id}"]`)).not.toBeNull();
    expect(el.textContent).toContain('写文档');
    expect(el.querySelector(`[data-testid="trash-board-restore-${id}"]`)).not.toBeNull();
  });

  it('点恢复按钮：条目离开回收站（真的恢复了）', async () => {
    const id = await seedTrashed('写文档');
    const el = renderTrash();

    click(el.querySelector(`[data-testid="trash-board-restore-${id}"]`));
    await waitFor(() => selectTrashedTasks(useTaskStore.getState()).length === 0);

    expect(selectTrashedTasks(useTaskStore.getState())).toHaveLength(0);
    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);
  });

  it('🔴 彻底删除必须二次确认：第一次点击只打开确认框，不删除', async () => {
    const id = await seedTrashed('写文档');
    const el = renderTrash();

    click(el.querySelector(`[data-testid="trash-board-purge-${id}"]`));

    expect(el.querySelector('[data-testid="trash-confirm"]')).not.toBeNull();
    // 还没删 —— 这才是"二次确认"的重点
    expect(selectTrashedTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);

    // 取消后条目仍在，确认框关闭
    click(el.querySelector('[data-testid="trash-confirm-cancel"]'));
    expect(el.querySelector('[data-testid="trash-confirm"]')).toBeNull();
    expect(selectTrashedTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);
  });

  it('确认后才真正彻底删除', async () => {
    const id = await seedTrashed('写文档');
    const el = renderTrash();

    click(el.querySelector(`[data-testid="trash-board-purge-${id}"]`));
    click(el.querySelector('[data-testid="trash-confirm-submit"]'));
    await waitFor(
      () => useTaskStore.getState().entities.tasks[id]?.purgedAt !== undefined,
    );

    expect(selectTrashedTasks(useTaskStore.getState())).toHaveLength(0);
    expect(useTaskStore.getState().entities.tasks[id]!.purgedAt).toBeTypeOf('number');
  });
});
