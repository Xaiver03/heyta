/**
 * 任务 store 测试（**经由 op-log 的版本**）
 * ============================================
 *
 * 与上一版的区别是决定性的：现在每个写入都真的经过 op-log。
 * 所以这里不只测 UI 行为，还要测 **D4 是否被遵守** ——
 * 即"每次写入都留下了 op"，那才意味着它能被同步。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { Priority, Quadrant } from '@heyta/domain';
import { IndexedDbAdapter, IndexedDbOpLogStore } from '@heyta/storage';
import type { Operation } from '@heyta/sync-core';

import {
  __resetOpLogForTests,
  initOpLog,
  selectQuadrantCounts,
  selectVisibleTasks,
  useTaskStore,
} from '../src/features/tasks/store.js';

let dbName: string;

async function countOps(): Promise<number> {
  const db = new IndexedDbAdapter(dbName);
  await db.init();
  const store = new IndexedDbOpLogStore<Operation<string>>(db);
  const all = await store.getAllOps();
  db.close();
  return all.length;
}

describe('任务 store（D4：写入必须经过 op-log）', () => {
  beforeEach(async () => {
    const g = globalThis as unknown as {
      indexedDB: IDBFactory;
      IDBKeyRange: typeof IDBKeyRange;
    };
    g.indexedDB = new IDBFactory();
    g.IDBKeyRange = IDBKeyRange;

    dbName = `web-test-${Math.random().toString(36).slice(2)}`;
    __resetOpLogForTests();
    useTaskStore.setState({
      entities: {
        tasks: {},
        projects: {},
        tags: {},
        habits: {},
        habitLogs: {},
        focusSessions: {},
      },
      filter: { kind: 'all' },
      now: Date.now(),
      ready: false,
    });
    await initOpLog(dbName);
  });

  it('initOpLog 完成后 ready 为真', () => {
    expect(useTaskStore.getState().ready).toBe(true);
    expect(useTaskStore.getState().error).toBeUndefined();
  });

  it('🔴 添加任务会真的写入 op-log（这是它与"直接改状态"的区别）', async () => {
    await useTaskStore.getState().addTask('写文档');
    expect(useTaskStore.getState().entities.tasks).toBeDefined();
    // 关键断言：op 真的落盘了，所以它能被同步
    expect(await countOps()).toBe(1);
  });

  it('空标题不建任务，也不留下 op', async () => {
    await useTaskStore.getState().addTask('   ');
    expect(Object.keys(useTaskStore.getState().entities.tasks)).toHaveLength(0);
    expect(await countOps()).toBe(0);
  });

  it('标题两端空白被裁剪', async () => {
    await useTaskStore.getState().addTask('  写文档  ');
    const tasks = Object.values(useTaskStore.getState().entities.tasks);
    expect(tasks[0]!.title).toBe('写文档');
  });

  it('完成态往返可逆（不是单向变成已删除）', async () => {
    await useTaskStore.getState().addTask('任务');
    const id = Object.keys(useTaskStore.getState().entities.tasks)[0]!;

    await useTaskStore.getState().toggleComplete(id);
    expect(useTaskStore.getState().entities.tasks[id]!.completedAt).toBeTypeOf('number');

    await useTaskStore.getState().toggleComplete(id);
    // 取消完成必须让字段**消失**（而不是变 null），否则完成态判断会失效
    expect(useTaskStore.getState().entities.tasks[id]!.completedAt).toBeUndefined();
  });

  it('🔴 删除是软删除：墓碑保留，且 op 已落盘（远端才收得到删除）', async () => {
    await useTaskStore.getState().addTask('任务');
    const id = Object.keys(useTaskStore.getState().entities.tasks)[0]!;
    await useTaskStore.getState().deleteTask(id);

    expect(useTaskStore.getState().entities.tasks[id]!.deletedAt).toBeTypeOf('number');
    // 两条 op：CREATE + DELETE
    expect(await countOps()).toBe(2);
  });

  it('已删除的任务不出现在任何视图', async () => {
    await useTaskStore.getState().addTask('任务');
    const id = Object.keys(useTaskStore.getState().entities.tasks)[0]!;
    await useTaskStore.getState().deleteTask(id);
    expect(selectVisibleTasks(useTaskStore.getState())).toHaveLength(0);
  });

  it('"全部"排除已完成，"已完成"只含已完成', async () => {
    await useTaskStore.getState().addTask('1');
    await useTaskStore.getState().addTask('2');
    const ids = Object.keys(useTaskStore.getState().entities.tasks);
    await useTaskStore.getState().toggleComplete(ids[0]!);

    expect(
      selectVisibleTasks(useTaskStore.getState()).map((t) => t.title),
    ).toEqual(['2']);

    useTaskStore.setState({ filter: { kind: 'completed' } });
    expect(
      selectVisibleTasks(useTaskStore.getState()).map((t) => t.title),
    ).toEqual(['1']);
  });

  it('"今天"按本地日历日匹配（不是 UTC）', async () => {
    const now = new Date(2026, 8, 25, 10, 0, 0).getTime();
    useTaskStore.setState({ now });
    await useTaskStore.getState().addTask('今天', {
      dueDate: new Date(2026, 8, 25, 23, 30, 0).getTime(),
    });
    await useTaskStore.getState().addTask('明天', {
      dueDate: new Date(2026, 8, 26, 1, 0, 0).getTime(),
    });

    useTaskStore.setState({ filter: { kind: 'today' } });
    expect(
      selectVisibleTasks(useTaskStore.getState()).map((t) => t.title),
    ).toEqual(['今天']);
  });

  it('象限筛选与计数一致', async () => {
    const now = new Date(2026, 8, 25, 10, 0, 0).getTime();
    useTaskStore.setState({ now });
    await useTaskStore.getState().addTask('Q1', {
      important: true,
      dueDate: now + 3600_000,
    });
    await useTaskStore.getState().addTask('Q4', { important: false });

    const counts = selectQuadrantCounts(useTaskStore.getState());
    expect(counts[Quadrant.UrgentImportant]).toBe(1);
    expect(counts[Quadrant.Neither]).toBe(1);

    useTaskStore.setState({
      filter: { kind: 'quadrant', quadrant: Quadrant.UrgentImportant },
    });
    expect(
      selectVisibleTasks(useTaskStore.getState()).map((t) => t.title),
    ).toEqual(['Q1']);
  });

  it('新任务默认优先级为 None', async () => {
    await useTaskStore.getState().addTask('任务');
    const t = Object.values(useTaskStore.getState().entities.tasks)[0]!;
    expect(t.priority).toBe(Priority.None);
  });

  it('🔴 数据在"重启"后仍然存在（op-log 是事实来源）', async () => {
    await useTaskStore.getState().addTask('持久化任务');
    expect(await countOps()).toBe(1);

    // 模拟重启：重置模块状态，用同一个 dbName 重新初始化
    __resetOpLogForTests();
    useTaskStore.setState({
      entities: {
        tasks: {},
        projects: {},
        tags: {},
        habits: {},
        habitLogs: {},
        focusSessions: {},
      },
      ready: false,
    });
    await initOpLog(dbName);

    // 注意：这里验证的是 op 仍在库里（重建由 op-log 的 rebuildFromLog 负责）。
    // 状态恢复属于 3.2 的引擎职责，已在 op-log 包内单独测试。
    expect(await countOps()).toBe(1);
  });
});
