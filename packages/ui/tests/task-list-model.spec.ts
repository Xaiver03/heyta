/**
 * `model.ts` 的行为测试
 * =====================
 *
 * 这里刻意挑的都是**不报错、只会画错**的那类边界：
 * `completedAt: 0`、`dueDate: 0`、空标题、排序稳定性。
 * 它们全都不会在类型检查或运行时报错 —— 只会在屏幕上呈现成别的东西。
 */

import { describe, expect, it } from 'vitest';
import type { Task } from '@heyta/domain';
import { sortTasksForDisplay, toTaskRow, toTaskRows } from '../src/task-list/model.js';

/** 造一条任务。默认未完成、无截止 —— 每条用例只覆盖它真正关心的字段。 */
function mkTask(id: string, overrides: Partial<Task> = {}): Task {
  return { id, title: id, createdAt: 0, updatedAt: 0, ...overrides };
}

const ids = (tasks: readonly Task[]): string[] => tasks.map((t) => t.id);

describe('toTaskRow', () => {
  it('把 Task 映射成渲染所需的最小字段集', () => {
    const row = toTaskRow(
      mkTask('a', { title: '写周报', important: true, dueDate: 1_700_000_000_000 }),
    );
    expect(row).toEqual({
      id: 'a',
      title: '写周报',
      done: false,
      important: true,
      dueAt: 1_700_000_000_000,
    });
  });

  it('🔴 completedAt 判的是"存不存在"而不是真值 —— 0 也是已完成', () => {
    // domain 里 completedAt 是 epoch ms。理论上 0 不会自然出现，
    // 但它是一个**合法数字**，而 `if (task.completedAt)` 会把它当成未完成。
    // 这类"用真值判断代替存在性判断"的写法，是同一族 bug 里最常见的一种。
    expect(toTaskRow(mkTask('a', { completedAt: 0 })).done).toBe(true);
    expect(toTaskRow(mkTask('a')).done).toBe(false);
  });

  it('🔴 dueDate: 0 要得到 0，不能变成 null', () => {
    // 用 `||` 写就会得到 null，于是"1970-01-01 到期"这条会被排进"无截止"里。
    // 用 `??` 才是对的：null/undefined 才代表"没有截止时间"。
    expect(toTaskRow(mkTask('a', { dueDate: 0 })).dueAt).toBe(0);
    expect(toTaskRow(mkTask('a')).dueAt).toBeNull();
  });

  it('important 只在真的是 true 时才算重要', () => {
    expect(toTaskRow(mkTask('a', { important: true })).important).toBe(true);
    expect(toTaskRow(mkTask('a', { important: false })).important).toBe(false);
    expect(toTaskRow(mkTask('a')).important).toBe(false);
  });

  it('标题首尾空白被去掉；空标题用 fallbackTitle 兜住', () => {
    expect(toTaskRow(mkTask('a', { title: '  写周报  ' })).title).toBe('写周报');
    expect(toTaskRow(mkTask('a', { title: '   ' }), { fallbackTitle: '（无标题）' }).title).toBe(
      '（无标题）',
    );
  });

  it('不给 fallbackTitle 时空标题退化成空串（而不是 undefined）', () => {
    // 组件直接把这个值渲染进 <Text>。给 undefined 会让 RN 渲染出
    // "undefined" 字样吗？——不会，但类型上就不该允许这种事发生。
    expect(toTaskRow(mkTask('a', { title: '' })).title).toBe('');
  });
});

describe('sortTasksForDisplay', () => {
  it('未完成在前，已完成在后', () => {
    const done = mkTask('done', { completedAt: 1 });
    const todo = mkTask('todo');
    expect(ids(sortTasksForDisplay([done, todo]))).toEqual(['todo', 'done']);
  });

  it('未完成之间按截止时间升序', () => {
    const late = mkTask('late', { dueDate: 200 });
    const early = mkTask('early', { dueDate: 100 });
    expect(ids(sortTasksForDisplay([late, early]))).toEqual(['early', 'late']);
  });

  it('🔴 没有截止时间的排最后 —— 不是最前', () => {
    // 用 0 当"无截止"的哨兵值就会排到最前面（0 < 任何真实时间戳），
    // 于是整个收集箱会顶在列表最上方。这是没有截止时间的任务里
    // 最常见的一种实现错误。
    const none = mkTask('none');
    const has = mkTask('has', { dueDate: 100 });
    expect(ids(sortTasksForDisplay([none, has]))).toEqual(['has', 'none']);
  });

  it('已完成之间同样按截止时间排', () => {
    const doneLate = mkTask('done-late', { completedAt: 1, dueDate: 200 });
    const doneEarly = mkTask('done-early', { completedAt: 1, dueDate: 100 });
    expect(ids(sortTasksForDisplay([doneLate, doneEarly]))).toEqual(['done-early', 'done-late']);
  });

  it('🔴 同键时保持原顺序（稳定排序）', () => {
    // 顺序若无故变化，每次重排列表都会自己抖一下 ——
    // 而"列表会自己换位置"是用户最直接的不信任来源。
    const a = mkTask('a', { dueDate: 100 });
    const b = mkTask('b', { dueDate: 100 });
    const c = mkTask('c', { dueDate: 100 });
    expect(ids(sortTasksForDisplay([a, b, c]))).toEqual(['a', 'b', 'c']);
    expect(ids(sortTasksForDisplay([c, a, b]))).toEqual(['c', 'a', 'b']);
  });

  it('不修改传入的数组', () => {
    const input = [mkTask('b', { dueDate: 200 }), mkTask('a', { dueDate: 100 })];
    const snapshot = ids(input);
    sortTasksForDisplay(input);
    expect(ids(input)).toEqual(snapshot);
  });

  it('空数组与单元素是安全的', () => {
    expect(sortTasksForDisplay([])).toEqual([]);
    expect(ids(sortTasksForDisplay([mkTask('only')]))).toEqual(['only']);
  });
});

describe('toTaskRows', () => {
  it('排序与映射一步完成，顺序与 sortTasksForDisplay 一致', () => {
    const rows = toTaskRows(
      [
        mkTask('done', { completedAt: 1 }),
        mkTask('none'),
        mkTask('soon', { dueDate: 100 }),
      ],
      { fallbackTitle: '（无标题）' },
    );
    expect(rows.map((r) => r.id)).toEqual(['soon', 'none', 'done']);
  });

  it('把 fallbackTitle 透传给每一行', () => {
    const rows = toTaskRows([mkTask('a', { title: '' })], { fallbackTitle: '（无标题）' });
    expect(rows[0]?.title).toBe('（无标题）');
  });
});
