/**
 * 任务 store 测试
 * =================
 *
 * store 是 P1 UI 层的真实逻辑（筛选、软删除、完成态），值得测。
 * 这些测试同时也是**接上 op-log 时的回归网**：
 * 3.2 完成后，同样的行为必须保持（见 store.ts 里的 TODO）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { Priority, Quadrant } from '@heyta/domain';

import {
  selectQuadrantCounts,
  selectVisibleTasks,
  useTaskStore,
} from '../src/features/tasks/store.js';

function reset(): void {
  useTaskStore.setState({ tasks: [], filter: { kind: 'all' }, now: Date.now() });
}

describe('任务 store', () => {
  beforeEach(reset);

  it('添加任务', () => {
    useTaskStore.getState().addTask('写文档');
    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('写文档');
    expect(tasks[0]!.completedAt).toBeUndefined();
  });

  it('空标题或纯空白不建任务', () => {
    useTaskStore.getState().addTask('   ');
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it('标题两端空白被裁剪', () => {
    useTaskStore.getState().addTask('  写文档  ');
    expect(useTaskStore.getState().tasks[0]!.title).toBe('写文档');
  });

  it('切换完成态是幂等的往返（不是切换成"已删除"）', () => {
    useTaskStore.getState().addTask('任务');
    const id = useTaskStore.getState().tasks[0]!.id;

    useTaskStore.getState().toggleComplete(id);
    expect(useTaskStore.getState().tasks[0]!.completedAt).toBeTypeOf('number');

    useTaskStore.getState().toggleComplete(id);
    expect(useTaskStore.getState().tasks[0]!.completedAt).toBeUndefined();
  });

  it('删除是软删除（墓碑），数据仍在，同步端才看得到这次删除', () => {
    useTaskStore.getState().addTask('任务');
    const id = useTaskStore.getState().tasks[0]!.id;
    useTaskStore.getState().deleteTask(id);

    const t = useTaskStore.getState().tasks[0]!;
    expect(t.deletedAt).toBeTypeOf('number');
    // 关键：任务**没有**从数组里消失。硬删除会让远端永远收不到删除。
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it('软删除的任务不出现在任何筛选视图里', () => {
    useTaskStore.getState().addTask('任务');
    const id = useTaskStore.getState().tasks[0]!.id;
    useTaskStore.getState().deleteTask(id);

    expect(selectVisibleTasks(useTaskStore.getState())).toHaveLength(0);
  });

  it('"全部"视图排除已完成', () => {
    useTaskStore.getState().addTask('1');
    useTaskStore.getState().addTask('2');
    const id = useTaskStore.getState().tasks[0]!.id;
    useTaskStore.getState().toggleComplete(id);

    const visible = selectVisibleTasks(useTaskStore.getState());
    expect(visible.map((t) => t.title)).toEqual(['2']);
  });

  it('"已完成"视图只含已完成', () => {
    useTaskStore.getState().addTask('1');
    useTaskStore.getState().addTask('2');
    useTaskStore.getState().toggleComplete(useTaskStore.getState().tasks[0]!.id);
    useTaskStore.setState({ filter: { kind: 'completed' } });

    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.title)).toEqual(['1']);
  });

  it('"今天"视图按本地日历日匹配（不是 UTC）', () => {
    const now = new Date(2026, 8, 25, 10, 0, 0).getTime();
    // 同一天的稍晚时刻
    const laterToday = new Date(2026, 8, 25, 23, 30, 0).getTime();
    // 第二天
    const tomorrow = new Date(2026, 8, 26, 1, 0, 0).getTime();

    useTaskStore.setState({ now, tasks: [] });
    useTaskStore.getState().addTask('今天', { dueDate: laterToday });
    useTaskStore.getState().addTask('明天', { dueDate: tomorrow });
    useTaskStore.setState({ filter: { kind: 'today' } });

    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.title)).toEqual(['今天']);
  });

  it('象限筛选与计数一致', () => {
    const now = new Date(2026, 8, 25, 10, 0, 0).getTime();
    useTaskStore.setState({ now, tasks: [] });
    useTaskStore.getState().addTask('Q1', { important: true, dueDate: now + 3600_000 });
    useTaskStore.getState().addTask('Q4', { important: false });

    const counts = selectQuadrantCounts(useTaskStore.getState());
    expect(counts[Quadrant.UrgentImportant]).toBe(1);
    expect(counts[Quadrant.Neither]).toBe(1);

    useTaskStore.setState({ filter: { kind: 'quadrant', quadrant: Quadrant.UrgentImportant } });
    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.title)).toEqual(['Q1']);
  });

  it('新任务默认优先级为 None', () => {
    useTaskStore.getState().addTask('任务');
    expect(useTaskStore.getState().tasks[0]!.priority).toBe(Priority.None);
  });
});
