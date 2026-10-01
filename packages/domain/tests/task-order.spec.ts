/**
 * `task-order.ts` 的行为测试
 * =========================
 *
 * 🔴 这个文件是"同一个账号在不同端排出同一个顺序"的**唯一**判据所在，
 * 所以用例全部盯着**不会报错、只会排错**的那类边界：`completedAt: 0`、
 * `priority: undefined` 与 `None` 同义、无截止垫底、同档内保持原序。
 * 它们没有一个能被类型检查抓到。
 *
 * 每条口径都单独验「已完成沉底」，而不是只验一次：那条规则写在分支**外面**，
 * 一旦有人把它挪进 `case 'display'` 里，只有逐档断言才会红。
 */

import { describe, expect, it } from 'vitest';
import { Priority, sortTasks, sortTasksForDisplay, TASK_SORT_KEYS, type Task } from '../src/index.js';

/** 造一条任务。默认未完成、无截止、没设优先级 —— 每条用例只覆盖它关心的字段。 */
function mkTask(id: string, overrides: Partial<Task> = {}): Task {
  return { id, title: id, createdAt: 0, updatedAt: 0, ...overrides };
}

const ids = (tasks: readonly Task[]): string[] => tasks.map((t) => t.id);

describe('sortTasks —— 每一档共同的前提', () => {
  it('🔴 已完成沉底在**每一档**都成立（它不是偏好，是这张列表的前提）', () => {
    const done = mkTask('done', {
      completedAt: 1,
      dueDate: 1,
      createdAt: 9,
      priority: Priority.High,
    });
    const todo = mkTask('todo', { dueDate: 999, createdAt: 1, priority: Priority.None });
    for (const key of TASK_SORT_KEYS) {
      expect(ids(sortTasks([done, todo], key)), `口径 ${key}`).toEqual(['todo', 'done']);
    }
  });

  it('completedAt: 0 也算已完成（判的是存在性，不是真值）', () => {
    const zero = mkTask('zero', { completedAt: 0 });
    const todo = mkTask('todo');
    expect(ids(sortTasks([zero, todo], 'addedAt'))).toEqual(['todo', 'zero']);
  });
});

describe("sortTasks —— 'display'（默认档）", () => {
  it('截止近的在前', () => {
    const late = mkTask('late', { dueDate: 200 });
    const early = mkTask('early', { dueDate: 100 });
    expect(ids(sortTasks([late, early], 'display'))).toEqual(['early', 'late']);
  });

  it('🔴 无截止垫底，而不是排在最前', () => {
    // 写成 `dueDate ?? 0` 的话，0 = 1970-01-01，会被当成"最紧急"排到第一行 ——
    // 收集箱里那些没设日期的任务会永远压在列表顶端，而它们恰恰最不急。
    const none = mkTask('none');
    const has = mkTask('has', { dueDate: 1_700_000_000_000 });
    expect(ids(sortTasks([none, has], 'display'))).toEqual(['has', 'none']);
  });

  it('不传 key 时就是 display（默认值不能是另一份实现）', () => {
    const late = mkTask('late', { dueDate: 200 });
    const early = mkTask('early', { dueDate: 100 });
    expect(ids(sortTasks([late, early]))).toEqual(['early', 'late']);
    expect(ids(sortTasksForDisplay([late, early]))).toEqual(['early', 'late']);
  });
});

describe("sortTasks —— 'addedAt'", () => {
  it('新的在前：刚记下来的那条就是用户要找的', () => {
    const older = mkTask('older', { createdAt: 100 });
    const newer = mkTask('newer', { createdAt: 200 });
    expect(ids(sortTasks([older, newer], 'addedAt'))).toEqual(['newer', 'older']);
  });

  it('它**不看**截止时间：无截止的新任务排在有截止的旧任务之前', () => {
    // 这条断言钉的是"档位之间不互相串味"。addedAt 里偷偷掺一条 dueDate 比较，
    // 界面上的表现就是"按添加时间排了个不明所以的顺序"。
    const freshNoDue = mkTask('fresh', { createdAt: 200 });
    const staleWithDue = mkTask('stale', { createdAt: 100, dueDate: 50 });
    expect(ids(sortTasks([staleWithDue, freshNoDue], 'addedAt'))).toEqual([
      'fresh',
      'stale',
    ]);
  });
});

describe("sortTasks —— 'priority'", () => {
  it('高的在前', () => {
    const low = mkTask('low', { priority: Priority.Low });
    const high = mkTask('high', { priority: Priority.High });
    expect(ids(sortTasks([low, high], 'priority'))).toEqual(['high', 'low']);
  });

  it('🔴 undefined 与 None 同义，一起落到最后（不发明中间档）', () => {
    // 若给"没设优先级"一个中间档，它会插进 Low 与 Medium 之间 ——
    // 用户看到的是"没填的比填了低的还重要"。
    const unset = mkTask('unset');
    const none = mkTask('none', { priority: Priority.None });
    const low = mkTask('low', { priority: Priority.Low });
    expect(ids(sortTasks([unset, low, none], 'priority'))).toEqual(['low', 'unset', 'none']);
  });

  it('同优先级之间保持原序（稳定性）', () => {
    const a = mkTask('a', { priority: Priority.Medium });
    const b = mkTask('b', { priority: Priority.Medium });
    const c = mkTask('c', { priority: Priority.Medium });
    expect(ids(sortTasks([a, b, c], 'priority'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortTasks([c, a, b], 'priority'))).toEqual(['c', 'a', 'b']);
  });
});

describe('sortTasks —— 输入不变性', () => {
  it('不改动传进来的数组（列表是 store 的引用，就地排会惊动所有订阅者）', () => {
    const input = [mkTask('b', { dueDate: 2 }), mkTask('a', { dueDate: 1 })];
    const before = ids(input);
    const sorted = sortTasks(input, 'display');
    expect(ids(input)).toEqual(before);
    expect(ids(sorted)).toEqual(['a', 'b']);
    expect(sorted).not.toBe(input);
  });

  it('空数组与单条都不炸', () => {
    expect(sortTasks([], 'priority')).toEqual([]);
    expect(ids(sortTasks([mkTask('only')], 'addedAt'))).toEqual(['only']);
  });
});
